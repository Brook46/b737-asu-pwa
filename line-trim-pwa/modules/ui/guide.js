// ui/guide.js — how to actually change a line length, and the order to do it in.
//
// No "mm per knot" figures on purpose: take-up depends on line diameter and
// maillon size, so the guide says to tie it and re-measure that main — the app
// then shows exactly what it took up.

import { $, el, clear } from './dom.js?v=8';
import { icon } from './icons.js?v=8';

// ---- small line drawings (theme tokens, work in both themes) ---------------
// A maillon at the top; the line's end loop is girth-hitched round its bottom
// bar (the "collar"), its two legs join into the line below.
const MAILLON = '<rect x="40" y="6" width="60" height="50" rx="18" fill="none" stroke="var(--ink-3)" stroke-width="6"/>';
const LINE = 'fill="none" stroke="var(--row-A)" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"';
const collar = (y, op = 1) => `<rect x="50" y="${y}" width="40" height="11" rx="5.5" fill="var(--row-A)" opacity="${op}"/>`;
const legs = (y, end = 100) => `<path ${LINE} d="M58 ${y} C58 ${y + 18} 70 ${y + 22} 70 ${end - 6} M82 ${y} C82 ${y + 18} 70 ${y + 22} 70 ${end - 6}"/>`;
const label = (x, y, t) => `<text x="${x}" y="${y}" font-size="11" font-weight="600" fill="var(--ink-2)">${t}</text>`;
const svg = inner => `<svg viewBox="0 0 140 150" class="knot-svg" aria-hidden="true">${MAILLON}${inner}</svg>`;

const DRAW = {
  larks: svg(`${collar(50)}${legs(61)}<path ${LINE} d="M70 94 V146"/>`),
  wrap: svg(`${collar(44, 0.55)}${collar(56)}${legs(67)}<path ${LINE} d="M70 100 V146"/>${label(86, 92, '+1 turn')}`),
  knot: svg(`${collar(50)}${legs(61)}<path ${LINE} d="M70 94 V146"/>
             <circle cx="70" cy="112" r="9" fill="var(--surface-2)" stroke="var(--row-B)" stroke-width="5"/>${label(86, 116, 'knot')}`),
  loops: svg(`${collar(50)}${legs(61)}<path ${LINE} d="M70 94 V146"/>
             <ellipse cx="62" cy="114" rx="6" ry="9" fill="none" stroke="var(--row-C)" stroke-width="3.5"/>
             <ellipse cx="62" cy="134" rx="6" ry="9" fill="none" stroke="var(--row-C)" stroke-width="3.5"/>
             ${label(80, 118, 'spare')}${label(80, 138, 'loops')}`),
  brake: `<svg viewBox="0 0 140 150" class="knot-svg" aria-hidden="true">
             <rect x="40" y="100" width="60" height="30" rx="12" fill="none" stroke="var(--ink-3)" stroke-width="5"/>
             <path fill="none" stroke="var(--row-K)" stroke-width="4" stroke-linecap="round" d="M70 6 V74 M70 74 C58 74 56 90 70 94 C84 90 82 74 70 74 M70 94 V100"/>
             <path fill="none" stroke="var(--row-B)" stroke-width="3" stroke-dasharray="4 4" d="M46 50 H94"/>${label(100, 54, 'mark')}</svg>`,
};

export const METHODS = [
  { id: 'loops', title: 'Trim loops', when: 'Shortening or lengthening a main that has them',
    how: 'Some mains have spare sewn loops at the maillon end. Move the larks head to the next loop up to shorten, down to lengthen. It\'s the cleanest adjustment there is — the manufacturer put them there for exactly this. The app says when a main has loops (from the manufacturer\'s sheet).' },
  { id: 'larks', title: 'The larks head (baseline)', when: 'How every main sits on the maillon',
    how: 'The line\'s end loop goes through the maillon and back over itself. Everything below starts from a clean larks head, dressed tight and square. Undo any adjustment by getting back to this.' },
  { id: 'wrap', title: 'One extra turn', when: 'A small shortening',
    how: 'Pass the end loop around the maillon one more time before closing the larks head. It takes up a little length. Dress it so the turns lie side by side, not crossed.' },
  { id: 'knot', title: 'Knot in the end loop', when: 'A larger shortening',
    how: 'Tie a simple overhand knot in the line just above the end loop, then larks-head the smaller loop on as usual. It takes up more than a turn. Pull it tight under load before measuring — knots settle.' },
  { id: 'brake', title: 'Brake line', when: 'Brakes too long or short',
    how: 'Brakes are set at the handle, never at the maillon. Mark the new point, re-tie with the knot your manufacturer uses (commonly a bowline), and make both sides match. Keep the factory free play — Nova, for example, specifies 10–15 cm — so the wing is never braked on full speedbar.' },
];

export function renderGuide(root, ctx) {
  clear(root);
  const wrap = el(`<div>
    <button class="btn ghost sm" id="back" style="margin-left:-8px">${icon.back} Back</button>
    <h1>Trimming guide</h1>
    <p class="lede">How to change a line's length, and the order to do it in.</p>

    <div class="card">
      <h3 style="margin-top:0">Before you touch anything</h3>
      <ul class="plain">
        <li><b>Adjust mains, not single lines.</b> A main moves every line hanging off it. One line off on its own is an inspect-and-replace job.</li>
        <li><b>Trim is relative.</b> What matters is how the rows sit against each other, not the absolute length. If a main needs lengthening and there's nothing to undo, shorten the other mains of that section instead.</li>
        <li><b>Small steps, then re-measure.</b> How much a turn or knot takes up depends on line diameter and maillon — tie it, tap <i>Re-measure</i> for that main, and the app shows exactly what it did. Note it for next time.</li>
        <li><b>Match left and right.</b> Do the same thing on both sides unless the check says the sides differ.</li>
        <li><b>Typical ageing:</b> A and B lines stretch while C lines shrink, so an older wing usually reads slower.</li>
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
      Stay within your manufacturer's tolerances; if the check says more than a small correction is needed, or you're unsure, let a qualified workshop do it.</span></div>
  </div>`);
  root.appendChild(wrap);
  $('#back', wrap).addEventListener('click', () => history.length > 1 ? history.back() : ctx.goto('wings'));

  const host = $('#methods', wrap);
  for (const m of METHODS) {
    host.appendChild(el(`<div class="card method" id="m-${m.id}">
      ${DRAW[m.id]}
      <div><b>${m.title}</b><span class="small muted" style="display:block;margin:2px 0 6px">${m.when}</span>
        <p class="small" style="margin:0;color:var(--ink-2)">${m.how}</p></div></div>`));
  }
  if (ctx.guideAnchor) {
    const t = $(`#m-${ctx.guideAnchor}`, wrap);
    ctx.guideAnchor = null;
    if (t) { t.scrollIntoView({ block: 'center' }); t.classList.add('flash'); }
  }
}

/** Which method fits one adjustment, for the results checklist. */
export function methodFor(mm, hasLoop) {
  if (mm > 0) return { id: hasLoop ? 'loops' : 'larks',
    text: hasLoop ? 'Move it down a trim loop.' : 'Undo a turn, knot or loop taken up before. Nothing to undo? Shorten the other mains of this section by the same amount instead.' };
  if (hasLoop) return { id: 'loops', text: 'Move it up to the next trim loop.' };
  return Math.abs(mm) < 8
    ? { id: 'wrap', text: 'Try one extra turn of the larks head.' }
    : { id: 'knot', text: 'Try a knot in the end loop (or a turn, if it gets closer).' };
}
