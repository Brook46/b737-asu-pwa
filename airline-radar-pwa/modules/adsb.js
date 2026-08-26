// adsb.js — live positions.
//
// airplanes.live was the whole reason this app could be keyless: the one
// community ADS-B aggregator that sent `Access-Control-Allow-Origin: *`, so a
// static page could read it with no key and no proxy — the same rule that
// picked OGN for Sky Monkeys.
//
// **That free API is gone.** Not blocked for us; withdrawn for everyone, in
// August 2026. Their own note gives the arithmetic: over two billion requests a
// week, a month's egress budget spent in four days, hosting up ~300% in
// eighteen months, and scrapers and AI agents named as the cause. Two ways back
// to it, both fair: run a receiver that feeds the network (access is then
// granted to the feeder's own IP), or sponsor the usage. Until one of those
// happens, every direct call returns 403 — which reaches the page as a CORS
// error, because a 403 carries no CORS header.
//
// So the standby path is the path. adsb.lol and opendata.adsb.fi carry the same
// network's data in the same record shape and send no CORS header at all, so a
// browser can't read them and a server can — CORS being a browser rule, not a
// server one. Hence a small proxy, and PROXIES below.
//
// Worth remembering while working here: those two are volunteer-run projects
// with exactly the same cost curve that just closed airplanes.live. One reader
// at one request per five seconds is modest and within what they tolerate.
// Anything that quietly multiplies that — a shorter refresh, a retry loop, a
// cache that doesn't cache — is the behaviour that ends free feeds.
//
// House rules we honour: one request per refresh, never faster than 1 Hz, and a
// radius capped at the API's 250 NM limit.

const API = 'https://api.airplanes.live/v2';

// Standby routes, tried in order.
//
// The first is a small Deno service (airline-radar-pwa/adsb-proxy/main.ts) that
// exists for one reason: from Cloudflare, adsb.fi and adsb.one refuse the
// subrequest outright and adsb.lol rate-limits the address every Worker shares,
// while from an ordinary host both adsb.lol and adsb.fi answer 200. Same code,
// different doorstep.
//
// The second is the original route on the flight card's Worker. It still
// answers often enough — with its stored snapshot behind it — to be worth
// keeping as a backstop rather than deleting.
// 1. The same service run on a machine at home, published through a Cloudflare
//    quick tunnel (adsb-proxy/tunnel.sh). Note what is and isn't Cloudflare
//    here: the tunnel only carries traffic *inbound* to the laptop, while the
//    call out to the mirrors still leaves from a domestic address — which is
//    the whole reason this works where the Worker doesn't.
//
//    Temporary by nature: it answers only while that machine is awake, and the
//    hostname changes every time the tunnel restarts. First in the list because
//    while it is up it is the fastest and least-shared route; when it is down
//    the relay refuses quickly and the list moves on.
const TUNNEL_PROXY = 'https://walker-note-somewhere-trees.trycloudflare.com/adsb';
// 2. The same service on Deno Deploy — permanent, always on. Fill this in and
//    it takes over; the tunnel above then becomes redundant and can go.
const DENO_PROXY = '';
// 3. The original route on the flight card's Worker. Cloudflare's shared egress
//    is rate-limited by adsb.lol and refused outright by adsb.fi, so this is a
//    backstop that half works rather than a real answer — kept because half is
//    better than nothing when the two above are gone.
const WORKER_PROXY = 'https://b737-asu-pwa.alonbrookstein.workers.dev/adsb';
const PROXIES = [TUNNEL_PROXY, DENO_PROXY, WORKER_PROXY].filter(Boolean);

export const MAX_RADIUS_NM = 250;
export const MIN_INTERVAL_MS = 1000;
const FALLBACK_RADIUS_NM = 120;
// How long to stay on the standby feed before trying the direct one again.
//
// Five minutes was the right number for a rate limit, which lapses. It is the
// wrong number for a withdrawn API, which does not: it spends a request every
// five minutes, forever, to be told 403 again. An hour still notices the day a
// feeder or a sponsorship turns the direct feed back on — the first load of any
// session probes it regardless — without pestering a service that has said no.
const RETRY_DIRECT_MS = 60 * 60 * 1000;

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

/**
 * One reply from either route.
 *
 * `ageMs` is how long ago the positions were actually read. Direct from the
 * feed that is always zero; through the Worker it can be seconds, because the
 * mirrors rate-limit and a stored snapshot beats an empty map. Carrying the age
 * rather than swallowing it is what keeps the Live pill honest — the app
 * already knows how to fly on from a fix it knows the age of.
 */
async function readAc(base, path) {
  const res = await fetch(`${base}${path}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status}`);
  const json = await res.json();
  return {
    ac: Array.isArray(json.ac) ? json.ac : [],
    ageMs: Number.isFinite(Number(json.ageMs)) ? Number(json.ageMs) : 0,
  };
}

/** The first standby route that answers. */
async function fromStandby(path) {
  let lastErr = null;
  for (const base of PROXIES) {
    try {
      return await readAc(base, path);
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('no standby route configured');
}

/**
 * Ask the feed, and fall back to the proxied mirrors rather than failing.
 *
 * A blocked request and a dead network look the same from here — fetch simply
 * rejects — so anything that stops the direct call moves us to the standby
 * path. If every standby fails too, that error is the one worth showing: it
 * means no route works, which is a real outage rather than one host's mood.
 */
async function getJson(path) {
  if (Date.now() < viaProxyUntil) {
    try {
      return await fromStandby(path);
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
    const acs = await fromStandby(path).catch(() => null);
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
    const { ac, ageMs } = await getJson(`/point/${lat.toFixed(4)}/${lon.toFixed(4)}/${r}`);
    // `at` is when these positions were read, not when we asked. A snapshot the
    // standby route had already stored is genuinely that much older, and the
    // Live pill turns to DR off this number — dating it "now" would be the one
    // lie the whole fallback was built to avoid.
    return { aircraft: ac, at: Date.now() - ageMs, clipped };
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
  return paced(() => getJson(`/${kind}/${v}`)).then((r) => r.ac).catch(() => []);
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
