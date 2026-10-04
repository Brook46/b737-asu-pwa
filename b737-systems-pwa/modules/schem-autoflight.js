// schem-autoflight.js — AFDS / autothrottle schematic with a live FMA, and
// the MCP as three operable panels (also placed on the 3D glareshield).

import { createSchematic, createPanel } from './schem-kit.js?v=10';
import { createOverhead } from './overhead.js?v=10';
import { STEPS } from './sys-autoflight.js?v=10';

const C = '#9b5de5', A = '#2f7cf6', B = '#12a874';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 640);
  X.onPart = ctx.onPart;
  // FMA strip.
  X.el('rect', { x: 200, y: 20, width: 600, height: 84, rx: 4, fill: '#000' }, X.svg);
  ['A/T', 'ROLL', 'PITCH'].forEach((n, i) => {
    X.text(300 + i * 200, 16, n, 't-small t-dim', 'middle');
    X.value(300 + i * 200, 56, (r) => ({ text: r.values.fma[i] || '', cls: 't-big fma-on' + (r.values.boxed[i] ? ' fma-box' : '') }));
    X.value(300 + i * 200, 88, (r) => ({ text: r.values.arm[i] || '', cls: 't-small fma-arm' }));
  });
  X.value(500, 128, (r) => ({ text: r.values.status, cls: 't-big' }));
  // MCP → FCCs → servos / F/D bars; A/T.
  X.unit(380, 160, 240, 44, 'MODE CONTROL PANEL', () => 'on', { color: C, part: 'mcp' });
  X.pipe([[440, 204], [440, 240], [220, 240], [220, 270]], () => true, { color: C, thin: true, still: true });
  X.pipe([[560, 204], [560, 240], [780, 240], [780, 270]], () => true, { color: C, thin: true, still: true });
  for (const [n, x, col, k, hyd] of [['FCC A', 220, A, 'cmdA', 'hydA'], ['FCC B', 780, B, 'cmdB', 'hydB']]) {
    X.unit(x - 80, 270, 160, 50, n, () => 'on', { color: C, part: 'fcc' });
    X.pipe([[x, 320], [x, 380]], k === 'cmdA' ? 'apA' : 'apB', { color: col });
    X.unit(x - 90, 380, 180, 46, `A/P ${n.slice(-1)} ACTUATORS`, (r) => (r.flows[k === 'cmdA' ? 'apA' : 'apB'] ? 'on' : 'off'), { color: col, part: 'servos', small: true });
    X.value(x, 446, (r) => ({ text: `hyd ${hyd === 'hydA' ? 'A' : 'B'} ${r.env[hyd] === false ? 'LOST' : 'ok'}`, cls: 't-small' + (r.env[hyd] === false ? ' warn' : '') }));
    X.pipe([[x + (x < 500 ? -60 : 60), 320], [x + (x < 500 ? -60 : 60), 350], [x + (x < 500 ? -150 : 150), 350]], (r) => !!ctx.sw[x < 500 ? 'fdL' : 'fdR'], { color: C, thin: true });
    X.text(x + (x < 500 ? -150 : 150), 342, x < 500 ? 'CAPT F/D' : 'F/O F/D', 't-small', 'middle');
  }
  X.pipe([[500, 320], [500, 480]], 'at', { color: C });
  X.unit(400, 480, 200, 46, 'AUTOTHROTTLE', (r) => r.units.at, { color: C, part: 'at' });
  X.value(500, 546, (r) => ({ text: ctx.sw.atArm ? 'A/T ARM' : 'A/T OFF', cls: 't-small' }));
  X.value(500, 590, (r) => ({ text: r.values.step >= 0 ? `Approach step: ${STEPS[r.values.step]}` : '', cls: 't-small' }));
  X.value(500, 616, (r) => ({ text: `MCP  SPD ${r.values.spd} · HDG ${String(r.values.hdg).padStart(3, '0')} · ALT ${r.values.alt} · V/S ${r.values.vs}`, cls: 't-small t-dim' }));

  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);
  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('INSTRUCTOR · CONTROLS');
  P.actions(P.push('TO/GA', () => ctx.action('TOGA')), P.push('A/P DISENGAGE (yoke)', () => ctx.action('APDISC')),
    P.push('A/T DISENGAGE (levers)', () => ctx.action('ATDISC')), P.push('NEXT APPROACH STEP', () => ctx.action('step')));
  P.actions(P.fail('Stab out of trim', 'stabOot'), P.push('RESET TO NORMAL', ctx.reset));
  P.note('In <b>Cruise</b>: push APP, then CMD B too (dual). Step the approach: capture → 1,500 ft (FLARE armed) → flare → RETARD → touchdown. Try it with only CMD A: SINGLE CH, and the autopilot drops at 50 ft. Hydraulics → <b>A leak</b> drops A/P A.');
  return { update(res) { X.update(res); O.update(res); P.update(res); } };
}

