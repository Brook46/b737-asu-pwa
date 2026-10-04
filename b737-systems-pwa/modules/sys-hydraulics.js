// sys-hydraulics.js — FCOM chapter 13. Content is written for study in our
// own words; numbers cite the FCOM section they come from.

import { ENG, engPoint, wingLE, wingChord, wingY, YC, MLG, NLG } from './airframe.js?v=7';

const A = '#2f7cf6', B = '#12a874', S = '#f2711c';

// Handy spar points (u: chord fraction) on either wing.
const spar = (z, u, dy = 0) => [wingLE(z) - u * wingChord(z), wingY(z) + dy, z];
const WW = { x: -2.4, y: 2.05 };   // main wheel well, forward area

export default {
  id: 'hydraulics', num: 13, title: 'Hydraulics', fcom: 'FCOM 13', color: A,
  anchor: [-2.6, 2.0, 0],
  view: { target: [-2, 2.6, 0], dist: 42, dir: [0.55, 0.75, 0.6] },
  overview: {
    lead: 'Three hydraulic systems — **A**, **B** and **standby** — all at a nominal **3000 psi**. A or B alone can fly the airplane: either one powers every primary flight control with no loss of controllability.',
    how: [
      'A and B each have an **engine-driven pump** (EDP) and an **AC electric pump** (EMDP). Engine 1 drives the A pump, engine 2 the B pump; the electric pumps are cross-wired — **ELEC 2 is in system A, ELEC 1 in system B** — so losing one side\'s electrics never takes both pumps of one system.',
      'An EDP moves roughly six times the fluid of an EMDP. The electric pumps are there for the ground, for high demand, and as backup.',
      'The reservoirs sit in the main wheel well and are kept pressurised by bleed air so the pumps never cavitate. The standby reservoir shares system B\'s reservoir for pressurisation and servicing.',
      'The standby system has one electric pump and powers only the essentials: **rudder**, **both thrust reversers**, **leading-edge devices (extend only)** and the **standby yaw damper**. It starts by itself when A or B is lost with flaps out, or when you select STBY RUD or ALTERNATE FLAPS ARM.',
      'Two helpers move fluid volume, not pressure: the **PTU** lets A drive B\'s leading-edge devices if B\'s engine pump is lost, and the **landing-gear transfer valve** lets B raise the gear if engine 1 is lost on takeoff.',
    ],
    limits: [
      ['Normal system pressure', '3000 psi', 'FCOM 13.10.2'],
      ['Maximum system pressure', '3500 psi', 'FCOM 13.10.2'],
      ['RF (refill) shown below', '76 % quantity', 'FCOM 13.10.2'],
      ['Min fuel in main tank to run electric pumps on the ground', '760 kg', 'FCOM 13.20.6'],
    ],
    memory: [
      'Either A or B can fly the airplane. The standby system is a backup for the rudder, reversers and LE devices only — it does not power ailerons or elevators.',
      'Leaks behave differently: an A leak at the engine pump stops at the **standpipe (~20 %)** and the electric pump keeps A alive; a leak common to both A pumps, or any B leak, drains the system to zero.',
    ],
  },

  parts: [
    {
      id: 'resA', name: 'System A reservoir', at: [WW.x, WW.y + 0.2, -0.75],
      lead: 'Holds system A\'s fluid in the main wheel well, pressurised by bleed air so both A pumps always have a positive feed.',
      how: [
        'Inside is a **standpipe**: the engine-driven pump draws from above it, the electric pump from the very bottom. If the engine pump or its lines leak, the level can only fall to the top of the standpipe — about **20 %** on the gauge — and the electric pump keeps system A pressurised.',
        'A leak in the electric pump\'s side, or in anything common to both pumps, takes the quantity all the way to zero and system A is lost.',
      ],
      deck: [['HYDRAULIC QTY % (lower DU, SYS page)', 'Digital quantity 0–106 %. **RF** appears below 76 % — valid on the ground with engines shut down, or taxiing in with flaps up.']],
      limits: [['Standpipe level after an EDP-side leak', '≈ 20 %', 'FCOM 13.20.6']],
      fails: ['Quantity dropping and stabilising near 20 %: leak on the engine-pump side — ELEC 2 still holds A.', 'Quantity to zero: A lost. Expect flight-control LOW PRESSURE A; flaps out + airborne brings the standby pump on automatically.'],
      related: ['edp1', 'emdpA', 'resB', 'resS'],
    },
    {
      id: 'resB', name: 'System B reservoir', at: [WW.x, WW.y + 0.2, 0.6],
      lead: 'System B\'s reservoir, also in the main wheel well. It pressurises and services the standby reservoir too.',
      how: [
        'B has **one** standpipe feeding both of its pumps, so a leak anywhere in B — either pump, a line or a component — drains B to about zero and B pressure is lost.',
        'Even at the standpipe level there is enough fluid left for the **PTU** to work.',
        'A standby-system leak shows up here: B\'s quantity falls and settles near **70 %** while B keeps working normally.',
      ],
      limits: [['B quantity after a standby-system leak', '≈ 70 %', 'FCOM 13.20.10']],
      fails: ['B leak: quantity to ≈ 0, B pressure lost. A B leak does not affect the standby system.'],
      related: ['resS', 'edp2', 'emdpB', 'ptu'],
    },
    {
      id: 'resS', name: 'Standby reservoir', at: [WW.x - 0.5, WW.y + 0.1, 1.25],
      lead: 'A small reservoir for the standby pump, plumbed to system B\'s reservoir for pressure and refilling.',
      how: ['Its **LOW QUANTITY** light is always armed and comes on when the reservoir is about half empty. A standby leak takes it to zero, but B carries on.'],
      deck: [['STANDBY HYD LOW QUANTITY (amber)', 'Low fluid in the standby reservoir. Always armed.']],
      related: ['stby', 'resB'],
    },
    {
      id: 'edp1', name: 'Engine pump · ENG 1 (A)', at: engPoint(1, 1.7, -0.7, 0.35),
      lead: 'Driven by engine 1\'s gearbox — the main pressure source of system A.',
      how: [
        'It turns whenever engine 1 turns. The ENG 1 switch does not stop it; OFF energises a **blocking valve** that dumps its output so it no longer pressurises the system.',
        'Pulling the engine 1 fire switch shuts off fluid to the pump and kills its LOW PRESSURE light.',
      ],
      deck: [
        ['ENGINE HYDRAULIC PUMPS · ENG 1', 'ON lets pump pressure into system A. Leave it ON at shutdown — it prolongs the blocking-valve solenoid\'s life.'],
        ['LOW PRESSURE (amber)', 'This pump\'s output pressure is low.'],
      ],
      related: ['emdpA', 'resA', 'lgtv'],
    },
    {
      id: 'edp2', name: 'Engine pump · ENG 2 (B)', at: engPoint(2, 1.7, -0.7, -0.35),
      lead: 'System B\'s engine-driven pump, on engine 2. Same design and switch logic as engine 1\'s.',
      how: ['If this pump\'s pressure drops in flight with the flaps out, the **PTU** steps in to keep the leading-edge devices and autoslats moving at normal speed.'],
      deck: [['ENGINE HYDRAULIC PUMPS · ENG 2', 'ON lets pump pressure into system B.']],
      related: ['emdpB', 'ptu', 'resB'],
    },
    {
      id: 'emdpA', name: 'Electric pump · ELEC 2 (A)', at: [-3.7, 1.75, -0.45],
      lead: 'System A\'s AC electric pump — powered from the **No. 2** electrical side, deliberately crossed.',
      how: [
        'Fluid that cools and lubricates the pump runs through a **heat exchanger in main tank 1** before going back to the reservoir — which is why there is a minimum fuel to run it on the ground.',
        'On some airplanes an overheat also cuts its power and brings the LOW PRESSURE light on. If the engine pump is lost and demand is high, this pump\'s LOW PRESSURE light may flicker.',
      ],
      deck: [
        ['ELECTRIC HYDRAULIC PUMPS · ELEC 2', 'ON powers the pump; OFF removes power.'],
        ['OVERHEAT (amber)', 'The pump, or the fluid cooling it, has overheated.'],
      ],
      limits: [['Min fuel in main tank 1 to run it on the ground', '760 kg', 'FCOM 13.20.6']],
      related: ['heatx', 'resA', 'edp1'],
    },
    {
      id: 'emdpB', name: 'Electric pump · ELEC 1 (B)', at: [-3.7, 1.75, 0.45],
      lead: 'System B\'s AC electric pump, powered from the **No. 1** side. Its cooling fluid passes through a heat exchanger in **main tank 2**.',
      deck: [['ELECTRIC HYDRAULIC PUMPS · ELEC 1', 'ON powers the pump; OFF removes power.']],
      limits: [['Min fuel in main tank 2 to run it on the ground', '760 kg', 'FCOM 13.20.6']],
      related: ['heatx', 'resB', 'edp2'],
    },
    {
      id: 'heatx', name: 'Heat exchangers (in the main tanks)', at: spar(-5.6, 0.45, -0.05),
      lead: 'Pump case-drain fluid is cooled by the fuel: A\'s exchanger is in main tank 1, B\'s in main tank 2.',
      how: ['That is the reason for the ground limit: with less than **760 kg** in the related main tank, the fuel can no longer carry the heat away from a running electric pump.'],
      limits: [['Min fuel per related main tank for EMDP ground running', '760 kg', 'FCOM 13.20.6']],
      related: ['emdpA', 'emdpB'],
    },
    {
      id: 'ptu', name: 'Power transfer unit (PTU)', at: [-3.1, 1.6, 1.0],
      lead: 'A hydraulic motor driven by system A, turning a pump that pushes **system B fluid** — no fluid crosses between the systems.',
      how: [
        'Its job is volume: it keeps the **leading-edge flaps, slats and autoslats** moving at the normal rate when B\'s engine pump is lost.',
        'It runs by itself when all of these are true: **airborne**, **B engine-pump pressure below limits**, and **flaps not up** (on some airplanes also less than 15).',
      ],
      fails: ['Lose B\'s engine pump with the flaps out: the PTU runs and the LE devices still move at the normal rate.', 'Even after a B leak, the fluid left at B\'s standpipe is enough for the PTU to work.'],
      related: ['edp2', 'resB', 'lgtv'],
    },
    {
      id: 'lgtv', name: 'Landing-gear transfer valve', at: [-3.3, 1.65, -1.05],
      lead: 'Lets **system B** raise the landing gear at the normal rate when engine 1 (system A\'s big pump) is lost after takeoff.',
      how: ['It switches on when all are true: **airborne**, **engine 1 RPM below a limit**, **gear lever UP**, and **either main gear not up and locked**. B\'s engine pump then supplies the volume.'],
      related: ['edp2', 'gear', 'ptu'],
    },
    {
      id: 'stby', name: 'Standby pump', at: [WW.x - 0.8, 1.7, 1.25],
      lead: 'One AC electric pump feeding the standby system: rudder, both reversers, LE devices (extend only) and standby yaw damper.',
      how: [
        '**Manual:** FLT CONTROL A or B to **STBY RUD** starts it, closes that system\'s flight-control shutoff valve (ailerons, elevators, rudder) and opens the standby rudder shutoff valve. **ALTERNATE FLAPS ARM** also starts it and lets it extend the LE devices.',
        '**Automatic:** loss of A or B **and** flaps extended **and** airborne or wheel speed above 60 kt **and** that system\'s FLT CONTROL switch ON — or the main rudder PCU\'s force-fight monitor tripping.',
        'Whenever it powers the rudder, STBY RUD ON, MASTER CAUTION and FLT CONT light.',
      ],
      deck: [
        ['FLT CONTROL A / B', 'STBY RUD · OFF · ON (guarded). OFF closes that system\'s flight-control shutoff valve.'],
        ['STANDBY HYD LOW PRESSURE', 'Standby pump output low — armed only when standby operation is selected or automatic.'],
        ['STBY RUD ON', 'Standby system commanded to pressurise the standby rudder PCU.'],
        ['ALTERNATE FLAPS master', 'OFF (guarded) · ARM — closes the TE flap bypass valve, starts the standby pump, arms the position switch.'],
      ],
      related: ['resS', 'rudder', 'revs'],
    },
    {
      id: 'rudder', name: 'Rudder PCUs', at: [-16.4, 5.3, 0],
      lead: 'The main rudder power control unit takes A and B together; a separate **standby rudder PCU** takes the standby system.',
      how: ['The yaw damper works through B (and the standby yaw damper through the standby system). If the main PCU\'s force-fight monitor detects A and B fighting each other, the standby system comes on automatically.'],
      related: ['stby', 'fltctl'],
    },
    {
      id: 'fltctl', name: 'Ailerons, elevators & feel', at: [-16.9, 3.9, 0],
      lead: 'Ailerons, elevators and elevator feel take pressure from **both** A and B through each system\'s flight-control shutoff valve.',
      how: [
        'Either system alone powers them fully. The flight-control LOW PRESSURE light for A or B shows that system\'s pressure to these surfaces is low — including when its FLT CONTROL switch is OFF.',
        'Spoilers are split: A drives flight spoilers 2, 4, 9, 11 and the ground spoilers 1, 6, 7, 12; B drives flight spoilers 3, 5, 8, 10.',
      ],
      deck: [['Flight control LOW PRESSURE A / B', 'Low A or B pressure to ailerons, elevator and rudder. Goes out when that switch is at STBY RUD and the standby rudder valve opens.']],
      related: ['rudder', 'stby'],
    },
    {
      id: 'revs', name: 'Thrust reversers', at: engPoint(2, 3.0, 0.9, 0),
      lead: 'No. 1 reverser runs on A, No. 2 on B — and the standby system can drive both.',
      related: ['stby', 'edp1', 'edp2'],
    },
    {
      id: 'gear', name: 'Gear, brakes & steering', at: [MLG.x, 1.3, -MLG.z],
      lead: 'System A raises and lowers the gear and powers normal nose-wheel steering and the alternate brakes; system B powers the normal brakes and alternate steering.',
      how: ['B is also the alternate source for raising the gear, through the landing-gear transfer valve.'],
      related: ['lgtv'],
    },
  ],

  build(K) {
    // EDPs and their lines up the pylon, along the rear spar into the well.
    for (const [n, side, col, key] of [[1, -1, A, 'A_edp'], [2, 1, B, 'B_edp']]) {
      const p = engPoint(n, 1.7, -0.7, -side * 0.35);
      K.unit(n === 1 ? 'edp1' : 'edp2', { sphere: p, r: 0.28 }, { color: col });
      K.flow(key, [p, engPoint(n, 3.2, 0.7, 0), spar(side * ENG.z, 0.66, -0.12), spar(side * 2.4, 0.7, -0.15),
        [WW.x, WW.y, side * 0.7]], { color: col, part: n === 1 ? 'edp1' : 'edp2' });
    }
    // Reservoirs (cylinders) and electric pumps.
    K.unit('resA', { cyl: [[WW.x, WW.y - 0.3, -0.75], [WW.x, WW.y + 0.55, -0.75]], r: 0.24 }, { color: A });
    K.unit('resB', { cyl: [[WW.x, WW.y - 0.3, 0.6], [WW.x, WW.y + 0.55, 0.6]], r: 0.24 }, { color: B });
    K.unit('resS', { cyl: [[WW.x - 0.5, WW.y - 0.15, 1.25], [WW.x - 0.5, WW.y + 0.35, 1.25]], r: 0.15 }, { color: S });
    K.unit('emdpA', { sphere: [-3.7, 1.75, -0.45], r: 0.22 }, { color: A });
    K.unit('emdpB', { sphere: [-3.7, 1.75, 0.45], r: 0.22 }, { color: B });
    K.unit('stby', { sphere: [WW.x - 0.8, 1.7, 1.25], r: 0.18 }, { color: S });
    K.unit('ptu', { box: [-3.1, 1.6, 1.0], size: [0.45, 0.3, 0.3] }, { color: B });
    K.unit('lgtv', { box: [-3.3, 1.65, -1.05], size: [0.28, 0.22, 0.22] }, { color: A });
    K.unit('heatx', { box: spar(-5.6, 0.45, -0.05), size: [0.5, 0.12, 0.35] }, { color: A });
    K.unit('heatx', { box: spar(5.6, 0.45, -0.05), size: [0.5, 0.12, 0.35] }, { color: B });
    K.flow('A_emdp', [[-3.7, 1.75, -0.45], [WW.x - 0.6, 1.8, -0.75], [WW.x, WW.y - 0.25, -0.75]], { color: A, part: 'emdpA', r: 0.05 });
    K.flow('B_emdp', [[-3.7, 1.75, 0.45], [WW.x - 0.6, 1.8, 0.6], [WW.x, WW.y - 0.25, 0.6]], { color: B, part: 'emdpB', r: 0.05 });
    // Case-drain loops to the heat exchangers.
    K.flow('A_emdp', [[-3.7, 1.75, -0.45], spar(-2.4, 0.6, -0.2), spar(-5.6, 0.45, -0.05)], { color: A, part: 'heatx', r: 0.035 });
    K.flow('B_emdp', [[-3.7, 1.75, 0.45], spar(2.4, 0.6, -0.2), spar(5.6, 0.45, -0.05)], { color: B, part: 'heatx', r: 0.035 });

    // Main manifolds aft to the tail: rudder + elevator PCUs.
    const aftA = [[WW.x - 0.2, 1.75, -0.5], [-6, 1.85, -0.55], [-11, 2.7, -0.45], [-15.2, 3.7, -0.15]];
    const aftB = [[WW.x - 0.2, 1.75, 0.35], [-6, 1.85, 0.4], [-11, 2.7, 0.35], [-15.2, 3.7, 0.15]];
    K.flow('Afc', [...aftA, [-16.4, 4.6, 0]], { color: A, part: 'fltctl' });
    K.flow('Bfc', [...aftB, [-16.4, 4.6, 0]], { color: B, part: 'fltctl' });
    K.flow('Afc', [[-15.2, 3.7, -0.15], [-16.4, 5.3, -0.05]], { color: A, part: 'rudder', r: 0.05 });
    K.flow('Bfc', [[-15.2, 3.7, 0.15], [-16.4, 5.3, 0.05]], { color: B, part: 'rudder', r: 0.05 });
    K.unit('fltctl', { box: [-16.9, 3.9, 0], size: [0.6, 0.35, 0.5] }, { color: A });
    K.unit('rudder', { box: [-16.4, 5.3, 0], size: [0.5, 0.6, 0.25] }, { color: A });
    // Standby: pump → standby rudder PCU, and out to both reversers + LE devices.
    K.flow('S_rud', [[WW.x - 0.8, 1.7, 1.25], [-6, 1.9, 0.9], [-11, 2.8, 0.7], [-15.4, 4.0, 0.25], [-16.4, 5.0, 0.1]], { color: S, part: 'stby' });
    for (const side of [-1, 1]) {
      K.flow('S_rev', [[WW.x - 0.8, 1.7, 1.25], spar(side * 2.4, 0.18, -0.2), spar(side * ENG.z, 0.12, -0.15),
        engPoint(side < 0 ? 1 : 2, 3.0, 0.8, 0)], { color: S, part: 'revs', r: 0.045 });
      K.flow('S_le', [spar(side * 2.4, 0.18, -0.2), spar(side * 8, 0.1, 0), spar(side * 16, 0.08, 0)], { color: S, part: 'stby', r: 0.04 });
    }
    // System A users: spoilers (both wings), No.1 reverser, gear, nose steering.
    for (const side of [-1, 1]) {
      K.flow('A', [[WW.x, WW.y - 0.35, -0.5], spar(side * 2.4, 0.63, -0.18), spar(side * 7, 0.6, 0.02), spar(side * 12.3, 0.6, 0.04)],
        { color: A, part: 'fltctl', r: 0.04 });
      K.flow('A', [[WW.x, WW.y - 0.35, -0.5], [MLG.x, MLG.pivotY - 0.05, side * MLG.pivotZ]], { color: A, part: 'gear', r: 0.045 });
    }
    K.flow('A', [[WW.x, WW.y - 0.35, -0.5], spar(-2.4, 0.18, -0.2), spar(-ENG.z, 0.12, -0.15), engPoint(1, 3.0, 0.9, 0)],
      { color: A, part: 'revs', r: 0.05 });
    K.flow('A', [[WW.x + 0.2, 1.6, -0.3], [2, 1.4, -0.3], [8, 1.35, -0.25], [NLG.x - 0.3, NLG.pivotY - 0.1, 0]], { color: A, part: 'gear', r: 0.045 });
    // System B users: LE devices along the front spar, No.2 reverser, brakes.
    for (const side of [-1, 1]) {
      K.flow('B_le', [[WW.x, WW.y - 0.35, 0.4], spar(side * 2.2, 0.15, -0.22), spar(side * 9, 0.12, 0), spar(side * 16.2, 0.1, 0.02)],
        { color: B, part: 'ptu', r: 0.045 });
      K.flow('B', [[WW.x, WW.y - 0.35, 0.4], [MLG.x, MLG.pivotY - 0.15, side * (MLG.pivotZ - 0.1)]], { color: B, part: 'gear', r: 0.04 });
    }
    K.flow('B', [[WW.x, WW.y - 0.35, 0.4], spar(2.4, 0.2, -0.2), spar(ENG.z, 0.14, -0.15), engPoint(2, 3.0, 0.9, 0)],
      { color: B, part: 'revs', r: 0.05 });
    K.unit('revs', { box: engPoint(1, 2.9, 0.85, 0), size: [0.5, 0.18, 0.4] }, { color: A });
    K.unit('revs', { box: engPoint(2, 2.9, 0.85, 0), size: [0.5, 0.18, 0.4] }, { color: B });
    // PTU: A in, B out. Transfer valve: B to the gear.
    K.flow('ptu', [[WW.x, WW.y - 0.3, -0.75], [-3.1, 1.6, 0.6], [-3.1, 1.6, 1.0]], { color: A, part: 'ptu', r: 0.045 });
    K.flow('lgtv', [[WW.x, WW.y - 0.3, 0.6], [-3.3, 1.65, -1.05], [MLG.x, MLG.pivotY - 0.1, -MLG.pivotZ]], { color: B, part: 'lgtv', r: 0.045 });
    K.unit('gear', { box: [MLG.x, MLG.pivotY - 0.15, -MLG.pivotZ + 0.1], size: [0.35, 0.3, 0.35] }, { color: A });
  },

  /** Normal switch positions for a phase (what the procedures leave you with). */
  normal() {
    return { sw: { eng1: 1, elec2: 1, elec1: 1, eng2: 1, fcA: 2, fcB: 2, altFlaps: 0 },
      fail: {}, q: { A: 98, B: 96, S: 100 } };
  },

  /** Quantities drift toward where a leak would leave them. */
  tick(dt, st) {
    const f = st.fail;
    const tgt = {
      A: f.leakAcom ? 0 : f.leakAedp ? 20 : 98,
      B: f.leakB ? 0 : f.leakS ? 70 : 96,
      S: f.leakS ? 0 : 100,
    };
    let moved = false;
    for (const k of ['A', 'B', 'S']) {
      const d = tgt[k] - st.q[k];
      if (Math.abs(d) > 0.05) { st.q[k] += Math.sign(d) * Math.min(Math.abs(d), (d < 0 ? 9 : 30) * dt); moved = true; }
    }
    return moved;
  },

  evaluate(env, st) {
    const { sw, fail: f, q } = st;
    const eng1 = env.eng1 && !f.eng1, eng2 = env.eng2 && !f.eng2;
    // FLT CONTROL: 0 STBY RUD · 1 OFF · 2 ON
    const edp1 = eng1 && sw.eng1 && !f.leakAedp && q.A > 0.5;
    const emdpA = !!sw.elec2 && !f.ovhtA && q.A > 0.5;
    const edp2 = eng2 && sw.eng2 && q.B > 0.5;
    const emdpB = !!sw.elec1 && q.B > 0.5;
    const pA = edp1 || emdpA, pB0 = edp2 || emdpB;
    const flapsOut = env.flaps > 0;
    // B's standpipe keeps enough fluid for the PTU even after a B leak (13.20.6).
    const ptu = env.air && !edp2 && flapsOut && pA;
    const pB = pB0;
    const lostA = !pA, lostB = !pB;
    const stbyManual = sw.fcA === 0 || sw.fcB === 0 || !!sw.altFlaps;
    const stbyAuto = flapsOut && (env.air || env.wheel > 60) &&
      ((lostA && sw.fcA === 2) || (lostB && sw.fcB === 2));
    const stbyCmd = stbyManual || stbyAuto;
    const stbyRun = stbyCmd && q.S > 0.5;
    const stbyRud = (sw.fcA === 0 || sw.fcB === 0 || stbyAuto) && stbyRun;
    const lgtv = env.air && !eng1 && env.gearDown && pB;
    const fcA = pA && sw.fcA === 2, fcB = pB && sw.fcB === 2;

    return {
      flows: {
        A_edp: edp1, A_emdp: emdpA, B_edp: edp2, B_emdp: emdpB,
        A: pA, B: pB, Afc: fcA, Bfc: fcB, B_le: pB || ptu,
        S_rud: stbyRud, S_rev: stbyRun, S_le: stbyRun && !!sw.altFlaps,
        ptu, lgtv,
      },
      units: {
        edp1: f.leakAedp ? 'fault' : edp1 ? 'on' : 'off',
        edp2: edp2 ? 'on' : 'off',
        emdpA: f.ovhtA ? 'fault' : emdpA ? 'on' : 'off',
        emdpB: emdpB ? 'on' : 'off',
        resA: q.A < 50 ? 'fault' : 'on', resB: q.B < 50 ? 'fault' : 'on', resS: q.S < 50 ? 'fault' : 'on',
        stby: stbyRun ? 'on' : 'off', ptu: ptu ? 'on' : 'off', lgtv: lgtv ? 'on' : 'off',
        fltctl: fcA || fcB ? 'on' : 'fault', rudder: fcA || fcB || stbyRud ? 'on' : 'fault',
        revs: pA || pB || stbyRun ? 'on' : 'off', gear: pA ? 'on' : 'off', heatx: 'on',
      },
      lights: {
        lpEng1: !edp1, lpElec2: !emdpA, lpElec1: !emdpB, lpEng2: !edp2,
        ovhtElec2: !!f.ovhtA, ovhtElec1: false,
        fcLpA: !fcA && !(sw.fcA === 0 && stbyRud), fcLpB: !fcB && !(sw.fcB === 0 && stbyRud),
        stbyLowQty: q.S < 50, stbyLowPress: stbyCmd && !stbyRun, stbyRudOn: sw.fcA === 0 || sw.fcB === 0 || stbyAuto,
      },
      values: {
        pressA: pA ? 3000 : 40, pressB: pB ? 3000 : 40,
        qtyA: Math.round(q.A), qtyB: Math.round(q.B), qtyS: Math.round(q.S),
        rfA: q.A < 76, rfB: q.B < 76,
      },
      users: {
        A: pA, B: pB, S: stbyRun, Afc: fcA, Bfc: fcB, Srud: stbyRud, Sle: stbyRun && !!sw.altFlaps,
        Ble: pB || ptu, ptu, lgtv,
      },
      note: [
        ptu && 'PTU running: A is driving B\'s LE devices',
        stbyAuto && 'Standby pump started automatically',
        lgtv && 'Gear transfer valve: B raising the gear',
      ].filter(Boolean).join(' · '),
    };
  },
};
