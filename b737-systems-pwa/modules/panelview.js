// panelview.js — full-screen view of one cockpit panel or screen, to play
// with up close. The panel's own live SVG (the one the 3D cockpit renders
// into its texture) is moved into the viewer while it is open and put back
// on close, so every switch works and the cockpit follows; a screen shows its
// live canvas.

export function createPanelViewer() {
  const el = document.createElement('div');
  el.className = 'pv';
  el.hidden = true;
  el.innerHTML = `
    <div class="pv-head"><span class="pv-t"></span><span class="pv-hint">switch: tap its top or bottom half · knob: left or right half · Esc to close</span><button class="pv-x" aria-label="Close">✕</button></div>
    <div class="pv-body"></div>`;
  document.body.append(el);
  const body = el.querySelector('.pv-body');
  let cur = null;      // { node, parent, next, style }

  function fit() {
    if (!cur) return;
    const n = cur.node;
    const vb = n.viewBox?.baseVal;
    const aspect = vb && vb.width ? vb.width / vb.height : n.width / n.height;
    const maxW = innerWidth * 0.96, maxH = (innerHeight - 70) * 0.94;
    const w = Math.min(maxW, maxH * aspect);
    n.style.width = `${w}px`;
    n.style.height = `${w / aspect}px`;
    n.style.maxWidth = 'none';
  }
  function open(title, node) {
    close();
    cur = { node, parent: node.parentNode, next: node.nextSibling, style: node.getAttribute('style') || '' };
    el.querySelector('.pv-t').textContent = title;
    body.replaceChildren(node);
    node.classList.add('pv-node');
    el.hidden = false;
    fit();
  }
  function close() {
    if (!cur) { el.hidden = true; return; }
    const { node, parent, next, style } = cur;
    node.classList.remove('pv-node');
    node.setAttribute('style', style);
    if (parent) parent.insertBefore(node, next);
    else node.remove();
    cur = null;
    el.hidden = true;
  }
  el.querySelector('.pv-x').addEventListener('click', close);
  addEventListener('resize', fit);
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && cur) { e.stopPropagation(); close(); } }, true);
  return { open, close, get open_() { return !!cur; } };
}
