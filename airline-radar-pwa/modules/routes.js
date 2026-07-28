// routes.js — "where is it coming from and going to?", from adsbdb.com.
//
// Raw ADS-B carries no route: a 737 broadcasts its position and its callsign,
// never its city pair. adsbdb is a free, keyless, CORS-open database that maps
// a callsign to its airline and its origin/destination airports, and a Mode-S
// hex or registration to the airframe (type, owner, photo). That's the whole
// difference between a dot on a map and a flight.
//
// Two rules keep us a good citizen of a volunteer-run API:
//   • every answer is cached in localStorage, so a given callsign is asked
//     about once, not once per 5-second refresh;
//   • lookups go through a serial queue with a minimum gap, so panning across a
//     busy TMA can't fire eighty requests at once.

const API = 'https://api.adsbdb.com/v0';
const GAP_MS = 500;                       // ≤ 2 lookups/sec on one shared queue
const ROUTE_TTL = 14 * 24 * 3600 * 1000;  // schedules drift — re-ask fortnightly
const AC_TTL = 120 * 24 * 3600 * 1000;    // airframes barely change
const LS_KEY = 'airadar.lookups';
const MAX_ENTRIES = 1200;

let cache = load();
let saveTimer = null;
let queue = Promise.resolve();
const pending = new Map();   // key → Promise, so we ask once per key in flight

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return raw && typeof raw === 'object' ? raw : {};
  } catch { return {}; }
}

function saveSoon() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const keys = Object.keys(cache);
      if (keys.length > MAX_ENTRIES) {
        // Drop the oldest third rather than clearing — keeps the busy airports warm.
        keys.sort((a, b) => (cache[a].at || 0) - (cache[b].at || 0))
          .slice(0, keys.length - Math.floor(MAX_ENTRIES * 0.66))
          .forEach((k) => delete cache[k]);
      }
      localStorage.setItem(LS_KEY, JSON.stringify(cache));
    } catch { /* quota or private mode — the memory cache still works */ }
  }, 1500);
}

function fresh(key, ttl) {
  const rec = cache[key];
  if (!rec) return undefined;
  if (Date.now() - (rec.at || 0) > ttl) return undefined;
  return rec.v;          // may be null — a cached "we asked, there's nothing"
}

/** Serial, rate-limited GET returning parsed JSON or null on 404/any failure. */
function get(path) {
  const run = queue.then(async () => {
    await new Promise((r) => setTimeout(r, GAP_MS));
    try {
      const res = await fetch(`${API}${path}`, { cache: 'no-store' });
      if (!res.ok) return null;
      const json = await res.json();
      return json && typeof json.response === 'object' ? json.response : null;
    } catch { return null; }
  });
  // Keep the chain alive even if one lookup throws.
  queue = run.catch(() => {});
  return run;
}

function airportOf(a) {
  if (!a) return null;
  return {
    iata: a.iata_code || '',
    icao: a.icao_code || '',
    name: a.name || '',
    city: a.municipality || '',
    country: a.country_name || '',
    countryIso: a.country_iso_name || '',
    lat: Number(a.latitude),
    lon: Number(a.longitude),
    elev: Number(a.elevation),
  };
}

/**
 * Route + operator for a callsign.
 * @returns {Promise<{airline:object|null, origin:object|null, destination:object|null,
 *                    iata:string}|null>}  null when adsbdb doesn't know it.
 */
export function lookupRoute(callsign) {
  const key = `r:${callsign}`;
  const hit = fresh(key, ROUTE_TTL);
  if (hit !== undefined) return Promise.resolve(hit);
  if (pending.has(key)) return pending.get(key);

  const p = get(`/callsign/${encodeURIComponent(callsign)}`).then((resp) => {
    const fr = resp && resp.flightroute;
    let v = null;
    if (fr) {
      v = {
        iata: fr.callsign_iata || '',
        airline: fr.airline ? {
          name: fr.airline.name || '',
          icao: fr.airline.icao || '',
          iata: fr.airline.iata || '',
          country: fr.airline.country || '',
          countryIso: fr.airline.country_iso || '',
        } : null,
        origin: airportOf(fr.origin),
        destination: airportOf(fr.destination),
        midpoint: airportOf(fr.midpoint),
      };
    }
    cache[key] = { v, at: Date.now() };
    saveSoon();
    return v;
  }).finally(() => pending.delete(key));

  pending.set(key, p);
  return p;
}

