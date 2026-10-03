// schem-fuel.js — operable fuel schematic + fuel panel replica.

import { createSchematic, createPanel } from './schem-kit.js?v=1';

const F = '#d6336c', CTR = '#9c36b5', SUC = '#fab005', APUC = '#e8590c';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 640);
  X.onPart = ctx.onPart;
  const Y = 210; // manifold

  // Engines and their two valves.
  for (const [n, x] of [[1, 150], [2, 850]]) {
    X.unit(x - 60, 20, 120, 46, `ENG ${n}`, (r) => (r.flows['e' + n] ? 'on' : r.env['eng' + n] ? 'fault' : 'off'), { color: F, part: n === 1 ? 'filter' : 'spar2' });
    X.pipe([[x, 66], [x, Y]], 'e' + n, { color: F });
    X.valve(x, 100, (r) => r.env['eng' + n], { vertical: true, label: 'ENG VALVE', lx: n === 1 ? 52 : -52, ly: 4, part: n === 1 ? 'spar1' : 'spar2' });
    X.valve(x, 150, (r) => r.env['eng' + n], { vertical: true, label: 'SPAR VALVE', lx: n === 1 ? 54 : -54, ly: 4, part: n === 1 ? 'spar1' : 'spar2' });
  }
  // Manifold halves + crossfeed.
  X.pipe([[150, Y], [488, Y]], 'man1', { color: F });
  X.pipe([[512, Y], [850, Y]], 'man2', { color: F });
  X.valve(500, Y, (r) => ctx.sw.xfeed === 1, { label: 'CROSSFEED', ly: -18, part: 'xfeed' });

  // Tanks.
  const qty = (k, low) => (r) => ({ text: `${r.values[k].toLocaleString()} kg`, cls: 't-big' + (low && low(r) ? ' warn' : '') });
  X.tank(40, 320, 300, 210, 'MAIN TANK 1', 'f1', { color: F, part: 'main1' });
  X.tank(370, 320, 260, 210, 'CENTER TANK', 'fc', { color: CTR, part: 'ctr' });
  X.tank(660, 320, 300, 210, 'MAIN TANK 2', 'f2', { color: F, part: 'main2' });
  X.value(190, 512, qty('m1', (r) => r.values.low1 || r.values.imbalLow === 1));
  X.value(500, 512, qty('c', (r) => r.values.config));
  X.value(810, 512, qty('m2', (r) => r.values.low2 || r.values.imbalLow === 2));
  X.value(190, 362, (r) => ({ text: [r.values.low1 && 'LOW', r.values.imbalLow === 1 && 'IMBAL'].filter(Boolean).join(' · '), cls: 'warn' }));
  X.value(810, 362, (r) => ({ text: [r.values.low2 && 'LOW', r.values.imbalLow === 2 && 'IMBAL'].filter(Boolean).join(' · '), cls: 'warn' }));
  X.value(500, 362, (r) => ({ text: r.values.config ? 'CONFIG' : '', cls: 'warn' }));

  // Pumps → manifold.
  const pump = (x, label, key, unitFn, color, part) => {
    X.pipe([[x, 300], [x, Y]], key, { color });
    X.unit(x - 32, 284, 64, 34, label, unitFn, { color, part, small: true });
  };
  const pState = (sw, light) => (r) => (ctx.sw[sw] ? (r.lights[light] ? 'fault' : 'on') : 'off');
  pump(110, 'AFT 1', 'm1', pState('m1aft', 'lp1aft'), F, 'pumps1');
  pump(240, 'FWD 1', 'm1', pState('m1fwd', 'lp1fwd'), F, 'pumps1');
  pump(440, 'CTR L', 'c1', pState('ctrL', 'lpCL'), CTR, 'pumpsC');
  pump(560, 'CTR R', 'c2', pState('ctrR', 'lpCR'), CTR, 'pumpsC');
  pump(760, 'FWD 2', 'm2', pState('m2fwd', 'lp2fwd'), F, 'pumps2');
  pump(890, 'AFT 2', 'm2', pState('m2aft', 'lp2aft'), F, 'pumps2');

  // Suction bypass (only lit when used).
  X.pipe([[60, 330], [60, 250], [150, 250], [150, 212]], 'suc1', { color: SUC, thin: true });
  X.pipe([[940, 330], [940, 250], [850, 250], [850, 212]], 'suc2', { color: SUC, thin: true });
  X.text(66, 270, 'SUCTION', 't-small t-dim');
  X.text(934, 270, 'SUCTION', 't-small t-dim', 'end');

  // APU feed from the left manifold.
  X.pipe([[150, Y], [30, Y], [30, 590], [70, 590]], 'apu', { color: APUC, thin: true });
  X.unit(70, 572, 110, 36, 'APU', (r) => (r.env.apu ? (r.flows.apu ? 'on' : 'fault') : 'off'), { color: APUC, part: 'apufeed' });
  // Scavenge jet pump: center → main 1.
  X.pipe([[420, 470], [300, 470]], 'scav', { color: CTR, thin: true });
  X.text(360, 462, 'SCAVENGE', 't-small t-dim', 'middle');

  // Totals.
  X.value(500, 40, (r) => ({ text: `TOTAL ${r.values.total.toLocaleString()} kg`, cls: 't-big' }));
  X.value(500, 62, (r) => `FUEL TEMP ${r.values.temp > 0 ? '+' : ''}${r.values.temp}°C`, 't-small t-dim');
  X.value(500, 84, (r) => (r.values.rate > 1 ? `TIME ×${r.values.rate}` : ''), 't-small warn');
  const src = { c: 'CENTER', m1: 'MAIN 1', m2: 'MAIN 2', mx: 'MAINS (XFEED)', s1: 'SUCTION 1', s2: 'SUCTION 2' };
  X.value(150, 88 + 98, (r) => (r.values.src1 ? `◂ ${src[r.values.src1]}` : ''), 't-small', 'middle');
  X.value(850, 88 + 98, (r) => (r.values.src2 ? `◂ ${src[r.values.src2]}` : ''), 't-small', 'middle');

  // ── Panel ──
  const P = createPanel(panelHost, ctx);
  P.title('FUEL');
  P.row(P.lamp('ENG VALVE\nCLOSED', 'engValve1', 'blue'), P.lamp('SPAR VALVE\nCLOSED', 'sparValve1', 'blue'),
    P.lamp('ENG VALVE\nCLOSED', 'engValve2', 'blue'), P.lamp('SPAR VALVE\nCLOSED', 'sparValve2', 'blue'));
  P.row(P.lamp('FILTER\nBYPASS', 'filter1'), P.lamp('VALVE\nOPEN', 'valveOpen', 'blue'), P.lamp('FILTER\nBYPASS', 'filter2'));
  P.row(P.rotary('CROSSFEED', 'xfeed', ['CLOSED', 'OPEN'], [0, 90]),
    P.readout((r) => `${r.values.temp > 0 ? '+' : ''}${r.values.temp}<small>°C</small>`, 'FUEL TEMP'));
  P.row(P.lamp('LOW\nPRESSURE', 'lpCL'), P.lamp('LOW\nPRESSURE', 'lpCR'));
  P.row(P.toggle('CTR L', 'ctrL', ['OFF', 'ON']), P.toggle('CTR R', 'ctrR', ['OFF', 'ON']));
  P.row(P.lamp('LOW\nPRESSURE', 'lp1aft'), P.lamp('LOW\nPRESSURE', 'lp1fwd'), P.lamp('LOW\nPRESSURE', 'lp2fwd'), P.lamp('LOW\nPRESSURE', 'lp2aft'));
  P.row(P.toggle('1 AFT', 'm1aft', ['OFF', 'ON']), P.toggle('1 FWD', 'm1fwd', ['OFF', 'ON']),
    P.toggle('2 FWD', 'm2fwd', ['OFF', 'ON']), P.toggle('2 AFT', 'm2aft', ['OFF', 'ON']));
  P.title('FUEL DISPLAY');
  P.row(P.readout((r) => `${r.values.m1}`, 'TANK 1'), P.readout((r) => `${r.values.c}`, 'CTR'), P.readout((r) => `${r.values.m2}`, 'TANK 2'));
  P.row(P.readout((r) => `${r.values.total}<small>kg</small>`, 'TOTAL'));
  P.title('SIMULATION');
  P.actions(
    P.push('TIME ×1 / ×120', () => ctx.action('rate')),
    P.push('+700 kg IN TANK 2', () => ctx.action('imbal')),
    P.push('EMPTY CENTER', () => ctx.action('emptyCtr')),
  );
  P.title('FAILURES');
  P.actions(P.fail('ENG 1 fuel leak', 'leak1'), P.fail('1 FWD pump', 'p1fwd'), P.fail('CTR L pump', 'ctrL'),
    P.fail('ENG 1 filter', 'filter1'), P.fail('ENG 1 fail', 'eng1'), P.fail('ENG 2 fail', 'eng2'));
  P.actions(P.push('RESET TO NORMAL', ctx.reset));
  P.note('Try: Cruise → <b>+700 kg in tank 2</b> → IMBAL. Fix it: CROSSFEED open, tank 1 pumps OFF, TIME ×120, and watch tank 2 feed both engines. Or switch both pumps of one tank OFF to see suction feed.');

  return {
    update(res) {
      res.values.f1 = Math.min(1, res.values.f1);
      res.values.f2 = Math.min(1, res.values.f2);
      X.update(res);
      P.update(res);
    },
  };
}
