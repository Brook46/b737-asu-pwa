// airframe.js — a procedural 737-800W, built in code (no third-party model).
//
// Units are metres. Axes: +x forward (nose at +19.7), +y up (ground at 0),
// +z toward the RIGHT wing (No. 2 engine). The left side is the right side
// mirrored in z.
//
// Dimensions are the published 737-800 ones where they matter to the eye
// (length 39.5, span 35.8 with blended winglets, fin top 12.5, track 5.7,
// fuselage 3.76 wide); everything inside — spar positions, wheel well, E&E
// bay — is an approximation good enough to show WHERE things are, which is
// all a systems explorer needs. The geometry helpers below are exported so
// each system module can place its parts inside the real structure rather
// than at hand-typed coordinates that drift when the airframe is tuned.

import * as THREE from '../vendor/three.module.min.js?v=20';

// ── Fuselage ────────────────────────────────────────────────────────────────

export const YC = 2.95;          // fuselage centreline height
export const FUS_R = 1.88;       // half-width
export const FUS_H = 2.0;        // half-height
export const NOSE_X = 19.7;
export const TAIL_X = -19.77;
const NOSE_TAPER_X = 12.5;
const TAIL_TAPER_X = -9.5;
export const FLOOR_Y = YC - 0.62; // cabin floor

/** Fuselage cross-section at station x: centre height, half-height, half-width. */
export function fusSection(x) {
  let top = YC + FUS_H, bot = YC - FUS_H, w = FUS_R;
  if (x > NOSE_TAPER_X) {
    // 737 nose: full section until the flight deck, then a blunt, round
    // radome whose tip sits just below the centreline.
    const s = Math.min(1, (x - NOSE_TAPER_X) / (NOSE_X - NOSE_TAPER_X));
    const tip = YC - 0.3;
    const se = (p, q) => Math.pow(Math.max(0, 1 - s ** p), 1 / q);
    top = tip + (YC + FUS_H - tip) * se(2.4, 1.9);
    bot = tip - (tip - (YC - FUS_H)) * se(2.6, 2.4);
    w = FUS_R * se(2.6, 2.2);
  } else if (x < TAIL_TAPER_X) {
    const s = Math.min(1, (TAIL_TAPER_X - x) / (TAIL_TAPER_X - TAIL_X));
    top = YC + FUS_H - 0.85 * s ** 1.6;
    bot = YC - FUS_H + (FUS_H + 0.55) * s ** 1.15;
    w = FUS_R * (1 - 0.84 * s ** 1.3);
  }
  return { yc: (top + bot) / 2, hh: (top - bot) / 2, hw: w, top, bot };
}

/** A point on the fuselage skin at station x and angle th (0 = right side,
 *  90° = crown), pushed `off` metres outward. Same section shape as the mesh. */
export function fusPoint(x, thDeg, off = 0) {
  const s = fusSection(x);
  const th = (thDeg * Math.PI) / 180, k = 0.9;
  const c = Math.cos(th), sn = Math.sin(th);
  const cx = Math.sign(c) * Math.abs(c) ** k, sy = Math.sign(sn) * Math.abs(sn) ** k;
  const r = Math.hypot(s.hh * sy, s.hw * cx) || 1;
  const f = 1 + off / r;
  return [x, s.yc + s.hh * sy * f, s.hw * cx * f];
}

// ── Wing (right side; pass negative z for the left) ─────────────────────────

const SOB = 1.88;                       // side of body
const LE_ROOT_X = 3.4;
const LE_TAN = Math.tan(27 * Math.PI / 180);
const KINK_Z = 6.2;
export const TIP_Z = 17.15;
const DIHEDRAL = Math.tan(6 * Math.PI / 180);
const WING_ROOT_Y = 1.85;

export function wingLE(z) { return LE_ROOT_X - LE_TAN * (Math.abs(z) - SOB); }
export function wingTE(z) {
  const a = Math.abs(z);
  if (a <= KINK_Z) return -3.6 - (a - SOB) * (0.7 / (KINK_Z - SOB));
  return -4.3 - (a - KINK_Z) * (1.33 / (TIP_Z - KINK_Z));
}
export function wingChord(z) { return wingLE(z) - wingTE(z); }
export function wingY(z) { return WING_ROOT_Y + (Math.abs(z) - SOB) * DIHEDRAL; }
/** thickness-to-chord: 14% at the root to 10% at the tip */
export function wingTC(z) {
  const f = Math.min(1, Math.max(0, (Math.abs(z) - SOB) / (TIP_Z - SOB)));
  return 0.14 - 0.04 * f;
}
/** half-thickness of a symmetric NACA 4-digit section at chord fraction u */
export function naca(u, t) {
  const x = Math.min(1, Math.max(0, u));
  return 5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
}
/** A point in the wing: u = chord fraction from the LE, v = -1 lower skin … +1 upper skin. */
export function wingPoint(z, u, v = 0) {
  const c = wingChord(z);
  const camber = 0.018 * c * Math.sin(Math.PI * Math.min(1, Math.max(0, u)));
  return [wingLE(z) - u * c, wingY(z) + camber + v * naca(u, wingTC(z)) * c, z];
}

// ── Engines, gear, tail and bays ────────────────────────────────────────────

