// capture.js — turn a stream of laser readings into one trustworthy number.
//
// A laser on a hand-held or rig mount jitters by a few millimetres, and the
// first readings after re-aiming are often the previous line's. With the IR40
// in continuous mode we get a stream, so instead of trusting any single sample
// we wait for the recent window to agree and record its MEDIAN.

export const STABLE_SPAN_MM = 2;     // all samples in the window within ±1 mm of each other… (max-min ≤ 2)
export const STABLE_COUNT   = 3;     // …and at least this many of them
export const WINDOW_MS      = 2500;  // only recent samples count

export function createStabilizer({ span = STABLE_SPAN_MM, count = STABLE_COUNT, windowMs = WINDOW_MS } = {}) {
  let samples = [];   // [{ mm, t }]

  function prune(now) {
    samples = samples.filter(s => now - s.t <= windowMs).slice(-12);
  }

  return {
    reset() { samples = []; },

    /** Feed a reading; returns the current state. */
    push(mm, now = Date.now()) {
      samples.push({ mm, t: now });
      prune(now);
      return this.state(now);
    },

    state(now = Date.now()) {
      prune(now);
      if (!samples.length) return { status: 'idle', n: 0 };
      // look at the most recent `count` samples: are they tight?
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
