// sys-general.js — FCOM chapter 1, airplane general: lights, passenger
// signs, emergency lighting, doors, oxygen and the flight deck door, in our
// own words. Exterior lights show on the 3D airplane.

import { YC, FUS_R, TIP_Z, wingLE, wingY, NLG, MLG, EE } from './airframe.js?v=37';

const C = '#6b7280';
const FD_DOOR_X = 15.0;      // flight deck door, just aft of the flight deck
const DOORS = [
  ['fwdEntry', 'FWD ENTRY', [14.4, YC - 0.2, -FUS_R]], ['fwdSvc', 'FWD SERVICE', [14.4, YC - 0.2, FUS_R]],
  ['aftEntry', 'AFT ENTRY', [-13.6, YC - 0.2, -FUS_R]], ['aftSvc', 'AFT SERVICE', [-13.6, YC - 0.2, FUS_R]],
  ['fwdCargo', 'FWD CARGO', [8.5, YC - 1.3, FUS_R * 0.85]], ['aftCargo', 'AFT CARGO', [-7.5, YC - 1.3, FUS_R * 0.85]],
  ['equip', 'EQUIP', [11.5, YC - 1.95, 0]],
];
export { DOORS };

export default {
  id: 'general', num: 1, title: 'Airplane General', fcom: 'FCOM 1', color: C,
  anchor: [2, YC + 2.6, 0],
  view: { target: [0, 2.6, 0], dist: 52, dir: [0.6, 0.55, 0.9] },
  needsOthers: true,

  overview: {
    lead: 'The airplane itself: exterior and interior **lighting**, **passenger signs**, **emergency lighting**, **doors and exits**, **oxygen** for crew and passengers, the secured **flight deck door** and emergency equipment.',
    how: [
      '**Exterior lights:** landing lights in the wing roots (fixed; some airplanes also retractable ones under the fuselage), runway turnoff lights in the wing roots, a taxi light on the nose gear, logo lights on the stabiliser lighting the fin, red/green/white position lights, white strobes on the wingtips and tail, red anti-collision beacons top and bottom, wing (ice inspection) and wheel well lights.',
      '**Signs:** FASTEN BELTS in AUTO come on with flaps or gear extended and go off when both are up. A low chime sounds in the cabin when signs change. (On some airplanes the NO SMOKING signs are on permanently.)',
      '**Emergency lights:** ARMED (guarded) — they come on by themselves if DC bus 1 fails or AC is lost; batteries keep them lit for evacuation inside and outside. The aft attendant panel can also switch them on.',
      '**Exits:** entry and service doors fore and aft; overwing exits with a DC **flight lock** that locks for takeoff, flight and landing. Flight deck crew can leave through the sliding No. 2 windows.',
    ],
    limits: [
      ['Entry / service doors', 'not operated in steady wind over 40 kt; not left open in gusts over 65 kt', 'FCOM 1.40'],
      ['Passenger oxygen deploys', 'cabin altitude 14,000 ft (or switch ON)', 'FCOM 1.40'],
      ['Passenger oxygen duration', '~12 min (some airplanes ~22 min), can\'t be stopped', 'FCOM 1.40'],
      ['Crew oxygen pressure breathing', 'above 27,000 ft (on fitted masks)', 'FCOM 1.40'],
      ['Smoke hood (PBE)', '~15 to over 20 min', 'FCOM 1.40'],
    ],
    memory: ['EMER EXIT LIGHTS must be ARMED for flight — NOT ARMED lights amber with MASTER CAUTION (OVERHEAD).'],
  },

  parts: [
    {
      id: 'lights', name: 'Exterior lights', at: [wingLE(3.6), wingY(3.6), 3.6],
      lead: 'Landing, runway turnoff and taxi lights for the ground and approach; position, strobe and anti-collision lights so others see you; logo, wing and wheel well lights.',
      how: [
        'POSITION: STROBE & STEADY (position lights + white strobes) · OFF · STEADY (position lights only).',
        'ANTI COLLISION: red beacons on top and bottom of the fuselage — on before engine start and whenever engines are running.',
        'WING: lights the wing leading edge and engine nacelle for ice inspection. WHEEL WELL: for the walk-round.',
      ],
      deck: [['LANDING L / R (OFF · ON)', 'Fixed landing lights in the wing roots.'], ['RUNWAY TURNOFF L / R', 'Wing-root lights pointing to the sides ahead.'], ['TAXI', 'On the nose gear strut.'], ['LOGO', 'Lights the tail logo.'], ['POSITION (STROBE & STEADY · OFF · STEADY)', 'Position and strobe lights.'], ['ANTI COLLISION', 'Red beacons.'], ['WING', 'Wing leading edge (ice).'], ['WHEEL WELL', 'Wheel well lights.']],
      related: ['signs'],
    },
    {
      id: 'signs', name: 'Passenger signs & cabin', at: [0, YC + 1.3, 0],
      lead: 'NO SMOKING and FASTEN BELTS / RETURN TO SEAT, each OFF · AUTO · ON, on the forward overhead.',
      how: ['AUTO: belts on with flaps or gear extended, off when both are retracted. A low chime with each change. Cabin lighting: window, ceiling, entry and reading lights.'],
      deck: [['NO SMOKING (OFF · AUTO · ON)', 'Some airplanes: permanently on.'], ['FASTEN BELTS (OFF · AUTO · ON)', 'AUTO follows flaps / gear.']],
      related: ['emergency'],
    },
    {
      id: 'emergency', name: 'Emergency lighting', at: [-4, YC + 1.0, 0],
      lead: 'Aisle, exit and ceiling lights, exit signs, floor path marking and exterior slide lights, on their own batteries.',
      how: [
        'EMER EXIT LIGHTS: OFF (won\'t come on if power fails) · ARMED (guarded: on automatically if DC bus 1 or AC power is lost) · ON.',
        'A guarded switch on the aft attendant panel overrides the flight deck and turns them on. The flight deck dome light has its own emergency bulb.',
      ],
      deck: [['EMER EXIT LIGHTS (OFF · ARMED · ON)', 'Guarded ARMED.'], ['NOT ARMED (amber)', 'Switch not in ARMED.']],
      related: ['doors'],
    },
    {
      id: 'doors', name: 'Doors & exits', at: [14.4, YC - 0.2, -FUS_R],
      lead: 'Entry doors (left) and service doors (right) fore and aft, cargo doors on the lower right, the E/E access door underneath, and overwing exits.',
      how: [
        'Overwing exits lock (DC flight lock) when three of the four entry/service doors are closed, an engine is running, and the airplane is in the air or both thrust levers are advanced; otherwise — or with DC lost — they unlock.',
        'Door lights on the aft overhead with the DOORS annunciator: a door not closed and locked, or a flight lock not engaged on the takeoff roll or in flight. A flight-lock fault lights PSEU (inhibited from takeoff until 30 s after landing).',
      ],
      deck: [['Door lights (amber)', 'That door / exit not closed and locked.'], ['LEFT / RIGHT OVERWING', 'Overwing exit or flight lock.']],
      limits: [['Doors in wind', 'not in steady winds > 40 kt; not open in gusts > 65 kt', 'FCOM 1.40']],
      related: ['fddoor'],
    },
    {
      id: 'oxygen', name: 'Oxygen', at: [5, YC + 1.25, 0.9],
      lead: 'Crew: quick-donning masks at each seat from a high-pressure cylinder (up to 1,850 psi). Passengers: chemical oxygen generators in the PSUs, four masks each.',
      how: [
        'Passenger masks drop automatically at a cabin altitude of 14,000 ft or with PASS OXY ON (aft overhead); PASS OXY ON lights with OVERHEAD / MASTER CAUTION. Pulling one mask starts that unit; 100 % oxygen flows for about 12 min (or ~22) and can\'t be stopped.',
        'Passenger oxygen does not protect against smoke — don\'t use it for smoke below 14,000 ft. Crew masks give pressure breathing above 27,000 ft (where fitted). Smoke hoods (PBE): 15–20+ min.',
      ],
      deck: [['CREW OXYGEN pressure', 'Cylinder pressure (battery ON).'], ['PASS OXY (NORMAL · ON)', 'ON drops the masks.'], ['PASS OXY ON (amber)', 'Passenger oxygen activated.']],
      limits: [['Masks drop', '14,000 ft cabin', 'FCOM 1.40']],
      related: ['emergency'],
    },
    {
      id: 'fddoor', name: 'Flight deck door', at: [FD_DOOR_X, YC - 0.2, 0],
      lead: 'Bullet- and intrusion-resistant, opens into the cabin; locked whenever it\'s closed with power on, unlocked without power.',
      how: [
        'Lock selector (spring-loaded to AUTO): UNLKD — unlocked while held; AUTO — locked, opens after the emergency code plus a timer unless the crew acts; DENY — rejects the code for a while.',
        'AUTO UNLK (amber): the emergency code was entered — flashes with a chime until the door unlocks. LOCK FAIL (amber): the lock failed in AUTO, or the access system switch is off.',
      ],
      deck: [['FLT DK DOOR (UNLKD · AUTO · DENY)', 'Push in to turn to UNLKD.'], ['LOCK FAIL (amber)', 'Lock failed.'], ['AUTO UNLK (amber)', 'Emergency code entered.']],
      related: ['doors'],
    },
    {
      id: 'dimensions', name: 'Dimensions', at: [0, 0, 0], zoom: 62, dir: [0.05, 1, 0.12],
      lead: 'The principal dimensions of the two models in the fleet, both with winglets. Wingspan, tailplane span, main gear track and height are the same; the -900ER is 2.64 m (8 ft 8 in) longer, most of it between the gears.',
      how: [
        '**737-800W:** overall length 39.47 m (129 ft 6 in), body 38.02 m (124 ft 9 in), wheelbase (nose gear to main gear) 15.60 m (51 ft 2 in).',
        '**737-900ER W:** overall length 42.11 m (138 ft 2 in), body 40.67 m (133 ft 5 in), wheelbase 17.17 m (56 ft 4 in).',
        '**Both:** wingspan 35.79 m (117 ft 5 in) over the winglets, tailplane span 14.35 m (47 ft 1 in), main gear track 5.72 m (18 ft 9 in); height to the top of the fin about 12.62 m (41 ft 5 in) and to the tailplane about 6.76 m (22 ft 2 in).',
        'Heights are for reference only — they change with weight, fuel and strut extension. For real clearance planning use the airport / facilities planning data.',
      ],
      limits: [
        ['Wingspan (winglets)', '35.79 m · 117 ft 5 in', 'FCOM 1.10'],
        ['Length -800 / -900ER', '39.47 m · 129 ft 6 in / 42.11 m · 138 ft 2 in', 'FCOM 1.10'],
        ['Wheelbase -800 / -900ER', '15.60 m · 51 ft 2 in / 17.17 m · 56 ft 4 in', 'FCOM 1.10'],
        ['Main gear track', '5.72 m · 18 ft 9 in', 'FCOM 1.10'],
        ['Tailplane span', '14.35 m · 47 ft 1 in', 'FCOM 1.10'],
        ['Height (fin top, reference)', '≈ 12.62 m · 41 ft 5 in', 'FCOM 1.10'],
      ],
      related: ['turning', 'doors'],
    },
    {
      id: 'turning', name: 'Turning radius & ground manoeuvring', at: [-2.9, 0, -4], zoom: 88, dir: [0.05, 1, 0.12],
      lead: 'In a tight turn the wingtip sweeps the widest arc and sets the obstacle clearance — everything else stays inside it. The figures assume the effective steering angle of 75°, a slow continuous turn on minimum thrust and no differential braking.',
      how: [
        '**Steering:** the tiller turns the nose wheel up to 78° each way; the rudder pedals up to 7°. The turning-radius figures use an effective steering angle of 75°.',
        '**737-800W:** nose radius 20.1 m (66.0 ft), wingtip 23.0 m (75.3 ft), tail 22.8 m (74.8 ft); minimum pavement width for a 180° turn 24.3 m (79.7 ft).',
        '**737-900ER W:** nose 21.8 m (71.4 ft), wingtip 23.4 m (76.7 ft), tail 23.9 m (78.6 ft); minimum pavement for a 180° turn 26.3 m (86.4 ft).',
        '**Turning away from an obstacle:** the nose and wingtip swing outward, so don\'t start a turn away from something that is close — inside 5.4 m (17.8 ft) of the wingtip or 7.4 m (24.3 ft) of the nose on the -800, 5.0 m (16.4 ft) and 6.6 m (21.8 ft) on the -900ER.',
        'For towing and pushback a lockout pin in the nose gear towing lever depressurises nose wheel steering, so the tug can turn the gear without the hydraulics fighting it.',
      ],
      deck: [['Nose wheel steering tiller', 'Up to 78° each way; overrides the pedals.'], ['Rudder pedals', 'Up to 7° of nose wheel steering.'], ['NOSE WHEEL STEERING switch', 'NORM: system A · ALT: system B.']],
      limits: [
        ['Nose wheel steering, tiller / pedals', '78° / 7° each way', 'FCOM 14.10'],
        ['Effective steering angle (radius figures)', '75°', 'FCOM 1.10'],
        ['180° turn, min pavement -800 / -900ER', '24.3 m · 79.7 ft / 26.3 m · 86.4 ft', 'FCOM 1.10'],
        ['Wingtip radius -800 / -900ER', '23.0 m · 75.3 ft / 23.4 m · 76.7 ft', 'FCOM 1.10'],
        ['Nose radius -800 / -900ER', '20.1 m · 66.0 ft / 21.8 m · 71.4 ft', 'FCOM 1.10'],
        ['Tail radius -800 / -900ER', '22.8 m · 74.8 ft / 23.9 m · 78.6 ft', 'FCOM 1.10'],
        ['No turn away from an obstacle within -800', 'wingtip 5.4 m · 17.8 ft / nose 7.4 m · 24.3 ft', 'FCOM 1.10'],
        ['No turn away from an obstacle within -900ER', 'wingtip 5.0 m · 16.4 ft / nose 6.6 m · 21.8 ft', 'FCOM 1.10'],
      ],
      related: ['dimensions'],
    },
  ],

  build(K) {
    const glow = (part, p, color, r = 0.12) => K.unit(part, { sphere: p, r }, { color });
    // Exterior lights (they glow when on: the part's unit state).
    for (const s of [-1, 1]) {
      glow('lights', [wingLE(s * 3.4) + 0.05, wingY(3.4) + 0.05, s * 3.4], '#fff3bf');
      glow('lights', [wingLE(s * (TIP_Z - 0.3)), wingY(TIP_Z - 0.3) + 0.2, s * (TIP_Z - 0.3)], s < 0 ? '#ff4d4f' : '#40c057', 0.16);
      glow('lights', [-17.8, 4.3, s * 6.0], '#f8f9fa', 0.1);
    }
    glow('lights', [NLG.x, 1.3, 0.15], '#fff3bf', 0.1);
    glow('lights', [2, YC + FUS_R + 0.05, 0], '#ff4d4f', 0.15);
    glow('lights', [2, YC - FUS_R - 0.05, 0], '#ff4d4f', 0.15);
    glow('lights', [-19.6, 4.8, 0], '#f8f9fa', 0.1);
    K.unit('signs', { box: [0, YC + 1.25, 0], size: [22, 0.03, 0.5] }, { color: '#adb5bd', glass: true });
    K.unit('emergency', { box: [-1, YC - 0.55, 0], size: [26, 0.03, 0.12] }, { color: '#ffd43b' });
    for (const [k, , p] of DOORS) K.unit('doors', { box: p, size: [0.9, 1.6, 0.06] }, { color: C });
    for (const s of [-1, 1]) for (const x of [0.2, -0.8]) K.unit('doors', { box: [x, YC + 0.1, s * FUS_R], size: [0.5, 0.9, 0.06] }, { color: C });
    K.unit('oxygen', { box: [5, YC + 1.25, 0.9], size: [20, 0.06, 0.25] }, { color: '#74c0fc' });
    K.unit('oxygen', { cyl: [[EE.x0 + 0.2, EE.y, 0.75], [EE.x0 + 1.2, EE.y, 0.75]], r: 0.12 }, { color: '#40c057' });
    K.unit('fddoor', { box: [FD_DOOR_X, YC + 0.3, 0], size: [0.06, 1.9, 0.8] }, { color: C });
    K.unit('lights', { sphere: [MLG.x, 1.9, 0.3], r: 0.06 }, { color: '#fff3bf' });
  },

  normal(phase) {
    const g = phase === 'ground', t = phase === 'takeoff', l = phase === 'landing' || phase === 'approach';
    return {
      sw: {
        llL: t || l ? 1 : 0, llR: t || l ? 1 : 0, rtoL: t || l ? 1 : 0, rtoR: t || l ? 1 : 0, taxi: t || l ? 1 : 0, logo: phase === 'cruise' ? 0 : 1,
        pos: g ? 2 : 0, beacon: g ? 0 : 1, wingLt: 0, wwLt: 0,
        exitLt: 1, smoke: 1, belts: 1, gpuCart: 0, acCart: 0, coolSup: 0, coolExh: 0, passOxy: 0, fdDoor: 1,
      },
      fail: {},
      mem: { open: g ? { fwdEntry: true, fwdCargo: true } : {}, dropped: false, oxyT: 0 },
    };
  },

  tick(dt, st, env) {
    const m = st.mem;
    if (m.dropped && m.oxyT < 12 * 60) { m.oxyT += dt * 30; return Math.floor((m.oxyT - dt * 30) / 60) !== Math.floor(m.oxyT / 60); }
    return false;
  },

  action(st, key, label) {
    if (key.startsWith('door:')) { const d = key.slice(5); st.mem.open[d] = !st.mem.open[d]; }
    if (key === 'code') st.mem.code = !st.mem.code;
  },

  evaluate(env, st) {
    const { sw, fail: f, mem: m } = st;
    const air = env.resOf?.('air'), fc = env.resOf?.('flightcontrols'), gear = env.resOf?.('gear');
    const flaps = fc ? fc.values.flap > 0.5 : env.flaps > 0;
    const gearOut = gear ? gear.values.pos > 0 : env.gearDown;
    const belts = sw.belts === 2 || (sw.belts === 1 && (flaps || gearOut));
    const powerLost = !!f.dcBus1;
    const emerOn = sw.exitLt === 2 || (sw.exitLt === 1 && powerLost);
    const cab = air ? +air.values.cab : 0;
    if ((cab > 14000 || sw.passOxy === 1) && !m.dropped) { m.dropped = true; m.oxyT = 0; }
    const engRun = env.eng1 || env.eng2;
    const closed = ['fwdEntry', 'fwdSvc', 'aftEntry', 'aftSvc'].filter((d) => !m.open[d]).length;
    const flightLock = closed >= 3 && engRun && (env.air || env.phase === 'takeoff') && !powerLost;
    const owOpen = !!f.overwing;
    const doorLights = Object.fromEntries(DOORS.map(([k]) => ['door_' + k, !!m.open[k]]));
    const anyOpen = Object.values(doorLights).some(Boolean) || owOpen;
    const exterior = ['llL', 'llR', 'rtoL', 'rtoR', 'taxi', 'logo', 'beacon', 'wingLt', 'wwLt'].some((k) => sw[k]) || sw.pos !== 1;
    const oxyLeft = Math.max(0, 12 - Math.floor(m.oxyT / 60));
    return {
      flows: {},
      units: {
        lights: exterior ? 'on' : 'off', signs: belts ? 'on' : 'off', emergency: emerOn ? 'on' : sw.exitLt !== 1 ? 'fault' : 'off',
        doors: anyOpen ? 'fault' : 'on', oxygen: m.dropped ? 'fault' : 'on', fddoor: f.lockFail ? 'fault' : 'on',
      },
      lights: {
        exitNotArmed: sw.exitLt !== 1, coolOff: !!f.cool, coolOffSup: !!f.cool && sw.coolSup === 0, coolOffExh: false,
        passOxyOn: m.dropped, lockFail: !!f.lockFail, autoUnlk: m.code ? 'flash' : false,
        doors: anyOpen, overwingL: owOpen, overwingR: false,
        ...doorLights,
      },
      values: { belts, emerOn, flightLock, cab, dropped: m.dropped, oxyLeft, crewOxy: f.crewOxy ? 600 : 1650, open: m.open },
      note: [belts ? 'FASTEN BELTS on' : 'FASTEN BELTS off', emerOn && 'Emergency lights ON', sw.exitLt !== 1 && 'EMER EXIT LIGHTS not armed',
        m.dropped && `Passenger masks dropped — oxygen ~${oxyLeft} min left`, anyOpen && `Open: ${DOORS.filter(([k]) => m.open[k]).map(([, n]) => n).join(', ') || 'overwing exit'}`,
        engRun && `Overwing flight locks ${flightLock ? 'LOCKED' : 'unlocked'}`].filter(Boolean).join(' · '),
    };
  },
};

