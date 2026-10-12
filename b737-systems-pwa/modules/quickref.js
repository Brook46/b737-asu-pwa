import { SUPPLEMENTARY } from './supplementary.js?v=49';
import { wizardHtml, wizardAct, wizardClick, wizardKey, wizardInput, coldHtml } from './supp-advisor.js?v=49';
import { procsHtml, procClick, openProc } from './supp-procs.js?v=49';
import { CUES, cueHtml } from './cues.js?v=49';

// quickref.js — Quick Reference: QRH memory items, non-normal maneuvers
// (done from memory), the limitations a pilot must know by heart (#) and the
// other key numbers, plus every number cited on the system pages.
//
// Source: 737 QRH (Quick Action Index, Rev 57, 30 Sep 2025), QRH.pdf. A memory
// item is every step above the dashed separator in its checklist, worded as
// printed, with its Condition. Markup: **bold** as printed; `red` / `amber`
// boxes are the QRH Warning! / Caution! boxes; `fire` tags the fire items.
// A study aid only: the QRH in the airplane governs.

// Step builders: n = step number, a = action, m = middle ("Confirm"), v = value,
// sub = indented lines (strings, or [action, value] rows), go = ►► instruction.
const R = (n, a, v, m, sub = []) => ({ k: 'row', n, a, v, m, sub });
const P = (n, a, sub = []) => ({ k: 'txt', n, a, sub });
const GO = (a) => ({ k: 'go', a });
const BOX = (a, lvl = 'caution') => ({ k: 'box', a, lvl });

