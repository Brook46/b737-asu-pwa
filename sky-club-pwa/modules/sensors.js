// sensors.js — geolocation + device compass/tilt for the Sky screen, with the same
// iOS permission-gate trick used elsewhere in this repo (root app.js, xcsky-pwa):
// DeviceOrientationEvent.requestPermission() is only ever called inside a real tap,
// and iOS remembers "granted" per-origin so later launches need no dialog at all.

const ORIENT_PERM_KEY = 'skyclub.orientPerm';
const LAST_FIX_KEY = 'skyclub.lastFix';

// Used only when real location isn't available (denied, unsupported, or just
// slow/flaky) — Sky mode must never dead-end waiting on a permission a toddler
// can't grant themselves; an approximate sky beats a permanently stuck gate.
const DEFAULT_LAT = 32.0853;
const DEFAULT_LON = 34.7818;

export const sensorState = {
  lat: null, lon: null, hasLocation: false,
  usingDefaultLocation: false, // true when we fell back instead of a real fix
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
      // 8s, not 15s: this used to run *before* the sky was allowed to render, so
      // a slow indoor fix (15s, retry, 15s again) meant up to ~31s of staring at
      // "Finding you…". The sky now renders immediately from a primed location
      // (see primeLocation) and this only refines it in the background, so a
      // shorter budget costs nothing and keeps the refine snappy.
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 }
    );
  });
}

function saveFix(lat, lon) {
  try { localStorage.setItem(LAST_FIX_KEY, JSON.stringify({ lat, lon })); } catch {}
}

function loadFix() {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_FIX_KEY) || 'null');
    if (raw && typeof raw.lat === 'number' && typeof raw.lon === 'number') return raw;
  } catch {}
  return null;
}

/**
 * Synchronously give sensorState *some* usable location so the sky can render
 * on the very next frame: the last real fix we saw (accurate for anyone who
 * isn't travelling), else the approximate default. geolocate() then refines
 * this in the background. Stars are only about a pixel out of place per 15s of
 * sidereal drift, and being a city off is far better than an empty screen.
 */
export function primeLocation() {
  const saved = loadFix();
  if (saved) {
    sensorState.lat = saved.lat;
    sensorState.lon = saved.lon;
    sensorState.usingDefaultLocation = false;
  } else {
    sensorState.lat = DEFAULT_LAT;
    sensorState.lon = DEFAULT_LON;
    sensorState.usingDefaultLocation = true;
  }
  sensorState.hasLocation = true;
  return sensorState;
}

/**
 * A first GPS fix — especially indoors, or right after opening the app — can
 * simply time out once with no real problem; a single silent retry clears most
 * of those before bothering the user. A permission *denial* is never retried
 * (asking again won't change the answer without the user acting first).
 *
 * This never throws: real location is always attempted (and used when it
 * succeeds), but any failure — denied, timed out, or no geolocation API at
 * all — falls back to an approximate default rather than leaving Sky mode
 * stuck on a dead-end error with no in-app way forward. A toddler can't go
 * fix a permission in Settings; the sky should still work.
 */
export async function geolocate() {
  let pos;
  try {
    pos = await getPositionOnce();
  } catch (err) {
    if (!err.denied) {
      try {
        await new Promise((r) => setTimeout(r, 1500));
        pos = await getPositionOnce();
      } catch {
        useDefaultLocation();
        return sensorState;
      }
    } else {
      useDefaultLocation();
      return sensorState;
    }
  }
  sensorState.lat = pos.coords.latitude;
  sensorState.lon = pos.coords.longitude;
  sensorState.hasLocation = true;
  sensorState.usingDefaultLocation = false;
  // Remembered so the next launch can render an accurate sky instantly instead
  // of falling back to the generic default while it waits on GPS.
  saveFix(sensorState.lat, sensorState.lon);
  return sensorState;
}

function useDefaultLocation() {
  // Never downgrade a location we already trust. primeLocation() may have
  // already restored a real remembered fix; clobbering that with the generic
  // default just because this refresh timed out would move the user's sky to
  // another country for no reason. Only fill in when we have nothing at all.
  if (sensorState.hasLocation && !sensorState.usingDefaultLocation) return;
  sensorState.lat = DEFAULT_LAT;
  sensorState.lon = DEFAULT_LON;
  sensorState.hasLocation = true;
  sensorState.usingDefaultLocation = true;
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
