// schem-engines.js — engine start / APU schematic, with the ENGINE START,
// APU and engine (EEC) panels and the start levers.

import { createSchematic, createPanel } from './schem-kit.js?v=58';
import { createOverhead } from './overhead.js?v=58';

const C = '#e63946', AIR = '#ff6a3d', FUELC = '#d6336c', IGN = '#ffec99', APUC = '#e8590c';

const N1C = '#4dabf7', N2C = '#ff922b', HOT = '#ff6b6b', BYP = '#a5d8ff', ELEC = '#ffd43b', HYD = '#69db7c', OIL = '#e599f7';
const DEG = Math.PI / 180;

/**
 * A DU-style round dial as drawn in FCOM 7.11: zero at 3 o'clock, scale
 * clockwise round to ~11 o'clock, grey sweep, white pointer, the readout
 * boxed in the empty top-right quarter, red (and amber) limit radials.
 */
function duDial(X, cx, cy, r, fracOf, textOf, o = {}) {
  const g = X.el('g', {}, X.svg);
  const pt = (f, rr = r) => [cx + rr * Math.cos(f * 225 * DEG), cy + rr * Math.sin(f * 225 * DEG)];
  const arcD = (f0, f1, rr) => { const [a, b] = pt(f0, rr), [c, d] = pt(f1, rr); return `M${a} ${b} A${rr} ${rr} 0 ${(f1 - f0) * 225 > 180 ? 1 : 0} 1 ${c} ${d}`; };
  const sweep = X.el('path', { fill: '#8a8a8a' }, g);
  X.el('path', { d: arcD(0, o.red ?? 1, r), fill: 'none', stroke: '#f4f4f4', 'stroke-width': 1.6 }, g);
  for (const [f, lab] of o.ticks || []) {
    const [a1, b1] = pt(f), [a2, b2] = pt(f, r - 5), [tx, ty] = pt(f, r - 12);
    X.el('line', { x1: a1, y1: b1, x2: a2, y2: b2, stroke: '#f4f4f4', 'stroke-width': 1.3 }, g);
    const t = X.el('text', { x: tx, y: ty + 3, 'text-anchor': 'middle', style: 'font-size:8px;fill:#f4f4f4' }, g); t.textContent = lab;
  }
  for (const [f, c] of [[o.amber, '#ffb21e'], [o.red, '#ff3b30']]) if (f != null) { const [a1, b1] = pt(f, r - 2), [a2, b2] = pt(f, r + 7); X.el('line', { x1: a1, y1: b1, x2: a2, y2: b2, stroke: c, 'stroke-width': 3 }, g); }
  const needle = X.el('line', { x1: cx, y1: cy, stroke: '#f4f4f4', 'stroke-width': 2.4 }, g);
  const box = X.el('rect', { x: cx + 2, y: cy - 22, width: r + 6, height: 18, fill: '#000', stroke: '#f4f4f4', 'stroke-width': 1.2 }, g);
  const val = X.el('text', { x: cx + r + 5, y: cy - 8, 'text-anchor': 'end', style: 'font-size:14px;fill:#f4f4f4;letter-spacing:0' }, g);
  X.bind((res) => {
    const f = Math.max(0, Math.min(1.12, fracOf(res))), over = o.red != null && f > o.red;
    const [x, y] = pt(f, r - 1), [x0, y0] = pt(0, r - 1);
    sweep.setAttribute('d', f > 0.004 ? `M${cx} ${cy} L${x0} ${y0} A${r - 1} ${r - 1} 0 ${f * 225 > 180 ? 1 : 0} 1 ${x} ${y} Z` : '');
    sweep.setAttribute('fill', over ? '#d62a1e' : '#8a8a8a');
    needle.setAttribute('x2', x); needle.setAttribute('y2', y); needle.setAttribute('stroke', over ? '#ff3b30' : '#f4f4f4');
    box.setAttribute('fill', over ? '#ff3b30' : '#000');
    val.textContent = textOf(res);
  });
}

