// pay.js — a month's pay items to check on the payslip: hours over the
// month's limit, late flights, short rest, call-outs, free days.
//
// NO RULES LIVE HERE. Every threshold and rate comes from the pilot's own
// rules file (imported on the device, never in this repository) and their
// "card one" (base salary, rank, personal rates). Without a rules file
// nothing is checked. A missing number means that check is skipped, never
// guessed.
//
// Pure functions, no DOM: app.js paints the sheet from monthReport().

import { legTimes, groupFdps } from './ftl.js?v=277';

const H = 3600000, MIN = 60000, DAY = 86400000;
const HOME = new Set(['TLV', 'LLBG']);
const num = (v) => (v === null || v === undefined || v === '' ? null : (Number.isFinite(+v) ? +v : null));

// ---------- Israel calendar ----------
const ilParts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function il(ms) {
  const p = Object.fromEntries(ilParts.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mi: +p.minute, key: `${p.year}-${p.month}-${p.day}` };
}
// Local midnight (Israel) of y-m-d, as UTC ms.
function ilMidnight(y, m, d) {
  let ts = Date.UTC(y, m - 1, d);
  for (let i = 0; i < 2; i++) { const p = il(ts); ts -= ((p.hh * 60 + p.mi) * MIN) + (Date.UTC(p.y, p.m - 1, p.d) - Date.UTC(y, m - 1, d)); }
  return ts;
}
const dayKeyUtc = (ms) => new Date(ms).toISOString().slice(0, 10);   // an all-day duty's date
export function hm(h) { const t = Math.round(Math.abs(h) * 60); return `${h < 0 ? '−' : ''}${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }
export function monthName(y, m) { return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }); }

// ---------- rules file ----------
export const RULES_TAG = 'flightcard-pay-rules';
export function parseRules(text) {
  let r;
  try { r = JSON.parse(text); } catch { throw new Error('Not a JSON file'); }
  if (!r || r.app !== RULES_TAG) throw new Error('Not a Flight Card pay rules file');
  return r;
}
export function rulesLabel(r) { return r ? `${r.title || 'Pay rules'}${r.v ? ' (v' + r.v + ')' : ''}` : ''; }

// A rate: card one first, then the rules for the pilot's rank, then the
// rules. A number is money; { x: 1.25 } is that many times the hourly rate
// (card one's, else base salary ÷ rules.hourDivisor).
export function rateOf(key, rules, card) {
  const c = card || {}, r = rules || {};
  const v = [c.pay && c.pay[key], r.payByRank && c.rank && r.payByRank[c.rank] && r.payByRank[c.rank][key], r.pay && r.pay[key]]
    .find(x => x !== null && x !== undefined && x !== '');
  if (v === undefined) return null;
  if (typeof v === 'object' && v && num(v.x) != null) {
    const hourly = num(c.hourly) ?? (num(c.base) != null && num(r.hourDivisor) ? num(c.base) / num(r.hourDivisor) : null);
    return hourly == null ? null : hourly * num(v.x);
  }
  return num(v);
}

// ---------- the month ----------
// legs: every stored leg; duties: storage.getDuties(); month 1–12 (Israel).
export function monthReport({ legs, duties, rules, card, year, month, now = Date.now() }) {
  const R = rules || {}, items = [], warnings = [];
  const from = ilMidnight(year, month, 1);
  const to = month === 12 ? ilMidnight(year + 1, 1, 1) : ilMidnight(year, month + 1, 1);
  const times = legTimes(legs);
  const inMonth = (ms) => ms >= from && ms < to;
  const mLegs = times.filter(t => inMonth(t.start));
  const fdps = groupFdps(times);
  const dutyList = (duties || []).filter(d => d && d.end >= d.start);

  // Hours: block (actual when flown, else planned).
  const hours = mLegs.reduce((s, t) => s + (t.end - t.start) / H, 0);
  const planned = mLegs.filter(t => !t.flown).length;
  if (planned) warnings.push(`${planned} leg${planned === 1 ? '' : 's'} not flown yet — planned block time counted`);
  if (mLegs.some(t => !t.flown && t.end < now)) warnings.push('Some past legs have no actual times on the device yet — sync the calendar');

  const money = (key, qty) => { const r = rateOf(key, R, card); return r == null || !qty ? null : Math.round(r * qty * 100) / 100; };
  const legLine = (t) => `${t.leg.flight ? 'LY' + t.leg.flight : ''} ${t.leg.dep || ''}–${t.leg.arr || ''} ${t.leg.dep_date || ''}`.trim();

  // 1. Hours over the month's limit.
  const mh = R.monthHours || {};
  const peak = (mh.peakMonths || []).includes(month);
  const limit = num(R.overtime && R.overtime.fromH) ?? num(peak ? mh.peak : mh.normal);
  if (limit != null && hours > limit) {
    const over = hours - limit;
    items.push({ kind: 'overtime', what: `${hm(over)} over ${limit} h`, hours: over, amount: money('overtimeHour', over),
      why: `${hm(hours)} block in ${monthName(year, month)}; ${peak ? 'peak' : 'normal'} month limit ${limit} h${peak && num(mh.peakOnce) ? ` (${mh.peakOnce} h allowed in one peak month)` : ''}` });
  }

  // 2. Late: on-block past STA by more than the rule's minutes.
  const lateMin = num(R.late && R.late.minMin) ?? 0;
  for (const t of mLegs) {
    if (!t.flown) continue;
    const late = (t.end - t.sta) / MIN;
    if (late > lateMin) items.push({ kind: 'late', what: `${legLine(t)} · ${Math.round(late)} min late`, hours: late / 60,
      amount: money('lateHour', late / 60), legs: [t.leg], why: `on-block ${hm((t.end % DAY) / H)}Z, STA ${hm((t.sta % DAY) / H)}Z` });
  }

  // 3. Short rest. Trips: from leaving home to coming back. The rest after
  // one runs from bufferAfter past the last on-block to bufferBefore ahead
  // of the next report.
  const rs = R.rest || {};
  const trips = [];
  for (const f of fdps) {
    const cur = trips[trips.length - 1];
    const last = f.legs[f.legs.length - 1].leg;
    if (cur && !cur.closed) cur.fdps.push(f); else trips.push({ fdps: [f], closed: false });
    const tr = trips[trips.length - 1];
    if (HOME.has(String(last.arr || '').toUpperCase()) || !last.arr) tr.closed = true;
  }
  for (const tr of trips) {
    const a = tr.fdps[0], b = tr.fdps[tr.fdps.length - 1];
    tr.start = a.report; tr.end = b.end;
    tr.block = tr.fdps.reduce((s, f) => s + f.plannedFt, 0) / H;   // scheduled block
    // Time away between duties (the slip): from each FDP's end to the next report.
    tr.stay = tr.fdps.slice(1).reduce((s, f, i) => s + (f.report - tr.fdps[i].end) / H, 0);
    tr.lengthH = (tr.end - tr.start) / H;
  }
  const after = num(rs.bufferAfterH) ?? 0, before = num(rs.bufferBeforeH) ?? 0;
  const standbyEnds = runs(dutyList.filter(d => d.kind === 'standby')).map(r => r.end);
  for (let i = 0; i < trips.length - 1; i++) {
    const tr = trips[i], nx = trips[i + 1];
    if (!inMonth(nx.start)) continue;
    const reqs = [];
    if (tr.fdps.length > 1) {
      if (num(rs.slipShortMaxH) != null && tr.stay <= num(rs.slipShortMaxH) && num(rs.slipShortFactor) != null)
        reqs.push([tr.block * num(rs.slipShortFactor), `${rs.slipShortFactor} × block ${hm(tr.block)} (slip ${hm(tr.stay)})`]);
      else if (num(rs.slipLongFactor) != null) {
        const v = Math.min(num(rs.slipLongMaxH) ?? Infinity, Math.max(num(rs.slipLongMinH) ?? 0, tr.stay * num(rs.slipLongFactor)));
        reqs.push([v, `${rs.slipLongFactor} × slip ${hm(tr.stay)}`]);
      }
      if (num(rs.longTripH) != null && tr.lengthH > num(rs.longTripH) && num(rs.afterLongTripH) != null)
        reqs.push([num(rs.afterLongTripH), `trip over ${rs.longTripH} h`]);
    } else if (num(rs.turnaroundFactor) != null) {
      reqs.push([tr.block * num(rs.turnaroundFactor), `${rs.turnaroundFactor} × block ${hm(tr.block)}`]);
    }
    if (!reqs.length) continue;
    const [need, how] = reqs.reduce((m, r) => (r[0] > m[0] ? r : m));
    const got = ((nx.start - before * H) - (tr.end + after * H)) / H;
    if (got < need - 1 / 60) {
      const short = need - got;
      items.push({ kind: 'rest', what: `Rest ${hm(got)}, due ${hm(need)} — ${hm(short)} short`, hours: short,
        amount: money('shortRestHour', short), legs: [nx.fdps[0].legs[0].leg],
        why: `after ${legLine(tr.fdps[tr.fdps.length - 1].legs.at(-1))}, before ${legLine(nx.fdps[0].legs[0])}; due ${how}` });
    }
  }
  // After a standby run.
  if (num(rs.afterStandbyH) != null) {
    for (const end of standbyEnds) {
      const nx = fdps.find(f => f.report >= end);
      if (!nx || !inMonth(nx.report)) continue;
      const got = (nx.report - end) / H;
      if (got < num(rs.afterStandbyH)) items.push({ kind: 'rest', what: `Rest after standby ${hm(got)}, due ${rs.afterStandbyH} h`,
        hours: num(rs.afterStandbyH) - got, amount: money('shortRestHour', num(rs.afterStandbyH) - got), legs: [nx.legs[0].leg],
        why: `standby run ended ${il(end).key}; next report ${il(nx.report).key}` });
    }
  }
  // Home rest: a long enough free stretch in every window.
  const hr = rs.home || {};
  if (num(hr.everyH) && num(hr.freeH)) {
    const ivs = fdps.map(f => [f.report, f.end]).concat(dutyList.filter(d => !d.allDay && d.kind !== 'vacation' && d.kind !== 'dayOff').map(d => [d.start, d.end])).sort((a, b) => a[0] - b[0]);
    for (const f of fdps) {
      if (!inMonth(f.report)) continue;
      const free = longestFree(ivs.filter(iv => iv[0] !== f.report), f.report - num(hr.everyH) * H, f.report) / H;
      if (free < num(hr.freeH)) items.push({ kind: 'rest', what: `Only ${hm(free)} free in the ${hr.everyH} h before ${legLine(f.legs[0])}`,
        hours: num(hr.freeH) - free, amount: null, legs: [f.legs[0].leg], why: `${hr.freeH} h free due in every ${hr.everyH} h` });
    }
  }

  // 4. Call-outs: a flight reporting inside a standby duty; a short-notice
  // assignment (the roster issue for the leg came less than noticeH before
  // report); a standby run longer than allowed.
  const co = R.callout || {};
  for (const f of fdps) {
    if (!inMonth(f.report)) continue;
    const sb = dutyList.find(d => d.kind === 'standby' && (d.allDay ? dayKeyUtc(d.start) <= il(f.report).key && il(f.report).key < dayKeyUtc(d.end) : f.report >= d.start && f.report < d.end));
    if (sb) { items.push({ kind: 'callout', what: `Called from ${sb.code || 'standby'} · ${legLine(f.legs[0])}`, count: 1, amount: money('callout', 1), legs: [f.legs[0].leg], why: `report ${il(f.report).key} inside ${sb.title || sb.code}` }); continue; }
    const at = Number(f.legs[0].leg.roster_at) || 0;
    if (num(co.noticeH) != null && at && f.report - at < num(co.noticeH) * H && f.report - at > 0)
      items.push({ kind: 'callout', what: `Short notice · ${legLine(f.legs[0])}`, count: 1, amount: money('callout', 1), legs: [f.legs[0].leg],
        why: `assigned ${hm((f.report - at) / H)} before report (under ${co.noticeH} h)` });
  }
  const maxRun = num(R.standby && R.standby.maxRunDays);
  if (maxRun != null) for (const r of runs(dutyList.filter(d => d.kind === 'standby'))) {
    if (r.days > maxRun && inMonth(r.start)) items.push({ kind: 'callout', what: `Standby run of ${r.days} days`, count: 1, amount: null, why: `longest allowed ${maxRun} days` });
  }

  // 5. Free days: due by the month's hours, against days actually free.
  const fd = R.freeDay || {};
  const days = [];
  for (let d = 1; ; d++) {
    const s = ilMidnight(year, month, d);
    if (s >= to) break;
    days.push({ d, s, e: ilMidnight(year, month, d + 1), key: il(s + H).key });
  }
  const offBefore = (num(fd.offBlockBeforeMidnightH) ?? 0) * H, onAfter = (num(fd.onBlockAfterMidnightH) ?? 0) * H;
  const freeKinds = new Set(fd.countKinds || []), freeCodes = new Set(fd.countCodes || []);
  const runFrom = fd.runFrom || {};
  const dutyDays = new Map();   // key → [duty, nth day of its run]
  for (const r of runs(dutyList.filter(d => d.allDay))) r.items.forEach((d, i) => { for (let t = d.start; t < d.end; t += DAY) dutyDays.set(dayKeyUtc(t), [d, i + 1]); });
  let free = 0;
  const lost = [];
  for (const day of days) {
    const flying = times.some(t => t.start < day.e - offBefore && t.end > day.s + onAfter);
    const timed = dutyList.some(d => !d.allDay && d.start < day.e && d.end > day.s && d.kind !== 'dayOff');
    const dd = dutyDays.get(day.key);
    let isFree = !flying && !timed;
    if (isFree && dd) {
      const [d, nth] = dd;
      const from3 = num(runFrom[d.kind]);
      isFree = d.kind === 'dayOff' || freeKinds.has(d.kind) || freeCodes.has(d.code) || (from3 != null && nth >= from3);
    }
    if (isFree) free++;
    if (dd && dd[0].kind === 'dayOff' && (flying || timed)) lost.push(day.key);
  }
  for (const k of lost) items.push({ kind: 'free', what: `Day off ${k} worked`, count: 1, amount: money('lostFreeDay', 1), why: 'a duty on a rostered day off' });
  const credit = (R.creditDays || []).find(([a, b]) => hours >= a && hours < b);
  const due = credit ? credit[2] : null;
  if (due != null && free < due) items.push({ kind: 'free', what: `${free} free days, ${due} due — ${due - free} short`, count: due - free,
    amount: money('lostFreeDay', due - free), why: `${hm(hours)} h this month → ${due} personal credit days` });

  const known = items.filter(x => x.amount != null);
  return {
    year, month, hours, limit, peak, legs: mLegs.length, freeDays: free, freeDue: due,
    items, warnings,
    totals: {
      overtime: items.filter(x => x.kind === 'overtime').reduce((s, x) => s + x.hours, 0),
      late: items.filter(x => x.kind === 'late').length,
      rest: items.filter(x => x.kind === 'rest').length,
      callout: items.filter(x => x.kind === 'callout').length,
      free: items.filter(x => x.kind === 'free').length,
      amount: known.reduce((s, x) => s + x.amount, 0),
      unpriced: items.length - known.length,
    },
  };
}

// Consecutive all-day (or back-to-back) duties of the same kind as runs.
function runs(list) {
  const out = [];
  for (const d of [...list].sort((a, b) => a.start - b.start)) {
    const cur = out[out.length - 1];
    if (cur && cur.kind === d.kind && d.start - cur.end <= (d.allDay ? 0 : 6 * H)) { cur.end = Math.max(cur.end, d.end); cur.items.push(d); }
    else out.push({ kind: d.kind, start: d.start, end: d.end, items: [d] });
  }
  for (const r of out) r.days = Math.max(1, Math.round((r.end - r.start) / DAY));
  return out;
}
function longestFree(ivs, from, to) {
  let best = 0, cursor = from;
  for (const [s, e] of ivs) {
    if (e <= from) continue;
    if (s >= to) break;
    best = Math.max(best, Math.max(s, from) - cursor);
    cursor = Math.max(cursor, Math.min(e, to));
  }
  return Math.max(best, to - cursor);
}
