// zoom.js — "From the universe to you": one continuous zoom through real scales.
//
// The picture is a log scale: Z is log10 of the metres across the shorter side
// of the screen. Zooming in lowers Z. Each scene is drawn at its true scale and
// fades in and out as Z passes through its range, so the zoom reads as one
// journey: the universe → the Local Group → the Milky Way → the Sun's
// neighbourhood → the solar system → Earth and the Moon → Earth, with a pin on
// wherever you are right now.
//
// Each scene is centred on something real, and the zoom always ends on you:
//   • the Local Group and the Milky Way are centred on the galaxy;
//   • the Milky Way, the stars around us and the solar system on the Sun;
//   • Earth and the Moon on Earth;
//   • the last scene on your own latitude and longitude.
// Positions use the real ephemeris (planets, Moon) and the real star catalogue
// (data/stars.json, distances and directions). The universe and the galaxies
// are drawn to scale in size and distance, but their numbers of objects and
// shapes are illustrative — the honest caption says so.

import { helioEcliptic, moonEcliptic, moonOrbitSamples, orbitPath, siderealHours, eqjVecToEcl } from './astro.js?v=24';
import { WORLDS, LOOKS, earthClouds, poleOf } from './orrery3d.js?v=24';
import { Globe, loadTexture, frameFromPole, v3 } from './globe.js?v=24';
import { SKY_BODIES } from './catalog.js?v=24';
import { sensorState, primeLocation } from './sensors.js?v=24';

const LY = 9.4607e15;          // metres in a light-year
const AU = 1.495978707e11;     // metres in an astronomical unit
const RE = 6.371e6;            // Earth's radius, metres
const RM = 1.737e6;            // the Moon's radius, metres
const MW_DIAM = 9.46e20;       // the Milky Way: about 100,000 light-years across
const SUN_R_MW = 2.46e20;      // the Sun: about 26,000 light-years from the galactic centre
const SUN_ANGLE = 0.6;         // where on the Milky Way's disc the Sun is (picture only)
const Z_MIN = 7.0;             // about 10,000 km across: all of Earth, and you
const Z_MAX = 27.3;            // the whole observable universe, about 9e26 m across
const DEG = Math.PI / 180;

// Scenes, finest first. f_lo..f_hi is where the scene is fully shown; it fades
// over 0.9 of a step on each side.
const SCENES = [
  { id: 'earth', name: 'The Earth', f_lo: 7.0, f_hi: 8.4,
    caption: 'Earth, with the pin on where you are right now. This closest picture is about 10,000 km across, with you at its centre, and it is as close as the globe can go.' },
  { id: 'earthmoon', name: 'Earth and the Moon', f_lo: 9.0, f_hi: 11.6,
    caption: 'The Moon goes round Earth at about 384,000 km — roughly thirty Earths laid side by side.' },
  { id: 'solar', name: 'The solar system', f_lo: 13.4, f_hi: 15.9,
    caption: 'The Sun and its planets, at their real distances this moment. Neptune is about thirty times farther from the Sun than the Earth is.' },
  { id: 'near', name: 'Stars near us', f_lo: 17.2, f_hi: 19.2,
    caption: 'Stars close to the Sun, at their real distances (in light-years). Light from Rigil Kentaurus, the nearest bright one, takes 4.4 years to reach us.' },
  { id: 'milky', name: 'The Milky Way', f_lo: 20.0, f_hi: 21.6,
    caption: 'Our galaxy, about 100,000 light-years across, with a few hundred billion stars. The Sun is one of them, about 26,000 light-years from the centre.' },
  { id: 'local', name: 'The Local Group', f_lo: 22.3, f_hi: 24.2,
    caption: 'A small family of galaxies: our Milky Way and Andromeda, about 2.5 million light-years apart, and some smaller ones. Shapes and numbers are illustrative.' },
  { id: 'universe', name: 'The universe', f_lo: 25.0, f_hi: 99,
    caption: 'The observable universe holds about two trillion galaxies. Each dot here stands for a whole cluster; this is a small slice, and the Milky Way is somewhere in it.' },
];

