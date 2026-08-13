// adsb.js — live positions, from airplanes.live where possible.
//
// Why that feed: it's the one free, community-run ADS-B aggregator that sends
// `Access-Control-Allow-Origin: *`, so a static page can fetch it directly with
// no key and no proxy — the same rule that picked OGN for Sky Monkeys. The
// other two candidates (adsb.lol, opendata.adsb.fi) serve identical JSON but no
// CORS header, so the browser can't read them at all.
//
// Which is why there is a standby path. Being the *only* readable source meant
// that the day airplanes.live answered 403 — a block, a rate limit, an outage;
// from the page they're indistinguishable, all three surface as a CORS error —
// the app had nowhere to go and simply said "No feed". The other two mirrors
// carry the same network's data, and the Worker can read them because CORS is
// a browser rule, not a server one. So: direct while direct works, through the
// Worker when it doesn't, and back to direct once it recovers.
//
// House rules we honour: one request per refresh, never faster than 1 Hz, and a
// radius capped at the API's 250 NM limit.

const API = 'https://api.airplanes.live/v2';
// Same Worker the flight card uses; see flight-card-pwa/modules/proxy.js.
const PROXY = 'https://b737-asu-pwa.alonbrookstein.workers.dev/adsb';

export const MAX_RADIUS_NM = 250;
export const MIN_INTERVAL_MS = 1000;
const FALLBACK_RADIUS_NM = 120;
// How long to stay on the standby feed before trying the direct one again. A
// block usually outlasts a single refresh, so retrying every five seconds just
// spends a request to be refused; five minutes is often enough for a rate
// limit to lapse, and cheap enough if it hasn't.
const RETRY_DIRECT_MS = 5 * 60 * 1000;

let lastFetchAt = 0;
let inFlight = null;
let chain = Promise.resolve();
let viaProxyUntil = 0;   // 0 = using the direct feed

/** Which feed answered last — the UI says so rather than quietly substituting. */
export function feedSource() {
  return Date.now() < viaProxyUntil ? 'standby' : 'direct';
}

/**
 * Serialise every call to the feed and keep them at least MIN_INTERVAL_MS
 * apart. The area poll and the search lookups share this gate, so searching
 * while the map refreshes can't push us past the feed's 1 Hz guidance.
 */
function paced(run) {
  const p = chain.then(async () => {
    const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastFetchAt));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastFetchAt = Date.now();
    return run();
  });
  chain = p.catch(() => { /* one failed call must not stall the queue */ });
  return p;
}

async function readAc(base, path) {
  const res = await fetch(`${base}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status}`);
  const json = await res.json();
  return Array.isArray(json.ac) ? json.ac : [];
}

/**
 * Ask the feed, and fall back to the Worker-side mirrors rather than failing.
 *
 * A blocked request and a dead network look the same from here — fetch simply
 * rejects — so anything that stops the direct call moves us to the standby
 * path. If the standby fails too, that error is the one worth showing: it means
 * neither route works, which is a real outage rather than one host's mood.
 */
async function getJson(path) {
  if (Date.now() < viaProxyUntil) {
    try {
      return await readAc(PROXY, path);
    } catch (err) {
      // The standby is failing as well — worth trying direct again right now
      // rather than waiting out the retry window on a route that's also down.
      viaProxyUntil = 0;
      return readAc(API, path).catch(() => { throw err; });
    }
  }

  try {
    return await readAc(API, path);
  } catch (directErr) {
    const acs = await readAc(PROXY, path).catch(() => null);
    if (acs === null) throw new Error(`airplanes.live ${directErr.message}`);
    viaProxyUntil = Date.now() + RETRY_DIRECT_MS;
    return acs;
  }
}

/**
 * Half the diagonal of the map view, in nautical miles.
 *
 * Takes the map rather than its bounds on purpose: a Leaflet map laid out in a
 * hidden tab or a backgrounded standalone PWA reports a 0×0 container, and its
 * bounds collapse to a point — which would quietly turn "show me the sky" into
 * a five-mile circle. When the container has no size yet we ask for a sensible
 * default area instead and let the next resize correct it.
 */
export function radiusForMap(map) {
  const size = map.getSize ? map.getSize() : null;
  if (!size || size.x < 40 || size.y < 40) return FALLBACK_RADIUS_NM;
  const c = map.getCenter();
  const ne = map.getBounds().getNorthEast();
  return Math.max(5, Math.round(c.distanceTo(ne) / 1852));
}

/**
 * The same question from a zoom level alone, for the 3D view — a tilted camera
 * has no rectangular "bounds" to measure, so the radius comes from the scale.
 * At z8 a phone screen spans roughly 150 NM, and each zoom level halves it.
 */
