// cockpit-cab.js — the flight deck "cab" pieces for cockpit.js:
//   windows()   moulded window frames (No. 1, 2, 3 each side) with rounded
//               glass openings, posts formed where frames meet, the
//               standby compass on the centre post and the No. 2 window crank;
//   yoke(s)     the 737 control column: floor boot, bent column, ram's-horn
//               wheel with grips, chart clip, trim switches, A/P disconnect
//               and mic switches (each pickable with its own name);
//   pedals(s)   rudder pedals with toe brakes;
//   breakers()  circuit breaker panels on the aft bulkhead behind the seats (P18 captain
//               side, P6 first officer side), drawn as textures.
// Cockpit frame: metres, +x forward, +y up, +z right; captain at z −0.52.

import * as THREE from '../vendor/three.module.min.js?v=21';

const V = (a) => new THREE.Vector3(...a);

/** Rounded convex polygon path (2D points, corner radius r). */
function roundedPath(path, pts, r) {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[(i + n - 1) % n], b = pts[(i + 1) % n];
    const da = a.clone().sub(p), db = b.clone().sub(p);
    const ra = Math.min(r, da.length() / 2.2), rb = Math.min(r, db.length() / 2.2);
    const pa = p.clone().add(da.normalize().multiplyScalar(ra)), pb = p.clone().add(db.normalize().multiplyScalar(rb));
    if (i === 0) path.moveTo(pa.x, pa.y); else path.lineTo(pa.x, pa.y);
    path.quadraticCurveTo(p.x, p.y, pb.x, pb.y);
  }
  path.closePath();
  return path;
}

/** Offset a convex 2D polygon (counter-clockwise) outward; m = number or per-edge array. */
function offset(pts, m) {
  const n = pts.length, lines = [];
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const d = b.clone().sub(a).normalize();
    const nrm = new THREE.Vector2(d.y, -d.x);           // outward for CCW
    lines.push({ p: a.clone().add(nrm.clone().multiplyScalar(Array.isArray(m) ? m[i] : m)), d });
  }
  const out = [];
  for (let i = 0; i < n; i++) {
    const L1 = lines[(i + n - 1) % n], L2 = lines[i];
    const den = L1.d.x * L2.d.y - L1.d.y * L2.d.x;
    if (Math.abs(den) < 1e-6) { out.push(L2.p.clone()); continue; }
    const t = ((L2.p.x - L1.p.x) * L2.d.y - (L2.p.y - L1.p.y) * L2.d.x) / den;
    out.push(L1.p.clone().add(L1.d.clone().multiplyScalar(t)));
  }
  return out;
}

/**
 * A window: glass in a moulded frame. quad = 3D corners (roughly planar).
 * frame = margin around the glass (m); posts appear where frames meet.
 */
