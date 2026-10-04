// notes.js — favourites (starred pages) and highlights (selected text in a
// page, in one of three colours). Both live in this device's localStorage:
// a study aid for one pilot, nothing to sync. Every read/write is guarded so
// private mode or blocked storage just means "nothing saved".

const KEY_FAV = 'b737i.favs', KEY_HL = 'b737i.hl';
const load = (k) => { try { return JSON.parse(localStorage.getItem(k) || '[]'); } catch { return []; } };
const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };

export const COLORS = { y: '#ffe066', g: '#8ce99a', p: '#ffadd2' };

/** A page is identified by its system and (optionally) part. */
export const pageKey = (sys, part) => (part ? `${sys}/${part}` : sys);

export function createNotes() {
  let favs = load(KEY_FAV);
  let hls = load(KEY_HL);
  const listeners = new Set();
  const changed = () => { save(KEY_FAV, favs); save(KEY_HL, hls); for (const f of listeners) f(); };

  return {
    onChange(fn) { listeners.add(fn); },
    isFav: (key) => favs.some((f) => f.key === key),
    toggleFav(key, meta) {
      if (favs.some((f) => f.key === key)) favs = favs.filter((f) => f.key !== key);
      else favs.unshift({ key, ...meta, at: Date.now() });
      changed();
    },
    addHL(key, text, color, meta) {
      text = text.replace(/\s+/g, ' ').trim();
      if (!text || hls.some((h) => h.key === key && h.text === text)) return;
      hls.unshift({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), key, text, color, ...meta, at: Date.now() });
      changed();
    },
    removeHL(id) { hls = hls.filter((h) => h.id !== id); changed(); },
    removeFav(key) { favs = favs.filter((f) => f.key !== key); changed(); },
    favs: () => favs.slice(),
    hls: (key) => (key ? hls.filter((h) => h.key === key) : hls.slice()),
  };
}

/**
 * Wrap each saved highlight's text in <mark> inside `root`. The text may
 * span several nodes (e.g. across a **bold** run), so we match against the
 * concatenated text and wrap each node's slice separately.
 */
export function applyHighlights(root, list) {
  for (const h of list) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement.closest('.no-hl, button, mark') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
    });
    const nodes = [];
    let all = '';
    for (let n = walker.nextNode(); n; n = walker.nextNode()) { nodes.push({ n, at: all.length }); all += n.nodeValue; }
    // Compare with whitespace collapsed, mapping back to raw offsets.
    const map = [];
    let norm = '';
    for (let i = 0; i < all.length; i++) {
      const ws = /\s/.test(all[i]);
      if (ws && (norm.endsWith(' ') || !norm.length)) continue;
      norm += ws ? ' ' : all[i];
      map.push(i);
    }
    const idx = norm.indexOf(h.text);
    if (idx < 0) continue;
    const start = map[idx], end = map[idx + h.text.length - 1] + 1;
    for (const { n, at } of nodes) {
      const a = Math.max(start, at), b = Math.min(end, at + n.nodeValue.length);
      if (a >= b) continue;
      const r = document.createRange();
      r.setStart(n, a - at);
      r.setEnd(n, b - at);
      const m = document.createElement('mark');
      m.className = 'hl';
      m.dataset.hl = h.id;
      m.style.background = COLORS[h.color] || COLORS.y;
      r.surroundContents(m);
    }
  }
}

/**
 * Selection popover over the sheet: pick a colour to highlight the selected
 * text; tap an existing highlight to remove it.
 */
export function attachSelection(body, pop, { getKey, notes, meta, onChange }) {
  let pending = null;
  function hide() { pop.hidden = true; pending = null; }
  function place(rect) {
    pop.hidden = false;
    const w = pop.offsetWidth, h = pop.offsetHeight;
    // Below the selection: iOS puts its own Copy menu above it.
    let x = rect.left + rect.width / 2 - w / 2, y = rect.bottom + 10;
    if (y + h > window.innerHeight - 8) y = rect.top - h - 10;
    x = Math.max(8, Math.min(window.innerWidth - w - 8, x));
    pop.style.transform = `translate(${x}px, ${y}px)`;
  }
  function check() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) { if (pending?.type === 'sel') hide(); return; }
    const r = sel.getRangeAt(0);
    if (!body.contains(r.commonAncestorContainer)) return;
    const text = sel.toString().replace(/\s+/g, ' ').trim();
    if (text.length < 2) return;
    pending = { type: 'sel', text };
    pop.innerHTML = `<span class="pop-l">Highlight</span>${Object.entries(COLORS).map(([k, c]) =>
      `<button data-c="${k}" style="background:${c}" aria-label="Highlight ${k}"></button>`).join('')}`;
    place(r.getBoundingClientRect());
  }
  let t = 0;
  document.addEventListener('selectionchange', () => { clearTimeout(t); t = setTimeout(check, 250); });
  body.addEventListener('click', (e) => {
    const m = e.target.closest('mark.hl');
    if (!m || !window.getSelection().isCollapsed) return;
    pending = { type: 'mark', id: m.dataset.hl };
    pop.innerHTML = '<button class="pop-x">Remove highlight</button>';
    place(m.getBoundingClientRect());
  });
  pop.addEventListener('pointerdown', (e) => e.preventDefault());   // keep the selection alive
  pop.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || !pending) return;
    if (pending.type === 'sel' && b.dataset.c) {
      notes.addHL(getKey(), pending.text, b.dataset.c, meta());
      window.getSelection().removeAllRanges();
    } else if (pending.type === 'mark') notes.removeHL(pending.id);
    hide();
    onChange();
  });
  body.addEventListener('scroll', hide, { passive: true });
  return { hide };
}
