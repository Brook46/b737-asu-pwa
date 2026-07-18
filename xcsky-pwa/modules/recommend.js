// recommend.js — "maximise the day": pick the best launch and sketch an XC
// route that follows the forecast.
//
// This is deliberately a heuristic, not an optimiser — it reads the same grid
// the map shows and simulates a downwind cross-country: each soarable hour,
// climb to the working top and glide downwind, nudged toward stronger lift.
// The output is a suggested line + a distance estimate, clearly labelled as
// day-potential guidance, never a flight plan.

import { sampleAt } from './grid.js';

const R = 6371;
const toRad = (d) => d * Math.PI / 180;
const toDeg = (r) => r * 180 / Math.PI;

/** Move distKm from {lat,lon} along a compass bearing. */
function advance(pt, bearingDeg, distKm) {
  const br = toRad(bearingDeg), la1 = toRad(pt.lat), lo1 = toRad(pt.lon);
  const dr = distKm / R;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(dr) + Math.cos(la1) * Math.sin(dr) * Math.cos(br));
  const lo2 = lo1 + Math.atan2(Math.sin(br) * Math.sin(dr) * Math.cos(la1),
    Math.cos(dr) - Math.sin(la1) * Math.sin(la2));
  return { lat: toDeg(la2), lon: toDeg(lo2) };
}
function haversineKm(a, b) {
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Build a suggested route from a start point across a day's soarable hours.
 * @param start {lat,lon}
 * @param dayKey "YYYY-MM-DD"
 * @param hours  ascending list of local hours to fly (e.g. 10..17)
 * @returns {path:[{lat,lon}], km, bearing, hoursFlown} | null
 */
export function recommendRoute(start, dayKey, hours) {
  let pos = { lat: start.lat, lon: start.lon };
  const path = [pos];
  let bearingSum = 0, flown = 0;

  for (const hr of hours) {
    const here = sampleAt(pos.lat, pos.lon, dayKey, hr);
    if (!here || here.climb < 0.4) continue;              // can't climb ⇒ day's done

    const downwind = ((here.windDir ?? 0) + 180) % 360;   // where the air is going
    // Try three headings around downwind; pick the one over the strongest lift.
    let bestBr = downwind, bestScore = -1;
    for (const off of [-35, -15, 0, 15, 35]) {
      const br = (downwind + off + 360) % 360;
      const probe = advance(pos, br, 12);
      const wx = sampleAt(probe.lat, probe.lon, dayKey, hr);
      const climb = wx ? wx.climb : 0;
      // Favour lift, but stay biased downwind (cos falloff off the tailwind line).
      const score = climb * (0.6 + 0.4 * Math.cos(toRad(off)));
      if (score > bestScore) { bestScore = score; bestBr = br; }
    }

    // Distance actually made good in an hour of paraglider XC — deliberately
    // conservative: a still-air pace that grows with climb, a partial downwind
    // push, and a duty factor (you don't glide flat-out every minute).
    const vStill = 11 + here.climb * 5;                   // km/h still-air pace
    const push = (here.wind || 0) * 0.35;                 // tailwind help
    // Made good this hour, with a duty factor and a hard cap — a paraglider XC
    // rarely averages above ~30 km/h over the ground even on a strong day.
    const legKm = Math.min(30, Math.max(5, (vStill + push) * 0.7));

    pos = advance(pos, bestBr, legKm);
    path.push(pos);
    bearingSum += bestBr; flown++;
  }

  if (flown === 0) return null;
  const km = path.slice(1).reduce((s, p, i) => s + haversineKm(path[i], p), 0);
  return { path, km, bearing: Math.round(bearingSum / flown), hoursFlown: flown };
}

/** Compass label for a bearing. */
export function bearingLabel(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}
