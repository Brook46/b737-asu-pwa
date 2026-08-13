// Flight Card — TAF + Google-Calendar CORS shim + hosted logbook .ics
// ====================================================================
//
// Free Cloudflare Worker that fronts two upstream sources the PWA can't
// fetch directly because they don't ship Access-Control-Allow-Origin,
// plus a tiny KV-backed store that hosts the pilot's logbook calendar:
//
//   GET  /taf?icao=<ICAO>          →  aviationweather.gov TAF (raw text)
//   GET  /ical?url=<encoded URL>   →  user's Google Calendar secret iCal feed
//   POST /logbook/<token>          →  store an iCalendar document in KV
//   GET  /logbook/<token>[.ics]    →  serve it (Apple Calendar subscribes here)
//   GET  /  | /healthz             →  liveness ping
//
// Logbook auth model: the <token> is a client-generated random UUID
// (122 bits of entropy) — knowing it IS the credential, same trust model
// as Google's own "secret iCal address". The route regex only matches
// UUID-shaped paths, so the namespace can't be enumerated cheaply.
// Requires a KV namespace bound as LOGBOOK in wrangler.jsonc; until that
// binding exists the /logbook routes answer 503 and everything else keeps
// working.
//
// Free tier (100k req/day, 1k KV writes/day) is comfortably more than
// this PWA will use.
//
// Why the iCal route exists
// -------------------------
// Google Calendar's "secret iCal address" (no OAuth, no token refresh) is
// the cleanest way for an installed iOS PWA to read its roster. Google
// serves that URL without CORS headers, so the PWA needs a proxy. The
// host is whitelisted to calendar.google.com so this Worker can't be
// abused as an open relay.
//
// Re-deploy steps (5 minutes, once per Worker code change)
// ------------------------------------------------------
// 1. dash.cloudflare.com → Workers & Pages → your existing fc-taf-proxy
//    (or create one if this is the first deploy).
// 2. Edit code → DELETE everything in the editor → paste THIS file's
//    contents → Deploy.
// 3. Test in any browser:
//      https://<your-worker>.workers.dev/healthz             → "OK"
//      https://<your-worker>.workers.dev/taf?icao=KJFK       → live TAF
//      https://<your-worker>.workers.dev/ical?url=<encoded>  → your iCal
// 4. Send me the workers.dev URL, I drop it into modules/proxy.js.

const ICAL_ALLOWED_HOSTS = new Set([
  'calendar.google.com',
  // If you ever move to a different calendar provider that exposes a
  // secret iCal URL, add its hostname here. Anything not on the list
  // is rejected so this Worker can't be repurposed as an open proxy.
]);

// UUID-shaped token, optionally suffixed .ics (Apple Calendar prefers a
// file-looking URL). Case-insensitive; stored lowercased.
const LOGBOOK_RE = /^\/logbook\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\.ics)?$/i;
// Per-airport "social" notes feed. A weekly Mac script POSTs a JSON map
// { "LLBG": "…", "TLV": "…" }; the PWA GETs it and fills the Social tabs.
// Same KV namespace as the logbook, different key prefix.
const SOCIAL_RE  = /^\/social\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\.json|\/add)?$/i;
// Thermal Debrief share links: IGC bundle + saved camera/clock, so a pilot can
// send a friend exactly the moment they're looking at. Same token model as the
// logbook — the UUID is the credential — but these expire, because a shared
// flight is a conversation, not an archive.
const SHARE_RE   = /^\/share\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
const SHARE_TTL_S = 90 * 24 * 60 * 60;      // 90 days
const SHARE_MAX_BYTES = 6 * 1024 * 1024;    // four big IGC files, with headroom

