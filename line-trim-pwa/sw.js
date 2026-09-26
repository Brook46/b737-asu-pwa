// sw.js — offline-first. Bump CACHE_VERSION on any shell or data change.
// The whole wing library is precached at install: take-off rarely has signal.

const CACHE_VERSION = 'linetrim-v19';
const SHELL_CACHE = `${CACHE_VERSION}-shell`;

const SHELL = [
  './',
  './index.html',
  './app.css?v=19',
  './app.js?v=19',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
  './modules/store.js?v=19',
  './modules/library.js?v=19',
  './modules/linemodel.js?v=19',
  './modules/session.js?v=19',
  './modules/trim.js?v=19',
  './modules/capture.js?v=19',
  './modules/importer.js?v=19',
  './modules/xlsx.js?v=19',
  './modules/exporter.js?v=19',
  './modules/backup.js?v=19',
  './modules/report.js?v=19',
  './modules/porosity.js?v=19',
  './modules/data/advance-omega-uls.js?v=19',
  './modules/sheets/extract.js?v=19',
  './modules/sheets/sections.js?v=19',
  './modules/sheets/importsheet.js?v=19',
  './modules/sheets/pastcheck.js?v=19',
  './modules/ble/drivers.js?v=19',
  './modules/ble/laser.js?v=19',
  './modules/ui/dom.js?v=19',
  './modules/ui/icons.js?v=19',
  './modules/ui/lineplan.js?v=19',
  './modules/ui/glider.js?v=19',
  './modules/ui/charts.js?v=19',
  './modules/ui/picker.js?v=19',
  './modules/ui/setup.js?v=19',
  './modules/ui/measure.js?v=19',
  './modules/ui/result.js?v=19',
  './modules/ui/history.js?v=19',
  './modules/ui/import.js?v=19',
  './modules/ui/compare.js?v=19',
  './modules/ui/past.js?v=19',
  './modules/ui/guide.js?v=19',
  './modules/ui/reportview.js?v=19',
  './modules/ui/porosity.js?v=19',
  './data/wings/index.json',
];

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    // cache: 'reload' skips the HTTP cache: Pages serves max-age=600, and the wing
    // JSON isn't version-stamped, so a plain fetch here could pin ten-minute-old
    // data into the new cache for good
    const fresh = urls => cache.addAll(urls.map(u => new Request(u, { cache: 'reload' })));
    await fresh(SHELL);
    // every wing file the index names
    try {
      const idx = await (await cache.match('./data/wings/index.json', { ignoreSearch: true })).json();
      await fresh(idx.wings.map(w => `./data/wings/${encodeURIComponent(w.id)}.json`));
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
