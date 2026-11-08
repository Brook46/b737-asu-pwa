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
  ['https://overpass-api.de/api/interpreter', 60000],
  ['https://overpass.kumi.systems/api/interpreter', 40000],
  ['https://maps.mail.ru/osm/tools/overpass/api/interpreter', 40000],
];
const KEY = 'fc.aptgeo2.';
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

// The runways, and the taxiways / gates named in `refs` (only those — a
// whole airport's taxiways is half a megabyte and Overpass's slowest ask):
// { lat, lon, rw: [{ ref, pts }], tw: { NORMREF: [pts, …] }, tried: [refs] }
// with pts in metres east / north of the airport reference point. Refs
// already asked for aren't asked again, found or not.
const inflight = new Map();
export function airportGeo(icao, lat, lon, refs = []) {
  const k = icao + '|' + refs.join(',');
  if (!inflight.has(k)) inflight.set(k, load(icao, lat, lon, refs).finally(() => inflight.delete(k)));
  return inflight.get(k);
}
async function load(icao, lat, lon, refs) {
  let c = readCache(icao);
  const want = [...new Set(refs.map(norm))].filter(r => r && !(c && c.tried.includes(r)));
  if (c && !want.length) return c;
  if (navigator.onLine === false) return c;
  const dLat = 0.045, dLon = 0.045 / Math.cos(lat * Math.PI / 180);
  const bbox = `${(lat - dLat).toFixed(4)},${(lon - dLon).toFixed(4)},${(lat + dLat).toFixed(4)},${(lon + dLon).toFixed(4)}`;
  // "AZ3" matches OSM's AZ3 / AZ-3 / AZ 3; a gate also as GATE-12.
  const rx = want.map(r => { const m = /^([A-Z]*)(\d*)([A-Z]*)$/.exec(r) || [r, r, '', '']; const body = m[1] && m[2] ? `${m[1]}[- ]?${m[2]}${m[3]}` : r; return `${body}|GATE[- ]?${body}|STAND[- ]?${body}`; }).join('|');
  const q = `[out:json][timeout:50][bbox:${bbox}];(${c ? '' : 'way["aeroway"="runway"];'}${want.length ? `way["aeroway"~"^(taxiway|taxilane|parking_position)$"]["ref"~"^(${rx})$",i];` : ''});out tags geom;`;
  const d = await overpass(q);
  if (!d) return c;
  const k = Math.cos(lat * Math.PI / 180) * 111320;
  const xy = (g) => g.map(p => [Math.round((p.lon - lon) * k), Math.round((p.lat - lat) * 110540)]);
  c = c || { at: Date.now(), lat, lon, rw: [], tw: {}, tried: [] };
  for (const w of d.elements || []) {
    if (!w.geometry || w.geometry.length < 2) continue;
    if (w.tags?.aeroway === 'runway') { c.rw.push({ ref: w.tags.ref || '', pts: xy(w.geometry) }); continue; }
    const r = norm(w.tags?.ref);
    (c.tw[r] = c.tw[r] || []).push(xy(w.geometry));
  }
  c.tried = [...new Set([...c.tried, ...want])];
  if (!c.rw.length) return null;
  writeCache(icao, c);
  return c;
}

// Runway end named `des` (e.g. "32R"): the end you land over flying that
// heading — the end the runway runs away from on about des × 10°.
function runwayEnd(geo, des) {
  const n = parseInt(des, 10) * 10;
  for (const r of geo.rw) {
    if (!norm(r.ref).split('/').includes(norm(des))) continue;
    const a = r.pts[0], b = r.pts.at(-1);
    const brg = (p, q) => (Math.atan2(q[0] - p[0], q[1] - p[1]) * 180 / Math.PI + 360) % 360;
    const diff = (x) => Math.abs(((x - n) % 360 + 540) % 360 - 180);
    return { at: diff(brg(a, b)) < diff(brg(b, a)) ? a : b, rw: r };
  }
  return null;
}

// The diagram, or '' when there's nothing to draw. `items` from the ATIS
// (route-ui colourAtis); returns { svg, missing: [labels not found] }.
export function diagram(geo, items) {
  if (!geo || !geo.rw.length) return { svg: '', missing: items.map(i => i.label) };
  const marks = [], missing = [];
  for (const it of items) {
    const ref = norm(it.ref);
    if (it.kind === 'RWY' || it.kind === 'ILS') {
      const e = runwayEnd(geo, ref);
      if (e) marks.push({ it, rw: e.rw, at: e.at }); else missing.push(it.label);
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
  marks.forEach(m => { (m.ways || []).forEach(w => w.pts.forEach(grow)); if (m.at) grow(m.at); if (m.it.kind === 'RWY') m.rw.pts.forEach(grow); });
  if (!marks.length) geo.rw.forEach(r => r.pts.forEach(grow));
  const pad = 350, MIN = 2400;
  x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  if (x1 - x0 < MIN) { const c = (x0 + x1) / 2; x0 = c - MIN / 2; x1 = c + MIN / 2; }
  if (y1 - y0 < MIN * 0.55) { const c = (y0 + y1) / 2; y0 = c - MIN * 0.275; y1 = c + MIN * 0.275; }
  const W = 600, H = Math.round(Math.max(220, Math.min(420, W * (y1 - y0) / (x1 - x0))));
  const s = Math.min(W / (x1 - x0), H / (y1 - y0));
  const ox = (W - (x1 - x0) * s) / 2, oy = (H - (y1 - y0) * s) / 2;
  const X = (p) => (ox + (p[0] - x0) * s).toFixed(1), Y = (p) => (oy + (y1 - p[1]) * s).toFixed(1);
  const path = (pts) => 'M' + pts.map(p => `${X(p)},${Y(p)}`).join('L');
  const esc = (t) => String(t).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const rwW = Math.max(4, 45 * s);
  const inside = (p) => p[0] >= x0 && p[0] <= x1 && p[1] >= y0 && p[1] <= y1;
  const placed = [];
  const free = (x, y) => { if (placed.some(([a, b]) => Math.abs(a - x) < 34 && Math.abs(b - y) < 14)) return false; placed.push([x, y]); return true; };
  let g = `<g class="ad-rw">${geo.rw.map(r => `<path d="${path(r.pts)}" style="stroke-width:${rwW.toFixed(1)}"/>`).join('')}</g>`;
  // Runway designators at both ends.
  for (const r of geo.rw) {
    const ends = String(r.ref || '').split('/');
    if (ends.length !== 2) continue;
    for (const d of ends) {
      const e = runwayEnd(geo, d);
      if (e && inside(e.at) && free(+X(e.at), +Y(e.at))) g += `<text class="ad-des" x="${X(e.at)}" y="${Y(e.at)}">${esc(d)}</text>`;
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
      g += `<g class="ad-mark ad-rwclosed" data-atis-ref="${k}"><path d="${path(m.rw.pts)}" style="stroke-width:${rwW.toFixed(1)}"/></g>`;
    } else {
      g += `<g class="ad-mark ad-ils" data-atis-ref="${k}" transform="translate(${X(m.at)},${Y(m.at)})"><circle r="9"/><text y="-13">ILS ${esc(m.it.ref)} ✕</text></g>`;
    }
  }
  return {
    svg: `<svg class="atis-diagram" viewBox="0 0 ${W} ${H}" overflow="hidden" role="img" aria-label="Airport diagram with the ATIS closures"><rect class="ad-bg" width="${W}" height="${H}" rx="10"/>${g}</svg>`,
    missing,
  };
}
