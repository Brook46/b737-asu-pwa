// ui/history.js — saved checks; open one back into the results.

import { $, el, esc, clear, signed, classBadge } from './dom.js?v=7';
import { icon, statusIcon } from './icons.js?v=7';
import { sessions } from '../store.js?v=7';
import { analyse } from '../trim.js?v=7';

// Checks saved before the left/right + v3 model can't be re-analysed.
const isCurrent = s => s && s.v === 3 && Array.isArray(s.mains) && Array.isArray(s.sides);

export function renderHistory(root, ctx) {
  clear(root);
  const list = sessions.all();
  const wrap = el(`<div>
    <button class="btn ghost sm" id="back" style="margin-left:-8px">${icon.back} Back</button>
    <h1>Your checks</h1>
    <p class="lede">Compare a wing over time — a line set that keeps drifting the same way is worth a workshop visit.</p>
    <div id="list" class="stack"></div></div>`);
  root.appendChild(wrap);
  $('#back', wrap).addEventListener('click', () => ctx.goto(ctx.session ? 'result' : 'wings'));

  const host = $('#list', wrap);
  if (!list.length) { host.appendChild(el(`<p class="empty">No saved checks yet. Save one from the results screen.</p>`)); return; }

  for (const s of list) {
    let status = '<span class="muted small">saved by an older version — can\'t be reopened</span>';
    if (isCurrent(s)) {
      try {
        const a = analyse(s);
        status = `<span class="status ${a.verdict.level}">${statusIcon(a.verdict.level)} ${esc(a.verdict.title)}</span>`;
      } catch (e) { status = `<span class="muted small">couldn't analyse: ${esc(e.message)}</span>`; }
    }
    const date = new Date(s.savedAt || s.createdAt);
    const card = el(`<div class="card" style="cursor:${isCurrent(s) ? 'pointer' : 'default'}">
      <div class="row">${classBadge(s.wingClass || '')}<b class="grow">${esc(s.brand)} ${esc(s.model)} · ${esc(s.sizeKey)}</b>
        <button class="btn ghost sm" data-del aria-label="Delete">Delete</button></div>
      <div class="small muted" style="margin:6px 0 8px">${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        · ${Object.keys(s.measured || {}).length} readings</div>
      ${status}</div>`);
    card.addEventListener('click', ev => {
      if (ev.target.closest('[data-del]')) {
        if (confirm('Delete this saved check?')) { sessions.remove(s.id); renderHistory(root, ctx); }
        return;
      }
      if (!isCurrent(s)) return;
      ctx.session = structuredClone(s);
      ctx.goto('result');
    });
    host.appendChild(card);
  }
}