/** A side-view nacelle (inlet left), lit by state; returns its group. */
function nacelle(X, x0, y0, w, h, stateOf, o = {}) {
  const g = X.el('g', {}, X.svg);
  const P = (fx, fy) => `${x0 + fx * w},${y0 + fy * h}`;
  const d = `M${P(0.02, 0.18)} Q${P(0, 0.02)} ${P(0.09, 0)} L${P(0.6, 0.05)} L${P(0.64, 0.2)} L${P(0.84, 0.3)} L${P(0.9, 0.38)} L${P(1, 0.5)} `
    + `L${P(0.9, 0.62)} L${P(0.84, 0.7)} L${P(0.64, 0.8)} L${P(0.6, 0.95)} L${P(0.09, 1)} Q${P(0, 0.98)} ${P(0.02, 0.82)} Z`;
  const body = X.el('path', { d, class: 'unit' }, g);
  body.style.setProperty('--flow', N2C);
  X.el('path', { d: `M${P(0.04, 0.16)} L${P(0.04, 0.84)}`, stroke: '#8d99a6', 'stroke-width': 2 }, g);                   // fan face
  X.el('path', { d: `M${P(0.6, 0.05)} L${P(0.6, 0.95)}`, stroke: '#56606b', 'stroke-width': 1, 'stroke-dasharray': '3 3' }, g);   // fan nozzle
  const core = X.el('path', { d: `M${P(0.2, 0.42)} L${P(0.84, 0.44)} L${P(0.84, 0.56)} L${P(0.2, 0.58)} Z`, fill: '#2b3138' }, g);
  X.el('path', { d: `M${P(0.15, 1)} L${P(0.15, 1.08)} L${P(0.42, 1.08)} L${P(0.42, 1)}`, fill: '#20262d', stroke: '#56606b' }, g);          // gearbox
  X.bind((res) => {
    const st = stateOf(res);
    body.classList.toggle('on', st === 'on');
    body.classList.toggle('fault', st === 'fault');
    core.setAttribute('fill', st === 'off' ? '#2b3138' : st === 'fault' ? '#a35a10' : '#c4511a');
  });
  if (o.part) { g.classList.add('hit'); g.addEventListener('click', () => X.onPart?.(o.part)); }
  return g;
}

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
    X.pipe([[x, 290], [x, 330]], `air${n}`, { color: AIR });
    // The engine itself, side on.
    nacelle(X, x - 100, 330, 200, 100, (r) => (r.values.e[i].run ? 'on' : r.values.e[i].lit ? 'fault' : 'off'), { part: 'core' });
    X.text(x - 70, 324, `ENGINE ${n}`, 't-small', 'middle');
    const sx = x + (i ? -52 : 52), sa = i ? 'end' : 'start';     // status beside the fuel / ignition lines
    X.value(sx, 462, (r) => ({ text: r.values.e[i].engFail ? 'ENG FAIL' : r.values.e[i].startValve ? 'STARTER ENGAGED' : r.values.e[i].run ? 'RUNNING' : r.values.e[i].lit ? 'LIGHT-OFF' : 'SHUT DOWN', cls: 't-small' + (r.values.e[i].engFail ? ' warn' : '') }), 't-small', sa);
    X.value(sx, 480, (r) => `START LEVER ${ctx.sw[`lever${n}`] ? 'IDLE' : 'CUTOFF'}`, 't-small t-dim', sa);
    // Fuel + ignition in from below.
    X.pipe([[i ? 990 : 10, 540], [x + (i ? 40 : -40), 540], [x + (i ? 40 : -40), 440]], `fuel${n}`, { color: FUELC });
    X.text(i ? 990 : 10, 532, i ? 'FUEL (LEVER IDLE) ' : ' FUEL (LEVER IDLE)', 't-small t-dim', i ? 'end' : 'start');
    X.pipe([[x + (i ? -40 : 40), 580], [x + (i ? -40 : 40), 440]], `ign${n}`, { color: IGN, thin: true });
    X.text(x + (i ? -40 : 40), 596, 'IGNITION', 't-small t-dim', 'middle');
  }

  // ── Engine display, as on the upper DU (N1 over EGT) and the lower DU (N2) ──
  X.el('rect', { x: 318, y: 150, width: 364, height: 452, rx: 8, fill: '#000', stroke: '#3a4149', 'stroke-width': 2 }, X.svg);
  const N1T = [0, 2, 4, 6, 8, 10].map((v) => [(v * 10) / 112, String(v)]);
  const egtF = (t) => (t / 950) * (232 / 225);
  for (const [i, cx] of [[0, 410], [1, 572]]) {
    duDial(X, cx, 236, 46, (r) => r.values.e[i].n1 / 112, (r) => r.values.e[i].n1.toFixed(1), { ticks: N1T, red: 104 / 112 });
    duDial(X, cx, 370, 40, (r) => egtF(r.values.e[i].egt), (r) => String(Math.round(r.values.e[i].egt)), { amber: egtF(925), red: egtF(950) });
    duDial(X, cx, 500, 34, (r) => r.values.e[i].n2 / 112, (r) => r.values.e[i].n2.toFixed(1), { red: 105 / 112 });
    X.value(cx + 4, 296, (r) => (r.values.e[i].engFail ? { text: 'ENG FAIL', cls: 't-small warn' } : ''), 't-small', 'middle');
    X.value(cx + 10, 584, (r) => (r.values.e[i].startValve ? { text: 'START VALVE OPEN', cls: 't-small warn' } : r.values.e[i].lowOil && r.values.e[i].n2 > 1 ? { text: 'LOW OIL PRESSURE', cls: 't-small warn' } : ''), 't-small', 'middle');
  }
  for (const [y, lab] of [[262, 'N1'], [392, 'EGT'], [520, 'N2']]) X.el('text', { x: 491, y, 'text-anchor': 'middle', style: 'font-size:12px;fill:#28e3f2' }, X.svg).textContent = lab;
  X.el('line', { x1: 330, y1: 448, x2: 670, y2: 448, stroke: '#3a4149', 'stroke-dasharray': '4 4' }, X.svg);
  X.text(500, 170, 'UPPER DU', 't-small t-dim', 'middle');
  X.text(500, 462, 'LOWER DU', 't-small t-dim', 'middle');

  const side = engineSide(X, ctx, svgHost);
  X.text(500, 626, 'Start: APU running · ENGINE START to GRD · at 25 % N2 start lever IDLE · cutout ~56 % · idle ~59 %', 't-small t-dim', 'middle');

  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);

  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('INSTRUCTOR · FAILURES');
  P.actions(P.fail('ENG 1 failure', 'flameout1'), P.fail('ENG 2 failure', 'flameout2'), P.fail('APU start fault', 'apuFault'));
  P.actions(P.push('RESET TO NORMAL', ctx.reset));
  P.note('Try an engine start: Ground phase (APU running) → ENGINE START 2 to <b>GRD</b> → wait for ~25 % N2 → start lever 2 <b>IDLE</b>. Watch the starter cut out and the switch spring back to AUTO. Started engines feed hydraulics, electrics and bleed in the other systems too.');

  return { update(res) { X.update(res); side.update(res); O.update(res); P.update(res); } };
}

