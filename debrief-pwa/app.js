// app.js — Thermal Debrief orchestration.
//
// The 3D canvas is the app; this module wires everything that floats over it.
// Data flows one way:
//
//   IGC text → igc.parseIGC → metrics.analyse → terrain.attachTerrain
//            → highlights.detectHighlights → { map3d, charts, DOM }
//
// and one clock (modules/timeline.js) drives every animated surface, so the
// markers, the chart playhead and the readouts cannot drift apart.
//
// Vanilla ES modules, no framework, no build step — same as the rest of the
// suite (see CLAUDE.md).

import { parseIGC, looksLikeIGC } from './modules/igc.js';
import { analyse, computeMetrics } from './modules/metrics.js';
import { detectHighlights, HIGHLIGHT_META, rankAcrossTracks } from './modules/highlights.js';
import { attachTerrain } from './modules/terrain.js';
import { COLOR_MODES, DEFAULT_MODE, TRACK_COLORS, legendGradient, modeValue, rgbCss } from './modules/colors.js';
import { analyseDay, pilotInsights, gradeFlight, xcScore, compareTracks, versusDay, invalidate as invalidateInsights } from './modules/insights.js';
import { Timeline, SPEEDS } from './modules/timeline.js';
import * as Map3D from './modules/map3d.js';
import * as Charts from './modules/charts.js';
import * as Store from './modules/store.js';
import * as Exporter from './modules/exporter.js';
import { demoFlights } from './modules/demo.js';
import * as XC from './modules/xcontest.js';
import * as Share from './modules/share.js';
import { installResumeHardening } from './modules/resume.js';
import { fmtAlt, fmtClock, fmtClockShort, fmtDate, fmtDist, fmtDuration, fmtGlide, fmtSpeed, fmtAgl } from './modules/format.js';

/** The spec's ceiling: two to four tracks is a comparison, more is a mess. */
const MAX_TRACKS = 4;
/** Sentinel for "show every flying day at once" — distinct from "unset". */
const ALL_DAYS = 'all';
/** Readouts refresh at 12 Hz — the clock runs at 60, but text can't be read that fast. */
const READOUT_MS = 80;

const $ = (id) => document.getElementById(id);

const state = {
  /** @type {import('./types').FlightTrack[]} */
  tracks: [],
  colorMode: Store.pref('colorMode', DEFAULT_MODE),
  altMode: Store.pref('altMode', 'msl'),
  basemap: Store.pref('basemap', 'satellite'),
  chartVisible: Store.pref('chart', '1') === '1',
  fetchTerrain: Store.pref('terrain', '1') === '1',
  chartGeo: null,
  /**
   * Which flying day is on screen: an ISO date, or null meaning "all days at
   * once". Flights from different days are separated by default — overlaying
   * them puts gliders on screen that were never in the air together, and the
   * UTC clock spans the gap between the dates. Showing them together is an
   * explicit choice, not the default.
   */
  dateFilter: null,
  /** View state from a share link, applied once the map and tracks are ready. */
  pendingView: null,
  mapReady: false,
  recording: false,
  lastReadout: 0,
  scrubbing: false,
};

const timeline = new Timeline();

// ── boot ────────────────────────────────────────────────────────────────────

boot();

function boot() {
  populateBasemaps();
  renderColorChips();
  renderSpeedChips();
  renderLegend();
  wireEvents();
  syncLayerControls();

  installResumeHardening({
    // Never yank the page out from under a recording or an active replay.
    canReload: () => !state.recording && !timeline.playing,
  });

  // The map is the slow part; start it immediately and restore flights in
  // parallel so a returning pilot sees their tracks as soon as the GL context
  // is up rather than waiting on two serial round-trips.
  const mapBoot = Map3D.init('map', { onPick: onMapPick })
    .then(() => {
      state.mapReady = true;
      Map3D.setBasemap(state.basemap);
      Map3D.setColorMode(state.colorMode);
      // Flights may have finished loading while the GL context was still
      // starting; without this they'd sit in state with nothing on the map.
      if (state.tracks.length) {
        Map3D.setTracks(state.tracks);
        // A share link brings its own camera; fitting here would start an eased
        // move that keeps running and overwrites it a moment later.
        if (!state.pendingView) Map3D.fitTracks(state.tracks);
        Map3D.setMarkers(timeline.snapshot());
      }
    })
    .catch((err) => {
      showStatus(err.message, 'error', 0);
    });

  Promise.all([mapBoot.catch(() => {}), restoreSession()])
    .then(() => {
      // A shared view supplies its own camera, so don't fit over the top of it.
      if (state.tracks.length) refreshAll({ fit: !state.pendingView });
      if (state.pendingView || state.consumedShare) applySharedView(state.pendingView);
      registerServiceWorker();
    });

  timeline.on('tick', onTick);
  timeline.on('state', onTransportState);
  timeline.on('domain', () => { renderChart(); updateTimeReadout(); });
}

/**
 * Offline support in production; deliberately disabled on localhost.
 *
 * The service worker precaches every module by name, so during development it
 * serves yesterday's code no matter how hard you reload — exactly the stale-ES-
 * module trap dev-server.py exists to avoid. On localhost we instead tear down
 * any worker a previous run installed.
 */
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  const isDev = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  if (isDev) {
    navigator.serviceWorker.getRegistrations()
      .then((regs) => Promise.all(regs.map((r) => r.unregister())))
      .then((done) => {
        if (!done.length) return;
        return caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
      })
      .catch(() => { /* nothing installed */ });
    return;
  }

  navigator.serviceWorker.register('sw.js').catch(() => { /* offline support is a bonus */ });
}

/**
 * A share link wins over the saved session: someone followed a link to see a
 * specific moment, and restoring their own flights instead would be wrong.
 */
async function restoreSession() {
  const { token, view } = Share.readHash();

  if (token) {
    showStatus('Opening shared flight…', 'busy', 0);
    try {
      const bundle = await Share.loadShare(token);
      for (const f of bundle.flights.slice(0, MAX_TRACKS)) {
        const track = buildTrack(f.igc, {
          id: f.id, color: f.color, fileName: f.fileName, pilotName: f.pilotName,
        });
        state.tracks.push(track);
        // Save locally so the recipient keeps the flights after the link expires.
        Store.saveFlight({
          id: track.id, igc: f.igc, pilotName: track.pilotName,
          color: track.color, fileName: track.fileName, date: track.date,
        });
      }
      state.pendingView = bundle.view || view;
      state.consumedShare = true;
      setEmptyVisible(false);
      rememberActive();
      resolveTerrain(state.tracks);
      showStatus(`Shared flight: ${state.tracks.map((t) => t.pilotName).join(', ')}`, '', 3600);
      return;
    } catch (err) {
      // Leave the link in the address bar: it's the only copy of the token, and
      // the pilot may want to retry it or send it back to whoever shared it.
      showStatus(err.message, 'error', 7000);
      // Fall through to the normal restore so the app is still usable.
    }
  } else if (view) {
    // View-only link: apply it to whatever the recipient already has loaded.
    state.pendingView = view;
    state.consumedShare = true;
  }

  const ids = Store.pref('active', '').split(',').filter(Boolean);
  if (!ids.length) return;
  const saved = await Store.listFlights();
  const byId = new Map(saved.map((r) => [r.id, r]));

  for (const id of ids.slice(0, MAX_TRACKS)) {
    const rec = byId.get(id);
    if (!rec) continue;
    try {
      const track = buildTrack(rec.igc, {
        id: rec.id, color: rec.color, fileName: rec.fileName, pilotName: rec.pilotName,
      });
      state.tracks.push(track);
    } catch { /* a corrupt record shouldn't block the whole restore */ }
  }
  if (state.tracks.length) {
    setEmptyVisible(false);
    resolveTerrain(state.tracks);
  }
}

// ── loading flights ─────────────────────────────────────────────────────────

/**
 * Parse + analyse one IGC file into a ready-to-render track. Synchronous, so
 * terrain (which needs the network) is attached separately by resolveTerrain().
 */
function buildTrack(igcText, meta) {
  const track = parseIGC(igcText, meta);
  analyse(track);
  track.highlights = detectHighlights(track);
  return track;
}

/** @param {FileList|File[]} files */
async function addFiles(files) {
  const list = [...files].filter((f) => f && f.size);
  if (!list.length) return;

  const room = MAX_TRACKS - state.tracks.length;
  if (room <= 0) {
    showStatus(`Four flights is the limit — remove one first.`, 'warn');
    return;
  }
  const take = list.slice(0, room);
  if (list.length > room) {
    showStatus(`Loading ${room} of ${list.length} files — four is the limit.`, 'warn');
  }

  showStatus(`Reading ${take.length} file${take.length > 1 ? 's' : ''}…`, 'busy', 0);
  const added = [];
  const failed = [];

  for (const file of take) {
    try {
      const text = await file.text();
      if (!looksLikeIGC(text)) throw new Error('not an IGC log');
      const track = buildTrack(text, {
        color: nextColor(),
        fileName: file.name,
      });
      state.tracks.push(track);
      added.push(track);
      // Persist raw text: cheap, and it survives every future schema change.
      Store.saveFlight({
        id: track.id, igc: text, pilotName: track.pilotName,
        color: track.color, fileName: file.name, date: track.date,
      });
    } catch (err) {
      failed.push(`${file.name}: ${err.message}`);
    }
  }

  if (!added.length) {
    showStatus(failed[0] || 'Could not read those files.', 'error', 6000);
    return;
  }

  setEmptyVisible(false);
  focusDayOf(added);
  refreshAll({ fit: true });
  rememberActive();

  if (failed.length) {
    showStatus(`Loaded ${added.length}, skipped ${failed.length}. ${failed[0]}`, 'warn', 6000);
  } else {
    const names = added.map((t) => t.pilotName).join(', ');
    showStatus(`Loaded ${names}`, '', 2600);
  }

  resolveTerrain(added);
}

function loadDemo() {
  // The demo is a different flying day from anything already loaded, which the
  // day filter now handles — so it only needs room, not an empty app.
  const files = demoFlights().map((f) => new File([f.igc], f.fileName, { type: 'text/plain' }));
  if (state.tracks.length >= MAX_TRACKS) {
    showStatus('Four flights is the limit — remove one first.', 'warn');
    return;
  }
  addFiles(files);
}

/**
 * Ground elevation arrives after the track is already on screen: it needs the
 * network, and the flight is perfectly usable in MSL without it. Once it lands
 * we recompute the metrics that depend on AGL and re-run highlight detection,
 * because LOW_SAVE simply cannot be found without terrain.
 */
