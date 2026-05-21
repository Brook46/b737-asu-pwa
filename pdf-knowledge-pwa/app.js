// B737 Pilot Companion — bootstrap, state, and event wiring.

import * as storage from './modules/storage.js';
import { extractPdf, makeFileId } from './modules/pdf-ingest.js';
import * as searchMod from './modules/search.js';
import { extractiveSummary } from './modules/summarize.js?v=8';
import { mountPdf, clearViewerCache, findQueryHighlight, setMarkupTool, setMarkupColor, setMarkupWidth, setSelectMode } from './modules/viewer.js?v=15';
import { initTheme, toggleTheme, fmtBytes, fmtDate, escapeHtml } from './modules/ui.js?v=2';
import { MANUAL_TYPES, guessManualType, manualLabel, anchorTypeFor } from './modules/manuals.js';
import { extractAnchors } from './modules/anchor-extract.js';
import * as kg from './modules/knowledge-graph.js';
import { renderAnchorAdmin } from './modules/anchor-admin.js';
import { PHASES, TOGGLES, sectionsFor, phaseById } from './modules/phases.js';
import * as gps from './modules/gps.js';
import * as notes from './modules/annotations.js';
import { initScratchpad } from './modules/scratchpad.js';
import { scanLep, relinkNotes, detectChangeBars } from './modules/revision.js';

const $ = (id) => document.getElementById(id);
const els = {
  tailSelect: $('tail-select'), gpsReadout: $('gps-readout'),
  gpsToggle: $('gps-toggle'), scratchToggle: $('scratch-toggle'), themeToggle: $('theme-toggle'),
  phasePath: $('phase-path'), contextToggles: $('context-toggles'),
  briefingTitle: $('briefing-title'), briefingList: $('briefing-list'), briefingAddBm: $('briefing-add-bm'),
  searchForm: $('search-form'), searchInput: $('search-input'),
  jumpResults: $('jump-results'), answerPanel: $('answer-panel'),
  notesList: $('notes-list'), filesList: $('files-list'),
  tailForm: $('tail-form'), tailReg: $('tail-reg'), tailLabel: $('tail-label'), tailList: $('tail-list'),
  fileInput: $('file-input'), personalInput: $('personal-input'), ingestStatus: $('ingest-status'),
  libraryList: $('library-list'), storageInfo: $('storage-info'),
  viewerOverlay: $('viewer-overlay'), viewerTabs: $('viewer-tabs'), viewerTitle: $('viewer-title'),
  sidebarToggle: $('sidebar-toggle'), splitToggle: $('split-toggle'), selectToggle: $('select-toggle'),
  viewerNote: $('viewer-note'), viewerClose: $('viewer-close'),
  mkToggle: $('mk-toggle'), markupBar: $('markup-bar'), mkUndo: $('mk-undo'), mkClear: $('mk-clear'),
  viewerSidebar: $('viewer-sidebar'), vsChapters: $('vs-chapters'), vsBookmarks: $('vs-bookmarks'), vsAddBm: $('vs-add-bm'),
  pdfPanes: $('pdf-panes'), viewerNotes: $('viewer-notes'),
  adminOverlay: $('admin-overlay'), adminClose: $('admin-close'), adminBody: $('admin-body'),
  importOverlay: $('import-overlay'), importBody: $('import-body'),
  bookmarkOverlay: $('bookmark-overlay'), bookmarkBody: $('bookmark-body'), bookmarkClose: $('bookmark-close'),
  noteOverlay: $('note-overlay'), noteTitle: $('note-title'), noteClose: $('note-close'), noteBody: $('note-body'),
  scratchpad: $('scratchpad'), scratchHead: $('scratch-head'), scratchClose: $('scratch-close'),
  scratchText: $('scratch-text'),
  tabDock: $('tab-dock'), toast: $('toast'),
};

const state = {
  files: new Map(),
  manuals: new Map(),
  tails: [],
  activeTail: null,
  noteCounts: new Map(),       // anchorId -> count
  fileNoteCounts: new Map(),   // fileId -> count
  view: 'phase',
  phase: 'dispatch',
  toggle: 'normal',
  gpsAuto: false,
  manualPhaseUntil: 0,
  viewer: { tabs: [], panes: [], focused: 0, split: false },
  markup: { on: false, tool: 'pen', color: '#ff3b30', width: 0.006 },
  selectMode: false,
};

let tabSeq = 0;
const newTabId = () => 't_' + Date.now().toString(36) + '_' + (++tabSeq);

// --- Bootstrap ---------------------------------------------------------------

initTheme();
bootstrap().catch((err) => { console.error(err); toast('Failed to load: ' + err.message); });

async function bootstrap() {
  registerSW();
  const [files, manuals, tails, activeTail, savedViewer] = await Promise.all([
    storage.listFiles(), storage.listManuals(), storage.listTails(),
    storage.getKV('activeTail'), storage.getKV('viewerState'),
  ]);
  for (const f of files) state.files.set(f.id, f);
  for (const m of manuals) state.manuals.set(m.fileId, m);
  state.tails = tails;
  state.activeTail = activeTail || null;

  await searchMod.rebuildIndex(state.files);
  await kg.load(true);
  await refreshNoteCounts();

  buildPhasePath();
  buildContextToggles();
  renderTailSelect();
  renderTails();
  renderLibrary();
  renderStorageInfo();
  await renderBriefing();
  restoreViewerState(savedViewer);
  renderTabDock();

  wireEvents();
  initScratchpad(els.scratchpad, {
    handle: els.scratchHead, textarea: els.scratchText,
    closeBtn: els.scratchClose, toggleBtn: els.scratchToggle,
  });
  gps.onUpdate(onGpsUpdate);
}

function registerSW() {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('SW register failed', err));
  }
}

function restoreViewerState(saved) {
  if (!saved || !Array.isArray(saved.tabs)) return;
  for (const st of saved.tabs) {
    const file = state.files.get(st.fileId);
    if (!file) continue;
    state.viewer.tabs.push({
      id: st.id || newTabId(), fileId: st.fileId, fileName: file.name,
      pageNum: st.pageNum || 1, query: st.query || '', anchor: st.anchor || null,
      manualType: st.manualType || '',
    });
  }
  if (!state.viewer.tabs.length) return;
  state.viewer.split = !!saved.split;
  const validPanes = (saved.panes || []).filter((p) => state.viewer.tabs.some((t) => t.id === p.tabId));
  state.viewer.panes = validPanes.length ? validPanes.map((p) => ({ tabId: p.tabId })) : [{ tabId: state.viewer.tabs[0].id }];
  state.viewer.focused = Math.min(saved.focused || 0, state.viewer.panes.length - 1);
}

async function refreshNoteCounts() {
  const all = await storage.getAllAnnotations();
  const byAnchor = new Map();
  const byFile = new Map();
  for (const n of all) {
    byAnchor.set(n.anchorId, (byAnchor.get(n.anchorId) || 0) + 1);
    byFile.set(n.fileId, (byFile.get(n.fileId) || 0) + 1);
  }
  state.noteCounts = byAnchor;
  state.fileNoteCounts = byFile;
}

// --- Event wiring ------------------------------------------------------------

