// terrain.js — ground elevation under the track, so we can talk about AGL.
//
// Altitude MSL tells you nothing about how close a pilot was to landing: 400 m
// over the Dead Sea is a different flight from 400 m over the Alps. Height above
// ground is what makes a low save a low save, and it's what the chart's terrain
// fill draws.
//
// Source: Open-Meteo's elevation endpoint (Copernicus DEM GLO-90). Keyless, no
// account, CORS-open, 100 coordinates per request — the same keyless philosophy
// as the rest of the suite.
//
// Sampling: a 3-hour flight is ~5 000 fixes, which would be 50 requests. Instead
// we sample the track every SAMPLE_M metres of ground distance (capped at
// MAX_SAMPLES), fetch those, and linearly interpolate the rest along the track.
// At 250 m spacing the interpolation error is far smaller than the DEM's own
// 90 m resolution, so nothing is gained by asking for more.

import { distance } from './metrics.js';
import { getKv, putKv, terrainKey } from './store.js';

const API = 'https://api.open-meteo.com/v1/elevation';
const BATCH = 100;          // Open-Meteo's documented per-request limit
const SAMPLE_M = 250;       // target ground spacing between DEM samples
const MAX_SAMPLES = 500;    // ⇒ at most 5 requests per flight
const TIMEOUT_MS = 12000;

/**
 * Resolve ground elevation for every fix on the track, setting `groundAlt` and
 * `agl` on each point and `hasTerrain` on the track.
 *
 * Cached in IndexedDB by track id, so a reload — or a launch site with no
 * signal — costs nothing.
 *
 * @param {import('../types').FlightTrack} track
 * @returns {Promise<boolean>} true if terrain is now attached
 */
export async function attachTerrain(track) {
  const pts = track.points;
  if (!pts || pts.length < 2) return false;

  const cacheKey = terrainKey(track.id);
  const cached = await getKv(cacheKey);
  if (cached && cached.count === pts.length && Array.isArray(cached.ground)) {
    applyGround(track, cached.ground);
    return true;
  }

  const idx = sampleIndices(pts);
  let elevations;
  try {
    elevations = await withRetry(() => fetchElevations(idx.map((i) => pts[i])));
  } catch (err) {
    track.hasTerrain = false;
    track.terrainError = err && err.message ? err.message : 'elevation lookup failed';
    return false;
  }
  if (!elevations || elevations.length !== idx.length) {
    track.hasTerrain = false;
    track.terrainError = 'incomplete elevation response';
    return false;
  }
  delete track.terrainError;

  const ground = interpolate(pts, idx, elevations);
  applyGround(track, ground);
  // Round to whole metres before storing: the DEM isn't precise to millimetres
  // and it roughly halves the stored size.
  putKv(cacheKey, { count: pts.length, ground: ground.map((v) => Math.round(v)) });
  return true;
}

/** Attach terrain to several tracks, one at a time so we stay polite to the API. */
export async function attachTerrainAll(tracks, onEach) {
  let ok = 0;
  for (const t of tracks) {
    if (t.hasTerrain) { ok++; continue; }
    const got = await attachTerrain(t);
    if (got) ok++;
    if (onEach) onEach(t, got);
  }
  return ok;
}

// ── sampling ────────────────────────────────────────────────────────────────

/**
 * Indices to ask the DEM about: every SAMPLE_M of ground track, always
 * including the first and last fix. Falls back to even index spacing if the
 * flight is long enough to blow past MAX_SAMPLES.
 */
function sampleIndices(pts) {
  const n = pts.length;
  const idx = [0];
  let acc = 0;
  for (let i = 1; i < n; i++) {
    acc += distance(pts[i - 1], pts[i]);
    if (acc >= SAMPLE_M) { idx.push(i); acc = 0; }
  }
  if (idx[idx.length - 1] !== n - 1) idx.push(n - 1);

  if (idx.length <= MAX_SAMPLES) return idx;

  // Thin evenly, keeping both ends.
  const step = (idx.length - 1) / (MAX_SAMPLES - 1);
  const thin = [];
  for (let k = 0; k < MAX_SAMPLES; k++) thin.push(idx[Math.round(k * step)]);
  return [...new Set(thin)];
}

/**
 * One retry with a short backoff. Losing terrain for a whole flight because a
 * single request timed out is a poor trade when the pilot is on a phone tether
 * at a launch site — which is exactly where this app gets used.
 */
async function withRetry(fn, attempts = 2, backoffMs = 900) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (err) {
      lastErr = err;
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  throw lastErr;
}

async function fetchElevations(points) {
  /** @type {number[]} */
  const out = [];
  for (let i = 0; i < points.length; i += BATCH) {
    const chunk = points.slice(i, i + BATCH);
    const lat = chunk.map((p) => p.lat.toFixed(5)).join(',');
    const lon = chunk.map((p) => p.lng.toFixed(5)).join(',');
    const url = `${API}?latitude=${lat}&longitude=${lon}`;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let json;
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) throw new Error(`elevation ${res.status}`);
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }
    if (!json || !Array.isArray(json.elevation)) throw new Error('bad elevation response');
    out.push(...json.elevation.map((v) => (Number.isFinite(v) ? v : 0)));
  }
  return out;
}

/** Linear fill between sampled indices. */
function interpolate(pts, idx, elev) {
  const ground = new Array(pts.length);
  for (let k = 0; k < idx.length - 1; k++) {
    const a = idx[k], b = idx[k + 1];
    const ea = elev[k], eb = elev[k + 1];
    const span = b - a;
    for (let i = a; i < b; i++) ground[i] = span > 0 ? ea + (eb - ea) * ((i - a) / span) : ea;
  }
  ground[pts.length - 1] = elev[elev.length - 1];
  // Guard the head, in case sampleIndices ever stops starting at 0.
  for (let i = 0; i < pts.length; i++) if (ground[i] === undefined) ground[i] = elev[0];
  return ground;
}

function applyGround(track, ground) {
  const pts = track.points;
  const key = track.altSource === 'gps' ? 'gpsAlt' : 'pressureAlt';
  for (let i = 0; i < pts.length; i++) {
    pts[i].groundAlt = ground[i];
    // Barometric altitude drifts against the DEM's geoid by tens of metres, and
    // negative AGL is nonsense to a reader, so clamp at zero.
    pts[i].agl = Math.max(0, pts[i][key] - ground[i]);
  }
  track.hasTerrain = true;
  // metrics.minAgl was computed before terrain existed; it's cheap to redo.
  delete track._segs;
}

/**
 * The ground profile for the altitude chart: one elevation per fix, or null
 * when terrain hasn't been resolved (the chart then draws no terrain fill
 * rather than a flat fake one at sea level).
 */
export function groundProfile(track) {
  if (!track.hasTerrain) return null;
  return track.points.map((p) => p.groundAlt || 0);
}
