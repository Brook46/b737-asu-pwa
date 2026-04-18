/* Airspeed Unreliable — B737NG PWA (v2)
 * Source: D6-27370-858-ELA Rev.57 · PI-QRH §10 (4X-EK fleet)
 *
 * Architecture:
 *  - `state` holds all user selections, persisted to localStorage.
 *  - QRH data loaded once from data/qrh-{variant}.json; single source of truth.
 *  - render() rewrites the result card from state + data — pure.
 *  - Sensors lazy-start on user-gesture ack of memory-items modal (iOS rule).
 *  - G-force has a touchdown state machine: live → peak when GS drops < 60 kt
 *    after having been above 60 kt.
 */

'use strict';

/* ─── Persistence keys ─────────────────────────────────────────── */
const STORE_KEY = 'asu.state.v2';
const DISCLAIMER_KEY = 'asu.disclaimerAck.v1';
const THEME_KEY = 'asu.theme.v1';

/* ─── State ────────────────────────────────────────────────────── */
const defaultState = {
  variant: null,     // null | '800' | '900' — null = user hasn't picked
  phase: 'climb',
  weight: 65.0,
  aptAlt: 5000,      // default airport altitude — common DA/MDA region
};
const state = Object.assign({}, defaultState, loadJSON(STORE_KEY, {}));