function wireEvents() {
  document.querySelectorAll('.view-tab').forEach((tab) => {
    tab.addEventListener('click', () => switchView(tab.getAttribute('data-view')));
  });
  els.themeToggle.addEventListener('click', () => toggleTheme());
  els.gpsToggle.addEventListener('click', toggleGps);
  els.tailSelect.addEventListener('change', () => setActiveTail(els.tailSelect.value || null));

  els.tailForm.addEventListener('submit', onAddTail);
  els.fileInput.addEventListener('change', (e) => {
    const files = [...e.target.files]; e.target.value = '';
    if (files.length) handleFiles(files);
  });
  els.personalInput.addEventListener('change', (e) => {
    const files = [...e.target.files]; e.target.value = '';
    if (files.length) handlePersonalFiles(files);
  });
  els.briefingAddBm.addEventListener('click', () => openBookmarkModal({}));

  els.searchForm.addEventListener('submit', (e) => { e.preventDefault(); runJumpSearch(els.searchInput.value.trim()); });

  els.viewerClose.addEventListener('click', minimizeViewer);
  els.viewerNote.addEventListener('click', openNotesForActiveTab);
  els.splitToggle.addEventListener('click', toggleSplit);
  els.selectToggle.addEventListener('click', toggleSelectMode);
  els.sidebarToggle.addEventListener('click', toggleSidebar);
  els.vsAddBm.addEventListener('click', () => {
    const tab = paneTab(state.viewer.focused);
    openBookmarkModal(tab ? { fileId: tab.fileId, pageNum: tab.pageNum } : {});
  });

  els.mkToggle.addEventListener('click', () => setMarkupOn(!state.markup.on));
  els.markupBar.querySelectorAll('.mk-tool').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.markup.tool = btn.getAttribute('data-tool');
      pressGroup(els.markupBar.querySelectorAll('.mk-tool'), btn);
      applyMarkup();
    });
  });
  els.markupBar.querySelectorAll('.mk-color').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.markup.color = btn.getAttribute('data-color');
      pressGroup(els.markupBar.querySelectorAll('.mk-color'), btn);
      applyMarkup();
    });
  });
  els.markupBar.querySelectorAll('.mk-width').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.markup.width = parseFloat(btn.getAttribute('data-width'));
      pressGroup(els.markupBar.querySelectorAll('.mk-width'), btn);
      applyMarkup();
    });
  });
  els.mkUndo.addEventListener('click', () => { const a = focusedApi(); if (a) a.undo(); });
  els.mkClear.addEventListener('click', () => { const a = focusedApi(); if (a) a.clearPage(); });

  els.adminClose.addEventListener('click', () => els.adminOverlay.classList.add('hidden'));
  els.noteClose.addEventListener('click', () => els.noteOverlay.classList.add('hidden'));
  els.bookmarkClose.addEventListener('click', () => els.bookmarkOverlay.classList.add('hidden'));
  [els.adminOverlay, els.noteOverlay, els.bookmarkOverlay].forEach((ov) => {
    ov.addEventListener('click', (e) => { if (e.target === ov) ov.classList.add('hidden'); });
  });
  window.addEventListener('resize', debounce(remountViewer, 250));
}

function pressGroup(nodes, active) {
  nodes.forEach((n) => n.setAttribute('aria-pressed', n === active ? 'true' : 'false'));
}

function switchView(view) {
  state.view = view;
  document.querySelectorAll('.view-tab').forEach((t) =>
    t.setAttribute('aria-selected', t.getAttribute('data-view') === view ? 'true' : 'false'));
  $('view-phase').classList.toggle('hidden', view !== 'phase');
  $('view-bookmarks').classList.toggle('hidden', view !== 'bookmarks');
  $('view-notes').classList.toggle('hidden', view !== 'notes');
  $('view-files').classList.toggle('hidden', view !== 'files');
  $('view-library').classList.toggle('hidden', view !== 'library');
  if (view === 'notes') renderNotesView();
  if (view === 'files') renderFilesView();
}

// --- Phase dashboard ---------------------------------------------------------

function buildPhasePath() {
  els.phasePath.innerHTML = PHASES.map((p) => `
    <button class="phase-node" role="tab" data-phase="${p.id}">
      <span class="pn-rail"><span class="pn-dot"></span></span>
      <span class="pn-body">
        <span class="pn-label">${escapeHtml(p.label)}</span>
        <span class="pn-gps hidden" data-gps="${p.id}">GPS</span>
      </span>
    </button>`).join('');
  els.phasePath.querySelectorAll('.phase-node').forEach((node) => {
    node.addEventListener('click', () => {
      state.manualPhaseUntil = Date.now() + 60000;
      setPhase(node.getAttribute('data-phase'));
    });
  });
  syncPhaseUI();
}

function buildContextToggles() {
  els.contextToggles.innerHTML = TOGGLES.map((t) => `
    <button class="ctx-toggle" data-toggle="${t.id}" aria-selected="${t.id === state.toggle}">
      <span class="ctx-label">${escapeHtml(t.label)}</span>
      <span class="ctx-src">${escapeHtml(t.source)}</span>
    </button>`).join('');
  els.contextToggles.querySelectorAll('.ctx-toggle').forEach((btn) => {
    btn.addEventListener('click', () => { state.toggle = btn.getAttribute('data-toggle'); syncToggleUI(); renderBriefing(); });
  });
}

function setPhase(phaseId) {
  state.phase = phaseId;
  syncPhaseUI();
  renderBriefing();
}

function syncPhaseUI() {
  const activeIdx = PHASES.findIndex((p) => p.id === state.phase);
  els.phasePath.querySelectorAll('.phase-node').forEach((node, i) => {
    node.setAttribute('aria-selected', node.getAttribute('data-phase') === state.phase ? 'true' : 'false');
    node.classList.toggle('passed', i <= activeIdx);
  });
}

function syncToggleUI() {
  els.contextToggles.querySelectorAll('.ctx-toggle').forEach((b) =>
    b.setAttribute('aria-selected', b.getAttribute('data-toggle') === state.toggle ? 'true' : 'false'));
}

function activeFileIds() {
  if (!state.activeTail) return null;
  const ids = new Set();
  for (const fileId of state.files.keys()) {
    const m = state.manuals.get(fileId);
    if (!m || !m.effectivity || !m.effectivity.length || m.effectivity.includes(state.activeTail)) {
      ids.add(fileId);
    }
  }
  return ids;
}

async function renderBriefing() {
  const phase = phaseById(state.phase);
  const toggle = TOGGLES.find((t) => t.id === state.toggle);
  els.briefingTitle.textContent = `${phase.label} — ${toggle.label}`;
  const fileIds = activeFileIds();

  // Briefing toggle: one flat list of all supplementary content for the phase.
  if (state.toggle === 'briefing') {
    const seen = new Set();
    const flat = [];
    for (const sec of sectionsFor(state.phase, 'briefing')) {
      for (const a of await kg.findAnchors(sec.manualType, sec.hint, { fileIds })) {
        if (!seen.has(a.anchorId)) { seen.add(a.anchorId); flat.push(a); }
      }
    }
    flat.sort((a, b) => (a.manualType || '').localeCompare(b.manualType || '') || a.pageNum - b.pageNum);
    els.briefingList.innerHTML = flat.length
      ? flat.map(anchorRowHtml).join('')
      : '<li class="briefing-empty">No briefing material found yet — tap “+ Add bookmark” to add your own.</li>';
    bindAnchorRows(els.briefingList, flat);
    return;
  }

  const sections = sectionsFor(state.phase, state.toggle);
  const resolved = [];
  for (const sec of sections) {
    let anchors;
    if (sec.manualType === 'MEL' && !sec.hint) {
      anchors = await kg.anchorsByManualType('MEL', { fileIds });
    } else {
      anchors = await kg.findAnchors(sec.manualType, sec.hint, { fileIds });
    }
    resolved.push({ sec, anchors: anchors.slice(0, 25) });
  }

  const anyAnchors = resolved.some((r) => r.anchors.length);
  const openAllBtn = anyAnchors
    ? '<button class="btn primary" id="open-all-btn">Open all sections in viewer</button>' : '';

  els.briefingList.innerHTML = openAllBtn + resolved.map((r, i) => {
    const a = r.anchors;
    return `
      <li class="briefing-section" data-idx="${i}" aria-expanded="false">
        <div class="briefing-section-head">
          <span class="bs-caret">›</span>
          <span class="bs-name">${escapeHtml(r.sec.label)}</span>
          <span class="bs-meta">${a.length ? a.length + ' bookmark(s)' : 'no bookmarks found'}</span>
        </div>
        <ul class="briefing-anchors hidden">
          ${a.length ? a.map(anchorRowHtml).join('') : '<li class="briefing-empty">No matching content — use “+ Add bookmark”.</li>'}
        </ul>
      </li>`;
  }).join('') || '<li class="briefing-empty">No sections for this phase.</li>';

  els.briefingList.querySelectorAll('.briefing-section').forEach((li) => {
    const idx = +li.getAttribute('data-idx');
    li.querySelector('.briefing-section-head').addEventListener('click', () => {
      const open = li.getAttribute('aria-expanded') === 'true';
      li.setAttribute('aria-expanded', open ? 'false' : 'true');
      li.querySelector('.briefing-anchors').classList.toggle('hidden', open);
    });
    bindAnchorRows(li, resolved[idx].anchors);
  });
  const openAll = $('open-all-btn');
  if (openAll) openAll.addEventListener('click', () => prepPhaseTabs(resolved));
}

