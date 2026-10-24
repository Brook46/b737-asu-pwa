// route-ui.js — the Route info screen: a map of the route with the diversion
// airports along it, coloured and numbered by their 0–10 rating, a list in
// route order, and a card per airport (runways, navaids, weather for the time
// you'd be passing, NOTAMs). The rating itself lives in route-info.js.
//
// Weather is fetched when the screen is opened (if the copy is over 15 min
// old and there's a connection), on Update, and automatically from an hour
// before departure until arrival (autoUpdate, called on the app's 10-minute
// tick) — so whatever was last fetched is on the device for the flight.

import * as storage from './storage.js?v=177';
import * as ri from './route-info.js?v=177';
import { legTs, nearestHm } from './dates.js?v=177';
import { toast, showOverlay, hideOverlay, raiseOverlay } from './ui.js?v=177';

const FRESH_MS = 15 * 60 * 1000;
const H = 3600000;
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hm = (ms) => Number.isFinite(ms) ? new Date(ms).toISOString().slice(11, 16) + 'Z' : '—';

let state = null;        // { key, model } of what's on screen
let mapGeom = null;      // { W, H, proj } of the drawn map, for zoom
const selEnd = new Map(); // ICAO → the runway end the pilot picked (default: best for the wind)
let gpsWatch = null;      // geolocation watch id while the screen is open
let gpsFix = null;        // { lat, lon, altFt, gs, trk, at, airborne }
let gpsPrev = null;
let livePaintAt = 0;
const srcPick = new Map(); // ICAO → 'metar' | 'taf' when the pilot chose the source by hand
let listOrder = null;      // 'gps' (nearest to the aircraft) | 'route'; default: gps once GPS has a fix
let listKey = '';          // the order last drawn, so live GPS only redraws when it changes
let busy = false;

