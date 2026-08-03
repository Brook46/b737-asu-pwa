// astro.js — thin wrapper over the vendored astronomy-engine (see vendor/astronomy-engine.js).
// Everything here returns azimuth (0-360°, clockwise from true north) and altitude
// (-90..+90°, degrees above the horizon) so sky.js only ever deals in compass bearings.

import {
  Body, Observer, Equator, Horizon, EclipticLongitude, MoonPhase,
  SearchMoonQuarter, NextMoonQuarter, SearchLunarEclipse, SearchLocalSolarEclipse,
} from '../vendor/astronomy-engine.js';

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

// Standard IAU 1958 equatorial(J2000)→galactic rotation matrix, transposed here
// so we go the other way: given a point on the galactic plane, find its real
// RA/Dec. Same "real, not decorative" rule as everything else in this app — the
// Milky Way band in Sky mode is the actual galactic plane at its actual sky
// position, not a fixed decorative graphic.
const GAL_TO_EQ = [
  [-0.0548755604, 0.4941094279, -0.8676661490],
  [-0.8734370902, -0.4448296300, -0.1980763734],
  [-0.4838350155, 0.7469822445, 0.4559837762],
];
const DEG = Math.PI / 180;

function galacticToRaDec(lDeg, bDeg) {
  const l = lDeg * DEG, b = bDeg * DEG;
  const xg = Math.cos(b) * Math.cos(l);
  const yg = Math.cos(b) * Math.sin(l);
  const zg = Math.sin(b);
  const xe = GAL_TO_EQ[0][0] * xg + GAL_TO_EQ[0][1] * yg + GAL_TO_EQ[0][2] * zg;
  const ye = GAL_TO_EQ[1][0] * xg + GAL_TO_EQ[1][1] * yg + GAL_TO_EQ[1][2] * zg;
  const ze = GAL_TO_EQ[2][0] * xg + GAL_TO_EQ[2][1] * yg + GAL_TO_EQ[2][2] * zg;
  const dec = Math.asin(Math.max(-1, Math.min(1, ze))) / DEG;
  const ra = (Math.atan2(ye, xe) / DEG + 360) % 360;
  return { ra, dec };
}

// A scatter of fixed points tracing the real galactic plane, with a few degrees
// of scatter either side so it reads as a soft band rather than a thin line —
// generated once at module load (galactic coordinates don't depend on the date,
// only on where you're looking, which recomputes every frame in sky.js).
const MILKY_WAY = (() => {
  const points = [];
  for (let l = 0; l < 360; l += 3) {
    for (let k = 0; k < 3; k++) {
      // sum of two uniforms ≈ a soft (triangular) falloff away from the plane —
      // denser and brighter near b=0 without needing a real Gaussian.
      const b = ((Math.random() + Math.random() - 1) * 11);
      const fade = 1 - Math.min(1, Math.abs(b) / 11);
      points.push({
        id: `mw${points.length}`,
        ...galacticToRaDec(l + Math.random() * 3, b),
        size: 1 + fade * 2.2,
        opacity: 0.08 + fade * 0.22,
      });
    }
  }
  return points;
})();

/** Alt/az for the Milky Way's scatter of fixed galactic-plane points, for this observer. */
export function milkyWayPositions(date, lat, lon) {
  const observer = new Observer(lat, lon, 0);
  return MILKY_WAY.map((p) => {
    const hor = Horizon(date, observer, p.ra, p.dec, 'normal');
    return { ...p, az: hor.azimuth, alt: hor.altitude };
  });
}

// ---- Special-date events (real searches via the vendored engine, not fabricated) ----

/** The next real Full Moon after `fromDate`. SearchMoonQuarter finds whichever
 * quarter is next (new/first/full/third); loop forward to the one that's full. */
export function nextFullMoon(fromDate) {
  let mq = SearchMoonQuarter(fromDate);
  for (let i = 0; mq.quarter !== 2 && i < 4; i++) mq = NextMoonQuarter(mq);
  return mq.time.date;
}

/** The next lunar eclipse of any kind, with whether the Moon is actually above
 * this observer's horizon at its peak (lunar eclipses are visible from the
 * whole night side of Earth, not everywhere). */
export function nextLunarEclipse(fromDate, lat, lon) {
  const info = SearchLunarEclipse(fromDate);
  const observer = new Observer(lat, lon, 0);
  const eq = Equator(Body.Moon, info.peak, observer, true, true);
  const alt = Horizon(info.peak, observer, eq.ra, eq.dec, 'normal').altitude;
  return { date: info.peak.date, kind: info.kind, visible: alt > 0 };
}

/** The next solar eclipse local to this observer (the search itself is
 * location-aware, unlike the lunar one above). */
export function nextSolarEclipse(fromDate, lat, lon) {
  const observer = new Observer(lat, lon, 0);
  const info = SearchLocalSolarEclipse(fromDate, observer);
  return { date: info.peak.time.date, kind: info.kind, visible: info.peak.altitude > 0 };
}

const CONJUNCTION_BODIES = ['Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn'];
const NOTABLE_SEP_DEG = 5; // "close together" — real astronomers call ~5° or less a conjunction worth noting

function angularSepDeg(raHoursA, decA, raHoursB, decB) {
  const ra1 = raHoursA * 15 * DEG, ra2 = raHoursB * 15 * DEG;
  const d1 = decA * DEG, d2 = decB * DEG;
  const cosSep = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos(ra1 - ra2);
  return Math.acos(Math.max(-1, Math.min(1, cosSep))) / DEG;
}

/** Scans real positions day-by-day over the next `days` for the closest two
 * naked-eye bodies get to each other — an actual conjunction, computed from
 * real RA/Dec, not a fabricated "fun fact". Returns null if nothing in that
 * window gets closer than NOTABLE_SEP_DEG. */
export function nextConjunction(fromDate, lat, lon, days = 45) {
  const observer = new Observer(lat, lon, 0);
  let best = null;
  for (let d = 0; d <= days; d++) {
    const date = new Date(fromDate.getTime() + d * 86400000);
    const positions = CONJUNCTION_BODIES.map((name) => ({ name, ...Equator(Body[name], date, observer, true, true) }));
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const sepDeg = angularSepDeg(positions[i].ra, positions[i].dec, positions[j].ra, positions[j].dec);
        if (!best || sepDeg < best.sepDeg) best = { a: positions[i].name, b: positions[j].name, sepDeg, date };
      }
    }
  }
  return best && best.sepDeg <= NOTABLE_SEP_DEG ? best : null;
}
