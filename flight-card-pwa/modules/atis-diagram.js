// atis-diagram.js — the airport drawn inside the ATIS window, with what the
// ATIS says is closed or broken marked on it: closed taxiways, exits and
// gates in orange, a closed runway crossed in red, an ILS out of service
// as a red tag at its runway's threshold. Each mark carries the same
// data-atis-ref as its words in the ATIS text, so tapping either lights up
// both (app.js).
//
// Runways and taxiways come from OpenStreetMap (Overpass API, keyless,
// CORS-open), fetched once per airport and kept on the device for 30 days,
// so the diagram is there offline after the first look. Names are matched
// without dashes or spaces — OSM's "AZ-3" is the ATIS's "AZ3". OSM is
// volunteer-drawn: a taxiway it doesn't name can't be shown, and the window
// lists what wasn't found rather than guessing.

// The main Overpass server, then public mirrors (all CORS-open). Overpass
// is often busy — a first answer can take most of a minute — so each gets
// time, and what comes back is kept.
const APIS = [
  ['https://overpass-api.de/api/interpreter', 90000],
  ['https://overpass.kumi.systems/api/interpreter', 40000],
  ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 40000],
];
const KEY = 'fc.aptgeo3.';
const DAYS = 30;
const norm = (s) => String(s || '').toUpperCase().replace(/[-\s]/g, '');

function readCache(icao) {
  try {
    const v = JSON.parse(localStorage.getItem(KEY + icao) || 'null');
    return v && v.at > Date.now() - DAYS * 86400000 ? v : null;
  } catch { return null; }
}
function writeCache(icao, v) {
  const put = () => localStorage.setItem(KEY + icao, JSON.stringify(v));
  try { put(); }
  catch {
    try { for (const k of Object.keys(localStorage)) if (k.startsWith(KEY) && k !== KEY + icao) localStorage.removeItem(k); put(); } catch {}
  }
}
async function overpass(q) {
  for (const [api, ms] of APIS) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(api, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: ctl.signal });
      if (r.ok) return await r.json();
    } catch {}
    finally { clearTimeout(t); }
  }
  return null;
}

// The whole airport — runways and every taxiway / taxilane — fetched once
// and kept: { lat, lon, rw: [{ ref, pts }], tw: { NORMREF: [pts, …] } }
// with pts in metres east / north of the airport reference point (unnamed
// taxiways under ''). A big airport is ~100 KB kept and a slow first ask
// (half a minute or more), so the ATIS refresh fetches it in the
// background when there are closures. `refs` is accepted for older callers.
const inflight = new Map();
export function airportGeo(icao, lat, lon) {
  if (!inflight.has(icao)) inflight.set(icao, load(icao, lat, lon).finally(() => inflight.delete(icao)));
  return inflight.get(icao);
}
// Drop points closer than `tol` metres to the line through their neighbours.
function simplify(pts, tol = 4) {
  if (pts.length < 3) return pts;
  const keep = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = keep[keep.length - 1], b = pts[i + 1], p = pts[i];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
    if (Math.abs((p[0] - a[0]) * dy - (p[1] - a[1]) * dx) / L > tol) keep.push(p);
  }
  keep.push(pts.at(-1));
  return keep;
}
async function load(icao, lat, lon) {
  const c = readCache(icao);
  if (c) return c;
  if (navigator.onLine === false) return null;
  const dLat = 0.05, dLon = 0.05 / Math.cos(lat * Math.PI / 180);
  const bbox = `${(lat - dLat).toFixed(4)},${(lon - dLon).toFixed(4)},${(lat + dLat).toFixed(4)},${(lon + dLon).toFixed(4)}`;
  const d = await overpass(`[out:json][timeout:90][bbox:${bbox}];(way["aeroway"~"^(runway|taxiway|taxilane)$"];);out tags geom;`);
  if (!d) return null;
  const k = Math.cos(lat * Math.PI / 180) * 111320;
  const xy = (g) => simplify(g.map(p => [Math.round((p.lon - lon) * k), Math.round((p.lat - lat) * 110540)]));
  const out = { at: Date.now(), lat, lon, rw: [], tw: {} };
  for (const w of d.elements || []) {
    if (!w.geometry || w.geometry.length < 2) continue;
    if (w.tags?.aeroway === 'runway') { out.rw.push({ ref: w.tags.ref || '', pts: xy(w.geometry) }); continue; }
    const r = norm(w.tags?.ref);
    (out.tw[r] = out.tw[r] || []).push(xy(w.geometry));
  }
  if (!out.rw.length) return null;
  writeCache(icao, out);
  return out;
}

