// airspace.js — local airspace without an API key.
//
// Pilots can drop in the OpenAir (.txt) or GeoJSON file their national
// association publishes; we parse it, store it in IndexedDB and draw it on the
// map. It also feeds the task cross-section, so you can see whether a leg
// clips a CTR floor.
//
// OpenAir subset supported (the parts real files actually use):
//   AC <class>            airspace class
//   AN <name>             name
//   AL / AH <alt>         floor / ceiling  ("GND", "2500 MSL", "FL65", "1000 AGL")
//   V X=<lat> <lon>       centre for the next arc/circle
//   V D=+|-               arc direction
//   DP <lat> <lon>        polygon point
//   DC <radius-nm>        circle of radius about V X=
//   DA <r>,<start>,<end>  arc by radius/bearings about V X=
//   DB <p1>,<p2>          arc between two points about V X=
//
// Everything is pure functions + one Leaflet layer, no dependencies.

import * as Store from './store.js';

const NM = 1852;          // metres
const FT = 0.3048;

// ── altitude parsing ────────────────────────────────────────────────────────
/**
 * "2500 MSL" | "FL65" | "1000 AGL" | "GND" | "UNL" → {m, ref, label}
 * `m` is metres; for AGL it's height above ground, flagged by ref:'AGL'.
 */
export function parseAlt(raw) {
  const s = String(raw || '').trim().toUpperCase();
  if (!s) return { m: 0, ref: 'MSL', label: '?' };
  if (/^(GND|SFC)/.test(s)) return { m: 0, ref: 'AGL', label: 'GND' };
  if (/^UNL/.test(s)) return { m: 999999, ref: 'MSL', label: 'UNL' };
  const fl = s.match(/FL\s*(\d+)/);
  if (fl) return { m: parseInt(fl[1], 10) * 100 * FT, ref: 'MSL', label: `FL${fl[1]}` };
  const num = s.match(/(-?\d+(?:\.\d+)?)/);
  if (!num) return { m: 0, ref: 'MSL', label: s };
  let v = parseFloat(num[1]);
  // Metres are usually written glued to the number ("1200M"), so \bM\b never
  // fires — match a digit followed by M that isn't the start of MSL/MEAN etc.
  const metres = (/\d\s*M(?![A-Z])/.test(s) || /METERS?|METRES?/.test(s)) && !/\bFT\b/.test(s);
  const m = metres ? v : v * FT;
  const ref = /AGL|AGND|SFC|GND/.test(s) ? 'AGL' : 'MSL';
  return { m, ref, label: `${Math.round(v)}${metres ? 'm' : 'ft'} ${ref}` };
}

// OpenAir coords: "46:34:12 N 007:12:30 E" or "46.5700N 7.2083E"
function parseCoord(txt) {
  const s = String(txt).trim();
  const re = /(\d+(?:[:.]\d+)*)\s*([NS])[\s,]*(\d+(?:[:.]\d+)*)\s*([EW])/i;
  const m = s.match(re);
  if (!m) return null;
  const dec = (v, hemi) => {
    const parts = v.split(':').map(Number);
    let d = parts.length > 1 ? parts[0] + (parts[1] || 0) / 60 + (parts[2] || 0) / 3600 : parseFloat(v);
    if (/[SW]/i.test(hemi)) d = -d;
    return d;
  };
  return { lat: dec(m[1], m[2]), lon: dec(m[3], m[4]) };
}

const toRad = (d) => d * Math.PI / 180, toDeg = (r) => r * 180 / Math.PI;

/** Destination point from centre, bearing (deg) and distance (m). */
function dest(c, brg, dist) {
  const R = 6371000, d = dist / R, b = toRad(brg);
  const la1 = toRad(c.lat), lo1 = toRad(c.lon);
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return { lat: toDeg(la2), lon: toDeg(lo2) };
}
function bearing(c, p) {
  const la1 = toRad(c.lat), la2 = toRad(p.lat), dLon = toRad(p.lon - c.lon);
  return (toDeg(Math.atan2(Math.sin(dLon) * Math.cos(la2),
    Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(dLon))) + 360) % 360;
}
function distM(a, b) {
  const R = 6371000, dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function arc(c, r, from, to, cw, step = 6) {
  const pts = [];
  let sweep = cw ? (to - from + 360) % 360 : -((from - to + 360) % 360);
  if (sweep === 0) sweep = cw ? 360 : -360;
  const n = Math.max(2, Math.ceil(Math.abs(sweep) / step));
  for (let i = 0; i <= n; i++) pts.push(dest(c, from + sweep * (i / n), r));
  return pts;
}

/** Parse an OpenAir document → [{name, class, floor, ceil, points:[{lat,lon}]}] */
export function parseOpenAir(text) {
  const out = [];
  let cur = null, centre = null, cw = true;
  const flush = () => { if (cur && cur.points.length > 2) out.push(cur); cur = null; };

  for (const rawLine of String(text).split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('*') || line.startsWith('#')) continue;
    const cmd = line.slice(0, 2).toUpperCase();
    const rest = line.slice(2).trim();
    switch (cmd) {
      case 'AC':
        flush();
        cur = { class: rest.toUpperCase(), name: '', floor: parseAlt('GND'), ceil: parseAlt('UNL'), points: [] };
        centre = null; cw = true;
        break;
      case 'AN': if (cur) cur.name = rest; break;
      case 'AL': if (cur) cur.floor = parseAlt(rest); break;
      case 'AH': if (cur) cur.ceil = parseAlt(rest); break;
      case 'V ': {
        const xm = rest.match(/X\s*=\s*(.+)/i);
        if (xm) centre = parseCoord(xm[1]);
        const dm = rest.match(/D\s*=\s*([+-])/i);
        if (dm) cw = dm[1] === '+';
        break;
      }
      case 'DP': { const p = parseCoord(rest); if (cur && p) cur.points.push(p); break; }
      case 'DC': {
        const r = parseFloat(rest) * NM;
        if (cur && centre && isFinite(r)) cur.points.push(...arc(centre, r, 0, 360, true));
        break;
      }
      case 'DA': {
        const [r, a1, a2] = rest.split(',').map((v) => parseFloat(v));
        if (cur && centre && isFinite(r)) cur.points.push(...arc(centre, r * NM, a1, a2, cw));
        break;
      }
      case 'DB': {
        const [s1, s2] = rest.split(',');
        const p1 = parseCoord(s1 || ''), p2 = parseCoord(s2 || '');
        if (cur && centre && p1 && p2) {
          const r = (distM(centre, p1) + distM(centre, p2)) / 2;
          cur.points.push(...arc(centre, r, bearing(centre, p1), bearing(centre, p2), cw));
        }
        break;
      }
      default: break;
    }
  }
  flush();
  return out;
}

