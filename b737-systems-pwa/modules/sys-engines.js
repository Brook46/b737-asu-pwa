// sys-engines.js — FCOM chapter 7: CFM56-7 engines and the APU, in our own
// words. Includes a simple start model (time compressed) so you can do an
// engine start from the panel: GRD → N2 rises on the starter → start lever
// IDLE at ~25 % → light-off, EGT rises → starter cutout ~56 % → stabilised
// idle. Engines and the APU running here are what the other systems see
// (app.js env() reads them), so a started engine drives its hydraulic pump,
// generator and bleed like the real one.

import { ENG, engPoint, wingLE, wingChord, wingY, APU, YC } from './airframe.js?v=28';

const C = '#e63946', AIR = '#ff6a3d', FUELC = '#d6336c', IGN = '#f5a300', APUC = '#e8590c';
const spar = (z, u, dy = 0) => [wingLE(z) - u * wingChord(z), wingY(z) + dy, z];

// Typical running numbers per phase (illustrative).
const RUN = {
  ground: { n1: 20.6, n2: 59.8, egt: 420, ff: 0.27 },
  takeoff: { n1: 95.4, n2: 98.2, egt: 878, ff: 3.18 },
  cruise: { n1: 87.6, n2: 93.1, egt: 742, ff: 1.24 },
  approach: { n1: 58.0, n2: 80.5, egt: 560, ff: 0.62 },
  landing: { n1: 76.0, n2: 86.0, egt: 655, ff: 0.95 },
};
const IDLE_N2 = 59.5, CUTOUT_N2 = 56, LEVER_N2 = 25;
const SIM = 3;                       // starts run 3× real time

export const engState = (run, phase) => (run
  ? { run: true, n2: RUN[phase].n2, n1: RUN[phase].n1, egt: RUN[phase].egt, ff: RUN[phase].ff, lit: true }
  : { run: false, n2: 0, n1: 0, egt: 22, ff: 0, lit: false });

