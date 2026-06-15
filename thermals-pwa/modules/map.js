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
let followMe = true;

// Build a style object. Prefer MapTiler outdoor (great for terrain); else fall
// back to keyless OpenFreeMap 'liberty' vector style.
function styleURL() {
  if (MAPTILER_KEY) return `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${MAPTILER_KEY}`;
  return 'https://tiles.openfreemap.org/styles/liberty';
}

export function initMap(containerId, center = [8.0, 46.5], onTap) {
  if (map) return map;
  onPilotTap = onTap || onPilotTap;
  map = new maplibregl.Map({
    container: containerId,
    style: styleURL(),
    center,
    zoom: 11,
    pitch: 62,
    bearing: 0,
    maxPitch: 80,
    attributionControl: { compact: true },
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');

  // Dragging the map opts you out of follow-me until you recenter.
  map.on('dragstart', () => { followMe = false; });

  // Terrain needs the style loaded; markers don't (they're DOM overlays), so we
  // flush the marker queue as soon as the map object exists — that way a slow or
  // failed basemap can never strand pilots off the map.
  map.on('load', addTerrain);
  ready = true;
  queue.splice(0).forEach((fn) => fn());

  return map;
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

// Place / move my own marker. Distinct ring so I can find myself.
export function setMe(lng, lat, state, color, nickname) {
  whenReady(() => {
    if (!meMarker) {
      const el = markerEl(state, color, nickname || 'You');
      el.classList.add('is-me');
      meMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat]).addTo(map);
    } else {
      meMarker.setLngLat([lng, lat]);
      updateMarkerEl(meMarker.getElement(), state, color, nickname || 'You');
    }
    if (followMe) map.easeTo({ center: [lng, lat], duration: 600 });
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
      const el = markerEl(p.state, p.color, p.nickname);
      el.addEventListener('click', () => onPilotTap(p.id));
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([p.lng, p.lat]).addTo(map);
      markers.set(p.id, { marker, el });
    } else {
      m.marker.setLngLat([p.lng, p.lat]);
      updateMarkerEl(m.el, p.state, p.color, p.nickname);
    }
    const el = markers.get(p.id)?.el;
    if (el) el.classList.toggle('is-sos', !!p.sos);
  });
}

export function removePilot(id) {
  const m = markers.get(id);
  if (m) { m.marker.remove(); markers.delete(id); }
}

export function setPilotVisible(id, visible) {
  const m = markers.get(id);
  if (m) m.el.style.display = visible ? '' : 'none';
}

export function flyToPilot(lng, lat) {
  whenReady(() => map.flyTo({ center: [lng, lat], zoom: 13, duration: 800 }));
}

export function recenterMe() {
  followMe = true;
  const ll = meMarker?.getLngLat();
  if (ll) whenReady(() => map.easeTo({ center: ll, duration: 600 }));
}
