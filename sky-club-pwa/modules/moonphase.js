// moonphase.js — a real Moon phase graphic: the actual moon texture, lit through
// the correctly-shaped illuminated "lune" for the given phase angle. Not a
// gradient guess — the terminator is a genuine ellipse, so crescents and gibbous
// phases both read as a real sphere's day/night line.
//
// Geometry: the Moon's limb (outer edge) is always a perfect semicircle on the
// "growing" side (right while waxing, left while waning). The terminator is an
// ellipse through the same top/bottom poles with horizontal radius r*cos(theta),
// theta = phase angle (astro.js::moonPhase(), 0=new..180=full..360=new). When
// cos(theta) >= 0 the terminator bulges the SAME side as the limb (a thin
// crescent); when negative it bulges the OPPOSITE side (gibbous, growing toward
// full). This single rule holds for both waxing and waning — see CLAUDE.md.
//
// Three things separate this from a disc with a bite taken out of it, and all
// three come from how the real Moon photographs:
//   • a SOFT terminator. The day/night line is a penumbra a few percent of the
//     radius wide, never a hard cut — a crisp edge is the single biggest giveaway
//     of a fake moon. Built as a blurred alpha mask (cached per phase, since it
//     only changes when the phase does, not when the surface drifts).
//   • LIMB DARKENING. The disc dims toward its edge; without it a lit moon reads
//     as a flat sticker no matter how good the texture is.
//   • EARTHSHINE. The unlit side is never black — it is lit by sunlight bounced
//     off Earth, and is faintly blue because Earth is blue.
//
// rotationDeg adds a slow cosmetic spin of the surface texture underneath that
// same fixed phase shape — the real Moon is tidally locked and doesn't visibly
// turn from Earth, but a frozen image reads as static/dead on a screen. The
// phase outline (what's scientifically real) stays exactly correct either way;
// only which part of the surface shows through it drifts.

const TERMINATOR_SOFTNESS = 0.055; // blur radius as a fraction of the disc radius

let moonImg = null;
function getMoonImage() {
  if (!moonImg) {
    moonImg = new Image();
    moonImg.src = 'icons/textures/moon.jpg';
  }
  return moonImg;
}

// Scratch canvases reused across frames — this runs in a rAF loop while the
// Moon's card is open, so allocating per frame would churn badly on an iPad.
let maskCv = null, maskKey = '';
let litCv = null;

function scratch(existing, w, h) {
  const c = existing || document.createElement('canvas');
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}

function supportsFilter(ctx) {
  if (ctx.filter === undefined) return false;
  ctx.filter = 'blur(1px)';
  const ok = ctx.filter !== 'none';
  ctx.filter = 'none';
  return ok;
}

/** phaseDeg: 0=new, 90=first quarter, 180=full, 270=last quarter. */
export function drawMoonPhase(canvas, phaseDeg, rotationDeg = 0) {
  const img = getMoonImage();
  if (img.complete) paint(canvas, phaseDeg, rotationDeg, img);
  else img.onload = () => paint(canvas, phaseDeg, rotationDeg, img);
}

// The lit shape, as a soft-edged white mask. Depends only on phase + size, so it
// is rebuilt only when one of those changes — not on every spin frame.
function buildMask(W, H, phaseDeg) {
  const key = `${W}x${H}:${Math.round(phaseDeg * 2)}`;
  if (maskCv && maskKey === key) return maskCv;

  maskCv = scratch(maskCv, W, H);
  maskKey = key;
  const m = maskCv.getContext('2d');
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2;
  const norm = ((phaseDeg % 360) + 360) % 360;
  const waxing = norm < 180;
  const k = Math.cos((norm * Math.PI) / 180); // +1 new .. 0 quarter .. -1 full
  const trx = Math.abs(r * k);
  const terminatorSameSideAsLimb = k >= 0;
  const throughRight = waxing ? terminatorSameSideAsLimb : !terminatorSameSideAsLimb;

  m.clearRect(0, 0, W, H);
  if (supportsFilter(m)) m.filter = `blur(${Math.max(1, r * TERMINATOR_SOFTNESS).toFixed(2)}px)`;
  m.fillStyle = '#fff';
  m.beginPath();
  m.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, !waxing);
  if (throughRight) {
    m.ellipse(cx, cy, trx, r, 0, Math.PI / 2, -Math.PI / 2, true);
  } else {
    m.ellipse(cx, cy, trx, r, 0, Math.PI / 2, Math.PI * 1.5, false);
  }
  m.closePath();
  m.fill();
  m.filter = 'none';
  return maskCv;
}

