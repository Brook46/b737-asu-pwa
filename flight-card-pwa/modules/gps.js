// gps.js — GPS-driven takeoff / landing detector for the active leg.
//
// State machine: armed → airborne → landed → done. Driven by
// navigator.geolocation.watchPosition with enableHighAccuracy. The
// thresholds are tuned for a 737NG:
//
//   airborne: groundspeed > 120 kt for 30 consecutive seconds AND
//             climb rate > 500 fpm over the same window
//   landed:   after airborne, groundspeed < 80 kt for 60 consecutive
//             seconds AND altitude trend flat (Δ < 50 ft)
//
// We persist takeoff_at / landing_at to the leg's dataCard so a tab
// reload mid-flight resumes from the right state.
//
// iOS PWA caveat: watchPosition only fires while the page is visible.
// app.js pauses + resumes on visibilitychange — see disarm/arm.
//
// Public API:
//   isSupported()                          → bool
//   requestPermission()                    → 'granted'|'denied'|'prompt'
//   arm(leg, onUpdate)                     → start the state machine
//   disarm()                               → stop watching
//   getState()                             → { phase, takeoff_at, landing_at }
//
// onUpdate signature: onUpdate(event, payload)
//   ('airborne', { takeoff_at })
//   ('landed',   { landing_at, actual_flight_time })
//   ('error',    { code, message })

const MPS_TO_KT = 1.9438445;   // m/s → knots
const M_TO_FT   = 3.2808399;   // metres → feet

// Thresholds — see header comment.
const KT_AIRBORNE   = 120;
const KT_LANDED     = 80;
const FPM_AIRBORNE  = 500;
const HOLD_AIRBORNE_SEC = 30;
const HOLD_LANDED_SEC   = 60;
const ALT_FLAT_FT       = 50;

// Watch state — module-scoped so disarm() can clear everything reliably.
let watchId       = null;
let onUpdateCb    = null;
let activeLeg     = null;
let phase         = 'armed';
let takeoffAt     = 0;     // ms epoch
let landingAt     = 0;
// Sliding sample buffer for the state checks. Each entry:
// { ts, lat, lng, alt_m, speed_mps, climb_fpm }
const samples = [];
const MAX_SAMPLES = 200;
// Last position used for climb-rate finite difference. Not the same as the
// last sample because climb rate prefers a 5-second baseline to dampen
// GPS altitude noise.
let lastClimbBaseline = null;

// Same per-origin cache as g.js so the Settings → Sensors panel can paint
// the live state without firing getCurrentPosition() on every open (which
// surfaces the iOS prompt on a fresh session even when already granted).
const PERM_STORAGE_KEY = 'fc.sensor.geolocation';

export function isSupported() {
  return typeof navigator !== 'undefined' && !!navigator.geolocation;
}

// Returns 'granted', 'denied', or 'prompt' based on what we last saw.
// Prefers the Permissions API when available (no prompt). Falls back to
// localStorage. Never triggers iOS' system dialog.
export async function cachedPermission() {
  if (!isSupported()) return 'denied';
  try {
    if (navigator.permissions?.query) {
      const r = await navigator.permissions.query({ name: 'geolocation' });
      return r.state;
    }
  } catch {}
  try { return localStorage.getItem(PERM_STORAGE_KEY) || 'prompt'; }
  catch { return 'prompt'; }
}

// Tries to read a single position to surface the iOS permission prompt.
// Resolves with the underlying permission state. Never rejects — the
// caller decides what to do with each state.
export function requestPermission() {
  return new Promise((resolve) => {
    if (!isSupported()) { resolve('denied'); return; }
    navigator.geolocation.getCurrentPosition(
      () => {
        try { localStorage.setItem(PERM_STORAGE_KEY, 'granted'); } catch {}
        resolve('granted');
      },
      (err) => {
        const state = err && err.code === 1 ? 'denied' : 'prompt';
        try { localStorage.setItem(PERM_STORAGE_KEY, state); } catch {}
        resolve(state);
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 }
    );
  });
}

export function getState() {
  return {
    phase,
    takeoff_at: takeoffAt || (activeLeg?.dataCard?.takeoff_at | 0),
    landing_at: landingAt || (activeLeg?.dataCard?.landing_at | 0),
  };
}

// Resume from whatever takeoff_at / landing_at the leg already has — so a
// reload mid-flight doesn't restart the state machine.
function resumePhaseFromLeg(leg) {
  const d = (leg && leg.dataCard) || {};
  if (d.landing_at) {
    landingAt = Number(d.landing_at) || 0;
    takeoffAt = Number(d.takeoff_at) || 0;
    phase = 'done';
  } else if (d.takeoff_at) {
    takeoffAt = Number(d.takeoff_at) || 0;
    landingAt = 0;
    phase = 'airborne';
  } else {
    takeoffAt = 0;
    landingAt = 0;
    phase = 'armed';
  }
}

