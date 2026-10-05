// schem-electrical.js — operable AC/DC/standby schematic + electrical panel.

import { createSchematic, createPanel } from './schem-kit.js?v=15';
import { createOverhead } from './overhead.js?v=15';

const AC = '#f5a300', DC = '#7048e8', STBY = '#e03131', BAT = '#2f9e44', APUC = '#e8590c', GPU = '#1c7ed6';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 660);
  X.onPart = ctx.onPart;
  const b = (k) => (r) => !!r.buses[k];

  // ── Sources ──
  X.unit(60, 30, 120, 44, 'GEN 1', (r) => r.units.idg1, { color: AC, part: 'idg1' });
  X.unit(330, 30, 120, 44, 'EXT PWR', (r) => r.units.gpu, { color: GPU, part: 'gpu' });
  X.unit(550, 30, 120, 44, 'APU GEN', (r) => r.units.apugen, { color: APUC, part: 'apugen' });
  X.unit(820, 30, 120, 44, 'GEN 2', (r) => r.units.idg2, { color: AC, part: 'idg2' });

  // GEN → own transfer bus through its breaker.
  X.wire([[120, 74], [120, 160]], (r) => r.flows.g1, { color: AC });
  X.wire([[880, 74], [880, 160]], (r) => r.flows.g2, { color: AC });
  X.valve(120, 112, (r) => r.flows.g1, { vertical: true, r: 9, label: 'GCB 1', lx: 34, ly: 4 });
  X.valve(880, 112, (r) => r.flows.g2, { vertical: true, r: 9, label: 'GCB 2', lx: -34, ly: 4 });
  // APU / EXT → tie bus → BTBs.
  X.wire([[390, 74], [390, 120]], (r) => r.flows.gpu, { color: GPU });
  X.wire([[610, 74], [610, 120]], (r) => r.flows.apu, { color: APUC });
  X.wire([[270, 120], [730, 120]], (r) => r.flows.apu || r.flows.gpu || r.buses.tie, { color: AC });
  X.text(500, 112, 'TIE BUS', 't-small t-dim', 'middle');
  const btb1 = (r) => r.buses.xfr1 && (r.flows.apu || r.flows.gpu || r.buses.tie) && !(r.flows.g1 && !r.buses.tie);
  const btb2 = (r) => r.buses.xfr2 && (r.flows.apu || r.flows.gpu || r.buses.tie) && !(r.flows.g2 && !r.buses.tie);
  X.wire([[270, 120], [270, 160]], btb1, { color: AC });
  X.wire([[730, 120], [730, 160]], btb2, { color: AC });
  X.valve(270, 140, btb1, { vertical: true, r: 9, label: 'BTB 1', lx: -32, ly: 4, part: 'btb' });
  X.valve(730, 140, btb2, { vertical: true, r: 9, label: 'BTB 2', lx: 32, ly: 4, part: 'btb' });

  // ── AC buses ──
  X.bus(40, 160, 360, 22, 'AC TRANSFER BUS 1', 'xfr1', { color: AC, part: 'xfr' });
  X.bus(600, 160, 360, 22, 'AC TRANSFER BUS 2', 'xfr2', { color: AC, part: 'xfr' });
  X.value(220, 200, (r) => ({ text: r.values.src1, cls: 't-small' + (r.buses.xfr1 ? '' : ' warn') }));
  X.value(780, 200, (r) => ({ text: r.values.src2, cls: 't-small' + (r.buses.xfr2 ? '' : ' warn') }));
  X.wire([[100, 182], [100, 220]], b('main1'), { color: AC });
  X.wire([[270, 182], [270, 220]], b('gal1'), { color: AC });
  X.wire([[730, 182], [730, 220]], b('gal2'), { color: AC });
  X.wire([[900, 182], [900, 220]], b('main2'), { color: AC });
  X.bus(40, 220, 130, 18, 'MAIN BUS 1', 'main1', { color: AC });
  X.bus(205, 220, 130, 18, 'GALLEY 1', 'gal1', { color: AC });
  X.bus(665, 220, 130, 18, 'GALLEY 2', 'gal2', { color: AC });
  X.bus(830, 220, 130, 18, 'MAIN BUS 2', 'main2', { color: AC });
  X.value(500, 214, (r) => ({ text: r.values.shed, cls: 't-small warn' }));

  // AC standby: from XFR 1 or the static inverter.
  X.wire([[380, 182], [380, 260], [430, 260]], (r) => r.buses.acStby && !r.values.onBattery, { color: STBY });
  X.bus(430, 250, 140, 22, 'AC STANDBY', 'acStby', { color: STBY, part: 'stbypwr' });

  // ── TRs ──
  X.wire([[160, 182], [160, 300]], b('tr1'), { color: AC });
  X.wire([[840, 182], [840, 300]], b('tr2'), { color: AC });
  X.wire([[640, 182], [640, 288], [530, 288], [530, 300]], (r) => r.buses.tr3 && r.buses.xfr2, { color: AC });
  X.wire([[350, 182], [350, 288], [470, 288], [470, 300]], (r) => r.buses.tr3 && !r.buses.xfr2, { color: AC });
  X.unit(110, 300, 100, 36, 'TR 1', (r) => (r.buses.tr1 ? 'on' : ctx.fail.tr1 ? 'fault' : 'off'), { color: DC, part: 'tr' });
  X.unit(450, 300, 100, 36, 'TR 3', (r) => (r.buses.tr3 ? 'on' : ctx.fail.tr3 ? 'fault' : 'off'), { color: DC, part: 'tr' });
  X.unit(790, 300, 100, 36, 'TR 2', (r) => (r.buses.tr2 ? 'on' : 'off'), { color: DC, part: 'tr' });

  // ── DC ──
  X.wire([[160, 336], [160, 380]], b('tr1'), { color: DC });
  X.wire([[840, 336], [840, 380]], b('tr2'), { color: DC });
  X.bus(40, 380, 260, 22, 'DC BUS 1', 'dc1', { color: DC });
  X.bus(700, 380, 260, 22, 'DC BUS 2', 'dc2', { color: DC });
  X.wire([[300, 391], [700, 391]], (r) => r.buses.dcTie && (r.buses.dc1 || r.buses.dc2), { color: DC });
  X.valve(400, 391, (r) => r.buses.dcTie, { r: 9, label: 'CROSS BUS TIE', ly: -14 });
  X.wire([[500, 391], [500, 430]], (r) => r.buses.dcStby && !r.values.onBattery, { color: DC });
  X.bus(430, 430, 140, 22, 'DC STANDBY', 'dcStby', { color: STBY, part: 'stbypwr' });
  // TR3 normally feeds the battery bus.
  X.wire([[450, 330], [330, 330], [330, 470], [160, 470], [160, 490]], (r) => r.buses.tr3 && r.buses.batBus, { color: DC });

  // ── Battery side: one straight feed per battery bus ──
  X.bus(60, 490, 200, 20, 'BATTERY BUS', 'batBus', { color: BAT, part: 'bat' });
  X.bus(60, 530, 200, 20, 'HOT BATTERY BUS', 'hotBat', { color: BAT, part: 'bat' });
  X.bus(60, 570, 200, 20, 'SW HOT BATTERY BUS', 'swHotBat', { color: BAT, part: 'bat' });
  X.wire([[260, 500], [400, 500]], (r) => r.values.onBattery && r.buses.batBus, { color: BAT });
  X.wire([[260, 540], [400, 540]], () => true, { color: BAT });
  X.wire([[260, 580], [400, 580]], b('swHotBat'), { color: BAT });
  X.unit(400, 486, 120, 110, 'BATTERY\n(+ AUX)', (r) => (r.values.onBattery ? 'fault' : 'on'), { color: BAT, part: 'bat' });
  X.wire([[460, 486], [460, 452]], (r) => r.values.onBattery && r.buses.dcStby, { color: BAT });
  X.unit(700, 520, 150, 46, 'STATIC\nINVERTER', (r) => (r.values.onBattery && r.buses.acStby ? 'on' : 'off'), { color: STBY, part: 'inv' });
  X.wire([[520, 543], [700, 543]], (r) => r.values.onBattery && r.buses.acStby, { color: BAT });
  X.wire([[775, 520], [775, 470], [620, 470], [620, 261], [570, 261]], (r) => r.values.onBattery && r.buses.acStby, { color: STBY });
  X.value(500, 640, (r) => (r.values.onBattery ? { text: 'STANDBY ON BATTERY — ≥30 min (≥60 min with aux battery)', cls: 't-small warn' } : ''));

  // ── Overhead panels (layout after FCOM 6.10) ──
  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);

  // ── Instructor station ──
  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('INSTRUCTOR · APU & FAILURES');
  P.actions(P.push('APU START / STOP', () => ctx.action('apuRun', '')));
  P.actions(P.fail('ENG 1 fail', 'eng1'), P.fail('ENG 2 fail', 'eng2'), P.fail('GEN 1 trip', 'gen1'),
    P.fail('APU fail', 'apu'), P.fail('TR 1 fail', 'tr1'), P.fail('TR 3 fail', 'tr3'));
  P.actions(P.push('GPU CONNECT / DISCONNECT', () => { const g = ctx.ctxOf('general'); g.set('gpuCart', g.sw.gpuCart ? 0 : 1); }), P.push('RESET TO NORMAL', ctx.reset));
  P.note('GEN, APU GEN and GRD PWR are spring-loaded: tap the top half for OFF, the bottom half for ON. Guarded switches: lift the guard first.');
  P.note('Try: Cruise → <b>GEN 1 trip</b> (BTBs close, GEN 2 powers both, galley/main 2 shed) → APU START → APU GEN ON. Or <b>ENG 1 + ENG 2 fail</b> to see standby on battery.');

  return { update(res) { X.update(res); O.update(res); P.update(res); } };
}

