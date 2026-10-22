// Service worker: cache the app shell + vendored PDF.js + MiniSearch so the
// app loads fully offline. Bump CACHE_VERSION whenever shell assets change.

const CACHE_VERSION = 'pkpwa-v42';
const APP_SHELL = [
  './',
  './index.html',
  './app.css?v=42',
  './app.js?v=42',
  './manifest.json',
  './icon.svg',
  './modules/storage.js?v=42',
  './modules/pdf-ingest.js?v=42',
  './modules/search.js?v=42',
  './modules/summarize.js?v=42',
  './modules/translate.js?v=42',
  './modules/viewer.js?v=42',
  './modules/ui.js?v=42',
  './modules/manuals.js?v=42',
  './modules/anchor-extract.js?v=42',
  './modules/knowledge-graph.js?v=42',
  './modules/anchor-admin.js?v=42',
  './modules/phases.js?v=42',
  './modules/gps.js?v=42',
  './modules/annotations.js?v=42',
  './modules/scratchpad.js?v=42',
  './modules/revision.js?v=42',
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
