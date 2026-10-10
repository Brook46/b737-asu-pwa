// schem-general.js — lights, signs, emergency lighting, doors and oxygen at
// a glance, with the lights, signs, oxygen, door and flight deck door panels.

import { createSchematic, createPanel } from './schem-kit.js?v=33';
import { createOverhead } from './overhead.js?v=33';
import { DOORS } from './sys-general.js?v=33';

const EXT = [['llL', 'L LANDING'], ['llR', 'R LANDING'], ['rtoL', 'L RWY TURNOFF'], ['rtoR', 'R RWY TURNOFF'], ['taxi', 'TAXI'], ['logo', 'LOGO'], ['beacon', 'ANTI COLLISION'], ['wingLt', 'WING'], ['wwLt', 'WHEEL WELL']];

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 660);
  X.onPart = ctx.onPart;
  // ── The airplane from above, nose up, to scale: each exterior light where
  // it is on the airplane, in its colour, lit or dark from its switch. ──
  X.text(20, 22, 'EXTERIOR LIGHTS & DOORS — seen from above', 't-small t-dim');
  const under = X.el('g', {}, X.svg.firstChild);            // beams, below the skin
  const AP = X.airplane(300, 70, 14);
  const top = X.el('g', {}, X.svg.children[1]);             // lights, above the skin
  const RED_ = '#ff3b30', GRN = '#3ad07a', WHT = '#ffffff', WARM = '#ffe2a0';
  const isOn = (k) => (k === 'pos' ? ctx.sw.pos === 0 || ctx.sw.pos === 2 : k === 'strobe' ? ctx.sw.pos === 0 : !!ctx.sw[k]);
  const gearDown = () => (ctx.resOf('gear')?.values.pos ?? 1) > 0.999;
  // A light: halo + dot; kind 'strobe' / 'beacon' blink.
  const light = (X0, z, key, color, o = {}) => {
    const [x, y] = AP(X0, z);
    const g = X.el('g', { class: 'hit' }, top);
    const halo = X.el('circle', { cx: x, cy: y, r: o.r ? o.r * 2.6 : 10, fill: color, opacity: 0 }, g);
    const dot = X.el('circle', { cx: x, cy: y, r: o.r || 4, class: 'lt', fill: color }, g);
    if (o.belly) dot.setAttribute('stroke-dasharray', '2 2');
    if (o.blink) { halo.classList.add('blink'); dot.classList.add('blink'); if (o.delay) { halo.style.animationDelay = dot.style.animationDelay = o.delay; } }
    g.addEventListener('click', () => X.onPart?.('lights'));
    X.bind(() => {
      const on = isOn(key) && (!o.gear || gearDown());
      halo.setAttribute('opacity', on ? 0.35 : 0);
      dot.setAttribute('class', on ? 'lt' + (o.blink ? ' blink' : '') : 'lt lt-off');
      dot.setAttribute('fill', on ? color : '#2b3138');
    });
  };
  // A beam: a wedge from the light out along dir (degrees from straight ahead, + = right).
  const beam = (X0, z, key, deg, len, spread, o = {}) => {
    const [x, y] = AP(X0, z);
    const a = (deg * Math.PI) / 180, w = (spread * Math.PI) / 180;
    const pt = (t) => [x + Math.sin(t) * len, y - Math.cos(t) * len];
    const [x1, y1] = pt(a - w), [x2, y2] = pt(a + w);
    const path = X.el('path', { d: `M${x},${y} L${x1},${y1} A${len},${len} 0 0 1 ${x2},${y2} Z`, fill: WARM, class: 'beam' }, under);
    X.bind(() => path.classList.toggle('on', isOn(key) && (!o.gear || gearDown())));
    if (o.label) {
      const [lx, ly] = pt(a);
      X.text(lx, ly + (o.dy || -4), o.label, 't-small t-dim halo', 'middle');
    }
  };
  for (const s of [-1, 1]) {
    // Fixed landing lights in the wing roots, straight ahead.
    beam(3.0, s * 3.15, s < 0 ? 'llL' : 'llR', s * 2, 200, 6, { label: s < 0 ? 'L LANDING' : 'R LANDING', dy: -6 });
    light(3.0, s * 3.15, s < 0 ? 'llL' : 'llR', WARM);
    // Runway turnoff lights, angled out.
    beam(3.4, s * 2.6, s < 0 ? 'rtoL' : 'rtoR', s * 42, 140, 9, { label: s < 0 ? 'L RWY TURNOFF' : 'R RWY TURNOFF' });
    light(3.4, s * 2.6, s < 0 ? 'rtoL' : 'rtoR', WARM, { r: 3 });
    // Wing (ice inspection) lights on the body, lighting the leading edge.
    beam(5.6, s * 1.95, 'wingLt', s * 118, 70, 8);
    light(5.6, s * 1.95, 'wingLt', WARM, { r: 3 });
    // Position: red left, green right; white aft at each tip. Strobes outboard.
    light(-4.4, s * 17.3, 'pos', s < 0 ? RED_ : GRN, { r: 4.5 });
    light(-5.8, s * 17.6, 'pos', WHT, { r: 3 });
    light(-5.0, s * 18.4, 'strobe', WHT, { r: 3.5, blink: true, delay: s < 0 ? '0s' : '.05s' });
    // Logo lights on the stabiliser, lighting the fin.
    light(-17.2, s * 2.4, 'logo', WARM, { r: 3 });
    // Wheel well lights.
    light(-2.6, s * 0.6, 'wwLt', WARM, { r: 3 });
  }
  // Tail: white position + strobe.
  light(-19.5, 0, 'pos', WHT, { r: 3 });
  light(-20.3, 0, 'strobe', WHT, { r: 3, blink: true, delay: '.1s' });
  // Anti-collision: top (solid) and belly (dashed), alternating.
  light(2.2, 0, 'beacon', RED_, { r: 4.5, blink: true });
  light(-1.0, 0, 'beacon', RED_, { r: 4.5, blink: true, belly: true, delay: '.55s' });
  // Taxi light on the nose gear strut — only with the gear down.
  beam(13.3, 0, 'taxi', 0, 100, 7, { gear: true, label: 'TAXI', dy: -6 });
  light(13.3, 0, 'taxi', WARM, { r: 3, gear: true });
  // Labels for the lights on the airplane.
  const lab = (X0, z, t, anchor = 'start') => { const [x, y] = AP(X0, z); X.text(x, y, t, 't-small t-dim halo', anchor); };
  lab(-7.4, -17.5, 'POSITION · STROBE', 'middle'); lab(-7.4, 17.5, 'POSITION · STROBE', 'middle');
  lab(2.2, 1.5, 'BEACON (top)'); lab(-1.0, 1.5, 'BEACON (belly)');
  lab(6.6, -2.2, 'WING', 'end'); lab(-2.6, -2.4, 'WHEEL WELL', 'end');
  lab(-16.7, 3.4, 'LOGO');
  // Doors on the outline: green closed, amber open.
  const half = (X0) => (X0 > -12 ? 1.88 : 1.88 - ((-12 - X0) / 5.5) * 0.78);
  const DOOR_AT = { fwdEntry: [14.4, -1], fwdSvc: [14.4, 1], aftEntry: [-13.6, -1], aftSvc: [-13.6, 1], fwdCargo: [8.5, 0.6], aftCargo: [-7.5, 0.6], equip: [11.5, 0] };
  for (const [k, n] of DOORS) {
    const [X0, side] = DOOR_AT[k];
    const g = X.el('g', { class: 'hit' }, top);
    g.addEventListener('click', () => X.onPart?.('doors'));
    let ln;
    if (side === 0) {
      const [x, y] = AP(X0, 0);
      ln = X.el('rect', { x: x - 5, y: y - 5, width: 10, height: 10, class: 'door', fill: 'none', 'stroke-dasharray': '2 2' }, g);
      X.text(x + 9, y + 3, n, 't-small t-dim halo', 'start', g);
    } else {
      const z = Math.sign(side) * (Math.abs(side) === 1 ? half(X0) : half(X0) * 0.6);
      const len = Math.abs(side) === 1 ? 0.55 : 0.9;
      const [x1, y1] = AP(X0 + len, z), [x2, y2] = AP(X0 - len, z);
      ln = X.el('line', { x1, y1, x2, y2, class: 'door' }, g);
      if (Math.abs(side) !== 1) ln.setAttribute('stroke-dasharray', '3 2');
      const [tx, ty] = AP(X0, z + Math.sign(side) * (Math.abs(side) === 1 ? 0.9 : 2.2));
      X.text(tx, ty + 3, n, 't-small t-dim halo', side < 0 ? 'end' : 'start', g);
    }
    X.bind((r) => ln.setAttribute('class', 'door ' + (r.values.open[k] ? 'open' : 'closed')));
  }
  // Overwing exits (two each side, over the wing), with their flight lock.
  for (const s of [-1, 1]) for (const X0 of [0.4, -0.6]) {
    const [x1, y1] = AP(X0 + 0.3, s * 1.88), [x2, y2] = AP(X0 - 0.3, s * 1.88);
    const ln = X.el('line', { x1, y1, x2, y2, class: 'door' }, top);
    X.bind((r) => ln.setAttribute('class', 'door ' + (r.lights['overwing' + (s < 0 ? 'L' : 'R')] ? 'open' : 'closed')));
  }
  // ── Right: the switches and what they do, signs, emergency, oxygen. ──
  const RX = 640;
  X.el('rect', { x: RX - 14, y: 34, width: 368, height: 250, rx: 6, class: 'box' }, X.svg.firstChild);
  X.text(RX, 54, 'EXTERIOR LIGHT SWITCHES', 't-small t-dim');
  const rows = [['L / R LANDING', () => [ctx.sw.llL, ctx.sw.llR]], ['L / R RWY TURNOFF', () => [ctx.sw.rtoL, ctx.sw.rtoR]], ['TAXI', () => [ctx.sw.taxi]],
    ['LOGO', () => [ctx.sw.logo]], ['POSITION', () => [ctx.sw.pos !== 1]], ['STROBE', () => [ctx.sw.pos === 0]],
    ['ANTI COLLISION', () => [ctx.sw.beacon]], ['WING', () => [ctx.sw.wingLt]], ['WHEEL WELL', () => [ctx.sw.wwLt]]];
  rows.forEach(([n, f], i) => {
    const y = 78 + i * 22;
    X.text(RX, y, n, 't-small');
    X.value(RX + 340, y, () => {
      const v = f();
      const t = v.map((x) => (x ? 'ON' : 'OFF')).join(' / ');
      return { text: t + (n === 'TAXI' && v[0] && !gearDown() ? ' (gear up)' : ''), cls: 't-small' + (v.some(Boolean) ? '' : ' t-dim') };
    }, '', 'end');
  });
  X.value(RX, 276, () => ({ text: `POSITION switch: ${['STROBE & STEADY', 'OFF', 'STEADY'][ctx.sw.pos]}`, cls: 't-small t-dim' }), '', 'start');
  // Signs and emergency lights, as the cabin shows them.
  X.annun(RX, 304, 108, 34, 'FASTEN\nBELTS', (r) => r.values.belts, 'amber', { part: 'signs' });
  X.annun(RX + 120, 304, 108, 34, 'EMERGENCY\nLIGHTS', (r) => r.values.emerOn, 'amber', { part: 'emergency' });
  X.annun(RX + 240, 304, 108, 34, 'PASS\nOXYGEN', (r) => r.values.dropped, 'amber', { part: 'oxygen' });
  X.value(RX + 54, 354, () => ({ text: `switch ${['OFF', 'AUTO', 'ON'][ctx.sw.belts]}`, cls: 't-small' }), '', 'middle');
  X.value(RX + 174, 354, (r) => ({ text: r.values.emerOn ? 'ON' : ['OFF — will NOT come on', 'ARMED', 'ON'][ctx.sw.exitLt], cls: 't-small' + (ctx.sw.exitLt !== 1 ? ' warn' : '') }), '', 'middle');
  X.value(RX + 294, 354, (r) => ({ text: r.values.dropped ? `MASKS DOWN ~${r.values.oxyLeft} min` : `cabin ${Math.round(r.values.cab)} ft`, cls: 't-small' + (r.values.dropped ? ' warn' : '') }), '', 'middle');
  X.text(RX, 384, 'FASTEN BELTS in AUTO: on with flaps or gear out', 't-small t-dim');
  X.text(RX, 400, 'Masks drop above about 14,000 ft cabin', 't-small t-dim');
  // Door summary.
  X.el('rect', { x: RX - 14, y: 420, width: 368, height: 120, rx: 6, class: 'box' }, X.svg.firstChild);
  X.text(RX, 440, 'DOORS', 't-small t-dim');
  X.value(RX + 340, 440, (r) => {
    const open = DOORS.filter(([k]) => r.values.open[k]).map(([, n]) => n);
    return { text: open.length ? `${open.length} open` : 'all closed', cls: 't-small' + (open.length ? ' warn' : '') };
  }, '', 'end');
  DOORS.forEach(([k, n], i) => {
    const x = RX + (i % 2) * 176, y = 462 + Math.floor(i / 2) * 18;
    X.value(x, y, (r) => ({ text: `${r.values.open[k] ? '■' : '□'} ${n}`, cls: 't-small' + (r.values.open[k] ? ' warn' : '') }), '', 'start');
  });
  X.value(RX, 560, (r) => ({ text: `Overwing exit flight locks: ${r.values.flightLock ? 'LOCKED' : 'unlocked'}`, cls: 't-small' }), '', 'start');
  X.text(RX, 578, 'Lock with 3 of 4 entry/service doors closed, an engine', 't-small t-dim');
  X.text(RX, 592, 'running, and airborne or thrust levers advanced', 't-small t-dim');
  X.text(300, 652, 'Green: closed · amber: open · lights glow in their colour when on', 't-small t-dim', 'middle');

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
