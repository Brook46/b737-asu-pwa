// schem-autoflight.js — AFDS / autothrottle schematic with a live FMA, and
// the MCP as three operable panels (also placed on the 3D glareshield).

import { createSchematic, createPanel } from './schem-kit.js?v=12';
import { createOverhead } from './overhead.js?v=12';
import { STEPS } from './sys-autoflight.js?v=12';

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
  // The MCP, left to right as on the glareshield, in four sections.
  const MCP = { bg: '#43484d' };
  const btn = (P, x, y, label, w = 34) => P.lamp(x, y, w, 17, label, 'mcp_' + label, 'green', 'autoflight', () => ctx.action(label));
  const S = O.panel('MCP speed', 84, MCP);
  S.text(31, 10, 'COURSE', { size: 6.5 });
  S.lcd(8, 14, 46, () => '093', { h: 16, size: 11 });
  S.knob(31, 50, 'crsL', ['', ''], [0, 0], { action: true, noLabels: true, r: 10 });
  S.lamp(60, 30, 20, 10, 'MA', 'maL', 'white');
  S.toggle(70, 60, 'fdL', ['ON', 'OFF'], { invert: true, noLabels: true });
  S.text(86, 50, 'ON', { size: 5.5 }); S.text(86, 76, 'OFF', { size: 5.5 }); S.text(62, 82, 'F/D', { size: 6 });
  S.text(112, 10, 'A/T ARM', { size: 6.5 });
  S.lamp(102, 14, 20, 9, 'ARM', 'atArmLt', 'green');
  S.toggle(112, 50, 'atArm', ['ARM', 'OFF'], { invert: true, noLabels: true });
  S.text(112, 80, 'OFF', { size: 5.5 });
  S.text(176, 10, 'IAS/MACH', { size: 6.5 });
  S.lcd(140, 14, 72, (r) => String(r.values.spd), { h: 16, size: 12 });
  S.push(146, 40, null, { name: 'C/O (IAS / Mach changeover)' }); S.text(146, 53, 'C/O', { size: 5 });
  S.knob(176, 42, 'spd', ['', ''], [0, 0], { action: true, noLabels: true, r: 10 });
  S.push(206, 40, null, { name: 'SPD INTV' }); S.text(206, 53, 'SPD INTV', { size: 4.6 });
  btn(S, 136, 62, 'N1'); btn(S, 176, 62, 'SPEED');
  btn(S, 236, 14, 'VNAV', 40); btn(S, 236, 60, 'LVL CHG', 40);

  const H = O.panel('MCP heading', 84, MCP);
  H.text(66, 10, 'HEADING', { size: 6.5 });
  H.lcd(30, 14, 72, (r) => String(r.values.hdg).padStart(3, '0'), { h: 16, size: 12 });
  H.knob(66, 50, 'hdg', ['', ''], [0, 0], { action: true, noLabels: true, r: 11 });
  H.knob(112, 52, 'bank', ['10', '15', '20', '25', '30'], [-60, -30, 0, 30, 60], { r: 7, name: 'BANK', nameDy: 9 });
  btn(H, 46, 66, 'HDG SEL', 40);
  btn(H, 164, 14, 'LNAV', 40); btn(H, 164, 60, 'VOR LOC', 40); btn(H, 214, 60, 'APP', 40);

  const V = O.panel('MCP altitude', 84, MCP);
  V.text(46, 10, 'ALTITUDE', { size: 6.5 });
  V.lcd(8, 14, 76, (r) => String(r.values.alt), { h: 16, size: 12 });
  V.knob(46, 48, 'alt', ['', ''], [0, 0], { action: true, noLabels: true, r: 11 });
  V.push(80, 42, null, { name: 'ALT INTV' }); V.text(80, 55, 'ALT INTV', { size: 4.6 });
  btn(V, 28, 62, 'ALT HLD', 40);
  V.text(176, 10, 'VERT SPEED', { size: 6.5 });
  V.lcd(144, 14, 64, (r) => (r.values.vs ? (r.values.vs > 0 ? '+' : '') + r.values.vs : ''), { h: 16, size: 12 });
  V.knob(226, 40, 'vs', ['', ''], [0, 0], { action: true, noLabels: true, r: 8 });
  V.text(226, 24, 'DN', { size: 5 }); V.text(226, 62, 'UP', { size: 5 });
  btn(V, 158, 60, 'V/S', 40);

  const E = O.panel('MCP engage', 84, MCP);
  E.text(62, 9, 'A/P ENGAGE', { size: 6.5 });
  btn(E, 22, 14, 'CMD A', 38); btn(E, 64, 14, 'CMD B', 38);
  btn(E, 22, 36, 'CWS A', 38); btn(E, 64, 36, 'CWS B', 38);
  // DISENGAGE bar: down shows its yellow background and disconnects both autopilots.
  E.lamp(18, 60, 88, 16, 'DISENGAGE', () => !!ctx.sw.dis, 'amber', 'autoflight', () => ctx.set('dis', ctx.sw.dis ? 0 : 1));
  E.text(196, 10, 'COURSE', { size: 6.5 });
  E.lcd(172, 14, 48, () => '093', { h: 16, size: 11 });
  E.knob(196, 50, 'crsR', ['', ''], [0, 0], { action: true, noLabels: true, r: 10 });
  E.lamp(262, 30, 20, 10, 'MA', 'maR', 'white');
  E.toggle(272, 60, 'fdR', ['ON', 'OFF'], { invert: true, noLabels: true });
  E.text(256, 50, 'ON', { size: 5.5 }); E.text(256, 76, 'OFF', { size: 5.5 }); E.text(280, 82, 'F/D', { size: 6 });

  // A/P, A/T and FMC disengage / alert lights with their TEST switch
  // (top of each forward panel); STAB OUT OF TRIM (captain's panel).
  const L = O.panel('Autoflight lights', 40);
  L.lamp(8, 8, 50, 24, 'A/P', 'apDisc', 'red', 'autoflight', () => ctx.action('apReset'));
  L.lamp(62, 8, 50, 24, 'A/T', 'atDisc', 'red', 'autoflight', () => ctx.action('atReset'));
  L.lamp(116, 8, 50, 24, 'FMC', () => ctx.resOf?.('fms')?.lights.fmcAlert, 'amber');
  L.toggle(190, 22, 'lightTest', ['1', '', '2'], { inert: true, inertPos: 1 });
  L.text(190, 36, 'TEST', { size: 5.5 });
  L.lamp(226, 6, 64, 28, 'STAB\nOUT OF\nTRIM', 'stabOot');
}
