// radar.js — hand a roster flight over to the Airline Radar app.
//
// Airline Radar shows *live* keyless ADS-B. That single fact decides the whole
// design here: a flight number is only meaningful to it while that flight is
// actually in the air. ELY859 operates most days, so opening it on a roster
// leg from three weeks ago would confidently show you the wrong aeroplane —
// today's ELY859. So the link is offered only inside a live window, and the
// leg is chosen by time rather than by position in the list.
//
// Deep-link contract (airline-radar-pwa/app.js readDeepLink):
//   ?flight=ELY348[,ELY349]&sta=HH:MM&from=<label>
// `sta` is parsed as UTC (fmt.parseStaUtc), which is why we convert.

const RADAR_URL = '../airline-radar-pwa/';

// ADS-B callsigns are ICAO. The roster prints IATA ("LY337"), and Airline
// Radar's parseQuery only recognises a callsign as three letters + digits —
// "LY337" would be misread as a registration.
const IATA_TO_ICAO = {
  LY: 'ELY',   // El Al
  LX: 'SWR',   // partners occasionally appear as deadhead legs
  BA: 'BAW',
  AF: 'AFR',
  KL: 'KLM',
  LH: 'DLH',
};

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

// How long either side of a leg the aircraft is worth looking for. Aircraft
// typically start transmitting well before push-back, and stay visible while
// taxiing in, so the window is deliberately wider than the flight itself.
const BEFORE_DEPARTURE = 2 * HOUR;
const AFTER_ARRIVAL    = 1 * HOUR;

/** "LY337" → "ELY337". Returns null when the prefix is unknown. */
export function callsignOf(flightNo) {
  const m = /^([A-Z]{2})\s*(\d{1,4})$/.exec(String(flightNo || '').trim().toUpperCase());
  if (!m) return null;
  const icao = IATA_TO_ICAO[m[1]];
  return icao ? icao + m[2] : null;
}

/**
 * Build the Airline Radar hand-off for an event.
 *
 * Always returns a link for a recognisable flight — an invisible feature is a
 * feature nobody finds. What changes with time is the *promise* it makes:
 * inside the live window the aeroplane on screen is this leg, outside it the
 * same callsign belongs to another day's aircraft, and `live:false` says so
 * plainly rather than hiding the link or quietly pointing at the wrong jet.
 *
 * @returns {{href, label, note, live, callsigns}|null}
 *          null only when there is nothing sane to look up.
 */
export function radarTarget(ev, now = Date.now()) {
  if (!ev || ev.kind !== 'flight') return null;

  const legs = legsOf(ev);
  // Nothing recognisable to look up — still offer the app rather than showing
  // nothing, because a silently missing control is indistinguishable from a
  // broken one.
  if (!legs.length) {
    return {
      href: RADAR_URL,
      label: 'Open Airline Radar',
      note: 'No flight number on this duty — search there by tail or callsign',
      live: false,
      callsigns: [],
    };
  }

  const inWindow = l => now >= l.depMs - BEFORE_DEPARTURE && now <= l.arrMs + AFTER_ARRIVAL;
  const live = legs.filter(inWindow);

  // Which leg does the pilot mean? Airborne wins. Otherwise the next to depart
  // — during a turnaround the leg that just landed is still inside its tail
  // window, and pointing at it would be looking backwards.
  const pool = live.length ? live : legs;
  const airborne = pool.find(l => now >= l.depMs && now <= l.arrMs);
  const upcoming = pool.filter(l => l.depMs > now).sort((a, b) => a.depMs - b.depMs)[0];
  const landed   = pool.filter(l => l.arrMs < now).sort((a, b) => b.arrMs - a.arrMs)[0];
  const chosen = airborne || upcoming || landed || pool[0];
  const callsigns = pool.map(l => callsignOf(l.no));

  const params = new URLSearchParams({ flight: callsigns.join(',') });

  // Hand over the scheduled arrival: keyless ADS-B carries no schedule, so the
  // roster's STA is the only one Airline Radar can show. Roster times are
  // local at the event airport; only a TLV arrival is reliably in the phone's
  // own timezone, so that is the only one we convert and send. Meaningless
  // once we are outside the window — it would describe a different day.
  if (live.length && chosen.to === 'TLV') {
    const arr = new Date(chosen.arrMs);
    params.set('sta', `${pad2(arr.getUTCHours())}:${pad2(arr.getUTCMinutes())}`);
    params.set('from', 'roster');
  }

  const cs = callsignOf(chosen.no);
  const route = chosen.label || `${chosen.from} → ${chosen.to}`;

  if (live.length) {
    const phase = airborne ? 'airborne' : (chosen === upcoming ? 'upcoming' : 'landed');
    return {
      href: RADAR_URL + '?' + params.toString(),
      label: `Track ${cs}${phase === 'airborne' ? ' live' : ''}`,
      note: phase === 'airborne' ? `${route} · airborne now`
          : phase === 'upcoming' ? `${route} · departs ${clock(chosen.depMs)}`
          : `${route} · landed ${clock(chosen.arrMs)}`,
      live: true,
      callsigns,
    };
  }

  // Outside the window. Still useful — the same flight number runs most days,
  // so this shows how the route is running today — but say that outright.
  const days = Math.round((startOfDay(chosen.depMs) - startOfDay(now)) / (24 * HOUR));
  const when = days === 0 ? 'later today'
             : days > 0   ? `in ${days} day${days === 1 ? '' : 's'}`
             : `${-days} day${days === -1 ? '' : 's'} ago`;
  return {
    href: RADAR_URL + '?' + params.toString(),
    label: `Look up ${cs}`,
    note: `${route} · ${when} — radar shows today's ${cs}`,
    live: false,
    callsigns,
  };
}

