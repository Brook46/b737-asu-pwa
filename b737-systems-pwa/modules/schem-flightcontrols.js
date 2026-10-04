// schem-flightcontrols.js — high-lift / speedbrake / primary-surface power
// schematic, with the flap & speedbrake panel and stab trim cutouts.

import { createSchematic, createPanel } from './schem-kit.js?v=13';
import { createOverhead } from './overhead.js?v=13';
import { DETENTS } from './sys-flightcontrols.js?v=13';

const C = '#3a86ff', B = '#12a874', A = '#2f7cf6', S = '#f2711c', DRV = '#fab005', EL = '#f5a300';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 640);
  X.onPart = ctx.onPart;
  // Flap lever → FSEU → drive (B hydraulic or electric alternate) → torque tubes.
  X.unit(40, 30, 150, 50, 'FLAP LEVER', () => 'on', { color: C, part: 'flaps' });
  X.value(115, 100, (r) => ({ text: `selected ${r.values.lever}`, cls: 't-small' }));
  X.pipe([[190, 55], [290, 55]], () => true, { thin: true, color: C, still: true });
  X.unit(290, 30, 150, 50, 'FSEU', () => 'on', { color: C, part: 'le' });
  X.pipe([[440, 55], [520, 55], [520, 140]], (r) => r.env.hydB !== false, { color: B });
  X.text(530, 100, 'SYS B', 't-small t-dim');
  X.pipe([[440, 70], [470, 70], [470, 180], [430, 180]], (r) => !!r.env.altFlapsArmed, { color: EL, thin: true });
  X.unit(300, 160, 130, 40, 'ALT FLAP MOTOR', (r) => (r.env.altFlapsArmed ? 'on' : 'off'), { color: EL, part: 'pdu', small: true });
  X.unit(450, 140, 140, 60, 'FLAP DRIVE\nUNIT', (r) => (r.flows.torque ? 'on' : 'off'), { color: DRV, part: 'pdu' });
  X.pipe([[450, 170], [60, 170], [60, 260]], 'torque', { color: DRV });
  X.pipe([[590, 170], [940, 170], [940, 260]], 'torque', { color: DRV });
  X.text(250, 162, 'TORQUE TUBE', 't-small t-dim', 'middle');
  // TE flaps L/R with angle gauge bars.
  for (const [x, lab] of [[60, 'L TE FLAPS'], [940, 'R TE FLAPS']]) {
    X.unit(x - 55, 260, 110, 60, lab, (r) => r.units.flaps, { color: C, part: 'flaps', small: true });
    X.value(x, 340, (r) => ({ text: `${r.values.flap.toFixed(1)}°`, cls: 't-big' }));
  }
  // LE devices.
  X.unit(380, 260, 240, 60, 'LE FLAPS & SLATS', (r) => r.units.le, { color: C, part: 'le' });
  X.value(500, 340, (r) => ({ text: r.values.le, cls: 't-big' }));
  X.pipe([[500, 200], [500, 260]], (r) => r.env.leB !== false, { color: B, thin: true });
  X.text(510, 238, 'B (or A via PTU)', 't-small t-dim');
  X.pipe([[640, 290], [620, 290]], (r) => !!r.env.stbyLe, { color: S, thin: true });
  X.text(648, 294, 'STBY: extend only', 't-small t-dim');
  // Speedbrakes.
  X.unit(380, 380, 240, 50, 'SPEEDBRAKES', (r) => r.units.sb, { color: '#4dabf7', part: 'sb' });
  X.value(500, 450, (r) => ({ text: `lever ${r.values.sb}`, cls: 't-small' }));
  // Primary surfaces and their power.
  const prim = [['AILERONS', 'ail'], ['ELEVATORS', 'elev'], ['RUDDER', 'rud']];
  prim.forEach(([n, part], i) => {
    const x = 120 + i * 300;
    X.unit(x - 90, 500, 180, 46, n, (r) => (r.env.hydAfc || r.env.hydBfc ? 'on' : 'fault'), { color: C, part });
    X.pipe([[x - 50, 470], [x - 50, 500]], (r) => !!r.env.hydAfc, { color: A, thin: true });
    X.pipe([[x + 50, 470], [x + 50, 500]], (r) => !!r.env.hydBfc, { color: B, thin: true });
    X.text(x - 50, 465, 'A', 't-small', 'middle'); X.text(x + 50, 465, 'B', 't-small', 'middle');
  });
  X.pipe([[770, 546], [770, 580]], (r) => !!r.env.stbyRud, { color: S, thin: true });
  X.text(780, 590, 'STBY RUDDER PCU', 't-small t-dim');
  X.text(500, 620, 'Either A or B alone powers all primary surfaces; ailerons and elevators can be moved manually; the rudder has the standby PCU.', 't-small t-dim', 'middle');

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
