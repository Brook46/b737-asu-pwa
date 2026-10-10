// schem-gear.js — gear actuation, brakes and steering schematic, with the
// landing gear, autobrake and nose wheel steering panels.

import { createSchematic, createPanel } from './schem-kit.js?v=34';
import { createOverhead } from './overhead.js?v=34';

const A = '#2f7cf6', B = '#12a874', G = '#868e96', BR = '#e8590c';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 640);
  X.onPart = ctx.onPart;
  // Hydraulic sources.
  X.unit(60, 30, 160, 44, 'SYSTEM A', (r) => (r.env.hydA !== false ? 'on' : 'fault'), { color: A, part: 'lever' });
  X.unit(780, 30, 160, 44, 'SYSTEM B', (r) => (r.env.hydB !== false ? 'on' : 'fault'), { color: B, part: 'brakes' });
  // Gear actuation (A) and the transfer valve (B).
  X.pipe([[140, 74], [140, 140], [400, 140]], 'gearA', { color: A });
  X.unit(400, 112, 200, 56, 'GEAR SELECTOR\nVALVE', (r) => (r.flows.gearA ? 'on' : 'off'), { color: G, part: 'lever' });
  X.value(500, 190, (r) => ({ text: `lever ${r.values.lever}`, cls: 't-small' }));
  X.valve(700, 140, (r) => r.values.xfr, { label: 'TRANSFER VALVE', ly: -16, part: 'lever' });
  X.pipe([[860, 74], [860, 140], [720, 140]], (r) => r.values.xfr, { color: B });
  X.pipe([[680, 140], [600, 140]], (r) => r.values.xfr, { color: B });
  X.text(700, 182, 'B raises the gear if engine 1 RPM is low', 't-small t-dim', 'middle');
  // The three gears.
  const gears = [['L MAIN', 140, 'mlg'], ['NOSE', 500, 'nlg'], ['R MAIN', 860, 'mlg']];
  for (const [n, x, part] of gears) {
    X.pipe([[500, 168], [500, 220], [x, 220], [x, 250]], 'gearA', { color: A, thin: true });
    X.unit(x - 70, 250, 140, 56, `${n} GEAR`, (r) => r.units[part], { color: G, part });
    X.value(x, 326, (r) => ({ text: r.values.pos > 0.999 ? 'DOWN & LOCKED' : r.values.pos < 0.001 ? 'UP & LOCKED' : 'IN TRANSIT', cls: 't-small' + (r.lights.red ? ' warn' : '') }));
  }
  X.unit(380, 340, 240, 34, 'MANUAL EXTENSION', (r) => (r.values.manual ? 'fault' : 'off'), { color: '#fab005', part: 'manual', small: true });
  // Brakes.
  X.pipe([[860, 74], [860, 100], [960, 100], [960, 440], [700, 440]], 'brakeB', { color: B });
  X.text(950, 420, 'NORMAL', 't-small t-dim', 'end');
  X.pipe([[60, 74], [40, 74], [40, 440], [300, 440]], 'brakeA', { color: A });
  X.text(50, 420, 'ALTERNATE', 't-small t-dim');
  X.unit(300, 410, 400, 60, 'BRAKES · ANTISKID', (r) => r.units.brakes, { color: BR, part: 'brakes' });
  X.unit(740, 480, 180, 44, 'ACCUMULATOR', () => 'on', { color: B, part: 'brakes', small: true });
  X.value(830, 545, (r) => ({ text: `${r.values.acc} psi`, cls: 't-small' }));
  X.unit(80, 480, 180, 44, 'AUTOBRAKE', (r) => r.units.autobrake, { color: BR, part: 'autobrake', small: true });
  X.value(170, 545, (r) => ({ text: `selector ${r.values.ab}`, cls: 't-small' }));
  X.unit(410, 490, 180, 40, 'PARKING BRAKE', (r) => r.units.park, { color: '#e03131', part: 'park', small: true });
  // Steering.
  X.pipe([[140, 74], [140, 100], [300, 100], [300, 600], [420, 600]], 'steer', { color: A, thin: true });
  X.pipe([[860, 74], [860, 90], [720, 90], [720, 560], [620, 560], [620, 580]], 'steerB', { color: B, thin: true });
  X.value(300, 625, (r) => ({ text: ctx.sw.nws ? (ctx.sw.lever === 2 ? 'NORM: A via lever DN' : 'NORM: lever not DN — no steering') : 'ALT: system B', cls: 't-small' + (ctx.sw.nws && ctx.sw.lever !== 2 ? ' warn' : '') }));
  X.unit(420, 580, 200, 40, 'NOSE WHEEL STEERING', (r) => (r.flows.steer || r.flows.steerB ? 'on' : 'off'), { color: G, part: 'nlg', small: true });
  X.text(640, 604, 'tiller ±78° · pedals ±7°', 't-small t-dim');

  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);
  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('INSTRUCTOR · FAILURES');
  P.actions(P.push('GEAR LEVER UP', () => ctx.set('lever', 0)), P.push('OFF', () => ctx.set('lever', 1)), P.push('DN', () => ctx.set('lever', 2)));
  P.actions(P.fail('Antiskid fault', 'antiskid'), P.fail('Autobrake fault', 'autobrake'));
  P.actions(P.push('OPEN / CLOSE MANUAL EXT. DOOR', () => ctx.set('door', ctx.sw.door ? 0 : 1)),
    P.push('PULL MANUAL HANDLES', () => ctx.action('pullHandles')), P.push('RESET TO NORMAL', ctx.reset));
  P.note('Try Takeoff → <b>Cruise</b> with the lever on DN: the gear stays down. Then Hydraulics → <b>A leak</b>, gear lever DN in the Landing phase: nothing moves — open the access door and pull the handles; the gear free-falls and locks. On the ground the lever lock stops UP.');
  return { update(res) { X.update(res); O.update(res); P.update(res); } };
}

