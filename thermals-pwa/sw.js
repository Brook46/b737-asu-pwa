// Thermals service worker.
// App shell is cache-first. MapLibre (CDN) is cached on first load so the
// shell works offline; map *tiles* are network-only (they're huge + dynamic).

const CACHE_VERSION = 'thermals-v15';
// Thermals used to share Sky Club's 'skyclub-' prefix; its last cache under that
// name is cleared once below. Every other 'skyclub-*' cache belongs to Sky Club.
const APP_SHELL = [
  './',
  './index.html',
  './app.css?v=15',
  './app.js?v=15',
  './config.js',
  './manifest.json',
  './icon.svg',
  './modules/ui.js?v=15',
  './modules/geo.js?v=15',
  './modules/icons.js?v=15',
  './modules/state.js?v=15',
  './modules/profile.js?v=15',
  './modules/map.js?v=15',
  './modules/presence.js?v=15',
  './modules/auth.js?v=15',
  './modules/roster.js?v=15',
  './modules/chat.js?v=15',
  './modules/sos.js?v=15',
  './modules/crash.js?v=15',
  './modules/xc.js?v=15',
  './modules/elevation.js?v=15',
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
      Promise.all(keys.filter((k) => (k.startsWith('thermals-') && k !== CACHE_VERSION) || k === 'skyclub-v14').map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Never cache the API/WebSocket or map tiles.
  if (/workers\.dev|\/room\/|\/verify\//.test(url.href)) return;
  const isTile = /tiles?|openfreemap|maptiler|elevation-tiles|amazonaws/i.test(url.href);
  if (isTile) return; // network-only

  // MapLibre CDN library: cache-first after first fetch.
  if (/unpkg\.com\/maplibre-gl/i.test(url.href)) {
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

  // Same-origin app shell: cache-first.
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
