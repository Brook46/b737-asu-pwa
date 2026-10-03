// schem-hydraulics.js — operable A / B / standby schematic + hydraulic panel.

import { createSchematic, createPanel } from './schem-kit.js?v=1';

const A = '#2f7cf6', B = '#12a874', S = '#f2711c';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 660);
  X.onPart = ctx.onPart;
  const xA = 170, xS = 500, xB = 830;

  // ── Reservoirs ──
  const qty = (k) => (r) => ({ text: `${r.values[k]}%`, cls: 't-big' + (r.values[k] < 50 ? ' warn' : '') });
  X.tank(xA - 70, 30, 140, 100, 'SYS A RESERVOIR', 'fA', { color: A, part: 'resA' });
  X.tank(xS - 50, 40, 100, 80, 'STANDBY', 'fS', { color: S, part: 'resS' });
  X.tank(xB - 70, 30, 140, 100, 'SYS B RESERVOIR', 'fB', { color: B, part: 'resB' });
  X.value(xA, 118, qty('qtyA'));
  X.value(xS, 110, qty('qtyS'));
  X.value(xB, 118, qty('qtyB'));
  X.pipe([[xB - 70, 70], [xS + 50, 70]], () => true, { thin: true, color: B, still: true });
  X.text((xS + xB) / 2 - 20, 62, 'pressurisation / servicing', 't-small t-dim', 'middle');

  // ── Pumps ──
  const pumps = [
    { x: xA - 60, label: 'EDP\nENG 1', key: 'A_edp', unit: 'edp1', c: A, part: 'edp1' },
    { x: xA + 60, label: 'EMDP\nELEC 2', key: 'A_emdp', unit: 'emdpA', c: A, part: 'emdpA' },
    { x: xB - 60, label: 'EMDP\nELEC 1', key: 'B_emdp', unit: 'emdpB', c: B, part: 'emdpB' },
    { x: xB + 60, label: 'EDP\nENG 2', key: 'B_edp', unit: 'edp2', c: B, part: 'edp2' },
  ];
  for (const p of pumps) {
    X.pipe([[p.x, 130], [p.x, 200]], (r) => r.values[p.c === A ? 'qtyA' : 'qtyB'] > 0.5, { thin: true, color: p.c, still: true });
    X.pipe([[p.x, 250], [p.x, 300]], p.key, { color: p.c });
    X.unit(p.x - 42, 200, 84, 50, p.label, p.unit, { color: p.c, part: p.part, small: true });
  }
  X.unit(xS - 42, 200, 84, 50, 'STBY\nPUMP', 'stby', { color: S, part: 'stby', small: true });
  X.pipe([[xS, 120], [xS, 200]], () => true, { thin: true, color: S, still: true });

  // ── Manifolds + pressure readouts ──
  X.pipe([[xA - 90, 300], [xA + 90, 300]], 'A', { color: A });
  X.pipe([[xB - 90, 300], [xB + 90, 300]], 'B', { color: B });
  const press = (k) => (r) => ({ text: `${r.values[k]} psi`, cls: r.values[k] > 2000 ? '' : 'warn' });
  X.value(xA, 290, press('pressA'));
  X.value(xB, 290, press('pressB'));
  X.text(xA - 92, 296, 'A', 't-big', 'end');
  X.text(xB + 92, 296, 'B', 't-big', 'start');

  // ── Flight controls (ailerons, elevators, feel, rudder) via FC shutoff valves ──
  X.pipe([[xA, 300], [xA, 390]], 'Afc', { color: A });
  X.pipe([[xB, 300], [xB, 390]], 'Bfc', { color: B });
  X.valve(xA, 345, (r) => ctx.sw.fcA === 2, { vertical: true, label: 'FLT CONTROL A', lx: 66, ly: 4 });
  X.valve(xB, 345, (r) => ctx.sw.fcB === 2, { vertical: true, label: 'FLT CONTROL B', lx: -66, ly: 4 });
  X.unit(xA - 120, 390, 240, 40, 'AILERONS · ELEVATORS · RUDDER', (r) => (r.users.Afc ? 'on' : 'off'), { color: A, part: 'fltctl', small: true });
  X.unit(xB - 120, 390, 240, 40, 'AILERONS · ELEVATORS · RUDDER', (r) => (r.users.Bfc ? 'on' : 'off'), { color: B, part: 'fltctl', small: true });

  // ── Other users ──
  const list = (x, y, items, color, live) => {
    items.forEach(([t, part, fn], i) => {
      X.unit(x, y + i * 30, 240, 24, t, (r) => ((fn ? fn(r) : live(r)) ? 'on' : 'off'), { color, part, small: true });
    });
  };
  X.pipe([[xA + 90, 300], [xA + 140, 300], [xA + 140, 455], [xA + 120, 455]], 'A', { color: A, thin: true });
  list(xA - 120, 445, [
    ['FLT SPOILERS 2,4,9,11 · GND SPOILERS', 'fltctl'],
    ['LANDING GEAR · NOSE STEERING', 'gear'],
    ['ALTERNATE BRAKES', 'gear'],
    ['No. 1 REVERSER · AUTOPILOT A', 'revs'],
  ], A, (r) => r.users.A);
  X.pipe([[xB - 90, 300], [xB - 140, 300], [xB - 140, 455], [xB - 120, 455]], 'B', { color: B, thin: true });
  list(xB - 120, 445, [
    ['FLT SPOILERS 3,5,8,10 · YAW DAMPER', 'fltctl'],
    ['LE FLAPS & SLATS · AUTOSLATS', 'ptu', (r) => r.users.Ble],
    ['TE FLAPS · NORMAL BRAKES', 'gear'],
    ['No. 2 REVERSER · AUTOPILOT B', 'revs'],
  ], B, (r) => r.users.B);

  // ── Standby: rudder valve, reversers, LE devices (extend only) ──
  X.pipe([[xS, 250], [xS, 520]], (r) => r.users.S, { color: S });
  X.valve(xS, 330, (r) => r.users.Srud, { vertical: true, label: 'STBY RUDDER', lx: 0, ly: 26 });
  X.unit(xS - 70, 380, 140, 30, 'STBY RUDDER PCU', (r) => (r.users.Srud ? 'on' : 'off'), { color: S, part: 'rudder', small: true });
  X.pipe([[xS, 330], [xS - 22, 330]], 'S_rud', { color: S, thin: true });
  X.unit(xS - 70, 450, 140, 26, 'REVERSERS 1 & 2', (r) => (r.users.S ? 'on' : 'off'), { color: S, part: 'revs', small: true });
  X.unit(xS - 70, 490, 140, 26, 'LE DEVICES (EXT)', (r) => (r.users.Sle ? 'on' : 'off'), { color: S, part: 'stby', small: true });

  // ── PTU and gear transfer valve ──
  X.unit(xS + 95, 560, 110, 40, 'PTU', 'ptu', { color: B, part: 'ptu' });
  X.pipe([[xA, 430], [xA, 432]], 'ptu', { color: A, thin: true });
  X.pipe([[xA + 140, 455], [xA + 140, 580], [xS + 95, 580]], 'ptu', { color: A, thin: true });
  X.pipe([[xS + 205, 580], [xB - 140, 580], [xB - 140, 482], [xB - 120, 482]], 'ptu', { color: B, thin: true });
  X.text(xS + 150, 618, 'A drives B fluid → LE devices', 't-small t-dim', 'middle');
  X.unit(xA - 120, 575, 150, 34, 'GEAR XFR VALVE', 'lgtv', { color: B, part: 'lgtv', small: true });
  X.pipe([[xB + 90, 300], [xB + 140, 300], [xB + 140, 640], [xA - 45, 640], [xA - 45, 609]], 'lgtv', { color: B, thin: true });

  // ── Engine state captions ──
  X.value(xA - 60, 190, (r) => ({ text: r.env.eng1 ? 'ENG 1 RUN' : 'ENG 1 OFF', cls: 't-small' + (r.env.eng1 ? '' : ' t-dim') }));
  X.value(xB + 60, 190, (r) => ({ text: r.env.eng2 ? 'ENG 2 RUN' : 'ENG 2 OFF', cls: 't-small' + (r.env.eng2 ? '' : ' t-dim') }));

  // ── Panel ──
  const P = createPanel(panelHost, ctx);
  P.title('HYD PUMPS');
  P.row(P.lamp('OVERHEAT', 'ovhtElec2'), P.lamp('OVERHEAT', 'ovhtElec1'));
  P.row(P.lamp('LOW\nPRESSURE', 'lpEng1'), P.lamp('LOW\nPRESSURE', 'lpElec2'), P.lamp('LOW\nPRESSURE', 'lpElec1'), P.lamp('LOW\nPRESSURE', 'lpEng2'));
  P.row(P.toggle('ENG 1', 'eng1', ['OFF', 'ON']), P.toggle('ELEC 2', 'elec2', ['OFF', 'ON']),
    P.toggle('ELEC 1', 'elec1', ['OFF', 'ON']), P.toggle('ENG 2', 'eng2', ['OFF', 'ON']));
  P.note('Left pair is system <b>A</b> (ENG 1, ELEC 2); right pair is <b>B</b> (ELEC 1, ENG 2).');
  P.title('FLT CONTROL · STANDBY HYD');
  P.row(P.lamp('A\nLOW PRESS', 'fcLpA'), P.lamp('B\nLOW PRESS', 'fcLpB'), P.lamp('STBY\nLOW QTY', 'stbyLowQty'), P.lamp('STBY\nLOW PRESS', 'stbyLowPress'));
  P.row(P.toggle('FLT CTL A', 'fcA', ['STBY RUD', 'OFF', 'ON'], { guard: true }),
    P.toggle('FLT CTL B', 'fcB', ['STBY RUD', 'OFF', 'ON'], { guard: true }),
    P.toggle('ALT FLAPS', 'altFlaps', ['OFF', 'ARM'], { guard: true }));
  P.row(P.lamp('STBY RUD\nON', 'stbyRudOn'));
  P.title('SYS PAGE');
  P.row(P.readout((r) => `${r.values.pressA}<small>psi</small>`, 'A PRESS'), P.readout((r) => `${r.values.pressB}<small>psi</small>`, 'B PRESS'));
  P.row(P.readout((r) => `${r.values.qtyA}<small>%${r.values.rfA ? ' RF' : ''}</small>`, 'A QTY'),
    P.readout((r) => `${r.values.qtyB}<small>%${r.values.rfB ? ' RF' : ''}</small>`, 'B QTY'));
  P.title('FAILURES');
  P.actions(P.fail('ENG 1 fail', 'eng1'), P.fail('ENG 2 fail', 'eng2'), P.fail('A leak · EDP side', 'leakAedp'),
    P.fail('A leak · common', 'leakAcom'), P.fail('B leak', 'leakB'), P.fail('STBY leak', 'leakS'), P.fail('ELEC 2 overheat', 'ovhtA'));
  P.actions(P.push('RESET TO NORMAL', ctx.reset));
  P.note('Try: Takeoff phase → <b>ENG 2 fail</b> (PTU runs with flaps out) · <b>ENG 1 fail</b> (gear transfer valve) · <b>B leak</b> with flaps out (standby starts by itself).');

  return {
    update(res) {
      res.values.fA = res.values.qtyA / 106;
      res.values.fB = res.values.qtyB / 106;
      res.values.fS = res.values.qtyS / 100;
      X.update(res);
      P.update(res);
    },
  };
}