async function resolveTerrain(tracks) {
  if (!state.fetchTerrain) { renderTerrainNote(); return; }
  const pending = tracks.filter((t) => !t.hasTerrain);
  if (!pending.length) return;

  let got = 0;
  for (const track of pending) {
    // The pilot may have removed the flight while we were waiting.
    if (!state.tracks.includes(track)) continue;
    const ok = await attachTerrain(track);
    if (!ok) continue;
    got++;
    track.metrics = computeMetrics(track);
    track.highlights = detectHighlights(track);
    // Terrain resets the phase segmentation, which the insights are built on.
    invalidateInsights(track);
  }

  if (!got) {
    const why = pending.find((t) => t.terrainError);
    showStatus(
      `Ground elevation unavailable${why ? ` (${why.terrainError})` : ''} — showing altitude above sea level.`,
      'warn', 5000);
    renderTerrainNote();
    return;
  }
  refreshAll();
  renderTerrainNote();
}

function nextColor() {
  const used = new Set(state.tracks.map((t) => t.color));
  return TRACK_COLORS.find((c) => !used.has(c)) || TRACK_COLORS[state.tracks.length % TRACK_COLORS.length];
}

function removeTrack(id) {
  const i = state.tracks.findIndex((t) => t.id === id);
  if (i < 0) return;
  state.tracks.splice(i, 1);
  rememberActive();
  if (!state.tracks.length) {
    timeline.pause();
    setEmptyVisible(true);
  }
  refreshAll({ fit: false });
}

function rememberActive() {
  Store.setPref('active', state.tracks.map((t) => t.id).join(','));
}

// ── the one refresh path ────────────────────────────────────────────────────

/** Push current state into every surface. Cheap enough to call on any change. */
function refreshAll(opts = {}) {
  applyVisibility();
  if (state.mapReady) {
    Map3D.setTracks(state.tracks);
    if (opts.fit) Map3D.fitTracks(state.tracks);
  }
  timeline.setTracks(state.tracks);

  // Absolute sync across different days puts one glider on screen at a time.
  if (state.tracks.length > 1 && timeline.mode === 'absolute' && !timeline.absoluteViable()) {
    timeline.setSyncMode('relative');
    showStatus('Different days — switched to launch-relative sync.', 'warn', 4200);
  }

  setDockVisible(state.tracks.length > 0);
  renderDateChips();
  renderPills();
  renderChart();
  renderHighlightList();
  renderStats();
  renderInsights();
  renderClipOptions();
  renderTerrainNote();
  updateTransportEnabled();
  updateTimeReadout();
  onTick(timeline.snapshot());
}

// ── per-frame ───────────────────────────────────────────────────────────────

function onTick(snapshot) {
  if (state.mapReady) Map3D.setMarkers(snapshot);
  if (state.chartVisible && state.chartGeo) {
    Charts.drawOverlay($('chart-overlay'), state.chartGeo, { snapshot, altMode: state.altMode });
  }
  if (!state.scrubbing) {
    const f = timeline.fraction();
    const scrub = $('scrubber');
    scrub.value = String(Math.round(f * 1000));
    scrub.style.setProperty('--fill', `${(f * 100).toFixed(1)}%`);
  }

  // Text can't be read at 60 Hz, and rewriting it costs layout every frame.
  const now = performance.now();
  if (now - state.lastReadout > READOUT_MS) {
    state.lastReadout = now;
    updateTimeReadout();
    updatePillReadouts(snapshot);
  }
}

