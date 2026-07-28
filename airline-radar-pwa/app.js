// Airline Radar — live airline traffic on a map.
//
// The loop is deliberately small: every REFRESH_MS ask airplanes.live for one
// snapshot of the sky around the map centre, run every record past the airline
// filter, hand the survivors to the map and the list, and lazily fill in routes
// from adsbdb for the ones the user can actually see.
//
// Everything else in here is state plumbing: selection, filters, view
// persistence and the two bottom sheets.

import { fetchArea, fetchOne, radiusForMap, normalise, MAX_RADIUS_NM } from './modules/adsb.js';
import { classify, lookup as lookupAirline } from './modules/airlines.js';
import * as radar from './modules/map.js';
import { lookupRoute, lookupAircraft, cachedRoute, eta } from './modules/routes.js';
import { renderList, renderDetail, renderAirlines } from './modules/panel.js';
import { LEGEND } from './modules/aircraft.js';
import { installResumeHardening } from './modules/resume.js';
import * as history from './modules/history.js';
import * as search from './modules/search.js';
import * as fmt from './modules/fmt.js';

const REFRESH_MS = 5000;
const MOVE_DEBOUNCE_MS = 700;
const LOOKUP_DEBOUNCE_MS = 600;  // wait for typing to settle before a global lookup
const PREFETCH_PER_CYCLE = 6;    // route lookups started per refresh (≈3 s of queue)
const GHOST_MAX_AGE_MS = 30 * 60 * 1000;  // how long a lost contact stays on the map
const VIEW_KEY = 'airadar.view';
const PREFS_KEY = 'airadar.prefs';
const AIRLINES_KEY = 'airadar.airlines';
const DEFAULT_VIEW = { lat: 32.01, lon: 34.89, zoom: 8 };   // Ben Gurion TMA

const state = {
  aircraft: [],          // normalised + airline-filtered, current snapshot
  remote: [],            // found by global search, may be far off the map
  selectedHex: null,
  selectedInfo: null,    // adsbdb airframe record for the selection
  lastAt: 0,
  error: '',
  clipped: false,
  query: '',
  parsed: search.parseQuery(''),
  lookupNote: '',        // what the global lookup found, for the status line
  pannedFor: '',         // query we already jumped the map for
  airlines: new Set(),   // operator codes to show; empty = all
  pickerQuery: '',
  deepLink: null,        // {query, sta, staSource} — see readDeepLink()
  autoSelected: false,   // the deep-linked aircraft has been opened once
  prefs: loadPrefs(),
};

/**
 * Open straight onto one aircraft: `?reg=4X-EKM`, `?tail=EKM`, `?flight=ELY348`.
 *
 * This is how the flight card hands over — its tail-tracking button used to
 * open Flightradar24 and now opens this app on the same aeroplane. `sta` comes
 * with it because the roster knows the scheduled arrival and no keyless feed
 * does; `from` just labels where that time came from.
 */
function readDeepLink() {
  const p = new URLSearchParams(location.search);
  const query = (p.get('reg') || p.get('tail') || p.get('flight') || p.get('q') || '').trim();
  if (!query) return null;
  return {
    query,
    sta: (p.get('sta') || '').trim(),
    staSource: (p.get('from') || '').trim().slice(0, 24),
  };
}

let refreshTimer = null;
let moveTimer = null;
let lookupTimer = null;
let busy = false;
let clippedSaid = false;

const $ = (sel) => document.querySelector(sel);

function loadPrefs() {
  const base = { labels: true, trails: true, ground: false, ghosts: true, follow: false };
  try {
    const p = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    return {
      labels: p.labels !== false,
      trails: p.trails !== false,
      ground: p.ground === true,     // ground traffic off by default — it clutters
      ghosts: p.ghosts !== false,    // remember aircraft that stop transmitting
      follow: false,                 // never restored; it's a per-session choice
    };
  } catch {
    return base;
  }
}

function savePrefs() {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(state.prefs)); } catch { /* ignore */ }
}

