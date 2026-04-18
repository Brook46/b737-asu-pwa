/* Airspeed Unreliable — B737NG PWA
 * Source: D6-27370-858-ELA Rev.57 · PI-QRH §10 (4X-EK fleet)
 *
 * Architecture:
 *  - State lives in one `state` object, persisted to localStorage.
 *  - Rendering is pure: render() reads state + QRH data and rewrites the result card.
 *  - Sensors (GPS + DeviceMotion) are lazily enabled on user gesture (iOS requirement).
 *  - G-force has a touchdown state machine: pre-landing shows live |g|; after GS
 *    crosses 60 kt downward it switches to "peak over last 120s".
 */

'use strict';

/* ─── State & persistence ──────────────────────────────────────────────── */

const STORE_KEY = 'asu.state.v1';
const DISCLAIMER_KEY = 'asu.disclaimerAck.v1';
const THEME_KEY = 'asu.theme.v1';

/** @type {{variant:'800'|'900', phase:string, weight:number, aptAlt:number|null, gaFlap:string}} */
const state = Object.assign({
  variant: '800',
  phase: 'climb',
  weight: 65,
  aptAlt: 0,
  gaFlap: '1',
}, loadJSON(STORE_KEY, {}));

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}
function saveState() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

/* ─── QRH data loading ─────────────────────────────────────────────────── */

/** @type {{['800']?: any, ['900']?: any}} */
const qrh = {};

async function loadQRH() {
  const [d800, d900] = await Promise.all([
    fetch('data/qrh-800.json').then(r => r.json()),
    fetch('data/qrh-900.json').then(r => r.json()),
  ]);
  qrh['800'] = d800;
  qrh['900'] = d900;
}

/* ─── Utilities ────────────────────────────────────────────────────────── */

const WEIGHTS = [40, 50, 60, 70, 80];
const MIN_WEIGHT = 40, MAX_WEIGHT = 80;

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const fmtPitch = p => p == null ? '—' : (p >= 0 ? '+' : '') + p.toFixed(1) + '°';
const fmtN1    = n => n == null ? '—' : n.toFixed(1) + '%';
const fmtVS    = v => v == null ? '—' : (v > 0 ? '+' : '') + Math.round(v).toLocaleString();
const fmtKIAS  = k => k == null ? '—' : String(Math.round(k));
const fmtAlt   = a => a === 0 ? 'Sea Level' : (a < 0 ? a.toLocaleString() : a.toLocaleString()) + ' ft';
const pad3     = n => String(n).padStart(3, '0');

/** Index of the weight band nearest `w` (rounded to nearest 10t, clamped). */
function nearestBandIdx(w) {
  const clamped = clamp(w, MIN_WEIGHT, MAX_WEIGHT);
  return Math.round((clamped - MIN_WEIGHT) / 10);
}

/* ─── Theme ────────────────────────────────────────────────────────────── */

const themeBtn = document.getElementById('theme-btn');
const mq = window.matchMedia('(prefers-color-scheme: dark)');

function applyTheme() {
  const mode = localStorage.getItem(THEME_KEY) || 'auto';
  const isDark = mode === 'dark' || (mode === 'auto' && mq.matches);
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  themeBtn.textContent = mode[0].toUpperCase() + mode.slice(1);
  themeBtn.classList.toggle('on', mode !== 'auto');
  // update theme-color
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute('content', isDark ? '#0f1418' : '#f5f5f7');
}
themeBtn.addEventListener('click', () => {
  const cur = localStorage.getItem(THEME_KEY) || 'auto';
  const next = { auto: 'light', light: 'dark', dark: 'auto' }[cur];
  localStorage.setItem(THEME_KEY, next);
  applyTheme();
});
mq.addEventListener('change', applyTheme);
applyTheme();

/* ─── Disclaimer gate ──────────────────────────────────────────────────── */

