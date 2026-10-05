// sys-gear.js — FCOM chapter 14, landing gear, brakes and steering, in our
// own words. The gear position here drives the 3D gear.

import { MLG, NLG, FLOOR_Y } from './airframe.js?v=14';

const G = '#495057', A = '#2f7cf6', B = '#12a874', BR = '#e8590c';

export default {
  id: 'gear', num: 14, title: 'Landing Gear', fcom: 'FCOM 14', color: '#868e96',
  anchor: [MLG.x, 1.1, MLG.z],
  view: { target: [5, 1.4, 0], dist: 30, dir: [0.4, 0.15, 1] },

  overview: {
    lead: 'Two two-wheel main gears and a twin-wheel nose gear. **System A** raises and lowers them and steers the nose; **system B** brakes (A is the alternate). A manual extension lets the gear free-fall if A is lost.',
    how: [
      'On the ground a **lever lock** stops the lever going UP (an override trigger bypasses it). In flight a solenoid releases it.',
      '**Retraction:** the brakes stop the main wheels spinning, the mains swing inboard and are held by uplocks; there are no main gear doors — seals and big hubcaps fair the outer wheels. The nose gear goes forward behind doors linked to it; snubbers stop the nose wheels. If engine 1 fails, the **transfer valve** lets B supply the volume.',
      '**Extension:** A releases the uplocks; gravity, air loads and A push the gear down; over-centre and hydraulic locks hold it. The **OFF** position removes hydraulic pressure from the gear.',
      '**Steering:** the tiller turns the nose wheels up to 78°, the rudder pedals up to 7°. NORM uses A; ALT uses B (if B\'s reservoir is normal).',
      '**Brakes:** multi-disc brakes on each main wheel only (no nose wheel brakes), with antiskid on both normal (B) and alternate (A) systems; the **accumulator** keeps several applications or the parking brake if both are lost. **Autobrake** works only through the normal brakes.',
    ],
    limits: [
      ['Nose wheel steering, tiller', 'up to 78° each way', 'FCOM 14.20'],
      ['Nose wheel steering, rudder pedals', 'up to 7° each way', 'FCOM 14.20'],
      ['RTO autobrake begins above', '88 kt wheel speed', 'FCOM 14.20'],
      ['Brake temperature: hot above', '4.9 (relative)', 'FCOM 14.10'],
      ['Brakes', 'Do not apply until after touchdown', 'FCOM L.10'],
    ],
    memory: ['The gear is down and locked as long as ONE green light (center or overhead) for each gear is lit.'],
  },

  parts: [
    {
      id: 'lever', name: 'Landing gear lever & lights', at: [15.2, FLOOR_Y + 0.9, 0.2],
      lead: 'UP · OFF · DN on the center panel, with red and green lights for each gear (and a second, separate set on the aft overhead).',
      how: [
        '**Green:** that gear down and locked. **Red:** gear in transit or disagreeing with the lever — or not down and locked with a thrust lever at idle below 800 ft AGL. Lights are out with the gear up and locked and the lever UP or OFF.',
        'One green per gear (center or overhead) is enough to call it down and locked.',
      ],
      deck: [['LANDING GEAR lever (UP · OFF · DN)', 'OFF removes hydraulic pressure from the gear.'], ['Gear lights (red / green)', 'Per gear: down-and-locked green; transit or disagreement red.']],
      related: ['mlg', 'nlg', 'manual'],
    },
    {
      id: 'mlg', name: 'Main gear', at: [MLG.x, 1.0, MLG.z],
      lead: 'Two wheels each, retracting inboard into the wheel well with no outer doors; held up by mechanical uplocks.',
      how: ['A damaged tyre spinning on retraction can hit a wheel-well fitting; that gear then stops retracting and falls back down, and stays down.'],
      related: ['lever', 'brakes', 'manual'],
    },
    {
      id: 'nlg', name: 'Nose gear & steering', at: [NLG.x, 0.8, 0],
      lead: 'Twin wheels retracting forward behind linked doors (which stay open with the gear down). The nose wheels steer; they have no brakes.',
      how: ['Steering works with the nose gear down and compressed. The tiller gives up to 78°, rudder pedals up to 7° (pedal steering fades as the strut extends). A towing lockout pin depressurises steering for pushback.'],
      deck: [['NOSE WHEEL STEERING (ALT · NORM guarded)', 'NORM: system A. ALT: system B.']],
      limits: [['Tiller', '78°', 'FCOM 14.20'], ['Rudder pedals', '7°', 'FCOM 14.20']],
      related: ['lever'],
    },
    {
      id: 'brakes', name: 'Brakes, antiskid & accumulator', at: [MLG.x, 0.6, -MLG.z - 0.5],
      lead: 'Normal brakes on B, alternate on A (automatic changeover if B is low); antiskid on both; an accumulator charged by B.',
      how: [
        'Normal antiskid works wheel by wheel; alternate works on wheel pairs. Skid, locked-wheel, touchdown and hydroplane protection on both — and antiskid still works with both hydraulic systems lost.',
        'The accumulator keeps several brake applications, or the parking brake, with no hydraulic pressure.',
        'Brake temperature (lower DU) is relative 0–9.9; above 4.9 is hot (amber), BRAKE TEMP lights.',
      ],
      deck: [['ANTISKID INOP (amber)', 'Antiskid fault.'], ['HYD BRAKE PRESS', 'Accumulator pressure.'], ['BRAKE TEMP (amber)', 'One or more brakes above 4.9.']],
      related: ['autobrake', 'park'],
    },
    {
      id: 'autobrake', name: 'Autobrake', at: [MLG.x + 0.4, 1.3, 0.6],
      lead: 'Uses the normal brakes (system B): RTO for a rejected takeoff, and 1, 2, 3 or MAX after touchdown.',
      how: [
        '**RTO:** select on the ground (DISARM flashes 1–2 s = self-test passed). Rejected above **88 kt**, it applies maximum braking when the thrust levers come to idle. It disarms when airborne.',
        '**Landing:** begins with both thrust levers at idle after wheel spin-up, easing off as reversers and spoilers add deceleration, and stops the airplane unless you take over.',
        '**Disarm:** selector OFF (no light), or — after braking has started — speed brake lever down, manual braking, or advancing a thrust lever (except the first 3 s after touchdown): AUTO BRAKE DISARM lights.',
      ],
      deck: [['AUTO BRAKE (OFF · RTO · 1 · 2 · 3 · MAX)', 'Pull out to select MAX.'], ['AUTO BRAKE DISARM (amber)', 'Disarmed by the pilot after braking started, or a fault.']],
      limits: [['RTO maximum braking above', '88 kt', 'FCOM 14.20']],
      related: ['brakes'],
    },
    {
      id: 'park', name: 'Parking brake', at: [14.2, FLOOR_Y + 0.6, 0.0],
      lead: 'Both pedals fully down, pull the lever up — the pedals latch. Works with A or B, or on the accumulator.',
      how: ['Release by pressing the pedals until the lever drops. Advancing a thrust lever for takeoff with the parking brake set gives the takeoff configuration warning.'],
      deck: [['PARKING BRAKE (red)', 'Parking brake set (battery-powered light).']],
      related: ['brakes'],
    },
    {
      id: 'manual', name: 'Manual gear extension', at: [15.0, FLOOR_Y + 0.05, 0.6],
      lead: 'Three handles under an access door on the flight deck floor — right main, nose, left main. Each pulled about 24 in (61 cm) releases that gear\'s uplock; gravity and air loads do the rest.',
      how: [
        'With the access door open, manual extension works in any lever position, normal extension still works if A is there, and **retraction is disabled**.',
        'To retract after a manual extension: close the door, lever DN with A pressure, then UP.',
      ],
      deck: [['MANUAL EXTENSION ACCESS DOOR', 'Open: retraction disabled. Closed: normal operation.']],
      related: ['lever', 'mlg'],
    },
    {
      id: 'ag', name: 'Air/ground system', at: [MLG.x, 1.6, MLG.z - 0.2],
      lead: 'Six sensors, two per gear, tell the systems whether the airplane is flying — for pressurisation, spoilers, reversers, warnings and more.',
      related: ['mlg'],
    },
  ],

  build(K) {
    for (const side of [-1, 1]) {
      K.unit('mlg', { cyl: [[MLG.x, 2.3, side * MLG.pivotZ], [MLG.x, 0.6, side * MLG.z]], r: 0.06 }, { color: G });
      K.flow('gearA', [[MLG.x + 0.5, 1.9, side * 0.4], [MLG.x, 2.3, side * MLG.pivotZ]], { color: A, part: 'mlg', r: 0.05 });
      K.flow('brakeB', [[MLG.x + 0.5, 1.9, side * 0.6], [MLG.x, 2.0, side * MLG.pivotZ], [MLG.x, 0.6, side * MLG.z]], { color: B, part: 'brakes', r: 0.035 });
      K.flow('brakeA', [[MLG.x + 0.5, 1.8, side * 0.5], [MLG.x - 0.1, 1.9, side * MLG.pivotZ], [MLG.x - 0.1, 0.65, side * MLG.z]], { color: A, part: 'brakes', r: 0.03 });
      K.unit('ag', { sphere: [MLG.x, 1.6, side * (MLG.z + 0.2)], r: 0.06 }, { color: '#adb5bd' });
    }
    K.unit('nlg', { cyl: [[NLG.x, NLG.pivotY, 0], [NLG.x, 0.4, 0]], r: 0.05 }, { color: G });
    K.flow('steer', [[MLG.x + 0.5, 1.8, 0], [4, 1.35, 0.1], [NLG.x - 0.4, 1.4, 0.1], [NLG.x, 1.2, 0]], { color: A, part: 'nlg', r: 0.04 });
    K.flow('steerB', [[MLG.x + 0.5, 1.9, -0.2], [4, 1.45, -0.1], [NLG.x - 0.4, 1.5, -0.1], [NLG.x, 1.25, 0]], { color: B, part: 'nlg', r: 0.04 });
    K.unit('brakes', { cyl: [[MLG.x + 0.6, 1.6, 0.9], [MLG.x + 0.6, 2.0, 0.9]], r: 0.12 }, { color: B });
    K.unit('autobrake', { box: [MLG.x + 0.4, 1.3, 0.6], size: [0.25, 0.2, 0.2] }, { color: BR });
    K.unit('lever', { box: [15.2, FLOOR_Y + 0.9, 0.2], size: [0.1, 0.2, 0.08] }, { color: G });
    K.unit('manual', { box: [15.0, FLOOR_Y + 0.05, 0.6], size: [0.4, 0.04, 0.3] }, { color: '#fab005' });
    K.unit('park', { box: [14.2, FLOOR_Y + 0.6, 0], size: [0.08, 0.08, 0.08] }, { color: '#e03131' });
  },

  normal(phase) {
    const lever = phase === 'cruise' ? 1 : 2;            // OFF after retraction, DN otherwise
    return {
      sw: { lever, ab: phase === 'landing' ? 3 : phase === 'ground' || phase === 'takeoff' ? 1 : 0, nws: 1, park: phase === 'ground' ? 1 : 0, door: 0 },
      fail: {},
      mem: { pos: phase === 'cruise' ? 0 : 1, acc: 3000, lgtv: false },
    };
  },

  tick(dt, st, env) {
    const { sw, mem } = st;
    const before = mem.pos, lv = sw.lever;
    // Ground: the lever lock stops the lever going UP.
    if (!env.air && sw.lever === 0) { sw.lever = 2; mem.lock = true; }
    if (!sw.door) mem.manual = false;
    const hydA = env.hydA !== false;
    const xfr = env.air && !env.eng1 && env.hydB !== false;       // transfer valve (B)
    if (mem.manual || (sw.lever === 2 && hydA)) mem.pos = Math.min(1, mem.pos + dt * 0.4);
    else if (sw.lever === 0 && !sw.door && (hydA || xfr)) mem.pos = Math.max(0, mem.pos - dt * 0.35);
    mem.acc = env.hydB !== false ? 3000 : Math.max(1000, (mem.acc ?? 3000) - dt * 4);
    return mem.pos !== before || sw.lever !== lv;
  },

  action(st, key) {
    if (key === 'pullHandles' && st.sw.door) st.mem.manual = true;
  },

  evaluate(env, st) {
    const { sw, mem, fail: f } = st;
    const pos = mem.pos;
    const downLocked = pos > 0.999, upLocked = pos < 0.001;
    const transit = !downLocked && !upLocked;
    // OFF is neither up nor down: only UP with gear not up, or DN with gear not down, disagree.
    const disagree = (sw.lever === 2 && !downLocked) || (sw.lever === 0 && !upLocked);
    const thrustIdleLow = env.alt < 800 && env.air && env.phase === 'landing';
    const red = transit || disagree || (!downLocked && thrustIdleLow);
    const hydA = env.hydA !== false;
    const steer = downLocked && !env.air && (sw.nws ? sw.lever === 2 && hydA : env.hydB !== false);
    const abArmed = sw.ab >= 2 || (sw.ab === 1 && !env.air);
    const braking = env.phase === 'landing' && sw.ab >= 2 && env.hydB !== false;
    return {
      flows: {
        gearA: transit && hydA, brakeB: braking || (!!sw.park && env.hydB !== false), brakeA: env.hydB === false && hydA && (braking || !!sw.park),
        // NORM: system A reaches the steering valve only with the lever DN.
        // ALT: system B (normal B reservoir quantity), on the ground.
        steer: steer && !!sw.nws, steerB: steer && !sw.nws,
      },
      units: {
        lever: red ? 'fault' : 'on', mlg: downLocked ? 'on' : transit ? 'fault' : 'off', nlg: downLocked ? 'on' : transit ? 'fault' : 'off',
        brakes: f.antiskid || env.hydB === false && env.hydA === false ? 'fault' : 'on', autobrake: abArmed ? 'on' : 'off', park: sw.park ? 'fault' : 'off',
        manual: sw.door ? 'fault' : 'off', ag: 'on',
      },
      lights: {
        green: downLocked, red, abDisarm: !!f.autobrake || (sw.ab === 1 && env.phase === 'landing'), antiskid: !!f.antiskid,
        park: !!sw.park, brakeTemp: env.phase === 'landing' && sw.ab >= 4,
      },
      values: { steer, pos, xfr: env.air && !env.eng1 && !upLocked && sw.lever === 0, lock: !!mem.lock, manual: !!mem.manual, acc: Math.round(mem.acc), ab: ['OFF', 'RTO', '1', '2', '3', 'MAX'][sw.ab], lever: ['UP', 'OFF', 'DN'][sw.lever] },
      pose: { gear: pos },
      note: [!env.air && downLocked && !steer && (sw.nws && sw.lever !== 2 ? 'No nose wheel steering: lever not DN (NORM steering needs it)' : 'No nose wheel steering: no hydraulic pressure'), mem.lock && !env.air && 'Lever lock: gear lever cannot go UP on the ground', transit && (sw.lever === 2 ? 'Gear extending' : 'Gear retracting'), braking && `Autobrake ${['', '', '1', '2', '3', 'MAX'][sw.ab]} braking`].filter(Boolean).join(' · '),
    };
  },
};
