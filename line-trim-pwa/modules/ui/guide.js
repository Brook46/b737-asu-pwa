// ui/guide.js — how to actually change a line's length, and the order to do it in.
//
// Drawings are oriented as in flight: riser at the bottom, the connector
// (maillon or soft link) above it, lines running UP to the wing. Each method is a
// before → after pair so the change is visible, not described.
//
// No "mm per knot" figures on purpose: take-up depends on line diameter and the
// connector, so the guide says to tie it and re-measure that main — the app then
// shows exactly what it took up.

import { $, el, clear } from './dom.js?v=10';
import { icon } from './icons.js?v=10';

// ---- drawing kit ------------------------------------------------------------
// Shared gradients live in one zero-size <svg> on the page (not display:none —
// Safari won't paint gradients referenced from a hidden element).
const DEFS = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>
  <linearGradient id="lt-steel" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#f4f6f8"/><stop offset=".35" stop-color="#b9c0c7"/>
    <stop offset=".6" stop-color="#7d8790"/><stop offset="1" stop-color="#d7dce1"/></linearGradient>
  <linearGradient id="lt-barrel" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#8b949c"/><stop offset=".45" stop-color="#eef1f3"/><stop offset="1" stop-color="#6f7880"/></linearGradient>
  <linearGradient id="lt-web" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#2b2f34"/><stop offset=".5" stop-color="#4a5159"/><stop offset="1" stop-color="#2b2f34"/></linearGradient>
  <linearGradient id="lt-grip" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#5b636b"/><stop offset="1" stop-color="#2e3338"/></linearGradient>
</defs></svg>`;

const W = 150, H = 240;                  // one panel
const CX = 75;                           // centre line
const MAIL = { top: 118, h: 50, w: 58 }; // maillon
const LINE = '#e8712c';                  // an orange main, as most are
const LINE_DK = '#b34f17';
const BLUE = '#2f7fd1';
const BLUE_DK = '#1b4f8a';
const DYNEEMA = '#eef0e6';

/** A braided line: dark edge, solid core, a fine lighter dash for the weave. */
function cord(d, { color = LINE, edge = color === BLUE ? BLUE_DK : LINE_DK, w = 5 } = {}) {
  return `<path d="${d}" fill="none" stroke="${edge}" stroke-opacity=".7" stroke-width="${w + 1.6}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="${d}" fill="none" stroke="#fff" stroke-opacity=".38" stroke-width="1.3" stroke-dasharray="2.2 2.6" stroke-linecap="round"/>`;
}

/** Riser webbing from the bottom edge up to yTop, with its stitching. */
function riser(yTop) {
  return `<rect x="${CX - 16}" y="${yTop}" width="32" height="${H - yTop + 2}" rx="3" fill="url(#lt-web)"/>
    <path d="M${CX - 11} ${yTop + 14} V${H} M${CX + 11} ${yTop + 14} V${H}" stroke="#c9ced3" stroke-opacity=".55" stroke-width="1" stroke-dasharray="3 2.5"/>
    <path d="M${CX - 12} ${yTop + 30} H${CX + 12} M${CX - 12} ${yTop + 36} H${CX + 12}" stroke="#c9ced3" stroke-opacity=".5" stroke-width="1" stroke-dasharray="2 2"/>`;
}

/** Steel quick-link with its screw gate on the right. */
function maillon() {
  const { top, h, w } = MAIL, x = CX - w / 2;
  return `<rect x="${x}" y="${top}" width="${w}" height="${h}" rx="17" fill="none" stroke="#5c656d" stroke-width="9.5"/>
    <rect x="${x}" y="${top}" width="${w}" height="${h}" rx="17" fill="none" stroke="url(#lt-steel)" stroke-width="7"/>
    <rect x="${x + w - 5.5}" y="${top + 12}" width="11" height="22" rx="3" fill="url(#lt-barrel)" stroke="#59626a" stroke-width="1"/>
    <path d="M${x + w - 5} ${top + 17} h10 M${x + w - 5} ${top + 21} h10 M${x + w - 5} ${top + 25} h10 M${x + w - 5} ${top + 29} h10" stroke="#59626a" stroke-width=".8"/>`;
}

