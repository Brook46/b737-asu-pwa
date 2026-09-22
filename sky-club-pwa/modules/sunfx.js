// sunfx.js — a living Sun: boiling photosphere, a fiery rim, corona streamers,
// looping prominences, and flares that throw plasma out into space.
//
// What's real about it: the photosphere is the real solar texture on a sphere
// with strong limb darkening that also REDDENS toward the edge (both true of
// the real Sun), granulation that shimmers, prominences as loops anchored at
// two footpoints on the limb (magnetic loops, which is what they are), and
// flares that brighten a spot and launch a coronal mass ejection. What's
// artistic: the timing — the real Sun does this over hours, not seconds.
//
// Used twice: full detail on the Sun's info card, and a lighter version (fewer
// spicules and prominences, smaller eruptions) in the orrery.

import { Globe, loadTexture, makeNoiseMap } from './globe.js?v=23';

const rand = (a, b) => a + Math.random() * (b - a);
const TAU = Math.PI * 2;

let boilMap = null;

export class SunFX {
  constructor(detail = 'full') {
    this.detail = detail;
    this.full = detail === 'full';
    this.globe = new Globe(64);
    this.tex = loadTexture('icons/textures/sun.jpg');
    if (!boilMap) boilMap = makeNoiseMap(192, 96, 7, 5, 16);
    this.proms = [];
    this.particles = [];
    this.flashes = [];
    this.lastT = 0;
    this.nextProm = 0;
    this.nextFlare = rand(1.5, 4);
    const n = this.full ? 150 : 70;
    this.spicules = Array.from({ length: n }, (_, i) => ({
      a: (i / n) * TAU + rand(-0.02, 0.02),
      len: rand(0.025, 0.075),
      w: rand(0.6, 1.4),
      om: rand(1.2, 3.5),
      ph: rand(0, TAU),
      hot: Math.random(),
    }));
    const m = this.full ? 22 : 12;
    this.streamers = Array.from({ length: m }, () => ({
      a: rand(0, TAU), len: rand(0.4, this.full ? 1.3 : 0.8), w: rand(0.2, 0.38),
      om: rand(0.08, 0.25), ph: rand(0, TAU), al: rand(0.025, 0.065),
    }));
    for (let i = 0; i < (this.full ? 4 : 2); i++) this.spawnProm(rand(0, 5));
  }

  spawnProm(age = 0) {
    const span = rand(0.12, this.full ? 0.34 : 0.28);
    const a0 = rand(0, TAU);
    this.proms.push({
      a0, a1: a0 + span * (Math.random() < 0.5 ? -1 : 1),
      h: rand(0.18, this.full ? 0.55 : 0.4),
      life: rand(7, 14), age,
      strands: Math.floor(rand(3, this.full ? 6 : 4)),
      wob: rand(0.6, 1.6), ph: rand(0, TAU),
    });
  }

  flare() {
    const a = rand(0, TAU);
    this.flashes.push({ a, age: 0, life: 1.6 });
    // A coronal mass ejection: a cone of plasma leaving the Sun.
    const count = this.full ? 110 : 36;
    for (let i = 0; i < count; i++) {
      const ang = a + rand(-0.32, 0.32);
      const sp = rand(0.25, this.full ? 1.1 : 0.7);
      this.particles.push({
        x: Math.cos(ang) * 1.0, y: Math.sin(ang) * 1.0,
        vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
        age: 0, life: rand(1.6, 3.8), size: rand(0.008, this.full ? 0.03 : 0.022),
      });
    }
    // Sometimes a whole prominence lets go and rides out with it.
    if (Math.random() < 0.45) {
      const p = this.proms.find((q) => q.age > 1.5 && !q.erupt);
      if (p) p.erupt = { v: rand(0.35, 0.7) };
    }
  }

  step(dt) {
    for (const p of this.proms) {
      p.age += dt;
      if (p.erupt) p.h += p.erupt.v * dt;
    }
    this.proms = this.proms.filter((p) => p.age < p.life && p.h < 3);
    this.nextProm -= dt;
    const want = this.full ? 4 : 2;
    if (this.proms.length < want && this.nextProm <= 0) { this.spawnProm(); this.nextProm = rand(1, 3); }
    this.nextFlare -= dt;
    if (this.nextFlare <= 0) { this.flare(); this.nextFlare = this.full ? rand(4, 9) : rand(8, 16); }
    for (const f of this.flashes) f.age += dt;
    this.flashes = this.flashes.filter((f) => f.age < f.life);
    for (const q of this.particles) {
      q.age += dt; q.x += q.vx * dt; q.y += q.vy * dt;
      q.vx *= 1 - 0.15 * dt; q.vy *= 1 - 0.15 * dt;
    }
    this.particles = this.particles.filter((q) => q.age < q.life);
    // A thin steady solar wind.
    if (this.full && Math.random() < dt * 6) {
      const ang = rand(0, TAU), sp = rand(0.08, 0.2);
      this.particles.push({ x: Math.cos(ang), y: Math.sin(ang), vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, age: 0, life: rand(3, 6), size: 0.006, wind: true });
    }
  }

