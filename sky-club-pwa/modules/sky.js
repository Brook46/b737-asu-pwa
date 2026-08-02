// sky.js — the Sky screen: point (or drag) to find the real Sun, Moon, planets and
// a handful of bright stars/constellations, using their actual right-now positions.
//
// Rendering is a simple small-angle projection, not a real camera: bodies are placed
// on screen from the angular difference between their azimuth/altitude and the
// phone's current heading/pitch, at a fixed pixel-per-degree scale (FOV_DEG). Bodies
// outside that window but still above the horizon get an edge arrow pointing at them
// — a built-in "turn this way" treasure-hunt mechanic a pre-reader can follow without
// any text.

import { bodyPositions, starPositions, sunAltitude } from './astro.js';
import { SKY_BODIES } from './catalog.js';
import { sensorState, geolocate, requestOrientationPermission, nudge } from './sensors.js';
import { say } from './speech.js';

const FOV_DEG = 68; // horizontal degrees visible at once
const RECOMPUTE_MS = 2000;
const DARK_ALT_THRESHOLD = -4; // sun below this altitude ⇒ dark enough for stars
const NAMED_STAR_MAG = 1.5;    // stars this bright or brighter show their name always
const FLARE_STAR_MAG = 0.2;    // the handful of hero-bright stars get a lens-flare sparkle
const DEFAULT_STAR_COLOR = '#eef4ff';

let stars = [];
let constellations = [];
let started = false;
let lastCalc = 0;
let currentBodies = [];
let currentStars = [];
let isDark = false;
const markerEls = new Map();     // id -> marker button
const arrowEls = new Map();      // id -> arrow div
const lineEls = [];              // { el, aId, bId }
const conLabelEls = new Map();   // constellation id -> label button
const conStarIds = new Map();    // constellation id -> unique star ids in its lines

export async function initSky() {
  document.getElementById('sky-start').addEventListener('click', startSky);
  wireDrag();

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

// Stays on the gate (not the sky view) until location actually succeeds, so a
// failure never leaves the user staring at a blank/dead sky with no way back —
// that silent-failure was the #1 complaint. requestOrientationPermission() has
// to be the first thing called, synchronously, so it's still inside the tap.
async function startSky() {
  const gateNote = document.getElementById('sky-gate-note');
  const startBtn = document.getElementById('sky-start');

  const orientPromise = requestOrientationPermission();
  startBtn.disabled = true;
  gateNote.textContent = 'Finding you… hold on a moment.';

  try {
    await geolocate();
  } catch (err) {
    startBtn.disabled = false;
    startBtn.textContent = '🔭 Try Again';
    gateNote.textContent = err.denied
      ? 'Location is turned off for Sky Club. Turn it on in Settings, then try again.'
      : "Couldn't find your location. Check you're connected, then try again.";
    await orientPromise;
    return;
  }
  await orientPromise;

  startBtn.disabled = false;
  startBtn.textContent = '🔭 Look at the Sky';
  gateNote.textContent = "We'll use where you are, and where you point your phone.";
  document.getElementById('sky-gate').classList.add('hidden');
  document.getElementById('sky-view').classList.remove('hidden');

  if (!started) {
    buildMarkers();
    started = true;
    requestAnimationFrame(loop);
  }
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
  arrowEls.clear();
  lineEls.length = 0;
  conLabelEls.clear();
  conStarIds.clear();

  for (const id of Object.keys(SKY_BODIES)) {
    const body = SKY_BODIES[id];
    markerEls.set(id, makeMarker(markers, body.emoji, body.name, true));
    arrowEls.set(id, makeArrow(arrows, body.emoji));
  }
  for (const s of stars) {
    markerEls.set(s.id, makeStarMarker(markers, s));
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
}

function makeMarker(container, emoji, name, big) {
  const btn = document.createElement('button');
  btn.className = (big ? 'sky-marker sky-marker-body' : 'sky-marker sky-marker-star') + ' hidden';
  btn.innerHTML = `<span class="marker-glyph">${emoji}</span><span class="marker-label">${name}</span>`;
  btn.addEventListener('click', () => catchBody(name, btn));
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
  btn.className = 'sky-marker sky-marker-star hidden' + (named ? ' named' : '') + (flare ? ' flare' : '');
  const size = Math.max(3, Math.min(11, 9 - star.mag * 1.6));
  btn.style.setProperty('--star-size', `${size.toFixed(1)}px`);
  btn.style.setProperty('--star-color', star.color || DEFAULT_STAR_COLOR);
  btn.style.setProperty('--twinkle-delay', `${(Math.random() * 2.6).toFixed(2)}s`);
  btn.innerHTML = `<span class="marker-glyph"></span><span class="marker-label">${star.name}</span>`;
  btn.setAttribute('aria-label', star.name);
  btn.addEventListener('click', () => catchBody(star.name, btn));
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

function makeArrow(container, emoji) {
  const div = document.createElement('div');
  div.className = 'sky-arrow hidden';
  div.innerHTML = `<span class="arrow-glyph">${emoji}</span><span class="arrow-chevron">➜</span>`;
  container.appendChild(div);
  return div;
}

function catchBody(name, el) {
  el.classList.add('found');
  setTimeout(() => el.classList.remove('found'), 900);
  const meta = Object.values(SKY_BODIES).find((b) => b.name === name);
  if (meta) {
    say(meta.name, meta.fact, meta.safety);
  } else {
    say(`That's ${name}!`);
  }
}

function recompute(now) {
  if (!sensorState.hasLocation) return;
  const alt = sunAltitude(now, sensorState.lat, sensorState.lon);
  isDark = alt < DARK_ALT_THRESHOLD;
  currentBodies = bodyPositions(now, sensorState.lat, sensorState.lon);
  currentStars = isDark ? starPositions(now, sensorState.lat, sensorState.lon, stars) : [];

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
  if (now - lastCalc > RECOMPUTE_MS) { recompute(now); lastCalc = now; }
  project();
  requestAnimationFrame(loop);
}

function project() {
  const view = document.getElementById('sky-view');
  const w = view.clientWidth || window.innerWidth;
  const h = view.clientHeight || window.innerHeight;
  const cx = w / 2, cy = h / 2;
  const pxPerDeg = w / FOV_DEG;
  const margin = 28;
  const positions = {}; // id -> {x,y,visible}

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
      el.style.transform = `translate(${x - el.offsetWidth / 2}px, ${y - el.offsetHeight / 2}px)`;
      if (arrowEl) arrowEl.classList.add('hidden');
      positions[id] = { x, y };
    } else {
      el.classList.add('hidden');
      positions[id] = null;
      if (arrowEl) {
        const ang = Math.atan2(-dAlt, dAz || 0.0001);
        const r = Math.min(cx, cy) - margin;
        const ax = cx + Math.cos(ang) * r;
        const ay = cy - Math.sin(ang) * r;
        arrowEl.classList.remove('hidden');
        arrowEl.style.transform = `translate(${ax - 20}px, ${ay - 20}px) rotate(${-ang * 180 / Math.PI}deg)`;
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
      label.style.transform = `translate(${lx - label.offsetWidth / 2}px, ${ly - label.offsetHeight / 2}px)`;
      label.classList.remove('hidden');
    } else {
      label.classList.add('hidden');
    }
  }
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
