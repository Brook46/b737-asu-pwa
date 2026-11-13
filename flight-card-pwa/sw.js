// Flight Card service worker.
// App shell is cache-first. Tesseract.js is fetched on demand and then cached.

const CACHE_VERSION = 'flightcard-v283';
const APP_SHELL = [
  './',
  './index.html',
  './app.css?v=283',
  './app.js?v=283',
  './manifest.json',
  './icon.svg',
  './menu.html',
  './share.html',
  './print.html',
  // Route info's airport database — precached so diversions work offline in flight.
  './data/divdb.json',
  './modules/storage.js?v=283',
  './modules/dates.js?v=283',
  './modules/data-card.js?v=283',
  './modules/checklist.js?v=283',
  './modules/print.js?v=283',
  './modules/print-pdf.js?v=283',
  './modules/crew.js?v=283',
  './modules/duties.js?v=283',
  './modules/tlv-board.js?v=283',
  './modules/cpdlc.js?v=283',
  './modules/backup.js?v=283',
  './modules/ftl.js?v=283',
  './modules/flight-strip.js?v=283',
  './modules/pay.js?v=283',
  './modules/plan-route.js?v=283',
  './modules/ely-traffic.js?v=283',
  './modules/atis-diagram.js?v=283',
  './modules/notam-brief.js?v=283',
  './modules/crew-notes.js?v=283',
  './modules/export.js?v=283',
  './modules/social-changes.js?v=283',
  './modules/route-info.js?v=283',
  './modules/route-ui.js?v=283',
  './modules/ui.js?v=283',
  './modules/phase.js?v=283',
  './modules/ocr.js?v=283',
  './modules/speeches.js?v=283',
  './modules/airports.js?v=283',
  './modules/worldmap.js?v=283',
  './modules/mapdata.js?v=283',
  './modules/roster.js?v=283',
  './modules/ly-routes.js?v=283',
  './modules/wx.js?v=283',
  './modules/logbook.js?v=283',
  './modules/logbook-push.js?v=283',
  './modules/gps.js?v=283',
  './modules/g.js?v=283',
  './modules/analytics.js?v=283',
  './modules/sectors-csv.js?v=283',
  './modules/ical.js?v=283',
  './modules/calendar.js?v=283',
  './modules/proxy.js?v=283',
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

// Only this app's OLD caches: every app on the site shares one origin and
// one CacheStorage, and deleting "everything but mine" wiped the others —
// including the ASU copy Flight Card keeps for offline use.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k.startsWith('flightcard-') && k !== CACHE_VERSION).map((k) => caches.delete(k)))
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
  // html2canvas is the Share-as-PDF renderer — same treatment, so after one
  // use it's on the device and the PDF doesn't wait on the network.
  const isTesseract = /tesseract(\.js)?|tessdata|jsdelivr.*tesseract|html2canvas/i.test(url.href);
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
