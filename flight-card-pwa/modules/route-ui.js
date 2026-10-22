// route-ui.js — the Route info screen: a map of the route with the diversion
// airports along it, coloured and numbered by their 0–10 rating, a list in
// route order, and a card per airport (runways, navaids, weather for the time
// you'd be passing, NOTAMs). The rating itself lives in route-info.js.
//
// Weather is fetched when the screen is opened (if the copy is over 15 min
// old and there's a connection), on Update, and automatically from an hour
// before departure until arrival (autoUpdate, called on the app's 10-minute
// tick) — so whatever was last fetched is on the device for the flight.

import * as storage from './storage.js?v=163';
import * as ri from './route-info.js?v=163';
import { legTs, nearestHm } from './dates.js?v=163';
import { toast, showOverlay, hideOverlay } from './ui.js?v=163';

const FRESH_MS = 15 * 60 * 1000;
const H = 3600000;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = (ms) => Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 16) + 'Z' : '—';

let state = null;        // { key, model } of what's on screen
let mapGeom = null;      // { W, H, proj } of the drawn map, for zoom
let busy = false;

function activeLeg() { return storage.getLegs()[storage.getLegIndex()] || null; }
function legKey(leg) {
  const f = String(leg?.flight || '').replace(/\D/g, '').replace(/^0+/, '');
  return `fc.route.${f}@${leg?.dep_date || ''}.${leg?.dep_year || ''}.${leg?.dep || ''}${leg?.arr || ''}`;
}
function readCache(leg) {
  try { return JSON.parse(localStorage.getItem(legKey(leg)) || 'null'); } catch { return null; }
}
function writeCache(leg, data) {
  try {
    // Keep only the last few routes — a weather set is ~100 KB.
    const keys = Object.keys(localStorage).filter(k => k.startsWith('fc.route.') && k !== legKey(leg));
    const dated = keys.map(k => { try { return [k, JSON.parse(localStorage.getItem(k)).at || 0]; } catch { return [k, 0]; } })
      .sort((a, b) => b[1] - a[1]);
    for (const [k] of dated.slice(3)) localStorage.removeItem(k);
    localStorage.setItem(legKey(leg), JSON.stringify(data));
  } catch {}
}
function taxiMinutes(code) {
  try { const v = parseInt(localStorage.getItem('fc.taxi.' + code), 10); if (v >= 1 && v <= 60) return v; } catch {}
  return 15;
}

// ---------- Model ----------
// Everything the screen shows, from the leg + the database + whatever
// weather / NOTAMs are cached (fetching first when `doFetch` is set).
async function build(leg, { doFetch = false } = {}) {
  const db = await ri.loadDb();
  const A = ri.findAirport(db, leg.dep), B = ri.findAirport(db, leg.arr);
  if (!A || !B) throw new Error(`${!A ? leg.dep : leg.arr || '—'} isn't in the airport database`);
  const route = ri.routePoints(A, B);
  const d = leg.dataCard || {};
  const stdMs = legTs(leg.dep_date, leg.dep_time, leg.dep_year);
  const ctotMs = nearestHm(d.ctot || leg.ctot, stdMs);
  const tm = ri.timing(leg, route.total, { taxiOut: taxiMinutes(String(leg.dep || '').toUpperCase()), ctotMs, stdMs });
  const rules = ri.getCountryRules();
  const all = ri.candidates(db, route).map(c => ({
    ...c, eta: tm.etaAt(c.along), isEnd: c.ap.icao === A.icao || c.ap.icao === B.icao,
  }));
  // First pass without weather picks who's worth asking about.
  for (const c of all) c.r = ri.rate(c.ap, { distNm: c.distNm, eta: c.eta, wxEntry: null, notams: null, rules });
  const pool = ri.pickShown(all, route, 6);
  let cache = readCache(leg);
  if (doFetch) {
    const ids = pool.map(c => c.ap.icao);
    const wx = await ri.fetchWeather(ids);
    // NOTAMs for the best 30 — the API is per airport.
    const top = pool.filter(c => !c.r.excluded).sort((a, b) => b.r.score - a.r.score).slice(0, 30).map(c => c.ap.icao);
    let notams = null, notamsOff = false;
    try { const n = await ri.fetchNotams(top); if (n.off) notamsOff = true; else notams = n.notams; }
    catch { notamsOff = true; }
    cache = { at: Date.now(), wx, notams, notamsOff };
    writeCache(leg, cache);
  }
  const wmap = new Map();
  for (const m of cache?.wx?.metars || []) wmap.set(m.id, { metar: m });
  for (const t of cache?.wx?.tafs || []) wmap.set(t.id, { ...(wmap.get(t.id) || {}), taf: t });
  for (const c of pool) {
    const n = cache?.notams ? cache.notams[c.ap.icao] : null;
    c.wxEntry = wmap.get(c.ap.icao) || null;
    c.notams = Array.isArray(n) ? n : null;
    c.r = ri.rate(c.ap, { distNm: c.distNm, eta: c.eta, wxEntry: c.wxEntry, notams: c.notams, rules });
  }
  // Stretches with no usable airport within the hour (open ocean): the
  // route points whose nearest non-excluded candidate is beyond the radius.
  const usable = all.filter(c => !c.r.excluded && c.r.score > 0);
  const gaps = [];
  let open = null;
  for (const p of route.pts) {
    const near = usable.some(c => Math.abs(c.along - p.s) < ri.RADIUS_NM * 1.6
      && Math.hypot((c.ap.lat - p.lat), (c.lonDraw - p.lon) * Math.cos(p.lat * Math.PI / 180)) * 60 <= ri.RADIUS_NM);
    if (!near && !open) open = { from: p.s };
    if (near && open) { open.to = p.s; gaps.push(open); open = null; }
  }
  if (open) { open.to = route.total; gaps.push(open); }
  return {
    dbDate: db.v,
    leg, A, B, route, tm, pool, gaps: gaps.filter(g => g.to - g.from > 40),
    shown: ri.pickShown(pool, route, 4),
    fetchedAt: cache?.at || 0,
    notamsOff: !cache || cache.notamsOff || !cache.notams,
    hasWx: !!cache?.wx,
  };
}

