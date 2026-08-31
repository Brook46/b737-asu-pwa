// sky.js — the Sky screen: point (or drag) to find the real Sun, Moon, planets and
// a handful of bright stars/constellations, using their actual right-now positions.
//
// Rendering is a simple small-angle projection, not a real camera: bodies are placed
// on screen from the angular difference between their azimuth/altitude and the
// phone's current heading/pitch, at a fixed pixel-per-degree scale (FOV_DEG). Bodies
// outside that window but still above the horizon get an edge arrow pointing at them
// — a built-in "turn this way" treasure-hunt mechanic a pre-reader can follow without
// any text.

import { bodyPositions, starPositions, sunAltitude, milkyWayPositions } from './astro.js';
import { SKY_BODIES } from './catalog.js';
import { sensorState, geolocate, primeLocation, requestOrientationPermission, nudge } from './sensors.js';
import { say } from './speech.js';
import { spot, isSpotted, isBadgeBody, onChange, showToast } from './badges.js';
import { openCard, openStarCard } from './orbits.js';
import { nextEventHeadline } from './events.js';

const FOV_DEG = 68; // horizontal degrees visible at once
const RECOMPUTE_MS = 2000;
// Stars and the galactic plane drift at the sidereal rate (~0.0042°/s), which at
// this screen scale is well under a pixel even after 15s — no reason to redo
// ~460 Horizon() calls every 2s alongside the (much cheaper, 9-body) planet pass.
const SLOW_RECOMPUTE_MS = 15000;
const DARK_ALT_THRESHOLD = -4; // sun below this altitude ⇒ dark enough for stars
const NAMED_STAR_MAG = 1.5;    // stars this bright or brighter show their name always
const FLARE_STAR_MAG = 0.2;    // the handful of hero-bright stars get a lens-flare sparkle
const DEFAULT_STAR_COLOR = '#eef4ff';
// "Point and hold" catching: the reticle sits at a fixed screen fraction (not
// dead center — see .reticle in app.css), and if a real body/star stays under
// it for LOCK_MS it's caught automatically, same as a tap — friendlier than
// tapping a tiny moving target one-handed while aiming a phone.
const RETICLE_X_FRAC = 0.5, RETICLE_Y_FRAC = 0.44;
const LOCK_RADIUS_PX = 42;
const LOCK_MS = 1600;
const LOCK_COOLDOWN_MS = 4000; // don't re-trigger the same catch every frame while still held

let stars = [];
let constellations = [];
let started = false;
let lastCalc = 0;
let lastSlowCalc = 0;
let currentBodies = [];
let currentStars = [];
let currentMilkyWay = [];
let isDark = false;
let milkyWayCtx = null;
let milkyWayDirty = true;          // redraw needed (positions/size changed)
let lastDrawHeading = null, lastDrawPitch = null;
let lockId = null;
let lockNamedEl = null;            // marker currently having its name revealed by the reticle
let lockStart = 0;
// Cached once instead of re-queried inside the every-frame loop below.
let viewEl = null, reticleEl = null, reticleDotEl = null;
const lastAutoCatch = new Map(); // id -> timestamp of last dwell-triggered catch
const markerEls = new Map();     // id -> marker button
const entityById = new Map();    // id -> the body/star object (for facts, emoji, badge id)
const arrowEls = new Map();      // id -> arrow div
const lineEls = [];              // { el, aId, bId }
const conLabelEls = new Map();   // constellation id -> label button
const conStarIds = new Map();    // constellation id -> unique star ids in its lines

export async function initSky() {
  document.getElementById('sky-start').addEventListener('click', startSky);
  wireDrag();
  onChange(refreshSpottedOutlines);

  try {
    const res = await fetch('data/stars.json');
    const data = await res.json();
    stars = data.stars.map((s) => ({ ...s, kind: 'star' }));
    constellations = data.constellations;
  } catch {
    stars = [];
    constellations = [];
  }
}

// Keeps the accent outline on already-spotted markers (Sun/Moon/planets) in
// sync with badges.js — both on first build and whenever a spot happens
// elsewhere (e.g. the Explore card) while this screen's markers already exist.
function refreshSpottedOutlines() {
  for (const id of Object.keys(SKY_BODIES)) {
    const el = markerEls.get(id);
    if (el) el.classList.toggle('spotted', isSpotted(id));
  }
}

