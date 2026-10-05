// schem-antiice.js — thermal (bleed) and electric anti-ice schematic, with
// the window heat, probe heat, wing / engine anti-ice and wiper panels.

import { createSchematic, createPanel } from './schem-kit.js?v=17';
import { createOverhead } from './overhead.js?v=17';
import { PROBES } from './sys-antiice.js?v=17';

const C = '#4cc9f0', HOT = '#ff6a3d', EL = '#f5a300';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 640);
  X.onPart = ctx.onPart;
  // Thermal: engines → cowl valves → lips; bleed duct → wing valves → slats.
  for (const [i, x] of [[0, 120], [1, 880]]) {
    const n = i + 1;
    X.unit(x - 70, 30, 140, 44, `ENGINE ${n}`, (r) => (r.env[`eng${n}`] ? 'on' : 'off'), { color: '#e63946', part: 'cowl' });
    X.pipe([[x, 74], [x, 120]], `cowl${n}`, { color: HOT });
    X.valve(x, 140, (r) => !!ctx.sw[`eng${n}`] && !ctx.fail[`cowl${n}`], { vertical: true, label: 'COWL VALVE', lx: i ? -56 : 56, part: 'cowl' });
    X.pipe([[x, 160], [x, 200]], `cowl${n}`, { color: HOT });
    X.unit(x - 70, 200, 140, 40, 'COWL LIP', (r) => (r.flows[`cowl${n}`] ? 'on' : 'off'), { color: C, part: 'cowl', small: true });
    X.value(x, 262, (r) => ({ text: r.values.tai[i] ? `TAI ${r.values.tai[i] === 'amber' ? '(DISAGREE)' : ''}` : '', cls: 't-small' + (r.values.tai[i] === 'amber' ? ' warn' : '') }));
  }
  X.unit(380, 30, 240, 44, 'BLEED DUCT (L · R)', (r) => (r.values.ductL || r.values.ductR ? 'on' : 'off'), { color: HOT, part: 'wingai' });
  X.value(500, 92, (r) => ({ text: `duct ${r.values.ductL} / ${r.values.ductR} psi`, cls: 't-small' }));
  for (const [i, x, side] of [[0, 320, 'L'], [1, 680, 'R']]) {
    X.pipe([[i ? 580 : 420, 74], [i ? 580 : 420, 140], [x, 140]], `wing${i + 1}`, { color: HOT });
    X.valve(x, 160, (r) => r.flows[`wing${i + 1}`], { vertical: true, label: `${side} WING VALVE`, lx: i ? 64 : -64, part: 'wingai' });
    X.pipe([[x, 180], [x, 210]], `wing${i + 1}`, { color: HOT });
    X.unit(x - 80, 210, 160, 40, 'INBOARD SLATS ×3', (r) => (r.flows[`wing${i + 1}`] ? 'on' : 'off'), { color: C, part: 'wingai', small: true });
  }
  X.text(500, 280, 'Ground: valves close above takeoff thrust or on duct overheat · switch trips OFF at lift-off', 't-small t-dim', 'middle');

  // Electric: windows and probes.
  X.text(30, 320, 'ELECTRIC', 't-small t-dim');
  ['L SIDE', 'L FWD', 'R FWD', 'R SIDE'].forEach((n, i) => {
    const x = 60 + i * 120, k = `wh${i + 1}`;
    X.unit(x, 340, 100, 40, n, (r) => (r.lights[`${k}ovht`] ? 'fault' : r.lights[`${k}on`] ? 'on' : 'off'), { color: EL, part: 'windows', small: true });
  });
  X.text(300, 400, 'windows 1 & 2: outer coating (ice, bird strike) · window 3: inside, anti-fog', 't-small t-dim', 'middle');
  [['A', 60], ['B', 320]].forEach(([sys, x0]) => {
    X.text(x0, 440, `PROBE HEAT ${sys}`, 't-small');
    PROBES[sys].forEach(([k, n], j) => {
      X.unit(x0 + (j % 2) * 120, 452 + Math.floor(j / 2) * 52, 110, 42, n.replace('\n', ' '), (r) => (r.lights[k] ? 'fault' : 'on'), { color: EL, part: 'probes', small: true });
    });
  });
  X.unit(620, 340, 160, 44, 'ICE DETECTOR', (r) => (ctx.fail.iceDet ? 'fault' : 'on'), { color: C, part: 'detector', small: true });
  X.value(700, 402, (r) => ({ text: r.lights.icing ? 'ICING' : r.lights.noIce ? 'NO ICE' : '—', cls: 't-big' + (r.lights.icing ? ' warn' : '') }));
  X.unit(820, 340, 140, 44, 'WIPERS', (r) => r.units.wipers, { color: '#868e96', part: 'wipers', small: true });
  X.value(890, 402, (r) => ({ text: `L ${r.values.wiper[ctx.sw.wiperL]} · R ${r.values.wiper[ctx.sw.wiperR]}`, cls: 't-small' }));
  X.value(780, 470, (r) => ({ text: r.values.stall ? 'STALL WARNING: ICING LOGIC' : 'stall warning: normal', cls: 't-small' + (r.values.stall ? ' warn' : '') }));

  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);
  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('INSTRUCTOR · CONDITIONS & FAILURES');
  P.actions(P.fail('Icing conditions', 'icing'), P.fail('L FWD window overheat', 'win2'), P.fail('Cowl valve 1 stuck', 'cowl1'),
    P.fail('Cowl duct overpressure 1', 'cowlOvp1'), P.fail('Capt pitot heat', 'captPitot'), P.fail('Wing duct hot (ground)', 'wingDuct'), P.fail('Ice detector', 'iceDet'));
  P.actions(P.push('RESET TO NORMAL', ctx.reset));
  P.note('In <b>Cruise</b> set <b>Icing conditions</b>: ICING lights — turn ENG ANTI-ICE on (TAI appears, stall warning goes to icing logic). Clear it: NO ICE. On the <b>Ground</b> try WING ANTI-ICE with the engines off, then with the duct hot.');
  return { update(res) { X.update(res); O.update(res); P.update(res); } };
}

