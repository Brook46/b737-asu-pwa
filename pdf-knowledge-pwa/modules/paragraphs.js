// Paragraph splitting + hashing for the 3-D indexer.
//
// PDF text layers vary wildly: some have real paragraph breaks (blank lines),
// others arrive as one big stream split only on single newlines. We try the
// double-newline split first and fall back to single. Short / non-prose lines
// (headers, footers, page numbers) are filtered out.

import * as storage from './storage.js?v=5';

const cache = new Map(); // `${fileId}:${pageNum}` -> string[]

export function paragraphHash(text) {
  let h = 5381;
  const s = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(36);
}

export function splitPageParagraphs(text) {
  if (!text) return [];
  let parts = text.split(/\n{2,}/);
  if (parts.length < 2) parts = text.split(/\n+/);
  return parts
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p.length >= 30 && /[a-z]/i.test(p));
}

export async function paragraphsForPage(fileId, pageNum) {
  const key = `${fileId}:${pageNum}`;
  if (cache.has(key)) return cache.get(key);
  const pages = await storage.getPagesForFile(fileId);
  const p = pages.find((x) => x.pageNum === pageNum);
  const paras = splitPageParagraphs(p ? p.text : '');
  cache.set(key, paras);
  return paras;
}

export function clearParagraphCache(fileId) {
  if (!fileId) { cache.clear(); return; }
  for (const k of [...cache.keys()]) if (k.startsWith(fileId + ':')) cache.delete(k);
}
