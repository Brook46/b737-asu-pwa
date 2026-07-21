// app.js — Sky Monkeys orchestration, map-first.
//
// The map with the gridded weather overlay IS the main screen (SkySight-style):
// pick a layer (thermals / top / base / wind), scrub day+hour, and the whole
// viewport re-colours instantly from the cached grid. Tap anywhere → the point
// forecast (time-height chart, wind profile, detail cards) opens as a bottom
// sheet. Vanilla ES modules, no framework.

import { fetchForecast, cachedForecast, groupByDay, MODELS, reverseLabel, reverseCountry } from './modules/meteo.js';
import { deriveHour, summariseDay } from './modules/soaring.js';
import { drawTimeHeight, drawWindProfile, drawRouteSection, drawSounding, soundingAt, drawTaskProfile, liftColor } from './modules/chart.js';
import * as U from './modules/units.js';
import * as Loc from './modules/location.js';
import * as XMap from './modules/map.js';
import * as Grid from './modules/grid.js';
import * as Takeoffs from './modules/takeoffs.js';
import * as Plan from './modules/planning.js';
import * as Recommend from './modules/recommend.js';
import * as Webcams from './modules/webcams.js';
import * as Flow from './modules/windflow.js';
import * as Store from './modules/store.js';
import * as Airspace from './modules/airspace.js';
import * as Profile from './modules/profile.js';
import * as Compare from './modules/compare.js';
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
  routesOn: false,
};

let tkLayer = null;      // Leaflet layer group for ranked takeoff markers
let tkSites = [];        // last-fetched launch sites for the viewport
let recLayer = null;     // suggested-route + best-launch layer
let recState = null;     // { start, startName, dayKey, options, activeIdx }

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
    Plan.initPlanner(XMap.getMap(), {
      onChange: (st) => { renderPlanStats(st); scheduleProfile(); },
    });
    initAirspaceLayer();
    let tkT = null;
    XMap.getMap().on('moveend', () => {
      if (anyWindLayer()) renderAltBar();
      if (state.routesOn) refreshRoutes();
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
  sel.innerHTML = MODELS.map((m) => `<option value="${m.id}" title="${m.label}">${m.short || m.label}</option>`).join('');
  sel.value = state.model;
}

// ── data ─────────────────────────────────────────────────────────────────────
/** Refresh both the point forecast and the map grid. */
async function refreshAll(quiet = false) {
  if (state.loading) return;
  state.loading = true;
  const hadForecast = !!state.forecast;
  if (!quiet && !hadForecast) setStatus('Loading forecast…', 'loading');
  try {
    const [fc] = await Promise.all([
      fetchForecast({ lat: state.loc.lat, lon: state.loc.lon, model: state.model, days: 7 }),
      Grid.ensureGrid(XMap.getMap(), state.model),
    ]);
    state.forecast = fc;
    state.days = groupByDay(fc);
    if (state.dayIndex >= state.days.length) state.dayIndex = 0;
    pickDefaultHour();
    state.dataAt = Date.now();
    state.dataStale = false;
    clearStatus();
    renderAll();
    renderConnBadge();
  } catch (err) {
    console.error(err);
    const limited = /\b429\b/.test(err.message || '');
    // No live data — fall back to whatever we cached for this point.
    if (!hadForecast) {
      const cached = await cachedForecast({ lat: state.loc.lat, lon: state.loc.lon, model: state.model })
        .catch(() => null);
      if (cached && cached.forecast) {
        state.forecast = cached.forecast;
        state.days = groupByDay(cached.forecast);
        if (state.dayIndex >= state.days.length) state.dayIndex = 0;
        pickDefaultHour();
        state.dataAt = cached.at;
        state.dataStale = true;
        clearStatus();
        renderAll();
        renderConnBadge();
        state.loading = false;
        return;
      }
    }
    if (hadForecast) {
      // A refresh failed but we already have a good forecast — keep showing it
      // rather than blanking the app, and say so briefly.
      setStatus(limited ? 'Busy upstream — still showing the last forecast'
                        : 'Couldn\'t refresh — still showing the last forecast', 'loading');
      setTimeout(clearStatus, 3000);
    } else {
      setStatus(limited
        ? 'Weather service is busy (rate limit). Tap to try again.'
        : `Couldn't load forecast: ${err.message}. Tap to retry.`, 'error', () => refreshAll());
    }
  } finally {
    state.loading = false;
  }
}

// Coalesce rapid refetches (location + model changed together, etc.) so we
// don't fire two heavy requests back-to-back and trip the limit ourselves.
let refreshT = null;
function scheduleRefresh() {
  clearTimeout(refreshT);
  refreshT = setTimeout(() => refreshAll(), 220);
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
  if (state.takeoffsOn) renderTakeoffs();   // re-rank for the new day
  if (state.routesOn) refreshRoutes();      // keyed by day+area → cheap on hour scrubs
  if (Plan.isActive() && !$('task-body').classList.contains('hidden')) drawProfileCanvas(Profile.taskStats(Plan.waypoints()));
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
  // Rank for the SELECTED DAY: each launch keeps its best hour of that day.
  const ranked = Takeoffs.rankSitesForDay(tkSites, day.dayKey);
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
      `Score ${r.score} — ${r.reason} · peaks ${String(r.bestHour).padStart(2, '0')}:00<br>` +
      `${U.alt(r.site.alt)} · wind ${U.compass(w.windDir)} ${U.wind(w.wind)} · climb ${U.climb(w.climb)}<br>` +
      `<a href="${r.site.link}" target="_blank" rel="noopener">ParaglidingEarth ↗</a>`
    );
    layer.addLayer(m);
  });
  const best = ranked[0];
  $('tk-count').textContent = best
    ? `${ranked.length} takeoffs · best ${U.dayLabel(day.date)}: ${best.site.name} (${best.score})`
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

