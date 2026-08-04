// orbits.js — the Explore screen: a lightweight, no-WebGL orrery (nested rotating
// divs, no bundler) plus a full-screen "planet card" for each body with a cheap,
// seamless spinning-globe effect and spoken name + fact.
//
// Positions are REAL, not decorative: each planet's angle comes from its actual
// heliocentric ecliptic longitude on the selected date (astro.js, via the vendored
// astronomy-engine). A date picker jumps to any date; Play advances that date over
// time instead of looping a fixed animation, so the whole thing is a real (if
// distance/size-compressed — see catalog.js) picture of the solar system.
//
// Rotation trick (unchanged from the original build): .orbit-spin rotates the whole
// ring by the planet's angle; .orbit-counter sits at the ring's edge and rotates the
// OPPOSITE way around its own (small) center — canceling only the inherited
// orientation, not the translation, so the planet stays upright while still tracing
// the circle. Rotating a full-ring-sized element the opposite way instead would
// cancel the translation too (net identity, planet frozen in place) — see CLAUDE.md.
//
// Spin trick (planet card): the texture div is drawn at 200% width with
// background-size 50% 100% (so each tile is exactly one frame-width), then
// translateX(-50%) loops back to an identical frame — a seamless scroll with no
// baked-in image width needed.

import { SUN, MOON, PLANETS } from './catalog.js';
import { planetLongitudes, moonPhase } from './astro.js';
import { drawMoonPhase } from './moonphase.js';
import { say } from './speech.js';
import { spot, isSpotted, isBadgeBody, onChange } from './badges.js';

const NAV_ORDER = [SUN, ...PLANETS.slice(0, 3), MOON, ...PLANETS.slice(3)]; // Sun, Mercury, Venus, Earth, Moon, Mars..Neptune
const DAYS_PER_SEC = 6; // simulated days advanced per real second while playing
const ZOOM_MIN = 0.6, ZOOM_MAX = 2.8, ZOOM_STEP = 0.25;

// Year scrubber: the slider's value is an offset in years from whenever the app
// was opened, which keeps the mapping to a date trivially invertible (no
// calendar-month arithmetic) and smooth to drag. step 0.01yr ≈ 3.7 days, fine
// enough that even Mercury glides rather than jumping.
const YEAR_MS = 365.25 * 86400000;
const YEAR_SPAN = 50; // scrubbable range, ± this many years around today
const BASE_MS = Date.now();
const dateFromYearOffset = (off) => new Date(BASE_MS + off * YEAR_MS);
const yearOffsetFromDate = (d) => (d.getTime() - BASE_MS) / YEAR_MS;

const rings = new Map(); // id -> { spin, counter }
let currentDate = new Date();
let lastShownYear = null;
let scrubbing = false;
let playing = false;
let rafId = null;
let lastFrameTime = 0;
let fitScale = 1;
let zoom = 1;

const MOON_SPIN_DEG_PER_SEC = 9; // slow cosmetic turn — see moonphase.js
let moonSpinRaf = null;
let moonSpinDeg = 0;