export const MEMORY = [
  { t: 'Aborted Engine Start', ref: 'QRH 7.1', cond: ['On the ground, an aborted engine start is needed.'],
    steps: [R(1, 'Engine start lever (affected engine)', 'CUTOFF')] },
  { t: 'Airspeed Unreliable', ref: 'QRH 10.1', cond: ['Airspeed or Mach indications are suspected to be unreliable.'],
    steps: [R(1, 'Autopilot (if engaged)', 'Disengage'), R(2, 'Autothrottle (if engaged)', 'Disengage'), R(3, 'F/D switches (both)', 'OFF'),
      P(4, 'Set the following gear up pitch attitude and thrust:', [['Flaps extended', '10° and 80% N1'], ['Flaps up', '4° and 75% N1']])] },
  { t: 'APU FIRE', ref: 'QRH 8.1', fire: true, cond: ['Fire is detected in the APU.'],
    steps: [R(1, 'APU fire switch', 'Pull, rotate to the stop, and hold for 1 second', 'Confirm'), R(2, 'APU switch', 'OFF')] },
  { t: 'CABIN ALTITUDE WARNING or Rapid Depressurization', ref: 'QRH 2.1', tag: ['CABIN ALTITUDE', 'red'],
    cond: ['One or more of these occur:', ['A cabin altitude exceedance', 'In flight, the intermittent cabin altitude/configuration warning horn sounds or a **CABIN ALTITUDE** light (if installed and operative) illuminates.']],
    steps: [P(1, 'Don oxygen masks and set regulators to 100%.'), P(2, 'Establish crew communications.'),
      R(3, 'Pressurization mode selector', 'MAN'), R(4, 'Outflow VALVE switch', 'Hold in CLOSE until the outflow VALVE indication shows fully closed'),
      P(5, '**If** cabin altitude is **uncontrollable**:', [['Passenger signs', 'ON'], ['PASS OXYGEN switch', 'ON'], GO('Go to the Emergency Descent checklist on page 0.1')])] },
  { t: 'Emergency Descent', ref: 'QRH 0.1', cond: ['One or more of these occur:', ['Cabin altitude cannot be controlled', 'A rapid descent is needed.']],
    steps: [P(1, 'Announce the emergency descent. The pilot flying will advise the cabin crew, on the PA system, of impending rapid descent. The pilot monitoring will advise ATC and obtain the area altimeter setting.'),
      R(2, 'Passenger signs', 'ON'), P(3, '**Without delay**, descend to the lowest safe altitude or 10,000 feet, whichever is higher.'),
      R(4, 'ENGINE START switches (both)', 'CONT'), R(5, 'Thrust levers (both)', 'Reduce thrust to minimum or as needed for anti-ice'),
      R(6, 'Speedbrake', 'FLIGHT DETENT'), BOX('If structural integrity is in doubt, limit speed as much as possible and avoid high maneuvering loads.', 'caution'),
      P(7, 'Set target speed to Mmo/Vmo.')] },
  { t: 'CARGO FIRE (MAIN)', ref: 'QRH 8.2', fire: true, tag: ['MAIN', 'red'], cond: ['Fire is detected in the main deck cargo compartment.'],
    steps: [P(1, 'Don oxygen masks and set regulators to 100%, as needed.'), P(2, 'Don smoke goggles, as needed.'),
      P(3, 'Close the flight deck door. This step prevents smoke or fumes contamination from other compartments.'), P(4, 'Establish crew and cabin communications.')] },
  { t: 'ENGINE FIRE or Engine Severe Damage or Separation', ref: 'QRH 8.8', fire: true, cond: ['One or more of these occur:', ['Engine fire warning', 'Airframe vibrations with abnormal engine indications', 'Engine separation.']],
    steps: [R(1, 'Autothrottle (if engaged)', 'Disengage'), R(2, 'Thrust lever (affected engine)', 'Close', 'Confirm'),
      R(3, 'Engine start lever (affected engine)', 'CUTOFF', 'Confirm'), R(4, 'Engine fire switch (affected engine)', 'Pull', 'Confirm', ['To manually unlock the engine fire switch, press the override and pull.']),
      P(5, '**If** the engine fire switch or ENG OVERHEAT light is illuminated:', [['Engine fire switch (affected engine)', 'Rotate to the stop and hold for 1 second']])] },
  { t: 'Engine Limit or Surge or Stall', ref: 'QRH 7.2', cond: ['One or more of these occur:', ['Engine indications are abnormal', 'Engine indications are rapidly approaching or exceeding limits', 'Abnormal engine noises are heard, possibly with airframe vibration', 'There is no response to thrust lever movement or the response is abnormal', 'Flames in the engine inlet or exhaust are reported.']],
    steps: [R(1, 'Autothrottle (if engaged)', 'Disengage'), R(2, 'Thrust lever (affected engine)', 'Retard until engine indications stay within limits or the thrust lever is closed', 'Confirm')] },
  { t: 'ENGINE OVERHEAT', ref: 'QRH 8.12', fire: true, tag: ['ENG 1 / ENG 2 OVERHEAT', 'amber'], cond: ['An overheat is detected in the engine.'],
    steps: [R(1, 'Autothrottle (if engaged)', 'Disengage'), R(2, 'Thrust lever (affected engine)', 'Close', 'Confirm'),
      P(3, '**If** the ENG OVERHEAT light **stays illuminated**:', [GO('Go to the ENGINE FIRE or Engine Severe Damage or Separation checklist on page 8.8')])] },
  { t: 'Loss Of Thrust On Both Engines', ref: 'QRH 7.6', cond: ['Both of these occur:', ['Both engines have a loss of thrust', 'Both ENG FAIL alerts show.']],
    steps: [R(1, 'ENGINE START switches (both)', 'FLT'), R(2, 'Engine start levers (both)', 'CUTOFF'),
      P(3, '**When** EGT decreases:', [['Engine start levers (both)', 'IDLE detent']]),
      P(4, '**If** EGT reaches a redline or there is no increase in EGT within 30 seconds:', [['Engine start lever (affected engine) · Confirm', 'CUTOFF, then IDLE detent'], '**If** EGT again reaches a redline or there is no increase in EGT within 30 seconds, repeat as needed.'])] },
  { t: 'Runaway Stabilizer', ref: 'QRH 9.1', cond: ['Uncommanded stabilizer trim movement occurs continuously or in a manner not appropriate for flight conditions.'],
    steps: [R(1, 'Control column', 'Hold firmly'), R(2, 'Autopilot (if engaged)', 'Disengage'), R(3, 'Autothrottle (if engaged)', 'Disengage'),
      R(4, 'Control column and thrust levers', 'Control airplane pitch attitude and airspeed'), R(5, 'Main Electric Stabilizer trim', 'Reduce control column forces'),
      P(6, '**If** the runaway **stops** after the autopilot is disengaged:', ['Do **not** re-engage the autopilot or autothrottle.']),
      P(7, '**If** the runaway **continues** after the autopilot is disengaged:', [['STAB TRIM cutout switches (both)', 'CUTOUT'], ['**If** the runaway **continues**: Stabilizer trim wheel', 'Grasp and hold']])] },
  { t: 'LANDING CONFIGURATION', ref: 'QRH 15.1', cond: ['In flight, the steady warning horn sounds.'],
    steps: [P(1, 'Assure correct airplane landing configuration.')] },
  { t: 'TAKEOFF CONFIGURATION', ref: 'QRH 15.1', tag: ['TAKEOFF CONFIG', 'red'], cond: ['On the ground, the intermittent cabin altitude/configuration warning horn sounds or a TAKEOFF CONFIG light (if installed and operative) illuminates when advancing the thrust levers to takeoff thrust.'],
    steps: [P(1, 'Assure correct airplane takeoff configuration.')] },
  { t: 'WARNING HORN (INTERMITTENT) or WARNING LIGHT - CABIN ALTITUDE OR TAKEOFF CONFIGURATION', ref: 'QRH 15.2', tag: ['CABIN ALTITUDE / TAKEOFF CONFIG', 'red'],
    cond: ['One of these occurs:', ['In flight, at an airplane flight altitude above 10,000 feet MSL, the intermittent warning horn sounds or a CABIN ALTITUDE light (if installed and operative) illuminates', 'On the ground, the intermittent warning horn sounds or a TAKEOFF CONFIG light illuminates when advancing the thrust levers to takeoff thrust.']],
    steps: [P(1, '**If** the intermittent warning horn sounds or a CABIN ALTITUDE light illuminates **in flight** at an airplane flight altitude above 10,000 feet MSL:', ['Don the oxygen masks and set the regulators to 100%.', 'Establish crew communications.', GO('Go to the CABIN ALTITUDE WARNING checklist on page 2.1')]),
      P(2, '**If** the intermittent warning horn sounds or a TAKEOFF CONFIG light illuminates **on the ground** when advancing the thrust levers to takeoff thrust:', ['Assure correct airplane takeoff configuration.'])] },
];

