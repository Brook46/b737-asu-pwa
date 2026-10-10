// sys-warnings.js — FCOM chapter 15, in our own words. This system listens
// to all the others: the six-pack and MASTER CAUTION light from their real
// amber lights, the takeoff configuration warning reads flaps / speedbrake /
// parking brake, the cabin altitude warning reads the pressurisation model.
// GPWS envelopes follow gpws-pwa (same FCOM chapter), simplified to scenarios.

import { EE, YC, NOSE_X, FLIGHT_DECK_X, MLG } from './airframe.js?v=34';

const C = '#e85d04', RED = '#e03131';

// Six-pack: [label, side, sources [sys, light keys]].
export const SIXPACK = [
  ['FLT CONT', 'L', [['hydraulics', ['fcLpA', 'fcLpB', 'stbyLowQty', 'stbyLowPress']], ['flightcontrols', ['feelDiff', 'speedTrimFail', 'machTrimFail', 'autoSlatFail']]]],
  ['IRS', 'L', [['fms', ['faultL', 'faultR', 'onDcL', 'onDcR', 'dcFailL', 'dcFailR', 'gps', 'ils']], ['warnings', ['irs']]]],
  ['FUEL', 'L', [['fuel', ['lp1fwd', 'lp1aft', 'lp2fwd', 'lp2aft', 'lpCL', 'lpCR', 'filter1', 'filter2']]]],
  ['ELEC', 'L', [['electrical', ['xferOff1', 'xferOff2', 'srcOff1', 'srcOff2', 'drive1', 'drive2', 'stbyOff', 'batDischarge', 'trUnit', 'elec']]]],
  ['APU', 'L', [['engines', ['apuLowOil', 'apuFault', 'apuOverspeed']]]],
  ['OVHT/DET', 'L', [['fire', ['engOvht1', 'engOvht2', 'fault', 'apuDetInop']]]],
  ['ANTI-ICE', 'R', [['antiice', ['wh1ovht', 'wh2ovht', 'wh3ovht', 'wh4ovht', 'captPitot', 'lElev', 'lAlpha', 'temp', 'foPitot', 'rElev', 'rAlpha', 'aux', 'cowlAI1', 'cowlAI2', 'iceDet']]]],
  ['HYD', 'R', [['hydraulics', ['lpEng1', 'lpEng2', 'lpElec1', 'lpElec2', 'ovhtElec1', 'ovhtElec2']]]],
  ['DOORS', 'R', [['general', ['doors']]]],
  ['ENG', 'R', [['engines', ['eecAltn1', 'eecAltn2', 'engControl', 'reverser']]]],
  ['OVERHEAD', 'R', [['warnings', ['pseu']], ['general', ['exitNotArmed', 'coolOff', 'passOxyOn']]]],
  ['AIR COND', 'R', [['air', ['packL', 'packR', 'trip1', 'trip2', 'wbL', 'wbR', 'autoFail']]]],
];

// GPWS / windshear / TCAS scenarios the instructor can start.
export const SCENARIOS = [
  ['sink', 'Excessive descent rate'], ['closure', 'Terrain closure'], ['dontSink', 'Altitude loss after takeoff'],
  ['tooLow', 'Too low (config)'], ['gs', 'Below glideslope'], ['terrAhead', 'Terrain ahead (EGPWS)'],
  ['windshear', 'Windshear (in it)'], ['pws', 'Windshear ahead (radar)'], ['bank', 'Bank angle 40°'],
  ['traffic', 'Traffic (TCAS)'], ['overspeed', 'Overspeed'], ['stall', 'Approach to stall'],
];