// Always gets into the sky view — geolocate() itself never throws anymore
// (see sensors.js): a real fix is used when available, otherwise an approximate
// default location so a denied/unavailable permission is never a dead end with
// no in-app way forward. requestOrientationPermission() has to be the first
// thing called, synchronously, so it's still inside the tap.
function startSky() {
  const startBtn = document.getElementById('sky-start');

  // Must be the first thing called, synchronously, or iOS drops the user-gesture
  // context and silently refuses the orientation permission.
  const orientPromise = requestOrientationPermission();

  // Show the sky NOW. This used to `await geolocate()` first, which meant a slow
  // indoor GPS fix (8s timeout, one retry, another 8s — previously 15s each)
  // left the user staring at "Finding you… hold on a moment" for up to half a
  // minute before a single star appeared. primeLocation() synchronously supplies
  // the last real fix (or the default), so stars render on the very next frame
  // and geolocate() just refines them below.
  primeLocation();
  document.getElementById('sky-gate').classList.add('hidden');
  document.getElementById('sky-view').classList.remove('hidden');

  if (!started) {
    buildMarkers();
    sizeMilkyWayCanvas();
    window.addEventListener('resize', sizeMilkyWayCanvas);
    started = true;
    requestAnimationFrame(loop);
    showNextEvent();
  }

  orientPromise.catch(() => {});
  refineLocation(startBtn);
}

// Real fix in the background; when it lands, force an immediate recompute so
// the sky snaps to the true positions instead of waiting out the normal beat.
async function refineLocation(startBtn) {
  const before = { lat: sensorState.lat, lon: sensorState.lon };
  await geolocate();
  const moved = Math.abs(sensorState.lat - before.lat) > 0.01 || Math.abs(sensorState.lon - before.lon) > 0.01;
  if (moved) {
    const now = new Date();
    recompute(now, true);
    lastCalc = now;
    lastSlowCalc = now;
    milkyWayDirty = true;
    showNextEvent();
  }
  if (startBtn) startBtn.disabled = false;
}

// A real "what's coming up" line (next full moon / visible eclipse / close
// pairing — see events.js) under the screen title. The searches involved
// (especially the day-by-day conjunction scan) are cheap but non-zero, and
// nothing here needs to block the transition into the sky view.
function showNextEvent() {
  setTimeout(() => {
    const el = document.getElementById('sky-event-note');
    if (!el) return;
    try {
      const headline = nextEventHeadline(new Date(), sensorState.lat, sensorState.lon);
      if (headline) {
        el.textContent = headline;
        el.classList.remove('hidden');
      }
    } catch {
      // a search failing shouldn't be visible — this note is a nice-to-have, not core functionality
    }
  }, 0);
}

function sizeMilkyWayCanvas() {
  const canvas = document.getElementById('milky-way');
  if (!canvas) return;
  milkyWayCtx = canvas.getContext('2d');
  // Deliberately DPR 1, not the usual min(devicePixelRatio, 2). This canvas is
  // full-screen and redrawn as you pan, so at DPR 2 every frame re-uploads a
  // ~1.2-megapixel texture to the GPU — expensive on an iPad, and completely
  // wasted on what is a field of soft, blurry, low-contrast dots with no fine
  // detail to preserve.
  const w = canvas.clientWidth, h = canvas.clientHeight;
  canvas.width = Math.max(1, Math.round(w));
  canvas.height = Math.max(1, Math.round(h));
  milkyWayCtx.setTransform(1, 0, 0, 1, 0, 0);
  milkyWayDirty = true;
}

function buildMarkers() {
  const markers = document.getElementById('sky-markers');
  const arrows = document.getElementById('sky-arrows');
  const svg = document.getElementById('const-lines');
  const labels = document.getElementById('const-labels');
  markers.innerHTML = '';
  arrows.innerHTML = '';
  svg.innerHTML = '';
  labels.innerHTML = '';
  markerEls.clear();
  entityById.clear();
  arrowEls.clear();
  lineEls.length = 0;
  conLabelEls.clear();
  conStarIds.clear();

  for (const id of Object.keys(SKY_BODIES)) {
    const body = SKY_BODIES[id];
    markerEls.set(id, makeMarker(markers, body));
    entityById.set(id, body);
    arrowEls.set(id, makeArrow(arrows, body));
  }
  for (const s of stars) {
    markerEls.set(s.id, makeStarMarker(markers, s));
    entityById.set(s.id, s);
  }
  for (const con of constellations) {
    const ids = new Set();
    for (const [a, b] of con.lines) {
      ids.add(a);
      ids.add(b);
      const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      line.setAttribute('class', 'const-line');
      svg.appendChild(line);
      lineEls.push({ el: line, aId: a, bId: b });
    }
    conStarIds.set(con.id, [...ids]);
    conLabelEls.set(con.id, makeConstellationLabel(labels, con));
  }
  refreshSpottedOutlines();
}

