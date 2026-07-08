/* B737NG GPWS/EGPWS simulator — mode logic, inhibits, lamps, PFD/ND, aural scheduler.
   Envelopes are simplified approximations of the Honeywell MK V curves. */
(function () {
  'use strict';

  const $ = id => document.getElementById(id);

  /* ================= flight state ================= */

  const state = {
    ra: 2000, vs: 0, ias: 250, bank: 0, gsDev: 0, closure: 0,
    phase: 'cruise', gear: 'up', flaps: 0, ils: false,
    threat: 'none', shear: false,
    flapInhibit: false, gearInhibit: false, terrInhibit: false,
    gsCancelled: false, testing: false
  };

  const sink = () => Math.max(0, -state.vs);
  const landingFlaps = () => state.flaps >= 30 || state.flapInhibit;

  /* ================= mode definitions =================
     evaluate() returns { status, level, aural, sound, reason, + lamp flags } */

  const MODES = [
    {
      id: 'm1', name: 'Mode 1 — Excessive descent rate',
      envelope: 'RA 10–2450 ft. Barometric sink rate vs radio altitude. Outer boundary: “SINK RATE”, inner: “WHOOP WHOOP PULL UP”.',
      demo: ['pull-up'],
      evaluate() {
        if (state.ra < 10 || state.ra > 2450) return inh('outside 10–2450 ft RA envelope');
        const caution = Math.max(600, 1500 + 1.79 * (state.ra - 500));
        const warning = Math.max(1200, 2200 + 2.3 * (state.ra - 500));
        if (sink() > warning) return act('warning', 'WHOOP WHOOP — PULL UP', 'pull-up', { pullUp: true });
        if (sink() > caution) return act('caution', 'SINK RATE', 'sink-rate', { gndProx: true });
        return armed(`armed — sink ${Math.round(sink())} fpm < ~${Math.round(caution)} fpm boundary`);
      }
    },
    {
      id: 'm2', name: 'Mode 2 — Excessive terrain closure',
      envelope: 'RA 30–2450 ft. Radio-altitude closure rate. “TERRAIN TERRAIN” then “PULL UP”; in landing config downgrades to “TERRAIN” only (Mode 2B).',
      demo: ['terrain-pull-up'],
      evaluate() {
        if (state.ra < 30 || state.ra > 2450) return inh('outside 30–2450 ft RA envelope');
        const caution = 2000 + 1.2 * state.ra;
        const warning = 3000 + 1.6 * state.ra;
        const landingCfg = state.gear === 'down' && landingFlaps();
        if (state.closure > warning && !landingCfg)
          return act('warning', 'TERRAIN TERRAIN — PULL UP', 'terrain-pull-up', { pullUp: true, terr: true });
        if (state.closure > caution)
          return act('caution', 'TERRAIN TERRAIN', 'terrain', { gndProx: true, terr: true });
        return armed(`armed — closure ${state.closure} fpm < ~${Math.round(caution)} fpm boundary`);
      }
    },
    {
      id: 'm3', name: 'Mode 3 — Altitude loss after takeoff',
      envelope: 'Takeoff / go-around, RA 30–1500 ft. Descending before acquiring climb: “DON’T SINK”.',
      demo: ['dont-sink'],
      evaluate() {
        if (state.phase !== 'takeoff') return inh('only armed in takeoff / go-around phase');
        if (state.ra < 30 || state.ra > 1500) return inh('outside 30–1500 ft RA envelope');
        if (state.vs < -100) return act('caution', "DON'T SINK", 'dont-sink', { gndProx: true });
        return armed('armed — climbing or level');
      }
    },
    {
      id: 'm4a', name: 'Mode 4A — Unsafe terrain clearance, gear up',
      envelope: 'Cruise/approach, gear up, RA < 500 ft. < 190 kt: “TOO LOW GEAR”; faster: “TOO LOW TERRAIN” (floor rises to 1000 ft with speed).',
      demo: ['too-low-gear'],
      evaluate() {
        if (state.phase === 'takeoff') return inh('not armed in takeoff phase (Mode 4C region)');
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
      id: 'm4b', name: 'Mode 4B — Unsafe terrain clearance, flaps not landing',
      envelope: 'Gear down, flaps not landing, RA < 245 ft. < 159 kt: “TOO LOW FLAPS”; faster: “TOO LOW TERRAIN”. FLAP INHIBIT removes the flap alert.',
      demo: ['too-low-flaps'],
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
      envelope: 'ILS G/S tuned, gear down, RA 30–1000 ft, below beam. > 1.3 dots: soft “GLIDESLOPE”; > 2 dots below 300 ft: loud. Cancel with BELOW G/S P/RST.',
      demo: ['glideslope'],
      evaluate() {
        if (!state.ils) return inh('ILS glideslope not tuned');
        if (state.gear !== 'down') return inh('gear is up');
        if (state.ra < 30 || state.ra > 1000) return inh('outside 30–1000 ft RA envelope');
        if (state.gsCancelled) return inh('cancelled — BELOW G/S P/RST pressed');
        const below = -state.gsDev;
        if (below > 2 && state.ra < 300) return act('caution', 'GLIDESLOPE (hard)', 'glideslope', { belowGs: true });
        if (below > 1.3) return act('caution', 'GLIDESLOPE (soft)', 'glideslope', { belowGs: true, soft: true });
        return armed('armed — within 1.3 dots of the beam');
      }
    },
    {
      id: 'm6', name: 'Mode 6 — Bank angle & callouts',
      envelope: 'Advisory callouts: radio-altitude gates (2500…10) and “BANK ANGLE” beyond ~10° at 30 ft rising to ~45° above 150 ft.',
      demo: ['bank-angle'],
      evaluate() {
        if (state.ra < 5) return inh('below 5 ft RA');
        const limit = Math.min(45, 10 + state.ra * 0.23);
        if (state.bank > limit) return act('caution', 'BANK ANGLE', 'bank-angle', {});
        return armed(`armed — bank limit ~${Math.round(limit)}° at this RA`);
      }
    },
    {
      id: 'm7', name: 'Mode 7 — Windshear',
      envelope: 'Reactive windshear, RA 10–1500 ft, takeoff or approach only. Siren + “WINDSHEAR, WINDSHEAR, WINDSHEAR”, red WINDSHEAR annunciation.',
      demo: ['windshear'],
      evaluate() {
        if (state.phase === 'cruise') return inh('armed only in takeoff / approach');
        if (state.ra < 10 || state.ra > 1500) return inh('outside 10–1500 ft RA envelope');
        if (state.shear) return act('warning', 'WINDSHEAR ×3', 'windshear', { windshear: true });
        return armed('armed — no shear detected');
      }
    },
    {
      id: 'ta', name: 'EGPWS — Terrain look-ahead (TAD)',
      envelope: 'Predictive terrain-database alerting. Caution (~60 s): “CAUTION TERRAIN” + amber ND; warning (~30 s): “TERRAIN TERRAIN, PULL UP” + red. Killed by TERR INHIBIT.',
      demo: ['terrain', 'terrain-pull-up'],
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
      envelope: '“TOO LOW TERRAIN” when descending through the protection floor around the runway, regardless of configuration. Killed by TERR INHIBIT. (Demo only — needs a runway database.)',
      demo: ['too-low-terrain'],
      evaluate() {
        if (state.terrInhibit) return inh('TERR INHIBIT switch');
        return armed('armed — use ▶ to demo (no database in the sim)');
      }
    }
  ];

  function act(level, aural, sound, flags) {
    return Object.assign({ status: 'active', level, aural, sound }, flags || {});
  }
  function armed(reason) { return { status: 'armed', reason }; }
  function inh(reason) { return { status: 'inhibited', reason }; }

  // Aural priority — windshear beats pull-up beats everything else.
  const PRIORITY = { m7: 100, m1: 90, ta: 85, m2: 84, m4a: 60, m4b: 59, m3: 55, m6: 40, m5: 30, tcf: 20 };

  /* ================= evaluation ================= */

  let results = {};
  function evaluateAll() {
    const lamps = { pullUp: false, windshear: false, gndProx: false, belowGs: false, terr: false };
    const active = [];
    for (const m of MODES) {
      const r = m.evaluate();
      results[m.id] = r;
      if (r.status === 'active') {
        active.push({ id: m.id, r });
        if (r.pullUp) lamps.pullUp = true;
        if (r.windshear) lamps.windshear = true;
        if (r.gndProx) lamps.gndProx = true;
        if (r.belowGs) lamps.belowGs = true;
        if (r.terr) lamps.terr = true;
      }
    }
    active.sort((a, b) => PRIORITY[b.id] - PRIORITY[a.id]);
    return { lamps, active };
  }

  /* ================= aural scheduler ================= */

  let lastAuralEnd = 0;
  function auralTick(active) {
    if (!GpwsAudio.isEnabled() || GpwsAudio.isBusy() || state.testing) return;
    if (!active.length) return;
    if (performance.now() - lastAuralEnd < 400) return; // small gap between repeats
    const top = active[0];
    setAuralText(top.r.aural);
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
        if (prevRa > g && state.ra <= g) {
          setAuralText(GATE_TEXT[g]);
          GpwsAudio.play('alt-' + g);
          break;
        }
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
    el.innerHTML =
      `<div class="mode-head">
         <span class="mode-name">${m.name}</span>
         <span class="chip" data-chip></span>
       </div>
       <p class="mode-env">${m.envelope}</p>
       <div class="mode-foot">
         <span class="mode-reason" data-reason></span>
         <button class="play-btn" type="button" title="Demo aural">&#9654;</button>
       </div>`;
    el.querySelector('.play-btn').addEventListener('click', () => {
      if (!GpwsAudio.isEnabled()) { flashAudioBtn(); return; }
      setAuralText(m.name.split('—')[1] ? m.name.split('—')[1].trim() : 'demo');
      GpwsAudio.playSeq(m.demo, true);
    });
    board.appendChild(el);
    cards[m.id] = el;
  }

  function renderCards() {
    for (const m of MODES) {
      const r = results[m.id], el = cards[m.id];
      const chip = el.querySelector('[data-chip]');
      el.dataset.status = r.status;
      el.dataset.level = r.level || '';
      if (r.status === 'active') {
        chip.textContent = r.level === 'warning' ? 'WARNING' : 'CAUTION';
        el.querySelector('[data-reason]').textContent = '“' + r.aural + '”';
      } else {
        chip.textContent = r.status.toUpperCase();
        el.querySelector('[data-reason]').textContent = r.reason;
      }
    }
  }

  /* ================= lamps ================= */

  function setLamp(id, on, flash) {
    const el = $(id);
    el.classList.toggle('on', !!on);
    el.classList.toggle('flash', !!flash);
  }
  function renderLamps(lamps) {
    setLamp('lamp-pullup', lamps.pullUp, lamps.pullUp);
    setLamp('lamp-windshear', lamps.windshear, lamps.windshear);
    setLamp('lamp-gndprox', lamps.gndProx);
    setLamp('lamp-belowgs', lamps.belowGs || state.gsCancelled);
    $('lamp-belowgs').classList.toggle('cancelled', state.gsCancelled);
    setLamp('lamp-terr', lamps.terr);
  }

  const auralText = $('aural-text');
  let auralClear = null;
  function setAuralText(t) {
    auralText.textContent = '“' + t + '”';
    $('aural-strip').classList.add('live');
    clearTimeout(auralClear);
    auralClear = setTimeout(() => {
      auralText.textContent = '—';
      $('aural-strip').classList.remove('live');
    }, 4000);
  }

  /* ================= PFD / ND ================= */

  const ndAmber = $('nd-terr-amber'), ndRed = $('nd-terr-red'), ndGreen = $('nd-terr-green');
  const ndStatus = $('nd-status');
  // build a static green terrain speckle field once
  (function seedTerrain() {
    const rng = (n) => Math.random() * n;
    function speckle(group, count, color, band) {
      let s = '';
      for (let i = 0; i < count; i++) {
        const a = -Math.PI * 0.85 + rng(Math.PI * 0.7);
        const rmin = band[0], rmax = band[1];
        const r = rmin + rng(rmax - rmin);
        const cx = 100 + Math.cos(a) * r * 0.6;
        const cy = 206 + Math.sin(a) * r;
        s += `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(1 + rng(1.4)).toFixed(1)}" fill="${color}"/>`;
      }
      group.innerHTML = s;
    }
    speckle(ndGreen, 90, '#2f9e46', [40, 150]);
    speckle(ndAmber, 70, '#e0a300', [30, 120]);
    speckle(ndRed, 55, '#e23b30', [20, 95]);
  })();

  const pfdWarn = $('pfd-warn');
  function renderDisplays(lamps) {
    // PFD readouts + attitude
    $('pfd-ias').textContent = state.ias;
    $('pfd-ra').textContent = state.ra;
    $('pfd-vs').textContent = (state.vs > 0 ? '+' : '') + state.vs + ' fpm';
    $('pfd-vs').setAttribute('fill', state.vs < -1500 ? '#ff5147' : '#c9d3df');
    // horizon: pitch from vs (visual only), roll from bank
    const pitch = Math.max(-30, Math.min(30, state.vs / 200));
    $('pfd-horizon').setAttribute('transform', `translate(100 95) rotate(${-state.bank}) translate(-100 ${pitch}) `);
    // glideslope diamond: dots → pixels (±40 px = ±2.5 dots); below beam = diamond high
    const gsY = Math.max(-46, Math.min(46, (state.ils ? state.gsDev : 0) * 18));
    const dia = $('pfd-gs-diamond');
    dia.setAttribute('transform', `translate(0 ${gsY - 20})`);
    dia.setAttribute('fill', lamps.belowGs ? '#ffb300' : '#e864d2');
    // PFD warning boxes
    let w = '';
    if (lamps.pullUp) w += '<g class="pfd-flash"><rect x="58" y="70" width="84" height="24" rx="3" fill="#d31a10"/><text x="100" y="87" text-anchor="middle" class="pfd-warn-t">PULL UP</text></g>';
    else if (lamps.gndProx) w += '<rect x="54" y="70" width="92" height="22" rx="3" fill="#c98a00"/><text x="100" y="86" text-anchor="middle" class="pfd-warn-t">GND PROX</text>';
    if (lamps.windshear) w += '<g class="pfd-flash"><rect x="46" y="118" width="108" height="22" rx="3" fill="#d31a10"/><text x="100" y="134" text-anchor="middle" class="pfd-warn-t">WINDSHEAR</text></g>';
    pfdWarn.innerHTML = w;

    // ND terrain
    if (state.terrInhibit) {
      ndAmber.setAttribute('opacity', '0'); ndRed.setAttribute('opacity', '0');
      ndGreen.setAttribute('opacity', '0.25');
      ndStatus.textContent = 'TERR INHIBIT';
      ndStatus.setAttribute('class', 'nd-mode inhibit');
    } else {
      ndGreen.setAttribute('opacity', '1');
      const warn = state.threat === 'warning';
      const caut = state.threat === 'caution' || warn;
      ndAmber.setAttribute('opacity', caut ? '1' : '0');
      ndRed.setAttribute('opacity', warn ? '1' : '0');
      ndStatus.textContent = warn ? 'TERRAIN' : caut ? 'TERR' : 'TERR';
      ndStatus.setAttribute('class', 'nd-mode' + (warn ? ' warn' : caut ? ' caut' : ''));
    }
  }

  /* ================= controls ================= */

  function setSlider(id, key, val) {
    const inp = $('in-' + id);
    if (inp) { inp.value = val; inp.dispatchEvent(new Event('input')); }
  }
  function bindSlider(id, key, fmt) {
    const inp = $('in-' + id), out = $('out-' + id);
    inp.addEventListener('input', () => {
      state[key] = (id === 'gs') ? Number(inp.value) / 10 : Number(inp.value);
      out.textContent = fmt(state[key]);
    });
    out.textContent = fmt(state[key]);
  }
  bindSlider('ra', 'ra', v => v + ' ft');
  bindSlider('vs', 'vs', v => (v > 0 ? '+' : '') + v + ' fpm');
  bindSlider('ias', 'ias', v => v + ' kt');
  bindSlider('bank', 'bank', v => v + '°');
  bindSlider('closure', 'closure', v => v + ' fpm');
  bindSlider('gs', 'gsDev', v => v.toFixed(1) + ' dots');

  function setSeg(id, val) {
    const seg = $(id);
    const b = seg.querySelector(`button[data-v="${val}"]`);
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
  bindSeg('seg-phase', 'phase');
  bindSeg('seg-landg', 'gear');
  bindSeg('seg-flaps', 'flaps', v => Number(v));
  bindSeg('seg-ils', 'ils', v => v === 'on');
  bindSeg('seg-threat', 'threat');
  bindSeg('seg-shear', 'shear', v => v === 'on');

  function bindSwitch(id, key) {
    const sw = $(id);
    sw.addEventListener('click', () => {
      state[key] = !state[key];
      sw.classList.toggle('inhibit', state[key]);
      sw.setAttribute('aria-pressed', String(state[key]));
    });
  }
  bindSwitch('sw-flap', 'flapInhibit');
  bindSwitch('sw-gear', 'gearInhibit');
  bindSwitch('sw-terr', 'terrInhibit');

  $('lamp-belowgs').addEventListener('click', () => {
    if (state.ra < 1000) state.gsCancelled = !state.gsCancelled;
  });

  /* ---- collapsible panels ---- */
  document.querySelectorAll('.panel[data-collapse]').forEach(panel => {
    const btn = panel.querySelector('.panel-title');
    const body = panel.querySelector('.panel-body');
    const open = btn.getAttribute('aria-expanded') !== 'false';
    body.hidden = !open;
    btn.addEventListener('click', () => {
      const nowOpen = btn.getAttribute('aria-expanded') === 'false';
      btn.setAttribute('aria-expanded', String(nowOpen));
      body.hidden = !nowOpen;
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
  function flashAudioBtn() {
    audioBtn.classList.add('nudge');
    setTimeout(() => audioBtn.classList.remove('nudge'), 900);
  }

  /* ---- SYS TEST ---- */
  $('btn-test').addEventListener('click', async () => {
    if (state.testing) return;
    if (!GpwsAudio.isEnabled()) { flashAudioBtn(); return; }
    state.testing = true;
    ['lamp-pullup', 'lamp-windshear', 'lamp-gndprox', 'lamp-belowgs', 'lamp-terr']
      .forEach(id => $(id).classList.add('on', 'test'));
    setAuralText('SELF TEST');
    await GpwsAudio.playSeq(['glideslope', 'pull-up', 'windshear', 'terrain'], true);
    ['lamp-pullup', 'lamp-windshear', 'lamp-gndprox', 'lamp-belowgs', 'lamp-terr']
      .forEach(id => $(id).classList.remove('test'));
    state.testing = false;
  });

  /* ---- quick scenarios ---- */
  const SCENARIOS = {
    cfit:     { ra: 900, vs: -4500, ias: 280, phase: 'cruise', gear: 'up', flaps: 0, ils: false, threat: 'none', shear: false, gsDev: 0, closure: 0, bank: 0 },
    approach: { ra: 250, vs: -1200, ias: 150, phase: 'approach', gear: 'down', flaps: 15, ils: true, threat: 'none', shear: false, gsDev: -3, closure: 0, bank: 0 },
    terrain:  { ra: 1800, vs: -1000, ias: 260, phase: 'cruise', gear: 'up', flaps: 0, ils: false, threat: 'warning', shear: false, gsDev: 0, closure: 4500, bank: 0 },
    shear:    { ra: 400, vs: -800, ias: 160, phase: 'takeoff', gear: 'up', flaps: 5, ils: false, threat: 'none', shear: true, gsDev: 0, closure: 0, bank: 0 },
    reset:    { ra: 2000, vs: 0, ias: 250, phase: 'cruise', gear: 'up', flaps: 0, ils: false, threat: 'none', shear: false, gsDev: 0, closure: 0, bank: 0 }
  };
  function applyScenario(s) {
    state.gsCancelled = false;
    setSlider('ra', 'ra', s.ra); setSlider('vs', 'vs', s.vs); setSlider('ias', 'ias', s.ias);
    setSlider('bank', 'bank', s.bank); setSlider('closure', 'closure', s.closure);
    setSlider('gs', 'gsDev', s.gsDev * 10);
    setSeg('seg-phase', s.phase); state.phase = s.phase;
    setSeg('seg-landg', s.gear); state.gear = s.gear;
    setSeg('seg-flaps', String(s.flaps)); state.flaps = s.flaps;
    setSeg('seg-ils', s.ils ? 'on' : 'off'); state.ils = s.ils;
    setSeg('seg-threat', s.threat); state.threat = s.threat;
    setSeg('seg-shear', s.shear ? 'on' : 'off'); state.shear = s.shear;
    prevRa = s.ra;
  }
  document.querySelector('.scenario-btns').addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && SCENARIOS[b.dataset.scn]) applyScenario(SCENARIOS[b.dataset.scn]);
  });

  /* ================= main loop ================= */
  setInterval(() => {
    if (state.gsCancelled && (state.ra > 1000 || state.gear !== 'down')) state.gsCancelled = false;
    const { lamps, active } = evaluateAll();
    if (state.testing) return;
    renderLamps(lamps);
    renderDisplays(lamps);
    renderCards();
    calloutTick();
    auralTick(active);
  }, 250);

  /* ================= PWA ================= */
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js');
  }
})();
