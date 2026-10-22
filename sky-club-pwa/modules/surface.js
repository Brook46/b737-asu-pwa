// surface.js — "Visit another world": stand on the Moon or on Mars and look at the
// sky. Drawn on one 2-D canvas, with Zip beside you in a space helmet.
//
// What is true here, and what is only a picture:
//   • The Moon's sky is black even at midday (no air to scatter light), the stars
//     do not twinkle, the Sun is small and hard-edged.
//   • Earth hangs in the Moon's sky and, from the near side, never moves (the Moon
//     always shows the same face). Its PHASE is real: it is the opposite of the
//     Moon's phase (New Moon from Earth = full Earth from the Moon). It spins once
//     a day. Earth is drawn about 4× as wide as the Sun, as it really appears.
//   • Earthrise only happens to a spacecraft circling the Moon (Apollo 8, 1968),
//     never to someone standing on the near side. That mode says so.
//   • Mars: butterscotch sky by day, BLUE round the Sun at sunrise and sunset (dust
//     scatters red light away from the Sun's direction). A Mars day is 24 h 40 min.
//   • The landscape (rocks, craters, hills) is invented scenery, not a real place.

import { Globe, loadTexture, frameFromPole } from './globe.js?v=28';
import { moonPhase } from './astro.js?v=28';
import { earthClouds } from './orrery3d.js?v=28';
import { SKY_BODIES } from './catalog.js?v=28';
import { robotSVG } from './robot.js?v=28';
import { liftPlay } from './lessonui.js?v=28';

const DEG = Math.PI / 180;
const SYNODIC = 29.530588;
const MARS_SOL = 24.66; // hours in a Mars day
const clamp01 = (t) => Math.max(0, Math.min(1, t));
const smoothstep = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const mix = (a, b, t) => a + (b - a) * t;
const rgb = (r, g, b, a = 1) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s += 0x6d2b79f5; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---- scenery, generated once and always the same -----------------------------
const R1 = rng(7);
const STARS = Array.from({ length: 300 }, () => ({ x: R1(), y: R1() ** 1.4, b: 0.35 + R1() * 0.65, r: R1() < 0.1 ? 1.5 : 0.8, ph: R1() * 6.28 }));
const ROCKS = Array.from({ length: 16 }, () => ({ u: R1(), v: 0.08 + R1() * 0.92, s: 0.6 + R1() * 1.2, k: R1() }));
const CRATERS = Array.from({ length: 9 }, () => ({ u: R1(), v: 0.12 + R1() * 0.55, s: 0.7 + R1() * 1.4 }));
const OCRATERS = Array.from({ length: 150 }, () => ({ u: R1(), v: R1(), s: 0.4 + R1() ** 2 * 1.8, h: R1() }));
const ridge = (x, seed, amp) => amp * (0.55 * Math.sin(x * 3.1 + seed) + 0.3 * Math.sin(x * 7.7 + seed * 2.3) + 0.15 * Math.sin(x * 17.9 + seed * 5.1));

// ---- state ----------------------------------------------------------------------
let ctx = null, canvas = null, W = 0, H = 0, dpr = 1;
let earthGL = null, earthTex = null;
let raf = 0, last = 0;
const S = { world: 'moon', earthrise: false, age: 0, hour: 15.5, rise: 0.4, scroll: 0, playing: false };

function sizeStage() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return false;
  W = w; H = h;
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (canvas.width !== pw || canvas.height !== ph) { canvas.width = pw; canvas.height = ph; }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return true;
}

const todayAge = () => (moonPhase(new Date()) / 360) * SYNODIC;

