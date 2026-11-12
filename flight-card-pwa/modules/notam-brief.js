// notam-brief.js — a NOTAM's bottom line. The full texts are long and
// mostly beside the point for a flight; this turns each into one short line
// ("RWY 08/26 closed", "ILS 12 U/S", "SID RWY 26 not available") with a
// colour, or nothing when it isn't one of the things that matter. The full
// NOTAMs stay one tap away.
//
// Colours (the logic, to recheck with the pilot):
//   r red    — aerodrome closed, a runway closed, ILS / LOC / GP out,
//              no fuel, fire cover (RFFS) reduced
//   o orange — taxiway / stand closed, SID or STAR not available, a navaid
//              (VOR, DME, NDB) out, runway / approach lights or PAPI out,
//              declared distances changed or a threshold displaced
//   y yellow — work in progress, cranes / obstacles, birds
// Anything else gets no line (it's in "All NOTAMs").
//
// Each line may also carry diagram items ({ kind, ref }) — closures, ILS
// faults, SID / STAR by runway — that the ATIS window's airport diagram
// marks, the same way it marks the ATIS's own.

const U = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ');
const OUT = '(?:U\\/S|UNSERVICEABLE|NOT AVBL|NOT AVAILABLE|OUT OF SERVICE|OTS|WITHDRAWN|SUSPENDED|INOP)';
// Runways a NOTAM names: "RWY34R" / "RWY 16L" first; bare numbers only when
// it names none that way. The "REF AIP AD2 LIRF 1-23" tail and page numbers
// are never runways.
function rwys(s) {
  const t = String(s).replace(/\bREF\b.*$/, '').replace(/\b\d+-\d+\b/g, '');
  const named = [...t.matchAll(/\bRWY\s*(\d{2}[LRC]?)(?!\d)/g)].map(m => m[1]);
  if (named.length) return named;
  return (t.match(/\b\d{2}[LRC]?\b/g) || []).filter(x => +x.slice(0, 2) >= 1 && +x.slice(0, 2) <= 36);
}
const MARKER = { OM: 'Outer marker', MM: 'Middle marker', IM: 'Inner marker' };

