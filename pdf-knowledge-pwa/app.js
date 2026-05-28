// B737 Pilot Companion — bootstrap, state, and event wiring.

import * as storage from './modules/storage.js?v=5';
import { extractPdf, makeFileId } from './modules/pdf-ingest.js';
import * as searchMod from './modules/search.js';
import { mountPdf, clearViewerCache, findQueryHighlight, setMarkupTool, setMarkupColor, setMarkupWidth, setSelectMode } from './modules/viewer.js?v=16';
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
import { paragraphsForPage, paragraphHash } from './modules/paragraphs.js?v=1';
import { renderPreview } from './modules/page-preview.js?v=1';

const $ = (id) => document.getElementById(id);
const els = {
  tailSelect: $('tail-select'), gpsReadout: $('gps-readout'),
  gpsToggle: $('gps-toggle'), scratchToggle: $('scratch-toggle'), themeToggle: $('theme-toggle'),
  homeSearch: $('home-search'), homeClear: $('home-clear'),
  homePhases: $('home-phases'),
  homeScenarios: $('home-scenarios'), homeAddScenario: $('home-add-scenario'),
  homeSubRow: $('home-sub-row'),
  homeSubScenarios: $('home-sub-scenarios'), homeAddSub: $('home-add-sub'),
  homeResults: $('home-results'), homeAddFile: $('home-add-file'),
  homeSettings: $('home-settings'),
  briefingNewOverlay: $('briefing-new-overlay'), bnClose: $('bn-close'),
  bnForm: $('bn-form'), bnTitle: $('bn-title'), bnName: $('bn-name'),
  bnParent: $('bn-parent'), bnParentField: $('bn-parent-field'),
  bnPhases: $('bn-phases'), bnColor: $('bn-color'), bnCancel: $('bn-cancel'),
  settingsOverlay: $('settings-overlay'), settingsClose: $('settings-close'),
  settingsScenarios: $('settings-scenarios'), settingsBtypes: $('settings-btypes'),
  settingsScenarioNew: $('settings-scenario-new'), ssName: $('ss-name'),
  settingsBtypeNew: $('settings-btype-new'), sbName: $('sb-name'), sbColor: $('sb-color'),
  settingsFiles: $('settings-files'), settingsNotes: $('settings-notes'), settingsAircraft: $('settings-aircraft'),
  scenarioOverlay: $('scenario-overlay'), scenarioBody: $('scenario-body'), scenarioClose: $('scenario-close'),
  btypeOverlay: $('btype-overlay'), btypeBody: $('btype-body'), btypeClose: $('btype-close'),
  searchForm: $('search-form'), searchInput: $('search-input'),
  jumpResults: $('jump-results'), answerPanel: $('answer-panel'),
  notesList: $('notes-list'), filesList: $('files-list'),
  tailForm: $('tail-form'), tailReg: $('tail-reg'), tailLabel: $('tail-label'), tailList: $('tail-list'),
  fileInput: $('file-input'), personalInput: $('personal-input'), ingestStatus: $('ingest-status'),
  libraryList: $('library-list'), storageInfo: $('storage-info'),
  viewerOverlay: $('viewer-overlay'), viewerTabs: $('viewer-tabs'), viewerTitle: $('viewer-title'),
  sidebarToggle: $('sidebar-toggle'), splitToggle: $('split-toggle'), selectToggle: $('select-toggle'),
  viewerIndex: $('viewer-index'), viewerBookmark: $('viewer-bookmark'),
  viewerNote: $('viewer-note'), viewerClose: $('viewer-close'),
  indexerOverlay: $('indexer-overlay'), indexerBody: $('indexer-body'), indexerClose: $('indexer-close'),
  pageParasOverlay: $('page-paras-overlay'), pageParasBody: $('page-paras-body'),
  pageParasClose: $('page-paras-close'), pageParasTitle: $('page-paras-title'),
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
  scenarios: [],
  briefingTypes: [],
  activeTail: null,
  noteCounts: new Map(),       // anchorId -> count
  fileNoteCounts: new Map(),   // fileId -> count
  view: 'phase',
  phase: 'dispatch',
  toggle: 'normal',
  // Home filters: phase is single-select; scenarios multi-select.
  selectedPhase: null,
  selectedScenarios: new Set(),
  homeQuery: '',
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
  const [files, manuals, tails, scenarios, briefingTypes, activeTail, savedViewer] = await Promise.all([
    storage.listFiles(), storage.listManuals(), storage.listTails(),
    storage.listScenarios(), storage.listBriefingTypes(),
    storage.getKV('activeTail'), storage.getKV('viewerState'),
  ]);
  for (const f of files) state.files.set(f.id, f);
  for (const m of manuals) state.manuals.set(m.fileId, m);
  state.tails = tails;
  state.scenarios = scenarios;
  state.briefingTypes = briefingTypes;
  state.activeTail = activeTail || null;

  await searchMod.rebuildIndex(state.files);
  await kg.load(true);
  await refreshNoteCounts();

  renderHomePhases();
  renderHomeScenarios();
  renderTailSelect();
  renderTails();
  renderLibrary();
  renderStorageInfo();
  await renderHomeResults();
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
  // Home view (3-D hub): phase chips + scenario chips + filtered indexed results.
  els.homeSearch.addEventListener('input', debounce(() => {
    state.homeQuery = els.homeSearch.value.trim();
    renderHomeResults();
  }, 200));
  els.homeClear.addEventListener('click', () => {
    state.selectedPhase = null; state.selectedScenarios.clear();
    state.homeQuery = ''; els.homeSearch.value = '';
    renderHomePhases(); renderHomeScenarios(); renderHomeResults();
  });
  els.homeAddScenario.addEventListener('click', () => openBriefingNewModal({ parentId: null }));
  els.homeAddSub.addEventListener('click', () => {
    // Sub-briefing defaults its parent to the currently-active top-level (first
    // selected top-level scenario, if any).
    const firstTopSelected = [...state.selectedScenarios].find((id) => {
      const s = state.scenarios.find((x) => x.id === id);
      return s && !s.parentId;
    });
    openBriefingNewModal({ parentId: firstTopSelected || null, forceSub: true });
  });
  els.bnClose.addEventListener('click', () => els.briefingNewOverlay.classList.add('hidden'));
  els.bnCancel.addEventListener('click', () => els.briefingNewOverlay.classList.add('hidden'));
  els.briefingNewOverlay.addEventListener('click', (e) => { if (e.target === els.briefingNewOverlay) els.briefingNewOverlay.classList.add('hidden'); });
  els.bnForm.addEventListener('submit', onCreateBriefing);
  els.homeAddFile.addEventListener('click', () => els.personalInput.click());
  els.homeSettings.addEventListener('click', openSettingsSheet);
  els.settingsClose.addEventListener('click', () => els.settingsOverlay.classList.add('hidden'));
  els.settingsOverlay.addEventListener('click', (e) => { if (e.target === els.settingsOverlay) els.settingsOverlay.classList.add('hidden'); });
  els.settingsScenarioNew.addEventListener('submit', onSettingsAddScenario);
  els.settingsBtypeNew.addEventListener('submit', onSettingsAddBtype);
  els.settingsFiles.addEventListener('click', () => { els.settingsOverlay.classList.add('hidden'); switchView('files'); });
  els.settingsNotes.addEventListener('click', () => { els.settingsOverlay.classList.add('hidden'); switchView('notes'); });
  els.settingsAircraft.addEventListener('click', () => { els.settingsOverlay.classList.add('hidden'); switchView('library'); });
  els.scenarioClose.addEventListener('click', () => els.scenarioOverlay.classList.add('hidden'));
  els.scenarioOverlay.addEventListener('click', (e) => { if (e.target === els.scenarioOverlay) els.scenarioOverlay.classList.add('hidden'); });
  els.btypeClose.addEventListener('click', () => els.btypeOverlay.classList.add('hidden'));
  els.btypeOverlay.addEventListener('click', (e) => { if (e.target === els.btypeOverlay) els.btypeOverlay.classList.add('hidden'); });

  els.searchForm.addEventListener('submit', (e) => { e.preventDefault(); runJumpSearch(els.searchInput.value.trim()); });

  els.viewerClose.addEventListener('click', minimizeViewer);
  els.viewerNote.addEventListener('click', openNotesForActiveTab);
  els.viewerBookmark.addEventListener('click', openBookmarkFromViewer);
  els.viewerIndex.addEventListener('click', openPageIndexerForActiveTab);
  els.indexerClose.addEventListener('click', () => els.indexerOverlay.classList.add('hidden'));
  els.indexerOverlay.addEventListener('click', (e) => { if (e.target === els.indexerOverlay) els.indexerOverlay.classList.add('hidden'); });
  els.pageParasClose.addEventListener('click', () => els.pageParasOverlay.classList.add('hidden'));
  els.pageParasOverlay.addEventListener('click', (e) => { if (e.target === els.pageParasOverlay) els.pageParasOverlay.classList.add('hidden'); });
  els.splitToggle.addEventListener('click', toggleSplit);
  els.selectToggle.addEventListener('click', toggleSelectMode);
  els.sidebarToggle.addEventListener('click', toggleSidebar);
  els.vsAddBm.addEventListener('click', () => {
    const tab = paneTab(state.viewer.focused);
    openBookmarkModal({ phase: state.phase, toggle: state.toggle,
      ...(tab ? { fileId: tab.fileId, pageNum: tab.pageNum } : {}) });
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
  // Top tab nav is hidden on the home view; reveal it whenever the user
  // navigates into one of the secondary views (so they can return via tabs).
  document.querySelector('.view-nav').classList.toggle('hidden', view === 'phase');
  $('view-phase').classList.toggle('hidden', view !== 'phase');
  $('view-bookmarks').classList.toggle('hidden', view !== 'bookmarks');
  $('view-notes').classList.toggle('hidden', view !== 'notes');
  $('view-files').classList.toggle('hidden', view !== 'files');
  $('view-library').classList.toggle('hidden', view !== 'library');
  if (view === 'notes') renderNotesView();
  if (view === 'files') renderFilesView();
}

// --- Home view: 3-D filtering hub --------------------------------------------
// Top: horizontal phase chips. Below: scenario chips (+ new / manage). Below:
// indexed-anchor results filtered by the union of selected phases AND scenarios
// AND the search query. Bottom-right: floating "add file" button. Tap a result
// to open the file full-window at its page.

// Flight-path SVG. The viewBox is 1000×200 and stretches to fill its
// container regardless of window width. Each phase sits on the profile.
const PHASE_PROFILE = {
  dispatch:     { x: 40,  y: 180, lblY: 210 },
  takeoff:      { x: 140, y: 180, lblY: 210 },
  climb:        { x: 280, y: 95,  lblY: 78  },
  cruise:       { x: 470, y: 38,  lblY: 22  },
  descent:      { x: 660, y: 95,  lblY: 78  },
  approach:     { x: 790, y: 160, lblY: 188 },
  landing:      { x: 880, y: 180, lblY: 210 },
  afterLanding: { x: 970, y: 180, lblY: 210 },
};
const FLIGHT_PATH_D =
  'M30,180 L150,180 Q220,180 290,90 Q380,38 470,38 Q560,38 650,90 Q720,162 790,162 L880,180 L970,180';

function renderHomePhases() {
  const nodes = PHASES.map((p) => {
    const pos = PHASE_PROFILE[p.id] || { x: 500, y: 100, lblY: 80 };
    const on = state.selectedPhase === p.id;
    return `
      <g class="fp-node ${on ? 'on' : ''}" data-phase="${p.id}" transform="translate(${pos.x} ${pos.y})">
        <circle class="fp-hit" r="22" />
        <circle class="fp-dot" r="9" />
        <text class="fp-label" text-anchor="middle" y="${pos.lblY - pos.y}">${escapeHtml(p.label)}</text>
        <text class="fp-gps hidden" data-gps="${p.id}" text-anchor="middle" y="${pos.lblY - pos.y + 14}">GPS</text>
      </g>`;
  }).join('');
  els.homePhases.innerHTML = `
    <svg class="flight-path" viewBox="0 0 1000 230" preserveAspectRatio="xMidYMid meet" role="radiogroup" aria-label="Phase of flight">
      <line class="fp-ground" x1="0" y1="200" x2="1000" y2="200" />
      <path class="fp-line" d="M30,195 L140,195 Q210,195 280,95 Q380,38 470,38 Q560,38 660,95 Q730,160 790,160 L880,195 L970,195" />
      ${nodes}
    </svg>`;
  els.homePhases.querySelectorAll('.fp-node').forEach((g) => {
    g.addEventListener('click', () => {
      const id = g.getAttribute('data-phase');
      state.selectedPhase = state.selectedPhase === id ? null : id;
      state.phase = id;
      state.manualPhaseUntil = Date.now() + 60000;
      if (state.selectedPhase) {
        for (const sid of [...state.selectedScenarios]) {
          const sc = state.scenarios.find((s) => s.id === sid);
          if (!sc || (sc.phases || []).length && !sc.phases.includes(state.selectedPhase)) {
            state.selectedScenarios.delete(sid);
          }
        }
      }
      renderHomePhases();
      renderHomeScenarios();
      renderHomeResults();
    });
  });
}

// Two-tier scenario rows. Top row = top-level briefings (parentId == null).
// Sub-row appears only when at least one top-level is selected, listing its
// children. Both rows are multi-select; the union becomes the active filter.
function isTopLevel(s) { return !s.parentId; }
function isChildOf(s, parentId) { return s.parentId === parentId; }

function visibleScenarios(filter) {
  return (state.scenarios || []).filter((s) =>
    filter(s) &&
    (!state.selectedPhase || !(s.phases || []).length || s.phases.includes(state.selectedPhase)));
}

function renderHomeScenarios() {
  const tops = visibleScenarios(isTopLevel);
  els.homeScenarios.innerHTML = tops.length
    ? tops.map((s) => chipHtmlForScenario(s)).join('')
    : (state.selectedPhase
        ? `<span class="admin-sub">No briefings linked to this phase — tap ＋ New.</span>`
        : `<span class="admin-sub">No briefings yet — tap ＋ New to add one.</span>`);
  bindScenarioChips(els.homeScenarios);

  // Sub-row: union of children of all selected top-level scenarios.
  const selectedTops = [...state.selectedScenarios].filter((id) => {
    const s = state.scenarios.find((x) => x.id === id);
    return s && isTopLevel(s);
  });
  if (!selectedTops.length) {
    els.homeSubRow.classList.add('hidden');
    els.homeSubScenarios.innerHTML = '';
    // Drop any child selections that no longer have an active parent.
    for (const sid of [...state.selectedScenarios]) {
      const s = state.scenarios.find((x) => x.id === sid);
      if (s && s.parentId) state.selectedScenarios.delete(sid);
    }
  } else {
    els.homeSubRow.classList.remove('hidden');
    const children = visibleScenarios((s) => selectedTops.includes(s.parentId));
    els.homeSubScenarios.innerHTML = children.length
      ? children.map((s) => chipHtmlForScenario(s)).join('')
      : '<span class="admin-sub">No specific briefings under the selected category yet — tap ＋ New.</span>';
    bindScenarioChips(els.homeSubScenarios);
  }
}

function chipHtmlForScenario(s) {
  const on = state.selectedScenarios.has(s.id);
  const color = s.color ? ` style="--c:${escapeHtml(s.color)}"` : '';
  return `<button class="home-chip scenario-chip ${on ? 'on' : ''}"${color} data-id="${escapeHtml(s.id)}">
    <span class="hc-label">${escapeHtml(s.name)}</span>
  </button>`;
}

function bindScenarioChips(root) {
  root.querySelectorAll('.home-chip').forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      if (state.selectedScenarios.has(id)) state.selectedScenarios.delete(id);
      else state.selectedScenarios.add(id);
      renderHomeScenarios();
      renderHomeResults();
    });
  });
}