// Airline Radar's standby ADS-B feed. airplanes.live is the only free
// aggregator that sends `Access-Control-Allow-Origin: *`, so the app reads it
// straight from the page — and has nowhere to go the day it answers 403,
// because adsb.lol and adsb.fi serve the same JSON with no CORS header at all.
// These routes are that somewhere: same question, same answer shape, asked
// server-side where CORS doesn't apply.
//
// The path is parsed into numbers and identifiers and the upstream URL rebuilt
// from them — never passed through — so this can't be turned into the open
// relay a `?url=` proxy would be.
const ADSB_POINT_RE = /^\/adsb\/point\/(-?\d{1,3}(?:\.\d{1,6})?)\/(-?\d{1,3}(?:\.\d{1,6})?)\/(\d{1,3})$/;
const ADSB_FIND_RE  = /^\/adsb\/(reg|callsign|hex)\/([A-Za-z0-9-]{1,12})$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // CORS preflight — the PWA's POST with content-type: text/calendar is
    // a non-simple request, so browsers send OPTIONS first.
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type',
          'access-control-max-age': '86400',
        },
      });
    }

    if (url.pathname === '/' || url.pathname === '/healthz') {
      return text('Flight Card proxy OK', 200);
    }

    if (url.pathname === '/taf') {
      return handleTaf(url);
    }

    if (url.pathname === '/ical') {
      return handleIcal(url);
    }

    if (url.pathname === '/pge') {
      return handlePge(url);
    }

    // Thermal Debrief: XContest flight search + IGC download.
    if (url.pathname === '/xc') {
      return handleXcApi(request, url);
    }

    if (url.pathname === '/xcigc') {
      return handleXcIgc(url);
    }

    // Airline Radar: the standby feed, used only when airplanes.live refuses.
    if (url.pathname.startsWith('/adsb/')) {
      return handleAdsb(url);
    }

    const lb = url.pathname.match(LOGBOOK_RE);
    if (lb) {
      if (!env || !env.LOGBOOK) {
        return text('Logbook storage not configured (KV binding missing)', 503);
      }
      const token = lb[1].toLowerCase();
      if (request.method === 'POST') return handleLogbookPut(request, env, token);
      if (request.method === 'GET')  return handleLogbookGet(env, token);
      return text('Method not allowed', 405);
    }

    // Thermal Debrief share links: a bundle of IGC files + a saved view.
    const shr = url.pathname.match(SHARE_RE);
    if (shr) {
      if (!env || !env.LOGBOOK) {
        return text('Share storage not configured (KV binding missing)', 503);
      }
      const token = shr[1].toLowerCase();
      if (request.method === 'POST') return handleSharePut(request, env, token);
      if (request.method === 'GET') return handleShareGet(env, token);
      return text('Method not allowed', 405);
    }

    const soc = url.pathname.match(SOCIAL_RE);
    if (soc) {
      if (!env || !env.LOGBOOK) {
        return text('Social storage not configured (KV binding missing)', 503);
      }
      const token = soc[1].toLowerCase();
      const merge = /\/add$/i.test(url.pathname) || url.searchParams.get('merge') === '1';
      if (request.method === 'POST') return handleSocialPut(request, env, token, merge);
      if (request.method === 'GET')  return handleSocialGet(env, token);
      return text('Method not allowed', 405);
    }

    return text('Not found', 404);
  },
};

// ---------- /share  (Thermal Debrief) ---------------------------------------

async function handleSharePut(request, env, token) {
  const body = await request.text();

  if (body.length > SHARE_MAX_BYTES) {
    return text(`Too large (${(body.length / 1e6).toFixed(1)} MB, max ${SHARE_MAX_BYTES / 1e6} MB)`, 413);
  }

  // Validate before storing: a share that can't be parsed on the way out is
  // worse than a rejected upload, because the pilot has already sent the link.
  let parsed;
  try { parsed = JSON.parse(body); } catch { return text('Body is not JSON', 400); }
  if (!parsed || !Array.isArray(parsed.flights) || !parsed.flights.length) {
    return text('Bundle has no flights', 400);
  }
  for (const f of parsed.flights) {
    if (!f || typeof f.igc !== 'string' || !/^B\d{6}\d{7}[NS]/m.test(f.igc.slice(0, 65536))) {
      return text('A flight in the bundle has no valid IGC data', 400);
    }
  }

  // Never overwrite: tokens are client-generated, and a silent overwrite would
  // break a link somebody has already sent.
  const existing = await env.LOGBOOK.get(`share:${token}`);
  if (existing) return text('That share token already exists', 409);

  await env.LOGBOOK.put(`share:${token}`, body, { expirationTtl: SHARE_TTL_S });

  return new Response(JSON.stringify({ ok: true, token, bytes: body.length, expiresInDays: SHARE_TTL_S / 86400 }), {
    status: 201,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
    },
  });
}

async function handleShareGet(env, token) {
  const body = await env.LOGBOOK.get(`share:${token}`);
  if (!body) return text('Shared flight not found or expired', 404);
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      // Immutable for a day: the bundle never changes under a given token.
      'cache-control': 'public, max-age=86400',
    },
  });
}

