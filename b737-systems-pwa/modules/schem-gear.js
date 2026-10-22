// schem-gear.js — gear actuation, brakes and steering schematic, with the
// landing gear, autobrake and nose wheel steering panels.

import { createSchematic, createPanel } from './schem-kit.js?v=63';
import { NLG, MLG } from './airframe.js?v=63';
import { createOverhead } from './overhead.js?v=63';
import { flapGauge } from './gauges.js?v=63';

const A = '#2f7cf6', B = '#12a874', G = '#868e96', BR = '#e8590c';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 640);
  X.onPart = ctx.onPart;
  // ── The airplane from above, each gear where it is ──
  const AP = X.plan(500, 26, 13.6);
  const GEARS = { N: AP.P(NLG.x, 0), L: AP.P(MLG.x, -MLG.z), R: AP.P(MLG.x, MLG.z) };
  const NAME = { N: 'NOSE', L: 'LEFT MAIN', R: 'RIGHT MAIN' };
  const stateOf = (r, k) => { const p = r.values.p?.[k] ?? r.values.pos; return p > 0.999 ? 'down' : p < 0.001 ? 'up' : 'transit'; };
  const COL = { down: '#2fbf5b', up: '#56606b', transit: '#e03131' };
  for (const [k, [x, y]] of Object.entries(GEARS)) {
    const g = X.el('g', { class: 'hit' }, X.svg);
    const wheels = [-1, 1].map((s) => X.el('rect', { x: x + s * 7 - 4, y: y - 9, width: 8, height: 18, rx: 2.5, fill: COL.down, stroke: '#0f1215' }, g));
    const strut = X.el('line', { x1: x - 3, y1: y, x2: x + 3, y2: y, stroke: '#cfd4d9', 'stroke-width': 2 }, g);
    g.addEventListener('click', () => X.onPart?.(k === 'N' ? 'nlg' : 'mlg'));
    const lx = k === 'L' ? x - 60 : k === 'R' ? x + 60 : x + 70, la = k === 'L' ? 'end' : 'start';
    X.text(lx, y - 4, `${NAME[k]} GEAR`, 't-small halo', la);
    X.value(lx, y + 10, (r) => {
      const st = stateOf(r, k), rel = r.values.rel?.[k];
      return { text: (st === 'down' ? 'DOWN & LOCKED' : st === 'up' ? 'UP & LOCKED' : rel ? 'FREE-FALLING' : 'IN TRANSIT') + (rel && st === 'down' ? ' (manual)' : ''), cls: 't-small halo' + (st === 'transit' ? ' warn' : '') };
    }, 't-small', la);
    X.bind((r) => { const c = COL[stateOf(r, k)]; for (const w of wheels) w.setAttribute('fill', c); strut.setAttribute('opacity', stateOf(r, k) === 'up' ? 0.3 : 1); });
  }
  // Manual extension: three handles under the flight deck floor, a cable to each uplock.
  const [hx, hy] = AP.P(15.0, 0);
  X.unit(hx - 54, hy - 12, 108, 24, 'MANUAL EXT.', (r) => (r.values.manual ? 'on' : r.values.door ? 'fault' : 'off'), { color: '#fab005', part: 'manual', small: true });
  for (const k of ['L', 'N', 'R']) {
    const [x, y] = GEARS[k];
    const pts = k === 'N' ? [[hx, hy + 12], [x, y - 12]] : [[hx + (k === 'L' ? -20 : 20), hy + 12], [hx + (k === 'L' ? -20 : 20), y - 60], [x, y - 60], [x, y - 12]];
    X.pipe(pts, (r) => !!r.values.rel?.[k], { color: '#fab005', thin: true });
  }

  // ── Left: system A raises and lowers the gear ──
  X.unit(15, 24, 150, 40, 'SYSTEM A', (r) => (r.env.hydA !== false ? 'on' : 'fault'), { color: A, part: 'lever' });
  X.pipe([[90, 64], [90, 96]], 'gearA', { color: A });
  X.unit(15, 96, 150, 44, 'GEAR SELECTOR\nVALVE', (r) => (r.flows.gearA ? 'on' : 'off'), { color: G, part: 'lever' });
  X.value(90, 156, (r) => ({ text: `lever ${r.values.lever}`, cls: 't-small' }));
  // A to the actuators of each gear.
  const [nx, ny] = GEARS.N, [lx, ly] = GEARS.L, [rx, ry] = GEARS.R;
  X.pipe([[165, 118], [nx - 30, 118], [nx - 30, ny], [nx - 15, ny]], 'gearA', { color: A, thin: true });
  X.pipe([[90, 140], [90, ly], [lx - 15, ly]], 'gearA', { color: A, thin: true });
  X.pipe([[lx, ly + 14], [lx, ly + 30], [rx, ly + 30], [rx, ry + 14]], 'gearA', { color: A, thin: true });
  X.valve(90, 220, (r) => r.values.xfr, { label: 'TRANSFER VALVE', lx: 62, ly: 4, part: 'lever' });
  X.text(20, 250, 'B raises the gear if engine 1', 't-small t-dim');
  X.text(20, 263, 'RPM is low (in the air)', 't-small t-dim');
  X.unit(15, 470, 150, 34, 'AUTOBRAKE', (r) => r.units.autobrake, { color: BR, part: 'autobrake', small: true });
  X.value(90, 520, (r) => ({ text: `selector ${r.values.ab}`, cls: 't-small' }));
  X.unit(15, 540, 150, 30, 'PARKING BRAKE', (r) => r.units.park, { color: '#e03131', part: 'park', small: true });

  // ── Right: system B brakes (A alternate), accumulator, steering ──
  X.unit(835, 24, 150, 40, 'SYSTEM B', (r) => (r.env.hydB !== false ? 'on' : 'fault'), { color: B, part: 'brakes' });
  X.unit(835, 110, 150, 44, 'BRAKES · ANTISKID', (r) => r.units.brakes, { color: BR, part: 'brakes', small: true });
  X.pipe([[910, 64], [910, 110]], 'brakeB', { color: B });
  X.text(916, 92, 'NORMAL (B)', 't-small t-dim');
  X.pipe([[835, 132], [rx + 15, 132], [rx + 15, ry]], (r) => r.flows.brakeB || r.flows.brakeA, { color: BR, thin: true });
  X.pipe([[rx + 15, ry + 22], [lx - 15, ry + 22], [lx - 15, ly + 8]], (r) => r.flows.brakeB || r.flows.brakeA, { color: BR, thin: true });
  X.text(rx + 22, 150, 'brakes: main wheels only', 't-small t-dim halo');
  X.pipe([[165, 30], [200, 30], [200, 10], [960, 10], [960, 110]], 'brakeA', { color: A, thin: true });
  X.text(700, 22, 'ALTERNATE BRAKES (A)', 't-small t-dim');
  X.unit(835, 190, 150, 34, 'ACCUMULATOR', () => 'on', { color: B, part: 'brakes', small: true });
  X.value(910, 240, (r) => ({ text: `${r.values.acc} psi`, cls: 't-small' }));
  X.unit(835, 300, 150, 38, 'NOSE WHEEL\nSTEERING', (r) => (r.flows.steer || r.flows.steerB ? 'on' : 'off'), { color: G, part: 'nlg', small: true });
  X.pipe([[835, 319], [nx + 60, 319], [nx + 60, ny], [nx + 15, ny]], (r) => r.flows.steer || r.flows.steerB, { color: (A), thin: true });
  X.value(910, 356, (r) => ({ text: ctx.sw.nws ? (ctx.sw.lever === 2 ? 'NORM: A via lever DN' : 'NORM: lever not DN') : 'ALT: system B', cls: 't-small' + (ctx.sw.nws && ctx.sw.lever !== 2 ? ' warn' : '') }));
  X.text(910, 372, 'tiller ±78° · pedals ±7°', 't-small t-dim', 'middle');
  X.text(500, 628, 'Seen from above, nose up. Green: down and locked · red: in transit or disagreeing · grey: up and locked.', 't-small t-dim', 'middle');

  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);
  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('INSTRUCTOR · FAILURES');
  P.actions(P.push('GEAR LEVER UP', () => ctx.set('lever', 0)), P.push('OFF', () => ctx.set('lever', 1)), P.push('DN', () => ctx.set('lever', 2)));
  P.actions(P.fail('Gear won\'t extend normally', 'noExt'), P.fail('Antiskid fault', 'antiskid'), P.fail('Autobrake fault', 'autobrake'));
  P.actions(P.push('RESET TO NORMAL', ctx.reset));
  P.note('<b>Manual extension:</b> Cruise phase, then <b>Gear won\'t extend normally</b> (or Hydraulics → A leak) and the lever DN: nothing moves. Lever <b>OFF</b>, open the <b>access door</b> on the Manual gear extension panel and pull each handle — that gear free-falls and locks; its green comes on. On the ground the lever lock stops UP.');
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
  L.lamp(116, 8, 68, 16, 'NOSE\nGEAR', 'redN', 'red');
  L.lamp(116, 26, 68, 16, 'NOSE\nGEAR', 'greenN', 'green');
  L.lamp(80, 46, 68, 16, 'LEFT\nGEAR', 'redL', 'red');
  L.lamp(152, 46, 68, 16, 'RIGHT\nGEAR', 'redR', 'red');
  L.lamp(80, 64, 68, 16, 'LEFT\nGEAR', 'greenL', 'green');
  L.lamp(152, 64, 68, 16, 'RIGHT\nGEAR', 'greenR', 'green');
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
  flapGauge(C, 262, 38, 24, () => fc()?.values.flap ?? 0);
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

  // Manual gear extension (FCOM 14.10): an access door in the flight deck
  // floor over three handles — left main, nose, right main. Each releases
  // its gear's uplock; the gear free-falls and locks down.
  const M = O.panel('Manual gear extension', 96, { bg: '#2a2d30' });
  M.text(150, 13, 'MANUAL GEAR EXTENSION', { size: 7.5 });
  M.toggle(46, 54, 'door', ['CLOSED', 'OPEN'], { name: 'ACCESS DOOR' });
  for (const [k, x, lab] of [['L', 140, 'LEFT MAIN'], ['N', 200, 'NOSE'], ['R', 260, 'RIGHT MAIN']]) {
    M.toggle(x, 54, 'man' + k, ['STOWED', 'PULLED'], {});
    M.text(x, 90, lab, { size: 6 });
  }
  M.text(46, 90, 'ACCESS DOOR', { size: 6 });
}
