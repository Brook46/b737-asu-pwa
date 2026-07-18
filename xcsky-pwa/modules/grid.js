// grid.js — the SkySight-style gridded weather overlay: the main feature.
//
// We fetch a COLS×ROWS lattice of Open-Meteo point forecasts covering the map
// viewport in ONE batched call (multi-location request), derive the soaring
// numbers per point per hour, and draw THREE independent, stackable overlays:
//
//   • colour field   — thermals / top / base painted as a smooth canvas
//   • wind barbs      — standard meteorological barbs (direction + strength),
//                       shown over whatever colour field is active
//   • convergence     — highlighted zones where the wind field converges
//                       (lift lines), from the horizontal wind divergence
//
// Scrubbing time re-renders all three from the cached grid — no refetch.
// timezone=auto is per-point, so rendering looks hours up by local ISO string.

import { lclAgl, wStar, climbRate } from './soaring.js';

const COLS = 9, ROWS = 7;
const PAD = 0.16;            // fetch this fraction beyond the viewport each side
const ALPHA = 0.72;          // colour-field opacity

const HOURLY_VARS = [
  'temperature_2m', 'dewpoint_2m', 'boundary_layer_height',
  'shortwave_radiation', 'cloud_cover_low',
  'windspeed_10m', 'winddirection_10m',
];

// Colour-field layers (mutually exclusive). Wind & convergence are separate,
// stackable toggles handled by the app.
export const COLOR_LAYERS = [
  { id: 'climb', label: 'Thermals' },
  { id: 'top',   label: 'Top' },
  { id: 'base',  label: 'Base' },
  { id: 'off',   label: 'Off' },
];

let cache = null;    // {model, bounds, points:[{lat,lon,elev,idx:Map,hourly}]}
let colorOverlay = null, convOverlay = null, windLayer = null;
let fetching = false;

const fieldCanvas = document.createElement('canvas');
fieldCanvas.width = COLS; fieldCanvas.height = ROWS;
const convCanvas = document.createElement('canvas');
convCanvas.width = COLS; convCanvas.height = ROWS;

function paddedBounds(map) {
  const b = map.getBounds();
  const dLat = (b.getNorth() - b.getSouth()) * PAD;
  const dLon = (b.getEast() - b.getWest()) * PAD;
  return L.latLngBounds(
    [b.getSouth() - dLat, b.getWest() - dLon],
    [b.getNorth() + dLat, b.getEast() + dLon]);
}

export function covered(map, model) {
  if (!cache || cache.model !== model) return false;
  return cache.bounds.contains(map.getBounds());
}
export function gridReady() { return !!(cache && cache.points.length); }

/** Fetch (or reuse) the grid for the current viewport. */
export async function ensureGrid(map, model) {
  if (covered(map, model)) return true;
  if (fetching) return false;
  fetching = true;
  try {
    const b = paddedBounds(map);
    const lats = [], lons = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        lats.push((b.getNorth() - (r + 0.5) * (b.getNorth() - b.getSouth()) / ROWS).toFixed(3));
        lons.push((b.getWest() + (c + 0.5) * (b.getEast() - b.getWest()) / COLS).toFixed(3));
      }
    }
    const params = new URLSearchParams({
      latitude: lats.join(','), longitude: lons.join(','),
      hourly: HOURLY_VARS.join(','),
      models: model, forecast_days: '7', timezone: 'auto',
    });
    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
    if (!res.ok) throw new Error(`grid ${res.status}`);
    const data = await res.json();
    const arr = Array.isArray(data) ? data : [data];
    cache = {
      model, bounds: b,
      points: arr.map((p) => ({
        lat: p.latitude, lon: p.longitude, elev: p.elevation || 0,
        hourly: p.hourly,
        idx: new Map(p.hourly.time.map((t, i) => [t, i])),
      })),
    };
    return true;
  } catch (err) {
    console.warn('grid fetch failed', err);
    return false;
  } finally {
    fetching = false;
  }
}