function activeLeg() { return storage.getLegs()[storage.getLegIndex()] || null; }
// The flight the screen was opened for. A calendar sync can move the app's
// selected leg underneath an open screen (it used to jump to "the leg for
// now"), so while Route info is open every refresh works on THIS flight,
// found again by identity, never on whatever is selected at that moment.
let pinned = null;
// A flight opened from the logbook / History lives outside the current leg
// list (an earlier duty, the CSV backfill) — keep the object itself too.
let pinnedLeg = null;
const idOf = (l) => [l.flight, l.dep_date, l.dep_year, l.dep, l.arr].map(v => String(v ?? '')).join('|');
function screenLeg() {
  if (pinned && !$('route-overlay')?.classList.contains('hidden')) {
    const hit = storage.getLegs().find(l => idOf(l) === pinned);
    if (hit) return hit;
    if (pinnedLeg) return pinnedLeg;
  }
  return activeLeg();
}
// Where you are relative to this flight decides which weather is useful
// (route-info.js wxAt): 'browse' when the flight isn't today — more than
// 12 h before departure or over an hour after arrival — else 'plan'.
function contextFor(leg, stdMs) {
  const d = leg.dataCard || {};
  let sta = legTs(leg.arr_date, leg.arr_time, leg.arr_year || leg.dep_year);
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(d.block_time || leg.flight_time || ''));
  if (!Number.isFinite(sta) && Number.isFinite(stdMs)) sta = stdMs + (m ? ((+m[1]) * 60 + (+m[2])) : 300) * 60000;
  const now = Date.now();
  if (!Number.isFinite(stdMs)) return 'browse';
  return (now < stdMs - 12 * H || now > sta + H) ? 'browse' : 'plan';
}
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
  const mode = contextFor(leg, stdMs);
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
    // A failed NOTAM fetch keeps the last good set (marked with its age)
    // rather than blanking what the pilot already had.
    let notams = null, notamsOff = false, notamsErr = '', notamsAt = Date.now();
    try { const n = await ri.fetchNotams(top); if (n.off) notamsOff = true; else notams = n.notams; }
    catch (e) {
      notamsErr = String(e.message || e);
      if (cache?.notams) { notams = cache.notams; notamsAt = cache.notamsAt || cache.at; }
      else notamsOff = true;
    }
    cache = { at: Date.now(), wx, notams, notamsOff, notamsErr, notamsAt };
    writeCache(leg, cache);
  }
  const wmap = new Map();
  for (const m of cache?.wx?.metars || []) wmap.set(m.id, { metar: m });
  for (const t of cache?.wx?.tafs || []) wmap.set(t.id, { ...(wmap.get(t.id) || {}), taf: t });
  for (const c of pool) {
    const n = cache?.notams ? cache.notams[c.ap.icao] : null;
    c.wxEntry = wmap.get(c.ap.icao) || null;
    c.notams = Array.isArray(n) ? n : null;
    c.r = ri.rate(c.ap, { distNm: c.distNm, eta: c.eta, wxEntry: c.wxEntry, notams: c.notams, rules, mode });
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
    mode,
    dbDate: db.v,
    leg, A, B, route, tm, pool, gaps: gaps.filter(g => g.to - g.from > 40),
    shown: ri.pickShown(pool, route, 4),
    fetchedAt: cache?.at || 0,
    notamsOff: !cache || cache.notamsOff || !cache.notams,
    notamsErr: cache?.notamsErr || '',
    notamsAt: cache?.notamsAt || cache?.at || 0,
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
      <g id="ri-iso"></g>
      ${pins}
      <g id="ri-ac"></g>
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
function windBarb(x, y, dir, spd, gst, srcLabel = '') {
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
    <text x="${x}" y="${y + 46}" class="rd-wtxt">${label}</text>
    ${srcLabel ? `<text x="${x}" y="${y + 58}" class="rd-wsrc">${esc(srcLabel)}</text>` : ''}`;
}
function runwayDiagram(c) {
  const ap = c.ap, rw = ap.rwy;
  if (!rw.length) return '';
  // The right-hand column is kept for the wind barb; runways and their
  // labels are laid out in the area to its left.
  const W = 380, Hh = 260, PAD = 46, WIND_COL = 76, DW = W - WIND_COL;
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
  const span = Math.max(maxX - minX, (maxY - minY) * (DW - 2 * PAD) / (Hh - 2 * PAD), 1500);
  const sc = (DW - 2 * PAD) / span;
  const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
  const P = ([x, y]) => [DW / 2 + (x - cx) * sc, Hh / 2 - (y - cy) * sc];
  const closed = new Set((c.r.flags && c.r.flags.rwyClosed) || []);
  const bestEnd = c.r.xw ? c.r.xw.rwy : null;
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  const strips = [], labels = [], endLabels = [];
  const geo = segs.map(({ a, b }) => [P(a), P(b)]);
  for (const { r, a, b } of segs) {
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
    // Runway ends are labelled after all strips are known (below), so the
    // labels can be placed clear of each other — Ben Gurion's 26 and 21
    // thresholds are ~150 m apart and used to print on top of each other.
    const ang = upright(Math.atan2(u[1], u[0]) * 180 / Math.PI);
    for (const [id, pt, sgn, disp] of [[ends[0], p1, -1, r[9]], [ends[1], p2, 1, r[10]]]) {
      if (!id) continue;
      endLabels.push({ id, pt, d: [u[0] * sgn, u[1] * sgn], ang, lda: r[1] - (disp || 0) });
    }
  }
  // Each end: the designator in a box (like the painted marking) with that
  // direction's LDA in small muted type directly beneath it — so a number in
  // a box is always a runway, and a length always belongs to the box above.
  // Tried outward from the threshold at growing distances, then nudged
  // sideways, until it clears every label already placed.
  const placed = [];
  const selId = selEnd.get(ap.icao) || bestEnd;
  for (const e of endLabels) {
    let pos = null;
    outer: for (const dist of [18, 32, 46, 60, 74]) {
      for (const side of [0, 1, -1, 2, -2]) {
        const x = e.pt[0] + e.d[0] * dist - e.d[1] * side * 16, y = e.pt[1] + e.d[1] * dist + e.d[0] * side * 16;
        if (x < 20 || x > DW - 4 || y < 18 || y > Hh - 22) continue;
        // The box AND its LDA line beneath (~50 × 30 px) must stay clear.
        if (placed.some(([px, py]) => Math.hypot(px - x, py - y) < 40)) continue;
        if (geo.some(([s1, s2]) => {
          const dx = s2[0] - s1[0], dy = s2[1] - s1[1], L2 = dx * dx + dy * dy || 1;
          const t = Math.max(0, Math.min(1, ((x - s1[0]) * dx + (y - s1[1]) * dy) / L2));
          return Math.hypot(x - (s1[0] + t * dx), y - (s1[1] + t * dy)) < 11;
        })) continue;
        pos = [x, y]; break outer;
      }
    }
    if (!pos) pos = [e.pt[0] + e.d[0] * 18, e.pt[1] + e.d[1] * 18];
    placed.push(pos);
    const isSel = e.id === selId, isBest = e.id === bestEnd;
    labels.push(`<g class="rd-end${isSel ? ' is-sel' : ''}${isBest ? ' is-best' : ''}" data-rw-end="${esc(e.id)}" transform="translate(${pos[0].toFixed(1)},${pos[1].toFixed(1)}) rotate(${e.ang.toFixed(1)})">
        <rect x="-14" y="-9" width="28" height="17" rx="3" class="rd-idbox"/>
        <text y="3.8" class="rd-id">${esc(e.id)}</text>
        <text y="18" class="rd-lda">LDA ${fmt(e.lda)}</text></g>`);
  }
  const w = c.r.wind && c.r.wind.src ? c.r.wind : c.r.wx;
  const wsrc = w && w.src ? (w.src === 'METAR' ? `METAR ${w.at ? hm(w.at) : ''}` : `TAF ${hm(c.eta)}`) : '';
  const barb = (w && w.src && w.wdir != null && (w.wspd || w.wgst)) ? windBarb(W - WIND_COL / 2, 44, w.wdir, w.wspd || 0, w.wgst, wsrc) : '';
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

// Head / tail and cross components for one runway end (headings and winds
// are both true). Gusts give the worst-case crosswind.
function components(hdg, w) {
  if (!w || w.wdir == null || !(w.wspd || w.wgst)) return null;
  const a = (w.wdir - hdg) * Math.PI / 180;
  const sp = w.wspd || 0, gs = w.wgst || 0;
  return {
    head: Math.round(Math.cos(a) * sp),
    cross: Math.round(Math.abs(Math.sin(a)) * sp),
    side: Math.sin(a) > 0 ? 'right' : 'left',
    gustCross: gs ? Math.round(Math.abs(Math.sin(a)) * gs) : 0,
    gustHead: gs ? Math.round(Math.cos(a) * gs) : 0,
  };
}
function runwayEnds(ap) {
  const out = [];
  for (const r of ap.rwy) {
    const ends = String(r[0]).split('/');
    ends.forEach((id, i) => {
      if (!id) return;
      out.push({ id, r, hdg: r[3] == null ? null : (i === 0 ? r[3] : (r[3] + 180) % 360),
                 lda: r[1] - ((i === 0 ? r[9] : r[10]) || 0), disp: (i === 0 ? r[9] : r[10]) || 0 });
    });
  }
  return out;
}
// The runway picker: one chip per runway end (★ = best for the forecast
// wind), and the chosen end's details — wind components, LDA, surface,
// approaches, and the NOTAMs that name it.
// One line above the diagram: which runway to use with the best wind there
// is for the moment you're looking (METAR when browsing or close, the TAF
// for the abeam time when planning), its components, and where the wind
// came from.
function bestRunwayLine(c) {
  const w = c.r.wind && c.r.wind.src ? c.r.wind : c.r.wx;
  const longest = (c.r.usable && c.r.usable[0]) ? c.r.usable[0][0] : (c.ap.rwy[0] || [''])[0];
  if (!w || !w.src) return `<div class="rd-bestline">No wind for this time — pick a runway below.</div>`;
  const src = w.src === 'METAR' ? `METAR ${w.at ? hm(w.at) : ''}`.trim() : `TAF for ${hm(c.eta)}`;
  if (!(w.wspd || w.wgst)) return `<div class="rd-bestline">Wind calm <span class="rw-src">(${esc(src)})</span> — any runway; longest is ${esc(longest)}.</div>`;
  if (w.wdir == null) return `<div class="rd-bestline">Wind variable ${w.wspd}${w.wgst ? 'G' + w.wgst : ''} kt <span class="rw-src">(${esc(src)})</span> — no preferred runway; longest is ${esc(longest)}.</div>`;
  const best = c.r.xw && runwayEnds(c.ap).find(e => e.id === c.r.xw.rwy);
  if (!best) return '';
  const k = components(best.hdg, w);
  const hw = k.head >= 0 ? `headwind ${k.head} kt` : `<span class="wx-o">tailwind ${-k.head} kt</span>`;
  const xb = xwBand(Math.max(k.cross, k.gustCross));
  return `<div class="rd-bestline">Best runway now: <span class="rw-box">${esc(best.id)}</span>
      <span class="rd-wind-t">${String(w.wdir).padStart(3, '0')}°/${w.wspd}${w.wgst ? 'G' + w.wgst : ''} kt</span> — ${hw} ·
      <span class="${xb ? 'wx-' + xb : 'rd-wind-t'}">crosswind ${k.cross} kt from the ${k.side}${k.gustCross ? `, ${k.gustCross} in gusts` : ''}</span>
      <span class="rw-src">(${esc(src)})</span></div>`;
}

function runwayPanel(c, m) {
  const ap = c.ap, w = c.r.wind && c.r.wind.src ? c.r.wind : c.r.wx;
  const ends = runwayEnds(ap);
  if (!ends.length) return '';
  const best = c.r.xw ? c.r.xw.rwy : null;
  const selId = selEnd.get(ap.icao) || best || ends[0].id;
  const sel = ends.find(e => e.id === selId) || ends[0];
  const chips = ends.map(e => {
    const k = e.hdg == null ? null : components(e.hdg, w);
    const tone = k ? (k.head < -10 || xwBand(Math.max(k.cross, k.gustCross)) === 'r' ? 'r'
      : k.head < 0 || xwBand(Math.max(k.cross, k.gustCross)) === 'o' ? 'o' : '') : '';
    return `<button type="button" class="rw-chip${e.id === sel.id ? ' is-sel' : ''}${tone ? ' t-' + tone : ''}" data-rw-end="${esc(e.id)}">${esc(e.id)}${e.id === best ? ' ★' : ''}</button>`;
  }).join('');
  const k = sel.hdg == null ? null : components(sel.hdg, w);
  const fmt = (n) => Math.round(n).toLocaleString('en-US');
  let windLine = 'No forecast wind for that time.';
  if (k) {
    const hwTxt = k.head >= 0 ? `headwind ${k.head} kt` : `<span class="wx-${k.head < -10 ? 'r' : 'o'}">tailwind ${-k.head} kt</span>`;
    const xb = xwBand(k.cross), gxb = xwBand(k.gustCross);
    const srcTxt = w.src === 'METAR' ? `METAR${w.at ? ' ' + hm(w.at) : ''} — current` : `TAF for ${hm(c.eta)}`;
    windLine = `<span class="rd-wind-t">Wind ${String(w.wdir).padStart(3, '0')}°/${w.wspd}${w.wgst ? 'G' + w.wgst : ''} kt</span> <span class="rw-src">(${srcTxt})</span>: ${hwTxt} · `
      + `<span class="${xb ? 'wx-' + xb : 'rd-wind-t'}">crosswind ${k.cross} kt from the ${k.side}</span>`
      + (k.gustCross ? ` · <span class="${gxb ? 'wx-' + gxb : 'rd-wind-t'}">gusting ${k.gustCross} kt cross</span>` : '');
  } else if (w && w.wdir == null && (w.wspd || w.wgst)) {
    windLine = `Wind variable ${w.wspd}${w.wgst ? 'G' + w.wgst : ''} kt — components can't be worked out.`;
  } else if (w && w.src) {
    windLine = 'Wind calm.';
  }
  // What the NOTAMs say about this runway (and its reciprocal): when they're
  // on, an "ILS RWY 26 …" NOTAM is also the only sign the data gives that an
  // ILS exists there at all.
  const recip = String(sel.r[0]).split('/');
  const mentions = (c.notams || []).filter(n => recip.some(id => new RegExp(`\\bRWY\\s*${id}\\b|\\b${id}\\b`).test(String(n.text).toUpperCase())));
  const usable = new Set((c.r.usable || []).flatMap(r => String(r[0]).split('/')));
  const ilsHint = (c.notams || []).some(n => new RegExp(`\\b(ILS|LOC|LLZ)\\b[^.]{0,30}\\bRWY\\s*${sel.id}\\b|\\bRWY\\s*${sel.id}\\b[^.]{0,30}\\b(ILS|LOC|LLZ)\\b`).test(String(n.text).toUpperCase()));
  const nav = ap.nav.length ? ap.nav.map(n => `${esc(n[0])} ${esc(n[1])} ${esc(n[2])}`).join(' · ') : 'none listed';
  return `<div class="rw-chips" role="group" aria-label="Pick a runway">${chips}</div>
    <div class="rw-sel">
      <div class="rw-sel-h"><span class="rw-box">${esc(sel.id)}</span>
        ${sel.hdg != null ? `${String(Math.round(sel.hdg)).padStart(3, '0')}°T · ` : ''}LDA <b>${fmt(sel.lda)} ft</b>${sel.disp ? ` (threshold displaced ${fmt(sel.disp)} ft)` : ''}
        · ${sel.r[2] || '—'} ft wide${surfaceText(sel.r) ? ' · ' + esc(surfaceText(sel.r)) : ''}${sel.r[4] ? ' · lit' : ''}${sel.r[1] < 5500 ? ' · <span class="wx-r">too short for a 737</span>' : ''}</div>
      <div>${windLine}</div>
      <div class="rw-sub"><b>Approaches:</b> ${ilsHint ? `an ILS / LOC to RWY ${esc(sel.id)} is named in a NOTAM — ` : ''}approach types and CAT I-II-III aren't in any free data — check the chart.</div>
      <div class="rw-sub"><b>Navaids at ${esc(ap.icao)}:</b> ${nav}</div>
      ${m.notamsOff ? '' : `<div class="rw-sub"><b>NOTAMs for RWY ${esc(String(sel.r[0]))}:</b> ${mentions.length
        ? `<ul class="nt-list">${mentions.map(n => ntItem(n, ri.notamSeverity(n.text, usable))).join('')}</ul>`
        : '<span class="wx-g">none</span>'}</div>`}
    </div>`;
}

