// cockpit.js — a 3D 737NG flight deck you can look around and operate.
//
// Geometry is procedural (metres; +x forward, +y up, +z toward the F/O).
// The forward overhead is made of the same SVG panels as the schematic view,
// rendered into textures; a tap on the overhead is mapped back to panel
// units and handed to that control (panel.controls[].act), so the 3D panels
// work exactly like the 2D ones. Screens are canvases redrawn from the live
// system states a few times a second.

import * as THREE from '../vendor/three.module.min.js?v=19';
import { createOverhead } from './overhead.js?v=19';
import * as CAB from './cockpit-cab.js?v=19';
import { buildStand } from './cockpit-stand.js?v=19';
import * as D from './cockpit-displays.js?v=19';
import { drawCDUScreen } from './cdu.js?v=19';

const U = 0.2 / 300;                 // overhead panel units → metres
const EYE = new THREE.Vector3(0.12, 1.24, -0.52);

export const VIEWS = {
  out: { eye: [0.12, 1.24, -0.52], yaw: 0, pitch: -6, fov: 62 },
  panel: { eye: [0.3, 1.16, -0.28], look: [0.86, 0.86, -0.25], fov: 52 },
  center: { eye: [0.36, 1.12, 0], look: [0.86, 0.82, 0], fov: 46 },
  overhead: { eye: [0.12, 1.26, 0], look: [0.24, 1.75, 0], fov: 66 },
  mcp: { eye: [0.4, 1.16, 0], look: [0.745, 1.08, 0], fov: 46 },
  pedestal: { eye: [0.22, 1.26, -0.08], look: [0.38, 0.7, 0], fov: 52 },
  aft: { eye: [0.25, 1.2, 0], look: [-0.6, 0.85, 0], fov: 78 },
};

function canvasTex(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { c, g: c.getContext('2d'), t };
}

/** A flat panel facing `normal`, size w×h metres, centred at pos. */
function plate(w, h, mat, pos, normal, up = [0, 1, 0]) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.position.set(...pos);
  m.up.set(...up);
  m.lookAt(new THREE.Vector3(...pos).add(new THREE.Vector3(...normal)));
  return m;
}

// Screen id → Flight Instruments DU, and DU format → drawing.
const DU_OF = { pfdC: 'capOut', ndC: 'capIn', upper: 'upper', lower: 'lower', ndF: 'foIn', pfdF: 'foOut' };
const FORMAT = { PFD: D.drawPFD, ND: D.drawND, ENG: D.drawUpper, SYS: D.drawLower };
function blank(g, W, H) { g.fillStyle = '#020303'; g.fillRect(0, 0, W, H); }

/** Flight deck clock: analog seconds hand, digital UTC time above and date / ET below. */
function drawClock(g, W, H) {
  const now = new Date(), cx = W / 2, cy = H / 2, R = W * 0.46;
  g.fillStyle = '#16181a'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#050606'; g.beginPath(); g.arc(cx, cy, R, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#e9ecef'; g.lineWidth = 3;
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * Math.PI * 2, r0 = i % 5 ? R * 0.9 : R * 0.82;
    g.beginPath(); g.moveTo(cx + Math.sin(a) * r0, cy - Math.cos(a) * r0); g.lineTo(cx + Math.sin(a) * R * 0.97, cy - Math.cos(a) * R * 0.97); g.stroke();
  }
  g.fillStyle = '#e9ecef'; g.font = '700 20px Helvetica, Arial'; g.textAlign = 'center';
  for (const [n, a] of [['60', 0], ['15', 90], ['30', 180], ['45', 270]]) {
    const r = (a * Math.PI) / 180; g.fillText(n, cx + Math.sin(r) * R * 0.66, cy - Math.cos(r) * R * 0.66 + 7);
  }
  g.fillStyle = '#ffb21e'; g.font = '700 34px Menlo, monospace';
  const p = (v) => String(v).padStart(2, '0');
  g.fillText(`${p(now.getUTCHours())}:${p(now.getUTCMinutes())}`, cx, cy - 18);
  g.font = '700 22px Menlo, monospace';
  g.fillText(`${p(now.getUTCDate())} ${p(now.getUTCMonth() + 1)} ${String(now.getUTCFullYear()).slice(2)}`, cx, cy + 40);
  g.fillStyle = '#e9ecef'; g.font = '700 14px Helvetica'; g.fillText('UTC', cx, cy - 52);
  const sa = (now.getUTCSeconds() / 60) * Math.PI * 2;
  g.strokeStyle = '#f4f4f4'; g.lineWidth = 4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.sin(sa) * R * 0.85, cy - Math.cos(sa) * R * 0.85); g.stroke();
}

