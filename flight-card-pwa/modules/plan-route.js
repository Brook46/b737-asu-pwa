// plan-route.js — the route as filed, pasted from the OFP or the ATC flight
// plan, so Route info, the CPDLC banner and the FDP estimate follow the
// real track instead of the great circle.
//
// The pasted text is read token by token: waypoints and navaids by name
// (data/fixdb.txt, built by scripts/build-fixdb.py), airports by ICAO,
// coordinates as written (3200N03400E, 32N034E, N3201.2 E03452.1), a SID or
// STAR by the fix it's named after (SUVAS1A → SUVAS). Airways, DCT and
// speed/level groups are skipped: the line runs straight between the fixes
// either side, close enough for diversions and FIR crossings. A whole ICAO
// FPL works too — only what's between the departure and destination
// airports is read.
//
// A name that repeats worldwide is taken where it fits the way (least
// detour from the last fix towards the destination); one that fits nowhere
// is listed as not found and left out. Resolved points are kept with the
// leg (fc.plan), so the 1.6 MB name list is only fetched while pasting —
// on the ground, with internet — and nothing is needed in the air.

const R = Math.PI / 180, NM_PER_RAD = 3440.065;
// A GPS fix further than this off the filed route (a reroute, radar
// vectors far away) isn't on it any more: go direct from where we are.
export const OFF_ROUTE_NM = 40;
// Worse than this (an iPad on Wi-Fi only guesses from networks) and the
// position isn't used at all.
export const GPS_MAX_ACC_M = 1000;
export function goodFix(accM) { return !(Number(accM) > GPS_MAX_ACC_M); }

export function distNm(a, b) {
  const x = Math.sin((b.lat - a.lat) * R / 2) ** 2 + Math.cos(a.lat * R) * Math.cos(b.lat * R) * Math.sin((b.lon - a.lon) * R / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(x))) * NM_PER_RAD;
}

// ---------- Saved with the leg ----------
const KEY = 'fc.plan';
export function planKey(leg) {
  return [leg?.flight, leg?.dep_date, leg?.dep, leg?.arr, leg?.dep_year].map(v => String(v == null ? '' : v)).join('|');
}
function all() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
export function getPlan(leg) {
  const p = leg ? all()[planKey(leg)] : null;
  return p && Array.isArray(p.pts) && p.pts.length >= 2 ? p : null;
}
export function setPlan(leg, plan) {
  const a = all();
  if (plan) a[planKey(leg)] = { ...plan, at: Date.now() }; else delete a[planKey(leg)];
  // Kept 45 days: long enough for the logbook look-back, small enough.
  for (const k of Object.keys(a)) if (!(a[k].at > Date.now() - 45 * 86400000)) delete a[k];
  try { localStorage.setItem(KEY, JSON.stringify(a)); } catch {}
}

// ---------- Names ----------
let fixes = null;
export async function loadFixes() {
  if (fixes) return fixes;
  const res = await fetch('./data/fixdb.txt?v=232');
  if (!res.ok) throw new Error('waypoint list ' + res.status);
  const m = new Map();
  for (const line of (await res.text()).split('\n')) {
    if (!line || line[0] === '#') continue;
    const f = line.split(' ');
    const list = [];
    for (let i = 1; i + 1 < f.length; i += 2) list.push({ lat: f[i] / 100, lon: f[i + 1] / 100 });
    m.set(f[0], list);
  }
  return (fixes = m);
}

// ---------- Parsing ----------
const SKIP = new Set(['DCT', 'SID', 'STAR', 'IFR', 'VFR', 'OAT', 'GAT', 'T', 'C']);
// ICAO FPL item 18 indicators: everything from the first one on is remarks.
const ITEM18 = /^(PBN|NAV|COM|DAT|SUR|DEP|DEST|DOF|REG|EET|SEL|TYP|CODE|DLE|OPR|ORGN|PER|ALTN|RALT|TALT|RIF|RMK|STS|RVR)\//;
const SPEED_LEVEL = /^[NKM]\d{3,4}([FASM]\d{3,4}|VFR)$/;
const AIRWAY = /^[A-Z]{1,2}\d{1,4}[A-Z]?$/;
const PROC = /^([A-Z]{2,5})\d[A-Z]?$/;