/** Riser + maillon, the webbing's sewn loop round the lower bar. */
function base() {
  return riser(MAIL.top + MAIL.h - 8) + maillon()
    + `<path d="M${CX - 16} ${MAIL.top + MAIL.h - 4} Q${CX} ${MAIL.top + MAIL.h - 14} ${CX + 16} ${MAIL.top + MAIL.h - 4}" fill="none" stroke="#1f2327" stroke-width="3"/>`;
}

/**
 * A larks head (girth hitch) on the maillon's top bar, the line going up.
 * wraps: 1 = normal, 2 = one extra turn. merge: where the two legs become the line.
 */
function larks({ wraps = 1, merge = 70, color = LINE } = {}) {
  const bar = MAIL.top;
  const offs = wraps === 1 ? [-7, 7] : [-12, -4, 4, 12];
  let s = '';
  s += cord(`M${CX + offs[0]} ${bar - 4} C${CX + offs[0]} ${bar - 22} ${CX - 2} ${merge + 18} ${CX} ${merge}`, { color });
  s += cord(`M${CX + offs.at(-1)} ${bar - 4} C${CX + offs.at(-1)} ${bar - 22} ${CX + 2} ${merge + 18} ${CX} ${merge}`, { color });
  s += cord(`M${CX + offs[0] - 1} ${bar + 9} H${CX + offs.at(-1) + 1}`, { color, w: 5.5 });   // collar, in front
  for (const o of offs) s += cord(`M${CX + o} ${bar - 7} V${bar + 9}`, { color });            // wraps over the bar
  return s;
}

/** The line from the merge point up and off the top edge. */
const lineUp = (from, color = LINE) => cord(`M${CX} ${from} V-4`, { color });

/** A tied overhand knot sitting on the line at y. */
function knot(y) {
  return `<ellipse cx="${CX}" cy="${y}" rx="10" ry="12" fill="${LINE_DK}"/>
    <ellipse cx="${CX}" cy="${y}" rx="8.5" ry="10.5" fill="${LINE}"/>
    <path d="M${CX - 7} ${y - 6} C${CX} ${y - 1} ${CX + 2} ${y + 3} ${CX + 7} ${y + 7}" stroke="${LINE_DK}" stroke-width="2.2" fill="none"/>
    <path d="M${CX - 7} ${y + 5} C${CX - 2} ${y + 1} ${CX + 2} ${y - 3} ${CX + 7} ${y - 6}" stroke="#fff" stroke-opacity=".5" stroke-width="1.4" fill="none"/>`;
}

/** A spare sewn loop on the line: an eye plus its stitched splice. */
function sewnLoop(y, side = -1) {
  const x = CX + side * 16;
  return cord(`M${CX} ${y + 8} C${x} ${y + 8} ${x} ${y - 14} ${CX} ${y - 14}`, { w: 4 })
    + `<rect x="${CX - 4}" y="${y + 4}" width="8" height="12" rx="2" fill="${LINE_DK}"/>
       <path d="M${CX - 4} ${y + 7} h8 M${CX - 4} ${y + 10} h8 M${CX - 4} ${y + 13} h8" stroke="#fff" stroke-opacity=".6" stroke-width=".9"/>`;
}

/**
 * Leader-line label. The text sits at (tx, ty): anchor 'start' puts it to the
 * right of tx (a label on the left edge), 'end' to the left (right edge). The
 * leader stops at the near end of the text so it never strikes through it.
 */
