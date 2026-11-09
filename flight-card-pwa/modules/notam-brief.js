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
const rwys = (s) => (String(s).match(/\b\d{2}[LRC]?\b/g) || []);

// → { sev, text, items: [{ kind, ref }] } | null
export function bottomLine(n) {
  const t = U(n && n.text);
  if (!t) return null;
  let m;
  if (/\b(AD|AERODROME|AIRPORT)\s+(CLSD|CLOSED)\b/.test(t)) return { sev: 'r', text: 'Aerodrome closed', items: [] };
  if ((m = /\bRWY\s+(\d{2}[LRC]?(?:\/\d{2}[LRC]?)?)\s+(?:IS\s+)?(CLSD|CLOSED)\b/.exec(t)))
    return { sev: 'r', text: `RWY ${m[1]} closed`, items: [{ kind: 'RWY', ref: m[1].split('/')[0] }] };
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
  if ((m = new RegExp(`\\b(VOR|DVOR|VOR\\/DME|DME|NDB|TACAN)\\s*([A-Z]{2,3})?\\b[^.]{0,40}\\b${OUT}`).exec(t)))
    return { sev: 'o', text: `${m[1]}${m[2] ? ' ' + m[2] : ''} U/S`, items: [] };
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
  if (/\bBIRD/.test(t)) return { sev: 'y', text: 'Birds', items: [], group: true };
  return null;
}

// In force at any moment of [from, to] (ms)?
export function inForce(n, from, to = from) {
  const st = Date.parse(n.start), en = Date.parse(n.end);
  return !(Number.isFinite(st) && st > to) && !(Number.isFinite(en) && en < from);
}

// Every NOTAM for an airport → the short lines in force round `ts` (±1 h),
// worst first, one per distinct line; WIP / cranes / birds folded into one
// counted line each. [{ sev, text, items, until, n }]
const RANK = { r: 3, o: 2, y: 1 };
export function briefs(notams, ts = Date.now(), win = 3600e3) {
  const seen = new Map();
  for (const n of notams || []) {
    if (!inForce(n, ts - win, ts + win)) continue;
    const b = bottomLine(n);
    if (!b) continue;
    const prev = seen.get(b.text);
    if (prev) { prev.count++; continue; }
    const en = Date.parse(n.end);
    seen.set(b.text, { ...b, count: 1, until: Number.isFinite(en) && en - Date.now() < 30 * 86400e3 ? en : null, n });
  }
  return [...seen.values()].sort((a, b) => (RANK[b.sev] || 0) - (RANK[a.sev] || 0));
}
