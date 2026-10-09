// cockpit-displays.js — the flight deck's screens, drawn on canvases in the
// 737NG style: PFD, ND (map), upper DU (primary engine + fuel), lower DU
// (secondary engine + hydraulic SYS), the MCP and the ISFD. They read a data
// snapshot assembled from the phase and the live system states, so a
// failure you set in a schematic shows up on the displays too.

const F = (px, w = 700) => `${w} ${px}px "Helvetica Neue", Arial, sans-serif`;
const RED = '#ff3b30', MAG = '#ff5ad2', GRN = '#3df03d', CYN = '#28e3f2', AMB = '#ffb21e', WHT = '#f4f4f4';

/** Engine numbers for a phase (illustrative, typical values). */
export function engineFor(phase, running) {
  if (!running) return { n1: 0, n2: 0, egt: 22, ff: 0, oilP: 0, oilT: 22, oilQ: 18, vib: 0 };
  return {
    ground: { n1: 20.6, n2: 59.8, egt: 420, ff: 0.27, oilP: 34, oilT: 70, oilQ: 16, vib: 0.2 },
    takeoff: { n1: 95.4, n2: 98.2, egt: 878, ff: 3.18, oilP: 62, oilT: 115, oilQ: 15, vib: 0.6 },
    cruise: { n1: 87.6, n2: 93.1, egt: 742, ff: 1.24, oilP: 55, oilT: 108, oilQ: 15, vib: 0.4 },
    approach: { n1: 58.0, n2: 80.5, egt: 560, ff: 0.62, oilP: 46, oilT: 98, oilQ: 15, vib: 0.4 },
    landing: { n1: 76.0, n2: 86.0, egt: 655, ff: 0.95, oilP: 50, oilT: 104, oilQ: 15, vib: 0.5 },
  }[phase];
}

/** Flight numbers for a phase. */
export function flightFor(phase) {
  return {
    ground: { ias: 0, mach: 0, alt: 0, vs: 0, hdg: 90, gs: 0, tas: 0, pitch: 0, fma: ['', '', ''], ap: '' },
    takeoff: { ias: 158, mach: 0.24, alt: 300, vs: 2400, hdg: 90, gs: 162, tas: 160, pitch: 15, fma: ['THR HLD', 'LNAV', 'TO/GA'], ap: 'FD' },
    cruise: { ias: 268, mach: 0.785, alt: 37000, vs: 0, hdg: 93, gs: 468, tas: 452, pitch: 2.2, fma: ['MCP SPD', 'LNAV', 'VNAV PTH'], ap: 'CMD' },
    approach: { ias: 145, mach: 0.22, alt: 1500, vs: -750, hdg: 90, gs: 140, tas: 148, pitch: 2.5, fma: ['MCP SPD', 'VOR/LOC', 'G/S'], ap: 'CMD' },
    landing: { ias: 92, mach: 0.14, alt: 0, vs: 0, hdg: 90, gs: 90, tas: 92, pitch: 0, fma: ['', '', ''], ap: '' },
  }[phase];
}

function clear(g, W, H) { g.fillStyle = '#000'; g.fillRect(0, 0, W, H); }
function text(g, s, x, y, c = WHT, px = 20, align = 'left', w = 700) { g.fillStyle = c; g.font = F(px, w); g.textAlign = align; g.fillText(s, x, y); }
function box(g, x, y, w, h, c = WHT, lw = 2) { g.strokeStyle = c; g.lineWidth = lw; g.strokeRect(x, y, w, h); }

