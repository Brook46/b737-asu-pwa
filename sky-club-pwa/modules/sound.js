// sound.js — a quiet music loop, made with the Web Audio API (no audio files).
//
// Background: a slow, soft chord pattern under a sparse music-box melody, played
// very quietly through a warm filter, so it sits behind everything else. It dips
// further while a voice is speaking. Accents: a soft bell for a twinkle, a gentle
// glide for a shooting star, and a two-note chime when you catch something.
// Everything follows the mute button.
//
// Starting sound on iOS: only some gestures count. A touch's pointerdown does
// NOT (the spec's activation events for touch are pointerup/touchend/click), so
// the listeners stay on every gesture kind, and any later tap also revives a
// context iOS has suspended or interrupted (a call, the app going to background).

import { isMuted } from './speech.js?v=25';

const MUSIC_LEVEL = 0.16;   // the whole background: low on purpose
const DUCKED = 0.35;        // share of that level while a voice is speaking
const TEMPO = 66;           // beats per minute: slow and calm
const BEAT = 60 / TEMPO;

// Chords as MIDI notes: Cmaj7, Am7, Fmaj7, Gsus4. Every melody note fits all of
// them (the old G chord had an F♯ that rubbed against the melody's G and C).
const CHORDS = [
  [48, 52, 55, 59],
  [45, 48, 52, 55],
  [41, 45, 48, 52],
  [43, 48, 50, 55],
];
// Melody: C major pentatonic, high, like a music box.
const MELODY = [72, 74, 76, 79, 81, 84];

let ctx = null, master = null, music = null;
let started = false;
let nextTime = 0, beat = 0, melodyIdx = 2;
let target = 0;             // the music level we are heading for

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

// One soft pad note: a triangle wave, slow in and slow out.
function padNote(midi, when, dur) {
  const o = ctx.createOscillator();
  o.type = 'triangle';
  o.frequency.value = m2f(midi);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(0.035, when + 1.2);
  g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
  o.connect(g);
  g.connect(music);
  o.start(when);
  o.stop(when + dur + 0.1);
}

// One music-box note: a sine with a faint octave, dying away.
function boxNote(midi, when, peak = 0.06, decay = 1.8) {
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

// The melody walks in small steps (a tune, not random notes), and on the first
// beat of each chord it settles on a note of that chord.
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

// Plays the music a little ahead of time, so the timing never wobbles.
function scheduleAhead() {
  if (!ctx || !started) return;
  setTimeout(scheduleAhead, 200);
  if (ctx.state !== 'running') return;
  // After a pause (timers throttled in the background), skip ahead rather than
  // playing every missed note at once.
  if (nextTime < ctx.currentTime) nextTime = ctx.currentTime + 0.1;
  fadeMusicTo(wantedLevel(), 0.5);
  while (nextTime < ctx.currentTime + 0.6) {
    const chord = CHORDS[Math.floor(beat / 4) % CHORDS.length];
    const downbeat = beat % 4 === 0;
    if (downbeat) chord.forEach((n) => padNote(n, nextTime, BEAT * 4 + 0.8));
    // A melody note on most first beats and some others; rests make it breathe.
    if (Math.random() < (downbeat ? 0.85 : 0.4)) {
      boxNote(nextMelodyNote(chord, downbeat), nextTime + (!downbeat && Math.random() < 0.3 ? BEAT * 0.5 : 0));
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
  warm.frequency.value = 2400;
  warm.Q.value = 0.5;
  music.connect(warm);
  warm.connect(master);
  nextTime = ctx.currentTime + 0.3;
  target = -1;
  fadeMusicTo(wantedLevel(), 4);
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

const TWINKLE_NOTES = [1046.5, 1174.66, 1318.5, 1567.98, 1760, 2093];

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
