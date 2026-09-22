// sensors.js — geolocation + device compass/tilt for the Sky screen, with the same
// iOS permission-gate trick used elsewhere in this repo (root app.js, xcsky-pwa):
// DeviceOrientationEvent.requestPermission() is only ever called inside a real tap,
// and iOS remembers "granted" per-origin so later launches need no dialog at all.

import { declination } from './geomag.js?v=23';

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
  heading: 0,     // TRUE bearing the view points at, 0 = north, clockwise (derived)
  pitch: 0,       // degrees above the horizon the view is looking, + up (derived)
  usingDevice: false, // true once real device-orientation events are flowing
  compassNeedsCalibration: false, // iOS reports a poor heading accuracy
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

// ---------------------------------------------------------------------------
// Where the phone is looking.
//
// The first version turned the event into a compass heading plus "pitch =
// beta − 90" and moved stars by (Δazimuth, Δaltitude) × pixels-per-degree. That
// is only right for a phone held perfectly upright, in portrait, looking at the
// horizon. Everything else drifted, which is why pointing at a real star didn't
// put it on screen:
//   • roll was ignored, so a slightly tilted phone showed an untilted sky;
//   • landscape (the natural way to hold an iPad) swapped the axes — beta no
//     longer measures pitch at all;
//   • an azimuth step was drawn the same width at every altitude, when near the
//     zenith 30° of azimuth is only a few degrees of sky;
//   • iOS reports MAGNETIC north (5° off in Israel, 13° in California);
//   • and webkitCompassHeading jumps 180° as the phone tilts past vertical —
//     exactly the pose you use to look up.
//
// So this now keeps the phone's full 3-D orientation as a quaternion, the same
// model as SkyView/Star Walk: the gyro-fused alpha/beta/gamma give a smooth,
// fast orientation, the compass only supplies a slowly-filtered correction to
// true north, and sky.js projects every object through the resulting camera.
// World frame is ENU: x = east, y = north, z = up.
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;

