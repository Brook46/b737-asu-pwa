// moonphase.js — a real Moon phase graphic: a dark disc with the actual moon
// texture clipped into the correctly-shaped illuminated "lune" for the given
// phase angle. Not a gradient guess — the terminator is a genuine ellipse, so
// crescents and gibbous phases both read as a real sphere's day/night line.
//
// Geometry: the Moon's limb (outer edge) is always a perfect semicircle on the
// "growing" side (right while waxing, left while waning). The terminator is an
// ellipse through the same top/bottom poles with horizontal radius r*cos(theta),
// theta = phase angle (astro.js::moonPhase(), 0=new..180=full..360=new). When
// cos(theta) >= 0 the terminator bulges the SAME side as the limb (a thin
// crescent); when negative it bulges the OPPOSITE side (gibbous, growing toward
// full). This single rule holds for both waxing and waning — see CLAUDE.md.
//
// rotationDeg adds a slow cosmetic spin of the surface texture underneath that
// same fixed phase shape — the real Moon is tidally locked and doesn't visibly
// turn from Earth, but a frozen image reads as static/dead on a screen. The
// phase outline (what's scientifically real) stays exactly correct either way;
// only which part of the surface shows through it drifts.

let moonImg = null;
function getMoonImage() {
  if (!moonImg) {
    moonImg = new Image();
    moonImg.src = 'icons/textures/moon.jpg';
  }
  return moonImg;
}

/** phaseDeg: 0=new, 90=first quarter, 180=full, 270=last quarter. */
export function drawMoonPhase(canvas, phaseDeg, rotationDeg = 0) {
  const img = getMoonImage();
  if (img.complete) paint(canvas, phaseDeg, rotationDeg, img);
  else img.onload = () => paint(canvas, phaseDeg, rotationDeg, img);
}

function paint(canvas, phaseDeg, rotationDeg, img) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2;
  const norm = ((phaseDeg % 360) + 360) % 360;
  const waxing = norm < 180;
  const k = Math.cos((norm * Math.PI) / 180); // +1 new .. 0 quarter .. -1 full
  const trx = Math.abs(r * k);
  const terminatorSameSideAsLimb = k >= 0;
  const throughRight = waxing ? terminatorSameSideAsLimb : !terminatorSameSideAsLimb;
  const shift = (((rotationDeg % 360) + 360) % 360) / 360 * W;

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // Faint whole-disc "earthshine" pass, so even the dark side hints at real
  // surface detail instead of a flat void — and it turns with the bright side,
  // so the two halves read as one sphere rather than a sticker on a backdrop.
  ctx.fillStyle = '#12111a';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.16;
  drawWrapped(ctx, img, shift, W, H);
  ctx.globalAlpha = 1;

  // Lit lune: limb semicircle (top->bottom) + terminator ellipse (bottom->top),
  // full brightness, clipped to the actual illuminated shape.
  ctx.beginPath();
  ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, !waxing);
  if (throughRight) {
    ctx.ellipse(cx, cy, trx, r, 0, Math.PI / 2, -Math.PI / 2, true);
  } else {
    ctx.ellipse(cx, cy, trx, r, 0, Math.PI / 2, Math.PI * 1.5, false);
  }
  ctx.closePath();
  ctx.clip();
  drawWrapped(ctx, img, shift, W, H);
  ctx.restore();
}

// Two copies of the image, shift px apart, cover any wrap offset seamlessly —
// same idea as the CSS 200%-width scroll trick used elsewhere, done by hand
// here since canvas has no background-position to lean on.
function drawWrapped(ctx, img, shift, W, H) {
  ctx.drawImage(img, -shift, 0, W, H);
  ctx.drawImage(img, W - shift, 0, W, H);
}
