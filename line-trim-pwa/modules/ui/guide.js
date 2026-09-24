// ui/guide.js — how to change a line's length, and the order to do it in.
//
// Reference: the PMA Standard "Periodical Inspection of Paragliders"
// (V 2024.12.1), Appendix B "Line length modification options" — the list the
// manufacturers' association recommends — plus Ozone's manuals ("a loop on the
// maillon of the appropriate length"; trim loops on C lines). Measuring rules
// come from the same standard, §5.5. Other modifications, knots in a line
// included, are not recommended there, so they aren't taught here.
//
// Drawings follow the PMA photos: the line comes in from the left with its sewn
// end loop (zig-zag stitching), the connector's bar stands on the right.
// Take-up per loop depends on the line and connector; the typical figures quoted
// are one workshop's and are labelled as such — the app's re-measure is the truth.

import { $, el, clear } from './dom.js?v=15';
import { icon } from './icons.js?v=15';

// ---- drawing kit ------------------------------------------------------------
const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="gd-steel" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#7d8790"/><stop offset=".45" stop-color="#eef1f3"/><stop offset="1" stop-color="#6f7880"/></linearGradient>
  <linearGradient id="gd-steel-h" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#eef1f3"/><stop offset=".5" stop-color="#9aa3ab"/><stop offset="1" stop-color="#d7dce1"/></linearGradient>
  <linearGradient id="gd-dyneema" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#b9bcaf"/><stop offset=".5" stop-color="#f3f4ec"/><stop offset="1" stop-color="#a9ad9e"/></linearGradient>