// One NOTAM: its text, then a muted line with its number, validity and
// schedule (Item D) when the source gives them.
function ntItem(n, sev) {
  const day = (iso) => { const d = new Date(iso); return Number.isFinite(d.getTime()) ? `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')} ${hm(d.getTime())}` : ''; };
  const from = n.start ? day(n.start) : '', to = n.end ? day(n.end) + (n.est ? ' EST' : '') : 'PERM';
  const meta = [n.id, from ? `${from} – ${to}` : '', n.sched].filter(Boolean).join(' · ');
  return `<li class="nt nt-${sev || 'n'}">${esc(n.text)}${meta ? `<div class="nt-meta">${esc(meta)}</div>` : ''}</li>`;
}

function notamList(c, m) {
  if (m.notamsOff) return `<div class="ri-sub">${m.notamsErr
    ? `Not checked — the NOTAM service answered “${esc(m.notamsErr)}”.`
    : 'Not checked — NOTAMs aren’t set up yet (Settings → Route info).'}</div>`;
  if (!c.notams) return `<div class="ri-sub">Not fetched for this airport (only the best 30 are checked).</div>`;
  const stale = m.notamsErr ? `<div class="ri-sub"><span class="wx-o">Saved ${ago(m.notamsAt)} — refresh failed (${esc(m.notamsErr)}).</span></div>` : '';
  const usable = new Set((c.r.usable || []).flatMap(r => String(r[0]).split('/')));
  const now = c.eta;
  const live = c.notams.filter(n => {
    const st = Date.parse(n.start), en = Date.parse(n.end);
    return !(Number.isFinite(st) && st > now) && !(Number.isFinite(en) && en < now);
  }).map(n => ({ ...n, sev: ri.notamSeverity(n.text, usable) }))
    .sort((a, b) => RANK[b.sev] - RANK[a.sev]);
  if (!live.length) return `${stale}<div class="ri-sub"><span class="wx-g">None in force at ${hm(now)}.</span></div>`;
  const item = (n) => ntItem(n, n.sev);
  const top = live.filter(n => n.sev), rest = live.filter(n => !n.sev);
  return `${stale}<ul class="nt-list">${top.map(item).join('')}</ul>
    ${rest.length ? `<details class="nt-more"><summary>${rest.length} other NOTAM${rest.length === 1 ? '' : 's'}</summary><ul class="nt-list">${rest.map(item).join('')}</ul></details>` : ''}
    ${!top.length ? `<div class="ri-sub"><span class="wx-g">Nothing closing the aerodrome, a runway or an ILS.</span></div>` : ''}`;
}

