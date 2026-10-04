// schem-fire.js — fire detection / extinguishing schematic + the fire
// protection panel (aft pedestal) and the cargo fire panel.

import { createSchematic, createPanel } from './schem-kit.js?v=10';
import { createOverhead } from './overhead.js?v=10';

const R = '#d62828', DET = '#ff8787', AG = '#dee2e6';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 620);
  X.onPart = ctx.onPart;
  // Engines with their two loops, the detection logic, and the fire switch.
  for (const [i, x] of [[1, 150], [2, 850]]) {
    X.unit(x - 90, 30, 180, 70, `ENGINE ${i}`, (r) => (r.lights[`fsw${i}`] ? 'fault' : 'on'), { color: R, part: `loops${i}` });
    X.pipe([[x - 70, 112], [x - 70, 170]], `det${i}`, { color: DET, thin: true });
    X.pipe([[x + 70, 112], [x + 70, 170]], `det${i}`, { color: DET, thin: true });
    X.text(x - 70, 108, 'LOOP A', 't-small t-dim', 'middle');
    X.text(x + 70, 108, 'LOOP B', 't-small t-dim', 'middle');
    X.unit(x - 90, 170, 180, 40, 'BOTH LOOPS AGREE?', (r) => (r.units[`loops${i}`] === 'fault' ? 'fault' : 'on'), { color: DET, part: `loops${i}`, small: true });
    X.value(x, 232, (r) => ({ text: r.lights[`fsw${i}`] ? 'FIRE' : r.lights[`engOvht${i}`] ? 'OVERHEAT' : 'NORMAL', cls: 't-big' + (r.lights[`fsw${i}`] || r.lights[`engOvht${i}`] ? ' warn' : '') }));
    X.unit(x - 70, 250, 140, 40, `FIRE SWITCH ${i}`, (r) => (ctx.sw[`pull${i}`] ? 'fault' : 'on'), { color: R, part: 'fsw', small: true });
    X.value(x, 310, (r) => (ctx.sw[`pull${i}`] ? { text: 'PULLED: fuel · bleed · hyd shut, GEN off, reverser off', cls: 't-small warn' } : { text: 'IN (locked unless fire / overheat)', cls: 't-small t-dim' }));
  }
  // Bottles.
  X.unit(390, 380, 90, 50, 'BOTTLE L', (r) => (r.lights.botL ? 'off' : 'on'), { color: AG, part: 'bottles' });
  X.unit(520, 380, 90, 50, 'BOTTLE R', (r) => (r.lights.botR ? 'off' : 'on'), { color: AG, part: 'bottles' });
  X.pipe([[435, 380], [435, 350], [150, 350], [150, 290]], 'agent1', { color: AG });
  X.pipe([[565, 380], [565, 350], [850, 350], [850, 290]], 'agent2', { color: AG });
  X.text(500, 340, 'either bottle → either engine (rotate the pulled switch L or R)', 't-small t-dim', 'middle');
  // APU, wheel well, cargo.
  X.unit(60, 470, 200, 50, 'APU', (r) => r.units.apufire, { color: R, part: 'apufire' });
  X.value(160, 540, (r) => (r.lights.fswApu ? { text: 'APU FIRE', cls: 't-small warn' } : r.lights.botApu ? { text: 'APU BOTTLE DISCHARGED', cls: 't-small' } : ''));
  X.unit(400, 470, 200, 50, 'MAIN WHEEL WELL', (r) => r.units.wheelwell, { color: R, part: 'wheelwell', small: true });
  X.text(500, 540, 'detection only — no extinguisher', 't-small t-dim', 'middle');
  X.unit(740, 470, 200, 50, 'CARGO FWD / AFT', (r) => r.units.cargo, { color: R, part: 'cargo', small: true });
  X.value(840, 540, (r) => (r.lights.cargoDisch ? { text: 'DISCHARGED · 195 min suppression', cls: 't-small' } : ''));
  X.value(500, 600, (r) => (r.lights.fireWarn ? { text: '■ FIRE WARN ■  bell', cls: 't-big warn' } : ''));

  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);
  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('INSTRUCTOR · FAILURES');
  P.actions(P.fail('ENG 1 fire', 'fire1'), P.fail('ENG 2 fire', 'fire2'), P.fail('ENG 1 overheat', 'ovht1'), P.fail('ENG 1 loop A', 'loopA1'),
    P.fail('ENG 1 loop B', 'loopB1'), P.fail('APU fire', 'apuFire'), P.fail('Wheel well fire', 'wheelWell'), P.fail('Fwd cargo smoke', 'cargoFwd'));
  P.actions(P.push('RESET TO NORMAL', ctx.reset));
  P.note('Try: <b>ENG 1 fire</b> → silence the bell (FIRE WARN) → pull fire switch 1 (it shuts engine 1 down) → rotate it to discharge a bottle. Or fail loop A only: with OVHT DET in NORMAL there\'s no indication; select A and FAULT lights.');
  return { update(res) { X.update(res); O.update(res); P.update(res); } };
}