// ── PFD ─────────────────────────────────────────────────────────────────────
export function drawPFD(g, W, H, d) {
  clear(g, W, H);
  const f = d.flight;
  const cx = W * 0.5, cy = H * 0.47, ppd = 7;   // pixels per degree of pitch
  // Attitude: clipped to the ADI window.
  g.save();
  g.beginPath(); g.roundRect?.(cx - 140, cy - 150, 280, 300, 22) ?? g.rect(cx - 140, cy - 150, 280, 300); g.clip();
  // Bank rolls the horizon round the airplane symbol.
  g.translate(cx, cy); g.rotate((-(f.bank || 0) * Math.PI) / 180); g.translate(-cx, -cy);
  const hy = cy + f.pitch * ppd;
  g.fillStyle = '#1c78d4'; g.fillRect(-W, -H, W * 3, hy + H);
  g.fillStyle = '#7b4a1e'; g.fillRect(-W, hy, W * 3, H * 2);
  g.strokeStyle = WHT; g.lineWidth = 2;
  g.beginPath(); g.moveTo(-W, hy); g.lineTo(W * 2, hy); g.stroke();
  for (let p = -30; p <= 30; p += 2.5) {
    if (!p) continue;
    const y = hy - p * ppd, w = p % 10 === 0 ? 60 : p % 5 === 0 ? 34 : 16;
    g.beginPath(); g.moveTo(cx - w, y); g.lineTo(cx + w, y); g.stroke();
    if (p % 10 === 0) { text(g, String(Math.abs(p)), cx - w - 10, y + 6, WHT, 16, 'right'); text(g, String(Math.abs(p)), cx + w + 10, y + 6, WHT, 16); }
  }
  g.restore();
  // Bank scale.
  g.strokeStyle = WHT; g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, 150, Math.PI * 1.32, Math.PI * 1.68); g.stroke();
  g.fillStyle = WHT; g.beginPath(); g.moveTo(cx, cy - 150); g.lineTo(cx - 8, cy - 164); g.lineTo(cx + 8, cy - 164); g.fill();
  // Airplane symbol.
  g.fillStyle = '#000'; g.strokeStyle = WHT; g.lineWidth = 2;
  for (const s of [-1, 1]) { g.fillRect(cx + s * 40 - (s < 0 ? 52 : 0), cy - 5, 52, 10); g.strokeRect(cx + s * 40 - (s < 0 ? 52 : 0), cy - 5, 52, 10); }
  g.fillRect(cx - 6, cy - 6, 12, 12); g.strokeRect(cx - 6, cy - 6, 12, 12);
  // Speed tape.
  const tape = (x, w, val, step, labelEvery, fmt, right) => {
    g.fillStyle = '#4a4f55'; g.fillRect(x, cy - 170, w, 340);
    g.save(); g.beginPath(); g.rect(x, cy - 170, w, 340); g.clip();
    const pxu = 340 / (step * 6);
    const base = Math.floor(val / step) * step;
    for (let v = base - step * 4; v <= base + step * 4; v += step) {
      if (v < 0) continue;
      const y = cy - (v - val) * pxu;
      g.strokeStyle = WHT; g.lineWidth = 2;
      g.beginPath(); g.moveTo(right ? x : x + w, y); g.lineTo(right ? x + 12 : x + w - 12, y); g.stroke();
      if (v % labelEvery === 0) text(g, fmt(v), right ? x + 18 : x + w - 18, y + 7, WHT, 20, right ? 'left' : 'right');
    }
    g.restore();
    // Readout box.
    g.fillStyle = '#000'; g.fillRect(x - (right ? 4 : 0), cy - 20, w + 4, 40); box(g, x - (right ? 4 : 0), cy - 20, w + 4, 40, WHT, 2);
  };
  tape(16, 82, f.ias, 10, 20, (v) => String(v), false);
  // Speed bugs: target (magenta), and V1 / VR on the ground.
  const spdY = (v) => cy - (v - f.ias) * (340 / 60);
  if (f.spdTgt) {
    const y = Math.max(cy - 168, Math.min(cy + 168, spdY(f.spdTgt)));
    g.strokeStyle = MAG; g.lineWidth = 2.5; g.beginPath(); g.moveTo(98, y - 9); g.lineTo(88, y - 9); g.lineTo(88, y + 9); g.lineTo(98, y + 9); g.stroke();
    g.fillStyle = '#000'; g.fillRect(16, cy - 170, 82, 26);
    text(g, String(Math.round(f.spdTgt)), 57, cy - 150, MAG, 22, 'center');
  }
  for (const [lbl, v] of f.vBugs || []) {
    const y = spdY(v);
    if (y < cy - 170 || y > cy + 170) continue;
    g.strokeStyle = GRN; g.lineWidth = 2; g.beginPath(); g.moveTo(98, y); g.lineTo(110, y); g.stroke();
    text(g, lbl, 112, y + 6, GRN, 15);
  }
  text(g, String(Math.round(f.ias)), 90, cy + 10, WHT, 28, 'right');
  tape(W - 108, 92, f.alt, 100, 200, (v) => String(v), true);
  text(g, String(Math.round(f.alt)).padStart(3, ' '), W - 22, cy + 10, WHT, 24, 'right');
  if (f.altTgt != null) {
    g.fillStyle = '#000'; g.fillRect(W - 108, cy - 170, 92, 26);
    text(g, String(f.altTgt), W - 62, cy - 150, MAG, 22, 'center');
    const y = cy - (f.altTgt - f.alt) * (340 / 600);
    if (y > cy - 170 && y < cy + 170) { g.strokeStyle = MAG; g.lineWidth = 2.5; g.strokeRect(W - 112, y - 10, 10, 20); }
  }
  if (f.mach > 0.4) text(g, `.${String(Math.round(f.mach * 1000)).padStart(3, '0')}`, 56, cy + 210, WHT, 22, 'center');
  // FMA.
  g.fillStyle = '#000'; g.fillRect(0, 0, W, 58);
  // A/T | roll | pitch: engaged modes large green, armed modes small white;
  // the white box marks a change for 10 s (FCOM 4.10 mode change highlight).
  f.fma.forEach((m, i) => {
    const x = 96 + i * 120;
    if (m) { text(g, m, x, 28, GRN, 20, 'center'); if (f.fmaBox?.[i]) box(g, x - 56, 6, 112, 28, WHT, 1.5); }
    if (f.fmaArm?.[i]) text(g, f.fmaArm[i], x, 52, WHT, 15, 'center');
  });
  g.strokeStyle = '#555'; g.lineWidth = 1;
  for (const x of [156, 276]) { g.beginPath(); g.moveTo(x, 6); g.lineTo(x, 56); g.stroke(); }
  if (f.ap) {
    const w = g.measureText ? (g.font = F(22), g.measureText(f.ap).width + 16) : 120;
    text(g, f.ap, cx, 84, GRN, 22, 'center');
    if (f.fmaBox?.[3]) box(g, cx - w / 2, 62, w, 28, WHT, 1.5);
  }
  // GPWS / windshear on the attitude display.
  const w = d.warn;
  if (w?.pullUp) { g.fillStyle = '#000'; g.fillRect(cx - 62, cy + 58, 124, 34); text(g, 'PULL UP', cx, cy + 84, RED, 26, 'center'); }
  if (w?.windshear === 'red') { g.fillStyle = '#000'; g.fillRect(cx - 82, cy + 100, 164, 34); text(g, 'WINDSHEAR', cx, cy + 126, RED, 26, 'center'); }
  // Heading at the bottom.
  g.fillStyle = '#4a4f55'; g.fillRect(cx - 150, H - 58, 300, 58);
  for (let k = -30; k <= 30; k += 5) {
    const x = cx + k * 4.5, hd = (f.hdg + k + 360) % 360;
    g.strokeStyle = WHT; g.lineWidth = 2;
    g.beginPath(); g.moveTo(x, H - 58); g.lineTo(x, H - (hd % 10 === 0 ? 44 : 50)); g.stroke();
    if (hd % 10 === 0 && Math.abs(k) < 30) text(g, String(Math.round(hd / 10)).padStart(2, '0'), x, H - 22, WHT, 16, 'center');
  }
  g.fillStyle = '#000'; g.fillRect(cx - 28, H - 76, 56, 22); text(g, String(Math.round(f.hdg)).padStart(3, '0'), cx, H - 59, WHT, 18, 'center');
  text(g, 'STD', W - 60, H - 10, CYN, 18, 'center');
  if (Math.abs(f.vs) >= 400) text(g, `${f.vs > 0 ? '+' : ''}${f.vs}`, W - 54, cy + 214, WHT, 16, 'center');
  if (f.ra != null && f.ra < 2500 && !f.onGround) text(g, String(Math.max(0, Math.round(f.ra / 10) * 10)), cx, cy + 190, WHT, 22, 'center');
}

