// orrery3d.js — the Explore screen's solar system, in 3-D.
//
// Replaces the old nested-rotating-<div> orrery, which could only ever draw
// circles. Now:
//   • Positions are the REAL heliocentric positions in 3-D (astro.js, from the
//     ephemeris), and each orbit line is traced from the ephemeris itself over
//     one full period. So the ellipses are the true ones — Mercury's is
//     visibly lopsided, with the Sun off-centre at its focus — and the orbits
//     carry their real tilts (Mercury 7°).
//   • Each orbit is scaled UNIFORMLY (display radius ÷ real semi-major axis), so
//     its shape is exact; only the spacing between orbits is compressed, which
//     is the one lie every orrery has to tell to fit a screen. "True distances"
//     removes that lie too, and shows how empty the outer solar system is.
//   • A perspective camera you can swing round and tilt (drag), zoom (pinch),
//     with Tilted / Top / Side presets. Bodies are drawn back-to-front and the
//     orbit lines are split at the Sun's depth, so the Sun hides what's behind it.
//   • Every world is a real lit sphere (globe.js): its day side faces the Sun,
//     so planets beyond the Sun show full discs and near ones show crescents,
//     and each spins about its real pole (Uranus on its side, Venus backwards).
//   • The Sun is alive (sunfx.js).

import { helioEcliptic, moonEcliptic, moonOrbitSamples, moonPhase, moonDistanceKm, orbitPath, eqjVecToEcl, raDecToVec } from './astro.js?v=24';
import { SUN, MOON, PLANETS } from './catalog.js?v=24';
import { Globe, loadTexture, makeNoiseMap, v3, frameFromPole, saturnRingTexture, drawRingHalf, RING_OUTER } from './globe.js?v=24';
import { SunFX } from './sunfx.js?v=24';
import { isSpotted } from './badges.js?v=24';
import { describePhase } from './moonphase.js?v=24';

const DEG = Math.PI / 180;

// Real facts per body: orbital period (for tracing the orbit), north-pole
// direction (IAU, RA/Dec J2000), and spin sense. Spin SPEED is cosmetic — the
// real ratios would strobe at playback speed.
export const WORLDS = {
  mercury: { body: 'Mercury', period: 87.969, pole: [281.01, 61.41], turnSec: 70, sense: 1 },
  venus: { body: 'Venus', period: 224.701, pole: [272.76, 67.16], turnSec: 140, sense: -1 },
  earth: { body: 'Earth', period: 365.256, pole: [0, 90], turnSec: 24, sense: 1 },
  mars: { body: 'Mars', period: 686.98, pole: [317.68, 52.89], turnSec: 25, sense: 1 },
  jupiter: { body: 'Jupiter', period: 4332.59, pole: [268.06, 64.5], turnSec: 12, sense: 1 },
  saturn: { body: 'Saturn', period: 10759.22, pole: [40.59, 83.54], turnSec: 13, sense: 1 },
  uranus: { body: 'Uranus', period: 30688.5, pole: [257.31, -15.18], turnSec: 18, sense: -1 },
  neptune: { body: 'Neptune', period: 60182, pole: [299.36, 43.46], turnSec: 17, sense: 1 },
};

// Per-body look: atmosphere rim, cloud wash, limb darkening.
export const LOOKS = {
  mercury: { ambient: 0.03 },
  venus: { ambient: 0.05, wash: [255, 244, 214, 0.55], atmo: [255, 236, 190, 0.5] },
  earth: { ambient: 0.05, atmo: [110, 175, 255, 0.9], ocean: true, clouds: true },
  mars: { ambient: 0.04, atmo: [255, 170, 130, 0.35] },
  jupiter: { ambient: 0.04, limb: 0.3, atmo: [255, 225, 190, 0.25] },
  saturn: { ambient: 0.04, limb: 0.3, atmo: [255, 235, 190, 0.2] },
  uranus: { ambient: 0.05, limb: 0.35, atmo: [170, 240, 250, 0.45] },
  neptune: { ambient: 0.05, limb: 0.35, atmo: [120, 160, 255, 0.5] },
  moon: { ambient: 0.03 },
};