// Runway end named `des` (e.g. "32R"): the end you land over flying that
// heading — the end the runway runs away from on about des × 10°.
function runwayEnd(geo, des) {
  const n = parseInt(des, 10) * 10;
  // A runway is often several OSM ways: its ends are the two points of all
  // of them furthest apart, not the ends of the first piece.
  const ways = geo.rw.filter(r => norm(r.ref).split('/').includes(norm(des)));
  if (!ways.length) return null;
  const pts = ways.flatMap(r => [r.pts[0], r.pts.at(-1)]);
  let a = pts[0], b = pts[0], best = -1;
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) {
    const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
    if (d > best) { best = d; a = pts[i]; b = pts[j]; }
  }
  const brg = (p, q) => (Math.atan2(q[0] - p[0], q[1] - p[1]) * 180 / Math.PI + 360) % 360;
  const diff = (x) => Math.abs(((x - n) % 360 + 540) % 360 - 180);
  const at = diff(brg(a, b)) < diff(brg(b, a)) ? a : b, far = at === a ? b : a;
  // Past a displaced threshold or an extension OSM often draws an unnamed
  // runway piece: follow those from each end to the physical edge, where
  // the number goes (the threshold itself stays `at`).
  const edgeFrom = (p) => {
    let e = p;
    for (let i = 0; i < 3; i++) {
      const nx = geo.rw.find(r => !r.ref && [r.pts[0], r.pts.at(-1)].some(q => Math.hypot(q[0] - e[0], q[1] - e[1]) < 40));
      if (!nx) break;
      const [q0, q1] = [nx.pts[0], nx.pts.at(-1)];
      const nxt = Math.hypot(q0[0] - e[0], q0[1] - e[1]) < 40 ? q1 : q0;
      if (Math.hypot(nxt[0] - e[0], nxt[1] - e[1]) < 5 || nxt === e) break;
      e = nxt;
    }
    return e;
  };
  return { at, far, edge: edgeFrom(at), farEdge: edgeFrom(far), rw: ways[0], ways };
}