export default {
  id: 'engines', num: 7, title: 'Engines, APU', fcom: 'FCOM 7', color: C,
  anchor: [ENG.x - 1.5, ENG.y + 1.1, ENG.z],
  view: { target: [-2, 2.2, 0], dist: 40, dir: [0.7, 0.55, 0.75] },

  overview: {
    lead: 'Two **CFM56-7** dual-rotor turbofans, each run by a dual-channel **EEC**, and an **APU** in the tail that gives bleed air and electrical power on the ground and in flight.',
    how: [
      'The **N1** rotor is the fan, low-pressure compressor and low-pressure turbine; the **N2** rotor is the high-pressure compressor and turbine. They are mechanically independent, and N2 drives the gearboxes (IDG, hydraulic pump, fuel and oil pumps).',
      'The **EEC** sets thrust from the thrust lever position: in **normal** mode it computes N1 ratings from sensed conditions; if it loses the signals it needs it drops to **soft alternate** (holding the last good data), and to **hard alternate** at idle or when ALTN is selected. It protects N1 and N2 redlines in every mode — but **not EGT**, which the crew must watch.',
      'Starting uses bleed air (APU, ground cart or the other engine) to drive an air starter on the N2 rotor. The EEC handles fuel and ignition once the start lever goes to IDLE, and on the ground it watches for hot starts, stalls, start-limit exceedances and wet starts.',
      'The EEC picks the idle: ground minimum, flight minimum, or **approach idle** (higher, for a quicker go-around spool-up) — with engine anti-ice on, or below 19,000 ft with the gear down or the flaps in landing configuration.',
      'Primary indications (N1, EGT) are on the upper DU; secondary (N2, fuel flow, oil pressure, temperature and quantity, vibration) on the lower DU, shown automatically when an engine is shut down in flight or a secondary parameter is exceeded.',
    ],
    limits: [
      ['Engine ignition must be on for', 'takeoff, landing, heavy rain, anti-ice operation', 'FCOM L.10'],
      ['Reverse thrust', 'Ground only — intentional selection in flight is prohibited', 'FCOM L.10'],
      ['Engine limit display markings', 'Max / min red · caution amber', 'FCOM L.10'],
      ['APU bleed + electrical, in flight: max altitude', '10,000 ft', 'FCOM L.10'],
      ['APU bleed: max altitude', '17,000 ft', 'FCOM L.10'],
      ['APU electrical load: max altitude', '41,000 ft', 'FCOM L.10'],
      ['APU: after three aborted starts', '15 min cooling', 'FCOM L.10'],
    ],
    memory: [
      'Reverse thrust: ground use only.',
      'The EEC does not protect the EGT redline — the crew does.',
    ],
  },

  parts: [
    {
      id: 'core', name: 'CFM56-7 engine', at: engPoint(1, 1.6, 0.2, 0),
      lead: 'A dual-rotor, axial-flow turbofan. N1 is the fan and low-pressure spool; N2 the high-pressure spool, which also drives the gearbox.',
      how: ['The accessory gearbox on N2 drives the IDG, the engine-driven hydraulic pump, and the fuel and oil pumps — which is why an engine failure touches hydraulics, electrics and bleed at once.'],
      deck: [['N1 / EGT (upper DU)', 'Primary indications: dial and digits; red lines are limits, EGT also has an amber caution band.'], ['N2, FF, OIL, VIB (lower DU)', 'Secondary indications.']],
      related: ['eec', 'start', 'oil'],
    },
    {
      id: 'eec', name: 'Electronic engine control (EEC)', at: engPoint(1, 1.2, -0.5, -0.6),
      lead: 'Full-authority digital control with two independent channels; it alternates channels on each start and switches channel by itself if one fails.',
      how: [
        '**Normal mode:** N1 ratings from sensed flight conditions and bleed demand; the EEC trims fuel until actual N1 matches commanded N1. Full rated takeoff thrust comes before the forward stop.',
        '**Soft alternate:** automatic when required signals are lost — uses the last valid conditions so thrust doesn\'t jump. ALTN lights, ON still visible.',
        '**Hard alternate:** entered by pulling the thrust lever to idle while in soft alternate, or selecting ALTN. Thrust is equal to or higher than normal for the same lever position, and there is no thrust limiting — full forward lever can overboost, so only in an emergency.',
        'Losing either DEU drops both EECs to alternate together, so the engines never run on a single data source.',
        'If the EEC is unpowered, N1, N2, oil quantity and vibration still come straight from the engine sensors; ENGINE START to GRD powers the EEC and brings all the parameters back.',
      ],
      deck: [['EEC switches (ON · ALTN)', 'ON in view: normal mode selected. ALTN lit: alternate mode (automatic or selected).'], ['ENGINE CONTROL (amber)', 'Engine control not dispatchable — on the ground, shown until about 30 s after touchdown.']],
      related: ['core', 'start'],
    },
    {
      id: 'start', name: 'Starter and start valve', at: engPoint(1, 1.45, -0.65, 0.5),
      lead: 'An air starter on the N2 gearbox, fed from the bleed duct through the start valve.',
      how: [
        'ENGINE START to **GRD**: the start valve opens, the engine bleed valve closes, and the starter turns N2. START VALVE OPEN shows on the upper DU.',
        'At about **25 % N2** (or max motoring) the start lever goes to **IDLE**: the spar and engine fuel valves open and the EEC supplies fuel and ignition. Fuel flow indication lags about two seconds, so EGT can rise before fuel flow shows.',
        'At about **56 % N2** the starter cuts out: the switch springs back to AUTO, the start valve closes and the bleed valve returns to its selected position. Stabilised idle is about 59 % N2.',
        'Ground start protection (not in flight): an impending hot start or stall flashes the EGT box and the EEC cuts fuel and ignition; exceeding the start limit turns EGT red and cuts fuel; a **wet start** (no EGT rise) is shut down 15 s after IDLE.',
      ],
      deck: [['ENGINE START (GRD · AUTO · CONT · FLT)', 'GRD opens the start valve; AUTO normal; CONT continuous ignition with the engine running; FLT both igniters whenever the start lever is in IDLE.'], ['START VALVE OPEN (amber, upper DU)', 'Start valve open — steady during a start; blinking if it opened uncommanded.']],
      limits: [['Start lever to IDLE at', '≈ 25 % N2 or max motoring', 'FCOM 7.20'], ['Starter cutout', '≈ 56 % N2', 'FCOM 7.20'], ['Stabilised idle', '≈ 59 % N2', 'FCOM 7.11']],
      related: ['ign', 'eec', 'apu'],
    },
    {
      id: 'ign', name: 'Ignition', at: engPoint(1, 2.0, -0.3, 0.75),
      lead: 'Two igniter plugs per engine. The left is powered from its AC transfer bus, the right from the **AC standby bus**.',
      how: [
        '**AUTO:** ignition normally off, but both igniters fire if N2 drops rapidly, or (start lever IDLE) N2 is between 57 % and 50 %, or in flight between idle and 5 %. The selected igniters also fire with flaps out below 18,000 ft or engine anti-ice on.',
        '**Auto-relight:** whenever the EEC detects a flameout (rapid N2 decay or N2 below idle), both igniters fire.',
        'In-flight starts are windmill or crossbleed; X-BLD on the N2 dial means crossbleed is recommended.',
      ],
      deck: [['Ignition select (IGN L · BOTH · IGN R)', 'Which igniter(s) the EEC uses on both engines.']],
      limits: [['Ignition ON for', 'takeoff, landing, heavy rain, anti-ice', 'FCOM L.10']],
      related: ['start', 'eec'],
    },
    {
      id: 'fuelsys', name: 'Engine fuel system', at: engPoint(1, 1.8, -0.6, -0.4),
      lead: 'After the spar valve: a first-stage pump, two fuel/oil heat exchangers (IDG oil and engine oil warm the fuel), a filter, a second-stage pump, and the hydro-mechanical unit the EEC commands.',
      how: ['The filter bypasses itself if it clogs — FILTER BYPASS on the fuel panel warns first. Fuel flow is measured after the engine fuel valve and sent to the display and the FMS.'],
      deck: [['FUEL FLOW (RATE · USED · RESET)', 'Shows flow, or fuel used since the last reset (reverts to flow after 10 s).']],
      related: ['core', 'oil'],
    },
    {
      id: 'oil', name: 'Oil system', at: engPoint(1, 1.9, -0.55, 0.2),
      lead: 'Each engine has its own tank; an engine-driven pump feeds the bearings and gearbox, scavenge pumps return it through a filter and a fuel-cooled oil cooler.',
      how: ['Quantity can fall during start, takeoff and climb and come back in level flight — normal. With very low windmilling N2 the scavenge pump may not return oil, so quantity can read near zero.'],
      deck: [['LOW OIL PRESSURE (amber, DU)', 'Oil pressure at or below the red line.'], ['OIL FILTER BYPASS (amber, DU)', 'Scavenge filter about to bypass.']],
      related: ['core', 'fuelsys'],
    },
    {
      id: 'rev', name: 'Thrust reverser', at: engPoint(2, 2.6, 0.95, 0),
      lead: 'Two translating sleeves per engine: moving aft, blocker doors turn fan air forward through cascade vanes. Hydraulic — A for No. 1, B for No. 2, standby as backup (slower).',
      how: [
        'Deploys only below 10 ft radio altitude or with the air/ground sensor in ground mode, and only with the forward thrust lever at idle. Amber **REV** while the sleeves move, green when deployed; then the lever can go to detent 2 (normal) or beyond for maximum.',
        'Stowing: lever down past detent 1, sleeves stow and lock, the isolation valve closes. An **auto-restow** circuit drives the sleeves back if they move uncommanded.',
      ],
      deck: [['REVERSER (amber, aft overhead)', 'Lit while stowing, out ~10 s later; on more than ~12 s means a fault (MASTER CAUTION + ENG).']],
      limits: [['Reverse thrust', 'Ground only', 'FCOM L.10']],
      related: ['core'],
    },
    {
      id: 'apu', name: 'APU', at: [APU.x + 1.0, APU.y - 0.1, 0],
      lead: 'A gas turbine in a fireproof tail compartment. Bleed for engine start and two packs on the ground (one in flight); an AC generator for both transfer buses — up to the airplane\'s ceiling.',
      how: [
        '**Start:** APU switch to START and release to ON — the inlet door opens, then the starter-generator turns it (AC from transfer bus 1, or the battery). Ignition and fuel follow; the start can take up to 120 s. APU GEN OFF BUS lights when it is ready for load.',
        '**Shutdown:** OFF trips the generator and closes the bleed valve at once; the APU runs another 60 s to cool, then the fuel valve and inlet door close. The fire switch shuts it down immediately. The BAT switch OFF also shuts it down (the control unit loses power).',
        'Fuel comes from the left manifold (AC pumps on), or by suction from main tank 1 with the DC boost pump helping.',
        'Run it two minutes before using the bleed; at least 30 s between failed starts; three tries then 15 minutes to cool.',
      ],
      deck: [
        ['APU switch (OFF · ON · START)', 'START momentary begins the automatic start; OFF begins the 60 s cooldown.'],
        ['LOW OIL PRESSURE · FAULT · OVERSPEED (amber), MAINT (blue)', 'Auto-shutdown causes, or a maintenance problem. Low oil pressure is normal during the start.'],
        ['APU EGT', 'Stays powered 5 min after shutdown. Not necessary to monitor during start.'],
      ],
      limits: [['Use as bleed source after', '2 min running', 'FCOM L.10'], ['After 3 aborted starts', '15 min cooling', 'FCOM L.10'], ['Between failed starts', '≥ 30 s', 'FCOM 7.30']],
      related: ['apuinlet', 'start'],
    },
    {
      id: 'apuinlet', name: 'APU inlet door', at: [APU.x + 2.6, YC + 0.9, 0.55],
      lead: 'An automatic door on the right side of the tail feeds the APU; it opens first on a start and closes after shutdown. Cooling air enters above the exhaust.',
      related: ['apu'],
    },
  ],

  build(K) {
    for (const [n, side] of [[1, -1], [2, 1]]) {
      K.unit('core', { cyl: [engPoint(n, 1.0, 0, 0), engPoint(n, 3.6, 0, 0)], r: 0.42, r2: 0.34 }, { color: C, glass: true });
      K.unit('eec', { box: engPoint(n, 1.2, -0.5, -side * 0.6), size: [0.4, 0.14, 0.26] }, { color: '#adb5bd' });
      K.unit('start', { cyl: [engPoint(n, 1.35, -0.65, side * 0.45), engPoint(n, 1.65, -0.65, side * 0.45)], r: 0.13 }, { color: AIR });
      K.unit('oil', { cyl: [engPoint(n, 1.75, -0.55, side * 0.2), engPoint(n, 2.15, -0.55, side * 0.2)], r: 0.12 }, { color: '#fab005' });
      K.unit('fuelsys', { box: engPoint(n, 1.8, -0.6, -side * 0.4), size: [0.32, 0.12, 0.16] }, { color: FUELC });
      K.unit('ign', { sphere: engPoint(n, 2.0, -0.3, side * 0.75), r: 0.07 }, { color: IGN });
      K.unit('rev', { cyl: [engPoint(n, 2.2, 0, 0), engPoint(n, 3.2, 0, 0)], r: 0.98, r2: 0.9 }, { color: '#868e96', glass: true });
      // Starter air from the bleed duct down the pylon.
      K.flow(`air${n}`, [spar(side * 2.4, 0.07, -0.05), spar(side * ENG.z, 0.06, 0), engPoint(n, 2.6, 1.0, 0),
        engPoint(n, 1.5, -0.65, side * 0.45)], { color: AIR, part: 'start', r: 0.07 });
      // Fuel in from the spar valve.
      K.flow(`fuel${n}`, [spar(side * ENG.z, 0.05, -0.15), engPoint(n, 1.4, 0.95, 0), engPoint(n, 1.8, -0.6, -side * 0.4)],
        { color: FUELC, part: 'fuelsys', r: 0.05 });
      // Ignition leads.
      K.flow(`ign${n}`, [engPoint(n, 1.2, -0.5, -side * 0.6), engPoint(n, 1.6, -0.6, 0), engPoint(n, 2.0, -0.3, side * 0.75)],
        { color: IGN, part: 'ign', r: 0.03 });
      // Hot core flow when running.
      K.flow(`core${n}`, [engPoint(n, 0.9, 0, 0), engPoint(n, 3.6, 0, 0), engPoint(n, 5.6, 0, 0)], { color: '#ff922b', part: 'core', r: 0.16 });
    }
    // APU, its fuel and inlet.
    K.unit('apu', { box: [APU.x + 1.0, APU.y - 0.1, 0], size: [1.2, 0.55, 0.6] }, { color: APUC });
    K.unit('apuinlet', { box: [APU.x + 2.6, YC + 0.9, 0.55], size: [0.5, 0.06, 0.3] }, { color: '#adb5bd' });
    K.flow('apuAir', [[APU.x + 2.6, YC + 0.9, 0.55], [APU.x + 1.6, APU.y + 0.1, 0.2]], { color: '#74c0fc', part: 'apuinlet', r: 0.08 });
    K.flow('apuExh', [[APU.x + 0.4, APU.y - 0.1, 0], [APU.x - 0.9, APU.y - 0.12, 0]], { color: '#ff922b', part: 'apu', r: 0.1 });
  },

  normal(phase) {
    const run = phase !== 'ground';
    return {
      sw: { start1: 1, start2: 1, ign: 1, lever1: run ? 1 : 0, lever2: run ? 1 : 0, eec1: 1, eec2: 1, apu: run ? 0 : 1 },
      fail: {},
      mem: {
        e: [engState(run, phase), engState(run, phase)],
        apu: run ? { st: 'off', rpm: 0, egt: 20, t: 0 } : { st: 'running', rpm: 100, egt: 400, t: 999 },
        phase,
      },
    };
  },

  action(st, key, label) {
    const a = st.mem.apu;
    if (key === 'apu' && label === 'START') {
      if (a.st === 'off' || a.st === 'cooling') { a.st = 'starting'; a.t = 0; }
    }
  },

  /** Advance starts, spool-downs and the APU (time compressed). */
  tick(dt, st, env) {
    const { sw, mem, fail: f } = st;
    const k = dt * SIM;
    let changed = false;
    const apuRun = mem.apu.st === 'running';
    // APU.
    const a = mem.apu;
    if (env.cutApu && a.st !== 'off') { a.st = 'off'; a.rpm = 0; changed = true; }      // APU fire switch: immediate shutdown
    if (sw.apu === 0 && (a.st === 'running' || a.st === 'starting')) { a.st = 'cooling'; a.t = 0; changed = true; }
    if (a.st === 'starting') {
      a.t += k;
      a.rpm = Math.min(100, a.t * 6);
      a.egt = a.t < 6 ? 20 + a.t * 20 : Math.min(640, 140 + (a.t - 6) * 60);
      if (f.apuFault && a.t > 12) { a.st = 'off'; a.rpm = 0; mem.apuFaulted = true; }
      else if (a.rpm >= 100 && a.t > 18) { a.st = 'running'; a.egt = 420; }
      changed = true;
    } else if (a.st === 'cooling') {
      a.t += k;
      a.rpm = a.t < 60 ? 100 : Math.max(0, 100 - (a.t - 60) * 8);
      a.egt = Math.max(20, a.egt - k * 4);
      if (a.t > 72) { a.st = 'off'; a.rpm = 0; }
      changed = true;
    } else if (a.st === 'running' && sw.apu === 1) mem.apuFaulted = false;
    // Engines.
    for (let i = 0; i < 2; i++) {
      const e = mem.e[i];
      const n = i + 1;
      // A pulled fire switch closes both fuel valves, like the start lever at CUTOFF.
      const startSw = sw[`start${n}`], lever = env[`cut${n}`] ? 0 : sw[`lever${n}`];
      const otherRun = mem.e[1 - i].run;
      const air = apuRun || otherRun || env.gpu;      // APU, other engine, or a ground cart
      const startValve = startSw === 0;
      const before = JSON.stringify(e);
      if (f[`flameout${n}`] && e.run) { e.run = false; e.lit = false; }
      if (!e.run) {
        // Motoring on the starter.
        const motor = startValve && air ? 30 : 0;
        if (lever === 1 && e.n2 >= LEVER_N2 * 0.8 && !e.lit && !f[`flameout${n}`]) e.lit = true;       // light-off
        if (lever === 0) e.lit = false;
        const target = e.lit ? IDLE_N2 + 0.5 : motor;
        const rate = e.lit ? 2.2 : motor ? 3.0 : 4.0;
        e.n2 += Math.sign(target - e.n2) * Math.min(Math.abs(target - e.n2), rate * k);
        e.n1 = e.lit ? Math.max(0, (e.n2 - 25) * 0.6) : e.n2 * 0.18;
        e.egt += ((e.lit ? Math.min(725, 200 + e.n2 * 7) : 22) - e.egt) * Math.min(1, 0.6 * k);
        e.ff = e.lit ? 0.3 : 0;
        if (e.lit && e.n2 >= CUTOUT_N2 && startSw === 0) sw[`start${n}`] = 1;   // starter cutout: switch back to AUTO
        if (e.lit && e.n2 >= IDLE_N2) { e.run = true; e.n2 = IDLE_N2; }
      } else {
        // Running: shut down with the start lever, else hold the phase's numbers.
        if (lever === 0) { e.run = false; e.lit = false; }
        else {
          const r = env.air || env.phase !== 'ground' ? RUN[env.phase] : RUN.ground;
          e.n2 += (r.n2 - e.n2) * Math.min(1, 0.8 * k); e.n1 += (r.n1 - e.n1) * Math.min(1, 0.8 * k);
          e.egt += (r.egt - e.egt) * Math.min(1, 0.8 * k); e.ff = r.ff;
        }
      }
      if (JSON.stringify(e) !== before) changed = true;
    }
    return changed;
  },

  evaluate(env, st) {
    const { sw, mem, fail: f } = st;
    const a = mem.apu;
    const E = mem.e.map((e, i) => {
      const n = i + 1;
      return {
        ...e,
        startValve: sw[`start${n}`] === 0,
        lowOil: e.n2 < 50,
        engFail: sw[`lever${n}`] === 1 && e.n2 < 50 && (e.wasRun || !!f[`flameout${n}`]),
        ignOn: sw[`lever${n}`] === 1 && (sw[`start${n}`] === 0 ? e.n2 > 15 : sw[`start${n}`] >= 2 || (!e.run && e.lit) || !!f[`flameout${n}`]),
        oilP: e.run ? 34 + e.n2 * 0.2 : Math.max(0, e.n2 * 0.4),
      };
    });
    mem.e.forEach((e) => { if (e.run) e.wasRun = true; });
    const apuOn = a.st === 'running';
    return {
      flows: {
        air1: E[0].startValve, air2: E[1].startValve, fuel1: E[0].lit || E[0].run, fuel2: E[1].lit || E[1].run,
        ign1: E[0].ignOn, ign2: E[1].ignOn, core1: E[0].lit || E[0].run, core2: E[1].lit || E[1].run,
        apuAir: a.st !== 'off', apuExh: apuOn || a.st === 'starting' || (a.st === 'cooling' && a.rpm > 0),
      },
      units: {
        core: E[0].run && E[1].run ? 'on' : E[0].run || E[1].run ? 'fault' : 'off',
        eec: 'on', start: E[0].startValve || E[1].startValve ? 'on' : 'off', ign: E[0].ignOn || E[1].ignOn ? 'on' : 'off',
        oil: E[0].lowOil || E[1].lowOil ? 'fault' : 'on', fuelsys: E[0].run || E[1].run ? 'on' : 'off', rev: env.phase === 'landing' ? 'on' : 'off',
        apu: mem.apuFaulted ? 'fault' : apuOn ? 'on' : a.st === 'off' ? 'off' : 'fault', apuinlet: a.st === 'off' ? 'off' : 'on',
      },
      lights: {
        apuLowOil: a.st === 'starting' && a.rpm < 60, apuFault: !!mem.apuFaulted, apuOverspeed: false, apuMaint: false,
        eecAltn1: !sw.eec1, eecAltn2: !sw.eec2, eecOn1: !!sw.eec1, eecOn2: !!sw.eec2,
        startValve1: E[0].startValve, startValve2: E[1].startValve, lowOil1: E[0].lowOil, lowOil2: E[1].lowOil,
        engFail1: E[0].engFail, engFail2: E[1].engFail, reverser: false, engControl: false,
      },
      values: {
        e: E, apuEgt: Math.round(a.egt), apuRpm: Math.round(a.rpm), apuState: a.st,
        rev: env.phase === 'landing',
      },
      note: [
        E.some((e) => e.startValve) && 'Start valve open',
        E.some((e) => !e.run && e.lit) && 'Engine accelerating to idle',
        E.some((e) => e.engFail) && 'ENG FAIL',
        a.st === 'starting' && 'APU starting',
        a.st === 'cooling' && 'APU cooling down (60 s)',
      ].filter(Boolean).join(' · '),
    };
  },
};