// ---------- Map ----------
function mapSvg(m, list, world) {
  const W = 720, H2 = 420;
  const pts = m.route.pts.map(p => [p.lon, p.lat]).concat(list.map(c => [c.lonDraw, c.ap.lat]));
  let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
  for (const [lon, lat] of pts) {
    minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
  }
  // Same true-shape framing as the logbook map: one scale both ways.
  const cLat0 = (minLat + maxLat) / 2;
  const k = Math.cos(Math.max(-60, Math.min(60, cLat0)) * Math.PI / 180);
  let spanX = Math.max((maxLon - minLon) * k * 1.12, 8), spanY = Math.max((maxLat - minLat) * 1.12 + 2, 6);
  if (spanX / spanY > W / H2) spanY = spanX * H2 / W; else spanX = spanY * W / H2;
  let cLat = cLat0;
  if (cLat + spanY / 2 > 84) cLat = 84 - spanY / 2;
  if (cLat - spanY / 2 < -84) cLat = -84 + spanY / 2;
  const view = { cLon: (minLon + maxLon) / 2, cLat, spanLon: spanX / k, spanLat: Math.min(spanY, 160) };
  const proj = world.projector({ x0: 0, y0: 0, w: W, h: H2, ...view });
  let land = world.landPaths(proj, view);
  for (const shift of [-360, 360]) {
    const v2 = { ...view, cLon: view.cLon + shift };
    if (Math.abs(v2.cLon) - v2.spanLon / 2 > 180) continue;
    land = land.concat(world.landPaths({ x: (lon) => proj.x(lon - shift), y: proj.y }, v2));
  }
  const track = 'M' + m.route.pts.map(p => `${proj.x(p.lon).toFixed(1)},${proj.y(p.lat).toFixed(1)}`).join('L');
  // Every pin carries its ICAO code and its name; relabel() shows as many as
  // fit at the current zoom (best first) — zoom in and more appear, closer
  // still and the names join them. Pins stay one size on screen throughout.
  const rad = 9;
  const pinData = [];
  const pins = list.slice().sort((a, b) => a.r.score - b.r.score).map(c => {
    const x = proj.x(c.lonDraw), y = proj.y(c.ap.lat);
    const b = ri.band(c.r.score, c.r.excluded);
    pinData.push({ icao: c.ap.icao, x, y, pri: (c.isEnd ? 100 : 0) + (c.r.excluded ? -1 : c.r.score),
                   nameLen: shortName(c.ap).length });
    return `<g class="ri-pin ri-b-${b}${c.isEnd ? ' is-end' : ''}" data-icao="${esc(c.ap.icao)}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
        <circle r="${rad}"/><text y="3.6">${c.r.excluded ? '×' : c.r.score}</text>
        <text class="ri-pin-code" y="${-rad - 4}">${esc(c.ap.icao)}</text>
        <text class="ri-pin-name" y="${rad + 11}">${esc(shortName(c.ap))}</text></g>`;
  }).join('');
  mapGeom = { W, H: H2, proj, pins: pinData };
  return `<svg id="ri-map" class="ri-map" viewBox="0 0 ${W} ${H2}" role="img" aria-label="Route with diversion airports — pinch or scroll to zoom">
      <rect width="${W}" height="${H2}" class="lb-sea"/>
      ${land.map(dd => `<path d="${dd}" class="lb-land"/>`).join('')}
      <path d="${track}" class="ri-track"/>
      ${pins}
    </svg>`;
}

// A short airport name for map labels: the city, else the name without
// "International Airport" and the like.
function shortName(ap) {
  const n = String(ap.name || '').replace(/\b(International|Intl|Airport|Air Base|Aeroporto|Aéroport|Flughafen)\b/gi, '').replace(/\s+/g, ' ').trim();
  const city = String(ap.city || '').replace(/\s*[(,].*$/, '').trim();
  return (city || n).slice(0, 22);
}

// Show labels that fit, in screen pixels, best first.
function relabel() {
  const svg = $('ri-map');
  if (!svg || !mapGeom || !mapGeom.pins) return;
  const rect = svg.getBoundingClientRect();
  if (!rect.width) return;
  const v = getViewBox();
  const sx = rect.width / v.w, sy = rect.height / v.h;
  const zoomed = v.w <= mapGeom.W * 0.45;
  const boxes = [];
  const free = (b) => !boxes.some(o => b.x < o.x + o.w && o.x < b.x + b.w && b.y < o.y + o.h && o.y < b.y + b.h);
  // Pins themselves are obstacles for labels.
  const pts = mapGeom.pins.map(p => ({ ...p, sx: (p.x - v.x) * sx, sy: (p.y - v.y) * sy }));
  for (const p of pts) boxes.push({ x: p.sx - 9, y: p.sy - 9, w: 18, h: 18 });
  for (const p of pts.slice().sort((a, b) => b.pri - a.pri)) {
    const g = svg.querySelector(`.ri-pin[data-icao="${p.icao}"]`);
    if (!g) continue;
    const inView = p.sx > -20 && p.sx < rect.width + 20 && p.sy > -20 && p.sy < rect.height + 20;
    const code = { x: p.sx - 17, y: p.sy - 25, w: 34, h: 12 };
    const showCode = inView && free(code);
    if (showCode) boxes.push(code);
    const nw = p.nameLen * 5.6 + 6;
    const name = { x: p.sx - nw / 2, y: p.sy + 11, w: nw, h: 12 };
    const showName = inView && zoomed && free(name);
    if (showName) boxes.push(name);
    g.classList.toggle('show-code', showCode);
    g.classList.toggle('show-name', showName);
  }
}

// ---------- Airport card ----------
// Colour scale shared by the decoded line, the raw METAR/TAF and the wind:
//   g green  — nothing to think about: CAVOK / 10 km+, ceiling 1,500 ft+
//   y yellow — marginal: under 1,500 m or a ceiling under 500 ft
//   o orange — below CAT I (550 m / 200 ft): only a CAT II/III ILS gets in;
//              fog, snow, freezing drizzle; crosswind over 25 kt
//   r red    — below any 737 approach (CAT IIIA, RVR 200 m); thunderstorm,
//              hail, freezing rain, sand/dust storm; crosswind over 33 kt
// Approach categories aren't in the data, so "below minima" means below the
// best a 737 can do — with only a VOR approach, orange is already too low.
function visBand(m) {
  if (!Number.isFinite(m)) return '';
  return m < 200 ? 'r' : m < 550 ? 'o' : m < 1500 ? 'y' : m >= 5000 ? 'g' : '';
}
function ceilBand(ft) {
  if (!Number.isFinite(ft)) return 'g';
  return ft < 200 ? 'o' : ft < 500 ? 'y' : ft >= 1500 ? 'g' : '';
}
function wxPhenBand(w) {
  const t = String(w || '').toUpperCase();
  if (/TS|GR|FZRA|\+SN|SS|DS|FC|VA/.test(t)) return 'r';
  if (/FG|SN|FZDZ|PL|\+RA|SQ/.test(t)) return 'o';
  return '';
}
function xwBand(kt) { return kt > 33 ? 'r' : kt > 25 ? 'o' : ''; }
const RANK = { r: 4, o: 3, y: 2, '': 1, g: 0 };
function worst(...bands) { return bands.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'g'); }

