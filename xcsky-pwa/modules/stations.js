// stations.js — live wind stations from Pioupiou (pioupiou.fr), the open
// paraglider wind-sensor network. Keyless, CORS-open. One global fetch (all
// live stations), cached briefly and filtered to the viewport.
//
// Each Pioupiou reading gives avg / min / max wind (km/h) and a heading (the
// direction the wind comes FROM). We show a compact marker: an arrow blowing
// downwind + the average speed, colour-graded for paraglider launchability.

const URL = 'https://api.pioupiou.fr/v1/live-with-meta/all';
const TTL = 2 * 60 * 1000;    // refresh live data at most every 2 min

let cache = { at: 0, list: [] };

async function loadAll() {
  if (Date.now() - cache.at < TTL && cache.list.length) return cache.list;
  try {
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`pioupiou ${res.status}`);
    const data = await res.json();
    const list = [];
    for (const s of (data.data || [])) {
      const loc = s.location, m = s.measurements;
      if (!loc || !m || loc.latitude == null || m.wind_speed_avg == null) continue;
      if (s.status && s.status.state && s.status.state !== 'on') continue;
      list.push({
        id: s.id,
        name: (s.meta && s.meta.name) || `Pioupiou ${s.id}`,
        lat: loc.latitude, lon: loc.longitude,
        dir: m.wind_heading,           // FROM, degrees
        avg: m.wind_speed_avg,         // km/h
        min: m.wind_speed_min,
        max: m.wind_speed_max,
        date: m.date,
      });
    }
    cache = { at: Date.now(), list };
  } catch { /* keep last cache */ }
  return cache.list;
}

/** Stations inside a Leaflet bounds. */
export async function fetchStations(bounds) {
  const all = await loadAll();
  return all.filter((s) => bounds.contains([s.lat, s.lon]));
}

// Paraglider-oriented colour: light green mid-strength is ideal, red = too much.
export function windColor(kmh) {
  if (kmh == null) return '#8a93a6';
  if (kmh < 5) return '#9aa4b6';        // too light
  if (kmh < 18) return '#7cc143';       // ideal
  if (kmh < 26) return '#f2c14e';       // getting strong
  if (kmh < 36) return '#ef7d3b';       // strong
  return '#e0453f';                     // too much
}

export function ageMin(dateStr) {
  const t = Date.parse(dateStr);
  if (!isFinite(t)) return null;
  return Math.max(0, Math.round((Date.now() - t) / 60000));
}
