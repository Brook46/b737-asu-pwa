// schem-warnings.js — who feeds the master caution, the configuration
// warnings and the GPWS / TCAS alerts; glareshield annunciators, GPWS panel,
// transponder and the aft overhead warning tests.

import { createSchematic, createPanel } from './schem-kit.js?v=27';
import { createOverhead } from './overhead.js?v=27';
import { SIXPACK, SCENARIOS } from './sys-warnings.js?v=27';

const C = '#e85d04', AMB = '#fab005', RED = '#e03131';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 640);
  X.onPart = ctx.onPart;
  // Six-pack sources on the left, master caution in the middle.
  X.text(30, 26, 'SYSTEM ANNUNCIATORS', 't-small t-dim');
  SIXPACK.forEach(([label], i) => {
    const y = 40 + i * 44;
    X.unit(30, y, 150, 34, label, (r) => (r.lights['sp_' + label] ? 'fault' : 'off'), { color: AMB, part: 'master', small: true });
    X.pipe([[180, y + 17], [260, y + 17], [260, 300]], (r) => !!r.lights['sp_' + label], { color: AMB, thin: true });
  });
  X.unit(270, 270, 160, 60, 'MASTER CAUTION', (r) => (r.lights.master ? 'fault' : 'off'), { color: AMB, part: 'master' });
  X.value(350, 350, (r) => ({ text: r.values.fresh ? `${r.values.fresh} new caution${r.values.fresh > 1 ? 's' : ''}` : 'no new cautions', cls: 't-small' + (r.values.fresh ? ' warn' : '') }));
  X.value(350, 372, (r) => ({ text: r.values.cautions.length ? `${r.values.cautions.length} active (recall shows all)` : '', cls: 't-small t-dim' }));
  // Configuration warnings.
  X.unit(480, 40, 220, 44, 'PSEU', () => 'on', { color: C, part: 'config' });
  X.unit(480, 110, 220, 40, 'TAKEOFF CONFIG', (r) => (r.lights.toConfig ? 'fault' : 'off'), { color: RED, part: 'config', small: true });
  X.value(590, 168, (r) => ({ text: r.values.toWhy.join(' · '), cls: 't-small warn' }));
  X.unit(480, 180, 220, 40, 'CABIN ALTITUDE', (r) => (r.lights.cabAlt ? 'fault' : 'off'), { color: RED, part: 'config', small: true });
  X.unit(480, 240, 220, 40, 'GEAR HORN', (r) => (r.values.gearHorn ? 'fault' : 'off'), { color: RED, part: 'config', small: true });
  // GPWS / windshear / TCAS.
  X.unit(760, 40, 200, 44, 'GPWS / EGPWS', (r) => r.units.gpws, { color: C, part: 'gpws' });
  X.unit(760, 110, 200, 40, 'WINDSHEAR', (r) => r.units.windshear, { color: C, part: 'windshear', small: true });
  X.unit(760, 170, 200, 40, 'TCAS', (r) => r.units.tcas, { color: C, part: 'tcas', small: true });
  X.unit(760, 230, 200, 40, 'SMYD · CLACKER', (r) => r.units.stall, { color: C, part: 'stall', small: true });
  // Aural priority list.
  X.text(480, 330, 'AURALS (highest priority first)', 't-small t-dim');
  for (let i = 0; i < 5; i++) {
    X.value(480, 356 + i * 22, (r) => {
      const a = r.values.aurals[i];
      return a ? { text: `${i ? '' : '▶ '}${a[1]}`, cls: (i ? 't-small' : 't-big') + (a[0] === 'warning' ? ' warn' : '') } : '';
    }, '', 'start');
  }
  X.value(500, 500, (r) => ({ text: r.values.pullUp ? 'PULL UP' : '', cls: 't-big warn' }));
  X.value(700, 500, (r) => ({ text: r.values.windshear ? 'WINDSHEAR' : r.values.terrain ? (r.values.terrain === 'red' ? 'TERRAIN' : 'CAUTION TERRAIN') : '', cls: 't-big warn' }));
  X.value(880, 500, (r) => ({ text: r.values.tcas ? (r.values.tcas === 'RA' ? 'TRAFFIC (RA)' : 'TRAFFIC') : '', cls: 't-big' + (r.values.tcas === 'RA' ? ' warn' : '') }));
  X.text(500, 610, 'Red: act now · amber: timely attention · blue: information · green: in position', 't-small t-dim', 'middle');

  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);
  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('INSTRUCTOR · SCENARIOS');
  P.actions(...SCENARIOS.map(([k, n]) => {
    const b = P.push(n, () => ctx.action('scen', k));
    return b;
  }));
  P.actions(P.push('ADVANCE / RETARD THRUST (ground)', () => ctx.action('advance')), P.fail('Stab out of green band', 'stab'),
    P.fail('IRS fault', 'irs'), P.fail('PSEU fault', 'pseu'), P.fail('GPWS inop', 'gpwsInop'));
  P.actions(P.push('🔊 HEAR TOP AURAL', () => {
    const r = ctx.resOf('warnings');
    const t = r?.values.top;
    if (t && window.speechSynthesis) { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(t.replace(/—/g, ',').replace(/\(.*\)/, ''))); }
  }), P.push('RESET TO NORMAL', ctx.reset));
  P.note('On the <b>Ground</b>: <b>Advance thrust</b> with the flaps up — horn + TAKEOFF CONFIG. In <b>Takeoff</b>: try <b>Too low (config)</b>, then GEAR INHIBIT. Fail something in another system (e.g. Hydraulics A pump) and watch MASTER CAUTION + HYD; push MASTER CAUTION to reset, the annunciator to recall.');
  return { update(res) { X.update(res); O.update(res); P.update(res); } };
}