// New briefing modal --------------------------------------------------------
let bnContext = { parentId: null, forceSub: false };
function openBriefingNewModal({ parentId = null, forceSub = false } = {}) {
  bnContext = { parentId, forceSub };
  els.bnName.value = '';
  els.bnColor.value = '#7aa3ff';
  // Parent dropdown: all top-level scenarios. Hidden when forceSub is false and
  // a parent is locked in; shown for sub-briefing creation.
  const tops = (state.scenarios || []).filter(isTopLevel);
  els.bnParent.innerHTML = '<option value="">(top-level)</option>' +
    tops.map((s) => `<option value="${escapeHtml(s.id)}">${escapeHtml(s.name)}</option>`).join('');
  els.bnParent.value = parentId || '';
  els.bnParentField.classList.toggle('hidden', !forceSub && !tops.length);
  els.bnTitle.textContent = forceSub ? 'New sub-briefing' : 'New briefing';
  // Phases multi-toggle — pre-select the active phase if any.
  els.bnPhases.innerHTML = PHASES.map((p) => {
    const on = state.selectedPhase === p.id;
    return `<button type="button" class="sr-phase ${on ? 'on' : ''}" data-phase="${p.id}">${escapeHtml(p.label)}</button>`;
  }).join('');
  els.bnPhases.querySelectorAll('.sr-phase').forEach((b) => {
    b.addEventListener('click', () => b.classList.toggle('on'));
  });
  els.briefingNewOverlay.classList.remove('hidden');
  setTimeout(() => els.bnName.focus(), 0);
}