function anchorRowHtml(a) {
  const count = state.noteCounts.get(a.anchorId) || 0;
  return `
    <li class="anchor-row" data-anchor="${escapeHtml(a.anchorId)}">
      <div class="ar-main">
        <span class="ar-id">${escapeHtml(a.value)}</span>
        <span class="ar-title">${escapeHtml(a.title || manualLabel(a.manualType))}</span>
        ${count ? `<span class="ar-note-count">${count}✎</span>` : ''}
        <button class="btn ghost ar-note" data-act="note" title="Notes">✎</button>
      </div>
      ${a.excerpt ? `<div class="ar-excerpt">${escapeHtml(a.excerpt)}</div>` : ''}
    </li>`;
}

function bindAnchorRows(root, anchors) {
  root.querySelectorAll('.anchor-row').forEach((row) => {
    const anchor = anchors.find((x) => x.anchorId === row.getAttribute('data-anchor'));
    if (!anchor) return;
    row.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="note"]')) { openNotes(anchor); return; }
      openAnchorInViewer(anchor);
    });
  });
}

async function prepPhaseTabs(resolved) {
  const newTabs = [];
  const seen = new Set();
  for (const r of resolved) {
    const a = r.anchors[0];
    if (!a || seen.has(a.fileId)) continue;
    seen.add(a.fileId);
    newTabs.push(makeTab(a));
  }
  if (!newTabs.length) { toast('No content bookmarked for this phase yet.'); return; }
  state.viewer.tabs = newTabs;
  state.viewer.panes = [{ tabId: newTabs[0].id }];
  state.viewer.focused = 0;
  persistViewer();
  await openViewer();
}

// --- Tails / aircraft --------------------------------------------------------

function renderTailSelect() {
  els.tailSelect.innerHTML = '<option value="">All aircraft</option>' +
    state.tails.map((t) => `<option value="${escapeHtml(t.reg)}">${escapeHtml(t.reg)}${t.label ? ' — ' + escapeHtml(t.label) : ''}</option>`).join('');
  els.tailSelect.value = state.activeTail || '';
}

function renderTails() {
  els.tailList.innerHTML = state.tails.length
    ? state.tails.map((t) => `
      <li data-reg="${escapeHtml(t.reg)}" aria-current="${t.reg === state.activeTail}">
        <span class="reg">${escapeHtml(t.reg)}</span>
        <span class="meta">${escapeHtml(t.label || '')}</span>
        <button class="btn ghost danger" data-act="del">✕</button>
      </li>`).join('')
    : '<li class="empty">No aircraft yet — add a registration to filter by effectivity.</li>';
  els.tailList.querySelectorAll('li[data-reg]').forEach((li) => {
    li.querySelector('[data-act="del"]').addEventListener('click', async () => {
      const reg = li.getAttribute('data-reg');
      await storage.deleteTail(reg);
      state.tails = state.tails.filter((t) => t.reg !== reg);
      if (state.activeTail === reg) setActiveTail(null);
      renderTails(); renderTailSelect();
    });
  });
}

async function onAddTail(e) {
  e.preventDefault();
  const reg = els.tailReg.value.trim().toUpperCase();
  if (!reg) return;
  const tail = { reg, label: els.tailLabel.value.trim() };
  await storage.putTail(tail);
  if (!state.tails.some((t) => t.reg === reg)) state.tails.push(tail);
  els.tailReg.value = ''; els.tailLabel.value = '';
  renderTails(); renderTailSelect();
}

async function setActiveTail(reg) {
  state.activeTail = reg;
  await storage.setKV('activeTail', reg);
  els.tailSelect.value = reg || '';
  renderTails();
  renderLibrary();
  renderBriefing();
}

// --- Library + Files + import ------------------------------------------------

function renderLibrary() {
  const files = [...state.files.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  if (!files.length) {
    els.libraryList.innerHTML = '<li class="empty">No documents yet — tap "Add Manuals" or "+ Personal PDF".</li>';
    return;
  }
  const fileIds = activeFileIds();
  els.libraryList.innerHTML = files.map((f) => {
    const m = state.manuals.get(f.id);
    const inEffect = !fileIds || fileIds.has(f.id);
    const nc = state.fileNoteCounts.get(f.id) || 0;
    const lepBadge = m && m.lep && m.lep.length ? `<span class="badge">LEP ${m.lep.length}*</span>` : '';
    const cbBadge = m && m.changeBarPages && m.changeBarPages.length ? `<span class="badge">CB ${m.changeBarPages.length}</span>` : '';
    const noteFlag = nc ? `<span class="note-flag">${nc} ✎</span>` : '';
    return `
      <li data-id="${escapeHtml(f.id)}" style="${inEffect ? '' : 'opacity:.45'}">
        <span class="badge">${escapeHtml(m ? m.manualType : '?')}</span>
        <span class="name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
        ${lepBadge}${cbBadge}${noteFlag}
        <span class="meta">${escapeHtml(fmtBytes(f.sizeBytes))} · ${f.numPages || '?'}p</span>
        <span class="row-actions">
          <button class="btn ghost" data-act="open">Open</button>
          <button class="btn ghost" data-act="anchors">Bookmarks</button>
          <button class="btn ghost" data-act="revise">Revise</button>
          <button class="btn ghost danger" data-act="del">✕</button>
        </span>
      </li>`;
  }).join('');
  els.libraryList.querySelectorAll('li[data-id]').forEach((li) => {
    const id = li.getAttribute('data-id');
    li.querySelector('[data-act="open"]').addEventListener('click', () => openFileInViewer(id, 1));
    li.querySelector('[data-act="anchors"]').addEventListener('click', () => openAnchorAdmin(id));
    li.querySelector('[data-act="revise"]').addEventListener('click', () => reviseManual(id));
    li.querySelector('[data-act="del"]').addEventListener('click', () => confirmDelete(id));
  });
}

async function renderFilesView() {
  const files = [...state.files.values()].sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  if (!files.length) {
    els.filesList.innerHTML = '<li class="briefing-empty">No documents yet — add some in Library.</li>';
    return;
  }
  const anchors = await kg.allAnchors();
  els.filesList.innerHTML = files.map((f) => {
    const m = state.manuals.get(f.id);
    const bm = anchors.filter((a) => a.fileId === f.id).length;
    const nc = state.fileNoteCounts.get(f.id) || 0;
    return `
      <li class="file-card" data-id="${escapeHtml(f.id)}">
        <span class="fc-badge">${escapeHtml(m ? m.manualType : '?')}</span>
        <span class="fc-body">
          <div class="fc-name">${escapeHtml(f.name)}</div>
          <div class="fc-meta">${f.numPages || '?'} pages · ${bm} bookmark(s)${nc ? ` · ${nc} note(s)` : ''}</div>
        </span>
        ${nc ? `<span class="note-flag">${nc} ✎</span>` : ''}
        <button class="btn" data-act="open">Open</button>
      </li>`;
  }).join('');
  els.filesList.querySelectorAll('.file-card').forEach((card) => {
    card.addEventListener('click', () => openFileInViewer(card.getAttribute('data-id'), 1));
  });
}

async function renderStorageInfo() {
  const est = await storage.estimateStorage();
  els.storageInfo.textContent = est
    ? `Storage: ${fmtBytes(est.usage || 0)} used of ${fmtBytes(est.quota || 0)}` : '';
}

function setIngestStatus(text, kind = '') {
  els.ingestStatus.className = 'ingest-status' + (kind ? ' ' + kind : '');
  els.ingestStatus.textContent = text;
}

async function handleFiles(files) {
  switchView('library');
  for (const file of files) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setIngestStatus(`Skipped ${file.name}: not a PDF`, 'warn');
      continue;
    }
    const meta = await askManualMeta(file);
    if (!meta) { setIngestStatus(`Skipped ${file.name}.`, 'warn'); continue; }
    await processImport(file, meta);
  }
  await storage.requestPersistent();
  renderLibrary();
  renderStorageInfo();
  renderBriefing();
}