  /** Draws the Sun centred at (cx, cy) with photosphere radius r (CSS px). */
  draw(ctx, cx, cy, r, t, dpr = 1) {
    const dt = this.lastT ? Math.min(0.1, t - this.lastT) : 0;
    this.lastT = t;
    this.step(dt);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Corona: a broad warm glow, then streamers of different lengths.
    const cg = ctx.createRadialGradient(cx, cy, r * 0.9, cx, cy, r * (this.full ? 2.6 : 2.1));
    cg.addColorStop(0, 'rgba(255,190,110,0.42)');
    cg.addColorStop(0.18, 'rgba(255,160,80,0.18)');
    cg.addColorStop(0.5, 'rgba(255,140,70,0.05)');
    cg.addColorStop(1, 'rgba(255,120,60,0)');
    ctx.fillStyle = cg;
    ctx.fillRect(cx - r * 2.7, cy - r * 2.7, r * 5.4, r * 5.4);
    for (const s of this.streamers) {
      const len = r * (1 + s.len * (0.75 + 0.25 * Math.sin(t * s.om + s.ph)));
      const a = s.a + t * 0.01;
      const w = s.w;
      const x1 = cx + Math.cos(a) * len, y1 = cy + Math.sin(a) * len;
      const g = ctx.createLinearGradient(cx, cy, x1, y1);
      const edge = r / len;
      g.addColorStop(Math.max(0, edge - 0.05), `rgba(255,210,150,${s.al})`);
      g.addColorStop(1, 'rgba(255,190,120,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a - w) * r * 0.95, cy + Math.sin(a - w) * r * 0.95);
      ctx.quadraticCurveTo(cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r * 1.3, x1, y1);
      ctx.quadraticCurveTo(cx + Math.cos(a) * r * 1.3, cy + Math.sin(a) * r * 1.3, cx + Math.cos(a + w) * r * 0.95, cy + Math.sin(a + w) * r * 0.95);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    // Photosphere — the real texture, turning slowly, boiling.
    const px = Math.min(this.full ? 420 : 200, Math.max(24, Math.round(2 * r * dpr)));
    this.globe.resize(px);
    this.globe.setOrientation([1, 0, 0], [0.12, 0.99, 0], [0, 0, 1]);
    const drawn = this.globe.render({ tex: this.tex, spin: t / 90, light: null, limb: 0.62, boil: { map: boilMap, t: t * 0.012 } });
    if (drawn) ctx.drawImage(this.globe.canvas, cx - r, cy - r, 2 * r, 2 * r);
    else {
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
      g.addColorStop(0, '#fff6d0'); g.addColorStop(0.7, '#ffb347'); g.addColorStop(1, '#e0671c');
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); ctx.fill();
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    // Chromosphere: the thin red-orange shell right at the edge.
    const rim = ctx.createRadialGradient(cx, cy, r * 0.96, cx, cy, r * 1.09);
    rim.addColorStop(0, 'rgba(255,120,40,0)');
    rim.addColorStop(0.35, 'rgba(255,110,40,0.55)');
    rim.addColorStop(1, 'rgba(255,80,30,0)');
    ctx.fillStyle = rim;
    ctx.beginPath(); ctx.arc(cx, cy, r * 1.1, 0, TAU); ctx.fill();

    // Spicules: the flickering "fire" all round the edge.
    ctx.lineCap = 'round';
    const bands = [['rgba(255,150,60,0.55)', 0, 0.55], ['rgba(255,95,35,0.5)', 0.55, 0.85], ['rgba(255,215,140,0.6)', 0.85, 1.01]];
    for (const [col, lo, hi] of bands) {
      ctx.strokeStyle = col;
      ctx.lineWidth = Math.max(0.8, r * (this.full ? 0.011 : 0.016));
      ctx.beginPath();
      for (const s of this.spicules) {
        if (s.hot < lo || s.hot >= hi) continue;
        const f = 0.55 + 0.45 * Math.sin(t * s.om + s.ph);
        const len = r * s.len * f * (0.8 + 0.4 * Math.sin(t * 0.7 + s.ph * 3));
        const ca = Math.cos(s.a), sa = Math.sin(s.a);
        ctx.moveTo(cx + ca * r * 0.99, cy + sa * r * 0.99);
        ctx.lineTo(cx + ca * (r + len), cy + sa * (r + len));
      }
      ctx.stroke();
    }

    // Prominences: glowing magnetic loops standing on the limb.
    for (const p of this.proms) {
      const fadeIn = Math.min(1, p.age / 1.8), fadeOut = Math.min(1, (p.life - p.age) / 2.2);
      const al = Math.max(0, Math.min(fadeIn, fadeOut));
      if (al <= 0) continue;
      const grow = p.erupt ? 1 : Math.min(1, p.age / 2.5);
      // Each strand is a wavering, filamentary path, not a clean arc: plasma
      // threaded along magnetic field lines, glowing hydrogen-alpha red.
      const layers = this.full
        ? [[0.11, 0.05], [0.055, 0.1], [0.026, 0.2], [0.01, 0.3]]
        : [[0.12, 0.07], [0.05, 0.16], [0.018, 0.4]];
      for (let k = 0; k < p.strands; k++) {
        const off = (k - (p.strands - 1) / 2) * 0.022;
        const a0 = p.a0 + off, a1 = p.a1 - off * 0.6;
        const am = (a0 + a1) / 2 + 0.05 * Math.sin(t * p.wob + p.ph + k);
        const h = r * (1 + 2 * p.h * grow * (1 - Math.abs(off) * 2.5) + 0.04 * Math.sin(t * 1.3 + k + p.ph));
        const x0 = cx + Math.cos(a0) * r * 0.985, y0 = cy + Math.sin(a0) * r * 0.985;
        const x1 = cx + Math.cos(a1) * r * 0.985, y1 = cy + Math.sin(a1) * r * 0.985;
        const qx = cx + Math.cos(am) * h, qy = cy + Math.sin(am) * h;
        const pts = [];
        const N = this.full ? 22 : 12;
        for (let i = 0; i <= N; i++) {
          const u = i / N, v = 1 - u;
          let x = v * v * x0 + 2 * u * v * qx + u * u * x1;
          let y = v * v * y0 + 2 * u * v * qy + u * u * y1;
          // Perpendicular jitter, zero at the footpoints, drifting with time.
          const tx = 2 * v * (qx - x0) + 2 * u * (x1 - qx), ty = 2 * v * (qy - y0) + 2 * u * (y1 - qy);
          const tl = Math.hypot(tx, ty) || 1;
          const j = r * 0.035 * Math.sin(u * Math.PI) * (Math.sin(u * 9 + t * 1.7 + k * 2.1 + p.ph) + 0.5 * Math.sin(u * 23 - t * 2.3 + k));
          x += (-ty / tl) * j; y += (tx / tl) * j;
          pts.push(x, y);
        }
        for (const [w, aa] of layers) {
          ctx.lineWidth = Math.max(0.6, r * w);
          ctx.strokeStyle = `rgba(255,${k % 2 ? 72 : 96},${k % 2 ? 48 : 60},${(aa * al).toFixed(3)})`;
          ctx.beginPath();
          ctx.moveTo(pts[0], pts[1]);
          for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
          ctx.stroke();
        }
      }
    }

    // Flares: a white-hot flash on the limb.
    for (const f of this.flashes) {
      const k = f.age / f.life;
      const fx = cx + Math.cos(f.a) * r * 0.98, fy = cy + Math.sin(f.a) * r * 0.98;
      const rad = r * (0.18 + 0.5 * k) * (this.full ? 1 : 0.7);
      const g = ctx.createRadialGradient(fx, fy, 0, fx, fy, rad);
      const a = (1 - k) * (1 - k);
      g.addColorStop(0, `rgba(255,255,245,${(0.95 * a).toFixed(3)})`);
      g.addColorStop(0.3, `rgba(255,220,150,${(0.55 * a).toFixed(3)})`);
      g.addColorStop(1, 'rgba(255,160,80,0)');
      ctx.fillStyle = g;
      ctx.fillRect(fx - rad, fy - rad, rad * 2, rad * 2);
      // The expanding shock front of the CME.
      ctx.strokeStyle = `rgba(255,200,140,${(0.35 * a).toFixed(3)})`;
      ctx.lineWidth = Math.max(0.6, r * 0.015);
      ctx.beginPath();
      ctx.arc(cx, cy, r * (1 + k * 1.2), f.a - 0.35, f.a + 0.35);
      ctx.stroke();
    }

    // Plasma leaving the Sun: short glowing streaks along each blob's motion,
    // white-hot, cooling through orange to red as it goes.
    ctx.lineCap = 'round';
    for (const q of this.particles) {
      const k = q.age / q.life;
      const a = (1 - k) * (q.wind ? 0.3 : 0.75);
      const G = Math.round(235 - 150 * k), B = Math.round(190 - 160 * k);
      const x = cx + q.x * r, y = cy + q.y * r;
      const tail = q.wind ? 0.12 : 0.22;
      ctx.strokeStyle = `rgba(255,${G},${B},${a.toFixed(3)})`;
      ctx.lineWidth = Math.max(0.7, r * q.size * (1 - 0.5 * k));
      ctx.beginPath();
      ctx.moveTo(x - q.vx * r * tail, y - q.vy * r * tail);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
    // A soft glowing cloud at the front of each eruption.
    for (const f of this.flashes) {
      const k = f.age / f.life;
      const d = r * (1.15 + k * 1.1);
      const gx = cx + Math.cos(f.a) * d, gy = cy + Math.sin(f.a) * d;
      const gr = r * (0.25 + 0.45 * k);
      const g2 = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr);
      g2.addColorStop(0, `rgba(255,170,100,${(0.22 * (1 - k)).toFixed(3)})`);
      g2.addColorStop(1, 'rgba(255,120,60,0)');
      ctx.fillStyle = g2;
      ctx.fillRect(gx - gr, gy - gr, gr * 2, gr * 2);
    }
    ctx.restore();
  }
}