// The diagram, or '' when there's nothing to draw. `items` from the ATIS
// (route-ui colourAtis). `whole`: the whole airport (the full-screen view)
// rather than round the closures; `W`/`H` the drawing's shape. Returns
// { svg, missing: [labels not found], at(lat, lon) → [x, y] | null }.
export function diagram(geo, items, { whole = false, W = 600, H: Hwant = 0 } = {}) {
  if (!geo || !geo.rw.length) return { svg: '', missing: items.map(i => i.label) };
  const marks = [], missing = [];
  for (const it of items) {
    const ref = norm(it.ref);
    if (it.kind === 'RWY' || it.kind === 'ILS') {
      const e = runwayEnd(geo, ref);
      if (e) marks.push({ it, rw: e.rw, rws: e.ways, at: e.at }); else missing.push(it.label);
      continue;
    }
    const want = it.kind === 'GATE' ? [ref, 'GATE' + ref] : it.kind === 'STAND' ? [ref, 'STAND' + ref] : [ref];
    const ways = want.flatMap(r => (geo.tw[r] || []).map(pts => ({ pts })));
    if (ways.length) marks.push({ it, ways }); else missing.push(it.label);
  }
  // Frame: round what's marked (closed taxiways, the runway ends with a
  // fault), at least 2.4 km across so the runways nearby show what it's
  // next to; with nothing found, the whole airport.
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  const grow = (p) => { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); };
  if (!whole) marks.forEach(m => { (m.ways || []).forEach(w => w.pts.forEach(grow)); if (m.at) grow(m.at); if (m.it.kind === 'RWY') m.rws.forEach(w => w.pts.forEach(grow)); });
  if (whole || !marks.length) geo.rw.forEach(r => r.pts.forEach(grow));
  const pad = whole ? 300 : 350, MIN = 2400;
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  if (x1 - x0 < MIN) { const c = (x0 + x1) / 2; x0 = c - MIN / 2; x1 = c + MIN / 2; }
  if (y1 - y0 < MIN * 0.55) { const c = (y0 + y1) / 2; y0 = c - MIN * 0.275; y1 = c + MIN * 0.275; }
  const H = Hwant || Math.round(Math.max(220, Math.min(420, W * (y1 - y0) / (x1 - x0))));
  const s = Math.min(W / (x1 - x0), H / (y1 - y0));
  const ox = (W - (x1 - x0) * s) / 2, oy = (H - (y1 - y0) * s) / 2;
  const X = (p) => (ox + (p[0] - x0) * s).toFixed(1), Y = (p) => (oy + (y1 - p[1]) * s).toFixed(1);
  const path = (pts) => 'M' + pts.map(p => `${X(p)},${Y(p)}`).join('L');
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  // Runways wide (60 m, at least 7 px), taxiways a hairline — all of them.
  const rwW = Math.max(7, 60 * s);
  const inside = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  const placed = [];
  const free = (x, y) => { if (placed.some(([a, b]) => Math.abs(a - x) < 34 && Math.abs(b - y) < 14)) return false; placed.push([x, y]); return true; };
  let g = `<g class="ad-tw">${Object.values(geo.tw).flat().map(pts => `<path d="${path(pts)}"/>`).join('')}</g>`;
  // Every named taxiway's name, once, on its longest piece — shown when
  // zoomed in (the closed ones carry their own, bolder).
  const closedRefs = new Set(marks.filter(m => m.ways).flatMap(m => [norm(m.it.ref), 'GATE' + norm(m.it.ref)]));
  g += `<g class="ad-twl">${Object.entries(geo.tw).filter(([r]) => r && !closedRefs.has(r) && !/^GATE|^STAND/.test(r)).map(([r, ways]) => {
    const w = ways.slice().sort((a, b) => b.length - a.length)[0];
    const mid = w[Math.floor(w.length / 2)];
    return `<text x="${X(mid)}" y="${Y(mid)}">${esc(r)}</text>`;
  }).join('')}</g>`;
  g += `<g class="ad-rw">${geo.rw.map(r => `<path data-ad-rwy="${esc(norm(r.ref))}" d="${path(r.pts)}" style="stroke-width:${rwW.toFixed(1)}"/>`).join('')}</g>`;
  // Runway designators at both ends — each one a tap target: it chooses
  // that runway for the wind components beside the diagram (app.js).
  const doneRefs = new Set();
  for (const r of geo.rw) {
    const ends = String(r.ref || '').split('/');
    if (ends.length !== 2 || doneRefs.has(norm(r.ref))) continue;
    doneRefs.add(norm(r.ref));
    for (const d of ends) {
      const e = runwayEnd(geo, d);
      if (!e || !inside(e.edge)) continue;
      // As on the In flight runway diagram: a dark box with the number,
      // turned to lie along the runway, just beyond its end, with the LDA
      // under it (filled in by app.js from the runway data).
      const other = e.farEdge, tip = e.edge;
      const ox = +X(tip) - +X(other), oy = +Y(tip) - +Y(other);
      let ang = Math.atan2(oy, ox) * 180 / Math.PI, out = 1;
      if (ang > 90 || ang < -90) { ang += 180; out = -1; }
      g += `<g class="ad-end" data-ad-rw="${esc(norm(d))}" data-ad-rwy="${esc(norm(r.ref))}" transform="translate(${X(tip)},${Y(tip)}) rotate(${ang.toFixed(1)})">`
        + `<g class="ad-endk ${out > 0 ? 'ad-out-p' : 'ad-out-n'}"><rect class="ad-hit" x="-22" y="-14" width="44" height="40"/>`
        + `<rect class="ad-idbox" x="-14" y="-9" width="28" height="17" rx="3"/><text class="ad-id" y="3.8">${esc(d)}</text><text class="ad-lda" y="18"></text></g></g>`;
    }
  }
  for (const m of marks) {
    const k = esc(m.it.key);
    if (m.ways) {
      g += `<g class="ad-mark ad-closed" data-atis-ref="${k}">${m.ways.map(w => `<path d="${path(w.pts)}"/>`).join('')}`;
      const w = m.ways.slice().sort((a, b) => b.pts.length - a.pts.length)[0];
      const mid = w.pts[Math.floor(w.pts.length / 2)];
      // A name that would sit on another stays hidden until it's tapped.
      g += `<text class="${free(+X(mid), +Y(mid)) ? '' : 'ad-hide'}" x="${X(mid)}" y="${Y(mid)}">${esc(m.it.ref)}</text></g>`;
    } else if (m.it.kind === 'RWY') {
      g += `<g class="ad-mark ad-rwclosed" data-atis-ref="${k}">${m.rws.map(w => `<path d="${path(w.pts)}" style="stroke-width:${rwW.toFixed(1)}"/>`).join('')}</g>`;
    } else {
      g += `<g class="ad-mark ad-ils" data-atis-ref="${k}" transform="translate(${X(m.at)},${Y(m.at)})"><circle r="9"/><text y="-13">ILS ${esc(m.it.ref)} ✕</text></g>`;
    }
  }
  return {
    // Where a GPS position falls on the drawing (null off it).
    at: (la, lo) => {
      const p = [(lo - geo.lon) * Math.cos(geo.lat * Math.PI / 180) * 111320, (la - geo.lat) * 110540];
      return inside(p) ? [+X(p), +Y(p)] : null;
    },
    svg: `<svg class="atis-diagram" viewBox="0 0 ${W} ${H}" overflow="hidden" role="img" aria-label="Airport diagram with the ATIS closures"><rect class="ad-bg" width="${W}" height="${H}" rx="10"/>${g}<g class="ad-me"></g></svg>`,
    missing,
  };
}
