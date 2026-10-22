// sound.js — quiet space music, made with the Web Audio API (no audio files).
//
// In the spirit of the soundtrack of "2001: A Space Odyssey", but written for this
// app and played by synthesis, not copied from any recording:
//   • DAWN: a soft sunrise opening in the style of Strauss's "Also sprach
//     Zarathustra" (1896): a rising fifth, then the octave, then a major chord
//     that swells open. Played once, when the music first starts.
//   • WALTZ: then a slow waltz in the spirit of Strauss's "The Blue Danube" (1866):
//     a gentle "oom-pah-pah" under a rising arpeggio and a sparse music-box tune,
//     with a big, quiet hall of reverb around it so it feels like floating.
// Both pieces are public-domain compositions; the sound here is synthesised.
//
// Accents: a soft bell for a twinkle, a gentle glide for a shooting star, a
// two-note chime when you catch something. Everything follows the mute button, and
// the music ducks while a voice is speaking.
//
// Starting sound on iOS: a touch's pointerdown does NOT count as the gesture that
// lets audio start (pointerup / touchend / click do), so the listeners cover all of
// them, and any later tap also revives a context iOS has suspended or interrupted.

import { isMuted } from './speech.js?v=28';

const MUSIC_LEVEL = 0.16;   // the whole background: low on purpose
const DUCKED = 0.35;        // share of that level while a voice is speaking
const BEAT = 60 / 72;       // a slow waltz: 72 quarter-note beats a minute, 3 to a bar

// Four chords in D major, two bars each: D, A, Bm, G (MIDI notes, low to high).
const CHORDS = [
  [50, 54, 57, 62],
  [45, 52, 57, 61],
  [47, 54, 59, 62],
  [43, 50, 59, 62],
];
// The tune: D major pentatonic, high, like a music box.
const MELODY = [74, 76, 78, 81, 83, 86];

let ctx = null, master = null, music = null, hall = null;
let started = false, dawnDone = false;
let nextTime = 0, beat = 0, melodyIdx = 2;
let target = -1;            // the music level we are heading for

const m2f = (m) => 440 * Math.pow(2, (m - 69) / 12);

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  // Mix with other audio and respect the silent switch (Safari 16.4+).
  try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch {}
  return ctx;
}

// A big, soft room: a burst of noise that fades over ~2.6 s, left and right
// different, so sounds seem to float around you.
function makeHall() {
  const len = Math.floor(ctx.sampleRate * 2.6);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
  }
  const conv = ctx.createConvolver();
  conv.buffer = buf;
  return conv;
}

function fadeMusicTo(level, seconds) {
  if (!music || level === target) return;
  target = level;
  const t = ctx.currentTime;
  music.gain.cancelScheduledValues(t);
  music.gain.setValueAtTime(music.gain.value, t);
  music.gain.linearRampToValueAtTime(level, t + seconds);
}

const speaking = () => 'speechSynthesis' in window && speechSynthesis.speaking;
const wantedLevel = () => (isMuted() ? 0 : speaking() ? MUSIC_LEVEL * DUCKED : MUSIC_LEVEL);

