// schem-air.js — operable bleed / packs / pressurisation schematic + panel.

import { createSchematic, createPanel } from './schem-kit.js?v=12';
import { createOverhead } from './overhead.js?v=12';
import { ductPress, cabinAltDiff, cabinClimb, valvePosition } from './gauges.js?v=12';

const HOT = '#ff6a3d', COOL = '#15aabf', REC = '#82c91e', APUC = '#e8590c', OUT = '#868e96';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 640);
  X.onPart = ctx.onPart;

  // ── Sources ──
  X.unit(60, 20, 120, 42, 'ENG 1', (r) => (r.env.eng1 && !ctx.fail.eng1 ? 'on' : 'off'), { color: HOT, part: 'bleed1' });
  X.unit(440, 20, 120, 42, 'APU', (r) => (r.env.apu ? 'on' : 'off'), { color: APUC, part: 'apubleed' });
  X.unit(820, 20, 120, 42, 'ENG 2', (r) => (r.env.eng2 && !ctx.fail.eng2 ? 'on' : 'off'), { color: HOT, part: 'bleed2' });
  X.pipe([[120, 62], [120, 150]], 'b1', { color: HOT });
  X.pipe([[880, 62], [880, 150]], 'b2', { color: HOT });
  X.valve(120, 104, (r) => r.flows.b1, { vertical: true, label: 'BLEED 1', lx: 44, ly: 4, part: 'bleed1' });
  X.valve(880, 104, (r) => r.flows.b2, { vertical: true, label: 'BLEED 2', lx: -44, ly: 4, part: 'bleed2' });
  X.pipe([[470, 62], [470, 110], [380, 110], [380, 150]], 'apuB', { color: APUC });
  X.valve(425, 110, (r) => r.flows.apuB, { label: 'APU BLEED', ly: -16, part: 'apubleed' });

  // ── Duct + isolation valve ──
  X.pipe([[120, 150], [486, 150]], (r) => r.values.ductL > 0, { color: HOT, still: true });
  X.pipe([[514, 150], [880, 150]], (r) => r.values.ductR > 0, { color: HOT, still: true });
  X.valve(500, 150, (r) => r.values.isoOpen, { label: 'ISOLATION', ly: 28, part: 'iso' });
  X.value(250, 140, (r) => `${r.values.ductL} psi`, 't-small');
  X.value(750, 140, (r) => `${r.values.ductR} psi`, 't-small');

  // ── Packs ──
  X.pipe([[260, 150], [260, 220]], 'dL', { color: HOT });
  X.pipe([[740, 150], [740, 220]], 'dR', { color: HOT });
  X.unit(180, 220, 160, 56, 'L PACK', 'packL', { color: COOL, part: 'packL' });
  X.unit(660, 220, 160, 56, 'R PACK', 'packR', { color: COOL, part: 'packR' });
  X.value(260, 296, (r) => (r.values.highL ? { text: 'HIGH FLOW', cls: 't-small warn' } : ''));
  X.value(740, 296, (r) => (r.values.highR ? { text: 'HIGH FLOW', cls: 't-small warn' } : ''));
  X.pipe([[230, 330], [230, 276]], 'ramL', { color: '#74c0fc', thin: true });
  X.pipe([[770, 330], [770, 276]], 'ramR', { color: '#74c0fc', thin: true });
  X.text(230, 344, 'RAM AIR', 't-small t-dim', 'middle');
  X.text(770, 344, 'RAM AIR', 't-small t-dim', 'middle');

  // ── Mix manifold → cabin; flight deck straight from the left pack ──
  X.pipe([[290, 276], [290, 360], [430, 360]], 'pL', { color: COOL });
  X.pipe([[710, 276], [710, 360], [570, 360]], 'pR', { color: COOL });
  X.unit(430, 335, 140, 50, 'MIX MANIFOLD', (r) => r.units.mix, { color: COOL, part: 'mix' });
  X.pipe([[200, 276], [200, 455], [160, 455]], 'fd', { color: COOL });
  X.unit(40, 432, 120, 46, 'FLIGHT\nDECK', (r) => (r.flows.fd ? 'on' : 'off'), { color: COOL, part: 'dist' });
  X.pipe([[500, 385], [500, 420]], 'cab', { color: COOL });
  X.unit(360, 420, 280, 110, '', (r) => (r.flows.cab ? 'on' : 'off'), { color: COOL, part: 'dist' });
  X.text(500, 440, 'CABIN', 't-small t-dim', 'middle');
  X.value(500, 466, (r) => ({ text: `CABIN ALT ${r.values.cab.toLocaleString()} ft`, cls: 't-big' + (r.values.cab > 10000 ? ' warn' : '') }));
  X.value(500, 488, (r) => `DIFF ${r.values.diff} psi · RATE ${r.values.rate > 0 ? '+' : ''}${r.values.rate} fpm`, 't-small');
  X.value(500, 510, (r) => `AIRPLANE ${r.values.alt.toLocaleString()} ft`, 't-small t-dim');
  // Recirculation back to the mix manifold.
  X.pipe([[640, 470], [700, 470], [700, 410], [560, 410], [560, 385]], 'recirc', { color: REC, thin: true });
  X.text(706, 440, 'RECIRC', 't-small t-dim');
  // Outflow valve.
  X.pipe([[500, 530], [500, 600], [600, 600]], 'ofv', { color: OUT });
  X.valve(500, 570, (r) => r.values.ofv > 2, { vertical: true, label: '', part: 'ofv' });
  X.value(560, 574, (r) => `OUTFLOW VALVE ${r.values.ofv}% open`, 't-small', 'start');
  X.text(612, 604, 'OVERBOARD', 't-small t-dim');

  // ── Overhead panels (layout after FCOM 2.10) ──
  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);

  // ── Instructor station ──
  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('INSTRUCTOR · FAILURES');
  P.actions(P.fail('ENG 2 fail', 'eng2'), P.fail('Bleed trip 1', 'trip1'), P.fail('L pack trip', 'packL'), P.fail('Wing-body ovht L', 'wbL'),
    P.fail('Controller 1', 'ctrl1'), P.fail('Controller 2', 'ctrl2'));
  P.actions(P.push('AIR-CONDITIONING CART CONNECT / DISCONNECT', () => { const g = ctx.ctxOf('general'); g.set('acCart', g.sw.acCart ? 0 : 1); }), P.push('RESET TO NORMAL', ctx.reset));
  P.note('Outflow valve switch works in MAN only. Try: Cruise → <b>L pack trip</b> (the right pack goes to high flow). Both packs OFF and watch the cabin climb to the horn.');

  return { update(res) { X.update(res); O.update(res); P.update(res); } };
}

