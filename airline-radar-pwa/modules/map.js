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

import { altColor, planeSvg, sizeFor, sizeClass } from './aircraft.js?v=17';
import { alt as fmtAlt, ago as fmtAgo } from './fmt.js?v=17';
import * as runways from './runways.js?v=17';

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

// Trail length, in position reports (~5 s apart). The aircraft being watched
// keeps a long one — that's the flown track, and it's the whole point of
// selecting it — while everything else keeps just enough to show where it came
// from, so a busy area doesn't cost thousands of points to redraw every refresh.
const TRAIL_MAX = 480;          // selected: ~40 min
const TRAIL_MAX_OTHER = 120;    // everything else: ~10 min
const DR_MS = 250;              // dead-reckoning tick
const KT_TO_DEG_LAT = 1 / 60;   // 1 NM ≈ 1' of latitude

// How long a symbol may be flown forward from its last fix. Long enough to
// carry the picture across a dropped refresh or a lost signal, short enough
// that nobody is looking at a confident-looking position that is minutes of
// guesswork old.
export const DR_MAX_MS = 90 * 1000;

let map = null;
let planeLayer = null, trailLayer = null, routeLayer = null, runwayLayer = null;
let markers = new Map();        // hex → {marker, state, fix}
let trails = new Map();         // hex → [[lat,lon], …]
let tierByHex = new Map();      // hex → 1|2|3, from the last render()
let drTimer = null;
let onSelect = null;
let onStack = null;
let onFollowOff = null;
let showLabels = true, showTrails = true;
let selectedHex = null;
let followSelected = false;

export function getMap() { return map; }

