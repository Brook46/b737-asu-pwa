// grid.js — the SkySight-style gridded weather overlay: the main feature.
//
// We fetch a COLS×ROWS lattice of Open-Meteo point forecasts covering the map
// viewport in ONE batched call (multi-location request; ~380 KB for 42 points
// × 7 days, <1 s), derive the soaring numbers per point per hour with the same
// physics as the point forecast, and paint them as a smooth semi-transparent
// canvas ImageOverlay. Scrubbing time re-colours from cache — no refetch.
//
// timezone=auto is per-point, so a grid spanning a timezone border stays in
// each point's local solar time (which is what thermals care about). Rendering
// looks hours up by local ISO string, not by array index.

import { lclAgl, wStar, climbRate } from './soaring.js';

const COLS = 7, ROWS = 6;
const PAD = 0.18;            // fetch this fraction beyond the viewport each side
const ALPHA = 0.72;          // overlay opacity
const REFETCH_DEBOUNCE = 700;

const HOURLY_VARS = [
  'temperature_2m', 'dewpoint_2m', 'boundary_layer_height',
  'shortwave_radiation', 'cloud_cover_low',
  'windspeed_10m', 'winddirection_10m',
];

// The selectable overlay layers.
export const LAYERS = [
  { id: 'climb', label: 'Thermals', unit: 'm/s' },
  { id: 'top',   label: 'Top',      unit: 'MSL' },
  { id: 'base',  label: 'Base',     unit: 'MSL' },
  { id: 'wind',  label: 'Wind',     unit: 'km/h' },
  { id: 'off',   label: 'Off',      unit: '' },
];

let cache = null;    // {key, bounds:L.LatLngBounds, points:[{lat,lon,elev,idx:Map,hourly}]}
let overlay = null;  // L.ImageOverlay
let arrowLayer = null;
let fetching = false;
let debounceT = null;

const canvas = document.createElement('canvas');
canvas.width = COLS; canvas.height = ROWS;

function gridKey(b, model) {
  return [b.getSouth().toFixed(2), b.getWest().toFixed(2),
          b.getNorth().toFixed(2), b.getEast().toFixed(2), model].join('|');
}

function paddedBounds(map) {
  const b = map.getBounds();
  const dLat = (b.getNorth() - b.getSouth()) * PAD;
  const dLon = (b.getEast() - b.getWest()) * PAD;
  return L.latLngBounds(
    [b.getSouth() - dLat, b.getWest() - dLon],
    [b.getNorth() + dLat, b.getEast() + dLon]);
}

/** True if the current viewport is still inside the cached (padded) grid. */
export function covered(map, model) {
  if (!cache || cache.model !== model) return false;
  return cache.bounds.contains(map.getBounds());
}