// ---- Earth, as seen from the Moon -------------------------------------------------
// ageDays sets the phase (opposite of the Moon's); the globe spins once per day.
function drawEarthInSky(cx, cy, er, ageDays, alpha = 1) {
  if (!earthTex.ready || er < 3) return;
  const phaseDeg = (ageDays / SYNODIC) * 360;
  const elong = phaseDeg <= 180 ? phaseDeg : 360 - phaseDeg;       // Moon's angle from the Sun
  const side = ageDays < SYNODIC / 2 ? -1 : 1;                      // waxing: the Sun is on the left
  const L = [side * Math.sin(elong * DEG), 0.12, Math.cos(elong * DEG)];
  const n = Math.hypot(L[0], L[1], L[2]);
  const light = [L[0] / n, L[1] / n, L[2] / n];
  const pole = [0.26, 0.92, 0.29];
  const { ex, ey, ez } = frameFromPole(pole);
  earthGL.resize(Math.max(16, Math.round(2 * er * dpr)));
  earthGL.setOrientation(ex, ey, ez);
  earthGL.render({
    tex: earthTex, spin: ageDays % 1, light, ambient: 0.05, atmo: [110, 175, 255, 0.9], ocean: true, smooth: true,
    clouds: { map: earthClouds(), turns: (ageDays * 0.3) % 1, alpha: 0.8 },
  });
  ctx.save();
  ctx.globalAlpha = alpha;
  // The air's thin blue edge, all round, even where it is night.
  const halo = ctx.createRadialGradient(cx, cy, er * 0.97, cx, cy, er * 1.12);
  halo.addColorStop(0, 'rgba(120,180,255,0.0)');
  halo.addColorStop(0.45, 'rgba(120,180,255,0.30)');
  halo.addColorStop(1, 'rgba(120,180,255,0)');
  ctx.fillStyle = halo;
  ctx.beginPath(); ctx.arc(cx, cy, er * 1.12, 0, Math.PI * 2); ctx.fill();
  ctx.drawImage(earthGL.canvas, cx - er, cy - er, 2 * er, 2 * er);
  ctx.restore();
  return (1 + Math.cos(elong * DEG)) / 2; // lit share, 0..1
}

