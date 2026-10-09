// schem-fms.js — position sources → FMC → LNAV/VNAV, IRS → displays, with
// the IRS mode select unit, instrument transfer switches, nav radios and a
// small CDU.

import { createSchematic, createPanel } from './schem-kit.js?v=30';
import { createOverhead } from './overhead.js?v=30';

const C = '#06d6a0', IRS = '#20c997', RAD = '#74c0fc';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 640);
  X.onPart = ctx.onPart;
  // Sources.
  X.unit(40, 40, 170, 44, 'GPS 1 · 2', (r) => r.units.gps, { color: C, part: 'gps' });
  X.unit(40, 120, 170, 44, 'DME · VOR · ILS', (r) => r.units.radios, { color: RAD, part: 'radios' });
  for (const [s, y] of [['L', 220], ['R', 320]]) {
    X.unit(40, y, 170, 60, `IRS ${s}`, (r) => (r.values.irs[s].failed ? 'fault' : r.values.irs[s].nav ? 'on' : r.values.irs[s].aligning ? 'fault' : 'off'), { color: IRS, part: 'irs' });
    X.value(125, y + 80, (r) => {
      const i = r.values.irs[s];
      return { text: i.failed ? 'FAULT' : i.aligning ? `ALIGN · ${i.left} min${i.flash ? ' · ENTER POS' : ''}` : i.nav ? 'NAV' : r.values.irsPos[i.mode], cls: 't-small' + (i.flash || i.failed ? ' warn' : '') };
    });
  }
  X.pipe([[210, 62], [420, 62], [420, 200]], 'gpsF', { color: C });
  X.pipe([[210, 142], [400, 142], [400, 200]], 'radF', { color: RAD });
  X.pipe([[210, 250], [380, 250], [380, 230]], 'irsF', { color: IRS, thin: true });
  X.pipe([[210, 350], [440, 350], [440, 230]], 'irsF', { color: IRS, thin: true });
  X.unit(360, 200, 120, 30, 'FMC', () => 'on', { color: C, part: 'fmc', small: true });
  X.value(420, 186, (r) => ({ text: `position: ${r.values.posSrc} · ANP ${r.values.anp < 10 ? r.values.anp.toFixed(2) : '—'}`, cls: 't-small' + (r.values.posSrc === 'NO POSITION' ? ' warn' : '') }));
  X.pipe([[480, 215], [600, 215]], () => true, { color: C, still: true });
  X.unit(600, 190, 180, 50, 'LNAV · VNAV · A/T', () => 'on', { color: '#9b5de5', part: 'fmc', small: true });
  // IRS → displays via the transfer switch.
  for (const [who, y, k] of [['CAPT ATTITUDE', 440, 'attCapt'], ['F/O ATTITUDE', 520, 'attFo']]) {
    X.unit(600, y, 200, 46, who, (r) => (r.values[k] ? 'on' : 'fault'), { color: '#8338ec', part: 'irs', small: true });
    X.value(700, y + 64, (r) => ({ text: r.values[k] ? `from IRS ${k === 'attCapt' ? r.values.src.L : r.values.src.R}` : 'ATT FLAG', cls: 't-small' + (r.values[k] ? '' : ' warn') }));
  }
  X.pipe([[210, 380], [500, 380], [500, 463], [600, 463]], (r) => r.values.irs[r.values.src.L].att, { color: IRS, thin: true });
  X.pipe([[210, 360], [520, 360], [520, 543], [600, 543]], (r) => r.values.irs[r.values.src.R].att, { color: IRS, thin: true });
  X.text(500, 620, 'FMC position: GPS first, radio too, IRS alone if both are lost', 't-small t-dim', 'middle');

  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);
  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('INSTRUCTOR · CDU & FAILURES');
  P.actions(P.push('OPEN THE CDU (FMC)', () => ctx.openCdu?.()), P.push('COLD AIRPLANE (IRS OFF)', () => ctx.action('coldStart')), P.push('CDU: ENTER POS INIT', () => ctx.action('enterPos')));
  P.actions(P.fail('IRS L fault', 'irsL'), P.fail('IRS R fault', 'irsR'), P.fail('Both GPS', 'gps'), P.fail('Radio updating', 'radio'), P.fail('ILS receivers', 'ils'), P.fail('AC lost (IRS on DC)', 'acLost'), P.fail('FMC alert', 'fmcAlert'));
  P.actions(P.push('RESET TO NORMAL', ctx.reset));
  P.note('<b>Fly a route:</b> open the CDU — POS INIT (ref airport, SET IRS POS), RTE (origin, destination, runway, ACTIVATE, EXEC), LEGS (type waypoints: navaids, airports, N32E034, BGN270/20), DEP ARR (arrival runway), PERF INIT (ZFW, cruise altitude), TAKEOFF REF. Then in the Cockpit view: LINE UP, TO/GA; the ND and FMA follow. On the <b>Ground</b>: cold airplane, then turn both IRS selectors to NAV. ALIGN counts down (fast). Don\'t enter the position and ALIGN flashes at the end — ENTER POS INIT. In <b>Cruise</b>: fail both GPS then radio — the FMC falls back to IRS only and ANP grows; fail IRS L and use the IRS transfer.');
  return { update(res) { X.update(res); O.update(res); P.update(res); } };
}

