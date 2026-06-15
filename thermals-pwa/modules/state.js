// state.js — the local pilot's current activity state.
//
// FLYING and WALKING switch automatically from motion (airborne ⇒ flying, on
// the ground ⇒ walking). The vehicle/hitch states are manual: tapping one pins
// it and pauses auto-switching until you tap Flying or On-the-ground again.

import { STATES, STATE_ORDER, AUTO_STATES } from '../config.js';
import { glyphSVG } from './icons.js';

const KEY = 'thermals.state';
let current = STATES[localStorage.getItem(KEY)] ? localStorage.getItem(KEY) : 'WALKING';
const subs = new Set();

export function getState() { return current; }

export function setState(id) {
  if (!STATES[id] || id === current) return;
  current = id;
  localStorage.setItem(KEY, id);
  subs.forEach((fn) => fn(current));
  renderSelector();
}

export function onState(fn) { subs.add(fn); return () => subs.delete(fn); }

// Auto air/ground switching. Only acts when the current state is one of the
// auto-managed states (FLYING/WALKING) — a manually chosen vehicle/hitch state
// is left alone. Hysteresis (the 1.5–3.5 m/s gap) keeps it from flickering.
const FLY_SPEED = 3.5;   // m/s — airborne-ish
const WALK_SPEED = 1.5;  // m/s — clearly on the ground
export function applyAutoState(geo) {
  if (!geo || !AUTO_STATES.includes(current)) return;
  const spd = geo.speed; // m/s, may be null
  if (spd == null || Number.isNaN(spd)) return;
  if (spd > FLY_SPEED) setState('FLYING');
  else if (spd < WALK_SPEED) setState('WALKING');
}

// Render the four-state + grounded selector into #state-selector.
export function renderSelector() {
  const host = document.getElementById('state-selector');
  if (!host) return;
  host.innerHTML = STATE_ORDER.map((id) => {
    const s = STATES[id];
    const on = id === current ? ' is-on' : '';
    return `<button class="state-btn${on}" data-state="${id}" title="${s.label}">
      ${glyphSVG(id, 'currentColor', 24)}<span>${s.label}</span>
    </button>`;
  }).join('');
  host.querySelectorAll('.state-btn').forEach((b) => {
    b.addEventListener('click', () => setState(b.dataset.state));
  });
}