// ── ND (MAP) ────────────────────────────────────────────────────────────────
// Track-up expanded MAP: compass arc, range rings, the FMC route (active leg
// and route magenta, a modification white dashed), waypoints, airports and
// runways, T/C and T/D, the VNAV path deviation on the right in descent.
// d.nav comes from app.js (FMC + flight sim); without it the arc is empty.
function star(g, x, y, r, c) {
  g.strokeStyle = c; g.lineWidth = 2;
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4, rr = i % 2 ? r * 0.32 : r;
    g.lineTo(x + rr * Math.sin(a), y - rr * Math.cos(a));
  }
  g.closePath(); g.stroke();
}
export function drawND(g, W, H, d) {
  clear(g, W, H);
  const f = d.flight, n = d.nav;
  const cx = W / 2, cy = H * 0.86, R = H * 0.66;
  const trkM = n?.ac ? n.ac.trkM : f.hdg;
  const range = n?.range || 40, k = R / range;
  // Compass arc (track up).
  g.strokeStyle = WHT; g.lineWidth = 2;
  g.beginPath(); g.arc(cx, cy, R, Math.PI * 1.17, Math.PI * 1.83); g.stroke();
  const t0 = Math.ceil((trkM - 62) / 5) * 5;
  for (let hd = t0; hd <= trkM + 62; hd += 5) {
    const a = hd - trkM, rad = ((a - 90) * Math.PI) / 180, h = ((hd % 360) + 360) % 360;
    const r1 = R - (h % 10 === 0 ? 16 : 8);
    g.beginPath(); g.moveTo(cx + R * Math.cos(rad), cy + R * Math.sin(rad)); g.lineTo(cx + r1 * Math.cos(rad), cy + r1 * Math.sin(rad)); g.stroke();
    if (h % 30 === 0) { const rr = R - 32; text(g, String(h / 10), cx + rr * Math.cos(rad), cy + rr * Math.sin(rad) + 7, WHT, 18, 'center'); }
  }
  // Heading pointer (no wind: heading = track) and the track box.
  g.fillStyle = '#000'; g.fillRect(cx - 34, cy - R - 34, 68, 28); box(g, cx - 34, cy - R - 34, 68, 28);
  text(g, String(Math.round(trkM) % 360 || 360).padStart(3, '0'), cx, cy - R - 12, WHT, 22, 'center');
  text(g, 'TRK', cx - 44, cy - R - 13, GRN, 16, 'right'); text(g, 'MAG', cx + 44, cy - R - 13, GRN, 16);
  // Range ring at half range.
  g.setLineDash([6, 8]); g.strokeStyle = '#9aa0a6'; g.lineWidth = 1.5;
  g.beginPath(); g.arc(cx, cy, R / 2, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); g.setLineDash([]);
  text(g, String(range / 2), cx - R / 2 * 0.86 - 4, cy - R / 2 * 0.5 + 6, WHT, 15, 'right');
  // Heading pointer (white triangle on the arc). No wind here, so heading = track.
  {
    const rad = -Math.PI / 2;
    const px = cx + (R - 2) * Math.cos(rad), py = cy + (R - 2) * Math.sin(rad);
    g.fillStyle = WHT; g.beginPath(); g.moveTo(px, py + 14); g.lineTo(px - 8, py); g.lineTo(px + 8, py); g.closePath(); g.fill();
  }
  // Track line from the airplane to the arc, with the half-range tick.
  g.strokeStyle = WHT; g.lineWidth = 1.6;
  g.beginPath(); g.moveTo(cx, cy - 24); g.lineTo(cx, cy - R + 16); g.stroke();
  g.beginPath(); g.moveTo(cx - 7, cy - R / 2); g.lineTo(cx + 7, cy - R / 2); g.stroke();
  // Selected heading bug (magenta, always shown); in HDG SEL a dashed line to it.
  if (d.mcpHdg != null) {
    const off = ((d.mcpHdg - trkM + 540) % 360) - 180, a = Math.max(-62, Math.min(62, off));
    const rad = ((a - 90) * Math.PI) / 180, bx = cx + R * Math.cos(rad), by = cy + R * Math.sin(rad);
    g.save(); g.translate(bx, by); g.rotate(rad + Math.PI / 2);
    g.strokeStyle = MAG; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(-10, 0); g.lineTo(-10, -12); g.lineTo(-4, -12); g.lineTo(0, -5); g.lineTo(4, -12); g.lineTo(10, -12); g.lineTo(10, 0); g.closePath(); g.stroke();
    g.restore();
    if (d.hdgSel && Math.abs(off) <= 62) { g.setLineDash([8, 7]); g.strokeStyle = MAG; g.lineWidth = 2; g.beginPath(); g.moveTo(cx, cy - 22); g.lineTo(bx, by); g.stroke(); g.setLineDash([]); }
  }

  if (n?.ac) {
    const A = n.ac, cosL = Math.cos((A.lat * Math.PI) / 180), t = (A.trk * Math.PI) / 180;
    const P = (p) => {
      const dx = (p.lon - A.lon) * 60 * cosL, dy = (p.lat - A.lat) * 60;
      const x = dx * Math.cos(t) - dy * Math.sin(t), y = dx * Math.sin(t) + dy * Math.cos(t);
      return [cx + x * k, cy - y * k];
    };
    g.save();
    g.beginPath(); g.rect(0, 40, W, cy + 30 - 40); g.clip();
    // Runways: two edges along the runway and a dashed extended centreline.
    for (const rw of n.rwys || []) {
      const end = rw.far || rw;
      const [x1, y1] = P(rw), [x2, y2] = P(end);
      const ang = Math.atan2(y2 - y1, x2 - x1), nx = -Math.sin(ang) * 4, ny = Math.cos(ang) * 4;
      g.strokeStyle = WHT; g.lineWidth = 1.6;
      for (const s of [-1, 1]) { g.beginPath(); g.moveTo(x1 + nx * s, y1 + ny * s); g.lineTo(x2 + nx * s, y2 + ny * s); g.stroke(); }
      if (rw.ext) {
        const [ex, ey] = P(rw.ext);
        g.setLineDash([10, 8]); g.beginPath(); g.moveTo(x1, y1); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
      }
      text(g, rw.label, x1 + 10, y1 + 18, WHT, 15);
    }
    // Airports.
    for (const ap of n.apts || []) {
      const [x, y] = P(ap);
      g.strokeStyle = CYN; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.stroke();
      text(g, ap.ident, x + 11, y - 8, CYN, 16);
    }
    // Route: modification white dashed, active magenta.
    const drawRoute = (legs, color, dash, from = 0) => {
      g.strokeStyle = color; g.lineWidth = 2.6; g.setLineDash(dash);
      g.beginPath();
      legs.slice(from).forEach((l, i) => { const [x, y] = P(l); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke(); g.setLineDash([]);
    };
    if (n.mod?.length) drawRoute(n.mod, WHT, [12, 8]);
    if (n.legs?.length) {
      const from = Math.max(0, (n.activeIdx || 1) - 1);
      if (n.active) {
        // Active leg starts at the airplane.
        g.strokeStyle = MAG; g.lineWidth = 2.6;
        drawRoute(n.legs, MAG, [], from);
      } else drawRoute(n.legs, CYN, [10, 8]);
      n.legs.forEach((l, i) => {
        if (n.active && i < from) return;
        if (l.kind === 'rwy' || l.kind === 'rwyArr') return;
        const [x, y] = P(l);
        const act = n.active && i === n.activeIdx;
        if (l.kind === 'apt' || l.kind === 'aptArr') return;
        star(g, x, y, 10, act ? MAG : WHT);
        text(g, l.ident, x + 13, y + 6, act ? MAG : WHT, 17);
        if (l.alt != null) text(g, l.alt >= 18000 ? `FL${Math.round(l.alt / 100)}` : String(l.alt), x + 13, y + 24, WHT, 14);
      });
    }
    // Top of climb / descent.
    for (const [p, lbl] of [[n.tc, 'T/C'], [n.tod, 'T/D']]) {
      if (!p) continue;
      const [x, y] = P(p);
      g.strokeStyle = GRN; g.lineWidth = 2; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.stroke();
      text(g, lbl, x + 11, y + 6, GRN, 16);
    }
    g.restore();
    // Active waypoint data, top right.
    if (n.to) {
      text(g, n.to.ident, W - 14, 26, MAG, 21, 'right');
      text(g, n.to.eta, W - 14, 50, WHT, 18, 'right');
      text(g, `${n.to.dist < 100 ? n.to.dist.toFixed(1) : Math.round(n.to.dist)} NM`, W - 14, 74, WHT, 18, 'right');
    }
    // VNAV path deviation (descent).
    if (n.vdev != null) {
      const x = W - 30, y0 = H * 0.45;
      g.strokeStyle = WHT; g.lineWidth = 2;
      for (const s of [-2, -1, 1, 2]) { g.beginPath(); g.arc(x, y0 + s * 30, 4, 0, Math.PI * 2); g.stroke(); }
      g.beginPath(); g.moveTo(x - 10, y0); g.lineTo(x + 10, y0); g.stroke();
      const dy = Math.max(-66, Math.min(66, (-n.vdev / 400) * 60));
      g.fillStyle = MAG; g.beginPath(); g.moveTo(x, y0 + dy - 9); g.lineTo(x + 7, y0 + dy); g.lineTo(x, y0 + dy + 9); g.lineTo(x - 7, y0 + dy); g.closePath(); g.fill();
    }
  } else text(g, 'NO ACTIVE ROUTE', cx, cy - R * 0.55, CYN, 20, 'center');

  // Curved trend vector (green): where the turn takes us in 30 / 60 / 90 s —
  // one segment at 10 NM range, two at 20, three above.
  if (n?.ac && f.onGround === false && Math.abs(f.bank || 0) > 1 && f.gs > 60) {
    const rate = (1091 * Math.tan(((f.bank || 0) * Math.PI) / 180)) / Math.max(100, f.tas || f.gs);   // °/s
    const segs = range <= 10 ? 1 : range <= 20 ? 2 : 3;
    g.strokeStyle = GRN; g.lineWidth = 2.5;
    let x = cx, y = cy - 22, hdg = 0;
    for (let sgm = 0; sgm < segs; sgm++) {
      g.beginPath(); g.moveTo(x, y);
      for (let t = 0; t < 30; t += 3) {
        hdg += rate * 3;
        const dnm = (f.gs * 3) / 3600;
        x += Math.sin((hdg * Math.PI) / 180) * dnm * k; y -= Math.cos((hdg * Math.PI) / 180) * dnm * k;
        g.lineTo(x, y);
      }
      g.stroke();
      // gaps between segments
      const dnm = (f.gs * 2) / 3600; x += Math.sin((hdg * Math.PI) / 180) * dnm * k; y -= Math.cos((hdg * Math.PI) / 180) * dnm * k;
    }
  }
  // Altitude range arc (green): where the MCP altitude will be reached at the
  // present vertical speed and ground speed.
  if (f.onGround === false && d.mcpAlt != null && Math.abs(f.vsRaw ?? f.vs ?? 0) > 200) {
    const vs = f.vsRaw ?? f.vs, dAlt = d.mcpAlt - f.alt;
    if (Math.sign(dAlt) === Math.sign(vs) && Math.abs(dAlt) > 50) {
      const nm = (Math.abs(dAlt) / Math.abs(vs)) * (f.gs / 60), rr = nm * k;
      if (rr > 26 && rr < R) { g.strokeStyle = GRN; g.lineWidth = 2.5; g.beginPath(); g.arc(cx, cy, rr, Math.PI * 1.42, Math.PI * 1.58); g.stroke(); }
    }
  }
  // Own ship.
  g.strokeStyle = WHT; g.lineWidth = 3;
  g.beginPath(); g.moveTo(cx, cy - 22); g.lineTo(cx - 13, cy + 10); g.lineTo(cx + 13, cy + 10); g.closePath(); g.stroke();
  text(g, 'GS', 12, 26, WHT, 15); text(g, String(Math.round(f.gs)), 40, 26, WHT, 21);
  text(g, 'TAS', 96, 26, WHT, 15); text(g, String(Math.round(f.tas)), 132, 26, WHT, 21);
  text(g, `MAP ${range}`, 14, H - 14, GRN, 15);
  // Terrain / windshear / traffic messages.
  const w = d.warn;
  if (w?.windshear) text(g, 'WINDSHEAR', cx, H * 0.5, w.windshear === 'red' ? RED : AMB, 28, 'center');
  else if (w?.terrain) text(g, w.terrain === 'red' ? 'TERRAIN' : 'CAUTION TERRAIN', cx, H * 0.5, w.terrain === 'red' ? RED : AMB, 28, 'center');
  if (w?.tcas) text(g, 'TRAFFIC', W - 70, H - 30, w.tcas === 'RA' ? RED : AMB, 22, 'center');
}

// ── Gauges for the engine displays ──────────────────────────────────────────
function arcGauge(g, x, y, r, frac, val, redFrac = 1, label = '') {
  const a0 = Math.PI, a1 = Math.PI * 1.0 + Math.PI * 1.17;
  g.strokeStyle = WHT; g.lineWidth = 3;
  g.beginPath(); g.arc(x, y, r, a0, a1); g.stroke();
  g.strokeStyle = '#ff2a2a'; g.lineWidth = 4;
  const ra = a0 + (a1 - a0) * redFrac;
  g.beginPath(); g.moveTo(x + r * Math.cos(ra), y + r * Math.sin(ra)); g.lineTo(x + (r - 12) * Math.cos(ra), y + (r - 12) * Math.sin(ra)); g.stroke();
  if (frac > 0) {
    g.fillStyle = 'rgba(200,200,200,.18)';
    g.beginPath(); g.moveTo(x, y); g.arc(x, y, r - 2, a0, a0 + (a1 - a0) * frac); g.closePath(); g.fill();
  }
  const na = a0 + (a1 - a0) * frac;
  g.strokeStyle = WHT; g.lineWidth = 3;
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r - 4) * Math.cos(na), y + (r - 4) * Math.sin(na)); g.stroke();
  g.fillStyle = '#000'; g.fillRect(x + 4, y - r - 6, r + 12, 30); box(g, x + 4, y - r - 6, r + 12, 30, WHT, 2);
  text(g, val, x + r + 12, y - r + 17, WHT, 22, 'right');
  if (label) text(g, label, x, y + r * 0.62, CYN, 15, 'center');
}

