// reader.js — read-along: turn the page on screen into sentences, and
// highlight the sentence (and the word, where the browser reports word
// boundaries) being spoken. Highlighting uses the CSS Custom Highlight API,
// which paints over text without touching the DOM — so it never disturbs
// the user's own <mark> highlights. Browsers without it fall back to
// outlining the paragraph being read.

const BLOCKS = 'h2, .lead, h3, .sheet-body > p:not(.note-src), li, .ctl, .limit, .fail, .memory p';
const ABBR = /\b(?:No|e\.g|i\.e|Fig|approx|vs|min|max|Ref)\.$/i;
const canHL = typeof CSS !== 'undefined' && 'highlights' in CSS && typeof Highlight !== 'undefined';

/** Sentences of the page: [{ text, block, start, end, nodes }] with offsets in the block's text. */
export function sentencesOf(body) {
  const out = [];
  for (const block of body.querySelectorAll(BLOCKS)) {
    if (block.closest('.note-src, .page-st, .chips, .kicker, button')) continue;
    // Map the block's text to its text nodes.
    const nodes = [];
    let text = '';
    const w = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('.ref, .no-hl, button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    for (let n = w.nextNode(); n; n = w.nextNode()) { nodes.push({ n, at: text.length }); text += n.nodeValue; }
    if (!text.trim()) continue;
    // Limit rows and flight-deck items read as one unit.
    const whole = block.matches('.limit, .ctl, h2, h3');
    let s0 = 0;
    const push = (a, b) => {
      while (a < b && /\s/.test(text[a])) a++;
      while (b > a && /\s/.test(text[b - 1])) b--;
      if (b - a > 1) out.push({ text: text.slice(a, b), block, start: a, end: b, nodes });
    };
    if (!whole) {
      const re = /[.!?]+["”’)]?\s+(?=["“(A-Z0-9])/g;
      let m;
      while ((m = re.exec(text))) {
        const end = m.index + m[0].trimEnd().length;
        if (ABBR.test(text.slice(Math.max(0, end - 8), end))) continue;
        push(s0, end);
        s0 = m.index + m[0].length;
      }
    }
    push(s0, text.length);
  }
  return out;
}

/** A DOM Range for characters [a, b) of a sentence's block text. */
function rangeFor(s, a, b) {
  const r = document.createRange();
  let set = 0;
  for (const { n, at } of s.nodes) {
    const len = n.nodeValue.length;
    if (!(set & 1) && a >= at && a <= at + len) { r.setStart(n, a - at); set |= 1; }
    if ((set & 1) && b >= at && b <= at + len) { r.setEnd(n, b - at); set |= 2; break; }
  }
  return set === 3 ? r : null;
}

export function createReader() {
  let hlS = null, hlW = null, lastBlock = null;
  if (canHL) {
    hlS = new Highlight(); hlW = new Highlight();
    CSS.highlights.set('read-sentence', hlS);
    CSS.highlights.set('read-word', hlW);
  }
  function clear() {
    hlS?.clear(); hlW?.clear();
    lastBlock?.classList.remove('reading');
    lastBlock = null;
  }
  /** Highlight a sentence and keep it in view inside its scroller. */
  function sentence(s) {
    clear();
    if (!s?.block.isConnected) return;
    if (canHL) { const r = rangeFor(s, s.start, s.end); if (r) hlS.add(r); }
    else { s.block.classList.add('reading'); lastBlock = s.block; }
    const scroller = s.block.closest('.sheet-body');
    if (scroller) {
      const br = s.block.getBoundingClientRect(), sr = scroller.getBoundingClientRect();
      if (br.top < sr.top + 40 || br.bottom > sr.bottom - 40) {
        scroller.scrollTo({ top: scroller.scrollTop + (br.top - sr.top) - sr.height * 0.3, behavior: 'smooth' });
      }
    }
  }
  /** Highlight the word at `frac` (0–1) of the way through the sentence. */
  function word(s, frac) {
    if (!canHL || !s?.block.isConnected) return;
    const t = s.text;
    let i = Math.max(0, Math.min(t.length - 1, Math.round(frac * t.length)));
    while (i > 0 && !/\s/.test(t[i - 1])) i--;
    let j = i;
    while (j < t.length && !/\s/.test(t[j])) j++;
    hlW.clear();
    const r = rangeFor(s, s.start + i, s.start + j);
    if (r) hlW.add(r);
  }
  /** Which sentence does a tap land in? (block-level: first sentence of that block) */
  function indexAt(list, target) {
    const block = target.closest(BLOCKS);
    if (!block) return -1;
    return list.findIndex((s) => s.block === block);
  }
  return { sentence, word, clear, indexAt, supportsWords: canHL };
}
