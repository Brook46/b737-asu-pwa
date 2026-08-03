// Sky Club service worker. Everything is local/keyless, so the whole app shell —
// including the vendored astronomy engine, star data and planet textures — is
// cache-first and works fully offline once loaded.

const CACHE_VERSION = 'skyclub-v9';
const APP_SHELL = [
  './',
  './index.html',
  './app.css?v=9',
  './app.js?v=9',
  './manifest.json',
  './icon.svg',
  './modules/astro.js',
  './modules/catalog.js',
  './modules/orbits.js',
  './modules/sky.js',
  './modules/sensors.js',
  './modules/speech.js',
  './modules/starfield.js',
  './modules/moonphase.js',
  './modules/badges.js',
  './modules/resume.js',
  './vendor/astronomy-engine.js',
  './data/stars.json',
  './icons/icon-152.png',
  './icons/icon-167.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/textures/sun.jpg',
  './icons/textures/mercury.jpg',
  './icons/textures/venus.jpg',
  './icons/textures/earth.jpg',
  './icons/textures/moon.jpg',
  './icons/textures/mars.jpg',
  './icons/textures/jupiter.jpg',
  './icons/textures/saturn.jpg',
  './icons/textures/saturn-ring.png',
  './icons/textures/uranus.jpg',
  './icons/textures/neptune.jpg',
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

  // Google Fonts + Phosphor Icons CDN: cache-first after first fetch (same
  // pattern as xcsky-pwa's Leaflet caching — the actual .woff2 URLs are
  // content-negotiated per browser, so they can't be precached ahead of time,
  // but this still gives full offline reuse after the first successful load).
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com|unpkg\.com/i.test(url.href)) {
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

  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
