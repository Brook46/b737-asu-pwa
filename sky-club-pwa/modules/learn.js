// learn.js — the Discover tab: short, true explanations, each with a live picture
// driven by the same ephemeris as the rest of the app.
//   • Why the Moon changes shape — the Sun always lights half of it.
//   • Why days are longer in summer — Earth's tilt, and the real day length here.
//   • How big things are — planets and stars, compared and to scale.
//   • From the universe to you — one continuous zoom through real scales (zoom.js).
//   • Why the sea goes in and out — the Moon and the Sun pull the oceans into bumps.
// Every number on these screens is computed, never typed in.

import { moonPhase, sunDeclinationDeg, helioEcliptic } from './astro.js?v=27';
import { drawMoonPhase, describePhase } from './moonphase.js?v=27';
import { Globe, loadTexture, frameFromPole } from './globe.js?v=27';
import { poleOf, LOOKS, earthClouds } from './orrery3d.js?v=27';
import { SKY_BODIES } from './catalog.js?v=27';
import { sensorState, primeLocation } from './sensors.js?v=27';
import { mountZoom, unmountZoom } from './zoom.js?v=27';
import { mountSurface } from './surface.js?v=27';
import { liftPlay } from './lessonui.js?v=27';
import { say } from './speech.js?v=27';

const DEG = Math.PI / 180;
const SYNODIC = 29.530588; // days from one New Moon to the next
const VIEW_PITCH = 28 * DEG; // the seasons picture is seen from a little above the orbit
const SP = Math.sin(VIEW_PITCH), CP = Math.cos(VIEW_PITCH);

const $ = (root, sel) => root.querySelector(sel);
const isLessonOpen = () => document.getElementById('lesson-screen').classList.contains('active');

// Canvas sized to its CSS box, drawing in CSS pixels.
function sizeCanvas(c) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = c.clientWidth, h = c.clientHeight;
  const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
  if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
  const ctx = c.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  return { ctx, w, h };
}

// Canvases that paint a bitmap directly (drawMoonPhase) need device pixels and
// an identity transform, so they are sized separately.
function squareCanvas(c, cssSize) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const px = Math.round(cssSize * dpr);
  // Both sides, always: a fresh canvas is 300×150, so checking only the width
  // left the height at 150 and squashed the disc.
  if (c.width !== px || c.height !== px) { c.width = px; c.height = px; }
  c.style.width = `${cssSize}px`;
  c.style.height = `${cssSize}px`;
  return c;
}

function userLat() {
  if (!sensorState.hasLocation) primeLocation();
  return sensorState.lat ?? 32.0853;
}
function userLon() {
  if (!sensorState.hasLocation) primeLocation();
  return sensorState.lon ?? 34.7818;
}