function tag(x, y, tx, ty, text, anchor = 'start') {
  const w = text.length * 6.2;
  const x0 = anchor === 'start' ? tx : tx - w, x1 = x0 + w;
  // join the leader to the label edge nearest the point: a side, or the top/bottom
  const [lx, ly] = x < x0 - 2 ? [x0 - 3, ty] : x > x1 + 2 ? [x1 + 3, ty] : [x, y < ty ? ty - 9 : ty + 7];
  return `<path d="M${x} ${y} L${lx} ${ly}" stroke="var(--ink-3)" stroke-width="1"/>
    <circle cx="${x}" cy="${y}" r="2" fill="var(--ink-3)"/>
    <text x="${tx}" y="${ty + 4}" text-anchor="${anchor}" font-size="11" font-weight="600" fill="var(--ink-2)">${text}</text>`;
}
const upArrow = `<path d="M${CX + 30} 34 V10 m-5 6 l5 -6 l5 6" stroke="var(--ink-3)" stroke-width="1.6" fill="none"/>
  <text x="${CX + 38}" y="20" font-size="10" fill="var(--ink-3)">to the</text><text x="${CX + 38}" y="32" font-size="10" fill="var(--ink-3)">wing</text>`;

const panel = (inner, caption, tone = '') =>
  `<figure class="fig-panel ${tone}"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${caption}">${inner}</svg><figcaption>${caption}</figcaption></figure>`;
const pair = (a, b) => `<div class="fig-pair">${a}<span class="fig-arrow" aria-hidden="true">${icon.chevron}</span>${b}</div>`;
const single = a => `<div class="fig-pair single">${a}</div>`;

