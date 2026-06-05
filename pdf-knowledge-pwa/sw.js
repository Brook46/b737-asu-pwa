// Service worker: cache the app shell + vendored PDF.js + MiniSearch so the
// app loads fully offline. Bump CACHE_VERSION whenever shell assets change.

const CACHE_VERSION = 'pkpwa-v35';
const APP_SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './manifest.json',
  './icon.svg',
  './modules/storage.js',
  './modules/pdf-ingest.js',
  './modules/search.js',
  './modules/summarize.js',
  './modules/translate.js',
  './modules/viewer.js',
  './modules/ui.js',
  './modules/manuals.js',
  './modules/anchor-extract.js',
  './modules/knowledge-graph.js',
  './modules/anchor-admin.js',
  './modules/phases.js',
  './modules/gps.js',
  './modules/annotations.js',
  './modules/scratchpad.js',
  './modules/revision.js',
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
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
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
