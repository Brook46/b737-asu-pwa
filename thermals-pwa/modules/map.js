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

  // Default is a flat 2D map — fast and smooth on phones. 3D terrain is heavy,
  // so it's opt-in via the 3D button (set3D below).
  map = new maplibregl.Map({
    container: containerId,
    style: styleURL(),
    center,
    zoom: 12,
    pitch: 0,
    bearing: 0,
    maxPitch: 75,
    attributionControl: { compact: true },
  });

  map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left');

  // Tapping the map background (not a marker) closes overlays like the panel.
  map.on('click', () => onBgTap());

  // Trail layers need the style loaded; markers don't (they're DOM overlays), so
  // we flush the marker queue as soon as the map object exists — a slow or
  // failed basemap can never strand pilots off the map.
  map.on('load', () => { styleLoaded = true; setupTrails(); if (want3D) apply3D(true); });
  ready = true;
  queue.splice(0).forEach((fn) => fn());

  return map;
}

// ---------- 3D terrain (opt-in; off by default to stay smooth) ----------
let styleLoaded = false;
let want3D = false;

export function is3D() { return want3D; }
export function toggle3D() { set3D(!want3D); return want3D; }
export function set3D(on) {
  want3D = !!on;
  if (styleLoaded) apply3D(want3D);
}

function apply3D(on) {
  try {
    if (on) {
      if (!map.getSource('terrain-dem')) {
        map.addSource('terrain-dem', {
          type: 'raster-dem', tiles: [TERRAIN_TILES], encoding: 'terrarium', tileSize: 256, maxzoom: 12,
        });
      }
      map.setTerrain({ source: 'terrain-dem', exaggeration: 1.2 });
      if (typeof map.setSky === 'function') {
        map.setSky({ 'sky-color': '#0a1730', 'horizon-color': '#88a7d0', 'fog-color': '#0d1422', 'horizon-fog-blend': 0.6 });
      }
      map.easeTo({ pitch: 60, duration: 600 });
    } else {
      map.setTerrain(null);
      map.easeTo({ pitch: 0, duration: 600 });
    }
  } catch (err) { console.warn('3D toggle failed', err); }
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

function whenReady(fn) { if (ready) fn(); else queue.push(fn); }

// Place / move my own marker. We center on the very first fix, then leave the
// camera alone so the map doesn't fight the user's panning (that felt "stuck").
// The recenter button re-centers on demand.
let centeredOnce = false;
export function setMe(lng, lat, state, color, nickname, seats = 0, vario = null) {
  whenReady(() => {
    if (!meMarker) {
      const el = markerEl(state, color, nickname || 'You', seats, vario);
      el.classList.add('is-me');
      meMarker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([lng, lat]).addTo(map);
    } else {
      meMarker.setLngLat([lng, lat]);
      updateMarkerEl(meMarker.getElement(), state, color, nickname || 'You', seats, vario);
    }
    pushTrail('me', lng, lat, color);
    if (!centeredOnce) { centeredOnce = true; map.easeTo({ center: [lng, lat], duration: 600 }); }
  });
}

// Toggle the distress pulse on my own marker.
export function setMeSOS(on) {
  whenReady(() => meMarker?.getElement().classList.toggle('is-sos', !!on));
}

// King of the day: a crown on whichever pilot has flown furthest today.
let kingId = null;
export function setKing(id) {
  kingId = id;
  whenReady(() => markers.forEach((m, pid) => m.el.classList.toggle('is-king', pid === kingId)));
}
export function setMeKing(on) {
  whenReady(() => meMarker?.getElement().classList.toggle('is-king', !!on));
}

// Create or update another pilot's marker.
export function upsertPilot(p) {
  whenReady(() => {
    if (p.lng == null || p.lat == null) return;
    // An SOS swaps the icon to the distress glyph, whatever they were doing.
    const glyphState = p.sos ? 'SOS' : p.state;
    let m = markers.get(p.id);
    if (!m) {
      const el = markerEl(glyphState, p.color, p.nickname, p.seats, p.vario);
      el.addEventListener('click', () => onPilotTap(p.id));
      const marker = new maplibregl.Marker({ element: el, anchor: 'bottom' })
        .setLngLat([p.lng, p.lat]).addTo(map);
      markers.set(p.id, { marker, el });
    } else {
      m.marker.setLngLat([p.lng, p.lat]);
      updateMarkerEl(m.el, glyphState, p.color, p.nickname, p.seats, p.vario);
    }
    const el = markers.get(p.id)?.el;
    if (el) { el.classList.toggle('is-sos', !!p.sos); el.classList.toggle('is-king', p.id === kingId); }
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
