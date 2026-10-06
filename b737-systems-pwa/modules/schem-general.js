// schem-general.js — lights, signs, emergency lighting, doors and oxygen at
// a glance, with the lights, signs, oxygen, door and flight deck door panels.

import { createSchematic, createPanel } from './schem-kit.js?v=27';
import { createOverhead } from './overhead.js?v=27';
import { DOORS } from './sys-general.js?v=27';

const C = '#6b7280', LT = '#fab005';
const EXT = [['llL', 'L LANDING'], ['llR', 'R LANDING'], ['rtoL', 'L RWY TURNOFF'], ['rtoR', 'R RWY TURNOFF'], ['taxi', 'TAXI'], ['logo', 'LOGO'], ['beacon', 'ANTI COLLISION'], ['wingLt', 'WING'], ['wwLt', 'WHEEL WELL']];

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 640);
  X.onPart = ctx.onPart;
  X.text(30, 26, 'EXTERIOR LIGHTS', 't-small t-dim');
  EXT.forEach(([k, n], i) => {
    const x = 30 + (i % 5) * 190, y = 36 + Math.floor(i / 5) * 54;
    X.unit(x, y, 170, 40, n, () => (ctx.sw[k] ? 'on' : 'off'), { color: LT, part: 'lights', small: true });
  });
  X.unit(790, 90, 170, 40, 'POSITION / STROBE', () => (ctx.sw.pos === 1 ? 'off' : 'on'), { color: LT, part: 'lights', small: true });
  X.value(875, 148, () => ({ text: ['STROBE & STEADY', 'OFF', 'STEADY'][ctx.sw.pos], cls: 't-small' }));
  // Signs and emergency lights.
  X.unit(30, 190, 280, 50, 'FASTEN BELTS', (r) => (r.values.belts ? 'on' : 'off'), { color: '#adb5bd', part: 'signs' });
  X.value(170, 258, () => ({ text: `switch ${['OFF', 'AUTO', 'ON'][ctx.sw.belts]} — AUTO: flaps or gear out`, cls: 't-small' }));
  X.unit(360, 190, 280, 50, 'EMERGENCY LIGHTS', (r) => r.units.emergency, { color: '#ffd43b', part: 'emergency' });
  X.value(500, 258, (r) => ({ text: r.values.emerOn ? 'ON' : ['OFF — will NOT come on', 'ARMED', 'ON'][ctx.sw.exitLt], cls: 't-small' + (ctx.sw.exitLt !== 1 ? ' warn' : '') }));
  X.unit(690, 190, 280, 50, 'PASSENGER OXYGEN', (r) => r.units.oxygen, { color: '#74c0fc', part: 'oxygen' });
  X.value(830, 258, (r) => ({ text: r.values.dropped ? `MASKS DOWN · ~${r.values.oxyLeft} min` : `cabin ${Math.round(r.values.cab)} ft (drops at 14,000)`, cls: 't-small' + (r.values.dropped ? ' warn' : '') }));
  // Doors.
  X.text(30, 306, 'DOORS', 't-small t-dim');
  DOORS.forEach(([k, n], i) => {
    const x = 30 + (i % 4) * 240, y = 316 + Math.floor(i / 4) * 64;
    X.unit(x, y, 220, 48, n, (r) => (r.values.open[k] ? 'fault' : 'on'), { color: C, part: 'doors', small: true });
    X.value(x + 110, y + 62, (r) => ({ text: r.values.open[k] ? 'OPEN' : '', cls: 't-small warn' }));
  });
  X.value(750, 400, (r) => ({ text: `overwing flight locks: ${r.values.flightLock ? 'LOCKED' : 'unlocked'}`, cls: 't-small' }));
  X.text(500, 470, 'Overwing exits lock with 3 of 4 entry/service doors closed, an engine running, and airborne or thrust levers advanced', 't-small t-dim', 'middle');

  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);
  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('INSTRUCTOR · DOORS & FAILURES');
  P.actions(...DOORS.map(([k, n]) => P.push(`${n} open/close`, () => ctx.action('door:' + k))));
  P.actions(P.push('GPU CONNECT / DISCONNECT', () => ctx.set('gpuCart', ctx.sw.gpuCart ? 0 : 1)), P.push('AIR-CON CART CONNECT / DISCONNECT', () => ctx.set('acCart', ctx.sw.acCart ? 0 : 1)));
  P.actions(P.fail('DC bus 1 lost', 'dcBus1'), P.fail('Overwing exit unlocked', 'overwing'), P.fail('Equipment cooling fan', 'cool'),
    P.fail('Flight deck door lock', 'lockFail'), P.push('EMERGENCY ACCESS CODE', () => ctx.action('code')), P.push('RESET TO NORMAL', ctx.reset));
  P.note('Move the flaps (Flight Controls) with FASTEN BELTS in AUTO and the signs follow. Turn EMER EXIT LIGHTS off: NOT ARMED + MASTER CAUTION (OVERHEAD). Fail DC bus 1 with them ARMED: they come on. Air Systems → cabin above 14,000 ft: the masks drop.');
  return { update(res) { X.update(res); O.update(res); P.update(res); } };
}

