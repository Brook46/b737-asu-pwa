// Horizontal page-by-page PDF viewer.
//
// Supports multiple concurrent mounts (for side-by-side split view): render
// cancellation and markup wiring are tracked per container, not globally.
// Each mount also keeps a back/forward history for in-PDF link jumps, and
// centres the chosen page in the viewport.

import { pdfjsLib } from './pdf-ingest.js';
import { getFile, getMarkup, putMarkup, deleteMarkup } from './storage.js';

const docCache = new Map();
const tokens = new WeakMap();         // container -> current render token
const markupHandles = new Map();      // container -> { applyMode }

// Markup tool state is module-level so every pane shares the active tool.
let markupTool = null;                // null|pen|highlight|line|arrow|box|text|eraser
let markupColor = '#ff3b30';
let markupWidth = 0.006;              // normalised stroke width
const HL_WIDTH = 0.028;
const ERASE_RADIUS = 0.022;
const TEXT_SIZE = 0.026;

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
  markupHandles.clear();
}

// --- Markup tool API ---------------------------------------------------------

export function setMarkupTool(tool) {
  markupTool = tool || null;
  for (const h of markupHandles.values()) h.applyMode();
  return markupTool;
}
export function getMarkupTool() { return markupTool; }
export function setMarkupColor(color) { markupColor = color; }
export function setMarkupWidth(w) { markupWidth = w; }

export async function findQueryHighlight(fileId, pageNum, query) {
  if (!query || !query.trim()) return null;
  const doc = await loadDoc(fileId);
  const page = await doc.getPage(pageNum);
  const text = await page.getTextContent();
  const terms = query.toLowerCase().match(/[a-z0-9֐-׿]+/g) || [];
  if (!terms.length) return null;
  const viewport = page.getViewport({ scale: 1 });
  const matches = [];
  for (const it of text.items) {
    if (!it.str) continue;
    if (!terms.some((t) => it.str.toLowerCase().includes(t))) continue;
    const tx = it.transform;
    matches.push({ x: tx[4], y: tx[5], w: it.width || (tx[0] * (it.str.length || 1)), h: it.height || Math.abs(tx[3]) || 12 });
  }
  if (!matches.length) return null;
  const minX = Math.min(...matches.map((m) => m.x)) - 4;
  const maxX = Math.max(...matches.map((m) => m.x + m.w)) + 4;
  const minY = Math.min(...matches.map((m) => m.y)) - 4;
  const maxY = Math.max(...matches.map((m) => m.y + m.h)) + 4;
  return {
    rect: [Math.max(0, minX), Math.max(0, minY), Math.min(viewport.width, maxX), Math.min(viewport.height, maxY)],
    matchCount: matches.length,
  };
}

/**
 * Mount a PDF into a horizontal scroll container.
 * @param {HTMLElement} container
 * @param {string} fileId
 * @param {object} opts { startPage, highlights, onPageChange, markMemory, onHistoryChange }
 */
