// schem-engines.js — engine start / APU schematic, with the ENGINE START,
// APU and engine (EEC) panels and the start levers.

import { createSchematic, createPanel } from './schem-kit.js?v=11';
import { createOverhead } from './overhead.js?v=11';

const C = '#e63946', AIR = '#ff6a3d', FUELC = '#d6336c', IGN = '#f5a300', APUC = '#e8590c';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 640);
  X.onPart = ctx.onPart;

  // Air source → starters.
  X.unit(410, 24, 180, 44, 'APU', (r) => (r.values.apuState === 'running' ? 'on' : r.values.apuState === 'off' ? 'off' : 'fault'), { color: APUC, part: 'apu' });
  X.value(500, 86, (r) => ({ text: `APU ${r.values.apuState.toUpperCase()} · ${r.values.apuRpm}% · EGT ${r.values.apuEgt}°`, cls: 't-small' }));
  X.pipe([[500, 68], [500, 120], [120, 120], [120, 170]], (r) => r.values.apuState === 'running', { color: AIR, still: true });
  X.pipe([[500, 120], [880, 120], [880, 170]], (r) => r.values.apuState === 'running', { color: AIR, still: true });
  X.text(500, 112, 'BLEED DUCT', 't-small t-dim', 'middle');

  for (const [i, x] of [[0, 120], [1, 880]]) {
    const n = i + 1;
    X.valve(x, 190, (r) => r.values.e[i].startValve, { vertical: true, label: 'START VALVE', lx: i ? -60 : 60, ly: 4, part: 'start' });
    X.pipe([[x, 210], [x, 250]], `air${n}`, { color: AIR });
    X.unit(x - 60, 250, 120, 40, 'STARTER', (r) => (r.values.e[i].startValve ? 'on' : 'off'), { color: AIR, part: 'start', small: true });
    X.pipe([[x, 290], [x, 320]], `air${n}`, { color: AIR });
    // Engine box with N2 bar.
    X.unit(x - 90, 320, 180, 170, '', (r) => (r.values.e[i].run ? 'on' : r.values.e[i].lit ? 'fault' : 'off'), { color: C, part: 'core' });
    X.text(x, 342, `ENGINE ${n}`, 't-small', 'middle');
    const barX = x - 70, barW = 140;
    X.el('rect', { x: barX, y: 360, width: barW, height: 14, rx: 2, class: 'tank' }, X.svg);
    const bar = X.el('rect', { x: barX, y: 360, width: 0, height: 14, rx: 2, fill: C, opacity: 0.8 }, X.svg);
    for (const [v, lab] of [[25, 'IDLE↑'], [56, 'CUTOUT'], [59.5, '']]) {
      X.el('line', { x1: barX + (barW * v) / 100, y1: 356, x2: barX + (barW * v) / 100, y2: 378, stroke: '#fff', 'stroke-width': 1 }, X.svg);
      if (lab) X.text(barX + (barW * v) / 100, 390, lab, 't-small t-dim', 'middle');
    }
    X.value(x, 414, (r) => `N2 ${r.values.e[i].n2.toFixed(1)}%  ·  N1 ${r.values.e[i].n1.toFixed(1)}%`, 't-small', 'middle');
    X.value(x, 436, (r) => ({ text: `EGT ${Math.round(r.values.e[i].egt)}°C`, cls: 't-big' + (r.values.e[i].egt > 700 && !r.values.e[i].run ? ' warn' : '') }));
    X.value(x, 460, (r) => ({ text: r.values.e[i].engFail ? 'ENG FAIL' : r.values.e[i].startValve ? 'START VALVE OPEN' : r.values.e[i].run ? 'RUNNING' : r.values.e[i].lit ? 'LIGHT-OFF' : 'SHUT DOWN', cls: 't-small' + (r.values.e[i].engFail || r.values.e[i].startValve ? ' warn' : '') }));
    X.value(x, 480, (r) => (r.values.e[i].lowOil ? { text: 'LOW OIL PRESSURE', cls: 't-small warn' } : ''));
    // Fuel + ignition in from the side.
    X.pipe([[i ? 990 : 10, 560], [x + (i ? 40 : -40), 560], [x + (i ? 40 : -40), 490]], `fuel${n}`, { color: FUELC });
    X.text(i ? 990 : 10, 552, i ? 'FUEL (LEVER IDLE) ' : ' FUEL (LEVER IDLE)', 't-small t-dim', i ? 'end' : 'start');
    X.pipe([[x + (i ? -40 : 40), 600], [x + (i ? -40 : 40), 490]], `ign${n}`, { color: IGN, thin: true });
    X.text(x + (i ? -40 : 40), 618, 'IGNITION', 't-small t-dim', 'middle');
    X.value(x, 530, (r) => `START LEVER ${ctx.sw[`lever${n}`] ? 'IDLE' : 'CUTOFF'}`, 't-small', 'middle');
    // Keep the N2 bar in step.
    const upd = X.update;
    X.update = (res) => { upd(res); bar.setAttribute('width', (barW * Math.min(100, res.values.e[i].n2)) / 100); };
  }
  X.text(500, 600, 'Start: APU running · ENGINE START to GRD · at 25 % N2 start lever IDLE · cutout ~56 % · idle ~59 %', 't-small t-dim', 'middle');

  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);

  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('INSTRUCTOR · FAILURES');
  P.actions(P.fail('ENG 1 flameout', 'flameout1'), P.fail('ENG 2 flameout', 'flameout2'), P.fail('APU start fault', 'apuFault'));
  P.actions(P.push('RESET TO NORMAL', ctx.reset));
  P.note('Try an engine start: Ground phase (APU running) → ENGINE START 2 to <b>GRD</b> → wait for ~25 % N2 → start lever 2 <b>IDLE</b>. Watch the starter cut out and the switch spring back to AUTO. Started engines feed hydraulics, electrics and bleed in the other systems too.');

  return { update(res) { X.update(res); O.update(res); P.update(res); } };
}

