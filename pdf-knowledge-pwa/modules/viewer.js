// Vertical page-by-page PDF viewer.
//
// Pages stack top-to-bottom and the user scrolls up/down. Pages are
// virtualised: only pages near the viewport are painted (hard cap of 10
// canvases), so large manuals stay within a small memory budget.
//
// Features: multiple concurrent mounts (split view), per-mount back/forward
// history, freehand + shape markup, a selectable text layer (drag-select then
// Highlight or Note), centred page jumps and a nested chapter outline.

import { pdfjsLib } from './pdf-ingest.js';
import { getFile, getMarkup, putMarkup, deleteMarkup } from './storage.js';

const docCache = new Map();
const tokens = new Map();             // container -> current render token
const handles = new Map();            // container -> { applyMode }

const MAX_RENDERED = 10;

let markupTool = null;                // null|pen|highlight|line|arrow|box|text|eraser
let markupColor = '#ff3b30';
let markupWidth = 0.006;
let selectMode = false;
const HL_WIDTH = 0.028;
const ERASE_RADIUS = 0.022;
const TEXT_SIZE = 0.026;
const SEL_HL_COLOR = '#ffd400';

let selMenu = null;

async function loadDoc(fileId) {
  if (docCache.has(fileId)) return docCache.get(fileId);
  const file = await getFile(fileId);
  if (!file) throw new Error('file not found');
  const buf = await file.blob.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
  docCache.set(fileId, doc);
  return doc;
}

export function clearViewerCache() {
  docCache.clear();
  handles.clear();
  tokens.clear();
}

export function setMarkupTool(tool) {
  markupTool = tool || null;
  if (markupTool) selectMode = false;
  for (const h of handles.values()) h.applyMode();
  return markupTool;
}
export function getMarkupTool() { return markupTool; }
export function setMarkupColor(color) { markupColor = color; }
export function setMarkupWidth(w) { markupWidth = w; }
export function setSelectMode(on) {
  selectMode = !!on;
  if (selectMode) markupTool = null;
  hideSelMenu();
  for (const h of handles.values()) h.applyMode();
  return selectMode;
}

export async function findQueryHighlight(fileId, pageNum, query) {
  if (!query || !query.trim()) return null;
  const doc = await loadDoc(fileId);
  const page = await doc.getPage(pageNum);
  const text = await page.getTextContent();
  const terms = query.toLowerCase().match(/[a-z0-9֐-׿]+/g) || [];
  if (!terms.length) return null;
  const rects = [];
  for (const it of text.items) {
    if (!it.str || !it.str.trim()) continue;
    if (!terms.some((t) => it.str.toLowerCase().includes(t))) continue;
    const tx = it.transform;
    const x = tx[4], y = tx[5];
    const w = it.width || (tx[0] * (it.str.length || 1));
    const h = it.height || Math.abs(tx[3]) || 11;
    rects.push([x - 1, y - 1, x + w + 1, y + h + 1]);
  }
  return rects.length ? { rects } : null;
}

function hideSelMenu() {
  if (selMenu) { selMenu.remove(); selMenu = null; }
}

/**
 * Mount a PDF into a vertical scroll container.
 * @param {HTMLElement} container
 * @param {object} opts { startPage, highlights, onPageChange, markMemory,
 *                         onHistoryChange, onNoteSelection }
 */
