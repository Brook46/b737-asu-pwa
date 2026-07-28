// map3d.js — the 3D flight canvas: MapLibre terrain + deck.gl track geometry.
//
// Why this stack: MapLibre GL JS is the keyless fork of Mapbox GL JS and does
// real 3D terrain from any raster-DEM source. AWS's open Terrain Tiles
// (terrarium encoding, s3://elevation-tiles-prod) give global 90 m elevation
// with no token, no account and no rate limit — the same keyless approach the
// rest of this suite takes. deck.gl rides *interleaved* in MapLibre's own WebGL
// context, so tracks are depth-tested against the terrain mesh: a line behind a
// ridge is genuinely hidden by it, which is the whole point of a 3D debrief.
//
// Everything here degrades rather than dies: no WebGL, no deck.gl, a DEM tile
// 404 — the app says so and keeps working in 2D.

import { segmentColors, hexToRgb } from './colors.js';
import { HIGHLIGHT_META } from './highlights.js';

/** Keyless raster basemaps. Attribution is a licence condition, not decoration. */
export const BASEMAPS = [
  {
    id: 'satellite', label: 'Satellite',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics',
  },
  {
    id: 'topo', label: 'Topo',
    tiles: [
      'https://a.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://b.tile.opentopomap.org/{z}/{x}/{y}.png',
      'https://c.tile.opentopomap.org/{z}/{x}/{y}.png',
    ],
    maxzoom: 17, attribution: '© OpenTopoMap (CC-BY-SA), © OpenStreetMap contributors',
  },
  {
    id: 'relief', label: 'Relief',
    tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Hillshade/MapServer/tile/{z}/{y}/{x}'],
    maxzoom: 16, attribution: 'Hillshade © Esri',
  },
];

const DEM = {
  tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
  encoding: 'terrarium',
  maxzoom: 15,
  attribution: 'Elevation: AWS Terrain Tiles / Mapzen',
};

/** Seconds of track drawn as a bright "recent" trail behind each glider. */
const TRAIL_SEC = 75;
/** Length of the heading vector ahead of each glider avatar, metres. */
const VECTOR_M = 260;

let map = null;
let overlay = null;
let deckReady = false;

const state = {
  tracks: [],
  colorMode: 'vario',
  basemap: 'satellite',
  exaggeration: 1,
  showShadow: true,
  showHighlights: true,
  camera: 'free',          // 'free' | 'follow' | 'chase'
  followId: null,
  snapshot: null,          // last timeline tick
  staticLayers: [],        // cached track geometry (rebuilt only on change)
  onPick: null,
};

// ── boot ────────────────────────────────────────────────────────────────────

/**
 * @param {string} containerId
 * @param {{center?:[number,number], zoom?:number, onPick?:Function}} [opts]
 * @returns {Promise<maplibregl.Map>}
 */
