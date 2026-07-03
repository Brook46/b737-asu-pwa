import { parseDutyPlan } from './parser.js';
import { renderInto, rangeLabel, addDays, startOfWeek, startOfDay } from './calendar.js';
import { eventToIcs, eventsToIcs, downloadIcs } from './ics.js';

// pdf.js
import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).toString();

const state = {
  view: 'month', // default — overridable from saved UI state in loadUi()
  anchor: startOfDay(new Date()),
  events: [],
  period: null,
  notes: loadNotes(),
  // Hide rest + dummy/vacation by default so first-timers see a focused calendar.
  // loadUi() respects any saved choice and overrides this.
  hiddenKinds: new Set(['rest', 'other']),
};

const MONTH_NAMES_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

const els = {
  root: document.getElementById('cal-root'),
  fileInput: document.getElementById('pdf-input'),
  todayBtn: document.getElementById('today-btn'),
  prevBtn: document.getElementById('prev-btn'),
  nextBtn: document.getElementById('next-btn'),
  rangeLabel: document.getElementById('range-label'),
  viewBtns: document.querySelectorAll('.view-btn'),
  modal: document.getElementById('modal'),
  modalClose: document.getElementById('modal-close'),
  modalTitle: document.getElementById('modal-title'),
  modalWhen: document.getElementById('modal-when'),
  modalBody: document.getElementById('modal-body'),
  modalNotes: document.getElementById('modal-notes'),
  exportBtn: document.getElementById('export-btn'),
  exportAllBtn: document.getElementById('export-all-btn'),
  addBtn: document.getElementById('add-event-btn'),
  editBtn: document.getElementById('edit-btn'),
  deleteBtn: document.getElementById('delete-btn'),
  modalView: document.getElementById('modal-view'),
  modalEdit: document.getElementById('modal-edit'),
  editModeTitle: document.getElementById('edit-mode-title'),
  editKind: document.getElementById('edit-kind'),
  editTitle: document.getElementById('edit-title'),
  editDate: document.getElementById('edit-date'),
  editStart: document.getElementById('edit-start'),
  editEnd: document.getElementById('edit-end'),
  editNotes: document.getElementById('edit-notes'),
  saveEditBtn: document.getElementById('save-edit-btn'),
  cancelEditBtn: document.getElementById('cancel-edit-btn'),
};

let currentEvent = null;
// Snapshot the initial empty-state markup from index.html so we can restore it
const emptyStateHtml = els.root.innerHTML;

// --- Persistence ---
function loadEvents() {
  try {
    const raw = localStorage.getItem('duty-cal:events');
    if (!raw) return null;
    const j = JSON.parse(raw);
    return {
      events: j.events.map(ev => ({ ...ev, start: new Date(ev.start), end: new Date(ev.end) })),
      period: j.period ? { ...j.period, startDate: new Date(j.period.startDate), endDate: new Date(j.period.endDate) } : null,
    };
  } catch { return null; }
}
function saveEvents() {
  try {
    localStorage.setItem('duty-cal:events', JSON.stringify({
      events: state.events,
      period: state.period,
    }));
  } catch {}
}
function loadNotes() {
  try { return JSON.parse(localStorage.getItem('duty-cal:notes') || '{}'); } catch { return {}; }
}
function saveNotes() {
  try { localStorage.setItem('duty-cal:notes', JSON.stringify(state.notes)); } catch {}
}
function loadUi() {
  try {
    const s = localStorage.getItem('duty-cal:ui');
    if (!s) return;
    const j = JSON.parse(s);
    if (j.view && ['day','week','month'].includes(j.view)) state.view = j.view;
    if (j.anchor) state.anchor = startOfDay(new Date(j.anchor));
    if (Array.isArray(j.hiddenKinds)) state.hiddenKinds = new Set(j.hiddenKinds);
  } catch {}
}
function saveUi() {
  try {
    localStorage.setItem('duty-cal:ui', JSON.stringify({
      view: state.view,
      anchor: state.anchor.toISOString(),
      hiddenKinds: [...state.hiddenKinds],
    }));
  } catch {}
}

