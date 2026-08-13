// Airline Radar — live airline traffic on a map.
//
// The loop is deliberately small: every REFRESH_MS ask airplanes.live for one
// snapshot of the sky around the map centre, run every record past the airline
// filter, hand the survivors to the map and the list, and lazily fill in routes
// from adsbdb for the ones the user can actually see.
//
// Everything else in here is state plumbing: selection, filters, view
// persistence and the two bottom sheets.

import {
  fetchArea, fetchOne, radiusForMap, radiusForZoom, normalise, feedSource, MAX_RADIUS_NM,
} from './modules/adsb.js?v=13';
import { classify, lookup as lookupAirline, KIND_LABEL } from './modules/airlines.js?v=13';
import * as radar from './modules/map.js?v=13';
import * as sky from './modules/map3d.js?v=13';
import { lookupRoute, lookupAircraft, cachedRoute, eta, routeLabel as routeLabelOf } from './modules/routes.js?v=13';
import {
  renderList, renderDetail, renderAirlines, renderView, CELL_KEYS, DEFAULT_PINNED,
} from './modules/panel.js?v=13';
import { LEGEND, altColor as altColorOf, sizeClass, classLine } from './modules/aircraft.js?v=13';
import { installResumeHardening } from './modules/resume.js?v=13';
import * as history from './modules/history.js?v=13';
import * as search from './modules/search.js?v=13';
import * as fmt from './modules/fmt.js?v=13';

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
const KINDS_KEY = 'airadar.kinds';
const PINNED_KEY = 'airadar.pinnedCells';

// Three tiers of detail on the map: full symbol+label near you (and always for
// your own fleet or anything selected/searched), a muted symbol further out,
// and just a dot beyond that — so forty aircraft on screen don't all compete
// for attention equally. The rule is stated in the Show sheet, from these same
// two numbers, so it's never a silent, undocumented cutoff.
const TIER_NEAR_NM = 40;
const TIER_FAR_NM = 120;
const HOME_FLEET_PREFIX = '4X-';   // Israeli registrations; see modules/search.js
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
  kinds: new Set(['airline']),   // which kinds of traffic are drawn
  pickerQuery: '',
  deepLink: null,        // {queries, sta, staSource} — see readDeepLink()
  autoSelected: false,   // the deep-linked aircraft has been opened once
  detailCollapsed: false,// the aircraft card is folded down to its header
  view3d: false,         // the 3D canvas is the active view
  pinnedCells: loadPinned(),   // which detail-card values show without folding
  pinEditMode: false,    // tapping a value pins/unpins it while this is true
  valuesFoldOpen: false, // "everything else" disclosure on the detail card
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

function loadKinds() {
  try {
    const a = JSON.parse(localStorage.getItem(KINDS_KEY) || 'null');
    if (Array.isArray(a) && a.length) return new Set(a.filter((k) => KIND_LABEL[k]));
  } catch { /* ignore */ }
  return new Set(['airline']);   // the app's default layer
}

function saveKinds() {
  try { localStorage.setItem(KINDS_KEY, JSON.stringify([...state.kinds])); } catch { /* ignore */ }
}

function loadPinned() {
  try {
    const a = JSON.parse(localStorage.getItem(PINNED_KEY) || 'null');
    if (Array.isArray(a) && a.length) return new Set(a.filter((k) => CELL_KEYS.includes(k)));
  } catch { /* ignore */ }
  return new Set(DEFAULT_PINNED);
}