export async function mountPdf(container, fileId, opts = {}) {
  const { startPage = 1, highlights = [], onPageChange, markMemory = false,
    onHistoryChange, onNoteSelection } = opts;
  const doc = await loadDoc(fileId);
  const myToken = Symbol('render');
  for (const c of [...tokens.keys()]) if (!c.isConnected) tokens.delete(c);
  for (const c of [...handles.keys()]) if (!c.isConnected) handles.delete(c);
  tokens.set(container, myToken);
  container.innerHTML = '';
  container.setAttribute('data-fileid', fileId);

  // Vertical layout: pages fit the container WIDTH.
  const containerWidth = Math.max(280, container.clientWidth - 16);
  const first = await doc.getPage(1);
  const fv = first.getViewport({ scale: 1 });
  const baseScale = Math.min(3, Math.max(0.4, containerWidth / fv.width));
  const baseDim = { width: Math.floor(fv.width * baseScale), height: Math.floor(fv.height * baseScale) };

  const pageEls = [];
  const wrapToEl = new Map();
  const highlightByPage = new Map();
  for (const h of highlights) {
    if (!h.rect) continue;
    if (!highlightByPage.has(h.pageNum)) highlightByPage.set(h.pageNum, []);
    highlightByPage.get(h.pageNum).push(h.rect);
  }
  const backStack = [];
  const fwdStack = [];

  for (let i = 1; i <= doc.numPages; i++) {
    const wrap = document.createElement('div');
    wrap.className = 'pdf-page';
    wrap.setAttribute('data-page', String(i));
    wrap.style.width = baseDim.width + 'px';
    wrap.style.height = baseDim.height + 'px';
    const canvas = document.createElement('canvas');
    canvas.width = 0; canvas.height = 0;
    const highlightLayer = document.createElement('div');
    highlightLayer.className = 'pdf-highlight-layer';
    const memoryLayer = document.createElement('div');
    memoryLayer.className = 'pdf-memory-layer';
    const linkLayer = document.createElement('div');
    linkLayer.className = 'pdf-link-layer';
    const textLayer = document.createElement('div');
    textLayer.className = 'pdf-text-layer';
    const drawLayer = document.createElement('canvas');
    drawLayer.className = 'pdf-draw-layer';
    drawLayer.width = 0; drawLayer.height = 0;
    wrap.append(canvas, highlightLayer, memoryLayer, linkLayer, textLayer, drawLayer);
    container.appendChild(wrap);
    const el = { wrap, canvas, linkLayer, highlightLayer, memoryLayer, textLayer, drawLayer,
      dim: { ...baseDim }, pageNum: i, strokes: [], current: null, dirty: false,
      rendered: false, rendering: false };
    pageEls.push(el);
    wrapToEl.set(wrap, el);
    attachMarkup(el);
  }

  function applyMode() {
    const drawing = !!markupTool;
    for (const el of pageEls) {
      el.drawLayer.style.pointerEvents = drawing ? 'auto' : 'none';
      el.drawLayer.style.touchAction = drawing ? 'none' : 'auto';
      el.drawLayer.classList.toggle('markup-active', drawing);
      el.textLayer.style.pointerEvents = selectMode ? 'auto' : 'none';
      el.textLayer.classList.toggle('select-active', selectMode);
    }
    if (!selectMode) hideSelMenu();
  }
  handles.set(container, { applyMode });
  applyMode();

  // --- text selection -> highlight / note ---
  container.addEventListener('pointerup', () => {
    if (!selectMode) return;
    setTimeout(checkSelection, 10);
  });

  function pageElAtClientPoint(x, y) {
    for (const el of pageEls) {
      const r = el.canvas.getBoundingClientRect();
      if (r.width && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return el;
    }
    return null;
  }

  function checkSelection() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) { hideSelMenu(); return; }
    const range = sel.getRangeAt(0);
    if (!container.contains(range.commonAncestorContainer)) { hideSelMenu(); return; }
    const text = sel.toString().trim();
    if (!text) { hideSelMenu(); return; }
    const r = range.getBoundingClientRect();
    showSelMenu(r, text);
  }

  function showSelMenu(rect, text) {
    hideSelMenu();
    selMenu = document.createElement('div');
    selMenu.className = 'text-sel-menu';
    selMenu.innerHTML = '<button data-a="hl">Highlight</button><button data-a="note">Note</button>';
    document.body.appendChild(selMenu);
    selMenu.style.left = Math.max(8, Math.min(window.innerWidth - 160, rect.left)) + 'px';
    selMenu.style.top = Math.max(8, rect.top - 44) + 'px';
    selMenu.querySelector('[data-a="hl"]').addEventListener('click', () => highlightSelection());
    selMenu.querySelector('[data-a="note"]').addEventListener('click', () => {
      const sel = window.getSelection();
      const txt = sel ? sel.toString().trim() : '';
      const el = sel && sel.rangeCount ? pageElForNode(sel.getRangeAt(0).commonAncestorContainer) : null;
      hideSelMenu();
      if (el && onNoteSelection) onNoteSelection(el.pageNum, txt);
    });
  }

  function pageElForNode(node) {
    let n = node;
    while (n && n !== container) {
      if (n.classList && n.classList.contains('pdf-page')) return wrapToEl.get(n);
      n = n.parentNode;
    }
    return null;
  }

  function highlightSelection() {
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount || sel.isCollapsed) { hideSelMenu(); return; }
    const rects = [...sel.getRangeAt(0).getClientRects()];
    const byEl = new Map();
    for (const cr of rects) {
      if (cr.width < 3 || cr.height < 3) continue;
      const el = pageElAtClientPoint(cr.left + cr.width / 2, cr.top + cr.height / 2);
      if (!el) continue;
      const can = el.canvas.getBoundingClientRect();
      if (!can.width) continue;
      const stroke = { kind: 'hl', color: SEL_HL_COLOR, pts: [
        [(cr.left - can.left) / can.width, (cr.top - can.top) / can.height],
        [(cr.right - can.left) / can.width, (cr.bottom - can.top) / can.height],
      ] };
      if (!byEl.has(el)) byEl.set(el, []);
      byEl.get(el).push(stroke);
    }
    for (const [el, strokes] of byEl) {
      el.strokes.push(...strokes);
      renderMarkup(el);
      persistMarkup(el);
    }
    sel.removeAllRanges();
    hideSelMenu();
  }

  function attachMarkup(el) {
    const draw = el.drawLayer;
    const pt = (e) => {
      const r = draw.getBoundingClientRect();
      return [
        Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
        Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
      ];
    };
    draw.addEventListener('pointerdown', (e) => {
      if (!markupTool) return;
      e.preventDefault();
      try { draw.setPointerCapture(e.pointerId); } catch {}
      const p = pt(e);
      if (markupTool === 'eraser') {
        if (eraseAt(el, p)) { renderMarkup(el); el.dirty = true; }
        return;
      }
      if (markupTool === 'text') {
        const text = window.prompt('Annotation text:');
        if (text && text.trim()) {
          el.strokes.push({ kind: 'text', color: markupColor, size: TEXT_SIZE, text: text.trim(), pts: [p] });
          el.dirty = true;
          renderMarkup(el);
          persistMarkup(el);
        }
        return;
      }
      if (markupTool === 'pen' || markupTool === 'highlight') {
        el.current = { kind: 'free', tool: markupTool, color: markupColor,
          w: markupTool === 'highlight' ? HL_WIDTH : markupWidth, pts: [p] };
      } else {
        el.current = { kind: markupTool, color: markupColor, w: markupWidth, pts: [p, p] };
      }
      renderMarkup(el);
    });
    draw.addEventListener('pointermove', (e) => {
      if (!markupTool) return;
      const p = pt(e);
      if (markupTool === 'eraser') {
        if (e.buttons && eraseAt(el, p)) { renderMarkup(el); el.dirty = true; }
      } else if (el.current) {
        if (el.current.kind === 'free') el.current.pts.push(p);
        else el.current.pts[1] = p;
        renderMarkup(el);
      }
    });
    const finish = (e) => {
      if (el.current && el.current.pts.length) { el.strokes.push(el.current); el.dirty = true; }
      el.current = null;
      if (el.dirty) { el.dirty = false; persistMarkup(el); }
      try { draw.releasePointerCapture(e.pointerId); } catch {}
    };
    draw.addEventListener('pointerup', finish);
    draw.addEventListener('pointercancel', finish);
  }

  function eraseAt(el, p) {
    const before = el.strokes.length;
    el.strokes = el.strokes.filter((s) => !strokeHit(s, p));
    return el.strokes.length !== before;
  }

  async function persistMarkup(el) {
    const key = `${fileId}:${el.pageNum}`;
    if (!el.strokes.length) { await deleteMarkup(key); return; }
    await putMarkup({ key, fileId, pageNum: el.pageNum, strokes: el.strokes, updatedAt: Date.now() });
  }

  function renderMarkup(el) {
    const cssW = el.drawLayer.clientWidth || el.dim.width;
    const cssH = el.drawLayer.clientHeight || el.dim.height;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (el.drawLayer.width !== Math.floor(cssW * dpr)) {
      el.drawLayer.width = Math.floor(cssW * dpr);
      el.drawLayer.height = Math.floor(cssH * dpr);
    }
    const ctx = el.drawLayer.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    const all = el.current ? el.strokes.concat([el.current]) : el.strokes;
    for (const s of all) drawStroke(ctx, s, cssW, cssH);
  }

  function clearPage(pageNum) {
    const el = pageEls[pageNum - 1];
    if (!el) return;
    el.strokes = []; el.current = null;
    renderMarkup(el);
    persistMarkup(el);
  }

  function undo(pageNum) {
    const el = pageEls[pageNum - 1];
    if (!el || !el.strokes.length) return;
    el.strokes.pop();
    renderMarkup(el);
    persistMarkup(el);
  }

  // --- lazy rendering ---
  let activePage = startPage;
  let suppressIoUntil = 0;

  function freePage(el) {
    if (el.rendering) { el.freePending = true; return; }
    el.canvas.width = 0; el.canvas.height = 0;
    el.drawLayer.width = 0; el.drawLayer.height = 0;
    el.linkLayer.innerHTML = '';
    el.highlightLayer.innerHTML = '';
    el.memoryLayer.innerHTML = '';
    el.textLayer.innerHTML = '';
    el.rendered = false;
  }

  function pruneRendered() {
    const rendered = pageEls.filter((e) => e.rendered && !e.rendering);
    if (rendered.length <= MAX_RENDERED) return;
    rendered.sort((a, b) => Math.abs(b.pageNum - activePage) - Math.abs(a.pageNum - activePage));
    for (const el of rendered.slice(0, rendered.length - MAX_RENDERED)) freePage(el);
  }

  async function renderOne(el) {
    if (el.rendered || el.rendering) return;
    if (tokens.get(container) !== myToken) return;
    el.rendering = true;
    try {
      const page = await doc.getPage(el.pageNum);
      const v1 = page.getViewport({ scale: 1 });
      const fitScale = Math.min(3, Math.max(0.4, containerWidth / v1.width));
      const viewport = page.getViewport({ scale: fitScale });
      el.dim = { width: Math.floor(viewport.width), height: Math.floor(viewport.height), scale: fitScale };
      if (Math.abs(parseInt(el.wrap.style.height, 10) - el.dim.height) > 1) {
        el.wrap.style.width = el.dim.width + 'px';
        el.wrap.style.height = el.dim.height + 'px';
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      el.canvas.width = Math.floor(viewport.width * dpr);
      el.canvas.height = Math.floor(viewport.height * dpr);
      el.canvas.style.width = Math.floor(viewport.width) + 'px';
      el.canvas.style.height = Math.floor(viewport.height) + 'px';
      for (const layer of [el.linkLayer, el.highlightLayer, el.memoryLayer, el.textLayer, el.drawLayer]) {
        layer.style.width = el.canvas.style.width;
        layer.style.height = el.canvas.style.height;
      }
      const ctx = el.canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      await page.render({ canvasContext: ctx, viewport }).promise;

      const annots = await page.getAnnotations({ intent: 'display' }).catch(() => []);
      el.linkLayer.innerHTML = '';
      for (const a of annots) {
        if (a.subtype !== 'Link' || !a.rect) continue;
        const r = rectToView(a.rect, viewport);
        const link = document.createElement('a');
        link.className = 'pdf-link';
        link.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
        if (a.url) {
          link.href = a.url; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.title = a.url;
        } else if (a.dest) {
          link.href = '#'; link.title = 'Follow link in this PDF';
          link.addEventListener('click', async (e) => {
            e.preventDefault();
            const target = await resolveDest(doc, a.dest);
            if (target) navigate(target, { push: true, smooth: true });
          });
        } else { continue; }
        el.linkLayer.appendChild(link);
      }

      el.highlightLayer.innerHTML = '';
      for (const hr of (highlightByPage.get(el.pageNum) || [])) {
        const r = rectToView(hr, viewport);
        const hl = document.createElement('div');
        hl.className = 'pdf-highlight';
        hl.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
        el.highlightLayer.appendChild(hl);
      }

      const textContent = await page.getTextContent().catch(() => null);
      el.memoryLayer.innerHTML = '';
      if (markMemory && textContent) {
        for (const rect of memoryItemRects(textContent)) {
          const r = rectToView(rect, viewport);
          const box = document.createElement('div');
          box.className = 'pdf-memory-box';
          box.title = 'Memory item — (#) limitation';
          box.style.cssText = `left:${r.left - 3}px;top:${r.top - 2}px;width:${r.width + 6}px;height:${r.height + 4}px`;
          el.memoryLayer.appendChild(box);
        }
      }
      buildTextLayer(el, textContent, viewport);

      try {
        const record = await getMarkup(fileId, el.pageNum);
        el.strokes = record && record.strokes ? record.strokes : [];
      } catch { el.strokes = []; }
      renderMarkup(el);
      el.rendered = true;
    } finally {
      el.rendering = false;
      if (el.freePending) { el.freePending = false; freePage(el); }
      else pruneRendered();
    }
  }

  function buildTextLayer(el, textContent, viewport) {
    el.textLayer.innerHTML = '';
    if (!textContent) return;
    const frag = document.createDocumentFragment();
    for (const it of textContent.items) {
      if (!it.str || !it.str.trim()) continue;
      const t = it.transform;
      const [x, y] = viewport.convertToViewportPoint(t[4], t[5]);
      const fontPx = Math.abs(t[3]) * viewport.scale;
      if (fontPx < 4) continue;
      const span = document.createElement('span');
      span.textContent = it.str;
      span.style.left = x + 'px';
      span.style.top = (y - fontPx) + 'px';
      span.style.fontSize = fontPx + 'px';
      span.style.lineHeight = fontPx + 'px';
      frag.appendChild(span);
    }
    el.textLayer.appendChild(frag);
  }

  function memoryItemRects(text) {
    const rows = new Map();
    for (const it of text.items) {
      if (!it || typeof it.str !== 'string') continue;
      const tx = it.transform;
      const x = tx[4], y = tx[5];
      const w = it.width || 0, h = it.height || Math.abs(tx[3]) || 10;
      const key = Math.round(y / 4);
      if (!rows.has(key)) rows.set(key, { hasMark: false, minX: x, maxX: x + w, minY: y, maxY: y + h });
      const row = rows.get(key);
      row.minX = Math.min(row.minX, x); row.maxX = Math.max(row.maxX, x + w);
      row.minY = Math.min(row.minY, y); row.maxY = Math.max(row.maxY, y + h);
      if (it.str.includes('#')) row.hasMark = true;
    }
    const out = [];
    for (const row of rows.values()) if (row.hasMark) out.push([row.minX, row.minY, row.maxX, row.maxY]);
    return out;
  }

  function rectToView(rect, viewport) {
    const [x1, y1, x2, y2] = rect;
    const [vx1, vy1] = viewport.convertToViewportPoint(x1, y1);
    const [vx2, vy2] = viewport.convertToViewportPoint(x2, y2);
    return { left: Math.min(vx1, vx2), top: Math.min(vy1, vy2), width: Math.abs(vx2 - vx1), height: Math.abs(vy2 - vy1) };
  }

  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const el = wrapToEl.get(e.target);
      if (el && e.isIntersecting) renderOne(el).catch((err) => console.warn('render failed', el.pageNum, err));
    }
    recomputeActive();
  }, { root: container, rootMargin: '700px 0px 700px 0px', threshold: 0 });
  pageEls.forEach((p) => io.observe(p.wrap));

  function recomputeActive() {
    if (Date.now() < suppressIoUntil) return;
    const cMid = container.getBoundingClientRect().top + container.clientHeight / 2;
    let best = activePage, bestDist = Infinity;
    for (const p of pageEls) {
      const r = p.wrap.getBoundingClientRect();
      if (r.height === 0) continue;
      const d = Math.abs((r.top + r.height / 2) - cMid);
      if (d < bestDist) { bestDist = d; best = +p.wrap.getAttribute('data-page'); }
    }
    if (best !== activePage) {
      activePage = best;
      onPageChange && onPageChange(activePage);
    }
  }
  let scrollRaf = 0;
  container.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; recomputeActive(); });
  });

  function scrollToPage(n, { smooth = false } = {}) {
    const idx = Math.max(1, Math.min(doc.numPages, n)) - 1;
    const el = pageEls[idx];
    if (!el) return;
    for (let j = Math.max(0, idx - 2); j <= Math.min(pageEls.length - 1, idx + 2); j++) {
      renderOne(pageEls[j]).catch(() => {});
    }
    const wrapRect = el.wrap.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const centreOffset = (container.clientHeight - wrapRect.height) / 2;
    const target = container.scrollTop + (wrapRect.top - containerRect.top) - centreOffset;
    suppressIoUntil = Date.now() + (smooth ? 1500 : 250);
    container.scrollTo({ top: target, behavior: smooth ? 'smooth' : 'auto' });
    activePage = idx + 1;
    onPageChange && onPageChange(activePage);
  }

  function navigate(n, { push = false, smooth = false } = {}) {
    const dest = Math.max(1, Math.min(doc.numPages, n));
    if (push && dest !== activePage) { backStack.push(activePage); fwdStack.length = 0; }
    scrollToPage(dest, { smooth });
    emitHistory();
  }
  function goBack() {
    if (!backStack.length) return;
    fwdStack.push(activePage);
    scrollToPage(backStack.pop(), { smooth: true });
    emitHistory();
  }
  function goForward() {
    if (!fwdStack.length) return;
    backStack.push(activePage);
    scrollToPage(fwdStack.pop(), { smooth: true });
    emitHistory();
  }
  function emitHistory() {
    onHistoryChange && onHistoryChange({ canBack: backStack.length > 0, canForward: fwdStack.length > 0 });
  }

  // Nested chapter outline for the sidebar tree.
  async function getOutline() {
    let raw = null;
    try { raw = await doc.getOutline(); } catch { raw = null; }
    if (!raw || !raw.length) return [];
    async function walk(items) {
      const out = [];
      for (const it of items) {
        let page = null;
        try { page = await resolveDest(doc, it.dest); } catch {}
        out.push({
          title: it.title || '(untitled)', page,
          children: it.items && it.items.length ? await walk(it.items) : [],
        });
      }
      return out;
    }
    return walk(raw);
  }

  setTimeout(() => { scrollToPage(startPage, { smooth: false }); emitHistory(); }, 50);

  return {
    numPages: doc.numPages,
    scrollToPage: (n, o) => navigate(n, o || {}),
    getActivePage: () => activePage,
    goBack, goForward,
    undo: () => undo(activePage),
    clearPage: () => clearPage(activePage),
    getOutline,
  };
}

