// planning.js — an XC task planner (FlyXC-style) drawn on the main map.
//
// In plan mode, tapping the map drops a waypoint, each with a turnpoint cylinder
// of an adjustable radius. We draw the cylinders, a route line through the
// centres, and numbered markers, and compute the task distance (sum of legs)
// plus the closed-circuit / FAI-triangle closing distance. The weather field
// underneath keeps updating as the time slider moves, so the planned route can
// be read against the forecast at any hour of the day.

let map = null;
let layer = null;               // L.layerGroup holding all task graphics
let onChange = null;
let active = false;
let defaultRadius = 400;        // m — FAI turnpoint cylinder default
const wpts = [];                // [{lat, lon, radius}]

export function initPlanner(leafletMap, opts = {}) {
  map = leafletMap;
  onChange = opts.onChange || null;
  layer = L.layerGroup().addTo(map);
}

export function isActive() { return active; }
export function setActive(v) {
  active = v;
  if (map) map.getContainer().classList.toggle('planning', v);
}

export function getRadius() { return defaultRadius; }
export function setRadius(r) {
  defaultRadius = r;
  // Apply to every existing turnpoint too — one slider governs the task.
  for (const w of wpts) w.radius = r;
  redraw();
}

export function addWaypoint(lat, lon) {
  wpts.push({ lat, lon, radius: defaultRadius });
  redraw();
}
export function undo() { wpts.pop(); redraw(); }
export function clear() { wpts.length = 0; redraw(); }
export function count() { return wpts.length; }
export function waypoints() { return wpts.slice(); }

// ── geometry ────────────────────────────────────────────────────────────────
function haversineKm(a, b) {
  const R = 6371, toRad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * toRad, dLon = (b.lon - a.lon) * toRad;
  const la1 = a.lat * toRad, la2 = b.lat * toRad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Task stats: leg list, open total, and closed (return-to-start) distance. */
export function stats() {
  const legs = [];
  let total = 0;
  for (let i = 1; i < wpts.length; i++) {
    const d = haversineKm(wpts[i - 1], wpts[i]);
    legs.push(d); total += d;
  }
  const closing = wpts.length >= 3 ? haversineKm(wpts[wpts.length - 1], wpts[0]) : 0;
  return { legs, total, closed: total + closing, closing, n: wpts.length };
}

// ── drawing ─────────────────────────────────────────────────────────────────
function redraw() {
  if (!layer) return;
  layer.clearLayers();

  if (wpts.length >= 2) {
    L.polyline(wpts.map((w) => [w.lat, w.lon]), {
      color: '#5ec2ff', weight: 3, opacity: 0.9, dashArray: '2 6',
    }).addTo(layer);
  }
  // Closing leg (triangle) shown fainter.
  if (wpts.length >= 3) {
    L.polyline([[wpts[wpts.length - 1].lat, wpts[wpts.length - 1].lon], [wpts[0].lat, wpts[0].lon]], {
      color: '#5ec2ff', weight: 2, opacity: 0.4, dashArray: '1 7',
    }).addTo(layer);
  }

  wpts.forEach((w, i) => {
    L.circle([w.lat, w.lon], {
      radius: w.radius, color: '#f2c14e', weight: 1.5, opacity: 0.85,
      fillColor: '#f2c14e', fillOpacity: 0.1, interactive: false,
    }).addTo(layer);
    const label = i === 0 ? 'S' : (i === wpts.length - 1 ? 'G' : String(i));
    const icon = L.divIcon({
      className: 'wp-icon', html: `<div class="wp-badge">${label}</div>`,
      iconSize: [22, 22], iconAnchor: [11, 11],
    });
    const m = L.marker([w.lat, w.lon], { icon, draggable: true });
    m.on('drag', (e) => { w.lat = e.latlng.lat; w.lon = e.latlng.lng; drawLinesOnly(); });
    m.on('dragend', redraw);
    m.addTo(layer);
  });

  if (onChange) onChange(stats());
}

// Lightweight update of just the connecting lines while dragging a waypoint.
function drawLinesOnly() { redraw(); }
