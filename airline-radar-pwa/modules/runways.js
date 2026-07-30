// runways.js — real runways on the map, once you're zoomed in far enough.
//
// Below a certain zoom an airport is a dot and runway geometry is noise. Zoom
// in on one and it becomes the thing you actually want to see: which way the
// runways point, how long they are, and which threshold is which.
//
// Source: OpenStreetMap via Overpass, which is keyless and CORS-open like
// everything else here. `aeroway=runway` ways carry the geometry plus `ref`
// ("08/26"), `length`, `width` and `surface` — enough to draw the strip and
// label both thresholds correctly.
//
// Overpass is donated infrastructure, so this is deliberately frugal: nothing
// is asked below MIN_ZOOM, results are cached for the session, a bounding box
// already covered by an earlier answer is never asked about again, and there is
// a hard floor on the gap between requests.

const API = 'https://overpass-api.de/api/interpreter';

export const MIN_ZOOM = 12;      // below this, runways are sub-pixel anyway
const MIN_GAP_MS = 4000;         // never hammer a volunteer-run service
const PAD = 0.04;                // ask for a bit more than the view, in degrees

let lastAt = 0;
let inFlight = null;
const covered = [];              // bboxes we already have answers for
const runways = new Map();       // osm id → runway

const nm = (a, b) => Math.abs(a - b);

function isCovered(b) {
  return covered.some((c) => b.s >= c.s && b.n <= c.n && b.w >= c.w && b.e <= c.e);
}

