// fmc.js — the flight management computer's brain: route (with a MOD copy
// that EXEC makes active), performance data, the vertical profile (T/C, T/D
// on a 3° path to the runway), predictions (distance, ETA, fuel, altitude at
// each waypoint), LNAV sequencing. The CDU pages live in cdu.js; the airplane
// that flies the route lives in flightsim.js.
//
// Performance numbers (V-speeds, VREF, N1, fuel burn) are simple
// approximations for study — NOT for operational use.

import { nav, geo } from './navdb.js?v=13';

export const FT_PER_NM_3DEG = 318;
const clone = (o) => JSON.parse(JSON.stringify(o));

/** A rough 737-800 climb: rate of climb (fpm) by altitude. */
const roc = (alt) => Math.max(900, 2800 - alt * 0.05);
/** True airspeed from indicated (knots) and altitude (rough, ISA). */
export function tasOf(ias, alt) { return ias * (1 + alt * 0.00002 * 1.0); }
/** Speed of sound (kt) at altitude, ISA. */
export function soundKt(alt) { const T = Math.max(216.65, 288.15 - 0.0019812 * alt); return 661.47 * Math.sqrt(T / 288.15); }

/** FMC target speed for a stage of flight: { ias } or { mach }. */
export function fmcSpeed(stage, alt) {
  if (stage === 'climb') return alt < 10000 ? { ias: 250 } : alt < 28000 ? { ias: 280 } : { mach: 0.78 };
  if (stage === 'cruise') return { mach: 0.78 };
  if (stage === 'descent') return alt > 28000 ? { mach: 0.78 } : alt > 10500 ? { ias: 280 } : { ias: 250 };
  return { ias: 250 };
}

