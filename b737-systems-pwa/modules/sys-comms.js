// sys-comms.js — FCOM chapter 5, communications, in our own words: radios,
// audio control panels, interphones, PA, call system and the voice recorder.
// Calls arrive from the instructor station; whether you hear them depends on
// what your audio control panel is set to.

import { EE, YC, FLIGHT_DECK_X } from './airframe.js?v=21';

const C = '#00a6a6', RX = '#66d9e8';
export const MICS = ['VHF 1', 'VHF 2', 'VHF 3', 'HF 1', 'PA', 'FLT', 'SVC'];
export const RXS = [['rxV1', 'VHF 1'], ['rxV2', 'VHF 2'], ['rxV3', 'VHF 3'], ['rxHF', 'HF 1'], ['rxPA', 'PA'], ['rxFlt', 'FLT'], ['rxSvc', 'SVC']];
const FREQS = ['118.700', '121.500', '124.350', '132.025', '119.400', '127.900', '135.800'];

export default {
  id: 'comms', num: 5, title: 'Communications', fcom: 'FCOM 5', color: C,
  anchor: [FLIGHT_DECK_X - 1.4, YC + 2.2, -0.6],
  view: { target: [12, 2.8, 0], dist: 26, dir: [0.6, 0.6, -0.9] },

  overview: {
    lead: 'Three **VHF** radios and one or two **HF**, three **audio control panels** (captain, first officer, observer) to pick what you hear and where you talk, the **flight** and **service interphones**, the **passenger address**, a **call system** and the **cockpit voice recorder**.',
    how: [
      '**Transmit:** one transmitter selector per ACP (pushing another deselects the first). Any microphone at that station then transmits on it — mask or boom (MASK-BOOM switch), the hand mic, the control wheel or glareshield MIC switch.',
      '**Receive:** any combination of receiver switches; each also sets the headset and speaker volume. GPWS, altitude alert, TCAS and predictive windshear aurals come through at a fixed volume you can\'t turn off.',
      '**Degraded (ALT):** if the remote electronics unit or an ACP fails, that station gets one fixed radio only through the headset — no speaker, no interphones, no PA, no hand mic, and no aural warnings on that side.',
      'Radio tuning panels: VHF 1 on the left, VHF 2 on the right, VHF 3 aft (often used for ACARS data); each panel can tune any radio. VHF 1\'s antenna is on top of the fuselage, VHF 2 and 3 underneath (more prone to interference near structures).',
    ],
    limits: [
      ['Aural warnings', 'fixed volume, cannot be switched off', 'FCOM 5.20'],
      ['CVR in AUTO', 'first engine start until 5 min after last shutdown', 'FCOM 5.10'],
      ['CVR erase', 'on the ground with parking brake set only', 'FCOM 5.10'],
    ],
    memory: ['Lost the ACP? ALT gives you one radio on the headset only — and you won\'t hear GPWS / windshear on that side.'],
  },

  parts: [
    {
      id: 'acp', name: 'Audio control panels', at: [FLIGHT_DECK_X - 0.65, YC + 0.2, -0.35],
      lead: 'One each for the captain, first officer and first observer (the second observer listens through the first observer\'s). They control independent audio systems in a common remote electronics unit.',
      how: [
        'Transmitter selectors (lit when active): VHF 1–3, HF, PA, FLT (flight interphone), SVC (service interphone). A CALL light on a selector (with a chime) means someone wants you on that system — including SELCAL; keying the mic resets it.',
        'R/T–I/C switch: R/T keys the selected transmitter; I/C talks straight on the flight interphone, bypassing the selector. V / B / R filter nav-aid voice and range identifiers.',
        'The captain\'s and first officer\'s ceiling speakers mute while they push-to-talk (not for oxygen mask mics).',
      ],
      deck: [['Transmitter selector', 'Where you talk. One at a time.'], ['Receiver switch / volume', 'What you hear. Any combination.'], ['R/T – I/C', 'Push-to-talk: radio or straight to interphone.'], ['ALT – NORM', 'ALT: degraded mode, one radio.'], ['MASK – BOOM', 'Which headset microphone transmits.']],
      related: ['vhf', 'interphone'],
    },
    {
      id: 'vhf', name: 'VHF & HF radios', at: [FLIGHT_DECK_X - 3.0, YC + 1.98, 0],
      lead: 'Three independent VHF radios for normal voice (VHF 3 often carries ACARS data), and HF for long range. Each tuning panel has an active and a standby frequency with a transfer switch.',
      how: ['Any tuning panel can tune any radio (the light shows when a panel is tuning another side\'s radio). HF sensitivity only from the on-side panel; HF AM / USB selectable.'],
      deck: [['Radio tuning panel (ACTIVE · STBY · TFR)', 'Tune standby, TFR swaps them.'], ['VHF 3 VOICE / DATA', 'ACARS data or voice on VHF 3.']],
      related: ['acp'],
    },
    {
      id: 'interphone', name: 'Interphones & PA', at: [FLIGHT_DECK_X - 1.6, YC + 0.4, 0.5],
      lead: 'Flight interphone: private flight deck network (ground crew can plug in at the external power panel). Service interphone: flight deck, cabin crew and ground. PA: cabin speakers.',
      how: [
        'PA priority: flight deck (ACP PA or the hand mic) beats everything, then cabin crew handsets, then the pre-recorded announcements and music (PRAM).',
        'SERVICE INTERPHONE switch ON adds the external jacks around the airplane to the service interphone.',
        'Chimes on the PA speakers also sound whenever the NO SMOKING or FASTEN BELTS signs come on or go off.',
      ],
      deck: [['SERVICE INTERPHONE (OFF · ON)', 'Adds the external jacks.'], ['PA IN USE (blue)', 'Someone is on the PA.']],
      related: ['calls'],
    },
    {
      id: 'calls', name: 'Call system', at: [FLIGHT_DECK_X - 0.3, YC + 1.7, 0.3],
      lead: 'Lights and chimes (or a horn) to get someone on the interphone: the flight deck, the cabin crew, the ground crew.',
      how: ['ATTEND: two-tone chime in the cabin and the pink master call lights. GRD CALL: horn in the nose wheel well while held. The blue CALL light on the overhead: cabin crew or ground crew want the flight deck. The ground crew can only be called from the flight deck.'],
      deck: [['ATTEND', 'Calls the cabin crew.'], ['GRD CALL', 'Horn in the nose wheel well.'], ['CALL (blue)', 'Flight deck is being called.']],
      related: ['interphone'],
    },
    {
      id: 'cvr', name: 'Cockpit voice recorder', at: [-15.5, YC + 0.6, 0],
      lead: 'Records the flight deck area microphone and the crew\'s audio on four channels, in the aft fuselage.',
      how: ['AUTO: on from the first engine start until 5 minutes after the last engine shutdown. ON: powers it before engine start (trips to AUTO at the first start). TEST: STATUS green for a moment if fine. ERASE: only on the ground with the parking brake set.'],
      deck: [['VOICE RECORDER (AUTO · ON)', 'Recorder power.'], ['TEST / STATUS', 'Green: no faults.'], ['ERASE', 'Ground, parking brake set.']],
      related: [],
    },
  ],

  build(K) {
    for (const s of [-1, 1]) K.unit('acp', { box: [FLIGHT_DECK_X - 0.65, YC + 0.2, s * 0.35], size: [0.15, 0.04, 0.12] }, { color: C });
    K.unit('vhf', { box: [FLIGHT_DECK_X - 3.0, YC + 1.98, 0], size: [0.4, 0.05, 0.1] }, { color: RX });
    K.unit('vhf', { box: [FLIGHT_DECK_X - 6.0, YC - 1.98, 0], size: [0.4, 0.05, 0.1] }, { color: RX });
    K.unit('vhf', { box: [EE.x0 + 1.3, EE.y + 0.15, 0.6], size: [0.3, 0.25, 0.2] }, { color: C });
    K.unit('interphone', { box: [FLIGHT_DECK_X - 1.6, YC + 0.4, 0.5], size: [0.1, 0.15, 0.1] }, { color: C });
    K.unit('calls', { box: [FLIGHT_DECK_X - 0.3, YC + 1.7, 0.3], size: [0.06, 0.04, 0.1] }, { color: '#4dabf7' });
    K.unit('cvr', { box: [-15.5, YC + 0.6, 0], size: [0.3, 0.2, 0.2] }, { color: '#f76707' });
    K.flow('v1', [[FLIGHT_DECK_X - 3.0, YC + 1.9, 0], [EE.x0 + 2.4, YC + 0.4, 0.4], [EE.x0 + 1.3, EE.y + 0.3, 0.6]], { color: RX, part: 'vhf', r: 0.025 });
    K.flow('audio', [[EE.x0 + 1.3, EE.y + 0.3, 0.6], [FLIGHT_DECK_X - 0.65, YC + 0.2, -0.35]], { color: C, part: 'acp', r: 0.025 });
    K.flow('cvr', [[FLIGHT_DECK_X - 0.6, YC + 1.2, 0], [0, YC + 1.6, 0.2], [-15.5, YC + 0.6, 0]], { color: '#f76707', part: 'cvr', r: 0.02 });
  },

  normal(phase) {
    return {
      sw: { mic: 0, rxV1: 1, rxV2: 1, rxV3: 0, rxHF: 0, rxPA: 0, rxFlt: 1, rxSvc: 0, spkr: 1, alt: 0, cvr: 0, svcInt: 0, mask: 0, act: 0, stby: 1 },
      fail: {},
      mem: { call: null, heard: '', tx: '', t: 0 },
    };
  },

  tick(dt, st, env) {
    const m = st.mem;
    // ON trips back to AUTO at the first engine start.
    if (st.sw.cvr === 1 && (env.eng1 || env.eng2) && !m.wasRun) { st.sw.cvr = 0; m.wasRun = true; return true; }
    m.wasRun = env.eng1 || env.eng2;
    if (!m.tx && !m.heard) return false;
    m.t += dt;
    if (m.t > 6) { m.tx = ''; m.heard = ''; m.t = 0; return true; }
    return false;
  },

  action(st, key, label, env) {
    const m = st.mem, sw = st.sw;
    const degraded = sw.alt || st.fail.reu;
    if (key.startsWith('mic:')) { if (!degraded) { sw.mic = MICS.indexOf(key.slice(4)); if (m.call === key.slice(4)) m.call = null; } return; }
    if (key.startsWith('rx:')) { if (!degraded) { const k = key.slice(3); sw[k] = sw[k] ? 0 : 1; } return; }
    if (key === 'attend') { m.heard = 'Cabin crew called — two-tone chime and pink master call lights'; m.t = 0; return; }
    if (key === 'grdCall') { m.heard = 'Horn sounding in the nose wheel well'; m.t = 0; return; }
    if (key === 'cvrTest') { m.cvrTest = true; setTimeout(() => { m.cvrTest = false; }, 1200); return; }
    if (key === 'tfr') { [sw.act, sw.stby] = [sw.stby, sw.act]; return; }
    if (key === 'stbyTune') { sw.stby = (sw.stby + (label === 'INC' ? 1 : FREQS.length - 1)) % FREQS.length; return; }
    if (key === 'ptt') {
      const on = degraded ? 'VHF 1' : MICS[sw.mic];
      m.tx = `Transmitting on ${on}${on === 'VHF 1' ? ` (${FREQS[sw.act]})` : ''}`; m.t = 0;
      if (m.call === on) m.call = null;
      return;
    }
    if (key === 'callIn') {
      // An incoming call: ATC on VHF 1, SELCAL on HF, cabin, ground.
      const map = { atc: 'VHF 1', selcal: 'HF 1', cabin: 'SVC', ground: 'FLT' };
      const sys = map[label];
      m.call = label === 'atc' ? null : sys;
      const rxKey = RXS.find(([, n]) => n === sys)[0];
      const hears = degraded ? sys === 'VHF 1' : !!sw[rxKey];
      m.heard = label === 'atc'
        ? (hears ? 'ATC on VHF 1: "…climb flight level 240" — heard' : 'ATC called on VHF 1 — NOT heard (receiver off)')
        : `${{ selcal: 'SELCAL chime — HF 1 CALL light', cabin: 'Cabin crew calling — CALL light + chime', ground: 'Ground crew calling — CALL light + horn' }[label]}`;
      m.t = 0;
    }
  },

  evaluate(env, st) {
    const { sw, fail: f, mem: m } = st;
    const degraded = !!(sw.alt || f.reu);
    const engRun = env.eng1 || env.eng2;
    const cvrOn = !f.cvr && (sw.cvr === 1 || engRun);
    const lights = { cvrStatus: cvrOn && m.cvrTest, callFd: m.call === 'SVC' || m.call === 'FLT', paInUse: sw.mic === 4 && !!m.tx };
    MICS.forEach((n, i) => { lights['mic:' + n] = degraded ? n === 'VHF 1' : sw.mic === i; lights['call:' + n] = m.call === n ? 'flash' : false; });
    for (const [k] of RXS) lights['rx:' + k] = !degraded && !!sw[k];
    return {
      flows: { v1: true, audio: !f.reu, cvr: cvrOn },
      units: { acp: degraded ? 'fault' : 'on', vhf: 'on', interphone: degraded ? 'fault' : 'on', calls: m.call ? 'fault' : 'on', cvr: cvrOn ? 'on' : 'off' },
      lights,
      values: { degraded, act: FREQS[sw.act], stby: FREQS[sw.stby], mic: degraded ? 'VHF 1' : MICS[sw.mic], cvrOn, tx: m.tx, heard: m.heard },
      note: [m.tx, m.heard, degraded && 'Audio degraded: one radio (VHF 1) on the headset only — no aural warnings this side', cvrOn ? 'CVR recording' : 'CVR off'].filter(Boolean).join(' · '),
    };
  },
};

export { FREQS };
