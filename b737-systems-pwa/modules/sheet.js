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

export function createSheet(el, body, closeBtn, { onRelated, onClose }) {
  closeBtn.addEventListener('click', () => { hide(); onClose(); });
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-rel]');
    if (b) onRelated(b.dataset.rel);
  });

  function show(html) {
    body.innerHTML = html;
    body.scrollTop = 0;
    el.hidden = false;
  }
  function hide() { el.hidden = true; }

  function part(sys, p, idx) {
    const rel = (p.related || []).map((id) => sys.parts.find((q) => q.id === id)).filter(Boolean);
    show(`
      <div class="kicker"><span class="swatch" style="background:${sys.color}"></span>[${String(sys.num).padStart(2, '0')}] ${esc(sys.title)} · ${String(idx + 1).padStart(2, '0')}</div>
      <h2>${esc(p.name)}</h2>
      ${p.lead ? `<p class="lead">${md(p.lead)}</p>` : ''}
      ${parasHtml('How it works', p.how)}
      ${deckHtml(p.deck)}
      ${limitsHtml(p.limits)}
      ${failsHtml(p.fails)}
      ${rel.length ? `<h3>Related</h3><div class="chips">${rel.map((r) => `<button class="tag tag-btn" data-rel="${r.id}">${esc(r.name)}</button>`).join('')}</div>` : ''}
      <p class="note-src">Written for study from the El Al 737 FCOM (D6-27370-858-ELA, rev. Sep 2025). Explanations are paraphrased; figures cite the FCOM section. The FCOM and QRH govern.</p>
    `);
  }

  function system(sys) {
    const o = sys.overview;
    show(`
      <div class="kicker"><span class="swatch" style="background:${sys.color}"></span>[${String(sys.num).padStart(2, '0')}] System · ${esc(sys.fcom)}</div>
      <h2>${esc(sys.title)}</h2>
      <p class="lead">${md(o.lead)}</p>
      ${parasHtml('The big picture', o.how)}
      ${limitsHtml(o.limits)}
      ${o.memory?.length ? `<h3>Memory items &amp; must-knows</h3><div class="memory">${o.memory.map((m) => `<p>${md(m)}</p>`).join('')}</div>` : ''}
      <h3>Parts</h3>
      <div class="chips">${sys.parts.map((p, i) => `<button class="tag tag-btn" data-rel="${p.id}"><span style="opacity:.6">[${String(i + 1).padStart(2, '0')}]</span> ${esc(p.name)}</button>`).join('')}</div>
      <p class="note-src">Tap a part on the airplane or in the list. Switch to <b>Schematic</b> (top right) to operate the system.</p>
    `);
  }

  function overview(systems) {
    show(`
      <div class="kicker">Boeing 737-800 / -900ER · CFM56-7B</div>
      <h2>737 NG Inside</h2>
      <p class="lead">Pick a system to see where it lives in the airplane. Every part is tappable; the phase buttons at the bottom show what each system does on the ground, at takeoff, in cruise and on landing.</p>
      <h3>Systems</h3>
      <div class="chips">${systems.map((s) => `<button class="tag tag-btn" data-rel="sys:${s.id}" ${s.ready ? '' : 'disabled style="opacity:.5"'}><span class="swatch" style="background:${s.color}"></span>${String(s.num).padStart(2, '0')} ${esc(s.title)}${s.ready ? '' : ' · soon'}</button>`).join('')}</div>
      <p class="note-src">Study aid only — not an approved document. Content paraphrased from the El Al 737 FCOM (rev. Sep 2025); the FCOM, QRH and company manuals govern.</p>
    `);
  }

  return { part, system, overview, hide, get open() { return !el.hidden; } };
}