const disclaimer = document.getElementById('disclaimer');
function showDisclaimer() {
  if (localStorage.getItem(DISCLAIMER_KEY) !== '1') {
    disclaimer.setAttribute('aria-hidden', 'false');
  } else {
    disclaimer.setAttribute('aria-hidden', 'true');
  }
}
document.getElementById('disclaimer-ack').addEventListener('click', () => {
  localStorage.setItem(DISCLAIMER_KEY, '1');
  disclaimer.setAttribute('aria-hidden', 'true');
});
showDisclaimer();

/* ─── Variant picker ───────────────────────────────────────────────────── */

document.querySelectorAll('.seg-btn[data-variant]').forEach(btn => {
  btn.addEventListener('click', () => {
    state.variant = btn.dataset.variant;
    saveState();
    updateVariantUI();
    render();
  });
});
function updateVariantUI() {
  document.querySelectorAll('.seg-btn[data-variant]').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.variant === state.variant));
  });
}
updateVariantUI();

/* ─── Phase tabs ───────────────────────────────────────────────────────── */

document.querySelectorAll('.phase-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    state.phase = btn.dataset.phase;
    saveState();
    updatePhaseUI();
    render();
  });
});
function updatePhaseUI() {
  document.querySelectorAll('.phase-tab').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.phase === state.phase));
  });
}
updatePhaseUI();

/* ─── Weight input (typed + drag-to-scrub) ─────────────────────────────── */

const weightInput = document.getElementById('weight');
const weightWrap = weightInput.closest('.weight-input-wrap');
weightInput.value = String(state.weight);

weightInput.addEventListener('input', () => {
  const v = parseInt(weightInput.value, 10);
  if (!Number.isNaN(v)) {
    state.weight = clamp(v, MIN_WEIGHT, MAX_WEIGHT);
    saveState();
    updateWeightBands();
    render();
  }
});
weightInput.addEventListener('blur', () => {
  weightInput.value = String(state.weight);
});

// Drag-to-scrub on the wrap (but allow tap-to-focus the number)
(() => {
  let dragging = false, startY = 0, startW = 0, totalDy = 0;
  const MOVE_PER_TONNE = 12; // px per 1 t when dragging vertically
  weightWrap.addEventListener('pointerdown', e => {
    if (e.target === weightInput) return; // allow normal input focus
    dragging = true;
    startY = e.clientY;
    startW = state.weight;
    totalDy = 0;
    weightWrap.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  weightWrap.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dy = startY - e.clientY; // drag up -> increase
    totalDy = dy;
    const newW = clamp(Math.round(startW + dy / MOVE_PER_TONNE), MIN_WEIGHT, MAX_WEIGHT);
    if (newW !== state.weight) {
      state.weight = newW;
      weightInput.value = String(newW);
      updateWeightBands();
      render();
      if (window.navigator.vibrate) window.navigator.vibrate(3);
    }
  });
  weightWrap.addEventListener('pointerup', e => {
    if (!dragging) return;
    dragging = false;
    weightWrap.releasePointerCapture(e.pointerId);
    saveState();
    // If drag was trivial, let the tap focus the input
    if (Math.abs(totalDy) < 3) weightInput.focus();
  });
  weightWrap.addEventListener('pointercancel', () => { dragging = false; });
})();

function updateWeightBands() {
  const idx = nearestBandIdx(state.weight);
  document.querySelectorAll('.weight-bands .band').forEach((el, i) => {
    el.classList.toggle('near', i === idx);
  });
}
updateWeightBands();

/* ─── Sub-controls (airport alt, GA flap) ──────────────────────────────── */

const subCard = document.getElementById('sub-controls');