// ---------- /xc + /xcigc  (Thermal Debrief) ---------------------------------
//
// XContest publishes no open API: robots.txt disallows the flight-search and
// track-download paths, and /api/data/ rejects external callers. What does
// exist is their partner API on api.xcontest.org, which needs a key.
//
// So these two routes are a *thin* shim, deliberately dumb:
//
//   GET /xc?path=<encoded path+query>   header x-xc-key: <the caller's key>
//   GET /xcigc?url=<encoded IGC url>
//
// The Worker does not know XContest's request or response shape — the client
// supplies the path and interprets the JSON. That means when the API contract
// turns out to differ from what debrief-pwa/modules/xcontest.js assumes, it is
// a one-file client edit and NOT a Worker redeploy.
//
// The key is never stored here; it lives on the pilot's device and is forwarded
// per request. Both routes are host-locked so this can't become an open relay.

const XC_API_BASE = 'https://api.xcontest.org';
const XC_IGC_HOSTS = new Set([
  'api.xcontest.org',
  'www.xcontest.org',
  'xcontest.org',
]);

async function handleXcApi(request, url) {
  const key = request.headers.get('x-xc-key') || url.searchParams.get('key') || '';
  if (!key) return text('Missing XContest API key', 401);

  const path = url.searchParams.get('path') || '';
  // Must be a rooted path — never a full URL, or this becomes an open proxy.
  if (!path.startsWith('/') || path.startsWith('//')) return text('Bad path', 400);

  const upstream = XC_API_BASE + path;
  try {
    const res = await fetch(upstream, {
      headers: {
        'authorization': `Bearer ${key}`,
        'accept': 'application/json',
        'user-agent': 'ThermalDebrief/1.0 (+https://brook46.github.io/b737-asu-pwa/debrief-pwa/)',
      },
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        'content-type': res.headers.get('content-type') || 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'no-store',
      },
    });
  } catch (err) {
    return text(`XContest upstream error: ${err.message}`, 502);
  }
}

/**
 * Fetch a publicly served IGC file so the PWA can import it.
 *
 * Deliberately NOT host-locked to one league: pilots are handed IGC links from
 * clubs, comps, mailing lists and each league's own download button, and a
 * whitelist of two domains would make the feature useless. It is kept from
 * becoming an open proxy by only ever returning content that parses as IGC —
 * a login page, an HTML error or a JSON API response all come back 422 — plus
 * a size cap and a block on non-public hostnames.
 */
const PRIVATE_HOST_RE = /^(localhost$|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[|0\.0\.0\.0$|.*\.internal$|.*\.local$)/i;
const IGC_MAX_BYTES = 12 * 1024 * 1024;

async function handleXcIgc(url) {
  const raw = url.searchParams.get('url') || '';
  let target;
  try { target = new URL(raw); } catch { return text('Bad url', 400); }
  if (target.protocol !== 'https:') return text('Only https links are supported', 400);
  if (PRIVATE_HOST_RE.test(target.hostname)) return text('That host is not reachable', 403);

  try {
    const res = await fetch(target.toString(), {
      headers: {
        'user-agent': 'ThermalDebrief/1.0 (+https://brook46.github.io/b737-asu-pwa/debrief-pwa/)',
        'accept': 'text/plain, application/octet-stream, */*',
      },
      redirect: 'follow',
    });
    if (!res.ok) return text(`The server returned ${res.status} for that link`, res.status === 404 ? 404 : 502);

    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > IGC_MAX_BYTES) return text('That file is too large', 413);

    const body = await res.text();
    if (body.length > IGC_MAX_BYTES) return text('That file is too large', 413);

    // The gate that keeps this from being a general-purpose proxy: it must look
    // like a flight log, or nothing comes back.
    if (!/^B\d{6}\d{7}[NS]/m.test(body.slice(0, 65536))) {
      return text('That link did not return an IGC file — if the flight needs a login, download it in your browser and drop the file in instead', 422);
    }

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    return text(`Could not fetch that link: ${err.message}`, 502);
  }
}

// ---------- /taf ------------------------------------------------------------

