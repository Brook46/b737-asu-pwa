// rto.js — takeoff malfunction drill (rejected takeoff decision). A normal
// takeoff roll; somewhere between the start of the roll and V2 one malfunction
// is injected into the real systems (fire, engine failure, predictive
// windshear, a master caution system failure — or nothing).
// Only two big buttons are left on the screen: STOP and CONTINUE. The flight
// sim then flies the RTO (idle, reversers, max braking, speedbrakes) or the
// takeoff, and a debrief shows what failed, at what speed, the decision and
// whether it matches the rejected-takeoff maneuver (QRH MAN.1.2):
//   below 80 kt — reject for any of the listed items;
//   80 kt to V1 — reject only for fire / fire warning, engine failure,
//                 predictive windshear warning, unsafe or unable to fly;
//   above V1   — continue.
// A study aid: the decision rules are simplified to the listed items.

// Only malfunctions you can see in the cockpit: each one lights FIRE WARN or
// MASTER CAUTION (with its annunciator), and an engine failure also shows
// ENG FAIL and the N1 / N2 run-down. (Checked against the systems' logic.)
const MALF = [
  { id: 'fire1', name: 'Engine 1 fire', cat: 'v1', cue: 'bell', sys: 'fire', key: 'fire1', shows: 'FIRE WARN · bell · ENG 1 fire switch' },
  { id: 'fire2', name: 'Engine 2 fire', cat: 'v1', cue: 'bell', sys: 'fire', key: 'fire2', shows: 'FIRE WARN · bell · ENG 2 fire switch' },
  { id: 'apuFire', name: 'APU fire', cat: 'v1', cue: 'bell', sys: 'fire', key: 'apuFire', shows: 'FIRE WARN · bell · APU fire switch' },
  { id: 'wheelWell', name: 'Wheel well fire', cat: 'v1', cue: 'bell', sys: 'fire', key: 'wheelWell', shows: 'FIRE WARN · bell · WHEEL WELL' },
  { id: 'cargo', name: 'Forward cargo fire', cat: 'v1', cue: 'bell', sys: 'fire', key: 'cargoFwd', shows: 'FIRE WARN · bell · cargo FWD light' },
  { id: 'eng1', name: 'Engine 1 failure', cat: 'v1', sys: 'engines', key: 'flameout1', engine: true, shows: 'ENG FAIL · N1/N2 run down · MASTER CAUTION (ELEC, HYD)' },
  { id: 'eng2', name: 'Engine 2 failure', cat: 'v1', sys: 'engines', key: 'flameout2', engine: true, shows: 'ENG FAIL · N1/N2 run down · MASTER CAUTION (ELEC, HYD)' },
  { id: 'pws', name: 'Predictive windshear warning', cat: 'v1', cue: 'pws', max: 99, shows: 'WINDSHEAR AHEAD aural · red WINDSHEAR on PFD and ND' },
  { id: 'hyd', name: 'Hydraulic ELEC 2 pump overheat', cat: 'c', sys: 'hydraulics', key: 'ovhtA', shows: 'MASTER CAUTION · HYD' },
  { id: 'leakB', name: 'Hydraulic system B leak', cat: 'c', sys: 'hydraulics', key: 'leakB', shows: 'MASTER CAUTION · HYD, FLT CONT' },
  { id: 'gen', name: 'Generator 1 trip', cat: 'c', sys: 'electrical', key: 'gen1', shows: 'MASTER CAUTION · ELEC' },
  { id: 'tr1', name: 'TR 1 failure', cat: 'c', sys: 'electrical', key: 'tr1', shows: 'MASTER CAUTION · ELEC' },
  { id: 'bleed', name: 'Engine 1 bleed trip off', cat: 'c', sys: 'air', key: 'trip1', shows: 'MASTER CAUTION · AIR COND' },
  { id: 'pack', name: 'Left pack trip off', cat: 'c', sys: 'air', key: 'packL', shows: 'MASTER CAUTION · AIR COND' },
  { id: 'wb', name: 'Left wing-body overheat', cat: 'c', sys: 'air', key: 'wbL', shows: 'MASTER CAUTION · AIR COND' },
  { id: 'fuel', name: 'Fuel pump low pressure', cat: 'c', sys: 'fuel', key: 'p1fwd', shows: 'MASTER CAUTION · FUEL' },
  { id: 'filter', name: 'Engine 1 fuel filter bypass', cat: 'c', sys: 'fuel', key: 'filter1', shows: 'MASTER CAUTION · FUEL' },
  { id: 'ovht', name: 'Engine 1 overheat', cat: 'c', sys: 'fire', key: 'ovht1', shows: 'MASTER CAUTION · OVHT/DET · ENG 1 OVERHEAT' },
  { id: 'irs', name: 'IRS fault', cat: 'c', sys: 'warnings', key: 'irs', shows: 'MASTER CAUTION · IRS' },
  { id: 'none', name: 'No malfunction', cat: 'none', weight: 1.2 },
];

