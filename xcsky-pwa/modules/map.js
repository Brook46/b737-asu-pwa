// map.js — the always-on main map: base layers, KK7 thermal/skyways overlays,
// live pilots (OGN), the forecast-point marker, and tap-to-move-the-point.
// The weather grid overlay (the main feature) is painted on top by grid.js.
//
// KK7 (thermal.kk7.ch) publishes thermal-hotspot and skyways tiles for free
// hotlinking with a `src=` attribution parameter, CORS `*`, TMS tile scheme.

import { fetchPilots, typeColor, TYPE_NAMES, SOARING_TYPES, ageLabel } from './pilots.js';
import { alt as fmtAlt, wind as fmtWind, climb as fmtClimb } from './units.js';

const SRC = 'brook46.github.io';
const BASES = {
  Satellite: () => L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Imagery © Esri, Maxar', maxZoom: 18 }),
  Topo: () => L.tileLayer(
    'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    { attribution: '© OpenStreetMap · © OpenTopoMap (CC-BY-SA)', maxZoom: 17 }),
};
const OVERLAYS = {
  // KK7 serves TMS-scheme tiles (y counts from the south) — hence tms:true.
  'Thermal hotspots (KK7)': () => L.tileLayer(
    `https://thermal.kk7.ch/tiles/thermals_all_all/{z}/{x}/{y}.png?src=${SRC}`,
    { attribution: 'thermal.kk7.ch', tms: true, maxNativeZoom: 12, maxZoom: 18, opacity: 0.8 }),
  'Skyways (KK7)': () => L.tileLayer(
    `https://thermal.kk7.ch/tiles/skyways_all_all/{z}/{x}/{y}.png?src=${SRC}`,
    { attribution: 'thermal.kk7.ch', tms: true, maxNativeZoom: 12, maxZoom: 18, opacity: 0.8 }),
};

const POLL_MS = 20 * 1000;

let map = null;
let spotMarker = null;       // the forecast point
let pilotLayer = null;
let pilotTimer = null;
let soaringOnly = true;      // hide jets/GA clutter by default
let onPickCb = null;

export function getMap() { return map; }
export function getSoaringOnly() { return soaringOnly; }
export function setSoaringOnly(v) { soaringOnly = v; refreshPilots(); }

/** Build the main map once, at boot. */
export function initMainMap(containerId, { center, onPick }) {
  if (!window.L || map) return map;
  onPickCb = onPick;
  map = L.map(containerId, {
    zoomControl: false,                       // phone: pinch instead; declutter
    attributionControl: true,
    fadeAnimation: false,
  }).setView([center.lat, center.lon], 10);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const bases = {}, overlays = {};
  for (const [name, make] of Object.entries(BASES)) bases[name] = make();
  for (const [name, make] of Object.entries(OVERLAYS)) overlays[name] = make();
  bases.Satellite.addTo(map);

  pilotLayer = L.layerGroup().addTo(map);
  overlays['Live pilots (OGN)'] = pilotLayer;
  L.control.layers(bases, overlays, { collapsed: true, position: 'topright' }).addTo(map);

  setSpot(center);
  map.on('click', (e) => {
    // The app decides what a click means (move the forecast point, or drop a
    // task turnpoint in plan mode), so it owns setSpot — we don't move it here.
    onPickCb && onPickCb({ lat: e.latlng.lat, lon: e.latlng.lng });
  });
  map.on('moveend', () => { if (pilotsActive()) refreshPilots(); });
  map.on('overlayadd', (e) => { if (e.layer === pilotLayer) startPolling(); });
  map.on('overlayremove', (e) => { if (e.layer === pilotLayer) stopPolling(); });

  // Full-viewport container: settle the tile grid once layout is final.
  const el = document.getElementById(containerId);
  const settle = () => map && map.invalidateSize({ animate: false });
  if (window.ResizeObserver && el) new ResizeObserver(settle).observe(el);
  [120, 400].forEach((t) => setTimeout(settle, t));

  startPolling();
  return map;
}

export function setSpot(p) {
  if (!map) return;
  const icon = L.divIcon({ className: '', html: '<div class="pick-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  if (!spotMarker) spotMarker = L.marker([p.lat, p.lon], { icon }).addTo(map);
  else spotMarker.setLatLng([p.lat, p.lon]);
}

export function flyTo(p, zoom) {
  if (!map) return;
  map.setView([p.lat, p.lon], zoom || Math.max(map.getZoom(), 10));
  setSpot(p);
}

// ── live pilots ───────────────────────────────────────────────────────────
function pilotsActive() { return map && map.hasLayer(pilotLayer); }

function startPolling() {
  stopPolling();
  if (!pilotsActive()) return;
  refreshPilots();
  pilotTimer = setInterval(refreshPilots, POLL_MS);
}
function stopPolling() {
  if (pilotTimer) { clearInterval(pilotTimer); pilotTimer = null; }
}

async function refreshPilots() {
  if (!pilotsActive() || document.hidden) return;
  let pilots;
  try { pilots = await fetchPilots(map.getBounds()); }
  catch { return; } // transient network error — keep last markers
  if (!pilotsActive()) return;

  const shown = soaringOnly ? pilots.filter((p) => SOARING_TYPES.has(p.type)) : pilots;
  document.dispatchEvent(new CustomEvent('pilots', { detail: { count: shown.length, total: pilots.length } }));

  pilotLayer.clearLayers();
  for (const p of shown) {
    const color = typeColor(p.type);
    const moving = p.speed > 5;
    const html = moving
      ? `<div class="pilot-arrow" style="--c:${color};transform:rotate(${p.track}deg)"></div>`
      : `<div class="pilot-dot" style="--c:${color}"></div>`;
    const icon = L.divIcon({ className: 'pilot-icon', html, iconSize: [16, 16], iconAnchor: [8, 8] });
    const mk = L.marker([p.lat, p.lon], { icon });
    mk.bindTooltip(`${p.label}`, { direction: 'top', offset: [0, -8], opacity: 0.85 });
    mk.bindPopup(
      `<b>${p.reg || p.label}</b> · ${TYPE_NAMES[p.type] || '?'}<br>` +
      `${fmtAlt(p.alt)} MSL · ${fmtWind(p.speed)} · ${fmtClimb(p.climb)}<br>` +
      `<span style="opacity:.7">${ageLabel(p.ageSec)} · via OGN</span>`
    );
    pilotLayer.addLayer(mk);
  }
}
