// sys-flightcontrols.js — FCOM chapter 9, in our own words. The flap and
// speedbrake state here drives the 3D airplane: move the FLAP lever and the
// flaps run (on system B, or electrically with alternate flaps).

import { wingLE, wingChord, wingY, TIP_Z, MLG, EE, YC, FLOOR_Y } from './airframe.js?v=10';

const C = '#3a86ff', CAB = '#adb5bd', DRV = '#fab005';
const spar = (z, u, dy = 0) => [wingLE(z) - u * wingChord(z), wingY(z) + dy, z];
export const DETENTS = [0, 1, 2, 5, 10, 15, 25, 30, 40];
const SB = ['DOWN', 'ARMED', 'FLIGHT', 'UP'];

export default {
  id: 'flightcontrols', num: 9, title: 'Flight Controls', fcom: 'FCOM 9', color: C,
  anchor: [-15.5, 6.5, 0],
  view: { target: [-3, 3, 0], dist: 44, dir: [-0.7, 0.75, 0.6] },

  overview: {
    lead: 'Conventional wheel, column and pedals connected by **cables** to hydraulic **PCUs** on the ailerons, elevators and rudder — either hydraulic system A or B alone can drive them all. High-lift devices run on system B.',
    how: [
      '**Roll:** ailerons plus four flight spoilers per wing. The captain\'s wheel drives the aileron PCUs, the first officer\'s the spoilers through the spoiler mixer; they\'re linked, and a jam can be overpowered to split them. Without hydraulics the ailerons can still be moved by hand (heavier).',
      '**Pitch:** elevators on A and B (mechanical reversion possible), an **electric stabiliser** with main-electric, autopilot and manual (cable) trim, an elevator **feel computer**, **Mach trim** above Mach .615 and the **speed trim system**.',
      '**Yaw:** one rudder through a main PCU (A and B) and a **standby rudder PCU** (standby system); a load limiter cuts rudder authority above 137 kt. The **yaw damper** (SMYD) works through system B, with a standby yaw damper on the standby system.',
      '**High lift:** double-slotted TE flaps and LE devices (4 Krueger flaps, 8 slats), sequenced by the FSEU, with asymmetry, skew and uncommanded-motion protection, flap load relief and autoslats. Alternate flaps: TE electric, LE on standby hydraulics (extend only).',
      '**Speedbrakes:** flight spoilers in the air; flight and ground spoilers on the ground; automatic deployment on landing and rejected takeoff.',
    ],
    limits: [
      ['Max altitude with flaps extended', '20,000 ft', 'FCOM L.10'],
      ['Holding in icing with flaps extended', 'Prohibited', 'FCOM L.10'],
      ['In flight, speedbrake lever', 'not beyond FLIGHT DETENT', 'FCOM L.10'],
      ['Speedbrakes in flight below', '1,000 ft RA: do not deploy', 'FCOM L.10'],
      ['Alternate flaps duty cycle', '15 s between selections; 5 min after 0→15→0', 'FCOM L.10'],
      ['Aileron trim with autopilot engaged', 'Prohibited', 'FCOM L.10'],
      ['Rudder load limiter', 'reduced authority > 137 kt · full < 132 kt', 'FCOM 9.20'],
      ['Mach trim active above', 'Mach .615', 'FCOM 9.20'],
    ],
    memory: [
      'Avoid rapid and large alternating control inputs — structural failure is possible at any speed, even below VA.',
      'No speedbrakes in flight below 1,000 ft RA; never beyond FLIGHT DETENT in flight.',
    ],
  },

  parts: [
    {
      id: 'ail', name: 'Ailerons & flight spoilers', at: [-4.6, wingY(14) + 0.1, 14],
      lead: 'Roll comes from the ailerons and, in proportion, the flight spoilers on the up-aileron side.',
      how: [
        'Each hydraulic system powers its own pairs of spoilers so a failure leaves them symmetric (A: 2, 4, 9, 11 · B: 3, 5, 8, 10). The spoilers rise with up aileron and stay faired with down aileron.',
        'A jam: force on the first officer\'s wheel gives roll from the spoilers (aileron jammed), or force on the captain\'s wheel gives roll from the ailerons (spoilers jammed).',
        'Aileron trim (two switches pushed together, aft electronic panel) re-centres the feel unit and turns the wheel.',
      ],
      deck: [['SPOILER A / B (OFF · ON guarded)', 'Shutoff valves for each system\'s flight spoilers.'], ['AILERON trim', 'Both switches together. Not with the autopilot engaged.']],
      limits: [['Aileron trim with autopilot engaged', 'Prohibited', 'FCOM L.10']],
      related: ['pcu', 'sb'],
    },
    {
      id: 'elev', name: 'Elevators & feel', at: [-18.3, 4.0, 4.5],
      lead: 'Cables from both columns to elevator PCUs powered by A and B; the two elevators are joined by a torque tube. Mechanical reversion if both systems are lost.',
      how: [
        'The **feel computer** makes column forces from airspeed (its own elevator pitot) and stabiliser position, using whichever of A or B is higher. A system or feel-pitot failure lights **FEEL DIFF PRESS**.',
        '**Mach trim** (above Mach .615) moves the column neutral to keep speed stability at high Mach.',
        'A column jam can be broken out: whichever column then moves freely gives (reduced) elevator control, enough to flare.',
      ],
      deck: [['FEEL DIFF PRESS (amber)', 'Excessive differential pressure in the feel computer — a hydraulic system or the feel pitot has failed.'], ['MACH TRIM FAIL (amber)', 'Mach trim failure.']],
      related: ['stab', 'pcu'],
    },
    {
      id: 'stab', name: 'Stabiliser & trim', at: [-16.5, 3.9, 0],
      lead: 'One electric trim motor drives the stabiliser, from the wheel switches (main electric) or the autopilot; the trim wheels turn whenever it moves and can be grabbed to stop it or turned by hand.',
      how: [
        'Two speeds: high with flaps out, low with flaps up. Using the wheel trim switches disengages the autopilot.',
        'Column cutout switches stop electric trim when the column opposes it; **OVERRIDE** bypasses them.',
        'Two independent brakes hold the stabiliser. Manual trim can go beyond the electric limits; the switches bring it back.',
        'The green band shows the takeoff range; an intermittent horn sounds if you try to take off outside it.',
        '**Speed trim (STS)** trims against speed changes at low weight, aft CG and high thrust (autopilot off), mostly on takeoff, climb and go-around.',
      ],
      deck: [['STAB TRIM MAIN ELECT / AUTOPILOT (NORMAL · CUTOUT)', 'Disconnect main electric or autopilot trim from the stabiliser.'], ['STAB TRIM override (NORM · OVERRIDE)', 'Electric trim regardless of column position.'], ['SPEED TRIM FAIL (amber)', 'Speed trim failure.']],
      limits: [['Main electric trim, flaps extended', '0.05–14.5 units', 'FCOM 9.20'], ['Autopilot trim', '0.05–14.5 units', 'FCOM 9.20'], ['Manual trim', '−0.20–16.9 units', 'FCOM 9.20']],
      related: ['elev'],
    },
    {
      id: 'rud', name: 'Rudder, yaw damper & trim', at: [-16.9, 7.5, 0],
      lead: 'Pedals → cables → main rudder PCU (two actuators, A and B) and the standby rudder PCU (standby hydraulics). Each input rod has its own jam override.',
      how: [
        'Above **137 kt** the load limiter cuts each system\'s pressure in the main PCU by about 25 %, limiting rudder travel; full authority returns below 132 kt.',
        'A **force-fight monitor** in the main PCU detects A fighting B (a jam or disconnect) and starts the standby system on the standby PCU — STBY RUD ON, MASTER CAUTION, FLT CONT.',
        '**Yaw damper:** main (system B) and standby (standby system) through the SMYDs — dutch roll, gusts, turn coordination, without moving the pedals. The switch trips OFF with the YAW DAMPER light for a fault, or with B FLT CONTROL OFF / STBY RUD.',
        'In manual reversion (A and B lost, both FLT CONTROL to STBY RUD) the yaw damper can be reset ON to use the standby damper, which also adds rudder with wheel input.',
        'The rudder becomes aerodynamically effective at 40–60 kt on the takeoff roll.',
      ],
      deck: [['YAW DAMPER (OFF · ON)', 'YAW DAMPER light (amber): damper not engaged.'], ['RUDDER trim', 'Moves the feel/centering unit; pedals follow.']],
      limits: [['Load limiter', '> 137 kt reduced · < 132 kt full', 'FCOM 9.20']],
      related: ['pcu'],
    },
    {
      id: 'flaps', name: 'Trailing-edge flaps', at: spar(8, 0.85, -0.1),
      lead: 'Double-slotted flaps driven by a hydraulic flap drive unit (system B) through torque tubes, or by an electric motor with alternate flaps.',
      how: [
        'Detents UP, 1, 2, 5, 10, 15, 25, 30, 40. Positions 1–15 add lift; 15–40 add lift and drag. Normal landing flaps 15, 30, 40.',
        '**Flap load relief** (FSEU, from the left ADIRU — the captain\'s airspeed): if the speed is too high for the selected flap it retracts one step and puts it back when slower; LOAD RELIEF lights. The lever doesn\'t move. Not available with alternate flaps.',
        'Gates in the lever track stop at 1 (one engine go-around) and 15 (normal go-around).',
        '**Alternate flaps:** ALTERNATE FLAPS master ARM (bypass valve closed, standby pump on), then hold the position switch DOWN or UP — no asymmetry or skew protection electrically.',
      ],
      deck: [['FLAP lever', 'Selects TE flap position; LE devices follow in sequence.'], ['Flap position indicator', 'L and R needles; a split means asymmetry.'], ['LOAD RELIEF (amber)', 'Flap load relief has retracted the flaps.']],
      limits: [['Flaps 40 load relief', 'retracts to 30 above 163 kt · back below 158 kt', 'FCOM 9.20'], ['Flaps 30', 'to 25 above 176 kt · back below 171 kt', 'FCOM 9.20'], ['Max altitude flaps extended', '20,000 ft', 'FCOM L.10']],
      related: ['le', 'pdu'],
    },
    {
      id: 'le', name: 'Leading-edge devices', at: spar(12, 0.04, 0.1),
      lead: 'Four Krueger flaps (inboard of the engines) and eight slats (outboard), sequenced with the TE flaps.',
      how: [
        'Flaps 1, 2, 5: Kruegers full extended, slats **extend**. Beyond 5: slats **full extend**. (On some airplanes the change is beyond 25.) Reversed on retraction.',
        '**Autoslats** (flaps 1–5): near the stall the slats drive to full extend before the stick shaker, and return once the pitch comes down — normally system B, or A through the PTU.',
        'The FSEU watches for asymmetry, skew and uncommanded movement; it shuts the LE drive down and lights LE FLAPS TRANSIT if something moves that shouldn\'t.',
      ],
      deck: [['LE FLAPS TRANSIT (amber) / LE FLAPS EXT (green)', 'Center panel: in transit, or all extended.'], ['LE DEVICES panel (aft overhead)', 'Each flap and slat: TRANSIT, EXT, FULL EXT.'], ['AUTO SLAT FAIL (amber)', 'Autoslat failure.']],
      related: ['flaps'],
    },
    {
      id: 'sb', name: 'Speedbrakes', at: spar(9, 0.66, 0.15),
      lead: 'In the air the SPEED BRAKE lever raises the flight spoilers; on the ground flight and ground spoilers (all four ground spoilers on system A).',
      how: [
        '**ARMED** for landing: radio altitude below 10 ft, a strut compressed, thrust levers at idle and wheels spun up (>60 kt) — the lever runs to UP and all spoilers deploy.',
        'If left DOWN, they still deploy automatically on wheel spin-up when the reverse levers are raised (landing or rejected takeoff). Advancing a thrust lever afterwards retracts them.',
        'Load alleviation can pull them back to 50 % of FLIGHT DETENT at high weight / speed; a lever stop blocks going past FLIGHT DETENT in flight with flaps up.',
      ],
      deck: [['SPEED BRAKE lever (DOWN · ARMED · FLIGHT DETENT · UP)', 'Manual or automatic deployment.'], ['SPEED BRAKE ARMED (green) · SPEEDBRAKES EXTENDED (amber) · SPEED BRAKE DO NOT ARM (amber)', 'Armed for landing; extended in landing config or below 800 ft AGL; abnormal auto-speedbrake condition.']],
      limits: [['In flight', 'not beyond FLIGHT DETENT', 'FCOM L.10'], ['Below 1,000 ft RA in flight', 'Do not deploy', 'FCOM L.10']],
      related: ['ail'],
    },
    {
      id: 'pcu', name: 'Power control units', at: [MLG.x - 0.8, 2.0, 0.3],
      lead: 'Hydraulic actuators that move the surfaces when the cables move their input levers. The aileron PCUs sit in the main wheel well; the elevator and rudder PCUs in the tail.',
      related: ['ail', 'elev', 'rud'],
    },
    {
      id: 'pdu', name: 'Flap drive unit', at: [MLG.x - 0.3, 2.15, -0.4],
      lead: 'A hydraulic motor (system B) turning the torque tubes along the wing rear spars to the flap transmissions; an electric motor drives the same tubes for alternate flaps.',
      related: ['flaps'],
    },
  ],

  build(K) {
    // Control cables from the flight deck to the tail and wheel well.
    K.flow('cables', [[15.4, FLOOR_Y - 0.2, -0.6], [8, FLOOR_Y - 0.3, -0.7], [-4, FLOOR_Y - 0.3, -0.7], [-12, 2.6, -0.4], [-16.4, 3.9, 0]], { color: CAB, part: 'pcu', r: 0.025 });
    K.flow('cables', [[15.4, FLOOR_Y - 0.2, 0.6], [8, FLOOR_Y - 0.3, 0.7], [-4, FLOOR_Y - 0.3, 0.7], [-12, 2.6, 0.4], [-16.9, 5.0, 0]], { color: CAB, part: 'rud', r: 0.025 });
    K.unit('pcu', { box: [MLG.x - 0.8, 2.0, 0.3], size: [0.4, 0.2, 0.25] }, { color: C });
    K.unit('elev', { box: [-17.6, 3.9, 0], size: [0.5, 0.25, 0.6] }, { color: C });
    K.unit('rud', { box: [-16.9, 5.2, 0], size: [0.6, 0.6, 0.2] }, { color: C });
    K.unit('stab', { cyl: [[-16.6, 3.3, 0], [-16.6, 4.3, 0]], r: 0.09 }, { color: DRV });
    // Flap drive and torque tubes along the rear spar, to the flap tracks.
    K.unit('pdu', { box: [MLG.x - 0.3, 2.15, -0.4], size: [0.35, 0.25, 0.3] }, { color: DRV });
    for (const side of [-1, 1]) {
      K.flow('torque', [[MLG.x - 0.3, 2.15, side * 0.3], spar(side * 2.2, 0.72, -0.1), spar(side * 6.5, 0.72, -0.06), spar(side * 12.3, 0.72, -0.02)],
        { color: DRV, part: 'pdu', r: 0.04 });
      K.unit('flaps', { box: spar(side * 8, 0.86, -0.1), size: [0.5, 0.06, 1.0] }, { color: C, glass: true });
      K.unit('le', { box: spar(side * 12, 0.04, 0.05), size: [0.3, 0.05, 1.2] }, { color: C, glass: true });
      K.unit('ail', { box: [-4.6, wingY(14) + 0.1, side * 14], size: [0.3, 0.06, 2.6] }, { color: C, glass: true });
      K.unit('sb', { box: spar(side * 9, 0.66, 0.12), size: [0.5, 0.03, 4.2] }, { color: '#4dabf7', glass: true });
      K.flow('aileronCable', [[MLG.x - 0.8, 2.0, side * 0.3], spar(side * 4, 0.64, -0.1), spar(side * 13.5, 0.66, 0), [-4.6, wingY(14) + 0.1, side * 14]],
        { color: CAB, part: 'ail', r: 0.02 });
    }
    K.unit('rud', { box: [EE.x0 + 0.9, EE.y + 0.2, 0], size: [0.3, 0.2, 0.2] }, { color: '#adb5bd' });
  },

  normal(phase) {
    const lever = { ground: 0, takeoff: 3, cruise: 0, landing: 7 }[phase];
    return {
      sw: { flap: lever, sb: phase === 'landing' ? 3 : 0, yd: 1, spA: 1, spB: 1, altPos: 1, stabMain: 0, stabAp: 0 },
      fail: {},
      mem: { flap: DETENTS[lever], le: lever === 0 ? 0 : lever <= 3 ? 1 : 2 },
    };
  },

  /** Flaps follow the lever at a believable rate — if something can drive them. */
  tick(dt, st, env) {
    const { sw, mem, fail: f } = st;
    const target = DETENTS[sw.flap];
    const hydB = env.hydB !== false && !f.flapDrive;
    const alt = !!env.altFlapsArmed && sw.altPos !== 1;
    let rate = 0;
    if (hydB) rate = 2.5;                                       // °/s on system B
    else if (alt) rate = 0.6;                                   // electric, much slower
    const before = mem.flap;
    if (alt && !hydB) {
      // Alternate: the position switch drives, not the lever.
      const dir = sw.altPos === 2 ? 1 : -1;
      mem.flap = Math.max(0, Math.min(15, mem.flap + dir * rate * dt * 4));
    } else if (rate) {
      mem.flap += Math.sign(target - mem.flap) * Math.min(Math.abs(target - mem.flap), rate * dt * 4);
    }
    // LE devices: sequenced with the TE flaps (standby can only extend).
    const leTarget = mem.flap < 0.5 ? 0 : mem.flap <= 5.5 ? 1 : 2;
    if ((hydB || env.stbyLe) && mem.le !== leTarget && !(env.stbyLe && !hydB && leTarget < mem.le)) mem.le = leTarget;
    return Math.abs(mem.flap - before) > 1e-3;
  },

  evaluate(env, st) {
    const { sw, mem, fail: f } = st;
    const target = DETENTS[sw.flap];
    const moving = Math.abs(target - mem.flap) > 0.3;
    const ydOn = !!sw.yd && !f.yd && env.hydB !== false && !env.fcBOff;
    const air = env.air;
    const sbExt = sw.sb === 3 || sw.sb === 2;
    return {
      flows: {
        cables: true, aileronCable: true,
        torque: moving && (env.hydB !== false || env.altFlapsArmed),
      },
      units: {
        flaps: mem.flap > 0.5 ? 'on' : 'off', le: mem.le ? 'on' : 'off', sb: sbExt ? 'on' : 'off',
        pdu: moving ? 'on' : 'off', pcu: env.hydA || env.hydB ? 'on' : 'fault', elev: 'on', rud: 'on', ail: 'on', stab: 'on',
      },
      lights: {
        ydLight: !ydOn, feelDiff: env.hydA === false || env.hydB === false || !!f.feel, speedTrimFail: !!f.sts, machTrimFail: !!f.mach,
        autoSlatFail: !!f.autoslat, leTransit: moving && mem.flap > 0 && mem.flap < 5, leExt: mem.le > 0 && !moving,
        sbArmed: sw.sb === 1, sbExtended: sbExt && (air ? env.flaps > 0 || env.alt < 800 : true), sbDoNotArm: false,
        loadRelief: false,
      },
      values: { flap: mem.flap, lever: DETENTS[sw.flap], le: ['RET', 'EXT', 'FULL EXT'][mem.le], sb: SB[sw.sb], sbFrac: [0, 0, 0.5, 1][sw.sb] },
      pose: { flaps: mem.flap, slats: mem.le, speedbrake: [0, 0, 0.55, 1][sw.sb] },
      note: [moving && `Flaps running to ${target}`, !ydOn && 'YAW DAMPER off'].filter(Boolean).join(' · '),
    };
  },
};
