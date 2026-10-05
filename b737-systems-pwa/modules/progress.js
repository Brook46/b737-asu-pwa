// progress.js — what the pilot has learned, per page ("sys" for the
// overview, "sys/part" for a part). Stored on this device.
//
// A page is:
//   new       never opened or heard
//   seen      opened or listened to, questions not yet answered
//   learning  some of its questions answered wrong last time (or not all tried)
//   learned   every question on it answered right on the latest try — or,
//             for a page with no questions, listened to all the way through
// A learned page comes back as "review" after REVIEW_DAYS.

import { QUESTIONS } from './quizbank.js?v=16';

const KEY = 'b737i.progress';
const REVIEW_DAYS = 14;
const DAY = 86400000;

const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };

export function createProgress() {
  const data = Object.assign({ pages: {}, q: {} }, load());
  const listeners = new Set();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* storage unavailable */ } for (const f of listeners) f(); };
  const page = (key) => (data.pages[key] ||= {});

  const qsOf = (key) => {
    const [sys, part] = key.split('/');
    return QUESTIONS.filter((q) => q.sys === sys && (q.part ?? null) === (part ?? null));
  };

  function status(key) {
    const p = data.pages[key] || {};
    const qs = qsOf(key);
    const touched = p.seen || p.heard;
    if (qs.length) {
      const tried = qs.filter((q) => data.q[q.id]);
      if (!tried.length) return touched ? 'seen' : 'new';
      const allOk = tried.length === qs.length && tried.every((q) => data.q[q.id].lastOk);
      if (!allOk) return 'learning';
      const oldest = Math.min(...qs.map((q) => data.q[q.id].last));
      return Date.now() - oldest > REVIEW_DAYS * DAY ? 'review' : 'learned';
    }
    if (p.heard) return Date.now() - p.heard > REVIEW_DAYS * DAY ? 'review' : 'learned';
    return p.seen ? 'seen' : 'new';
  }

  return {
    onChange(fn) { listeners.add(fn); },
    markSeen(key) { if (!key) return; const p = page(key); if (!p.seen) { p.seen = Date.now(); save(); } },
    markHeard(key) { if (!key) return; page(key).heard = Date.now(); save(); },
    answer(qid, ok) {
      const s = (data.q[qid] ||= { n: 0, ok: 0 });
      s.n++; if (ok) s.ok++;
      s.last = Date.now(); s.lastOk = ok;
      save();
    },
    status,
    qstat: (qid) => data.q[qid],
    /** Totals for a list of page keys. */
    summary(keys) {
      const c = { new: 0, seen: 0, learning: 0, learned: 0, review: 0 };
      for (const k of keys) c[status(k)]++;
      const answered = Object.values(data.q);
      return { ...c, total: keys.length,
        pct: keys.length ? Math.round((100 * c.learned) / keys.length) : 0,
        answered: answered.reduce((a, s) => a + s.n, 0),
        correct: answered.reduce((a, s) => a + s.ok, 0) };
    },
    /**
     * Pick a quiz: wrong-last-time first, then questions on pages already
     * studied but not yet asked, then new ones, then the longest-ago right.
     */
    pickQuiz(n = 10, sys = null) {
      const pool = QUESTIONS.filter((q) => !sys || q.sys === sys);
      const key = (q) => (q.part ? `${q.sys}/${q.part}` : q.sys);
      const rank = (q) => {
        const s = data.q[q.id];
        if (s && !s.lastOk) return 0;
        const st = status(key(q));
        if (!s && (st === 'seen' || st === 'learning')) return 1;
        if (!s) return 2;
        return 3 + (1 - Math.min(1, (Date.now() - s.last) / (REVIEW_DAYS * DAY)));
      };
      return pool.map((q) => ({ q, k: rank(q) + Math.random() * 0.5 })).sort((a, b) => a.k - b.k).slice(0, n).map((x) => x.q);
    },
    reset() { data.pages = {}; data.q = {}; save(); },
  };
}