function windowFrame(add, quad, { frame = 0.045, frameTop = 0.3, r = 0.05, depth = 0.05, M, inside = V([0.2, 1.2, 0]) }) {
  const P = quad.map(V);
  const c = P.reduce((a, p) => a.add(p), new THREE.Vector3()).multiplyScalar(1 / P.length);
  const e1 = P[1].clone().sub(P[0]).normalize();
  let n = new THREE.Vector3().crossVectors(P[1].clone().sub(P[0]), P[3].clone().sub(P[0])).normalize();
  if (n.dot(inside.clone().sub(c)) < 0) n.negate();       // n points into the cabin
  const e2 = new THREE.Vector3().crossVectors(n, e1).normalize();
  let pts = P.map((p) => new THREE.Vector2(p.clone().sub(c).dot(e1), p.clone().sub(c).dot(e2)));
  // Counter-clockwise for the offset maths.
  const area = pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p.x * q.y - q.x * p.y; }, 0);
  let P3 = P;
  if (area < 0) { pts = pts.reverse(); P3 = [...P].reverse(); }
  // Per-edge frame width: deep at the top (the frames merge into the crown
  // lining, no sky between them), normal at the sides, slim at the sill.
  const ys = P3.map((p, i) => (p.y + P3[(i + 1) % P3.length].y) / 2);
  const top = Math.max(...ys), bot = Math.min(...ys);
  const margins = ys.map((y) => (y === top ? frameTop : y === bot ? frame * 0.8 : frame));
  const outer = offset(pts, margins);
  const shape = roundedPath(new THREE.Shape(), outer, r * 0.6);
  shape.holes.push(roundedPath(new THREE.Path(), pts, r));
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.01, bevelSegments: 2, curveSegments: 6 });
  const basis = new THREE.Matrix4().makeBasis(e1, e2, n).setPosition(c.clone().addScaledVector(n, -depth * 0.35));
  geo.applyMatrix4(basis);
  geo.computeVertexNormals();
  const frameMesh = add(new THREE.Mesh(geo, M.trim));
  // Glass, set back in the frame, with a faint sky reflection.
  const gl = new THREE.ShapeGeometry(roundedPath(new THREE.Shape(), pts, r), 6);
  gl.applyMatrix4(new THREE.Matrix4().makeBasis(e1, e2, n).setPosition(c.clone().addScaledVector(n, -depth * 0.3)));
  const glass = add(new THREE.Mesh(gl, M.glass));
  return { frame: frameMesh, glass, c, n, e1, e2 };
}

export function windows(add, M) {
  const out = [];
  for (const s of [-1, 1]) {
    // No. 1 (front), No. 2 (sliding), No. 3 (aft) — inner corners first.
    const W1 = [[0.99, 1.135, s * 0.045], [0.905, 1.135, s * 0.585], [0.72, 1.515, s * 0.52], [0.8, 1.56, s * 0.045]];
    const W2 = [[0.875, 1.14, s * 0.66], [0.47, 1.14, s * 0.955], [0.375, 1.49, s * 0.865], [0.695, 1.53, s * 0.585]];
    const W3 = [[0.405, 1.15, s * 0.985], [0.05, 1.15, s * 1.035], [0.05, 1.42, s * 0.985], [0.31, 1.47, s * 0.9]];
    for (const q of [W1, W2, W3]) out.push(windowFrame(add, q, { M, frame: q === W1 ? 0.04 : 0.05 }));
    // Sill fairing under No. 2 / No. 3 down to the side wall.
    const sill = new THREE.BufferGeometry();
    sill.setAttribute('position', new THREE.Float32BufferAttribute([
      0.9, 1.11, s * 0.62, 0.02, 1.11, s * 1.0, 0.02, 1.06, s * 1.06, 0.9, 1.06, s * 0.66,
    ], 3));
    sill.setIndex(s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2]);
    sill.computeVertexNormals();
    add(new THREE.Mesh(sill, M.trimSide));
    // No. 2 window crank handle, low and aft on the frame.
    const crank = add(new THREE.Group());
    crank.position.set(0.5, 1.2, s * 0.93);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.03, 16), M.metal);
    hub.rotation.x = Math.PI / 2;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, 0.012), M.metal);
    arm.position.set(0.03, 0, -s * 0.015);
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.035, 10), M.knob);
    knob.rotation.x = Math.PI / 2; knob.position.set(0.065, 0, -s * 0.03);
    crank.add(hub, arm, knob);
    crank.userData.pick = { kind: 'static', name: 'No. 2 window handle' };
    for (const m of crank.children) m.userData.pick = crank.userData.pick;
  }
  // Standby magnetic compass at the top of the centre post.
  const compass = add(new THREE.Group());
  compass.position.set(0.78, 1.585, 0);
  const box = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.08), M.dark);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.05, 0.035), new THREE.MeshBasicMaterial({ color: 0xe9e2c8 }));
  face.position.set(-0.031, -0.004, 0); face.rotation.y = -Math.PI / 2;
  compass.add(box, face);
  box.userData.pick = face.userData.pick = { kind: 'static', name: 'Standby magnetic compass' };
  return { parts: out, compass: [box, face] };
}