/** Derive the soaring numbers for one grid point at a local time key. */
function derive(p, timeKey) {
  const i = p.idx.get(timeKey);
  if (i === undefined) return null;
  const h = p.hourly;
  const hr = {
    t2m: h.temperature_2m[i], td2m: h.dewpoint_2m[i],
    blHeight: h.boundary_layer_height[i], shortwave: h.shortwave_radiation[i],
  };
  const ws = wStar(hr);
  const climb = climbRate(ws);
  const lcl = lclAgl(hr.t2m, hr.td2m);
  const zi = hr.blHeight || 0;
  const cumulus = lcl != null && zi > 0 && lcl < zi && (h.cloud_cover_low[i] ?? 0) > 8;
  const top = zi ? p.elev + zi : null;
  const base = lcl != null ? p.elev + lcl : null;
  return {
    climb,
    top: cumulus && base != null ? Math.min(top, base) : top,
    base: cumulus ? base : null,
    wind: h.windspeed_10m[i], windDir: h.winddirection_10m[i],
  };
}

/** Sample the derived forecast at an arbitrary lat/lon (nearest grid point). */
export function sampleAt(lat, lon, dayKey, hour) {
  if (!cache || !cache.points.length) return null;
  const timeKey = `${dayKey}T${String(hour).padStart(2, '0')}:00`;
  let best = null, bestD = Infinity;
  for (const p of cache.points) {
    const d = (p.lat - lat) ** 2 + (p.lon - lon) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best ? derive(best, timeKey) : null;
}

// ── colour ramps ──────────────────────────────────────────────────────────
function ramp(stops, v) {
  if (v <= stops[0][0]) return stops[0].slice(1);
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [v0, ...c0] = stops[i - 1], [v1, ...c1] = stops[i];
      const t = (v - v0) / (v1 - v0);
      return c0.map((x, k) => Math.round(x + (c1[k] - x) * t));
    }
  }
  return stops[stops.length - 1].slice(1);
}
const CLIMB_STOPS = [
  [0.15, 100, 110, 130], [0.5, 59, 110, 165], [1.0, 47, 158, 111],
  [1.5, 124, 193, 67], [2.0, 242, 193, 78], [2.8, 239, 125, 59], [4.0, 224, 69, 63],
];
const ALT_STOPS = [
  [0, 70, 90, 120], [1000, 59, 110, 165], [1800, 47, 158, 111],
  [2600, 124, 193, 67], [3400, 242, 193, 78], [4200, 239, 125, 59], [5000, 224, 69, 63],
];

function fieldColor(layer, d) {
  if (!d) return [0, 0, 0, 0];
  switch (layer) {
    case 'climb': {
      if (d.climb < 0.1) return [0, 0, 0, 0];
      const a = Math.min(1, 0.55 + d.climb / 3);
      return [...ramp(CLIMB_STOPS, d.climb), Math.round(255 * ALPHA * a)];
    }
    case 'top':
      if (!d.top || d.climb < 0.1) return [0, 0, 0, 0];
      return [...ramp(ALT_STOPS, d.top), Math.round(255 * ALPHA)];
    case 'base':
      if (!d.base) return [0, 0, 0, 0];
      return [...ramp(ALT_STOPS, d.base), Math.round(255 * ALPHA)];
    default:
      return [0, 0, 0, 0];
  }
}

