// trim.js — compare readings to the target and turn deltas into adjustment advice.
//
// Structure follows how trim shops actually model a wing (and how we-measure.io
// presents it):
//
//  • Left and right are measured SEPARATELY. A wing that turns is an asymmetric
//    wing, and that is invisible if you average the sides.
//  • A MAIN line's length is the MEAN of the suspension points hanging off it.
//    The main is what you adjust at the maillon, and it moves its whole fan.
//  • Deviations are read against a REFERENCE, not against nominal:
//        rel(x) = (reading_x - nominal_x) - (reading_ref - nominal_ref)
//    Uniform stretch is normal and barely changes handling; what flies
//    differently is how lines sit RELATIVE to each other.
//  • ANGLE OF INCIDENCE per section = rear main delta - front main delta.
//    Sign convention (industry standard): PLUS = faster / lower angle,
//    MINUS = slower / higher angle. Lengthening the rears lets the trailing
//    edge rise, which pitches the nose down and speeds the wing up.
//  • A value more than 4x tolerance from expectation is flagged implausible —
//    usually a mis-hooked line or a mistyped digit, not a real trim state.

import {
  parseLineId, isTrimmableRiser, isStructuralRiser, isBrakeRiser,
  sectionsFor, sideOf, lineOf, keyFor, sideLabel, SIDES,
} from './linemodel.js?v=12';

const median = xs => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const mean = xs => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const r1 = x => Math.round(x * 10) / 10;

/** Which main a line hangs off, per side. */
function mainIndex(session) {
  const byLine = new Map();
  for (const m of session.mains) for (const id of m.lineIds) byLine.set(id, m);
  return byLine;
}

/** Target length for a line = factory nominal + any deliberate custom offset. */
export function targetFor(session, lineId) {
  const off = session.customOffsets?.[parseLineId(lineId).riser] || 0;
  return session.nominal[lineId] + off;
}

/** Reading after any simulated main-line adjustment is applied. */
function effectiveReading(session, key, byLine) {
  const raw = session.measured[key];
  if (raw == null) return null;
  const main = byLine.get(lineOf(key));
  const sim = main ? (session.simOffsets?.[keyFor(sideOf(key), main.id)] || 0) : 0;
  return raw + sim;
}

