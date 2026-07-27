// timeline.js — the master clock every other module reads.
//
// One clock drives the map markers, the chart playhead, the live readouts and
// the video recorder, so nothing can drift out of sync. It runs in two modes:
//
//   absolute  the clock IS UTC epoch time. Two pilots who flew together appear
//             where they actually were relative to each other — who was high,
//             who got there first.
//   relative  the clock is "seconds since launch", per track. Flights from
//             different days line up at T=0 so you can compare line choices.
//
// The relative origin is *detected launch*, not the first fix in the file: a
// logger switched on 20 minutes early while the pilot lays out the wing would
// otherwise offset that pilot's whole flight.

import { sampleAt, launchIndex } from './metrics.js';

/** Transport rates offered by the UI. */
export const SPEEDS = [1, 2, 5, 10];

export class Timeline {
  constructor() {
    /** @type {import('../types').FlightTrack[]} */
    this.tracks = [];
    /** @type {import('../types').SyncMode} */
    this.mode = 'absolute';
    this.speed = 5;
    this.playing = false;
    this.time = 0;                 // current clock value, ms (see mode)
    this.start = 0;
    this.end = 0;
    this._hints = new Map();       // track.id → last point index, for O(1) sampling
    this._listeners = new Map();
    this._raf = 0;
    this._lastFrame = 0;
    this._range = null;            // { to, onDone } while playing a bounded clip
  }

