// MiniSearch-backed full-text search across page records.
// Index is rebuilt from IndexedDB on boot (cheap for <50 files / <200 MB libraries).

import { getAllPages } from './storage.js';

let MiniSearch = null;
let index = null;
let pageMap = new Map(); // pageId -> { fileId, pageNum, text, annotationsText, fileName }

async function ensureMiniSearch() {
  if (MiniSearch) return MiniSearch;
  // MiniSearch UMD attaches to window.
  if (!window.MiniSearch) {
    await new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = './vendor/minisearch.min.js';
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }
  MiniSearch = window.MiniSearch;
  return MiniSearch;
}

function buildIndex() {
  return new MiniSearch({
    fields: ['text', 'annotationsText', 'fileName'],
    storeFields: ['fileId', 'pageNum', 'fileName'],
    idField: 'pageId',
    searchOptions: {
      boost: { annotationsText: 2, fileName: 1.5 },
      fuzzy: 0.2,
      prefix: true,
    },
  });
}

export async function rebuildIndex(filesById) {
  await ensureMiniSearch();
  const pages = await getAllPages();
  pageMap.clear();
  index = buildIndex();
  const docs = pages.map((p) => {
    const fileName = (filesById.get(p.fileId) || {}).name || '';
    pageMap.set(p.pageId, { ...p, fileName });
    return {
      pageId: p.pageId,
      fileId: p.fileId,
      pageNum: p.pageNum,
      text: p.text || '',
      annotationsText: p.annotationsText || '',
      fileName,
    };
  });
  index.addAll(docs);
}

export async function addPagesToIndex(pages, fileName) {
  await ensureMiniSearch();
  if (!index) index = buildIndex();
  const docs = pages.map((p) => {
    pageMap.set(p.pageId, { ...p, fileName });
    return {
      pageId: p.pageId,
      fileId: p.fileId,
      pageNum: p.pageNum,
      text: p.text || '',
      annotationsText: p.annotationsText || '',
      fileName,
    };
  });
  index.addAll(docs);
}

export function removeFileFromIndex(fileId) {
  if (!index) return;
  for (const [pageId, p] of pageMap) {
    if (p.fileId === fileId) {
      try { index.discard(pageId); } catch {}
      pageMap.delete(pageId);
    }
  }
}

export function search(query, { limit = 8 } = {}) {
  if (!index || !query.trim()) return [];
  const results = index.search(query, { combineWith: 'AND' });
  // Attach the page text snippet for ranking sentences later.
  return results.slice(0, limit).map((r) => {
    const page = pageMap.get(r.id);
    return {
      pageId: r.id,
      fileId: r.fileId,
      pageNum: r.pageNum,
      fileName: r.fileName,
      score: r.score,
      terms: r.terms,
      text: page ? page.text : '',
      annotationsText: page ? page.annotationsText : '',
    };
  });
}

export function getPageByIdCached(pageId) {
  return pageMap.get(pageId);
}