/**
 * The engine cut away, side on (after the FCOM 7.20.7 power plant schematic,
 * our own drawing): the N1 spool (fan, booster, low-pressure turbine) in blue,
 * the N2 spool (high-pressure compressor and turbine) in orange, 5th and 9th
 * stage bleed off the compressor, fan air, fuel and igniters at the
 * combustor, and the gearbox under the fan case that N2 drives — starter,
 * IDG, hydraulic pump, fuel and oil pumps. Spools turn at their own speed and
 * the air moves with N1; tap ENGINE 1 / 2 to switch.
 */
function engineSide(X, ctx, host) {
  // Its own drawing under the schematic; the schematic area scrolls to it.
  const svg = X.el('svg', { viewBox: '0 610 1000 560', class: 'sx', preserveAspectRatio: 'xMidYMid meet' });
  host.append(svg);
  host.classList.add('schem-tall');
  const Y0 = 650, AX = 880;                 // top of the section, engine axis
  const el = (t, a, p = svg) => X.el(t, a, p);
  const txt = (x, y, s, o = {}) => { const t = el('text', { x, y, 'text-anchor': o.a || 'middle', style: `font-size:${o.size || 10}px;fill:${o.fill || 'var(--schem-ink)'}` }); t.textContent = s; return t; };
  txt(30, Y0 + 14, 'INSIDE THE CFM56-7 — SIDE VIEW', { a: 'start', size: 11 });
  let eng = 0;
  const tabs = [0, 1].map((i) => {
    const g = el('g', { class: 'hit' });
    const r = el('rect', { x: 700 + i * 140, y: Y0, width: 130, height: 24, rx: 4 }, g);
    const t = el('text', { x: 765 + i * 140, y: Y0 + 16, 'text-anchor': 'middle', style: 'font-size:11px' }, g); t.textContent = `ENGINE ${i + 1}`;
    g.addEventListener('click', () => { eng = i; paintTabs(); if (last) update(last); });
    return { r, t };
  });
  const paintTabs = () => tabs.forEach(({ r, t }, i) => { r.setAttribute('fill', i === eng ? '#e9ecef' : '#20262d'); r.setAttribute('stroke', '#56606b'); t.style.fill = i === eng ? '#111' : 'var(--schem-ink)'; });
  paintTabs();

  // Shells: nacelle (outer), fan duct inner wall / core cowl, exhaust plug.
  const r = (fy) => AX + fy;                 // y from the axis
  el('path', { d: `M110 ${r(-150)} Q90 ${r(-150)} 92 ${r(-120)} L92 ${r(120)} Q90 ${r(150)} 110 ${r(150)} L560 ${r(140)} L560 ${r(-140)} Z`, fill: '#151a1f', stroke: '#56606b', 'stroke-width': 2 });
  el('path', { d: `M300 ${r(-78)} L560 ${r(-92)} L700 ${r(-60)} L780 ${r(-34)} L780 ${r(34)} L700 ${r(60)} L560 ${r(92)} L300 ${r(78)} Z`, fill: '#1b2026', stroke: '#56606b', 'stroke-width': 1.5 });
  el('path', { d: `M700 ${r(-30)} L800 ${r(0)} L700 ${r(30)} Z`, fill: '#2b3138', stroke: '#56606b' });
  // Thrust reverser (translating sleeve, rear of the fan cowl).
  el('rect', { x: 470, y: r(-150), width: 90, height: 12, fill: '#2b3138', stroke: '#56606b' });
  el('rect', { x: 470, y: r(138), width: 90, height: 12, fill: '#2b3138', stroke: '#56606b' });
  txt(515, r(-158), 'THRUST REVERSER', { size: 9, fill: 'var(--schem-dim)' });

  // Gas paths: bypass (fan air) round the core, core flow through it.
  const flows = [];
  const flow = (d, color, w, speedOf) => { const p = el('path', { d, fill: 'none', stroke: color, 'stroke-width': w, 'stroke-dasharray': '10 12', 'stroke-linecap': 'round', opacity: 0.85 }); flows.push({ p, speedOf, off: 0 }); return p; };
  for (const s of [-1, 1]) {
    flow(`M40 ${r(s * 110)} L560 ${r(s * 112)} L760 ${r(s * 112)}`, BYP, 4, (v) => v.n1);
    flow(`M40 ${r(s * 40)} L230 ${r(s * 40)} L300 ${r(s * 52)} L470 ${r(s * 32)}`, '#dee2e6', 3, (v) => v.n1);
    flow(`M470 ${r(s * 32)} L560 ${r(s * 40)} L700 ${r(s * 22)} L860 ${r(s * 10)}`, HOT, 3, (v) => v.n1 * (v.lit ? 1 : 0.4));
  }

  // Rotors: blade bands with moving stripes (spin speed from N1 / N2).
  const rotors = [];
  const rotor = (x, w, half, color, spool, label) => {
    const id = `rot${Math.random().toString(36).slice(2, 7)}`;
    const clip = el('clipPath', { id }); el('rect', { x, y: r(-half), width: w, height: half * 2 }, clip);
    el('rect', { x, y: r(-half), width: w, height: half * 2, fill: color, opacity: 0.35 });
    const g = el('g', { 'clip-path': `url(#${id})` });
    for (let k = -half * 2; k < half * 2 + 20; k += 10) el('rect', { x, y: r(k - half), width: w, height: 4, fill: color }, g);
    rotors.push({ g, spool, off: 0, half });
    if (label) txt(x + w / 2, r(-half - 8), label, { size: 9, fill: color });
  };
  rotor(150, 18, 140, N1C, 'n1', '');
  txt(159, r(164), 'FAN', { size: 9, fill: N1C });
  for (let k = 0; k < 3; k++) rotor(230 + k * 18, 8, 58, N1C, 'n1', k === 1 ? 'BOOSTER' : '');
  for (let k = 0; k < 9; k++) rotor(312 + k * 17, 8, 62 - k * 3.4, N2C, 'n2', k === 4 ? 'HP COMPRESSOR (9 stages)' : '');
  rotor(560, 12, 46, N2C, 'n2', '');
  for (let k = 0; k < 4; k++) rotor(590 + k * 20, 10, 50 + k * 3, N1C, 'n1', k === 1 ? 'LP TURBINE' : '');
  txt(566, r(62), 'HP TURBINE', { size: 9, fill: N2C });
  // Spinner, shafts.
  el('path', { d: `M100 ${r(0)} Q120 ${r(-34)} 150 ${r(-36)} L150 ${r(36)} Q120 ${r(34)} 100 ${r(0)} Z`, fill: '#3a4149', stroke: '#8d99a6' });
  el('line', { x1: 150, y1: r(0), x2: 680, y2: r(0), stroke: N1C, 'stroke-width': 4 });
  el('rect', { x: 312, y: r(-7), width: 260, height: 14, fill: 'none', stroke: N2C, 'stroke-width': 3 });
  txt(200, r(0) - 6, 'N1 shaft', { size: 9, fill: N1C });
  txt(442, r(24), 'N2 shaft', { size: 9, fill: N2C });
  // Combustor, fuel nozzle, igniter.
  const comb = el('path', { d: `M478 ${r(-40)} Q520 ${r(-56)} 552 ${r(-40)} L552 ${r(40)} Q520 ${r(56)} 478 ${r(40)} Z`, fill: '#2b3138', stroke: HOT, 'stroke-width': 1.5 });
  txt(515, r(-62), 'COMBUSTOR', { size: 9, fill: HOT });
  const fuelLine = el('path', { d: `M500 ${r(150)} L500 ${r(46)}`, stroke: FUELC, 'stroke-width': 3, fill: 'none' });
  txt(500, r(166), 'FUEL', { size: 9, fill: FUELC });
  const spark = el('path', { d: `M528 ${r(150)} L528 ${r(52)} l-5 -8 l9 0 l-5 -8`, stroke: IGN, 'stroke-width': 2, fill: 'none' });
  txt(536, r(166), 'IGNITERS', { size: 9, fill: IGN, a: 'start' });

  // Bleed: 5th and 9th stage ports up through the cowl; fan air above.
  const port = (x, label, color, y) => {
    const line = el('path', { d: `M${x} ${r(-54)} L${x} ${y} L${x + 20} ${y}`, fill: 'none', stroke: color, 'stroke-width': 3, 'stroke-dasharray': '8 6' });
    const box = el('rect', { x: x + 20, y: y - 11, width: 150, height: 22, rx: 3, fill: '#20262d', stroke: '#56606b' });
    txt(x + 95, y + 4, label, { size: 10 });
    return { line, box };
  };
  const b5 = port(380, '5TH STAGE BLEED', AIR, r(-182));
  const b9 = port(456, '9TH STAGE BLEED (HIGH)', AIR, r(-210));
  const fanAir = el('path', { d: `M250 ${r(-114)} L250 ${r(-196)} L178 ${r(-196)}`, fill: 'none', stroke: BYP, 'stroke-width': 3, 'stroke-dasharray': '8 6' });
  txt(146, r(-192), 'FAN AIR', { size: 10, fill: BYP });
  txt(146, r(-180), 'to precooler', { size: 8.5, fill: 'var(--schem-dim)' });
  const cai = el('path', { d: `M380 ${r(-150)} L120 ${r(-150)} L104 ${r(-140)}`, fill: 'none', stroke: AIR, 'stroke-width': 2, 'stroke-dasharray': '4 4', opacity: 0.6 });
  txt(250, r(-140), 'cowl anti-ice (bleed to the inlet lip)', { size: 8.5, fill: 'var(--schem-dim)' });
  // Bleed manifold → the airplane's bleed duct.
  el('path', { d: `M550 ${r(-182)} L660 ${r(-182)} L660 ${r(-196)} L672 ${r(-196)}`, fill: 'none', stroke: '#56606b', 'stroke-width': 2 });
  el('path', { d: `M626 ${r(-210)} L660 ${r(-210)} L660 ${r(-196)}`, fill: 'none', stroke: '#56606b', 'stroke-width': 2 });
  txt(678, r(-193), '→ engine bleed valve → packs,', { size: 9, fill: 'var(--schem-dim)', a: 'start' });
  txt(678, r(-181), 'wing and cowl anti-ice, starting', { size: 9, fill: 'var(--schem-dim)', a: 'start' });

  // Gearbox under the fan case, driven by N2 through a radial shaft.
  el('path', { d: `M330 ${r(10)} L250 ${r(150)} L250 ${r(176)}`, fill: 'none', stroke: N2C, 'stroke-width': 3 });
  txt(312, r(104), 'radial drive', { size: 8.5, fill: N2C, a: 'start' });
  el('rect', { x: 110, y: r(176), width: 440, height: 34, rx: 5, fill: '#20262d', stroke: N2C, 'stroke-width': 1.5 });
  txt(330, r(226), 'ACCESSORY GEARBOX — turned by N2', { size: 9.5, fill: N2C });
  const acc = [['STARTER', AIR], ['IDG', ELEC], ['HYD PUMP', HYD], ['FUEL PUMP', FUELC], ['OIL PUMP', OIL]].map(([lab, color], k) => {
    const x = 118 + k * 86;
    const box = el('rect', { x, y: r(181), width: 80, height: 24, rx: 3, fill: '#161b21', stroke: '#56606b' });
    txt(x + 40, r(197), lab, { size: 9.5 });
    return { box, color, x };
  });
  // What the accessories feed.
  const outs = [
    { k: 1, d: `M198 ${r(205)} L198 ${r(262)}`, lab: 'AC POWER → generator bus', color: ELEC },
    { k: 2, d: `M284 ${r(205)} L284 ${r(240)}`, lab: 'HYDRAULIC A (eng 1) / B (eng 2)', color: HYD },
    { k: 0, d: `M24 ${r(193)} L118 ${r(193)}`, lab: 'start air in', color: AIR },
  ].map((o) => ({ ...o, p: el('path', { d: o.d, fill: 'none', stroke: o.color, 'stroke-width': 3, 'stroke-dasharray': '8 6' }) }));
  txt(206, r(274), 'AC power → generator bus', { size: 9, fill: ELEC, a: 'start' });
  txt(292, r(252), 'hydraulic pressure (A / B)', { size: 9, fill: HYD, a: 'start' });
  txt(24, r(186), 'start air', { size: 9, fill: AIR, a: 'start' });
  const legend = txt(980, r(270), '', { size: 10, a: 'end' });
  txt(980, r(254), 'blue = N1 spool · orange = N2 spool', { size: 9.5, a: 'end', fill: 'var(--schem-dim)' });

  // ── State → drawing ──
  let last = null, v = { n1: 0, n2: 0, lit: false };
  const dim = (node, on, color) => { node.setAttribute('opacity', on ? 1 : 0.22); if (color) node.setAttribute('stroke', on ? color : '#56606b'); };
  function update(res) {
    last = res;
    const e = res.values.e[eng];
    v = { n1: e.n1, n2: e.n2, lit: e.lit || e.run };
    const air = ctx.resOf?.('air'), tai = ctx.resOf?.('antiice')?.values?.tai?.[eng];
    const bleedOn = !!air?.flows?.[eng ? 'b2' : 'b1'] && e.run, high = bleedOn && !!air?.values?.[eng ? 'highR' : 'highL'];
    dim(b5.line, bleedOn); dim(b9.line, high); dim(fanAir, e.n1 > 5);
    dim(cai, !!tai && e.run);
    comb.setAttribute('fill', v.lit ? '#7a2a1a' : '#2b3138');
    dim(fuelLine, e.lit || e.run); dim(spark, !!e.ignOn);
    const driven = e.n2 > 1;
    acc.forEach((a, k) => {
      const on = k === 0 ? e.startValve : k === 1 || k === 2 ? e.run : driven;
      a.box.setAttribute('stroke', on ? a.color : '#56606b');
      a.box.setAttribute('fill', on ? `color-mix(in srgb, ${a.color} 18%, #161b21)` : '#161b21');
    });
    for (const o of outs) dim(o.p, o.k === 0 ? e.startValve : e.run);
    legend.textContent = `ENGINE ${eng + 1} · N1 ${e.n1.toFixed(1)} % · N2 ${e.n2.toFixed(1)} % · ${e.run ? 'running' : e.startValve ? 'starter turning N2' : e.lit ? 'lighting off' : 'stopped'}`;
  }
  // Animation: spools spin, air moves (only while the schematic is on screen).
  let t0 = performance.now();
  const tick = (now) => {
    if (!svg.isConnected) return;
    const dt = Math.min(0.1, (now - t0) / 1000); t0 = now;
    for (const ro of rotors) {
      const sp = v[ro.spool] || 0;
      ro.off = (ro.off + dt * sp * 2.2) % 10;
      ro.g.setAttribute('transform', `translate(0 ${ro.off})`);
    }
    for (const f of flows) {
      const sp = f.speedOf(v);
      f.off = (f.off - dt * sp * 1.6) % 22;
      f.p.setAttribute('stroke-dashoffset', f.off);
      f.p.setAttribute('opacity', sp > 1 ? 0.85 : 0.15);
    }
    for (const o of [b5.line, b9.line, fanAir, ...outs.map((x) => x.p)]) o.setAttribute('stroke-dashoffset', -((now / 40) % 14));
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return { update };
}

/** ENGINE START, APU, engine (EEC) panels and the start levers. */
export function panels(O, ctx) {
  // ENGINE START: light-grey bar selectors, ignition select between them.
  const S = O.panel('Engine start', 104);
  S.text(150, 16, 'ENGINE START', { size: 8.5 });
  S.knob(66, 58, 'start1', ['GRD', 'AUTO', 'CONT', 'FLT'], [-60, -20, 20, 60], { grey: true, r: 15, name: '1', nameDy: 22 });
  S.knob(234, 58, 'start2', ['GRD', 'AUTO', 'CONT', 'FLT'], [-60, -20, 20, 60], { grey: true, r: 15, name: '2', nameDy: 22 });
  S.toggle(150, 62, 'ign', ['IGN L', 'BOTH', 'IGN R'], { horizontal: true });

  // APU: four lights in a row, EGT gauge (0 lower right, clockwise to 10 at
  // the top), and the OFF / ON / START switch (START spring-loaded to ON).
  const A = O.panel('APU', 118);
  A.text(150, 12, 'APU', { size: 8 });
  A.lamp(46, 18, 50, 18, 'MAINT', 'apuMaint', 'blue');
  A.lamp(98, 18, 50, 18, 'LOW OIL\nPRESSURE', 'apuLowOil');
  A.lamp(150, 18, 50, 18, 'FAULT', 'apuFault');
  A.lamp(202, 18, 50, 18, 'OVER\nSPEED', 'apuOverspeed');
  A.dial(150, 76, 30, {
    scales: [{ pts: [[0, 125], [10, 360]], ticks: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v) => [v, v % 2 ? 0.1 : 0.18, v % 2 ? 0.8 : 1.3]),
      labels: [[0, '0'], [2, '2'], [4, '4'], [6, '6'], [8, '8'], [10, '10']], lr: 0.64, lfs: 7.5 }],
    texts: [[-0.05, 0.42, 'EGT', 6]], hub: 0.22, needles: [{ fn: (r) => r.values.apuEgt / 100, len: 0.82, w: 2.4 }],
  });
  // The APU switch itself sits in the lights row at the front of the
  // overhead, between the landing lights and ENGINE START.
  const AS = O.panel('APU switch', 104, { w: 100 });
  AS.text(50, 14, 'APU', { size: 8 });
  AS.toggle(50, 56, 'apu', ['OFF', 'ON', 'START'], { momentary: [2] });

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
