// wx.js — fetch live METAR + TAF + D-ATIS for an airport.
//
// Sources (all CORS-friendly, no API key):
//   METAR  — https://metar.vatsim.net/<ICAO>                              (plain text, worldwide)
//   TAF    — https://aviationweather.gov/api/data/taf?ids=<ICAO>&format=raw (plain text, worldwide)
//   D-ATIS — https://atis.info/api/<ICAO>                                  (JSON, US + selected intl)
//
// METAR + TAF are universally available; D-ATIS exists for a subset.
// Each fetch is cached for ~9 min so a 10-minute refresh tick gets a fresh
// pull without thrashing the network on UI re-renders.

import { lookup } from './airports.js';

const TTL_MS = 9 * 60 * 1000;
const cache = new Map();   // icao → { metar, taf, datis, ts }

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
  // aviationweather.gov returns clean raw TAF text but doesn't ship
  // CORS headers, so a direct browser fetch is blocked. Route through
  // api.allorigins.win's /raw passthrough — it adds permissive CORS
  // headers and re-emits the body verbatim. Trade-off documented:
  // depends on a free third-party proxy staying up; if it doesn't,
  // fetchTaf returns null and the popup shows "TAF unavailable" plus
  // the deep-link to aviationweather.gov so the user can still get it.
  const upstream = 'https://aviationweather.gov/api/data/taf?ids=' + encodeURIComponent(icao) + '&format=raw';
  const proxied  = 'https://api.allorigins.win/raw?url=' + encodeURIComponent(upstream);
  try {
    const res = await fetch(proxied, { cache: 'no-store' });
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
export async function fetchWx(code, opts) {
  const icao = toIcao(code);
  if (!icao) return null;
  const force = !!(opts && opts.force);
  const cached = cache.get(icao);
  if (!force && cached && (Date.now() - cached.ts) < TTL_MS) return cached;
  const [metar, taf, datis] = await Promise.all([
    fetchMetar(icao),
    fetchTaf(icao),
    fetchDatis(icao),
  ]);
  const entry = { icao, metar, taf, datis, ts: Date.now() };
  cache.set(icao, entry);
  return entry;
}

export function clearCache() { cache.clear(); }

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
