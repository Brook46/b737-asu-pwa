// schem-hydraulics.js — operable A / B / standby schematic + hydraulic panel.

import { createSchematic, createPanel } from './schem-kit.js?v=37';
import { createOverhead } from './overhead.js?v=37';

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

  // ── Overhead panels (layout after FCOM 13.10) ──
  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);

  // ── Instructor station: SYS page readouts, failures ──
  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('LOWER DU · SYS PAGE');
  P.row(P.readout((r) => `${r.values.pressA}<small>psi</small>`, 'A PRESS'), P.readout((r) => `${r.values.pressB}<small>psi</small>`, 'B PRESS'));
  P.row(P.readout((r) => `${r.values.qtyA}<small>%${r.values.rfA ? ' RF' : ''}</small>`, 'A QTY'),
    P.readout((r) => `${r.values.qtyB}<small>%${r.values.rfB ? ' RF' : ''}</small>`, 'B QTY'));
  P.title('INSTRUCTOR · FAILURES');
  P.actions(P.fail('ENG 1 fail', 'eng1'), P.fail('ENG 2 fail', 'eng2'), P.fail('A leak · EDP side', 'leakAedp'),
    P.fail('A leak · common', 'leakAcom'), P.fail('B leak', 'leakB'), P.fail('STBY leak', 'leakS'), P.fail('ELEC 2 overheat', 'ovhtA'));
  P.actions(P.push('RESET TO NORMAL', ctx.reset));
  P.note('Guarded switches: tap the guard to lift it, then the switch. Tap the lifted guard to close it — that returns the switch to its guarded position.');
  P.note('Try: Takeoff phase → <b>ENG 2 fail</b> (PTU runs with flaps out) · <b>ENG 1 fail</b> (gear transfer valve) · <b>B leak</b> with flaps out (standby starts by itself).');

  return {
    update(res) {
      res.values.fA = res.values.qtyA / 106;
      res.values.fB = res.values.qtyB / 106;
      res.values.fS = res.values.qtyS / 100;
      X.update(res);
      O.update(res);
      P.update(res);
    },
  };
}

/** The overhead panels for this system — drawn in the schematic view and,
 *  as textures, in the 3D cockpit. */
export function panels(O, ctx) {
  const H = O.panel('Hydraulic pumps', 178);
  H.frame(14, 30, 132, 124, 'A');
  H.frame(154, 30, 132, 124, 'B');
  H.lamp(97, 40, 36, 16, 'OVERHEAT', 'ovhtElec2');
  H.lamp(167, 40, 36, 16, 'OVERHEAT', 'ovhtElec1');
  const pumpSw = [[45, 'eng1', 'ENG 1', 'lpEng1'], [115, 'elec2', 'ELEC 2', 'lpElec2'], [185, 'elec1', 'ELEC 1', 'lpElec1'], [255, 'eng2', 'ENG 2', 'lpEng2']];
  for (const [x, key, name, lp] of pumpSw) {
    H.lamp(x - 20, 60, 40, 18, 'LOW\nPRESSURE', lp);
    H.toggle(x, 108, key, ['OFF', 'ON'], { name, labels: x < 150 ? 'left' : 'right' });
  }
  H.text(150, 170, 'HYD PUMPS', { box: true, size: 9 });

  const FC = O.panel('Flight control', 262);
  FC.text(75, 16, 'FLT CONTROL', { size: 9 });
  FC.text(50, 30, 'A', { size: 8 }); FC.text(100, 30, 'B', { size: 8 });
  FC.toggle(50, 70, 'fcA', ['STBY RUD', 'OFF', 'ON'], { guard: 'black', guardPos: 2, labels: 'left' });
  FC.toggle(100, 70, 'fcB', ['STBY RUD', 'OFF', 'ON'], { guard: 'black', guardPos: 2 });
  FC.lamp(31, 108, 38, 18, 'LOW\nPRESSURE', 'fcLpA');
  FC.lamp(81, 108, 38, 18, 'LOW\nPRESSURE', 'fcLpB');
  FC.text(228, 14, 'STANDBY\nHYD', { size: 8 });
  FC.lamp(206, 30, 44, 17, 'LOW\nQUANTITY', 'stbyLowQty');
  FC.lamp(206, 49, 44, 17, 'LOW\nPRESSURE', 'stbyLowPress');
  FC.lamp(206, 68, 44, 17, 'STBY\nRUD ON', 'stbyRudOn');
  FC.text(232, 102, 'ALTERNATE FLAPS', { size: 8 });
  FC.toggle(205, 140, 'altFlaps', ['OFF', 'ARM'], { guard: 'red', guardPos: 0, labels: 'left' });
  FC.toggle(262, 140, 'altPos', ['UP', 'OFF', 'DOWN'], { ctx: ctx.ctxOf?.('flightcontrols'), inert: !ctx.ctxOf, inertPos: 1 });
  FC.text(75, 148, 'SPOILER', { size: 8 });
  FC.text(50, 160, 'A', { size: 8 }); FC.text(100, 160, 'B', { size: 8 });
  FC.toggle(50, 196, 'spA', ['OFF', 'ON'], { guard: 'black', guardPos: 1, ctx: ctx.ctxOf?.('flightcontrols'), inert: !ctx.ctxOf, inertPos: 1, labels: 'left' });
  FC.toggle(100, 196, 'spB', ['OFF', 'ON'], { guard: 'black', guardPos: 1, ctx: ctx.ctxOf?.('flightcontrols'), inert: !ctx.ctxOf, inertPos: 1 });
  const fcl = (k) => (ctx.resOf ? () => ctx.resOf('flightcontrols')?.lights[k] : null);
  FC.lamp(206, 172, 44, 16, 'FEEL\nDIFF PRESS', fcl('feelDiff'));
  FC.lamp(206, 190, 44, 16, 'SPEED TRIM\nFAIL', fcl('speedTrimFail'));
  FC.lamp(206, 208, 44, 16, 'MACH TRIM\nFAIL', fcl('machTrimFail'));
  FC.lamp(206, 226, 44, 16, 'AUTO SLAT\nFAIL', fcl('autoSlatFail'));
  FC.lamp(56, 230, 38, 16, 'YAW\nDAMPER', fcl('ydLight'));
  FC.toggle(120, 238, 'yd', ['OFF', 'ON'], { horizontal: true, ctx: ctx.ctxOf?.('flightcontrols'), inert: !ctx.ctxOf, inertPos: 1 });
}
