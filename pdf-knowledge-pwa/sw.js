// Service worker: cache the app shell + vendored PDF.js + MiniSearch so the
// app loads fully offline. Bump CACHE_VERSION whenever shell assets change.

const CACHE_VERSION = 'pkpwa-v43';
const APP_SHELL = [
  './',
  './index.html',
  './app.css?v=43',
  './app.js?v=43',
  './manifest.json',
  './icon.svg',
  './modules/storage.js?v=43',
  './modules/pdf-ingest.js?v=43',
  './modules/search.js?v=43',
  './modules/summarize.js?v=43',
  './modules/translate.js?v=43',
  './modules/viewer.js?v=43',
  './modules/ui.js?v=43',
  './modules/manuals.js?v=43',
  './modules/anchor-extract.js?v=43',
  './modules/knowledge-graph.js?v=43',
  './modules/anchor-admin.js?v=43',
  './modules/phases.js?v=43',
  './modules/gps.js?v=43',
  './modules/annotations.js?v=43',
  './modules/scratchpad.js?v=43',
  './modules/revision.js?v=43',
  './vendor/minisearch.min.js',
  './vendor/pdfjs/pdf.min.mjs',
  './vendor/pdfjs/pdf.worker.min.mjs',
];

self.addEventListener('install', (event) => {
  // Fetch with cache:'reload' so a new version always precaches fresh files
  // (bypasses the browser HTTP cache).
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => Promise.all(APP_SHELL.map((url) =>
        fetch(url, { cache: 'reload' })
          .then((res) => { if (res && res.ok) return cache.put(url, res); })
          .catch(() => {})
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('pkpwa-') && k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        fetch(req).then((res) => {
          if (res && res.ok) {
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, res.clone()));
          }
        }).catch(() => {});
        return cached;
      }
      return fetch(req).then((res) => {
        if (res && res.ok && req.url.startsWith(self.location.origin)) {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
        }
        return res;
      }).catch(() => caches.match('./index.html'));
    })
  );
});