</defs></svg>`;

const W = 368, H = 196, BAR = 172, MID = 85, LINK_H = 130;   // link fixed; labels get the strip below     // one panel; the connector's near bar; line height
const RED = '#d23a3a', RED_DK = '#7e1a1a';

/** A braided line: dark edge, solid core, fine weave. */
function cord(d, { c = RED, dk = RED_DK, w = 9 } = {}) {
  return `<path d="${d}" fill="none" stroke="${dk}" stroke-width="${w + 2.4}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="${c}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="#fff" stroke-opacity=".3" stroke-width="1.4" stroke-dasharray="2 3" stroke-linecap="round"/>`;
}
/** The line coming in from the left, its sewn end marked by white zig-zag stitching. */
function stitched(x1, y = MID) {
  const x0 = x1 - 70;
  let z = `M${x0} ${y}`;
  for (let x = x0, up = true; x < x1; x += 6, up = !up) z += ` L${x + 6} ${y + (up ? 2.6 : -2.6)}`;
  return cord(`M-10 ${y} H${x1}`) + `<path d="${z}" fill="none" stroke="#fff" stroke-width="1.4"/>`;
}
/** The connector: a steel quick-link (its near bar on the left), or a Dyneema soft link. */
function connector(soft = false) {
  if (soft) {
    let s = '';
    for (const dx of [-5, 0, 5]) s += `<rect x="${BAR - 8 + dx}" y="20" width="190" height="${LINK_H}" rx="44" fill="none" stroke="#8d9383" stroke-width="7"/>
      <rect x="${BAR - 8 + dx}" y="20" width="190" height="${LINK_H}" rx="44" fill="none" stroke="url(#gd-dyneema)" stroke-width="5"/>`;
    return s;
  }
  return `<rect x="${BAR - 8}" y="20" width="190" height="${LINK_H}" rx="44" fill="none" stroke="#4d565e" stroke-width="17"/>
    <rect x="${BAR - 8}" y="20" width="190" height="${LINK_H}" rx="44" fill="none" stroke="url(#gd-steel)" stroke-width="14"/>
    <rect x="${BAR + 60}" y="9" width="44" height="22" rx="4" fill="url(#gd-steel-h)" stroke="#4d565e"/>
    <path d="M${BAR + 68} 9 v22 M${BAR + 76} 9 v22 M${BAR + 84} 9 v22 M${BAR + 92} 9 v22" stroke="#4d565e" stroke-width=".8"/>`;
}
const X = BAR - 8;                    // the bar's centre line
/**
 * A wrap round the bar: a short band crossing in front of it, bowed like a strand
 * round a cylinder, with a dark end where it turns away behind the bar.
 */
const across = (y0, y1) => cord(`M${X - 17} ${y0} Q${X - 2} ${(y0 + y1) / 2 + 5} ${X + 10} ${y1}`)
  + `<circle cx="${X + 10}" cy="${y1}" r="4.4" fill="${RED_DK}"/>`;
/** A strand leaving the line's end and reaching the bar at height y. */
const leg = (xs, y) => cord(`M${xs} ${MID} C${xs + 26} ${MID} ${X - 40} ${y} ${X - 17} ${y}`);
/** The loop's turn on the far side of the bar (visible inside the link). */
const turn = (y0, y1, out = 30) => cord(`M${X + 22} ${y0} C${X + 22 + out} ${y0} ${X + 22 + out} ${y1} ${X + 22} ${y1}`);

function label(x1, y1, x2, y2, t, anchor = 'start') {
  return `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="var(--ink-3)" stroke-width="1"/>
    <circle cx="${x1}" cy="${y1}" r="2.2" fill="var(--ink-3)"/>
    <text x="${x2 + (anchor === 'start' ? 3 : -3)}" y="${y2 + 4}" font-size="11.5" font-weight="600" fill="var(--ink-2)" text-anchor="${anchor}">${t}</text>`;
}

/**
 * Each hitch as [behind, in front]: what passes behind the bar is drawn before the
 * connector, what crosses in front of it after — that ordering is what makes the
 * difference between the options visible.
 */
const LY = H - 14;                 // label strip under the link
const HITCH = {
  open: () => [
    cord(`M${X - 17} ${MID - 12} H${X + 22}`) + cord(`M${X - 17} ${MID + 12} H${X + 22}`),
    stitched(96) + leg(96, MID - 12) + leg(96, MID + 12) + turn(MID - 12, MID + 12)
      + label(60, MID - 3, 24, LY, 'sewn end loop') + label(X + 44, MID + 8, W - 8, LY, 'hangs through the link', 'end'),
  ],
  one: () => [
    cord(`M${X - 17} ${MID - 14} H${X + 22}`),
    stitched(96) + leg(96, MID - 14) + leg(96, MID + 14) + turn(MID - 14, MID + 12, 24) + across(MID + 14, MID - 10)
      + label(X - 4, MID + 4, W - 8, LY, 'one loop round the bar', 'end'),
  ],
  larks: () => [
    '',
    stitched(108) + cord(`M108 ${MID} C${X - 42} ${MID} ${X - 40} ${MID - 13} ${X - 17} ${MID - 13}`) + cord(`M108 ${MID} C${X - 42} ${MID} ${X - 40} ${MID + 13} ${X - 17} ${MID + 13}`)
      + across(MID - 13, MID - 13) + across(MID + 13, MID + 13)
      + label(X - 2, MID + 18, W - 8, LY, 'two wraps, collar behind', 'end'),
  ],
  turns: () => [
    '',
    stitched(96) + leg(96, MID - 22) + leg(96, MID + 22)
      + across(MID + 22, MID + 8) + across(MID + 7, MID - 7) + across(MID - 8, MID - 22)
      + label(X - 2, MID + 26, W - 8, LY, 'wound round twice, turns side by side', 'end'),
  ],
  larksLoop: () => [
    '',
    stitched(100) + cord(`M100 ${MID} C${X - 42} ${MID} ${X - 40} ${MID - 20} ${X - 17} ${MID - 20}`) + cord(`M100 ${MID} C${X - 42} ${MID} ${X - 40} ${MID + 6} ${X - 17} ${MID + 6}`)
      + across(MID - 20, MID - 20) + across(MID + 6, MID + 6)
      + cord(`M${X - 17} ${MID + 6} C${X - 34} ${MID + 12} ${X - 34} ${MID + 30} ${X - 17} ${MID + 30}`) + across(MID + 30, MID + 22)
      + label(X - 2, MID + 34, W - 8, LY, 'lark\'s foot + one more wrap', 'end'),
  ],
};

const panel = (key, caption, { soft = false } = {}) => {
  const [behind, front] = HITCH[key]();
  return `<figure class="fig-panel"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${caption}">${behind}${connector(soft)}${front}</svg><figcaption>${caption}</figcaption></figure>`;
};