function qMul(a, b) {
  return [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
}
function qAxis(x, y, z, rad) {
  const s = Math.sin(rad / 2);
  return [Math.cos(rad / 2), x * s, y * s, z * s];
}
function qRotate(q, v) {
  const [w, x, y, z] = q;
  // v' = v + 2w(q×v) + 2q×(q×v)
  const tx = 2 * (y * v[2] - z * v[1]);
  const ty = 2 * (z * v[0] - x * v[2]);
  const tz = 2 * (x * v[1] - y * v[0]);
  return [
    v[0] + w * tx + (y * tz - z * ty),
    v[1] + w * ty + (z * tx - x * tz),
    v[2] + w * tz + (x * ty - y * tx),
  ];
}

// W3C DeviceOrientation: device → world is Rz(alpha) · Rx(beta) · Ry(gamma).
function eulerToQuat(alpha, beta, gamma) {
  return qMul(qMul(qAxis(0, 0, 1, alpha * DEG), qAxis(1, 0, 0, beta * DEG)), qAxis(0, 1, 0, gamma * DEG));
}

let rawQ = null;          // latest device → world orientation, alpha as reported
let headingRef = 'none';  // 'ios' (calibrated from webkitCompassHeading), 'absolute', or 'none'
let offC = 1, offS = 0;   // iOS: filtered rotation about "up" that maps raw alpha onto magnetic north
let calibQuality = 'none'; // 'none' → 'provisional' → 'good'
let calibSamples = 0, outliers = 0;
let declCache = { key: '', deg: 0 };

// Which device axis webkitCompassHeading measures is NOT fixed. Core Location
// defines heading as the bearing of the phone's TOP edge, but measured on real
// iPhones (github.com/bergeronK/Twilight#62) the reported value switches to
// following the CAMERA once the phone tips back past about 120° — the exact pose
// used to look up at the sky — and WebKit passes CLHeading straight through
// (WebCoreMotionManager.mm). The only pose where there is no ambiguity, in
// portrait or landscape, is SCREEN FACING UP: then it is the top edge.
//
// So: samples taken screen-up are authoritative. Before we have one, a
// provisional estimate assumes the camera (right for the upright/raised poses
// a user starts in). Once authoritative, other poses are ignored and the gyro
// alone carries the view — iOS's alpha is gyro-fused and barely drifts.
function calibrateFromCompass(q, compassDeg, accuracy) {
  if (typeof accuracy === 'number') {
    if (accuracy < 0) return; // iOS marks an invalid reading this way
    sensorState.compassNeedsCalibration = accuracy > 25;
  }
  const back = qRotate(q, [0, 0, -1]);
  const top = qRotate(q, [0, 1, 0]);
  const screenUp = -back[2]; // how much the screen's normal points at the sky
  let axis, authoritative;
  if (screenUp > 0.3 && Math.hypot(top[0], top[1]) > 0.4) {
    axis = top; authoritative = true;
  } else if (calibQuality === 'good') {
    return;
  } else if (screenUp > -0.35 && Math.hypot(top[0], top[1]) > 0.2) {
    // Still short of the switch (< ~110° of tilt): the top edge, even though
    // it now points back over your shoulder, 180° from the camera.
    axis = top; authoritative = false;
  } else if (screenUp < -0.65) {
    axis = back; authoritative = false; // well past it (> ~130°): the camera
  } else {
    return; // the switch band itself — either answer could be the one reported
  }
  const off = compassDeg * DEG - Math.atan2(axis[0], axis[1]);
  const c = Math.cos(off), s = Math.sin(off);
  const promote = authoritative && calibQuality !== 'good';
  if (calibQuality === 'none' || promote) {
    offC = c; offS = s; calibSamples = 1; outliers = 0;
    calibQuality = authoritative ? 'good' : 'provisional';
    return;
  }
  // Jump gate: a sample more than 60° from the estimate is a pose flip or a
  // magnetic disturbance, not the phone turning (the gyro already covers that).
  // Adopt it only if it persists ~¾ s.
  if (c * offC + s * offS < 0.5) {
    if (++outliers < 45) return;
    offC = c; offS = s; outliers = 0; calibSamples = 1;
    return;
  }
  outliers = 0;
  // Fast while settling, then slow: the gyro carries the motion; the compass
  // only stops it drifting, and its own jitter must not reach the screen.
  const k = calibSamples < 20 ? 0.25 : 0.03;
  offC += (c - offC) * k; offS += (s - offS) * k;
  const n = Math.hypot(offC, offS) || 1;
  offC /= n; offS /= n;
  calibSamples++;
}

function handleOrientation(e) {
  // Desktop browsers fire one event with all-null angles: no sensor at all.
  if (e.alpha == null || e.beta == null || e.gamma == null) return;
  const q = eulerToQuat(e.alpha, e.beta, e.gamma);
  if (typeof e.webkitCompassHeading === 'number' && e.webkitCompassHeading >= 0) {
    calibrateFromCompass(q, e.webkitCompassHeading, e.webkitCompassAccuracy);
    headingRef = 'ios';
  } else if (e.absolute === true || e.type === 'deviceorientationabsolute') {
    headingRef = 'absolute';
  }
  rawQ = q;
  sensorState.usingDevice = true;
}

// How far the displayed page is rotated from the device's own portrait frame
// (0, 90, 180 or 270; 90 = turned counter-clockwise, top edge to the left —
// window.orientation's convention). The browser APIs for this can't be
// trusted on Apple devices:
//   • iPad Safari (desktop-class, the default) reports screen.orientation.angle
//     as 0 however the iPad is held, and has no window.orientation at all. That
//     made a sideways iPad look upright to us — the view slid sideways when
//     tilting up/down, a 90° error. (Reported from a real iPad.)
//   • iPhone Safari's screen.orientation.angle has the opposite sign to
//     window.orientation (WebKit bug 254863) — a 180° error in landscape.
// So it's derived the way the OS itself decides to rotate the screen: the
// viewport's shape says portrait or landscape (always right, and it respects
// rotation lock, since it IS the layout), and gravity — which edge of the
// device is up — says which way round. When the device is nearly flat or
// pointed straight up, gravity can't tell, so the last answer is kept.
let landscapeAngle = null, portraitAngle = 0;
function screenAngle(q) {
  const landscape = window.innerWidth > window.innerHeight;
  const up = qRotate([q[0], -q[1], -q[2], -q[3]], [0, 0, 1]); // world up, in device axes
  if (landscape) {
    if (Math.abs(up[0]) > 0.35 && Math.abs(up[0]) > Math.abs(up[1])) landscapeAngle = up[0] > 0 ? 90 : 270;
    if (landscapeAngle === null) {
      // No clear reading yet: window.orientation where it exists (iPhone), else
      // assume the commonest way an iPad is held.
      const wo = window.orientation;
      landscapeAngle = wo === 90 ? 90 : wo === -90 ? 270 : 90;
    }
    return landscapeAngle;
  }
  if (Math.abs(up[1]) > 0.35 && Math.abs(up[1]) > Math.abs(up[0])) portraitAngle = up[1] > 0 ? 0 : 180;
  return portraitAngle;
}

function declinationDeg() {
  if (!sensorState.hasLocation) return 0;
  const key = `${sensorState.lat.toFixed(1)},${sensorState.lon.toFixed(1)}`;
  if (declCache.key !== key) {
    try { declCache = { key, deg: declination(sensorState.lat, sensorState.lon) }; }
    catch { declCache = { key, deg: 0 }; }
  }
  return declCache.deg;
}

// Drag-to-look (no sensors, or permission denied). Starts facing the equator
// side of the sky, where the Sun, Moon and planets actually travel.
let dragHeading = null, dragPitch = 25;
let smoothQ = null, lastViewT = 0;

/** Drag-to-look fallback — same view, touch-fed. */
export function nudge(dHeading, dPitch) {
  if (dragHeading === null) dragHeading = (sensorState.lat ?? 1) >= 0 ? 180 : 0;
  dragHeading = (dragHeading + dHeading + 360) % 360;
  dragPitch = Math.max(-85, Math.min(88, dragPitch + dPitch));
}

/**
 * The view for this frame, as an orthonormal camera basis in true-north ENU:
 * `fwd` is where the back of the phone points, `right`/`up` are the screen's
 * own axes. Also refreshes sensorState.heading/pitch. Call once per frame.
 */
export function readView(now = performance.now()) {
  let right, up, fwd;
  if (sensorState.usingDevice && rawQ) {
    let turn = declinationDeg() * DEG;                 // magnetic → true
    if (headingRef === 'ios') turn += Math.atan2(offS, offC); // raw alpha → magnetic
    let target = qMul(qAxis(0, 0, 1, -turn), rawQ);     // a bearing +θ is a turn of −θ about up
    target = qMul(target, qAxis(0, 0, 1, -screenAngle(rawQ) * DEG));
    const dt = Math.min(0.1, Math.max(0.001, (now - lastViewT) / 1000));
    lastViewT = now;
    if (!smoothQ) smoothQ = target;
    else {
      let d = smoothQ[0] * target[0] + smoothQ[1] * target[1] + smoothQ[2] * target[2] + smoothQ[3] * target[3];
      if (d < 0) { target = target.map((v) => -v); d = -d; }
      // Light, motion-adaptive smoothing: steady when held still (kills sensor
      // shimmer), immediate when swung (no rubber-band lag behind the hand).
      const angDeg = 2 * Math.acos(Math.min(1, d)) / DEG;
      const tau = Math.max(0.015, 0.09 - angDeg * 0.02);
      const k = 1 - Math.exp(-dt / tau);
      smoothQ = smoothQ.map((v, i) => v + (target[i] - v) * k);
      const n = Math.hypot(...smoothQ);
      smoothQ = smoothQ.map((v) => v / n);
    }
    right = qRotate(smoothQ, [1, 0, 0]);
    up = qRotate(smoothQ, [0, 1, 0]);
    fwd = qRotate(smoothQ, [0, 0, -1]);
  } else {
    if (dragHeading === null) dragHeading = (sensorState.lat ?? 1) >= 0 ? 180 : 0;
    const h = dragHeading * DEG, p = dragPitch * DEG;
    fwd = [Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)];
    right = [Math.cos(h), -Math.sin(h), 0];
    up = [ // right × fwd
      right[1] * fwd[2] - right[2] * fwd[1],
      right[2] * fwd[0] - right[0] * fwd[2],
      right[0] * fwd[1] - right[1] * fwd[0],
    ];
  }
  sensorState.heading = ((Math.atan2(fwd[0], fwd[1]) / DEG) + 360) % 360;
  sensorState.pitch = Math.asin(Math.max(-1, Math.min(1, fwd[2]))) / DEG;
  return { right, up, fwd };
}

/** Safe to call on every launch — delivers events only if already granted. */
export function startDeviceOrientation() {
  // Android Chrome: the absolute event's alpha is already north-referenced.
  // iOS has no absolute event; its plain event carries webkitCompassHeading.
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

// Test hook: lets a harness feed synthetic orientation events through the
// exact same path as real ones (the preview browser has no sensors).
export function _feedOrientation(e) { handleOrientation(e); }
