// Minimal cache-first service worker for the Roster Swap app.
// Scope is this folder only — the Duty Calendar app has its own worker.
const VER = 'swap-v1';
const CORE = [
  './',
  'index.html',
  'swap.css',
  'swap.js',
  'roster.js',
  'manifest.json',
  'icon.svg',
  'icons/apple-touch-icon.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(CORE)).catch(() => {}));
  self.skipWaiting();
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VER).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  // Never cache the swap backend — matches must always be fresh.
  if (/script\.google\.com/.test(req.url)) return;
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    const copy = res.clone();
    caches.open(VER).then(c => c.put(req, copy)).catch(() => {});
    return res;
  }).catch(() => hit)));
});
