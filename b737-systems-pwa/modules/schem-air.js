// schem-air.js — operable bleed / packs / pressurisation schematic + panel.

import { createSchematic, createPanel } from './schem-kit.js?v=1';

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

  // ── Panel ──
  const P = createPanel(panelHost, ctx);
  P.title('AIR CONDITIONING');
  P.row(P.lamp('PACK', 'packL'), P.lamp('RAM DOOR\nFULL OPEN', 'ramL', 'blue'), P.lamp('RAM DOOR\nFULL OPEN', 'ramR', 'blue'), P.lamp('PACK', 'packR'));
  P.row(P.toggle('L PACK', 'packL', ['OFF', 'AUTO', 'HIGH']), P.toggle('ISOLATION', 'iso', ['CLOSE', 'AUTO', 'OPEN']),
    P.toggle('R PACK', 'packR', ['OFF', 'AUTO', 'HIGH']));
  P.row(P.toggle('L RECIRC', 'recircL', ['OFF', 'AUTO']), P.toggle('TRIM AIR', 'trim', ['OFF', 'ON']), P.toggle('R RECIRC', 'recircR', ['OFF', 'AUTO']));
  P.title('BLEED');
  P.row(P.lamp('DUAL\nBLEED', 'dualBleed'), P.readout((r) => `${r.values.ductL}·${r.values.ductR}`, 'DUCT PRESS L·R'));
  P.row(P.lamp('WING-BODY\nOVERHEAT', 'wbL'), P.lamp('BLEED TRIP\nOFF', 'trip1'), P.lamp('BLEED TRIP\nOFF', 'trip2'), P.lamp('WING-BODY\nOVERHEAT', 'wbR'));
  P.row(P.toggle('BLEED 1', 'bleed1', ['OFF', 'ON']), P.toggle('APU', 'apuBleed', ['OFF', 'ON']), P.toggle('BLEED 2', 'bleed2', ['OFF', 'ON']));
  P.actions(P.push('TRIP RESET', () => { ctx.fail.trip1 = false; ctx.fail.trip2 = false; ctx.fail.packL = false; ctx.fail.packR = false; ctx.set('bleed1', ctx.sw.bleed1); }));
  P.title('PRESSURIZATION');
  P.row(P.lamp('AUTO\nFAIL', 'autoFail'), P.lamp('ALTN', 'altn', 'green'), P.lamp('MANUAL', 'manual', 'green'), P.lamp('CABIN\nALT HORN', 'horn'));
  P.row(P.readout((r) => `${(r.values.cab / 1000).toFixed(1)}<small>k ft</small>`, 'CABIN ALT'), P.readout((r) => `${r.values.diff}<small>psi</small>`, 'DIFF'),
    P.readout((r) => `${r.values.rate}<small>fpm</small>`, 'RATE'));
  P.row(P.readout((r) => `${(r.values.fltAlt / 1000).toFixed(0)}<small>k</small>`, 'FLT ALT'), P.readout((r) => `${r.values.landAlt}`, 'LAND ALT'),
    P.readout((r) => `${r.values.ofv}<small>%</small>`, 'OUTFLOW VLV'));
  P.row(P.rotary('MODE', 'mode', ['AUTO', 'ALTN', 'MAN'], [-50, 0, 50]),
    P.toggle('OUTFLOW', 'ofvSw', ['CLOSE', '·', 'OPEN'], { momentary: [0, 2] }));
  P.note('Outflow valve switch works in MAN only. A small movement makes a big rate.');
  P.title('FAILURES');
  P.actions(P.fail('ENG 2 fail', 'eng2'), P.fail('Bleed trip 1', 'trip1'), P.fail('L pack trip', 'packL'), P.fail('Wing-body ovht L', 'wbL'),
    P.fail('Controller 1', 'ctrl1'), P.fail('Controller 2', 'ctrl2'));
  P.actions(P.push('RESET TO NORMAL', ctx.reset));
  P.note('Try: Cruise → <b>L pack trip</b> (the right pack goes to high flow by itself; flaps up). Both packs OFF and watch the cabin climb to the horn. MAN mode → drive the outflow valve yourself. Ground → DUAL BLEED is normal with the APU bleed on.');

  return { update(res) { X.update(res); P.update(res); } };
}
