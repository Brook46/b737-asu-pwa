// route-info.js — diversion airports along the route, rated 0–10.
//
// The route: the great circle from departure to destination (no free source
// has the filed route — see the FlightAware note in the v157 commit). Every
// airport within an hour's flying of it (420 nm at a diversion speed of
// ~420 kt) is a candidate, rated for a 737 on what free data can say:
//
//   runway   0.4–2    longest open hard runway (5,500 ft is the floor for a 737)
//   lighting 0–0.5    that runway lighted
//   size     0.5–1.5  large airport (a big city: hotels, handling, maintenance,
//                     onward connections) over medium
//   distance 0–3      closer to the route is better — 15 nm off beats 250
//   weather  0–3   TAF (or METAR) for the time you'd be passing it: ceiling
//                  and visibility against rough CAT I numbers, then
//                  penalties for thunderstorms / freezing / snow / hail and
//                  for crosswind on the best-aligned runway
//   − elevation over 5,000 ft, − country penalty (Turkey −2 by default)
//   0 outright: an excluded country, no usable runway, aerodrome closed by
//   NOTAM; weather below CAT I costs its 3 weather points and nothing more —
//   approach categories aren't in the data, and an airport isn't marked down
//   for what can't be known (the card says to check the chart).
//
// Data: data/divdb.json (OurAirports, public domain; scripts/build-divdb.py),
// weather via the worker's /routewx (aviationweather.gov), NOTAMs via its
// /notams (autorouter / FAA, off until the pilot's login is set). OurAirports
// carries no ILS, so approach categories are never guessed.

import { WORKER_BASE } from './proxy.js?v=280';
import { inForce } from './notam-brief.js?v=280';

export const RADIUS_NM = 420;            // one hour at a diversion speed of ~420 kt
const NM_PER_RAD = 3440.065;
const R = Math.PI / 180;
const H = 3600000;

// ---------- Countries ----------
// Places an Israeli aircraft can't (or really shouldn't) divert to: rated 0
// and shown grey. Plus per-country penalties. Editable in Settings; stored on
// this device as fc.div.countries.
// Entries are country codes (TR) or airport ICAO codes (LCLK) — an airport
// rule applies to that airport alone and wins over its country's.
// North Africa −2 (Egypt, Tunisia, Sudan; Libya and Algeria are excluded),
// never Morocco.
export const DEFAULT_COUNTRIES = {
  exclude: ['LB', 'SY', 'IQ', 'IR', 'LY', 'YE', 'DZ', 'KW', 'PK', 'AF'],
  penalty: { TR: -2, EG: -2, TN: -2, SD: -2 },
};
export function getCountryRules() {
  try {
    const v = JSON.parse(localStorage.getItem('fc.div.countries') || 'null');
    if (v && Array.isArray(v.exclude) && v.penalty && typeof v.penalty === 'object') {
      // Once: the North Africa penalty joins rules saved before it existed.
      if (!v.na) {
        for (const c of ['EG', 'TN', 'SD']) if (!(c in v.penalty) && !v.exclude.includes(c)) v.penalty[c] = -2;
        v.na = 1;
        setCountryRules(v);
      }
      return v;
    }
  } catch {}
  return DEFAULT_COUNTRIES;
}
export function setCountryRules(rules) {
  try { localStorage.setItem('fc.div.countries', JSON.stringify({ ...rules, na: 1 })); } catch {}
  // Route info re-rates at once (route-ui listens).
  try { window.dispatchEvent(new CustomEvent('fc:div-rules')); } catch {}
}

// ---------- Data ----------
let dbPromise = null;
export function loadDb() {
  if (!dbPromise) {
    dbPromise = fetch('./data/divdb.json').then(r => {
      if (!r.ok) throw new Error('diversion database HTTP ' + r.status);
      return r.json();
    }).then(db => {
      const byIata = new Map();
      for (const [icao, a] of Object.entries(db.a)) if (a[7]) byIata.set(a[7], icao);
      db.byIata = byIata;
      return db;
    }).catch(err => { dbPromise = null; throw err; });
  }
  return dbPromise;
}
function airport(db, icao) {
  const a = db.a[icao];
  if (!a) return null;
  const [lat, lon, elev, name, city, cc, size, iata, rwy, nav] = a;
  return { icao, lat, lon, elev, name, city, cc, country: db.countries[cc] || cc, size, iata, rwy, nav };
}
export function findAirport(db, code) {
  const c = String(code || '').toUpperCase().trim();
  if (!c) return null;
  if (db.a[c]) return airport(db, c);
  const icao = db.byIata.get(c);
  return icao ? airport(db, icao) : null;
}

