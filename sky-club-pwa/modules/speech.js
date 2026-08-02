// speech.js — spoken names + facts for a pre-reading audience (Web Speech API,
// free, keyless, and works offline once the browser's voices are loaded).

const MUTE_KEY = 'skyclub.muted';

export function isMuted() {
  try { return localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

export function setMuted(muted) {
  try { localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch {}
  if (muted) stop();
}

export function stop() {
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/** Speak one or more short lines back-to-back. Cancels anything already speaking. */
export function say(...lines) {
  if (isMuted() || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const text = lines.filter(Boolean).join('. ');
  if (!text) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 0.92;
  utter.pitch = 1.05;
  speechSynthesis.speak(utter);
}