const VIEWS = [
  { name: 'Tilted', pitch: 42 },
  { name: 'Top', pitch: 89 },
  { name: 'Side', pitch: 4 },
];

const GAP = 5;                 // clear space between neighbouring orbits at their closest
const SUN_R = 30;              // display radius of the Sun (compressed mode)
const MOON_OFFSET = 2.2;       // Moon's distance from Earth, in Earth radii (display)
const ZOOM_MIN = 0.5, ZOOM_MAX = 6;
// Worlds are DRAWN larger than the room the layout reserves for them: at a
// size that never touches a neighbouring orbit, on a phone Earth is 3 px. A
// planet briefly overlapping the next orbit's line reads fine; a dot doesn't.
const PLANET_BOOST = 1.6;
// Perspective makes the near half of an orbit a little wider than its radius.
const PERSPECTIVE_SPREAD = 1.12;
// Earth & Moon close-up: the Moon's real orbit fills this fraction of the screen.
const FOCUS_PX = 0.36;
// Each planet leaves a short fading trail: the last TRAIL_FRAC of its orbit.
const TRAIL_N = 10, TRAIL_FRAC = 0.08;

let cloudMap = null;
export function earthClouds() {
  if (!cloudMap) cloudMap = makeNoiseMap(256, 128, 42, 6, 6);
  return cloudMap;
}

/** A body's real pole direction in the ecliptic frame. */
export function poleOf(id) {
  const w = WORLDS[id];
  if (!w) return [0, 0, 1];
  return eqjVecToEcl(raDecToVec(w.pole[0], w.pole[1]));
}

let canvas, ctx, dpr = 1, W = 0, H = 0;
let onTapBody = () => {};
let date = new Date();
let worlds = [];               // { id, look, a, e, rMin, rMax, path, A, Atrue, size, pos, globe, frame }
let moon = null;
let sunfx = null;
let ringTex = null;
let yaw = -20, pitch = 42, targetPitch = 42, viewIdx = 0;
let yawVel = 0;
let zoom = 1, fit = 1;
let trueMix = 0, trueTarget = 0;
let autoRotate = false;
let started = false, lastFrame = 0;
let dirtyPositions = true;
let focusK = 0, focusTarget = 0;   // 0 = whole system, 1 = Earth & Moon close-up (eased)
let moonPath = [], moonA = 1;      // the Moon's real geocentric orbit, and its mean radius (AU)
let belt = null, beltRef = null;   // the main asteroid belt
const hits = [];

export function initOrrery(el, onTap) {
  canvas = el;
  ctx = canvas.getContext('2d');
  onTapBody = onTap;
  sunfx = new SunFX('lite');
  ringTex = saturnRingTexture();
  buildWorlds();
  buildBelt();
  wireGestures();
  new ResizeObserver(resize).observe(canvas);
  resize();
  started = true;
  requestAnimationFrame(frame);
}

