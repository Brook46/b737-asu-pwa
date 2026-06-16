// crash.js — Apple-Watch-style impact detection via the accelerometer.
//
// A hard impact (a crash on launch/landing, a fall) shows up as a big spike in
// total acceleration. When we see one, we hand off to a callback that starts the
// SOS countdown — with a full minute to cancel, in case it was a false alarm.
//
// iOS needs explicit motion permission, granted from inside a user gesture, so
// arm() must be called from a tap handler.

let onImpactCb = () => {};
let armed = false;
let lastTrigger = 0;

const IMPACT_G = 4;                 // ~4g total — a real knock, not normal handling
const IMPACT_MS2 = IMPACT_G * 9.81;
const COOLDOWN_MS = 8000;

export function onImpact(fn) { onImpactCb = fn || onImpactCb; }
export function isArmed() { return armed; }

// Returns 'on' | 'denied' | 'unsupported'. Call from a user gesture.
export async function arm() {
  if (armed) return 'on';
  if (typeof DeviceMotionEvent === 'undefined') return 'unsupported';
  try {
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      const res = await DeviceMotionEvent.requestPermission();
      if (res !== 'granted') return 'denied';
    }
  } catch { return 'denied'; }
  window.addEventListener('devicemotion', onMotion);
  armed = true;
  return 'on';
}

export function disarm() {
  window.removeEventListener('devicemotion', onMotion);
  armed = false;
}

function onMotion(e) {
  const a = e.accelerationIncludingGravity || e.acceleration;
  if (!a) return;
  const mag = Math.hypot(a.x || 0, a.y || 0, a.z || 0);
  if (mag > IMPACT_MS2 && Date.now() - lastTrigger > COOLDOWN_MS) {
    lastTrigger = Date.now();
    onImpactCb();
  }
}

// Used by the simulator to test the whole crash→SOS flow without a real impact.
export function simulateImpact() { onImpactCb(); }