// Map an event's internal kind to its legend group.
function legendGroupOf(kind) {
  if (kind === 'pickup' || kind === 'driveHome') return 'pickup';
  if (kind === 'flight')  return 'flight';
  if (kind === 'restEnd') return 'rest';
  if (kind === 'miluim')  return 'miluim';
  if (kind === 'custom')  return 'custom';
  return 'other';
}

function visibleEvents() {
  if (state.hiddenKinds.size === 0) return state.events;
  return state.events.filter(ev => !state.hiddenKinds.has(legendGroupOf(ev.kind)));
}

// --- PDF flow ---
async function extractText(file) {
  const buf = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: buf }).promise;
  let out = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    // Items come positionally; join with spaces. Newlines are inferred via y-shifts.
    let lastY = null;
    for (const item of content.items) {
      const y = item.transform ? item.transform[5] : null;
      if (lastY !== null && y !== null && Math.abs(y - lastY) > 3) out += '\n';
      out += item.str + ' ';
      lastY = y;
    }
    out += '\n\n';
  }
  return out;
}

async function onPdfChosen(file) {
  showBusy(true);
  const isFirstLoad = state.events.length === 0;
  try {
    const text = await extractText(file);
    const { events: newEvents, period } = parseDutyPlan(text);
    mergeIntoState(newEvents, period);
    state.period = period;
    if (isFirstLoad && period && period.startDate) {
      state.anchor = startOfDay(period.startDate);
    }
    saveEvents();
    saveUi();
    render();
    const monthStr = period ? `${MONTH_NAMES_SHORT[period.startDate.getMonth()]} ${period.startDate.getFullYear()}` : '';
    toast(isFirstLoad
      ? `Loaded ${newEvents.length} events from ${monthStr}.`
      : `Updated ${monthStr} — merged ${newEvents.length} events.`);
  } catch (err) {
    console.error(err);
    toast('Could not parse this PDF: ' + err.message, 4000);
  } finally {
    showBusy(false);
  }
}

// Replace PDF-origin events that fall within the new period. Events outside
// the period — and manually-added/edited events anywhere — are preserved.
// Same-content PDF events keep their stable id, so re-uploading a corrected
// PDF preserves notes attached to unchanged events.
function mergeIntoState(newEvents, period) {
  const startMs = period.startDate.getTime();
  const endExclusiveMs = new Date(period.endDate.getTime() + 24*60*60*1000).getTime();
  const preserved = state.events.filter(ev => {
    const t = ev.start.getTime();
    const inPeriod = t >= startMs && t < endExclusiveMs;
    if (!inPeriod) return true;
    return ev.origin === 'manual'; // keep manual edits across re-uploads
  });
  // Union by stable id — new wins
  const byId = new Map();
  for (const ev of preserved) byId.set(ev.id, ev);
  for (const ev of newEvents) byId.set(ev.id, ev);
  state.events = [...byId.values()].sort((a,b) => a.start - b.start);
}

// --- Rendering ---
function render() {
  if (state.events.length === 0) {
    els.root.innerHTML = emptyStateHtml;
    els.rangeLabel.textContent = '—';
  } else {
    renderInto(els.root, { view: state.view, anchor: state.anchor, events: visibleEvents() });
    els.rangeLabel.textContent = rangeLabel(state.view, state.anchor);
  }
  for (const b of els.viewBtns) {
    b.classList.toggle('active', b.dataset.view === state.view);
  }
  // Subhead: pilot name (if known)
  const sub = document.getElementById('subhead');
  if (sub) sub.textContent = state.period?.name ? state.period.name : '';
  saveUi();
}