// Quick Action Index checklists done by reading (not memory), and the back cover.
export const QUICK_ACTIONS = [
  { t: 'Engine Fire on the Ground', ref: 'QRH Back Cover.2', steps: [['Thrust levers (both)', 'Close · C'], ['PARKING BRAKE', 'Set · C'], ['Advise the cabin', 'C'],
    ['Engine start lever (affected)', 'CUTOFF · C'], ['Engine fire switch (affected)', 'Pull · F/O'], ['Engine fire switch (affected)', 'Rotate to the stop, hold 1 s · F/O'],
    ['Evacuation needed?', 'Yes: Evacuation checklist · No: advise cabin (C) and ATC (F/O)']] },
  { t: 'Evacuation', ref: 'QRH Back Cover.4', steps: [['PARKING BRAKE', 'Set · C'], ['Speedbrake lever', 'DOWN · C'], ['FLAP lever', '40 · F/O'],
    ['Pressurization mode selector', 'MAN · F/O'], ['Outflow VALVE switch', 'Hold OPEN until fully open · F/O'],
    ['If time allows', 'Verify flaps 40 before start levers to CUTOFF · C'], ['Engine start levers (both)', 'CUTOFF · C'],
    ['Advise the cabin to evacuate', 'C'], ['Advise ATC', 'F/O'], ['Engine and APU fire switches (all)', 'Override and pull · F/O'],
    ['If an engine or APU fire is observed or indicated', 'Related fire switch: rotate to the stop, hold 1 s · F/O']] },
  { t: 'Engine Tailpipe Fire (ground, no fire warning)', ref: 'QRH 8.14', steps: [['Engine start lever (affected)', 'CUTOFF'], ['Advise the cabin', ''],
    ['Bleed air available', 'Packs OFF · isolation AUTO · engine bleeds ON (APU bleed ON if running) — then motor the engine'], ['No bleed air', 'Advise ATC']] },
];