async function handleTaf(url) {
  const icao = (url.searchParams.get('icao') || '').toUpperCase();
  if (!/^[A-Z]{4}$/.test(icao)) return text('Bad ICAO', 400);

  const upstream =
    'https://aviationweather.gov/api/data/taf?ids=' + encodeURIComponent(icao) + '&format=raw';
  try {
    const res = await fetch(upstream, { cf: { cacheTtl: 60, cacheEverything: true } });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=60',
      },
    });
  } catch (err) {
    return text('Upstream unreachable: ' + err.message, 502);
  }
}

// ---------- /adsb  (Airline Radar's standby feed) ---------------------------

/**
 * One snapshot of the sky, or one aircraft by name, from whichever mirror is
 * answering. Both upstreams carry the same network's data in the same record
 * shape as airplanes.live, so the app can swap to this mid-flight and every
 * field it reads still means what it meant.
 *
 * adsb.lol goes first: its paths and its `ac` key match airplanes.live exactly,
 * so nothing has to be translated. adsb.fi is the second string to the bow —
 * same records, but the area endpoint spells its path differently and returns
 * them under `aircraft`.
 */
async function handleAdsb(url) {
  const pt = url.pathname.match(ADSB_POINT_RE);
  const fd = url.pathname.match(ADSB_FIND_RE);

  let tries;
  if (pt) {
    const lat = Number(pt[1]);
    const lon = Number(pt[2]);
    const r = Math.min(250, Math.max(1, parseInt(pt[3], 10)));
    if (!Number.isFinite(lat) || Math.abs(lat) > 90) return text('Bad latitude', 400);
    if (!Number.isFinite(lon) || Math.abs(lon) > 180) return text('Bad longitude', 400);
    tries = [
      `https://api.adsb.lol/v2/point/${lat}/${lon}/${r}`,
      `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${r}`,
    ];
  } else if (fd) {
    const kind = fd[1].toLowerCase();
    const v = encodeURIComponent(fd[2].toUpperCase());
    // adsb.fi calls the registration lookup by its full name.
    const fiKind = kind === 'reg' ? 'registration' : kind;
    tries = [
      `https://api.adsb.lol/v2/${kind}/${v}`,
      `https://opendata.adsb.fi/api/v2/${fiKind}/${v}`,
    ];
  } else {
    return text('Bad ADS-B path', 400);
  }

  let lastErr = 'no upstream tried';
  for (const target of tries) {
    try {
      // Three seconds of shared cache: shorter than the app's own refresh, so
      // nobody is shown a stale position, but enough that a hundred readers
      // asking about the same patch of sky don't become a hundred requests.
      const res = await fetch(target, {
        headers: { accept: 'application/json' },
        cf: { cacheTtl: 3, cacheEverything: true },
      });
      if (!res.ok) { lastErr = `${new URL(target).hostname} ${res.status}`; continue; }
      const data = await res.json();
      const ac = Array.isArray(data.ac) ? data.ac
        : (Array.isArray(data.aircraft) ? data.aircraft : []);
      return json({ ac, source: new URL(target).hostname });
    } catch (err) {
      lastErr = `${new URL(target).hostname} ${err.message}`;
    }
  }
  return text('No ADS-B upstream answered: ' + lastErr, 502);
}

// ---------- /ical -----------------------------------------------------------

async function handleIcal(url) {
  const target = url.searchParams.get('url') || '';
  if (!target) return text('Missing url parameter', 400);

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    return text('Bad url parameter', 400);
  }

  if (parsed.protocol !== 'https:') {
    return text('Only https URLs are allowed', 400);
  }
  if (!ICAL_ALLOWED_HOSTS.has(parsed.hostname)) {
    return text('Host not allowed: ' + parsed.hostname, 403);
  }

  try {
    // 5 min cache — Google Calendar's secret feed updates within minutes
    // of a change. Worker shares the cache across all readers, so the
    // PWA can poll cheaply.
    const res = await fetch(parsed.toString(), {
      cf: { cacheTtl: 300, cacheEverything: true },
      headers: { 'accept': 'text/calendar, text/plain, */*' },
    });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        'content-type': 'text/calendar; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=300',
      },
    });
  } catch (err) {
    return text('Upstream unreachable: ' + err.message, 502);
  }
}

