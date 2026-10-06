// sys-air.js — FCOM chapter 2: bleed air, air conditioning, pressurisation.
// Written in our own words; numbers cite the FCOM section.
//
// Pressurisation is a small model, not a certified one: packs push air in,
// the outflow valve (and leakage) let it out, relief valves cap the
// differential at 9.1 psi. AUTO/ALTN close the loop on the outflow valve to
// follow the FCOM differential schedule; MAN hands the valve to you.

import { ENG, engPoint, wingLE, wingChord, wingY, YC, APU, EE, FLOOR_Y } from './airframe.js?v=21';

const HOT = '#ff6a3d', COOL = '#15aabf', REC = '#82c91e', APUC = '#e8590c', OUT = '#868e96';
const spar = (z, u, dy = 0) => [wingLE(z) - u * wingChord(z), wingY(z) + dy, z];

// Standard atmosphere, psi ↔ feet.
const P0 = 14.696;
export const pAt = (ft) => P0 * Math.pow(1 - 6.8756e-6 * ft, 5.2559);
export const ftAt = (p) => (1 - Math.pow(p / P0, 1 / 5.2559)) / 6.8756e-6;
/** Cruise differential by selected FLT ALT — FCOM 2.40. */
export const diffFor = (fltAlt) => (fltAlt <= 28000 ? 7.45 : fltAlt <= 37000 ? 7.8 : 8.35);
const TIME = 6;          // pressurisation runs 6× real time so you can watch it
const LEAK = 0.004, VALVE = 0.08, PACK = 0.039;