function buildSubControls() {
  subCard.innerHTML = '';
  if (state.phase === 'terminal' || state.phase === 'approach') {
    const data = qrh[state.variant][state.phase];
    const alts = data.map(r => r.apt_alt);
    // Clamp current aptAlt to an available value
    if (!alts.includes(state.aptAlt)) {
      state.aptAlt = alts.includes(0) ? 0 : alts[0];
      saveState();
    }
    const label = document.createElement('span');
    label.className = 'section-label';
    label.textContent = state.phase === 'terminal' ? 'Airport altitude' : 'Airport altitude';
    subCard.appendChild(label);
    const wrap = document.createElement('div');
    wrap.className = 'chips';
    alts.forEach(a => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.setAttribute('aria-pressed', String(a === state.aptAlt));
      chip.textContent = a === 0 ? 'SL' : (a > 0 ? '+' : '') + a.toLocaleString();
      chip.addEventListener('click', () => {
        state.aptAlt = a;
        saveState();
        buildSubControls();
        render();
      });
      wrap.appendChild(chip);
    });
    subCard.appendChild(wrap);
    subCard.hidden = false;
  } else if (state.phase === 'go_around') {
    const label = document.createElement('span');
    label.className = 'section-label';
    label.textContent = 'Go-Around flap';
    subCard.appendChild(label);
    const wrap = document.createElement('div');
    wrap.className = 'chips';
    ['1', '5', '15'].forEach(f => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'chip';
      chip.setAttribute('aria-pressed', String(f === state.gaFlap));
      chip.textContent = 'Flaps ' + f;
      chip.addEventListener('click', () => {
        state.gaFlap = f;
        saveState();
        buildSubControls();
        render();
      });
      wrap.appendChild(chip);
    });
    subCard.appendChild(wrap);
    subCard.hidden = false;
  } else {
    subCard.hidden = true;
  }
}

/* ─── Rendering ────────────────────────────────────────────────────────── */

const resultEl = document.getElementById('result');
const sourceEl = document.getElementById('source-cite');

function render() {
  if (!qrh['800']) return; // data not loaded yet
  const d = qrh[state.variant];
  const nearIdx = nearestBandIdx(state.weight);
  let html = '';
  let source = '';

  const header = (title, sub) =>
    `<div class="result-header"><strong>${title}</strong>${sub ? ' · ' + sub : ''}</div>`;

  switch (state.phase) {
    case 'climb':
      html = header(`737${state.variant === '800' ? '-800W' : '-900ERW'} · Climb`,
        `${state.weight} t`) +
        `<div class="phase-note">${d.notes.climb}</div>` +
        renderAltPitchMetricTable(d.climb, 'vs', 'V/S fpm', nearIdx);
      source = `${d.source} · PI-QRH §10 CLIMB`;
      break;
    case 'cruise':
      html = header(`737${state.variant === '800' ? '-800W' : '-900ERW'} · Cruise`,
        `${state.weight} t`) +
        `<div class="phase-note">${d.notes.cruise}</div>` +
        renderAltPitchMetricTable(d.cruise, 'n1', 'N1 %', nearIdx);
      source = `${d.source} · PI-QRH §10 CRUISE`;
      break;
    case 'descent':
      html = header(`737${state.variant === '800' ? '-800W' : '-900ERW'} · Descent`,
        `${state.weight} t`) +
        `<div class="phase-note">${d.notes.descent}</div>` +
        renderAltPitchMetricTable(d.descent, 'vs', 'V/S fpm', nearIdx);
      source = `${d.source} · PI-QRH §10 DESCENT`;
      break;
    case 'holding':
      html = header(`737${state.variant === '800' ? '-800W' : '-900ERW'} · Holding`,
        `${state.weight} t`) +
        `<div class="phase-note">${d.notes.holding}</div>` +
        renderHoldingTable(d.holding, nearIdx);
      source = `${d.source} · PI-QRH §10 HOLDING`;
      break;
    case 'terminal': {
      const row = d.terminal.find(r => r.apt_alt === state.aptAlt) || d.terminal[0];
      html = header(`737${state.variant === '800' ? '-800W' : '-900ERW'} · Terminal 5,000 ft AGL`,
        `${state.weight} t · Airport ${fmtAlt(row.apt_alt)}`) +
        `<div class="phase-note">${d.notes.terminal}</div>` +
        renderFlapTable(row.flaps, nearIdx);
      source = `${d.source} · PI-QRH §10 TERMINAL AREA`;
      break;
    }
    case 'approach': {
      const row = d.approach.find(r => r.apt_alt === state.aptAlt) || d.approach[0];
      html = header(`737${state.variant === '800' ? '-800W' : '-900ERW'} · Final Approach 1,500 ft AGL`,
        `${state.weight} t · Airport ${fmtAlt(row.apt_alt)}`) +
        `<div class="phase-note">${d.notes.approach}</div>` +
        renderFlapTable(row.flaps, nearIdx);
      source = `${d.source} · PI-QRH §10 FINAL APPROACH`;
      break;
    }
    case 'go_around': {
      const rows = d.go_around['flap_' + state.gaFlap] || [];
      const note = state.gaFlap === '5'
        ? `${d.notes.go_around} — Flaps 5 is only authorized with the Alternate Go-Around and Missed Approach Procedure.`
        : d.notes.go_around;
      html = header(`737${state.variant === '800' ? '-800W' : '-900ERW'} · Go-Around`,
        `${state.weight} t · Flaps ${state.gaFlap} · Gear Up`) +
        `<div class="phase-note">${note}</div>` +
        renderGoAroundTable(rows, nearIdx);
      source = `${d.source} · PI-QRH §10 GO-AROUND`;
      break;
    }
  }
  resultEl.innerHTML = html;
  sourceEl.textContent = source;
}

