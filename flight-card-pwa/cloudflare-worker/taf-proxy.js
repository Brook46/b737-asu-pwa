// Flight Card — TAF CORS shim
// ============================
//
// Deploy this as a Cloudflare Worker (free tier — 100k requests/day, way
// more than this PWA will ever use). The Worker fetches the live raw TAF
// from aviationweather.gov, sets a permissive CORS header, and re-emits
// the body. Cloudflare caches at the edge for 60 seconds so repeat hits
// for the same airport are essentially free.
//
// Why we need this at all
// -----------------------
// aviationweather.gov serves the cleanest no-key TAF text but does NOT
// ship Access-Control-Allow-Origin, so a direct fetch from the PWA gets
// blocked by Safari/Chrome. Routing through a public proxy
// (api.allorigins.win) worked but was slow + occasionally rate-limited
// — hence this small dedicated edge function.
//
// Deploy steps (5 minutes, one-time)
// ----------------------------------
// 1. Make a free Cloudflare account at https://dash.cloudflare.com/sign-up
// 2. Sidebar → Workers & Pages → Create application → Create Worker.
//    Pick any name (e.g. "fc-taf-proxy"). Default code is fine for now.
// 3. After it deploys, click "Edit code". Replace the editor contents with
//    THIS file's body (everything below the export default {). Click
//    "Deploy".
// 4. Cloudflare gives you a URL like
//      https://fc-taf-proxy.<your-account>.workers.dev
//    Send that URL back to me and I'll wire it into modules/wx.js.
// 5. Optional — set a custom domain later if you want a shorter URL.
//
// Resources cost: a TAF refresh every 10 minutes per airport, two airports
// per leg, maybe 5 hits per pilot per duty period. You will never see the
// free tier's 100k/day limit.

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Health check at /  — useful for testing the worker is alive.
    if (url.pathname === '/' || url.pathname === '/healthz') {
      return new Response('TAF proxy OK', {
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'access-control-allow-origin': '*',
          'cache-control': 'no-store',
        },
      });
    }

    // Only the /taf path is wired up. Anything else → 404.
    if (url.pathname !== '/taf') {
      return new Response('Not found', { status: 404 });
    }

    // Validate the ICAO query parameter — 4 letters, no other characters.
    const icao = (url.searchParams.get('icao') || '').toUpperCase();
    if (!/^[A-Z]{4}$/.test(icao)) {
      return new Response('Bad ICAO', {
        status: 400,
        headers: { 'access-control-allow-origin': '*' },
      });
    }

    // Fetch upstream. cf.cacheTtl tells Cloudflare's edge to cache the
    // response for 60 s, so a second hit for the same ICAO from any
    // device hitting the same edge POP is essentially free.
    const upstream =
      'https://aviationweather.gov/api/data/taf?ids=' + encodeURIComponent(icao) + '&format=raw';
    let upstreamRes;
    try {
      upstreamRes = await fetch(upstream, {
        cf: { cacheTtl: 60, cacheEverything: true },
      });
    } catch (err) {
      return new Response('Upstream unreachable: ' + err.message, {
        status: 502,
        headers: { 'access-control-allow-origin': '*' },
      });
    }

    const body = await upstreamRes.text();
    return new Response(body, {
      status: upstreamRes.status,
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        // PWA fetches will come from brook46.github.io but allowing any
        // origin keeps this Worker reusable if the PWA ever moves.
        'access-control-allow-origin': '*',
        'cache-control': 'public, max-age=60',
      },
    });
  },
};