function onTransportState(st) {
  const playing = st.playing;
  $('tp-play-icon').innerHTML = playing
    ? '<path d="M6 4h4v16H6zM14 4h4v16h-4z"/>'
    : '<path d="M7 4l13 8-13 8z"/>';
  $('tp-play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
  for (const chip of $('speed-chips').children) {
    chip.classList.toggle('active', Number(chip.dataset.speed) === st.speed);
  }
  const rel = st.mode === 'relative';
  $('sync-label').textContent = rel ? 'T+0' : 'UTC';
  $('sync-toggle').classList.toggle('rel', rel);
  $('sync-toggle').title = rel
    ? 'Relative Start Sync — all flights aligned to their own launch. Tap for UTC.'
    : 'Absolute Time Sync — flights aligned by UTC clock. Tap for launch-relative.';
}

function updateTimeReadout() {
  const el = $('time-readout');
  if (!state.tracks.length) { el.textContent = '—'; return; }
  el.textContent = timeline.mode === 'absolute'
    ? `${fmtClock(timeline.time)}Z`
    : `+${fmtDuration(timeline.time / 1000)}`;
}

function updatePillReadouts(snapshot) {
  for (const { track, sample } of snapshot.tracks) {
    const el = document.querySelector(`.pill[data-id="${track.id}"] .pill-read`);
    if (!el) continue;
    if (!sample) { el.innerHTML = '<span>—</span>'; continue; }
    const extra = state.altMode === 'agl' && typeof sample.agl === 'number'
      ? fmtAgl(sample.agl)
      : fmtAlt(sample.alt);
    el.innerHTML = `<b>${extra}</b> · ${modeValue(state.colorMode, sample)}`;
  }
}

// ── rendering: dock ─────────────────────────────────────────────────────────

function renderPills() {
  const host = $('track-pills');
  host.innerHTML = '';
  for (const track of state.tracks) {
    const pill = document.createElement('div');
    pill.className = `pill${track.visible === false ? ' off' : ''}`;
    pill.dataset.id = track.id;

    const dot = document.createElement('span');
    dot.className = 'pill-dot';
    dot.style.background = track.color;

    const name = document.createElement('button');
    name.className = 'pill-name';
    name.style.cssText = 'background:none;border:0;padding:0;font:inherit;font-weight:700;';
    name.textContent = track.pilotName;
    name.title = 'Show / hide this flight';
    name.addEventListener('click', () => toggleTrack(track));

    const read = document.createElement('span');
    read.className = 'pill-read';
    read.innerHTML = '<span>—</span>';

    const close = document.createElement('button');
    close.className = 'pill-x';
    close.textContent = '✕';
    close.setAttribute('aria-label', `Remove ${track.pilotName}`);
    close.addEventListener('click', () => removeTrack(track.id));

    pill.append(dot, name, read, close);
    host.appendChild(pill);
  }
}

function toggleTrack(track) {
  // `userHidden` is intent; `visible` is the result of that intent AND the day
  // filter. Keeping them separate means switching days doesn't silently forget
  // that a pilot was hidden, and un-hiding doesn't drag in another day.
  track.userHidden = !track.userHidden;
  applyVisibility();
  refreshAll();
}

/** Distinct flying days across the loaded flights, newest first. */
function loadedDates() {
  return [...new Set(state.tracks.map((t) => t.date))].sort().reverse();
}

/**
 * Resolve each track's `visible` from the user's intent and the active day.
 *
 * `dateFilter` has three states, and they must stay distinct: `null` means the
 * pilot hasn't chosen (so pick the newest day for them), `ALL_DAYS` means they
 * deliberately asked to see everything at once, and an ISO date means that day.
 * Conflating "unset" with "show all" makes the All days button undo itself.
 */
function applyVisibility() {
  const dates = loadedDates();
  // A filter naming a day that is no longer loaded would hide everything.
  if (state.dateFilter && state.dateFilter !== ALL_DAYS && !dates.includes(state.dateFilter)) {
    state.dateFilter = null;
  }
  // With several days loaded and no choice yet, show the most recent one.
  if (state.dateFilter === null && dates.length > 1) state.dateFilter = dates[0];

  for (const t of state.tracks) {
    const dayOk = state.dateFilter === null
      || state.dateFilter === ALL_DAYS
      || t.date === state.dateFilter;
    t.visible = dayOk && !t.userHidden;
  }
}

/**
 * Jump to the day the just-loaded flights belong to.
 *
 * Without this, importing a flight from a different day than the one on screen
 * would appear to do nothing — it would load, then be filtered straight out.
 * If the new flights span several days there is no single day to show, so fall
 * back to showing everything.
 */
function focusDayOf(tracks) {
  const dates = [...new Set((tracks || []).map((t) => t.date))];
  if (dates.length === 1) state.dateFilter = dates[0];
  else if (dates.length > 1) state.dateFilter = ALL_DAYS;
}

function setDateFilter(value) {
  state.dateFilter = value;
  applyVisibility();
  refreshAll({ fit: true });
}

function renderDateChips() {
  const host = $('date-chips');
  const dates = loadedDates();

  // One flying day is the normal case — no chips, no clutter.
  if (dates.length < 2) { host.hidden = true; host.innerHTML = ''; return; }
  host.hidden = false;
  host.innerHTML = '';

  const chip = (label, value, title) => {
    const b = document.createElement('button');
    b.className = `date-chip${state.dateFilter === value ? ' active' : ''}`;
    b.textContent = label;
    b.title = title;
    b.setAttribute('role', 'tab');
    b.setAttribute('aria-selected', String(state.dateFilter === value));
    b.addEventListener('click', () => setDateFilter(value));
    host.appendChild(b);
  };

  for (const d of dates) {
    const n = state.tracks.filter((t) => t.date === d).length;
    chip(`${fmtDate(d)}${n > 1 ? ` · ${n}` : ''}`, d, `Show only ${fmtDate(d)}`);
  }
  chip('All days', ALL_DAYS,
    'Overlay every loaded day at once — useful for comparing lines flown on different days');
}

function renderColorChips() {
  const host = $('color-chips');
  host.innerHTML = '';
  for (const mode of COLOR_MODES) {
    const chip = document.createElement('button');
    chip.className = `layer-chip${mode.id === state.colorMode ? ' active' : ''}`;
    chip.textContent = mode.label;
    chip.title = mode.help;
    chip.setAttribute('role', 'tab');
    chip.setAttribute('aria-selected', String(mode.id === state.colorMode));
    chip.addEventListener('click', () => setColorMode(mode.id));
    host.appendChild(chip);
  }
}

function setColorMode(id) {
  state.colorMode = id;
  Store.setPref('colorMode', id);
  renderColorChips();
  renderLegend();
  if (state.mapReady) Map3D.setColorMode(id);
  renderChart();
  updatePillReadouts(timeline.snapshot());
}

function renderLegend() {
  const host = $('legend');
  const mode = COLOR_MODES.find((m) => m.id === state.colorMode);
  host.innerHTML = '';
  if (!mode) return;

  if (!mode.legend.length) {
    const help = document.createElement('span');
    help.className = 'legend-help';
    help.textContent = mode.help;
    host.appendChild(help);
    return;
  }

  // A continuous ramp gets a gradient bar; a categorical mode gets swatches.
  if (mode.id === 'turn') {
    const wrap = document.createElement('div');
    wrap.className = 'legend-swatches';
    wrap.innerHTML = mode.legend
      .map((s) => `<span><i style="background:${rgbCss(s.rgb)}"></i>${s.label}</span>`)
      .join('');
    host.appendChild(wrap);
    return;
  }

  const bar = document.createElement('div');
  bar.className = 'legend-bar';
  bar.style.background = legendGradient(mode.id);
  const stops = document.createElement('div');
  stops.className = 'legend-stops';
  stops.innerHTML = mode.legend.map((s) => `<span>${s.label}</span>`).join('');

  const col = document.createElement('div');
  col.style.cssText = 'flex:1 1 auto;display:grid;gap:2px;';
  col.append(bar, stops);

  const unit = document.createElement('span');
  unit.className = 'legend-help';
  unit.textContent = mode.unit;
  host.append(col, unit);
}

function renderSpeedChips() {
  const host = $('speed-chips');
  host.innerHTML = '';
  for (const s of SPEEDS) {
    const chip = document.createElement('button');
    chip.className = `speed-chip${s === timeline.speed ? ' active' : ''}`;
    chip.dataset.speed = String(s);
    chip.textContent = `${s}×`;
    chip.setAttribute('aria-label', `${s} times speed`);
    chip.addEventListener('click', () => timeline.setSpeed(s));
    host.appendChild(chip);
  }
}

function renderChart() {
  const wrap = $('chart-wrap');
  wrap.classList.toggle('hidden', !state.chartVisible);
  $('chart-toggle').setAttribute('aria-pressed', String(state.chartVisible));
  // Showing or hiding the chart resizes the dock, which moves the map controls.
  // Done here rather than left to the ResizeObserver because observer callbacks
  // are delivered on an animation frame, which a backgrounded tab never runs.
  syncDockHeight();
  if (!state.chartVisible || !state.tracks.length) { state.chartGeo = null; return; }

  state.chartGeo = Charts.drawProfile($('chart-profile'), {
    tracks: state.tracks,
    domain: timeline.domain(),
    toClock: (track, ms) => timeline.toClock(track, ms),
    colorMode: state.colorMode,
    altMode: state.altMode,
    mode: timeline.mode,
  });
  Charts.drawOverlay($('chart-overlay'), state.chartGeo, {
    snapshot: timeline.snapshot(), altMode: state.altMode,
  });
}

// ── rendering: sheets ───────────────────────────────────────────────────────

function renderHighlightList() {
  const host = $('highlight-list');
  const ranked = rankAcrossTracks(state.tracks.filter((t) => t.visible !== false));
  $('hl-count').textContent = String(ranked.length);
  $('hl-count').hidden = ranked.length === 0;

  host.innerHTML = '';
  if (!ranked.length) {
    host.innerHTML = '<div class="empty-row">No highlights yet — load a flight.</div>';
    return;
  }

  for (const { track, highlight } of ranked) {
    const meta = HIGHLIGHT_META[highlight.type];
    const row = document.createElement('button');
    row.className = 'hl-row';
    row.innerHTML = `
      <span class="hl-icon ${meta.cls}">${meta.icon}</span>
      <span class="hl-body">
        <span class="hl-top">
          <span class="hl-label">${meta.label}</span>
          <span class="hl-who" style="color:${track.color}">${escapeHtml(track.pilotName)}</span>
          <span class="hl-time">${fmtClock(highlight.timestamp)}Z</span>
        </span>
        <span class="hl-desc">${escapeHtml(highlight.description)}</span>
      </span>`;
    row.addEventListener('click', () => jumpToHighlight(track, highlight));
    host.appendChild(row);
  }
}

function jumpToHighlight(track, highlight) {
  timeline.pause();
  timeline.seek(timeline.toClock(track, highlight.timestamp));
  const p = track.points[highlight.index ?? 0];
  if (p && state.mapReady) {
    const key = track.altSource === 'gps' ? 'gpsAlt' : 'pressureAlt';
    Map3D.focusPoint(p.lng, p.lat, p[key]);
    setCameraLabel('free');
  }
  closeSheets();
  showStatus(highlight.description, '', 5200);
}

const STAT_ROWS = [
  { label: 'Date', get: (t) => fmtDate(t.date), plain: true },
  { label: 'Glider', get: (t) => t.gliderType || '—', plain: true },
  { label: 'Duration', get: (t) => fmtDuration(t.metrics.duration || 0), rank: (t) => t.metrics.duration },
  {
    label: 'Free distance',
    get: (t) => fmtDist(pilotInsights(t).freeDistance),
    rank: (t) => pilotInsights(t).freeDistance,
    note: 'Free distance over five points — start, up to three turnpoints and end, in flight order. This is the distance XC leagues score.',
  },
  { label: 'Max altitude', get: (t) => fmtAlt(t.metrics.maxAlt), rank: (t) => t.metrics.maxAlt },
  {
    label: 'Lowest AGL',
    get: (t) => (t.hasTerrain ? fmtAgl(t.metrics.minAgl) : 'needs terrain'),
    plain: true,
    note: 'Lowest height above ground during free flight — launch-ridge soaring and the landing approach are excluded, because a 90 m DEM reads both as zero.',
  },
  { label: 'Best climb', get: (t) => `${(t.metrics.maxClimb || 0).toFixed(1)} m/s`, rank: (t) => t.metrics.maxClimb },
  { label: 'Worst sink', get: (t) => `${(t.metrics.maxSink || 0).toFixed(1)} m/s`, rank: (t) => -(t.metrics.maxSink || 0) },
  { label: 'Height gained', get: (t) => fmtAlt(t.metrics.totalClimb || 0), rank: (t) => t.metrics.totalClimb },
  { label: 'Thermals', get: (t) => String(t.metrics.thermalCount || 0), rank: (t) => t.metrics.thermalCount },
  { label: 'Best glide', get: (t) => fmtGlide(t.metrics.bestGlide), rank: (t) => t.metrics.bestGlide },
  { label: 'Top speed', get: (t) => fmtSpeed(t.metrics.maxSpeed || 0), rank: (t) => t.metrics.maxSpeed },
  { label: 'Avg speed', get: (t) => fmtSpeed(t.metrics.avgSpeed || 0), rank: (t) => t.metrics.avgSpeed },
];

function renderStats() {
  const host = $('stats-table');
  const tracks = state.tracks.filter((t) => t.visible !== false);
  if (!tracks.length) {
    host.innerHTML = '<div class="empty-row">Load a flight to compare.</div>';
    return;
  }

  const head = tracks.map((t) => `<th>
      <span class="swatch" style="background:${t.color}"></span>
      ${escapeHtml(t.pilotName)}
      <div class="stats-sub">${t.altSource === 'gps' ? 'GPS alt' : 'baro alt'}</div>
    </th>`).join('');

  const rows = STAT_ROWS.map((row) => {
    const values = tracks.map((t) => row.get(t));
    let bestIdx = -1;
    if (row.rank && tracks.length > 1) {
      let bestV = -Infinity;
      tracks.forEach((t, i) => {
        const v = row.rank(t);
        if (Number.isFinite(v) && v > bestV) { bestV = v; bestIdx = i; }
      });
    }
    const cells = values.map((v, i) =>
      `<td class="${i === bestIdx ? 'best' : ''}">${escapeHtml(v)}</td>`).join('');
    const label = row.note
      ? `<abbr title="${escapeHtml(row.note)}">${row.label}</abbr>`
      : row.label;
    return `<tr><td>${label}</td>${cells}</tr>`;
  }).join('');

  // Turn bias gets a bar rather than a number: the shape is the point.
  const biasCells = tracks.map((t) => {
    const { leftPercent: l, rightPercent: r } = t.metrics.turnBias;
    return `<td>
      <div class="bias"><i class="l" style="width:${l}%"></i><i class="r" style="width:${r}%"></i></div>
      <div class="stats-sub">${l}% L · ${r}% R</div>
    </td>`;
  }).join('');

  host.innerHTML = `<table>
      <thead><tr><th></th>${head}</tr></thead>
      <tbody>${rows}<tr><td>Turn bias</td>${biasCells}</tr></tbody>
    </table>`;
}

// ── insights ────────────────────────────────────────────────────────────────

/** Everything in the Insights sheet. Cheap enough to rebuild on any change. */
function renderInsights() {
  const tracks = state.tracks.filter((t) => t.visible !== false && t._derived);
  const hosts = ['day-summary', 'grade-cards', 'compare-table', 'time-split', 'transitions'];

  if (!tracks.length) {
    for (const id of hosts) $(id).innerHTML = '<div class="empty-row">Load a flight to see insights.</div>';
    $('bands-legend').innerHTML = '';
    $('grade-basis').textContent = '';
    return;
  }

  const day = analyseDay(tracks);
  renderDaySummary(day, tracks);
  renderBands(tracks, day);
  renderGrades(tracks, day);
  renderCompare(tracks);
  renderTimeSplit(tracks);
  renderTransitions(tracks);
}

function renderDaySummary(day, tracks) {
  const host = $('day-summary');
  if (!day) { host.innerHTML = ''; return; }

  const cells = [];
  cells.push(cell(`${day.avgClimb.toFixed(1)} m/s`,
    `Average climb of the day${day.pilots > 1 ? `, pooled over ${day.pilots} pilots` : ''}`));

  if (day.bestClimb) {
    cells.push(cell(`${day.bestClimb.avgClimb.toFixed(1)} m/s`,
      `Best sustained climb — ${escapeHtml(day.bestClimb.track.pilotName)}, ` +
      `${fmtDuration(day.bestClimb.thermal.duration)} for ${fmtAlt(day.bestClimb.thermal.gain)}`));
  }

  if (day.bestBand) {
    cells.push(cell(`${day.bestBand.lo}–${day.bestBand.hi} m`,
      `Best climbs were in this band, averaging ${day.bestBand.avgClimb.toFixed(1)} m/s`));
  }
  if (day.workingBand) {
    cells.push(cell(`${day.workingBand.lo}–${day.workingBand.hi} m`,
      'Working band — where 80% of the climbing happened'));
  }
  if (day.cloudbase !== null) {
    cells.push(cell(fmtAlt(day.cloudbase), 'Climbs topped out around here'));
  }
  cells.push(cell(fmtDuration(day.totalClimbSec),
    `Total time spent climbing${day.pilots > 1 ? ', all pilots' : ''}`));

  host.innerHTML = cells.join('');

  function cell(value, label, wide) {
    return `<div class="day-cell${wide ? ' wide' : ''}"><b>${value}</b><span>${label}</span></div>`;
  }
}

function renderBands(tracks, day) {
  const byTrack = new Map();
  for (const t of tracks) byTrack.set(t.id, pilotInsights(t).climbBands);

  Charts.drawClimbBands($('bands-chart'), {
    tracks, byTrack,
    bestBand: day ? day.bestBand : null,
  });

  $('bands-legend').innerHTML = tracks
    .map((t) => `<span><i style="background:${t.color}"></i>${escapeHtml(t.pilotName)}</span>`)
    .join('') + (day && day.bestBand
      ? `<span><i style="background:rgba(255,196,61,.35)"></i>best band of the day</span>` : '');
}

/** A→green, B→blue, C→amber, D→orange, E→red. */
function gradeClass(letter) {
  return `g-${String(letter || 'e')[0].toLowerCase()}`;
}

function renderGrades(tracks, day) {
  const host = $('grade-cards');
  const rebased = day && day.pilots > 1;
  $('grade-basis').textContent = rebased
    ? 'Heuristic scores. Climb and height are graded against what the other pilots achieved that day; centring, glide and speed against fixed XC thresholds.'
    : 'Heuristic scores against fixed cross-country thresholds. Load a second flight from the same day to grade against real conditions instead.';

  host.innerHTML = '';
  for (const track of tracks) {
    const g = gradeFlight(track, day);
    if (!g) continue;

    const rows = g.categories.map((c) => {
      const pct = Number.isFinite(c.score) ? Math.max(3, Math.min(100, c.score)) : 0;
      return `<div class="grade-row">
          <span>${c.label}</span>
          <span class="grade-meter"><i style="width:${pct}%;background:${track.color}"></i></span>
          <span class="grade-mark">${c.letter}</span>
        </div>`;
    }).join('');

    const details = g.categories
      .filter((c) => Number.isFinite(c.score))
      .map((c) => `${c.label}: ${escapeHtml(c.detail)}`)
      .join(' · ');

    // "Average climb was 1.2, yours was 1.5" — the comparison a pilot actually
    // wants after flying with others. Absent when only one flight is loaded.
    const vs = versusDay(track, day);
    const vsBlock = vs && vs.length ? `
      <div class="vs-day">
        <div class="vs-title">You vs the day <small>${day.pilots} pilots</small></div>
        <table class="vs-table">
          <thead><tr><th></th><th>you</th><th>day</th><th></th></tr></thead>
          <tbody>${vs.map((r) => `
            <tr>
              <td>${r.label}</td>
              <td class="vs-mine">${escapeHtml(r.mine)}</td>
              <td class="vs-avg">${escapeHtml(r.day)}</td>
              <td class="vs-delta ${r.better === null ? '' : r.better ? 'up' : 'down'}">${escapeHtml(r.delta)}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>` : '';

    // The competition score answers a different question from the letter grade:
    // "how big was the flight" rather than "how well was the day flown".
    const xc = xcScore(track);
    const xcBlock = xc ? `
      <div class="xc-score">
        <div class="xc-head">
          <span class="xc-num">${xc.score}</span>
          <span class="xc-label">XC score<small>distance &amp; speed weighted</small></span>
          <span class="xc-pts">${xc.freeDistancePoints.toFixed(1)} pts<small>free distance</small></span>
        </div>
        <div class="xc-bars">
          ${xc.components.map((c) => `
            <div class="xc-bar" title="${escapeHtml(c.detail)} · ${Math.round(c.weight * 100)}% of the score">
              <span class="xc-bar-track"><i style="height:${Math.max(3, Math.min(100, c.score))}%;background:${track.color}"></i></span>
              <span class="xc-bar-label">${c.label}</span>
              <span class="xc-bar-w">${Math.round(c.weight * 100)}%</span>
            </div>`).join('')}
        </div>
      </div>` : '';

    const card = document.createElement('div');
    card.className = 'grade-card';
    card.innerHTML = `
      <div class="grade-head">
        <span class="grade-letter ${gradeClass(g.letter)}">${g.letter}</span>
        <span class="grade-who">
          <b>${escapeHtml(track.pilotName)}</b>
          <span>${escapeHtml(track.gliderType || fmtDate(track.date))}</span>
        </span>
        <span class="grade-overall">${g.overall}/100</span>
      </div>
      <div class="grade-rows">${rows}</div>
      <div class="grade-detail">${details}</div>
      ${g.advice ? `<div class="grade-advice">${escapeHtml(g.advice)}</div>` : ''}
      ${vsBlock}
      ${xcBlock}`;
    host.appendChild(card);
  }
}

function renderCompare(tracks) {
  const host = $('compare-table');
  if (tracks.length < 2) {
    host.innerHTML = '<div class="empty-row">Load a second flight to compare pilots.</div>';
    return;
  }

  const head = tracks.map((t) =>
    `<th><span class="swatch" style="background:${t.color}"></span>${escapeHtml(t.pilotName)}</th>`).join('');
  const rows = compareTracks(tracks).map(({ row, display, bestIdx }) => {
    const cells = display.map((v, i) =>
      `<td class="${i === bestIdx ? 'best' : ''}">${escapeHtml(v)}</td>`).join('');
    return `<tr><td>${row.label}</td>${cells}</tr>`;
  }).join('');

  host.innerHTML = `<table><thead><tr><th></th>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

function renderTimeSplit(tracks) {
  const host = $('time-split');
  host.innerHTML = '';

  for (const track of tracks) {
    const ins = pilotInsights(track);
    const ts = ins.timeSplit;
    const bias = track.metrics.turnBias;
    const th = ins.thermalStats;

    const row = document.createElement('div');
    row.className = 'ts-row';
    row.innerHTML = `
      <div class="ts-head">
        <b style="color:${track.color}">${escapeHtml(track.pilotName)}</b>
        <span>${fmtDuration(ts.totalSec)} airborne</span>
      </div>
      <div class="ts-bar">
        <i class="climb" style="width:${ts.climbPct}%"></i>
        <i class="glide" style="width:${ts.glidePct}%"></i>
        <i class="other" style="width:${ts.otherPct}%"></i>
      </div>
      <div class="ts-key">
        <span><i class="climb" style="background:#e84e44"></i>climbing ${ts.climbPct}% (${fmtDuration(ts.climbSec)})</span>
        <span><i class="glide" style="background:#4696f5"></i>transitions ${ts.glidePct}%</span>
        <span><i class="other" style="background:rgba(255,255,255,.14)"></i>other ${ts.otherPct}%</span>
      </div>
      <div class="ts-turn">
        Turning ${bias.leftPercent}% left / ${bias.rightPercent}% right ·
        ${th.leftCount} left-hand and ${th.rightCount} right-hand thermals ·
        converted ${Math.round(th.consistency * 100)}% of each core's peak
      </div>`;
    host.appendChild(row);
  }
}

function renderTransitions(tracks) {
  const host = $('transitions');
  host.innerHTML = '';
  let any = false;

  for (const track of tracks) {
    const ins = pilotInsights(track);
    if (!ins.transitions.length) continue;
    any = true;

    const st = ins.transitionStats;
    const head = document.createElement('div');
    head.className = 'trans-pilot';
    head.style.color = track.color;
    head.textContent = `${track.pilotName} — ${st.count} transitions, ` +
      `${fmtDist(st.totalDistance)} at ${fmtGlide(st.avgGlide)} overall`;
    host.appendChild(head);

    const rows = ins.transitions.map((tr) => {
      // Compare each glide against this pilot's own average, so the colouring
      // reflects a good or bad decision rather than the glider's rating.
      const cls = tr.glideRatio === null ? ''
        : tr.glideRatio >= st.avgGlide * 1.1 ? 'good'
          : tr.glideRatio <= st.avgGlide * 0.8 ? 'poor' : '';
      return `<tr>
        <td>${tr.index}</td>
        <td>${fmtClockShort(tr.startTime)}</td>
        <td>${fmtDist(tr.distance)}</td>
        <td class="${cls}">${tr.glideRatio !== null ? fmtGlide(tr.glideRatio)
          : tr.level ? 'level' : 'gained'}</td>
        <td>${fmtSpeed(tr.avgSpeed)}</td>
        <td>${fmtAlt(Math.max(0, tr.heightLost))}</td>
        <td>${Math.round(tr.entryAlt)}→${Math.round(tr.exitAlt)}</td>
      </tr>`;
    }).join('');

    const table = document.createElement('table');
    table.className = 'trans-table';
    table.innerHTML = `
      <thead><tr>
        <th>#</th><th>start</th><th>dist</th><th>glide</th>
        <th>speed</th><th>lost</th><th>alt m</th>
      </tr></thead>
      <tbody>${rows}</tbody>`;
    host.appendChild(table);
  }

  if (!any) host.innerHTML = '<div class="empty-row">No thermal-to-thermal transitions detected.</div>';
}

function renderLibrary() {
  const loaded = $('loaded-list');
  loaded.innerHTML = '';
  if (!state.tracks.length) {
    loaded.innerHTML = '<div class="empty-row">Nothing loaded.</div>';
  }
  for (const track of state.tracks) {
    const row = document.createElement('div');
    row.className = 'flight-row';

    const swatch = document.createElement('span');
    swatch.className = 'flight-swatch';
    swatch.style.background = track.color;

    const main = document.createElement('div');
    main.className = 'flight-main';
    const nameWrap = document.createElement('div');
    nameWrap.className = 'flight-name';
    const input = document.createElement('input');
    input.value = track.pilotName;
    input.setAttribute('aria-label', 'Pilot name');
    input.addEventListener('change', () => {
      const v = input.value.trim() || 'Pilot';
      track.pilotName = v;
      Store.updateFlight(track.id, { pilotName: v });
      renderPills();
      renderStats();
      renderHighlightList();
      renderClipOptions();
    });
    nameWrap.appendChild(input);

    const meta = document.createElement('div');
    meta.className = 'flight-meta';
    meta.textContent = [
      fmtDate(track.date),
      fmtDuration(track.metrics.duration || 0),
      fmtDist(track.metrics.totalDistance),
      `${track.points.length} fixes`,
      track.hasTerrain ? 'terrain ✓' : 'no terrain',
    ].join(' · ');

    main.append(nameWrap, meta);

    const vis = document.createElement('button');
    vis.className = 'flight-act';
    // Distinguish "you hid this" from "this is another day" — the second is
    // not something the Hide button can undo.
    const otherDay = !track.userHidden && track.visible === false;
    vis.textContent = otherDay ? 'Other day' : track.userHidden ? 'Show' : 'Hide';
    vis.disabled = otherDay;
    vis.title = otherDay ? `Flown on ${fmtDate(track.date)} — switch day in the dock to see it` : '';
    vis.addEventListener('click', () => { toggleTrack(track); renderLibrary(); });

    const del = document.createElement('button');
    del.className = 'flight-act danger';
    del.textContent = 'Remove';
    del.addEventListener('click', () => { removeTrack(track.id); renderLibrary(); });

    row.append(swatch, main, vis, del);
    loaded.appendChild(row);
  }

  renderSavedList();
}

async function renderSavedList() {
  const host = $('saved-list');
  const saved = await Store.listFlights();
  const loadedIds = new Set(state.tracks.map((t) => t.id));
  host.innerHTML = '';

  const available = saved.filter((r) => !loadedIds.has(r.id));
  if (!available.length) {
    host.innerHTML = '<div class="empty-row">Nothing else saved on this device.</div>';
    return;
  }

  for (const rec of available) {
    const row = document.createElement('div');
    row.className = 'flight-row';
    row.innerHTML = `
      <span class="flight-swatch" style="background:${rec.color || '#5ec2ff'}"></span>
      <div class="flight-main">
        <div class="flight-name">${escapeHtml(rec.pilotName || 'Pilot')}</div>
        <div class="flight-meta">${fmtDate(rec.date)} · ${escapeHtml(rec.fileName || '')}</div>
      </div>`;

    const add = document.createElement('button');
    add.className = 'flight-act';
    add.textContent = 'Load';
    add.addEventListener('click', async () => {
      if (state.tracks.length >= MAX_TRACKS) {
        showStatus('Four flights is the limit — remove one first.', 'warn');
        return;
      }
      try {
        const track = buildTrack(rec.igc, {
          id: rec.id, color: nextColor(), fileName: rec.fileName, pilotName: rec.pilotName,
        });
        state.tracks.push(track);
        setEmptyVisible(false);
        focusDayOf([track]);
        rememberActive();
        refreshAll({ fit: true });
        renderLibrary();
        resolveTerrain([track]);
      } catch (err) {
        showStatus(`Could not load that flight: ${err.message}`, 'error', 5000);
      }
    });

    const del = document.createElement('button');
    del.className = 'flight-act danger';
    del.textContent = 'Delete';
    del.addEventListener('click', async () => {
      await Store.deleteFlight(rec.id);
      renderSavedList();
    });

    row.append(add, del);
    host.appendChild(row);
  }
}

// ── share links ─────────────────────────────────────────────────────────────

/**
 * Put the app into the exact state a share link captured.
 *
 * The hash is dropped here rather than during restore: a `replaceState` issued
 * that early in page load gets raced by the navigation and silently ignored, and
 * clearing only after a successful load means a failed one keeps the link
 * visible to retry.
 */
function applySharedView(view) {
  state.pendingView = null;
  if (state.consumedShare) {
    state.consumedShare = false;
    Share.clearHash();
  }
  if (!view || typeof view !== 'object') return;

  if (view.c) setColorMode(view.c);
  if (view.a === 'msl' || view.a === 'agl') {
    state.altMode = view.a;
    $('alt-toggle').textContent = state.altMode.toUpperCase();
    $('alt-toggle').setAttribute('aria-pressed', String(state.altMode === 'agl'));
  }

  // Visibility before the clock: the domain depends on which tracks are active.
  if (Array.isArray(view.vis) && view.vis.length) {
    const wanted = new Set(view.vis);
    const known = state.tracks.filter((t) => wanted.has(t.id));
    if (known.length) {
      for (const t of state.tracks) t.userHidden = !wanted.has(t.id);
      // The sender may have been showing several days at once; honour that
      // rather than filtering their view down to one day on arrival.
      focusDayOf(known);
      applyVisibility();
    }
  }

  if (view.m === 'absolute' || view.m === 'relative') timeline.setSyncMode(view.m);
  timeline.setTracks(state.tracks);
  if (Number.isFinite(view.t)) timeline.seek(view.t);

  refreshAll();

  const map = Map3D.getMap();
  if (map && view.cam && Number.isFinite(view.cam.lat) && Number.isFinite(view.cam.lng)) {
    // Cancel any eased move already in flight, or it keeps animating after this
    // jump and lands the recipient somewhere the sender never was.
    map.stop();
    Map3D.setCamera('free');
    setCameraLabel('free');
    map.jumpTo({
      center: [view.cam.lng, view.cam.lat],
      zoom: view.cam.z, pitch: view.cam.p, bearing: view.cam.b,
    });
  }
}

/**
 * Deep links can also arrive at an already-running app — iOS hands a URL to the
 * live standalone instance rather than reloading it, and in-page navigation
 * fires the same event.
 */
function wireHashLinks() {
  window.addEventListener('hashchange', async () => {
    const { token, view } = Share.readHash();
    if (!token && !view) return;

    if (token) {
      showStatus('Opening shared flight…', 'busy', 0);
      try {
        const bundle = await Share.loadShare(token);
        // Replace what's loaded: the recipient asked to see *this* flight.
        state.tracks = [];
        for (const f of bundle.flights.slice(0, MAX_TRACKS)) {
          const track = buildTrack(f.igc, {
            id: f.id, color: f.color, fileName: f.fileName, pilotName: f.pilotName,
          });
          state.tracks.push(track);
          Store.saveFlight({
            id: track.id, igc: f.igc, pilotName: track.pilotName,
            color: track.color, fileName: track.fileName, date: track.date,
          });
        }
        setEmptyVisible(false);
        rememberActive();
        state.consumedShare = true;
        refreshAll();
        applySharedView(bundle.view || view);
        resolveTerrain(state.tracks);
        showStatus(`Shared flight: ${state.tracks.map((t) => t.pilotName).join(', ')}`, '', 3600);
      } catch (err) {
        showStatus(err.message, 'error', 7000);
      }
      return;
    }

    state.consumedShare = true;
    applySharedView(view);
  });
}

function currentView() {
  return Share.captureView({
    timeline,
    colorMode: state.colorMode,
    altMode: state.altMode,
    map: Map3D.getMap(),
    tracks: state.tracks,
  });
}

function setShareNote(msg, kind = '') {
  const el = $('share-note');
  el.textContent = msg;
  el.style.color = kind === 'error' ? '#ff9a8f' : '';
}

/** View-only link: nothing leaves the device. */
async function shareViewOnly() {
  if (!state.tracks.length) { setShareNote('Load a flight first.'); return; }
  const url = Share.viewLink(currentView());
  const how = await Share.deliverLink(url, 'Flight debrief — this moment');
  setShareNote(how === 'manual'
    ? url
    : `${how === 'shared' ? 'Shared' : 'Copied'}. Only works for someone who already has these IGC files loaded.`);
}

/**
 * Full link: uploads the IGC files. This publishes them to anyone holding the
 * link, so it asks first — the pilot may be carrying a friend's track.
 */
async function shareFull() {
  const tracks = state.tracks.filter((t) => t.visible !== false);
  if (!tracks.length) { setShareNote('Load a flight first.'); return; }

  const names = tracks.map((t) => t.pilotName).join(', ');
  const ok = confirm(
    `Upload ${tracks.length === 1 ? 'this flight' : `these ${tracks.length} flights`} (${names}) so the link works for anyone?\n\n` +
    'The IGC files are stored under a secret random link that expires in 90 days. ' +
    'Anyone with the link can replay the flights.');
  if (!ok) { setShareNote('Cancelled — nothing was uploaded.'); return; }

  const btn = $('share-full');
  btn.disabled = true;
  setShareNote('Uploading…');

  try {
    const { url, bytes } = await Share.createShare({
      tracks,
      view: currentView(),
      igcFor: async (id) => {
        const saved = await Store.listFlights();
        const rec = saved.find((r) => r.id === id);
        return rec ? rec.igc : null;
      },
    });
    const how = await Share.deliverLink(url, 'Flight debrief');
    setShareNote(how === 'manual'
      ? url
      : `${how === 'shared' ? 'Shared' : 'Copied'} — ${(bytes / 1e6).toFixed(1)} MB, link expires in 90 days.`);
  } catch (err) {
    setShareNote(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ── XContest import ─────────────────────────────────────────────────────────

/** Search results awaiting selection. */
let xcResults = [];

function initXcImport() {
  const sel = $('xc-country');
  sel.innerHTML = XC.COUNTRIES
    .map((c) => `<option value="${c.code}">${escapeHtml(c.name)}</option>`).join('');
  sel.value = Store.pref('xcCountry', '');
  $('xc-date').value = Store.pref('xcDate', '') || new Date().toISOString().slice(0, 10);
  $('xc-key').value = XC.getKey();

  $('xc-key-save').addEventListener('click', () => {
    XC.setKey($('xc-key').value);
    setXcStatus(XC.hasKey() ? 'Key saved on this device.' : 'Key cleared.');
  });
  $('xc-search').addEventListener('click', runXcSearch);
  $('xc-import').addEventListener('click', importXcSelected);

  $('url-load').addEventListener('click', importFromUrl);
  $('url-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); importFromUrl(); }
  });
  $('paste-load').addEventListener('click', importFromPaste);
  $('paste-clip').addEventListener('click', pasteFromClipboard);
  renderBookmarklet();
  wireFileHandlers();
  wireHandoff();
}

/**
 * Load a flight from pasted IGC text.
 *
 * The lowest-dependency import there is: no key, no proxy, no connection. An
 * IGC is plain ASCII, so it survives being copied out of a message or an email
 * body, which is how one pilot actually sends another a track.
 */
/**
 * Read the clipboard and load it if it holds a flight — the one-tap end of the
 * bookmarklet's fallback path, and useful on its own when a friend sends the
 * file contents in a message.
 *
 * Runs from a click because that is what iOS requires before it will surface
 * the clipboard at all.
 */
async function pasteFromClipboard() {
  const note = $('paste-note');
  const setNote = (msg, bad) => { note.textContent = msg; note.style.color = bad ? '#ff9a8f' : ''; };

  if (!navigator.clipboard || !navigator.clipboard.readText) {
    setNote('This browser will not let a page read the clipboard — paste into the box below instead.', true);
    return;
  }
  try {
    const text = await navigator.clipboard.readText();
    if (!text || !looksLikeIGC(text)) {
      setNote('The clipboard does not contain an IGC flight.', true);
      return;
    }
    $('paste-input').value = text;
    importFromPaste();
  } catch {
    setNote('Clipboard access was refused — paste into the box below instead.', true);
  }
}

function importFromPaste() {
  const input = $('paste-input');
  const note = $('paste-note');
  const setNote = (msg, bad) => { note.textContent = msg; note.style.color = bad ? '#ff9a8f' : ''; };

  if (state.tracks.length >= MAX_TRACKS) {
    setNote('Four flights is the limit — remove one first.', true);
    return;
  }
  const text = input.value;
  if (!text.trim()) { setNote('Paste the contents of an IGC file first.', true); return; }
  if (!looksLikeIGC(text)) {
    setNote('That does not contain IGC fix records — make sure you copied the whole file, including the B-record lines.', true);
    return;
  }

  try {
    const track = buildTrack(text, { color: nextColor(), fileName: 'pasted.igc' });
    state.tracks.push(track);
    Store.saveFlight({
      id: track.id, igc: text, pilotName: track.pilotName,
      color: track.color, fileName: track.fileName, date: track.date,
    });
    setEmptyVisible(false);
    focusDayOf([track]);
    rememberActive();
    refreshAll({ fit: true });
    renderLibrary();
    resolveTerrain([track]);
    input.value = '';
    setNote('');
    closeSheets();
    showStatus(`Loaded ${track.pilotName}`, '', 2600);
  } catch (err) {
    setNote(err.message, true);
  }
}

/** Largest IGC accepted over the bookmarklet handoff — a very long flight. */
const HANDOFF_MAX_BYTES = 12 * 1024 * 1024;

/**
 * Receive a flight from the "Send to Debrief" bookmarklet.
 *
 * The bookmarklet runs in the pilot's own browser, on a flight page they
 * navigated to themselves, using their own session — so it reaches flights only
 * they can see, and it is one flight at a time by definition. That is what makes
 * it a "save this page" button rather than a crawler, which is why it exists at
 * all when an automated importer does not.
 *
 * The IGC never leaves the two tabs: the page posts it straight here.
 *
 * The listener is armed unconditionally rather than only when `window.opener`
 * exists. Popup blockers, `noopener` defaults and PWA launch behaviour all
 * produce a target window with no opener, and gating on it made the import fail
 * silently in exactly those cases. The guards that matter are on the payload,
 * not on how the window was opened:
 *   • it must parse as IGC, and be under a sane size
 *   • the sending origin is shown to the pilot, so an unexpected source is visible
 * The worst a hostile sender achieves is putting a flight in the local library.
 */
function wireHandoff() {
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (!d || d.type !== 'thermal-debrief-igc' || typeof d.igc !== 'string') return;

    if (d.igc.length > HANDOFF_MAX_BYTES) {
      showStatus('That flight is too large to import.', 'error', 5000);
      return;
    }
    if (!looksLikeIGC(d.igc)) {
      showStatus(`${e.origin} sent something that isn't an IGC file.`, 'error', 5000);
      return;
    }
    if (state.tracks.length >= MAX_TRACKS) {
      showStatus('Four flights is the limit — remove one first.', 'warn', 5000);
      return;
    }

    try {
      const name = typeof d.name === 'string' && d.name ? d.name.slice(0, 80) : 'flight.igc';
      const track = buildTrack(d.igc, { color: nextColor(), fileName: name });
      state.tracks.push(track);
      Store.saveFlight({
        id: track.id, igc: d.igc, pilotName: track.pilotName,
        color: track.color, fileName: name, date: track.date,
      });
      setEmptyVisible(false);
      focusDayOf([track]);
      rememberActive();
      refreshAll({ fit: true });
      resolveTerrain([track]);
      showStatus(`Loaded ${track.pilotName} from ${hostOf(e.origin)}`, '', 3200);
    } catch (err) {
      showStatus(`Could not read that flight: ${err.message}`, 'error', 5000);
    }
  });

  // Tell the opener we're ready to receive. Sent after boot so the handoff can't
  // arrive before the app can render it.
  try { window.opener.postMessage({ type: 'thermal-debrief-ready' }, '*'); } catch { /* opener gone */ }
}

const hostOf = (origin) => { try { return new URL(origin).hostname; } catch { return origin; } };

/**
 * Build the "Send to Debrief" bookmarklet against THIS deployment's URL, so it
 * works the same from localhost as from the published site.
 *
 * Deliberately not XContest-specific: it looks for a link to an IGC file on
 * whatever page it is run from, which makes it work on DHV-XC, competition
 * sites and club pages too — and keeps it from breaking when one site reshuffles
 * its markup.
 */
function renderBookmarklet() {
  const target = location.origin + location.pathname;
  const code = `javascript:(function(){` +
    `var D=${JSON.stringify(target)};` +
    `var L=[].slice.call(document.querySelectorAll('a[href]')).map(function(a){return a.href});` +
    `var u=L.filter(function(h){return /\\.igc(\\?|$)/i.test(h)})[0]||` +
    `L.filter(function(h){return /igc/i.test(h)&&/download|track|file|export/i.test(h)})[0];` +
    `if(!u){alert('No IGC download link on this page.\\\\nOpen the flight page that has the IGC download, then tap this again.');return;}` +
    `fetch(u,{credentials:'include'}).then(function(r){return r.text()}).then(function(t){` +
    `if(!/^B\\d{6}\\d{7}[NS]/m.test(t.slice(0,65536))){alert('That link did not return an IGC file.\\\\nYou may need to be logged in, or the pilot may not share their track.');return;}` +
    // Copy as well as post. If the popup is blocked or opens without an opener
    // — routine on iOS — Debrief's "Paste from clipboard" finishes the job in
    // one tap instead of the import failing with nothing to show for it.
    `try{navigator.clipboard&&navigator.clipboard.writeText(t)}catch(e){}` +
    `var w=window.open(D,'_blank');` +
    `if(!w){alert('Pop-up blocked — the flight is on your clipboard.\\\\nOpen Debrief and tap \\u201CPaste from clipboard\\u201D.');return;}` +
    `var n=(u.split('/').pop()||'flight.igc').split('?')[0];` +
    `function h(e){if(e.data&&e.data.type==='thermal-debrief-ready'){` +
    `w.postMessage({type:'thermal-debrief-igc',igc:t,name:n},new URL(D).origin);` +
    `window.removeEventListener('message',h);}}` +
    `window.addEventListener('message',h);` +
    `}).catch(function(e){alert('Could not fetch the IGC: '+e.message)})})();`;

  const link = $('bm-link');
  link.href = code;
  link.addEventListener('click', (e) => {
    // Clicking it here would run it against Debrief's own page, which has no
    // IGC link — it is meant to be dragged to the bookmarks bar, not clicked.
    e.preventDefault();
    showStatus('Drag this to your bookmarks bar, or tap Copy and save it as a bookmark.', '', 5000);
  });

  $('bm-copy').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(code);
      showStatus('Copied. Save it as a bookmark named “Send to Debrief”.', '', 4200);
    } catch {
      // Clipboard denied — fall back to selecting it so the pilot can copy manually.
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.style.cssText = 'position:fixed;left:8px;right:8px;bottom:8px;height:80px;z-index:99999';
      document.body.appendChild(ta);
      ta.select();
      showStatus('Copy the selected text, then tap anywhere to dismiss.', 'warn', 8000);
      const kill = () => { ta.remove(); document.removeEventListener('click', kill); };
      setTimeout(() => document.addEventListener('click', kill), 300);
    }
  });
}

