// Flight Card — TAF + Google-Calendar CORS shim
// ==============================================
//
// Free Cloudflare Worker that fronts two upstream sources the PWA can't
// fetch directly because they don't ship Access-Control-Allow-Origin:
//
//   GET /taf?icao=<ICAO>        →  aviationweather.gov TAF (raw text)
//   GET /ical?url=<encoded URL> →  user's Google Calendar secret iCal feed
//   GET /  | /healthz           →  liveness ping
//
// Free tier (100k req/day) is comfortably more than this PWA will use.
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

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/' || url.pathname === '/healthz') {
      return text('Flight Card proxy OK', 200);
    }

    if (url.pathname === '/taf') {
      return handleTaf(url);
    }

    if (url.pathname === '/ical') {
      return handleIcal(url);
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
