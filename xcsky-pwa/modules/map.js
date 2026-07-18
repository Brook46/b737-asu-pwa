// map.js — the always-on main map: base layers, KK7 thermal/skyways overlays,
// live pilots (OGN), the forecast-point marker, and tap-to-move-the-point.
// The weather grid overlay (the main feature) is painted on top by grid.js.
//
// KK7 (thermal.kk7.ch) publishes thermal-hotspot and skyways tiles for free
// hotlinking with a `src=` attribution parameter, CORS `*`, TMS tile scheme.

import { fetchPilots, typeColor, TYPE_NAMES, SOARING_TYPES, ageLabel } from './pilots.js';
import { fetchStations, windColor, ageMin } from './stations.js';
import { fetchWebcams, hasKey as hasWindyKey } from './webcams.js';
import { alt as fmtAlt, wind as fmtWind, climb as fmtClimb } from './units.js';

const OPENAIP_KEY_LS = 'xcsky.openaipKey';
export function hasOpenaipKey() { return !!localStorage.getItem(OPENAIP_KEY_LS); }

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
let wsLayer = null, wsTimer = null;   // wind stations (Pioupiou)
let wcLayer = null;                    // webcams (Windy)
let airspaceLayer = null;              // airspace tiles (OpenAIP)

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

  // Extra data overlays (off by default). Airspace + webcams need a free key.
  wsLayer = L.layerGroup();
  overlays['Wind stations'] = wsLayer;
  wcLayer = L.layerGroup();
  overlays['Webcams'] = wcLayer;
  airspaceLayer = L.tileLayer(airspaceUrl(), {
    attribution: 'Airspace © OpenAIP', maxZoom: 14, opacity: 0.9, tileSize: 256,
  });
  overlays['Airspace (CTR/NFZ)'] = airspaceLayer;

  L.control.layers(bases, overlays, { collapsed: true, position: 'topright' }).addTo(map);

  setSpot(center);
  map.on('click', (e) => {
    // The app decides what a click means (move the forecast point, or drop a
    // task turnpoint in plan mode), so it owns setSpot — we don't move it here.
    onPickCb && onPickCb({ lat: e.latlng.lat, lon: e.latlng.lng });
  });
  map.on('moveend', () => {
    if (pilotsActive()) refreshPilots();
    if (map.hasLayer(wsLayer)) refreshStations();
    if (map.hasLayer(wcLayer)) refreshWebcams();
  });
  map.on('overlayadd', (e) => {
    if (e.layer === pilotLayer) startPolling();
    else if (e.layer === wsLayer) startStations();
    else if (e.layer === wcLayer) {
      if (!hasWindyKey()) { map.removeLayer(wcLayer); needKey('webcams'); }
      else refreshWebcams();
    } else if (e.layer === airspaceLayer && !hasOpenaipKey()) {
      map.removeLayer(airspaceLayer); needKey('airspace');
    }
  });
  map.on('overlayremove', (e) => {
    if (e.layer === pilotLayer) stopPolling();
    else if (e.layer === wsLayer) stopStations();
  });

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

// ── live wind stations (Pioupiou) ────────────────────────────────────────────
function startStations() { stopStations(); refreshStations(); wsTimer = setInterval(refreshStations, 2 * 60 * 1000); }
function stopStations() { if (wsTimer) { clearInterval(wsTimer); wsTimer = null; } }

async function refreshStations() {
  if (!map.hasLayer(wsLayer) || document.hidden) return;
  let sts;
  try { sts = await fetchStations(map.getBounds()); }
  catch { return; }
  if (!map.hasLayer(wsLayer)) return;
  wsLayer.clearLayers();
  for (const s of sts) {
    const color = windColor(s.avg);
    const dir = (s.dir == null) ? 0 : (s.dir + 180) % 360;   // arrow blows downwind
    const html = `<div class="ws-marker" style="--c:${color}">
      <span class="ws-arrow" style="transform:rotate(${dir}deg)"></span>
      <span class="ws-spd">${Math.round(s.avg)}</span></div>`;
    const icon = L.divIcon({ className: 'ws-icon', html, iconSize: [34, 20], iconAnchor: [17, 10] });
    const mk = L.marker([s.lat, s.lon], { icon });
    const age = ageMin(s.date);
    mk.bindPopup(
      `<b>${s.name}</b><br>` +
      `${fmtWind(s.avg)} avg · gust ${fmtWind(s.max)}<br>` +
      `from ${compassOf(s.dir)}${age != null ? ` · ${age} min ago` : ''}<br>` +
      `<span style="opacity:.7">Pioupiou</span>`
    );
    wsLayer.addLayer(mk);
  }
}

// ── webcams (Windy) ──────────────────────────────────────────────────────────
async function refreshWebcams() {
  if (!map.hasLayer(wcLayer) || document.hidden) return;
  let cams;
  try { cams = await fetchWebcams(map.getBounds()); }
  catch { return; }
  if (!map.hasLayer(wcLayer)) return;
  wcLayer.clearLayers();
  for (const w of cams) {
    const icon = L.divIcon({ className: 'wc-icon', html: '<div class="wc-pin">◉</div>', iconSize: [22, 22], iconAnchor: [11, 11] });
    const mk = L.marker([w.lat, w.lon], { icon });
    mk.bindPopup(
      `<b>${w.title}</b><br><img src="${w.thumb}" width="220" style="border-radius:8px;display:block;margin:4px 0"/>` +
      `<a href="${w.link}" target="_blank" rel="noopener">Open on Windy ↗</a>`,
      { maxWidth: 240 });
    wcLayer.addLayer(mk);
  }
}

// ── airspace (OpenAIP tiles) ─────────────────────────────────────────────────
function airspaceUrl() {
  const k = localStorage.getItem(OPENAIP_KEY_LS) || 'none';
  return `https://api.tiles.openaip.net/api/data/openaip/{z}/{x}/{y}.png?apiKey=${k}`;
}
/** Re-point the airspace tiles after a key is entered, and (re)enable overlays. */
export function refreshKeys() {
  if (airspaceLayer) airspaceLayer.setUrl(airspaceUrl());
  if (map && map.hasLayer(wcLayer)) refreshWebcams();
}

function needKey(which) {
  document.dispatchEvent(new CustomEvent('needkey', { detail: { which } }));
}

function compassOf(deg) {
  if (deg == null) return '—';
  const d = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return d[Math.round(deg / 22.5) % 16];
}