// Non-normal maneuvers: "flight crews are expected to do them from memory" (QRH MAN.05).
// Condensed in our own words, step for step against QRH MAN.1 (Rev 57):
// WHO(role, lines) = one pilot's actions; BOX(…, 'warn') = a QRH WARNING.
const WHO = (w, items) => ({ k: 'who', w, items });
export const MANEUVERS = [
  { t: 'Approach to Stall or Stall Recovery', ref: 'QRH MAN.1.1', cond: ['First indication of a stall: buffet or stick shaker. Recover at once; do not use the flight director.'],
    steps: [WHO('PF — initiate', ['Hold the control column firmly', 'Disengage the autopilot and the autothrottle', 'Smoothly apply nose-down elevator to reduce the angle of attack until the buffet or stick shaker stops — nose-down stabilizer trim may be needed']),
      WHO('PF — continue', ['Roll the shortest way to wings level, if needed', 'Advance thrust as needed', 'Retract the speedbrakes', 'Do not change gear or flaps — except: stall at lift-off with flaps up → call for **flaps 1**']),
      WHO('PF — complete', ['Check airspeed, adjust thrust', 'Establish pitch, return to the desired flight path', 'Re-engage the autopilot and autothrottle if desired']),
      WHO('PM', ['Monitor altitude and airspeed', 'Verify the actions, call any omissions', 'Call any trend toward terrain', 'Set the FLAP lever as directed']),
      BOX('**WARNING** Trim only if the column alone does not give the response needed. Excessive pitch trim or rudder can worsen the condition, or cause loss of control or high structural loads.', 'warn')] },
  { t: 'Rejected Takeoff', ref: 'QRH MAN.1.2', cond: ['The captain decides to reject and calls **"REJECT"**.',
      '**Below 80 kt** — reject for: master caution, system failure, unusual noise or vibration, tire failure, abnormally slow acceleration, takeoff configuration warning, fire or fire warning, engine failure, predictive windshear warning, side window open, unsafe or unable to fly.',
      '**80 kt to V1** — reject only for: fire or fire warning, engine failure, predictive windshear warning, unsafe or unable to fly.'],
    steps: [WHO('Captain', ['Close the thrust levers, disengage the autothrottle', 'Maximum manual braking, or verify the RTO autobrake (brake manually if AUTO BRAKE DISARM or deceleration is not enough)', 'Raise the SPEED BRAKE lever', 'Reverse thrust up to the maximum consistent with conditions', 'Keep braking until stopping is certain', 'Stop assured: reverse to idle by taxi speed, then down; tell the cabin']),
      WHO('First officer', ['Verify the actions', 'Call **"SPEEDBRAKES UP"** or **"SPEEDBRAKES NOT UP"**', 'Call **"REVERSERS NORMAL"**, **"NO REVERSER ENGINE 1 / 2"** or **"NO REVERSERS"**', 'Call any omissions, then **"60 KNOTS"**', 'Tell the tower as soon as practical']),
      WHO('After stopping', ['Brake cooling schedule; fuse plugs may melt', 'Consider: clear the runway or not, fire services, wind for a fire, parking brake only if evacuating, hot-brake warning to ground crew, passengers', 'Then the relevant non-normal checklist'])] },
  { t: 'GPWS Caution', ref: 'QRH MAN.1.4', cond: ['One of these aurals: SINK RATE · TERRAIN · DON\'T SINK · TOO LOW FLAPS · TOO LOW GEAR · TOO LOW TERRAIN · GLIDESLOPE · BANK ANGLE · CAUTION TERRAIN (and where fitted AIRSPEED LOW, CAUTION OBSTACLE).'],
    steps: [WHO('PF', ['Correct the flight path, the configuration or the airspeed']),
      BOX('The BELOW G/S alert may be cancelled or inhibited for: a localizer or back-course approach, a circling approach from an ILS, a deliberate approach below the glideslope, or an unreliable glideslope signal.', 'note'),
      BOX('Daylight VMC, with positive visual verification that there is no terrain or obstacle hazard: the alert may be regarded as cautionary and the approach continued.', 'note')] },
  { t: 'GPWS Warning', ref: 'QRH MAN.1.5', cond: ['**PULL UP** · **TERRAIN TERRAIN PULL UP** · **OBSTACLE OBSTACLE PULL UP** (some airplanes), or any other unacceptable flight toward terrain. No flight director.'],
    steps: [WHO('PF', ['Disengage the autopilot and the autothrottle', 'Aggressively apply **maximum thrust**', 'Wings level and rotate to **20°** pitch — together', 'Retract the speedbrakes', 'Terrain still a threat: keep rotating, up to the pitch limit indicator, stick shaker or initial buffet', 'Do not change gear or flaps until terrain separation is assured', 'Monitor the radio altimeter for terrain clearance', 'Clear: slowly lower pitch and accelerate']),
      WHO('PM', ['Assure maximum thrust', 'Verify the actions, call any omissions', 'Monitor vertical speed and altitude; call any trend toward terrain']),
      BOX('Intermittent stick shaker or initial buffet is the upper pitch limit — smooth, steady control to avoid overshoot. Maximum thrust: levers full forward with the EECs normal; if terrain contact is imminent, full forward regardless. A look-ahead warning in climb, cruise or descent, verified at once as above the MSA, may be considered unreliable. Daylight VMC with no hazard positively seen: may be regarded as cautionary.', 'note')] },
  { t: 'Traffic Avoidance (TCAS)', ref: 'QRH MAN.1.7', cond: ['A traffic advisory (**TRAFFIC, TRAFFIC**) or a resolution advisory.'],
    steps: [BOX('**WARNING** Comply with the RA, even against an ATC instruction. Do not change the vertical speed except to comply. Do not follow a **DESCEND** RA below 1,000 ft AGL.', 'warn'),
      WHO('TA', ['Look for the traffic, call it out', 'Maneuver only if it is sighted and a maneuver is needed — never on a TA alone']),
      WHO('RA (except a climb in landing configuration)', ['If a maneuver is needed: disengage the autopilot and the autothrottle', 'Smoothly adjust pitch and thrust to fly out of the red, into the green', 'Keep the planned lateral path unless visual contact says otherwise']),
      WHO('Climb RA in landing configuration — PF', ['Disengage the autopilot and the autothrottle', 'Advance the thrust levers to maximum, call **"FLAPS 15"**', 'Smoothly adjust pitch to the RA', 'Keep the planned lateral path unless visual contact says otherwise']),
      WHO('Climb RA in landing configuration — PM', ['Verify maximum thrust', 'Set the FLAP lever to **15**', 'Positive rate on the altimeter: PM **"POSITIVE RATE"** → PF **"GEAR UP"** → PM sets the gear lever UP']),
      WHO('Both pilots', ['Try to see the traffic and call it out — the airplane in sight may not be the one causing the RA', 'Stick shaker: stall recovery first · high-speed buffet: relax the pitch force', 'No flight director until clear of conflict'])] },
  { t: 'Upset Recovery — Nose High', ref: 'QRH MAN.1.9', cond: ['An unintended flight condition: the airplane diverts from what is expected (roughly beyond 25° nose up, 10° nose down, 45° bank, or speeds wrong for the conditions). Stalled (stick shaker, buffet, no pitch authority or roll control, can\'t stop a descent)? Recover from the stall first: nose-down elevator until the shaker stops.'],
    steps: [WHO('PF', ['Recognise and confirm the developing situation', 'Disengage the autopilot and the autothrottle', 'Apply nose-down elevator — as much as needed for a nose-down pitch rate', 'Appropriate nose-down stabilizer trim', 'Reduce thrust', 'Roll (adjust bank) to get a nose-down pitch rate', 'Nearing the horizon: roll to wings level', 'Check airspeed, adjust thrust; establish pitch']),
      WHO('PM', ['Call attitude, airspeed and altitude through the recovery', 'Verify the actions, call any continued deviation']),
      BOX('**WARNING** Excessive pitch trim or rudder can worsen an upset, or cause loss of control or high structural loads.', 'warn')] },
  { t: 'Upset Recovery — Nose Low', ref: 'QRH MAN.1.10', cond: ['Nose low, often in a steep bank with speed building.'],
    steps: [WHO('PF', ['Recognise and confirm the developing situation', 'Disengage the autopilot and the autothrottle', 'Recover from the stall, if needed', 'Roll the shortest way to wings level — beyond 90° bank: unload, then roll', 'Nose-up elevator; nose-up trim if needed', 'Adjust thrust and drag as needed']),
      WHO('PM', ['Call attitude, airspeed and altitude through the recovery', 'Verify the actions, call any continued deviation']),
      BOX('**WARNING** Excessive pitch trim or rudder can worsen an upset, or cause loss of control or high structural loads.', 'warn')] },
  { t: 'Windshear', ref: 'QRH MAN.1.11', cond: ['A windshear warning (siren, **WINDSHEAR** ×3), a predictive warning, or below 1,000 ft unacceptable deviations: ±15 kt, ±500 fpm, ±5° pitch, 1 dot glideslope, or unusual thrust lever position for a long time.'],
    steps: [WHO('Predictive', ['**MONITOR RADAR DISPLAY** (caution): avoid the area', '**WINDSHEAR AHEAD** on the takeoff roll: before V1 reject, after V1 fly the escape', '**GO-AROUND, WINDSHEAR AHEAD** on approach: escape — or, at the pilot\'s discretion, a normal go-around']),
      WHO('Windshear met on the takeoff roll', ['Before V1: an RTO at V1 may not stop in the runway left — at VR rotate at a normal rate toward 15°; once airborne, the escape maneuver', 'Near VR with airspeed suddenly dropping: not enough runway to stop → rotate normally at least 2,000 ft before the runway end, even at low speed; maximum thrust']),
      WHO('Windshear met in flight', ['The escape maneuver']),
      WHO('Escape — manual', ['Disengage the autopilot, push a TO/GA switch', 'Aggressively apply **maximum thrust**, disengage the autothrottle', 'Wings level, rotate toward **15°**', 'Retract the speedbrakes', 'Follow the TO/GA flight director (not beyond the pitch limit indicator)']),
      WHO('Escape — automatic', ['Push a TO/GA switch (no TO/GA: disconnect and fly manually)', 'Verify the TO/GA mode and GA thrust', 'Retract the speedbrakes', 'Monitor — severe windshear may exceed the autopilot']),
      WHO('Both', ['No flap or gear change until clear', 'Wings level unless a turn is needed for obstacles', 'Monitor vertical speed and altitude', 'Do not chase lost airspeed until clear']),
      WHO('PM', ['Verify maximum (GA) thrust, call any omissions', 'Monitor vertical speed and altitude; call any trend toward terrain, a descending path or big airspeed changes']),
      BOX('Intermittent stick shaker or initial buffet is the upper pitch limit; do not exceed the pitch limit indication. Smooth, steady control.', 'note')] },
];

