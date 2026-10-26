// route-info.js — diversion airports along the route, rated 0–10.
//
// The route: the great circle from departure to destination (no free source
// has the filed route — see the FlightAware note in the v157 commit). Every
// airport within an hour's flying of it (420 nm at a diversion speed of
// ~420 kt) is a candidate, rated for a 737 on what free data can say:
//
//   runway   0.4–2    longest open hard runway (5,500 ft is the floor for a 737)
//   lighting 0–0.5    that runway lighted
//   size     0.8–1.5  large airport (a big city: hotels, handling, maintenance,
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

import { WORKER_BASE } from './proxy.js?v=183';

export const RADIUS_NM = 420;            // one hour at a diversion speed of ~420 kt
const NM_PER_RAD = 3440.065;
const R = Math.PI / 180;
const H = 3600000;

// ---------- Countries ----------
// Places an Israeli aircraft can't (or really shouldn't) divert to: rated 0
// and shown grey. Plus per-country penalties. Editable in Settings; stored on
// this device as fc.div.countries.
export const DEFAULT_COUNTRIES = {
  exclude: ['LB', 'SY', 'IQ', 'IR', 'LY', 'YE', 'DZ', 'KW', 'PK', 'AF'],
  penalty: { TR: -2 },
};
export function getCountryRules() {
  try {
    const v = JSON.parse(localStorage.getItem('fc.div.countries') || 'null');
    if (v && Array.isArray(v.exclude) && v.penalty && typeof v.penalty === 'object') return v;
  } catch {}
  return DEFAULT_COUNTRIES;
}
export function setCountryRules(rules) {
  try { localStorage.setItem('fc.div.countries', JSON.stringify(rules)); } catch {}
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
function fold(list, src) {
  let ceil = Infinity, vis = Infinity, wspd = 0, wgst = 0, wdir = null, wx = [];
  for (const b of list) {
    ceil = Math.min(ceil, ceilingFt(b.clouds, b.vv));
    const v = visM(b.visib); if (Number.isFinite(v)) vis = Math.min(vis, v);
    const sp = Number(b.wspd) || 0, gs = Number(b.wgst) || 0;
    if (Math.max(sp, gs) >= Math.max(wspd, wgst)) { wspd = sp; wgst = gs; wdir = typeof b.wdir === 'number' ? b.wdir : wdir; }
    if (b.wx) wx.push(b.wx);
  }
  return { src, ceil, vis, wspd, wgst, wdir, wx: wx.join(' '), at: list[0] && list[0].time ? list[0].time * 1000 : null };
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
        best = { rwy: ends[i] || r[0], xw: Math.round(xw), hw: Math.round(hw) };
      }
    }
  }
  return best;
}