export function radiusForZoom(zoom) {
  const z = Number.isFinite(zoom) ? zoom : 8;
  return Math.max(10, Math.min(MAX_RADIUS_NM, Math.round(150 * (2 ** (8 - z)))));
}

/**
 * One snapshot of the sky around a point.
 * @param {number} lat @param {number} lon
 * @param {number} radiusNm  clamped to the API's 250 NM ceiling
 * @returns {Promise<{aircraft:Array, at:number, clipped:boolean}>}
 */
export async function fetchArea(lat, lon, radiusNm) {
  const clipped = radiusNm > MAX_RADIUS_NM;
  const r = Math.min(MAX_RADIUS_NM, Math.max(1, Math.round(radiusNm)));

  // Collapse overlapping calls (pan + timer firing together) into one request.
  if (inFlight) return inFlight;

  inFlight = paced(async () => {
    const aircraft = await getJson(`/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${r}`);
    return { aircraft, at: Date.now(), clipped };
  }).finally(() => { inFlight = null; });

  return inFlight;
}

/**
 * Find one aircraft anywhere in the world by registration or callsign.
 *
 * This is what makes search mean "find me this aeroplane" instead of "filter
 * the patch of sky I happen to be looking at": these endpoints are global, so a
 * 737 halfway across Europe comes back even though it is nowhere near the map.
 *
 * @param {'reg'|'callsign'|'hex'} kind
 * @returns {Promise<Array>} raw records — [] when nothing is transmitting
 */
export function fetchOne(kind, value) {
  const v = encodeURIComponent(String(value || '').trim().toUpperCase());
  if (!v) return Promise.resolve([]);
  return paced(() => getJson(`/${kind}/${v}`)).catch(() => []);
}

/**
 * Normalise one raw record into the shape the map and panel use.
 * Altitudes are feet, speeds knots, vertical rate feet/min — aviation units,
 * because this is an aviation app and converting would only add error.
 */
export function normalise(ac, cls) {
  const onGround = ac.alt_baro === 'ground';
  const alt = onGround ? 0 : Number(ac.alt_baro ?? ac.alt_geom ?? NaN);
  return {
    hex: String(ac.hex || '').toLowerCase(),
    callsign: String(ac.flight || '').trim().toUpperCase(),
    kind: cls.kind || 'airline',
    code: cls.code,
    flightNo: cls.flightNo,
    airline: cls.airline,
    reg: String(ac.r || '').trim().toUpperCase(),
    type: String(ac.t || '').toUpperCase(),
    desc: ac.desc || '',
    lat: Number(ac.lat),
    lon: Number(ac.lon),
    alt: Number.isFinite(alt) ? alt : null,
    onGround,
    gs: Number.isFinite(Number(ac.gs)) ? Number(ac.gs) : null,
    track: Number.isFinite(Number(ac.track)) ? Number(ac.track)
      : (Number.isFinite(Number(ac.true_heading)) ? Number(ac.true_heading) : null),
    vs: Number.isFinite(Number(ac.baro_rate)) ? Number(ac.baro_rate)
      : (Number.isFinite(Number(ac.geom_rate)) ? Number(ac.geom_rate) : null),
    squawk: ac.squawk || '',
    emergency: ac.emergency && ac.emergency !== 'none' ? ac.emergency : '',
    category: ac.category || '',
    seen: Number(ac.seen_pos ?? ac.seen ?? 0),
    mach: Number.isFinite(Number(ac.mach)) ? Number(ac.mach) : null,
    ias: Number.isFinite(Number(ac.ias)) ? Number(ac.ias) : null,
    nav_alt: Number(ac.nav_altitude_mcp ?? ac.nav_altitude_fms ?? NaN) || null,
    qnh: Number.isFinite(Number(ac.nav_qnh)) ? Number(ac.nav_qnh) : null,
    wind: Number.isFinite(Number(ac.ws)) ? { dir: Number(ac.wd), speed: Number(ac.ws) } : null,
    oat: Number.isFinite(Number(ac.oat)) ? Number(ac.oat) : null,
    // Distance/bearing from the query point, handy for the nearest list.
    dst: Number.isFinite(Number(ac.dst)) ? Number(ac.dst) : null,
  };
}

/** Emergency squawks a pilot cares about at a glance. */
export function squawkAlert(sq) {
  if (sq === '7500') return 'Hijack (7500)';
  if (sq === '7600') return 'Radio failure (7600)';
  if (sq === '7700') return 'Emergency (7700)';
  return '';
}
