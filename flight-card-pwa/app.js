// app.js — bootstrap: theme, header, sections, overlays, SW.

import * as storage from './modules/storage.js?v=1';
import * as dataCard from './modules/data-card.js?v=1';
import * as checklist from './modules/checklist.js?v=1';
import { initTheme, cycleTheme, wirePadControls, toast, fmtDate, fmtTime, showOverlay, hideOverlay } from './modules/ui.js?v=1';

const $ = (id) => document.getElementById(id);

// ---------- Init theme + register SW ----------
initTheme();
wirePadControls();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(err => console.warn('SW register failed', err));
  });
}

// ---------- Render shell ----------
const dataBody = $('data-body');
const checklistBody = $('checklist-body');
const historyBody = $('history-body');

renderAll();

function renderAll() {
  dataCard.render(dataBody);
  checklist.render(checklistBody);
  renderHistory();
  renderFlightHeader();
}

function renderFlightHeader() {
  const cur = storage.getCurrent();
  const settings = storage.getSettings();
  const d = cur.dataCard;
  let tag = 'NEW FLIGHT';
  const tail = (d.tail || '').toString().toUpperCase();
  const flt  = (d.flight || '').toString().toUpperCase();
  if (settings.idFormat === 'date-tail' && tail) tag = tail + (flt ? ` · ${flt}` : '');
  else if (settings.idFormat === 'date-flight' && flt) tag = flt + (tail ? ` · ${tail}` : '');
  else if (tail || flt) tag = [tail, flt].filter(Boolean).join(' · ');
  $('flight-date').textContent = fmtDate(cur.started) + ' · ' + fmtTime(cur.started);
  $('flight-tag').textContent = tag;
}

// ---------- Header buttons ----------
$('theme-toggle').addEventListener('click', cycleTheme);
$('new-flight').addEventListener('click', () => {
  if (!confirm('Start a new flight? Current ticks will be archived.')) return;
  storage.newFlight();
  renderAll();
  toast('New flight started');
});
$('settings-toggle').addEventListener('click', openSettings);
$('flight-id-btn').addEventListener('click', () => {
  // Quick jump to scroll data card into view
  $('card-data').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

// ---------- Card collapsibles ----------
document.querySelectorAll('.card-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.target;
    const card = document.querySelector(`.card[data-section="${target}"]`);
    if (!card) return;
    card.classList.toggle('collapsed');
    const open = !card.classList.contains('collapsed');
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.querySelector('.chev').textContent = open ? '▾' : '▸';
    if (target === 'history' && open) renderHistory();
  });
});

// ---------- Checklist edit mode ----------
$('checklist-edit').addEventListener('click', () => {
  const on = !checklist.isEditMode();
  checklist.setEditMode(on);
  const btn = $('checklist-edit');
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
  btn.textContent = on ? '✓' : '✎';
  btn.title = on ? 'Done editing' : 'Edit checklist';
  checklist.render(checklistBody);
});

// ---------- OCR overlay ----------
$('ocr-btn').addEventListener('click', () => {
  resetOcrOverlay();
  showOverlay('ocr-overlay');
});
$('ocr-close').addEventListener('click', () => hideOverlay('ocr-overlay'));
$('ocr-cancel').addEventListener('click', () => hideOverlay('ocr-overlay'));
$('ocr-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'ocr-overlay') hideOverlay('ocr-overlay');
});

$('ocr-file').addEventListener('change', (e) => handleOcrFile(e.target.files?.[0]));
$('ocr-camera').addEventListener('change', (e) => handleOcrFile(e.target.files?.[0]));
$('ocr-paste-parse').addEventListener('click', async () => {
  const text = $('ocr-paste-text').value || '';
  if (!text.trim()) { toast('Paste some text first'); return; }
  await runParse(text);
});

async function handleOcrFile(file) {
  if (!file) return;
  $('ocr-source').classList.add('hidden');
  $('ocr-progress').classList.remove('hidden');
  $('ocr-progress-text').textContent = 'Preparing image…';
  try {
    const { ocrImage } = await import('./modules/ocr.js?v=1');
    const text = await ocrImage(file, (msg, frac) => {
      $('ocr-progress-text').textContent = `${msg} ${(frac * 100).toFixed(0)}%`;
    });
    await runParse(text);
  } catch (err) {
    console.error(err);
    toast('OCR failed: ' + (err?.message || err));
    resetOcrOverlay();
  }
}

