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
  searchToolsToggle: $('search-tools-toggle'),
  searchScopePanel: $('search-scope-panel'), searchScopeList: $('search-scope-list'),
  homePhases: $('home-phases'),
  homeBtypes: $('home-btypes'), homeAddBtype: $('home-add-btype'),
  homeScenarios: $('home-scenarios'), homeAddScenario: $('home-add-scenario'),
  homeSubRow: $('home-sub-row'),
  homeSubScenarios: $('home-sub-scenarios'), homeAddSub: $('home-add-sub'),
  homeResults: $('home-results'),
  homeSettings: $('header-settings'),
  manageOverlay: $('manage-overlay'), manageClose: $('manage-close'),
  manageTitle: $('manage-title'), manageList: $('manage-list'),
  manageAddBtn: $('manage-add-btn'),
  btypeNewOverlay: $('btype-new-overlay'), btnClose: $('btn-close'),
  btnForm: $('btn-form'), btnName: $('btn-name'),
  btnColor: $('btn-color'), btnCancel: $('btn-cancel'),
  briefingNewOverlay: $('briefing-new-overlay'), bnClose: $('bn-close'),
  bnForm: $('bn-form'), bnTitle: $('bn-title'), bnName: $('bn-name'),
  bnParent: $('bn-parent'), bnParentField: $('bn-parent-field'),
  bnParents: $('bn-parents'),
  bnPhases: $('bn-phases'), bnPhasesField: $('bn-phases-field'),
  bnBtypes: $('bn-btypes'), bnBtypesField: $('bn-btypes-field'),
  bnColor: $('bn-color'), bnCancel: $('bn-cancel'),
  settingsOverlay: $('settings-overlay'), settingsClose: $('settings-close'),
  settingsScenarios: $('settings-scenarios'), settingsBtypes: $('settings-btypes'),
  settingsScenarioNew: $('settings-scenario-new'), ssName: $('ss-name'),
  settingsBtypeNew: $('settings-btype-new'), sbName: $('sb-name'), sbColor: $('sb-color'),
  settingsLibrary: $('settings-library'),
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
  viewerZoomIn: $('viewer-zoom-in'), viewerZoomOut: $('viewer-zoom-out'),
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
  // Home filters: every level is single-select. The sub-briefing takes
  // precedence over the top-level briefing when both are picked — the user
  // sees only what's relevant to the most specific scope.
  selectedPhase: null,
  selectedBtype: null,
  selectedTopBriefing: null,
  selectedSubBriefing: null,
  homeQuery: '',
  // Search scope: which slices of the library the user wants to look in.
  // Briefings (= scenario names) are on by default; the file categories are
  // off so the result list isn't immediately flooded by every page.
  searchBriefingsOn: true,
  searchDocTypes: new Set(),  // 'manual' | 'personal' | 'fleet-update'
  searchFileScope: new Set(), // overrides per-file even when category is off
  gpsAuto: false,
  manualPhaseUntil: 0,
  viewer: { tabs: [], panes: [], focused: 0, split: false },
  markup: { on: false, tool: 'highlight', color: '#ffcc00', width: 0.012 },
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

  // Seed the briefing-types row on first launch with the three categories
  // every pilot starts from: Normal / Non-Normal / Briefing.
  if (!state.briefingTypes.length) {
    const defaults = [
      { id: 'bt_default_normal',    name: 'Normal Operation',     color: '#3ddc97', sort: 1 },
      { id: 'bt_default_nonnormal', name: 'Non-Normal Operation', color: '#ff6b6b', sort: 2 },
      { id: 'bt_default_briefing',  name: 'Briefing',             color: '#7aa3ff', sort: 3 },
    ];
    for (const bt of defaults) await storage.putBriefingType({ ...bt, createdAt: Date.now() });
    state.briefingTypes = await storage.listBriefingTypes();
  }

  // First-launch demo content: ship the Tanchum 737 upgrade book + its
  // briefing tree so the app isn't empty on a fresh install. Only runs
  // when storage has no files at all (i.e. truly first launch).
  if (!state.files.size && !state.scenarios.length) {
    try { await loadBundledTanchumOnce(); } catch (e) { console.warn('bundled seed skipped:', e); }
  }

  await searchMod.rebuildIndex(state.files);
  await kg.load(true);
  await refreshNoteCounts();

  renderHomePhases();
  renderHomeBtypes();
  renderHomeScenarios();
  renderTailSelect();
  renderTails();
  renderLibrary();
  renderStorageInfo();
  await renderHomeResults();
  restoreViewerState(savedViewer);
  renderTabDock();

  wireEvents();
  installModalScrollLock();
  installViewerPinchZoom();
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
    state.selectedPhase = null; state.selectedBtype = null;
    state.selectedTopBriefing = null; state.selectedSubBriefing = null;
    state.homeQuery = ''; els.homeSearch.value = '';
    state.searchFileScope.clear();
    state.searchDocTypes.clear();
    state.searchBriefingsOn = true;
    renderHomePhases(); renderHomeBtypes(); renderHomeScenarios(); renderHomeResults();
  });
  els.searchToolsToggle.addEventListener('click', toggleSearchScopePanel);
  els.homeAddBtype.addEventListener('click', () => openManageOverlay('btype'));
  els.homeAddScenario.addEventListener('click', () => openManageOverlay('top'));
  els.homeAddSub.addEventListener('click', () => openManageOverlay('sub'));
  els.manageClose.addEventListener('click', () => els.manageOverlay.classList.add('hidden'));
  els.manageOverlay.addEventListener('click', (e) => { if (e.target === els.manageOverlay) els.manageOverlay.classList.add('hidden'); });
  els.bnClose.addEventListener('click', () => els.briefingNewOverlay.classList.add('hidden'));
  els.bnCancel.addEventListener('click', () => els.briefingNewOverlay.classList.add('hidden'));
  els.briefingNewOverlay.addEventListener('click', (e) => { if (e.target === els.briefingNewOverlay) els.briefingNewOverlay.classList.add('hidden'); });
  els.bnForm.addEventListener('submit', onCreateBriefing);
  els.btnClose.addEventListener('click', () => els.btypeNewOverlay.classList.add('hidden'));
  els.btnCancel.addEventListener('click', () => els.btypeNewOverlay.classList.add('hidden'));
  els.btypeNewOverlay.addEventListener('click', (e) => { if (e.target === els.btypeNewOverlay) els.btypeNewOverlay.classList.add('hidden'); });
  els.btnForm.addEventListener('submit', onCreateBtype);
  // (no add-file FAB on the home view — files are added from ⚙ Settings → Library)
  els.homeSettings.addEventListener('click', openSettingsSheet);
  els.settingsClose.addEventListener('click', () => els.settingsOverlay.classList.add('hidden'));
  $('settings-reset-briefings')?.addEventListener('click', resetToCuratedBriefings);
  $('settings-apply')?.addEventListener('click', () => {
    // Force a full home re-render so any colour / order / link change is
    // reflected immediately, then close.
    renderHomePhases(); renderHomeBtypes(); renderHomeScenarios(); renderHomeResults();
    els.settingsOverlay.classList.add('hidden');
    toast('Changes applied.');
  });
  els.settingsOverlay.addEventListener('click', (e) => { if (e.target === els.settingsOverlay) els.settingsOverlay.classList.add('hidden'); });
  els.settingsScenarioNew.addEventListener('submit', onSettingsAddScenario);
  els.settingsBtypeNew.addEventListener('submit', onSettingsAddBtype);
  // (Add buttons live per-category inside renderSettingsLibrary)
  els.scenarioClose.addEventListener('click', () => els.scenarioOverlay.classList.add('hidden'));
  els.scenarioOverlay.addEventListener('click', (e) => { if (e.target === els.scenarioOverlay) els.scenarioOverlay.classList.add('hidden'); });
  els.btypeClose.addEventListener('click', () => els.btypeOverlay.classList.add('hidden'));
  els.btypeOverlay.addEventListener('click', (e) => { if (e.target === els.btypeOverlay) els.btypeOverlay.classList.add('hidden'); });

  els.searchForm.addEventListener('submit', (e) => { e.preventDefault(); runJumpSearch(els.searchInput.value.trim()); });

  els.viewerClose.addEventListener('click', minimizeViewer);
  els.viewerZoomIn?.addEventListener('click', () => applyViewerZoom(+0.2));
  els.viewerZoomOut?.addEventListener('click', () => applyViewerZoom(-0.2));
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

// Modal background-scroll control. Setting body { position: fixed } turned
// out to break the modal-body's own overflow scroll on iPad Safari, so we
// now just toggle the .modal-open class on <html> and let the CSS decide:
//   - touch-action: none on the backdrop blocks touch-scrolling the page
//   - touch-action: pan-y on .modal-body still allows the modal to scroll
let _modalOpenCount = 0;
function installModalScrollLock() {
  const overlays = document.querySelectorAll('.modal-overlay');
  const update = () => {
    document.documentElement.classList.toggle('modal-open', _modalOpenCount > 0);
  };
  const obs = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.attributeName !== 'class') continue;
      const open = !m.target.classList.contains('hidden');
      const wasOpen = m.oldValue == null ? false : !m.oldValue.includes('hidden');
      if (open && !wasOpen) _modalOpenCount++;
      else if (!open && wasOpen) _modalOpenCount = Math.max(0, _modalOpenCount - 1);
    }
    update();
  });
  overlays.forEach((ov) => {
    obs.observe(ov, { attributes: true, attributeFilter: ['class'], attributeOldValue: true });
    if (!ov.classList.contains('hidden')) _modalOpenCount++;
  });
  update();
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

// Single smooth S-curve flight strip, matching the EFB reference photo:
// flat-low across the departure side, smooth rise into a cruise plateau,
// smooth fall back down, flat-low across the arrival side. No zone boxes.
const STRIP_VB_W = 1000;
const STRIP_VB_H = 110;

const FLAT_Y     = 80;   // ground-ops dot y (flat segments)
const CRUISE_Y   = 25;   // plateau dot y
const RISE_Y     = 52;   // mid-climb / mid-descent y (lies on the S-curve)

// Phase positions are chosen so each dot lies exactly on the line below.
// The line uses cubic beziers whose midpoint at t=0.5 happens to be the
// climb / descent x,y — see flightProfilePath() for the math.
const PHASE_PROFILE = {
  dispatch:     { x:  60, y: FLAT_Y },
  takeoff:      { x: 200, y: FLAT_Y },
  climb:        { x: 350, y: RISE_Y },
  cruise:       { x: 500, y: CRUISE_Y },
  descent:      { x: 650, y: RISE_Y },
  approach:     { x: 775, y: FLAT_Y },
  landing:      { x: 870, y: FLAT_Y },
  afterLanding: { x: 970, y: FLAT_Y },
};
function phasePos(idOrIdx) {
  const id = typeof idOrIdx === 'number' ? PHASES[idOrIdx].id : idOrIdx;
  return PHASE_PROFILE[id] || { x: 500, y: 50 };
}
function phaseXAt(idx) { return phasePos(idx).x; }

function nearestPhaseFromX(x) {
  let best = 0, bestDist = Infinity;
  PHASES.forEach((_, i) => {
    const d = Math.abs(phaseXAt(i) - x);
    if (d < bestDist) { bestDist = d; best = i; }
  });
  return PHASES[best];
}

// Single S-curve: flat-low to (280,80), smooth cubic rise to the cruise
// plateau (420→580 at y=25), smooth cubic descent, flat-low to (970,80).
// The cubic bezier midpoints at t=0.5 land exactly on (350,52) and
// (650,52), which is where Climb and Descent dots sit.
function flightProfilePath() {
  return [
    'M 30 80',
    'L 280 80',
    'C 320 80, 380 25, 420 25',
    'L 580 25',
    'C 620 25, 680 80, 720 80',
    'L 970 80',
  ].join(' ');
}

