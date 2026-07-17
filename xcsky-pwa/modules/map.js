// map.js — the full-screen map: base layers, KK7 thermal/skyways overlays,
// live pilots (OGN), and tap-to-set-forecast-point. One Leaflet instance,
// built lazily on first open and reused.
//
// KK7 (thermal.kk7.ch) publishes thermal-hotspot and skyways tiles for free
// hotlinking with a `src=` attribution parameter and CORS `*`.

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
  'Thermals (KK7)': () => L.tileLayer(
    `https://thermal.kk7.ch/tiles/thermals_all_all/{z}/{x}/{y}.png?src=${SRC}`,
    { attribution: 'thermal.kk7.ch', tms: true, maxNativeZoom: 12, maxZoom: 18, opacity: 0.8 }),
  'Skyways (KK7)': () => L.tileLayer(
    `https://thermal.kk7.ch/tiles/skyways_all_all/{z}/{x}/{y}.png?src=${SRC}`,
    { attribution: 'thermal.kk7.ch', tms: true, maxNativeZoom: 12, maxZoom: 18, opacity: 0.8 }),
};

const POLL_MS = 20 * 1000;

let map = null;
let spotMarker = null;       // the forecast point
let pilotLayer = null;       // L.layerGroup of live pilots
let pilotTimer = null;
let pilotsOn = true;
let soaringOnly = true;      // hide jets/GA clutter by default
let onPickCb = null;

export function isBuilt() { return !!map; }
export function getSoaringOnly() { return soaringOnly; }
export function setSoaringOnly(v) { soaringOnly = v; refreshPilots(); }

/** Build (once) and refresh the big map. */
export function openMap(containerId, { center, onPick }) {
  if (!window.L) return null;
  onPickCb = onPick;
  if (map) {
    map.setView([center.lat, center.lon], map.getZoom() || 11);
    setSpot(center);
    setTimeout(() => map.invalidateSize({ animate: false }), 60);
    startPolling();
    return map;
  }
  map = L.map(containerId, { zoomControl: true, attributionControl: true, fadeAnimation: false })
    .setView([center.lat, center.lon], 11);

  const bases = {}, overlays = {};
  for (const [name, make] of Object.entries(BASES)) bases[name] = make();
  for (const [name, make] of Object.entries(OVERLAYS)) overlays[name] = make();
  bases.Satellite.addTo(map);
  overlays['Thermals (KK7)'].addTo(map);

  pilotLayer = L.layerGroup().addTo(map);
  overlays['Live pilots'] = pilotLayer;
  L.control.layers(bases, overlays, { collapsed: true }).addTo(map);

  setSpot(center);
  map.on('click', (e) => {
    const p = { lat: e.latlng.lat, lon: e.latlng.lng };
    setSpot(p);
    onPickCb && onPickCb(p);
  });
  map.on('moveend', () => { if (pilotsActive()) refreshPilots(); });
  map.on('overlayadd', (e) => { if (e.layer === pilotLayer) { pilotsOn = true; startPolling(); } });
  map.on('overlayremove', (e) => { if (e.layer === pilotLayer) { pilotsOn = false; stopPolling(); } });

  // Sheet/slide-in sizing (same lesson as the old picker): re-measure as the
  // container reaches its final size.
  const el = document.getElementById(containerId);
  const settle = () => map && map.invalidateSize({ animate: false });
  if (window.ResizeObserver && el) new ResizeObserver(settle).observe(el);
  [120, 400].forEach((t) => setTimeout(settle, t));

  startPolling();
  return map;
}

export function closeMap() { stopPolling(); }

export function setSpot(p) {
  if (!map) return;
  const icon = L.divIcon({ className: '', html: '<div class="pick-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
  if (!spotMarker) spotMarker = L.marker([p.lat, p.lon], { icon }).addTo(map);
  else spotMarker.setLatLng([p.lat, p.lon]);
}

// ── live pilots ───────────────────────────────────────────────────────────
function pilotsActive() { return pilotsOn && map && map.hasLayer(pilotLayer); }

function startPolling() {
  stopPolling();
  if (!pilotsActive()) return;
  refreshPilots();
  pilotTimer = setInterval(refreshPilots, POLL_MS);
}
function stopPolling() {
  if (pilotTimer) { clearInterval(pilotTimer); pilotTimer = null; }
}

let lastCount = 0;
export function getPilotCount() { return lastCount; }

async function refreshPilots() {
  if (!pilotsActive()) return;
  let pilots;
  try { pilots = await fetchPilots(map.getBounds()); }
  catch { return; } // transient network error — keep last markers
  if (!pilotsActive()) return;

  const shown = soaringOnly ? pilots.filter((p) => SOARING_TYPES.has(p.type)) : pilots;
  lastCount = shown.length;
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
