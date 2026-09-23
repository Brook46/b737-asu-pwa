// library.js — the wing library: built-in manufacturer data (data/wings/*.json)
// plus wings the pilot added from their own sheet (localStorage).

import { customGliders } from './store.js?v=10';

const SIZE_ORDER = ['XXS', 'XS', 'S', 'SM', 'MS', 'M', 'ML', 'L', 'XL', 'XXL'];
export const sizeRank = k => (/^\d+(\.\d+)?$/.test(k) ? 100 + Number(k) : SIZE_ORDER.indexOf(k));
export const CLASSES = ['EN A', 'EN B', 'EN C', 'EN D', 'CCC', 'Tandem'];

let indexPromise = null;
const wingCache = new Map();

async function fetchJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r.json();
}

function summaryOf(w) {
  return {
    id: w.id, brand: w.brand, model: w.model, wingClass: w.wingClass || '—',
    year: w.year ?? null, liners: w.liners ?? null, category: w.category ?? null,
    custom: !!w.custom,
    sizes: Object.entries(w.sizes || {})
      .sort((a, b) => sizeRank(a[0]) - sizeRank(b[0]))
      .map(([k, s]) => ({ key: k, ready: !!(s.lines && Object.keys(s.lines).length),
                          lines: s.lines ? Object.keys(s.lines).length : 0 })),
  };
}

/** Every wing the picker can show: built-in first (by class), then the pilot's own. */
export async function listWings() {
  indexPromise ||= fetchJson('./data/wings/index.json').catch(e => {
    indexPromise = null;
    throw e;
  });
  const idx = await indexPromise;
  return [...idx.wings, ...customGliders.all().map(summaryOf)];
}

/** Full wing record, normalised for sessions and analysis. */
export async function loadWing(id) {
  const own = customGliders.get(id);
  if (own) return normalise(own);
  if (!wingCache.has(id)) {
    wingCache.set(id, fetchJson(`./data/wings/${encodeURIComponent(id)}.json`).then(normalise)
      .catch(e => { wingCache.delete(id); throw e; }));
  }
  return wingCache.get(id);
}

function normalise(w) {
  const method = {
    tensionKg: w.method?.tensionKg ?? w.tensionKg ?? 5,
    tolIndMm: w.method?.tolIndMm ?? w.tolIndMm ?? 10,
    tolGlobalMm: w.method?.tolGlobalMm ?? w.tolGlobalMm ?? 50,
    reference: w.method?.reference ?? 'lines + risers',
  };
  return { ...w, method, tensionKg: method.tensionKg, tolIndMm: method.tolIndMm, tolGlobalMm: method.tolGlobalMm };
}

export function sizeOf(wing, key) { return wing?.sizes?.[key] || null; }

export function isReady(wing, key) {
  const s = sizeOf(wing, key);
  return !!(s && s.lines && Object.keys(s.lines).length && !s.needsLengths);
}

/** Line ids a size expects even when its lengths are still missing. */
export function expectedLineIds(wing, key) {
  const s = sizeOf(wing, key);
  if (!s) return [];
  if (s.lines && Object.keys(s.lines).length) return Object.keys(s.lines);
  return (s.mains || []).flatMap(m => m.lines);
}