// ── Upper DU: N1, EGT, fuel ─────────────────────────────────────────────────
export function drawUpper(g, W, H, d) {
  clear(g, W, H);
  const { e1, e2 } = d;
  arcGauge(g, 120, 120, 64, e1.n1 / 110, e1.n1.toFixed(1), 104 / 110);
  arcGauge(g, 300, 120, 64, e2.n1 / 110, e2.n1.toFixed(1), 104 / 110);
  text(g, 'N1', 210, 150, CYN, 20, 'center');
  arcGauge(g, 120, 290, 56, e1.egt / 1000, String(Math.round(e1.egt)), 0.95);
  arcGauge(g, 300, 290, 56, e2.egt / 1000, String(Math.round(e2.egt)), 0.95);
  text(g, 'EGT', 210, 316, CYN, 20, 'center');
  if (d.rev) { text(g, 'REV', 120, 64, GRN, 18, 'center'); text(g, 'REV', 300, 64, GRN, 18, 'center'); }
  // ENG FAIL (amber): the engine has run down below idle with its start lever in IDLE.
  (d.engFail || []).forEach((on, i) => {
    if (!on) return;
    const x = i ? 300 : 120;
    g.fillStyle = '#000'; g.fillRect(x - 46, 182, 92, 28); box(g, x - 46, 182, 92, 28, AMB, 2);
    text(g, 'ENG FAIL', x, 204, AMB, 18, 'center');
  });
  // Thermal anti-ice: green when the cowl valve is open, amber if it disagrees.
  (d.tai || []).forEach((t, i) => { if (t) text(g, 'TAI', i ? 300 : 120, 40, t === 'amber' ? AMB : GRN, 18, 'center'); });
  // Fuel quantity.
  const fu = d.fuel;
  if (fu) {
    text(g, 'FUEL', W - 70, 236, CYN, 16, 'center'); text(g, 'KG X 1000', W - 70, 254, CYN, 13, 'center');
    const q = (v) => (v / 1000).toFixed(2);
    const tank = (x, y, v, warn, tag) => {
      text(g, q(v), x, y, warn ? AMB : WHT, 24, 'center');
      if (tag) text(g, tag, x, y + 20, AMB, 14, 'center');
    };
    tank(W - 70, 300, fu.c, fu.config, fu.config ? 'CONFIG' : '');
    tank(W - 112, 380, fu.m1, fu.low1 || fu.imbalLow === 1, fu.low1 ? 'LOW' : fu.imbalLow === 1 ? 'IMBAL' : '');
    tank(W - 28, 380, fu.m2, fu.low2 || fu.imbalLow === 2, fu.low2 ? 'LOW' : fu.imbalLow === 2 ? 'IMBAL' : '');
    text(g, 'CTR', W - 70, 276, WHT, 13, 'center'); text(g, '1', W - 112, 356, WHT, 13, 'center'); text(g, '2', W - 28, 356, WHT, 13, 'center');
    text(g, `TOTAL ${(fu.total / 1000).toFixed(1)}`, W - 70, 440, WHT, 18, 'center');
  }
  text(g, `TAT ${d.tat > 0 ? '+' : ''}${d.tat}c`, 16, 30, WHT, 16);
}

