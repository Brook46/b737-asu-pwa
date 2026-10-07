// schem-warnings.js — who feeds the master caution, the configuration
// warnings and the GPWS / TCAS alerts; glareshield annunciators, GPWS panel,
// transponder and the aft overhead warning tests.

import { createSchematic, createPanel } from './schem-kit.js?v=29';
import { createOverhead } from './overhead.js?v=29';
import { SIXPACK, SCENARIOS } from './sys-warnings.js?v=29';

const C = '#e85d04', AMB = '#fab005', RED = '#e03131';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 660);
  X.onPart = ctx.onPart;
  const fire = (r) => ctx.resOf('fire')?.lights.fireWarn;
  const SRC = { hydraulics: 'HYD', flightcontrols: 'FLT CTRL', fms: 'IRS/NAV', warnings: 'WARN', fuel: 'FUEL', electrical: 'ELEC',
    engines: 'ENG/APU', fire: 'FIRE', antiice: 'ANTI-ICE', general: 'GENERAL', air: 'AIR' };
  // ── Glareshield, as the pilots see it: each pilot's FIRE WARN and MASTER
  // CAUTION outboard, that side's six-pack inboard, EFIS + MCP between. ──
  X.text(500, 22, 'GLARESHIELD', 't-small t-dim', 'middle');
  const sideGroup = (R) => {
    const x0 = R ? 640 : 20;
    X.el('rect', { x: x0, y: 34, width: 340, height: 104, rx: 6, class: 'box' }, X.svg.firstChild);
    X.text(x0 + 170, 154, R ? 'FIRST OFFICER' : 'CAPTAIN', 't-small t-dim', 'middle');
    const fx = R ? x0 + 268 : x0 + 12, mx = R ? x0 + 196 : x0 + 84;
    X.annun(fx, 50, 60, 60, 'FIRE\nWARN', fire, 'red', { part: 'master', big: true });
    X.annun(mx, 50, 60, 60, 'MASTER\nCAUTION', 'master', 'amber', { part: 'master', big: true });
    const six = SIXPACK.filter((p) => p[1] === (R ? 'R' : 'L'));
    six.forEach(([label], i) => {
      const x = (R ? x0 + 12 : x0 + 158) + Math.floor(i / 3) * 86, y = 50 + (i % 3) * 22;
      X.annun(x, y, 80, 18, label, 'sp_' + label, 'amber', { part: 'master' });
    });
    return six;
  };
  const sixL = sideGroup(false), sixR = sideGroup(true);
  // EFIS · MCP · EFIS between the two groups (shape only).
  X.el('rect', { x: 372, y: 52, width: 256, height: 64, rx: 4, class: 'box' }, X.svg.firstChild);
  X.text(500, 80, 'EFIS · MCP · EFIS', 't-small t-dim', 'middle');
  X.value(500, 100, (r) => ({ text: r.values.fresh ? `${r.values.fresh} new caution${r.values.fresh > 1 ? 's' : ''}` : 'no new cautions', cls: 't-small' + (r.values.fresh ? ' warn' : ' t-dim') }), '', 'middle');
  // ── What lights each annunciator: one line per light, its sources and
  // which of their cautions is on now. ──
  const feeds = (list, x0, R) => {
    X.text(x0, 186, 'FED BY', 't-small t-dim');
    list.forEach(([label, , srcs], i) => {
      const y = 206 + i * 34;
      X.annun(x0, y - 12, 74, 16, label, 'sp_' + label, 'amber', { part: 'master' });
      X.text(x0 + 82, y, srcs.map(([s]) => SRC[s] || s).join(' · '), 't-small t-dim');
      X.value(x0 + 82, y + 13, (r) => {
        const on = r.values.cautions.filter((c) => c.group === label).map((c) => c.id.split('.')[1]);
        return on.length ? { text: on.join(', ').slice(0, 30), cls: 't-small warn' } : '';
      }, '', 'start');
    });
  };
  feeds(sixL, 20, false);
  feeds(sixR, 680, true);
  // ── Configuration warnings (centre). ──
  X.text(500, 186, 'CONFIGURATION WARNINGS', 't-small t-dim', 'middle');
  X.unit(400, 196, 200, 30, 'PSEU', () => 'on', { color: C, part: 'config', small: true });
  X.annun(400, 238, 96, 30, 'TAKEOFF\nCONFIG', 'toConfig', 'red', { part: 'config' });
  X.annun(504, 238, 96, 30, 'CABIN\nALTITUDE', 'cabAlt', 'red', { part: 'config' });
  X.value(500, 286, (r) => ({ text: r.values.toWhy.join(' · '), cls: 't-small warn' }), '', 'middle');
  X.unit(400, 296, 200, 30, 'GEAR HORN', (r) => (r.values.gearHorn ? 'fault' : 'off'), { color: RED, part: 'config', small: true });
  X.text(500, 350, 'ALERTING', 't-small t-dim', 'middle');
  [['GPWS', 'gpws', 'gpws'], ['W/SHEAR', 'windshear', 'windshear'], ['TCAS', 'tcas', 'tcas'], ['STALL', 'stall', 'stall']].forEach(([n, u, part], i) => {
    X.unit(400 + (i % 2) * 104, 360 + Math.floor(i / 2) * 32, 96, 26, n, (r) => r.units[u], { color: C, part, small: true });
  });
  // ── What the pilots see and hear: PFD alerts and the aural queue. ──
  X.el('rect', { x: 20, y: 430, width: 960, height: 210, rx: 6, class: 'box' }, X.svg.firstChild);
  X.text(40, 452, 'PFD / ND ALERTS', 't-small t-dim');
  X.annun(40, 466, 130, 34, 'PULL UP', (r) => r.values.pullUp, 'red', { part: 'gpws', big: true });
  X.annun(180, 466, 130, 34, 'WINDSHEAR', (r) => r.values.windshear, 'red', { part: 'windshear', big: true });
  X.annun(40, 510, 130, 34, 'TERRAIN', (r) => r.values.terrain === 'red', 'red', { part: 'gpws', big: true });
  X.annun(180, 510, 130, 34, 'CAUTION\nTERRAIN', (r) => r.values.terrain && r.values.terrain !== 'red', 'amber', { part: 'gpws' });
  X.annun(40, 554, 130, 34, 'TRAFFIC', (r) => r.values.tcas === 'TA', 'amber', { part: 'tcas', big: true });
  X.annun(180, 554, 130, 34, 'TRAFFIC RA', (r) => r.values.tcas === 'RA', 'red', { part: 'tcas', big: true });
  X.text(380, 452, 'AURALS — highest priority first', 't-small t-dim');
  for (let i = 0; i < 6; i++) {
    X.value(380, 482 + i * 24, (r) => {
      const a = r.values.aurals[i];
      return a ? { text: `${i ? '  ' : '▶ '}${a[1]}`, cls: (i ? 't-small' : 't-big') + (a[0] === 'warning' ? ' warn' : '') } : (i ? '' : { text: 'silent', cls: 't-small t-dim' });
    }, '', 'start');
  }
  X.text(500, 656, 'Red: act now · amber: timely attention · blue: information · green: in position', 't-small t-dim', 'middle');

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