// --- stroke rendering + hit-testing -----------------------------------------

function drawStroke(ctx, s, cssW, cssH) {
  if (!s.pts || !s.pts.length) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = s.color || '#ff3b30';
  ctx.fillStyle = s.color || '#ff3b30';
  ctx.lineWidth = Math.max(1, (s.w || 0.006) * cssW);
  ctx.globalAlpha = (s.tool === 'highlight' || s.kind === 'hl') ? 0.4 : 1;
  const P = (i) => [s.pts[i][0] * cssW, s.pts[i][1] * cssH];
  if (s.kind === 'free' || !s.kind) {
    ctx.beginPath();
    ctx.moveTo(...P(0));
    for (let i = 1; i < s.pts.length; i++) ctx.lineTo(...P(i));
    if (s.pts.length === 1) ctx.lineTo(P(0)[0] + 0.1, P(0)[1]);
    ctx.stroke();
  } else if (s.kind === 'hl') {
    const [x1, y1] = P(0), [x2, y2] = P(1);
    ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else if (s.kind === 'line' || s.kind === 'arrow') {
    const [x1, y1] = P(0), [x2, y2] = P(1);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    if (s.kind === 'arrow') {
      const ang = Math.atan2(y2 - y1, x2 - x1);
      const h = Math.max(10, ctx.lineWidth * 3.2);
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - h * Math.cos(ang - 0.4), y2 - h * Math.sin(ang - 0.4));
      ctx.lineTo(x2 - h * Math.cos(ang + 0.4), y2 - h * Math.sin(ang + 0.4));
      ctx.closePath(); ctx.fill();
    }
  } else if (s.kind === 'box') {
    const [x1, y1] = P(0), [x2, y2] = P(1);
    ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
  } else if (s.kind === 'text') {
    const size = (s.size || 0.026) * cssH;
    ctx.font = `600 ${size}px -apple-system, system-ui, sans-serif`;
    ctx.textBaseline = 'top';
    ctx.fillText(s.text || '', P(0)[0], P(0)[1]);
  }
  ctx.restore();
}