// ---------- Geometry ----------
function hav(lat1, lon1, lat2, lon2) {
  const a = Math.sin((lat2 - lat1) * R / 2) ** 2
    + Math.cos(lat1 * R) * Math.cos(lat2 * R) * Math.sin((lon2 - lon1) * R / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a))) * NM_PER_RAD;
}
// Great circle A→B as points with cumulative distance (nm). Longitudes are
// unwrapped so a date-line crossing stays one line.
export function routePoints(A, B, n = 96) {
  const f1 = A.lat * R, l1 = A.lon * R, f2 = B.lat * R, l2 = B.lon * R;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((f2 - f1) / 2) ** 2
    + Math.cos(f1) * Math.cos(f2) * Math.sin((l2 - l1) / 2) ** 2));
  const pts = [];
  let prev = null;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let lat, lon;
    if (d < 1e-9) { lat = A.lat; lon = A.lon; }
    else {
      const a = Math.sin((1 - t) * d) / Math.sin(d), b = Math.sin(t * d) / Math.sin(d);
      const x = a * Math.cos(f1) * Math.cos(l1) + b * Math.cos(f2) * Math.cos(l2);
      const y = a * Math.cos(f1) * Math.sin(l1) + b * Math.cos(f2) * Math.sin(l2);
      const z = a * Math.sin(f1) + b * Math.sin(f2);
      lat = Math.atan2(z, Math.hypot(x, y)) / R;
      lon = Math.atan2(y, x) / R;
    }
    if (prev != null) { while (lon - prev > 180) lon -= 360; while (lon - prev < -180) lon += 360; }
    prev = lon;
    pts.push({ lat, lon, s: t * d * NM_PER_RAD });
  }
  return { pts, total: d * NM_PER_RAD };
}
// The filed route (plan-route.js points) in the same shape: each leg
// between fixes as a great circle, a point every ~20 nm, s running on.
export function routeAlong(wps) {
  const pts = [];
  let s = 0;
  for (let i = 0; i + 1 < wps.length; i++) {
    const a = wps[i], b = wps[i + 1];
    const d = hav(a.lat, a.lon, b.lat, b.lon);
    const seg = routePoints(a, b, Math.max(1, Math.ceil(d / 20)));
    seg.pts.forEach((p, k) => { if (k || !i) pts.push({ lat: p.lat, lon: p.lon, s: s + p.s }); });
    s += seg.total;
  }
  // One frame of longitude all the way (no jump at ±180).
  for (let i = 1; i < pts.length; i++) {
    while (pts[i].lon - pts[i - 1].lon > 180) pts[i].lon -= 360;
    while (pts[i].lon - pts[i - 1].lon < -180) pts[i].lon += 360;
  }
  return { pts, total: s, filed: true, wps };
}

// ---------- Timing ----------
// When you'd be abeam each airport. Take-off: the GPS / CSV wheels-up if
// flown, else the CTOT, else STD + taxi-out. Airborne time comes from the
// leg's block (block − taxi-out − ~8 min taxi-in), else distance at 430 kt
// plus 15 min. Rough by design — the TAF blocks it picks are hours wide.
export function timing(leg, totalNm, { taxiOut = 15, ctotMs = NaN, stdMs = NaN } = {}) {
  const d = (leg && leg.dataCard) || {};
  const tko = Number(d.takeoff_at) || NaN;
  let takeoff = Number.isFinite(tko) && tko > 0 ? tko
    : Number.isFinite(ctotMs) ? ctotMs
    : Number.isFinite(stdMs) ? stdMs + taxiOut * 60000 : Date.now();
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(d.block_time || d.flight_time || leg?.flight_time || '').trim());
  let airborneMin = m ? (+m[1]) * 60 + (+m[2]) - taxiOut - 8 : NaN;
  if (!(airborneMin > 20)) airborneMin = totalNm / 430 * 60 + 15;
  return { takeoff, airborneMin, etaAt: (s) => takeoff + (totalNm > 0 ? s / totalNm : 0) * airborneMin * 60000 };
}