// Exactly where an airport lost its points, biggest first — every part of
// the rating short of its maximum (route-info.js rate().lost).
function whyNot10(r) {
  if (r.excluded || (r.score === 0 && r.why && r.why.length)) {
    return `<ul class="ri-why is-zero">${(r.why || []).map(w => `<li>${esc(w)}</li>`).join('')}</ul>`;
  }
  if (r.score >= 10 || !r.lost || !r.lost.length) return '';
  const rows = r.lost.filter(l => l.pts >= 0.05).map(l =>
    `<li><span class="ri-lost">−${l.pts.toFixed(1).replace(/\.0$/, '')}</span>${esc(l.what)}</li>`).join('');
  return `<div class="ri-why-h">Why not 10${r.capped ? ' — capped at 3: weather below CAT I' : ''}</div><ul class="ri-why">${rows}</ul>`;
}

// Which weather the card leads with, and why — the pilot shouldn't have to
// wonder whether a number is a forecast or an observation.
function wxContext(c, m, r) {
  const src = r.wx && r.wx.src;
  if (c.picked === 'metar') return src ? 'METAR — chosen by you (tap it again for automatic)' : 'No METAR for this airport';
  if (c.picked === 'taf') return !src ? 'No TAF for this airport'
    : r.wx.forNow ? 'TAF for now — chosen by you (it doesn\'t cover that time)' : `TAF for ${hm(c.eta)} — chosen by you (tap it again for automatic)`;
  if (c.near) return `Current METAR — you're about ${Math.round(c.near)} min away`;
  if (m.mode === 'browse') return src === 'METAR'
    ? 'Current METAR — this flight isn\'t today, so its forecast doesn\'t matter yet'
    : 'No METAR — showing the TAF';
  if (src === 'METAR') return 'Current METAR — you\'d be there within the hour';
  if (src === 'TAF') return `TAF for ${hm(c.eta)} — when you'd be passing (worst case of the forecast)`;
  return 'No METAR / TAF covering that time';
}