// → { sev, text, items: [{ kind, ref }] } | null
export function bottomLine(n) {
  const t = U(n && n.text);
  if (!t) return null;
  let m;
  if (/\b(AD|AERODROME|AIRPORT)\s+(CLSD|CLOSED)\b/.test(t)) return { sev: 'r', text: 'Aerodrome closed', items: [] };
  if ((m = /\bRWY\s+(\d{2}[LRC]?(?:\/\d{2}[LRC]?)?)\s+(?:IS\s+)?(CLSD|CLOSED)\b/.exec(t)))
    return { sev: 'r', text: `RWY ${m[1]} closed${/\bFOR (TKOF|TAKE-?OFF|DEP)/.test(t) ? ' for takeoff' : /\bFOR (LDG|LANDING|ARR)/.test(t) ? ' for landing' : ''}`, items: [{ kind: 'RWY', ref: m[1].split('/')[0] }] };
  // Marker beacons (often written "OM (ILS 'FSS') RWY34R") — a navaid, not
  // the ILS itself.
  if ((m = new RegExp(`\\b(OM|MM|IM|OUTER MARKER|MIDDLE MARKER|INNER MARKER|MKR|MARKER)\\b[^.]{0,60}\\b${OUT}`).exec(t))) {
    const what = MARKER[m[1]] || (/OUTER/.test(m[1]) ? 'Outer marker' : /MIDDLE/.test(m[1]) ? 'Middle marker' : /INNER/.test(m[1]) ? 'Inner marker' : 'Marker');
    const rw = rwys(t)[0] || '';
    return { sev: 'o', text: `${what}${rw ? ' RWY ' + rw : ''} U/S`, items: [] };
  }
  if ((m = new RegExp(`\\b(ILS|LOC|LLZ|GP|GS|GLIDE ?PATH|LOCALI[SZ]ER)\\b[^.]{0,40}?(?:RWY\\s*(\\d{2}[LRC]?))?[^.]{0,30}\\b${OUT}`).exec(t))
    || (m = new RegExp(`\\bRWY\\s*(\\d{2}[LRC]?)\\b[^.]{0,20}\\b(ILS|LOC|LLZ|GP|GS)\\b[^.]{0,30}\\b${OUT}`).exec(t))) {
    const sys = /^\d/.test(m[1]) ? m[2] : m[1].replace(/GLIDE ?PATH/, 'GP').replace(/LOCALI[SZ]ER/, 'LOC');
    const rw = /^\d/.test(m[1]) ? m[1] : (m[2] || (rwys(t)[0] || ''));
    return { sev: 'r', text: `${sys}${rw ? ' ' + rw : ''} U/S`, items: rw ? [{ kind: 'ILS', ref: rw }] : [] };
  }
  if (/\b(NO FUEL|FUEL\b[^.]{0,30}\bNOT AVBL)/.test(t)) return { sev: 'r', text: 'No fuel', items: [] };
  if ((m = /\bRFFS?\b[^.]{0,40}\bCAT(?:EGORY)?\s*([1-9]|10)\b/.exec(t))) return { sev: +m[1] < 7 ? 'r' : 'o', text: `RFFS CAT ${m[1]}`, items: [] };
  // SID / STAR — by runway when it names one.
  if ((m = new RegExp(`\\b(SIDS?|STARS?|RNAV (?:SID|STAR)|DEP(?:ARTURE)? PROC(?:EDURE)?S?|ARR(?:IVAL)? PROC(?:EDURE)?S?)\\b[^.]{0,80}?\\b${OUT}`).exec(t))) {
    const kind = /SID|DEP/.test(m[1]) ? 'SID' : 'STAR';
    const rw = (/\bRWY\s*(\d{2}[LRC]?)/.exec(t) || [])[1] || '';
    const proc = (t.match(/\b[A-Z]{3,5}\d[A-Z]\b/g) || []).slice(0, 2).join(', ');
    return { sev: 'o', text: `${kind}${proc ? ' ' + proc : ''}${rw ? ' RWY ' + rw : ''} not available`, items: rw ? [{ kind, ref: rw }] : [] };
  }
  // A SID / STAR changed ("AMEND TO READ", new level restrictions): yellow,
  // still marked on its runway.
  if ((m = /^\W*(SIDS?|STARS?|RNAV SID|RNAV STAR)\b[^.]{0,160}?\b(AMEND|AMENDED|CHANGED|REVISED|RESTRICTION)/.exec(t))) {
    const kind = /SID/.test(m[1]) ? 'SID' : 'STAR';
    const rw = (/\bRWY\s*(\d{2}[LRC]?)/.exec(t) || [])[1] || '';
    return { sev: 'y', text: `${kind}${rw ? ' RWY ' + rw : ''} changed`, items: rw ? [{ kind, ref: rw, minor: true }] : [] };
  }
  // Approach minima (OCA / OCH) raised or changed.
  if (/\b(OCA|OCH|MINIMA|DA\/H|MDA)\b[^.]{0,80}\b(CHANGED|AMEND|RAISED|INCREASED|AS FOLLOWS)/.test(t)) {
    const rw = rwys(t.replace(/\d{6}(\.\d+)?[NSEW]/g, ''))[0] || '';
    return { sev: 'o', text: `Approach minima changed${rw ? ' RWY ' + rw : ''}`, items: [] };
  }
  if ((m = /\b(TWY-LINK|TWY LINK|TWY|TAXIWAY|TAXILANE|TWL)S?\s+((?:[A-Z]{1,2}\d{0,3}[A-Z]?)(?:\s*(?:,|AND|\/|&)\s*[A-Z]{1,2}\d{0,3}[A-Z]?)*)\b[^.]{0,60}?\b(CLSD|CLOSED)\b/.exec(t))) {
    const refs = m[2].split(/\s*(?:,|AND|\/|&)\s*/).filter(r => r && !/^(AND|BTN|FM|TO)$/.test(r)).slice(0, 6);
    return { sev: 'o', text: `TWY ${refs.join(', ')} closed`, items: refs.map(ref => ({ kind: 'TWY', ref })) };
  }
  if ((m = /\b(STANDS?|STAND|PARKING POSITIONS?|GATES?)\s+([A-Z]?\d{1,3}[A-Z]?(?:\s*(?:,|AND|-|\/)\s*[A-Z]?\d{1,3}[A-Z]?)*)\b[^.]{0,40}?\b(CLSD|CLOSED)\b/.exec(t)))
    return { sev: 'o', text: `Stand ${m[2].replace(/\s+/g, '')} closed`, items: [] };
  if ((m = new RegExp(`\\b(DVOR\\/DME|VOR\\/DME|DVOR|VOR|DME|NDB|TACAN)\\b[^.]{0,50}\\b${OUT}`).exec(t))) {
    const id = (/'([A-Z]{2,3})'/.exec(t) || [])[1] || '';
    // A monitor or status light out isn't the beacon out.
    if (/\b(STATUS INDICATOR|MONITOR(ING)?|REMOTE STATUS)\b/.test(t) && !/\b(VOR|DME|NDB)\s+(U\/S|UNSERVICEABLE)/.test(t)) return null;
    return { sev: 'o', text: `${m[1]}${id ? ' ' + id : ''} U/S`, items: [] };
  }
  if (/\bSTOP ?BARS?\b[^.]{0,30}\b(U\/S|UNSERVICEABLE|OTS|INOP)/.test(t)) return { sev: 'o', text: 'Stop bar lights U/S', items: [] };
  if ((m = new RegExp(`\\b(ALS|APCH LGT|APPROACH LIGHT(?:ING|S)?|PAPI|VASIS?|RWY (?:EDGE |CL |CENTRE ?LINE )?LGT|TDZ LGT|RCLL|REDL)\\b[^.]{0,40}\\b${OUT}`).exec(t))) {
    const what = m[1].replace(/APCH LGT|APPROACH LIGHT(ING|S)?/, 'ALS').replace(/RWY (EDGE |CL |CENTRE ?LINE )?LGT/, (x) => /CL|CENTRE/.test(x) ? 'RWY CL lights' : 'RWY lights');
    const rw = rwys(t)[0] || '';
    return { sev: 'o', text: `${what}${rw ? ' ' + rw : ''} U/S`, items: [] };
  }
  if (/\b(TORA|TODA|ASDA|LDA)\b[^.]{0,40}\b(REDUCED|RESTRICTED|CHANGED)|\bTHR\b[^.]{0,20}\bDISPLACED|\bSHORTENED\b/.test(t)) {
    const rw = rwys(t)[0] || '';
    return { sev: 'o', text: `RWY${rw ? ' ' + rw : ''} declared distances changed`, items: [] };
  }
  if (/\b(WIP|WORK IN PROGRESS|CONST(?:RUCTION)?)\b/.test(t)) return { sev: 'y', text: 'Work in progress', items: [], group: true };
  if (/\bCRANES?\b/.test(t)) return { sev: 'y', text: 'Crane', items: [], group: true };
  if (/\b(OBST(ACLE)?S?|MOBILE EQPT|MOBILE EQUIPMENT|ANTENNA|MAST|TOWER)\b/.test(t) && coordsOf(t).length) return { sev: 'y', text: 'Obstacle', items: [], group: true };
  if (/\bBIRD/.test(t)) return { sev: 'y', text: 'Birds', items: [], group: true };
  return null;
}

