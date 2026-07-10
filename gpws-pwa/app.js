/* B737NG GPWS/EGPWS simulator — logic & indications per FCOM D6-27370-858-ELA
   (Ch.10 PFD/ND, Ch.15 Warning Systems). Simplified envelopes for training. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';
  const CY = 140; // ADI / tape centre-line Y

  /* ================= flight state ================= */
  const state = {
    ra: 2000, vs: 0, ias: 250, bank: 0, gsDev: 0, closure: 0,
    phase: 'cruise', gear: 'up', flaps: 0, ils: false,
    threat: 'none', obstacle: 'none', shear: false, pws: 'none', tcas: 'none',
    flapInhibit: false, gearInhibit: false, terrInhibit: false,
    tcfDemo: false, testing: false,
    selectedMode: null,
    manual: { pullup: false, windshear: false, belowgs: false, terr: false, inop: false }
  };
  const sink = () => Math.max(0, -state.vs);
  const landingFlaps = () => state.flaps >= 30 || state.flapInhibit;
  const VMO = 340;
  function minMvr() { return state.flaps >= 30 ? 118 : state.flaps >= 15 ? 128 : state.flaps >= 5 ? 138 : 205; }
  function stallSpd() { return minMvr() - 18; }

  /* ================= mode definitions ================= */
  function act(level, aural, sound, lamps, nd) { return { status: 'active', level, aural, sound, lamps: lamps || {}, nd: nd || {} }; }
  const armed = reason => ({ status: 'armed', reason });
  const inh = reason => ({ status: 'inhibited', reason });

  const MODES = [
    { id: 'm1', name: 'Mode 1 — Excessive descent rate',
      envelope: 'RA 10–2450 ft. Barometric sink rate vs radio altitude. “SINK RATE”, then “WHOOP WHOOP PULL UP”. Both illuminate red PULL UP on the attitude indicators.',
      demo: ['pull-up'], scn: { ra: 700, vs: -5500, ias: 280 },
      evaluate() {
        if (state.ra < 10 || state.ra > 2450) return inh('outside 10–2450 ft RA envelope');
        const c = Math.max(600, 1500 + 1.79 * (state.ra - 500)), w = Math.max(1200, 2200 + 2.3 * (state.ra - 500));
        if (sink() > w) return act('warning', 'WHOOP WHOOP — PULL UP', 'pull-up', { pullup: 'red' });
        if (sink() > c) return act('caution', 'SINK RATE', 'sink-rate', { pullup: 'red' });
        return armed(`armed — sink ${Math.round(sink())} fpm < ~${Math.round(c)} fpm`);
      } },
    { id: 'm2', name: 'Mode 2 — Excessive terrain closure',
      envelope: 'RA 30–2450 ft. Radio-altitude closure rate. “TERRAIN TERRAIN” then “PULL UP”; landing config gives “TERRAIN” only (2B). Red PULL UP on the attitude indicators.',
      demo: ['terrain-pull-up'], scn: { ra: 900, closure: 5200, vs: -2000, ias: 290 },
      evaluate() {
        if (state.ra < 30 || state.ra > 2450) return inh('outside 30–2450 ft RA envelope');
        const c = 2000 + 1.2 * state.ra, w = 3000 + 1.6 * state.ra, landing = state.gear === 'down' && landingFlaps();
        if (state.closure > w && !landing) return act('warning', 'TERRAIN TERRAIN — PULL UP', 'terrain-pull-up', { pullup: 'red' });
        if (state.closure > c) return act('caution', 'TERRAIN TERRAIN', 'terrain', { pullup: 'red' });
        return armed(`armed — closure ${state.closure} fpm < ~${Math.round(c)} fpm`);
      } },
    { id: 'm3', name: 'Mode 3 — Altitude loss after takeoff',
      envelope: 'Takeoff / go-around, RA 30–1500 ft. Excessive altitude loss before climb: “DON’T SINK”. Red PULL UP on the attitude indicators.',
      demo: ['dont-sink'], scn: { ra: 350, vs: -400, ias: 160, phase: 'takeoff', gear: 'up', flaps: 5 },
      evaluate() {
        if (state.phase !== 'takeoff') return inh('only armed in takeoff / go-around');
        if (state.ra < 30 || state.ra > 1500) return inh('outside 30–1500 ft RA envelope');
        if (state.vs < -100) return act('caution', "DON'T SINK", 'dont-sink', { pullup: 'red' });
        return armed('armed — climbing or level');
      } },
    { id: 'm4a', name: 'Mode 4A — Unsafe terrain clearance, gear up',
      envelope: 'Gear up, RA < 500 ft. Low speed: “TOO LOW GEAR”; high speed: “TOO LOW TERRAIN”. Inhibited by GEAR INHIBIT. Red PULL UP.',
      demo: ['too-low-gear'], scn: { ra: 280, vs: -500, ias: 175, phase: 'approach', gear: 'up', flaps: 5 },
      evaluate() {
        if (state.phase === 'takeoff') return inh('not armed in takeoff phase');
        if (state.gear === 'down') return inh('gear is down');
        if (state.gearInhibit) return inh('GEAR INHIBIT switch');
        const floor = state.ias < 190 ? 500 : Math.min(1000, 500 + (state.ias - 190) * 8.3);
        if (state.ra < floor) return state.ias < 190
          ? act('caution', 'TOO LOW GEAR', 'too-low-gear', { pullup: 'red' })
          : act('caution', 'TOO LOW TERRAIN', 'too-low-terrain', { pullup: 'red' });
        return armed(`armed — above ${Math.round(floor)} ft floor`);
      } },
    { id: 'm4b', name: 'Mode 4B — Unsafe terrain clearance, flaps',
      envelope: 'Gear down, flaps not landing, RA < 245 ft. Low speed: “TOO LOW FLAPS”; high speed: “TOO LOW TERRAIN”. Inhibited by FLAP INHIBIT. Red PULL UP.',
      demo: ['too-low-flaps'], scn: { ra: 180, vs: -600, ias: 150, phase: 'approach', gear: 'down', flaps: 5 },
      evaluate() {
        if (state.phase === 'takeoff') return inh('not armed in takeoff phase');
        if (state.gear !== 'down') return inh('gear is up (Mode 4A region)');
        if (state.flapInhibit) return inh('FLAP INHIBIT switch');
        if (state.flaps >= 30) return inh('flaps in landing position');
        const floor = state.ias < 159 ? 245 : Math.min(1000, 245 + (state.ias - 159) * 9.4);
        if (state.ra < floor) return state.ias < 159
          ? act('caution', 'TOO LOW FLAPS', 'too-low-flaps', { pullup: 'red' })
          : act('caution', 'TOO LOW TERRAIN', 'too-low-terrain', { pullup: 'red' });
        return armed(`armed — above ${Math.round(floor)} ft floor`);
      } },
    { id: 'm5', name: 'Mode 5 — Below glideslope',
      envelope: 'ILS/GLS G/S tuned, gear down, RA 30–1000 ft, below beam. “GLIDESLOPE” — volume/repetition rise with deviation. Lights amber BELOW G/S. Cancel with BELOW G/S P-INHIBIT below 1,000 ft.',
      demo: ['glideslope'], scn: { ra: 550, vs: -700, ias: 145, phase: 'approach', gear: 'down', flaps: 30, ils: true, gsDev: -2.6 },
      evaluate() {
        if (!state.ils) return inh('ILS glideslope not tuned');
        if (state.gear !== 'down') return inh('gear is up');
        if (state.ra < 30 || state.ra > 1000) return inh('outside 30–1000 ft RA envelope');
        const below = -state.gsDev;
        if (below > 2 && state.ra < 300) return act('caution', 'GLIDESLOPE (hard)', 'glideslope', { belowgs: 'amber' });
        if (below > 1.3) return act('caution', 'GLIDESLOPE', 'glideslope', { belowgs: 'amber' });
        return armed('armed — within 1.3 dots of the beam');
      } },
    { id: 'm6', name: 'Mode 6 — Bank angle',
      envelope: 'Aural “BANK ANGLE, BANK ANGLE”. 5–30 ft: > 10°; 30–130 ft: linearly 10° → 35°; above 130 ft: 35°, 40°, 45°. Resets when bank ≤ 30°. No visual annunciation.',
      demo: ['bank-angle'], scn: { ra: 120, vs: -200, ias: 150, phase: 'approach', gear: 'down', flaps: 30, bank: 38 },
      evaluate() {
        if (state.ra < 5) return inh('below 5 ft RA');
        const limit = state.ra <= 30 ? 10 : state.ra <= 130 ? 10 + (state.ra - 30) / 100 * 25 : 35;
        if (Math.abs(state.bank) > limit) return act('caution', 'BANK ANGLE', 'bank-angle', {});
        return armed(`armed — bank limit ~${Math.round(limit)}° at this RA`);
      } },
    { id: 'm7', name: 'Mode 7 — Reactive windshear (airplane in windshear)',
      envelope: 'GPWS windshear, enabled below 1,500 ft RA, detection from rotation. Two-tone siren + “WINDSHEAR, WINDSHEAR, WINDSHEAR”. Red WINDSHEAR on both PFDs. Inhibits terrain & radio-alt alerts.',
      demo: ['windshear'], scn: { ra: 320, vs: -1500, ias: 150, phase: 'takeoff', gear: 'up', flaps: 5, shear: true },
      evaluate() {
        if (state.phase === 'cruise') return inh('armed only in takeoff / approach');
        if (state.ra > 1500) return inh('enabled below 1,500 ft RA');
        if (state.shear) return act('warning', 'WINDSHEAR, WINDSHEAR, WINDSHEAR', 'windshear', { windshear: 'red' }, { wsMsg: 'red', wsPfd: true });
        return armed('armed — no shear detected');
      } },
    { id: 'pws', name: 'EGPWS — Predictive windshear (PWS)',
      envelope: 'Weather-radar look-ahead, below 1,200 ft RA, takeoff/approach. Caution (≤3 NM): amber WINDSHEAR + “MONITOR RADAR DISPLAY”. Warning (≤1.5 NM): red WINDSHEAR + symbol; takeoff “WINDSHEAR AHEAD”, approach “GO AROUND, WINDSHEAR AHEAD”. Inhibited by TERR INHIBIT.',
      demo: ['windshear'], scn: { ra: 450, vs: -200, ias: 150, phase: 'approach', gear: 'down', flaps: 15, pws: 'warning' },
      evaluate() {
        if (state.terrInhibit) return inh('TERR INHIBIT switch');
        if (state.phase === 'cruise') return inh('armed only in takeoff / approach');
        if (state.ra > 1200) return inh('enabled below 1,200 ft RA');
        if (state.pws === 'warning') {
          const call = state.phase === 'takeoff' ? 'WINDSHEAR AHEAD, WINDSHEAR AHEAD' : 'GO AROUND, WINDSHEAR AHEAD';
          return act('warning', call, 'windshear', { windshear: 'red' }, { wsMsg: 'red', wsPfd: true, pwsSym: 'red' });
        }
        if (state.pws === 'caution') return act('caution', 'MONITOR RADAR DISPLAY', null, { windshear: 'amber' }, { wsMsg: 'amber', pwsSym: 'red' });
        return armed('armed — no windshear ahead on radar');
      } },
    { id: 'ta', name: 'EGPWS — Look-ahead terrain (TAD)',
      envelope: 'Terrain-database alerting. Caution 40–60 s: “CAUTION TERRAIN” + amber TERRAIN & solid amber terrain on ND. Warning 20–30 s: “TERRAIN TERRAIN, PULL UP” + red PULL UP & solid red terrain. Inhibited by TERR INHIBIT.',
      demo: ['terrain', 'terrain-pull-up'], scn: { ra: 1600, vs: -1200, ias: 270, threat: 'warning', closure: 3000 },
      evaluate() {
        if (state.terrInhibit) return inh('TERR INHIBIT switch');
        if (state.threat === 'warning') return act('warning', 'TERRAIN TERRAIN — PULL UP', 'terrain-pull-up', { pullup: 'red', terr: 'red' }, { terrainMsg: 'red' });
        if (state.threat === 'caution') return act('caution', 'CAUTION TERRAIN', 'terrain', { terr: 'amber' }, { terrainMsg: 'amber' });
        return armed('armed — no database threat ahead');
      } },
    { id: 'obst', name: 'EGPWS — Look-ahead obstacle',
      envelope: 'Obstacle database (man-made obstacles ≥ 100 ft). Caution 40–60 s: “CAUTION OBSTACLE” + amber OBSTACLE on ND. Warning 20–30 s: “OBSTACLE OBSTACLE, PULL UP” + red PULL UP. Inhibited by TERR INHIBIT.',
      demo: ['caution-obstacle', 'obstacle-pull-up'], scn: { ra: 900, vs: -1000, ias: 220, phase: 'approach', gear: 'up', flaps: 5, obstacle: 'warning' },
      evaluate() {
        if (state.terrInhibit) return inh('TERR INHIBIT switch');
        if (state.obstacle === 'warning') return act('warning', 'OBSTACLE OBSTACLE — PULL UP', 'obstacle-pull-up', { pullup: 'red', terr: 'red' }, { obstacleMsg: 'red' });
        if (state.obstacle === 'caution') return act('caution', 'CAUTION OBSTACLE', 'caution-obstacle', { terr: 'amber' }, { obstacleMsg: 'amber' });
        return armed('armed — no database obstacle ahead');
      } },
    { id: 'tcf', name: 'EGPWS — Terrain clearance floor (TCF)',
      envelope: '“TOO LOW TERRAIN” when descending through the protection floor around a runway, in any configuration. Red PULL UP on the attitude indicators. Inhibited by TERR INHIBIT.',
      demo: ['too-low-terrain'], scn: { ra: 220, vs: -800, ias: 180, phase: 'approach', gear: 'up', flaps: 15, tcfDemo: true },
      evaluate() {
        if (state.terrInhibit) return inh('TERR INHIBIT switch');
        if (state.tcfDemo) return act('caution', 'TOO LOW TERRAIN', 'too-low-terrain', { pullup: 'red' });
        return armed('armed — select to demo the runway floor');
      } },
    { id: 'tcas', name: 'TCAS II — Resolution advisory',
      envelope: 'Traffic advisory “TRAFFIC, TRAFFIC” (amber TA symbol). Resolution advisory “CLIMB, CLIMB” / “DESCEND, DESCEND” with red fly-to/avoid bands on the IVSI. RAs inhibited below 1,000 ft (TA only), aurals below 500 ft.',
      demo: ['tcas-traffic', 'tcas-climb'], scn: { ra: 2200, vs: 0, ias: 290, phase: 'cruise', tcas: 'climb' },
      evaluate() {
        if (state.tcas === 'none') return armed('armed — no conflicting traffic');
        let level = state.tcas === 'ta' ? 'ta' : (state.ra < 1000 ? 'ta' : state.tcas);
        const silent = state.ra < 500;
        if (level === 'ta') return act('caution', 'TRAFFIC, TRAFFIC', silent ? null : 'tcas-traffic', {}, { trafficMsg: 'amber', trafficSym: 'amber' });
        if (level === 'climb') return act('warning', 'CLIMB, CLIMB', silent ? null : 'tcas-climb', {}, { trafficMsg: 'red', trafficSym: 'red', tcasBand: 'climb' });
        return act('warning', 'DESCEND, DESCEND', silent ? null : 'tcas-descend', {}, { trafficMsg: 'red', trafficSym: 'red', tcasBand: 'descend' });
      } },
    { id: 'ovsp', name: 'Mach/Airspeed warning — overspeed',
      envelope: 'Airspeed/Mach above VMO/MMO. Continuous clacker. VMO shown as a red-and-black barber pole on the PFD speed tape.',
      demo: ['overspeed'], scn: { ra: 2500, vs: 0, ias: 360, phase: 'cruise' },
      evaluate() { return state.ias > VMO ? act('warning', 'OVERSPEED (clacker)', 'overspeed', {}) : armed(`armed — VMO ${VMO} kt`); } },
    { id: 'stall', name: 'Stall warning — stick shaker',
      envelope: 'Airspeed into the minimum-manoeuvre / stick-shaker region. Control-column stick shaker. Minimum-speed amber/red band on the PFD speed tape.',
      demo: ['stall'], scn: { ra: 800, vs: -500, ias: 120, phase: 'approach', gear: 'down', flaps: 30 },
      evaluate() { return state.ias <= stallSpd() ? act('warning', 'STALL — STICK SHAKER', 'stall', {}) : armed(`armed — shaker ~${Math.round(stallSpd())} kt`); } }
  ];

  const PRIORITY = { m7: 100, stall: 99, ovsp: 98, pws: 95, m1: 90, ta: 85, obst: 85, m2: 84,
    tcas: 70, m4a: 60, m4b: 59, m3: 55, m6: 40, m5: 30, tcf: 20 };

  const MANUAL = {
    pullup:    { sound: 'pull-up',    text: 'WHOOP WHOOP — PULL UP', color: 'red',   prio: 90 },
    windshear: { sound: 'windshear',  text: 'WINDSHEAR, WINDSHEAR, WINDSHEAR', color: 'red', prio: 100 },
    belowgs:   { sound: 'glideslope', text: 'GLIDESLOPE',            color: 'amber', prio: 30 },
    terr:      { sound: 'terrain',    text: 'CAUTION TERRAIN',       color: 'amber', prio: 84, terrainMsg: 'amber' },
    inop:      { sound: null,         text: 'GPWS INOP',             color: 'amber', prio: 5 }
  };

  /* ================= evaluation ================= */
  let results = {};
  const strongest = (a, b) => (a === 'red' || b === 'red') ? 'red' : (a || b);
  function evaluateAll() {
    const lamps = { pullup: false, windshear: false, belowgs: false, terr: false, inop: false };
    const nd = { terrainMsg: null, obstacleMsg: null, wsMsg: null, pwsSym: null, wsPfd: false, trafficMsg: null, trafficSym: null, tcasBand: null };
    const active = [];
    for (const m of MODES) {
      const r = m.evaluate(); results[m.id] = r;
      if (r.status === 'active') {
        active.push({ id: m.id, prio: PRIORITY[m.id], r });
        for (const k in r.lamps) lamps[k] = strongest(lamps[k], r.lamps[k]);
        for (const k of ['terrainMsg', 'obstacleMsg', 'wsMsg', 'pwsSym', 'trafficMsg', 'trafficSym'])
          if (r.nd[k]) nd[k] = strongest(nd[k], r.nd[k]);
        if (r.nd.tcasBand) nd.tcasBand = r.nd.tcasBand;
        if (r.nd.wsPfd) nd.wsPfd = true;
      }
    }
    for (const key in state.manual) {
      if (state.manual[key]) {
        const m = MANUAL[key];
        lamps[key] = strongest(lamps[key], m.color);
        if (m.terrainMsg) nd.terrainMsg = strongest(nd.terrainMsg, m.terrainMsg);
        active.push({ id: 'manual-' + key, prio: m.prio, r: { aural: m.text, sound: m.sound } });
      }
    }
    active.sort((a, b) => b.prio - a.prio);
    return { lamps, nd, active };
  }

  /* ================= aural scheduler (force-switch on change) ================= */
  let currentSound = null;
  function interrupt() { GpwsAudio.stop(); currentSound = null; }
  function auralTick(active) {
    if (!GpwsAudio.isEnabled() || state.testing) return;
    const top = active[0];
    if (!top) { currentSound = null; return; }
    setAuralText(top.r.aural);
    const s = top.r.sound;
    if (s !== currentSound) { currentSound = s; if (s) GpwsAudio.play(s, true); return; }
    if (s && !GpwsAudio.isBusy()) GpwsAudio.play(s, true); // repeat while active
  }

  /* ================= approach + DH callouts (FCOM 15.20.22) ================= */
  const GATES = [2500, 1000, 500, 100, 50, 40, 30, 20, 10];
  const GATE_TEXT = { 2500: 'TWENTY FIVE HUNDRED', 1000: 'ONE THOUSAND', 500: 'FIVE HUNDRED', 100: 'ONE HUNDRED', 50: 'FIFTY', 40: 'FORTY', 30: 'THIRTY', 20: 'TWENTY', 10: 'TEN' };
  const DH = 200;
  let prevRa = state.ra;
  function calloutTick() {
    if (state.ra < prevRa && GpwsAudio.isEnabled() && !state.testing) {
      if (prevRa > DH + 80 && state.ra <= DH + 80) { setAuralText('APPROACHING MINIMUMS'); GpwsAudio.play('approaching-minimums', true); }
      else if (prevRa > DH && state.ra <= DH) { setAuralText('MINIMUMS'); GpwsAudio.play('minimums', true); }
      else for (const g of GATES) if (prevRa > g && state.ra <= g) { setAuralText(GATE_TEXT[g]); GpwsAudio.play('alt-' + g, true); break; }
    }
    prevRa = state.ra;
  }

  /* ================= mode cards ================= */
  const board = $('mode-board'), cards = {};
  for (const m of MODES) {
    const el = document.createElement('div');
    el.className = 'mode-card'; el.tabIndex = 0;
    el.innerHTML = `<div class="mode-head"><span class="mode-name">${m.name}</span><span class="chip" data-chip></span></div>
      <p class="mode-env">${m.envelope}</p>
      <div class="mode-foot"><span class="mode-reason" data-reason></span><button class="play-btn" type="button" title="Play aural only">&#9654;</button></div>`;
    el.querySelector('.play-btn').addEventListener('click', e => {
      e.stopPropagation();
      if (!GpwsAudio.isEnabled()) { flashAudioBtn(); return; }
      interrupt(); setAuralText(m.name.split('—')[1] ? m.name.split('—')[1].trim() : 'demo');
      GpwsAudio.playSeq(m.demo, true);
    });
    el.addEventListener('click', () => selectMode(m.id));
    board.appendChild(el); cards[m.id] = el;
  }
  function renderCards() {
    for (const m of MODES) {
      const r = results[m.id], el = cards[m.id], chip = el.querySelector('[data-chip]');
      el.dataset.status = r.status; el.dataset.level = r.level || '';
      el.classList.toggle('selected', state.selectedMode === m.id);
      if (r.status === 'active') { chip.textContent = r.level === 'warning' ? 'WARNING' : 'CAUTION'; el.querySelector('[data-reason]').textContent = '“' + r.aural + '”'; }
      else { chip.textContent = r.status.toUpperCase(); el.querySelector('[data-reason]').textContent = r.reason; }
    }
  }

  /* ================= lamps ================= */
  function setLamp(id, val) {
    const el = $(id);
    el.classList.toggle('on', !!val);
    el.classList.toggle('flash', val === 'red');
    el.classList.toggle('force-amber', val === 'amber');
    el.classList.toggle('force-red', val === 'red');
  }
  function renderLamps(l) { setLamp('lamp-pullup', l.pullup); setLamp('lamp-windshear', l.windshear); setLamp('lamp-belowgs', l.belowgs); setLamp('lamp-terr', l.terr); setLamp('lamp-inop', l.inop); }
  const auralText = $('aural-text'); let auralClear = null;
  function setAuralText(t) { auralText.textContent = '“' + t + '”'; $('aural-strip').classList.add('live'); clearTimeout(auralClear); auralClear = setTimeout(() => { auralText.textContent = '—'; $('aural-strip').classList.remove('live'); }, 4000); }

  /* ================= PFD / ND static build ================= */
  function line(x1, y1, x2, y2, cls) { const l = document.createElementNS(NS, 'line'); l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2); if (cls) l.setAttribute('class', cls); return l; }
  function txt(x, y, s, cls, a) { const t = document.createElementNS(NS, 'text'); t.setAttribute('x', x); t.setAttribute('y', y); if (cls) t.setAttribute('class', cls); if (a) t.setAttribute('text-anchor', a); t.textContent = s; return t; }
  (function ladder() {
    const g = $('pfd-ladder'), pxDeg = 4;
    for (let p = -20; p <= 20; p += 10) { if (!p) continue; const y = CY - p * pxDeg, w = 18; g.appendChild(line(130 - w, y, 130 + w, y, 'pfd-pitch')); g.appendChild(txt(130 - w - 3, y + 3, Math.abs(p), 'pfd-pitchnum', 'end')); g.appendChild(txt(130 + w + 3, y + 3, Math.abs(p), 'pfd-pitchnum', 'start')); }
    for (let p = -25; p <= 25; p += 5) { if (p % 10 === 0) continue; const y = CY - p * pxDeg; g.appendChild(line(130 - 8, y, 130 + 8, y, 'pfd-pitch')); }
    for (let p = -22.5; p <= 22.5; p += 5) { const y = CY - p * pxDeg; g.appendChild(line(130 - 4, y, 130 + 4, y, 'pfd-pitch')); }
  })();
  const SPD_PX = 1.4;
  (function spdTape() { const g = $('pfd-spd-tape'); for (let v = 90; v <= 400; v += 10) { const y = -v * SPD_PX; g.appendChild(line(46, y, 52, y, 'tape-tick')); if (v % 20 === 0) g.appendChild(txt(44, y + 3, v, 'tape-num', 'end')); } })();
  const ALT_PX = 0.06;
  (function altTape() { const g = $('pfd-alt-tape'); for (let v = 0; v <= 2500; v += 100) { const y = -v * ALT_PX; g.appendChild(line(210, y, 216, y, 'tape-tick')); if (v % 500 === 0) g.appendChild(txt(218, y + 3, v, 'tape-num', 'start')); } })();
  (function bugs() {
    const sb = $('pfd-spd-bug'); sb.innerHTML = `<path d="M52 ${(-250 * SPD_PX)} l0 -4 l-5 0 l0 8 l5 0 l0 -4" fill="none" stroke="#e864d2" stroke-width="1.5"/>`;
    const ab = $('pfd-alt-bug'); ab.innerHTML = `<path d="M210 ${(-2500 * ALT_PX)} l0 -4 l5 0 l0 8 l-5 0 l0 -4" fill="none" stroke="#e864d2" stroke-width="1.5"/>`;
  })();
  (function compass() { const g = $('nd-compass'), cx = 130, cy = 250, R = 150; for (let a = -60; a <= 60; a += 10) { const rad = (a - 90) * Math.PI / 180, x1 = cx + Math.cos(rad) * R, y1 = cy + Math.sin(rad) * R, len = a % 30 === 0 ? 8 : 4; g.appendChild(line(x1, y1, cx + Math.cos(rad) * (R - len), cy + Math.sin(rad) * (R - len))); } })();

  const ndGreen = $('nd-terr-green'), ndAmber = $('nd-terr-amber'), ndRed = $('nd-terr-red'), ndSolid = $('nd-terr-solid');
  (function seedTerrain() {
    const rnd = n => Math.random() * n;
    function speckle(group, count, color, band, r0) { let s = ''; for (let i = 0; i < count; i++) { const a = -Math.PI * 0.83 + rnd(Math.PI * 0.66), r = band[0] + rnd(band[1] - band[0]), cx = 130 + Math.cos(a) * r, cy = 250 + Math.sin(a) * r; s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r0 + rnd(1.2)).toFixed(1)}" fill="${color}"/>`; } group.innerHTML = s; }
    speckle(ndGreen, 120, '#2f9e46', [40, 150], 0.8);
    speckle(ndAmber, 85, '#e0a300', [30, 125], 1.0);
    speckle(ndRed, 65, '#e23b30', [20, 100], 1.1);
  })();

  const pwsGroup = $('nd-pws');
  function pwsIconSvg() {
    let bands = ''; for (let i = 0; i < 3; i++) { const yy = -8 + i * 8, col = i % 2 === 0 ? '#e23b30' : '#111'; bands += `<path d="M-17 ${yy + 10} A22 15 0 0 1 17 ${yy + 10}" fill="none" stroke="${col}" stroke-width="4"/>`; }
    return bands + `<line x1="-20" y1="12" x2="-30" y2="20" stroke="#e0a300" stroke-width="1.5"/><line x1="20" y1="12" x2="30" y2="20" stroke="#e0a300" stroke-width="1.5"/><line x1="0" y1="-14" x2="0" y2="-24" stroke="#e0a300" stroke-width="1.5"/><text x="0" y="30" text-anchor="middle" fill="#e23b30" font-family="Barlow Semi Condensed" font-weight="700" font-size="9">W/S</text>`;
  }

  /* ================= per-frame render ================= */
  const pfdWarn = $('pfd-warn'), ndTerrMsg = $('nd-terrain-msg'), ndWsMsg = $('nd-ws-msg'), ndTrafMsg = $('nd-traffic-msg'), ndTerrMode = $('nd-terr-mode'), ndTraffic = $('nd-traffic'), tcasBand = $('pfd-tcas-band');
  function barberPole(group, vLo, vHi, kind) {
    let s = ''; const step = 6;
    for (let v = vLo; v < vHi; v += step) { const y = -(v + step) * SPD_PX, h = step * SPD_PX; const stripe = Math.round(v / step) % 2; const col = kind === 'amber' ? '#e0a300' : (stripe ? '#e23b30' : '#111'); s += `<rect x="46" y="${y.toFixed(1)}" width="7" height="${h.toFixed(1)}" fill="${col}"/>`; }
    group.innerHTML = s;
  }
  function renderDisplays(lamps, nd) {
    $('pfd-ias').textContent = state.ias; $('pfd-alt').textContent = state.ra; $('pfd-ra').textContent = state.ra;
    const mach = state.ias / 660; $('pfd-mach').textContent = mach > 0.40 ? '.' + Math.round(mach * 100) : '';
    $('pfd-vs').textContent = Math.abs(state.vs) > 400 ? (state.vs > 0 ? '+' : '') + state.vs : '';
    $('pfd-vs').setAttribute('fill', state.vs < -1500 ? '#ff5147' : '#c9d3df');
    const vy = Math.max(72, Math.min(208, CY - Math.max(-2500, Math.min(2500, state.vs)) * 0.028));
    const vp = $('pfd-vs-ptr'); vp.setAttribute('y1', vy); vp.setAttribute('y2', vy); vp.setAttribute('stroke', state.vs < -1500 ? '#ff5147' : '#e8edf4');
    $('pfd-spd-tape').setAttribute('transform', `translate(0 ${CY + state.ias * SPD_PX})`);
    $('pfd-spd-bug').setAttribute('transform', `translate(0 ${CY + state.ias * SPD_PX})`);
    $('pfd-alt-tape').setAttribute('transform', `translate(0 ${CY + state.ra * ALT_PX})`);
    $('pfd-alt-bug').setAttribute('transform', `translate(0 ${CY + state.ra * ALT_PX})`);
    const tr = `translate(0 ${CY + state.ias * SPD_PX})`; $('pfd-vmo').setAttribute('transform', tr); $('pfd-vmin').setAttribute('transform', tr);
    barberPole($('pfd-vmo'), VMO, 400, 'vmo');
    const mm = minMvr(), ss = stallSpd();
    barberPole($('pfd-vmin'), ss, mm, 'amber');
    $('pfd-vmin').innerHTML += `<rect x="46" y="${(-ss * SPD_PX).toFixed(1)}" width="7" height="${((ss - 60) * SPD_PX).toFixed(1)}" fill="#e23b30"/>`;
    const pitch = Math.max(-16, Math.min(16, state.vs / 260));
    $('pfd-horizon').setAttribute('transform', `rotate(${-state.bank} 130 ${CY}) translate(0 ${pitch * 4})`);
    $('pfd-bank').setAttribute('transform', `translate(130 ${CY}) rotate(${state.bank})`);
    // glideslope
    const gsY = Math.max(-46, Math.min(46, (state.ils ? state.gsDev : 0) * 18));
    const dia = $('pfd-gs-diamond'); dia.setAttribute('transform', `translate(0 ${-gsY})`);
    dia.setAttribute('stroke', lamps.belowgs ? '#ffb300' : '#e864d2'); dia.setAttribute('fill', lamps.belowgs ? '#ffb300' : 'none');
    $('pfd-gs-scale').setAttribute('stroke', lamps.belowgs ? '#ffb300' : '#c9d3df'); dia.classList.toggle('pfd-flash', !!lamps.belowgs);
    $('pfd-gs').style.opacity = state.ils ? 1 : 0.3;
    $('pfd-ra-box').setAttribute('stroke', state.ra < 50 ? '#ffb300' : '#0a0d12'); $('pfd-ra').setAttribute('fill', state.ra < 50 ? '#ffb300' : '#e8edf4');
    // TCAS IVSI bands
    if (nd.tcasBand) {
      const green = nd.tcasBand === 'climb' ? '<rect x="255" y="74" width="6" height="34" fill="#2fdd63"/>' : '<rect x="255" y="172" width="6" height="34" fill="#2fdd63"/>';
      const red = nd.tcasBand === 'climb' ? '<rect x="255" y="140" width="6" height="66" fill="#e23b30"/>' : '<rect x="255" y="74" width="6" height="66" fill="#e23b30"/>';
      tcasBand.innerHTML = green + red;
    } else tcasBand.innerHTML = '';
    // PFD GPWS annunciation
    let w = '';
    if (lamps.pullup) w += '<g class="pfd-flash"><rect x="96" y="158" width="68" height="20" rx="2" fill="#d31a10"/><text x="130" y="173" text-anchor="middle" class="pfd-warn-t">PULL UP</text></g>';
    if (nd.wsPfd) w += '<g class="pfd-flash"><rect x="84" y="158" width="92" height="20" rx="2" fill="#d31a10"/><text x="130" y="173" text-anchor="middle" class="pfd-warn-t">WINDSHEAR</text></g>';
    pfdWarn.innerHTML = w;

    // ---- ND ----
    const solidMsg = nd.terrainMsg || nd.obstacleMsg;
    if (state.terrInhibit) {
      ndGreen.setAttribute('opacity', '0'); ndAmber.setAttribute('opacity', '0'); ndRed.setAttribute('opacity', '0'); ndSolid.setAttribute('opacity', '0');
      ndTerrMode.textContent = 'TERR INHIBIT'; ndTerrMode.setAttribute('class', 'nd-mode inhibit');
    } else {
      ndGreen.setAttribute('opacity', '1');
      const warn = state.threat === 'warning', caut = state.threat === 'caution' || warn;
      ndAmber.setAttribute('opacity', caut ? '1' : '0'); ndRed.setAttribute('opacity', warn ? '1' : '0');
      if (solidMsg) { ndSolid.setAttribute('opacity', '1'); ndSolid.innerHTML = `<ellipse cx="130" cy="150" rx="46" ry="34" fill="${solidMsg === 'red' ? '#e23b30' : '#e0a300'}"/>`; }
      else ndSolid.setAttribute('opacity', '0');
      ndTerrMode.textContent = 'TERR'; ndTerrMode.setAttribute('class', 'nd-mode');
    }
    ndTerrMsg.textContent = nd.terrainMsg ? (nd.terrainMsg === 'red' ? 'TERRAIN' : 'CAUTION TERRAIN') : (nd.obstacleMsg ? (nd.obstacleMsg === 'red' ? 'OBSTACLE' : 'CAUTION OBSTACLE') : '');
    ndTerrMsg.setAttribute('class', 'nd-msg ' + ((solidMsg === 'red') ? 'msg-red' : 'msg-amber'));
    ndWsMsg.textContent = nd.wsMsg ? 'WINDSHEAR' : ''; ndWsMsg.setAttribute('class', 'nd-msg ' + (nd.wsMsg === 'red' ? 'msg-red' : 'msg-amber'));
    ndTrafMsg.textContent = nd.trafficMsg ? 'TRAFFIC' : ''; ndTrafMsg.setAttribute('class', 'nd-msg ' + (nd.trafficMsg === 'red' ? 'msg-red' : 'msg-amber'));
    // traffic symbol
    if (nd.trafficSym) { ndTraffic.setAttribute('opacity', '1'); const c = nd.trafficSym === 'red' ? '#e23b30' : '#e0a300'; ndTraffic.innerHTML = `<rect x="152" y="158" width="12" height="12" transform="rotate(45 158 164)" fill="${c}"/><text x="158" y="150" text-anchor="middle" fill="${c}" font-family="Barlow Semi Condensed" font-weight="700" font-size="8">+03</text>`; }
    else ndTraffic.setAttribute('opacity', '0');
    if (nd.pwsSym && !state.terrInhibit) { pwsGroup.setAttribute('opacity', '1'); pwsGroup.innerHTML = pwsIconSvg(); } else pwsGroup.setAttribute('opacity', '0');
  }

  /* ================= controls ================= */
  const fmt = { ra: v => v + ' ft', vs: v => (v > 0 ? '+' : '') + v + ' fpm', ias: v => v + ' kt', bank: v => v + '°', gsDev: v => v.toFixed(1) + ' dots', closure: v => v + ' fpm' };
  function setSlider(id, val) { const inp = $('in-' + id); if (inp) { inp.value = (id === 'gs' ? val * 10 : val); inp.dispatchEvent(new Event('input')); } }
  function bindSlider(id, key) { const inp = $('in-' + id), out = $('out-' + id); inp.addEventListener('input', () => { state[key] = (id === 'gs') ? Number(inp.value) / 10 : Number(inp.value); out.textContent = fmt[key](state[key]); }); out.textContent = fmt[key](state[key]); }
  bindSlider('ra', 'ra'); bindSlider('vs', 'vs'); bindSlider('ias', 'ias'); bindSlider('bank', 'bank'); bindSlider('gs', 'gsDev'); bindSlider('closure', 'closure');
  function setSeg(id, val) { const seg = $(id), b = seg.querySelector(`button[data-v="${val}"]`); if (b) seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); }
  function bindSeg(id, key, map) { $(id).addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); state[key] = map ? map(b.dataset.v) : b.dataset.v; }); }
  bindSeg('seg-phase', 'phase'); bindSeg('seg-landg', 'gear'); bindSeg('seg-flaps', 'flaps', v => Number(v)); bindSeg('seg-ils', 'ils', v => v === 'on');
  bindSeg('seg-threat', 'threat'); bindSeg('seg-obst', 'obstacle'); bindSeg('seg-shear', 'shear', v => v === 'on'); bindSeg('seg-pws', 'pws'); bindSeg('seg-tcas', 'tcas');
  document.querySelectorAll('#panel-state input').forEach(el => el.addEventListener('input', () => { state.selectedMode = null; interrupt(); }));
  document.querySelectorAll('#panel-state .seg').forEach(el => el.addEventListener('click', () => { state.selectedMode = null; interrupt(); }));
  function bindSwitch(id, key) { const sw = $(id); sw.addEventListener('click', () => { state[key] = !state[key]; sw.classList.toggle('inhibit', state[key]); sw.setAttribute('aria-pressed', String(state[key])); interrupt(); }); }
  bindSwitch('sw-flap', 'flapInhibit'); bindSwitch('sw-gear', 'gearInhibit'); bindSwitch('sw-terr', 'terrInhibit');

  document.querySelectorAll('.lamp[data-manual]').forEach(lamp => lamp.addEventListener('click', () => {
    const key = lamp.dataset.manual; state.manual[key] = !state.manual[key]; interrupt();
    if (state.manual[key] && !GpwsAudio.isEnabled()) flashAudioBtn();
  }));

  /* mode selection */
  const CLEAR = { ra: 2000, vs: 0, ias: 250, bank: 0, gsDev: 0, closure: 0, phase: 'cruise', gear: 'up', flaps: 0, ils: false, threat: 'none', obstacle: 'none', shear: false, pws: 'none', tcas: 'none', tcfDemo: false };
  function applyState(o) {
    const s = Object.assign({}, CLEAR, o);
    setSlider('ra', s.ra); setSlider('vs', s.vs); setSlider('ias', s.ias); setSlider('bank', s.bank); setSlider('gs', s.gsDev); setSlider('closure', s.closure);
    setSeg('seg-phase', s.phase); state.phase = s.phase; setSeg('seg-landg', s.gear); state.gear = s.gear;
    setSeg('seg-flaps', String(s.flaps)); state.flaps = s.flaps; setSeg('seg-ils', s.ils ? 'on' : 'off'); state.ils = s.ils;
    setSeg('seg-threat', s.threat); state.threat = s.threat; setSeg('seg-obst', s.obstacle); state.obstacle = s.obstacle;
    setSeg('seg-shear', s.shear ? 'on' : 'off'); state.shear = s.shear; setSeg('seg-pws', s.pws); state.pws = s.pws;
    setSeg('seg-tcas', s.tcas); state.tcas = s.tcas; state.tcfDemo = !!s.tcfDemo; prevRa = s.ra;
  }
  function selectMode(id) {
    interrupt();
    if (state.selectedMode === id) { state.selectedMode = null; for (const k in state.manual) state.manual[k] = false; applyState(CLEAR); return; }
    const m = MODES.find(x => x.id === id);
    for (const k in state.manual) state.manual[k] = false;
    applyState(m.scn); state.selectedMode = id;
    if (GpwsAudio.isEnabled()) setAuralText(m.name.split('—')[1].trim());
    const disp = $('panel-displays'); if (disp.querySelector('.panel-title').getAttribute('aria-expanded') === 'false') disp.querySelector('.panel-title').click();
  }

  document.querySelectorAll('.panel[data-collapse]').forEach(panel => {
    const btn = panel.querySelector('.panel-title'), body = panel.querySelector('.panel-body');
    body.hidden = btn.getAttribute('aria-expanded') === 'false';
    btn.addEventListener('click', () => { const open = btn.getAttribute('aria-expanded') === 'false'; btn.setAttribute('aria-expanded', String(open)); body.hidden = !open; });
  });

  const audioBtn = $('audio-toggle');
  audioBtn.addEventListener('click', () => {
    const on = !GpwsAudio.isEnabled(); GpwsAudio.setEnabled(on); if (!on) interrupt();
    audioBtn.classList.toggle('on', on); audioBtn.setAttribute('aria-pressed', String(on));
    audioBtn.querySelector('.audio-label').textContent = on ? 'AUDIO ON' : 'AUDIO OFF';
    audioBtn.querySelector('.audio-icon').innerHTML = on ? '&#128266;' : '&#128264;';
  });
  function flashAudioBtn() { audioBtn.classList.add('nudge'); setTimeout(() => audioBtn.classList.remove('nudge'), 900); }

  $('btn-joke').addEventListener('click', () => { if (!GpwsAudio.isEnabled()) { flashAudioBtn(); return; } interrupt(); setAuralText('WHOOP WHOOP — BULLSHIT'); GpwsAudio.play('bullshit', true); });

  $('btn-test').addEventListener('click', async () => {
    if (state.testing) return; if (!GpwsAudio.isEnabled()) { flashAudioBtn(); return; }
    interrupt(); state.testing = true;
    ['lamp-pullup', 'lamp-windshear', 'lamp-belowgs', 'lamp-terr', 'lamp-inop'].forEach(id => $(id).classList.add('on', 'test'));
    setAuralText('SELF TEST');
    await GpwsAudio.playSeq(['glideslope', 'pull-up', 'windshear', 'terrain-pull-up'], true);
    ['lamp-pullup', 'lamp-windshear', 'lamp-belowgs', 'lamp-terr', 'lamp-inop'].forEach(id => $(id).classList.remove('test'));
    state.testing = false;
  });

  document.querySelector('.scenario-btns').addEventListener('click', e => { if (e.target.closest('button[data-scn="reset"]')) { interrupt(); state.selectedMode = null; for (const k in state.manual) state.manual[k] = false; applyState(CLEAR); } });

  /* ================= main loop ================= */
  setInterval(() => {
    const { lamps, nd, active } = evaluateAll();
    if (state.testing) return;
    renderLamps(lamps); renderDisplays(lamps, nd); renderCards();
    document.querySelectorAll('.lamp[data-manual]').forEach(l => l.classList.toggle('armed-manual', state.manual[l.dataset.manual]));
    if (active.length) auralTick(active); else { currentSound = null; calloutTick(); }
  }, 150);

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
})();
