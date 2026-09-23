// sw.js — offline-first. Bump CACHE_VERSION on any shell or data change.
// The whole wing library is precached at install: take-off rarely has signal.

const CACHE_VERSION = 'linetrim-v9';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;

const SHELL = [
  './',
  './index.html',
  './app.css?v=9',
  './app.js?v=9',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './modules/store.js?v=9',
  './modules/library.js?v=9',
  './modules/linemodel.js?v=9',
  './modules/session.js?v=9',
  './modules/trim.js?v=9',
  './modules/capture.js?v=9',
  './modules/importer.js?v=9',
  './modules/xlsx.js?v=9',
  './modules/exporter.js?v=9',
  './modules/backup.js?v=9',
  './modules/data/advance-omega-uls.js?v=9',
  './modules/sheets/extract.js?v=9',
  './modules/sheets/sections.js?v=9',
  './modules/sheets/importsheet.js?v=9',
  './modules/sheets/pastcheck.js?v=9',
  './modules/ble/drivers.js?v=9',
  './modules/ble/laser.js?v=9',
  './modules/ui/dom.js?v=9',
  './modules/ui/icons.js?v=9',
  './modules/ui/planform.js?v=9',
  './modules/ui/charts.js?v=9',
  './modules/ui/picker.js?v=9',
  './modules/ui/setup.js?v=9',
  './modules/ui/measure.js?v=9',
  './modules/ui/result.js?v=9',
  './modules/ui/history.js?v=9',
  './modules/ui/import.js?v=9',
  './modules/ui/compare.js?v=9',
  './modules/ui/past.js?v=9',
  './modules/ui/guide.js?v=9',
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
