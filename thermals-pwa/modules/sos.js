// sos.js — distress audio. Synthesised with Web Audio so there's no asset to
// ship and no autoplay file to fetch. startSiren() wails until stopSiren();
// alertBeep() is a short two-tone for when *another* pilot raises an SOS.

let ctx = null;
let siren = null; // { osc, lfo, gain }

function audio() {
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return null;
  if (!ctx) ctx = new Ctor();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

// A rising/falling wail: an LFO sweeps the main oscillator's frequency.
export function startSiren() {
  if (siren) return;
  const ac = audio();
  if (!ac) return;
  const osc = ac.createOscillator();
  osc.type = 'sawtooth';
  osc.frequency.value = 900;

  const lfo = ac.createOscillator();      // sweep ~3 Hz
  lfo.type = 'sine';
  lfo.frequency.value = 3;
  const lfoGain = ac.createGain();
  lfoGain.gain.value = 350;               // ±350 Hz swing
  lfo.connect(lfoGain).connect(osc.frequency);

  const gain = ac.createGain();
  gain.gain.value = 0.0001;
  osc.connect(gain).connect(ac.destination);
  gain.gain.exponentialRampToValueAtTime(0.25, ac.currentTime + 0.15);

  osc.start();
  lfo.start();
  siren = { osc, lfo, gain };
}

export function stopSiren() {
  if (!siren) return;
  const ac = audio();
  const { osc, lfo, gain } = siren;
  try {
    gain.gain.cancelScheduledValues(ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + 0.2);
    osc.stop(ac.currentTime + 0.25);
    lfo.stop(ac.currentTime + 0.25);
  } catch { /* already stopped */ }
  siren = null;
}

export function isSirenOn() { return !!siren; }

// Short two-tone alert for an incoming SOS from another pilot.
export function alertBeep() {
  const ac = audio();
  if (!ac) return;
  const now = ac.currentTime;
  [ [880, 0], [1320, 0.18] ].forEach(([f, t]) => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = 'square';
    o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, now + t);
    g.gain.exponentialRampToValueAtTime(0.2, now + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + t + 0.16);
    o.connect(g).connect(ac.destination);
    o.start(now + t);
    o.stop(now + t + 0.18);
  });
}

export function vibrate(pattern) {
  try { navigator.vibrate?.(pattern); } catch { /* unsupported */ }
}