// ── best routes of the day (top-3 launches → balanced XC lines) ─────────────
let routesLayer = null, routesKey = '';

async function refreshRoutes(force = false) {
  if (!state.routesOn) return;
  const day = currentDay();
  if (!day || !Grid.gridReady()) return;
  const b = XMap.getMap().getBounds();
  const key = `${day.dayKey}|${b.getSouth().toFixed(1)},${b.getWest().toFixed(1)},${b.getNorth().toFixed(1)},${b.getEast().toFixed(1)}`;
  if (!force && key === routesKey) return;      // same day + same area → keep
  routesKey = key;

  const sites = await Takeoffs.fetchTakeoffs(b);
  const ranked = Takeoffs.rankSitesForDay(sites, day.dayKey);
  if (!routesLayer) routesLayer = L.layerGroup().addTo(XMap.getMap());
  routesLayer.clearLayers();
  const colors = ['#f2c14e', '#5ec2ff', '#7ce0a8'];
  ranked.slice(0, 3).forEach((r, i) => {
    const start = { lat: r.site.lat, lon: r.site.lon };
    const soar = [];
    for (let h = 9; h <= 18; h++) {
      const wx = Grid.sampleAt(start.lat, start.lon, day.dayKey, h);
      if (wx && wx.climb >= 0.5) soar.push(h);
    }
    const rt = Recommend.recommendRoute(start, day.dayKey, soar);
    if (!rt || rt.km < 10) return;
    const xc = Math.round(Recommend.xcScore5(rt.path) / 10) * 10;
    L.polyline(rt.path.map((p) => [p.lat, p.lon]),
      { color: colors[i], weight: 3, opacity: 0.9, dashArray: i ? '6 5' : null }).addTo(routesLayer);
    L.marker([start.lat, start.lon], {
      icon: L.divIcon({ className: '', html: `<div class="route-badge" style="--c:${colors[i]}">${i + 1}</div>`, iconSize: [20, 20], iconAnchor: [10, 10] }),
      zIndexOffset: 500,
    }).bindTooltip(`#${i + 1} ${r.site.name} · ~${xc} km (5-pt)`, { direction: 'top', offset: [0, -8] }).addTo(routesLayer);
  });
}

