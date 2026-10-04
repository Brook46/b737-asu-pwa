// cockpit-cab.js — the flight deck "cab" pieces for cockpit.js:
//   windows()   moulded window frames (No. 1, 2, 3 each side) with rounded
//               glass openings, posts formed where frames meet, the
//               standby compass on the centre post and the No. 2 window crank;
//   yoke(s)     the 737 control column: floor boot, bent column, ram's-horn
//               wheel with grips, chart clip, trim switches, A/P disconnect
//               and mic switches (each pickable with its own name);
//   pedals(s)   rudder pedals with toe brakes;
//   breakers()  circuit breaker panels on the aft side walls (P18 captain
//               side, P6 first officer side), drawn as textures.
// Cockpit frame: metres, +x forward, +y up, +z right; captain at z −0.52.

import * as THREE from '../vendor/three.module.min.js?v=13';

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

/** The 737 control column and wheel. Returns the group (rotate .rotation.z to pitch). */
export function yoke(add, M, z, pickables) {
  const g = new THREE.Group();
  g.position.set(0.62, 0.02, z);        // pivot near the floor
  add(g);
  const name = (n) => ({ kind: 'lever', name: n });
  const mk = (geo, mat, pick, pos) => { const m = new THREE.Mesh(geo, mat); if (pos) m.position.set(...pos); m.userData.pick = pick; g.add(m); pickables.push(m); return m; };
  const colPick = name('Control column');
  // Floor boot.
  mk(new THREE.CylinderGeometry(0.06, 0.085, 0.12, 20), M.boot, colPick, [0, 0.06, 0]);
  // Column: straight up, then a bend back toward the pilot.
  const colCurve = new THREE.CatmullRomCurve3([V([0, 0.1, 0]), V([-0.005, 0.42, 0]), V([-0.03, 0.6, 0]), V([-0.09, 0.7, 0]), V([-0.14, 0.73, 0])]);
  mk(new THREE.TubeGeometry(colCurve, 30, 0.026, 14), M.column, colPick);
  // Hub facing the pilot (−x), with the column's end cap.
  const hubPick = name('Control wheel');
  const hub = mk(new THREE.CylinderGeometry(0.045, 0.05, 0.05, 24), M.column, hubPick, [-0.165, 0.735, 0]);
  hub.rotation.z = Math.PI / 2;
  const cap = mk(new THREE.CircleGeometry(0.036, 24), M.logo, hubPick, [-0.191, 0.735, 0]);
  cap.rotation.y = -Math.PI / 2;
  // Ram's-horn wheel: a flat top bar whose ends turn down into grips that splay out.
  const half = (sz) => new THREE.CatmullRomCurve3([
    V([-0.175, 0.765, 0]), V([-0.178, 0.775, sz * 0.06]), V([-0.18, 0.775, sz * 0.12]),
    V([-0.18, 0.76, sz * 0.155]), V([-0.178, 0.72, sz * 0.172]), V([-0.175, 0.665, sz * 0.19]), V([-0.172, 0.62, sz * 0.2]),
  ]);
  for (const sz of [-1, 1]) {
    mk(new THREE.TubeGeometry(half(sz), 40, 0.015, 12), M.wheel, hubPick);
    // Spoke from hub to the bar.
    mk(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V([-0.17, 0.735, sz * 0.03]), V([-0.175, 0.755, sz * 0.07]), V([-0.178, 0.77, sz * 0.1])]), 10, 0.011, 8), M.wheel, hubPick);
    // Grip (thicker, textured rubber) on the lower horn.
    const grip = new THREE.CatmullRomCurve3([V([-0.178, 0.735, sz * 0.165]), V([-0.175, 0.68, sz * 0.185]), V([-0.172, 0.625, sz * 0.199])]);
    mk(new THREE.TubeGeometry(grip, 14, 0.021, 12), M.grip, name('Control wheel grip'));
  }
  // Chart clip on the top bar, with a checklist card.
  mk(new THREE.BoxGeometry(0.012, 0.05, 0.16), M.column, name('Chart clip'), [-0.17, 0.8, 0]);
  const card = mk(new THREE.PlaneGeometry(0.15, 0.04), M.card, name('Chart clip'), [-0.177, 0.8, 0]);
  card.rotation.y = -Math.PI / 2;
  // Captain's wheel: trim switches on the left horn; A/P disconnect on the outboard grip; mic on the inboard.
  const left = z < 0 ? -1 : -1;    // both wheels carry the trim switches on the left horn
  for (const dz of [-0.012, 0.012]) {
    mk(new THREE.BoxGeometry(0.014, 0.022, 0.01), M.knob, name('Stabilizer trim switches'), [-0.19, 0.775, left * 0.135 + dz]);
  }
  const outboard = z < 0 ? -1 : 1;
  const ap = mk(new THREE.CylinderGeometry(0.011, 0.011, 0.012, 14), M.red, name('Autopilot disconnect switch'), [-0.19, 0.73, outboard * 0.17]);
  ap.rotation.z = Math.PI / 2;
  const mic = mk(new THREE.BoxGeometry(0.012, 0.016, 0.02), M.knob, name('Microphone switch'), [-0.19, 0.73, -outboard * 0.17]);
  void mic;
  return g;
}