// ---------- Weather at a time ----------
const SM_TO_M = 1609.34;
function visM(v) {
  if (v == null || v === '') return NaN;
  const s = String(v);
  if (/\+/.test(s)) return 10000;                     // "6+" SM: unlimited
  const n = parseFloat(s);
  return Number.isFinite(n) ? n * SM_TO_M : NaN;
}
function ceilingFt(clouds, vv) {
  let c = Infinity;
  for (const cl of clouds || []) {
    if (/BKN|OVC|OVX/.test(cl.cover || '') && Number.isFinite(cl.base)) c = Math.min(c, cl.base);
  }
  if (Number.isFinite(vv) && vv > 0) c = Math.min(c, vv);
  return c;
}
// Which weather fits the moment you're looking (mode):
//   'browse' — the flight isn't today (last month, next week): its forecast
//              doesn't exist or doesn't matter, so the latest METAR — what
//              the airport has now — is the useful thing.
//   'plan'   — before departure and en route: the TAF for the time you'd be
//              passing, worst case of every block covering it (a diversion
//              is planned on what might happen) — unless you'd be there
//              within the hour and a current METAR (≤ 90 min) exists, which
//              then wins: what's happening beats what was forecast.
//   'near'   — close to the airport (GPS, within ~an hour): the METAR.
// The same choice drives the weather rating and the runway / wind.
function metarCurrent(entry, now) {
  const m = entry && entry.metar;
  return !!(m && Number.isFinite(m.time) && now - m.time * 1000 <= 90 * 60000);
}
// Sky cover the way a station plot shows it: clr · few · sct · bkn · ovc,
// or vv (sky obscured, vertical visibility). The worst layer reported.
const COVER = ['clr', 'few', 'sct', 'bkn', 'ovc', 'vv'];
function coverRank(clouds, vv) {
  if (Number.isFinite(vv) && vv > 0) return 5;
  let r = 0;
  for (const cl of clouds || []) {
    const c = String(cl.cover || '').toUpperCase();
    r = Math.max(r, c === 'OVX' ? 5 : c === 'OVC' ? 4 : c === 'BKN' ? 3 : c === 'SCT' ? 2 : c === 'FEW' ? 1 : 0);
  }
  return r;
}
function fold(list, src) {
  let ceil = Infinity, vis = Infinity, wspd = 0, wgst = 0, wdir = null, wx = [], cov = 0;
  for (const b of list) {
    cov = Math.max(cov, coverRank(b.clouds, b.vv));
    ceil = Math.min(ceil, ceilingFt(b.clouds, b.vv));
    const v = visM(b.visib); if (Number.isFinite(v)) vis = Math.min(vis, v);
    const sp = Number(b.wspd) || 0, gs = Number(b.wgst) || 0;
    if (Math.max(sp, gs) >= Math.max(wspd, wgst)) { wspd = sp; wgst = gs; wdir = typeof b.wdir === 'number' ? b.wdir : wdir; }
    if (b.wx) wx.push(b.wx);
  }
  return { src, ceil, vis, wspd, wgst, wdir, wx: wx.join(' '), cover: COVER[cov], at: list[0] && list[0].time ? list[0].time * 1000 : null };
}
// Low-visibility procedures: the conditions airports run LVP for (CAT II /
// III) — visibility or RVR below 550 m, or a ceiling below 200 ft — in the
// weather the rating used. A METAR's RVR groups (R26/0400…) count too, as the
// visibility alone can read better than the runway does. Returns the reason
// ("RVR 400 m (METAR)") or null.
export function lvpOf(w, metarRaw = '') {
  if (!w || !w.src) return null;
  const why = [];
  if (Number.isFinite(w.vis) && w.vis < 550) why.push(`visibility ${Math.round(w.vis / 50) * 50} m`);
  if (Number.isFinite(w.ceil) && w.ceil < 200) why.push(`ceiling ${Math.round(w.ceil)} ft`);
  if (w.src === 'METAR' && metarRaw) {
    const rvr = [...String(metarRaw).matchAll(/\bR\d{2}[LRC]?\/[PM]?(\d{4})/g)].map(m => +m[1]);
    if (rvr.length && Math.min(...rvr) < 550) why.push(`RVR ${Math.min(...rvr)} m`);
  }
  return why.length ? `${why.join(', ')} (${w.src})` : null;
}

export function wxAt(entry, ts, now = Date.now(), mode = 'plan') {
  const tsS = ts / 1000;
  const metar = entry && entry.metar;
  const cur = metarCurrent(entry, now);
  const tafAt = () => {
    const blocks = (entry && entry.taf && entry.taf.f || []).filter(f => f.from <= tsS && tsS < f.to);
    return blocks.length ? fold(blocks, 'TAF') : null;
  };
  // Chosen by hand on the airport card: exactly that source. A TAF for a
  // time it doesn't cover (an old flight) falls back to the TAF for now.
  if (mode === 'metar') return metar ? fold([metar], 'METAR') : { src: null };
  if (mode === 'taf') {
    const t = tafAt();
    if (t) return t;
    const nowS = now / 1000;
    const blocks = (entry && entry.taf && entry.taf.f || []).filter(f => f.from <= nowS && nowS < f.to);
    return blocks.length ? { ...fold(blocks, 'TAF'), forNow: true } : { src: null };
  }
  if (mode === 'browse') {
    if (metar) return fold([metar], 'METAR');
    return tafAt() || { src: null };
  }
  if (mode === 'near' && metar) return fold([metar], 'METAR');
  if (cur && Math.abs(ts - now) <= H) return fold([metar], 'METAR');
  const t = tafAt();
  if (t) return t;
  if (cur && Math.abs(ts - now) <= 3 * H) return fold([metar], 'METAR');
  return { src: null };
}
// Runway / wind follows the same rule.
export function windFor(entry, ts, now = Date.now(), mode = 'plan') {
  return wxAt(entry, ts, now, mode);
}