function toggleRoutes() {
  state.routesOn = !state.routesOn;
  $('routes-toggle').setAttribute('aria-pressed', String(state.routesOn));
  if (state.routesOn) { routesKey = ''; refreshRoutes(true); }
  else if (routesLayer) routesLayer.clearLayers();
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
    const ranked = Takeoffs.rankSitesForDay(sites, day.dayKey);
    if (ranked.length) { start = { lat: ranked[0].site.lat, lon: ranked[0].site.lon }; startName = ranked[0].site.name; }
  } catch { /* no takeoffs → launch from the current point */ }

  // Soarable window sampled from the grid at the launch (consistent with the map).
  const soarable = [];
  for (let h = 7; h <= 20; h++) {
    const wx = Grid.sampleAt(start.lat, start.lon, day.dayKey, h);
    if (wx && wx.climb >= 0.5) soarable.push(h);
  }
  const options = Recommend.recommendOptions(start, day.dayKey, soarable);
  clearStatus();

  recState = { start, startName, dayKey: day.dayKey, options, activeIdx: options.length > 1 ? 1 : 0 };
  $('rec-btn').setAttribute('aria-pressed', 'true');

  // Frame it: thermals field, peak time, centred on the launch.
  state.color = 'climb'; localStorage.setItem('xcsky.color', 'climb');
  const idx = day.hours.findIndex((h) => h.hourOfDay >= peakHour);
  if (idx >= 0) { state.hourIndex = idx; $('hour-slider').value = String(idx); }
  XMap.flyTo(start, Math.max(XMap.getMap().getZoom(), 9));
  renderLayerChips(); renderLegend(); renderOverlay();

  if (!options.length) { showRecEmpty(startName); return; }
  await showRecOption(recState.activeIdx);
}

function showRecEmpty(startName) {
  if (recLayer) recLayer.clearLayers();
  const t = $('rec-toast'); t.classList.remove('hidden');
  t.querySelector('.rec-toast-body').innerHTML =
    `<b>${startName}</b> is today's pick, but the day looks weak — little usable climb for going XC.`;
  $('rec-opts').innerHTML = ''; $('rec-strategy').textContent = ''; $('rec-speed-legend').innerHTML = '';
  $('rec-xsec').style.display = 'none';
}

/** Trim an option's route so it never leaves the launch's country. */
async function fenceRouteToCountry(opt, start) {
  const home = await reverseCountry(start.lat, start.lon);
  if (!home) return opt;
  const path = [opt.path[0]], times = [opt.times[0]];
  for (let i = 1; i < opt.path.length; i++) {
    const c = await reverseCountry(opt.path[i].lat, opt.path[i].lon);
    if (c !== home) break;                        // crossed a border / coast → stop here
    path.push(opt.path[i]); times.push(opt.times[i]);
  }
  if (path.length === opt.path.length) return opt;
  return { ...opt, path, times, km: Recommend.pathDistance(path), hoursFlown: path.length - 1 };
}

async function showRecOption(idx) {
  const rs = recState; if (!rs) return;
  rs.activeIdx = idx;
  let opt = rs.options[idx];
  try { opt = await fenceRouteToCountry(opt, rs.start); } catch { /* keep raw */ }
  drawRecRoute(rs, opt);
}

// XC ground-speed colour: how fast you can fly a leg (km made good per hour).
function speedColor(kmh) {
  if (kmh < 12) return '#5c9cc9';   // slow — weak air
  if (kmh < 18) return '#3fae74';
  if (kmh < 24) return '#9fcb3f';
  if (kmh < 28) return '#f2c14e';   // quick
  return '#ef7d3b';                  // ripping
}

