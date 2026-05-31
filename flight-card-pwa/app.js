// app.js — bootstrap: theme, header (clocks + tail/flt), sections, overlays, SW.

import * as storage from './modules/storage.js';
import * as dataCard from './modules/data-card.js';
import * as checklist from './modules/checklist.js';
import * as speeches from './modules/speeches.js';
import { initTheme, cycleTheme, toast, showOverlay, hideOverlay } from './modules/ui.js';

const $ = (id) => document.getElementById(id);

// ---------- Init theme + register SW ----------
initTheme();

// Re-render the header whenever data card changes (live as you type)
dataCard.setOnChange((key) => {
  if (key === 'tail' || key === 'flight') syncHeaderInputs();
  speeches.notifyDataChange();
});

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
startClocks();
syncHeaderInputs();

function renderAll() {
  dataCard.render(dataBody);
  checklist.render(checklistBody);
  renderHistory();
}

// ---------- Clocks ----------
function startClocks() {
  tickClocks();
  setInterval(tickClocks, 1000);
}
function tickClocks() {
  const now = new Date();
  const u = $('clock-utc');
  if (u) u.textContent = `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}Z`;
}
function pad(n) { return String(n).padStart(2, '0'); }

// ---------- Header tail/flight inputs ----------
function syncHeaderInputs() {
  const data = storage.getCurrent().dataCard;
  const tail = $('hdr-tail');
  const flt  = $('hdr-flight');
  if (tail && document.activeElement !== tail) tail.value = data.tail || '';
  if (flt  && document.activeElement !== flt)  flt.value  = data.flight || '';
}
$('hdr-tail').addEventListener('input', () => {
  storage.setDataField('tail', $('hdr-tail').value.toUpperCase());
  dataCard.render(dataBody);
  speeches.notifyDataChange();
});
$('hdr-flight').addEventListener('input', () => {
  storage.setDataField('flight', $('hdr-flight').value.toUpperCase());
  dataCard.render(dataBody);
  speeches.notifyDataChange();
});

// ---------- Header actions ----------
$('theme-toggle').addEventListener('click', cycleTheme);
$('new-flight').addEventListener('click', () => {
  if (!confirm('Start a new flight? Current data and ticks will be archived.')) return;
  storage.newFlight();
  checklist.resetOverrides();
  renderAll();
  syncHeaderInputs();
  toast('New flight started');
});
$('pa-toggle').addEventListener('click', () => speeches.open());
$('pa-close').addEventListener('click', () => speeches.close());
$('pa-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'pa-overlay') speeches.close();
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
    const { ocrImage } = await import('./modules/ocr.js');
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
  const { parseFmcText, buildReviewFields } = await import('./modules/ocr.js');
  const parsed = parseFmcText(text);
  $('ocr-progress').classList.add('hidden');
  const headline = ['v1','vr','v2','n1','flaps','trip_fuel','block_fuel','sob_total','atis','tail','flight','dep','arr'];
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
  syncHeaderInputs();
  speeches.notifyDataChange();
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
      d.atis ? `ATIS ${d.atis}` : '',
    ].filter(Boolean).join(' · ');
    return `<div class="history-item" data-id="${h.id}">
      <div class="hi-top">
        <span class="hi-id">${escapeHtml(id)}</span>
        <span class="hi-date">${fmtDateShort(h.started)}</span>
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
      alert(`${fmtDateShort(h.started)}\n\n${summary || '(no data)'}`);
    });
  });
}

function fmtDateShort(ts) {
  const d = new Date(ts);
  return `${pad(d.getDate())}/${pad(d.getMonth()+1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------- Helpers ----------
function escapeAttr(s) { return String(s).replace(/"/g, '&quot;'); }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[ch]);
}
