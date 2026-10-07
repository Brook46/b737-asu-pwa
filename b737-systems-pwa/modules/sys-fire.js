// sys-fire.js — FCOM chapter 8, fire protection, in our own words.
// Pulling an engine fire switch here really shuts that engine's fuel off —
// app.js passes it to the engines model through env (cut1 / cut2).

import { ENG, engPoint, APU, YC, MLG, FLOOR_Y } from './airframe.js?v=28';

const R = '#d62828', DET = '#ff8787', BOT = '#adb5bd';

export default {
  id: 'fire', num: 8, title: 'Fire Protection', fcom: 'FCOM 8', color: R,
  anchor: [ENG.x - 2.2, ENG.y + 0.6, -ENG.z],
  view: { target: [-2, 2.2, 0], dist: 40, dir: [0.6, 0.6, -0.8] },

  overview: {
    lead: 'Fire **detection and extinguishing** for both engines and the APU, overheat detection on the engines, fire detection (no extinguishing) in the main wheel well, and smoke detection with fire suppression in the cargo holds and lavatories.',
    how: [
      'Each engine has **two detector loops**; each loop senses both overheat (lower temperature) and fire (higher). Normally **both loops must agree** before you get an alert, so one bad loop can\'t give a false fire warning.',
      'An engine **overheat** gives MASTER CAUTION, OVHT/DET and the ENG OVERHEAT light. An engine **fire** gives the master FIRE WARN lights, the fire bell, the lit engine fire switch and the lit start lever.',
      '**Pulling** an engine fire switch closes the spar and engine fuel valves, the engine bleed valve (that wing loses anti-ice and its pack valve closes), the hydraulic shutoff valve (EDP LOW PRESSURE goes out), trips the generator and disables that reverser. **Rotating** it fires a bottle into that engine. There are two bottles and either can go to either engine.',
      'Detection runs on the battery bus and extinguishing on the hot battery bus, so they survive a loss of normal power.',
    ],
    limits: [
      ['Cargo fire suppression after DISCH', '195 min (180 to land + 15)', 'FCOM 8.20'],
      ['Second cargo bottle', 'metered, starts automatically', 'FCOM 8.20'],
    ],
    memory: [
      'Normally both detector loops must sense the condition; one failed loop drops out automatically with no flight deck indication.',
      'The main wheel well has fire detection only — no extinguisher. The nose wheel well has no detection.',
    ],
  },

  parts: [
    {
      id: 'loops1', name: 'Engine 1 detector loops', at: engPoint(1, 1.3, 0.75, -0.6),
      lead: 'Two loops (A and B) around the engine, each detecting overheat and fire.',
      how: [
        'With **OVHT DET** in NORMAL both loops must sense the condition. If one loop fails it is dropped automatically and the other works alone — no indication. If both fail, **FAULT** lights.',
        'With OVHT DET in **A** or **B**, only that loop is used and the other isn\'t monitored; if the selected loop fails, FAULT lights and detection is lost.',
        'The ENG OVERHEAT light or fire switch stays lit until the temperature drops below the onset value.',
      ],
      deck: [
        ['OVHT DET (A · NORMAL · B)', 'Selects which loops detect for that engine.'],
        ['ENG 1 OVERHEAT (amber)', 'Overheat in engine 1 — with MASTER CAUTION and OVHT/DET.'],
        ['FAULT (amber)', 'NORMAL: both loops on an engine failed. A or B: the selected loop failed.'],
      ],
      related: ['fsw', 'bottles'],
    },
    {
      id: 'loops2', name: 'Engine 2 detector loops', at: engPoint(2, 1.3, 0.75, 0.6),
      lead: 'Engine 2\'s pair of loops — same logic as engine 1.',
      related: ['loops1', 'fsw'],
    },
    {
      id: 'fsw', name: 'Engine fire switches', at: [0.2, FLOOR_Y + 0.2, -0.2],
      lead: 'On the fire protection panel on the aft pedestal. Locked down until a fire or overheat unlocks them (they can also be unlocked by hand).',
      how: [
        '**Pull:** closes both fuel shutoff valves (engine + spar), the engine bleed valve, the hydraulic fluid shutoff valve; trips the generator; disables the reverser; arms one squib on **each** bottle; lets the switch rotate.',
        '**Rotate** (left or right): fires a bottle into that engine. **BOTTLE DISCHARGED** lights a few seconds later.',
      ],
      deck: [
        ['Engine fire switch (red when lit)', 'Lit for an engine fire, or during the OVHT/FIRE test.'],
        ['L / R BOTTLE DISCHARGED (amber)', 'That bottle has discharged (or lost pressure).'],
        ['Master FIRE WARN + bell', 'Any fire warning. Pushing FIRE WARN (or the bell cutout) silences the bell and resets for further warnings.'],
      ],
      related: ['bottles', 'loops1', 'test'],
    },
    {
      id: 'bottles', name: 'Engine fire bottles', at: [-2.3, 1.75, -1.15],
      lead: 'Two bottles; either or both can be discharged into either engine.',
      related: ['fsw'],
    },
    {
      id: 'apufire', name: 'APU fire protection', at: [APU.x + 0.9, APU.y + 0.35, 0],
      lead: 'A single detector loop and one bottle for the APU.',
      how: [
        'An APU fire lights the APU fire switch, the master FIRE WARN lights and the bell — and on the ground the APU fire horn sounds and a light flashes in the main wheel well.',
        '**Pulling** the APU fire switch shuts the APU down (backing up its automatic shutdown), closes its fuel valve, bleed valve and inlet door, and trips its generator; **rotating** it fires the APU bottle.',
        'A loop failure lights **APU DET INOP**. The APU ground control panel in the right main wheel well has its own fire light, horn cutout, fire handle and bottle discharge switch.',
      ],
      deck: [['APU fire switch', 'Pull to shut down and isolate; rotate to discharge.'], ['APU DET INOP (amber)', 'APU detector loop failed.'], ['APU BOTTLE DISCHARGE (amber)', 'APU bottle discharged.']],
      related: ['fsw'],
    },
    {
      id: 'wheelwell', name: 'Main wheel well fire detection', at: [MLG.x, 1.6, 0],
      lead: 'One detector loop in the main wheel well — **detection only, no extinguisher**. The nose wheel well has no detection.',
      deck: [['WHEEL WELL (red)', 'Fire in the main gear wheel well, with FIRE WARN and the bell.']],
      related: ['fsw'],
    },
    {
      id: 'cargo', name: 'Cargo fire detection & suppression', at: [5.5, FLOOR_Y - 0.9, 0],
      lead: 'Dual-loop smoke detection in the forward and aft holds and two bottles in the air-conditioning mix bay on the forward wing spar.',
      how: [
        'Both loops normally must see smoke; DET SELECT can drop to a single loop, and a power failure in one loop converts automatically.',
        'Push the compartment\'s **ARMED** switch, then **DISCH**: the first bottle empties into it; the second follows **metered**, for a total of **195 minutes** (180 to land plus 15 for a missed approach, landing and unloading). If the system stays armed after landing, the second bottle is inhibited.',
        'The FWD/AFT light can go out, stay on or come back during the flight; if it comes back, FIRE WARN and the bell do too.',
      ],
      deck: [['FWD / AFT (red)', 'Smoke in that hold.'], ['ARMED · DISCH', 'Arm the hold, then discharge. DISCH (amber) lights within ~30 s.']],
      limits: [['Total suppression time', '195 min', 'FCOM 8.20']],
      related: ['fsw'],
    },
    {
      id: 'lav', name: 'Lavatory smoke detection', at: [-11.5, YC + 0.9, -0.8],
      lead: 'A smoke detector in each lavatory ceiling and an automatic extinguisher under each sink, aimed at the towel bin.',
      related: ['cargo'],
    },
    {
      id: 'test', name: 'Fire and overheat tests', at: [0.2, FLOOR_Y + 0.2, 0.2],
      lead: 'The TEST switch checks the detection; EXT TEST checks the bottle squibs.',
      how: [
        '**FAULT/INOP:** tests the fault circuits — FAULT and APU DET INOP light.',
        '**OVHT/FIRE:** tests both engines\' loops, the APU and the wheel well — FIRE WARN, bell, the fire switches, ENG OVERHEAT and WHEEL WELL light.',
        '**EXT TEST 1 / 2:** squib continuity for engine 1 + APU bottles, or engine 2 + APU — green lights.',
      ],
      related: ['fsw', 'loops1'],
    },
  ],

  build(K) {
    for (const [n, side] of [[1, -1], [2, 1]]) {
      for (const [a, r] of [[0.9, 1.0], [1.6, 1.0], [2.4, 0.94]]) {
        const pts = [];
        for (let i = 0; i <= 24; i++) {
          const t = (i / 24) * Math.PI * 2;
          pts.push(engPoint(n, a, Math.cos(t) * r * 0.82, Math.sin(t) * r * 0.82));
        }
        K.flow(`det${n}`, pts, { color: DET, part: n === 1 ? 'loops1' : 'loops2', r: 0.025 });
      }
      K.flow(`agent${n}`, [[-2.3, 1.75, -1.15], [-1.5, 1.7, side * 0.9], [1.2, 1.8, side * 2.4], engPoint(n, 1.6, 0.7, 0)],
        { color: '#f8f9fa', part: 'bottles', r: 0.045 });
    }
    K.unit('bottles', { sphere: [-2.3, 1.75, -1.0], r: 0.2 }, { color: BOT });
    K.unit('bottles', { sphere: [-2.3, 1.75, -1.4], r: 0.2 }, { color: BOT });
    K.unit('apufire', { sphere: [APU.x + 2.0, APU.y + 0.2, 0.3], r: 0.17 }, { color: BOT });
    K.flow('apuDet', [[APU.x + 0.3, APU.y + 0.3, -0.35], [APU.x + 1.7, APU.y + 0.3, -0.35], [APU.x + 1.7, APU.y + 0.3, 0.35], [APU.x + 0.3, APU.y + 0.3, 0.35]],
      { color: DET, part: 'apufire', r: 0.025 });
    K.flow('apuAgent', [[APU.x + 2.0, APU.y + 0.2, 0.3], [APU.x + 1.0, APU.y + 0.1, 0.1]], { color: '#f8f9fa', part: 'apufire', r: 0.04 });
    K.flow('wwDet', [[-1.6, 1.6, -1.0], [-4.2, 1.6, -1.0], [-4.2, 1.6, 1.0], [-1.6, 1.6, 1.0]], { color: DET, part: 'wheelwell', r: 0.025 });
    for (const [x0, x1] of [[9.5, 3.2], [-4.6, -9.6]]) {
      K.flow('cargoDet', [[x0, FLOOR_Y - 0.6, 0], [x1, FLOOR_Y - 0.6, 0]], { color: DET, part: 'cargo', r: 0.025 });
    }
    K.unit('cargo', { sphere: [1.3, 1.55, 0.4], r: 0.16 }, { color: BOT });
    K.unit('cargo', { sphere: [1.3, 1.55, 0.75], r: 0.16 }, { color: BOT });
    K.unit('lav', { sphere: [-11.5, YC + 0.9, -0.8], r: 0.08 }, { color: DET });
    K.unit('lav', { sphere: [13.0, YC + 0.9, -0.9], r: 0.08 }, { color: DET });
    K.unit('fsw', { box: [0.2, FLOOR_Y + 0.2, -0.2], size: [0.01, 0.01, 0.01] }, { color: R });
    K.unit('test', { box: [0.2, FLOOR_Y + 0.2, 0.2], size: [0.01, 0.01, 0.01] }, { color: R });
  },

  normal() {
    return {
      sw: { ovht1: 1, ovht2: 1, pull1: 0, pull2: 0, pullApu: 0, rot1: 0, rot2: 0, rotApu: 0, test: 1, ext: 1, armFwd: 0, armAft: 0, detSel: 1, detSelAft: 1 },
      fail: {},
      mem: { bottles: { L: true, R: true, apu: true, cargo: 2 }, out: {}, sig: '', cutSig: '', cargoDisch: false },
    };
  },

  action(st, key, label) {
    const m = st.mem, b = m.bottles;
    if (key === 'rot1' || key === 'rot2') {
      // Rotating a pulled fire switch fires the left or right bottle into that engine.
      const n = key === 'rot1' ? 1 : 2;
      if (!st.sw[`pull${n}`]) return;
      const bot = label === 'L' || label === 'DEC' ? 'L' : 'R';
      st.sw[key] = bot === 'L' ? -1 : 1;            // the handle stays turned
      if (b[bot]) { b[bot] = false; m.out[`fire${n}`] = true; }
    } else if (key === 'rotApu') {
      if (!st.sw.pullApu) return;
      st.sw.rotApu = label === 'L' || label === 'DEC' ? -1 : 1;
      if (b.apu) { b.apu = false; m.out.apuFire = true; }
    } else if (key === 'bell') m.cutSig = m.sig;   // silence what's showing now; a new warning rings again
    else if (key === 'cargoDisch') {
      if ((st.sw.armFwd || st.sw.armAft) && b.cargo === 2) { b.cargo = 1; m.cargoDisch = true; m.out.cargo = true; }
    }
  },

  evaluate(env, st) {
    const { sw, fail: f, mem: m } = st;
    const b = m.bottles;
    const testing = sw.test !== 1 ? (sw.test === 0 ? 'fault' : 'fire') : null;
    // Detection, per the loop logic.
    const detects = (n, cond) => {
      if (!cond) return false;
      const sel = sw[`ovht${n}`], aBad = !!f[`loopA${n}`], bBad = !!f[`loopB${n}`];
      if (sel === 1) return !(aBad && bBad);
      return sel === 0 ? !aBad : !bBad;
    };
    const fault = (n) => {
      const sel = sw[`ovht${n}`], aBad = !!f[`loopA${n}`], bBad = !!f[`loopB${n}`];
      return sel === 1 ? aBad && bBad : sel === 0 ? aBad : bBad;
    };
    const fire1 = detects(1, f.fire1 && !m.out.fire1), fire2 = detects(2, f.fire2 && !m.out.fire2);
    const ovht1 = detects(1, f.ovht1), ovht2 = detects(2, f.ovht2);
    const apuFire = !!f.apuFire && !m.out.apuFire && !f.apuLoop;
    const ww = !!f.wheelWell;
    const cargoF = !!f.cargoFwd && !m.out.cargo, cargoA = !!f.cargoAft && !m.out.cargo;
    const T = testing === 'fire';
    const anyFire = fire1 || fire2 || apuFire || ww || cargoF || cargoA || T;
    m.sig = [fire1, fire2, apuFire, ww, cargoF, cargoA, T].map(Number).join('');
    const bell = anyFire && m.sig !== m.cutSig;
    return {
      flows: {
        det1: fire1 || ovht1 || T, det2: fire2 || ovht2 || T, apuDet: apuFire || T, wwDet: ww || T, cargoDet: cargoF || cargoA,
        agent1: !!m.out.fire1, agent2: !!m.out.fire2,
        apuAgent: !b.apu, wwAgent: false,
      },
      units: {
        loops1: fault(1) ? 'fault' : fire1 || ovht1 ? 'fault' : 'on', loops2: fault(2) ? 'fault' : fire2 || ovht2 ? 'fault' : 'on',
        bottles: b.L && b.R ? 'on' : 'off', apufire: apuFire ? 'fault' : b.apu ? 'on' : 'off',
        wheelwell: ww ? 'fault' : 'on', cargo: cargoF || cargoA ? 'fault' : 'on', lav: 'on', fsw: 'on', test: 'on',
      },
      lights: {
        fireWarn: anyFire && bell, fsw1: fire1 || T, fsw2: fire2 || T, fswApu: apuFire || T,
        engOvht1: ovht1 || fire1 || T, engOvht2: ovht2 || fire2 || T,
        fault: (testing === 'fault') || fault(1) || fault(2), apuDetInop: testing === 'fault' || !!f.apuLoop,
        botL: !b.L, botR: !b.R, botApu: !b.apu, wheelWell: ww || T,
        cargoFwd: cargoF, cargoAft: cargoA, cargoDisch: m.cargoDisch, armFwd: !!sw.armFwd, armAft: !!sw.armAft,
        extTest: sw.ext !== 1 ? 'on' : false,
      },
      values: { cut1: !!sw.pull1, cut2: !!sw.pull2, cutApu: !!sw.pullApu },
      note: [
        fire1 && 'ENGINE 1 FIRE', fire2 && 'ENGINE 2 FIRE', apuFire && 'APU FIRE', ww && 'WHEEL WELL FIRE',
        (cargoF || cargoA) && 'CARGO FIRE', T && 'OVHT/FIRE test', (ovht1 || ovht2) && 'ENGINE OVERHEAT',
        sw.pull1 && 'Engine 1 fire switch pulled', sw.pull2 && 'Engine 2 fire switch pulled',
      ].filter(Boolean).join(' · '),
    };
  },
};