function buildWorlds() {
  const now = new Date();
  worlds = PLANETS.map((p) => {
    const w = WORLDS[p.id];
    const path = orbitPath(w.body, w.period, now, 240);
    const rs = path.map((q) => Math.hypot(q[0], q[1], q[2]));
    const rMin = Math.min(...rs), rMax = Math.max(...rs);
    return {
      id: p.id, cat: p, look: LOOKS[p.id], path,
      a: (rMin + rMax) / 2, e: (rMax - rMin) / (rMax + rMin),
      size: p.sizePx / 2,
      tex: loadTexture(p.texture),
      frame: frameFromPole(poleOf(p.id)),
      globe: new Globe(16),
      pos: [0, 0, 0],
    };
  });
  // Compressed layout: each orbit is pushed out only as far as its REAL
  // closest approach to the one inside it requires. Orbits' long axes point in
  // different directions, so the inner orbit's far point never lines up with
  // the outer one's near point — padding for that worst case (the obvious way)
  // made the system 50% bigger and every planet a third smaller on a phone.
  for (const w of worlds) {
    w.pad = w.id === 'saturn' ? w.size * RING_OUTER : w.id === 'earth' ? w.size * (MOON_OFFSET + 0.5) : w.size;
    w.rho = radiusByDirection(w.path, w.a);
  }
  let prev = null;
  for (const w of worlds) {
    let A = 0;
    for (let k = 0; k < DIRS; k++) {
      const inner = prev ? prev.A * prev.rho[k] + prev.pad : SUN_R;
      A = Math.max(A, (inner + GAP + w.pad) / w.rho[k]);
    }
    w.A = A;
    prev = w;
  }
  const outer = worlds[worlds.length - 1];
  const kTrue = outer.A / outer.a;
  for (const w of worlds) w.Atrue = w.a * kTrue;
  moon = { id: 'moon', look: LOOKS.moon, tex: loadTexture(MOON.texture), globe: new Globe(8), size: 3, pos: [0, 0, 0], vec: [0, 0, 0] };
  moonPath = moonOrbitSamples(now, 120);
  moonA = moonPath.reduce((sum, q) => sum + Math.hypot(q[0], q[1], q[2]), 0) / moonPath.length;
  earthClouds();
}

// An orbit's radius in each of DIRS ecliptic directions, as a fraction of its
// semi-major axis (so 1 ± e). Used only for spacing the compressed layout.
const DIRS = 180;
function radiusByDirection(path, a) {
  const out = new Float32Array(DIRS);
  for (let k = 0; k < path.length; k++) {
    const p = path[k], q = path[(k + 1) % path.length];
    const r = Math.hypot(p[0], p[1]) / a;
    const r2 = Math.hypot(q[0], q[1]) / a;
    let d0 = Math.atan2(p[1], p[0]) / (2 * Math.PI) * DIRS;
    let d1 = Math.atan2(q[1], q[0]) / (2 * Math.PI) * DIRS;
    if (d1 < d0 - DIRS / 2) d1 += DIRS;
    if (d1 > d0 + DIRS / 2) d1 -= DIRS;
    const lo = Math.ceil(Math.min(d0, d1)), hi = Math.floor(Math.max(d0, d1));
    for (let d = lo; d <= hi; d++) {
      const t = d1 === d0 ? 0 : (d - d0) / (d1 - d0);
      out[((d % DIRS) + DIRS) % DIRS] = r + (r2 - r) * t;
    }
  }
  for (let k = 0; k < DIRS; k++) if (!out[k]) out[k] = out[(k + DIRS - 1) % DIRS] || 1;
  return out;
}

function outerExtent() {
  const o = worlds[worlds.length - 1];
  return o.A * Math.max(...o.rho) + o.size + 4;
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  W = w; H = h;
  dpr = Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(3.2e6 / (w * h)));
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  // Fit the whole system across the narrower usable dimension.
  fit = Math.min(W / 2 - 6, H * 0.4) / (outerExtent() * PERSPECTIVE_SPREAD);
}

// ---- public controls ----
export function setOrreryDate(d) { date = d; dirtyPositions = true; }
export function zoomOrrery(delta) { zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * (1 + delta))); }
export function cycleView() {
  viewIdx = (viewIdx + 1) % VIEWS.length;
  targetPitch = VIEWS[viewIdx].pitch;
  return VIEWS[viewIdx].name;
}
export function toggleTrueScale() {
  trueTarget = trueTarget ? 0 : 1;
  return !!trueTarget;
}
export function setAutoRotate(on) { autoRotate = on; }
// Earth & Moon close-up: the camera eases onto Earth and the Moon's orbit fills the screen.
export function toggleEarthMoon() {
  focusTarget = focusTarget ? 0 : 1;
  targetPitch = focusTarget ? 24 : VIEWS[viewIdx].pitch;
  return !!focusTarget;
}

