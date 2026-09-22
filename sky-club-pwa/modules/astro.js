// astro.js — thin wrapper over the vendored astronomy-engine (see vendor/astronomy-engine.js).
// Everything here returns azimuth (0-360°, clockwise from true north) and altitude
// (-90..+90°, degrees above the horizon) so sky.js only ever deals in compass bearings.

import {
  Body, Observer, Equator, Horizon, EclipticLongitude, MoonPhase, Libration,
  SearchMoonQuarter, NextMoonQuarter, SearchLunarEclipse, SearchLocalSolarEclipse,
  Rotation_EQJ_HOR, Illumination, HelioVector, GeoMoon,
} from '../vendor/astronomy-engine.js?v=23';

const PLANET_BODIES = ['Sun', 'Moon', 'Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];
const ORBIT_BODIES = ['Mercury', 'Venus', 'Earth', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune'];

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

/**
 * The Moon's REAL centre-to-centre distance right now, in km. It swings between
 * roughly 356,500 and 406,700 km over a month, so this is a genuinely changing
 * number rather than the textbook 384,400 average.
 */
export function moonDistanceKm(date) {
  return Libration(date).dist_km;
}

// ---- The real sky, as vectors ----
//
// Sky mode projects everything through a camera (see sensors.js::readView), so
// what it needs is a direction vector per object, not an azimuth/altitude pair.
// Stars, constellation figures and the Milky Way are fixed in the J2000
// equatorial frame (EQJ), so they are turned into unit vectors ONCE; the only
// thing that changes with time and place is a single EQJ → local-horizon
// rotation, which also carries precession and nutation. That replaced ~460
// Horizon() calls per refresh — and a real bug: the old Milky Way passed right
// ascension in DEGREES to Horizon(), which expects HOURS, so the band was drawn
// in an entirely different part of the sky from the real one.

const DEG = Math.PI / 180;

/** Unit vector in EQJ for an RA/Dec in degrees. */
export function raDecToVec(raDeg, decDeg) {
  const ra = raDeg * DEG, dec = decDeg * DEG;
  return [Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)];
}

/**
 * 3×3 matrix (rows) taking an EQJ unit vector to local East/North/Up for this
 * observer at this instant. The engine's HOR frame is (north, west, zenith)
 * and RotateVector computes HOR = rotᵀ · v, hence the column picks below.
 */
export function eqjToEnu(date, lat, lon) {
  const r = Rotation_EQJ_HOR(date, new Observer(lat, lon, 0)).rot;
  return [
    [-r[0][1], -r[1][1], -r[2][1]], // east  = −west
    [r[0][0], r[1][0], r[2][0]],    // north
    [r[0][2], r[1][2], r[2][2]],    // up
  ];
}

// IAU J2000 equatorial → galactic, for sampling the Milky Way brightness map.
export const EQJ_TO_GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.4448296300, 0.7469822445],
  [-0.8676661490, -0.1980763734, 0.4559837762],
];

function enuFromAzAlt(az, alt) {
  const a = az * DEG, h = alt * DEG;
  return [Math.sin(a) * Math.cos(h), Math.cos(a) * Math.cos(h), Math.sin(h)];
}

/**
 * The Sun, Moon and planets for this observer right now: az/alt WITH
 * atmospheric refraction (a setting Sun really does sit ~0.5° higher than
 * geometry says), the same as an ENU vector, and real apparent magnitude —
 * Venus at −4.5 and Neptune at +7.8 should not be drawn the same.
 */
export function skyBodies(date, lat, lon) {
  const observer = new Observer(lat, lon, 0);
  return PLANET_BODIES.map((name) => {
    const eq = Equator(Body[name], date, observer, true, true);
    const hor = Horizon(date, observer, eq.ra, eq.dec, 'normal');
    let mag = null;
    try { mag = Illumination(Body[name], date).mag; } catch {}
    return {
      id: name.toLowerCase(), name, az: hor.azimuth, alt: hor.altitude,
      enu: enuFromAzAlt(hor.azimuth, hor.altitude), mag,
    };
  });
}


// ---- The solar system in 3-D, for the Explore orrery ----
//
// Heliocentric positions in the J2000 ECLIPTIC frame (x toward the March
// equinox, z toward ecliptic north), in AU. These are the real positions —
// real eccentric ellipses with the Sun at a focus, real orbital tilts — so the
// orrery can draw true orbit shapes rather than circles.

const OBLIQUITY = 23.4392911 * DEG;
const COS_OBL = Math.cos(OBLIQUITY), SIN_OBL = Math.sin(OBLIQUITY);
function eqjToEcl(v) {
  return [v.x, v.y * COS_OBL + v.z * SIN_OBL, -v.y * SIN_OBL + v.z * COS_OBL];
}
/** Converts an EQJ unit vector ([x,y,z]) to the ecliptic frame. */
export function eqjVecToEcl(v) {
  return eqjToEcl({ x: v[0], y: v[1], z: v[2] });
}

/** Heliocentric ecliptic position of a planet, in AU. `name` is e.g. 'Mars'. */
export function helioEcliptic(name, date) {
  return eqjToEcl(HelioVector(Body[name], date));
}

/** The Moon's geocentric ecliptic position, in AU. */
export function moonEcliptic(date) {
  return eqjToEcl(GeoMoon(date));
}

/** One full real orbit, sampled from the ephemeris itself (n points). */
export function orbitPath(name, periodDays, date, n = 180) {
  const pts = [];
  const t0 = date.getTime();
  for (let k = 0; k < n; k++) pts.push(helioEcliptic(name, new Date(t0 + (k / n) * periodDays * 86400000)));
  return pts;
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
