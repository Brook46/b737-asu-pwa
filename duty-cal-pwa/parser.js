// Parse an ELY "Individual duty plan" PDF text into a list of calendar events.
//
// Input: raw text extracted from the PDF (single string, item-by-item).
// Output: { period: {startDate, endDate, name}, events: [...] }
//
// The event shape is documented in kinds.js, which is also the single source
// of truth for the category taxonomy (kind / subtype / roster codes).

import { KINDS, SUBTYPES, classifyCode } from './kinds.js';

const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
const PICKUP_RE = /PICKUP\s+([A-Z]{3})\s+(\d{4})\s+(\d{4})/;

function parseDDMMMYY(s) {
  // "01Jun26"
  const m = /^(\d{2})([A-Za-z]{3})(\d{2})$/.exec(s);
  if (!m) return null;
  return new Date(2000 + +m[3], MONTHS[capitalize(m[2])], +m[1]);
}
function capitalize(s) { return s[0].toUpperCase() + s.slice(1,3).toLowerCase(); }

function ymd(d) {
  const p = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`;
}

function timeOnDate(date, hhmm) {
  // hhmm = "HHMM" string
  const d = new Date(date);
  d.setHours(parseInt(hhmm.slice(0,2),10), parseInt(hhmm.slice(2,4),10), 0, 0);
  return d;
}

function addMinutes(date, mins) {
  return new Date(date.getTime() + mins*60000);
}

function parseHMM(s) {
  // "11:10" → minutes
  const m = /^(\d+):(\d{2})$/.exec(s);
  if (!m) return 0;
  return parseInt(m[1],10)*60 + parseInt(m[2],10);
}

export function parseDutyPlan(rawText) {
  const text = rawText.replace(/\s+/g, ' ').trim();

  // Period
  const periodRe = /Period:\s*(\d{2}[A-Za-z]{3}\d{2})\s*-\s*(\d{2}[A-Za-z]{3}\d{2})/;
  const pm = periodRe.exec(text);
  if (!pm) throw new Error('Could not find "Period:" in PDF — is this an Individual duty plan?');
  const periodStart = parseDDMMMYY(pm[1]);
  const periodEnd   = parseDDMMMYY(pm[2]);

  // Pilot name (best-effort)
  const nameRe = /Individual duty plan for ([^]+?) NetLine/;
  const nm = nameRe.exec(text);
  const pilotName = nm ? nm[1].replace(/\s+/g,' ').trim() : '';

  // Find detail section: starts after first "date H duty R dep arr AC info"
  const detailHeader = 'date H duty R dep arr AC info';
  let detailStart = text.indexOf(detailHeader);
  if (detailStart < 0) throw new Error('Could not find detail section header in PDF.');
  // Skip all consecutive copies of the header (PDF may repeat it across columns)
  const headerRe = new RegExp(detailHeader.replace(/ /g, '\\s*'), 'g');
  headerRe.lastIndex = detailStart;
  let lastHeaderEnd = detailStart + detailHeader.length;
  let mh;
  while ((mh = headerRe.exec(text)) && mh.index <= lastHeaderEnd + 20) {
    lastHeaderEnd = mh.index + mh[0].length;
  }
  let body = text.slice(lastHeaderEnd);

  // Trim trailing footer section (totals / training table)
  const cutMarkers = ['Flight time ', 'Recurrent Training', 'Time away from base'];
  let cutAt = body.length;
  for (const m of cutMarkers) {
    const idx = body.indexOf(m);
    if (idx >= 0 && idx < cutAt) cutAt = idx;
  }
  body = body.slice(0, cutAt);

  // Split into per-day chunks using day-of-week + 2-digit markers.
  // No leading \b: the PDF text layer sometimes runs days together with no
  // separator ("Fri05 XSat06Sun07Mon08 PICKUP…"), and a word boundary would
  // silently swallow every following day into the previous one. The trailing
  // (?!\d) keeps "Mon08" from matching inside a longer number.
  const dayMarker = /(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(\d{2})(?!\d)/g;
  const matches = [];
  let m;
  while ((m = dayMarker.exec(body)) !== null) {
    matches.push({ idx: m.index, end: m.index + m[0].length, dow: m[1], day: +m[2] });
  }
  if (matches.length === 0) return { period: { startDate: periodStart, endDate: periodEnd, name: pilotName }, events: [] };

  const chunks = [];
  for (let i = 0; i < matches.length; i++) {
    const startIdx = matches[i].end;
    const endIdx = (i+1 < matches.length) ? matches[i+1].idx : body.length;
    chunks.push({
      day: matches[i].day,
      dow: matches[i].dow,
      content: body.slice(startIdx, endIdx).trim(),
    });
  }

  const events = [];
  let lastTabMinutes = null;
  let lastTlvArrivalDate = null;
  let dutyCounter = 0;
  let lastDutyId = null;

  for (const c of chunks) {
    // Resolve the actual Date for this day-of-month within the period
    const date = dateForDayOfMonth(c.day, periodStart, periodEnd);
    if (!date) continue;
    const dayKey = ymd(date);

    const content = c.content;

    // Blank cell = unassigned day. Deliberately distinct from a rostered day
    // off ("X"), which is a guaranteed day off and does get an event.
    if (!content) { maybeEmitRestEnd(); continue; }

    // ---- Guaranteed day off: the roster prints a bare "X" ----------------
    if (/^X(\s|$)/.test(content)) {
      events.push(makeAllDay('dayOff', 'Day off', date, dayKey, { code: 'GDO', rawCode: 'X' }));
      maybeEmitRestEnd();
      continue;
    }

    // ---- Non-flying duty: standby / vacation / ground --------------------
    const nf = matchNonFlyingDuty(content);
    if (nf) {
      if (nf.startHHMM && nf.endHHMM) {
        // Timed duty — sim session, office day, airport standby with a window.
        dutyCounter++; lastDutyId = 'd' + dutyCounter;
        const block = makeBlock(nf.kind, titleForDuty(nf), date, nf.startHHMM, nf.endHHMM, dayKey,
          { roster: nf.rawCode, ...(nf.station ? { station: nf.station } : {}) }, lastDutyId);
        block.subtype = nf.subtype;
        block.code    = nf.code;
        block.rawCode = nf.rawCode;
        block.dutyMinutes = Math.round((block.end - block.start) / 60000);
        if (nf.kind === 'standby') {
          block.report  = fmtHM(nf.startHHMM);
          block.release = fmtHM(nf.endHHMM);
        }
        events.push(block);

        // A pickup often precedes a ground duty — stretch it to the duty start.
        const pu0 = PICKUP_RE.exec(content);
        if (pu0) {
          const pickup = makeBlock('pickup', 'Pickup', date, pu0[2], pu0[3], dayKey,
            { airport: pu0[1], readyTime: fmtHM(pu0[3]) }, lastDutyId);
          pickup.end = new Date(block.start);
          pickup.sub = `${fmtHM(pu0[2])} → ${fmtHM(nf.startHHMM)}`;
          events.push(pickup);
        }

        const tabM0 = /\[TAB\s+(\d+:\d{2})\]/.exec(content);
        if (tabM0) {
          lastTabMinutes = parseHMM(tabM0[1]);
          lastTlvArrivalDate = timeOnDate(date, nf.endHHMM);
        }
      } else {
        // All-day duty — home reserve, vacation block, …
        events.push(makeAllDay(nf.kind, titleForDuty(nf), date, dayKey, {
          code: nf.code, rawCode: nf.rawCode, subtype: nf.subtype, station: nf.station,
        }));
      }
      maybeEmitRestEnd();
      continue;
    }

    // Flight day. Look for PICKUP and flight legs.
    const pu = PICKUP_RE.exec(content);

    // Flight legs: optional DH/ prefix, "LY <num> <FROM> <!?HHMM>(-?\d?) <!?HHMM>(-?\d?) <TO>"
    // We're tolerant about the "B737" suffix and bracket info.
    const legRe = /(DH\/)?LY\s*(\d+)\s+([A-Z]{3})\s*(!?\d{4})(-\d)?\s+(!?\d{4})(-\d)?\s+([A-Z]{3})/g;
    const legs = [];
    let lm;
    while ((lm = legRe.exec(content)) !== null) {
      legs.push({
        deadhead: !!lm[1],
        flightNo: 'LY' + lm[2],
        from: lm[3],
        depRaw: lm[4],
        depShift: lm[5] ? parseInt(lm[5], 10) : 0, // e.g. "-1" → -1
        arrRaw: lm[6],
        arrShift: lm[7] ? parseInt(lm[7], 10) : 0,
        to: lm[8],
      });
    }

    // Extract FT/TAB summaries
    const ftM  = /\[FT\s+(\d+:\d{2})\]/.exec(content);
    const tabM = /\[TAB\s+(\d+:\d{2})\]/.exec(content);

    if (pu || legs.length > 0) {
      // A new duty if there is a PICKUP, otherwise this is a continuation of the previous duty
      let pickupEvent = null;
      if (pu) {
        dutyCounter++;
        lastDutyId = 'd' + dutyCounter;
        pickupEvent = makeBlock('pickup', 'Pickup', date, pu[2], pu[3], dayKey,
          { airport: pu[1], readyTime: fmtHM(pu[3]) }, lastDutyId);
        events.push(pickupEvent);
      }
      const dutyId = lastDutyId || ('d' + (++dutyCounter));

      // Build a single combined flight event for this day spanning all legs.
      const computedLegs = legs.map(leg => {
        const depTime = leg.depRaw.replace('!','');
        const arrTime = leg.arrRaw.replace('!','');
        const depForeign = leg.depRaw.startsWith('!');
        const arrForeign = leg.arrRaw.startsWith('!');
        let start = timeOnDate(date, depTime);
        if (leg.depShift) start = addMinutes(start, leg.depShift * 24 * 60);
        let end   = timeOnDate(date, arrTime);
        if (leg.arrShift) end = addMinutes(end, leg.arrShift * 24 * 60);
        if (end <= start) end = addMinutes(end, 24*60);
        return { ...leg, depTime, arrTime, depForeign, arrForeign, start, end };
      });

      let lastTlvArr = null;
      if (computedLegs.length > 0) {
        const first = computedLegs[0];
        const last  = computedLegs[computedLegs.length - 1];

        // Build a clean title showing the route, e.g. "TLV → AMS → TLV" or "FRA → TLV"
        const route = [first.from, ...computedLegs.map(l => l.to)];
        const dedup = [route[0]];
        for (let i = 1; i < route.length; i++) if (route[i] !== dedup[dedup.length-1]) dedup.push(route[i]);
        const routeStr = dedup.join(' → ');
        const flightNos = computedLegs.map(l => (l.deadhead ? 'DH ' : '') + l.flightNo).join(' / ');

        events.push({
          id: cryptoId(),
          kind: 'flight',
          dutyId,
          dayKey,
          start: first.start,
          end:   last.end,
          title: routeStr,
          sub: `${first.depTime} → ${last.arrTime}`,
          sectors: computedLegs.filter(l => !l.deadhead).length,
          blockMinutes: null, // filled from [FT hh:mm] below
          // Structured legs, so a consumer can pick the one that is actually
          // airborne right now (see radar.js) rather than guessing from the
          // human-readable summary in details.legs.
          legList: computedLegs.map(l => ({
            no: l.flightNo,
            from: l.from,
            to: l.to,
            dep: l.start.toISOString(),
            arr: l.end.toISOString(),
            deadhead: l.deadhead,
          })),
          details: {
            flights: flightNos,
            route: routeStr,
            legs: computedLegs.map(l =>
              `${l.deadhead ? 'DH ' : ''}${l.flightNo}  ${l.from} ${fmtHM(l.depTime)}${l.depForeign?' (loc)':''} → ${l.to} ${fmtHM(l.arrTime)}${l.arrForeign?' (loc)':''}`
            ).join('\n'),
          },
        });

        // If pickup exists on this day, extend it to the first flight's departure
        if (pickupEvent) {
          pickupEvent.end = new Date(first.start);
          pickupEvent.sub = `${fmtHM(pu[2])} → ${first.depTime.slice(0,2)}:${first.depTime.slice(2,4)}`;
        }

        // Track the last TLV arrival across all legs (some legs go through outstations)
        for (const l of computedLegs) {
          if (l.to === 'TLV') lastTlvArr = l;
        }
      }

      // Drive-home: 1 hour after the final TLV arrival of this day
      if (lastTlvArr) {
        const arrDate = lastTlvArr.end;
        const homeEnd = addMinutes(arrDate, 60);
        events.push({
          id: cryptoId(),
          kind: 'driveHome',
          dutyId,
          dayKey,
          start: arrDate,
          end: homeEnd,
          title: 'Drive home',
          sub: `${fmtHM(lastTlvArr.arrTime)} + 1h`,
          details: { from: 'TLV', note: '+1h after landing' },
        });
        lastTlvArrivalDate = arrDate;
      }

      if (tabM) {
        lastTabMinutes = parseHMM(tabM[1]);
        if (lastTlvArr) maybeEmitRestEnd();
      }
      if (ftM) {
        // attach flight-time total to the combined flight event for the details modal
        for (let i = events.length - 1; i >= 0; i--) {
          if (events[i].dayKey === dayKey && events[i].kind === 'flight') {
            events[i].details.flightTime = ftM[1];
            events[i].blockMinutes = parseHMM(ftM[1]);
            break;
          }
        }
      }
    }
  }

  function maybeEmitRestEnd() {
    if (lastTlvArrivalDate && lastTabMinutes != null) {
      const restEnd = addMinutes(lastTlvArrivalDate, lastTabMinutes);
      events.push({
        id: cryptoId(),
        kind: 'restEnd',
        dutyId: lastDutyId,
        dayKey: ymd(restEnd),
        start: restEnd,
        end: addMinutes(restEnd, 15),
        title: 'End of rest',
        sub: fmtTime(restEnd),
        details: {
          restPeriod: minutesToHM(lastTabMinutes),
          note: 'Earliest possible next duty',
        },
      });
      lastTlvArrivalDate = null;
      lastTabMinutes = null;
    }
  }
  // Flush in case there is a trailing rest period
  maybeEmitRestEnd();

  // Merge multi-day flight legs that share the same duty into a single "session"
  // (e.g. TLV→FRA on Wed, FRA→TLV on Thu becomes one block).
  const merged = mergeFlightsByDuty(events);

  // Normalise every event to the full schema, tag origin, and assign stable
  // content-based IDs so the same event keeps its id across re-parses.
  for (const ev of merged) {
    ev.id      = stableEventId(ev);
    ev.origin  = 'pdf';
    ev.subtype = ev.subtype ?? null;
    ev.code    = ev.code    ?? (KINDS[ev.kind]?.code ?? null);
    ev.rawCode = ev.rawCode ?? null;
    ev.allDay  = ev.allDay  ?? false;
    ev.sectors = ev.sectors ?? 0;
    ev.legList = ev.legList ?? [];
    ev.blockMinutes = ev.blockMinutes ?? null;
    ev.dutyMinutes  = ev.dutyMinutes  ?? null;
    ev.dutyId  = ev.dutyId  ?? null;
  }

  return {
    period: { startDate: periodStart, endDate: periodEnd, name: pilotName },
    events: merged,
  };
}

function mergeFlightsByDuty(events) {
  const flightsByDuty = new Map();
  const passthrough = [];
  for (const ev of events) {
    if (ev.kind === 'flight' && ev.dutyId) {
      if (!flightsByDuty.has(ev.dutyId)) flightsByDuty.set(ev.dutyId, []);
      flightsByDuty.get(ev.dutyId).push(ev);
    } else {
      passthrough.push(ev);
    }
  }

  const mergedFlights = [];
  for (const [, group] of flightsByDuty) {
    group.sort((a, b) => a.start - b.start);

    // Split each duty into sessions. A session ends as soon as a leg lands at TLV.
    // That way TLV→FRA→TLV (overnight) stays one block, but TLV→DME→TLV then
    // TLV→MUC→TLV in the same duty are two separate sessions.
    const sessions = [];
    let current = [];
    for (const leg of group) {
      current.push(leg);
      const stops = leg.title.split(' → ');
      if (stops[stops.length - 1] === 'TLV') {
        sessions.push(current);
        current = [];
      }
    }
    if (current.length) sessions.push(current);

    for (const session of sessions) {
      if (session.length === 1) { mergedFlights.push(session[0]); continue; }
      const first = session[0];
      const last  = session[session.length - 1];

      // Combine the route — e.g. ["TLV→FRA","FRA→TLV"] → "TLV → FRA → TLV"
      const stops = [];
      for (const f of session) {
        for (const p of f.title.split(' → ')) {
          if (stops[stops.length - 1] !== p) stops.push(p);
        }
      }
      const routeStr = stops.join(' → ');

      mergedFlights.push({
        ...first,
        start: first.start,
        end: last.end,
        title: routeStr,
        sub: `${shortDayTime(first.start)} → ${shortDayTime(last.end)}`,
        sectors: session.reduce((s, f) => s + (f.sectors || 0), 0),
        blockMinutes: session.reduce((s, f) => s + (f.blockMinutes || 0), 0) || null,
        legList: session.flatMap(f => f.legList || []),
        details: {
          flights: session.map(f => f.details.flights).filter(Boolean).join(' / '),
          route: routeStr,
          legs: session.map(f => f.details.legs).filter(Boolean).join('\n'),
          flightTime: session.map(f => f.details.flightTime).filter(Boolean).join(' + '),
        },
      });
    }
  }

  return [...passthrough, ...mergedFlights].sort((a, b) => a.start - b.start);
}

function shortDayTime(d) {
  const dow = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
  const p = n => String(n).padStart(2,'0');
  return `${dow} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function dateForDayOfMonth(day, periodStart, periodEnd) {
  // Walk from periodStart to periodEnd; return the first date matching day.
  const d = new Date(periodStart);
  while (d <= periodEnd) {
    if (d.getDate() === day) return new Date(d);
    d.setDate(d.getDate() + 1);
  }
  return null;
}

/**
 * Recognise a non-flying duty row: standby, vacation, ground duty.
 *
 * Handles rows where a PICKUP clause precedes the duty code — the PDF text
 * layer runs them together ("PICKUP TLV 0700 0710TZI TLV 0800 1600"), which
 * an anchored /^TZI/ match silently missed.
 *
 * @returns {{kind,subtype,code,rawCode,station,startHHMM,endHHMM}|null}
 */
function matchNonFlyingDuty(content) {
  if (/\bLY\s*\d/.test(content)) return null;             // row carries flight legs

  let rest = content.replace(PICKUP_RE, ' ')              // drop leading pickup clause
                    .replace(/\[[^\]]*\]/g, ' ')          // drop [FT 04:45][TAB 11:10]
                    .trim();
  if (!rest) return null;

  const m = /^([A-Za-z][A-Za-z0-9_]{0,9})\b\s*(R\b)?\s*([A-Z]{3})?\s*(\d{4})?\s*(\d{4})?/.exec(rest);
  if (!m) return null;

  const rawCode = m[1].toUpperCase();
  if (rawCode === 'PICKUP') return null;

  const reserveFlag = !!m[2];
  const station   = m[3] || null;
  const startHHMM = m[4] || null;
  const endHHMM   = m[5] || null;

  let cls = classifyCode(rawCode);

  // "Dty 0800 1600" — a duty block with no category code of its own.
  if (!cls && rawCode === 'DTY' && startHHMM && endHHMM) {
    cls = { kind: 'ground', subtype: 'office', code: 'GND' };
  }
  // Unrecognised code that still looks like a rostered block (code + window,
  // no flight legs) is a ground duty — far more useful than a generic note.
  if (!cls && startHHMM && endHHMM && /^[A-Z][A-Z0-9_]{1,9}$/.test(rawCode)) {
    cls = { kind: 'ground', subtype: 'course', code: 'GND' };
  }
  if (!cls) return null;

  let subtype = cls.subtype;
  if (cls.kind === 'standby') {
    // "R" (reserve) or no reporting window ⇒ home reserve.
    // An explicit reporting window ⇒ airport standby.
    subtype = (reserveFlag || !startHHMM) ? 'home' : 'airport';
  }
  return { ...cls, subtype, rawCode, station, startHHMM, endHHMM };
}

