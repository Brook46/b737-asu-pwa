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
 * Decide whether — and with what — to open Airline Radar for this event.
 *
 * @returns {{href, label, note, callsigns}|null} null when tracking would be
 *          misleading (not a flight, unknown airline, or outside the window).
 */
export function radarTarget(ev, now = Date.now()) {
  if (!ev || ev.kind !== 'flight') return null;

  const legs = (ev.legList || [])
    .map(l => ({ ...l, depMs: Date.parse(l.dep), arrMs: Date.parse(l.arr) }))
    .filter(l => Number.isFinite(l.depMs) && Number.isFinite(l.arrMs) && callsignOf(l.no));
  if (!legs.length) return null;

  const inWindow = l => now >= l.depMs - BEFORE_DEPARTURE && now <= l.arrMs + AFTER_ARRIVAL;

  const live = legs.filter(inWindow);
  if (!live.length) return null;

  // Which leg does the pilot mean right now? Airborne wins. Otherwise the next
  // one to depart — during a turnaround the leg that just landed is still
  // inside its tail window, and pointing at it would be looking backwards.
  const airborne = live.find(l => now >= l.depMs && now <= l.arrMs);
  const upcoming = live.filter(l => l.depMs > now).sort((a, b) => a.depMs - b.depMs)[0];
  const landed   = live.filter(l => l.arrMs < now).sort((a, b) => b.arrMs - a.arrMs)[0];
  const chosen = airborne || upcoming || landed;
  const phase = airborne ? 'airborne' : (chosen === upcoming ? 'upcoming' : 'landed');
  const callsigns = live.map(l => callsignOf(l.no));

  const params = new URLSearchParams({ flight: callsigns.join(',') });

  // Hand over the scheduled arrival: keyless ADS-B carries no schedule, so the
  // roster's STA is the only one Airline Radar can show. Roster times are
  // local at the event airport; only a TLV arrival is reliably in the phone's
  // own timezone, so that is the only one we convert and send.
  if (chosen.to === 'TLV') {
    const arr = new Date(chosen.arrMs);
    params.set('sta', `${pad2(arr.getUTCHours())}:${pad2(arr.getUTCMinutes())}`);
    params.set('from', 'roster');
  }

  const label = `Track ${callsignOf(chosen.no)}${phase === 'airborne' ? ' live' : ''}`;
  const route = `${chosen.from} → ${chosen.to}`;
  const note = phase === 'airborne' ? `${route}, airborne now`
             : phase === 'upcoming' ? `${route}, departs ${clock(chosen.depMs)}`
             : `${route}, landed ${clock(chosen.arrMs)}`;

  return { href: RADAR_URL + '?' + params.toString(), label, note, callsigns };
}

function pad2(n) { return String(n).padStart(2, '0'); }
function clock(ms) {
  const d = new Date(ms);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