export function createRtoDrill(h) {
  // h: sim, fmc, nav, ctxFor, stateOf, prepareTakeoff(at), refresh(), cockpit(), exit()
  const $ = (id) => document.getElementById(id);
  let run = null;               // the drill in progress
  let audio = null;

  // ── Sounds ──
  let sound = (() => { try { return localStorage.getItem('b737i.rtoSound') !== '0'; } catch { return true; } })();
  function ac() { audio ||= new (window.AudioContext || window.webkitAudioContext)(); return audio; }
  function tone(f, t0, dur, type = 'sine', gain = 0.18) {
    const a = ac(), o = a.createOscillator(), g = a.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(gain, a.currentTime + t0);
    g.gain.exponentialRampToValueAtTime(0.001, a.currentTime + t0 + dur);
    o.connect(g).connect(a.destination); o.start(a.currentTime + t0); o.stop(a.currentTime + t0 + dur + 0.05);
  }
  let bellTimer = 0;
  function bell(on) {
    clearInterval(bellTimer);
    if (!on || !sound) return;
    const ring = () => { for (let i = 0; i < 3; i++) { tone(1150, i * 0.11, 0.1, 'triangle', 0.22); tone(2300, i * 0.11, 0.06, 'sine', 0.05); } };
    ring(); bellTimer = setInterval(ring, 420);
  }
  // Callouts and aurals in the app's chosen voice (speech.js), only with sound on.
  function say(text, cut = false) { if (!sound) return; try { if (cut) h.tts.cancel(); h.tts.speak(text); } catch { /* no speech */ } }
  function quiet() { bell(false); try { h.tts.cancel(); } catch { /* fine */ } }

  // ── The runway ──
  function runway() {
    const r = h.fmc.S.route;
    const rw = (r.origin && r.depRwy && h.nav.runway(r.origin, r.depRwy)) || (h.nav.ready && h.nav.runway('LLBG', '26'));
    return rw ? { lat: rw.lat, lon: rw.lon, hdgT: rw.hdgT, elev: rw.elev, name: `${r.origin && r.depRwy ? r.origin + ' ' + r.depRwy : 'LLBG 26'}` }
      : { lat: 32.0005, lon: 34.8994, hdgT: 258, elev: 130, name: 'runway' };
  }
  // A different takeoff each run: V2 140–165 kt, VR a few knots below, and V1
  // anywhere from VR down to 12 kt below it (weight, runway and weather vary).
  function vspeeds() {
    const v2 = Math.round(140 + Math.random() * 25);
    const vr = v2 - Math.round(4 + Math.random() * 4);
    const v1 = vr - Math.round(Math.random() * 12);
    return { v1, vr, v2 };
  }
  function pick(v2) {
    const tot = MALF.reduce((a, m) => a + (m.weight ?? 1), 0);
    let x = Math.random() * tot, m = MALF[0];
    for (const it of MALF) { x -= it.weight ?? 1; if (x <= 0) { m = it; break; } }
    const top = Math.min(v2, m.max ?? v2);
    return { m, at: Math.round(5 + Math.random() * (top - 5)) };
  }

  // ── Start / inject / decide / debrief ──
  function start() {
    end(false);
    const rw = runway(), v = vspeeds();
    const p = pick(v.v2);
    run = { rw, v, malf: p.m, trigger: p.at, injected: null, decision: null, t0: performance.now(), applied: [] };
    h.prepareTakeoff({ ...rw, v });
    document.body.classList.add('drill');
    $('rto').hidden = false; $('rto-res').hidden = true; $('rto-btns').hidden = false;
    $('rto-go').disabled = true; $('rto-stop').disabled = false;
    $('rto-tag').textContent = `TAKEOFF · ${rw.name} · V1 ${v.v1}  VR ${v.vr}  V2 ${v.v2}`;
    h.cockpit()?.goView('rto');
    // Advance the thrust levers a moment after line-up.
    setTimeout(() => { if (run) h.ctxFor('autoflight').action('TOGA'); }, 1200);
  }
  function inject() {
    const m = run.malf, a = h.sim.ac;
    run.injected = { speed: Math.round(a.ias), t: performance.now(), air: !a.onGround };
    if (m.sys) { const c = h.ctxFor(m.sys); if (!c.fail[m.key]) c.toggleFail(m.key); run.applied.push([m.sys, m.key]); }
    if (m.engine) h.sim.failEngine();
    if (m.id === 'pws') { h.ctxFor('warnings').action('scen', 'pws'); run.applied.push(['warnings:scen', 'pws']); }
    if (m.cue === 'bell') bell(true);
    if (m.cue === 'pws') say('Windshear ahead, windshear ahead.', true);
    $('rto-go').disabled = false;
    h.refresh();
  }
  function decide(type, auto = false) {
    if (!run || run.decision) return;
    const a = h.sim.ac;
    if (type === 'stop' && !a.onGround) return;
    run.decision = { type, speed: Math.round(a.ias), t: performance.now(), auto };
    quiet();
    $('rto-btns').hidden = true;
    if (type === 'stop') {
      h.sim.reject();
      const af = h.ctxFor('autoflight');
      if (h.stateOf('autoflight').mem.at) af.action('ATDISC');
      h.stateOf('flightcontrols').sw.sb = 3;          // speedbrake UP
      h.refresh();
    }
  }
  function debrief() {
    const { malf: m, injected: inj, decision: d, v } = run;
    const a = h.sim.ac;
    let expected, reason;
    if (m.cat === 'none') { expected = 'continue'; reason = 'Nothing failed — a normal takeoff.'; }
    else if (!inj) { expected = 'continue'; reason = 'The malfunction had not happened yet.'; }
    else if (inj.air) { expected = 'continue'; reason = 'It came after lift-off — the takeoff is committed.'; }
    else if (inj.speed < 80) { expected = 'stop'; reason = 'Below 80 kt: reject for any system failure, unusual noise or vibration, tire failure, fire, engine failure, windshear, unsafe to fly.'; }
    else if (inj.speed <= v.v1) { expected = m.cat === 'v1' ? 'stop' : 'continue'; reason = m.cat === 'v1' ? '80 kt to V1: reject for fire or fire warning, engine failure, predictive windshear warning, unsafe or unable to fly.' : '80 kt to V1: this is not one of the reject items (fire, engine failure, predictive windshear, unable to fly) — continue.'; }
    else { expected = 'continue'; reason = 'Above V1 the takeoff is continued.'; }
    const late = d?.type === 'stop' && d.speed > v.v1;
    const ok = d && d.type === expected && !late;
    const ft = (nm) => Math.round(nm * 1852);
    const react = inj && d && !d.auto ? ((d.t - inj.t) / 1000).toFixed(1) : null;
    const row = (k, val) => `<tr><td>${k}</td><td>${val}</td></tr>`;
    $('rto-res').innerHTML = `
      <div class="rto-verdict ${ok ? 'ok' : 'bad'}">${ok ? '✓ Correct decision' : late ? '✗ Rejected above V1' : '✗ Not the QRH decision'}</div>
      <table class="rto-t">
        ${row('Malfunction', m.name)}
        ${m.shows ? row('What showed', m.shows) : ''}
        ${row('Introduced at', inj ? `${inj.speed} kt${inj.air ? ' (airborne)' : ''}` : m.cat === 'none' ? '—' : 'not reached')}
        ${row('V1 · VR · V2', `${v.v1} · ${v.vr} · ${v.v2} kt`)}
        ${row('Your decision', d ? `${d.type === 'stop' ? 'STOP' : 'CONTINUE'} at ${d.speed} kt${d.auto ? ' (no decision by VR)' : ''}${react ? ` · ${react} s after the malfunction` : ''}` : '—')}
        ${row('QRH decision', expected === 'stop' ? 'STOP (reject)' : 'CONTINUE')}
        ${d?.type === 'stop' && a ? row('Stopped in', `${ft(a.run - (a.rtoAt ?? 0))} m from the reject (${ft(a.run)} m from brake release)`) : ''}
      </table>
      <p class="rto-why">${reason}</p>
      <p class="rto-ref">QRH MAN.1.2 Rejected Takeoff · study aid, simplified</p>
      <div class="rto-acts"><button class="rto-b small go" id="rto-again">RUN AGAIN</button><button class="rto-b small" id="rto-exit">EXIT</button></div>`;
    $('rto-res').hidden = false;
    $('rto-again').onclick = start;
    $('rto-exit').onclick = () => end(true);
  }
  function end(exit) {
    quiet();
    if (run) {
      for (const [sys, key] of run.applied) {
        if (sys === 'warnings:scen') { if (h.stateOf('warnings').mem.scen === key) h.ctxFor('warnings').action('scen', key); }
        else { const c = h.ctxFor(sys); if (c.fail[key]) c.toggleFail(key); }
      }
    }
    run = null;
    if (exit) { $('rto').hidden = true; document.body.classList.remove('drill'); h.exit(); }
  }

  /** Called every tick (real seconds). */
  function tick() {
    if (!run) return;
    const a = h.sim.ac;
    if (!a) return;
    if (!run.injected && run.malf.cat !== 'none' && a.ias >= run.trigger) inject();
    // Pilot monitoring's callouts: 80 knots, V1, rotate (not after a reject).
    if (run.decision?.type !== 'stop' && a.onGround !== false) {
      run.called ||= {};
      if (a.ias >= 80 && !run.called[80]) { run.called[80] = 1; say('Eighty knots'); }
      if (a.ias >= run.v.v1 && !run.called.v1) { run.called.v1 = 1; say('V one'); }
      if (a.ias >= run.v.vr && !run.called.vr) { run.called.vr = 1; say('Rotate'); }
    }
    // No decision by VR: the takeoff continues.
    if (run.injected && !run.decision && a.ias >= run.v.vr) decide('continue', true);
    const done = (run.decision?.type === 'stop' && a.stage === 'stopped') || (a.ra > 400 && !a.onGround);
    if (done && !run.shown) { run.shown = true; if (!run.decision) run.decision = { type: 'continue', speed: Math.round(a.ias), t: performance.now(), auto: true }; quiet(); $('rto-btns').hidden = true; debrief(); }
  }

  $('rto-stop').addEventListener('click', () => decide('stop'));
  $('rto-go').addEventListener('click', () => decide('continue'));
  $('rto-x').addEventListener('click', () => end(true));
  const sb = $('rto-snd');
  const paintSound = () => { sb.textContent = sound ? '🔊' : '🔇'; sb.setAttribute('aria-label', sound ? 'Sound on' : 'Sound off'); };
  paintSound();
  sb.addEventListener('click', () => { sound = !sound; try { localStorage.setItem('b737i.rtoSound', sound ? '1' : '0'); } catch { /* fine */ } if (!sound) quiet(); else if (run?.injected && !run.decision && run.malf.cue === 'bell') bell(true); paintSound(); });
  return { start, tick, end, get active() { return !!run; } };
}
