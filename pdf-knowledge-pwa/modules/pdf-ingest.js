// PDF ingestion: extract per-page text and annotations using PDF.js.
// Each page record contains the text used for search and the list of
// annotations with their page coordinates so the viewer can highlight them.

import * as pdfjsLib from '../vendor/pdfjs/pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;

export function makeFileId() {
  return 'f_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

function pageIdFor(fileId, pageNum) {
  return fileId + ':' + pageNum;
}

function normalizeAnnotation(a) {
  // PDF.js annotation rect is [x1, y1, x2, y2] in PDF user space (origin bottom-left).
  return {
    subtype: a.subtype || null,
    contents: a.contentsObj && a.contentsObj.str ? a.contentsObj.str : (a.contents || ''),
    title: a.titleObj && a.titleObj.str ? a.titleObj.str : (a.title || ''),
    rect: Array.isArray(a.rect) ? a.rect.slice(0, 4) : null,
  };
}

function annotationText(ann) {
  return [ann.title, ann.contents].filter(Boolean).join(' ').trim();
}

function joinTextItems(items) {
  // Reassemble text with spaces; PDF.js gives an array of {str, hasEOL}.
  let out = '';
  for (const it of items) {
    if (!it) continue;
    if (typeof it.str === 'string') out += it.str;
    if (it.hasEOL) out += '\n';
    else out += ' ';
  }
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function extractPdf(arrayBuffer, fileId) {
  // PDF.js consumes the buffer; pass a copy so the caller can still keep the original.
  const buf = arrayBuffer.slice(0);
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  const pdf = await loadingTask.promise;
  const pages = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const [textContent, annotations] = await Promise.all([
      page.getTextContent(),
      page.getAnnotations().catch(() => []),
    ]);
    const viewport = page.getViewport({ scale: 1 });
    const text = joinTextItems(textContent.items);
    const normAnns = annotations.map(normalizeAnnotation).filter((a) => annotationText(a) || a.subtype);
    const annText = normAnns.map(annotationText).filter(Boolean).join('\n');
    pages.push({
      pageId: pageIdFor(fileId, i),
      fileId,
      pageNum: i,
      text,
      annotationsText: annText,
      annotations: normAnns,
      width: viewport.width,
      height: viewport.height,
    });
  }
  return { numPages: pdf.numPages, pages };
}

export { pdfjsLib };