// Sun/Moon/planets render as the same flat glowing "candy" sphere as the
// orrery's small dots (see app.css .body-dot / makeBodyButton in orbits.js) —
// not the emoji glyph the app used to show here, which read as a cartoon
// sticker floating in an otherwise sleek sky, clashing badly with the design.
// skySize/light/dark come from catalog.js; the Sun gets its own fixed
// warm-glow gradient, same as the orrery.
function makeMarker(container, body) {
  const btn = document.createElement('button');
  btn.className = 'sky-marker sky-marker-body hidden';
  const size = body.skySize || 24;
  btn.style.setProperty('--marker-size', `${size}px`);
  const dot = document.createElement('span');
  dot.className = body.id === 'sun' ? 'body-dot sun-dot marker-dot' : 'body-dot marker-dot';
  dot.style.setProperty('--float-delay', `${(Math.random() * 3).toFixed(2)}s`);
  if (body.id !== 'sun') {
    dot.style.setProperty('--dot-light', body.light);
    dot.style.setProperty('--dot-dark', body.dark);
    dot.style.setProperty('--dot-glow', `${Math.round(size * 0.9)}px`);
  }
  const label = document.createElement('span');
  label.className = 'marker-label';
  label.textContent = body.name;
  btn.appendChild(dot);
  btn.appendChild(label);
  btn.addEventListener('click', () => catchBody(body, btn, true));
  container.appendChild(btn);
  return btn;
}

// A real star is a point of light, sized/colored by how bright it actually is —
// not a cartoon ⭐. --star-size/--star-color/--twinkle-delay are read by
// app.css; color defaults to white unless the catalog calls out a real tint
// (red/orange giants like Betelgeuse and Antares genuinely look that way).
function makeStarMarker(container, star) {
  const btn = document.createElement('button');
  const named = star.mag <= NAMED_STAR_MAG;
  const flare = star.mag <= FLARE_STAR_MAG;
  // Only the bright/named stars twinkle. Animating all ~102 meant ~100
  // separately-animating elements on screen at once, each a compositing layer
  // for iOS to juggle; the faint majority read perfectly well as static points
  // of light, and the eye follows the bright ones anyway.
  btn.className = 'sky-marker sky-marker-star hidden'
    + (named ? ' named twinkle' : '')
    + (flare ? ' flare' : '');
  const size = Math.max(3, Math.min(11, 9 - star.mag * 1.6));
  btn.style.setProperty('--star-size', `${size.toFixed(1)}px`);
  btn.style.setProperty('--star-color', star.color || DEFAULT_STAR_COLOR);
  btn.style.setProperty('--twinkle-delay', `${(Math.random() * 2.6).toFixed(2)}s`);
  btn.innerHTML = `<span class="marker-glyph"></span><span class="marker-label">${star.name}</span>`;
  btn.setAttribute('aria-label', star.name);
  btn.addEventListener('click', () => catchBody(star, btn, true));
  container.appendChild(btn);
  return btn;
}

function makeConstellationLabel(container, con) {
  const btn = document.createElement('button');
  btn.className = 'const-label hidden';
  btn.textContent = con.name;
  btn.addEventListener('click', () => say(con.name, con.fact));
  container.appendChild(btn);
  return btn;
}

// A small version of the same glowing sphere as the on-screen marker (not the
// emoji glyph this used to show) — "turn this way" should look like a hint
// toward the same glowing world, not a different, cartoonish icon.
function makeArrow(container, body) {
  const div = document.createElement('div');
  div.className = 'sky-arrow hidden';
  const dotClass = body.id === 'sun' ? 'body-dot sun-dot arrow-dot' : 'body-dot arrow-dot';
  const dot = document.createElement('span');
  dot.className = dotClass;
  if (body.id !== 'sun') {
    dot.style.setProperty('--dot-light', body.light);
    dot.style.setProperty('--dot-dark', body.dark);
    dot.style.setProperty('--dot-glow', '8px');
  }
  const chevron = document.createElement('i');
  chevron.className = 'ph-fill ph-caret-right arrow-chevron';
  div.appendChild(dot);
  div.appendChild(chevron);
  container.appendChild(div);
  return div;
}

