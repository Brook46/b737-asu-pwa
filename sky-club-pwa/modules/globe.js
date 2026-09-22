// globe.js — real textured spheres on a plain 2-D canvas (no WebGL).
//
// Each output pixel inside the disc is a point on the sphere's visible
// hemisphere. Its surface normal is rotated into the body's own frame (north
// pole = +y) to get a latitude/longitude, which picks a texel from the
// equirectangular texture; the same normal dotted with the Sun's direction
// lights it. So a planet shows a real day side and night side, a real soft
// terminator, crescent phases when the Sun is behind it, and its real axial
// tilt — the things that make a sphere read as a world rather than a sticker.
//
// Cost: the asin/atan2 per pixel only depend on the sphere's ORIENTATION, not
// its spin (spin about the pole is a pure longitude offset), so they live in
// tables rebuilt only when the orientation changes. A frame is then a table
// lookup, a texel fetch and a few multiplies per pixel.

const texCache = new Map();
// Solar palette, dark → bright (r,g,b triples).
const SUN_PAL = [140, 38, 6, 214, 78, 14, 248, 128, 28, 255, 172, 58, 255, 214, 120, 255, 240, 196];

/** Loads an equirectangular texture into readable pixels (cached per URL). */
export function loadTexture(src) {
  if (texCache.has(src)) return texCache.get(src);
  const tex = { src, ready: false, w: 0, h: 0, data: null };
  texCache.set(src, tex);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    tex.data = x.getImageData(0, 0, img.width, img.height).data;
    tex.w = img.width; tex.h = img.height;
    tex.ready = true;
  };
  img.src = src;
  return tex;
}

