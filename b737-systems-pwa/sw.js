// 737 NG Inside service worker. Everything is local and keyless, so the whole
// app shell — including the vendored three.js — is cache-first and works
// fully offline in the flight deck once loaded.
//
// Vendor files are immutable per release and are imported with the app's
// ?v= stamp, so they're matched ignoring the query string.

const CACHE_VERSION = 'b737inside-v10';
const APP_SHELL = [
  './',
  './index.html',
  './app.css?v=10',
  './app.js?v=10',
  './manifest.json',
  './icon.svg',
  './modules/airframe.js?v=10',
  './modules/airlink.js?v=10',
  './modules/cockpit-cab.js?v=10',
  './modules/cockpit-displays.js?v=10',
  './modules/cockpit-info.js?v=10',
  './modules/cockpit.js?v=10',
  './modules/gauges.js?v=10',
  './modules/learn.js?v=10',
  './modules/notes.js?v=10',
  './modules/orbit-controls.js?v=10',
  './modules/outside.js?v=10',
  './modules/overhead.js?v=10',
  './modules/overlay.js?v=10',
  './modules/phases.js?v=10',
  './modules/progress.js?v=10',
  './modules/quickref.js?v=10',
  './modules/quizbank.js?v=10',
  './modules/reader.js?v=10',
  './modules/resume.js?v=10',
  './modules/scene.js?v=10',
  './modules/schem-air.js?v=10',
  './modules/schem-antiice.js?v=10',
  './modules/schem-autoflight.js?v=10',
  './modules/schem-comms.js?v=10',
  './modules/schem-electrical.js?v=10',
  './modules/schem-engines.js?v=10',
  './modules/schem-fire.js?v=10',
  './modules/schem-flightcontrols.js?v=10',
  './modules/schem-fms.js?v=10',
  './modules/schem-fuel.js?v=10',
  './modules/schem-gear.js?v=10',
  './modules/schem-general.js?v=10',
  './modules/schem-hydraulics.js?v=10',
  './modules/schem-instruments.js?v=10',
  './modules/schem-kit.js?v=10',
  './modules/schem-warnings.js?v=10',
  './modules/search.js?v=10',
  './modules/sheet.js?v=10',
  './modules/speech.js?v=10',
  './modules/sys-air.js?v=10',
  './modules/sys-antiice.js?v=10',
  './modules/sys-autoflight.js?v=10',
  './modules/sys-comms.js?v=10',
  './modules/sys-electrical.js?v=10',
  './modules/sys-engines.js?v=10',
  './modules/sys-fire.js?v=10',
  './modules/sys-flightcontrols.js?v=10',
  './modules/sys-fms.js?v=10',
  './modules/sys-fuel.js?v=10',
  './modules/sys-gear.js?v=10',
  './modules/sys-general.js?v=10',
  './modules/sys-hydraulics.js?v=10',
  './modules/sys-instruments.js?v=10',
  './modules/sys-warnings.js?v=10',
  './modules/systems.js?v=10',
  './modules/systems3d.js?v=10',
  './modules/viewcube.js?v=10',
  './modules/world.js?v=10',
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