/** Rudder pedals with toe brakes. */
export function pedals(add, M, z, pickables) {
  for (const dz of [-0.1, 0.1]) {
    const arm = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.26, 0.03), M.column));
    arm.position.set(0.86, 0.22, z + dz); arm.rotation.z = -0.25;
    const pad = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.16, 0.09), M.boot));
    pad.position.set(0.82, 0.17, z + dz); pad.rotation.z = 0.55;
    const toe = add(new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.05, 0.09), M.grip));
    toe.position.set(0.79, 0.24, z + dz); toe.rotation.z = 0.55;
    for (const m of [arm, pad, toe]) { m.userData.pick = { kind: 'lever', name: 'Rudder pedals and brakes' }; pickables.push(m); }
  }
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

/** Circuit breaker panels on the aft side walls (P18 left, P6 right). */
export function breakers(add, M, pickables) {
  const groups = [
    ['ELECTRICAL', 'HYDRAULICS', 'FUEL', 'FLIGHT CONTROLS'],
    ['ANTI-ICE', 'AIR CONDITIONING', 'LANDING GEAR', 'LIGHTING'],
  ];
  const panels = [];
  for (const [s, title, list] of [[-1, 'P18', groups[0]], [1, 'P6', groups[1]]]) {
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 768;
    const g = c.getContext('2d');
    g.fillStyle = '#5d666d'; g.fillRect(0, 0, 1024, 768);
    g.fillStyle = '#e9ecef'; g.font = '700 26px Helvetica, Arial'; g.textAlign = 'left';
    g.fillText(`${title}  CIRCUIT BREAKER PANEL`, 24, 40);
    const cols = 16, rows = 5;
    list.forEach((grp, gi) => {
      const y0 = 70 + gi * 172;
      g.fillStyle = '#4a5258'; g.fillRect(16, y0, 992, 160);
      g.fillStyle = '#f1f3f5'; g.font = '700 18px Helvetica, Arial';
      g.fillText(grp, 28, y0 + 22);
      for (let r = 0; r < rows - 1; r++) for (let k = 0; k < cols; k++) {
        const x = 52 + k * 60, y = y0 + 48 + r * 30;
        // White collar, black button; a few with coloured collars (essential).
        g.fillStyle = (k + r * 3 + gi) % 11 === 0 ? '#e8b11a' : '#f3f3f3';
        g.beginPath(); g.arc(x, y, 11, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#111'; g.beginPath(); g.arc(x, y, 7.5, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#c9cfd4'; g.fillRect(x - 20, y + 12, 40, 3);
      }
    });
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const W = 0.8, H = 0.6;
    const m = add(new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 })));
    m.position.set(-0.52, 0.86, s * 1.025);
    m.rotation.y = s < 0 ? 0 : Math.PI;
    m.userData.pick = { kind: 'static', name: `${title} circuit breaker panel` };
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