/**
 * A solid, bevelled band along a 2D centre line (s = lateral, t = up), with a
 * width that can vary along it — used for the control wheel's U.
 */
function band(pts, width, depth) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, y]) => V([x, y, 0])));
  const N = 60, L = [], R = [];
  for (let i = 0; i <= N; i++) {
    const u = i / N, p = curve.getPoint(u), tg = curve.getTangent(u);
    const w = width(u) / 2;
    L.push([p.x - tg.y * w, p.y + tg.x * w]);
    R.push([p.x + tg.y * w, p.y - tg.x * w]);
  }
  const sh = new THREE.Shape();
  sh.moveTo(...L[0]);
  for (const q of L.slice(1)) sh.lineTo(...q);
  // Round the far tip, back along the other edge, round the start tip.
  const tip = (a, b) => { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; return m; };
  const e1 = curve.getTangent(1), t1 = tip(L[N], R[N]);
  sh.quadraticCurveTo(t1[0] + e1.x * 0.025, t1[1] + e1.y * 0.025, ...R[N]);
  for (const q of R.slice(0, N).reverse()) sh.lineTo(...q);
  const e0 = curve.getTangent(0), t0 = tip(L[0], R[0]);
  sh.quadraticCurveTo(t0[0] - e0.x * 0.025, t0[1] - e0.y * 0.025, ...L[0]);
  const g = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: 0.007, bevelSize: 0.006, bevelSegments: 3, curveSegments: 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}

/**
 * The 737 NG control column and wheel (FCOM 1.20 captain control wheel
 * detail): a column from the floor to a hub at the bottom of a U-shaped
 * wheel whose horns rise and splay out to the grips; a writing pad / checklist
 * clip on the centre; stab trim switch on top of the outboard horn, A/P
 * disengage switch just below it, push-to-talk on the back of the outboard
 * horn, the memory device on the inboard horn.
 * Returns the group (rotate .rotation.z to pitch, the wheel group to roll).
 */