export default {
  id: 'warnings', num: 15, title: 'Warning Systems', fcom: 'FCOM 15', color: C,
  anchor: [FLIGHT_DECK_X + 0.6, YC + 1.6, 0],
  view: { target: [12, 2.6, 0], dist: 26, dir: [0.8, 0.45, 0.85] },
  needsOthers: true,

  overview: {
    lead: 'Lights, sounds and a shaking column, graded by urgency: **red** needs action now, **amber** needs timely attention, **blue** is information, **green** is "extended / in position". Each warning has its own sound so you know what it is before you look.',
    how: [
      '**Sounds:** clacker = overspeed; warning tone = autopilot disconnect; intermittent horn = takeoff configuration *or* cabin altitude (the same sound!); steady horn = landing gear; bell = fire; voice = GPWS, windshear and TCAS. Most go quiet once the condition is gone.',
      '**MASTER CAUTION** lights when any amber caution comes on away from your normal field of view, with the matching **system annunciator** on the glareshield (six each side). Push it to reset; push an annunciator panel to recall everything that is still wrong.',
      'A single fault in a redundant system (a "simple fault") doesn\'t trigger MASTER CAUTION; it shows only on a recall.',
      '**GPWS** warns of terrain from radio altitude (descent rate, closure rate, altitude loss, too low, below glideslope) and, as **EGPWS**, looks ahead with a terrain database. **Windshear** from GPWS (in it) and weather radar (ahead). **TCAS** for traffic.',
    ],
    limits: [
      ['Cabin altitude warning', 'above 10,000 ft (resets 500–1,500 ft lower)', 'FCOM 15.20'],
      ['Takeoff flap range', 'flaps 1 to 25', 'FCOM 15.20'],
      ['Terrain display', 'Not for navigation', 'FCOM L.10'],
      ['Look-ahead terrain', 'Not within 15 nm of an airport not in the database', 'FCOM L.10'],
      ['Weather radar', 'Not in a hangar or with people near the radome', 'FCOM L.10'],
    ],
    memory: ['The takeoff configuration horn and the cabin altitude horn are the same sound — in the climb, it is the cabin.'],
  },

  parts: [
    {
      id: 'master', name: 'Master caution & annunciators', at: [FLIGHT_DECK_X + 0.95, YC + 1.25, -0.75],
      lead: 'FIRE WARN and MASTER CAUTION in front of each pilot, each with a six-light system annunciator panel for the systems on the overhead and fire panels.',
      how: [
        'Left: FLT CONT · IRS · FUEL · ELEC · APU · OVHT/DET. Right: ANTI-ICE · HYD · DOORS · ENG · OVERHEAD · AIR COND.',
        'Push MASTER CAUTION: both lights and the annunciators go out and the system re-arms. Push an annunciator panel: every existing caution comes back (and, held, all twelve light as a test).',
        'FIRE WARN pushed (or the bell cutout) silences the bell and resets for another fire.',
      ],
      deck: [['FIRE WARN (red)', 'Fire warning or test; push to silence the bell and reset.'], ['MASTER CAUTION (amber)', 'A system annunciator has lit; push to reset.'], ['System annunciator (amber)', 'Which system; push to recall.']],
      related: ['config'],
    },
    {
      id: 'config', name: 'Configuration warnings & PSEU', at: [EE.x0 + 1.2, EE.y, 0.4],
      lead: 'The PSEU checks takeoff and landing configuration, the gear and air/ground. On the ground, advancing a thrust lever with the airplane wrongly set sounds the intermittent horn and lights TAKEOFF CONFIG.',
      how: [
        '**Takeoff config:** flaps outside 1–25 (or skewed / asymmetric), LE devices not set, speedbrake lever not DOWN, ground spoiler interlock pressurised, parking brake set, stabiliser outside the green band.',
        '**Cabin altitude:** above 10,000 ft — intermittent horn and red CABIN ALTITUDE; ALT HORN CUTOUT silences the horn.',
        '**Gear horn (steady):** a gear not down and locked with — flaps up to 10, below 800 ft RA and a thrust lever near idle (cutout works above 200 ft); flaps 15–25 and a thrust lever near idle (no cutout); flaps above 25 regardless of thrust (no cutout).',
        'PSEU light (aft overhead): a PSEU fault on the ground; inhibited from thrust advance until 30 s after landing.',
      ],
      deck: [['TAKEOFF CONFIG (red)', 'Wrong configuration with thrust advanced on the ground.'], ['CABIN ALTITUDE (red)', 'Cabin above 10,000 ft.'], ['LANDING GEAR WARNING CUTOUT', 'Silences the gear horn at flaps up to 10 above 200 ft RA.'], ['PSEU (amber)', 'PSEU fault.']],
      related: ['master'],
    },
    {
      id: 'stall', name: 'Stall & overspeed warning', at: [EE.x0 + 2.2, EE.y + 0.2, -0.5],
      lead: 'Two SMYD computers drive a stick shaker on each column (either one shakes both); two ADIRU-based systems sound the overspeed clacker above Vmo/Mmo.',
      how: [
        'The SMYDs use the alpha vanes, ADIRUs, anti-ice switches, flap/slat position and air/ground. Shaker armed in flight, off on the ground. Anti-ice ON in flight moves it for icing.',
        'The clacker only stops when speed drops below Vmo/Mmo. Tests (aft overhead) work only on the ground.',
        'The speed tape shows red-and-black max/min bands and amber manoeuvre bars; AIRSPEED LOW sounds entering the lower amber bar.',
      ],
      deck: [['STALL WARNING TEST 1 / 2', 'Shakes the captain\'s (1) or F/O\'s (2) column — both move.'], ['MACH AIRSPEED WARNING TEST 1 / 2', 'Clacker. Ground only.']],
      related: ['gpws'],
    },
    {
      id: 'gpws', name: 'GPWS / EGPWS', at: [EE.x0 + 0.6, EE.y + 0.15, -0.6],
      lead: 'Radio-altitude-based alerts plus a worldwide terrain (and obstacle) database looking ahead. Red PULL UP on both attitude displays.',
      how: [
        '**Radio altitude based:** SINK RATE → PULL UP (descent rate) · TERRAIN TERRAIN → PULL UP (closure rate) · DON\'T SINK (altitude loss after takeoff / go-around) · TOO LOW GEAR / TOO LOW FLAPS / TOO LOW TERRAIN · GLIDESLOPE (below G/S, BELOW G/S light).',
        '**Look-ahead:** CAUTION TERRAIN 40–60 s from impact (solid amber on the ND), TERRAIN TERRAIN PULL UP 20–30 s (solid red); same for obstacles 100 ft and higher.',
        'Callouts: 2500, 1000, 500, 100, 50, 40, 30, 20, 10; APPROACHING MINIMUMS at +80 ft and MINIMUMS. BANK ANGLE at 35°, 40°, 45° (less near the ground).',
        'A real windshear warning inhibits all other GPWS alerts. A ground proximity alert does not guarantee terrain clearance.',
      ],
      deck: [['BELOW G/S P-INHIBIT (amber)', 'Below-glideslope alert; push below 1,000 ft RA to cancel.'], ['INOP (amber)', 'GPWS fault or invalid inputs.'], ['SYS TEST', 'Ground only.'], ['FLAP / GEAR / TERR INHIBIT (guarded)', 'Inhibit TOO LOW FLAPS / TOO LOW GEAR / look-ahead terrain and display.']],
      limits: [['Terrain display', 'Not for navigation', 'FCOM L.10']],
      related: ['windshear', 'tcas'],
    },
    {
      id: 'windshear', name: 'Windshear alerts', at: [NOSE_X - 0.8, YC, 0],
      lead: 'GPWS warns when you are **in** windshear (siren + WINDSHEAR, below 1,500 ft RA); the weather radar warns of windshear **ahead** (predictive, below 1,200 ft RA).',
      how: [
        'Predictive: WINDSHEAR AHEAD (takeoff) / GO AROUND WINDSHEAR AHEAD (approach) warnings, MONITOR RADAR DISPLAY caution, with a red-and-black symbol on the ND.',
        'Radar scans for windshear automatically with takeoff thrust set or low in flight; alerts are ready about 12 s later. New cautions are inhibited between 80 kt and 400 ft RA, new warnings between 100 kt and 50 ft RA on takeoff and landing.',
      ],
      limits: [['Weather radar', 'Not in a hangar or with people near the radome', 'FCOM L.10']],
      related: ['gpws'],
    },
    {
      id: 'tcas', name: 'TCAS', at: [FLIGHT_DECK_X - 2.5, YC + 1.95, 0],
      lead: 'Interrogates other transponders: TRAFFIC TRAFFIC (TA) about 40 s from closest approach, then a resolution advisory (RA) about 25 s, with pitch guidance on the PFD.',
      how: [
        'RAs need the other airplane\'s altitude reporting. INCREASE DESCENT inhibited below ~1,500 ft RA, DESCEND below ~1,100 ft, all RAs below ~1,000 ft (TA ONLY then shows), all TCAS voices below ~500 ft. GPWS and windshear warnings inhibit TCAS.',
        'Display range normally ±2,700 ft; ABV / BLW extends it to 7,000 ft above / below.',
      ],
      deck: [['Transponder mode (TA ONLY · TA/RA)', 'TA ONLY: traffic advisories only.'], ['Altitude range (ABV · N · BLW)', 'Shifts the display volume.']],
      related: ['gpws'],
    },
    {
      id: 'tailskid', name: 'Tail skid', at: [-14.5, YC - 1.9, 0],
      lead: 'A crushable honeycomb cartridge and a shoe under the tail, to absorb an over-rotation on takeoff or landing.',
      how: ['Its decal shows green-and-red while serviceable and all red when the cartridge must be replaced — check it soon after a tail strike (the fairing can sag back and mislead). Some airplanes have a two-position skid on system A.'],
      related: [],
    },
  ],

  build(K) {
    K.unit('master', { box: [FLIGHT_DECK_X + 0.95, YC + 1.25, -0.75], size: [0.06, 0.06, 0.18] }, { color: '#fab005' });
    K.unit('master', { box: [FLIGHT_DECK_X + 0.95, YC + 1.25, 0.75], size: [0.06, 0.06, 0.18] }, { color: '#fab005' });
    K.unit('config', { box: [EE.x0 + 1.2, EE.y, 0.4], size: [0.4, 0.3, 0.3] }, { color: C });
    K.unit('stall', { box: [EE.x0 + 2.2, EE.y + 0.2, -0.5], size: [0.35, 0.3, 0.25] }, { color: C });
    K.unit('gpws', { box: [EE.x0 + 0.6, EE.y + 0.15, -0.6], size: [0.4, 0.3, 0.3] }, { color: C });
    K.unit('windshear', { sphere: [NOSE_X - 0.8, YC, 0], r: 0.45 }, { color: C, glass: true });
    K.unit('tcas', { box: [FLIGHT_DECK_X - 2.5, YC + 1.95, 0], size: [0.4, 0.05, 0.25] }, { color: C });
    K.unit('tcas', { box: [FLIGHT_DECK_X - 4.5, YC - 1.95, 0], size: [0.4, 0.05, 0.25] }, { color: C });
    K.unit('gpws', { box: [MLG.x + 4.5, YC - 1.98, 0.3], size: [0.3, 0.03, 0.2] }, { color: C });
    K.unit('tailskid', { box: [-14.5, YC - 1.9, 0], size: [0.5, 0.25, 0.18] }, { color: '#868e96' });
    // Wires: everything reports to the master caution.
    K.flow('mc', [[EE.x0 + 1.2, EE.y + 0.2, 0.4], [FLIGHT_DECK_X - 0.5, YC + 0.4, 0], [FLIGHT_DECK_X + 0.95, YC + 1.2, -0.75]], { color: '#fab005', part: 'master', r: 0.025 });
    K.flow('mc', [[FLIGHT_DECK_X - 0.5, YC + 0.4, 0], [FLIGHT_DECK_X + 0.95, YC + 1.2, 0.75]], { color: '#fab005', part: 'master', r: 0.025 });
    K.flow('gp', [[EE.x0 + 0.6, EE.y + 0.3, -0.6], [NOSE_X - 0.9, YC - 0.2, 0]], { color: C, part: 'gpws', r: 0.025 });
  },

  normal(phase) {
    return {
      sw: { flapInh: 0, gearInh: 0, terrInh: 0, xpdr: 4, range: 1 },
      fail: {},
      mem: { ack: [], scen: null, t: 0, adv: false, gsCancel: false, hornCut: false },
    };
  },

  tick(dt, st) {
    if (!st.mem.scen) return false;
    const before = Math.floor(st.mem.t / 3);
    st.mem.t += dt;
    return Math.floor(st.mem.t / 3) !== before;
  },

  action(st, key, label, env) {
    const m = st.mem;
    if (key === 'mc') m.ack = activeCautions(env, st).map((c) => c.id);
    if (key === 'recall') m.ack = [];
    if (key === 'scen') { m.scen = m.scen === label ? null : label; m.t = 0; m.gsCancel = false; }
    if (key === 'advance') m.adv = !m.adv;
    if (key === 'gsCancel') m.gsCancel = true;
    if (key === 'hornCut') m.hornCut = true;
  },

  evaluate(env, st) {
    const { sw, mem: m, fail: f } = st;
    const res = (id) => env.resOf?.(id) || null;
    const fc = res('flightcontrols'), gear = res('gear'), air = res('air');
    // ── Master caution / six-pack ──
    const cautions = activeCautions(env, st);
    // A caution that has gone out may trigger MASTER CAUTION again next time.
    m.ack = m.ack.filter((id) => cautions.some((c) => c.id === id));
    const fresh = cautions.filter((c) => !m.ack.includes(c.id));
    const groups = {};
    for (const [label] of SIXPACK) groups[label] = fresh.some((c) => c.group === label);
    const master = fresh.length > 0;
    // ── Configuration warnings ──
    const flap = fc ? fc.values.flap : env.flaps;
    const toWhy = [];
    if (!env.air && m.adv) {
      if (!(flap >= 0.9 && flap <= 25.1)) toWhy.push('flaps not 1–25');
      if (fc && fc.values.sb !== 'DOWN') toWhy.push('speedbrake not DOWN');
      if (gear?.lights.park) toWhy.push('parking brake set');
      if (f.stab) toWhy.push('stab trim outside the green band');
    }
    const toConfig = toWhy.length > 0;
    const cabAlt = air ? +air.values.cab > 10000 : false;
    const gearDown = gear ? gear.values.pos > 0.999 : env.gearDown;
    const idle = env.phase === 'landing' || m.scen === 'tooLow';
    const gearHorn = env.air && !gearDown && (flap > 25 || (flap >= 15 && idle) || (idle && !m.hornCut));
    // ── GPWS / windshear / TCAS ──
    const s = m.scen, esc = m.t > 3;
    const gpws = [];
    const landingCfg = gearDown && flap >= 30;
    if (env.air && s) {
      if (s === 'windshear') gpws.push(['warning', 'WINDSHEAR, WINDSHEAR, WINDSHEAR', 100, 'ws']);
      if (s === 'sink') gpws.push(esc ? ['warning', 'WHOOP WHOOP PULL UP', 90, 'pu'] : ['caution', 'SINK RATE', 60, 'pu']);
      if (s === 'closure') gpws.push(esc && !landingCfg ? ['warning', 'TERRAIN TERRAIN — PULL UP', 90, 'pu'] : ['caution', 'TERRAIN TERRAIN', 70, 'pu']);
      if (s === 'terrAhead' && !sw.terrInh) gpws.push(esc ? ['warning', 'TERRAIN TERRAIN — PULL UP', 90, 'pu'] : ['caution', 'CAUTION TERRAIN', 80, 'terr']);
      if (s === 'dontSink') gpws.push(['caution', 'DON\'T SINK', 55, 'pu']);
      if (s === 'tooLow') {
        if (!gearDown) { if (!sw.gearInh) gpws.push(['caution', 'TOO LOW GEAR', 58, 'pu']); }
        else if (!landingCfg) { if (!sw.flapInh) gpws.push(['caution', 'TOO LOW FLAPS', 57, 'pu']); }
      }
      if (s === 'gs' && !m.gsCancel) gpws.push(['caution', 'GLIDESLOPE', 40, 'gs']);
      if (s === 'bank') gpws.push(['caution', 'BANK ANGLE, BANK ANGLE', 35, '']);
      if (s === 'pws') gpws.push(esc ? ['warning', 'GO AROUND, WINDSHEAR AHEAD', 85, 'pws'] : ['caution', 'MONITOR RADAR DISPLAY', 30, 'pws']);
    }
    // Predictive windshear on the takeoff roll (FCOM 15.20): warning "WINDSHEAR
    // AHEAD"; new warnings are inhibited from 100 kt to 50 ft RA — an alert that
    // started before stays.
    const pwsTakeoff = !env.air && s === 'pws' && (env.wheel || 0) > 0;
    if (pwsTakeoff) gpws.push(['warning', 'WINDSHEAR AHEAD, WINDSHEAR AHEAD', 85, 'pws']);
    const gpwsWarn = gpws.some((a) => a[0] === 'warning');
    let tcas = '';
    if (s === 'traffic' && env.air && sw.xpdr >= 3 && !gpwsWarn) tcas = esc && sw.xpdr === 4 && env.alt > 1000 ? 'RA' : 'TA';
    const aurals = [...gpws];
    if (tcas) aurals.push(tcas === 'RA' ? ['warning', 'CLIMB, CLIMB', 20, 'ra'] : ['caution', 'TRAFFIC, TRAFFIC', 10, 'ta']);
    if (env.air && s === 'overspeed') aurals.push(['warning', 'clacker (overspeed)', 95, '']);
    if (env.air && s === 'stall') aurals.push(['warning', 'stick shaker', 99, '']);
    if (toConfig || cabAlt) aurals.push(['warning', 'intermittent horn', 97, '']);
    if (gearHorn) aurals.push(['warning', 'steady horn (gear)', 96, '']);
    aurals.sort((a, b) => b[2] - a[2]);
    const pullUp = gpws.some((a) => a[3] === 'pu' && (a[0] === 'warning' || a[1] !== 'GLIDESLOPE'));
    const top = aurals[0];
    return {
      flows: { mc: master, gp: gpws.length > 0 },
      units: {
        master: master ? 'fault' : 'on', config: toConfig || cabAlt || gearHorn ? 'fault' : 'on', stall: env.air && (s === 'stall' || s === 'overspeed') ? 'fault' : 'on',
        gpws: gpws.length ? 'fault' : 'on', windshear: s === 'windshear' || s === 'pws' ? 'fault' : 'on', tcas: tcas ? 'fault' : 'on', tailskid: 'off',
      },
      lights: {
        master, ...Object.fromEntries(Object.entries(groups).map(([k, v]) => ['sp_' + k, v])),
        toConfig, cabAlt, belowGs: gpws.some((a) => a[3] === 'gs'), gpwsInop: !!f.gpwsInop, pseu: !!f.pseu, irs: !!f.irs,
      },
      values: {
        cautions, fresh: fresh.length, aurals, top: top ? top[1] : '', pullUp, windshear: s === 'windshear' || pwsTakeoff ? 'red' : (s === 'pws' && env.air) ? (esc ? 'red' : 'amber') : '',
        terrain: s === 'terrAhead' && env.air && !sw.terrInh ? (esc ? 'red' : 'amber') : '', tcas, toWhy, gearHorn, shaker: env.air && s === 'stall',
      },
      note: [top && `🔊 ${aurals.slice(0, 3).map((a) => a[1]).join(' + ')}`, toConfig && `TAKEOFF CONFIG: ${toWhy.join(', ')}`, cabAlt && 'CABIN ALTITUDE',
        s && !env.air && 'GPWS / TCAS / shaker are inhibited on the ground — pick Takeoff or Cruise',
        master && `MASTER CAUTION · ${Object.keys(groups).filter((k) => groups[k]).join(' · ')}`].filter(Boolean).join(' · '),
    };
  },
};

/** Every amber caution that feeds the six-pack right now: [{ id, group }]. */
export function activeCautions(env, st) {
  const out = [];
  for (const [group, , srcs] of SIXPACK) {
    for (const [sys, keys] of srcs) {
      const lights = sys === 'warnings' ? { irs: !!st.fail.irs, pseu: !!st.fail.pseu } : env.resOf?.(sys)?.lights;
      if (!lights) continue;
      for (const k of keys) if (lights[k] && lights[k] !== 'dim') out.push({ id: `${sys}.${k}`, group });
    }
  }
  return out;
}
