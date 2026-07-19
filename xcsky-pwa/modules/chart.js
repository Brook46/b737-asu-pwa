// chart.js — the two canvas visualisations that make this a soaring tool:
//   1. time-height thermal plot (the heart of any RASP/BLIPMAP)
//   2. vertical wind profile (barbs) for the selected hour
//
// Pure canvas, no library. Retina-aware. Colours come from CSS variables so the
// charts follow the app theme.

import { deriveHour } from './soaring.js';
import { altNum, altUnit } from './units.js';

/** Lift colour ramp: net climb (m/s) → CSS colour. Blue(weak)→green→gold→red(strong). */
export function liftColor(net) {
  if (net <= 0.05) return 'rgba(120,130,150,0.20)';   // dead air
  const stops = [
    [0.3,  '#3b6ea5'], // weak, blue
    [0.8,  '#2f9e6f'], // ok, teal-green
    [1.4,  '#7cc143'], // good, green
    [2.0,  '#f2c14e'], // strong, gold
    [2.8,  '#ef7d3b'], // very strong, orange
    [4.0,  '#e0453f'], // ripping, red
  ];
  for (let i = 0; i < stops.length; i++) {
    if (net <= stops[i][0]) {
      if (i === 0) return stops[0][1];
      return lerpColor(stops[i - 1][1], stops[i][1],
        (net - stops[i - 1][0]) / (stops[i][0] - stops[i - 1][0]));
    }
  }
  return stops[stops.length - 1][1];
}