function starfield(hor, fade, twinkle, t) {
  ctx.save();
  for (const s of STARS) {
    let a = s.b * fade;
    if (twinkle) a *= 0.75 + 0.25 * Math.sin(t * 2.2 + s.ph);
    if (a < 0.02) continue;
    ctx.globalAlpha = a;
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(s.x * W, s.y * hor * 0.98, s.r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

function sun(x, y, r, tint, glow) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const g = ctx.createRadialGradient(x, y, 0, x, y, glow);
  g.addColorStop(0, rgb(tint[0], tint[1], tint[2], 0.9));
  g.addColorStop(0.12, rgb(tint[0], tint[1], tint[2], 0.35));
  g.addColorStop(1, rgb(tint[0], tint[1], tint[2], 0));
  ctx.fillStyle = g;
  ctx.fillRect(x - glow, y - glow, glow * 2, glow * 2);
  ctx.restore();
  ctx.fillStyle = '#fffbe8';
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

// ---- ground ---------------------------------------------------------------------------
// A rock: a dark body, a lit edge toward the Sun, and a shadow away from it.
function rock(x, y, size, sunX, alt, tone) {
  const lit = clamp01(alt / 12);
  if (lit > 0.02) {
    const dir = x < sunX ? 1 : -1;
    const len = size * Math.min(7, 1 / Math.tan(Math.max(alt, 3) * DEG));
    ctx.fillStyle = rgb(0, 0, 0, 0.35 * lit);
    ctx.beginPath(); ctx.ellipse(x - dir * len * 0.5, y + size * 0.18, len * 0.55 + size * 0.5, size * 0.22, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = rgb(tone[0] * 0.55, tone[1] * 0.55, tone[2] * 0.55);
  ctx.beginPath(); ctx.ellipse(x, y, size, size * 0.62, 0, 0, Math.PI * 2); ctx.fill();
  if (lit > 0.02) {
    ctx.fillStyle = rgb(tone[0] * 1.15, tone[1] * 1.15, tone[2] * 1.15, 0.85 * lit);
    const dir = x < sunX ? -1 : 1;
    ctx.beginPath(); ctx.ellipse(x - dir * size * 0.18, y - size * 0.12, size * 0.72, size * 0.4, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function drawGround(hor, o) {
  // o: { tone, bright, alt, sunX, earthTint, curve }
  const { tone, bright, alt, sunX, earthTint } = o;
  const lit = (m) => rgb(tone[0] * bright * m + earthTint[0], tone[1] * bright * m + earthTint[1], tone[2] * bright * m + earthTint[2]);
  const hy = (x) => hor + (o.curve ? o.curve * (((x - W / 2) / (W / 2)) ** 2) * H * 0.07 : 0);
  // Far hills, then nearer hills, then the plain.
  for (const [seed, amp, m, base] of [[1.3, 16, 0.78, 0.0], [4.1, 11, 0.9, 0.012]]) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += 5) ctx.lineTo(x, hy(x) - 6 - ridge(x / W * 6.28, seed, amp) * (o.curve ? 0 : 1) + base * H);
    ctx.lineTo(W, H);
    ctx.closePath();
    ctx.fillStyle = lit(m);
    ctx.fill();
  }
  const g = ctx.createLinearGradient(0, hor, 0, H);
  g.addColorStop(0, lit(1.0));
  g.addColorStop(1, lit(0.62));
  ctx.beginPath();
  ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 5) ctx.lineTo(x, hy(x) + (o.curve ? 0 : 4));
  ctx.lineTo(W, H);
  ctx.closePath();
  ctx.fillStyle = g;
  ctx.fill();
}

function drawMoonScenery(hor, o) {
  const { bright, alt, sunX, tone } = o;
  // Craters, flat ellipses with a bright rim on the sunny side.
  for (const c of CRATERS) {
    const y = hor + (H - hor) * c.v ** 1.5 + 6, x = c.u * W;
    const rx = (14 + c.v * 70) * c.s, ry = rx * 0.2;
    ctx.fillStyle = rgb(tone[0] * bright * 0.5, tone[1] * bright * 0.5, tone[2] * bright * 0.5, 0.85);
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    if (alt > 2) {
      ctx.strokeStyle = rgb(255, 250, 240, 0.35 * clamp01(alt / 15));
      ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.ellipse(x, y - 1, rx, ry, 0, Math.PI * (x < sunX ? 1.05 : 0.05), Math.PI * (x < sunX ? 1.95 : 0.95)); ctx.stroke();
    }
  }
  // Rocks take the same light as the ground: nearly black at night.
  const rt = tone.map((v) => v * (0.35 + 0.65 * bright) );
  for (const r of ROCKS) rock(r.u * W, hor + (H - hor) * r.v ** 1.6 + 8, (3 + r.v * 15) * r.s, sunX, alt, rt);
}

function zipShadow(sunX, alt) {
  const lit = clamp01(alt / 12);
  const x = W * 0.06 + 38, y = H - H * 0.055;
  if (lit < 0.02) return;
  const dir = x < sunX ? 1 : -1;
  const len = 34 * Math.min(6, 1 / Math.tan(Math.max(alt, 4) * DEG));
  ctx.fillStyle = rgb(0, 0, 0, 0.4 * lit);
  ctx.beginPath(); ctx.ellipse(x - dir * len * 0.45, y, len * 0.55 + 16, 7, 0, 0, Math.PI * 2); ctx.fill();
}

// ---- the Moon -----------------------------------------------------------------------------
function drawMoonStanding(t, info) {
  const hor = H * 0.62;
  const phi = (2 * Math.PI * (S.age - SYNODIC / 4)) / SYNODIC;       // 0 = sunrise here
  const alt = 90 * Math.sin(phi);
  const sx = W * (0.5 - 0.46 * Math.cos(phi));
  const sy = hor - Math.sin(phi) * hor * 0.8;
  const day = smoothstep(-1, 22, alt);
  ctx.fillStyle = '#01020a';
  ctx.fillRect(0, 0, W, H);
  starfield(hor, 1 - 0.55 * day, false, t);

  const er = Math.min(W, H) * 0.115;
  const lit = drawEarthInSky(W * 0.74, hor - (hor * 0.8) * (32 / 90) * 1.15, er, S.age) ?? 0;
  ctx.font = '700 13px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(233,233,237,0.9)';
  ctx.fillText('Earth', W * 0.74, hor - (hor * 0.8) * (32 / 90) * 1.15 + er + 18);

  if (alt > -3) {
    sun(sx, sy, 8, [255, 244, 214], 70 + 40 * day);
    if (alt < 14) {
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.fillText('Sun', sx, sy - 26);
    }
  }
  const bright = 0.1 + 0.9 * smoothstep(-0.5, 30, alt);
  const et = lit * (1 - smoothstep(0, 14, alt)) * 1;
  drawGround(hor, {
    tone: [170, 168, 162], bright, alt, sunX: sx, curve: 0,
    earthTint: [4 * et, 9 * et, 20 * et],
  });
  // The very first light: a thin warm line along the hills nearest the Sun.
  if (alt > -2 && alt < 10) {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createRadialGradient(sx, hor, 0, sx, hor, W * 0.5);
    g.addColorStop(0, `rgba(255,190,110,${(0.4 * (1 - alt / 10)).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,190,110,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, hor - 30, W, 60);
    ctx.restore();
  }
  drawMoonScenery(hor, { bright, alt, sunX: sx, tone: [170, 168, 162] });
  zipShadow(sx, alt);

  info.alt = alt; info.lit = lit;
  const rising = Math.cos(phi) > 0;
  info.name = alt < -3 ? 'Moon night' : alt < 12 ? (rising ? 'Sunrise' : 'Sunset') : alt > 60 ? 'Midday' : rising ? 'Morning' : 'Afternoon';
}

// ---- Earthrise: seen from a spacecraft circling the Moon -----------------------------
function drawEarthrise(t, info) {
  const hor = H * 0.6;
  ctx.fillStyle = '#01020a';
  ctx.fillRect(0, 0, W, H);
  starfield(hor, 1, false, t);
  const er = Math.min(W, H) * 0.17;
  const ex = W * 0.58;
  const hyAt = (x) => hor + 0.9 * (((x - W / 2) / (W / 2)) ** 2) * H * 0.07;
  const e = smoothstep(0, 1, S.rise);
  const cy = hyAt(ex) + er * 1.2 - e * er * 2.9;
  const age = todayAge();
  const lit = drawEarthInSky(ex, cy, er, age) ?? 0;
  drawGround(hor, { tone: [168, 166, 160], bright: 0.78, alt: 12, sunX: -10, curve: 0.9, earthTint: [3 * lit, 8 * lit, 16 * lit] });
  // Craters slide past (the spacecraft is moving); the near ones move fastest.
  for (const c of OCRATERS) {
    const v = c.v ** 1.8;
    const speed = 0.25 + v * 1.6;
    const x = (((c.u * W - S.scroll * speed * 60) % (W + 80)) + W + 80) % (W + 80) - 40;
    const y = hyAt(x) + 4 + (H - hor) * v;
    const rx = (2 + v * 34) * c.s * 0.8, ry = rx * (0.16 + 0.22 * v);
    ctx.fillStyle = 'rgba(70,69,66,0.45)';
    ctx.beginPath(); ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,252,244,0.22)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.ellipse(x, y - 1, rx, ry, 0, Math.PI * 1.05, Math.PI * 1.95); ctx.stroke(); // the sunny rim only
  }
  // A thin edge-light along the horizon.
  ctx.strokeStyle = 'rgba(230,232,240,0.35)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = 0; x <= W; x += 6) { const y = hyAt(x); if (x) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.stroke();
  info.alt = 0; info.lit = lit; info.name = S.rise < 0.12 ? 'Waiting for Earth…' : S.rise > 0.95 ? 'Earth is up!' : 'Earthrise!';
}

// ---- Mars ----------------------------------------------------------------------------------
function drawMars(t, info) {
  const hor = H * 0.6;
  const phi = (2 * Math.PI * (S.hour - MARS_SOL / 4)) / MARS_SOL;     // 0 = sunrise
  const alt = 70 * Math.sin(phi);
  const sx = W * (0.5 - 0.4 * Math.cos(phi));
  const sy = hor - Math.sin(phi) * hor * 0.72;
  const day = smoothstep(-2, 14, alt);
  const dusk = smoothstep(-14, 0, alt) * (1 - smoothstep(0, 12, alt));
  const top = [mix(10, 176, day), mix(6, 124, day), mix(14, 86, day)];
  const low = [mix(18, 226, day), mix(10, 172, day), mix(22, 128, day)];
  const g = ctx.createLinearGradient(0, 0, 0, hor);
  g.addColorStop(0, rgb(...top));
  g.addColorStop(1, rgb(...low));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  starfield(hor, 1 - smoothstep(-16, -2, alt), true, t);
  // Sunrise and sunset are BLUE round the Sun on Mars.
  if (alt > -10 && alt < 16) {
    ctx.save();
    const k = clamp01((1 - Math.abs(alt - 3) / 13) * 1.05);
    const bg = ctx.createRadialGradient(sx, sy, 3, sx, sy, W * 0.5);
    bg.addColorStop(0, `rgba(190,215,255,${k.toFixed(3)})`);
    bg.addColorStop(0.18, `rgba(110,160,255,${(k * 0.85).toFixed(3)})`);
    bg.addColorStop(0.6, `rgba(70,105,210,${(k * 0.35).toFixed(3)})`);
    bg.addColorStop(1, 'rgba(60,90,200,0)');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, hor + 40);
    ctx.restore();
  }
  if (alt > -3) sun(sx, sy, 5.4, [255, 240, 220], 54);
  // Earth, a bright blue-white star near the Sun at dusk and dawn.
  if (alt < 8 && alt > -22) {
    const ex = sx + (Math.cos(phi) > 0 ? 1 : -1) * W * 0.2, ey = hor - hor * 0.42;
    const a = smoothstep(8, -4, alt);
    ctx.fillStyle = `rgba(190,225,255,${a.toFixed(3)})`;
    ctx.beginPath(); ctx.arc(ex, ey, 2.6, 0, Math.PI * 2); ctx.fill();
    ctx.font = '700 12px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = `rgba(233,233,237,${(a * 0.9).toFixed(3)})`;
    ctx.fillText('Earth, a bright star', ex, ey - 10);
  }
  // Dusty haze on the horizon.
  const hz = ctx.createLinearGradient(0, hor - 30, 0, hor + 4);
  hz.addColorStop(0, 'rgba(226,172,128,0)');
  hz.addColorStop(1, rgb(mix(26, 226, day), mix(14, 172, day), mix(26, 128, day), 0.8));
  ctx.fillStyle = hz;
  ctx.fillRect(0, hor - 30, W, 34);
  const bright = 0.16 + 0.84 * smoothstep(-6, 24, alt);
  drawGround(hor, { tone: [150, 84, 56], bright, alt, sunX: sx, curve: 0, earthTint: [0, 0, 0] });
  drawMoonScenery(hor, { bright, alt, sunX: sx, tone: [150, 84, 56] });
  zipShadow(sx, alt);
  info.alt = alt; info.lit = 0;
  const rising = Math.cos(phi) > 0;
  info.name = alt < -6 ? 'Mars night' : alt < 10 ? (rising ? 'Sunrise' : 'Sunset') : alt > 45 ? 'Midday' : rising ? 'Morning' : 'Afternoon';
}

// ---- lesson ----------------------------------------------------------------------------------
function zipWithHelmet() {
  const svg = robotSVG('blink');
  return svg.replace('</svg>', `
  <circle cx="60" cy="56" r="54" fill="rgba(190,225,255,0.10)" stroke="rgba(225,240,255,0.75)" stroke-width="3"/>
  <path d="M26 34 Q34 18 56 12" fill="none" stroke="rgba(255,255,255,0.7)" stroke-width="4" stroke-linecap="round"/>
</svg>`);
}

export function mountSurface(root) {
  root.innerHTML = `
    <p id="surf-lead" class="lesson-lead"></p>
    <div class="surface-tabs">
      <button id="surf-moon" class="lesson-pill is-on"><i class="ph-fill ph-moon"></i> The Moon</button>
      <button id="surf-mars" class="lesson-pill"><i class="ph-fill ph-planet"></i> Mars</button>
    </div>
    <div class="surface-stage">
      <canvas id="surf-canvas" class="lesson-canvas" style="height:340px"></canvas>
      <div id="surf-zip" class="surface-zip" aria-hidden="true"></div>
      <div id="surf-chip" class="surface-chip"></div>
    </div>
    <div class="lesson-cards">
      <div><div id="surf-a-label" class="lesson-small"></div><div id="surf-a" class="lesson-big"></div></div>
      <div><div id="surf-b-label" class="lesson-small"></div><div id="surf-b" class="lesson-big"></div></div>
    </div>
    <label class="lesson-label"><span id="surf-time-label"></span> <span id="surf-time"></span>
      <input id="surf-slider" type="range" min="0" max="1" step="0.001"></label>
    <div class="lesson-buttons">
      <button id="surf-play" class="lesson-pill"><i class="ph-fill ph-play"></i> Play</button>
      <button id="surf-rise" class="lesson-pill"><i class="ph-fill ph-planet"></i> Earthrise</button>
      <button id="surf-now" class="lesson-pill"><i class="ph-fill ph-clock"></i> Now</button>
    </div>
    <p id="surf-note" class="lesson-note"></p>`;

  canvas = root.querySelector('#surf-canvas');
  ctx = canvas.getContext('2d');
  if (!earthGL) earthGL = new Globe(64);
  if (!earthTex) earthTex = loadTexture(SKY_BODIES.earth.texture);
  root.querySelector('#surf-zip').innerHTML = zipWithHelmet();
  const q = (id) => root.querySelector(id);
  liftPlay(root, '#surf-play', { before: '.surface-stage', also: ['#surf-rise', '#surf-now'] });
  const slider = q('#surf-slider');
  S.world = 'moon'; S.earthrise = false; S.age = todayAge(); S.hour = 15.5; S.rise = 0.4; S.scroll = 0; S.playing = false;

  const LEAD = {
    moon: 'You are standing on the <b>Moon</b>! Look up: the sky is <b>black</b>, even in the day, because the Moon has no air. See Earth hanging up there? It stays put, because the Moon always shows us the same face.',
    rise: 'This is <b>Earthrise</b>: Earth coming up over the Moon, seen from a spaceship <b>flying round</b> the Moon. The astronauts of Apollo 8 saw it in 1968. If you stand on the Moon, Earth never rises.',
    mars: 'You are standing on <b>Mars</b>! The sky is butterscotch in the day, from the dust. At sunset, the sky near the Sun turns <b>blue</b>. The Sun looks smaller, and Earth is just a bright star.',
  };
  const NOTE = {
    moon: 'A day on the Moon lasts about 29½ Earth days, so sunrise is very slow. Earth is drawn about four times as wide as the Sun, as it really looks from there. Its shape is the opposite of the Moon\'s: when we see a New Moon, the Moon\'s sky has a Full Earth. The rocks and craters are only a picture.',
    rise: 'The spaceship is moving, so the ground slides past. Earth is shown with the shape it has today. The craters are only a picture, not a real place.',
    mars: 'A day on Mars is 24 hours and 40 minutes, a little longer than ours. The rocks and hills are only a picture, not a real place.',
  };

  const info = { alt: 0, lit: 0, name: '' };
  const mode = () => (S.world === 'mars' ? 'mars' : S.earthrise ? 'rise' : 'moon');

  function setSlider() {
    const m = mode();
    if (m === 'moon') { slider.max = SYNODIC; slider.step = 0.02; slider.value = S.age; }
    else if (m === 'mars') { slider.max = MARS_SOL; slider.step = 0.02; slider.value = S.hour; }
    else { slider.max = 1; slider.step = 0.005; slider.value = S.rise; }
  }
  function setUi() {
    const m = mode();
    q('#surf-moon').classList.toggle('is-on', S.world === 'moon');
    q('#surf-mars').classList.toggle('is-on', S.world === 'mars');
    q('#surf-rise').classList.toggle('is-on', S.earthrise);
    q('#surf-rise').style.display = S.world === 'moon' ? '' : 'none';
    q('#surf-lead').innerHTML = LEAD[m];
    q('#surf-note').textContent = NOTE[m];
    q('#surf-zip').style.display = m === 'rise' ? 'none' : '';
    q('#surf-time-label').textContent = m === 'moon' ? 'Day on the Moon:' : m === 'mars' ? 'Time on Mars:' : 'Earth rising:';
    q('#surf-a-label').textContent = m === 'rise' ? 'Earth' : 'The Sun is';
    q('#surf-b-label').textContent = m === 'mars' ? 'The sky is' : 'Earth looks';
    setSlider();
  }

  function readouts() {
    const m = mode();
    q('#surf-chip').textContent = info.name;
    if (m === 'rise') {
      q('#surf-a').textContent = S.rise < 0.12 ? 'Hidden' : S.rise > 0.95 ? 'Up!' : 'Rising';
      q('#surf-b-label').textContent = 'Earth looks';
    } else {
      q('#surf-a').textContent = info.alt < -1 ? 'Below the hills' : `${Math.round(info.alt)}° high`;
    }
    if (m === 'mars') {
      q('#surf-b').textContent = info.alt > 14 ? 'Butterscotch' : info.alt > -2 ? 'Blue near the Sun' : 'Dark';
      q('#surf-time').textContent = `${String(Math.floor(S.hour)).padStart(2, '0')}:${String(Math.floor((S.hour % 1) * 60)).padStart(2, '0')}`;
    } else {
      const l = Math.round(info.lit * 100);
      q('#surf-b').textContent = l > 92 ? 'Full' : l < 8 ? 'New' : `${l}% lit`;
      q('#surf-time').textContent = m === 'moon' ? `day ${Math.floor(S.age) + 1} of 29½` : `${Math.round(S.rise * 100)}%`;
    }
  }

  function render(t) {
    if (!sizeStage()) return;
    ctx.clearRect(0, 0, W, H);
    const m = mode();
    if (m === 'moon') drawMoonStanding(t, info);
    else if (m === 'rise') drawEarthrise(t, info);
    else drawMars(t, info);
    readouts();
  }

  const onInput = () => {
    const v = parseFloat(slider.value), m = mode();
    if (m === 'moon') S.age = v; else if (m === 'mars') S.hour = v; else S.rise = v;
    render(last / 1000);
  };
  slider.addEventListener('input', onInput);
  const setWorld = (w) => { S.world = w; S.earthrise = false; setUi(); render(last / 1000); };
  q('#surf-moon').addEventListener('click', () => setWorld('moon'));
  q('#surf-mars').addEventListener('click', () => setWorld('mars'));
  q('#surf-rise').addEventListener('click', () => { S.earthrise = !S.earthrise; if (S.earthrise) S.rise = 0.05; setUi(); render(last / 1000); });
  q('#surf-now').addEventListener('click', () => {
    if (mode() === 'moon') S.age = todayAge(); else if (mode() === 'mars') S.hour = 15.5; else S.rise = 0.4;
    setSlider(); render(last / 1000);
  });
  const play = q('#surf-play');
  play.addEventListener('click', () => {
    S.playing = !S.playing;
    play.innerHTML = S.playing ? '<i class="ph-fill ph-pause"></i> Pause' : '<i class="ph-fill ph-play"></i> Play';
  });

  const tick = (now) => {
    if (!root.isConnected || !document.getElementById('lesson-screen').classList.contains('active')) return;
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    S.scroll += dt;
    if (S.playing) {
      const m = mode();
      if (m === 'moon') S.age = (S.age + dt * 1.2) % SYNODIC;             // a whole Moon day in about 25 s
      else if (m === 'mars') S.hour = (S.hour + dt * 1.2) % MARS_SOL;
      else { S.rise += dt / 16; if (S.rise > 1.25) S.rise = 0; }
      setSlider();
    } else if (mode() === 'rise') {
      // Even when paused the ground keeps sliding: the ship is still flying.
    }
    render(now / 1000);
  };
  setUi();
  raf = requestAnimationFrame(tick);
  window.addEventListener('resize', onInput);
  return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onInput); };
}
