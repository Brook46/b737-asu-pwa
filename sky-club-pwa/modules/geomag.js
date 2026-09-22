// geomag.js — magnetic declination from the World Magnetic Model 2025.
//
// A phone compass points at MAGNETIC north; the sky is laid out around TRUE
// north. The gap (declination) is ~5° in Israel, ~13° in California, over 20°
// in parts of Canada — at 5° a star sits a whole finger-width off where you're
// pointing, so Sky mode corrects for it the same way SkyView does (Android's
// GeomagneticField is this same model). Plain spherical-harmonic synthesis,
// degree 12, no dependencies; coefficients live in wmm2025.js.

import { WMM_EPOCH, G, H, GDOT, HDOT } from './wmm2025.js?v=22';

const N_MAX = 12;
const A_REF = 6371.2;          // geomagnetic reference radius, km
const WGS_A = 6378.137;        // WGS-84 semi-major axis, km
const WGS_F = 1 / 298.257223563;
const E2 = WGS_F * (2 - WGS_F);
const DEG = Math.PI / 180;

function decimalYear(date) {
  const y = date.getUTCFullYear();
  const start = Date.UTC(y, 0, 1), end = Date.UTC(y + 1, 0, 1);
  return y + (date.getTime() - start) / (end - start);
}

/**
 * Declination in degrees, east-positive: true bearing = magnetic bearing + D.
 * `altKm` is height above the ellipsoid; ground level is fine for a phone.
 */
export function declination(latDeg, lonDeg, date = new Date(), altKm = 0) {
  const dt = decimalYear(date) - WMM_EPOCH;
  const phi = latDeg * DEG, lam = lonDeg * DEG;

  // Geodetic → geocentric spherical.
  const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
  const rc = WGS_A / Math.sqrt(1 - E2 * sinPhi * sinPhi);
  const p = (rc + altKm) * cosPhi;
  const z = (rc * (1 - E2) + altKm) * sinPhi;
  const r = Math.hypot(p, z);
  const phiC = Math.asin(z / r);

  // Schmidt semi-normalised Legendre functions of cos(colatitude) = sin(phiC),
  // with derivatives taken w.r.t. colatitude θ.
  const x = Math.sin(phiC), s = Math.cos(phiC);
  const P = [], dP = [];
  for (let n = 0; n <= N_MAX; n++) { P.push(new Float64Array(n + 1)); dP.push(new Float64Array(n + 1)); }
  P[0][0] = 1;
  for (let n = 1; n <= N_MAX; n++) {
    for (let m = 0; m < n; m++) {
      const k = Math.sqrt(n * n - m * m);
      const k2 = n >= 2 && m <= n - 2 ? Math.sqrt((n - 1) * (n - 1) - m * m) : 0;
      const pPrev2 = k2 ? P[n - 2][m] : 0, dPrev2 = k2 ? dP[n - 2][m] : 0;
      P[n][m] = ((2 * n - 1) * x * P[n - 1][m] - k2 * pPrev2) / k;
      dP[n][m] = ((2 * n - 1) * (x * dP[n - 1][m] - s * P[n - 1][m]) - k2 * dPrev2) / k;
    }
    if (n === 1) { P[1][1] = s; dP[1][1] = x; }
    else {
      const c = Math.sqrt((2 * n - 1) / (2 * n));
      P[n][n] = c * s * P[n - 1][n - 1];
      dP[n][n] = c * (s * dP[n - 1][n - 1] + x * P[n - 1][n - 1]);
    }
  }

  let bx = 0, by = 0, bz = 0; // geocentric north / east / down
  const ratio = A_REF / r;
  let rn = ratio * ratio; // (a/r)^(n+2) starts at n=1 → ratio^3
  for (let n = 1; n <= N_MAX; n++) {
    rn *= ratio;
    for (let m = 0; m <= n; m++) {
      const idx = (n * (n + 1)) / 2 + m;
      const g = G[idx] + dt * GDOT[idx];
      const h = H[idx] + dt * HDOT[idx];
      const cm = Math.cos(m * lam), sm = Math.sin(m * lam);
      const gh = g * cm + h * sm;
      bx += rn * gh * dP[n][m]; // north = +(1/r)∂V/∂θ, since θ grows southward
      by += rn * m * (g * sm - h * cm) * P[n][m];
      bz += -(n + 1) * rn * gh * P[n][m];
    }
  }
  // At the poles cos(phiC) → 0; the east component is a 0/0 limit there. The
  // app never needs a polar declination badly enough to special-case it.
  by = s > 1e-8 ? by / s : by;

  // Rotate north component back to the geodetic frame (a fraction of a degree).
  const psi = phiC - phi;
  const north = bx * Math.cos(psi) - bz * Math.sin(psi);
  return Math.atan2(by, north) / DEG;
}
