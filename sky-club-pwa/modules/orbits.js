// orbits.js — the Explore screen's controls (date, play, year scrubber, zoom,
// clean view, 3-D view options) and the detail card for each body. The solar
// system itself is drawn by orrery3d.js; the card's hero by cardglobe.js (or
// moonphase.js for the Moon).
//
// Positions are REAL, not decorative: every planet is where the ephemeris puts
// it on the selected date. A date picker jumps to any date; Play advances that
// date over time instead of looping a fixed animation.

import { SUN, MOON, PLANETS } from './catalog.js?v=23';
import { moonPhase, moonDistanceKm } from './astro.js?v=23';
import { drawMoonPhase, describePhase } from './moonphase.js?v=23';
import { say } from './speech.js?v=23';
import { spot, isSpotted, isBadgeBody } from './badges.js?v=23';
import { initOrrery, setOrreryDate, zoomOrrery, cycleView, toggleTrueScale, setAutoRotate } from './orrery3d.js?v=23';
import { startCardGlobe, stopCardGlobe } from './cardglobe.js?v=23';

const NAV_ORDER = [SUN, ...PLANETS.slice(0, 3), MOON, ...PLANETS.slice(3)]; // Sun, Mercury, Venus, Earth, Moon, Mars..Neptune
const DAYS_PER_SEC = 6; // simulated days advanced per real second while playing
const ZOOM_STEP = 0.25;

// Year scrubber: the slider's value is an offset in years from whenever the app
// was opened, which keeps the mapping to a date trivially invertible (no
// calendar-month arithmetic) and smooth to drag. step 0.01yr ≈ 3.7 days, fine
// enough that even Mercury glides rather than jumping.
const YEAR_MS = 365.25 * 86400000;
const YEAR_SPAN = 50; // scrubbable range, ± this many years around today
const BASE_MS = Date.now();
const dateFromYearOffset = (off) => new Date(BASE_MS + off * YEAR_MS);
const yearOffsetFromDate = (d) => (d.getTime() - BASE_MS) / YEAR_MS;

let currentDate = new Date();
let lastShownYear = null;
let scrubbing = false;
let playing = false;
let rafId = null;
let lastFrameTime = 0;

const MOON_SPIN_DEG_PER_SEC = 9; // slow cosmetic turn — see moonphase.js
let moonSpinRaf = null;
let moonSpinDeg = 0;

export function initExplore() {
  initOrrery(document.getElementById('orrery-canvas'), (id) => openCard(id));

  document.getElementById('card-close').addEventListener('click', closeCard);
  document.getElementById('card-prev').addEventListener('click', () => stepCard(-1));
  document.getElementById('card-next').addEventListener('click', () => stepCard(1));
  document.getElementById('card-spot').addEventListener('click', () => {
    const body = NAV_ORDER[cardIndex];
    spot(body.id);
    updateSpotButton(body);
  });
  document.getElementById('planet-card').addEventListener('click', (e) => {
    if (e.target.id === 'planet-card') closeCard();
  });

  wireControls();

  applyDate(currentDate);
  play();
}

function wireControls() {
  const playBtn = document.getElementById('play-btn');
  const dateInput = document.getElementById('date-input');
  const todayBtn = document.getElementById('today-btn');
  const zoomInBtn = document.getElementById('zoom-in-btn');
  const zoomOutBtn = document.getElementById('zoom-out-btn');
  const yearSlider = document.getElementById('year-slider');
  const cleanBtn = document.getElementById('clean-btn');

  playBtn.addEventListener('click', () => (playing ? pause() : play()));

  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    pause();
    applyDate(new Date(`${dateInput.value}T12:00:00`));
  });

  todayBtn.addEventListener('click', () => applyDate(new Date()));

  zoomInBtn.addEventListener('click', () => zoomOrrery(ZOOM_STEP));
  zoomOutBtn.addEventListener('click', () => zoomOrrery(-ZOOM_STEP));

  // 3-D options: cycle the camera (Tilted → Top → Side), and switch between the
  // compressed layout and TRUE distances.
  const viewBtn = document.getElementById('view-btn');
  const scaleBtn = document.getElementById('scale-btn');
  viewBtn.addEventListener('click', () => flashViewLabel(`${cycleView()} view`));
  scaleBtn.addEventListener('click', () => {
    const on = toggleTrueScale();
    scaleBtn.setAttribute('aria-pressed', String(on));
    flashViewLabel(on ? 'Real distances' : 'Squeezed to fit');
    say(on ? 'These are the real distances — space is really, really big!' : 'Squeezed together so they all fit.');
  });

  yearSlider.min = String(-YEAR_SPAN);
  yearSlider.max = String(YEAR_SPAN);
  yearSlider.step = '0.01';
  yearSlider.value = '0';
  // `input` (not `change`) so the planets track the thumb live as it's dragged.
  // Playback pauses on grab: otherwise the rAF tick would keep rewriting the
  // date underneath the drag and the thumb would fight the user.
  yearSlider.addEventListener('pointerdown', () => { scrubbing = true; pause(); });
  yearSlider.addEventListener('input', () => {
    scrubbing = true;
    pause();
    applyDate(dateFromYearOffset(parseFloat(yearSlider.value)));
  });
  const endScrub = () => { scrubbing = false; };
  yearSlider.addEventListener('pointerup', endScrub);
  yearSlider.addEventListener('pointercancel', endScrub);
  yearSlider.addEventListener('blur', endScrub);

  cleanBtn.addEventListener('click', enterCleanView);
}