export function analyse(session) {
  const tolInd = session.tolIndMm ?? 10;
  const tolGlobal = session.tolGlobalMm ?? 50;
  const byLine = mainIndex(session);

  // ---- raw per-line deltas (absolute, before any reference is applied) ------
  const lines = [];
  for (const key of session.order) {
    const reading = effectiveReading(session, key, byLine);
    if (reading == null) continue;
    const lineId = lineOf(key);
    const target = targetFor(session, lineId);
    lines.push({
      key, side: sideOf(key), lineId,
      riser: parseLineId(lineId).riser,
      mainId: byLine.get(lineId)?.id ?? null,
      nominal: session.nominal[lineId],
      target,
      measured: session.measured[key],
      reading,                                   // includes simulation
      delta: reading - target,
      source: session.sources?.[key] || 'manual',
    });
  }

  // ---- reference --------------------------------------------------------
  const { refDelta, refLabel } = resolveRef(session, lines);
  for (const l of lines) {
    l.rel = r1(l.delta - refDelta);
    l.delta = r1(l.delta);
    const a = Math.abs(l.rel);
    l.status = a <= tolInd ? 'good' : a <= tolInd * 2 ? 'warn' : 'bad';
    l.implausible = a > tolInd * 4;
  }

  // ---- same line, other side ---------------------------------------------
  // The sharpest single-line diagnostic there is: a main with only two lines
  // can't say WHICH one drifted (the mean sits between them), but the same line
  // on the other side is a direct like-for-like comparison.
  const pairs = new Map();
  for (const l of lines) {
    if (!pairs.has(l.lineId)) pairs.set(l.lineId, {});
    pairs.get(l.lineId)[l.side] = l;
  }
  for (const pair of pairs.values()) {
    if (!pair.L || !pair.R) continue;
    const d = r1(pair.L.delta - pair.R.delta);
    const status = Math.abs(d) <= tolInd ? 'good' : Math.abs(d) <= tolInd * 2 ? 'warn' : 'bad';
    pair.L.lrMm = d;  pair.L.lrStatus = status;
    pair.R.lrMm = -d; pair.R.lrStatus = status;
  }
  const worstLine = lines
    .filter(l => l.side === 'L' && l.lrMm != null)
    .sort((a, b) => Math.abs(b.lrMm) - Math.abs(a.lrMm))[0];
  const worstPair = worstLine && Math.abs(worstLine.lrMm) > tolInd
    ? { lineId: worstLine.lineId, mm: worstLine.lrMm,
        longer: worstLine.lrMm > 0 ? 'left' : 'right' }
    : null;

  // ---- per side: mains, sections, AoI -----------------------------------
  const perSide = {};
  for (const { id: side, label } of SIDES) {
    const sideLines = lines.filter(l => l.side === side);
    if (!sideLines.length) continue;

    const mains = session.mains.map(m => {
      const ls = sideLines.filter(l => l.mainId === m.id);
      if (!ls.length) return null;
      const nomMm = mean(ls.map(l => l.nominal));
      const rdgMm = mean(ls.map(l => l.reading));
      const deltaMm = rdgMm - mean(ls.map(l => l.target));
      const relMm = deltaMm - refDelta;
      const scatter = ls.map(l => l.delta - deltaMm);
      const spreadMm = ls.length > 1 ? Math.max(...scatter) - Math.min(...scatter) : 0;
      const outliers = ls.filter(l => Math.abs(l.delta - deltaMm) > tolInd).map(l => l.lineId);
      // On a two-line main the mean sits between the pair, so both look like
      // outliers. The same line on the other side breaks the tie.
      const pinpointed = ls
        .filter(l => outliers.includes(l.lineId) && l.lrMm != null && Math.abs(l.lrMm) > tolInd)
        .map(l => l.lineId);

      let action = 'ok', recommendMm = 0;
      if (outliers.length && spreadMm > tolInd) {
        action = 'inspect';
      } else if (Math.abs(relMm) >= tolInd / 2) {
        recommendMm = -relMm;
        action = m.trimmable ? (relMm > 0 ? 'shorten' : 'lengthen') : 'note';
      }
      return {
        ...m, side, sideLabel: label, key: keyFor(side, m.id),
        n: ls.length,
        nomMm: r1(nomMm), rdgMm: r1(rdgMm),
        deltaMm: r1(deltaMm), relMm: r1(relMm),
        spreadMm: r1(spreadMm), outliers, pinpointed,
        action, recommendMm: r1(recommendMm),
        hasLoop: (session.loops || []).includes(m.id),
        simMm: session.simOffsets?.[keyFor(side, m.id)] || 0,
      };
    }).filter(Boolean);

    // AoI per section: rear main delta - front main delta. + = faster.
    const aoi = sectionsFor(mains.filter(m => isStructuralRiser(m.riser))).map(sec => {
      const ms = sec.mains;
      if (ms.length < 2) return null;
      const front = ms[0];
      const rear = ms[ms.length - 1];
      return {
        section: sec.section,
        frontId: front.id, rearId: rear.id,
        frontRiser: front.riser, rearRiser: rear.riser,
        aoiMm: r1(rear.deltaMm - front.deltaMm),
      };
    }).filter(Boolean);

    perSide[side] = {
      side, label,
      lines: sideLines,
      mains,
      aoi,
      globalOffsetMm: r1(median(sideLines.map(l => l.delta))),
    };
  }

  // ---- left/right asymmetry ----------------------------------------------
  const asymmetry = session.mains.map(m => {
    const L = perSide.L?.mains.find(x => x.id === m.id);
    const R = perSide.R?.mains.find(x => x.id === m.id);
    if (!L || !R) return null;
    const diffMm = r1(L.deltaMm - R.deltaMm);
    return {
      mainId: m.id, label: m.label, riser: m.riser,
      leftMm: L.deltaMm, rightMm: R.deltaMm, diffMm,
      status: Math.abs(diffMm) <= tolInd ? 'good'
            : Math.abs(diffMm) <= tolInd * 2 ? 'warn' : 'bad',
    };
  }).filter(Boolean);

  const turn = turnTendency(asymmetry, tolInd);

  // ---- recommendations ----------------------------------------------------
  const recommendations = [];
  for (const side of ['L', 'R']) {
    for (const m of perSide[side]?.mains || []) {
      if (m.action !== 'ok') recommendations.push(m);
    }
  }

  const globalOffsetMm = r1(median(lines.map(l => l.delta)));
  const globalWithinTol = Math.abs(globalOffsetMm) <= tolGlobal;

  const integrity = {
    laser: lines.filter(l => l.source === 'laser').length,
    manual: lines.filter(l => l.source === 'manual').length,
    imported: lines.filter(l => l.source === 'imported').length,
    implausible: lines.filter(l => l.implausible).map(l => l.key),
    editedAfterComplete: !!session.editedAfterComplete,
    simulating: Object.values(session.simOffsets || {}).some(v => v),
  };

  const verdict = buildVerdict({
    recommendations, asymmetry, turn, globalOffsetMm, globalWithinTol, integrity,
    measured: lines.length, total: session.order.length, tolInd,
    worstPair,
  });

  return {
    lines, perSide, asymmetry, turn, recommendations,
    worstPair,
    refDelta: r1(refDelta), refLabel,
    globalOffsetMm, globalWithinTol,
    tolInd, tolGlobal, integrity, verdict,
    measuredCount: lines.length, totalCount: session.order.length,
  };
}

