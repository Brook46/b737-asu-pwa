// schem-fire.js — fire detection / extinguishing schematic + the fire
// protection panel (aft pedestal) and the cargo fire panel.

import { createSchematic, createPanel } from './schem-kit.js?v=14';
import { createOverhead } from './overhead.js?v=14';

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
  // Overheat / fire protection panel (aft electronic panel), laid out as on
  // the airplane: OVHT DET + overheat light, handle 1, the centre lights,
  // APU handle, BELL CUTOUT, OVHT DET 2, handle 2, bottle lights + EXT TEST.
  const F = O.panel('Fire protection', 122);
  F.text(30, 10, 'OVHT DET', { size: 6 });
  F.toggle(30, 36, 'ovht1', ['A', 'NORMAL', 'B'], { horizontal: true });
  F.lamp(8, 52, 44, 18, 'ENG 1\nOVERHEAT', 'engOvht1');
  F.text(30, 80, 'TEST', { size: 5.5 });
  F.toggle(30, 104, 'test', ['FAULT\nINOP', '', 'OVHT\nFIRE'], { horizontal: true, momentary: [0, 2] });
  for (const [k, x, label] of [['1', 60, '1'], ['Apu', 137, 'APU'], ['2', 212, '2']]) {
    F.text(x + 15, 13, '↶ DISCH ↷', { size: 5.2 });
    F.fireHandle(x, 20, 30, 78, { label, pullKey: `pull${k}`, rotKey: `rot${k}`, lamp: `fsw${k}`, name: `${label === 'APU' ? 'APU' : 'Engine ' + label} fire switch` });
  }
  F.text(152, 114, 'PULL · ROTATE', { size: 5 });
  F.lamp(96, 8, 37, 14, 'WHEEL\nWELL', 'wheelWell', 'red');
  F.lamp(96, 25, 37, 12, 'FAULT', 'fault');
  F.lamp(96, 40, 37, 14, 'APU DET\nINOP', 'apuDetInop');
  F.lamp(96, 57, 37, 18, 'APU BOTTLE\nDISCHARGED', 'botApu');
  F.push(186, 20, () => ctx.action('bell'), { top: 'BELL CUTOUT', name: 'BELL CUTOUT' });
  F.text(188, 42, 'OVHT DET', { size: 6 });
  F.toggle(188, 68, 'ovht2', ['A', 'NORMAL', 'B'], { horizontal: true });
  F.lamp(169, 84, 38, 18, 'ENG 2\nOVERHEAT', 'engOvht2');
  F.lamp(246, 8, 25, 22, 'L BOTTLE\nDISCHARGED', 'botL');
  F.lamp(273, 8, 25, 22, 'R BOTTLE\nDISCHARGED', 'botR');
  F.text(272, 44, 'EXT TEST', { size: 6 });
  F.toggle(272, 62, 'ext', ['1', '', '2'], { horizontal: true, momentary: [0, 2] });
  for (const [x, y] of [[256, 84], [280, 84], [268, 98]]) F.lamp(x - 5, y - 5, 10, 10, '', 'extTest', 'green');

  // Cargo fire panel.
  const C = O.panel('Cargo fire', 84);
  C.text(10, 24, 'C\nA\nR\nG\nO', { size: 6 });
  C.text(46, 12, 'EXT', { size: 6.5 });
  C.text(36, 21, 'FWD', { size: 5.5 }); C.text(56, 21, 'AFT', { size: 5.5 });
  C.lamp(30, 25, 12, 12, '', 'extTest', 'green'); C.lamp(50, 25, 12, 12, '', 'extTest', 'green');
  C.push(46, 60, () => ctx.action('cargoTest'), { top: 'TEST', name: 'Cargo fire TEST' });
  C.text(126, 8, 'DET SELECT', { size: 6 });
  C.knob(104, 38, 'detSel', ['A', 'NORM', 'B'], [-45, 0, 45], { grey: true, r: 9, name: 'FWD', nameDy: 10 });
  C.knob(148, 38, 'detSelAft', ['A', 'NORM', 'B'], [-45, 0, 45], { grey: true, r: 9, name: 'AFT', nameDy: 10 });
  C.text(126, 64, 'ARM', { size: 6 });
  for (const [x, k, fire, lab] of [[90, 'armFwd', 'cargoFwd', 'FWD'], [136, 'armAft', 'cargoAft', 'AFT']]) {
    const tog = () => ctx.set(k, ctx.sw[k] ? 0 : 1);
    C.lamp(x, 68, 36, 7, 'ARMED', () => !!ctx.sw[k], 'white', 'fire', tog);
    C.lamp(x, 75, 36, 7, lab, fire, 'red', 'fire', tog);
  }
  C.lamp(190, 12, 46, 20, 'DETECTOR\nFAULT', null);
  C.text(262, 12, 'DISCH', { size: 6.5 });
  C.frame(240, 20, 44, 50, '');
  C.lamp(246, 48, 32, 16, 'DISCH', 'cargoDisch', 'amber', 'fire', () => ctx.action('cargoDisch'));
  C.text(292, 30, 'F\nI\nR\nE', { size: 6 });
}
