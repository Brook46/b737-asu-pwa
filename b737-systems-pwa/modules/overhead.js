// overhead.js — SVG overhead-panel kit, drawn to look like the 737 panels so
// the controls feel familiar: Boeing-gray panels with white mimic lines and
// legends, chrome bat-handle toggles (a three-position switch's centre is
// seen end-on), guards you lift before you can move the switch, black
// selector knobs, round gauges, LCD windows, and annunciators that glow
// amber / blue / green the way the FCOM figures show them.
//
// Each panel is one <svg> 300 units wide. Controls read and write the
// system's switch state through ctx (sw, set, action), exactly like the
// HTML controls they replace.

const NS = 'http://www.w3.org/2000/svg';
let uid = 0;

function el(tag, attrs = {}, parent) {
  const n = document.createElementNS(NS, tag);
  for (const k in attrs) if (attrs[k] != null) n.setAttribute(k, attrs[k]);
  if (parent) parent.append(n);
  return n;
}

function defs(svg, id) {
  const d = el('defs', {}, svg);
  d.innerHTML = `
    <radialGradient id="nut${id}" cx="40%" cy="35%" r="70%">
      <stop offset="0" stop-color="#d9dcde"/><stop offset=".55" stop-color="#8d9296"/><stop offset="1" stop-color="#3e4246"/>
    </radialGradient>
    <linearGradient id="chrome${id}" x1="0" x2="1">
      <stop offset="0" stop-color="#8c9196"/><stop offset=".35" stop-color="#ffffff"/><stop offset=".6" stop-color="#c3c7ca"/><stop offset="1" stop-color="#6c7176"/>
    </linearGradient>
    <radialGradient id="tip${id}" cx="38%" cy="32%" r="75%">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".5" stop-color="#c9cdd0"/><stop offset="1" stop-color="#6d7277"/>
    </radialGradient>
    <radialGradient id="knob${id}" cx="40%" cy="30%" r="80%">
      <stop offset="0" stop-color="#4a4d50"/><stop offset=".6" stop-color="#1c1e20"/><stop offset="1" stop-color="#050505"/>
    </radialGradient>
    <filter id="glow${id}" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>`;
}

const pt = (r, deg) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];