function loadJSON(k, fb) {
  try { return JSON.parse(localStorage.getItem(k)) ?? fb; }
  catch { return fb; }
}
function saveState() { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

/* ─── QRH data ─────────────────────────────────────────────────── */
const qrh = {};
async function loadQRH() {
  const [d800, d900] = await Promise.all([
    fetch('data/qrh-800.json').then(r => r.json()),
    fetch('data/qrh-900.json').then(r => r.json()),
  ]);
  qrh['800'] = d800;
  qrh['900'] = d900;
}

/* ─── Utilities ────────────────────────────────────────────────── */
const MIN_W = 40, MAX_W = 80;
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const fmtPitch = p => p == null ? '—' : (p >= 0 ? '+' : '') + p.toFixed(1) + '°';
const fmtN1    = n => n == null ? '—' : n.toFixed(1) + ' %';
const fmtVS    = v => v == null ? '—' : (v > 0 ? '+' : '') + Math.round(v).toLocaleString();
const fmtKIAS  = k => k == null ? '—' : String(Math.round(k));
const fmtAlt   = a => a === 0 ? 'Sea Level' : (a > 0 ? '+' : '') + a.toLocaleString() + ' ft';

const sortAsc = rows => rows.slice().sort((a, b) => a.alt - b.alt);

/** Linear-interpolate a per-weight array (5 entries, 40..80 t in 10 t steps)
 * at arbitrary weight `w`. Null-safe: if one side is null, return the other;
 * if both null, return null. */
function interpWeight(arr, w) {
  if (!arr || arr.length === 0) return null;
  const x = clamp((w - MIN_W) / 10, 0, 4);
  const lo = Math.floor(x);
  const hi = Math.min(lo + 1, 4);
  const f = x - lo;
  const vLo = arr[lo], vHi = arr[hi];
  if (vLo == null && vHi == null) return null;
  if (vLo == null) return vHi;
  if (vHi == null) return vLo;
  return vLo + f * (vHi - vLo);
}

/* ─── Theme button ─────────────────────────────────────────────── */
const themeBtn   = $('#theme-btn');
const themeIcon  = $('#theme-icon');
const themeLabel = $('#theme-label');
const mq = window.matchMedia('(prefers-color-scheme: dark)');

const THEME_ICONS = {
  auto: `
    <circle cx="12" cy="12" r="8"/>
    <path d="M12 4 A8 8 0 0 1 12 20 Z" class="fill"/>`,
  light: `
    <circle cx="12" cy="12" r="4" class="fill"/>
    <line x1="12" y1="2.3" x2="12" y2="5.3"/>
    <line x1="12" y1="18.7" x2="12" y2="21.7"/>
    <line x1="2.3" y1="12" x2="5.3" y2="12"/>
    <line x1="18.7" y1="12" x2="21.7" y2="12"/>
    <line x1="4.9"  y1="4.9"  x2="7"    y2="7"/>
    <line x1="17"   y1="17"   x2="19.1" y2="19.1"/>
    <line x1="4.9"  y1="19.1" x2="7"    y2="17"/>
    <line x1="17"   y1="7"    x2="19.1" y2="4.9"/>`,
  dark: `
    <path d="M20.2 14.3 A7.5 7.5 0 1 1 9.7 3.8 A6 6 0 0 0 20.2 14.3 Z" class="fill"/>`,
};

function applyTheme() {
  const mode = localStorage.getItem(THEME_KEY) || 'auto';
  const isDark = mode === 'dark' || (mode === 'auto' && mq.matches);
  document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
  themeIcon.innerHTML = THEME_ICONS[mode] || THEME_ICONS.auto;
  themeLabel.textContent = mode[0].toUpperCase() + mode.slice(1);
  const meta = document.querySelector('meta[name="theme-color"]:not([media])');
  if (meta) meta.setAttribute('content', isDark ? '#0b1016' : '#f2f3f5');
}
themeBtn.addEventListener('click', () => {
  const cur = localStorage.getItem(THEME_KEY) || 'auto';
  const next = { auto: 'light', light: 'dark', dark: 'auto' }[cur];
  localStorage.setItem(THEME_KEY, next);
  applyTheme();
});
mq.addEventListener('change', applyTheme);
applyTheme();

/* ─── Modals ───────────────────────────────────────────────────── */
const disclaimerEl = $('#disclaimer');
const memoryEl     = $('#memory-modal');

function showDisclaimer() {
  return new Promise(resolve => {
    if (localStorage.getItem(DISCLAIMER_KEY) === '1') { resolve(); return; }
    disclaimerEl.setAttribute('aria-hidden', 'false');
    $('#disclaimer-ack').addEventListener('click', () => {
      localStorage.setItem(DISCLAIMER_KEY, '1');
      disclaimerEl.setAttribute('aria-hidden', 'true');
      resolve();
    }, { once: true });
  });
}

// Shown every launch; starts sensors synchronously inside the user gesture.
function showMemoryItems() {
  memoryEl.setAttribute('aria-hidden', 'false');
  $('#memory-ack').addEventListener('click', () => {
    memoryEl.setAttribute('aria-hidden', 'true');
    // Kick off sensors inside the user-gesture so iOS accepts requestPermission.
    startGPS();
    startMotion();
  }, { once: true });
}

/* ─── Variant picker ───────────────────────────────────────────── */
const variantCard = $('.variant-card');
function updateVariantUI() {
  $$('.variant-opt').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.variant === state.variant));
  });
  variantCard.classList.toggle('selected', !!state.variant);
}
$$('.variant-opt').forEach(btn => {
  btn.addEventListener('click', () => {
    state.variant = btn.dataset.variant;
    saveState();
    updateVariantUI();
    buildSubControls();
    render();
  });
});
updateVariantUI();

/* ─── Phase tabs ───────────────────────────────────────────────── */
$$('.phase-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    state.phase = btn.dataset.phase;
    saveState();
    updatePhaseUI();
    buildSubControls();
    render();
  });
});
function updatePhaseUI() {
  $$('.phase-tab').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset.phase === state.phase));
  });
}
updatePhaseUI();

/* ─── Weight input ─────────────────────────────────────────────── */
const weightInput   = $('#weight');
const weightSlider  = $('#weight-slider');
const weightFill    = $('#weight-fill');
const weightThumb   = $('#weight-thumb');

function setWeight(w, { save = true, sync = true } = {}) {
  const nw = clamp(Number(w), MIN_W, MAX_W);
  if (!Number.isFinite(nw)) return;
  state.weight = Math.round(nw * 10) / 10;
  if (sync) weightInput.value = state.weight.toFixed(1);
  updateSliderUI();
  if (save) saveState();
  render();
}

