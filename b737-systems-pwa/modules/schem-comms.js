// schem-comms.js — who talks to whom: ACP → remote electronics unit →
// radios, interphones, PA; with the audio control panel, radio tuning panel
// and the calls / voice recorder panel.

import { createSchematic, createPanel } from './schem-kit.js?v=30';
import { createOverhead } from './overhead.js?v=30';
import { MICS, RXS } from './sys-comms.js?v=30';

const C = '#00a6a6', RX = '#66d9e8';

export function mount(svgHost, panelHost, ctx) {
  const X = createSchematic(svgHost, 1000, 640);
  X.onPart = ctx.onPart;
  X.unit(60, 40, 200, 50, 'CAPTAIN ACP', (r) => r.units.acp, { color: C, part: 'acp' });
  X.unit(400, 40, 200, 50, 'F/O ACP', () => 'on', { color: C, part: 'acp' });
  X.unit(740, 40, 200, 50, 'OBSERVER ACP', () => 'on', { color: C, part: 'acp' });
  for (const x of [160, 500, 840]) X.pipe([[x, 90], [x, 160]], 'audio', { color: C, thin: true });
  X.unit(80, 160, 840, 50, 'REMOTE ELECTRONICS UNIT (E/E bay) — independent audio systems', (r) => (r.flows.audio ? 'on' : 'fault'), { color: C, part: 'acp' });
  X.value(500, 236, (r) => ({ text: `captain transmits on: ${r.values.mic}${r.values.degraded ? ' (ALT — fixed)' : ''}`, cls: 't-big' + (r.values.degraded ? ' warn' : '') }));
  MICS.forEach((n, i) => {
    const x = 40 + i * 136;
    X.pipe([[x + 60, 210], [x + 60, 300]], (r) => r.lights['mic:' + n] || r.lights['rx:' + RXS[i][0]], { color: RX, thin: true });
    X.unit(x, 300, 120, 50, n, (r) => (r.lights['call:' + n] ? 'fault' : r.lights['mic:' + n] ? 'on' : r.lights['rx:' + RXS[i][0]] ? 'on' : 'off'), { color: RX, part: i < 4 ? 'vhf' : i === 4 ? 'interphone' : 'interphone', small: true });
    X.value(x + 60, 372, (r) => ({ text: r.lights['mic:' + n] ? 'TX' : r.lights['rx:' + RXS[i][0]] ? 'RX' : '', cls: 't-small' }));
  });
  X.value(500, 420, (r) => ({ text: `VHF 1  ACTIVE ${r.values.act}   STBY ${r.values.stby}`, cls: 't-big' }));
  X.value(500, 470, (r) => ({ text: r.values.tx, cls: 't-big' }));
  X.value(500, 500, (r) => ({ text: r.values.heard, cls: 't-big' + (/NOT/.test(r.values.heard) ? ' warn' : '') }));
  X.unit(380, 540, 240, 44, 'VOICE RECORDER', (r) => r.units.cvr, { color: '#f76707', part: 'cvr', small: true });
  X.text(500, 615, 'GPWS · altitude alert · TCAS · windshear aurals: fixed volume on every speaker and headset', 't-small t-dim', 'middle');

  const O = createOverhead(panelHost, ctx);
  panels(O, ctx);
  const ih = document.createElement('div');
  ih.className = 'instr';
  panelHost.append(ih);
  const P = createPanel(ih, ctx);
  P.title('INSTRUCTOR · CALLS & FAILURES');
  P.actions(P.push('ATC CALLS (VHF 1)', () => ctx.action('callIn', 'atc')), P.push('SELCAL (HF)', () => ctx.action('callIn', 'selcal')),
    P.push('CABIN CALLS', () => ctx.action('callIn', 'cabin')), P.push('GROUND CREW CALLS', () => ctx.action('callIn', 'ground')));
  P.actions(P.push('PUSH TO TALK', () => ctx.action('ptt')), P.fail('Remote electronics unit', 'reu'), P.fail('Voice recorder', 'cvr'), P.push('RESET TO NORMAL', ctx.reset));
  P.note('Deselect the <b>VHF 1</b> receiver and have ATC call — you miss it. Cabin calls: a flashing CALL on SVC — select SVC and talk to reset it. Fail the <b>remote electronics unit</b>: degraded mode, one radio only.');
  return { update(res) { X.update(res); O.update(res); P.update(res); } };
}

export function panels(O, ctx) {
  const A = O.panel('Audio control panel', 112);
  MICS.forEach((n, i) => {
    const x = 8 + i * 41;
    A.lamp(x, 6, 37, 9, 'CALL', 'call:' + n, 'white');
    A.lamp(x, 17, 37, 20, n, 'mic:' + n, 'green', 'comms', () => ctx.action('mic:' + n));
  });
  RXS.forEach(([k, n], i) => A.lamp(8 + i * 41, 46, 37, 22, `${n}\nRX`, 'rx:' + k, 'white', 'comms', () => ctx.action('rx:' + k)));
  A.toggle(40, 92, 'alt', ['NORM', 'ALT'], { horizontal: true });
  A.toggle(120, 92, 'mask', ['MASK', 'BOOM'], { horizontal: true });
  A.push(200, 92, () => ctx.action('ptt'), { name: 'R/T push to talk', bottom: 'R/T' });
  A.lamp(232, 84, 60, 16, 'SPKR', (r) => !!ctx.sw.spkr, 'white', 'comms', () => ctx.set('spkr', ctx.sw.spkr ? 0 : 1));
  const R = O.panel('VHF comm', 60);
  R.text(150, 9, 'VHF 1', { size: 8 });
  R.lcd(14, 16, 92, (r) => r.values.act, { h: 20, size: 14 });
  R.lcd(194, 16, 92, (r) => r.values.stby, { h: 20, size: 14 });
  R.text(60, 50, 'ACTIVE', { size: 6.5 }); R.text(240, 50, 'STANDBY', { size: 6.5 });
  R.push(150, 30, () => ctx.action('tfr'), { name: 'TFR', bottom: 'TFR' });
  R.knob(270, 48, 'stbyTune', ['', ''], [0, 0], { action: true, noLabels: true, r: 7 });
  // Flight attendant / ground crew calls (narrow centre column of the overhead).
  const V = O.panel('Calls', 70, { w: 150 });
  V.lamp(53, 6, 44, 15, 'CALL', 'callFd', 'blue');
  V.push(40, 42, () => ctx.action('attend'), { bottom: 'ATTEND', name: 'ATTEND' });
  V.push(110, 42, () => ctx.action('grdCall'), { bottom: 'GRD CALL', name: 'GRD CALL' });
  // Cockpit voice recorder (4th column of the forward overhead).
  const CV = O.panel('Voice recorder', 70);
  CV.text(150, 12, 'COCKPIT VOICE RECORDER', { size: 6.8 });
  CV.lamp(30, 26, 44, 16, 'STATUS', 'cvrStatus', 'green');
  CV.push(120, 34, null, { bottom: 'ERASE', name: 'CVR ERASE' });
  CV.push(170, 34, () => ctx.action('cvrTest'), { bottom: 'TEST', name: 'CVR TEST' });
  CV.toggle(240, 36, 'cvr', ['AUTO', 'ON'], { name: 'VOICE REC', nameBox: false });
  // Service interphone (aft overhead).
  const SI = O.panel('Service interphone', 76, { w: 150 });
  SI.text(75, 14, 'SERVICE\nINTERPHONE', { size: 6.8 });
  SI.toggle(75, 50, 'svcInt', ['OFF', 'ON'], {});
}
