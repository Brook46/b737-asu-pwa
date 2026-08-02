// astro.js — thin wrapper over the vendored astronomy-engine (see vendor/astronomy-engine.js).
// Everything here returns azimuth (0-360°, clockwise from true north) and altitude
// (-90..+90°, degrees above the horizon) so sky.js only ever deals in compass bearings.

import { Body, Observer, Equator, Horizon, EclipticLongitude, MoonPhase } from '../vendor/astronomy-engine.js';

const PLANET_BODIES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
const ORBIT_BODIES = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];

/** Alt/az for the Sun, Moon and naked-eye planets right now, for this observer. */
export function bodyPositions(date, lat, lon) {
  const observer = new Observer(lat, lon, 0);
  return PLANET_BODIES.map((name) => {
    const eq = Equator(Body[name], date, observer, true, true);
    const hor = Horizon(date, observer, eq.ra, eq.dec, 'normal');
    return { id: name.toLowerCase(), name, az: hor.azimuth, alt: hor.altitude };
  });
}

/** Alt/az for a list of fixed stars ({id, name, ra, dec}), for this observer. */
export function starPositions(date, lat, lon, stars) {
  const observer = new Observer(lat, lon, 0);
  return stars.map((s) => {
    const hor = Horizon(date, observer, s.ra, s.dec, 'normal');
    return { ...s, az: hor.azimuth, alt: hor.altitude };
  });
}

/**
 * Real heliocentric ecliptic longitude (0-360°, prograde) for each orrery planet
 * on this date — where it actually is around the Sun right now (or on any chosen
 * date), independent of Earth's own position. Drives the Explore screen's orrery.
 */
export function planetLongitudes(date) {
  return ORBIT_BODIES.map((name) => ({ id: name.toLowerCase(), lon: EclipticLongitude(Body[name], date) }));
}

/**
 * The Moon's phase as an angle: 0=new, 90=first quarter, 180=full, 270=last
 * quarter — the difference in ecliptic longitude between Sun and Moon as seen
 * from Earth. Drives the Moon phase graphic (modules/moonphase.js).
 */
export function moonPhase(date) {
  return MoonPhase(date);
}

/** Sun altitude only — cheap check for "is it dark enough to see stars?" */
export function sunAltitude(date, lat, lon) {
  const observer = new Observer(lat, lon, 0);
  const eq = Equator(Body.Sun, date, observer, true, true);
  return Horizon(date, observer, eq.ra, eq.dec, 'normal').altitude;
}