function cardHtml(c, m) {
  // In the air with GPS and this airport within about an hour: what it has
  // NOW matters more than the forecast, so re-rate it on the METAR.
  if (gpsFix && gpsFix.airborne && c.wxEntry) {
    const t = timeTo(c.ap, gpsFix);
    if (t.min <= 60) {
      c = { ...c, near: t.min, eta: Date.now() + t.min * 60000 };
      c.r = ri.rate(c.ap, { distNm: c.distNm, eta: c.eta, wxEntry: c.wxEntry, notams: c.notams, mode: 'near' });
    }
  }
  // The pilot picked METAR or TAF by tapping it: that source drives the
  // diagram's wind, the best runway, the runway panel and the summary. The
  // rating itself stays as listed.
  const pick = srcPick.get(c.ap.icao);
  if (pick && c.wxEntry) {
    const r2 = ri.rate(c.ap, { distNm: c.distNm, eta: c.eta, wxEntry: c.wxEntry, notams: c.notams, mode: pick });
    c = { ...c, picked: pick, r: { ...c.r, wx: r2.wx, wind: r2.wind, xw: r2.xw } };
  }
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
      <div class="view-switch" role="tablist" aria-label="Airport view">
        <button type="button" class="vs-btn" role="tab" aria-selected="false" data-ri-notes>Notes</button>
        <button type="button" class="vs-btn is-on" role="tab" aria-selected="true">Diversion</button>
      </div>
      <div class="ri-sub">Abeam ≈ ${hm(c.eta)} · ${Math.round(c.distNm)} nm off the route</div>
      ${whyNot10(r)}
      <h5>Runways</h5>
      ${bestRunwayLine(c)}
      ${runwayDiagram(c)}
      ${bigNotamTags(c)}
      <table class="ri-rwy"><tbody>${rwys}</tbody></table>
      <div class="ri-upd">Runway data: OurAirports, ${esc(m.dbDate || '—')} · LDA ≈ length − displaced threshold · grooving / friction treatment isn't in the free data</div>
      <h5>Runway</h5>
      ${runwayPanel(c, m)}
      <h5>Weather</h5>
      <div class="ri-wxctx">${esc(wxContext(c, m, r))}</div>
      <div class="ri-upd">${m.fetchedAt ? `Fetched ${hm(m.fetchedAt)} (${ago(m.fetchedAt)}) from aviationweather.gov` : 'Not fetched yet — tap Update'}${c.wxEntry?.metar?.time ? ` · METAR issued ${hm(c.wxEntry.metar.time * 1000)}` : ''}</div>
      <div class="ri-wx">${ws.html}</div>
      ${(() => {
        const mt = c.wxEntry?.metar?.time ? c.wxEntry.metar.time * 1000 : null;
        // Each report is a button: tap to drive the diagram and runway from
        // it; the one in use is ringed.
        const using = r.wx && r.wx.src;
        const blk = (kind, title, raw) => `<button type="button" class="ri-rawpick${using === kind.toUpperCase() ? ' is-on' : ''}${c.picked === kind ? ' is-picked' : ''}" data-wx-pick="${kind}">
            <span class="ri-rawh">${title}${using === kind.toUpperCase() ? ' · in use' : ' · tap to use'}</span>
            <pre class="ri-raw">${colourRaw(raw, usable)}</pre></button>`;
        const mBlock = metar ? blk('metar', `METAR${mt ? ` · ${hm(mt)}, ${ago(mt)}` : ''}`, metar) : '';
        const tBlock = taf ? blk('taf', 'TAF', taf) : '';
        return using === 'TAF' ? tBlock + mBlock : mBlock + tBlock;
      })()}
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
  // A flight that isn't today carries its date, so it's clear which one this is.
  const day = (ms) => { const d = new Date(ms); return `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')}.${String(d.getUTCFullYear()).slice(-2)} `; };
  const fl = model.leg && model.leg.flight ? `${String(model.leg.flight).replace(/^0+/, '')} · ` : '';
  $('route-sub').textContent = `${fl}${model.A.iata || model.A.icao} → ${model.B.iata || model.B.icao} · ${Math.round(model.route.total).toLocaleString('en-US')} nm · take-off ≈ ${model.mode === 'browse' ? day(model.tm.takeoff) : ''}${hm(model.tm.takeoff)}`;
  $('route-body').innerHTML = `
    <div class="ri-status">
      Weather ${model.hasWx ? 'fetched ' + ago(model.fetchedAt) : 'not fetched yet'} ·
      NOTAMs ${model.notamsOff ? 'not checked' : model.notamsErr ? 'saved ' + ago(model.notamsAt) : 'checked'} ·
      within an hour (${ri.RADIUS_NM} nm) of the great-circle route
    </div>
    <div id="ri-ready" class="ri-ready"></div>
    ${model.gaps.length ? `<div class="ri-gap">No airport within an hour: ${model.gaps.map(g =>
      `${hm(model.tm.etaAt(g.from))}–${hm(model.tm.etaAt(g.to))}`).join(', ')}</div>` : ''}
    ${mapSvg(model, list, world)}
    <div class="ri-legend">
      <span><i class="ri-dot ri-b-a"></i>8–10 ${counts.a}</span><span><i class="ri-dot ri-b-b"></i>6–7 ${counts.b}</span>
      <span><i class="ri-dot ri-b-c"></i>4–5 ${counts.c}</span><span><i class="ri-dot ri-b-d"></i>1–3 ${counts.d}</span>
      <span><i class="ri-dot ri-b-x"></i>no-go ${counts.x}</span>
      <button type="button" class="ri-all" data-ri-all>${showAll ? 'Best per stretch' : `Show all ${model.pool.length}`}</button>
    </div>
    <div id="ri-near"></div>
    <div id="ri-card-slot"></div>
    <div id="ri-list-wrap"></div>`;
  state = { model, showAll };
  listKey = '';
  renderList();
  paintReady();
  const svg = $('ri-map');
  if (svg) { wireZoom(svg); pinScale(svg, mapGeom ? mapGeom.W : 720); relabel(); }
  livePaintAt = 0;
  paintLive();
}
// The airport list: in route order (time abeam), or — with a GPS fix —
// nearest to the aircraft first, with distance and where it lies from you.
// Live GPS redraws it only when the order actually changes, so a row doesn't
// jump from under your finger every few seconds.
function renderList() {
  const wrap = $('ri-list-wrap');
  if (!wrap || !state) return;
  const list = state.showAll ? state.model.pool : state.model.shown;
  const g = gpsFix;
  const order = g ? (listOrder || 'gps') : 'route';
  let rows = list;
  let info = null;
  if (order === 'gps') {
    info = new Map(list.map(c => {
      const d = distNm(g.lat, g.lon, c.ap.lat, c.ap.lon), b = brg(g.lat, g.lon, c.ap.lat, c.ap.lon);
      return [c, { d, b, t: g.airborne ? timeTo(c.ap, g) : null }];
    }));
    rows = list.slice().sort((a, b) => info.get(a).d - info.get(b).d);
  }
  const key = order + ':' + rows.map(c => c.ap.icao).join(',');
  if (key === listKey) {
    // Same order: just refresh the distances in place.
    if (info) for (const c of rows) {
      const el = wrap.querySelector(`.ri-row[data-icao="${c.ap.icao}"] .ri-row-d`);
      if (el) el.textContent = `${Math.round(info.get(c).d)} nm`;
    }
    return;
  }
  listKey = key;
  const where = (x) => {
    if (!g) return '';
    if (!g.airborne) return `brg ${String(Math.round(x.b)).padStart(3, '0')}°`;
    const rel = ((x.b - g.trk + 540) % 360) - 180;
    return Math.abs(rel) < 15 ? 'ahead' : Math.abs(rel) > 150 ? 'behind' : `${Math.round(Math.abs(rel))}° ${rel > 0 ? 'R' : 'L'}`;
  };
  const toggle = g ? `<div class="ri-order" role="group" aria-label="List order">
      <button type="button" class="${order === 'gps' ? 'is-on' : ''}" data-ri-order="gps">Nearest to aircraft</button>
      <button type="button" class="${order === 'route' ? 'is-on' : ''}" data-ri-order="route">Route order</button></div>` : '';
  wrap.innerHTML = toggle + `<div class="ri-list">${rows.map(c => {
    const b = ri.band(c.r.score, c.r.excluded);
    const x = info && info.get(c);
    return `<button type="button" class="ri-row" data-icao="${esc(c.ap.icao)}">
        <span class="ri-row-t">${x ? (x.t ? '≈' + Math.round(x.t.min) + '′' : '') : hm(c.eta).replace('Z', '')}</span>
        <span class="ri-score ri-b-${b}">${c.r.excluded ? '×' : c.r.score}</span>
        <span class="ri-row-n"><b>${esc(c.ap.iata || c.ap.icao)}</b> ${esc(c.ap.city || c.ap.name)} <i>${esc(x ? where(x) : c.ap.cc)}</i></span>
        <span class="ri-row-d">${Math.round(x ? x.d : c.distNm)} nm</span>
      </button>`;
  }).join('')}</div>`;
}