export function panels(O, ctx) {
  const btn = (P, x, y, label) => P.lamp(x, y, 40, 22, label, 'mcp_' + label, 'green', 'autoflight', () => ctx.action(label));
  const S = O.panel('MCP speed', 84);
  S.toggle(26, 44, 'fdL', ['ON', 'OFF'], { name: 'F/D', nameBox: false, invert: true });
  S.lamp(16, 8, 20, 10, 'MA', 'maL', 'green');
  S.toggle(66, 44, 'atArm', ['ARM', 'OFF'], { name: 'A/T', nameBox: false, invert: true });
  S.lamp(56, 8, 20, 10, 'ARM', 'atArmLt', 'green');
  btn(S, 92, 12, 'N1'); btn(S, 92, 50, 'SPEED');
  S.text(182, 10, 'IAS/MACH', { size: 7 });
  S.lcd(146, 14, 72, (r) => String(r.values.spd), { h: 18, size: 13 });
  S.knob(182, 58, 'spd', ['', ''], [0, 0], { action: true, noLabels: true, r: 11 });
  btn(S, 232, 12, 'VNAV'); btn(S, 232, 50, 'LVL CHG');
  const H = O.panel('MCP heading', 84);
  H.text(66, 10, 'HEADING', { size: 7 });
  H.lcd(30, 14, 72, (r) => String(r.values.hdg).padStart(3, '0'), { h: 18, size: 13 });
  H.knob(66, 58, 'hdg', ['', ''], [0, 0], { action: true, noLabels: true, r: 11 });
  H.knob(110, 58, 'bank', ['10', '15', '20', '25', '30'], [-60, -30, 0, 30, 60], { r: 8, name: 'BANK', nameDy: 10 });
  btn(H, 140, 12, 'HDG SEL'); btn(H, 140, 50, 'LNAV');
  btn(H, 196, 12, 'VOR LOC'); btn(H, 196, 50, 'APP');
  H.text(270, 10, 'COURSE', { size: 7 });
  H.lcd(246, 14, 48, () => '093', { h: 18, size: 12 });
  const V = O.panel('MCP altitude', 84);
  V.text(46, 10, 'ALTITUDE', { size: 7 });
  V.lcd(10, 14, 76, (r) => String(r.values.alt), { h: 18, size: 13 });
  V.knob(46, 58, 'alt', ['', ''], [0, 0], { action: true, noLabels: true, r: 11 });
  btn(V, 92, 12, 'ALT HLD'); btn(V, 92, 50, 'V/S');
  V.lcd(138, 14, 54, (r) => (r.values.vs ? (r.values.vs > 0 ? '+' : '') + r.values.vs : ''), { h: 18, size: 12 });
  V.knob(165, 58, 'vs', ['', ''], [0, 0], { action: true, noLabels: true, r: 9 });
  btn(V, 198, 8, 'CMD A'); btn(V, 242, 8, 'CMD B');
  btn(V, 198, 34, 'CWS A'); btn(V, 242, 34, 'CWS B');
  V.toggle(258, 70, 'dis', ['ENGAGE', 'DISENGAGE'], { horizontal: true });
  V.toggle(208, 70, 'fdR', ['ON', 'OFF'], { horizontal: true, invert: true, name: 'F/D' });
  const L = O.panel('Autoflight lights', 40);
  L.lamp(10, 8, 54, 24, 'A/P', 'apDisc', 'red', 'autoflight', () => ctx.action('apReset'));
  L.lamp(72, 8, 54, 24, 'A/T', 'atDisc', 'red', 'autoflight', () => ctx.action('atReset'));
  L.lamp(140, 8, 70, 24, 'STAB OUT\nOF TRIM', 'stabOot');
  L.push(250, 20, () => ctx.action('TOGA'), { bottom: 'TO/GA', name: 'TO/GA' });
}
