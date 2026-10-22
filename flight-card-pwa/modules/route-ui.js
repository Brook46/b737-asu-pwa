// route-ui.js — the Route info screen: a map of the route with the diversion
// airports along it, coloured and numbered by their 0–10 rating, a list in
// route order, and a card per airport (runways, navaids, weather for the time
// you'd be passing, NOTAMs). The rating itself lives in route-info.js.
//
// Weather is fetched when the screen is opened (if the copy is over 15 min
// old and there's a connection), on Update, and automatically from an hour
// before departure until arrival (autoUpdate, called on the app's 10-minute
// tick) — so whatever was last fetched is on the device for the flight.

import * as storage from './storage.js?v=161';
import * as ri from './route-info.js?v=161';
import { legTs, nearestHm } from './dates.js?v=161';
import { toast, showOverlay, hideOverlay } from './ui.js?v=161';

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
  // Codes are labelled best-first and skipped where they'd sit on top of
  // one already placed — a long route's pins crowd at full-route scale;
  // zoom in (pinch / wheel) and every pin is still there to tap.
  const placed = [];
  const labelled = new Set();
  for (const c of list.slice().sort((a, b) => (b.isEnd - a.isEnd) || b.r.score - a.r.score)) {
    const x = proj.x(c.lonDraw), y = proj.y(c.ap.lat);
    if (placed.some(([px, py]) => Math.abs(px - x) < 30 && Math.abs(py - y) < 22)) continue;
    placed.push([x, y]);
    labelled.add(c);
  }
  const rad = list.length > 30 ? 8.5 : 10;
  const pins = list.slice().sort((a, b) => a.r.score - b.r.score).map(c => {
    const x = proj.x(c.lonDraw).toFixed(1), y = proj.y(c.ap.lat).toFixed(1);
    const b = ri.band(c.r.score, c.r.excluded);
    return `<g class="ri-pin ri-b-${b}${c.isEnd ? ' is-end' : ''}" data-icao="${esc(c.ap.icao)}" transform="translate(${x},${y})">
        <circle r="${rad}"/><text y="3.6">${c.r.excluded ? '×' : c.r.score}</text>
        ${labelled.has(c) ? `<text class="ri-pin-code" y="${-rad - 4}">${esc(c.ap.iata || c.ap.icao)}</text>` : ''}</g>`;
  }).join('');
  mapGeom = { W, H: H2, proj };
  return `<svg id="ri-map" class="ri-map" viewBox="0 0 ${W} ${H2}" role="img" aria-label="Route with diversion airports — pinch or scroll to zoom">
      <rect width="${W}" height="${H2}" class="lb-sea"/>
      ${land.map(dd => `<path d="${dd}" class="lb-land"/>`).join('')}
      <path d="${track}" class="ri-track"/>
      ${pins}
    </svg>`;
}