// ---- positions ----
function updatePositions() {
  if (!dirtyPositions) return;
  dirtyPositions = false;
  for (const w of worlds) {
    const body = WORLDS[w.id].body;
    w.helio = helioEcliptic(body, date);
    // Where it has been: a short arc of its real path behind it, so the motion reads.
    const span = TRAIL_FRAC * WORLDS[w.id].period * 86400000;
    w.trail = [];
    for (let k = TRAIL_N - 1; k >= 0; k--) w.trail.push(helioEcliptic(body, new Date(date.getTime() - (k / (TRAIL_N - 1)) * span)));
  }
  moon.vec = moonEcliptic(date);
  updateChip();
}

// The Earth & Moon caption: the Moon's real phase, lit share and distance today.
let chipEl = null, chipShown = false;
function updateChip() {
  chipEl = chipEl || document.getElementById('em-chip');
  if (!chipEl) return;
  const { name, lit } = describePhase(moonPhase(date));
  const km = Math.round(moonDistanceKm(date) / 1000) * 1000;
  chipEl.textContent = `${name} · ${lit}% lit · ${km.toLocaleString('en-US')} km`;
}

// ---- camera ----
// Orbits the point T. k is the screen scale (px per world unit at unit depth).
function camera(T, k) {
  const R = outerExtent();
  const D = R * 2.1;
  const cp = Math.cos(pitch * DEG), sp = Math.sin(pitch * DEG);
  const cy = Math.cos(yaw * DEG), sy = Math.sin(yaw * DEG);
  const C = v3.add(T, [D * cp * sy, -D * cp * cy, D * sp]);
  const fwd = v3.norm(v3.sub(T, C));
  const right = v3.norm(v3.cross(fwd, [0, 0, 1]));
  const up = v3.cross(right, fwd);
  return { C, D, fwd, right, up, k, cx: W / 2, cy: H * 0.46 };
}

function project(cam, p) {
  const rel = v3.sub(p, cam.C);
  const z = v3.dot(rel, cam.fwd);
  const s = cam.k * cam.D / Math.max(z, 1);
  return { x: cam.cx + v3.dot(rel, cam.right) * s, y: cam.cy - v3.dot(rel, cam.up) * s, z, s };
}

function toView(cam, w) {
  return [v3.dot(w, cam.right), v3.dot(w, cam.up), -v3.dot(w, cam.fwd)];
}

// ---- frame ----
function frame(now) {
  requestAnimationFrame(frame);
  const screen = document.getElementById('explore-screen');
  if (!screen.classList.contains('active')) { lastFrame = 0; return; }
  if (!document.getElementById('planet-card').classList.contains('hidden')) { lastFrame = 0; return; }
  if (!W) resize();
  if (!W) return;
  const t = now / 1000;
  const dt = lastFrame ? Math.min(0.1, t - lastFrame) : 0;
  lastFrame = t;

  // Camera easing, inertia, clean-view drift.
  pitch += (targetPitch - pitch) * Math.min(1, dt * 4);
  trueMix += (trueTarget - trueMix) * Math.min(1, dt * 3);
  focusK += (focusTarget - focusK) * Math.min(1, dt * 2.5);
  const chipOn = focusTarget === 1 && focusK > 0.5;
  if (chipOn !== chipShown) { chipShown = chipOn; chipEl?.classList.toggle('show', chipOn); }
  if (!dragging) {
    yaw += yawVel * dt;
    yawVel *= Math.pow(0.08, dt);
    if (autoRotate) yaw += 4 * dt;
  }

  updatePositions();
  render(t);
}