// Crosswind from a wind token against the airport's usable runways.
function xwFor(rwys, dir, spd) {
  if (dir == null || !spd) return 0;
  let best = Infinity;
  for (const r of rwys) {
    if (r[3] == null) continue;
    for (const h of [r[3], (r[3] + 180) % 360]) {
      const a = (dir - h) * Math.PI / 180;
      if (Math.cos(a) * spd < -10) continue;
      best = Math.min(best, Math.abs(Math.sin(a)) * spd);
    }
  }
  return Number.isFinite(best) ? Math.round(best) : 0;
}

// Raw METAR / TAF with each meaningful group coloured.
function colourRaw(raw, rwys) {
  return String(raw || '').split(/(\s+)/).map(tok => {
    if (/^\s+$/.test(tok) || !tok) return tok;
    const T = tok.toUpperCase();
    let b = null;
    if (/^(CAVOK|NSC|SKC|CLR|NCD)$/.test(T)) b = 'g';
    else if (/^\d{4}$/.test(T)) b = visBand(+T === 9999 ? 10000 : +T);
    else if (/^P6SM$/.test(T)) b = 'g';
    else if (/^(\d{1,2})SM$/.test(T)) b = visBand(parseInt(T, 10) * 1609);
    else if (/^M?\d\/\dSM$/.test(T)) b = visBand(0.5 * 1609);
    else if (/^R\d{2}[LRC]?\/[PM]?(\d{4})/.test(T)) b = visBand(+/^R\d{2}[LRC]?\/[PM]?(\d{4})/.exec(T)[1]);
    else if (/^(BKN|OVC|VV)(\d{3})/.test(T)) {
      const base = +/^(?:BKN|OVC|VV)(\d{3})/.exec(T)[1] * 100;
      b = /CB|TCU/.test(T) ? 'o' : ceilBand(base);
    }
    else if (/^(FEW|SCT)\d{3}(CB|TCU)$/.test(T)) b = 'o';
    else if (/^(\d{3}|VRB)(\d{2,3})(G(\d{2,3}))?(KT|MPS)$/.test(T)) {
      const m = /^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/.exec(T);
      const k = m[4] === 'MPS' ? 1.944 : 1;
      const spd = Math.max(+m[2], +(m[3] || 0)) * k;
      b = m[1] === 'VRB' ? (spd > 25 ? 'o' : '') : xwBand(xwFor(rwys, +m[1], spd));
    }
    else if (/^[-+]?(VC)?(MI|BC|PR|DR|BL|SH|TS|FZ)?(DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)+$/.test(T)
          || /^[-+]?TS$/.test(T)) b = wxPhenBand(T) || null;
    return b ? `<span class="wx-${b}">${esc(tok)}</span>` : esc(tok);
  }).join('');
}

function wxSummary(w, xw) {
  if (!w || !w.src) return { band: '', html: 'No forecast covering that time.' };
  const ceilB = ceilBand(w.ceil), visB = visBand(w.vis), phB = wxPhenBand(w.wx), xB = xw ? xwBand(xw.xw) : '';
  const part = (b, t) => t ? `<span class="wx-${b || 'n'}">${esc(t)}</span>` : '';
  const ceil = Number.isFinite(w.ceil) ? `ceiling ${Math.round(w.ceil).toLocaleString('en-US')} ft` : 'no ceiling';
  const vis = Number.isFinite(w.vis) ? (w.vis >= 9999 ? 'vis 10 km+' : `vis ${w.vis >= 5000 ? Math.round(w.vis / 1000) + ' km' : Math.round(w.vis) + ' m'}`) : '';
  const wind = (w.wspd || w.wgst) ? `wind ${w.wdir == null ? 'VRB' : String(w.wdir).padStart(3, '0')}/${w.wspd}${w.wgst ? 'G' + w.wgst : ''} kt` : 'wind calm';
  // No significant weather and a light crosswind are good news, not neutral.
  const band = worst(ceilB, visB, phB || 'g', xB || (xw && xw.xw > 15 ? '' : 'g'));
  const verdict = { g: 'Good', y: 'Marginal', o: 'Below CAT I — CAT II/III ILS only', r: 'Below 737 minima / hazardous', '': 'Workable' }[band];
  return {
    band,
    html: `<span class="wx-pill wx-bg-${band || 'n'}">${verdict}</span> ${[part(ceilB, ceil), part(visB, vis), part(xB, wind), part(phB, w.wx)].filter(Boolean).join(' · ')}`,
  };
}

