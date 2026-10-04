// schem-gear.js — gear actuation, brakes and steering schematic, with the
// landing gear, autobrake and nose wheel steering panels.

import { createSchematic, createPanel } from './schem-kit.js?v=9';
import { createOverhead } from './overhead.js?v=9';

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
  P.actions(P.fail('Antiskid fault', 'antiskid'), P.fail('Autobrake fault', 'autobrake'));
  P.actions(P.push('OPEN / CLOSE MANUAL EXT. DOOR', () => ctx.set('door', ctx.sw.door ? 0 : 1)),
    P.push('PULL MANUAL HANDLES', () => ctx.action('pullHandles')), P.push('RESET TO NORMAL', ctx.reset));
  P.note('Try Takeoff → <b>Cruise</b> with the lever on DN: the gear stays down. Then Hydraulics → <b>A leak</b>, gear lever DN in the Landing phase: nothing moves — open the access door and pull the handles; the gear free-falls and locks. On the ground the lever lock stops UP.');
  return { update(res) { X.update(res); O.update(res); P.update(res); } };
}

/** Landing gear lever + lights, autobrake / antiskid, nose wheel steering. */
export function panels(O, ctx) {
  const L = O.panel('Landing gear', 120);
  L.text(150, 12, 'LANDING GEAR', { size: 8.5 });
  [['LEFT\nGEAR', 40], ['NOSE\nGEAR', 92], ['RIGHT\nGEAR', 144]].forEach(([n, x]) => {
    L.lamp(x - 22, 24, 44, 22, n, 'red', 'red');
    L.lamp(x - 22, 50, 44, 22, n, 'green', 'green');
  });
  L.toggle(232, 64, 'lever', ['UP', 'OFF', 'DN'], { name: 'GEAR LEVER', nameBox: false });
  L.text(92, 98, 'red: in transit / disagree · green: down & locked', { size: 6 });
  const AB = O.panel('Autobrake', 96);
  AB.lamp(14, 10, 56, 20, 'ANTISKID\nINOP', 'antiskid');
  AB.lamp(14, 36, 56, 20, 'AUTO BRAKE\nDISARM', 'abDisarm');
  AB.knob(130, 48, 'ab', ['OFF', 'RTO', '1', '2', '3', 'MAX'], [-110, -66, -22, 22, 66, 110], { name: 'AUTO BRAKE', r: 13 });
  AB.dial(236, 44, 26, {
    scales: [{ pts: [[0, -135], [4000, 135]], ticks: [0, 1000, 2000, 3000, 4000].map((v) => [v, 0.2, 1.3]), labels: [[0, '0'], [1000, '1'], [2000, '2'], [3000, '3'], [4000, '4']], lr: 0.62, lfs: 7 }],
    texts: [[0, 0.5, 'BRAKE\nPRESS', 5.5]], hub: 0.18,
    needles: [{ fn: (r) => r.values.acc, len: 0.8, w: 2 }],
  });
  AB.lamp(206, 76, 60, 14, 'PARKING BRAKE', 'park', 'red');
  AB.toggle(74, 80, 'park', ['', 'SET'], { horizontal: true, name: '' });
  const N = O.panel('Nose wheel steering', 60);
  N.text(150, 12, 'NOSE WHEEL STEERING', { size: 8 });
  N.toggle(150, 38, 'nws', ['ALT', 'NORM'], { horizontal: true, guard: 'red', guardPos: 1 });
}
