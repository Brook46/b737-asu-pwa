// soaring.js — turn raw weather into the numbers a free-flight XC pilot cares about.
//
// The physics is deliberately transparent (and documented inline) so it can be
// sanity-checked against a real BLIPMAP/RASP, not treated as an oracle:
//
//   thermalTop   = terrain + boundary-layer depth                 (m MSL)
//   cloudBase    = terrain + LCL from the T/Td spread             (m MSL)
//   workingTop   = min(thermalTop, cloudBase) when cumulus form   (m MSL)
//   wStar        = Deardorff convective velocity scale            (m/s)
//   climbRate    = wStar mapped to a realistic net vario reading  (m/s)
//   flyability   = 0..100 blend of strength, band, wind, OD risk
//
// All heights are metres MSL unless the name says AGL.

const G = 9.81;      // gravity, m/s²
const CP = 1005;     // specific heat of dry air, J/(kg·K)
const RHO = 1.10;    // air density near the surface, kg/m³ (approx)
const HEAT_FRACTION = 0.14; // fraction of incoming shortwave → sensible heat flux
                            // (a mid-Bowen-ratio approximation over land)

const DRY_LAPSE = 9.8;   // dry adiabatic lapse rate, °C per km

// Standard-atmosphere MSL height (m) of a pressure level — used when a model
// gives pressure-level temperatures but no geopotential height.
export const STD_HEIGHT = { 925: 762, 850: 1457, 700: 3012, 600: 4206, 500: 5574 };

/**
 * Thermal top by the dry-adiabat / "Tmax" method: lift a parcel at the surface
 * temperature dry-adiabatically and find where it meets the environmental
 * temperature profile. Works for any model that gives pressure-level temps, so
 * it fills in for models Open-Meteo doesn't expose boundary-layer height for.
 *
 * @param tSfc     surface temperature (°C)
 * @param terrain  ground height (m MSL)
 * @param levels   [{h, t}] ascending by MSL height, environmental temp °C
 * @returns thermal-top height in m MSL, or null
 */
export function dryThermalTopMSL(tSfc, terrain, levels) {
  if (tSfc == null || !levels || !levels.length) return null;
  let prevH = terrain, prevDiff = 0.5;          // assume slight buoyancy at the surface
  for (const lv of levels) {
    if (lv.t == null || lv.h <= terrain) continue;
    const parcelT = tSfc - DRY_LAPSE * (lv.h - terrain) / 1000;
    const diff = parcelT - lv.t;                 // >0 ⇒ parcel warmer ⇒ still rising
    if (diff <= 0) {
      const frac = prevDiff / (prevDiff - diff); // linear crossing
      return prevH + (lv.h - prevH) * Math.max(0, Math.min(1, frac));
    }
    prevH = lv.h; prevDiff = diff;
  }
  return prevH;                                  // never capped within the profile
}

/** Lifting Condensation Level above ground, metres, from surface T and dewpoint. */
export function lclAgl(t2m, td2m) {
  if (t2m === null || td2m === null) return null;
  const spread = Math.max(0, t2m - td2m);
  // Espy's rule: base ≈ 125 m per °C of spread (≈ 400 ft / °C).
  return spread * 125;
}

/**
 * Deardorff convective velocity scale w* = ( (g/T) · (H/(ρ·cp)) · zi )^(1/3).
 * We estimate surface sensible heat flux H from incoming shortwave radiation.
 * Returns m/s, or 0 when there's no sun / no mixed layer.
 */
export function wStar(hr, ziOverride) {
  const zi = ziOverride != null ? ziOverride : hr.blHeight;
  const sw = hr.shortwave;
  if (!zi || zi < 50 || !sw || sw < 20) return 0;
  const tK = (hr.t2m ?? 15) + 273.15;
  const H = HEAT_FRACTION * sw;                 // W/m² of sensible heat
  const wtheta = H / (RHO * CP);                // kinematic heat flux, K·m/s
  const w3 = (G / tK) * wtheta * zi;
  return w3 > 0 ? Math.cbrt(w3) : 0;
}

/**
 * Net achievable climb a paraglider actually circles in, m/s. Thermals average
 * a bit above w*, but a glider's own sink (~1.1 m/s) and thermal inefficiency
 * eat into it. This is intentionally conservative — it should read like a vario,
 * not like a physics maximum.
 */
export function climbRate(ws) {
  if (ws <= 0) return 0;
  const gross = ws * 1.35;   // peak core lift is well above the layer-mean w*
  const net = gross - 1.15;  // glider sink + circling inefficiency
  return Math.max(0, net);
}

/** 0..5 star rating from net climb rate (m/s). */
export function stars(net) {
  if (net <= 0.1) return 0;
  if (net < 0.6) return 1;
  if (net < 1.2) return 2;
  if (net < 1.8) return 3;
  if (net < 2.6) return 4;
  return 5;
}

/**
 * Compute the derived soaring block for one hour.
 * @param {Object} hr    normalised hour from meteo.js
 * @param {number} terrain  model cell terrain height, m MSL
 */
