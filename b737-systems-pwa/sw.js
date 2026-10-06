// 737 NG Inside service worker. Everything is local and keyless, so the whole
// app shell — including the vendored three.js — is cache-first and works
// fully offline in the flight deck once loaded.
//
// Vendor files are immutable per release and are imported with the app's
// ?v= stamp, so they're matched ignoring the query string.

const CACHE_VERSION = 'b737inside-v23';
const APP_SHELL = [
  './',
  './index.html',
  './app.css?v=23',
  './app.js?v=23',
  './manifest.json',
  './icon.svg',
  './data/navdb.json',
  './modules/airframe.js?v=23',
  './modules/airlink.js?v=23',
  './modules/cdu-view.js?v=23',
  './modules/cdu.js?v=23',
  './modules/cockpit-cab.js?v=23',
  './modules/cockpit-displays.js?v=23',
  './modules/cockpit-info.js?v=23',
  './modules/cockpit-stand.js?v=23',
  './modules/cockpit.js?v=23',
  './modules/flightsim.js?v=23',
  './modules/fmc.js?v=23',
  './modules/gauges.js?v=23',
  './modules/learn.js?v=23',
  './modules/navdb.js?v=23',
  './modules/notes.js?v=23',
  './modules/orbit-controls.js?v=23',
  './modules/outside.js?v=23',
  './modules/overhead.js?v=23',
  './modules/overlay.js?v=23',
  './modules/panelview.js?v=23',
  './modules/phases.js?v=23',
  './modules/progress.js?v=23',
  './modules/quickref.js?v=23',
  './modules/quizbank.js?v=23',
  './modules/reader.js?v=23',
  './modules/resume.js?v=23',
  './modules/scene.js?v=23',
  './modules/schem-air.js?v=23',
  './modules/schem-antiice.js?v=23',
  './modules/schem-autoflight.js?v=23',
  './modules/schem-comms.js?v=23',
  './modules/schem-electrical.js?v=23',
  './modules/schem-engines.js?v=23',
  './modules/schem-fire.js?v=23',
  './modules/schem-flightcontrols.js?v=23',
  './modules/schem-fms.js?v=23',
  './modules/schem-fuel.js?v=23',
  './modules/schem-gear.js?v=23',
  './modules/schem-general.js?v=23',
  './modules/schem-hydraulics.js?v=23',
  './modules/schem-instruments.js?v=23',
  './modules/schem-kit.js?v=23',
  './modules/schem-warnings.js?v=23',
  './modules/search.js?v=23',
  './modules/sheet.js?v=23',
  './modules/speech.js?v=23',
  './modules/statebar.js?v=23',
  './modules/sys-air.js?v=23',
  './modules/sys-antiice.js?v=23',
  './modules/sys-autoflight.js?v=23',
  './modules/sys-comms.js?v=23',
  './modules/sys-electrical.js?v=23',
  './modules/sys-engines.js?v=23',
  './modules/sys-fire.js?v=23',
  './modules/sys-flightcontrols.js?v=23',
  './modules/sys-fms.js?v=23',
  './modules/sys-fuel.js?v=23',
  './modules/sys-gear.js?v=23',
  './modules/sys-general.js?v=23',
  './modules/sys-hydraulics.js?v=23',
  './modules/sys-instruments.js?v=23',
  './modules/sys-warnings.js?v=23',
  './modules/systems.js?v=23',
  './modules/systems3d.js?v=23',
  './modules/viewcube.js?v=23',
  './modules/world.js?v=23',
  './vendor/three.module.min.js',
  './icons/icon-152.png',
  './icons/icon-167.png',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) =>
      Promise.all(APP_SHELL.map((url) =>
        fetch(url, { cache: 'reload' })
          .then((res) => { if (res && res.ok) return cache.put(url, res); })
          .catch(() => { /* tolerate a missing optional shell file */ })
      ))
    ).then(() => self.skipWaiting())
  );
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

  // Google Fonts: cache-first after the first fetch (the .woff2 URLs are
  // negotiated per browser, so they can't be precached ahead of time).
  if (/fonts\.googleapis\.com|fonts\.gstatic\.com/i.test(url.href)) {
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

  if (url.origin !== self.location.origin) return;
  const vendor = url.pathname.includes('/vendor/');

  event.respondWith(
    caches.match(req, { ignoreSearch: vendor }).then((cached) => cached || fetch(req).then((res) => {
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(CACHE_VERSION).then((c) => c.put(req, clone));
      }
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
