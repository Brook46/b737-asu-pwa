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

// Styles live inside each SVG too, so a panel serialized into an image (the
// 3D cockpit's textures) looks exactly like the one on the page. Image SVGs
// can't load web fonts, so the condensed system fonts come first there.
const FONT = "'Barlow Condensed', 'Avenir Next Condensed', 'Arial Narrow', Arial, sans-serif";
const STYLE = `
  .ovh-bg { fill: #6d747a; stroke: #3b4044; stroke-width: 2; }
  .ovh-band { fill: #4f555a; }
  .ovh-line { fill: none; stroke: #eef0f1; stroke-linejoin: round; stroke-linecap: round; }
  .ovh-frame { fill: none; stroke: #eef0f1; stroke-width: 1.5; }
  .ovh-labelbox { fill: #3a3f43; }
  .ovh-t, .ovh-gl { fill: #f4f5f6; font-family: ${FONT}; font-weight: 600; letter-spacing: .05em; }
  .ovh-needle-t { fill: #0b0c0d; font-family: ${FONT}; font-weight: 700; }
  .ovh-lcd { fill: #eaf4ec; font-family: 'JetBrains Mono', Menlo, monospace; font-weight: 700; letter-spacing: .08em; }
  .ovh-lamp .lens { fill: #0a0b0c; stroke: #26292c; stroke-width: 1; }
  .ovh-lamp .legend { fill: #3f4448; font-family: ${FONT}; font-weight: 700; letter-spacing: .03em; }
  .ovh-lamp.amber.on .lens { stroke: #ffae22; } .ovh-lamp.amber.on .legend { fill: #ffb42e; }
  .ovh-lamp.blue.on .lens { fill: #2a6dff; stroke: #9cc0ff; } .ovh-lamp.blue.on .legend { fill: #ffffff; }
  .ovh-lamp.blue.dim .lens { fill: #183a78; stroke: #2e4f8c; } .ovh-lamp.blue.dim .legend { fill: #a9c2f2; }
  .ovh-lamp.green.on .lens { stroke: #46e584; } .ovh-lamp.green.on .legend { fill: #46e584; }
  .ovh-lamp.red .lens { fill: #3a0d0d; } .ovh-lamp.red .legend { fill: #6b2a2a; }
  .ovh-lamp.red.on .lens { fill: #e03131; stroke: #ff8787; } .ovh-lamp.red.on .legend { fill: #fff; }
  .ovh-lamp.white.on .lens { stroke: #f1f3f5; } .ovh-lamp.white.on .legend { fill: #f8f9fa; }
  .ovh-lamp.flash .lens, .ovh-lamp.flash .legend { animation: ovhFlash 1s steps(2, jump-none) infinite; }
  @keyframes ovhFlash { 50% { opacity: .25; } }
  .ovh-push.down circle:last-child { fill: #3a3d40; }
  .ovh-fire { cursor: pointer; } .ovh-fire-t { fill: #fff; font-family: ${FONT}; font-weight: 800; }`;

const pt = (r, deg) => [r * Math.sin((deg * Math.PI) / 180), -r * Math.cos((deg * Math.PI) / 180)];

/**
 * host: element to draw into (null → a detached container, for textures).
 * Every interactive control is also recorded in panel.controls with its box
 * in panel units and an act(px, py) that does what a tap there would do —
 * the 3D cockpit uses that to operate panels drawn as textures.
 */
