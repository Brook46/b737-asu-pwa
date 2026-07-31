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

  const legs = (ev.legList || [])
    .map(l => ({ ...l, depMs: Date.parse(l.dep), arrMs: Date.parse(l.arr) }))
    .filter(l => Number.isFinite(l.depMs) && Number.isFinite(l.arrMs) && callsignOf(l.no));
  if (!legs.length) return null;

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
  const route = `${chosen.from} → ${chosen.to}`;

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

/** Is this flight airborne right now? Used for the calendar-chip marker. */
export function isAirborneNow(ev, now = Date.now()) {
  if (!ev || ev.kind !== 'flight') return false;
  return (ev.legList || []).some(l => {
    const dep = Date.parse(l.dep), arr = Date.parse(l.arr);
    return Number.isFinite(dep) && Number.isFinite(arr) && now >= dep && now <= arr;
  });
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
