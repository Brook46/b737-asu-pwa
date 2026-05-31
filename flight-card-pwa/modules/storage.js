// storage.js — localStorage-backed state for Flight Card.
//
// Schema (single key "fc.state" v2):
// {
//   v: 2,
//   template: { sections: [{ id, name, items: [{ id, label }] }] },
//   speeches: [{ id, name, body }],
//   current:  { id, started, dataCard:{}, ticks:{ itemId: ts }, notes:{ itemId: string } },
//   history:  [ same shape as current, latest first, capped to HISTORY_MAX ]
// }

const KEY = 'fc.state';
const VERSION = 2;
const HISTORY_MAX = 20;

const DEFAULT_TEMPLATE = {
  sections: [
    { id: 's-cabin', name: 'Cabin & galley', items: [
      { id: 'i-waste',   label: 'Waste tank empty' },
      { id: 'i-2c',      label: '2C on board' },
    ]},
    { id: 's-perf', name: 'Performance', items: [
      { id: 'i-perf-calc', label: 'Live performance calculation' },
    ]},
    { id: 's-start', name: 'Before start', items: [
      { id: 'i-doors',  label: 'Doors closed' },
      { id: 'i-beacon', label: 'Beacon on' },
      { id: 'i-clx',    label: 'Clearance read back' },
    ]},
  ],
};

const DEFAULT_SPEECHES = [
  { id: 'sp-welcome', name: 'Welcome', body:
`Good [morning/afternoon/evening] ladies and gentlemen, welcome on board.

This is Captain @cpt speaking. With me on the flight deck today is First Officer @fo. Looking after you in the cabin is our purser @PU and the rest of the cabin crew.

Our flight time to @arr is approximately [X] hours [Y] minutes. We expect a [smooth/bumpy] ride at cruise altitude FL[XXX].

Sit back, relax, and enjoy the flight.` },
  { id: 'sp-climb', name: 'After takeoff', body:
`Ladies and gentlemen, this is the flight deck. We've now reached our initial cruising altitude.

Captain @cpt and First Officer @fo wish you a pleasant flight. The seatbelt sign will remain on for now.

Cabin crew, please begin your service.` },
  { id: 'sp-cruise', name: 'Cruise', body:
`Ladies and gentlemen, from the flight deck — @cpt speaking.

We're currently cruising at FL[XXX], ground speed [XXX] knots. Outside temperature is [-XX]°C. We expect to land in @arr at approximately [HH:MM] local time.

[Weather / sights / turbulence note]` },
  { id: 'sp-descent', name: 'Descent', body:
`Ladies and gentlemen, this is your captain speaking. We've started our descent towards @arr.

The local time is [HH:MM]. The weather in @arr is [clear/cloudy], temperature [XX]°C.

Please return to your seats, fasten your seatbelt, stow your tray table, and bring your seat back to the upright position.

Cabin crew, prepare the cabin for landing.` },
  { id: 'sp-landing', name: 'Welcome home', body:
`Ladies and gentlemen, welcome to @arr. The local time is [HH:MM] and the temperature is [XX]°C.

On behalf of Captain @cpt, First Officer @fo, purser @PU, and the entire crew — thank you for flying with us today. We hope to see you again soon.

Please remain seated until the seatbelt sign is switched off.` },
];

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
function clone(x) { return JSON.parse(JSON.stringify(x)); }

function freshState() {
  return {
    v: VERSION,
    template: clone(DEFAULT_TEMPLATE),
    speeches: clone(DEFAULT_SPEECHES),
    current: newFlightRecord(),
    history: [],
  };
}

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
  // Defensive defaults
  cache.template = cache.template || clone(DEFAULT_TEMPLATE);
  cache.speeches = Array.isArray(cache.speeches) && cache.speeches.length ? cache.speeches : clone(DEFAULT_SPEECHES);
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
  // v1 → v2: template was trimmed and renamed; reseed it.
  // Keep current flight + history so the user doesn't lose their numbers.
  return {
    v: VERSION,
    template: clone(DEFAULT_TEMPLATE),
    speeches: clone(DEFAULT_SPEECHES),
    current: s.current || newFlightRecord(),
    history: Array.isArray(s.history) ? s.history : [],
  };
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