function titleForDuty(nf) {
  const sub = nf.subtype && SUBTYPES[nf.kind]?.[nf.subtype];
  if (nf.kind === 'standby')  return sub ? `Standby — ${sub.label}` : 'Standby';
  if (nf.kind === 'vacation') return 'Vacation';
  if (nf.kind === 'dayOff')   return 'Day off';
  if (nf.kind === 'ground')   return sub ? `${sub.label} (${nf.rawCode})` : `Ground duty (${nf.rawCode})`;
  return KINDS[nf.kind]?.label || nf.rawCode;
}

function makeAllDay(kind, title, date, dayKey, extra = {}) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  return {
    id: cryptoId(),
    kind,
    subtype: extra.subtype || null,
    code:    extra.code || KINDS[kind]?.code || null,
    rawCode: extra.rawCode || null,
    dayKey,
    start,
    end: addMinutes(start, 24 * 60),
    allDay: true,
    title,
    sub: '',
    dutyId: null,
    details: {
      ...(extra.station ? { station: extra.station } : {}),
      ...(extra.rawCode ? { roster: extra.rawCode } : {}),
    },
  };
}

function makeBlock(kind, title, date, startHHMM, endHHMM, dayKey, extra, dutyId) {
  const start = timeOnDate(date, startHHMM);
  let end     = timeOnDate(date, endHHMM);
  if (end <= start) end = addMinutes(end, 24*60);
  return {
    id: cryptoId(),
    kind, dutyId, dayKey,
    start, end,
    title,
    sub: `${fmtHM(startHHMM)} → ${fmtHM(endHHMM)}`,
    details: { ...extra },
  };
}

function fmtHM(hhmm) { return hhmm.slice(0,2) + ':' + hhmm.slice(2,4); }
function fmtTime(d) {
  const p = n => String(n).padStart(2,'0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}
function minutesToHM(m) {
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h}h ${String(mm).padStart(2,'0')}m`;
}

function cryptoId() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Math.random().toString(36).slice(2,10);
}

// Content-based, stable across re-parses of the same data — used so that
// uploading a corrected PDF replaces matching events and preserves notes.
function stableEventId(ev) {
  const t = ev.start.toISOString().slice(0, 16); // minute precision
  const slug = String(ev.title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 32);
  return `${ev.kind}|${ev.dayKey}|${t}|${slug}`;
}
