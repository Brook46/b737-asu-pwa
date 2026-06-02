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

// ---------- Flightradar24 quick-track ----------
// Three-letter input (e.g. "EHE") is treated as an Israeli-fleet registration
// suffix and prefixed with "4X-". Anything else passes through untouched.
function normaliseRegistration(raw) {
  const s = String(raw || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return '';
  if (/^[A-Z]{3}$/.test(s)) return '4X-' + s;
  return s;
}
$('fr24-btn').addEventListener('click', () => {
  const tail = storage.getCurrent().dataCard.tail || $('hdr-tail').value;
  const reg = normaliseRegistration(tail);
  if (!reg) {
    toast('Set tail # first');
    return;
  }
  const url = 'https://www.flightradar24.com/data/aircraft/' + encodeURIComponent(reg.toLowerCase());
  window.open(url, '_blank', 'noopener,noreferrer');
});
$('pa-close').addEventListener('click', () => speeches.close());

$('pa-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'pa-overlay') speeches.close();
});

// ---------- Live ATIS / METAR popup ----------
let wxRefreshTimer = null;
const WX_REFRESH_MS = 10 * 60 * 1000;

// Airport source state: 'dep' (departure), 'arr' (destination), or 'custom'.
// wxCustomCode holds the user-typed ICAO when source = 'custom'.
// wxDisplayLetter is whatever letter the popup is *currently showing* — so the
// manual chip strip can highlight in sync with the big letter even when the
// popup is on Arr / Custom and the data card's atis field is unchanged.
let wxSource = 'dep';
let wxCustomCode = '';
let wxDisplayLetter = '';

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-wx-open]');
  if (btn && !btn.disabled) openWx();
});
$('wx-close').addEventListener('click', closeWx);
$('wx-overlay').addEventListener('click', (e) => { if (e.target.id === 'wx-overlay') closeWx(); });
$('wx-refresh').addEventListener('click', () => loadWx({ force: true }));

// Source switcher
$('wx-src-dep').addEventListener('click', () => switchWxSource('dep'));
$('wx-src-arr').addEventListener('click', () => switchWxSource('arr'));
// OTHER works in two taps so the keyboard doesn't ambush the user:
//   1st tap → select the Custom source (highlight only, no keyboard)
//   2nd tap → focus the input (keyboard pops up, user can type)
document.querySelector('.wx-src-custom').addEventListener('click', (e) => {
  if (wxSource !== 'custom') {
    e.preventDefault();
    wxSource = 'custom';
    paintWxSrcRow();
    // Do NOT focus the input — that would open the keyboard immediately.
    // The input has its own click handler for the second tap.
  } else {
    // Already on custom — let the click fall through to the input, which
    // focuses it and brings up the keyboard.
    $('wx-src-custom-input').focus();
  }
});
$('wx-src-custom-input').addEventListener('input', () => {
  wxCustomCode = $('wx-src-custom-input').value.trim().toUpperCase();
  // Auto-fetch as soon as we have a plausible 3 or 4-letter code.
  if (wxSource === 'custom' && (wxCustomCode.length === 3 || wxCustomCode.length === 4)) {
    loadWx({ force: false });
  }
});
$('wx-src-custom-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); loadWx({ force: true }); e.target.blur(); }
});

function switchWxSource(src) {
  wxSource = src;
  paintWxSrcRow();
  if (src !== 'custom') loadWx({ force: false });
  // 'custom' first tap only highlights; the second tap (handled in the
  // .wx-src-custom click listener above) focuses the input.
}

function paintWxSrcRow() {
  const d = storage.getCurrent().dataCard;
  $('wx-src-dep-code').textContent = (d.dep || '—').toString().toUpperCase();
  $('wx-src-arr-code').textContent = (d.arr || '—').toString().toUpperCase();
  $('wx-src-dep').classList.toggle('on', wxSource === 'dep');
  $('wx-src-arr').classList.toggle('on', wxSource === 'arr');
  document.querySelector('.wx-src-custom')?.classList.toggle('on', wxSource === 'custom');
  // Disable Dep / Arr buttons when the underlying field is empty so the user
  // gets immediate feedback that there's nothing to fetch there yet.
  $('wx-src-dep').disabled = !d.dep;
  $('wx-src-arr').disabled = !d.arr;
}

function resolveWxCode() {
  const d = storage.getCurrent().dataCard;
  if (wxSource === 'arr')    return (d.arr || '').toString().toUpperCase();
  if (wxSource === 'custom') return wxCustomCode.toUpperCase();
  return (d.dep || '').toString().toUpperCase();
}

