// cockpit-stand.js — the control stand between the pilots (FCOM 1.20 control
// stand figure): thrust levers with the reverse thrust levers piggybacked on
// their fronts, TO/GA switches on the knobs and A/T disengage switches on the
// outboard sides; speed brake lever on the left, flap lever (airfoil knob,
// gates at 1 and 15) on the right; start levers aft; parking brake handle;
// stabilizer trim wheels on both sides with their position indicators.
//
// Lever angles are in degrees, + = forward. pose(d) drives them from the
// switch states (and the flight sim's thrust).

import * as THREE from '../vendor/three.module.min.js?v=38';

const D2R = Math.PI / 180;
// Top surface of the stand: y = TOP(x), sloping up toward the front.
const TOP = (x) => 0.71 + 0.25 * (x - 0.47);
const X0 = 0.28, X1 = 0.6, HALF = 0.17;             // aft, front of the lever top, half width
// Lever detents (degrees).
export const SB_ANG = [26, 21, -6, -32];             // DOWN · ARMED · FLIGHT DETENT · UP
export const FLAP_ANG = [28, 22, 16, 9, 2, -5, -13, -21, -29];   // UP 1 2 5 10 15 25 30 40
const PIV_Y = 0.6;                                   // lever pivots under the top

function canvasTex(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { c, g: c.getContext('2d'), t };
}
const roundBox = (w, h, d, r = 0.006) => {
  const s = new THREE.Shape();
  s.moveTo(-w / 2 + r, -h / 2); s.lineTo(w / 2 - r, -h / 2); s.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  s.lineTo(w / 2, h / 2 - r); s.quadraticCurveTo(w / 2, h / 2, w / 2 - r, h / 2); s.lineTo(-w / 2 + r, h / 2);
  s.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r); s.lineTo(-w / 2, -h / 2 + r); s.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003, bevelSegments: 2 });
  g.translate(0, 0, -d / 2);
  return g;
};

