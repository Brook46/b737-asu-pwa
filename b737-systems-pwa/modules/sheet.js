// sheet.js — the page that opens beside the airplane: a system overview or a
// single part. Content is plain data in each system module; this only lays
// it out. Text supports **bold** and nothing else.

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const md = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');

function limitsHtml(rows) {
  if (!rows?.length) return '';
  return `<h3>Limits &amp; numbers</h3>` + rows.map(([label, value, ref]) =>
    `<div class="limit"><span>${md(label)}${ref ? ` <span class="ref">${esc(ref)}</span>` : ''}</span><span class="v">${md(value)}</span></div>`).join('');
}
function deckHtml(rows) {
  if (!rows?.length) return '';
  return `<h3>On the flight deck</h3>` + rows.map(([name, text]) =>
    `<div class="ctl"><b>${esc(name)}</b><br>${md(text)}</div>`).join('');
}
function parasHtml(title, paras) {
  if (!paras?.length) return '';
  return `<h3>${esc(title)}</h3>` + paras.map((p) => Array.isArray(p)
    ? `<ul>${p.map((li) => `<li>${md(li)}</li>`).join('')}</ul>`
    : `<p>${md(p)}</p>`).join('');
}
function failsHtml(rows) {
  if (!rows?.length) return '';
  return `<h3>If it fails</h3>` + rows.map((f) => `<div class="fail">${md(f)}</div>`).join('');
}

export function createSheet(el, body, closeBtn, { onRelated, onClose, onStar, onGo, onDelHL, onUnfav, decorate }) {
  let current = null;
  closeBtn.addEventListener('click', () => { hide(); onClose(); });
  body.addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) { e.stopPropagation(); onDelHL(del.dataset.del); return; }
    const uf = e.target.closest('[data-unfav]');
    if (uf) { onUnfav(uf.dataset.unfav); return; }
    const go = e.target.closest('[data-go]');
    if (go) { onGo(go.dataset.go, go.dataset.hl); return; }
    const st = e.target.closest('[data-star]');
    if (st) { onStar(current); return; }
    const b = e.target.closest('[data-rel]');
    if (b) onRelated(b.dataset.rel);
  });

  function show(html, key = null) {
    current = key;
    body.innerHTML = html;
    body.scrollTop = 0;
    el.hidden = false;
    decorate?.(body, key);
  }
  function hide() { el.hidden = true; current = null; }
  const star = '<button class="star-btn no-hl" data-star aria-label="Add to favorites">☆</button>'
    + '<button class="listen-btn no-hl" data-listen aria-label="Listen to this page and the ones after it">🔊 Listen</button>';

  function part(sys, p, idx) {
    const rel = (p.related || []).map((id) => sys.parts.find((q) => q.id === id)).filter(Boolean);
    show(`
      ${star}
      <div class="kicker"><span class="swatch" style="background:${sys.color}"></span>[${String(sys.num).padStart(2, '0')}] ${esc(sys.title)} · ${String(idx + 1).padStart(2, '0')}</div>
      <h2>${esc(p.name)}</h2>
      ${p.lead ? `<p class="lead">${md(p.lead)}</p>` : ''}
      ${parasHtml('How it works', p.how)}
      ${deckHtml(p.deck)}
      ${limitsHtml(p.limits)}
      ${failsHtml(p.fails)}
      ${rel.length ? `<h3>Related</h3><div class="chips">${rel.map((r) => `<button class="tag tag-btn" data-rel="${r.id}">${esc(r.name)}</button>`).join('')}</div>` : ''}
      <p class="note-src">Written for study from the 737 FCOM (D6-27370-858-ELA, rev. Sep 2025). Explanations are paraphrased; figures cite the FCOM section. The FCOM and QRH govern.</p>
    `, `${sys.id}/${p.id}`);
  }

  function system(sys) {
    const o = sys.overview;
    show(`
      ${star}
      <div class="kicker"><span class="swatch" style="background:${sys.color}"></span>[${String(sys.num).padStart(2, '0')}] System · ${esc(sys.fcom)}</div>
      <h2>${esc(sys.title)}</h2>
      <p class="lead">${md(o.lead)}</p>
      ${parasHtml('The big picture', o.how)}
      ${limitsHtml(o.limits)}
      ${o.memory?.length ? `<h3>Memory items &amp; must-knows</h3><div class="memory">${o.memory.map((m) => `<p>${md(m)}</p>`).join('')}</div>` : ''}
      <h3>Parts</h3>
      <div class="chips">${sys.parts.map((p, i) => `<button class="tag tag-btn" data-rel="${p.id}"><span style="opacity:.6">[${String(i + 1).padStart(2, '0')}]</span> ${esc(p.name)}</button>`).join('')}</div>
      <p class="note-src">Tap a part on the airplane or in the list. Switch to <b>Schematic</b> (top right) to operate the system. Select any text to highlight it; ☆ saves the page.</p>
    `, sys.id);
  }

  function overview(systems) {
    show(`
      <div class="kicker">Boeing 737-800 / -900ER · CFM56-7B</div>
      <h2>737 NG Inside</h2>
      <p class="lead">Pick a system to see where it lives in the airplane. Every part is tappable; the phase buttons at the bottom show what each system does on the ground, at takeoff, in cruise and on landing.</p>
      <h3>Systems</h3>
      <div class="chips">${systems.map((s) => `<button class="tag tag-btn" data-rel="sys:${s.id}" ${s.ready ? '' : 'disabled style="opacity:.5"'}><span class="swatch" style="background:${s.color}"></span>${String(s.num).padStart(2, '0')} ${esc(s.title)}${s.ready ? '' : ' · soon'}</button>`).join('')}</div>
      <p class="note-src">Study aid only — not an approved document. Content paraphrased from the 737 FCOM (rev. Sep 2025); the FCOM, QRH and company manuals govern.</p>
    `);
  }

  /** Starred pages and saved highlights. favs/hls carry {key, title, sub}. */
  function favorites(favs, hls) {
    const color = { y: '#ffe066', g: '#8ce99a', p: '#ffadd2' };
    show(`
      <div class="kicker">Saved on this device</div>
      <h2>Favorites</h2>
      <h3>Starred pages</h3>
      ${favs.length ? favs.map((f) => `<div class="fav-row"><button class="tag tag-btn" data-go="${esc(f.key)}">★ ${esc(f.title)}${f.sub ? ` <span style="opacity:.6">· ${esc(f.sub)}</span>` : ''}</button><button class="tag tag-btn unfav" data-unfav="${esc(f.key)}" aria-label="Remove">✕</button></div>`).join('')
        : '<p class="empty-note">Tap ☆ at the top of any page to keep it here.</p>'}
      <h3>Highlights</h3>
      ${hls.length ? hls.map((h) => `<button class="hl-item" style="border-color:${color[h.color] || color.y}" data-go="${esc(h.key)}" data-hl="${h.id}">
          <q>${esc(h.text)}</q><small>${esc(h.title)}${h.sub ? ' · ' + esc(h.sub) : ''}</small>
          <span class="hl-del" data-del="${h.id}" role="button" aria-label="Delete highlight">✕</span></button>`).join('')
        : '<p class="empty-note">Select any text on a page and pick a colour to highlight it.</p>'}
    `, null);
  }

  /** Any other page (e.g. the Learn dashboard), keyed so callers can tell it's showing. */
  function custom(html, key) { show(html, key); }

  return { part, system, overview, favorites, custom, hide, get open() { return !el.hidden; }, get key() { return current; } };
}