// ---------- State accessors ----------
export function getState() { return read(); }
export function getTemplate() { return read().template; }
export function setTemplate(t) { read().template = t; scheduleWrite(); }

// ---------- Template editing ----------
export function addSection(name) {
  const s = read();
  const id = 's-' + Math.random().toString(36).slice(2, 8);
  s.template.sections.push({ id, name: name || 'New section', items: [] });
  scheduleWrite();
  return id;
}
export function renameSection(id, name) {
  const sec = read().template.sections.find(x => x.id === id);
  if (sec) { sec.name = name; scheduleWrite(); }
}
export function deleteSection(id) {
  const s = read();
  s.template.sections = s.template.sections.filter(x => x.id !== id);
  scheduleWrite();
}
export function moveSection(id, delta) {
  const list = read().template.sections;
  const i = list.findIndex(x => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  scheduleWrite();
}
export function addItem(sectionId, label) {
  const sec = read().template.sections.find(x => x.id === sectionId);
  if (!sec) return null;
  const id = 'i-' + Math.random().toString(36).slice(2, 8);
  sec.items.push({ id, label: label || 'New item' });
  scheduleWrite();
  return id;
}
export function renameItem(id, label) {
  for (const sec of read().template.sections) {
    const it = sec.items.find(x => x.id === id);
    if (it) { it.label = label; scheduleWrite(); return; }
  }
}
export function deleteItem(id) {
  const s = read();
  for (const sec of s.template.sections) {
    const before = sec.items.length;
    sec.items = sec.items.filter(x => x.id !== id);
    if (sec.items.length !== before) {
      delete s.current.ticks[id];
      delete s.current.notes[id];
      scheduleWrite();
      return;
    }
  }
}
export function moveItem(sectionId, itemId, delta) {
  const sec = read().template.sections.find(x => x.id === sectionId);
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

// ---------- Speeches ----------
export function getSpeeches() { return read().speeches; }
export function getSpeech(id) { return read().speeches.find(s => s.id === id); }
export function addSpeech(name) {
  const s = read();
  const id = 'sp-' + Math.random().toString(36).slice(2, 8);
  s.speeches.push({ id, name: name || 'New PA', body: '' });
  scheduleWrite();
  return id;
}
export function renameSpeech(id, name) {
  const sp = read().speeches.find(x => x.id === id);
  if (sp) { sp.name = name; scheduleWrite(); }
}
export function setSpeechBody(id, body) {
  const sp = read().speeches.find(x => x.id === id);
  if (sp) { sp.body = body; scheduleWrite(); }
}
export function deleteSpeech(id) {
  const s = read();
  s.speeches = s.speeches.filter(x => x.id !== id);
  scheduleWrite();
}
export function moveSpeech(id, delta) {
  const list = read().speeches;
  const i = list.findIndex(x => x.id === id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  scheduleWrite();
}

// ---------- New Flight / history ----------
export function newFlight() {
  const s = read();
  const hadContent =
    Object.keys(s.current.ticks).length > 0 ||
    Object.keys(s.current.dataCard).length > 0 ||
    Object.keys(s.current.notes).length > 0;
  if (hadContent) {
    s.history.unshift({ ...s.current, ended: Date.now() });
    s.history = s.history.slice(0, HISTORY_MAX);
  }
  s.current = newFlightRecord();
  scheduleWrite();
  return s.current;
}
export function getHistory() { return read().history; }
export function deleteHistoryEntry(id) {
  const s = read();
  s.history = s.history.filter(h => h.id !== id);
  scheduleWrite();
}

// ---------- Export / Import / Reset ----------
export function exportJson() { return JSON.stringify(read(), null, 2); }
export function importJson(json) {
  const parsed = JSON.parse(json);
  cache = migrate(parsed);
  flush();
  return cache;
}
export function resetAll() {
  cache = freshState();
  flush();
  return cache;
}

window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', flush);
