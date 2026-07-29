// map.js — the radar screen itself.
//
// Leaflet with raster tiles, like Sky Monkeys: no WebGL, works on every iPad
// and phone in the fleet. Everything above the tiles is drawn from the same
// aircraft list every refresh:
//
//   • one rotated aircraft symbol per hex, coloured by altitude
//   • an optional trail of where it has been since the app opened
//   • for the selected flight, the great-circle route and its two airports
//
// Between the 5-second position refreshes the symbols are dead-reckoned forward
// from the last fix using ground speed and track, so the picture moves the way
// a radar picture moves instead of stepping every five seconds.

import { altColor, planeSvg, sizeFor } from './aircraft.js';
import { alt as fmtAlt, ago as fmtAgo } from './fmt.js';

const BASES = {
  Dark: () => L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    { attribution: '© OpenStreetMap · © CARTO', subdomains: 'abcd', maxZoom: 19 }),
  Satellite: () => L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Imagery © Esri, Maxar', maxZoom: 18 }),
  Light: () => L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    { attribution: '© OpenStreetMap · © CARTO', subdomains: 'abcd', maxZoom: 19 }),
};

const TRAIL_MAX = 120;          // ~10 min of history at a 5 s refresh
const DR_MS = 250;              // dead-reckoning tick
const KT_TO_DEG_LAT = 1 / 60;   // 1 NM ≈ 1' of latitude

let map = null;
let planeLayer = null, trailLayer = null, routeLayer = null;
let markers = new Map();        // hex → {marker, state, fix}
let trails = new Map();         // hex → [[lat,lon], …]
let drTimer = null;
let onSelect = null;
let onFollowOff = null;
let showLabels = true, showTrails = true;
let selectedHex = null;
let followSelected = false;

export function getMap() { return map; }

export function initMap(id, { center, zoom, onSelectAircraft, onMove, onFollowCancelled }) {
  if (!window.L || map) return map;
  onSelect = onSelectAircraft;
  onFollowOff = onFollowCancelled;

  map = L.map(id, {
    zoomControl: false,
    attributionControl: true,
    worldCopyJump: true,
    fadeAnimation: false,
    preferCanvas: true,
  }).setView([center.lat, center.lon], zoom);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const bases = {};
  for (const [name, make] of Object.entries(BASES)) bases[name] = make();
  bases.Dark.addTo(map);
  L.control.layers(bases, {}, { position: 'bottomright', collapsed: true }).addTo(map);

  trailLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  planeLayer = L.layerGroup().addTo(map);

  // Tapping empty map clears the selection — same gesture as closing the sheet.
  map.on('click', () => onSelect && onSelect(null));
  map.on('moveend zoomend', () => { if (onMove) onMove(); });

  // Dragging the map is the user taking the wheel. Follow re-centres four times
  // a second, so leaving it on would drag the view straight back and make the
  // map feel broken. `dragstart` only fires for real gestures — panTo and
  // setView don't trigger it — so following can't cancel itself.
  map.on('dragstart', () => cancelFollow());

  // A map built in a hidden tab, a rotated iPad or a standalone PWA restored
  // from the background comes back with a stale container size — Leaflet only
  // re-measures when told to, and until it does the view (and therefore the
  // area we ask the feed for) is wrong.
  const resize = () => map.invalidateSize({ animate: false });
  window.addEventListener('resize', () => setTimeout(resize, 120));
  window.addEventListener('orientationchange', () => setTimeout(resize, 300));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(resize, 60);
  });

  startDeadReckoning();
  return map;
}

export function setLabels(v) { showLabels = v; }
export function setTrails(v) {
  showTrails = v;
  if (!v) { trails.clear(); trailLayer.clearLayers(); }
}
export function setFollow(v) { followSelected = v; }
export function getFollow() { return followSelected; }

/**
 * Stop following, because the user asked the map to go somewhere else.
 * Silent when follow wasn't on, so callers can use it unconditionally.
 */
export function cancelFollow() {
  if (!followSelected) return false;
  followSelected = false;
  if (onFollowOff) onFollowOff();
  return true;
}

/** "just now" / "12m ago" — how stale a last-known position is. */
function ghostAge(ac) {
  return fmtAgo(ac.lastSeenAt);
}

