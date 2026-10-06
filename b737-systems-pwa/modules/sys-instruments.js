// sys-instruments.js — FCOM chapter 10, flight instruments and displays, in
// our own words. Display switching is live: fail a DU or a DEU, or turn a
// selector, and the six screens in the 3D cockpit change format.

import { EE, YC, FLIGHT_DECK_X } from './airframe.js?v=22';

const C = '#8338ec', AIRC = '#4dabf7';
export const DUS = ['capOut', 'capIn', 'upper', 'lower', 'foIn', 'foOut'];
const DU_NAME = { capOut: 'CAPT OUTBD', capIn: 'CAPT INBD', upper: 'UPPER', lower: 'LOWER', foIn: 'F/O INBD', foOut: 'F/O OUTBD' };
const IAS = { ground: 0, takeoff: 158, cruise: 268, approach: 145, landing: 92 };

export default {
  id: 'instruments', num: 10, title: 'Flight Instruments', fcom: 'FCOM 10', color: C,
  anchor: [FLIGHT_DECK_X + 0.6, YC + 1.3, 0.9],
  view: { target: [14, 2.6, 0], dist: 22, dir: [0.7, 0.45, 1] },
  needsOthers: true,

  overview: {
    lead: 'Six flat-panel display units (DUs): each pilot\'s **PFD** (outboard) and **ND** (inboard), the **upper** DU for primary engines and fuel, the **lower** for secondary engines or systems. Two **display electronic units** (DEUs) drive them from two **ADIRUs**; standby instruments run on their own sensors.',
    how: [
      'DEU 1 normally drives the captain\'s two DUs and the upper; DEU 2 the first officer\'s and the lower. Each DEU gets data from both ADIRUs; if one DEU fails, the other drives all six (DSPLY SOURCE annunciates) and each pilot still has independent sources.',
      '**Automatic switching:** outboard DU fails → PFD moves inboard; inboard fails → that DU blanks; upper fails → engines move to the lower (compact if needed). No automatic switching for the lower DU.',
      '**Air data:** three pitot probes (captain, first officer, auxiliary) and six static ports. Captain\'s pitot and statics → air data modules → left ADIRU; first officer\'s → right; auxiliary pitot and alternate statics → standby instruments. No cross-connection.',
      '**Standby:** ISFD (own inertial sensors, auxiliary pitot / alternate static, battery bus) or standby attitude + altimeter/airspeed, standby RMI and the magnetic compass.',
    ],
    limits: [
      ['RVSM: Capt vs F/O altitude in flight', 'max 200 ft difference', 'FCOM L.10'],
      ['Standby altimeters', 'do not meet RVSM accuracy', 'FCOM L.10'],
      ['AOA DISAGREE', 'L/R differ > 10° for > 10 s (above 400 ft RA)', 'FCOM 10.11'],
      ['ISFD initialisation', '~10 s then 90 s, airplane still', 'FCOM 10.21'],
    ],
    memory: ['One bad airspeed: compare captain, first officer and standby — the odd one out is wrong (QRH Airspeed Unreliable).'],
  },

  parts: [
    {
      id: 'dus', name: 'Display units & switching', at: [FLIGHT_DECK_X + 0.75, YC + 0.95, -0.4],
      lead: 'Captain outboard (PFD) and inboard (ND), upper (engines), lower (secondary engines / systems), first officer inboard (ND) and outboard (PFD).',
      how: [
        'Display select panels (left and right forward panels): **MAIN PANEL DUs** — OUTBD PFD · NORM · ENG PRI · PFD · MFD; **LOWER DU** — ENG PRI · NORM · ND. Use them for failures the system doesn\'t detect.',
        'Brightness: remote light sensors on the glareshield plus each DU\'s own sensor, trimmed with the brightness controls.',
      ],
      deck: [['MAIN PANEL DUs selector', 'OUTBD PFD · NORM · ENG PRI (engines to the inboard DU) · PFD (PFD inboard) · MFD.'], ['LOWER DU selector', 'ENG PRI (engines to the lower DU) · NORM · ND.']],
      related: ['deu'],
    },
    {
      id: 'deu', name: 'Display electronic units (DEUs)', at: [EE.x0 + 2.4, EE.y + 0.15, 0.3],
      lead: 'Two DEUs take data from airplane sensors and systems and draw the six displays.',
      how: ['The DISPLAYS **SOURCE** selector (1 · AUTO · 2) is for maintenance on the ground; any single-DEU operation shows DSPLY SOURCE 1 or 2 on the PFDs. The **CONTROL PANEL** selector (BOTH ON 1 · NORMAL · BOTH ON 2) lets one EFIS control panel run both sides if one fails.'],
      deck: [['DISPLAYS SOURCE (1 · AUTO · 2)', 'Which DEU drives the displays.'], ['CONTROL PANEL (BOTH ON 1 · NORMAL · BOTH ON 2)', 'Which EFIS control panel controls the displays.']],
      related: ['dus', 'adiru'],
    },
    {
      id: 'adiru', name: 'ADIRUs & air data modules', at: [EE.x0 + 1.0, EE.y + 0.1, -0.3],
      lead: 'Two air data inertial reference units give attitude, heading, position, speed and altitude to the displays, FMC, flight controls, engines and everything else.',
      how: ['Four air data modules turn pitot and static pressure into data — one per pitot and one at the balance point of each side\'s static ports. The ADIRUs are covered in more detail with FMS / Navigation.'],
      related: ['pitot', 'deu'],
    },
    {
      id: 'pitot', name: 'Pitot-static system & AOA', at: [17.0, YC - 0.4, 1.3],
      lead: 'Three pitots — the captain\'s on the left, the first officer\'s and the auxiliary on the right — six flush static ports, two alpha vanes and a TAT probe.',
      how: [
        'Each air data module connects only to its own side\'s probe — so a blocked captain\'s pitot shows on the captain\'s PFD only. The standby instruments use the auxiliary pitot and alternate statics.',
        'AOA DISAGREE (amber, both PFDs): the two vanes differ by more than 10° for over 10 s — it doesn\'t say which one is wrong.',
        'TAT is not a substitute for OAT; SAT (from the ADIRUs) is on the CDU PROGRESS page.',
      ],
      related: ['adiru', 'standby'],
    },
    {
      id: 'standby', name: 'Standby instruments (ISFD)', at: [FLIGHT_DECK_X + 0.75, YC + 1.05, -0.2],
      lead: 'The ISFD shows attitude (own inertial sensors), airspeed and altitude (auxiliary pitot, alternate static), localizer / glideslope (MMR 1) and magnetic heading (ADIRU 1). Battery bus powered.',
      how: [
        'Battery switch ON → about 10 s, then a 90 s initialisation (ATT, INIT 90s) — the airplane must stay still. ATT:RST needs the attitude reset, wings level and unaccelerated for 10 s.',
        'Some airplanes have separate standby attitude (gyro ready ~60 s, accurate after 3 min) and altimeter/airspeed (−1,000 to 50,000 ft). The standby RMI is on the AC standby bus. Check heading against the magnetic compass.',
      ],
      limits: [['Standby altimeters', 'not RVSM accurate', 'FCOM L.10']],
      related: ['pitot'],
    },
    {
      id: 'clocks', name: 'Clocks', at: [FLIGHT_DECK_X + 0.8, YC + 0.9, -0.95],
      lead: 'Two electronic clocks (time/date above, elapsed time / chronograph below), set from GPS UTC or manually; standby DC keeps their time base when the airplane is powered down.',
      related: ['dus'],
    },
  ],

  build(K) {
    K.unit('dus', { box: [FLIGHT_DECK_X + 0.75, YC + 0.95, 0], size: [0.05, 0.25, 1.6] }, { color: C });
    K.unit('deu', { box: [EE.x0 + 2.4, EE.y + 0.15, 0.3], size: [0.35, 0.3, 0.25] }, { color: C });
    K.unit('deu', { box: [EE.x0 + 2.4, EE.y + 0.15, -0.3], size: [0.35, 0.3, 0.25] }, { color: C });
    K.unit('adiru', { box: [EE.x0 + 1.0, EE.y + 0.1, -0.3], size: [0.4, 0.3, 0.3] }, { color: C });
    K.unit('adiru', { box: [EE.x0 + 1.0, EE.y + 0.1, 0.3], size: [0.4, 0.3, 0.3] }, { color: C });
    K.unit('standby', { box: [FLIGHT_DECK_X + 0.78, YC + 1.05, -0.2], size: [0.04, 0.09, 0.09] }, { color: '#fab005' });
    K.unit('clocks', { box: [FLIGHT_DECK_X + 0.8, YC + 0.9, -0.95], size: [0.04, 0.07, 0.07] }, { color: C });
    for (const s of [-1, 1]) {
      K.unit('pitot', { cyl: [[17.0, YC - 0.4, s * 1.2], [17.25, YC - 0.4, s * 1.32]], r: 0.03 }, { color: AIRC });
      K.unit('pitot', { box: [16.8, YC + 0.15, s * 1.55], size: [0.12, 0.08, 0.02] }, { color: AIRC });
      K.unit('pitot', { cyl: [[15.2, YC - 0.2, s * 1.86], [15.2, YC - 0.2, s * 1.9]], r: 0.06 }, { color: AIRC });
      const side = s < 0 ? 'L' : 'R';
      K.flow(`air${side}`, [[17.0, YC - 0.4, s * 1.2], [15.5, YC - 0.9, s * 0.9], [EE.x0 + 1.0, EE.y + 0.1, s * 0.3]], { color: AIRC, part: 'pitot', r: 0.025 });
      K.flow(`deu${side}`, [[EE.x0 + 2.4, EE.y + 0.3, s * 0.3], [FLIGHT_DECK_X, YC + 0.3, s * 0.4], [FLIGHT_DECK_X + 0.75, YC + 0.9, s * 0.5]], { color: C, part: 'deu', r: 0.025 });
    }
    K.flow('stby', [[17.0, YC - 0.4, 1.3], [16.2, YC + 0.2, 0.4], [FLIGHT_DECK_X + 0.78, YC + 1.0, -0.2]], { color: '#fab005', part: 'standby', r: 0.02 });
  },

  normal() {
    return { sw: { source: 1, cp: 1, capMain: 1, capLower: 1, foMain: 1, foLower: 1 }, fail: {}, mem: {} };
  },

  evaluate(env, st) {
    const { sw, fail: f } = st;
    const du = { capOut: 'PFD', capIn: 'ND', upper: 'ENG', lower: 'SYS', foIn: 'ND', foOut: 'PFD' };
    // Display select panels (manual), then automatic switching for failures.
    for (const [side, main, lower] of [['cap', sw.capMain, sw.capLower], ['fo', sw.foMain, sw.foLower]]) {
      const out = side + 'Out', inb = side + 'In';
      if (main === 0) du[inb] = '';
      if (main === 2) { du[inb] = 'ENG'; du.upper = ''; }
      if (main === 3) { du[inb] = 'PFD'; du[out] = ''; }
      if (main === 4) du[inb] = 'SYS';
      if (lower === 0) { du.lower = 'ENG'; du.upper = ''; }
      if (lower === 2) du.lower = 'ND';
      if (f[out]) { du[inb] = 'PFD'; du[out] = 'X'; }
      if (f[inb]) du[inb] = 'X';
    }
    if (f.upper) { du.upper = 'X'; du.lower = 'ENG'; }
    if (f.lower) du.lower = 'X';
    // Power: on standby power (battery / AC standby) only the captain's two
    // DUs and the upper DU stay; with nothing at all every screen is dark.
    if (env.acPower === false) {
      for (const k of ['foOut', 'foIn', 'lower']) du[k] = '';
      if (!env.bus?.acStby) for (const k of DUS) du[k] = '';
    }
    // DEUs.
    const deu1 = !f.deu1 && sw.source !== 2 && (env.acPower !== false || !!env.bus?.acStby), deu2 = !f.deu2 && sw.source !== 0 && env.acPower !== false;
    const single = !(deu1 && deu2) && env.acPower !== false;
    if (!deu1 && !deu2) for (const k of DUS) du[k] = 'X';
    const srcAnn = !single ? '' : deu1 ? 'DSPLY SOURCE 1' : deu2 ? 'DSPLY SOURCE 2' : '';
    // Air data: each side from its own pitot; standby from the auxiliary.
    const ias = env.ias ?? (env.air ? IAS[env.phase] : env.wheel) ?? 0;
    const antiice = env.resOf?.('antiice');
    const iced = !!(antiice?.lights.captPitot && env.air && antiice.values.icing);
    const capBad = !!f.capPitot || iced;
    const capIas = capBad ? (env.air ? Math.round(ias * 0.6) : 0) : ias;
    const aoaDis = !!f.aoa && env.air && env.alt > 400;
    return {
      flows: { airL: !f.capPitot, airR: true, deuL: deu1, deuR: deu2, stby: !f.isfd },
      units: {
        dus: DUS.some((k) => du[k] === 'X') ? 'fault' : 'on', deu: single ? 'fault' : 'on', adiru: 'on',
        pitot: capBad || aoaDis ? 'fault' : 'on', standby: f.isfd ? 'fault' : 'on', clocks: 'on',
      },
      lights: { cdsFault: single, aoaDis },
      values: { du, duName: DU_NAME, srcAnn, capIas, foIas: ias, stbyIas: f.isfd ? null : ias, aoaDis, cpBoth: sw.cp !== 1 ? `BOTH ON ${sw.cp === 0 ? 1 : 2}` : '' },
      note: [srcAnn, capBad && env.air && `Captain IAS ${capIas} vs F/O ${ias} vs standby ${ias} — captain's is the odd one out`, aoaDis && 'AOA DISAGREE',
        DUS.filter((k) => du[k] === 'X').map((k) => `${DU_NAME[k]} blank`).join(', ')].filter(Boolean).join(' · '),
    };
  },
};