// The airport's runways to scale, north up, from the database's threshold
// positions — drawn like a chart: runway strips with a centreline, a bar at
// any displaced threshold, the designators turned to lie along each runway,
// the LDA written alongside it (on the side away from the other runways),
// and the best landing end for the forecast wind as a filled pill. Runways
// closed by NOTAM are red. A standard wind barb, in its own colour, sits top
// right with the wind written beneath it in the same colour.
const FT = 0.3048;
function upright(deg) { let a = ((deg % 360) + 360) % 360; if (a > 90 && a <= 270) a -= 180; return a; }
function windBarb(x, y, dir, spd, gst) {
  const th = dir * Math.PI / 180;
  const v = [Math.sin(th), -Math.cos(th)];            // towards where it blows FROM
  const perp = [-v[1], v[0]];                          // barbs on the clockwise side
  const L = 30, tip = [x + v[0] * L, y + v[1] * L];
  let s = Math.round((spd || 0) / 5) * 5, d = 0, out = '';
  const at = (k) => [tip[0] - v[0] * k, tip[1] - v[1] * k];
  while (s >= 50) {                                    // pennants
    const [px, py] = at(d), [qx, qy] = at(d + 6);
    out += `<path d="M${px.toFixed(1)},${py.toFixed(1)} L${(px + perp[0] * 11).toFixed(1)},${(py + perp[1] * 11).toFixed(1)} L${qx.toFixed(1)},${qy.toFixed(1)} Z" class="rd-barb-f"/>`;
    s -= 50; d += 8;
  }
  while (s >= 10) {                                    // full barbs
    const [px, py] = at(d);
    out += `<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${(px + perp[0] * 12 + v[0] * 4).toFixed(1)}" y2="${(py + perp[1] * 12 + v[1] * 4).toFixed(1)}"/>`;
    s -= 10; d += 5;
  }
  if (s >= 5) {                                        // half barb
    const [px, py] = at(d || 4);
    out += `<line x1="${px.toFixed(1)}" y1="${py.toFixed(1)}" x2="${(px + perp[0] * 6 + v[0] * 2).toFixed(1)}" y2="${(py + perp[1] * 6 + v[1] * 2).toFixed(1)}"/>`;
  }
  const label = `${String(dir).padStart(3, '0')}°/${spd}${gst ? 'G' + gst : ''} kt`;
  return `<g class="rd-wind"><circle cx="${x}" cy="${y}" r="3"/>
      <line x1="${x}" y1="${y}" x2="${tip[0].toFixed(1)}" y2="${tip[1].toFixed(1)}"/>${out}</g>
    <text x="${x}" y="${y + 46}" class="rd-wtxt">${label}</text>`;
}
function runwayDiagram(c) {
  const ap = c.ap, rw = ap.rwy;
  if (!rw.length) return '';
  const W = 360, Hh = 250, PAD = 50;
  const lat0 = ap.lat, lon0 = ap.lon, kx = Math.cos(lat0 * Math.PI / 180) * 111320, ky = 110540;
  const segs = rw.map((r, i) => {
    let a, b;
    if (r[5] != null && r[8] != null) {
      a = [(r[6] - lon0) * kx, (r[5] - lat0) * ky];
      b = [(r[8] - lon0) * kx, (r[7] - lat0) * ky];
    } else {
      // No threshold positions: through the middle on its heading, side by side.
      const L = r[1] * FT, h = (r[3] ?? 0) * Math.PI / 180, off = (i - (rw.length - 1) / 2) * 500;
      a = [-Math.sin(h) * L / 2 + off, -Math.cos(h) * L / 2];
      b = [Math.sin(h) * L / 2 + off, Math.cos(h) * L / 2];
    }
    return { r, a, b };
  });
  const xs = segs.flatMap(s => [s.a[0], s.b[0]]), ys = segs.flatMap(s => [s.a[1], s.b[1]]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, (maxY - minY) * (W - 2 * PAD) / (Hh - 2 * PAD), 1500);
  const sc = (W - 2 * PAD) / span;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const P = ([x, y]) => [W / 2 + (x - cx) * sc, Hh / 2 - (y - cy) * sc];
  const closed = new Set((c.r.flags && c.r.flags.rwyClosed) || []);
  const bestEnd = c.r.xw ? c.r.xw.rwy : null;
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const strips = [], labels = [];
  const geo = segs.map(({ a, b }) => [P(a), P(b)]);
  // Distance from a point to the nearest OTHER runway's centreline (px).
  const clearance = (pt, self) => {
    let best = Infinity;
    geo.forEach(([s1, s2], i) => {
      if (i === self) return;
      const dx = s2[0] - s1[0], dy = s2[1] - s1[1], L2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((pt[0] - s1[0]) * dx + (pt[1] - s1[1]) * dy) / L2));
      best = Math.min(best, Math.hypot(pt[0] - (s1[0] + t * dx), pt[1] - (s1[1] + t * dy)));
    });
    return best;
  };
  for (const [idx, { r, a, b }] of segs.entries()) {
    const p1 = P(a), p2 = P(b);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) || 1;
    const u = [(p2[0] - p1[0]) / len, (p2[1] - p1[1]) / len], n = [-u[1], u[0]];
    const hw = Math.max(3, Math.min(7, (r[2] || 148) * FT * sc / 2));
    const ends = String(r[0]).split('/');
    const isClosed = closed.has(r[0]) || ends.some(e => closed.has(e));
    const cls = isClosed ? 'rd-closed' : r[1] < 5500 ? 'rd-short' : 'rd-rwy';
    const q = (pt, k) => `${(pt[0] + n[0] * k).toFixed(1)},${(pt[1] + n[1] * k).toFixed(1)}`;
    strips.push(`<polygon points="${q(p1, hw)} ${q(p2, hw)} ${q(p2, -hw)} ${q(p1, -hw)}" class="${cls}"/>`);
    if (len > 50 && !isClosed) {
      strips.push(`<line x1="${(p1[0] + u[0] * 8).toFixed(1)}" y1="${(p1[1] + u[1] * 8).toFixed(1)}" x2="${(p2[0] - u[0] * 8).toFixed(1)}" y2="${(p2[1] - u[1] * 8).toFixed(1)}" class="rd-cl"/>`);
    }
    // Displaced thresholds: a bar across the runway where landing starts.
    for (const [disp, pt, sgn] of [[r[9], p1, 1], [r[10], p2, -1]]) {
      if (!(disp > 0)) continue;
      const k = disp * FT * sc, t = [pt[0] + u[0] * k * sgn, pt[1] + u[1] * k * sgn];
      strips.push(`<line x1="${(t[0] + n[0] * (hw + 2)).toFixed(1)}" y1="${(t[1] + n[1] * (hw + 2)).toFixed(1)}" x2="${(t[0] - n[0] * (hw + 2)).toFixed(1)}" y2="${(t[1] - n[1] * (hw + 2)).toFixed(1)}" class="rd-dthr"/>`);
    }
    if (isClosed) {
      const m = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
      labels.push(`<text x="${m[0].toFixed(1)}" y="${m[1].toFixed(1)}" class="rd-clsd" transform="rotate(${upright(Math.atan2(u[1], u[0]) * 180 / Math.PI).toFixed(1)} ${m[0].toFixed(1)} ${m[1].toFixed(1)})">CLOSED</text>`);
    }
    // Designators beyond each threshold, lying along the runway.
    const ang = upright(Math.atan2(u[1], u[0]) * 180 / Math.PI);
    for (const [id, pt, sgn] of [[ends[0], p1, -1], [ends[1], p2, 1]]) {
      if (!id) continue;
      const t = [pt[0] + u[0] * 14 * sgn, pt[1] + u[1] * 14 * sgn];
      const best = id === bestEnd;
      labels.push(`<g transform="translate(${t[0].toFixed(1)},${t[1].toFixed(1)}) rotate(${ang.toFixed(1)})">
          ${best ? `<rect x="-14" y="-8" width="28" height="16" rx="8" class="rd-best-pill"/>` : ''}
          <text y="3.6" class="rd-id${best ? ' is-best' : ''}">${esc(id)}</text></g>`);
    }
    // LDA alongside, on whichever side has more room from the other runways
    // (close parallels); with no room either side it stays in the table only.
    const mid = [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    const off = hw + 8;
    const cand = [1, -1].map(sd => {
      const pt = [mid[0] + n[0] * sd * off, mid[1] + n[1] * sd * off];
      const q1 = [pt[0] - u[0] * len * 0.3, pt[1] - u[1] * len * 0.3], q2 = [pt[0] + u[0] * len * 0.3, pt[1] + u[1] * len * 0.3];
      return { pt, room: Math.min(clearance(pt, idx), clearance(q1, idx), clearance(q2, idx)) };
    }).sort((x, y) => y.room - x.room)[0];
    const lp = cand.pt;
    const lda1 = r[1] - (r[9] || 0), lda2 = r[1] - (r[10] || 0);
    const ldaTxt = lda1 === lda2 || !ends[1] ? `LDA ${fmt(lda1)} ft`
      : `LDA ${ends[0]} ${fmt(lda1)} · ${ends[1]} ${fmt(lda2)} ft`;
    if (len > 60 && cand.room > 9) labels.push(`<text x="${lp[0].toFixed(1)}" y="${(lp[1] + 3).toFixed(1)}" class="rd-lda" transform="rotate(${ang.toFixed(1)} ${lp[0].toFixed(1)} ${lp[1].toFixed(1)})">${esc(ldaTxt)}</text>`);
  }
  const w = c.r.wx;
  const barb = (w && w.src && w.wdir != null && (w.wspd || w.wgst)) ? windBarb(W - 36, 34, w.wdir, w.wspd || 0, w.wgst) : '';
  return `<svg class="rd" viewBox="0 0 ${W} ${Hh}" role="img" aria-label="Runway diagram, north up">
      <text x="16" y="18" class="rd-n">N</text><path d="M16,22 L11,34 L16,30 L21,34 Z" class="rd-np"/>
      ${strips.join('')}${labels.join('')}${barb}
    </svg>`;
}