export function yoke(add, M, z, pickables) {
  const g = new THREE.Group();
  g.position.set(0.62, 0.02, z);        // pivot near the floor
  add(g);
  const name = (n) => ({ kind: 'lever', name: n });
  const reg = (m, pick) => { m.userData.pick = pick; pickables.push(m); return m; };
  const mk = (geo, mat, pick, pos, parent = g) => { const m = new THREE.Mesh(geo, mat); if (pos) m.position.set(...pos); reg(m, pick); parent.add(m); return m; };
  const colPick = name('Control column');
  const colMat = new THREE.MeshStandardMaterial({ color: 0x34383c, roughness: 0.5, metalness: 0.25 });
  // Floor boot (leather gaiter) and the column: square-ish, tapering, leaning a little aft.
  mk(new THREE.CylinderGeometry(0.055, 0.09, 0.14, 4, 1).rotateY(Math.PI / 4), M.boot, colPick, [0, 0.07, 0]);
  const colGeo = new THREE.CylinderGeometry(0.026, 0.036, 0.58, 4, 1).rotateY(Math.PI / 4);
  const col = mk(colGeo, colMat, colPick, [-0.022, 0.42, 0]);
  col.rotation.z = 0.08;
  // Column head and the shaft to the wheel hub.
  mk(new THREE.BoxGeometry(0.075, 0.07, 0.07), colMat, colPick, [-0.047, 0.705, 0]);
  const shaft = mk(new THREE.CylinderGeometry(0.02, 0.02, 0.09, 16), M.metal, colPick, [-0.1, 0.695, 0]);
  shaft.rotation.z = Math.PI / 2;

  // The wheel: its own group so it can roll; plane faces the pilot (−x).
  const W = new THREE.Group();
  W.position.set(-0.15, 0.695, 0);
  g.add(W);
  const wheelPick = name('Control wheel');
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x2a2c2f, roughness: 0.45, metalness: 0.1 });
  const hubMat = new THREE.MeshStandardMaterial({ color: 0x3b3f44, roughness: 0.4, metalness: 0.2 });
  const inWheel = (geo, mat, pick, pos) => { const m = new THREE.Mesh(geo, mat); m.rotation.y = -Math.PI / 2; if (pos) m.position.set(...pos); reg(m, pick); W.add(m); return m; };
  // U centre line, left horn tip → bottom → right horn tip (s, t in metres).
  const U = [[-0.165, 0.2], [-0.19, 0.12], [-0.175, 0.04], [-0.12, -0.02], [0, -0.04], [0.12, -0.02], [0.175, 0.04], [0.19, 0.12], [0.165, 0.2]];
  inWheel(band(U, (u) => 0.036 + 0.018 * Math.sin(Math.PI * u) ** 8 + 0.012 * (1 - Math.abs(2 * u - 1)), 0.026), wheelMat, wheelPick);
  // Rubber grips on the upper horns.
  for (const sz of [-1, 1]) {
    const GP = [[sz * 0.188, 0.06], [sz * 0.19, 0.12], [sz * 0.168, 0.19]];
    inWheel(band(GP, () => 0.046, 0.034), M.grip, name('Control wheel grip'));
  }
  // Hub at the bottom centre, with the Boeing cap facing the pilot.
  const hub = mk(new THREE.CylinderGeometry(0.042, 0.046, 0.05, 28), hubMat, wheelPick, [0.01, -0.025, 0], W);
  hub.rotation.z = Math.PI / 2;
  const cap = mk(new THREE.CircleGeometry(0.03, 24), M.logo, wheelPick, [-0.017, -0.025, 0], W);
  cap.rotation.y = -Math.PI / 2;
  // Writing pad holder / checklist clip on the centre, rising from the hub.
  mk(new THREE.BoxGeometry(0.014, 0.19, 0.082), hubMat, name('Chart clip'), [-0.012, 0.075, 0], W);
  {
    const c = document.createElement('canvas'); c.width = 128; c.height = 300;
    const q = c.getContext('2d');
    q.fillStyle = '#f2efe6'; q.fillRect(0, 0, 128, 300);
    q.fillStyle = '#222'; q.font = '700 13px Helvetica, Arial'; q.textAlign = 'center';
    q.fillText('NORMAL', 64, 22); q.fillText('CHECKLIST', 64, 38);
    q.font = '500 9px Helvetica, Arial'; q.textAlign = 'left';
    for (let i = 0; i < 18; i++) { q.fillRect(10, 56 + i * 13, 60, 1.2); q.fillRect(80, 56 + i * 13, 38, 1.2); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const card = mk(new THREE.PlaneGeometry(0.068, 0.16), new THREE.MeshStandardMaterial({ map: t, roughness: 0.9 }), name('Chart clip'), [-0.0205, 0.075, 0], W);
    card.rotation.y = -Math.PI / 2;
    mk(new THREE.BoxGeometry(0.01, 0.014, 0.07), M.metal, name('Chart clip'), [-0.024, 0.16, 0], W);
  }
  // Switches. Outboard horn: stab trim (two thumb rockers on top), A/P disengage
  // (red, inner face near the top), push-to-talk (back of the horn). Inboard
  // horn: the memory device.
  const ob = z < 0 ? -1 : 1;
  for (const dz of [-0.008, 0.008]) mk(new THREE.BoxGeometry(0.016, 0.02, 0.009), M.knob, name('Stabilizer trim switches'), [-0.012, 0.215, ob * 0.165 + dz], W);
  const ap = mk(new THREE.CylinderGeometry(0.009, 0.009, 0.01, 14), M.red, name('Autopilot disconnect switch'), [-0.02, 0.16, ob * 0.163], W);
  ap.rotation.z = Math.PI / 2;
  mk(new THREE.BoxGeometry(0.01, 0.022, 0.018), M.knob, name('Microphone switch'), [0.022, 0.07, ob * 0.188], W);
  const mem = mk(new THREE.CylinderGeometry(0.013, 0.013, 0.02, 16), M.metal, name('Memory device'), [-0.005, 0.205, -ob * 0.168], W);
  void mem;
  g.userData.wheel = W;
  return g;
}