// Seamless (horizontally tileable) fractal value noise, 0..1 — clouds for
// Earth, granulation for the Sun. Deterministic, generated once.
export function makeNoiseMap(w, h, seed, octaves = 5, base = 8) {
  let s = seed >>> 0;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const out = new Float32Array(w * h);
  let amp = 1, total = 0;
  for (let o = 0; o < octaves; o++) {
    const gw = base << o, gh = Math.max(2, (base << o) >> 1);
    const grid = new Float32Array(gw * (gh + 1));
    for (let i = 0; i < grid.length; i++) grid[i] = rnd();
    for (let y = 0; y < h; y++) {
      const fy = (y / h) * gh, y0 = Math.floor(fy), ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < w; x++) {
        const fx = (x / w) * gw, x0 = Math.floor(fx), tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const x1 = (x0 + 1) % gw;
        const a = grid[y0 * gw + x0], b = grid[y0 * gw + x1];
        const c = grid[(y0 + 1) * gw + x0], d = grid[(y0 + 1) * gw + x1];
        out[y * w + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
      }
    }
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return { w, h, v: out };
}

export class Globe {
  constructor(size) {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.size = 0;
    this.orientKey = '';
    this.resize(size);
  }

  resize(size) {
    size = Math.max(4, Math.round(size));
    if (size === this.size) return;
    this.size = size;
    this.canvas.width = this.canvas.height = size;
    this.image = this.ctx.createImageData(size, size);
    const n = size * size, r = size / 2;
    this.nx = new Float32Array(n); this.ny = new Float32Array(n); this.nz = new Float32Array(n);
    this.cover = new Float32Array(n); // edge antialiasing
    this.inside = [];
    for (let j = 0; j < size; j++) {
      for (let i = 0; i < size; i++) {
        const x = (i + 0.5 - r) / r, y = (r - (j + 0.5)) / r;
        const d = Math.sqrt(x * x + y * y);
        const cov = Math.max(0, Math.min(1, (1 - d) * r + 0.5));
        const k = j * size + i;
        this.cover[k] = cov;
        if (cov <= 0) continue;
        const dd = Math.min(1, d);
        const z = Math.sqrt(Math.max(0, 1 - dd * dd));
        const s = d > 1 ? 1 / d : 1;
        this.nx[k] = x * s; this.ny[k] = y * s; this.nz[k] = z;
        this.inside.push(k);
      }
    }
    this.inside = Uint32Array.from(this.inside);
    this.uTab = new Float32Array(n);
    this.vTab = new Float32Array(n);
    this.orientKey = '';
  }

  /**
   * Orientation: the body's own axes (ex, ey = north pole, ez) expressed in
   * VIEW space (x right, y up, z toward the viewer). Rebuilds the lat/lon
   * tables only when it actually changed.
   */
  setOrientation(ex, ey, ez) {
    const key = [...ex, ...ey, ...ez].map((v) => v.toFixed(4)).join(',');
    if (key === this.orientKey) return;
    this.orientKey = key;
    const { nx, ny, nz, uTab, vTab, inside } = this;
    const TWO_PI = Math.PI * 2;
    for (let q = 0; q < inside.length; q++) {
      const k = inside[q];
      const x = nx[k], y = ny[k], z = nz[k];
      const bx = x * ex[0] + y * ex[1] + z * ex[2];
      const by = x * ey[0] + y * ey[1] + z * ey[2];
      const bz = x * ez[0] + y * ez[1] + z * ez[2];
      uTab[k] = Math.atan2(bx, bz) / TWO_PI + 0.5;
      vTab[k] = 0.5 - Math.asin(Math.max(-1, Math.min(1, by))) / Math.PI;
    }
  }

  /**
   * Paints the sphere. opts:
   *   tex          loaded texture (loadTexture)
   *   spin         rotation about the pole, in turns (0..1)
   *   light        unit vector to the Sun in view space, or null = self-luminous
   *   ambient      night-side floor, 0..1
   *   limb         limb darkening strength 0..1 (gas giants, the Sun)
   *   wash         [r,g,b,a] tint toward a colour (Venus's cloud deck)
   *   atmo         [r,g,b,strength] rim glow of an atmosphere
   *   clouds       { map, turns, alpha } Earth's cloud layer
   *   ocean        true → specular sun glint on water
   *   boil         { map, t } Sun granulation shimmer
   */
  render(o) {
    const tex = o.tex;
    if (!tex || !tex.ready) return false;
    const { nx, ny, nz, uTab, vTab, cover, inside } = this;
    const px = this.image.data;
    px.fill(0);
    const tw = tex.w, th = tex.h, td = tex.data;
    const spin = o.spin || 0;
    const L = o.light;
    const amb = o.ambient ?? 0.04;
    const limb = o.limb || 0;
    const wash = o.wash;
    const atmo = o.atmo;
    const clouds = o.clouds;
    const boil = o.boil;
    // Half-vector for the ocean glint (viewer is +z).
    let hx = 0, hy = 0, hz = 1;
    if (L && o.ocean) {
      hx = L[0]; hy = L[1]; hz = L[2] + 1;
      const hn = Math.hypot(hx, hy, hz) || 1;
      hx /= hn; hy /= hn; hz /= hn;
    }
    for (let q = 0; q < inside.length; q++) {
      const k = inside[q];
      let u = uTab[k] + spin;
      u -= Math.floor(u);
      const v = vTab[k];
      const ti = ((Math.min(th - 1, (v * th) | 0) * tw) + ((u * tw) | 0)) * 4;
      let r = td[ti], g = td[ti + 1], b = td[ti + 2];
      const z = nz[k];

      if (wash) {
        r += (wash[0] - r) * wash[3]; g += (wash[1] - g) * wash[3]; b += (wash[2] - b) * wash[3];
      }
      let water = 0;
      if (o.ocean) water = b > r * 1.15 && b > g * 0.95 ? 1 : 0;
      if (clouds) {
        let cu = u + clouds.turns; cu -= Math.floor(cu);
        const m = clouds.map;
        const c = m.v[Math.min(m.h - 1, (v * m.h) | 0) * m.w + ((cu * m.w) | 0)];
        const a = Math.max(0, Math.min(1, (c - 0.47) * 3.2)) * clouds.alpha;
        r += (250 - r) * a; g += (252 - g) * a; b += (255 - b) * a;
        water *= 1 - a;
      }

      let shade;
      if (L) {
        const lam = nx[k] * L[0] + ny[k] * L[1] + z * L[2];
        // Soft terminator: the Sun is a disc, not a point, and air scatters.
        let tt = (lam + 0.08) / 0.3;
        tt = tt < 0 ? 0 : tt > 1 ? 1 : tt * tt * (3 - 2 * tt);
        shade = amb + (1 - amb) * tt * (0.35 + 0.65 * (lam > 0 ? lam : 0));
        if (water && lam > 0) {
          const sp = nx[k] * hx + ny[k] * hy + z * hz;
          if (sp > 0.9) {
            const g2 = Math.pow(sp, 60) * 180 * tt;
            r += g2; g += g2; b += g2 * 0.95;
          }
        }
        if (atmo) {
          const rim = (1 - z) * (1 - z) * atmo[3] * Math.max(0, Math.min(1, lam + 0.35));
          r = r * shade + atmo[0] * rim; g = g * shade + atmo[1] * rim; b = b * shade + atmo[2] * rim;
          shade = 1;
        }
      } else {
        shade = 1;
      }
      if (limb) shade *= 1 - limb + limb * Math.sqrt(z);
      if (boil) {
        // The Sun: brightness mapped onto a real solar palette (deep orange →
        // yellow → near-white). The raw texture's own hues included greens.
        // Contrast squeezed: the texture's big bright blotches read as cheese.
        const l = 0.34 + ((r + g + b) / 765) * 0.5;
        const pr = SUN_PAL, pi = Math.min(SUN_PAL.length / 3 - 2, Math.max(0, l * (SUN_PAL.length / 3 - 1)));
        const i0 = Math.floor(pi), f = pi - i0;
        r = pr[i0 * 3] + (pr[i0 * 3 + 3] - pr[i0 * 3]) * f;
        g = pr[i0 * 3 + 1] + (pr[i0 * 3 + 4] - pr[i0 * 3 + 1]) * f;
        b = pr[i0 * 3 + 2] + (pr[i0 * 3 + 5] - pr[i0 * 3 + 2]) * f;
        const m = boil.map;
        let bu = u * 3 + boil.t; bu -= Math.floor(bu);
        let bu2 = u * 3 - boil.t * 0.7 + 0.37; bu2 -= Math.floor(bu2);
        const row = Math.min(m.h - 1, (v * m.h) | 0) * m.w;
        const n = m.v[row + ((bu * m.w) | 0)] + m.v[row + ((bu2 * m.w) | 0)] - 1;
        shade *= 1 + n * 0.38;
        // The Sun's limb is not just darker but redder.
        g *= 0.82 + 0.18 * z; b *= 0.6 + 0.4 * z;
      }
      const o4 = k * 4;
      px[o4] = r * shade; px[o4 + 1] = g * shade; px[o4 + 2] = b * shade;
      px[o4 + 3] = 255 * cover[k];
    }
    this.ctx.putImageData(this.image, 0, 0);
    return true;
  }
}

// ---- small vector helpers shared by the 3-D code ----
export const v3 = {
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: (a) => { const n = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / n, a[1] / n, a[2] / n]; },
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
};