// ---- helpers ----
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const smooth = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
// Scenes hand over at fixed boundaries (finest first). Across each boundary the
// finer scene fades out while the coarser one fades in, over the same window, so
// the two always add up to one. (The old per-scene fades left a gap between the
// solar system and the Earth and Moon, where both were faint — the picture went
// transparent.)
const BOUNDARIES = [8.6, 12.6, 16.5, 19.6, 22.1, 24.6]; // between SCENES[k] and SCENES[k+1]
const HANDOVER = 1.2;                                  // width of each cross-fade, in steps of Z
function sceneAlphas(Z) {
  return SCENES.map((_, k) => {
    const lo = k === 0 ? 1 : smooth((Z - BOUNDARIES[k - 1] + HANDOVER / 2) / HANDOVER);
    const hi = k === SCENES.length - 1 ? 1 : 1 - smooth((Z - BOUNDARIES[k] + HANDOVER / 2) / HANDOVER);
    return lo * hi;
  });
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (rnd) => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());

// Metres → a readable distance, in the unit a reader would use.
function fmtDist(m) {
  const ly = m / LY;
  if (ly >= 1e9) return `${(ly / 1e9).toFixed(ly / 1e9 < 10 ? 1 : 0)} billion light-years`;
  if (ly >= 1e6) return `${(ly / 1e6).toFixed(ly / 1e6 < 10 ? 1 : 0)} million light-years`;
  if (ly >= 1000) return `${Math.round(ly).toLocaleString('en-US')} light-years`;
  if (ly >= 0.5) return `${ly.toFixed(ly < 10 ? 1 : 0)} light-years`;
  if (m >= 1e11) return `${Math.round(m / AU).toLocaleString('en-US')} AU`;
  if (m >= 1e5) return `${Math.round(m / 1000).toLocaleString('en-US')} km`;
  return `${Math.round(m)} m`;
}

// A round scale-bar length near a quarter of the picture.
function niceLength(m) {
  const p = Math.pow(10, Math.floor(Math.log10(m)));
  const n = m / p;
  return (n >= 5 ? 5 : n >= 2 ? 2 : 1) * p;
}

// ---- state ----
let root = null, canvas = null, ctx = null, W = 0, H = 0, dpr = 1;
let Z = Z_MAX, target = Z_MAX; // start at the universe, and zoom in toward you
let raf = 0, lastT = 0, labelKey = '';
let uniPts = null, spiral = null, neighbours = null, planetOrbits = null;
let snapshot = { t: 0, planets: null, moon: null, moonPath: null, earthHelio: null };
let globeGL = null, earthTex = null;
let dragging = false, pinch = null;

// ---- generated pictures (fixed, so the zoom is stable) ----
function makeUniverse() {
  const rnd = mulberry32(7);
  const pts = [];
  for (let c = 0; c < 70; c++) {
    const cx = rnd() - 0.5, cy = rnd() - 0.5;
    for (let k = 0; k < 26; k++) {
      pts.push({ x: cx + gauss(rnd) * 0.035, y: cy + gauss(rnd) * 0.035, s: 0.8 + rnd() * 0.9, b: 0.4 + rnd() * 0.6 });
    }
  }
  for (let k = 0; k < 320; k++) pts.push({ x: rnd() - 0.5, y: rnd() - 0.5, s: 0.7 + rnd() * 0.6, b: 0.25 + rnd() * 0.4 });
  return pts;
}

function makeSpiral() {
  const rnd = mulberry32(3);
  const pts = [];
  for (let i = 0; i < 2600; i++) {
    const r = Math.pow(rnd(), 0.8);
    const arm = rnd() < 0.5 ? 0 : Math.PI;
    const th = arm + 3.6 * Math.log(1 + 6 * r) + gauss(rnd) * 0.32;
    pts.push({ x: r * Math.cos(th), y: r * Math.sin(th), b: 0.3 + 0.7 * rnd() });
  }
  for (let i = 0; i < 500; i++) {
    const r = rnd() * 0.16;
    const th = rnd() * Math.PI * 2;
    pts.push({ x: r * Math.cos(th), y: r * Math.sin(th), b: 0.6 + 0.4 * rnd() });
  }
  return pts;
}

