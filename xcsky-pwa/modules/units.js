// units.js — display formatting + a metric/imperial toggle persisted in localStorage.

const KEY = 'xcsky.units';
let system = localStorage.getItem(KEY) || 'metric'; // 'metric' | 'imperial'

export function getSystem() { return system; }
export function setSystem(s) { system = s; localStorage.setItem(KEY, s); }
export function toggleSystem() { setSystem(system === 'metric' ? 'imperial' : 'metric'); return system; }

/** Altitude: metres → "1450 m" or "4760 ft". */
export function alt(m) {
  if (m == null) return '—';
  return system === 'imperial'
    ? `${Math.round(m * 3.28084 / 10) * 10} ft`
    : `${Math.round(m / 10) * 10} m`;
}
export function altNum(m) {
  if (m == null) return null;
  return system === 'imperial' ? m * 3.28084 : m;
}
export function altUnit() { return system === 'imperial' ? 'ft' : 'm'; }

/** Wind speed: km/h → "24 km/h" or "13 kt". */
export function wind(kmh) {
  if (kmh == null) return '—';
  if (system === 'imperial') return `${Math.round(kmh * 0.539957)} kt`;
  return `${Math.round(kmh)} km/h`;
}
export function windUnit() { return system === 'imperial' ? 'kt' : 'km/h'; }

/** Climb / vertical speed always in m/s (universal for varios). */
export function climb(ms) {
  if (ms == null) return '—';
  return `${ms.toFixed(1)} m/s`;
}

/** Temperature °C → "18°C" or "64°F". */
export function temp(c) {
  if (c == null) return '—';
  return system === 'imperial' ? `${Math.round(c * 9 / 5 + 32)}°F` : `${Math.round(c)}°C`;
}

/** Compass direction from degrees → "NW". */
export function compass(deg) {
  if (deg == null) return '—';
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return dirs[Math.round(deg / 22.5) % 16];
}

/** Local hour label, e.g. "13:00". */
export function hourLabel(date) {
  return `${String(date.getHours()).padStart(2, '0')}:00`;
}

/** Short weekday + date, e.g. "Fri 18". */
export function dayLabel(date) {
  return date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
}