function resolveRef(session, lines) {
  const mode = session.refMode || 'auto';
  if (mode === 'absolute') return { refDelta: 0, refLabel: 'Nominal (absolute)' };
  if (mode.startsWith('main:')) {
    const [, side, mainId] = mode.split(':');
    const ls = lines.filter(l => l.side === side && l.mainId === mainId);
    if (ls.length) {
      return { refDelta: mean(ls.map(l => l.delta)), refLabel: `${sideLabel(side)} ${mainId}` };
    }
  }
  return { refDelta: median(lines.map(l => l.delta)), refLabel: 'Auto (median of all lines)' };
}

function turnTendency(asymmetry, tolInd) {
  // A shorter brake (or shorter rear) on one side raises drag on that side and
  // pulls the wing toward it. Report only when it is big enough to matter.
  const brake = asymmetry.find(a => isBrakeRiser(a.riser));
  const rears = asymmetry.filter(a => isTrimmableRiser(a.riser));
  const rear = rears.length ? rears[rears.length - 1] : null;
  const driver = brake && Math.abs(brake.diffMm) > Math.abs(rear?.diffMm ?? 0) ? brake : rear;
  if (!driver || Math.abs(driver.diffMm) <= tolInd) return null;
  // diffMm = left - right. Negative => left is shorter => turns left.
  const toward = driver.diffMm < 0 ? 'left' : 'right';
  return {
    mm: Math.abs(driver.diffMm),
    mainId: driver.mainId,
    label: driver.label,
    toward,
    note: `${driver.label} is ${Math.abs(driver.diffMm)} mm shorter on the ${toward} — `
        + `that side sits at a higher angle and drags, which turns the wing ${toward}.`,
  };
}

