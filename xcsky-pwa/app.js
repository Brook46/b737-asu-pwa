// app.js — Sky Monkeys orchestration, map-first.
//
// The map with the gridded weather overlay IS the main screen (SkySight-style):
// pick a layer (thermals / top / base / wind), scrub day+hour, and the whole
// viewport re-colours instantly from the cached grid. Tap anywhere → the point
// forecast (time-height chart, wind profile, detail cards) opens as a bottom
// sheet. Vanilla ES modules, no framework.

import { fetchForecast, groupByDay, MODELS, reverseLabel } from './modules/meteo.js';
import { deriveHour, summariseDay } from './modules/soaring.js';
import { drawTimeHeight, drawWindProfile, liftColor } from './modules/chart.js';
import * as U from './modules/units.js';
import * as Loc from './modules/location.js';
import * as XMap from './modules/map.js';
import * as Grid from './modules/grid.js';
import * as Takeoffs from './modules/takeoffs.js';
import * as Plan from './modules/planning.js';
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
  layer: localStorage.getItem('xcsky.layer') || 'climb',
  forecast: null,      // point forecast for state.loc
  days: [],
  dayIndex: 0,
  hourIndex: null,     // index into the selected day's hours
  loading: false,
  takeoffsOn: false,
};

let tkLayer = null;      // Leaflet layer group for ranked takeoff markers
let tkSites = [];        // last-fetched launch sites for the viewport

const $ = (id) => document.getElementById(id);

// ── boot ────────────────────────────────────────────────────────────────────
function boot() {
  populateModelSelect();
  syncUnitsButton();
  renderLayerChips();
  wireEvents();
  installResumeHardening(() => { if (!state.loading) refreshAll(true); });

  const start = () => {
    renderLocName();
    XMap.initMainMap('bigmap', {
      center: state.loc,
      onPick: onMapPick,
    });
    Grid.watchMap(XMap.getMap(), () => state.model, renderOverlay);
    Plan.initPlanner(XMap.getMap(), { onChange: renderPlanStats });
    let tkT = null;
    XMap.getMap().on('moveend', () => {
      if (!state.takeoffsOn) return;
      clearTimeout(tkT);
      tkT = setTimeout(refreshTakeoffs, 600);
    });
    refreshAll();
  };

  // Leaflet loads deferred; wait for it before building the map.
  const waitL = () => (window.L ? afterGps(start) : setTimeout(waitL, 50));
  waitL();
}

/** Try GPS once when there's no saved location, then continue. */
function afterGps(next) {
  if (Loc.loadLast()) { next(); return; }
  Loc.geolocate()
    .then((loc) => { state.loc = loc; Loc.saveLast(loc); })
    .catch(() => { /* keep default */ })
    .finally(next);
}

function populateModelSelect() {
  const sel = $('model-select');
  sel.innerHTML = MODELS.map((m) => `<option value="${m.id}">${m.label}</option>`).join('');
  sel.value = state.model;
}

// ── data ─────────────────────────────────────────────────────────────────────
/** Refresh both the point forecast and the map grid. */
async function refreshAll(quiet = false) {
  if (state.loading) return;
  state.loading = true;
  if (!quiet) setStatus('Loading forecast…', 'loading');
  try {
    const [fc] = await Promise.all([
      fetchForecast({ lat: state.loc.lat, lon: state.loc.lon, model: state.model, days: 7 }),
      Grid.ensureGrid(XMap.getMap(), state.model),
    ]);
    state.forecast = fc;
    state.days = groupByDay(fc);
    if (state.dayIndex >= state.days.length) state.dayIndex = 0;
    pickDefaultHour();
    clearStatus();
    renderAll();
  } catch (err) {
    console.error(err);
    setStatus(`Couldn't load forecast: ${err.message}. Tap to retry.`, 'error', () => refreshAll());
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
    if (cur >= 0 && idx < cur) idx = cur;
  }
  state.hourIndex = idx >= 0 ? idx : Math.min(13, day.hours.length - 1);
}

