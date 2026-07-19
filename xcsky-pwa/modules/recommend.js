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
export function recommendRoute(start, dayKey, hours, opts = {}) {
  const factor = opts.factor || 1;         // distance scaling (risk appetite)
  const spread = opts.spread || 35;        // how far off downwind we'll chase lift
  let pos = { lat: start.lat, lon: start.lon };
  const path = [pos];
  const times = [hours.length ? hours[0] : 12];
  let bearingSum = 0, flown = 0;

  for (const hr of hours) {
    const here = sampleAt(pos.lat, pos.lon, dayKey, hr);
    if (!here || here.climb < 0.4) continue;              // can't climb ⇒ day's done

    const downwind = ((here.windDir ?? 0) + 180) % 360;   // where the air is going
    let bestBr = downwind, bestScore = -1;
    for (const off of [-spread, -spread / 2, 0, spread / 2, spread]) {
      const br = (downwind + off + 360) % 360;
      const probe = advance(pos, br, 12);
      const wx = sampleAt(probe.lat, probe.lon, dayKey, hr);
      const climb = wx ? wx.climb : 0;
      const score = climb * (0.6 + 0.4 * Math.cos(toRad(off)));
      if (score > bestScore) { bestScore = score; bestBr = br; }
    }

    const vStill = 11 + here.climb * 5;                   // km/h still-air pace
    const push = (here.wind || 0) * 0.35;                 // tailwind help
    const legKm = Math.min(30, Math.max(5, (vStill + push) * 0.7)) * factor;

    pos = advance(pos, bestBr, legKm);
    path.push(pos);
    times.push(Math.min(23, hr + 1));
    bearingSum += bestBr; flown++;
  }

  if (flown === 0) return null;
  const km = path.slice(1).reduce((s, p, i) => s + haversineKm(path[i], p), 0);
  return { path, times, km, bearing: Math.round(bearingSum / flown), hoursFlown: flown };
}

/**
 * Three flight options for the day from a launch, each with a recommended
 * takeoff time. Conservative starts later / finishes earlier with shorter legs
 * and more margin; committed launches early and chases the strongest air.
 * @param soarable ascending list of local hours with usable climb at the launch
 */
export function recommendOptions(start, dayKey, soarable) {
  if (!soarable.length) return [];
  const first = soarable[0], last = soarable[soarable.length - 1];
  const variants = [
    { id: 'conservative', name: 'Conservative', startH: Math.min(last, first + 2), endH: Math.max(first + 1, last - 1), factor: 0.8, spread: 20 },
    { id: 'balanced', name: 'Balanced', startH: Math.min(last, first + 1), endH: last, factor: 1.0, spread: 35 },
    { id: 'committed', name: 'Committed', startH: first, endH: last, factor: 1.2, spread: 48 },
  ];
  const out = [];
  for (const v of variants) {
    const hrs = soarable.filter((h) => h >= v.startH && h <= v.endH);
    const r = recommendRoute(start, dayKey, hrs, v);
    if (r) out.push({ ...v, takeoffHour: v.startH, ...r });
  }
  return out;
}

/** Total length (km) of a [{lat,lon}] path. */
export function pathDistance(path) {
  let km = 0;
  for (let i = 1; i < path.length; i++) km += haversineKm(path[i - 1], path[i]);
  return km;
}

/** Compass label for a bearing. */
export function bearingLabel(deg) {
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}
