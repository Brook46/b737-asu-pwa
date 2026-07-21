// store.js — a tiny IndexedDB key/value store so the app keeps working at a
// launch site with no cell service.
//
// The service worker caches the app *shell*; this caches the *data*: point
// forecasts, soundings, the map grid and imported airspace. Everything is
// stored with a timestamp so the UI can say how stale it is.
//
// No dependency, ~2 KB, and every call degrades to a no-op if IndexedDB is
// unavailable (private mode, ancient WebView) rather than throwing.

const DB_NAME = 'skymonkeys';
const DB_VERSION = 1;
const STORE = 'kv';

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return open().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      let t;
      try { t = db.transaction(STORE, mode); } catch { return resolve(null); }
      const store = t.objectStore(STORE);
      let out = null;
      try { out = fn(store); } catch { /* ignore */ }
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = t.onabort = () => resolve(null);
    });
  });
}

/** Store a value with a timestamp. Returns true on success. */
export async function put(key, value) {
  const r = await tx('readwrite', (s) => s.put({ value, at: Date.now() }, key));
  return r !== null;
}

/** Read {value, at} or null. */
export async function get(key) {
  const rec = await tx('readonly', (s) => s.get(key));
  return rec && rec.value !== undefined ? rec : null;
}

export async function del(key) { await tx('readwrite', (s) => s.delete(key)); }

export async function keys() {
  const r = await tx('readonly', (s) => s.getAllKeys());
  return Array.isArray(r) ? r : [];
}

// ── key helpers ─────────────────────────────────────────────────────────────
const r2 = (n) => Number(n).toFixed(2);
export const forecastKey = (lat, lon, model) => `fc:${model}:${r2(lat)},${r2(lon)}`;
export const gridKey = (bounds, model) =>
  `grid:${model}:${r2(bounds.getSouth())},${r2(bounds.getWest())},${r2(bounds.getNorth())},${r2(bounds.getEast())}`;
export const AIRSPACE_KEY = 'airspace:local';

/** "08:30" for a stored timestamp. */
export function timeLabel(at) {
  if (!at) return '';
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
