// ui/history.js — every saved check, grouped by wing; compare, export, restore.

import { gliderIdentity } from './glider.js?v=15';
import { $, $$, el, esc, clear, toast, signed, classBadge } from './dom.js?v=15';
import { icon, statusIcon } from './icons.js?v=15';
import { sessions } from '../store.js?v=15';
import { analyse } from '../trim.js?v=15';
import { exportAllJson, exportAllCsv, importBackup } from '../backup.js?v=15';

// Checks saved before the left/right + v3 model can't be re-analysed.
const isCurrent = s => s && s.v === 3 && Array.isArray(s.mains) && Array.isArray(s.sides);
export const checkDate = s => s.measuredOn || new Date(s.savedAt || s.createdAt).toISOString().slice(0, 10);
export const checkName = s => s.name || `${s.brand} ${s.model} ${s.sizeKey}`;
const fmtDate = iso => new Date(iso + 'T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

export function renderHistory(root, ctx) {
  clear(root);
  const list = sessions.all();
  const picked = new Set();

  const wrap = el(`<div>
    <button class="btn ghost sm" id="back" style="margin-left:-8px">${icon.back} Back</button>
    <h1>Your checks</h1>
    <p class="lede">Every check you save, by date. Pick two of the same wing to see how it has changed.</p>
    <div class="actions" style="margin-top:0">
      <button class="btn soft" id="add">${icon.plus} Add past check</button>
      <button class="btn soft" id="restore">${icon.upload} Restore backup</button>
      <button class="btn soft" id="json">${icon.download} Export backup</button>
      <button class="btn soft" id="csv">${icon.download} Export CSV</button>
    </div>
    <input type="file" id="restore-file" accept=".json,application/json" hidden>
    <div id="compare-bar" class="compare-bar" hidden></div>
    <div id="list" style="margin-top:14px"></div></div>`);
  root.appendChild(wrap);
  $('#back', wrap).addEventListener('click', () => ctx.goto(ctx.session ? 'result' : 'wings'));
  $('#add', wrap).addEventListener('click', () => ctx.goto('past'));
  $('#json', wrap).addEventListener('click', () => { const n = exportAllJson(); toast(`Backup of ${n} check${n === 1 ? '' : 's'} saved to Downloads`); });
  $('#csv', wrap).addEventListener('click', () => { const n = exportAllCsv(); toast(`${n} readings exported`); });
  const file = $('#restore-file', wrap);
  $('#restore', wrap).addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    try {
      const r = await importBackup(file.files[0]);
      toast(`Restored: ${r.added} new, ${r.updated} updated${r.wings ? `, ${r.wings} wing${r.wings > 1 ? 's' : ''}` : ''}`);
      renderHistory(root, ctx);
    } catch (e) { toast(e.message); }
  });

  const host = $('#list', wrap);
  if (!list.length) {
    host.appendChild(el(`<p class="empty">No saved checks yet. Save one from the results screen, or add a check you measured before.</p>`));
    return;
  }

  // group by wing + size, newest first inside each group
  const groups = new Map();
  for (const s of list) {
    const k = `${s.gliderId}|${s.sizeKey}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(s);
  }
  for (const items of groups.values()) {
    items.sort((a, b) => checkDate(b).localeCompare(checkDate(a)) || (b.savedAt || 0) - (a.savedAt || 0));
    const first = items[0];
    const g = el(`<section class="hist-group">
      <div class="row" style="margin:18px 0 8px">${classBadge(first.wingClass || '')}
        <b class="grow">${esc(first.brand)} ${esc(first.model)} · ${esc(first.sizeKey)}</b>
        <span class="small muted">${items.length} check${items.length > 1 ? 's' : ''}</span></div>
    </section>`);
    for (const s of items) g.appendChild(row(s));
    host.appendChild(g);
  }

  function row(s) {
    let status = '<span class="muted small">saved by an older version — can\'t be reopened</span>';
    let speed = '';
    if (isCurrent(s)) {
      try {
        const a = analyse(s);
        status = `<span class="status ${a.verdict.level}">${statusIcon(a.verdict.level)} ${esc(a.verdict.title)}</span>`;
        const aoi = [...(a.perSide.L?.aoi || []), ...(a.perSide.R?.aoi || [])];
        if (aoi.length) speed = `trim ${signed(aoi.reduce((x, y) => x + y.aoiMm, 0) / aoi.length)}`;
      } catch (e) { status = `<span class="muted small">couldn't analyse: ${esc(e.message)}</span>`; }
    }
    const card = el(`<div class="card hist-item">
      <label class="pick" title="Select to compare"><input type="checkbox" ${isCurrent(s) ? '' : 'disabled'}><span></span></label>
      <div class="grow open">
        <b>${esc(checkName(s))}</b>
        ${gliderIdentity(s) ? `<div class="small">${esc(gliderIdentity(s))}</div>` : ''}
        <div class="small muted">${fmtDate(checkDate(s))} · ${Object.keys(s.measured || {}).length} readings${speed ? ' · ' + speed : ''}${s.imported ? ' · imported' : ''}</div>
        <div style="margin-top:6px">${status}</div>
        ${s.notes ? `<div class="small" style="margin-top:6px;color:var(--ink-2)">${esc(s.notes)}</div>` : ''}
      </div>
      <div class="hist-acts">
        <button class="btn ghost sm" data-rename aria-label="Rename">Rename</button>
        <button class="btn ghost sm" data-del aria-label="Delete">Delete</button>
      </div></div>`);
    card.querySelector('.open').addEventListener('click', () => {
      if (!isCurrent(s)) return;
      ctx.session = structuredClone(s);
      ctx.goto('result');
    });
    card.querySelector('[data-rename]').addEventListener('click', () => {
      const name = prompt('Name this check', checkName(s));
      if (name == null) return;
      const date = prompt('Measured on (YYYY-MM-DD)', checkDate(s));
      s.name = name.trim() || s.name;
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date.trim())) s.measuredOn = date.trim();
      sessions.save(s);
      renderHistory(root, ctx);
    });
    card.querySelector('[data-del]').addEventListener('click', () => {
      if (confirm(`Delete "${checkName(s)}"?`)) { sessions.remove(s.id); renderHistory(root, ctx); }
    });
    card.querySelector('input').addEventListener('change', e => {
      if (e.target.checked) picked.add(s.id); else picked.delete(s.id);
      paintCompare();
    });
    return card;
  }

  function paintCompare() {
    const bar = $('#compare-bar', wrap);
    const chosen = list.filter(s => picked.has(s.id));
    bar.hidden = !chosen.length;
    if (!chosen.length) return;
    const sn = s => (s.serial || '').trim().toUpperCase();
    const same = chosen.every(s => s.gliderId === chosen[0].gliderId && s.sizeKey === chosen[0].sizeKey)
      && !(chosen.length === 2 && sn(chosen[0]) && sn(chosen[1]) && sn(chosen[0]) !== sn(chosen[1]));
    bar.innerHTML = chosen.length < 2 ? `<span>Pick one more check of the same wing to compare.</span>`
      : chosen.length > 2 ? `<span>Pick exactly two checks.</span>`
      : !same ? `<span>Those are different gliders — pick two checks of the same wing (same model, size and serial).</span>`
      : `<span>Compare these two checks</span><button class="btn primary sm" id="go">Compare ${icon.chevron}</button>`;
    bar.querySelector('#go')?.addEventListener('click', () => {
      const [a, b] = chosen.sort((x, y) => checkDate(x).localeCompare(checkDate(y)));
      ctx.compare = [a.id, b.id];
      ctx.goto('compare');
    });
  }
}