async function onCreateBriefing(e) {
  e.preventDefault();
  const name = els.bnName.value.trim();
  if (!name) return;
  const parentId = els.bnParent.value || null;
  const phases = [...els.bnPhases.querySelectorAll('.sr-phase.on')].map((b) => b.getAttribute('data-phase'));
  const sc = {
    id: 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name, parentId, phases,
    color: els.bnColor.value || '#7aa3ff',
    kind: 'normal', sort: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
  };
  await storage.putScenario(sc);
  await reloadScenarios();
  els.briefingNewOverlay.classList.add('hidden');
  // If creating a sub-briefing and the parent isn't already active, activate it
  // so the user sees the new chip immediately on the sub-row.
  if (parentId && !state.selectedScenarios.has(parentId)) state.selectedScenarios.add(parentId);
  renderHomeScenarios(); renderHomeResults();
  if (els.settingsOverlay && !els.settingsOverlay.classList.contains('hidden')) renderSettingsSheet();
  toast(`Created “${name}”${parentId ? ' (sub)' : ''}`);
}

// Legacy entry kept for older callers that may still reference it.
async function quickAddScenario() { openBriefingNewModal({ parentId: null }); }

async function renderHomeResults() {
  const fileIds = activeFileIds();
  const phases = state.selectedPhase ? [state.selectedPhase] : [];
  const scenarios = [...state.selectedScenarios];
  let anchors = [];
  try {
    anchors = await kg.indexedAnchors({
      phases: phases.length ? phases : null,
      scenarios: scenarios.length ? scenarios : null,
      fileIds: fileIds ? fileIds : null,
      query: state.homeQuery || '',
    });
  } catch (e) {
    const all = await kg.allAnchors();
    anchors = all.filter((a) => {
      if (a.kind !== 'idx') return false;
      if (phases.length && !phases.some((p) => (a.phases || []).includes(p))) return false;
      if (scenarios.length && !scenarios.some((s) => (a.scenarios || []).includes(s))) return false;
      if (fileIds && !fileIds.has(a.fileId)) return false;
      if (state.homeQuery) {
        const q = state.homeQuery.toLowerCase();
        const hay = ((a.title || '') + ' ' + (a.excerpt || '')).toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }

  const hasFilters = phases.length || scenarios.length || state.homeQuery;
  if (!anchors.length) {
    els.homeResults.innerHTML = hasFilters
      ? '<li class="home-empty">No indexed paragraphs match. Try other phases/scenarios, or tap “Clear”.</li>'
      : '<li class="home-empty">Nothing indexed yet. Open a file → 📑 Index → tap a paragraph to tag it across phases & scenarios.</li>';
    return;
  }
  els.homeResults.innerHTML = anchors.map((a) => homeResultHtml(a)).join('');
  // Clicks on the inline preview just keep scrolling; the explicit ⤢ button
  // opens the file in the full viewer. The header / excerpt still open it too.
  els.homeResults.querySelectorAll('.home-result').forEach((row) => {
    const anchor = anchors.find((x) => x.anchorId === row.getAttribute('data-anchor'));
    if (!anchor) return;
    row.querySelector('.hr-open')?.addEventListener('click', (e) => {
      e.stopPropagation();
      openAnchorInViewer(anchor);
    });
    row.querySelector('.hr-head')?.addEventListener('click', () => openAnchorInViewer(anchor));
  });
  attachPreviewObserver(els.homeResults, anchors);
}

function homeResultHtml(a) {
  const file = state.files.get(a.fileId);
  const fname = file ? file.name : '(file missing)';
  const phaseTags = (a.phases || []).map(phaseLabel).filter(Boolean).slice(0, 3).join(' · ');
  const scenTags = (a.scenarios || []).map(scenarioLabel).filter(Boolean).slice(0, 3).join(' · ');
  const itemType = a.itemType === 'bookmark' ? 'bookmark' : 'briefing';
  const kindIcon = itemType === 'bookmark' ? '🔖' : '📋';
  return `<li class="home-result" data-anchor="${escapeHtml(a.anchorId)}"
      data-file="${escapeHtml(a.fileId)}" data-page="${a.pageNum}">
    <div class="hr-head">
      <span class="hr-kind kind-${itemType}" title="${itemType}">${kindIcon}</span>
      <span class="hr-file">${escapeHtml(fname)}</span>
      <span class="hr-page">p.${a.pageNum}</span>
      <button class="btn ghost hr-open" data-act="open" title="Open in full viewer">⤢</button>
    </div>
    ${a.excerpt ? `<div class="hr-excerpt">${escapeHtml(a.excerpt.slice(0, 240))}</div>` : ''}
    <div class="hr-preview" data-pending="1">
      <canvas class="hr-canvas"></canvas>
    </div>
    <div class="hr-tags">
      ${phaseTags ? `<span class="hr-tag">✈ ${escapeHtml(phaseTags)}</span>` : ''}
      ${scenTags ? `<span class="hr-tag">✦ ${escapeHtml(scenTags)}</span>` : ''}
    </div>
  </li>`;
}

// Lazy-render the PDF page into each card as it scrolls into view.
let previewObserver = null;
function attachPreviewObserver(container, anchors) {
  if (previewObserver) previewObserver.disconnect();
  previewObserver = new IntersectionObserver(async (entries) => {
    for (const ent of entries) {
      if (!ent.isIntersecting) continue;
      const card = ent.target;
      previewObserver.unobserve(card);
      const fileId = card.getAttribute('data-file');
      const pageNum = +card.getAttribute('data-page');
      const anchor = anchors.find((x) => x.anchorId === card.getAttribute('data-anchor'));
      const canvas = card.querySelector('.hr-canvas');
      const wrap = card.querySelector('.hr-preview');
      try {
        await renderPreview(canvas, fileId, pageNum, {
          maxWidthPx: 480,
          highlightRects: (anchor && anchor.selectionRects) || null,
        });
        wrap.removeAttribute('data-pending');
      } catch (err) {
        wrap.innerHTML = `<div class="hr-preview-err">Preview unavailable (${escapeHtml(err.message || 'error')})</div>`;
      }
    }
  }, { rootMargin: '120px 0px', threshold: 0.01 });
  container.querySelectorAll('.home-result').forEach((card) => previewObserver.observe(card));
}

function phaseLabel(id) { const p = PHASES.find((x) => x.id === id); return p ? p.label : ''; }
function scenarioLabel(id) { const s = (state.scenarios || []).find((x) => x.id === id); return s ? s.name : ''; }

// --- Settings sheet ---------------------------------------------------------
// Single hub the user opens from the cog FAB. Lets them rename / delete /
// re-link scenarios and briefing types, and jump into the library views.

function openSettingsSheet() {
  els.settingsOverlay.classList.remove('hidden');
  renderSettingsSheet();
}

function renderSettingsSheet() {
  // Scenarios — rendered as a tree (top-level + children indented).
  // Each row: name, color, parent (dropdown), phase chips, delete.
  const sList = state.scenarios || [];
  const tops = sList.filter(isTopLevel);
  const orphans = sList.filter((s) => s.parentId && !sList.some((p) => p.id === s.parentId));
  els.settingsScenarios.innerHTML = (sList.length
    ? tops.map((s) => settingsScenarioBlock(s, sList)).join('') +
      (orphans.length ? '<div class="admin-sub" style="margin-top:8px">Orphan sub-briefings (parent missing):</div>' +
        orphans.map((s) => settingsScenarioRow(s, sList)).join('') : '')
    : '<div class="admin-sub">No briefings yet.</div>');

  // Briefing types: editable name + color + delete.
  const bList = state.briefingTypes || [];
  els.settingsBtypes.innerHTML = bList.length ? bList.map((b) => `
    <div class="settings-row" data-id="${escapeHtml(b.id)}" data-kind="btype">
      <input type="text" class="sr-name" value="${escapeHtml(b.name)}" />
      <input type="color" class="sr-color" value="${escapeHtml(b.color || '#7aa3ff')}" title="Color" />
      <button class="btn ghost" data-act="del" title="Delete">🗑</button>
    </div>`).join('') : '<div class="admin-sub">No briefing types yet.</div>';

  // Bind row interactions: name edit (blur saves), phase chip toggle, delete, color change.
  els.settingsScenarios.querySelectorAll('.settings-row').forEach((row) => bindSettingsRow(row, 'scenario'));
  els.settingsBtypes.querySelectorAll('.settings-row').forEach((row) => bindSettingsRow(row, 'btype'));
  els.settingsScenarios.querySelectorAll('.settings-add-child').forEach((btn) => {
    btn.addEventListener('click', () => openBriefingNewModal({ parentId: btn.getAttribute('data-parent'), forceSub: true }));
  });
}

// Render a top-level scenario along with its children indented underneath.
function settingsScenarioBlock(top, all) {
  const children = all.filter((c) => c.parentId === top.id);
  return `<div class="settings-block">
    ${settingsScenarioRow(top, all)}
    <div class="settings-children">
      ${children.map((c) => settingsScenarioRow(c, all)).join('')}
      <button class="btn ghost settings-add-child" data-parent="${escapeHtml(top.id)}" type="button">＋ sub-briefing under “${escapeHtml(top.name)}”</button>
    </div>
  </div>`;
}

function settingsScenarioRow(s, all) {
  const isSub = !!s.parentId;
  const parentOpts = '<option value="">(top-level)</option>' +
    all.filter((p) => !p.parentId && p.id !== s.id)
      .map((p) => `<option value="${escapeHtml(p.id)}" ${p.id === s.parentId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  return `<div class="settings-row ${isSub ? 'is-sub' : ''}" data-id="${escapeHtml(s.id)}" data-kind="scenario">
    <input type="text" class="sr-name" value="${escapeHtml(s.name)}" />
    <input type="color" class="sr-color" value="${escapeHtml(s.color || '#7aa3ff')}" title="Color" />
    <select class="sr-parent" title="Parent briefing">${parentOpts}</select>
    <div class="sr-phases" aria-label="Linked phases">
      ${PHASES.map((p) => `<button type="button" class="sr-phase ${(s.phases || []).includes(p.id) ? 'on' : ''}" data-phase="${p.id}">${escapeHtml(p.label)}</button>`).join('')}
    </div>
    <button class="btn ghost" data-act="del" title="Delete">🗑</button>
  </div>`;
}

function bindSettingsRow(row, kind) {
  const id = row.getAttribute('data-id');
  const nameInput = row.querySelector('.sr-name');
  const saveName = async () => {
    const v = nameInput.value.trim();
    if (!v) { nameInput.value = (kind === 'scenario' ? state.scenarios : state.briefingTypes).find((x) => x.id === id)?.name || ''; return; }
    if (kind === 'scenario') {
      const sc = state.scenarios.find((x) => x.id === id);
      if (!sc || sc.name === v) return;
      sc.name = v; sc.updatedAt = Date.now();
      await storage.putScenario(sc);
      await reloadScenarios();
      renderHomeScenarios();
    } else {
      const bt = state.briefingTypes.find((x) => x.id === id);
      if (!bt || bt.name === v) return;
      bt.name = v; bt.updatedAt = Date.now();
      await storage.putBriefingType(bt);
      state.briefingTypes = await storage.listBriefingTypes();
    }
  };
  nameInput.addEventListener('blur', saveName);
  nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameInput.blur(); } });
  row.querySelectorAll('.sr-phase').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const phaseId = chip.getAttribute('data-phase');
      const sc = state.scenarios.find((x) => x.id === id);
      if (!sc) return;
      sc.phases = sc.phases || [];
      if (sc.phases.includes(phaseId)) sc.phases = sc.phases.filter((p) => p !== phaseId);
      else sc.phases.push(phaseId);
      sc.updatedAt = Date.now();
      await storage.putScenario(sc);
      await reloadScenarios();
      chip.classList.toggle('on');
      renderHomeScenarios();
    });
  });
  const colorInput = row.querySelector('.sr-color');
  if (colorInput) colorInput.addEventListener('change', async () => {
    if (kind === 'scenario') {
      const sc = state.scenarios.find((x) => x.id === id);
      if (!sc) return;
      sc.color = colorInput.value; sc.updatedAt = Date.now();
      await storage.putScenario(sc); await reloadScenarios(); renderHomeScenarios();
    } else {
      const bt = state.briefingTypes.find((x) => x.id === id);
      if (!bt) return;
      bt.color = colorInput.value; bt.updatedAt = Date.now();
      await storage.putBriefingType(bt);
      state.briefingTypes = await storage.listBriefingTypes();
    }
  });
  const parentSel = row.querySelector('.sr-parent');
  if (parentSel) parentSel.addEventListener('change', async () => {
    const sc = state.scenarios.find((x) => x.id === id);
    if (!sc) return;
    sc.parentId = parentSel.value || null; sc.updatedAt = Date.now();
    await storage.putScenario(sc); await reloadScenarios();
    renderSettingsSheet(); renderHomeScenarios();
  });
  const delBtn = row.querySelector('[data-act="del"]');
  delBtn?.addEventListener('click', async () => {
    if (!confirm(`Delete ${kind === 'scenario' ? 'scenario' : 'briefing type'} "${nameInput.value}"?`)) return;
    if (kind === 'scenario') { await storage.deleteScenario(id); await reloadScenarios(); renderHomeScenarios(); }
    else { await storage.deleteBriefingType(id); state.briefingTypes = await storage.listBriefingTypes(); }
    renderSettingsSheet();
  });
}

async function onSettingsAddScenario(e) {
  e.preventDefault();
  const name = els.ssName.value.trim();
  if (!name) return;
  const sc = {
    id: 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name, phases: state.selectedPhase ? [state.selectedPhase] : [],
    kind: 'normal', sort: Date.now(), createdAt: Date.now(),
  };
  await storage.putScenario(sc);
  await reloadScenarios();
  els.ssName.value = '';
  renderSettingsSheet(); renderHomeScenarios();
}

async function onSettingsAddBtype(e) {
  e.preventDefault();
  const name = els.sbName.value.trim();
  if (!name) return;
  const bt = {
    id: 'bt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name, color: els.sbColor.value || '#7aa3ff', sort: Date.now(), createdAt: Date.now(),
  };
  await storage.putBriefingType(bt);
  state.briefingTypes = await storage.listBriefingTypes();
  els.sbName.value = '';
  renderSettingsSheet();
}

// Back-compat shims so existing callers (GPS, scenario-manager close, file
// ingest, etc.) keep working against the rebuilt home view.
function setPhase(phaseId) {
  state.phase = phaseId;
  state.selectedPhase = phaseId;
  renderHomePhases();
  renderHomeScenarios();
  renderHomeResults();
}
function syncPhaseUI() { renderHomePhases(); }
function syncToggleUI() { /* no toggles in the new home view */ }
async function renderBriefing() { renderHomePhases(); renderHomeScenarios(); await renderHomeResults(); }

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

function briefingSectionHtml(r, idx, isScenario) {
  const a = r.anchors;
  return `
    <li class="briefing-section" data-idx="${idx}" aria-expanded="${isScenario ? 'true' : 'false'}"
        ${isScenario ? `data-scenario="${escapeHtml(r.id)}"` : ''}>
      <div class="briefing-section-head">
        <span class="bs-caret">›</span>
        <span class="bs-name">${isScenario ? '✦ ' : ''}${escapeHtml(r.label)}</span>
        <span class="bs-meta">${a.length ? a.length + ' bookmark(s)' : 'empty'}</span>
        ${isScenario ? '<button class="btn ghost" data-act="add" title="Add a bookmark to this scenario">+</button>' : ''}
      </div>
      <ul class="briefing-anchors ${isScenario ? '' : 'hidden'}">
        ${a.length ? a.map(anchorRowHtml).join('') : '<li class="briefing-empty">No bookmarks linked yet.</li>'}
      </ul>
    </li>`;
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

// --- Briefing types (dimension #2 of the 3-D index) -------------------------

async function reloadBriefingTypes() {
  state.briefingTypes = await storage.listBriefingTypes();
}

function openBriefingTypeManager() {
  els.btypeOverlay.classList.remove('hidden');
  renderBriefingTypeManager();
}

function btypeRowHtml(b) {
  return `
    <li class="bt-item" data-id="${escapeHtml(b.id)}">
      <span class="bt-swatch" style="background:${escapeHtml(b.color || '#7aa3ff')}"></span>
      <input class="bt-name-edit" value="${escapeHtml(b.name)}" aria-label="Type name" />
      <input class="bt-color-edit" type="color" value="${escapeHtml(b.color || '#7aa3ff')}" aria-label="Colour" />
      <button class="btn ghost danger" data-act="del" title="Delete type">✕</button>
    </li>`;
}

function renderBriefingTypeManager() {
  const list = [...state.briefingTypes].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  els.btypeBody.innerHTML = `
    <form id="bt-create" class="sc-create" autocomplete="off">
      <input id="bt-name" placeholder="New briefing type — e.g. Normal Ops, Legal, Memory Items" required />
      <input id="bt-color" type="color" value="#7aa3ff" aria-label="Colour" />
      <button class="btn primary" type="submit">Create</button>
    </form>
    <p class="admin-sub">Types are dimensions you can tag any indexed paragraph with (multi-select). Pilot-defined, no fixed set.</p>
    <ul class="bt-list">
      ${list.length ? list.map(btypeRowHtml).join('') : '<li class="vs-empty">No briefing types yet. Create one above.</li>'}
    </ul>`;
  els.btypeBody.querySelector('#bt-create').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('bt-name').value.trim();
    if (!name) return;
    await storage.putBriefingType({
      id: 'bt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name, color: $('bt-color').value, sort: state.briefingTypes.length,
      createdAt: Date.now(),
    });
    await reloadBriefingTypes();
    renderBriefingTypeManager();
  });
  els.btypeBody.querySelectorAll('.bt-item').forEach((li) => {
    const id = li.getAttribute('data-id');
    const bt = state.briefingTypes.find((b) => b.id === id);
    if (!bt) return;
    li.querySelector('.bt-name-edit').addEventListener('change', async (e) => {
      bt.name = e.target.value.trim() || bt.name;
      await storage.putBriefingType(bt);
      await reloadBriefingTypes();
    });
    li.querySelector('.bt-color-edit').addEventListener('change', async (e) => {
      bt.color = e.target.value;
      await storage.putBriefingType(bt);
      await reloadBriefingTypes();
      renderBriefingTypeManager();
    });
    li.querySelector('[data-act="del"]').addEventListener('click', async () => {
      await storage.deleteBriefingType(id);
      await reloadBriefingTypes();
      renderBriefingTypeManager();
    });
  });
}

// --- Scenarios (dimension #3: situations) -----------------------------------

const KIND_LABEL = { normal: 'Normal Ops', nonNormal: 'Non-Normal', briefing: 'Briefing' };

async function reloadScenarios() {
  state.scenarios = await storage.listScenarios();
}

function openScenarioManager() {
  els.scenarioOverlay.classList.remove('hidden');
  renderScenarioManager();
}

function scenarioRowHtml(s) {
  return `
    <li class="sc-item" data-id="${escapeHtml(s.id)}">
      <div class="sc-head">
        <input class="sc-name-edit" value="${escapeHtml(s.name)}" aria-label="Scenario name" />
        <select class="sc-kind-edit" aria-label="Kind">
          <option value="normal" ${s.kind === 'normal' ? 'selected' : ''}>Normal</option>
          <option value="nonNormal" ${s.kind === 'nonNormal' ? 'selected' : ''}>Non-Normal</option>
          <option value="briefing" ${s.kind === 'briefing' ? 'selected' : ''}>Briefing</option>
        </select>
        <button class="btn ghost danger" data-act="del" title="Delete scenario">✕</button>
      </div>
      <div class="sc-phases">
        ${PHASES.map((p) => `<button type="button" class="sc-phase ${(s.phases || []).includes(p.id) ? 'on' : ''}" data-phase="${p.id}">${escapeHtml(p.label)}</button>`).join('')}
      </div>
    </li>`;
}

function renderScenarioManager() {
  const list = [...state.scenarios].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  els.scenarioBody.innerHTML = `
    <form id="sc-create" class="sc-create" autocomplete="off">
      <input id="sc-name" placeholder="New scenario — e.g. Engine Failure, Low-Vis Approach" required />
      <select id="sc-kind">
        <option value="normal">Normal Ops</option>
        <option value="nonNormal">Non-Normal</option>
        <option value="briefing">Briefing</option>
      </select>
      <button class="btn primary" type="submit">Create</button>
    </form>
    <p class="admin-sub">Tap a scenario's phase chips to choose which phases of flight it belongs to.</p>
    <ul class="sc-list">
      ${list.length ? list.map(scenarioRowHtml).join('') : '<li class="vs-empty">No scenarios yet. Create one above.</li>'}
    </ul>`;
  els.scenarioBody.querySelector('#sc-create').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = $('sc-name').value.trim();
    if (!name) return;
    await storage.putScenario({
      id: 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name, kind: $('sc-kind').value, phases: [], createdAt: Date.now(),
    });
    await reloadScenarios();
    renderScenarioManager();
    renderBriefing();
  });
  els.scenarioBody.querySelectorAll('.sc-item').forEach((li) => {
    const id = li.getAttribute('data-id');
    const sc = state.scenarios.find((s) => s.id === id);
    if (!sc) return;
    li.querySelector('.sc-name-edit').addEventListener('change', async (e) => {
      sc.name = e.target.value.trim() || sc.name;
      await storage.putScenario(sc);
      await reloadScenarios(); renderBriefing();
    });
    li.querySelector('.sc-kind-edit').addEventListener('change', async (e) => {
      sc.kind = e.target.value;
      await storage.putScenario(sc);
      await reloadScenarios(); renderBriefing();
    });
    li.querySelector('[data-act="del"]').addEventListener('click', async () => {
      await storage.deleteScenario(id);
      await reloadScenarios();
      renderScenarioManager(); renderBriefing();
    });
    li.querySelectorAll('.sc-phase').forEach((chip) => {
      chip.addEventListener('click', async () => {
        const ph = chip.getAttribute('data-phase');
        sc.phases = sc.phases || [];
        sc.phases = sc.phases.includes(ph) ? sc.phases.filter((x) => x !== ph) : [...sc.phases, ph];
        chip.classList.toggle('on');
        await storage.putScenario(sc);
        await reloadScenarios(); renderBriefing();
      });
    });
  });
}

// --- Indexer (3-D paragraph indexing) ---------------------------------------

function openPageIndexerForActiveTab() {
  const tab = paneTab(state.viewer.focused);
  if (!tab) { toast('Open a document first.'); return; }
  openPageParagraphList(tab.fileId, tab.pageNum);
}

async function openPageParagraphList(fileId, pageNum) {
  const file = state.files.get(fileId);
  els.pageParasTitle.textContent = `Paragraphs — ${file ? file.name : ''} · p.${pageNum}`;
  els.pageParasOverlay.classList.remove('hidden');
  els.pageParasBody.innerHTML = '<div class="admin-sub">Loading…</div>';
  const paras = await paragraphsForPage(fileId, pageNum);
  const allAnchors = await kg.allAnchors();
  const indexedHashes = new Set(
    allAnchors.filter((a) => a.fileId === fileId && a.kind === 'idx' && a.textHash)
      .map((a) => a.textHash));
  els.pageParasBody.innerHTML = paras.length
    ? `<ul class="page-para-list">${paras.map((p, i) => {
        const indexed = indexedHashes.has(paragraphHash(p));
        return `<li class="page-para ${indexed ? 'indexed' : ''}" data-i="${i}">
          <span class="ppl-status">${indexed ? '✓ Indexed' : 'Unindexed'}</span>
          <span class="ppl-text">${escapeHtml(p.slice(0, 320))}</span>
          <button class="btn ${indexed ? 'ghost' : 'primary'}" data-act="idx">${indexed ? 'Re-index' : 'Index'}</button>
        </li>`;
      }).join('')}</ul>`
    : '<div class="admin-sub">No paragraphs found on this page (PDF may be a scan or have no extractable text).</div>';
  els.pageParasBody.querySelectorAll('.page-para').forEach((li) => {
    const i = +li.getAttribute('data-i');
    li.querySelector('[data-act="idx"]').addEventListener('click', () => {
      els.pageParasOverlay.classList.add('hidden');
      openIndexerModal({ fileId, pageNum, paraIndex: i, text: paras[i] });
    });
  });
}

function openIndexerFromSelection(fileId, pageNum, text, rects) {
  if (!text || !text.trim()) { toast('Selection is empty.'); return; }
  openIndexerModal({ fileId, pageNum, text, selectionRects: rects });
}

function openIndexerModal(preset) {
  if (!preset || !preset.fileId || !preset.pageNum) { toast('Missing file/page.'); return; }
  const startText = preset.text || '';
  const startType = preset.itemType || 'briefing';
  els.indexerBody.innerHTML = `
    <div class="field">
      <label>Type</label>
      <div class="itemtype-row" id="ix-itemtype">
        <button type="button" class="itemtype-btn ${startType === 'briefing' ? 'on' : ''}" data-type="briefing">📋 Briefing</button>
        <button type="button" class="itemtype-btn ${startType === 'bookmark' ? 'on' : ''}" data-type="bookmark">🔖 Bookmark</button>
      </div>
    </div>
    <div class="field">
      <label for="ix-text">Excerpt <span class="admin-sub">— page ${preset.pageNum}</span></label>
      <textarea id="ix-text" rows="4">${escapeHtml(startText)}</textarea>
    </div>
    <div class="field">
      <label>Phases of flight</label>
      <div class="dim-chips" id="ix-phases">
        ${PHASES.map((p) => `<button type="button" class="dim-chip" data-id="${p.id}">${escapeHtml(p.label)}</button>`).join('')}
      </div>
    </div>
    <div class="field">
      <label>Briefing types
        <button type="button" class="btn ghost ix-mng" id="ix-mng-bt">Manage…</button>
      </label>
      <div class="dim-chips" id="ix-btypes">
        ${state.briefingTypes.length
          ? state.briefingTypes.map((b) => `<button type="button" class="dim-chip" data-id="${escapeHtml(b.id)}" style="--c:${escapeHtml(b.color || '#7aa3ff')}">${escapeHtml(b.name)}</button>`).join('')
          : '<span class="admin-sub">No briefing types yet — tap Manage to create some.</span>'}
      </div>
    </div>
    <div class="field">
      <label>Situations
        <button type="button" class="btn ghost ix-mng" id="ix-mng-sc">Manage…</button>
      </label>
      <div class="dim-chips" id="ix-situations">
        ${state.scenarios.length
          ? state.scenarios.map((s) => `<button type="button" class="dim-chip" data-id="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button>`).join('')
          : '<span class="admin-sub">No situations yet — tap Manage to create some.</span>'}
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="ix-cancel">Cancel</button>
      <button class="btn primary" id="ix-save">Save</button>
    </div>`;
  els.indexerOverlay.classList.remove('hidden');
  let saving = false;
  const doSave = async () => {
    if (saving) return; saving = true;
    const t = $('ix-text').value.trim() || startText;
    if (!t) { toast('Excerpt required.'); saving = false; return; }
    const phases = [...els.indexerBody.querySelectorAll('#ix-phases .dim-chip.on')].map((c) => c.getAttribute('data-id'));
    const btypes = [...els.indexerBody.querySelectorAll('#ix-btypes .dim-chip.on')].map((c) => c.getAttribute('data-id'));
    const sits   = [...els.indexerBody.querySelectorAll('#ix-situations .dim-chip.on')].map((c) => c.getAttribute('data-id'));
    const itemType = els.indexerBody.querySelector('#ix-itemtype .itemtype-btn.on')?.getAttribute('data-type') || 'briefing';
    const m = state.manuals.get(preset.fileId);
    await storage.putAnchor({
      anchorId: 'idx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      fileId: preset.fileId, manualType: m ? m.manualType : 'PERSONAL',
      kind: 'idx', itemType,
      source: preset.selectionRects ? 'selection' : (preset.paraIndex != null ? 'auto-para' : 'manual'),
      paraIndex: preset.paraIndex ?? null,
      selectionRects: preset.selectionRects || null,
      pageNum: preset.pageNum,
      anchorType: 'page',
      value: 'p.' + preset.pageNum,
      title: t.slice(0, 60),
      excerpt: t.slice(0, 600),
      textHash: paragraphHash(t),
      phases, briefingTypes: btypes, scenarios: sits,
      aiSuggested: null, aiAccepted: false,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
    kg.invalidate(); await kg.load(true);
    els.indexerOverlay.classList.add('hidden');
    renderBriefing();
    toast(`Indexed (${phases.length}p · ${btypes.length}b · ${sits.length}s)`);
    saving = false;
  };
  const onBodyClick = (e) => {
    const chip = e.target.closest('.dim-chip');
    if (chip && els.indexerBody.contains(chip)) { chip.classList.toggle('on'); return; }
    const tbtn = e.target.closest('.itemtype-btn');
    if (tbtn && els.indexerBody.contains(tbtn)) {
      els.indexerBody.querySelectorAll('.itemtype-btn').forEach((b) => b.classList.toggle('on', b === tbtn));
      return;
    }
    if (e.target.id === 'ix-mng-bt') { els.indexerOverlay.classList.add('hidden'); openBriefingTypeManager(); return; }
    if (e.target.id === 'ix-mng-sc') { els.indexerOverlay.classList.add('hidden'); openScenarioManager(); return; }
    if (e.target.id === 'ix-cancel') { els.indexerOverlay.classList.add('hidden'); return; }
    if (e.target.id === 'ix-save') { doSave(); return; }
  };
  if (els.indexerBody._handler) els.indexerBody.removeEventListener('click', els.indexerBody._handler);
  els.indexerBody._handler = onBodyClick;
  els.indexerBody.addEventListener('click', onBodyClick);
}

// "Bookmark this page" — opens the modal pre-filled from the focused pane.
function openBookmarkFromViewer() {
  const tab = paneTab(state.viewer.focused);
  if (!tab) return;
  openBookmarkModal({ fileId: tab.fileId, pageNum: tab.pageNum, phase: state.phase, toggle: state.toggle });
}

// Bookmark a text selection — pre-fills the excerpt.
function openBookmarkSelection(fileId, pageNum, text) {
  openBookmarkModal({ fileId, pageNum, excerpt: text, phase: state.phase, toggle: state.toggle });
}

// Create a bookmark, optionally linking a paragraph and placing it into a
// phase briefing (phase + status). Openable from the phase page or the PDF.
function openBookmarkModal(preset = {}) {
  const files = [...state.files.values()];
  if (!files.length) { toast('Add a document first.'); return; }
  let chosenExcerpt = preset.excerpt || '';
  els.bookmarkBody.innerHTML = `
    <div class="field">
      <label for="bm-file">Document</label>
      <select id="bm-file">${files.map((f) =>
        `<option value="${escapeHtml(f.id)}" ${f.id === preset.fileId ? 'selected' : ''}>${escapeHtml(f.name)}</option>`).join('')}</select>
    </div>
    <div class="field"><label for="bm-page">Page</label>
      <input type="text" id="bm-page" inputmode="numeric" value="${preset.pageNum || ''}" placeholder="Page number" /></div>
    <div class="field"><label for="bm-title">Title</label>
      <input type="text" id="bm-title" placeholder="Short description" value="${escapeHtml((preset.excerpt || '').slice(0, 60))}" /></div>
    <div class="field"><label for="bm-ref">Reference / ID (optional)</label>
      <input type="text" id="bm-ref" placeholder="e.g. 13.20.3, 36-09 — defaults to the page" /></div>
    <div class="field">
      <label>Link to scenario(s)</label>
      <div class="sc-checks" id="bm-scenarios">
        ${state.scenarios.length
          ? state.scenarios.map((s) => `<label><input type="checkbox" value="${escapeHtml(s.id)}" ${(preset.scenarioIds || []).includes(s.id) ? 'checked' : ''}/> ${escapeHtml(s.name)} <span class="sc-tag">${escapeHtml(KIND_LABEL[s.kind] || s.kind)}</span></label>`).join('')
          : '<span class="admin-sub">No scenarios yet — create them with “✦ Scenarios” on the phase page.</span>'}
      </div>
    </div>
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
    if (!fileId || !Number.isFinite(pg)) { toast('Document and page are required.'); return; }
    const ref = $('bm-ref').value.trim() || ('p.' + pg);
    const title = $('bm-title').value.trim() || ref;
    const m = state.manuals.get(fileId);
    const manualType = m ? m.manualType : 'PERSONAL';
    const anchorType = anchorTypeFor(manualType);
    const scenarios = [...els.bookmarkBody.querySelectorAll('#bm-scenarios input:checked')].map((c) => c.value);
    await storage.putAnchor({
      anchorId: `${fileId}:m_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      fileId, manualType, anchorType, value: ref, title,
      pageNum: pg, source: 'manual', confidence: null,
      excerpt: chosenExcerpt.slice(0, 260), scenarios,
    });
    kg.invalidate(); await kg.load(true);
    els.bookmarkOverlay.classList.add('hidden');
    renderBriefing();
    if (viewerVisible() && !els.viewerSidebar.classList.contains('hidden')) renderSidebar();
    toast(scenarios.length ? `Bookmark linked to ${scenarios.length} scenario(s).` : 'Bookmark added.');
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
      onBookmarkSelection: (pageNum, text) => openBookmarkSelection(tab.fileId, pageNum, text),
      onIndexSelection: (pageNum, text, rects) => openIndexerFromSelection(tab.fileId, pageNum, text, rects),
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

// A short snippet of `text` centred on the first query term.
function searchSnippet(text, query) {
  const clean = (text || '').replace(/\s+/g, ' ').trim();
  const terms = query.toLowerCase().match(/[a-z0-9֐-׿]+/g) || [];
  const lower = clean.toLowerCase();
  let idx = -1;
  for (const t of terms) {
    const i = lower.indexOf(t);
    if (i >= 0 && (idx < 0 || i < idx)) idx = i;
  }
  if (idx < 0) return clean.slice(0, 170);
  const start = Math.max(0, idx - 60);
  const end = Math.min(clean.length, idx + 150);
  return (start > 0 ? '… ' : '') + clean.slice(start, end).trim() + (end < clean.length ? ' …' : '');
}

// Full-text results: every matching page gets its own snippet glimpse,
// grouped by document so multiple hits in one book are easy to scan.
function runFullTextSearch(query) {
  if (!state.files.size) { els.answerPanel.classList.add('hidden'); return; }
  const hits = searchMod.search(query, { limit: 30 });
  if (!hits.length) { els.answerPanel.classList.add('hidden'); return; }
  const byFile = new Map();
  for (const h of hits) {
    if (!byFile.has(h.fileId)) byFile.set(h.fileId, { fileName: h.fileName, pages: [] });
    byFile.get(h.fileId).pages.push(h);
  }
  els.answerPanel.classList.remove('hidden');
  els.answerPanel.innerHTML = [...byFile.entries()].map(([fileId, g]) => `
    <article class="answer-section">
      <header class="answer-section-head">
        <span class="answer-section-name">${escapeHtml(g.fileName)}</span>
        <span>${g.pages.length} match${g.pages.length > 1 ? 'es' : ''}</span>
      </header>
      ${g.pages.map((h) => `
        <div class="glimpse" data-file="${escapeHtml(fileId)}" data-page="${h.pageNum}">
          <span class="glimpse-pg">p.${h.pageNum}</span>
          <span class="glimpse-text">${escapeHtml(searchSnippet(h.text, query))}</span>
        </div>`).join('')}
    </article>`).join('');
  els.answerPanel.querySelectorAll('.glimpse').forEach((g) => {
    g.addEventListener('click', () =>
      openFileInViewer(g.getAttribute('data-file'), +g.getAttribute('data-page'), { query }));
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
  els.homePhases.querySelectorAll('[data-gps]').forEach((el) =>
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