// The big NOTAM items, as red tags under the diagram: aerodrome closed,
// runways closed, ILS / LOC / GP out. Everything else stays in the list.
function bigNotamTags(c) {
  const f = c.r.flags;
  if (!f) return '';
  const tags = [];
  if (f.adClosed) tags.push('AERODROME CLOSED');
  for (const rw of f.rwyClosed) tags.push(`RWY ${rw} CLOSED`);
  for (const t of f.ilsOut) {
    const m = /\b(ILS|LOC|LLZ|GP|GS)\b[^.]*?\bRWY\s*(\d{2}[LRC]?)/.exec(t) || /\bRWY\s*(\d{2}[LRC]?)\b[^.]*?\b(ILS|LOC|LLZ|GP|GS)\b/.exec(t);
    const sys = m ? (/^\d/.test(m[1]) ? m[2] : m[1]) : 'ILS';
    const rwy = m ? (/^\d/.test(m[1]) ? m[1] : m[2]) : '';
    tags.push(`${sys}${rwy ? ' ' + rwy : ''} U/S`);
  }
  return tags.length ? `<div class="rd-tags">${[...new Set(tags)].map(t => `<span class="rd-tag">⛔ ${esc(t)}</span>`).join('')}</div>` : '';
}
function surfaceText(rw) {
  const SURF = { ASP: 'asphalt', ASPH: 'asphalt', ASPHALT: 'asphalt', CON: 'concrete', CONC: 'concrete', CONCRETE: 'concrete', PEM: 'part asphalt / concrete', BIT: 'bitumen', MAC: 'macadam' };
  const COND = { E: 'excellent', G: 'good', F: 'fair', P: 'poor' };
  const s = String(rw[11] || '').toUpperCase();
  const [base, cond] = s.split('-');
  return [SURF[base] || base.toLowerCase(), COND[cond] ? COND[cond] + ' condition' : ''].filter(Boolean).join(', ');
}