export function deriveHour(hr, terrain) {
  // Mixed-layer depth: prefer the model's boundary-layer height; otherwise the
  // dry-adiabat top from the sounding (lets models without BL height still work).
  let zi = hr.blHeight;
  if (zi == null && hr.levels && hr.levels.length) {
    const top = dryThermalTopMSL(hr.t2m, terrain, hr.levels.map((l) => ({ h: l.z, t: l.t })));
    if (top != null) zi = Math.max(0, top - terrain);
  }
  const thermalTop = zi != null ? terrain + zi : null;   // m MSL
  const lcl = lclAgl(hr.t2m, hr.td2m);
  const cloudBase = lcl != null ? terrain + lcl : null;  // m MSL

  // Cumulus form only if condensation happens *inside* the convective layer.
  const cumulus = lcl != null && zi != null && lcl < zi && (hr.cloudLow ?? 0) > 8;
  const workingTop = cumulus ? Math.min(thermalTop, cloudBase) : thermalTop;

  const ws = wStar(hr, zi);
  const net = climbRate(ws);
  const rating = stars(net);

  // Usable working band above launch-ish ground (top minus terrain).
  const band = workingTop != null ? Math.max(0, workingTop - terrain) : 0;

  return {
    terrain,
    thermalTop,      // m MSL — top of the mixed layer
    cloudBase,       // m MSL — cu base (null/above-top ⇒ blue)
    workingTop,      // m MSL — effective ceiling you can climb to
    cumulus,         // boolean
    blDepth: zi,     // m AGL
    lcl,             // m AGL
    wStar: ws,       // m/s
    climb: net,      // m/s net
    stars: rating,   // 0..5
    band,            // m — height of the working window
    overdevelopment: overdevelopmentRisk(hr),
    flyable: flyability(hr, { net, band, terrain }),
  };
}

/** 0..100 over-development / thunderstorm risk from CAPE, LI and mid cloud. */
export function overdevelopmentRisk(hr) {
  const cape = hr.cape ?? 0;
  const li = hr.liftedIndex ?? 5;
  let r = 0;
  r += Math.min(60, cape / 25);              // 1500 J/kg ⇒ ~60
  if (li < 0) r += Math.min(30, -li * 6);    // negative LI ⇒ instability
  r += Math.min(20, (hr.cloudMid ?? 0) / 5); // spreading mid cloud
  if ((hr.precip ?? 0) > 0.1) r += 20;
  return Math.max(0, Math.min(100, Math.round(r)));
}

/**
 * Flyability 0..100 for free-flight: reward strong-but-not-violent thermals and
 * a tall working band; penalise strong surface wind, gust spread, overcast and
 * over-development. Returns {score, label}.
 */
export function flyability(hr, { net, band }) {
  const wind = hr.wind10 ?? 0;
  const gust = hr.gust10 ?? wind;
  const cloud = hr.cloudTotal ?? 0;

  // Thermal component (0..45): best around ~1.5–2 m/s net.
  let thermal = Math.min(45, net * 22);

  // Band component (0..25): a 1500 m+ working window is excellent.
  const bandScore = Math.min(25, band / 60);

  // Wind penalty (paragliders): comfortable ≤18, marginal to ~28, no-go beyond.
  let windPen = 0;
  if (wind > 18) windPen += (wind - 18) * 2.2;
  if (gust - wind > 12) windPen += (gust - wind - 12) * 1.5; // gusty = rough
  if (wind > 32) windPen += 30; // hard cap: too strong to launch

  // Sky penalty: overcast kills thermals; over-development is dangerous.
  const cloudPen = cloud > 70 ? (cloud - 70) * 0.6 : 0;
  const odPen = overdevelopmentRisk(hr) > 55 ? 25 : 0;
  const rainPen = (hr.precip ?? 0) > 0.2 ? 40 : 0;

  const score = Math.max(0, Math.min(100, Math.round(
    thermal + bandScore - windPen - cloudPen - odPen - rainPen
  )));

  let label = 'No-go';
  if (score >= 75) label = 'Epic';
  else if (score >= 55) label = 'Good';
  else if (score >= 35) label = 'Soarable';
  else if (score >= 18) label = 'Marginal';
  return { score, label };
}

/**
 * Daylight-hour summary for a day: the peak of the day plus the soarable window.
 * @param {Array} hours   hours for one day (normalised)
 * @param {number} terrain
 */
export function summariseDay(hours, terrain) {
  let best = null, bestHour = null;
  let firstSoarable = null, lastSoarable = null;
  let maxTop = 0, maxClimb = 0;
  for (const hr of hours) {
    const d = deriveHour(hr, terrain);
    if (d.workingTop) maxTop = Math.max(maxTop, d.workingTop);
    maxClimb = Math.max(maxClimb, d.climb);
    if (d.climb >= 0.5) {
      if (firstSoarable == null) firstSoarable = hr.hourOfDay;
      lastSoarable = hr.hourOfDay;
    }
    if (best == null || d.flyable.score > best.flyable.score) { best = d; bestHour = hr; }
  }
  return { best, bestHour, maxTop, maxClimb, firstSoarable, lastSoarable };
}