// ---------- Ready for offline ----------
// What's actually on the device for this flight, checked rather than
// assumed: the route's METARs / TAFs and how old, the Airspeed Unreliable
// app, the airport database, NOTAMs. One tap fills any gap while there's
// still a connection.
async function savedInCache(path) {
  try { return !!(await caches.match(new URL(path, location.href).href)); } catch { return false; }
}
async function paintReady() {
  const el = $('ri-ready');
  if (!el || !state) return;
  const m = state.model, leg = m.leg;
  const c = leg ? readCache(leg) : null;
  const db = await savedInCache('./data/divdb.json');
  const n = c && c.wx ? (c.wx.metars || []).length : 0;
  const ageMin = c ? (Date.now() - c.at) / 60000 : Infinity;
  const wxOk = c && ageMin <= 60;
  const item = (ok, txt, warn) => `<span class="rr-item ${ok ? 'ok' : warn ? 'warn' : 'no'}">${ok ? '✓' : warn ? '!' : '–'} ${esc(txt)}</span>`;
  const allOk = wxOk && db;
  el.innerHTML = `
    ${item(wxOk, c ? `Route weather ${ago(c.at)} · ${n} airports` : 'Route weather not saved', c && !wxOk)}
    ${item(db, db ? 'Airport data saved' : 'Airport data not saved')}
    ${item(!m.notamsOff && !m.notamsErr, m.notamsOff ? (m.notamsErr ? 'NOTAMs failed' : 'NOTAMs not set up') : m.notamsErr ? `NOTAMs ${ago(m.notamsAt)}` : 'NOTAMs checked', !m.notamsOff && !!m.notamsErr)}
    ${allOk ? '' : `<button type="button" class="btn primary rr-go" data-ri-prepare>Prepare for flight</button>`}`;
}
async function prepareForFlight() {
  if (navigator.onLine === false) { toast('No internet — prepare while you still have a connection'); return; }
  const btn = document.querySelector('[data-ri-prepare]');
  if (btn) { btn.disabled = true; btn.textContent = 'Preparing…'; }
  // ASU: its own worker (one level up) saves it into this app's storage.
  if ('serviceWorker' in navigator && /\/flight-card-pwa\//.test(location.pathname)) {
    try { await navigator.serviceWorker.register('../sw.js', { scope: '../' }); } catch {}
  }
  try { await fetch('./data/divdb.json'); } catch {}
  await refresh(false);
  // The ASU worker installs in the background; give it a moment to finish.
  for (let i = 0; i < 10 && !(await savedInCache('../data/qrh-800.json')); i++) await new Promise(r => setTimeout(r, 1000));
  await paintReady();
  toast('Ready for offline');
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

// ---------- Live: the aircraft from GPS ----------
// While the screen is open, GPS (when the device has it and it's allowed)
// puts the aircraft on the map and works out which airports are NEAREST IN
// TIME — not miles: one 30 nm straight ahead is quicker than one 30 nm
// behind (the turn), and from cruise height even a close one takes as long
// as the descent needs. Two shaded shapes show what's reachable in 30 and
// 60 minutes. A rough model, labelled as one:
//   turn at 25° bank (rate = 1091·tan25°/TAS, max 3°/s);
//   descent needs ~3 nm per 1,000 ft above the field + 10 nm to slow down,
//   so a closer airport still costs that many track miles;
//   ~85% of present ground speed (≥ 250 kt) until 30 nm out, 210 kt for the
//   last 30 nm, + 4 min to land.
const TURN_BANK_TAN = Math.tan(25 * Math.PI / 180);
function brg(lat1, lon1, lat2, lon2) {
  const f1 = lat1 * Math.PI / 180, f2 = lat2 * Math.PI / 180, dl = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dl) * Math.cos(f2), x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}
