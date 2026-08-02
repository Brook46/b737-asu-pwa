// history.js — where each aircraft was last seen.
//
// ADS-B is not a promise. An aircraft drops off the feed when it lands, when it
// flies out of receiver coverage, and when the crew switches the transponder to
// standby — and from a client's point of view those look identical. What we can
// say honestly is *where and when we last had it*, so that's what we store.
//
// Two things this buys:
//   • searching for a tail that isn't transmitting still puts it on the map, at
//     its last known position, labelled with how long ago that was;
//   • an aircraft that vanishes mid-air, well inside the area we were watching,
//     is flagged as a contact lost rather than silently disappearing.
//
// The distinction that keeps this from lying: an aircraft near the edge of the
// query circle simply flew out of the area we asked about. Only a disappearance
// comfortably *inside* the circle, while airborne, counts as losing contact.

const LS_KEY = 'airadar.history';
const TTL_MS = 24 * 3600 * 1000;      // a day of memory; older is noise
const MAX_ENTRIES = 600;
const EDGE_FRACTION = 0.85;           // inside this share of the radius = "inside"
const MISSES_TO_CONFIRM = 3;          // consecutive polls absent before we believe it
const MASS_LOSS_FRACTION = 0.35;      // more than this vanishing at once = not real

let entries = load();
let watching = new Set();             // hexes we expect to see again
let liveHexes = new Set();            // hexes in the most recent snapshot
let saveTimer = null;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    if (!raw || typeof raw !== 'object') return {};
    const now = Date.now();
    for (const k of Object.keys(raw)) {
      if (!raw[k] || now - (raw[k].at || 0) > TTL_MS) delete raw[k];
    }
    return raw;
  } catch { return {}; }
}

function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const keys = Object.keys(entries);
      if (keys.length > MAX_ENTRIES) {
        keys.sort((a, b) => (entries[a].at || 0) - (entries[b].at || 0))
          .slice(0, keys.length - MAX_ENTRIES)
          .forEach((k) => delete entries[k]);
      }
      localStorage.setItem(LS_KEY, JSON.stringify(entries));
    } catch { /* quota / private mode: memory-only is fine */ }
  }, 2000);
}