function loadAirlines() {
  try {
    const a = JSON.parse(localStorage.getItem(AIRLINES_KEY) || '[]');
    return new Set(Array.isArray(a) ? a.filter((c) => typeof c === 'string') : []);
  } catch { return new Set(); }
}

function saveAirlines() {
  try { localStorage.setItem(AIRLINES_KEY, JSON.stringify([...state.airlines])); } catch { /* ignore */ }
}

function loadView() {
  try {
    const v = JSON.parse(localStorage.getItem(VIEW_KEY) || 'null');
    if (v && Number.isFinite(v.lat) && Number.isFinite(v.lon)) return v;
  } catch { /* ignore */ }
  return DEFAULT_VIEW;
}

function saveView() {
  const map = radar.getMap();
  if (!map) return;
  const c = map.getCenter();
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ lat: c.lat, lon: c.lng, zoom: map.getZoom() }));
  } catch { /* ignore */ }
}

// ── the refresh loop ────────────────────────────────────────────────────────

/**
 * One poll of the feed.
 * @param {boolean} force run even while the page is hidden. The timer never
 *   forces — polling a backgrounded app just burns battery and quota — but the
 *   first load, a pan, a resume and the locate button all do, otherwise an app
 *   that happens to boot hidden (a PWA restored behind another window) would
 *   sit on an empty map until the user switched away and back.
 */
async function refresh(force = false) {
  const map = radar.getMap();
  if (!map || busy) return;
  if (!force && document.visibilityState !== 'visible') return;
  busy = true;
  setLive('polling');
  try {
    const c = map.getCenter();
    const radius = radiusForMap(map);
    const { aircraft, at, clipped } = await fetchArea(c.lat, c.lng, radius);

    const out = [];
    for (const raw of aircraft) {
      if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) continue;
      const cls = classify(raw);
      if (!cls) continue;                                   // not airline traffic
      const ac = normalise(raw, cls);
      if (ac.onGround && !state.prefs.ground) continue;
      out.push(ac);
    }
    out.sort((a, b) => (a.dst ?? 9999) - (b.dst ?? 9999));

    state.aircraft = out;
    state.lastAt = at;
    state.clipped = clipped;
    state.error = '';

    // Remember where everything was, and notice anything that just went quiet.
    const lost = history.record(out, { lat: c.lat, lon: c.lng, radiusNm: radius });
    if (lost.length && state.prefs.ghosts) {
      const who = lost.map((e) => e.callsign || e.reg).filter(Boolean).slice(0, 3).join(', ');
      if (who) showStatus(`${who} stopped transmitting — last position kept on the map.`);
    }

    // Keep a searched-for aircraft moving even while it's off the map.
    if (search.isTargeted(state.parsed)) runLookup();

    prefetchRoutes(out);
    draw();
  } catch (err) {
    state.error = String(err && err.message ? err.message : err);
    setLive('error');
    showStatus(`Feed unavailable — ${state.error}`, true);
  } finally {
    busy = false;
    if (!state.error) setLive('live');
  }
}

/** Ask adsbdb about the flights the user is most likely to look at next. */
function prefetchRoutes(list) {
  let n = 0;
  for (const ac of list) {
    if (n >= PREFETCH_PER_CYCLE) break;
    if (cachedRoute(ac.callsign) !== undefined) continue;
    lookupRoute(ac.callsign).then((r) => {
      // A route arriving late still belongs on screen.
      if (r && (state.selectedHex === ac.hex || visible().some((a) => a.hex === ac.hex))) draw();
    });
    n++;
  }
}

// ── search ──────────────────────────────────────────────────────────────────

/**
 * Ask the feed for the aircraft the query names, wherever in the world it is,
 * and put it on the map. This is the half of "search" that filtering can't do:
 * you can't filter your way to an aeroplane that isn't in the box you're
 * looking at.
 */