/** Fetch (or reuse) the grid for the current viewport. Returns true if data ready. */
export async function ensureGrid(map, model) {
  if (covered(map, model)) return true;
  if (fetching) return false;
  fetching = true;
  try {
    const b = paddedBounds(map);
    const lats = [], lons = [];
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) {
        // Row 0 = north so the canvas paints top-down without flipping.
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
      key: gridKey(b, model), model, bounds: b,
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

/** Derive the soaring numbers for one grid point at a local time key "YYYY-MM-DDTHH:00". */
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
    base: cumulus ? base : null,      // null ⇒ blue (no cu) at this point
    wind: h.windspeed_10m[i], windDir: h.winddirection_10m[i],
  };
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

const CLIMB_STOPS = [        // matches the point-forecast lift ramp
  [0.15, 100, 110, 130], [0.5, 59, 110, 165], [1.0, 47, 158, 111],
  [1.5, 124, 193, 67], [2.0, 242, 193, 78], [2.8, 239, 125, 59], [4.0, 224, 69, 63],
];
const ALT_STOPS = [          // m MSL for top/base
  [0, 70, 90, 120], [1000, 59, 110, 165], [1800, 47, 158, 111],
  [2600, 124, 193, 67], [3400, 242, 193, 78], [4200, 239, 125, 59], [5000, 224, 69, 63],
];
const WIND_STOPS = [         // km/h
  [0, 47, 158, 111], [15, 124, 193, 67], [25, 242, 193, 78],
  [35, 239, 125, 59], [50, 224, 69, 63],
];

function cellColor(layer, d) {
  if (!d) return [0, 0, 0, 0];
  switch (layer) {
    case 'climb': {
      if (d.climb < 0.1) return [0, 0, 0, 0];       // dead air → transparent
      const a = Math.min(1, 0.55 + d.climb / 3);
      return [...ramp(CLIMB_STOPS, d.climb), Math.round(255 * ALPHA * a)];
    }
    case 'top':
      if (!d.top || d.climb < 0.1) return [0, 0, 0, 0];
      return [...ramp(ALT_STOPS, d.top), Math.round(255 * ALPHA)];
    case 'base':
      if (!d.base) return [0, 0, 0, 0];             // blue hole → transparent
      return [...ramp(ALT_STOPS, d.base), Math.round(255 * ALPHA)];
    case 'wind':
      return [...ramp(WIND_STOPS, d.wind ?? 0), Math.round(255 * ALPHA)];
    default:
      return [0, 0, 0, 0];
  }
}

/**
 * Paint the overlay for a layer at local time "YYYY-MM-DD" + hour.
 * Instant (no network) — uses the cached grid.
 */
export function render(map, layer, dayKey, hour) {
  if (!cache || layer === 'off') { clear(map); return; }
  const timeKey = `${dayKey}T${String(hour).padStart(2, '0')}:00`;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(COLS, ROWS);
  const derived = cache.points.map((p) => derive(p, timeKey));
  for (let i = 0; i < derived.length; i++) {
    const [r, g, b, a] = cellColor(layer, derived[i]);
    img.data.set([r, g, b, a], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  const url = canvas.toDataURL();

  if (!overlay) {
    overlay = L.imageOverlay(url, cache.bounds, { opacity: 1, interactive: false, className: 'wx-overlay' });
    overlay.addTo(map);
  } else {
    overlay.setUrl(url);
    overlay.setBounds(cache.bounds);
    if (!map.hasLayer(overlay)) overlay.addTo(map);
  }

  renderArrows(map, layer === 'wind' ? derived : null);
}

/** Wind arrows at grid points (wind layer only). */
function renderArrows(map, derived) {
  if (arrowLayer) { arrowLayer.remove(); arrowLayer = null; }
  if (!derived) return;
  arrowLayer = L.layerGroup();
  cache.points.forEach((p, i) => {
    const d = derived[i];
    if (!d || d.wind == null) return;
    const icon = L.divIcon({
      className: 'wx-arrow-wrap',
      // The glyph is a down-pointing triangle (= bearing 180°). Wind dir is
      // where it comes FROM; we want it pointing where it GOES (dir+180), so
      // rotate by (dir+180)−180 = dir.
      html: `<div class="wx-arrow" style="transform:rotate(${d.windDir % 360}deg)"></div>`,
      iconSize: [18, 18], iconAnchor: [9, 9],
    });
    arrowLayer.addLayer(L.marker([p.lat, p.lon], { icon, interactive: false }));
  });
  arrowLayer.addTo(map);
}

export function clear(map) {
  if (overlay && map.hasLayer(overlay)) overlay.remove();
  if (arrowLayer) { arrowLayer.remove(); arrowLayer = null; }
}

/**
 * Hook map movement: when the viewport leaves the cached grid, refetch
 * (debounced) and re-render via the callback.
 */
export function watchMap(map, getModel, onReady) {
  map.on('moveend', () => {
    clearTimeout(debounceT);
    debounceT = setTimeout(async () => {
      if (!covered(map, getModel()) && await ensureGrid(map, getModel())) onReady();
    }, REFETCH_DEBOUNCE);
  });
}

/** Legend spec for the active layer: [{color, label}] */
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
    case 'wind':
      return { title: 'Wind km/h', items: [[10, '10'], [20, '20'], [30, '30'], [45, '45+']]
        .map(([v, l]) => ({ color: fmt(ramp(WIND_STOPS, v)), label: l })) };
    default:
      return null;
  }
}