let flashTimer = null;
function flashViewLabel(text) {
  const el = document.getElementById('view-flash');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => el.classList.remove('show'), 1400);
}

// "Clean view": hide every control — topbar, nav, scrubber, buttons, numbers —
// and leave the scene (starfield, nebulae, orbit lines, Sun, planets) exactly
// as it is. Starts playback too: the point is watching the planets go round.
let cleanExitHandler = null;

function enterCleanView() {
  document.body.classList.add('clean-view');
  document.getElementById('clean-btn').setAttribute('aria-pressed', 'true');
  if (!playing) play();
  setAutoRotate(true); // a slow turn of the camera — the point is to sit back and watch

  const hint = document.getElementById('clean-hint');
  hint.classList.add('show');
  setTimeout(() => hint.classList.remove('show'), 2600);

  // Attached on the NEXT tick, otherwise the very click that turned clean view
  // on would immediately bubble up to this listener and turn it straight back
  // off. Any tap exits — the orrery ignores taps while clean (orrery3d.js), so
  // tapping a planet exits rather than opening a card whose close button is
  // itself hidden.
  cleanExitHandler = () => exitCleanView();
  setTimeout(() => document.addEventListener('pointerdown', cleanExitHandler, { once: true }), 0);
}

function exitCleanView() {
  document.body.classList.remove('clean-view');
  document.getElementById('clean-btn').setAttribute('aria-pressed', 'false');
  document.getElementById('clean-hint').classList.remove('show');
  setAutoRotate(false);
  if (cleanExitHandler) {
    document.removeEventListener('pointerdown', cleanExitHandler);
    cleanExitHandler = null;
  }
}

function applyDate(date) {
  currentDate = date;
  document.getElementById('date-input').value = currentDate.toISOString().slice(0, 10);
  syncYearScrubber();
  setOrreryDate(currentDate);
}

// Keeps the scrubber showing the date that's actually being displayed, whether
// that came from Play advancing time, the Today button, or the date picker.
// Skipped while the user is dragging the thumb — writing .value mid-drag makes
// it stutter and can fight the gesture. applyDate() runs every frame during
// playback, so the year text is only touched when the year genuinely changes.
function syncYearScrubber() {
  const slider = document.getElementById('year-slider');
  const label = document.getElementById('year-label');
  if (!slider || !label) return;
  // Only the thumb POSITION is off-limits mid-drag (writing .value while the
  // user is dragging makes it stutter and fight the gesture). The year readout
  // must keep updating — that's the whole point of dragging it.
  if (!scrubbing) slider.value = String(yearOffsetFromDate(currentDate));
  const year = currentDate.getFullYear();
  if (year !== lastShownYear) {
    label.textContent = String(year);
    lastShownYear = year;
  }
}

function play() {
  if (playing) return;
  playing = true;
  document.getElementById('play-btn').innerHTML = '<i class="ph-fill ph-pause"></i>';
  document.getElementById('play-btn').setAttribute('aria-label', 'Pause');
  lastFrameTime = performance.now();
  rafId = requestAnimationFrame(tick);
}

function pause() {
  playing = false;
  document.getElementById('play-btn').innerHTML = '<i class="ph-fill ph-play"></i>';
  document.getElementById('play-btn').setAttribute('aria-label', 'Play');
  if (rafId) cancelAnimationFrame(rafId);
}

function tick(now) {
  if (!playing) return;
  const dtSeconds = (now - lastFrameTime) / 1000;
  lastFrameTime = now;
  applyDate(new Date(currentDate.getTime() + dtSeconds * DAYS_PER_SEC * 86400000));
  rafId = requestAnimationFrame(tick);
}