/** Icon HTML: the rotated silhouette plus an upright tag beside it. */
function iconFor(ac, selected) {
  const color = ac.ghost ? '#9aa6bd' : altColor(ac.alt);
  const svg = planeSvg({
    color, track: ac.track, scale: sizeFor(ac.type),
    selected, ground: ac.onGround, ghost: ac.ghost,
  });
  const second = ac.ghost ? `last seen ${ghostAge(ac)}` : fmtAlt(ac.alt, ac.onGround);
  const tag = showLabels
    ? `<span class="plane-tag${selected ? ' sel' : ''}${ac.ghost ? ' ghost' : ''}">${ac.callsign || ac.reg}<b>${second}</b></span>`
    : '';
  const size = Math.round(30 * sizeFor(ac.type));
  return L.divIcon({
    html: `<div class="plane-wrap${selected ? ' selected' : ''}${ac.ghost ? ' ghost' : ''}">${svg}${tag}</div>`,
    className: 'plane-icon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Cheap signature of everything that affects the drawn icon. */
function sigOf(ac, selected) {
  const ghostBit = ac.ghost ? `g${ghostAge(ac)}` : '';
  return `${Math.round(ac.track || 0)}|${Math.round((ac.alt || 0) / 200)}|${ac.onGround ? 1 : 0}|${selected ? 1 : 0}|${showLabels ? 1 : 0}|${ac.callsign}|${ghostBit}`;
}

/**
 * Draw one snapshot.
 * @param {Array} list normalised aircraft
 * @param {string|null} selHex
 */
export function render(list, selHex) {
  if (!map) return;
  selectedHex = selHex;
  const seen = new Set();

  for (const ac of list) {
    if (!Number.isFinite(ac.lat) || !Number.isFinite(ac.lon)) continue;
    seen.add(ac.hex);
    const selected = ac.hex === selectedHex;
    const sig = sigOf(ac, selected);
    let rec = markers.get(ac.hex);

    if (!rec) {
      const marker = L.marker([ac.lat, ac.lon], {
        icon: iconFor(ac, selected),
        keyboard: false,
        zIndexOffset: selected ? 1000 : 0,
        riseOnHover: true,
      });
      marker.on('click', (e) => {
        L.DomEvent.stopPropagation(e);
        if (onSelect) onSelect(ac.hex);
      });
      marker.addTo(planeLayer);
      rec = { marker, sig, fix: null };
      markers.set(ac.hex, rec);
    } else {
      rec.marker.setLatLng([ac.lat, ac.lon]);
      if (rec.sig !== sig) {
        rec.marker.setIcon(iconFor(ac, selected));
        rec.sig = sig;
      }
      rec.marker.setZIndexOffset(selected ? 1000 : 0);
    }

    // Remember the fix so the dead-reckoning tick can move it along. A ghost
    // gets no fix: we have no idea where it went after it stopped transmitting,
    // and flying its symbol onward would be inventing data.
    rec.fix = ac.ghost ? null : {
      lat: ac.lat, lon: ac.lon, gs: ac.gs || 0, track: ac.track,
      at: Date.now(), ground: ac.onGround,
    };

    if (showTrails && !ac.ghost) {
      const t = trails.get(ac.hex) || [];
      const last = t[t.length - 1];
      if (!last || Math.abs(last[0] - ac.lat) > 1e-5 || Math.abs(last[1] - ac.lon) > 1e-5) {
        t.push([ac.lat, ac.lon]);
        if (t.length > TRAIL_MAX) t.shift();
        trails.set(ac.hex, t);
      }
    }
  }

  // Drop anything that left the area.
  for (const [hex, rec] of markers) {
    if (!seen.has(hex)) {
      planeLayer.removeLayer(rec.marker);
      markers.delete(hex);
      trails.delete(hex);
    }
  }

  drawTrails();
}

function drawTrails() {
  trailLayer.clearLayers();
  if (!showTrails) return;
  for (const [hex, pts] of trails) {
    if (pts.length < 2) continue;
    const sel = hex === selectedHex;
    // Only the selected aircraft gets a full-strength trail; the rest stay faint
    // so a busy TMA doesn't turn into spaghetti.
    L.polyline(pts, {
      color: sel ? '#ffffff' : '#5ec2ff',
      weight: sel ? 2.4 : 1.2,
      opacity: sel ? 0.9 : 0.35,
      interactive: false,
      smoothFactor: 1.5,
    }).addTo(trailLayer);
  }
}

/** Move the symbols along their track between position updates. */
function startDeadReckoning() {
  if (drTimer) return;
  drTimer = setInterval(() => {
    if (document.visibilityState !== 'visible' || !map) return;
    for (const [, rec] of markers) {
      const f = rec.fix;
      if (!f || f.ground || !f.gs || f.gs < 40 || !Number.isFinite(f.track)) continue;
      const hrs = (Date.now() - f.at) / 3_600_000;
      if (hrs > 0.02) continue;                 // stale fix — leave it where it is
      const nmGone = f.gs * hrs;
      const rad = f.track * Math.PI / 180;
      const dLat = nmGone * Math.cos(rad) * KT_TO_DEG_LAT;
      const dLon = nmGone * Math.sin(rad) * KT_TO_DEG_LAT
        / Math.max(0.2, Math.cos(f.lat * Math.PI / 180));
      rec.marker.setLatLng([f.lat + dLat, f.lon + dLon]);
    }
    if (followSelected && selectedHex) {
      const rec = markers.get(selectedHex);
      if (rec) map.panTo(rec.marker.getLatLng(), { animate: false });
    }
  }, DR_MS);
}

/**
 * Draw the selected flight's route: origin → aircraft solid, aircraft →
 * destination dashed, with a labelled dot at each airport.
 */
export function drawRoute(ac, route) {
  routeLayer.clearLayers();
  if (!ac || !route) return;
  const here = [ac.lat, ac.lon];
  const o = route.origin, d = route.destination;

  if (o && Number.isFinite(o.lat)) {
    L.polyline([[o.lat, o.lon], here], {
      color: '#5ec2ff', weight: 2, opacity: 0.75, interactive: false,
    }).addTo(routeLayer);
    airportDot(o, 'from').addTo(routeLayer);
  }
  if (d && Number.isFinite(d.lat)) {
    L.polyline([here, [d.lat, d.lon]], {
      color: '#ef5da8', weight: 2, opacity: 0.7, dashArray: '7 6', interactive: false,
    }).addTo(routeLayer);
    airportDot(d, 'to').addTo(routeLayer);
  }
}

function airportDot(ap, kind) {
  return L.marker([ap.lat, ap.lon], {
    interactive: false,
    icon: L.divIcon({
      className: 'apt-icon',
      html: `<div class="apt ${kind}"><span class="apt-dot"></span>
        <span class="apt-lbl">${ap.iata || ap.icao}<b>${ap.city || ap.name || ''}</b></span></div>`,
      iconSize: [10, 10],
      iconAnchor: [5, 5],
    }),
  });
}

export function clearRoute() { if (routeLayer) routeLayer.clearLayers(); }

/** Frame the whole route (both airports plus the aircraft). */
export function fitRoute(ac, route) {
  if (!map || !ac) return;
  const pts = [[ac.lat, ac.lon]];
  if (route && route.origin && Number.isFinite(route.origin.lat)) pts.push([route.origin.lat, route.origin.lon]);
  if (route && route.destination && Number.isFinite(route.destination.lat)) pts.push([route.destination.lat, route.destination.lon]);
  if (pts.length < 2) { map.setView(pts[0], Math.max(map.getZoom(), 8)); return; }
  map.fitBounds(L.latLngBounds(pts).pad(0.18), { animate: true });
}

/** Frame several points at once — used when a search names more than one aircraft. */
export function fitPoints(points) {
  if (!map || !points || !points.length) return;
  if (points.length === 1) { map.setView(points[0], Math.max(map.getZoom(), 7)); return; }
  map.fitBounds(L.latLngBounds(points).pad(0.25), { animate: true });
}

export function panTo(lat, lon, zoom) {
  if (!map) return;
  map.setView([lat, lon], zoom || map.getZoom(), { animate: true });
}