export function initExplore() {
  const orrery = document.getElementById('orrery');
  orrery.innerHTML = '';
  rings.clear();

  const sunBtn = makeBodyButton(SUN, SUN.sizePx);
  sunBtn.classList.add('sun-btn');
  orrery.appendChild(sunBtn);

  for (const planet of PLANETS) {
    const ring = document.createElement('div');
    ring.className = 'orbit-ring';
    ring.style.width = ring.style.height = `${planet.orbitPx * 2}px`;

    const spin = document.createElement('div');
    spin.className = 'orbit-spin';

    const counter = document.createElement('div');
    counter.className = 'orbit-counter';

    const btn = makeBodyButton(planet, planet.sizePx);
    if (planet.id === 'earth') {
      const moonDot = document.createElement('span');
      moonDot.className = 'mini-moon';
      moonDot.style.setProperty('--dot-light', MOON.light);
      moonDot.style.setProperty('--dot-dark', MOON.dark);
      moonDot.setAttribute('aria-hidden', 'true');
      btn.appendChild(moonDot);
    }

    counter.appendChild(btn);
    spin.appendChild(counter);
    ring.appendChild(spin);
    orrery.appendChild(ring);
    rings.set(planet.id, { spin, counter });
  }

  document.querySelectorAll('.body-btn').forEach((btn) => {
    btn.addEventListener('click', () => openCard(btn.dataset.id));
  });
  refreshSpottedOutlines();
  onChange(refreshSpottedOutlines);

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
  wirePinchZoom();
  computeFit();
  window.addEventListener('resize', computeFit);

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

  zoomInBtn.addEventListener('click', () => setZoom(zoom + ZOOM_STEP));
  zoomOutBtn.addEventListener('click', () => setZoom(zoom - ZOOM_STEP));

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

// "Clean view": hide every control — topbar, nav, scrubber, buttons, numbers —
// and leave the scene (starfield, nebulae, orbit lines, Sun, planets) exactly
// as it is. Starts playback too: the point is watching the planets go round.
let cleanExitHandler = null;

function enterCleanView() {
  document.body.classList.add('clean-view');
  document.getElementById('clean-btn').setAttribute('aria-pressed', 'true');
  if (!playing) play();

  const hint = document.getElementById('clean-hint');
  hint.classList.add('show');
  setTimeout(() => hint.classList.remove('show'), 2600);

  // Attached on the NEXT tick, otherwise the very click that turned clean view
  // on would immediately bubble up to this listener and turn it straight back
  // off. Any tap exits — .body-btn is pointer-events:none while clean (see
  // app.css), so tapping a planet exits rather than opening a card whose close
  // button is itself hidden.
  cleanExitHandler = () => exitCleanView();
  setTimeout(() => document.addEventListener('pointerdown', cleanExitHandler, { once: true }), 0);
}

function exitCleanView() {
  document.body.classList.remove('clean-view');
  document.getElementById('clean-btn').setAttribute('aria-pressed', 'false');
  document.getElementById('clean-hint').classList.remove('show');
  if (cleanExitHandler) {
    document.removeEventListener('pointerdown', cleanExitHandler);
    cleanExitHandler = null;
  }
}

function wirePinchZoom() {
  const screen = document.getElementById('explore-screen');
  const pointers = new Map();
  let startDist = 0, startZoom = 1;
  const dist = () => {
    const pts = [...pointers.values()];
    return Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
  };
  screen.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) { startDist = dist(); startZoom = zoom; }
  });
  screen.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && startDist > 0) setZoom(startZoom * (dist() / startDist));
  });
  const release = (e) => { pointers.delete(e.pointerId); if (pointers.size < 2) startDist = 0; };
  screen.addEventListener('pointerup', release);
  screen.addEventListener('pointercancel', release);
}

function setZoom(z) {
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
  applyScale();
}

function applyScale() {
  document.getElementById('orrery').style.transform = `scale(${fitScale * zoom})`;
}

// Safety net for small phones: the orrery is laid out at a fixed pixel radius
// (catalog.js) sized for a typical phone; scale the whole thing down further if
// the screen is smaller than that (e.g. iPhone SE) so nothing clips off-screen.
// The user's own zoom (applyScale) multiplies on top of this base fit.
function computeFit() {
  const screen = document.getElementById('explore-screen');
  const outer = PLANETS[PLANETS.length - 1];
  const needed = (outer.orbitPx + outer.sizePx / 2) * 2 + 16;
  const available = Math.min(screen.clientWidth, screen.clientHeight);
  fitScale = Math.min(1, available / needed);
  applyScale();
}

