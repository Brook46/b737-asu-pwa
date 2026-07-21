// profile.js — the task cross-section: terrain along the planned legs, the
// airspace floors/ceilings that cut across them, and the wind on each segment.
//
// This is the view that answers "can I actually fly this line?" — where the
// ground comes up, where a CTR floor caps you, and whether each leg is a slog
// upwind or a glide downwind.
//
// Terrain comes from Open-Meteo's keyless elevation endpoint (batched), so
// there's no tile dependency. Samples are cached per task signature so dragging
// the time slider doesn't refetch.

import { elevations } from './meteo.js';
import { zonesAt } from './airspace.js';

const SAMPLES = 60;           // points across the whole task — plenty at phone width

const toRad = (d) => d * Math.PI / 180;
export function haversineKm(a, b) {
  const R = 6371, dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Task statistics: leg lengths, total, closing leg and an FAI triangle check. */
export function taskStats(wpts) {
  const legs = [];
  for (let i = 1; i < wpts.length; i++) legs.push(haversineKm(wpts[i - 1], wpts[i]));
  const total = legs.reduce((s, v) => s + v, 0);
  const out = { legs, total, closing: 0, perimeter: total, fai: null };
  if (wpts.length >= 3) {
    out.closing = haversineKm(wpts[wpts.length - 1], wpts[0]);
    out.perimeter = total + out.closing;
    // FAI triangle: with exactly 3 turnpoints, every side must be >= 28% of the
    // perimeter (the classic FAI shape rule).
    if (wpts.length === 3) {
      const sides = [...legs, out.closing];
      const minPct = Math.min(...sides) / out.perimeter;
      out.fai = { valid: minPct >= 0.28, minPct, sides };
    }
  }
  return out;
}

/** Interpolate `n` points along the leg chain, tagging each with its leg index. */
function samplePath(wpts, n) {
  const legs = [];
  let total = 0;
  for (let i = 1; i < wpts.length; i++) {
    const d = haversineKm(wpts[i - 1], wpts[i]);
    legs.push({ a: wpts[i - 1], b: wpts[i], d, from: total });
    total += d;
  }
  if (!total) return [];
  const out = [];
  for (let i = 0; i < n; i++) {
    const dist = total * (i / (n - 1));
    let leg = legs[legs.length - 1];
    for (const L of legs) if (dist <= L.from + L.d) { leg = L; break; }
    const t = leg.d ? (dist - leg.from) / leg.d : 0;
    out.push({
      lat: leg.a.lat + (leg.b.lat - leg.a.lat) * t,
      lon: leg.a.lon + (leg.b.lon - leg.a.lon) * t,
      km: dist,
      leg: legs.indexOf(leg),
    });
  }
  return out;
}

let cacheKey = '', cacheSamples = null;
const sig = (w) => w.map((p) => `${p.lat.toFixed(3)},${p.lon.toFixed(3)}`).join('|');

/**
 * Build the cross-section dataset: terrain + airspace bands per sample.
 * Cached by task signature — only refetches when the turnpoints change.
 */
export async function buildProfile(wpts) {
  if (wpts.length < 2) return null;
  const key = sig(wpts);
  if (key === cacheKey && cacheSamples) return cacheSamples;

  const pts = samplePath(wpts, SAMPLES);
  const terrain = await elevations(pts);
  pts.forEach((p, i) => {
    p.terrain = terrain[i] == null ? 0 : terrain[i];
    // Airspace that covers this point, resolved to MSL metres.
    p.zones = zonesAt(p.lat, p.lon).map((z) => ({
      name: z.name, class: z.class,
      floor: z.floor.ref === 'AGL' ? p.terrain + z.floor.m : z.floor.m,
      ceil: z.ceil.ref === 'AGL' ? p.terrain + z.ceil.m : z.ceil.m,
      raw: z,
    }));
  });
  cacheKey = key; cacheSamples = pts;
  return pts;
}

export function invalidate() { cacheKey = ''; cacheSamples = null; }

/** Lowest airspace floor over the whole task (the practical ceiling). */
export function lowestCeiling(samples) {
  let best = null;
  for (const s of samples || []) {
    for (const z of s.zones || []) {
      if (z.floor > 0 && (best == null || z.floor < best.floor)) best = { floor: z.floor, name: z.name, class: z.class };
    }
  }
  return best;
}