/** Relative take-up, as a strip of steps — no invented numbers on it. */
function ladder() {
  const steps = [['Open', 0], ['1 loop', 1], ['Lark\'s foot', 2], ['2 turns', 3], ['Lark\'s foot + loop', 4]];
  return `<svg viewBox="0 0 520 112" class="ladder" role="img" aria-label="The options in order of how much they shorten the line">
    ${steps.map(([t, n], i) => {
      const x = 12 + i * 102, h = 10 + n * 13;
      return `<rect x="${x}" y="${86 - h}" width="84" height="${h}" rx="4" fill="var(--row-A)" opacity="${0.35 + n * 0.15}"/>
        <text x="${x + 42}" y="104" text-anchor="middle" font-size="11" font-weight="600" fill="var(--ink-2)">${t}</text>`;
    }).join('')}
    <text x="12" y="12" font-size="10.5" fill="var(--ink-3)">shortens less</text>
    <text x="508" y="12" font-size="10.5" fill="var(--ink-3)" text-anchor="end">shortens more</text></svg>`;
}

// ---- content --------------------------------------------------------------------
export const METHODS = [
  { id: 'open', title: 'Open — no adjustment', when: 'The factory setting',
    figs: [panel('open', 'Open — the sewn end loop simply hangs on the maillon')],
    steps: ['The line\'s sewn end loop goes straight onto the maillon (or soft link) — no hitch, no turns.',
      'This is where every line starts and where you come back to when you remove an adjustment.'],
    note: 'If your wing came with a lark\'s foot or loop already on a line, that is its factory setting — take the manual and the check lengths as the reference, not this drawing.' },
  { id: 'one-loop', title: 'One loop', when: 'The smallest shortening',
    figs: [panel('one', 'One loop — the end loop taken once round the bar')],
    steps: ['Open the maillon and take the line\'s end loop off.', 'Pass the end loop once around the bar, then seat it — the line now reaches the bar one loop shorter.',
      'Close the maillon, load the line, re-measure the main.'],
    note: 'Typically 8–12 mm on a maillon, depending on line thickness (a UK workshop\'s figure — measure yours).' },
  { id: 'larks', title: 'Lark\'s foot (lark\'s head, girth hitch)', when: 'A bit more than one loop',
    figs: [panel('larks', 'Lark\'s foot — two wraps side by side, the collar behind the bar')],
    steps: ['Pass the end loop round the bar, then pass the line through its own loop.', 'Pull it snug: two wraps side by side on the bar, collar at the back, nothing crossed.',
      'Load it and re-measure.'],
    note: 'One of the options in the PMA standard\'s list — not the default: an open loop is.' },
  { id: 'turns', title: 'Turns around', when: 'A larger shortening',
    figs: [panel('turns', 'Turns around — the loop wound round the bar twice')],
    steps: ['Wind the end loop round the bar two (or more) times before seating it.', 'Lay the turns side by side — never crossed over each other.',
      'Load and re-measure; each turn takes up roughly one loop\'s worth.'],
    note: 'On a soft link, turns take up much more than on a maillon — see below.' },
  { id: 'larks-loop', title: 'Lark\'s foot + loop', when: 'The largest adjustment at the connector',
    figs: [panel('larksLoop', 'Lark\'s foot + loop — one side taken round once more')],
    steps: ['Tie a lark\'s foot, then take one side of it round the bar once more.', 'Dress the wraps so they lie flat and side by side.',
      'Load and re-measure. If you need more than this, stop: that line or main is due for inspection or replacement, not more loops.'],
    note: 'Also listed in the PMA standard. A pile hitch gives about the same change and is easier to fit on a small maillon.' },
  { id: 'soft', title: 'On a soft link', when: 'Wings with Dyneema soft links instead of maillons',
    figs: [panel('open', 'Open on a soft link', { soft: true }), panel('larks', 'Lark\'s foot on a soft link', { soft: true })],
    steps: ['The same loops, round the soft link\'s passes instead of a steel bar.',
      'Before opening one, photograph it: how many passes, which way round, where the stopper sits. Re-close it exactly so — stopper right through, retaining ring back on.',
      'Expect bigger steps: a double loop on a soft link is typically 18–20 mm, where a maillon loop is 8–12 mm — so fine corrections are harder.'],
    note: 'Never knot, twist or shorten the soft link itself, and don\'t swap soft links for maillons (or back) unless your manufacturer allows it: they differ in length and the check lengths assume the original connector.' },
  { id: 'trim-loops', title: 'Sewn trim loops', when: 'Mains that have extra loops sewn in',
    figs: [],
    steps: ['Some wings have spare loops sewn into a main (Ozone uses them on C lines; BGD marks them on its sheets — the app says when yours has them).',
      'Move the connector to the next sewn loop to shorten, back to the end loop to lengthen — no hitch needed.',
      'Re-measure that main.'],
    note: 'When a wing has them, use these first — they are the manufacturer\'s own adjustment.' },
  { id: 'cascade', title: 'At a line-to-line joint', when: 'Only where your manufacturer allows it',
    figs: [],
    steps: ['The PMA list also allows the cascade joint between an upper and a lower line to be tied shorter ("cascade on lowers").',
      'It changes only the lines above that joint, not the whole main — useful for one uneven line, but it needs the line plan and care.'],
    note: 'Best left to a workshop unless your manual describes it.' },
  { id: 'brake', title: 'Brake lines', when: 'Brakes too long or too short',
    figs: [],
    steps: ['Brakes are set at the handle knot, never at the maillon.',
      'Measure from the top of the handle knot to the sail. The PMA standard allows a brake to be 0 to +50 mm on its reference — never shorter.',
      'Mark the new point, re-tie with the knot your manual shows, do both sides the same, and keep the factory free play.'],
    note: 'Too-short brakes brake the wing on speed bar and in turbulence — when in doubt, leave them a little long.' },
];