/**
 * Rudder pedals with toe brakes: Boeing pedals hang from pivots under the
 * main panel; each pedal is a tall plate with a ribbed rubber face (push the
 * top for the brakes). A footrest bar sits between them.
 */
export function pedals(add, M, z, pickables) {
  const pick = { kind: 'lever', name: 'Rudder pedals and brakes' };
  const reg = (m) => { m.userData.pick = pick; pickables.push(m); return m; };
  const c = document.createElement('canvas'); c.width = 64; c.height = 160;
  const q = c.getContext('2d');
  q.fillStyle = '#1b1c1e'; q.fillRect(0, 0, 64, 160);
  q.fillStyle = '#2f3134';
  for (let y = 6; y < 154; y += 10) q.fillRect(6, y, 52, 5);
  const tread = new THREE.CanvasTexture(c); tread.colorSpace = THREE.SRGBColorSpace;
  const face = new THREE.MeshStandardMaterial({ map: tread, roughness: 0.95 });
  for (const dz of [-0.11, 0.11]) {
    const g = add(new THREE.Group());
    g.position.set(0.86, 0.5, z + dz);              // pivot under the panel
    // Hanger arm down and slightly aft, then the pedal plate leaning back.
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.3, 0.02), M.column);
    arm.position.set(-0.03, -0.15, 0); arm.rotation.z = -0.2;
    const plateM = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.2, 0.1), M.column);
    plateM.position.set(-0.075, -0.33, 0); plateM.rotation.z = -0.35;
    const rubber = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.19), face);
    rubber.position.set(-0.0855, -0.326, 0); rubber.rotation.set(0, -Math.PI / 2, 0); rubber.rotateX(-0.35);
    g.add(arm, plateM, rubber);
    for (const m of [arm, plateM, rubber]) reg(m);
  }
  // Footwell front (kick panel) the pedal hangers disappear into.
  const kick = add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.6, 0.68), M.shell));
  kick.position.set(0.93, 0.3, z + (z < 0 ? -0.03 : 0.03));
  // Footrest bar below the panel.
  const bar = add(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.42, 12), M.metal));
  bar.rotation.x = Math.PI / 2; bar.position.set(0.845, 0.08, z);
}

/** Pilot seat: cushion, back, headrest, armrests. */
export function seat(add, M, z) {
  const g = add(new THREE.Group());
  g.position.set(-0.22, 0, z);
  const box = (sx, sy, sz, p, mat = M.seat, rz = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat); m.position.set(...p); m.rotation.z = rz; g.add(m); return m; };
  box(0.36, 0.34, 0.36, [0, 0.2, 0], M.column);                 // pedestal / tracks
  box(0.5, 0.11, 0.5, [0.02, 0.43, 0]);                         // cushion
  box(0.11, 0.72, 0.48, [-0.24, 0.84, 0], M.seat, 0.12);        // back
  box(0.09, 0.16, 0.3, [-0.29, 1.27, 0], M.seat, 0.12);         // headrest
  for (const dz of [-0.27, 0.27]) box(0.36, 0.04, 0.06, [-0.03, 0.64, dz], M.column);
}

/**
 * Circuit breaker panels on the aft bulkhead, behind the pilots' seats (FCOM
 * 1.20 aft flight deck overview): P6 behind the first officer — a tall bank
 * from the floor nearly to the ceiling (P6-1 nav / inst / comm at the top,
 * P6-2 systems, P6-3 fuel / lighting / gear, P6-4 air cond & electrical, P6-11
 * and P6-12 window heat low down) — and P18 behind the captain, at shoulder
 * height (P18-1 nav, P18-2 inst & comm, P18-3 anti-ice & lighting).
 */
