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
const STILL_SPEED = 0.8;  // basically not moving
const WALK_SPEED = 1.8;   // below this, on foot
const ROAD_SPEED = 9;     // ~32 km/h — faster than anyone runs
const VARIO = 0.7;        // m/s climb/sink that signals flight
let stationarySince = null;
export function applyAutoState(geo) {
  if (!geo || !AUTO_STATES.includes(current)) return;
  const spd = geo.speed; // m/s, may be null
  if (spd == null || Number.isNaN(spd)) return;
  const vr = Math.abs(geo.vrate ?? 0);

  let next = current;
  if (vr > VARIO && spd < 28) { next = 'FLYING'; stationarySince = null; }
  else if (spd > ROAD_SPEED && vr < 0.6) { next = 'DRIVING'; stationarySince = null; }
  else if (spd >= 4 && spd <= 22 && vr > 0.3) { next = 'FLYING'; stationarySince = null; }
  else if (spd < STILL_SPEED && vr < 0.5) {
    // Parked on the ground. After a while, you're clearly having a beer.
    if (stationarySince == null) stationarySince = Date.now();
    next = (Date.now() - stationarySince > BEER_AFTER_MS) ? 'BEER' : 'WALKING';
  } else if (spd < WALK_SPEED && vr < 0.5) { next = 'WALKING'; stationarySince = null; }
  else stationarySince = null; // hysteresis zone: keep current
  if (next !== current) setState(next);
}

// Render the four-state + grounded selector into #state-selector.
export function renderSelector() {
  const host = document.getElementById('state-selector');
  if (!host) return;
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
