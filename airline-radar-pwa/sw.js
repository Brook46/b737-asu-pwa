// Airline Radar service worker.
//
// The app shell is cache-first so the PWA opens instantly and survives a dead
// cell. Live data is deliberately never cached: an ADS-B position or a map tile
// served from cache would be a lie about where an aircraft is.

const CACHE_VERSION = 'airadar-v10';
const APP_SHELL = [
  './',
  './index.html',
  './app.css?v=10',
  './app.js?v=10',
  './manifest.json',
  './icon.svg',
  './modules/adsb.js',
  './modules/airlines.js',
  './modules/aircraft.js',
  './modules/routes.js',
  './modules/map.js',
  './modules/panel.js',
  './modules/fmt.js',
  './modules/search.js',
  './modules/runways.js',
  './modules/map3d.js',
  './modules/history.js',
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
          .catch(() => { /* tolerate a missing optional shell file */ })
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

  // Live feeds, aircraft photos and map tiles: always straight to the network.
  if (/airplanes\.live|adsbdb\.com|basemaps\.cartocdn\.com|arcgisonline\.com|airport-data\.com|tile/i.test(url.href)) return;

  // Leaflet from the CDN: cache-first after the first load.
  if (/unpkg\.com\/(leaflet|maplibre-gl|deck\.gl)/i.test(url.href)) {
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

  // Same-origin shell: cache-first, falling back to the index when offline.
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