function updateSliderUI() {
  const pct = (state.weight - MIN_W) / (MAX_W - MIN_W);
  weightFill.style.width = (pct * 100) + '%';
  weightThumb.style.left = (pct * 100) + '%';
}

weightInput.value = state.weight.toFixed(1);
updateSliderUI();

// Tap the number → clear it so user can type a new value.
weightInput.addEventListener('focus', () => {
  weightInput.value = '';
});
// Commit only on blur / Enter — avoids re-renders on every keystroke.
weightInput.addEventListener('blur', () => {
  const v = parseFloat((weightInput.value || '').replace(',', '.'));
  if (!Number.isFinite(v)) weightInput.value = state.weight.toFixed(1);
  else setWeight(v);
});
weightInput.addEventListener('keydown', e => {
  if (e.key === 'Enter') weightInput.blur();
});

// Horizontal slider drag
(() => {
  const track = weightSlider.querySelector('.weight-slider-track');
  let dragging = false;
  function posToWeight(clientX) {
    const r = track.getBoundingClientRect();
    const f = clamp((clientX - r.left) / r.width, 0, 1);
    return Math.round((MIN_W + f * (MAX_W - MIN_W)) * 10) / 10;
  }
  track.addEventListener('pointerdown', e => {
    dragging = true;
    track.setPointerCapture(e.pointerId);
    setWeight(posToWeight(e.clientX), { save: false });
    e.preventDefault();
  });
  track.addEventListener('pointermove', e => {
    if (!dragging) return;
    setWeight(posToWeight(e.clientX), { save: false });
  });
  const endDrag = e => {
    if (!dragging) return;
    dragging = false;
    try { track.releasePointerCapture(e.pointerId); } catch {}
    saveState();
  };
  track.addEventListener('pointerup', endDrag);
  track.addEventListener('pointercancel', endDrag);
  // Tick labels → jump to tick value
  $$('.weight-slider-ticks span').forEach(el => {
    el.addEventListener('click', () => setWeight(Number(el.dataset.tick)));
  });
})();

/* ─── Sub-controls (airport altitude only now) ─────────────────── */
const subCard = $('#sub-controls');

function buildSubControls() {
  subCard.innerHTML = '';
  if (!state.variant) { subCard.hidden = true; return; }
  const needsApt = state.phase === 'terminal' || state.phase === 'approach' || state.phase === 'go_around';
  if (!needsApt) { subCard.hidden = true; return; }

  // Pull the full airport-altitude list from the Terminal dataset (most granular).
  // Terminal/Approach look up an exact row; Go-Around snaps to the nearest GA altitude
  // to highlight the matching row.
  const terminalData = qrh[state.variant].terminal || [];
  const alts = terminalData.map(r => r.apt_alt);
  if (!alts.includes(state.aptAlt)) {
    state.aptAlt = alts.includes(5000) ? 5000 : (alts.includes(0) ? 0 : alts[0]);
    saveState();
  }

  subCard.classList.add('apt-card');
  subCard.innerHTML = `
    <span class="section-label">Airport altitude</span>
    <div class="apt-select-wrap">
      <select id="apt-alt-select" class="apt-select" aria-label="Airport altitude">
        ${alts.map(a =>
          `<option value="${a}"${a === state.aptAlt ? ' selected' : ''}>${
            a === 0 ? 'Sea Level' : (a > 0 ? '+' : '') + a.toLocaleString() + ' ft'
          }</option>`
        ).join('')}
      </select>
      <span class="apt-caret" aria-hidden="true">▾</span>
    </div>`;
  subCard.hidden = false;
  const sel = document.getElementById('apt-alt-select');
  sel.addEventListener('change', () => {
    state.aptAlt = Number(sel.value);
    saveState();
    render();
  });
}

/* ─── Rendering ────────────────────────────────────────────────── */
const resultEl = $('#result');
const sourceEl = $('#source-cite');

