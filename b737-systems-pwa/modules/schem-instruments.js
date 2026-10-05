// schem-instruments.js — air data → ADIRUs → DEUs → six DUs, with the
// DISPLAYS source panel and both display select panels.

import { createSchematic, createPanel } from './schem-kit.js?v=16';
import { createOverhead } from './overhead.js?v=16';
import { DUS } from './sys-instruments.js?v=16';

const C = '#8338ec', AIRC = '#4dabf7', SB = '#fab005';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 640);
  X.onPart = ctx.onPart;
  // Probes → ADIRUs.
  X.unit(40, 30, 160, 40, 'CAPT PITOT/STATIC', (r) => (r.flows.airL ? 'on' : 'fault'), { color: AIRC, part: 'pitot', small: true });
  X.unit(800, 30, 160, 40, 'F/O PITOT/STATIC', () => 'on', { color: AIRC, part: 'pitot', small: true });
  X.unit(420, 30, 160, 40, 'AUX PITOT · ALT STATIC', () => 'on', { color: SB, part: 'standby', small: true });
  X.pipe([[120, 70], [120, 120]], 'airL', { color: AIRC });
  X.pipe([[880, 70], [880, 120]], 'airR', { color: AIRC });
  X.unit(60, 120, 120, 44, 'L ADIRU', () => 'on', { color: C, part: 'adiru' });
  X.unit(820, 120, 120, 44, 'R ADIRU', () => 'on', { color: C, part: 'adiru' });
  X.pipe([[500, 70], [500, 120]], 'stby', { color: SB, thin: true });
  X.unit(440, 120, 120, 44, 'ISFD', (r) => r.units.standby, { color: SB, part: 'standby' });
  X.value(500, 186, (r) => ({ text: r.values.stbyIas == null ? 'ISFD FAIL' : `${r.values.stbyIas} kt`, cls: 't-small' }));
  // ADIRUs → both DEUs.
  for (const [a, b] of [[120, 300], [120, 700], [880, 300], [880, 700]]) X.pipe([[a, 164], [a, 210], [b, 210], [b, 240]], () => true, { color: C, thin: true, still: true });
  X.unit(220, 240, 160, 44, 'DEU 1', (r) => (r.flows.deuL ? 'on' : 'fault'), { color: C, part: 'deu' });
  X.unit(620, 240, 160, 44, 'DEU 2', (r) => (r.flows.deuR ? 'on' : 'fault'), { color: C, part: 'deu' });
  X.value(500, 312, (r) => ({ text: r.values.srcAnn, cls: 't-big warn' }));
  // Six DUs with their current formats.
  DUS.forEach((k, i) => {
    const x = 20 + i * 162;
    X.pipe([[x + 70, 284 + 46], [x + 70, 380]], i < 3 ? 'deuL' : 'deuR', { color: C, thin: true });
    X.unit(x, 380, 140, 90, '', (r) => (r.values.du[k] === 'X' ? 'fault' : r.values.du[k] ? 'on' : 'off'), { color: C, part: 'dus' });
    X.value(x + 70, 404, (r) => ({ text: r.values.duName[k], cls: 't-small' }));
    X.value(x + 70, 446, (r) => ({ text: { X: 'FAILED', '': 'blank' }[r.values.du[k]] ?? r.values.du[k], cls: 't-big' + (r.values.du[k] === 'X' ? ' warn' : '') }));
  });
  X.value(170, 500, (r) => ({ text: `CAPT IAS ${r.values.capIas}`, cls: 't-big' + (r.values.capIas !== r.values.foIas ? ' warn' : '') }));
  X.value(830, 500, (r) => ({ text: `F/O IAS ${r.values.foIas}`, cls: 't-big' }));
  X.value(500, 540, (r) => ({ text: r.values.aoaDis ? 'AOA DISAGREE' : r.values.cpBoth, cls: 't-big warn' }));
  X.text(500, 610, 'DEU 1 → captain DUs + upper · DEU 2 → F/O DUs + lower · either can drive all six', 't-small t-dim', 'middle');

  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);
  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('INSTRUCTOR · FAILURES');
  P.actions(P.fail('Capt outboard DU', 'capOut'), P.fail('Capt inboard DU', 'capIn'), P.fail('Upper DU', 'upper'), P.fail('F/O outboard DU', 'foOut'),
    P.fail('DEU 1', 'deu1'), P.fail('DEU 2', 'deu2'), P.fail('Capt pitot blocked', 'capPitot'), P.fail('AOA vane', 'aoa'), P.fail('ISFD', 'isfd'));
  P.actions(P.push('RESET TO NORMAL', ctx.reset));
  P.note('Fail the <b>captain outboard DU</b>: the PFD jumps inboard. Fail the <b>upper DU</b>: engines go to the lower. In <b>Cruise</b> block the captain\'s pitot and compare the three airspeeds. Open the cockpit to see the screens change.');
  return { update(res) { X.update(res); O.update(res); P.update(res); } };
}

export function panels(O, ctx) {
  const D = O.panel('Displays', 64);
  D.text(150, 10, 'DISPLAYS', { size: 8 });
  D.knob(80, 38, 'source', ['1', 'AUTO', '2'], [-45, 0, 45], { name: 'SOURCE', r: 11, nameDy: 12 });
  D.knob(220, 38, 'cp', ['BOTH ON 1', 'NORMAL', 'BOTH ON 2'], [-50, 0, 50], { name: 'CONTROL PANEL', r: 11, nameDy: 12 });
  for (const [side, main, lower] of [['captain', 'capMain', 'capLower'], ['first officer', 'foMain', 'foLower']]) {
    const S = O.panel(`Display select (${side})`, 64);
    S.knob(90, 34, main, ['OUTBD PFD', 'NORM', 'ENG PRI', 'PFD', 'MFD'], [-80, -40, 0, 40, 80], { name: 'MAIN PANEL DUs', r: 10, nameDy: 14 });
    S.knob(220, 34, lower, ['ENG PRI', 'NORM', 'ND'], [-45, 0, 45], { name: 'LOWER DU', r: 10, nameDy: 14 });
  }
}