/** Great-circle metres between two [lat,lon] points. */
function metres(p1, p2) {
  const R = 6371000;
  const rad = Math.PI / 180;
  const dLat = (p2[0] - p1[0]) * rad;
  const dLon = (p2[1] - p1[1]) * rad;
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(p1[0] * rad) * Math.cos(p2[0] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** True bearing from p1 to p2, degrees. */
export function bearing(p1, p2) {
  const rad = Math.PI / 180;
  const y = Math.sin((p2[1] - p1[1]) * rad) * Math.cos(p2[0] * rad);
  const x = Math.cos(p1[0] * rad) * Math.sin(p2[0] * rad)
    - Math.sin(p1[0] * rad) * Math.cos(p2[0] * rad) * Math.cos((p2[1] - p1[1]) * rad);
  return (Math.atan2(y, x) / rad + 360) % 360;
}

/**
 * Work out which designator belongs to which end.
 *
 * A runway numbered 08 is the one you line up on heading ~080°, so the "08"
 * threshold is the end you'd be standing at looking east. Compare the tagged
 * numbers against the bearing along the geometry and assign accordingly —
 * getting this backwards would put the numbers on the wrong ends, which is
 * worse than not drawing them at all.
 */
function thresholds(ref, coords) {
  const a = coords[0];
  const b = coords[coords.length - 1];
  const brgAB = bearing(a, b);
  const parts = String(ref || '').split('/').map((s) => s.trim()).filter(Boolean);
  if (parts.length !== 2) {
    // No usable ref: derive the numbers from the geometry itself.
    const n1 = Math.round(brgAB / 10) || 36;
    const n2 = Math.round(((brgAB + 180) % 360) / 10) || 36;
    return [
      { at: a, name: String(n1).padStart(2, '0'), derived: true },
      { at: b, name: String(n2).padStart(2, '0'), derived: true },
    ];
  }
  const headingOf = (s) => (parseInt(String(s).replace(/[^0-9]/g, ''), 10) || 0) * 10;
  const diff = (x, y) => { const d = Math.abs(x - y) % 360; return d > 180 ? 360 - d : d; };
  // parts[0] sits at end `a` if the run a→b matches its heading.
  const firstAtA = diff(headingOf(parts[0]), brgAB) <= diff(headingOf(parts[1]), brgAB);
  return firstAtA
    ? [{ at: a, name: parts[0] }, { at: b, name: parts[1] }]
    : [{ at: a, name: parts[1] }, { at: b, name: parts[0] }];
}

function shape(el) {
  const coords = (el.geometry || []).map((g) => [g.lat, g.lon]).filter((p) => Number.isFinite(p[0]));
  if (coords.length < 2) return null;
  const t = el.tags || {};
  const tagged = parseFloat(t.length);
  const measured = metres(coords[0], coords[coords.length - 1]);
  return {
    id: el.id,
    ref: t.ref || '',
    name: t.name || '',
    // Prefer the surveyed tag; fall back to the geometry when it's missing.
    lengthM: Number.isFinite(tagged) && tagged > 100 ? tagged : Math.round(measured),
    lengthMeasured: !(Number.isFinite(tagged) && tagged > 100),
    widthM: parseFloat(t.width) || null,
    surface: t.surface || '',
    lit: t.lit === 'yes',
    coords,
    thresholds: thresholds(t.ref, coords),
    bearing: bearing(coords[0], coords[coords.length - 1]),
  };
}

/**
 * Runways inside a Leaflet bounds. Resolves with everything known so far,
 * fetching only when this patch hasn't been asked about yet.
 * @returns {Promise<Array>}
 */
export async function fetchIn(bounds) {
  const b = {
    s: bounds.getSouth() - PAD, w: bounds.getWest() - PAD,
    n: bounds.getNorth() + PAD, e: bounds.getEast() + PAD,
  };
  if (isCovered(b)) return [...runways.values()];
  if (inFlight) return inFlight;

  const wait = Math.max(0, MIN_GAP_MS - (Date.now() - lastAt));
  inFlight = (async () => {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastAt = Date.now();
    const q = `[out:json][timeout:25];way["aeroway"="runway"](${b.s.toFixed(4)},${b.w.toFixed(4)},${b.n.toFixed(4)},${b.e.toFixed(4)});out geom;`;
    const res = await fetch(API, {
      method: 'POST',
      body: new URLSearchParams({ data: q }),
    });
    if (!res.ok) throw new Error(`overpass ${res.status}`);
    const json = await res.json();
    for (const el of json.elements || []) {
      const rw = shape(el);
      if (rw) runways.set(rw.id, rw);
    }
    covered.push(b);
    return [...runways.values()];
  })().finally(() => { inFlight = null; });

  return inFlight;
}

/**
 * Whole runways, not the pieces OSM stores.
 *
 * A runway is usually mapped as several ways, split wherever another runway or
 * a taxiway crosses it. Drawn naively that produces a "77 m runway" label in
 * the middle of a 4 km strip and the threshold numbers repeated at every
 * junction. Segments sharing a `ref` at the same airport are one runway: the
 * two ends are the furthest-apart endpoints in the group, and that separation
 * is its length.
 */
export function known() {
  const groups = new Map();
  for (const rw of runways.values()) {
    const mid = rw.coords[Math.floor(rw.coords.length / 2)];
    // ~0.1° cell keeps two airports with identically numbered runways apart.
    const key = rw.ref
      ? `${rw.ref}@${mid[0].toFixed(1)},${mid[1].toFixed(1)}`
      : `id:${rw.id}`;
    const g = groups.get(key) || { key, ref: rw.ref, name: rw.name, parts: [], ends: [], tagged: 0 };
    g.parts.push(rw.coords);
    g.ends.push(rw.coords[0], rw.coords[rw.coords.length - 1]);
    if (!g.surface && rw.surface) g.surface = rw.surface;
    if (!g.widthM && rw.widthM) g.widthM = rw.widthM;
    g.lit = g.lit || rw.lit;
    // A tagged length describes the whole runway, not the piece it sits on.
    if (!rw.lengthMeasured) g.tagged = Math.max(g.tagged, rw.lengthM);
    groups.set(key, g);
  }

  const out = [];
  for (const g of groups.values()) {
    // The two furthest-apart endpoints are the thresholds.
    let a = g.ends[0]; let b = g.ends[1]; let best = -1;
    for (let i = 0; i < g.ends.length; i++) {
      for (let j = i + 1; j < g.ends.length; j++) {
        const d = metres(g.ends[i], g.ends[j]);
        if (d > best) { best = d; a = g.ends[i]; b = g.ends[j]; }
      }
    }
    const spanned = Math.round(best);
    out.push({
      key: g.key,
      ref: g.ref,
      name: g.name,
      parts: g.parts,
      coords: [a, b],
      lengthM: g.tagged || spanned,
      lengthMeasured: !g.tagged,
      widthM: g.widthM || null,
      surface: g.surface || '',
      lit: !!g.lit,
      thresholds: thresholds(g.ref, [a, b]),
      bearing: bearing(a, b),
    });
  }
  return out;
}

/** Below this a "runway" is a stub, an apron edge or a mapping artefact. */
export const MIN_LENGTH_M = 500;

/** "3,112 m · 10,210 ft" — both, because both are used in the real world. */
export function lengthLabel(m) {
  if (!Number.isFinite(m)) return '';
  return `${Math.round(m).toLocaleString('en-US')} m · ${Math.round(m * 3.28084).toLocaleString('en-US')} ft`;
}
