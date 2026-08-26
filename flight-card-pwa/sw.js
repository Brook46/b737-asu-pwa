// Flight Card service worker.
// App shell is cache-first. Tesseract.js is fetched on demand and then cached.

const CACHE_VERSION = 'flightcard-v111';
const APP_SHELL = [
  './',
  './index.html',
  './app.css?v=111',
  './app.js?v=111',
  './manifest.json',
  './icon.svg',
  './menu.html',
  './share.html',
  './modules/storage.js?v=111',
  './modules/dates.js?v=111',
  './modules/data-card.js?v=111',
  './modules/checklist.js?v=111',
  './modules/print.js?v=111',
  './modules/ui.js?v=111',
  './modules/ocr.js?v=111',
  './modules/speeches.js?v=111',
  './modules/airports.js?v=111',
  './modules/roster.js?v=111',
  './modules/ly-routes.js?v=111',
  './modules/wx.js?v=111',
  './modules/logbook.js?v=111',
  './modules/logbook-push.js?v=111',
  './modules/gps.js?v=111',
  './modules/g.js?v=111',
  './modules/analytics.js?v=111',
  './modules/ical.js?v=111',
  './modules/calendar.js?v=111',
  './modules/proxy.js?v=111',
  './share-roster.html',
  './icons/icon-152.png',
  './icons/icon-167.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-1024.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(APP_SHELL.map((url) =>
        fetch(url, { cache: 'reload' })
          .then((res) => { if (res && res.ok) return cache.put(url, res); })
          .catch(() => { /* tolerate missing optional shell files */ })
      ))
    ).then(() => self.skipWaiting())
  );
});

// Backup channel so the page can ALWAYS force this SW to take over even
// if the install-time skipWaiting() got swallowed by iOS. The page posts
// { type: 'SKIP_WAITING' } and we transition active immediately.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
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

  // Lazy-loaded CDN library (Tesseract.js for OCR): cache after first fetch
  // so the feature works offline once you've used it once on a connected
  // device.
  const isTesseract = /tesseract(\.js)?|tessdata|jsdelivr.*tesseract/i.test(url.href);
  if (isTesseract) {
    event.respondWith(
      caches.open(CACHE_VERSION).then(async (cache) => {
        const cached = await cache.match(req);
        if (cached) return cached;
        try {
          const res = await fetch(req);
          if (res && res.ok && (res.type === 'basic' || res.type === 'cors')) cache.put(req, res.clone());
          return res;
        } catch (err) {
          // No cache, no network → fail gracefully
          return new Response('OCR engine offline and not cached yet.', { status: 503 });
        }
      })
    );
    return;
  }

  // Same-origin app shell: cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
          }
          return res;
        }).catch(() => caches.match('./index.html'));
      })
    );
  }
});