function weightColHeaders(nearIdx) {
  return WEIGHTS.map((w, i) =>
    `<th class="weight-col-header${i === nearIdx ? ' near' : ''}">${w}&thinsp;t</th>`
  ).join('');
}

function renderAltPitchMetricTable(rows, metricKey, metricLabel, nearIdx) {
  const rowsHtml = rows.slice().sort((a, b) => b.alt - a.alt).map(r => {
    const p = r.pitch.map((v, i) => tdVal(v, i, nearIdx, fmtPitch)).join('');
    const m = r[metricKey].map((v, i) => {
      const formatter = metricKey === 'vs' ? fmtVS : fmtN1;
      return tdVal(v, i, nearIdx, formatter, metricKey === 'vs');
    }).join('');
    return `<tr class="double-row">
      <td class="row-label" rowspan="2">${fmtAlt(r.alt)}</td>${p}</tr>
      <tr class="double-row"><td class="metric-label" colspan="0" style="display:none"></td>${m}</tr>`;
  }).join('');
  return `
    <table class="qrh-table">
      <thead><tr><th class="row-label">Altitude</th>${weightColHeaders(nearIdx)}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="source-cite" style="margin-top:.5rem;">Each altitude shows <strong>Pitch °</strong> (row 1) and <strong>${metricLabel}</strong> (row 2).</div>
  `;
}

function renderHoldingTable(rows, nearIdx) {
  const rowsHtml = rows.slice().sort((a, b) => b.alt - a.alt).map(r => {
    const p = r.pitch.map((v, i) => tdVal(v, i, nearIdx, fmtPitch)).join('');
    const n = r.n1.map((v, i) => tdVal(v, i, nearIdx, fmtN1)).join('');
    const k = r.kias.map((v, i) => tdVal(v, i, nearIdx, fmtKIAS, false, 'sub')).join('');
    return `
      <tr><td class="row-label" rowspan="3">${fmtAlt(r.alt)}</td>${p}</tr>
      <tr>${n}</tr>
      <tr>${k}</tr>`;
  }).join('');
  return `
    <table class="qrh-table">
      <thead><tr><th class="row-label">Altitude</th>${weightColHeaders(nearIdx)}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="source-cite" style="margin-top:.5rem;">Each altitude shows <strong>Pitch °</strong>, <strong>N1 %</strong>, <strong>KIAS</strong>.</div>
  `;
}

