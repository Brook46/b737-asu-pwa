// Service worker: offline-first, but self-healing rather than stubbornly stale.
const VER = 'duty-cal-v16';
const CORE = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'parser.js',
  'calendar.js',
  'kinds.js',
  'summary.js',
  'radar.js',
  'ics.js',
  'manifest.json',
  'icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'vendor/pdfjs/pdf.min.mjs',
  'vendor/pdfjs/pdf.worker.min.mjs',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VER).map(k => caches.delete(k)))));
  self.clients.claim();
});

// Lets the page drive an update and, just as importantly, ask what is actually
// running — "am I up to date?" is unanswerable from the page alone.
self.addEventListener('message', e => {
  const type = e.data && e.data.type;
  if (type === 'SKIP_WAITING') self.skipWaiting();
  if (type === 'GET_VERSION') {
    const reply = { type: 'VERSION', version: VER };
    if (e.ports && e.ports[0]) e.ports[0].postMessage(reply);
    else if (e.source) e.source.postMessage(reply);
  }
});

// Stale-while-revalidate: answer instantly from cache (so the app still opens
// on a plane), but refresh that entry in the background so the *next* launch is
// current. A plain cache-first worker keeps serving old code until VER changes,
// which is what makes a PWA feel permanently out of date.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // cross-origin: straight to network

  e.respondWith((async () => {
    const cache = await caches.open(VER);
    const cached = await cache.match(req);

    const fromNetwork = fetch(req).then(res => {
      if (res && res.ok) cache.put(req, res.clone()).catch(() => {});
      return res;
    }).catch(() => null);

    if (cached) {
      e.waitUntil(fromNetwork);   // keep the SW alive long enough to store it
      return cached;
    }
    return (await fromNetwork) || new Response('Offline', { status: 503, statusText: 'Offline' });
  })());
});
