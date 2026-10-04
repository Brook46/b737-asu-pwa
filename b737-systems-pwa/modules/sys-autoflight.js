// sys-autoflight.js — FCOM chapter 4, autopilot / flight director (AFDS) and
// autothrottle, in our own words. The MCP is operable: modes engage and arm
// the way the FMA shows them, the autopilots follow hydraulics, and an
// approach can be stepped through capture, dual channel, flare and retard.

import { EE, YC, FLIGHT_DECK_X, MLG } from './airframe.js?v=7';

const C = '#9b5de5', A = '#2f7cf6', B = '#12a874';
const BANKS = [10, 15, 20, 25, 30];

const PH = {
  ground: { at: 'ARM', lat: '', latArm: 'LNAV', pit: '', pitArm: 'VNAV', cmdA: false, spd: 150, hdg: 90, alt: 6000, vs: 0 },
  takeoff: { at: 'N1', lat: 'LNAV', latArm: '', pit: 'TO/GA', pitArm: 'VNAV', cmdA: false, spd: 150, hdg: 90, alt: 6000, vs: 0 },
  cruise: { at: 'FMC SPD', lat: 'LNAV', latArm: '', pit: 'VNAV PTH', pitArm: '', cmdA: true, spd: 280, hdg: 93, alt: 37000, vs: 0 },
  landing: { at: '', lat: '', latArm: '', pit: '', pitArm: '', cmdA: false, spd: 140, hdg: 90, alt: 5000, vs: 0 },
};
const STEPS = ['LOC + G/S capture', 'Below 1,500 ft RA', '50 ft — flare', '27 ft — retard', 'Touchdown'];

