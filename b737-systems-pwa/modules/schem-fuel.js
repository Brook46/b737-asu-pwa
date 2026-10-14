// schem-fuel.js — operable fuel schematic + fuel panel replica.

import { createSchematic, createPanel } from './schem-kit.js?v=61';
import { createOverhead } from './overhead.js?v=61';
import { fuelTemp } from './gauges.js?v=61';

const F = '#d6336c', CTR = '#9c36b5', SUC = '#c0eb75', APUC = '#e8590c';

// Tank and spar stations as on the 3D model (sys-fuel.js).
const FRONT = 0.16, REAR = 0.64, MAIN_IN = 3.5, MAIN_OUT = 15.4, PUMP_Z = 3.9;

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 640);
  X.onPart = ctx.onPart;
  // ── The airplane from above, nose up; tanks where they really are ──
  const A = X.plan(500, -150, 27.5);
  const W = A.W, pt = (q) => q.join(',');
  const poly = (pts) => 'M' + pts.map(pt).join(' L') + ' Z';
  const wingTankPts = (sd, z0, z1) => { const zs = []; for (let k = 0; k <= 6; k++) zs.push(z0 + ((z1 - z0) * k) / 6); return [...zs.map((z) => W(sd * z, FRONT)), ...zs.reverse().map((z) => W(sd * z, REAR))]; };
  const ctrPts = [W(-MAIN_IN, FRONT), W(-1.88, FRONT), W(1.88, FRONT), W(MAIN_IN, FRONT), W(MAIN_IN, REAR), W(1.88, REAR), W(-1.88, REAR), W(-MAIN_IN, REAR)];
  // Tanks sit on the airplane, under the lines, pumps and labels.
  const TG = X.el('g', {});
  A.g.after(TG);
  let cid = 0;
  // A tank outline with its fuel level rising from the rear spar.
  const tank = (pts, key, color, part) => {
    const id = `ft${++cid}${Math.random().toString(36).slice(2, 6)}`;
    const ys = pts.map((q) => q[1]), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const clip = X.el('clipPath', { id }, TG); X.el('path', { d: poly(pts) }, clip);
    const g = X.el('g', { class: 'hit' }, TG);
    X.el('path', { d: poly(pts), fill: '#161b21', stroke: '#5d6873', 'stroke-width': 1.2 }, g);
    const lvl = X.el('rect', { x: 0, y: y1, width: 1000, height: 0, fill: color, opacity: 0.55, 'clip-path': `url(#${id})` }, g);
    X.el('path', { d: poly(pts), fill: 'none', stroke: color, 'stroke-width': 1.6 }, g);
    if (part) g.addEventListener('click', () => X.onPart?.(part));
    if (key) X.bind((r) => { const k = Math.max(0, Math.min(1, r.values[key] ?? 0)), h = (y1 - y0) * k; lvl.setAttribute('y', y1 - h); lvl.setAttribute('height', h); });
  };
  tank(wingTankPts(-1, MAIN_IN, MAIN_OUT), 'f1', F, 'main1');
  tank(wingTankPts(1, MAIN_IN, MAIN_OUT), 'f2', F, 'main2');
  tank(ctrPts, 'fc', CTR, 'ctr');
  for (const sd of [-1, 1]) tank(wingTankPts(sd, MAIN_OUT + 0.15, 16.6), null, '#868e96', 'surge');
  const qty = (k, low) => (r) => ({ text: `${r.values[k].toLocaleString()} kg`, cls: 't-big halo' + (low && low(r) ? ' warn' : '') });
  const [m1x, m1y] = W(-9.5, 0.42), [m2x, m2y] = W(9.5, 0.42), [cx, cy] = W(0, 0.5);
  X.text(m1x, m1y - 16, 'MAIN TANK 1', 't-small halo', 'middle'); X.value(m1x, m1y + 2, qty('m1', (r) => r.values.low1 || r.values.imbalLow === 1));
  X.text(m2x, m2y - 16, 'MAIN TANK 2', 't-small halo', 'middle'); X.value(m2x, m2y + 2, qty('m2', (r) => r.values.low2 || r.values.imbalLow === 2));
  X.text(cx, cy + 34, 'CENTER TANK', 't-small halo', 'middle'); X.value(cx, cy + 52, qty('c', (r) => r.values.config));
  X.value(m1x, m1y + 20, (r) => ({ text: [r.values.low1 && 'LOW', r.values.imbalLow === 1 && 'IMBAL'].filter(Boolean).join(' · '), cls: 'warn halo' }));
  X.value(m2x, m2y + 20, (r) => ({ text: [r.values.low2 && 'LOW', r.values.imbalLow === 2 && 'IMBAL'].filter(Boolean).join(' · '), cls: 'warn halo' }));
  X.value(cx, cy + 70, (r) => ({ text: r.values.config ? 'CONFIG' : '', cls: 'warn halo' }));
  const [sgx, sgy] = W(16.1, 0.4); X.text(sgx + 22, sgy + 24, 'SURGE', 't-small t-dim', 'middle');

  // ── Engine feed: pumps → manifold along the front spar → spar valve → engine ──
  const MAN = FRONT + 0.03;
  const xf = W(0, MAN);
  for (const [n, sd] of [[1, -1], [2, 1]]) {
    const ez = 4.95;
    const spar = W(sd * ez, FRONT - 0.02), eng = A.P(6.6, sd * ez);
    X.pipe([xf, W(sd * 1.88, MAN), W(sd * PUMP_Z, MAN), W(sd * ez, MAN)].map(([x, y], k) => (k === 0 ? [x + sd * 12, y] : [x, y])), `man${n}`, { color: F });
    X.pipe([W(sd * ez, MAN), spar, eng], 'e' + n, { color: F });
    X.valve(spar[0], spar[1] - 4, (r) => r.env['eng' + n], { vertical: true, r: 8, label: 'SPAR VALVE', lx: sd * 50, ly: 4, part: n === 1 ? 'spar1' : 'spar2' });
    X.valve(eng[0], eng[1] + 26, (r) => r.env['eng' + n], { vertical: true, r: 8, label: 'ENG VALVE', lx: sd * 48, ly: 4, part: n === 1 ? 'spar1' : 'spar2' });
    if (n === 1) { const [lx, ly] = W(-ez, 0.0); X.leak(lx - 4, (ly + eng[1]) / 2 + 30, () => ctx.fail.leak1, 'LEAK · engine 1 fuel line (strut)', 'end'); }
    X.unit(eng[0] - 30, eng[1] - 16, 60, 22, `ENG ${n}`, (r) => (r.flows['e' + n] ? 'on' : r.env['eng' + n] ? 'fault' : 'off'), { color: F, part: n === 1 ? 'filter' : 'spar2', small: true });
    // Main tank pumps (fwd at the front spar, aft at the rear spar) and their line to the manifold.
    const fwd = W(sd * PUMP_Z, FRONT + 0.08), aft = W(sd * PUMP_Z, REAR - 0.08);
    X.pipe([aft, fwd, W(sd * PUMP_Z, MAN)], `m${n}`, { color: F });
    const pState = (sw, light) => (r) => (ctx.sw[sw] ? (r.lights[light] ? 'fault' : 'on') : 'off');
    X.unit(fwd[0] - 20, fwd[1] - 8, 40, 16, 'FWD', pState(`m${n}fwd`, `lp${n}fwd`), { color: F, part: `pumps${n}`, small: true });
    X.unit(aft[0] - 20, aft[1] - 8, 40, 16, 'AFT', pState(`m${n}aft`, `lp${n}aft`), { color: F, part: `pumps${n}`, small: true });
    // Center tank pumps (each side of the body) into the manifold.
    const cp = W(sd * 2.6, REAR - 0.1);
    X.pipe([cp, W(sd * 2.6, MAN)], `c${n}`, { color: CTR });
    X.unit(cp[0] - 22, cp[1] - 8, 44, 16, sd < 0 ? 'CTR L' : 'CTR R', pState(sd < 0 ? 'ctrL' : 'ctrR', sd < 0 ? 'lpCL' : 'lpCR'), { color: CTR, part: 'pumpsC', small: true });
    // Suction feed: engine-driven pump draws straight from the main tank when its pumps can't feed.
    X.pipe([W(sd * 5.6, REAR - 0.12), W(sd * 5.6, FRONT + 0.05), W(sd * ez, FRONT - 0.01)], `suc${n}`, { color: SUC, thin: true });
  }
  X.valve(xf[0], xf[1], (r) => ctx.sw.xfeed === 1, { r: 9, label: 'CROSSFEED', ly: -14, part: 'xfeed' });
  const [s1x, s1y] = W(-5.6, 0.4); X.text(s1x, s1y + 2, 'SUCTION', 't-small t-dim halo', 'middle');
  // Scavenge jet pump: the last of the center fuel into main tank 1.
  X.pipe([W(-2.2, 0.5), W(-MAIN_IN - 1.2, 0.5)], 'scav', { color: CTR, thin: true });
  // APU feed: from the left manifold aft along the body to the tail.
  const ap = W(-1.88, MAN);
  X.pipe([ap, [ap[0] + 14, ap[1] + 30], [486, 610], [486, 640]], 'apu', { color: APUC, thin: true });
  X.unit(380, 596, 96, 26, 'APU (tail) ↓', (r) => (r.env.apu ? (r.flows.apu ? 'on' : 'fault') : 'off'), { color: APUC, part: 'apufeed', small: true });

  // Totals and what each engine is drawing from.
  X.value(24, 34, (r) => ({ text: `TOTAL ${r.values.total.toLocaleString()} kg`, cls: 't-big' }), 't-big', 'start');
  X.value(24, 54, (r) => `FUEL TEMP ${r.values.temp > 0 ? '+' : ''}${r.values.temp}°C`, 't-small t-dim', 'start');
  X.value(24, 72, (r) => (r.values.rate > 1 ? `TIME ×${r.values.rate}` : ''), 't-small warn', 'start');
  const src = { c: 'CENTER', m1: 'MAIN 1', m2: 'MAIN 2', mx: 'MAINS (XFEED)', s1: 'SUCTION 1', s2: 'SUCTION 2' };
  X.value(24, 100, (r) => (r.values.src1 ? `ENG 1 ◂ ${src[r.values.src1]}` : ''), 't-small', 'start');
  X.value(976, 100, (r) => (r.values.src2 ? `${src[r.values.src2]} ▸ ENG 2` : ''), 't-small', 'end');
  X.text(976, 34, 'Seen from above, nose up', 't-small t-dim', 'end');
  X.text(976, 50, 'tanks between the front and rear spars', 't-small t-dim', 'end');

  // ── Fuel control panel (layout after FCOM 12.10.1) ──
  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);

  // ── Instructor station ──
  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('UPPER DU · FUEL');
  P.row(P.readout((r) => `${r.values.m1}`, 'TANK 1'), P.readout((r) => `${r.values.c}`, 'CTR'), P.readout((r) => `${r.values.m2}`, 'TANK 2'));
  P.row(P.readout((r) => `${r.values.total}<small>kg</small>`, 'TOTAL'));
  P.title('INSTRUCTOR · SIMULATION');
  P.actions(
    P.push('TIME ×1 / ×120', () => ctx.action('rate')),
    P.push('+700 kg IN TANK 2', () => ctx.action('imbal')),
    P.push('EMPTY CENTER', () => ctx.action('emptyCtr')),
  );
  P.title('INSTRUCTOR · FAILURES');
  P.actions(P.fail('ENG 1 fuel leak', 'leak1'), P.fail('1 FWD pump', 'p1fwd'), P.fail('CTR L pump', 'ctrL'),
    P.fail('ENG 1 filter', 'filter1'), P.fail('ENG 1 failure', 'flameout1', 'engines'), P.fail('ENG 2 failure', 'flameout2', 'engines'));
  P.actions(P.push('RESET TO NORMAL', ctx.reset));
  P.note('CROSSFEED knob: tap its right half to open, left half to close. Try: Cruise → <b>+700 kg in tank 2</b> → IMBAL; crossfeed open, tank 1 pumps OFF, TIME ×120.');

  return {
    update(res) {
      res.values.f1 = Math.min(1, res.values.f1);
      res.values.f2 = Math.min(1, res.values.f2);
      X.update(res);
      O.update(res);
      P.update(res);
    },
  };
}