/**
 * Absolute tracking URL for an exported calendar event.
 *
 * Two things differ from the in-app link, both because an .ics is read
 * somewhere else, later:
 *
 *  - It is absolute. A relative path means nothing once the event is sitting
 *    in Apple or Google Calendar.
 *  - It is not gated on the live window. The whole point is that you open the
 *    calendar entry on the day of the flight, which is exactly when the
 *    callsign is live — gating on export time would strip the link from every
 *    future duty, i.e. all of them.
 */
export function radarExportUrl(ev) {
  if (!ev || ev.kind !== 'flight') return null;
  const legs = legsOf(ev);
  const callsigns = [...new Set(legs.map(l => callsignOf(l.no)).filter(Boolean))];
  if (!callsigns.length) return null;

  const params = new URLSearchParams({ flight: callsigns.join(',') });
  const last = legs[legs.length - 1];
  if (last && last.to === 'TLV' && Number.isFinite(last.arrMs)) {
    const arr = new Date(last.arrMs);
    params.set('sta', `${pad2(arr.getUTCHours())}:${pad2(arr.getUTCMinutes())}`);
    params.set('from', 'roster');
  }
  return absoluteRadarBase() + '?' + params.toString();
}

function absoluteRadarBase() {
  try { return new URL(RADAR_URL, location.href).href; }
  catch { return RADAR_URL; }
}

/** Is this flight airborne right now? Used for the calendar-chip marker. */
export function isAirborneNow(ev, now = Date.now()) {
  if (!ev || ev.kind !== 'flight') return false;
  return legsOf(ev).some(l => now >= l.depMs && now <= l.arrMs);
}

/**
 * Legs for an event, as {no, from, to, depMs, arrMs}.
 *
 * Rosters imported before legList existed still live in localStorage, and a
 * feature that silently does nothing for them is worse than no feature. So
 * fall back through what older events do carry, rather than making the user
 * re-import a PDF they already loaded.
 */
function legsOf(ev) {
  const structured = (ev.legList || [])
    .map(l => ({ no: l.no, from: l.from, to: l.to, depMs: Date.parse(l.dep), arrMs: Date.parse(l.arr) }))
    .filter(l => Number.isFinite(l.depMs) && Number.isFinite(l.arrMs) && callsignOf(l.no));
  if (structured.length) return structured;

  const fromLines = legsFromDetailLines(ev);
  if (fromLines.length) return fromLines;

  // Last resort: treat the whole session as one leg. Scan every string the
  // event carries for a flight number rather than trusting one field name —
  // details has changed shape across versions and a roster imported months
  // ago must not lose the link over it.
  const no = anyFlightNumber(ev);
  if (!no) return [];
  const route = String(ev.details?.route || ev.title || '').trim();
  const stops = route.split('→').map(s => s.trim());
  return [{
    no,
    from: stops[0] || '',
    to: stops[stops.length - 1] || '',
    // One synthetic leg stands for the whole session, so "TLV → TLV" on a
    // round trip would be true but useless. Carry the printed route instead.
    label: route,
    depMs: +ev.start,
    arrMs: +ev.end,
  }];
}

/**
 * Rebuild legs from the human-readable summary the old parser stored, e.g.
 *   "DH LY337  TLV 06:50 (loc) → AMS 11:05 (loc)"
 * Only clock times were kept, so times are re-anchored to the event's own
 * start and walked forward — each stamp must be at or after the previous one,
 * which is what makes an overnight or multi-day trip come out right.
 */
function legsFromDetailLines(ev) {
  const text = String(ev.details?.legs || '');
  if (!text || !(ev.start instanceof Date)) return [];
  const re = /(DH\s+)?([A-Z]{2}\s?\d{1,4})\s+([A-Z]{3})\s+(\d{1,2}:\d{2})(?:\s*\(loc\))?\s*→\s*([A-Z]{3})\s+(\d{1,2}:\d{2})/g;

  const out = [];
  let after = new Date(ev.start.getTime() - 60 * 1000);   // let the first dep equal ev.start
  let m;
  while ((m = re.exec(text)) !== null) {
    const no = m[2].replace(/\s+/g, '');
    if (!callsignOf(no)) continue;
    const dep = atOrAfter(m[4], after);
    const arr = atOrAfter(m[6], dep);
    out.push({ no, from: m[3], to: m[5], depMs: +dep, arrMs: +arr });
    after = arr;
  }
  return out;
}

/**
 * Any recognisable flight number anywhere on the event — title, sub, or any
 * string in details, whatever that object happened to look like when this
 * roster was imported.
 */
function anyFlightNumber(ev) {
  const pool = [ev.title, ev.sub];
  const d = ev.details;
  if (d && typeof d === 'object') {
    for (const v of Object.values(d)) if (typeof v === 'string') pool.push(v);
  }
  for (const s of pool) {
    if (!s) continue;
    const re = /\b([A-Z]{2})\s?(\d{1,4})\b/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const cand = m[1] + m[2];
      if (callsignOf(cand)) return cand;
    }
  }
  return null;
}

/** The first moment at "HH:MM" that is not before `after`. */
function atOrAfter(hhmm, after) {
  const [h, min] = hhmm.split(':').map(Number);
  const d = new Date(after);
  d.setHours(h, min, 0, 0);
  while (d < after) d.setDate(d.getDate() + 1);
  return d;
}

function pad2(n) { return String(n).padStart(2, '0'); }
function clock(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function startOfDay(ms) {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