export function initMap(id, { center, zoom, onSelectAircraft, onMove, onFollowCancelled, onStackTapped }) {
  if (!window.L || map) return map;
  onSelect = onSelectAircraft;
  onStack = onStackTapped;
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

  // Runways sit under everything: they're scenery, not traffic.
  runwayLayer = L.layerGroup().addTo(map);
  trailLayer = L.layerGroup().addTo(map);
  routeLayer = L.layerGroup().addTo(map);
  planeLayer = L.layerGroup().addTo(map);

  // Tapping empty map clears the selection — same gesture as closing the sheet.
  map.on('click', () => onSelect && onSelect(null));
  map.on('moveend zoomend', () => { if (onMove) onMove(); refreshRunways(); });

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

  loadTracks();
  startDeadReckoning();
  refreshRunways();
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

const STACK_PX = 22;   // how close counts as "on top of each other" on screen

/** Every drawn aircraft within STACK_PX of a point, nearest first. */
function markersNear(latlng, hexFirst) {
  if (!map) return [];
  const origin = map.latLngToContainerPoint(latlng);
  const out = [];
  for (const [hex, rec] of markers) {
    const p = map.latLngToContainerPoint(rec.marker.getLatLng());
    const d = Math.hypot(p.x - origin.x, p.y - origin.y);
    if (d <= STACK_PX) out.push({ hex, d });
  }
  out.sort((a, b) => (a.hex === hexFirst ? -1 : b.hex === hexFirst ? 1 : a.d - b.d));
  return out.map((o) => o.hex);
}

/** "just now" / "12m ago" — how stale a last-known position is. */
function ghostAge(ac) {
  return fmtAgo(ac.lastSeenAt);
}

// Tier 3 is drawn as a bare dot: no shape, no rotation, no tag, whatever the
// Labels preference says. That's the whole point of the tier — a distant
// aircraft that isn't near you, isn't your own fleet, and isn't selected earns
// no more attention than a coloured mark. The hit target is padded to 16px so
// it's still tappable at that size.
function dotIcon(ac) {
  const color = altColor(ac.alt);
  return L.divIcon({
    html: `<div class="plane-wrap dot-wrap"><span class="plane-dot" style="background:${color}"></span></div>`,
    className: 'plane-icon',
    iconSize: [16, 16],
    iconAnchor: [8, 8],
  });
}

/** Icon HTML: the rotated silhouette plus an upright tag beside it. */
function iconFor(ac, selected) {
  const tier = selected || ac.ghost ? 1 : (ac.tier || 1);
  if (tier === 3) return dotIcon(ac);
  // Tier 2 — near, but not near enough to earn a label — is the same shape at
  // reduced size and opacity. Its tag is suppressed regardless of the Labels
  // preference: forty muted tags would recreate the exact clutter tiering
  // exists to remove.
  const muted = tier === 2;
  const color = ac.ghost ? '#9aa6bd' : altColor(ac.alt);
  const baseScale = sizeFor(ac.type, ac.category);
  const scale = muted ? baseScale * 0.72 : baseScale;
  const svg = planeSvg({
    color, track: ac.track, scale,
    selected, ground: ac.onGround, ghost: ac.ghost, kind: ac.kind || 'airline',
    cls: sizeClass(ac.type, ac.category),
  });
  // The tail number leads: it names the aeroplane itself, which is what a crew
  // recognises. Flight level sits under it, and the callsign stays in the list
  // and on the detail card.
  const primary = ac.reg || ac.callsign || '';
  const second = ac.ghost ? `last seen ${ghostAge(ac)}` : fmtAlt(ac.alt, ac.onGround);
  const tag = showLabels && !muted
    ? `<span class="plane-tag${selected ? ' sel' : ''}${ac.ghost ? ' ghost' : ''}">${primary}<b>${second}</b></span>`
    : '';
  const size = Math.round(30 * scale);
  return L.divIcon({
    html: `<div class="plane-wrap${selected ? ' selected' : ''}${ac.ghost ? ' ghost' : ''}${muted ? ' muted' : ''}">${svg}${tag}</div>`,
    className: 'plane-icon',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

/** Cheap signature of everything that affects the drawn icon. */
function sigOf(ac, selected) {
  const ghostBit = ac.ghost ? `g${ghostAge(ac)}` : '';
  const tier = selected || ac.ghost ? 1 : (ac.tier || 1);
  return `${Math.round(ac.track || 0)}|${Math.round((ac.alt || 0) / 200)}|${ac.onGround ? 1 : 0}|${selected ? 1 : 0}|${showLabels ? 1 : 0}|${ac.reg || ac.callsign}|${ac.type}|${ghostBit}|t${tier}`;
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
    const tier = selected || ac.ghost ? 1 : (ac.tier || 1);
    tierByHex.set(ac.hex, tier);
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
        // Near an airport several aircraft sit within a few pixels of each
        // other and whichever happens to be on top swallows the tap. Offer the
        // whole stack instead of guessing which one was meant.
        const stack = markersNear(marker.getLatLng(), ac.hex);
        if (stack.length > 1 && onStack) onStack(stack);
        else if (onSelect) onSelect(ac.hex);
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

    // The flown track is recorded here, one point per position report, with the
    // altitude and time so it can be drawn the way the flight actually was.
    // Nothing else records it: no free ADS-B aggregator exposes a CORS-readable
    // track history, so what the app watched is the only track it can have.
    if (!ac.ghost) {
      const t = trails.get(ac.hex) || [];
      const last = t[t.length - 1];
      if (!last || Math.abs(last.lat - ac.lat) > 1e-5 || Math.abs(last.lon - ac.lon) > 1e-5) {
        t.push({ lat: ac.lat, lon: ac.lon, alt: ac.alt, at: Date.now() });
        const cap = ac.hex === selectedHex ? TRAIL_MAX : TRAIL_MAX_OTHER;
        while (t.length > cap) t.shift();
        trails.set(ac.hex, t);
      }
    }
  }

  // Drop anything that left the area — but keep the selected aircraft's track,
  // which is the one the user is watching and the one worth accumulating. It
  // survives the aircraft dipping out of a refresh or off the edge of the view.
  for (const [hex, rec] of markers) {
    if (!seen.has(hex)) {
      planeLayer.removeLayer(rec.marker);
      markers.delete(hex);
      tierByHex.delete(hex);
      if (hex !== selectedHex) trails.delete(hex);
    }
  }

  drawTrails();
  saveTracksSoon();
}

const latlngs = (pts) => pts.map((p) => [p.lat, p.lon]);

/**
 * The selected aircraft's flown track, drawn the way the flight happened:
 * coloured by the altitude it was at, so a climb, a cruise and a descent are
 * visible in the line itself.
 *
 * Drawn in chunks rather than per-point — one polyline per pair of points would
 * be hundreds of layers for a long track, and the colour barely changes between
 * two consecutive fixes anyway.
 */
function drawFlownTrack(pts, layer) {
  const CHUNK = 8;
  for (let i = 0; i < pts.length - 1; i += CHUNK) {
    const seg = pts.slice(i, Math.min(pts.length, i + CHUNK + 1));
    if (seg.length < 2) break;
    const alts = seg.map((p) => p.alt).filter((a) => Number.isFinite(a));
    const mean = alts.length ? alts.reduce((s, a) => s + a, 0) / alts.length : null;
    L.polyline(latlngs(seg), {
      color: altColor(mean),
      weight: 3.4,
      opacity: 0.95,
      interactive: false,
      lineCap: 'round',
      smoothFactor: 1,
    }).addTo(layer);
  }
}

function drawTrails() {
  trailLayer.clearLayers();
  if (!showTrails) return;
  for (const [hex, pts] of trails) {
    if (pts.length < 2) continue;
    // The selected aircraft's track is drawn by drawRoute, in altitude colours
    // and alongside the rest of its route; here we only draw the others.
    if (hex === selectedHex) continue;
    // A trail behind a tier-3 dot is the exact clutter tiering exists to
    // remove — a faint line pointing at something too far away to matter.
    if (tierByHex.get(hex) === 3) continue;
    L.polyline(latlngs(pts), {
      color: '#5ec2ff',
      weight: 1.2,
      opacity: 0.35,
      interactive: false,
      smoothFactor: 1.5,
    }).addTo(trailLayer);
  }
}

/** The recorded track for one aircraft: [{lat,lon,alt,at}, …]. */
export function trackFor(hex) { return trails.get(hex) || []; }

// ── keeping a track across a reload ─────────────────────────────────────────
//
// The app reloads itself after a long spell in the background (resume
// hardening), which is exactly when a track is most worth having — so the ones
// being watched are written to localStorage and read back at start-up. Only a
// handful are kept: this is the flight you're following, not a flight log.

const TRACKS_KEY = 'airadar.tracks';
const TRACKS_MAX = 4;
const TRACK_TTL_MS = 6 * 3600 * 1000;

function loadTracks() {
  try {
    const raw = JSON.parse(localStorage.getItem(TRACKS_KEY) || '{}');
    const now = Date.now();
    for (const [hex, pts] of Object.entries(raw)) {
      if (!Array.isArray(pts) || pts.length < 2) continue;
      const fresh = pts.filter((p) => p && Number.isFinite(p.lat) && now - (p.at || 0) < TRACK_TTL_MS);
      if (fresh.length >= 2) trails.set(hex, fresh.slice(-TRAIL_MAX));
    }
  } catch { /* nothing worth recovering */ }
}

let saveTracksTimer = null;
function saveTracksSoon() {
  if (saveTracksTimer) return;
  saveTracksTimer = setTimeout(() => {
    saveTracksTimer = null;
    try {
      const keep = {};
      const hexes = [selectedHex, ...trails.keys()].filter(Boolean);
      for (const hex of hexes) {
        if (Object.keys(keep).length >= TRACKS_MAX) break;
        const pts = trails.get(hex);
        if (pts && pts.length >= 2) keep[hex] = pts;
      }
      localStorage.setItem(TRACKS_KEY, JSON.stringify(keep));
    } catch { /* quota — the in-memory track still works */ }
  }, 10000);
}

/** Move the symbols along their track between position updates. */
function startDeadReckoning() {
  if (drTimer) return;
  drTimer = setInterval(() => {
    if (document.visibilityState !== 'visible' || !map) return;
    for (const [, rec] of markers) {
      const f = rec.fix;
      if (!f || f.ground || !f.gs || f.gs < 40 || !Number.isFinite(f.track)) continue;
      const age = Date.now() - f.at;
      // Past the DR limit the extrapolation stops: the symbol stays at the last
      // place we actually knew about rather than flying on indefinitely.
      if (age > DR_MAX_MS) continue;
      const hrs = age / 3_600_000;
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
  if (!ac) return;
  const here = [ac.lat, ac.lon];
  const o = route && route.origin, d = route && route.destination;

  // What the aircraft actually flew, as far back as we watched it. The rest of
  // the way back to the departure airport is a straight line because nobody
  // gives it to us — every free ADS-B aggregator's track history is either
  // behind a login or blocked to browsers — so it is drawn faint and dashed to
  // say plainly "this bit is inferred, that bit was observed".
  const track = trails.get(ac.hex) || [];
  const flown = track.length >= 2 ? track : null;
  if (flown) drawFlownTrack([...flown, { lat: ac.lat, lon: ac.lon, alt: ac.alt }], routeLayer);

  if (o && Number.isFinite(o.lat)) {
    const joinTo = flown ? [flown[0].lat, flown[0].lon] : here;
    L.polyline([[o.lat, o.lon], joinTo], {
      color: '#5ec2ff',
      weight: flown ? 1.6 : 2,
      opacity: flown ? 0.4 : 0.75,
      dashArray: flown ? '4 7' : null,
      interactive: false,
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

/** How much of the selected aircraft's flight we have actually watched. */
export function trackSpan(hex) {
  const t = trails.get(hex) || [];
  if (t.length < 2) return null;
  return { points: t.length, fromAt: t[0].at, minutes: (Date.now() - t[0].at) / 60000 };
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

// ── runways ─────────────────────────────────────────────────────────────────

/**
 * Draw the runways in view, once the map is close enough in for them to be
 * more than a smudge. Each strip is drawn to scale with its threshold numbers
 * at the correct ends and its length on the centreline.
 */
function drawRunways() {
  if (!runwayLayer) return;
  runwayLayer.clearLayers();
  const z = map.getZoom();
  if (z < runways.MIN_ZOOM) return;

  const bounds = map.getBounds();
  // Widen with zoom: a runway is ~45 m across, which is sub-pixel until you're
  // well in, so below that it's drawn as a legible line rather than to scale.
  const weight = Math.max(3, Math.min(16, (z - 10) * 2.4));
  const showText = z >= 13;

  for (const rw of runways.known()) {
    if (rw.lengthM < runways.MIN_LENGTH_M) continue;   // stub or mapping artefact
    if (!rw.coords.some((p) => bounds.contains(p))) continue;

    // Draw the real geometry (every mapped segment), but label the runway once.
    for (const part of rw.parts) {
      L.polyline(part, {
        color: '#0b1220', weight: weight + 3, opacity: 0.9, interactive: false, lineCap: 'butt',
      }).addTo(runwayLayer);
    }
    let strip = null;
    for (const part of rw.parts) {
      strip = L.polyline(part, {
        color: '#c7d0e0', weight, opacity: 0.92, lineCap: 'butt',
      }).addTo(runwayLayer);
      // Centreline dashes, once the strip is wide enough to hold them.
      if (weight >= 7) {
        L.polyline(part, {
          color: '#0b1220', weight: 1.4, opacity: 0.65, dashArray: '9 11', interactive: false,
        }).addTo(runwayLayer);
      }
    }
    if (!strip) continue;

    strip.bindPopup(`<b>${rw.ref || rw.thresholds.map((t) => t.name).join('/')}</b><br>
      ${runways.lengthLabel(rw.lengthM)}${rw.lengthMeasured ? ' (measured)' : ''}
      ${rw.widthM ? `<br>${rw.widthM} m wide` : ''}
      ${rw.surface ? `<br>${rw.surface}` : ''}${rw.lit ? ' · lit' : ''}`);

    if (!showText) continue;

    for (const t of rw.thresholds) {
      L.marker(t.at, {
        interactive: false,
        icon: L.divIcon({
          className: 'rwy-icon',
          html: `<span class="rwy-thr${t.derived ? ' derived' : ''}">${t.name}</span>`,
          iconSize: [26, 16],
          iconAnchor: [13, 8],
        }),
      }).addTo(runwayLayer);
    }

    // A third of the way along, not the middle: runways cross near their
    // centres, and two length labels stacked on the intersection are unreadable.
    const at = [
      rw.coords[0][0] + (rw.coords[1][0] - rw.coords[0][0]) * 0.33,
      rw.coords[0][1] + (rw.coords[1][1] - rw.coords[0][1]) * 0.33,
    ];
    L.marker(at, {
      interactive: false,
      icon: L.divIcon({
        className: 'rwy-icon',
        html: `<span class="rwy-len">${runways.lengthLabel(rw.lengthM)}</span>`,
        iconSize: [120, 14],
        iconAnchor: [60, -8],
      }),
    }).addTo(runwayLayer);
  }
}

let runwayRetry = null;

/**
 * Fetch (if this patch is new) and redraw. Failure is silent — runways are
 * scenery, and Overpass is a shared free service that answers 504 when it's
 * busy. One backed-off retry covers that without leaving a user who isn't
 * moving the map staring at a runway-less airport.
 */
function refreshRunways(attempt = 0) {
  clearTimeout(runwayRetry);
  if (!map || map.getZoom() < runways.MIN_ZOOM) { if (runwayLayer) runwayLayer.clearLayers(); return; }
  drawRunways();                       // paint what we already know immediately
  runways.fetchIn(map.getBounds())
    .then(() => drawRunways())
    .catch(() => {
      if (attempt >= 2) return;
      runwayRetry = setTimeout(() => refreshRunways(attempt + 1), 9000 * (attempt + 1));
    });
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
