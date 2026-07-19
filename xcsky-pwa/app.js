// app.js — Sky Monkeys orchestration, map-first.
//
// The map with the gridded weather overlay IS the main screen (SkySight-style):
// pick a layer (thermals / top / base / wind), scrub day+hour, and the whole
// viewport re-colours instantly from the cached grid. Tap anywhere → the point
// forecast (time-height chart, wind profile, detail cards) opens as a bottom
// sheet. Vanilla ES modules, no framework.

import { fetchForecast, groupByDay, MODELS, reverseLabel, reverseCountry } from './modules/meteo.js';
import { deriveHour, summariseDay } from './modules/soaring.js';
import { drawTimeHeight, drawWindProfile, liftColor } from './modules/chart.js';
import * as U from './modules/units.js';
import * as Loc from './modules/location.js';
import * as XMap from './modules/map.js';
import * as Grid from './modules/grid.js';
import * as Takeoffs from './modules/takeoffs.js';
import * as Plan from './modules/planning.js';
import * as Recommend from './modules/recommend.js';
import * as Webcams from './modules/webcams.js';
import * as Flow from './modules/windflow.js';
import { installResumeHardening } from './modules/resume.js';

// Default point if we have no saved location and GPS is unavailable:
// Ölüdeniz / Babadağ — an easy-to-recognise flying site.
const DEFAULT_LOC = { name: 'Babadağ, Turkey', lat: 36.55, lon: 29.13 };

const savedModel = localStorage.getItem('xcsky.model');
let savedColor = localStorage.getItem('xcsky.color') || localStorage.getItem('xcsky.layer');
if (!savedColor || savedColor === 'wind') savedColor = 'climb';   // 'wind' is now a toggle
const state = {
  loc: Loc.loadLast() || DEFAULT_LOC,
  // Reset any saved model that's no longer offered (e.g. ECMWF/ICON, which
  // lack boundary-layer height and so produce an all-zero forecast).
  model: MODELS.some((m) => m.id === savedModel) ? savedModel : 'best_match',
  color: savedColor,                                  // colour field: climb/top/base/off
  windOn: localStorage.getItem('xcsky.wind') === '1', // wind barbs overlay
  convOn: localStorage.getItem('xcsky.conv') === '1', // convergence overlay
  flowOn: localStorage.getItem('xcsky.flow') === '1', // animated wind flow
  windLevel: localStorage.getItem('xcsky.windLevel') || 'sfc',
  forecast: null,      // point forecast for state.loc
  days: [],
  dayIndex: 0,
  hourIndex: null,     // index into the selected day's hours
  loading: false,
  takeoffsOn: false,
};

let tkLayer = null;      // Leaflet layer group for ranked takeoff markers
let tkSites = [];        // last-fetched launch sites for the viewport
let recLayer = null;     // suggested-route + best-launch layer

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
      if (anyWindLayer()) renderAltBar();
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
  Grid.render(XMap.getMap(),
    { color: state.color, wind: state.windOn, convergence: state.convOn, windLevel: state.windLevel },
    day.dayKey, currentHourOfDay());
  updateFlow();
  renderAltBar();
  if (state.takeoffsOn) renderTakeoffs();   // re-rank for the new time
  updateHourReadout();
}

// ── animated wind flow + altitude bar ────────────────────────────────────────
function anyWindLayer() { return state.windOn || state.convOn || state.flowOn; }

function updateFlow() {
  const day = currentDay();
  if (state.flowOn && day) {
    if (!Flow.isOn()) Flow.start(XMap.getMap());
    Flow.setField(Grid.windField(day.dayKey, currentHourOfDay(), state.windLevel));
  } else if (Flow.isOn()) {
    Flow.stop();
  }
}