export function createOverhead(host, ctx) {
  host.replaceChildren();
  const binds = [];
  const update = (res) => { for (const b of binds) b(res); };

  /** Start a new panel drawing. */
  function panel(title, h, o = {}) {
    const id = ++uid;
    const wrap = document.createElement('div');
    wrap.className = 'ovh-wrap';
    const svg = el('svg', { viewBox: `0 0 300 ${h}`, class: 'ovh', role: 'group', 'aria-label': title });
    wrap.append(svg);
    host.append(wrap);
    defs(svg, id);
    el('rect', { x: 0, y: 0, width: 300, height: h, rx: 4, class: 'ovh-bg' }, svg);
    // Corner screws.
    for (const [x, y] of [[8, 8], [292, 8], [8, h - 8], [292, h - 8]]) {
      el('circle', { cx: x, cy: y, r: 3, fill: '#4b5156', stroke: '#2b2f33' }, svg);
      el('line', { x1: x - 2, y1: y, x2: x + 2, y2: y, stroke: '#2b2f33', 'stroke-width': 1 }, svg);
    }
    const layers = { base: el('g', {}, svg), lines: el('g', {}, svg), parts: el('g', {}, svg) };

    const P = {
      svg,
      band(y, hh) { el('rect', { x: 0, y, width: 300, height: hh, class: 'ovh-band' }, layers.base); },
      /** White mimic line. */
      line(points, w = 2.4) {
        el('path', { d: 'M' + points.map((p) => p.join(',')).join(' L'), class: 'ovh-line', 'stroke-width': w }, layers.lines);
      },
      /** Boeing-style outlined group with its title set into the line. */
      frame(x, y, w, hh, label, at = 'top') {
        el('rect', { x, y, width: w, height: hh, rx: 3, class: 'ovh-frame' }, layers.lines);
        if (label) P.text(x + w / 2, at === 'top' ? y + 3.5 : y + hh + 3.5, label, { box: true, size: 9 });
      },
      text(x, y, str, o2 = {}) {
        const size = o2.size ?? 8.5;
        const g = el('g', {}, layers.parts);
        const lines = String(str).split('\n');
        if (o2.box) {
          const w = Math.max(...lines.map((l) => l.length)) * size * 0.56 + 8;
          const hh = lines.length * size * 1.1 + 3;
          el('rect', { x: x - (o2.anchor === 'start' ? 4 : o2.anchor === 'end' ? w - 4 : w / 2), y: y - size * 0.95, width: w, height: hh, rx: 1.5, class: 'ovh-labelbox' }, g);
        }
        lines.forEach((ln, i) => {
          const t = el('text', { x, y: y + i * size * 1.1, 'text-anchor': o2.anchor ?? 'middle', class: 'ovh-t', 'font-size': size }, g);
          t.textContent = ln;
        });
        return g;
      },
      /** Annunciator. color: amber | blue | green. key: lights[key] or fn(res). */
      lamp(x, y, w, hh, legend, key, color = 'amber') {
        const g = el('g', { class: 'ovh-lamp ' + color }, layers.parts);
        const r = el('rect', { x, y, width: w, height: hh, rx: 1.5, class: 'lens' }, g);
        const lines = String(legend).split('\n');
        const fs = Math.min(7.2, (w - 4) / (Math.max(...lines.map((l) => l.length)) * 0.6));
        const t = el('g', {}, g);
        lines.forEach((ln, i) => {
          const tt = el('text', { x: x + w / 2, y: y + hh / 2 + fs * 0.36 + (i - (lines.length - 1) / 2) * fs * 1.12, 'text-anchor': 'middle', 'font-size': fs, class: 'legend' }, t);
          tt.textContent = ln;
        });
        binds.push((res) => {
          const v = key == null ? false : typeof key === 'function' ? key(res) : res.lights?.[key];
          g.classList.toggle('on', !!v && v !== 'dim');
          g.classList.toggle('dim', v === 'dim');
          if (v && v !== 'dim') r.setAttribute('filter', `url(#glow${id})`); else r.removeAttribute('filter');
        });
        if (key == null) g.classList.add('inert');
        return g;
      },
      /**
       * Bat-handle toggle. positions: top→bottom (or left→right when
       * horizontal). Options: name, guard ('red'|'black') + guardPos,
       * momentary [indices], inert, labels 'right'|'left'.
       */
      toggle(x, y, key, positions, o2 = {}) {
        const g = el('g', { transform: `translate(${x},${y})`, class: 'ovh-tg' + (o2.inert ? ' inert' : '') }, layers.parts);
        const inner = el('g', { transform: o2.horizontal ? 'rotate(-90)' : null }, g);
        if (o2.housing) el('rect', { x: -12, y: -26, width: 24, height: 52, rx: 3, fill: '#151719' }, inner);
        el('circle', { r: 10.5, fill: `url(#nut${id})`, stroke: '#2a2d30', 'stroke-width': 1 }, inner);
        el('polygon', { points: [0, 1, 2, 3, 4, 5].map((i) => pt(6.4, i * 60 + 30).join(',')).join(' '), fill: '#5d6267', stroke: '#2d3134' }, inner);
        const lever = el('g', {}, inner);
        el('path', { d: 'M-2.6,0 L-3.6,-17 L3.6,-17 L2.6,0 Z', fill: `url(#chrome${id})`, stroke: '#55595d', 'stroke-width': .5 }, lever);
        el('ellipse', { cx: 0, cy: -19, rx: 5.2, ry: 6.2, fill: `url(#tip${id})`, stroke: '#5f6468', 'stroke-width': .6 }, lever);
        const endOn = el('circle', { r: 5.4, fill: `url(#tip${id})`, stroke: '#5f6468', 'stroke-width': .6 }, inner);
        // Position legends.
        const n = positions.length;
        const side = o2.labels === 'left' ? -1 : 1;
        positions.forEach((p, i) => {
          if (!p || p === '·') return;
          let lx, ly;
          if (o2.horizontal) { lx = (n === 2 ? (i ? 16 : -16) : (i - 1) * 18); ly = -15; }
          else { lx = side * 14; ly = n === 2 ? (i ? 18 : -13) : (i - 1) * 15 + 3; }
          P.text(x + lx, y + ly, p, { size: 6.8, anchor: o2.horizontal ? 'middle' : side > 0 ? 'start' : 'end' });
        });
        if (o2.name) P.text(x, y + (o2.horizontal ? 22 : 36), o2.name, { size: 8, box: o2.nameBox !== false });
        // Guard.
        let guardOpen = false;
        let gClosed = null, gOpen = null;
        if (o2.guard && !o2.inert) {
          const col = o2.guard === 'red' ? '#c4302b' : '#1d1f21';
          const edge = o2.guard === 'red' ? '#7d1714' : '#000';
          gClosed = el('g', { class: 'ovh-guard' }, inner);
          el('rect', { x: -12.5, y: -27, width: 25, height: 54, rx: 3, fill: col, stroke: edge, 'stroke-width': 1 }, gClosed);
          el('rect', { x: -8, y: -22, width: 16, height: 44, rx: 2, fill: 'none', stroke: 'rgba(255,255,255,.18)' }, gClosed);
          gOpen = el('g', { class: 'ovh-guard' }, inner);
          el('rect', { x: -12.5, y: -38, width: 25, height: 9, rx: 2, fill: col, stroke: edge, 'stroke-width': 1 }, gOpen);
          gClosed.addEventListener('click', (e) => { e.stopPropagation(); guardOpen = true; paint(); });
          gOpen.addEventListener('click', (e) => {
            e.stopPropagation();
            guardOpen = false;
            // Closing the guard pushes the switch to its guarded position.
            if (o2.guardPos != null && ctx.sw[key] !== o2.guardPos) ctx.set(key, o2.guardPos);
            paint();
          });
        }
        if (o2.guard && o2.inert) {
          const col = o2.guard === 'red' ? '#c4302b' : '#1d1f21';
          el('rect', { x: -12.5, y: -27, width: 25, height: 54, rx: 3, fill: col, stroke: '#000', 'stroke-width': 1, opacity: .92 }, inner);
        }
        const hit = el('rect', { x: -15, y: -30, width: 30, height: 60, fill: 'transparent', class: 'ovh-hit' }, inner);
        if (gClosed) inner.append(gClosed, gOpen);
        let thrown = null;
        const paint = () => {
          const i = thrown ?? (o2.inert ? o2.inertPos ?? 0 : ctx.sw[key] ?? 0);
          const mid = n === 3 && i === 1;
          lever.style.display = mid ? 'none' : '';
          endOn.style.display = mid ? '' : 'none';
          lever.setAttribute('transform', i === n - 1 && !mid ? 'scale(1,-1)' : '');
          if (gClosed) { gClosed.style.display = guardOpen ? 'none' : ''; gOpen.style.display = guardOpen ? '' : 'none'; }
        };
        if (!o2.inert) hit.addEventListener('click', (e) => {
          const r = hit.getBoundingClientRect();
          const up = o2.horizontal ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
          const cur = ctx.sw[key];
          const next = Math.max(0, Math.min(n - 1, cur + (up ? -1 : 1)));
          if (next === cur) return;
          if (o2.momentary?.includes(next)) {
            thrown = next; paint();
            ctx.action(key, positions[next]);
            setTimeout(() => { thrown = null; paint(); }, 260);
            return;
          }
          ctx.set(key, next);
        });
        binds.push(paint);
        return g;
      },
      /** Black selector knob. Tap the left half to turn left, right half right. */
      knob(x, y, key, positions, angles, o2 = {}) {
        const R = o2.r ?? 12;
        const g = el('g', { transform: `translate(${x},${y})`, class: 'ovh-knob' + (o2.inert ? ' inert' : '') }, layers.parts);
        if (o2.skirt) el('circle', { r: R + 4, fill: '#2d3135', stroke: '#1a1c1e' }, g);
        el('circle', { r: R, fill: `url(#knob${id})`, stroke: '#000', 'stroke-width': 1 }, g);
        const ptr = el('g', {}, g);
        if (o2.bar) {
          el('rect', { x: -2.2, y: -R + 1.5, width: 4.4, height: 2 * R - 3, rx: 2, fill: '#e9e9e9' }, ptr);
          for (const dx of [-6, 6]) el('rect', { x: dx - 1, y: -R + 4, width: 2, height: 2 * R - 8, rx: 1, fill: '#3a3d40' }, ptr);
        } else {
          el('rect', { x: -1.6, y: -R + 1, width: 3.2, height: R, rx: 1.4, fill: '#f2f2f2' }, ptr);
        }
        if (!o2.noLabels) positions.forEach((p, i) => {
          if (!p) return;
          const [lx, ly] = pt(R + 12, angles[i]);
          P.text(x + lx, y + ly + 2.5, p, { size: 6.6 });
        });
        if (o2.name) P.text(x, y + R + (o2.nameDy ?? 16), o2.name, { size: 7.5, box: true });
        if (!o2.inert) g.addEventListener('click', (e) => {
          const r = g.getBoundingClientRect();
          const left = e.clientX < r.left + r.width / 2;
          const next = Math.max(0, Math.min(positions.length - 1, (ctx.sw[key] ?? 0) + (left ? -1 : 1)));
          if (o2.action) ctx.action(key, left ? 'DEC' : 'INC'); else ctx.set(key, next);
        });
        const idx = () => (o2.inert ? o2.inertPos ?? 0 : ctx.sw[key] ?? 0);
        binds.push(() => { ptr.setAttribute('transform', `rotate(${o2.action ? 0 : angles[idx()] ?? 0})`); });
        return g;
      },
      /** Round push button (TRIP RESET, OVHT TEST, MAINT, ALT HORN CUTOUT). */
      push(x, y, fn, o2 = {}) {
        const g = el('g', { transform: `translate(${x},${y})`, class: 'ovh-push' + (fn ? '' : ' inert') }, layers.parts);
        el('circle', { r: 9.5, fill: '#b9bdc0', stroke: '#2b2e31' }, g);
        el('circle', { r: 7, fill: '#0e0f10', stroke: '#000' }, g);
        if (o2.top) P.text(x, y - 14, o2.top, { size: 6.8 });
        if (o2.bottom) P.text(x, y + 19, o2.bottom, { size: 6.8 });
        if (fn) g.addEventListener('click', () => {
          g.classList.add('down'); setTimeout(() => g.classList.remove('down'), 160);
          fn();
        });
        return g;
      },
      /** Round instrument. Angles in degrees clockwise from 12 o'clock. */
      gauge(x, y, r, o2) {
        const g = el('g', { transform: `translate(${x},${y})` }, layers.parts);
        el('circle', { r: r + 3, fill: '#2b2e31' }, g);
        el('circle', { r, fill: '#0b0c0d', stroke: '#9aa0a5', 'stroke-width': 1 }, g);
        const { min, max, a0, a1 } = o2;
        const ang = (v) => a0 + ((Math.max(min, Math.min(max, v)) - min) / (max - min)) * (a1 - a0);
        for (const v of o2.ticks || []) {
          const major = (o2.major || []).includes(v);
          const [x0, y0] = pt(r - 1.5, ang(v)), [x1, y1] = pt(r - (major ? 7 : 4), ang(v));
          el('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: '#f2f2f2', 'stroke-width': major ? 1.4 : .8 }, g);
        }
        for (const [v, txt] of o2.labels || []) {
          const [lx, ly] = pt(r - 13, ang(v));
          const t = el('text', { x: lx, y: ly + 2.6, 'text-anchor': 'middle', class: 'ovh-gl', 'font-size': o2.lfs ?? 7 }, g);
          t.textContent = txt;
        }
        if (o2.caption) {
          String(o2.caption).split('\n').forEach((c, i) => {
            const t = el('text', { x: 0, y: (o2.capY ?? r * 0.42) + i * 6.5, 'text-anchor': 'middle', class: 'ovh-gl', 'font-size': 5.6 }, g);
            t.textContent = c;
          });
        }
        for (const nd of o2.needles || []) {
          const ng = el('g', {}, g);
          el('path', { d: `M-1.6,4 L0,${-(r - 6)} L1.6,4 Z`, fill: '#f6f6f6' }, ng);
          if (nd.tag) { const t = el('text', { x: 0, y: -(r - 16), 'text-anchor': 'middle', 'font-size': 6.5, class: 'ovh-needle-t' }, ng); t.textContent = nd.tag; }
          binds.push((res) => ng.setAttribute('transform', `rotate(${ang(nd.fn(res))})`));
        }
        el('circle', { r: 3.4, fill: '#2b2e31', stroke: '#888' }, g);
        return g;
      },
      /** LCD window (FLT ALT, LAND ALT, meters). */
      lcd(x, y, w, fn, o2 = {}) {
        el('rect', { x, y, width: w, height: o2.h ?? 15, rx: 1.5, fill: '#060708', stroke: '#33373a' }, layers.parts);
        const t = el('text', { x: x + w - 4, y: y + (o2.h ?? 15) - 4, 'text-anchor': 'end', class: 'ovh-lcd', 'font-size': o2.size ?? 10.5 }, layers.parts);
        binds.push((res) => { t.textContent = fn(res); });
      },
    };
    return P;
  }

  return { panel, update };
}
