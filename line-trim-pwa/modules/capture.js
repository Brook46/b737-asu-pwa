// capture.js — turn laser readings into one trustworthy number per line.
//
// Meters behave two ways, and a pilot's own meter may do either:
//
//   SINGLE SHOT  one reading per button press (Bosch GLM/PLR, Leica DISTO, and the
//                IR40 when continuous mode doesn't take). A reading with no
//                follow-up is a deliberate measurement: capture it.
//   STREAM       continuous readings while aiming (IR40 continuous mode). The
//                first samples after re-aiming are often the previous line's, so
//                wait for the recent window to agree and record its MEDIAN.
//
// The first version only understood streams: a single-shot meter never produced
// three samples in a row, so the screen sat on "settling…" forever. The engine
// below tells the two apart by the gap between readings.
//
// Arming: after a capture, a stream still pointed at the same line would capture
// it again onto the next line. So a stream re-arms only once the beam moves; a
// single shot is always a fresh, intentional press and arms itself.

export const STABLE_SPAN_MM = 2;     // stream: recent samples within 2 mm of each other…
export const STABLE_COUNT   = 3;     // …at least this many of them
export const WINDOW_MS      = 2500;  // only recent samples count
export const QUIET_MS       = 900;   // no follow-up for this long = a single shot
export const MOVED_MM       = 15;    // a stream this far from the last capture has moved on

/** Steadiness of a stream (kept separate so it can be tested on its own). */
export function createStabilizer({ span = STABLE_SPAN_MM, count = STABLE_COUNT, windowMs = WINDOW_MS } = {}) {
  let samples = [];
  const prune = now => { samples = samples.filter(s => now - s.t <= windowMs).slice(-12); };
  return {
    reset() { samples = []; },
    push(mm, now = Date.now()) { samples.push({ mm, t: now }); prune(now); return this.state(now); },
    state(now = Date.now()) {
      prune(now);
      if (!samples.length) return { status: 'idle', n: 0 };
      const recent = samples.slice(-count).map(s => s.mm);
      const last = samples[samples.length - 1].mm;
      if (recent.length < count) return { status: 'settling', n: recent.length, last };
      const lo = Math.min(...recent), hi = Math.max(...recent);
      if (hi - lo > span) return { status: 'moving', n: recent.length, last, spread: hi - lo };
      const sorted = [...recent].sort((a, b) => a - b);
      return { status: 'stable', n: recent.length, last, value: sorted[sorted.length >> 1], spread: hi - lo };
    },
  };
}

/**
 * The capture engine. Feed readings with push(); call tick() on a timer so a
 * single shot is taken once it's clear no stream follows.
 * Both return { status, last, capture? } — capture = { value, via: 'single'|'steady' }.
 */
export function createCapture({ quietMs = QUIET_MS, movedMm = MOVED_MM, ...stabOpts } = {}) {
  const stab = createStabilizer(stabOpts);
  let lastAt = -Infinity;
  let burst = 0;              // readings since the last quiet gap
  let burstFresh = false;     // did this burst start after a quiet gap (a button press)?
  let pending = null;         // newest reading not yet captured
  let armed = true;
  let lastCaptured = null;

  function take(value, via) {
    armed = false;
    lastCaptured = value;
    pending = null;
    return { value, via };
  }

  return {
    get armed() { return armed; },
    /** Moving to another line: clear the window, but do NOT re-arm a stream. */
    reset() { stab.reset(); pending = null; burst = 0; burstFresh = false; },

    push(mm, now = Date.now()) {
      const fresh = now - lastAt > quietMs;       // first reading of a new press/burst
      lastAt = now;
      if (fresh) { stab.reset(); burst = 0; burstFresh = true; armed = true; }
      burst++;
      pending = mm;
      const st = stab.push(mm, now);
      if (!armed && (st.status === 'moving' || (lastCaptured != null && Math.abs(mm - lastCaptured) > movedMm))) armed = true;
      if (st.status === 'stable' && armed) return { status: 'captured', last: mm, capture: take(st.value, 'steady') };
      return { status: burst > 1 ? st.status : 'waiting', last: mm, armed };
    },

    tick(now = Date.now()) {
      if (pending == null || now - lastAt < quietMs) return null;
      // A quiet reading counts as a deliberate shot only if it wasn't the tail of
      // a stream that was still moving when it stopped.
      const st = stab.state(lastAt);
      // A single shot must follow a pause; a burst that is really the continuation
      // of a stream only counts once it has settled.
      const settled = (burstFresh && burst <= 2) || st.status === 'stable';
      if (armed && settled) return { status: 'captured', last: pending, capture: take(pending, 'single') };
      pending = null;
      return null;
    },
  };
}