// ---- the figures --------------------------------------------------------------
function figLarks() {
  return single(panel(base() + larks() + lineUp(70) + upArrow
    + tag(CX - 7, MAIL.top - 3, 10, 92, 'wraps')
    + tag(CX + 8, MAIL.top + 9, 146, 100, 'collar', 'end')
    + tag(CX - 30, MAIL.top + 32, 8, 190, 'maillon')
    + tag(CX - 14, 212, 8, 226, 'riser'), 'Larks head — the baseline'));
}
function figWrap() {
  return pair(
    panel(base() + larks() + lineUp(70) + upArrow, 'Before — one wrap'),
    panel(base() + larks({ wraps: 2, merge: 62 }) + lineUp(62) + upArrow
      + tag(CX + 12, MAIL.top - 6, 146, 92, '+1 turn', 'end'), 'After — two wraps: shorter', 'after'));
}
function figKnot() {
  return pair(
    panel(base() + larks() + lineUp(70) + upArrow, 'Before'),
    panel(base() + larks({ merge: 84 }) + lineUp(84) + knot(70) + upArrow
      + tag(CX + 9, 70, 146, 58, 'knot', 'end'), 'After — knot above the loop: shorter', 'after'));
}
function figLoops() {
  return pair(
    panel(base() + larks() + lineUp(70) + sewnLoop(52) + upArrow
      + tag(CX - 16, 46, 8, 34, 'spare loop'), 'Before — on the end loop'),
    panel(base()
      // the old end loop now hangs free: a tail from the splice ending in its eye
      + cord(`M${CX - 2} 92 C${CX - 18} 96 ${CX - 30} 100 ${CX - 34} 110`, { w: 4 })
      + cord(`M${CX - 34} 110 C${CX - 44} 116 ${CX - 42} 130 ${CX - 34} 128 C${CX - 28} 126 ${CX - 30} 114 ${CX - 34} 110`, { w: 3.6 })
      + larks({ merge: 88 }) + lineUp(88)
      + `<rect x="${CX - 4}" y="84" width="8" height="12" rx="2" fill="${LINE_DK}"/>
         <path d="M${CX - 4} 87 h8 M${CX - 4} 90 h8 M${CX - 4} 93 h8" stroke="#fff" stroke-opacity=".6" stroke-width=".9"/>`
      + upArrow + tag(CX - 42, 130, 4, 196, 'old end'), 'After — on the spare loop: shorter', 'after'));
}
function softLink() {
  const top = 100, bot = 176, hw = 26;     // the soft link's loop
  let s = riser(bot - 18)
    + `<path d="M${CX - 16} ${bot - 6} Q${CX} ${bot - 24} ${CX + 16} ${bot - 6}" fill="none" stroke="#1f2327" stroke-width="3"/>`;
  for (const dx of [-4, 0, 4]) {           // several passes of Dyneema, side by side
    s += `<rect x="${CX - hw + dx}" y="${top}" width="${hw * 2}" height="${bot - top}" rx="22" fill="none" stroke="#8d9383" stroke-width="4.4"/>
          <rect x="${CX - hw + dx}" y="${top}" width="${hw * 2}" height="${bot - top}" rx="22" fill="none" stroke="${DYNEEMA}" stroke-width="2.8"/>`;
  }
  // stopper knot on the right, retaining ring gathering the lines
  s += `<circle cx="${CX + hw + 5}" cy="${top + 42}" r="7" fill="${DYNEEMA}" stroke="#8d9383" stroke-width="1.6"/>
    <path d="M${CX + hw + 1} ${top + 38} l8 8 M${CX + hw + 1} ${top + 46} l8 -8" stroke="#8d9383" stroke-width="1.2"/>
    <rect x="${CX - hw - 6}" y="${top + 16}" width="${hw * 2 + 12}" height="8" rx="4" fill="#1d1f22"/>`;
  // three lines larks-headed onto the passes, fanning up
  [-13, 0, 13].forEach((x, i) => {
    const color = i === 1 ? BLUE : LINE;
    s += cord(`M${CX + x} ${top + 2} C${CX + x} ${top - 24} ${CX + x * 2.2} 50 ${CX + x * 3} -4`, { color, w: 4.2 });
    s += cord(`M${CX + x - 4} ${top + 5} H${CX + x + 4}`, { color, w: 4.8 });
  });
  return s
    + tag(CX - hw - 4, top + 50, 4, top + 76, 'soft link')
    + tag(CX + hw + 12, top + 42, 146, top + 66, 'stopper', 'end')
    + tag(CX + hw + 6, top + 20, 146, top - 6, 'ring', 'end')
    + tag(CX - 14, 218, 4, 232, 'riser loop');
}
function figSoft() {
  return single(panel(softLink(), 'Soft link: several passes of Dyneema in place of a maillon; lines go up to the wing'));
}
function figBrake() {
  const b = { color: BLUE, edge: BLUE_DK, w: 4 };
  // handle with its attachment eye on top; the knot ties the line into that eye
  const grip = (y, ghost = false) => ghost
    ? `<rect x="${CX - 30}" y="${y}" width="60" height="30" rx="13" fill="none" stroke="var(--ink-3)" stroke-width="1.4" stroke-dasharray="4 3"/>`
    : `<path d="M${CX - 7} ${y + 2} Q${CX} ${y - 14} ${CX + 7} ${y + 2}" fill="none" stroke="#2e3338" stroke-width="4"/>
       <rect x="${CX - 30}" y="${y}" width="60" height="30" rx="13" fill="url(#lt-grip)"/>
       <rect x="${CX - 24}" y="${y + 6}" width="48" height="18" rx="9" fill="none" stroke="#7b848c" stroke-width="1.2"/>`;
  // a bowline: the line comes down, loops through the handle's eye and locks
  const bowline = y => cord(`M${CX} ${y} C${CX - 13} ${y + 2} ${CX - 13} ${y + 20} ${CX} ${y + 22} C${CX + 13} ${y + 20} ${CX + 13} ${y + 2} ${CX} ${y}`, b)
    + `<circle cx="${CX}" cy="${y}" r="4.5" fill="${BLUE_DK}"/>`;
  const mark = y => `<path d="M${CX - 20} ${y} H${CX + 20}" stroke="#e8b02c" stroke-width="3" stroke-dasharray="4 3"/>`;
  return pair(
    panel(cord(`M${CX} -4 V160`, b) + bowline(160) + grip(186) + mark(104)
      + tag(CX + 20, 104, 146, 86, 'new mark', 'end') + tag(CX + 12, 170, 146, 150, 'knot', 'end')
      + tag(CX - 30, 202, 4, 232, 'handle'), 'Before — tied at the old point'),
    panel(cord(`M${CX} -4 V104`, b) + bowline(104) + grip(130)
      // the spare tail past the knot, and where the handle used to be
      + cord(`M${CX + 3} 106 C${CX + 18} 118 ${CX + 36} 132 ${CX + 40} 164`, { ...b, w: 3.4 })
      + grip(186, true)
      + tag(CX + 12, 112, 146, 92, 're-tied', 'end') + tag(CX + 40, 160, 146, 178, 'tail', 'end')
      + tag(CX - 30, 200, 4, 232, 'was here'), 'After — handle higher: shorter brake', 'after'));
}

