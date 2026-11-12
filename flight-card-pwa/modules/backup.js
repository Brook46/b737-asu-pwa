// backup.js — everything Flight Card keeps on this iPad, in one file.
//
// The main store (fc.state: legs, history, logbook, crew, PAs, checklist,
// airport notes, the Notes tab) plus every setting kept beside it — the
// alternates, taxi-out times, Social highlights, FTL entries, layout, the
// calendar and feed links. Weather, route and airport-board caches are left
// out: they download again.
//
// The file goes where the pilot sends it from the share sheet (Save to Files
// → iCloud Drive, or Mail). Nothing is uploaded anywhere by the app.

import * as storage from './storage.js?v=278';

const TAG = 'flightcard-backup';
// Caches and this module's own bookkeeping: never in a backup, never
// overwritten by one.
const SKIP = [/^fc\.route\./, /^fc\.wx\./, /^fc\.board\./, /^fc\.backup\./, /^fc\.syncAfterReload$/, /^fc\.logbook\.lastPushed/];
const keep = (k) => k.startsWith('fc.') && !SKIP.some(re => re.test(k));
const LAST = 'fc.backup.last';
const SNOOZE = 'fc.backup.snooze';

function counts(stateRaw) {
  let st = null;
  try { st = JSON.parse(stateRaw || 'null'); } catch {}
  const legs = [];
  if (st) {
    legs.push(...((st.current && st.current.legs) || []));
    for (const h of st.history || []) legs.push(...(h.legs || []));
    legs.push(...(st.imported || []));
  }
  const ids = new Set(legs.map(l => [l.flight, l.dep_date, l.dep_year, l.dep, l.arr].join('|')));
  const years = legs.map(l => `${l.dep_year || ''}.${String(l.dep_date || '').split('.').reverse().join('.')}`).filter(x => /^\d{4}\./.test(x)).sort();
  const last = years.at(-1);
  return {
    legs: ids.size,
    lastFlight: last ? last.split('.').slice(1).reverse().join('.') + '.' + last.slice(0, 4) : '',
    notes: ((st && st.myNotes) || []).length,
    speeches: ((st && st.speeches) || []).length,
    airportNotes: Object.values((st && st.airportNotes) || {}).filter(Boolean).length,
    crew: Object.keys((st && st.crew) || {}).length,
    duties: ((st && st.duties) || []).length,
  };
}

export function snapshot() {
  storage.flush();
  const keys = {};
  for (let i = 0; i < localStorage.length; i++) {
    const k = localStorage.key(i);
    if (keep(k)) keys[k] = localStorage.getItem(k);
  }
  return { app: TAG, v: 1, at: new Date().toISOString(), counts: counts(keys['fc.state']), keys };
}

export function filename(b) {
  const d = new Date(b.at);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `flightcard-backup-${ymd}-${b.counts.legs}legs.json`;
}

// Read a picked file: a full backup, or an older plain "Export & share" file
// (just the main store).
export function parse(text) {
  const o = JSON.parse(text);
  // A file from Export (export.js): just the parts picked, added on import.
  if (o && o.app === 'flightcard-export' && o.parts && typeof o.parts === 'object') return { ...o, exp: true };
  if (o && o.app === TAG && o.keys && typeof o.keys === 'object') return o;
  if (o && typeof o === 'object' && (o.speeches || o.current || o.history)) {
    return { app: TAG, v: 0, at: '', counts: counts(text), keys: { 'fc.state': text }, old: true };
  }
  throw new Error("This isn't a Flight Card backup");
}

// A copy of this iPad as it is, kept before a restore — in IndexedDB, which
// has room for it (localStorage might not). One copy, replaced each time.
function idb() {
  return new Promise((res, rej) => {
    const r = indexedDB.open('fc-backup', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbDo(mode, fn) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', mode), st = tx.objectStore('kv');
    const req = fn(st);
    tx.oncomplete = () => res(req && req.result);
    tx.onerror = () => rej(tx.error);
  });
}
export async function saveSafety() { await idbDo('readwrite', st => st.put(JSON.stringify(snapshot()), 'safety')); }
export async function safety() {
  try { const t = await idbDo('readonly', st => st.get('safety')); return t ? JSON.parse(t) : null; } catch { return null; }
}

// Replace: this iPad becomes exactly the backup (caches aside).
export function restoreReplace(b) {
  for (const k of Object.keys(localStorage)) if (keep(k) && k !== 'fc.state') localStorage.removeItem(k);
  for (const [k, v] of Object.entries(b.keys)) if (keep(k) && k !== 'fc.state' && typeof v === 'string') localStorage.setItem(k, v);
  // Through storage, so its in-memory copy is the backup too (and an older
  // backup is brought up to date) — otherwise its next write, even on the way
  // out of the page, would put this iPad's old data straight back.
  if (b.keys['fc.state']) storage.importJson(b.keys['fc.state']);
}
// Add what's missing: the main store merged (storage.mergeStateFrom), and
// each setting only where this iPad has none; per-airport maps (alternates,
// highlights…) gain the airports they lack.
export function restoreMerge(b) {
  const added = b.keys['fc.state'] ? storage.mergeStateFrom(b.keys['fc.state']) : {};
  for (const [k, v] of Object.entries(b.keys)) {
    if (k === 'fc.state' || !keep(k) || typeof v !== 'string') continue;
    const cur = localStorage.getItem(k);
    if (cur == null) { localStorage.setItem(k, v); continue; }
    let a, o;
    try { a = JSON.parse(cur); o = JSON.parse(v); } catch { continue; }
    if (a && o && typeof a === 'object' && typeof o === 'object' && !Array.isArray(a) && !Array.isArray(o)) {
      localStorage.setItem(k, JSON.stringify({ ...o, ...a }));
    }
  }
  return added;
}

// Reminders: when it was last backed up, and whether to nudge.
export function markDone(b) {
  try { localStorage.setItem(LAST, JSON.stringify({ at: Date.now(), legs: b.counts.legs })); } catch {}
}
export function last() { try { return JSON.parse(localStorage.getItem(LAST) || 'null'); } catch { return null; } }
export function snooze(days = 3) { try { localStorage.setItem(SNOOZE, String(Date.now() + days * 86400000)); } catch {} }
const DAY = 86400000;
// Due: 14 days since the last backup, or 10 new legs — and there's something
// worth keeping. Never more than once in a snooze.
export function due() {
  try { if (Date.now() < Number(localStorage.getItem(SNOOZE) || 0)) return null; } catch {}
  const legs = counts(localStorage.getItem('fc.state')).legs;
  if (!legs) return null;
  const l = last();
  if (!l) return { why: 'never' };
  const days = Math.floor((Date.now() - l.at) / DAY);
  if (days >= 14) return { why: 'days', days };
  if (legs - (l.legs || 0) >= 10) return { why: 'legs', legs: legs - (l.legs || 0) };
  return null;
}
