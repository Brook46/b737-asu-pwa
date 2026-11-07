// social-changes.js — what changed in a synced Social note since the pilot
// last said "Got it". The feed replaces every note wholesale, so each sync
// compares old with new: a note that differs keeps the text it had when last
// acknowledged (base) and the time of the latest change. The airport sheet
// shows "Changed …" on top and marks the new words in orange until the
// pilot taps Got it. The very first sync (nothing on the device yet) records
// nothing — that's the whole set arriving, not a change.
//
// THIS DEVICE ONLY, in its own localStorage key, like the highlights.

const KEY = 'fc.social.changes';

function all() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } }
function save(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch {} }
const norm = (t) => String(t == null ? '' : t).replace(/\r\n?/g, '\n');

// before / after: the whole social map, old and new. skip(text) is true for a
// note still in the old HTML form, which isn't diffed.
export function record(before, after, skip = () => false) {
  const b = before || {}, n = after || {};
  if (!Object.keys(b).length) return 0;            // first upload
  const a = all();
  const now = Date.now();
  let count = 0;
  for (const [k, v] of Object.entries(n)) {
    const was = norm(b[k]), cur = norm(v);
    if (was === cur) continue;
    const base = a[k] ? a[k].base : was;
    if (skip(base) || skip(cur)) { delete a[k]; continue; }
    if (base === cur) delete a[k];                  // changed back
    else { a[k] = { base, at: now }; count++; }
  }
  for (const k of Object.keys(a)) if (!(k in n)) delete a[k];
  save(a);
  return count;
}

export function get(code) {
  const r = all()[String(code || '').toUpperCase()];
  return r && typeof r.base === 'string' ? r : null;
}
// Got it: for every code given (an airport's IATA and ICAO both hold it).
export function clear(codes) {
  const a = all();
  for (const c of codes) delete a[String(c || '').toUpperCase()];
  save(a);
}

// Word diff of base → cur, in cur's character positions:
// { ins: [[s, e], …] new or changed words, del: [{ at, text }] words gone }.
const MAX_CELLS = 4e6;
export function diff(base, cur) {
  const A = norm(base).split(/(\s+)/).filter(Boolean);
  const C = norm(cur);
  const B = C.split(/(\s+)/).filter(Boolean);
  let p = 0;
  while (p < A.length && p < B.length && A[p] === B[p]) p++;
  let sa = A.length, sb = B.length;
  while (sa > p && sb > p && A[sa - 1] === B[sb - 1]) { sa--; sb--; }
  const a = A.slice(p, sa), b = B.slice(p, sb);
  // ops over the middle: ['=', tokB] | ['+', tokB] | ['-', tokA]
  const ops = [];
  if ((a.length + 1) * (b.length + 1) > MAX_CELLS) {
    for (const t of a) ops.push(['-', t]);
    for (const t of b) ops.push(['+', t]);
  } else {
    const m = a.length, n = b.length, W = n + 1;
    const L = new Uint32Array((m + 1) * W);
    for (let i = m - 1; i >= 0; i--)
      for (let j = n - 1; j >= 0; j--)
        L[i * W + j] = a[i] === b[j] ? L[(i + 1) * W + j + 1] + 1 : Math.max(L[(i + 1) * W + j], L[i * W + j + 1]);
    let i = 0, j = 0;
    while (i < m || j < n) {
      if (i < m && j < n && a[i] === b[j]) { ops.push(['=', b[j]]); i++; j++; }
      // Old words before the new ones that replace them.
      else if (i < m && (j >= n || L[(i + 1) * W + j] >= L[i * W + j + 1])) ops.push(['-', a[i++]]);
      else ops.push(['+', b[j++]]);
    }
  }
  let at = B.slice(0, p).join('').length;
  const ins = [], del = [];
  for (const [op, t] of ops) {
    if (op === '-') {
      if (!t.trim()) continue;
      const last = del[del.length - 1];
      if (last && last.at === at) last.text += ' ' + t; else del.push({ at, text: t });
      continue;
    }
    if (op === '+' && t.trim()) {
      const last = ins[ins.length - 1];
      // Join words split only by spaces into one mark.
      if (last && !C.slice(last[1], at).trim()) last[1] = at + t.length; else ins.push([at, at + t.length]);
    }
    at += t.length;
  }
  return { ins, del };
}

// How many places changed, for the banner.
export function places(d) {
  if (!d) return 0;
  const pts = new Set(d.ins.map(r => r[0]));
  for (const x of d.del) if (!d.ins.some(r => x.at >= r[0] && x.at <= r[1])) pts.add('d' + x.at);
  return pts.size;
}
