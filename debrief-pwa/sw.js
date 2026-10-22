// Thermal Debrief service worker.
//
// App shell is cache-first so a debrief works with no signal (the flights
// themselves live in IndexedDB, not here). The two CDN libraries are cached
// after first load — they're big, and re-downloading 2 MB at a launch site on
// a phone tether is exactly what offline support is for.
//
// Map tiles, the DEM and the elevation API are network-only: they're huge,
// change per viewport, and MapLibre keeps its own in-memory tile cache.

const CACHE_VERSION = 'debrief-v6';

const APP_SHELL = [
  './',
  './index.html',
  './app.css?v=6',
  './app.js?v=6',
  './manifest.json',
  './icon.svg',
  './modules/igc.js?v=6',
  './modules/metrics.js?v=6',
  './modules/highlights.js?v=6',
  './modules/insights.js?v=6',
  './modules/xcontest.js?v=6',
  './modules/share.js?v=6',
  './modules/xctsk.js?v=6',
  './modules/terrain.js?v=6',
  './modules/colors.js?v=6',
  './modules/map3d.js?v=6',
  './modules/timeline.js?v=6',
  './modules/charts.js?v=6',
  './modules/exporter.js?v=6',
  './modules/store.js?v=6',
  './modules/format.js?v=6',
  './modules/demo.js?v=6',
  './modules/resume.js?v=6',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-180.png',
];

/** Cache-first, long-lived: the rendering libraries. */
const CDN = /unpkg\.com\/(maplibre-gl|deck\.gl)/i;

/** Never cache: tiles, DEM, elevation and geocoding traffic. */
const NETWORK_ONLY = /arcgisonline\.com|opentopomap\.org|elevation-tiles-prod|amazonaws\.com|api\.open-meteo\.com|openstreetmap\.org/i;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      // Tolerate individual misses (an icon that isn't there yet) rather than
      // failing the whole install and leaving the app uncached.
      Promise.all(APP_SHELL.map((url) =>
        fetch(url, { cache: 'reload' })
          .then((res) => { if (res && res.ok) return cache.put(url, res); })
          .catch(() => {})
      ))
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('debrief-') && k !== CACHE_VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch { return; }

  if (NETWORK_ONLY.test(url.href)) return;

  if (CDN.test(url.href)) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) {
            cache.put(req, res.clone());
          }
          return res;
        } catch {
          return new Response('', { status: 503, statusText: 'Offline' });
        }
      })
    );
    return;
  }

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