function render(t) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  hits.length = 0;
  const mix = trueMix;
  const sizeK = 1 - 0.65 * mix;

  // Place every world: its real heliocentric position, scaled by its orbit's
  // own factor (compressed ↔ true distances).
  for (const w of worlds) {
    const A = w.A + (w.Atrue - w.A) * mix;
    w.scale = A / w.a;
    w.pos = v3.scale(w.helio, w.scale);
    w.r = w.size * PLANET_BOOST * sizeK;
  }
  const earth = worlds.find((w) => w.id === 'earth');
  moon.r = moon.size * PLANET_BOOST * sizeK;
  // The Moon's REAL geocentric position, at the display scale of its orbit.
  const moonK = (earth.r * MOON_OFFSET) / moonA;
  moon.pos = v3.add(earth.pos, v3.scale(moon.vec, moonK));

  // The camera orbits the Sun, or — as the Earth & Moon close-up eases in — the
  // Earth. Zoom blends geometrically so the step from the whole system to the
  // pair feels even, and lands with the Moon's orbit at FOCUS_PX of the screen.
  const base = fit * zoom;
  const m = (Math.min(W, H) * FOCUS_PX) / (earth.r * MOON_OFFSET * base);
  const cam = camera(v3.scale(earth.pos, focusK), base * Math.pow(m, focusK));

  const sunP = project(cam, [0, 0, 0]);
  const sunR = (SUN_R - (SUN_R - 7) * mix) * sunP.s;
  const sunOn = sunP.x > -sunR * 3 && sunP.x < W + sunR * 3 && sunP.y > -sunR * 3 && sunP.y < H + sunR * 3;

  // In the close-up only Earth and the Moon stay; the rest of the system is
  // far off-screen, and a planet wandering past the Earth reads as clutter.
  const solo = (b) => focusK < 0.6 || b.id === 'earth' || b.id === 'moon';

  drawPlane(cam);
  drawBelt(cam, t, mix);
  if (focusK < 0.3) for (const w of worlds) drawTrail(cam, w); // a trail across the close-up reads as a streak

  // Orbit lines, split at the Sun's depth.
  const behind = new Path2D(), front = new Path2D();
  for (const w of worlds) {
    let prev = null;
    for (let k = 0; k <= w.path.length; k++) {
      const q = w.path[k % w.path.length];
      const p = project(cam, v3.scale(q, w.scale));
      if (prev) {
        const path = (p.z + prev.z) / 2 > sunP.z ? behind : front;
        path.moveTo(prev.x, prev.y); path.lineTo(p.x, p.y);
      }
      prev = p;
    }
  }
  // The Moon's real orbit round Earth — an ellipse, tilted 5°, traced from the ephemeris.
  const moonRing = new Path2D();
  for (let k = 0; k <= moonPath.length; k++) {
    const q = moonPath[k % moonPath.length];
    const p = project(cam, v3.add(earth.pos, v3.scale(q, moonK)));
    if (k) moonRing.lineTo(p.x, p.y); else moonRing.moveTo(p.x, p.y);
  }

  // Each orbit gets a soft halo under its hairline, so the ellipses read as light.
  // The planets' orbits fade out in the close-up; the Moon's own orbit stays.
  ctx.globalAlpha = 1 - 0.85 * focusK;
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(210,215,240,0.045)';
  ctx.stroke(behind);
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(210,215,240,0.13)';
  ctx.stroke(behind);

  const bodies = [...worlds, moon].map((b) => ({ b, p: project(cam, b.pos) }));
  bodies.sort((a, b) => b.p.z - a.p.z);
  const drawBody = ({ b, p }) => drawWorld(cam, b, p, t);

  for (const it of bodies) if (it.p.z > sunP.z && solo(it.b)) drawBody(it);
  if (sunOn && focusK < 0.5) {
    sunfx.draw(ctx, sunP.x, sunP.y, sunR, t, dpr);
    hits.push({ id: 'sun', x: sunP.x, y: sunP.y, r: Math.max(26, sunR + 6), z: sunP.z });
  }
  if (focusK > 0.4) drawSunMarker(sunP, Math.min(1, (focusK - 0.4) / 0.4));
  ctx.lineWidth = 1;
  ctx.strokeStyle = 'rgba(210,215,240,0.2)';
  ctx.stroke(front);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = `rgba(200,212,242,${(0.12 + 0.2 * focusK).toFixed(3)})`;
  ctx.stroke(moonRing);
  for (const it of bodies) if (it.p.z <= sunP.z && solo(it.b)) drawBody(it);
  drawLabels();
}