/** The overhead panels for this system — drawn in the schematic view and,
 *  as textures, in the 3D cockpit. */
export function panels(O, ctx) {
  // Bleed air controls.
  const B = O.panel('Bleed air', 358);
  B.band(0, 40);
  B.lamp(56, 11, 44, 20, 'DUAL\nBLEED', 'dualBleed');
  B.lamp(102, 11, 48, 20, 'RAM DOOR\nFULL OPEN', 'ramL', 'blue');
  B.lamp(196, 11, 48, 20, 'RAM DOOR\nFULL OPEN', 'ramR', 'blue');
  B.text(62, 54, 'L RECIRC FAN', { size: 7.5 });
  B.text(238, 54, 'R RECIRC FAN', { size: 7.5 });
  B.toggle(50, 84, 'recircL', ['OFF', 'AUTO']);
  B.toggle(250, 84, 'recircR', ['OFF', 'AUTO'], { labels: 'left' });
  ductPress(B, 160, 92, 33, (r) => r.values.ductL, (r) => r.values.ductR);
  B.push(214, 130, () => {}, { top: 'OVHT', bottom: 'TEST' });
  // Duct mimic: bleeds up the sides, across through the isolation valve.
  B.line([[50, 296], [50, 212], [250, 212], [250, 296]]);
  B.line([[150, 296], [150, 270], [50, 270]]);
  B.text(50, 148, 'L PACK', { size: 8, box: true });
  B.text(250, 148, 'R PACK', { size: 8, box: true });
  B.toggle(50, 184, 'packL', ['OFF', 'AUTO', 'HIGH']);
  B.toggle(250, 184, 'packR', ['OFF', 'AUTO', 'HIGH'], { labels: 'left' });
  B.text(150, 146, 'ISOLATION\nVALVE', { size: 7.5 });
  B.toggle(150, 184, 'iso', ['CLOSE', 'AUTO', 'OPEN']);
  for (const [x, side] of [[74, 'L'], [184, 'R']]) {
    const n = side === 'L' ? 1 : 2;
    B.lamp(x, 214, 42, 15, 'PACK', 'pack' + side);
    B.lamp(x, 230, 42, 18, 'WING-BODY\nOVERHEAT', 'wb' + side);
    B.lamp(x, 249, 42, 18, 'BLEED\nTRIP OFF', 'trip' + n);
  }
  B.push(150, 240, () => { ctx.fail.trip1 = false; ctx.fail.trip2 = false; ctx.fail.packL = false; ctx.fail.packR = false; ctx.set('bleed1', ctx.sw.bleed1); },
    { top: 'TRIP', bottom: 'RESET' });
  B.toggle(50, 300, 'bleed1', ['OFF', 'ON'], { name: '1' });
  B.toggle(150, 300, 'apuBleed', ['OFF', 'ON'], { name: 'APU' });
  B.toggle(250, 300, 'bleed2', ['OFF', 'ON'], { name: '2', labels: 'left' });
  B.text(150, 352, 'BLEED', { size: 8.5 });

  // Cabin pressurization panel.
  const C = O.panel('Cabin pressurization', 258);
  C.lamp(20, 12, 44, 20, 'AUTO\nFAIL', 'autoFail');
  C.lamp(66, 12, 44, 20, 'OFF SCHED\nDESCENT', null);
  C.lamp(190, 12, 44, 20, 'ALTN', 'altn', 'green');
  C.lamp(236, 12, 44, 20, 'MANUAL', 'manual', 'green');
  C.text(75, 50, 'AUTO', { size: 8 });
  C.lcd(35, 58, 80, (r) => String(r.values.fltAlt));
  C.text(75, 86, 'FLT ALT', { size: 7.5 });
  C.knob(75, 112, 'fltAltK', ['', ''], [0, 0], { action: true, noLabels: true, knurl: true, r: 13 });
  C.lcd(35, 140, 80, (r) => String(r.values.landAlt));
  C.text(75, 168, 'LAND ALT', { size: 7.5 });
  C.knob(75, 194, 'landAltK', ['', ''], [0, 0], { action: true, noLabels: true, knurl: true, r: 13 });
  C.text(220, 44, 'MANUAL', { size: 8 });
  valvePosition(C, 212, 92, 26, (r) => r.values.ofv);
  C.text(260, 66, 'V\nA\nL\nV\nE', { size: 7 });
  C.toggle(220, 146, 'ofvSw', ['CLOSE', '·', 'OPEN'], { horizontal: true, momentary: [0, 2] });
  C.text(220, 170, 'OUTFLOW VALVE', { size: 6.8 });
  C.knob(220, 214, 'mode', ['AUTO', 'ALTN', 'MAN'], [-50, 0, 50]);
  C.text(75, 240, 'tap knob: left −, right +', { size: 6.5 });

  // Cabin altitude panel.
  const CA = O.panel('Cabin altitude', 250);
  cabinAltDiff(CA, 112, 82, 62, (r) => r.values.cab / 1000, (r) => Number(r.values.diff));
  CA.text(66, 172, 'PRESS DIFF\nLIMIT:TAKE-\nOFF & LDG\n.125 PSI', { size: 6.6, box: true });
  cabinClimb(CA, 140, 206, 36, (r) => r.values.rate / 1000);
  CA.line([[222, 10], [222, 240]], 1.2);
  CA.text(258, 30, 'ALT\nHORN\nCUTOUT', { size: 8 });
  CA.push(258, 80, () => {});

  // Air temperature (trim air).
  const T = O.panel('Air temperature', 84);
  for (const [x, z] of [[40, 'CONT CAB'], [110, 'FWD CAB'], [180, 'AFT CAB']]) {
    T.lamp(x - 22, 12, 44, 18, 'ZONE\nTEMP', null);
    T.knob(x, 52, 'z' + x, ['', ''], [0, 0], { inert: true, noLabels: true, r: 10 });
    T.text(x, 78, z, { size: 6.5 });
  }
  T.toggle(260, 46, 'trim', ['OFF', 'ON'], { labels: 'left' });
  T.text(260, 80, 'TRIM AIR', { size: 6.5 });
}
