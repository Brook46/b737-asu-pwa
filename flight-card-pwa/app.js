// app.js — bootstrap: theme, header (clocks + tail/flt), sections, overlays, SW.

import * as storage from './modules/storage.js';
import * as dataCard from './modules/data-card.js';
import * as checklist from './modules/checklist.js';
import * as speeches from './modules/speeches.js';
import { initTheme, cycleTheme, toast, showOverlay, hideOverlay } from './modules/ui.js';

const $ = (id) => document.getElementById(id);

// ---------- Init theme + register SW ----------
initTheme();
window.fcToast = toast;  // expose for modules that don't import ui

// The header sync + speeches notify is wired below alongside the wx clear-on-dep-change.

// Auto-collapse the entire checklist card when everything is done.
let checklistAutoCollapsed = false;
checklist.setOnAllDoneChange((allDone) => {
  const card = document.getElementById('card-checklist');
  if (!card) return;
  if (allDone && !checklistAutoCollapsed) {
    card.classList.add('collapsed');
    checklistAutoCollapsed = true;
    syncCardChev('checklist');
  } else if (!allDone && checklistAutoCollapsed) {
    card.classList.remove('collapsed');
    checklistAutoCollapsed = false;
    syncCardChev('checklist');
  }
});
function syncCardChev(target) {
  const btn = document.querySelector(`.card-toggle[data-target="${target}"]`);
  if (!btn) return;
  const open = !document.querySelector(`.card[data-section="${target}"]`).classList.contains('collapsed');
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  btn.querySelector('.chev').textContent = open ? '▾' : '▸';
}

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
consumeRosterFromUrl();

// If the user just shared roster text via the iOS Share Sheet → share-roster.html,
// it bounces back to ./?roster=<encoded>. Parse and apply, then strip the URL.
async function consumeRosterFromUrl() {
  const q = new URLSearchParams(location.search);
  const raw = q.get('roster');
  if (!raw) return;
  try {
    const { parseRoster } = await import('./modules/roster.js');
    const parsed = parseRoster(raw);
    if (parsed) {
      await applyRoster(parsed);
    } else {
      toast('Shared text did not look like a roster');
    }
  } catch (err) {
    console.warn('roster ingest failed', err);
    toast('Roster import failed');
  } finally {
    // Clean the URL so reloads don't keep re-applying
    const url = new URL(location.href);
    url.search = '';
    history.replaceState({}, '', url.toString());
  }
}


function renderAll() {
  dataCard.render(dataBody);
  checklist.render(checklistBody);
  renderHistory();
  renderLegSwitcher();
}

// ---------- Leg switcher ----------
function renderLegSwitcher() {
  const sw = $('leg-switcher');
  const legs = storage.getLegs();
  if (!sw) return;
  if (!legs.length || legs.length < 2) {
    sw.classList.add('hidden');
    return;
  }
  sw.classList.remove('hidden');
  const idx = storage.getLegIndex();
  const leg = legs[idx];
  $('leg-pos').textContent = `Leg ${idx + 1} / ${legs.length}`;
  const flight = leg.flight ? `LY${leg.flight}` : '';
  const route  = (leg.dep && leg.arr) ? `${leg.dep} → ${leg.arr}` : '';
  $('leg-route').textContent = [flight, route].filter(Boolean).join('  ');
  $('leg-prev').disabled = idx <= 0;
  $('leg-next').disabled = idx >= legs.length - 1;
}
async function applyLeg(idx) {
  const legs = storage.getLegs();
  if (!legs.length) return;
  const clamped = Math.max(0, Math.min(legs.length - 1, idx));
  storage.setLegIndex(clamped);
  const { legToFields } = await import('./modules/roster.js');
  const fields = legToFields(legs[clamped]);
  // tail + flight live in the header (not in data-card FIELDS), so write them
  // directly via setDataBulk; the rest goes through applyExternal which knows
  // each cell's normalizer.
  const headerKeys = ['tail', 'flight'];
  const headerBag = {};
  for (const k of headerKeys) if (fields[k] != null) headerBag[k] = fields[k];
  if (Object.keys(headerBag).length) storage.setDataBulk(headerBag);
  dataCard.applyExternal(fields, dataBody);
  syncHeaderInputs();
  renderLegSwitcher();
  speeches.notifyDataChange();
}
async function applyRoster(parsed) {
  if (!parsed || !parsed.flights?.length) return;
  storage.setLegs(parsed.flights);
  await applyLeg(0);
  toast(`Roster: ${parsed.flights.length} leg${parsed.flights.length === 1 ? '' : 's'} loaded`);
}
$('leg-prev').addEventListener('click', () => applyLeg(storage.getLegIndex() - 1));
$('leg-next').addEventListener('click', () => applyLeg(storage.getLegIndex() + 1));

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
// Select-all on focus for header inputs so a single keystroke replaces the value
['hdr-tail', 'hdr-flight', 'hdr-ctot'].forEach(id => {
  const el = $(id);
  if (!el) return;
  el.addEventListener('focus', () => {
    setTimeout(() => { try { el.select(); } catch {} }, 0);
  });
});