export function init(containerId, opts = {}) {
  if (typeof maplibregl === 'undefined') {
    return Promise.reject(new Error('MapLibre failed to load — check your connection and reload.'));
  }
  if (!hasWebGL()) {
    return Promise.reject(new Error('This device has no usable WebGL, so the 3D canvas cannot start.'));
  }

  state.onPick = opts.onPick || null;

  map = new maplibregl.Map({
    container: containerId,
    style: buildStyle(),
    center: opts.center || [8.9, 46.0],
    zoom: opts.zoom || 11,
    pitch: 62,
    bearing: 0,
    maxPitch: 85,
    antialias: true,
    // Required so the export engine can read pixels back out of the canvas
    // after a frame has been composited.
    preserveDrawingBuffer: true,
    attributionControl: { compact: true },
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'bottom-right');
  map.dragRotate.enable();
  map.touchZoomRotate.enableRotation();

  return new Promise((resolve, reject) => {
    let settled = false;
    // 'style.load', not 'load': `load` waits for the first full tile render,
    // which never arrives while the tab is backgrounded (MapLibre drives it off
    // requestAnimationFrame). 'style.load' fires as soon as the sources and
    // layers exist, which is all we need to attach terrain and deck.gl — and it
    // means a flight opened in a background tab is still ready when you get to it.
    map.once('style.load', () => {
      settled = true;
      applyTerrain();
      applySky();
      attachDeck();
      resolve(map);
    });
    map.once('error', (e) => {
      // Tile errors after startup are non-fatal (one missing tile is not a
      // broken app), so only reject if we never got off the ground.
      if (!settled) reject(new Error(readableMapError(e)));
    });
  });
}

/**
 * Probe for a usable WebGL context.
 *
 * MapLibre v4 dropped the old `maplibregl.supported()` helper, so we ask the
 * browser directly. Each attempt needs its own canvas: once a canvas has handed
 * out a webgl2 context it will return null for 'webgl', which would make a
 * perfectly capable device look unsupported.
 */
function hasWebGL() {
  for (const type of ['webgl2', 'webgl']) {
    try {
      const canvas = document.createElement('canvas');
      if (canvas.getContext(type)) return true;
    } catch { /* try the next context type */ }
  }
  return false;
}

function buildStyle() {
  const sources = { dem: { type: 'raster-dem', ...DEM, tileSize: 256 } };
  const layers = [{ id: 'bg', type: 'background', paint: { 'background-color': '#0a0f1a' } }];

  for (const b of BASEMAPS) {
    sources[b.id] = {
      type: 'raster', tiles: b.tiles, tileSize: 256,
      maxzoom: b.maxzoom, attribution: b.attribution,
    };
    layers.push({
      id: `base-${b.id}`, type: 'raster', source: b.id,
      layout: { visibility: b.id === state.basemap ? 'visible' : 'none' },
      paint: { 'raster-fade-duration': 200 },
    });
  }

  return { version: 8, sources, layers };
}

function applyTerrain() {
  try {
    map.setTerrain({ source: 'dem', exaggeration: state.exaggeration });
  } catch (err) {
    console.warn('terrain unavailable', err);
  }
}

/** MapLibre gained setSky in a later minor; the horizon is cosmetic, so guard it. */
function applySky() {
  if (typeof map.setSky !== 'function') return;
  try {
    map.setSky({
      'sky-color': '#0a2a55', 'horizon-color': '#8fb8dd',
      'fog-color': '#c7d6e5', 'fog-ground-blend': 0.55, 'sky-horizon-blend': 0.6,
    });
  } catch { /* older style spec — skip */ }
}

function attachDeck() {
  if (typeof deck === 'undefined' || !deck.MapboxOverlay) {
    console.warn('deck.gl unavailable — tracks will not render');
    return;
  }
  try {
    overlay = new deck.MapboxOverlay({
      interleaved: true,            // depth-test tracks against the terrain
      layers: [],
      getTooltip: null,
      onClick: (info) => {
        if (state.onPick && info && info.object) state.onPick(info.object, info);
      },
    });
    map.addControl(overlay);
    deckReady = true;
  } catch (err) {
    // Interleaving needs the custom-layer API to behave; overlaid mode always
    // works but loses terrain occlusion. Better degraded than blank.
    console.warn('interleaved deck.gl failed, falling back to overlaid', err);
    try {
      overlay = new deck.MapboxOverlay({ interleaved: false, layers: [] });
      map.addControl(overlay);
      deckReady = true;
    } catch (err2) {
      console.error('deck.gl could not attach', err2);
    }
  }
}

function readableMapError(e) {
  const msg = (e && e.error && e.error.message) || (e && e.message) || '';
  if (/webgl/i.test(msg)) return 'WebGL could not start — the 3D canvas is unavailable on this device.';
  return `Map failed to start${msg ? `: ${msg}` : '.'}`;
}

export const getMap = () => map;
export const isReady = () => !!map && map.loaded();
export const getCanvas = () => (map ? map.getCanvas() : null);

// ── basemap / terrain controls ──────────────────────────────────────────────

export function setBasemap(id) {
  if (!map || !BASEMAPS.some((b) => b.id === id)) return;
  state.basemap = id;
  for (const b of BASEMAPS) {
    if (map.getLayer(`base-${b.id}`)) {
      map.setLayoutProperty(`base-${b.id}`, 'visibility', b.id === id ? 'visible' : 'none');
    }
  }
}

export function setExaggeration(x) {
  state.exaggeration = Math.max(0, Math.min(3, Number(x) || 0));
  if (map) applyTerrain();
}

export const getExaggeration = () => state.exaggeration;

// ── track geometry ──────────────────────────────────────────────────────────

/**
 * Give the map the current set of tracks. Geometry is packed into typed arrays
 * once per change — a two-hour flight is ~4 000 segments per pilot, and
 * allocating an object per segment every frame would drop frames on an iPad.
 *
 * @param {import('../types').FlightTrack[]} tracks
 */
export function setTracks(tracks) {
  state.tracks = tracks || [];
  for (const t of state.tracks) buildGeometry(t);
  rebuildStatic();
  render();
}

export function setColorMode(mode) {
  state.colorMode = mode;
  for (const t of state.tracks) {
    if (t._geo) t._geo.colors = segmentColors(t, mode);
  }
  rebuildStatic();
  render();
}

export function setShowShadow(on) { state.showShadow = !!on; rebuildStatic(); render(); }
export function setShowHighlights(on) { state.showHighlights = !!on; rebuildStatic(); render(); }

/**
 * Pack one track into GPU-ready buffers.
 *
 * `zNudge` lifts each track a couple of metres more than the last so two pilots
 * flying wingtip-to-wingtip don't z-fight into a shimmering mess.
 */
function buildGeometry(track) {
  const pts = track.points;
  const n = pts.length;
  const segs = Math.max(0, n - 1);
  const key = track.altSource === 'gps' ? 'gpsAlt' : 'pressureAlt';
  const zNudge = (state.tracks.indexOf(track) + 1) * 2;

  const src = new Float32Array(segs * 3);
  const tgt = new Float32Array(segs * 3);
  const ground = new Float32Array(segs * 3);
  let hasGround = true;

  for (let i = 0; i < segs; i++) {
    const a = pts[i], b = pts[i + 1];
    src[i * 3] = a.lng; src[i * 3 + 1] = a.lat; src[i * 3 + 2] = a[key] + zNudge;
    tgt[i * 3] = b.lng; tgt[i * 3 + 1] = b.lat; tgt[i * 3 + 2] = b[key] + zNudge;
    if (typeof a.groundAlt === 'number') {
      // +8 m so the shadow sits on the terrain instead of inside it.
      ground[i * 3] = a.lng; ground[i * 3 + 1] = a.lat; ground[i * 3 + 2] = a.groundAlt + 8;
    } else {
      hasGround = false;
    }
  }

  track._geo = {
    segs, src, tgt,
    ground: hasGround ? ground : null,
    groundTgt: hasGround ? shiftGround(ground, segs) : null,
    colors: segmentColors(track, state.colorMode),
  };
}

/** Ground-shadow segments need their own target array (next sample's ground). */
function shiftGround(ground, segs) {
  const out = new Float32Array(segs * 3);
  for (let i = 0; i < segs; i++) {
    const j = Math.min(i + 1, segs - 1);
    out[i * 3] = ground[j * 3]; out[i * 3 + 1] = ground[j * 3 + 1]; out[i * 3 + 2] = ground[j * 3 + 2];
  }
  return out;
}

/** Static layers: the tracks themselves, their ground shadows, highlight pins. */
function rebuildStatic() {
  if (!deckReady) return;
  const layers = [];

  for (const track of state.tracks) {
    if (track.visible === false || !track._geo) continue;
    const geo = track._geo;
    if (!geo.segs) continue;
    const rgb = hexToRgb(track.color);

    // Ground shadow first, so the track draws over it.
    if (state.showShadow && geo.ground) {
      layers.push(new deck.LineLayer({
        id: `shadow-${track.id}`,
        data: {
          length: geo.segs,
          attributes: {
            getSourcePosition: { value: geo.ground, size: 3 },
            getTargetPosition: { value: geo.groundTgt, size: 3 },
          },
        },
        getColor: [...rgb, 70],
        getWidth: 2,
        widthUnits: 'pixels',
        parameters: { depthTest: true },
      }));
    }

    layers.push(new deck.LineLayer({
      id: `track-${track.id}`,
      data: {
        length: geo.segs,
        attributes: {
          getSourcePosition: { value: geo.src, size: 3 },
          getTargetPosition: { value: geo.tgt, size: 3 },
          getColor: { value: geo.colors, size: 4 },
        },
      },
      getWidth: 3.2,
      widthUnits: 'pixels',
      widthMinPixels: 2,
      parameters: { depthTest: true },
    }));
  }

  if (state.showHighlights) {
    const pins = [];
    const stems = [];
    for (const track of state.tracks) {
      if (track.visible === false) continue;
      const key = track.altSource === 'gps' ? 'gpsAlt' : 'pressureAlt';
      for (const h of track.highlights || []) {
        const p = track.points[h.index ?? 0];
        if (!p) continue;
        const meta = HIGHLIGHT_META[h.type];
        pins.push({
          position: [p.lng, p.lat, p[key] + 12],
          rgb: meta ? meta.rgb : [255, 255, 255],
          highlight: h, track,
          kind: 'highlight',
        });
        if (typeof p.groundAlt === 'number') {
          stems.push({
            from: [p.lng, p.lat, p.groundAlt + 4],
            to: [p.lng, p.lat, p[key] + 12],
            rgb: meta ? meta.rgb : [255, 255, 255],
          });
        }
      }
    }

    if (stems.length) {
      layers.push(new deck.LineLayer({
        id: 'hl-stems', data: stems,
        getSourcePosition: (d) => d.from,
        getTargetPosition: (d) => d.to,
        getColor: (d) => [...d.rgb, 110],
        getWidth: 1.6, widthUnits: 'pixels',
      }));
    }
    if (pins.length) {
      layers.push(new deck.ScatterplotLayer({
        id: 'hl-pins', data: pins,
        getPosition: (d) => d.position,
        getFillColor: (d) => [...d.rgb, 235],
        getLineColor: [255, 255, 255, 230],
        lineWidthMinPixels: 1.6,
        stroked: true, filled: true, billboard: true,
        radiusUnits: 'pixels', getRadius: 7,
        radiusMinPixels: 5, radiusMaxPixels: 11,
        pickable: true,
      }));
    }
  }

  state.staticLayers = layers;
}

// ── per-frame markers ───────────────────────────────────────────────────────

/**
 * Draw the gliders at the current clock. Called on every timeline tick, so it
 * builds only small arrays (one entry per pilot, plus a short trail).
 * @param {{time:number, tracks:{track:any, sample:any}[]}} snapshot
 */
export function setMarkers(snapshot) {
  state.snapshot = snapshot;
  render();
  updateCamera(snapshot);
}

function markerLayers() {
  const snap = state.snapshot;
  if (!snap || !deckReady) return [];

  const gliders = [];
  const vectors = [];
  const labels = [];
  const trails = [];

  for (const { track, sample } of snap.tracks) {
    if (!sample) continue;
    const rgb = hexToRgb(track.color);
    const pos = [sample.lng, sample.lat, sample.alt + 6];

    gliders.push({ position: pos, rgb, track, sample, kind: 'glider' });

    // Direction vector: where the glider is pointing, in metres ahead.
    const rad = sample.heading * Math.PI / 180;
    const dLat = (VECTOR_M * Math.cos(rad)) / 111320;
    const dLng = (VECTOR_M * Math.sin(rad)) / (111320 * Math.cos(sample.lat * Math.PI / 180));
    vectors.push({ from: pos, to: [sample.lng + dLng, sample.lat + dLat, sample.alt + 6], rgb });

    labels.push({
      position: [sample.lng, sample.lat, sample.alt + 6],
      text: `${track.pilotName}  ${Math.round(sample.alt)} m  ${sample.vario > 0 ? '+' : ''}${sample.vario.toFixed(1)} m/s`,
      rgb,
      // Stack the labels: pilots who flew together sit on top of each other, and
      // two overlapping labels read as neither.
      row: labels.length,
    });

    // Bright trail over the last TRAIL_SEC seconds — cheap to rebuild because
    // it's only ~75 fixes, and it makes the direction of travel unmistakable.
    const trail = trailSegments(track, sample);
    if (trail) trails.push({ track, trail, rgb });
  }

  const out = [];

  for (const { track, trail, rgb } of trails) {
    out.push(new deck.LineLayer({
      id: `trail-${track.id}`,
      data: { length: trail.count, attributes: {
        getSourcePosition: { value: trail.src, size: 3 },
        getTargetPosition: { value: trail.tgt, size: 3 },
      } },
      getColor: [...rgb, 255],
      getWidth: 6, widthUnits: 'pixels', widthMinPixels: 3,
      parameters: { depthTest: true },
    }));
  }

  if (vectors.length) {
    out.push(new deck.LineLayer({
      id: 'glider-vectors', data: vectors,
      getSourcePosition: (d) => d.from,
      getTargetPosition: (d) => d.to,
      getColor: (d) => [...d.rgb, 220],
      getWidth: 2.4, widthUnits: 'pixels',
    }));
  }

  if (gliders.length) {
    out.push(new deck.ScatterplotLayer({
      id: 'gliders', data: gliders,
      getPosition: (d) => d.position,
      getFillColor: (d) => [...d.rgb, 255],
      getLineColor: [12, 16, 24, 255],
      lineWidthMinPixels: 2,
      stroked: true, filled: true, billboard: true,
      radiusUnits: 'pixels', getRadius: 9,
      radiusMinPixels: 7, radiusMaxPixels: 14,
      pickable: true,
    }));

    // TextLayer builds its atlas from an explicit character set; pilot names can
    // contain anything, so derive it from the labels actually on screen.
    const chars = new Set();
    for (const l of labels) for (const ch of l.text) chars.add(ch);
    out.push(new deck.TextLayer({
      id: 'glider-labels', data: labels,
      getPosition: (d) => d.position,
      getText: (d) => d.text,
      getColor: [255, 255, 255, 235],
      getSize: 12,
      sizeUnits: 'pixels',
      getPixelOffset: (d) => [0, -20 - d.row * 15],
      background: true,
      getBackgroundColor: [10, 15, 26, 190],
      backgroundPadding: [5, 3, 5, 3],
      fontFamily: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif',
      fontWeight: 600,
      characterSet: [...chars],
      outlineWidth: 0,
    }));
  }

  return out;
}

/** The last TRAIL_SEC seconds of flown track, as line segments. */
function trailSegments(track, sample) {
  const pts = track.points;
  const key = track.altSource === 'gps' ? 'gpsAlt' : 'pressureAlt';
  const end = sample.index;
  const tEnd = pts[end].timestamp;
  let start = end;
  while (start > 0 && tEnd - pts[start].timestamp < TRAIL_SEC * 1000) start--;
  const count = end - start;
  if (count < 1) return null;

  const src = new Float32Array(count * 3);
  const tgt = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const a = pts[start + i], b = pts[start + i + 1];
    src[i * 3] = a.lng; src[i * 3 + 1] = a.lat; src[i * 3 + 2] = a[key] + 7;
    tgt[i * 3] = b.lng; tgt[i * 3 + 1] = b.lat; tgt[i * 3 + 2] = b[key] + 7;
  }
  return { count, src, tgt };
}