export function renderGuide(root, ctx) {
  clear(root);
  const wrap = el(`<div>
    ${DEFS}
    <button class="btn ghost sm" id="back" style="margin-left:-8px">${icon.back} Back</button>
    <h1>Trimming guide</h1>
    <p class="lede">How line lengths are adjusted: with loops on the maillon or soft link, following the PMA inspection standard's list of recommended options and Ozone's manuals.</p>

    <nav class="guide-toc" id="toc" aria-label="Methods"></nav>

    <div class="card">
      <h3 style="margin-top:0">Measure first — the standard's rules</h3>
      <ul class="plain">
        <li><b>5 daN on every line</b> (about 5 kg, ±15%), both sides.</li>
        <li><b>Total length</b> runs from the line's attachment on the sail to the inside of the riser loop at the harness end. Brakes: from the top of the handle knot to the sail.</li>
        <li><b>Within ±12 mm</b> of the manufacturer's length, after one common offset for the whole wing (at most 1.5% of the longest line). Brakes: 0 to +50 mm.</li>
        <li><b>Adjust mains at the connector</b> — one loop moves every line hanging off that main. One line off on its own is an inspect-and-replace job.</li>
        <li><b>Your manufacturer's manual wins</b> where it says something different — tolerances included.</li>
      </ul>
    </div>

    <h2>The options, smallest first</h2>
    <div class="card">${ladder()}
      <p class="small muted" style="margin:6px 0 0">How much each one takes up depends on the line's thickness and the connector. Tie it, tap <i>Re-measure</i> for that main, and the app shows exactly what it did. To lengthen, step back down the list.</p></div>
    <div id="methods"></div>

    <h2>The order to work in</h2>
    <ol class="steps-list">
      <li><b>Re-measure anything implausible.</b> A reading 40 mm+ out is usually a mis-hooked line.</li>
      <li><b>Inspect uneven lines</b> — damaged or shrunk lines get replaced, not looped around.</li>
      <li><b>Make left and right match</b>, main by main.</li>
      <li><b>Set the trim</b> (front to rear) with the mains of each section, smallest change first.</li>
      <li><b>Set the brakes</b> — symmetric, with the factory free play.</li>
      <li><b>Re-measure every main you changed</b>, then test fly in calm air before anything demanding.</li>
    </ol>

    <div class="note warn" style="margin-top:16px">${icon.warn}<span>Trim changes affect certification and how the wing behaves in an incident.
      If a main needs more than a lark's foot + loop, or you're unsure, have a qualified workshop check it.</span></div>
    <p class="small muted" style="margin-top:14px">Sources: PMA Standard "Periodical Inspection of Paragliders" V 2024.12.1, §5.5 and Appendix B; Ozone pilot manuals; typical take-up figures from Crickhowell Paragliding's workshop.</p>
  </div>`);
  root.appendChild(wrap);
  $('#back', wrap).addEventListener('click', () => history.length > 1 ? history.back() : ctx.goto('wings'));

  const toc = $('#toc', wrap);
  const host = $('#methods', wrap);
  for (const m of METHODS) {
    const a = el(`<a href="#guide" class="chip">${m.title.replace(/ \(.*\)| — .*/, '')}</a>`);
    a.addEventListener('click', e => { e.preventDefault(); $(`#m-${m.id}`, wrap).scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    toc.appendChild(a);
    host.appendChild(el(`<section class="card method" id="m-${m.id}">
      <div class="method-head"><b>${m.title}</b><span class="small muted">${m.when}</span></div>
      ${m.figs.length ? `<div class="fig-row">${m.figs.join('')}</div>` : ''}
      <ol class="method-steps">${m.steps.map(s => `<li>${s}</li>`).join('')}</ol>
      <p class="small method-note">${m.note}</p></section>`));
  }
  if (ctx.guideAnchor) {
    const t = $(`#m-${ctx.guideAnchor}`, wrap);
    ctx.guideAnchor = null;
    if (t) { t.scrollIntoView({ block: 'start' }); t.classList.add('flash'); }
  }
}

/**
 * Which option fits one main's change, for the trim plan. mm < 0 = shorten.
 * Sizes follow the typical maillon figures (8–12 mm a loop); the pilot re-measures.
 */
export function methodFor(mm, hasLoop) {
  const a = Math.abs(mm);
  if (mm > 0) return { id: hasLoop ? 'trim-loops' : 'open',
    text: hasLoop ? 'Move it back a sewn trim loop, towards the end loop.'
      : 'Take off a loop you added before (one step down the list). Nothing to take off? Shorten the other mains of this section instead.' };
  if (hasLoop) return { id: 'trim-loops', text: 'Move it to the next sewn trim loop.' };
  if (a <= 12) return { id: 'one-loop', text: 'Add one loop at the maillon or soft link.' };
  if (a <= 20) return { id: 'larks', text: 'Try a lark\'s foot at the maillon (or two turns).' };
  if (a <= 30) return { id: 'larks-loop', text: 'Try a lark\'s foot + loop — and look at why it moved this much.' };
  return { id: 'larks-loop', text: 'More than any loop should take up — inspect this main\'s lines before adjusting.' };
}
