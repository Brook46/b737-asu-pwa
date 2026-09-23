// sw.js — offline-first. Bump CACHE_VERSION on any shell or data change.
// The whole wing library is precached at install: take-off rarely has signal.

const CACHE_VERSION = 'linetrim-v8';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;

const SHELL = [
  './',
  './index.html',
  './app.css?v=8',
  './app.js?v=8',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './modules/store.js?v=8',
  './modules/library.js?v=8',
  './modules/linemodel.js?v=8',
  './modules/session.js?v=8',
  './modules/trim.js?v=8',
  './modules/capture.js?v=8',
  './modules/importer.js?v=8',
  './modules/xlsx.js?v=8',
  './modules/exporter.js?v=8',
  './modules/backup.js?v=8',
  './modules/data/advance-omega-uls.js?v=8',
  './modules/sheets/extract.js?v=8',
  './modules/sheets/sections.js?v=8',
  './modules/sheets/importsheet.js?v=8',
  './modules/sheets/pastcheck.js?v=8',
  './modules/ble/drivers.js?v=8',
  './modules/ble/laser.js?v=8',
  './modules/ui/dom.js?v=8',
  './modules/ui/icons.js?v=8',
  './modules/ui/planform.js?v=8',
  './modules/ui/charts.js?v=8',
  './modules/ui/picker.js?v=8',
  './modules/ui/setup.js?v=8',
  './modules/ui/measure.js?v=8',
  './modules/ui/result.js?v=8',
  './modules/ui/history.js?v=8',
  './modules/ui/import.js?v=8',
  './modules/ui/compare.js?v=8',
  './modules/ui/past.js?v=8',
  './modules/ui/guide.js?v=8',
  './data/wings/index.json',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(SHELL);
    // every wing file the index names
    try {
      const idx = await (await cache.match('./data/wings/index.json')).json();
      await cache.addAll(idx.wings.map(w => `./data/wings/${encodeURIComponent(w.id)}.json`));
    } catch { /* the library will fill in on first use */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => !k.startsWith(CACHE_VERSION)).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res.ok && res.type === 'basic') cache.put(req, res.clone());
      return res;
    } catch {
      return (await cache.match('./index.html')) || Response.error();
    }
  })());
});
