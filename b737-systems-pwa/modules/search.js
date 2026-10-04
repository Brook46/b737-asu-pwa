// search.js — full-text search across every system and part page.
// The index is built once from the system modules' own content, so new
// systems become searchable just by being added to systems.js.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const plain = (s) => String(s).replace(/\*\*/g, '');
const flat = (v) => (Array.isArray(v) ? v.map(flat).join(' ') : v == null ? '' : plain(v));

function buildIndex(systems) {
  const out = [];
  for (const s of systems) {
    const m = s.mod;
    const o = m.overview;
    out.push({ sys: s.id, part: null, title: m.title, kicker: `[${String(m.num).padStart(2, '0')}] System · ${m.fcom}`, color: m.color,
      text: [o.lead, flat(o.how), flat(o.limits), flat(o.memory)].join(' ') });
    for (const p of m.parts) {
      out.push({ sys: s.id, part: p.id, title: p.name, kicker: m.title, color: m.color,
        text: [p.lead, flat(p.how), flat(p.deck), flat(p.limits), flat(p.fails)].join(' ') });
    }
  }
  for (const e of out) { e.lt = e.title.toLowerCase(); e.lx = e.text.toLowerCase(); }
  return out;
}

function snippet(text, terms) {
  const lx = text.toLowerCase();
  let at = -1;
  for (const t of terms) { const i = lx.indexOf(t); if (i >= 0 && (at < 0 || i < at)) at = i; }
  if (at < 0) return esc(text.slice(0, 140)) + (text.length > 140 ? '…' : '');
  const a = Math.max(0, at - 60), b = Math.min(text.length, at + 100);
  let s = esc(text.slice(a, b));
  for (const t of terms) s = s.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => `<mark>${m}</mark>`);
  return (a ? '…' : '') + s + (b < text.length ? '…' : '');
}

export function createSearch(root, systems, onPick) {
  const index = buildIndex(systems);
  const input = root.querySelector('input');
  const list = root.querySelector('.search-results');

  function run() {
    const q = input.value.trim().toLowerCase();
    if (q.length < 2) { list.innerHTML = q ? '' : '<div class="search-hint">Search every page — e.g. <b>PTU</b>, <b>crossfeed</b>, <b>9.1</b>, <b>standby</b></div>'; return; }
    const terms = q.split(/\s+/).filter(Boolean);
    const hits = [];
    for (const e of index) {
      let score = 0, ok = true;
      for (const t of terms) {
        const inT = e.lt.includes(t), inX = e.lx.includes(t);
        if (!inT && !inX) { ok = false; break; }
        score += (inT ? 10 : 0) + (inX ? 1 + Math.min(4, e.lx.split(t).length - 1) * 0.3 : 0);
        if (e.lt.startsWith(t)) score += 5;
      }
      if (ok) hits.push({ e, score: score + (e.part ? 0 : 2) });
    }
    hits.sort((a, b) => b.score - a.score);
    list.innerHTML = hits.length ? hits.slice(0, 40).map(({ e }, i) => `
      <button class="search-hit" data-i="${index.indexOf(e)}">
        <span class="sh-k"><span class="swatch" style="background:${e.color}"></span>${esc(e.kicker)}</span>
        <span class="sh-t">${esc(e.title)}</span>
        <span class="sh-s">${snippet(e.text, terms)}</span>
      </button>`).join('') : '<div class="search-hint">No matches.</div>';
  }

  input.addEventListener('input', run);
  list.addEventListener('click', (ev) => {
    const b = ev.target.closest('.search-hit');
    if (!b) return;
    const e = index[Number(b.dataset.i)];
    close();
    onPick(e.sys, e.part);
  });
  root.addEventListener('click', (ev) => { if (ev.target === root) close(); });
  root.querySelector('.search-close').addEventListener('click', close);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') close();
    if (ev.key === 'Enter') list.querySelector('.search-hit')?.click();
  });

  function open() { root.hidden = false; run(); setTimeout(() => input.focus(), 30); }
  function close() { root.hidden = true; input.blur(); }
  return { open, close, get open_() { return !root.hidden; } };
}