// ---------- Wind limits ----------
// Crosswind: QRH Ops Info OI.2.22 "Take-off and Landing Runway Condition and
// Crosswind Limitations" (OM A 8.3.10.9 points there), by Runway Condition
// Code 0–6. Gusts fully applied (note 17). For runways 45 m (148 ft) wide or
// more; 30–44 m: 1 kt less per metre under 45, never below 5 kt (note 18).
export const XW_LIMIT = { to: [0, 13, 15, 20, 22, 25, 34], ldg: [0, 15, 17, 25, 35, 40, 40] };
export const TAILWIND_MAX = 10;   // FCOM Limitations, take-off and landing
export const WIND_MAX = 65;       // OM A 8.3.20.1.9: company maximum, gusts included
export function xwLimits(rcc = 6, widthFt = 148) {
  const wm = Number(widthFt) ? Math.round(Number(widthFt) * 0.3048) : 45;
  const cut = wm < 45 ? 45 - wm : 0;
  const k = Math.max(0, Math.min(6, rcc));
  return { to: k ? Math.max(5, XW_LIMIT.to[k] - cut) : 0, ldg: k ? Math.max(5, XW_LIMIT.ldg[k] - cut) : 0, rcc: k, cut };
}
// No runway report in a METAR / TAF: the weather in it stands in for one —
// snow, ice pellets, freezing precipitation → Medium (3); rain, drizzle,
// showers, thunderstorm → wet, Good (5); else dry (6).
export function rccOfWx(wx) {
  const t = String(wx || '').toUpperCase();
  if (/SN|SG|PL|GS|FZ|IC/.test(t)) return 3;
  if (/RA|DZ|SH|TS|UP/.test(t)) return 5;
  return 6;
}
// The colour scale (g y o r): crosswind (gust in) past the landing limit red,
// past the take-off limit orange, within 5 kt of it yellow; tailwind over
// 10 kt red, 6–10 orange, any yellow; wind or gust 65 kt+ red (company
// maximum), 40+ orange, 25+ or gusting 10 kt over the mean yellow.
export function xwBandFor(kt, lim) {
  if (!(kt > 0) || !lim) return '';
  return kt > lim.ldg ? 'r' : kt > lim.to ? 'o' : kt > lim.to - 5 ? 'y' : '';
}
export function tailBand(kt) { return kt > TAILWIND_MAX ? 'r' : kt > 5 ? 'o' : kt > 0 ? 'y' : ''; }
export function speedBand(spd, gust) {
  const m = Math.max(Number(spd) || 0, Number(gust) || 0);
  return m >= WIND_MAX ? 'r' : m >= 40 ? 'o' : (m >= 25 || (gust && gust - (spd || 0) >= 10)) ? 'y' : '';
}
const BRANK = { r: 3, o: 2, y: 1, '': 0 };
export function worstBand(...b) { return b.reduce((a, x) => (BRANK[x || ''] > BRANK[a || ''] ? x : a), ''); }
// One wind against an airport's runways: the best end's band (crosswind
// with the gust, tailwind) and the wind's own strength.
export function windBand(rwys, wdir, spd, gust, rcc = 6) {
  const sb = speedBand(spd, gust), top = Math.max(spd || 0, gust || 0);
  if (!top) return '';
  const list = (rwys || []).filter(r => r[3] != null);
  if (wdir == null || !list.length) {
    // Variable: it can blow straight across the widest runway.
    const wd = list.reduce((a, r) => Math.max(a, r[2] || 148), 0) || 148;
    return worstBand(sb, wdir == null ? xwBandFor(top, xwLimits(rcc, wd)) : '');
  }
  let best = null;
  for (const r of list) for (const h of [r[3], (r[3] + 180) % 360]) {
    const a = (wdir - h) * R;
    const xb = xwBandFor(Math.round(Math.abs(Math.sin(a)) * top), xwLimits(rcc, r[2]));
    const tb = tailBand(Math.round(-Math.cos(a) * (spd || 0)));
    const b = worstBand(xb, tb);
    if (best == null || BRANK[b] < BRANK[best]) best = b;
  }
  return worstBand(sb, best);
}

// Crosswind on the best-aligned runway (lowest crosswind, not mostly tailwind).
function bestRunwayForWind(rwys, wdir, wind) {
  if (!wind || wdir == null) return null;
  let best = null;
  for (const r of rwys) {
    if (r[3] == null) continue;
    const ends = String(r[0]).split('/');
    for (const [i, hdg] of [[0, r[3]], [1, (r[3] + 180) % 360]]) {
      const ang = (wdir - hdg) * R;
      const xw = Math.abs(Math.sin(ang)) * wind;
      const hw = Math.cos(ang) * wind;
      if (hw < -10) continue;
      // Lowest crosswind; within a knot of each other, the one with more
      // headwind (never pick a tailwind end over an equal headwind one).
      if (!best || xw < best.xw - 1 || (Math.abs(xw - best.xw) <= 1 && hw > best.hw)) {
        best = { rwy: ends[i] || r[0], xw: Math.round(xw), hw: Math.round(hw), width: r[2] || 148 };
      }
    }
  }
  return best;
}

// ---------- NOTAMs ----------
// Plain-text scan of the NOTAM items for the three things that change a
// diversion decision. Only NOTAMs in force at `ts` (or with no end) count.
// In force within ±`win` of ts — validity AND the Item D schedule.
export function notamFlags(items, ts, win = 30 * 60e3) {
  const out = { adClosed: false, rwyClosed: [], ilsOut: [], noFuel: false, rffs: null, distReduced: false, lightsOut: false, count: 0 };
  if (!Array.isArray(items)) return out;
  for (const n of items) {
    if (!inForce(n, ts - win, ts + win)) continue;
    const t = String(n.text || '').toUpperCase();
    out.count++;
    if (/\b(AD|AERODROME|AIRPORT)\s+(CLSD|CLOSED)\b/.test(t)) out.adClosed = true;
    const rw = /\bRWY\s+(\d{2}[LRC]?(?:\/\d{2}[LRC]?)?)\s+(CLSD|CLOSED)\b/.exec(t);
    // Closed for take-off only still takes a diversion landing.
    if (rw && !/^\s*(FOR|TO)\s+(T\/?O|TKOF|TAKE-?OFF|DEP\w*)\b/.test(t.slice(rw.index + rw[0].length))) out.rwyClosed.push(rw[1]);
    const ils = /\b(ILS|LOC|LLZ|GP|GS|GLIDE ?PATH)\b[^.]{0,50}\b(U\/S|UNSERVICEABLE|NOT AVBL|NOT AVAILABLE|OUT OF SERVICE|OTS|WITHDRAWN|SUSPENDED)/.exec(t);
    if (ils) out.ilsOut.push(t.slice(0, 80));
    if (/\b(NO FUEL|FUEL\b[^.]{0,30}\b(NOT AVBL|NOT AVAILABLE|U\/S|UNAVAILABLE))/.test(t)) out.noFuel = true;
    const rf = /\b(RFFS?|FIRE ?FIGHTING|RESCUE AND FIRE)\b[^.]{0,40}\bCAT(?:EGORY)?\s*([1-9]|10)\b/.exec(t);
    if (rf) out.rffs = out.rffs == null ? +rf[2] : Math.min(out.rffs, +rf[2]);
    if (/\b(TORA|TODA|ASDA|LDA)\b[^.]{0,40}\b(REDUCED|RESTRICTED)|\bSHORTENED\b/.test(t)) out.distReduced = true;
    if (/\b(ALS|APCH LGT|APPROACH LIGHT\w*|RWY (EDGE |CL |CENTRE ?LINE )?LGT|TDZ LGT)\b[^.]{0,40}\b(U\/S|UNSERVICEABLE|NOT AVBL|OUT OF SERVICE|OTS)/.test(t)) out.lightsOut = true;
  }
  return out;
}

