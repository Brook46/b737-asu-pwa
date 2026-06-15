// map.js — MapLibre 3D terrain map + per-pilot markers.
//
// MapLibre GL JS is loaded globally from the CDN (see index.html) as `maplibregl`.
// We keep one HTML marker per pilot (small crew → DOM markers are simplest and
// let us tint by colour + swap the state glyph trivially).

import { MAPTILER_KEY, TERRAIN_TILES } from '../config.js';
import { markerEl, updateMarkerEl } from './icons.js';

let map = null;
let ready = false;
const queue = [];                 // ops deferred until style loads
const markers = new Map();        // pilotId -> { marker, el, state, color }
let meMarker = null;
let onPilotTap = () => {};
let onBgTap = () => {};

export function onBackgroundClick(fn) { onBgTap = fn || onBgTap; }

// Build a style object. Prefer MapTiler outdoor (great for terrain); else fall
// back to keyless OpenFreeMap 'liberty' vector style.
function styleURL() {
  if (MAPTILER_KEY) return `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${MAPTILER_KEY}`;
  return 'https://tiles.openfreemap.org/styles/liberty';
}

export function initMap(containerId, center = [8.0, 46.5], onTap) {
  if (map) return map;
  onPilotTap = onTap || onPilotTap;

  // Right-to-left text plugin so Hebrew/Arabic place names render correctly
  // (without it MapLibre draws them reversed/garbled). Lazy, load-once.
  try {
    if (maplibregl.getRTLTextPluginStatus && maplibregl.getRTLTextPluginStatus() === 'unavailable') {
      maplibregl.setRTLTextPlugin('https://unpkg.com/@mapbox/mapbox-gl-rtl-text@0.2.3/mapbox-gl-rtl-text.min.js', null, true);
    }
  } catch (err) { console.warn('RTL plugin skipped', err); }

  map = new maplibregl.Map({
    container: containerId,
    style: styleURL(),
    center,
    zoom: 12,
    pitch: 45,
    bearing: 0,
    maxPitch: 75,
    attributionControl: { compact: true },
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');

  // Tapping the map background (not a marker) closes overlays like the panel.
  map.on('click', () => onBgTap());

  // Terrain + trail layers need the style loaded; markers don't (they're DOM
  // overlays), so we flush the marker queue as soon as the map object exists —
  // a slow or failed basemap can never strand pilots off the map.
  map.on('load', () => { addTerrain(); setupTrails(); });
  ready = true;
  queue.splice(0).forEach((fn) => fn());

  return map;
}

// ---------- Trails (each pilot's recent track, air + ground) ----------
const trails = new Map();          // id -> { color, pts: [[lng,lat], …] }
const TRAIL_MAX = 200;
let trailsReady = false;

function setupTrails() {
  if (map.getSource('pilot-trails')) { trailsReady = true; return; }
  map.addSource('pilot-trails', { type: 'geojson', data: trailFC() });
  map.addLayer({
    id: 'pilot-trails-line',
    type: 'line',
    source: 'pilot-trails',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'color'], 'line-width': 3, 'line-opacity': 0.55 },
  });
  trailsReady = true;
  refreshTrails();
}

function trailFC() {
  return {
    type: 'FeatureCollection',
    features: [...trails.entries()].filter(([, t]) => t.pts.length > 1).map(([, t]) => ({
      type: 'Feature',
      properties: { color: t.color || '#29b6f6' },
      geometry: { type: 'LineString', coordinates: t.pts },
    })),
  };
}

function refreshTrails() {
  const src = trailsReady && map.getSource('pilot-trails');
  if (src) src.setData(trailFC());
}

function pushTrail(id, lng, lat, color) {
  if (lng == null || lat == null) return;
  let t = trails.get(id);
  if (!t) { t = { color, pts: [] }; trails.set(id, t); }
  if (color) t.color = color;
  const last = t.pts[t.pts.length - 1];
  if (!last || Math.abs(last[0] - lng) > 1e-6 || Math.abs(last[1] - lat) > 1e-6) {
    t.pts.push([lng, lat]);
    if (t.pts.length > TRAIL_MAX) t.pts.shift();
    refreshTrails();
  }
}

// Add a DEM source + 3D terrain + a sky layer for the paragliding feel.
function addTerrain() {
  try {
    if (!map.getSource('terrain-dem')) {
      map.addSource('terrain-dem', {
        type: 'raster-dem',
        tiles: [TERRAIN_TILES],
        encoding: 'terrarium',
        tileSize: 256,
        maxzoom: 14,
      });
    }
    map.setTerrain({ source: 'terrain-dem', exaggeration: 1.3 });
    // Sky: MapLibre exposes this via setSky() (not an addLayer type). Guard for
    // versions that don't support it.
    if (typeof map.setSky === 'function') {
      map.setSky({
        'sky-color': '#0a1730',
        'sky-horizon-blend': 0.5,
        'horizon-color': '#88a7d0',
        'horizon-fog-blend': 0.6,
        'fog-color': '#0d1422',
        'fog-ground-blend': 0.4,
      });
    }
  } catch (err) {
    console.warn('terrain unavailable', err);
  }
}

function whenReady(fn) { if (ready) fn(); else queue.push(fn); }

// Place / move my own marker. We center on the very first fix, then leave the
// camera alone so the map doesn't fight the user's panning (that felt "stuck").
// The recenter button re-centers on demand.
let centeredOnce = false;
export function setMe(lng, lat, state, color, nickname, seats = 0) {
  whenReady(() => {
    if (!meMarker) {
      const el = markerEl(state, color, nickname || 'You', seats);
      el.classList.add('is-me');
      meMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat]).addTo(map);
    } else {
      meMarker.setLngLat([lng, lat]);
      updateMarkerEl(meMarker.getElement(), state, color, nickname || 'You', seats);
    }
    pushTrail('me', lng, lat, color);
    if (!centeredOnce) { centeredOnce = true; map.easeTo({ center: [lng, lat], duration: 600 }); }
  });
}

// Toggle the distress pulse on my own marker.
export function setMeSOS(on) {
  whenReady(() => meMarker?.getElement().classList.toggle('is-sos', !!on));
}

// Create or update another pilot's marker.
export function upsertPilot(p) {
  whenReady(() => {
    if (p.lng == null || p.lat == null) return;
    let m = markers.get(p.id);
    if (!m) {
      const el = markerEl(p.state, p.color, p.nickname, p.seats);
      el.addEventListener('click', () => onPilotTap(p.id));
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([p.lng, p.lat]).addTo(map);
      markers.set(p.id, { marker, el });
    } else {
      m.marker.setLngLat([p.lng, p.lat]);
      updateMarkerEl(m.el, p.state, p.color, p.nickname, p.seats);
    }
    const el = markers.get(p.id)?.el;
    if (el) el.classList.toggle('is-sos', !!p.sos);
    pushTrail(p.id, p.lng, p.lat, p.color);
  });
}

export function removePilot(id) {
  const m = markers.get(id);
  if (m) { m.marker.remove(); markers.delete(id); }
  if (trails.delete(id)) refreshTrails();
}

export function setPilotVisible(id, visible) {
  const m = markers.get(id);
  if (m) m.el.style.display = visible ? '' : 'none';
}

export function flyToPilot(lng, lat) {
  whenReady(() => map.flyTo({ center: [lng, lat], zoom: 13, duration: 800 }));
}

export function recenterMe() {
  const ll = meMarker?.getLngLat();
  if (ll) whenReady(() => map.easeTo({ center: ll, zoom: Math.max(map.getZoom(), 13), duration: 600 }));
}
