// robot.js — Zip, the robot guide, and the spaceship on the first screen.
// Both are drawn as SVG illustrations (no emoji, no image files), so they stay
// sharp at any size. Zip sits in the top bar on every screen, waves now and then,
// and says something friendly when tapped. He also hops when you change screen.

import { say } from './speech.js?v=25';
import { playChime } from './sound.js?v=25';

// What Zip says depends on the screen you're on, so he guides the journey.
const LINES = {
  'home-screen': [
    "Hi! I'm Zip, your space guide. Tap Blast off and we'll fly to the planets!",
    'Or tap Look outside, and we can find real stars in the sky.',
  ],
  'explore-screen': [
    'These are the planets, going round the Sun. Tap one to visit it!',
    'Tap the Moon button to see Earth and the Moon up close.',
    'Press play and watch the planets go round!',
  ],
  'sky-screen': [
    'Point the phone up at the sky. What can you find?',
    'Hold still on something bright, and we will catch it!',
    'Every star is a sun, very, very far away.',
  ],
  'discover-screen': [
    'Pick a picture, and I will show you why!',
    'Did you know the Moon makes the sea go in and out?',
  ],
  'lesson-screen': [
    'Tap the speaker, and I will read this page to you.',
    'Try the buttons and the slider. Watch what changes!',
  ],
  'badges-screen': [
    'Find all ten, and you will have the whole set!',
    'Spot a planet in the sky to win its badge.',
  ],
};
const lineIndex = {};
let svgCount = 0;

/** Zip, drawn as an illustration. `cls` adds classes (e.g. "blink" for blinking). */
export function robotSVG(cls = '') {
  // Each copy needs its own gradient ids: with shared ids, a copy whose twin is
  // hidden (display:none) can lose its colours in Safari and Chrome.
  const id = 'zip' + ++svgCount;
  return `
<svg viewBox="0 0 120 150" class="robot-svg ${cls}" aria-hidden="true">
  <defs>
    <linearGradient id="${id}-head" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#f4fffb"/><stop offset="1" stop-color="#9ee8d6"/>
    </linearGradient>
    <linearGradient id="${id}-body" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#9b99f0"/><stop offset="1" stop-color="#5b5ab8"/>
    </linearGradient>
    <radialGradient id="${id}-ball" cx="0.35" cy="0.35" r="0.7">
      <stop offset="0" stop-color="#fff6c8"/><stop offset="1" stop-color="#ffb347"/>
    </radialGradient>
  </defs>
  <!-- antenna -->
  <line x1="60" y1="24" x2="60" y2="8" stroke="#b9c4ff" stroke-width="4" stroke-linecap="round"/>
  <circle cx="60" cy="7" r="6.5" fill="url(#${id}-ball)"/>
  <!-- legs and feet -->
  <rect x="38" y="128" width="16" height="14" rx="7" fill="#5b5ab8"/>
  <rect x="66" y="128" width="16" height="14" rx="7" fill="#5b5ab8"/>
  <ellipse cx="46" cy="144" rx="13" ry="5" fill="#2f2d6b"/>
  <ellipse cx="74" cy="144" rx="13" ry="5" fill="#2f2d6b"/>
  <!-- left arm -->
  <path d="M30 96 Q14 102 16 116" fill="none" stroke="#9ee8d6" stroke-width="10" stroke-linecap="round"/>
  <!-- body -->
  <rect x="28" y="88" width="64" height="44" rx="20" fill="url(#${id}-body)" stroke="#2f2d6b" stroke-width="2"/>
  <circle cx="60" cy="108" r="6.5" fill="#ffd27a"/>
  <circle cx="60" cy="108" r="11" fill="none" stroke="#ffd27a" stroke-opacity="0.35" stroke-width="3"/>
  <!-- right arm: waves -->
  <g class="arm-wave">
    <path d="M90 96 Q106 102 104 116" fill="none" stroke="#9ee8d6" stroke-width="10" stroke-linecap="round"/>
  </g>
  <!-- neck -->
  <rect x="52" y="80" width="16" height="10" fill="#7fd6c5"/>
  <!-- head -->
  <rect x="22" y="24" width="76" height="60" rx="28" fill="url(#${id}-head)" stroke="#2c6e78" stroke-width="2"/>
  <!-- face screen -->
  <rect x="34" y="36" width="52" height="34" rx="15" fill="#1d2344"/>
  <g class="eyes">
    <g class="eye"><circle cx="50" cy="52" r="7" fill="#7ff3e0"/><circle cx="52.5" cy="49.5" r="2.4" fill="#ffffff"/></g>
    <g class="eye"><circle cx="70" cy="52" r="7" fill="#7ff3e0"/><circle cx="72.5" cy="49.5" r="2.4" fill="#ffffff"/></g>
  </g>
  <path d="M52 60 Q60 66 68 60" fill="none" stroke="#7ff3e0" stroke-width="2.6" stroke-linecap="round"/>
  <circle cx="36" cy="62" r="3.6" fill="#ff9fb0" opacity="0.7"/>
  <circle cx="84" cy="62" r="3.6" fill="#ff9fb0" opacity="0.7"/>
</svg>`;
}