// In the Earth & Moon close-up the Sun is too far off to draw, but it is what
// lights the pair. A glow marker, held inside the frame, shows where it is.
function drawSunMarker(sunP, a) {
  const dx = sunP.x - W / 2, dy = sunP.y - H / 2;
  const x0 = 34, x1 = W - 34, y0 = 190, y1 = H - 250;
  let t = Infinity;
  if (dx > 0) t = Math.min(t, (x1 - W / 2) / dx);
  if (dx < 0) t = Math.min(t, (x0 - W / 2) / dx);
  if (dy > 0) t = Math.min(t, (y1 - H / 2) / dy);
  if (dy < 0) t = Math.min(t, (y0 - H / 2) / dy);
  const k = Math.min(1, t);
  const mx = W / 2 + dx * k, my = H / 2 + dy * k;
  const g = ctx.createRadialGradient(mx, my, 0, mx, my, 30);
  g.addColorStop(0, `rgba(255,240,205,${(0.95 * a).toFixed(3)})`);
  g.addColorStop(0.22, `rgba(255,180,90,${(0.5 * a).toFixed(3)})`);
  g.addColorStop(1, 'rgba(255,140,60,0)');
  ctx.fillStyle = g;
  ctx.fillRect(mx - 30, my - 30, 60, 60);
  ctx.font = '700 10px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgba(255,226,180,${a.toFixed(3)})`;
  ctx.fillText('SUN', mx, my + 26);
  hits.push({ id: 'sun', x: mx, y: my, r: 30, z: sunP.z });
}

// ---- Asteroid belt: real main-belt orbits (2.2–3.3 AU), each rock moving at its
// own Keplerian rate from the selected date, so the belt churns at the right pace.
function buildBelt() {
  beltRef = { mars: worlds.find((w) => w.id === 'mars'), jup: worlds.find((w) => w.id === 'jupiter') };
  belt = Array.from({ length: 520 }, () => ({
    a: 2.2 + Math.random() * 1.1,
    ph: Math.random() * Math.PI * 2,
    inc: Math.random() * 0.16,
    size: 0.6 + Math.random() * 0.8,
    al: 0.22 + Math.random() * 0.4,
  }));
}

// Display radius of a belt rock at semi-major axis a, between the compressed
// layout (fitted into the gap between Mars and Jupiter) and true distances.
function beltRadius(a, mix) {
  const { mars, jup } = beltRef;
  const comp = mars.A + (a - mars.a) * (jup.A - mars.A) / (jup.a - mars.a);
  const tru = a * (jup.Atrue / jup.a);
  return comp + (tru - comp) * mix;
}

function drawBelt(cam, t, mix) {
  if (!belt || focusK > 0.95) return;
  const days = date.getTime() / 86400000 - 10957.5; // days since J2000
  ctx.fillStyle = 'rgb(222,208,186)';
  for (const q of belt) {
    const R = beltRadius(q.a, mix);
    const th = q.ph + (2 * Math.PI * days) / (365.25 * Math.pow(q.a, 1.5));
    const p = project(cam, [R * Math.cos(th), R * Math.sin(th), R * Math.sin(q.inc) * Math.sin(th)]);
    ctx.globalAlpha = q.al;
    ctx.fillRect(p.x, p.y, q.size, q.size);
  }
  ctx.globalAlpha = 1;
}