const fmtHM = (hours) => {
  const total = Math.round(hours * 60);
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`;
};

// ---------------------------------------------------------------------------
// Lesson 1 — why the Moon changes shape
// ---------------------------------------------------------------------------

function buildMoon(root) {
  root.innerHTML = `
    <p class="lesson-lead">The Sun always lights up <b>half</b> of the Moon: the half that faces the Sun. As the Moon goes round us, we see more or less of that bright half.</p>
    <canvas id="moon-top" class="lesson-canvas" style="height:200px"></canvas>
    <div class="lesson-row">
      <canvas id="moon-disc"></canvas>
      <div class="lesson-readout">
        <div id="moon-name" class="lesson-big"></div>
        <div id="moon-lit" class="lesson-sub"></div>
        <div id="moon-age" class="lesson-small"></div>
      </div>
    </div>
    <label class="lesson-label">Days since New Moon: <span id="moon-days-val"></span>
      <input id="moon-days" type="range" min="0" max="${SYNODIC}" step="0.05"></label>
    <div class="lesson-buttons">
      <button id="moon-play" class="lesson-pill"><i class="ph-fill ph-play"></i> Play</button>
      <button id="moon-today" class="lesson-pill"><i class="ph-fill ph-clock"></i> Today</button>
    </div>
    <ol class="lesson-steps">
      <li><b>Full Moon:</b> the whole bright side faces us.</li>
      <li><b>Half Moon:</b> we see half of the bright side.</li>
      <li><b>New Moon:</b> the bright side faces away from us, so we can't see it.</li>
    </ol>
    <p class="lesson-note">The Moon goes all the way round us in about one month. Then the shapes start again.</p>`;

  liftPlay(root, '#moon-play', { before: '#moon-top', also: ['#moon-today'] });
  const slider = $(root, '#moon-days');
  const top = $(root, '#moon-top');
  const disc = squareCanvas($(root, '#moon-disc'), 150);
  const ageToday = () => (moonPhase(new Date()) / 360) * SYNODIC;
  let days = ageToday();
  slider.value = days;
  let playing = false, raf = 0, last = 0;

  const render = () => {
    const phase = (days / SYNODIC) * 360;
    drawMoonTop(top, phase);
    drawMoonPhase(disc, phase, 0);
    const { name, lit } = describePhase(phase);
    $(root, '#moon-name').textContent = name;
    $(root, '#moon-lit').textContent = `We can see ${lit}% of its bright side`;
    $(root, '#moon-age').textContent = `Day ${Math.floor(days) + 1} of about 29½`;
    $(root, '#moon-days-val').textContent = days.toFixed(1);
  };

  slider.addEventListener('input', () => { days = parseFloat(slider.value); render(); });
  $(root, '#moon-today').addEventListener('click', () => { days = ageToday(); slider.value = days; render(); });
  const play = $(root, '#moon-play');
  play.addEventListener('click', () => {
    playing = !playing;
    play.innerHTML = playing ? '<i class="ph-fill ph-pause"></i> Pause' : '<i class="ph-fill ph-play"></i> Play';
  });

  const tick = (now) => {
    if (!isLessonOpen() || !root.isConnected) return;
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (playing) {
      days = (days + dt * 4) % SYNODIC; // a whole cycle in about seven seconds
      slider.value = days;
      render();
    }
  };
  render();
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

// Top-down view: the Sun far to the left, Earth in the middle, the Moon on its
// orbit. Whichever side faces the Sun is the lit side, always — and we look
// from Earth, so what we see depends on where the Moon has got to.
function drawMoonTop(c, phase) {
  const { ctx, w, h } = sizeCanvas(c);
  const cy = h / 2, cx = w * 0.64;
  const R = Math.min(h * 0.36, w * 0.26);

  // Sunlight: parallel rays arriving from the left.
  ctx.strokeStyle = 'rgba(255,205,120,0.2)';
  ctx.lineWidth = 1;
  for (let k = -3; k <= 3; k++) {
    const y = cy + k * h * 0.12;
    ctx.beginPath(); ctx.moveTo(44, y); ctx.lineTo(cx - R - 26, y); ctx.stroke();
  }
  const sg = ctx.createRadialGradient(10, cy, 0, 10, cy, 40);
  sg.addColorStop(0, 'rgba(255,220,150,0.9)');
  sg.addColorStop(0.35, 'rgba(255,180,90,0.35)');
  sg.addColorStop(1, 'rgba(255,160,80,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, cy - 40, 60, 80);
  ctx.font = '700 14px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,226,180,0.95)';
  ctx.fillText('Sun', 4, Math.max(12, cy - 46));

  // The Moon's orbit.
  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = 'rgba(210,215,240,0.35)';
  ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  ctx.setLineDash([]);

  // Earth, and the line from Earth to the Moon: that is the way we look.
  const a = phase * DEG;
  const mx = cx - R * Math.cos(a), my = cy + R * Math.sin(a);
  ctx.setLineDash([2, 4]);
  ctx.strokeStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(mx, my); ctx.stroke();
  ctx.setLineDash([]);
  ctx.fillStyle = '#5aa4e8';
  ctx.beginPath(); ctx.arc(cx, cy, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(233,233,237,0.95)';
  ctx.font = '700 14px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('Earth (us)', cx, cy + 28);

  // The Moon: a dark ball, with its sunlit half on the side facing the Sun.
  const mr = 11;
  ctx.fillStyle = '#2b2f45';
  ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#eceef6';
  ctx.beginPath(); ctx.arc(mx, my, mr, Math.PI / 2, Math.PI * 1.5); ctx.fill();
}

// ---------------------------------------------------------------------------
// Lesson 2 — why days are longer in summer
// ---------------------------------------------------------------------------

// Hours of daylight at a latitude on a day with the Sun at this declination.
// Counts from sunrise to sunset with the Sun's upper edge at −0.83° (refraction).
function daylightHours(latDeg, decDeg) {
  const phi = latDeg * DEG, dl = decDeg * DEG;
  const c = (Math.sin(-0.833 * DEG) - Math.sin(phi) * Math.sin(dl)) / (Math.cos(phi) * Math.cos(dl));
  if (c <= -1) return 24; // the Sun never sets
  if (c >= 1) return 0;   // the Sun never rises
  return (2 * Math.acos(c) / DEG) / 15;
}

function buildSeasons(root) {
  const now = new Date();
  const start = Date.UTC(now.getUTCFullYear(), 0, 1, 12);
  const dateOf = (d) => new Date(start + d * 86400000);
  const decs = [];
  for (let d = 0; d <= 365; d++) decs.push(sunDeclinationDeg(dateOf(d)));

  const lat = userLat(), lon = userLon();
  const latTxt = `${Math.abs(lat).toFixed(1)}° ${lat >= 0 ? 'N' : 'S'}`;
  root.innerHTML = `
    <p class="lesson-lead">Earth leans over a little, like a spinning top. In <b>summer</b>, your half leans toward the Sun: the Sun climbs high and the days are long. In <b>winter</b>, your half leans away: the Sun stays low and the days are short.</p>
    <canvas id="season-orbit" class="lesson-canvas" style="height:250px"></canvas>
    <div class="lesson-cards">
      <div><div class="lesson-small">Daylight where you are (${latTxt})</div><div id="season-hours" class="lesson-big"></div></div>
      <div><div class="lesson-small">Sun at midday</div><div id="season-noon" class="lesson-big"></div></div>
    </div>
    <p class="lesson-small">Side view: how high the Sun is at midday, where you are</p>
    <canvas id="season-sun" class="lesson-canvas" style="height:130px"></canvas>
    <p id="season-now" class="lesson-sub"></p>
    <canvas id="season-chart" class="lesson-canvas" style="height:120px"></canvas>
    <label class="lesson-label"><span id="season-date"></span>
      <input id="season-day" type="range" min="0" max="365" step="1"></label>
    <div class="lesson-buttons">
      <button id="season-play" class="lesson-pill"><i class="ph-fill ph-play"></i> Play the year</button>
      <button id="season-today" class="lesson-pill"><i class="ph-fill ph-clock"></i> Today</button>
    </div>
    <p class="lesson-note">Surprise: Earth is closest to the Sun in January, which is winter in the north. So it is the lean that makes the seasons, not the distance.</p>`;

  const dayToday = Math.min(365, Math.max(0, Math.floor((now - start) / 86400000)));
  let day = dayToday;
  const slider = $(root, '#season-day');
  slider.value = day;
  const globe = new Globe(56);
  const tex = loadTexture(SKY_BODIES.earth.texture);
  const pole = poleOf('earth');
  const frame = frameFromPole(pole);
  const orbitC = $(root, '#season-orbit');
  const chartC = $(root, '#season-chart');

  // The view: a little above the orbit, Sun at the centre.
  const view = (v) => [v[0], v[1] * SP + v[2] * CP, -v[1] * CP + v[2] * SP];

  const drawOrbit = () => {
    const { ctx, w, h } = sizeCanvas(orbitC);
    const cx = w / 2, cy = h / 2 + 8;
    // The orbit is seen from 28° above, so it is a flat ellipse: the width limits it.
    const S = Math.min(w * 0.36, h * 0.6) / 1.05; // pixels per AU, with room for the labels

    ctx.strokeStyle = 'rgba(210,215,240,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k <= 120; k++) {
      const v = view(helioEcliptic('Earth', dateOf((k / 120) * 365.25)));
      const x = cx + v[0] * S, y = cy - v[1] * S;
      if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();

    // The four key days, so each season has a name on the picture.
    const keyDays = [
      { m: 5, d: 21, text: 'June: summer (N)', col: '#ffb35c' },
      { m: 8, d: 22, text: 'Sept: equal', col: 'rgba(233,233,237,0.9)' },
      { m: 11, d: 21, text: 'Dec: winter (N)', col: '#8fb8ff' },
      { m: 2, d: 20, text: 'March: equal', col: 'rgba(233,233,237,0.9)' },
    ];
    const e = helioEcliptic('Earth', dateOf(day));
    const ev = view(e);
    const ex = cx + ev[0] * S, ey = cy - ev[1] * S;
    const r = Math.max(9, Math.min(w, h) * 0.09);
    const year0 = new Date(start).getUTCFullYear();
    for (const k of keyDays) {
      const kd = Math.round((Date.UTC(year0, k.m, k.d, 12) - start) / 86400000);
      const kv = view(helioEcliptic('Earth', dateOf(kd)));
      const kx = cx + kv[0] * S, ky = cy - kv[1] * S;
      const ang = Math.atan2(ky - cy, kx - cx);
      ctx.fillStyle = k.col;
      ctx.beginPath(); ctx.arc(kx, ky, 4, 0, Math.PI * 2); ctx.fill();
      ctx.font = '700 13px Inter, system-ui, sans-serif';
      const tw = ctx.measureText(k.text).width;
      // Top and bottom points: the name sits above or below, centred.
      // Side points: the name sits outward, clear of the Sun.
      let lx, ly;
      if (Math.sin(ang) > 0.5) { ctx.textAlign = 'center'; lx = kx; ly = ky + 16; }
      else if (Math.sin(ang) < -0.5) { ctx.textAlign = 'center'; lx = kx; ly = ky - 16; }
      else { lx = kx + Math.cos(ang) * 12; ly = ky; ctx.textAlign = Math.cos(ang) >= 0 ? 'left' : 'right'; }
      // Earth is on this point today: move the name clear of the globe.
      if (Math.hypot(kx - ex, ky - ey) < r + 26) {
        ctx.textAlign = 'center'; lx = kx;
        ly = Math.sin(ang) < -0.5 ? ky - r - 14 : ky + r + 16;
      }
      if (ctx.textAlign === 'center') lx = Math.min(Math.max(lx, tw / 2 + 4), w - tw / 2 - 4);
      if (ctx.textAlign === 'left' && lx + tw > w - 4) ctx.textAlign = 'right';
      if (ctx.textAlign === 'right' && lx - tw < 4) ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = k.col;
      ctx.fillText(k.text, lx, ly);
    }
    ctx.textBaseline = 'alphabetic';

    const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, 26);
    sg.addColorStop(0, 'rgba(255,240,200,1)');
    sg.addColorStop(0.3, 'rgba(255,190,100,0.45)');
    sg.addColorStop(1, 'rgba(255,150,70,0)');
    ctx.fillStyle = sg;
    ctx.fillRect(cx - 26, cy - 26, 52, 52);
    ctx.font = '700 13px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(255,226,180,0.95)';
    ctx.fillText('Sun', cx, cy + 38);

    // Sunlight: an arrow from the Sun toward Earth, stopping short of it.
    {
      const L = Math.hypot(ex - cx, ey - cy);
      const ux = (ex - cx) / L, uy = (ey - cy) / L;
      const x1 = cx + ux * 30, y1 = cy + uy * 30;
      const x2 = ex - ux * (r + 8), y2 = ey - uy * (r + 8);
      ctx.strokeStyle = 'rgba(255,214,140,0.85)';
      ctx.fillStyle = 'rgba(255,214,140,0.85)';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
      const hx = x2, hy = y2, a = Math.atan2(y2 - y1, x2 - x1);
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx - 10 * Math.cos(a - 0.4), hy - 10 * Math.sin(a - 0.4));
      ctx.lineTo(hx - 10 * Math.cos(a + 0.4), hy - 10 * Math.sin(a + 0.4));
      ctx.closePath(); ctx.fill();
      ctx.font = '700 12px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('sunlight', (x1 + x2) / 2 + uy * 14, (y1 + y2) / 2 - ux * 14);
    }
    // Earth, lit from the Sun's side, with its real axial tilt.
    const sunV = view([-e[0], -e[1], -e[2]]);
    const sl = Math.hypot(sunV[0], sunV[1], sunV[2]) || 1;
    const vx = (v) => view(v);
    globe.resize(Math.round(2 * r * Math.min(window.devicePixelRatio || 1, 2)));
    const bx = vx(frame.ex), by = vx(frame.ey), bz = vx(frame.ez);
    globe.setOrientation(bx, by, bz);
    globe.render({
      tex, light: [sunV[0] / sl, sunV[1] / sl, sunV[2] / sl], ambient: 0.05,
      atmo: LOOKS.earth.atmo, ocean: true,
      clouds: { map: earthClouds(), turns: day / 365, alpha: 0.8 },
    });
    ctx.drawImage(globe.canvas, ex - r, ey - r, 2 * r, 2 * r);

    // The axis: a dashed line through Earth, pointing to the north pole.
    const pv = vx(pole);
    const L = r * 1.9;
    ctx.setLineDash([3, 3]);
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath(); ctx.moveTo(ex - pv[0] * L, ey + pv[1] * L); ctx.lineTo(ex + pv[0] * L, ey - pv[1] * L); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = '#ffd7a0';
    ctx.font = '700 13px Inter, system-ui, sans-serif';
    ctx.fillText('N', ex + pv[0] * L * 1.2, ey - pv[1] * L * 1.2 + 3);
  };

  const drawChart = () => {
    const { ctx, w, h } = sizeCanvas(chartC);
    const x0 = 26, x1 = w - 8, y0 = 8, y1 = h - 20;
    const yOf = (hrs) => y1 - (hrs / 24) * (y1 - y0);
    // 12-hour line
    ctx.setLineDash([3, 4]);
    ctx.strokeStyle = 'rgba(210,215,240,0.25)';
    ctx.beginPath(); ctx.moveTo(x0, yOf(12)); ctx.lineTo(x1, yOf(12)); ctx.stroke();
    ctx.setLineDash([]);
    // the year's daylight at your latitude
    const hrs = decs.map((dec) => daylightHours(lat, dec));
    ctx.beginPath();
    hrs.forEach((hh, d) => {
      const x = x0 + (d / 365) * (x1 - x0);
      if (d) ctx.lineTo(x, yOf(hh)); else ctx.moveTo(x, yOf(hh));
    });
    ctx.strokeStyle = 'rgba(255,200,120,0.95)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(x1, y1); ctx.lineTo(x0, y1); ctx.closePath();
    ctx.fillStyle = 'rgba(255,200,120,0.1)';
    ctx.fill();
    // today's marker
    const mx = x0 + (day / 365) * (x1 - x0);
    ctx.strokeStyle = 'rgba(231,229,254,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(mx, y0); ctx.lineTo(mx, y1); ctx.stroke();
    ctx.beginPath(); ctx.arc(mx, yOf(hrs[day]), 4, 0, Math.PI * 2); ctx.fillStyle = '#e7e5fe'; ctx.fill();
    ctx.font = '700 12px Inter, system-ui, sans-serif';
    ctx.textAlign = mx > w * 0.7 ? 'right' : 'left';
    ctx.fillStyle = '#e7e5fe';
    ctx.fillText(`today: ${fmtHM(hrs[day])}`, mx + (mx > w * 0.7 ? -8 : 8), yOf(hrs[day]) - 10);
    // axis labels
    ctx.fillStyle = 'rgba(210,215,240,0.7)';
    ctx.font = '600 10px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    const months = 'JFMAMJJASOND';
    for (let m = 0; m < 12; m++) ctx.fillText(months[m], x0 + ((m * 30.4 + 15) / 365) * (x1 - x0), h - 5);
    ctx.textAlign = 'right';
    ctx.fillText('24 h', x0 - 4, y0 + 8);
    ctx.fillText('0 h', x0 - 4, y1);
  };

  // Side view: the ground, you standing on it, and the Sun at its midday height.
  // The steeper the Sun, the more its light lands on each patch of ground.
  const drawSunHeight = () => {
    const { ctx, w, h } = sizeCanvas($(root, '#season-sun'));
    const alt = Math.max(0, 90 - Math.abs(lat - decs[day]));
    const gy = h - 16, px = w * 0.2, pillar = Math.min(h * 0.4, 52);
    ctx.strokeStyle = 'rgba(160,190,140,0.85)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(10, gy); ctx.lineTo(w - 10, gy); ctx.stroke();
    // you, as a simple figure
    ctx.fillStyle = '#ffe9c8';
    ctx.beginPath(); ctx.arc(px, gy - pillar + 6, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillRect(px - 2, gy - pillar + 12, 4, pillar - 12);
    // the Sun, at its height, and its rays down to you
    const R = Math.min(w * 0.4, h * 0.6);
    const a = alt * DEG;
    const sx = px + R * Math.cos(a), sy = gy - R * Math.sin(a);
    const sg = ctx.createRadialGradient(sx, sy, 0, sx, sy, 22);
    sg.addColorStop(0, 'rgba(255,240,200,1)');
    sg.addColorStop(0.4, 'rgba(255,190,100,0.5)');
    sg.addColorStop(1, 'rgba(255,160,80,0)');
    ctx.fillStyle = sg; ctx.fillRect(sx - 22, sy - 22, 44, 44);
    ctx.fillStyle = '#ffd27a';
    ctx.beginPath(); ctx.arc(sx, sy, 8, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,214,140,0.8)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(px, gy - pillar + 6); ctx.stroke();
    // the angle from the ground up to the Sun
    ctx.strokeStyle = 'rgba(233,233,237,0.6)';
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(px, gy); ctx.lineTo(px + R * 0.6, gy); ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '700 15px Inter, system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffe9c8';
    ctx.fillText(`${Math.round(alt)}° up`, px + 16, gy - 10);
    ctx.font = '600 13px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(233,233,237,0.9)';
    const word = alt > 60 ? 'High: strong, hot sunshine' : alt > 35 ? 'Middle: sunshine spread out' : 'Low: sunshine slanted, so less warmth';
    ctx.fillText(word, w * 0.42, 22);
  };

  const render = () => {
    const dec = decs[day];
    const hrs = daylightHours(lat, dec);
    $(root, '#season-hours').textContent = fmtHM(hrs);
    $(root, '#season-noon').textContent = `${Math.round(90 - Math.abs(lat - dec))}° high`;
    const d = dateOf(day);
    $(root, '#season-date').textContent = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' });
    $(root, '#season-day').value = day;
    const northSummer = dec > 1, southSummer = dec < -1;
    const youSummer = (lat >= 0 && northSummer) || (lat < 0 && southSummer);
    const youWinter = (lat >= 0 && southSummer) || (lat < 0 && northSummer);
    $(root, '#season-now').textContent = youSummer
      ? 'Summer where you are! Your half leans toward the Sun.'
      : youWinter
        ? 'Winter where you are! Your half leans away from the Sun.'
        : 'Day and night are about the same length today.';
    drawOrbit();
    drawChart();
    drawSunHeight();
  };

  slider.addEventListener('input', () => { day = parseInt(slider.value, 10); render(); });
  $(root, '#season-today').addEventListener('click', () => { day = dayToday; render(); });
  liftPlay(root, '#season-play', { before: '#season-orbit', also: ['#season-today'] });
  const play = $(root, '#season-play');
  let playing = false, raf = 0, last = 0, acc = 0;
  play.addEventListener('click', () => {
    playing = !playing;
    play.innerHTML = playing ? '<i class="ph-fill ph-pause"></i> Pause' : '<i class="ph-fill ph-play"></i> Play the year';
  });
  const tick = (now) => {
    if (!isLessonOpen() || !root.isConnected) return;
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (playing) {
      acc += dt * 30; // a month in a second
      if (acc >= 1) { day = (day + Math.floor(acc)) % 366; acc %= 1; render(); }
    }
  };
  render();
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

// ---------------------------------------------------------------------------
// Lesson 3 — how big things are
// ---------------------------------------------------------------------------

// Lesson 3 — how big things are. One picture at a time: Earth, and the chosen
// thing next to it, drawn at the same scale, with a bracket under each so the
// widths can be compared by eye. Arrows go from the smallest thing to the biggest.
const EARTH_KM = 12756;
const SIZE_ORDER = [
  { name: 'Moon', emoji: '🌙', km: 3475, col: '#dfe3ea', say: 'The Moon is smaller than Earth. About four Moons fit across Earth.' },
  { name: 'Mercury', emoji: '🪨', km: 4879, col: '#b9a89a', say: 'Mercury is a little bigger than the Moon, and smaller than Earth.' },
  { name: 'Mars', emoji: '🔴', km: 6792, col: '#e07a5f', say: 'Mars is about half as wide as Earth.' },
  { name: 'Venus', emoji: '🌕', km: 12104, col: '#e8c48c', say: 'Venus is almost exactly the same size as Earth.' },
  { name: 'Earth', emoji: '🌍', km: 12756, col: '#5aa4e8', say: 'This is Earth. Our home!' },
  { name: 'Uranus', emoji: '🔵', km: 50724, col: '#9fd8d8', say: 'Uranus is about four Earths wide.' },
  { name: 'Neptune', emoji: '🔷', km: 49244, col: '#5b7fe0', say: 'Neptune is about four Earths wide.' },
  { name: 'Saturn', emoji: '🪐', km: 120536, col: '#e8cf9a', say: 'Saturn is about nine Earths wide.' },
  { name: 'Jupiter', emoji: '🟠', km: 142984, col: '#d9a066', say: 'Jupiter is about eleven Earths wide. It is the biggest planet.' },
  { name: 'Sun', emoji: '☀️', km: 1392700, col: '#ffd27a', say: 'The Sun is about one hundred and nine Earths wide!' },
  { name: 'Betelgeuse', emoji: '⭐', km: 2 * 800 * 695700, col: '#ff8f6b', star: true, say: 'Betelgeuse is a star. It is about eight hundred Suns wide. It is far too big to fit on this screen.' },
];

// One lit ball, lit from the upper left.
function drawBall(ctx, x, y, r, col) {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.35, col);
  g.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

// A bracket under something, showing its width.
function bracket(ctx, x0, x1, y, label) {
  ctx.strokeStyle = 'rgba(233,233,237,0.75)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0, y - 7); ctx.lineTo(x0, y); ctx.lineTo(x1, y); ctx.lineTo(x1, y - 7);
  ctx.stroke();
  ctx.font = '700 15px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(233,233,237,0.95)';
  ctx.fillText(label, (x0 + x1) / 2, y + 18);
}

function buildSizes(root) {
  root.innerHTML = `
    <p class="lesson-lead">Earth is drawn next to each thing, at the <b>same size scale</b>. Tap the arrows to go from small to big.</p>
    <div class="size-nav">
      <button id="size-prev" class="size-arrow" aria-label="Smaller"><i class="ph-fill ph-caret-left"></i></button>
      <div id="size-name" class="size-name"></div>
      <button id="size-next" class="size-arrow" aria-label="Bigger"><i class="ph-fill ph-caret-right"></i></button>
    </div>
    <div id="size-dots" class="size-dots"></div>
    <canvas id="size-stage" class="lesson-canvas" style="height:250px"></canvas>
    <p id="size-say" class="size-say"></p>
    <p id="size-note" class="lesson-note"></p>`;

  const stage = $(root, '#size-stage');
  const nameEl = $(root, '#size-name');
  const sayEl = $(root, '#size-say');
  const noteEl = $(root, '#size-note');
  const dotsEl = $(root, '#size-dots');
  let index = SIZE_ORDER.findIndex((o) => o.name === 'Earth');

  SIZE_ORDER.forEach((o, i) => {
    const d = document.createElement('span');
    d.className = 'size-dot';
    d.addEventListener('click', () => { index = i; render(); });
    dotsEl.appendChild(d);
  });

  const move = (dir) => { index = Math.min(SIZE_ORDER.length - 1, Math.max(0, index + dir)); render(); };
  $(root, '#size-prev').addEventListener('click', () => move(-1));
  $(root, '#size-next').addEventListener('click', () => move(1));

  // Earth and the thing share one scale. The scale is chosen so both fit the
  // stage: the widest picks the width, and the tallest picks the height.
  function drawStage(o) {
    const { ctx, w, h } = sizeCanvas(stage);
    const cy = h * 0.4;
    const base = h - 22; // where the brackets sit
    if (o.name === 'Earth') {
      const r = Math.min(w, h) * 0.26;
      drawBall(ctx, w / 2, cy, r, '#5aa4e8');
      bracket(ctx, w / 2 - r, w / 2 + r, base, 'Earth');
      return;
    }
    const ratio = o.km / EARTH_KM;
    if (o.star) {
      // Betelgeuse is about 800 Suns across: it fills the screen and runs off both
      // edges. The Sun and Earth are drawn as small dots beside it, bigger than
      // to scale, so the difference can still be seen.
      const bR = w * 0.55, bX = w * 0.8;
      drawBall(ctx, bX, cy, bR, o.col);
      const sunX = w * 0.22, earthX = w * 0.07;
      drawBall(ctx, sunX, cy, 6, '#ffd27a');
      drawBall(ctx, earthX, cy, 2.5, '#5aa4e8');
      ctx.font = '700 13px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(233,233,237,0.95)';
      ctx.fillText('Earth', earthX, base);
      ctx.fillText('Sun', sunX, base);
      return;
    }
    if (ratio > 20) {
      // Far bigger than Earth: to scale, Earth would be a speck. Draw Earth as a
      // visible dot (bigger than to scale), with the big thing beside it.
      const rS = h * 0.36, rE = 6;
      const eX = w * 0.2, sX = w * 0.64;
      drawBall(ctx, eX, cy, rE, '#5aa4e8');
      drawBall(ctx, sX, cy, rS, o.col);
      bracket(ctx, eX - rE, eX + rE, base, 'Earth');
      bracket(ctx, sX - rS, sX + rS, base, o.name);
      return;
    }
    const byWidth = Math.min(140, (w - 40) / (1 + ratio)); // px per Earth width
    const byHeight = (h * 0.72) / Math.max(1, ratio);     // keeps the big one on the stage
    const k = Math.min(byWidth, byHeight);
    const total = k * (1 + ratio);
    const x0 = (w - total) / 2;
    const eX = x0 + k / 2, eR = k / 2;
    const oX = x0 + k + (k * ratio) / 2, oR = (k * ratio) / 2;
    drawBall(ctx, eX, cy, eR, '#5aa4e8');
    drawBall(ctx, oX, cy, oR, o.col);
    bracket(ctx, eX - eR, eX + eR, base, 'Earth');
    bracket(ctx, oX - oR, oX + oR, base, o.name);
  }

  function render() {
    const o = SIZE_ORDER[index];
    nameEl.textContent = `${o.emoji} ${o.name}`;
    sayEl.textContent = o.say;
    noteEl.textContent = o.star
      ? 'Betelgeuse is about 800 Suns across, so it runs off both sides of the screen. The Sun and Earth are drawn bigger than to scale here, so you can see them.'
      : o.name === 'Earth' ? '' : o.km / EARTH_KM > 20
        ? 'Earth is drawn as a dot you can see. To the same scale it would be far smaller than this.'
        : 'Both pictures are drawn to the same scale. The lines under them show how wide each one is.';
    [...dotsEl.children].forEach((d, i) => d.classList.toggle('is-on', i === index));
    $(root, '#size-prev').disabled = index === 0;
    $(root, '#size-next').disabled = index === SIZE_ORDER.length - 1;
    drawStage(o);
  }

  render();
  const onResize = () => { if (isLessonOpen()) render(); };
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}

// ---------------------------------------------------------------------------
// Lesson 5 — why the sea goes in and out (tides)
// ---------------------------------------------------------------------------
// The Moon pulls the oceans into two bumps: one under the Moon, one on the far
// side. The Sun does the same, a bit less than half as strongly (0.46×). Earth
// spins through the bumps, so a beach gets two high tides a day. When the Sun and
// Moon line up (New and Full Moon) the bumps add up: big tides. At Half Moon they
// pull across each other: small tides. The picture uses the same top-down layout
// as the Moon lesson: the Sun on the left, everything turning anticlockwise.

const SUN_TIDE = 0.46; // the Sun's tide-raising force compared with the Moon's
const TIDE_MAX = 1 + SUN_TIDE;

// Screen directions (y down): the Sun is to the left (angle π). The Moon's phase
// angle a puts it at π − a, as in drawMoonTop. Your beach faces the Sun at noon
// and turns anticlockwise, so at 6 pm it faces the First Quarter Moon.
const moonDir = (phaseDeg) => Math.PI - phaseDeg * DEG;
const beachDir = (hour) => Math.PI - ((hour - 12) / 24) * 2 * Math.PI;
const tideAt = (dir, phaseDeg) =>
  Math.cos(2 * (dir - moonDir(phaseDeg))) + SUN_TIDE * Math.cos(2 * (dir - Math.PI));

function partOfDay(hour) {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5 || h >= 21) return 'night';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}
const clock = (hour) => {
  const total = Math.round((((hour % 24) + 24) % 24) * 60) % 1440;
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
};

function buildTides(root) {
  root.innerHTML = `
    <p class="lesson-lead">The Moon <b>pulls</b> on the sea. The water piles up in two big bumps: one under the Moon, and one on the far side of Earth. As Earth spins, your beach goes through both bumps, so the sea comes in and goes out <b>twice a day</b>.</p>
    <canvas id="tide-top" class="lesson-canvas" style="height:290px"></canvas>
    <canvas id="tide-beach" class="lesson-canvas" style="height:160px"></canvas>
    <div class="lesson-cards">
      <div><div class="lesson-small">At your beach</div><div id="tide-now" class="lesson-big"></div></div>
      <div><div class="lesson-small">Tides today</div><div id="tide-size" class="lesson-big"></div></div>
    </div>
    <label class="lesson-label">Time of day: <span id="tide-time"></span>
      <input id="tide-hour" type="range" min="0" max="24" step="0.05"></label>
    <div class="lesson-buttons">
      <button id="tide-play" class="lesson-pill"><i class="ph-fill ph-play"></i> Play</button>
      <button id="tide-full" class="lesson-pill"><i class="ph-fill ph-circle"></i> Full Moon</button>
      <button id="tide-half" class="lesson-pill"><i class="ph-fill ph-circle-half"></i> Half Moon</button>
      <button id="tide-today" class="lesson-pill"><i class="ph-fill ph-clock"></i> Now</button>
    </div>
    <ol class="lesson-steps">
      <li><b>High tide:</b> your beach is in a bump. The sea comes up the sand.</li>
      <li><b>Low tide:</b> your beach is between the bumps. The sea goes out.</li>
      <li><b>Big tides</b> come at New Moon and Full Moon, when the Sun and the Moon pull in a line.</li>
    </ol>
    <p class="lesson-note">The bumps are drawn much bigger than they really are. Real tides also come a little later than the picture shows, because the water needs time to flow round the coasts. In the Mediterranean the sea only rises about 30 cm. In Canada's Bay of Fundy it can rise more than 15 metres!</p>`;

  const top = $(root, '#tide-top');
  const beach = $(root, '#tide-beach');
  const slider = $(root, '#tide-hour');
  liftPlay(root, '#tide-play', { before: '#tide-top', also: ['#tide-full', '#tide-half', '#tide-today'] });
  const play = $(root, '#tide-play');
  // State: the hour of the day, and the Moon's phase angle (0 = New, 180 = Full).
  let hour = 12, phase = 0, playing = false, raf = 0, last = 0;

  const fromNow = () => {
    const now = new Date();
    hour = now.getHours() + now.getMinutes() / 60;
    phase = moonPhase(now);
  };
  fromNow();

  function render(t = 0) {
    const level = tideAt(beachDir(hour), phase) / TIDE_MAX;      // -1 low … +1 high
    const soon = tideAt(beachDir(hour + 0.25), phase) / TIDE_MAX;
    drawTideTop(top, hour, phase);
    drawBeach(beach, level, t);
    // High and low are judged against this day's own range: at Half Moon the
    // bumps are small, but the top of a small tide is still high tide.
    let hi = -Infinity, lo = Infinity;
    for (let k = 0; k < 48; k++) {
      const v = tideAt(beachDir(k / 2), phase) / TIDE_MAX;
      hi = Math.max(hi, v); lo = Math.min(lo, v);
    }
    const frac = (level - lo) / (hi - lo);
    let now;
    if (frac > 0.85) now = 'High tide';
    else if (frac < 0.15) now = 'Low tide';
    else now = soon > level ? 'Coming in' : 'Going out';
    $(root, '#tide-now').textContent = now;
    const strength = 1 + SUN_TIDE * Math.cos(2 * (moonDir(phase) - Math.PI)); // 0.54 … 1.46
    $(root, '#tide-size').textContent = strength > 1.25 ? 'Big' : strength < 0.75 ? 'Small' : 'Medium';
    $(root, '#tide-time').textContent = `${clock(hour)}, ${partOfDay(hour)}`;
    slider.value = ((hour % 24) + 24) % 24;
  }

  slider.addEventListener('input', () => { hour = parseFloat(slider.value); render(last); });
  const setPhase = (p) => { phase = p; render(last); };
  $(root, '#tide-full').addEventListener('click', () => setPhase(180));
  $(root, '#tide-half').addEventListener('click', () => setPhase(90));
  $(root, '#tide-today').addEventListener('click', () => { fromNow(); render(last); });
  play.addEventListener('click', () => {
    playing = !playing;
    play.innerHTML = playing ? '<i class="ph-fill ph-pause"></i> Pause' : '<i class="ph-fill ph-play"></i> Play';
  });

  const tick = (now) => {
    if (!isLessonOpen() || !root.isConnected) return;
    raf = requestAnimationFrame(tick);
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
    last = now;
    if (playing) {
      const hours = dt * 3; // a whole day in about eight seconds
      hour = (hour + hours) % 24;
      phase = (phase + (hours / 24 / SYNODIC) * 360) % 360; // the Moon creeps on too
    }
    render(now); // every frame: the little waves on the beach move
  };
  render();
  raf = requestAnimationFrame(tick);
  const onResize = () => { if (isLessonOpen()) render(last); };
  window.addEventListener('resize', onResize);
  return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
}

