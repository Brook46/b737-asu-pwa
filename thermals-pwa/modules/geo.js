// geo.js — geolocation watch + the "you must share to see the crew" gate.
//
// The whole app is gated on an active location share. If permission is denied
// or unavailable we surface the block screen and never join a room.

const subs = new Set();
let last = null;        // last good fix
let watchId = null;
let gateCb = null;      // called with 'granted' | 'denied' | 'prompt' | 'unsupported'

export function onFix(fn) { subs.add(fn); if (last) fn(last); return () => subs.delete(fn); }
export function lastFix() { return last; }
export function onGate(fn) { gateCb = fn; }

function emitGate(status) { if (gateCb) gateCb(status); }

// Begin watching. Resolves the permission state up-front (where supported) so
// we can show the right gate copy, then starts watchPosition.
export async function start() {
  if (!('geolocation' in navigator)) { emitGate('unsupported'); return; }

  // Permissions API is best-effort (not on every browser).
  try {
    if (navigator.permissions?.query) {
      const p = await navigator.permissions.query({ name: 'geolocation' });
      emitGate(p.state); // granted | denied | prompt
      p.onchange = () => { emitGate(p.state); if (p.state === 'granted') beginWatch(); };
      if (p.state === 'denied') return;
    }
  } catch { /* fall through to a direct attempt */ }

  beginWatch();
}

function beginWatch() {
  if (watchId != null) return;
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const c = pos.coords;
      last = {
        lat: c.latitude,
        lng: c.longitude,
        alt: c.altitude,        // metres, may be null
        heading: c.heading,     // degrees, may be null
        speed: c.speed,         // m/s, may be null
        acc: c.accuracy,
        ts: pos.timestamp,
      };
      emitGate('granted');
      subs.forEach((fn) => fn(last));
    },
    (err) => {
      if (err.code === err.PERMISSION_DENIED) emitGate('denied');
      // POSITION_UNAVAILABLE / TIMEOUT: keep watching, don't tear the gate down.
      console.warn('geo error', err.code, err.message);
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}

export function stop() {
  if (watchId != null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
}

// Test seam: inject a synthetic fix (used for local verification without real
// GPS, e.g. in a headless preview). No-op in normal use.
export function _injectFix(fix) {
  last = { acc: 5, alt: 1500, heading: 90, speed: 0, ts: Date.now(), ...fix };
  emitGate('granted');
  subs.forEach((fn) => fn(last));
}
