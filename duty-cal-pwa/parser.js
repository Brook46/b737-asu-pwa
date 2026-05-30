// Parse an ELY "Individual duty plan" PDF text into a list of calendar events.
//
// Input: raw text extracted from the PDF (single string, item-by-item).
// Output: { period: {startDate, endDate, name}, events: [...] }
//
// Each event has the shape:
//   { id, kind: 'pickup'|'flight'|'driveHome'|'restEnd'|'other',
//     start: Date, end: Date, dayKey: 'YYYY-MM-DD', title, sub, dutyId,
//     details: { ... raw fields ... } }

const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
const DOW = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

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

  // Split into per-day chunks using day-of-week + 2-digit markers
  const dayMarker = /\b(Mon|Tue|Wed|Thu|Fri|Sat|Sun)(\d{2})\b/g;
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
    if (!content || /^X(\s|$)/.test(content)) {
      // X = day off, skip (or add a marker? keep silent)
      // But still record rest-end if applicable
      maybeEmitRestEnd();
      continue;
    }

    // Reserve / training / vacation patterns (no flights)
    const dummyRe = /^DUMMY\s+R\s+([A-Z]{3})/;
    const vacRe   = /^VAC_FLD\s+R\s+([A-Z]{3})/;
    const tziRe   = /^TZI\s+([A-Z]{3})\s+(\d{4})\s+(\d{4})/; // training
    const dtyRe   = /^Dty\s+(\d{4})\s+(\d{4})/;             // generic duty

    if (dummyRe.test(content)) {
      events.push(makeOther('Dummy', date, 0, 24*60, dayKey, content));
      maybeEmitRestEnd();
      continue;
    }
    if (vacRe.test(content)) {
      events.push(makeOther('Vacation', date, 0, 24*60, dayKey, content));
      maybeEmitRestEnd();
      continue;
    }
    const tziM = tziRe.exec(content);
    if (tziM) {
      dutyCounter++; lastDutyId = 'd' + dutyCounter;
      const training = makeBlock('other', 'Training (TZI)', date, tziM[2], tziM[3], dayKey, { airport: tziM[1] }, lastDutyId);
      events.push(training);
      // pickup is normally before training — extend it up to the training start
      const pickupRe = /PICKUP\s+([A-Z]{3})\s+(\d{4})\s+(\d{4})/;
      const pu = pickupRe.exec(content);
      if (pu) {
        const pickup = makeBlock('pickup', 'Pickup', date, pu[2], pu[3], dayKey, { airport: pu[1], readyTime: fmtHM(pu[3]) }, lastDutyId);
        pickup.end = new Date(training.start);
        pickup.sub = `${fmtHM(pu[2])} → ${tziM[2].slice(0,2)}:${tziM[2].slice(2,4)}`;
        events.push(pickup);
      }
      const tabM = /\[TAB\s+(\d+:\d{2})\]/.exec(content);
      if (tabM) {
        lastTabMinutes = parseHMM(tabM[1]);
        lastTlvArrivalDate = timeOnDate(date, tziM[3]);
        maybeEmitRestEnd();
      }
      continue;
    }
    const dtyM = dtyRe.exec(content);
    if (dtyM) {
      dutyCounter++; lastDutyId = 'd' + dutyCounter;
      events.push(makeBlock('other', 'Duty', date, dtyM[1], dtyM[2], dayKey, {}, lastDutyId));
      continue;
    }

    // Flight day. Look for PICKUP and flight legs.
    const pickupRe = /PICKUP\s+([A-Z]{3})\s+(\d{4})\s+(\d{4})/;
    const pu = pickupRe.exec(content);

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

  // Assign stable, content-based IDs so the same event keeps the same id across re-parses.
  for (const ev of merged) ev.id = stableEventId(ev);

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

function makeOther(title, date, startMin, endMin, dayKey, raw) {
  const start = addMinutes(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0), startMin);
  const end   = addMinutes(start, endMin - startMin);
  return {
    id: cryptoId(),
    kind: 'other',
    dayKey,
    start, end,
    title,
    sub: '',
    details: { raw: raw.slice(0, 80) },
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