// Clean top-down airliner silhouette (single symmetric path), nose-right,
// sitting on a dark circular plate with a thin accent ring.
const PLANE_SVG = `
  <g class="fp-plane-glyph">
    <circle class="fp-plane-bg" r="14" />
    <circle class="fp-plane-ring" r="14" fill="none" />
    <path class="fp-plane-shape" d="
      M 12 0
      L 4 -1.4 L 1 -1.4 L -3 -8 L -5 -8 L -2 -1.4 L -7 -1.4
      L -9 -4 L -10.5 -4 L -9.5 -1.4 L -12 -0.5 L -12 0.5 L -9.5 1.4
      L -10.5 4 L -9 4 L -7 1.4 L -2 1.4 L -5 8 L -3 8 L 1 1.4 L 4 1.4
      Z" />
  </g>`;

function renderHomePhases() {
  const hasActive = state.selectedPhase != null;
  const activeIdx = hasActive ? PHASES.findIndex((p) => p.id === state.selectedPhase) : -1;
  const ticks = PHASES.map((p, i) => {
    const pos = phasePos(i);
    const on = i === activeIdx;
    const passed = hasActive && i < activeIdx;
    return `
      <g class="fp-tick ${on ? 'on' : ''} ${passed ? 'passed' : ''}" data-phase="${p.id}" transform="translate(${pos.x} ${pos.y})">
        <circle class="fp-hit" r="22" />
        <circle class="fp-dot" r="${on ? 6 : 4.5}" />
        <text class="fp-label" text-anchor="middle" y="22">${escapeHtml(p.label)}</text>
        <text class="fp-gps hidden" data-gps="${p.id}" text-anchor="middle" y="34">GPS</text>
      </g>`;
  }).join('');
  const planePos = hasActive ? phasePos(activeIdx) : phasePos(0);
  // Plane sits centred on the active phase's dot — the airplane glyph IS
  // the current-phase marker.
  els.homePhases.innerHTML = `
    <svg class="flight-strip" viewBox="0 0 ${STRIP_VB_W} ${STRIP_VB_H}" preserveAspectRatio="xMidYMid meet" role="radiogroup" aria-label="Phase of flight">
      <path class="fp-line" d="${flightProfilePath()}" />
      ${ticks}
      <g class="fp-plane ${hasActive ? '' : 'inactive'}" transform="translate(${planePos.x} ${planePos.y})">
        <title>Drag to change phase</title>
        ${PLANE_SVG}
      </g>
    </svg>`;
  els.homePhases.querySelectorAll('.fp-tick').forEach((g) => {
    g.addEventListener('click', () => selectPhaseById(g.getAttribute('data-phase')));
  });
  initPlaneDrag(els.homePhases.querySelector('.fp-plane'));
}

function selectPhaseById(id) {
  state.selectedPhase = state.selectedPhase === id ? null : id;
  state.phase = id;
  state.manualPhaseUntil = Date.now() + 60000;
  // If the active top-level briefing no longer matches this phase, drop it
  // (and any sub-briefing under it).
  if (state.selectedPhase && state.selectedTopBriefing) {
    const top = state.scenarios.find((s) => s.id === state.selectedTopBriefing);
    const phs = top?.phases || [];
    if (phs.length && !phs.includes(state.selectedPhase)) {
      state.selectedTopBriefing = null;
      state.selectedSubBriefing = null;
    }
  }
  renderHomePhases();
  renderHomeScenarios();
  renderHomeResults();
}

function initPlaneDrag(planeEl) {
  if (!planeEl) return;
  const svg = els.homePhases.querySelector('.flight-strip');
  let dragging = false;
  const xFromEvent = (e) => {
    const rect = svg.getBoundingClientRect();
    const cx = (e.touches ? e.touches[0].clientX : e.clientX) - rect.left;
    return (cx / rect.width) * STRIP_VB_W;
  };
  const onMove = (e) => {
    if (!dragging) return;
    e.preventDefault();
    const x = Math.max(0, Math.min(STRIP_VB_W, xFromEvent(e)));
    // Plane rides the profile curve: take the y of the nearest phase node so
    // dragging feels like sliding along the path.
    const near = nearestPhaseFromX(x);
    const y = phasePos(near.id).y;
    planeEl.setAttribute('transform', `translate(${x} ${y})`);
    els.homePhases.querySelectorAll('.fp-tick').forEach((g) =>
      g.classList.toggle('drag-hover', g.getAttribute('data-phase') === near.id));
  };
  const onUp = (e) => {
    if (!dragging) return;
    dragging = false;
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
    const x = Math.max(0, Math.min(STRIP_VB_W, xFromEvent(e)));
    const near = nearestPhaseFromX(x);
    // Force-select (not toggle) the snapped phase.
    state.selectedPhase = near.id; state.phase = near.id;
    state.manualPhaseUntil = Date.now() + 60000;
    renderHomePhases(); renderHomeScenarios(); renderHomeResults();
  };
  planeEl.addEventListener('pointerdown', (e) => {
    e.preventDefault(); dragging = true;
    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
  });
}

// Briefing-types row — always shown. Single-select.
function renderHomeBtypes() {
  const list = (state.briefingTypes || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
  els.homeBtypes.innerHTML = list.length
    ? list.map((b) => {
        const on = state.selectedBtype === b.id;
        const c = b.color ? ` style="--c:${escapeHtml(b.color)}"` : '';
        return `<button class="home-chip btype-chip ${on ? 'on' : ''}"${c} data-id="${escapeHtml(b.id)}">
          <span class="hc-label">${escapeHtml(b.name)}</span>
        </button>`;
      }).join('')
    : '<span class="admin-sub">No briefing types yet — tap ＋ to add one (e.g. Normal Ops, Memory Items).</span>';
  els.homeBtypes.querySelectorAll('.home-chip').forEach((btn) => {
    bindChipLongPress(btn, 'btype');
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      state.selectedBtype = state.selectedBtype === id ? null : id;
      // If the active top-level briefing no longer matches this type, drop
      // the selection (and any sub under it).
      if (state.selectedBtype && state.selectedTopBriefing) {
        const top = state.scenarios.find((s) => s.id === state.selectedTopBriefing);
        const types = top?.briefingTypes || [];
        if (types.length && !types.includes(state.selectedBtype)) {
          state.selectedTopBriefing = null;
          state.selectedSubBriefing = null;
        }
      }
      renderHomeBtypes(); renderHomeScenarios(); renderHomeResults();
    });
  });
}

// "Manage [level]" overlay opened from each ＋ button. Lists every item at
// that level with inline rename / color / re-parent / reorder / delete,
// plus an "＋ Add new" button at the top. One unified UI for everything
// the ＋ used to imply.
function openManageOverlay(kind /* 'btype' | 'top' | 'sub' */) {
  const config = {
    btype: { title: 'Briefing types', open: openBtypeNewModal },
    top:   { title: 'Briefings',      open: () => openBriefingNewModal({ parentId: null }) },
    sub:   { title: 'Sub-briefings',  open: () => openBriefingNewModal({ parentId: state.selectedTopBriefing || null, forceSub: true }) },
  }[kind];
  els.manageTitle.textContent = config.title;
  els.manageAddBtn.onclick = () => { els.manageOverlay.classList.add('hidden'); config.open(); };
  renderManageList(kind);
  els.manageOverlay.classList.remove('hidden');
}