// --- Modal ---
function openModal(ev) {
  currentEvent = ev;
  setEditMode(false);
  els.modalTitle.textContent = ev.title;
  els.modalWhen.textContent = formatWhen(ev);

  const rows = [];
  if (ev.kind === 'flight') {
    const d = ev.details;
    rows.push(['Flight', d.flight + (d.deadhead ? '  (Deadhead)' : '')]);
    rows.push(['Route', `${d.from} → ${d.to}`]);
    rows.push(['Departure', d.depTime]);
    rows.push(['Arrival', d.arrTime]);
    if (d.flightTime) rows.push(['Flight time', d.flightTime]);
  } else if (ev.kind === 'pickup') {
    rows.push(['Pickup at', ev.details.airport || 'TLV']);
    rows.push(['Note', 'Be ready at end time.']);
  } else if (ev.kind === 'driveHome') {
    rows.push(['From', 'TLV']);
    rows.push(['Window', '+1 hour after landing']);
  } else if (ev.kind === 'restEnd') {
    rows.push(['Rest period', ev.details.restPeriod || '']);
    rows.push(['Meaning', 'Earliest possible next duty start.']);
  } else {
    for (const [k,v] of Object.entries(ev.details || {})) rows.push([k, v]);
  }
  els.modalBody.innerHTML = rows.map(([k,v]) => `<div class="row"><span class="lbl">${k}</span><span>${escapeHtml(String(v))}</span></div>`).join('');

  els.modalNotes.value = state.notes[ev.id] || '';
  els.modal.hidden = false;
}
function closeModal() {
  if (currentEvent && !els.modalView.hidden) {
    const v = els.modalNotes.value.trim();
    if (v) state.notes[currentEvent.id] = v;
    else delete state.notes[currentEvent.id];
    saveNotes();
  }
  els.modal.hidden = true;
  currentEvent = null;
  editingEvent = null;
  setEditMode(false);
}

// --- Add / Edit / Delete ---
let editingEvent = null; // the event being edited; null when adding new

function setEditMode(on) {
  els.modalView.hidden = on;
  els.modalEdit.hidden = !on;
}

function openAddModal() {
  editingEvent = null;
  currentEvent = null;
  populateEditForm(null);
  setEditMode(true);
  els.modal.hidden = false;
  setTimeout(() => els.editTitle.focus(), 50);
}

function openEditModal() {
  if (!currentEvent) return;
  editingEvent = currentEvent;
  populateEditForm(editingEvent);
  setEditMode(true);
}

function populateEditForm(ev) {
  els.editModeTitle.textContent = ev ? 'Edit event' : 'New event';
  const anchor = ev ? ev.start : state.anchor;
  els.editKind.value = ev ? ev.kind : 'flight';
  els.editTitle.value = ev ? ev.title : '';
  els.editDate.value  = ymdLabel(anchor);
  els.editStart.value = ev ? hhmm(ev.start) : '08:00';
  els.editEnd.value   = ev ? hhmm(ev.end)   : '10:00';
  els.editNotes.value = ev ? (state.notes[ev.id] || '') : '';
}

