// app.js — Sky Monkeys orchestration. Wires the data layer, soaring physics,
// charts and the map to the UI. Vanilla ES modules, no framework.

import { fetchForecast, groupByDay, MODELS, reverseLabel } from './modules/meteo.js';
import { deriveHour, summariseDay } from './modules/soaring.js';
import { drawTimeHeight, drawWindProfile, liftColor } from './modules/chart.js';
import * as U from './modules/units.js';
import * as Loc from './modules/location.js';
import * as XMap from './modules/map.js';
import { installResumeHardening } from './modules/resume.js';

// Default point if we have no saved location and GPS is unavailable:
// Ölüdeniz / Babadağ — an easy-to-recognise flying site.
const DEFAULT_LOC = { name: 'Babadağ, Turkey', lat: 36.55, lon: 29.13 };

const savedModel = localStorage.getItem('xcsky.model');
const state = {
  loc: Loc.loadLast() || DEFAULT_LOC,
  // Reset any saved model that's no longer offered (e.g. ECMWF/ICON, which
  // lack boundary-layer height and so produce an all-zero forecast).
  model: MODELS.some((m) => m.id === savedModel) ? savedModel : 'best_match',
  forecast: null,
  days: [],
  dayIndex: 0,
  hourIndex: null,   // index into the selected day's hours
  loading: false,
};

const $ = (id) => document.getElementById(id);

// ── boot ────────────────────────────────────────────────────────────────────
function boot() {
  populateModelSelect();
  syncUnitsButton();
  wireEvents();
  installResumeHardening(() => { if (!state.loading) refresh(true); });

  // If we have no saved location, try GPS once (falls back to default silently).
  if (!Loc.loadLast()) {
    Loc.geolocate()
      .then((loc) => { state.loc = loc; Loc.saveLast(loc); renderLocName(); refresh(); })
      .catch(() => { renderLocName(); refresh(); });
  } else {
    renderLocName();
    refresh();
  }
}

function populateModelSelect() {
  const sel = $('model-select');
  sel.innerHTML = MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
  sel.value = state.model;
}

// ── data ─────────────────────────────────────────────────────────────────────
async function refresh(quiet = false) {
  if (state.loading) return;
  state.loading = true;
  if (!quiet) setStatus('Loading forecast…', 'loading');
  try {
    const fc = await fetchForecast({ lat: state.loc.lat, lon: state.loc.lon, model: state.model, days: 7 });
    state.forecast = fc;
    state.days = groupByDay(fc);
    if (state.dayIndex >= state.days.length) state.dayIndex = 0;
    pickDefaultHour();
    clearStatus();
    renderAll();
  } catch (err) {
    console.error(err);
    setStatus(`Couldn't load forecast: ${err.message}. Tap to retry.`, 'error', () => refresh());
  } finally {
    state.loading = false;
  }
}

/** Default the hour scrubber to the best hour of the selected day. */
function pickDefaultHour() {
  const day = state.days[state.dayIndex];
  if (!day) { state.hourIndex = null; return; }
  const now = new Date();
  const isToday = day.dayKey === now.toISOString().slice(0, 10);
  const { bestHour } = summariseDay(day.hours, state.forecast.elevation);
  let idx = bestHour ? day.hours.findIndex((h) => h.iso === bestHour.iso) : -1;
  if (isToday) {
    const cur = day.hours.findIndex((h) => h.hourOfDay >= now.getHours());
    if (cur >= 0) idx = cur;
  }
  state.hourIndex = idx >= 0 ? idx : Math.min(13, day.hours.length - 1);
}

// ── render ───────────────────────────────────────────────────────────────────
function renderAll() {
  renderDayTabs();
  renderSummary();
  renderCharts();
  renderLegend();
  syncSlider();
  renderDetail();
}

function renderLocName() { $('loc-name').textContent = state.loc.name; }

function renderDayTabs() {
  const tabs = $('day-tabs');
  tabs.innerHTML = '';
  state.days.forEach((day, i) => {
    const s = summariseDay(day.hours, state.forecast.elevation);
    const btn = document.createElement('button');
    btn.className = 'day-tab' + (i === state.dayIndex ? ' active' : '');
    const score = s.best ? s.best.flyable.score : 0;
    btn.innerHTML = `
      <span class="day-tab-name">${U.dayLabel(day.date)}</span>
      <span class="day-tab-dot" style="background:${flyColor(score)}"></span>
      <span class="day-tab-climb">${s.maxClimb >= 0.3 ? s.maxClimb.toFixed(1) : '·'}</span>`;
    btn.onclick = () => { state.dayIndex = i; pickDefaultHour(); renderAll(); };
    tabs.appendChild(btn);
  });
}