function paint(canvas, phaseDeg, rotationDeg, img) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  if (!W || !H) return;
  const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2;
  const shift = (((rotationDeg % 360) + 360) % 360) / 360 * W;

  ctx.clearRect(0, 0, W, H);
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();

  // EARTHSHINE — the night side, faintly lit by light bounced off Earth. Sits on
  // a blue-tinted base rather than neutral black for the same reason.
  ctx.fillStyle = '#141726';
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 0.2;
  drawWrapped(ctx, img, shift, W, H);
  ctx.globalAlpha = 1;

  // LIT SIDE — full-brightness surface, cut out by the soft-edged phase mask.
  litCv = scratch(litCv, W, H);
  const l = litCv.getContext('2d');
  l.globalCompositeOperation = 'source-over';
  l.clearRect(0, 0, W, H);
  drawWrapped(l, img, shift, W, H);
  l.globalCompositeOperation = 'destination-in';
  l.drawImage(buildMask(W, H, phaseDeg), 0, 0);
  l.globalCompositeOperation = 'source-over';
  ctx.drawImage(litCv, 0, 0);

  // LIMB DARKENING — the disc falls off toward its edge.
  const limb = ctx.createRadialGradient(cx, cy, r * 0.55, cx, cy, r);
  limb.addColorStop(0, 'rgba(0,0,0,0)');
  limb.addColorStop(0.75, 'rgba(8,7,14,0.10)');
  limb.addColorStop(0.93, 'rgba(8,7,14,0.30)');
  limb.addColorStop(1, 'rgba(6,5,12,0.55)');
  ctx.fillStyle = limb;
  ctx.fillRect(0, 0, W, H);

  ctx.restore();
}

// Two copies of the image, shift px apart, cover any wrap offset seamlessly —
// same idea as the CSS 200%-width scroll trick used elsewhere, done by hand
// here since canvas has no background-position to lean on.
function drawWrapped(ctx, img, shift, W, H) {
  ctx.drawImage(img, -shift, 0, W, H);
  ctx.drawImage(img, W - shift, 0, W, H);
}

// The four "exact" phases are moments, not thirds of a month, so they get narrow
// windows and the crescent/gibbous names cover the long stretches between. Using
// nearest-of-eight instead produced things like "First quarter · 62% lit", which
// is a contradiction — a quarter moon is 50% lit by definition.
const PHASE_BANDS = [
  [10, 'New moon'], [80, 'Waxing crescent'], [100, 'First quarter'],
  [170, 'Waxing gibbous'], [190, 'Full moon'], [260, 'Waning gibbous'],
  [280, 'Last quarter'], [350, 'Waning crescent'], [360, 'New moon'],
];

/** A human name for a phase angle, plus how much of the disc is lit. */
export function describePhase(phaseDeg) {
  const norm = ((phaseDeg % 360) + 360) % 360;
  // Illuminated fraction of the visible disc: (1 - cos(theta)) / 2.
  const lit = Math.round(((1 - Math.cos((norm * Math.PI) / 180)) / 2) * 100);
  const band = PHASE_BANDS.find(([upTo]) => norm < upTo);
  return { name: band ? band[1] : 'New moon', lit };
}