export function createFMC(hooks) {
  // hooks: fuelKg(), aircraft() → sim state or null, enterIrsPos(), irsAligned(), utc()
  const S = {
    route: { flt: '', origin: null, dest: null, depRwy: null, arrRwy: null, wpts: [] },
    active: false,
    activeIdx: 1,
    perf: { zfw: null, reserves: 2.5, ci: 50, crzAlt: null, transAlt: 18000 },
    tko: { flaps: 5, v1: null, vr: null, v2: null, selTemp: null },
    appr: { flaps: null, vref: null },
    refApt: null, posSet: false,
    msg: '',
  };
  let mod = null;            // pending route modification
  let armed = false;         // ACTIVATE pressed: the first EXEC makes the route active
  let version = 0;           // bumped on every change (displays redraw)
  const changed = () => { version++; save(); };

  // ── Persistence (per device) ──
  const KEY = 'b737inside.fmc';
  function save() { try { localStorage.setItem(KEY, JSON.stringify({ S, mod })); } catch { /* fine */ } }
  function load() {
    try {
      const o = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (o?.S) { Object.assign(S, o.S); mod = o.mod; }
    } catch { /* fresh */ }
  }
  load();

  const R = () => mod || S.route;              // route being shown / edited
  function edit(fn) {
    if (!mod) mod = clone(S.route);
    fn(mod);
    changed();
  }

  // ── Legs: origin runway, enroute waypoints, final approach fix, runway ──
  function legsOf(r) {
    const out = [];
    const o = r.origin && nav.airport(r.origin);
    if (o) {
      const rw = r.depRwy && nav.runway(r.origin, r.depRwy);
      out.push(rw ? { ident: `RW${rw.id}`, lat: rw.lat, lon: rw.lon, kind: 'rwy', elev: rw.elev, hdgT: rw.hdgT }
        : { ident: o.ident, lat: o.lat, lon: o.lon, kind: 'apt', elev: o.elev });
    }
    for (const w of r.wpts) out.push({ ...w, kind: w.kind || 'wpt' });
    const d = r.dest && nav.airport(r.dest);
    if (d) {
      const rw = r.arrRwy && nav.runway(r.dest, r.arrRwy);
      if (rw) {
        // Straight-in final: a fix 8 NM out on the extended centreline, then the threshold.
        const ff = geo.dest(rw, (rw.hdgT + 180) % 360, 8);
        out.push({ ident: `FF${rw.id}`.slice(0, 5), ...ff, kind: 'ff', alt: rw.elev + 8 * FT_PER_NM_3DEG + 50, altType: '@', spd: 160 });
        out.push({ ident: `RW${rw.id}`, lat: rw.lat, lon: rw.lon, kind: 'rwyArr', elev: rw.elev, alt: rw.elev + 50, altType: '@', hdgT: rw.hdgT });
      } else out.push({ ident: d.ident, lat: d.lat, lon: d.lon, kind: 'aptArr', elev: d.elev });
    }
    // Course (magnetic) and distance of each leg.
    for (let i = 1; i < out.length; i++) {
      const a = out[i - 1], b = out[i];
      b.dist = geo.dist(a, b);
      b.crs = Math.round((geo.brg(a, b) - nav.magVar(a) + 360) % 360) || 360;
    }
    return out;
  }

  // ── Performance ──
  const fuelT = () => (hooks.fuelKg?.() ?? 0) / 1000;
  const gw = () => (S.perf.zfw != null ? S.perf.zfw + fuelT() : null);
  function vspeeds(flaps = S.tko.flaps) {
    const w = gw();
    if (w == null) return null;
    const adj = { 1: 4, 5: 0, 10: -3, 15: -6, 25: -9 }[flaps] ?? 0;
    const v2 = Math.round(0.95 * w + 87 + adj);
    return { v1: v2 - 8, vr: v2 - 6, v2 };
  }
  function vref(flaps) {
    const w = gw();
    if (w == null) return null;
    return Math.round(1.08 * (w - fuelT() * 0.8) + 73 + ({ 15: 8, 30: 0, 40: -4 }[flaps] ?? 0));
  }
  const n1 = () => ({ to: +(96.4 - 0.15 * Math.max(0, (S.tko.selTemp ?? 15) - 15)).toFixed(1), clb: 94.6 });

  // ── Vertical profile and predictions ──
  function profile(r = R()) {
    const legs = legsOf(r);
    if (legs.length < 2 || !S.perf.crzAlt) return { legs, total: legs.reduce((a, l) => a + (l.dist || 0), 0) };
    const crz = S.perf.crzAlt;
    const start = legs[0].elev ?? 0;
    const end = legs[legs.length - 1];
    const endElev = end.elev ?? nav.airport(r.dest)?.elev ?? 0;
    // Climb: integrate 1,000 ft steps.
    let a = start, tc = 0, tcTime = 0;
    while (a < crz) {
      const step = Math.min(1000, crz - a), sp = fmcSpeed('climb', a);
      const tas = sp.ias ? tasOf(sp.ias, a) : sp.mach * soundKt(a);
      const mins = step / roc(a);
      tc += (tas * mins) / 60; tcTime += mins; a += step;
    }
    const total = legs.reduce((s, l) => s + (l.dist || 0), 0);
    const todFromEnd = (crz - endElev - 50) / FT_PER_NM_3DEG + 6;          // 3° path + a little to slow down
    const tod = Math.max(tc, total - todFromEnd);
    const crzTas = 0.78 * soundKt(crz);
    // Along-route distance → predicted altitude and time from takeoff (min).
    const altAt = (s) => {
      if (s <= tc) return start + (crz - start) * Math.pow(s / Math.max(1, tc), 0.7);
      if (s < tod) return crz;
      return Math.max(endElev + 50, crz - (s - tod) * FT_PER_NM_3DEG);
    };
    const timeAt = (s) => {
      if (s <= tc) return tcTime * (s / Math.max(1, tc));
      if (s <= tod) return tcTime + ((s - tc) / crzTas) * 60;
      return tcTime + ((tod - tc) / crzTas) * 60 + ((s - tod) / 330) * 60;
    };
    const burnAt = (s) => (timeAt(s) <= tcTime ? timeAt(s) * 85 : tcTime * 85 + (Math.min(timeAt(s), timeAt(tod)) - tcTime) * 40 + Math.max(0, timeAt(s) - timeAt(tod)) * 18) / 1000;
    let s = 0;
    for (const l of legs) { s += l.dist || 0; l.along = s; l.predAlt = Math.round(altAt(s) / 10) * 10; l.min = timeAt(s); l.burn = burnAt(s); }
    return { legs, total, tc, tod, crz, altAt, timeAt, burnAt, endElev, todFromEnd };
  }

  // ── Flying the route: distance to go, sequencing, direct-to ──
  function activeLegs() { return S.active ? legsOf(S.route) : []; }
  function sequence(ac) {
    const legs = activeLegs();
    if (!legs.length || !ac) return;
    while (S.activeIdx < legs.length - 1) {
      const to = legs[S.activeIdx], from = legs[S.activeIdx - 1];
      const d = geo.dist(ac, to);
      // Passed abeam, or inside the turn anticipation for the next leg.
      const next = legs[S.activeIdx + 1];
      const turn = Math.abs(geo.diff(geo.brg(from, to), geo.brg(to, next)));
      // Turn radius at 25° bank (NM) × tan(half the turn), plus a little margin.
      const radius = (ac.gs || 250) ** 2 / (68650 * Math.tan((25 * Math.PI) / 180));
      // Big turns (a reversal onto final) fly over the fix instead.
      const anticip = turn > 100 ? 0.3 : Math.min(5, radius * Math.tan((turn * Math.PI) / 360)) + 0.2;
      const along = geo.dist(from, ac) * Math.cos(((geo.brg(from, ac) - geo.brg(from, to)) * Math.PI) / 180);
      if (d < anticip || along > (to.dist || 0)) { S.activeIdx++; version++; } else break;
    }
  }
  /** Distance to go to the end of the route (NM) from the aircraft. */
  function dtg(ac) {
    const legs = activeLegs();
    if (!legs.length || !ac) return null;
    let d = geo.dist(ac, legs[S.activeIdx] || legs[legs.length - 1]);
    for (let i = S.activeIdx + 1; i < legs.length; i++) d += legs[i].dist || 0;
    return d;
  }

  // ── Route editing (used by the CDU) ──
  const api = {
    get version() { return version; },
    get S() { return S; },
    get mod() { return !!mod; },
    route: R,
    legs: () => legsOf(R()),
    activeLegs, profile, sequence, dtg, gw, fuelT, vspeeds, vref, n1, edit, changed,
    msg(m) { S.msg = m; version++; },
    clearMsg() { if (S.msg) { S.msg = ''; version++; } },
    setOrigin(icao) {
      if (!nav.airport(icao)) return 'NOT IN DATA BASE';
      edit((r) => { r.origin = icao; r.depRwy = null; });
      if (!S.refApt) S.refApt = icao;
      return null;
    },
    setDest(icao) { if (!nav.airport(icao)) return 'NOT IN DATA BASE'; edit((r) => { r.dest = icao; r.arrRwy = null; }); return null; },
    setDepRwy(id) { edit((r) => { r.depRwy = id; }); },
    setArrRwy(id) { edit((r) => { r.arrRwy = id; }); },
    /** Insert a waypoint before enroute index i (append when i is past the end). */
    insertWpt(i, text) {
      const ref = R().wpts[i - 1] || (R().origin && nav.airport(R().origin));
      const p = nav.point(text, ref);
      if (!p) return 'NOT IN DATA BASE';
      edit((r) => r.wpts.splice(Math.max(0, Math.min(i, r.wpts.length)), 0, { ident: p.ident, lat: p.lat, lon: p.lon, kind: 'wpt' }));
      return null;
    },
    deleteWpt(i) { edit((r) => r.wpts.splice(i, 1)); },
    setConstraint(i, text) {
      // "250/10000", "/FL240", "12000A", "FL350B", "/5000"
      const m = String(text).toUpperCase().match(/^(?:(\d{3})\/)?\/?(FL)?(\d{3,5})([AB]?)$/);
      if (!m) return 'INVALID ENTRY';
      let alt = +m[3];
      if (m[2] || alt < 1000) alt *= 100;
      if (alt > 41000) return 'INVALID ENTRY';
      edit((r) => { const w = r.wpts[i]; if (w) { w.alt = alt; w.altType = m[4] || '@'; if (m[1]) w.spd = +m[1]; } });
      return null;
    },
    /** DIRECT TO a waypoint: everything before it in the route is dropped. */
    directTo(text) {
      const r = R();
      const at = r.wpts.findIndex((w) => w.ident === String(text).toUpperCase());
      if (at >= 0) edit((m) => { m.wpts.splice(0, at); m.directFrom = true; });
      else {
        const ac = hooks.aircraft?.();
        const p = nav.point(text, ac);
        if (!p) return 'NOT IN DATA BASE';
        edit((m) => { m.wpts.unshift({ ident: p.ident, lat: p.lat, lon: p.lon, kind: 'wpt' }); m.directFrom = true; });
      }
      return null;
    },
    activate() { if (!mod) mod = clone(S.route); armed = true; version++; return null; },
    get execLit() { return !!mod && (S.active || armed); },
    exec() {
      if (!mod || !(S.active || armed)) return;
      armed = false;
      const wasActive = S.active;
      const ac = hooks.aircraft?.();
      const direct = mod.directFrom;
      delete mod.directFrom;
      S.route = mod; mod = null; S.active = true;
      // A direct-to (or an edit in flight) starts the active leg from the airplane.
      if (direct && ac && !ac.onGround) {
        S.route.wpts.unshift({ ident: 'PPOS', lat: ac.lat, lon: ac.lon, kind: 'ppos' });
        S.activeIdx = 2;
      } else if (!wasActive) S.activeIdx = 1;
      changed();
    },
    erase() { mod = null; armed = false; changed(); },
    /** VNAV vertical path (ft) for an along-track distance to go to the runway. */
    pathAlt(toGo) {
      const p = profile(S.route);
      if (!p.crz) return null;
      return Math.min(p.crz, p.endElev + 50 + toGo * FT_PER_NM_3DEG);
    },
    reset() { mod = null; Object.assign(S, { route: { flt: '', origin: null, dest: null, depRwy: null, arrRwy: null, wpts: [] }, active: false, activeIdx: 1, posSet: false }); changed(); },
  };
  return api;
}