/**
 * Let the OS hand .igc files straight to the app — "Open with Debrief" from a
 * file manager, rather than going through the picker. Chrome and Edge on
 * desktop support this; iOS Safari does not yet, where the file picker and the
 * paste box remain the routes in.
 */
function wireFileHandlers() {
  if (!('launchQueue' in window) || !('files' in LaunchParams.prototype)) return;
  window.launchQueue.setConsumer(async (params) => {
    if (!params || !params.files || !params.files.length) return;
    const files = [];
    for (const handle of params.files) {
      try { files.push(await handle.getFile()); } catch { /* permission withdrawn */ }
    }
    if (files.length) addFiles(files);
  });
}

/** Load a single publicly served IGC file by URL. */
async function importFromUrl() {
  const input = $('url-input');
  const note = $('url-note');
  const setNote = (msg, bad) => { note.textContent = msg; note.style.color = bad ? '#ff9a8f' : ''; };

  if (state.tracks.length >= MAX_TRACKS) {
    setNote('Four flights is the limit — remove one first.', true);
    return;
  }

  const btn = $('url-load');
  btn.disabled = true;
  setNote('Fetching…');
  try {
    const igc = await XC.fetchIgcUrl(input.value);
    const name = decodeURIComponent(input.value.split('/').pop().split('?')[0]) || 'flight.igc';
    const track = buildTrack(igc, { color: nextColor(), fileName: name });
    state.tracks.push(track);
    Store.saveFlight({
      id: track.id, igc, pilotName: track.pilotName,
      color: track.color, fileName: name, date: track.date,
    });
    setEmptyVisible(false);
    focusDayOf([track]);
    rememberActive();
    refreshAll({ fit: true });
    renderLibrary();
    resolveTerrain([track]);
    input.value = '';
    setNote('');
    closeSheets();
    showStatus(`Loaded ${track.pilotName}`, '', 2600);
  } catch (err) {
    setNote(err.message, true);
  } finally {
    btn.disabled = false;
  }
}