export function panels(O, ctx) {
  // Exterior lights, two groups along the front of the overhead; OFF is up.
  const L = O.panel('Lights L', 88);
  L.text(76, 12, 'LANDING', { size: 7 });
  L.toggle(52, 40, 'llL', ['OFF', 'ON'], { name: 'L', nameBox: false });
  L.toggle(100, 40, 'llR', ['OFF', 'ON'], { name: 'R', nameBox: false });
  L.text(76, 84, 'FIXED', { size: 6 });
  L.text(186, 12, 'RUNWAY\nTURNOFF', { size: 6.5 });
  L.toggle(166, 44, 'rtoL', ['OFF', 'ON'], { name: 'L', nameBox: false });
  L.toggle(206, 44, 'rtoR', ['OFF', 'ON'], { name: 'R', nameBox: false });
  L.text(262, 12, 'TAXI', { size: 7 });
  L.toggle(262, 44, 'taxi', ['OFF', 'ON'], {});
  const R = O.panel('Lights R', 88);
  R.text(36, 12, 'LOGO', { size: 6.5 });
  R.toggle(36, 44, 'logo', ['OFF', 'ON'], {});
  R.text(100, 12, 'POSITION', { size: 6.5 });
  R.toggle(100, 50, 'pos', ['STROBE & STEADY', 'OFF', 'STEADY'], { noLabels: true });
  R.text(126, 30, 'STROBE &\nSTEADY', { size: 5.5 }); R.text(122, 54, 'OFF', { size: 5.5 }); R.text(126, 72, 'STEADY', { size: 5.5 });
  R.text(170, 12, 'ANTI\nCOLLISION', { size: 6 });
  R.toggle(170, 46, 'beacon', ['OFF', 'ON'], {});
  R.text(220, 12, 'WING', { size: 6.5 });
  R.toggle(220, 44, 'wingLt', ['OFF', 'ON'], {});
  R.text(268, 12, 'WHEEL\nWELL', { size: 6 });
  R.toggle(268, 46, 'wwLt', ['OFF', 'ON'], {});

  // ── The narrow centre column of the forward overhead (150 units wide) ──
  // Panel light dimmers at the top (circuit breaker and panel brightness).
  const PL = O.panel('Panel lights', 118, { w: 150 });
  PL.text(75, 14, 'CIRCUIT BREAKER', { size: 6.5 });
  PL.knob(75, 40, 'cbLt', ['OFF', 'BRIGHT'], [-120, 120], { inert: true, inertPos: 1, r: 12, noLabels: true });
  PL.text(36, 58, 'OFF', { size: 5.5 }); PL.text(110, 28, 'BRIGHT', { size: 5.5 });
  PL.text(75, 74, 'PANEL', { size: 6.5 });
  PL.knob(75, 98, 'panelLt', ['OFF', 'BRIGHT'], [-120, 120], { inert: true, inertPos: 1, r: 12, noLabels: true });
  PL.text(36, 114, 'OFF', { size: 5.5 }); PL.text(110, 86, 'BRIGHT', { size: 5.5 });

  // Equipment cooling.
  const Q = O.panel('Equipment cooling', 96, { w: 150 });
  Q.text(75, 12, 'EQUIP COOLING', { size: 7 });
  Q.text(40, 24, 'SUPPLY', { size: 6 }); Q.text(110, 24, 'EXHAUST', { size: 6 });
  Q.toggle(40, 50, 'coolSup', ['NORMAL', 'ALTERNATE'], { noLabels: true });
  Q.toggle(110, 50, 'coolExh', ['NORMAL', 'ALTERNATE'], { noLabels: true });
  Q.text(75, 38, 'NORMAL', { size: 5.5 }); Q.text(75, 66, 'ALTERNATE', { size: 5.5 });
  Q.lamp(26, 76, 28, 13, 'OFF', 'coolOffSup'); Q.lamp(96, 76, 28, 13, 'OFF', 'coolOffExh');

  // Emergency exit lights and passenger signs.
  const E = O.panel('Cabin signs and equipment cooling', 132, { w: 150 });
  E.text(75, 12, 'EMER EXIT LIGHTS', { size: 6.8 });
  E.lamp(20, 20, 16, 44, 'N\nO\nT\n\nA\nR\nM\nE\nD', 'exitNotArmed');
  E.toggle(70, 42, 'exitLt', ['OFF', 'ARMED', 'ON'], { guard: 'black', guardPos: 1 });
  E.text(40, 84, 'NO\nSMOKING', { size: 5.8 }); E.text(110, 84, 'FASTEN\nBELTS', { size: 5.8 });
  E.toggle(40, 112, 'smoke', ['OFF', 'AUTO', 'ON'], { noLabels: true });
  E.toggle(110, 112, 'belts', ['OFF', 'AUTO', 'ON'], { noLabels: true });
  E.text(75, 102, 'OFF', { size: 5.2 }); E.text(75, 114, 'AUTO', { size: 5.2 }); E.text(75, 126, 'ON', { size: 5.2 });
  const X = O.panel('Oxygen', 84);
  X.text(60, 10, 'CREW OXYGEN', { size: 6.5 }); X.text(230, 10, 'PASS OXYGEN', { size: 6.5 });
  X.dial(60, 46, 26, {
    scales: [{ pts: [[0, -135], [2000, 135]], ticks: [0, 250, 500, 750, 1000, 1250, 1500, 1750, 2000].map((v) => [v, v % 500 ? 0.1 : 0.2, v % 500 ? 0.8 : 1.3]),
      labels: [[0, '0'], [500, '5'], [1000, '10'], [1500, '15'], [2000, '20']], lr: 0.62, lfs: 6.5 }],
    texts: [[0, 0.78, 'OXY PRESS PSI x 100', 3.8]], hub: 0.18,
    needles: [{ fn: (r) => r.values.crewOxy, len: 0.8, w: 2 }],
  });
  X.lamp(130, 12, 60, 22, 'PASS OXY\nON', 'passOxyOn');
  X.toggle(240, 46, 'passOxy', ['NORMAL', 'ON'], { guard: 'red', guardPos: 0, labels: 'left' });
  // Door lights, laid out like the airplane (forward at the top).
  const D = O.panel('Door lights', 96);
  const dl = (x, y, label, key) => D.lamp(x, y, 50, 18, label, key);
  dl(100, 8, 'FWD\nENTRY', 'door_fwdEntry'); dl(152, 8, 'FWD\nSERVICE', 'door_fwdSvc');
  D.lamp(40, 30, 40, 18, 'INOP', null, 'white');
  dl(100, 30, 'LEFT FWD\nOVERWING', 'overwingL'); dl(152, 30, 'RIGHT FWD\nOVERWING', 'overwingR'); dl(204, 30, 'FWD\nCARGO', 'door_fwdCargo');
  dl(40, 52, 'EQUIP', 'door_equip');
  dl(100, 52, 'LEFT AFT\nOVERWING', 'overwingL'); dl(152, 52, 'RIGHT AFT\nOVERWING', 'overwingR'); dl(204, 52, 'AFT\nCARGO', 'door_aftCargo');
  dl(100, 74, 'AFT\nENTRY', 'door_aftEntry'); dl(152, 74, 'AFT\nSERVICE', 'door_aftSvc');
  const F = O.panel('Flight deck door', 50);
  F.lamp(14, 14, 56, 22, 'LOCK\nFAIL', 'lockFail');
  F.lamp(80, 14, 56, 22, 'AUTO\nUNLK', 'autoUnlk');
  F.knob(230, 26, 'fdDoor', ['UNLKD', 'AUTO', 'DENY'], [-50, 0, 50], { r: 11 });
}