function distNm(lat1, lon1, lat2, lon2) {
  const R = Math.PI / 180;
  const a = Math.sin((lat2 - lat1) * R / 2) ** 2 + Math.cos(lat1 * R) * Math.cos(lat2 * R) * Math.sin((lon2 - lon1) * R / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a))) * 3440.065;
}
function destPoint(lat, lon, b, dNm) {
  const R = Math.PI / 180, d = dNm / 3440.065, f1 = lat * R, l1 = lon * R, th = b * R;
  const f2 = Math.asin(Math.sin(f1) * Math.cos(d) + Math.cos(f1) * Math.sin(d) * Math.cos(th));
  const l2 = l1 + Math.atan2(Math.sin(th) * Math.sin(d) * Math.cos(f1), Math.cos(d) - Math.sin(f1) * Math.sin(f2));
  return [f2 / R, l2 / R];
}
function speeds(g) {
  const tas = Math.max(250, g.gs || 0);
  return { vFar: Math.max(250, 0.85 * tas), vNear: 210, rate: Math.min(3, 1091 * TURN_BANK_TAN / tas) };
}
function minutesFor(dTrack, turnDeg, g) {
  const { vFar, vNear, rate } = speeds(g);
  const near = Math.min(dTrack, 30), far = Math.max(0, dTrack - near);
  return turnDeg / rate / 60 + far / vFar * 60 + near / vNear * 60 + 4;
}
function timeTo(ap, g) {
  const d = distNm(g.lat, g.lon, ap.lat, ap.lon);
  const b = brg(g.lat, g.lon, ap.lat, ap.lon);
  const rel = ((b - g.trk + 540) % 360) - 180;          // −180..180, + = right
  const need = Math.max(0, (g.altFt - (ap.elev || 0)) / 1000 * 3 + 10);
  return { min: minutesFor(Math.max(d, need), Math.abs(rel), g), d, rel };
}
// The edge of what's reachable in T minutes, bearing by bearing.
function isochrone(g, T) {
  const { vFar, vNear, rate } = speeds(g);
  const need = Math.max(0, g.altFt / 1000 * 3 + 10);
  const pts = [];
  for (let b = 0; b < 360; b += 5) {
    const turn = Math.abs(((b - g.trk + 540) % 360) - 180) / rate / 60;
    const left = T - 4 - turn;
    let r = 0;
    if (left > 0) {
      const tNear = 30 / vNear * 60;
      r = left <= tNear ? left / 60 * vNear : 30 + (left - tNear) / 60 * vFar;
    }
    if (r < need) r = 0;                               // can't get down in time that way
    pts.push(destPoint(g.lat, g.lon, b, r));
  }
  return pts;
}
// With no usable heading yet, assume the aircraft is flying the route.
function routeTrackNear(lat, lon) {
  const pts = state.model.route.pts;
  let bi = 0, bd = Infinity;
  pts.forEach((p, i) => { const d = distNm(lat, lon, p.lat, p.lon); if (d < bd) { bd = d; bi = i; } });
  const a = pts[Math.min(bi, pts.length - 2)], b = pts[Math.min(bi + 1, pts.length - 1)];
  return brg(a.lat, a.lon, b.lat, b.lon);
}
function onFix(pos) {
  const c = pos.coords;
  const now = pos.timestamp || Date.now();
  let trk = Number.isFinite(c.heading) && c.heading >= 0 && (c.speed || 0) > 20 ? c.heading : null;
  let gs = Number.isFinite(c.speed) && c.speed >= 0 ? c.speed * 1.94384 : null;
  if (gpsPrev) {
    const dd = distNm(gpsPrev.lat, gpsPrev.lon, c.latitude, c.longitude);
    const dt = (now - gpsPrev.at) / 3600000;
    if (trk == null && dd > 0.3) trk = brg(gpsPrev.lat, gpsPrev.lon, c.latitude, c.longitude);
    if (gs == null && dt > 0) gs = dd / dt;
  }
  if (trk == null) trk = gpsFix ? gpsFix.trk : (state ? routeTrackNear(c.latitude, c.longitude) : 0);
  gpsFix = {
    lat: c.latitude, lon: c.longitude, at: now,
    altFt: Number.isFinite(c.altitude) ? c.altitude * 3.28084 : 0,
    gs: gs || 0, trk, airborne: (gs || 0) > 80,
  };
  gpsPrev = { lat: c.latitude, lon: c.longitude, at: now };
  if (now - livePaintAt > 5000) paintLive();
}
function startGps() {
  if (gpsWatch != null || !navigator.geolocation) return;
  try {
    gpsWatch = navigator.geolocation.watchPosition(onFix, () => {}, { enableHighAccuracy: true, maximumAge: 5000, timeout: 30000 });
  } catch { gpsWatch = null; }
}
function stopGps() {
  if (gpsWatch != null) { try { navigator.geolocation.clearWatch(gpsWatch); } catch {} }
  gpsWatch = null;
}
function paintLive() {
  livePaintAt = Date.now();
  const iso = $('ri-iso'), ac = $('ri-ac'), near = $('ri-near');
  if (!iso || !ac || !mapGeom || !state) return;
  const g = gpsFix;
  if (!g) { iso.innerHTML = ''; ac.innerHTML = ''; if (near) near.innerHTML = ''; return; }
  const P = mapGeom.proj;
  const mid = (state.model.route.pts[0].lon + state.model.route.pts.at(-1).lon) / 2;
  const unwrap = (lon) => { while (lon - mid > 180) lon -= 360; while (lon - mid < -180) lon += 360; return lon; };
  const xy = ([lat, lon]) => `${P.x(unwrap(lon)).toFixed(1)},${P.y(lat).toFixed(1)}`;
  iso.innerHTML = g.airborne ? [60, 30].map(T => {
    const pts = isochrone(g, T);
    return pts.every(p => Math.abs(p[0] - g.lat) < 1e-6) ? '' : `<path d="M${pts.map(xy).join('L')}Z" class="ri-iso ri-iso-${T}"/>`;
  }).join('') : '';
  const [x, y] = xy([g.lat, g.lon]).split(',');
  ac.innerHTML = `<g class="ri-ac" transform="translate(${x},${y})"><g class="ri-ac-in" style="transform: scale(var(--ri-k,1)) rotate(${g.trk.toFixed(0)}deg)">
      <path d="M0,-11 L2,-3 L10,2 L10,4 L2,2 L1.5,8 L4,10 L4,11.5 L0,10.5 L-4,11.5 L-4,10 L-1.5,8 L-2,2 L-10,4 L-10,2 L-2,-3 Z"/></g></g>`;
  renderList();
  if (!near) return;
  if (!g.airborne) {
    near.innerHTML = `<div class="ri-near-h">GPS: on the ground — nearest-by-time appears once airborne.</div>`;
    return;
  }
  const cands = state.model.pool.filter(c => !c.r.excluded && c.r.score > 0)
    .map(c => ({ c, t: timeTo(c.ap, g) })).sort((a, b) => a.t.min - b.t.min).slice(0, 6);
  const fl = g.altFt > 1000 ? `FL${String(Math.round(g.altFt / 100)).padStart(3, '0')} · ` : '';
  near.innerHTML = `<div class="ri-near-h">Nearest by time · GPS ${fl}${Math.round(g.gs)} kt · track ${String(Math.round(g.trk)).padStart(3, '0')}° <span class="rw-src">(rough: turn + descent + approach)</span></div>
    ${cands.map(({ c, t }) => {
      const b = ri.band(c.r.score, c.r.excluded);
      const side = Math.abs(t.rel) < 15 ? 'ahead' : Math.abs(t.rel) > 150 ? 'behind' : `${Math.round(Math.abs(t.rel))}° ${t.rel > 0 ? 'right' : 'left'}`;
      return `<button type="button" class="ri-row" data-icao="${esc(c.ap.icao)}">
          <span class="ri-row-t">≈${Math.round(t.min)}′</span>
          <span class="ri-score ri-b-${b}">${c.r.score}</span>
          <span class="ri-row-n"><b>${esc(c.ap.icao)}</b> ${esc(shortName(c.ap))} <i>${esc(side)}</i></span>
          <span class="ri-row-d">${Math.round(t.d)} nm</span></button>`;
    }).join('')}`;
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

// `legArg`: a specific flight (the logbook's "Route info") — otherwise the
// leg on the main screen.
// `focus`: an airport (ICAO or IATA) whose card opens straight away — from
// the airport popup's "Diversion card" or the flight strip's nearest chip.
export async function open(legArg = null, { focus = '' } = {}) {
  const leg = legArg || activeLeg();
  pinned = leg ? idOf(leg) : null;
  pinnedLeg = legArg || null;
  if (!leg || !leg.dep || !leg.arr) { toast('Route info needs a leg with departure and destination'); return; }
  showOverlay('route-overlay');
  startGps();
  $('route-body').innerHTML = '<p class="muted small" style="padding:18px 4px;">Plotting the route…</p>';
  try {
    const cache = readCache(leg);
    const stale = !cache || Date.now() - cache.at > FRESH_MS;
    // Show what's on the device straight away, then refresh if it's old.
    await paint(await build(leg, { doFetch: false }));
    const f = String(focus || '').toUpperCase();
    const hit = f && state.model.pool.find(c => c.ap.icao === f || c.ap.iata === f);
    if (hit) openCard(hit.ap.icao);
    else if (f) toast(`${f} isn't within an hour of this route`);
    if (stale && navigator.onLine !== false) await refresh(false);
  } catch (err) {
    $('route-body').innerHTML = `<p class="muted small" style="padding:18px 4px;">${esc(err.message || err)}</p>`;
  }
}
// Resolves true once the route's weather / NOTAMs were fetched and saved.
export async function refresh(announce = true) {
  const leg = screenLeg();
  if (!leg || busy) return false;
  if (navigator.onLine === false) {
    const c = readCache(leg);
    if (announce) toast(c ? `No internet — showing the weather saved ${ago(c.at)}` : 'No internet — no weather saved for this route yet');
    return false;
  }
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
    return true;
  } catch (err) {
    if (announce) toast('Update failed — showing the last copy (' + (err.message || err) + ')');
    return false;
  } finally {
    busy = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Update'; }
  }
}

