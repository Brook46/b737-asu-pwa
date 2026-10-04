// schem-general.js — lights, signs, emergency lighting, doors and oxygen at
// a glance, with the lights, signs, oxygen, door and flight deck door panels.

import { createSchematic, createPanel } from './schem-kit.js?v=8';
import { createOverhead } from './overhead.js?v=8';
import { DOORS } from './sys-general.js?v=8';

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
  const L = O.panel('Lights', 96);
  L.text(150, 12, 'LIGHTS', { size: 8.5 });
  const row = [['llL', 'L LAND'], ['llR', 'R LAND'], ['rtoL', 'L RWY TURNOFF'], ['rtoR', 'R RWY'], ['taxi', 'TAXI'], ['logo', 'LOGO'], ['beacon', 'ANTI COLL'], ['wingLt', 'WING']];
  row.forEach(([k, n], i) => L.toggle(20 + i * 33, 46, k, ['ON', 'OFF'], { name: n.replace(' TURNOFF', ' TURN'), nameBox: false, invert: true }));
  L.toggle(282, 46, 'pos', ['STROBE', 'OFF', 'STEADY'], { name: 'POSITION', nameBox: false, labels: 'left' });
  const C2 = O.panel('Cabin signs and equipment cooling', 130);
  C2.text(70, 14, 'EQUIP COOLING', { size: 7.5 });
  C2.toggle(40, 52, 'coolSup', ['NORM', 'ALTN'], { name: 'SUPPLY', nameBox: false });
  C2.toggle(100, 52, 'coolExh', ['NORM', 'ALTN'], { name: 'EXHAUST', nameBox: false });
  C2.lamp(24, 100, 32, 14, 'OFF', 'coolOffSup'); C2.lamp(84, 100, 32, 14, 'OFF', 'coolOffExh');
  C2.text(210, 14, 'EMER EXIT LIGHTS', { size: 7.5 });
  C2.lamp(240, 24, 46, 18, 'NOT\nARMED', 'exitNotArmed');
  C2.toggle(200, 54, 'exitLt', ['OFF', 'ARMED', 'ON'], { guard: 'black', guardPos: 1 });
  C2.toggle(170, 108, 'smoke', ['OFF', 'AUTO', 'ON'], { horizontal: true, name: 'NO SMOKING' });
  C2.toggle(250, 108, 'belts', ['OFF', 'AUTO', 'ON'], { horizontal: true, name: 'FASTEN BELTS' });
  const X = O.panel('Oxygen', 80);
  X.dial(60, 42, 26, {
    scales: [{ pts: [[0, -135], [2000, 135]], ticks: [0, 500, 1000, 1500, 2000].map((v) => [v, 0.2, 1.3]), labels: [[0, '0'], [1000, '10'], [2000, '20']], lr: 0.6, lfs: 7 }],
    texts: [[0, 0.5, 'CREW OXY\nPSI ×100', 5]], hub: 0.18,
    needles: [{ fn: (r) => r.values.crewOxy, len: 0.8, w: 2 }],
  });
  X.lamp(130, 12, 60, 22, 'PASS OXY\nON', 'passOxyOn');
  X.toggle(240, 44, 'passOxy', ['NORMAL', 'ON'], { guard: 'red', guardPos: 0, name: 'PASS OXYGEN', nameBox: false, labels: 'left' });
  const D = O.panel('Door lights', 86);
  D.text(150, 10, 'DOORS', { size: 8 });
  DOORS.forEach(([k, n], i) => D.lamp(10 + (i % 4) * 72, 18 + Math.floor(i / 4) * 22, 66, 18, n.replace(' ', '\n'), 'door_' + k));
  D.lamp(10, 64, 66, 16, 'L OVERWING', 'overwingL'); D.lamp(82, 64, 66, 16, 'R OVERWING', 'overwingR');
  const F = O.panel('Flight deck door', 50);
  F.lamp(14, 14, 56, 22, 'LOCK\nFAIL', 'lockFail');
  F.lamp(80, 14, 56, 22, 'AUTO\nUNLK', 'autoUnlk');
  F.knob(230, 26, 'fdDoor', ['UNLKD', 'AUTO', 'DENY'], [-50, 0, 50], { r: 11 });
}
