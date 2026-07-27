// store.js — IndexedDB persistence, so a debrief survives a reload.
//
// Two object stores:
//   flights  the raw IGC text plus display meta. Raw text is the source of
//            truth — re-parsing 20 000 fixes takes ~30 ms, and storing derived
//            arrays instead would freeze the format of every future change.
//   kv       terrain profiles and UI preferences, keyed by string.
//
// Every call degrades to a no-op rather than throwing: iOS private browsing and
// old WebViews can refuse IndexedDB outright, and a pilot who can't save should
// still be able to look at their flight.

const DB_NAME = 'thermal-debrief';
const DB_VERSION = 1;
const FLIGHTS = 'flights';
const KV = 'kv';

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch { return resolve(null); }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(FLIGHTS)) db.createObjectStore(FLIGHTS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(KV)) db.createObjectStore(KV);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then((db) => {
    if (!db) return null;
    return new Promise((resolve) => {
      let t;
      try { t = db.transaction(store, mode); } catch { return resolve(null); }
      let out = null;
      try { out = fn(t.objectStore(store)); } catch { /* ignore */ }
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = t.onabort = () => resolve(null);
    });
  });
}

// ── flights ─────────────────────────────────────────────────────────────────

/**
 * @param {{id:string, igc:string, pilotName:string, color:string, fileName:string, date:string}} rec
 */
export async function saveFlight(rec) {
  return (await tx(FLIGHTS, 'readwrite', (s) => s.put({ ...rec, savedAt: Date.now() }))) !== null;
}

export async function listFlights() {
  const r = await tx(FLIGHTS, 'readonly', (s) => s.getAll());
  const rows = Array.isArray(r) ? r : [];
  return rows.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}

export async function deleteFlight(id) {
  await tx(FLIGHTS, 'readwrite', (s) => s.delete(id));
  await delKv(terrainKey(id));
}

/** Patch display meta (pilot name, colour) without rewriting the IGC blob. */
export async function updateFlight(id, patch) {
  const rec = await tx(FLIGHTS, 'readonly', (s) => s.get(id));
  if (!rec) return false;
  return saveFlight({ ...rec, ...patch, id });
}

// ── key/value ───────────────────────────────────────────────────────────────

export async function putKv(key, value) {
  return (await tx(KV, 'readwrite', (s) => s.put({ value, at: Date.now() }, key))) !== null;
}

export async function getKv(key) {
  const rec = await tx(KV, 'readonly', (s) => s.get(key));
  return rec && rec.value !== undefined ? rec.value : null;
}

export async function delKv(key) { await tx(KV, 'readwrite', (s) => s.delete(key)); }

export const terrainKey = (trackId) => `terrain:${trackId}`;

// ── small preferences ───────────────────────────────────────────────────────
// localStorage rather than IndexedDB: these are read during boot, before the
// first paint, and a synchronous read keeps the UI from flashing defaults.

const PREF = 'debrief.';

export function pref(key, fallback) {
  try {
    const v = localStorage.getItem(PREF + key);
    return v === null ? fallback : v;
  } catch { return fallback; }
}

export function setPref(key, value) {
  try { localStorage.setItem(PREF + key, String(value)); } catch { /* full or blocked */ }
}
