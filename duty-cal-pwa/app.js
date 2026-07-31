import { parseDutyPlan } from './parser.js';
import { renderInto, rangeLabel, addDays, startOfWeek, startOfDay, isAllDay } from './calendar.js';
import { eventToIcs, eventsToIcs, downloadIcs } from './ics.js';
import { KINDS, SUBTYPES, LEGEND_GROUPS, groupOf, labelOf, defaultHiddenKinds } from './kinds.js';
import { summarise, summaryTiles } from './summary.js';
import { radarTarget } from './radar.js';

// pdf.js
import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).toString();

const state = {
  view: 'month', // default — overridable from saved UI state in loadUi()
  anchor: startOfDay(new Date()),
  events: [],
  period: null,
  notes: loadNotes(),
  // Seeded from the registry; loadUi() respects any saved choice.
  hiddenKinds: defaultHiddenKinds(),
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
  editSubtype: document.getElementById('edit-subtype'),
  editSubtypeRow: document.getElementById('edit-subtype-row'),
  editAllDay: document.getElementById('edit-allday'),
  editTimesRow: document.getElementById('edit-times-row'),
  legend: document.getElementById('legend'),
  summary: document.getElementById('summary'),
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
      events: j.events.map(ev => migrateEvent({ ...ev, start: new Date(ev.start), end: new Date(ev.end) })),
      period: j.period ? { ...j.period, startDate: new Date(j.period.startDate), endDate: new Date(j.period.endDate) } : null,
    };
  } catch { return null; }
}

/**
 * Upgrade events persisted before the taxonomy refactor.
 *
 * Everything non-flying used to land in kind 'other' with the category encoded
 * only in the title, and free-text events used kind 'custom'. Re-derive the
 * real kind/subtype so old localStorage data gets the new colours, badges and
 * counters without forcing the user to re-import their PDF.
 */
let migrationChangedSomething = false;