export default {
  id: 'autoflight', num: 4, title: 'Automatic Flight', fcom: 'FCOM 4', color: C,
  anchor: [FLIGHT_DECK_X + 1.0, YC + 1.7, 0],
  view: { target: [10, 2.5, 0], dist: 26, dir: [0.75, 0.5, 0.9] },

  overview: {
    lead: 'Two flight control computers (**FCC A** and **B**) drive the autopilots and flight directors from one **mode control panel**; the **autothrottle** moves both thrust levers. The FMC supplies the N1 limits, target speeds and the LNAV / VNAV path. What is actually engaged is always on the **FMA** above each attitude display.',
    how: [
      'Each autopilot moves the controls through its own hydraulic system — A/P A through system A, A/P B through B — so losing a system drops that autopilot.',
      'Only one autopilot at a time, except in **APP** mode: then both can engage for a dual-channel (fail-passive) approach with automatic flare and touchdown, or an autopilot go-around.',
      '**CMD** follows the selected modes; **CWS** (control wheel steering) lets you fly through the autopilot with light wheel pressure and holds what you leave it.',
      '**FMA:** autothrottle mode on the left, roll in the middle, pitch on the right — engaged modes large green, armed modes small white, with a box for 10 s after any change. Above it the status: CMD, FD, CWS P / CWS R, SINGLE CH.',
      'The AFS never commands beyond Vmo/Mmo, the flap and gear placards or about 1.3 Vs (minimum speed); near a limit modes revert (e.g. V/S → LVL CHG).',
    ],
    limits: [
      ['Autopilot engagement after takeoff', 'not below 400 ft AGL', 'FCOM L.10'],
      ['Single-channel A/P on approach', 'not engaged below 50 ft AGL', 'FCOM L.10'],
      ['Autoland', 'flaps 30 or 40, both engines operating', 'FCOM L.10'],
      ['Autoland glideslope', '2.5° to 3.25°', 'FCOM L.10'],
      ['Autoland wind', 'headwind 25 · crosswind 20 · tailwind 15 kt', 'FCOM L.10'],
      ['Aileron trim with A/P engaged', 'Prohibited', 'FCOM L.10'],
    ],
    memory: ['Dual A/P: the second autopilot must be in CMD by 800 ft RA; FLARE must be armed by about 350 ft or both disengage.'],
  },

  parts: [
    {
      id: 'mcp', name: 'Mode control panel (MCP)', at: [FLIGHT_DECK_X + 1.1, YC + 1.58, 0],
      lead: 'On the glareshield: autothrottle and speed on the left, heading and the roll modes in the middle, altitude, vertical speed and the autopilot engage switches on the right; a course selector at each end.',
      how: [
        'A lit switch means its mode is selected and can be deselected by pushing it again (unless deselection is inhibited). A switch that conflicts with what is engaged does nothing.',
        'Bank angle selector for HDG SEL / VOR: 10, 15, 20, 25 or 30°. Speeds above Vmo/Mmo cannot be set; speeds beyond placards or below minimum can, and the window then shows a limit symbol.',
      ],
      deck: [['N1', 'A/T holds the N1 limit.'], ['SPEED', 'A/T holds the MCP speed.'], ['VNAV', 'FMC vertical path and speed.'], ['LVL CHG', 'Pitch holds speed; A/T sets climb thrust or idle.'], ['HDG SEL', 'Turn to the selected heading.'], ['LNAV', 'Follow the FMC route.'], ['VOR LOC', 'Capture and track the selected course.'], ['APP', 'Arm localizer and glideslope; enables both autopilots.'], ['ALT HLD', 'Hold the altitude.'], ['V/S', 'Hold the selected vertical speed.'], ['CMD A / CMD B', 'Engage that autopilot in command.'], ['CWS A / CWS B', 'Engage in control wheel steering.'], ['A/T ARM', 'Arms the autothrottle (magnetically held).'], ['F/D', 'Shows that pilot\'s command bars.'], ['DISENGAGE bar', 'Down: disengages both and prevents engagement.']],
      related: ['fcc', 'at', 'fma'],
    },
    {
      id: 'fcc', name: 'Flight control computers A & B', at: [EE.x0 + 1.6, EE.y + 0.1, 0.55],
      lead: 'FCC A drives A/P A and normally the captain\'s flight director; FCC B drives A/P B and the first officer\'s. The **master** FCC (MA light) runs the modes for both flight directors.',
      how: [
        'Master: with no A/P in CMD, the FCC of the first F/D switched on; with an A/P in CMD, that A/P\'s FCC.',
        'Each FCC has its own radio altimeter; one failing disengages its autopilot after 2 s. Dual-channel needs two generators on line.',
      ],
      related: ['servos', 'mcp'],
    },
    {
      id: 'servos', name: 'Autopilot actuators', at: [MLG.x - 0.5, 2.1, 0.6],
      lead: 'Each A/P has pitch and roll actuators working the aileron and elevator PCUs, A/P A on hydraulic system A and A/P B on system B. The autopilot also trims the stabiliser.',
      how: [
        'Disconnects automatically for: the disengage switch or bar, control force override (modes may revert to CWS), TO/GA below 2,000 ft without flare armed, trim switches, STAB TRIM AUTOPILOT cutout, IRS failure, its hydraulic system lost, power or sensor loss, stick shaker over 5 min.',
        'STAB OUT OF TRIM (amber) — the autopilot isn\'t trimming properly (only with the A/P engaged).',
      ],
      deck: [['A/P disengage light (red)', 'Flashing + tone: autopilot disengaged. Push to reset.'], ['STAB OUT OF TRIM (amber)', 'A/P not trimming the stabiliser properly.']],
      related: ['fcc'],
    },
    {
      id: 'at', name: 'Autothrottle', at: [FLIGHT_DECK_X - 0.9, YC - 0.3, 0],
      lead: 'Servo motors drive both thrust levers to the FMC N1 limit or to hold speed. Modes: N1, FMC SPD, MCP SPD, GA, RETARD, THR HLD, ARM.',
      how: [
        '**Takeoff:** TO/GA engages N1; at 84 kt it goes to THR HLD so the levers stay put; it re-engages in climb.',
        '**Landing:** RETARD at about 27 ft RA to reach idle at touchdown; the A/T disengages about 2 s after touchdown.',
        '**Go-around:** first TO/GA push below 2,000 ft RA — GA thrust for 1,000–2,000 fpm; second push — full go-around N1.',
        'Disengage switches on the levers (A/T disengage light flashes, ARM switch trips off). The light also flashes if speed is 10 kt fast or 5 kt slow and not converging.',
      ],
      deck: [['A/T disengage light (red)', 'Flashing: A/T disengaged or speed not held.'], ['TO/GA switches', 'Takeoff or go-around mode.'], ['A/T LIM (white)', 'FMC not supplying an N1 limit; A/T uses a degraded one.']],
      related: ['mcp'],
    },
    {
      id: 'fma', name: 'Flight mode annunciator', at: [FLIGHT_DECK_X + 0.85, YC + 1.0, -0.65],
      lead: 'Across the top of each PFD: thrust mode · roll mode · pitch mode, engaged in green, armed in white underneath, and the autopilot status above the attitude display.',
      how: ['A change is boxed for 10 s (CWS flashes). Check the FMA after every MCP selection — the switch light only says what you asked for.'],
      related: ['mcp'],
    },
    {
      id: 'approach', name: 'Approach & autoland', at: [FLIGHT_DECK_X - 1.0, YC - 1.6, 0],
      lead: 'APP arms localizer and glideslope (VOR/LOC and G/S white). LOC captures by ½ dot, G/S at 2/5 dot (from above or below); the second A/P can be engaged for dual channel.',
      how: [
        'Below 1,500 ft RA with both captured: the second A/P couples, the ILS deviation test flashes the scales, FLARE arms, SINGLE CH goes out and A/P go-around arms.',
        '800 ft: last chance to engage the second A/P. 400 ft: stabiliser trimmed further nose up. ~350 ft: no FLARE armed → both disengage.',
        '~50 ft: FLARE engages, F/D bars retract; ~27 ft: RETARD; touchdown: A/T off after ~2 s; you disconnect the autopilot and roll out by hand.',
        'Single A/P approach: no flare, no trim bias, SINGLE CH all the way, no A/P go-around.',
      ],
      limits: [['Autoland', 'flaps 30 or 40, both engines', 'FCOM L.10'], ['Single-channel', 'not below 50 ft AGL', 'FCOM L.10']],
      related: ['fma', 'at'],
    },
  ],

  build(K) {
    K.unit('mcp', { box: [FLIGHT_DECK_X + 1.1, YC + 1.58, 0], size: [0.12, 0.08, 1.0] }, { color: C });
    K.unit('fcc', { box: [EE.x0 + 1.6, EE.y + 0.1, 0.55], size: [0.35, 0.3, 0.25] }, { color: C });
    K.unit('fcc', { box: [EE.x0 + 1.6, EE.y + 0.1, -0.55], size: [0.35, 0.3, 0.25] }, { color: C });
    K.unit('at', { box: [FLIGHT_DECK_X - 0.9, YC - 0.3, 0], size: [0.3, 0.2, 0.3] }, { color: C });
    K.unit('fma', { box: [FLIGHT_DECK_X + 0.85, YC + 1.0, -0.65], size: [0.04, 0.05, 0.2] }, { color: '#3df03d' });
    K.unit('fma', { box: [FLIGHT_DECK_X + 0.85, YC + 1.0, 0.65], size: [0.04, 0.05, 0.2] }, { color: '#3df03d' });
    K.unit('approach', { box: [FLIGHT_DECK_X - 1.0, YC - 1.6, 0], size: [0.4, 0.06, 0.3] }, { color: C });
    for (const [s, col, key] of [[1, A, 'apA'], [-1, B, 'apB']]) {
      K.unit('servos', { box: [MLG.x - 0.5, 2.1, s * 0.6], size: [0.3, 0.2, 0.2] }, { color: col });
      K.flow(key, [[EE.x0 + 1.6, EE.y + 0.1, s * 0.55], [6, 1.5, s * 0.6], [MLG.x - 0.5, 2.1, s * 0.6]], { color: col, part: 'servos', r: 0.03 });
      K.flow(key, [[MLG.x - 0.5, 2.3, s * 0.6], [-10, 3.2, s * 0.3], [-17.5, 3.8, s * 0.3]], { color: col, part: 'servos', r: 0.03 });
    }
    K.flow('at', [[EE.x0 + 1.6, EE.y + 0.2, 0], [FLIGHT_DECK_X - 0.9, YC - 0.3, 0]], { color: C, part: 'at', r: 0.03 });
  },

  normal(phase) {
    const p = PH[phase];
    return {
      sw: { atArm: phase === 'landing' ? 0 : 1, fdL: phase === 'landing' ? 0 : 1, fdR: phase === 'landing' ? 0 : 1, bank: 3, dis: 0 },
      fail: {},
      mem: { ...p, cmdB: false, cws: false, app: false, step: -1, apDisc: false, atDisc: false, changed: {} },
    };
  },

  tick(dt, st, env) {
    const m = st.mem;
    let ch = false;
    const drop = (which) => { m[which] = false; m.apDisc = true; ch = true; };
    if (m.cmdA && env.hydA === false) drop('cmdA');
    if (m.cmdB && env.hydB === false) drop('cmdB');
    if ((m.cmdA || m.cmdB || m.cws) && (st.sw.dis || env.stabApCut)) { m.cmdA = m.cmdB = m.cws = false; m.apDisc = true; ch = true; }
    if (m.step === 4 && m.at && (m.tdT = (m.tdT || 0) + dt) > 2) { m.at = ''; st.sw.atArm = 0; m.atDisc = true; ch = true; }
    if (!st.sw.atArm && m.at) { m.at = ''; ch = true; }
    return ch;
  },

  action(st, key, label, env) {
    const m = st.mem, sw = st.sw, air = env.air;
    const set = (k, v) => { if (m[k] !== v) { m[k] = v; m.changed[k] = Date.now(); } };
    const at = (v) => { if (sw.atArm) set('at', v); };
    const ap = m.cmdA || m.cmdB;
    switch (key) {
      case 'N1': at(m.at === 'N1' ? 'ARM' : 'N1'); break;
      case 'SPEED': at(m.at === 'MCP SPD' ? 'ARM' : 'MCP SPD'); break;
      case 'VNAV':
        if (!air) { set('pitArm', m.pitArm === 'VNAV' ? '' : 'VNAV'); break; }
        if (m.pit.startsWith('VNAV')) set('pit', ap ? 'CWS P' : '');
        else { set('pit', env.phase === 'cruise' ? 'VNAV PTH' : 'VNAV SPD'); at(env.phase === 'cruise' ? 'FMC SPD' : 'N1'); }
        break;
      case 'LVL CHG': if (air) { set('pit', 'MCP SPD'); at(m.alt > env.alt ? 'N1' : 'ARM'); } break;
      case 'HDG SEL': if (air || sw.fdL || sw.fdR) set('lat', m.lat === 'HDG SEL' ? '' : 'HDG SEL'); break;
      case 'LNAV': if (!air) set('latArm', m.latArm === 'LNAV' ? '' : 'LNAV'); else set('lat', m.lat === 'LNAV' ? '' : 'LNAV'); break;
      case 'VOR LOC': set('latArm', m.latArm === 'VOR/LOC' ? '' : 'VOR/LOC'); break;
      case 'APP':
        if (m.app && m.step < 0) { m.app = false; set('latArm', ''); set('pitArm', ''); }
        else if (air) { m.app = true; m.step = -1; set('latArm', 'VOR/LOC'); set('pitArm', 'G/S'); }
        break;
      case 'ALT HLD': if (air) { set('pit', 'ALT HOLD'); if (m.at && m.at !== 'ARM') at('MCP SPD'); } break;
      case 'V/S': if (air) { set('pit', 'V/S'); at('MCP SPD'); } break;
      case 'CMD A': case 'CMD B': case 'CWS A': case 'CWS B': {
        const me = key.endsWith('A') ? 'cmdA' : 'cmdB', other = me === 'cmdA' ? 'cmdB' : 'cmdA';
        const hyd = me === 'cmdA' ? env.hydA : env.hydB;
        if (m[me] || (key.startsWith('CWS') && m.cws)) { m[me] = false; m.cws = false; m.apDisc = true; break; }
        if (sw.dis || env.stabApCut || hyd === false) { m.apDisc = true; break; }
        m.apDisc = false;
        if (key.startsWith('CWS')) { m.cws = key.slice(-1); m.cmdA = m.cmdB = false; break; }
        m.cws = false;
        if (m[other] && !m.app) m[other] = false;
        m[me] = true; m.changed.status = Date.now();
        if (!m.pit && air) set('pit', 'CWS P');
        break;
      }
      case 'APDISC': if (m.cmdA || m.cmdB || m.cws) { m.cmdA = m.cmdB = m.cws = false; m.apDisc = true; } else m.apDisc = false; break;
      case 'ATDISC': if (m.at) { set('at', ''); sw.atArm = 0; m.atDisc = true; } else m.atDisc = false; break;
      case 'TOGA':
        if (!air) { if (sw.fdL || sw.fdR) { set('pit', 'TO/GA'); at('N1'); } }
        else { set('pit', 'TO/GA'); set('lat', ''); set('latArm', 'LNAV'); at('GA'); if (!(m.cmdA && m.cmdB)) { if (ap) m.apDisc = true; m.cmdA = m.cmdB = false; } m.app = false; m.step = -1; }
        break;
      case 'spd': m.spd = Math.max(100, Math.min(340, m.spd + (label === 'INC' ? 5 : -5))); break;
      case 'hdg': m.hdg = (m.hdg + (label === 'INC' ? 5 : -5) + 360) % 360; break;
      case 'alt': m.alt = Math.max(0, Math.min(41000, m.alt + (label === 'INC' ? 1000 : -1000))); break;
      case 'vs': m.vs = Math.max(-6000, Math.min(6000, m.vs + (label === 'INC' ? 100 : -100))); break;
      case 'step': {
        // Instructor: step an ILS approach along.
        if (!m.app) break;
        m.step = Math.min(4, m.step + 1);
        if (m.step === 0) { set('lat', 'VOR/LOC'); set('latArm', ''); set('pit', 'G/S'); set('pitArm', ''); at('MCP SPD'); }
        if (m.step === 1 && m.cmdA && m.cmdB) set('pitArm', 'FLARE');
        if (m.step === 1 && !(m.cmdA && m.cmdB) && m.cmdA !== m.cmdB) set('pitArm', '');
        if (m.step === 2) { if (m.cmdA && m.cmdB) { set('pit', 'FLARE'); set('pitArm', ''); } else if (ap) { m.cmdA = m.cmdB = false; m.apDisc = true; } }
        if (m.step === 3) at('RETARD');
        if (m.step === 4) { m.tdT = 0; at('ARM'); }
        break;
      }
      case 'apReset': m.apDisc = false; break;
      case 'atReset': m.atDisc = false; break;
    }
  },

  evaluate(env, st) {
    const { sw, mem: m, fail: f } = st;
    const dual = m.cmdA && m.cmdB;
    const fd = sw.fdL || sw.fdR;
    let status = m.cws ? 'CWS P  CWS R' : dual || m.cmdA || m.cmdB ? 'CMD' : fd ? 'FD' : '';
    const single = m.app && m.step >= 0 && m.step < 4 && !(dual && m.step >= 1) && (m.cmdA || m.cmdB);
    const lit = new Set();
    if (m.at === 'N1') lit.add('N1');
    if (m.at === 'MCP SPD') lit.add('SPEED');
    if (m.pit.startsWith('VNAV') || m.pitArm === 'VNAV') lit.add('VNAV');
    if (m.pit === 'MCP SPD') lit.add('LVL CHG');
    if (m.lat === 'HDG SEL') lit.add('HDG SEL');
    if (m.lat === 'LNAV' || m.latArm === 'LNAV') lit.add('LNAV');
    if (!m.app && (m.lat === 'VOR/LOC' || m.latArm === 'VOR/LOC')) lit.add('VOR LOC');
    if (m.app && m.step < 0) lit.add('APP');
    if (m.pit === 'ALT HOLD') lit.add('ALT HLD');
    if (m.pit === 'V/S') lit.add('V/S');
    if (m.cmdA) lit.add('CMD A');
    if (m.cmdB) lit.add('CMD B');
    if (m.cws) lit.add(`CWS ${m.cws}`);
    const fma = [m.at === 'ARM' ? 'ARM' : m.at, m.lat, m.pit], arm = ['', m.latArm, m.pitArm];
    const now = Date.now(), boxed = ['at', 'lat', 'pit'].map((k) => now - (m.changed[k] || 0) < 10000);
    return {
      flows: { apA: m.cmdA || (m.cws && env.hydA !== false), apB: m.cmdB, at: !!m.at && m.at !== 'ARM' },
      units: {
        mcp: 'on', fcc: 'on', servos: m.cmdA || m.cmdB || m.cws ? 'on' : 'off', at: m.at && m.at !== 'ARM' ? 'on' : sw.atArm ? 'off' : 'off',
        fma: 'on', approach: m.app ? 'on' : 'off',
      },
      lights: {
        apDisc: m.apDisc && 'flash', atDisc: m.atDisc && 'flash', stabOot: !!f.stabOot && (m.cmdA || m.cmdB), atArmLt: !!sw.atArm,
        maL: !!sw.fdL && (m.cmdB ? false : true), maR: !!sw.fdR && (m.cmdB || !sw.fdL),
        ...Object.fromEntries(['N1', 'SPEED', 'VNAV', 'LVL CHG', 'HDG SEL', 'LNAV', 'VOR LOC', 'APP', 'ALT HLD', 'V/S', 'CMD A', 'CMD B', 'CWS A', 'CWS B'].map((k) => ['mcp_' + k, lit.has(k)])),
      },
      values: {
        fma, arm, boxed, status: single ? `${status}  SINGLE CH` : status, lit, spd: m.spd, hdg: m.hdg, alt: m.alt, vs: m.vs,
        bank: BANKS[sw.bank], step: m.step, stepName: STEPS[m.step + 1] || '', dual,
      },
      note: [m.apDisc && 'A/P disengaged — push the red light to reset', m.atDisc && 'A/T disengaged',
        m.app && m.step >= 0 && `Approach: ${STEPS[m.step]}`, dual && 'Dual channel'].filter(Boolean).join(' · '),
    };
  },
};

export { BANKS, STEPS };