/** An orthonormal body frame (ex, ey = pole, ez) around a given pole. */
export function frameFromPole(pole) {
  const ey = v3.norm(pole);
  const ref = Math.abs(ey[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const ex = v3.norm(v3.cross(ey, ref));
  const ez = v3.cross(ex, ey);
  return { ex, ey, ez };
}

// ---- Saturn's rings ----
// A square texture of the ring's real radial profile, sampled from the
// generated saturn-ring.png along its major axis, so it can be drawn through
// any affine transform as a correctly projected ellipse in 3-D.
let ringTex = null;
export const RING_INNER = 1.24, RING_OUTER = 2.27; // in planet radii (C ring to A ring)
export function saturnRingTexture() {
  if (ringTex) return ringTex;
  const img = new Image();
  ringTex = { ready: false, canvas: null };
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(img, 0, 0);
    const row = x.getImageData(0, Math.floor(img.height / 2), img.width, 1).data;
    const half = img.width / 2;
    const S = 256, out = document.createElement('canvas');
    out.width = out.height = S;
    const ox = out.getContext('2d');
    const im = ox.createImageData(S, S);
    for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
      const rho = Math.hypot(i + 0.5 - S / 2, j + 0.5 - S / 2) / (S / 2); // 0..1 = outer edge
      if (rho > 1) continue;
      const sx = Math.min(img.width - 1, Math.round(half + rho * (half - 1)));
      const p = sx * 4, q = (j * S + i) * 4;
      im.data[q] = row[p]; im.data[q + 1] = row[p + 1]; im.data[q + 2] = row[p + 2]; im.data[q + 3] = row[p + 3];
    }
    ox.putImageData(im, 0, 0);
    ringTex.canvas = out;
    ringTex.ready = true;
  };
  img.src = 'icons/textures/saturn-ring.png';
  return ringTex;
}

/**
 * Draws one half of a ring (back = the half farther from the viewer, drawn
 * before the globe; front after it). `su`/`sv` are the screen-space vectors of
 * the ring plane's two axes at the OUTER radius, `du`/`dv` their components
 * along the view direction (positive = away from the viewer).
 */
export function drawRingHalf(ctx, tex, cx, cy, su, sv, du, dv, back, alpha = 1) {
  if (!tex.ready) return;
  let n0 = du, n1 = dv;
  const nl = Math.hypot(n0, n1);
  if (nl < 1e-6) { n0 = 1; n1 = 0; } else { n0 /= nl; n1 /= nl; }
  if (!back) { n0 = -n0; n1 = -n1; }
  const t0 = -n1, t1 = n0;
  ctx.save();
  ctx.transform(su[0], su[1], sv[0], sv[1], cx, cy);
  ctx.beginPath();
  ctx.moveTo(t0 * 2, t1 * 2);
  ctx.lineTo(t0 * 2 + n0 * 2, t1 * 2 + n1 * 2);
  ctx.lineTo(-t0 * 2 + n0 * 2, -t1 * 2 + n1 * 2);
  ctx.lineTo(-t0 * 2, -t1 * 2);
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha *= alpha;
  ctx.drawImage(tex.canvas, -1, -1, 2, 2);
  ctx.restore();
}