// Top-down: the Sun on the left, Earth with its water bumps, the Moon on its orbit,
// and a flag on your beach turning round with Earth.
function drawTideTop(c, hour, phase) {
  const { ctx, w, h } = sizeCanvas(c);
  const cx = w * 0.56, cy = h / 2;
  const E = Math.min(w * 0.15, h * 0.17);   // Earth's radius
  const orbit = Math.min(w * 0.34, h * 0.43); // the Moon's orbit, clear of both edges
  const font = (px) => `700 ${px}px Inter, system-ui, sans-serif`;

  // Sunlight from the left.
  ctx.strokeStyle = 'rgba(255,205,120,0.18)';
  ctx.lineWidth = 1;
  for (let k = -3; k <= 3; k++) {
    const y = cy + k * h * 0.12;
    ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(cx - orbit - 18, y); ctx.stroke();
  }
  const sg = ctx.createRadialGradient(8, cy, 0, 8, cy, 44);
  sg.addColorStop(0, 'rgba(255,220,150,0.95)');
  sg.addColorStop(0.35, 'rgba(255,180,90,0.4)');
  sg.addColorStop(1, 'rgba(255,160,80,0)');
  ctx.fillStyle = sg;
  ctx.fillRect(0, cy - 44, 60, 88);
  ctx.font = font(14);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,226,180,0.95)';
  ctx.fillText('Sun', 4, cy - 50);

  // The Moon's orbit and the Moon, lit on its Sun side.
  const md = moonDir(phase);
  const mx = cx + orbit * Math.cos(md), my = cy + orbit * Math.sin(md);
  ctx.setLineDash([3, 5]);
  ctx.strokeStyle = 'rgba(210,215,240,0.3)';
  ctx.beginPath(); ctx.arc(cx, cy, orbit, 0, Math.PI * 2); ctx.stroke();
  // The pull: a soft arrow from the Moon toward Earth.
  ctx.strokeStyle = 'rgba(190,210,255,0.45)';
  ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(cx, cy); ctx.stroke();
  ctx.setLineDash([]);
  const mr = 13;
  ctx.fillStyle = '#2b2f45';
  ctx.beginPath(); ctx.arc(mx, my, mr, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#eceef6';
  ctx.beginPath(); ctx.arc(mx, my, mr, Math.PI / 2, Math.PI * 1.5); ctx.fill();
  ctx.font = font(13);
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(233,233,237,0.95)';
  ctx.fillText('Moon', mx, my + (my > cy ? mr + 16 : -mr - 8));

  // The water: a bump toward the Moon and one away from it, plus the Sun's smaller pair.
  const water = (dir) => E * (1.1 + 0.2 * (tideAt(dir, phase) / TIDE_MAX));
  ctx.beginPath();
  for (let i = 0; i <= 120; i++) {
    const d = (i / 120) * Math.PI * 2;
    const r = water(d);
    const x = cx + r * Math.cos(d), y = cy + r * Math.sin(d);
    if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath();
  const wg = ctx.createRadialGradient(cx, cy, E * 0.8, cx, cy, E * 1.35);
  wg.addColorStop(0, '#2f7fd8');
  wg.addColorStop(1, '#5fb4ff');
  ctx.fillStyle = wg;
  ctx.fill();
  ctx.strokeStyle = 'rgba(200,230,255,0.8)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // Earth's land, with the night half (away from the Sun) shaded.
  const lg = ctx.createRadialGradient(cx - E * 0.35, cy - E * 0.35, E * 0.1, cx, cy, E);
  lg.addColorStop(0, '#9fd38a');
  lg.addColorStop(1, '#4d8a4a');
  ctx.fillStyle = lg;
  ctx.beginPath(); ctx.arc(cx, cy, E * 0.9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(5,8,25,0.3)';
  ctx.beginPath(); ctx.arc(cx, cy, E * 1.42, -Math.PI / 2, Math.PI / 2); ctx.fill();

  // High-tide and low-tide labels at the bumps and the dips.
  ctx.font = font(12);
  const bd = beachDir(hour);
  const tag = (dir, text, col) => {
    // Leave the label out where the You flag would cover it.
    if (Math.cos(dir - bd) > Math.cos(28 * DEG)) return;
    const r = water(dir) + 16;
    const x = cx + r * Math.cos(dir), y = cy + r * Math.sin(dir);
    ctx.fillStyle = col;
    ctx.fillText(text, x, y + 4);
  };
  tag(md, 'high', '#bfe3ff');
  tag(md + Math.PI, 'high', '#bfe3ff');
  tag(md + Math.PI / 2, 'low', 'rgba(233,233,237,0.7)');
  tag(md - Math.PI / 2, 'low', 'rgba(233,233,237,0.7)');

  // Your beach: a red flag on Earth's edge, turning with the day.
  const bx = cx + E * 0.9 * Math.cos(bd), by = cy + E * 0.9 * Math.sin(bd);
  const fx = cx + E * 1.55 * Math.cos(bd), fy = cy + E * 1.55 * Math.sin(bd);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2.5;
  ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(fx, fy); ctx.stroke();
  ctx.fillStyle = '#ff6b5b';
  ctx.beginPath(); ctx.arc(fx, fy, 7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.font = font(14);
  ctx.fillStyle = '#ffd0c8';
  const lx = cx + E * 1.55 * Math.cos(bd) + 14 * Math.cos(bd);
  const ly = cy + E * 1.55 * Math.sin(bd) + 14 * Math.sin(bd);
  ctx.textAlign = Math.cos(bd) > 0.3 ? 'left' : Math.cos(bd) < -0.3 ? 'right' : 'center';
  ctx.fillText('You', lx, ly + (Math.sin(bd) > 0.3 ? 12 : Math.sin(bd) < -0.3 ? -4 : 5));
}

// Side view of your beach: the sea level goes up and down the sand.
function drawBeach(c, level, t) {
  const { ctx, w, h } = sizeCanvas(c);
  // Sky.
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#1c2350');
  sky.addColorStop(1, '#33407a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  const sandY = (x) => h - ((x - w * 0.05) / (w * 0.95)) * h * 0.85; // the slope of the beach
  const highY = h * 0.42, lowY = h * 0.84;
  const seaY = (lowY + highY) / 2 - level * (lowY - highY) / 2;

  // The sea, with small moving waves on top.
  ctx.beginPath();
  ctx.moveTo(0, h);
  for (let x = 0; x <= w; x += 6) ctx.lineTo(x, seaY + Math.sin(x / 18 + t / 420) * 2.5);
  ctx.lineTo(w, h);
  ctx.closePath();
  const sea = ctx.createLinearGradient(0, seaY, 0, h);
  sea.addColorStop(0, '#5fb4ff');
  sea.addColorStop(1, '#1f5fae');
  ctx.fillStyle = sea;
  ctx.fill();

  // The sand, drawn over the sea so the water stops where it meets the beach.
  ctx.beginPath();
  ctx.moveTo(w * 0.05, h);
  ctx.lineTo(w, sandY(w));
  ctx.lineTo(w, h);
  ctx.closePath();
  ctx.fillStyle = '#e8cf9a';
  ctx.fill();
  ctx.strokeStyle = '#f6e3b8';
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(w * 0.05, h); ctx.lineTo(w, sandY(w)); ctx.stroke();

  // A sandcastle just above the highest tide.
  const castleX = w * 0.05 + ((h - (highY - 14)) / (h * 0.85)) * w * 0.95;
  const cbase = sandY(castleX);
  ctx.fillStyle = '#d9b46e';
  ctx.fillRect(castleX - 14, cbase - 22, 28, 22);
  ctx.fillRect(castleX - 18, cbase - 30, 9, 10);
  ctx.fillRect(castleX + 9, cbase - 30, 9, 10);
  ctx.fillStyle = '#ff6b5b';
  ctx.beginPath(); ctx.moveTo(castleX, cbase - 40); ctx.lineTo(castleX + 10, cbase - 36); ctx.lineTo(castleX, cbase - 32); ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(castleX, cbase - 22); ctx.lineTo(castleX, cbase - 40); ctx.stroke();

  // Marks for the highest and lowest water.
  ctx.setLineDash([4, 5]);
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.lineWidth = 1;
  for (const y of [highY, lowY]) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w * 0.42, y); ctx.stroke(); }
  ctx.setLineDash([]);
  ctx.font = '700 12px Inter, system-ui, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.fillText('high tide', 6, highY - 6);
  ctx.fillText('low tide', 6, lowY - 6);
}

// ---------------------------------------------------------------------------
// Hub and routing
// ---------------------------------------------------------------------------

const LESSONS = {
  moon: {
    kicker: 'Discover · The Moon',
    title: 'Why the Moon changes shape',
    speak: 'The Sun always lights up half of the Moon, the half that faces the Sun. As the Moon goes round us, we see more or less of the bright half. Full Moon, we see the whole bright side. New Moon, the bright side faces away from us.',
    build: buildMoon,
  },
  seasons: {
    kicker: 'Discover · Seasons',
    title: 'Why days are longer in summer',
    speak: 'Earth leans over a little, like a spinning top. In summer, your half leans toward the Sun, so the days are long. In winter, it leans away, so the days are short.',
    build: buildSeasons,
  },
  sizes: {
    kicker: 'Discover · Size',
    title: 'How big things are',
    speak: 'Earth is drawn next to each thing, at the same scale. Tap the arrows to go from small to big.',
    build: buildSizes,
  },
  zoom: {
    kicker: 'Discover · From the universe to you',
    title: 'From the universe to you',
    speak: 'Zoom in from the universe, through the galaxies, to our Sun, to Earth, and to where you are.',
    build: (root) => { mountZoom(root); return unmountZoom; },
  },
  surface: {
    kicker: 'Discover · Another world',
    title: 'Visit another world',
    speak: 'Stand on the Moon. The sky is black, even in the day, because the Moon has no air. Earth hangs in the sky and never moves. Or visit Mars, where the sky is butterscotch, and the sunset is blue.',
    build: (root) => mountSurface(root),
  },
  tides: {
    kicker: 'Discover · Tides',
    title: 'Why the sea goes in and out',
    speak: 'The Moon pulls on the sea. The water piles up in two big bumps, one under the Moon and one on the far side of Earth. As Earth spins, your beach goes through both bumps, so the sea comes in and goes out twice a day. When the Sun and the Moon pull in a line, at New Moon and Full Moon, the tides are big.',
    build: buildTides,
  },
};

/** Wires the Discover hub and the lesson screen. `go` switches screens. */
export function initLearn({ go }) {
  let stopLesson = null;
  const stop = () => { if (stopLesson) stopLesson(); stopLesson = null; };

  document.getElementById('discover-screen').addEventListener('click', (e) => {
    const card = e.target.closest('[data-lesson]');
    if (card) openLesson(card.dataset.lesson);
  });
  document.getElementById('lesson-back').addEventListener('click', () => { stop(); go('discover'); });

  function openLesson(id) {
    stop();
    const root = document.getElementById('lesson-body');
    root.innerHTML = '';
    root.classList.toggle('zoom-mode', id === 'zoom');
    document.getElementById('lesson-kicker').textContent = LESSONS[id].kicker;
    const listen = document.getElementById('lesson-listen');
    listen.onclick = () => say(LESSONS[id].title, LESSONS[id].speak);
    go('lesson');
    stopLesson = LESSONS[id].build(root) || null;
  }
}
