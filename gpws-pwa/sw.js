/* GPWS simulator service worker — cache-first for the app shell.
   Bump VERSION on every deploy so clients pick up new assets. */
const VERSION = 'gpws-v4';
const SOUNDS = [
  'pull-up.mp3', 'sink-rate.mp3', 'dont-sink.wav', 'too-low-gear.wav',
  'too-low-flaps.wav', 'too-low-terrain.wav', 'glideslope.wav', 'bank-angle.wav',
  'minimums.wav', 'terrain.wav', 'terrain-pull-up.wav', 'windshear.wav',
  'overspeed.wav', 'stall.wav',
  'alt-2500.wav', 'alt-1000.wav', 'alt-500.wav', 'alt-100.wav',
  'alt-50.wav', 'alt-40.wav', 'alt-30.wav', 'alt-20.wav', 'alt-10.wav'
].map(f => './sounds/' + f);
const ASSETS = [
  './',
  './index.html',
  './app.css?v=4',
  './app.js?v=4',
  './audio.js?v=4',
  './manifest.json',
  './icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  ...SOUNDS
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: false }).then(hit =>
      hit ||
      fetch(e.request).then(res => {
        // Cache same-origin responses (fonts come from Google and are left to HTTP cache).
        if (res.ok && new URL(e.request.url).origin === location.origin) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      })
    )
  );
});
