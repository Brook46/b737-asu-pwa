// badges.js — a small "spot the sky" collection game: tap a body in Explore's
// card, or find it for real in Sky mode, to unlock its badge. Covers the Sun,
// Moon, and 8 planets (10 total) — stars/constellations stay tappable and
// informative everywhere but don't have a badge card; a 100+ star catalog
// isn't a "collect them all" checklist the way ten solar-system bodies are.

import { SUN, MOON, PLANETS } from './catalog.js';

const BADGE_BODIES = [SUN, ...PLANETS, MOON];
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

export function isBadgeBody(id) {
  return BADGE_BODIES.some((b) => b.id === id);
}

export function getSpottedCount() {
  return BADGE_BODIES.filter((b) => spotted.has(b.id)).length;
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
    const total = BADGE_BODIES.length;
    const text = `${count}/${total}`;
    fill.style.width = `${(count / total) * 100}%`;
    label.textContent = text;
    if (chipCount) chipCount.textContent = text;

    grid.innerHTML = '';
    for (const b of BADGE_BODIES) {
      const unlocked = spotted.has(b.id);
      const card = document.createElement('div');
      card.className = `badge-card ${unlocked ? 'unlocked' : 'locked'}`;

      const dot = document.createElement('div');
      dot.className = 'badge-dot';
      if (unlocked) {
        dot.style.backgroundImage = `url(${b.texture})`;
      } else {
        dot.textContent = '?';
      }

      const name = document.createElement('span');
      name.className = 'badge-name';
      name.textContent = unlocked ? b.name : '???';

      card.appendChild(dot);
      card.appendChild(name);
      grid.appendChild(card);
    }
  }

  render();
  onChange(render);
}
