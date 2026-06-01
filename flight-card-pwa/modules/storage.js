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
const VERSION = 6;
const HISTORY_MAX = 20;

const DEFAULT_TEMPLATE = {
  sections: [
    { id: 's-cabin', name: 'Cabin', items: [
      { id: 'i-waste', label: 'Water waste' },
      { id: 'i-2c',    label: '2C' },
    ]},
    { id: 's-papers', name: 'Papers and performance', items: [
      { id: 'i-ls',         label: 'LS' },
      { id: 'i-notoc',      label: 'NOTOC' },
      { id: 'i-atl',        label: 'ATL' },
      { id: 'i-clearance',  label: 'Clearance' },
      { id: 'i-opt',        label: 'OPT' },
    ]},
    { id: 's-chk', name: 'Checklist', items: [
      { id: 'i-preflight',      label: 'Preflight' },
      { id: 'i-before-start',   label: 'Before start' },
      { id: 'i-cabin-ready',    label: 'Cabin ready' },
      { id: 'i-before-takeoff', label: 'Before takeoff' },
    ]},
  ],
};

const DEFAULT_SPEECHES = [
  {
    id: 'sp-welcome', name: 'Welcome',
    bodyEn:
`Good [morning/afternoon/evening] ladies and gentlemen, welcome on board flight @flight.

This is Captain @cpt speaking. With me on the flight deck is First Officer @fo. Looking after you in the cabin is our purser @PU and the rest of the cabin crew.

Our flight time to @arr is approximately @flighttime. The local time is @time.

Sit back, relax, and enjoy the flight.`,
    bodyHe:
`גבירותיי ורבותיי, ברוכים הבאים לטיסה @flight.
מדבר אליכם הקפטן @cpt. יחד איתי בקבינת הטייס קצין ראשון @fo. הצוות בקבינה בהובלת המנהלת @PU.
זמן הטיסה ל-@arr הוא @flighttime. השעה המקומית @time.
שבו, הירגעו, ותהנו מהטיסה.`
  },
  {
    id: 'sp-climb', name: 'After takeoff',
    bodyEn:
`Ladies and gentlemen, this is Captain @cpt from the flight deck. We've reached our initial cruise altitude.

The local time is @time. Our flight time to @arr is approximately @flighttime.

Cabin crew, please begin your service.`,
    bodyHe:
`גבירותיי ורבותיי, מדבר הקפטן @cpt מקבינת הטייס. הגענו לגובה השיוט הראשוני.
השעה המקומית @time. זמן הטיסה הצפוי ל-@arr הוא @flighttime.
צוות, מותר להתחיל את השירות.`
  },
  {
    id: 'sp-cruise', name: 'Cruise',
    bodyEn:
`Ladies and gentlemen, this is @cpt from the flight deck.

We're cruising at FL[XXX], ground speed [XXX] knots. Local time is @time. Expected landing in @arr in approximately @flighttime.

[Weather / sights / turbulence note]`,
    bodyHe:
`גבירותיי ורבותיי, מדבר @cpt מקבינת הטייס.
אנו טסים בגובה השיוט. השעה המקומית @time. הנחיתה ב-@arr צפויה בעוד @flighttime.
[הערות מזג אוויר / נוף / מערבולות]`
  },
  {
    id: 'sp-descent', name: 'Descent',
    bodyEn:
`Ladies and gentlemen, this is the captain speaking. We've started our descent towards @arr.

The local time at @arr is @time. Approximately @flighttime to landing.

Please return to your seats, fasten your seatbelt, stow your tray table, and bring your seat back to the upright position.

Cabin crew, prepare the cabin for landing.`,
    bodyHe:
`גבירותיי ורבותיי, מדבר הקפטן. התחלנו בירידה לקראת @arr.
השעה ב-@arr היא @time. נחיתה בעוד @flighttime.
אנא חיזרו למקומותיכם, חיגרו חגורות, סגרו את שולחנות האוכל והחזירו את גב הכיסא למצב זקוף.
צוות, הכינו את הקבינה לנחיתה.`
  },
  {
    id: 'sp-landing', name: 'Welcome home',
    bodyEn:
`Ladies and gentlemen, welcome to @arr. The local time is @time.

On behalf of Captain @cpt, First Officer @fo, purser @PU, and the entire crew — thank you for flying with us today. We hope to see you again soon.

Please remain seated until the seatbelt sign is switched off.`,
    bodyHe:
`גבירותיי ורבותיי, ברוכים הבאים ל-@arr. השעה המקומית @time.
בשמו של הקפטן @cpt, קצין ראשון @fo, המנהלת @PU וכל הצוות — תודה שטסתם איתנו. נשמח לראות אתכם שוב.
אנא הישארו במקומותיכם עד לכיבוי שלט חגורות הבטיחות.`
  },
];

function newFlightRecord() {
  return {
    id: makeFlightId(),
    started: Date.now(),
    dataCard: {},
    ticks: {},
    notes: {},
    legs: [],
    legIndex: 0,
  };
}
function makeFlightId() {
  return 'f-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6);
}
function clone(x) { return JSON.parse(JSON.stringify(x)); }