function migrateEvent(ev) {
  const before = ev.kind;
  if (ev.kind === 'custom') ev.kind = 'note';

  if (ev.kind === 'other') {
    const t = String(ev.title || '').toLowerCase();
    if (/dummy|reserve|standby/.test(t))      { ev.kind = 'standby';  ev.subtype = 'home';      ev.code = 'SBY'; }
    else if (/vacation|annual|leave/.test(t)) { ev.kind = 'vacation'; ev.code = 'VAC'; }
    else if (/day off/.test(t))               { ev.kind = 'dayOff';   ev.code = 'GDO'; }
    else if (/training|tzi|sim|course/.test(t)) {
      ev.kind = 'ground';
      ev.subtype = /sim/.test(t) ? 'sim' : 'recurrent';
      ev.code = 'GND';
    } else if (/^duty/.test(t))               { ev.kind = 'ground';   ev.subtype = 'office';    ev.code = 'GND'; }
  }

  // Backfill schema fields added by the refactor.
  ev.subtype = ev.subtype ?? null;
  ev.code    = ev.code    ?? (KINDS[ev.kind]?.code ?? null);
  ev.rawCode = ev.rawCode ?? null;
  ev.sectors = ev.sectors ?? 0;
  ev.blockMinutes = ev.blockMinutes ?? null;
  ev.dutyMinutes  = ev.dutyMinutes  ?? null;
  ev.dutyId  = ev.dutyId  ?? null;
  ev.origin  = ev.origin  ?? 'pdf';
  if (ev.allDay == null) ev.allDay = isAllDay(ev);
  if (ev.kind !== before) migrationChangedSomething = true;
  return ev;
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

// Map an event's internal kind to its legend group ('custom' is the
// pre-refactor id for 'note').
function legendGroupOf(kind) {
  return kind === 'custom' ? 'note' : groupOf(kind);
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
  renderSummary();
  saveUi();
}

// --- Month summary (FTL / duty counters) ---------------------------------
// Computed from ALL events in range, not the legend-filtered set: hiding a
// category is a display preference and must not silently change the totals.
function renderSummary() {
  if (!els.summary) return;
  if (state.view !== 'month' || state.events.length === 0) {
    els.summary.hidden = true;
    els.summary.innerHTML = '';
    return;
  }
  const start = new Date(state.anchor.getFullYear(), state.anchor.getMonth(), 1);
  const end   = new Date(state.anchor.getFullYear(), state.anchor.getMonth() + 1, 1);
  const tiles = summaryTiles(summarise(state.events, start, end));

  els.summary.innerHTML = '';
  for (const t of tiles) {
    const tile = document.createElement('div');
    tile.className = `sm-tile sm-${t.accent}`;
    const val = document.createElement('div');
    val.className = 'sm-value';
    val.textContent = t.value;
    if (t.unit) {
      const u = document.createElement('span');
      u.className = 'sm-unit';
      u.textContent = t.unit;
      val.appendChild(u);
    }
    const lab = document.createElement('div');
    lab.className = 'sm-label';
    lab.textContent = t.label;
    tile.append(val, lab);
    els.summary.appendChild(tile);
  }
  els.summary.hidden = false;
}

// --- Modal ---
function openModal(ev) {
  currentEvent = ev;
  setEditMode(false);
  els.modalTitle.textContent = ev.title;
  els.modalWhen.textContent = formatWhen(ev);

  const rows = [];
  rows.push(['Category', labelOf(ev)]);
  if (ev.kind === 'flight') {
    const d = ev.details;
    if (d.flights) rows.push(['Flights', d.flights]);
    if (d.route)   rows.push(['Route', d.route]);
    if (d.legs)    rows.push(['Legs', d.legs]);
    if (d.flightTime) rows.push(['Block time', d.flightTime]);
    if (ev.sectors)   rows.push(['Sectors', ev.sectors]);
  } else if (ev.kind === 'pickup') {
    rows.push(['Pickup at', ev.details.airport || 'TLV']);
    rows.push(['Note', 'Be ready at end time.']);
  } else if (ev.kind === 'driveHome') {
    rows.push(['From', 'TLV']);
    rows.push(['Window', '+1 hour after landing']);
  } else if (ev.kind === 'restEnd') {
    rows.push(['Rest period', ev.details.restPeriod || '']);
    rows.push(['Meaning', 'Earliest possible next duty start.']);
  } else if (ev.kind === 'standby') {
    if (ev.report)  rows.push(['Report', ev.report]);
    if (ev.release) rows.push(['Release', ev.release]);
    if (!ev.report) rows.push(['Window', 'Full day — no fixed reporting time.']);
    if (ev.details.station) rows.push(['Station', ev.details.station]);
  } else if (ev.kind === 'ground') {
    if (ev.details.station) rows.push(['Location', ev.details.station]);
    if (ev.dutyMinutes) rows.push(['Duty length', fmtMins(ev.dutyMinutes)]);
  }
  if (ev.rawCode) rows.push(['Roster code', ev.rawCode]);
  // Anything the parser stashed that we did not render explicitly.
  for (const [k, v] of Object.entries(ev.details || {})) {
    if (['flights','route','legs','flightTime','airport','restPeriod','note','station','roster','from'].includes(k)) continue;
    rows.push([k, v]);
  }
  els.modalBody.innerHTML = rows.map(([k,v]) => `<div class="row"><span class="lbl">${k}</span><span>${escapeHtml(String(v))}</span></div>`).join('');

  renderRadarLink(ev);

  els.modalNotes.value = state.notes[ev.id] || '';
  els.modal.hidden = false;
}

// Offer live tracking only while the aeroplane could actually be transmitting.
// Outside that window the same flight number belongs to a different day's
// aircraft, so a link would point at the wrong one.
function renderRadarLink(ev) {
  const box = document.getElementById('modal-radar');
  if (!box) return;
  const target = radarTarget(ev);
  if (!target) { box.hidden = true; box.innerHTML = ''; return; }

  box.innerHTML = '';
  const a = document.createElement('a');
  a.className = 'btn radar-btn';
  a.href = target.href;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.textContent = `📡 ${target.label}`;
  const note = document.createElement('span');
  note.className = 'radar-note';
  note.textContent = target.note;
  box.append(a, note);
  box.hidden = false;
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
  const kind = ev ? (ev.kind === 'custom' ? 'note' : ev.kind) : 'flight';
  els.editKind.value = kind;
  syncSubtypeField(kind, ev ? ev.subtype : null);
  syncAllDayField(ev ? isAllDay(ev) : KINDS[kind]?.defaultAllDay);
  els.editTitle.value = ev ? ev.title : '';
  els.editDate.value  = ymdLabel(anchor);
  els.editStart.value = ev && !isAllDay(ev) ? hhmm(ev.start) : '08:00';
  els.editEnd.value   = ev && !isAllDay(ev) ? hhmm(ev.end)   : '10:00';
  els.editNotes.value = ev ? (state.notes[ev.id] || '') : '';
}

function hhmm(d) { return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; }

function saveFromForm() {
  const kind = els.editKind.value;
  const title = els.editTitle.value.trim();
  const dateStr = els.editDate.value;
  const allDay = els.editAllDay.checked;
  const startStr = els.editStart.value;
  const endStr = els.editEnd.value;
  const noteStr = els.editNotes.value.trim();
  const subtype = SUBTYPES[kind] ? els.editSubtype.value || null : null;

  if (!title || !dateStr || (!allDay && (!startStr || !endStr))) {
    toast(allDay ? 'Title and date are required.' : 'Title, date, start and end are required.');
    return;
  }

  let start, end;
  if (allDay) {
    start = new Date(`${dateStr}T00:00`);
    end   = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  } else {
    start = new Date(`${dateStr}T${startStr}`);
    end   = new Date(`${dateStr}T${endStr}`);
    if (end <= start) end = new Date(end.getTime() + 24 * 60 * 60 * 1000); // wrap past midnight
  }
  const sub = allDay ? '' : `${hhmm(start)} → ${hhmm(end)}`;
  const dutyMinutes = KINDS[kind]?.countsAsDuty && !allDay
    ? Math.round((end - start) / 60000) : null;

  if (editingEvent) {
    // Edit in place — keep id, flip origin to manual so PDF re-uploads don't overwrite
    Object.assign(editingEvent, {
      kind, subtype, title,
      start, end, allDay,
      dayKey: ymdLabel(start),
      sub,
      code: KINDS[kind]?.code ?? null,
      dutyMinutes,
      origin: 'manual',
    });
    if (noteStr) state.notes[editingEvent.id] = noteStr;
    else delete state.notes[editingEvent.id];
  } else {
    const id = 'manual-' + Math.random().toString(36).slice(2, 12);
    state.events.push({
      id, kind, subtype, title,
      start, end, allDay,
      dayKey: ymdLabel(start),
      sub,
      code: KINDS[kind]?.code ?? null,
      rawCode: null,
      sectors: 0,
      blockMinutes: null,
      dutyMinutes,
      dutyId: null,
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
  const day = d => `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
  const f = d => `${day(d)} ${p(d.getHours())}:${p(d.getMinutes())}`;
  if (isAllDay(ev)) {
    // Inclusive last day — the stored end is exclusive midnight.
    const lastDay = new Date(ev.end.getTime() - 1);
    return day(ev.start) === day(lastDay)
      ? `${day(ev.start)} · All day`
      : `${day(ev.start)} → ${day(lastDay)} · All day`;
  }
  return `${f(ev.start)} → ${f(ev.end)}`;
}
function escapeHtml(s) { return s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// --- Wire-up ---
els.fileInput.addEventListener('change', e => {
  const f = e.target.files && e.target.files[0];
  if (f) onPdfChosen(f);
  e.target.value = '';
});

// Legend filters, generated from the registry. Click toggles visibility of
// that category; the hidden set is persisted across reloads.
function buildLegend() {
  els.legend.innerHTML = '';
  for (const g of LEGEND_GROUPS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `lg ${g.kind}`;
    btn.dataset.kind = g.kind;
    btn.textContent = g.label;
    btn.title = 'Tap to hide / show';
    const off = state.hiddenKinds.has(g.kind);
    btn.classList.toggle('off', off);
    btn.setAttribute('aria-pressed', off ? 'false' : 'true');
    btn.addEventListener('click', () => {
      const nowHidden = !state.hiddenKinds.has(g.kind);
      if (nowHidden) state.hiddenKinds.add(g.kind);
      else state.hiddenKinds.delete(g.kind);
      btn.classList.toggle('off', nowHidden);
      btn.setAttribute('aria-pressed', nowHidden ? 'false' : 'true');
      saveUi();
      render();
    });
    els.legend.appendChild(btn);
  }
}

// Type <select>, generated from the registry so a new kind needs no HTML edit.
function buildKindSelect() {
  els.editKind.innerHTML = '';
  for (const [id, meta] of Object.entries(KINDS)) {
    if (id === 'other') continue; // reachable via migration, not worth offering
    const o = document.createElement('option');
    o.value = id;
    o.textContent = meta.label;
    els.editKind.appendChild(o);
  }
}

// Subtype <select> depends on the chosen kind; the row hides when the kind
// has no subtypes.
function syncSubtypeField(kind, selected) {
  const map = SUBTYPES[kind];
  if (!map) {
    els.editSubtypeRow.hidden = true;
    els.editSubtype.innerHTML = '';
    return;
  }
  els.editSubtype.innerHTML = '';
  for (const [id, meta] of Object.entries(map)) {
    const o = document.createElement('option');
    o.value = id;
    o.textContent = meta.label;
    els.editSubtype.appendChild(o);
  }
  if (selected && map[selected]) els.editSubtype.value = selected;
  els.editSubtypeRow.hidden = false;
}

function syncAllDayField(on) {
  els.editAllDay.checked = !!on;
  els.editTimesRow.hidden = !!on;
}

els.editKind.addEventListener('change', () => {
  const kind = els.editKind.value;
  syncSubtypeField(kind, null);
  // Vacation / days off / standby are all-day by default; flights never are.
  if (!editingEvent) syncAllDayField(KINDS[kind]?.defaultAllDay);
});
els.editAllDay.addEventListener('change', () => syncAllDayField(els.editAllDay.checked));

buildLegend();
buildKindSelect();

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
function fmtMins(m) { return `${Math.floor(m/60)}h ${pad2(m%60)}m`; }
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
// Persist the upgraded taxonomy once, so other readers of 'duty-cal:events'
// (notably swap.js) see canonical kinds instead of the pre-refactor shape.
if (migrationChangedSomething) saveEvents();
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