// The Local Group, in metres from the Milky Way's centre (positions illustrative).
function makeLocalGroup() {
  const rnd = mulberry32(11);
  const list = [
    { x: 0, y: 0, d: MW_DIAM, kind: 'spiral', name: 'Milky Way' },
    { x: 1.9e22, y: 1.5e22, d: 2.2e21, kind: 'spiral', name: 'Andromeda' },
    { x: 1.6e22, y: 2.3e22, d: 1.2e21, kind: 'spiral', name: 'Triangulum' },
  ];
  for (let k = 0; k < 10; k++) {
    const a = rnd() * Math.PI * 2, r = (0.4 + 0.6 * rnd()) * 3.2e22;
    list.push({ x: r * Math.cos(a), y: r * Math.sin(a), d: 2e20 + rnd() * 4e20, kind: 'blob', name: '' });
  }
  return list;
}

// Stars near the Sun, from the real catalogue, placed by their real distance
// and direction (viewed from above the sky's equator).
async function loadNeighbours() {
  try {
    const res = await fetch('data/stars.json');
    const data = await res.json();
    neighbours = data.stars
      .filter((s) => typeof s.distanceLy === 'number' && s.distanceLy <= 60)
      .map((s) => {
        const ra = s.ra * 15 * DEG, dec = s.dec * DEG, d = s.distanceLy * LY;
        return { name: s.name, color: s.color || '#f2f6ff', x: d * Math.cos(dec) * Math.cos(ra), y: d * Math.cos(dec) * Math.sin(ra), ly: s.distanceLy };
      });
  } catch {
    neighbours = [];
  }
}

// ---- drawing helpers ----
function galaxy(sx, sy, diam, ppm, a, kind) {
  const r = (diam / 2) * ppm;
  if (sx + r < -4 || sx - r > W + 4 || sy + r < -4 || sy - r > H + 4) return;
  ctx.globalAlpha = a;
  if (r < 2 || kind === 'blob') {
    const rr = Math.max(1.6, r);
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, rr * 2.2);
    g.addColorStop(0, 'rgba(230,230,255,0.9)');
    g.addColorStop(0.4, 'rgba(180,190,240,0.3)');
    g.addColorStop(1, 'rgba(160,170,230,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - rr * 2.2, sy - rr * 2.2, rr * 4.4, rr * 4.4);
    return;
  }
  if (r < 10) {
    const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 1.4);
    g.addColorStop(0, 'rgba(235,235,255,0.95)');
    g.addColorStop(0.5, 'rgba(180,190,240,0.35)');
    g.addColorStop(1, 'rgba(160,170,230,0)');
    ctx.fillStyle = g;
    ctx.fillRect(sx - r * 1.4, sy - r * 1.4, r * 2.8, r * 2.8);
    return;
  }
  ctx.fillStyle = '#dfe6ff';
  for (const p of spiral) {
    ctx.globalAlpha = a * p.b;
    ctx.fillRect(sx + p.x * r, sy + p.y * r, 1, 1);
  }
  const g = ctx.createRadialGradient(sx, sy, 0, sx, sy, r * 0.28);
  g.addColorStop(0, 'rgba(255,240,210,0.9)');
  g.addColorStop(1, 'rgba(255,220,170,0)');
  ctx.globalAlpha = a;
  ctx.fillStyle = g;
  ctx.fillRect(sx - r * 0.28, sy - r * 0.28, r * 0.56, r * 0.56);
  ctx.globalAlpha = 1;
}

function glowDot(x, y, r, color, a) {
  ctx.globalAlpha = a;
  const g = ctx.createRadialGradient(x, y, 0, x, y, r * 3);
  g.addColorStop(0, color);
  g.addColorStop(0.25, color);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r * 3, y - r * 3, r * 6, r * 6);
  ctx.globalAlpha = 1;
}

