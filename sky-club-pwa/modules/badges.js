// badges.js — a small "spot the planet" collection game: tap a planet in
// Explore's card, or find it for real in Sky mode, to unlock its badge.
// Sun/Moon/stars/constellations stay tappable and informative everywhere but
// don't have a badge card here — there's no payoff to wire up for them, matching
// the redesign mockup's 8-planet badge grid.

import { PLANETS } from './catalog.js';

const STORAGE_KEY = 'skyclub.spotted';
const listeners = new Set();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return new Set(Array.isArray(raw) ? raw : []);
  } catch {
    return new Set();
  }
}

const spotted = load();

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...spotted]));
}

function notify() {
  for (const cb of listeners) cb();
}

/** Marks a body spotted; returns true only the first time (idempotent after). */
export function spot(id) {
  if (spotted.has(id)) return false;
  spotted.add(id);
  save();
  notify();
  return true;
}

export function isSpotted(id) {
  return spotted.has(id);
}

export function getSpottedCount() {
  return PLANETS.filter((p) => spotted.has(p.id)).length;
}

export function onChange(cb) {
  listeners.add(cb);
}

let toastTimer = null;

/** Shows a short confirmation banner in the given element, auto-hiding after ~2.2s. */
export function showToast(el, text) {
  if (!el) return;
  el.textContent = text;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 2200);
}

/** Builds the Badges screen (progress bar + one card per planet) and keeps it,
 * plus the topbar's badge-count chip, in sync with the spotted set. */
export function initBadges() {
  const grid = document.getElementById('badges-grid');
  const fill = document.getElementById('badges-progress-fill');
  const label = document.getElementById('badges-progress-label');
  const chipCount = document.getElementById('badge-chip-count');

  function render() {
    const count = getSpottedCount();
    const total = PLANETS.length;
    const text = `${count}/${total}`;
    fill.style.width = `${(count / total) * 100}%`;
    label.textContent = text;
    if (chipCount) chipCount.textContent = text;

    grid.innerHTML = '';
    for (const p of PLANETS) {
      const unlocked = spotted.has(p.id);
      const card = document.createElement('div');
      card.className = `badge-card ${unlocked ? 'unlocked' : 'locked'}`;

      const dot = document.createElement('div');
      dot.className = 'badge-dot';
      if (unlocked) {
        dot.style.backgroundImage = `url(${p.texture})`;
      } else {
        dot.textContent = '?';
      }

      const name = document.createElement('span');
      name.className = 'badge-name';
      name.textContent = unlocked ? p.name : '???';

      card.appendChild(dot);
      card.appendChild(name);
      grid.appendChild(card);
    }
  }

  render();
  onChange(render);
}
