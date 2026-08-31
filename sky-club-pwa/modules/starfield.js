// starfield.js — animated twinkling-star background for the Explore screen, drawn
// on a canvas (cheap: a couple hundred circles, no images). Nebula/galaxy blobs are
// plain CSS (see app.css .galaxy) since a blurred gradient div is free to composite
// and doesn't need per-frame JS at all.

const DENSITY = 3400; // px² per star — lower is denser

export function initStarfield(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0, h = 0, stars = [];
  let shootAt = performance.now() + 2500 + Math.random() * 9000;
  let shoot = null;

  function resize() {
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const count = Math.max(40, Math.round((w * h) / DENSITY));
    // A handful of "hero" stars get a bigger disc + a lens-flare cross (drawn in
    // drawStars) — a field of same-size dots reads as flat; a couple of bright
    // sparkly ones give it the depth real astrophotography has.
    const flareCount = Math.min(5, Math.max(2, Math.round(count / 45)));
    stars = Array.from({ length: count }, (_, i) => {
      const flare = i < flareCount;
      return {
        x: Math.random() * w,
        y: Math.random() * h,
        r: flare ? 1.8 + Math.random() * 0.5 : Math.random() * 1.2 + 0.3,
        base: Math.random() * 0.5 + 0.35,
        phase: Math.random() * Math.PI * 2,
        speed: Math.random() * 0.8 + 0.25,
        flare,
      };
    });
  }

  function drawStars(t) {
    ctx.clearRect(0, 0, w, h);
    for (const s of stars) {
      const a = s.base * (0.55 + 0.45 * Math.sin((t / 1000) * s.speed + s.phase));
      ctx.globalAlpha = a;
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
      if (s.flare) {
        const len = s.r * 9 + 3;
        ctx.globalAlpha = a * 0.55;
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(s.x - len, s.y); ctx.lineTo(s.x + len, s.y);
        ctx.moveTo(s.x, s.y - len); ctx.lineTo(s.x, s.y + len);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
  }

  // Every meteor is re-rolled from scratch: which edge it enters from, where along
  // that edge, its angle, speed, length and brightness — and the wait until the
  // next one is re-rolled too. The old version always started in the top-left
  // quadrant and always travelled down-right, which after a minute or two read as
  // the same streak on a loop rather than something you happened to catch.
  function spawnShootingStar() {
    const fromLeft = Math.random() < 0.62; // most come in from the left, not all
    const speed = 6 + Math.random() * 6;
    // Steep enough to look like it is falling, never so steep it drops straight down.
    const angle = (14 + Math.random() * 34) * (Math.PI / 180);
    const dirX = fromLeft ? 1 : -1;
    return {
      x: fromLeft ? -30 + Math.random() * w * 0.45 : w + 30 - Math.random() * w * 0.45,
      y: -20 + Math.random() * h * 0.55,
      vx: Math.cos(angle) * speed * dirX,
      vy: Math.sin(angle) * speed,
      len: 7 + Math.random() * 7,      // trail length, in frames of travel
      width: 1.3 + Math.random() * 1.2,
      alpha: 0.65 + Math.random() * 0.35,
      life: 0,
      ttl: 620 + Math.random() * 520,
    };
  }

  function drawShootingStar(t) {
    if (!shoot && t > shootAt && w > 0) shoot = spawnShootingStar();
    if (!shoot) return;

    shoot.life += 16;
    shoot.x += shoot.vx;
    shoot.y += shoot.vy;

    // Fade in over the first fifth and out over the last third, so it never
    // pops into or out of existence mid-screen.
    const p = shoot.life / shoot.ttl;
    const fade = Math.min(1, p / 0.2) * Math.min(1, (1 - p) / 0.33);
    const tailX = shoot.x - shoot.vx * shoot.len;
    const tailY = shoot.y - shoot.vy * shoot.len;
    const grad = ctx.createLinearGradient(shoot.x, shoot.y, tailX, tailY);
    grad.addColorStop(0, `rgba(255,255,255,${(shoot.alpha * fade).toFixed(3)})`);
    grad.addColorStop(0.45, `rgba(214,210,255,${(shoot.alpha * fade * 0.45).toFixed(3)})`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = shoot.width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(shoot.x, shoot.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();

    const gone = shoot.x < -80 || shoot.x > w + 80 || shoot.y > h + 80;
    if (shoot.life > shoot.ttl || gone) {
      shoot = null;
      // A wide, uneven gap. Short enough that you do see them, long and variable
      // enough that they never settle into a beat you can predict.
      shootAt = t + 5000 + Math.random() * 16000;
    }
  }

  function frame(t) {
    drawStars(t);
    drawShootingStar(t);
    requestAnimationFrame(frame);
  }

  resize();
  window.addEventListener('resize', resize);
  requestAnimationFrame(frame);
}
