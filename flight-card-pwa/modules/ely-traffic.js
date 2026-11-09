// ely-traffic.js — El Al aircraft in the air around this flight's route,
// for the Route info map's LY button. Positions come from the same keyless
// ADS-B network as Airline Radar, through the worker's /adsb/point (adsb.lol
// and friends, cached at the worker): a few 250 nm circles along the route,
// at most once a minute — these are volunteer feeds, so asking little is
// what keeps them answering. Routes (from → to) are adsbdb.com's, keyed on
// the callsign; a callsign gets reused, so a route the aircraft's position
// doesn't fit is marked unsure rather than stated.

import { WORKER_BASE } from './proxy.js?v=266';

const R = Math.PI / 180;
const RADIUS_NM = 250, MAX_CIRCLES = 8;
export const REFRESH_MS = 60 * 1000;

function distNm(a, b) {
  const x = Math.sin((b.lat - a.lat) * R / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin((b.lon - a.lon) * R / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(x))) * 3440.065;
}

// Circle centres every ~400 nm along the route (pts: [{lat, lon, s}]).
function centres(pts) {
  const total = pts.at(-1).s || 0;
  const n = Math.min(MAX_CIRCLES, Math.max(1, Math.ceil(total / 400) + 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    const s = n === 1 ? total / 2 : total * i / (n - 1);
    out.push(pts.reduce((b, p) => Math.abs(p.s - s) < Math.abs(b.s - s) ? p : b, pts[0]));
  }
  return out;
}

function entry(a, ageMs) {
  const cs = String(a.flight || '').trim().toUpperCase();
  const ground = a.alt_baro === 'ground' || !(Number(a.alt_baro) > 1000) || !(Number(a.gs) > 80);
  return {
    hex: a.hex, cs, flight: /^ELY\d/.test(cs) ? 'LY' + cs.slice(3) : cs, reg: a.r || '', type: a.t || '',
    lat: a.lat, lon: a.lon, fl: ground ? 0 : Math.round(Number(a.alt_baro) / 100), gs: Math.round(Number(a.gs) || 0),
    trk: Number(a.track) || 0, ageMs: ageMs || 0, ground,
  };
}
// The pilot's own aircraft, by registration and by this flight's callsign,
// anywhere — in the air or on the ground. Each sighting is kept on the
// device (fc.tail.last.<reg>), so when it isn't transmitting the map can
// still say where it was last seen.
export async function fetchOwn(reg, cs) {
  if (!WORKER_BASE) return null;
  const base = WORKER_BASE.replace(/\/$/, '');
  for (const [kind, v] of [['reg', reg], ['callsign', cs]]) {
    if (!v) continue;
    try {
      const r = await fetch(`${base}/adsb/${kind}/${encodeURIComponent(v)}`, { cache: 'no-store' });
      if (!r.ok) continue;
      const d = await r.json();
      const a = (d.ac || []).find(x => Number.isFinite(x.lat));
      if (!a) continue;
      const e = { ...entry(a, d.ageMs), own: true };
      try { localStorage.setItem('fc.tail.last.' + (e.reg || reg), JSON.stringify({ ...e, seen: Date.now() - (d.ageMs || 0) })); } catch {}
      return e;
    } catch {}
  }
  return null;
}
export function lastSeen(reg) {
  try { const v = JSON.parse(localStorage.getItem('fc.tail.last.' + reg) || 'null'); return v && v.seen > Date.now() - 7 * 86400000 ? v : null; } catch { return null; }
}
// Still to fly (nm) and the ETA (ms) at its ground speed — straight to the
// destination, so a rough figure.
export function etaOf(ac, rt) {
  if (!rt || !rt.to || !(ac.gs > 80) || ac.ground) return null;
  const left = distNm(ac, rt.to);
  return { left: Math.round(left), at: Date.now() + left / ac.gs * 3600e3 };
}
export { distNm };

// El Al flights airborne within reach of the route:
// [{ hex, flight: 'LY846', cs: 'ELY846', reg, type, lat, lon, fl, gs, trk }]
export async function fetchEly(pts) {
  if (!WORKER_BASE || !pts || pts.length < 2) return [];
  const base = WORKER_BASE.replace(/\/$/, '');
  const seen = new Map();
  for (const c of centres(pts)) {
    try {
      const r = await fetch(`${base}/adsb/point/${c.lat.toFixed(2)}/${c.lon.toFixed(2)}/${RADIUS_NM}`, { cache: 'no-store' });
      if (!r.ok) continue;
      const d = await r.json();
      for (const a of d.ac || []) {
        const cs = String(a.flight || '').trim().toUpperCase();
        if (!/^ELY\d/.test(cs)) continue;
        // In the air only: not on the ground, and moving.
        if (a.alt_baro === 'ground' || !(Number(a.alt_baro) > 1000) || !(Number(a.gs) > 80)) continue;
        if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
        seen.set(a.hex, entry(a, d.ageMs));
      }
    } catch {}
  }
  return [...seen.values()];
}

// adsbdb's route for a callsign, kept for the session.
const routes = new Map();
export async function routeOf(cs) {
  if (routes.has(cs)) return routes.get(cs);
  let out = null;
  try {
    const r = await fetch('https://api.adsbdb.com/v0/callsign/' + encodeURIComponent(cs));
    if (r.ok) {
      const fr = (await r.json())?.response?.flightroute;
      const ap = (x) => x && { icao: x.icao_code, iata: x.iata_code, name: x.municipality || x.name, lat: x.latitude, lon: x.longitude };
      if (fr && fr.origin && fr.destination) out = { from: ap(fr.origin), to: ap(fr.destination) };
    }
  } catch {}
  routes.set(cs, out);
  return out;
}
// Does the aircraft sit plausibly between its claimed ends?
export function routeFits(rt, ac) {
  if (!rt) return false;
  const d = distNm(rt.from, rt.to);
  return distNm(rt.from, ac) + distNm(ac, rt.to) <= d * 1.35 + 120;
}

// Type designator → name a pilot says.
const TYPES = { B734: '737-400', B737: '737-700', B738: '737-800', B739: '737-900', B38M: '737 MAX 8', B39M: '737 MAX 9',
  B772: '777-200', B77W: '777-300ER', B788: '787-8', B789: '787-9', B78X: '787-10', A21N: 'A321neo', A20N: 'A320neo', E195: 'E195' };
export function typeName(t) { return TYPES[t] || t || ''; }
