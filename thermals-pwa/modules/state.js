// state.js — the local pilot's current activity state.
//
// FLYING and WALKING switch automatically from motion (airborne ⇒ flying, on
// the ground ⇒ walking). The vehicle/hitch states are manual: tapping one pins
// it and pauses auto-switching until you tap Flying or On-the-ground again.

import {
  STATES, STATE_ORDER, AUTO_STATES,
  FLY_AGL_M, FLY_CONFIRM_MS, LAND_AGL_M, LAND_CONFIRM_MS,
  BEER_FROM_START_MS, BEER_AWAY_MS,
} from '../config.js';
import { glyphSVG } from './icons.js';

const KEY = 'thermals.state';
const SEATS_KEY = 'thermals.seats';
// Never restore a saved FLYING state — flying is decided live by height, and a
// stale FLYING on launch would lock the selector on the ground.
let current = (() => {
  const saved = localStorage.getItem(KEY);
  return (STATES[saved] && saved !== 'FLYING') ? saved : 'WALKING';
})();
let seats = Number(localStorage.getItem(SEATS_KEY) || 0);
const subs = new Set();
let onSeatsRequest = () => {};

export function getState() { return current; }
export function getSeats() { return seats; }

// Free seats you're offering when on a Retrieve run, so the crew can see who to
// catch a ride with. Changing seats notifies subscribers (to re-broadcast).
export function setSeats(n) {
  seats = Math.min(8, Math.max(0, n | 0));
  localStorage.setItem(SEATS_KEY, String(seats));
  subs.forEach((fn) => fn(current));
  renderSelector();
}

// app.js wires this to open the seats picker on a long-press of Retrieve.
export function setOnSeatsRequest(fn) { onSeatsRequest = fn || onSeatsRequest; }

export function setState(id) {
  if (!STATES[id] || id === current) return;
  current = id;
  localStorage.setItem(KEY, id);
  subs.forEach((fn) => fn(current));
  renderSelector();
}

export function onState(fn) { subs.add(fn); return () => subs.delete(fn); }

// Auto flying / walking / driving from speed + vertical rate. Only acts when
// the current state is auto-managed (a manually chosen Retrieve/Bus/Hitch is
// left alone). Hysteresis: the in-between zones keep the current state so it
// doesn't flicker. Speeds m/s; vrate is |altitude change| in m/s.
//   • Real vertical movement at flight pace  → FLYING (the strongest signal —
//     paragliders climb/sink; cars and walkers stay level).
//   • Fast and level                          → DRIVING (road speed).
//   • Slow and level                          → WALKING.
// Speeds in m/s. A state *machine* (rather than re-deciding each tick) for
// stability. Flying is driven by height above ground (AGL); when AGL isn't
// available we fall back to climb-rate + speed.
const DRIVE_SPEED = 5.56;  // 20 km/h — walk → car
const STOP_SPEED = 1.4;    // ~5 km/h — car/ride has stopped
const STILL_SPEED = 0.8;   // basically parked
const WALK_SPEED = 1.8;    // moving on foot
const STOP_MS = 6000;      // confirm a car/ride has really stopped

let airSince = null;       // continuously airborne since
let landSince = null;      // on the ground & slow since
let slowSince = null;      // speed < STOP_SPEED since
let stillSince = null;     // not moving at all since
let movedSinceStart = false;

export function applyAutoState(geo) {
  const cur = current;
  if (!geo || !AUTO_STATES.includes(cur)) return;
  const spd = geo.speed;
  if (spd == null || Number.isNaN(spd)) return;
  const vr = Math.abs(geo.vrate ?? 0);
  const agl = geo.agl;       // metres above ground, may be null
  const now = Date.now();
  if (spd > STILL_SPEED) movedSinceStart = true;

  // Airborne / on-ground from AGL where we have it, else from climb-rate.
  const airborne = agl != null ? agl > FLY_AGL_M : (vr > 0.7 || (spd >= 4 && spd <= 22 && vr > 0.35));
  const onGround = agl != null ? agl <= LAND_AGL_M : (vr < 0.3 && spd < STILL_SPEED);

  airSince = airborne ? (airSince ?? now) : null;
  landSince = (onGround && spd < DRIVE_SPEED) ? (landSince ?? now) : null;   // ground + under 20 km/h
  slowSince = spd < STOP_SPEED ? (slowSince ?? now) : null;
  stillSince = spd < STILL_SPEED ? (stillSince ?? now) : null;

  const intoFlight = airSince && now - airSince > FLY_CONFIRM_MS;            // AGL>5 for 5 s
  const beerDelay = movedSinceStart ? BEER_AWAY_MS : BEER_FROM_START_MS;

  let next = cur;
  switch (cur) {
    case 'FLYING':                                   // leave only after a full minute landed
      if (landSince && now - landSince > LAND_CONFIRM_MS) next = 'WALKING';
      break;
    case 'WALKING':
      if (intoFlight) next = 'FLYING';
      else if (spd > DRIVE_SPEED) next = 'DRIVING';
      else if (stillSince && now - stillSince > beerDelay) next = 'BEER';
      break;
    case 'DRIVING':
      if (intoFlight) next = 'FLYING';
      else if (slowSince && now - slowSince > STOP_MS) next = 'WALKING';
      break;
    case 'BEER':
      if (intoFlight) next = 'FLYING';
      else if (spd > DRIVE_SPEED) next = 'DRIVING';
      else if (spd > WALK_SPEED) next = 'WALKING';
      break;
    case 'HITCHHIKING':                              // got picked up
      if (spd > DRIVE_SPEED) next = 'HITCH_CAR';
      break;
    case 'HITCH_CAR':
      if (intoFlight) next = 'FLYING';
      else if (slowSince && now - slowSince > STOP_MS) next = 'HITCHHIKING';
      break;
  }
  if (next !== cur) setState(next);
}

// Render the four-state + grounded selector into #state-selector.
export function renderSelector() {
  const host = document.getElementById('state-selector');
  if (!host) return;
  // Flying is automatic and can't be changed by hand — show a locked indicator
  // instead of the buttons while you're in the air.
  if (current === 'FLYING') {
    host.classList.add('is-locked');
    host.innerHTML = `<div class="flying-lock">${glyphSVG('FLYING', 'currentColor', 22)}<span>Flying — automatic</span></div>`;
    return;
  }
  host.classList.remove('is-locked');
  host.innerHTML = STATE_ORDER.map((id) => {
    const s = STATES[id];
    const on = id === current ? ' is-on' : '';
    const badge = (id === 'RETRIEVE' && seats > 0) ? `<span class="seat-pill">${seats}</span>` : '';
    return `<button class="state-btn${on}" data-state="${id}" title="${s.label}">
      ${glyphSVG(id, 'currentColor', 24)}${badge}<span>${s.label}</span>
    </button>`;
  }).join('');
  host.querySelectorAll('.state-btn').forEach((b) => {
    b.addEventListener('click', () => setState(b.dataset.state));
    // Long-press Retrieve to set how many free seats you have.
    if (b.dataset.state === 'RETRIEVE') attachLongPress(b, () => onSeatsRequest());
  });
}

// Fire `cb` after a 500ms press; cancel on release/move/leave.
function attachLongPress(el, cb) {
  let t = null;
  const start = () => { t = setTimeout(() => { t = null; cb(); }, 500); };
  const cancel = () => { if (t) { clearTimeout(t); t = null; } };
  el.addEventListener('pointerdown', start);
  el.addEventListener('pointerup', cancel);
  el.addEventListener('pointerleave', cancel);
  el.addEventListener('pointercancel', cancel);
}