// One NOTAM's weight for a diversion, for colour-coding the card:
//   'r' red    — aerodrome closed, a usable runway closed, ILS/LOC/GP out,
//                no fuel, fire cover below what a 737 needs
//   'o' orange — a shorter runway / taxiway closed, VOR/DME/NDB out,
//                approach / runway lighting out, declared distances reduced
//   'y' yellow — work in progress, cranes / obstacles, birds
//   ''  the rest
// `usable` is the set of runway designators the rating can use (both ends).
export function notamSeverity(text, usable = new Set()) {
  const t = String(text || '').toUpperCase();
  if (/\b(AD|AERODROME|AIRPORT)\s+(CLSD|CLOSED)\b/.test(t)) return 'r';
  const rw = /\bRWY\s+(\d{2}[LRC]?)(?:\/(\d{2}[LRC]?))?\s+(CLSD|CLOSED)\b/.exec(t);
  if (rw) return (usable.has(rw[1]) || (rw[2] && usable.has(rw[2]))) ? 'r' : 'o';
  if (/\b(ILS|LOC|LLZ|GP|GS|GLIDE ?PATH)\b[^.]{0,50}\b(U\/S|UNSERVICEABLE|NOT AVBL|OUT OF SERVICE|OTS|WITHDRAWN|SUSPENDED|NOT AVAILABLE)/.test(t)) return 'r';
  if (/\b(NO FUEL|FUEL\b[^.]{0,30}\bNOT AVBL)/.test(t)) return 'r';
  if (/\bRFFS?\b[^.]{0,40}\bCAT(EGORY)?\s*([1-6])\b/.test(t)) return 'r';
  if (/\bTWY\b[^.]{0,40}\b(CLSD|CLOSED)\b/.test(t)) return 'o';
  if (/\b(VOR|DVOR|DME|NDB|TACAN)\b[^.]{0,40}\b(U\/S|UNSERVICEABLE|NOT AVBL|OUT OF SERVICE|OTS)/.test(t)) return 'o';
  if (/\b(ALS|APCH LGT|APPROACH LIGHT|PAPI|VASIS?|RWY (EDGE |CL |CENTRE ?LINE )?LGT|TDZ LGT)\b[^.]{0,40}\b(U\/S|UNSERVICEABLE|NOT AVBL|OUT OF SERVICE|OTS)/.test(t)) return 'o';
  if (/\b(TORA|TODA|ASDA|LDA)\b[^.]{0,40}\b(REDUCED|RESTRICTED)|\bTHR\b[^.]{0,20}\bDISPLACED|\bSHORTENED\b/.test(t)) return 'o';
  if (/\b(WIP|WORK IN PROGRESS|CRANE|OBST|BIRD)/.test(t)) return 'y';
  return '';
}