function setXcStatus(msg, kind = '') {
  const el = $('xc-status');
  el.textContent = msg;
  el.style.color = kind === 'error' ? '#ff9a8f' : '';
}

async function runXcSearch() {
  const date = $('xc-date').value;
  const country = $('xc-country').value;
  Store.setPref('xcDate', date);
  Store.setPref('xcCountry', country);

  if (!XC.hasKey()) {
    setXcStatus('Add your XContest API key below first.', 'error');
    $('xc-key-details') || document.querySelector('.xc-key-details').setAttribute('open', '');
    return;
  }

  const btn = $('xc-search');
  btn.disabled = true;
  setXcStatus('Searching XContest…');
  $('xc-results').innerHTML = '';
  $('xc-import').hidden = true;

  try {
    const { flights } = await XC.searchFlights({ date, country });
    xcResults = flights;
    if (!flights.length) {
      setXcStatus('No flights found for that date and country.');
      return;
    }
    setXcStatus(`${flights.length} flights — pick up to ${MAX_TRACKS - state.tracks.length}.`);
    renderXcResults();
    $('xc-import').hidden = false;
  } catch (err) {
    // The adapter's messages are written to be shown verbatim: they say which
    // part failed and, where relevant, which file to adjust.
    setXcStatus(err.message, 'error');
    if (!(await XC.checkProxy())) {
      setXcStatus(`${err.message} (the Cloudflare Worker also isn't answering — check it's deployed)`, 'error');
    }
  } finally {
    btn.disabled = false;
  }
}