function hhmm(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

function saveFromForm() {
  const kind = els.editKind.value;
  const title = els.editTitle.value.trim();
  const dateStr = els.editDate.value;
  const startStr = els.editStart.value;
  const endStr = els.editEnd.value;
  const noteStr = els.editNotes.value.trim();
  if (!title || !dateStr || !startStr || !endStr) {
    toast('Title, date, start and end are required.');
    return;
  }
  const start = new Date(`${dateStr}T${startStr}`);
  let end = new Date(`${dateStr}T${endStr}`);
  if (end <= start) end = new Date(end.getTime() + 24*60*60*1000); // wrap past midnight

  if (editingEvent) {
    // Edit in place — keep id, flip origin to manual so PDF re-uploads don't overwrite
    Object.assign(editingEvent, {
      kind, title,
      start, end,
      dayKey: ymdLabel(start),
      sub: `${hhmm(start)} → ${hhmm(end)}`,
      origin: 'manual',
    });
    if (noteStr) state.notes[editingEvent.id] = noteStr;
    else delete state.notes[editingEvent.id];
  } else {
    const id = 'manual-' + Math.random().toString(36).slice(2, 12);
    state.events.push({
      id, kind, title,
      start, end,
      dayKey: ymdLabel(start),
      sub: `${hhmm(start)} → ${hhmm(end)}`,
      details: {},
      origin: 'manual',
    });
    if (noteStr) state.notes[id] = noteStr;
  }
  state.events.sort((a, b) => a.start - b.start);
  saveEvents();
  saveNotes();
  // Jump the calendar to the affected day so the user sees their change
  state.anchor = startOfDay(start);
  editingEvent = null;
  currentEvent = null;
  els.modal.hidden = true;
  setEditMode(false);
  render();
  toast('Saved.');
}

function deleteCurrent() {
  if (!currentEvent) return;
  if (!confirm(`Delete "${currentEvent.title}"?`)) return;
  state.events = state.events.filter(e => e.id !== currentEvent.id);
  delete state.notes[currentEvent.id];
  saveEvents();
  saveNotes();
  currentEvent = null;
  els.modal.hidden = true;
  render();
  toast('Deleted.');
}
function formatWhen(ev) {
  const p = n => String(n).padStart(2,'0');
  const f = d => `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return `${f(ev.start)} → ${f(ev.end)}`;
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// --- Wire-up ---
els.fileInput.addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (f) onPdfChosen(f);
  e.target.value = '';
});

// Legend filters: click toggles visibility of that category. Saved across reloads.
for (const lg of document.querySelectorAll('.legend .lg')) {
  const kind = lg.dataset.kind;
  if (state.hiddenKinds.has(kind)) {
    lg.classList.add('off');
    lg.setAttribute('aria-pressed', 'false');
  }
  lg.addEventListener('click', () => {
    if (state.hiddenKinds.has(kind)) {
      state.hiddenKinds.delete(kind);
      lg.classList.remove('off');
      lg.setAttribute('aria-pressed', 'true');
    } else {
      state.hiddenKinds.add(kind);
      lg.classList.add('off');
      lg.setAttribute('aria-pressed', 'false');
    }
    saveUi();
    render();
  });
}

// Drag-and-drop a PDF onto the page (works on desktop and iPad in split view)
function isPdf(f) { return f && (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)); }
function onDragOver(e) {
  if (![...(e.dataTransfer?.items || [])].some(it => it.kind === 'file')) return;
  e.preventDefault();
  const dz = document.getElementById('drop-zone');
  if (dz) dz.classList.add('drag-over');
}
function onDragLeave() {
  const dz = document.getElementById('drop-zone');
  if (dz) dz.classList.remove('drag-over');
}
function onDrop(e) {
  e.preventDefault();
  const dz = document.getElementById('drop-zone');
  if (dz) dz.classList.remove('drag-over');
  const f = [...(e.dataTransfer?.files || [])].find(isPdf);
  if (f) onPdfChosen(f);
}
window.addEventListener('dragover', onDragOver);
window.addEventListener('dragleave', onDragLeave);
window.addEventListener('drop', onDrop);
els.todayBtn.addEventListener('click', () => { state.anchor = startOfDay(new Date()); render(); });
els.prevBtn.addEventListener('click', () => { state.anchor = step(-1); render(); });
els.nextBtn.addEventListener('click', () => { state.anchor = step(+1); render(); });
for (const b of els.viewBtns) {
  b.addEventListener('click', () => { state.view = b.dataset.view; render(); });
}
els.root.addEventListener('event-click', e => openModal(e.detail.event));
els.root.addEventListener('day-click', e => {
  state.view = 'day'; state.anchor = startOfDay(e.detail.date); render();
});
els.modalClose.addEventListener('click', closeModal);
els.modal.addEventListener('click', e => { if (e.target === els.modal) closeModal(); });
els.addBtn.addEventListener('click', openAddModal);
els.editBtn.addEventListener('click', openEditModal);
els.deleteBtn.addEventListener('click', deleteCurrent);
els.saveEditBtn.addEventListener('click', saveFromForm);
els.cancelEditBtn.addEventListener('click', () => {
  if (editingEvent) {
    // Going back to view of the original event
    setEditMode(false);
    return;
  }
  els.modal.hidden = true;
  setEditMode(false);
});
els.exportBtn.addEventListener('click', () => {
  if (!currentEvent) return;
  const note = els.modalNotes.value.trim();
  const ics = eventToIcs(currentEvent, note);
  const safe = currentEvent.title.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  downloadIcs(`duty-${safe}.ics`, ics);
});

els.exportAllBtn.addEventListener('click', () => {
  if (!state.events.length) {
    toast('Load a duty-plan PDF first.');
    return;
  }
  const { start, end, label } = currentRange();
  const events = state.events.filter(ev => ev.start >= start && ev.start < end);
  if (!events.length) {
    toast(`No events in this ${state.view}.`);
    return;
  }
  const ics = eventsToIcs(events, state.notes);
  downloadIcs(`duty-${label}.ics`, ics);
  toast(`Exported ${events.length} event${events.length === 1 ? '' : 's'}.`);
});

function currentRange() {
  if (state.view === 'month') {
    const start = new Date(state.anchor.getFullYear(), state.anchor.getMonth(), 1);
    const end   = new Date(state.anchor.getFullYear(), state.anchor.getMonth()+1, 1);
    return { start, end, label: `${start.getFullYear()}-${pad2(start.getMonth()+1)}` };
  }
  if (state.view === 'week') {
    const start = startOfWeek(state.anchor);
    const end   = addDays(start, 7);
    return { start, end, label: `week-${ymdLabel(start)}` };
  }
  const start = startOfDay(state.anchor);
  const end   = addDays(start, 1);
  return { start, end, label: ymdLabel(start) };
}
function pad2(n) { return String(n).padStart(2,'0'); }
function ymdLabel(d) { return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`; }

// --- Toast & busy ---
function toast(msg, ms = 2400) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), ms);
}
function showBusy(on) {
  const el = document.getElementById('busy');
  if (el) el.hidden = !on;
}