// Redraws the Moon's phase canvas every frame with a slowly advancing rotation
// offset — the phase OUTLINE stays exactly correct for the date (see
// moonphase.js), only the surface drifting underneath it is cosmetic. Runs only
// while the Moon's card is open (started/stopped from renderCard/closeCard).
function startMoonSpin(canvas, phaseDeg) {
  let last = performance.now();
  const frame = (now) => {
    const dt = (now - last) / 1000;
    last = now;
    moonSpinDeg = (moonSpinDeg + dt * MOON_SPIN_DEG_PER_SEC) % 360;
    drawMoonPhase(canvas, phaseDeg, moonSpinDeg);
    moonSpinRaf = requestAnimationFrame(frame);
  };
  moonSpinRaf = requestAnimationFrame(frame);
}

function stopMoonSpin() {
  if (moonSpinRaf) cancelAnimationFrame(moonSpinRaf);
  moonSpinRaf = null;
}

let cardIndex = 0;

// Exported so the Sky screen can open the same sheet when you tap a body up
// there — the card DOM lives here, and one detail sheet beats two.
export function openCard(id) {
  const idx = NAV_ORDER.findIndex((b) => b.id === id);
  cardIndex = idx >= 0 ? idx : 0;
  document.getElementById('planet-card').classList.remove('is-star');
  renderCard();
  document.getElementById('planet-card').classList.remove('hidden');
}

const STAR_COLOR_NAMES = {
  '#ffcf8a': 'Golden', '#fff3c9': 'Warm white', '#ff8f6b': 'Orange-red',
  '#ffb37a': 'Orange', '#ff6b5b': 'Deep red', '#ffab8a': 'Soft orange',
  '#ffb98a': 'Peach',
};

// Brightness as a word rather than a magnitude: the number is meaningless to a
// pre-reader, and it is backwards (smaller = brighter) to everyone else.
function brightnessWord(mag) {
  if (mag <= 0.5) return 'Very bright';
  if (mag <= 1.5) return 'Bright';
  if (mag <= 2.5) return 'Medium';
  return 'Faint';
}

/** Opens the detail sheet for a star. `constellationName` may be null. */
export function openStarCard(star, constellationName) {
  const card = document.getElementById('planet-card');
  card.classList.add('is-star');
  card.classList.remove('is-earth', 'is-sun', 'is-globe');
  stopMoonSpin();
  stopCardGlobe();

  const tint = star.color || '#eef4ff';
  document.getElementById('card-star').style.setProperty('--star-tint', tint);
  document.getElementById('moon-phase-canvas').classList.add('hidden');
  document.getElementById('card-ring-back').classList.add('hidden');
  document.getElementById('card-ring-front').classList.add('hidden');

  const chip = document.getElementById('card-phase');
  if (constellationName) {
    chip.textContent = `in ${constellationName}`;
    chip.classList.remove('hidden');
  } else {
    chip.classList.add('hidden');
  }

  document.getElementById('card-name').textContent = star.name;
  document.getElementById('card-fact').textContent =
    star.fact || 'A star in our night sky, shining from far, far away.';
  document.getElementById('card-safety').classList.add('hidden');

  const stats = [
    ['Brightness', brightnessWord(star.mag)],
    // Sky mode passes a real colour name from the star's B−V index.
    ['Colour', star.colorName || STAR_COLOR_NAMES[tint.toLowerCase()] || 'Blue-white'],
  ];
  // Only the stars with a real catalogued distance get the row.
  if (typeof star.distanceLy === 'number') {
    stats.push(['Distance', `${star.distanceLy.toLocaleString('en-US')} light-years`]);
  }
  fillStats(stats);

  card.classList.remove('hidden');
  say(star.name, star.fact);
}

function closeCard() {
  document.getElementById('planet-card').classList.add('hidden');
  stopMoonSpin();
  stopCardGlobe();
}

function stepCard(dir) {
  cardIndex = (cardIndex + dir + NAV_ORDER.length) % NAV_ORDER.length;
  renderCard();
}

