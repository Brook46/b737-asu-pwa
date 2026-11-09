// wx.js — fetch live METAR + TAF + D-ATIS for an airport.
//
// Sources (all CORS-friendly, no API key):
//   METAR  — https://metar.vatsim.net/<ICAO>                         (plain text, worldwide)
//   TAF    — <CF Worker shim>/taf?icao=<ICAO>                        (plain text, worldwide)
//            The Worker fetches aviationweather.gov server-side and adds
//            CORS headers. Source code at cloudflare-worker/taf-proxy.js.
//            Replace TAF_PROXY below with the deployed *.workers.dev URL.
//   D-ATIS — https://atis.info/api/<ICAO>                            (JSON, US + selected intl)
//            else the latest D-ATIS uplinked to any aircraft over ACARS,
//            as picked up by Airframes.io's volunteer receivers
//            (api.airframes.io, keyless, CORS-open; 60 calls a minute) —
//            most big European / Middle East airports, LLBG included.
//
// METAR and TAF are universally available; D-ATIS exists for a subset.
// Each fetch is cached for ~9 min so a 10-minute refresh tick gets a fresh
// pull without thrashing the network on UI re-renders.

import { lookup } from './airports.js?v=266';
import { WORKER_BASE } from './proxy.js?v=266';

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
  return iataToIcao?.get(c) || null;
}
// airports.js is a short list: a three-letter code outside it (OPO) is found
// in the diversion database instead, which only loads on demand. Anything
// that reads the weather synchronously (peekCachedWx) awaits this first.
let iataToIcao = null, codesLoad = null;
export function codesReady() {
  codesLoad ||= import('./route-info.js?v=266').then(ri => ri.loadDb())
    .then(db => { iataToIcao = db.byIata; })
    .catch(() => { codesLoad = null; });
  return codesLoad;
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
  const [faa, acars] = await Promise.all([fetchAtisInfo(icao), fetchAcarsAtis(icao)]);
  return faa || acars;
}
async function fetchAtisInfo(icao) {
  try {
    const res = await fetch('https://atis.info/api/' + encodeURIComponent(icao), { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return null;
    return data;
  } catch { return null; }
}

// ---- D-ATIS heard over ACARS (Airframes.io) ----
// An aircraft asks for the ATIS by datalink; the ground station uplinks it
// as label A9, '/TLVATYA.TI2/LLBG ARR ATIS D' then the text. One ATIS goes
// out in several blocks and is heard several times; the longest copy of the
// newest one per kind (ARR / DEP / both) is kept. It's only as fresh as the
// last aircraft that asked, so each carries its time (at) and the letter is
// given only while it's under ACARS_LETTER_MIN old — older text still shows,
// with its age, but doesn't set the ATIS letter.
const ACARS_LETTER_MIN = 180;      // its age shows in colour (orange 1 h, red 2 h); past 3 h no letter
const ACARS_MAX_H = 12;
async function fetchAcarsAtis(icao) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(`https://api.airframes.io/messages?limit=30&text=${encodeURIComponent('TI2/' + icao)}`,
      { cache: 'no-store', signal: ctl.signal });
    if (!res.ok) return null;
    const msgs = await res.json();
    return Array.isArray(msgs) ? parseAcarsAtis(msgs, icao) : null;
  } catch { return null; }
  finally { clearTimeout(t); }
}
export function parseAcarsAtis(msgs, icao, now = Date.now()) {
  const best = new Map();                         // type → entry
  for (const m of msgs) {
    const raw = String(m?.text || '').replace(/\r\n?/g, '\n').replace(/\n\t/g, '\n');
    const nl = raw.indexOf('\n');
    const head = nl < 0 ? raw : raw.slice(0, nl);
    const hm = new RegExp(`TI2/${icao}\\b(.*)$`).exec(head);
    if (!hm || !/\bATIS\b/.test(hm[1])) continue;
    const at = Date.parse(m.timestamp || m.createdAt || '');
    if (!(at > now - ACARS_MAX_H * 3600e3)) continue;
    const words = hm[1].trim().split(/\s+/);
    const type = words.includes('ARR') ? 'arr' : words.includes('DEP') ? 'dep' : 'combined';
    // The letter: a lone A–Z after ATIS (ARR ATIS D, ATIS ARR V).
    const letter = words.slice(words.indexOf('ATIS') + 1).find(w => /^[A-Z]$/.test(w)) || '';
    const body = (nl < 0 ? '' : raw.slice(nl + 1))
      .replace(/\n[0-9A-F]{4}\s*$/, '')              // the block's CRC, on its own line
      .replace(/([^\s])[0-9A-F]{4}\s*$/, '$1')     // … or glued to the last word
      .split('\n').map(l => l.trim()).join('\n').trim();
    if (!body) continue;
    const cur = best.get(type);
    const same = cur && cur.letter === letter && Math.abs(cur.at - at) < 10 * 60e3;
    if (!cur || (same ? body.length > cur.datis.length : at > cur.at + 10 * 60e3)) {
      best.set(type, { type, letter, datis: body, at: same ? Math.max(cur.at, at) : at, src: 'acars', airport: icao });
    }
  }
  const out = [...best.values()].map(e => ({ ...e, code: (now - e.at) / 60e3 <= ACARS_LETTER_MIN ? e.letter : '' }));
  return out.length ? out : null;
}

// Get { icao, metar, taf, datis, ts } for a code (IATA or ICAO). Respects
// cache unless opts.force is true. All three sources fetched in parallel.
//
// opts.metarOnly: the data card's automatic refresh needs just the METAR —
// no point asking atis.info (which 404s for most non-US airports) or the TAF
// proxy every ten minutes. Such an entry is marked partial, so a full fetch
// (the WX popup) still goes out for the rest.
// opts.noAtis: METAR and TAF only, for the Brief tab; also marked partial.
export async function fetchWx(code, opts) {
  if (!toIcao(code)) await codesReady();
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
  const noAtis = !!(opts && opts.noAtis);
  const [metar, taf, datis] = await Promise.all([
    fetchMetar(icao),
    fetchTaf(icao),
    noAtis ? (cached?.datis ?? null) : fetchDatis(icao),
  ]);
  let entry = { icao, metar, metarTs: metar ? Date.now() : null, taf, datis, ts: Date.now() };
  if (noAtis) entry.partial = true;
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
// prefer: 'arr' when looking at the destination.
// An ACARS copy of the wanted kind that's gone stale (no letter any more)
// gives way to a fresher one of the other kind.
export function pickAtis(datis, prefer = 'dep') {
  if (!Array.isArray(datis) || !datis.length) return null;
  if (datis[0].src === 'acars') {
    const want = datis.find(d => d.type === prefer && d.code);
    return want || [...datis].sort((a, b) => b.at - a.at)[0];
  }
  return datis.find(d => d.type === prefer)
      || datis.find(d => d.type === 'combined')
      || datis[0];
}
export function extractLetter(datis, prefer = 'dep') {
  const d = pickAtis(datis, prefer);
  return d?.code ? String(d.code).toUpperCase().slice(0, 1) : null;
}

// Pick the most useful D-ATIS body text (same precedence).
export function extractText(datis, prefer) {
  return pickAtis(datis, prefer)?.datis || '';
}
