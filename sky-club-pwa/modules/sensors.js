// sensors.js — geolocation + device compass/tilt for the Sky screen, with the same
// iOS permission-gate trick used elsewhere in this repo (root app.js, xcsky-pwa):
// DeviceOrientationEvent.requestPermission() is only ever called inside a real tap,
// and iOS remembers "granted" per-origin so later launches need no dialog at all.

const ORIENT_PERM_KEY = 'skyclub.orientPerm';

export const sensorState = {
  lat: null, lon: null, hasLocation: false,
  heading: 0,     // compass bearing in degrees, 0 = north, clockwise
  pitch: 0,       // degrees above the horizon the phone is "looking", + up
  usingDevice: false, // true once real device-orientation events are flowing
};

function getPositionOnce() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(Object.assign(new Error('Geolocation unavailable'), { denied: false }));
    navigator.geolocation.getCurrentPosition(
      resolve,
      (err) => reject(Object.assign(new Error(err.code === 1 ? 'Location permission denied' : 'Could not get location'), { denied: err.code === 1 })),
      { enableHighAccuracy: false, timeout: 15000, maximumAge: 300000 }
    );
  });
}

/**
 * A first GPS fix — especially indoors, or right after opening the app — can
 * simply time out once with no real problem; a single silent retry clears most
 * of those before bothering the user. A permission *denial* is never retried
 * (asking again won't change the answer without the user acting first).
 */
export async function geolocate() {
  let pos;
  try {
    pos = await getPositionOnce();
  } catch (err) {
    if (err.denied) throw err;
    await new Promise((r) => setTimeout(r, 1500));
    pos = await getPositionOnce(); // let this one's rejection propagate as-is
  }
  sensorState.lat = pos.coords.latitude;
  sensorState.lon = pos.coords.longitude;
  sensorState.hasLocation = true;
  return sensorState;
}

function orientationNeedsPermission() {
  return typeof DeviceOrientationEvent !== 'undefined' &&
         typeof DeviceOrientationEvent.requestPermission === 'function';
}

export function cachedOrientationPermission() {
  if (typeof DeviceOrientationEvent === 'undefined') return 'denied';
  if (!orientationNeedsPermission()) return 'granted'; // non-iOS: no prompt needed
  try { return localStorage.getItem(ORIENT_PERM_KEY) || 'prompt'; }
  catch { return 'prompt'; }
}

function handleOrientation(e) {
  let heading;
  if (typeof e.webkitCompassHeading === 'number') {
    heading = e.webkitCompassHeading; // iOS Safari: true compass bearing already
  } else if (typeof e.alpha === 'number') {
    // Best-effort compass from alpha (only truly north-referenced when the event
    // is 'deviceorientationabsolute' or e.absolute === true — close enough here).
    heading = (360 - e.alpha) % 360;
  } else {
    return;
  }
  // beta ~90° = phone held upright pointing at the horizon; higher = tilted back
  // (looking up), lower = tilted forward (looking down). Good enough for a sky app.
  const pitch = typeof e.beta === 'number' ? Math.max(-90, Math.min(90, e.beta - 90)) : sensorState.pitch;
  sensorState.heading = heading;
  sensorState.pitch = pitch;
  sensorState.usingDevice = true;
}

/** Safe to call on every launch — delivers events only if already granted. */
export function startDeviceOrientation() {
  const eventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(eventName, handleOrientation);
}

/** The ONLY caller of requestPermission(). Must run inside a real user tap. */
export async function requestOrientationPermission() {
  if (!orientationNeedsPermission()) { startDeviceOrientation(); return 'granted'; }
  let state = 'denied';
  try { state = await DeviceOrientationEvent.requestPermission(); }
  catch { return 'denied'; }
  try { localStorage.setItem(ORIENT_PERM_KEY, state); } catch {}
  if (state === 'granted') startDeviceOrientation();
  return state;
}

/** Drag-to-look fallback (no sensors, or permission denied) — same state, touch-fed. */
export function nudge(dHeading, dPitch) {
  sensorState.heading = (sensorState.heading + dHeading + 360) % 360;
  sensorState.pitch = Math.max(-85, Math.min(85, sensorState.pitch + dPitch));
}
