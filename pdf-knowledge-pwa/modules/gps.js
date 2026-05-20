// GPS altitude watcher — feeds phase auto-detection and the sub-10,000 ft AOV
// mode. Ported from the "Airspeed Unreliable" app's watchPosition pattern.
//
// NOTE: GPS altitude is geometric WGS-84, not barometric — fine for the AOV
// 10,000 ft gate, not for precise flight data. Manual phase selection always
// overrides the detected phase.

import { phaseForAltitude, isAov } from './phases.js';

const M_TO_FT = 3.28084;
const HISTORY_MS = 30000;

let watchId = null;
const altHistory = []; // { t, altFt }
const listeners = new Set();

const state = {
  active: false,
  altFt: null,
  trend: 0,        // +1 climbing, -1 descending, 0 level
  accuracyFt: null,
  phase: null,
  aov: false,
  error: null,
};

export function getState() { return { ...state }; }

export function onUpdate(cb) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function emit() {
  const snap = getState();
  for (const cb of listeners) {
    try { cb(snap); } catch (err) { console.warn('gps listener failed', err); }
  }
}

export function isActive() { return state.active; }

export function start() {
  if (!('geolocation' in navigator)) {
    state.error = 'Geolocation is not available on this device.';
    emit();
    return false;
  }
  if (watchId != null) return true;
  watchId = navigator.geolocation.watchPosition(onPosition, onError, {
    enableHighAccuracy: true,
    maximumAge: 2000,
    timeout: 20000,
  });
  state.active = true;
  state.error = null;
  emit();
  return true;
}

export function stop() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  state.active = false;
  emit();
}

function computeTrend() {
  if (altHistory.length < 2) return 0;
  const first = altHistory[0];
  const last = altHistory[altHistory.length - 1];
  const dt = (last.t - first.t) / 1000;
  if (dt < 4) return 0;
  const rate = (last.altFt - first.altFt) / dt; // ft/s
  if (rate > 3) return 1;
  if (rate < -3) return -1;
  return 0;
}

function onPosition(pos) {
  const altM = pos.coords.altitude;
  if (altM == null || Number.isNaN(altM)) {
    state.error = 'No altitude fix yet — needs a clear view of the sky.';
    emit();
    return;
  }
  const altFt = altM * M_TO_FT;
  const now = Date.now();
  altHistory.push({ t: now, altFt });
  while (altHistory.length > 2 && now - altHistory[0].t > HISTORY_MS) altHistory.shift();

  state.altFt = altFt;
  state.accuracyFt = pos.coords.altitudeAccuracy != null
    ? pos.coords.altitudeAccuracy * M_TO_FT : null;
  state.trend = computeTrend();
  state.aov = isAov(altFt);
  state.phase = phaseForAltitude(altFt, state.trend);
  state.error = null;
  emit();
}

function onError(err) {
  state.error = err && err.message ? err.message : 'Location permission denied.';
  emit();
}