// entity is either a SKY_BODIES value (Sun/Moon/planet, has .fact/.safety/.emoji)
// or a star from data/stars.json (has .fact only for the ~20 brightest/named
// ones — see the "fact" fields there; fainter stars fall back to a plain name).
// openSheet is true for a deliberate TAP and false for the reticle dwell. Dwelling
// while you pan should tell you what you are looking at, not keep throwing a
// full-screen sheet over the sky.
function catchBody(entity, el, openSheet = false) {
  el.classList.add('found');
  setTimeout(() => el.classList.remove('found'), 900);
  if (openSheet) {
    if (entity.kind === 'star') {
      const con = constellations.find((c) => c.id === entity.con);
      openStarCard(entity, con ? con.name : null);
    } else {
      openCard(entity.id);
    }
  } else if (entity.fact) {
    say(entity.name, entity.fact, entity.safety);
  } else {
    say(`That's ${entity.name}!`);
  }
  // Sun, Moon and the 8 planets have a badge payoff (see badges.js) —
  // stars/constellations stay speech-only.
  if (isBadgeBody(entity.id)) {
    const newlySpotted = spot(entity.id);
    if (newlySpotted) {
      showToast(document.getElementById('sky-toast'), `${entity.emoji || ''} ${entity.name} spotted!`);
    }
  }
}

function recompute(now, includeSlow) {
  if (!sensorState.hasLocation) return;
  const alt = sunAltitude(now, sensorState.lat, sensorState.lon);
  const wasDark = isDark;
  isDark = alt < DARK_ALT_THRESHOLD;
  currentBodies = bodyPositions(now, sensorState.lat, sensorState.lon);

  // The ~460 star + galactic-plane Horizon() calls only need refreshing on the
  // slow cadence (or immediately if we just crossed into/out of darkness).
  if (includeSlow || isDark !== wasDark) {
    currentStars = isDark ? starPositions(now, sensorState.lat, sensorState.lon, stars) : [];
    currentMilkyWay = isDark ? milkyWayPositions(now, sensorState.lat, sensorState.lon) : [];
    milkyWayDirty = true; // its points moved, so the cached canvas is stale
  }

  const note = document.getElementById('sky-daynote');
  if (!isDark) {
    note.textContent = "It's daytime — stars are hiding! Try the Sun, and come back after dark for stars 🌙";
    note.classList.remove('hidden');
  } else {
    note.classList.add('hidden');
  }
}

function angDiff(a, b) {
  return ((a - b + 540) % 360) - 180;
}

function loop() {
  if (!started) return;
  const now = new Date();
  if (now - lastCalc > RECOMPUTE_MS) {
    const slow = now - lastSlowCalc > SLOW_RECOMPUTE_MS;
    recompute(now, slow);
    lastCalc = now;
    if (slow) lastSlowCalc = now;
  }
  project();
  requestAnimationFrame(loop);
}

