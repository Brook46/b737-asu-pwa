// sys-fuel.js — FCOM chapter 12 (fuel) in our own words, with tank layout,
// feed logic, alerts and a fuel burn you can watch (and fast-forward).

import { ENG, engPoint, wingLE, wingChord, wingY, wingTC, loft, APU, YC } from './airframe.js?v=18';

const F = '#d6336c', CTR = '#9c36b5', APUC = '#e8590c';
const spar = (z, u, dy = 0) => [wingLE(z) - u * wingChord(z), wingY(z) + dy, z];
const FRONT = 0.16, REAR = 0.64;      // spar chord fractions
const MAIN_IN = 3.5, MAIN_OUT = 15.4; // main tank span (each wing)

// Capacities (usable, level, 0.8029 kg/l) — FCOM 12.20.4
export const CAP = { main: 3915, center: 13066 };

// Engine burn by phase, kg/h per engine (illustrative round numbers), APU kg/h.
const BURN = { ground: 0, takeoff: 3200, cruise: 1250, approach: 900, landing: 450 };
const APU_BURN = 115;

export default {
  id: 'fuel', num: 12, title: 'Fuel', fcom: 'FCOM 12', color: F,
  anchor: [0.2, 2.1, 0],
  view: { target: [0, 2.2, 0], dist: 40, dir: [0.25, 1, 0.35] },
  phaseQty: true,

  overview: {
    lead: 'Three tanks — **main 1**, **main 2** and the **center tank** — each with two AC pumps. Both engines burn the **center tank first**, then their own main tank, and the APU feeds from the left side.',
    how: [
      'The main tanks are built into the wing structure. The center tank sits in the wing center section inside the fuselage and reaches out into the inboard wing.',
      'Center-first happens on its own: the **center pumps make more pressure** than the main pumps, so with all six running the center fuel wins at the check valves until it is gone. Check valves throughout stop fuel moving between tanks.',
      'One **crossfeed valve** joins the left and right engine feed lines. Open it and a tank with running pumps can feed both engines — at the price of a growing imbalance if left open.',
      'If a main tank\'s pumps both stop, its engine can still **suction-feed** through a bypass. At altitude dissolved air can come out of the fuel and starve a suction feed, so thrust loss or flameout is possible until that air has been used up.',
      'Each engine has two shutoff valves: a **spar valve** at the wing front spar and an **engine fuel valve** at the engine. Both close with the start lever at CUTOFF or the engine fire switch pulled.',
    ],
    limits: [
      ['Main tank 1 / 2 (usable)', '3,915 kg each', 'FCOM 12.20.4'],
      ['Center tank (usable)', '13,066 kg', 'FCOM 12.20.4'],
      ['Total usable', '20,896 kg', 'FCOM 12.20.4'],
      ['Max tank fuel temperature', '49 °C', 'FCOM L.10'],
      ['Min tank fuel temperature', '−43 °C or 3 °C above freezing point, whichever is higher', 'FCOM L.10'],
      ['Random lateral imbalance (taxi, takeoff, flight, landing)', '≤ 453 kg', 'FCOM L.10'],
      ['Mains must be full if center contains more than', '453 kg', 'FCOM L.10'],
      ['Quantity accuracy', '±2.0 % ground · ±2.5 % flight', 'FCOM 12.20.4'],
    ],
    memory: [
      'Intentional dry running of a center tank pump (LOW PRESSURE light on) is **prohibited**.',
      'Main tanks full whenever the center tank holds more than 453 kg; imbalance never more than 453 kg.',
    ],
  },

  parts: [
    {
      id: 'main1', name: 'Main tank 1', at: spar(-8.5, 0.4, 0.05),
      lead: 'Integral wing tank, left wing — about **3,915 kg** usable. Feeds engine 1 and, through the left manifold, the APU.',
      how: [
        'Two AC pumps (FWD and AFT). They\'re cooled and lubricated by the fuel itself, so they need fuel around them.',
        'The fuel temperature sensor is in this tank, and system A\'s hydraulic heat exchanger is too.',
        'When this tank is about half full the **scavenge jet pump** starts moving whatever is left in the center tank into it (with the No. 1 FWD pump on), and carries on for the rest of the flight.',
      ],
      deck: [
        ['FUEL PUMPS 1 FWD / AFT', 'ON runs the pump. LOW PRESSURE (amber): output low or switch OFF. Both lights in one tank → MASTER CAUTION + FUEL; one light shows only on recall.'],
        ['LOW (amber, on the fuel display)', 'Below 907 kg in this tank; stays until it is back above 1,134 kg.'],
      ],
      limits: [['Usable', '3,915 kg · 4,876 l', 'FCOM 12.20.4'], ['LOW alert', '< 907 kg (clears > 1,134 kg)', 'FCOM 12.10.5']],
      related: ['pumps1', 'ctr', 'scav', 'xfeed'],
    },
    {
      id: 'main2', name: 'Main tank 2', at: spar(8.5, 0.4, 0.05),
      lead: 'The right-wing twin of main tank 1 — **3,915 kg**, feeding engine 2. System B\'s hydraulic heat exchanger sits in this one.',
      limits: [['Usable', '3,915 kg · 4,876 l', 'FCOM 12.20.4']],
      related: ['pumps2', 'ctr', 'refuel'],
    },
    {
      id: 'ctr', name: 'Center tank', at: [-0.2, 1.95, 0],
      lead: 'The biggest tank — **13,066 kg** — between the wing roots and reaching into the inboard wing. Used first.',
      how: [
        'Its two pumps (L and R) are stronger than the main pumps, so they win at the check valves. Each center pump **shuts itself off** a short time after its own sensor sees low output pressure (tank empty). Switching it OFF resets that logic; switching it back ON runs it again until the switch goes OFF or the logic trips again.',
        'Near empty, LOW PRESSURE lights can flicker in cruise for as long as about five minutes before the caution comes on, and may show after the gauge already reads zero.',
        'On airplanes with a **Nitrogen Generation System**, nitrogen-enriched air from bleed air is fed into this tank through the flight to make the vapour above the fuel less flammable. It is automatic and has no flight-deck controls or indications.',
      ],
      deck: [
        ['FUEL PUMPS CTR L / R', 'ON runs the pump. LOW PRESSURE (amber): output low **and** switch ON. One light steady for 10 s with both switches ON → MASTER CAUTION + FUEL.'],
        ['CONFIG (amber, on the fuel display)', 'More than 726 kg in the center tank with both center pump switches OFF (engines running). Clears below 363 kg, when a center switch goes ON, or with both engines stopped.'],
      ],
      limits: [
        ['Usable', '13,066 kg · 16,273 l', 'FCOM 12.20.4'],
        ['CONFIG alert', '> 726 kg and both CTR pumps OFF', 'FCOM 12.10.5'],
        ['Dry running a center pump', 'Prohibited', 'FCOM L.10'],
      ],
      related: ['pumpsC', 'scav', 'main1', 'main2'],
    },
    {
      id: 'pumps1', name: 'Main tank 1 pumps (FWD, AFT)', at: spar(-3.9, 0.3, -0.1),
      lead: 'Two AC pumps feeding the left side of the engine manifold.',
      how: ['With the crossfeed closed they feed engine 1 and the APU. If both are off or the tank is empty, engine 1 falls back to suction feed through the bypass valve.'],
      related: ['main1', 'xfeed', 'spar1'],
    },
    {
      id: 'pumps2', name: 'Main tank 2 pumps (FWD, AFT)', at: spar(3.9, 0.3, -0.1),
      lead: 'Two AC pumps feeding the right side of the manifold — engine 2.',
      related: ['main2', 'xfeed', 'spar2'],
    },
    {
      id: 'pumpsC', name: 'Center tank pumps (L, R)', at: [-1.2, 1.7, 0],
      lead: 'Higher-pressure pumps: center L feeds the left manifold, center R the right. Auto-shutoff on low output pressure.',
      fails: ['Both center lights steady with fuel still showing in the center tank: not normal — check the switches and the non-normal checklist. Lights with the tank empty: switch them OFF (no dry running).'],
      related: ['ctr', 'xfeed'],
    },
    {
      id: 'xfeed', name: 'Crossfeed valve', at: [1.5, 1.9, 0],
      lead: 'Joins the engine 1 and engine 2 feed lines. DC motor, powered from the battery bus.',
      how: ['Open it to feed both engines from one side — the classic fix for an imbalance: open crossfeed, switch off the pumps in the **low** tank, and the heavy tank feeds both engines until balanced.'],
      deck: [
        ['CROSSFEED selector', 'Closed isolates the two feed lines; Open connects them.'],
        ['VALVE OPEN (blue)', 'Dim = open. Bright = moving, or valve and selector disagree. Out = closed.'],
      ],
      limits: [['IMBAL alert', '> 453 kg between mains (clears < 91 kg)', 'FCOM 12.10.5']],
      related: ['main1', 'main2', 'pumps1', 'pumps2'],
    },
    {
      id: 'spar1', name: 'Spar & engine valves · ENG 1', at: spar(-ENG.z, 0.05, -0.15),
      lead: 'Two shutoff valves in series: the **spar valve** at the wing front spar and the **engine fuel valve** on the engine.',
      how: ['The spar valve is DC-motor driven from the hot battery bus; the engine valve is fuel-actuated and solenoid controlled from the battery bus. Both close with the start lever at CUTOFF or the fire switch pulled.'],
      deck: [['ENG VALVE CLOSED / SPAR VALVE CLOSED (blue)', 'Out = open. Dim = closed. Bright = moving, or position disagrees with the start lever / fire switch.']],
      related: ['spar2', 'filter'],
    },
    {
      id: 'spar2', name: 'Spar & engine valves · ENG 2', at: spar(ENG.z, 0.05, -0.15),
      lead: 'Engine 2\'s pair of shutoff valves — same logic as engine 1.',
      related: ['spar1'],
    },
    {
      id: 'filter', name: 'Engine fuel filters', at: engPoint(1, 1.9, -0.55, 0.45),
      lead: 'Each engine filters its fuel; a clogging filter is about to be bypassed.',
      deck: [['FILTER BYPASS (amber)', 'Impending bypass due to a contaminated filter.']],
      related: ['spar1'],
    },
    {
      id: 'apufeed', name: 'APU fuel feed', at: [APU.x + 1.5, APU.y - 0.5, -0.3],
      lead: 'The APU takes fuel from the **left side of the manifold**. With no AC pumps running it suction-feeds from main tank 1.',
      how: ['A DC boost pump runs by itself during APU start and operation whenever the APU\'s fuel control senses low pressure, and stops as soon as an AC pump pressurises the manifold.'],
      related: ['main1', 'pumps1'],
    },
    {
      id: 'scav', name: 'Scavenge jet pump', at: [-0.6, 1.8, -2.4],
      lead: 'Moves the last center-tank fuel into main tank 1 so it isn\'t carried around unusable.',
      how: ['Works with the No. 1 FWD pump ON, starting when main tank 1 is about half full, and keeps going for the rest of the flight.'],
      related: ['ctr', 'main1'],
    },
    {
      id: 'surge', name: 'Surge tanks', at: spar(16.1, 0.4, 0.05),
      lead: 'Small compartments beyond each main tank at the wing tip, part of the tank venting system — not counted as usable fuel.',
      related: ['main1', 'main2'],
    },
    {
      id: 'refuel', name: 'Fueling station', at: spar(9.3, 0.25, -0.35),
      lead: 'Single-point pressure fueling in the **right wing**, also used for ground transfer between tanks.',
      how: [
        'Each tank\'s fueling valve closes by itself when that tank is full. Opening the fueling door powers the system (with the battery on).',
        'A **manual defueling valve** outboard of engine 2 links the engine feed system to the fueling station for defueling and tank-to-tank transfer.',
        'Six measuring sticks per main tank and four in the center tank allow a manual check of the gauges.',
      ],
      limits: [['Do not operate HF radios during refueling', '', 'FCOM L.10']],
      related: ['main2'],
    },
  ],

  build(K) {
    for (const side of [-1, 1]) {
      K.wingTank(side < 0 ? 'main1' : 'main2', side, MAIN_IN, MAIN_OUT, FRONT, REAR, { color: F });
      K.wingTank('surge', side, MAIN_OUT + 0.15, 16.6, FRONT + 0.02, REAR - 0.05, { color: '#868e96' });
    }
    // Center tank: center wing box straight through the fuselage + inboard wing.
    const cs = (z) => {
      const a = Math.max(Math.abs(z), 1.88);
      return { le: [wingLE(a), wingY(a), z], chord: wingChord(a), t: wingTC(a) * 0.82, thick: [0, 1, 0],
        u0: FRONT, u1: REAR, camber: 0.018 };
    };
    K.unit('ctr', { geometry: loft([cs(-MAIN_IN + 0.1), cs(-1.88), cs(1.88), cs(MAIN_IN - 0.1)], 10) }, { color: CTR, glass: true });

    // Pumps.
    for (const side of [-1, 1]) {
      const id = side < 0 ? 'pumps1' : 'pumps2';
      K.unit(id, { sphere: spar(side * 3.9, FRONT + 0.06, -0.08), r: 0.17 }, { color: F });
      K.unit(id, { sphere: spar(side * 3.9, REAR - 0.06, -0.08), r: 0.17 }, { color: F });
      K.unit('pumpsC', { sphere: [wingLE(1.88) - REAR * wingChord(1.88) + 0.4, wingY(1.88) - 0.1, side * 1.0], r: 0.19 }, { color: CTR });
    }
    // Manifold along the front spar, crossfeed in the middle.
    const xf = [wingLE(1.88) - FRONT * wingChord(1.88) - 0.15, wingY(1.88) - 0.05, 0];
    K.unit('xfeed', { sphere: xf, r: 0.2 }, { color: '#4dabf7' });
    for (const side of [-1, 1]) {
      const n = side < 0 ? 1 : 2;
      const man = [[xf[0], xf[1], side * 0.25], spar(side * 1.88, FRONT + 0.02, -0.05), spar(side * 3.9, FRONT + 0.02, -0.05),
        spar(side * ENG.z, FRONT, -0.08)];
      K.flow(`man${n}`, man, { color: F, part: side < 0 ? 'pumps1' : 'pumps2' });
      K.flow(`xf${n}`, [[xf[0], xf[1], side * 0.25], xf], { color: F, part: 'xfeed', r: 0.06 });
      // Main pumps → manifold.
      K.flow(`m${n}`, [spar(side * 3.9, REAR - 0.06, -0.08), spar(side * 3.9, FRONT + 0.06, -0.08), spar(side * 3.9, FRONT + 0.02, -0.05)],
        { color: F, part: side < 0 ? 'pumps1' : 'pumps2', r: 0.05 });
      // Center pump → manifold side.
      const cp = [wingLE(1.88) - REAR * wingChord(1.88) + 0.4, wingY(1.88) - 0.1, side * 1.0];
      K.flow(`c${n}`, [cp, [cp[0] + 1.2, cp[1] + 0.02, side * 1.2], spar(side * 1.88, FRONT + 0.02, -0.05)], { color: CTR, part: 'pumpsC', r: 0.06 });
      // Spar valve → engine.
      K.unit(n === 1 ? 'spar1' : 'spar2', { sphere: spar(side * ENG.z, 0.05, -0.15), r: 0.15 }, { color: '#4dabf7' });
      K.flow(`e${n}`, [spar(side * ENG.z, FRONT, -0.08), spar(side * ENG.z, 0.05, -0.15), engPoint(n, 1.4, 0.95, 0),
        engPoint(n, 1.9, -0.55, -side * 0.45)], { color: F, part: n === 1 ? 'spar1' : 'spar2' });
      K.unit('filter', { cyl: [engPoint(n, 1.75, -0.55, -side * 0.45), engPoint(n, 2.15, -0.55, -side * 0.45)], r: 0.12 }, { color: F });
      // Suction feed bypass (dashed in spirit: only lit when used).
      K.flow(`suc${n}`, [spar(side * 5.2, REAR - 0.1, -0.1), spar(side * 5.2, FRONT + 0.03, -0.06), spar(side * ENG.z, FRONT, -0.08)],
        { color: '#fab005', part: n === 1 ? 'pumps1' : 'pumps2', r: 0.05 });
    }
    // APU line from the left manifold aft to the APU.
    K.flow('apu', [spar(-1.88, FRONT + 0.02, -0.05), [-1.5, 1.6, -0.7], [-9, 2.2, -0.9], [-15, 3.4, -0.5], [APU.x + 1.5, APU.y - 0.5, -0.3]],
      { color: APUC, part: 'apufeed', r: 0.05 });
    K.unit('apufeed', { sphere: [APU.x + 1.5, APU.y - 0.5, -0.3], r: 0.16 }, { color: APUC });
    // Scavenge: center → main 1.
    K.flow('scav', [[-0.6, 1.8, -0.8], [-0.6, 1.8, -2.4], spar(-3.8, 0.42, -0.1)], { color: CTR, part: 'scav', r: 0.04 });
    K.unit('scav', { sphere: [-0.6, 1.8, -2.4], r: 0.12 }, { color: CTR });
    // Fueling station + defuel valve.
    K.unit('refuel', { box: spar(9.3, 0.25, -0.35), size: [0.6, 0.12, 0.45] }, { color: '#20c997' });
    K.flow('refuel', [spar(9.3, 0.25, -0.3), spar(6.2, FRONT + 0.02, -0.05)], { color: '#20c997', part: 'refuel', r: 0.04 });
  },

  normal(phase) {
    const q = {
      ground: { m1: 3915, m2: 3915, c: 6000 },
      takeoff: { m1: 3880, m2: 3880, c: 5600 },
      cruise: { m1: 3880, m2: 3880, c: 1500 },
      approach: { m1: 2250, m2: 2220, c: 0 },
      landing: { m1: 2150, m2: 2120, c: 0 },
    }[phase];
    const ctrOn = q.c > 453 ? 1 : 0;
    return {
      sw: { m1fwd: 1, m1aft: 1, m2fwd: 1, m2aft: 1, ctrL: ctrOn, ctrR: ctrOn, xfeed: 0 },
      fail: {}, q: { ...q },
      mem: { autoL: false, autoR: false, lowL: false, lowR: false, imbal: false, rate: 1, scav: false, t: 0 },
    };
  },

  action(st, key) {
    const { q, mem } = st;
    if (key === 'rate') mem.rate = (mem.rate || 1) > 1 ? 1 : 120;
    else if (key === 'imbal') {
      // Make tank 2 heavier by 700 kg — or tank 1 lighter if 2 is already full.
      if (q.m2 + 700 <= CAP.main) q.m2 += 700; else q.m1 = Math.max(0, q.m1 - 700);
    } else if (key === 'emptyCtr') q.c = 0;
  },

  // Who feeds whom, from switches + quantities. Used by evaluate() and tick().
  feed(env, st) {
    const { sw, q, fail: f, mem } = st;
    // Boost pumps are AC motors: no AC, no pump pressure (engines suction feed).
    const ac = env.acPower !== false;
    const m1 = ac ? (sw.m1fwd && !f.p1fwd ? 1 : 0) + (sw.m1aft ? 1 : 0) : 0;
    const m2 = ac ? (sw.m2fwd ? 1 : 0) + (sw.m2aft ? 1 : 0) : 0;
    const has = { m1: q.m1 > 1, m2: q.m2 > 1, c: q.c > 1 };
    const cL = ac && sw.ctrL && !mem.autoL && !f.ctrL && has.c, cR = ac && sw.ctrR && !mem.autoR && has.c;
    const pm1 = m1 > 0 && has.m1, pm2 = m2 > 0 && has.m2;
    const x = !!sw.xfeed;
    // Sides: what pressurises each side of the manifold?
    let L = { c: cL, m: pm1 }, R = { c: cR, m: pm2 };
    if (x) { const c = cL || cR; L = R = { c, m: pm1 || pm2, both: true }; }
    const run1 = env.eng1 && !f.eng1, run2 = env.eng2 && !f.eng2;
    const src = (side, own) => {
      if (side.c) return 'c';
      if (side.m) return side.both ? 'mx' : own;
      return own === 'm1' ? (has.m1 ? 's1' : null) : (has.m2 ? 's2' : null); // suction from own tank
    };
    return {
      cL, cR, pm1, pm2, x, run1, run2,
      e1: run1 ? src(L, 'm1') : null,
      e2: run2 ? src(R, 'm2') : null,
      apu: env.apu ? (L.c ? 'c' : L.m ? (L.both ? 'mx' : 'm1') : has.m1 ? 's1' : null) : null,
      pressL: L.c || L.m, pressR: R.c || R.m,
    };
  },

  tick(dt, st, env) {
    const { q, mem, sw, fail: f } = st;
    const fd = this.feed(env, st);
    const k = (dt * (mem.rate || 1)) / 3600;
    const burn = BURN[env.phase] || 0;
    let changed = false;
    const take = (srcKey, kg) => {
      if (!srcKey || kg <= 0) return;
      if (srcKey === 'c') q.c = Math.max(0, q.c - kg);
      else if (srcKey === 'm1' || srcKey === 's1') q.m1 = Math.max(0, q.m1 - kg);
      else if (srcKey === 'm2' || srcKey === 's2') q.m2 = Math.max(0, q.m2 - kg);
      else if (srcKey === 'mx') {
        // Crossfeed open, mains feeding: split by which tanks have running pumps.
        const a = fd.pm1 ? 1 : 0, b = fd.pm2 ? 1 : 0, n = a + b || 1;
        q.m1 = Math.max(0, q.m1 - kg * a / n);
        q.m2 = Math.max(0, q.m2 - kg * b / n);
      }
      changed = true;
    };
    take(fd.e1, burn * k + (f.leak1 ? 4000 * k : 0));
    take(fd.e2, burn * k);
    take(fd.apu, APU_BURN * k);
    // Center pumps trip off a moment after the tank runs dry.
    if (q.c <= 1) {
      if (sw.ctrL && !mem.autoL) { mem.autoL = true; changed = true; }
      if (sw.ctrR && !mem.autoR) { mem.autoR = true; changed = true; }
    }
    if (!sw.ctrL) mem.autoL = false;
    if (!sw.ctrR) mem.autoR = false;
    // Scavenge: main 1 at half, No. 1 FWD pump ON, then for the rest of the flight.
    if (env.air && sw.m1fwd && q.m1 <= CAP.main / 2) mem.scav = true;
    if (mem.scav && q.c > 0) {
      const m = Math.min(q.c, 600 * k);
      q.c -= m; q.m1 = Math.min(CAP.main, q.m1 + m);
      changed = true;
    }
    // Latching alerts with their hysteresis.
    const lowL = mem.lowL ? q.m1 < 1134 : q.m1 < 907;
    const lowR = mem.lowR ? q.m2 < 1134 : q.m2 < 907;
    const d = Math.abs(q.m1 - q.m2);
    const imbal = mem.imbal ? d > 91 : d > 453;
    if (lowL !== mem.lowL || lowR !== mem.lowR || imbal !== mem.imbal) changed = true;
    Object.assign(mem, { lowL, lowR, imbal });
    return changed;
  },

  evaluate(env, st) {
    const { sw, q, fail: f, mem } = st;
    const fd = this.feed(env, st);
    const engs = env.eng1 || env.eng2;
    const config = engs && q.c > 726 && !sw.ctrL && !sw.ctrR;
    // A line flows when something downstream is drawing on it. With the
    // crossfeed open the two sides are one manifold.
    const dL = !!(fd.e1 || fd.apu), dR = !!fd.e2, dAny = dL || dR;
    const anyC = fd.cL || fd.cR;
    const flows = {
      man1: fd.x ? dAny : dL, man2: fd.x ? dAny : dR,
      m1: fd.pm1 && (fd.x ? !anyC && dAny : !fd.cL && dL),
      m2: fd.pm2 && (fd.x ? !anyC && dAny : !fd.cR && dR),
      c1: fd.cL && (fd.x ? dAny : dL),
      c2: fd.cR && (fd.x ? dAny : dR),
      xf1: fd.x && dAny, xf2: fd.x && dAny,
      e1: !!fd.e1, e2: !!fd.e2,
      suc1: fd.e1 === 's1', suc2: fd.e2 === 's2',
      apu: !!fd.apu, scav: mem.scav && q.c > 0, refuel: false,
    };
    const units = {
      main1: q.m1 < 907 ? 'fault' : 'on', main2: q.m2 < 907 ? 'fault' : 'on', ctr: q.c > 1 ? 'on' : 'off', surge: 'off',
      pumps1: fd.pm1 ? 'on' : 'off', pumps2: fd.pm2 ? 'on' : 'off',
      pumpsC: fd.cL || fd.cR ? 'on' : (sw.ctrL || sw.ctrR) ? 'fault' : 'off',
      xfeed: fd.x ? 'on' : 'off', spar1: (env.lever1 ?? env.eng1) && !env.cut1 ? 'on' : 'off', spar2: (env.lever2 ?? env.eng2) && !env.cut2 ? 'on' : 'off',
      filter: f.filter1 ? 'fault' : 'on', apufeed: env.apu ? 'on' : 'off', scav: mem.scav ? 'on' : 'off', refuel: 'off',
    };
    const open1 = (env.lever1 ?? env.eng1) && !env.cut1, open2 = (env.lever2 ?? env.eng2) && !env.cut2;
    const lpMain = (on, tank) => !on || tank <= 1 || env.acPower === false;
    const lights = {
      lp1fwd: lpMain(sw.m1fwd && !f.p1fwd, q.m1), lp1aft: lpMain(sw.m1aft, q.m1),
      lp2fwd: lpMain(sw.m2fwd, q.m2), lp2aft: lpMain(sw.m2aft, q.m2),
      lpCL: !!sw.ctrL && !fd.cL, lpCR: !!sw.ctrR && !fd.cR,
      valveOpen: fd.x ? 'dim' : false,
      // VALVE CLOSED (blue): dim when closed — start lever CUTOFF or fire switch pulled.
      engValve1: open1 ? false : 'dim', sparValve1: open1 ? false : 'dim',
      engValve2: open2 ? false : 'dim', sparValve2: open2 ? false : 'dim',
      filter1: !!f.filter1, filter2: false,
    };
    const temp = { ground: 18, takeoff: 16, cruise: -22, approach: -4, landing: -6 }[env.phase] ?? 10;
    return {
      flows, units, lights,
      values: {
        m1: Math.round(q.m1), m2: Math.round(q.m2), c: Math.round(q.c),
        total: Math.round(q.m1 + q.m2 + q.c),
        f1: q.m1 / CAP.main, f2: q.m2 / CAP.main, fc: q.c / CAP.center,
        low1: mem.lowL, low2: mem.lowR, config, imbal: mem.imbal, imbalLow: mem.imbal ? (q.m1 < q.m2 ? 1 : 2) : 0,
        temp, rate: mem.rate || 1,
        src1: fd.e1, src2: fd.e2, srcApu: fd.apu,
      },
      note: [
        fd.e1 === 's1' && 'Engine 1 on suction feed',
        fd.e2 === 's2' && 'Engine 2 on suction feed',
        config && 'CONFIG: center fuel with center pumps off',
        mem.imbal && 'IMBAL',
        mem.scav && q.c > 0 && 'Scavenge pump moving center fuel to main 1',
      ].filter(Boolean).join(' · '),
    };
  },
};