/** Parse a GeoJSON FeatureCollection of airspace polygons. */
export function parseGeoJSON(text) {
  const gj = typeof text === 'string' ? JSON.parse(text) : text;
  const out = [];
  const push = (coords, props) => {
    const pts = coords.map(([lon, lat]) => ({ lat, lon }));
    if (pts.length > 2) out.push({
      name: props.name || props.NAME || props.title || 'Airspace',
      class: (props.class || props.CLASS || props.type || '').toString().toUpperCase(),
      floor: parseAlt(props.floor ?? props.lowerLimit ?? props.AL ?? 'GND'),
      ceil: parseAlt(props.ceiling ?? props.upperLimit ?? props.AH ?? 'UNL'),
      points: pts,
    });
  };
  for (const f of (gj.features || [])) {
    const g = f.geometry, p = f.properties || {};
    if (!g) continue;
    if (g.type === 'Polygon') push(g.coordinates[0], p);
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((poly) => push(poly[0], p));
  }
  return out;
}

/** Parse by file extension / content sniffing. */
export function parseAirspace(text, filename = '') {
  const t = text.trim();
  if (/\.geojson$|\.json$/i.test(filename) || t.startsWith('{')) return parseGeoJSON(t);
  return parseOpenAir(t);
}

// ── storage ─────────────────────────────────────────────────────────────────
let zones = [];
export function loaded() { return zones; }
export function count() { return zones.length; }

export async function save(list, meta) {
  zones = list;
  await Store.put(Store.AIRSPACE_KEY, { zones: list, meta: meta || {} });
}
export async function load() {
  const rec = await Store.get(Store.AIRSPACE_KEY);
  zones = (rec && rec.value && rec.value.zones) || [];
  return { zones, at: rec ? rec.at : null, meta: (rec && rec.value.meta) || {} };
}
export async function clear() { zones = []; await Store.del(Store.AIRSPACE_KEY); }

// ── geometry helpers used by the map + cross-section ────────────────────────
export function pointInZone(lat, lon, z) {
  const pts = z.points;
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const xi = pts[i].lon, yi = pts[i].lat, xj = pts[j].lon, yj = pts[j].lat;
    if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

/** Zones containing a point, lowest floor first. */
export function zonesAt(lat, lon) {
  return zones.filter((z) => pointInZone(lat, lon, z)).sort((a, b) => a.floor.m - b.floor.m);
}

// Colour by class — restricted/danger read hot, control zones cool.
export function zoneColor(cls) {
  if (/^(P|R|D|TRA|TSA)/.test(cls)) return '#e0453f';
  if (/^(CTR|C|B|A)/.test(cls)) return '#ef7d3b';
  if (/^(TMA|E|D)/.test(cls)) return '#f2c14e';
  return '#5ec2ff';
}

// While planning a task, taps must reach the map to drop turnpoints — a big CTR
// polygon would otherwise swallow every click and just open its own popup.
let interactive = true;
export function setInteractive(on, layer) {
  if (interactive === on) return;
  interactive = on;
  if (layer) render(layer);
}

/** Draw all zones into a Leaflet layer group. */
export function render(layer, altFilterM) {
  layer.clearLayers();
  for (const z of zones) {
    if (altFilterM != null && z.floor.m > altFilterM) continue;   // above our ceiling of interest
    const c = zoneColor(z.class);
    const poly = L.polygon(z.points.map((p) => [p.lat, p.lon]), {
      color: c, weight: 1.6, opacity: 0.9, fillColor: c, fillOpacity: 0.1, interactive,
    });
    if (interactive) {
      poly.bindPopup(`<b>${z.name || 'Airspace'}</b><br>${z.class || ''}<br>${z.floor.label} → ${z.ceil.label}`);
    }
    poly.addTo(layer);
  }
}