async function runLookup() {
  const p = state.parsed;
  const forText = p.text;
  if (!search.isTargeted(p)) { state.remote = []; state.lookupNote = ''; return; }

  const { raw } = await search.lookupGlobal(p, fetchOne);
  if (state.parsed.text !== forText) return;        // the query moved on

  const found = [];
  for (const rec of raw) {
    if (!Number.isFinite(rec.lat) || !Number.isFinite(rec.lon)) continue;
    // An explicit registration/callsign search is a direct request for *that*
    // aircraft, so it is shown whether or not it passes the airline filter.
    const cls = classify(rec) || {
      code: String(rec.flight || '').trim().toUpperCase().slice(0, 3),
      flightNo: '',
      airline: null,
    };
    const ac = normalise(rec, cls);
    ac.airline = ac.airline || lookupAirline(ac.code);
    found.push(ac);
  }
  state.remote = found;

  if (!found.length) {
    const ghost = history.ghosts().find((e) => search.matches(history.asAircraft(e), p, null));
    state.lookupNote = ghost
      ? `${search.describe(p)} isn't transmitting — showing where it was ${fmt.ago(ghost.at)}.`
      : `Nothing is transmitting as ${search.describe(p)} right now.`;
    // Opened from the flight card: still show the aircraft's card, on its last
    // known position, rather than leaving the user staring at an empty map.
    if (state.deepLink && !state.autoSelected && ghost) {
      state.autoSelected = true;
      radar.panTo(ghost.lat, ghost.lon, Math.max(radar.getMap().getZoom(), 7));
      select(ghost.hex);
      return;
    }
    draw();
    return;
  }

  state.lookupNote = '';
  const map = radar.getMap();
  const one = found[0];
  const offMap = map && !map.getBounds().contains([one.lat, one.lon]);
  if (found.length === 1 && offMap && state.pannedFor !== forText) {
    state.pannedFor = forText;
    radar.panTo(one.lat, one.lon, Math.max(map.getZoom(), 7));
    showStatus(`${one.callsign || one.reg} found — map moved to it.`);
  }
  // Arriving from the flight card: open the aircraft's card, once.
  if (state.deepLink && !state.autoSelected && found.length) {
    state.autoSelected = true;
    select(one.hex);
    return;
  }
  draw();
}

/** Re-read the query, filter immediately, and schedule the global lookup. */
function onQueryChanged(raw) {
  state.query = raw;
  state.parsed = search.parseQuery(raw);
  state.lookupNote = '';
  if (!search.isTargeted(state.parsed)) { state.remote = []; state.pannedFor = ''; }
  draw();

  clearTimeout(lookupTimer);
  if (state.parsed.text.length >= 3) {
    lookupTimer = setTimeout(runLookup, LOOKUP_DEBOUNCE_MS);
  }
}

// ── rendering ───────────────────────────────────────────────────────────────

const routeOf = (ac) => cachedRoute(ac.callsign) || null;

/** Does this aircraft survive the airline picker? */
function airlineOk(ac) {
  return state.airlines.size === 0 || state.airlines.has(ac.code);
}

/**
 * What should be on screen right now, in layers:
 *
 *   live traffic in view  → airline filter → search filter
 *   + aircraft the global search found somewhere else entirely
 *   + last-known positions of aircraft that are no longer transmitting
 *
 * The last two are the reason the search box is useful: an aeroplane you are
 * looking for is usually the one that *isn't* conveniently in front of you.
 */
function visible() {
  const p = state.parsed;
  const searching = !!p.text;
  const byHex = new Map();

  for (const ac of state.aircraft) {
    if (!airlineOk(ac)) continue;
    if (searching && !search.matches(ac, p, routeOf(ac))) continue;
    byHex.set(ac.hex, ac);
  }

  // Aircraft found by name/registration anywhere in the world.
  for (const ac of state.remote) {
    if (byHex.has(ac.hex)) continue;
    if (!airlineOk(ac)) continue;
    byHex.set(ac.hex, ac);
  }

  // Last-known positions. While searching, any match is worth showing however
  // old; otherwise only recent losses, so the map doesn't fill with fossils.
  if (state.prefs.ghosts) {
    for (const e of history.ghosts()) {
      if (byHex.has(e.hex)) continue;
      if (!Number.isFinite(e.lat)) continue;
      const ac = history.asAircraft(e);
      if (!airlineOk(ac)) continue;
      if (searching) {
        if (!search.matches(ac, p, routeOf(ac))) continue;
      } else if (!e.wentDark || Date.now() - (e.at || 0) > GHOST_MAX_AGE_MS) {
        continue;
      }
      byHex.set(ac.hex, ac);
    }
  }

  const out = [...byHex.values()];
  out.sort((a, b) => {
    if (!!a.ghost !== !!b.ghost) return a.ghost ? 1 : -1;   // live traffic first
    return (a.dst ?? 9999) - (b.dst ?? 9999);
  });
  return out;
}