function buildVerdict({ recommendations, asymmetry, turn, globalOffsetMm,
                        globalWithinTol, integrity, measured, total, tolInd, worstPair }) {
  // nothing measured is not "in trim": say so instead of a green verdict
  if (!measured) return { level: 'none', title: 'No readings yet', detail: `Measure the lines — ${total} readings — and the result builds up here as you go.` };
  const partial = measured < total;
  const inspect = recommendations.filter(r => r.action === 'inspect');
  const adjust = recommendations.filter(r => r.action === 'shorten' || r.action === 'lengthen');
  const notes = recommendations.filter(r => r.action === 'note');
  const asym = asymmetry.filter(a => a.status !== 'good');

  const name = r => `${r.sideLabel} ${r.label}`;
  let level = 'good';
  let title = 'In factory trim';
  let detail = 'Every main is within tolerance on both sides. No adjustment needed.';

  if (integrity.implausible.length) {
    level = 'bad';
    title = 'Implausible readings';
    detail = `${integrity.implausible.length} reading(s) are more than ${tolInd * 4} mm from `
           + `expectation — that is usually a mis-hooked line or a typo, not a trim state. `
           + `Re-measure those before reading anything else here.`;
  } else if (inspect.length) {
    level = 'bad';
    title = 'Inspect before flying';
    detail = `Uneven wear on ${inspect.map(name).join(', ')} — individual lines are off by `
           + `more than tolerance from their siblings. A maillon adjustment moves the whole `
           + `fan and cannot fix this; check those lines for shrinkage or damage.`;
    if (worstPair) {
      detail += `  Sharpest single-line signal: ${worstPair.lineId} is `
              + `${Math.abs(worstPair.mm)} mm longer on the ${worstPair.longer} than the other side — `
              + `start there.`;
    }
    if (adjust.length) detail += `  ${adjust.map(name).join(', ')} also need a main adjustment afterwards.`;
  } else if (turn) {
    level = 'warn';
    title = `Asymmetric — turns ${turn.toward}`;
    detail = turn.note;
    if (adjust.length) detail += `  Also: ${adjust.map(name).join(', ')}.`;
  } else if (adjust.length) {
    level = 'warn';
    title = 'Trim adjustment recommended';
    detail = `${adjust.map(name).join(', ')} out of relative trim. Apply the main-line changes below.`;
  } else if (asym.length) {
    level = 'warn';
    title = 'Left/right asymmetry';
    detail = `${asym.map(a => a.label).join(', ')} differ between sides by more than tolerance.`;
  } else if (notes.length) {
    level = 'warn';
    title = 'Check ' + [...new Set(notes.map(r => r.label))].join(', ');
    detail = `Main risers are in trim, but ${notes.map(name).join(', ')} sits outside tolerance.`;
  } else if (!globalWithinTol) {
    level = 'warn';
    title = 'Whole set out of range';
    detail = `Every line sits about ${Math.abs(globalOffsetMm)} mm `
           + `${globalOffsetMm > 0 ? 'longer' : 'shorter'} than nominal — beyond the global allowance.`;
  } else if (Math.abs(globalOffsetMm) > 0) {
    detail = `Relative trim is good on both sides. The whole set sits ${Math.abs(globalOffsetMm)} mm `
           + `${globalOffsetMm > 0 ? 'long' : 'short'} — within the global allowance, correction optional.`;
  }

  if (partial) {
    detail += `  (Only ${measured} of ${total} readings taken — result is partial.)`;
    if (level === 'good') title = 'Partial — looks good so far';
  }
  if (integrity.simulating) {
    detail += `  Showing a SIMULATED adjustment, not the measured wing.`;
  }
  return { level, title, detail };
}

/**
 * How to make a main-line change, in words. Qualitative: the length one loop
 * takes up depends on line diameter and maillon size, so this never promises a
 * count — it says where to work and to re-measure.
 */
export function adjustHint(mm, hasLoop) {
  const dir = mm < 0 ? 'shorten' : 'lengthen';
  const size = Math.abs(mm) < 8 ? 'a small change' : Math.abs(mm) < 18 ? 'about one loop' : 'more than one loop';
  return hasLoop
    ? `${dir} at this main's trim loop (${size}), then re-measure its lines`
    : `${dir} at the maillon (larks-head / trim knot, ${size}), then re-measure its lines`;
}

/** Plain-language reading of an AoI number. + = faster. */
export function aoiNote(aoiMm, tolInd) {
  if (Math.abs(aoiMm) <= tolInd / 2) return 'at the factory angle of incidence';
  return aoiMm > 0
    ? `${aoiMm} mm FASTER than factory — rears sit long relative to the A's, so the nose is `
      + `trimmed down. More speed, less pitch damping, more collapse-prone.`
    : `${Math.abs(aoiMm)} mm SLOWER than factory — rears sit short relative to the A's, so the `
      + `wing flies at a higher angle. Softer and more collapse-resistant, but closer to stall `
      + `and with less brake travel.`;
}