function renderFlapTable(flaps, nearIdx) {
  const rowsHtml = flaps.map(f => {
    const label = `Flaps ${f.flap} ${f.gear === 'DOWN' ? '· Gear DN' : ''}<span class="flap-sub">${f.vref}</span>`;
    const p = f.pitch.map((v, i) => tdVal(v, i, nearIdx, fmtPitch)).join('');
    const n = f.n1.map((v, i) => tdVal(v, i, nearIdx, fmtN1)).join('');
    const k = f.kias.map((v, i) => tdVal(v, i, nearIdx, fmtKIAS, false, 'sub')).join('');
    return `
      <tr><td class="row-label" rowspan="3">${label}</td>${p}</tr>
      <tr>${n}</tr>
      <tr>${k}</tr>`;
  }).join('');
  return `
    <table class="qrh-table">
      <thead><tr><th class="row-label">Configuration</th>${weightColHeaders(nearIdx)}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="source-cite" style="margin-top:.5rem;">Each config shows <strong>Pitch °</strong>, <strong>N1 %</strong>, <strong>KIAS</strong>.</div>
  `;
}

function renderGoAroundTable(rows, nearIdx) {
  if (!rows.length) return '<div class="phase-note">No data</div>';
  const rowsHtml = rows.slice().sort((a, b) => b.alt - a.alt).map(r => {
    const p = r.pitch.map((v, i) => tdVal(v, i, nearIdx, fmtPitch)).join('');
    const v = r.vs.map((val, i) => tdVal(val, i, nearIdx, fmtVS, true)).join('');
    const k = r.kias.map((val, i) => tdVal(val, i, nearIdx, fmtKIAS, false, 'sub')).join('');
    return `
      <tr><td class="row-label" rowspan="3">${fmtAlt(r.alt)}</td>${p}</tr>
      <tr>${v}</tr>
      <tr>${k}</tr>`;
  }).join('');
  return `
    <table class="qrh-table">
      <thead><tr><th class="row-label">Press. Alt</th>${weightColHeaders(nearIdx)}</tr></thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <div class="source-cite" style="margin-top:.5rem;">Each altitude shows <strong>Pitch °</strong>, <strong>V/S fpm</strong>, <strong>KIAS</strong>.</div>
  `;
}

function tdVal(val, i, nearIdx, fmt, negAware = false, extraClass = '') {
  if (val == null) return `<td class="val no-data${i === nearIdx ? ' col-near' : ''} ${extraClass}">—</td>`;
  const neg = negAware && val < 0;
  return `<td class="val${neg ? ' neg' : ''}${i === nearIdx ? ' col-near' : ''}${extraClass ? ' ' + extraClass : ''}">${fmt(val)}</td>`;
}

/* ─── QRH procedure (22 steps, §10.1) ──────────────────────────────────── */

const PROCEDURE_STEPS = [
  ['Autopilot (if engaged)', 'Disengage'],
  ['Autothrottle (if engaged)', 'Disengage'],
  ['F/D switches (both)', 'OFF'],
  ['Set gear-up pitch + thrust', 'Flaps extended: 10° / 80% N1 · Flaps up: 4° / 75% N1'],
  ['PROBE HEAT switches', 'Check ON'],
  ['Reliable indications', 'Attitude · N1 · Ground speed · Radio altitude'],
  ['Choose:', 'Reliable indication found → Go to 11 · else → Go to 8'],
  ['Refer to PI-QRH §10 tables', 'Set pitch + thrust for current config + phase'],
  ['In trim and stabilized', 'Compare CA / FO / standby airspeed vs table — >20 kt or >0.03 M difference = unreliable'],
  ['Choose: reliable found / not found', 'Found → Go to 11 · Not → Go to 12'],
  ['Choose: CA/FO reliable / only standby', 'CA/FO: FD ON (reliable side) · Standby only: no AP/AT/FD'],
  ['Set pitch + thrust from PI-QRH tables', 'As needed'],
  ['Non-Normal Config Landing Distance', 'Check PI-QRH tables or other approved source'],
  ['Autopilot (reliable side, if needed)', 'Engage'],
  ['Do not use autothrottle', '—'],
  ['Choose: altitude reliable / both unreliable', 'If reliable → 17 · If both unreliable → 21 (no RVSM)'],
  ['RVSM airspace requirement', 'Airplane may not meet'],
  ['Transponder reliable altitude', 'Select reliable side per tail fleet'],
  ['Transponder mode selector', 'TA (per fleet)'],
  ['Transponder mode selector', 'TA ONLY (per fleet)'],
  ['Transponder altitude reporting OFF', 'Per fleet'],
  ['Checklist complete', 'Except deferred items'],
];