function draw() {
  const list = visible();
  radar.render(list, state.selectedHex);

  const live = list.filter((a) => !a.ghost).length;
  const ghosts = list.length - live;
  $('#count').textContent = `${live === 1 ? '1 flight' : `${live} flights`}`
    + (ghosts ? ` · ${ghosts} last seen` : '');
  $('#stamp').textContent = state.lastAt ? fmt.clock(state.lastAt) : '';
  drawFilterChips();

  renderList($('#list-body'), list, {
    selectedHex: state.selectedHex,
    routeFor: (cs) => cachedRoute(cs) || null,
    onPick: select,
    emptyMessage: emptyMessage(),
  });

  // One status line, in priority order: what the search found beats the
  // coverage notice, which is only worth saying when it changes.
  if (state.lookupNote) {
    showStatus(state.lookupNote);
  } else if (state.clipped && !clippedSaid) {
    showStatus(`Showing the nearest ${MAX_RADIUS_NM} NM — zoom in for full coverage.`);
  }
  clippedSaid = state.clipped;

  // The selection may be a live aircraft, one the global search found, or a
  // remembered position — look in all three.
  const sel = list.find((a) => a.hex === state.selectedHex)
    || state.aircraft.find((a) => a.hex === state.selectedHex) || null;
  const sheet = $('#detail');
  document.body.classList.toggle('has-detail', !!sel);
  if (!sel) {
    sheet.classList.remove('open');
    radar.clearRoute();
    return;
  }

  const route = cachedRoute(sel.callsign) || null;
  const body = $('#detail-body');
  const keep = body.scrollTop;
  renderDetail(body, sel, route, state.selectedInfo, {
    following: radar.getFollow(),
    arrival: arrivalFor(sel, route),
  });
  body.scrollTop = keep;
  sheet.classList.add('open');
  wireDetailButtons(sel, route);
  radar.drawRoute(sel, route);
}

/**
 * Scheduled and estimated arrival for one aircraft.
 *
 * ETA is ours to compute. STA is not: no keyless feed publishes schedules, so
 * the only scheduled arrival we ever have is the one the flight card passed in
 * the deep link, and it only belongs to the aircraft that link named.
 */
function arrivalFor(ac, route) {
  const dl = state.deepLink;
  const isLinked = dl && ac && (
    search.normReg(ac.reg) === search.normReg(search.parseQuery(dl.query).reg || dl.query)
    || ac.callsign === dl.query.toUpperCase()
  );
  const staAt = isLinked && dl.sta ? fmt.parseStaUtc(dl.sta) : 0;
  return {
    eta: ac.ghost ? null : eta(ac, route),
    staAt,
    staSource: staAt ? (dl.staSource || 'roster') : '',
  };
}

/** Why the list is empty — the answer differs for a filter and for a search. */
function emptyMessage() {
  if (state.parsed.text) {
    return {
      title: `Nothing matches ${search.describe(state.parsed)}.`,
      hint: search.isTargeted(state.parsed)
        ? 'Not in view and not transmitting anywhere the network can hear it.'
        : 'Try a callsign (ELY387), a tail (EKA), an airline or an airport code.',
    };
  }
  if (state.airlines.size) {
    return {
      title: 'None of the chosen airlines are in view.',
      hint: 'Pan the map, or clear the airline filter to see everything.',
    };
  }
  return {
    title: 'No airline traffic in view.',
    hint: 'Pan to an airway or a big airport, or zoom out.',
  };
}