// ── standard wind barb (SVG for a divIcon) ──────────────────────────────────
// Staff points toward where the wind comes FROM; feathers sit at that end.
// Half barb = 5 kt, full barb = 10 kt, pennant = 50 kt. Calm = open circle.
function barbSvg(kmh, dirFrom) {
  const kt = (kmh || 0) * 0.539957;
  const strong = kmh > 35;
  const col = strong ? '#ff6b5c' : '#eef3fb';
  const cx = 16, cy = 16;
  if (kt < 2.5) {
    return `<svg width="32" height="32" viewBox="0 0 32 32">
      <circle cx="${cx}" cy="${cy}" r="3.4" fill="none" stroke="${col}" stroke-width="1.6"/></svg>`;
  }
  const L = 15;                          // staff length (up = toward FROM)
  let parts = `<line x1="${cx}" y1="${cy}" x2="${cx}" y2="${cy - L}" stroke="${col}" stroke-width="1.7"/>`;
  let rem = Math.round(kt / 5) * 5;
  let y = cy - L;                        // start at the FROM end
  const gap = 3.4;
  while (rem >= 50) {                    // pennant (filled triangle)
    parts += `<path d="M${cx} ${y} L${cx + 7} ${y + 2} L${cx} ${y + 4.6} Z" fill="${col}"/>`;
    y += 5.2; rem -= 50;
  }
  while (rem >= 10) {                    // full barb
    parts += `<line x1="${cx}" y1="${y}" x2="${cx + 8}" y2="${y - 3}" stroke="${col}" stroke-width="1.7"/>`;
    y += gap; rem -= 10;
  }
  if (rem >= 5) {                        // half barb
    parts += `<line x1="${cx}" y1="${y + gap * 0.4}" x2="${cx + 4}" y2="${y + gap * 0.4 - 1.5}" stroke="${col}" stroke-width="1.7"/>`;
  }
  return `<svg width="32" height="32" viewBox="0 0 32 32" style="filter:drop-shadow(0 0 1.5px rgba(0,0,0,.85))">
    <g transform="rotate(${dirFrom} ${cx} ${cy})">${parts}</g></svg>`;
}

// ── horizontal wind divergence → convergence highlight ──────────────────────
// u eastward, v northward (m/s-ish; relative magnitudes are what matter).
// convergence = −(∂u/∂x + ∂v/∂y); positive where air piles up ⇒ lift lines.
function convergenceGrid(derived, bounds) {
  const midLat = (bounds.getNorth() + bounds.getSouth()) / 2;
  const dxKm = ((bounds.getEast() - bounds.getWest()) / COLS) * 111 * Math.cos(midLat * Math.PI / 180);
  const dyKm = ((bounds.getNorth() - bounds.getSouth()) / ROWS) * 111;
  const u = new Array(COLS * ROWS).fill(null), v = new Array(COLS * ROWS).fill(null);
  for (let i = 0; i < derived.length; i++) {
    const d = derived[i];
    if (!d || d.wind == null) continue;
    const rad = (d.windDir || 0) * Math.PI / 180;
    u[i] = -d.wind * Math.sin(rad);       // FROM dir → vector points downwind
    v[i] = -d.wind * Math.cos(rad);
  }
  const conv = new Array(COLS * ROWS).fill(0);
  const at = (r, c) => r * COLS + c;
  for (let r = 1; r < ROWS - 1; r++) {
    for (let c = 1; c < COLS - 1; c++) {
      const uE = u[at(r, c + 1)], uW = u[at(r, c - 1)];
      const vN = v[at(r - 1, c)], vS = v[at(r + 1, c)];   // row 0 = north
      if (uE == null || uW == null || vN == null || vS == null) continue;
      const dudx = (uE - uW) / (2 * dxKm);
      const dvdy = (vN - vS) / (2 * dyKm);
      conv[at(r, c)] = -(dudx + dvdy);     // >0 ⇒ convergence
    }
  }
  return conv;
}

// ── render ──────────────────────────────────────────────────────────────────
/**
 * Draw the requested overlays for a day/hour. opts = {color, wind, convergence}.
 * All three stack; any can be off.
 */
