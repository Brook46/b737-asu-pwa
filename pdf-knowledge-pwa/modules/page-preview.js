// Tiny PDF page preview renderer: caches one pdfjs document per fileId,
// renders a single page into a canvas at the canvas's pixel width.
// Used by the home view result cards to show the actual page (not a link).

import { pdfjsLib } from './pdf-ingest.js';
import * as storage from './storage.js?v=5';

const docCache = new Map(); // fileId -> pdf.js PDFDocumentProxy

async function getDoc(fileId) {
  if (docCache.has(fileId)) return docCache.get(fileId);
  const file = await storage.getFile(fileId);
  if (!file || !file.blob) throw new Error('file missing: ' + fileId);
  const buf = await file.blob.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf.slice(0) }).promise;
  docCache.set(fileId, doc);
  return doc;
}

// Render `pageNum` of `fileId` into `canvas` sized to its CSS width.
// dpr-aware. If `highlightRects` (normalized [x,y,w,h] in viewport coords)
// are provided, draws translucent overlays.
export async function renderPreview(canvas, fileId, pageNum, { maxWidthPx = 360, highlightRects = null } = {}) {
  const doc = await getDoc(fileId);
  const page = await doc.getPage(pageNum);
  const baseVp = page.getViewport({ scale: 1 });
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = Math.min(maxWidthPx, canvas.parentElement?.clientWidth || maxWidthPx);
  const scale = cssW / baseVp.width;
  const vp = page.getViewport({ scale });
  canvas.width = Math.round(vp.width * dpr);
  canvas.height = Math.round(vp.height * dpr);
  canvas.style.width = vp.width + 'px';
  canvas.style.height = vp.height + 'px';
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  if (highlightRects && highlightRects.length) {
    ctx.fillStyle = 'rgba(255, 213, 79, 0.36)';
    for (const r of highlightRects) {
      // selectionRects are normalized (0..1). Scale to CSS pixels.
      const x = r[0] * vp.width, y = r[1] * vp.height,
            w = r[2] * vp.width, h = r[3] * vp.height;
      ctx.fillRect(x, y, w, h);
    }
  }
  return { width: vp.width, height: vp.height };
}

// Drop a document from cache (call after deleting a file).
export function evictDoc(fileId) {
  const d = docCache.get(fileId);
  if (d && d.destroy) d.destroy();
  docCache.delete(fileId);
}