function project() {
  const view = viewEl || (viewEl = document.getElementById('sky-view'));
  const w = view.clientWidth || window.innerWidth;
  const h = view.clientHeight || window.innerHeight;
  const cx = w / 2, cy = h / 2;
  const pxPerDeg = w / FOV_DEG;
  const margin = 28;
  const positions = {}; // id -> {x,y,visible}

  drawMilkyWay(cx, cy, pxPerDeg, w, h);

  const place = (id, az, alt, el, arrowEl) => {
    if (alt < -1) { // below horizon: not visible, no arrow
      el.classList.add('hidden');
      if (arrowEl) arrowEl.classList.add('hidden');
      positions[id] = null;
      return;
    }
    const dAz = angDiff(az, sensorState.heading);
    const dAlt = alt - sensorState.pitch;
    const x = cx + dAz * pxPerDeg;
    const y = cy - dAlt * pxPerDeg;
    const onScreen = x > margin && x < w - margin && y > margin && y < h - margin;
    if (onScreen) {
      el.classList.remove('hidden');
      // The trailing translate(-50%,-50%) centers the marker on (x,y) using its
      // OWN box — percentages in translate() resolve against the element itself.
      // This replaced `x - el.offsetWidth/2`: reading offsetWidth right after
      // writing a transform forces a synchronous layout, so the old version did
      // one forced reflow per marker per frame (~110 of them at 60fps). Measured
      // at ~13x the cost of the write-only version even on a fast desktop — this
      // was the main reason Sky mode crawled on an iPad. Never reintroduce a
      // layout read (offsetWidth/Height, getBoundingClientRect, clientWidth on a
      // per-element basis) inside this loop.
      el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
      if (arrowEl) arrowEl.classList.add('hidden');
      positions[id] = { x, y };
    } else {
      el.classList.add('hidden');
      positions[id] = null;
      if (arrowEl) {
        // (ax,ay) below is the standard "math angle → screen point" conversion
        // (x=cx+cos·r, y=cy-sin·r — the minus is what turns a math-convention
        // up-positive angle into a screen-down-positive point), so ang itself
        // must ALSO be up-positive to match — i.e. atan2(dAlt, dAz), not
        // atan2(-dAlt, dAz). The negated version placed (and pointed) every
        // arrow with an up/down component on the wrong side of the screen —
        // pointing away from the target instead of toward it.
        const ang = Math.atan2(dAlt, dAz || 0.0001);
        const r = Math.min(cx, cy) - margin;
        const ax = cx + Math.cos(ang) * r;
        const ay = cy - Math.sin(ang) * r;
        arrowEl.classList.remove('hidden');
        // Same self-centering trick, so this no longer depends on .sky-arrow
        // happening to be exactly 40px wide (the old hardcoded -20 offset).
        arrowEl.style.transform = `translate(${ax}px, ${ay}px) translate(-50%, -50%) rotate(${-ang * 180 / Math.PI}deg)`;
      }
    }
  };

  for (const b of currentBodies) {
    const el = markerEls.get(b.id);
    if (!el) continue;
    place(b.id, b.az, b.alt, el, arrowEls.get(b.id));
  }
  for (const s of currentStars) {
    const el = markerEls.get(s.id);
    if (!el) continue;
    place(s.id, s.az, s.alt, el, null);
  }
  // hide star markers entirely when it's not dark (no recomputed positions to place them at)
  if (!isDark) {
    for (const s of stars) {
      const el = markerEls.get(s.id);
      if (el) el.classList.add('hidden');
    }
  }

  for (const { el, aId, bId } of lineEls) {
    const a = positions[aId], b = positions[bId];
    if (a && b) {
      el.setAttribute('x1', a.x); el.setAttribute('y1', a.y);
      el.setAttribute('x2', b.x); el.setAttribute('y2', b.y);
      el.classList.remove('hidden');
    } else {
      el.classList.add('hidden');
    }
  }

  // A constellation's name shows once at least half its stars are actually on
  // screen — "here's what you're looking at", not a label chasing one lone dot.
  for (const [conId, ids] of conStarIds) {
    const label = conLabelEls.get(conId);
    if (!label) continue;
    const pts = ids.map((id) => positions[id]).filter(Boolean);
    if (pts.length >= Math.ceil(ids.length / 2)) {
      const lx = pts.reduce((sum, p) => sum + p.x, 0) / pts.length;
      const ly = pts.reduce((sum, p) => sum + p.y, 0) / pts.length;
      // Self-centering, no layout read — see the note in place() above.
      label.style.transform = `translate(${lx}px, ${ly}px) translate(-50%, -50%)`;
      label.classList.remove('hidden');
    } else {
      label.classList.add('hidden');
    }
  }

  updateLock(positions, w, h);
}

