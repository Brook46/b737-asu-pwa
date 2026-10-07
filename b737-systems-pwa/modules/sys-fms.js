// sys-fms.js — FCOM chapter 11, flight management and navigation, in our
// own words: IRS alignment and modes, GPS / radio / inertial position, the
// transfer switches, nav radios and the FMC. Alignment runs fast (one
// "minute" every 2 s) so it can be watched.

import { EE, YC, FLIGHT_DECK_X, NOSE_X } from './airframe.js?v=28';

const C = '#06d6a0', IRS = '#20c997', RAD = '#74c0fc';
export const IRS_POS = ['OFF', 'ALIGN', 'NAV', 'ATT'];
const SIM_MIN = 2;          // seconds per alignment minute

export default {
  id: 'fms', num: 11, title: 'FMS, Navigation', fcom: 'FCOM 11', color: C,
  anchor: [EE.x0 + 1.4, YC + 0.6, 1.4],
  view: { target: [10, 2.6, 0], dist: 28, dir: [0.75, 0.6, 0.85] },
  needsOthers: true,

  overview: {
    lead: 'Two **IRSs** (inside the ADIRUs) give attitude, heading and inertial position; two **GPS** receivers and the **radios** (DME, VOR, ILS/GLS, ADF) refine the position; the **FMC** blends them, holds the route and performance, and steers LNAV / VNAV through the autopilot and autothrottle.',
    how: [
      '**FMC position:** GPS first; radio (DME/DME, VOR/DME) also when available; IRS alone if both are lost. The pilot sees the sources on NAV STATUS and POS REF.',
      'The IRSs are the airplane\'s only attitude and heading source apart from the standby instruments, so their alignment on the ground is a real limitation: the airplane must not move.',
      '**Transfer switches** on the forward overhead (BOTH ON L / NORMAL / BOTH ON R or 1 / 2) put one IRS, one nav receiver or one FMC on both sides if the other fails. With the autopilot engaged the VHF NAV source must match the A/P in use (CMD A ↔ NAV 1, CMD B ↔ NAV 2).',
    ],
    limits: [
      ['IRS alignment time', '5 to 17 min depending on latitude', 'FCOM 11.20'],
      ['Normal alignment latitude', 'up to 78°15′ N/S', 'FCOM 11.20'],
      ['Fast realignment', '~30 s, parked, position updated', 'FCOM 11.20'],
      ['ATT mode releveling', '~30 s straight, level, unaccelerated', 'FCOM 11.20'],
      ['ATT mode heading drift', 'up to 15° per hour', 'FCOM 11.20'],
      ['Right IRS on DC (AC lost)', 'cut after 5 min', 'FCOM 11.20'],
    ],
    memory: ['IRS lost in flight: NAV is gone for the rest of the flight — select ATT, fly straight and level ~30 s, enter magnetic heading and keep cross-checking it.'],
  },

  parts: [
    {
      id: 'irs', name: 'Inertial reference systems', at: [EE.x0 + 1.0, EE.y + 0.1, 0.3],
      lead: 'Two independent IRSs, each with three laser gyros and three accelerometers, independent of anything outside the airplane.',
      how: [
        '**Alignment:** OFF → NAV. ON DC lights briefly (power test), then ALIGN: enter present position (normally on the CDU POS INIT page). 5–17 min depending on latitude; ALIGN goes out and NAV is available.',
        'ALIGN **flashing**: the position doesn\'t match the last stored one or the computed latitude, or none was entered. Re-enter the same position to accept it; two failed latitude checks → FAULT.',
        'Moving the airplane during alignment restarts it. Turning the IRS OFF means a full alignment before the airplane can move. VERIFY POSITION: the entry is more than 4 nm from the origin airport.',
        '**ATT:** attitude only (after ~30 s level flight) and heading only once you enter it; no position or ground speed. Cycle to OFF before reselecting ALIGN or NAV.',
        '**Power:** left IRS on AC standby, right on AC transfer bus 2; both fall back to the switched hot battery bus (ON DC; on the ground the nose-wheel-well horn sounds). The right IRS loses DC after 5 min.',
      ],
      deck: [['IRS mode selector (OFF · ALIGN · NAV · ATT)', 'NAV after alignment; ALIGN from NAV = fast realignment.'], ['ALIGN (white)', 'Steady: aligning / ATT levelling / shutting down. Flashing: check position.'], ['ON DC (amber)', 'IRS on battery power.'], ['DC FAIL (amber)', 'IRS DC power not normal.'], ['FAULT (amber)', 'IRS fault affecting ATT and/or NAV.'], ['IRS transfer (BOTH ON L · NORMAL · BOTH ON R)', 'Attitude and heading source for the flight instruments.']],
      limits: [['Alignment time', '5–17 min', 'FCOM 11.20'], ['ATT heading drift', 'up to 15°/h', 'FCOM 11.20']],
      related: ['gps', 'fmc'],
    },
    {
      id: 'gps', name: 'GPS', at: [FLIGHT_DECK_X - 4.5, YC + 1.98, 0],
      lead: 'Two GPS receivers (in the multi-mode receivers) give the FMC its primary position update; nothing for the crew to operate.',
      how: ['GPS (amber): both receivers failed — or one, on a recall. EFIS POS shows both GPS positions on the ND (one symbol when they agree). GPS can be deselected on NAV OPTIONS.'],
      deck: [['GPS (amber)', 'Both GPS units failed (one on recall).']],
      related: ['fmc', 'radios'],
    },
    {
      id: 'radios', name: 'Nav radios (VOR, ILS, DME, ADF)', at: [-17.5, 11.5, 0],
      lead: 'Two VHF NAV / multi-mode receivers (VOR, ILS, GLS), two DMEs, one or two ADFs and the marker beacon. Antennas on the fin (VOR/LOC), in the nose (glideslope) and on the belly and top.',
      how: [
        'You tune the VHF NAV control panels (standby window, TFR swaps). The FMC auto-tunes the DMEs for position updating; to see DME on the displays, tune it yourself with the EFIS VOR/ADF switch on VOR.',
        'VHF NAV transfer (BOTH ON 1 · NORMAL · BOTH ON 2) changes which receiver feeds each pilot\'s displays — DME, ILS/GLS, VOR and MCP course.',
        'Markers: OM cyan, MM amber, IM white.',
      ],
      deck: [['VHF NAV control (ACTIVE · STBY · TFR)', 'Tune the standby, TFR to swap.'], ['VHF NAV transfer (BOTH ON 1 · NORMAL · BOTH ON 2)', 'Receiver for each side\'s displays.'], ['ILS (amber)', 'Both ILS receivers failed (one on recall).']],
      related: ['fmc'],
    },
    {
      id: 'fmc', name: 'Flight management computer & CDUs', at: [EE.x0 + 2.0, EE.y + 0.15, -0.2],
      lead: 'Holds the navigation and performance databases, the route, the vertical profile and thrust limits; you talk to it through two CDUs on the forward pedestal.',
      how: [
        'Its position is the best of GPS, radio and IRS; LNAV and VNAV steer from it, the autothrottle gets N1 limits and target speeds.',
        'FMC source select (BOTH ON L · NORMAL · BOTH ON R) where two FMCs are fitted; moving it can disconnect LNAV / VNAV. The FMC alert light (amber) shows an alerting message on both CDUs — e.g. INSUFFICIENT FUEL.',
      ],
      deck: [['FMC source select', 'Which FMC drives both CDUs and maps.'], ['FMC alert light (amber)', 'Alerting message on the CDUs.']],
      related: ['irs', 'gps'],
    },
    {
      id: 'wxr', name: 'Weather radar', at: [NOSE_X - 0.6, YC + 0.1, 0],
      lead: 'In the nose radome; shows precipitation on the ND (WXR on the EFIS control panel) and warns of windshear ahead (see Warning Systems).',
      limits: [['Weather radar', 'Not in a hangar or with people near the radome', 'FCOM L.10']],
      related: ['radios'],
    },
  ],

  build(K) {
    for (const s of [-1, 1]) K.unit('irs', { box: [EE.x0 + 1.0, EE.y + 0.1, s * 0.3], size: [0.4, 0.3, 0.3] }, { color: IRS });
    K.unit('fmc', { box: [EE.x0 + 2.0, EE.y + 0.15, -0.2], size: [0.35, 0.28, 0.25] }, { color: C });
    K.unit('gps', { box: [FLIGHT_DECK_X - 4.5, YC + 1.98, 0], size: [0.25, 0.04, 0.2] }, { color: C });
    K.unit('gps', { box: [FLIGHT_DECK_X - 5.5, YC + 1.98, 0], size: [0.25, 0.04, 0.2] }, { color: C });
    K.unit('radios', { box: [-17.5, 11.5, 0], size: [0.6, 0.15, 0.1] }, { color: RAD });
    K.unit('radios', { box: [8, YC - 1.98, 0], size: [0.2, 0.05, 0.15] }, { color: RAD });
    K.unit('wxr', { sphere: [NOSE_X - 0.6, YC + 0.1, 0], r: 0.4 }, { color: RAD, glass: true });
    K.flow('gpsF', [[FLIGHT_DECK_X - 4.5, YC + 1.9, 0], [EE.x0 + 3, YC + 0.2, -0.1], [EE.x0 + 2.0, EE.y + 0.3, -0.2]], { color: C, part: 'gps', r: 0.025 });
    K.flow('radF', [[-17.5, 11.3, 0], [-16, 5, 0], [0, YC + 1.5, 0], [EE.x0 + 2.0, EE.y + 0.3, -0.2]], { color: RAD, part: 'radios', r: 0.025 });
    K.flow('irsF', [[EE.x0 + 1.0, EE.y + 0.25, 0.3], [EE.x0 + 2.0, EE.y + 0.3, -0.2]], { color: IRS, part: 'irs', r: 0.03 });
  },

  normal() {
    return {
      sw: { irsL: 2, irsR: 2, irsX: 1, vhfX: 1, fmcX: 1, nav1: 0, nav2: 0 },
      fail: {},
      mem: { L: { left: 0, pos: true, flash: false }, R: { left: 0, pos: true, flash: false } },
    };
  },

  tick(dt, st, env) {
    let ch = false;
    for (const s of ['L', 'R']) {
      const m = st.mem[s], mode = st.sw[`irs${s}`];
      if (mode === 0) { if (m.left !== null) { m.left = null; m.pos = false; ch = true; } continue; }
      if (m.left === null) { m.left = mode === 3 ? 1 : 10; m.t = 0; m.flash = false; ch = true; }
      if (m.left > 0 && (!env.air || mode === 3)) {
        m.t = (m.t || 0) + dt;
        if (m.t >= SIM_MIN) { m.t = 0; m.left -= 1; ch = true; }
        if (m.left === 0 && mode === 2 && !m.pos) { m.left = 1; m.flash = true; }
      }
    }
    return ch;
  },

  action(st, key) {
    if (key === 'enterPos') for (const s of ['L', 'R']) { st.mem[s].pos = true; st.mem[s].flash = false; }
    if (key === 'coldStart') { st.sw.irsL = 0; st.sw.irsR = 0; for (const s of ['L', 'R']) Object.assign(st.mem[s], { left: null, pos: false }); }
    if (key === 'fastAlign') for (const s of ['L', 'R']) if (st.mem[s].left === 0) st.mem[s].left = 1;
  },

  evaluate(env, st) {
    const { sw, fail: f, mem } = st;
    const elec = env.resOf?.('electrical');
    const acLost = !!f.acLost || env.acPower === false;
    const irs = {};
    for (const s of ['L', 'R']) {
      const m = mem[s], mode = sw[`irs${s}`];
      const failed = !!f[`irs${s}`];
      const aligned = mode !== 0 && m.left === 0 && !failed;
      irs[s] = {
        mode, failed, aligned,
        nav: aligned && mode === 2 && !(env.air && m.lost),
        att: (aligned && mode !== 0) || (mode === 3 && m.left === 0),
        aligning: mode !== 0 && m.left > 0,
        left: m.left, flash: m.flash,
      };
    }
    // The flight instruments' attitude source per side (transfer switch).
    const src = { L: sw.irsX === 2 ? 'R' : 'L', R: sw.irsX === 0 ? 'L' : 'R' };
    const attCapt = irs[src.L].att, attFo = irs[src.R].att;
    // FMC position: GPS, then radio, then inertial.
    const gpsOk = !f.gps && env.acPower !== false;
    const radioOk = !f.radio && env.acPower !== false;
    const anyNav = irs.L.nav || irs.R.nav;
    const posSrc = gpsOk ? 'GPS' : radioOk && env.alt < 30000 ? 'RADIO (DME/DME)' : anyNav ? 'IRS ONLY' : 'NO POSITION';
    const anp = { 'GPS': 0.05, 'RADIO (DME/DME)': 0.3, 'IRS ONLY': env.air ? 2.0 : 0.5, 'NO POSITION': 99 }[posSrc];
    const lights = {};
    for (const s of ['L', 'R']) {
      lights[`align${s}`] = irs[s].flash ? 'flash' : irs[s].aligning || irs[s].mode === 1;
      lights[`onDc${s}`] = acLost && sw[`irs${s}`] !== 0;
      lights[`dcFail${s}`] = !!f[`dc${s}`];
      lights[`fault${s}`] = irs[s].failed;
    }
    Object.assign(lights, { gps: !!f.gps, ils: !!f.ils, fmcAlert: !!f.fmcAlert });
    return {
      flows: { gpsF: gpsOk, radF: radioOk, irsF: anyNav },
      units: {
        irs: irs.L.failed || irs.R.failed ? 'fault' : irs.L.nav && irs.R.nav ? 'on' : irs.L.aligning || irs.R.aligning ? 'fault' : 'off',
        gps: f.gps ? 'fault' : 'on', radios: f.radio || f.ils ? 'fault' : 'on', fmc: 'on', wxr: 'on',
      },
      lights,
      values: {
        irs, src, attCapt, attFo, posSrc, anp, irsPos: IRS_POS,
        vhfSrc: { capt: sw.vhfX === 2 ? 2 : 1, fo: sw.vhfX === 0 ? 1 : 2 },
        cdu: [
          'POS REF / NAV STATUS',
          `FMC POS  ${posSrc}`,
          `ANP ${anp < 10 ? anp.toFixed(2) : '----'} NM`,
          `IRS L ${irs.L.nav ? 'NAV' : irs.L.aligning ? `ALIGN ${irs.L.left}` : IRS_POS[irs.L.mode]}  R ${irs.R.nav ? 'NAV' : irs.R.aligning ? `ALIGN ${irs.R.left}` : IRS_POS[irs.R.mode]}`,
          irs.L.flash || irs.R.flash ? 'ENTER IRS POSITION' : '',
        ],
      },
      note: [!attCapt && (irs.R.att ? 'Captain attitude flag — try IRS transfer BOTH ON R' : 'Captain attitude flag (IRS)'),
        !attFo && (irs.L.att ? 'F/O attitude flag — try IRS transfer BOTH ON L' : 'F/O attitude flag (IRS)'),
        (irs.L.aligning || irs.R.aligning) && `IRS aligning — ${Math.max(irs.L.left || 0, irs.R.left || 0)} min (sim)`,
        (irs.L.flash || irs.R.flash) && 'ALIGN flashing — enter present position', `Position: ${posSrc}`].filter(Boolean).join(' · '),
    };
  },
};