/**
 * Airframe details for a Mode-S hex (or a registration).
 * @returns {Promise<{type,icaoType,manufacturer,reg,owner,ownerCountry,photo,thumb}|null>}
 */
export function lookupAircraft(hexOrReg) {
  const id = String(hexOrReg || '').trim();
  if (!id) return Promise.resolve(null);
  const key = `a:${id.toUpperCase()}`;
  const hit = fresh(key, AC_TTL);
  if (hit !== undefined) return Promise.resolve(hit);
  if (pending.has(key)) return pending.get(key);

  const p = get(`/aircraft/${encodeURIComponent(id)}`).then((resp) => {
    const a = resp && resp.aircraft;
    let v = null;
    if (a) {
      v = {
        type: a.type || '',
        icaoType: a.icao_type || '',
        manufacturer: a.manufacturer || '',
        reg: a.registration || '',
        modeS: a.mode_s || '',
        owner: a.registered_owner || '',
        ownerCountry: a.registered_owner_country_name || '',
        operatorFlag: a.registered_owner_operator_flag_code || '',
        photo: a.url_photo || '',
        thumb: a.url_photo_thumbnail || '',
      };
    }
    cache[key] = { v, at: Date.now() };
    saveSoon();
    return v;
  }).finally(() => pending.delete(key));

  pending.set(key, p);
  return p;
}

/** Cached route without asking the network — for map labels during a refresh. */
export function cachedRoute(callsign) {
  const v = fresh(`r:${callsign}`, ROUTE_TTL);
  return v === undefined ? undefined : v;
}

/** "TLV → CPH" (IATA where known, ICAO otherwise). */
export function routeLabel(route) {
  if (!route) return '';
  const o = route.origin && (route.origin.iata || route.origin.icao);
  const d = route.destination && (route.destination.iata || route.destination.icao);
  if (!o && !d) return '';
  return `${o || '?'} → ${d || '?'}`;
}

/** How far along the great-circle the aircraft is, 0–1, or null. */
export function progress(route, lat, lon) {
  if (!route || !route.origin || !route.destination) return null;
  const { origin: o, destination: d } = route;
  if (!Number.isFinite(o.lat) || !Number.isFinite(d.lat)) return null;
  const total = haversine(o.lat, o.lon, d.lat, d.lon);
  if (total < 1) return null;
  const done = haversine(o.lat, o.lon, lat, lon);
  return Math.max(0, Math.min(1, done / total));
}

/**
 * Time to run to the destination, from the distance still to fly and the speed
 * the aircraft is doing right now.
 *
 * This is deliberately the simple calculation, and it is optimistic by the few
 * minutes an arrival actually costs: it flies the great circle at the current
 * ground speed, with no descent profile, no arrival routing and no wind change.
 * Anything more would be a guess dressed up as a number — the honest fix is to
 * label it as an estimate from ground speed, which the UI does.
 *
 * @returns {{minutes:number, at:number, toGoNm:number}|null}
 */
export function eta(ac, route, now = Date.now()) {
  if (!ac || !route || !route.destination) return null;
  const d = route.destination;
  if (!Number.isFinite(d.lat) || !Number.isFinite(ac.lat)) return null;
  const toGoNm = haversine(ac.lat, ac.lon, d.lat, d.lon);
  // Below taxi speed there is no meaningful arrival time to compute.
  if (!Number.isFinite(ac.gs) || ac.gs < 60) return { minutes: null, at: 0, toGoNm };
  const minutes = (toGoNm / ac.gs) * 60;
  return { minutes, at: now + minutes * 60000, toGoNm };
}

/** Great-circle distance in nautical miles. */
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 3440.065; // NM
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function clearCache() {
  cache = {};
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}