// Positions written in a NOTAM — 345330.55N0333816.63E, 375656N 0235701E,
// 3756N02357E, N3756.2 E02357.1 — as [lat, lon].
export function coordsOf(text) {
  const t = U(text), out = [];
  const re = /\b(\d{2})(\d{2})(\d{2}(?:\.\d+)?)?([NS])\s?(\d{3})(\d{2})(\d{2}(?:\.\d+)?)?([EW])\b/g;
  let m;
  while ((m = re.exec(t))) {
    const lat = (+m[1] + +m[2] / 60 + (parseFloat(m[3]) || 0) / 3600) * (m[4] === 'S' ? -1 : 1);
    const lon = (+m[5] + +m[6] / 60 + (parseFloat(m[7]) || 0) / 3600) * (m[8] === 'W' ? -1 : 1);
    out.push([lat, lon]);
  }
  return out;
}
// "2.4 nm NE" from the aerodrome reference point to [lat, lon].
export function fromArp(arp, p) {
  const R = Math.PI / 180, k = Math.cos(arp.lat * R);
  const dx = (p[1] - arp.lon) * k * 60, dy = (p[0] - arp.lat) * 60;
  const nm = Math.hypot(dx, dy);
  if (nm < 0.15) return 'on the aerodrome';
  const dir = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(((Math.atan2(dx, dy) / R + 360) % 360) / 45) % 8];
  return `${nm < 10 ? nm.toFixed(1) : Math.round(nm)} nm ${dir}`;
}
// When a NOTAM is in force, short: "to 14:00", "09.11 06:00 – 12.11 14:00",
// "PERM", plus its schedule (Item D) if any.
export function validity(n, now = Date.now()) {
  const st = Date.parse(n.start), en = Date.parse(n.end);
  const today = new Date(now);
  const f = (ms) => { const d = new Date(ms); const t = d.toISOString().slice(11, 16);
    return d.getUTCDate() === today.getUTCDate() && d.getUTCMonth() === today.getUTCMonth() ? t : `${String(d.getUTCDate()).padStart(2, '0')}.${String(d.getUTCMonth() + 1).padStart(2, '0')} ${t}`; };
  const perm = !Number.isFinite(en) || en - now > 5 * 365 * 86400e3;
  // Start and end, always.
  const end = perm ? 'PERM' : f(en) + (n.est ? ' EST' : '');
  let s = Number.isFinite(st) ? `${f(st)} – ${end}` : end;
  return n.sched ? `${s} · ${String(n.sched).trim()}` : s;
}