// A planet's recent path: a tail that fades from nothing to a soft glow.
function drawTrail(cam, w) {
  const [r, g, b] = hexRgb(w.cat.light || '#ffffff');
  const n = w.trail.length;
  let prev = null;
  for (let k = 0; k < n; k++) {
    const p = project(cam, v3.scale(w.trail[k], w.scale));
    if (prev) {
      const f = k / (n - 1);
      ctx.strokeStyle = `rgba(${r},${g},${b},${(0.6 * Math.pow(f, 1.7)).toFixed(3)})`;
      ctx.lineWidth = 0.6 + 1.1 * f;
      ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(p.x, p.y); ctx.stroke();
    }
    prev = p;
  }
}

function hexRgb(h) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(h);
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [255, 255, 255];
}

// A faint glow in the plane of the planets — enough to read as a disc in 3-D.
let planeTex = null;
function drawPlane(cam) {
  if (!planeTex) {
    planeTex = document.createElement('canvas');
    planeTex.width = planeTex.height = 128;
    const x = planeTex.getContext('2d');
    const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,200,150,0.22)');
    g.addColorStop(0.25, 'rgba(170,160,230,0.08)');
    g.addColorStop(1, 'rgba(120,120,200,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
  }
  const R = outerExtent();
  const o = project(cam, [0, 0, 0]);
  const ex = project(cam, [R, 0, 0]), ey = project(cam, [0, R, 0]);
  ctx.save();
  ctx.transform(ex.x - o.x, ex.y - o.y, ey.x - o.x, ey.y - o.y, o.x, o.y);
  ctx.drawImage(planeTex, -1, -1, 2, 2);
  ctx.restore();
}

function drawWorld(cam, b, p, t) {
  const r = Math.max(1.2, b.r * p.s);
  const L = toView(cam, v3.norm(v3.scale(b.pos, -1)));
  const look = b.look || {};
  const id = b.id;
  const w = WORLDS[id];

  // Saturn's ring, back half first.
  let ring = null;
  if (id === 'saturn') {
    const Ro = b.r * RING_OUTER;
    const pu = project(cam, v3.add(b.pos, v3.scale(b.frame.ex, Ro)));
    const pv = project(cam, v3.add(b.pos, v3.scale(b.frame.ez, Ro)));
    ring = {
      su: [pu.x - p.x, pu.y - p.y], sv: [pv.x - p.x, pv.y - p.y],
      du: v3.dot(b.frame.ex, cam.fwd), dv: v3.dot(b.frame.ez, cam.fwd),
    };
    drawRingHalf(ctx, ringTex, p.x, p.y, ring.su, ring.sv, ring.du, ring.dv, true, 0.9);
  }

  // Atmosphere halo just outside the limb, on the lit side's brightness.
  if (look.atmo && r > 2.5) {
    const g = ctx.createRadialGradient(p.x, p.y, r * 0.9, p.x, p.y, r * 1.45);
    const [ar, ag, ab, as] = look.atmo;
    g.addColorStop(0, `rgba(${ar},${ag},${ab},${(0.35 * as).toFixed(3)})`);
    g.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.45, 0, Math.PI * 2); ctx.fill();
  }

  const px = Math.min(160, Math.max(6, Math.round(2 * r * dpr)));
  b.globe.resize(px);
  if (b.frame) {
    b.globe.setOrientation(toView(cam, b.frame.ex), toView(cam, b.frame.ey), toView(cam, b.frame.ez));
  } else {
    // The Moon keeps one face toward Earth — its "pole" is ecliptic north.
    const f = frameFromPole([0, 0, 1]);
    b.globe.setOrientation(toView(cam, f.ex), toView(cam, f.ey), toView(cam, f.ez));
  }
  const spin = w ? (w.sense * t) / w.turnSec : 0;
  const ok = b.globe.render({
    tex: b.tex, spin, light: L, ambient: look.ambient, limb: look.limb, wash: look.wash,
    atmo: look.atmo, ocean: look.ocean && r > 5,
    clouds: look.clouds ? { map: earthClouds(), turns: t / 60, alpha: 0.85 } : null,
  });
  if (ok) ctx.drawImage(b.globe.canvas, p.x - r, p.y - r, 2 * r, 2 * r);
  else {
    ctx.fillStyle = (b.cat && b.cat.color) || '#ccc';
    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
  }

  if (ring) drawRingHalf(ctx, ringTex, p.x, p.y, ring.su, ring.sv, ring.du, ring.dv, false, 0.9);

  if (id !== 'moon' && isSpotted(id)) {
    ctx.strokeStyle = 'rgba(181,171,252,0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, r + 3.5, 0, Math.PI * 2); ctx.stroke();
  }
  hits.push({ id, x: p.x, y: p.y, r: Math.max(20, r + 8), z: p.z });
  if (id !== 'moon') labels.push({ text: b.cat.name.toUpperCase(), x: p.x, y: p.y + r + 11, z: p.z });
  else if (focusK > 0.3) labels.push({ text: 'MOON', x: p.x, y: p.y + r + 11, z: p.z });
}