function drawRecRoute(rs, opt) {
  if (!recLayer) recLayer = L.layerGroup().addTo(XMap.getMap());
  recLayer.clearLayers();
  L.marker([rs.start.lat, rs.start.lon], {
    icon: L.divIcon({ className: '', html: '<div class="rec-start">★</div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
    zIndexOffset: 1000,
  }).addTo(recLayer);

  // Draw each leg in a colour for the speed you can fly it (≈ km made good/hour).
  if (opt && opt.km >= 3) {
    for (let i = 1; i < opt.path.length; i++) {
      const a = opt.path[i - 1], b = opt.path[i];
      const legKmh = haversineKm(a, b);
      L.polyline([[a.lat, a.lon], [b.lat, b.lon]],
        { color: speedColor(legKmh), weight: 5, opacity: 0.95, lineCap: 'round' }).addTo(recLayer);
    }
    const end = opt.path[opt.path.length - 1];
    L.circleMarker([end.lat, end.lon], { radius: 5, color: '#fff', weight: 2, fillColor: '#f2c14e', fillOpacity: 1 }).addTo(recLayer);
  }

  const t = $('rec-toast'); t.classList.remove('hidden');
  const xc5 = Math.round(Recommend.xcScore5(opt.path) / 10) * 10;
  t.querySelector('.rec-toast-body').innerHTML =
    `<b>Best of the day</b> · launch <span class="rec-hi">${rs.startName}</span> · fly ${Recommend.bearingLabel(opt.bearing)}` +
    (xc5 >= 10 ? ` · XC 5-pt ~<span class="rec-hi">${xc5} km</span>` : '');

  $('rec-opts').innerHTML = rs.options.map((o, i) => {
    const km = Math.round(o.km / 10) * 10;
    return `<button class="rec-opt${i === rs.activeIdx ? ' active' : ''}" data-i="${i}">
      <span class="rec-opt-name">${o.name}</span>
      <span class="rec-opt-sub">off ${String(o.takeoffHour).padStart(2, '0')}:00 · ~${km} km</span></button>`;
  }).join('');
  $('rec-opts').querySelectorAll('.rec-opt').forEach((b) => { b.onclick = () => showRecOption(+b.dataset.i); });

  $('rec-strategy').textContent = buildStrategy(opt, rs);
  $('rec-speed-legend').innerHTML =
    '<span class="rsl-title">Glide speed</span>' +
    [['12', 'slow'], ['18', ''], ['24', ''], ['28', 'fast']]
      .map(([v, l]) => `<span class="rsl-item"><i style="background:${speedColor(+v + 1)}"></i>${v}${l ? ' ' + l : ''}</span>`).join('');

  drawRecXsection(rs, opt);
}

const haversineKm = (a, b) => {
  const R = 6371, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

/** Short tactical text tailored to the option and the day's conditions. */
function buildStrategy(opt, rs) {
  // Sample the launch across the flown hours for the numbers.
  let maxClimb = 0, maxTop = 0, cu = false, windSum = 0, gustish = 0, n = 0;
  for (const h of (opt.times || [])) {
    const wx = Grid.sampleAt(rs.start.lat, rs.start.lon, rs.dayKey, h);
    if (!wx) continue;
    maxClimb = Math.max(maxClimb, wx.climb || 0);
    maxTop = Math.max(maxTop, wx.top || 0);
    if (wx.base != null) cu = true;
    windSum += wx.wind || 0; gustish = Math.max(gustish, wx.wind || 0); n++;
  }
  const wind = n ? windSum / n : 0;
  const dir = Recommend.bearingLabel(opt.bearing);
  const off = `${String(opt.takeoffHour).padStart(2, '0')}:00`;
  const topTxt = maxTop ? U.alt(maxTop) : 'the top';
  const climbTxt = maxClimb >= 0.4 ? `${maxClimb.toFixed(1)} m/s` : 'light';
  const sky = cu ? 'work the cumulus' : 'blue day — read the ground and other gliders';
  const windNote = wind > 28 ? ` Wind is strong (${U.wind(wind)}) — expect rough air and commit only with height.`
    : wind > 16 ? ` Steady ${U.wind(wind)} tailwind helps the glides.` : ' Light wind, so climbs matter more than glides.';

  if (opt.id === 'conservative') {
    return `Wait for it to switch on and launch around ${off}. Stay high — top out near ${topTxt}, ${sky}, take short hops ${dir} and land before the day over-develops. Don't get low far from a road.` + windNote;
  }
  if (opt.id === 'committed') {
    return `Off early at ${off} to use the whole window. Commit downwind ${dir}, chase the strongest lines (${climbTxt} to ${topTxt}) and keep moving.` + windNote + ` Have a bail-out plan if it shuts down late.`;
  }
  return `Launch around ${off} into working conditions, climb to ${topTxt} and run ${dir} (${climbTxt} cores). ${cu ? 'Stay under cloudbase' : 'Blue, so centre patiently'}.` + windNote;
}

function drawRecXsection(rs, opt) {
  const cv = $('rec-xsec');
  if (!opt || opt.path.length < 2) { cv.style.display = 'none'; return; }
  cv.style.display = 'block';
  const samples = opt.path.map((p, i) => {
    const wx = Grid.sampleAt(p.lat, p.lon, rs.dayKey, opt.times[i]);
    return { hour: opt.times[i], terrain: wx ? wx.elev : 0, top: wx ? wx.top : null, base: wx ? wx.base : null, climb: wx ? wx.climb : 0 };
  });
  drawRouteSection(cv, samples, { height: 118 });
}

function clearRecommend() {
  if (recLayer) recLayer.clearLayers();
  recState = null;
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
  Airspace.setInteractive(!on, asLayer);   // let taps through to the map while planning
  if (on) { renderPlanStats(Plan.stats()); scheduleProfile(); }
  else $('task-panel').classList.add('hidden');
}

// ── local airspace (OpenAir / GeoJSON, imported on-device) ──────────────────
let asLayer = null;

async function initAirspaceLayer() {
  asLayer = L.layerGroup().addTo(XMap.getMap());
  try {
    const { zones, meta } = await Airspace.load();
    if (zones.length) { Airspace.render(asLayer); renderAsStatus(meta); }
  } catch { /* no local airspace stored — that's the normal case */ }
}

function renderAsStatus(meta) {
  const n = Airspace.count();
  const el = $('as-status');
  if (!el) return;
  el.textContent = n
    ? `${n} zones loaded${meta && meta.name ? ` from ${meta.name}` : ''}`
    : 'No local airspace loaded';
  $('as-clear').hidden = !n;
}

async function importAirspaceFile(file) {
  if (!file) return;
  setStatus(`Reading ${file.name}…`, 'loading');
  try {
    const text = await file.text();
    const zones = Airspace.parseAirspace(text, file.name);
    if (!zones.length) throw new Error('No airspace found in that file');
    await Airspace.save(zones, { name: file.name });
    Airspace.render(asLayer);
    Profile.invalidate();
    renderAsStatus({ name: file.name });
    scheduleProfile();
    setStatus(`${zones.length} airspace zones loaded`, 'loading');
    setTimeout(clearStatus, 2400);
  } catch (err) {
    setStatus(`Airspace import failed: ${err.message}`, 'error');
    setTimeout(clearStatus, 3200);
  }
}

function wireAirspaceImport() {
  const drop = $('as-drop');
  if (!drop) return;
  $('as-pick').onclick = () => $('as-file').click();
  $('as-file').onchange = (e) => { importAirspaceFile(e.target.files[0]); e.target.value = ''; };
  $('as-clear').onclick = async () => {
    await Airspace.clear();
    if (asLayer) asLayer.clearLayers();
    Profile.invalidate();
    renderAsStatus(null); scheduleProfile();
  };
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', (e) => importAirspaceFile(e.dataTransfer.files[0]));
  renderAsStatus(null);
}

// ── task cross-section (terrain + airspace + wind along the legs) ────────────
let profileT = null, profileSamples = null;

/** Debounced rebuild — dragging a turnpoint fires change events continuously. */
function scheduleProfile() {
  clearTimeout(profileT);
  profileT = setTimeout(refreshProfile, 260);
}

async function refreshProfile() {
  const panel = $('task-panel');
  const wpts = Plan.waypoints();
  if (!Plan.isActive() || wpts.length < 2) { panel.classList.add('hidden'); return; }
  panel.classList.remove('hidden');

  const stats = Profile.taskStats(wpts);
  $('task-summary').textContent =
    `Task profile · ${stats.total.toFixed(1)} km` +
    (stats.fai ? (stats.fai.valid ? ' · FAI ✓' : ' · FAI ✗') : '');

  // Leg chips.
  $('task-legs').innerHTML =
    stats.legs.map((d, i) => `<span>L${i + 1} ${d.toFixed(1)} km</span>`).join('') +
    (stats.closing ? `<span>close ${stats.closing.toFixed(1)} km</span>` : '') +
    `<span class="total">total ${(stats.closing ? stats.perimeter : stats.total).toFixed(1)} km</span>`;

  const fai = $('task-fai');
  if (!stats.fai) {
    fai.className = 'task-fai';
    fai.textContent = wpts.length < 4
      ? 'Drop 3 turnpoints for an FAI triangle check.'
      : 'FAI triangle check applies to exactly 3 turnpoints.';
  } else {
    const pct = (stats.fai.minPct * 100).toFixed(1);
    fai.className = 'task-fai ' + (stats.fai.valid ? 'ok' : 'no');
    fai.textContent = stats.fai.valid
      ? `FAI triangle valid — shortest side ${pct}% of perimeter (needs ≥28%).`
      : `Not an FAI triangle — shortest side ${pct}% of perimeter (needs ≥28%).`;
  }

  if ($('task-body').classList.contains('hidden')) return;   // collapsed: skip the fetch

  try {
    profileSamples = await Profile.buildProfile(wpts);
  } catch { profileSamples = null; }
  drawProfileCanvas(stats);
}

function drawProfileCanvas(stats) {
  if (!profileSamples) return;
  const wpts = Plan.waypoints();
  const day = currentDay();
  const hour = currentHourOfDay();

  // Wind at the mid-point of each leg, and the working top, from the grid.
  const winds = [];
  let top = 0;
  for (let i = 1; i < wpts.length; i++) {
    const mid = { lat: (wpts[i - 1].lat + wpts[i].lat) / 2, lon: (wpts[i - 1].lon + wpts[i].lon) / 2 };
    const wx = day && hour != null ? Grid.sampleAt(mid.lat, mid.lon, day.dayKey, hour) : null;
    winds.push(wx ? { spd: wx.wind, dir: wx.windDir } : null);
    if (wx && wx.top) top = Math.max(top, wx.top);
  }
  drawTaskProfile($('task-xsec'), profileSamples, { wpts, winds, top, height: 190 });
}

function renderLocName() { $('loc-name').textContent = state.loc.name; }

// ── connection / data freshness ──────────────────────────────────────────────
function renderConnBadge() {
  const el = $('conn-badge');
  const offline = !navigator.onLine;
  const at = state.dataAt ? Store.timeLabel(state.dataAt) : '';
  if (offline) {
    el.hidden = false; el.className = 'conn-badge offline';
    el.textContent = at ? `Offline — cached at ${at}` : 'Offline — no cached data';
  } else if (state.dataStale) {
    el.hidden = false; el.className = 'conn-badge stale';
    el.textContent = at ? `Cached at ${at} — tap to refresh` : 'Cached data — tap to refresh';
    el.onclick = () => refreshAll();
  } else if (at) {
    el.hidden = false; el.className = 'conn-badge ok';
    el.textContent = `Updated ${at}`;
  } else {
    el.hidden = true;
  }
}

// ── high-contrast sunlight theme ─────────────────────────────────────────────
function applyTheme(sun) {
  document.documentElement.setAttribute('data-theme', sun ? 'sun' : 'night');
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', sun ? '#ffffff' : '#0a0f1a');
  $('sun-btn').setAttribute('aria-pressed', String(sun));
  Grid.setHighContrast(sun);      // punchier overlay alpha for direct sun
  if (state.forecast) { renderOverlay(); renderSheet(); }
}

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
  renderSounding();
}

// ── model comparison ─────────────────────────────────────────────────────────
// Loaded on demand: it's a second network request, and on a rate-limited
// connection you don't want it firing every time the sheet opens.
async function loadComparison() {
  const day = currentDay();
  if (!day) return;
  const btn = $('cmp-load');
  btn.disabled = true; btn.textContent = 'Comparing…';
  try {
    const rows = await Compare.compareDay({
      lat: state.loc.lat, lon: state.loc.lon,
      dayKey: day.dayKey, elevation: state.forecast.elevation,
    });
    renderComparison(rows);
    btn.textContent = 'Refresh';
  } catch (err) {
    $('cmp-table').innerHTML = `<div class="cmp-empty">Couldn't compare models: ${err.message}</div>`;
    btn.textContent = 'Retry';
  } finally {
    btn.disabled = false;
  }
}

function renderComparison(rows) {
  const el = $('cmp-table');
  if (!rows.length) { el.innerHTML = '<div class="cmp-empty">No other models cover this point.</div>'; return; }
  const sp = Compare.spread(rows);
  const head = '<div class="cmp-row cmp-head"><span>Model</span><span>Climb</span><span>Top</span><span>Base</span><span>Peak</span></div>';
  const body = rows.map((r) => `
    <div class="cmp-row">
      <span class="cmp-model">${r.label}</span>
      <span style="color:${liftColor(r.peakClimb)}">${r.peakClimb.toFixed(1)}</span>
      <span>${r.peakTop != null ? U.alt(r.peakTop) : '—'}</span>
      <span>${r.base != null ? U.alt(r.base) : 'blue'}</span>
      <span>${String(r.bestHour).padStart(2, '0')}:00</span>
    </div>`).join('');
  const verdict = sp
    ? (sp.topRange != null && sp.topRange > 800) || sp.climbRange > 0.9
      ? `<div class="cmp-verdict poor">Models disagree — ${sp.topRange != null ? `${Math.round(sp.topRange)} m` : ''} spread on top, ${sp.climbRange.toFixed(1)} m/s on climb. Keep the plan flexible.</div>`
      : `<div class="cmp-verdict good">Models broadly agree — a plannable day.</div>`
    : '';
  el.innerHTML = head + body + verdict;
}

// ── sounding + thermal metrics ───────────────────────────────────────────────
let sdGeom = null;         // canvas geometry from the last draw (y ↔ altitude)
let sdCursorZ = null;      // altitude MSL of the draggable read-out line

function renderSounding() {
  const day = currentDay();
  if (!day || state.hourIndex == null || $('fc-sheet').classList.contains('hidden')) return;
  const hr = day.hours[state.hourIndex];
  if (!hr) return;
  sdGeom = drawSounding($('sounding'), hr, state.forecast.elevation,
    { height: 210, cursorZ: sdCursorZ });
  renderSdReadout(hr);
  renderThermalMetrics(hr);
}

/** Convective metrics, in both m/s and knots — the numbers pilots quote. */
function renderThermalMetrics(hr) {
  const terrain = state.forecast.elevation;
  const d = deriveHour(hr, terrain);
  const kts = (ms) => (ms * 1.94384).toFixed(1);
  const card = (label, value, sub) =>
    `<div class="tm-card"><span class="tm-label">${label}</span>` +
    `<span class="tm-value">${value}</span>` +
    (sub ? `<span class="tm-sub">${sub}</span>` : '') + '</div>';

  $('thermal-metrics').innerHTML = [
    card('Climb (net)', `${d.climb.toFixed(1)} m/s`, `${kts(d.climb)} kt`),
    card('w* (convective)', `${d.wStar.toFixed(1)} m/s`, `${kts(d.wStar)} kt`),
    card('Thermal ceiling', d.workingTop != null ? U.alt(d.workingTop) : '—',
      d.workingTop != null ? `${U.alt(d.band)} band` : ''),
    card('LCL', d.lcl != null ? U.alt(terrain + d.lcl) : '—',
      d.cumulus ? 'cumulus' : 'blue — no cu'),
  ].join('');
}

function renderSdReadout(hr) {
  const el = $('sd-readout');
  if (sdCursorZ == null) {
    el.innerHTML = '<span class="sd-idle">Drag across the sounding to read temperature, dewpoint, wind and shear at any level.</span>';
    return;
  }
  const s = soundingAt(hr, state.forecast.elevation, sdCursorZ);
  const bits = [`<b>${U.alt(sdCursorZ)}</b>`];
  if (s.t != null) bits.push(`T ${s.t.toFixed(1)}°`);
  if (s.td != null) bits.push(`Td ${s.td.toFixed(1)}°`);
  if (s.t != null && s.td != null) bits.push(`spread ${(s.t - s.td).toFixed(1)}°`);
  if (s.spd != null) bits.push(`${U.wind(s.spd)} ${s.dir != null ? U.compass(s.dir) : ''}`);
  if (s.inversion) bits.push('<span class="sd-warn">inversion</span>');
  if (s.shear > 25) bits.push(`<span class="sd-warn">shear ${Math.round(s.shear)}/km</span>`);
  el.innerHTML = bits.join(' · ');
}

/** Pointer y on the sounding canvas → altitude MSL. */
function wireSounding() {
  const cv = $('sounding');
  const at = (clientY) => {
    if (!sdGeom) return;
    const r = cv.getBoundingClientRect();
    const y = clientY - r.top;
    const f = 1 - (y - sdGeom.padT) / sdGeom.plotH;
    sdCursorZ = sdGeom.zMin + (sdGeom.zMax - sdGeom.zMin) * Math.max(0, Math.min(1, f));
    renderSounding();
  };
  let dragging = false;
  cv.addEventListener('pointerdown', (e) => {
    dragging = true; cv.setPointerCapture(e.pointerId); at(e.clientY); e.preventDefault();
  });
  cv.addEventListener('pointermove', (e) => { if (dragging) { at(e.clientY); e.preventDefault(); } });
  cv.addEventListener('pointerup', () => { dragging = false; });
  cv.addEventListener('pointercancel', () => { dragging = false; });
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
  scheduleRefresh();
}

function openSheet() { $('fc-sheet').classList.remove('hidden'); renderSheet(); }
function closeSheet() { $('fc-sheet').classList.add('hidden'); }

function wireEvents() {
  $('units-btn').onclick = () => { U.toggleSystem(); syncUnitsButton(); renderAll(); };

  // Sunlight mode + connection status
  applyTheme(localStorage.getItem('xcsky.sun') === '1');
  $('sun-btn').onclick = () => {
    const sun = $('sun-btn').getAttribute('aria-pressed') !== 'true';
    localStorage.setItem('xcsky.sun', sun ? '1' : '0');
    applyTheme(sun);
  };
  addEventListener('online', () => { renderConnBadge(); refreshAll(true); });
  addEventListener('offline', renderConnBadge);
  renderConnBadge();
  $('model-select').onchange = (e) => {
    state.model = e.target.value;
    localStorage.setItem('xcsky.model', state.model);
    scheduleRefresh();
  };

  const slider = $('hour-slider');
  slider.oninput = () => {
    state.hourIndex = +slider.value;
    renderOverlay();
    if (!$('fc-sheet').classList.contains('hidden')) { renderCharts(); renderDetail(); renderSounding(); }
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
    renderOverlay(); renderCharts(); renderDetail(); renderSounding();
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
  $('routes-toggle').onclick = toggleRoutes;
  $('locate-btn').onclick = async () => {
    setStatus('Getting your location…', 'loading');
    try {
      const loc = await Loc.geolocate();
      clearStatus();
      setLocation(loc);                        // flies the map to you + refetches
    } catch (err) { setStatus(err.message, 'error'); setTimeout(clearStatus, 2500); }
  };
  $('plan-undo').onclick = () => Plan.undo();
  $('plan-clear').onclick = () => Plan.clear();
  $('plan-done').onclick = () => {
    Plan.setActive(false);
    $('plan-btn').setAttribute('aria-pressed', 'false');
    $('plan-bar').classList.add('hidden');
  };
  $('task-toggle').onclick = () => {
    const body = $('task-body');
    const open = body.classList.toggle('hidden') === false;
    $('task-toggle').setAttribute('aria-expanded', String(open));
    if (open) refreshProfile();
  };
  $('plan-radius').oninput = (e) => {
    const r = +e.target.value;
    $('plan-radius-val').textContent = r >= 1000 ? `${(r / 1000).toFixed(1)} km` : `${r} m`;
    Plan.setRadius(r);
  };

  wireLocationSheet();
  wireAirspaceImport();
  wireSounding();
  $('cmp-load').onclick = loadComparison;
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