// The limitations marked # (must be memorized), then other key numbers.
export const NUMBERS = [
  ['Memorize (FCOM L.10, marked #)', [
    ['Maximum takeoff and landing tailwind component', '15 kt (takeoff and manual landing with tailwind)'],
    ['Severe turbulent air penetration speed (climb and descent only)', '280 KIAS / M.76, whichever is lower'],
    ['HF radios', 'do not operate during refuelling'],
    ['Aileron trim with the autopilot engaged', 'prohibited'],
    ['Autopilot engagement for takeoff', 'do not engage below 400 ft AGL'],
    ['Single-channel autopilot on approach', 'must not stay engaged below 50 ft AGL'],
    ['Autoland wind limits (steady wind, landing minima on autoland)', 'headwind 25 kt · crosswind 20 kt · tailwind 15 kt'],
    ['Autoland glideslope angle', '2.5° to 3.25°'],
    ['Autoland configuration', 'flaps 30 or 40, both engines operative'],
    ['LVL CHG on final approach', 'do not use below 1,000 ft AFE'],
    ['Reverse thrust in flight', 'intentional selection prohibited'],
    ['APU bleed + electrical load, in flight', 'max altitude 10,000 ft'],
    ['APU bleed + electrical load, ground only', 'max altitude 15,000 ft'],
    ['APU bleed (alone)', 'max altitude 17,000 ft'],
    ['APU electrical load (alone)', 'max altitude 41,000 ft'],
    ['Maximum altitude with flaps extended', '20,000 ft'],
    ['Holding in icing conditions with flaps extended', 'prohibited'],
    ['Rapid and large alternating control inputs', 'avoid: structural failure possible at any speed, including below VA'],
    ['SPEED BRAKE lever in flight', 'do not deploy the speed brakes below 1,000 ft radio altitude'],
    ['Weather radar operation in a hangar', 'avoid; also avoid when personnel are within the radome area'],
  ], true],
  ['Airplane (FCOM L.10)', [
    ['Max operating altitude', '41,000 ft pressure altitude'],
    ['Max takeoff / landing altitude', '8,400 ft pressure altitude'],
    ['Runway slope', '±2 %'],
    ['Max differential pressure (relief valves)', '9.1 psi'],
    ['RVSM: Capt vs F/O altitude in flight', '200 ft'],
    ['RVSM on the ground (SL–5,000 / 5,001–10,000 ft)', 'Capt–F/O 50 / 60 ft · either vs field 75 ft'],
    ['SPEED BRAKE lever in flight', 'do not move beyond the FLIGHT DETENT'],
    ['Alternate flaps', '15 s between selections · 5 min after 0→15→0'],
    ['ADIRU alignment', 'not above 78°15′ latitude'],
    ['Brakes', 'not before touchdown'],
    ['Engine ignition on for', 'takeoff, landing, heavy rain, anti-ice'],
    ['APU', '2 min running before bleed use · 15 min cooling after 3 aborted starts'],
    ['Packs HIGH with engine bleed', 'not for takeoff, approach or landing'],
  ]],
  ['Fuel (FCOM L.10)', [
    ['Max tank fuel temperature', '49 °C'],
    ['Min tank fuel temperature', '−43 °C or freeze point + 3 °C, whichever higher'],
    ['Random lateral imbalance', '453 kg max'],
    ['Center tank > 453 kg', 'main tanks must be full'],
    ['Center pump dry running', 'prohibited (LOW PRESSURE lit)'],
  ]],
  ['Weights (FCOM L.10 — MTOW: Weight & Balance Manual)', [
    ['Max taxi weight', '4X-EK* 79,242 · 4X-EKZ 79,151 · 4X-EH* 85,366 kg'],
    ['Max landing weight', '4X-EK* 66,360 · 4X-EKZ 66,224 · 4X-EH* 71,350 kg'],
    ['Max zero fuel weight', '4X-EK* 62,731 · 4X-EKP 62,142 · 4X-EKZ 61,688 · 4X-EH* 67,721 kg'],
  ]],
  ['Narrow runway (30 m) — 4X-EHA…EHI only (FCOM L.10)', [
    ['Takeoff crosswind: dry / wet / snow / flooded / icy', '36 (34)¹ / 25 / 25 / 15 / 15 kt'],
    ['Landing crosswind: dry / wet / snow / flooded / icy', '40 / 40 / 35 / 20 / 17 kt'],
    ['Sideslip-only landing not recommended above', '17 kt flaps 15 · 20 kt flaps 30 · 23 kt flaps 40'],
    ['¹', '36 kt with both blended winglets'],
  ]],
  ['QRH numbers worth knowing', [
    ['Airspeed unreliable, gear up', 'flaps out 10° / 80 % N1 · flaps up 4° / 75 % N1'],
    ['Emergency descent to', 'lowest safe altitude or 10,000 ft, whichever higher'],
    ['Dual engine failure airspeed', '≥ FL270: 275 kt · below: 300 kt'],
    ['Aborted start', 'motor 60 s after N2 below 20 %'],
    ['Fire switch rotate', 'to the stop, hold 1 s'],
    ['Windshear path deviations (< 1,000 ft)', '15 kt · 500 fpm · 5° · 1 dot'],
    ['GPWS pull-up initial pitch', '20° · windshear escape 15°'],
    ['RTO: 80 kt', 'above it reject only for fire, engine failure, PWS warning, unsafe to fly'],
  ]],
];