export function breakers(add, M, pickables) {
  const BANKS = [
    { title: 'P6', z: 0.735, w: 0.54, y0: 0.08, y1: 1.86, rows: [
      ['P6-1', 'NAV · INST · COMM', 5], ['P6-2', 'SYSTEMS', 5], ['P6-3', 'FUEL · LIGHTING · LANDING GEAR', 5],
      ['P6-4', 'AIR CONDITIONING · ELECTRICAL', 6], ['P6-11 · P6-12', 'WINDOW HEAT', 3]] },
    { title: 'P18', z: -0.66, w: 0.6, y0: 1.12, y1: 1.82, rows: [
      ['P18-1', 'NAV', 3], ['P18-2', 'INST & COMM', 3], ['P18-3', 'ANTI-ICE · LIGHTING', 3]] },
  ];
  const panels = [];
  for (const B of BANKS) {
    const H = B.y1 - B.y0, PX = 900;                           // canvas px per metre
    const c = document.createElement('canvas');
    c.width = Math.round(B.w * PX); c.height = Math.round(H * PX);
    const g = c.getContext('2d');
    g.fillStyle = '#5d666d'; g.fillRect(0, 0, c.width, c.height);
    const total = B.rows.reduce((a, r) => a + r[2] + 1.6, 0);
    let y = 8;
    const unit = (c.height - 8 - B.rows.length * 8) / total;
    for (const [id, name, n] of B.rows) {
      const h = unit * (n + 1.6);
      g.fillStyle = '#4a5258'; g.fillRect(8, y, c.width - 16, h);
      g.fillStyle = '#f1f3f5'; g.font = '700 15px Helvetica, Arial'; g.textAlign = 'left';
      g.fillText(`${id}  ${name}`, 16, y + 19);
      const cols = Math.floor((c.width - 40) / 34);
      for (let r = 0; r < n; r++) for (let k = 0; k < cols; k++) {
        const x = 30 + k * 34, yy = y + 38 + r * unit;
        // White collar, black button; a few with coloured collars (essential).
        g.fillStyle = (k + r * 3 + id.length) % 11 === 0 ? '#e8b11a' : '#f3f3f3';
        g.beginPath(); g.arc(x, yy, 9, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#111'; g.beginPath(); g.arc(x, yy, 6, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#c9cfd4'; g.fillRect(x - 13, yy + 11, 26, 2);
      }
      y += h + 8;
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    // On the bulkhead face (x ≈ −0.98), facing forward.
    const m = add(new THREE.Mesh(new THREE.PlaneGeometry(B.w, H), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })));
    m.position.set(-0.975, (B.y0 + B.y1) / 2, B.z);
    m.rotation.y = Math.PI / 2;
    m.userData.pick = { kind: 'static', name: `${B.title} circuit breaker panel` };
    pickables.push(m);
    panels.push(m);
  }
  return panels;
}

/** Flight deck door on the aft bulkhead: panel, viewer, handle, lock indicator. */
export function door(add, M, pickables) {
  const g = add(new THREE.Group());
  g.position.set(-0.975, 0, 0.12);
  const pick = { kind: 'static', name: 'Flight deck door' };
  const mk = (geo, mat, p) => { const m = new THREE.Mesh(geo, mat); m.position.set(...p); m.rotation.y = Math.PI / 2; m.userData.pick = pick; g.add(m); pickables.push(m); return m; };
  mk(new THREE.BoxGeometry(0.62, 1.86, 0.03), M.trim, [0, 0.93, 0]);
  mk(new THREE.BoxGeometry(0.66, 1.9, 0.015), M.column, [-0.012, 0.95, 0]);
  const viewer = mk(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 12), M.metal, [0.02, 1.55, 0]);
  viewer.rotation.set(0, 0, Math.PI / 2);
  mk(new THREE.BoxGeometry(0.14, 0.03, 0.03), M.metal, [0.03, 1.0, 0.22]);
  mk(new THREE.BoxGeometry(0.05, 0.08, 0.02), M.dark, [0.025, 1.12, 0.22]);
}