/** ENGINE START, APU, engine (EEC) panels and the start levers. */
export function panels(O, ctx) {
  const S = O.panel('Engine start', 120);
  S.text(150, 16, 'ENGINE START', { size: 8.5 });
  S.knob(66, 62, 'start1', ['GRD', 'AUTO', 'CONT', 'FLT'], [-75, -25, 25, 75], { name: '1' });
  S.knob(234, 62, 'start2', ['GRD', 'AUTO', 'CONT', 'FLT'], [-75, -25, 25, 75], { name: '2' });
  S.toggle(150, 72, 'ign', ['IGN L', 'BOTH', 'IGN R'], { horizontal: true, name: 'IGNITION' });

  const A = O.panel('APU', 120);
  A.lamp(16, 14, 44, 18, 'MAINT', 'apuMaint', 'blue');
  A.lamp(16, 36, 44, 18, 'LOW OIL\nPRESSURE', 'apuLowOil');
  A.lamp(64, 14, 44, 18, 'FAULT', 'apuFault');
  A.lamp(64, 36, 44, 18, 'OVER\nSPEED', 'apuOverspeed');
  A.dial(176, 52, 30, {
    scales: [{ pts: [[0, -135], [10, 135]], ticks: [0, 2, 4, 6, 8, 10].map((v) => [v, 0.18, 1.2]), labels: [[0, '0'], [5, '5'], [10, '10']], lr: 0.6, lfs: 8 }],
    texts: [[0, 0.45, 'APU EGT', 5.5], [0, 0.62, '°C X 100', 4.6]], needles: [{ fn: (r) => r.values.apuEgt / 100, len: 0.8, w: 2 }],
  });
  A.knob(256, 58, 'apu', ['OFF', 'ON', 'START'], [-50, 0, 50], { name: 'APU', momentary: [2] });

  const E = O.panel('Engine panel', 104);
  E.text(150, 14, 'ENGINE', { size: 8.5 });
  for (const [i, x] of [[1, 80], [2, 220]]) {
    E.lamp(x - 44, 24, 40, 16, 'REVERSER', 'reverser');
    E.lamp(x + 4, 24, 40, 16, 'ENGINE\nCONTROL', 'engControl');
    E.toggle(x, 72, `eec${i}`, ['ALTN', 'ON'], { name: `EEC ${i}`, nameBox: false });
    E.lamp(x + 18, 64, 26, 14, 'ALTN', `eecAltn${i}`);
  }

  const L = O.panel('Start levers', 92);
  L.text(150, 14, 'ENGINE START LEVERS (PEDESTAL)', { size: 7.5 });
  L.toggle(110, 52, 'lever1', ['CUTOFF', 'IDLE'], { name: '1' });
  L.toggle(190, 52, 'lever2', ['CUTOFF', 'IDLE'], { name: '2', labels: 'left' });
}