async function runParse(text) {
  const { parseFmcText, buildReviewFields } = await import('./modules/ocr.js?v=1');
  const parsed = parseFmcText(text);
  $('ocr-progress').classList.add('hidden');
  // Show only matched fields by default, plus a few headline always-on ones
  const headline = ['v1','vr','v2','vref','n1','flaps','trim','cg','tow','zfw','fuel','tail','flight','rwy'];
  const fields = buildReviewFields(parsed, headline);
  const matchedCount = fields.filter(f => f.matched).length;
  $('ocr-review').classList.remove('hidden');
  $('ocr-review').querySelector('p.small').textContent =
    matchedCount > 0
      ? `Matched ${matchedCount} field${matchedCount === 1 ? '' : 's'}. Review, edit, then Apply.`
      : `No fields matched — you can still type them in below, then Apply.`;
  const root = $('ocr-fields');
  root.innerHTML = fields.map(f => `
    <div class="ocr-field${f.matched ? '' : ' unmatched'}" data-key="${f.key}">
      <label>${f.label}</label>
      <input type="text" value="${escapeAttr(f.value)}" data-key="${f.key}" />
    </div>
  `).join('');
}

$('ocr-apply').addEventListener('click', () => {
  const root = $('ocr-fields');
  const out = {};
  root.querySelectorAll('input[data-key]').forEach(inp => {
    const v = inp.value.trim();
    if (v !== '') out[inp.dataset.key] = v;
  });
  if (Object.keys(out).length === 0) {
    toast('Nothing to apply');
    return;
  }
  dataCard.applyExternal(out, dataBody);
  renderFlightHeader();
  hideOverlay('ocr-overlay');
  toast(`Applied ${Object.keys(out).length} field${Object.keys(out).length === 1 ? '' : 's'}`);
});

function resetOcrOverlay() {
  $('ocr-source').classList.remove('hidden');
  $('ocr-progress').classList.add('hidden');
  $('ocr-review').classList.add('hidden');
  $('ocr-file').value = '';
  $('ocr-camera').value = '';
  $('ocr-paste-text').value = '';
}

// ---------- Settings overlay ----------
function openSettings() {
  const s = storage.getSettings();
  $('setting-wipe-data').checked = !!s.wipeDataOnNewFlight;
  $('setting-id-format').value = s.idFormat || 'date-tail';
  showOverlay('settings-overlay');
}
$('settings-close').addEventListener('click', () => hideOverlay('settings-overlay'));
$('settings-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'settings-overlay') hideOverlay('settings-overlay');
});
$('setting-wipe-data').addEventListener('change', (e) => storage.setSetting('wipeDataOnNewFlight', e.target.checked));
$('setting-id-format').addEventListener('change', (e) => {
  storage.setSetting('idFormat', e.target.value);
  renderFlightHeader();
});
$('settings-export').addEventListener('click', () => {
  const json = storage.exportJson();
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `flight-card-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
});
$('settings-import').addEventListener('click', () => $('settings-import-file').click());
$('settings-import-file').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try {
      storage.importJson(String(fr.result));
      renderAll();
      hideOverlay('settings-overlay');
      toast('Imported');
    } catch (err) {
      toast('Import failed: ' + err.message);
    }
  };
  fr.readAsText(file);
});
$('settings-reset').addEventListener('click', () => {
  if (!confirm('Reset everything? Template, current flight, and history will all be wiped.')) return;
  storage.resetAll();
  renderAll();
  hideOverlay('settings-overlay');
  toast('Reset');
});

// ---------- History ----------
function renderHistory() {
  const hist = storage.getHistory();
  if (!hist.length) {
    historyBody.innerHTML = `<div class="history-empty">No archived flights yet.</div>`;
    return;
  }
  historyBody.innerHTML = hist.map(h => {
    const d = h.dataCard || {};
    const id = [d.tail, d.flight].filter(Boolean).join(' · ') || 'Flight';
    const summary = [
      d.dep && d.arr ? `${d.dep}–${d.arr}` : '',
      d.v1 ? `V1 ${d.v1}` : '',
      d.vr ? `VR ${d.vr}` : '',
      d.v2 ? `V2 ${d.v2}` : '',
      d.flaps ? `FL ${d.flaps}` : '',
    ].filter(Boolean).join(' · ');
    return `<div class="history-item" data-id="${h.id}">
      <div class="hi-top">
        <span class="hi-id">${escapeHtml(id)}</span>
        <span class="hi-date">${fmtDate(h.started)} ${fmtTime(h.started)}</span>
      </div>
      <div class="hi-line">${escapeHtml(summary || '—')}</div>
    </div>`;
  }).join('');
  historyBody.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', () => {
      const h = storage.getHistory().find(x => x.id === el.dataset.id);
      if (!h) return;
      const d = h.dataCard;
      const summary = Object.entries(d).map(([k,v]) => `${k.toUpperCase()}: ${v}`).join('\n');
      alert(`${fmtDate(h.started)} ${fmtTime(h.started)}\n\n${summary || '(no data)'}`);
    });
  });
}

// ---------- Helpers ----------
function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
}

// Re-render header when data card changes (data-card.render re-binds on its own;
// we listen to clicks bubbling so we can refresh the title).
dataBody.addEventListener('click', () => {
  // After pad save flushes back into the cell, schedule a header re-render.
  setTimeout(renderFlightHeader, 0);
});