// ── Lower DU: the SYS page — hydraulics, fuel and electrical at a glance ────
// Values come from the systems themselves (hydraulics, fuel, electrical);
// the page only formats them. Amber marks a value outside its normal range.
export function drawLower(g, W, H, d) {
  clear(g, W, H);
  const h = d.hyd || {}, fu = d.fuel || {}, el = d.elec || {};
  text(g, 'SYS', W / 2, 34, CYN, 22, 'center');
  g.strokeStyle = '#444'; g.lineWidth = 1;
  const rule = (y) => { g.beginPath(); g.moveTo(24, y); g.lineTo(W - 24, y); g.stroke(); };
  // ── Hydraulics: three columns, A · B · STBY ──
  rule(52);
  text(g, 'HYDRAULIC', 24, 74, CYN, 15, 'left');
  const cols = [[140, 'A'], [276, 'B'], [412, 'STBY']];
  for (const [x, n] of cols) text(g, n, x, 74, WHT, 18, 'center');
  const press = (p) => (p == null ? '—' : String(p));
  const lo = (p) => p != null && p < 1500;
  text(g, 'PSI', 24, 104, CYN, 13, 'left');
  text(g, press(h.pressA), 140, 104, lo(h.pressA) ? AMB : WHT, 22, 'center');
  text(g, press(h.pressB), 276, 104, lo(h.pressB) ? AMB : WHT, 22, 'center');
  text(g, '—', 412, 104, WHT, 22, 'center');
  text(g, 'QTY %', 24, 140, CYN, 13, 'left');
  text(g, String(h.qtyA ?? '—'), 140, 140, h.qtyA < 40 ? AMB : WHT, 22, 'center');
  text(g, String(h.qtyB ?? '—'), 276, 140, h.qtyB < 40 ? AMB : WHT, 22, 'center');
  text(g, String(h.qtyS ?? '—'), 412, 140, WHT, 22, 'center');
  text(g, 'RESERVOIR', 24, 172, CYN, 13, 'left');
  text(g, h.rfA ? 'RF LOW' : 'OK', 140, 172, h.rfA ? AMB : CYN, 14, 'center');
  text(g, h.rfB ? 'RF LOW' : 'OK', 276, 172, h.rfB ? AMB : CYN, 14, 'center');
  text(g, 'OK', 412, 172, CYN, 14, 'center');
  // ── Fuel: tanks in kg ──
  rule(196);
  text(g, 'FUEL KG', 24, 220, CYN, 15, 'left');
  const tanks = [[160, 'L MAIN', fu.m1, fu.low1], [288, 'CTR', fu.c, false], [416, 'R MAIN', fu.m2, fu.low2]];
  for (const [x, n, v, low] of tanks) {
    text(g, n, x, 220, CYN, 13, 'center');
    text(g, v == null ? '—' : String(v), x, 252, low ? AMB : WHT, 22, 'center');
  }
  text(g, 'TOTAL', 24, 290, CYN, 13, 'left');
  text(g, fu.total != null ? String(fu.total) : '—', 256, 290, WHT, 22, 'center');
  // ── Electrical: sources and battery ──
  rule(308);
  text(g, 'ELECTRICAL', 24, 336, CYN, 15, 'left');
  const src = (s) => (!s || s === 'UNPOWERED' ? AMB : WHT);
  text(g, 'SOURCE 1', 24, 364, CYN, 13, 'left');
  text(g, el.src1 ?? '—', 170, 364, src(el.src1), 16, 'left');
  text(g, 'SOURCE 2', 24, 390, CYN, 13, 'left');
  text(g, el.src2 ?? '—', 170, 390, src(el.src2), 16, 'left');
  text(g, 'BATTERY', 24, 416, CYN, 13, 'left');
  text(g, el.batV != null ? `${el.batV} V` : '—', 170, 416, el.batV != null && el.batV < 25 ? AMB : WHT, 16, 'left');
  // ── Alerts: anything outside the normal range, in amber. ──
  const notes = [];
  if (lo(h.pressA)) notes.push('HYD A LOW PRESS');
  if (lo(h.pressB)) notes.push('HYD B LOW PRESS');
  if (fu.low1 || fu.low2) notes.push('FUEL LOW PRESS');
  if (el.src1 === 'UNPOWERED' || el.src2 === 'UNPOWERED') notes.push('AC BUS UNPOWERED');
  if (notes.length) text(g, notes.join('   '), W / 2, 462, AMB, 15, 'center');
  else text(g, 'NO SYSTEM ALERTS', W / 2, 462, CYN, 14, 'center');
}