function applyDate(date) {
  currentDate = date;
  document.getElementById('date-input').value = currentDate.toISOString().slice(0, 10);
  syncYearScrubber();
  const longitudes = planetLongitudes(currentDate);
  for (const { id, lon } of longitudes) {
    const r = rings.get(id);
    if (!r) continue;
    const angle = -lon; // CSS rotate() is clockwise; negate so longitude increases prograde (CCW)
    r.spin.style.transform = `rotate(${angle}deg)`;
    // translate(-50%, -50%) — not (-50%, 0) — puts the COUNTER'S OWN CENTER at the
    // ring's top point (its anchor is top:0/left:50%, i.e. its top-left corner is
    // pinned there before any translate). With only -50% horizontal, the box's
    // *center* actually ends up half the box's height BELOW the ring line, so the
    // planet reads as merely touching the ring instead of riding on it.
    r.counter.style.transform = `translate(-50%, -50%) rotate(${-angle}deg)`;
  }
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
  document.getElementById('orrery').classList.add('playing');
  document.getElementById('play-btn').innerHTML = '<i class="ph-fill ph-pause"></i>';
  document.getElementById('play-btn').setAttribute('aria-label', 'Pause');
  lastFrameTime = performance.now();
  rafId = requestAnimationFrame(tick);
}

function pause() {
  playing = false;
  document.getElementById('orrery').classList.remove('playing');
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

// The orrery's own body is a flat two-tone gradient sphere (the exact Nocturne
// design recipe: radial-gradient highlight at 33%/28% into a light tone then a
// dark tone, plus a soft glow) — NOT the photo texture. At 14-46px, a small JPG
// texture reads as a blurry smudge; the flat gradient reads as a crisp glowing
// "candy" sphere, which is what the design actually specifies and what looks
// right at this size. The bigger detail card (renderCard(), ~100px) keeps the
// real photo texture/self-rotation/sphere-shading — that's a different scale
// and context where the real rendering already looks good.
function makeBodyButton(body, sizePx) {
  const btn = document.createElement('button');
  btn.className = 'body-btn';
  btn.dataset.id = body.id;
  btn.style.width = btn.style.height = `${sizePx}px`;
  btn.style.setProperty('--size-px', `${sizePx}px`);
  btn.setAttribute('aria-label', body.name);

  const dot = document.createElement('span');
  dot.className = body.id === 'sun' ? 'body-dot sun-dot' : 'body-dot';
  if (body.id !== 'sun') {
    dot.style.setProperty('--dot-light', body.light);
    dot.style.setProperty('--dot-dark', body.dark);
    dot.style.setProperty('--dot-glow', `${Math.round(sizePx * 0.9)}px`);
  }
  btn.appendChild(dot);

  if (body.ring) {
    const ring = document.createElement('span');
    ring.className = 'body-ring';
    const w = sizePx * 2.3, h = sizePx * 0.7;
    ring.style.width = `${w}px`;
    ring.style.height = `${h}px`;
    ring.style.marginLeft = `${-w / 2}px`;
    ring.style.marginTop = `${-h / 2}px`;
    btn.appendChild(ring);
  }
  return btn;
}

let cardIndex = 0;

function openCard(id) {
  const idx = NAV_ORDER.findIndex((b) => b.id === id);
  cardIndex = idx >= 0 ? idx : 0;
  renderCard();
  document.getElementById('planet-card').classList.remove('hidden');
}

function closeCard() {
  document.getElementById('planet-card').classList.add('hidden');
  stopMoonSpin();
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
  document.getElementById('card-ring-back').classList.toggle('hidden', !body.ring);
  document.getElementById('card-ring-front').classList.toggle('hidden', !body.ring);
  updateSpotButton(body);
  say(body.name, body.fact, body.safety);
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

// A subtle accent outline directly on the orrery's already-spotted bodies —
// so a kid can see their progress at a glance without opening every card.
// The Moon has no orrery button of its own (only the mini-moon dot on Earth,
// not a real target), so it's skipped here — Sky mode's own marker covers it.
function refreshSpottedOutlines() {
  for (const body of [SUN, ...PLANETS]) {
    const btn = document.querySelector(`.body-btn[data-id="${body.id}"]`);
    if (btn) btn.classList.toggle('spotted', isSpotted(body.id));
  }
}