// ---------- Rating ----------
// Each part's points against its maximum, so a card can say exactly why an
// airport isn't a 10 ("−1.4 distance: 139 nm off the route").
// A runway shorter than this doesn't count as a spare (a second runway).
export const SPARE_FT = 7000;
export const MAX = { runway: 2, lighting: 0.5, size: 1.5, distance: 3, weather: 3 };
export function rate(ap, { distNm, eta, wxEntry, notams, rules = getCountryRules(), now = Date.now(), mode = 'plan' }) {
  const why = [];
  if (rules.exclude.includes(ap.icao) || (rules.exclude.includes(ap.cc) && !(ap.icao in rules.penalty))) {
    return { score: 0, excluded: true, why: [`${rules.exclude.includes(ap.icao) ? ap.icao : ap.country}: not a diversion option`], lost: [] };
  }
  const flags = notams ? notamFlags(notams, eta) : null;
  if (flags && flags.adClosed) return { score: 0, why: ['Aerodrome closed by NOTAM'], flags, lost: [] };
  const closed = new Set((flags && flags.rwyClosed) || []);
  const usable = ap.rwy.filter(r => r[1] >= 5500 && !closed.has(r[0]) && !String(r[0]).split('/').some(e => closed.has(e)));
  if (!usable.length) return { score: 0, why: ['No usable runway (5,500 ft hard surface)'], flags, lost: [] };
  const lost = [];      // { pts, what } — every point short of the maximum
  const L = usable[0][1], width = usable[0][2];
  let rwyPts = L >= 9000 ? 2 : L >= 8000 ? 1.8 : L >= 7000 ? 1.5 : L >= 6000 ? 1 : 0.4;
  if (rwyPts < MAX.runway) lost.push({ pts: MAX.runway - rwyPts, what: `Longest runway ${L.toLocaleString('en-US')} ft (9,000+ scores full)` });
  if (width && width < 98) { rwyPts -= 0.5; why.push(`Narrow runway (${width} ft)`); lost.push({ pts: 0.5, what: `Narrow runway (${width} ft)` }); }
  const lightPts = usable[0][4] ? 0.5 : 0;
  if (!lightPts) { why.push('Runway lighting not listed'); lost.push({ pts: 0.5, what: 'Runway lighting not listed in the data' }); }
  // Not a big city (a medium airport): one full point off — fewer hotels,
  // handling and maintenance for a diverted 737 and its passengers.
  const sizePts = ap.size === 2 ? 1.5 : 0.5;
  if (sizePts < MAX.size) lost.push({ pts: MAX.size - sizePts, what: 'Not a big city (medium airport)' });
  const distPts = 3 * Math.max(0, 1 - distNm / RADIUS_NM);
  if (MAX.distance - distPts >= 0.05) lost.push({ pts: MAX.distance - distPts, what: `${Math.round(distNm)} nm off the route` });

  const w = wxAt(wxEntry, eta, now, mode);
  const wind = windFor(wxEntry, eta, now, mode);
  let wxPts = 1.5, xw = null;
  if (!w.src) { why.push('No forecast for that time'); lost.push({ pts: 1.5, what: mode === 'browse' ? 'No METAR for this airport' : 'No METAR / TAF covering that time' }); }
  else {
    const c = w.ceil, v = w.vis;
    const src = w.src === 'METAR' ? 'METAR' : 'TAF';
    if (c >= 1000 && v >= 5000) wxPts = 3;
    else if (c >= 500 && v >= 1500) { wxPts = 2.2; lost.push({ pts: 0.8, what: `Cloud / visibility a little low (${src})` }); }
    else if (c >= 200 && v >= 550) { wxPts = 1.2; why.push('Low cloud / visibility'); lost.push({ pts: 1.8, what: `Low cloud / visibility (${src})` }); }
    else { wxPts = 0; why.push('Below CAT I (forecast)'); lost.push({ pts: 3, what: `Below CAT I (${src})` }); }
    if (/TS|FZ|SN|GR|\+RA/.test(w.wx || '')) { wxPts -= 1; why.push(`Weather: ${w.wx}`); lost.push({ pts: 1, what: `Weather: ${w.wx}` }); }
  }
  if (wind.src) {
    xw = bestRunwayForWind(usable, wind.wdir, Math.max(wind.wspd || 0, wind.wgst || 0));
    if (xw) { xw.src = wind.src; xw.lim = xwLimits(rccOfWx(wind.wx || (w && w.wx)), xw.width); }
    // Against the QRH landing limit for the runway's width and the weather.
    if (xw && xw.xw > xw.lim.ldg) { wxPts -= 2; why.push(`Crosswind ${xw.xw} kt`); lost.push({ pts: 2, what: `Crosswind ${xw.xw} kt on the best runway — over the ${xw.lim.ldg} kt landing limit (${wind.src})` }); }
    else if (xw && xw.xw > xw.lim.ldg - 5) { wxPts -= 1; why.push(`Crosswind ${xw.xw} kt`); lost.push({ pts: 1, what: `Crosswind ${xw.xw} kt on the best runway — near the ${xw.lim.ldg} kt landing limit (${wind.src})` }); }
    if (Math.max(wind.wspd || 0, wind.wgst || 0) >= WIND_MAX) { wxPts -= 2; why.push(`Wind ${Math.max(wind.wspd || 0, wind.wgst || 0)} kt`); lost.push({ pts: 2, what: `Wind ${Math.max(wind.wspd || 0, wind.wgst || 0)} kt — over the company maximum of ${WIND_MAX} kt (OM A)` }); }
  }
  let score = rwyPts + lightPts + sizePts + distPts + Math.max(-2, wxPts);
  if (ap.elev > 5000) { score -= 0.5; why.push(`High elevation (${ap.elev} ft)`); lost.push({ pts: 0.5, what: `High elevation (${ap.elev.toLocaleString('en-US')} ft)` }); }
  // The airport's own rule if it has one, else its country's.
  const own = ap.icao in rules.penalty;
  const pen = Number(own ? rules.penalty[ap.icao] : rules.penalty[ap.cc]) || 0;
  const who = own ? ap.icao : ap.country;
  if (pen) { score += pen; why.push(`${who} ${pen > 0 ? '+' : ''}${pen}`); if (pen < 0) lost.push({ pts: -pen, what: `${who} (${own ? 'airport' : 'country'} factor, Settings)` }); }
  if (flags && flags.ilsOut.length) { score -= 0.5; why.push('ILS/LOC unserviceable (NOTAM)'); lost.push({ pts: 0.5, what: 'ILS / LOC unserviceable (NOTAM)' }); }
  // Runways: one runway is no spare if it's blocked (a disabled aircraft,
  // an inspection), and a long runway closed by NOTAM costs on top of that.
  const isClosed = (r) => closed.has(r[0]) || String(r[0]).split('/').some(e => closed.has(e));
  const closedLong = ap.rwy.filter(r => r[1] >= 5500 && isClosed(r));
  for (const r of closedLong) { score -= 0.5; why.push(`RWY ${r[0]} closed (NOTAM)`); lost.push({ pts: 0.5, what: `RWY ${r[0]} closed (NOTAM)` }); }
  // A second runway is a spare only if a 737-800 can really land on it:
  // LIBR's 05/23 (5,892 ft) next to 13/31 (10,000 ft) is no second runway.
  const spares = usable.filter(r => r[1] >= SPARE_FT);
  if (usable.length === 1 || spares.length <= 1) {
    const main = spares[0] || usable[0];
    const short = usable.filter(r => r !== main);
    const what = closedLong.length && usable.length === 1 ? `Only one runway left (${main[0]}) with the closure`
      : short.length ? `Only one long runway (${main[0]}); ${short.map(r => `${r[0]} is ${r[1].toLocaleString('en-US')} ft`).join(', ')}`
      : `Only one runway (${main[0]})`;
    score -= 1; why.push(what); lost.push({ pts: 1, what });
  }
  // The other NOTAMs that matter most for a diverting 737.
  if (flags && flags.noFuel) { score -= 2; why.push('No fuel (NOTAM)'); lost.push({ pts: 2, what: 'Fuel not available (NOTAM)' }); }
  if (flags && flags.rffs != null && flags.rffs < 7) { score -= 1; why.push(`Fire cover CAT ${flags.rffs} (NOTAM)`); lost.push({ pts: 1, what: `Fire cover reduced to CAT ${flags.rffs} (NOTAM; a 737-800 needs 7)` }); }
  if (flags && flags.distReduced) { score -= 0.5; why.push('Declared distances reduced (NOTAM)'); lost.push({ pts: 0.5, what: 'Runway distances reduced (NOTAM)' }); }
  if (flags && flags.lightsOut) { score -= 0.5; why.push('Approach / runway lights out (NOTAM)'); lost.push({ pts: 0.5, what: 'Approach / runway lighting out (NOTAM)' }); }
  score = Math.max(0, Math.min(10, Math.round(score)));
  lost.sort((a, b) => b.pts - a.pts);
  return { score, why, wx: w, wind, xw, flags, longest: L, width, usable, lost };
}

