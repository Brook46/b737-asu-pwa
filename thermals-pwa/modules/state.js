// state.js — the local pilot's current activity state.
//
// FLYING and WALKING switch automatically from motion (airborne ⇒ flying, on
// the ground ⇒ walking). The vehicle/hitch states are manual: tapping one pins
// it and pauses auto-switching until you tap Flying or On-the-ground again.

import { STATES, STATE_ORDER, AUTO_STATES, BEER_AFTER_MS } from '../config.js';
import { glyphSVG } from './icons.js';

const KEY = 'thermals.state';
const SEATS_KEY = 'thermals.seats';
let current = STATES[localStorage.getItem(KEY)] ? localStorage.getItem(KEY) : 'WALKING';
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
// Speeds in m/s. The whole point of this being a state *machine* (rather than
// re-deciding from scratch each tick) is stability: once you're flying you stay
// flying until you've clearly landed; once on the ground you stay walking until
// you actually pass 20 km/h. That stops the constant flipping.
const DRIVE_SPEED = 5.56;  // 20 km/h — walk → car
const STOP_SPEED = 1.4;    // ~5 km/h — car/ride has stopped
const STILL_SPEED = 0.8;   // basically parked
const WALK_SPEED = 1.8;    // moving on foot
const FLY_VARIO = 0.7;     // m/s climb/sink = airborne
const LAND_MS = 8000;      // stay flying through this much ground time first
const STOP_MS = 6000;      // confirm a car/ride has really stopped

let slowSince = null;      // speed < STOP_SPEED since
let stillSince = null;     // parked (speed + vario tiny) since
let groundSince = null;    // landed-looking (still + level) since

export function applyAutoState(geo) {
  const cur = current;
  if (!geo || !AUTO_STATES.includes(cur)) return;
  const spd = geo.speed;
  if (spd == null || Number.isNaN(spd)) return;
  const vr = Math.abs(geo.vrate ?? 0);
  const now = Date.now();
  const airborne = vr > FLY_VARIO || (spd >= 4 && spd <= 22 && vr > 0.35);

  slowSince = spd < STOP_SPEED ? (slowSince ?? now) : null;
  stillSince = (spd < STILL_SPEED && vr < 0.4) ? (stillSince ?? now) : null;
  groundSince = (spd < STILL_SPEED && vr < 0.3) ? (groundSince ?? now) : null;

  let next = cur;
  switch (cur) {
    case 'FLYING':                                   // sticky — only leave once clearly landed
      if (groundSince && now - groundSince > LAND_MS) next = 'WALKING';
      break;
    case 'WALKING':
      if (airborne) next = 'FLYING';
      else if (spd > DRIVE_SPEED) next = 'DRIVING';
      else if (stillSince && now - stillSince > BEER_AFTER_MS) next = 'BEER';
      break;
    case 'DRIVING':
      if (airborne) next = 'FLYING';
      else if (slowSince && now - slowSince > STOP_MS) next = 'WALKING';
      break;
    case 'BEER':
      if (airborne) next = 'FLYING';
      else if (spd > DRIVE_SPEED) next = 'DRIVING';
      else if (spd > WALK_SPEED) next = 'WALKING';
      break;
    case 'HITCHHIKING':                              // got picked up
      if (spd > DRIVE_SPEED) next = 'HITCH_CAR';
      break;
    case 'HITCH_CAR':
      if (airborne) next = 'FLYING';
      else if (slowSince && now - slowSince > STOP_MS) next = 'HITCHHIKING';
      break;
  }
  if (next !== cur) setState(next);
}

// Render the four-state + grounded selector into #state-selector.
export function renderSelector() {
  const host = document.getElementById('state-selector');
  if (!host) return;
  // While flying you can't manually change state — you're in the air. The auto
  // machine releases the lock once you've landed.
  const locked = current === 'FLYING';
  host.classList.toggle('is-locked', locked);
  host.innerHTML = STATE_ORDER.map((id) => {
    const s = STATES[id];
    const on = id === current ? ' is-on' : '';
    const badge = (id === 'RETRIEVE' && seats > 0) ? `<span class="seat-pill">${seats}</span>` : '';
    return `<button class="state-btn${on}" data-state="${id}" title="${s.label}" ${locked ? 'disabled' : ''}>
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