// A soft held note that swells in and fades out, like strings or a distant horn.
function swell(midi, when, dur, peak, attack = 0.7, wave = 'triangle') {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(peak, when + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  g.connect(music);
  for (const detune of [-5, 5]) {
    const o = ctx.createOscillator();
    o.type = wave;
    o.frequency.value = m2f(midi);
    o.detune.value = detune;
    o.connect(g);
    o.start(when);
    o.stop(when + dur + 0.1);
  }
}

// A short, round note: the "oom" of the waltz (low) or its soft "pah" (higher).
function pluck(midi, when, peak, decay) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(peak, when + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
  g.connect(music);
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.value = m2f(midi);
  o.connect(g);
  o.start(when);
  o.stop(when + decay + 0.1);
}

// A music-box note: a sine with a faint octave, dying away.
function boxNote(midi, when, peak = 0.055, decay = 1.8) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(peak, when + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
  g.connect(music);
  const a = ctx.createOscillator();
  a.type = 'sine';
  a.frequency.value = m2f(midi);
  a.connect(g);
  a.start(when);
  a.stop(when + decay + 0.1);
  const b = ctx.createOscillator();
  b.type = 'sine';
  b.frequency.value = m2f(midi) * 2;
  const bg = ctx.createGain();
  bg.gain.value = 0.18;
  b.connect(bg);
  bg.connect(g);
  b.start(when);
  b.stop(when + decay + 0.1);
}

// The tune walks in small steps and lands on a note of the chord on each downbeat.
function nextMelodyNote(chord, downbeat) {
  const step = [-2, -1, -1, 1, 1, 2][Math.floor(Math.random() * 6)];
  melodyIdx = Math.max(0, Math.min(MELODY.length - 1, melodyIdx + step));
  if (downbeat) {
    const fits = (i) => chord.some((n) => (n - MELODY[i]) % 12 === 0);
    for (const d of [0, 1, -1, 2, -2]) {
      const i = melodyIdx + d;
      if (i >= 0 && i < MELODY.length && fits(i)) { melodyIdx = i; break; }
    }
  }
  return MELODY[melodyIdx];
}

// The sunrise opening, in D: a rising fifth, then the octave, then a major chord
// that opens slowly. Returns how long it lasts, in seconds.
function playDawn(t0) {
  swell(50, t0, 1.9, 0.07, 0.5);              // D
  swell(57, t0 + 1.8, 1.9, 0.07, 0.5);        // A, a fifth up
  swell(62, t0 + 3.6, 3.4, 0.08, 0.5);        // D, the octave
  [50, 57, 62, 66, 69].forEach((n, i) => swell(n, t0 + 4.6, 5.2, 0.03, 2.2, i < 2 ? 'triangle' : 'sine'));
  return 9.6;
}

// Plays the waltz a little ahead of time, so the timing never wobbles.
function scheduleAhead() {
  if (!ctx || !started) return;
  setTimeout(scheduleAhead, 200);
  if (ctx.state !== 'running') return;
  // After a pause (timers throttle in the background), skip ahead rather than
  // playing every missed note at once.
  if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.1;
  fadeMusicTo(wantedLevel(), 0.5);
  while (nextTime < ctx.currentTime + 0.6) {
    const bar = Math.floor(beat / 3);
    const chord = CHORDS[Math.floor(bar / 2) % CHORDS.length];
    const inBar = beat % 3;
    if (beat % 6 === 0) chord.forEach((n) => swell(n, nextTime, BEAT * 6 + 0.8, 0.03, 1.4));
    if (inBar === 0) pluck(chord[0], nextTime, 0.07, 0.9);                       // oom
    else pluck(chord[1 + (inBar % 2) * 2], nextTime, 0.022, 0.45);               // pah
    // A gentle rising arpeggio at the start of each chord, like the Danube's own.
    if (beat % 6 < 3 && Math.random() < 0.55) {
      const arp = [chord[1] + 24, chord[2] + 24, chord[3] + 24][inBar];
      boxNote(arp, nextTime, 0.04, 1.6);
    } else if (inBar !== 0 && Math.random() < 0.3) {
      boxNote(nextMelodyNote(chord, false), nextTime + (Math.random() < 0.3 ? BEAT * 0.5 : 0));
    } else if (inBar === 0 && beat % 6 === 3 && Math.random() < 0.8) {
      boxNote(nextMelodyNote(chord, true), nextTime);
    }
    nextTime += BEAT;
    beat++;
  }
}

function startMusic() {
  if (!ctx || started) return;
  started = true;
  music = ctx.createGain();
  music.gain.value = 0;
  // Warm it up: take off the harsh top end, so it stays soft in any room.
  const warm = ctx.createBiquadFilter();
  warm.type = 'lowpass';
  warm.frequency.value = 2600;
  warm.Q.value = 0.5;
  music.connect(warm);
  warm.connect(master);
  // ...and send some of it through the hall.
  hall = makeHall();
  const send = ctx.createGain();
  send.gain.value = 0.55;
  warm.connect(send);
  send.connect(hall);
  hall.connect(master);

  let t0 = ctx.currentTime + 0.3;
  if (!dawnDone && !isMuted()) { dawnDone = true; t0 += playDawn(t0) - 1.2; }
  nextTime = t0;
  beat = 0;
  target = -1;
  fadeMusicTo(wantedLevel(), 1.6);
  scheduleAhead();
}

function canPlay() {
  return ctx && ctx.state === 'running' && !isMuted();
}

// A bell: a sine with a soft overtone. Used for twinkles and the chime.
function bell(freq, peak = 0.05, decay = 1.4) {
  const t = ctx.currentTime;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
  g.connect(master);
  const a = ctx.createOscillator();
  a.type = 'sine';
  a.frequency.value = freq;
  a.connect(g);
  a.start(t);
  a.stop(t + decay + 0.1);
  const o = ctx.createGain();
  o.gain.value = 0.2;
  o.connect(g);
  const b = ctx.createOscillator();
  b.type = 'sine';
  b.frequency.value = freq * 2;
  b.connect(o);
  b.start(t);
  b.stop(t + decay + 0.1);
}

const TWINKLE_NOTES = [1174.66, 1318.5, 1480, 1760, 1975.5, 2349.3]; // D major, high

/** A star twinkling: one soft high bell. */
export function playTwinkle() {
  if (!canPlay()) return;
  bell(TWINKLE_NOTES[Math.floor(Math.random() * TWINKLE_NOTES.length)], 0.03, 1.6);
}

/** A shooting star: a soft sine glide falling in pitch. No hiss. */
export function playWhoosh() {
  if (!canPlay() || document.hidden) return;
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  o.type = 'sine';
  o.frequency.setValueAtTime(1500, t);
  o.frequency.exponentialRampToValueAtTime(520, t + 1.1);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.025, t + 0.25);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
  o.connect(g);
  g.connect(master);
  o.start(t);
  o.stop(t + 1.3);
}