function distToSeg(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

function strokeSegments(s) {
  const segs = [];
  if (s.kind === 'box' || s.kind === 'hl') {
    const [a, b] = s.pts;
    const tl = [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
    const br = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    const tr = [br[0], tl[1]], bl = [tl[0], br[1]];
    segs.push([tl, tr], [tr, br], [br, bl], [bl, tl]);
    if (s.kind === 'hl') segs.push([tl, br]);
  } else if (s.kind === 'line' || s.kind === 'arrow') {
    segs.push([s.pts[0], s.pts[1]]);
  } else if (s.kind === 'text') {
    segs.push([s.pts[0], s.pts[0]]);
  } else {
    for (let i = 0; i < s.pts.length; i++) segs.push([s.pts[i], s.pts[Math.min(i + 1, s.pts.length - 1)]]);
  }
  return segs;
}

function strokeHit(s, p) {
  return strokeSegments(s).some((seg) => distToSeg(p, seg[0], seg[1]) < ERASE_RADIUS);
}

async function resolveDest(doc, dest) {
  let resolved = dest;
  if (typeof dest === 'string') {
    try { resolved = await doc.getDestination(dest); } catch { return null; }
  }
  if (!Array.isArray(resolved) || !resolved[0]) return null;
  try { return (await doc.getPageIndex(resolved[0])) + 1; } catch { return null; }
}
