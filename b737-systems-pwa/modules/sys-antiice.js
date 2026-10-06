// sys-antiice.js — FCOM chapter 3, anti-ice and rain, in our own words.

import { engPoint, wingLE, wingChord, wingY, ENG, YC } from './airframe.js?v=25';

const C = '#4cc9f0', HOT = '#ff6a3d', EL = '#f5a300';
const spar = (z, u, dy = 0) => [wingLE(z) - u * wingChord(z), wingY(z) + dy, z];
const WINDOWS = [['wh1', 'L SIDE'], ['wh2', 'L FWD'], ['wh3', 'R FWD'], ['wh4', 'R SIDE']];
// Probe heat: which probes each system (A, B) heats.
export const PROBES = {
  A: [['captPitot', 'CAPT\nPITOT'], ['lElev', 'L ELEV\nPITOT'], ['lAlpha', 'L ALPHA\nVANE'], ['temp', 'TEMP\nPROBE']],
  B: [['foPitot', 'F/O\nPITOT'], ['rElev', 'R ELEV\nPITOT'], ['rAlpha', 'R ALPHA\nVANE'], ['aux', 'AUX\nPITOT']],
};

export default {
  id: 'antiice', num: 3, title: 'Anti-Ice, Rain', fcom: 'FCOM 3', color: C,
  anchor: [9.5, 5.2, 7.5],
  view: { target: [8, 2.6, 2], dist: 34, dir: [0.75, 0.55, 0.9] },

  overview: {
    lead: 'Hot bleed air keeps ice off the **engine cowl lips** and the **three inboard slats** on each wing; electricity heats the **flight deck windows** and the **air data probes**. Wipers and a permanent rain-repellent coating clear the windshield. An ice detector advises.',
    how: [
      '**Engine anti-ice:** each ENG ANTI-ICE switch opens its cowl valve — bleed air from that engine heats its own inlet lip (works on the ground and in flight). A green **TAI** shows on the upper DU.',
      '**Wing anti-ice:** two AC motor valves send bleed air to the three inboard slats per wing (not the LE flaps or outboard slats), at any slat position. On the ground thrust and duct-temperature logic protect the slats; the switch trips OFF at lift-off.',
      'Either system ON in flight sets the **stall warning for icing** (stick shaker and minimum manoeuvre speed bars move); after wing anti-ice has been used in flight it stays set for the rest of the flight. The FMC VREF is **not** adjusted.',
      '**Windows:** No. 1 (forward) and No. 2 (side) have a heated conductive coating outside, against ice and for bird-strike strength; controllers hold their temperature and cut power on overheat. No. 3 is heated inside, against fog only, by thermal switches.',
      '**Probes:** pitots, alpha vanes and the TAT probe are heated (not the static ports). AUTO heats both A and B when either engine runs. On standby power only the captain\'s pitot is heated.',
    ],
    limits: [
      ['Icing conditions', 'OAT (ground) / TAT (flight) 10 °C or below with visible moisture, or contaminated ramps / taxiways / runways', 'FCOM SP.16'],
      ['Engine / wing anti-ice', 'Do not use with OAT (ground) / TAT (flight) above 10 °C', 'FCOM SP.16'],
      ['Engine ignition', 'ON for anti-ice operation', 'FCOM L.10'],
      ['Holding in icing with flaps extended', 'Prohibited', 'FCOM L.10'],
      ['Wipers', 'Not on a dry windshield (scratches)', 'FCOM 3.20'],
    ],
    memory: ['Engine anti-ice ON before entering icing conditions; ignition ON whenever anti-ice is used.'],
  },

  parts: [
    {
      id: 'cowl', name: 'Engine cowl anti-ice', at: engPoint(1, 0.05, 0.9, 0),
      lead: 'Each engine heats its own inlet lip with its own bleed air through an electrically controlled, pressure-actuated cowl valve.',
      how: [
        'Valve stuck away from the switch: COWL VALVE OPEN stays bright blue and the TAI indication turns amber after a short delay.',
        'COWL ANTI-ICE (amber): too much pressure in the duct between the cowl valve and the lip.',
        'With engine anti-ice on, the EEC selects approach idle and the igniters run (AUTO ignition).',
      ],
      deck: [['ENG ANTI-ICE 1 / 2 (OFF · ON)', 'Opens the cowl valve; sets icing stall-warning logic; green TAI on the upper DU.'], ['COWL VALVE OPEN (blue)', 'Dim: open. Bright: in transit or disagreeing with the switch.'], ['COWL ANTI-ICE (amber)', 'Duct overpressure downstream of the cowl valve.'], ['TAI (upper DU)', 'Green: valve open with switch ON. Amber: valve disagrees with switch.']],
      related: ['wingai', 'detector'],
    },
    {
      id: 'wingai', name: 'Wing anti-ice', at: spar(8.5, 0.02, 0.15),
      lead: 'Bleed air to the three inboard leading edge slats on each wing, then overboard. Not the LE (Krueger) flaps or the outboard slats.',
      how: [
        '**On the ground:** switch ON opens both valves only if both engines are below the takeoff-warning thrust and both distribution ducts are cool; either condition lost closes both (the switch stays ON) and they reopen when it clears. The switch trips OFF at lift-off.',
        '**In flight:** ON opens both valves (no thrust or temperature logic) and latches the icing stall-warning logic for the rest of the flight.',
      ],
      deck: [['WING ANTI-ICE (OFF · ON)', 'Both control valves.'], ['L / R VALVE OPEN (blue)', 'Dim: open. Bright: in transit or disagreeing with the switch.']],
      related: ['cowl'],
    },
    {
      id: 'windows', name: 'Flight deck window heat', at: [17.2, YC + 1.0, 0.6],
      lead: 'Windows 1 and 2 are glass–vinyl–glass with a heated outer coating; window 3 is two acrylic panes and is only heated inside against fog.',
      how: [
        'Controllers hold windows 1 and 2 warm — warm glass is tougher against a bird strike — and remove power if a window overheats. Thermal switches cycle window 3.',
        'The green ON light cycles off when the window is at temperature. Loss of power also lights OVERHEAT.',
        'Test switch: OVHT simulates an overheat; PWR TEST is a confidence test (Supplementary Procedures).',
        'WINDSHIELD AIR (pull, under each instrument panel) blows conditioned air onto window 1 to defog it; FOOT AIR warms the pilots\' legs.',
      ],
      deck: [['WINDOW HEAT L SIDE · L FWD · R FWD · R SIDE (ON · OFF)', 'FWD: window 1. SIDE: windows 2 (and 3).'], ['ON (green)', 'Heat being applied.'], ['OVERHEAT (amber)', 'Overheat — or power lost to that window.'], ['Test (OVHT · PWR TEST)', 'Spring-loaded to neutral.']],
      related: ['wipers', 'probes'],
    },
    {
      id: 'probes', name: 'Probe & sensor heat', at: [17.0, YC - 0.35, 1.25],
      lead: 'Electric heat for the three pitots, two elevator pitots, two alpha vanes and the TAT probe. Static ports are not heated.',
      how: [
        'System A heats the captain\'s pitot, left elevator pitot, left alpha vane and TAT probe; system B the first officer\'s, right elevator, right alpha vane and auxiliary pitot.',
        'AUTO powers both when either engine runs; ON powers them regardless. TAT TEST heats the TAT probe on the ground.',
        'On standby power only the captain\'s pitot is heated and its light does not show a failure; the standby airspeed pitot is unheated.',
      ],
      deck: [['PROBE HEAT A / B (ON · AUTO)', 'AUTO: on with either engine running.'], ['Probe lights (amber)', 'That probe is not heated (not meaningful on standby power).'], ['TAT TEST', 'Heats the TAT probe on the ground.']],
      related: ['windows'],
    },
    {
      id: 'detector', name: 'Ice detector', at: [16.6, YC - 0.75, -1.1],
      lead: 'An advisory probe on the forward left fuselage: ICING while it senses ice in flight, NO ICE once ice it had seen is gone (never both).',
      how: ['Both lights are inhibited on the ground; pressing one cancels it. A failed detector lights ICE DETECTOR on the overhead with MASTER CAUTION / ANTI-ICE. Residual ice may still be on the windows with NO ICE lit.'],
      deck: [['ICING (amber) / NO ICE (white)', 'Left forward panel; press to cancel.'], ['ICE DETECTOR (amber)', 'Ice detection system failed.']],
      related: ['cowl', 'wingai'],
    },
    {
      id: 'wipers', name: 'Windshield wipers', at: [17.6, YC + 0.7, -0.4],
      lead: 'Two wipers on the forward windows, each with its own selector: PARK · INT (every 7 s) · LOW · HIGH. A permanent rain-repellent coating helps.',
      deck: [['WIPER L / R (PARK · INT · LOW · HIGH)', 'PARK stops and stows the blade.']],
      limits: [['Dry windshield', 'Do not run the wipers (scratching)', 'FCOM 3.20']],
      related: ['windows'],
    },
  ],

  build(K) {
    for (const n of [1, 2]) {
      const s = n === 1 ? -1 : 1;
      K.unit('cowl', { cyl: [engPoint(n, -0.05, 0, 0), engPoint(n, 0.25, 0, 0)], r: ENG.r * 0.98 }, { color: C, glass: true });
      K.flow(`cowl${n}`, [engPoint(n, 2.2, 0.85, 0), engPoint(n, 1.0, 0.95, 0), engPoint(n, 0.1, 0.92, 0)], { color: HOT, part: 'cowl', r: 0.05 });
      K.flow(`wing${n}`, [spar(s * 3.2, 0.06, 0.02), spar(s * 5.9, 0.03, 0.05), spar(s * 11.2, 0.02, 0.05)], { color: HOT, part: 'wingai', r: 0.06 });
      K.unit('wingai', { sphere: spar(s * 3.2, 0.06, 0.02), r: 0.14 }, { color: HOT });
      K.unit('probes', { cyl: [[17.0, YC - 0.35, s * 1.1], [17.25, YC - 0.35, s * 1.25]], r: 0.03 }, { color: EL });
      K.unit('probes', { box: [16.8, YC + 0.15, s * 1.55], size: [0.12, 0.08, 0.02] }, { color: EL });
      K.unit('windows', { box: [17.25, YC + 1.0, s * 0.5], size: [0.5, 0.45, 0.6] }, { color: EL, glass: true });
      K.unit('windows', { box: [16.6, YC + 1.0, s * 1.15], size: [0.6, 0.4, 0.05] }, { color: EL, glass: true });
      K.unit('wipers', { cyl: [[17.45, YC + 0.75, s * 0.3], [17.25, YC + 1.15, s * 0.45]], r: 0.02 }, { color: '#343a40' });
    }
    K.unit('detector', { cyl: [[16.6, YC - 0.75, -1.05], [16.6, YC - 0.75, -1.3]], r: 0.03 }, { color: C });
    K.unit('probes', { cyl: [[16.2, YC - 0.9, -1.0], [16.2, YC - 1.05, -1.0]], r: 0.04 }, { color: EL });
  },

  normal(phase) {
    return {
      sw: { wh1: 0, wh2: 0, wh3: 0, wh4: 0, probeA: 1, probeB: 1, wing: 0, eng1: 0, eng2: 0, wiperL: 0, wiperR: 0, test: 1 },
      fail: {},
      mem: { seen: false, shaker: false, test: 0 },
    };
  },

  tick(dt, st, env) {
    const m = st.mem, before = m.test > 0;
    if (m.test > 0) m.test = Math.max(0, m.test - dt);
    // Wing anti-ice trips OFF at lift-off; icing stall logic latches in flight.
    if (env.air && st.sw.wing && m.air === false) st.sw.wing = 0;
    if (env.air && st.sw.wing) m.wingUsed = true;
    m.air = env.air;
    const was = m.seen;
    if (env.air && st.fail.icing) m.seen = true;
    return before !== m.test > 0 || was !== m.seen;
  },

  action(st, key, label) {
    if (key === 'test' && label === 'OVHT') st.mem.test = 3;
    if (key === 'icingCancel') st.mem.cancel = true;
  },

  evaluate(env, st) {
    const { sw, fail: f, mem } = st;
    const eng = [env.eng1, env.eng2];
    const engHeat = sw.probeA === 0 || eng[0] || eng[1];
    // Bleed for the wing: the duct sides from Air Systems when known.
    const ductL = env.ductL ?? (eng[0] || eng[1] || env.apu ? 30 : 0), ductR = env.ductR ?? ductL;
    const thrustHigh = env.phase === 'takeoff' && !env.air;
    const wingOpen = sw.wing && (env.air || (!thrustHigh && !f.wingDuct));
    const wingL = wingOpen && ductL > 0, wingR = wingOpen && ductR > 0;
    const cowl = [0, 1].map((i) => sw[`eng${i + 1}`] && !f[`cowl${i + 1}`]);
    const cowlAir = [0, 1].map((i) => cowl[i] && eng[i]);
    const lights = {};
    WINDOWS.forEach(([k], i) => {
      const ovht = !!f[`win${i + 1}`] || mem.test > 0;
      lights[`${k}on`] = sw[k] === 0 && !ovht;
      lights[`${k}ovht`] = ovht && sw[k] === 0;
    });
    for (const sys of ['A', 'B']) {
      const on = sw[`probe${sys}`] === 0 || eng[0] || eng[1];
      for (const [k] of PROBES[sys]) lights[k] = !on || !!f[k];
    }
    Object.assign(lights, {
      cowlAI1: !!f.cowlOvp1, cowlAI2: false,
      cowlOpen1: f.cowl1 && sw.eng1 ? true : cowl[0] ? 'dim' : false,
      cowlOpen2: f.cowl2 && sw.eng2 ? true : cowl[1] ? 'dim' : false,
      wingOpenL: sw.wing && !wingOpen ? true : wingOpen ? 'dim' : false,
      wingOpenR: sw.wing && !wingOpen ? true : wingOpen ? 'dim' : false,
      iceDet: !!f.iceDet,
      icing: env.air && !!f.icing && !f.iceDet,
      noIce: env.air && !f.icing && mem.seen && !f.iceDet,
    });
    const stall = env.air && (cowl[0] || cowl[1] || !!sw.wing || !!mem.wingUsed);
    const tai = [0, 1].map((i) => (f[`cowl${i + 1}`] && sw[`eng${i + 1}`] ? 'amber' : cowl[i] ? 'green' : ''));
    const iceWarn = env.air && f.icing && (!sw.eng1 || !sw.eng2);
    return {
      flows: { cowl1: cowlAir[0], cowl2: cowlAir[1], wing1: wingL, wing2: wingR },
      units: {
        cowl: cowlAir[0] || cowlAir[1] ? 'on' : f.cowl1 || f.cowl2 ? 'fault' : 'off', wingai: wingL || wingR ? 'on' : 'off',
        windows: WINDOWS.some(([k], i) => f[`win${i + 1}`]) ? 'fault' : WINDOWS.some(([k]) => sw[k] === 0) ? 'on' : 'off',
        probes: Object.values(PROBES).flat().some(([k]) => lights[k]) && (env.eng1 || env.eng2) ? 'fault' : engHeat ? 'on' : 'off',
        detector: f.iceDet ? 'fault' : 'on', wipers: sw.wiperL || sw.wiperR ? 'on' : 'off',
      },
      lights,
      values: { tai, stall, ductL, ductR, icing: !!f.icing, wiper: ['PARK', 'INT', 'LOW', 'HIGH'] },
      note: [iceWarn && 'Icing conditions — ENG ANTI-ICE should be ON', stall && 'Stall warning set for icing',
        sw.wing && !env.air && !wingOpen && 'Wing valves held closed (thrust / duct temperature)'].filter(Boolean).join(' · '),
    };
  },
};