function render() {
  if (!state.variant) {
    resultEl.innerHTML = `
      <div class="result-empty">
        <div class="chev">↑</div>
        <div><strong>Select aircraft variant</strong> above to begin.</div>
        <div style="font-size:.8rem; opacity:.8;">Tap −800W or −900ERW</div>
      </div>`;
    sourceEl.textContent = '';
    return;
  }
  if (!qrh[state.variant]) return;

  const d = qrh[state.variant];
  const vName = state.variant === '800' ? '737‑800W' : '737‑900ERW';
  const w = state.weight;
  const wStr = w.toFixed(1) + ' t';

  let body = '', source = '';
  const header = (title, sub) => `
    <div class="result-header">
      <span class="result-title">${title}</span>
      <span class="result-dot">·</span><span>${sub}</span>
    </div>`;

  switch (state.phase) {
    case 'climb':
      body = header(`${vName} · Climb`, wStr) +
        `<div class="phase-note">${d.notes.climb}</div>` +
        renderAltPitchMetric(sortAsc(d.climb), w, 'vs', 'V/S fpm');
      source = `${d.source} · PI-QRH §10 CLIMB`;
      break;
    case 'cruise':
      body = header(`${vName} · Cruise`, wStr) +
        `<div class="phase-note">${d.notes.cruise}</div>` +
        renderAltPitchMetric(sortAsc(d.cruise), w, 'n1', 'N1 %');
      source = `${d.source} · PI-QRH §10 CRUISE`;
      break;
    case 'descent':
      body = header(`${vName} · Descent`, wStr) +
        `<div class="phase-note">${d.notes.descent}</div>` +
        renderAltPitchMetric(sortAsc(d.descent), w, 'vs', 'V/S fpm');
      source = `${d.source} · PI-QRH §10 DESCENT`;
      break;
    case 'holding':
      body = header(`${vName} · Holding`, wStr) +
        `<div class="phase-note">${d.notes.holding}</div>` +
        renderHolding(sortAsc(d.holding), w);
      source = `${d.source} · PI-QRH §10 HOLDING`;
      break;
    case 'terminal': {
      const row = d.terminal.find(r => r.apt_alt === state.aptAlt) || d.terminal[0];
      body = header(`${vName} · Terminal 5,000 ft AGL`,
        `${wStr} · Airport ${fmtAlt(row.apt_alt)}`) +
        `<div class="phase-note">${d.notes.terminal}</div>` +
        renderConfig(row.flaps, w, { highlightGearDown: true });
      source = `${d.source} · PI-QRH §10 TERMINAL AREA`;
      break;
    }
    case 'approach': {
      const row = d.approach.find(r => r.apt_alt === state.aptAlt) || d.approach[0];
      body = header(`${vName} · Final Approach 1,500 ft AGL`,
        `${wStr} · Airport ${fmtAlt(row.apt_alt)}`) +
        `<div class="phase-note">${d.notes.approach}</div>` +
        renderConfig(row.flaps, w, { highlightGearDown: false });
      source = `${d.source} · PI-QRH §10 FINAL APPROACH`;
      break;
    }
    case 'go_around':
      body = header(`${vName} · Go‑Around`,
        `${wStr} · Gear Up · Airport ${fmtAlt(state.aptAlt)}`) +
        `<div class="phase-note">${d.notes.go_around} — Flaps 5 is only authorized with the Alternate Go‑Around and Missed Approach procedure.</div>` +
        renderGoAround(d.go_around, w, state.aptAlt);
      source = `${d.source} · PI-QRH §10 GO-AROUND`;
      break;
  }

  resultEl.innerHTML = body;
  sourceEl.textContent = source;
}

