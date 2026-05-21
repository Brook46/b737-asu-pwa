// Update & maintenance protocol: List of Effective Pages (LEP) scanning,
// change-bar detection, and re-linking personal notes across a revision.
//
// HONEST CAVEATS:
//  - LEP `*` markers may render as detached/superscript text items; this scan
//    is best effort and the parsed result should be shown for confirmation.
//  - Change bars are vector graphics, NOT in the text layer. We rasterise each
//    page and sample the margins — this is advisory only, never authoritative.

import * as storage from './storage.js?v=4';
import { pdfjsLib } from './pdf-ingest.js';

const RE_PAGE_ID = /(\d{1,2}\.\d{1,2}\.\d{1,3}|\d{2}-\d{2})/;

// Scan pages for the LEP block and collect page identifiers carrying an "*".
export function scanLep(pages) {
  const starred = new Set();
  let inLep = false;
  for (const p of pages) {
    const text = p.text || '';
    if (/list of effective pages/i.test(text)) inLep = true;
    else if (inLep && /^(chapter|section|table of contents)/im.test(text)) inLep = false;
    if (!inLep) continue;
    for (const line of text.split('\n')) {
      if (!line.includes('*')) continue;
      const m = line.match(RE_PAGE_ID);
      if (m) starred.add(m[1]);
    }
  }
  return [...starred];
}

function normVal(v) {
  return String(v || '').trim().toUpperCase();
}

function titleTokens(s) {
  return new Set(String(s || '').toLowerCase().match(/[a-z0-9]+/g) || []);
}

function fuzzyTitleMatch(note, anchors) {
  const want = titleTokens(note.anchorTitle);
  if (!want.size) return null;
  let best = null, bestScore = 0;
  for (const a of anchors) {
    const have = titleTokens(a.title);
    let overlap = 0;
    for (const t of want) if (have.has(t)) overlap++;
    const score = overlap / want.size;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return bestScore >= 0.6 ? best : null;
}

/**
 * Re-link every note from an old manual file onto the anchors of its new
 * revision. Exact match on anchor value first, fuzzy title match as fallback.
 * Notes keep their noteId, so putAnnotation overwrites them in place.
 * @returns {{relinked:number, fuzzy:number, unmatched:Array}}
 */
export async function relinkNotes(oldFileId, newFileId) {
  const oldNotes = await storage.getAnnotationsForFile(oldFileId);
  const newAnchors = await storage.getAnchorsForFile(newFileId);
  const byValue = new Map(newAnchors.map((a) => [normVal(a.value), a]));

  let relinked = 0, fuzzy = 0;
  const unmatched = [];
  for (const note of oldNotes) {
    let target = byValue.get(normVal(note.anchorValue));
    let isFuzzy = false;
    if (!target) {
      target = fuzzyTitleMatch(note, newAnchors);
      isFuzzy = !!target;
    }
    if (!target) { unmatched.push(note); continue; }
    await storage.putAnnotation({
      ...note,
      anchorId: target.anchorId,
      fileId: newFileId,
      anchorValue: target.value,
      anchorTitle: target.title || note.anchorTitle,
      updatedAt: Date.now(),
    });
    if (isFuzzy) fuzzy++; else relinked++;
  }
  return { relinked, fuzzy, unmatched };
}

/**
 * Rasterise each page and sample the outer margins for a sustained vertical
 * dark run = a likely Boeing change bar. Advisory only.
 * @returns {Promise<number[]>} 1-based page numbers with a suspected change bar
 */
export async function detectChangeBars(blob, { onProgress } = {}) {
  const buf = await blob.arrayBuffer();
  const doc = await pdfjsLib.getDocument({ data: buf }).promise;
  const found = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 1.4 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    if (hasMarginBar(ctx, canvas.width, canvas.height)) found.push(i);
    if (onProgress) onProgress(i, doc.numPages);
  }
  return found;
}

function hasMarginBar(ctx, w, h) {
  const strips = [
    { x0: Math.floor(w * 0.015), x1: Math.floor(w * 0.07) },
    { x0: Math.floor(w * 0.93), x1: Math.floor(w * 0.985) },
  ];
  const minRun = h * 0.12; // a change bar runs alongside changed text
  for (const s of strips) {
    for (let x = s.x0; x < s.x1; x++) {
      const col = ctx.getImageData(x, 0, 1, h).data;
      let run = 0, best = 0;
      for (let y = 0; y < h; y++) {
        const i = y * 4;
        const dark = col[i] < 110 && col[i + 1] < 110 && col[i + 2] < 110;
        run = dark ? run + 1 : 0;
        if (run > best) best = run;
      }
      if (best > minRun) return true;
    }
  }
  return false;
}
