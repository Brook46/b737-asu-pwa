// dims.js — dimension drawings around the 3D airplane, like a drafting sheet
// laid on the hangar floor: principal dimensions written on the ground (read
// from the top view), the height standing up beside the tail (read from the
// side view), and the minimum-radius turn (nose, wingtip and tail circles
// round the turn centre). Labels carry the FCOM 1.10 figures (737-800W); the
// lines are drawn to the model's geometry.

import * as THREE from '../vendor/three.module.min.js?v=30';

const D2R = Math.PI / 180;

export function createDims(scene, airframe, NLG, MLG) {
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);
  const principal = new THREE.Group(), turning = new THREE.Group();
  root.add(principal, turning);
  let ink = '#1d2126', accent = '#c2410c';

  // Model extents (ground pose), from the visible meshes only (slides,
  // straps and x-ray twins are hidden and must not count).
  const shown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
  const meshes = [];
  airframe.root.updateMatrixWorld(true);
  // The skin only: light beams, airflow and the like hang off the airframe too.
  for (const m of airframe.skin || []) if (m.isMesh && m.geometry?.attributes?.position && shown(m)) meshes.push(m);
  const box = new THREE.Box3();
  for (const m of meshes) { m.geometry.computeBoundingBox(); box.union(m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld)); }
  const NOSE = box.max.x, TAIL = box.min.x, SEMI = Math.max(box.max.z, -box.min.z), TOP = box.max.y;
  // Wingtip: the outboard-most point of the right wing (sampled from the model).
  let wingTip = new THREE.Vector3(0, 0, SEMI);
  {
    const pos = new THREE.Vector3(); let best = -1e9;
    for (const m of meshes) {
      const a = m.geometry.attributes.position;
      for (let i = 0; i < a.count; i += 3) { pos.fromBufferAttribute(a, i).applyMatrix4(m.matrixWorld); if (pos.z > best) { best = pos.z; wingTip = new THREE.Vector3(pos.x, 0.012, pos.z); } }
    }
  }
  const SPAN_X = wingTip.x;
  const Y = 0.012;                       // just above the floor
  const v = (x, z, y = Y) => new THREE.Vector3(x, y, z);

  function lineMat(color, dashed) {
    return dashed ? new THREE.LineDashedMaterial({ color, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.85 })
      : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
  }
  function seg(group, pts, color, dashed = false) {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat(color, dashed));
    if (dashed) l.computeLineDistances();
    l.renderOrder = 3;
    group.add(l);
    return l;
  }
  /** Text drawn on a canvas: flat on the ground (rot = angle in the ground plane) or a sprite. */
  function label(group, text, pos, { rot = 0, size = 1.1, sprite = false, color = ink } = {}) {
    const lines = text.split('\n');
    const c = document.createElement('canvas');
    const fs = 64, pad = 18;
    const g0 = c.getContext('2d');
    g0.font = `700 ${fs}px "JetBrains Mono", Menlo, monospace`;
    const w = Math.max(...lines.map((l) => g0.measureText(l).width)) + pad * 2;
    c.width = Math.ceil(w); c.height = Math.ceil(lines.length * fs * 1.15 + pad);
    const g = c.getContext('2d');
    g.font = `700 ${fs}px "JetBrains Mono", Menlo, monospace`;
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => { g.font = `${i ? 500 : 700} ${i ? fs * 0.72 : fs}px "JetBrains Mono", Menlo, monospace`; g.fillText(l, c.width / 2, pad / 2 + (i + 0.5) * fs * 1.15); });
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
    const h = size * (c.height / fs), wM = h * (c.width / c.height);
    let m;
    if (sprite) {
      m = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthTest: false }));
      m.scale.set(wM, h, 1);
    } else {
      m = new THREE.Mesh(new THREE.PlaneGeometry(wM, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, side: THREE.DoubleSide }));
      m.rotation.set(-Math.PI / 2, 0, rot);
    }
    m.position.copy(pos);
    m.renderOrder = 4;
    group.add(m);
    return m;
  }
  function arrow(group, at, dir, color) {
    // Small filled triangle on the ground pointing along dir.
    const d = dir.clone().normalize(), n = new THREE.Vector3(-d.z, 0, d.x);
    const s = 0.55;
    const pts = [at, at.clone().addScaledVector(d, -s).addScaledVector(n, s * 0.35), at.clone().addScaledVector(d, -s).addScaledVector(n, -s * 0.35)];
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
    m.renderOrder = 3;
    group.add(m);
  }
  /**
   * A ground dimension between a and b, pushed out along `out` by `off`, with
   * extension lines, arrowheads and the text along the line.
   */
  function groundDim(group, a, b, out, off, text, at = 'mid') {
    const o = out.clone().normalize();
    const a2 = a.clone().addScaledVector(o, off), b2 = b.clone().addScaledVector(o, off);
    seg(group, [a.clone().addScaledVector(o, 0.4), a2.clone().addScaledVector(o, 0.6)], ink);
    seg(group, [b.clone().addScaledVector(o, 0.4), b2.clone().addScaledVector(o, 0.6)], ink);
    seg(group, [a2, b2], ink);
    const d = b2.clone().sub(a2);
    arrow(group, a2, d.clone().negate(), ink); arrow(group, b2, d, ink);
    // Text along the line, its top facing outward, sitting just outside it.
    let ang = Math.atan2(-d.z, d.x);
    if (Math.cos(ang) < -1e-6 || (Math.abs(Math.cos(ang)) < 1e-6 && Math.sin(ang) < 0)) ang += Math.PI;   // keep it upright
    // Text: centred outside the line, or past its far end (when the middle is under the airplane).
    const dn = d.clone().normalize();
    const pos = at === 'end' ? b2.clone().addScaledVector(dn, 4.2) : a2.clone().add(b2).multiplyScalar(0.5).addScaledVector(o, 1.2);
    label(group, text, pos, { rot: ang });
  }
  function vertDim(group, x, z, y0, y1, text, side = 1) {
    const p0 = new THREE.Vector3(x, y0, z), p1 = new THREE.Vector3(x, y1, z);
    seg(group, [p0, p1], ink);
    for (const p of [p0, p1]) seg(group, [p.clone().add(new THREE.Vector3(-0.5, 0, 0)), p.clone().add(new THREE.Vector3(0.5, 0, 0))], ink);
    label(group, text, new THREE.Vector3(x - 2.4 * side, (y0 + y1) / 2, z), { sprite: true, size: 0.9 });
  }

  function build() {
    for (const g of [principal, turning]) { for (const c of [...g.children]) { c.geometry?.dispose(); c.material?.map?.dispose(); c.material?.dispose(); g.remove(c); } }
    // ── Principal dimensions (737-800W, FCOM 1.10) ──
    groundDim(principal, v(TAIL, SEMI), v(NOSE, SEMI), new THREE.Vector3(0, 0, 1), 3.5, 'LENGTH 39.47 m\n129 ft 6 in');
    // Wingspan across the wingtips, just ahead of the leading edge at the tips.
    groundDim(principal, v(SPAN_X, -SEMI), v(SPAN_X, SEMI), new THREE.Vector3(-1, 0, 0), 3, 'WINGSPAN 35.79 m\n117 ft 5 in (winglets)', 'end');
    groundDim(principal, v(TAIL, -7.18), v(TAIL, 7.18), new THREE.Vector3(-1, 0, 0), 2.5, 'TAILPLANE 14.35 m\n47 ft 1 in');
    groundDim(principal, v(MLG.x, -MLG.z), v(MLG.x, MLG.z), new THREE.Vector3(-1, 0, 0), 4.2, 'GEAR TRACK 5.72 m\n18 ft 9 in', 'end');
    groundDim(principal, v(MLG.x, -SEMI * 0.55), v(NLG.x, -SEMI * 0.55), new THREE.Vector3(0, 0, -1), 0.01, 'WHEELBASE 15.60 m\n51 ft 2 in');
    seg(principal, [v(MLG.x, -MLG.z), v(MLG.x, -SEMI * 0.55)], ink, true);
    seg(principal, [v(NLG.x, 0), v(NLG.x, -SEMI * 0.55)], ink, true);
    vertDim(principal, TAIL + 1.5, 12, 0, TOP, 'HEIGHT ≈ 12.62 m\n41 ft 5 in (fin top)', -1);
    seg(principal, [v(TAIL + 1.5, 12, TOP), v(TAIL + 1.5, 0, TOP)], ink, true);
    // ── Minimum-radius turn (left turn; effective steering angle 75°) ──
    // Built from the FCOM 1.10 figures: the turn centre lies on the main gear
    // axle line, wheelbase ÷ tan 75° to the inside; the nose radius then fixes
    // where that axle line is, and the circles carry the FCOM radii (nose,
    // wingtip, tail — the tail figure is to the tailplane tip).
    const c = 15.6 / Math.tan(75 * D2R);                              // 4.18 m
    const axleX = NOSE - Math.sqrt(20.1 * 20.1 - c * c);
    const ctr = v(axleX, -c);
    const circle = (r, color, text, at) => {
      const pts = [];
      for (let i = 0; i <= 160; i++) { const a = (i / 160) * Math.PI * 2; pts.push(v(ctr.x + r * Math.cos(a), ctr.z + r * Math.sin(a))); }
      seg(turning, pts, color, true);
      label(turning, text, at, { color, size: 1.0 });
    };
    const R = { nose: 20.1, tip: 23.0, tail: 22.8 };
    circle(R.nose, '#2563eb', 'NOSE R 20.1 m · 66.0 ft', v(ctr.x + R.nose * 0.74, ctr.z - R.nose * 0.74));
    circle(R.tip, accent, 'WINGTIP R 23.0 m · 75.3 ft', v(ctr.x + 1, ctr.z + R.tip + 1.4));
    circle(R.tail, '#15803d', 'TAIL R 22.8 m · 74.8 ft', v(ctr.x - R.tail * 0.8, ctr.z - R.tail * 0.66));
    // Main gear axle line out to the turn centre, and the centre mark.
    seg(turning, [v(axleX, SEMI * 0.4), ctr], ink, true);
    seg(turning, [ctr.clone().add(new THREE.Vector3(-0.8, 0, 0)), ctr.clone().add(new THREE.Vector3(0.8, 0, 0))], ink);
    seg(turning, [ctr.clone().add(new THREE.Vector3(0, 0, -0.8)), ctr.clone().add(new THREE.Vector3(0, 0, 0.8))], ink);
    label(turning, 'TURN CENTRE\non the main gear axle line · steering 75°', ctr.clone().add(new THREE.Vector3(0, 0, -3.2)), { size: 0.75 });
    label(turning, '180° TURN: MIN PAVEMENT 24.3 m · 79.7 ft\nslow, minimum thrust, no differential braking\nno turn away from an obstacle within 5.4 m of the wingtip / 7.4 m of the nose',
      v(ctr.x - R.tip - 4, ctr.z), { rot: Math.PI / 2, size: 1.0, color: ink });
  }

  let built = false;
  return {
    /** which: { principal, turning } */
    set(which) {
      const on = !!(which.principal || which.turning);
      if (on && !built) { build(); built = true; }
      root.visible = on;
      principal.visible = !!which.principal;
      turning.visible = !!which.turning;
    },
    setTheme(name) {
      ink = name === 'dark' ? '#e6e9ec' : '#1d2126';
      accent = name === 'dark' ? '#fb923c' : '#c2410c';
      if (built) build();
    },
  };
}
