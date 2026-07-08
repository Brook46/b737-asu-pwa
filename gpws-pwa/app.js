/* B737NG GPWS/EGPWS simulator — mode logic, inhibits, interactive glareshield,
   selectable modes, PFD/ND rendering, aural scheduler. Simplified envelopes. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);
  const NS = 'http://www.w3.org/2000/svg';

  /* ================= flight state ================= */

  const state = {
    ra: 2000, vs: 0, ias: 250, bank: 0, gsDev: 0, closure: 0,
    phase: 'cruise', gear: 'up', flaps: 0, ils: false,
    threat: 'none', shear: false, pws: 'none',
    flapInhibit: false, gearInhibit: false, terrInhibit: false,
    tcfDemo: false, testing: false,
    selectedMode: null,
    manual: { pullup: false, windshear: false, gndprox: false, belowgs: false, terr: false }
  };

  const sink = () => Math.max(0, -state.vs);
  const landingFlaps = () => state.flaps >= 30 || state.flapInhibit;

  /* ================= mode definitions ================= */

  const MODES = [
    {
      id: 'm1', name: 'Mode 1 — Excessive descent rate',
      envelope: 'RA 10–2450 ft. Sink rate vs radio altitude. Outer: “SINK RATE”, inner: “WHOOP WHOOP PULL UP”.',
      demo: ['pull-up'],
      scn: { ra: 700, vs: -5500, ias: 280, phase: 'cruise', gear: 'up', flaps: 0 },
      evaluate() {
        if (state.ra < 10 || state.ra > 2450) return inh('outside 10–2450 ft RA envelope');
        const caution = Math.max(600, 1500 + 1.79 * (state.ra - 500));
        const warning = Math.max(1200, 2200 + 2.3 * (state.ra - 500));
        if (sink() > warning) return act('warning', 'WHOOP WHOOP — PULL UP', 'pull-up', { pullUp: true });
        if (sink() > caution) return act('caution', 'SINK RATE', 'sink-rate', { gndProx: true });
        return armed(`armed — sink ${Math.round(sink())} fpm < ~${Math.round(caution)} fpm`);
      }
    },
    {
      id: 'm2', name: 'Mode 2 — Excessive terrain closure',
      envelope: 'RA 30–2450 ft. Radio-altitude closure. “TERRAIN TERRAIN” then “PULL UP”; landing config → “TERRAIN” only (2B).',
      demo: ['terrain-pull-up'],
      scn: { ra: 900, closure: 5200, vs: -2000, ias: 290, phase: 'cruise', gear: 'up', flaps: 0 },
      evaluate() {
        if (state.ra < 30 || state.ra > 2450) return inh('outside 30–2450 ft RA envelope');
        const caution = 2000 + 1.2 * state.ra;
        const warning = 3000 + 1.6 * state.ra;
        const landingCfg = state.gear === 'down' && landingFlaps();
        if (state.closure > warning && !landingCfg)
          return act('warning', 'TERRAIN TERRAIN — PULL UP', 'terrain-pull-up', { pullUp: true, terr: true });
        if (state.closure > caution)
          return act('caution', 'TERRAIN TERRAIN', 'terrain', { gndProx: true, terr: true });
        return armed(`armed — closure ${state.closure} fpm < ~${Math.round(caution)} fpm`);
      }
    },
    {
      id: 'm3', name: 'Mode 3 — Altitude loss after takeoff',
      envelope: 'Takeoff / go-around, RA 30–1500 ft. Descending before climb: “DON’T SINK”.',
      demo: ['dont-sink'],
      scn: { ra: 350, vs: -400, ias: 160, phase: 'takeoff', gear: 'up', flaps: 5 },
      evaluate() {
        if (state.phase !== 'takeoff') return inh('only armed in takeoff / go-around');
        if (state.ra < 30 || state.ra > 1500) return inh('outside 30–1500 ft RA envelope');
        if (state.vs < -100) return act('caution', "DON'T SINK", 'dont-sink', { gndProx: true });
        return armed('armed — climbing or level');
      }
    },
    {
      id: 'm4a', name: 'Mode 4A — Unsafe terrain clearance, gear up',
      envelope: 'Cruise/approach, gear up, RA < 500 ft. < 190 kt: “TOO LOW GEAR”; faster: “TOO LOW TERRAIN”.',
      demo: ['too-low-gear'],
      scn: { ra: 280, vs: -500, ias: 175, phase: 'approach', gear: 'up', flaps: 5 },
      evaluate() {
        if (state.phase === 'takeoff') return inh('not armed in takeoff (Mode 4C region)');
        if (state.gear === 'down') return inh('gear is down');
        if (state.gearInhibit) return inh('GEAR INHIBIT switch');
        const floor = state.ias < 190 ? 500 : Math.min(1000, 500 + (state.ias - 190) * 8.3);
        if (state.ra < floor)
          return state.ias < 190
            ? act('caution', 'TOO LOW GEAR', 'too-low-gear', { gndProx: true })
            : act('caution', 'TOO LOW TERRAIN', 'too-low-terrain', { gndProx: true });
        return armed(`armed — above ${Math.round(floor)} ft floor`);
      }
    },
    {
      id: 'm4b', name: 'Mode 4B — Unsafe terrain clearance, flaps',
      envelope: 'Gear down, flaps not landing, RA < 245 ft. < 159 kt: “TOO LOW FLAPS”; faster: “TOO LOW TERRAIN”.',
      demo: ['too-low-flaps'],
      scn: { ra: 180, vs: -600, ias: 150, phase: 'approach', gear: 'down', flaps: 5 },
      evaluate() {
        if (state.phase === 'takeoff') return inh('not armed in takeoff phase');
        if (state.gear !== 'down') return inh('gear is up (Mode 4A region)');
        if (state.flapInhibit) return inh('FLAP INHIBIT switch');
        if (state.flaps >= 30) return inh('flaps in landing position');
        const floor = state.ias < 159 ? 245 : Math.min(1000, 245 + (state.ias - 159) * 9.4);
        if (state.ra < floor)
          return state.ias < 159
            ? act('caution', 'TOO LOW FLAPS', 'too-low-flaps', { gndProx: true })
            : act('caution', 'TOO LOW TERRAIN', 'too-low-terrain', { gndProx: true });
        return armed(`armed — above ${Math.round(floor)} ft floor`);
      }
    },
    {
      id: 'm5', name: 'Mode 5 — Below glideslope',
      envelope: 'ILS G/S tuned, gear down, RA 30–1000 ft, below beam. > 1.3 dots: soft “GLIDESLOPE”; > 2 dots < 300 ft: loud.',
      demo: ['glideslope'],
      scn: { ra: 550, vs: -700, ias: 145, phase: 'approach', gear: 'down', flaps: 30, ils: true, gsDev: -2.6 },
      evaluate() {
        if (!state.ils) return inh('ILS glideslope not tuned');
        if (state.gear !== 'down') return inh('gear is up');
        if (state.ra < 30 || state.ra > 1000) return inh('outside 30–1000 ft RA envelope');
        const below = -state.gsDev;
        if (below > 2 && state.ra < 300) return act('caution', 'GLIDESLOPE (hard)', 'glideslope', { belowGs: true });
        if (below > 1.3) return act('caution', 'GLIDESLOPE (soft)', 'glideslope', { belowGs: true });
        return armed('armed — within 1.3 dots of the beam');
      }
    },
    {
      id: 'm6', name: 'Mode 6 — Bank angle & callouts',
      envelope: 'Advisory: RA callouts (2500…10) and “BANK ANGLE” beyond ~10° at 30 ft rising to ~45° above 150 ft.',
      demo: ['bank-angle'],
      scn: { ra: 120, vs: -200, ias: 150, phase: 'approach', gear: 'down', flaps: 30, bank: 38 },
      evaluate() {
        if (state.ra < 5) return inh('below 5 ft RA');
        const limit = Math.min(45, 10 + state.ra * 0.23);
        if (Math.abs(state.bank) > limit) return act('caution', 'BANK ANGLE', 'bank-angle', {});
        return armed(`armed — bank limit ~${Math.round(limit)}° at this RA`);
      }
    },
    {
      id: 'm7', name: 'Mode 7 — Reactive windshear',
      envelope: 'Reactive windshear, RA 10–1500 ft, takeoff or approach. Siren + “WINDSHEAR ×3”, red WINDSHEAR.',
      demo: ['windshear'],
      scn: { ra: 320, vs: -1500, ias: 150, phase: 'takeoff', gear: 'up', flaps: 5, shear: true },
      evaluate() {
        if (state.phase === 'cruise') return inh('armed only in takeoff / approach');
        if (state.ra < 10 || state.ra > 1500) return inh('outside 10–1500 ft RA envelope');
        if (state.shear) return act('warning', 'WINDSHEAR ×3', 'windshear', { windshear: true });
        return armed('armed — no shear detected');
      }
    },
    {
      id: 'pws', name: 'EGPWS — Predictive windshear (PWS)',
      envelope: 'Weather-radar look-ahead, RA < 1500 ft, takeoff/approach. Caution ahead: “MONITOR RADAR DISPLAY” (amber W/S). Warning: takeoff “WINDSHEAR AHEAD”, approach “GO AROUND — WINDSHEAR AHEAD” (red W/S). Killed by TERR INHIBIT.',
      demo: ['windshear'],
      scn: { ra: 450, vs: -200, ias: 150, phase: 'approach', gear: 'down', flaps: 15, pws: 'warning' },
      evaluate() {
        if (state.terrInhibit) return inh('TERR INHIBIT switch');
        if (state.phase === 'cruise') return inh('armed only in takeoff / approach');
        if (state.ra > 1500) return inh('above 1500 ft RA');
        if (state.pws === 'warning') {
          const call = state.phase === 'takeoff' ? 'WINDSHEAR AHEAD' : 'GO AROUND — WINDSHEAR AHEAD';
          return act('warning', call, 'windshear', { windshear: true, pwsIcon: 'red' });
        }
        if (state.pws === 'caution')
          return act('caution', 'MONITOR RADAR DISPLAY', null, { pwsIcon: 'amber' });
        return armed('armed — no windshear ahead on radar');
      }
    },
    {
      id: 'ta', name: 'EGPWS — Terrain look-ahead (TAD)',
      envelope: 'Predictive terrain-database alerting. Caution (~60 s): “CAUTION TERRAIN” + amber ND; warning (~30 s): “TERRAIN TERRAIN, PULL UP” + red. Killed by TERR INHIBIT.',
      demo: ['terrain', 'terrain-pull-up'],
      scn: { ra: 1600, vs: -1200, ias: 270, phase: 'cruise', gear: 'up', flaps: 0, threat: 'warning', closure: 3000 },
      evaluate() {
        if (state.terrInhibit) return inh('TERR INHIBIT switch');
        if (state.threat === 'warning')
          return act('warning', 'TERRAIN TERRAIN — PULL UP', 'terrain-pull-up', { pullUp: true, terr: true });
        if (state.threat === 'caution')
          return act('caution', 'CAUTION TERRAIN', 'terrain', { terr: true });
        return armed('armed — no database threat ahead');
      }
    },
    {
      id: 'tcf', name: 'EGPWS — Terrain clearance floor (TCF)',
      envelope: '“TOO LOW TERRAIN” when descending through the protection floor around the runway, in any configuration. Killed by TERR INHIBIT.',
      demo: ['too-low-terrain'],
      scn: { ra: 220, vs: -800, ias: 180, phase: 'approach', gear: 'up', flaps: 15, tcfDemo: true },
      evaluate() {
        if (state.terrInhibit) return inh('TERR INHIBIT switch');
        if (state.tcfDemo) return act('caution', 'TOO LOW TERRAIN', 'too-low-terrain', { gndProx: true, terr: true });
        return armed('armed — select to demo the runway floor');
      }
    }
  ];

  function act(level, aural, sound, flags) {
    return Object.assign({ status: 'active', level, aural, sound }, flags || {});
  }
  function armed(reason) { return { status: 'armed', reason }; }
  function inh(reason) { return { status: 'inhibited', reason }; }

  const PRIORITY = { m7: 100, pws: 95, m1: 90, ta: 85, m2: 84, m4a: 60, m4b: 59, m3: 55, m6: 40, m5: 30, tcf: 20 };

  // manual glareshield lamps → representative aural + priority
  const MANUAL = {
    pullup:    { sound: 'pull-up',    text: 'WHOOP WHOOP — PULL UP', lamp: 'pullUp',   prio: 90 },
    windshear: { sound: 'windshear',  text: 'WINDSHEAR ×3',          lamp: 'windshear', prio: 100 },
    gndprox:   { sound: 'sink-rate',  text: 'SINK RATE',             lamp: 'gndProx',  prio: 60 },
    belowgs:   { sound: 'glideslope', text: 'GLIDESLOPE',            lamp: 'belowGs',  prio: 30 },
    terr:      { sound: 'terrain',    text: 'TERRAIN TERRAIN',       lamp: 'terr',     prio: 84 }
  };

  /* ================= evaluation ================= */

  let results = {};
  function evaluateAll() {
    const lamps = { pullUp: false, windshear: false, gndProx: false, belowGs: false, terr: false };
    let pwsIcon = null;
    const active = [];
    for (const m of MODES) {
      const r = m.evaluate();
      results[m.id] = r;
      if (r.status === 'active') {
        active.push({ id: m.id, prio: PRIORITY[m.id], r });
        if (r.pullUp) lamps.pullUp = true;
        if (r.windshear) lamps.windshear = true;
        if (r.gndProx) lamps.gndProx = true;
        if (r.belowGs) lamps.belowGs = true;
        if (r.terr) lamps.terr = true;
        if (r.pwsIcon) pwsIcon = r.pwsIcon;
      }
    }
    // manual glareshield overrides
    for (const key in state.manual) {
      if (state.manual[key]) {
        const m = MANUAL[key];
        lamps[m.lamp] = true;
        active.push({ id: 'manual-' + key, prio: m.prio, r: { aural: m.text, sound: m.sound } });
      }
    }
    active.sort((a, b) => b.prio - a.prio);
    return { lamps, active, pwsIcon };
  }

  /* ================= aural scheduler ================= */

  let lastAuralEnd = 0;
  function auralTick(active) {
    if (!GpwsAudio.isEnabled() || GpwsAudio.isBusy() || state.testing) return;
    if (!active.length) return;
    if (performance.now() - lastAuralEnd < 400) return;
    const top = active[0];
    setAuralText(top.r.aural);
    if (!top.r.sound) { lastAuralEnd = performance.now(); return; }
    GpwsAudio.play(top.r.sound).finally(() => { lastAuralEnd = performance.now(); });
  }

  /* ================= altitude callouts ================= */

  const GATES = [2500, 1000, 500, 400, 300, 200, 100, 50, 40, 30, 20, 10];
  const GATE_TEXT = { 2500: 'TWENTY FIVE HUNDRED', 1000: 'ONE THOUSAND', 500: 'FIVE HUNDRED',
    400: 'FOUR HUNDRED', 300: 'THREE HUNDRED', 200: 'TWO HUNDRED', 100: 'ONE HUNDRED',
    50: 'FIFTY', 40: 'FORTY', 30: 'THIRTY', 20: 'TWENTY', 10: 'TEN' };
  let prevRa = state.ra;
  function calloutTick() {
    if (state.ra < prevRa && GpwsAudio.isEnabled() && !GpwsAudio.isBusy() && !state.testing) {
      for (const g of GATES) {
        if (prevRa > g && state.ra <= g) { setAuralText(GATE_TEXT[g]); GpwsAudio.play('alt-' + g); break; }
      }
    }
    prevRa = state.ra;
  }

  /* ================= mode cards ================= */

  const board = $('mode-board');
  const cards = {};
  for (const m of MODES) {
    const el = document.createElement('div');
    el.className = 'mode-card';
    el.tabIndex = 0;
    el.innerHTML =
      `<div class="mode-head">
         <span class="mode-name">${m.name}</span>
         <span class="chip" data-chip></span>
       </div>
       <p class="mode-env">${m.envelope}</p>
       <div class="mode-foot">
         <span class="mode-reason" data-reason></span>
         <button class="play-btn" type="button" title="Play aural only">&#9654;</button>
       </div>`;
    el.querySelector('.play-btn').addEventListener('click', e => {
      e.stopPropagation();
      if (!GpwsAudio.isEnabled()) { flashAudioBtn(); return; }
      setAuralText(m.name.split('—')[1] ? m.name.split('—')[1].trim() : 'demo');
      GpwsAudio.playSeq(m.demo, true);
    });
    el.addEventListener('click', () => selectMode(m.id));
    board.appendChild(el);
    cards[m.id] = el;
  }

  function renderCards() {
    for (const m of MODES) {
      const r = results[m.id], el = cards[m.id];
      const chip = el.querySelector('[data-chip]');
      el.dataset.status = r.status;
      el.dataset.level = r.level || '';
      el.classList.toggle('selected', state.selectedMode === m.id);
      if (r.status === 'active') {
        chip.textContent = r.level === 'warning' ? 'WARNING' : 'CAUTION';
        el.querySelector('[data-reason]').textContent = '“' + r.aural + '”';
      } else {
        chip.textContent = r.status.toUpperCase();
        el.querySelector('[data-reason]').textContent = r.reason;
      }
    }
  }

  /* ================= lamps + aural strip ================= */

  function setLamp(id, on, flash) {
    const el = $(id);
    el.classList.toggle('on', !!on);
    el.classList.toggle('flash', !!flash);
  }
  function renderLamps(lamps) {
    setLamp('lamp-pullup', lamps.pullUp, lamps.pullUp);
    setLamp('lamp-windshear', lamps.windshear, lamps.windshear);
    setLamp('lamp-gndprox', lamps.gndProx);
    setLamp('lamp-belowgs', lamps.belowGs);
    setLamp('lamp-terr', lamps.terr);
  }

  const auralText = $('aural-text');
  let auralClear = null;
  function setAuralText(t) {
    auralText.textContent = '“' + t + '”';
    $('aural-strip').classList.add('live');
    clearTimeout(auralClear);
    auralClear = setTimeout(() => { auralText.textContent = '—'; $('aural-strip').classList.remove('live'); }, 4000);
  }

  /* ================= PFD / ND static build ================= */

  function line(x1, y1, x2, y2, cls) {
    const l = document.createElementNS(NS, 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1);
    l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    if (cls) l.setAttribute('class', cls);
    return l;
  }
  function text(x, y, str, cls, anchor) {
    const t = document.createElementNS(NS, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    if (cls) t.setAttribute('class', cls);
    if (anchor) t.setAttribute('text-anchor', anchor);
    t.textContent = str;
    return t;
  }

  // pitch ladder (in horizon group coords, centre 130,130, 4px per degree)
  (function ladder() {
    const g = $('pfd-ladder');
    const pxDeg = 4;
    for (let p = -20; p <= 20; p += 10) {
      if (p === 0) continue;
      const y = 130 - p * pxDeg;
      const w = 18;
      g.appendChild(line(130 - w, y, 130 + w, y, 'pfd-pitch'));
      g.appendChild(text(130 - w - 3, y + 3, Math.abs(p), 'pfd-pitchnum', 'end'));
      g.appendChild(text(130 + w + 3, y + 3, Math.abs(p), 'pfd-pitchnum', 'start'));
    }
    for (let p = -25; p <= 25; p += 5) {
      if (p % 10 === 0) continue;
      const y = 130 - p * pxDeg;
      g.appendChild(line(130 - 8, y, 130 + 8, y, 'pfd-pitch'));
    }
  })();

  // speed tape: value → y in tape group (higher speed = up). 1.4 px/kt.
  const SPD_PX = 1.4;
  (function spdTape() {
    const g = $('pfd-spd-tape');
    for (let v = 100; v <= 340; v += 10) {
      const y = -v * SPD_PX;
      g.appendChild(line(48, y, 54, y, 'tape-tick'));
      if (v % 20 === 0) g.appendChild(text(44, y + 3, v, 'tape-num', 'end'));
    }
  })();
  // altitude (radio) tape: 0.06 px/ft.
  const ALT_PX = 0.06;
  (function altTape() {
    const g = $('pfd-alt-tape');
    for (let v = 0; v <= 2500; v += 100) {
      const y = -v * ALT_PX;
      g.appendChild(line(206, y, 212, y, 'tape-tick'));
      if (v % 500 === 0) g.appendChild(text(216, y + 3, v, 'tape-num', 'start'));
    }
  })();
  // ND compass arc ticks, centred at own-ship (130,250), radius 150.
  (function compass() {
    const g = $('nd-compass');
    const cx = 130, cy = 250, R = 150;
    for (let a = -60; a <= 60; a += 10) {
      const rad = (a - 90) * Math.PI / 180;
      const x1 = cx + Math.cos(rad) * R, y1 = cy + Math.sin(rad) * R;
      const len = a % 30 === 0 ? 8 : 4;
      const x2 = cx + Math.cos(rad) * (R - len), y2 = cy + Math.sin(rad) * (R - len);
      g.appendChild(line(x1, y1, x2, y2));
    }
  })();

  // terrain speckle
  const ndGreen = $('nd-terr-green'), ndAmber = $('nd-terr-amber'), ndRed = $('nd-terr-red');
  (function seedTerrain() {
    const rnd = n => Math.random() * n;
    function speckle(group, count, color, band) {
      let s = '';
      for (let i = 0; i < count; i++) {
        const a = -Math.PI * 0.83 + rnd(Math.PI * 0.66);
        const r = band[0] + rnd(band[1] - band[0]);
        const cx = 130 + Math.cos(a) * r, cy = 250 + Math.sin(a) * r;
        s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(1 + rnd(1.5)).toFixed(1)}" fill="${color}"/>`;
      }
      group.innerHTML = s;
    }
    speckle(ndGreen, 110, '#2f9e46', [40, 150]);
    speckle(ndAmber, 80, '#e0a300', [30, 120]);
    speckle(ndRed, 60, '#e23b30', [20, 95]);
  })();

  const pwsGroup = $('nd-pws');
  function pwsIconSvg(color) {
    // simplified PWS windshear icon: nested arcs in red/black bands + label
    return `<path d="M-16 8 A20 14 0 0 1 16 8" fill="none" stroke="${color}" stroke-width="4"/>
            <path d="M-10 2 A13 9 0 0 1 10 2" fill="none" stroke="${color}" stroke-width="4"/>
            <path d="M-16 -6 A20 14 0 0 0 16 -6" fill="none" stroke="${color}" stroke-width="4"/>
            <text x="0" y="-14" text-anchor="middle" fill="${color}" font-family="Barlow Semi Condensed" font-weight="700" font-size="9">W/S</text>`;
  }

  /* ================= PFD / ND per-frame render ================= */

  const pfdWarn = $('pfd-warn'), ndStatus = $('nd-status');
  function renderDisplays(lamps, pwsIcon) {
    // tapes + readouts
    $('pfd-ias').textContent = state.ias;
    $('pfd-ra').textContent = state.ra;
    $('pfd-vs').textContent = (state.vs > 0 ? '+' : '') + state.vs;
    $('pfd-vs').setAttribute('fill', state.vs < -1500 ? '#ff5147' : '#c9d3df');
    $('pfd-spd-tape').setAttribute('transform', `translate(0 ${130 + state.ias * SPD_PX})`);
    $('pfd-alt-tape').setAttribute('transform', `translate(0 ${130 + state.ra * ALT_PX})`);
    // attitude: pitch from vs (visual only, capped), roll from bank
    const pitch = Math.max(-16, Math.min(16, state.vs / 260));
    $('pfd-horizon').setAttribute('transform', `rotate(${-state.bank} 130 130) translate(0 ${pitch * 4})`);
    $('pfd-bank').setAttribute('transform', `translate(130 130) rotate(${state.bank})`);
    // glideslope diamond
    const gsY = Math.max(-46, Math.min(46, (state.ils ? state.gsDev : 0) * 18));
    const dia = $('pfd-gs-diamond');
    dia.setAttribute('transform', `translate(0 ${-gsY})`);
    dia.setAttribute('stroke', lamps.belowGs ? '#ffb300' : '#e864d2');
    dia.setAttribute('fill', lamps.belowGs ? '#ffb300' : 'none');

    // PFD warnings
    let w = '';
    if (lamps.pullUp) w += '<g class="pfd-flash"><rect x="92" y="96" width="76" height="22" rx="3" fill="#d31a10"/><text x="130" y="112" text-anchor="middle" class="pfd-warn-t">PULL UP</text></g>';
    else if (lamps.gndProx) w += '<rect x="86" y="96" width="88" height="20" rx="3" fill="#c98a00"/><text x="130" y="111" text-anchor="middle" class="pfd-warn-t">GND PROX</text>';
    if (lamps.windshear) w += '<g class="pfd-flash"><rect x="80" y="146" width="100" height="22" rx="3" fill="#d31a10"/><text x="130" y="162" text-anchor="middle" class="pfd-warn-t">WINDSHEAR</text></g>';
    pfdWarn.innerHTML = w;

    // ND terrain + PWS
    if (state.terrInhibit) {
      ndAmber.setAttribute('opacity', '0'); ndRed.setAttribute('opacity', '0');
      ndGreen.setAttribute('opacity', '0.25');
      ndStatus.textContent = 'TERR INHIBIT'; ndStatus.setAttribute('class', 'nd-mode inhibit');
    } else {
      ndGreen.setAttribute('opacity', '1');
      const warn = state.threat === 'warning', caut = state.threat === 'caution' || warn;
      ndAmber.setAttribute('opacity', caut ? '1' : '0');
      ndRed.setAttribute('opacity', warn ? '1' : '0');
      ndStatus.textContent = warn ? 'TERRAIN' : 'TERR';
      ndStatus.setAttribute('class', 'nd-mode' + (warn ? ' warn' : caut ? ' caut' : ''));
    }
    // PWS icon on ND
    if (pwsIcon && !state.terrInhibit) {
      pwsGroup.setAttribute('opacity', '1');
      pwsGroup.innerHTML = pwsIconSvg(pwsIcon === 'red' ? '#e23b30' : '#e0a300');
      pwsGroup.classList.toggle('pfd-flash', pwsIcon === 'red');
    } else {
      pwsGroup.setAttribute('opacity', '0');
      pwsGroup.classList.remove('pfd-flash');
    }
  }

  /* ================= controls ================= */

  const fmt = {
    ra: v => v + ' ft', vs: v => (v > 0 ? '+' : '') + v + ' fpm', ias: v => v + ' kt',
    bank: v => v + '°', gsDev: v => v.toFixed(1) + ' dots', closure: v => v + ' fpm'
  };
  function setSlider(id, val) {
    const inp = $('in-' + id);
    if (inp) { inp.value = (id === 'gs' ? val * 10 : val); inp.dispatchEvent(new Event('input')); }
  }
  function bindSlider(id, key) {
    const inp = $('in-' + id), out = $('out-' + id);
    inp.addEventListener('input', () => {
      state[key] = (id === 'gs') ? Number(inp.value) / 10 : Number(inp.value);
      out.textContent = fmt[key](state[key]);
    });
    out.textContent = fmt[key](state[key]);
  }
  bindSlider('ra', 'ra'); bindSlider('vs', 'vs'); bindSlider('ias', 'ias');
  bindSlider('bank', 'bank'); bindSlider('gs', 'gsDev'); bindSlider('closure', 'closure');

  function setSeg(id, val) {
    const seg = $(id), b = seg.querySelector(`button[data-v="${val}"]`);
    if (b) seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
  }
  function bindSeg(id, key, map) {
    const seg = $(id);
    seg.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      seg.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      state[key] = map ? map(b.dataset.v) : b.dataset.v;
    });
  }
  bindSeg('seg-phase', 'phase'); bindSeg('seg-landg', 'gear');
  bindSeg('seg-flaps', 'flaps', v => Number(v)); bindSeg('seg-ils', 'ils', v => v === 'on');
  bindSeg('seg-threat', 'threat'); bindSeg('seg-shear', 'shear', v => v === 'on');
  bindSeg('seg-pws', 'pws');

  // manual flight-state edits clear the selected-mode highlight
  document.querySelectorAll('#panel-state input, #panel-state .seg').forEach(el =>
    el.addEventListener('input', () => { state.selectedMode = null; }));
  document.querySelectorAll('#panel-state .seg').forEach(el =>
    el.addEventListener('click', () => { state.selectedMode = null; }));

  function bindSwitch(id, key) {
    const sw = $(id);
    sw.addEventListener('click', () => {
      state[key] = !state[key];
      sw.classList.toggle('inhibit', state[key]);
      sw.setAttribute('aria-pressed', String(state[key]));
    });
  }
  bindSwitch('sw-flap', 'flapInhibit'); bindSwitch('sw-gear', 'gearInhibit'); bindSwitch('sw-terr', 'terrInhibit');

  /* ---- interactive glareshield lamps ---- */
  document.querySelectorAll('.lamp[data-manual]').forEach(lamp => {
    lamp.addEventListener('click', () => {
      const key = lamp.dataset.manual;
      state.manual[key] = !state.manual[key];
      if (state.manual[key] && !GpwsAudio.isEnabled()) flashAudioBtn();
    });
  });

  /* ---- mode selection ---- */
  const CLEAR = { ra: 2000, vs: 0, ias: 250, bank: 0, gsDev: 0, closure: 0,
    phase: 'cruise', gear: 'up', flaps: 0, ils: false, threat: 'none', shear: false, pws: 'none', tcfDemo: false };
  function applyState(o) {
    const s = Object.assign({}, CLEAR, o);
    setSlider('ra', s.ra); setSlider('vs', s.vs); setSlider('ias', s.ias);
    setSlider('bank', s.bank); setSlider('gs', s.gsDev); setSlider('closure', s.closure);
    setSeg('seg-phase', s.phase); state.phase = s.phase;
    setSeg('seg-landg', s.gear); state.gear = s.gear;
    setSeg('seg-flaps', String(s.flaps)); state.flaps = s.flaps;
    setSeg('seg-ils', s.ils ? 'on' : 'off'); state.ils = s.ils;
    setSeg('seg-threat', s.threat); state.threat = s.threat;
    setSeg('seg-shear', s.shear ? 'on' : 'off'); state.shear = s.shear;
    setSeg('seg-pws', s.pws); state.pws = s.pws;
    state.tcfDemo = !!s.tcfDemo;
    prevRa = s.ra;
  }
  function selectMode(id) {
    if (state.selectedMode === id) { // toggle off → reset
      state.selectedMode = null;
      for (const k in state.manual) state.manual[k] = false;
      applyState(CLEAR);
      return;
    }
    const m = MODES.find(x => x.id === id);
    for (const k in state.manual) state.manual[k] = false;
    applyState(m.scn);
    state.selectedMode = id;
    if (GpwsAudio.isEnabled()) { setAuralText(m.name.split('—')[1].trim()); }
    // bring the displays into view so the effect is visible
    const disp = $('panel-displays');
    if (disp.querySelector('.panel-title').getAttribute('aria-expanded') === 'false')
      disp.querySelector('.panel-title').click();
  }

  /* ---- collapsible panels ---- */
  document.querySelectorAll('.panel[data-collapse]').forEach(panel => {
    const btn = panel.querySelector('.panel-title'), body = panel.querySelector('.panel-body');
    body.hidden = btn.getAttribute('aria-expanded') === 'false';
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') === 'false';
      btn.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
    });
  });

  /* ---- audio enable ---- */
  const audioBtn = $('audio-toggle');
  audioBtn.addEventListener('click', () => {
    const on = !GpwsAudio.isEnabled();
    GpwsAudio.setEnabled(on);
    audioBtn.classList.toggle('on', on);
    audioBtn.setAttribute('aria-pressed', String(on));
    audioBtn.querySelector('.audio-label').textContent = on ? 'AUDIO ON' : 'AUDIO OFF';
    audioBtn.querySelector('.audio-icon').innerHTML = on ? '&#128266;' : '&#128264;';
  });
  function flashAudioBtn() { audioBtn.classList.add('nudge'); setTimeout(() => audioBtn.classList.remove('nudge'), 900); }

  /* ---- SYS TEST ---- */
  $('btn-test').addEventListener('click', async () => {
    if (state.testing) return;
    if (!GpwsAudio.isEnabled()) { flashAudioBtn(); return; }
    state.testing = true;
    ['lamp-pullup', 'lamp-windshear', 'lamp-gndprox', 'lamp-belowgs', 'lamp-terr'].forEach(id => $(id).classList.add('on', 'test'));
    setAuralText('SELF TEST');
    await GpwsAudio.playSeq(['glideslope', 'pull-up', 'windshear', 'terrain'], true);
    ['lamp-pullup', 'lamp-windshear', 'lamp-gndprox', 'lamp-belowgs', 'lamp-terr'].forEach(id => $(id).classList.remove('test'));
    state.testing = false;
  });

  /* ---- reset ---- */
  document.querySelector('.scenario-btns').addEventListener('click', e => {
    if (e.target.closest('button[data-scn="reset"]')) {
      state.selectedMode = null;
      for (const k in state.manual) state.manual[k] = false;
      applyState(CLEAR);
    }
  });

  /* ================= main loop ================= */
  setInterval(() => {
    const { lamps, active, pwsIcon } = evaluateAll();
    if (state.testing) return;
    renderLamps(lamps);
    renderDisplays(lamps, pwsIcon);
    renderCards();
    // sync manual lamp button styling
    document.querySelectorAll('.lamp[data-manual]').forEach(l =>
      l.classList.toggle('armed-manual', state.manual[l.dataset.manual]));
    calloutTick();
    auralTick(active);
  }, 200);

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
})();