function renderAltBar() {
  const el = $('alt-bar');
  const day = currentDay();
  if (!anyWindLayer() || !day) { el.classList.add('hidden'); return; }
  const c = XMap.getMap().getCenter();
  const profile = Grid.levelProfile(c.lat, c.lng, day.dayKey, currentHourOfDay());
  if (!profile.length) { el.classList.add('hidden'); return; }
  el.classList.remove('hidden');
  // Highest level at the top.
  el.innerHTML = profile.slice().reverse().map((lv) => {
    const active = lv.id === state.windLevel ? ' active' : '';
    const barb = lv.spd != null ? Grid.barbSvg(lv.spd, lv.dir) : '';
    return `<button class="alt-level${active}" data-lv="${lv.id}">
      <span class="alt-barb">${barb}</span>
      <span class="alt-level-txt"><span class="alt-level-h">${lv.label}</span>
        <span class="alt-level-w">${lv.spd != null ? U.wind(lv.spd) : '—'} ${U.compass(lv.dir)}</span></span>
    </button>`;
  }).join('');
  el.querySelectorAll('.alt-level').forEach((b) => {
    b.onclick = () => {
      state.windLevel = b.dataset.lv;
      localStorage.setItem('xcsky.windLevel', state.windLevel);
      renderOverlay();
    };
  });
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

// ── "maximise the day": best launch + suggested route ────────────────────────
async function runRecommend() {
  const day = currentDay();
  if (!day || !Grid.gridReady()) { setStatus('Forecast still loading…', 'error'); setTimeout(clearStatus, 1800); return; }
  setStatus('Finding the best of the day…', 'loading');

  // Best launch: top-ranked takeoff at the day's peak hour, else the point itself.
  const s = summariseDay(day.hours, state.forecast.elevation);
  const peakHour = s.bestHour ? s.bestHour.hourOfDay : 13;
  let start = { lat: state.loc.lat, lon: state.loc.lon }, startName = state.loc.name;
  try {
    const sites = await Takeoffs.fetchTakeoffs(XMap.getMap().getBounds());
    const ranked = Takeoffs.rankSites(sites, day.dayKey, peakHour);
    if (ranked.length) { start = { lat: ranked[0].site.lat, lon: ranked[0].site.lon }; startName = ranked[0].site.name; }
  } catch { /* no takeoffs → launch from the current point */ }

  // Soarable window sampled from the grid at the launch (consistent with the map).
  const hours = [];
  for (let h = 7; h <= 20; h++) {
    const wx = Grid.sampleAt(start.lat, start.lon, day.dayKey, h);
    if (wx && wx.climb >= 0.5) hours.push(h);
  }
  let route = Recommend.recommendRoute(start, day.dayKey, hours);
  // Keep the suggested flight inside the launch country — truncate at the first
  // waypoint that crosses a border (or goes offshore). Never let a geocode
  // hiccup blank the whole suggestion.
  try { if (route) route = await fenceToCountry(route, start); } catch { /* keep raw route */ }
  clearStatus();
  drawRecommendation(start, startName, route, hours, peakHour);
}

/** Trim a route so it never leaves the launch's country. */
async function fenceToCountry(route, start) {
  const home = await reverseCountry(start.lat, start.lon);
  if (!home) return route;                       // unknown home → don't fence
  const kept = [route.path[0]];
  for (let i = 1; i < route.path.length; i++) {
    const p = route.path[i];
    const c = await reverseCountry(p.lat, p.lon);
    if (c !== home) break;                        // crossed a border / coast → stop here
    kept.push(p);
  }
  if (kept.length === route.path.length) return route;
  return { ...route, path: kept, km: Recommend.pathDistance(kept), hoursFlown: kept.length - 1 };
}

function drawRecommendation(start, startName, route, hours, peakHour) {
  if (!recLayer) recLayer = L.layerGroup().addTo(XMap.getMap());
  recLayer.clearLayers();

  L.marker([start.lat, start.lon], {
    icon: L.divIcon({ className: '', html: '<div class="rec-start">★</div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
    zIndexOffset: 1000,
  }).addTo(recLayer);

  let body;
  if (route && route.km >= 3) {
    L.polyline(route.path.map((p) => [p.lat, p.lon]), { color: '#f2c14e', weight: 4, opacity: 0.95 }).addTo(recLayer);
    const end = route.path[route.path.length - 1];
    L.circleMarker([end.lat, end.lon], { radius: 5, color: '#fff', weight: 2, fillColor: '#f2c14e', fillOpacity: 1 }).addTo(recLayer);
    const win = hours.length ? `${String(hours[0]).padStart(2, '0')}–${String(hours[hours.length - 1]).padStart(2, '0')}h` : '';
    const kmR = Math.round(route.km / 10) * 10;
    body = `<b>Best of the day</b><br>Launch <span class="rec-hi">${startName}</span>, fly <b>${Recommend.bearingLabel(route.bearing)}</b><br>` +
      `~<span class="rec-hi">${kmR} km</span> on a strong line, ${route.hoursFlown}h window${win ? ` (${win})` : ''}`;
  } else {
    body = `<b>${startName}</b> is today's pick, but the day looks weak — little usable climb for going XC.`;
  }
  const t = $('rec-toast');
  t.querySelector('.rec-toast-body').innerHTML = body;
  t.classList.remove('hidden');
  $('rec-btn').setAttribute('aria-pressed', 'true');

  // Frame it: thermals field, peak time, centred on the launch.
  state.color = 'climb'; localStorage.setItem('xcsky.color', 'climb');
  const idx = currentDay().hours.findIndex((h) => h.hourOfDay >= peakHour);
  if (idx >= 0) { state.hourIndex = idx; $('hour-slider').value = String(idx); }
  XMap.flyTo(start, Math.max(XMap.getMap().getZoom(), 9));
  renderLayerChips(); renderLegend(); renderOverlay();
}

function clearRecommend() {
  if (recLayer) recLayer.clearLayers();
  $('rec-toast').classList.add('hidden');
  $('rec-btn').setAttribute('aria-pressed', 'false');
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
  for (const l of Grid.COLOR_LAYERS) {
    const b = document.createElement('button');
    b.className = 'layer-chip' + (l.id === state.color ? ' active' : '');
    b.textContent = l.label;
    b.setAttribute('role', 'tab');
    b.onclick = () => {
      state.color = l.id;
      localStorage.setItem('xcsky.color', l.id);
      renderLayerChips();
      renderLegend();
      renderOverlay();
    };
    el.appendChild(b);
  }
}

function renderLegend() {
  const spec = Grid.legend(state.color);
  const el = $('legend');
  let html = '';
  if (spec) {
    html = `<span class="legend-title">${spec.title}</span>` +
      spec.items.map((it) => `<span class="legend-item"><i style="background:${it.color}"></i>${it.label}</span>`).join('');
  }
  if (state.convOn) {
    html += `<span class="legend-item"><i style="background:#7cf0ff"></i>convergence</span>`;
  }
  el.innerHTML = html;
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

  document.addEventListener('needkey', (e) => {
    const which = e.detail.which === 'airspace' ? 'Airspace (OpenAIP)' : 'Webcams (Windy)';
    $('loc-sheet').classList.remove('hidden'); renderSaved();
    const target = e.detail.which === 'airspace' ? $('openaip-key') : $('windy-key');
    target.scrollIntoView({ block: 'center' }); target.focus();
    setStatus(`${which} needs a free API key — add it below`, 'loading');
    setTimeout(clearStatus, 3200);
  });

  // Overlay toggles (stack over the colour field)
  $('wind-toggle').setAttribute('aria-pressed', String(state.windOn));
  $('conv-toggle').setAttribute('aria-pressed', String(state.convOn));
  $('wind-toggle').onclick = () => {
    state.windOn = !state.windOn;
    localStorage.setItem('xcsky.wind', state.windOn ? '1' : '0');
    $('wind-toggle').setAttribute('aria-pressed', String(state.windOn));
    renderOverlay();
  };
  $('conv-toggle').onclick = () => {
    state.convOn = !state.convOn;
    localStorage.setItem('xcsky.conv', state.convOn ? '1' : '0');
    $('conv-toggle').setAttribute('aria-pressed', String(state.convOn));
    renderOverlay();
  };
  $('flow-toggle').setAttribute('aria-pressed', String(state.flowOn));
  $('flow-toggle').onclick = () => {
    state.flowOn = !state.flowOn;
    localStorage.setItem('xcsky.flow', state.flowOn ? '1' : '0');
    $('flow-toggle').setAttribute('aria-pressed', String(state.flowOn));
    renderOverlay();
  };

  // Tools
  $('rec-btn').onclick = () =>
    ($('rec-btn').getAttribute('aria-pressed') === 'true' ? clearRecommend() : runRecommend());
  $('rec-clear').onclick = clearRecommend;
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

  // API keys (airspace / webcams) — stored on-device.
  $('openaip-key').value = localStorage.getItem('xcsky.openaipKey') || '';
  $('windy-key').value = Webcams.getKey();
  $('keys-save').onclick = () => {
    const oa = $('openaip-key').value.trim();
    oa ? localStorage.setItem('xcsky.openaipKey', oa) : localStorage.removeItem('xcsky.openaipKey');
    Webcams.setKey($('windy-key').value);
    XMap.refreshKeys();
    setStatus('Keys saved — enable Airspace / Webcams in the map layers menu', 'loading');
    setTimeout(clearStatus, 2600);
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
