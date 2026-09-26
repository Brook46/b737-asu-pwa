// porosity.js — the fabric porosity check, per the PMA Standard "Periodical
// Inspection of Paragliders" V 2024.12.1, §5.2:
//
//   · unit: litres per m² per minute (l/m²/min) at 20 mbar;
//   · the planform is split into four spanwise zones; at least one reading in
//     each, on the TOP sail, 5–30% of the local chord from the leading edge,
//     air flowing from inside the canopy out; not at the centre cell(s); readings
//     at least 4 cells apart;
//   · pass: every zone's average below 540 l/m²/min;
//     rating: > 540 Fail · 360–540 Acceptable · < 360 Good.
//   · the standard recommends reporting the rating, not the value (fabrics
//     compare badly), so the report shows ratings; the app keeps the values.
//
// Cell numbers, when given, count out from the centre on each side.
// A JDC MK1/MK2 gives seconds at 10 mbar; its manual's conversion, quoted by the
// standard, is l/m²/min = 5400 / seconds (10 s = 540, 15 s = 360).

export const LIMIT_FAIL = 540;       // l/m²/min — at or above: fail
export const LIMIT_GOOD = 360;       // below: good

/** Zones, pilot's view, left tip to right tip. */
export const ZONES = [
  { id: 'L-out', label: 'Left outer', side: 'L' },
  { id: 'L-in', label: 'Left inner', side: 'L' },
  { id: 'R-in', label: 'Right inner', side: 'R' },
  { id: 'R-out', label: 'Right outer', side: 'R' },
];

export const UNITS = [
  { id: 'lpm', label: 'l/m²/min at 20 mbar', short: 'l/m²/min' },
  { id: 'jdc', label: 'Seconds — JDC MK1 / MK2 (10 mbar)', short: 's' },
];

/** A reading in its device unit → l/m²/min at 20 mbar. */
export function toLpm(value, unit) {
  const v = Number(value);
  if (!Number.isFinite(v) || v <= 0) return null;
  return unit === 'jdc' ? 5400 / v : v;
}

export function rate(lpm) {
  if (lpm == null) return null;
  return lpm >= LIMIT_FAIL ? 'fail' : lpm >= LIMIT_GOOD ? 'acceptable' : 'good';
}
export const RATING_LABEL = { good: 'Good', acceptable: 'Acceptable', fail: 'Fail' };
/** For the app's status colours: good / warn / bad. */
export const RATING_STATUS = { good: 'good', acceptable: 'warn', fail: 'bad' };

/** The porosity block on a check, created on first use. */
export function porosityOf(session) {
  if (!session.porosity) session.porosity = { unit: 'lpm', readings: [] };
  return session.porosity;
}

export function addReading(session, zone, value, { cell = null } = {}) {
  const p = porosityOf(session);
  const v = Number(value);
  if (!ZONES.some(z => z.id === zone) || !Number.isFinite(v) || v <= 0) return null;
  const r = { id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, zone, value: v, unit: p.unit, cell: cell ?? null };
  p.readings.push(r);
  return r;
}

export function removeReading(session, id) {
  const p = porosityOf(session);
  p.readings = p.readings.filter(r => r.id !== id);
}

/**
 * Per zone: readings, average in l/m²/min, rating; overall: complete (every zone
 * has a reading), passed, and the worst rating. Each reading keeps the unit it
 * was taken in, so changing the device later doesn't reinterpret old numbers.
 */
export function porositySummary(session) {
  const p = session.porosity;
  if (!p || !p.readings?.length) return null;
  const zones = ZONES.map(z => {
    const rs = p.readings.filter(r => r.zone === z.id);
    const lpms = rs.map(r => toLpm(r.value, r.unit)).filter(v => v != null);
    const avg = lpms.length ? lpms.reduce((a, b) => a + b, 0) / lpms.length : null;
    return { ...z, readings: rs, n: lpms.length, avgLpm: avg == null ? null : Math.round(avg), rating: rate(avg) };
  });
  const complete = zones.every(z => z.n > 0);
  const order = ['good', 'acceptable', 'fail'];
  const worst = zones.filter(z => z.rating).reduce((w, z) => (order.indexOf(z.rating) > order.indexOf(w) ? z.rating : w), 'good');
  // cells are counted out from the centre on each side, so spacing is per side
  const tooClose = ['L', 'R'].some(side => {
    const cells = p.readings.filter(r => r.cell != null && r.zone.startsWith(side)).map(r => r.cell).sort((a, b) => a - b);
    return cells.some((c, i) => i && c - cells[i - 1] < 4);
  });
  return {
    zones, complete, worst,
    passed: complete && zones.every(z => z.rating !== 'fail'),
    count: p.readings.length,
    notes: [
      !complete ? `${zones.filter(z => !z.n).map(z => z.label).join(', ')}: no reading yet — the standard needs at least one in every zone.` : null,
      tooClose ? 'Some readings are less than 4 cells apart — the standard asks for at least 4.' : null,
    ].filter(Boolean),
  };
}