function renderSummary() {
  const day = state.days[state.dayIndex];
  const el = $('summary');
  if (!day) { el.innerHTML = ''; return; }
  const terrain = state.forecast.elevation;
  const s = summariseDay(day.hours, terrain);
  const score = s.best ? s.best.flyable.score : 0;
  const label = s.best ? s.best.flyable.label : '—';
  const win = (s.firstSoarable != null)
    ? `${String(s.firstSoarable).padStart(2, '0')}:00–${String(s.lastSoarable).padStart(2, '0')}:00`
    : 'No soarable window';
  el.innerHTML = `
    <div class="summary-score" style="--fly:${flyColor(score)}">
      <div class="summary-ring" style="background:conic-gradient(${flyColor(score)} ${score * 3.6}deg, var(--track) 0)">
        <span>${score}</span>
      </div>
      <div class="summary-label">${label}</div>
    </div>
    <div class="summary-stats">
      <div><span class="k">Soarable</span><span class="v">${win}</span></div>
      <div><span class="k">Max thermal</span><span class="v">${U.climb(s.maxClimb)}</span></div>
      <div><span class="k">Max top</span><span class="v">${U.alt(s.maxTop)}</span></div>
      <div><span class="k">Terrain</span><span class="v">${U.alt(terrain)}</span></div>
    </div>`;
}

function renderCharts() {
  const day = state.days[state.dayIndex];
  if (!day) return;
  const terrain = state.forecast.elevation;
  const th = $('th-chart');
  chartHit = drawTimeHeight(th, day, terrain, { height: 260, selectedIndex: state.hourIndex });
  const hr = day.hours[state.hourIndex];
  if (hr) drawWindProfile($('wind-chart'), hr, terrain, { height: 260 });
}

let chartHit = null;

function renderLegend() {
  const items = [
    ['0.5', 'weak'], ['1.0', ''], ['1.5', 'good'], ['2.0', ''], ['3.0', 'strong'],
  ];
  $('legend').innerHTML =
    `<span class="legend-title">Climb m/s</span>` +
    items.map(([v, lab]) =>
      `<span class="legend-item"><i style="background:${liftColor(+v)}"></i>${v}${lab ? ' ' + lab : ''}</span>`
    ).join('');
}

function renderDetail() {
  const day = state.days[state.dayIndex];
  const el = $('detail');
  if (!day || state.hourIndex == null) { el.innerHTML = ''; return; }
  const terrain = state.forecast.elevation;
  const hr = day.hours[state.hourIndex];
  const d = deriveHour(hr, terrain);

  const cloud = d.cumulus
    ? `Cu ${U.alt(d.cloudBase)}`
    : (d.blDepth ? 'Blue' : '—');
  const windTop = topWind(hr, terrain);
  const stars = '★'.repeat(d.stars) + '☆'.repeat(5 - d.stars);

  const cards = [
    ['Thermal top', U.alt(d.thermalTop), sub(`${U.alt(d.band)} band`)],
    ['Cloud base', cloud, sub(d.cumulus ? 'cumulus' : 'no cu')],
    ['Climb', U.climb(d.climb), `<span class="stars">${stars}</span>`],
    ['Surface wind', `${U.compass(hr.windDir10)} ${U.wind(hr.wind10)}`, sub(`gust ${U.wind(hr.gust10)}`)],
    ['Wind @ top', windTop ? `${U.compass(windTop.dir)} ${U.wind(windTop.spd)}` : '—', sub('at working top')],
    ['Freezing lvl', U.alt(hr.freezingLevel), sub(`${U.temp(hr.t2m)} surface`)],
    ['Over-dev risk', `${d.overdevelopment}%`, riskBar(d.overdevelopment)],
    ['Flyability', `${d.flyable.score}`, sub(d.flyable.label)],
  ];
  el.innerHTML = cards.map(([k, v, extra]) => `
    <div class="detail-card">
      <div class="dc-k">${k}</div>
      <div class="dc-v">${v}</div>
      <div class="dc-x">${extra || ''}</div>
    </div>`).join('');
}