// ---------- NOTAMs ----------
// Plain-text scan of the NOTAM items for the three things that change a
// diversion decision. Only NOTAMs in force at `ts` (or with no end) count.
export function notamFlags(items, ts) {
  const out = { adClosed: false, rwyClosed: [], ilsOut: [], count: 0 };
  if (!Array.isArray(items)) return out;
  for (const n of items) {
    const st = Date.parse(n.start), en = Date.parse(n.end);
    if (Number.isFinite(st) && st > ts) continue;
    if (Number.isFinite(en) && en < ts) continue;
    const t = String(n.text || '').toUpperCase();
    out.count++;
    if (/\b(AD|AERODROME|AIRPORT)\s+(CLSD|CLOSED)\b/.test(t)) out.adClosed = true;
    const rw = /\bRWY\s+(\d{2}[LRC]?(?:\/\d{2}[LRC]?)?)\s+(CLSD|CLOSED)\b/.exec(t);
    if (rw) out.rwyClosed.push(rw[1]);
    const ils = /\b(ILS|LOC|GP|GS)\b[^.]{0,40}\b(U\/S|UNSERVICEABLE|NOT AVBL|OUT OF SERVICE)/.exec(t);
    if (ils) out.ilsOut.push(t.slice(0, 80));
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
  if (/\b(ILS|LOC|LLZ|GP|GS|GLIDE ?PATH)\b[^.]{0,50}\b(U\/S|UNSERVICEABLE|NOT AVBL|OUT OF SERVICE|OTS|WITHDRAWN)/.test(t)) return 'r';
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
export const MAX = { runway: 2, lighting: 0.5, size: 1.5, distance: 3, weather: 3 };
export function rate(ap, { distNm, eta, wxEntry, notams, rules = getCountryRules(), now = Date.now(), mode = 'plan' }) {
  const why = [];
  if (rules.exclude.includes(ap.cc)) {
    return { score: 0, excluded: true, why: [`${ap.country}: not a diversion option`], lost: [] };
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
  const sizePts = ap.size === 2 ? 1.5 : 0.8;
  if (sizePts < MAX.size) lost.push({ pts: MAX.size - sizePts, what: 'Medium airport — a smaller city than a large one' });
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
    if (xw) xw.src = wind.src;
    if (xw && xw.xw > 35) { wxPts -= 2; why.push(`Crosswind ${xw.xw} kt`); lost.push({ pts: 2, what: `Crosswind ${xw.xw} kt on the best runway (${wind.src})` }); }
    else if (xw && xw.xw > 25) { wxPts -= 1; why.push(`Crosswind ${xw.xw} kt`); lost.push({ pts: 1, what: `Crosswind ${xw.xw} kt on the best runway (${wind.src})` }); }
  }
  let score = rwyPts + lightPts + sizePts + distPts + Math.max(-2, wxPts);
  if (ap.elev > 5000) { score -= 0.5; why.push(`High elevation (${ap.elev} ft)`); lost.push({ pts: 0.5, what: `High elevation (${ap.elev.toLocaleString('en-US')} ft)` }); }
  const pen = Number(rules.penalty[ap.cc]) || 0;
  if (pen) { score += pen; why.push(`${ap.country} ${pen > 0 ? '+' : ''}${pen}`); if (pen < 0) lost.push({ pts: -pen, what: `${ap.country} (country penalty, Settings)` }); }
  if (flags && flags.ilsOut.length) { score -= 0.5; why.push('ILS/LOC unserviceable (NOTAM)'); lost.push({ pts: 0.5, what: 'ILS / LOC unserviceable (NOTAM)' }); }
  if (flags && closed.size) why.push(`RWY ${[...closed].join(', ')} closed (NOTAM)`);
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

// The ones worth showing: departure and destination, then the best few in
// each stretch of the route so the whole way is covered rather than just
// the busiest corner of the map. `perSeg` per ~1/12 of the route.
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
    list.sort((a, b) => b.r.score - a.r.score || a.distNm - b.distNm);
    list.filter(c => !c.r.excluded).slice(0, perSeg).forEach(c => keep.add(c));
    // Excluded countries close to the route stay visible, grey — knowing
    // where NOT to go is part of the picture.
    list.filter(c => c.r.excluded && c.distNm < 120).slice(0, 2).forEach(c => keep.add(c));
  }
  for (const c of rated) if (c.isEnd) keep.add(c);
  return [...keep].sort((a, b) => a.along - b.along);
}

// ---------- Fetching ----------
export async function fetchWeather(ids) {
  if (!WORKER_BASE || !ids.length) return null;
  const r = await fetch(WORKER_BASE.replace(/\/$/, '') + '/routewx?ids=' + ids.join(','), { cache: 'no-store' });
  if (!r.ok) throw new Error('weather HTTP ' + r.status);
  return r.json();
}
export async function fetchNotams(ids) {
  if (!WORKER_BASE || !ids.length) return { off: true };
  const r = await fetch(WORKER_BASE.replace(/\/$/, '') + '/notams?ids=' + ids.slice(0, 30).join(','), { cache: 'no-store' });
  if (r.status === 501 || r.status === 404) return { off: true };
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error(e.error || 'NOTAM HTTP ' + r.status);
  }
  return r.json();
}
