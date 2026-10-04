// cockpit.js — a 3D 737NG flight deck you can look around and operate.
//
// Geometry is procedural (metres; +x forward, +y up, +z toward the F/O).
// The forward overhead is made of the same SVG panels as the schematic view,
// rendered into textures; a tap on the overhead is mapped back to panel
// units and handed to that control (panel.controls[].act), so the 3D panels
// work exactly like the 2D ones. Screens are canvases redrawn from the live
// system states a few times a second.

import * as THREE from '../vendor/three.module.min.js?v=6';
import { createOverhead } from './overhead.js?v=6';
import { extraPanels, EXTRA_SW } from './panels-extra.js?v=6';
import * as D from './cockpit-displays.js?v=6';

const U = 0.2 / 300;                 // overhead panel units → metres
const EYE = new THREE.Vector3(0.12, 1.24, -0.52);

export const VIEWS = {
  out: { eye: [0.12, 1.24, -0.52], yaw: 0, pitch: -6, fov: 62 },
  panel: { eye: [0.3, 1.16, -0.28], look: [0.86, 0.86, -0.25], fov: 52 },
  center: { eye: [0.36, 1.12, 0], look: [0.86, 0.82, 0], fov: 46 },
  overhead: { eye: [0.12, 1.26, 0], look: [0.24, 1.75, 0], fov: 66 },
  mcp: { eye: [0.4, 1.16, 0], look: [0.745, 1.08, 0], fov: 46 },
  pedestal: { eye: [0.22, 1.26, -0.08], look: [0.38, 0.7, 0], fov: 52 },
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

/** A beam (box) from a to b with a square section. */
function beam(a, b, t, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(new THREE.BoxGeometry(t, len, t), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

export function createCockpit({ canvas, systems, ctxFor, onControl }) {
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
    glass: new THREE.MeshBasicMaterial({ color: 0x9fc4e8, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide }),
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

  // ── Windshield: No. 1 (front), No. 2 (sliding), No. 3, with posts ──
  const W1 = (s) => [[0.99, 1.13, s * 0.03], [0.9, 1.13, s * 0.6], [0.71, 1.52, s * 0.53], [0.8, 1.56, s * 0.03]];
  const W2 = (s) => [[0.88, 1.13, s * 0.63], [0.46, 1.13, s * 0.96], [0.36, 1.49, s * 0.86], [0.69, 1.53, s * 0.56]];
  const W3 = (s) => [[0.42, 1.13, s * 0.98], [0.02, 1.13, s * 1.04], [0.02, 1.43, s * 0.98], [0.33, 1.48, s * 0.89]];
  for (const s of [-1, 1]) {
    for (const q of [W1(s), W2(s), W3(s)]) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(q.flat(), 3));
      g.setIndex([0, 1, 2, 0, 2, 3]);
      add(new THREE.Mesh(g, M.glass));
      for (let i = 0; i < 4; i++) add(beam(q[i], q[(i + 1) % 4], 0.045, M.frame));
    }
    // Crown above the windows and the side wall up to the roof.
    add(beam([0.8, 1.6, s * 0.05], [0.3, 1.66, s * 0.85], 0.12, M.shell));
    add(beam([0.02, 1.47, s * 1.0], [-1.0, 1.55, s * 1.05], 0.1, M.shell));
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
  const center = add(plate(0.42, 0.3, M.panel, [0.83, 0.6, 0], MIP_N));
  center.userData.pick = { kind: 'static', name: 'Center panel' };
  const screens = {};
  const DU = 0.2;
  const duAt = (id, z, y, draw, label) => {
    const ct = canvasTex(512, 512);
    const off = new THREE.Vector3(...MIP_N).normalize().multiplyScalar(0.012);
    const bez = add(plate(DU + 0.03, DU + 0.03, M.dark, [0.865 + off.x, y + off.y, z], MIP_N));
    const m = add(plate(DU, DU, new THREE.MeshBasicMaterial({ map: ct.t, toneMapped: false }), [0.86 + off.x * 2, y + off.y * 2, z], MIP_N));
    m.userData.pick = { kind: 'screen', name: label };
    bez.userData.pick = m.userData.pick;
    pickables.push(m, bez);
    screens[id] = { ...ct, draw };
  };
  duAt('pfdC', -0.68, 0.86, D.drawPFD, 'Captain PFD');
  duAt('ndC', -0.44, 0.86, D.drawND, 'Captain ND');
  duAt('upper', 0, 0.86, D.drawUpper, 'Upper DU — engines and fuel');
  duAt('lower', 0, 0.62, D.drawLower, 'Lower DU — engines and hydraulics');
  duAt('ndF', 0.44, 0.86, D.drawND, 'First officer ND');
  duAt('pfdF', 0.68, 0.86, D.drawPFD, 'First officer PFD');
  // ISFD (standby) left of the upper DU.
  {
    const ct = canvasTex(256, 256);
    const m = add(plate(0.085, 0.085, new THREE.MeshBasicMaterial({ map: ct.t, toneMapped: false }), [0.85, 0.93, -0.19], MIP_N));
    m.userData.pick = { kind: 'screen', name: 'Integrated standby flight display (ISFD)' };
    pickables.push(m);
    screens.isfd = { ...ct, draw: D.drawISFD };
  }
  // Gear lever to the right of the upper DU.
  const gearBase = add(plate(0.08, 0.16, M.dark, [0.855, 0.86, 0.17], MIP_N));
  gearBase.userData.pick = { kind: 'lever', name: 'Landing gear lever' };
  const gearLever = new THREE.Group();
  gearLever.position.set(0.83, 0.86, 0.17);
  add(gearLever);
  const gstem = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.012, 0.012), M.metal);
  gstem.position.x = -0.025;
  const gwheel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.016, 20), new THREE.MeshStandardMaterial({ color: 0xe9e9e9, roughness: 0.4 }));
  gwheel.rotation.x = Math.PI / 2; gwheel.position.x = -0.055;
  gearLever.add(gstem, gwheel);
  for (const m of [gstem, gwheel]) m.userData.pick = gearBase.userData.pick;
  pickables.push(gearBase, gstem, gwheel);

  // ── MCP and EFIS panels on the glareshield ──
  const MCP_N = [-1, 0.32, 0];
  {
    const ct = canvasTex(D.MCP_W, D.MCP_H);
    const w = 0.96;
    const m = add(plate(w, (w * D.MCP_H) / D.MCP_W, new THREE.MeshBasicMaterial({ map: ct.t }), [0.745, 1.08, 0], MCP_N));
    m.userData.pick = { kind: 'mcp', name: 'Mode control panel (MCP)' };
    pickables.push(m);
    screens.mcp = { ...ct, draw: D.drawMCP };
    for (const s of [-1, 1]) {
      const e = canvasTex(256, 96);
      e.g.fillStyle = '#c4c8cb'; e.g.fillRect(0, 0, 256, 96);
      e.g.fillStyle = '#1e1f20'; e.g.font = '700 13px Helvetica, Arial'; e.g.textAlign = 'center';
      ['MINS', 'MODE', 'CTR', 'RANGE', 'BARO'].forEach((t, i) => {
        const x = 26 + i * 51;
        e.g.fillText(t, x, 18);
        e.g.fillStyle = '#151617'; e.g.beginPath(); e.g.arc(x, 54, 17, 0, 7); e.g.fill(); e.g.fillStyle = '#1e1f20';
      });
      e.t.needsUpdate = true;
      const em = add(plate(0.22, 0.082, new THREE.MeshBasicMaterial({ map: e.t }), [0.745, 1.08, s * 0.74], MCP_N));
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
  // Panels for systems not simulated yet: switches move, nothing else.
  const extraCtx = {
    sw: { ...EXTRA_SW }, fail: {},
    set(k, v) { extraCtx.sw[k] = v; markDirty('extra'); },
    action() {}, touched: () => markDirty('extra'),
  };
  const extraO = createOverhead(null, extraCtx);
  extraPanels(extraO);
  panelSets.set('extra', extraO);
  const byTitle = (sys, t) => panelSets.get(sys)?.panels.find((p) => p.title === t);
  const COLUMNS = [
    [['hydraulics', 'Flight control'], ['extra', 'Wipers'], ['fuel', 'Fuel'], ['extra', 'Lights']],
    [['electrical', 'Electrical'], ['electrical', 'Generator drive and standby power'], ['electrical', 'Ground power and bus switching'], ['extra', 'APU']],
    [['extra', 'Cabin signs and equipment cooling'], ['extra', 'Anti-ice'], ['extra', 'Wing and engine anti-ice'], ['hydraulics', 'Hydraulic pumps'], ['extra', 'Engine start']],
    [['air', 'Cabin altitude'], ['air', 'Air temperature'], ['air', 'Bleed air'], ['air', 'Cabin pressurization']],
  ];
  const colZ = [-0.33, -0.11, 0.11, 0.33];
  // Looking up at the forward overhead, the top of your view is its AFT edge —
  // which is why the FCOM figures (drawn as you see them) put FLT CONTROL at
  // the top and LIGHTS / ENGINE START at the bottom, nearest the windshield.
  // So each panel's texture top points aft, and columns stack from the aft end.
  const colLen = (col) => col.reduce((a, [sys, t]) => a + ((byTitle(sys, t)?.h || 0) * U + 0.008), 0.02);
  const OV_LEN = Math.max(...COLUMNS.map(colLen)) + 0.02;
  const OV_AFT = OV_FRONT.clone().addScaledVector(OV_T, OV_LEN);
  COLUMNS.forEach((col, ci) => {
    let along = 0.02;
    for (const [sys, title] of col) {
      const P = byTitle(sys, title);
      if (!P) continue;
      const w = 0.2, h = P.h * U;
      const centerPos = OV_AFT.clone().addScaledVector(OV_T, -(along + h / 2)).add(new THREE.Vector3(0, 0, colZ[ci]));
      const scale = 2.5;
      const ct = canvasTex(300 * scale, Math.round(P.h * scale));
      const mesh = add(plate(w, h, new THREE.MeshStandardMaterial({ map: ct.t, roughness: 0.6 }), centerPos.toArray(), OV_N.toArray(),
        OV_T.toArray()));
      mesh.userData.pick = { kind: 'panel', sys, P };
      pickables.push(mesh);
      texPanels.push({ P, sys, mesh, ct, last: '', dirty: true, scale });
      along += h + 0.008;
    }
  });
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
  const ped = add(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.7, 0.36), M.shell));
  ped.position.set(0.32, 0.35, 0);
  const fwdPed = add(plate(0.36, 0.36, M.dark, [0.47, 0.71, 0], [-0.25, 1, 0]));
  fwdPed.userData.pick = { kind: 'static', name: 'Control stand' };
  {
    const ct = canvasTex(512, 640);
    const g = ct.g;
    g.fillStyle = '#5f666c'; g.fillRect(0, 0, 512, 640);
    const unit = (y, h, title, draw) => {
      g.fillStyle = '#2a2e32'; g.fillRect(10, y, 492, h);
      g.fillStyle = '#e9e9e9'; g.font = '700 16px Helvetica, Arial'; g.textAlign = 'center'; g.fillText(title, 256, y + 20);
      draw(y);
    };
    unit(10, 120, 'VHF COMM 1', (y) => {
      for (const [x, f] of [[140, '118.700'], [372, '121.500']]) { g.fillStyle = '#000'; g.fillRect(x - 90, y + 34, 180, 52); g.fillStyle = '#ff9f1c'; g.font = '700 34px Menlo, monospace'; g.fillText(f, x, y + 72); }
    });
    unit(140, 110, 'TRANSPONDER', (y) => {
      g.fillStyle = '#000'; g.fillRect(186, y + 34, 140, 50); g.fillStyle = '#ff9f1c'; g.font = '700 34px Menlo, monospace'; g.fillText('2000', 256, y + 72);
    });
    unit(260, 370, 'FIRE PROTECTION', (y) => {
      [['ENG 1', 100], ['APU', 256], ['ENG 2', 412]].forEach(([n, x]) => {
        g.fillStyle = '#c62828'; g.fillRect(x - 46, y + 60, 92, 150);
        g.fillStyle = '#ffe6e6'; g.font = '700 18px Helvetica, Arial'; g.fillText(n, x, y + 120);
        g.fillStyle = '#111'; g.fillRect(x - 40, y + 226, 80, 34); g.fillStyle = '#5a1a1a'; g.font = '700 13px Helvetica'; g.fillText('OVHT', x, y + 248);
      });
      g.fillStyle = '#e9e9e9'; g.font = '700 14px Helvetica'; g.fillText('ENGINE / APU FIRE SWITCHES', 256, y + 300);
    });
    ct.t.needsUpdate = true;
    const aft = add(plate(0.34, 0.425, new THREE.MeshStandardMaterial({ map: ct.t, roughness: 0.7 }), [0.06, 0.705, 0], [0, 1, 0], [1, 0, 0]));
    aft.userData.pick = { kind: 'aftpedestal', name: 'Aft electronic panel' };
    pickables.push(aft);
  }
  const levers = {};
  const leverAt = (name, x, z, len, color, info) => {
    const piv = new THREE.Group();
    piv.position.set(x, 0.74, z);
    add(piv);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.014, len, 0.012), M.metal);
    arm.position.y = len / 2;
    const knob = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.06), new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
    knob.position.y = len;
    piv.add(arm, knob);
    for (const m of [arm, knob]) { m.userData.pick = { kind: 'lever', name, info }; pickables.push(m); }
    levers[name] = piv;
    return piv;
  };
  leverAt('Thrust lever 1', 0.5, -0.045, 0.2, 0x222222);
  leverAt('Thrust lever 2', 0.5, 0.045, 0.2, 0x222222);
  leverAt('Speed brake lever', 0.42, -0.14, 0.16, 0x1d1d1d);
  leverAt('Flap lever', 0.42, 0.14, 0.16, 0xd9d9d9);
  leverAt('Start lever 1', 0.31, -0.03, 0.08, 0x1d1d1d);
  leverAt('Start lever 2', 0.31, 0.03, 0.08, 0x1d1d1d);
  for (const s of [-1, 1]) {
    const wheel = add(new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 36), M.knob));
    wheel.rotation.x = Math.PI / 2;
    wheel.position.set(0.44, 0.66, s * 0.2);
    const stripe = add(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.012, 0.045), new THREE.MeshBasicMaterial({ color: 0xffffff })));
    stripe.position.set(0.44, 0.79, s * 0.2);
    wheel.userData.pick = stripe.userData.pick = { kind: 'lever', name: 'Stabilizer trim wheel' };
    pickables.push(wheel, stripe);
  }

  // ── Yokes, pedals, seats ──
  const yokes = [];
  for (const s of [-1, 1]) {
    const z = s * 0.52;
    const yoke = new THREE.Group();
    yoke.position.set(0.6, 0.12, z);
    add(yoke);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.035, 0.62, 12), M.dark);
    col.position.y = 0.31;
    const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 10, 30, Math.PI * 1.15), M.dark);
    wheel.rotation.set(0, Math.PI / 2, Math.PI * 1.425);
    wheel.position.set(-0.05, 0.66, 0);
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.22), M.dark);
    hub.position.set(-0.04, 0.64, 0);
    yoke.add(col, wheel, hub);
    for (const m of [col, wheel, hub]) { m.userData.pick = { kind: 'lever', name: 'Control column and wheel' }; pickables.push(m); }
    yokes.push(yoke);
    for (const dz of [-0.09, 0.09]) {
      const pedal = add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.18, 0.08), M.dark));
      pedal.position.set(0.82, 0.15, z + dz); pedal.rotation.z = 0.5;
    }
    const seat = add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.52), M.seat));
    seat.position.set(-0.2, 0.5, z);
    const back = add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.75, 0.5), M.seat));
    back.position.set(-0.44, 0.9, z); back.rotation.z = 0.12;
  }

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
    onControl({ kind: info.kind, name: info.name });
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

  let tDisp = 0, t = 0;
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
      for (const sc of Object.values(screens)) { sc.draw(sc.g, sc.c.width, sc.c.height, data); sc.t.needsUpdate = true; }
      pose(data);
    }
  }

  /** Levers, yokes and the outside world follow the phase. */
  function pose(d) {
    const ph = d.phase;
    const tl = { ground: -0.35, takeoff: 0.45, cruise: 0.25, landing: -0.4 }[ph];
    levers['Thrust lever 1'].rotation.z = tl; levers['Thrust lever 2'].rotation.z = tl;
    levers['Speed brake lever'].rotation.z = ph === 'landing' ? -0.6 : 0.25;
    const fl = { 0: 0.35, 1: 0.25, 5: 0.1, 15: -0.05, 30: -0.25, 40: -0.35 }[d.env.flaps] ?? 0.35;
    levers['Flap lever'].rotation.z = fl;
    levers['Start lever 1'].rotation.z = d.env.eng1 ? 0.3 : -0.4;
    levers['Start lever 2'].rotation.z = d.env.eng2 ? 0.3 : -0.4;
    gearLever.rotation.z = d.env.gearDown ? -0.5 : 0.5;
    for (const y of yokes) y.rotation.z = ph === 'takeoff' ? -0.12 : 0;
    // Outside: apron at the gate and on the runway, clouds at altitude.
    const air = d.env.alt > 2000;
    ground.visible = !air;
    clouds.visible = air;
    ground.position.y = -3.3 - (ph === 'takeoff' ? 90 : 0);
    scene.fog.far = air ? 9000 : 3500;
  }

  return {
    scene, camera, frame, update, setData, goView, texPanels,
    enter() { active = true; look.eye.copy(EYE); goView('out'); for (const tp of texPanels) tp.dirty = true; },
    exit() { active = false; pointers.clear(); drag = null; },
    get active() { return active; },
    panelSets,
  };
}