// Labels are drawn only where they don't overprint one already placed this frame,
// so crowded scenes (the planets close to the Sun) stay readable.
let placed = [];
function label(text, x, y, a, size = 11, weight = 600, color = 'rgba(233,233,237,0.9)') {
  if (!text || a < 0.05) return;
  ctx.font = `${weight} ${size}px Inter, system-ui, sans-serif`;
  const w = ctx.measureText(text).width;
  const box = [x - 2, y - size * 0.7, x + w + 2, y + size * 0.7];
  if (placed.some((q) => box[0] < q[2] && box[2] > q[0] && box[1] < q[3] && box[3] > q[1])) return;
  placed.push(box);
  ctx.globalAlpha = a;
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.globalAlpha = 1;
}

// ---- scenes ----
function drawUniverse(cx, cy, ppm, a) {
  ctx.fillStyle = '#e4eaff';
  const S = 1e27 * ppm;
  for (const p of uniPts) {
    const x = cx + p.x * S, y = cy + p.y * S;
    if (x < -2 || x > W + 2 || y < -2 || y > H + 2) continue;
    ctx.globalAlpha = a * p.b;
    ctx.fillRect(x, y, p.s, p.s);
  }
  ctx.globalAlpha = 1;
}

function drawLocal(cx, cy, ppm, a) {
  for (const g of LOCAL) {
    const sx = cx + g.x * ppm, sy = cy - g.y * ppm;
    galaxy(sx, sy, g.d, ppm, a, g.kind);
    if (g.name) label(g.name, sx + 8, sy - 8, a, 11);
  }
}

function drawMilkyWay(cx, cy, ppm, a) {
  const sunX = SUN_R_MW * Math.cos(SUN_ANGLE), sunY = SUN_R_MW * Math.sin(SUN_ANGLE);
  // Origin: the Sun. The galaxy's centre sits off to one side of the screen.
  const gx = cx - sunX * ppm, gy = cy + sunY * ppm;
  galaxy(gx, gy, MW_DIAM, ppm, a, 'spiral');
  label('Galactic centre', gx + 10, gy - 6, a * 0.8, 10, 500, 'rgba(255,230,190,0.7)');
  glowDot(cx, cy, 3, '#ffe9a8', a);
  label('The Sun', cx + 10, cy - 8, a, 11, 700, '#ffe9a8');
}

function drawNear(cx, cy, ppm, a) {
  if (!neighbours) return;
  for (const ring of [5, 10, 20, 50]) {
    ctx.globalAlpha = a * 0.5;
    ctx.setLineDash([3, 5]);
    ctx.strokeStyle = 'rgba(180,190,240,0.5)';
    ctx.beginPath(); ctx.arc(cx, cy, ring * LY * ppm, 0, Math.PI * 2); ctx.stroke();
    ctx.setLineDash([]);
    label(`${ring} ly`, cx + ring * LY * ppm * 0.71 + 4, cy - ring * LY * ppm * 0.71, a * 0.7, 9, 500, 'rgba(200,205,240,0.7)');
  }
  ctx.globalAlpha = 1;
  for (const s of neighbours) {
    const x = cx + s.x * ppm, y = cy - s.y * ppm;
    if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
    glowDot(x, y, 2.2, s.color, a);
    label(`${s.name}`, x + 6, y - 6, a, 10, 600);
  }
  glowDot(cx, cy, 3, '#ffe9a8', a);
  label('The Sun', cx + 8, cy - 8, a, 10, 700, '#ffe9a8');
}