// From 12 hours before departure until arrival, keep the route's METARs and
// TAFs on the device — every 30 min, then every 15 in the last hour and en
// route, whenever there's a connection — so with no internet in the air the
// last TAF and METAR for every airport are still there to read.
export async function autoUpdate() {
  const leg = screenLeg();
  if (!leg || !leg.dep || !leg.arr || busy || navigator.onLine === false) return;
  const std = legTs(leg.dep_date, leg.dep_time, leg.dep_year);
  const sta = legTs(leg.arr_date, leg.arr_time, leg.arr_year || leg.dep_year);
  if (!Number.isFinite(std)) return;
  const now = Date.now();
  const end = Number.isFinite(sta) ? sta + 15 * 60000 : std + 12 * H;
  if (now < std - 12 * H || now > end) return;
  const cache = readCache(leg);
  const every = now >= std - 65 * 60000 ? FRESH_MS : 30 * 60000;
  if (cache && now - cache.at < every) return;
  await refresh(false);
}

// The airport quickest to reach from a GPS fix, for the flight strip's chip.
// Uses the route's saved weather (no fetching); the model is rebuilt only
// when the flight or its saved weather changes.
let nearMemo = null;
export async function nearestNow(leg, g) {
  if (!leg || !leg.dep || !leg.arr || !g) return null;
  const id = idOf(leg), c = readCache(leg), at = c ? c.at : 0;
  if (!nearMemo || nearMemo.id !== id || nearMemo.at !== at) nearMemo = { id, at, model: await build(leg, { doFetch: false }) };
  const best = nearMemo.model.pool.filter(x => !x.r.excluded && x.r.score > 0)
    .map(x => ({ x, t: timeTo(x.ap, g) })).sort((a, b) => a.t.min - b.t.min)[0];
  return best ? { icao: best.x.ap.icao, min: best.t.min, score: best.x.r.score, band: ri.band(best.x.r.score, false) } : null;
}

// Show an airport's card in the open Route info (the notes' "Diversion"
// when Route info is already open beneath them).
export function focusAirport(code) {
  const f = String(code || '').toUpperCase();
  const hit = state && f && state.model.pool.find(c => c.ap.icao === f || c.ap.iata === f);
  if (hit) openCard(hit.ap.icao);
  else if (f) toast(`${f} isn't within an hour of this route`);
}

// Wiring — once, on first import.
let wired = false;
export function wire() {
  if (wired) return;
  wired = true;
  $('route-close')?.addEventListener('click', () => { stopGps(); hideOverlay('route-overlay'); });
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
    if (e.target.id === 'route-overlay') { stopGps(); hideOverlay('route-overlay'); return; }
    if (e.target.closest('[data-ri-close]')) { $('ri-card-slot').innerHTML = ''; return; }
    if (e.target.closest('[data-ri-all]')) { if (state) paint(state.model, !state.showAll); return; }
    if (e.target.closest('[data-ri-prepare]')) { prepareForFlight(); return; }
    if (e.target.closest('[data-ri-notes]')) {
      const icao = e.target.closest('.ri-card')?.dataset.icao;
      const c = state && state.model.pool.find(x => x.ap.icao === icao);
      if (!c) return;
      // Notes are keyed the way the flight strip opens them (IATA first).
      const code = c.ap.iata || c.ap.icao;
      const leg = screenLeg();
      // The notes already open underneath (Route info was opened from them):
      // close Route info and go back down to them. Otherwise open them on
      // top, leaving Route info open beneath — closing the notes then comes
      // straight back here.
      const back = !$('airport-overlay').classList.contains('hidden');
      if (back) { stopGps(); hideOverlay('route-overlay'); }
      window.dispatchEvent(new CustomEvent('fc:airport-notes', { detail: { code, leg, back } }));
      return;
    }
    const wp = e.target.closest('[data-wx-pick]');
    if (wp) {
      const icao = wp.closest('.ri-card')?.dataset.icao;
      if (icao) {
        if (srcPick.get(icao) === wp.dataset.wxPick) srcPick.delete(icao); else srcPick.set(icao, wp.dataset.wxPick);
        openCard(icao, { keepView: true });
      }
      return;
    }
    const ord = e.target.closest('[data-ri-order]');
    if (ord) { listOrder = ord.dataset.riOrder; listKey = ''; renderList(); return; }
    const end = e.target.closest('[data-rw-end]');
    if (end) {
      const icao = end.closest('.ri-card')?.dataset.icao;
      if (icao) { selEnd.set(icao, end.dataset.rwEnd); openCard(icao, { keepView: true }); }
      return;
    }
    const hit = e.target.closest('[data-icao]');
    if (hit && !hit.classList.contains('ri-card')) openCard(hit.dataset.icao);
  });
}
