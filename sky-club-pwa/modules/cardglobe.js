// cardglobe.js — the big, realistic hero on a planet's (or the Sun's) card.
//
// The same sphere renderer as the orrery (globe.js), at card size: the real
// texture turning about the real axial tilt (Earth 23°, Saturn 27°, Uranus 98°
// — on its side — and Venus turning backwards), tipped slightly toward you so
// the pole shows, lit from one side so there is a real day/night terminator.
// Earth gets drifting clouds, a sun-glint on its oceans and a blue atmosphere;
// Saturn gets its rings, properly projected and wrapping round the globe. The
// Sun gets the full sunfx.js treatment — fire, prominences and flares.

import { Globe, loadTexture, frameFromPole, saturnRingTexture, drawRingHalf, RING_OUTER, v3 } from './globe.js?v=22';
import { SunFX } from './sunfx.js?v=22';
import { WORLDS, LOOKS, earthClouds } from './orrery3d.js?v=22';
import { SKY_BODIES } from './catalog.js?v=22';

// Real axial tilts (obliquity to the orbit), in degrees.
const TILT = { mercury: 0.03, venus: 177.4, earth: 23.44, mars: 25.19, jupiter: 3.13, saturn: 26.73, uranus: 97.77, neptune: 28.32 };
const TIP_TOWARD_VIEWER = 16; // degrees — enough to see a pole, like a globe on a desk
const LIGHT = v3.norm([-0.62, 0.28, 0.73]); // "studio" Sun: left, a little high, in front

let canvas = null, ctx = null, raf = null, active = null;
let globe = null, sun = null, ringTex = null;

export function startCardGlobe(id, wrap) {
  stopCardGlobe();
  const isSun = id === 'sun';
  const tex = isSun ? null : loadTexture(SKY_BODIES[id].texture);
  canvas = canvas || document.getElementById('card-globe');
  ctx = canvas.getContext('2d');
  const box = wrap.getBoundingClientRect();
  const base = Math.max(40, box.width);
  // The canvas is bigger than the wrap so a corona, rings and a halo have room.
  const cssSize = isSun ? base * 2.1 : id === 'saturn' ? base * 1.5 : base * 1.3;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = canvas.style.height = `${cssSize}px`;
  canvas.width = canvas.height = Math.round(cssSize * dpr);
  canvas.classList.remove('hidden');

  // Saturn's globe is drawn smaller so its rings fit on a phone screen.
  const R = isSun ? base * 0.4 : id === 'saturn' ? base * 0.31 : base / 2;
  if (isSun) sun = new SunFX('full');
  else {
    globe = globe || new Globe(64);
    globe.resize(Math.min(400, Math.round(2 * R * dpr)));
    ringTex = saturnRingTexture();
  }

  // Body frame in VIEW space: pole tilted by the real obliquity in the screen
  // plane, then tipped toward the viewer.
  const tilt = (TILT[id] || 0) * Math.PI / 180, tip = TIP_TOWARD_VIEWER * Math.PI / 180;
  const pole = [Math.sin(tilt) * Math.cos(tip), Math.cos(tilt) * Math.cos(tip), Math.sin(tip)];
  const f = frameFromPole(pole);
  active = { id, isSun, tex, R, dpr, cssSize, frame: f, look: LOOKS[id] || {}, w: WORLDS[id] };
  const loop = (now) => {
    raf = requestAnimationFrame(loop);
    draw(now / 1000);
  };
  raf = requestAnimationFrame(loop);
}

export function stopCardGlobe() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  active = null;
  if (canvas) canvas.classList.add('hidden');
}

function draw(t) {
  const a = active;
  if (!a) return;
  const { dpr, cssSize } = a;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssSize, cssSize);
  const c = cssSize / 2;
  if (a.isSun) {
    sun.draw(ctx, c, c, a.R, t, dpr);
    return;
  }
  const { R, frame: f, look } = a;

  let ring = null;
  if (a.id === 'saturn') {
    const Ro = R * RING_OUTER;
    // View space → screen: x right, y DOWN.
    ring = {
      su: [f.ex[0] * Ro, -f.ex[1] * Ro], sv: [f.ez[0] * Ro, -f.ez[1] * Ro],
      du: -f.ex[2], dv: -f.ez[2],
    };
    drawRingHalf(ctx, ringTex, c, c, ring.su, ring.sv, ring.du, ring.dv, true);
  }

  // Atmosphere glow outside the limb, strongest on the lit side.
  if (look.atmo) {
    const [ar, ag, ab, as] = look.atmo;
    const g = ctx.createRadialGradient(c + LIGHT[0] * R * 0.15, c - LIGHT[1] * R * 0.15, R * 0.92, c, c, R * 1.22);
    g.addColorStop(0, `rgba(${ar},${ag},${ab},${(0.5 * as).toFixed(3)})`);
    g.addColorStop(1, `rgba(${ar},${ag},${ab},0)`);
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(c, c, R * 1.25, 0, Math.PI * 2); ctx.fill();
  }

  globe.setOrientation(f.ex, f.ey, f.ez);
  const spin = a.w ? (a.w.sense * t) / (a.w.turnSec * 1.4) : 0;
  const ok = globe.render({
    tex: a.tex, spin, light: LIGHT, ambient: (look.ambient || 0.04) + 0.03, limb: look.limb,
    wash: look.wash, atmo: look.atmo, ocean: look.ocean,
    clouds: look.clouds ? { map: earthClouds(), turns: t / 90, alpha: 0.9 } : null,
  });
  if (ok) ctx.drawImage(globe.canvas, c - R, c - R, 2 * R, 2 * R);

  if (ring) drawRingHalf(ctx, ringTex, c, c, ring.su, ring.sv, ring.du, ring.dv, false);
}