// CFM56-7B: inlet ~4 m ahead of the wing leading edge, fan nozzle at the LE,
// core and plug running on under the wing; ~0.45 m ground clearance.
export const ENG = { x: 5.75, y: 1.32, z: 4.95, len: 4.0, r: 1.05 };
/** A point on/in engine No. n (1 left, 2 right). a = metres aft of the inlet. */
export function engPoint(n, a, dy = 0, dz = 0) {
  const s = n === 1 ? -1 : 1;
  return [ENG.x - a, ENG.y + dy, s * ENG.z + dz];
}
export const MLG = { x: -2.9, z: 2.86, pivotY: 2.4, pivotZ: 3.0, wheelR: 0.565 };
export const NLG = { x: 13.3, pivotY: 2.0, wheelR: 0.345 };
export const APU = { x: -18.0, y: YC + 0.8 };
export const EE = { x0: 10.0, x1: 13.6, y: YC - 1.25 };      // E&E bay under the flight deck
export const WHEEL_WELL = { x0: -1.5, x1: -4.3 };
export const FLIGHT_DECK_X = 15.6;

// ── Geometry builders ───────────────────────────────────────────────────────

/** Sample a chord range with cosine spacing. */
function chordSamples(u0, u1, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const k = (1 - Math.cos(Math.PI * i / n)) / 2;
    out.push(u0 + (u1 - u0) * k);
  }
  return out;
}

/**
 * Loft an aerofoil through a list of sections. Each section:
 *   le: [x,y,z], chord, t (thickness/chord), thick: unit vector the section's
 *   "up" points along, chordDir (default -x), u0/u1 chord range, camber.
 * Sections are joined in order; both ends are capped.
 */
export function loft(sections, n = 18) {
  const rings = sections.map((s) => {
    const cd = new THREE.Vector3(...(s.chordDir || [-1, 0, 0])).normalize();
    const td = new THREE.Vector3(...s.thick).normalize();
    const le = new THREE.Vector3(...s.le);
    const us = chordSamples(s.u0 ?? 0, s.u1 ?? 1, n);
    const cam = s.camber ?? 0;
    const pt = (u, side) => {
      const h = naca(u, s.t) * side + cam * Math.sin(Math.PI * u);
      return le.clone().addScaledVector(cd, u * s.chord).addScaledVector(td, h * s.chord);
    };
    const ring = [];
    for (let i = us.length - 1; i >= 0; i--) ring.push(pt(us[i], 1));
    for (let i = (s.u0 ?? 0) === 0 ? 1 : 0; i < us.length; i++) ring.push(pt(us[i], -1));
    return ring;
  });
  return ringsToGeometry(rings, true);
}