// ---- content --------------------------------------------------------------------
export const METHODS = [
  { id: 'larks', title: 'The larks head (baseline)', when: 'How every line sits on its maillon or soft link', fig: figLarks,
    steps: ['Pass the line\'s end loop around the bar.', 'Push the line through its own loop and pull it snug.',
      'Dress it: collar flat, wraps side by side, nothing crossed.'],
    note: 'Every adjustment below starts from — and can be undone back to — a clean larks head.' },
  { id: 'loops', title: 'Trim loops', when: 'Mains that have spare sewn loops', fig: figLoops,
    steps: ['Open the maillon (or soft link) and take the line off.', 'Larks-head the next loop towards the wing to shorten — or back towards the end loop to lengthen.',
      'Close the connector properly, then re-measure that main.'],
    note: 'The cleanest adjustment there is — the manufacturer sewed the loops for exactly this. The app says when the sheet shows a main has them.' },
  { id: 'wrap', title: 'One extra turn', when: 'A small shortening', fig: figWrap,
    steps: ['Take the line off the connector.', 'Pass the end loop around the bar twice before closing the larks head.',
      'Dress the turns side by side and load it before measuring.'],
    note: 'Takes up a little length. On a soft link the extra turn goes round all of its passes the same way.' },
  { id: 'knot', title: 'Knot in the end loop', when: 'A larger shortening', fig: figKnot,
    steps: ['Tie an overhand knot just above the end loop, through both strands of the loop.', 'Larks-head the smaller loop that\'s left, as usual.',
      'Pull it hard under load — knots settle — then re-measure.'],
    note: 'Takes up more than a turn. Leave enough loop for the larks head to sit flat.' },
  { id: 'soft', title: 'Soft links', when: 'Wings with Dyneema soft links instead of steel maillons', fig: figSoft,
    steps: ['Before opening one, photograph it: how many passes, which way round, where the stopper sits.',
      'Adjust on the line\'s end loop exactly as with a maillon — trim loop, extra turn or knot.',
      'Close it the way it was: same number of passes, stopper pulled right through, retaining ring back over the lines.',
      'Check it\'s fully seated with the lines side by side, then load it before measuring.'],
    note: 'Never knot, twist or shorten the soft link itself, and don\'t swap soft links and maillons: they differ in length, and the check lengths assume the connector your wing came with. Replace a soft link that\'s fuzzy, flattened, glazed or stiff — they wear faster than steel.' },
  { id: 'brake', title: 'Brake line', when: 'Brakes too long or short', fig: figBrake,
    steps: ['Mark the new point on the line, measured from the check.', 'Untie at the handle and re-tie at the mark with the knot your manufacturer uses — commonly a bowline.',
      'Do both sides the same, then check the free play on the ground.'],
    note: 'Brakes are set at the handle, never at the maillon. Keep the factory free play — Nova, for example, specifies 10–15 cm — so the wing is never braked on full speed bar.' },
];

