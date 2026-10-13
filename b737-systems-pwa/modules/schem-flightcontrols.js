// schem-flightcontrols.js — high-lift / speedbrake / primary-surface power
// schematic, with the flap & speedbrake panel and stab trim cutouts.

import { createSchematic, createPanel } from './schem-kit.js?v=56';
import { createOverhead } from './overhead.js?v=56';
import { DETENTS } from './sys-flightcontrols.js?v=56';

const C = '#3a86ff', B = '#12a874', A = '#2f7cf6', S = '#f2711c', DRV = '#e599f7', EL = '#63e6be';

// Spanwise stations (m from the centreline) as on the 3D model, inboard → outboard.
const TE_FLAPS = [[1.95, 6.25], [6.6, 12.4]];
const AIL = [12.4, 15.4];
const SPOILERS = [[2.3, 5.4], [6.7, 7.8], [7.85, 8.95], [9.0, 10.1], [10.15, 11.25], [11.3, 12.35]];
const KRUEGER = [[2.05, 3.15], [3.2, 4.3]];
const SLATS = [[6.79, 9.16], [9.24, 11.66], [11.74, 14.16], [14.24, 16.56]];
const AMB = '#ffa31a', GRN = '#40c057', DIM = '#2b3138';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 640);
  X.onPart = ctx.onPart;
  // ── The airplane from above, each surface where it really is ──
  const A = X.plan(500, 30, 13.4);
  const surf = (d, part, num, at) => {
    const g = X.el('g', { class: 'hit' }, X.svg);
    const p = X.el('path', { d, fill: DIM, stroke: '#9aa4ad', 'stroke-width': 0.8, 'stroke-linejoin': 'round' }, g);
    if (num != null) { const t = X.el('text', { x: at[0], y: at[1] + 3, 'text-anchor': 'middle', style: 'font-size:8px;fill:#fff;letter-spacing:0', 'pointer-events': 'none' }, g); t.textContent = num; }
    g.addEventListener('click', () => X.onPart?.(part));
    return p;
  };
  const mid = (z0, z1, u0, u1) => A.W((z0 + z1) / 2, (u0 + u1) / 2);
  const flaps = [], krue = [], slats = [], spoil = [], ail = [], elev = [], stab = [];
  for (const sd of [-1, 1]) {
    for (const [z0, z1] of TE_FLAPS) flaps.push({ sd, z0, z1, p: surf('', 'flaps') });
    ail.push(surf(A.wingQuad(sd * AIL[0], sd * AIL[1], 0.74, 1), 'ail'));
    SPOILERS.forEach(([z0, z1], k) => {
      // FCOM 9.20 numbering, left tip to right tip: 1–6 left (6 inboard), 7–12 right (7 inboard).
      const n = sd < 0 ? 6 - k : 7 + k;
      const ground = n === 1 || n === 6 || n === 7 || n === 12;
      spoil.push({ ground, p: surf(A.wingQuad(sd * z0, sd * z1, 0.6, 0.74), 'sb', n, mid(sd * z0, sd * z1, 0.6, 0.74)) });
    });
    KRUEGER.forEach(([z0, z1], k) => {
      const n = sd < 0 ? 2 - k : 3 + k;                // LE flaps 1–4, left to right
      krue.push({ sd, z0, z1, n, p: surf('', 'le'), t: null });
    });
    SLATS.forEach(([z0, z1], k) => {
      const n = sd < 0 ? 4 - k : 5 + k;                // slats 1–8, left to right
      slats.push({ sd, z0, z1, n, p: surf('', 'le') });
    });
    elev.push(surf(A.stabQuad(sd, 0.72, 1), 'elev'));
    stab.push(surf(A.stabQuad(sd, 0, 0.72), 'stab'));
  }
  const rudder = surf(`M${A.P(-15.5, 0.2)} L${A.P(-17.9, 0.2)} L${A.P(-17.9, -0.2)} L${A.P(-15.5, -0.2)} Z`, 'rud');
  // Numbers on the LE devices (drawn once; they move with the device).
  const num = (o) => { const t = X.el('text', { 'text-anchor': 'middle', style: 'font-size:7.5px;fill:#fff;letter-spacing:0', 'pointer-events': 'none' }, X.svg); t.textContent = o.n; o.t = t; };
  krue.forEach(num); slats.forEach(num);
  // Flap drive unit in the body, torque tubes along the rear spar to the flaps.
  for (const sd of [-1, 1]) X.pipe([A.P(-3.0, 0), A.W(sd * 1.88, 0.72), A.W(sd * 6.4, 0.72), A.W(sd * 12.3, 0.72)].map(([x, y]) => [x, y]), 'torque', { color: DRV, thin: true });
  const [px, py] = A.P(-3.0, 0);
  X.unit(px - 22, py - 9, 44, 18, 'PDU', (r) => (r.flows.torque ? 'on' : 'off'), { color: DRV, part: 'pdu', small: true });

  X.bind((r) => {
    const v = r.values, sbOn = v.sbFrac > 0, gndSb = sbOn && !v.air && v.sb === 'UP';
    const flapAft = (Math.min(40, v.flap) / 40) * 1.1 * 13.4;          // flaps run aft and down as they extend
    const flapCol = v.moving ? AMB : v.flap > 0.5 ? C : DIM;
    for (const f of flaps) { f.p.setAttribute('d', A.wingQuad(f.sd * f.z0, f.sd * f.z1, 0.74, 1, flapAft)); f.p.setAttribute('fill', flapCol); }
    const leCol = r.lights.leTransit ? AMB : v.leIdx ? GRN : DIM;
    for (const k of krue) {
      const out = v.leIdx ? 0.1 : 0;
      k.p.setAttribute('d', A.wingQuad(k.sd * k.z0, k.sd * k.z1, -out, 0.07));
      k.p.setAttribute('fill', leCol);
      const [x, y] = A.W(k.sd * (k.z0 + k.z1) / 2, 0.035 - out / 2); k.t.setAttribute('x', x); k.t.setAttribute('y', y + 3);
    }
    for (const s of slats) {
      const out = [0, 0.06, 0.12][v.leIdx] || 0;
      s.p.setAttribute('d', A.wingQuad(s.sd * s.z0, s.sd * s.z1, -out, 0.12));
      s.p.setAttribute('fill', r.lights.leTransit ? AMB : v.leIdx === 2 ? GRN : v.leIdx === 1 ? '#2b8a3e' : DIM);
      const [x, y] = A.W(s.sd * (s.z0 + s.z1) / 2, 0.06 - out / 2); s.t.setAttribute('x', x); s.t.setAttribute('y', y + 3);
    }
    for (const s of spoil) s.p.setAttribute('fill', (s.ground ? gndSb : sbOn) ? '#4dabf7' : DIM);
    const pw = r.env.hydAfc || r.env.hydBfc;
    for (const p of [...ail, ...elev, rudder]) p.setAttribute('fill', pw ? '#1f5fbf' : AMB);
    for (const p of stab) p.setAttribute('fill', '#5c4a1a');
  });

  // ── Left: how the flaps are driven ──
  X.unit(15, 24, 140, 40, 'FLAP LEVER', () => 'on', { color: C, part: 'flaps' });
  X.value(85, 80, (r) => ({ text: `selected ${r.values.lever}`, cls: 't-small' }));
  X.pipe([[85, 64], [85, 94]], () => true, { thin: true, color: C, still: true });
  X.unit(15, 94, 140, 36, 'FSEU', () => 'on', { color: C, part: 'le' });
  X.pipe([[85, 130], [85, 160]], (r) => r.env.hydB !== false, { color: B });
  X.text(92, 150, 'SYS B', 't-small t-dim');
  X.unit(15, 160, 140, 40, 'FLAP DRIVE UNIT\n(PDU)', (r) => (r.flows.torque ? 'on' : 'off'), { color: DRV, part: 'pdu', small: true });
  X.unit(15, 222, 140, 34, 'ALT FLAP MOTOR', (r) => (r.env.altFlapsArmed ? 'on' : 'off'), { color: EL, part: 'pdu', small: true });
  X.pipe([[85, 222], [85, 200]], (r) => !!r.env.altFlapsArmed, { color: EL, thin: true });
  X.text(85, 274, 'TORQUE TUBES → flaps', 't-small t-dim', 'middle');
  X.value(85, 312, (r) => ({ text: `TE FLAPS ${r.values.flap.toFixed(1)}°`, cls: 't-big' }));
  X.value(85, 334, (r) => ({ text: `LE ${r.values.le}`, cls: 't-small' + (r.lights.leTransit ? ' warn' : '') }));
  X.text(85, 356, 'LE: B (or A via PTU)', 't-small t-dim', 'middle');
  X.text(85, 370, 'STBY: extend only', 't-small t-dim', 'middle');
  X.value(85, 400, (r) => `SPEED BRAKE lever ${r.values.sb}`, 't-small', 'middle');

  // ── Right: what each colour is, and the power to the primary surfaces ──
  const KEY = [[C, 'TE flaps — 2 per wing', 'flaps'], [GRN, 'LE flaps 1–4 · slats 1–8', 'le'],
    ['#4dabf7', 'Spoilers 1–12 (ground: 1, 6, 7, 12)', 'sb'], ['#1f5fbf', 'Ailerons · elevators · rudder', 'ail'], ['#5c4a1a', 'Stabilizer (trim)', 'stab'], [AMB, 'Moving / unpowered', 'flaps']];
  KEY.forEach(([col, lab, part], k) => {
    const y = 34 + k * 22;
    const g = X.el('g', { class: 'hit' }, X.svg);
    X.el('rect', { x: 760, y: y - 9, width: 14, height: 12, rx: 2, fill: col }, g);
    X.text(780, y + 1, lab, 't-small', 'start', g);
    g.addEventListener('click', () => X.onPart?.(part));
  });
  const prim = [['AILERONS', 'ail'], ['ELEVATORS', 'elev'], ['RUDDER', 'rud']];
  prim.forEach(([n, part], i) => {
    const y = 210 + i * 78;
    X.unit(800, y, 150, 38, n, (r) => (r.env.hydAfc || r.env.hydBfc ? 'on' : 'fault'), { color: C, part, small: true });
    X.pipe([[835, y - 24], [835, y]], (r) => !!r.env.hydAfc, { color: A, thin: true });
    X.pipe([[915, y - 24], [915, y]], (r) => !!r.env.hydBfc, { color: B, thin: true });
    X.text(828, y - 12, 'A', 't-small', 'end'); X.text(922, y - 12, 'B', 't-small');
  });
  X.pipe([[875, 404], [875, 430]], (r) => !!r.env.stbyRud, { color: S, thin: true });
  X.text(875, 444, 'STBY RUDDER PCU', 't-small t-dim', 'middle');
  X.text(875, 470, 'A or B alone powers all', 't-small t-dim', 'middle');
  X.text(875, 484, 'primary surfaces', 't-small t-dim', 'middle');
  X.text(500, 628, 'Seen from above, nose up. Flaps, slats and spoilers move with the levers; numbers as in FCOM 9.20.', 't-small t-dim', 'middle');

  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);
  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('INSTRUCTOR · FAILURES');
  P.actions(P.fail('Flap drive fail', 'flapDrive'), P.fail('Yaw damper fault', 'yd'), P.fail('Feel computer', 'feel'),
    P.fail('Speed trim', 'sts'), P.fail('Mach trim', 'mach'), P.fail('Autoslat', 'autoslat'));
  P.actions(P.push('RESET TO NORMAL', ctx.reset));
  P.note('Move the FLAP lever and watch the flaps run on the airplane. Then Hydraulics → <b>B leak</b>: the lever no longer moves them — arm ALTERNATE FLAPS and hold the position switch DOWN (slow, electric, LE devices on standby, extend only).');
  return { update(res) { X.update(res); O.update(res); P.update(res); } };
}