export function buildStand(add, M, pickables) {
  const reg = (m, pick) => { m.userData.pick = pick; pickables.push(m); return m; };
  const lever = (n, info) => ({ kind: 'lever', name: n, info });
  const ivory = new THREE.MeshStandardMaterial({ color: 0xd9d4c6, roughness: 0.45 });
  const grey = new THREE.MeshStandardMaterial({ color: 0x8e959b, roughness: 0.4, metalness: 0.3 });
  const body = new THREE.MeshStandardMaterial({ color: 0x3f454b, roughness: 0.75 });
  const standPick = { kind: 'static', name: 'Control stand' };

  // ── Body: side profile extruded across ──
  const prof = new THREE.Shape();
  prof.moveTo(X0, 0); prof.lineTo(X0, TOP(X0) - 0.004); prof.lineTo(X1, TOP(X1) - 0.004);
  // The nose of the stand slopes down under the forward electronic panel,
  // so the CDUs and the lower DU stay in view above it.
  prof.lineTo(X1 + 0.14, 0.42); prof.lineTo(X1 + 0.14, 0);
  const bodyGeo = new THREE.ExtrudeGeometry(prof, { depth: HALF * 2, bevelEnabled: false });
  bodyGeo.translate(0, 0, -HALF);
  reg(add(new THREE.Mesh(bodyGeo, body)), standPick);

  // ── Top plate: slots, scales and labels on one texture (top of the texture = forward) ──
  const LEN = (X1 - X0) / Math.cos(Math.atan(0.25));
  const top = canvasTex(512, Math.round((512 * LEN) / (HALF * 2)));
  const PXz = (z) => ((z + HALF) / (HALF * 2)) * 512;
  const PYx = (x) => ((X1 - x) / (X1 - X0)) * top.c.height;
  // Where a lever arm of a pivot at (px, PIV_Y) crosses the top at angle a.
  const cross = (px, a) => px + (TOP(px) - PIV_Y) * Math.tan(a * D2R);
  {
    const g = top.g, H = top.c.height;
    g.fillStyle = '#2c3135'; g.fillRect(0, 0, 512, H);
    g.strokeStyle = '#4a5157'; g.lineWidth = 3; g.strokeRect(4, 4, 504, H - 8);
    const slot = (z, xa, xb, w = 14) => { g.fillStyle = '#08090a'; g.fillRect(PXz(z) - w / 2, PYx(xb), w, PYx(xa) - PYx(xb)); };
    // Thrust lever slots (and the reverser stops), speed brake, flap, start levers.
    for (const z of [-0.045, 0.045]) slot(z, cross(0.5, -32), cross(0.5, 32), 16);
    slot(-0.135, cross(0.5, -34), cross(0.5, 30));
    slot(0.135, cross(0.5, -31), cross(0.5, 30));
    for (const z of [-0.03, 0.03]) slot(z, cross(0.33, -28), cross(0.33, 24), 10);
    g.fillStyle = '#e8e8e8'; g.font = '700 15px Helvetica, Arial'; g.textAlign = 'center';
    // Speed brake scale (left of its slot).
    [['DOWN', 0], ['ARMED', 1], ['FLIGHT', 2], ['UP', 3]].forEach(([t, i]) => {
      const y = PYx(cross(0.5, SB_ANG[i]));
      g.textAlign = 'right'; g.fillText(t, PXz(-0.152), y + 5);
      g.fillRect(PXz(-0.15), y - 1, 10, 2);
    });
    g.textAlign = 'right'; g.font = '700 11px Helvetica, Arial'; g.fillText('DETENT', PXz(-0.152), PYx(cross(0.5, SB_ANG[2])) + 18);
    g.font = '700 13px Helvetica, Arial'; g.fillText('SPEED BRAKE', PXz(-0.09), PYx(X1) + 22);
    // Flap scale (right of its slot) with the gates at 1 and 15.
    g.textAlign = 'left'; g.font = '700 15px Helvetica, Arial';
    ['UP', '1', '2', '5', '10', '15', '25', '30', '40'].forEach((t, i) => {
      const y = PYx(cross(0.5, FLAP_ANG[i]));
      g.fillText(t, PXz(0.155), y + 5);
      g.fillRect(PXz(0.148) - 6, y - 1, 8, 2);
      if (i === 1 || i === 5) { g.fillStyle = '#b8bec3'; g.fillRect(PXz(0.135) - 12, y + 6, 24, 5); g.fillStyle = '#e8e8e8'; }
    });
    g.font = '700 13px Helvetica, Arial'; g.fillText('FLAP', PXz(0.09), PYx(X1) + 22);
    // Thrust: FWD / REV marks; start levers IDLE / CUTOFF.
    g.textAlign = 'center'; g.font = '700 12px Helvetica, Arial';
    g.fillText('FWD', 256, PYx(cross(0.5, 30)) + 4);
    g.fillText('IDLE', 256, PYx(cross(0.33, 20)) + 4);
    g.fillText('CUTOFF', 256, PYx(cross(0.33, -24)) + 4);
    g.fillText('ENG START', 256, PYx(0.29) - 6);
    top.t.needsUpdate = true;
  }
  const n = new THREE.Vector3(-0.25, 1, 0).normalize();
  const plateM = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, LEN), new THREE.MeshStandardMaterial({ map: top.t, roughness: 0.7 }));
  const mid = new THREE.Vector3((X0 + X1) / 2, TOP((X0 + X1) / 2) + 0.001, 0);
  plateM.position.copy(mid);
  plateM.up.set(1, 0.25, 0);
  plateM.lookAt(mid.clone().add(n));
  reg(add(plateM), standPick);

  // ── Levers: a pivot group per lever, rotation.z = −angle ──
  const levers = {};
  const pivot = (key, x, z) => { const p = new THREE.Group(); p.position.set(x, PIV_Y, z); add(p); levers[key] = p; return p; };
  const part = (p, geo, mat, pos, pick, rot) => { const m = new THREE.Mesh(geo, mat); m.position.set(...pos); if (rot) m.rotation.set(...rot); p.add(m); reg(m, pick); return m; };

  // Thrust levers 1 and 2: curved arms, ivory knobs reaching inboard (they
  // sit side by side), TO/GA switch on the aft face, A/T disengage outboard,
  // reverse thrust lever piggybacked in front.
  const revs = {};
  for (const [i, z] of [[1, -0.045], [2, 0.045]]) {
    const key = `Thrust lever ${i}`, pick = lever(key);
    const p = pivot(key, 0.5, z);
    const arm = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(-0.012, 0.15, 0), new THREE.Vector3(-0.03, 0.25, 0)]);
    part(p, new THREE.TubeGeometry(arm, 16, 0.008, 8), grey, [0, 0, 0], pick);
    const knob = part(p, roundBox(0.036, 0.04, 0.07, 0.01), ivory, [-0.036, 0.265, 0], pick);
    knob.rotation.y = 0;
    // Number on top of the knob.
    const lab = canvasTex(64, 64);
    lab.g.fillStyle = '#d9d4c6'; lab.g.fillRect(0, 0, 64, 64); lab.g.fillStyle = '#222'; lab.g.font = '700 44px Helvetica'; lab.g.textAlign = 'center'; lab.g.fillText(String(i), 32, 48); lab.t.needsUpdate = true;
    const num = part(p, new THREE.PlaneGeometry(0.022, 0.022).rotateZ(-Math.PI / 2).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: lab.t }), [-0.036, 0.2905, 0], pick);
    void num;
    part(p, new THREE.BoxGeometry(0.008, 0.014, 0.03), M.knob, [-0.058, 0.255, 0], lever('TO/GA switch'));
    part(p, new THREE.CylinderGeometry(0.006, 0.006, 0.008, 12), M.knob, [-0.036, 0.268, (z < 0 ? -1 : 1) * 0.04], lever('A/T disengage switch'), [Math.PI / 2, 0, 0]);
    // Reverse thrust lever: hinged on the front of the arm, lifts up and aft.
    const r = new THREE.Group(); r.position.set(-0.014, 0.2, 0); p.add(r); revs[i] = r;
    const rp = lever('Reverse thrust lever');
    part(r, new THREE.BoxGeometry(0.008, 0.05, 0.018), ivory, [0.016, 0.02, 0], rp, [0, 0, -0.35]);
    part(r, roundBox(0.022, 0.012, 0.03, 0.004), ivory, [0.024, 0.045, 0], rp);
  }
  // Speed brake lever (left): long arm, grey T handle.
  {
    const key = 'Speed brake lever', pick = lever(key);
    const p = pivot(key, 0.5, -0.135);
    part(p, new THREE.BoxGeometry(0.01, 0.23, 0.012), grey, [0, 0.115, 0], pick);
    part(p, roundBox(0.03, 0.022, 0.075, 0.008), new THREE.MeshStandardMaterial({ color: 0x5d6368, roughness: 0.45 }), [0, 0.235, -0.02], pick);
  }
  // Flap lever (right): arm with the airfoil-shaped knob.
  {
    const key = 'Flap lever', pick = lever(key);
    const p = pivot(key, 0.5, 0.135);
    part(p, new THREE.BoxGeometry(0.01, 0.22, 0.012), grey, [0, 0.11, 0], pick);
    const af = new THREE.Shape();
    af.moveTo(0.03, 0); af.quadraticCurveTo(0.03, 0.016, 0.005, 0.017); af.quadraticCurveTo(-0.03, 0.012, -0.045, 0.002);
    af.quadraticCurveTo(-0.03, -0.004, 0.005, -0.008); af.quadraticCurveTo(0.03, -0.012, 0.03, 0);
    const afg = new THREE.ExtrudeGeometry(af, { depth: 0.07, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.002, bevelSegments: 2 });
    afg.translate(0, 0, -0.035);
    part(p, afg, ivory, [0, 0.228, 0.01], pick);
  }
  // Start levers (aft): short arms with ridged knobs.
  for (const [i, z] of [[1, -0.03], [2, 0.03]]) {
    const key = `Start lever ${i}`, pick = lever(key);
    const p = pivot(key, 0.33, z);
    p.position.y = TOP(0.33) - 0.055;
    part(p, new THREE.BoxGeometry(0.008, 0.085, 0.01), grey, [0, 0.042, 0], pick);
    part(p, roundBox(0.03, 0.02, 0.022, 0.006), M.knob, [0, 0.09, 0], pick);
  }
  // Parking brake handle (aft left): rises when set.
  {
    const p = new THREE.Group(); p.position.set(0.305, TOP(0.305), -0.12); add(p); levers['Parking brake'] = p;
    const pick = lever('Parking brake lever');
    part(p, new THREE.BoxGeometry(0.012, 0.03, 0.012), grey, [0, 0.015, 0], pick);
    part(p, roundBox(0.018, 0.01, 0.034, 0.004), M.red, [0, 0.032, 0], pick);
  }
  // Stabilizer trim wheels on both sides, white stripes, and the trim indicators.
  const trimWheels = [];
  for (const s of [-1, 1]) {
    const w = new THREE.Group(); w.position.set(0.45, TOP(0.45) - 0.085, s * (HALF + 0.024)); add(w); trimWheels.push(w);
    const pick = lever('Stabilizer trim wheel');
    const rim = part(w, new THREE.CylinderGeometry(0.115, 0.115, 0.036, 48), M.knob, [0, 0, 0], pick, [Math.PI / 2, 0, 0]);
    void rim;
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      part(w, new THREE.BoxGeometry(0.014, 0.012, 0.038), new THREE.MeshBasicMaterial({ color: 0xf2f2f2 }), [Math.cos(a) * 0.112, Math.sin(a) * 0.112, 0], pick, [0, 0, a]);
    }
    // Folding crank handle on the outer face.
    part(w, new THREE.CylinderGeometry(0.008, 0.008, 0.04, 10), M.metal, [0.08, 0, s * 0.036], pick, [Math.PI / 2, 0, 0]);
    // Indicator scale on the stand side, forward of the wheel (green takeoff band).
    const ind = canvasTex(64, 256);
    const q = ind.g;
    q.fillStyle = '#1b1d1f'; q.fillRect(0, 0, 64, 256);
    q.fillStyle = '#3df03d'; q.fillRect(14, 110, 10, 70);
    q.fillStyle = '#eee'; q.font = '700 12px Helvetica'; q.textAlign = 'left';
    for (let u = 0; u <= 16; u += 2) { const y = 20 + u * 13; q.fillRect(26, y, 10, 2); if (u % 4 === 0) q.fillText(String(u), 38, y + 5); }
    q.fillText('APL', 6, 14); q.fillText('NOSE DN', 2, 252);
    ind.t.needsUpdate = true;
    const im = new THREE.Mesh(new THREE.PlaneGeometry(0.03, 0.12), new THREE.MeshStandardMaterial({ map: ind.t, roughness: 0.6 }));
    im.position.set(0.56, TOP(0.56) - 0.075, s * (HALF + 0.001));
    im.rotation.y = s < 0 ? Math.PI : 0;
    add(im); reg(im, { kind: 'static', name: 'Stabilizer trim indicator' });
  }

  const ang = (key, a) => { if (levers[key]) levers[key].rotation.z = -a * D2R; };
  /** Follow the switch states (d from cockpitData). */
  function pose(d) {
    const ph = d.phase;
    // Thrust: from N1 when known (idle ~ −22°, full ~ +28°), else by phase.
    const n1 = (e) => (e && e.n1 > 0 ? -22 + Math.max(0, Math.min(1, (e.n1 - 20) / 76)) * 50 : -22);
    ang('Thrust lever 1', d.e1 ? n1(d.e1) : { ground: -22, takeoff: 26, cruise: 12, approach: 2, landing: -22 }[ph]);
    ang('Thrust lever 2', d.e2 ? n1(d.e2) : { ground: -22, takeoff: 26, cruise: 12, approach: 2, landing: -22 }[ph]);
    for (const i of [1, 2]) revs[i].rotation.z = d.rev ? 1.1 : 0;
    ang('Speed brake lever', SB_ANG[d.sb ?? (ph === 'landing' ? 3 : 0)]);
    ang('Flap lever', FLAP_ANG[d.flapLever ?? 0]);
    const l1 = d.levers ? d.levers.l1 : d.env.eng1, l2 = d.levers ? d.levers.l2 : d.env.eng2;
    ang('Start lever 1', l1 ? 20 : -24);
    ang('Start lever 2', l2 ? 20 : -24);
    levers['Parking brake'].position.y = TOP(0.305) + (d.park ? 0.012 : 0);
  }
  /** Spin the trim wheels (degrees of wheel per call). */
  function spinTrim(deg) { for (const w of trimWheels) w.rotation.z += deg * D2R; }
  return { levers, pose, spinTrim, TOP };
}
