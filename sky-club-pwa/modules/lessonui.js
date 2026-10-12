// lessonui.js — small helpers shared by the Discover lessons.

/**
 * Moves a lesson's Play button, and the quick buttons that act on the same
 * animation (Today, Full Moon…), to a slim row just above the lesson's picture, so
 * you can play, pause and jump without scrolling down to the controls. The same
 * button elements move, so each lesson's click handlers keep working.
 *   buttonSel   the Play button
 *   also        selectors of the other buttons to bring along, in order
 *   before      the row is inserted before this element (the picture)
 */
export function liftPlay(root, buttonSel, { before, also = [] } = {}) {
  const btn = root.querySelector(buttonSel);
  const anchor = before && root.querySelector(before);
  if (!btn || !anchor) return;
  btn.classList.add('play-top');
  const row = document.createElement('div');
  row.className = 'play-row';
  row.appendChild(btn);
  for (const sel of also) {
    const extra = root.querySelector(sel);
    if (extra) row.appendChild(extra);
  }
  anchor.parentNode.insertBefore(row, anchor);
  // The old button group is empty now; remove it so it leaves no gap.
  root.querySelectorAll('.lesson-buttons').forEach((g) => { if (!g.children.length) g.remove(); });
}