function renderManageList(kind) {
  const allTops = (state.scenarios || []).filter(isTopLevel).sort((a, b) => (a.sort || 0) - (b.sort || 0));
  let items;
  if (kind === 'btype') items = (state.briefingTypes || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
  else if (kind === 'top') items = allTops;
  else {
    const parentId = state.selectedTopBriefing;
    items = (state.scenarios || [])
      .filter((s) => !isTopLevel(s) && (!parentId || scenarioParents(s).includes(parentId)))
      .sort((a, b) => (a.sort || 0) - (b.sort || 0));
  }
  if (!items.length) {
    els.manageList.innerHTML = '<div class="admin-sub manage-empty">— nothing here yet —</div>';
    return;
  }
  els.manageList.innerHTML = items.map((it) => `
    <div class="manage-row" data-id="${escapeHtml(it.id)}">
      <input type="text" class="mr-name" value="${escapeHtml(it.name)}" />
      <input type="color" class="mr-color" value="${escapeHtml(it.color || '#7aa3ff')}" title="Colour" />
      ${kind === 'sub' ? `
        <select class="mr-parent" title="Parent briefing">
          ${allTops.map((p) => `<option value="${escapeHtml(p.id)}" ${scenarioParents(it).includes(p.id) ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
        </select>
      ` : ''}
      <button class="btn ghost mr-act" data-act="up" title="Move up">▲</button>
      <button class="btn ghost mr-act" data-act="down" title="Move down">▼</button>
      <button class="btn ghost mr-act danger" data-act="del" title="Delete">🗑</button>
    </div>
  `).join('');
  els.manageList.querySelectorAll('.manage-row').forEach((row) => bindManageRow(row, kind));
}

function bindManageRow(row, kind) {
  const id = row.getAttribute('data-id');
  const get = () => kind === 'btype'
    ? state.briefingTypes.find((x) => x.id === id)
    : state.scenarios.find((x) => x.id === id);
  const name = row.querySelector('.mr-name');
  name.addEventListener('blur', async () => {
    const it = get(); if (!it) return;
    const v = name.value.trim();
    if (!v || v === it.name) { name.value = it.name; return; }
    it.name = v; it.updatedAt = Date.now();
    await saveItem(it, kind === 'btype' ? 'btype' : 'briefing');
  });
  name.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } });
  row.querySelector('.mr-color').addEventListener('change', async (e) => {
    const it = get(); if (!it) return;
    it.color = e.target.value; it.updatedAt = Date.now();
    await saveItem(it, kind === 'btype' ? 'btype' : 'briefing');
    renderManageList(kind);
  });
  row.querySelector('.mr-parent')?.addEventListener('change', async (e) => {
    const it = get(); if (!it) return;
    it.parentIds = [e.target.value]; it.parentId = null;
    it.updatedAt = Date.now();
    await saveItem(it, 'briefing');
    renderManageList(kind);
  });
  row.querySelector('[data-act="up"]').addEventListener('click', async () => {
    const it = get(); if (!it) return;
    await reorderItem(it, kind === 'btype' ? 'btype' : 'briefing', -1);
    renderManageList(kind);
  });
  row.querySelector('[data-act="down"]').addEventListener('click', async () => {
    const it = get(); if (!it) return;
    await reorderItem(it, kind === 'btype' ? 'btype' : 'briefing', 1);
    renderManageList(kind);
  });
  row.querySelector('[data-act="del"]').addEventListener('click', async () => {
    const it = get(); if (!it) return;
    if (!confirm(`Delete "${it.name}"?`)) return;
    await deleteItem(it, kind === 'btype' ? 'btype' : 'briefing');
    renderManageList(kind);
  });
}

function openBtypeNewModal() {
  els.btnName.value = '';
  els.btnColor.value = '#7aa3ff';
  els.btypeNewOverlay.classList.remove('hidden');
  setTimeout(() => els.btnName.focus(), 0);
}

async function onCreateBtype(e) {
  e.preventDefault();
  const name = els.btnName.value.trim();
  if (!name) return;
  const bt = {
    id: 'bt_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name, color: els.btnColor.value || '#7aa3ff',
    sort: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
  };
  await storage.putBriefingType(bt);
  state.briefingTypes = await storage.listBriefingTypes();
  els.btypeNewOverlay.classList.add('hidden');
  renderHomeBtypes();
  if (els.settingsOverlay && !els.settingsOverlay.classList.contains('hidden')) renderSettingsSheet();
  toast(`Created "${name}"`);
}

// Two-tier scenario rows. Top row = top-level briefings (no parents).
// Sub-row appears only when at least one top-level is selected, listing
// children of selected tops. Tops filter by phase + briefing type; subs
// inherit their connection through the parent and do NOT filter by phase.
function scenarioParents(s) {
  return s.parentIds && s.parentIds.length ? s.parentIds : (s.parentId ? [s.parentId] : []);
}
function isTopLevel(s) { return scenarioParents(s).length === 0; }
function isChildOf(s, parentId) { return scenarioParents(s).includes(parentId); }

function visibleTopLevelBriefings() {
  return (state.scenarios || []).filter((s) => {
    if (!isTopLevel(s)) return false;
    if (state.selectedPhase) {
      const phases = s.phases || [];
      if (phases.length && !phases.includes(state.selectedPhase)) return false;
    }
    if (state.selectedBtype) {
      const types = s.briefingTypes || [];
      if (types.length && !types.includes(state.selectedBtype)) return false;
    }
    return true;
  }).sort((a, b) => (a.sort || 0) - (b.sort || 0));
}

function renderHomeScenarios() {
  const tops = visibleTopLevelBriefings();
  els.homeScenarios.innerHTML = tops.length
    ? tops.map((s) => chipHtmlForScenario(s, state.selectedTopBriefing === s.id)).join('')
    : `<span class="admin-sub">No briefings match — tap ＋ New, or adjust the phase / type filter.</span>`;
  bindTopBriefingChips(els.homeScenarios);

  // Sub-row only when a top-level briefing is selected.
  const topId = state.selectedTopBriefing;
  const top = topId ? state.scenarios.find((s) => s.id === topId) : null;
  if (!top) {
    els.homeSubRow.classList.add('hidden');
    els.homeSubScenarios.innerHTML = '';
    state.selectedSubBriefing = null;
  } else {
    els.homeSubRow.classList.remove('hidden');
    const children = (state.scenarios || [])
      .filter((s) => !isTopLevel(s) && scenarioParents(s).includes(topId))
      .sort((a, b) => (a.sort || 0) - (b.sort || 0));
    // Drop sub-selection if the active top changed and it no longer exists.
    if (state.selectedSubBriefing && !children.some((c) => c.id === state.selectedSubBriefing)) {
      state.selectedSubBriefing = null;
    }
    els.homeSubScenarios.innerHTML = children.length
      ? children.map((s) => chipHtmlForScenario(s, state.selectedSubBriefing === s.id)).join('')
      : '<span class="admin-sub">No sub-briefings linked yet — tap ＋ New.</span>';
    bindSubBriefingChips(els.homeSubScenarios);
  }
}

function chipHtmlForScenario(s, on = false) {
  const color = s.color ? ` style="--c:${escapeHtml(s.color)}"` : '';
  const levelClass = isTopLevel(s) ? 'top-chip' : 'sub-chip';
  return `<button class="home-chip scenario-chip ${levelClass} ${on ? 'on' : ''}"${color} data-id="${escapeHtml(s.id)}">
    <span class="hc-label">${escapeHtml(s.name)}</span>
  </button>`;
}

// Single-select binding for top-level briefings.
function bindTopBriefingChips(root) {
  root.querySelectorAll('.home-chip').forEach((btn) => {
    bindChipLongPress(btn, 'briefing');
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      state.selectedTopBriefing = state.selectedTopBriefing === id ? null : id;
      state.selectedSubBriefing = null;
      renderHomeScenarios();
      renderHomeResults();
    });
  });
}

// Single-select binding for sub-briefings.
function bindSubBriefingChips(root) {
  root.querySelectorAll('.home-chip').forEach((btn) => {
    bindChipLongPress(btn, 'briefing');
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-id');
      state.selectedSubBriefing = state.selectedSubBriefing === id ? null : id;
      renderHomeScenarios();
      renderHomeResults();
    });
  });
}

// --- Search-scope panel: restrict search to a subset of the library ------
function toggleSearchScopePanel() {
  const open = els.searchScopePanel.classList.toggle('hidden') === false;
  els.searchScopePanel.setAttribute('aria-hidden', open ? 'false' : 'true');
  els.searchToolsToggle.setAttribute('aria-pressed', open ? 'true' : 'false');
  if (open) renderSearchScopeList();
}

function renderSearchScopeList() {
  const files = [...state.files.values()].sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  // Group files by their docType so the user picks a category first, then
  // optionally drills into individual files.
  const groups = DOC_TYPES.map((dt) => ({
    ...dt, files: files.filter((f) => (f.docType || 'manual') === dt.id),
  }));
  const briefingRow = `<label class="search-scope-row search-scope-top">
      <input type="checkbox" data-act="search-briefings" ${state.searchBriefingsOn ? 'checked' : ''} />
      <span class="search-scope-name">✦ Search briefings <span class="admin-sub">— scenario + sub-briefing names</span></span>
    </label>`;
  const groupHtml = groups.map((g) => {
    if (!g.files.length) return '';
    const catOn = state.searchDocTypes.has(g.id);
    const childRows = g.files.map((f) => {
      const on = state.searchFileScope.has(f.id);
      return `<label class="search-scope-row search-scope-sub">
        <input type="checkbox" data-fileid="${escapeHtml(f.id)}" ${on ? 'checked' : ''} />
        <span class="search-scope-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
      </label>`;
    }).join('');
    return `<div class="search-scope-group">
      <label class="search-scope-row">
        <input type="checkbox" data-doctype="${escapeHtml(g.id)}" ${catOn ? 'checked' : ''} />
        <span class="search-scope-name"><strong>${escapeHtml(g.label)}</strong> <span class="admin-sub">(${g.files.length})</span></span>
      </label>
      <div class="search-scope-children">${childRows}</div>
    </div>`;
  }).join('');
  els.searchScopeList.innerHTML = briefingRow + (groupHtml || '<div class="admin-sub">No files yet — add documents in ⚙ Settings.</div>');

  els.searchScopeList.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', () => {
      if (cb.dataset.act === 'search-briefings') state.searchBriefingsOn = cb.checked;
      else if (cb.dataset.doctype) {
        const dt = cb.dataset.doctype;
        if (cb.checked) state.searchDocTypes.add(dt);
        else state.searchDocTypes.delete(dt);
      } else if (cb.dataset.fileid) {
        const fid = cb.dataset.fileid;
        if (cb.checked) state.searchFileScope.add(fid);
        else state.searchFileScope.delete(fid);
      }
      updateSearchToolsBadge();
      renderHomeResults();
    });
  });
  els.searchScopePanel.querySelector('[data-act="all"]')?.addEventListener('click', () => {
    state.searchDocTypes.clear();
    state.searchFileScope.clear();
    state.searchBriefingsOn = true;
    renderSearchScopeList();
    renderHomeResults();
    updateSearchToolsBadge();
  });
}

function updateSearchToolsBadge() {
  const fileCount = state.searchFileScope.size;
  const catCount = state.searchDocTypes.size;
  const total = fileCount + catCount + (state.searchBriefingsOn ? 0 : 0); // briefings on = default
  els.searchToolsToggle.classList.toggle('has-scope', fileCount > 0 || catCount > 0 || !state.searchBriefingsOn);
  els.searchToolsToggle.title = (fileCount + catCount)
    ? `Searching ${catCount ? catCount + ' categor' + (catCount === 1 ? 'y' : 'ies') : ''}${catCount && fileCount ? ' + ' : ''}${fileCount ? fileCount + ' file' + (fileCount === 1 ? '' : 's') : ''}`
    : 'Search tools';
}

// --- Long-press → context menu (rename / colour / reorder / delete) -------
// Bound on every editable home chip (briefing types, top briefings, sub
// briefings). After ~500ms of hold without moving the menu opens, and the
// synthetic click that follows the pointerup is swallowed in-place so the
// chip's selection toggle doesn't fire.
function bindChipLongPress(chipEl, kind /* 'briefing' | 'btype' */) {
  let timer = null, startX = 0, startY = 0;
  const cancel = () => { if (timer) { clearTimeout(timer); timer = null; } };
  chipEl.addEventListener('pointerdown', (e) => {
    if (e.button != null && e.button !== 0) return;
    startX = e.clientX; startY = e.clientY;
    cancel();
    timer = setTimeout(() => {
      timer = null;
      // Swallow exactly one upcoming click on this chip.
      chipEl.addEventListener('click', (ev) => {
        ev.stopImmediatePropagation(); ev.preventDefault();
      }, { capture: true, once: true });
      openChipActionMenu(chipEl, kind);
    }, 500);
  });
  chipEl.addEventListener('pointermove', (e) => {
    if (timer && Math.hypot((e.clientX || 0) - startX, (e.clientY || 0) - startY) > 8) cancel();
  });
  chipEl.addEventListener('pointerup', cancel);
  chipEl.addEventListener('pointerleave', cancel);
  chipEl.addEventListener('pointercancel', cancel);
}

function openChipActionMenu(chipEl, kind) {
  const menu = document.getElementById('chip-action-menu');
  if (!menu) return;
  const id = chipEl.getAttribute('data-id');
  const item = kind === 'btype'
    ? (state.briefingTypes || []).find((b) => b.id === id)
    : (state.scenarios || []).find((s) => s.id === id);
  if (!item) return;
  const rect = chipEl.getBoundingClientRect();
  menu.style.left = Math.max(8, Math.min(window.innerWidth - 220, rect.left)) + 'px';
  menu.style.top = (rect.bottom + 6) + 'px';
  menu.classList.remove('hidden');
  menu.setAttribute('aria-hidden', 'false');

  const close = () => {
    menu.classList.add('hidden');
    menu.setAttribute('aria-hidden', 'true');
    document.removeEventListener('pointerdown', outside, true);
  };
  const outside = (e) => { if (!menu.contains(e.target) && e.target !== chipEl) close(); };
  setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);

  const onAction = async (e) => {
    const act = e.target.getAttribute('data-act');
    if (!act) return;
    e.stopPropagation();
    if (act === 'rename') {
      const next = prompt('Rename:', item.name);
      if (next && next.trim() && next.trim() !== item.name) {
        item.name = next.trim(); item.updatedAt = Date.now();
        await saveItem(item, kind);
      }
      close(); return;
    }
    if (act === 'color') {
      const colourInput = menu.querySelector('.chip-act-color');
      colourInput.value = item.color || '#7aa3ff';
      colourInput.onchange = async () => {
        item.color = colourInput.value; item.updatedAt = Date.now();
        await saveItem(item, kind);
        close();
      };
      colourInput.click();
      return;
    }
    if (act === 'delete') {
      if (!confirm(`Delete "${item.name}"?`)) { close(); return; }
      await deleteItem(item, kind);
      close(); return;
    }
    if (act === 'move-left' || act === 'move-right') {
      const direction = act === 'move-left' ? -1 : 1;
      await reorderItem(item, kind, direction);
      close(); return;
    }
  };
  if (menu._onAction) menu.removeEventListener('click', menu._onAction);
  menu._onAction = onAction;
  menu.addEventListener('click', onAction);
}

async function saveItem(item, kind) {
  if (kind === 'btype') {
    await storage.putBriefingType(item);
    state.briefingTypes = await storage.listBriefingTypes();
    renderHomeBtypes();
  } else {
    await storage.putScenario(item);
    await reloadScenarios();
    renderHomeScenarios();
  }
  renderHomeResults();
}

async function deleteItem(item, kind) {
  if (kind === 'btype') {
    await storage.deleteBriefingType(item.id);
    state.briefingTypes = await storage.listBriefingTypes();
    if (state.selectedBtype === item.id) state.selectedBtype = null;
    renderHomeBtypes();
    // No need to reload the knowledge graph — anchors are untouched. A stale
    // btype id in an anchor's briefingTypes[] is harmless (the chip just
    // doesn't render, and the filter no-ops against a missing chip).
  } else {
    await storage.deleteScenario(item.id);
    await reloadScenarios();
    if (state.selectedTopBriefing === item.id) state.selectedTopBriefing = null;
    if (state.selectedSubBriefing === item.id) state.selectedSubBriefing = null;
    renderHomeScenarios();
    kg.invalidate(); await kg.load(true);
  }
  renderHomeResults();
}

async function reorderItem(item, kind, direction) {
  // Peers among which we swap sort order:
  //   btype       → all briefing types
  //   top-level   → all top-level briefings
  //   sub-briefing → siblings under any shared parent
  let peers;
  if (kind === 'btype') peers = (state.briefingTypes || []).slice();
  else if (isTopLevel(item)) peers = state.scenarios.filter(isTopLevel);
  else {
    const myParents = scenarioParents(item);
    peers = state.scenarios.filter((s) => !isTopLevel(s) && scenarioParents(s).some((p) => myParents.includes(p)));
  }
  peers.sort((a, b) => (a.sort || 0) - (b.sort || 0));
  const idx = peers.findIndex((x) => x.id === item.id);
  const swap = idx + direction;
  if (swap < 0 || swap >= peers.length) return;
  const a = peers[idx], b = peers[swap];
  const tmp = a.sort || 0;
  a.sort = b.sort || 0; b.sort = tmp || Date.now();
  a.updatedAt = b.updatedAt = Date.now();
  // Persist both writes; only refresh state + repaint once at the end.
  if (kind === 'btype') {
    await storage.putBriefingType(a); await storage.putBriefingType(b);
    state.briefingTypes = await storage.listBriefingTypes();
    renderHomeBtypes();
  } else {
    await storage.putScenario(a); await storage.putScenario(b);
    await reloadScenarios();
    renderHomeScenarios();
  }
  renderHomeResults();
}

// New briefing modal --------------------------------------------------------
let bnContext = { parentId: null, forceSub: false };
function openBriefingNewModal({ parentId = null, forceSub = false } = {}) {
  bnContext = { parentId, forceSub };
  els.bnName.value = '';
  els.bnColor.value = '#7aa3ff';
  const tops = (state.scenarios || []).filter(isTopLevel);
  // Parents are now a multi-select chip group. Empty = top-level.
  const preset = parentId ? [parentId] : [];
  els.bnParents.innerHTML = tops.length
    ? tops.map((s) => `<button type="button" class="sr-phase colour-chip ${preset.includes(s.id) ? 'on' : ''}" style="--c:${escapeHtml(s.color || '#7aa3ff')}" data-id="${escapeHtml(s.id)}">${escapeHtml(s.name)}</button>`).join('')
    : '<span class="admin-sub">— no top-level briefings yet —</span>';
  const updateMode = () => {
    // forceSub determines mode up-front. We no longer flip mode based on chip
    // taps: top-level mode never shows the parent-briefings picker, and sub
    // mode never shows phases / briefing-types (those inherit through parent).
    const isSub = !!forceSub;
    els.bnTitle.textContent = isSub ? 'New sub-briefing' : 'New top-level briefing';
    // Each level only links to the level above it:
    //   top-level  → briefing TYPES   (parents row hidden, phases shown for filter context, btypes shown)
    //   sub-briefing → parent BRIEFINGS (parents row shown, phases/btypes hidden)
    els.bnParentField.classList.toggle('hidden', !isSub);
    els.bnPhasesField.classList.toggle('hidden', isSub);
    els.bnBtypesField.classList.toggle('hidden', isSub);
    const parentLabel = els.bnParentField.querySelector('label .admin-sub');
    if (parentLabel) parentLabel.textContent = '— tap at least one parent briefing';
  };
  // updateMode() now keys off forceSub only, so chip taps just toggle.
  els.bnParents.querySelectorAll('.sr-phase').forEach((b) =>
    b.addEventListener('click', () => b.classList.toggle('on')));
  // Pre-fill phases with the active phase.
  els.bnPhases.innerHTML = PHASES.map((p) => {
    const on = state.selectedPhase === p.id;
    return `<button type="button" class="sr-phase ${on ? 'on' : ''}" data-phase="${p.id}">${escapeHtml(p.label)}</button>`;
  }).join('');
  els.bnPhases.querySelectorAll('.sr-phase').forEach((b) =>
    b.addEventListener('click', () => b.classList.toggle('on')));
  // Briefing-types chip selector.
  els.bnBtypes.innerHTML = (state.briefingTypes || []).length
    ? state.briefingTypes.map((b) => {
        const on = state.selectedBtype === b.id;
        return `<button type="button" class="sr-phase colour-chip ${on ? 'on' : ''}" data-id="${escapeHtml(b.id)}" style="--c:${escapeHtml(b.color || '#7aa3ff')}">${escapeHtml(b.name)}</button>`;
      }).join('')
    : '<span class="admin-sub">— no briefing types yet —</span>';
  els.bnBtypes.querySelectorAll('.sr-phase').forEach((b) =>
    b.addEventListener('click', () => b.classList.toggle('on')));
  updateMode();
  els.briefingNewOverlay.classList.remove('hidden');
  setTimeout(() => els.bnName.focus(), 0);
}

async function onCreateBriefing(e) {
  e.preventDefault();
  const name = els.bnName.value.trim();
  if (!name) return;
  const parentIds = [...els.bnParents.querySelectorAll('.sr-phase.on')].map((b) => b.getAttribute('data-id'));
  if (bnContext.forceSub && !parentIds.length) {
    toast('Pick at least one parent briefing for this sub-briefing.');
    return;
  }
  // Mode is fully determined by forceSub now — parents are only shown in
  // sub-mode, so parentIds.length is always 0 in top-level mode.
  const isSub = !!bnContext.forceSub;
  const phases = isSub ? [] :
    [...els.bnPhases.querySelectorAll('.sr-phase.on')].map((b) => b.getAttribute('data-phase'));
  const briefingTypes = isSub ? [] :
    [...els.bnBtypes.querySelectorAll('.sr-phase.on')].map((b) => b.getAttribute('data-id'));
  const sc = {
    id: 'sc_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name, parentIds, parentId: null, phases, briefingTypes,
    color: els.bnColor.value || '#7aa3ff',
    kind: 'normal', sort: Date.now(), createdAt: Date.now(), updatedAt: Date.now(),
  };
  await storage.putScenario(sc);
  await reloadScenarios();
  els.briefingNewOverlay.classList.add('hidden');
  if (isSub) {
    // Activate one of the parents so the new chip shows up on the sub-row.
    if (!parentIds.includes(state.selectedTopBriefing)) state.selectedTopBriefing = parentIds[0];
  }
  renderHomeScenarios(); renderHomeResults();
  if (els.settingsOverlay && !els.settingsOverlay.classList.contains('hidden')) renderSettingsSheet();
  toast(`Created “${name}”${isSub ? ' (sub)' : ''}`);
}

// Legacy entry kept for older callers that may still reference it.
async function quickAddScenario() { openBriefingNewModal({ parentId: null }); }

async function renderHomeResults() {
  invalidateManualTypeCache();
  // Effective file scope:
  //   start from aircraft effectivity (or all files),
  //   ∩ union(search docType filter, per-file picks).
  // If neither category nor file is picked AND there's a search query, the
  // user only wants briefing matches — no anchor cards.
  let fileIds = activeFileIds();
  const querying = !!(state.homeQuery && state.homeQuery.trim());
  const anyFileScope = state.searchDocTypes.size || state.searchFileScope.size;
  if (querying && !anyFileScope) {
    fileIds = new Set();  // briefings-only mode
  } else if (anyFileScope) {
    const scoped = new Set();
    for (const f of state.files.values()) {
      if (state.searchFileScope.has(f.id)) scoped.add(f.id);
      else if (state.searchDocTypes.has(f.docType || 'manual')) scoped.add(f.id);
    }
    fileIds = fileIds ? new Set([...fileIds].filter((id) => scoped.has(id))) : scoped;
  }
  const phases = state.selectedPhase ? [state.selectedPhase] : [];
  const btypes = state.selectedBtype ? [state.selectedBtype] : [];
  const topId = state.selectedTopBriefing;
  const subId = state.selectedSubBriefing;
  const hasAnyFilter = !!(phases.length || btypes.length || topId || subId
    || (state.homeQuery && state.homeQuery.trim()));
  // GENERAL-ONLY default kicks in only when nothing at all is active. Once
  // the user types into the search box, the result set opens up to the
  // whole library.
  const generalOnly = !hasAnyFilter;
  // When a top-level is picked WITHOUT a sub, only show anchors linked
  // directly to that top (i.e. their scenarios include the top but none of
  // its child sub-briefings). The detailed per-sub content is revealed only
  // once a sub-briefing is selected.
  const topOnly = !!topId && !subId;
  const childSubIds = topOnly
    ? new Set((state.scenarios || []).filter((s) => scenarioParents(s).includes(topId)).map((s) => s.id))
    : null;
  const all = await kg.allAnchors();
  let anchors = all.filter((a) => {
    if (a.kind !== 'idx') return false;
    if (fileIds && !fileIds.has(a.fileId)) return false;
    if (phases.length && !phases.some((p) => (a.phases || []).includes(p))) return false;
    if (btypes.length && !btypes.some((b) => (a.briefingTypes || []).includes(b))) return false;
    const aScens = a.scenarios || [];
    if (subId) {
      // Sub-briefing scope: anchor must be linked to this sub.
      if (!aScens.includes(subId)) return false;
    } else if (topOnly) {
      // Top-only scope: anchor must be directly on the top, NOT inside any
      // sub-briefing under it.
      if (!aScens.includes(topId)) return false;
      for (const sid of aScens) { if (childSubIds.has(sid)) return false; }
    }
    if (state.homeQuery) {
      const q = state.homeQuery.toLowerCase();
      const hay = ((a.title || '') + ' ' + (a.excerpt || '')).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (generalOnly) {
      const t = (a.title || '').trim();
      if (!(t === 'General' || /[—-]\s*General$/i.test(t))) return false;
    }
    return true;
  });

  const hasFilters = hasAnyFilter;
  if (!anchors.length) {
    let hint;
    if (topOnly) {
      hint = '<li class="home-empty">Pick a sub-briefing above to see its files. (Files linked directly to this briefing would show here.)</li>';
    } else if (hasFilters) {
      hint = '<li class="home-empty">No briefings match. Try a different phase, type or briefing — or tap “Clear”.</li>';
    } else {
      hint = '<li class="home-empty">Pick a phase, briefing type, or briefing above to see relevant content. (General overviews show here when nothing matches.)</li>';
    }
    els.homeResults.innerHTML = hint;
    return;
  }
  // When searching, surface matching briefings + sub-briefings on top so
  // the user can jump straight to them. Each chip applies its own scope
  // (and clears the query) on tap.
  let briefingsHeader = '';
  if (state.searchBriefingsOn && state.homeQuery && state.homeQuery.trim().length >= 2) {
    const q = state.homeQuery.toLowerCase();
    const matches = (state.scenarios || [])
      .filter((s) => (s.name || '').toLowerCase().includes(q))
      .slice(0, 12);
    if (matches.length) {
      briefingsHeader = `<li class="home-results-header">Briefings matching “${escapeHtml(state.homeQuery)}”</li>
        <li class="home-results-matches">
          ${matches.map((s) => `<button class="home-chip ${isTopLevel(s) ? 'top-chip' : 'sub-chip'}" style="--c:${escapeHtml(s.color || '#7aa3ff')}" data-jump="${escapeHtml(s.id)}" data-jump-kind="${isTopLevel(s) ? 'top' : 'sub'}">${escapeHtml(s.name)}</button>`).join('')}
        </li>
        <li class="home-results-header">Indexed paragraphs</li>`;
    }
  }
  // Personal-briefing anchors lead; manual / fleet anchors fall in behind.
  anchors.sort((a, b) => {
    const pa = (state.files.get(a.fileId)?.docType === 'personal') ? 0 : 1;
    const pb = (state.files.get(b.fileId)?.docType === 'personal') ? 0 : 1;
    return pa - pb;
  });
  // When a sub-briefing is selected, cascade each anchor's cross-reference
  // links into the list as live preview cards (so the user actually SEES
  // the OMA / QRH / FCOM pages, not just chips). Skip in the general view
  // and on top-level / search-only selections — those would explode.
  let displays;
  if (state.selectedSubBriefing) {
    displays = [];
    for (const a of anchors) {
      displays.push({ kind: 'anchor', anchor: a });
      for (const l of (a.links || [])) {
        const target = resolveLinkTarget(l);
        if (target) displays.push({ kind: 'link', link: l, anchor: a, target });
      }
    }
  } else {
    displays = anchors.map((a) => ({ kind: 'anchor', anchor: a }));
  }
  els.homeResults.innerHTML = briefingsHeader + displays.map((d) =>
    d.kind === 'anchor' ? homeResultHtml(d.anchor) : linkResultHtml(d)
  ).join('');
  // Wire jump-chips: select that briefing as the active scope.
  els.homeResults.querySelectorAll('[data-jump]').forEach((chip) => {
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = chip.getAttribute('data-jump');
      const kind = chip.getAttribute('data-jump-kind');
      if (kind === 'sub') {
        const sub = state.scenarios.find((s) => s.id === id);
        const parent = sub && scenarioParents(sub)[0];
        state.selectedTopBriefing = parent || null;
        state.selectedSubBriefing = id;
      } else {
        state.selectedTopBriefing = id;
        state.selectedSubBriefing = null;
      }
      state.homeQuery = ''; els.homeSearch.value = '';
      renderHomeScenarios(); renderHomeResults();
    });
  });
  // Clicks on the inline preview just keep scrolling; the explicit ⤢ button
  // opens the file in the full viewer. The header / excerpt still open it too.
  els.homeResults.querySelectorAll('.home-result').forEach((row) => {
    const isLinkCard = row.classList.contains('hr-link-card');
    // Anchor cards look up by data-anchor; link cards inherit from parent.
    const anchorId = row.getAttribute('data-anchor') || row.getAttribute('data-anchor-parent');
    const anchor = anchors.find((x) => x.anchorId === anchorId);
    if (!anchor && !isLinkCard) return;
    row.querySelector('.hr-row')?.addEventListener('click', () => {
      const collapsed = row.classList.toggle('hr-collapsed');
      if (!collapsed) renderCardPreview(row, anchor);
    });
    row.querySelector('.hr-open')?.addEventListener('click', (e) => {
      e.stopPropagation();
      if (isLinkCard) openFileInViewer(row.getAttribute('data-file'), +row.getAttribute('data-page') || 1);
      else openAnchorInViewer(anchor);
    });
    // Zoom controls (+/−) — re-render preview at a different scale.
    let zoom = parseFloat(row.dataset.zoom || '1');
    const reRenderZoom = async () => {
      const canvas = row.querySelector('.hr-canvas');
      const wrap = row.querySelector('.hr-preview');
      if (!canvas || !wrap) return;
      wrap.setAttribute('data-pending', '1');
      try {
        await renderPreview(canvas, row.getAttribute('data-file'), +row.getAttribute('data-page'), {
          maxWidthPx: 520 * zoom,
          highlightRects: (anchor && +row.getAttribute('data-page') === anchor.pageNum) ? (anchor.selectionRects || null) : null,
        });
        wrap.removeAttribute('data-pending');
      } catch (_) {}
    };
    row.querySelector('[data-act="zoom-in"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      zoom = Math.min(3, zoom + 0.25); row.dataset.zoom = zoom;
      reRenderZoom();
    });
    row.querySelector('[data-act="zoom-out"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      zoom = Math.max(0.5, zoom - 0.25); row.dataset.zoom = zoom;
      reRenderZoom();
    });
    const pgInput = row.querySelector('.hr-pg-input');
    const totalPages = +row.getAttribute('data-pagecount') || 1;
    const goToPage = async (n) => {
      const target = Math.max(1, Math.min(totalPages, n | 0));
      row.setAttribute('data-page', String(target));
      const pageBadge = row.querySelector('.hr-row-page');
      if (pageBadge) pageBadge.textContent = 'p.' + target + ' / ' + totalPages;
      pgInput.value = target;
      const canvas = row.querySelector('.hr-canvas');
      const wrap = row.querySelector('.hr-preview');
      wrap.setAttribute('data-pending', '1');
      try {
        await renderPreview(canvas, row.getAttribute('data-file'), target, {
          maxWidthPx: 520,
          highlightRects: target === anchor.pageNum ? (anchor.selectionRects || null) : null,
        });
        wrap.removeAttribute('data-pending');
      } catch (err) { /* swallow */ }
    };
    // Page changes on the picker persist back to the anchor so the user can
    // permanently correct a wrong seed page without re-running the catalog.
    // Link cards don't persist (they're synthetic — fixing the parent link
    // is the way to change a link card's page).
    const persistPage = async (n) => {
      if (isLinkCard || !anchor) return;
      anchor.pageNum = n;
      anchor.value = 'p.' + n;
      anchor.updatedAt = Date.now();
      await storage.putAnchor(anchor);
      kg.invalidate();
    };
    pgInput?.addEventListener('change', async () => { await goToPage(+pgInput.value); await persistPage(+row.getAttribute('data-page')); });
    pgInput?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); pgInput.dispatchEvent(new Event('change')); } });
    pgInput?.addEventListener('click', (e) => e.stopPropagation());
    row.querySelector('[data-act="prev"]')?.addEventListener('click', async (e) => {
      e.stopPropagation(); await goToPage((+row.getAttribute('data-page')) - 1); await persistPage(+row.getAttribute('data-page'));
    });
    row.querySelector('[data-act="next"]')?.addEventListener('click', async (e) => {
      e.stopPropagation(); await goToPage((+row.getAttribute('data-page')) + 1); await persistPage(+row.getAttribute('data-page'));
    });
    // Cross-reference link chips → resolve & open the target manual.
    row.querySelectorAll('.hr-link-chip').forEach((chip) => {
      chip.addEventListener('click', async (e) => {
        e.stopPropagation();
        const mtype = chip.getAttribute('data-mtype');
        const mval = chip.getAttribute('data-mval');
        const mpage = parseInt(chip.getAttribute('data-mpage'), 10);
        await openManualReference(mtype, mval, Number.isFinite(mpage) ? mpage : null);
      });
    });
    // Per-chip delete buttons.
    row.querySelectorAll('[data-act="del-link"]').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const idx = +btn.getAttribute('data-idx');
        const links = (anchor.links || []).slice();
        const removed = links.splice(idx, 1)[0];
        anchor.links = links;
        anchor.updatedAt = Date.now();
        await storage.putAnchor(anchor);
        kg.invalidate(); await kg.load(true);
        renderHomeResults();
        toast(`Removed ${removed?.manualType || ''} ${removed?.value || ''}`);
      });
    });
    // Add-link button — reveals the small form.
    const addBtn = row.querySelector('[data-act="add-link"]');
    const linkForm = row.querySelector('[data-act="link-form"]');
    addBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      addBtn.classList.add('hidden');
      linkForm?.classList.remove('hidden');
      linkForm?.querySelector('.hr-link-val-input')?.focus();
    });
    linkForm?.querySelector('[data-act="link-cancel"]')?.addEventListener('click', (e) => {
      e.stopPropagation();
      linkForm.classList.add('hidden');
      addBtn?.classList.remove('hidden');
    });
    linkForm?.addEventListener('click', (e) => e.stopPropagation());
    linkForm?.addEventListener('submit', async (e) => {
      e.preventDefault(); e.stopPropagation();
      const mtype = linkForm.querySelector('.hr-link-type-sel').value;
      const mval = linkForm.querySelector('.hr-link-val-input').value.trim();
      const pageRaw = linkForm.querySelector('.hr-link-page-input').value.trim();
      if (!mval) return;
      const link = { manualType: mtype, value: mval };
      const pageNum = parseInt(pageRaw, 10);
      if (Number.isFinite(pageNum) && pageNum >= 1) link.pageNum = pageNum;
      const links = (anchor.links || []).slice();
      links.push(link);
      anchor.links = links;
      anchor.updatedAt = Date.now();
      await storage.putAnchor(anchor);
      kg.invalidate(); await kg.load(true);
      renderHomeResults();
      toast(`Linked ${mtype} ${mval}${link.pageNum ? ` (p.${link.pageNum})` : ''}`);
    });
  });
}

// Resolve a {manualType, value, pageNum?} link to a {fileId, pageNum, name}
// that the result list can render as its own preview card. Returns null if
// the target manual isn't loaded yet.
function resolveLinkTarget(link) {
  if (!link || !link.manualType) return null;
  let fileId = null;
  for (const [id, m] of state.manuals.entries()) {
    if ((m.manualType || '').toUpperCase() === link.manualType.toUpperCase()) {
      fileId = id; break;
    }
  }
  if (!fileId) return null;
  const file = state.files.get(fileId);
  const pageNum = Number.isFinite(link.pageNum) ? link.pageNum : 1;
  return { fileId, pageNum, name: file?.name || link.manualType };
}

// Synthetic result card for an anchor's cross-reference link. Looks like a
// home-result but tagged so we know it's a derived view (it has no anchorId
// — bookkeeping operations like the link editor target the parent anchor).
function linkResultHtml(d) {
  const file = state.files.get(d.target.fileId);
  const pageCount = file ? (file.numPages || 1) : 1;
  const label = `${d.link.manualType} ${d.link.value || ''}`.trim();
  return `<li class="home-result hr-collapsed hr-link-card"
      data-anchor-parent="${escapeHtml(d.anchor.anchorId)}"
      data-file="${escapeHtml(d.target.fileId)}"
      data-page="${d.target.pageNum}" data-pagecount="${pageCount}">
    <button type="button" class="hr-row" data-act="expand">
      <span class="hr-kind kind-link" title="cross-reference">🔗</span>
      <span class="hr-row-main">
        <span class="hr-row-title">${escapeHtml(label)}</span>
        <span class="hr-row-meta">
          <span class="hr-row-file">${escapeHtml(d.target.name)}</span>
          <span class="hr-row-dot">·</span>
          <span class="hr-row-page">p.${d.target.pageNum} / ${pageCount}</span>
          <span class="hr-row-dot">·</span>
          <span class="admin-sub">↩ linked from “${escapeHtml(d.anchor.title || '')}”</span>
        </span>
      </span>
      <span class="hr-chev" aria-hidden="true">›</span>
    </button>
    <div class="hr-expanded">
      <div class="hr-controls">
        <div class="hr-page-picker">
          <button class="hr-pg-step" data-act="prev" title="Previous page">‹</button>
          <input class="hr-pg-input" type="number" min="1" max="${pageCount}" value="${d.target.pageNum}" />
          <span class="hr-pg-of">of ${pageCount}</span>
          <button class="hr-pg-step" data-act="next" title="Next page">›</button>
        </div>
        <button class="hr-zoom-btn" data-act="zoom-out" title="Zoom out">−</button>
        <button class="hr-zoom-btn" data-act="zoom-in" title="Zoom in">＋</button>
        <span class="spacer"></span>
        <button class="btn ghost hr-open" data-act="open" title="Open full screen">⛶ Open</button>
      </div>
      <div class="hr-preview" data-pending="1">
        <div class="hr-preview-headline">
          <span class="hr-preview-headline-icon">🔗</span>
          <span class="hr-preview-headline-text">${escapeHtml(label)} — ${escapeHtml(d.target.name)}</span>
        </div>
        <canvas class="hr-canvas"></canvas>
      </div>
    </div>
  </li>`;
}

function homeResultHtml(a) {
  const file = state.files.get(a.fileId);
  const fname = file ? file.name : '(file missing)';
  const pageCount = file ? (file.numPages || 1) : 1;
  const phaseTags = (a.phases || []).map(phaseLabel).filter(Boolean).slice(0, 3).join(' · ');
  const scenTags = (a.scenarios || []).map(scenarioLabel).filter(Boolean).slice(0, 3).join(' · ');
  const itemType = a.itemType === 'bookmark' ? 'bookmark' : 'briefing';
  const kindIcon = itemType === 'bookmark' ? '🔖' : '📋';
  // Row-list look (EFB-style): collapsed by default, chevron on the right.
  // Tap the row to expand → reveal page picker + preview + tags + open button.
  const headline = a.excerpt ? a.excerpt.slice(0, 96) : fname;
  return `<li class="home-result hr-collapsed" data-anchor="${escapeHtml(a.anchorId)}"
      data-file="${escapeHtml(a.fileId)}" data-page="${a.pageNum}" data-pagecount="${pageCount}">
    <button type="button" class="hr-row" data-act="expand">
      <span class="hr-kind kind-${itemType}" title="${itemType}">${kindIcon}</span>
      <span class="hr-row-main">
        <span class="hr-row-title">${escapeHtml(headline)}</span>
        <span class="hr-row-meta">
          <span class="hr-row-file">${escapeHtml(fname)}</span>
          <span class="hr-row-dot">·</span>
          <span class="hr-row-page">p.${a.pageNum} / ${pageCount}</span>
          ${phaseTags ? `<span class="hr-row-dot">·</span><span>✈ ${escapeHtml(phaseTags)}</span>` : ''}
          ${scenTags ? `<span class="hr-row-dot">·</span><span>✦ ${escapeHtml(scenTags)}</span>` : ''}
        </span>
      </span>
      <span class="hr-chev" aria-hidden="true">›</span>
    </button>
    <div class="hr-expanded">
      <div class="hr-controls">
        <div class="hr-page-picker">
          <button class="hr-pg-step" data-act="prev" title="Previous page">‹</button>
          <input class="hr-pg-input" type="number" min="1" max="${pageCount}" value="${a.pageNum}" />
          <span class="hr-pg-of">of ${pageCount}</span>
          <button class="hr-pg-step" data-act="next" title="Next page">›</button>
        </div>
        <button class="hr-zoom-btn" data-act="zoom-out" title="Zoom out">−</button>
        <button class="hr-zoom-btn" data-act="zoom-in" title="Zoom in">＋</button>
        <span class="spacer"></span>
        <button class="btn ghost hr-open" data-act="open" title="Open full screen">⛶ Open</button>
      </div>
      <div class="hr-preview" data-pending="1">
        <div class="hr-preview-headline">
          <span class="hr-preview-headline-icon" aria-hidden="true">${kindIcon}</span>
          <span class="hr-preview-headline-text">${escapeHtml(a.title || '')}</span>
        </div>
        <canvas class="hr-canvas"></canvas>
      </div>
      <div class="hr-links" aria-label="Cross references">
        ${(a.links || []).map((l, idx) => `<span class="hr-link-chip-wrap" data-idx="${idx}">
          <button class="hr-link-chip" data-mtype="${escapeHtml(l.manualType || '')}" data-mval="${escapeHtml(l.value || '')}" data-mpage="${l.pageNum != null ? l.pageNum : ''}" title="Open ${escapeHtml(l.manualType || '')} ${escapeHtml(l.value || '')}${l.pageNum != null ? ' (p.' + l.pageNum + ')' : ''}">
            <span class="hr-link-type">${escapeHtml(l.manualType || '')}</span>
            <span class="hr-link-val">${escapeHtml(l.value || '')}</span>
            ${l.pageNum != null ? `<span class="hr-link-page">p.${l.pageNum}</span>` : ''}
          </button>
          <button class="hr-link-del" data-act="del-link" data-idx="${idx}" title="Remove link" aria-label="Remove link">×</button>
        </span>`).join('')}
        <button class="hr-link-add" data-act="add-link" title="Add cross-reference">＋ link</button>
        <form class="hr-link-form hidden" data-act="link-form">
          <select class="hr-link-type-sel">
            ${availableManualTypeOptions()}
          </select>
          <input class="hr-link-val-input" type="text" placeholder="e.g. 8.5.11.4" required />
          <input class="hr-link-page-input" type="number" min="1" placeholder="page" />
          <button class="btn primary" type="submit">Add</button>
          <button class="btn ghost" type="button" data-act="link-cancel">✕</button>
        </form>
      </div>
    </div>
  </li>`;
}

// Render-on-demand for previews. Cards start collapsed; rendering only
// happens when the user expands a card. Handles both anchor cards and
// synthetic cross-reference link cards (which carry no anchor object).
async function renderCardPreview(card, anchor) {
  const wrap = card.querySelector('.hr-preview');
  if (!wrap || !wrap.hasAttribute('data-pending')) return;
  const canvas = card.querySelector('.hr-canvas');
  const isLinkCard = card.classList.contains('hr-link-card');
  const zoom = parseFloat(card.dataset.zoom || '1');
  try {
    await renderPreview(canvas, card.getAttribute('data-file'), +card.getAttribute('data-page'), {
      maxWidthPx: 520 * zoom,
      highlightRects: !isLinkCard && anchor ? (anchor.selectionRects || null) : null,
    });
    wrap.removeAttribute('data-pending');
  } catch (err) {
    wrap.innerHTML = `<div class="hr-preview-err">Preview unavailable (${escapeHtml(err.message || 'error')})</div>`;
  }
}

// Manual-type dropdown options for the link editor. Only shows types
// the user has actually uploaded a file for, deduplicated and sorted.
// Result is memoised inside one renderHomeResults pass (~200 cards build
// the same string otherwise).
let _manualTypeOptionsCache = null;
function availableManualTypeOptions() {
  if (_manualTypeOptionsCache != null) return _manualTypeOptionsCache;
  const seen = new Set();
  // Pull manualType from both `manuals` (rich metadata) AND raw files
  // (e.g. a manual the user just added that hasn't fully indexed yet).
  for (const m of state.manuals.values()) {
    const t = (m.manualType || '').toUpperCase();
    if (t && t !== 'PERSONAL') seen.add(t);
  }
  for (const f of state.files.values()) {
    // Only manuals are usable as link targets — personal/fleet docs aren't
    // cross-referenced through this dropdown.
    if (f.docType && f.docType !== 'manual') continue;
    const m = state.manuals.get(f.id);
    const t = (m?.manualType || '').toUpperCase();
    if (t && t !== 'PERSONAL') seen.add(t);
  }
  _manualTypeOptionsCache = seen.size
    ? [...seen].sort().map((t) => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('')
    : '<option value="" disabled selected>— add a manual first —</option>';
  return _manualTypeOptionsCache;
}
function invalidateManualTypeCache() { _manualTypeOptionsCache = null; }

// Resolve a cross-reference (e.g. {manualType:'QRH', value:'CI 2.6'}) and
// open the relevant manual page. When the link carries an explicit pageNum
// (set from the inline link editor), use that directly so the user lands on
// the exact page they bookmarked.
async function openManualReference(manualType, value, pageNum = null) {
  if (!manualType && !value) return;
  // If a manual of this type is loaded, prefer the user-specified pageNum.
  if (Number.isFinite(pageNum)) {
    for (const [fileId, m] of state.manuals.entries()) {
      if (m.manualType === manualType) { openFileInViewer(fileId, pageNum); return; }
    }
  }
  try {
    const anchor = await kg.resolveAnchor(manualType, value);
    if (anchor) { openAnchorInViewer(anchor); return; }
  } catch (_) { /* fall through */ }
  for (const [fileId, m] of state.manuals.entries()) {
    if (m.manualType === manualType) { openFileInViewer(fileId, 1); return; }
  }
  toast(`${manualType} ${value} — manual not loaded yet. Add ${manualType} via ⚙ Settings.`);
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

const DOC_TYPES = [
  { id: 'manual',       label: 'Manuals' },
  { id: 'personal',     label: 'Personal briefings' },
  { id: 'fleet-update', label: 'Fleet & technical updates' },
];

function renderSettingsSheet() {
  renderSettingsLibrary();
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

  // Briefing types: editable name + color + delete, with reorder arrows.
  const bList = (state.briefingTypes || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
  els.settingsBtypes.innerHTML = bList.length ? bList.map((b) => `
    <div class="settings-row" data-id="${escapeHtml(b.id)}" data-kind="btype">
      <div class="sr-reorder">
        <button class="btn ghost sr-up" data-act="up" title="Move up">▲</button>
        <button class="btn ghost sr-down" data-act="down" title="Move down">▼</button>
      </div>
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
// Library — three categories of documents; each file shows a name input,
// docType dropdown, and a delete button.
async function renderSettingsLibrary() {
  if (!els.settingsLibrary) return;
  const files = [...state.files.values()];
  const groups = DOC_TYPES.map((dt) => ({
    ...dt, files: files.filter((f) => (f.docType || 'manual') === dt.id),
  }));
  // Per-category "+ Add" buttons let the user upload a file straight into
  // its bucket (Manuals / Personal briefings / Fleet updates) without going
  // through the home-screen + first.
  els.settingsLibrary.innerHTML = groups.map((g) => `
    <div class="lib-group" data-doctype="${escapeHtml(g.id)}">
      <div class="lib-group-head">
        <span>${escapeHtml(g.label)} <span class="admin-sub">(${g.files.length})</span></span>
        <button class="btn ghost lib-add" data-doctype="${escapeHtml(g.id)}" title="Add a document to ${escapeHtml(g.label)}">＋ Add</button>
      </div>
      ${g.files.length
        ? g.files.map((f) => `
          <div class="settings-row lib-row" data-fileid="${escapeHtml(f.id)}">
            <button class="btn ghost lib-preview-toggle" data-act="toggle-preview" aria-pressed="false" title="Show preview">▸</button>
            <span class="lib-name" title="${escapeHtml(f.name)}">${escapeHtml(f.name)}</span>
            <select class="lib-type" title="Document category">
              ${DOC_TYPES.map((t) => `<option value="${t.id}" ${t.id === (f.docType || 'manual') ? 'selected' : ''}>${escapeHtml(t.label)}</option>`).join('')}
            </select>
            <button class="btn ghost" data-act="open-file" title="Open in viewer">⛶</button>
            <button class="btn ghost" data-act="del-file" title="Delete">🗑</button>
          </div>
          <div class="lib-preview hidden" data-pending="1" data-for="${escapeHtml(f.id)}">
            <canvas></canvas>
          </div>`).join('')
        : '<div class="admin-sub lib-empty">— none —</div>'}
    </div>`).join('');

  els.settingsLibrary.querySelectorAll('.lib-add').forEach((btn) => {
    btn.addEventListener('click', () => triggerFilePickerFor(btn.getAttribute('data-doctype')));
  });

  els.settingsLibrary.querySelectorAll('.lib-row').forEach((row) => {
    const fileId = row.getAttribute('data-fileid');
    row.querySelector('.lib-type')?.addEventListener('change', async (e) => {
      const file = await storage.getFile(fileId);
      if (!file) return;
      file.docType = e.target.value; file.updatedAt = Date.now();
      await storage.putFile(file);
      state.files.set(fileId, file);
      renderSettingsLibrary();
    });
    row.querySelector('[data-act="open-file"]')?.addEventListener('click', async () => {
      els.settingsOverlay.classList.add('hidden');
      await openFileInViewer(fileId, 1);
    });
    row.querySelector('[data-act="toggle-preview"]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const preview = row.nextElementSibling;
      if (!preview || !preview.classList.contains('lib-preview')) return;
      const opening = preview.classList.toggle('hidden') === false;
      btn.setAttribute('aria-pressed', opening ? 'true' : 'false');
      btn.textContent = opening ? '▾' : '▸';
      btn.title = opening ? 'Hide preview' : 'Show preview';
      if (opening && preview.hasAttribute('data-pending')) {
        try {
          await renderPreview(preview.querySelector('canvas'), fileId, 1, { maxWidthPx: 460 });
          preview.removeAttribute('data-pending');
        } catch (_) { /* swallow */ }
      }
    });
    row.querySelector('[data-act="del-file"]')?.addEventListener('click', async () => {
      const file = state.files.get(fileId);
      if (!file) return;
      if (!confirm(`Delete document "${file.name}" and everything indexed from it?`)) return;
      await storage.deleteFile(fileId);
      state.files.delete(fileId);
      kg.invalidate(); await kg.load(true);
      renderSettingsLibrary(); renderHomeResults();
    });
  });
}

// Trigger the file picker with a target docType (stored on the input's
// dataset so it dies with the next render and can't contaminate other flows).
function triggerFilePickerFor(docType) {
  els.personalInput.dataset.docType = docType || 'manual';
  els.personalInput.click();
}

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
  const isSub = !isTopLevel(s);
  const parents = scenarioParents(s);
  // Top-level: links to phases + briefing types. Sub: links to parent briefings.
  const linksHtml = isSub
    ? `<div class="sr-link-group" data-link="parents">
        <span class="sr-link-label">parents:</span>
        ${all.filter((p) => isTopLevel(p) && p.id !== s.id)
          .map((p) => `<button type="button" class="sr-phase ${parents.includes(p.id) ? 'on' : ''}" data-pid="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button>`).join('')
          || '<span class="admin-sub">(no top-level briefings)</span>'}
      </div>`
    : `<div class="sr-link-group" data-link="phases">
        <span class="sr-link-label">phases:</span>
        ${PHASES.map((p) => `<button type="button" class="sr-phase ${(s.phases || []).includes(p.id) ? 'on' : ''}" data-phase="${p.id}">${escapeHtml(p.label)}</button>`).join('')}
      </div>
      <div class="sr-link-group" data-link="btypes">
        <span class="sr-link-label">types:</span>
        ${(state.briefingTypes || []).length
          ? state.briefingTypes.map((b) => `<button type="button" class="sr-phase ${(s.briefingTypes || []).includes(b.id) ? 'on' : ''}" data-btid="${escapeHtml(b.id)}" style="border-color:${escapeHtml(b.color || '#7aa3ff')};">${escapeHtml(b.name)}</button>`).join('')
          : '<span class="admin-sub">(no briefing types)</span>'}
      </div>`;
  return `<div class="settings-row ${isSub ? 'is-sub' : ''}" data-id="${escapeHtml(s.id)}" data-kind="scenario">
    <div class="sr-reorder">
      <button class="btn ghost sr-up" data-act="up" title="Move up">▲</button>
      <button class="btn ghost sr-down" data-act="down" title="Move down">▼</button>
    </div>
    <input type="text" class="sr-name" value="${escapeHtml(s.name)}" />
    <input type="color" class="sr-color" value="${escapeHtml(s.color || '#7aa3ff')}" title="Color" />
    <div class="sr-links">${linksHtml}</div>
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
  // Phase / parent / btype chips for scenario rows.
  row.querySelectorAll('.sr-phase').forEach((chip) => {
    chip.addEventListener('click', async () => {
      const sc = state.scenarios.find((x) => x.id === id);
      if (!sc) return;
      const group = chip.closest('.sr-link-group')?.getAttribute('data-link');
      if (group === 'phases') {
        const phaseId = chip.getAttribute('data-phase');
        sc.phases = sc.phases || [];
        sc.phases = sc.phases.includes(phaseId) ? sc.phases.filter((p) => p !== phaseId) : sc.phases.concat(phaseId);
      } else if (group === 'parents') {
        const pid = chip.getAttribute('data-pid');
        sc.parentIds = scenarioParents(sc);
        sc.parentIds = sc.parentIds.includes(pid) ? sc.parentIds.filter((p) => p !== pid) : sc.parentIds.concat(pid);
        sc.parentId = null;
      } else if (group === 'btypes') {
        const bt = chip.getAttribute('data-btid');
        sc.briefingTypes = sc.briefingTypes || [];
        sc.briefingTypes = sc.briefingTypes.includes(bt) ? sc.briefingTypes.filter((p) => p !== bt) : sc.briefingTypes.concat(bt);
      }
      sc.updatedAt = Date.now();
      await storage.putScenario(sc); await reloadScenarios();
      chip.classList.toggle('on');
      renderHomeScenarios(); renderHomeResults();
    });
  });
  // Reorder.
  const reorder = async (direction) => {
    const list = (state.scenarios || []).filter((x) => isTopLevel(x) === isTopLevel(state.scenarios.find((s) => s.id === id))).sort((a, b) => (a.sort || 0) - (b.sort || 0));
    const idx = list.findIndex((x) => x.id === id);
    const swapWith = idx + direction;
    if (swapWith < 0 || swapWith >= list.length) return;
    const a = list[idx], b = list[swapWith];
    const tmp = a.sort || 0;
    a.sort = b.sort || 0; b.sort = tmp || Date.now();
    a.updatedAt = b.updatedAt = Date.now();
    await storage.putScenario(a); await storage.putScenario(b);
    await reloadScenarios();
    renderSettingsSheet(); renderHomeScenarios();
  };
  if (kind === 'scenario') {
    row.querySelector('[data-act="up"]')?.addEventListener('click', () => reorder(-1));
    row.querySelector('[data-act="down"]')?.addEventListener('click', () => reorder(+1));
  } else if (kind === 'btype') {
    const btReorder = async (direction) => {
      const list = (state.briefingTypes || []).slice().sort((a, b) => (a.sort || 0) - (b.sort || 0));
      const idx = list.findIndex((x) => x.id === id);
      const swapWith = idx + direction;
      if (swapWith < 0 || swapWith >= list.length) return;
      const a = list[idx], b = list[swapWith];
      const tmp = a.sort || 0;
      a.sort = b.sort || 0; b.sort = tmp || Date.now();
      a.updatedAt = b.updatedAt = Date.now();
      await storage.putBriefingType(a); await storage.putBriefingType(b);
      state.briefingTypes = await storage.listBriefingTypes();
      renderSettingsSheet(); renderHomeBtypes();
    };
    row.querySelector('[data-act="up"]')?.addEventListener('click', () => btReorder(-1));
    row.querySelector('[data-act="down"]')?.addEventListener('click', () => btReorder(+1));
  }
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
  // Parent linkage moved to chip group above; legacy select removed.
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
  renderLibrary(); renderStorageInfo(); renderHomeResults();
  if (els.settingsOverlay && !els.settingsOverlay.classList.contains('hidden')) renderSettingsLibrary();
}

async function handlePersonalFiles(files) {
  const docType = els.personalInput.dataset.docType || 'personal';
  delete els.personalInput.dataset.docType;
  for (const file of files) {
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setIngestStatus(`Skipped ${file.name}: not a PDF`, 'warn');
      continue;
    }
    let meta;
    if (docType === 'manual') {
      // Manuals get the proper metadata prompt so we can resolve cross-
      // references against the right family (OMA / QRH / FCOM / FCTM / MEL).
      meta = await askManualMeta(file);
      if (!meta) { setIngestStatus(`Skipped ${file.name}.`, 'warn'); continue; }
      meta.docType = 'manual';
    } else {
      meta = { manualType: 'PERSONAL', revision: '', effectivity: [], docType };
    }
    const fileId = await processImport(file, meta);
    if (fileId && docType === 'personal') {
      const created = await autoCatalogFromOutline(fileId, file.name);
      if (created > 0) toast(`Cataloged ${created} briefing${created === 1 ? '' : 's'} from ${file.name}.`);
    }
  }
  await storage.requestPersistent();
  renderLibrary(); renderStorageInfo();
  renderHomeBtypes(); renderHomeScenarios(); renderHomeResults();
  if (els.settingsOverlay && !els.settingsOverlay.classList.contains('hidden')) renderSettingsLibrary();
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
      docType: (meta && meta.docType) || (meta && meta.manualType === 'PERSONAL' ? 'personal' : 'manual'),
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

// One-tap "Link selected text to a briefing/scenario". Lightweight popup —
// pick a scenario (or create one), and the selection becomes an indexed
// anchor tagged with that scenario + the active phase.
function openScenarioLinkPicker(fileId, pageNum, text, rects) {
  if (!text || !text.trim()) { toast('Selection is empty.'); return; }
  const list = state.scenarios || [];
  // Reuse the indexer overlay shell with a focused picker UI.
  els.indexerBody.innerHTML = `
    <div class="field">
      <label>Link selection to briefing <span class="admin-sub">— page ${pageNum}</span></label>
      <div class="ix-quote">${escapeHtml(text.slice(0, 200))}${text.length > 200 ? '…' : ''}</div>
    </div>
    <div class="field">
      <label>Pick one or more</label>
      <div class="dim-chips" id="ix-link-list">
        ${list.length
          ? list.map((s) => `<button type="button" class="dim-chip" data-id="${escapeHtml(s.id)}" ${s.color ? `style="--c:${escapeHtml(s.color)}"` : ''}>${s.parentId ? '↳ ' : ''}${escapeHtml(s.name)}</button>`).join('')
          : '<span class="admin-sub">No briefings yet — create one first via ⚙ Settings or ＋ New on the home screen.</span>'}
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn" id="ix-link-cancel">Cancel</button>
      <button class="btn primary" id="ix-link-save">Link</button>
    </div>`;
  els.indexerOverlay.classList.remove('hidden');
  const onClick = async (e) => {
    const chip = e.target.closest('.dim-chip');
    if (chip && els.indexerBody.contains(chip)) { chip.classList.toggle('on'); return; }
    if (e.target.id === 'ix-link-cancel') { els.indexerOverlay.classList.add('hidden'); return; }
    if (e.target.id === 'ix-link-save') {
      const picked = [...els.indexerBody.querySelectorAll('#ix-link-list .dim-chip.on')].map((c) => c.getAttribute('data-id'));
      if (!picked.length) { toast('Pick at least one briefing.'); return; }
      const m = state.manuals.get(fileId);
      await storage.putAnchor({
        anchorId: 'idx_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        fileId, manualType: m ? m.manualType : 'PERSONAL',
        kind: 'idx', itemType: 'briefing', source: 'selection',
        paraIndex: null, selectionRects: rects || null,
        pageNum, anchorType: 'page', value: 'p.' + pageNum,
        title: text.slice(0, 60), excerpt: text.slice(0, 600),
        textHash: paragraphHash(text),
        phases: state.selectedPhase ? [state.selectedPhase] : [],
        briefingTypes: [], scenarios: picked,
        aiSuggested: null, aiAccepted: false,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
      kg.invalidate(); await kg.load(true);
      els.indexerOverlay.classList.add('hidden');
      renderHomeResults();
      toast(`Linked to ${picked.length} briefing${picked.length === 1 ? '' : 's'}.`);
    }
  };
  if (els.indexerBody._handler) els.indexerBody.removeEventListener('click', els.indexerBody._handler);
  els.indexerBody._handler = onClick;
  els.indexerBody.addEventListener('click', onClick);
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
  els.viewerOverlay.classList.remove('split');
  state.viewer.split = false;
  // Reset zoom each time the viewer opens.
  els.pdfPanes.dataset.zoom = '1';
  els.pdfPanes.querySelectorAll('.pdf-pane').forEach((p) => { p.style.transform = ''; });
  // Sidebar (outline) defaults to open whenever the viewer is launched.
  els.viewerSidebar.classList.remove('hidden');
  els.sidebarToggle.setAttribute('aria-pressed', 'true');
  renderViewerTabs();
  renderTabDock();
  await refreshViewer();
  // Render the outline now so it's already populated.
  try { renderSidebar(); } catch (_) {}
}

// Viewer zoom — applies a CSS transform: scale to each .pdf-pane. Clamped
// to [0.5, 3]. Driven by both the toolbar ＋/− buttons and a pinch handler
// installed on #pdf-panes (see installViewerPinchZoom below).
function setViewerZoom(z) {
  const next = Math.max(0.5, Math.min(3, +z.toFixed(2)));
  els.pdfPanes.dataset.zoom = next;
  els.pdfPanes.querySelectorAll('.pdf-pane').forEach((p) => {
    p.style.transform = `scale(${next})`;
    p.style.transformOrigin = 'top center';
  });
}
function applyViewerZoom(delta) {
  setViewerZoom((parseFloat(els.pdfPanes.dataset.zoom || '1') || 1) + delta);
}

// Two-finger pinch: track up to two pointers; when both are down, scale
// the .pdf-pane by the ratio of the current finger distance over the
// starting distance. Falls back to normal touch-scroll with one pointer.
function installViewerPinchZoom() {
  const el = els.pdfPanes;
  if (!el) return;
  const pointers = new Map(); // pointerId → {x, y}
  let startDist = 0;
  let startZoom = 1;
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      startDist = Math.hypot(a.x - b.x, a.y - b.y);
      startZoom = parseFloat(el.dataset.zoom || '1') || 1;
      // Disable transitions during pinch for responsiveness.
      el.querySelectorAll('.pdf-pane').forEach((p) => { p.style.transition = 'none'; });
    }
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'touch') return;
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (startDist > 0) {
        const ratio = d / startDist;
        setViewerZoom(startZoom * ratio);
        e.preventDefault();
      }
    }
  });
  const end = (e) => {
    if (e.pointerType !== 'touch') return;
    pointers.delete(e.pointerId);
    if (pointers.size < 2) {
      startDist = 0;
      el.querySelectorAll('.pdf-pane').forEach((p) => { p.style.transition = ''; });
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', end);
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
      onScenarioSelection: (pageNum, text, rects) => openScenarioLinkPicker(tab.fileId, pageNum, text, rects),
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

// Wipe every scenario + indexed anchor and replay the curated Tanchum seed.
// Resolves to the first personal file (or imports the bundled PDF if there
// isn't one yet) so the new anchors all point at a real document.
async function resetToCuratedBriefings() {
  if (!confirm('Wipe every briefing & indexed paragraph, then re-create the curated set from the Tanchum book?')) return;
  toast('Resetting briefings…');
  try {
    // Drop all existing scenarios + idx anchors.
    const scenarios = await storage.listScenarios();
    for (const s of scenarios) await storage.deleteScenario(s.id);
    const anchors = await storage.getAllAnchors();
    for (const a of anchors) if (a.kind === 'idx') await storage.deleteAnchor(a.anchorId);
    state.scenarios = [];

    // Pick a target file. Prefer one already imported; otherwise ingest the
    // bundled PDF.
    let fileId = [...state.files.values()].find((f) => /tanchum|nachum|pilot 737/i.test(f.name || ''))?.id;
    if (!fileId) fileId = [...state.files.values()][0]?.id;
    if (!fileId) {
      const resp = await fetch('./seed-data/tanchum-737-upgrade.pdf', { cache: 'force-cache' });
      if (!resp.ok) throw new Error('bundled pdf missing');
      const blob = await resp.blob();
      const file = new File([blob], 'Pilot 737 Upgrade.pdf', { type: 'application/pdf' });
      fileId = await processImport(file, { manualType: 'PERSONAL', revision: '', effectivity: [], docType: 'personal' });
    }

    const seedMod = await import('./seed-data/tanchum-seed.js?t=' + Date.now());
    const seed = seedMod.TANCHUM_SEED;
    const btypes = await storage.listBriefingTypes();
    const btypeMap = {
      normal:    btypes.find((b) => /^normal/i.test(b.name))?.id,
      nonnormal: btypes.find((b) => /non.?normal/i.test(b.name))?.id,
      briefing:  btypes.find((b) => /^briefing/i.test(b.name))?.id,
    };
    for (const s of seed.scenarios) {
      const btypeIds = (s.briefingTypes || []).map((slug) => btypeMap[slug]).filter(Boolean);
      await storage.putScenario({
        id: s.id, name: s.name, parentId: s.parentId, parentIds: s.parentIds || [],
        phases: s.phases || [], briefingTypes: btypeIds,
        color: s.color, kind: s.kind || 'normal',
        sort: s.sort, createdAt: Date.now(), updatedAt: Date.now(),
      });
    }
    for (const a of seed.anchors) {
      await storage.putAnchor({
        anchorId: a.id, fileId, manualType: 'PERSONAL',
        kind: 'idx', itemType: 'briefing', source: 'manual',
        paraIndex: null, selectionRects: null,
        pageNum: a.pageNum, anchorType: 'page', value: 'p.' + a.pageNum,
        title: a.title, excerpt: a.title,
        textHash: 'h_curated_' + a.id,
        phases: a.phases || [],
        briefingTypes: btypeMap[a.btype] ? [btypeMap[a.btype]] : [],
        scenarios: a.scenarios || [],
        links: a.refs || [],
        aiSuggested: null, aiAccepted: false,
        createdAt: Date.now(), updatedAt: Date.now(),
      });
    }
    await reloadScenarios();
    kg.invalidate(); await kg.load(true);
    // Drop any home-state selections that referred to deleted ids.
    state.selectedTopBriefing = null; state.selectedSubBriefing = null;
    renderHomeBtypes(); renderHomeScenarios(); renderHomeResults();
    renderSettingsSheet();
    toast(`Reset: ${seed.scenarios.length} briefings, ${seed.anchors.length} indexed topics.`);
  } catch (e) {
    console.error('reset failed', e);
    toast('Reset failed: ' + (e.message || e).slice(0, 100));
  }
}

// Walks a freshly-ingested personal PDF's bookmark outline and writes its
// structure as briefings + sub-briefings + indexed anchors. Skips silently
// when the PDF carries no outline. Cross-reference extraction stays for
// the desktop seed builder — here we only seed the structure.
async function autoCatalogFromOutline(fileId, fileName) {
  try {
    const { pdfjsLib } = await import('./modules/pdf-ingest.js');
    const file = await storage.getFile(fileId);
    if (!file || !file.blob) return 0;
    const buf = await file.blob.arrayBuffer();
    const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
    const outline = await doc.getOutline();
    if (!outline || !outline.length) return 0;

    // Resolve a destination to its page number (1-based).
    const pageOf = async (item) => {
      let dest = item.dest;
      if (typeof dest === 'string') dest = await doc.getDestination(dest);
      if (!Array.isArray(dest)) return null;
      const idx = await doc.getPageIndex(dest[0]);
      return Number.isFinite(idx) ? idx + 1 : null;
    };

    // Flatten to {depth, title, page} with the bookmark tree's natural order.
    const flat = [];
    const walk = async (items, depth) => {
      for (const it of items || []) {
        const page = await pageOf(it);
        flat.push({ depth, title: String(it.title || '').trim(), page });
        if (it.items && it.items.length) await walk(it.items, depth + 1);
      }
    };
    await walk(outline, 0);
    if (!flat.length) return 0;

    // Re-use the same depth → kind mapping as _build_seed.py: depth 0 →
    // top-level briefing; depth 1 with depth-2 children → sub-briefing;
    // leaves at any depth → indexed anchor on that page.
    let curTop = null, curSub = null;
    let created = 0;
    for (let i = 0; i < flat.length; i++) {
      const o = flat[i];
      if (!o.page || !o.title) continue;
      if (o.depth === 0) {
        const id = 'sc_auto_' + Math.random().toString(36).slice(2, 9);
        curTop = id; curSub = null;
        await storage.putScenario({
          id, name: o.title, parentId: null, parentIds: [],
          phases: [], briefingTypes: [],
          color: '#7aa3ff', kind: 'normal',
          sort: Date.now() + i, createdAt: Date.now(), updatedAt: Date.now(),
        });
        created++;
      } else if (o.depth === 1) {
        const hasKids = i + 1 < flat.length && flat[i + 1].depth >= 2;
        if (hasKids && curTop) {
          const id = 'sc_auto_' + Math.random().toString(36).slice(2, 9);
          curSub = id;
          await storage.putScenario({
            id, name: o.title, parentId: null, parentIds: [curTop],
            phases: [], briefingTypes: [],
            color: '#ffb84d', kind: 'normal',
            sort: Date.now() + i, createdAt: Date.now(), updatedAt: Date.now(),
          });
        } else {
          // Leaf at depth 1 → anchor under the current top.
          curSub = null;
          await putAnchorForOutlineLeaf({ fileId, fileName, title: o.title, pageNum: o.page, scenarios: curTop ? [curTop] : [] });
        }
      } else {
        await putAnchorForOutlineLeaf({
          fileId, fileName, title: o.title, pageNum: o.page,
          scenarios: [curSub, curTop].filter(Boolean),
        });
      }
    }
    await reloadScenarios();
    kg.invalidate(); await kg.load(true);
    return created;
  } catch (e) {
    console.warn('autoCatalogFromOutline failed:', e);
    return 0;
  }
}
async function putAnchorForOutlineLeaf({ fileId, fileName, title, pageNum, scenarios }) {
  await storage.putAnchor({
    anchorId: 'idx_auto_' + Math.random().toString(36).slice(2, 9),
    fileId, manualType: 'PERSONAL',
    kind: 'idx', itemType: 'briefing', source: 'manual',
    paraIndex: null, selectionRects: null,
    pageNum, anchorType: 'page', value: 'p.' + pageNum,
    title, excerpt: title,
    textHash: 'h_auto_' + Math.random().toString(36).slice(2, 9),
    phases: [], briefingTypes: [], scenarios,
    links: [], aiSuggested: null, aiAccepted: false,
    createdAt: Date.now(), updatedAt: Date.now(),
  });
}

// First-launch bundled content. Fetches the Tanchum 737 upgrade PDF +
// pre-built scenario tree from /seed-data and writes them into storage,
// so a freshly installed app already has working briefings + indexed
// anchors with cross-reference chips.
async function loadBundledTanchumOnce() {
  const resp = await fetch('./seed-data/tanchum-737-upgrade.pdf', { cache: 'force-cache' });
  if (!resp.ok) throw new Error('bundled pdf missing');
  const blob = await resp.blob();
  const file = new File([blob], 'Pilot 737 Upgrade.pdf', { type: 'application/pdf' });
  toast('Setting up your briefings…');
  const fileId = await processImport(file, {
    manualType: 'PERSONAL', revision: '', effectivity: [], docType: 'personal',
  });
  if (!fileId) throw new Error('ingest failed');
  // Pull in the precomputed scenario tree.
  const seedMod = await import('./seed-data/tanchum-seed.js');
  const seed = seedMod.TANCHUM_SEED;
  const btypes = await storage.listBriefingTypes();
  const btypeMap = {
    normal:    btypes.find((b) => /^normal/i.test(b.name))?.id,
    nonnormal: btypes.find((b) => /non.?normal/i.test(b.name))?.id,
    briefing:  btypes.find((b) => /^briefing/i.test(b.name))?.id,
  };
  for (const s of seed.scenarios) {
    const btypeIds = (s.briefingTypes || []).map((slug) => btypeMap[slug]).filter(Boolean);
    await storage.putScenario({
      id: s.id, name: s.name, parentId: s.parentId, parentIds: s.parentIds || [],
      phases: s.phases || [], briefingTypes: btypeIds,
      color: s.color, kind: s.kind || 'normal',
      sort: s.sort, createdAt: Date.now(), updatedAt: Date.now(),
    });
  }
  for (const a of seed.anchors) {
    await storage.putAnchor({
      anchorId: a.id, fileId, manualType: 'PERSONAL',
      kind: 'idx', itemType: 'briefing', source: 'manual',
      paraIndex: null, selectionRects: null,
      pageNum: a.pageNum, anchorType: 'page', value: 'p.' + a.pageNum,
      title: a.title, excerpt: a.title,
      textHash: 'h_bundled_' + a.id,
      phases: a.phases || [],
      briefingTypes: btypeMap[a.btype] ? [btypeMap[a.btype]] : [],
      scenarios: a.scenarios || [],
      links: a.refs || [],
      aiSuggested: null, aiAccepted: false,
      createdAt: Date.now(), updatedAt: Date.now(),
    });
  }
  // Refresh in-memory state for the rest of bootstrap to pick up.
  state.scenarios = await storage.listScenarios();
  toast('Briefings ready.');
}

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