function render() {
  if (!overlay || !deckReady) return;
  overlay.setProps({ layers: [...state.staticLayers, ...markerLayers()] });
}

// ── camera ──────────────────────────────────────────────────────────────────

export function setCamera(mode, trackId) {
  state.camera = mode;
  state.followId = trackId || (state.tracks[0] && state.tracks[0].id) || null;
  if (state.snapshot) updateCamera(state.snapshot);
}

export const getCamera = () => ({ mode: state.camera, followId: state.followId });

/**
 * Follow / chase cameras use jumpTo, not easeTo: at 10× playback an eased
 * camera lags a second behind the glider and the marker walks off screen.
 */
function updateCamera(snapshot) {
  if (!map || state.camera === 'free' || !snapshot) return;
  const entry = snapshot.tracks.find((e) => e.track.id === state.followId && e.sample)
    || snapshot.tracks.find((e) => e.sample);
  if (!entry) return;
  const s = entry.sample;

  if (state.camera === 'follow') {
    map.jumpTo({ center: [s.lng, s.lat] });
  } else {
    map.jumpTo({
      center: [s.lng, s.lat],
      bearing: s.heading,
      pitch: 72,
      zoom: Math.max(map.getZoom(), 13.2),
    });
  }
}

// ── framing ─────────────────────────────────────────────────────────────────