// "Point and hold": finds whichever visible body/star is currently nearest
// the reticle (see RETICLE_X_FRAC/Y_FRAC — the reticle isn't dead-center) and,
// if it stays there for LOCK_MS, catches it automatically — the reticle is a
// real target, not just decoration. Growing the center dot each frame is the
// only visual feedback needed; a full progress ring wasn't worth the ceremony.
function updateLock(positions, w, h) {
  const dotEl = reticleDotEl || (reticleDotEl = document.querySelector('.reticle-dot'));
  const ret = reticleEl || (reticleEl = document.querySelector('.reticle'));
  if (!dotEl || !ret) return;
  const rx = w * RETICLE_X_FRAC, ry = h * RETICLE_Y_FRAC;

  let nearestId = null, nearestDist = LOCK_RADIUS_PX;
  for (const id in positions) {
    const p = positions[id];
    if (!p) continue;
    const d = Math.hypot(p.x - rx, p.y - ry);
    if (d < nearestDist) { nearestDist = d; nearestId = id; }
  }

  const now = performance.now();
  if (nearestId) {
    if (nearestId !== lockId) { lockId = nearestId; lockStart = now; }
    const progress = Math.min(1, (now - lockStart) / LOCK_MS);
    dotEl.style.transform = `scale(${(1 + progress * 1.6).toFixed(2)})`;
    ret.classList.add('locking');
    // Reveal whatever you're resting on. Most stars are too faint to carry a
    // permanent label (only mag <= NAMED_STAR_MAG do, or the sky turns into a
    // wall of text), so without this, holding the reticle on an ordinary star
    // highlighted it while leaving you with no idea what it was.
    setLockName(markerEls.get(nearestId) || null);
    if (progress >= 1) {
      const lastCatch = lastAutoCatch.get(nearestId) || 0;
      if (now - lastCatch > LOCK_COOLDOWN_MS) {
        lastAutoCatch.set(nearestId, now);
        const entity = entityById.get(nearestId);
        const el = markerEls.get(nearestId);
        if (entity && el) catchBody(entity, el);
      }
      lockStart = now; // restart the dwell so it doesn't refire every frame while still held
    }
  } else {
    lockId = null;
    dotEl.style.transform = '';
    ret.classList.remove('locking');
    setLockName(null);
  }
}

function setLockName(el) {
  if (lockNamedEl === el) return;
  if (lockNamedEl) lockNamedEl.classList.remove('show-name');
  if (el) el.classList.add('show-name');
  lockNamedEl = el;
}

// A soft glowing band, drawn from real galactic-plane points (see
// astro.js::milkyWayPositions) projected through the exact same az/alt→screen
// math as everything else here — real, not a fixed decorative graphic, so it
// sits at its actual position in the sky and moves correctly as you pan.
function drawMilkyWay(cx, cy, pxPerDeg, w, h) {
  if (!milkyWayCtx) return;
  // Redraw only when the view actually moved enough to shift the band by ~half a
  // pixel (or when the data/size changed). Holding the phone still — which is
  // most of the time, and exactly when you're trying to identify something — now
  // costs nothing here instead of re-rendering and re-uploading a full-screen
  // canvas 60 times a second.
  const moved = lastDrawHeading === null ||
    Math.abs(angDiff(sensorState.heading, lastDrawHeading)) * pxPerDeg > 0.5 ||
    Math.abs(sensorState.pitch - lastDrawPitch) * pxPerDeg > 0.5;
  if (!moved && !milkyWayDirty) return;
  lastDrawHeading = sensorState.heading;
  lastDrawPitch = sensorState.pitch;
  milkyWayDirty = false;

  milkyWayCtx.clearRect(0, 0, w, h);
  if (!isDark) return;
  milkyWayCtx.fillStyle = '#cfd3e5';
  for (const p of currentMilkyWay) {
    if (p.alt < -2) continue;
    const dAz = angDiff(p.az, sensorState.heading);
    const dAlt = p.alt - sensorState.pitch;
    const x = cx + dAz * pxPerDeg;
    const y = cy - dAlt * pxPerDeg;
    if (x < -20 || x > w + 20 || y < -20 || y > h + 20) continue;
    milkyWayCtx.globalAlpha = p.opacity;
    milkyWayCtx.beginPath();
    milkyWayCtx.arc(x, y, p.size, 0, Math.PI * 2);
    milkyWayCtx.fill();
  }
  milkyWayCtx.globalAlpha = 1;
}

function wireDrag() {
  const view = document.getElementById('sky-view');
  let dragging = false, lastX = 0, lastY = 0;
  const start = (x, y) => {
    if (sensorState.usingDevice) return;
    dragging = true; lastX = x; lastY = y;
  };
  const move = (x, y) => {
    if (!dragging || sensorState.usingDevice) return;
    nudge(-(x - lastX) * 0.15, (y - lastY) * 0.15);
    lastX = x; lastY = y;
  };
  const end = () => { dragging = false; };

  view.addEventListener('pointerdown', (e) => start(e.clientX, e.clientY));
  view.addEventListener('pointermove', (e) => move(e.clientX, e.clientY));
  window.addEventListener('pointerup', end);
}
