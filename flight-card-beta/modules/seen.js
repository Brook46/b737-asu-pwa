// seen.js — "changed since you last looked", per airport, for the Brief's
// weather tiles: the TAF's forecast groups and the NOTAM ids as they were
// when the pilot last tapped Got it. The first look at an airport is just
// remembered (nothing is "new" on a card you've never seen). Device-only.

const KEY = 'fc.seen';
const MAX_AIRPORTS = 40;
function all() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
function save(o) {
  const keys = Object.keys(o).sort((a, b) => (o[b].at || 0) - (o[a].at || 0));
  for (const k of keys.slice(MAX_AIRPORTS)) delete o[k];
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {}
}

// A TAF as its forecast groups, without the header (TAF AMD LEBL 231100Z
// 2312/2412): a routine re-issue with the same forecast isn't a change.
export function tafGroups(taf) {
  const t = String(taf || '').replace(/\s+/g, ' ').trim()
    .replace(/^TAF\s+(AMD\s+|COR\s+)?[A-Z]{4}\s+\d{6}Z\s+(\d{4}\/\d{4}\s+)?/, '');
  if (!t) return [];
  return t.split(/\s(?=(?:BECMG|TEMPO|PROB\d0|FM\d{6})\b)/).map(g => g.trim()).filter(Boolean)
    // PROB30 TEMPO … reads as one group
    .reduce((a, g) => { if (/^PROB\d0$/.test(a[a.length - 1] || '')) a[a.length - 1] += ' ' + g; else a.push(g); return a; }, []);
}

// What's new at `icao` against the last Got it: { taf: [new groups], amd,
// notams: [{ id, line }] } or null when nothing changed (or first look).
export function changes(icao, taf, notams) {
  const o = all(), prev = o[icao];
  // `notams` null = not fetched; [] = fetched, none in force — "none" is
  // something seen, so the first NOTAM after it is new.
  const groups = tafGroups(taf), ids = notams ? notams.map(n => n.id) : null;
  if (!prev) {
    if (groups.length || ids) { o[icao] = { taf: groups, nt: ids, at: Date.now() }; save(o); }
    return null;
  }
  // A side we hadn't seen before (NOTAMs first fetched now) is only remembered.
  let dirty = false;
  if (!prev.taf?.length && groups.length) { prev.taf = groups; dirty = true; }
  if (prev.nt == null && ids) { prev.nt = ids; dirty = true; }
  if (dirty) save(o);
  const oldG = new Set(prev.taf || []), oldN = new Set(prev.nt || []);
  const newTaf = groups.length && prev.taf?.length ? groups.filter(g => !oldG.has(g)) : [];
  const newNt = prev.nt == null ? [] : (notams || []).filter(n => !oldN.has(n.id));
  if (!newTaf.length && !newNt.length) return null;
  return { taf: newTaf, amd: /^TAF\s+AMD\b/.test(String(taf || '').trim()), notams: newNt };
}
export function gotIt(icao, taf, notams) {
  const o = all();
  o[icao] = { taf: tafGroups(taf), nt: notams ? notams.map(n => n.id) : null, at: Date.now() };
  save(o);
}
