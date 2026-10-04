// panels-extra.js — the rest of the forward overhead, so the 3D cockpit's
// overhead is complete. These systems aren't simulated yet (they come with
// later milestones): their switches move and explain themselves, but they
// don't drive any logic. Each panel says which chapter it belongs to.

export const EXTRA_SW = {
  start1: 1, start2: 1, ign: 1, wing: 0, eng1ai: 0, eng2ai: 0, wh1: 1, wh2: 1, wh3: 1, wh4: 1, probeA: 0, probeB: 0,
  apu: 0, smoke: 1, belts: 1, exitLt: 1, coolSup: 0, coolExh: 0, wiperL: 0, wiperR: 0,
  llL: 0, llR: 0, rto: 0, taxi: 0, logo: 0, pos: 1, beacon: 0, wingLt: 0, wwLt: 0,
};

export function extraPanels(O) {
  // Engine start + ignition (chapter 7).
  const S = O.panel('Engine start', 120);
  S.text(150, 16, 'ENGINE START', { size: 8.5 });
  S.knob(70, 62, 'start1', ['GRD', 'OFF', 'CONT', 'FLT'], [-75, -25, 25, 75], { name: '1', about: 'engines' });
  S.knob(230, 62, 'start2', ['GRD', 'OFF', 'CONT', 'FLT'], [-75, -25, 25, 75], { name: '2', about: 'engines' });
  S.toggle(150, 70, 'ign', ['IGN L', 'BOTH', 'IGN R'], { horizontal: true, name: 'IGNITION', about: 'engines' });

  // Exterior lights.
  const L = O.panel('Lights', 96);
  const lights = [['llL', 'L LAND'], ['llR', 'R LAND'], ['rto', 'RWY TURN'], ['taxi', 'TAXI'], ['logo', 'LOGO'], ['beacon', 'ANTI COLL'], ['wingLt', 'WING'], ['wwLt', 'WHEEL WELL']];
  lights.forEach(([k, n], i) => L.toggle(24 + i * 36, 46, k, ['ON', 'OFF'], { name: n, nameBox: false, about: 'general' }));
  L.text(150, 14, 'LIGHTS', { size: 8.5 });

  // Anti-ice and window / probe heat (chapter 3).
  const A = O.panel('Anti-ice', 148);
  A.text(150, 14, 'WINDOW HEAT', { size: 8.5 });
  ['L SIDE', 'L FWD', 'R FWD', 'R SIDE'].forEach((n, i) => {
    const x = 45 + i * 70;
    A.lamp(x - 18, 22, 36, 14, 'ON', () => true, 'green');
    A.toggle(x, 66, `wh${i + 1}`, ['ON', 'OFF'], { name: n, nameBox: false, about: 'antiice' });
  });
  A.text(75, 114, 'PROBE HEAT', { size: 7.5 });
  A.toggle(50, 128, 'probeA', ['OFF', 'ON'], { horizontal: true, about: 'antiice' });
  A.toggle(110, 128, 'probeB', ['OFF', 'ON'], { horizontal: true, about: 'antiice' });

  const AI = O.panel('Wing and engine anti-ice', 118);
  AI.lamp(26, 14, 40, 16, 'L VALVE\nOPEN', null, 'blue');
  AI.lamp(70, 14, 40, 16, 'R VALVE\nOPEN', null, 'blue');
  AI.toggle(68, 66, 'wing', ['OFF', 'ON'], { name: 'WING ANTI-ICE', about: 'antiice' });
  AI.lamp(166, 14, 40, 16, 'COWL\nANTI-ICE', null);
  AI.lamp(210, 14, 40, 16, 'COWL VALVE\nOPEN', null, 'blue');
  AI.toggle(190, 66, 'eng1ai', ['OFF', 'ON'], { name: 'ENG 1', about: 'antiice' });
  AI.toggle(250, 66, 'eng2ai', ['OFF', 'ON'], { name: 'ENG 2', about: 'antiice' });

  // APU (chapter 7).
  const P = O.panel('APU', 120);
  P.lamp(20, 14, 40, 16, 'MAINT', null, 'blue');
  P.lamp(20, 34, 40, 16, 'LOW OIL\nPRESSURE', null);
  P.lamp(64, 14, 40, 16, 'FAULT', null);
  P.lamp(64, 34, 40, 16, 'OVER\nSPEED', null);
  P.dial(180, 52, 30, {
    scales: [{ pts: [[0, -135], [10, 135]], ticks: [0, 2, 4, 6, 8, 10].map((v) => [v, 0.18, 1.2]), labels: [[0, '0'], [5, '5'], [10, '10']], lr: 0.6, lfs: 8 }],
    texts: [[0, 0.45, 'APU EGT', 5.5]], needles: [{ fn: () => 0, len: 0.8, w: 2 }],
  });
  P.knob(258, 60, 'apu', ['OFF', 'ON', 'START'], [-50, 0, 50], { name: 'APU', about: 'engines' });

  // Passenger signs, emergency exit lights, equipment cooling, wipers.
  const C = O.panel('Cabin signs and equipment cooling', 130);
  C.text(70, 14, 'EQUIP COOLING', { size: 7.5 });
  C.toggle(40, 52, 'coolSup', ['NORM', 'ALTN'], { name: 'SUPPLY', nameBox: false, about: 'air' });
  C.toggle(100, 52, 'coolExh', ['NORM', 'ALTN'], { name: 'EXHAUST', nameBox: false, about: 'air' });
  C.lamp(24, 100, 32, 14, 'OFF', null); C.lamp(84, 100, 32, 14, 'OFF', null);
  C.text(200, 14, 'EMER EXIT LIGHTS', { size: 7.5 });
  C.toggle(200, 52, 'exitLt', ['OFF', 'ARMED', 'ON'], { guard: 'black', guardPos: 1, about: 'general' });
  C.toggle(170, 104, 'smoke', ['OFF', 'AUTO', 'ON'], { horizontal: true, name: 'NO SMOKING', about: 'general' });
  C.toggle(250, 104, 'belts', ['OFF', 'AUTO', 'ON'], { horizontal: true, name: 'FASTEN BELTS', about: 'general' });

  const W = O.panel('Wipers', 74);
  W.knob(60, 38, 'wiperL', ['PARK', 'INT', 'LOW', 'HIGH'], [-60, -20, 20, 60], { name: 'WIPER L', about: 'antiice' });
  W.knob(240, 38, 'wiperR', ['PARK', 'INT', 'LOW', 'HIGH'], [-60, -20, 20, 60], { name: 'WIPER R', about: 'antiice' });
  W.text(150, 44, 'WINDSHIELD', { size: 8 });
}