function syncHeaderInputs() {
  const data = storage.getCurrent().dataCard;
  const tail = $('hdr-tail');
  const flt  = $('hdr-flight');
  const ctot = $('hdr-ctot');
  if (tail && document.activeElement !== tail) tail.value = data.tail || '';
  if (flt  && document.activeElement !== flt)  flt.value  = data.flight || '';
  if (ctot && document.activeElement !== ctot) ctot.value = data.ctot || '';
}
$('hdr-tail').addEventListener('input', () => {
  storage.setDataField('tail', $('hdr-tail').value.toUpperCase());
  speeches.notifyDataChange();
});
$('hdr-flight').addEventListener('input', () => {
  storage.setDataField('flight', $('hdr-flight').value.toUpperCase());
  speeches.notifyDataChange();
});

// Header CTOT input — live HH:MM formatting + autosave
const hdrCtot = $('hdr-ctot');
hdrCtot.addEventListener('input', () => {
  const formatted = formatHHMM(hdrCtot.value);
  if (hdrCtot.value !== formatted) {
    hdrCtot.value = formatted;
    try { hdrCtot.setSelectionRange(formatted.length, formatted.length); } catch {}
  }
  storage.setDataField('ctot', formatted);
  speeches.notifyDataChange();
});
function formatHHMM(raw) {
  const digits = String(raw || '').replace(/\D/g, '').slice(0, 4);
  if (digits.length <= 2) return digits;
  return digits.slice(0, digits.length - 2) + ':' + digits.slice(-2);
}

// ---------- Header actions ----------
$('theme-toggle').addEventListener('click', cycleTheme);
$('new-flight').addEventListener('click', () => {
  if (!confirm('Start a new flight? Current data and ticks will be archived.')) return;
  storage.newFlight();
  storage.clearLegs();
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

// ---------- Live ATIS / METAR popup ----------
let wxRefreshTimer = null;
const WX_REFRESH_MS = 10 * 60 * 1000;

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-wx-open]');
  if (btn && !btn.disabled) openWx();
});
$('wx-close').addEventListener('click', closeWx);
$('wx-overlay').addEventListener('click', (e) => { if (e.target.id === 'wx-overlay') closeWx(); });
$('wx-refresh').addEventListener('click', () => loadWx({ force: true }));

async function openWx() {
  const dep = (storage.getCurrent().dataCard.dep || '').toString().toUpperCase();
  if (!dep) { toast('Set Dep airport first'); return; }
  renderManualChips();
  showOverlay('wx-overlay');
  await loadWx({ force: false });
  // Mark current letter as read once popup is open
  const cur = storage.getCurrent().dataCard.atis;
  if (cur) {
    storage.setDataField('atis_read', cur);
    dataCard.render(dataBody);
  }
  // Auto-refresh every 10 minutes while open
  if (wxRefreshTimer) clearInterval(wxRefreshTimer);
  wxRefreshTimer = setInterval(() => loadWx({ force: true }), WX_REFRESH_MS);
}

function closeWx() {
  hideOverlay('wx-overlay');
  if (wxRefreshTimer) { clearInterval(wxRefreshTimer); wxRefreshTimer = null; }
}