// ---------- Schedule (Item D) ----------
// A NOTAM valid "03.11 08:30 – 29.12 10:30" with Item D "EVERY TUE 0830-1030"
// is in force two hours a week, not eight weeks straight (LROP's two runway
// closures are on different days and never together). schedWindows turns
// Item D into the UTC windows overlapping [from, to]; null when it can't be
// read (then the NOTAM counts as in force — never hide what we don't parse).
const DOW = { SUN: 0, MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6 };
const MON = { JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11 };
// Day numbers without a month ("09 2000-0500, 10-12 1700-0500") are days of
// whatever month the NOTAM is valid in — its validity clips them.
function parseSegment(toks, ctx) {
  // → { days:Set|null (weekdays), dates:[{m|null,d}]|null, times:[[min,min]] } or null
  let days = null, dates = null, times = [], pendDays = [];
  for (const t of toks) {
    let m;
    if (t === 'DAILY' || t === 'EVERY') continue;
    if ((m = /^(\d{4})-(\d{4})$/.exec(t))) {
      const a = +m[1].slice(0, 2) * 60 + +m[1].slice(2), b = +m[2].slice(0, 2) * 60 + +m[2].slice(2);
      if (a > 1440 || b > 1440) return null;
      times.push([a, b]); continue;
    }
    if (t === 'H24') { times.push([0, 1440]); continue; }
    if ((m = /^(SUN|MON|TUE|WED|THU|FRI|SAT)-(SUN|MON|TUE|WED|THU|FRI|SAT)$/.exec(t))) {
      days ||= new Set();
      for (let d = DOW[m[1]], k = 0; k < 7; d = (d + 1) % 7, k++) { days.add(d); if (d === DOW[m[2]]) break; }
      continue;
    }
    if (t in DOW) { (days ||= new Set()).add(DOW[t]); continue; }
    if (t in MON) { ctx.month = MON[t]; if (pendDays.length) { (dates ||= []).push(...pendDays.map(d => ({ m: ctx.month, d }))); pendDays = []; } continue; }
    if ((m = /^(\d{1,2})-(\d{1,2})$/.exec(t))) {
      const a = +m[1], b = +m[2]; if (a < 1 || b > 31 || b < a) return null;
      for (let d = a; d <= b; d++) pendDays.push(d);
      continue;
    }
    if ((m = /^(\d{1,2})$/.exec(t))) {
      const d = +m[1]; if (d < 1 || d > 31) return null;
      pendDays.push(d); continue;
    }
    return null;            // SR-SS, EXC, HJ… — not read
  }
  if (!times.length) return null;
  // A month named before the days ("NOV 09-12") or none at all.
  if (pendDays.length) (dates ||= []).push(...pendDays.map(d => ({ m: ctx.month, d })));
  return { days, dates, times };
}
// Segments: split on ";" / new lines, and wherever a time is followed by a
// day or date ("09 2000-0500, 10-12 1700-0500" is two).
function segmentsOf(s) {
  const out = [];
  for (const part of s.split(/\s*;\s*|\n+/)) {
    const toks = part.replace(/,/g, ' ').replace(/\b(TIL|TO|THRU)\b/g, '-').replace(/\s*-\s*/g, '-').split(/\s+/).filter(Boolean);
    let cur = [], lastTime = false;
    for (const t of toks) {
      const isTime = /^\d{4}-\d{4}$/.test(t) || t === 'H24';
      if (!isTime && lastTime && cur.length) { out.push(cur); cur = []; }
      cur.push(t); lastTime = isTime;
    }
    if (cur.length) out.push(cur);
  }
  return out;
}
export function schedWindows(sched, from, to) {
  const s = String(sched || '').toUpperCase().trim();
  if (!s) return null;
  const ctx = { month: null };
  const segs = segmentsOf(s).map(t => parseSegment(t, ctx));
  if (!segs.length || segs.some(x => !x)) return null;
  const out = [];
  const day0 = Date.UTC(new Date(from).getUTCFullYear(), new Date(from).getUTCMonth(), new Date(from).getUTCDate()) - 86400e3;
  for (let day = day0; day <= to; day += 86400e3) {
    const d = new Date(day);
    for (const g of segs) {
      if (g.days && !g.days.has(d.getUTCDay())) continue;
      if (g.dates && !g.dates.some(x => (x.m == null || x.m === d.getUTCMonth()) && x.d === d.getUTCDate())) continue;
      for (const [a, b] of g.times) {
        const st = day + a * 60e3, en = day + (b > a ? b : b + 1440) * 60e3;   // over midnight
        if (en >= from && st <= to) out.push([st, en]);
      }
    }
  }
  return out;
}
// In force at any moment of [from, to] (ms)? Validity first, then Item D.
export function inForce(n, from, to = from) {
  const st = Date.parse(n.start), en = Date.parse(n.end);
  if ((Number.isFinite(st) && st > to) || (Number.isFinite(en) && en < from)) return false;
  if (!n.sched) return true;
  const w = schedWindows(n.sched, Math.max(from, Number.isFinite(st) ? st : from), Math.min(to, Number.isFinite(en) ? en : to));
  return w == null ? true : w.length > 0;
}

