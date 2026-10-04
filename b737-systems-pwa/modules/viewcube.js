// viewcube.js — a navigation cube like Fusion 360's ViewCube. It turns with
// the camera; each face is a 3×3 grid of hit zones: the centre flies the
// camera to that face's view, the edge and corner zones to the views in
// between (front-right, top-front-left…). Drag the cube to orbit; the house
// returns to the home view. Faces are named for the airplane: NOSE, TAIL,
// LEFT, RIGHT, TOP, BELLY (airframe axes: +x nose, +y up, +z right wing).

const FACES = [
  { name: 'NOSE', n: [1, 0, 0], up: [0, 1, 0] },
  { name: 'TAIL', n: [-1, 0, 0], up: [0, 1, 0] },
  { name: 'RIGHT', n: [0, 0, 1], up: [0, 1, 0] },
  { name: 'LEFT', n: [0, 0, -1], up: [0, 1, 0] },
  { name: 'TOP', n: [0, 1, 0], up: [1, 0, 0] },
  { name: 'BELLY', n: [0, -1, 0], up: [1, 0, 0] },
];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const neg = (a) => a.map((v) => -v);

export function createViewCube(host, api, { onHome } = {}) {
  const S = 64;                 // cube edge, px
  const el = document.createElement('div');
  el.className = 'vc';
  el.innerHTML = `<div class="vc-stage"><div class="vc-cube"><div class="vc-ring"><span class="vc-n">▲</span></div></div></div>
    <button class="vc-home" aria-label="Home view" title="Home view">⌂</button>`;
  host.append(el);
  const cube = el.querySelector('.vc-cube');
  const faces = FACES.map((f) => {
    const right = cross(neg(f.n), f.up);
    const d = document.createElement('div');
    d.className = 'vc-face';
    d.innerHTML = `<span class="vc-label">${f.name}</span>`;
    // 3×3 hit zones: column c (−1 left … 1 right), row r (−1 top … 1 bottom).
    for (let r = -1; r <= 1; r++) for (let c = -1; c <= 1; c++) {
      const z = document.createElement('div');
      z.className = 'vc-zone' + (r === 0 && c === 0 ? ' mid' : '');
      z.style.gridRow = String(r + 2); z.style.gridColumn = String(c + 2);
      z.dataset.dir = JSON.stringify(f.n.map((v, i) => v + c * right[i] - r * f.up[i]));
      z.title = r === 0 && c === 0 ? `${f.name} view` : '';
      d.append(z);
    }
    cube.append(d);
    return { ...f, right, el: d };
  });

  // Swing the camera round the target to a direction (target → camera),
  // keeping the distance — along the sphere, never through the airplane.
  let swing = null;
  function look(dir) {
    const T = api.THREE;
    const to = new T.Vector3(...dir).normalize();
    // Straight down/up: nudge so "up" (+y) stays defined for the orbit controls.
    // Bias it so the face label reads upright: from above nose-up, from below nose-down.
    if (Math.abs(to.y) > 0.999) to.set(-0.004 * Math.sign(to.y), Math.sign(to.y), 0).normalize();
    const target = api.controls.target.clone();
    const from = api.camera.position.clone().sub(target);
    swing = { target, from: from.clone().normalize(), to, dist: from.length(), t: 0 };
  }
  function step(dt) {
    if (!swing) return;
    const T = api.THREE;
    swing.t = Math.min(1, swing.t + dt / 0.6);
    const k = swing.t < 0.5 ? 4 * swing.t ** 3 : 1 - (-2 * swing.t + 2) ** 3 / 2;
    // Slerp between the two directions (fall back through "up" when opposite).
    const a = swing.from, b = swing.to;
    const dot = Math.max(-1, Math.min(1, a.dot(b)));
    let v;
    if (dot < -0.999) {
      const mid = new T.Vector3(0, 1, 0).addScaledVector(a, -a.y).normalize();
      v = k < 0.5 ? a.clone().lerp(mid, k * 2) : mid.clone().lerp(b, k * 2 - 1);
    } else {
      const om = Math.acos(dot), so = Math.sin(om);
      v = so < 1e-5 ? b.clone() : a.clone().multiplyScalar(Math.sin((1 - k) * om) / so).addScaledVector(b, Math.sin(k * om) / so);
    }
    api.camera.position.copy(swing.target).addScaledVector(v.normalize(), swing.dist);
    api.camera.lookAt(swing.target);
    api.controls.update();
    if (swing.t >= 1) swing = null;
  }

  // Click vs drag on the cube.
  let drag = null;
  el.querySelector('.vc-stage').addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, moved: false, zone: e.target.closest('.vc-zone') };
    e.currentTarget.setPointerCapture(e.pointerId);
  });
  el.querySelector('.vc-stage').addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 4) return;
    drag.moved = true;
    drag.x = e.clientX; drag.y = e.clientY;
    orbit(dx, dy);
  });
  el.querySelector('.vc-stage').addEventListener('pointerup', () => {
    if (drag && !drag.moved && drag.zone) look(JSON.parse(drag.zone.dataset.dir));
    drag = null;
  });
  el.querySelector('.vc-home').addEventListener('click', () => onHome?.());

  // Orbit the main camera around its target (same feel as dragging the scene).
  function orbit(dx, dy) {
    const T = api.THREE;
    const t = api.controls.target, cam = api.camera;
    const off = cam.position.clone().sub(t);
    const sph = new T.Spherical().setFromVector3(off);
    sph.theta -= dx * 0.012;
    sph.phi = Math.min(Math.PI - 0.02, Math.max(0.02, sph.phi - dy * 0.012));
    off.setFromSpherical(sph);
    cam.position.copy(t).add(off);
    cam.lookAt(t);
    api.controls.update();
    swing = null;
  }

  // Per frame: rotate the cube so it matches the camera (view-space, CSS y down).
  const m = new Float64Array(16);
  const ring = el.querySelector('.vc-ring');
  function frame(dt = 0.016) {
    step(dt);
    if (el.hidden) return;
    const R = api.camera.matrixWorldInverse.elements;   // column-major
    const rot = (v) => [R[0] * v[0] + R[4] * v[1] + R[8] * v[2], -(R[1] * v[0] + R[5] * v[1] + R[9] * v[2]), R[2] * v[0] + R[6] * v[1] + R[10] * v[2]];
    for (const f of faces) {
      const a = rot(f.right), b = rot(neg(f.up)), n = rot(f.n), c = rot(f.n.map((v) => (v * S) / 2));
      m.set([a[0], a[1], a[2], 0, b[0], b[1], b[2], 0, n[0], n[1], n[2], 0, c[0], c[1], c[2], 1]);
      f.el.style.transform = `matrix3d(${Array.from(m).map((x) => x.toFixed(5)).join(',')})`;
      // Face toward the viewer reads brighter.
      f.el.classList.toggle('front', n[2] > 0.5);
    }
    // Ring in the horizontal plane under the cube; its marker points to the nose.
    {
      const a = rot([0, 0, 1]), b = rot([-1, 0, 0]), n = rot([0, 1, 0]), c = rot([0, -S * 0.62, 0]);
      m.set([a[0], a[1], a[2], 0, b[0], b[1], b[2], 0, n[0], n[1], n[2], 0, c[0], c[1], c[2], 1]);
      ring.style.transform = `matrix3d(${Array.from(m).map((x) => x.toFixed(5)).join(',')})`;
    }
  }
  return { el, frame, set visible(v) { el.hidden = !v; } };
}