/** Join equal-length closed rings with quads; optionally cap both ends. */
export function ringsToGeometry(rings, caps) {
  const M = rings[0].length;
  const pos = [];
  rings.forEach((r) => r.forEach((p) => pos.push(p.x, p.y, p.z)));
  const idx = [];
  for (let i = 0; i < rings.length - 1; i++) {
    for (let j = 0; j < M; j++) {
      const a = i * M + j, b = i * M + (j + 1) % M;
      const c = (i + 1) * M + (j + 1) % M, d = (i + 1) * M + j;
      idx.push(a, b, d, b, c, d);
    }
  }
  if (caps) {
    for (const [ri, flip] of [[0, true], [rings.length - 1, false]]) {
      const c = new THREE.Vector3();
      rings[ri].forEach((p) => c.add(p));
      c.multiplyScalar(1 / M);
      const ci = pos.length / 3;
      pos.push(c.x, c.y, c.z);
      for (let j = 0; j < M; j++) {
        const a = ri * M + j, b = ri * M + (j + 1) % M;
        if (flip) idx.push(ci, b, a); else idx.push(ci, a, b);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Wing section at span z for the main box between chord fractions u0..u1. */
function wingSection(z, u0 = 0, u1 = 1, tScale = 1) {
  return {
    le: [wingLE(z), wingY(z), z], chord: wingChord(z), t: wingTC(z) * tScale,
    thick: [0, 1, 0], u0, u1, camber: 0.018,
  };
}

// Fuselage mesh with UVs: u runs nose → tail, v runs round the section
// starting at the belly (θ = −90°) so the texture seam sits underneath,
// well away from the windows and doors painted on by paintLivery().
const FUS_M = 72;
const thOfV = (v) => -90 + 360 * v;
function fuselageGeometry() {
  const xs = [];
  const N = 170;
  for (let i = 0; i <= N; i++) {
    // Denser at both ends, where the shape changes fastest.
    const k = i / N, e = 0.5 - 0.5 * Math.cos(Math.PI * k);
    xs.push(NOSE_X - (NOSE_X - TAIL_X) * (0.35 * k + 0.65 * e));
  }
  const pos = [], uv = [], idx = [];
  const R = FUS_M + 1;
  xs.forEach((x, i) => {
    for (let j = 0; j < R; j++) {
      const [px, py, pz] = fusPoint(x, thOfV(j / FUS_M));
      pos.push(px, py, pz);
      uv.push((NOSE_X - x) / (NOSE_X - TAIL_X), j / FUS_M);
    }
  });
  for (let i = 0; i < xs.length - 1; i++) {
    for (let j = 0; j < FUS_M; j++) {
      const a = i * R + j, b = a + 1, c = a + R, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  // Tail cap (fan) — the nose closes to a point by itself.
  const last = (xs.length - 1) * R, s = fusSection(TAIL_X);
  const ci = pos.length / 3;
  pos.push(TAIL_X, s.yc, 0); uv.push(1, 0.5);
  for (let j = 0; j < FUS_M; j++) idx.push(ci, last + j + 1, last + j);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Angle (deg, right side) at which the skin at station x reaches height y. */
function thAtHeight(x, y) {
  const s = fusSection(x);
  const sy = Math.max(-1, Math.min(1, (y - s.yc) / s.hh));
  const a = Math.pow(Math.abs(sy), 1 / 0.9);
  return Math.sign(sy) * (Math.asin(Math.min(1, a)) * 180) / Math.PI;
}

/**
 * Paint windows and door outlines onto a canvas in the fuselage's UV space.
 * Shapes are drawn in side view (x, height above the centreline) and mapped
 * onto the skin, so they follow the nose curvature exactly.
 */
export function paintLivery(canvas) {
  const W = canvas.width, H = canvas.height;
  const g = canvas.getContext('2d');
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, W, H);
  const L = NOSE_X - TAIL_X;
  const toUV = (x, h, side, thMax = 89) => {
    let th = Math.min(thMax, thAtHeight(x, YC + h));
    if (side < 0) th = 180 - th;
    return [((NOSE_X - x) / L) * W, ((th + 90) / 360) * H];
  };
  // Densify a closed side-view polygon so long edges bend with the skin.
  const dense = (poly, step = 0.04) => {
    const out = [];
    for (let i = 0; i < poly.length; i++) {
      const [x0, h0] = poly[i], [x1, h1] = poly[(i + 1) % poly.length];
      const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, h1 - h0) / step));
      for (let k = 0; k < n; k++) out.push([x0 + (x1 - x0) * (k / n), h0 + (h1 - h0) * (k / n)]);
    }
    return out;
  };
  const rrect = (x0, x1, h0, h1, r) => {
    const out = [];
    const arc = (cx, ch, a0) => { for (let k = 0; k <= 6; k++) { const a = a0 + (k / 6) * (Math.PI / 2); out.push([cx + r * Math.cos(a), ch + r * Math.sin(a)]); } };
    arc(x1 - r, h1 - r, 0); arc(x0 + r, h1 - r, Math.PI / 2); arc(x0 + r, h0 + r, Math.PI); arc(x1 - r, h0 + r, 1.5 * Math.PI);
    return out;
  };
  const path = (poly, side, thMax) => {
    g.beginPath();
    dense(poly).forEach(([x, h], i) => { const [u, v] = toUV(x, h, side, thMax); if (i) g.lineTo(u, v); else g.moveTo(u, v); });
    g.closePath();
  };
  const glass = '#1e2732', seam = '#8f969d';
  for (const side of [1, -1]) {
    // Flight deck windows (No. 1 front, No. 2 sliding, No. 3 aft). The front
    // pair stops short of the crown so a centre post stays between them.
    g.fillStyle = glass;
    // Side-view outlines: one continuous band with thin posts, No. 2 and
    // No. 3 sharing a straight sill, No. 1 sweeping down to the nose.
    const shield = [
      [[18.2, 0.56], [17.5, 0.6], [17.5, 1.16], [18.05, 1.06]],
      [[17.38, 0.61], [16.58, 0.63], [16.52, 1.2], [17.38, 1.18]],
      [[16.44, 0.64], [15.84, 0.66], [15.84, 1.06], [15.96, 1.2], [16.38, 1.22]],
    ];
    for (const w of shield) { path(w, side, 87); g.fill(); }
    // Cabin windows on a ~0.51 m pitch, skipping the overwing exits.
    for (let x = 12.85; x > -9.8; x -= 0.508) {
      if (x < 1.8 && x > 0.1) continue;
      path(rrect(x - 0.115, x + 0.115, 0.26, 0.58, 0.08), side); g.fill();
    }
    for (const x of [0.5, 1.4]) { path(rrect(x - 0.115, x + 0.115, 0.26, 0.58, 0.08), side); g.fill(); }
    // Door and exit outlines.
    g.strokeStyle = seam;
    g.lineWidth = 2.2;
    const out = (poly) => { path(poly, side); g.stroke(); };
    out(rrect(13.55, 14.42, FLOOR_Y - YC + 0.05, 1.28, 0.16));         // forward entry / galley door
    out(rrect(-10.15, -11.0, FLOOR_Y - YC + 0.05, 1.28, 0.16));        // aft door
    out(rrect(0.24, 0.76, -0.22, 0.86, 0.1));                          // overwing exits
    out(rrect(1.14, 1.66, -0.22, 0.86, 0.1));
    if (side > 0) {                                                    // cargo doors (right side)
      out(rrect(8.7, 9.95, -1.5, -0.72, 0.1));
      out(rrect(-4.9, -6.1, -1.45, -0.7, 0.1));
    }
  }
}

function latheX(profile, segs = 40) {
  // profile: [[a, r]...] a = metres aft of the origin. Returns geometry whose
  // axis runs along -x from the origin.
  const pts = profile.map(([a, r]) => new THREE.Vector2(r, a));
  const g = new THREE.LatheGeometry(pts, segs);
  g.rotateZ(Math.PI / 2); // +y (a) → -x
  return g;
}

/** Squash the lower part of a nacelle surface (the 737's flattened engine bottom). */
function flattenBottom(g, from = -0.55, k = 0.55) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    if (y < from) p.setY(i, from + (y - from) * k);
  }
  g.computeVertexNormals();
  return g;
}

// ── Build ───────────────────────────────────────────────────────────────────

/**
 * Build the airframe. Returns { root, skin: Mesh[], pose(p) } where pose
 * moves gear, flaps, slats, spoilers, reversers and fans. Every skin mesh is
 * tagged with userData.skin so the scene can swap solid ↔ x-ray materials.
 */
export function buildAirframe(materials) {
  const root = new THREE.Group();
  root.name = 'airframe';
  const skin = [];
  const movers = { flaps: [], slats: [], kruegers: [], spoilers: [], ailerons: [],
    elevators: [], rudder: null, mains: [], nose: null, sleeves: [], fans: [],
    stab: [], fin: [], engines: [], doors: {}, slides: {}, straps: [] };

  const add = (geom, parent = root, kind = 'skin') => {
    const m = new THREE.Mesh(geom, materials[kind]);
    m.castShadow = true;
    m.userData.skin = kind;
    parent.add(m);
    skin.push(m);
    return m;
  };

  // A pivot group: geometry is re-expressed about hinge point `a`, rotating
  // about the a→b axis (normalised so its z component is ≥ 0, which makes a
  // positive angle mean "trailing edge down" on both wings).
  const hinged = (geom, a, b, kind = 'skin') => {
    const pivot = new THREE.Group();
    const A = new THREE.Vector3(...a);
    pivot.position.copy(A);
    geom.translate(-A.x, -A.y, -A.z);
    const axis = new THREE.Vector3(...b).sub(A).normalize();
    if (axis.z < 0) axis.negate();
    pivot.userData = { axis, home: A.clone() };
    root.add(pivot);
    add(geom, pivot, kind);
    return pivot;
  };

  {
    const canvas = document.createElement('canvas');
    canvas.width = 4096; canvas.height = 1024;
    paintLivery(canvas);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    materials.fuselage.map = tex;
    materials.fuselage.needsUpdate = true;
    add(fuselageGeometry(), root, 'fuselage');
  }

  // ── Doors, exits and escape slides ──
  buildDoors();

  // ── Wings ──
  const FLAP_U = 0.74;   // flap hinge line (chord fraction)
  const SPOIL_U0 = 0.6;  // spoiler leading edge
  const SLAT_U = 0.12;
  // Spanwise stations where surfaces start/stop.
  const S = { root: 1.4, sob: SOB, kr0: 2.05, kr1: 4.3, nac: 6.55, fl0: 1.95, fl1: 6.25,
    fo0: 6.6, fo1: 12.4, ail1: 15.4, slat0: 6.75, tip: TIP_Z };

  for (const side of [1, -1]) {
    const z = (v) => v * side;
    const pieces = [];
    const sec = (zz, u0, u1, ts) => {
      const s = wingSection(zz, u0, u1, ts);
      s.le[2] = zz;
      return s;
    };
    // Main box: full chord inboard of the flaps where there's no LE device
    // gap, LE-to-flap-hinge elsewhere. Slats are cut out of the LE outboard.
    const boxSpan = [S.root, S.sob, S.kr0, S.kr1, S.nac, S.slat0, 9.5, S.fo1, S.ail1, S.tip];
    const box = boxSpan.map((zz) => {
      const u0 = zz >= S.slat0 ? SLAT_U : 0;
      return sec(z(zz), u0, FLAP_U);
    });
    // Transition sections at slat start so the LE steps cleanly.
    pieces.push(loft(box.slice(0, 6).map((s, i) => (i === 5 ? { ...s, u0: 0 } : s))));
    pieces.push(loft(box.slice(5)));
    // Tip trailing edge behind the ailerons out to the tip.
    pieces.push(loft([sec(z(S.ail1), FLAP_U, 1), sec(z(S.tip), FLAP_U, 1)]));
    for (const g of pieces) add(g);

    // Flaps (inboard and outboard), double-slotted in reality; one piece here.
    for (const [z0, z1] of [[S.fl0, S.fl1], [S.fo0, S.fo1]]) {
      const g = loft([sec(z(z0), FLAP_U, 1), sec(z(z1), FLAP_U, 1)]);
      const a = wingPoint(z(z0), FLAP_U, 0), b = wingPoint(z(z1), FLAP_U, 0);
      movers.flaps.push(hinged(g, a, b));
    }
    // Aileron.
    {
      const g = loft([sec(z(S.fo1), FLAP_U, 1), sec(z(S.ail1), FLAP_U, 1)]);
      movers.ailerons.push(hinged(g, wingPoint(z(S.fo1), FLAP_U, 0), wingPoint(z(S.ail1), FLAP_U, 0)));
    }
    // Slats: 4 outboard of the nacelle.
    const slatZ = [S.slat0, 9.2, 11.7, 14.2, 16.6];
    for (let i = 0; i < 4; i++) {
      const z0 = slatZ[i] + 0.04, z1 = slatZ[i + 1] - 0.04;
      const g = loft([sec(z(z0), 0, SLAT_U), sec(z(z1), 0, SLAT_U)]);
      const a = wingPoint(z(z0), SLAT_U, 1), b = wingPoint(z(z1), SLAT_U, 1);
      movers.slats.push(hinged(g, a, b));
    }
    // Krueger flaps: 2 inboard panels folded under the LE.
    for (const [z0, z1] of [[S.kr0, 3.15], [3.2, S.kr1]]) {
      const pts = (zz) => {
        const p0 = wingPoint(z(zz), 0.02, -1), p1 = wingPoint(z(zz), 0.13, -1);
        return { le: p0, chord: Math.hypot(p0[0] - p1[0], p0[1] - p1[1]), t: 0.12, thick: [0, 1, 0] };
      };
      const g = loft([pts(z0), pts(z1)].map((s) => ({ ...s, le: [s.le[0], s.le[1] - 0.03, s.le[2]] })), 8);
      const a = wingPoint(z(z0), 0.02, -1), b = wingPoint(z(z1), 0.02, -1);
      movers.kruegers.push(hinged(g, a, b));
    }
    // Spoilers: 6 per wing — 1 inboard of the nacelle, 5 outboard.
    const spZ = [[2.3, 5.4], [6.7, 7.8], [7.85, 8.95], [9.0, 10.1], [10.15, 11.25], [11.3, 12.35]];
    for (const [z0, z1] of spZ) {
      const pt = (zz, u) => wingPoint(z(zz), u, 1);
      const s0 = { le: pt(z0, SPOIL_U0), chord: wingChord(z0) * (FLAP_U - SPOIL_U0 + 0.04), t: 0.05,
        thick: [0, 1, 0] };
      const s1 = { le: pt(z1, SPOIL_U0), chord: wingChord(z1) * (FLAP_U - SPOIL_U0 + 0.04), t: 0.05,
        thick: [0, 1, 0] };
      s0.le[1] += 0.015; s1.le[1] += 0.015;
      movers.spoilers.push(hinged(loft([s0, s1], 6), s0.le, s1.le));
    }

    // Blended winglet: the tip section swept up and out over ~2.5 m.
    const tip = wingSection(z(S.tip), 0, 1);
    const wl = [
      tip,
      { le: [-4.75, 3.78, z(17.55)], chord: 1.15, t: 0.1, thick: [0, Math.cos(0.8), -side * Math.sin(0.8)] },
      { le: [-5.15, 4.45, z(17.76)], chord: 0.92, t: 0.09, thick: [0, Math.cos(1.35), -side * Math.sin(1.35)] },
      { le: [-6.0, 5.95, z(17.9)], chord: 0.55, t: 0.08, thick: [0, Math.cos(1.45), -side * Math.sin(1.45)] },
    ];
    add(loft(wl, 14));

    // ── Engine ──
    const eng = new THREE.Group();
    eng.position.set(ENG.x, ENG.y, side * ENG.z);
    root.add(eng);
    movers.engines.push(eng);
    // Nacelle: thick inlet lip, fattest a third of the way back, tapering to
    // the translating sleeve and a big fan nozzle. The lower half is
    // flattened (flattenBottom) the way the CFM56 nacelle is on the 737.
    const nac = latheX([[0, 0.83], [0.03, 0.93], [0.12, 1.0], [0.45, 1.05], [1.2, 1.05], [2.05, 1.0], [2.1, 0.99]], 48);
    add(flattenBottom(nac), eng);
    // Inlet lip inner face and the duct back to the fan (grey, so it reads deep).
    add(flattenBottom(latheX([[0.0, 0.83], [0.08, 0.8], [0.3, 0.79], [0.86, 0.8]], 48)), eng, 'metal');
    // Translating sleeve (thrust reverser) and the cascade it uncovers.
    const sleeve = latheX([[2.05, 0.995], [2.9, 0.95], [3.62, 0.86], [3.95, 0.8]], 48);
    const sleeveGroup = new THREE.Group();
    eng.add(sleeveGroup);
    add(flattenBottom(sleeve), sleeveGroup);
    // Fan duct liner inside the sleeve, dark — the fan nozzle reads hollow.
    add(flattenBottom(latheX([[2.05, 0.8], [3.0, 0.78], [3.93, 0.75]], 48)), sleeveGroup, 'dark');
    const cascade = latheX([[2.0, 0.92], [2.68, 0.9]], 48);
    const cm = add(flattenBottom(cascade), eng, 'dark');
    cm.userData.skin = 'dark';
    movers.sleeves.push({ group: sleeveGroup, cascade: cm });
    // Core cowl, primary nozzle and the long exhaust plug.
    add(latheX([[2.9, 0.68], [3.6, 0.66], [4.3, 0.58], [4.75, 0.5]], 36), eng, 'metal');
    add(latheX([[4.75, 0.5], [4.8, 0.44]], 36), eng, 'dark');
    add(latheX([[4.7, 0.4], [5.1, 0.34], [5.6, 0.17], [5.9, 0.05]], 28), eng, 'metal');
    // Fan: spinner + blades.
    const fan = new THREE.Group();
    fan.position.set(-0.86, 0, 0);
    eng.add(fan);
    const spinner = latheX([[-0.42, 0.0], [-0.3, 0.13], [-0.12, 0.25], [0, 0.29]], 24);
    add(spinner, fan, 'dark');
    const bladeGeo = new THREE.BoxGeometry(0.04, 0.52, 0.2);
    bladeGeo.translate(0, 0.54, 0);
    for (let i = 0; i < 24; i++) {
      const b = add(bladeGeo.clone(), fan, 'dark');
      b.rotation.x = (i / 24) * Math.PI * 2;
      b.rotateY(0.45);
    }
    movers.fans.push(fan);
    // Pylon.
    add(loft([
      { le: [ENG.x - 1.0, ENG.y + 0.98, side * ENG.z], chord: 3.6, t: 0.09, thick: [0, 0, 1], chordDir: [-1, 0, 0] },
      { le: [wingLE(ENG.z) + 1.0, wingY(ENG.z) + 0.05, side * ENG.z], chord: 4.4, t: 0.08, thick: [0, 0, 1],
        chordDir: [-1, -0.08, 0] },
    ], 8));

    // ── Main gear ──
    const mg = new THREE.Group();
    mg.position.set(MLG.x, MLG.pivotY, side * MLG.pivotZ);
    root.add(mg);
    const legLen = MLG.pivotY - MLG.wheelR;
    const lean = side * (MLG.pivotZ - MLG.z);       // leg leans inboard to the axle
    const leg = new THREE.CylinderGeometry(0.11, 0.13, Math.hypot(legLen, lean), 12);
    leg.rotateX(Math.atan2(lean, legLen));
    leg.translate(0, -legLen / 2, -lean / 2);
    add(leg, mg, 'metal');
    const tyre = new THREE.CylinderGeometry(MLG.wheelR, MLG.wheelR, 0.36, 28);
    tyre.rotateX(Math.PI / 2);
    for (const dz of [-0.43, 0.43]) {
      const t = tyre.clone();
      t.translate(0, -legLen, -lean + dz);
      add(t, mg, 'tyre');
    }
    const axle = new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8);
    axle.rotateX(Math.PI / 2);
    axle.translate(0, -legLen, -lean);
    add(axle, mg, 'metal');
    mg.userData.side = side;
    movers.mains.push(mg);
  }

  // ── Nose gear ──
  {
    const ng = new THREE.Group();
    ng.position.set(NLG.x, NLG.pivotY, 0);
    root.add(ng);
    const L = NLG.pivotY - NLG.wheelR;
    const leg = new THREE.CylinderGeometry(0.08, 0.09, L, 12);
    leg.translate(0, -L / 2, 0);
    add(leg, ng, 'metal');
    const tyre = new THREE.CylinderGeometry(NLG.wheelR, NLG.wheelR, 0.22, 24);
    tyre.rotateX(Math.PI / 2);
    for (const dz of [-0.2, 0.2]) {
      const t = tyre.clone();
      t.translate(0, -L, dz);
      add(t, ng, 'tyre');
    }
    movers.nose = ng;
  }

  // ── Vertical fin + rudder ──
  const finRoot = { le: [-10.6, 4.55, 0], chord: 7.0, t: 0.11, thick: [0, 0, 1] };
  const finTip = { le: [-16.0, 12.5, 0], chord: 1.9, t: 0.09, thick: [0, 0, 1] };
  const RUD_U = 0.7;
  movers.fin.push(add(loft([{ ...finRoot, u1: RUD_U }, { ...finTip, u1: RUD_U }], 16)));
  // Dorsal fillet.
  add(loft([
    { le: [-8.2, 4.7, 0], chord: 3.0, t: 0.06, thick: [0, 0, 1], chordDir: [-1, 0, 0] },
    { le: [-10.6, 5.6, 0], chord: 1.4, t: 0.07, thick: [0, 0, 1] },
  ], 8));
  {
    const g = loft([{ ...finRoot, u0: RUD_U }, { ...finTip, u0: RUD_U }], 10);
    const a = [finRoot.le[0] - RUD_U * finRoot.chord, finRoot.le[1], 0];
    const b = [finTip.le[0] - RUD_U * finTip.chord, finTip.le[1], 0];
    const pivot = new THREE.Group();
    const A = new THREE.Vector3(...a);
    pivot.position.copy(A);
    g.translate(-A.x, -A.y, -A.z);
    pivot.userData = { axis: new THREE.Vector3(...b).sub(A).normalize() };
    root.add(pivot);
    add(g, pivot);
    movers.rudder = pivot;
  }

  // ── Horizontal stabiliser + elevators ──
  const ELEV_U = 0.72;
  for (const side of [1, -1]) {
    const r = { le: [-14.4, 3.75, side * 0.5], chord: 4.4, t: 0.1, thick: [0, 1, 0] };
    const t = { le: [-18.35, 3.75 + Math.tan(7 * Math.PI / 180) * 6.7, side * 7.18], chord: 1.35, t: 0.09,
      thick: [0, 1, 0] };
    movers.stab.push(add(loft([{ ...r, u1: ELEV_U }, { ...t, u1: ELEV_U }], 14)));
    const g = loft([{ ...r, u0: ELEV_U }, { ...t, u0: ELEV_U }], 8);
    const a = [r.le[0] - ELEV_U * r.chord, r.le[1], r.le[2]];
    const b = [t.le[0] - ELEV_U * t.chord, t.le[1], t.le[2]];
    movers.elevators.push(hinged(g, a, b));
  }

  // APU exhaust cap.
  {
    const s = fusSection(TAIL_X + 0.02);
    const g = new THREE.CylinderGeometry(0.16, 0.2, 0.25, 16);
    g.rotateZ(Math.PI / 2);
    g.translate(TAIL_X - 0.08, s.yc, 0);
    add(g, root, 'dark');
  }

  // A curved panel on the skin over the side-view outline (x0…x1 aft→fwd,
  // h0…h1 above the centreline, corner radius r), pushed `off` outward.
  function skinPatch(x0, x1, h0, h1, side, r, off) {
    const nx = 14, nh = 14, pos = [], idx = [];
    for (let j = 0; j <= nh; j++) {
      const h = h0 + (h1 - h0) * (j / nh);
      // Round the corners by pulling the row's ends in.
      const dy = Math.max(0, r - Math.min(h - h0, h1 - h)), cut = dy > 0 ? r - Math.sqrt(Math.max(0, r * r - dy * dy)) : 0;
      for (let i = 0; i <= nx; i++) {
        const x = x0 + cut + (x1 - x0 - 2 * cut) * (i / nx);
        let th = thAtHeight(x, YC + h);
        if (side < 0) th = 180 - th;
        pos.push(...fusPoint(x, th, off));
      }
    }
    for (let j = 0; j < nh; j++) for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    return g;
  }
  function buildDoors() {
    const F = FLOOR_Y - YC + 0.05;
    // [key, x0 (aft), x1 (fwd), h0, h1, side, r, type]
    const list = [
      ['fwdEntry', 13.55, 14.42, F, 1.28, -1, 0.16, 'plug'], ['fwdSvc', 13.55, 14.42, F, 1.28, 1, 0.16, 'plug'],
      ['aftEntry', -11.0, -10.15, F, 1.28, -1, 0.16, 'plug'], ['aftSvc', -11.0, -10.15, F, 1.28, 1, 0.16, 'plug'],
      ['owL1', 0.24, 0.76, -0.22, 0.86, -1, 0.1, 'canopy'], ['owL2', 1.14, 1.66, -0.22, 0.86, -1, 0.1, 'canopy'],
      ['owR1', 0.24, 0.76, -0.22, 0.86, 1, 0.1, 'canopy'], ['owR2', 1.14, 1.66, -0.22, 0.86, 1, 0.1, 'canopy'],
      ['fwdCargo', 8.7, 9.95, -1.5, -0.72, 1, 0.1, 'cargo'], ['aftCargo', -6.1, -4.9, -1.45, -0.7, 1, 0.1, 'cargo'],
    ];
    for (const [key, x0, x1, h0, h1, side, r, type] of list) {
      // Dark opening behind the door.
      const hole = add(skinPatch(x0 + 0.02, x1 - 0.02, h0 + 0.02, h1 - 0.02, side, r, 0.012), root, 'dark');
      hole.renderOrder = 1;
      // The door itself, about its hinge.
      const g = skinPatch(x0, x1, h0, h1, side, r, 0.03);
      let A, axis;
      if (type === 'plug') {
        // Hinged on the forward edge; swings out and forward against the skin.
        const p = fusPoint(x1, side < 0 ? 180 - thAtHeight(x1, YC + (h0 + h1) / 2) : thAtHeight(x1, YC + (h0 + h1) / 2), 0.12);
        A = new THREE.Vector3(...p); axis = new THREE.Vector3(0, side < 0 ? -1 : 1, 0);
      } else {
        // Hinged along the top edge: canopy exits swing up and out, cargo doors in and up.
        const p = fusPoint((x0 + x1) / 2, side < 0 ? 180 - thAtHeight((x0 + x1) / 2, YC + h1) : thAtHeight((x0 + x1) / 2, YC + h1), 0.03);
        A = new THREE.Vector3(...p);
        axis = new THREE.Vector3(1, 0, 0).multiplyScalar(type === 'canopy' ? -side : side);
      }
      const pivot = new THREE.Group();
      pivot.position.copy(A);
      g.translate(-A.x, -A.y, -A.z);
      root.add(pivot);
      add(g, pivot, 'skin');
      const max = type === 'plug' ? 170 : type === 'canopy' ? 80 : 100;
      movers.doors[key] = { pivot, axis, max: (max * Math.PI) / 180, cur: 0, target: 0, side, x0, x1 };
      // Integral escape slides on the four entry / service doors.
      if (type === 'plug') {
        const sl = slide(x0, x1, F, side);
        movers.slides[key] = sl;
      }
    }
    // Overwing escape straps: aft exit frame to a ring on the wing.
    for (const side of [-1, 1]) {
      // Above the AFT overwing exit (x 0.24–0.76), to a ring on the upper wing.
      const top = fusPoint(0.3, side < 0 ? 180 - thAtHeight(0.3, YC + 0.84) : thAtHeight(0.3, YC + 0.84), 0.04);
      const ring = [wingLE(5.6) - 2.6, wingY(5.6) + 0.14, side * 5.6];
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(...top), new THREE.Vector3((top[0] + ring[0]) / 2, (top[1] + ring[1]) / 2 + 0.1, (top[2] + ring[2]) / 2), new THREE.Vector3(...ring)]);
      const strap = new THREE.Mesh(new THREE.TubeGeometry(curve, 16, 0.02, 6), new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: 0.6 }));
      strap.visible = false;
      root.add(strap);
      movers.straps.push(strap);
    }
  }
  // An inflatable slide from the door sill down to the ramp.
  function slide(x0, x1, F, side) {
    const sill = fusPoint((x0 + x1) / 2, side < 0 ? 180 - thAtHeight((x0 + x1) / 2, YC + F) : thAtHeight((x0 + x1) / 2, YC + F), 0.05);
    const group = new THREE.Group();
    group.position.set(...sill);
    root.add(group);
    const holder = new THREE.Group();       // rotated to slope down and out
    group.add(holder);
    const L = 5.2, W = 1.15;
    const yellow = new THREE.MeshStandardMaterial({ color: 0xf3c11b, roughness: 0.55 });
    const grey = new THREE.MeshStandardMaterial({ color: 0x9aa1a7, roughness: 0.6 });
    const tube = (len, r, mat) => { const g = new THREE.CylinderGeometry(r, r, len, 16); g.rotateX(Math.PI / 2); g.translate(0, 0, len / 2); return new THREE.Mesh(g, mat); };
    for (const dx of [-W / 2, W / 2]) { const t = tube(L, 0.17, yellow); t.position.x = dx; t.castShadow = true; holder.add(t); }
    for (const dz of [0.08, L - 0.05]) { const g = new THREE.CylinderGeometry(0.15, 0.15, W, 14); g.rotateZ(Math.PI / 2); const m = new THREE.Mesh(g, yellow); m.position.z = dz; holder.add(m); }
    const bed = new THREE.Mesh(new THREE.PlaneGeometry(W, L), grey);
    bed.rotation.x = -Math.PI / 2; bed.position.set(0, 0.05, L / 2); bed.receiveShadow = true;
    bed.material.side = THREE.DoubleSide;
    holder.add(bed);
    // Hand grips along the sides.
    for (let k = 1; k < 5; k++) for (const dx of [-W / 2, W / 2]) {
      const gr = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.012, 6, 12, Math.PI), grey);
      gr.position.set(dx, 0.15, (k * L) / 5); gr.rotation.y = Math.PI / 2;
      holder.add(gr);
    }
    // Slope from the sill to the ground, pointing out from the fuselage side.
    const drop = sill[1] - 0.15, reach = Math.sqrt(Math.max(0.1, L * L - drop * drop));
    holder.rotation.y = side < 0 ? Math.PI : 0;
    holder.rotation.order = 'YXZ';
    holder.rotation.x = Math.atan2(drop, reach);
    group.visible = false;
    return { group, holder, cur: 0, target: 0 };
  }

  // Open / close doors and inflate slides smoothly. targets: { key: 0|1 }.
  function setDoors(doorT = {}, slideT = {}, straps = false) {
    for (const k in movers.doors) movers.doors[k].target = doorT[k] ? 1 : 0;
    for (const k in movers.slides) movers.slides[k].target = slideT[k] ? 1 : 0;
    for (const st of movers.straps) st.userData.want = straps;
  }
  function doorsFrame(dt) {
    for (const k in movers.doors) {
      const d = movers.doors[k];
      d.cur += Math.sign(d.target - d.cur) * Math.min(Math.abs(d.target - d.cur), dt * 0.7);
      const e = d.cur < 0.5 ? 2 * d.cur * d.cur : 1 - (-2 * d.cur + 2) ** 2 / 2;
      d.pivot.quaternion.setFromAxisAngle(d.axis, e * d.max);
    }
    for (const k in movers.slides) {
      const sl = movers.slides[k];
      // A slide only inflates once its door is mostly open.
      const t = sl.target && movers.doors[k].cur > 0.7 ? 1 : 0;
      sl.cur += Math.sign(t - sl.cur) * Math.min(Math.abs(t - sl.cur), dt * 0.9);
      sl.group.visible = sl.cur > 0.01;
      const e = 1 - (1 - sl.cur) ** 3;
      sl.holder.scale.set(0.3 + 0.7 * e, 0.3 + 0.7 * e, Math.max(0.01, e));
    }
    for (const st of movers.straps) st.visible = !!st.userData.want && movers.doors.owL1.cur > 0.8;
  }

  // ── Pose ──
  const D = Math.PI / 180;
  const flapTable = [[0, 0, 0], [1, 2, 0.12], [5, 9, 0.38], [15, 15, 0.62], [30, 30, 0.9], [40, 38, 1.0]];
  function flapLookup(setting) {
    for (let i = 1; i < flapTable.length; i++) {
      const [s0, a0, f0] = flapTable[i - 1], [s1, a1, f1] = flapTable[i];
      if (setting <= s1) {
        const k = (setting - s0) / (s1 - s0);
        return [a0 + (a1 - a0) * k, f0 + (f1 - f0) * k];
      }
    }
    return [38, 1];
  }

  /**
   * p = { flaps (0–40 detent), slats (0 retracted · 1 extend · 2 full),
   *       gear (0 up … 1 down), speedbrake (0–1), reverser (0–1),
   *       rudder, aileron, elevator (deg) }
   */
  function pose(p) {
    const [fa, travel] = flapLookup(p.flaps || 0);
    for (const f of movers.flaps) {
      f.quaternion.setFromAxisAngle(f.userData.axis, fa * D);
      // Fowler motion: aft and slightly down along the track.
      f.position.copy(f.userData.home).add(new THREE.Vector3(-0.85 * travel, -0.18 * travel, 0));
    }
    const sl = p.slats || 0;
    for (const s of movers.slats) {
      const ext = Math.min(1, sl);
      const full = Math.max(0, sl - 1);
      s.quaternion.setFromAxisAngle(s.userData.axis, -(12 * ext + 10 * full) * D);
      s.position.copy(s.userData.home).add(new THREE.Vector3(0.32 * ext + 0.08 * full, -0.1 * ext - 0.1 * full, 0));
    }
    const kr = Math.min(1, sl);
    for (const k of movers.kruegers) k.quaternion.setFromAxisAngle(k.userData.axis, 118 * kr * D);
    const sb = p.speedbrake || 0;
    for (const s of movers.spoilers) s.quaternion.setFromAxisAngle(s.userData.axis, -48 * sb * D);
    movers.ailerons.forEach((a, i) => a.quaternion.setFromAxisAngle(a.userData.axis, (i ? -1 : 1) * (p.aileron || 0) * D));
    movers.elevators.forEach((e) => e.quaternion.setFromAxisAngle(e.userData.axis, (p.elevator || 0) * D));
    if (movers.rudder) movers.rudder.quaternion.setFromAxisAngle(movers.rudder.userData.axis, (p.rudder || 0) * D);
    const g = 1 - (p.gear ?? 1);
    for (const m of movers.mains) m.rotation.x = m.userData.side * 88 * D * g;
    if (movers.nose) movers.nose.rotation.z = 96 * D * g;
    const rv = p.reverser || 0;
    for (const s of movers.sleeves) {
      s.group.position.x = -0.62 * rv;
      s.cascade.visible = rv > 0.02;
    }
  }

  function spinFans(dt, speed) {
    for (const f of movers.fans) f.rotation.x += dt * speed;
  }

  return { root, skin, pose, spinFans, movers, setDoors, doorsFrame };
}
