// Airline Radar — standby ADS-B feed.
// ===================================
//
// Why this exists at all
// ----------------------
// The app reads positions straight from api.airplanes.live, the one free
// aggregator that sends `Access-Control-Allow-Origin: *`. When that host
// started answering 403 behind a "contact us" gate, the app had nowhere to go:
// adsb.lol and adsb.fi carry the same network's data in the same record shape,
// but send no CORS header at all, so a browser cannot read them. A server can —
// CORS is a browser rule, not a server one — so this reads them and re-serves
// with the header the page needs.
//
// Why it isn't the Cloudflare Worker
// ----------------------------------
// It was, first, and it only half worked. Probing from inside that Worker:
// adsb.fi, adsb.one and airplanes.live all refuse the subrequest at
// Cloudflare's edge in ~6 ms, OpenSky times out, and adsb.lol reaches its
// origin only to answer 429. That 429 is not about our volume — from an
// ordinary host, twelve of twelve requests at the app's own rate came back
// 200. It is the egress address every Worker on the platform shares. So the
// fix was never more caching; it was asking from somewhere that isn't
// Cloudflare.
//
// Deploy: console.deno.com, entrypoint airline-radar-pwa/adsb-proxy/main.ts.
//
//   GET /adsb/point/<lat>/<lon>/<radiusNm>
//   GET /adsb/reg/<reg> | /adsb/callsign/<cs> | /adsb/hex/<hex>
//   GET /adsb/probe    — what each upstream says to *this* host, verbatim
//   GET /healthz
//
// Every path is parsed into numbers and identifiers and the upstream URL is
// rebuilt from them — never passed through — so this can't be repurposed as the
// open relay a `?url=` proxy would be.

const ADSB_POINT_RE =
  /^\/adsb\/point\/(-?\d{1,3}(?:\.\d{1,6})?)\/(-?\d{1,3}(?:\.\d{1,6})?)\/(\d{1,3})$/;
const ADSB_FIND_RE = /^\/adsb\/(reg|callsign|hex)\/([A-Za-z0-9-]{1,12})$/;

// Who's asking. These feeds are run by volunteers and fronted by bot protection
// that treats an unidentified datacentre request as exactly what it looks like;
// a name and a link are what turn this into a request they can judge on its
// merits — and complain about to a real address if need be.
const ADSB_UA =
  'AirlineRadar/1.0 (+https://github.com/Brook46/b737-asu-pwa; hobby PWA, ~1 req/5s)';

// Serve a stored snapshot outright below this age; keep serving it, labelled
// with its age, up to the second. The app dead-reckons from a fix whose age it
// knows perfectly well, and stops trusting one older than 90 s on its own.
const ADSB_FRESH_MS = 4 * 1000;
const ADSB_STALE_MS = 5 * 60 * 1000;

// A mirror that refuses is easy; a mirror that simply never answers is what
// hurts. Cloudflare capped its own subrequests, so nothing here needed saying —
// on Deno an unanswered fetch waits forever, three of them in a row wait three
// times forever, and the caller gives up long before we do. Cap each attempt,
// and cap the walk: past the deadline a stored snapshot is a better answer than
// a request the app has already stopped waiting for. Both sit under the app's
// 5-second refresh so a slow round can never pile up on the next one.
// A healthy mirror answers in 150–450 ms, so two seconds is already generous;
// the number is a patience limit, not an estimate. Kept deliberately tight
// because the cost of a hung upstream is paid on the way to a working one —
// measured at 3.5 s, every reply took 3.66 s and outlived its own cache entry,
// which is a slow feed dressed up as a working one.
const UPSTREAM_TIMEOUT_MS = 2000;
const TOTAL_DEADLINE_MS = 6000;

const CACHE_NAME = 'adsb';

