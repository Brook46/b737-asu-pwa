// map3d.js — the 3D view: MapLibre terrain with the traffic flying above it.
//
// Same stack as Thermal Debrief, for the same reasons: MapLibre GL JS is the
// keyless fork of Mapbox GL JS and does real 3D terrain from any raster-DEM
// source, AWS's open Terrain Tiles give global 90 m elevation with no token or
// account, and deck.gl rides *interleaved* in MapLibre's own WebGL context so
// geometry is depth-tested against the terrain mesh — an aircraft behind a
// ridge is genuinely hidden by it.
//
// Two deliberate differences from the 2D map:
//
//   • The libraries load on demand, the first time 3D is asked for. They are
//     roughly a megabyte between them, and the whole point of the Leaflet map
//     is that this app starts instantly on any device — so nobody pays for 3D
//     until they want it.
//   • Aircraft sit at their real altitude, 1:1, with a thin line down to the
//     ground. No vertical exaggeration: the drop line is what makes the height
//     readable, and stretching altitude would misplace the aeroplane over the
//     terrain it is actually above.
//
// Everything degrades rather than dies: no WebGL, a CDN that won't load, a DEM
// tile 404 — the caller is told and the 2D map carries on.

import { altColor, sizeFor, silhouetteSvg, silhouetteKey, SILHOUETTE_KEYS } from './aircraft.js?v=16';
import { alt as fmtAlt } from './fmt.js?v=16';

const LIBS = [
  { url: 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css', css: true },
  { url: 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js', check: () => window.maplibregl },
  { url: 'https://unpkg.com/deck.gl@9.0.35/dist.min.js', check: () => window.deck },
];

const DEM = {
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium',
  maxzoom: 15,
  attribution: 'Elevation: AWS Terrain Tiles / Mapzen',
};

const BASE = {
  dark: {
    tiles: ['https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      'https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png',
      'https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png'],
    maxzoom: 19, attribution: '© OpenStreetMap · © CARTO',
  },
  satellite: {
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 18, attribution: 'Imagery © Esri, Maxar',
  },
};

const FT_TO_M = 0.3048;
const ATLAS_CELL = 64;

let map = null;
let overlay = null;
let atlas = null;
let iconMapping = null;
let onPick = null;
let traffic = [];
let selectedHex = null;
let routeGeom = null;   // {track:[[lon,lat,alt]], toOrigin:[], toDest:[], airports:[]}
let basemap = 'dark';

/** Is a 3D view possible on this device at all? */
export function hasWebGL() {
  for (const type of ['webgl2', 'webgl']) {
    try {
      const canvas = document.createElement('canvas');
      if (canvas.getContext(type)) return true;
    } catch { /* try the next context type */ }
  }
  return false;
}

export function isOpen() { return !!map; }
export function getMap() { return map; }

// ── loading the libraries, once ─────────────────────────────────────────────

let libsPromise = null;

function loadOne(lib) {
  return new Promise((resolve, reject) => {
    if (lib.check && lib.check()) return resolve();
    const el = lib.css ? document.createElement('link') : document.createElement('script');
    if (lib.css) { el.rel = 'stylesheet'; el.href = lib.url; } else { el.src = lib.url; el.async = false; }
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`could not load ${lib.url.split('/').pop()}`));
    document.head.appendChild(el);
  });
}

function loadLibs() {
  if (libsPromise) return libsPromise;
  // Sequential on purpose: deck.gl expects the mapping library to be present.
  libsPromise = LIBS.reduce((chain, lib) => chain.then(() => loadOne(lib)), Promise.resolve())
    .catch((err) => { libsPromise = null; throw err; });
  return libsPromise;
}

// ── the icon atlas ──────────────────────────────────────────────────────────

/**
 * One canvas holding every silhouette in white, which deck.gl tints per
 * aircraft. Built once; if an SVG fails to rasterise its cell is simply empty
 * rather than taking the view down with it.
 */