function savePinned() {
  try { localStorage.setItem(PINNED_KEY, JSON.stringify([...state.pinnedCells])); } catch { /* ignore */ }
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
    // Whichever view is on screen decides the patch of sky we ask about.
    const v3 = state.view3d && sky.isOpen() ? sky.getView() : null;
    const c = v3 ? { lat: v3.lat, lng: v3.lon } : map.getCenter();
    const radius = v3 ? radiusForZoom(v3.zoom) : radiusForMap(map);
    const { aircraft, at, clipped } = await fetchArea(c.lat, c.lng, radius);

    const out = [];
    for (const raw of aircraft) {
      if (!Number.isFinite(raw.lat) || !Number.isFinite(raw.lon)) continue;
      // Everything is classified; which kinds are drawn is the layer filter's
      // job (see kindOk), so switching a layer on doesn't need a new fetch.
      const ac = normalise(raw, classify(raw));
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
    // No separate banner for this: the Live pill already turns amber (DR) or
    // red (No feed) with the reason in its title, so a floating status pill
    // saying the same thing a second time would just be a seventh overlay.
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

/**
 * Offer the aircraft the typed text could mean, so choosing one is a tap
 * instead of a guess at the exact callsign. Draws from what's in view, what the
 * global lookup found, and what we last saw — the same three sources the list
 * uses — so a tail that has stopped transmitting is still offered.
 */
function drawSuggestions() {
  const el = $('#suggest');
  const q = state.parsed.text;
  if (!q || q.length < 2) { el.hidden = true; el.innerHTML = ''; return; }

  const seen = new Set(state.tokens.map((t) => t.toUpperCase()));
  const pool = [...state.aircraft, ...state.remote];
  for (const e of history.ghosts()) pool.push(history.asAircraft(e));

  const hits = [];
  const used = new Set();
  for (const ac of pool) {
    if (used.has(ac.hex)) continue;
    if (!search.matches(ac, state.parsed, routeOf(ac))) continue;
    if (seen.has((ac.callsign || '').toUpperCase())) continue;
    used.add(ac.hex);
    hits.push(ac);
    if (hits.length >= 8) break;
  }
  if (!hits.length) { el.hidden = true; el.innerHTML = ''; return; }

  el.innerHTML = hits.map((ac) => {
    const route = routeOf(ac);
    const r = routeLabelOf(route);
    const who = (ac.airline && ac.airline.name)
      || (route && route.airline && route.airline.name) || ac.code || '';
    return `<button class="sug-row" data-hex="${escAttr(ac.hex)}" role="option">
      <span class="sug-dot" style="background:${ac.ghost ? '#9aa6bd' : altColorOf(ac.alt)}"></span>
      <span class="sug-main"><b>${escAttr(ac.callsign || ac.reg)}</b>
        <i>${escAttr([ac.reg, who, r].filter(Boolean).join(' · '))}</i></span>
      <span class="sug-alt">${escAttr(ac.ghost ? 'last seen' : fmt.alt(ac.alt, ac.onGround))}</span>
    </button>`;
  }).join('');
  el.hidden = false;
  el.querySelectorAll('.sug-row').forEach((b) => {
    b.addEventListener('mousedown', (e) => e.preventDefault());   // keep focus
    b.addEventListener('click', () => {
      const ac = pool.find((a) => a.hex === b.dataset.hex);
      if (!ac) return;
      // Picking one is the same as typing its callsign and pressing Enter.
      $('#search').value = '';
      commitToken(ac.callsign || ac.reg || ac.hex);
      hideSuggestions();
      select(ac.hex);
    });
  });
}

function hideSuggestions() {
  const el = $('#suggest');
  if (el) { el.hidden = true; el.innerHTML = ''; }
}

/**
 * Several aircraft under one tap: show them all and let the user say which.
 * Reuses the suggestion list, since it answers the same question — "which of
 * these did you mean?" — and appears anchored to the search box either way.
 */
function showStack(hexes) {
  const el = $('#suggest');
  const list = visible();
  const picks = hexes.map((h) => list.find((a) => a.hex === h)).filter(Boolean);
  if (picks.length < 2) { if (picks[0]) select(picks[0].hex); return; }

  el.innerHTML = `<div class="sug-head">${picks.length} aircraft here — pick one</div>`
    + picks.map((ac) => {
      const route = routeOf(ac);
      const who = (ac.airline && ac.airline.name)
        || (route && route.airline && route.airline.name) || ac.code || '';
      return `<button class="sug-row" data-hex="${escAttr(ac.hex)}" role="option">
        <span class="sug-dot" style="background:${ac.ghost ? '#9aa6bd' : altColorOf(ac.alt)}"></span>
        <span class="sug-main"><b>${escAttr(ac.callsign || ac.reg)}</b>
          <i>${escAttr([ac.reg, who, routeLabelOf(route)].filter(Boolean).join(' · '))}</i></span>
        <span class="sug-alt">${escAttr(fmt.alt(ac.alt, ac.onGround))}</span>
      </button>`;
    }).join('');
  el.hidden = false;
  el.querySelectorAll('.sug-row').forEach((b) => {
    b.addEventListener('click', () => { hideSuggestions(); select(b.dataset.hex); });
  });
}

/** Re-read the text in the box, filter immediately, schedule the lookup. */
function onQueryChanged(raw) {
  state.query = raw;
  state.parsed = search.parseQuery(raw);
  state.lookupNote = '';
  if (!activeQueries().some(search.isTargeted)) { state.remote = []; state.pannedFor = ''; }
  draw();
  drawSuggestions();

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
  hideSuggestions();
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
  if (state.airlines.size === 0) return true;
  // The airline picker only governs airline traffic; ticking "El Al" shouldn't
  // silently hide every helicopter as well.
  if (ac.kind && ac.kind !== 'airline') return true;
  return state.airlines.has(ac.code);
}

// Zoomed out past this, small aircraft are dropped from the picture. A light
// aircraft pottering around a field is meaningful at 20 NM across the screen
// and pure clutter at 600 — at that scale the only traffic worth drawing is
// what crosses the country.
const DECLUTTER_ZOOM = 7;
const SMALL_KINDS = new Set(['light', 'heli', 'bizjet']);

/** Is the map wide enough that small aircraft are just noise? */
function decluttering() {
  if (state.view3d && sky.isOpen()) {
    const v = sky.getView();
    return !!v && v.zoom < DECLUTTER_ZOOM;
  }
  const map = radar.getMap();
  return !!map && map.getZoom() < DECLUTTER_ZOOM;
}

/** Is this kind of traffic switched on, and worth drawing at this zoom? */
function kindOk(ac) {
  const kind = ac.kind || 'airline';
  if (!state.kinds.has(kind)) return false;
  if (decluttering() && SMALL_KINDS.has(kind)) return false;
  // Regional turboprops stay; a Cessna-sized airframe doesn't.
  if (decluttering() && sizeClass(ac.type, ac.category) === 'light') return false;
  return true;
}

/**
 * Which of the three map tiers this aircraft earns: full symbol, label and
 * altitude nearby — or for your own fleet, or anything selected or named by a
 * search — a muted symbol further out, and just a dot beyond that. `ac.dst` is
 * the distance from the map centre the feed already returns with every
 * record, so this needs no extra data and no extra request.
 */
function tierFor(ac, named) {
  if (ac.ghost || named || ac.hex === state.selectedHex) return 1;
  if (ac.reg && ac.reg.toUpperCase().startsWith(HOME_FLEET_PREFIX)) return 1;
  const d = ac.dst;
  if (!Number.isFinite(d)) return 1;   // unknown distance — never hide by default
  if (d <= TIER_NEAR_NM) return 1;
  if (d <= TIER_FAR_NM) return 2;
  return 3;
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
    if (!(airlineOk(ac) && kindOk(ac)) && !named(ac)) continue;
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
      if (!(airlineOk(ac) && kindOk(ac)) && !named(ac)) continue;
      if (searching) {
        if (!hit(ac)) continue;
      } else if (!e.wentDark || Date.now() - (e.at || 0) > GHOST_MAX_AGE_MS) {
        continue;
      }
      byHex.set(ac.hex, ac);
    }
  }

  const out = [...byHex.values()];
  for (const ac of out) ac.tier = tierFor(ac, named(ac));
  out.sort((a, b) => {
    if (!!a.ghost !== !!b.ghost) return a.ghost ? 1 : -1;   // live traffic first
    return (a.dst ?? 9999) - (b.dst ?? 9999);
  });
  return out;
}