async function handlePersonalFiles(files) {
  switchView('library');
  for (const file of files) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setIngestStatus(`Skipped ${file.name}: not a PDF`, 'warn');
      continue;
    }
    await processImport(file, { manualType: 'PERSONAL', revision: '', effectivity: [] });
  }
  await storage.requestPersistent();
  renderLibrary();
  renderStorageInfo();
}

function askManualMeta(file, preset) {
  return new Promise((resolve) => {
    const guess = preset ? preset.manualType : guessManualType(file.name);
    els.importBody.innerHTML = `
      <div class="field"><label>File</label><div>${escapeHtml(file.name)}</div></div>
      <div class="field">
        <label for="im-type">Manual type</label>
        <select id="im-type">${MANUAL_TYPES.map((m) =>
          `<option value="${m.id}" ${m.id === guess ? 'selected' : ''}>${escapeHtml(m.label)}</option>`).join('')}</select>
      </div>
      <div class="field">
        <label for="im-rev">Revision (optional)</label>
        <input type="text" id="im-rev" placeholder="e.g. Rev 57" value="${preset ? escapeHtml(preset.revision || '') : ''}" />
      </div>
      <div class="field">
        <label>Effectivity — applies to</label>
        ${state.tails.length
          ? `<div class="tail-checks">${state.tails.map((t) =>
              `<label><input type="checkbox" value="${escapeHtml(t.reg)}"
                ${preset && preset.effectivity && preset.effectivity.includes(t.reg) ? 'checked' : ''}/> ${escapeHtml(t.reg)}</label>`).join('')}</div>
             <div class="admin-sub">Leave all unchecked = applies to every aircraft.</div>`
          : '<div class="admin-sub">No aircraft defined — this manual applies to all.</div>'}
      </div>
      <div class="modal-actions">
        <button class="btn" id="im-cancel">Skip</button>
        <button class="btn primary" id="im-ok">Import</button>
      </div>`;
    els.importOverlay.classList.remove('hidden');
    const close = (result) => { els.importOverlay.classList.add('hidden'); resolve(result); };
    $('im-cancel').addEventListener('click', () => close(null));
    $('im-ok').addEventListener('click', () => {
      close({
        manualType: $('im-type').value,
        revision: $('im-rev').value.trim(),
        effectivity: [...els.importBody.querySelectorAll('.tail-checks input:checked')].map((c) => c.value),
      });
    });
  });
}

async function processImport(file, meta) {
  setIngestStatus(`Importing ${file.name}…`);
  try {
    const id = makeFileId();
    const buf = await file.arrayBuffer();
    const { numPages, pages } = await extractPdf(buf, id);
    const record = {
      id, name: file.name, sizeBytes: file.size,
      addedAt: Date.now(), updatedAt: Date.now(), numPages,
      blob: new Blob([buf], { type: 'application/pdf' }),
    };
    await storage.putFile(record);
    await storage.putPages(pages);

    const anchors = extractAnchors(id, meta.manualType, pages);
    if (anchors.length) await storage.putAnchors(anchors);

    const manual = {
      fileId: id, manualType: meta.manualType, revision: meta.revision || '',
      effectivity: meta.effectivity || [], lep: scanLep(pages), changeBarPages: [],
    };
    await storage.putManual(manual);

    state.files.set(id, record);
    state.manuals.set(id, manual);
    await searchMod.addPagesToIndex(pages, file.name);
    kg.invalidate();
    await kg.load(true);

    const totalText = pages.reduce((n, p) => n + (p.text || '').length, 0);
    if (totalText < 50) {
      setIngestStatus(`Imported ${file.name} — but it has no searchable text (likely a scan).`, 'warn');
    } else if (meta.manualType === 'PERSONAL') {
      setIngestStatus(`Imported personal document ${file.name} (${numPages} pages).`, 'ok');
    } else {
      setIngestStatus(`Imported ${file.name}: ${anchors.length} bookmark(s) auto-extracted, ${manual.lep.length} LEP page(s).`, 'ok');
    }
    return id;
  } catch (err) {
    console.error(err);
    setIngestStatus(`Failed to import ${file.name}: ${err.message}`, 'error');
    return null;
  }
}

async function confirmDelete(id) {
  const file = state.files.get(id);
  if (!file || !confirm(`Delete "${file.name}"? Notes, bookmarks and markup for it are also removed.`)) return;
  await storage.deleteFile(id);
  searchMod.removeFileFromIndex(id);
  state.files.delete(id);
  state.manuals.delete(id);
  kg.invalidate(); await kg.load(true);
  await refreshNoteCounts();
  closeTabsForFile(id);
  renderLibrary(); renderStorageInfo(); renderBriefing();
  toast('Deleted.');
}

function reviseManual(oldId) {
  const oldManual = state.manuals.get(oldId);
  const input = document.createElement('input');
  input.type = 'file'; input.accept = 'application/pdf';
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    const meta = await askManualMeta(file, oldManual || { manualType: 'FCOM' });
    if (!meta) return;
    const newId = await processImport(file, meta);
    if (!newId) return;
    const res = await relinkNotes(oldId, newId);
    await refreshNoteCounts();
    renderLibrary(); renderBriefing();
    const unmatched = res.unmatched.length;
    toast(`Revision imported. ${res.relinked} note(s) re-linked, ${res.fuzzy} by title${unmatched ? `, ${unmatched} need review` : ''}.`);
    if (unmatched) {
      setIngestStatus(`${unmatched} note(s) could not be re-linked — old manual kept so you can review them.`, 'warn');
    }
  });
  input.click();
}

// --- Bookmark admin + add-bookmark modal -------------------------------------

async function openAnchorAdmin(fileId) {
  const file = state.files.get(fileId);
  const manual = state.manuals.get(fileId);
  els.adminOverlay.classList.remove('hidden');
  els.adminBody.innerHTML = '';
  const scanBtn = document.createElement('button');
  scanBtn.className = 'btn';
  scanBtn.textContent = 'Scan for change bars (advisory)';
  scanBtn.addEventListener('click', () => scanChangeBars(fileId, scanBtn));
  els.adminBody.appendChild(scanBtn);
  const wrap = document.createElement('div');
  els.adminBody.appendChild(wrap);
  await renderAnchorAdmin(wrap, file, manual, {
    onChanged: async () => { await kg.load(true); renderBriefing(); },
  });
}

async function scanChangeBars(fileId, btn) {
  const file = state.files.get(fileId);
  if (!file) return;
  btn.disabled = true;
  btn.textContent = 'Scanning…';
  try {
    const pages = await detectChangeBars(file.blob, {
      onProgress: (i, n) => { btn.textContent = `Scanning ${i}/${n}…`; },
    });
    const manual = state.manuals.get(fileId) || { fileId, manualType: '?', effectivity: [], lep: [] };
    manual.changeBarPages = pages;
    await storage.putManual(manual);
    state.manuals.set(fileId, manual);
    renderLibrary();
    btn.textContent = `Change bars on ${pages.length} page(s)`;
    toast(`Change-bar scan: ${pages.length} page(s) flagged (advisory).`);
  } catch (err) {
    console.error(err);
    btn.textContent = 'Scan failed';
  } finally {
    btn.disabled = false;
  }
}

