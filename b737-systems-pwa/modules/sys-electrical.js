// sys-electrical.js — FCOM chapter 6, in our own words.
//
// Source logic follows the FCOM's two rules: AC sources are never paralleled,
// and connecting a source to a transfer bus drops whatever was on it. We keep
// the crew's *manual* selection per transfer bus (that is what the SOURCE OFF
// light reports on) and derive actual power from it: a bus with no usable
// selection is picked up through the bus-tie breakers from the other side
// while BUS TRANSFER is in AUTO.

import { ENG, engPoint, wingLE, wingChord, wingY, YC, APU, EE } from './airframe.js?v=38';

const AC = '#f5a300', DC = '#7048e8', STBY = '#e03131', BAT = '#2f9e44', APUC = '#e8590c', GPU = '#1c7ed6';
const spar = (z, u, dy = 0) => [wingLE(z) - u * wingChord(z), wingY(z) + dy, z];
const E = { x: 11.6, y: EE.y };

const SRC_NAME = { gen1: 'GEN 1', gen2: 'GEN 2', apu: 'APU GEN', gpu: 'EXT PWR' };

export default {
  id: 'electrical', num: 6, title: 'Electrical', fcom: 'FCOM 6', color: AC,
  anchor: [E.x, E.y + 0.2, 0],
  view: { target: [2, 2.2, 0], dist: 44, dir: [0.8, 0.7, 0.6] },

  overview: {
    lead: 'Two engine-driven **IDGs** make 115 V, 400 Hz AC; the **APU generator** and **external power** can stand in. TRs turn AC into 28 V DC, and a battery keeps the **standby** buses alive if everything else goes.',
    how: [
      'Two rules run the whole system: **AC sources are never paralleled**, and **connecting a source to a transfer bus automatically drops the one already there**.',
      'Each side has a **transfer bus** feeding a main bus, galley buses and a ground service bus. In flight each IDG normally powers its own side. If one stops, the **bus tie breakers (BTBs)** close and the other IDG — or the APU — powers both sides through the tie bus.',
      'Three **TR units** make DC. TR1 runs from transfer bus 1, TR2 from transfer bus 2, TR3 normally from bus 2 with bus 1 as backup. Any two can carry the whole DC load. Normally a **cross bus tie** joins DC 1, DC 2 and the DC standby bus; it opens at glide-slope capture (so one failure can\'t take both nav receivers and flight-control computers on an ILS) and with BUS TRANSFER OFF.',
      'The **standby system** keeps essential instruments, radios and controls running: AC standby normally from transfer bus 1, DC standby from the TRs. Lose transfer bus 1 or DC bus 1 and it switches automatically to the **battery**, with the **static inverter** making the AC.',
      'The APU generator can power both transfer buses on the ground or in flight — and alone it carries everything on the ground and most things in flight.',
    ],
    limits: [
      ['IDG output', '115 V AC, 3-phase, 400 Hz', 'FCOM 6.20'],
      ['Battery voltage range', '22–30 V', 'FCOM 6.20'],
      ['Standby on battery (single battery)', '≥ 30 min', 'FCOM 6.20'],
      ['Standby on main + auxiliary battery', '≥ 60 min', 'FCOM 6.20'],
      ['APU electrical load: max altitude', '41,000 ft', 'FCOM L.10'],
      ['APU bleed + electrical, in flight: max altitude', '10,000 ft', 'FCOM L.10'],
      ['APU bleed + electrical, ground: max altitude', '15,000 ft', 'FCOM L.10'],
    ],
    memory: [
      'No paralleling of AC sources; the source connected last takes the bus.',
      'An IDG disconnected with its DISCONNECT switch **cannot be reconnected in flight**.',
    ],
  },

  parts: [
    {
      id: 'idg1', name: 'IDG 1', at: engPoint(1, 1.35, -0.78, -0.25),
      lead: 'Integrated drive generator on engine 1: a constant-speed drive and a generator in one oil-cooled case.',
      how: [
        'The drive holds the generator at a constant speed across the engine\'s normal range so the output stays at 400 Hz.',
        'An electro-mechanical disconnect can separate it completely from the engine if the drive misbehaves; it also disconnects itself on high oil temperature.',
      ],
      deck: [
        ['DRIVE (amber)', 'IDG low oil pressure — from a fault, an automatic high-temperature disconnect, or the DISCONNECT switch. Normal before engine start.'],
        ['DISCONNECT 1 (guarded)', 'Disconnects the IDG if electrical power is available and the start lever is in IDLE. **Cannot be reconnected in the air.**'],
        ['GEN 1 (OFF · ON, spring-loaded)', 'ON connects IDG 1 to transfer bus 1, dropping the previous source. OFF opens the generator breaker.'],
        ['GEN OFF BUS (blue)', 'IDG 1 is not powering transfer bus 1.'],
      ],
      related: ['idg2', 'btb', 'apugen'],
    },
    {
      id: 'idg2', name: 'IDG 2', at: engPoint(2, 1.35, -0.78, 0.25),
      lead: 'Engine 2\'s IDG — same design; normally powers transfer bus 2.',
      related: ['idg1', 'btb'],
    },
    {
      id: 'apugen', name: 'APU generator', at: [APU.x + 0.7, APU.y - 0.25, 0.2],
      lead: 'Can power both transfer buses on the ground or in flight.',
      how: [
        'With no IDG on line, one **APU GEN** switch ON puts the APU on **both** transfer buses (and drops external power); the other side\'s SOURCE OFF stays lit until its APU GEN switch goes ON too.',
        'With both IDGs on line, an APU GEN switch ON takes only its own side.',
        'If the airplane takes off with the APU powering both buses and the APU then stops or fails, the engine generators come on line automatically — once per flight.',
        'In flight with the APU as the only source, all galley and main buses are shed; on the ground the APU tries to carry the full load and sheds galleys and main buses only if it overloads.',
      ],
      deck: [['APU GEN OFF BUS (blue)', 'APU running and not powering a bus.']],
      limits: [['APU electrical load: max altitude', '41,000 ft', 'FCOM L.10']],
      related: ['xfr', 'gpu'],
    },
    {
      id: 'gpu', name: 'External power receptacle', at: [12.3, 1.3, 0.95],
      lead: 'On the lower right fuselage near the nose wheel well. Ground power reaches both transfer buses — never just one.',
      how: [
        'GRD PWR ON (momentary) removes whatever powered the transfer buses and connects external power to both, if its quality is good. You cannot have external power on one bus and the APU on the other — whichever of the two was selected last powers both.',
        'A **ground service switch** at the forward attendant panel powers only the ground service buses (cabin lights, outlets, battery charger) from external power, without waking up the rest of the airplane.',
      ],
      deck: [['GRD POWER AVAILABLE (blue)', 'External power connected and of acceptable quality.']],
      related: ['xfr', 'apugen'],
    },
    {
      id: 'xfr', name: 'Transfer buses 1 & 2', at: [E.x - 0.6, E.y + 0.35, 0],
      lead: 'The heart of AC distribution. Each feeds its main bus, galley buses and ground service bus; transfer bus 1 also feeds AC standby.',
      how: ['The **TRANSFER BUS OFF** light means a transfer bus has no power at all. **SOURCE OFF** means the crew\'s selected source for that side isn\'t connected (or none was selected) — the bus may still be powered through the BTBs.'],
      deck: [
        ['TRANSFER BUS OFF (amber)', 'That transfer bus is unpowered.'],
        ['SOURCE OFF (amber)', 'No source manually selected for that bus, or the selected one has dropped off.'],
      ],
      related: ['btb', 'tr', 'stbypwr'],
    },
    {
      id: 'btb', name: 'Bus tie breakers & BUS TRANSFER', at: [E.x - 1.2, E.y + 0.3, 0.4],
      lead: 'With BUS TRANSFER in AUTO, the BTBs let any working source pick up an unpowered transfer bus through the tie bus.',
      how: [
        'BUS TRANSFER **OFF** isolates the two sides if one IDG was powering both, opens the DC cross bus tie, and stops TR3 drawing from transfer bus 1.',
        '**Load shedding** on one engine generator: galleys and main bus on side 2 go first, then side 1, then the IFE buses — and come back automatically when a second source returns. CAB/UTIL OFF then ON retries manually.',
      ],
      deck: [['BUS TRANSFER (AUTO guarded · OFF)', 'AUTO: automatic BTB operation and a normal DC cross tie.']],
      related: ['xfr', 'tr'],
    },
    {
      id: 'tr', name: 'TR units 1, 2, 3', at: [E.x - 0.3, E.y - 0.05, -0.55],
      lead: 'Transformer-rectifiers: 115 V AC in, 28 V DC out. Any two can carry the full DC load.',
      how: [
        'TR1 ← transfer bus 1, TR2 ← transfer bus 2, TR3 ← transfer bus 2 (backup: bus 1, in AUTO).',
        'With the cross bus tie closed, TR1 and TR2 together power DC 1, DC 2 and DC standby; TR3 powers the battery bus and backs up the other two.',
      ],
      deck: [['TR UNIT (amber)', 'In flight: TR1 failed, or TR2 **and** TR3 failed. On the ground: any TR failed.'], ['ELEC (amber, ground only)', 'A fault in the DC or standby power system.']],
      related: ['bat', 'stbypwr'],
    },
    {
      id: 'bat', name: 'Battery (and auxiliary battery)', at: [E.x + 1.2, E.y - 0.1, -0.5],
      lead: '24 V nickel-cadmium in the E&E bay. Some airplanes add an **auxiliary battery** that joins the main one only when they\'re powering standby.',
      how: [
        'A fully charged battery gives at least **30 minutes** of standby power; with main + auxiliary, at least **60 minutes**.',
        'The **hot battery bus** is wired straight to the battery — no switch. The **switched hot battery bus** is live whenever the BAT switch is ON.',
        'The **battery charger** (from ground service bus 2) charges, then sits in a constant-voltage TR mode feeding the hot battery buses; it also feeds the battery bus if TR3 fails.',
      ],
      deck: [
        ['BAT (OFF · ON guarded)', 'ON powers the switched hot battery bus and arms the automatic switch of standby to battery. OFF removes power from the battery bus and switched hot battery bus (and, on battery only, from DC standby, the inverter and AC standby too).'],
        ['BAT DISCHARGE (amber)', 'With BAT ON, excessive battery discharge.'],
      ],
      limits: [['Voltage range', '22–30 V', 'FCOM 6.20'], ['Standby endurance', '30 min (1 battery) · 60 min (2)', 'FCOM 6.20']],
      related: ['inv', 'stbypwr'],
    },
    {
      id: 'inv', name: 'Static inverter', at: [E.x + 0.6, E.y - 0.05, 0.55],
      lead: 'Turns 24 V DC battery power into 115 V AC for the AC standby bus when normal power is lost.',
      related: ['bat', 'stbypwr'],
    },
    {
      id: 'stbypwr', name: 'Standby power', at: [E.x + 0.1, E.y + 0.35, 0.55],
      lead: 'AC standby and DC standby buses keep the essentials running from the battery: the captain\'s PFD and ND, the standby instruments, VHF 1, VHF NAV 1 / ILS 1, the left FMC, CDU and IRS, engine indications on the upper display, fire detection and extinguishing, manual pressurisation, and more.',
      how: [
        '**AUTO** (guarded, normal): switches to battery if transfer bus 1 or DC bus 1 is lost, in the air or on the ground — with the BAT switch ON.',
        '**BAT**: forces AC standby, DC standby and the battery bus onto the battery.',
        '**OFF**: removes power from both standby buses and lights STANDBY PWR OFF.',
        'On battery only, starting the APU is still possible, though not recommended above 25,000 ft.',
      ],
      deck: [['STANDBY PWR OFF (amber)', 'AC standby, DC standby or battery bus unpowered.']],
      related: ['bat', 'inv', 'xfr'],
    },
  ],

  build(K) {
    // IDG feeders: engine → pylon → wing LE → fuselage → forward along the belly to the E&E bay.
    for (const [n, side] of [[1, -1], [2, 1]]) {
      const p = engPoint(n, 1.35, -0.78, -side * 0.25);
      K.unit(`idg${n}`, { cyl: [engPoint(n, 1.1, -0.78, -side * 0.25), engPoint(n, 1.6, -0.78, -side * 0.25)], r: 0.22 }, { color: AC });
      K.flow(`g${n}`, [p, engPoint(n, 2.8, 0.8, 0), spar(side * ENG.z, 0.06, -0.05), spar(side * 2.1, 0.06, -0.12),
        [3.4, 1.55, side * 0.7], [8, 1.5, side * 0.6], [E.x - 0.6, E.y + 0.3, side * 0.3]], { color: AC, part: `idg${n}` });
    }
    // APU generator → forward along the right side.
    K.unit('apugen', { cyl: [[APU.x + 0.4, APU.y - 0.25, 0.2], [APU.x + 1.0, APU.y - 0.25, 0.2]], r: 0.2 }, { color: APUC });
    K.flow('apu', [[APU.x + 0.7, APU.y - 0.25, 0.2], [-14, 3.2, 0.7], [-6, 2.0, 1.1], [3, 1.6, 1.1], [8, 1.5, 0.8], [E.x - 0.6, E.y + 0.3, 0.1]],
      { color: APUC, part: 'apugen' });
    // External power.
    K.unit('gpu', { box: [12.3, 1.3, 0.95], size: [0.35, 0.25, 0.2] }, { color: GPU });
    K.flow('gpu', [[12.3, 1.3, 0.95], [11.6, 1.5, 0.5], [E.x - 0.6, E.y + 0.3, 0.05]], { color: GPU, part: 'gpu', r: 0.06 });
    // E&E bay contents.
    K.unit('xfr', { box: [E.x - 0.6, E.y + 0.35, 0], size: [0.9, 0.12, 0.9] }, { color: AC });
    K.unit('btb', { box: [E.x - 1.2, E.y + 0.3, 0.4], size: [0.3, 0.25, 0.3] }, { color: AC });
    for (const dz of [-0.75, -0.55, -0.35]) K.unit('tr', { box: [E.x - 0.3, E.y - 0.05, dz], size: [0.35, 0.3, 0.16] }, { color: DC });
    K.unit('bat', { box: [E.x + 1.2, E.y - 0.1, -0.5], size: [0.45, 0.3, 0.3] }, { color: BAT });
    K.unit('bat', { box: [E.x + 1.2, E.y - 0.1, -0.05], size: [0.4, 0.28, 0.28] }, { color: BAT });
    K.unit('inv', { box: [E.x + 0.6, E.y - 0.05, 0.55], size: [0.3, 0.25, 0.25] }, { color: STBY });
    K.unit('stbypwr', { box: [E.x + 0.1, E.y + 0.35, 0.55], size: [0.5, 0.1, 0.35] }, { color: STBY });
    // Internal ties.
    K.flow('tr', [[E.x - 0.6, E.y + 0.3, -0.2], [E.x - 0.3, E.y + 0.1, -0.55]], { color: DC, part: 'tr', r: 0.04 });
    K.flow('stby', [[E.x - 0.6, E.y + 0.3, 0.2], [E.x + 0.1, E.y + 0.35, 0.55]], { color: STBY, part: 'stbypwr', r: 0.04 });
    K.flow('batt', [[E.x + 1.2, E.y - 0.1, -0.5], [E.x + 0.6, E.y - 0.05, 0.55], [E.x + 0.1, E.y + 0.35, 0.55]], { color: BAT, part: 'bat', r: 0.04 });
    // DC to the flight deck panels and the standby instruments.
    K.flow('dc', [[E.x - 0.3, E.y + 0.1, -0.55], [13.5, 2.6, -0.8], [15.2, 3.6, -1.1]], { color: DC, part: 'tr', r: 0.04 });
    K.flow('stby', [[E.x + 0.1, E.y + 0.35, 0.55], [14, 2.8, 0.2], [16.2, 3.3, -0.4]], { color: STBY, part: 'stbypwr', r: 0.04 });
  },

  normal(phase) {
    const air = phase !== 'ground';
    return {
      sw: { bat: 1, stby: 2, busXfer: 1, gen1: 1, gen2: 1, apu1: 1, apu2: 1, grd: 1, disc1: 0, disc2: 0 },
      fail: {},
      mem: { man: air ? { 1: 'gen1', 2: 'gen2' } : { 1: 'apu', 2: 'apu' }, idgDisc: { 1: false, 2: false } },
    };
  },

  avail(env, st) {
    const f = st.fail;
    return {
      gen1: env.eng1 && !f.eng1 && !st.mem.idgDisc[1] && !f.gen1,
      gen2: env.eng2 && !f.eng2 && !st.mem.idgDisc[2] && !f.gen2,
      apu: (st.mem.apuRun ?? env.apu) && !f.apu,
      gpu: env.gpu && !env.air,
    };
  },

  /** Spring-loaded switch actions. */
  action(st, key, label, env) {
    const m = st.mem.man, av = this.avail(env, st);
    const isIdg = (s) => s === 'gen1' || s === 'gen2';
    const on = label === 'ON', off = label === 'OFF';
    if (key === 'gen1' || key === 'gen2') {
      const n = key === 'gen1' ? 1 : 2;
      if (on && av[key]) m[n] = key;
      if (off && m[n] === key) m[n] = null;
    } else if (key === 'apu1' || key === 'apu2') {
      const n = key === 'apu1' ? 1 : 2, o = 3 - n;
      if (on && av.apu) {
        const idgOn = (isIdg(m[1]) && av[m[1]]) || (isIdg(m[2]) && av[m[2]]);
        m[n] = 'apu';
        // No IDG on line: the APU takes both buses and external power drops.
        if (!idgOn && m[o] === 'gpu') m[o] = null;
      }
      if (off && m[n] === 'apu') m[n] = null;
    } else if (key === 'grd') {
      if (on && av.gpu) { m[1] = 'gpu'; m[2] = 'gpu'; }
      if (off) { if (m[1] === 'gpu') m[1] = null; if (m[2] === 'gpu') m[2] = null; }
    } else if (key === 'apuRun') {
      // APU start/stop (the APU itself lives in chapter 7).
      st.mem.apuRun = !(st.mem.apuRun ?? env.apu);
      if (!st.mem.apuRun) {
        const both = m[1] === 'apu' && m[2] === 'apu';
        if (m[1] === 'apu') m[1] = null;
        if (m[2] === 'apu') m[2] = null;
        // Took off on the APU and it stopped: engine generators come on line
        // by themselves (once per flight).
        if (both && env.air && !st.mem.autoOnlineUsed) {
          if (av.gen1) m[1] = 'gen1';
          if (av.gen2) m[2] = 'gen2';
          st.mem.autoOnlineUsed = true;
        }
      }
    } else if (key === 'disc1' || key === 'disc2') {
      const n = key === 'disc1' ? 1 : 2;
      // Needs power available and the start lever in IDLE (engine running here).
      if (env['eng' + n]) st.mem.idgDisc[n] = true;
    }
  },

  evaluate(env, st) {
    const { sw, fail: f, mem } = st;
    const av = this.avail(env, st);
    const auto = sw.busXfer === 1;
    const m = mem.man;
    const own = (n) => (m[n] && av[m[n]] ? m[n] : null);
    // APU/GPU selected on one side feed the other side too (unless an IDG holds it);
    // in AUTO the BTBs let any working source pick up a dead side.
    const s1o = own(1), s2o = own(2);
    let s1 = s1o, s2 = s2o, tie1 = false, tie2 = false;
    if (!s1 && s2o && (auto || s2o === 'apu' || s2o === 'gpu')) { s1 = s2o; tie1 = true; }
    if (!s2 && s1o && (auto || s1o === 'apu' || s1o === 'gpu')) { s2 = s1o; tie2 = true; }
    const x1 = !!s1, x2 = !!s2;
    // Load shedding.
    const single = s1 && s1 === s2;
    const shed2 = env.air && single, shed1 = env.air && single && s1 === 'apu';
    // TRs and DC.
    const tr1 = x1 && !f.tr1, tr2 = x2, tr3 = (x2 || (auto && x1)) && !f.tr3;
    const tieDC = auto;
    let dc1, dc2;
    if (tieDC) dc1 = dc2 = tr1 || tr2 || tr3; else { dc1 = tr1; dc2 = tr2 || tr3; }
    // Standby: normal from XFR 1 / DC 1, else battery (BAT ON in AUTO), forced by BAT.
    const normalStby = x1 && dc1;
    let acStby, dcStby, batBus, onBattery;
    if (sw.stby === 1) { acStby = false; dcStby = false; batBus = tr3 || (sw.bat && !normalStby); onBattery = false; }
    else if (sw.stby === 0) { acStby = dcStby = batBus = true; onBattery = true; }
    else if (normalStby) { acStby = true; dcStby = true; batBus = !!sw.bat; onBattery = false; }
    else { onBattery = !!sw.bat; acStby = dcStby = batBus = onBattery; }
    const hotBat = true, swHotBat = !!sw.bat;
    const batDis = onBattery && (sw.bat || sw.stby === 0);

    const lights = {
      xferOff1: !x1, xferOff2: !x2,
      srcOff1: !s1o, srcOff2: !s2o,
      genOffBus1: s1 !== 'gen1', genOffBus2: s2 !== 'gen2',
      apuGenOffBus: av.apu && s1 !== 'apu' && s2 !== 'apu',
      grdAvail: av.gpu,
      drive1: !env.eng1 || !!f.eng1 || mem.idgDisc[1] || !!f.drive1,
      drive2: !env.eng2 || !!f.eng2 || mem.idgDisc[2],
      stbyOff: !acStby || !dcStby || !batBus,
      batDischarge: batDis,
      trUnit: env.air ? (!tr1 || (!tr2 && !tr3)) : (!tr1 || !tr2 || !tr3),
      elec: !env.air && (!dcStby || !batBus),
    };
    const buses = {
      xfr1: x1, xfr2: x2, main1: x1 && !shed1, main2: x2 && !shed2, gal1: x1 && !shed1, gal2: x2 && !shed2,
      gs1: x1, gs2: x2, acStby, tr1, tr2, tr3, dc1, dc2, dcStby, batBus, hotBat, swHotBat,
      tie: !!(tie1 || tie2), dcTie: tieDC,
    };
    const flows = {
      g1: s1 === 'gen1' || s2 === 'gen1', g2: s1 === 'gen2' || s2 === 'gen2',
      apu: s1 === 'apu' || s2 === 'apu', gpu: s1 === 'gpu' || s2 === 'gpu',
      tr: tr1 || tr2 || tr3, dc: dc1 || dc2, stby: acStby || dcStby, batt: onBattery,
    };
    const st2 = (v) => (v ? 'on' : 'off');
    const units = {
      idg1: mem.idgDisc[1] || f.gen1 ? 'fault' : st2(flows.g1), idg2: mem.idgDisc[2] ? 'fault' : st2(flows.g2),
      apugen: st2(flows.apu), gpu: av.gpu ? st2(flows.gpu) : 'off', xfr: x1 && x2 ? 'on' : x1 || x2 ? 'fault' : 'off',
      btb: st2(buses.tie), tr: f.tr1 || f.tr3 ? 'fault' : st2(flows.tr), bat: onBattery ? 'fault' : 'on',
      inv: st2(onBattery && acStby), stbypwr: acStby && dcStby ? 'on' : 'fault',
    };
    return {
      flows, units, buses, lights,
      values: {
        src1: s1 ? SRC_NAME[s1] + (tie1 ? ' via BTB' : '') : 'UNPOWERED',
        src2: s2 ? SRC_NAME[s2] + (tie2 ? ' via BTB' : '') : 'UNPOWERED',
        shed: shed1 ? 'ALL GALLEY + MAIN BUSES SHED' : shed2 ? 'GALLEY + MAIN BUS 2 SHED' : '',
        batV: onBattery ? 24 : 28,
        gen1Hz: av.gen1 ? 400 : 0, gen2Hz: av.gen2 ? 400 : 0, apuHz: av.apu ? 400 : 0,
        onBattery,
      },
      note: [
        onBattery && 'Standby buses on battery',
        (tie1 || tie2) && 'BTBs closed: one source powering both sides',
        shed1 ? 'Load shed: all galley and main buses' : shed2 ? 'Load shed: galley + main bus 2' : '',
      ].filter(Boolean).join(' · '),
    };
  },
};