function currentDay() { return state.days[state.dayIndex]; }
function currentHourOfDay() {
  const day = currentDay();
  if (!day || state.hourIndex == null) return 13;
  return day.hours[state.hourIndex]?.hourOfDay ?? 13;
}

// ── render ───────────────────────────────────────────────────────────────────
function renderAll() {
  renderDayTabs();
  renderOverlay();
  renderLegend();
  syncSlider();
  renderSheet();
}

function renderOverlay() {
  const day = currentDay();
  if (!day) return;
  Grid.render(XMap.getMap(), state.layer, day.dayKey, currentHourOfDay());
  if (state.takeoffsOn) renderTakeoffs();   // re-rank for the new time
  updateHourReadout();
}

// ── ranked takeoffs (ParaglidingEarth) ───────────────────────────────────────
function tkGroup() {
  if (!tkLayer) tkLayer = L.layerGroup().addTo(XMap.getMap());
  return tkLayer;
}

async function refreshTakeoffs() {
  if (!state.takeoffsOn) return;
  $('tk-count').textContent = 'loading takeoffs…';
  tkSites = await Takeoffs.fetchTakeoffs(XMap.getMap().getBounds());
  renderTakeoffs();
}

function renderTakeoffs() {
  const day = currentDay();
  const layer = tkGroup();
  layer.clearLayers();
  if (!day || !tkSites.length) {
    $('tk-count').textContent = tkSites.length ? '' : 'no takeoffs here';
    return;
  }
  const ranked = Takeoffs.rankSites(tkSites, day.dayKey, currentHourOfDay());
  ranked.forEach((r, i) => {
    const rank = i + 1;
    const top = rank <= 5;
    const color = Takeoffs.scoreColor(r.score);
    const html = top
      ? `<div class="tk-pin tk-rank" style="--c:${color}">${rank}</div>`
      : `<div class="tk-pin" style="--c:${color}"></div>`;
    const icon = L.divIcon({ className: 'tk-icon', html, iconSize: [22, 22], iconAnchor: [11, 11] });
    const m = L.marker([r.site.lat, r.site.lon], { icon, zIndexOffset: r.score });
    m.bindTooltip(`#${rank} ${r.site.name}`, { direction: 'top', offset: [0, -9], opacity: 0.85 });
    const w = r.wx;
    m.bindPopup(
      `<b>#${rank} · ${r.site.name}</b><br>` +
      `Score ${r.score} — ${r.reason}<br>` +
      `${U.alt(r.site.alt)} · wind ${U.compass(w.windDir)} ${U.wind(w.wind)} · climb ${U.climb(w.climb)}<br>` +
      `<a href="${r.site.link}" target="_blank" rel="noopener">ParaglidingEarth ↗</a>`
    );
    layer.addLayer(m);
  });
  const best = ranked[0];
  $('tk-count').textContent = best
    ? `${ranked.length} takeoffs · best: ${best.site.name} (${best.score})`
    : `${tkSites.length} takeoffs (no forecast)`;
}

function toggleTakeoffs() {
  state.takeoffsOn = !state.takeoffsOn;
  $('tk-btn').setAttribute('aria-pressed', String(state.takeoffsOn));
  if (state.takeoffsOn) {
    refreshTakeoffs();
  } else {
    if (tkLayer) tkLayer.clearLayers();
    $('tk-count').textContent = '';
  }
}

// ── task planner ──────────────────────────────────────────────────────────────
function renderPlanStats(st) {
  if (!st || st.n === 0) { $('plan-stats').textContent = 'Tap the map to drop turnpoints'; return; }
  let s = `${st.n} TP · ${st.total.toFixed(1)} km`;
  if (st.n >= 3) s += ` · triangle ${st.closed.toFixed(1)} km`;
  $('plan-stats').textContent = s;
}

function togglePlan() {
  const on = !Plan.isActive();
  Plan.setActive(on);
  $('plan-btn').setAttribute('aria-pressed', String(on));
  $('plan-bar').classList.toggle('hidden', !on);
  if (on) renderPlanStats(Plan.stats());
}

function renderLocName() { $('loc-name').textContent = state.loc.name; }