/** Catching something: a happy two-note chime. */
export function playChime() {
  if (!canPlay()) return;
  bell(880, 0.06, 0.9);
  setTimeout(() => bell(1318.5, 0.05, 1.2), 140);
}

// Occasional twinkles while the Sky screen is showing.
function scheduleTwinkles() {
  setTimeout(() => {
    const sky = document.getElementById('sky-screen');
    if (sky && sky.classList.contains('active') && !document.hidden) playTwinkle();
    scheduleTwinkles();
  }, 3000 + Math.random() * 5000);
}

/** Call once at startup. Sound starts on the first tap, as browsers require. */
export function initSound() {
  if (initSound.armed) return;
  initSound.armed = true;
  const unlock = () => {
    if (isMuted() || document.hidden) return;
    ensureContext();
    if (!ctx) return;
    if (ctx.state !== 'running') ctx.resume?.().catch(() => {});
    if (!started) { startMusic(); scheduleTwinkles(); }
  };
  for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
    document.addEventListener(type, unlock, { passive: true, capture: true });
  }
  // Silence in the background (saves battery); come back when the app does.
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) ctx.suspend?.().catch(() => {});
    else if (!isMuted()) ctx.resume?.().catch(() => {});
  });
}

/** Call after the mute button changes: fades the music out (then stops) or back in. */
export function syncMute() {
  if (!ctx) {
    // Unmuting is itself a tap, so sound may start here if it never has.
    if (isMuted()) return;
    ensureContext();
    if (!ctx) return;
  }
  if (isMuted()) {
    fadeMusicTo(0, 0.4);
    setTimeout(() => { if (isMuted()) ctx.suspend?.().catch(() => {}); }, 500);
  } else {
    ctx.resume?.().catch(() => {});
    if (!started) { startMusic(); scheduleTwinkles(); }
    fadeMusicTo(wantedLevel(), 0.8);
  }
}