function coordOf(tok, next) {
  let m = /^(\d{2})(\d{2})?(\d{2})?([NS])(\d{3})(\d{2})?(\d{2})?([EW])$/.exec(tok);
  if (m) {
    const lat = (+m[1] + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600) * (m[4] === 'S' ? -1 : 1);
    const lon = (+m[5] + (+m[6] || 0) / 60 + (+m[7] || 0) / 3600) * (m[8] === 'W' ? -1 : 1);
    return { lat, lon, used: 1 };
  }
  // OFP style, with or without a space: N3201.2 E03452.1
  const NS = /^([NS])(\d{2})(\d{2}(?:\.\d+)?)?$/, EW = /^([EW])(\d{3})(\d{2}(?:\.\d+)?)?$/;
  m = /^([NS])(\d{2})(\d{2}(?:\.\d+)?)?([EW])(\d{3})(\d{2}(?:\.\d+)?)?$/.exec(tok);
  let a, b, used = 1;
  if (m) { a = [m[1], m[2], m[3]]; b = [m[4], m[5], m[6]]; }
  else if ((a = NS.exec(tok)) && next && (b = EW.exec(next))) { a = a.slice(1); b = b.slice(1); used = 2; }
  else return null;
  const lat = (+a[1] + (parseFloat(a[2]) || 0) / 60) * (a[0] === 'S' ? -1 : 1);
  const lon = (+b[1] + (parseFloat(b[2]) || 0) / 60) * (b[0] === 'W' ? -1 : 1);
  return { lat, lon, used };
}

// text → { pts: [{ n, lat, lon }], missing: [names], found }. A and B are
// the leg's airports ({ icao, lat, lon }); airportOf(icao) finds any other.
export function parse(text, A, B, fixMap, airportOf = () => null) {
  let toks = String(text || '').toUpperCase().replace(/[(),]/g, ' ').split(/[\s]+/)
    .map(t => t.replace(/^-+|-+$/g, '')).filter(Boolean);
  const cut = toks.findIndex(t => ITEM18.test(t));
  if (cut >= 0) toks = toks.slice(0, cut);
  const base = (t) => t.split('/')[0];
  const isAp = (t, ap) => ap && new RegExp(`^${ap.icao}(\\d{4})?$`).test(base(t));
  // Only what's between the two airports, when they're there.
  const i0 = toks.findIndex(t => isAp(t, A));
  if (i0 >= 0) toks = toks.slice(i0 + 1);
  const i1 = toks.findIndex(t => isAp(t, B));
  if (i1 >= 0) toks = toks.slice(0, i1);

  const pts = [{ n: A.icao, lat: A.lat, lon: A.lon }];
  const missing = [];
  let found = 0;
  // A copy of a name fits when going by it adds little to the way from the
  // last fix to the destination; of those that fit, the one nearest the last
  // fix is taken — fixes follow each other, a namesake 1,500 nm on that
  // happens to lie near the great circle (TRL in Spain for Tripolis VOR in
  // Greece) isn't the next one.
  // Also: not far off to the side of the way on (cross-track), so a
  // namesake in Serbia isn't taken for a fix west of Cyprus.
  const xtk = (a, b, c) => {
    const d13 = distNm(a, c) / NM_PER_RAD;
    const brg = (p, q) => Math.atan2(Math.sin((q.lon - p.lon) * R) * Math.cos(q.lat * R),
      Math.cos(p.lat * R) * Math.sin(q.lat * R) - Math.sin(p.lat * R) * Math.cos(q.lat * R) * Math.cos((q.lon - p.lon) * R));
    return Math.abs(Math.asin(Math.sin(d13) * Math.sin(brg(a, c) - brg(a, b)))) * NM_PER_RAD;
  };
  const fits = (prev, c) => {
    const d = distNm(prev, B);
    return distNm(prev, c) + distNm(c, B) - d <= d * 0.3 + 100 && xtk(prev, B, c) <= Math.max(150, d * 0.15);
  };
  for (let i = 0; i < toks.length; i++) {
    const raw = toks[i], t = base(raw);
    if (!t || SKIP.has(t) || SPEED_LEVEL.test(t) || /^\d+$/.test(t)) continue;
    const prev = pts[pts.length - 1];
    const c = coordOf(t, toks[i + 1] && base(toks[i + 1]));
    if (c) { i += c.used - 1; pts.push({ n: t, lat: c.lat, lon: c.lon }); found++; continue; }
    if (AIRWAY.test(t)) continue;
    let name = t;
    const pm = PROC.exec(t);
    if (pm) name = pm[1];
    if (!/^[A-Z]{2,5}$/.test(name)) continue;
    let cands = [];
    if (name.length === 4) { const ap = airportOf(name); if (ap) cands.push(ap); }
    cands = cands.concat(fixMap.get(name) || []);
    const ok = cands.filter(p => fits(prev, p)).sort((p, q) => distNm(prev, p) - distNm(prev, q));
    if (!ok.length) { if (!missing.includes(name)) missing.push(name); continue; }
    const p = ok[0];
    if (distNm(prev, p) < 2) continue;              // the same place again
    pts.push({ n: name, lat: p.lat, lon: p.lon });
    found++;
  }
  pts.push({ n: B.icao, lat: B.lat, lon: B.lon });
  return { pts, missing, found };
}