// Small names under the worlds, nearest first, skipping any that would collide.
const labels = [];
function drawLabels() {
  labels.sort((a, b) => a.z - b.z);
  ctx.font = '700 9.5px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(8,9,20,0.75)';
  ctx.fillStyle = 'rgba(233,233,237,0.78)';
  const placed = [];
  for (const l of labels) {
    const text = l.text.split('').join('\u200A');
    const w = ctx.measureText(text).width + 4;
    const box = [l.x - w / 2, l.y - 6, l.x + w / 2, l.y + 6];
    if (placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) continue;
    placed.push(box);
    ctx.strokeText(text, l.x, l.y);
    ctx.fillText(text, l.x, l.y);
  }
  labels.length = 0;
}

// ---- gestures: drag to swing the camera, pinch to zoom, tap to open ----
let dragging = false;
function wireGestures() {
  const pts = new Map();
  let start = null, pinch = null, lastMove = 0;
  canvas.addEventListener('pointerdown', (e) => {
    if (document.body.classList.contains('clean-view')) return;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not an active pointer (synthetic input) */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 1) { start = { x: e.clientX, y: e.clientY, t: performance.now() }; yawVel = 0; }
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      start = null;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 10) zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, pinch.zoom * d / pinch.d));
      return;
    }
    if (start && !dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) dragging = true;
    if (dragging) {
      yaw -= dx * 0.4;
      targetPitch = pitch = Math.max(3, Math.min(89, pitch + dy * 0.35));
      const now = performance.now();
      const dtm = Math.max(1, now - lastMove);
      yawVel = (-dx * 0.4) / (dtm / 1000) * 0.6;
      lastMove = now;
    }
  });
  const end = (e) => {
    if (start && !dragging && performance.now() - start.t < 500) tap(e);
    if (performance.now() - lastMove > 80) yawVel = 0;
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size) { dragging = false; start = null; }
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', (e) => { start = null; end(e); });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom * Math.exp(-e.deltaY * 0.0015)));
  }, { passive: false });
}

function tap(e) {
  const rect = canvas.getBoundingClientRect();
  const x = e.clientX - rect.left, y = e.clientY - rect.top;
  let best = null, bestScore = Infinity;
  for (const h of hits) {
    const d = Math.hypot(h.x - x, h.y - y);
    if (d > h.r) continue;
    const score = d - (h.id === 'sun' ? 0 : 6) + h.z * 1e-4; // nearer, and planets over the Sun
    if (score < bestScore) { bestScore = score; best = h; }
  }
  if (best) onTapBody(best.id);
}