function wireDetailButtons(ac, route) {
  const body = $('#detail-body');
  const close = body.querySelector('.sheet-close');
  if (close) close.addEventListener('click', () => select(null));
  body.querySelectorAll('[data-act]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const act = btn.dataset.act;
      if (act === 'follow') {
        radar.setFollow(!radar.getFollow());
        draw();
      } else if (act === 'fit') {
        radar.fitRoute(ac, route);
      } else if (act === 'center') {
        radar.panTo(ac.lat, ac.lon, Math.max(8, radar.getMap().getZoom()));
      }
    });
  });
}

// ── selection ───────────────────────────────────────────────────────────────

function select(hex) {
  if (hex === state.selectedHex) hex = null;      // tapping again deselects
  state.selectedHex = hex;
  state.selectedInfo = null;
  radar.setFollow(false);

  if (hex) {
    const ac = visible().find((a) => a.hex === hex);
    if (ac) {
      lookupRoute(ac.callsign).then(() => { if (state.selectedHex === hex) draw(); });
      lookupAircraft(ac.reg || ac.hex).then((info) => {
        if (state.selectedHex !== hex) return;
        state.selectedInfo = info;
        draw();
      });
      collapseList();
    }
  }
  draw();
}

// ── chrome: sheets, toggles, status ─────────────────────────────────────────

function setLive(mode) {
  const el = $('#live');
  el.dataset.mode = mode;
  const text = mode === 'error' ? 'No feed' : (mode === 'polling' ? 'Updating' : 'Live');
  el.querySelector('span').textContent = text;
  el.title = mode === 'error'
    ? 'The position feed is not answering'
    : `Positions refresh every ${REFRESH_MS / 1000} seconds`;
}

// ── airline picker ──────────────────────────────────────────────────────────

/** Operators currently in view, plus any that are selected but have flown off. */
function airlineOptions() {
  const counts = new Map();
  for (const ac of state.aircraft) {
    const name = (ac.airline && ac.airline.name)
      || (cachedRoute(ac.callsign) && cachedRoute(ac.callsign).airline
        && cachedRoute(ac.callsign).airline.name) || ac.code;
    const row = counts.get(ac.code) || { code: ac.code, name, count: 0 };
    if (row.name === row.code && name !== ac.code) row.name = name;
    row.count++;
    counts.set(ac.code, row);
  }
  for (const code of state.airlines) {
    if (!counts.has(code)) {
      const a = lookupAirline(code);
      counts.set(code, { code, name: a ? a.name : code, count: 0 });
    }
  }
  return [...counts.values()];
}

function drawPicker() {
  renderAirlines($('#picker-body'), airlineOptions(), state.airlines, {
    query: state.pickerQuery,
    onToggle: (code) => {
      if (state.airlines.has(code)) state.airlines.delete(code);
      else state.airlines.add(code);
      saveAirlines();
      drawPicker();
      draw();
    },
    onClear: () => {
      state.airlines.clear();
      saveAirlines();
      drawPicker();
      draw();
    },
  });
  const q = $('#airline-q');
  if (q) {
    q.addEventListener('input', (e) => {
      state.pickerQuery = e.target.value;
      const pos = e.target.selectionStart;
      drawPicker();
      const again = $('#airline-q');
      if (again) { again.focus(); again.setSelectionRange(pos, pos); }
    });
  }
}

function togglePicker(open) {
  const el = $('#picker');
  const show = open === undefined ? !el.classList.contains('open') : open;
  el.classList.toggle('open', show);
  $('#airline-btn').setAttribute('aria-pressed', String(show));
  if (show) { drawPicker(); collapseList(); }
}