// Add a bookmark to a specific file, optionally linking a chosen paragraph.
function openBookmarkModal(preset = {}) {
  const files = [...state.files.values()];
  if (!files.length) { toast('Add a document first.'); return; }
  let chosenExcerpt = '';
  els.bookmarkBody.innerHTML = `
    <div class="field">
      <label for="bm-file">Document</label>
      <select id="bm-file">${files.map((f) =>
        `<option value="${escapeHtml(f.id)}" ${f.id === preset.fileId ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}</select>
    </div>
    <div class="field"><label for="bm-page">Page</label>
      <input type="text" id="bm-page" inputmode="numeric" value="${preset.pageNum || ''}" placeholder="Page number" /></div>
    <div class="field"><label for="bm-ref">Reference / ID</label>
      <input type="text" id="bm-ref" placeholder="e.g. 13.20.3, 36-09, or a short label" /></div>
    <div class="field"><label for="bm-title">Title</label>
      <input type="text" id="bm-title" placeholder="Short description" /></div>
    <div class="field">
      <label>Paragraph (optional — tap one to link &amp; show it)</label>
      <ul class="para-list" id="bm-paras"><li class="vs-empty">Pick a document and page to load paragraphs.</li></ul>
    </div>
    <div class="modal-actions">
      <button class="btn" id="bm-cancel">Cancel</button>
      <button class="btn primary" id="bm-save">Save bookmark</button>
    </div>`;
  els.bookmarkOverlay.classList.remove('hidden');

  async function loadParas() {
    const fileId = $('bm-file').value;
    const pg = parseInt($('bm-page').value, 10);
    const list = $('bm-paras');
    chosenExcerpt = '';
    if (!fileId || !Number.isFinite(pg)) { list.innerHTML = '<li class="vs-empty">Pick a document and page to load paragraphs.</li>'; return; }
    const pages = await storage.getPagesForFile(fileId);
    const page = pages.find((p) => p.pageNum === pg);
    const paras = page && page.text
      ? page.text.split(/\n+/).map((s) => s.trim()).filter((s) => s.length > 30)
      : [];
    list.innerHTML = paras.length
      ? paras.map((p, i) => `<li class="para-item" data-i="${i}" aria-selected="false">${escapeHtml(p.slice(0, 320))}</li>`).join('')
      : '<li class="vs-empty">No paragraph text found on that page.</li>';
    list.querySelectorAll('.para-item').forEach((li) => {
      li.addEventListener('click', () => {
        list.querySelectorAll('.para-item').forEach((x) => x.setAttribute('aria-selected', 'false'));
        li.setAttribute('aria-selected', 'true');
        chosenExcerpt = paras[+li.getAttribute('data-i')];
        if (!$('bm-title').value) $('bm-title').value = chosenExcerpt.slice(0, 60);
      });
    });
  }
  $('bm-file').addEventListener('change', loadParas);
  $('bm-page').addEventListener('change', loadParas);
  $('bm-cancel').addEventListener('click', () => els.bookmarkOverlay.classList.add('hidden'));
  $('bm-save').addEventListener('click', async () => {
    const fileId = $('bm-file').value;
    const pg = parseInt($('bm-page').value, 10);
    const ref = $('bm-ref').value.trim();
    const title = $('bm-title').value.trim();
    if (!fileId || !Number.isFinite(pg) || !ref) { toast('Document, page and reference are required.'); return; }
    const m = state.manuals.get(fileId);
    const manualType = m ? m.manualType : 'PERSONAL';
    const anchorType = anchorTypeFor(manualType);
    await storage.putAnchor({
      anchorId: `${fileId}:${anchorType}:${ref.toUpperCase()}`,
      fileId, manualType, anchorType, value: ref, title,
      pageNum: pg, source: 'manual', confidence: null,
      excerpt: chosenExcerpt.slice(0, 260),
    });
    kg.invalidate(); await kg.load(true);
    els.bookmarkOverlay.classList.add('hidden');
    renderBriefing();
    if (viewerVisible() && !els.viewerSidebar.classList.contains('hidden')) renderSidebar();
    toast('Bookmark added.');
  });
  if (preset.fileId && preset.pageNum) loadParas();
}

// --- Viewer (multi-tab, split panes, sidebar, dock) --------------------------

function makeTab(anchor, query = '') {
  const file = state.files.get(anchor.fileId);
  return {
    id: newTabId(), fileId: anchor.fileId, fileName: file ? file.name : '',
    pageNum: anchor.pageNum, query, anchor, manualType: anchor.manualType,
  };
}

function viewerVisible() { return !els.viewerOverlay.classList.contains('hidden'); }
function getTab(tabId) { return state.viewer.tabs.find((t) => t.id === tabId) || null; }
function paneTab(i) { const p = state.viewer.panes[i]; return p ? getTab(p.tabId) : null; }
function focusedApi() { const p = state.viewer.panes[state.viewer.focused]; return p ? p.api : null; }

function ensurePanes() {
  if (!state.viewer.panes.length && state.viewer.tabs.length) {
    state.viewer.panes = [{ tabId: state.viewer.tabs[0].id }];
    state.viewer.focused = 0;
  }
}

function tabLabel(t) {
  if (t.anchor) return `${t.manualType} ${t.anchor.value}`;
  return t.fileName || t.manualType || 'Document';
}

async function openAnchorInViewer(anchor, { query = '' } = {}) {
  const hlQuery = query || anchor.excerpt || anchor.title || '';
  let tab = state.viewer.tabs.find((t) => t.fileId === anchor.fileId);
  if (!tab) {
    tab = makeTab(anchor, hlQuery);
    state.viewer.tabs.push(tab);
  } else {
    Object.assign(tab, { pageNum: anchor.pageNum, anchor, query: hlQuery });
  }
  tab.highlightPage = anchor.pageNum;
  ensurePanes();
  state.viewer.panes[state.viewer.focused].tabId = tab.id;
  persistViewer();
  await openViewer();
}

async function openFileInViewer(fileId, pageNum, { query = '' } = {}) {
  const file = state.files.get(fileId);
  if (!file) { toast('File not found.'); return; }
  let tab = state.viewer.tabs.find((t) => t.fileId === fileId);
  if (!tab) {
    const m = state.manuals.get(fileId);
    tab = { id: newTabId(), fileId, fileName: file.name, pageNum, query, anchor: null, manualType: m ? m.manualType : '' };
    state.viewer.tabs.push(tab);
  } else {
    Object.assign(tab, { pageNum, query });
  }
  tab.highlightPage = null;
  ensurePanes();
  state.viewer.panes[state.viewer.focused].tabId = tab.id;
  persistViewer();
  await openViewer();
}

async function openViewer() {
  ensurePanes();
  els.viewerOverlay.classList.remove('hidden');
  els.viewerOverlay.classList.toggle('split', state.viewer.split);
  els.splitToggle.setAttribute('aria-pressed', state.viewer.split ? 'true' : 'false');
  renderViewerTabs();
  renderTabDock();
  await refreshViewer();
}

function minimizeViewer() {
  els.viewerOverlay.classList.add('hidden');
  persistViewer();
  renderTabDock();
}

function closeViewerFully() {
  state.viewer.tabs = [];
  state.viewer.panes = [];
  state.viewer.focused = 0;
  els.pdfPanes.innerHTML = '';
  els.viewerOverlay.classList.add('hidden');
  setMarkupOn(false);
  clearViewerCache();
  persistViewer();
  renderTabDock();
}

function renderViewerTabs() {
  els.viewerTabs.innerHTML = state.viewer.tabs.map((t) => {
    const inPane = state.viewer.panes.some((p) => p.tabId === t.id);
    return `
      <div class="viewer-tab" role="tab" data-tab="${t.id}" aria-selected="${inPane}">
        <span class="vt-label">${escapeHtml(tabLabel(t))}</span>
        <span class="vt-close" data-act="close" title="Close tab">✕</span>
      </div>`;
  }).join('');
  els.viewerTabs.querySelectorAll('.viewer-tab').forEach((tabEl) => {
    const id = tabEl.getAttribute('data-tab');
    tabEl.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="close"]')) { closeTab(id); return; }
      state.viewer.panes[state.viewer.focused].tabId = id;
      persistViewer();
      renderViewerTabs();
      refreshViewer();
    });
  });
}

function renderTabDock() {
  const show = state.viewer.tabs.length > 0 && !viewerVisible();
  els.tabDock.classList.toggle('hidden', !show);
  document.body.classList.toggle('has-dock', show);
  if (!show) { els.tabDock.innerHTML = ''; return; }
  els.tabDock.innerHTML = state.viewer.tabs.map((t) => `
    <div class="dock-tab" data-tab="${t.id}">
      <span class="dt-label">${escapeHtml(tabLabel(t))}</span>
      <span class="dt-close" data-act="close" title="Close tab">✕</span>
    </div>`).join('');
  els.tabDock.querySelectorAll('.dock-tab').forEach((chip) => {
    const id = chip.getAttribute('data-tab');
    chip.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="close"]')) { closeTab(id); return; }
      ensurePanes();
      state.viewer.panes[state.viewer.focused].tabId = id;
      persistViewer();
      openViewer();
    });
  });
}

function closeTab(tabId) {
  state.viewer.tabs = state.viewer.tabs.filter((t) => t.id !== tabId);
  if (!state.viewer.tabs.length) { closeViewerFully(); return; }
  for (const p of state.viewer.panes) {
    if (!state.viewer.tabs.some((t) => t.id === p.tabId)) p.tabId = state.viewer.tabs[0].id;
  }
  persistViewer();
  renderViewerTabs();
  renderTabDock();
  if (viewerVisible()) refreshViewer();
}

function closeTabsForFile(id) {
  const had = state.viewer.tabs.length;
  state.viewer.tabs = state.viewer.tabs.filter((t) => t.fileId !== id);
  if (state.viewer.tabs.length === had) return;
  if (!state.viewer.tabs.length) { closeViewerFully(); return; }
  for (const p of state.viewer.panes) {
    if (!state.viewer.tabs.some((t) => t.id === p.tabId)) p.tabId = state.viewer.tabs[0].id;
  }
  persistViewer();
  renderViewerTabs();
  renderTabDock();
  if (viewerVisible()) refreshViewer();
}

function toggleSplit() {
  state.viewer.split = !state.viewer.split;
  els.splitToggle.setAttribute('aria-pressed', state.viewer.split ? 'true' : 'false');
  els.viewerOverlay.classList.toggle('split', state.viewer.split);
  if (state.viewer.split && state.viewer.panes.length < 2) {
    const other = state.viewer.tabs.find((t) => t.id !== state.viewer.panes[0].tabId) || state.viewer.tabs[0];
    state.viewer.panes.push({ tabId: other.id });
  } else if (!state.viewer.split) {
    state.viewer.panes = state.viewer.panes.slice(0, 1);
    state.viewer.focused = 0;
  }
  persistViewer();
  refreshViewer();
}

function toggleSidebar() {
  const isHidden = els.viewerSidebar.classList.toggle('hidden');
  els.sidebarToggle.setAttribute('aria-pressed', isHidden ? 'false' : 'true');
  if (!isHidden) renderSidebar();
}

function outlineNodeHtml(n) {
  const leaf = !n.children || !n.children.length;
  return `
    <li>
      <div class="vs-node ${leaf ? 'leaf' : 'collapsed'}" data-page="${n.page || ''}">
        <span class="vs-caret">▾</span>
        <span class="vs-title">${escapeHtml(n.title)}</span>
        ${n.page ? `<span class="vs-page">${n.page}</span>` : ''}
      </div>
      ${leaf ? '' : `<ul class="vs-children collapsed">${n.children.map(outlineNodeHtml).join('')}</ul>`}
    </li>`;
}

async function renderSidebar() {
  if (els.viewerSidebar.classList.contains('hidden')) return;
  const pane = state.viewer.panes[state.viewer.focused];
  const tab = paneTab(state.viewer.focused);
  if (!pane || !tab) return;

  let outline = [];
  if (pane.api && pane.api.getOutline) {
    try { outline = await pane.api.getOutline(); } catch { outline = []; }
  }
  els.vsChapters.innerHTML = outline.length
    ? outline.map(outlineNodeHtml).join('')
    : '<li class="vs-empty">No chapter outline in this PDF.</li>';
  els.vsChapters.querySelectorAll('.vs-node').forEach((node) => {
    const childUl = node.parentElement.querySelector(':scope > .vs-children');
    if (childUl) {
      node.querySelector('.vs-caret').addEventListener('click', (e) => {
        e.stopPropagation();
        const collapsed = node.classList.toggle('collapsed');
        childUl.classList.toggle('collapsed', collapsed);
      });
    }
    const pg = parseInt(node.getAttribute('data-page'), 10);
    if (Number.isFinite(pg)) node.addEventListener('click', () => paneGoTo(state.viewer.focused, pg));
  });

  const anchors = (await kg.anchorsForFile(tab.fileId)).sort((a, b) => a.pageNum - b.pageNum);
  els.vsBookmarks.innerHTML = anchors.length
    ? anchors.map((a) => `
        <li class="vs-item" data-anchor="${escapeHtml(a.anchorId)}">
          <span class="vs-title">${escapeHtml(a.value)}${a.title ? ' — ' + escapeHtml(a.title) : ''}</span>
          <span class="vs-page">${a.pageNum}</span>
          ${state.noteCounts.get(a.anchorId) ? '<span class="vs-note">✎</span>' : ''}
        </li>`).join('')
    : '<li class="vs-empty">No bookmarks for this file yet.</li>';
  els.vsBookmarks.querySelectorAll('.vs-item').forEach((li) => {
    const a = anchors.find((x) => x.anchorId === li.getAttribute('data-anchor'));
    if (a) li.addEventListener('click', () => openAnchorInViewer(a));
  });
}

function buildPaneShells() {
  els.pdfPanes.innerHTML = state.viewer.panes.map((p, i) => `
    <div class="pdf-pane ${i === state.viewer.focused ? 'focused' : ''}" data-pane="${i}">
      <div class="pane-head">
        <span class="pane-doc"></span>
        <button class="btn ghost" data-act="back" title="Back" disabled>◁</button>
        <button class="btn" data-act="prev" title="Previous page">‹</button>
        <span class="pane-page"><input type="number" min="1" data-f="page" aria-label="Page" /><span data-f="of">/ —</span></span>
        <button class="btn" data-act="next" title="Next page">›</button>
        <button class="btn ghost" data-act="fwd" title="Forward" disabled>▷</button>
      </div>
      <div class="pdf-scroll"></div>
    </div>`).join('');
  els.pdfPanes.querySelectorAll('.pdf-pane').forEach((paneEl) => {
    const i = +paneEl.getAttribute('data-pane');
    const pane = state.viewer.panes[i];
    pane.api = null;
    pane.mountedFileId = null;
    pane.scrollEl = paneEl.querySelector('.pdf-scroll');
    pane.headEl = paneEl.querySelector('.pane-head');
    paneEl.addEventListener('pointerdown', () => setFocusedPane(i), true);
    pane.headEl.querySelector('[data-act="back"]').addEventListener('click', () => { if (pane.api) pane.api.goBack(); });
    pane.headEl.querySelector('[data-act="fwd"]').addEventListener('click', () => { if (pane.api) pane.api.goForward(); });
    pane.headEl.querySelector('[data-act="prev"]').addEventListener('click', () => paneStep(i, -1));
    pane.headEl.querySelector('[data-act="next"]').addEventListener('click', () => paneStep(i, 1));
    const pInput = pane.headEl.querySelector('[data-f="page"]');
    pInput.addEventListener('change', () => paneGoTo(i, parseInt(pInput.value, 10)));
  });
}

async function refreshViewer() {
  const shellCount = els.pdfPanes.querySelectorAll('.pdf-pane').length;
  if (shellCount !== state.viewer.panes.length) {
    buildPaneShells();
    for (let i = 0; i < state.viewer.panes.length; i++) await mountPane(i);
  } else {
    for (let i = 0; i < state.viewer.panes.length; i++) {
      const tab = paneTab(i);
      const pane = state.viewer.panes[i];
      if (!tab) continue;
      if (!pane.api || pane.mountedFileId !== tab.fileId) {
        await mountPane(i);
      } else {
        pane.api.scrollToPage(tab.pageNum, { smooth: false });
        pane.headEl.querySelector('.pane-doc').textContent = tab.fileName;
      }
    }
  }
  applyMarkup();
  refreshViewerFoot();
  renderSidebar();
}

async function mountPane(i) {
  const pane = state.viewer.panes[i];
  const tab = paneTab(i);
  if (!pane || !tab || !pane.scrollEl) return;
  pane.headEl.querySelector('.pane-doc').textContent = tab.fileName;
  try {
    const highlights = await collectHighlights(tab.fileId, tab.query, tab.highlightPage);
    const markMemory = ['FCOM', 'FCTM', 'QRH'].includes(tab.manualType);
    const api = await mountPdf(pane.scrollEl, tab.fileId, {
      startPage: tab.pageNum, highlights, markMemory,
      onPageChange: (n) => { tab.pageNum = n; updatePanePage(i, n); },
      onHistoryChange: (h) => updatePaneHistory(i, h),
      onNoteSelection: (pageNum, text) => openSelectionNote(tab.fileId, pageNum, text),
    });
    pane.api = api;
    pane.mountedFileId = tab.fileId;
    const pInput = pane.headEl.querySelector('[data-f="page"]');
    pInput.max = String(api.numPages);
    updatePanePage(i, tab.pageNum, api.numPages);
  } catch (err) {
    console.error(err);
    toast('Failed to render PDF: ' + err.message);
  }
}

function updatePanePage(i, n, numPages) {
  const pane = state.viewer.panes[i];
  if (!pane || !pane.headEl) return;
  pane.headEl.querySelector('[data-f="page"]').value = String(n);
  if (numPages != null) pane.headEl.querySelector('[data-f="of"]').textContent = '/ ' + numPages;
}

function updatePaneHistory(i, h) {
  const pane = state.viewer.panes[i];
  if (!pane || !pane.headEl) return;
  pane.headEl.querySelector('[data-act="back"]').disabled = !h.canBack;
  pane.headEl.querySelector('[data-act="fwd"]').disabled = !h.canForward;
}

function paneStep(i, d) {
  const pane = state.viewer.panes[i];
  const tab = paneTab(i);
  if (pane && pane.api && tab) pane.api.scrollToPage((tab.pageNum || 1) + d, { smooth: true });
}

function paneGoTo(i, n) {
  const pane = state.viewer.panes[i];
  if (pane && pane.api && Number.isFinite(n)) pane.api.scrollToPage(n, { push: true, smooth: true });
}

function setFocusedPane(i) {
  if (state.viewer.focused === i) return;
  state.viewer.focused = i;
  els.pdfPanes.querySelectorAll('.pdf-pane').forEach((el) =>
    el.classList.toggle('focused', +el.getAttribute('data-pane') === i));
  persistViewer();
  refreshViewerFoot();
  renderSidebar();
}

async function refreshViewerFoot() {
  const tab = paneTab(state.viewer.focused);
  els.viewerTitle.textContent = tab ? tab.fileName : '';
  if (!tab) { els.viewerNotes.textContent = ''; return; }
  const manual = state.manuals.get(tab.fileId);
  const cb = manual && manual.changeBarPages && manual.changeBarPages.length
    ? ` · Change bars: pp. ${manual.changeBarPages.slice(0, 12).join(', ')}` : '';
  let noteTxt = '';
  if (tab.anchor) {
    const list = await notes.listForAnchor(tab.anchor.anchorId);
    if (list.length) noteTxt = `${list.length} note(s) on ${tab.anchor.value}`;
  }
  els.viewerNotes.textContent = noteTxt + cb;
}

async function remountViewer() {
  if (!viewerVisible()) return;
  buildPaneShells();
  for (let i = 0; i < state.viewer.panes.length; i++) await mountPane(i);
  applyMarkup();
}

function persistViewer() {
  storage.setKV('viewerState', {
    tabs: state.viewer.tabs.map((t) => ({
      id: t.id, fileId: t.fileId, pageNum: t.pageNum, query: t.query || '',
      manualType: t.manualType || '', anchor: t.anchor || null,
    })),
    panes: state.viewer.panes.map((p) => ({ tabId: p.tabId })),
    split: state.viewer.split,
    focused: state.viewer.focused,
  });
}

async function collectHighlights(fileId, query, onlyPage) {
  if (!query) return [];
  const pages = await storage.getPagesForFile(fileId);
  const terms = query.toLowerCase().match(/[a-z0-9֐-׿]+/g) || [];
  if (!terms.length) return [];
  const out = [];
  for (const p of pages) {
    if (onlyPage && p.pageNum !== onlyPage) continue;
    const hay = ((p.text || '') + ' ' + (p.annotationsText || '')).toLowerCase();
    if (!terms.some((t) => hay.includes(t))) continue;
    try {
      const h = await findQueryHighlight(fileId, p.pageNum, query);
      if (h && h.rects) for (const rect of h.rects) out.push({ pageNum: p.pageNum, rect });
    } catch { /* skip */ }
  }
  return out;
}

// --- Markup ------------------------------------------------------------------

function setMarkupOn(on) {
  state.markup.on = on;
  els.mkToggle.setAttribute('aria-pressed', on ? 'true' : 'false');
  els.markupBar.classList.toggle('hidden', !on);
  if (on && state.selectMode) {
    state.selectMode = false;
    els.selectToggle.setAttribute('aria-pressed', 'false');
  }
  applyMarkup();
}

function applyMarkup() {
  setMarkupColor(state.markup.color);
  setMarkupWidth(state.markup.width);
  setMarkupTool(state.markup.on ? state.markup.tool : null);
}

function toggleSelectMode() {
  state.selectMode = !state.selectMode;
  els.selectToggle.setAttribute('aria-pressed', state.selectMode ? 'true' : 'false');
  if (state.selectMode && state.markup.on) {
    state.markup.on = false;
    els.mkToggle.setAttribute('aria-pressed', 'false');
    els.markupBar.classList.add('hidden');
  }
  setSelectMode(state.selectMode);
}

// --- Annotations -------------------------------------------------------------

function pageAnchor(fileId, pageNum) {
  const file = state.files.get(fileId);
  const m = state.manuals.get(fileId);
  return {
    anchorId: `${fileId}:page:${pageNum}`,
    fileId, manualType: m ? m.manualType : 'PERSONAL',
    anchorType: 'page', value: 'p.' + pageNum,
    title: file ? file.name : '', pageNum,
  };
}

// "Note this page" — the viewer toolbar button.
function openNotesForActiveTab() {
  const tab = paneTab(state.viewer.focused);
  if (!tab) return;
  openNotes(pageAnchor(tab.fileId, tab.pageNum));
}

// Note from a text selection — prefilled with the selected text.
function openSelectionNote(fileId, pageNum, text) {
  openNotes(pageAnchor(fileId, pageNum), text ? `“${text}”\n\n` : '');
}

async function openNotes(anchor, prefill = '') {
  els.noteTitle.textContent = `Notes — ${anchor.manualType} ${anchor.value}`;
  els.noteOverlay.classList.remove('hidden');

  async function refresh() {
    const list = await notes.listForAnchor(anchor.anchorId);
    els.noteBody.innerHTML = `
      <ul class="note-list">
        ${list.length ? list.map(noteItemHtml).join('') : '<li class="briefing-empty">No notes yet.</li>'}
      </ul>
      <div class="note-add">
        <textarea id="note-text" placeholder="Add a note for ${escapeHtml(anchor.value)}…">${escapeHtml(prefill)}</textarea>
        <div class="note-add-row">
          <label class="btn">📷 Picture<input type="file" id="note-img" accept="image/*" hidden /></label>
          <span style="flex:1"></span>
          <button class="btn primary" id="note-save">Save note</button>
        </div>
      </div>`;
    for (const n of list) {
      const li = els.noteBody.querySelector(`[data-note="${n.noteId}"]`);
      if (!li) continue;
      if (n.imageBlob) {
        const img = li.querySelector('img');
        if (img) img.src = URL.createObjectURL(n.imageBlob);
      }
      li.querySelector('[data-act="del-note"]').addEventListener('click', async () => {
        await notes.removeNote(n.noteId);
        await refreshNoteCounts();
        renderBriefing(); renderLibrary();
        refresh();
      });
    }
    let pendingImg = null;
    $('note-img').addEventListener('change', (e) => { pendingImg = e.target.files[0] || null; if (pendingImg) toast('Picture attached.'); });
    $('note-save').addEventListener('click', async () => {
      const text = $('note-text').value.trim();
      if (!text && !pendingImg) return;
      await notes.addNote(anchor, { text, imageBlob: pendingImg });
      await refreshNoteCounts();
      renderBriefing(); renderLibrary();
      refreshViewerFoot();
      if (viewerVisible() && !els.viewerSidebar.classList.contains('hidden')) renderSidebar();
      refresh();
    });
  }
  refresh();
}

function noteItemHtml(n) {
  return `
    <li class="note-item" data-note="${escapeHtml(n.noteId)}">
      ${n.text ? `<p class="note-text">${escapeHtml(n.text)}</p>` : ''}
      ${n.imageBlob ? '<img alt="Note picture" />' : ''}
      <div class="note-meta">
        <span>${escapeHtml(fmtDate(n.createdAt))}</span>
        <button class="btn ghost danger" data-act="del-note">Delete</button>
      </div>
    </li>`;
}

// --- Notes view --------------------------------------------------------------

async function renderNotesView() {
  const all = (await storage.getAllAnnotations())
    .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  if (!all.length) {
    els.notesList.innerHTML = '<li class="briefing-empty">No notes yet. Open a document and tap ✎ Note.</li>';
    return;
  }
  els.notesList.innerHTML = all.map((n) => `
    <li class="note-row" data-note="${escapeHtml(n.noteId)}">
      <span class="nr-badge">${escapeHtml(n.manualType || '?')} ${escapeHtml(n.anchorValue || '')}</span>
      ${n.imageBlob ? '<img class="nr-thumb" alt="" />' : ''}
      <span class="nr-body">
        <div class="nr-anchor">${escapeHtml(n.anchorTitle || n.anchorValue || 'Note')}</div>
        <div class="nr-text">${escapeHtml(n.text || (n.imageBlob ? '[picture]' : ''))}</div>
      </span>
      <span class="nr-date">${escapeHtml(fmtDate(n.updatedAt || n.createdAt))}</span>
      <button class="btn ghost danger" data-act="del">✕</button>
    </li>`).join('');
  for (const n of all) {
    const li = els.notesList.querySelector(`[data-note="${n.noteId}"]`);
    if (!li) continue;
    if (n.imageBlob) {
      const img = li.querySelector('img.nr-thumb');
      if (img) img.src = URL.createObjectURL(n.imageBlob);
    }
    li.addEventListener('click', (e) => {
      if (e.target.closest('[data-act="del"]')) return;
      openNoteFromList(n);
    });
    li.querySelector('[data-act="del"]').addEventListener('click', async (e) => {
      e.stopPropagation();
      await notes.removeNote(n.noteId);
      await refreshNoteCounts();
      renderNotesView();
      renderBriefing(); renderLibrary();
    });
  }
}

async function openNoteFromList(n) {
  if (!state.files.get(n.fileId)) { toast('The file for this note was removed.'); return; }
  const anchor = {
    anchorId: n.anchorId, fileId: n.fileId, manualType: n.manualType,
    anchorType: n.anchorType || 'page', value: n.anchorValue,
    title: n.anchorTitle, pageNum: n.pageNum || 1,
  };
  await openAnchorInViewer(anchor);
  openNotes(anchor);
}

// --- Bookmarks search --------------------------------------------------------

async function runJumpSearch(query) {
  if (!query) { els.jumpResults.innerHTML = ''; els.answerPanel.classList.add('hidden'); return; }
  const fileIds = activeFileIds();
  const groups = await kg.groupedSearch(query, { fileIds });
  if (groups.length) {
    els.jumpResults.innerHTML = groups.map((g) => `
      <div class="jump-group">
        <div class="jump-group-head">${escapeHtml(manualLabel(g.manualType))}</div>
        ${g.anchors.slice(0, 30).map(anchorRowHtml).join('')}
      </div>`).join('');
    els.jumpResults.querySelectorAll('.jump-group').forEach((grp, gi) => {
      bindAnchorRows(grp, groups[gi].anchors);
    });
  } else {
    els.jumpResults.innerHTML = '<div class="jump-empty">No bookmark matches — showing full-text results.</div>';
  }
  runFullTextSearch(query);
}

function runFullTextSearch(query) {
  if (!state.files.size) { els.answerPanel.classList.add('hidden'); return; }
  const hits = searchMod.search(query, { limit: 12 });
  if (!hits.length) { els.answerPanel.classList.add('hidden'); return; }
  const summary = extractiveSummary(query, hits);
  els.answerPanel.classList.remove('hidden');
  els.answerPanel.innerHTML = summary.sections.map((sec) => `
    <article class="answer-section">
      <header class="answer-section-head">
        <span class="answer-section-name">${escapeHtml(sec.fileName)}</span>
        <span>${sec.citations.map((c) => `<span class="cite" data-cite="${c.idx}">p.${c.pageNum}</span>`).join(' · ')}</span>
      </header>
      <p class="answer-section-body">${escapeHtml(sec.paragraph)}</p>
    </article>`).join('');
  els.answerPanel.querySelectorAll('[data-cite]').forEach((node) => {
    node.addEventListener('click', () => {
      const cite = summary.citations.find((c) => c.idx === +node.getAttribute('data-cite'));
      if (cite) openFileInViewer(cite.fileId, cite.pageNum, { query });
    });
  });
}

// --- GPS (phase auto-detection only) -----------------------------------------

function toggleGps() {
  if (gps.isActive()) {
    gps.stop();
    state.gpsAuto = false;
    els.gpsToggle.setAttribute('aria-pressed', 'false');
    els.gpsReadout.textContent = '';
  } else {
    if (gps.start()) {
      state.gpsAuto = true;
      els.gpsToggle.setAttribute('aria-pressed', 'true');
      els.gpsReadout.textContent = 'GPS…';
    }
  }
}

function onGpsUpdate(s) {
  if (s.error && !s.altFt) { els.gpsReadout.textContent = s.error.slice(0, 32); return; }
  if (s.altFt == null) return;
  const arrow = s.trend > 0 ? '↑' : s.trend < 0 ? '↓' : '→';
  els.gpsReadout.textContent = `${Math.round(s.altFt).toLocaleString()} ft ${arrow}`;
  els.phasePath.querySelectorAll('[data-gps]').forEach((el) =>
    el.classList.toggle('hidden', el.getAttribute('data-gps') !== s.phase));
  if (state.gpsAuto && s.phase && s.phase !== state.phase && Date.now() > state.manualPhaseUntil) {
    setPhase(s.phase);
  }
}

// --- Helpers -----------------------------------------------------------------

let toastTimer = null;
function toast(msg) {
  els.toast.textContent = msg;
  els.toast.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => els.toast.classList.add('hidden'), 2600);
}

function debounce(fn, ms) {
  let t = null;
  return (...a) => { if (t) clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
