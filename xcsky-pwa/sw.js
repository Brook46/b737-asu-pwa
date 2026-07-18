// Sky Monkeys service worker.
// App shell is cache-first (works offline). The Open-Meteo API, live-pilot feed
// and map tiles are network-only (fresh + huge). Leaflet CDN is cached after
// first load.

const CACHE_VERSION = 'skymonkeys-v10';
const APP_SHELL = [
  './',
  './index.html',
  './app.css?v=3',
  './app.js?v=3',
  './manifest.json',
  './icon.svg',
  './modules/meteo.js',
  './modules/soaring.js',
  './modules/units.js',
  './modules/chart.js',
  './modules/location.js',
  './modules/map.js',
  './modules/grid.js',
  './modules/pilots.js',
  './modules/resume.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(APP_SHELL.map((url) =>
        fetch(url, { cache: 'reload' })
          .then((res) => { if (res && res.ok) return cache.put(url, res); })
          .catch(() => { /* tolerate missing optional shell files (e.g. icons) */ })
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache the weather API, geocoding, live pilots, or map tiles.
  if (/open-meteo\.com|bigdatacloud\.net|arcgisonline\.com|opentopomap\.org|kk7\.ch|glidernet\.org|openstreetmap\.org|tiles?/i.test(url.href)) return;

  // Leaflet CDN library + CSS: cache-first after first fetch.
  if (/unpkg\.com\/leaflet/i.test(url.href)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) cache.put(req, res.clone());
          return res;
        } catch { return new Response('', { status: 503 }); }
      })
    );
    return;
  }

  // Same-origin app shell: cache-first, fall back to index.html when offline.
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
        }
        return res;
      }).catch(() => caches.match('./index.html')))
    );
  }
});