export function arm(leg, onUpdate) {
  if (!isSupported()) {
    onUpdate && onUpdate('error', { code: 'unsupported', message: 'Geolocation API not available' });
    return;
  }
  if (watchId != null) disarm();
  activeLeg = leg || null;
  onUpdateCb = typeof onUpdate === 'function' ? onUpdate : null;
  samples.length = 0;
  lastClimbBaseline = null;
  resumePhaseFromLeg(activeLeg);
  if (phase === 'done') {
    // Nothing to do — leg already landed in a prior session.
    return;
  }
  try {
    watchId = navigator.geolocation.watchPosition(
      handlePosition,
      (err) => onUpdateCb && onUpdateCb('error', { code: err.code, message: err.message }),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 2_000 }
    );
  } catch (err) {
    onUpdateCb && onUpdateCb('error', { code: 'watch_failed', message: String(err) });
  }
}

export function disarm() {
  if (watchId != null) {
    try { navigator.geolocation.clearWatch(watchId); } catch {}
    watchId = null;
  }
  onUpdateCb = null;
}

function handlePosition(pos) {
  if (!pos || !pos.coords) return;
  const c = pos.coords;
  const ts = pos.timestamp || Date.now();
  // Some platforms emit null for speed; assume 0 then so we still tick.
  const speed_mps = Number.isFinite(c.speed) ? c.speed : 0;
  const alt_m     = Number.isFinite(c.altitude) ? c.altitude : null;

  // Climb rate: m/s between this fix and the baseline 5 sec ago. Reset
  // baseline when there's a >7 sec gap (e.g. resumed after backgrounding).
  let climb_fpm = 0;
  if (alt_m != null) {
    if (!lastClimbBaseline) {
      lastClimbBaseline = { ts, alt_m };
    } else {
      const dt = (ts - lastClimbBaseline.ts) / 1000;
      if (dt > 7) {
        lastClimbBaseline = { ts, alt_m };
      } else if (dt >= 4) {
        climb_fpm = ((alt_m - lastClimbBaseline.alt_m) / dt) * 60 * M_TO_FT;
        lastClimbBaseline = { ts, alt_m };
      }
    }
  }

  samples.push({ ts, alt_m, speed_kt: speed_mps * MPS_TO_KT, climb_fpm });
  if (samples.length > MAX_SAMPLES) samples.splice(0, samples.length - MAX_SAMPLES);

  if (phase === 'armed')    checkAirborne();
  else if (phase === 'airborne') checkLanded();
}

// Return samples from the last `windowSec` seconds. Stable cursor walks
// from the back since samples is time-ordered.
function lastWindow(windowSec) {
  const cutoff = (samples.at(-1)?.ts || 0) - windowSec * 1000;
  let i = samples.length - 1;
  while (i > 0 && samples[i - 1].ts >= cutoff) i--;
  return samples.slice(i);
}

function checkAirborne() {
  const win = lastWindow(HOLD_AIRBORNE_SEC);
  if (win.length < 3) return;
  const span = (win.at(-1).ts - win[0].ts) / 1000;
  if (span < HOLD_AIRBORNE_SEC) return;
  // Every sample over the threshold for ground speed; mean climb >500 fpm.
  if (!win.every(s => s.speed_kt > KT_AIRBORNE)) return;
  const meanClimb = win.reduce((a, s) => a + s.climb_fpm, 0) / win.length;
  if (meanClimb < FPM_AIRBORNE) return;
  phase = 'airborne';
  takeoffAt = win[0].ts;
  if (activeLeg) {
    activeLeg.dataCard = activeLeg.dataCard || {};
    activeLeg.dataCard.takeoff_at = takeoffAt;
  }
  onUpdateCb && onUpdateCb('airborne', { takeoff_at: takeoffAt });
}

function checkLanded() {
  const win = lastWindow(HOLD_LANDED_SEC);
  if (win.length < 3) return;
  const span = (win.at(-1).ts - win[0].ts) / 1000;
  if (span < HOLD_LANDED_SEC) return;
  if (!win.every(s => s.speed_kt < KT_LANDED)) return;
  // Altitude flat over the window (max - min < ALT_FLAT_FT).
  const alts = win.map(s => s.alt_m).filter(a => a != null);
  if (alts.length) {
    const spanFt = (Math.max(...alts) - Math.min(...alts)) * M_TO_FT;
    if (spanFt > ALT_FLAT_FT) return;
  }
  phase = 'landed';
  landingAt = win.at(-1).ts;
  const minutes = takeoffAt ? Math.round((landingAt - takeoffAt) / 60000) : 0;
  const hh = Math.floor(minutes / 60);
  const mm = minutes % 60;
  const actual_flight_time = takeoffAt ? `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}` : '';
  if (activeLeg) {
    activeLeg.dataCard = activeLeg.dataCard || {};
    activeLeg.dataCard.landing_at = landingAt;
    if (actual_flight_time) activeLeg.dataCard.actual_flight_time = actual_flight_time;
  }
  onUpdateCb && onUpdateCb('landed', { landing_at: landingAt, actual_flight_time });
  phase = 'done';
}