// Names the waypoint list doesn't have (it's from 2013; fixes come and go
// every AIRAC) looked up in FlightPlanDatabase's free, CORS-open navaid
// search, current data. Only for what's missing, at paste time; each answer
// joins fixMap so parse() can place it.
export async function fillMissing(names, fixMap) {
  let added = 0;
  for (const n of names.slice(0, 25)) {
    try {
      const r = await fetch('https://api.flightplandatabase.com/search/nav?q=' + encodeURIComponent(n));
      if (!r.ok) { if (r.status === 429) break; continue; }
      const hits = (await r.json()).filter(x => x.ident === n && /^(FIX|VOR|NDB|DME|TACAN|VORTAC)$/.test(x.type))
        .map(x => ({ lat: x.lat, lon: x.lon }));
      if (hits.length) { fixMap.set(n, [...(fixMap.get(n) || []), ...hits]); added++; }
    } catch {}
  }
  return added;
}

// ---------- Along the route ----------
// Where a GPS position is on the filed route: the nearest point on it,
// how far off, flown and still to go (nm), and the path ahead from that
// point. null when it's more than OFF_ROUTE_NM off — not on the route.
export function progress(pts, pos) {
  if (!pts || pts.length < 2) return null;
  let best = null, along = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const seg = distNm(a, b);
    // Flat projection round the segment — fine for "which point is nearest".
    const k = Math.cos(((a.lat + b.lat) / 2) * R);
    const ax = a.lon * k, bx = b.lon * k, px = pos.lon * k;
    const dx = bx - ax, dy = b.lat - a.lat;
    const L = dx * dx + dy * dy;
    let t = L ? ((px - ax) * dx + (pos.lat - a.lat) * dy) / L : 0;
    t = Math.max(0, Math.min(1, t));
    const q = { lat: a.lat + dy * t, lon: a.lon + (b.lon - a.lon) * t };
    const off = distNm(pos, q);
    if (!best || off < best.off) best = { off, i, q, done: along + seg * t };
    along += seg;
  }
  if (best.off > OFF_ROUTE_NM) return null;
  return { off: best.off, done: best.done, left: Math.max(0, along - best.done), total: along, ahead: [best.q, ...pts.slice(best.i + 1)] };
}
// A polyline's length (nm).
export function lengthNm(pts) { let s = 0; for (let i = 1; i < pts.length; i++) s += distNm(pts[i - 1], pts[i]); return s; }
