// gauges.js — the 737 overhead gauges, face by face, so they read the way
// they do in the airplane (zero where the real one puts it, the same
// direction of travel, the same non-linear scales). Built on overhead.js's
// dial(); each takes a panel P, a centre, a radius and value functions.

const range = (a, b, step) => { const out = []; for (let v = a; v <= b + 1e-9; v += step) out.push(+v.toFixed(3)); return out; };

/** Bleed DUCT PRESS: two needles (L, R), 0 at bottom-right, clockwise to 80 at top-right. */
export function ductPress(P, x, y, r, fnL, fnR) {
  const pts = [[0, 135], [80, 405]];
  return P.dial(x, y, r, {
    bezel: 'teardrop', hub: 0.24, hubRing: true,
    scales: [{
      pts, r0: 0.97,
      ticks: [...range(0, 80, 5).map((v) => [v, v % 20 ? 0.12 : 0.2, v % 20 ? 1 : 1.6])],
      labels: [[0, '0'], [20, '20'], [40, '40'], [60, '60'], [80, '80']], lr: 0.62, lfs: r * 0.2,
    }],
    texts: [[0.5, -0.12, 'DUCT\nPRESS\nPSI', r * 0.13, 'middle']],
    needles: [{ fn: fnL, len: 0.82, w: 2.4, tag: 'L' }, { fn: fnR, len: 0.82, w: 2.4, tag: 'R' }],
  });
}

/** FUEL TEMP: 0 at the top, −50 … +50 °C, fine graduations, big hub. */
export function fuelTemp(P, x, y, r, fn) {
  const pts = [[-50, -112.5], [50, 112.5]];
  return P.dial(x, y, r, {
    hub: 0.3, hubRing: true,
    scales: [{
      pts, r0: 0.97,
      ticks: range(-50, 50, 2).map((v) => [v, v % 10 ? 0.11 : 0.2, v % 10 ? .8 : 1.5]),
      labels: [[-40, '-40'], [-20, '-20'], [0, '0'], [20, '+20'], [40, '+40']], lr: 0.66, lfs: r * 0.17,
    }],
    texts: [[0, -0.56, 'FUEL\nTEMP', r * 0.11], [0, 0.6, '°C', r * 0.13]],
    needles: [{ fn, len: 0.84, w: 3.2, tail: 0.1 }],
  });
}

/**
 * CABIN ALT / DIFF PRESS: one dial, two scales. Outer DIFF PRESS 0–10 psi
 * clockwise from the top (amber band and the red 9.1 limit); inner CABIN ALT
 * ×1000 ft, linear to 30 then compressed to 50. Short wide needle = cabin
 * altitude, long thin needle = differential.
 */
export function cabinAltDiff(P, x, y, r, fnAlt, fnDiff) {
  const diff = [[0, 0], [10, 330]];
  const alt = [[0, 0], [30, 270], [35, 290], [40, 308], [50, 334]];
  return P.dial(x, y, r, {
    bezel: 'octagon', hub: 0.17,
    scales: [
      {
        pts: diff, r0: 0.86, ring: 0.7,
        ticks: range(0, 10, 0.25).map((v) => [v, v % 1 ? 0.07 : 0.13, v % 1 ? .7 : 1.4]),
        labels: range(0, 10, 1).map((v) => [v, String(v)]), lr: 0.93, lfs: r * 0.11,
        bands: [[8.6, 9.05, '#ffad1f', 3.5], [9.05, 9.15, '#e5322b', 4]],
      },
      {
        pts: alt, r0: 0.69,
        ticks: [...range(0, 30, 1), 35, 40, 45, 50].map((v) => [v, v % 5 ? 0.05 : 0.1, v % 5 ? .6 : 1.2]),
        labels: [0, 5, 10, 15, 20, 25, 30, 35, 40, 50].map((v) => [v, String(v)]), lr: 0.5, lfs: r * 0.1,
      },
    ],
    texts: [[0, -0.27, 'CABIN\nALT', r * 0.09], [0, 0.3, 'X 1000 FEET', r * 0.075], [-0.2, -0.79, 'DIFF PRESS\nPSI', r * 0.07]],
    needles: [
      { fn: fnDiff, scale: 0, len: 0.88, w: 1.8, tail: 0.18 },
      { fn: fnAlt, scale: 1, len: 0.52, w: 3.4, tail: 0.1 },
    ],
  });
}

/** CABIN CLIMB (VSI style): 0 at 9 o'clock, UP above, DN below, to 4 at 3 o'clock; ×1000 ft/min. */
export function cabinClimb(P, x, y, r, fn) {
  const up = [[0, -90], [0.5, -45], [1, -5], [2, 35], [3, 62], [4, 90]];
  const pts = [...up.slice(1).reverse().map(([v, a]) => [-v, 180 - a]).map(([v, a]) => [v, a - 360]), ...up];
  // Down side mirrors the up side across the horizontal; written as negative
  // values on a continuous angle range (−270 … 90) so interpolation is smooth.
  const ticks = [];
  for (const v of [...range(0, 1, 0.1), 1.5, 2, 2.5, 3, 3.5, 4]) {
    const major = [0, 0.5, 1, 2, 3, 4].includes(v);
    ticks.push([v, major ? 0.16 : 0.09, major ? 1.3 : .7]);
    if (v) ticks.push([-v, major ? 0.16 : 0.09, major ? 1.3 : .7]);
  }
  const lab = [[0.5, '.5'], [1, '1'], [2, '2'], [3, '3'], [4, '4']];
  return P.dial(x, y, r, {
    hub: 0.22,
    scales: [{
      pts, r0: 0.97, ticks,
      labels: [[0, '0'], ...lab, ...lab.filter(([v]) => v < 4).map(([v, t]) => [-v, t])], lr: 0.68, lfs: r * 0.15,
    }],
    texts: [[0, -0.32, 'CABIN CLIMB', r * 0.1], [0, 0.42, '1000 FEET PER MIN', r * 0.085, 'middle', '#5c8dff'],
      [-0.86, -0.2, 'UP', r * 0.09, 'start'], [-0.86, 0.3, 'DN', r * 0.09, 'start']],
    needles: [{ fn, len: 0.8, w: 2.6, tail: 0.1 }],
  });
}

/** Outflow VALVE position: half dial, CLOSE on the left to OPEN on the right. */
export function valvePosition(P, x, y, r, fn) {
  return P.dial(x, y, r, {
    bezel: 'half', hub: 0.12,
    scales: [{
      pts: [[0, -70], [100, 70]], r0: 0.95,
      ticks: range(0, 100, 10).map((v) => [v, v % 50 ? 0.14 : 0.24, v % 50 ? .9 : 1.5]),
    }],
    needles: [{ fn, len: 0.84, w: 2, tail: 0.1 }],
  });
}