// Which mirror answered last. Without this the list is walked in a fixed order
// every time, so whichever host happens to be hanging today is patiently waited
// on before the working one is asked — the full timeout, on every single
// request. Remembering costs one variable and means a mirror has to fail before
// it's preferred against, rather than being ranked now on how things looked
// while this was written. Deliberately in-memory: it should expire with the
// isolate, because it's a guess about right now, not a fact worth persisting.
let preferredHost = '';

/** The upstream list, with whatever worked last moved to the front. */
function preferLastGood(list: string[]): string[] {
  if (!preferredHost) return list;
  const i = list.findIndex((u) => new URL(u).hostname === preferredHost);
  return i <= 0 ? list : [list[i], ...list.slice(0, i), ...list.slice(i + 1)];
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      'access-control-allow-origin': '*',
      'cache-control': 'no-store',
    },
  });
}

/**
 * What each upstream says to *this* host.
 *
 * Every address available for testing from a laptop is a datacentre address,
 * and these feeds judge those differently from a phone on a home connection —
 * so "works from my machine" proves nothing about what a given host can reach.
 * This asks from inside the deployment and reports each answer verbatim. It is
 * the gate for moving hosts again: if adsb.lol ever stops returning 200 here,
 * this endpoint says so in one request.
 */
async function handleAdsbProbe(): Promise<Response> {
  const candidates: [string, string][] = [
    ['adsb.lol', 'https://api.adsb.lol/v2/point/32.01/34.89/50'],
    ['adsb.fi', 'https://opendata.adsb.fi/api/v2/lat/32.01/lon/34.89/dist/50'],
    ['airplanes.live', 'https://api.airplanes.live/v2/point/32.01/34.89/50'],
    ['adsb.one', 'https://api.adsb.one/v2/point/32.01/34.89/50'],
    ['opensky', 'https://opensky-network.org/api/states/all?lamin=31.2&lomin=33.9&lamax=32.8&lomax=35.9'],
  ];
  const out: Record<string, unknown> = {};
  await Promise.all(candidates.map(async ([name, target]) => {
    const t0 = Date.now();
    try {
      const res = await fetch(target, {
        headers: { accept: 'application/json', 'user-agent': ADSB_UA },
        signal: AbortSignal.timeout(8000),
      });
      const body = await res.text();
      out[name] = {
        status: res.status,
        ms: Date.now() - t0,
        bytes: body.length,
        sample: body.slice(0, 90),
      };
    } catch (err) {
      out[name] = {
        status: 'throw',
        ms: Date.now() - t0,
        sample: String((err as Error).message),
      };
    }
  }));
  return json(out);
}