function renderXcResults() {
  const host = $('xc-results');
  host.innerHTML = '';

  for (const f of xcResults) {
    const row = document.createElement('label');
    row.className = `xc-flight${f.igcUrl ? '' : ' disabled'}`;

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.value = f.id;
    cb.disabled = !f.igcUrl;

    const main = document.createElement('div');
    main.className = 'xc-flight-main';
    main.innerHTML = `
      <div class="xc-flight-name">${escapeHtml(f.pilotName)}</div>
      <div class="xc-flight-meta">${[
        f.site && escapeHtml(f.site),
        f.glider && escapeHtml(f.glider),
        f.igcUrl ? '' : 'no public track',
      ].filter(Boolean).join(' · ')}</div>`;

    const km = document.createElement('span');
    km.className = 'xc-flight-km';
    km.textContent = f.km ? `${f.km.toFixed(1)} km` : '';

    row.append(cb, main, km);
    host.appendChild(row);
  }
}

async function importXcSelected() {
  const picked = [...$('xc-results').querySelectorAll('input:checked')]
    .map((cb) => xcResults.find((f) => f.id === cb.value))
    .filter(Boolean);

  if (!picked.length) { setXcStatus('Select at least one flight.'); return; }

  const room = MAX_TRACKS - state.tracks.length;
  if (picked.length > room) {
    setXcStatus(`Only room for ${room} more — deselect ${picked.length - room}.`, 'error');
    return;
  }

  const btn = $('xc-import');
  btn.disabled = true;
  const added = [];
  const failed = [];

  for (const f of picked) {
    setXcStatus(`Downloading ${f.pilotName}…`);
    try {
      const igc = await XC.fetchIgc(f);
      const track = buildTrack(igc, {
        color: nextColor(),
        fileName: `xcontest-${f.id}.igc`,
        pilotName: f.pilotName,
      });
      state.tracks.push(track);
      added.push(track);
      Store.saveFlight({
        id: track.id, igc, pilotName: track.pilotName,
        color: track.color, fileName: track.fileName, date: track.date,
      });
    } catch (err) {
      failed.push(`${f.pilotName}: ${err.message}`);
    }
  }

  btn.disabled = false;

  if (!added.length) {
    setXcStatus(failed[0] || 'Nothing could be imported.', 'error');
    return;
  }

  setEmptyVisible(false);
  focusDayOf(added);
  rememberActive();
  refreshAll({ fit: true });
  renderLibrary();
  resolveTerrain(added);
  closeSheets();
  showStatus(
    failed.length
      ? `Imported ${added.length}, ${failed.length} failed. ${failed[0]}`
      : `Imported ${added.map((t) => t.pilotName).join(', ')} from XContest`,
    failed.length ? 'warn' : '', failed.length ? 6000 : 3000);
}