function renderCard() {
  const body = NAV_ORDER[cardIndex];
  const isMoon = body.id === 'moon';
  const isSun = body.id === 'sun';

  document.getElementById('planet-card').classList.toggle('is-earth', body.id === 'earth');
  document.getElementById('planet-card').classList.toggle('is-sun', isSun);
  // Planets and the Sun get the real rendered globe; the Moon keeps its phase canvas.
  document.getElementById('planet-card').classList.toggle('is-globe', !isMoon);

  const texture = document.getElementById('spin-texture');
  texture.style.backgroundImage = `url(${body.texture})`;
  // The Moon gets the phase graphic below instead of this generic scroll — it
  // needs a real terminator shape, not a flat rotating disc.
  texture.style.animationPlayState = isMoon ? 'paused' : 'running';

  const moonCanvas = document.getElementById('moon-phase-canvas');
  moonCanvas.classList.toggle('hidden', !isMoon);
  stopMoonSpin();
  if (isMoon) {
    const box = moonCanvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    moonCanvas.width = Math.max(1, Math.round(box.width * dpr));
    moonCanvas.height = Math.max(1, Math.round(box.height * dpr));
    startMoonSpin(moonCanvas, moonPhase(currentDate));
  }

  // A fixed "studio light from the left" terminator, like the reference photo's
  // Sun-from-the-left lighting — there's no orbital context in this close-up
  // view to compute a real one from. Skipped for the Sun (self-luminous) and the
  // Moon (its own phase graphic already carries the shading).
  document.getElementById('card-shade').classList.toggle('hidden', isSun || isMoon);

  document.getElementById('card-name').textContent = `${body.emoji} ${body.name}`;
  document.getElementById('card-fact').textContent = body.fact;
  const safetyEl = document.getElementById('card-safety');
  if (body.safety) {
    safetyEl.textContent = `⚠️ ${body.safety}`;
    safetyEl.classList.remove('hidden');
  } else {
    safetyEl.classList.add('hidden');
  }
  document.getElementById('card-ring-back').classList.add('hidden');
  document.getElementById('card-ring-front').classList.add('hidden');
  stopCardGlobe();
  if (!isMoon) {
    // After layout, so the wrap has its real size (the card may have just unhidden).
    requestAnimationFrame(() => startCardGlobe(body.id, document.querySelector('.spin-wrap')));
  }
  renderPhaseChip(body, isMoon);
  renderStats(body, isMoon);
  updateSpotButton(body);
  say(body.name, body.fact, body.safety);
}

// Only the Moon carries a caption, because only the Moon visibly changes shape.
function renderPhaseChip(body, isMoon) {
  const chip = document.getElementById('card-phase');
  if (!isMoon) { chip.classList.add('hidden'); return; }
  const { name, lit } = describePhase(moonPhase(currentDate));
  chip.textContent = `${name} · ${lit}% lit`;
  chip.classList.remove('hidden');
}

// Every value here is real: the Moon's are computed live from the ephemeris for
// the selected date, the rest are stable physical facts from catalog.js. Nothing
// is invented to fill the row — a body with no facts simply shows none.
function fillStats(stats) {
  const el = document.getElementById('card-stats');
  el.innerHTML = '';
  for (const [key, val] of stats) {
    const cell = document.createElement('div');
    cell.className = 'card-stat';
    const k = document.createElement('div');
    k.className = 'card-stat-key';
    k.textContent = key;
    const v = document.createElement('div');
    v.className = 'card-stat-val';
    v.textContent = val;
    cell.appendChild(k);
    cell.appendChild(v);
    el.appendChild(cell);
  }
}

function renderStats(body, isMoon) {
  const stats = [];
  if (isMoon) {
    // No "lit" cell — the phase chip above the sheet already says it, and this
    // is a real distance that genuinely changes night to night.
    // Two cells, not three: the distance is a seven-digit number and a third
    // column truncates it at phone width.
    stats.push(['Distance', `${Math.round(moonDistanceKm(currentDate)).toLocaleString('en-US')} km`]);
    if (body.diameter) stats.push(['Across', body.diameter]);
  } else {
    if (body.diameter) stats.push(['Across', body.diameter]);
    if (body.dayLength) stats.push(['One spin', body.dayLength]);
  }
  fillStats(stats);
}

// Sun, Moon and all 8 planets have a badge payoff (see badges.js).
function updateSpotButton(body) {
  const btn = document.getElementById('card-spot');
  const eligible = isBadgeBody(body.id);
  btn.classList.toggle('hidden', !eligible);
  if (!eligible) return;
  const spotted = isSpotted(body.id);
  btn.classList.toggle('spotted', spotted);
  document.getElementById('card-spot-label').textContent = spotted ? 'Got it!' : 'I spotted it';
  document.getElementById('card-spot-icon').className = spotted ? 'ph-fill ph-seal-check' : 'ph-fill ph-star';
}

