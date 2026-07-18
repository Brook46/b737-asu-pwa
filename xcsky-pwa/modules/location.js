// location.js — where are we forecasting? Owns the current point, saved spots,
// geolocation, and a lazily-built MapLibre picker. No API key: OpenFreeMap
// keyless vector tiles (same approach as the Sky Club app).

import { geocode, reverseLabel } from './meteo.js';

const SPOTS_KEY = 'xcsky.spots';
const LAST_KEY  = 'xcsky.last';

export function loadSpots() {
  try { return JSON.parse(localStorage.getItem(SPOTS_KEY) || '[]'); }
  catch { return []; }
}
export function saveSpots(spots) {
  localStorage.setItem(SPOTS_KEY, JSON.stringify(spots.slice(0, 40)));
}
export function addSpot(spot) {
  const spots = loadSpots().filter((s) => dist(s, spot) > 0.5); // dedupe ~500 m
  spots.unshift({ name: spot.name, lat: round(spot.lat), lon: round(spot.lon) });
  saveSpots(spots);
  return spots;
}
export function removeSpot(spot) {
  const spots = loadSpots().filter((s) => !(s.lat === spot.lat && s.lon === spot.lon));
  saveSpots(spots);
  return spots;
}

export function loadLast() {
  try { return JSON.parse(localStorage.getItem(LAST_KEY) || 'null'); }
  catch { return null; }
}
export function saveLast(loc) {
  localStorage.setItem(LAST_KEY, JSON.stringify({ name: loc.name, lat: loc.lat, lon: loc.lon }));
}

const round = (n) => Math.round(n * 1e4) / 1e4;
function dist(a, b) { // rough km
  const dx = (a.lat - b.lat) * 111;
  const dy = (a.lon - b.lon) * 111 * Math.cos(a.lat * Math.PI / 180);
  return Math.hypot(dx, dy);
}

/** Promise-wrapped geolocation with a friendly error. */
export function geolocate() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('Geolocation unavailable'));
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude, lon = pos.coords.longitude;
        const label = await reverseLabel(lat, lon);
        resolve({ name: label || 'My location', lat, lon });
      },
      (err) => reject(new Error(err.code === 1 ? 'Location permission denied' : 'Could not get location')),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }
    );
  });
}

export async function search(query) {
  const results = await geocode(query);
  return results.map((r) => ({
    name: [r.name, r.admin, r.country].filter(Boolean).join(', '),
    shortName: r.name,
    lat: r.lat,
    lon: r.lon,
  }));
}

// The map itself (bases, KK7 overlays, live pilots, tap-to-pick) lives in
// modules/map.js — this module only owns "which point are we forecasting".