/** The "El Al ✕" style chips that show what is being filtered out. */
function drawFilterChips() {
  const el = $('#chips');
  const chips = [];
  for (const code of state.airlines) {
    const a = lookupAirline(code);
    chips.push(`<button class="chip" data-drop-airline="${code}">${a ? a.name : code}<i>✕</i></button>`);
  }
  if (state.query.trim()) {
    chips.push(`<button class="chip" data-drop-query="1">“${state.query.trim()}”<i>✕</i></button>`);
  }
  el.innerHTML = chips.join('');
  el.hidden = !chips.length;
  el.querySelectorAll('[data-drop-airline]').forEach((b) => b.addEventListener('click', () => {
    state.airlines.delete(b.dataset.dropAirline);
    saveAirlines();
    drawPicker();
    draw();
  }));
  const dq = el.querySelector('[data-drop-query]');
  if (dq) dq.addEventListener('click', () => { $('#search').value = ''; onQueryChanged(''); });
}

let statusTimer = null;
function showStatus(msg, sticky) {
  const el = $('#status');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(statusTimer);
  if (!sticky) statusTimer = setTimeout(() => el.classList.add('hidden'), 4500);
}

function collapseList() { $('#list').classList.remove('open'); }

function toggleChip(id, key, apply) {
  const btn = $(id);
  const set = (v) => {
    state.prefs[key] = v;
    btn.setAttribute('aria-pressed', String(v));
    apply(v);
    savePrefs();
  };
  btn.addEventListener('click', () => set(!state.prefs[key]));
  set(state.prefs[key]);
}

function buildLegend() {
  $('#legend').innerHTML = LEGEND.map(([label, color]) =>
    `<span><i style="background:${color}"></i>${label}</span>`).join('');
}

// ── boot ────────────────────────────────────────────────────────────────────

function boot() {
  const view = loadView();
  radar.initMap('map', {
    center: { lat: view.lat, lon: view.lon },
    zoom: view.zoom || DEFAULT_VIEW.zoom,
    onSelectAircraft: select,
    onMove: () => {
      saveView();
      clearTimeout(moveTimer);
      moveTimer = setTimeout(() => refresh(true), MOVE_DEBOUNCE_MS);
    },
  });

  buildLegend();
  state.airlines = loadAirlines();

  toggleChip('#labels-btn', 'labels', (v) => { radar.setLabels(v); radar.render(visible(), state.selectedHex); });
  toggleChip('#trails-btn', 'trails', (v) => radar.setTrails(v));
  toggleChip('#ground-btn', 'ground', () => { if (state.lastAt) refresh(true); });
  toggleChip('#ghosts-btn', 'ghosts', () => draw());

  $('#airline-btn').addEventListener('click', () => togglePicker());
  $('#picker-close').addEventListener('click', () => togglePicker(false));

  $('#list-head').addEventListener('click', () => $('#list').classList.toggle('open'));

  $('#search').addEventListener('input', (e) => {
    if (e.target.value) $('#list').classList.add('open');
    onQueryChanged(e.target.value);
  });
  // Enter runs the global lookup at once instead of waiting out the debounce.
  $('#search').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    clearTimeout(lookupTimer);
    runLookup();
  });

  $('#locate-btn').addEventListener('click', () => {
    if (!navigator.geolocation) { showStatus('This device has no location service.'); return; }
    showStatus('Locating…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        radar.panTo(pos.coords.latitude, pos.coords.longitude, 8);
        $('#status').classList.add('hidden');
        refresh(true);
      },
      () => showStatus('Location unavailable — pan the map instead.'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60000 },
    );
  });

  // A deep link is a search that has already been typed for you.
  state.deepLink = readDeepLink();
  if (state.deepLink) {
    $('#search').value = state.deepLink.query;
    onQueryChanged(state.deepLink.query);
    // Cancel the typing debounce: the first refresh below runs the lookup
    // itself, so the aircraft is fetched once rather than twice.
    clearTimeout(lookupTimer);
  }

  installResumeHardening(() => refresh(true));

  refresh(true);
  refreshTimer = setInterval(() => refresh(), REFRESH_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') refresh(true);
  });

  // Not on localhost: a cache-first service worker in front of dev-server.py
  // hands back yesterday's modules and you debug code that isn't running.
  const isDev = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  if ('serviceWorker' in navigator && !isDev) {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* offline shell is optional */ });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