function notamList(c, m) {
  if (m.notamsOff) return `<div class="ri-sub">Not checked — add the free FAA NOTAM key (Settings → Route info).</div>`;
  if (!c.notams) return `<div class="ri-sub">Not fetched for this airport (only the best 30 are checked).</div>`;
  const usable = new Set((c.r.usable || []).flatMap(r => String(r[0]).split('/')));
  const now = c.eta;
  const live = c.notams.filter(n => {
    const st = Date.parse(n.start), en = Date.parse(n.end);
    return !(Number.isFinite(st) && st > now) && !(Number.isFinite(en) && en < now);
  }).map(n => ({ ...n, sev: ri.notamSeverity(n.text, usable) }))
    .sort((a, b) => RANK[b.sev] - RANK[a.sev]);
  if (!live.length) return `<div class="ri-sub"><span class="wx-g">None in force at ${hm(now)}.</span></div>`;
  const item = (n) => `<li class="nt nt-${n.sev || 'n'}">${esc(n.text)}</li>`;
  const top = live.filter(n => n.sev), rest = live.filter(n => !n.sev);
  return `<ul class="nt-list">${top.map(item).join('')}</ul>
    ${rest.length ? `<details class="nt-more"><summary>${rest.length} other NOTAM${rest.length === 1 ? '' : 's'}</summary><ul class="nt-list">${rest.map(item).join('')}</ul></details>` : ''}
    ${!top.length ? `<div class="ri-sub"><span class="wx-g">Nothing closing the aerodrome, a runway or an ILS.</span></div>` : ''}`;
}

function cardHtml(c, m) {
  const ap = c.ap, r = c.r, b = ri.band(r.score, r.excluded);
  const usable = (r.usable && r.usable.length) ? r.usable : ap.rwy;
  const rwys = ap.rwy.map(x => `<tr class="${x[1] < 5500 ? 'rd-row-short' : ''}"><td>${esc(x[0])}</td><td>${x[1].toLocaleString('en-US')} × ${x[2] || '—'} ft</td><td>${x[4] ? 'lit' : ''}</td><td>${esc(surfaceText(x))}</td></tr>`).join('');
  const nav = ap.nav.length ? ap.nav.map(n => `${esc(n[0])} ${esc(n[1])} ${esc(n[2])}`).join(' · ') : 'none listed';
  const metar = c.wxEntry?.metar?.raw, taf = c.wxEntry?.taf?.raw;
  const ws = wxSummary(r.wx, r.xw);
  return `<div class="ri-card" data-icao="${esc(ap.icao)}">
      <div class="ri-card-head">
        <span class="ri-score ri-b-${b}">${r.excluded ? '×' : r.score}</span>
        <div><b>${esc(ap.icao)}${ap.iata ? ' · ' + esc(ap.iata) : ''}</b> ${esc(ap.name)}
          <div class="ri-sub">${esc(ap.city)}${ap.city ? ', ' : ''}${esc(ap.country)} · ${ap.size === 2 ? 'large' : 'medium'} airport · elev ${ap.elev.toLocaleString('en-US')} ft</div></div>
        <button type="button" class="ri-card-x" data-ri-close aria-label="Close">✕</button>
      </div>
      <div class="ri-sub">Abeam ≈ ${hm(c.eta)} · ${Math.round(c.distNm)} nm off the route</div>
      ${r.why && r.why.length ? `<ul class="ri-why">${r.why.map(w => `<li>${esc(w)}</li>`).join('')}</ul>` : ''}
      <h5>Runways</h5>
      ${runwayDiagram(c)}
      ${bigNotamTags(c)}
      <table class="ri-rwy"><tbody>${rwys}</tbody></table>
      <div class="ri-upd">Runway data: OurAirports, ${esc(m.dbDate || '—')} · LDA ≈ length − displaced threshold · grooving / friction treatment isn't in the free data</div>
      ${r.xw ? `<div class="ri-sub">Best for the forecast wind: <b class="rd-best-t">RWY ${esc(r.xw.rwy)}</b> — <span class="rd-wind-t">crosswind ${r.xw.xw} kt, ${r.xw.hw >= 0 ? 'headwind' : 'tailwind'} ${Math.abs(r.xw.hw)} kt</span>${xwBand(r.xw.xw) ? ` <span class="wx-${xwBand(r.xw.xw)}">(${xwBand(r.xw.xw) === 'r' ? 'over 33 kt' : 'over 25 kt'})</span>` : ''}</div>` : ''}
      <h5>Approaches</h5>
      <div class="ri-sub">Navaids: ${nav}</div>
      <div class="ri-sub">ILS / CAT I-II-III: not in any free data — check the chart.</div>
      <h5>Weather at ${hm(c.eta)}${r.wx && r.wx.src ? ' (' + r.wx.src + ')' : ''}</h5>
      <div class="ri-upd">${m.fetchedAt ? `Fetched ${hm(m.fetchedAt)} (${ago(m.fetchedAt)}) from aviationweather.gov` : 'Not fetched yet — tap Update'}${c.wxEntry?.metar?.time ? ` · METAR issued ${hm(c.wxEntry.metar.time * 1000)}` : ''}</div>
      <div class="ri-wx">${ws.html}</div>
      ${metar ? `<pre class="ri-raw">${colourRaw(metar, usable)}</pre>` : ''}
      ${taf ? `<pre class="ri-raw">${colourRaw(taf, usable)}</pre>` : ''}
      <div class="ri-key"><span class="wx-g">good</span> · <span class="wx-y">marginal</span> · <span class="wx-o">below CAT I</span> · <span class="wx-r">below 737 minima / hazard</span></div>
      <h5>NOTAMs</h5>
      ${notamList(c, m)}
    </div>`;
}