// --- Keyboard shortcuts ---
document.addEventListener('keydown', e => {
  const tag = e.target && e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  switch (e.key) {
    case 'ArrowLeft':  els.prevBtn.click(); break;
    case 'ArrowRight': els.nextBtn.click(); break;
    case 't': case 'T': els.todayBtn.click(); break;
    case 'd': case 'D': document.querySelector('.view-btn[data-view="day"]').click(); break;
    case 'w': case 'W': document.querySelector('.view-btn[data-view="week"]').click(); break;
    case 'm': case 'M': document.querySelector('.view-btn[data-view="month"]').click(); break;
    case 'Escape': if (!els.modal.hidden) closeModal(); break;
    default: return;
  }
  e.preventDefault();
});

function step(dir) {
  if (state.view === 'day')   return addDays(state.anchor, dir);
  if (state.view === 'week')  return addDays(state.anchor, dir * 7);
  return new Date(state.anchor.getFullYear(), state.anchor.getMonth() + dir, 1);
}

// --- Boot ---
const saved = loadEvents();
if (saved) {
  state.events = saved.events;
  state.period = saved.period;
  if (state.period && state.period.startDate) state.anchor = startOfDay(state.period.startDate);
}
loadUi(); // Restores last view + anchor, overriding the period-based default above
render();

// Service worker (best-effort)
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// --- PWA resume hardening (ported from flight-card Phases 10–12) ---------
// iOS suspends installed PWAs aggressively; on resume it sometimes keeps
// the DOM but detaches boot-time event listeners, leaving a page that
// looks alive but ignores taps. Four independent recovery paths:
//   1. bfcache restore  → reload (stale listeners guaranteed)
//   2. >5 min hidden    → reload on return
//   3. freeze detector  → screen is being touched but no JS handler has
//      seen an event for 3+ min → reload
//   4. new SW activates → reload once (sw.js does skipWaiting+claim, so
//      this completes the update loop — deploys apply on next foreground)
(function () {
  let reloaded = false;
  function reloadOnce() {
    if (reloaded) return;
    reloaded = true;
    try { location.reload(); } catch {}
  }

  window.addEventListener('pageshow', (e) => { if (e.persisted) reloadOnce(); });

  const LONG_AWAY_MS = 5 * 60 * 1000;
  let hiddenAt = 0;
  let swReg = null;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') { hiddenAt = Date.now(); return; }
    if (swReg) { try { swReg.update(); } catch {} }
    if (hiddenAt && Date.now() - hiddenAt > LONG_AWAY_MS) reloadOnce();
    hiddenAt = 0;
  });

  let lastSeen = Date.now(), wantAt = 0;
  for (const t of ['pointerdown', 'click', 'keydown']) {
    document.addEventListener(t, () => { lastSeen = Date.now(); }, true);
  }
  document.addEventListener('touchstart', () => { wantAt = lastSeen = Date.now(); }, true);
  setInterval(() => {
    try {
      if (document.visibilityState !== 'visible') return;
      const now = Date.now();
      if (now - lastSeen > 3 * 60 * 1000 && now - wantAt < 2000) reloadOnce();
    } catch {}
  }, 30 * 1000);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('controllerchange', reloadOnce);
    navigator.serviceWorker.ready
      .then((r) => { swReg = r; try { r.update(); } catch {} })
      .catch(() => {});
  }
})();
