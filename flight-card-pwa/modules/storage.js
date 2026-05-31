// storage.js — localStorage-backed state for Flight Card.
//
// Schema (single key "fc.state" v1):
// {
//   v: 1,
//   settings: { wipeDataOnNewFlight: bool, idFormat: 'date-tail'|'date-flight'|'date-only', theme: 'auto'|'light'|'dark' },
//   template: { sections: [{ id, name, items: [{ id, label }] }] },
//   current:  { id, started, dataCard:{}, ticks:{ itemId: ts }, notes:{ itemId: string } },
//   history:  [ same shape as current, latest first, capped to HISTORY_MAX ]
// }

const KEY = 'fc.state';
const VERSION = 1;
const HISTORY_MAX = 20;

const DEFAULT_TEMPLATE = {
  sections: [
    { id: 's-cabin', name: 'Cabin & galley', items: [
      { id: 'i-waste',   label: 'Waste tank empty' },
      { id: 'i-2c',      label: '2C on board' },
      { id: 'i-cater',   label: 'Catering count verified' },
      { id: 'i-cab-sec', label: 'Cabin secure' },
    ]},
    { id: 's-cockpit', name: 'Cockpit setup', items: [
      { id: 'i-cb',     label: 'Overhead CB scan' },
      { id: 'i-o2',     label: 'Oxygen test' },
      { id: 'i-irs',    label: 'IRS align started' },
      { id: 'i-clock',  label: 'Clock set' },
    ]},
    { id: 's-perf', name: 'Performance', items: [
      { id: 'i-perf',   label: 'Performance calculated' },
      { id: 'i-atis',   label: 'ATIS copied' },
      { id: 'i-rwy',    label: 'Runway & flap confirmed' },
      { id: 'i-vsp',    label: 'V-speeds set & cross-checked' },
    ]},
    { id: 's-brief', name: 'Briefing', items: [
      { id: 'i-sid',    label: 'SID briefed' },
      { id: 'i-msa',    label: 'MSA noted' },
      { id: 'i-threat', label: 'Threats noted' },
      { id: 'i-fuel',   label: 'Fuel plan agreed' },
    ]},
    { id: 's-crew', name: 'Crew', items: [
      { id: 'i-cpt',    label: 'CPT name written' },
      { id: 'i-fo',     label: 'FO name written' },
      { id: 'i-cc',     label: 'Cabin crew names written' },
      { id: 'i-purser', label: 'Purser introduced' },
    ]},
    { id: 's-push', name: 'Before push', items: [
      { id: 'i-doors',  label: 'Doors closed' },
      { id: 'i-beacon', label: 'Beacon on' },
      { id: 'i-clx',    label: 'Clearance read back' },
    ]},
  ],
};

const DEFAULT_SETTINGS = {
  wipeDataOnNewFlight: false,
  idFormat: 'date-tail',
  theme: 'auto',
};

function newFlightRecord() {
  return {
    id: makeFlightId(),
    started: Date.now(),
    dataCard: {},
    ticks: {},
    notes: {},
  };
}

function makeFlightId() {
  return 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}

function freshState() {
  return {
    v: VERSION,
    settings: { ...DEFAULT_SETTINGS },
    template: clone(DEFAULT_TEMPLATE),
    current: newFlightRecord(),
    history: [],
  };
}

function clone(x) { return JSON.parse(JSON.stringify(x)); }

let cache = null;

function read() {
  if (cache) return cache;
  let raw;
  try { raw = localStorage.getItem(KEY); } catch { raw = null; }
  if (!raw) { cache = freshState(); return cache; }
  try {
    const parsed = JSON.parse(raw);
    cache = migrate(parsed);
  } catch {
    cache = freshState();
  }
  // Defensive defaults for any missing keys
  cache.settings = { ...DEFAULT_SETTINGS, ...(cache.settings || {}) };
  cache.template = cache.template || clone(DEFAULT_TEMPLATE);
  cache.current  = cache.current  || newFlightRecord();
  cache.current.dataCard = cache.current.dataCard || {};
  cache.current.ticks    = cache.current.ticks    || {};
  cache.current.notes    = cache.current.notes    || {};
  cache.history  = Array.isArray(cache.history) ? cache.history : [];
  return cache;
}

function migrate(s) {
  if (!s || typeof s !== 'object') return freshState();
  if (s.v === VERSION) return s;
  // future migrations land here
  return { ...freshState(), ...s, v: VERSION };
}

let writeT = null;
function scheduleWrite() {
  if (writeT) clearTimeout(writeT);
  writeT = setTimeout(flush, 120);
}

export function flush() {
  if (writeT) { clearTimeout(writeT); writeT = null; }
  if (!cache) return;
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch (e) { console.warn('storage write failed', e); }
}