// ---------- Airport card ----------
function wxLine(w) {
  if (!w || !w.src) return 'No forecast covering that time.';
  const ceil = Number.isFinite(w.ceil) ? `ceiling ${Math.round(w.ceil).toLocaleString('en-US')} ft` : 'no ceiling';
  const vis = Number.isFinite(w.vis) ? (w.vis >= 9999 ? 'vis 10 km+' : `vis ${(w.vis / 1000).toFixed(w.vis < 5000 ? 1 : 0)} km`) : '';
  const wind = (w.wspd || w.wgst) ? `wind ${w.wdir == null ? 'VRB' : String(w.wdir).padStart(3, '0')}/${w.wspd}${w.wgst ? 'G' + w.wgst : ''} kt` : 'wind calm';
  return [ceil, vis, wind, w.wx].filter(Boolean).join(' · ');
}
function cardHtml(c, m) {
  const ap = c.ap, r = c.r, b = ri.band(r.score, r.excluded);
  const rwys = ap.rwy.map(x => `<tr><td>${esc(x[0])}</td><td>${x[1].toLocaleString('en-US')} × ${x[2] || '—'} ft</td><td>${x[4] ? 'lit' : ''}</td></tr>`).join('');
  const nav = ap.nav.length ? ap.nav.map(n => `${esc(n[0])} ${esc(n[1])} ${esc(n[2])}`).join(' · ') : 'none listed';
  const metar = c.wxEntry?.metar?.raw, taf = c.wxEntry?.taf?.raw;
  const fl = r.flags;
  const notamTxt = m.notamsOff ? 'Not checked — add the free FAA NOTAM key (Settings → Route info).'
    : !c.notams ? 'Not fetched for this airport (only the best 30 are checked).'
    : fl && (fl.adClosed || fl.rwyClosed.length || fl.ilsOut.length)
      ? [fl.adClosed ? 'AERODROME CLOSED' : '', fl.rwyClosed.length ? 'RWY ' + fl.rwyClosed.join(', ') + ' closed' : '',
         fl.ilsOut.length ? 'ILS/LOC unserviceable' : ''].filter(Boolean).join(' · ')
      : `${fl ? fl.count : 0} in force — none closing the aerodrome, a runway or an ILS.`;
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
      <table class="ri-rwy"><tbody>${rwys}</tbody></table>
      ${r.xw ? `<div class="ri-sub">Best for the forecast wind: RWY ${esc(r.xw.rwy)} — crosswind ${r.xw.xw} kt, ${r.xw.hw >= 0 ? 'headwind' : 'tailwind'} ${Math.abs(r.xw.hw)} kt</div>` : ''}
      <h5>Approaches</h5>
      <div class="ri-sub">Navaids: ${nav}</div>
      <div class="ri-sub">ILS / CAT I-II-III: not in any free data — check the chart.</div>
      <h5>Weather at ${hm(c.eta)}${r.wx && r.wx.src ? ' (' + r.wx.src + ')' : ''}</h5>
      <div>${esc(wxLine(r.wx))}</div>
      ${metar ? `<pre class="ri-raw">${esc(metar)}</pre>` : ''}
      ${taf ? `<pre class="ri-raw">${esc(taf)}</pre>` : ''}
      <h5>NOTAMs</h5>
      <div class="ri-sub">${esc(notamTxt)}</div>
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
  if (svg) { wireZoom(svg); pinScale(svg, mapGeom ? mapGeom.W : 720); }
}
function openCard(icao) {
  if (!state) return;
  const c = state.model.pool.find(x => x.ap.icao === icao);
  const slot = $('ri-card-slot');
  if (!c || !slot) return;
  slot.innerHTML = cardHtml(c, state.model);
  document.querySelectorAll('.ri-pin.is-sel').forEach(p => p.classList.remove('is-sel'));
  document.querySelector(`.ri-pin[data-icao="${icao}"]`)?.classList.add('is-sel');
  slot.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  if (mapGeom) {
    const x = mapGeom.proj.x(c.lonDraw), y = mapGeom.proj.y(c.ap.lat);
    const w = Math.min(mapGeom.W, 260), h = w * mapGeom.H / mapGeom.W;
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
  const w = Math.max(W / 8, Math.min(W, v.w)), h = w * Hh / W;
  const x = Math.max(0, Math.min(W - w, v.x)), y = Math.max(0, Math.min(Hh - h, v.y));
  svg.setAttribute('viewBox', `${x.toFixed(1)} ${y.toFixed(1)} ${w.toFixed(1)} ${h.toFixed(1)}`);
  pinScale(svg, w);
}
// Pins hold one on-screen size — about 18 px across — whatever the zoom and
// however wide the map is drawn (a phone draws the 720-unit map at ~340 px,
// which shrank them to dots). Pins are drawn at ~9 units, so k = units/px.
function pinScale(svg, vbW) {
  const px = svg.getBoundingClientRect().width || mapGeom?.W || 720;
  const k = Math.max(0.35, Math.min(2.4, vbW / px));
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
    if (!$('route-overlay').classList.contains('hidden')) await paint(model, state?.showAll);
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
  $('route-overlay')?.addEventListener('click', (e) => {
    if (e.target.id === 'route-overlay') { hideOverlay('route-overlay'); return; }
    if (e.target.closest('[data-ri-close]')) { $('ri-card-slot').innerHTML = ''; return; }
    if (e.target.closest('[data-ri-all]')) { if (state) paint(state.model, !state.showAll); return; }
    const hit = e.target.closest('[data-icao]');
    if (hit && !hit.classList.contains('ri-card')) openCard(hit.dataset.icao);
  });
}