/**
 * Panels as on the airplane: the gear indicator lights above the lever (the
 * lever itself is the 3D lever in the cockpit), the centre forward panel
 * strip (N1 SET, SPD REF, FUEL FLOW, MFD, AUTO BRAKE, flap gauge, LE FLAPS),
 * the brake pressure gauge (first officer's panel), nose wheel steering
 * (captain's panel) and the parking brake (control stand).
 */
export function panels(O, ctx) {
  const fc = () => ctx.resOf?.('flightcontrols');
  // Gear indicator lights: NOSE on top, LEFT and RIGHT below; red over green.
  const L = O.panel('Landing gear', 128);
  L.lamp(116, 8, 68, 16, 'NOSE\nGEAR', 'red', 'red');
  L.lamp(116, 26, 68, 16, 'NOSE\nGEAR', 'green', 'green');
  L.lamp(80, 46, 68, 16, 'LEFT\nGEAR', 'red', 'red');
  L.lamp(152, 46, 68, 16, 'RIGHT\nGEAR', 'red', 'red');
  L.lamp(80, 64, 68, 16, 'LEFT\nGEAR', 'green', 'green');
  L.lamp(152, 64, 68, 16, 'RIGHT\nGEAR', 'green', 'green');
  L.placard(8, 86, 100, ['LANDING GEAR LIMIT (IAS)', 'EXTEND 270K-.82M', 'RETRACT 235K', 'EXTENDED 320K-.82M'], { size: 5.2 });
  L.placard(192, 86, 100, ['FLAPS LIMIT (IAS)', '1-250K  15-200K', '2-250K  25-190K', '5-250K  30-175K', '10-210K 40-162K'], { size: 5 });

  // Centre forward panel strip above the upper display.
  const C = O.panel('Center panel', 100);
  C.knob(30, 38, 'n1set', ['2', '1', 'AUTO', 'BOTH'], [-70, -25, 20, 65], { r: 9, inert: true, inertPos: 2, name: 'N1 SET', nameDy: 10 });
  C.knob(86, 38, 'spdref', ['SET', 'AUTO', 'V1', 'VR', 'WT', 'VREF'], [-85, -50, -15, 20, 55, 90], { r: 9, inert: true, inertPos: 1, name: 'SPD REF', nameDy: 10 });
  C.toggle(56, 84, 'ff', ['RESET', 'RATE', 'USED'], { horizontal: true, inert: true, inertPos: 1 });
  C.text(56, 98, 'FUEL FLOW', { size: 5 });
  C.text(139, 60, 'MFD', { size: 5.5 });
  C.push(128, 76, null, { bottom: 'ENG', name: 'MFD ENG' });
  C.push(150, 76, null, { bottom: 'SYS', name: 'MFD SYS' });
  C.text(196, 10, 'AUTO BRAKE', { size: 6.5 });
  C.lamp(176, 15, 40, 14, 'AUTO BRAKE\nDISARM', 'abDisarm');
  C.knob(196, 58, 'ab', ['RTO', 'OFF', '1', '2', '3', 'MAX'], [-125, -85, -42, 0, 42, 85], { grey: true, r: 10 });
  C.text(196, 84, 'ANTISKID', { size: 5 });
  C.lamp(178, 87, 36, 11, 'ANTISKID INOP', 'antiskid');
  // Flap position indicator (reads Flight Controls) and the LE FLAPS lights.
  const pts = [[0, -135], [1, -105], [2, -78], [5, -45], [10, -10], [15, 25], [25, 65], [30, 100], [40, 135]];
  C.dial(262, 38, 24, {
    scales: [{ pts, ticks: [0, 1, 2, 5, 10, 15, 25, 30, 40].map((v) => [v, 0.2, 1.2]), labels: [[0, 'UP'], [5, '5'], [15, '15'], [25, '25'], [40, '40']], lr: 0.6, lfs: 5.5 }],
    texts: [[0, 0.62, 'FLAPS', 4.5]], hub: 0.18,
    needles: [{ fn: () => fc()?.values.flap ?? 0, len: 0.82, w: 1.6, tag: 'L' }, { fn: () => fc()?.values.flap ?? 0, len: 0.6, w: 1.6, tag: 'R' }],
  });
  C.lamp(236, 74, 25, 14, 'LE FLAPS\nTRANSIT', () => fc()?.lights.leTransit);
  C.lamp(264, 74, 25, 14, 'LE FLAPS\nEXT', () => fc()?.lights.leExt, 'green');

  // HYD BRAKE PRESS (first officer's panel): psi × 1000, 0 at the bottom.
  const B = O.panel('Brake pressure', 90);
  B.dial(150, 46, 32, {
    scales: [{ pts: [[0, 180], [1, 235], [2, 295], [3, 355], [4, 410]],
      ticks: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4].map((v) => [v, v % 1 ? 0.1 : 0.18, v % 1 ? 0.8 : 1.3]),
      labels: [[0, '0'], [1, '1'], [2, '2'], [3, '3'], [4, '4']], lr: 0.64, lfs: 7,
      bands: [[0, 2.9, '#ffad1f', 3], [2.9, 3.6, '#2fbf60', 3.5], [3.6, 4, '#e5322b', 3.5]] }],
    texts: [[0.42, 0.18, 'BRAKE\nPRESS', 4.6, 'start'], [0, 0.55, 'PSI x1000', 4.4]], hub: 0.16,
    needles: [{ fn: (r) => r.values.acc / 1000, len: 0.8, w: 2.2 }],
  });

  // Nose wheel steering (captain's panel, under the clock).
  const N = O.panel('Nose wheel steering', 54);
  N.text(150, 12, 'NOSE WHEEL STEERING', { size: 7.5 });
  N.toggle(150, 36, 'nws', ['ALT', 'NORM'], { horizontal: true, guard: 'red', guardPos: 1 });

  // Parking brake (control stand): pull handle and red light.
  const PB = O.panel('Parking brake', 46, { bg: '#17191b' });
  PB.lamp(196, 10, 64, 24, 'PARKING\nBRAKE', 'park', 'red', 'gear', () => ctx.set('park', ctx.sw.park ? 0 : 1));
  PB.placard(40, 8, 84, ['PARKING BRAKE', 'PULL'], { size: 7, bg: '#e9ecef' });
  PB.push(150, 23, () => ctx.set('park', ctx.sw.park ? 0 : 1), { name: 'Parking brake lever (pull to set)' });
}