const procBtn = document.getElementById('qrh-procedure-btn');
const procPanel = document.getElementById('qrh-procedure');
procBtn.addEventListener('click', () => {
  if (procPanel.hidden) {
    const items = PROCEDURE_STEPS.map(([l, r]) =>
      `<li><strong>${l}</strong>${r && r !== '—' ? ' — ' + r : ''}</li>`).join('');
    procPanel.innerHTML = `
      <p style="margin-bottom:.75rem;font-size:.8rem;color:var(--text-sub)">
        Paraphrased for quick reference. Always verify against your current QRH.
      </p>
      <ol>${items}</ol>`;
    procPanel.hidden = false;
    procBtn.textContent = 'Hide QRH Procedure';
  } else {
    procPanel.hidden = true;
    procBtn.textContent = 'QRH Procedure (22 steps)';
  }
});

/* ─── Sensors: GPS + G-force ───────────────────────────────────────────── */

const sensorState = {
  geoActive: false,
  motionActive: false,
  gs: null,        // ground speed, knots
  track: null,     // deg true
  alt: null,       // feet
  acc: null,       // horizontal accuracy, meters
  currentG: null,  // magnitude of (ax, ay, az) in g
  peakG: null,     // peak |g| in trailing 2 min
  // touchdown state machine
  gsSeenAbove60: false,
  landedAt: 0,     // epoch ms when GS first dropped below 60 after being above
  gBuffer: [],     // [{t, g}]
};

const MS_TO_KT = 1.94384;
const M_TO_FT = 3.28084;
const TOUCHDOWN_KT = 60;
const PEAK_WINDOW_MS = 120 * 1000;

function startGPS() {
  if (!('geolocation' in navigator) || sensorState.geoActive) return;
  sensorState.geoActive = true;
  navigator.geolocation.watchPosition(pos => {
    const s = pos.coords.speed;       // m/s (null when stationary in some browsers)
    const h = pos.coords.heading;     // deg true
    const a = pos.coords.altitude;    // meters (geoidal)
    const ac = pos.coords.accuracy;   // meters
    sensorState.gs = (s != null && s >= 0) ? Math.round(s * MS_TO_KT) : null;
    sensorState.track = (h != null && !Number.isNaN(h)) ? Math.round(((h % 360) + 360) % 360) : null;
    sensorState.alt = (a != null) ? Math.round(a * M_TO_FT) : null;
    sensorState.acc = (ac != null) ? Math.round(ac) : null;
    // touchdown detection
    if (sensorState.gs != null) {
      if (sensorState.gs >= TOUCHDOWN_KT) {
        sensorState.gsSeenAbove60 = true;
      } else if (sensorState.gsSeenAbove60 && !sensorState.landedAt) {
        sensorState.landedAt = Date.now();
      }
    }
    renderSensors();
  }, err => {
    setSensorStatus('GPS unavailable: ' + err.message);
  }, { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 });
}

async function startMotion() {
  if (sensorState.motionActive) return;
  // iOS Safari requires explicit permission + user gesture
  try {
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') {
        setSensorStatus('Motion permission denied');
        return;
      }
    }
  } catch (e) {
    setSensorStatus('Motion unavailable');
    return;
  }
  window.addEventListener('devicemotion', onMotion);
  sensorState.motionActive = true;
}

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a) return;
  const g = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2) / 9.80665;
  if (!Number.isFinite(g)) return;
  sensorState.currentG = g;
  const now = Date.now();
  sensorState.gBuffer.push({ t: now, g });
  // prune
  const cutoff = now - PEAK_WINDOW_MS;
  while (sensorState.gBuffer.length && sensorState.gBuffer[0].t < cutoff) {
    sensorState.gBuffer.shift();
  }
  // compute peak
  let peak = 0;
  for (const s of sensorState.gBuffer) if (s.g > peak) peak = s.g;
  sensorState.peakG = peak;
  renderSensorGOnly();
}

