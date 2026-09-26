// ui/import.js — add a wing (or one missing size) from the pilot's own sheet.

import { $, $$, el, esc, clear, toast } from './dom.js?v=16';
import { icon } from './icons.js?v=16';
import { loadWing, expectedLineIds, CLASSES } from '../library.js?v=16';
import { customGliders } from '../store.js?v=16';
import { readSheetFile, candidatesFrom, candidateFromText, buildCustomWing, fillWingSize } from '../sheets/importsheet.js?v=16';

export async function renderImport(root, ctx) {
  clear(root);
  const target = ctx.fillTarget || null;          // { wingId, size } when filling a built-in size
  const wing = target ? await loadWing(target.wingId).catch(() => null) : null;
  const expected = wing ? expectedLineIds(wing, target.size) : null;

  const wrap = el(`
    <div>
      <button class="btn ghost sm" id="back" style="margin-left:-8px">${icon.back} Back</button>
      <h1>${wing ? `Add lengths for ${esc(wing.brand)} ${esc(wing.model)} ${esc(target.size)}` : 'Add your wing'}</h1>
      <p class="lede">${wing
        ? `The line plan (${expected.length} lines per side) is already set up. Load the manufacturer's line-check sheet for this size.`
        : 'Load the manufacturer\'s line-check sheet — the app finds the manual check table, and the cascade and rib positions when the sheet has them.'}</p>
      ${wing && /advance/i.test(wing.brand) ? `<div class="note" style="margin-bottom:14px">${icon.info}<span>
        Advance: <b>advance.swiss → Downloads → ${esc(wing.model)} → Maintenance → Total line length → ${esc(target.size)}</b>.
        Advance emails you the file.</span></div>` : ''}
      <label class="dropzone" id="drop">
        ${icon.upload}
        <b>Drop the .xlsx or .csv here</b>
        <span class="muted small">or tap to choose a file</span>
        <input type="file" id="file" accept=".xlsx,.csv,.tsv,.txt" hidden>
      </label>
      <details class="more" style="margin-top:10px">
        <summary>${icon.chevron} Or paste the table as text</summary>
        <textarea class="input" id="paste" style="margin-top:8px" placeholder="A1  7.429&#10;A2  7.387&#10;…"></textarea>
        <button class="btn sm soft" id="use-paste" style="margin-top:8px">Use pasted table</button>
      </details>
      <div id="found" style="margin-top:18px"></div>
    </div>`);
  root.appendChild(wrap);
  $('#back', wrap).addEventListener('click', () => { ctx.fillTarget = null; ctx.goto(wing ? 'setup' : 'wings'); });

  let candidates = [];
  let picked = null;

  async function load(file) {
    const found = $('#found', wrap);
    found.innerHTML = `<p class="muted">Reading ${esc(file.name)}…</p>`;
    try {
      const sheets = await readSheetFile(file);
      candidates = candidatesFrom(sheets, expected);
      show(file.name);
    } catch (e) {
      found.innerHTML = `<div class="note warn">${icon.warn}<span>${esc(e.message)}</span></div>`;
    }
  }

  function show(name) {
    const found = $('#found', wrap);
    clear(found);
    if (!candidates.length) {
      found.appendChild(el(`<div class="note warn">${icon.warn}<span>No manual check table found in ${esc(name)}.
        Production tables are deliberately not offered — they differ from the check lengths by up to ~40 mm.
        Try the paste box with the manual values.</span></div>`));
      return;
    }
    found.appendChild(el(`<h3 style="margin-top:0">Which table?</h3>`));
    const list = el('<div></div>');
    candidates.forEach((c, i) => {
      const n = Object.keys(c.lines).length;
      const letters = [...new Set(Object.keys(c.lines).map(k => k.replace(/^\d+/, '')[0]))].join(' ');
      const cov = c.coverage
        ? (c.coverage.missing.length
          ? `<span class="status bad">${icon.x} ${c.coverage.missing.length} missing</span>`
          : `<span class="status good">${icon.ok} all ${expected.length} lines</span>`)
        : '';
      const extras = [c.ribs ? 'rib positions' : null, c.mains ? 'cascade' : null, c.loops?.length ? `loops on ${c.loops.join(' ')}` : null].filter(Boolean);
      const card = el(`<label class="choice">
        <input type="radio" name="cand" value="${i}" ${i === 0 ? 'checked' : ''}>
        <div class="grow"><b>${esc(c.title)}</b>
          <span>${n} lines · ${esc(letters)}${extras.length ? ' · ' + esc(extras.join(' · ')) : ''}</span>
          <div class="small muted">${esc(c.detail || '')}</div>
          <div style="margin-top:6px">${cov}</div>
        </div></label>`);
      card.querySelector('input').addEventListener('change', () => { picked = c; });
      list.appendChild(card);
    });
    picked = candidates[0];
    found.appendChild(list);

    if (!wing) {
      found.appendChild(el(`<div class="card flat" style="margin-top:14px">
        <div class="row wrap">
          <label class="field grow"><span>Brand</span><input class="input" id="brand" placeholder="e.g. Nova"></label>
          <label class="field grow"><span>Model</span><input class="input" id="model" placeholder="e.g. Mentor 7"></label>
        </div>
        <div class="row wrap">
          <label class="field grow"><span>Size</span><input class="input" id="size" placeholder="e.g. M"></label>
          <label class="field grow"><span>Class</span><select class="input" id="cls">
            ${CLASSES.map(c => `<option>${c}</option>`).join('')}<option value="">Other</option></select></label>
        </div></div>`));
    }
    const save = el(`<button class="btn primary block big" style="margin-top:14px">${icon.check} ${wing ? 'Save lengths' : 'Save wing'}</button>`);
    save.addEventListener('click', commit);
    found.appendChild(save);
  }

  function commit() {
    if (!picked) return;
    if (wing) {
      if (picked.coverage?.missing.length) {
        toast(`${picked.coverage.missing.length} of ${expected.length} lines missing (${picked.coverage.missing.slice(0, 4).join(', ')}…) — not saved`);
        return;
      }
      const w = fillWingSize(wing, target.size, picked);
      customGliders.save(w);
      ctx.fillTarget = null;
      toast('Lengths saved — ready to measure');
      ctx.chooseWing(w.id, target.size);
      return;
    }
    const brand = $('#brand', wrap).value, model = $('#model', wrap).value, size = $('#size', wrap).value || 'M';
    if (!brand.trim() || !model.trim()) { toast('Add the brand and model'); return; }
    const w = buildCustomWing({ brand, model, wingClass: $('#cls', wrap).value, sizeKey: size, candidate: picked });
    customGliders.save(w);
    toast('Wing saved');
    ctx.chooseWing(w.id, size.trim() || 'M');
  }

  const drop = $('#drop', wrap), file = $('#file', wrap);
  file.addEventListener('change', () => file.files[0] && load(file.files[0]));
  for (const e of ['dragenter', 'dragover']) drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.add('over'); });
  for (const e of ['dragleave', 'drop']) drop.addEventListener(e, ev => { ev.preventDefault(); drop.classList.remove('over'); });
  drop.addEventListener('drop', ev => { const f = ev.dataTransfer?.files?.[0]; if (f) load(f); });
  $('#use-paste', wrap).addEventListener('click', () => {
    candidates = [candidateFromText($('#paste', wrap).value, expected)];
    if (!Object.keys(candidates[0].lines).length) { toast('No "A1  7.429" style rows found'); return; }
    show('pasted text');
  });
}