const DEFAULT_SETTINGS = {
  calendar: { url: '', proxy: 'https://corsproxy.io/?' },
};

function freshState() {
  return {
    v: VERSION,
    template: clone(DEFAULT_TEMPLATE),
    speeches: clone(DEFAULT_SPEECHES),
    settings: clone(DEFAULT_SETTINGS),
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
  cache.settings = cache.settings || clone(DEFAULT_SETTINGS);
  cache.settings.calendar = cache.settings.calendar || clone(DEFAULT_SETTINGS.calendar);
  if (typeof cache.settings.calendar.url   !== 'string') cache.settings.calendar.url = '';
  if (typeof cache.settings.calendar.proxy !== 'string') cache.settings.calendar.proxy = DEFAULT_SETTINGS.calendar.proxy;
  cache.current  = cache.current  || newFlightRecord();
  cache.current.dataCard = cache.current.dataCard || {};
  cache.current.ticks    = cache.current.ticks    || {};
  cache.current.notes    = cache.current.notes    || {};
  cache.current.legs     = Array.isArray(cache.current.legs) ? cache.current.legs : [];
  cache.current.legIndex = Number.isInteger(cache.current.legIndex) ? cache.current.legIndex : 0;
  cache.history  = Array.isArray(cache.history) ? cache.history : [];
  return cache;
}

function migrate(s) {
  if (!s || typeof s !== 'object') return freshState();
  if (s.v === VERSION) return s;
  // Speech upgrade (v2→v3 schema): { body } → { bodyEn, bodyHe }.
  const upgradedSpeeches = (Array.isArray(s.speeches) && s.speeches.length)
    ? s.speeches.map(sp => {
        if (sp.bodyEn || sp.bodyHe) return sp;
        const dflt = DEFAULT_SPEECHES.find(d => d.name === sp.name);
        return {
          id: sp.id,
          name: sp.name || 'PA',
          bodyEn: sp.body || dflt?.bodyEn || '',
          bodyHe: dflt?.bodyHe || '',
        };
      })
    : clone(DEFAULT_SPEECHES);
  // v3→v4: reseed checklist template (new defaults).
  // v4→v5: seed legs: [] + legIndex: 0 on current flight.
  // v5→v6: add settings.calendar block (defaults if missing) — non-destructive.
  const current = s.current || newFlightRecord();
  current.legs = Array.isArray(current.legs) ? current.legs : [];
  current.legIndex = Number.isInteger(current.legIndex) ? current.legIndex : 0;
  const settings = (s.settings && typeof s.settings === 'object') ? s.settings : {};
  settings.calendar = settings.calendar || clone(DEFAULT_SETTINGS.calendar);
  return {
    v: VERSION,
    template: clone(DEFAULT_TEMPLATE),
    speeches: upgradedSpeeches,
    settings,
    current,
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

// ---------- Settings ----------
export function getSettings() { return read().settings || {}; }
export function getCalendarConfig() {
  const s = read().settings;
  return { url: s.calendar?.url || '', proxy: s.calendar?.proxy || '' };
}
export function setCalendarConfig({ url, proxy }) {
  const s = read();
  s.settings = s.settings || {};
  s.settings.calendar = s.settings.calendar || {};
  if (typeof url   === 'string') s.settings.calendar.url   = url.trim();
  if (typeof proxy === 'string') s.settings.calendar.proxy = proxy.trim();
  scheduleWrite();
}

// ---------- Legs (multi-flight roster) ----------
export function getLegs() { return read().current.legs || []; }
export function getLegIndex() { return read().current.legIndex || 0; }
export function getLeg(i) {
  const c = read().current;
  const idx = (typeof i === 'number') ? i : (c.legIndex || 0);
  return c.legs?.[idx] || null;
}
export function setLegs(legs) {
  const c = read().current;
  c.legs = Array.isArray(legs) ? legs.slice() : [];
  c.legIndex = 0;
  scheduleWrite();
}
export function setLegIndex(i) {
  const c = read().current;
  const max = (c.legs?.length || 1) - 1;
  c.legIndex = Math.max(0, Math.min(max, i | 0));
  scheduleWrite();
}
export function clearLegs() {
  const c = read().current;
  c.legs = [];
  c.legIndex = 0;
  scheduleWrite();
}

// ---------- Speeches ----------
export function getSpeeches() { return read().speeches; }
export function getSpeech(id) { return read().speeches.find(s => s.id === id); }
export function addSpeech(name) {
  const s = read();
  const id = 'sp-' + Math.random().toString(36).slice(2, 8);
  s.speeches.push({ id, name: name || 'New PA', bodyEn: '', bodyHe: '' });
  scheduleWrite();
  return id;
}
export function renameSpeech(id, name) {
  const sp = read().speeches.find(x => x.id === id);
  if (sp) { sp.name = name; scheduleWrite(); }
}
export function setSpeechBody(id, lang, body) {
  const sp = read().speeches.find(x => x.id === id);
  if (!sp) return;
  if (lang === 'he') sp.bodyHe = body;
  else sp.bodyEn = body;
  scheduleWrite();
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
