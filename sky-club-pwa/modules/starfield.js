// starfield.js — animated twinkling-star background for the Explore screen, drawn
// on a canvas (cheap: a couple hundred circles, no images). Nebula/galaxy blobs are
// plain CSS (see app.css .galaxy) since a blurred gradient div is free to composite
// and doesn't need per-frame JS at all.

const DENSITY = 3400; // px² per star — lower is denser

export function initStarfield(canvas) {
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let w = 0, h = 0, stars = [];
  let shootAt = performance.now() + 4000 + Math.random() * 8000;
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

  function drawShootingStar(t) {
    if (!shoot && t > shootAt && w > 0) {
      shoot = {
        x: Math.random() * w * 0.5,
        y: Math.random() * h * 0.35,
        vx: 7 + Math.random() * 4,
        vy: 3 + Math.random() * 2,
        life: 0,
      };
    }
    if (!shoot) return;
    shoot.life += 16;
    shoot.x += shoot.vx;
    shoot.y += shoot.vy;
    const tailX = shoot.x - shoot.vx * 9;
    const tailY = shoot.y - shoot.vy * 9;
    const grad = ctx.createLinearGradient(shoot.x, shoot.y, tailX, tailY);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(shoot.x, shoot.y);
    ctx.lineTo(tailX, tailY);
    ctx.stroke();
    if (shoot.life > 700 || shoot.x - w > 40 || shoot.y - h > 40) {
      shoot = null;
      shootAt = t + 7000 + Math.random() * 12000;
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
