// g.js — DeviceMotion-based accelerometer capture for the landing G score.
//
// On iOS 13+ DeviceMotionEvent.requestPermission() must be called inside
// a user gesture before any 'devicemotion' events fire. We expose that as
// requestPermission() so app.js can wire it to a Settings → Sensors row.
//
// We don't try to filter gravity from the readings — the goal is "what
// felt like the impact peak". |a| / 9.81 with accelerationIncludingGravity
// hovers around 1.0 G at rest and spikes on touchdown. A 10-second window
// centred on GPS-detected landing_at is the peak reported as max_g.
//
// Public API:
//   isSupported()        → bool
//   permissionRequired() → bool  (iOS 13+)
//   requestPermission()  → 'granted' | 'denied' | 'prompt'
//   start()              → begin sampling
//   stop()               → end sampling
//   peakG(centerMs, windowSec) → number | null
//
// Behaviour mirrors gps.js: module-scoped state so start/stop pair up
// cleanly even if the caller forgets to debounce.

const SLIDING_WINDOW_MS = 30_000;  // keep the last 30s of samples
const G_EARTH = 9.81;

let listening = false;
const samples = [];  // { ts, g }

export function isSupported() {
  return typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
}

export function permissionRequired() {
  return isSupported() && typeof DeviceMotionEvent.requestPermission === 'function';
}

export async function requestPermission() {
  if (!isSupported()) return 'denied';
  if (!permissionRequired()) return 'granted';
  try {
    return await DeviceMotionEvent.requestPermission();
  } catch {
    return 'denied';
  }
}

function onMotion(e) {
  const a = e.accelerationIncludingGravity;
  if (!a) return;
  const x = Number.isFinite(a.x) ? a.x : 0;
  const y = Number.isFinite(a.y) ? a.y : 0;
  const z = Number.isFinite(a.z) ? a.z : 0;
  const mag = Math.sqrt(x * x + y * y + z * z);
  const g = mag / G_EARTH;
  const ts = e.timeStamp ? performance.timeOrigin + e.timeStamp : Date.now();
  samples.push({ ts, g });
  // Drop anything older than the sliding window
  const cutoff = ts - SLIDING_WINDOW_MS;
  while (samples.length && samples[0].ts < cutoff) samples.shift();
}

export function start() {
  if (listening || !isSupported()) return;
  samples.length = 0;
  try {
    window.addEventListener('devicemotion', onMotion, { passive: true });
    listening = true;
  } catch {
    listening = false;
  }
}

export function stop() {
  if (!listening) return;
  try { window.removeEventListener('devicemotion', onMotion); } catch {}
  listening = false;
}

// Peak G in the [centerMs - half, centerMs + half] window. half = windowSec/2.
// Returns null when the window is empty (which can happen if the pilot
// declines motion permission — call sites should treat that as "no
// score").
export function peakG(centerMs, windowSec = 10) {
  if (!samples.length) return null;
  const half = (windowSec / 2) * 1000;
  let max = null;
  for (const s of samples) {
    if (s.ts < centerMs - half) continue;
    if (s.ts > centerMs + half) break;
    if (max == null || s.g > max) max = s.g;
  }
  return max;
}

// For diagnostics — current G the sensor is reporting (mostly ~1.0 at rest).
export function currentG() {
  if (!samples.length) return null;
  return samples.at(-1).g;
}
