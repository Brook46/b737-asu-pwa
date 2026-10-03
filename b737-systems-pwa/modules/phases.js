// phases.js — the four phase modes along the bottom (demoBee's Idle/Hover/Fly).
// Each phase sets the airframe pose, the attitude it floats at, and the
// environment every system's logic reads (engines running, airborne, flaps…).

export const PHASES = {
  ground: {
    label: 'Ground',
    note: 'At the gate · APU running · engines off',
    pose: { flaps: 0, slats: 0, gear: 1, speedbrake: 0, reverser: 0 },
    att: { y: 0, pitch: 0 }, fan: 0.35,
    env: { eng1: false, eng2: false, apu: true, gpu: true, air: false, flaps: 0, alt: 0, wheel: 0, gearDown: true },
  },
  takeoff: {
    label: 'Takeoff',
    note: 'Lift-off · flaps 5 · takeoff thrust · gear still down',
    pose: { flaps: 5, slats: 1, gear: 1, speedbrake: 0, reverser: 0 },
    att: { y: 2.6, pitch: 8 }, fan: 16,
    env: { eng1: true, eng2: true, apu: false, gpu: false, air: true, flaps: 5, alt: 300, wheel: 150, gearDown: true },
  },
  cruise: {
    label: 'Cruise',
    note: 'FL370 · clean wing · gear up',
    pose: { flaps: 0, slats: 0, gear: 0, speedbrake: 0, reverser: 0 },
    att: { y: 5, pitch: 2.2 }, fan: 13,
    env: { eng1: true, eng2: true, apu: false, gpu: false, air: true, flaps: 0, alt: 37000, wheel: 0, gearDown: false },
  },
  landing: {
    label: 'Landing',
    note: 'Rollout · flaps 30 · speedbrakes up · reversers deployed',
    pose: { flaps: 30, slats: 2, gear: 1, speedbrake: 1, reverser: 1 },
    att: { y: 0, pitch: 0 }, fan: 10,
    env: { eng1: true, eng2: true, apu: false, gpu: false, air: false, flaps: 30, alt: 0, wheel: 110, gearDown: true },
  },
};

export const PHASE_ORDER = ['ground', 'takeoff', 'cruise', 'landing'];

// Per-parameter timing [delay, duration] in seconds, so things happen in a
// believable order: attitude first, gear before flaps on the way up, brakes
// and reversers once the wheels are down.
const TIMING = {
  y: [0, 2.2], pitch: [0, 2.2], fan: [0, 2.5],
  gear: [0.2, 2.0], flaps: [0.9, 2.2], slats: [0.9, 1.6],
  speedbrake: [1.6, 0.6], reverser: [1.9, 1.0],
};
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);

export function createPhaseAnimator(airframe, world) {
  const cur = { flaps: 0, slats: 0, gear: 1, speedbrake: 0, reverser: 0, y: 0, pitch: 0, fan: 0.35 };
  let from = { ...cur }, to = { ...cur }, t = 0, active = false;

  function go(name, instant = false) {
    const p = PHASES[name];
    to = { ...p.pose, y: p.att.y, pitch: p.att.pitch, fan: p.fan };
    // Retracting reversers/speedbrakes should happen first, not last.
    from = { ...cur };
    t = 0;
    active = true;
    if (instant) { Object.assign(cur, to); active = false; apply(); }
  }

  function apply() {
    airframe.pose(cur);
    world.position.y = cur.y;
    world.rotation.z = cur.pitch * Math.PI / 180;
  }

  function frame(dt) {
    airframe.spinFans(dt, cur.fan);
    if (!active) return;
    t += dt;
    let done = true;
    for (const k in to) {
      let [d, dur] = TIMING[k] || [0, 2];
      // Stowing goes first.
      if ((k === 'reverser' || k === 'speedbrake') && to[k] < from[k]) d = 0;
      const kk = Math.min(1, Math.max(0, (t - d) / dur));
      if (kk < 1) done = false;
      cur[k] = from[k] + (to[k] - from[k]) * ease(kk);
    }
    apply();
    if (done) active = false;
  }

  return { go, frame, get state() { return cur; } };
}