// ── MCP ─────────────────────────────────────────────────────────────────────
// One strip, left to right as on the airplane. Canvas 1480 × 110.
export const MCP_W = 1480, MCP_H = 110;
export function drawMCP(g, W, H, d) {
  g.fillStyle = '#c4c8cb'; g.fillRect(0, 0, W, H);
  const f = d.flight, on = (b) => d.mcp.has(b);
  const ias = f.mach > 0.4 ? `.${String(Math.round(f.mach * 100)).padStart(2, '0')}` : String(Math.max(150, Math.round(f.ias / 5) * 5) || 150);
  const items = [
    ['win', 'COURSE', '093', 80], ['btn', 'N1'], ['btn', 'SPEED'], ['win', 'IAS/MACH', ias, 104],
    ['btn', 'VNAV'], ['btn', 'LVL CHG'], ['win', 'HEADING', String(Math.round(f.hdg)).padStart(3, '0'), 84],
    ['btn', 'HDG SEL'], ['btn', 'LNAV'], ['btn', 'VOR LOC'], ['btn', 'APP'],
    ['win', 'ALTITUDE', f.alt > 1000 ? String(f.alt) : '10000', 118], ['btn', 'ALT HLD'],
    ['win', 'VERT SPEED', '', 100], ['btn', 'V/S'], ['btn', 'CMD A'], ['btn', 'CMD B'], ['btn', 'CWS A'],
    ['win', 'COURSE', '093', 80],
  ];
  let x = 14;
  for (const [kind, label, val, w] of items) {
    if (kind === 'win') {
      text(g, label, x + w / 2, 24, '#1e1f20', 14, 'center', 700);
      g.fillStyle = '#0a0a0a'; g.fillRect(x, 32, w, 40);
      text(g, val, x + w - 8, 62, '#ffd9a0', 27, 'right', 600);
      x += w + 8;
    } else {
      g.fillStyle = '#1b1c1e'; g.fillRect(x, 20, 58, 72);
      g.fillStyle = on(label) ? GRN : '#2c3b2c'; g.fillRect(x + 8, 27, 42, 7);
      text(g, label, x + 29, 70, '#ececec', label.length > 5 ? 11 : 13, 'center');
      x += 64;
    }
  }
  text(g, 'A/T', 1474, 100, '#1e1f20', 11, 'right');
}

// ── ISFD ────────────────────────────────────────────────────────────────────
export function drawISFD(g, W, H, d) {
  clear(g, W, H);
  const f = d.flight, cy = H / 2 + f.pitch * 5;
  g.fillStyle = '#1c78d4'; g.fillRect(40, 0, W - 80, cy); g.fillStyle = '#7b4a1e'; g.fillRect(40, cy, W - 80, H);
  g.fillStyle = '#333'; g.fillRect(0, 0, 40, H); g.fillRect(W - 40, 0, 40, H);
  text(g, String(Math.round(f.ias)), 36, H / 2 + 6, WHT, 14, 'right');
  text(g, String(Math.round(f.alt / 10) * 10), W - 4, H / 2 + 6, WHT, 12, 'right');
  g.strokeStyle = '#ffd400'; g.lineWidth = 3; g.beginPath(); g.moveTo(W / 2 - 24, H / 2); g.lineTo(W / 2 + 24, H / 2); g.stroke();
}