function renderTerrainNote() {
  const el = $('terrain-note');
  if (!el) return;
  if (!state.fetchTerrain) {
    el.textContent = 'Off — altitudes are shown above sea level, and low saves cannot be detected.';
    return;
  }
  const total = state.tracks.length;
  if (!total) { el.textContent = ''; return; }
  const withTerrain = state.tracks.filter((t) => t.hasTerrain).length;
  el.textContent = withTerrain === total
    ? `Ground elevation resolved for ${total === 1 ? 'this flight' : `all ${total} flights`}.`
    : `Resolved for ${withTerrain} of ${total} flights.`;
}

// ── export ──────────────────────────────────────────────────────────────────

function renderClipOptions() {
  const sel = $('clip-select');
  const ranked = rankAcrossTracks(state.tracks.filter((t) => t.visible !== false));
  sel.innerHTML = '';

  if (!ranked.length) {
    sel.innerHTML = '<option value="">No highlights detected</option>';
    $('export-clip').disabled = true;
    updateClipEstimate();
    return;
  }

  ranked.forEach(({ track, highlight }, i) => {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `${HIGHLIGHT_META[highlight.type].label} — ${track.pilotName} ${fmtClock(highlight.timestamp)}Z`;
    sel.appendChild(opt);
  });
  state.clipOptions = ranked;

  const support = Exporter.videoSupport();
  $('export-clip').disabled = !support.supported;
  $('video-note').textContent = support.supported
    ? `Records the live 3D view while it plays the highlight, as ${support.ext.toUpperCase()}.`
    : support.reason;
  updateClipEstimate();
}

function updateClipEstimate() {
  const opt = currentClipOption();
  const el = $('clip-estimate');
  if (!opt) { el.textContent = ''; return; }
  const { track, highlight } = opt;
  const span = clipSpan(track, highlight);
  const speed = Number($('clip-speed').value) || 2;
  const secs = Exporter.clipSeconds(span.from, span.to, speed);
  el.textContent = `About ${Math.round(secs)}s of video (${fmtDuration((span.to - span.from) / 1000)} of flight at ${speed}×). ` +
    `The map stays interactive — don't switch tabs while it records.`;
}

function currentClipOption() {
  const i = Number($('clip-select').value);
  return state.clipOptions && state.clipOptions[i] ? state.clipOptions[i] : null;
}

/** Clip bounds on the *current* clock, padded so the event has a run-in. */
function clipSpan(track, highlight) {
  const start = highlight.startTime ?? highlight.timestamp;
  const end = highlight.endTime ?? highlight.timestamp;
  const from = timeline.toClock(track, start) - 8000;
  const to = timeline.toClock(track, end) + 8000;
  const d = timeline.domain();
  return { from: Math.max(d.start, from), to: Math.min(d.end, Math.max(from + 4000, to)) };
}

async function exportCard() {
  const btn = $('export-card');
  btn.disabled = true;
  showStatus('Building card…', 'busy', 0);
  try {
    const tracks = state.tracks.filter((t) => t.visible !== false);
    const blob = await Exporter.buildStatsCard({
      tracks,
      mapCanvas: Map3D.getCanvas(),
      title: tracks.length > 1 ? 'Flight comparison' : tracks[0].pilotName,
    });
    const how = await Exporter.saveOrShare(blob, Exporter.cardFilename(tracks), 'Flight debrief');
    showStatus(how === 'shared' ? 'Card shared.' : 'Card saved.', '', 2600);
  } catch (err) {
    showStatus(`Card failed: ${err.message}`, 'error', 5000);
  } finally {
    btn.disabled = false;
  }
}

async function exportClip() {
  const opt = currentClipOption();
  if (!opt) return;
  const { track, highlight } = opt;
  const span = clipSpan(track, highlight);
  const speed = Number($('clip-speed').value) || 2;

  const btn = $('export-clip');
  btn.disabled = true;
  state.recording = true;
  closeSheets();

  const prog = $('export-progress');
  const bar = $('export-bar');
  prog.classList.remove('hidden');
  bar.style.width = '0%';
  showStatus('Recording the replay…', 'busy', 0);

  // Chase cam makes a far better clip than a static overhead view.
  const prevCam = Map3D.getCamera();
  Map3D.setCamera('chase', track.id);
  setCameraLabel('chase');

  try {
    const { blob, ext } = await Exporter.recordClip({
      canvas: Map3D.getCanvas(),
      map: Map3D.getMap(),
      timeline,
      from: span.from,
      to: span.to,
      speed,
      onProgress: (f) => { bar.style.width = `${(f * 100).toFixed(0)}%`; },
    });
    const how = await Exporter.saveOrShare(blob, Exporter.clipFilename(track, highlight, ext), 'Flight replay');
    showStatus(how === 'shared' ? 'Clip shared.' : `Clip saved (${(blob.size / 1e6).toFixed(1)} MB).`, '', 3200);
  } catch (err) {
    showStatus(`Recording failed: ${err.message}`, 'error', 6000);
  } finally {
    state.recording = false;
    btn.disabled = false;
    prog.classList.add('hidden');
    Map3D.setCamera(prevCam.mode, prevCam.followId);
    setCameraLabel(prevCam.mode);
  }
}

// ── events ──────────────────────────────────────────────────────────────────