export function panels(O, ctx) {
  const M = O.panel('IRS mode select', 92);
  M.text(150, 10, 'IRS', { size: 8 });
  for (const [s, x] of [['L', 75], ['R', 225]]) {
    M.lamp(x - 50, 16, 46, 14, 'ALIGN', `align${s}`, 'white');
    M.lamp(x + 4, 16, 46, 14, 'ON DC', `onDc${s}`);
    M.lamp(x - 50, 32, 46, 14, 'FAULT', `fault${s}`);
    M.lamp(x + 4, 32, 46, 14, 'DC FAIL', `dcFail${s}`);
    M.knob(x, 70, `irs${s}`, ['OFF', 'ALIGN', 'NAV', 'ATT'], [-70, -25, 20, 65], { r: 11, name: s, nameDy: 10 });
  }
  M.lamp(132, 36, 36, 14, 'GPS', 'gps');
  M.lamp(132, 54, 36, 14, 'ILS', 'ils');
  const T = O.panel('Instrument transfer', 64);
  T.knob(55, 34, 'vhfX', ['BOTH ON 1', 'NORMAL', 'BOTH ON 2'], [-50, 0, 50], { name: 'VHF NAV', r: 10, nameDy: 12 });
  T.knob(150, 34, 'irsX', ['BOTH ON L', 'NORMAL', 'BOTH ON R'], [-50, 0, 50], { name: 'IRS', r: 10, nameDy: 12 });
  T.knob(245, 34, 'fmcX', ['BOTH ON L', 'NORMAL', 'BOTH ON R'], [-50, 0, 50], { name: 'FMC', r: 10, nameDy: 12 });
  const N = O.panel('Nav radios', 56);
  N.text(150, 10, 'VHF NAV 1 · 2', { size: 8 });
  N.lcd(14, 18, 62, () => '110.30', { h: 16, size: 11 }); N.lcd(80, 18, 62, () => '116.80', { h: 16, size: 11 });
  N.lcd(158, 18, 62, () => '110.30', { h: 16, size: 11 }); N.lcd(224, 18, 62, () => '113.40', { h: 16, size: 11 });
  N.text(45, 48, 'ACTIVE', { size: 6 }); N.text(111, 48, 'STBY', { size: 6 }); N.text(189, 48, 'ACTIVE', { size: 6 }); N.text(255, 48, 'STBY', { size: 6 });
  const D = O.panel('CDU', 120);
  for (let i = 0; i < 5; i++) D.lcd(14, 8 + i * 18, 272, (r) => r.values.cdu[i] || '', { h: 16, size: 10 });
  D.lamp(14, 100, 40, 14, 'FMC', 'fmcAlert');
  D.push(270, 106, () => ctx.action('enterPos'), { name: 'EXEC (POS INIT)' });
  D.text(200, 110, 'EXEC POS INIT', { size: 6.5 });
}