function draw() {
  const list = visible();
  radar.render(list, state.selectedHex);
  if (state.view3d && sky.isOpen()) sky.setTraffic(list, state.selectedHex);

  const live = list.filter((a) => !a.ghost).length;
  const ghosts = list.length - live;
  $('#count').textContent = `${live === 1 ? '1 flight' : `${live} flights`}`
    + (ghosts ? ` · ${ghosts} last seen` : '');
  $('#stamp').textContent = state.lastAt ? fmt.clock(state.lastAt) : '';
  if (!busy) updateLiveBadge(false);
  drawFilterBar(live);
  drawTokenChips();

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
    pinned: state.pinnedCells,
    editing: state.pinEditMode,
    foldOpen: state.valuesFoldOpen,
    onAction: (act, extra) => onDetailAction(act, sel, route, extra),
  });
  body.scrollTop = keep;
  sheet.classList.add('open');
  sheet.classList.toggle('collapsed', state.detailCollapsed);
  radar.drawRoute(sel, route);
  if (state.view3d && sky.isOpen()) sky.setRoute(sel, route, radar.trackFor(sel.hex));
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
  const ataAt = history.landedAt(ac.hex);
  const anchor = ataAt || (est && est.at ? est.at : Date.now());
  const staAt = isLinked && dl.sta ? fmt.parseStaUtc(dl.sta, anchor) : 0;
  return {
    eta: est,
    ataAt,
    staAt,
    staSource: staAt ? (dl.staSource || 'roster') : '',
    track: radar.trackSpan(ac.hex),
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

function onDetailAction(act, ac, route, extra) {
  if (act === 'close') {
    select(null);
  } else if (act === 'follow') {
    radar.setFollow(!radar.getFollow());
    draw();
  } else if (act === 'fit') {
    radar.fitRoute(ac, route);
  } else if (act === 'center') {
    radar.panTo(ac.lat, ac.lon, Math.max(8, radar.getMap().getZoom()));
  } else if (act === 'toggle-edit') {
    state.pinEditMode = !state.pinEditMode;
    draw();
  } else if (act === 'toggle-fold') {
    state.valuesFoldOpen = !state.valuesFoldOpen;
    draw();
  } else if (act === 'pin' && extra) {
    if (state.pinnedCells.has(extra)) state.pinnedCells.delete(extra);
    else state.pinnedCells.add(extra);
    savePinned();
    draw();
  }
}

// ── selection ───────────────────────────────────────────────────────────────

function select(hex) {
  if (hex === state.selectedHex) hex = null;      // tapping again deselects
  state.selectedHex = hex;
  state.selectedInfo = null;
  state.pinEditMode = false;
  state.valuesFoldOpen = false;
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
  // Say which feed the positions came from whenever it isn't the usual one.
  // Substituting a source silently would make the pill a small lie: the data
  // is just as live, but it's a different network's copy of it.
  const standby = feedSource() === 'standby';
  el.title = (LIVE_TITLE[mode] || '')
    + (standby ? ' — airplanes.live is refusing requests, so this is the standby feed (adsb.lol / adsb.fi) via the proxy.' : '');
  el.classList.toggle('standby', standby);
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
    // Only airline traffic with an identified operator belongs in this list —
    // a callsign-less airliner has no operator to filter by, and an empty row
    // with a count next to it is just a puzzle.
    if (ac.kind !== 'airline' || !ac.code) continue;
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
  const counts = {};
  for (const ac of state.aircraft) counts[ac.kind] = (counts[ac.kind] || 0) + 1;
  const dz = decluttering();
  const kinds = Object.entries(KIND_LABEL).map(([key, label]) => ({
    key, label, on: state.kinds.has(key), count: counts[key] || 0,
    // Switched on but not drawn, because the map is too far out to be useful.
    muted: dz && SMALL_KINDS.has(key) && state.kinds.has(key),
  }));

  renderAirlines($('#picker-body'), airlineOptions(), state.airlines, {
    query: state.pickerQuery,
    kinds,
    tierInfo: { near: TIER_NEAR_NM, far: TIER_FAR_NM },
    onToggleKind: (k) => {
      if (state.kinds.has(k)) state.kinds.delete(k);
      else state.kinds.add(k);
      if (!state.kinds.size) state.kinds.add('airline');   // never show nothing
      saveKinds();
      drawPicker();
      draw();
    },
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
  if (show) { drawPicker(); collapseList(); toggleViewSheet(false); }
}

/**
 * What used to be a chip per chosen airline is now one line: what's showing,
 * and how many of it. It doubles as the door back into the Show sheet, so the
 * scope is always visible without six overlays competing for the same strip
 * of screen.
 */
function filterScopeText() {
  if (state.airlines.size) {
    const names = [...state.airlines].map((c) => (lookupAirline(c) || {}).name || c);
    return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2} more` : names.join(', ');
  }
  const labels = [...state.kinds].map((k) => (KIND_LABEL[k] || k).toLowerCase());
  return labels.join(', ') || 'nothing';
}

function drawFilterBar(liveCount) {
  const n = liveCount === undefined ? visible().filter((a) => !a.ghost).length : liveCount;
  $('#filter-bar').innerHTML =
    `<span>Showing ${escAttr(filterScopeText())} · ${n} in view</span><b>Change</b>`;
}

/** Search terms only now — what's tracked, removable one at a time. */
function drawTokenChips() {
  const el = $('#chips');
  const chips = [];
  for (const t of state.tokens) {
    chips.push(`<button class="chip term" data-drop-token="${escAttr(t)}">${escAttr(t)}<i>✕</i></button>`);
  }
  if (state.query.trim()) {
    chips.push(`<button class="chip term typing" data-drop-query="1">${escAttr(state.query.trim())}<i>✕</i></button>`);
  }
  el.innerHTML = chips.join('');
  el.hidden = !chips.length;
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
 * Switch between the flat map and the 3D view.
 *
 * The two share a centre and zoom, and both drive the same selection — the 3D
 * view is a different way of looking at the same state, not a separate app. It
 * mounts on first use (that's when its libraries download) and stays mounted
 * after that, so flipping back and forth is instant.
 */
async function toggle3D(on) {
  const want = on === undefined ? !state.view3d : on;

  if (!want) {
    state.view3d = false;
    // Hand the camera back: whatever you were looking at in 3D is what the
    // flat map should show.
    const v = sky.getView();
    $('#map3d').hidden = true;
    $('#map').hidden = false;
    if (v) radar.panTo(v.lat, v.lon, Math.round(v.zoom));
    radar.getMap().invalidateSize({ animate: false });
    return;
  }

  if (!sky.hasWebGL()) {
    showStatus('This device has no usable WebGL, so the 3D view can’t start.', true);
    return;
  }

  $('#map3d').hidden = false;
  $('#map').hidden = true;
  state.view3d = true;

  if (!sky.isOpen()) {
    showStatus('Loading the 3D view…');
    try {
      const m = radar.getMap();
      const c = m.getCenter();
      await sky.open('map3d', {
        center: { lat: c.lat, lon: c.lng },
        zoom: m.getZoom(),
        onSelect: (hex) => select(hex),
      });
      // Moving the 3D camera asks the feed about the new patch of sky, exactly
      // as panning the flat map does.
      sky.getMap().on('moveend', () => {
        if (!state.view3d) return;
        clearTimeout(moveTimer);
        moveTimer = setTimeout(() => refresh(true), MOVE_DEBOUNCE_MS);
      });
      $('#status').classList.add('hidden');
    } catch (err) {
      state.view3d = false;
      $('#map3d').hidden = true;
      $('#map').hidden = false;
      showStatus(String(err && err.message ? err.message : err), true);
      return;
    }
  } else {
    const m = radar.getMap();
    const c = m.getCenter();
    sky.resize();
    sky.flyTo(c.lat, c.lng, m.getZoom());
  }

  draw();
}

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

// The seven buttons a display preference used to cost are down to one: View.
// Labels/Trails/Last seen/Ground are things you set once, not live actions —
// they don't need permanent screen space beside Show and Me.
const VIEW_ROWS = [
  ['labels', 'Labels', 'Callsign and altitude tags on the map'],
  ['trails', 'Trails', 'Where each aircraft has been'],
  ['ghosts', 'Last seen', 'Keep the last known position of aircraft that stop transmitting'],
  ['ground', 'Ground', 'Include aircraft still on the ground'],
];

function applyPref(key) {
  if (key === 'labels') { radar.setLabels(state.prefs.labels); radar.render(visible(), state.selectedHex); }
  else if (key === 'trails') { radar.setTrails(state.prefs.trails); }
  else if (key === 'ground') { if (state.lastAt) refresh(true); }
  // 'ghosts' needs nothing beyond the draw() every caller already does.
}

function drawViewSheet() {
  const rows = VIEW_ROWS.map(([key, label, desc]) => ({ key, label, desc, on: !!state.prefs[key] }));
  rows.push({
    key: '3d', label: '3D view', on: state.view3d,
    desc: 'Tilted terrain with aircraft at their real altitude. Loads about 1 MB the first time.',
  });

  renderView($('#viewsheet-body'), rows, LEGEND, {
    onToggle: async (key) => {
      if (key === '3d') { await toggle3D(); drawViewSheet(); return; }
      state.prefs[key] = !state.prefs[key];
      savePrefs();
      applyPref(key);
      drawViewSheet();
      draw();
    },
  });
}

function toggleViewSheet(open) {
  const el = $('#viewsheet');
  const show = open === undefined ? !el.classList.contains('open') : open;
  el.classList.toggle('open', show);
  $('#view-btn').setAttribute('aria-pressed', String(show));
  if (show) { drawViewSheet(); collapseList(); togglePicker(false); }
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
    onStackTapped: (hexes) => showStack(hexes),
  });

  state.airlines = loadAirlines();
  state.kinds = loadKinds();
  // The display preferences (Labels/Trails/Last seen/Ground) take effect
  // immediately on load, same as before — only where you change them moved.
  radar.setLabels(state.prefs.labels);
  radar.setTrails(state.prefs.trails);

  $('#airline-btn').addEventListener('click', () => togglePicker());
  $('#picker-close').addEventListener('click', () => togglePicker(false));
  $('#filter-bar').addEventListener('click', () => togglePicker(true));
  $('#view-btn').addEventListener('click', () => toggleViewSheet());
  $('#viewsheet-close').addEventListener('click', () => toggleViewSheet(false));

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
