// webcams.js — nearby webcams from the Windy Webcams API v3.
//
// Windy requires a free API key (windy.com/webcams → API). The key is stored on
// the device (localStorage 'xcsky.windyKey') and sent as the x-windy-api-key
// header; we never see it. Without a key the layer is inert and the UI points
// the pilot at the free signup.

const KEY_LS = 'xcsky.windyKey';
export function hasKey() { return !!localStorage.getItem(KEY_LS); }
export function getKey() { return localStorage.getItem(KEY_LS) || ''; }
export function setKey(k) { k ? localStorage.setItem(KEY_LS, k.trim()) : localStorage.removeItem(KEY_LS); }

let cache = null;

function key(b) {
  return [b.getSouth().toFixed(1), b.getWest().toFixed(1), b.getNorth().toFixed(1), b.getEast().toFixed(1)].join('|');
}

/** Webcams within a Leaflet bounds. Returns [] with no key or on error. */
export async function fetchWebcams(bounds) {
  if (!hasKey()) return [];
  const k = key(bounds);
  if (cache && cache.key === k) return cache.list;
  const lat = ((bounds.getNorth() + bounds.getSouth()) / 2).toFixed(4);
  const lon = ((bounds.getEast() + bounds.getWest()) / 2).toFixed(4);
  // radius (km) ~ half the diagonal, capped so the query stays sane.
  const R = 6371, toRad = Math.PI / 180;
  const dLat = (bounds.getNorth() - bounds.getSouth()) * toRad;
  const radius = Math.min(250, Math.round(R * dLat / 2) + 20);
  const url = `https://api.windy.com/webcams/api/v3/webcams?nearby=${lat},${lon},${radius}&limit=50&include=images,location`;
  let list = [];
  try {
    const res = await fetch(url, { headers: { 'x-windy-api-key': getKey() } });
    if (res.ok) {
      const data = await res.json();
      list = (data.webcams || []).map((w) => ({
        id: w.webcamId || w.id,
        title: w.title || 'Webcam',
        lat: w.location && w.location.latitude,
        lon: w.location && w.location.longitude,
        thumb: w.images && w.images.current && (w.images.current.preview || w.images.current.thumbnail),
        link: `https://www.windy.com/webcams/${w.webcamId || w.id}`,
      })).filter((w) => w.lat != null && w.thumb);
    }
  } catch { /* keep [] */ }
  cache = { key: k, list };
  return list;
}