// ---------- /pge ------------------------------------------------------------
// CORS shim for ParaglidingEarth's launch-site database, used by the Sky
// Monkeys (xcsky) PWA to rank takeoffs. PGE serves no Access-Control header,
// so the browser can't read it directly. We only proxy the read-only
// bounding-box endpoint, clamp the box so it can't be abused to pull the whole
// planet, and cache hard (launch data changes on the order of days).
//
//   GET /pge?n=<lat>&s=<lat>&e=<lon>&w=<lon>[&limit=<n>]
async function handlePge(url) {
  const n = parseFloat(url.searchParams.get('n'));
  const s = parseFloat(url.searchParams.get('s'));
  const e = parseFloat(url.searchParams.get('e'));
  const w = parseFloat(url.searchParams.get('w'));
  if (![n, s, e, w].every(Number.isFinite)) return text('Missing/invalid bbox', 400);
  // Reject absurdly large boxes (keep the upstream query cheap).
  if (n - s > 8 || e - w > 8 || n < s || e < w) return text('Bounding box too large', 400);
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '100', 10) || 100, 200);

  const upstream = 'https://www.paraglidingearth.com/api/geojson/getBoundingBoxSites.php'
    + `?north=${n.toFixed(4)}&south=${s.toFixed(4)}&east=${e.toFixed(4)}&west=${w.toFixed(4)}`
    + `&style=detailled&limit=${limit}`;
  try {
    const res = await fetch(upstream, { cf: { cacheTtl: 86400, cacheEverything: true } });
    const body = await res.text();
    return new Response(body, {
      status: res.status,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=86400',
      },
    });
  } catch (err) {
    return text('Upstream unreachable: ' + err.message, 502);
  }
}

// ---------- /logbook --------------------------------------------------------

// The PWA POSTs its full logbook as one iCalendar document; Apple/Google
// Calendar subscribes to the GET URL. One KV key per token, no index.

async function handleLogbookPut(request, env, token) {
  const len = parseInt(request.headers.get('content-length') || '0', 10);
  if (len > 1_000_000) return text('Too large', 413);

  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('text/calendar') && !ct.startsWith('text/plain')) {
    return text('Expected text/calendar', 415);
  }

  const body = await request.text();
  if (body.length > 1_000_000) return text('Too large', 413);
  if (!body.trimStart().startsWith('BEGIN:VCALENDAR')) {
    return text('Not an iCalendar document', 400);
  }

  await env.LOGBOOK.put('ics:' + token, body, {
    metadata: { updatedAt: Date.now(), bytes: body.length },
  });

  return new Response(JSON.stringify({ ok: true, bytes: body.length }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}

async function handleLogbookGet(env, token) {
  const body = await env.LOGBOOK.get('ics:' + token);
  if (body == null) return text('No logbook published for this token', 404);
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'access-control-allow-origin': '*',
      // Apple's subscription poller decides its own refresh cadence; no
      // edge caching so a fresh push is visible on the very next poll.
      'cache-control': 'no-cache',
    },
  });
}

// ---------- /social ---------------------------------------------------------
// A weekly Mac script POSTs a JSON map of per-airport notes; the PWA GETs it.
// Key naming: 'social:<token>'. Value is the raw JSON string.