const sub = (s) => `<span class="dc-sub">${s}</span>`;
function riskBar(pct) {
  const c = pct > 60 ? '#e0453f' : pct > 35 ? '#f2c14e' : '#2f9e6f';
  return `<span class="risk-bar"><i style="width:${pct}%;background:${c}"></i></span>`;
}

/** Wind at (nearest pressure level to) the working top. */
function topWind(hr, terrain) {
  const d = deriveHour(hr, terrain);
  const target = d.workingTop || (terrain + 1500);
  let best = null, bestGap = Infinity;
  for (const lv of hr.levels) {
    if (lv.spd == null) continue;
    const gap = Math.abs(lv.z - target);
    if (gap < bestGap) { bestGap = gap; best = lv; }
  }
  return best;
}

function syncSlider() {
  const day = state.days[state.dayIndex];
  const slider = $('hour-slider');
  if (!day) return;
  slider.min = '0';
  slider.max = String(day.hours.length - 1);
  slider.value = String(state.hourIndex ?? 0);
  updateHourReadout();
}

function updateHourReadout() {
  const day = state.days[state.dayIndex];
  if (!day || state.hourIndex == null) return;
  const hr = day.hours[state.hourIndex];
  const d = deriveHour(hr, state.forecast.elevation);
  $('hour-readout').innerHTML =
    `<b>${U.hourLabel(hr.time)}</b> · ${U.climb(d.climb)} · ${U.alt(d.workingTop)}`;
}

// ── flyability colour ─────────────────────────────────────────────────────────
function flyColor(score) {
  if (score >= 75) return '#7cc143';
  if (score >= 55) return '#a7c957';
  if (score >= 35) return '#f2c14e';
  if (score >= 18) return '#ef7d3b';
  return '#8a93a6';
}

// ── status banner ─────────────────────────────────────────────────────────────
function setStatus(msg, kind, onClick) {
  const el = $('status');
  el.textContent = msg;
  el.className = `status ${kind}`;
  el.onclick = onClick || null;
  el.style.cursor = onClick ? 'pointer' : 'default';
}
function clearStatus() { $('status').className = 'status hidden'; }

// ── events ────────────────────────────────────────────────────────────────────
function wireEvents() {
  $('units-btn').onclick = () => { U.toggleSystem(); syncUnitsButton(); renderAll(); };
  $('model-select').onchange = (e) => {
    state.model = e.target.value;
    localStorage.setItem('xcsky.model', state.model);
    refresh();
  };

  const slider = $('hour-slider');
  slider.oninput = () => {
    state.hourIndex = +slider.value;
    updateHourReadout();
    renderCharts();
    renderDetail();
  };

  // Tap/drag the time-height chart to select an hour.
  const th = $('th-chart');
  const pick = (clientX) => {
    if (!chartHit) return;
    const rect = th.getBoundingClientRect();
    state.hourIndex = chartHit.hourAtX(clientX - rect.left);
    $('hour-slider').value = String(state.hourIndex);
    updateHourReadout(); renderCharts(); renderDetail();
  };
  th.addEventListener('pointerdown', (e) => { pick(e.clientX); th.setPointerCapture(e.pointerId); });
  th.addEventListener('pointermove', (e) => { if (e.buttons) pick(e.clientX); });

  // Redraw charts on resize (canvas is CSS-sized).
  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderCharts, 150); });

  wireLocationSheet();
  wireMapView();
}

function syncUnitsButton() {
  $('units-btn').textContent = U.getSystem() === 'imperial' ? 'ft · kt' : 'm · km/h';
}