async function handleAdsb(url: URL): Promise<Response> {
  if (url.pathname === '/adsb/probe') return handleAdsbProbe();

  const pt = url.pathname.match(ADSB_POINT_RE);
  const fd = url.pathname.match(ADSB_FIND_RE);

  let tries: string[];
  let cachePath = url.pathname;
  if (pt) {
    const rawLat = Number(pt[1]);
    const rawLon = Number(pt[2]);
    const rawR = Math.min(250, Math.max(1, parseInt(pt[3], 10)));
    if (!Number.isFinite(rawLat) || Math.abs(rawLat) > 90) return text('Bad latitude', 400);
    if (!Number.isFinite(rawLon) || Math.abs(rawLon) > 180) return text('Bad longitude', 400);

    // Snap the query to a coarse grid before it becomes a cache key. Asked
    // literally, every device size and every nudge of the map is a brand-new
    // key and therefore a brand-new upstream request — which is how one user
    // on two devices manages to look like constant traffic to a rate limiter.
    // Rounded to a tenth of a degree and rounded *up* to the next 25 NM, they
    // all land on the same entry, and the answer is a superset of what each
    // asked for: a few extra aircraft off-screen, never a missing one.
    const lat = Math.round(rawLat * 10) / 10;
    const lon = Math.round(rawLon * 10) / 10;
    const r = Math.min(250, Math.ceil(rawR / 25) * 25);
    cachePath = `/adsb/point/${lat}/${lon}/${r}`;
    tries = [
      `https://api.adsb.lol/v2/point/${lat}/${lon}/${r}`,
      `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${r}`,
      `https://api.airplanes.live/v2/point/${lat}/${lon}/${r}`,
    ];
  } else if (fd) {
    const kind = fd[1].toLowerCase();
    const v = encodeURIComponent(fd[2].toUpperCase());
    // adsb.fi calls the registration lookup by its full name.
    const fiKind = kind === 'reg' ? 'registration' : kind;
    tries = [
      `https://api.adsb.lol/v2/${kind}/${v}`,
      `https://opendata.adsb.fi/api/v2/${fiKind}/${v}`,
      `https://api.airplanes.live/v2/${kind}/${v}`,
    ];
  } else {
    return text('Bad ADS-B path', 400);
  }

  // Even where the mirrors answer, a refusal now and then is routine. Keeping
  // the last good snapshot turns one into slightly-old positions instead of an
  // empty map — and `ageMs` travels with it so the app can say DR rather than
  // pretend the fix is current. Aircraft are dead-reckoned between updates
  // anyway; this is the same bargain, made one layer further out.
  const cache = await caches.open(CACHE_NAME);
  const cacheKey = new Request(`https://adsb-cache.invalid${cachePath}`);
  const cached = await cache.match(cacheKey);
  if (cached) {
    const age = Date.now() - Number(cached.headers.get('x-fetched-at') || 0);
    if (age >= 0 && age < ADSB_FRESH_MS) {
      const body = await cached.clone().json();
      return json({ ...body, ageMs: age });
    }
  }

  const errs: string[] = [];
  const deadline = Date.now() + TOTAL_DEADLINE_MS;
  for (const target of preferLastGood(tries)) {
    const host = new URL(target).hostname;
    if (Date.now() > deadline) { errs.push(`${host} skipped (deadline)`); continue; }
    try {
      const res = await fetch(target, {
        headers: { accept: 'application/json', 'user-agent': ADSB_UA },
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (!res.ok) { errs.push(`${host} ${res.status}`); continue; }
      const data = await res.json();
      const ac = Array.isArray(data.ac)
        ? data.ac
        : (Array.isArray(data.aircraft) ? data.aircraft : []);
      const fresh = json({ ac, source: host, ageMs: 0 });
      // Keep a copy for the next caller, and for the next refusal. The stored
      // copy carries its own timestamp because the Cache API's freshness and
      // ours are different questions: it decides when to evict, we decide what
      // counts as current.
      const keep = new Response(JSON.stringify({ ac, source: host }), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': `public, max-age=${Math.round(ADSB_STALE_MS / 1000)}`,
          'x-fetched-at': String(Date.now()),
        },
      });
      await cache.put(cacheKey, keep);
      preferredHost = host;
      return fresh;
    } catch (err) {
      errs.push(`${host} ${(err as Error).message}`);
    }
  }

  // Nothing answered. A recent snapshot beats an empty map, as long as its age
  // travels with it.
  if (cached) {
    const age = Date.now() - Number(cached.headers.get('x-fetched-at') || 0);
    if (age >= 0 && age < ADSB_STALE_MS) {
      const body = await cached.json();
      return json({ ...body, ageMs: age, stale: errs.join('; ') });
    }
  }
  return text('No ADS-B upstream answered: ' + errs.join('; '), 502);
}

Deno.serve(async (request: Request) => {
  const url = new URL(request.url);

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '86400',
      },
    });
  }
  if (request.method !== 'GET') return text('Method not allowed', 405);

  if (url.pathname === '/' || url.pathname === '/healthz') {
    return text('Airline Radar ADS-B proxy OK', 200);
  }
  if (url.pathname.startsWith('/adsb/')) return handleAdsb(url);

  return text('Not found', 404);
});
