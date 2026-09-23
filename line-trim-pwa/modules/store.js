// store.js — all persistence. localStorage only, no backend.

const K_CUSTOM   = 'pgtrim.customGliders';   // user-imported line plans
const K_SESSIONS = 'pgtrim.sessions';        // saved measurement sessions
const K_PREFS    = 'pgtrim.prefs';           // { lastWing, measureFrom, refOffsetMm, driver, … }
const K_DRAFT    = 'pgtrim.draft';           // the check in progress, so a reload never loses readings

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : structuredClone(fallback);
  } catch {
    return structuredClone(fallback);
  }
}
function write(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); }
  catch (e) { console.warn('store: write failed', key, e); }
}

export const prefs = {
  get()      { return read(K_PREFS, { refOffsetMm: 0, driver: 'ir40', measureFrom: 'riser', autoCapture: true }); },
  set(patch) { write(K_PREFS, { ...this.get(), ...patch }); },
};

export const customGliders = {
  all()  { return read(K_CUSTOM, []); },
  get(id){ return this.all().find(g => g.id === id) || null; },
  save(glider) {
    const list = this.all().filter(g => g.id !== glider.id);
    list.push(glider);
    write(K_CUSTOM, list);
  },
  remove(id) { write(K_CUSTOM, this.all().filter(g => g.id !== id)); },
};

export const sessions = {
  all()   { return read(K_SESSIONS, []).sort((a, b) => b.savedAt - a.savedAt); },
  get(id) { return this.all().find(s => s.id === id) || null; },
  save(session) {
    const list = read(K_SESSIONS, []).filter(s => s.id !== session.id);
    list.push(session);
    write(K_SESSIONS, list);
  },
  remove(id) { write(K_SESSIONS, read(K_SESSIONS, []).filter(s => s.id !== id)); },
};

// The unsaved check in progress. Written on every reading: a phone that kills
// the tab mid-check must not cost the pilot 140 measurements.
export const draft = {
  get() { return read(K_DRAFT, null); },
  set(session) { write(K_DRAFT, session); },
  clear() { try { localStorage.removeItem(K_DRAFT); } catch {} },
};

export function uid(prefix = 's') {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
