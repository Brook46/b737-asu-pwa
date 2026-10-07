// schem-kit.js — building blocks for the operable schematics: SVG pieces
// (pipes, valves, pumps, tanks, buses) that bind to a system's evaluated
// state by key, and overhead-panel controls (toggles, rotaries, lamps,
// readouts) that write into the system's switch state.

const NS = 'http://www.w3.org/2000/svg';

export function createSchematic(host, w, h) {
  host.replaceChildren();
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.setAttribute('class', 'sx');
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  host.append(svg);
  const binds = [];
  const layers = { pipes: el('g', {}, svg), units: el('g', {}, svg), text: el('g', {}, svg) };

  function el(tag, attrs = {}, parent) {
    const n = document.createElementNS(NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.append(n);
    return n;
  }
  const pts = (p) => 'M' + p.map(([x, y]) => `${x},${y}`).join(' L');

  const S = {
    svg, el,
    /** Line through points; lit (in colour, animated) when flows[key]. */
    pipe(points, key, o = {}) {
      const n = el('path', { d: pts(points), class: 'pipe' + (o.thin ? ' thin' : '') + (o.dash ? '' : '') }, layers.pipes);
      if (o.color) n.style.setProperty('--flow', o.color);
      binds.push((r) => {
        const on = typeof key === 'function' ? key(r) : !!r.flows?.[key];
        n.classList.toggle('on', on);
        n.classList.toggle('anim', on && !o.still);
      });
      return n;
    },
    wire(points, key, o = {}) {
      const n = el('path', { d: pts(points), class: 'wire' }, layers.pipes);
      if (o.color) n.style.setProperty('--flow', o.color);
      binds.push((r) => n.classList.toggle('on', typeof key === 'function' ? key(r) : !!r.buses?.[key]));
      return n;
    },
    /** Valve symbol: bar along the line when open, across it when shut. */
    valve(x, y, key, o = {}) {
      const g = el('g', { transform: `translate(${x},${y})` }, layers.units);
      const ring = el('circle', { r: o.r ?? 11, class: 'valve' }, g);
      const bar = el('line', { x1: -(o.r ?? 11) + 2, y1: 0, x2: (o.r ?? 11) - 2, y2: 0, class: 'valve-bar' }, g);
      const base = o.vertical ? 90 : 0;
      if (o.label) S.text(x + (o.lx ?? 0), y + (o.ly ?? 24), o.label, 't-small t-dim', 'middle');
      binds.push((r) => {
        const open = typeof key === 'function' ? key(r) : !!r.valves?.[key];
        bar.setAttribute('transform', `rotate(${open ? base : base + 90})`);
        ring.setAttribute('class', 'valve ' + (open ? 'open' : 'shut'));
      });
      if (o.part) hit(g, o.part);
      return g;
    },
    /** A box component (pump, unit). state from units[key]: on / off / fault. */
    unit(x, y, w, h, label, key, o = {}) {
      const g = el('g', {}, layers.units);
      const r = el('rect', { x, y, width: w, height: h, rx: o.round ? h / 2 : 4, class: 'unit' }, g);
      if (o.color) r.style.setProperty('--flow', o.color);
      const lines = String(label).split('\n');
      lines.forEach((ln, i) => S.text(x + w / 2, y + h / 2 + 4 + (i - (lines.length - 1) / 2) * 12, ln, o.small ? 't-small' : '', 'middle', g));
      binds.push((res) => {
        const st = typeof key === 'function' ? key(res) : res.units?.[key];
        r.classList.toggle('on', st === 'on');
        r.classList.toggle('fault', st === 'fault');
      });
      if (o.part) hit(g, o.part);
      return g;
    },
    /** Tank with a fill level from values[key] (0–1). */
    tank(x, y, w, h, label, key, o = {}) {
      const g = el('g', {}, layers.units);
      el('rect', { x, y, width: w, height: h, rx: 6, class: 'tank' }, g);
      const f = el('rect', { x: x + 2, y: y + h - 2, width: w - 4, height: 0, rx: 4, class: 'fuel' }, g);
      if (o.color) f.style.setProperty('--flow', o.color);
      S.text(x + w / 2, y + 16, label, 't-small', 'middle', g);
      const val = S.text(x + w / 2, y + h - 10, '', 't-big', 'middle', g);
      binds.push((res) => {
        const k = Math.max(0, Math.min(1, res.values?.[key] ?? 0));
        const hh = (h - 4) * k;
        f.setAttribute('y', y + h - 2 - hh);
        f.setAttribute('height', hh);
        if (o.text) val.textContent = o.text(res);
      });
      if (o.part) hit(g, o.part);
      return g;
    },
    /** Bus bar, lit when buses[key]. */
    bus(x, y, w, h, label, key, o = {}) {
      const g = el('g', {}, layers.units);
      const r = el('rect', { x, y, width: w, height: h, rx: 3, class: 'bus' }, g);
      if (o.color) r.style.setProperty('--flow', o.color);
      const t = S.text(x + w / 2, y + h / 2 + 3.5, label, 'bus-l', 'middle', g);
      binds.push((res) => {
        const on = typeof key === 'function' ? key(res) : !!res.buses?.[key];
        r.classList.toggle('on', on);
        t.classList.toggle('lbl-on', on);
      });
      if (o.part) hit(g, o.part);
      return g;
    },
    text(x, y, str, cls = '', anchor = 'start', parent = layers.text) {
      const t = el('text', { x, y, class: cls, 'text-anchor': anchor }, parent);
      t.textContent = str;
      return t;
    },
    /** Text bound to a value. */
    value(x, y, fn, cls = '', anchor = 'middle') {
      const t = S.text(x, y, '', cls, anchor);
      binds.push((res) => {
        const v = fn(res);
        if (v && typeof v === 'object') { t.textContent = v.text; t.setAttribute('class', v.cls || cls); }
        else t.textContent = v ?? '';
      });
      return t;
    },
    /** Run fn(res) on every update (custom drawings). */
    bind(fn) { binds.push(fn); },
    /**
     * Annunciator like the airplane's: dark lens with the legend dim when
     * off, filled in its colour with a dark legend when lit ('flash' blinks).
     */
    annun(x, y, w, h, label, key, color = 'amber', o = {}) {
      const g = el('g', { class: `annun ${color}` }, layers.units);
      el('rect', { x: x - 2, y: y - 2, width: w + 4, height: h + 4, rx: 3, class: 'annun-bezel' }, g);
      el('rect', { x, y, width: w, height: h, rx: 2, class: 'annun-lens' }, g);
      const lines = String(label).split('\n');
      lines.forEach((ln, i) => S.text(x + w / 2, y + h / 2 + 3.5 + (i - (lines.length - 1) / 2) * 11, ln, 'annun-t' + (o.big ? ' big' : ''), 'middle', g));
      binds.push((res) => {
        const v = typeof key === 'function' ? key(res) : res.lights?.[key];
        g.classList.toggle('lit', !!v);
        g.classList.toggle('flash', v === 'flash');
      });
      if (o.part) hit(g, o.part);
      return g;
    },
    /**
     * A 737-800 seen from above, nose up, drawn to scale: returns P(fwdX, z)
     * mapping airplane metres (x forward, z right) to schematic units.
     */
    airplane(cx, top, scale, o = {}) {
      const P = (X, z) => [cx + z * scale, top + (19.7 - X) * scale];
      const poly = (pts) => 'M' + pts.map(([X, z]) => P(X, z).join(',')).join(' L') + ' Z';
      const g = el('g', { class: 'plan' }, layers.pipes);
      // Fuselage: rounded nose, parallel body, tail cone.
      const body = [];
      for (let i = 0; i <= 12; i++) { const a = (i / 12) * Math.PI; body.push([15.5 + 4.2 * Math.sin(a), -1.88 * Math.cos(a)]); }
      const fus = [...body, [-12, 1.88], [-17.5, 1.1], [-19.8, 0.3], [-19.8, -0.3], [-17.5, -1.1], [-12, -1.88]];
      // Wings (each side): root LE, kink, tip with winglet, TE back to the root.
      const wing = (s) => [[4.2, 1.7 * s], [-0.6, 7.3 * s], [-4.3, 17.2 * s], [-4.9, 17.9 * s], [-6.1, 17.9 * s], [-5.6, 16.4 * s], [-4.8, 7.3 * s], [-6.4, 1.7 * s]];
      const stab = (s) => [[-13.4, 1.1 * s], [-16.6, 7.18 * s], [-17.9, 7.18 * s], [-17.2, 1.1 * s]];
      const nac = (s) => [[6.3, 4.2 * s], [6.6, 5.0 * s], [6.3, 5.8 * s], [2.2, 5.8 * s], [0.6, 5.3 * s], [0.6, 4.7 * s], [2.2, 4.2 * s]];
      for (const s of [-1, 1]) {
        el('path', { d: poly(wing(s)), class: 'plan-skin' }, g);
        el('path', { d: poly(stab(s)), class: 'plan-skin' }, g);
        el('path', { d: poly(nac(s)), class: 'plan-skin' }, g);
      }
      el('path', { d: poly(fus), class: 'plan-skin' }, g);
      // Fin (seen edge on) along the centreline.
      el('path', { d: poly([[-12.5, 0.12], [-19.4, 0.12], [-19.4, -0.12], [-12.5, -0.12]]), class: 'plan-fin' }, g);
      if (o.label) S.text(cx, top - 10, o.label, 't-small t-dim', 'middle');
      return P;
    },
    update(res) { for (const b of binds) b(res); },
    onPart: null,
  };
  function hit(g, part) {
    g.classList.add('hit');
    g.addEventListener('click', () => S.onPart && S.onPart(part));
  }
  return S;
}

// ── Panel controls (HTML) ───────────────────────────────────────────────────

export function createPanel(host, ctx) {
  host.replaceChildren();
  const binds = [];
  const P = {
    title(text) { const d = document.createElement('div'); d.className = 'pnl-title'; d.textContent = text; host.append(d); return d; },
    row(...nodes) { const d = document.createElement('div'); d.className = 'pnl-row'; d.append(...nodes.filter(Boolean)); host.append(d); return d; },
    note(text) { const d = document.createElement('div'); d.className = 'pnl-note'; d.innerHTML = text; host.append(d); return d; },
    /**
     * Toggle switch. positions: labels top→bottom. Tap the upper half to move
     * up a position, the lower half to move down. `key` reads/writes sw[key]
     * (index into positions). Momentary positions spring back to `rest`.
     */
    toggle(label, key, positions, o = {}) {
      const wrap = document.createElement('div');
      wrap.className = 'sw-ctl';
      const top = document.createElement('div'); top.className = 'pos'; top.textContent = positions[0];
      const b = document.createElement('button');
      b.className = 'toggle' + (positions.length === 3 ? ' three' : '') + (o.guard ? ' guard' : '');
      b.setAttribute('aria-label', label);
      const bot = document.createElement('div'); bot.className = 'pos'; bot.textContent = positions[positions.length - 1];
      const l = document.createElement('div'); l.className = 'lbl'; l.textContent = label;
      wrap.append(top, b, bot, l);
      // Three-position switches also say where they are now (the middle
      // position has no room for a label of its own).
      let cur = null;
      if (positions.length === 3) {
        cur = document.createElement('div');
        cur.className = 'pos';
        cur.style.cssText = 'opacity:1;color:#fff;font-weight:700';
        wrap.append(cur);
      }
      b.addEventListener('click', (e) => {
        const r = b.getBoundingClientRect();
        const up = e.clientY < r.top + r.height / 2;
        const cur = ctx.sw[key];
        const next = Math.max(0, Math.min(positions.length - 1, cur + (up ? -1 : 1)));
        if (next === cur) return;
        if (o.momentary && o.momentary.includes(next)) {
          // Spring-loaded: fire the action, show the throw briefly, return.
          b.dataset.pos = String(next);
          ctx.action(key, positions[next]);
          setTimeout(() => { b.dataset.pos = String(cur); }, 260);
          return;
        }
        ctx.set(key, next);
      });
      binds.push(() => {
        b.dataset.pos = String(ctx.sw[key]);
        b.title = positions[ctx.sw[key]] || '';
        if (cur) cur.textContent = '▸ ' + (positions[ctx.sw[key]] || '');
      });
      return wrap;
    },
    /** Rotary selector; tap left half = anticlockwise, right half = clockwise. */
    rotary(label, key, positions, angles) {
      const wrap = document.createElement('div');
      wrap.className = 'sw-ctl';
      const b = document.createElement('button');
      b.className = 'rotary';
      b.setAttribute('aria-label', label);
      const cap = document.createElement('div'); cap.className = 'pos';
      const l = document.createElement('div'); l.className = 'lbl'; l.textContent = label;
      wrap.append(b, cap, l);
      b.addEventListener('click', (e) => {
        const r = b.getBoundingClientRect();
        const left = e.clientX < r.left + r.width / 2;
        const next = Math.max(0, Math.min(positions.length - 1, ctx.sw[key] + (left ? -1 : 1)));
        ctx.set(key, next);
      });
      binds.push(() => {
        const i = ctx.sw[key];
        b.style.setProperty('--rot', (angles ? angles[i] : -60 + (120 * i) / Math.max(1, positions.length - 1)) + 'deg');
        cap.textContent = positions[i];
      });
      return wrap;
    },
    push(label, fn) {
      const b = document.createElement('button');
      b.className = 'pushbtn';
      b.textContent = label;
      b.addEventListener('click', fn);
      return b;
    },
    lamp(text, key, color = 'amber') {
      const d = document.createElement('div');
      d.className = `lamp ${color}`;
      d.innerHTML = text.replace(/\n/g, '<br>');
      binds.push((res) => {
        const v = typeof key === 'function' ? key(res) : res.lights?.[key];
        d.classList.toggle('on', !!v);
        d.classList.toggle('dim', v === 'dim');
      });
      return d;
    },
    readout(fn, label) {
      const wrap = document.createElement('div');
      wrap.className = 'sw-ctl';
      const d = document.createElement('div'); d.className = 'readout';
      const l = document.createElement('div'); l.className = 'lbl'; l.textContent = label || '';
      wrap.append(d, l);
      binds.push((res) => { d.innerHTML = fn(res); });
      return wrap;
    },
    fail(label, key) {
      const b = document.createElement('button');
      b.className = 'fail-btn';
      b.textContent = label;
      b.addEventListener('click', () => ctx.toggleFail(key));
      binds.push(() => b.classList.toggle('on', !!ctx.fail[key]));
      return b;
    },
    actions(...nodes) { const d = document.createElement('div'); d.className = 'pnl-actions'; d.append(...nodes); host.append(d); return d; },
    update(res) { for (const b of binds) b(res); },
  };
  return P;
}
