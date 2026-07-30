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
const MAX_TOKENS = 6;            // searched aircraft at once — each is its own lookup
const STALE_MS = 12000;          // beyond ~2 refreshes we're dead-reckoning, not live
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
  query: '',             // the text still being typed
  parsed: search.parseQuery(''),
  tokens: [],            // committed search terms, like addresses on an email
  lookupNote: '',        // what the global lookup found, for the status line
  pannedFor: '',         // query set we already moved the map for
  airlines: new Set(),   // operator codes to show; empty = all
  pickerQuery: '',
  deepLink: null,        // {queries, sta, staSource} — see readDeepLink()
  autoSelected: false,   // the deep-linked aircraft has been opened once
  detailCollapsed: false,// the aircraft card is folded down to its header
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
  const raw = (p.get('reg') || p.get('tail') || p.get('flight') || p.get('q') || '').trim();
  if (!raw) return null;
  // Comma-separated opens several aircraft at once, same as typing them.
  const queries = raw.split(',').map((s) => s.trim()).filter(Boolean).slice(0, MAX_TOKENS);
  if (!queries.length) return null;
  return {
    queries,
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
  updateLiveBadge(true);
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

    // Keep searched-for aircraft moving even while they're off the map. This
    // has to consider the committed terms, not just what's in the box — a
    // deep-linked or chipped aircraft has no text being typed at all.
    if (activeQueries().some(search.isTargeted)) runLookup();

    prefetchRoutes(out);
    draw();
  } catch (err) {
    state.error = String(err && err.message ? err.message : err);
    // Not necessarily broken — one dropped refresh just means the picture is
    // being dead-reckoned for a few seconds. Only say so if it persists.
    if (Date.now() - state.lastAt > radar.DR_MAX_MS) {
      showStatus(`Feed unavailable — ${state.error}`, true);
    }
  } finally {
    busy = false;
    updateLiveBadge(false);
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
/**
 * Every search term in play: the ones already committed, plus whatever is
 * still being typed. They combine as OR — "show me EKA *and* EHH" — which is
 * what adding a second aircraft is supposed to mean.
 */
function activeQueries() {
  const out = state.tokens.map((t) => search.parseQuery(t));
  if (state.parsed.text) out.push(state.parsed);
  return out;
}

/** Identity of the current query set, so an in-flight lookup can tell it's stale. */
function queryKey() {
  return activeQueries().map((p) => p.text).join('|');
}

/** Turn one raw record from a by-name lookup into a displayable aircraft. */
function asAircraft(rec) {
  // An explicit registration/callsign search is a direct request for *that*
  // aircraft, so it is shown whether or not it passes the airline filter.
  const cls = classify(rec) || {
    code: String(rec.flight || '').trim().toUpperCase().slice(0, 3),
    flightNo: '',
    airline: null,
  };
  const ac = normalise(rec, cls);
  ac.airline = ac.airline || lookupAirline(ac.code);
  return ac;
}

async function runLookup() {
  const targeted = activeQueries().filter(search.isTargeted).slice(0, MAX_TOKENS);
  const key = queryKey();
  if (!targeted.length) { state.remote = []; state.lookupNote = ''; return; }

  const found = [];
  const missed = [];
  for (const p of targeted) {
    const { raw } = await search.lookupGlobal(p, fetchOne);
    if (queryKey() !== key) return;                 // the query set moved on
    const hits = raw.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
    if (hits.length) hits.forEach((r) => found.push(asAircraft(r)));
    else missed.push(p);
  }
  state.remote = found;

  // Say which of the named aircraft aren't answering, and offer the last known
  // position for any that we remember.
  const ghosts = missed.map((p) => ({
    p, ghost: history.ghosts().find((e) => search.matches(history.asAircraft(e), p, null)),
  }));
  state.lookupNote = ghosts.slice(0, 2).map(({ p, ghost }) => (ghost
    ? `${search.describe(p)} isn't transmitting — showing where it was ${fmt.ago(ghost.at)}.`
    : `Nothing is transmitting as ${search.describe(p)} right now.`)).join(' ');

  // Bring the named aircraft into view: one gets a pan, several get framed.
  const map = radar.getMap();
  const points = found.map((a) => [a.lat, a.lon]);
  for (const { ghost } of ghosts) if (ghost) points.push([ghost.lat, ghost.lon]);
  const anyVisible = map && points.some((pt) => map.getBounds().contains(pt));
  if (map && points.length && !anyVisible && state.pannedFor !== key) {
    state.pannedFor = key;
    if (points.length === 1) radar.panTo(points[0][0], points[0][1], Math.max(map.getZoom(), 7));
    else radar.fitPoints(points);
    const names = found.map((a) => a.callsign || a.reg).filter(Boolean);
    showStatus(names.length === 1
      ? `${names[0]} found — map moved to it.`
      : `${points.length} aircraft found — map moved to them.`);
  }

  // Arriving from the flight card: open the aircraft's card, once.
  if (state.deepLink && !state.autoSelected) {
    const first = found[0] || ghosts.map((g) => g.ghost).find(Boolean);
    if (first) {
      state.autoSelected = true;
      select(first.hex);
      return;
    }
  }
  draw();
}

/** Re-read the text in the box, filter immediately, schedule the lookup. */
function onQueryChanged(raw) {
  state.query = raw;
  state.parsed = search.parseQuery(raw);
  state.lookupNote = '';
  if (!activeQueries().some(search.isTargeted)) { state.remote = []; state.pannedFor = ''; }
  draw();

  clearTimeout(lookupTimer);
  if (state.parsed.text.length >= 3 || state.tokens.length) {
    lookupTimer = setTimeout(runLookup, LOOKUP_DEBOUNCE_MS);
  }
}

/**
 * Commit what's typed as its own term and clear the box, the way an email
 * client turns a typed address into a pill when you press Enter. Terms stack:
 * each one is searched for in its own right, so several aircraft can be
 * tracked at once.
 */
function commitToken(raw) {
  const t = String(raw || state.query).trim();
  if (!t) return false;
  const norm = t.toUpperCase();
  if (state.tokens.length >= MAX_TOKENS) {
    showStatus(`Up to ${MAX_TOKENS} at a time — remove one first.`);
    return false;
  }
  if (!state.tokens.some((x) => x.toUpperCase() === norm)) state.tokens.push(t);
  $('#search').value = '';
  state.query = '';
  state.parsed = search.parseQuery('');
  state.pannedFor = '';
  draw();
  clearTimeout(lookupTimer);
  runLookup();
  return true;
}

function removeToken(raw) {
  state.tokens = state.tokens.filter((t) => t !== raw);
  state.pannedFor = '';
  state.lookupNote = '';
  draw();
  clearTimeout(lookupTimer);
  runLookup();
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
  const qs = activeQueries();
  const searching = qs.length > 0;
  const hit = (ac) => qs.some((p) => search.matches(ac, p, routeOf(ac)));
  // Asking for an aircraft by tail or callsign outranks the airline filter:
  // you named it, so hiding it because its operator isn't ticked would just
  // look like the search was broken.
  const named = (ac) => qs.some((p) => search.isTargeted(p) && search.matches(ac, p, routeOf(ac)));
  const byHex = new Map();

  for (const ac of state.aircraft) {
    if (!airlineOk(ac) && !named(ac)) continue;
    if (searching && !hit(ac)) continue;
    byHex.set(ac.hex, ac);
  }

  // Aircraft found by name/registration anywhere in the world — these only
  // exist because they were asked for, so no filter applies.
  for (const ac of state.remote) {
    if (byHex.has(ac.hex)) continue;
    byHex.set(ac.hex, ac);
  }

  // Last-known positions. While searching, any match is worth showing however
  // old; otherwise only recent losses, so the map doesn't fill with fossils.
  if (state.prefs.ghosts) {
    for (const e of history.ghosts()) {
      if (byHex.has(e.hex)) continue;
      if (!Number.isFinite(e.lat)) continue;
      const ac = history.asAircraft(e);
      if (!airlineOk(ac) && !named(ac)) continue;
      if (searching) {
        if (!hit(ac)) continue;
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
  if (!busy) updateLiveBadge(false);
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
    onAction: (act) => onDetailAction(act, sel, route),
  });
  body.scrollTop = keep;
  sheet.classList.add('open');
  sheet.classList.toggle('collapsed', state.detailCollapsed);
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
  // A scheduled time belongs to one flight. If the link named several
  // aircraft there is no way to know whose STA it is, so we don't guess.
  const single = dl && dl.queries.length === 1 ? dl.queries[0] : '';
  const isLinked = single && ac && (
    search.normReg(ac.reg) === search.normReg(search.parseQuery(single).reg || single)
    || ac.callsign === single.toUpperCase()
  );
  // Anchor the scheduled clock time to the estimated arrival, so the two are
  // being compared on the same day (see fmt.parseStaUtc).
  const est = ac.ghost ? null : eta(ac, route);
  const anchor = est && est.at ? est.at : Date.now();
  const staAt = isLinked && dl.sta ? fmt.parseStaUtc(dl.sta, anchor) : 0;
  return {
    eta: est,
    staAt,
    staSource: staAt ? (dl.staSource || 'roster') : '',
  };
}

/** Why the list is empty — the answer differs for a filter and for a search. */
function emptyMessage() {
  const qs = activeQueries();
  if (qs.length) {
    const names = qs.map((p) => search.describe(p)).join(', ');
    return {
      title: qs.length === 1 ? `Nothing matches ${names}.` : `Nothing matches ${names}.`,
      hint: qs.every(search.isTargeted)
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

function onDetailAction(act, ac, route) {
  if (act === 'close') {
    select(null);
  } else if (act === 'follow') {
    radar.setFollow(!radar.getFollow());
    draw();
  } else if (act === 'fit') {
    radar.fitRoute(ac, route);
  } else if (act === 'center') {
    radar.panTo(ac.lat, ac.lon, Math.max(8, radar.getMap().getZoom()));
  }
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

const LIVE_TEXT = { live: 'Live', polling: 'Updating', dr: 'DR', error: 'No feed' };
const LIVE_TITLE = {
  live: `Positions refresh every ${REFRESH_MS / 1000} seconds`,
  polling: 'Fetching positions…',
  dr: 'Dead reckoning — no new data, so aircraft are being flown on from their last fix',
  error: 'No new positions. Symbols are frozen at their last known place.',
};

function setLive(mode) {
  const el = $('#live');
  el.dataset.mode = mode;
  el.querySelector('span').textContent = LIVE_TEXT[mode] || 'Live';
  el.title = LIVE_TITLE[mode] || '';
}

/**
 * Say what the display is actually doing.
 *
 * Between refreshes — and through a dropped one — the symbols keep flying on
 * their last known track, which is dead reckoning, exactly as a crew would mean
 * it. That is genuinely useful (the picture keeps moving the right way) and
 * genuinely not a position report, so the badge says DR rather than Live for as
 * long as it lasts, and No feed once the extrapolation has been given up.
 */
function updateLiveBadge(polling) {
  if (!state.lastAt) { setLive(state.error ? 'error' : 'polling'); return; }
  const age = Date.now() - state.lastAt;
  // A fetch being in flight doesn't make the data fresh. If what's on screen is
  // already extrapolated, keep saying DR rather than flashing "Updating" —
  // otherwise the badge looks healthy for a moment every five seconds while
  // the feed is down.
  if (age > radar.DR_MAX_MS) { setLive('error'); return; }
  if (age > STALE_MS) { setLive('dr'); return; }
  if (polling) { setLive('polling'); return; }
  setLive(state.error ? 'dr' : 'live');
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
  // One chip per committed search term, plus the text still being typed.
  for (const t of state.tokens) {
    chips.push(`<button class="chip term" data-drop-token="${escAttr(t)}">${escAttr(t)}<i>✕</i></button>`);
  }
  if (state.query.trim()) {
    chips.push(`<button class="chip term typing" data-drop-query="1">${escAttr(state.query.trim())}<i>✕</i></button>`);
  }
  el.innerHTML = chips.join('');
  el.hidden = !chips.length;
  el.querySelectorAll('[data-drop-airline]').forEach((b) => b.addEventListener('click', () => {
    state.airlines.delete(b.dataset.dropAirline);
    saveAirlines();
    drawPicker();
    draw();
  }));
  el.querySelectorAll('[data-drop-token]').forEach((b) => b.addEventListener('click', () => {
    removeToken(b.dataset.dropToken);
  }));
  const dq = el.querySelector('[data-drop-query]');
  if (dq) dq.addEventListener('click', () => { $('#search').value = ''; onQueryChanged(''); });
}

const escAttr = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

let statusTimer = null;
function showStatus(msg, sticky) {
  const el = $('#status');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(statusTimer);
  if (!sticky) statusTimer = setTimeout(() => el.classList.add('hidden'), 4500);
}

function collapseList() { $('#list').classList.remove('open'); }

/**
 * Drag the top of a sheet up or down to open or fold it.
 *
 * The gesture is the affordance — a phone user reaches for the top edge of a
 * card and pulls, and there's no button to hunt for. The sheet follows the
 * finger while dragging and snaps on release; a short drag counts as a tap so
 * the header still toggles.
 *
 * @param {HTMLElement} sheet     the sheet element
 * @param {() => boolean} isOpen  current state
 * @param {(v:boolean) => void} setOpen  apply the new state
 */
function installDragToFold(sheet, isOpen, setOpen) {
  const SNAP_PX = 40;
  let startY = 0;
  let dy = 0;
  let dragging = false;
  let pointerId = null;

  const grabbable = (target) => !!target.closest('.sheet-grip, .sheet-head, .list-head')
    && !target.closest('button.sheet-close, button.act');

  sheet.addEventListener('pointerdown', (e) => {
    if (!grabbable(e.target)) return;
    dragging = true;
    pointerId = e.pointerId;
    startY = e.clientY;
    dy = 0;
    sheet.style.transition = 'none';
    try { sheet.setPointerCapture(pointerId); } catch { /* not fatal */ }
  });

  sheet.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== pointerId) return;
    dy = e.clientY - startY;
    // Only the direction that means something: down folds an open sheet, up
    // opens a folded one. Resisting the other way keeps the gesture honest.
    const allowed = isOpen() ? Math.max(0, dy) : Math.min(0, dy);
    sheet.style.transform = `translateY(${allowed * 0.6}px)`;
    if (Math.abs(dy) > 6) e.preventDefault();
  });

  const finish = (e) => {
    if (!dragging || (e && e.pointerId !== pointerId)) return;
    dragging = false;
    try { sheet.releasePointerCapture(pointerId); } catch { /* ignore */ }
    sheet.style.transition = '';
    sheet.style.transform = '';
    if (Math.abs(dy) >= SNAP_PX) {
      setOpen(dy < 0);
      // A drag ends with a click on the same element; without swallowing it the
      // header's tap-to-toggle would immediately undo the drag.
      const swallow = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
      sheet.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(() => sheet.removeEventListener('click', swallow, { capture: true }), 400);
    }
    dy = 0;
  };
  sheet.addEventListener('pointerup', finish);
  sheet.addEventListener('pointercancel', finish);
}

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
    // The map cancels follow when the user drags; repaint so the sheet's
    // Follow button stops claiming it's on.
    onFollowCancelled: () => draw(),
  });

  buildLegend();
  state.airlines = loadAirlines();

  toggleChip('#labels-btn', 'labels', (v) => { radar.setLabels(v); radar.render(visible(), state.selectedHex); });
  toggleChip('#trails-btn', 'trails', (v) => radar.setTrails(v));
  toggleChip('#ground-btn', 'ground', () => { if (state.lastAt) refresh(true); });
  toggleChip('#ghosts-btn', 'ghosts', () => draw());

  $('#airline-btn').addEventListener('click', () => togglePicker());
  $('#picker-close').addEventListener('click', () => togglePicker(false));

  // The header is the fold handle: tap it, or drag it up and down.
  $('#list-head').addEventListener('click', () => $('#list').classList.toggle('open'));
  if (window.matchMedia('(min-width: 820px)').matches) $('#list').classList.add('open');
  installDragToFold($('#list'),
    () => $('#list').classList.contains('open'),
    (v) => $('#list').classList.toggle('open', v));
  installDragToFold($('#detail'),
    () => !state.detailCollapsed,
    (v) => { state.detailCollapsed = !v; draw(); });

  $('#search').addEventListener('input', (e) => {
    if (e.target.value) $('#list').classList.add('open');
    // A comma finishes a term, so "EKA, EHH" works as one piece of typing.
    if (e.target.value.includes(',')) {
      const parts = e.target.value.split(',');
      const tail = parts.pop();
      parts.forEach((p) => p.trim() && commitToken(p));
      e.target.value = tail.trim();
    }
    onQueryChanged(e.target.value);
  });

  $('#search').addEventListener('keydown', (e) => {
    // Enter commits what's typed as its own term and clears the box, so the
    // next aircraft can be typed straight after — like addressing an email.
    if (e.key === 'Enter') {
      e.preventDefault();
      if (!commitToken()) { clearTimeout(lookupTimer); runLookup(); }
      return;
    }
    // Backspace in an empty box takes the last term back off.
    if (e.key === 'Backspace' && !e.target.value && state.tokens.length) {
      e.preventDefault();
      removeToken(state.tokens[state.tokens.length - 1]);
    }
  });

  $('#locate-btn').addEventListener('click', () => {
    if (!navigator.geolocation) { showStatus('This device has no location service.'); return; }
    // Asking for your own position outranks following an aircraft — otherwise
    // follow drags the map back off you a quarter-second later.
    if (radar.cancelFollow()) draw();
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
    // Every named aircraft becomes a committed term, exactly as if it had been
    // typed in and entered.
    state.tokens = state.deepLink.queries.slice();
    onQueryChanged('');
    // Cancel the typing debounce: the first refresh below runs the lookup
    // itself, so the aircraft are fetched once rather than twice.
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