function wireEvents() {
  // loading
  $('load-btn').addEventListener('click', () => $('file-input').click());
  $('empty-load').addEventListener('click', () => $('file-input').click());
  $('lib-load').addEventListener('click', () => $('file-input').click());
  $('empty-demo').addEventListener('click', loadDemo);
  $('lib-demo').addEventListener('click', () => { closeSheets(); loadDemo(); });
  $('file-input').addEventListener('change', (e) => {
    addFiles(e.target.files);
    e.target.value = '';       // so re-picking the same file fires again
    closeSheets();
  });

  wireDragAndDrop();

  // sheets
  $('library-btn').addEventListener('click', () => { renderLibrary(); openSheet('library-sheet'); });
  $('layers-btn').addEventListener('click', () => openSheet('layers-sheet'));
  $('highlights-btn').addEventListener('click', () => { renderHighlightList(); openSheet('highlights-sheet'); });
  $('stats-btn').addEventListener('click', () => { renderStats(); openSheet('stats-sheet'); });
  $('insights-btn').addEventListener('click', () => {
    openSheet('insights-sheet');
    // The bands canvas can only be measured once its sheet is on screen.
    renderInsights();
  });
  $('export-btn').addEventListener('click', () => { renderClipOptions(); openSheet('export-sheet'); });
  for (const btn of document.querySelectorAll('.sheet-close')) {
    btn.addEventListener('click', closeSheets);
  }
  for (const sheet of document.querySelectorAll('.sheet')) {
    // Tapping the scrim closes; tapping inside the panel must not.
    sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheets(); });
  }

  // map + layers
  $('basemap-select').addEventListener('change', (e) => {
    state.basemap = e.target.value;
    Store.setPref('basemap', state.basemap);
    Map3D.setBasemap(state.basemap);
  });
  $('fit-btn').addEventListener('click', () => {
    setCameraLabel('free');
    Map3D.setCamera('free');
    Map3D.fitTracks(state.tracks);
  });
  $('cam-btn').addEventListener('click', cycleCamera);
  $('exag-range').addEventListener('input', (e) => {
    const v = Number(e.target.value);
    $('exag-out').textContent = `${v.toFixed(1)}×`;
    Map3D.setExaggeration(v);
    Store.setPref('exag', v);
  });
  $('shadow-toggle').addEventListener('change', (e) => {
    Map3D.setShowShadow(e.target.checked);
    Store.setPref('shadow', e.target.checked ? '1' : '0');
  });
  $('hl-toggle').addEventListener('change', (e) => {
    Map3D.setShowHighlights(e.target.checked);
    Store.setPref('pins', e.target.checked ? '1' : '0');
  });
  $('terrain-toggle').addEventListener('change', (e) => {
    state.fetchTerrain = e.target.checked;
    Store.setPref('terrain', state.fetchTerrain ? '1' : '0');
    if (state.fetchTerrain) resolveTerrain(state.tracks);
    else renderTerrainNote();
  });

  // dock toggles
  $('alt-toggle').addEventListener('click', () => {
    const hasTerrain = state.tracks.some((t) => t.hasTerrain);
    if (state.altMode === 'msl' && !hasTerrain) {
      showStatus('AGL needs ground elevation, which is not available yet.', 'warn');
      return;
    }
    state.altMode = state.altMode === 'msl' ? 'agl' : 'msl';
    Store.setPref('altMode', state.altMode);
    $('alt-toggle').textContent = state.altMode.toUpperCase();
    $('alt-toggle').setAttribute('aria-pressed', String(state.altMode === 'agl'));
    renderChart();
    updatePillReadouts(timeline.snapshot());
  });
  $('chart-toggle').addEventListener('click', () => {
    state.chartVisible = !state.chartVisible;
    Store.setPref('chart', state.chartVisible ? '1' : '0');
    renderChart();
  });

  // transport
  $('tp-play').addEventListener('click', () => timeline.toggle());
  $('tp-start').addEventListener('click', () => { timeline.pause(); timeline.rewindToStart(); });
  $('tp-prev').addEventListener('click', () => announceHighlight(timeline.nextHighlight(-1)));
  $('tp-next').addEventListener('click', () => announceHighlight(timeline.nextHighlight(1)));
  $('sync-toggle').addEventListener('click', () => {
    const next = timeline.mode === 'absolute' ? 'relative' : 'absolute';
    if (next === 'absolute' && !timeline.absoluteViable()) {
      showStatus('These flights are on different days — UTC sync would show one at a time.', 'warn', 4200);
    }
    timeline.setSyncMode(next);
    renderChart();
  });

  const scrub = $('scrubber');
  const beginScrub = () => { state.scrubbing = true; };
  const endScrub = () => { state.scrubbing = false; };
  scrub.addEventListener('pointerdown', beginScrub);
  scrub.addEventListener('pointerup', endScrub);
  scrub.addEventListener('pointercancel', endScrub);
  scrub.addEventListener('input', (e) => {
    const f = Number(e.target.value) / 1000;
    e.target.style.setProperty('--fill', `${(f * 100).toFixed(1)}%`);
    timeline.seekFraction(f);
  });
  scrub.addEventListener('change', endScrub);

  wireChartScrub();

  // export
  $('share-full').addEventListener('click', shareFull);
  $('share-view').addEventListener('click', shareViewOnly);
  $('export-card').addEventListener('click', exportCard);
  $('export-clip').addEventListener('click', exportClip);
  $('clip-select').addEventListener('change', updateClipEstimate);
  $('clip-speed').addEventListener('change', updateClipEstimate);

  initXcImport();
  wireHashLinks();
  wireKeyboard();

  window.addEventListener('resize', debounce(() => {
    Map3D.resize();
    renderChart();
    syncDockHeight();
  }, 140));

  // A tab that starts backgrounded lays out at zero height, so the first
  // measurement clamps to nothing and the map controls stay buried. The dock
  // itself never resizes on becoming visible, so its observer won't fire —
  // re-measure when the page is shown.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncDockHeight();
  });

  // The canvas has to be measured to be drawn, and it can be measured at the
  // wrong size — while the dock is still display:none, mid rotation, or before
  // the first layout settles. Watching the box is more reliable than trying to
  // guess when layout is final.
  if (typeof ResizeObserver === 'function') {
    let lastW = 0;
    const ro = new ResizeObserver(debounce((entries) => {
      const w = entries[0] ? entries[0].contentRect.width : 0;
      if (w > 0 && Math.abs(w - lastW) > 1) { lastW = w; renderChart(); }
    }, 60));
    ro.observe($('chart-wrap'));

    // Keep the map's own zoom/compass controls clear of the dock. The dock
    // changes height whenever the profile chart is toggled, a pilot is added,
    // or the device rotates, so a fixed offset buries the controls under it.
    const dockRo = new ResizeObserver(() => syncDockHeight());
    dockRo.observe($('dock'));
  }
  syncDockHeight();
}

/**
 * Publish the dock's real height as `--dock-h`, which the MapLibre control
 * stack is offset by.
 *
 * Clamped so the controls can never be pushed off the top of the screen: on a
 * short landscape phone the dock can be over half the viewport, and an
 * unclamped offset would move the zoom buttons out of reach entirely — the
 * opposite of the problem this solves.
 */
function syncDockHeight() {
  // A backgrounded tab lays out at zero height. Writing a clamp derived from
  // that would pin the offset to 0 and bury the controls; better to keep the
  // last good value and re-measure on visibilitychange.
  if (window.innerHeight < 300) return;

  const dock = $('dock');
  const visible = dock && !dock.classList.contains('hidden');
  const raw = visible ? dock.getBoundingClientRect().height : 0;
  const cap = Math.max(0, window.innerHeight - 200);
  const h = Math.round(Math.min(raw, cap));
  document.documentElement.style.setProperty('--dock-h', `${h}px`);
}

function wireDragAndDrop() {
  const zone = $('dropzone');
  let depth = 0;

  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    depth++;
    zone.classList.remove('hidden');
  });
  window.addEventListener('dragover', (e) => {
    if (!zone.classList.contains('hidden')) e.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) zone.classList.add('hidden');
  });
  window.addEventListener('drop', (e) => {
    if (!e.dataTransfer) return;
    e.preventDefault();
    depth = 0;
    zone.classList.add('hidden');
    if (e.dataTransfer.files && e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  });
}

/** Drag anywhere on the profile chart to scrub the timeline. */
function wireChartScrub() {
  const wrap = $('chart-wrap');
  let dragging = false;

  const seekTo = (clientX) => {
    const clock = Charts.clockAtClientX($('chart-profile'), clientX, state.chartGeo, timeline.domain());
    if (clock !== null) timeline.seek(clock);
  };

  wrap.addEventListener('pointerdown', (e) => {
    if (!state.chartGeo) return;
    dragging = true;
    wrap.setPointerCapture(e.pointerId);
    timeline.pause();
    seekTo(e.clientX);
  });
  wrap.addEventListener('pointermove', (e) => { if (dragging) seekTo(e.clientX); });
  const stop = (e) => {
    if (!dragging) return;
    dragging = false;
    try { wrap.releasePointerCapture(e.pointerId); } catch { /* already released */ }
  };
  wrap.addEventListener('pointerup', stop);
  wrap.addEventListener('pointercancel', stop);
}

function wireKeyboard() {
  window.addEventListener('keydown', (e) => {
    // Never hijack typing in the pilot-name fields.
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    switch (e.key) {
      case ' ': e.preventDefault(); timeline.toggle(); break;
      case 'ArrowRight': e.preventDefault(); timeline.step(e.shiftKey ? 60 : 10); break;
      case 'ArrowLeft': e.preventDefault(); timeline.step(e.shiftKey ? -60 : -10); break;
      case 'Home': e.preventDefault(); timeline.rewindToStart(); break;
      case ']': announceHighlight(timeline.nextHighlight(1)); break;
      case '[': announceHighlight(timeline.nextHighlight(-1)); break;
      case 'c': cycleCamera(); break;
      case 'Escape': closeSheets(); break;
      default: break;
    }
  });
}

function announceHighlight(found) {
  if (!found) { showStatus('No more highlights that way.', '', 1800); return; }
  showStatus(`${found.track.pilotName}: ${found.highlight.description}`, '', 5200);
}

const CAMERAS = ['free', 'follow', 'chase'];

function cycleCamera() {
  const cur = Map3D.getCamera().mode;
  const next = CAMERAS[(CAMERAS.indexOf(cur) + 1) % CAMERAS.length];
  const first = state.tracks.find((t) => t.visible !== false);
  Map3D.setCamera(next, first ? first.id : null);
  setCameraLabel(next);
  if (next !== 'free' && !first) showStatus('Load a flight to follow.', 'warn', 2200);
}

function setCameraLabel(mode) {
  $('cam-label').textContent = mode;
  $('cam-btn').classList.toggle('active', mode !== 'free');
}

// ── small UI helpers ────────────────────────────────────────────────────────

function populateBasemaps() {
  const sel = $('basemap-select');
  sel.innerHTML = '';
  for (const b of Map3D.BASEMAPS) {
    const opt = document.createElement('option');
    opt.value = b.id;
    opt.textContent = b.label;
    if (b.id === state.basemap) opt.selected = true;
    sel.appendChild(opt);
  }
}

/** Reflect stored preferences in the layer sheet's controls. */
function syncLayerControls() {
  const exag = Number(Store.pref('exag', '1'));
  $('exag-range').value = String(exag);
  $('exag-out').textContent = `${exag.toFixed(1)}×`;
  Map3D.setExaggeration(exag);

  const shadow = Store.pref('shadow', '1') === '1';
  const pins = Store.pref('pins', '1') === '1';
  $('shadow-toggle').checked = shadow;
  $('hl-toggle').checked = pins;
  $('terrain-toggle').checked = state.fetchTerrain;
  Map3D.setShowShadow(shadow);
  Map3D.setShowHighlights(pins);

  $('alt-toggle').textContent = state.altMode.toUpperCase();
  $('alt-toggle').setAttribute('aria-pressed', String(state.altMode === 'agl'));
}

function updateTransportEnabled() {
  const has = state.tracks.some((t) => t.visible !== false);
  for (const id of ['tp-play', 'tp-start', 'tp-prev', 'tp-next']) $(id).disabled = !has;
  $('scrubber').disabled = !has;
}

function setDockVisible(on) {
  $('dock').classList.toggle('hidden', !on);
  syncDockHeight();
}
function setEmptyVisible(on) { $('empty').classList.toggle('hidden', !on); }

function openSheet(id) {
  closeSheets();
  $(id).classList.remove('hidden');
}

function closeSheets() {
  for (const s of document.querySelectorAll('.sheet')) s.classList.add('hidden');
}

let statusTimer = 0;

/**
 * @param {string} msg
 * @param {''|'error'|'warn'|'busy'} kind
 * @param {number} ms 0 keeps it up until the next call
 */
function showStatus(msg, kind = '', ms = 3000) {
  const el = $('status');
  el.textContent = msg;
  el.className = `status${kind ? ` ${kind}` : ''}`;
  clearTimeout(statusTimer);
  if (ms > 0) statusTimer = setTimeout(() => el.classList.add('hidden'), ms);
}

function onMapPick(object) {
  if (!object) return;
  if (object.kind === 'highlight') {
    jumpToHighlight(object.track, object.highlight);
  } else if (object.kind === 'glider') {
    const first = state.tracks.find((t) => t.id === object.track.id);
    if (first) {
      Map3D.setCamera('chase', first.id);
      setCameraLabel('chase');
      showStatus(`Chasing ${first.pilotName}`, '', 2000);
    }
  }
}

function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function debounce(fn, ms) {
  let t = 0;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