/* Render: altitude × (pitch + metric) — climb / cruise / descent */
function renderAltPitchMetric(rows, w, metricKey, metricLabel) {
  const isVS = metricKey === 'vs';
  const fmtMetric = isVS ? fmtVS : fmtN1;
  const body = rows.map(r => {
    const p = interpWeight(r.pitch, w);
    const m = interpWeight(r[metricKey], w);
    const mClass = 'val' +
      (isVS && m != null && m < 0 ? ' neg' : '') +
      (m == null ? ' no-data' : '');
    const pClass = 'val' + (p == null ? ' no-data' : '');
    return `<tr>
      <td class="row-label">${fmtAlt(r.alt)}</td>
      <td class="${pClass}">${fmtPitch(p)}</td>
      <td class="${mClass}">${fmtMetric(m)}</td>
    </tr>`;
  }).join('');
  return `<table class="qrh-table">
    <thead><tr><th class="row-label">Altitude</th><th>Pitch</th><th>${metricLabel}</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function renderHolding(rows, w) {
  const body = rows.map(r => {
    const p = interpWeight(r.pitch, w);
    const n = interpWeight(r.n1,    w);
    const k = interpWeight(r.kias,  w);
    return `<tr>
      <td class="row-label">${fmtAlt(r.alt)}</td>
      <td class="val${p == null ? ' no-data' : ''}">${fmtPitch(p)}</td>
      <td class="val${n == null ? ' no-data' : ''}">${fmtN1(n)}</td>
      <td class="val${k == null ? ' no-data' : ''}">${fmtKIAS(k)}</td>
    </tr>`;
  }).join('');
  return `<table class="qrh-table">
    <thead><tr><th class="row-label">Altitude</th><th>Pitch</th><th>N1</th><th>KIAS</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

function renderConfig(flaps, w, opts = {}) {
  const { highlightGearDown = false } = opts;
  // On Terminal: move Gear-Down to the top and visually highlight it — that's
  // the landing configuration and the most important operational reference.
  // On Final Approach: keep the original order (gear is already down on final).
  let ordered = flaps;
  if (highlightGearDown) {
    const gearDown = flaps.filter(f => f.gear === 'DOWN');
    const gearUp   = flaps.filter(f => f.gear !== 'DOWN');
    ordered = [...gearDown, ...gearUp];
  }

  const body = ordered.map(f => {
    const p = interpWeight(f.pitch, w);
    const n = interpWeight(f.n1,    w);
    const k = interpWeight(f.kias,  w);
    const isGD = f.gear === 'DOWN';
    const gearTag = isGD ? ' · GD'
                  : f.gear === 'UP' ? ' · GU'
                  : '';
    const label = `Flaps ${f.flap}${gearTag}` +
                  (f.vref ? `<span class="flap-sub">${f.vref}</span>` : '');
    const rowCls = (highlightGearDown && isGD) ? ' class="gear-down-row"' : '';
    return `<tr${rowCls}>
      <td class="row-label">${label}</td>
      <td class="val${p == null ? ' no-data' : ''}">${fmtPitch(p)}</td>
      <td class="val${n == null ? ' no-data' : ''}">${fmtN1(n)}</td>
      <td class="val${k == null ? ' no-data' : ''}">${fmtKIAS(k)}</td>
    </tr>`;
  }).join('');
  return `<table class="qrh-table">
    <thead><tr><th class="row-label">Configuration</th><th>Pitch</th><th>N1</th><th>KIAS</th></tr></thead>
    <tbody>${body}</tbody>
  </table>`;
}

/* Go-Around: columns = flaps 1/5/15 (all Gear Up), rows = altitude (asc).
 * Each altitude row shows 3 stacked metrics per flap column: pitch, V/S, KIAS.
 * aptAlt — if provided, snap to the nearest GA altitude and highlight that row. */
function renderGoAround(gaData, w, aptAlt) {
  const flaps = ['1', '5', '15'];
  const perFlap = flaps.map(k => sortAsc(gaData['flap_' + k] || []));
  const alts = perFlap[0].map(r => r.alt);
  // Snap aptAlt to the closest GA altitude band.
  let matchAlt = null;
  if (alts.length && aptAlt != null) {
    matchAlt = alts.reduce((best, a) =>
      Math.abs(a - aptAlt) < Math.abs(best - aptAlt) ? a : best, alts[0]);
  }
  const body = alts.map(alt => {
    const cells = flaps.map((_, i) => {
      const r = perFlap[i].find(x => x.alt === alt);
      if (!r) return { p: null, v: null, k: null };
      return {
        p: interpWeight(r.pitch, w),
        v: interpWeight(r.vs,    w),
        k: interpWeight(r.kias,  w),
      };
    });
    const pTR = cells.map(c => `<td class="val${c.p == null ? ' no-data' : ''}">${fmtPitch(c.p)}</td>`).join('');
    const vTR = cells.map(c => {
      const cls = 'val sub' + (c.v != null && c.v < 0 ? ' neg' : '') + (c.v == null ? ' no-data' : '');
      return `<td class="${cls}">${fmtVS(c.v)}</td>`;
    }).join('');
    const kTR = cells.map(c => `<td class="val sub${c.k == null ? ' no-data' : ''}">${fmtKIAS(c.k)}</td>`).join('');
    const hl = alt === matchAlt ? ' apt-match' : '';
    return `
      <tr class="stack-start${hl}"><td class="row-label" rowspan="3">${fmtAlt(alt)}</td>${pTR}</tr>
      <tr class="stack-mid${hl}">${vTR}</tr>
      <tr class="stack-end${hl}">${kTR}</tr>`;
  }).join('');
  return `<table class="qrh-table">
    <thead><tr><th class="row-label">Press. Alt</th><th>Flaps 1</th><th>Flaps 5</th><th>Flaps 15</th></tr></thead>
    <tbody>${body}</tbody>
  </table>
  <div class="source-cite" style="margin-top:.55rem;">Each altitude row: <strong>Pitch</strong> · <strong>V/S fpm</strong> · <strong>KIAS</strong>.</div>`;
}

/* ─── Procedure panel (22 steps; memory items boxed) ───────────── */
const MEMORY_STEPS = [
  ['Autopilot (if engaged)',          'Disengage'],
  ['Autothrottle (if engaged)',       'Disengage'],
  ['F/D switches (both)',             'OFF'],
  ['Set pitch attitude and thrust',   'Flaps Up: 4° / 75 % N1 · Flaps Extended: 10° / 80 % N1'],
];
const REMAINDER_STEPS = [
  ['PROBE HEAT switches',             'Check ON'],
  ['Reliable indications',            'Attitude · N1 · Ground speed · Radio altitude'],
  ['Choose',                          'Reliable indication found → step 11 · else → step 8'],
  ['Refer to PI‑QRH §10 tables',      'Set pitch + thrust for current config + phase'],
  ['In trim and stabilized',          'Compare CA / FO / standby airspeed vs table — >20 kt or >0.03 M = unreliable'],
  ['Choose',                          'Reliable found → 11 · Not → 12'],
  ['Choose',                          'CA/FO reliable → FD ON (reliable side) · Standby only → no AP/AT/FD'],
  ['Set pitch + thrust from §10',     'As needed'],
  ['Non-Normal Config Landing Dist.', 'Check PI‑QRH tables or approved source'],
  ['Autopilot (reliable side)',       'Engage if required'],
  ['Autothrottle',                    'Do not use'],
  ['Choose',                          'Reliable altitude → 17 · Both unreliable → 21 (no RVSM)'],
  ['RVSM airspace requirement',       'Airplane may not meet'],
  ['Transponder altitude source',     'Select reliable side per fleet'],
  ['Transponder mode selector',       'TA (per fleet)'],
  ['Transponder mode selector',       'TA ONLY (per fleet)'],
  ['Transponder altitude reporting',  'OFF per fleet'],
  ['Checklist complete',              'Except deferred items'],
];
const procBtn = $('#qrh-procedure-btn');
const procPanel = $('#qrh-procedure');
procBtn.addEventListener('click', () => {
  if (procPanel.hidden) {
    const memHTML = MEMORY_STEPS.map(([l, r]) =>
      `<li><strong>${l}</strong> — ${r}</li>`).join('');
    const remHTML = REMAINDER_STEPS.map(([l, r]) =>
      `<li><strong>${l}</strong>${r && r !== '—' ? ' — ' + r : ''}</li>`).join('');
    procPanel.innerHTML = `
      <div class="proc-memory">
        <ol>${memHTML}</ol>
      </div>
      <div class="proc-remainder">
        <h3>Reference items</h3>
        <ol start="5">${remHTML}</ol>
      </div>
      <p style="margin-top:.75rem;font-size:.75rem;color:var(--text-sub);">
        Paraphrased for quick reference. Always verify against the current approved QRH.
      </p>`;
    procPanel.hidden = false;
    procBtn.textContent = 'Hide QRH Procedure';
  } else {
    procPanel.hidden = true;
    procBtn.textContent = 'QRH Procedure (22 steps)';
  }
});

/* ─── Sensors ──────────────────────────────────────────────────── */
const sensor = {
  geoActive: false,
  motionActive: false,
  gs: null, track: null, alt: null, acc: null,
  currentG: null, peakG: null,
  gsSeenAbove60: false, landedAt: 0,
  gBuffer: [],
};
const MS_TO_KT = 1.94384, M_TO_FT = 3.28084;
const TOUCHDOWN_KT = 60, PEAK_WINDOW_MS = 120e3;

const sensorCells = {
  gs:     $('.sensor-cell[data-role="gs"] .sensor-value'),
  trk:    $('.sensor-cell[data-role="trk"] .sensor-value'),
  alt:    $('.sensor-cell[data-role="alt"] .sensor-value'),
  acc:    $('.sensor-cell[data-role="acc"] .sensor-value'),
  gforce: $('.sensor-cell[data-role="gforce"] .sensor-value'),
};
const gLabel = $('#g-label');
const gUnit = $('#g-unit');
const enableBtn = $('#enable-sensors');
const statusText = $('#sensor-status-text');

function setSensorStatus(t) { statusText.textContent = t || ''; }
function setClass(el, cls) {
  el.classList.remove('ok', 'amber', 'danger');
  if (cls) el.classList.add(cls);
}

/* Color buckets: G-force and GPS accuracy */
function gClass(g) {
  if (g == null) return '';
  if (g > 1.8) return 'danger';
  if (g > 1.4) return 'amber';
  if (g >= 0.5) return 'ok';
  return 'danger'; // near-zero g = free-fall / unusual attitude
}
function accClass(a) {
  if (a == null) return '';
  if (a <= 10) return 'ok';
  if (a <= 30) return 'amber';
  return 'danger';
}

function startGPS() {
  if (!('geolocation' in navigator) || sensor.geoActive) return;
  sensor.geoActive = true;
  navigator.geolocation.watchPosition(
    pos => {
      const s  = pos.coords.speed;
      const h  = pos.coords.heading;
      const a  = pos.coords.altitude;
      const ac = pos.coords.accuracy;
      sensor.gs    = (s != null && s >= 0) ? Math.round(s * MS_TO_KT) : null;
      sensor.track = (h != null && !Number.isNaN(h)) ? Math.round(((h % 360) + 360) % 360) : null;
      sensor.alt   = (a != null) ? Math.round(a * M_TO_FT) : null;
      sensor.acc   = (ac != null) ? Math.round(ac) : null;
      if (sensor.gs != null) {
        if (sensor.gs >= TOUCHDOWN_KT) sensor.gsSeenAbove60 = true;
        else if (sensor.gsSeenAbove60 && !sensor.landedAt) sensor.landedAt = Date.now();
      }
      renderSensors();
    },
    err => setSensorStatus('GPS: ' + (err.message || 'unavailable')),
    { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
  );
}

async function startMotion() {
  if (sensor.motionActive) return;
  try {
    if (typeof DeviceMotionEvent !== 'undefined' &&
        typeof DeviceMotionEvent.requestPermission === 'function') {
      const r = await DeviceMotionEvent.requestPermission();
      if (r !== 'granted') { setSensorStatus('Motion permission denied'); reportSensorStatus(); return; }
    }
  } catch {
    setSensorStatus('Motion unavailable'); reportSensorStatus(); return;
  }
  window.addEventListener('devicemotion', onMotion);
  sensor.motionActive = true;
  reportSensorStatus();
}

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a) return;
  const g = Math.sqrt((a.x || 0) ** 2 + (a.y || 0) ** 2 + (a.z || 0) ** 2) / 9.80665;
  if (!Number.isFinite(g)) return;
  // Guard: devices without a real accelerometer (e.g. desktop browsers) emit
  // events with all-zero acceleration. Treat near-zero magnitudes as no reading.
  if (g < 0.1) return;
  sensor.currentG = g;
  const now = Date.now();
  sensor.gBuffer.push({ t: now, g });
  const cutoff = now - PEAK_WINDOW_MS;
  while (sensor.gBuffer.length && sensor.gBuffer[0].t < cutoff) sensor.gBuffer.shift();
  let peak = 0;
  for (const s of sensor.gBuffer) if (s.g > peak) peak = s.g;
  sensor.peakG = peak;
  renderSensorG();
}