function drawSolar(cx, cy, ppm, a, now) {
  if (!planetOrbits) return;
  refreshSnapshot(now);
  for (const o of planetOrbits) {
    ctx.beginPath();
    o.pts.forEach((p, k) => {
      const x = cx + p[0] * AU * ppm, y = cy - p[1] * AU * ppm;
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.closePath();
    ctx.globalAlpha = a * 0.35;
    ctx.strokeStyle = 'rgba(210,215,240,0.9)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  glowDot(cx, cy, 4, '#ffd27a', a);
  for (const p of snapshot.planets) {
    const x = cx + p.v[0] * AU * ppm, y = cy - p.v[1] * AU * ppm;
    glowDot(x, y, 2, p.color, a * 0.9);
    label(p.name, x + 6, y + 3, a, 10, 600);
  }
  label('The Sun', cx + 8, cy - 8, a, 10, 700, '#ffe9a8');
}

function drawEarthMoon(cx, cy, ppm, a, now) {
  refreshSnapshot(now);
  // The Moon's orbit, from the ephemeris.
  ctx.beginPath();
  snapshot.moonPath.forEach((p, k) => {
    const x = cx + p[0] * AU * ppm, y = cy - p[1] * AU * ppm;
    if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  });
  ctx.closePath();
  ctx.globalAlpha = a * 0.5;
  ctx.strokeStyle = 'rgba(210,215,240,0.8)';
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 4]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
  // Earth, a little lit disc.
  const re = Math.max(3, RE * ppm);
  const g = ctx.createRadialGradient(cx - re * 0.3, cy - re * 0.3, re * 0.1, cx, cy, re);
  g.addColorStop(0, '#9fd3ff');
  g.addColorStop(0.6, '#2d6fb5');
  g.addColorStop(1, '#17416e');
  ctx.globalAlpha = a;
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(cx, cy, re, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  label('Earth', cx + re + 6, cy + 4, a, 10, 700);
  const m = snapshot.moon;
  const mx = cx + m[0] * AU * ppm, my = cy - m[1] * AU * ppm;
  glowDot(mx, my, Math.max(1.6, RM * ppm), '#dfe3ea', a);
  label('Moon', mx + 8, my + 4, a, 10, 600);
}

function drawEarth(cx, cy, ppm, a, now) {
  const r = RE * ppm;
  if (!earthTex.ready) return;
  refreshSnapshot(now); // the Earth's own position, when this scene is shown alone
  // Earth's day side from the real direction of the Sun, and its spin from
  // Greenwich sidereal time, so the continents sit where they really are.
  const theta = siderealHours(now) * 15 * DEG;
  const pole = poleOf('earth');
  const g = eqjVecToEcl([Math.cos(theta), Math.sin(theta), 0]);
  const X = v3.cross(pole, g), Y = pole, Z3 = g; // body axes: east, north, Greenwich
  const sunE = v3.norm(v3.scale(snapshot.earthHelio, -1));
  const sunB = [v3.dot(sunE, X), v3.dot(sunE, Y), v3.dot(sunE, Z3)];

  // The user's point, seen face-on, with north up on the screen.
  const phi = userLat() * DEG, lam = userLon() * DEG;
  const P = [Math.cos(phi) * Math.sin(lam), Math.sin(phi), Math.cos(phi) * Math.cos(lam)];
  let up = [-Math.sin(phi) * P[0], 1 - Math.sin(phi) * P[1], -Math.sin(phi) * P[2]];
  up = v3.norm(up);
  const right = v3.cross(up, P);
  const rows = [right, up, P];
  const px = Math.min(300, Math.max(24, Math.round(2 * Math.min(r, 3000) * dpr)));
  globeGL.resize(px);
  globeGL.setOrientation([right[0], up[0], P[0]], [right[1], up[1], P[1]], [right[2], up[2], P[2]]);
  const light = rows.map((row) => v3.dot(row, sunB));
  const ll = v3.norm(light);
  globeGL.render({
    tex: earthTex, light: ll, ambient: 0.13, atmo: LOOKS.earth.atmo, ocean: true,
    clouds: { map: earthClouds(), turns: (now.getTime() / 1000 / 240) % 1, alpha: 0.8 },
  });
  const draw = Math.min(r, 4000);
  ctx.globalAlpha = a;
  ctx.drawImage(globeGL.canvas, cx - draw, cy - draw, 2 * draw, 2 * draw);
  // The air's blue edge all round, so the night side still reads as a planet.
  const halo = ctx.createRadialGradient(cx, cy, draw * 0.96, cx, cy, draw * 1.06);
  halo.addColorStop(0, 'rgba(120,180,255,0.0)');
  halo.addColorStop(0.5, 'rgba(120,180,255,0.35)');
  halo.addColorStop(1, 'rgba(120,180,255,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(cx, cy, draw * 1.06, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  // The pin: where you are, right now.
  ctx.globalAlpha = a;
  ctx.strokeStyle = '#ffd7a0';
  ctx.fillStyle = '#ffd7a0';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 3, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 1;
  label('You are here', cx, cy - 18, a, 12, 700, '#ffe9c8');
  const la = `${Math.abs(userLat()).toFixed(2)}° ${userLat() >= 0 ? 'N' : 'S'}, ${Math.abs(userLon()).toFixed(2)}° ${userLon() >= 0 ? 'E' : 'W'}`;
  label(la, cx, cy + 22, a * 0.9, 10, 500, 'rgba(255,230,200,0.8)');
}

// ---- positions that change with time (refreshed about once a second) ----
function refreshSnapshot(now) {
  if (now.getTime() - snapshot.t < 1000 && snapshot.planets) return;
  snapshot.t = now.getTime();
  snapshot.planets = Object.entries(WORLDS).map(([id, w]) => ({
    name: SKY_BODIES[id].name,
    color: SKY_BODIES[id].light || '#ffffff',
    v: helioEcliptic(w.body, now),
  }));
  snapshot.moon = moonEcliptic(now);
  snapshot.moonPath = moonOrbitSamples(now, 120);
  snapshot.earthHelio = helioEcliptic('Earth', now);
}

function userLat() { if (!sensorState.hasLocation) primeLocation(); return sensorState.lat ?? 32.0853; }
function userLon() { if (!sensorState.hasLocation) primeLocation(); return sensorState.lon ?? 34.7818; }

// Built once: the planets' orbits, from the ephemeris (their shapes barely change).
function buildOrbits() {
  planetOrbits = Object.values(WORLDS).map((w) => ({
    pts: orbitPath(w.body, w.period, new Date(), 200),
  }));
}

// The Local Group list, built once.
let LOCAL = null;

// ---- one frame ----
function frame(now) {
  raf = requestAnimationFrame(frame);
  if (!root || !root.isConnected) return;
  const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0;
  lastT = now;
  if (!dragging && !pinch) Z += (target - Z) * Math.min(1, dt * 4);
  if (Math.abs(target - Z) < 1e-4) Z = target;
  syncSize();
  draw(new Date());
}

function syncSize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (w === W && h === H && dpr === Math.min(window.devicePixelRatio || 1, 2)) return;
  W = w; H = h;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function draw(now) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#070912';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  placed = [];

  const minDim = Math.min(W, H);
  const ppm = minDim / Math.pow(10, Z); // pixels per metre
  const cx = W / 2, cy = H / 2;

  const alphas = sceneAlphas(Z);
  for (let k = 0; k < SCENES.length; k++) {
    const a = alphas[k];
    if (a < 0.01) continue;
    const id = SCENES[k].id;
    if (id === 'universe') drawUniverse(cx, cy, ppm, a);
    else if (id === 'local') drawLocal(cx, cy, ppm, a);
    else if (id === 'milky') drawMilkyWay(cx, cy, ppm, a);
    else if (id === 'near') drawNear(cx, cy, ppm, a);
    else if (id === 'solar') drawSolar(cx, cy, ppm, a, now);
    else if (id === 'earthmoon') drawEarthMoon(cx, cy, ppm, a, now);
    else if (id === 'earth') drawEarth(cx, cy, ppm, a, now);
  }

  // The scale bar: a round length about a quarter of the picture.
  const span = Math.pow(10, Z);
  const bar = niceLength(span / 4);
  const bw = bar * ppm;
  ctx.fillStyle = 'rgba(233,233,237,0.85)';
  // Under the title, clear of the buttons and the caption.
  const sy = 138;
  ctx.fillRect(16, sy, bw, 2);
  ctx.fillRect(16, sy - 4, 2, 6);
  ctx.fillRect(16 + bw - 2, sy - 4, 2, 6);
  label(fmtDist(bar), 16 + bw + 8, sy + 1, 1, 11, 600);

  // Which scene is most in view, named and described.
  let best = 0;
  for (let k = 1; k < SCENES.length; k++) if (alphas[k] > alphas[best]) best = k;
  const s = SCENES[best];
  const key = `${s.id}|${fmtDist(span)}`;
  if (key !== labelKey) {
    labelKey = key;
    root.querySelector('#zoom-name').textContent = s.name;
    root.querySelector('#zoom-width').textContent = `Across this picture: ${fmtDist(span)}`;
    root.querySelector('#zoom-caption').textContent = s.caption;
  }
  const slider = root.querySelector('#zoom-slider');
  if (slider && !dragging) slider.value = Math.round(((Z_MAX - Z) / (Z_MAX - Z_MIN)) * 1000);
}

// ---- mounting ----
export function mountZoom(container) {
  unmountZoom();
  root = container;
  root.innerHTML = `
    <div class="zoom-wrap">
      <canvas id="zoom-canvas" class="zoom-canvas" aria-label="A picture that zooms from the universe down to you"></canvas>
      <div class="zoom-top">
        <div id="zoom-name" class="zoom-name"></div>
        <div id="zoom-width" class="zoom-width"></div>
      </div>
      <div class="zoom-bottom">
        <p id="zoom-caption" class="zoom-caption"></p>
        <div class="zoom-controls">
          <button id="zoom-out" class="ctrl-btn" aria-label="Zoom out"><i class="ph-fill ph-minus"></i></button>
          <input id="zoom-slider" type="range" min="0" max="1000" value="0" aria-label="Zoom from the universe to you">
          <button id="zoom-in" class="ctrl-btn" aria-label="Zoom in"><i class="ph-fill ph-plus"></i></button>
        </div>
        <div class="zoom-presets">
          <button id="zoom-start" class="lesson-pill"><i class="ph-fill ph-planet"></i> The universe</button>
          <button id="zoom-home" class="lesson-pill"><i class="ph-fill ph-map-pin"></i> Take me home</button>
        </div>
      </div>
    </div>`;
  canvas = root.querySelector('#zoom-canvas');
  ctx = canvas.getContext('2d');
  W = H = 0;
  Z = target = Z_MAX;
  labelKey = '';
  lastT = 0;
  snapshot = { t: 0, planets: null, moon: null, moonPath: null, earthHelio: null };
  if (!uniPts) uniPts = makeUniverse();
  if (!spiral) spiral = makeSpiral();
  if (!LOCAL) LOCAL = makeLocalGroup();
  if (!planetOrbits) buildOrbits();
  if (!neighbours) loadNeighbours();
  if (!earthTex) earthTex = loadTexture(SKY_BODIES.earth.texture);
  if (!globeGL) globeGL = new Globe(64);
  if (!sensorState.hasLocation) primeLocation();

  const setTarget = (z, animate = true) => {
    target = Math.max(Z_MIN, Math.min(Z_MAX, z));
    if (!animate) Z = target;
  };
  const slider = root.querySelector('#zoom-slider');
  slider.addEventListener('input', () => {
    Z = target = Z_MAX - (parseInt(slider.value, 10) / 1000) * (Z_MAX - Z_MIN);
  });
  root.querySelector('#zoom-in').addEventListener('click', () => setTarget(target - 0.9));
  root.querySelector('#zoom-out').addEventListener('click', () => setTarget(target + 0.9));
  root.querySelector('#zoom-start').addEventListener('click', () => setTarget(Z_MAX));
  root.querySelector('#zoom-home').addEventListener('click', () => setTarget(Z_MIN));

  // Wheel and trackpad: zooming in or out by how far you scroll.
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    setTarget(target + e.deltaY * 0.004);
  }, { passive: false });

  // Two fingers: pinch to zoom, by how far apart they are.
  const pts = new Map();
  canvas.addEventListener('pointerdown', (e) => {
    try { canvas.setPointerCapture(e.pointerId); } catch { /* synthetic input */ }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: Z };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d > 10) { Z = target = Math.max(Z_MIN, Math.min(Z_MAX, pinch.z - Math.log10(d / pinch.d))); }
    }
  });
  const release = (e) => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  raf = requestAnimationFrame(frame);
}

export function unmountZoom() {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  root = null;
  pinch = null;
}