function nmBetween(lat1, lon1, lat2, lon2) {
  const R = 3440.065;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Which patch of sky a snapshot covered — entries are only comparable within one. */
function areaKeyOf(area) {
  if (!area) return '';
  return `${area.lat.toFixed(1)},${area.lon.toFixed(1)},${Math.round(area.radiusNm / 25)}`;
}

/**
 * Fold one snapshot into the history.
 *
 * Deciding that an aircraft "went dark" is the delicate part. A single missing
 * record means very little: aggregated ADS-B is stitched together from
 * volunteer receivers, so in a busy area the returned set breathes by dozens of
 * aircraft between one poll and the next, and panning the map changes the
 * question entirely. Three filters keep this honest:
 *
 *   • it must be missing from MISSES_TO_CONFIRM consecutive polls;
 *   • the polls must be asking about the same patch of sky it was last seen in;
 *   • and if a large share of the previous snapshot vanishes at once, that's the
 *     feed hiccupping or the map moving — nobody switched off a transponder.
 *
 * Everything is still *remembered* either way; this only decides what we are
 * willing to call a lost contact and show on the map unasked.
 *
 * @param {Array} list      normalised aircraft currently on the feed
 * @param {{lat,lon,radiusNm}} area  what we just asked the feed about
 * @returns {Array} entries confirmed as having gone quiet on this refresh
 */
export function record(list, area) {
  const now = Date.now();
  const areaKey = areaKeyOf(area);
  const seen = new Set();

  for (const ac of list) {
    seen.add(ac.hex);
    const prev = entries[ac.hex];
    // The moment an aircraft we were watching airborne shows up on the ground
    // is the only actual arrival time a position feed can give us. Recorded
    // once, and only for a transition we actually witnessed — an aircraft first
    // seen already parked has no ATA, and inventing one from "first seen on the
    // ground" would put a landing time on an aeroplane that landed yesterday.
    const justLanded = prev && !prev.onGround && ac.onGround && prev.alt > 0;
    entries[ac.hex] = {
      hex: ac.hex,
      callsign: ac.callsign,
      code: ac.code,
      reg: ac.reg,
      type: ac.type,
      desc: ac.desc,
      airlineName: ac.airline ? ac.airline.name : '',
      lat: ac.lat, lon: ac.lon,
      alt: ac.alt, track: ac.track, gs: ac.gs,
      onGround: ac.onGround,
      at: now,
      areaKey,
      misses: 0,
      lost: false,
      lostAt: 0,
      wentDark: false,
      firstSeen: (prev && prev.firstSeen) || now,
      landedAt: justLanded ? now : (prev && ac.onGround ? prev.landedAt || 0 : 0),
      landedLat: justLanded ? ac.lat : (prev && ac.onGround ? prev.landedLat : undefined),
      landedLon: justLanded ? ac.lon : (prev && ac.onGround ? prev.landedLon : undefined),
    };
  }

  const missing = [...watching].filter((hex) => !seen.has(hex));
  const massLoss = watching.size > 8 && missing.length > watching.size * MASS_LOSS_FRACTION;

  const newlyDark = [];
  const stillWatching = new Set(seen);

  for (const hex of missing) {
    const e = entries[hex];
    if (!e) continue;
    e.lost = true;

    // A different patch of sky, or half the picture gone at once: we have no
    // grounds to say anything about this aircraft, so stop watching it.
    if (massLoss || e.areaKey !== areaKey) { e.misses = 0; continue; }

    e.misses = (e.misses || 0) + 1;
    if (e.misses < MISSES_TO_CONFIRM) { stillWatching.add(hex); continue; }

    const inside = area && Number.isFinite(e.lat)
      && nmBetween(area.lat, area.lon, e.lat, e.lon) < area.radiusNm * EDGE_FRACTION;
    // Airborne, and comfortably inside the circle we were watching: a contact
    // we lost, rather than one that simply flew out of the area or landed.
    e.wentDark = !!(inside && !e.onGround && (e.alt === null || e.alt > 1000));
    if (e.wentDark) { e.lostAt = now; newlyDark.push(e); }
  }

  watching = stillWatching;
  liveHexes = seen;
  saveSoon();
  return newlyDark;
}

/** Every remembered aircraft that isn't on the feed right now. */
export function ghosts() {
  const out = [];
  const now = Date.now();
  for (const hex of Object.keys(entries)) {
    const e = entries[hex];
    if (!e || liveHexes.has(hex)) continue;
    if (now - (e.at || 0) > TTL_MS) { delete entries[hex]; continue; }
    out.push(e);
  }
  return out;
}

/** Shape a history entry like a live aircraft, so the map and list can draw it. */
export function asAircraft(e) {
  return {
    hex: e.hex,
    callsign: e.callsign || '',
    code: e.code || '',
    flightNo: '',
    airline: e.airlineName ? { name: e.airlineName } : null,
    reg: e.reg || '',
    type: e.type || '',
    desc: e.desc || '',
    lat: e.lat, lon: e.lon,
    alt: e.alt, onGround: !!e.onGround,
    gs: e.gs ?? null, track: e.track ?? null,
    vs: null, squawk: '', emergency: '', category: '',
    seen: (Date.now() - (e.at || 0)) / 1000,
    mach: null, ias: null, nav_alt: null, qnh: null, wind: null, oat: null,
    dst: null,
    // Flags the renderers key off.
    ghost: true,
    lastSeenAt: e.at || 0,
    wentDark: !!e.wentDark,
  };
}

/** When we watched this aircraft touch down, if we did. 0 otherwise. */
export function landedAt(hex) {
  const e = entries[hex];
  return (e && e.landedAt) || 0;
}

export function count() { return Object.keys(entries).length; }

export function clear() {
  entries = {};
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}
