// Sky Club service worker. Everything is local/keyless, so the whole app shell —
// including the vendored astronomy engine, star data and planet textures — is
// cache-first and works fully offline once loaded.

const CACHE_VERSION = 'skyclub-v8';
const APP_SHELL = [
  './',
  './index.html',
  './app.css?v=8',
  './app.js?v=8',
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