function renderLayerChips() {
  const el = $('layer-chips');
  el.innerHTML = '';
  for (const l of Grid.LAYERS) {
    const b = document.createElement('button');
    b.className = 'layer-chip' + (l.id === state.layer ? ' active' : '');
    b.textContent = l.label;
    b.setAttribute('role', 'tab');
    b.onclick = () => {
      state.layer = l.id;
      localStorage.setItem('xcsky.layer', l.id);
      renderLayerChips();
      renderLegend();
      renderOverlay();
    };
    el.appendChild(b);
  }
}

function renderLegend() {
  const spec = Grid.legend(state.layer);
  const el = $('legend');
  if (!spec) { el.innerHTML = ''; return; }
  el.innerHTML = `<span class="legend-title">${spec.title}</span>` +
    spec.items.map((it) => `<span class="legend-item"><i style="background:${it.color}"></i>${it.label}</span>`).join('');
}

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
      <span class="day-tab-dot" style="background:${flyColor(score)}"></span>`;
    btn.onclick = () => { state.dayIndex = i; pickDefaultHour(); renderAll(); };
    tabs.appendChild(btn);
  });
}

// ── point-forecast sheet ─────────────────────────────────────────────────────
function renderSheet() {
  if ($('fc-sheet').classList.contains('hidden')) return;
  $('fc-title').textContent = state.loc.name;
  renderSummary();
  renderCharts();
  renderChartLegend();
  renderDetail();
}

function renderSummary() {
  const day = currentDay();
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

let chartHit = null;

function renderCharts() {
  const day = currentDay();
  if (!day || $('fc-sheet').classList.contains('hidden')) return;
  const terrain = state.forecast.elevation;
  chartHit = drawTimeHeight($('th-chart'), day, terrain, { height: 240, selectedIndex: state.hourIndex });
  const hr = day.hours[state.hourIndex];
  if (hr) drawWindProfile($('wind-chart'), hr, terrain, { height: 240 });
}

function renderChartLegend() {
  const items = [['0.5', 'weak'], ['1.0', ''], ['1.5', 'good'], ['2.0', ''], ['3.0', 'strong']];
  $('chart-legend').innerHTML =
    `<span class="legend-title">Climb m/s</span>` +
    items.map(([v, lab]) =>
      `<span class="legend-item"><i style="background:${liftColor(+v)}"></i>${v}${lab ? ' ' + lab : ''}</span>`
    ).join('');
}

function renderDetail() {
  const day = currentDay();
  const el = $('detail');
  if (!day || state.hourIndex == null) { el.innerHTML = ''; return; }
  const terrain = state.forecast.elevation;
  const hr = day.hours[state.hourIndex];
  const d = deriveHour(hr, terrain);

  const cloud = d.cumulus ? `Cu ${U.alt(d.cloudBase)}` : (d.blDepth ? 'Blue' : '—');
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
  const day = currentDay();
  const slider = $('hour-slider');
  if (!day) return;
  slider.min = '0';
  slider.max = String(day.hours.length - 1);
  slider.value = String(state.hourIndex ?? 0);
  updateHourReadout();
}

function updateHourReadout() {
  const day = currentDay();
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
function onMapPick(p) {
  // In plan mode a tap drops a turnpoint instead of moving the forecast point.
  if (Plan.isActive()) { Plan.addWaypoint(p.lat, p.lon); return; }
  XMap.setSpot(p);
  reverseLabel(p.lat, p.lon).catch(() => '').then((name) => {
    setLocation({ name: name || `${p.lat.toFixed(2)}, ${p.lon.toFixed(2)}`, lat: p.lat, lon: p.lon }, { fly: false });
    openSheet();
  });
}

function setLocation(loc, { fly = true } = {}) {
  state.loc = { name: loc.name, lat: loc.lat, lon: loc.lon };
  Loc.saveLast(state.loc);
  renderLocName();
  if (fly) XMap.flyTo(state.loc);
  else XMap.setSpot(state.loc);
  refreshAll();
}

function openSheet() { $('fc-sheet').classList.remove('hidden'); renderSheet(); }
function closeSheet() { $('fc-sheet').classList.add('hidden'); }

function wireEvents() {
  $('units-btn').onclick = () => { U.toggleSystem(); syncUnitsButton(); renderAll(); };
  $('model-select').onchange = (e) => {
    state.model = e.target.value;
    localStorage.setItem('xcsky.model', state.model);
    refreshAll();
  };

  const slider = $('hour-slider');
  slider.oninput = () => {
    state.hourIndex = +slider.value;
    renderOverlay();
    if (!$('fc-sheet').classList.contains('hidden')) { renderCharts(); renderDetail(); }
  };

  $('fc-open').onclick = openSheet;
  $('fc-close').onclick = closeSheet;
  $('fc-sheet').addEventListener('click', (e) => { if (e.target === $('fc-sheet')) closeSheet(); });

  // Tap/drag the time-height chart to select an hour.
  const th = $('th-chart');
  const pick = (clientX) => {
    if (!chartHit) return;
    const rect = th.getBoundingClientRect();
    state.hourIndex = chartHit.hourAtX(clientX - rect.left);
    $('hour-slider').value = String(state.hourIndex);
    renderOverlay(); renderCharts(); renderDetail();
  };
  th.addEventListener('pointerdown', (e) => { pick(e.clientX); th.setPointerCapture(e.pointerId); });
  th.addEventListener('pointermove', (e) => { if (e.buttons) pick(e.clientX); });

  let rt = null;
  window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(renderCharts, 150); });

  document.addEventListener('pilots', (e) => {
    const { count, total } = e.detail;
    $('pilot-count').textContent =
      count === total ? `${count} pilots live` : `${count}🪂 · ${total} aloft`;
  });

  // Tools
  $('tk-btn').onclick = toggleTakeoffs;
  $('plan-btn').onclick = togglePlan;
  $('plan-undo').onclick = () => Plan.undo();
  $('plan-clear').onclick = () => Plan.clear();
  $('plan-done').onclick = () => {
    Plan.setActive(false);
    $('plan-btn').setAttribute('aria-pressed', 'false');
    $('plan-bar').classList.add('hidden');
  };
  $('plan-radius').oninput = (e) => {
    const r = +e.target.value;
    $('plan-radius-val').textContent = r >= 1000 ? `${(r / 1000).toFixed(1)} km` : `${r} m`;
    Plan.setRadius(r);
  };

  wireLocationSheet();
}

function syncUnitsButton() {
  $('units-btn').textContent = U.getSystem() === 'imperial' ? 'ft·kt' : 'm·km/h';
}

// ── location sheet ────────────────────────────────────────────────────────────
function wireLocationSheet() {
  const sheet = $('loc-sheet');
  const open = () => { sheet.classList.remove('hidden'); renderSaved(); };
  const close = () => { sheet.classList.add('hidden'); $('search-results').innerHTML = ''; $('search-input').value = ''; };
  $('loc-btn').onclick = open;
  $('loc-close').onclick = close;
  sheet.addEventListener('click', (e) => { if (e.target === sheet) close(); });

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
          b.onclick = () => { setLocation(results[i]); close(); };
        });
      } catch { $('search-results').innerHTML = '<div class="result-empty">Search failed</div>'; }
    }, 350);
  });

  $('use-gps').onclick = async () => {
    setStatus('Getting your location…', 'loading');
    try {
      const loc = await Loc.geolocate();
      clearStatus(); setLocation(loc); close();
    } catch (err) { setStatus(err.message, 'error'); setTimeout(clearStatus, 2500); }
  };
}

function renderSaved() {
  const spots = Loc.loadSpots();
  const list = $('saved-list');
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
      b.onclick = () => { setLocation(spots[i]); $('loc-sheet').classList.add('hidden'); };
    });
    list.querySelectorAll('.saved-del').forEach((b, i) => {
      b.onclick = () => { Loc.removeSpot(spots[i]); renderSaved(); };
    });
  }
  $('save-current').onclick = () => { Loc.addSpot(cur); renderSaved(); };
}

// ── service worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline still fine */ });
  });
}

boot();