function renderSensors() {
  sensorCells.gs.textContent  = sensor.gs    == null ? '—' : sensor.gs;
  sensorCells.trk.textContent = sensor.track == null ? '—' : String(sensor.track).padStart(3, '0');
  sensorCells.alt.textContent = sensor.alt   == null ? '—' : sensor.alt.toLocaleString();
  sensorCells.acc.textContent = sensor.acc   == null ? '—' : sensor.acc;
  setClass(sensorCells.acc, accClass(sensor.acc));
  renderSensorG();
}
function renderSensorG() {
  const el = sensorCells.gforce;
  el.classList.remove('peak');
  const post = sensor.landedAt > 0;
  if (post && sensor.peakG != null) {
    el.textContent = sensor.peakG.toFixed(2);
    el.classList.add('peak');
    gLabel.textContent = 'G PEAK';
    gUnit.textContent  = 'last 2 min';
    setClass(el, gClass(sensor.peakG));
  } else if (sensor.currentG != null) {
    el.textContent = sensor.currentG.toFixed(2);
    gLabel.textContent = 'G'; gUnit.textContent = 'g';
    setClass(el, gClass(sensor.currentG));
  } else {
    el.textContent = '—';
    gLabel.textContent = 'G'; gUnit.textContent = 'g';
    setClass(el, '');
  }
}