export async function mountPdf(container, fileId, opts = {}) {
  const { startPage = 1, highlights = [], onPageChange, markMemory = false, onHistoryChange } = opts;
  const doc = await loadDoc(fileId);
  const myToken = Symbol('render');
  tokens.set(container, myToken);
  const live = () => tokens.get(container) === myToken;
  // Drop markup handles for panes that were removed from the DOM.
  for (const c of [...markupHandles.keys()]) if (!c.isConnected) markupHandles.delete(c);
  container.innerHTML = '';
  container.setAttribute('data-fileid', fileId);

  const containerHeight = Math.max(320, container.clientHeight - 16);
  const pageEls = [];
  const highlightByPage = new Map(highlights.filter((h) => h.rect).map((h) => [h.pageNum, h.rect]));
  const backStack = [];
  const fwdStack = [];

  const pageDims = new Array(doc.numPages);
  for (let i = 1; i <= doc.numPages; i++) {
    const p = await doc.getPage(i);
    const v1 = p.getViewport({ scale: 1 });
    const fitScale = Math.min(3, Math.max(0.5, containerHeight / v1.height));
    const v = p.getViewport({ scale: fitScale });
    pageDims[i - 1] = { width: Math.floor(v.width), height: Math.floor(v.height), scale: fitScale, page: p };
  }

  for (let i = 1; i <= doc.numPages; i++) {
    const dim = pageDims[i - 1];
    const wrap = document.createElement('div');
    wrap.className = 'pdf-page';
    wrap.setAttribute('data-page', String(i));
    wrap.style.width = dim.width + 'px';
    wrap.style.height = dim.height + 'px';
    const canvas = document.createElement('canvas');
    const highlightLayer = document.createElement('div');
    highlightLayer.className = 'pdf-highlight-layer';
    const memoryLayer = document.createElement('div');
    memoryLayer.className = 'pdf-memory-layer';
    const linkLayer = document.createElement('div');
    linkLayer.className = 'pdf-link-layer';
    const drawLayer = document.createElement('canvas');
    drawLayer.className = 'pdf-draw-layer';
    wrap.append(canvas, highlightLayer, memoryLayer, linkLayer, drawLayer);
    container.appendChild(wrap);
    const el = { wrap, canvas, linkLayer, highlightLayer, memoryLayer, drawLayer, dim, pageNum: i, strokes: [], current: null, dirty: false };
    pageEls.push(el);
    attachMarkup(el);
  }

  function applyMode() {
    const active = !!markupTool;
    for (const el of pageEls) {
      el.drawLayer.style.pointerEvents = active ? 'auto' : 'none';
      el.drawLayer.style.touchAction = active ? 'none' : 'auto';
      el.drawLayer.classList.toggle('markup-active', active);
    }
  }
  markupHandles.set(container, { applyMode });
  applyMode();

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

  // --- active page tracking ---
  let activePage = startPage;
  let suppressIoUntil = 0;
  function recomputeActive() {
    if (!live() || Date.now() < suppressIoUntil) return;
    const cLeft = container.getBoundingClientRect().left;
    let best = activePage, bestDist = Infinity;
    for (const p of pageEls) {
      const r = p.wrap.getBoundingClientRect();
      const d = Math.abs((r.left + r.width / 2) - (cLeft + container.clientWidth / 2));
      if (d < bestDist) { bestDist = d; best = +p.wrap.getAttribute('data-page'); }
    }
    if (best !== activePage) { activePage = best; onPageChange && onPageChange(activePage); }
  }
  const io = new IntersectionObserver(() => recomputeActive(), { root: container, threshold: [0, 0.5, 1] });
  pageEls.forEach((p) => io.observe(p.wrap));
  let scrollRaf = 0;
  container.addEventListener('scroll', () => {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; recomputeActive(); });
  });

  async function renderOne(pageNum, el) {
    if (!live()) return;
    const page = el.dim.page;
    const viewport = page.getViewport({ scale: el.dim.scale });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.canvas.width = Math.floor(viewport.width * dpr);
    el.canvas.height = Math.floor(viewport.height * dpr);
    el.canvas.style.width = Math.floor(viewport.width) + 'px';
    el.canvas.style.height = Math.floor(viewport.height) + 'px';
    for (const layer of [el.linkLayer, el.highlightLayer, el.memoryLayer, el.drawLayer]) {
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

    const hRect = highlightByPage.get(pageNum);
    el.highlightLayer.innerHTML = '';
    if (hRect) {
      const r = rectToView(hRect, viewport);
      const hl = document.createElement('div');
      hl.className = 'pdf-highlight';
      hl.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
      el.highlightLayer.appendChild(hl);
    }

    el.memoryLayer.innerHTML = '';
    if (markMemory) {
      try {
        const text = await page.getTextContent();
        for (const rect of memoryItemRects(text)) {
          const r = rectToView(rect, viewport);
          const box = document.createElement('div');
          box.className = 'pdf-memory-box';
          box.title = 'Memory item — (#) limitation';
          box.style.cssText = `left:${r.left - 3}px;top:${r.top - 2}px;width:${r.width + 6}px;height:${r.height + 4}px`;
          el.memoryLayer.appendChild(box);
        }
      } catch { /* best-effort */ }
    }

    try {
      const record = await getMarkup(fileId, pageNum);
      el.strokes = record && record.strokes ? record.strokes : [];
    } catch { el.strokes = []; }
    renderMarkup(el);
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

  // Centre the page in the viewport.
  function scrollToPage(n, { smooth = false } = {}) {
    const idx = Math.max(1, Math.min(doc.numPages, n)) - 1;
    const el = pageEls[idx];
    if (!el) return;
    const wrapRect = el.wrap.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const centreOffset = (container.clientWidth - wrapRect.width) / 2;
    const target = container.scrollLeft + (wrapRect.left - containerRect.left) - centreOffset;
    suppressIoUntil = Date.now() + (smooth ? 1500 : 250);
    container.scrollTo({ left: target, behavior: smooth ? 'smooth' : 'auto' });
    activePage = idx + 1;
    onPageChange && onPageChange(activePage);
  }

  // Navigate with optional back/forward history (used by in-PDF links).
  function navigate(n, { push = false, smooth = false } = {}) {
    const dest = Math.max(1, Math.min(doc.numPages, n));
    if (push && dest !== activePage) {
      backStack.push(activePage);
      fwdStack.length = 0;
    }
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

  const renderQueue = pageEls.map((p, idx) => ({ page: idx + 1, el: p }));
  renderQueue.sort((a, b) => Math.abs(a.page - startPage) - Math.abs(b.page - startPage));
  (async () => {
    for (const { page, el } of renderQueue) {
      if (!live()) return;
      try { await renderOne(page, el); } catch (err) { console.warn('page render failed', page, err); }
    }
  })();

  setTimeout(() => { scrollToPage(startPage, { smooth: false }); emitHistory(); }, 50);

  return {
    numPages: doc.numPages,
    scrollToPage: (n, o) => navigate(n, o || {}),
    getActivePage: () => activePage,
    goBack, goForward,
    undo: () => undo(activePage),
    clearPage: () => clearPage(activePage),
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
  ctx.globalAlpha = s.tool === 'highlight' ? 0.38 : 1;
  const P = (i) => [s.pts[i][0] * cssW, s.pts[i][1] * cssH];
  if (s.kind === 'free' || !s.kind) {
    ctx.beginPath();
    ctx.moveTo(...P(0));
    for (let i = 1; i < s.pts.length; i++) ctx.lineTo(...P(i));
    if (s.pts.length === 1) ctx.lineTo(P(0)[0] + 0.1, P(0)[1]);
    ctx.stroke();
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
  if (s.kind === 'box') {
    const [a, b] = s.pts;
    const tl = [Math.min(a[0], b[0]), Math.min(a[1], b[1])];
    const br = [Math.max(a[0], b[0]), Math.max(a[1], b[1])];
    const tr = [br[0], tl[1]], bl = [tl[0], br[1]];
    segs.push([tl, tr], [tr, br], [br, bl], [bl, tl]);
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