// ---------- Screen ----------
function ago(ms) {
  if (!ms) return 'never';
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}
async function paint(model, showAll = false) {
  const world = await import('./worldmap.js?v=160');
  const list = showAll ? model.pool : model.shown;
  const counts = { a: 0, b: 0, c: 0, d: 0, x: 0 };
  for (const c of list) counts[ri.band(c.r.score, c.r.excluded)]++;
  $('route-sub').textContent = `${model.A.iata || model.A.icao} → ${model.B.iata || model.B.icao} · ${Math.round(model.route.total).toLocaleString('en-US')} nm · take-off ≈ ${hm(model.tm.takeoff)}`;
  const rows = list.map(c => {
    const b = ri.band(c.r.score, c.r.excluded);
    return `<button type="button" class="ri-row" data-icao="${esc(c.ap.icao)}">
        <span class="ri-row-t">${hm(c.eta).replace('Z', '')}</span>
        <span class="ri-score ri-b-${b}">${c.r.excluded ? '×' : c.r.score}</span>
        <span class="ri-row-n"><b>${esc(c.ap.iata || c.ap.icao)}</b> ${esc(c.ap.city || c.ap.name)} <i>${esc(c.ap.cc)}</i></span>
        <span class="ri-row-d">${Math.round(c.distNm)} nm</span>
      </button>`;
  }).join('');
  $('route-body').innerHTML = `
    <div class="ri-status">
      Weather ${model.hasWx ? 'fetched ' + ago(model.fetchedAt) : 'not fetched yet'} ·
      NOTAMs ${model.notamsOff ? 'not checked' : 'checked'} ·
      within an hour (${ri.RADIUS_NM} nm) of the great-circle route
    </div>
    ${model.gaps.length ? `<div class="ri-gap">No airport within an hour: ${model.gaps.map(g =>
      `${hm(model.tm.etaAt(g.from))}–${hm(model.tm.etaAt(g.to))}`).join(', ')}</div>` : ''}
    ${mapSvg(model, list, world)}
    <div class="ri-legend">
      <span><i class="ri-dot ri-b-a"></i>8–10 ${counts.a}</span><span><i class="ri-dot ri-b-b"></i>6–7 ${counts.b}</span>
      <span><i class="ri-dot ri-b-c"></i>4–5 ${counts.c}</span><span><i class="ri-dot ri-b-d"></i>1–3 ${counts.d}</span>
      <span><i class="ri-dot ri-b-x"></i>no-go ${counts.x}</span>
      <button type="button" class="ri-all" data-ri-all>${showAll ? 'Best per stretch' : `Show all ${model.pool.length}`}</button>
    </div>
    <div id="ri-card-slot"></div>
    <div class="ri-list">${rows}</div>`;
  state = { model, showAll };
  const svg = $('ri-map');
  if (svg) { wireZoom(svg); pinScale(svg, mapGeom ? mapGeom.W : 720); relabel(); }
}
function openCard(icao, { keepView = false } = {}) {
  if (!state) return;
  const c = state.model.pool.find(x => x.ap.icao === icao);
  const slot = $('ri-card-slot');
  if (!c || !slot) return;
  slot.innerHTML = cardHtml(c, state.model);
  document.querySelectorAll('.ri-pin.is-sel').forEach(p => p.classList.remove('is-sel'));
  document.querySelector(`.ri-pin[data-icao="${icao}"]`)?.classList.add('is-sel');
  if (keepView) return;
  slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (mapGeom) {
    const x = mapGeom.proj.x(c.lonDraw), y = mapGeom.proj.y(c.ap.lat);
    // A close look around the airport — about 600 nm across whatever the
    // route's length, so its neighbours are named and the rest drop out.
    const nmPerUnit = state.model.route.total / Math.max(1, Math.hypot(
      mapGeom.proj.x(state.model.B.lon) - mapGeom.proj.x(state.model.A.lon),
      mapGeom.proj.y(state.model.B.lat) - mapGeom.proj.y(state.model.A.lat)));
    const w = Math.max(mapGeom.W / 24, Math.min(mapGeom.W, 600 / (nmPerUnit || 1))), h = w * mapGeom.H / mapGeom.W;
    setViewBox({ x: x - w / 2, y: y - h / 2, w, h });
  }
}

