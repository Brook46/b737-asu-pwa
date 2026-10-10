// schem-fire.js — fire detection / extinguishing schematic + the fire
// protection panel (aft pedestal) and the cargo fire panel.

import { createSchematic, createPanel } from './schem-kit.js?v=36';
import { createOverhead } from './overhead.js?v=36';

const R = '#d62828', DET = '#ff8787', AG = '#dee2e6';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 640);
  X.onPart = ctx.onPart;
  // The airplane from above with every fire zone where it is; detection
  // logic and fire switches for each engine on its own side.
  const AP = X.airplane(500, 36, 12.5);
  const zones = X.el('g', {}, X.svg.children[1]);
  const zone = (shape, attrs, state, part) => {
    const n = X.el(shape, { ...attrs, class: 'zone' }, zones);
    X.bind((r) => n.setAttribute('class', 'zone ' + (state(r) || '')));
    n.addEventListener('click', () => X.onPart?.(part));
    return n;
  };
  const rectZ = (X1, X2, z1, z2) => { const [x1, y1] = AP(X1, z1), [x2, y2] = AP(X2, z2); return { x: Math.min(x1, x2), y: Math.min(y1, y2), width: Math.abs(x2 - x1), height: Math.abs(y2 - y1), rx: 4 }; };
  const engState = (i) => (r) => (r.lights[`fsw${i}`] ? 'fire' : r.lights[`engOvht${i}`] ? 'ovht' : r.units[`loops${i}`] === 'fault' ? 'ovht' : 'mon');
  for (const [i, s] of [[1, -1], [2, 1]]) {
    const [cx, cy] = AP(3.5, s * 5.0);
    zone('ellipse', { cx, cy, rx: 13, ry: 36 }, engState(i), `loops${i}`);
  }
  zone('rect', rectZ(-16.2, -19.4, -0.75, 0.75), (r) => (r.lights.fswApu ? 'fire' : 'mon'), 'apufire');
  zone('rect', rectZ(-1.4, -4.4, -1.3, 1.3), (r) => (r.lights.wheelWell ? 'fire' : 'mon'), 'wheelwell');
  zone('rect', rectZ(11.5, 5.0, -1.05, 1.05), (r) => (r.lights.cargoFwd ? 'fire' : 'mon'), 'cargo');
  zone('rect', rectZ(-5.0, -11.5, -1.05, 1.05), (r) => (r.lights.cargoAft ? 'fire' : 'mon'), 'cargo');
  const zl = (X0, z, t, anchor = 'middle') => { const [x, y] = AP(X0, z); X.text(x, y, t, 't-small t-dim halo', anchor); };
  zl(8.3, 0, 'FWD'); zl(8.3 - 0.9, 0, 'CARGO');
  zl(-8.2, 0, 'AFT'); zl(-8.2 - 0.9, 0, 'CARGO');
  zl(-3.6, 0, 'WHEEL WELL'); zl(-17.6, 1.2, 'APU', 'start');
  // Engine bottles (position schematic) piped to both engines; cargo bottles
  // in the mix bay on the forward spar (FCOM 8.20).
  const [bx, by] = AP(1.0, 0);
  for (const [i, s, key, light] of [[1, -1, 'agent1', 'botL'], [2, 1, 'agent2', 'botR']]) {
    const [ex, ey] = AP(3.5, s * 5.0);
    X.pipe([[bx + s * 10, by], [ex, by], [ex, ey + 30]], key, { color: AG });
    X.unit(bx + (s < 0 ? -24 : 4), by - 10, 20, 20, '', (r) => (r.lights[light] ? 'off' : 'on'), { color: AG, part: 'bottles', round: true });
  }
  X.text(bx - 30, by + 4, 'ENG BOTTLES', 't-small t-dim halo', 'end');
  const [cbx, cby] = AP(4.4, 0);
  X.unit(cbx - 16, cby - 7, 32, 14, '', (r) => (r.lights.cargoDisch ? 'off' : 'on'), { color: AG, part: 'cargo' });
  X.text(cbx + 22, cby + 3, 'CARGO BOTTLES (mix bay)', 't-small t-dim halo', 'start');
  // Each engine's detection and fire switch, on its side.
  for (const [i, s] of [[1, -1], [2, 1]]) {
    const x0 = s < 0 ? 24 : 776, w = 200, xc = x0 + w / 2;
    const [ex, ey] = AP(3.5, s * 5.0);
    X.el('path', { d: `M${s < 0 ? x0 + w : x0},${120} L${ex - s * 14},${ey - 20}`, class: 'lead' }, X.svg.firstChild);
    X.unit(x0, 100, w, 40, `ENGINE ${i}`, (r) => (r.lights[`fsw${i}`] ? 'fault' : 'on'), { color: R, part: `loops${i}` });
    X.pipe([[xc - 50, 140], [xc - 50, 184]], `det${i}`, { color: DET, thin: true });
    X.pipe([[xc + 50, 140], [xc + 50, 184]], `det${i}`, { color: DET, thin: true });
    X.text(xc - 54, 166, 'LOOP A', 't-small t-dim', 'end');
    X.text(xc + 54, 166, 'LOOP B', 't-small t-dim', 'start');
    X.unit(x0, 184, w, 32, 'BOTH LOOPS AGREE?', (r) => (r.units[`loops${i}`] === 'fault' ? 'fault' : 'on'), { color: DET, part: `loops${i}`, small: true });
    X.value(xc, 238, (r) => ({ text: r.lights[`fsw${i}`] ? 'FIRE' : r.lights[`engOvht${i}`] ? 'OVERHEAT' : 'NORMAL', cls: 't-big' + (r.lights[`fsw${i}`] || r.lights[`engOvht${i}`] ? ' warn' : '') }));
    X.annun(x0 + 30, 254, w - 60, 30, `ENGINE ${i} FIRE SWITCH`, (r) => r.lights[`fsw${i}`], 'red', { part: 'fsw' });
    X.annun(x0 + 30, 292, w - 60, 20, 'ENG OVERHEAT', (r) => r.lights[`engOvht${i}`], 'amber', { part: `loops${i}` });
    X.annun(x0 + 30, 318, w - 60, 20, `${s < 0 ? 'L' : 'R'} BOTTLE DISCHARGED`, (r) => r.lights[s < 0 ? 'botL' : 'botR'], 'amber', { part: 'bottles' });
    X.value(xc, 360, () => (ctx.sw[`pull${i}`] ? { text: 'PULLED: fuel · bleed · hyd shut,', cls: 't-small warn' } : { text: 'IN — unlocks on fire / overheat', cls: 't-small t-dim' }));
    X.value(xc, 374, () => (ctx.sw[`pull${i}`] ? { text: 'GEN off, reverser off', cls: 't-small warn' } : ''));
  }
  // APU, wheel well and cargo on the left / right low.
  X.annun(24, 430, 200, 30, 'APU FIRE SWITCH', (r) => r.lights.fswApu, 'red', { part: 'apufire' });
  X.annun(24, 468, 200, 20, 'APU BOTTLE DISCHARGED', (r) => r.lights.botApu, 'amber', { part: 'apufire' });
  X.annun(24, 520, 200, 30, 'WHEEL WELL', (r) => r.lights.wheelWell, 'red', { part: 'wheelwell' });
  X.text(124, 566, 'detection only — no extinguisher', 't-small t-dim', 'middle');
  X.annun(776, 430, 96, 30, 'FWD\nCARGO', (r) => r.lights.cargoFwd, 'red', { part: 'cargo' });
  X.annun(880, 430, 96, 30, 'AFT\nCARGO', (r) => r.lights.cargoAft, 'red', { part: 'cargo' });
  X.annun(776, 468, 200, 20, 'CARGO DISCH', (r) => r.lights.cargoDisch, 'amber', { part: 'cargo' });
  X.value(876, 504, (r) => (r.lights.cargoDisch ? { text: '195 min suppression', cls: 't-small' } : ''));
  X.annun(400, 596, 200, 34, 'FIRE WARN', (r) => r.lights.fireWarn, 'red', { part: 'fsw', big: true });
  X.text(500, 582, 'Red zone: fire · amber: overheat or loop fault · outline: monitored', 't-small t-dim', 'middle');

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