/** The spaceship: a rounded rocket with a window, a robot pilot, fins and a flame. */
export function shipSVG() {
  const id = 'ship' + ++svgCount;
  return `
<svg viewBox="0 0 200 230" class="ship-svg" aria-hidden="true">
  <defs>
    <linearGradient id="${id}-hull" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#c9d4ff"/><stop offset="0.5" stop-color="#ffffff"/><stop offset="1" stop-color="#b3bff5"/>
    </linearGradient>
    <linearGradient id="${id}-flame" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff3b0"/><stop offset="0.5" stop-color="#ffb347"/><stop offset="1" stop-color="#ff6b5b" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <!-- flame, behind the nozzle -->
  <path class="ship-flame" d="M84 186 Q100 236 116 186 Z" fill="url(#${id}-flame)"/>
  <path class="ship-flame ship-flame-b" d="M92 186 Q100 214 108 186 Z" fill="#fff8d6" opacity="0.9"/>
  <!-- fins -->
  <path d="M62 140 Q44 150 36 186 L66 176 Z" fill="#ff8a7a" stroke="#8a3b3b" stroke-width="2" stroke-linejoin="round"/>
  <path d="M138 140 Q156 150 164 186 L134 176 Z" fill="#ff8a7a" stroke="#8a3b3b" stroke-width="2" stroke-linejoin="round"/>
  <!-- body -->
  <path d="M100 8 C142 40 152 112 142 172 L58 172 C48 112 58 40 100 8 Z" fill="url(#${id}-hull)" stroke="#39487f" stroke-width="3" stroke-linejoin="round"/>
  <!-- stripe -->
  <path d="M55 150 L145 150 L142 162 L58 162 Z" fill="#5b5ab8"/>
  <!-- nozzle -->
  <rect x="80" y="170" width="40" height="14" rx="7" fill="#39487f"/>
  <!-- window with a little robot pilot -->
  <circle cx="100" cy="92" r="27" fill="#39487f"/>
  <circle cx="100" cy="92" r="23" fill="#1d2344"/>
  <circle cx="92" cy="90" r="5" fill="#7ff3e0"/>
  <circle cx="108" cy="90" r="5" fill="#7ff3e0"/>
  <circle cx="93.5" cy="88.5" r="1.6" fill="#fff"/>
  <circle cx="109.5" cy="88.5" r="1.6" fill="#fff"/>
  <path d="M92 101 Q100 107 108 101" fill="none" stroke="#7ff3e0" stroke-width="2.2" stroke-linecap="round"/>
  <!-- window shine -->
  <path d="M84 76 Q90 68 100 67" fill="none" stroke="#ffffff" stroke-opacity="0.5" stroke-width="3" stroke-linecap="round"/>
  <!-- rivets -->
  <circle cx="72" cy="140" r="2.4" fill="#8f9bd6"/><circle cx="128" cy="140" r="2.4" fill="#8f9bd6"/>
</svg>`;
}

/** Makes Zip hop: a short bounce, a wave, and a little chime. */
export function hopRobot() {
  for (const el of document.querySelectorAll('.robot-mini .robot-svg, .home-robot .robot-svg')) {
    el.classList.remove('hop');
    void el.offsetWidth; // restart the animation
    el.classList.add('hop');
  }
}

function greet() {
  const screen = document.querySelector('.screen.active')?.id || 'home-screen';
  const lines = LINES[screen] || LINES['home-screen'];
  const i = lineIndex[screen] || 0;
  say(lines[i % lines.length]);
  lineIndex[screen] = i + 1;
  playChime();
  hopRobot();
}

/** Puts the ship on the first screen, Zip beside it, and Zip in the top bar. */
export function initRobot() {
  const ship = document.querySelector('.home-rocket');
  if (ship) ship.innerHTML = shipSVG();

  const stage = document.querySelector('.home-rocket-stage');
  if (stage) {
    const pilot = document.createElement('button');
    pilot.className = 'home-robot';
    pilot.setAttribute('aria-label', 'Zip the robot: tap to say hello');
    pilot.innerHTML = robotSVG('blink');
    pilot.addEventListener('click', greet);
    stage.appendChild(pilot);
  }

  const status = document.querySelector('.topbar-status');
  if (status) {
    const btn = document.createElement('button');
    btn.id = 'robot-mini';
    btn.className = 'robot-mini';
    btn.setAttribute('aria-label', 'Zip the robot: tap to hear from me');
    btn.innerHTML = robotSVG('blink');
    btn.addEventListener('click', greet);
    const dot = status.querySelector('.status-dot');
    if (dot) dot.replaceWith(btn); else status.prepend(btn);
  }
}
