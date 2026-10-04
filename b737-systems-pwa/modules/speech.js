// speech.js — text-to-speech for lessons and quiz questions, and speech
// recognition for spoken answers. Both are browser features: TTS works in
// every modern browser (iOS Safari included); recognition is detected and
// the quiz falls back to tapping when it's missing or the mic is refused.

const synth = window.speechSynthesis;
let voice = null;
let rate = 1;
try { rate = Number(localStorage.getItem('b737i.rate')) || 1; } catch { /* default */ }

function pickVoice() {
  const vs = synth?.getVoices() || [];
  const en = vs.filter((v) => /^en[-_]/i.test(v.lang));
  // Prefer the higher-quality voices iOS / macOS ship, then any en-US.
  voice = en.find((v) => /premium|enhanced|natural|neural/i.test(v.name) && /en[-_]US/i.test(v.lang))
    || en.find((v) => /Samantha|Ava|Allison|Susan|Daniel|Karen/i.test(v.name))
    || en.find((v) => /en[-_]US/i.test(v.lang)) || en[0] || null;
}
if (synth) { pickVoice(); synth.addEventListener?.('voiceschanged', pickVoice); }

/** Make FCOM-style text sound right when read aloud. */
export function speakable(s) {
  return String(s)
    .replace(/\*\*/g, '')
    .replace(/\bFCOM [\dL][\d.]*\b/g, '')
    .replace(/(\d),(\d{3})/g, '$1$2')
    .replace(/≈\s*/g, 'about ').replace(/≥\s*/g, 'at least ').replace(/≤\s*/g, 'at most ')
    .replace(/±/g, 'plus or minus ').replace(/×\s*(\d)/g, 'times $1').replace(/−/g, 'minus ')
    .replace(/(\d)\s*°C/g, '$1 degrees').replace(/°C/g, 'degrees').replace(/°/g, ' degrees')
    .replace(/(\d)\s*kg\b/g, '$1 kilograms').replace(/(\d)\s*psid?\b/g, '$1 P S I').replace(/\bpsi\b/g, 'P S I')
    .replace(/ft\/min/g, 'feet per minute').replace(/(\d)\s*ft\b/g, '$1 feet').replace(/(\d)\s*kt\b/g, '$1 knots').replace(/(\d)\s*V\b/g, '$1 volts')
    .replace(/(\d)\s*Hz\b/g, '$1 hertz').replace(/(\d)\s*min\b/g, '$1 minutes').replace(/(\d)\s*l\b/g, '$1 litres')
    .replace(/(\d)\s*%/g, '$1 percent')
    .replace(/\bA\/B\b/g, 'A and B').replace(/\bLE\b/g, 'leading edge').replace(/\bTE\b/g, 'trailing edge')
    .replace(/\bEDP\b/g, 'engine driven pump').replace(/\bEMDP\b/g, 'electric pump').replace(/\bIDG\b/g, 'I D G')
    .replace(/\bBTBs?\b/g, 'bus tie breakers').replace(/\bTRs?\b/g, (m) => (m.endsWith('s') ? 'T Rs' : 'T R'))
    .replace(/[·•→]/g, ', ').replace(/[—–]/g, ', ').replace(/\s*\/\s*/g, ' or ')
    .replace(/\s{2,}/g, ' ').trim();
}

export const tts = {
  supported: !!synth,
  get rate() { return rate; },
  setRate(r) { rate = r; try { localStorage.setItem('b737i.rate', String(r)); } catch { /* fine */ } },
  /** Speak and resolve when finished (or cancelled). */
  speak(text, opts = {}) {
    return new Promise((resolve) => {
      if (!synth) return resolve(false);
      const said = speakable(text);
      const u = new SpeechSynthesisUtterance(said);
      if (voice) u.voice = voice;
      u.lang = voice?.lang || 'en-US';
      u.rate = rate;
      // Some engines (and iOS on long utterances) never fire 'end': give up
      // waiting after a generous estimate so a lesson can't stall.
      const words = said.split(/\s+/).length;
      const guard = setTimeout(() => done(true), ((words / (2.4 * rate)) + 4) * 1000);
      const done = (v) => { clearTimeout(guard); resolve(v); };
      // Word boundaries (iOS / macOS Safari, Chrome): report how far through.
      if (opts.onWord) u.onboundary = (e) => { if (e.name === 'word' || e.name == null) opts.onWord(e.charIndex / Math.max(1, said.length)); };
      u.onend = () => done(true);
      u.onerror = (e) => done(e.error === 'interrupted' || e.error === 'canceled' ? false : true);
      synth.speak(u);
    });
  },
  cancel() { synth?.cancel(); },
  pause() { synth?.pause(); },
  resume() { synth?.resume(); },
  get speaking() { return !!synth?.speaking; },
};

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const stt = {
  supported: !!SR,
  /** Listen once; resolves with the transcript, '' on silence, null if unavailable. */
  listen(timeoutMs = 7000) {
    return new Promise((resolve) => {
      if (!SR) return resolve(null);
      let done = false;
      const r = new SR();
      r.lang = 'en-US';
      r.interimResults = false;
      r.maxAlternatives = 3;
      const finish = (v) => { if (done) return; done = true; clearTimeout(t); try { r.stop(); } catch { /* already stopped */ } resolve(v); };
      r.onresult = (e) => {
        const alts = [...e.results[0]].map((a) => a.transcript);
        finish(alts.join(' | '));
      };
      r.onerror = (e) => finish(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? null : '');
      r.onend = () => finish('');
      const t = setTimeout(() => finish(''), timeoutMs);
      try { r.start(); } catch { finish(null); }
    });
  },
};