// ---------- Public API ----------

export function getState() { return read(); }
export function getSettings() { return read().settings; }
export function setSetting(key, value) {
  const s = read();
  s.settings[key] = value;
  scheduleWrite();
}

export function getTemplate() { return read().template; }

export function setTemplate(template) {
  const s = read();
  s.template = template;
  scheduleWrite();
}

export function addSection(name) {
  const s = read();
  const id = 's-' + Math.random().toString(36).slice(2, 8);
  s.template.sections.push({ id, name: name || 'New section', items: [] });
  scheduleWrite();
  return id;
}

export function renameSection(sectionId, name) {
  const s = read();
  const sec = s.template.sections.find(x => x.id === sectionId);
  if (sec) { sec.name = name; scheduleWrite(); }
}

export function deleteSection(sectionId) {
  const s = read();
  s.template.sections = s.template.sections.filter(x => x.id !== sectionId);
  scheduleWrite();
}

export function moveSection(sectionId, delta) {
  const s = read();
  const list = s.template.sections;
  const i = list.findIndex(x => x.id === sectionId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  scheduleWrite();
}

export function addItem(sectionId, label) {
  const s = read();
  const sec = s.template.sections.find(x => x.id === sectionId);
  if (!sec) return null;
  const id = 'i-' + Math.random().toString(36).slice(2, 8);
  sec.items.push({ id, label: label || 'New item' });
  scheduleWrite();
  return id;
}

export function renameItem(itemId, label) {
  const s = read();
  for (const sec of s.template.sections) {
    const it = sec.items.find(x => x.id === itemId);
    if (it) { it.label = label; scheduleWrite(); return; }
  }
}

export function deleteItem(itemId) {
  const s = read();
  for (const sec of s.template.sections) {
    const before = sec.items.length;
    sec.items = sec.items.filter(x => x.id !== itemId);
    if (sec.items.length !== before) {
      delete s.current.ticks[itemId];
      delete s.current.notes[itemId];
      scheduleWrite();
      return;
    }
  }
}

export function moveItem(sectionId, itemId, delta) {
  const s = read();
  const sec = s.template.sections.find(x => x.id === sectionId);
  if (!sec) return;
  const i = sec.items.findIndex(x => x.id === itemId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= sec.items.length) return;
  [sec.items[i], sec.items[j]] = [sec.items[j], sec.items[i]];
  scheduleWrite();
}

// ---------- Current flight ----------

export function getCurrent() { return read().current; }

export function setTick(itemId, on) {
  const c = read().current;
  if (on) c.ticks[itemId] = Date.now();
  else delete c.ticks[itemId];
  scheduleWrite();
}

export function setNote(itemId, text) {
  const c = read().current;
  if (text && text.trim()) c.notes[itemId] = text.trim();
  else delete c.notes[itemId];
  scheduleWrite();
}

export function setDataField(key, value) {
  const c = read().current;
  if (value === '' || value == null) delete c.dataCard[key];
  else c.dataCard[key] = value;
  scheduleWrite();
}

export function setDataBulk(fields) {
  const c = read().current;
  for (const [k, v] of Object.entries(fields)) {
    if (v === '' || v == null) delete c.dataCard[k];
    else c.dataCard[k] = v;
  }
  scheduleWrite();
}

// ---------- New Flight / history ----------

export function newFlight() {
  const s = read();
  const wipeData = s.settings.wipeDataOnNewFlight;
  // Archive current to history if it has any meaningful content
  const hadContent =
    Object.keys(s.current.ticks).length > 0 ||
    Object.keys(s.current.dataCard).length > 0 ||
    Object.keys(s.current.notes).length > 0;
  if (hadContent) {
    s.history.unshift({ ...s.current, ended: Date.now() });
    s.history = s.history.slice(0, HISTORY_MAX);
  }
  const carry = wipeData ? {} : { ...s.current.dataCard };
  s.current = newFlightRecord();
  s.current.dataCard = carry;
  scheduleWrite();
  return s.current;
}

export function getHistory() { return read().history; }

export function deleteHistoryEntry(flightId) {
  const s = read();
  s.history = s.history.filter(h => h.id !== flightId);
  scheduleWrite();
}

// ---------- Export / Import / Reset ----------

export function exportJson() {
  return JSON.stringify(read(), null, 2);
}

export function importJson(json) {
  let parsed;
  try { parsed = JSON.parse(json); } catch { throw new Error('Invalid JSON'); }
  cache = migrate(parsed);
  flush();
  return cache;
}

export function resetAll() {
  cache = freshState();
  flush();
  return cache;
}

// flush on page hide so iOS doesn't lose the in-flight debounce
window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', flush);
