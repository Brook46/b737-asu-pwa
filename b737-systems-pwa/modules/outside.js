// outside.js — the world around the airplane, driven by the system states:
//   • exterior lights (Airplane General switches) glowing on the 3D model —
//     steady position lights, double-flash white strobes, red anti-collision
//     beacons, landing / runway turnoff / taxi beams, logo, wing and wheel
//     well lights;
//   • at the gate: ground crew, chocks and cones, and the GPU and
//     conditioned-air carts with their cable / hose when connected;
//   • in flight: airflow streaks streaming past at a speed set by the TAS.
// Everything here is decoration on top of the airframe; nothing is pickable.

import * as THREE from '../vendor/three.module.min.js?v=25';
import { YC, FUS_H, FUS_R, TIP_Z, TAIL_X, wingLE, wingTE, wingY, wingChord, wingTC, naca, NLG, MLG } from './airframe.js?v=25';

// ── Glow sprites ────────────────────────────────────────────────────────────
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, 'rgba(255,255,255,1)');
  r.addColorStop(0.18, 'rgba(255,255,255,.9)');
  r.addColorStop(0.45, 'rgba(255,255,255,.28)');
  r.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function beamTexture() {
  // Bright at the lamp, fading along the beam and toward its edges.
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const lin = g.createLinearGradient(0, 0, 0, 256);
  lin.addColorStop(0, 'rgba(255,255,255,.75)');
  lin.addColorStop(0.35, 'rgba(255,255,255,.28)');
  lin.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = lin; g.fillRect(0, 0, 64, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createOutside(api, airframe) {
  const world = api.world;
  const root = airframe.root;
  const GLOW = glowTexture(), BEAM = beamTexture();

  // ── Exterior lights ──
  const lights = [];   // { key, sprite, beam, pool, kind, base }
  const sprite = (pos, color, size, parent = root) => {
    const m = new THREE.SpriteMaterial({ map: GLOW, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 });
    const s = new THREE.Sprite(m);
    s.position.set(...pos);
    s.scale.setScalar(size);
    s.renderOrder = 5;
    parent.add(s);
    return s;
  };
  // A cone of light from `pos` along `dir`, `len` long, opening `spread` wide.
  const beam = (pos, dir, len, spread, color, parent = root) => {
    const geo = new THREE.ConeGeometry(spread, len, 24, 1, true);
    geo.translate(0, -len / 2, 0);            // apex at the origin, opening along −y
    const mat = new THREE.MeshBasicMaterial({ map: BEAM, color, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending, opacity: 0 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...pos);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, -1, 0), new THREE.Vector3(...dir).normalize());
    m.renderOrder = 4;
    parent.add(m);
    return m;
  };
  // A pool of light on the ground (only drawn while on the ground).
  const pool = (pos, rx, rz, color) => {
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 40), new THREE.MeshBasicMaterial({
      map: GLOW, color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    m.rotation.x = -Math.PI / 2;
    m.scale.set(rx, rz, 1);
    m.position.set(pos[0], 0.03, pos[2]);
    m.renderOrder = 3;
    world.add(m);
    return m;
  };
  const add = (key, kind, parts) => lights.push({ key, kind, ...parts });

  const WARM = 0xfff1c9, WHITE = 0xffffff, RED = 0xff3326, GREEN = 0x2bff6a;
  for (const s of [-1, 1]) {
    const tz = TIP_Z - 0.25;
    // Position lights: red left, green right at the tips; white at the trailing edge tips.
    add('pos', 'steady', { sprite: sprite([wingLE(tz) - 0.25, wingY(tz) + 0.05, s * tz], s < 0 ? RED : GREEN, 1.1) });
    add('pos', 'steady', { sprite: sprite([wingTE(tz) + 0.1, wingY(tz) + 0.05, s * tz], WHITE, 0.8) });
    // Strobes at both tips.
    add('strobe', 'strobe', { sprite: sprite([wingLE(tz) - 0.45, wingY(tz) + 0.05, s * tz], WHITE, 3.2), phase: s < 0 ? 0 : 0.03 });
    // Fixed landing lights, wing roots, shining ahead and a little down.
    const lz = s * 3.15, lp = [wingLE(3.15) + 0.1, wingY(3.15) - 0.05, lz];
    add(s < 0 ? 'llL' : 'llR', 'beam', {
      sprite: sprite(lp, WARM, 1.6), beam: beam(lp, [1, -0.1, s * 0.03], 34, 4.2, WARM),
      pool: pool([lp[0] + 26, 0, lz + s * 1], 10, 4.5, WARM), base: 0.55,
    });
    // Runway turnoff lights, wing roots, angled out to the side.
    const rp = [wingLE(2.6) + 0.15, wingY(2.6) - 0.1, s * 2.6];
    add(s < 0 ? 'rtoL' : 'rtoR', 'beam', {
      sprite: sprite(rp, WARM, 1.2), beam: beam(rp, [0.75, -0.12, s * 0.65], 20, 3.2, WARM),
      pool: pool([rp[0] + 11, 0, rp[2] + s * 10], 6, 6, WARM), base: 0.42,
    });
    // Logo lights on the stabiliser, lighting the fin.
    add('logo', 'steady', { sprite: sprite([-17.4, 4.35, s * 2.4], WARM, 0.7) });
    add('logo', 'flood', { sprite: sprite([-18.1, 7.2, s * 0.25], WARM, 5.5), base: 0.35 });
    // Wing (ice inspection) lights on the fuselage side, lighting the leading edge.
    const wp = [wingLE(1.95) + 1.6, YC + 0.25, s * (FUS_R + 0.02)];
    add('wingLt', 'beam', { sprite: sprite(wp, WARM, 0.8), beam: beam(wp, [-0.45, -0.25, s * 1], 9, 1.8, WARM), base: 0.35 });
    // Wheel well lights.
    add('wwLt', 'steady', { sprite: sprite([MLG.x + 0.3, 1.95, s * 0.6], WARM, 0.9) });
  }
  add('pos', 'steady', { sprite: sprite([TAIL_X + 0.15, YC + 0.45, 0], WHITE, 0.8) });
  add('strobe', 'strobe', { sprite: sprite([TAIL_X + 0.1, YC + 0.45, 0], WHITE, 2.6), phase: 0.06 });
  // Anti-collision beacons top and bottom.
  add('beacon', 'beacon', { sprite: sprite([2.2, YC + FUS_H + 0.08, 0], RED, 2.4), phase: 0 });
  add('beacon', 'beacon', { sprite: sprite([-1.0, YC - FUS_H - 0.08, 0], RED, 2.4), phase: 0.5 });
  // Taxi light on the nose gear strut (rides with the gear).
  if (airframe.movers.nose) {
    const tp = [0.28, -0.75, 0];
    add('taxi', 'beam', {
      sprite: sprite(tp, WARM, 1.1, airframe.movers.nose), beam: beam(tp, [1, -0.06, 0], 22, 3.0, WARM, airframe.movers.nose),
      pool: pool([NLG.x + 14, 0, 0], 8, 4, WARM), base: 0.5, onGear: true,
    });
  }

  // ── Ground: crew, chocks, cones, carts ──
  const ground = new THREE.Group();
  ground.name = 'ground-equipment';
  world.add(ground);
  const mat = (color, rough = 0.7) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.05 });
  const M = {
    vest: mat(0xd8f000, 0.6), vestO: mat(0xff7a00, 0.6), trousers: mat(0x253040), skin: mat(0xc8956d), muff: mat(0x111111),
    cart: mat(0xf2c200, 0.5), cartDark: mat(0x2b2f33), tyre: mat(0x151515, 0.9), cable: mat(0x111111, 0.6),
    hose: mat(0xe8e8e8, 0.5), hoseBand: mat(0x3a7bd5, 0.5), cone: mat(0xff5a1f, 0.5), white: mat(0xf4f4f4, 0.5), chock: mat(0xf2c200, 0.8),
  };
  const mesh = (geo, m, pos, parent = ground) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(...pos);
    o.castShadow = true;
    parent.add(o);
    return o;
  };
  function person(pos, faceTo, vest = M.vest, headset = false) {
    const g = new THREE.Group();
    g.position.set(pos[0], 0, pos[2]);
    for (const dz of [-0.11, 0.11]) mesh(new THREE.CylinderGeometry(0.075, 0.07, 0.86, 10), M.trousers, [0, 0.43, dz], g);
    mesh(new THREE.CylinderGeometry(0.2, 0.17, 0.62, 14), vest, [0, 1.17, 0], g);
    for (const dz of [-0.25, 0.25]) mesh(new THREE.CylinderGeometry(0.055, 0.05, 0.58, 8), vest, [0, 1.18, dz], g);
    mesh(new THREE.SphereGeometry(0.12, 16, 12), M.skin, [0, 1.62, 0], g);
    // Reflective stripes.
    for (const y of [1.0, 1.28]) mesh(new THREE.CylinderGeometry(0.205, 0.2, 0.04, 14), M.white, [0, y, 0], g);
    if (headset) for (const dz of [-0.12, 0.12]) mesh(new THREE.SphereGeometry(0.05, 10, 8), M.muff, [0, 1.62, dz], g);
    g.rotation.y = Math.atan2(-(faceTo[2] - pos[2]), faceTo[0] - pos[0]);
    ground.add(g);
    return g;
  }
  function cone(x, z) {
    mesh(new THREE.ConeGeometry(0.17, 0.62, 16), M.cone, [x, 0.31, z]);
    mesh(new THREE.CylinderGeometry(0.105, 0.125, 0.09, 16), M.white, [x, 0.36, z]);
    mesh(new THREE.BoxGeometry(0.42, 0.04, 0.42), M.cone, [x, 0.02, z]);
  }
  // Headset operator at the nose (plugged into the ground interphone).
  person([NLG.x + 3.2, 0, -1.6], [NLG.x, 0, 0], M.vest, true);
  // Ramp agent at the forward cargo door, one at the wingtip.
  person([8.6, 0, 3.4], [8.6, 0, 0], M.vestO);
  person([-1.5, 0, -18.2], [0, 0, 0], M.vest);
  // Chocks at the nose wheels and mains.
  for (const [x, z] of [[NLG.x + 0.55, 0], [NLG.x - 0.55, 0], [MLG.x + 0.85, -MLG.z], [MLG.x + 0.85, MLG.z]]) {
    const ch = new THREE.BoxGeometry(0.28, 0.2, 0.9);
    mesh(ch, M.chock, [x, 0.1, z]);
  }
  // Cones at the wingtips, engines and tail.
  for (const [x, z] of [[wingLE(TIP_Z) - 1.0, -TIP_Z - 0.8], [wingLE(TIP_Z) - 1.0, TIP_Z + 0.8], [TAIL_X - 1.5, 0], [8.4, -4.95], [8.4, 4.95]]) cone(x, z);

  // GPU cart, with its cable to the external power receptacle (lower right, aft of the nose).
  const gpu = new THREE.Group();
  ground.add(gpu);
  const GPU_AT = [16.9, 0, 3.6];
  mesh(new THREE.BoxGeometry(1.7, 1.0, 1.15), M.cart, [GPU_AT[0], 0.75, GPU_AT[2]], gpu);
  mesh(new THREE.BoxGeometry(1.72, 0.12, 1.17), M.cartDark, [GPU_AT[0], 1.3, GPU_AT[2]], gpu);
  for (const dx of [-0.6, 0.6]) for (const dz of [-0.5, 0.5]) {
    const w = new THREE.CylinderGeometry(0.2, 0.2, 0.14, 16); w.rotateX(Math.PI / 2);
    mesh(w, M.tyre, [GPU_AT[0] + dx, 0.2, GPU_AT[2] + dz], gpu);
  }
  mesh(new THREE.BoxGeometry(0.9, 0.08, 0.08), M.cartDark, [GPU_AT[0] + 1.25, 0.32, GPU_AT[2]], gpu);
  const RECEPT = new THREE.Vector3(15.1, 1.35, 1.12);
  const cablePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(GPU_AT[0] - 0.5, 0.9, GPU_AT[2] - 0.55), new THREE.Vector3(16.3, 0.08, 2.6),
    new THREE.Vector3(15.5, 0.1, 1.7), new THREE.Vector3(15.2, 0.75, 1.3), RECEPT,
  ]);
  mesh(new THREE.TubeGeometry(cablePath, 40, 0.035, 8), M.cable, [0, 0, 0], gpu);
  person([GPU_AT[0] + 0.6, 0, GPU_AT[2] + 1.3], [GPU_AT[0], 0, GPU_AT[2]], M.vestO);

  // Conditioned-air (PCA) cart, with its fat hose to the belly connection.
  const pca = new THREE.Group();
  ground.add(pca);
  const PCA_AT = [3.2, 0, 7.4];
  mesh(new THREE.BoxGeometry(2.6, 1.4, 1.5), mat(0xe9eef2, 0.55), [PCA_AT[0], 1.0, PCA_AT[2]], pca);
  mesh(new THREE.BoxGeometry(2.62, 0.22, 1.52), M.hoseBand, [PCA_AT[0], 1.45, PCA_AT[2]], pca);
  for (const dx of [-0.9, 0.9]) for (const dz of [-0.62, 0.62]) {
    const w = new THREE.CylinderGeometry(0.25, 0.25, 0.16, 16); w.rotateX(Math.PI / 2);
    mesh(w, M.tyre, [PCA_AT[0] + dx, 0.25, PCA_AT[2] + dz], pca);
  }
  const hosePath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(PCA_AT[0] - 0.6, 0.6, PCA_AT[2] - 0.75), new THREE.Vector3(2.6, 0.2, 5.4),
    new THREE.Vector3(1.9, 0.2, 3.0), new THREE.Vector3(1.4, 0.35, 1.2), new THREE.Vector3(1.2, 0.98, 0.35),
  ]);
  mesh(new THREE.TubeGeometry(hosePath, 60, 0.17, 12), M.hose, [0, 0, 0], pca);
  for (let i = 1; i < 12; i++) {
    const p = hosePath.getPointAt(i / 12), t = hosePath.getTangentAt(i / 12);
    const band = mesh(new THREE.TorusGeometry(0.175, 0.025, 6, 16), M.hoseBand, p.toArray(), pca);
    band.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), t);
  }

  // ── Airflow: streamlines over the wing section, round the body, tip vortices ──
  // Each streak is a short trail along a streamline; the streamline is set by
  // where it starts in the free stream (height d above the local chord line,
  // span station z). Over the wing it rises ahead of the leading edge, hugs
  // the cambered upper / lower skin, and leaves with downwash behind the
  // trailing edge; near the tips it curls into the tip vortex.
  const N = 300, K = 8, X0 = 30, X1 = -36;
  const pos = new Float32Array(N * (K - 1) * 6), col = new Float32Array(N * (K - 1) * 6), seeds = [];
  const streakGeo = new THREE.BufferGeometry();
  streakGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  streakGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const streakMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, depthWrite: false });
  const streaks = new THREE.LineSegments(streakGeo, streakMat);
  streaks.frustumCulled = false;
  streaks.renderOrder = 6;
  world.add(streaks);
  const rnd = (a, b) => a + Math.random() * (b - a);
  function seed(s = {}) {
    const r = Math.random();
    s.x = rnd(X1, X0); s.k = rnd(0.85, 1.15);
    if (r < 0.72) {          // over / under the wing
      s.kind = 'wing'; s.z = (Math.random() < 0.5 ? -1 : 1) * rnd(2.3, TIP_Z - 0.6); s.d = Math.sign(Math.random() - 0.5) * (0.06 + 2.2 * Math.random() ** 1.8);   // most close to the skin
    } else if (r < 0.86) {   // round the fuselage
      s.kind = 'body'; s.a = rnd(0, Math.PI * 2); s.rr = rnd(2.2, 3.6);
    } else {                 // tip vortex
      s.kind = 'tip'; s.side = Math.random() < 0.5 ? -1 : 1; s.r0 = rnd(0.25, 1.1); s.ph = rnd(0, Math.PI * 2);
    }
    return s;
  }
  for (let i = 0; i < N; i++) seeds.push(seed());
  // Streamline: point at station x for seed s.
  function along(s, x, out) {
    if (s.kind === 'wing') {
      const z = s.z, c = wingChord(z), le = wingLE(z), wy = wingY(z), t = wingTC(z);
      const u = (le - x) / c, uc = Math.min(1, Math.max(0, u));
      const camber = 0.018 * c * Math.sin(Math.PI * uc);
      const near = Math.exp(-Math.abs(s.d) / (0.9 * c));
      // Follow the skin (upper or lower), fading with distance from it.
      let y = wy + s.d + (camber + Math.sign(s.d || 1) * naca(uc, t) * c) * near;
      // Upwash ahead of the leading edge, downwash behind the trailing edge.
      const A = 0.11 * c * Math.exp(-Math.abs(s.d) / c), B = 0.24 * c * Math.exp(-Math.abs(s.d) / (2 * c));
      if (u < 0) y += A * Math.exp(3 * u);
      else if (u <= 1) y += A * (1 - u) - B * 0.25 * Math.max(0, (u - 0.6) / 0.4) ** 2;
      else y -= B * (0.25 + 0.75 * (1 - Math.exp(-(u - 1) * 1.4)));
      out[0] = x; out[1] = y; out[2] = z;
      return out;
    }
    if (s.kind === 'body') {
      // Around the fuselage: a ring of air that stays clear of the skin.
      const R = s.rr + (x > NLG.x + 2 ? 0.6 * Math.exp(-(x - NLG.x - 2) / 3) : 0);
      out[0] = x; out[1] = YC + Math.sin(s.a) * R; out[2] = Math.cos(s.a) * R;
      return out;
    }
    // Tip vortex: below → outboard → up → inboard, tightening aft of the wing.
    const tz = s.side * (TIP_Z - 0.4), te = wingTE(TIP_Z), ty = wingY(TIP_Z) + 0.1;
    const aft = Math.max(0, te - x);
    const r = x > te ? s.r0 + (x - te) * 0.08 : s.r0 * (0.75 + 0.25 * Math.exp(-aft / 8));
    const ph = s.ph + aft * 0.55;
    out[0] = x; out[1] = ty + r * Math.sin(ph); out[2] = tz + s.side * r * Math.cos(ph);
    return out;
  }
  // ── Per-frame update ──
  let clock = 0, streakAlpha = 0;
  function update(dt, info) {
    clock += dt;
    const sw = info.lights || {};
    const dark = api.theme === 'dark';
    const onGround = !info.air;
    // Lights.
    for (const L of lights) {
      let on = false;
      if (L.key === 'pos') on = sw.pos === 0 || sw.pos === 2;
      else if (L.key === 'strobe') on = sw.pos === 0;
      else on = !!sw[L.key];
      if (L.onGear) on = on && info.gearDown;
      let a = on ? 1 : 0;
      if (on && L.kind === 'strobe') {
        // Double flash about once a second.
        const t = ((clock + (L.phase || 0)) % 1.1);
        a = t < 0.05 || (t > 0.12 && t < 0.17) ? 1 : 0;
      }
      if (on && L.kind === 'beacon') {
        const t = ((clock + L.phase * 0.55) % 1.1);
        a = t < 0.12 ? 1 : 0;
      }
      const vis = a * (dark ? 1 : 0.85);
      L.sprite.material.opacity += (vis - L.sprite.material.opacity) * Math.min(1, dt * (L.kind === 'strobe' || L.kind === 'beacon' ? 60 : 10));
      L.sprite.visible = L.sprite.material.opacity > 0.01;
      if (L.kind === 'flood') L.sprite.material.opacity = Math.min(L.sprite.material.opacity, L.base);
      // In daylight the glow needs a touch more body to read on a white floor.
      L.sprite.material.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
      if (L.beam) {
        const b = (on ? L.base : 0) * (dark ? 1 : 0.55);
        L.beam.material.opacity += (b - L.beam.material.opacity) * Math.min(1, dt * 8);
        L.beam.visible = L.beam.material.opacity > 0.01;
        L.beam.material.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
      }
      if (L.pool) {
        const p = on && onGround ? (dark ? 0.55 : 0.3) : 0;
        L.pool.material.opacity += (p - L.pool.material.opacity) * Math.min(1, dt * 8);
        L.pool.visible = L.pool.material.opacity > 0.01;
        L.pool.material.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
      }
    }
    // Ground equipment: only parked at the gate.
    const atGate = info.phase === 'ground';
    ground.visible = atGate && info.crew !== false;
    gpu.visible = atGate && !!info.gpu;
    pca.visible = atGate && !!info.pca;
    // Airflow: in flight only, speed and length with TAS; can be switched off.
    const tas = info.air && info.airflow !== false ? info.tas || 0 : 0;
    streakAlpha += ((tas > 0 ? (dark ? 0.5 : 0.38) : 0) - streakAlpha) * Math.min(1, dt * 2);
    streakMat.opacity = streakAlpha;
    streaks.visible = streakAlpha > 0.01;
    if (streaks.visible) {
      const v = 3 + tas * 0.04;                 // m/s on screen (compressed)
      const len = 1.2 + tas * 0.014;            // trail length, m
      const head = new THREE.Color(dark ? 0xd6eeff : 0x46525e);
      const bg = new THREE.Color(dark ? 0x0e1013 : 0xefefed);
      const P = [0, 0, 0];
      let o = 0;
      for (let i = 0; i < N; i++) {
        const sd = seeds[i];
        sd.x -= v * sd.k * dt;
        if (sd.x < X1) { seed(sd); sd.x = X0; }
        const edge = Math.max(0, Math.min(1, (sd.x - X1) / 6, (X0 - sd.x) / 6));
        for (let k = 0; k < K - 1; k++) {
          for (const kk of [k, k + 1]) {
            along(sd, sd.x + (len * kk) / (K - 1), P);
            pos[o] = P[0]; pos[o + 1] = P[1]; pos[o + 2] = P[2];
            // Bright at the head, fading into the background toward the tail.
            const f = edge * (1 - kk / (K - 1));
            col[o] = bg.r + (head.r - bg.r) * f; col[o + 1] = bg.g + (head.g - bg.g) * f; col[o + 2] = bg.b + (head.b - bg.b) * f;
            if (dark) { col[o] = head.r * f; col[o + 1] = head.g * f; col[o + 2] = head.b * f; }
            o += 3;
          }
        }
      }
      streakGeo.attributes.position.needsUpdate = true;
      streakGeo.attributes.color.needsUpdate = true;
      streakMat.blending = dark ? THREE.AdditiveBlending : THREE.NormalBlending;
    }
  }
  return { update };
}
