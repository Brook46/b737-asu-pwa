// 737 NG Inside service worker. Everything is local and keyless, so the whole
// app shell — including the vendored three.js — is cache-first and works
// fully offline in the flight deck once loaded.
//
// Vendor files are immutable per release and are imported with the app's
// ?v= stamp, so they're matched ignoring the query string.

const CACHE_VERSION = 'b737inside-v56';
const APP_SHELL = [
  './',
  './index.html',
  './app.css?v=56',
  './app.js?v=56',
  './manifest.json',
  './icon.svg',
  './data/navdb.json',
  './modules/airframe.js?v=56',
  './modules/airlink.js?v=56',
  './modules/cdu-view.js?v=56',
  './modules/cdu.js?v=56',
  './modules/cockpit-cab.js?v=56',
  './modules/cockpit-displays.js?v=56',
  './modules/cockpit-info.js?v=56',
  './modules/cockpit-stand.js?v=56',
  './modules/cockpit.js?v=56',
  './modules/dims.js?v=56',
  './modules/flightsim.js?v=56',
  './modules/fmc.js?v=56',
  './modules/gauges.js?v=56',
  './modules/learn.js?v=56',
  './modules/navdb.js?v=56',
  './modules/metar.js?v=56',
  './modules/notes.js?v=56',
  './modules/orbit-controls.js?v=56',
  './modules/outside.js?v=56',
  './modules/overhead.js?v=56',
  './modules/overlay.js?v=56',
  './modules/panelview.js?v=56',
  './modules/phases.js?v=56',
  './modules/progress.js?v=56',
  './modules/quickref.js?v=56',
  './modules/cues.js?v=56',
  './modules/supplementary.js?v=56',
  './modules/supp-advisor.js?v=56',
  './modules/supp-procs.js?v=56',
  './modules/quizbank.js?v=56',
  './modules/reader.js?v=56',
  './modules/resume.js?v=56',
  './modules/rto.js?v=56',
  './modules/scene.js?v=56',
  './modules/schem-air.js?v=56',
  './modules/schem-antiice.js?v=56',
  './modules/schem-autoflight.js?v=56',
  './modules/schem-comms.js?v=56',
  './modules/schem-electrical.js?v=56',
  './modules/schem-engines.js?v=56',
  './modules/schem-fire.js?v=56',
  './modules/schem-flightcontrols.js?v=56',
  './modules/schem-fms.js?v=56',
  './modules/schem-fuel.js?v=56',
  './modules/schem-gear.js?v=56',
  './modules/schem-general.js?v=56',
  './modules/schem-hydraulics.js?v=56',
  './modules/schem-instruments.js?v=56',
  './modules/schem-kit.js?v=56',
  './modules/schem-warnings.js?v=56',
  './modules/search.js?v=56',
  './modules/sheet.js?v=56',
  './modules/speech.js?v=56',
  './modules/statebar.js?v=56',
  './modules/sys-air.js?v=56',
  './modules/sys-antiice.js?v=56',
  './modules/sys-autoflight.js?v=56',
  './modules/sys-comms.js?v=56',
  './modules/sys-electrical.js?v=56',
  './modules/sys-engines.js?v=56',
  './modules/sys-fire.js?v=56',
  './modules/sys-flightcontrols.js?v=56',
  './modules/sys-fms.js?v=56',
  './modules/sys-fuel.js?v=56',
  './modules/sys-gear.js?v=56',
  './modules/sys-general.js?v=56',
  './modules/sys-hydraulics.js?v=56',
  './modules/sys-instruments.js?v=56',
  './modules/sys-warnings.js?v=56',
  './modules/systems.js?v=56',
  './modules/systems3d.js?v=56',
  './modules/viewcube.js?v=56',
  './modules/world.js?v=56',
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