/* ─── Sensor rendering ─────────────────────────────────────────────────── */

const sensorCells = {
  gs: document.querySelector('.sensor-cell[data-role="gs"] .sensor-value'),
  trk: document.querySelector('.sensor-cell[data-role="trk"] .sensor-value'),
  alt: document.querySelector('.sensor-cell[data-role="alt"] .sensor-value'),
  acc: document.querySelector('.sensor-cell[data-role="acc"] .sensor-value'),
  gforce: document.querySelector('.sensor-cell[data-role="gforce"] .sensor-value'),
};
const gLabel = document.getElementById('g-label');
const gUnit = document.getElementById('g-unit');
const enableBtn = document.getElementById('enable-sensors');
const statusText = document.getElementById('sensor-status-text');

function setSensorStatus(text) { statusText.textContent = text; }

function renderSensors() {
  sensorCells.gs.textContent = sensorState.gs == null ? '—' : sensorState.gs;
  sensorCells.trk.textContent = sensorState.track == null ? '—' : pad3(sensorState.track);
  sensorCells.alt.textContent = sensorState.alt == null ? '—' : sensorState.alt.toLocaleString();
  sensorCells.acc.textContent = sensorState.acc == null ? '—' : sensorState.acc;
  renderSensorGOnly();
}

function renderSensorGOnly() {
  const el = sensorCells.gforce;
  el.classList.remove('peak', 'alarm');
  // decide live vs. peak mode
  const post = sensorState.landedAt > 0;
  if (post && sensorState.peakG != null) {
    el.textContent = sensorState.peakG.toFixed(2);
    el.classList.add('peak');
    gLabel.textContent = 'G PEAK';
    gUnit.textContent = 'last 2 min';
    if (sensorState.peakG >= 1.8) el.classList.add('alarm');
  } else if (sensorState.currentG != null) {
    el.textContent = sensorState.currentG.toFixed(2);
    gLabel.textContent = 'G';
    gUnit.textContent = 'g';
  } else {
    el.textContent = '—';
    gLabel.textContent = 'G';
    gUnit.textContent = 'g';
  }
}

enableBtn.addEventListener('click', async () => {
  enableBtn.disabled = true;
  setSensorStatus('Enabling…');
  startGPS();
  await startMotion();
  const parts = [];
  if (sensorState.geoActive) parts.push('GPS ON');
  if (sensorState.motionActive) parts.push('Motion ON');
  setSensorStatus(parts.length ? parts.join(' · ') : 'Sensors unavailable');
  if (parts.length) enableBtn.hidden = true;
  enableBtn.disabled = false;
});

// Add a double-tap on the G cell to reset the touchdown state (useful for
// repeated landings without reloading the app).
sensorCells.gforce.addEventListener('dblclick', () => {
  sensorState.gsSeenAbove60 = false;
  sensorState.landedAt = 0;
  sensorState.peakG = null;
  sensorState.gBuffer.length = 0;
  renderSensorGOnly();
});

/* ─── Service worker registration ──────────────────────────────────────── */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* silently ignore on file:// */ });
  });
}

/* ─── Boot ─────────────────────────────────────────────────────────────── */

(async function boot() {
  try {
    await loadQRH();
  } catch (e) {
    resultEl.innerHTML = `<div class="phase-warn">Failed to load QRH data. Reload the page.</div>`;
    return;
  }
  buildSubControls();
  render();
})();

/* When phase changes we may need to (re)build sub-controls */
document.querySelectorAll('.phase-tab').forEach(btn => {
  btn.addEventListener('click', () => buildSubControls());
});
document.querySelectorAll('.seg-btn[data-variant]').forEach(btn => {
  btn.addEventListener('click', () => buildSubControls());
});
