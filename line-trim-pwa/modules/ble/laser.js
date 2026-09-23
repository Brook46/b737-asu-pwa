// ble/laser.js — one shared connection to a laser meter, driver-agnostic.

import { DRIVERS } from './drivers.js?v=9';

const listeners = new Set();   // ({type, ...}) => void
let state = {
  driverId: 'manual',
  status: 'idle',              // idle | connecting | connected | error
  message: '',
  lastMm: null,                // raw device distance, millimetres
  lastAt: 0,
  device: null,
  log: [],                     // recent driver log lines (newest last, capped)
};
let cleanup = null;
// what the screen expects next (raw mm) — only the desk mocks read it, so they
// can aim near the right length the way a real laser on a real line would
let aimHint = null;
export function setAimHint(fn) { aimHint = fn; }
const aim = () => { try { return aimHint?.() ?? null; } catch { return null; } };

function emit(patch) {
  state = { ...state, ...patch };
  for (const fn of listeners) fn(state);
}
function pushLog(text) {
  const log = [...state.log, `${new Date().toLocaleTimeString()}  ${text}`].slice(-40);
  emit({ log });
}

export function subscribe(fn) {
  listeners.add(fn);
  fn(state);
  return () => listeners.delete(fn);
}

export function getState() { return state; }

export function bluetoothAvailable() {
  return typeof navigator !== 'undefined' && !!navigator.bluetooth;
}

export async function connect(driverId) {
  const driver = DRIVERS[driverId];
  if (!driver) throw new Error(`unknown driver ${driverId}`);
  await disconnect();

  emit({ driverId, status: 'connecting', message: '', log: [] });

  if (!driver.needsBluetooth) {
    try {
      cleanup = await driver.attach(null, { onReading, onLog: pushLog, aim });
      emit({ status: 'connected', message: driver.label, device: null });
    } catch (e) {
      emit({ status: 'error', message: e.message });
    }
    return;
  }

  if (!bluetoothAvailable()) {
    emit({ status: 'error', message: 'Web Bluetooth not available. Use Chrome (Android/desktop) — iOS Safari has no Web Bluetooth.' });
    return;
  }

  let device;
  try {
    device = await navigator.bluetooth.requestDevice(driver.requestOptions);
  } catch (e) {
    emit({ status: e.name === 'NotFoundError' ? 'idle' : 'error',
           message: e.name === 'NotFoundError' ? 'No device picked.' : e.message });
    return;
  }

  device.addEventListener('gattserverdisconnected', onDrop);
  try {
    cleanup = await driver.attach(device, { onReading, onLog: pushLog });
    emit({ status: 'connected', message: device.name || 'BLE device', device });
  } catch (e) {
    pushLog('attach failed: ' + e.message);
    emit({ status: 'error', message: e.message, device });
  }
}

function onReading(mm, meta = {}) {
  emit({ lastMm: mm, lastAt: Date.now() });
  for (const fn of listeners) fn(state, { type: 'reading', mm, meta });
}

function onLog(text) { pushLog(text); }

async function onDrop() {
  pushLog('device disconnected');
  emit({ status: 'idle', message: 'Disconnected' });
}

export async function disconnect() {
  try { if (cleanup) await cleanup(); } catch {}
  cleanup = null;
  const d = state.device;
  if (d) {
    try { d.removeEventListener('gattserverdisconnected', onDrop); } catch {}
    try { if (d.gatt?.connected) d.gatt.disconnect(); } catch {}
  }
  emit({ status: 'idle', device: null, lastMm: null });
}