function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS_CELL * SILHOUETTE_KEYS.length;
  canvas.height = ATLAS_CELL;
  const ctx = canvas.getContext('2d');
  const mapping = {};
  return Promise.all(SILHOUETTE_KEYS.map((key, i) => new Promise((resolve) => {
    mapping[key] = {
      x: i * ATLAS_CELL, y: 0, width: ATLAS_CELL, height: ATLAS_CELL,
      anchorX: ATLAS_CELL / 2, anchorY: ATLAS_CELL / 2, mask: true,
    };
    const img = new Image();
    img.onload = () => { ctx.drawImage(img, i * ATLAS_CELL, 0, ATLAS_CELL, ATLAS_CELL); resolve(); };
    img.onerror = () => resolve();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(silhouetteSvg(key))}`;
  }))).then(() => { atlas = canvas; iconMapping = mapping; });
}

// ── start-up ────────────────────────────────────────────────────────────────

function style() {
  const b = BASE[basemap];
  return {
    version: 8,
    sources: {
      dem: { type: 'raster-dem', ...DEM, tileSize: 256 },
      base: { type: 'raster', tiles: b.tiles, tileSize: 256, maxzoom: b.maxzoom, attribution: b.attribution },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': '#070b14' } },
      { id: 'base', type: 'raster', source: 'base', paint: { 'raster-fade-duration': 200 } },
    ],
  };
}

/**
 * Mount the 3D view.
 * @param {string} containerId
 * @param {{center:{lat,lon}, zoom:number, onSelect:Function}} opts
 */
export async function open(containerId, { center, zoom, onSelect }) {
  if (map) return map;
  if (!hasWebGL()) throw new Error('This device has no usable WebGL, so the 3D view cannot start.');
  await loadLibs();
  if (!atlas) await buildAtlas();
  onPick = onSelect || null;

  map = new maplibregl.Map({
    container: containerId,
    style: style(),
    center: [center.lon, center.lat],
    zoom: Math.max(4, (zoom || 8) - 0.5),
    pitch: 62,
    bearing: 0,
    maxPitch: 85,
    antialias: true,
    attributionControl: { compact: true },
  });
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  map.dragRotate.enable();
  map.touchZoomRotate.enableRotation();

  await new Promise((resolve, reject) => {
    let settled = false;
    // 'style.load', not 'load': `load` waits for a full tile render, which never
    // arrives while the tab is backgrounded.
    map.once('style.load', () => {
      settled = true;
      try { map.setTerrain({ source: 'dem', exaggeration: 1 }); } catch { /* flat is fine */ }
      try {
        map.setSky({
          'sky-color': '#0d1b34', 'horizon-color': '#20304d',
          'fog-color': '#070b14', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.7,
        });
      } catch { /* older MapLibre: no sky, no loss */ }
      attachDeck();
      resolve();
    });
    map.once('error', (e) => {
      if (!settled) reject(new Error(readableError(e)));
    });
  });

  // The container is unhidden a moment before this runs, so make MapLibre
  // re-measure rather than trust the size it saw at construction.
  try { map.resize(); } catch { /* nothing to re-measure yet */ }
  paint();
  return map;
}

/** Re-measure after the container is shown again. */
export function resize() {
  try { if (map) map.resize(); } catch { /* ignore */ }
}

function attachDeck() {
  if (typeof deck === 'undefined' || !deck.MapboxOverlay) return;
  try {
    overlay = new deck.MapboxOverlay({ interleaved: true, layers: [] });
    map.addControl(overlay);
  } catch {
    // Interleaving needs a compatible context; overlaid still draws, it just
    // won't be occluded by terrain.
    try {
      overlay = new deck.MapboxOverlay({ interleaved: false, layers: [] });
      map.addControl(overlay);
    } catch { overlay = null; }
  }
}

function readableError(e) {
  const msg = String((e && e.error && e.error.message) || (e && e.message) || e || '');
  if (/webgl/i.test(msg)) return 'WebGL could not start — the 3D view is unavailable on this device.';
  return msg || 'The 3D view could not start.';
}

export function close() {
  try { if (overlay && map) map.removeControl(overlay); } catch { /* going away anyway */ }
  overlay = null;
  try { if (map) map.remove(); } catch { /* ditto */ }
  map = null;
  traffic = [];
  routeGeom = null;
}

// ── what gets drawn ─────────────────────────────────────────────────────────

const rgbOf = (css) => {
  const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(css);
  if (m) return [+m[1], +m[2], +m[3]];
  const h = /^#([0-9a-f]{6})$/i.exec(css);
  if (h) {
    const n = parseInt(h[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  return [200, 210, 225];
};

const altM = (ac) => (Number.isFinite(ac.alt) && !ac.onGround ? ac.alt * FT_TO_M : 0);

export function setTraffic(list, selHex) {
  traffic = Array.isArray(list) ? list.filter((a) => Number.isFinite(a.lat)) : [];
  selectedHex = selHex || null;
  paint();
}

/**
 * The selected aircraft's route in three dimensions: the flown track at the
 * altitudes it was actually at, the dashed-equivalent legs to the airports, and
 * a marker at each end.
 */
export function setRoute(ac, route, track) {
  if (!ac) { routeGeom = null; paint(); return; }
  const pts = (track || []).filter((p) => Number.isFinite(p.lat))
    .map((p) => [p.lon, p.lat, Number.isFinite(p.alt) ? p.alt * FT_TO_M : 0]);
  pts.push([ac.lon, ac.lat, altM(ac)]);
  const o = route && route.origin, d = route && route.destination;
  routeGeom = {
    track: pts.length >= 2 ? pts : null,
    toOrigin: o && Number.isFinite(o.lat) && pts.length
      ? [[o.lon, o.lat, 0], pts[0]] : null,
    toDest: d && Number.isFinite(d.lat)
      ? [[ac.lon, ac.lat, altM(ac)], [d.lon, d.lat, 0]] : null,
    airports: [o, d].filter((a) => a && Number.isFinite(a.lat))
      .map((a) => ({ name: a.iata || a.icao, position: [a.lon, a.lat, 0] })),
  };
  paint();
}

function paint() {
  if (!overlay) return;
  const L = [];

  // The line down to the ground is what makes altitude readable: without it a
  // symbol in the sky is just a symbol somewhere.
  L.push(new deck.LineLayer({
    id: 'drop-lines',
    data: traffic,
    getSourcePosition: (d) => [d.lon, d.lat, 0],
    getTargetPosition: (d) => [d.lon, d.lat, altM(d)],
    getColor: (d) => [...rgbOf(altColor(d.alt)), d.hex === selectedHex ? 150 : 60],
    getWidth: (d) => (d.hex === selectedHex ? 2 : 1),
    updateTriggers: { getColor: selectedHex, getWidth: selectedHex },
  }));

  if (routeGeom) {
    if (routeGeom.toOrigin) {
      L.push(new deck.LineLayer({
        id: 'to-origin',
        data: [routeGeom.toOrigin],
        getSourcePosition: (d) => d[0],
        getTargetPosition: (d) => d[1],
        getColor: [94, 194, 255, 110],
        getWidth: 1.5,
      }));
    }
    if (routeGeom.toDest) {
      L.push(new deck.LineLayer({
        id: 'to-dest',
        data: [routeGeom.toDest],
        getSourcePosition: (d) => d[0],
        getTargetPosition: (d) => d[1],
        getColor: [239, 93, 168, 160],
        getWidth: 2,
      }));
    }
    if (routeGeom.track) {
      L.push(new deck.PathLayer({
        id: 'flown-track',
        data: [routeGeom.track],
        getPath: (d) => d,
        getColor: [255, 255, 255, 210],
        getWidth: 3,
        widthUnits: 'pixels',
        capRounded: true,
        jointRounded: true,
      }));
    }
    if (routeGeom.airports.length) {
      L.push(new deck.ScatterplotLayer({
        id: 'airports',
        data: routeGeom.airports,
        getPosition: (d) => d.position,
        getFillColor: [94, 194, 255, 220],
        getRadius: 5,
        radiusUnits: 'pixels',
      }));
      L.push(new deck.TextLayer({
        id: 'airport-labels',
        data: routeGeom.airports,
        getPosition: (d) => d.position,
        getText: (d) => d.name || '',
        getSize: 12,
        getColor: [230, 240, 255, 230],
        getPixelOffset: [0, -12],
        fontFamily: '-apple-system, system-ui, sans-serif',
        fontWeight: 700,
        billboard: true,
      }));
    }
  }

  // Aircraft lie flat in the horizontal plane at their altitude — a plan-view
  // silhouette floating at height, so the heading still reads as a heading.
  L.push(new deck.IconLayer({
    id: 'aircraft',
    data: traffic,
    iconAtlas: atlas,
    iconMapping,
    getIcon: (d) => silhouetteKey(d.kind, d.type, d.category),
    getPosition: (d) => [d.lon, d.lat, altM(d)],
    getSize: (d) => 30 * sizeFor(d.type, d.category) * (d.hex === selectedHex ? 1.25 : 1),
    sizeUnits: 'pixels',
    getColor: (d) => (d.hex === selectedHex ? [255, 255, 255, 255] : [...rgbOf(altColor(d.alt)), 255]),
    getAngle: (d) => -(Number.isFinite(d.track) ? d.track : 0),
    billboard: false,
    pickable: true,
    onClick: (info) => { if (info && info.object && onPick) onPick(info.object.hex); },
    updateTriggers: {
      getColor: selectedHex, getSize: selectedHex,
      getAngle: traffic.length, getPosition: traffic.length,
    },
  }));

  L.push(new deck.TextLayer({
    id: 'labels',
    data: traffic,
    getPosition: (d) => [d.lon, d.lat, altM(d)],
    getText: (d) => `${d.reg || d.callsign || ''}\n${fmtAlt(d.alt, d.onGround)}`,
    getSize: (d) => (d.hex === selectedHex ? 12 : 10.5),
    getColor: (d) => (d.hex === selectedHex ? [255, 255, 255, 240] : [214, 224, 240, 195]),
    getPixelOffset: [0, -22],
    fontFamily: '-apple-system, system-ui, sans-serif',
    fontWeight: 600,
    outlineWidth: 2,
    outlineColor: [0, 0, 0, 220],
    fontSettings: { sdf: true },
    billboard: true,
    updateTriggers: { getColor: selectedHex, getSize: selectedHex },
  }));

  overlay.setProps({ layers: L });
}

// ── view state, shared with the 2D map ──────────────────────────────────────

export function getView() {
  if (!map) return null;
  const c = map.getCenter();
  return { lat: c.lat, lon: c.lng, zoom: map.getZoom() };
}

export function flyTo(lat, lon, zoom) {
  if (!map) return;
  map.easeTo({ center: [lon, lat], zoom: zoom || map.getZoom(), duration: 600 });
}

/** Frame an aircraft and its destination, keeping the tilt. */
export function fitPoints(points) {
  if (!map || !points || points.length < 2) return;
  const b = new maplibregl.LngLatBounds();
  for (const [lat, lon] of points) b.extend([lon, lat]);
  map.fitBounds(b, { padding: 80, pitch: map.getPitch(), bearing: map.getBearing(), duration: 700 });
}

export function setBasemap(id) {
  if (!BASE[id] || !map) return;
  basemap = id;
  map.setStyle(style());
  map.once('style.load', () => {
    try { map.setTerrain({ source: 'dem', exaggeration: 1 }); } catch { /* flat is fine */ }
    attachDeck();
    paint();
  });
}

export function getBasemap() { return basemap; }