// ---------- Zoom & pan ----------
// Pinch (two fingers) or scroll to zoom, drag to pan, double-tap to see the
// whole route again. Works on the SVG viewBox, so pins and text stay sharp.
function getViewBox() {
  const svg = $('ri-map');
  const [x, y, w, h] = (svg?.getAttribute('viewBox') || '0 0 720 420').split(/\s+/).map(Number);
  return { x, y, w, h };
}
function setViewBox(v) {
  const svg = $('ri-map');
  if (!svg || !mapGeom) return;
  const W = mapGeom.W, Hh = mapGeom.H;
  const w = Math.max(W / 24, Math.min(W, v.w)), h = w * Hh / W;
  const x = Math.max(0, Math.min(W - w, v.x)), y = Math.max(0, Math.min(Hh - h, v.y));
  svg.setAttribute('viewBox', `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
  pinScale(svg, w);
  relabel();
}
// Pins hold one on-screen size — about 18 px across — whatever the zoom and
// however wide the map is drawn (a phone draws the 720-unit map at ~340 px,
// which shrank them to dots). Pins are drawn at ~9 units, so k = units/px.
function pinScale(svg, vbW) {
  const px = svg.getBoundingClientRect().width || mapGeom?.W || 720;
  const k = Math.max(0.02, Math.min(2.4, vbW / px));
  svg.style.setProperty('--ri-k', k.toFixed(3));
}
function wireZoom(svg) {
  const pts = new Map();
  let start = null, lastTap = 0;
  const toSvg = (cx, cy) => {
    const r = svg.getBoundingClientRect(), v = getViewBox();
    return { x: v.x + (cx - r.left) / r.width * v.w, y: v.y + (cy - r.top) / r.height * v.h };
  };
  svg.addEventListener('wheel', (e) => {
    e.preventDefault();
    const v = getViewBox(), p = toSvg(e.clientX, e.clientY);
    const f = Math.exp(e.deltaY * 0.0015);
    setViewBox({ x: p.x - (p.x - v.x) * f, y: p.y - (p.y - v.y) * f, w: v.w * f, h: v.h * f });
  }, { passive: false });
  svg.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) {
      const now = Date.now();
      if (now - lastTap < 300 && !e.target.closest('.ri-pin')) { setViewBox({ x: 0, y: 0, w: mapGeom.W, h: mapGeom.H }); }
      lastTap = now;
    }
    start = { v: getViewBox(), pts: new Map([...pts].map(([k, p]) => [k, { ...p }])) };
  });
  svg.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = svg.getBoundingClientRect();
    const [a, b] = [...pts.values()], [a0, b0] = [...start.pts.values()];
    if (pts.size >= 2 && a0 && b0) {
      e.preventDefault();
      const d0 = Math.hypot(a0.x - b0.x, a0.y - b0.y), d1 = Math.hypot(a.x - b.x, a.y - b.y);
      const f = d1 > 0 ? d0 / d1 : 1;
      const mx = ((a0.x + b0.x) / 2 - r.left) / r.width, my = ((a0.y + b0.y) / 2 - r.top) / r.height;
      const v = start.v, w = v.w * f, h = v.h * f;
      setViewBox({ x: v.x + mx * v.w - mx * w, y: v.y + my * v.h - my * h, w, h });
    } else if (pts.size === 1 && a0) {
      const dx = (a.x - a0.x) / r.width * start.v.w, dy = (a.y - a0.y) / r.height * start.v.h;
      if (Math.abs(a.x - a0.x) + Math.abs(a.y - a0.y) > 4) setViewBox({ ...start.v, x: start.v.x - dx, y: start.v.y - dy });
    }
  });
  const end = (e) => { pts.delete(e.pointerId); start = pts.size ? { v: getViewBox(), pts: new Map([...pts].map(([k, p]) => [k, { ...p }])) } : null; };
  svg.addEventListener('pointerup', end);
  svg.addEventListener('pointercancel', end);
}

export async function open() {
  const leg = activeLeg();
  if (!leg || !leg.dep || !leg.arr) { toast('Route info needs a leg with departure and destination'); return; }
  showOverlay('route-overlay');
  $('route-body').innerHTML = '<p class="muted small" style="padding:18px 4px;">Plotting the route…</p>';
  try {
    const cache = readCache(leg);
    const stale = !cache || Date.now() - cache.at > FRESH_MS;
    // Show what's on the device straight away, then refresh if it's old.
    await paint(await build(leg, { doFetch: false }));
    if (stale && navigator.onLine !== false) await refresh(false);
  } catch (err) {
    $('route-body').innerHTML = `<p class="muted small" style="padding:18px 4px;">${esc(err.message || err)}</p>`;
  }
}
export async function refresh(announce = true) {
  const leg = activeLeg();
  if (!leg || busy) return;
  busy = true;
  const btn = $('route-refresh');
  if (btn) { btn.disabled = true; btn.textContent = 'Updating…'; }
  try {
    const model = await build(leg, { doFetch: true });
    if (!$('route-overlay').classList.contains('hidden')) {
      // A background refresh must not throw away what's being looked at:
      // keep the open airport card and the map's zoom across the repaint.
      const sel = document.querySelector('#ri-card-slot .ri-card')?.dataset.icao || null;
      const vb = $('ri-map') ? getViewBox() : null;
      const scroll = document.querySelector('.route-sheet')?.scrollTop || 0;
      await paint(model, state?.showAll);
      if (sel) openCard(sel, { keepView: true });
      if (vb) setViewBox(vb);
      const sh = document.querySelector('.route-sheet'); if (sh) sh.scrollTop = scroll;
    }
    if (announce) toast('Route weather updated');
  } catch (err) {
    if (announce) toast('Update failed — showing the last copy (' + (err.message || err) + ')');
  } finally {
    busy = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Update'; }
  }
}

// From an hour before departure until arrival, keep the route's weather
// fresh in the background (every 15 min, when there's a connection) — so the
// latest picture is on the device whether or not the screen was opened.
export async function autoUpdate() {
  const leg = activeLeg();
  if (!leg || !leg.dep || !leg.arr || busy || navigator.onLine === false) return;
  const std = legTs(leg.dep_date, leg.dep_time, leg.dep_year);
  const sta = legTs(leg.arr_date, leg.arr_time, leg.arr_year || leg.dep_year);
  if (!Number.isFinite(std)) return;
  const now = Date.now();
  const end = Number.isFinite(sta) ? sta + 15 * 60000 : std + 12 * H;
  if (now < std - 65 * 60000 || now > end) return;
  const cache = readCache(leg);
  if (cache && now - cache.at < FRESH_MS) return;
  await refresh(false);
}

// Wiring — once, on first import.
let wired = false;
export function wire() {
  if (wired) return;
  wired = true;
  $('route-close')?.addEventListener('click', () => hideOverlay('route-overlay'));
  $('route-refresh')?.addEventListener('click', () => refresh(true));
  // Full screen, remembered on this device — like the notes.
  const sheet = document.querySelector('.route-sheet');
  const setFull = (on) => {
    sheet?.classList.toggle('is-full', on);
    const b = $('route-full');
    if (b) { b.textContent = on ? '⤡' : '⤢'; b.setAttribute('aria-pressed', String(on)); }
    try { localStorage.setItem('fc.route.full', on ? '1' : ''); } catch {}
    requestAnimationFrame(() => { const svg = $('ri-map'); if (svg) { pinScale(svg, getViewBox().w); relabel(); } });
  };
  try { setFull(localStorage.getItem('fc.route.full') === '1'); } catch {}
  $('route-full')?.addEventListener('click', () => setFull(!sheet.classList.contains('is-full')));
  window.addEventListener('resize', () => { const svg = $('ri-map'); if (svg) { pinScale(svg, getViewBox().w); relabel(); } });
  $('route-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'route-overlay') { hideOverlay('route-overlay'); return; }
    if (e.target.closest('[data-ri-close]')) { $('ri-card-slot').innerHTML = ''; return; }
    if (e.target.closest('[data-ri-all]')) { if (state) paint(state.model, !state.showAll); return; }
    const hit = e.target.closest('[data-icao]');
    if (hit && !hit.classList.contains('ri-card')) openCard(hit.dataset.icao);
  });
}