function lerpColor(a, b, t) {
  const pa = hex(a), pb = hex(b);
  const r = Math.round(pa[0] + (pb[0] - pa[0]) * t);
  const g = Math.round(pa[1] + (pb[1] - pa[1]) * t);
  const bl = Math.round(pa[2] + (pb[2] - pa[2]) * t);
  return `rgb(${r},${g},${bl})`;
}
function hex(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function setupCanvas(canvas, cssW, cssH) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

function css(name, fallback) {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** Dewpoint (°C) from temperature and relative humidity (Magnus). */
function dewpoint(t, rh) {
  if (t == null || rh == null || rh <= 0) return null;
  const a = 17.625, b = 243.04;
  const g = Math.log(rh / 100) + a * t / (b + t);
  return (b * g) / (a - g);
}

/**
 * A soaring sounding: environmental temperature and dewpoint against height,
 * with the dry adiabat lifted from the surface, and the thermal top (where the
 * adiabat meets the environment) and cloud base (LCL) marked. Reads left→warm.
 * @param hr       normalised point-forecast hour (t2m, td2m, levels[{z,t,rh}])
 * @param terrain  ground height, m MSL
 */
export function drawSounding(canvas, hr, terrain, opts = {}) {
  const wrapW = canvas.parentElement ? canvas.parentElement.clientWidth - 12 : 0;
  const cssW = wrapW > 60 ? wrapW : (canvas.clientWidth || 320);
  const cssH = opts.height || 210;
  const ctx = setupCanvas(canvas, cssW, cssH);
  ctx.clearRect(0, 0, cssW, cssH);

  // Build the profile: surface point + pressure levels above the ground.
  const env = [];      // {z, t}
  const dew = [];      // {z, td}
  if (hr.t2m != null) env.push({ z: terrain, t: hr.t2m });
  if (hr.td2m != null) dew.push({ z: terrain, td: hr.td2m });
  for (const lv of (hr.levels || [])) {
    if (lv.z == null || lv.z < terrain) continue;
    if (lv.t != null) env.push({ z: lv.z, t: lv.t });
    const td = dewpoint(lv.t, lv.rh);
    if (td != null) dew.push({ z: lv.z, td });
  }
  if (env.length < 2) return;

  const topZ = Math.min(terrain + 6000, Math.max(...env.map((e) => e.z)));
  const zMin = terrain, zMax = Math.ceil(topZ / 500) * 500;

  // Temperature range from the visible portion, padded.
  let tMin = Infinity, tMax = -Infinity;
  for (const e of env) if (e.z <= zMax) { tMin = Math.min(tMin, e.t); tMax = Math.max(tMax, e.t); }
  for (const d of dew) if (d.z <= zMax) tMin = Math.min(tMin, d.td);
  // parcel end temp
  const parcelTop = hr.t2m - 9.8 * (zMax - terrain) / 1000;
  tMin = Math.min(tMin, parcelTop);
  tMin = Math.floor((tMin - 2) / 5) * 5; tMax = Math.ceil((tMax + 2) / 5) * 5;

  const padL = 34, padR = 8, padT = 8, padB = 18;
  const plotW = cssW - padL - padR, plotH = cssH - padT - padB;
  const xFor = (t) => padL + plotW * (t - tMin) / (tMax - tMin);
  const yFor = (z) => padT + plotH * (1 - (z - zMin) / (zMax - zMin));

  const muted = css('--muted', '#8a93a6');
  ctx.font = '9px system-ui, sans-serif';

  // gridlines
  ctx.strokeStyle = css('--grid', 'rgba(255,255,255,0.06)');
  ctx.fillStyle = muted; ctx.textBaseline = 'middle';
  for (let z = zMin; z <= zMax; z += 1000) {
    ctx.beginPath(); ctx.moveTo(padL, yFor(z)); ctx.lineTo(cssW - padR, yFor(z)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(String(Math.round(altNum(z))), padL - 4, yFor(z));
  }
  ctx.textBaseline = 'top'; ctx.textAlign = 'center';
  for (let t = tMin; t <= tMax; t += 5) ctx.fillText(`${t}°`, xFor(t), padT + plotH + 4);

  const line = (pts, key, color, width, dash) => {
    ctx.setLineDash(dash || []); ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath();
    pts.forEach((p, i) => { const x = xFor(p[key]), y = yFor(p.z); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke(); ctx.setLineDash([]);
  };

  // dry adiabat from the surface (the parcel a thermal follows)
  ctx.setLineDash([5, 4]); ctx.strokeStyle = 'rgba(245,193,78,.9)'; ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(xFor(hr.t2m), yFor(terrain));
  ctx.lineTo(xFor(parcelTop), yFor(zMax));
  ctx.stroke(); ctx.setLineDash([]);

  line(dew, 'td', '#3fa9f5', 2);          // dewpoint (blue)
  line(env, 't', '#e0453f', 2);           // environment temperature (red)

  // thermal top: where the dry adiabat crosses the environment curve
  const d = deriveHour(hr, terrain);
  if (d.thermalTop && d.thermalTop <= zMax) {
    const y = yFor(d.thermalTop);
    ctx.strokeStyle = 'rgba(124,193,67,.9)'; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cssW - padR, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#9fe06b'; ctx.textAlign = 'left'; ctx.textBaseline = 'bottom';
    ctx.fillText(`top ${Math.round(altNum(d.thermalTop))}`, padL + 3, y - 1);
  }
  if (d.cumulus && d.cloudBase && d.cloudBase <= zMax) {
    const y = yFor(d.cloudBase);
    ctx.fillStyle = '#dfe6f2'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText(`cu base ${Math.round(altNum(d.cloudBase))}`, padL + 3, y + 1);
  }

  // legend
  ctx.textBaseline = 'top'; ctx.textAlign = 'right';
  ctx.fillStyle = '#e0453f'; ctx.fillText('temp', cssW - padR, padT);
  ctx.fillStyle = '#3fa9f5'; ctx.fillText('dew', cssW - padR, padT + 11);
}

/**
 * Side-view of a suggested flight: x = time of day along the route, y = altitude.
 * Shows the working ceiling (climb-coloured) you can climb to at each position,
 * the cloud base, and the terrain underneath.
 * @param samples [{hour, terrain, top, base, climb}] in flight order
 */
export function drawRouteSection(canvas, samples, opts = {}) {
  const wrapW = canvas.parentElement ? canvas.parentElement.clientWidth - 4 : 0;
  const cssW = wrapW > 60 ? wrapW : (canvas.clientWidth || 320);
  const cssH = opts.height || 118;
  const ctx = setupCanvas(canvas, cssW, cssH);
  ctx.clearRect(0, 0, cssW, cssH);
  if (!samples || samples.length < 2) return;

  const padL = 34, padR = 6, padT = 8, padB = 16;
  const plotW = cssW - padL - padR, plotH = cssH - padT - padB;

  let minA = Infinity, maxA = 0;
  for (const s of samples) {
    minA = Math.min(minA, s.terrain ?? 0);
    maxA = Math.max(maxA, s.top ?? 0, s.base ?? 0);
  }
  minA = Math.floor(minA / 250) * 250;
  maxA = Math.ceil((maxA + 150) / 250) * 250;
  if (maxA <= minA) maxA = minA + 500;

  const xFor = (i) => padL + plotW * (samples.length === 1 ? 0.5 : i / (samples.length - 1));
  const yFor = (a) => padT + plotH * (1 - (a - minA) / (maxA - minA));

  // gridlines + altitude labels
  ctx.font = '9px system-ui, sans-serif'; ctx.textBaseline = 'middle';
  ctx.fillStyle = css('--muted', '#8a93a6');
  const step = (maxA - minA) > 3500 ? 1000 : 500;
  for (let a = minA; a <= maxA; a += step) {
    ctx.strokeStyle = css('--grid', 'rgba(255,255,255,0.06)');
    ctx.beginPath(); ctx.moveTo(padL, yFor(a)); ctx.lineTo(cssW - padR, yFor(a)); ctx.stroke();
    ctx.textAlign = 'right'; ctx.fillText(String(Math.round(altNum(a))), padL - 4, yFor(a));
  }

  // working-band columns (terrain → working top), climb-coloured
  const colW = plotW / (samples.length - 1);
  samples.forEach((s, i) => {
    if (s.top == null) return;
    const x = xFor(i);
    ctx.fillStyle = liftColor(s.climb || 0);
    ctx.globalAlpha = 0.85;
    ctx.fillRect(x - colW / 2, yFor(s.top), colW, yFor(s.terrain ?? minA) - yFor(s.top));
    ctx.globalAlpha = 1;
  });

  // cloud-base dashed line
  ctx.setLineDash([4, 3]); ctx.strokeStyle = 'rgba(230,235,245,0.6)'; ctx.lineWidth = 1;
  ctx.beginPath(); let started = false;
  samples.forEach((s, i) => {
    if (s.base == null) { started = false; return; }
    const x = xFor(i), y = yFor(s.base);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.stroke(); ctx.setLineDash([]);

  // terrain profile
  ctx.beginPath();
  samples.forEach((s, i) => { const x = xFor(i), y = yFor(s.terrain ?? minA); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
  ctx.lineTo(xFor(samples.length - 1), padT + plotH); ctx.lineTo(xFor(0), padT + plotH); ctx.closePath();
  ctx.fillStyle = css('--terrain', 'rgba(92,72,54,0.6)'); ctx.fill();

  // flight ceiling line (the height you can be at)
  ctx.beginPath(); started = false;
  samples.forEach((s, i) => {
    if (s.top == null) { started = false; return; }
    const x = xFor(i), y = yFor(s.top);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  });
  ctx.strokeStyle = css('--accent', '#5ec2ff'); ctx.lineWidth = 2; ctx.stroke();

  // hour labels
  ctx.fillStyle = css('--muted', '#8a93a6'); ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  samples.forEach((s, i) => {
    if (i % Math.ceil(samples.length / 6) !== 0 && i !== samples.length - 1) return;
    ctx.fillText(`${String(s.hour).padStart(2, '0')}h`, xFor(i), padT + plotH + 3);
  });
}

/**
 * Draw the time-height thermal plot for one day.
 * @returns {{hourAtX:(px:number)=>number, cols:number}} hit-test helper.
 */
export function drawTimeHeight(canvas, day, terrain, opts = {}) {
  const hours = day.hours;
  // Measure the wrapper, not the canvas: setupCanvas pins style.width, so the
  // canvas's own clientWidth goes stale when the container resizes (phone).
  const wrapW = canvas.parentElement ? canvas.parentElement.clientWidth - 12 : 0;
  const cssW = wrapW > 40 ? wrapW : (canvas.clientWidth || opts.width || 340);
  const cssH = opts.height || 260;
  const ctx = setupCanvas(canvas, cssW, cssH);
  ctx.clearRect(0, 0, cssW, cssH);

  const padL = 42, padR = 8, padT = 10, padB = 22;
  const plotW = cssW - padL - padR;
  const plotH = cssH - padT - padB;

  // Vertical range: terrain → a little above the day's max top / cloud base.
  let maxTop = terrain + 500;
  const derived = hours.map((hr) => deriveHour(hr, terrain));
  for (const d of derived) {
    if (d.thermalTop) maxTop = Math.max(maxTop, d.thermalTop);
    if (d.cloudBase) maxTop = Math.max(maxTop, d.cloudBase);
  }
  maxTop = Math.ceil((maxTop + 200) / 250) * 250;
  const minAlt = Math.floor(terrain / 250) * 250;

  const yFor = (mMSL) => padT + plotH * (1 - (mMSL - minAlt) / (maxTop - minAlt));
  const colW = plotW / hours.length;
  const xFor = (i) => padL + i * colW;

  const textColor = css('--muted', '#8a93a6');
  const gridColor = css('--grid', 'rgba(255,255,255,0.06)');

  // Horizontal gridlines + altitude labels.
  ctx.font = '10px system-ui, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = textColor;
  const step = (maxTop - minAlt) > 4000 ? 1000 : 500;
  for (let a = minAlt; a <= maxTop; a += step) {
    const y = yFor(a);
    ctx.strokeStyle = gridColor;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cssW - padR, y); ctx.stroke();
    ctx.textAlign = 'right';
    ctx.fillText(String(Math.round(altNum(a))), padL - 5, y);
  }
  // Axis unit.
  ctx.save(); ctx.translate(11, padT + plotH / 2); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.fillText(altUnit() + ' MSL', 0, 0); ctx.restore();

  // Thermal columns.
  for (let i = 0; i < hours.length; i++) {
    const hr = hours[i], d = derived[i];
    const x = xFor(i);
    if (!d.workingTop || d.workingTop <= terrain) continue;

    // Sub-sample each column vertically so the colour follows lift falling off
    // with height (thermals weaken near the inversion → fade the top).
    const yBase = yFor(terrain);
    const yTopWork = yFor(d.workingTop);
    const bandH = yBase - yTopWork;
    const cells = Math.max(1, Math.round(bandH / 6));
    for (let c = 0; c < cells; c++) {
      const frac = c / cells;                 // 0 at ground → 1 at top
      // Lift is strongest in the lower-mid layer, tapers to ~0 at the top.
      const taper = Math.sin(Math.min(1, frac * 1.05) * Math.PI * 0.85);
      const net = d.climb * (0.55 + 0.45 * taper) * (1 - frac * 0.15);
      ctx.fillStyle = liftColor(net);
      const y0 = yBase - bandH * (c / cells);
      const y1 = yBase - bandH * ((c + 1) / cells);
      ctx.fillRect(x + 0.5, y1, colW - 1, (y0 - y1) + 0.6);
    }

    // Cumulus cap: a small cloud glyph at cloud base when cu are expected.
    if (d.cumulus && d.cloudBase) {
      const yc = yFor(d.cloudBase);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.ellipse(x + colW / 2, yc - 2, Math.min(colW * 0.42, 9), 3.4, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Cloud-base line (dashed) across the day.
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = 'rgba(230,235,245,0.55)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  let started = false;
  for (let i = 0; i < hours.length; i++) {
    const d = derived[i];
    if (!d.cloudBase) { started = false; continue; }
    const x = xFor(i) + colW / 2, y = yFor(d.cloudBase);
    if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.setLineDash([]);

  // Terrain fill.
  const yG = yFor(terrain);
  ctx.fillStyle = css('--terrain', 'rgba(90,70,55,0.55)');
  ctx.fillRect(padL, yG, plotW, (padT + plotH) - yG);
  ctx.strokeStyle = 'rgba(160,130,100,0.8)';
  ctx.beginPath(); ctx.moveTo(padL, yG); ctx.lineTo(cssW - padR, yG); ctx.stroke();

  // Hour labels (every 3rd) + selected-hour highlight.
  ctx.fillStyle = textColor;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  for (let i = 0; i < hours.length; i++) {
    if (hours[i].hourOfDay % 3 !== 0) continue;
    ctx.fillText(String(hours[i].hourOfDay), xFor(i) + colW / 2, padT + plotH + 5);
  }
  if (opts.selectedIndex != null && opts.selectedIndex >= 0) {
    const x = xFor(opts.selectedIndex);
    ctx.strokeStyle = css('--accent', '#5ec2ff');
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 0.5, padT, colW - 1, plotH);
  }

  return {
    cols: hours.length,
    hourAtX(px) {
      const i = Math.floor((px - padL) / colW);
      return Math.max(0, Math.min(hours.length - 1, i));
    },
  };
}

/**
 * Vertical wind profile (barbs) for one hour. Draws surface + pressure-level
 * winds up the height axis with a matching altitude scale.
 */
export function drawWindProfile(canvas, hr, terrain, opts = {}) {
  const wrapW = canvas.parentElement ? canvas.parentElement.clientWidth - 12 : 0;
  const cssW = wrapW > 30 ? wrapW : (canvas.clientWidth || 120);
  const cssH = opts.height || 260;
  const ctx = setupCanvas(canvas, cssW, cssH);
  ctx.clearRect(0, 0, cssW, cssH);

  const padT = 10, padB = 22, padR = 6, padL = 6;
  const plotH = cssH - padT - padB;
  const cx = cssW / 2;

  // Build a list of {z, spd, dir} surface→up, capped to the working range.
  const d = deriveHour(hr, terrain);
  const top = Math.max(terrain + 1000, d.thermalTop || 0, d.cloudBase || 0) + 400;
  const pts = [];
  if (hr.wind10 != null) pts.push({ z: terrain + 10, spd: hr.wind10, dir: hr.windDir10 });
  for (const lv of hr.levels) {
    if (lv.z >= terrain && lv.z <= top && lv.spd != null) {
      pts.push({ z: lv.z, spd: lv.spd, dir: lv.dir });
    }
  }
  const minAlt = Math.floor(terrain / 250) * 250;
  const maxAlt = Math.ceil(top / 250) * 250;
  const yFor = (m) => padT + plotH * (1 - (m - minAlt) / (maxAlt - minAlt));

  // Spine.
  ctx.strokeStyle = css('--grid', 'rgba(255,255,255,0.08)');
  ctx.beginPath(); ctx.moveTo(cx, padT); ctx.lineTo(cx, padT + plotH); ctx.stroke();

  for (const p of pts) {
    drawBarb(ctx, cx, yFor(p.z), p.spd, p.dir);
  }

  ctx.fillStyle = css('--muted', '#8a93a6');
  ctx.font = '10px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'top';
  ctx.fillText('wind', cx, padT + plotH + 5);
}

/**
 * Draw a single wind barb centred at (x,y). Speed in km/h; converted to knots
 * for standard barb feathering. `dir` is the direction the wind comes FROM.
 */
function drawBarb(ctx, x, y, spdKmh, dir) {
  const kt = spdKmh * 0.539957;
  ctx.save();
  ctx.translate(x, y);
  // Point the shaft toward where the wind comes from (meteorological).
  ctx.rotate((dir ?? 0) * Math.PI / 180);
  ctx.strokeStyle = '#cdd6e6';
  ctx.lineWidth = 1.4;
  const L = 16;
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -L); ctx.stroke();

  if (kt < 2) { // calm circle
    ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.stroke();
    ctx.restore(); return;
  }
  // Feather from the far end downward.
  let rem = Math.round(kt / 5) * 5;
  let yy = -L;
  const stepGap = 3.2;
  while (rem >= 50) { // pennant
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(6, yy + 2.5); ctx.lineTo(0, yy + 5); ctx.closePath();
    ctx.fillStyle = '#cdd6e6'; ctx.fill();
    rem -= 50; yy += 6;
  }
  while (rem >= 10) { // full barb
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(6, yy - 2.5); ctx.stroke();
    rem -= 10; yy += stepGap;
  }
  if (rem >= 5) { // half barb
    ctx.beginPath(); ctx.moveTo(0, yy + stepGap * 0.5); ctx.lineTo(3, yy + stepGap * 0.5 - 1.5); ctx.stroke();
  }
  ctx.restore();
}
