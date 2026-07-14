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
const SOCIAL_RE  = /^\/social\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\.json)?$/i;

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

    const soc = url.pathname.match(SOCIAL_RE);
    if (soc) {
      if (!env || !env.LOGBOOK) {
        return text('Social storage not configured (KV binding missing)', 503);
      }
      const token = soc[1].toLowerCase();
      if (request.method === 'POST') return handleSocialPut(request, env, token);
      if (request.method === 'GET')  return handleSocialGet(env, token);
      return text('Method not allowed', 405);
    }

    return text('Not found', 404);
  },
};

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

async function handleSocialPut(request, env, token) {
  const len = parseInt(request.headers.get('content-length') || '0', 10);
  if (len > 1_000_000) return text('Too large', 413);

  const ct = (request.headers.get('content-type') || '').toLowerCase();
  if (!ct.startsWith('application/json') && !ct.startsWith('text/plain')) {
    return text('Expected application/json', 415);
  }

  const body = await request.text();
  if (body.length > 1_000_000) return text('Too large', 413);
  // Validate it parses as a JSON object of string values.
  let obj;
  try { obj = JSON.parse(body); } catch { return text('Not valid JSON', 400); }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return text('Expected a JSON object { "ICAO": "note", … }', 400);
  }

  // Normalise keys HERE so the sender can stay dumb: an iOS Shortcut can
  // just post raw note titles. A key is kept only if it STARTS with a 3–4
  // letter airport code (optionally followed by " / ICAO", " - City", …);
  // prose titles like "Shopping list" are dropped. Value must be non-empty.
  const clean = {};
  const CODE_RE = /^([A-Za-z]{3,4})(?=$|[\s/·\-–—,:])/;
  for (const [rawKey, rawVal] of Object.entries(obj)) {
    const m = CODE_RE.exec(String(rawKey || '').trim());
    if (!m) continue;
    const val = String(rawVal == null ? '' : rawVal).trim();
    if (!val) continue;
    clean[m[1].toUpperCase()] = val;
  }

  await env.LOGBOOK.put('social:' + token, JSON.stringify(clean), {
    metadata: { updatedAt: Date.now(), keys: Object.keys(clean).length },
  });

  return new Response(JSON.stringify({ ok: true, airports: Object.keys(clean).length }), {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}

async function handleSocialGet(env, token) {
  const body = await env.LOGBOOK.get('social:' + token);
  if (body == null) return text('No social notes published for this token', 404);
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-cache',
    },
  });
}

// ---------- helpers ---------------------------------------------------------

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