// Colour band for a rating.
export function band(score, excluded) {
  if (excluded) return 'x';
  if (score >= 8) return 'a';
  if (score >= 6) return 'b';
  if (score >= 4) return 'c';
  if (score >= 1) return 'd';
  return 'x';
}

// ---------- Candidates ----------
// Every database airport within RADIUS_NM of the route, with its closest
// route point (along-track distance → time abeam).
export function candidates(db, route) {
  const lats = route.pts.map(p => p.lat), lons = route.pts.map(p => p.lon);
  const pad = RADIUS_NM / 60 + 1;
  const minLat = Math.min(...lats) - pad, maxLat = Math.max(...lats) + pad;
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const out = [];
  for (const icao of Object.keys(db.a)) {
    const a = db.a[icao];
    const lat = a[0];
    if (lat < minLat || lat > maxLat) continue;
    // The route's longitudes may run past ±180 (unwrapped across the date
    // line): put the airport in the same frame — whichever of lon, lon±360
    // is nearest the route's middle. Padding widens with latitude.
    const lonPad = pad / Math.max(0.2, Math.cos(lat * R));
    const mid = (minLon + maxLon) / 2;
    let lon = a[1];
    while (lon - mid > 180) lon -= 360;
    while (lon - mid < -180) lon += 360;
    if (lon < minLon - lonPad || lon > maxLon + lonPad) continue;
    let best = Infinity, s = 0;
    for (const p of route.pts) {
      const dd = hav(lat, lon, p.lat, p.lon);
      if (dd < best) { best = dd; s = p.s; }
    }
    if (best <= RADIUS_NM) out.push({ ap: airport(db, icao), distNm: best, along: s, lonDraw: lon });
  }
  return out;
}

// The major airports round each end of the flight, always on the list: the
// alternates a pilot expects to see (Lisbon for Porto, Munich for Zurich).
// Chosen on what doesn't change — never on the rating, so one with bad weather
// stays in view with its low score instead of quietly dropping off, and never
// on distance off the route, which favours whatever lies nearest the track.
// The data's "large" is generous (58 within 300 nm of Zurich), so a 9,000 ft
// runway comes first, then the nearest; the rest only fill what's left.
const END_NM = 300, KEEP_DEST = 8, KEEP_DEP = 4;
export function keyAtEnds(rated, route) {
  const around = (p, n) => rated
    .filter(c => !c.isEnd && !c.r.excluded && c.ap.size === 2 && c.ap.rwy.some(r => r[1] >= 5500))
    .map(c => ({ c, d: hav(c.ap.lat, c.lonDraw, p.lat, p.lon), long: c.ap.rwy.some(r => r[1] >= 9000) ? 1 : 0 }))
    .filter(x => x.d <= END_NM)
    .sort((a, b) => b.long - a.long || a.d - b.d)
    .slice(0, n).map(x => x.c);
  return new Set([...around(route.pts[0], KEEP_DEP), ...around(route.pts.at(-1), KEEP_DEST)]);
}

