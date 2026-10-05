// learn.js — learning by voice, and keeping track of it.
//
//   • Dashboard (in the page sheet): progress per system and per page, what
//     isn't learned yet, what needs review, and buttons to listen or quiz.
//   • Lessons: pages read aloud one after another; the 3D view and the page
//     follow along. A page counts as heard once it's been read to the end.
//   • Voice quiz: questions read aloud; answer by voice ("B", "bravo", or the
//     answer itself) or by tapping. Spoken feedback, then the next question.

import { tts, stt, speakable } from './speech.js?v=15';
import { QUESTIONS } from './quizbank.js?v=15';
import { createReader, sentencesOf } from './reader.js?v=15';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plain = (s) => String(s).replace(/\*\*/g, '');
const LETTERS = ['A', 'B', 'C', 'D'];
const ST_LABEL = { new: 'New', seen: 'Seen', learning: 'Learning', learned: 'Learned', review: 'Review' };
const pref = {
  get(k, d) { try { const v = localStorage.getItem('b737i.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('b737i.' + k, JSON.stringify(v)); } catch { /* fine */ } },
};

// Spoken numbers → digits: "three thousand five hundred" → 3500,
// "seven point eight" → 7.8, "twenty two" → 22.
const UNITS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
function wordsToDigits(t) {
  const w = t.split(' ');
  const out = [];
  for (let i = 0; i < w.length;) {
    if (!(w[i] in UNITS || w[i] in TENS)) { out.push(w[i]); i++; continue; }
    let total = 0, cur = 0, j = i, dec = '';
    for (; j < w.length; j++) {
      const x = w[j];
      if (x in UNITS) cur += UNITS[x];
      else if (x in TENS) cur += TENS[x];
      else if (x === 'hundred') cur *= 100;
      else if (x === 'thousand') { total += (cur || 1) * 1000; cur = 0; }
      else if (x === 'and') continue;
      else if (x === 'point' && j + 1 < w.length && w[j + 1] in UNITS) {
        for (j++; j < w.length && w[j] in UNITS && UNITS[w[j]] < 10; j++) dec += UNITS[w[j]];
        break;
      } else break;
    }
    out.push(String(total + cur) + (dec ? '.' + dec : ''));
    i = j;
  }
  return out.join(' ');
}

/** Work out which choice a spoken answer means (or -1). */
export function parseAnswer(transcript, choices) {
  if (!transcript) return -1;
  const norm = (s) => s.toLowerCase().replace(/(\d),(\d{3})/g, '$1$2').replace(/[^a-z0-9.% ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const alts = transcript.split('|').map(norm).filter(Boolean);
  const letters = { alpha: 0, alfa: 0, bravo: 1, charlie: 2, delta: 3, first: 0, second: 1, third: 2, fourth: 3 };
  for (const t of alts) {
    // Explicit letter: "B", "answer b", "option c", "letter d", "bravo", "the second".
    const m = t.match(/^(?:answer|option|letter|it'?s|its|the answer is)?\s*([abcd])$/) || t.match(/\b(?:answer|option|letter)\s+([abcd])\b/);
    if (m) return m[1].charCodeAt(0) - 97;
    for (const [w, i] of Object.entries(letters)) if (new RegExp(`\\b${w}\\b`).test(t) && t.split(' ').length <= 3) return i;
  }
  // Otherwise match the content of the choices (numbers weigh most).
  // Numbers compare by value (7.80 = 7.8); short words carry no meaning.
  const tok = (s) => norm(s).split(' ').filter((x) => x.length > 2 || /\d/.test(x))
    .map((x) => (/^\d+(\.\d+)?%?$/.test(x) ? String(parseFloat(x)) : x));
  const spoken = alts.map((t) => new Set(tok(wordsToDigits(t))));
  let best = -1, bestS = 0, second = 0;
  choices.forEach((c, i) => {
    const ct = tok(c);
    let sc = 0;
    for (const tt of spoken) {
      let s = 0;
      for (const x of ct) if (tt.has(x)) s += /\d/.test(x) ? 3 : 1;
      sc = Math.max(sc, s / Math.max(2, ct.length * 0.6));
    }
    if (sc > bestS) { second = bestS; bestS = sc; best = i; } else if (sc > second) second = sc;
  });
  if (bestS >= 0.5 && bestS > second * 1.3) return best;
  // A bare "one"…"four" means a position when it isn't a number in the choices.
  for (const t of alts) {
    const d = wordsToDigits(t);
    if (/^[1-4]$/.test(d) && !choices.some((c) => tok(c).includes(d))) return Number(d) - 1;
  }
  return -1;
}

export function createLearn({ systems, progress, describe, goTo, sheet, els }) {
  const sysOf = (id) => systems.find((s) => s.id === id)?.mod;
  const keysOf = (s) => [s.id, ...s.mod.parts.map((p) => `${s.id}/${p.id}`)];
  const allKeys = () => systems.flatMap(keysOf);
  // ── Dashboard ──
  /** Voice picker: best voices first, with a sample. */
  function voiceBox() {
    if (!tts.supported) return '';
    const vs = tts.voices().slice(0, 14), cur = tts.voiceName;
    const ios = /iPhone|iPad|Macintosh/.test(navigator.userAgent);
    return `<div class="lp-voice">
      <label>Voice <select data-voice>${vs.map((v) => `<option value="${esc(v.name)}" ${v.name === cur ? 'selected' : ''}>${esc(v.name)}${v.good ? ' ★' : ''} · ${esc(v.lang)}</option>`).join('')}</select></label>
      <button class="tag tag-btn" data-act="sample">▶ Hear it</button>
      ${tts.onlyBasic ? `<p class="note-src">Only basic voices are installed. For a much more natural voice ${ios
        ? 'on iPhone / iPad / Mac: Settings → Accessibility → Spoken Content (or Live Speech) → Voices → English → download e.g. <b>Ava (Premium)</b> or <b>Zoe (Premium)</b>, then reopen the app.'
        : 'install a Natural / Premium English voice in your system\'s speech settings, or use Chrome / Edge, which bring online voices.'}</p>` : '<p class="note-src">★ = natural-sounding voice.</p>'}
    </div>`;
  }

  function dashboard() {
    const tot = progress.summary(allKeys());
    const acc = tot.answered ? Math.round((100 * tot.correct) / tot.answered) : null;
    const bar = (c) => `<div class="lp-bar">${['learned', 'review', 'learning', 'seen'].map((k) =>
      `<span class="st-${k}" style="width:${(100 * c[k]) / Math.max(1, c.total)}%"></span>`).join('')}</div>`;
    const html = `
      <div class="kicker">Learn · saved on this device</div>
      <h2>Your progress</h2>
      <div class="lp-big"><b>${tot.pct}%</b> learned <span>${tot.learned} of ${tot.total} pages${acc != null ? ` · quiz ${acc}% right (${tot.answered} answers)` : ''}</span></div>
      ${bar(tot)}
      <div class="lp-legend">${['learned', 'review', 'learning', 'seen', 'new'].map((k) => `<span><i class="dot st-${k}"></i>${ST_LABEL[k]} ${tot[k]}</span>`).join('')}</div>
      ${voiceBox()}
      <div class="lp-actions">
        <button class="tag tag-btn lp-main" data-act="continue">▶ Continue — listen to what you haven't learned</button>
        <button class="tag tag-btn lp-main" data-act="quiz">🎤 Voice quiz · 10 questions</button>
      </div>
      ${systems.map((s) => {
        const keys = keysOf(s), c = progress.summary(keys);
        return `<h3><span class="swatch" style="background:${s.mod.color}"></span>${esc(s.mod.title)} · ${c.pct}%</h3>
          ${bar(c)}
          <div class="lp-actions">
            <button class="tag tag-btn" data-act="listen" data-sys="${s.id}">▶ Listen to all ${s.mod.parts.length + 1} pages</button>
            <button class="tag tag-btn" data-act="quiz" data-sys="${s.id}">🎤 Quiz</button>
          </div>
          <div class="lp-pages">${keys.map((k) => {
            const st = progress.status(k), d = describe(k);
            return `<div class="lp-row"><button class="lp-page" data-go="${k}"><i class="dot st-${st}"></i>${esc(k.includes('/') ? d.title : 'Overview')}<em>${ST_LABEL[st]}</em></button><button class="lp-play" data-act="listen-from" data-key="${k}" aria-label="Listen from ${esc(d.title)}">▶</button></div>`;
          }).join('')}</div>`;
      }).join('')}
      <p class="note-src">A page is <b>learned</b> when you've answered all of its questions right (pages without questions: when you've listened to it to the end). Learned pages come back for review after two weeks.
      ${stt.supported ? 'Answer quiz questions by voice: say the letter (“B” or “bravo”) or the answer.' : 'Voice answers aren\'t available in this browser — questions are still read aloud; tap to answer.'}</p>
      <p><button class="tag tag-btn" data-act="reset" style="opacity:.7">Reset progress</button></p>`;
    sheet.custom(html, 'learn');
  }

  /** This page and the rest of its system, in order. */
  const fromHere = (key) => {
    const sid = key.split('/')[0];
    const keys = keysOf(systems.find((x) => x.id === sid));
    return keys.slice(Math.max(0, keys.indexOf(key)));
  };
  els.body.addEventListener('change', (e) => {
    const sel = e.target.closest('[data-voice]');
    if (sel) { tts.setVoice(sel.value); tts.cancel(); tts.speak('This is the voice for your lessons.'); }
  });
  els.body.addEventListener('click', (e) => {
    const l = e.target.closest('[data-listen]');
    if (l && sheet.key) { playKeys(fromHere(sheet.key)); return; }
    // During a lesson, tapping a sentence on the page being read jumps there.
    if (!els.player.hidden && sheet.key === P.keys[P.i] && !e.target.closest('button, a, mark')) {
      const i = reader.indexAt(P.sents, e.target);
      if (i >= 0) { seek(P.i, i); return; }
    }
    const b = e.target.closest('[data-act]');
    if (!b || sheet.key !== 'learn') return;
    if (b.dataset.act === 'listen-from') { playKeys(fromHere(b.dataset.key)); return; }
    if (b.dataset.act === 'sample') { tts.cancel(); tts.speak('Hydraulic system B powers the trailing edge flaps. If it is lost, use alternate flaps — slow, electric, and extend only.'); return; }
    const sys = b.dataset.sys || null;
    if (b.dataset.act === 'listen') playKeys(keysOf(systems.find((s) => s.id === sys)));
    else if (b.dataset.act === 'continue') {
      const todo = allKeys().filter((k) => !['learned'].includes(progress.status(k)));
      playKeys(todo.length ? todo : allKeys());
    } else if (b.dataset.act === 'quiz') startQuiz(sys);
    else if (b.dataset.act === 'reset' && confirm('Reset all learning progress on this device?')) { progress.reset(); dashboard(); }
  });

  // ── Lesson player: reads the page on screen, sentence by sentence ──
  const reader = createReader();
  const P = { keys: [], i: 0, s: 0, sents: [], loaded: null, playing: false, token: 0 };
  function showPlayer(v) { els.player.hidden = !v; document.body.classList.toggle('has-player', v); if (!v) reader.clear(); }
  function paintPlayer() {
    const key = P.keys[P.i];
    if (!key) return;
    const d = describe(key);
    els.plK.textContent = `${P.i + 1} / ${P.keys.length} · ${d.sub || ''}`;
    els.plT.textContent = key.includes('/') ? d.title : `${d.title} — overview`;
    els.plPlay.textContent = P.playing ? '❚❚' : '▶\uFE0E';
    els.plProg.style.width = `${(100 * P.s) / Math.max(1, P.sents.length)}%`;
  }
  function paintRate() {
    els.plRate.value = String(tts.rate);
    els.plRateV.textContent = `${tts.rate.toFixed(2)}×`;
  }
  /** Open page i (if it isn't already) and collect its sentences. */
  function load(i) {
    const key = P.keys[i];
    if (P.loaded !== key || !P.sents[0]?.block.isConnected) {
      goTo(key);
      P.sents = sentencesOf(els.body);
      P.loaded = key;
    }
  }
  async function play() {
    const my = ++P.token;
    if (!P.keys[P.i]) return stop();
    load(P.i);
    P.playing = true;
    paintPlayer();
    for (; P.s < P.sents.length; P.s++) {
      const s = P.sents[P.s];
      reader.sentence(s);
      paintPlayer();
      await tts.speak(s.text, { onWord: (f) => { if (my === P.token) reader.word(s, f); } });
      if (my !== P.token) return;          // moved, paused or stopped
    }
    reader.clear();
    progress.markHeard(P.keys[P.i]);
    if (P.i < P.keys.length - 1) { P.i++; P.s = 0; play(); }
    else { P.playing = false; P.s = 0; paintPlayer(); tts.speak('That\'s the end of this lesson.'); }
  }
  /** Jump to page i, sentence s: keep playing if playing, else just show it. */
  function seek(i, s) {
    P.token++;
    tts.cancel();
    P.i = Math.max(0, Math.min(P.keys.length - 1, i));
    load(P.i);
    P.s = Math.max(0, Math.min(P.sents.length - 1, s));
    if (P.playing) play();
    else { reader.sentence(P.sents[P.s]); paintPlayer(); }
  }
  function playKeys(keys) {
    if (!keys.length) return;
    tts.cancel();
    P.keys = keys; P.i = 0; P.s = 0; P.loaded = null;
    showPlayer(true);
    paintRate();
    play();
  }
  function pause() { P.token++; P.playing = false; tts.cancel(); paintPlayer(); }
  function stop() { P.token++; P.playing = false; tts.cancel(); showPlayer(false); }
  els.plPlay.addEventListener('click', () => (P.playing ? pause() : play()));
  els.plBack.addEventListener('click', () => {
    if (P.s > 0) seek(P.i, P.s - 1);
    else if (P.i > 0) { const i = P.i - 1; P.loaded = null; load(i); seek(i, P.sents.length - 1); }
  });
  els.plFwd.addEventListener('click', () => {
    if (P.s < P.sents.length - 1) seek(P.i, P.s + 1);
    else if (P.i < P.keys.length - 1) seek(P.i + 1, 0);
  });
  els.plPrev.addEventListener('click', () => seek(P.s > 1 ? P.i : P.i - 1, 0));
  els.plNext.addEventListener('click', () => seek(P.i + 1, 0));
  // Speed: slider plus − / + in 0.05 steps; applies from the current sentence.
  let rateT = 0;
  const setRate = (r) => {
    tts.setRate(Math.round(Math.max(0.5, Math.min(2, r)) * 100) / 100);
    paintRate();
    clearTimeout(rateT);
    rateT = setTimeout(() => { if (P.playing) seek(P.i, P.s); }, 350);
  };
  els.plRate.addEventListener('input', () => setRate(Number(els.plRate.value)));
  els.plSlower.addEventListener('click', () => setRate(tts.rate - 0.05));
  els.plFaster.addEventListener('click', () => setRate(tts.rate + 0.05));
  els.plClose.addEventListener('click', stop);

  // ── Voice quiz ──
  const Z = { list: [], i: 0, score: 0, missed: [], answered: false, token: 0 };
  let voiceOn = pref.get('voiceAnswers', true);
  let readAloud = pref.get('readAloud', true);

  function startQuiz(sys) {
    if (!els.player.hidden) stop();
    Z.list = progress.pickQuiz(10, sys);
    Z.i = 0; Z.score = 0; Z.missed = [];
    els.quiz.hidden = false;
    ask();
  }
  function closeQuiz() { Z.token++; tts.cancel(); els.quiz.hidden = true; if (sheet.key === 'learn') dashboard(); }

  const sysTitle = (q) => sysOf(q.sys)?.title || q.sys;
  function card(q, state = {}) {
    const mic = stt.supported && voiceOn;
    els.card.innerHTML = `
      <div class="qz-top">
        <span class="kicker"><span class="swatch" style="background:${sysOf(q.sys)?.color}"></span>${esc(sysTitle(q))} · ${Z.i + 1} / ${Z.list.length}</span>
        <span class="qz-score">${Z.score} ✓</span>
        <button class="tag tag-btn" data-q="close" aria-label="Close quiz">✕</button>
      </div>
      <div class="qz-q">${esc(q.q)}</div>
      <div class="qz-choices">${q.c.map((c, i) => `<button class="qz-c ${state.picked === i ? (i === q.a ? 'ok' : 'bad') : ''} ${state.done && i === q.a ? 'ok' : ''}" data-c="${i}" ${state.done ? 'disabled' : ''}>
        <b>${LETTERS[i]}</b><span>${esc(c)}</span></button>`).join('')}</div>
      ${state.done ? `<div class="qz-why ${state.picked === q.a ? 'ok' : 'bad'}"><b>${state.picked === q.a ? 'Correct.' : `Answer: ${LETTERS[q.a]} — ${esc(q.c[q.a])}.`}</b> ${esc(q.why)} <span class="ref">${esc(q.ref)}</span></div>` : ''}
      <div class="qz-bar">
        <span class="qz-mic ${state.listening ? 'on' : ''}">${mic ? (state.listening ? '● Listening…' : state.heard != null ? `Heard: “${esc(state.heard || '…')}”` : '🎤 Voice answers on') : (stt.supported ? '🎤 off' : '🎤 not supported here — tap')}</span>
        <span class="qz-tools">
          <button class="tag tag-btn" data-q="repeat">🔊 Repeat</button>
          ${stt.supported ? `<button class="tag tag-btn" data-q="voice">${voiceOn ? '🎤 On' : '🎤 Off'}</button>` : ''}
          <button class="tag tag-btn" data-q="aloud">${readAloud ? '🔈 Read aloud' : '🔇 Silent'}</button>
          ${state.done ? `<button class="tag tag-btn qz-next" data-q="next">${Z.i < Z.list.length - 1 ? 'Next ›' : 'Finish'}</button>` : ''}
        </span>
      </div>`;
  }

  async function ask() {
    const my = ++Z.token;
    const q = Z.list[Z.i];
    if (!q) return finish();
    Z.answered = false;
    card(q);
    if (readAloud) {
      await tts.speak(`Question ${Z.i + 1}. ${q.q} ${q.c.map((c, i) => `${LETTERS[i]}: ${c}.`).join(' ')}`);
      if (my !== Z.token || Z.answered) return;
    }
    listenFor(q, my, 2);
  }
  async function listenFor(q, my, tries) {
    if (!(stt.supported && voiceOn) || Z.answered) return;
    card(q, { listening: true });
    const heard = await stt.listen(8000);
    if (my !== Z.token || Z.answered) return;
    if (heard == null) { voiceOn = false; pref.set('voiceAnswers', false); card(q); return; }  // mic refused
    const i = parseAnswer(heard, q.c);
    if (i >= 0) return answer(i, my);
    card(q, { heard: heard.split('|')[0] });
    if (tries > 1) {
      if (readAloud) await tts.speak('Sorry, say the letter, A, B, C or D.');
      if (my === Z.token && !Z.answered) listenFor(q, my, tries - 1);
    }
  }
  async function answer(i, my = Z.token) {
    const q = Z.list[Z.i];
    if (Z.answered) return;
    Z.answered = true;
    const ok = i === q.a;
    progress.answer(q.id, ok);
    if (ok) Z.score++; else Z.missed.push(q);
    card(q, { picked: i, done: true });
    if (readAloud) {
      await tts.speak(ok ? `Correct. ${q.why}` : `Not quite. The answer is ${LETTERS[q.a]}, ${q.c[q.a]}. ${q.why}`);
      // Hands-free: carry on to the next question by itself.
      if (my === Z.token && stt.supported && voiceOn) setTimeout(() => { if (my === Z.token) next(); }, 700);
    }
  }
  function next() { Z.token++; tts.cancel(); Z.i++; ask(); }
  function finish() {
    const n = Z.list.length;
    els.card.innerHTML = `
      <div class="qz-top"><span class="kicker">Quiz complete</span><button class="tag tag-btn" data-q="close">✕</button></div>
      <div class="qz-q">${Z.score} of ${n} right</div>
      ${Z.missed.length ? `<p>Worth another look:</p><div class="lp-pages">${Z.missed.map((q) => {
        const key = q.part ? `${q.sys}/${q.part}` : q.sys;
        return `<button class="lp-page" data-go="${key}"><i class="dot st-learning"></i>${esc(describe(key).title)}<em>${esc(sysTitle(q))}</em></button>`;
      }).join('')}</div>` : '<p>All correct — nicely done.</p>'}
      <div class="qz-bar"><span></span><span class="qz-tools"><button class="tag tag-btn" data-q="again">Another 10</button><button class="tag tag-btn" data-q="close">Done</button></span></div>`;
    if (readAloud) tts.speak(`Quiz complete. ${Z.score} out of ${n}.${Z.missed.length ? ' The pages to look at again are on screen.' : ''}`);
  }

  els.card.addEventListener('click', (e) => {
    const c = e.target.closest('[data-c]');
    if (c && !c.disabled) { Z.token++; tts.cancel(); answer(Number(c.dataset.c)); return; }
    const go = e.target.closest('[data-go]');
    if (go) { closeQuiz(); goTo(go.dataset.go); return; }
    const b = e.target.closest('[data-q]');
    if (!b) return;
    const a = b.dataset.q;
    if (a === 'close') closeQuiz();
    else if (a === 'next') next();
    else if (a === 'again') startQuiz(Z.list[0]?.sys && Z.list.every((q) => q.sys === Z.list[0].sys) ? Z.list[0].sys : null);
    else if (a === 'repeat') { tts.cancel(); Z.token++; if (!Z.answered) ask(); else tts.speak(Z.list[Z.i].why); }
    else if (a === 'voice') { voiceOn = !voiceOn; pref.set('voiceAnswers', voiceOn); if (!Z.answered) { if (voiceOn) listenFor(Z.list[Z.i], Z.token, 2); else card(Z.list[Z.i]); } }
    else if (a === 'aloud') { readAloud = !readAloud; pref.set('readAloud', readAloud); if (!readAloud) tts.cancel(); card(Z.list[Z.i], Z.answered ? { done: true } : {}); }
  });
  els.quiz.addEventListener('click', (e) => { if (e.target === els.quiz) closeQuiz(); });

  return { dashboard, playKeys, startQuiz, stop, get playing() { return P.playing; } };
}

export { QUESTIONS, speakable };
