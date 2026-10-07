// schem-autoflight.js — AFDS / autothrottle schematic with a live FMA, and
// the MCP as three operable panels (also placed on the 3D glareshield).

import { createSchematic, createPanel } from './schem-kit.js?v=28';
import { createOverhead } from './overhead.js?v=28';
import { STEPS } from './sys-autoflight.js?v=28';

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
  // The MCP: one panel in the middle of the glareshield, about 6 : 1, laid
  // out as on the airplane (FCOM 4.10 MCP figure): COURSE · F/D · A/T ARM ·
  // IAS/MACH with N1 / SPEED · VNAV / LVL CHG · HEADING with bank limit and
  // HDG SEL · LNAV / VOR LOC / APP · ALTITUDE with ALT HLD · V/S with its
  // thumbwheel · A/P ENGAGE (CMD / CWS A·B, DISENGAGE) · COURSE · F/D.
  const M = O.panel('MCP', 150, { w: 900, bg: '#566069' });
  const key = (x, y, label, w = 42) => M.mcpKey(x, y, w, 28, label, 'mcp_' + label, () => ctx.action(label));
  const lbl = (x, t) => M.text(x, 14, t, { size: 9 });
  // Captain's course and F/D.
  lbl(66, 'COURSE');
  M.lcd(40, 20, 54, () => '093', { h: 26, size: 19 });
  M.knob(58, 80, 'crsL', ['', ''], [0, 0], { action: true, noLabels: true, r: 15 });
  M.lamp(96, 62, 24, 14, 'MA', 'maL', 'white');
  M.toggle(108, 112, 'fdL', ['ON', 'OFF'], { invert: true, noLabels: true });
  M.text(128, 104, 'ON', { size: 6.5 }); M.text(128, 130, 'OFF', { size: 6.5 }); M.text(84, 120, 'F/D', { size: 7.5 });
  // A/T ARM.
  lbl(160, 'A/T\nARM');
  M.lamp(148, 34, 24, 12, 'ARM', 'atArmLt', 'green');
  M.toggle(160, 70, 'atArm', ['ARM', 'OFF'], { invert: true, noLabels: true });
  M.text(160, 96, 'OFF', { size: 6.5 });
  // IAS / MACH.
  lbl(232, 'IAS/MACH');
  M.lcd(190, 20, 86, (r) => r.values.spdWin ?? String(r.values.spd), { h: 26, size: 19 });
  M.push(200, 68, null, { name: 'C/O (IAS / Mach changeover)' }); M.text(200, 86, 'C/O', { size: 6.5 });
  M.knob(238, 70, 'spd', ['', ''], [0, 0], { action: true, noLabels: true, r: 15 });
  M.push(278, 68, null, { name: 'SPD INTV' }); M.text(278, 86, 'SPD\nINTV', { size: 6 });
  key(150, 108, 'N1'); key(200, 108, 'SPEED');
  key(302, 20, 'VNAV'); key(302, 108, 'LVL CHG');
  // Heading.
  lbl(392, 'HEADING');
  M.lcd(360, 20, 64, (r) => String(r.values.hdg).padStart(3, '0'), { h: 26, size: 19 });
  // Bank angle limit: the outer ring behind the heading knob.
  M.knob(392, 74, 'bank', ['10', '15', '20', '25', '30'], [-60, -30, 0, 30, 60], { r: 21, noLabels: true, skirt: true });
  M.knob(392, 74, 'hdg', ['', ''], [0, 0], { action: true, noLabels: true, r: 13 });
  ['10', '15', '20', '25', '30'].forEach((t, i) => { const a = ((-60 + i * 30) * Math.PI) / 180; M.text(392 + Math.sin(a) * 32, 74 - Math.cos(a) * 32 + 2, t, { size: 5.5 }); });
  M.text(352, 100, 'BANK', { size: 5.5 });
  key(371, 108, 'HDG SEL');
  key(436, 20, 'LNAV'); key(436, 64, 'VOR LOC'); key(436, 108, 'APP');
  // Altitude.
  lbl(530, 'ALTITUDE');
  M.lcd(490, 20, 84, (r) => String(r.values.alt), { h: 26, size: 19 });
  M.knob(518, 74, 'alt', ['', ''], [0, 0], { action: true, noLabels: true, r: 16 });
  M.push(560, 72, null, { name: 'ALT INTV' }); M.text(560, 90, 'ALT\nINTV', { size: 6 });
  key(497, 108, 'ALT HLD');
  // Vertical speed.
  lbl(640, 'VERT SPEED');
  M.lcd(596, 20, 86, (r) => (r.values.vs ? (r.values.vs > 0 ? '+' : '') + r.values.vs : ''), { h: 26, size: 19 });
  key(596, 108, 'V/S');
  // Thumbwheel: a ribbed wheel set in a slot, DN at the top, UP at the bottom.
  M.knob(668, 88, 'vs', ['', ''], [0, 0], { action: true, noLabels: true, r: 9, bar: true });
  M.text(668, 62, 'DN', { size: 6 }); M.text(668, 118, 'UP', { size: 6 });
  // A/P engage.
  lbl(752, 'A/P ENGAGE');
  key(706, 20, 'CMD A'); key(756, 20, 'CMD B'); key(706, 58, 'CWS A'); key(756, 58, 'CWS B');
  M.lamp(706, 104, 92, 22, 'DISENGAGE', () => !!ctx.sw.dis, 'amber', 'autoflight', () => ctx.set('dis', ctx.sw.dis ? 0 : 1));
  // First officer's course and F/D.
  lbl(842, 'COURSE');
  M.lcd(816, 20, 54, () => '093', { h: 26, size: 19 });
  M.knob(852, 80, 'crsR', ['', ''], [0, 0], { action: true, noLabels: true, r: 15 });
  M.lamp(814, 62, 24, 14, 'MA', 'maR', 'white');
  M.toggle(826, 112, 'fdR', ['ON', 'OFF'], { invert: true, noLabels: true });
  M.text(806, 104, 'ON', { size: 6.5 }); M.text(806, 130, 'OFF', { size: 6.5 }); M.text(850, 120, 'F/D', { size: 7.5 });

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