// The ones worth showing: departure and destination, the major airports round
// them, then the best few in each stretch of the route so the whole way is
// covered rather than just the busiest corner of the map. `perSeg` per ~1/12
// of the route.
export function pickShown(rated, route, perSeg = 4) {
  const segs = 12, len = Math.max(1, route.total);
  const bySeg = new Map();
  for (const c of rated) {
    const k = Math.min(segs - 1, Math.floor(c.along / len * segs));
    if (!bySeg.has(k)) bySeg.set(k, []);
    bySeg.get(k).push(c);
  }
  const keep = new Set();
  for (const list of bySeg.values()) {
    list.sort((a, b) => b.r.score - a.r.score || b.ap.size - a.ap.size || a.distNm - b.distNm);
    list.filter(c => !c.r.excluded).slice(0, perSeg).forEach(c => keep.add(c));
    // Excluded countries close to the route stay visible, grey — knowing
    // where NOT to go is part of the picture.
    list.filter(c => c.r.excluded && c.distNm < 120).slice(0, 2).forEach(c => keep.add(c));
  }
  for (const c of rated) if (c.isEnd) keep.add(c);
  for (const c of keyAtEnds(rated, route)) keep.add(c);
  return [...keep].sort((a, b) => a.along - b.along);
}

// ---------- Fetching ----------
export async function fetchWeather(ids) {
  if (!WORKER_BASE || !ids.length) return null;
  const r = await fetch(WORKER_BASE.replace(/\/$/, '') + '/routewx?ids=' + ids.join(','), { cache: 'no-store' });
  if (!r.ok) throw new Error('weather HTTP ' + r.status);
  return r.json();
}
// Several small requests side by side, not one big one: the worker makes a
// call per airport (cache read and write) and Cloudflare's free plan stops a
// request at 50 calls, so thirty airports in one went over and failed.
const NOTAM_BATCH = 6;
export async function fetchNotams(ids) {
  if (!WORKER_BASE || !ids.length) return { off: true };
  const base = WORKER_BASE.replace(/\/$/, '') + '/notams?ids=';
  const list = ids.slice(0, 30), parts = [];
  for (let i = 0; i < list.length; i += NOTAM_BATCH) parts.push(list.slice(i, i + NOTAM_BATCH));
  const res = await Promise.all(parts.map(async (p) => {
    try {
      const r = await fetch(base + p.join(','), { cache: 'no-store' });
      if (r.status === 501 || r.status === 404) return { off: true };
      if (!r.ok) { const e = await r.json().catch(() => ({})); return { err: e.error || 'NOTAM HTTP ' + r.status }; }
      return await r.json();
    } catch (e) { return { err: String(e.message || e) }; }
  }));
  if (res.some(x => x.off)) return { off: true };
  const ok = res.filter(x => x.notams);
  if (!ok.length) throw new Error(res.find(x => x.err)?.err || 'NOTAMs failed');
  return { notams: Object.assign({}, ...ok.map(x => x.notams)), partial: ok.length < res.length };
}

// ---------- SIGMETs along the route ----------
// Every SIGMET in force worldwide (worker /sigmet, from aviationweather.gov),
// cut down to the ones this flight meets: an area the route passes through
// or within SIG_NEAR_NM of, while it's valid — give or take SIG_SLACK_MIN
// round the time you'd be there. Each kept one carries `pass`: [first, last]
// ms you'd be near it.
export const SIG_NEAR_NM = 50, SIG_SLACK_MIN = 30;
export async function fetchSigmets() {
  if (!WORKER_BASE) return null;
  const r = await fetch(WORKER_BASE.replace(/\/$/, '') + '/sigmet', { cache: 'no-store' });
  if (!r.ok) throw new Error('SIGMET HTTP ' + r.status);
  return r.json();
}
function inRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
// Distance (nm) from a point to a ring's edge, flat round the point — fine
// for "within 50 nm".
function ringDistNm(lon, lat, ring) {
  const k = Math.cos(lat * R);
  let best = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const ax = (ring[j][0] - lon) * k, ay = ring[j][1] - lat, bx = (ring[i][0] - lon) * k, by = ring[i][1] - lat;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    best = Math.min(best, Math.hypot(ax + dx * t, ay + dy * t) * 60);
  }
  return best;
}
export function sigmetsAlong(list, route, tm) {
  const out = [];
  for (const s of list || []) {
    const from = Date.parse(s.from), to = Date.parse(s.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) continue;
    let first = null, last = null;
    for (const p of route.pts) {
      const near = s.polys.some(r => inRing(p.lon, p.lat, r) || ringDistNm(p.lon, p.lat, r) <= SIG_NEAR_NM);
      if (!near) continue;
      const t = tm.etaAt(p.s);
      if (first == null) first = t;
      last = t;
    }
    if (first == null) continue;
    const slack = SIG_SLACK_MIN * 60000;
    if (last < from - slack || first > to + slack) continue;
    out.push({ ...s, pass: [first, last] });
  }
  return out.sort((a, b) => a.pass[0] - b.pass[0]);
}
export function sigmetHas(s, lon, lat) { return s.polys.some(r => inRing(lon, lat, r)); }
