// wx.js — fetch live METAR + TAF + D-ATIS for an airport.
//
// Sources (all CORS-friendly, no API key):
//   METAR  — https://metar.vatsim.net/<ICAO>                         (plain text, worldwide)
//   TAF    — <CF Worker shim>/taf?icao=<ICAO>                        (plain text, worldwide)
//            The Worker fetches aviationweather.gov server-side and adds
//            CORS headers. Source code at cloudflare-worker/taf-proxy.js.
//            Replace TAF_PROXY below with the deployed *.workers.dev URL.
//   D-ATIS — https://atis.info/api/<ICAO>                            (JSON, US + selected intl)
//
// METAR and TAF are universally available; D-ATIS exists for a subset.
// Each fetch is cached for ~9 min so a 10-minute refresh tick gets a fresh
// pull without thrashing the network on UI re-renders.

import { lookup } from './airports.js?v=188';
import { WORKER_BASE } from './proxy.js?v=188';

// TAF proxy URL — shared with the calendar feature via modules/proxy.js.
// When WORKER_BASE is null the TAF section falls back to the ↗
// aviationweather.gov deep-link; METAR + D-ATIS keep working regardless.

const TTL_MS = 9 * 60 * 1000;
const cache = new Map();   // icao → { metar, taf, datis, ts }

// The last METAR / TAF per airport is also kept on the device
// (fc.wx.<ICAO>), so with no internet — or after the app was closed — the
// card still shows the last one, marked with its age, instead of nothing.
function readStored(icao) {
  try { return JSON.parse(localStorage.getItem('fc.wx.' + icao) || 'null'); } catch { return null; }
}
function store(icao, e) {
  try {
    localStorage.setItem('fc.wx.' + icao, JSON.stringify({ metar: e.metar, taf: e.taf, ts: e.ts, metarTs: e.metarTs }));
  } catch {}
}
// A fresh fetch that came back empty (offline) keeps the stored report.
function withStored(icao, entry) {
  const st = readStored(icao);
  if (!st) return entry;
  const out = { ...entry };
  if (!out.metar && st.metar) { out.metar = st.metar; out.metarTs = st.metarTs || st.ts; out.stale = true; }
  if (!out.taf && st.taf) { out.taf = st.taf; out.stale = true; }
  return out;
}

function toIcao(code) {
  if (!code) return null;
  const ap = lookup(code);
  if (ap?.icao) return ap.icao;
  const c = String(code).toUpperCase().trim();
  if (/^[A-Z]{4}$/.test(c)) return c;
  return null;
}

async function fetchMetar(icao) {
  try {
    const res = await fetch('https://metar.vatsim.net/' + encodeURIComponent(icao), { cache: 'no-store' });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    return text || null;
  } catch { return null; }
}

async function fetchTaf(icao) {
  // Skip if the proxy URL hasn't been configured yet — falls back gracefully
  // to the ↗ aviationweather.gov deep-link in the popup.
  if (!WORKER_BASE) return null;
  try {
    const url = WORKER_BASE.replace(/\/$/, '') + '/taf?icao=' + encodeURIComponent(icao);
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    return text || null;
  } catch { return null; }
}

async function fetchDatis(icao) {
  try {
    const res = await fetch('https://atis.info/api/' + encodeURIComponent(icao), { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    return data;
  } catch { return null; }
}

// Get { icao, metar, taf, datis, ts } for a code (IATA or ICAO). Respects
// cache unless opts.force is true. All three sources fetched in parallel.
//
// opts.metarOnly: the data card's automatic refresh needs just the METAR —
// no point asking atis.info (which 404s for most non-US airports) or the TAF
// proxy every ten minutes. Such an entry is marked partial, so a full fetch
// (the WX popup) still goes out for the rest.
export async function fetchWx(code, opts) {
  const icao = toIcao(code);
  if (!icao) return null;
  const force = !!(opts && opts.force);
  const metarOnly = !!(opts && opts.metarOnly);
  const cached = cache.get(icao);
  if (!force && cached && (Date.now() - cached.ts) < TTL_MS && (metarOnly || !cached.partial)) return cached;
  if (metarOnly) {
    const metar = await fetchMetar(icao);
    let entry = { icao, metar, metarTs: metar ? Date.now() : null, taf: cached?.taf ?? null, datis: cached?.datis ?? null, ts: Date.now(), partial: true };
    if (metar) store(icao, { ...entry, taf: entry.taf ?? readStored(icao)?.taf ?? null });
    entry = withStored(icao, entry);
    cache.set(icao, entry);
    return entry;
  }
  const [metar, taf, datis] = await Promise.all([
    fetchMetar(icao),
    fetchTaf(icao),
    fetchDatis(icao),
  ]);
  let entry = { icao, metar, metarTs: metar ? Date.now() : null, taf, datis, ts: Date.now() };
  if (metar || taf) store(icao, entry);
  entry = withStored(icao, entry);
  cache.set(icao, entry);
  return entry;
}

export function clearCache() { cache.clear(); }

// Read the in-memory cached wx for a code without triggering a fetch. Used
// by the data card's METAR cell so the dep airport's METAR can be displayed
// inline once the WX popup has populated the cache. Returns null when no
// fetch has happened yet for this code.
export function peekCachedWx(code) {
  const icao = toIcao(code);
  if (!icao) return null;
  if (cache.has(icao)) return cache.get(icao);
  // Nothing fetched this session: the last one kept on the device.
  const st = readStored(icao);
  return st ? { icao, metar: st.metar, metarTs: st.metarTs || st.ts, taf: st.taf, ts: st.ts, stale: true } : null;
}

// Minutes since a METAR was observed, from its own ddhhmmZ group; null when
// it can't be read.
export function metarAgeMin(metar, now = Date.now()) {
  const m = /\b(\d{2})(\d{2})(\d{2})Z\b/.exec(String(metar || ''));
  if (!m) return null;
  const d = new Date(now);
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), +m[1], +m[2], +m[3]);
  if (t - now > 2 * 86400000) t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, +m[1], +m[2], +m[3]);
  return Math.round((now - t) / 60000);
}

// Pick the most useful D-ATIS letter from the response.
// Prefer 'dep' → 'combined' → first.
export function extractLetter(datis) {
  if (!Array.isArray(datis) || !datis.length) return null;
  const dep = datis.find(d => d.type === 'dep')
           || datis.find(d => d.type === 'combined')
           || datis[0];
  return dep?.code ? String(dep.code).toUpperCase().slice(0, 1) : null;
}

// Pick the most useful D-ATIS body text (same precedence).
export function extractText(datis) {
  if (!Array.isArray(datis) || !datis.length) return '';
  const dep = datis.find(d => d.type === 'dep')
           || datis.find(d => d.type === 'combined')
           || datis[0];
  return dep?.datis || '';
}