/** HTML for the sheet. `systems` adds every number cited on the system pages. */
/** `nav.demo(cue, title)` shows a cue in the 3D cockpit (app.js). */
export function createQuickRef(sheet, systems, nav = {}) {
  let tab = 'memory';
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  // Short actions read like the QRH ("item ……… ACTION"); long ones wrap below the item.
  const steps = (list) => `<ol class="qr-steps">${list.map(([a, b]) => {
    if (!b) return `<li><span class="qr-a">${esc(a)}</span></li>`;
    if (b.length > 30) return `<li class="long"><span class="qr-a">${esc(a)}</span><span class="qr-b">${esc(b)}</span></li>`;
    return `<li><span class="qr-a">${esc(a)}</span><span class="qr-dots"></span><span class="qr-b">${esc(b)}</span></li>`;
  }).join('')}</ol>`;
  const card = (c, mem) => `<section class="qr-card${mem ? ' mem' : ''}"><h3>${esc(c.t)}<span class="qr-ref">${esc(c.ref)}</span></h3>${c.when ? `<p class="qr-when">${esc(c.when)}</p>` : ''}${steps(c.steps)}</section>`;
  const table = (title, rows, mem = false) => `<section class="qr-card"><h3>${esc(title)}</h3><table class="qr-num">${rows.map(([a, b, r]) => `<tr><td>${mem ? '<span class="qr-hash">#</span>' : ''}${esc(a)}</td><td>${esc(b)}${r ? ` <span class="qr-ref">${esc(r)}</span>` : ''}</td></tr>`).join('')}</table></section>`;
  // Memory items as printed: numbered steps with leader dots, sub-lines,
  // ►► instructions, boxed Caution / Warning, Condition panel with tags.
  const md = (x) => esc(x).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const line = (a, v, m) => `<div class="qr-line${v && v.length > 28 ? ' long' : ''}"><span class="qr-a">${md(a)}</span>${m ? `<span class="qr-m">${md(m)}</span>` : ''}<span class="qr-dots"></span>${v ? `<span class="qr-b">${md(v)}</span>` : ''}</div>`;
  const subHtml = (x) => {
    if (typeof x === 'string') return `<div class="qr-sub">${md(x)}</div>`;
    if (Array.isArray(x)) return `<div class="qr-sub">${line(x[0], x[1])}</div>`;
    return `<div class="qr-go">►► ${md(x.a)}</div>`;
  };
  const stepHtml = (st) => {
    if (st.k === 'row') return `<div class="qr-row"><span class="qr-n">${st.n}</span><div class="qr-fill">${line(st.a, st.v, st.m)}${st.sub.map(subHtml).join('')}</div></div>`;
    if (st.k === 'txt') return `<div class="qr-row"><span class="qr-n">${st.n}</span><div class="qr-fill"><div class="qr-t">${md(st.a)}</div>${st.sub.map(subHtml).join('')}</div></div>`;
    if (st.k === 'who') return `<div class="qr-who"><span class="qr-w">${md(st.w)}</span><ul>${st.items.map((x) => `<li>${md(x)}</li>`).join('')}</ul></div>`;
    if (st.k === 'box') return `<div class="qr-box ${st.lvl}">${st.lvl === 'caution' ? '⚠ ' : ''}${md(st.a)}</div>`;
    return '';
  };
  const condHtml = (list) => list.map((x) => (Array.isArray(x) ? `<ul>${x.map((li) => `<li>${md(li)}</li>`).join('')}</ul>` : `<p>${md(x)}</p>`)).join('');
  const memCard = (c) => `<section class="qr-card mem${c.fire ? ' fire' : ''}"${CUES[c.t] ? ` data-cue="${esc(c.t).replace(/"/g, '&quot;')}"` : ''}>
    <h3>${md(c.t)}<span class="qr-ref">${esc(c.ref)}</span></h3>
    ${CUES[c.t] ? '<button class="qr-cue-b no-hl" data-cue-show>◉ How you recognise it</button>' : ''}
    ${c.tag ? `<span class="qr-tag ${c.tag[1]}">${esc(c.tag[0])}</span>` : ''}
    <div class="qr-cond"><span class="qr-lbl">Condition:</span><div>${condHtml(c.cond)}</div></div>
    ${c.steps.map(stepHtml).join('')}
    <div class="qr-sep"></div>
  </section>`;
  // Supplementary procedures: each topic a collapsed card (open it, or jump
  // from the chips); warnings and cautions carry their word, not only colour.
  const spLine = (x) => {
    if (Array.isArray(x)) return `<li class="${x[0] === '!' ? 'sp-w' : 'sp-c'}"><b>${x[0] === '!' ? 'WARNING' : 'CAUTION'}</b> ${md(x[1])}</li>`;
    return `<li>${md(x)}</li>`;
  };
  const spTable = (tb) => `<div class="sp-tab"><div class="sp-tt">${esc(tb.t)}</div><table class="qr-num sp-num"><tr><th>OAT · height</th>${tb.head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr>${tb.rows.map(([t, vals]) => `<tr><td>${esc(t)}</td>${vals.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('')}</table><div class="sp-unit">Correction in ${tb.unit}, added to the published minimum</div></div>`;
  const suppHtml = () => SUPPLEMENTARY.map((sec) => `
    <nav class="sp-idx">${sec.topics.map((tp, i) => `<button class="tag tag-btn sp-chip" data-sp-go="${sec.n}-${i}">${esc(tp.t)}</button>`).join('')}</nav>
    <div class="sp-tools"><button class="tag tag-btn" data-sp-all="open">Open all</button><button class="tag tag-btn" data-sp-all="close">Close all</button></div>
    ${sec.topics.map((tp, i) => `<details class="sp-topic" id="sp-${sec.n}-${i}"><summary><span>${esc(tp.t)}</span><span class="qr-ref">${esc(tp.ref)}</span></summary><ul class="sp-list">${tp.pts.map(spLine).join('')}</ul>${(tp.tab || []).map((k) => spTable(sec.tables[k])).join('')}</details>`).join('')}`).join('');
  function body() {
    if (tab === 'memory') return `<p class="qr-note">Steps above the dashed line in each Quick Action Index checklist — do them, then read the rest of the checklist.</p>${MEMORY.map(memCard).join('')}
      <h2 class="qr-h2">Quick actions (read and do)</h2>${QUICK_ACTIONS.map((c) => card(c)).join('')}`;
    if (tab === 'maneuvers') return `<p class="qr-note">Non-normal maneuvers are flown from memory. Callout first: "STALL", "WINDSHEAR", "UPSET"…</p>${MANEUVERS.map(memCard).join('')}`;
    if (tab === 'numbers') return NUMBERS.map(([t, rows, mem]) => table(t, rows, mem)).join('');
    // Every number on the system pages, by chapter.
    return systems.filter((s) => s.mod).sort((a, b) => a.num - b.num).map((s) => {
      const rows = [...s.mod.overview.limits];
      for (const p of s.mod.parts) for (const l of p.limits || []) if (!rows.some((r) => r[0] === l[0])) rows.push(l);
      return rows.length ? table(`${String(s.num).padStart(2, '0')} ${s.mod.title}`, rows) : '';
    }).join('');
  }
  function html() {
    const tabs = [['memory', 'Memory items'], ['maneuvers', 'Maneuvers'], ['numbers', 'Limits & numbers'], ['systems', 'By system']];
    return `<div class="qr">
      <div class="kicker">QUICK REFERENCE · QRH / FCOM REV 57</div>
      <h2>Quick reference</h2>
      <div class="qr-tabs">${tabs.map(([k, n]) => `<button class="tag tag-btn${k === tab ? ' on' : ''}" data-qr-tab="${k}">${n}</button>`).join('')}</div>
      ${body()}
      <p class="qr-foot">Study aid in our own layout. The QRH and FCOM on board govern — check effectivity for your tail.</p>
    </div>`;
  }
  function open(t) { hideCue(); if (t) tab = t; if (tab === 'supp') tab = 'memory'; sheet.custom(html(), 'quickref'); }

  // ── Recognition cue: a card on the left (inline on a phone) ──
  let cueCard = null;
  const wide = () => matchMedia('(min-width: 761px)').matches;
  function cuePanel() {
    let el = document.getElementById('cue-panel');
    if (!el) { el = document.createElement('aside'); el.id = 'cue-panel'; el.className = 'cue-panel no-hl'; el.hidden = true; document.body.append(el); }
    return el;
  }
  function hideCue() {
    cuePanel().hidden = true;
    document.querySelectorAll('.cue-inline').forEach((x) => x.remove());
    cueCard?.classList.remove('cue-on');
    cueCard = null;
  }
  function showCue(card) {
    const title = card.dataset.cue;
    if (cueCard === card) { hideCue(); return; }
    hideCue();
    cueCard = card;
    card.classList.add('cue-on');
    if (wide()) { const el = cuePanel(); el.innerHTML = cueHtml(title); el.hidden = false; el.scrollTop = 0; }
    else {
      const d = document.createElement('div');
      d.className = 'cue-inline no-hl';
      d.innerHTML = cueHtml(title);
      (card.querySelector('[data-cue-show]') || card.querySelector('h3')).after(d);
    }
  }
  // Close the cue when the sheet closes or shows another page.
  const sheetEl = document.getElementById('sheet');
  if (sheetEl) new MutationObserver(() => { if (cueCard && (sheetEl.hidden || !document.contains(cueCard))) hideCue(); })
    .observe(sheetEl, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });

  // ── Supplementary: its own sheet, one tab per chapter ──
  let spCh = 16;
  const SP_TABS = [[16, 'Adverse weather'], [2, 'Air systems'], [3, 'Anti-ice'], [7, 'Engines'], [12, 'Fuel']];
  function suppPage() {
    const body = spCh === 16
      ? `${wizardHtml()}${coldHtml()}<details class="sp-ref" id="sp-ref"><summary>SP.16 Adverse Weather — full summary <span class="qr-ref">reference</span></summary>${suppHtml()}</details>`
      : procsHtml(spCh);
    return `<div class="qr">
      <div class="kicker">SUPPLEMENTARY PROCEDURES · FCOM REV 57</div>
      <h2>Supplementary</h2>
      <div class="qr-tabs">${SP_TABS.map(([n, t]) => `<button class="tag tag-btn${n === spCh ? ' on' : ''}" data-sp-ch="${n}">SP.${n} ${t}</button>`).join('')}</div>
      ${body}
      <p class="qr-foot">Condensed from the FCOM Supplementary Procedures, Rev 57, in our own words. The FCOM${spCh === 16 ? ' and your de-icing programme' : ''} govern.</p>
    </div>`;
  }
  function openSupp(n) { hideCue(); if (n) spCh = n; sheet.custom(suppPage(), 'supp'); }
  function redrawProcs() {
    const el = document.getElementById('pr-chap');
    if (!el) return;
    const tmp = document.createElement('div');
    tmp.innerHTML = procsHtml(spCh);
    el.replaceWith(tmp.firstElementChild);
  }
  // Tab clicks inside the sheet.
  // The advisor re-reads its form on every change.
  for (const ev of ['input', 'change']) document.addEventListener(ev, (e) => { if (e.target.closest?.('#wz, #wz-cold')) wizardInput(e); });
  document.addEventListener('keydown', (e) => wizardKey(e));
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-cue-close]')) { hideCue(); return; }
    const cc = e.target.closest('[data-cue-cockpit]');
    if (cc) { const t = cc.dataset.cueCockpit; hideCue(); nav.demo?.(CUES[t], t); return; }
    const cs = e.target.closest('[data-cue]');
    if (cs && (e.target.closest('[data-cue-show]') || (!e.target.closest('button, a, input, .cue-inline') && !getSelection()?.toString()))) { showCue(cs); return; }
    const wa = e.target.closest('[data-wz-ans],[data-wz-edit],[data-wz-tog],[data-wz-x],[data-wz-apt],[data-ct-apt]');
    if (wa && wizardClick(wa)) return;
    const lk = e.target.closest('[data-sp-proc]');
    if (lk) {
      const [n, id] = lk.dataset.spProc.split(':');
      openProc(id);
      openSupp(Number(n));
      const card = id && document.getElementById(`pr-${id}`);
      if (card) { const d = card.closest('details'); if (d) d.open = true; card.scrollIntoView({ block: 'start', behavior: 'smooth' }); }
      return;
    }
    const ch = e.target.closest('[data-sp-ch]');
    if (ch) { openSupp(Number(ch.dataset.spCh)); return; }
    const pr = e.target.closest('[data-pr-open],[data-pr-tick],[data-pr-clear]');
    if (pr && procClick(pr)) { redrawProcs(); return; }
    const wb = e.target.closest('[data-wz]');
    if (wb) { wizardAct(wb.dataset.wz); return; }
    const sg = e.target.closest('[data-sp-go]');
    if (sg) { const d = document.getElementById('sp-' + sg.dataset.spGo); if (d) { const ref = d.closest('details.sp-ref'); if (ref) ref.open = true; d.open = true; d.scrollIntoView({ block: 'start', behavior: 'smooth' }); } return; }
    const sa = e.target.closest('[data-sp-all]');
    if (sa) { document.querySelectorAll('.sp-topic').forEach((d) => { d.open = sa.dataset.spAll === 'open'; }); return; }
    const b = e.target.closest('[data-qr-tab]');
    if (!b) return;
    tab = b.dataset.qrTab;
    open();
  });
  return { open, openSupp, hideCue, get key() { return 'quickref'; } };
}