export function renderGuide(root, ctx) {
  clear(root);
  const wrap = el(`<div>
    ${DEFS}
    <button class="btn ghost sm" id="back" style="margin-left:-8px">${icon.back} Back</button>
    <h1>Trimming guide</h1>
    <p class="lede">How to change a line's length, and the order to do it in. Drawings are the right way up: riser at the bottom, lines going up to the wing.</p>

    <nav class="guide-toc" id="toc" aria-label="Methods"></nav>

    <div class="card">
      <h3 style="margin-top:0">Before you touch anything</h3>
      <ul class="plain">
        <li><b>Adjust mains, not single lines.</b> A main moves every line hanging off it. One line off on its own is an inspect-and-replace job.</li>
        <li><b>Trim is relative.</b> What matters is how the rows sit against each other. If a main needs lengthening and there's nothing to undo, shorten the other mains of that section instead.</li>
        <li><b>Small steps, then re-measure.</b> How much a turn or knot takes up depends on the line and the connector — tie it, tap <i>Re-measure</i> for that main, and the app shows exactly what it did. Note it for next time.</li>
        <li><b>Match left and right.</b> Do the same on both sides unless the check says the sides differ.</li>
        <li><b>Typical ageing:</b> A and B lines stretch while rear lines shrink, so an older wing usually reads slower.</li>
      </ul>
    </div>

    <h2>Ways to change a length</h2>
    <div id="methods"></div>

    <h2>The order to work in</h2>
    <ol class="steps-list">
      <li><b>Re-measure anything implausible.</b> A reading 40 mm+ out is usually a mis-hooked line.</li>
      <li><b>Inspect uneven lines</b> — damaged or shrunk lines get replaced, not trimmed around.</li>
      <li><b>Make left and right match</b>, main by main.</li>
      <li><b>Set the angle of incidence</b> with the rear (or front) mains of each section, smallest change first.</li>
      <li><b>Set the brakes</b> — symmetric, with the factory free play.</li>
      <li><b>Re-measure the mains you changed.</b></li>
      <li><b>Test fly in calm air</b> before anything demanding. Launch, spin and collapse behaviour can all change with trim.</li>
    </ol>

    <div class="note warn" style="margin-top:16px">${icon.warn}<span>Trim changes affect certification and how the wing behaves in an incident.
      Stay within your manufacturer's tolerances and follow its manual where it differs from this guide; if more than a small correction is needed, or you're unsure, let a qualified workshop do it.</span></div>
  </div>`);
  root.appendChild(wrap);
  $('#back', wrap).addEventListener('click', () => history.length > 1 ? history.back() : ctx.goto('wings'));

  const toc = $('#toc', wrap);
  const host = $('#methods', wrap);
  for (const m of METHODS) {
    const a = el(`<a href="#guide" class="chip">${m.title.replace(/ \(.*\)/, '')}</a>`);
    a.addEventListener('click', e => { e.preventDefault(); $(`#m-${m.id}`, wrap).scrollIntoView({ behavior: 'smooth', block: 'start' }); });
    toc.appendChild(a);
    host.appendChild(el(`<section class="card method" id="m-${m.id}">
      <div class="method-head"><b>${m.title}</b><span class="small muted">${m.when}</span></div>
      ${m.fig()}
      <ol class="method-steps">${m.steps.map(s => `<li>${s}</li>`).join('')}</ol>
      <p class="small method-note">${m.note}</p></section>`));
  }
  if (ctx.guideAnchor) {
    const t = $(`#m-${ctx.guideAnchor}`, wrap);
    ctx.guideAnchor = null;
    if (t) { t.scrollIntoView({ block: 'start' }); t.classList.add('flash'); }
  }
}

/** Which method fits one adjustment, for the results checklist. */
export function methodFor(mm, hasLoop) {
  if (mm > 0) return { id: hasLoop ? 'loops' : 'larks',
    text: hasLoop ? 'Move it back a trim loop, towards the end loop.' : 'Undo a turn, knot or loop taken up before. Nothing to undo? Shorten the other mains of this section by the same amount instead.' };
  if (hasLoop) return { id: 'loops', text: 'Move it to the next trim loop towards the wing.' };
  return Math.abs(mm) < 8
    ? { id: 'wrap', text: 'Try one extra turn of the larks head.' }
    : { id: 'knot', text: 'Try a knot in the end loop (or a turn, if it gets closer).' };
}