/** The overhead panels for this system — drawn in the schematic view and,
 *  as textures, in the 3D cockpit. */
export function panels(O, ctx) {
  const ac = (r) => r.buses.xfr1 || r.buses.xfr2;
  // Electrical (metering) panel.
  const E1 = O.panel('Electrical', 238);
  E1.band(0, 72);
  E1.text(90, 13, 'DC AMPS', { size: 7 }); E1.text(210, 13, 'CPS FREQ', { size: 7 });
  E1.lcd(55, 18, 70, (r) => (r.values.onBattery ? '-12' : '28'));
  E1.lcd(175, 18, 70, (r) => (ac(r) ? '400' : '0'));
  E1.lcd(25, 40, 70, (r) => String(r.values.batV));
  E1.lcd(115, 40, 70, (r) => (ac(r) ? '62' : '0'));
  E1.lcd(205, 40, 70, (r) => (ac(r) ? '115' : r.buses.acStby ? '115' : '0'));
  E1.text(150, 68, 'DC VOLTS  /  AC AMPS  /  AC VOLTS', { size: 6.5 });
  E1.lamp(60, 80, 44, 20, 'BAT\nDISCHARGE', 'batDischarge');
  E1.lamp(106, 80, 44, 20, 'TR\nUNIT', 'trUnit');
  E1.lamp(152, 80, 44, 20, 'ELEC', 'elec');
  E1.push(226, 90, null, { bottom: 'MAINT' });
  E1.knob(80, 140, 'dcSel', ['STBY PWR', 'BAT BUS', 'BAT', 'TR1', 'TR2', 'TR3', 'TEST'], [-120, -80, -40, 0, 40, 80, 120], { inert: true, inertPos: 2 });
  E1.knob(220, 140, 'acSel', ['STBY PWR', 'GRD PWR', 'GEN1', 'APU GEN', 'GEN2', 'INV', 'TEST'], [-120, -80, -40, 0, 40, 80, 120], { inert: true, inertPos: 2 });
  E1.toggle(70, 200, 'bat', ['OFF', 'ON'], { guard: 'black', guardPos: 1, name: 'BAT', labels: 'left' });
  E1.toggle(170, 200, 'cab', ['OFF', 'ON'], { inert: true, inertPos: 1 });
  E1.toggle(240, 200, 'ife', ['OFF', 'ON'], { inert: true, inertPos: 1 });
  E1.text(170, 234, 'CAB/UTIL', { size: 7 }); E1.text(240, 234, 'IFE/PASS', { size: 7 });

  // Generator drive and standby power.
  const E2 = O.panel('Generator drive and standby power', 150);
  E2.text(60, 14, '1', { size: 8 }); E2.text(240, 14, '2', { size: 8 });
  E2.lamp(40, 20, 40, 18, 'DRIVE', 'drive1');
  E2.lamp(126, 14, 48, 20, 'STANDBY\nPWR OFF', 'stbyOff');
  E2.lamp(220, 20, 40, 18, 'DRIVE', 'drive2');
  E2.text(60, 56, 'DISCONNECT', { size: 7.5 }); E2.text(240, 56, 'DISCONNECT', { size: 7.5 });
  E2.toggle(60, 98, 'disc1', ['', 'DISC'], { guard: 'red', guardPos: 0, momentary: [1] });
  E2.toggle(240, 98, 'disc2', ['', 'DISC'], { guard: 'red', guardPos: 0, momentary: [1] });
  E2.text(150, 50, 'STANDBY POWER', { size: 7.5 });
  E2.toggle(150, 96, 'stby', ['BAT', 'OFF', 'AUTO'], { horizontal: true, guard: 'black', guardPos: 2 });

  // Ground power and bus switching.
  const E3 = O.panel('Ground power and bus switching', 246);
  E3.band(0, 92);
  E3.lamp(124, 10, 52, 20, 'GRD POWER\nAVAILABLE', 'grdAvail', 'blue');
  E3.text(118, 52, 'GRD\nPWR', { size: 8.5, anchor: 'end' });
  E3.toggle(150, 62, 'grd', ['OFF', '·', 'ON'], { momentary: [0, 2], housing: true });
  E3.text(150, 104, 'BUS TRANSFER', { size: 8 });
  E3.toggle(150, 128, 'busXfer', ['OFF', 'AUTO'], { horizontal: true, guard: 'black', guardPos: 1 });
  for (const [x, n] of [[40, 1], [214, 2]]) {
    E3.lamp(x, 98, 46, 18, 'TRANSFER\nBUS OFF', 'xferOff' + n);
    E3.lamp(x, 118, 46, 18, 'SOURCE\nOFF', 'srcOff' + n);
    E3.lamp(x, 138, 46, 18, 'GEN OFF\nBUS', 'genOffBus' + n, 'blue');
  }
  E3.lamp(126, 150, 48, 18, 'APU GEN\nOFF BUS', 'apuGenOffBus', 'blue');
  E3.line([[63, 156], [63, 178]]); E3.line([[237, 156], [237, 178]]);
  E3.line([[150, 168], [150, 178], [118, 178]]); E3.line([[150, 178], [182, 178]]);
  E3.toggle(48, 200, 'gen1', ['OFF', '·', 'ON'], { momentary: [0, 2], labels: 'left' });
  E3.toggle(118, 200, 'apu1', ['OFF', '·', 'ON'], { momentary: [0, 2], labels: 'left' });
  E3.toggle(182, 200, 'apu2', ['OFF', '·', 'ON'], { momentary: [0, 2] });
  E3.toggle(252, 200, 'gen2', ['OFF', '·', 'ON'], { momentary: [0, 2] });
  E3.text(48, 238, 'GEN 1', { size: 8, box: true }); E3.text(150, 238, 'APU GEN', { size: 8, box: true }); E3.text(252, 238, 'GEN 2', { size: 8, box: true });
}
