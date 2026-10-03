// overlay.js — demoBee-style hotspots: a ring on the part, a thin leader that
// steps out and over, a knot, then a mono tag chip. Chips on the right half
// of the screen hang right, the rest hang left, and a simple top-down pass
// pushes overlapping chips apart so labels stay readable at any angle.

const SVGNS = 'http://www.w3.org/2000/svg';

export function createOverlay(api, svg, layer, onSelect) {
  let items = [];
  let selected = null;
  let compact = false;
  const p = {};

  function set(list) {
    svg.replaceChildren();
    layer.replaceChildren();
    items = list.map((h, i) => {
      const g = document.createElementNS(SVGNS, 'g');
      const path = document.createElementNS(SVGNS, 'path');
      const dot = document.createElementNS(SVGNS, 'circle');
      dot.setAttribute('class', 'dot');
      dot.setAttribute('r', '7');
      const knot = document.createElementNS(SVGNS, 'circle');
      knot.setAttribute('class', 'knot');
      knot.setAttribute('r', '2.2');
      g.append(path, dot, knot);
      svg.append(g);
      const chip = document.createElement('button');
      chip.className = 'tag hs';
      chip.innerHTML = `<span class="n">${String(i + 1).padStart(2, '0')}</span><span class="nm"> ${h.label}</span>`;
      chip.addEventListener('click', (e) => { e.stopPropagation(); onSelect(h.id); });
      layer.append(chip);
      return { ...h, g, path, dot, knot, chip, w: 0, h: 0 };
    });
    // Measure once (fonts may still be loading; re-measure on next frame too).
    document.fonts?.ready.then(() => { for (const it of items) it.w = 0; });
  }
  // Force a re-measure (e.g. after a font or theme change).
  function measure() { for (const it of items) it.w = 0; }

  function setSelected(id) {
    selected = id;
    for (const it of items) {
      const on = it.id === id;
      it.chip.classList.toggle('sel', on);
      it.g.classList.toggle('sel', on);
    }
  }
  function setDim(fn) {
    for (const it of items) it.chip.classList.toggle('off', !!fn(it.id));
  }

  // Free area (outside the sheet) and fixed HUD rectangles labels must avoid.
  let bounds = { right: 0, bottom: 0 }, obstacles = [];
  function setBounds(b, obs) { bounds = b; obstacles = obs; }

  const overlaps = (a, r) => a.x < r.x + r.w + 4 && a.x + a.w + 4 > r.x && a.y < r.y + r.h + 3 && a.y + a.h + 3 > r.y;

  function frame() {
    if (!items.length) return;
    const { W: W0, H: H0 } = api.size;
    const W = W0 - bounds.right, H = H0 - bounds.bottom;
    const placed = obstacles.slice();
    const vis = [];
    for (const it of items) {
      api.project(it.at, p);
      it.sx = p.x; it.sy = p.y;
      it.on = p.visible && p.x > -10 && p.x < W + 10 && p.y > -10 && p.y < H + 10;
      if (it.on) vis.push(it); else { it.g.style.display = 'none'; it.chip.style.display = 'none'; }
    }
    // Chips hidden when they were created measured 0×0: measure on first show.
    for (const it of vis) {
      if (!it.w || it.selW !== (it.id === selected)) {
        it.chip.style.display = '';
        it.w = it.chip.offsetWidth; it.h = it.chip.offsetHeight; it.selW = it.id === selected;
      }
    }
    vis.sort((a, b) => a.sy - b.sy);
    const narrow = W0 < 760;
    // Phones: number-only chips so the airplane stays visible (the selected
    // part keeps its name). Width changes, so re-measure when this flips.
    if (narrow !== compact) {
      compact = narrow;
      layer.classList.toggle('compact', compact);
      for (const it of items) it.w = 0;
    }
    const rise = narrow ? 18 : 28, run = narrow ? 12 : 20;
    for (const it of vis) {
      const right = it.sx >= W / 2;
      const dir = right ? 1 : -1;
      const ex = it.sx + dir * rise;
      const kx = ex + dir * run;
      let cx = right ? kx + 4 : kx - 4 - it.w;
      cx = Math.max(6, Math.min(W - it.w - 6, cx));
      const cy0 = it.sy - rise - it.h / 2;
      // Try the natural slot, then alternately further up and down.
      let cy = null;
      for (let k = 0; k < 14; k++) {
        const step = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (it.h + 3);
        const y = cy0 + step;
        if (y < 6 || y + it.h > H - 6) continue;
        if (!placed.some((r) => overlaps({ x: cx, y, w: it.w, h: it.h }, r))) { cy = y; break; }
      }
      if (cy == null) { it.g.style.display = ''; it.chip.style.display = 'none'; it.path.setAttribute('d', '');
        it.dot.setAttribute('cx', it.sx.toFixed(1)); it.dot.setAttribute('cy', it.sy.toFixed(1)); it.knot.setAttribute('r', '0'); continue; }
      it.knot.setAttribute('r', '2.2');
      const ey = cy + it.h / 2;
      placed.push({ x: cx, y: cy, w: it.w, h: it.h });
      const kx2 = right ? cx - 4 : cx + it.w + 4;
      it.path.setAttribute('d', `M${it.sx.toFixed(1)},${it.sy.toFixed(1)} L${ex.toFixed(1)},${ey.toFixed(1)} L${kx2.toFixed(1)},${ey.toFixed(1)}`);
      it.dot.setAttribute('cx', it.sx.toFixed(1));
      it.dot.setAttribute('cy', it.sy.toFixed(1));
      it.knot.setAttribute('cx', kx2.toFixed(1));
      it.knot.setAttribute('cy', ey.toFixed(1));
      it.g.style.display = '';
      it.chip.style.display = '';
      it.chip.style.transform = `translate(${cx.toFixed(1)}px, ${cy.toFixed(1)}px)`;
    }
  }

  function visible(v) {
    svg.style.display = v ? '' : 'none';
    layer.style.display = v ? '' : 'none';
  }

  return { set, frame, setSelected, setDim, visible, measure, setBounds, get selected() { return selected; } };
}