/** Fire protection panel (aft pedestal) and cargo fire panel. */
export function panels(O, ctx) {
  const F = O.panel('Fire protection', 250);
  F.lamp(118, 8, 64, 22, 'FIRE WARN', 'fireWarn', 'red');
  F.push(206, 19, () => ctx.action('bell'), { name: 'BELL CUTOUT' });
  F.text(150, 44, 'OVHT DET', { size: 7 });
  F.toggle(40, 66, 'ovht1', ['A', 'NORMAL', 'B'], { horizontal: true, name: '1' });
  F.toggle(260, 66, 'ovht2', ['A', 'NORMAL', 'B'], { horizontal: true, name: '2' });
  F.lamp(96, 52, 50, 16, 'ENG 1\nOVERHEAT', 'engOvht1');
  F.lamp(154, 52, 50, 16, 'ENG 2\nOVERHEAT', 'engOvht2');
  F.lamp(96, 72, 50, 14, 'FAULT', 'fault');
  F.lamp(154, 72, 50, 14, 'APU DET\nINOP', 'apuDetInop');
  // Fire switches: a lit red handle, pull it, then rotate for L or R bottle.
  for (const [k, x, label] of [['1', 52, 'ENG 1'], ['Apu', 150, 'APU'], ['2', 248, 'ENG 2']]) {
    F.lamp(x - 30, 102, 60, 30, label, `fsw${k}`, 'red');
    F.toggle(x - 14, 168, `pull${k}`, ['IN', 'PULLED'], { labels: 'left' });
    F.knob(x + 18, 168, `rot${k}`, ['L', 'R'], [-45, 45], { action: true, r: 10, noLabels: true });
    F.text(x + 18, 192, 'L  ·  R', { size: 6 });
  }
  F.lamp(20, 210, 60, 16, 'L BOTTLE\nDISCHARGED', 'botL');
  F.lamp(120, 210, 60, 16, 'APU BOTTLE\nDISCHARGE', 'botApu');
  F.lamp(220, 210, 60, 16, 'R BOTTLE\nDISCHARGED', 'botR');
  F.lamp(124, 230, 52, 14, 'WHEEL WELL', 'wheelWell', 'red');
  F.toggle(40, 236, 'test', ['FAULT/INOP', '·', 'OVHT/FIRE'], { horizontal: true });
  F.toggle(260, 236, 'ext', ['1', '·', '2'], { horizontal: true, name: 'EXT TEST' });

  const C = O.panel('Cargo fire', 96);
  C.text(150, 14, 'CARGO FIRE', { size: 8.5 });
  C.lamp(40, 24, 50, 22, 'FWD', 'cargoFwd', 'red');
  C.lamp(210, 24, 50, 22, 'AFT', 'cargoAft', 'red');
  C.toggle(65, 70, 'armFwd', ['NORM', 'ARMED']);
  C.toggle(235, 70, 'armAft', ['NORM', 'ARMED'], { labels: 'left' });
  C.lamp(122, 30, 56, 18, 'DISCH', 'cargoDisch');
  C.push(150, 70, () => ctx.action('cargoDisch'), { bottom: 'DISCH' });
}