/** Fit the camera to every visible track. */
export function fitTracks(tracks, opts = {}) {
  if (!map) return;
  const list = (tracks || state.tracks).filter((t) => t.visible !== false && t.points.length);
  if (!list.length) return;

  let w = 180, e = -180, s = 90, n = -90;
  for (const t of list) {
    // Stride through long tracks — 20 000 fixes give the same bounds as 2 000.
    const stride = Math.max(1, Math.floor(t.points.length / 2000));
    for (let i = 0; i < t.points.length; i += stride) {
      const p = t.points[i];
      if (p.lng < w) w = p.lng;
      if (p.lng > e) e = p.lng;
      if (p.lat < s) s = p.lat;
      if (p.lat > n) n = p.lat;
    }
  }
  if (w > e || s > n) return;

  // Camera animations are driven by requestAnimationFrame, which is paused in a
  // backgrounded tab — an animated fit would silently never happen and the
  // pilot would return to a view with their flight off-screen. Jump instead.
  const hidden = typeof document !== 'undefined' && document.visibilityState === 'hidden';

  map.fitBounds([[w, s], [e, n]], {
    padding: { top: 90, bottom: 240, left: 60, right: 60 },
    pitch: opts.pitch ?? 58,
    bearing: opts.bearing ?? map.getBearing(),
    duration: hidden ? 0 : (opts.duration ?? 900),
    maxZoom: 15,
  });
}

/** Frame a single moment — used when a highlight is selected. */
export function focusPoint(lng, lat, alt, opts = {}) {
  if (!map) return;
  state.camera = 'free';
  map.easeTo({
    center: [lng, lat],
    zoom: opts.zoom ?? 14,
    pitch: opts.pitch ?? 70,
    bearing: opts.bearing ?? map.getBearing(),
    duration: opts.duration ?? 900,
  });
}

/** Slow orbit for the export intro; returns a stop function. */
export function orbit(degPerSec = 9) {
  if (!map) return () => {};
  let raf = 0, last = performance.now();
  const step = (now) => {
    const dt = (now - last) / 1000;
    last = now;
    map.setBearing(map.getBearing() + degPerSec * dt);
    raf = requestAnimationFrame(step);
  };
  raf = requestAnimationFrame(step);
  return () => cancelAnimationFrame(raf);
}

export function resize() { if (map) map.resize(); }