export function render(map, opts, dayKey, hour) {
  if (!cache) { clearAll(map); return; }
  const timeKey = `${dayKey}T${String(hour).padStart(2, '0')}:00`;
  const derived = cache.points.map((p) => derive(p, timeKey));

  // 1. colour field
  if (opts.color && opts.color !== 'off') {
    const ctx = fieldCanvas.getContext('2d');
    const img = ctx.createImageData(COLS, ROWS);
    for (let i = 0; i < derived.length; i++) img.data.set(fieldColor(opts.color, derived[i]), i * 4);
    ctx.putImageData(img, 0, 0);
    colorOverlay = putOverlay(map, colorOverlay, fieldCanvas.toDataURL(), 'wx-overlay');
  } else {
    colorOverlay = removeOverlay(map, colorOverlay);
  }

  // 2. convergence highlight
  if (opts.convergence) {
    const conv = convergenceGrid(derived, cache.bounds);
    const peak = Math.max(0.02, ...conv);
    const ctx = convCanvas.getContext('2d');
    const img = ctx.createImageData(COLS, ROWS);
    for (let i = 0; i < conv.length; i++) {
      const t = Math.max(0, conv[i]) / peak;               // 0..1
      const a = t > 0.35 ? Math.round(210 * Math.min(1, (t - 0.35) / 0.5)) : 0;
      img.data.set([124, 240, 255, a], i * 4);             // bright cyan lift lines
    }
    ctx.putImageData(img, 0, 0);
    convOverlay = putOverlay(map, convOverlay, convCanvas.toDataURL(), 'wx-conv');
  } else {
    convOverlay = removeOverlay(map, convOverlay);
  }

  // 3. wind barbs
  if (opts.wind) {
    if (!windLayer) windLayer = L.layerGroup().addTo(map);
    windLayer.clearLayers();
    cache.points.forEach((p, i) => {
      const d = derived[i];
      if (!d || d.wind == null) return;
      const icon = L.divIcon({
        className: 'wx-barb', html: barbSvg(d.wind, d.windDir),
        iconSize: [32, 32], iconAnchor: [16, 16],
      });
      windLayer.addLayer(L.marker([p.lat, p.lon], { icon, interactive: false, keyboard: false }));
    });
  } else if (windLayer) {
    windLayer.remove(); windLayer = null;
  }
}

function putOverlay(map, ov, url, cls) {
  if (!ov) {
    ov = L.imageOverlay(url, cache.bounds, { opacity: 1, interactive: false, className: cls });
    ov.addTo(map);
  } else {
    ov.setUrl(url); ov.setBounds(cache.bounds);
    if (!map.hasLayer(ov)) ov.addTo(map);
  }
  return ov;
}
function removeOverlay(map, ov) { if (ov && map.hasLayer(ov)) ov.remove(); return ov; }

function clearAll(map) {
  colorOverlay = removeOverlay(map, colorOverlay);
  convOverlay = removeOverlay(map, convOverlay);
  if (windLayer) { windLayer.remove(); windLayer = null; }
}
export function clear(map) { clearAll(map); }

export function watchMap(map, getModel, onReady) {
  let t = null;
  map.on('moveend', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      if (!covered(map, getModel()) && await ensureGrid(map, getModel())) onReady();
    }, 700);
  });
}

/** Legend for the active colour field. */
export function legend(layer) {
  const fmt = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
  switch (layer) {
    case 'climb':
      return { title: 'Climb m/s', items: [[0.5, '0.5'], [1, '1'], [1.5, '1.5'], [2, '2'], [3, '3+']]
        .map(([v, l]) => ({ color: fmt(ramp(CLIMB_STOPS, v)), label: l })) };
    case 'top':
    case 'base':
      return { title: layer === 'top' ? 'Thermal top MSL' : 'Cloud base MSL',
        items: [[1000, '1 km'], [1800, '1.8'], [2600, '2.6'], [3400, '3.4'], [4200, '4.2+']]
          .map(([v, l]) => ({ color: fmt(ramp(ALT_STOPS, v)), label: l })) };
    default:
      return null;
  }
}