export function createOverhead(host, ctx) {
  const ctxRoot = ctx;
  host = host || document.createElement('div');
  host.replaceChildren();
  const binds = [];
  const panels = [];
  const update = (res) => { for (const b of binds) b(res); };

  /** Start a new panel drawing. */
  function panel(title, h, o = {}) {
    const id = ++uid;
    const wrap = document.createElement('div');
    wrap.className = 'ovh-wrap';
    const svg = el('svg', { viewBox: `0 0 300 ${h}`, class: 'ovh', role: 'group', 'aria-label': title });
    wrap.append(svg);
    host.append(wrap);
    svg.setAttribute('xmlns', NS);
    defs(svg, id);
    el('style', {}, svg).textContent = STYLE;
    const bgRect = el('rect', { x: 0, y: 0, width: 300, height: h, rx: 4, class: 'ovh-bg' }, svg);
    // o.bg: panel colour (control-stand panels are black, the MCP darker grey).
    if (o.bg) bgRect.style.fill = o.bg;
    const controls = [];
    // Corner screws.
    for (const [x, y] of [[8, 8], [292, 8], [8, h - 8], [292, h - 8]]) {
      el('circle', { cx: x, cy: y, r: 3, fill: '#4b5156', stroke: '#2b2f33' }, svg);
      el('line', { x1: x - 2, y1: y, x2: x + 2, y2: y, stroke: '#2b2f33', 'stroke-width': 1 }, svg);
    }
    const layers = { base: el('g', {}, svg), lines: el('g', {}, svg), parts: el('g', {}, svg) };

    const P = {
      svg, title, h, controls,
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
          g.classList.toggle('flash', v === 'flash');
          if (v && v !== 'dim') r.setAttribute('filter', `url(#glow${id})`); else r.removeAttribute('filter');
        });
        if (key == null) g.classList.add('inert');
        // Push-lights (MASTER CAUTION, FIRE WARN, BELOW G/S): press is the 9th argument.
        const press = arguments[8];
        if (press) { g.classList.add('ovh-pushlamp'); g.addEventListener('click', press); }
        controls.push({
          kind: press ? 'push' : 'lamp', name: String(legend).replace(/\n/g, ' '), about: arguments[7], inert: !press,
          x0: x, x1: x + w, y0: y, y1: y + hh, pos: () => (g.classList.contains('on') ? 'ON' : g.classList.contains('dim') ? 'DIM' : 'OFF'),
          act() { if (press) { press(); return 'pressed'; } return 'lamp'; },
        });
        return g;
      },
      /**
       * Bat-handle toggle. positions: top→bottom (or left→right when
       * horizontal). Options: name, guard ('red'|'black') + guardPos,
       * momentary [indices], inert, labels 'right'|'left'.
       */
      toggle(x, y, key, positions, o2 = {}) {
        const ctx0 = o2.ctx || ctxRoot;   // a switch can belong to another system's state
        // invert: the state's 1 is the TOP position (F/D, A/T ARM: ON is up).
        const flip = (v) => (o2.invert ? positions.length - 1 - (v ?? 0) : v);
        const ctx = !o2.invert ? ctx0 : {
          get sw() { return new Proxy(ctx0.sw, { get: (o, k) => (k === key ? flip(o[k]) : o[k]) }); },
          set: (k, v) => ctx0.set(k, k === key ? flip(v) : v), action: (...a) => ctx0.action(...a), touched: () => ctx0.touched?.(),
        };
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
          if (!p || p === '·' || o2.noLabels) return;
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
          gClosed.addEventListener('click', (e) => { e.stopPropagation(); openGuard(); });
          gOpen.addEventListener('click', (e) => { e.stopPropagation(); closeGuard(); });
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
        function openGuard() { guardOpen = true; paint(); ctx.touched?.(); }
        function closeGuard() {
          guardOpen = false;
          // Closing the guard pushes the switch to its guarded position.
          if (o2.guardPos != null && ctx.sw[key] !== o2.guardPos) ctx.set(key, o2.guardPos);
          paint(); ctx.touched?.();
        }
        function operate(up) {
          const cur = ctx.sw[key];
          const next = Math.max(0, Math.min(n - 1, cur + (up ? -1 : 1)));
          if (next === cur) return;
          if (o2.momentary?.includes(next)) {
            thrown = next; paint(); ctx.touched?.();
            ctx.action(key, positions[next]);
            setTimeout(() => { thrown = null; paint(); ctx.touched?.(); }, 260);
            return;
          }
          ctx.set(key, next);
        }
        if (!o2.inert) hit.addEventListener('click', (e) => {
          const r = hit.getBoundingClientRect();
          operate(o2.horizontal ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2);
        });
        const hz = !!o2.horizontal;
        controls.push({
          kind: 'toggle', key, positions, name: o2.name || o2.label || key, about: o2.about, inert: !!o2.inert,
          x0: x - (hz ? 40 : 16), x1: x + (hz ? 30 : 16), y0: y - (hz ? 16 : 40), y1: y + (hz ? 16 : 30),
          pos: () => positions[thrown ?? (o2.inert ? o2.inertPos ?? 0 : ctx.sw[key] ?? 0)],
          guarded: () => !!(o2.guard && !o2.inert && !guardOpen),
          act(px, py) {
            if (o2.inert) return 'inert';
            if (o2.guard && !guardOpen) { openGuard(); return 'guard-open'; }
            // The lifted guard sits just beyond the switch's top (left when horizontal).
            if (o2.guard && guardOpen && (hz ? px < x - 28 : py < y - 28)) { closeGuard(); return 'guard-closed'; }
            operate(hz ? px < x : py < y);
            return 'moved';
          },
        });
        binds.push(paint);
        return g;
      },
      /** Black selector knob. Tap the left half to turn left, right half right. */
      knob(x, y, key, positions, angles, o2 = {}) {
        const R = o2.r ?? 12;
        const g = el('g', { transform: `translate(${x},${y})`, class: 'ovh-knob' + (o2.inert ? ' inert' : '') }, layers.parts);
        if (o2.skirt) el('circle', { r: R + 4, fill: '#2d3135', stroke: '#1a1c1e' }, g);
        if (o2.grey) {
          // Light-grey bar knob (ENGINE START, AUTO BRAKE, IRS): round base, a
          // raised grip bar along the pointer, a black index line on the bar.
          el('circle', { r: R, fill: '#c9cdd0', stroke: '#5c6266', 'stroke-width': 1 }, g);
        } else if (o2.knurl) {
          // Grey knurled knob (FLT ALT / LAND ALT): a ring of grip bumps.
          const pts2 = [];
          for (let i = 0; i < 48; i++) { const rr = i % 2 ? R : R - 1.6; pts2.push(pt(rr, i * 7.5).join(',')); }
          el('polygon', { points: pts2.join(' '), fill: '#9da2a6', stroke: '#41464a', 'stroke-width': .8 }, g);
          el('circle', { r: R * 0.62, fill: '#b6babd', stroke: '#6b7074' }, g);
        } else el('circle', { r: R, fill: `url(#knob${id})`, stroke: '#000', 'stroke-width': 1 }, g);
        const ptr = el('g', {}, g);
        if (o2.grey) {
          el('rect', { x: -R * 0.32, y: -R * 1.08, width: R * 0.64, height: R * 2.16, rx: R * 0.3, fill: '#dfe2e4', stroke: '#6b7175', 'stroke-width': .8 }, ptr);
          el('rect', { x: -0.9, y: -R * 1.02, width: 1.8, height: R * 0.95, fill: '#111' }, ptr);
        } else if (o2.bar) {
          el('rect', { x: -2.2, y: -R + 1.5, width: 4.4, height: 2 * R - 3, rx: 2, fill: '#e9e9e9' }, ptr);
          for (const dx of [-6, 6]) el('rect', { x: dx - 1, y: -R + 4, width: 2, height: 2 * R - 8, rx: 1, fill: '#3a3d40' }, ptr);
        } else if (!o2.knurl) {
          el('rect', { x: -1.6, y: -R + 1, width: 3.2, height: R, rx: 1.4, fill: '#f2f2f2' }, ptr);
        }
        if (!o2.noLabels) positions.forEach((p, i) => {
          if (!p) return;
          const [lx, ly] = pt(R + 12, angles[i]);
          P.text(x + lx, y + ly + 2.5, p, { size: 6.6 });
        });
        if (o2.name) P.text(x, y + R + (o2.nameDy ?? 16), o2.name, { size: 7.5, box: true });
        let thrown = null;
        const turn = (left) => {
          const next = Math.max(0, Math.min(positions.length - 1, (ctx.sw[key] ?? 0) + (left ? -1 : 1)));
          if (o2.action) { ctx.action(key, left ? 'DEC' : 'INC'); return; }
          // Spring-loaded positions (APU START): act, show the throw, spring back.
          if (o2.momentary?.includes(next)) {
            thrown = next; ptr.setAttribute('transform', `rotate(${angles[next]})`); ctx.touched?.();
            ctx.action(key, positions[next]);
            setTimeout(() => { thrown = null; ptr.setAttribute('transform', `rotate(${angles[idx()]})`); ctx.touched?.(); }, 400);
            return;
          }
          ctx.set(key, next);
        };
        if (!o2.inert) g.addEventListener('click', (e) => {
          const r = g.getBoundingClientRect();
          turn(e.clientX < r.left + r.width / 2);
        });
        const idx = () => thrown ?? (o2.inert ? o2.inertPos ?? 0 : ctx.sw[key] ?? 0);
        controls.push({
          kind: 'knob', key, positions, name: o2.name || o2.label || key, about: o2.about, inert: !!o2.inert,
          x0: x - R - 6, x1: x + R + 6, y0: y - R - 6, y1: y + R + 6,
          pos: () => (o2.action ? '' : positions[idx()]),
          act(px) { if (o2.inert) return 'inert'; turn(px < x); return 'moved'; },
        });
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
        const press = () => {
          g.classList.add('down'); ctx.touched?.();
          setTimeout(() => { g.classList.remove('down'); ctx.touched?.(); }, 160);
          fn();
        };
        if (fn) g.addEventListener('click', press);
        controls.push({
          kind: 'push', name: o2.name || [o2.top, o2.bottom].filter(Boolean).join(' '), about: o2.about, inert: !fn,
          x0: x - 12, x1: x + 12, y0: y - 12, y1: y + 12, pos: () => '',
          act() { if (!fn) return 'inert'; press(); return 'pressed'; },
        });
        return g;
      },
      /**
       * Instrument dial, built to match the real gauge faces. Angles are
       * degrees clockwise from 12 o'clock; each scale maps value → angle
       * (piecewise via `pts: [[v, deg], …]` for non-linear faces).
       *   bezel: 'round' | 'teardrop' | 'octagon' | 'half'
       *   scales: [{ pts, ticks: [[v, len(0-1 of r), width]], labels: [[v, text]], lr, lfs,
       *              ring, r0 (tick outer radius, fraction of r), bands: [[v0, v1, color, w]] }]
       *   texts: [[x, y, text, size, anchor, fill]] (fractions of r)
       *   needles: [{ fn, scale, len, w, tag, tail }]
       *   hub: fraction of r
       */
      dial(x, y, r, o2) {
        const g = el('g', { transform: `translate(${x},${y})` }, layers.parts);
        const map = (pts, v) => {
          if (v <= pts[0][0]) return pts[0][1];
          for (let i = 1; i < pts.length; i++) {
            const [v0, a0] = pts[i - 1], [v1, a1] = pts[i];
            if (v <= v1) return a0 + ((v - v0) / (v1 - v0)) * (a1 - a0);
          }
          return pts[pts.length - 1][1];
        };
        // Bezel / mount.
        const bz = o2.bezel || 'round';
        if (bz === 'teardrop') el('path', { d: `M${-r * 1.75},0 L${-r * 0.55},${-r * 0.95} A${r * 1.12},${r * 1.12} 0 1 1 ${-r * 0.55},${r * 0.95} Z`, fill: '#1e2022' }, g);
        if (bz === 'octagon') {
          const R = r * 1.2, k = R * 0.42;
          el('path', { d: `M${-R + k},${-R} H${R - k} L${R},${-R + k} V${R - k} L${R - k},${R} H${-R + k} L${-R},${R - k} V${-R + k} Z`, fill: '#3e4246' }, g);
        }
        if (bz === 'half') {
          el('circle', { r: r + 3, fill: '#2a2d30' }, g);
          el('path', { d: `M${-r},0 A${r},${r} 0 0 1 ${r},0 Z`, fill: '#0b0c0d' }, g);
          el('path', { d: `M${-r},0 A${r},${r} 0 0 0 ${r},0 Z`, fill: '#454a4e' }, g);
        } else {
          el('circle', { r: r + 4, fill: '#2a2d30' }, g);
          el('circle', { r: r + 1, fill: '#0b0c0d', stroke: '#5a5f63', 'stroke-width': .8 }, g);
        }
        for (const sc of o2.scales || []) {
          const r0 = (sc.r0 ?? 0.97) * r;
          if (sc.ring) el('circle', { r: sc.ring * r, fill: 'none', stroke: '#e9e9e9', 'stroke-width': .7 }, g);
          for (const [v0, v1, color, w] of sc.bands || []) {
            const a0 = map(sc.pts, v0), a1 = map(sc.pts, v1), rr = r0 - (w ?? 3) / 2;
            const [x0, y0] = pt(rr, a0), [x1, y1] = pt(rr, a1);
            el('path', { d: `M${x0},${y0} A${rr},${rr} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1},${y1}`, fill: 'none', stroke: color, 'stroke-width': w ?? 3 }, g);
          }
          for (const [v, len, w] of sc.ticks || []) {
            const a = map(sc.pts, v);
            const [x0, y0] = pt(r0, a), [x1, y1] = pt(r0 - len * r, a);
            el('line', { x1: x0, y1: y0, x2: x1, y2: y1, stroke: '#f2f2f2', 'stroke-width': w ?? .8, 'stroke-linecap': 'butt' }, g);
          }
          for (const [v, txt, col] of sc.labels || []) {
            const [lx, ly] = pt((sc.lr ?? 0.66) * r, map(sc.pts, v));
            const t = el('text', { x: lx, y: ly + (sc.lfs ?? 7) * 0.36, 'text-anchor': 'middle', class: 'ovh-gl', 'font-size': sc.lfs ?? 7 }, g);
            if (col) t.style.fill = col;
            t.textContent = txt;
          }
        }
        for (const [tx, ty, txt, size, anchor, fill] of o2.texts || []) {
          String(txt).split('\n').forEach((ln, i) => {
            const t = el('text', { x: tx * r, y: ty * r + i * (size ?? 6) * 1.05, 'text-anchor': anchor ?? 'middle', class: 'ovh-gl', 'font-size': size ?? 6 }, g);
            if (fill) t.style.fill = fill;
            t.textContent = ln;
          });
        }
        for (const nd of o2.needles || []) {
          const sc = o2.scales[nd.scale ?? 0];
          const ng = el('g', {}, g);
          const L = (nd.len ?? 0.8) * r, w = nd.w ?? 2.2, tail = (nd.tail ?? 0.12) * r;
          el('path', { d: `M${-w},${tail} L${-w * 0.45},${-L} L0,${-L - w} L${w * 0.45},${-L} L${w},${tail} Z`, fill: '#f7f7f7', stroke: '#9a9a9a', 'stroke-width': .3 }, ng);
          if (nd.tag) {
            const t = el('text', { x: 0, y: -L * 0.62, 'text-anchor': 'middle', 'font-size': Math.max(5.5, w * 2.2), class: 'ovh-needle-t' }, ng);
            t.textContent = nd.tag;
          }
          binds.push((res) => ng.setAttribute('transform', `rotate(${map(sc.pts, nd.fn(res))})`));
        }
        const hub = (o2.hub ?? 0.14) * r;
        el('circle', { r: hub, fill: '#0b0c0d', stroke: o2.hubRing ? '#e9e9e9' : '#3a3d40', 'stroke-width': o2.hubRing ? 1.1 : 1 }, g);
        // Glass glint.
        if (bz !== 'half') el('path', { d: `M${-r * 0.7},${-r * 0.45} A${r * 0.85},${r * 0.85} 0 0 1 ${r * 0.35},${-r * 0.78}`, fill: 'none', stroke: 'rgba(255,255,255,.08)', 'stroke-width': r * 0.08, 'stroke-linecap': 'round' }, g);
        return g;
      },
      /**
       * Engine / APU fire switch: a red handle with its number. Tap = pull;
       * once pulled, tap the left or right half to rotate it (discharge a
       * bottle). o2: { pullKey, rotKey, lamp (lights key: lit red on fire), label }.
       */
      fireHandle(x, y, w, hh, o2) {
        const c = o2.ctx || ctxRoot;
        const g = el('g', { class: 'ovh-fire' }, layers.parts);
        const slot = el('rect', { x: x - 2, y: y - 2, width: w + 4, height: hh + 4, rx: 4, fill: '#121314' }, g);
        void slot;
        const body = el('g', {}, g);
        const r = el('rect', { x, y, width: w, height: hh, rx: 5, fill: '#b3201c', stroke: '#5e0e0c', 'stroke-width': 1.2 }, body);
        const glow = el('rect', { x: x + 3, y: y + 3, width: w - 6, height: hh - 6, rx: 3, fill: '#ff3b30', opacity: 0 }, body);
        const t = el('text', { x: x + w / 2, y: y + hh * 0.66, 'text-anchor': 'middle', class: 'ovh-fire-t', 'font-size': o2.label.length > 1 ? Math.min(hh * 0.3, (w * 1.5) / o2.label.length) : hh * 0.6 }, body);
        t.textContent = o2.label;
        el('text', { x: x + w / 2, y: y + hh + 9, 'text-anchor': 'middle', class: 'ovh-t', 'font-size': 5.5 }, g).textContent = o2.note || '';
        const paint = (res) => {
          const pulled = !!c.sw[o2.pullKey], rot = c.sw[o2.rotKey] || 0;
          const lit = typeof o2.lamp === 'function' ? o2.lamp(res) : res?.lights?.[o2.lamp];
          glow.setAttribute('opacity', lit ? 0.85 : 0);
          r.setAttribute('fill', lit ? '#e8281f' : '#b3201c');
          const cx = x + w / 2, cy = y + hh / 2;
          body.setAttribute('transform', `translate(0,${pulled ? -5 : 0}) rotate(${pulled ? rot * 28 : 0},${cx},${cy})`);
        };
        binds.push(paint);
        const act = (px) => {
          if (!c.sw[o2.pullKey]) c.set(o2.pullKey, 1);
          else c.action(o2.rotKey, px < x + w / 2 ? 'L' : 'R');
          c.touched?.();
        };
        g.addEventListener('click', (e) => { const b = g.getBoundingClientRect(); act(x + ((e.clientX - b.left) / b.width) * w); });
        controls.push({
          kind: 'fire', key: o2.pullKey, name: o2.name || `${o2.label} fire switch`, about: o2.about,
          x0: x, x1: x + w, y0: y, y1: y + hh, pos: () => (c.sw[o2.pullKey] ? 'PULLED' : 'IN'),
          act(px) { act(px); return 'moved'; },
        });
        return g;
      },
      /** White-on-black placard (FLAPS LIMIT, LANDING GEAR LIMIT). */
      placard(x, y, w, lines, o2 = {}) {
        const size = o2.size ?? 5.6, hh = lines.length * size * 1.18 + 6;
        el('rect', { x, y, width: w, height: hh, rx: 1.5, fill: o2.bg ?? '#5b6166', stroke: '#3c4144' }, layers.parts);
        lines.forEach((ln, i) => {
          const tt = el('text', { x: x + 4, y: y + 4 + size + i * size * 1.18, class: 'ovh-t', 'font-size': size }, layers.parts);
          if (o2.ink) tt.style.fill = o2.ink; else if (/^#[ef]/i.test(o2.bg || '')) tt.style.fill = '#111';
          tt.textContent = ln;
        });
      },
      /** LCD window (FLT ALT, LAND ALT, meters). */
      lcd(x, y, w, fn, o2 = {}) {
        el('rect', { x, y, width: w, height: o2.h ?? 15, rx: 1.5, fill: '#060708', stroke: '#33373a' }, layers.parts);
        const t = el('text', { x: x + w - 4, y: y + (o2.h ?? 15) - 4, 'text-anchor': 'end', class: 'ovh-lcd', 'font-size': o2.size ?? 10.5 }, layers.parts);
        binds.push((res) => { t.textContent = fn(res); });
      },
    };
    panels.push(P);
    return P;
  }

  return { panel, update, panels };
}