async function openWx() {
  const d = storage.getCurrent().dataCard;
  // Pick a sensible default source: dep if set, else arr, else custom.
  if (d.dep) wxSource = 'dep';
  else if (d.arr) wxSource = 'arr';
  else wxSource = 'custom';
  $('wx-src-custom-input').value = wxCustomCode;
  paintWxSrcRow();
  renderManualChips();
  showOverlay('wx-overlay');
  await loadWx({ force: false });
  // Mark current letter as read once popup is open
  const cur = storage.getCurrent().dataCard.atis;
  if (cur && wxSource === 'dep') {
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
  const code = resolveWxCode();
  if (!code || code.length < 3) {
    paintWx({ icao: code || '—', letter: '', metar: null, datis: null, ts: 0 });
    return;
  }
  const refreshBtn = $('wx-refresh');
  refreshBtn.disabled = true;
  refreshBtn.textContent = '…';
  try {
    const { fetchWx, extractLetter, extractText } = await import('./modules/wx.js');
    const res = await fetchWx(code, opts);
    if (!res) {
      paintWx({ icao: code, letter: '', metar: null, datis: null, ts: 0 });
      return;
    }
    const liveLetter = extractLetter(res.datis);
    // Only the Dep source feeds back into the data card's ATIS cell —
    // Arr / Custom are reference-only and don't change the card's letter.
    if (liveLetter && wxSource === 'dep') {
      const prev = storage.getCurrent().dataCard.atis;
      if (prev !== liveLetter) {
        storage.setDataField('atis', liveLetter);
        storage.setDataField('atis_read', '');
      }
    }
    const cardLetter = storage.getCurrent().dataCard.atis;
    const letter = (wxSource === 'dep' ? cardLetter : null) || liveLetter || '';
    paintWx({
      icao: res.icao,
      letter,
      metar: res.metar,
      datis: res.datis,
      ts: res.ts,
      datisText: extractText(res.datis),
    });
    if (wxSource === 'dep') dataCard.render(dataBody);
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = '↻';
  }
}

function paintWx({ icao, letter, metar, datis, ts, datisText }) {
  wxDisplayLetter = letter || '';
  const read = !!letter && storage.getCurrent().dataCard.atis_read === letter;
  const wxLetterEl = $('wx-letter');
  wxLetterEl.textContent = letter || '—';
  wxLetterEl.classList.toggle('is-unread', !!letter && !read);
  wxLetterEl.classList.toggle('is-empty', !letter);
  // Keep the manual chip strip in sync with whatever letter the popup is
  // currently showing, regardless of which source feeds it.
  syncChipHighlight();
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
  // Highlight reflects the popup's currently shown letter (wxDisplayLetter),
  // so the chip strip and big letter never disagree even on Arr / Custom.
  const chips = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map(L =>
    `<button type="button" class="atis-chip${L === wxDisplayLetter ? ' on' : ''}" data-wx-chip="${L}">${L}</button>`
  ).join('');
  $('wx-chips').innerHTML = chips;
  $('wx-chips').querySelectorAll('[data-wx-chip]').forEach(b => {
    b.addEventListener('click', () => {
      const tapped = b.dataset.wxChip;
      // Tapping the currently-selected chip again deselects (clears) — gives
      // the user a way to reset to no letter without picking a wrong one.
      const next = (tapped === wxDisplayLetter) ? '' : tapped;
      // Manual letter only updates the data card when the popup is showing
      // the Dep ATIS — picking a letter while looking at Arr / Custom only
      // updates the popup display, not the flight's ATIS field.
      if (wxSource === 'dep') {
        storage.setDataField('atis', next);
        // Selecting a fresh letter marks it as read; clearing also clears read.
        storage.setDataField('atis_read', next);
        dataCard.render(dataBody);
      }
      paintWxLetter(next);
      syncChipHighlight();
    });
  });
}

// Update the chip "on" class without re-rendering the whole strip, so the
// active-chip indicator can move instantly without losing scroll / focus.
function syncChipHighlight() {
  $('wx-chips').querySelectorAll('[data-wx-chip]').forEach(b => {
    b.classList.toggle('on', b.dataset.wxChip === wxDisplayLetter);
  });
}

function paintWxLetter(letter) {
  wxDisplayLetter = letter || '';
  const wxLetterEl = $('wx-letter');
  wxLetterEl.textContent = letter || '—';
  wxLetterEl.classList.toggle('is-unread', false);
  wxLetterEl.classList.toggle('is-empty', !letter);
}

// Clear ATIS state when Dep changes (so new airport's letter is fresh / unread)
dataCard.setOnChange((key) => {
  if (key === 'tail' || key === 'flight' || key === 'ctot') syncHeaderInputs();
  // Keep the wx popup's source codes in sync with whatever the user types
  if ((key === 'dep' || key === 'arr') && !document.getElementById('wx-overlay').classList.contains('hidden')) {
    paintWxSrcRow();
  }
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
    // Keep the paste-text panel open so the user can paste another roster
    // (or edit / re-parse the current one) without re-opening the sheet.
    const details = document.querySelector('.ocr-paste');
    if (details) details.open = true;
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