async function handleSocialPut(request, env, token, merge = false) {
  const len = parseInt(request.headers.get('content-length') || '0', 10);
  if (len > 1_000_000) return text('Too large', 413);

  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('application/json') && !ct.startsWith('text/plain')) {
    return text('Expected application/json', 415);
  }

  const body = await request.text();
  if (body.length > 1_000_000) return text('Too large', 413);

  // Accept THREE shapes so the phone side can be as dumb as possible:
  //   1. a map              { "TLV": "note", "CDG - Paris": "note", … }
  //   2. a list of notes    [ { "title": "TLV", "body": "note" }, … ]
  //   3. plain glued text   note1body <SEP> note2body <SEP> …  where each
  //      note's FIRST line is its title (true for Apple Notes) and <SEP> is a
  //      run of 3+ '=' or a record-separator char. This is what the simplest
  //      possible Shortcut makes: Find Notes → Combine Text → POST. No
  //      dictionary, no repeat, no variables on the phone at all.
  // Everything flattens to [title, bodyText] pairs.
  const pairs = [];
  let obj = null;
  try { obj = JSON.parse(body); } catch { /* not JSON → treat as shape 3 */ }

  if (obj && Array.isArray(obj)) {
    for (const item of obj) {
      if (!item || typeof item !== 'object') continue;
      const k = item.title ?? item.name ?? item.Name ?? item.key ?? '';
      const v = item.body ?? item.text ?? item.note ?? item.value ?? item.Body ?? '';
      pairs.push([k, v]);
    }
  } else if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) pairs.push([k, v]);
  } else {
    // Shape 3: split the blob into note blocks, first line = title.
    for (const block of body.split(/\n*={3,}\n*|\x1e/)) {
      const lines = block.split(/\r?\n/);
      let i = 0;
      while (i < lines.length && !lines[i].trim()) i++;   // skip leading blanks
      if (i >= lines.length) continue;
      const title = lines[i];
      const rest = lines.slice(i + 1).join('\n').trim();
      pairs.push([title, rest]);
    }
  }

  // Normalise: keep a note only if its title STARTS with a 3–4 letter airport
  // code (optionally followed by " / ICAO", " - City", …); prose titles like
  // "Shopping list" are dropped. Value must be non-empty.
  const clean = {};
  const CODE_RE = /^([A-Za-z]{3,4})(?=$|[\s/·\-–—,:])/;
  for (const [rawKey, rawVal] of pairs) {
    const m = CODE_RE.exec(String(rawKey || '').trim());
    if (!m) continue;
    const val = String(rawVal == null ? '' : rawVal).trim();
    if (!val) continue;
    clean[m[1].toUpperCase()] = val;
  }

  // Merge mode (POST …/social/<token>/add) writes each airport to its OWN KV
  // key. That matters: an iOS Shortcut posts one note per request inside a
  // Repeat, i.e. several writes within a second or two, and KV reads are only
  // eventually consistent — a read-modify-write of a single shared blob loses
  // notes when a request reads a copy from before the previous one landed
  // (observed: 4 notes posted, 2 survived). Independent keys have no such
  // race. handleSocialGet reassembles them.
  if (merge) {
    const codes = Object.keys(clean);
    await Promise.all(codes.map(code =>
      env.LOGBOOK.put(noteKey(token, code), clean[code], {
        metadata: { updatedAt: Date.now() },
      })));
    // Deliberately NO running total here. KV's list index lags writes by a few
    // seconds, so a count computed mid-loop reads low and looks like the sync
    // is failing when it isn't. Report what THIS request stored; the feed URL
    // is the place to see the full set once it settles.
    return json({ ok: true, saved: codes });
  }

  // Replace mode (the bare route) is authoritative: it overwrites the blob AND
  // drops the per-note keys, so posting {} is a genuine full reset.
  await env.LOGBOOK.put('social:' + token, JSON.stringify(clean), {
    metadata: { updatedAt: Date.now(), keys: Object.keys(clean).length },
  });
  try { await clearSocialNotes(env, token); } catch { /* best effort */ }

  return json({ ok: true, airports: Object.keys(clean).length });
}

// Per-note KV key. One key per airport code → writes never collide.
function noteKey(token, code) { return `socialn:${token}:${code}`; }

// Reassemble the full map: the whole-map blob first, then the per-note keys
// (which win, being the newer mechanism).
async function readSocialMap(env, token) {
  const out = {};
  try {
    const blob = await env.LOGBOOK.get('social:' + token);
    if (blob) {
      const parsed = JSON.parse(blob);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) Object.assign(out, parsed);
    }
  } catch { /* corrupt blob → ignore it */ }
  const prefix = noteKey(token, '');
  let cursor;
  do {
    const res = await env.LOGBOOK.list({ prefix, cursor });
    cursor = res.list_complete ? null : res.cursor;
    const vals = await Promise.all(res.keys.map(k => env.LOGBOOK.get(k.name)));
    res.keys.forEach((k, i) => {
      if (vals[i] != null) out[k.name.slice(prefix.length)] = vals[i];
    });
  } while (cursor);
  return out;
}

async function clearSocialNotes(env, token) {
  const prefix = noteKey(token, '');
  let cursor;
  do {
    const res = await env.LOGBOOK.list({ prefix, cursor });
    cursor = res.list_complete ? null : res.cursor;
    await Promise.all(res.keys.map(k => env.LOGBOOK.delete(k.name)));
  } while (cursor);
}

async function handleSocialGet(env, token) {
  const map = await readSocialMap(env, token);
  if (!Object.keys(map).length) {
    return text('No social notes published for this token', 404);
  }
  return new Response(JSON.stringify(map), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache',
    },
  });
}

// ---------- helpers ---------------------------------------------------------

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}

function text(body, status) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}