// ── location sheet ────────────────────────────────────────────────────────────
function wireLocationSheet() {
  const sheet = $('loc-sheet');
  const open = () => { sheet.classList.remove('hidden'); renderSaved(); $('search-input').focus(); };
  const close = () => { sheet.classList.add('hidden'); $('search-results').innerHTML = ''; $('search-input').value = ''; };
  $('loc-btn').onclick = open;
  $('loc-close').onclick = close;
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });

  // Debounced search.
  let searchT = null;
  $('search-input').addEventListener('input', (e) => {
    clearTimeout(searchT);
    const q = e.target.value;
    searchT = setTimeout(async () => {
      if (q.trim().length < 2) { $('search-results').innerHTML = ''; return; }
      try {
        const results = await Loc.search(q);
        $('search-results').innerHTML = results.map((r, i) =>
          `<button class="result" data-i="${i}">${r.name}</button>`).join('') || '<div class="result-empty">No matches</div>';
        $('search-results').querySelectorAll('.result').forEach((b, i) => {
          b.onclick = () => { setLocation(results[i], true); close(); };
        });
      } catch { $('search-results').innerHTML = '<div class="result-empty">Search failed</div>'; }
    }, 350);
  });

  $('use-gps').onclick = async () => {
    setStatus('Getting your location…', 'loading');
    try {
      const loc = await Loc.geolocate();
      clearStatus(); setLocation(loc, true); close();
    } catch (err) { setStatus(err.message, 'error'); setTimeout(clearStatus, 2500); }
  };

  $('pick-map-btn').onclick = () => { close(); openMapView(); };
}

function renderSaved() {
  const spots = Loc.loadSpots();
  const list = $('saved-list');
  // Offer to save the current spot if it isn't already saved.
  const cur = state.loc;
  const saveBtn = `<button class="save-current" id="save-current">+ Save “${cur.name}”</button>`;
  if (!spots.length) {
    list.innerHTML = saveBtn + '<div class="result-empty">No saved spots yet</div>';
  } else {
    list.innerHTML = saveBtn + spots.map((s, i) => `
      <div class="saved-item">
        <button class="saved-go" data-i="${i}">${s.name}</button>
        <button class="saved-del" data-i="${i}" aria-label="Remove">✕</button>
      </div>`).join('');
    list.querySelectorAll('.saved-go').forEach((b, i) => {
      b.onclick = () => { setLocation(spots[i], false); $('loc-sheet').classList.add('hidden'); };
    });
    list.querySelectorAll('.saved-del').forEach((b, i) => {
      b.onclick = () => { Loc.removeSpot(spots[i]); renderSaved(); };
    });
  }
  $('save-current').onclick = () => { Loc.addSpot(cur); renderSaved(); };
}

// ── full-screen map (bases + KK7 overlays + live pilots) ─────────────────────
let mapPicked = null;

function openMapView() {
  const view = $('map-view');
  view.classList.remove('hidden');
  mapPicked = { ...state.loc };
  $('map-coords').textContent = `${state.loc.lat.toFixed(3)}, ${state.loc.lon.toFixed(3)}`;
  // Wait a frame so the container has its full-screen size before Leaflet measures.
  requestAnimationFrame(() => {
    XMap.openMap('bigmap', {
      center: state.loc,
      onPick: (p) => { mapPicked = p; $('map-coords').textContent = `${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`; },
    });
  });
}

function wireMapView() {
  $('map-btn').onclick = openMapView;
  $('map-close').onclick = () => { $('map-view').classList.add('hidden'); XMap.closeMap(); };
  $('map-confirm').onclick = async () => {
    if (mapPicked) {
      const name = await reverseLabel(mapPicked.lat, mapPicked.lon).catch(() => '');
      setLocation({ name: name || `${mapPicked.lat.toFixed(2)}, ${mapPicked.lon.toFixed(2)}`, lat: mapPicked.lat, lon: mapPicked.lon }, false);
    }
    $('map-view').classList.add('hidden');
    XMap.closeMap();
  };
  $('pilots-filter').onclick = () => {
    const soaring = !XMap.getSoaringOnly();
    XMap.setSoaringOnly(soaring);
    $('pilots-filter').textContent = soaring ? '🪂 soaring' : '✈️ all traffic';
  };
  document.addEventListener('pilots', (e) => {
    const { count, total } = e.detail;
    $('pilot-count').textContent =
      count === total ? `${count} live pilots (OGN)` : `${count} soaring · ${total} total (OGN)`;
  });
}

function setLocation(loc, saveLast) {
  state.loc = { name: loc.name, lat: loc.lat, lon: loc.lon };
  state.dayIndex = 0;
  if (saveLast !== false) Loc.saveLast(state.loc);
  else Loc.saveLast(state.loc);
  renderLocName();
  refresh();
}

// ── service worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline still fine */ });
  });
}

boot();