function reportSensorStatus() {
  const parts = [];
  if (sensor.geoActive)    parts.push('GPS');
  if (sensor.motionActive) parts.push('Motion');
  if (parts.length) {
    setSensorStatus(parts.join(' · ') + ' active');
    enableBtn.hidden = true;
  } else {
    setSensorStatus('Tap to enable sensors');
    enableBtn.hidden = false;
  }
}

enableBtn.addEventListener('click', async () => {
  enableBtn.disabled = true;
  setSensorStatus('Enabling…');
  startGPS();
  await startMotion();
  reportSensorStatus();
  enableBtn.disabled = false;
});

// Double-tap the G cell to reset touchdown state (useful for repeat landings).
sensorCells.gforce.addEventListener('dblclick', () => {
  sensor.gsSeenAbove60 = false;
  sensor.landedAt = 0;
  sensor.peakG = null;
  sensor.gBuffer.length = 0;
  renderSensorG();
});

/* ─── Service worker ───────────────────────────────────────────── */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* no-op on file:// */ });
  });
}

/* ─── Boot ─────────────────────────────────────────────────────── */
(async function boot() {
  setSensorStatus('');
  try {
    await loadQRH();
  } catch {
    resultEl.innerHTML = `<div class="phase-warn">Failed to load QRH data. Reload the page.</div>`;
    return;
  }

  await showDisclaimer();
  showMemoryItems(); // non-blocking; sensors kick in on "Got it" click

  buildSubControls();
  render();

  // If motion permission never gets requested (non-iOS / no memory click), show enable button
  setTimeout(reportSensorStatus, 1500);
})();