  // ── wiring ────────────────────────────────────────────────────────────────

  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, new Set());
    this._listeners.get(event).add(cb);
    return () => this._listeners.get(event).delete(cb);
  }

  emit(event, payload) {
    const set = this._listeners.get(event);
    if (!set) return;
    for (const cb of set) {
      // One broken listener must not stop the clock — a thrown error inside a
      // rAF callback would silently kill playback.
      try { cb(payload); } catch (err) { console.error(`timeline:${event}`, err); }
    }
  }

  // ── tracks & domain ───────────────────────────────────────────────────────

  setTracks(tracks) {
    this.tracks = tracks || [];
    this._hints.clear();
    for (const t of this.tracks) this._origins(t);
    const before = this.time;
    this.recomputeDomain();
    // Keep the playhead where the pilot left it when a track is added/removed.
    this.time = this.start === this.end
      ? this.start
      : Math.min(this.end, Math.max(this.start, before || this.start));
    this.emit('domain', this.domain());
    this.emit('tick', this.snapshot());
  }

  /** Cache each track's absolute launch time and duration. */
  _origins(track) {
    if (track._origin !== undefined) return;
    const pts = track.points;
    const li = launchIndex(track);
    track._origin = pts[li].timestamp;
    track._endAbs = pts[pts.length - 1].timestamp;
  }

  recomputeDomain() {
    const active = this.active();
    if (!active.length) { this.start = 0; this.end = 0; return; }

    if (this.mode === 'absolute') {
      this.start = Math.min(...active.map((t) => t.points[0].timestamp));
      this.end = Math.max(...active.map((t) => t._endAbs));
    } else {
      // Relative: from the earliest pre-launch tail to the longest flight.
      this.start = Math.min(0, ...active.map((t) => t.points[0].timestamp - t._origin));
      this.end = Math.max(...active.map((t) => t._endAbs - t._origin));
    }
  }

  active() {
    return this.tracks.filter((t) => t.visible !== false);
  }

  domain() {
    return { start: this.start, end: this.end, span: Math.max(0, this.end - this.start) };
  }

  /**
   * Whether Absolute Time Sync actually says anything. Tracks flown on
   * different days produce a domain of days, with one glider on screen at a
   * time — the UI uses this to steer the pilot to Relative instead.
   */
  absoluteViable() {
    const active = this.active();
    if (active.length < 2) return true;
    const starts = active.map((t) => t._origin);
    return Math.max(...starts) - Math.min(...starts) < 12 * 3600 * 1000;
  }

  setSyncMode(mode) {
    if (mode === this.mode) return;
    // Preserve the *position within the flight* across the switch, rather than
    // dumping the pilot back to the start.
    const ref = this.active()[0];
    const abs = ref ? this.toAbsolute(ref, this.time) : null;
    this.mode = mode;
    this.recomputeDomain();
    if (ref && abs !== null) {
      this.time = mode === 'absolute' ? abs : abs - ref._origin;
    }
    this.time = Math.min(this.end, Math.max(this.start, this.time));
    this.emit('domain', this.domain());
    this.emit('state', this.state());
    this.emit('tick', this.snapshot());
  }

  /** Clock value → absolute epoch ms for a given track. */
  toAbsolute(track, clock = this.time) {
    return this.mode === 'absolute' ? clock : track._origin + clock;
  }

  /** Absolute epoch ms → clock value for a given track. */
  toClock(track, absMs) {
    return this.mode === 'absolute' ? absMs : absMs - track._origin;
  }

  // ── transport ─────────────────────────────────────────────────────────────

  play() {
    if (this.playing || this.end <= this.start) return;
    // Restarting from the very end feels like a broken button; loop instead.
    if (this.time >= this.end) this.time = this.start;
    this.playing = true;
    this._lastFrame = performance.now();
    this._raf = requestAnimationFrame(this._frame);
    this.emit('state', this.state());
  }

  pause() {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this._raf);
    this._raf = 0;
    if (this._range) { const r = this._range; this._range = null; if (r.onDone) r.onDone(false); }
    this.emit('state', this.state());
  }

  toggle() { this.playing ? this.pause() : this.play(); }

  setSpeed(x) {
    this.speed = SPEEDS.includes(x) ? x : 1;
    this.emit('state', this.state());
  }

  /** Absolute seek in clock units. */
  seek(clock) {
    const t = Math.min(this.end, Math.max(this.start, clock));
    if (t === this.time) return;
    // Sampling hints assume monotonic motion; a backwards seek invalidates them.
    if (t < this.time) this._hints.clear();
    this.time = t;
    this.emit('tick', this.snapshot());
  }

  /** Relative nudge, in flight-seconds (negative rewinds). */
  step(seconds) { this.seek(this.time + seconds * 1000); }

  /** 0–1 → clock, for the scrubber. */
  seekFraction(f) {
    const { start, span } = this.domain();
    this.seek(start + span * Math.min(1, Math.max(0, f)));
  }

  fraction() {
    const { start, span } = this.domain();
    return span > 0 ? (this.time - start) / span : 0;
  }

  rewindToStart() { this.seek(this.start); }

  /**
   * Play a bounded stretch and stop. Used by the export engine to render a
   * highlight clip, and by "preview this highlight" in the UI.
   * @param {number} from clock ms
   * @param {number} to   clock ms
   * @param {(completed:boolean)=>void} [onDone] false if interrupted
   */
  playRange(from, to, onDone) {
    this.pause();
    this._hints.clear();
    this.time = Math.min(this.end, Math.max(this.start, from));
    this._range = { to: Math.min(this.end, to), onDone };
    this.playing = true;
    this._lastFrame = performance.now();
    this._raf = requestAnimationFrame(this._frame);
    this.emit('state', this.state());
    this.emit('tick', this.snapshot());
  }

  _frame = (now) => {
    if (!this.playing) return;
    const dt = now - this._lastFrame;
    this._lastFrame = now;

    // A backgrounded tab hands back a huge dt on resume. Cap it so playback
    // resumes where it paused instead of teleporting to the end.
    this.time += Math.min(dt, 250) * this.speed;

    if (this._range && this.time >= this._range.to) {
      this.time = this._range.to;
      const done = this._range;
      this._range = null;
      this.playing = false;
      this._raf = 0;
      this.emit('tick', this.snapshot());
      this.emit('state', this.state());
      if (done.onDone) done.onDone(true);
      return;
    }

    if (this.time >= this.end) {
      this.time = this.end;
      this.playing = false;
      this._raf = 0;
      this.emit('tick', this.snapshot());
      this.emit('state', this.state());
      this.emit('ended');
      return;
    }

    this.emit('tick', this.snapshot());
    this._raf = requestAnimationFrame(this._frame);
  };

  // ── sampling ──────────────────────────────────────────────────────────────

  /**
   * Where every visible track is *right now*.
   * @returns {{track: import('../types').FlightTrack, sample: any}[]}
   *          `sample` is null for tracks not airborne at this clock value.
   */
  snapshot() {
    const out = [];
    for (const track of this.active()) {
      const abs = this.toAbsolute(track);
      const hint = this._hints.get(track.id) || 0;
      const sample = sampleAt(track, abs, hint);
      if (sample) this._hints.set(track.id, sample.index);
      out.push({ track, sample });
    }
    return { time: this.time, mode: this.mode, tracks: out };
  }

  state() {
    return {
      playing: this.playing, speed: this.speed, mode: this.mode,
      time: this.time, ...this.domain(), recording: !!this._range,
    };
  }

  // ── highlight navigation ──────────────────────────────────────────────────

  /**
   * Every highlight from every visible track, expressed on the current clock
   * and sorted — so ⏭ walks the reel across pilots, not just one track.
   */
  highlightStops() {
    const stops = [];
    for (const track of this.active()) {
      for (const h of track.highlights || []) {
        stops.push({ track, highlight: h, clock: this.toClock(track, h.timestamp) });
      }
    }
    return stops.sort((a, b) => a.clock - b.clock);
  }

  nextHighlight(dir = 1) {
    const stops = this.highlightStops();
    if (!stops.length) return null;
    // 1.5 s of slack so a double-tap doesn't stick on the same event.
    const guard = 1500;
    const found = dir > 0
      ? stops.find((s) => s.clock > this.time + guard)
      : [...stops].reverse().find((s) => s.clock < this.time - guard);
    if (!found) return null;
    this.seek(found.clock);
    return found;
  }
}