export function panels(O, ctx) {
  const W = O.panel('Window heat', 112);
  W.text(150, 12, 'WINDOW HEAT', { size: 8.5 });
  ['L SIDE', 'L FWD', 'R FWD', 'R SIDE'].forEach((n, i) => {
    const x = 34 + i * 58 + (i > 1 ? 24 : 0), k = `wh${i + 1}`;
    W.lamp(x - 19, 20, 38, 13, 'OVERHEAT', `${k}ovht`);
    W.lamp(x - 19, 35, 38, 13, 'ON', `${k}on`, 'green');
    W.toggle(x, 78, k, ['ON', 'OFF'], { name: n, nameBox: false, labels: i % 2 ? 'right' : 'left' });
  });
  W.toggle(150, 70, 'test', ['OVHT', '', 'PWR TEST'], { horizontal: true, momentary: [0, 2], name: 'TEST' });
  const P = O.panel('Probe heat', 112);
  P.text(150, 12, 'PROBE HEAT', { size: 8.5 });
  PROBES.A.forEach(([k, n], j) => P.lamp(10 + (j % 2) * 46, 20 + Math.floor(j / 2) * 22, 42, 18, n, k));
  PROBES.B.forEach(([k, n], j) => P.lamp(202 + (j % 2) * 46, 20 + Math.floor(j / 2) * 22, 42, 18, n, k));
  P.toggle(120, 80, 'probeA', ['ON', 'AUTO'], { name: 'A', nameBox: false });
  P.toggle(180, 80, 'probeB', ['ON', 'AUTO'], { name: 'B', nameBox: false, labels: 'left' });
  P.push(150, 30, () => {}, { bottom: 'TAT TEST', name: 'TAT TEST' });
  const AI = O.panel('Wing and engine anti-ice', 118);
  AI.text(68, 10, 'WING ANTI-ICE', { size: 7.5 });
  AI.lamp(26, 16, 40, 16, 'L VALVE\nOPEN', 'wingOpenL', 'blue');
  AI.lamp(70, 16, 40, 16, 'R VALVE\nOPEN', 'wingOpenR', 'blue');
  AI.toggle(68, 72, 'wing', ['OFF', 'ON'], { name: 'WING ANTI-ICE' });
  AI.lamp(122, 92, 38, 14, 'ICE\nDETECTOR', 'iceDet');
  AI.text(220, 10, 'ENG ANTI-ICE', { size: 7.5 });
  AI.lamp(170, 16, 40, 14, 'COWL\nANTI-ICE', 'cowlAI1');
  AI.lamp(170, 32, 40, 14, 'COWL VALVE\nOPEN', 'cowlOpen1', 'blue');
  AI.lamp(240, 16, 40, 14, 'COWL\nANTI-ICE', 'cowlAI2');
  AI.lamp(240, 32, 40, 14, 'COWL VALVE\nOPEN', 'cowlOpen2', 'blue');
  AI.toggle(190, 80, 'eng1', ['OFF', 'ON'], { name: '1', nameBox: false });
  AI.toggle(260, 80, 'eng2', ['OFF', 'ON'], { name: '2', nameBox: false });
  const WP = O.panel('Wipers', 74);
  WP.knob(60, 38, 'wiperL', ['PARK', 'INT', 'LOW', 'HIGH'], [-60, -20, 20, 60], { name: 'L WIPER' });
  WP.knob(240, 38, 'wiperR', ['PARK', 'INT', 'LOW', 'HIGH'], [-60, -20, 20, 60], { name: 'R WIPER' });
  WP.text(150, 44, 'WINDSHIELD', { size: 8 });
  // Icing advisory lights (left forward panel), press to cancel.
  const IC = O.panel('Icing advisory', 40);
  IC.lamp(60, 10, 70, 20, 'ICING', 'icing');
  IC.lamp(170, 10, 70, 20, 'NO ICE', (r) => r.lights.noIce, 'blue');
}