/** Flap & speedbrake panel (levers, flap gauge, lights) and stab trim cutouts. */
export function panels(O, ctx) {
  const F = O.panel('Flaps and speedbrake', 200);
  F.lamp(14, 12, 48, 18, 'LE FLAPS\nTRANSIT', 'leTransit');
  F.lamp(14, 32, 48, 18, 'LE FLAPS\nEXT', 'leExt', 'green');
  F.lamp(238, 12, 48, 18, 'SPEED BRAKE\nARMED', 'sbArmed', 'green');
  F.lamp(238, 32, 48, 18, 'SPEEDBRAKES\nEXTENDED', 'sbExtended');
  F.lamp(238, 52, 48, 18, 'SPEED BRAKE\nDO NOT ARM', 'sbDoNotArm');
  F.lamp(14, 52, 48, 18, 'LOAD\nRELIEF', 'loadRelief');
  // Flap position indicator: the 737's non-linear dial, L and R needles.
  const pts = [[0, -135], [1, -105], [2, -78], [5, -45], [10, -10], [15, 25], [25, 65], [30, 100], [40, 135]];
  F.dial(150, 52, 40, {
    scales: [{ pts, ticks: DETENTS.map((v) => [v, 0.2, 1.4]), labels: DETENTS.map((v) => [v, v ? String(v) : 'UP']), lr: 0.62, lfs: 8 }],
    texts: [[0, 0.5, 'FLAPS', 6.5]], hub: 0.18,
    needles: [{ fn: (r) => r.values.flap, len: 0.82, w: 2, tag: 'L' }, { fn: (r) => r.values.flap, len: 0.6, w: 2, tag: 'R' }],
  });
  F.knob(70, 150, 'flap', DETENTS.map((v) => (v ? String(v) : 'UP')), [-120, -90, -60, -30, 0, 30, 60, 90, 120], { name: 'FLAP LEVER', r: 14 });
  F.knob(230, 150, 'sb', ['DOWN', 'ARMED', 'FLT DET', 'UP'], [-75, -25, 25, 75], { name: 'SPEED BRAKE', r: 14 });
  // LE DEVICES annunciator (aft overhead, FCOM 9.10): a light column per LE
  // device, swept like the wings — slats 1–4 and flaps 1–2 on the left, flaps
  // 3–4 and slats 5–8 on the right. TRANSIT amber; EXT and FULL EXT green
  // (the Krueger flaps have no FULL EXT: they are fully out when EXT).
  const LE = O.panel('LE devices', 112);
  LE.text(150, 13, 'LE DEVICES', { size: 8 });
  const tr = (r) => !!r.lights.leTransit, ext = (r) => !r.lights.leTransit && r.values.leIdx === 1, full = (r) => !r.lights.leTransit && r.values.leIdx === 2;
  const flapExt = (r) => !r.lights.leTransit && r.values.leIdx >= 1;
  const col = (x, dy, krueger) => {
    LE.lamp(x, 24 + dy, 14, 11, '', tr, 'amber solid');
    LE.lamp(x, 37 + dy, 14, 11, '', krueger ? flapExt : ext, 'green solid');
    if (!krueger) LE.lamp(x, 50 + dy, 14, 11, '', full, 'green solid');
  };
  // Left wing: outboard slat 1 … inboard flap 2; right wing mirrored.
  ['S1', 'S2', 'S3', 'S4', 'F1', 'F2'].forEach((d, k) => col(14 + k * 17 + (k > 3 ? 4 : 0), (5 - k) * 3, d[0] === 'F'));
  ['F3', 'F4', 'S5', 'S6', 'S7', 'S8'].forEach((d, k) => col(186 + k * 17 + (k > 1 ? 4 : 0), k * 3, d[0] === 'F'));
  LE.text(97, 22, '1  2', { size: 6 }); LE.text(195, 22, '3  4', { size: 6 });
  LE.text(150, 32, 'FLAPS', { size: 6 });
  LE.text(150, 45, 'TRANSIT', { size: 6 }); LE.text(150, 56, 'EXT', { size: 6 }); LE.text(150, 67, 'FULL EXT', { size: 6 });
  LE.text(50, 88, '1   2   3   4', { size: 6 }); LE.text(250, 88, '5   6   7   8', { size: 6 });
  LE.text(50, 99, 'SLATS', { size: 6 }); LE.text(250, 99, 'SLATS', { size: 6 });
  LE.text(150, 99, 'TEST', { size: 6 });

  // STAB TRIM cutout switches: a black control-stand panel, both guarded.
  const T = O.panel('Stabilizer trim', 70, { bg: '#17191b' });
  T.text(150, 13, 'STAB TRIM', { size: 8 });
  T.toggle(110, 42, 'stabMain', ['NORMAL', 'CUT OUT'], { guard: 'red', guardPos: 0, labels: 'left' });
  T.toggle(190, 42, 'stabAp', ['NORMAL', 'CUT OUT'], { guard: 'red', guardPos: 0 });
  T.text(110, 64, 'MAIN ELECT', { size: 6 }); T.text(190, 64, 'AUTO PILOT', { size: 6 });
  // Speedbrake lights: ARMED / DO NOT ARM (captain), EXTENDED (first officer).
  const SL = O.panel('Speedbrake lights L', 26);
  SL.lamp(20, 4, 120, 18, 'SPEED BRAKE\nARMED', 'sbArmed', 'green');
  SL.lamp(160, 4, 120, 18, 'SPEED BRAKE\nDO NOT ARM', 'sbDoNotArm');
  const SR = O.panel('Speedbrake lights R', 26);
  SR.lamp(90, 4, 120, 18, 'SPEEDBRAKES\nEXTENDED', 'sbExtended');
}