export default {
  id: 'air', num: 2, title: 'Air Systems', fcom: 'FCOM 2', color: HOT,
  anchor: [0.4, 1.4, 0],
  view: { target: [0, 2.4, 0], dist: 40, dir: [0.75, 0.45, 0.75] },

  overview: {
    lead: 'Hot, high-pressure **bleed air** from the engines (or the APU, or a ground cart) is cooled and dried by two **packs**, mixed, piped through the cabin, and let out through the **outflow valve** — which is how the airplane is pressurised.',
    how: [
      'Bleed air also heats the wing and engine inlets (anti-ice) and pressurises the hydraulic reservoirs.',
      'Each engine bleeds from its **5th stage** and, when that isn\'t enough (low power), the **9th stage** through a high-stage valve. In takeoff, climb and most of cruise the 5th stage is enough.',
      'The bleed duct has a left and a right side joined by an **isolation valve**. Normally the left pack runs on engine 1\'s air and the right pack on engine 2\'s. The APU feeds the left side.',
      'The packs feed a **mix manifold** under the floor. The flight deck gets air straight from the left pack; everything else is mixed (with recirculated cabin air) and goes up sidewall risers into an overhead duct.',
      'Two identical **auto controllers** (AUTO and ALTN, swapping every flight) run the outflow valve; **MAN** gives it to the crew on a faster DC motor.',
    ],
    limits: [
      ['Max cabin differential (relief valves)', '9.1 psi', 'FCOM L.10'],
      ['Cabin altitude at max certified ceiling (41,000 ft)', '8,000 ft', 'FCOM 2.40'],
      ['Cruise diff · FLT ALT ≤ 28,000 ft', '7.45 psid', 'FCOM 2.40'],
      ['Cruise diff · 28,000–37,000 ft', '7.80 psid', 'FCOM 2.40'],
      ['Cruise diff · above 37,000 ft', '8.35 psid', 'FCOM 2.40'],
      ['Cabin altitude warning horn', '> 10,000 ft', 'FCOM 2.10'],
      ['APU bleed: max altitude', '17,000 ft', 'FCOM L.10'],
      ['Run the APU before using its bleed', '2 min', 'FCOM L.10'],
    ],
    memory: [
      'With one or both engine bleed switches ON, **do not run a pack in HIGH for takeoff, approach or landing** (fire/smoke checklists that call for HIGH take precedence).',
      'Never run more than one pack from one engine.',
      'DUAL BLEED on: keep thrust at idle.',
    ],
  },

  parts: [
    {
      id: 'bleed1', name: 'Engine bleed · ENG 1', at: engPoint(1, 3.3, 0.35, 0.2),
      lead: 'Air from engine 1\'s compressor — 5th stage normally, 9th stage through the high-stage valve when the 5th isn\'t enough.',
      how: [
        'The **engine bleed air valve** is a pressure regulator and shutoff valve: DC-armed by the switch, opened by the air itself. It also throttles back if the bleed air gets too hot.',
        'Trip sensors close it on **over-temperature or over-pressure** and light **BLEED TRIP OFF**. Once the fault clears, **TRIP RESET** reopens it.',
      ],
      deck: [
        ['BLEED 1 (OFF · ON)', 'ON opens the engine bleed air valve when the engine is running.'],
        ['BLEED TRIP OFF (amber)', 'Excessive bleed temperature or pressure — the valve has closed itself. Stays lit until reset.'],
        ['DUCT PRESSURE (L / R)', 'AC-powered gauge. Some L/R difference is normal as long as there is enough air for the packs and anti-ice.'],
      ],
      related: ['iso', 'packL', 'apubleed', 'wbovht'],
    },
    {
      id: 'bleed2', name: 'Engine bleed · ENG 2', at: engPoint(2, 3.3, 0.35, -0.2),
      lead: 'Engine 2\'s bleed: same valves and logic; normally feeds the right pack.',
      related: ['iso', 'packR'],
    },
    {
      id: 'apubleed', name: 'APU bleed valve', at: [APU.x + 1.4, APU.y + 0.1, -0.25],
      lead: 'Lets APU air into the **left** side of the bleed duct — for engine start and air conditioning on the ground.',
      how: [
        'DC-controlled and air-operated; closes by itself when the APU shuts down. The APU can supply **two packs on the ground or one pack in flight**.',
        'If the APU valve and an engine bleed valve are both open, with the engines above idle, APU air can back-pressure the engine\'s 9th-stage valve. **DUAL BLEED** warns whenever the switch and isolation-valve positions make that possible.',
      ],
      deck: [
        ['APU BLEED (OFF · ON)', 'ON opens the APU bleed valve when the APU runs.'],
        ['DUAL BLEED (amber)', 'APU bleed valve open together with engine 1 bleed ON, or engine 2 bleed ON with the isolation valve open. Thrust idle only.'],
      ],
      limits: [
        ['APU bleed: max altitude', '17,000 ft', 'FCOM L.10'],
        ['APU bleed + electrical in flight: max altitude', '10,000 ft', 'FCOM L.10'],
        ['Close APU bleed when ground air is connected with isolation valve open, or engine 1 bleed valve open, or isolation + engine 2 bleed valves open', '', 'FCOM L.10'],
      ],
      related: ['iso', 'bleed1'],
    },
    {
      id: 'iso', name: 'Isolation valve', at: [2.3, 1.55, 0],
      lead: 'Splits the bleed duct into left and right. AC-powered.',
      how: [
        'In **AUTO** it is **closed** when both engine bleed switches are ON **and** both pack switches are AUTO or HIGH — each engine then feeds its own pack. Turn any engine bleed or pack switch OFF and it **opens**, so one side can help the other.',
        'The APU bleed switch has no effect on it.',
      ],
      deck: [['ISOLATION VALVE (CLOSE · AUTO · OPEN)', 'AUTO as above; CLOSE and OPEN force it.']],
      related: ['bleed1', 'bleed2', 'packL', 'packR'],
    },
    {
      id: 'packL', name: 'Left pack', at: [0.3, 1.25, -0.95],
      lead: 'An air-conditioning pack in the left air-conditioning bay under the center wing. Normally runs on engine 1\'s air and also supplies the flight deck directly.',
      how: [
        'Bleed air is cooled in a **heat exchanger** (ram air as the coolant), refrigerated in an **air cycle machine**, mixed back with some hot bypass air to the right temperature, and dried in a **high-pressure water separator**.',
        'Over-temperature sensors close the pack valve and light **PACK**. Each pack has a primary and a standby control in opposite controllers; losing one lights PACK (on recall); losing both lights PACK and the pack runs uncontrolled until it overheats and trips.',
        'Flow: both packs in AUTO give normal flow. Airborne with **flaps up**, if one pack or one engine fails (or a pack is switched off), the other goes to **high flow by itself**. On the ground or with flaps out that is inhibited to protect single-engine performance — except on APU bleed alone.',
      ],
      deck: [
        ['L PACK (OFF · AUTO · HIGH)', 'AUTO: normal flow (or high flow automatically as above). HIGH: high flow; with the APU as the only source, maximum flow.'],
        ['PACK (amber)', 'Pack trip, or both its primary and standby controls failed (single control failure shows on recall).'],
      ],
      limits: [['A single pack in high flow can hold pressurisation and temperature up to the ceiling', '', 'FCOM 2.31']],
      related: ['ram', 'mix', 'packR', 'trim'],
    },
    {
      id: 'packR', name: 'Right pack', at: [0.3, 1.25, 0.95],
      lead: 'The right pack, normally on engine 2\'s air. Its output goes to the mix manifold.',
      related: ['packL', 'mix'],
    },
    {
      id: 'ram', name: 'Ram air system', at: [1.7, 0.98, 0.95],
      lead: 'Outside air through belly inlets cools the packs\' heat exchangers.',
      how: [
        'The packs move the ram inlet doors themselves: **fully open** on the ground and in slow flight with flaps out; modulating in cruise. **RAM DOOR FULL OPEN** (blue) shows when a door is fully open — normal on the ground.',
        '**Deflector doors** ahead of the inlets extend on the ground (air/ground sensor) to keep slush out before lift-off and after touchdown.',
      ],
      related: ['packL', 'packR'],
    },
    {
      id: 'mix', name: 'Mix manifold', at: [3.7, 1.55, 0],
      lead: 'Where right-pack air, extra left-pack air and recirculated cabin air are blended before going to the cabin.',
      how: ['On the ground a conditioned-air cart can be plugged into a connection under the belly; its air goes straight into the mix manifold and on to the cabin and flight deck, with the packs off.'],
      related: ['dist', 'recirc', 'trim'],
    },
    {
      id: 'dist', name: 'Cabin & flight deck distribution', at: [4, 4.55, 0],
      lead: 'Sidewall risers carry mixed air up to an **overhead duct** running the length of the cabin ceiling. The flight deck has its own supply straight from the left pack.',
      how: [
        'Flight deck outlets: floor diffusers under each seat, ceiling outlets, and a valve behind each pilot\'s rudder pedals for feet warming and No. 1 windshield defog.',
        'Cabin air leaves through floor-level grills, flows down around the **aft cargo** lining (heating it) and out through the outflow valve.',
      ],
      related: ['mix', 'ofv'],
    },
    {
      id: 'recirc', name: 'Recirculation fans', at: [6.2, 1.7, 0],
      lead: 'Draw cabin and E&E air through the forward cargo lining, filter it and send it back to the mix manifold — less work for the packs and less bleed from the engines.',
      how: ['In flight the right fan runs if both packs run unless both are in HIGH; the left fan runs if both packs run unless both are HIGH or L is AUTO with R HIGH. On the ground the left fan runs unless both packs are HIGH, the right one always (in AUTO).'],
      deck: [['L / R RECIRC FAN (OFF · AUTO)', 'AUTO lets the fan run per the logic above.']],
      related: ['mix', 'eqcool'],
    },
    {
      id: 'trim', name: 'Zone temperature & trim air', at: [3.0, 1.85, -0.6],
      lead: 'Three zones — flight deck, forward cabin, aft cabin. The packs make air cold enough for the zone that needs most cooling; **trim air** (hot bleed) is added to warm the other zones up to their selections.',
      how: [
        'Selector range roughly **18–30 °C** (65–85 °F). The right controller runs the forward cabin and is primary for the flight deck; the left one runs the aft cabin and backs up the flight deck.',
        'A zone duct overheat closes that zone\'s trim valve and lights **ZONE TEMP**; TRIP RESET reopens it once cool.',
        'All selectors OFF: the left pack holds 24 °C and the right 18 °C.',
      ],
      deck: [['TRIM AIR (OFF · ON)', 'Opens or closes the trim air pressure-regulating and shutoff valve.'], ['ZONE TEMP (amber)', 'Duct overheat, or (on recall) a zone control failure.']],
      related: ['mix', 'packL'],
    },
    {
      id: 'ofv', name: 'Outflow valve', at: [-11.2, 1.75, 1.35],
      lead: 'The main exit for cabin air — and the thing pressurisation actually controls. Lower aft fuselage.',
      how: [
        'Two **pressure relief valves** cap the differential at **9.1 psi**; a **negative relief valve** stops outside pressure ever exceeding cabin pressure.',
        'In AUTO/ALTN the controller climbs the cabin in proportion to the airplane, holds it in cruise (cruise mode within 0.25 psi of FLT ALT), descends it to just below LAND ALT, and lands slightly pressurised. On the ground at low power it drives the valve fully open; at takeoff power it pre-pressurises slightly.',
        'In **MAN** a separate DC motor (DC standby) moves the valve full travel in up to **20 seconds** — small movements make big cabin rates.',
      ],
      deck: [
        ['Pressurization mode (AUTO · ALTN · MAN)', 'ALTN uses the second controller; MAN bypasses both.'],
        ['OUTFLOW VALVE switch (CLOSE · OPEN)', 'Moves the valve in MAN.'],
        ['AUTO FAIL (amber)', 'Controller fault — with ALTN also lit: single failure, switched to ALTN automatically. Alone: both failed, use MAN.'],
        ['FLT ALT / LAND ALT', 'Set cruise altitude (−1,000 to 42,000 ft) and destination field elevation (−1,000 to 14,000 ft).'],
      ],
      limits: [
        ['Max differential (relief)', '9.1 psi', 'FCOM L.10'],
        ['AUTO FAIL: diff above', '8.75 psi', 'FCOM 2.40'],
        ['AUTO FAIL: cabin rate beyond', '±2,000 ft/min', 'FCOM 2.40'],
        ['AUTO FAIL: cabin altitude above', '15,800 ft', 'FCOM 2.40'],
        ['MAN full valve travel', '≤ 20 s', 'FCOM 2.40'],
      ],
      related: ['cpc', 'obev', 'dist'],
    },
    {
      id: 'obev', name: 'Overboard exhaust valve', at: [11.0, 1.35, 0.85],
      lead: 'Dumps warm E&E-bay air overboard on the ground and at low differential. At higher differential it closes and that air warms the forward cargo lining instead.',
      how: ['It is driven open if either pack is in HIGH and the right recirculation fan is off — the smoke-removal configuration.'],
      related: ['eqcool', 'ofv'],
    },
    {
      id: 'cpc', name: 'Cabin pressure controllers', at: [EE.x0 + 0.5, EE.y + 0.15, 0.6],
      lead: 'Two identical automatic controllers; one is primary each flight, the other waits as backup. They read static pressure, altitude and airspeed from the ADIRUs, thrust lever position and air/ground.',
      how: ['An **OFF SCHED DESCENT** light means the airplane started down before reaching the set FLT ALT; the controller then plans to land the cabin back at the takeoff field.'],
      related: ['ofv'],
    },
    {
      id: 'wbovht', name: 'Wing-body overheat detection', at: spar(-3.2, 0.06, -0.05),
      lead: 'Sensors along the hot ducts detect a **bleed duct leak**.',
      how: ['Left light: left engine strut, left inboard wing leading edge, left AC bay, keel beam, or APU bleed duct. Right light: right strut, right inboard leading edge, right AC bay. OVHT TEST lights both, plus MASTER CAUTION.'],
      deck: [['WING-BODY OVERHEAT (amber)', 'Overheat from a bleed air duct leak in that area.']],
      related: ['bleed1', 'iso', 'apubleed'],
    },
    {
      id: 'eqcool', name: 'Equipment cooling', at: [EE.x0 + 1.6, EE.y + 0.15, -0.6],
      lead: 'Supply and exhaust fans (each with a normal and an alternate) cool the flight-deck displays and the E&E bay.',
      deck: [['EQUIP COOLING SUPPLY / EXHAUST (NORM · ALTN)', 'Select the other fan if OFF lights: no airflow from the selected fan.']],
      related: ['obev', 'recirc'],
    },
  ],

  build(K) {
    // Engine bleeds: core → pylon → along the inboard LE → into the body.
    for (const [n, side] of [[1, -1], [2, 1]]) {
      const p = engPoint(n, 3.3, 0.35, -side * 0.2);
      K.unit(`bleed${n}`, { sphere: p, r: 0.2 }, { color: HOT });
      K.flow(`b${n}`, [p, engPoint(n, 2.6, 1.05, 0), spar(side * ENG.z, 0.06, 0), spar(side * 3.0, 0.07, -0.05),
        spar(side * 1.95, 0.1, -0.15), [2.3, 1.55, side * 0.55]], { color: HOT, part: `bleed${n}` });
      K.unit('wbovht', { cyl: [spar(side * 4.6, 0.05, 0.05), spar(side * 2.2, 0.08, -0.05)], r: 0.035 }, { color: '#fcc419' });
    }
    // Isolation valve; duct sides down into the AC bays.
    K.unit('iso', { sphere: [2.3, 1.55, 0], r: 0.2 }, { color: HOT });
    K.flow('iso', [[2.3, 1.55, -0.55], [2.3, 1.55, 0.55]], { color: HOT, part: 'iso', r: 0.08 });
    K.flow('dL', [[2.3, 1.55, -0.55], [1.2, 1.35, -0.95], [0.9, 1.25, -0.95]], { color: HOT, part: 'packL' });
    K.flow('dR', [[2.3, 1.55, 0.55], [1.2, 1.35, 0.95], [0.9, 1.25, 0.95]], { color: HOT, part: 'packR' });
    // APU bleed duct → left side.
    K.unit('apubleed', { sphere: [APU.x + 1.4, APU.y + 0.1, -0.25], r: 0.17 }, { color: APUC });
    K.flow('apuB', [[APU.x + 1.4, APU.y + 0.1, -0.25], [-14, 3.3, -0.8], [-6, 2.1, -1.2], [-1.5, 1.5, -1.2], [1.2, 1.35, -0.95]],
      { color: APUC, part: 'apubleed' });
    // Packs (AC bays), ram inlets.
    for (const side of [-1, 1]) {
      K.unit(side < 0 ? 'packL' : 'packR', { box: [0.3, 1.25, side * 0.95], size: [1.5, 0.5, 0.65] }, { color: COOL });
      K.unit('ram', { box: [1.7, 0.98, side * 0.95], size: [0.5, 0.06, 0.32] }, { color: '#74c0fc' });
      K.flow(side < 0 ? 'ramL' : 'ramR', [[1.9, 0.9, side * 0.95], [1.2, 1.1, side * 0.95], [0.2, 1.1, side * 1.1], [-0.6, 0.95, side * 1.0]],
        { color: '#74c0fc', part: 'ram', r: 0.05 });
      K.flow(side < 0 ? 'pL' : 'pR', [[-0.45, 1.25, side * 0.95], [-0.8, 1.45, side * 0.6], [1.5, 1.6, side * 0.25], [3.4, 1.55, side * 0.15]],
        { color: COOL, part: side < 0 ? 'packL' : 'packR' });
    }
    // Mix manifold, risers, overhead duct, flight deck supply.
    K.flow('pca', [[1.2, 0.98, 0.35], [2.4, 1.05, 0.25], [3.7, 1.25, 0]], { color: COOL, part: 'mix', r: 0.12 });
    K.unit('mix', { cyl: [[3.7, 1.25, 0], [3.7, 1.9, 0]], r: 0.38 }, { color: COOL });
    for (const side of [-1, 1]) {
      K.flow('cab', [[3.7, 1.7, side * 0.3], [3.9, FLOOR_Y + 0.2, side * 1.65], [4.0, 3.6, side * 1.75], [4.0, 4.5, side * 0.9], [4.0, 4.55, side * 0.15]],
        { color: COOL, part: 'dist', r: 0.08 });
    }
    K.flow('cab', [[11.5, 4.55, 0], [4, 4.6, 0], [-4, 4.6, 0], [-10.5, 4.5, 0]], { color: COOL, part: 'dist', r: 0.11 });
    K.flow('cab', [[4, 4.6, 0], [11.5, 4.55, 0]], { color: COOL, part: 'dist', r: 0.11 });
    K.flow('fd', [[-0.45, 1.25, -0.95], [2.5, 1.5, -1.25], [9, 1.7, -1.3], [13.6, 2.5, -1.0], [15.4, 3.4, -0.6]], { color: COOL, part: 'dist', r: 0.06 });
    // Trim air from the bleed manifold to the zone ducts.
    K.unit('trim', { box: [3.0, 1.85, -0.6], size: [0.35, 0.2, 0.25] }, { color: '#f783ac' });
    K.flow('trim', [[2.3, 1.55, -0.3], [3.0, 1.85, -0.6], [3.9, 2.4, -1.6]], { color: '#f783ac', part: 'trim', r: 0.04 });
    // Recirculation from the forward cargo area back to the mix manifold.
    K.unit('recirc', { cyl: [[6.2, 1.7, -0.35], [6.2, 1.7, 0.35]], r: 0.22 }, { color: REC });
    K.flow('recirc', [[7.6, 1.6, 0.6], [6.2, 1.7, 0.35], [4.2, 1.7, 0.2]], { color: REC, part: 'recirc', r: 0.06 });
    // Outflow: cabin air down the aft cargo lining to the outflow valve.
    K.unit('ofv', { box: [-11.2, 1.75, 1.35], size: [0.55, 0.45, 0.12] }, { color: OUT });
    K.flow('ofv', [[-6, 2.3, 1.3], [-9, 1.8, 1.3], [-11.2, 1.75, 1.35], [-11.5, 1.7, 1.9]], { color: OUT, part: 'ofv', r: 0.07 });
    K.unit('obev', { box: [11.0, 1.35, 0.85], size: [0.35, 0.3, 0.1] }, { color: OUT });
    K.flow('obev', [[EE.x0 + 1.6, EE.y + 0.15, -0.3], [11.0, 1.35, 0.85], [11.1, 1.2, 1.3]], { color: OUT, part: 'obev', r: 0.05 });
    K.unit('cpc', { box: [EE.x0 + 0.5, EE.y + 0.15, 0.6], size: [0.35, 0.28, 0.25] }, { color: '#adb5bd' });
    K.unit('eqcool', { cyl: [[EE.x0 + 1.6, EE.y + 0.15, -0.8], [EE.x0 + 1.6, EE.y + 0.15, -0.4]], r: 0.18 }, { color: '#adb5bd' });
  },

  normal(phase) {
    const g = phase === 'ground';
    return {
      sw: { bleed1: 1, bleed2: 1, apuBleed: g ? 1 : 0, iso: 1, packL: 1, packR: 1, trim: 1, recircL: 1, recircR: 1, mode: 0, ofvSw: 1 },
      fail: {},
      mem: { pc: null, ofv: g ? 1 : 0.3, fltAlt: 37000, landAlt: 0, cabRate: 0, lastCab: null },
    };
  },

  action(st, key, label) {
    const step = label === 'INC' ? 1 : -1;
    if (key === 'fltAltK') st.mem.fltAlt = Math.max(-1000, Math.min(42000, st.mem.fltAlt + 500 * step));
    else if (key === 'landAltK') st.mem.landAlt = Math.max(-1000, Math.min(14000, st.mem.landAlt + 50 * step));
    else if (key === 'ofvSw') {
      // Spring-loaded: each throw moves the valve a step (MAN only).
      if (st.sw.mode !== 2) return;
      st.mem.ofv = Math.max(0, Math.min(1, st.mem.ofv + (label === 'OPEN' ? 0.06 : -0.06)));
    }
  },

  air(env, st) {
    const { sw, fail: f } = st;
    const e1 = env.eng1 && !f.eng1, e2 = env.eng2 && !f.eng2;
    const apuOn = env.apu;
    const b1 = e1 && sw.bleed1 && !f.trip1, b2 = e2 && sw.bleed2 && !f.trip2;
    const ab = apuOn && sw.apuBleed;
    const isoAutoClosed = sw.bleed1 && sw.bleed2 && sw.packL && sw.packR;
    const isoOpen = sw.iso === 2 || (sw.iso === 1 && !isoAutoClosed);
    let L = b1 || ab, R = b2;
    if (isoOpen) { const any = L || R; L = R = any; }
    const pL = sw.packL > 0 && L && !f.packL, pR = sw.packR > 0 && R && !f.packR;
    // Auto high flow.
    const autoBoth = sw.packL === 1 && sw.packR === 1;
    const apuOnly = ab && !sw.bleed1 && !sw.bleed2;
    const singlePack = (pL ? 1 : 0) + (pR ? 1 : 0) === 1;
    const autoHigh = singlePack && autoBoth && ((env.air && env.flaps === 0 && sw.bleed1 && sw.bleed2) || apuOnly);
    const high = { L: pL && (sw.packL === 2 || autoHigh), R: pR && (sw.packR === 2 || autoHigh) };
    const units = (pL ? (high.L ? 1.5 : 1) : 0) + (pR ? (high.R ? 1.5 : 1) : 0);
    return { b1, b2, ab, isoOpen, L, R, pL, pR, high, units, apuOnly };
  },

  /** Cabin pressure the auto controller aims for in this phase. */
  target(env, m) {
    const pa = pAt(env.alt);
    if (!env.air && env.phase !== 'takeoff') return pa;                    // ground/rollout: open up
    if (env.phase === 'takeoff') return pAt(Math.max(0, env.alt - 300) - 200);
    return Math.min(pa + diffFor(m.fltAlt), P0 + 0.1);                      // cruise: scheduled differential
  },

  tick(dt, st, env) {
    const a = this.air(env, st);
    const m = st.mem, sw = st.sw, f = st.fail;
    const pa = pAt(env.alt);
    const target = this.target(env, m);
    if (m.pc == null) m.pc = target;
    const autoOk = sw.mode === 2 ? false : !(f.ctrl1 && f.ctrl2);
    const inflow = a.units * PACK;
    const diff = Math.max(0, m.pc - pa);
    if (autoOk) {
      if (!env.air && env.phase !== 'takeoff') m.ofv = Math.min(1, m.ofv + dt * 0.5);
      else {
        // Valve opening that would hold the target differential at this inflow.
        const want = Math.max(0, target - pa);
        const eq = want > 0.05 ? (inflow / Math.sqrt(want) - LEAK) / VALVE : 1;
        const err = (m.pc - target);
        m.ofv = Math.max(0, Math.min(1, eq + err * 2));
      }
    }
    const out = (LEAK + VALVE * m.ofv) * Math.sqrt(diff);
    const before = m.pc;
    let pc = m.pc + (inflow - out) * dt * TIME;
    pc = Math.min(pc, pa + 9.1);          // relief valves
    pc = Math.max(pc, pa);                // negative relief valve
    // On the ground with the valve open the cabin simply equals outside.
    if (!env.air && env.phase !== 'takeoff' && m.ofv > 0.95) pc = pa;
    m.pc = pc;
    const cab = ftAt(pc), cab0 = ftAt(before);
    m.cabRate = ((cab - cab0) / (dt * TIME)) * 60;
    return Math.abs(pc - before) > 1e-6 || Math.abs(m.cabRate) > 1;
  },

  evaluate(env, st) {
    const a = this.air(env, st);
    const { sw, fail: f, mem: m } = st;
    const pa = pAt(env.alt);
    // Before the first tick, start the cabin where the controller wants it.
    if (m.pc == null) m.pc = this.target(env, m);
    const pc = m.pc;
    const cab = Math.round(ftAt(pc) / 10) * 10;
    const diff = Math.max(0, pc - pa);
    const dual = a.ab && (sw.bleed1 || (sw.bleed2 && a.isoOpen));
    const ductPsi = (on) => (on ? (env.phase === 'takeoff' ? 42 : env.phase === 'ground' ? 38 : 32) : 0);
    const recircR = sw.recircR && (env.air ? a.pL && a.pR && !(sw.packL === 2 && sw.packR === 2) : true);
    const recircL = sw.recircL && (env.air ? a.pL && a.pR && !(sw.packL === 2 && sw.packR === 2) && !(sw.packL === 1 && sw.packR === 2)
      : !(sw.packL === 2 && sw.packR === 2));
    // Single controller fault: AUTO FAIL + ALTN (auto-transfer); selecting ALTN clears AUTO FAIL.
    // Both failed: AUTO FAIL alone until MAN is selected.
    const autoFail = ((f.ctrl1 || f.ctrl2) && sw.mode === 0) || (f.ctrl1 && f.ctrl2 && sw.mode !== 2);
    return {
      flows: {
        b1: a.b1, b2: a.b2, apuB: a.ab, iso: a.isoOpen && (a.L || a.R),
        dL: a.pL, dR: a.pR,
        pL: a.pL, pR: a.pR, ramL: a.pL, ramR: a.pR,
        pca: !!env.extAir,
        cab: a.pL || a.pR || recircL || recircR || !!env.extAir, fd: a.pL || !!env.extAir, trim: (a.pL || a.pR) && !!sw.trim,
        recirc: recircL || recircR, ofv: (a.pL || a.pR) && m.ofv > 0.02, obev: !env.air || diff < 2,
      },
      units: {
        bleed1: f.trip1 ? 'fault' : a.b1 ? 'on' : 'off', bleed2: f.trip2 ? 'fault' : a.b2 ? 'on' : 'off',
        apubleed: a.ab ? 'on' : 'off', iso: a.isoOpen ? 'on' : 'off',
        packL: f.packL ? 'fault' : a.pL ? 'on' : 'off', packR: f.packR ? 'fault' : a.pR ? 'on' : 'off',
        ram: a.pL || a.pR ? 'on' : 'off', mix: a.pL || a.pR || env.extAir ? 'on' : 'off', recirc: recircL || recircR ? 'on' : 'off',
        trim: sw.trim ? 'on' : 'off', ofv: 'on', obev: 'on', cpc: autoFail ? 'fault' : 'on',
        wbovht: f.wbL ? 'fault' : 'on', eqcool: 'on', dist: 'on',
      },
      lights: {
        dualBleed: dual, packL: !!f.packL, packR: !!f.packR, trip1: !!f.trip1, trip2: !!f.trip2,
        wbL: !!f.wbL, wbR: false,
        ramL: a.pL && (!env.air || env.flaps > 0), ramR: a.pR && (!env.air || env.flaps > 0),
        autoFail, altn: sw.mode === 1 || (sw.mode === 0 && (f.ctrl1 || f.ctrl2) && !(f.ctrl1 && f.ctrl2)),
        manual: sw.mode === 2, horn: cab > 10000,
      },
      values: {
        ductL: ductPsi(a.L), ductR: ductPsi(a.R), cab, diff: diff.toFixed(1), rate: Math.round((m.cabRate || 0) / 50) * 50,
        ofv: Math.round(m.ofv * 100), alt: env.alt, highL: a.high.L, highR: a.high.R, isoOpen: a.isoOpen,
        fltAlt: m.fltAlt, landAlt: m.landAlt,
      },
      note: [
        env.extAir && 'Conditioned air from the ground cart',
        dual && 'DUAL BLEED — thrust idle',
        (a.high.L || a.high.R) && `${a.high.L && a.high.R ? 'Both packs' : 'Pack'} in high flow`,
        a.isoOpen && 'Isolation valve open',
        cab > 10000 && 'CABIN ALTITUDE above 10,000 ft — horn',
      ].filter(Boolean).join(' · '),
    };
  },
};