async function loadWx(opts) {
  const dep = (storage.getCurrent().dataCard.dep || '').toString().toUpperCase();
  if (!dep) return;
  const refreshBtn = $('wx-refresh');
  refreshBtn.disabled = true;
  refreshBtn.textContent = '…';
  try {
    const { fetchWx, extractLetter, extractText } = await import('./modules/wx.js');
    const res = await fetchWx(dep, opts);
    if (!res) {
      paintWx({ icao: dep, letter: '', metar: null, datis: null, ts: 0 });
      return;
    }
    const liveLetter = extractLetter(res.datis);
    // If D-ATIS supplied a letter, store it on the data card so the cell shows it.
    if (liveLetter) {
      const prev = storage.getCurrent().dataCard.atis;
      if (prev !== liveLetter) {
        storage.setDataField('atis', liveLetter);
        // Letter changed → mark unread (clear atis_read so cell goes red)
        storage.setDataField('atis_read', '');
      }
    }
    const cur = storage.getCurrent().dataCard.atis;
    paintWx({
      icao: res.icao,
      letter: cur || liveLetter || '',
      metar: res.metar,
      datis: res.datis,
      ts: res.ts,
      datisText: extractText(res.datis),
    });
    dataCard.render(dataBody);
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '↻';
  }
}

function paintWx({ icao, letter, metar, datis, ts, datisText }) {
  const read = !!letter && storage.getCurrent().dataCard.atis_read === letter;
  const wxLetterEl = $('wx-letter');
  wxLetterEl.textContent = letter || '—';
  wxLetterEl.classList.toggle('is-unread', !!letter && !read);
  wxLetterEl.classList.toggle('is-empty', !letter);
  $('wx-icao').textContent = icao;
  $('wx-time').textContent = ts ? 'Updated ' + new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
  $('wx-atisguru').href = 'https://atis.guru/atis/' + encodeURIComponent(icao);
  const metarEl = $('wx-metar-text');
  if (metar) { metarEl.textContent = metar; metarEl.classList.remove('empty'); }
  else       { metarEl.textContent = 'No METAR available'; metarEl.classList.add('empty'); }
  const datisEl = $('wx-datis-text');
  if (datisText) { datisEl.textContent = datisText; datisEl.classList.remove('empty'); }
  else           { datisEl.textContent = `No D-ATIS for ${icao} — use manual letter below`; datisEl.classList.add('empty'); }
}

function renderManualChips() {
  const cur = storage.getCurrent().dataCard.atis || '';
  const chips = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(L =>
    `<button type="button" class="atis-chip${L === cur ? ' on' : ''}" data-wx-chip="${L}">${L}</button>`
  ).join('');
  $('wx-chips').innerHTML = chips;
  $('wx-chips').querySelectorAll('[data-wx-chip]').forEach(b => {
    b.addEventListener('click', () => {
      const next = b.dataset.wxChip;
      storage.setDataField('atis', next);
      storage.setDataField('atis_read', next); // user picked it → already read
      dataCard.render(dataBody);
      renderManualChips();
      // Re-paint letter in popup
      paintWxLetter(next);
    });
  });
}
function paintWxLetter(letter) {
  const wxLetterEl = $('wx-letter');
  wxLetterEl.textContent = letter || '—';
  wxLetterEl.classList.toggle('is-unread', false);
  wxLetterEl.classList.toggle('is-empty', !letter);
}

// Clear ATIS state when Dep changes (so new airport's letter is fresh / unread)
dataCard.setOnChange((key) => {
  if (key === 'tail' || key === 'flight' || key === 'ctot') syncHeaderInputs();
  if (key === 'dep') {
    storage.setDataField('atis', '');
    storage.setDataField('atis_read', '');
    dataCard.render(dataBody);
  }
  speeches.notifyDataChange();
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
$('ocr-paste-img').addEventListener('click', async () => {
  try {
    if (!navigator.clipboard?.read) throw new Error('Clipboard API unavailable');
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imgType = item.types.find(t => t.startsWith('image/'));
      if (!imgType) continue;
      const blob = await item.getType(imgType);
      const file = new File([blob], 'pasted.png', { type: imgType });
      await handleOcrFile(file);
      return;
    }
    toast('No image on the clipboard');
  } catch (err) {
    toast('Paste image: ' + (err?.message || err));
  }
});
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
  // Roster first — if the pasted text is a duty roster, take that branch.
  const { parseRoster } = await import('./modules/roster.js');
  const roster = parseRoster(text);
  if (roster) {
    await applyRoster(roster);
    hideOverlay('ocr-overlay');
    return;
  }
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
