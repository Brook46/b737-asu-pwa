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
// v7: per-leg dataCard/ticks/notes. Each leg in current.legs[] owns its own
// bag of data, so switching legs swaps fuel / SOB / ATIS / TO performance /
// checklist with it. Top-level current.dataCard/ticks/notes stays as the
// fallback "single-flight" store when there are no legs at all.
const VERSION = 7;
const HISTORY_MAX = 20;

// Fields whose values are tied to the leg's *identity* (route, schedule,
// flight number, tail). When new legs come in from a roster, these get
// seeded into the leg's dataCard so the data card reads from a single
// source of truth and the user's manual edits per-leg are preserved.
const LEG_IDENTITY_KEYS = ['flight','tail','dep','arr','flight_time','ctot'];

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
  // v6→v7: per-leg bags. Each leg gets its own dataCard/ticks/notes. Existing
  //        top-level current.dataCard/ticks/notes get copied into the active
  //        leg (if any) so in-flight data stays attached to that leg.
  const current = s.current || newFlightRecord();
  current.legs = Array.isArray(current.legs) ? current.legs : [];
  current.legIndex = Number.isInteger(current.legIndex) ? current.legIndex : 0;
  current.dataCard = current.dataCard || {};
  current.ticks    = current.ticks    || {};
  current.notes    = current.notes    || {};
  if (current.legs.length) {
    // Make sure every leg has its own bags.
    for (const leg of current.legs) {
      if (!leg.dataCard || typeof leg.dataCard !== 'object') leg.dataCard = {};
      if (!leg.ticks    || typeof leg.ticks    !== 'object') leg.ticks    = {};
      if (!leg.notes    || typeof leg.notes    !== 'object') leg.notes    = {};
      // Seed the leg's dataCard with its own identity fields if absent so
      // the data card reads from a single source of truth.
      for (const k of LEG_IDENTITY_KEYS) {
        if (leg.dataCard[k] == null && leg[k] != null && leg[k] !== '') {
          leg.dataCard[k] = leg[k];
        }
      }
    }
    // Pour the pre-v7 top-level dataCard/ticks/notes into the active leg.
    // The user was clearly editing the active leg before the upgrade, so
    // the data belongs there. After migration, top-level stays empty.
    const idx = Math.max(0, Math.min(current.legs.length - 1, current.legIndex));
    const tgt = current.legs[idx];
    for (const [k, v] of Object.entries(current.dataCard)) if (tgt.dataCard[k] == null) tgt.dataCard[k] = v;
    for (const [k, v] of Object.entries(current.ticks))    if (tgt.ticks[k]    == null) tgt.ticks[k]    = v;
    for (const [k, v] of Object.entries(current.notes))    if (tgt.notes[k]    == null) tgt.notes[k]    = v;
    current.dataCard = {};
    current.ticks    = {};
    current.notes    = {};
  }
  return {
    v: VERSION,
    template: clone(DEFAULT_TEMPLATE),
    speeches: upgradedSpeeches,
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
//
// Per-leg model: when current.legs[] is non-empty, every read of dataCard /
// ticks / notes routes through the active leg. The top-level current.dataCard
// is only used when there are no legs (single-flight mode). This keeps the
// rest of the app (data-card.js, checklist.js, speeches.js) blissfully
// unaware of the legs concept — they just call getCurrent().dataCard etc.

function activeLeg() {
  const c = read().current;
  if (!Array.isArray(c.legs) || !c.legs.length) return null;
  const i = Math.max(0, Math.min(c.legs.length - 1, c.legIndex | 0));
  const leg = c.legs[i];
  if (!leg) return null;
  // Lazy-create bags so legs imported pre-v7 (or from share-target) still work.
  if (!leg.dataCard || typeof leg.dataCard !== 'object') leg.dataCard = {};
  if (!leg.ticks    || typeof leg.ticks    !== 'object') leg.ticks    = {};
  if (!leg.notes    || typeof leg.notes    !== 'object') leg.notes    = {};
  // Seed identity fields once so the data card reads consistently.
  for (const k of LEG_IDENTITY_KEYS) {
    if (leg.dataCard[k] == null && leg[k] != null && leg[k] !== '') {
      leg.dataCard[k] = leg[k];
    }
  }
  return leg;
}
function dataCardBag()  { return (activeLeg() || read().current).dataCard; }
function ticksBag()     { return (activeLeg() || read().current).ticks; }
function notesBag()     { return (activeLeg() || read().current).notes; }

export function getCurrent() {
  const c = read().current;
  const leg = activeLeg();
  if (!leg) return c;
  // Synthesise a view that points at the active leg's bags. Returning a
  // fresh object each call is cheap and keeps callers from accidentally
  // mutating the top-level current.dataCard.
  return {
    id: c.id,
    started: c.started,
    legs: c.legs,
    legIndex: c.legIndex,
    dataCard: leg.dataCard,
    ticks: leg.ticks,
    notes: leg.notes,
  };
}
export function setTick(itemId, on) {
  const bag = ticksBag();
  if (on) bag[itemId] = Date.now();
  else delete bag[itemId];
  scheduleWrite();
}
export function setNote(itemId, text) {
  const bag = notesBag();
  if (text && text.trim()) bag[itemId] = text.trim();
  else delete bag[itemId];
  scheduleWrite();
}
export function setDataField(key, value) {
  const bag = dataCardBag();
  if (value === '' || value == null) delete bag[key];
  else bag[key] = value;
  // Keep the leg's top-level identity fields in sync with the data card so
  // the leg-switcher chip and the depTs() sort still see edits made in the
  // data card (e.g. fixing a dep airport on the fly).
  const leg = activeLeg();
  if (leg && LEG_IDENTITY_KEYS.includes(key)) {
    if (value === '' || value == null) leg[key] = '';
    else leg[key] = value;
  }
  scheduleWrite();
}
export function setDataBulk(fields) {
  const bag = dataCardBag();
  const leg = activeLeg();
  for (const [k, v] of Object.entries(fields)) {
    if (v === '' || v == null) delete bag[k];
    else bag[k] = v;
    if (leg && LEG_IDENTITY_KEYS.includes(k)) {
      if (v === '' || v == null) leg[k] = '';
      else leg[k] = v;
    }
  }
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

// Append new legs to the persistent list, sort the whole list by UTC dep
// time, then point legIndex at the first newly-added leg so the data card
// switches to it. Returns the new index of the first added leg.
//
// Each new leg gets its own dataCard/ticks/notes bags. Identity fields
// (flight/tail/dep/arr/flight_time/ctot) and crew fields (cpt/fo/cc1..cc5)
// are seeded into the leg's dataCard so the data card has somewhere to
// read from on first switch. Crew comes from the leg's parsed row.
export function appendLegs(newLegs) {
  if (!Array.isArray(newLegs) || !newLegs.length) return read().current.legIndex || 0;
  const c = read().current;
  const existing = Array.isArray(c.legs) ? c.legs : [];
  // Seed bags on each new leg up front.
  const SEED_KEYS = LEG_IDENTITY_KEYS.concat(['cpt','fo','cc1','cc2','cc3','cc4','cc5']);
  for (const leg of newLegs) {
    if (!leg.dataCard || typeof leg.dataCard !== 'object') leg.dataCard = {};
    if (!leg.ticks    || typeof leg.ticks    !== 'object') leg.ticks    = {};
    if (!leg.notes    || typeof leg.notes    !== 'object') leg.notes    = {};
    for (const k of SEED_KEYS) {
      if (leg.dataCard[k] == null && leg[k] != null && leg[k] !== '') {
        leg.dataCard[k] = leg[k];
      }
    }
  }
  // Tag added legs so we can find the first one after sorting
  const sentinel = Symbol('newly-added');
  newLegs.forEach(l => { l[sentinel] = true; });
  const combined = existing.concat(newLegs);
  combined.sort((a, b) => depTs(a) - depTs(b));
  const firstAddedIdx = combined.findIndex(l => l[sentinel]);
  newLegs.forEach(l => { delete l[sentinel]; });
  c.legs = combined;
  c.legIndex = Math.max(0, firstAddedIdx);
  scheduleWrite();
  return c.legIndex;
}

// Delete a single leg by index. Adjusts legIndex if the deleted leg was
// before or at the current one.
export function deleteLeg(idx) {
  const c = read().current;
  if (!Array.isArray(c.legs) || idx < 0 || idx >= c.legs.length) return;
  c.legs.splice(idx, 1);
  if (idx < c.legIndex) c.legIndex--;
  if (c.legIndex >= c.legs.length) c.legIndex = Math.max(0, c.legs.length - 1);
  scheduleWrite();
}

// Combine a leg's dep_date (dd.mm) + dep_time (HH:MM UTC) into a comparable
// timestamp. Used by appendLegs to keep the list time-sorted.
function depTs(leg) {
  const d = leg?.dep_date, t = leg?.dep_time;
  if (!d || !t) return Number.MAX_SAFE_INTEGER;
  const [dd, mm] = d.split('.');
  if (!dd || !mm) return Number.MAX_SAFE_INTEGER;
  const year = new Date().getUTCFullYear();
  const iso = `${year}-${mm}-${dd}T${t}:00Z`;
  let ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return Number.MAX_SAFE_INTEGER;
  // If the parsed time is >6 months stale, assume next year (handles
  // year-end bulletins gracefully).
  if (Date.now() - ts > 6 * 30 * 24 * 3600 * 1000) {
    ts = Date.parse(`${year + 1}-${mm}-${dd}T${t}:00Z`);
  }
  return ts;
}

// Clear just the ticks (and notes) on the *active leg* (or top-level
// current if there are no legs) — used by the checklist card's reset
// button and the "Reset all" flow. Other legs keep their ticks.
export function resetTicks() {
  const leg = activeLeg();
  const tgt = leg || read().current;
  tgt.ticks = {};
  tgt.notes = {};
  scheduleWrite();
}

// Wipe the active leg's data card (V-speeds, fuel, ATIS, SOB, route, crew, …).
// Used by "Reset all" — caller is responsible for re-applying the active
// leg's metadata afterwards if they want the flight identity preserved.
export function clearDataCard() {
  const leg = activeLeg();
  const tgt = leg || read().current;
  tgt.dataCard = {};
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

// Single-leg export/import — used by the QR share path. Each payload is
// just one flight's worth of data: identity, dataCard, ticks, notes.
// History and template aren't included (those are device-local concepts
// and shouldn't follow a single flight across devices).
//
// Wire shape (tiny, fits a v25-ish QR with M error correction):
//   { v: 7, kind: 'leg', leg: { ...flight-leg fields..., dataCard, ticks, notes } }
export function exportLeg(idx) {
  const c = read().current;
  const i = (typeof idx === 'number')
    ? idx
    : Math.max(0, c.legIndex | 0);
  // When there are no legs, synthesise one from the top-level current bag
  // so single-flight users can still share what they've got.
  if (!Array.isArray(c.legs) || !c.legs.length) {
    return JSON.stringify({
      v: VERSION, kind: 'leg',
      leg: {
        flight:      c.dataCard.flight || '',
        tail:        c.dataCard.tail   || '',
        dep:         c.dataCard.dep    || '',
        arr:         c.dataCard.arr    || '',
        flight_time: c.dataCard.flight_time || '',
        ctot:        c.dataCard.ctot   || '',
        dep_date: '', dep_time: '', arr_date: '', arr_time: '',
        dataCard: c.dataCard,
        ticks:    c.ticks,
        notes:    c.notes,
      }
    });
  }
  const leg = c.legs[Math.max(0, Math.min(c.legs.length - 1, i))];
  return JSON.stringify({ v: VERSION, kind: 'leg', leg });
}

// Accepts a leg payload (as produced by exportLeg) and appends it to the
// current flight's legs[]. Returns the new leg's index so the caller can
// switch to it. Throws if the payload doesn't look like a leg envelope.
export function importLeg(json) {
  const parsed = (typeof json === 'string') ? JSON.parse(json) : json;
  if (!parsed || parsed.kind !== 'leg' || !parsed.leg) {
    throw new Error('Not a Flight Card leg payload');
  }
  // Deep-clone so the imported leg doesn't share references with the caller.
  return appendLegs([clone(parsed.leg)]);
}
export function resetAll() {
  cache = freshState();
  flush();
  return cache;
}

window.addEventListener('pagehide', flush);
window.addEventListener('beforeunload', flush);