/** The overhead panels for this system — drawn in the schematic view and,
 *  as textures, in the 3D cockpit. */
export function panels(O, ctx) {
  const F2 = O.panel('Fuel', 372);
  F2.band(0, 118);
  F2.lamp(18, 16, 56, 20, 'ENG VALVE\nCLOSED', 'engValve1', 'blue');
  F2.lamp(18, 38, 56, 20, 'SPAR VALVE\nCLOSED', 'sparValve1', 'blue');
  F2.lamp(226, 16, 56, 20, 'ENG VALVE\nCLOSED', 'engValve2', 'blue');
  F2.lamp(226, 38, 56, 20, 'SPAR VALVE\nCLOSED', 'sparValve2', 'blue');
  fuelTemp(F2, 150, 54, 38, (r) => r.values.temp);
  F2.lamp(30, 100, 46, 20, 'FILTER\nBYPASS', 'filter1');
  F2.lamp(126, 100, 48, 20, 'VALVE\nOPEN', 'valveOpen', 'blue');
  F2.lamp(224, 100, 46, 20, 'FILTER\nBYPASS', 'filter2');
  // Mimic lines: engine feeds down the sides, crossfeed across the middle.
  F2.line([[53, 122], [53, 160], [118, 160]]);
  F2.line([[247, 122], [247, 160], [182, 160]]);
  F2.line([[53, 160], [53, 290]]);
  F2.line([[247, 160], [247, 290]]);
  F2.line([[132, 186], [132, 200]]);
  F2.line([[168, 186], [168, 200]]);
  F2.text(100, 151, 'CROSS', { size: 8.5, box: true });
  F2.text(200, 151, 'FEED', { size: 8.5, box: true });
  F2.knob(150, 160, 'xfeed', ['', ''], [0, 90], { r: 22, bar: true, noLabels: true });
  F2.lamp(116, 200, 34, 20, 'LOW\nPRESSURE', 'lpCL');
  F2.lamp(150, 200, 34, 20, 'LOW\nPRESSURE', 'lpCR');
  F2.text(150, 234, 'FUEL PUMPS', { size: 8.5, box: true });
  F2.toggle(127, 262, 'ctrL', ['OFF', 'ON'], { labels: 'left' });
  F2.toggle(173, 262, 'ctrR', ['OFF', 'ON'] );
  F2.text(103, 266, 'L', { size: 8.5, box: true }); F2.text(197, 266, 'R', { size: 8.5, box: true });
  F2.text(150, 300, 'CTR', { size: 8.5, box: true });
  F2.lamp(22, 282, 34, 20, 'LOW\nPRESSURE', 'lp1aft');
  F2.lamp(57, 282, 34, 20, 'LOW\nPRESSURE', 'lp1fwd');
  F2.lamp(209, 282, 34, 20, 'LOW\nPRESSURE', 'lp2fwd');
  F2.lamp(244, 282, 34, 20, 'LOW\nPRESSURE', 'lp2aft');
  F2.toggle(39, 334, 'm1aft', ['OFF', 'ON'], { labels: 'left' });
  F2.toggle(74, 334, 'm1fwd', ['OFF', 'ON']);
  F2.toggle(226, 334, 'm2fwd', ['OFF', 'ON'], { labels: 'left' });
  F2.toggle(261, 334, 'm2aft', ['OFF', 'ON']);
  F2.text(39, 312, 'AFT', { size: 7.5, box: true }); F2.text(74, 312, 'FWD', { size: 7.5, box: true });
  F2.text(226, 312, 'FWD', { size: 7.5, box: true }); F2.text(261, 312, 'AFT', { size: 7.5, box: true });
  F2.text(57, 364, '1', { size: 9, box: true }); F2.text(243, 364, '2', { size: 9, box: true });
  F2.text(150, 344, 'FUEL\nPUMPS', { size: 8.5, box: true });
}
