// sw.js — offline-first. Bump CACHE_VERSION on any shell or data change.
// The whole wing library is precached at install: take-off rarely has signal.

const CACHE_VERSION = 'linetrim-v7';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;

const SHELL = [
  './',
  './index.html',
  './app.css?v=7',
  './app.js?v=7',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './modules/store.js?v=7',
  './modules/library.js?v=7',
  './modules/linemodel.js?v=7',
  './modules/session.js?v=7',
  './modules/trim.js?v=7',
  './modules/capture.js?v=7',
  './modules/importer.js?v=7',
  './modules/xlsx.js?v=7',
  './modules/exporter.js?v=7',
  './modules/data/advance-omega-uls.js?v=7',
  './modules/sheets/extract.js?v=7',
  './modules/sheets/sections.js?v=7',
  './modules/sheets/importsheet.js?v=7',
  './modules/ble/drivers.js?v=7',
  './modules/ble/laser.js?v=7',
  './modules/ui/dom.js?v=7',
  './modules/ui/icons.js?v=7',
  './modules/ui/planform.js?v=7',
  './modules/ui/charts.js?v=7',
  './modules/ui/picker.js?v=7',
  './modules/ui/setup.js?v=7',
  './modules/ui/measure.js?v=7',
  './modules/ui/result.js?v=7',
  './modules/ui/history.js?v=7',
  './modules/ui/import.js?v=7',
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
