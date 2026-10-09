// flightsim.js — a simple kinematic airplane that flies the FMC route, so
// the CDU, ND and FMA can be used end to end: line up, TO/GA, LNAV at 50 ft,
// VNAV at 400 ft, climb to T/C, cruise, T/D on a 3° path, approach with LOC
// and G/S capture, flare and rollout. The flight director "flies" whatever
// modes are engaged (autopilot or not), and the modes it changes are written
// into the Automatic Flight state, so the FMA shows them.
//
// No wind, ISA, no aerodynamics: speeds and rates are rough 737-800 numbers
// for study only.

import { nav, geo } from './navdb.js?v=30';
import { tasOf, soundKt, fmcSpeed, FT_PER_NM_3DEG } from './fmc.js?v=30';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const roc = (alt) => Math.max(1000, 3000 - alt * 0.055);
/** Flap placard speeds (kt). */
const FLAP_MAX = { 0: 999, 1: 250, 2: 250, 5: 250, 10: 210, 15: 200, 25: 190, 30: 175, 40: 162 };
const DETENTS = [0, 1, 2, 5, 10, 15, 25, 30, 40];

export function createFlightSim(hooks) {
  // hooks: fmc, af() → { mem, sw, action(key) }, flaps() → detent index,
  // setFlap(index), gearLever() → 0/1/2, setGear(0/1/2), engines() → bool
  const fmc = hooks.fmc;
  let ac = null;              // null = not flying (the phases drive the airplane)
  let rate = 1, paused = false;
  let modesChanged = false;
  const once = new Set();

  const mem = () => hooks.af().mem;
  function setMode(k, v) {
    const m = mem();
    if (m[k] === v) return;
    m[k] = v; m.changed[k] = Date.now();
    modesChanged = true;
  }
  const at = (v) => { if (hooks.af().sw.atArm) setMode('at', v); };

  function ias2tas(ias, alt) { return tasOf(ias, alt); }
  function tas2ias(tas, alt) { return tas / (1 + alt * 0.00002); }
  /** FMC target as IAS (Mach targets converted at this altitude). */
  function targetIas(sp, alt) { return sp.ias ?? tas2ias(sp.mach * soundKt(alt), alt); }

  // ── Line up on the departure runway ──
  /** at: optional { lat, lon, hdgT, elev, v: { v1, vr, v2 } } — a runway of its own (the RTO drill). */
  function lineUp(at) {
    const r = fmc.S.route;
    const rw = !at && r.origin && r.depRwy && nav.runway(r.origin, r.depRwy);
    const apt = !at && r.origin && nav.airport(r.origin);
    if (!at && !rw && !apt) return 'NO ORIGIN';
    const p = at || rw || apt;
    const elev = at ? at.elev : rw ? rw.elev : apt.elev;
    ac = {
      lat: p.lat, lon: p.lon, elev, alt: elev,
      trk: at ? at.hdgT : rw ? rw.hdgT : 0, ias: 0, tas: 0, gs: 0, vs: 0, pitch: 0, bank: 0, mach: 0,
      onGround: true, stage: 'lineup', vnav: 'climb', ra: 0, holdAlt: null, n1: 22,
      fixedElev: at ? at.elev : null, v: at?.v || null, run: 0, engOut: false,
    };
    once.clear();
    if (fmc.S.active) fmc.S.activeIdx = 1;
    return null;
  }

  // Ground elevation under the airplane: the nearer of origin and destination.
  function groundElev() {
    if (ac.fixedElev != null) return ac.fixedElev;
    const r = fmc.S.route;
    const o = r.origin && nav.airport(r.origin), d = r.dest && nav.airport(r.dest);
    const rwA = r.dest && r.arrRwy && nav.runway(r.dest, r.arrRwy);
    const rwD = r.origin && r.depRwy && nav.runway(r.origin, r.depRwy);
    const oe = rwD?.elev ?? o?.elev ?? 0;
    if (!d) return oe;
    if (!o) return rwA?.elev ?? d.elev;
    return geo.dist(ac, o) < geo.dist(ac, d) ? oe : (rwA?.elev ?? d.elev);
  }

  function arrRunway() {
    const r = fmc.S.route;
    return r.dest && r.arrRwy ? nav.runway(r.dest, r.arrRwy) : null;
  }
  /** Localizer: cross-track (NM, + right) and distance to the threshold. */
  function locDev(rw) {
    const far = geo.dest(rw, (rw.hdgT + 180) % 360, 30);
    return { xtk: geo.xtk(far, rw, ac), d: geo.dist(ac, rw) };
  }

  // ── Lateral ──
  function lateralCmd(m) {
    if (ac.onGround) return ac.trk;
    if (m.lat === 'HDG SEL') return (m.hdg + nav.magVar(ac) + 360) % 360;
    if (m.lat === 'VOR/LOC') {
      const rw = arrRunway();
      if (rw) { const l = locDev(rw); return (rw.hdgT - clamp(l.xtk * 40, -30, 30) + 360) % 360; }
    }
    if (m.lat === 'LNAV' && fmc.S.active) {
      const legs = fmc.activeLegs(), i = fmc.S.activeIdx;
      const to = legs[i], from = legs[i - 1];
      if (to && from) {
        const dTo = Math.max(0.5, geo.dist(ac, to));
        const xtk = geo.xtk(from, to, ac);
        const legCrs = geo.brg(ac, to) + (Math.atan2(xtk, dTo) * 180) / Math.PI;
        if (i === legs.length - 1 && dTo < 1 && !once.has('eor')) { once.add('eor'); }
        return (legCrs - clamp(xtk * 25, -40, 40) + 360) % 360;
      }
    }
    return ac.trk;
  }

  // ── One time step (seconds of sim time) ──
  function step(dt) {
    const m = mem();
    if (m.spdSync) { m.spd = Math.round(ac.ias); m.spdSync = false; modesChanged = true; }
    const S = fmc.S;
    const elev = groundElev();
    ac.ra = ac.alt - elev;
    const vs1 = fmc.vspeeds();
    const v2 = ac.v?.v2 ?? S.tko.v2 ?? vs1?.v2 ?? 150, vr = ac.v?.vr ?? S.tko.vr ?? vs1?.vr ?? 145;
    const vref = S.appr.vref ?? fmc.vref(S.appr.flaps || 30) ?? 140;
    const crz = S.perf.crzAlt || m.alt || 10000;
    const rw = arrRunway();
    const dtg = fmc.dtg(ac);
    const flapDet = DETENTS[hooks.flaps()] ?? 0;
    let tgtSpd = ac.ias, vsCmd = ac.vs;

    // ── Takeoff roll ──
    if (ac.stage === 'lineup') {
      if (m.pit === 'TO/GA' && hooks.engines()) { ac.stage = 'roll'; at('N1'); }
      else return;
    }
    // Rejected takeoff: thrust idle, reversers, maximum braking (autobrake RTO), speedbrakes up.
    if (ac.stage === 'rto') {
      ac.ias = Math.max(0, ac.ias - 6.5 * dt);
      ac.n1 = ac.ias > 60 ? 72 : 24;
      if (ac.ias <= 0) ac.stage = 'stopped';
    }
    if (ac.stage === 'roll') {
      ac.ias += (ac.engOut ? 1.9 : 3.6) * dt;
      ac.n1 = 95;
      if (ac.ias > 84 && m.at === 'N1') at('THR HLD');
      if (ac.ias >= vr) { ac.stage = 'rotate'; }
    }
    if (ac.stage === 'rotate') {
      ac.ias += 1.5 * dt;
      ac.pitch = Math.min(15, ac.pitch + 2.5 * dt);
      if (ac.pitch > 8) { ac.onGround = false; ac.stage = 'climb'; ac.vs = 600; }
    }

    if (!ac.onGround) {
      // Takeoff (FCOM 4.20): armed LNAV engages at 50 ft, armed VNAV at
      // 400 ft (the A/T stays in THR HLD); THR HLD → ARM at 800 ft above the
      // field; with VNAV, N1 (climb thrust) at the thrust reduction altitude.
      if (ac.ra > 50 && m.latArm === 'LNAV') { setMode('lat', 'LNAV'); setMode('latArm', ''); }
      if (ac.ra > 400 && m.pitArm === 'VNAV' && m.pit === 'TO/GA') { setMode('pit', 'VNAV SPD'); setMode('pitArm', ''); m.to = false; }
      if (m.at === 'THR HLD' && ac.ra > 800) at('ARM');
      // Go-around: the TO/GA switch in flight (or the sim, if the runway is overflown).
      if (m.pit === 'TO/GA' && m.ga && !ac.inGA) {
        ac.inGA = true; once.add('ga');
        ac.stage = 'climb'; ac.vnav = 'climb';
        if (hooks.flaps() > DETENTS.indexOf(15)) hooks.setFlap(DETENTS.indexOf(15));     // "flaps 15"
        // Missed approach altitude: the MCP if it is above us, else 3,000 ft above the field.
        const fa = Math.ceil((elev + 3000) / 100) * 100;
        if (m.alt < ac.alt + 500) { m.alt = fa > ac.alt + 500 ? fa : Math.ceil((ac.alt + 1500) / 1000) * 1000; modesChanged = true; }
        fmc.msg('GO-AROUND');
      }
      if (ac.inGA && m.pit !== 'TO/GA' && m.pit !== 'ALT ACQ') ac.inGA = false;
      // RETARD runs the levers to idle, then ARM (not in the landing flare).
      if (m.at === 'RETARD' && m.step < 0) { ac.retT = (ac.retT || 0) + dt; if (ac.retT > 3) at('ARM'); } else ac.retT = 0;
      // Gear up after lift-off, OFF once well clear.
      if (ac.stage === 'climb' && ac.ra > 100 && ac.vs > 300 && hooks.gearLever() === 2) hooks.setGear(0);
      if (ac.stage === 'climb' && ac.ra > 1500 && hooks.gearLever() === 0) hooks.setGear(1);
    }

    // ── VNAV stage ──
    if (!ac.onGround) {
      if (ac.vnav === 'climb' && ac.alt >= crz - 50) { ac.vnav = 'cruise'; S.msg ||= ''; }
      const todFromEnd = fmc.profile(S.route).todFromEnd;
      if (ac.vnav === 'cruise' && dtg != null && todFromEnd != null && dtg <= todFromEnd) {
        if (m.alt >= ac.alt - 50) { if (!once.has('reset')) { once.add('reset'); fmc.msg('RESET MCP ALT'); } }
        else ac.vnav = 'descent';
      }
    }

    // ── Approach configuration (before / after the localizer) ──
    const app = ac.vnav === 'descent' && dtg != null;
    const glide = m.pit === 'G/S' || m.pit === 'FLARE';
    if (!ac.onGround && ac.stage === 'climb' && ac.vnav === 'cruise') ac.stage = 'cruise';
    if (!ac.onGround && (ac.stage === 'climb' || ac.stage === 'cruise') && ac.vnav === 'descent') ac.stage = 'descent';
    if (app && !ac.onGround) {
      // Configure by distance to go, but never high up (a late descent stays clean until low).
      const low = ac.ra < 9000, lower = ac.ra < 5000;
      let want = 0;
      if (dtg < 30 && low) want = 1;
      if (dtg < 20 && low) want = 3;                                  // 5
      if ((dtg < 13 || m.lat === 'VOR/LOC') && lower) want = 5;       // 15
      if ((dtg < 9 && lower) || glide) want = DETENTS.indexOf(S.appr.flaps || 30);
      if (want > hooks.flaps() && ac.ias <= FLAP_MAX[DETENTS[want]] + 5) hooks.setFlap(want);
      if (((dtg < 13 && lower) || glide) && hooks.gearLever() !== 2) hooks.setGear(2);
      if (want) ac.stage = 'approach';
    }
    // Flap retraction on the way up.
    if (!ac.onGround && ac.vnav !== 'descent' && flapDet > 0 && ac.ra > 800) {
      if (flapDet >= 5 && ac.ias >= v2 + 30) hooks.setFlap(DETENTS.indexOf(1));
      else if (flapDet <= 2 && ac.ias >= v2 + 50) hooks.setFlap(0);
    }

    // ── LOC and G/S capture ──
    if (rw && !ac.onGround) {
      const l = locDev(rw);
      if (m.latArm === 'VOR/LOC' && Math.abs(l.xtk) < 2.5 && l.d < 30 && Math.abs(geo.diff(ac.trk, rw.hdgT)) < 100) {
        setMode('lat', 'VOR/LOC'); setMode('latArm', '');
      }
      const gp = rw.elev + 50 + l.d * FT_PER_NM_3DEG;
      const before = Math.abs(geo.diff(geo.brg(ac, rw), rw.hdgT)) < 90;     // threshold still ahead
      // Capture from below, or from above while inside the beam.
      if (m.pitArm === 'G/S' && m.lat === 'VOR/LOC' && before && ac.alt <= gp + 250 && m.step < 0) {
        hooks.af().action('step');            // G/S capture: step 0 of the approach
        m.spd = Math.round(vref + 5);
        modesChanged = true;
      }
    }

    // ── Vertical modes ──
    // Altitude capture: ALT ACQ (not annunciated inside VNAV) as the
    // airplane rounds out toward the target, then the hold mode.
    const capture = (target, mode, acq = true) => {
      const d = target - ac.alt;
      const crossed = ac.prevAlt != null && (ac.prevAlt - target) * (ac.alt - target) < 0;
      if (Math.abs(d) < 20 || crossed) {
        ac.alt = target; ac.holdAlt = target; vsCmd = 0;
        setMode('pit', mode);
        return true;
      }
      const band = Math.max(150, (Math.abs(ac.vs) / 60) * 10);
      if (Math.abs(d) < band && Math.sign(d) === Math.sign(ac.vs || d)) {
        vsCmd = clamp(d * 6, -Math.abs(ac.vs), Math.abs(ac.vs));
        if (acq) { setMode('pit', 'ALT ACQ'); acqDone(); }
      }
      return false;
    };
    // ALT ACQ outside VNAV: A/T to MCP SPD; a go-around's GA thrust ends and the IAS window returns.
    const acqDone = () => {
      if (m.to) { m.spd += 20; m.to = false; }            // takeoff mode ends: IAS window V2 + 20
      // Levelling off from an A/P go-around is single-channel: B drops, roll CWS R.
      if (m.ga && m.cmdA && m.cmdB) { m.cmdB = false; m.cwsR = true; setMode('lat', ''); }
      if (m.ga || m.pit === 'ALT ACQ') { if (m.spdBlank) { m.spd = Math.round(ac.ias); m.spdBlank = false; } m.ga = false; }
      if (m.at && m.at !== 'MCP SPD') at('MCP SPD');   // FCOM 4.20: ALT ACQ / ALT HOLD outside VNAV engage MCP SPD
    };
    const flapCap = FLAP_MAX[flapDet] - 10;
    if (!ac.onGround) {
      const p = m.pit;
      if (p === 'TO/GA') {
        if (m.ga) {
          // Go-around: reduced GA thrust for 1,000–2,000 fpm, speed for the flap setting.
          tgtSpd = Math.max(vref + 20, Math.min(FLAP_MAX[flapDet] - 15, vref + 40)); vsCmd = m.alt > ac.alt ? 1800 : 0;
        } else if (ac.engOut) {
          // One engine: V2 to V2 + 20, a much flatter climb.
          tgtSpd = v2 + 5; vsCmd = m.alt > ac.alt ? 1000 : 0;
        } else {
          // Takeoff: 15° nose up, then MCP speed (V2) + 20.
          tgtSpd = (m.spd || v2) + 20; vsCmd = m.alt > ac.alt ? 2600 : 0;
        }
        if (m.alt > ac.alt) capture(m.alt, 'ALT HOLD');
        else if (!ac.holdAlt || Math.abs(ac.holdAlt - ac.alt) > 200) ac.holdAlt = ac.alt;
      } else if (p === 'ALT ACQ') {
        tgtSpd = m.spd; vsCmd = clamp((m.alt - ac.alt) * 6, -2000, 2000);
        if (Math.abs(m.alt - ac.alt) < 20) { ac.alt = m.alt; ac.holdAlt = m.alt; vsCmd = 0; setMode('pit', 'ALT HOLD'); }
      } else if (p.startsWith('VNAV')) {
        if (ac.vnav === 'climb') {
          const lim = Math.min(m.alt, crz);
          tgtSpd = ac.ra < 1000 ? v2 + 20 : targetIas(fmcSpeed('climb', ac.alt), ac.alt);
          vsCmd = ac.ias < tgtSpd - 8 && ac.ra > 1000 ? 900 : roc(ac.alt);
          if (p !== 'VNAV ALT' || m.alt > ac.alt + 100) setMode('pit', 'VNAV SPD');
          if (m.at !== 'N1' && m.at !== 'THR HLD' && ac.ra > 1500 && p !== 'VNAV ALT') at('N1');   // thrust reduction
          if (lim < crz - 50) { if (capture(lim, 'VNAV ALT', false)) at('FMC SPD'); }
          else if (ac.alt >= crz - 50) { ac.alt = crz; vsCmd = 0; setMode('pit', 'VNAV PTH'); at('FMC SPD'); ac.vnav = 'cruise'; }
          if (m.pit === 'VNAV ALT') { vsCmd = 0; ac.alt = ac.holdAlt ?? ac.alt; }
        } else if (ac.vnav === 'cruise') {
          tgtSpd = targetIas(fmcSpeed('cruise', ac.alt), ac.alt);
          vsCmd = (crz - ac.alt) * 0.5;
          setMode('pit', 'VNAV PTH'); at('FMC SPD');
        } else {
          // Descent: follow the 3° path down to the runway; level off at the MCP altitude.
          const path = fmc.pathAlt(dtg ?? 0) ?? ac.alt;
          const sp = targetIas(fmcSpeed('descent', ac.alt), ac.alt);
          tgtSpd = ac.stage === 'approach' ? Math.min(sp, dtg < 9 || glide ? vref + 5 : dtg < 13 ? 170 : dtg < 20 ? 190 : 210) : sp;
          const rate = -(ac.gs / 60) * FT_PER_NM_3DEG;     // fpm down the path
          vsCmd = clamp(rate + (path - ac.alt) * 2, -4500, 300);
          if (m.alt > path + 100 && m.alt <= ac.alt + 50 && ac.ra > 1500) {
            if (p !== 'VNAV ALT') { if (capture(m.alt, 'VNAV ALT', false)) at('FMC SPD'); } else { vsCmd = 0; ac.alt = ac.holdAlt ?? m.alt; }
          } else {
            setMode('pit', 'VNAV PTH');
            // Idle path descent: RETARD, then ARM; thrust (FMC SPD) when low on the
            // path or slowing and configuring for the approach.
            const needThrust = ac.alt - path < -300 || ac.stage === 'approach';
            if (needThrust) at('FMC SPD');
            else if (m.at !== 'RETARD' && m.at !== 'ARM') at('RETARD');
          }
        }
      } else if (p === 'MCP SPD') {
        tgtSpd = m.spd;
        const up = m.alt > ac.alt;
        vsCmd = up ? roc(ac.alt) : -2400;
        if (up) at('N1'); else if (m.at !== 'RETARD' && m.at !== 'ARM') at('RETARD');
        capture(m.alt, 'ALT HOLD');
      } else if (p === 'V/S') {
        tgtSpd = m.spd; vsCmd = m.vs;
        if ((m.vs > 0 && m.alt > ac.alt) || (m.vs < 0 && m.alt < ac.alt)) capture(m.alt, 'ALT HOLD');
      } else if (p === 'ALT HOLD') {
        tgtSpd = m.at === 'MCP SPD' ? m.spd : ac.ias; vsCmd = ((ac.holdAlt ?? ac.alt) - ac.alt) * 0.8;
      } else if (glide && rw) {
        const l = locDev(rw), gp = rw.elev + 50 + l.d * FT_PER_NM_3DEG;
        tgtSpd = m.spd || vref + 5;
        vsCmd = clamp(-(ac.gs / 60) * FT_PER_NM_3DEG + (gp - ac.alt) * 3, -1500, 200);
      } else {
        tgtSpd = m.at === 'MCP SPD' ? m.spd : ac.ias; vsCmd = ac.vs * 0.98;
      }
      if (m.at === 'MCP SPD' && !p.startsWith('VNAV')) tgtSpd = m.spd;
      tgtSpd = Math.min(tgtSpd, flapCap, ac.alt < 10000 + 300 && ac.vnav !== 'cruise' ? 250 : 999);
      ac.tgt = Math.round(tgtSpd);
      if (glide || ac.stage === 'approach') tgtSpd = Math.min(tgtSpd, FLAP_MAX[flapDet] - 5);

      // ── Approach steps: 1,500 ft, flare, retard, touchdown ──
      if (m.app && m.step >= 0) {
        if (m.step === 0 && ac.ra < 1500) hooks.af().action('step');
        if (m.step === 1 && ac.ra < 50) hooks.af().action('step');
        if (m.step === 2 && ac.ra < 27) hooks.af().action('step');
        modesChanged = true;
      }
      // Overflew the runway still airborne: go around.
      const onFinal = m.lat === 'VOR/LOC' || glide || (fmc.S.active && fmc.S.activeIdx >= fmc.activeLegs().length - 1);
      if (rw && onFinal && !once.has('ga') && ac.ra > 100 && Math.abs(geo.diff(geo.brg(ac, rw), rw.hdgT)) > 90 && geo.dist(ac, rw) < 3) {
        hooks.af().action('TOGA');
        modesChanged = true;
      }
      // Flare: whatever the modes, the airplane lands when it gets low on approach.
      if (ac.stage === 'approach' && ac.ra < 50) { vsCmd = Math.max(vsCmd, -160 - ac.ra * 4); tgtSpd = Math.min(tgtSpd, vref); }
    }

    // ── Speed, vertical speed, attitude ──
    if (!ac.onGround) {
      const d = tgtSpd - ac.ias;
      ac.ias += clamp(d, -1.1 * dt, 1.4 * dt);
      ac.vs += clamp(vsCmd - ac.vs, -500 * dt, 500 * dt);
      ac.prevAlt = ac.alt;
      ac.alt += (ac.vs / 60) * dt;
      ac.pitch += clamp((ac.stage === 'climb' && ac.ra < 1500 ? 15 : clamp(2 + ac.vs * 0.0025 + flapDet * 0.08, -4, 17)) - ac.pitch, -2 * dt, 2 * dt);
      ac.n1 = clamp(m.at === 'RETARD' || m.at === 'ARM' && ac.vs < -500 ? 32 : ac.vs > 500 ? 93 : 60 + (ac.alt / 1000) * 0.7 + flapDet * 0.6, 22, 96);
      // Touchdown.
      if (ac.alt <= elev && ac.vs <= 0) {
        ac.alt = elev; ac.onGround = true; ac.stage = 'rollout'; ac.vs = 0;
        if (m.app && m.step === 3) hooks.af().action('step');
        if (m.at && m.at !== 'ARM') at('ARM');
        // Autoland touchdown: the roll channel annunciates ROLLOUT until the
        // aircraft stops; without an approach it is simply blank.
        setMode('pit', ''); setMode('lat', mem().app ? 'ROLLOUT' : '');
        const fc = hooks.speedbrakeUp?.(); void fc;
      }
    } else if (ac.stage === 'rollout') {
      ac.ias = Math.max(0, ac.ias - 4.5 * dt);
      ac.pitch = Math.max(0, ac.pitch - 2 * dt);
      ac.n1 = ac.ias > 60 ? 70 : 22;
      if (ac.ias <= 0) ac.stage = 'stopped';
    }

    // ── Lateral ── (the FMC sequences waypoints whatever mode is flying)
    if (!ac.onGround && fmc.S.active) fmc.sequence(ac);
    const cmd = lateralCmd(m);
    if (!ac.onGround) {
      const diff = geo.diff(ac.trk, cmd);
      const maxBank = m.lat === 'HDG SEL' ? (hooks.af().bank || 25) : m.lat === 'LNAV' && ac.ra < 200 ? 15 : 25;
      const want = clamp(diff * 2.2, -maxBank, maxBank);
      ac.bank += clamp(want - ac.bank, -5 * dt, 5 * dt);
      const tas = Math.max(100, ac.tas);
      ac.trk = (ac.trk + ((1091 * Math.tan((ac.bank * Math.PI) / 180)) / tas) * dt + 360) % 360;
    } else ac.bank = 0;

    ac.tas = ias2tas(ac.ias, Math.max(0, ac.alt));
    ac.gs = ac.tas;
    ac.mach = ac.tas / soundKt(Math.max(0, ac.alt));
    ac.run += (ac.gs * dt) / 3600;           // NM along the ground track (stopping distance)
    const p = geo.dest(ac, ac.trk, (ac.gs * dt) / 3600);
    ac.lat = p.lat; ac.lon = p.lon;
  }

  return {
    get ac() { return ac; },
    get flying() { return !!ac; },
    get rate() { return rate; },
    set rate(v) { rate = v; },
    get paused() { return paused; },
    set paused(v) { paused = !!v; },
    lineUp,
    stop() { ac = null; },
    /** RTO: from the roll, stop on the runway. Returns the distance run so far (NM). */
    reject() { if (ac && ac.onGround && (ac.stage === 'roll' || ac.stage === 'rotate')) { ac.stage = 'rto'; ac.pitch = 0; ac.rtoAt = ac.run; } },
    failEngine() { if (ac) ac.engOut = true; },
    /** Advance real time dt (s). Returns true when an FMA mode changed. */
    tick(dt) {
      if (!ac || paused) return false;
      modesChanged = false;
      let left = Math.min(1, dt) * rate;
      while (left > 1e-6) { const h = Math.min(0.25, left); step(h); left -= h; }
      return modesChanged;
    },
    /** Display numbers for the PFD / ND. */
    flight() {
      if (!ac) return null;
      const mv = nav.magVar(ac);
      return {
        ias: Math.max(0, ac.ias), mach: ac.mach, alt: Math.round(ac.alt), vs: Math.round(ac.vs / 50) * 50,
        hdg: (Math.round(ac.trk - mv) + 360) % 360 || 360, trk: ac.trk, mv, gs: ac.gs, tas: ac.tas,
        pitch: ac.pitch, bank: ac.bank, ra: ac.ra, onGround: ac.onGround, stage: ac.stage, tgt: ac.tgt, vsRaw: ac.vs,
      };
    },
    /** For the CDU's ACT page titles. */
    vnavStage() { return ac && !ac.onGround ? ac.vnav : ''; },
  };
}