/** A beam (box) from a to b with a square section. */
function beam(a, b, t, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.BoxGeometry(t, len, t), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

export function createCockpit({ canvas, systems, ctxFor, onControl, onLever, cdu }) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.02, 4000);
  camera.position.copy(EYE);
  const pickables = [];

  // ── Sky, ground, light ──
  const sky = canvasTex(2, 256);
  const grd = sky.g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#3f78c2'); grd.addColorStop(0.55, '#9cc4ea'); grd.addColorStop(1, '#dfe9f2');
  sky.g.fillStyle = grd; sky.g.fillRect(0, 0, 2, 256);
  scene.background = sky.t;
  scene.fog = new THREE.Fog(0xcfe0ef, 300, 3500);
  const apron = canvasTex(512, 512);
  apron.g.fillStyle = '#8c9094'; apron.g.fillRect(0, 0, 512, 512);
  apron.g.strokeStyle = '#f1d23a'; apron.g.lineWidth = 6;
  apron.g.beginPath(); apron.g.moveTo(256, 0); apron.g.lineTo(256, 512); apron.g.stroke();
  apron.g.strokeStyle = 'rgba(255,255,255,.35)'; apron.g.lineWidth = 3;
  for (let i = 0; i < 512; i += 128) { apron.g.strokeRect(i, 0, 128, 512); }
  apron.t.wrapS = apron.t.wrapT = THREE.RepeatWrapping;
  apron.t.repeat.set(60, 60);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ map: apron.t, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -3.3;
  scene.add(ground);
  const cloudTex = canvasTex(512, 512);
  cloudTex.g.fillStyle = '#eef3f8'; cloudTex.g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * 512, y = Math.random() * 512, r = 12 + Math.random() * 40;
    const gr = cloudTex.g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    cloudTex.g.fillStyle = gr; cloudTex.g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  cloudTex.t.wrapS = cloudTex.t.wrapT = THREE.RepeatWrapping; cloudTex.t.repeat.set(20, 20);
  const clouds = new THREE.Mesh(new THREE.PlaneGeometry(8000, 8000), new THREE.MeshBasicMaterial({ map: cloudTex.t, color: 0xdfe8f1 }));
  clouds.rotation.x = -Math.PI / 2; clouds.position.y = -400; clouds.visible = false;
  scene.add(clouds);
  scene.add(new THREE.HemisphereLight(0xdbe8f5, 0x3a3f44, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(4, 6, -2);
  scene.add(sun);
  const fill = new THREE.PointLight(0xffffff, 0.6, 4);
  fill.position.set(0, 1.5, 0);
  scene.add(fill);

  // ── Materials ──
  const M = {
    shell: new THREE.MeshStandardMaterial({ color: 0x5c656d, roughness: 0.85 }),
    panel: new THREE.MeshStandardMaterial({ color: 0x6d747a, roughness: 0.75 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1f2225, roughness: 0.7 }),
    glare: new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.9 }),
    frame: new THREE.MeshStandardMaterial({ color: 0x4a5258, roughness: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ color: 0xb8bdc1, roughness: 0.35, metalness: 0.6 }),
    knob: new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.5 }),
    seat: new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.9 }),
    glass: new THREE.MeshBasicMaterial({ color: 0xa9cdee, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }),
    // Flight deck lining and the control column.
    trim: new THREE.MeshStandardMaterial({ color: 0x7d878f, roughness: 0.55 }),
    trimSide: new THREE.MeshStandardMaterial({ color: 0x6b747b, roughness: 0.7, side: THREE.DoubleSide }),
    boot: new THREE.MeshStandardMaterial({ color: 0x121314, roughness: 0.95 }),
    column: new THREE.MeshStandardMaterial({ color: 0x2a2d30, roughness: 0.45, metalness: 0.2 }),
    wheel: new THREE.MeshStandardMaterial({ color: 0x1a1b1d, roughness: 0.35, metalness: 0.15 }),
    grip: new THREE.MeshStandardMaterial({ color: 0x0d0e0f, roughness: 0.95 }),
    logo: new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.3, metalness: 0.5 }),
    card: new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.9 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc92a2a, roughness: 0.4 }),
  };
  const add = (m) => { scene.add(m); return m; };

  // ── Shell: floor, walls, ceiling ──
  const floor = add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.02, 2.2), M.dark));
  floor.position.set(0.2, -0.01, 0);
  for (const s of [-1, 1]) {
    const wall = add(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.08, 0.04), M.shell));
    wall.position.set(0.1, 0.54, s * 1.06);
    const sill = add(new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.12, 0.2), M.shell));
    sill.position.set(0.3, 1.0, s * 0.96);
  }
  const ceil = add(new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.04, 2.1), M.shell));
  ceil.position.set(-0.55, 2.0, 0);
  const bulk = add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 2.0, 2.1), M.shell));
  bulk.position.set(-1.0, 1.0, 0);

  // ── Windshield: No. 1 (front), No. 2 (sliding), No. 3 in moulded frames ──
  const cab = CAB.windows(add, M);
  for (const m of cab.compass) pickables.push(m);
  for (const s of [-1, 1]) {
    // Side wall from the sill up to the roof, aft of No. 3.
    const up = add(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.96, 0.04), M.shell));
    up.position.set(-0.63, 1.54, s * 1.05);
  }
  // Roof skin over the windows.
  const roofG = new THREE.BufferGeometry();
  roofG.setAttribute('position', new THREE.Float32BufferAttribute([0.82, 1.6, -0.6, 0.82, 1.6, 0.6, 0.3, 1.86, 0.95, 0.3, 1.86, -0.95], 3));
  roofG.setIndex([0, 1, 2, 0, 2, 3]); roofG.computeVertexNormals();
  add(new THREE.Mesh(roofG, new THREE.MeshStandardMaterial({ color: 0x5c656d, roughness: 0.85, side: THREE.DoubleSide })));

  // ── Glareshield ──
  // Top of the glareshield, and its sloped front face that carries the MCP
  // and the two EFIS control panels.
  const glare = add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.04, 2.0), M.glare));
  glare.position.set(0.9, 1.12, 0);
  add(plate(2.0, 0.12, M.glare, [0.752, 1.08, 0], [-1, 0.32, 0]));

  // ── Main instrument panel ──
  const MIP_N = [-1, 0.22, 0];
  const mip = add(plate(1.96, 0.46, M.panel, [0.87, 0.82, 0], MIP_N));
  mip.userData.pick = { kind: 'static', name: 'Main instrument panel' };
  const center = add(plate(0.42, 0.36, M.panel, [0.87 + 0.22 * (0.57 - 0.82) + 0.003, 0.57, 0], MIP_N));
  center.userData.pick = { kind: 'static', name: 'Center panel' };
  const screens = {};
  const DU = 0.2;
  const duAt = (id, z, y, draw, label) => {
    const ct = canvasTex(512, 512);
    const off = new THREE.Vector3(...MIP_N).normalize().multiplyScalar(0.012);
    // On the sloped panel face at this height, just proud of it.
    const fx = 0.87 + 0.22 * (y - 0.82);
    const bez = add(plate(DU + 0.03, DU + 0.03, M.dark, [fx + off.x * 0.5, y + off.y * 0.5, z], MIP_N));
    const m = add(plate(DU, DU, new THREE.MeshBasicMaterial({ map: ct.t, toneMapped: false }), [fx + off.x, y + off.y, z], MIP_N));
    m.userData.pick = { kind: 'screen', name: label };
    bez.userData.pick = m.userData.pick;
    pickables.push(m, bez);
    screens[id] = { ...ct, draw };
  };
  duAt('pfdC', -0.68, 0.80, D.drawPFD, 'Captain PFD');
  duAt('ndC', -0.44, 0.80, D.drawND, 'Captain ND');
  duAt('upper', 0, 0.78, D.drawUpper, 'Upper DU — engines and fuel');
  duAt('lower', 0, 0.55, D.drawLower, 'Lower DU — engines and hydraulics');
  duAt('ndF', 0.44, 0.80, D.drawND, 'First officer ND');
  duAt('pfdF', 0.68, 0.80, D.drawPFD, 'First officer PFD');
  // ISFD (standby) left of the upper DU.
  {
    const ct = canvasTex(256, 256);
    const m = add(plate(0.085, 0.085, new THREE.MeshBasicMaterial({ map: ct.t, toneMapped: false }), [0.87 + 0.22 * (0.86 - 0.82) - 0.008, 0.86, -0.19], MIP_N));
    m.userData.pick = { kind: 'screen', name: 'Integrated standby flight display (ISFD)' };
    pickables.push(m);
    screens.isfd = { ...ct, draw: D.drawISFD };
  }
  // Clocks at the outboard edge of each forward panel: time, date / ET.
  for (const [id, z] of [['clockL', -0.9], ['clockR', 0.9]]) {
    const ct = canvasTex(256, 256);
    const m = add(plate(0.075, 0.075, new THREE.MeshBasicMaterial({ map: ct.t, toneMapped: false }), [0.87 + 0.22 * (0.87 - 0.82) - 0.008, 0.87, z], MIP_N));
    m.userData.pick = { kind: 'screen', name: 'Clock' };
    pickables.push(m);
    screens[id] = { ...ct, draw: drawClock };
  }
  // Gear lever to the right of the upper DU: placard with UP / OFF / DN,
  // the override trigger, and the wheel-shaped knob on its arm.
  const gearPick = { kind: 'lever', name: 'Landing gear lever' };
  {
    const ct = canvasTex(160, 320), g = ct.g;
    g.fillStyle = '#26292c'; g.fillRect(0, 0, 160, 320);
    g.fillStyle = '#0b0c0d'; g.fillRect(70, 70, 20, 180);                 // slot
    g.fillStyle = '#f0f0f0'; g.font = '700 22px Helvetica, Arial'; g.textAlign = 'right';
    g.fillText('UP', 62, 160 - 54 + 8); g.fillText('OFF', 62, 160 + 8); g.fillText('DN', 62, 160 + 54 + 8);
    g.font = '700 13px Helvetica, Arial'; g.textAlign = 'center';
    g.fillText('LANDING', 80, 30); g.fillText('GEAR', 80, 46);
    g.textAlign = 'left'; g.fillText('OVRD', 100, 110);
    g.fillStyle = '#f0f0f0';
    for (const y of [106, 160, 214]) g.fillRect(64, y - 1, 6, 2);
    ct.t.needsUpdate = true;
    const gearBase = add(plate(0.08, 0.16, new THREE.MeshStandardMaterial({ map: ct.t, roughness: 0.7 }), [0.87 + 0.22 * (0.80 - 0.82) - 0.006, 0.80, 0.21], MIP_N));
    gearBase.userData.pick = gearPick;
    pickables.push(gearBase);
  }
  const gearLever = new THREE.Group();
  gearLever.position.set(0.86, 0.80, 0.21);
  add(gearLever);
  {
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.012, 0.014), M.metal);
    arm.position.x = -0.045;
    const white = new THREE.MeshStandardMaterial({ color: 0xececec, roughness: 0.35 });
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.022, 28), white);
    knob.rotation.x = Math.PI / 2; knob.position.x = -0.095;
    const tyre = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.006, 10, 28), white);
    tyre.position.x = -0.095;
    // Override trigger under the arm.
    const trig = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.008), M.knob);
    trig.position.set(-0.03, -0.012, 0);
    gearLever.add(arm, knob, tyre, trig);
    for (const m of [arm, knob, tyre, trig]) { m.userData.pick = gearPick; pickables.push(m); }
  }

  // ── MCP and EFIS panels on the glareshield ──
  const MCP_N = [-1, 0.32, 0];
  {
    const ct = canvasTex(D.MCP_W, D.MCP_H);
    const w = 0.96;
    // Without the Automatic Flight system the MCP is a picture; with it, real panels (below).
    if (!systems.some((x) => x.id === 'autoflight')) {
      const m = add(plate(w, (w * D.MCP_H) / D.MCP_W, new THREE.MeshBasicMaterial({ map: ct.t }), [0.745, 1.08, 0], MCP_N));
      m.userData.pick = { kind: 'mcp', name: 'Mode control panel (MCP)' };
      pickables.push(m);
      screens.mcp = { ...ct, draw: D.drawMCP };
    }
    for (const s of [-1, 1]) {
      // EFIS control panel (FCOM 1.20 glareshield figure): MINS (RADIO /
      // BARO) with RST, FPV, MTRS, BARO (IN / HPA) with STD, the MODE
      // selector with CTR, the RANGE selector with TFC, and the map buttons.
      const e = canvasTex(560, 208), q = e.g;
      q.fillStyle = '#2b2f33'; q.fillRect(0, 0, 560, 208);
      q.strokeStyle = '#4a5157'; q.lineWidth = 3; q.strokeRect(3, 3, 554, 202);
      q.fillStyle = '#f0f0f0'; q.textAlign = 'center';
      const knob = (x, y, r, outer) => {
        if (outer) { q.fillStyle = '#4b5258'; q.beginPath(); q.arc(x, y, r + 9, 0, 7); q.fill(); }
        q.fillStyle = '#121314'; q.beginPath(); q.arc(x, y, r, 0, 7); q.fill();
        q.fillStyle = '#d0d0d0'; q.fillRect(x - 1.5, y - r, 3, r * 0.6);
        q.fillStyle = '#f0f0f0';
      };
      const btn = (x, y, t) => { q.fillStyle = '#16181a'; q.fillRect(x - 22, y - 11, 44, 22); q.fillStyle = '#f0f0f0'; q.font = '700 11px Helvetica, Arial'; q.fillText(t, x, y + 4); };
      q.font = '700 13px Helvetica, Arial';
      q.fillText('MINS', 60, 22); q.fillText('RADIO', 28, 46); q.fillText('BARO', 92, 46); knob(60, 92, 22, true); btn(60, 150, 'RST');
      q.font = '700 13px Helvetica, Arial'; q.fillText('BARO', 175, 22); q.fillText('IN', 145, 46); q.fillText('HPA', 205, 46); knob(175, 92, 22, true); btn(175, 150, 'STD');
      btn(118, 186, 'FPV'); btn(232, 186, 'MTRS');
      q.font = '700 13px Helvetica, Arial'; q.fillText('MODE', 295, 22);
      q.font = '700 10px Helvetica, Arial'; q.fillText('APP', 262, 52); q.fillText('VOR', 285, 44); q.fillText('MAP', 307, 44); q.fillText('PLN', 330, 52);
      knob(295, 92, 22, true); btn(295, 150, 'CTR');
      q.font = '700 13px Helvetica, Arial'; q.fillText('RANGE', 400, 22);
      q.font = '700 10px Helvetica, Arial'; ['5', '10', '20', '40', '80', '160', '320', '640'].forEach((t, i) => { const a = (-150 + i * 43) * Math.PI / 180; q.fillText(t, 400 + Math.sin(a) * 44, 92 - Math.cos(a) * 44 + 4); });
      knob(400, 92, 22, true); btn(400, 150, 'TFC');
      ['WXR', 'STA', 'WPT', 'ARPT'].forEach((t, i) => btn(482 + (i % 2) * 50, 40 + Math.floor(i / 2) * 32, t));
      ['DATA', 'POS', 'TERR'].forEach((t, i) => btn(482 + (i % 2) * 50, 104 + Math.floor(i / 2) * 32, t));
      e.t.needsUpdate = true;
      const em = add(plate(0.22, 0.0817, new THREE.MeshBasicMaterial({ map: e.t }), [0.745, 1.08, s * 0.6], MCP_N));
      em.userData.pick = { kind: 'static', name: `EFIS control panel (${s < 0 ? 'captain' : 'first officer'})` };
      pickables.push(em);
    }
  }

  // ── Forward overhead: system panels as textures, in four columns ──
  const OV_FRONT = new THREE.Vector3(0.64, 1.6, 0);
  const OV_T = new THREE.Vector3(-0.95, 0.31, 0).normalize();        // along the slope, aft
  const OV_N = new THREE.Vector3(-0.31, -0.95, 0).normalize();       // facing down and aft
  const ovBase = add(new THREE.Mesh(new THREE.BoxGeometry(1.06, 0.04, 1.02), M.dark));
  ovBase.position.copy(OV_FRONT).addScaledVector(OV_T, 0.45).addScaledVector(OV_N, -0.03);
  ovBase.quaternion.setFromUnitVectors(new THREE.Vector3(1, 0, 0), OV_T);
  const panelSets = new Map();      // sysId → { O, panels }
  const texPanels = [];             // { P, sys, mesh, tex, last, dirty }
  for (const s of systems) {
    const ctx = ctxFor(s.id);
    const O = createOverhead(null, { ...ctx, touched: () => markDirty(s.id) });
    s.schem.panels(O, ctx);
    panelSets.set(s.id, O);
  }
  const byTitle = (sys, t) => panelSets.get(sys)?.panels.find((p) => p.title === t);
  // Forward overhead as on the airplane (FCOM 1.20 figure): five columns,
  // aft edge first, and the lights / ENGINE START row along the front edge.
  const COLUMNS = [
    [['hydraulics', 'Flight control'], ['fms', 'Instrument transfer'], ['instruments', 'Displays'], ['fuel', 'Fuel']],
    [['electrical', 'Electrical'], ['electrical', 'Generator drive and standby power'], ['electrical', 'Ground power and bus switching'], ['engines', 'APU']],
    [['general', 'Equipment cooling'], ['general', 'Cabin signs and equipment cooling'], ['comms', 'Calls and voice recorder'], ['antiice', 'Wipers']],
    [['antiice', 'Window heat'], ['antiice', 'Probe heat'], ['antiice', 'Wing and engine anti-ice'], ['hydraulics', 'Hydraulic pumps'], ['air', 'Cabin altitude']],
    [['air', 'Air temperature'], ['air', 'Bleed air'], ['air', 'Cabin pressurization']],
  ];
  const FRONT_ROW = [['general', 'Lights L', -0.3, 0.32], ['engines', 'Engine start', 0, 0.2], ['general', 'Lights R', 0.3, 0.32]];
  const colZ = [-0.42, -0.21, 0, 0.21, 0.42];
  // Looking up at the forward overhead, the top of your view is its AFT edge —
  // which is why the FCOM figures (drawn as you see them) put FLT CONTROL at
  // the top and LIGHTS / ENGINE START at the bottom, nearest the windshield.
  // So each panel's texture top points aft, and columns stack from the aft end.
  const colLen = (col) => col.reduce((a, [sys, t]) => a + ((byTitle(sys, t)?.h || 0) * U + 0.006), 0.02);
  const rowH = Math.max(...FRONT_ROW.map(([sys, t, , w]) => ((byTitle(sys, t)?.h || 0) * w) / 300));
  const OV_LEN = Math.max(...COLUMNS.map(colLen)) + rowH + 0.03;
  const OV_AFT = OV_FRONT.clone().addScaledVector(OV_T, OV_LEN);
  const texPanel = (P, sys, w, h, centerPos) => {
    const scale = 2.5;
    const ct = canvasTex(300 * scale, Math.round(P.h * scale));
    const mesh = add(plate(w, h, new THREE.MeshStandardMaterial({ map: ct.t, roughness: 0.6 }), centerPos.toArray(), OV_N.toArray(), OV_T.toArray()));
    mesh.userData.pick = { kind: 'panel', sys, P };
    pickables.push(mesh);
    texPanels.push({ P, sys, mesh, ct, last: '', dirty: true, scale });
  };
  COLUMNS.forEach((col, ci) => {
    let along = 0.02;
    for (const [sys, title] of col) {
      const P = byTitle(sys, title);
      if (!P) continue;
      const w = 0.2, h = P.h * U;
      texPanel(P, sys, w, h, OV_AFT.clone().addScaledVector(OV_T, -(along + h / 2)).add(new THREE.Vector3(0, 0, colZ[ci])));
      along += h + 0.006;
    }
  });
  for (const [sys, title, z, w] of FRONT_ROW) {
    const P = byTitle(sys, title);
    if (!P) continue;
    const h = (P.h * w) / 300;
    texPanel(P, sys, w, h, OV_FRONT.clone().addScaledVector(OV_T, 0.015 + rowH - h / 2).add(new THREE.Vector3(0, 0, z)));
  }
  // Aft overhead (FCOM 1.20 aft overhead figure), continuing the slope aft
  // of the forward overhead: IRS mode select left, crew oxygen centre, the
  // stall / Mach warning tests right.
  const AFT_OV = [['fms', 'IRS mode select', -0.21], ['general', 'Oxygen', 0], ['warnings', 'Warning tests', 0.21]];
  for (const [sys, title, z] of AFT_OV) {
    const P = byTitle(sys, title);
    if (!P) continue;
    const h = P.h * U;
    texPanel(P, sys, 0.2, h, OV_FRONT.clone().addScaledVector(OV_T, OV_LEN + 0.03 + h / 2).add(new THREE.Vector3(0, 0, z)));
  }
  // Panels that live elsewhere: the fire protection panel on the aft pedestal.
  function placePanel(sys, title, pos, normal, up, w = 0.2) {
    const P = byTitle(sys, title);
    if (!P) return;
    const h = (P.h * w) / 300, scale = 2.5;
    const ct = canvasTex(300 * scale, Math.round(P.h * scale));
    const mesh = add(plate(w, h, new THREE.MeshStandardMaterial({ map: ct.t, roughness: 0.6 }), pos, normal, up));
    mesh.userData.pick = { kind: 'panel', sys, P };
    pickables.push(mesh);
    texPanels.push({ P, sys, mesh, ct, last: '', dirty: true, scale });
  }
  // ── Where each panel sits (FCOM 1.20 panel figures) ──
  const MIP = [-1, 0.22, 0], MIP_UP = [0.22, 1, 0];
  const mipX = (y) => 0.864 + 0.22 * (y - 0.82);        // on the main panel face, just proud of it
  const onMip = (sys, title, y, z, w) => placePanel(sys, title, [mipX(y), y, z], MIP, MIP_UP, w);
  // Centre forward panel: strip above the upper DU, gear lights over the lever.
  onMip('gear', 'Center panel', 0.965, 0, 0.3);
  onMip('gear', 'Landing gear', 0.92, 0.215, 0.11);
  // Captain's forward panel: display select, A/P-A/T-FMC lights, speedbrake
  // ARMED / DO NOT ARM, takeoff config & cabin altitude, icing, steering.
  onMip('instruments', 'Display select (captain)', 0.99, -0.62, 0.11);
  onMip('autoflight', 'Autoflight lights', 0.995, -0.4, 0.13);
  onMip('flightcontrols', 'Speedbrake lights L', 0.968, -0.4, 0.12);
  onMip('warnings', 'Takeoff config and cabin altitude', 0.985, -0.245, 0.1);
  onMip('antiice', 'Icing advisory', 0.655, -0.27, 0.07);
  onMip('gear', 'Nose wheel steering', 0.78, -0.89, 0.09);
  // First officer's forward panel: brake pressure, A/P lights, SPEEDBRAKES
  // EXTENDED, display select, GPWS.
  onMip('gear', 'Brake pressure', 0.962, 0.24, 0.14);
  onMip('autoflight', 'Autoflight lights', 0.995, 0.42, 0.13);
  onMip('flightcontrols', 'Speedbrake lights R', 0.968, 0.42, 0.12);
  onMip('instruments', 'Display select (first officer)', 0.99, 0.62, 0.11);
  onMip('warnings', 'GPWS', 0.655, 0.44, 0.13);
  // Glareshield: annunciators outboard, the MCP across the middle.
  placePanel('warnings', 'Annunciator L', [0.75, 1.08, -0.785], [-1, 0.32, 0], [0.32, 1, 0], 0.13);
  placePanel('warnings', 'Annunciator R', [0.75, 1.08, 0.785], [-1, 0.32, 0], [0.32, 1, 0], 0.13);
  const MCP_UP = [0.32, 1, 0];
  ['MCP speed', 'MCP heading', 'MCP altitude', 'MCP engage'].forEach((t, i) => placePanel('autoflight', t, [0.743, 1.08, -0.36 + i * 0.24], [-1, 0.32, 0], MCP_UP, 0.238));
  // Control stand (FCOM 1.20 control stand figure): parking brake aft-left,
  // STAB TRIM cutouts aft-right — flush on the stand's sloped top.
  const STAND_Y = (x) => 0.71 + 0.25 * (x - 0.47) + 0.003;
  placePanel('gear', 'Parking brake', [0.34, STAND_Y(0.34), -0.125], [-0.25, 1, 0], [1, 0.25, 0], 0.1);
  placePanel('flightcontrols', 'Stabilizer trim', [0.34, STAND_Y(0.34), 0.125], [-0.25, 1, 0], [1, 0.25, 0], 0.1);
  // Aft electronic panel (FCOM 1.20 aft electronic panel figure), behind the
  // CDUs: the engine & APU fire panel across the front, then three columns —
  // left: VHF comm 1, captain's audio control panel, nav radios, flight deck
  // door lock; centre: cargo fire, transponder; right: VHF comm 2, the first
  // officer's audio control panel. Every panel is flush with the panel face.
  const AFT_Y = 0.708, AFT_FRONT = 0.055;
  const aftAt = (sys, title, xTop, z, w) => {
    const P = byTitle(sys, title);
    if (!P) return xTop;
    const h = (P.h * w) / 300;
    placePanel(sys, title, [xTop - h / 2, AFT_Y, z], [0, 1, 0], [1, 0, 0], w);
    return xTop - h - 0.005;
  };
  const colTop = aftAt('fire', 'Fire protection', AFT_FRONT, 0, 0.345);
  const AFT_COLS = [
    [-0.118, [['comms', 'VHF comm'], ['comms', 'Audio control panel'], ['fms', 'Nav radios'], ['general', 'Flight deck door']]],
    [0, [['fire', 'Cargo fire'], ['warnings', 'Transponder']]],
    [0.118, [['comms', 'VHF comm'], ['comms', 'Audio control panel']]],
  ];
  for (const [z, list] of AFT_COLS) {
    let x = colTop;
    for (const [sys, title] of list) x = aftAt(sys, title, x, z, 0.112);
  }
  function markDirty(sys) { for (const t of texPanels) if (t.sys === sys) t.dirty = true; }

  // Render a panel's SVG into its texture (only when its markup changed).
  const ser = new XMLSerializer();
  let rendering = 0;
  function renderPanels() {
    for (const t of texPanels) {
      if (!t.dirty || rendering > 3) continue;
      t.dirty = false;
      const xml = ser.serializeToString(t.P.svg);
      if (xml === t.last) continue;
      t.last = xml;
      const img = new Image();
      rendering++;
      img.onload = () => {
        rendering--;
        t.ct.g.clearRect(0, 0, t.ct.c.width, t.ct.c.height);
        t.ct.g.drawImage(img, 0, 0, t.ct.c.width, t.ct.c.height);
        t.ct.t.needsUpdate = true;
      };
      img.onerror = () => { rendering--; };
      img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
    }
  }

  // ── Pedestal ──
  const ped = add(new THREE.Mesh(new THREE.BoxGeometry(0.54, 0.7, 0.36), M.shell));
  ped.position.set(0.01, 0.35, 0);
  {
    const ct = canvasTex(512, 640);
    const g = ct.g;
    g.fillStyle = '#5f666c'; g.fillRect(0, 0, 512, 640);
    // Every unit on the aft electronic panel is a real panel now (placePanel below).
    ct.t.needsUpdate = true;
    const aft = add(plate(0.36, 0.31, new THREE.MeshStandardMaterial({ map: ct.t, roughness: 0.7 }), [-0.09, 0.705, 0], [0, 1, 0], [1, 0, 0]));
    aft.userData.pick = { kind: 'aftpedestal', name: 'Aft electronic panel' };
    pickables.push(aft);
  }
  // CDUs, left and right: the screen is the live FMC page; a tap opens the keypad.
  const cdus = [];
  for (const s of [-1, 1]) {
    const ct = canvasTex(360, 500);
    const m = add(plate(0.165, 0.229, new THREE.MeshBasicMaterial({ map: ct.t, toneMapped: false }), [0.175, 0.708, s * 0.088], [0, 1, 0], [1, 0, 0]));
    m.userData.pick = { kind: 'cdu', name: `CDU (${s < 0 ? 'left' : 'right'})` };
    pickables.push(m);
    cdus.push(ct);
  }
  const scr = canvasTex(300, 220);
  function drawCDUs() {
    if (!cdu) return;
    drawCDUScreen(scr.g, 300, 220, cdu.screen());
    for (const ct of cdus) {
      const g = ct.g;
      g.fillStyle = '#3f444a'; g.fillRect(0, 0, 360, 500);
      g.fillStyle = '#16181a'; g.fillRect(26, 14, 308, 228);
      g.drawImage(scr.c, 30, 18, 300, 220);
      // Line select keys.
      g.fillStyle = '#1d2023';
      for (let i = 0; i < 6; i++) { const y = 54 + i * 31; g.fillRect(4, y, 18, 10); g.fillRect(338, y, 18, 10); }
      // Function, alpha and numeric keys (drawn, not separate meshes).
      g.font = '700 9px Helvetica, Arial'; g.textAlign = 'center';
      const key = (x, y, w, h, t, lit) => {
        g.fillStyle = '#202326'; g.fillRect(x, y, w, h);
        if (lit != null) { g.fillStyle = lit ? '#e8f8ff' : '#2a2c2a'; g.fillRect(x + w * 0.2, y + 2, w * 0.6, 3); }
        g.fillStyle = '#eee'; g.fillText(t, x + w / 2, y + h / 2 + 3);
      };
      [['INIT', 'RTE', 'CLB', 'CRZ', 'DES', ''], ['MENU', 'LEGS', 'DEP', 'HOLD', 'PROG', 'EXEC'], ['N1', 'FIX', 'PREV', 'NEXT', '', '']].forEach((row, r) =>
        row.forEach((t, i) => t && key(16 + i * 56, 254 + r * 30, 50, 24, t, t === 'EXEC' ? cdu.exec() : null)));
      for (let i = 0; i < 12; i++) key(16 + (i % 3) * 32, 350 + Math.floor(i / 3) * 34, 28, 28, '1234567890.-'[i]);
      'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat(['SP', 'DEL', '/', 'CLR']).forEach((t, i) => key(128 + (i % 5) * 44, 344 + Math.floor(i / 5) * 25, 40, 21, t));
      g.fillStyle = cdu.msg() ? '#ffb21e' : '#5a4a2a'; g.font = '700 10px Helvetica'; g.fillText('MSG', 30, 495);
      ct.t.needsUpdate = true;
    }
  }
  // Control stand: thrust, speed brake, flap and start levers, trim wheels.
  const stand = buildStand(add, M, pickables);

  // ── Control columns, rudder pedals, seats, circuit breakers ──
  const yokes = [];
  for (const s of [-1, 1]) {
    const z = s * 0.52;
    yokes.push(CAB.yoke(add, M, z, pickables));
    CAB.pedals(add, M, z, pickables);
    CAB.seat(add, M, z);
  }
  CAB.breakers(add, M, pickables);
  CAB.door(add, M, pickables);

  // ── Look around ──
  const look = { yaw: 0, pitch: -6, fov: 62, eye: EYE.clone() };
  let tween = null;
  function aim() {
    const yaw = (look.yaw * Math.PI) / 180, pitch = (look.pitch * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.cos(pitch) * Math.cos(yaw), Math.sin(pitch), Math.cos(pitch) * Math.sin(yaw));
    camera.position.copy(look.eye);
    camera.lookAt(look.eye.clone().add(dir));
    camera.fov = look.fov;
  }
  function goView(name) {
    const v = VIEWS[name];
    const eye = new THREE.Vector3(...v.eye);
    let yaw = v.yaw ?? 0, pitch = v.pitch ?? 0;
    if (v.look) {
      const d = new THREE.Vector3(...v.look).sub(eye).normalize();
      yaw = (Math.atan2(d.z, d.x) * 180) / Math.PI;
      pitch = (Math.asin(d.y) * 180) / Math.PI;
    }
    tween = { from: { ...look, eye: look.eye.clone() }, to: { yaw, pitch, fov: v.fov, eye }, t: 0 };
  }
  const pointers = new Map();
  let drag = null, pinch0 = null, active = false;
  canvas.addEventListener('pointerdown', (e) => {
    if (!active) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, moved: 0, t: performance.now() };
    if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), fov: look.fov }; }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!active || !pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2 && pinch0) {
      const [a, b] = [...pointers.values()];
      look.fov = Math.max(22, Math.min(80, pinch0.fov * pinch0.d / Math.max(20, Math.hypot(a.x - b.x, a.y - b.y))));
      if (drag) drag.moved = 99;
      return;
    }
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    drag.x = e.clientX; drag.y = e.clientY;
    const k = look.fov / canvas.clientHeight;
    look.yaw -= dx * k; look.pitch = Math.max(-75, Math.min(80, look.pitch + dy * k));
    tween = null;
  });
  const up = (e) => {
    if (!active) return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch0 = null;
    if (drag && pointers.size === 0) {
      if (drag.moved < 8 && performance.now() - drag.t < 600) pick(e);
      drag = null;
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  canvas.addEventListener('wheel', (e) => { if (!active) return; e.preventDefault(); look.fov = Math.max(22, Math.min(80, look.fov * (1 + e.deltaY * 0.001))); }, { passive: false });

  const ray = new THREE.Raycaster();
  function pick(e) {
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    if (!hit) return;
    const info = hit.object.userData.pick;
    if (info.kind === 'panel') {
      const px = hit.uv.x * 300, py = (1 - hit.uv.y) * info.P.h;
      const c = info.P.controls.find((k) => px >= k.x0 && px <= k.x1 && py >= k.y0 && py <= k.y1);
      if (!c) { onControl({ kind: 'panel', sys: info.sys, panel: info.P.title }); return; }
      const result = c.act(px, py);
      markDirty(info.sys);
      // Let the state settle, then report what the control now shows.
      setTimeout(() => onControl({ kind: c.kind, sys: info.sys, panel: info.P.title, control: c, result, pos: c.pos() }), 30);
      return;
    }
    const moved = info.kind === 'lever' && onLever?.(info.name);
    onControl({ kind: info.kind, name: info.name, pos: moved || undefined });
  }

  // ── Live data ──
  let data = null;
  const lastRes = {};
  function update(sysId, res) {
    lastRes[sysId] = res;
    panelSets.get(sysId)?.update(res);
    markDirty(sysId);
  }
  function setData(d) { data = d; }

  let tDisp = 0, t = 0, tCdu = 1;
  function frame(dt) {
    if (!active) return;
    t += dt;
    if (tween) {
      tween.t = Math.min(1, tween.t + dt / 0.8);
      const k = tween.t < 0.5 ? 2 * tween.t * tween.t : 1 - Math.pow(-2 * tween.t + 2, 2) / 2;
      let dyaw = tween.to.yaw - tween.from.yaw;
      dyaw = ((dyaw + 540) % 360) - 180;
      look.yaw = tween.from.yaw + dyaw * k;
      look.pitch = tween.from.pitch + (tween.to.pitch - tween.from.pitch) * k;
      look.fov = tween.from.fov + (tween.to.fov - tween.from.fov) * k;
      look.eye.lerpVectors(tween.from.eye, tween.to.eye, k);
      if (tween.t >= 1) tween = null;
    }
    aim();
    camera.aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    camera.updateProjectionMatrix();
    renderPanels();
    tDisp += dt;
    if (data && tDisp > 0.2) {
      tDisp = 0;
      // Flight Instruments decides what each DU shows (failures, selectors).
      const fmt = data.dus || {};
      for (const [id, sc] of Object.entries(screens)) {
        const f = fmt[DU_OF[id]];
        const draw = f == null ? sc.draw : FORMAT[f] || blank;
        // The captain's side reads the captain's air data.
        const own = data.capIas != null && (id === 'pfdC' || id === 'ndC') ? { ...data, flight: { ...data.flight, ias: data.capIas } } : data;
        draw(sc.g, sc.c.width, sc.c.height, own);
        sc.t.needsUpdate = true;
      }
      pose(data);
    }
    tCdu += dt;
    if (tCdu > 0.5) { tCdu = 0; drawCDUs(); }
  }

  /** Levers, yokes and the outside world follow the phase. */
  function pose(d) {
    const ph = d.phase;
    stand.pose(d);
    // UP raises the knob, DN lowers it (lever 0 UP · 1 OFF · 2 DN).
    gearLever.rotation.z = d.gearLever != null ? [-0.31, 0, 0.31][d.gearLever] : d.env.gearDown ? 0.31 : -0.31;
    // Columns: back for rotation / climb, wheels turned with the bank.
    const f = d.flight || {};
    const pull = f.onGround === false ? Math.max(-0.03, Math.min(0.09, (f.pitch - 2) * 0.008)) : ph === 'takeoff' ? 0.09 : 0;
    for (const y of yokes) { y.rotation.z = pull; y.userData.wheel.rotation.x = ((f.bank || 0) * 0.9 * Math.PI) / 180; }
    // Outside: apron at the gate and on the runway, clouds at altitude.
    const air = d.env.alt > 2000;
    ground.visible = !air;
    clouds.visible = air;
    ground.position.y = -3.3 - (ph === 'takeoff' ? 90 : ph === 'approach' ? 450 : 0);
    scene.fog.far = air ? 9000 : 3500;
  }

  return { get look() { return look; }, aim: () => aim(),
    scene, camera, frame, update, setData, goView, texPanels, screens,
    enter() { active = true; look.eye.copy(EYE); goView('out'); for (const tp of texPanels) tp.dirty = true; },
    exit() { active = false; pointers.clear(); drag = null; },
    get active() { return active; },
    panelSets,
  };
}