export function panels(O, ctx) {
  // Glareshield: FIRE WARN, MASTER CAUTION and the six system annunciators, each side.
  const fire = () => ctx.resOf('fire')?.lights.fireWarn;
  for (const side of ['L', 'R']) {
    // Black end panel of the glareshield: FIRE WARN outboard, MASTER CAUTION,
    // then the six-pack (two columns of three) toward the EFIS panel.
    const A = O.panel(`Annunciator ${side}`, 110, { bg: '#16181a' });
    const R = side === 'R';
    const fx = R ? 238 : 8, mx = R ? 182 : 64;
    A.capLight(fx, 22, 54, 54, 'FIRE\nWARN', 'BELL CUTOUT', fire, 'red', () => ctx.ctxOf('fire').action('bell'));
    A.capLight(mx, 22, 54, 54, 'MASTER\nCAUTION', 'PUSH TO RESET', 'master', 'amber', () => ctx.action('mc'));
    const six = SIXPACK.filter((s) => s[1] === side);
    six.forEach(([label], i) => {
      // Column by column, as on the glareshield: FLT CONT / IRS / FUEL, then ELEC / APU / OVHT·DET.
      const x = (R ? 8 : 128) + Math.floor(i / 3) * 84, y = 22 + (i % 3) * 22;
      A.lamp(x, y, 80, 19, label, 'sp_' + label, 'amber', 'warnings', () => ctx.action('recall'));
    });
  }
  const G = O.panel('GPWS', 92);
  G.text(150, 10, 'GROUND PROXIMITY', { size: 8 });
  G.lamp(14, 20, 56, 26, 'BELOW G/S\nP-INHIBIT', 'belowGs', 'amber', 'warnings', () => ctx.action('gsCancel'));
  G.lamp(14, 54, 56, 16, 'INOP', 'gpwsInop');
  G.push(100, 40, () => {}, { bottom: 'SYS TEST', name: 'SYS TEST' });
  G.toggle(160, 50, 'flapInh', ['NORM', 'FLAP INHIBIT'], { guard: 'red', guardPos: 0, name: 'FLAP', nameBox: false });
  G.toggle(210, 50, 'gearInh', ['NORM', 'GEAR INHIBIT'], { guard: 'red', guardPos: 0, name: 'GEAR', nameBox: false });
  G.toggle(260, 50, 'terrInh', ['NORM', 'TERR INHIBIT'], { guard: 'red', guardPos: 0, name: 'TERR', nameBox: false });
  const T = O.panel('Takeoff config and cabin altitude', 40);
  T.lamp(20, 8, 120, 24, 'TAKEOFF\nCONFIG', 'toConfig', 'red');
  T.lamp(160, 8, 120, 24, 'CABIN\nALTITUDE', 'cabAlt', 'red');
  const X = O.panel('Transponder', 80);
  X.text(150, 10, 'ATC / TCAS', { size: 8 });
  X.lcd(110, 18, 80, () => '2000', { h: 18, size: 13 });
  X.knob(60, 50, 'xpdr', ['STBY', 'ALT OFF', 'XPNDR', 'TA ONLY', 'TA/RA'], [-90, -45, 0, 45, 90], { name: 'MODE', r: 12, nameDy: 14 });
  X.knob(240, 50, 'range', ['ABV', 'N', 'BLW'], [-45, 0, 45], { name: 'RANGE', r: 11, nameDy: 14 });
  const W = O.panel('Warning tests', 70);
  W.push(40, 30, () => {}, { top: 'MACH AIRSPEED', bottom: '1', name: 'MACH AIRSPEED WARNING TEST 1' });
  W.push(80, 30, () => {}, { bottom: '2', name: 'MACH AIRSPEED WARNING TEST 2' });
  W.push(140, 30, () => {}, { top: 'STALL WARNING', bottom: '1', name: 'STALL WARNING TEST 1' });
  W.push(180, 30, () => {}, { bottom: '2', name: 'STALL WARNING TEST 2' });
  W.lamp(214, 10, 36, 16, 'PSEU', 'pseu');
  W.push(262, 36, () => ctx.action('hornCut'), { top: 'GEAR HORN', bottom: 'CUTOUT', name: 'LANDING GEAR WARNING CUTOUT' });
}