// Every NOTAM for an airport → the short lines in force round `ts` (±1 h),
// worst first, one per distinct line; WIP / cranes / birds folded into one
// counted line each. [{ sev, text, items, until, n }]
const RANK = { r: 3, o: 2, y: 1, off: -1 };
// `arp` ({ lat, lon }): positions in a NOTAM become diagram points (and an
// area when it gives three or more), and the line says where from the field.
// A NOTAM in force now but not round `ts` (your time there) still gets its
// line — greyed, "now · not at your time" — so a closure you can see on the
// ATIS isn't a surprise, and isn't mistaken for one that hits your flight.
export function briefs(notams, ts = Date.now(), win = 3600e3, arp = null, now = Date.now()) {
  const seen = new Map();
  const other = Math.abs(ts - now) > win;
  for (const n of notams || []) {
    const on = inForce(n, ts - win, ts + win);
    const off = !on && other && inForce(n, now, now + win);
    if (!on && !off) continue;
    const b0 = bottomLine(n);
    if (!b0) continue;
    const b = off ? { ...b0, sev: 'off', text: b0.text, off: true } : b0;
    const pts = arp ? coordsOf(n.text) : [];
    const pos = [];
    if (pts.length >= 3) pos.push({ kind: 'AREA', ref: n.id || b.text, pts });
    else for (const p of pts.slice(0, 2)) pos.push({ kind: 'PT', ref: (n.id || b.text) + ':' + pos.length, lat: p[0], lon: p[1] });
    const k = (off ? 'off|' : '') + b.text;
    const prev = seen.get(k);
    if (prev) { prev.count++; prev.ns.push(n); prev.items.push(...pos); continue; }
    seen.set(k, { ...b, items: [...b.items, ...pos], count: 1, ns: [n], n,
      where: arp && pts.length ? fromArp(arp, pts.length >= 3 ? [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length] : pts[0]) : '' });
  }
  return [...seen.values()].sort((a, b) => (RANK[b.sev] || 0) - (RANK[a.sev] || 0));
}
