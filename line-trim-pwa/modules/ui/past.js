// ui/past.js — add a check measured before: pick the wing, load the readings,
// confirm which column is which side, name and date it.

import { $, el, esc, clear, toast, fmtMm } from './dom.js?v=13';
import { icon } from './icons.js?v=13';
import { listWings, loadWing, isReady, expectedLineIds } from '../library.js?v=13';
import { readSheetFile } from '../sheets/importsheet.js?v=13';
import { gridFromText, mapColumns, readingsFrom } from '../sheets/pastcheck.js?v=13';
import { createSession, record, canMeasureFromMaillon, progress } from '../session.js?v=13';
import { sessions } from '../store.js?v=13';
import { rememberedGlider } from './glider.js?v=13';

export async function renderPast(root, ctx) {
  clear(root);
  const wings = await listWings().catch(() => []);
  const wrap = el(`<div>
    <button class="btn ghost sm" id="back" style="margin-left:-8px">${icon.back} Your checks</button>
    <h1>Add a past check</h1>
    <p class="lede">Readings you took before — a spreadsheet, a CSV, or notes pasted as text. They're saved as a dated check you can compare with new ones.</p>
    <div class="card">
      <div class="row wrap">
        <label class="field grow"><span>Wing</span><select class="input" id="wing"></select></label>
        <label class="field" style="min-width:110px"><span>Size</span><select class="input" id="size"></select></label>
      </div>
      <label class="field" style="margin:0"><span>Measured from</span>
        <select class="input" id="from"><option value="riser">Riser bottom (lines + risers)</option><option value="maillon">Maillons (lines only)</option></select></label>
    </div>
    <h2>Readings</h2>
    <label class="dropzone" id="drop">${icon.upload}<b>Drop the .xlsx or .csv here</b><span class="muted small">or tap to choose a file</span>
      <input type="file" id="file" accept=".xlsx,.csv,.tsv,.txt" hidden></label>
    <details class="more" style="margin-top:10px"><summary>${icon.chevron} Or paste them as text</summary>
      <textarea class="input" id="paste" style="margin-top:8px" placeholder="Line   Left   Right&#10;A1     6421   6425&#10;A2     6400   6398&#10;…"></textarea>
      <button class="btn sm soft" id="use-paste" style="margin-top:8px">Use pasted readings</button></details>
    <div id="map" style="margin-top:16px"></div>
  </div>`);
  root.appendChild(wrap);
  $('#back', wrap).addEventListener('click', () => ctx.goto('history'));

  const wingSel = $('#wing', wrap), sizeSel = $('#size', wrap), fromSel = $('#from', wrap);
  for (const w of wings) if (w.sizes.some(s => s.ready)) wingSel.appendChild(el(`<option value="${esc(w.id)}">${esc(w.brand)} ${esc(w.model)}</option>`));
  if (ctx.wingId && [...wingSel.options].some(o => o.value === ctx.wingId)) wingSel.value = ctx.wingId;

  let wing = null, grid = null;
  async function pickWing() {
    wing = await loadWing(wingSel.value);
    clear(sizeSel);
    for (const [k] of Object.entries(wing.sizes)) if (isReady(wing, k)) sizeSel.appendChild(el(`<option>${esc(k)}</option>`));
    if (ctx.sizeKey && [...sizeSel.options].some(o => o.value === ctx.sizeKey)) sizeSel.value = ctx.sizeKey;
    syncFrom();
    if (grid) showMap();
  }
  function syncFrom() {
    const ok = canMeasureFromMaillon(wing.sizes[sizeSel.value]);
    fromSel.querySelector('[value="maillon"]').disabled = !ok;
    if (!ok) fromSel.value = 'riser';
  }
  wingSel.addEventListener('change', pickWing);
  sizeSel.addEventListener('change', () => { syncFrom(); if (grid) showMap(); });
  if (wingSel.options.length) await pickWing();

  async function loadFile(f) {
    try {
      const sheets = await readSheetFile(f);
      // the sheet with the most line ids wins
      const ids = expectedLineIds(wing, sizeSel.value);
      grid = sheets.map(s => s.grid).sort((x, y) => score(y, ids) - score(x, ids))[0];
      showMap();
    } catch (e) { $('#map', wrap).innerHTML = `<div class="note warn">${icon.warn}<span>${esc(e.message)}</span></div>`; }
  }
  const score = (g, ids) => g.filter(r => r.some(c => ids.includes(String(c).trim().toUpperCase()))).length;

  function showMap() {
    const host = $('#map', wrap);
    clear(host);
    const ids = expectedLineIds(wing, sizeSel.value);
    const m = mapColumns(grid, ids);
    if (!m.layout) {
      host.appendChild(el(`<div class="note warn">${icon.warn}<span>Couldn't find line names (A1, B3…) with lengths beside them. Check the wing and size, or paste as "A1 6421 6425".</span></div>`));
      return;
    }
    const box = el(`<div class="card"></div>`);
    let map = { ...m };
    if (m.layout === 'wide') {
      const opts = sel => `<option value="">— none —</option>` + m.cols.map(c => `<option value="${c.index}" ${c.role === sel ? 'selected' : ''}>${esc(c.header)} (${c.count} values)</option>`).join('');
      box.appendChild(el(`<div><h3 style="margin-top:0">Which column is which side?</h3>
        <div class="row wrap"><label class="field grow"><span>Left side</span><select class="input" id="colL">${opts('L')}</select></label>
        <label class="field grow"><span>Right side</span><select class="input" id="colR">${opts('R')}</select></label></div></div>`));
    } else {
      box.appendChild(el(`<p class="small muted" style="margin-top:0">Found one row per reading with a side column (L / R).</p>`));
    }
    box.appendChild(el(`<div id="preview"></div>`));
    box.appendChild(el(`<div class="row wrap" style="margin-top:12px">
      <label class="field grow"><span>Name</span><input class="input" id="name" placeholder="e.g. Workshop check before the comp"></label>
      <label class="field"><span>Measured on</span><input class="input" id="date" type="date" value="${new Date().toISOString().slice(0, 10)}"></label></div>`));
    const known = rememberedGlider(wing.id, sizeSel.value);
    box.appendChild(el(`<div class="row wrap">
      <label class="field grow"><span>Serial number (optional)</span><input class="input" id="serial" autocomplete="off" autocapitalize="characters" value="${esc(known.serial)}"></label>
      <label class="field grow"><span>Owner (optional)</span><input class="input" id="owner" value="${esc(known.owner)}"></label></div>`));
    box.appendChild(el(`<label class="field"><span>Notes (optional)</span><input class="input" id="notes" placeholder="who measured, tension, anything unusual"></label>`));
    const save = el(`<button class="btn primary block big">${icon.save} Save this check</button>`);
    box.appendChild(save);
    host.appendChild(box);

    const current = () => (m.layout === 'wide'
      ? { ...map, left: box.querySelector('#colL').value === '' ? null : +box.querySelector('#colL').value,
                  right: box.querySelector('#colR').value === '' ? null : +box.querySelector('#colR').value }
      : map);
    function preview() {
      const r = readingsFrom(grid, current(), ids);
      const nL = Object.keys(r.L).length, nR = Object.keys(r.R).length;
      const missing = ids.filter(id => r.L[id] == null && r.R[id] == null);
      const sample = ids.filter(id => r.L[id] != null || r.R[id] != null).slice(0, 4)
        .map(id => `${id}: ${r.L[id] != null ? fmtMm(r.L[id]) : '–'} / ${r.R[id] != null ? fmtMm(r.R[id]) : '–'}`).join(' · ');
      box.querySelector('#preview').innerHTML = `<p class="small" style="margin:10px 0 0">
        <b>${nL}</b> left and <b>${nR}</b> right readings of ${ids.length} lines per side.
        ${missing.length ? `<span class="muted">${missing.length} line${missing.length > 1 ? 's' : ''} not in the file — fine, they'll show as not measured.</span>` : ''}</p>
        <p class="small muted" style="margin:4px 0 0">${esc(sample)}</p>`;
      save.disabled = !(nL + nR);
      return r;
    }
    box.querySelectorAll('select').forEach(s => s.addEventListener('change', preview));
    preview();

    save.addEventListener('click', () => {
      const r = preview();
      const date = box.querySelector('#date').value || new Date().toISOString().slice(0, 10);
      const s = createSession(wing, sizeSel.value, { measureFrom: fromSel.value });
      for (const side of ['L', 'R']) for (const [id, mm] of Object.entries(r[side])) {
        if (s.nominal[id] != null) record(s, `${side}:${id}`, mm, { source: 'imported' });
      }
      s.name = box.querySelector('#name').value.trim() || `${wing.model} ${sizeSel.value} — imported`;
      s.measuredOn = date;
      s.notes = box.querySelector('#notes').value.trim();
      s.serial = box.querySelector('#serial').value.trim();
      s.owner = box.querySelector('#owner').value.trim();
      s.imported = true;
      s.savedAt = Date.now();
      sessions.save(s);
      toast(`Saved — ${progress(s).done} readings`);
      ctx.session = structuredClone(s);
      ctx.goto('result');
    });
  }

  const drop = $('#drop', wrap), file = $('#file', wrap);
  file.addEventListener('change', () => file.files[0] && loadFile(file.files[0]));
  for (const e of ['dragenter', 'dragover']) drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); });
  for (const e of ['dragleave', 'drop']) drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', ev => { const f = ev.dataTransfer?.files?.[0]; if (f) loadFile(f); });
  $('#use-paste', wrap).addEventListener('click', () => {
    grid = gridFromText($('#paste', wrap).value);
    if (!grid.length) { toast('Nothing pasted'); return; }
    showMap();
  });
}
