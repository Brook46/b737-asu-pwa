// Auto-extraction of content anchors from a PDF's text layer.
//
// HONEST CAVEAT: this is regex heuristics over a flattened text layer. Reading
// order, headers/footers and decimal formats vary between manuals, so every
// anchor carries a `confidence` score and the anchor-admin UI is the source of
// truth — the user can add, correct or delete anything produced here.

import { anchorTypeFor } from './manuals.js';

const RE_DECIMAL = /\b\d{1,2}\.\d{1,2}\.\d{1,3}\b/g;

function mkAnchor(fileId, manualType, anchorType, value, title, pageNum, confidence) {
  return {
    anchorId: `${fileId}:${anchorType}:${String(value).toUpperCase()}`,
    fileId,
    manualType,
    anchorType,
    value: String(value),
    title: (title || '').trim().slice(0, 90),
    pageNum,
    source: 'auto',
    confidence: Math.round(confidence * 100) / 100,
  };
}

function firstMeaningfulLine(text) {
  for (const raw of (text || '').split('\n')) {
    const line = raw.trim();
    if (line.length >= 4 && /[a-z]/i.test(line)) return line;
  }
  return '';
}

// FCOM / FCTM / OMA — decimal page identifiers printed on each page.
function extractDecimal(fileId, manualType, pages) {
  const seen = new Map();
  for (const p of pages) {
    const text = p.text || '';
    const matches = text.match(RE_DECIMAL);
    if (!matches || !matches.length) continue;
    // The decimal that repeats (header + footer) is most likely the page id.
    const freq = {};
    for (const m of matches) freq[m] = (freq[m] || 0) + 1;
    const distinct = Object.keys(freq).sort((a, b) => freq[b] - freq[a]);
    const primary = distinct[0];
    let confidence = 0.5;
    if (distinct.length === 1) confidence = 0.9;
    else if (freq[primary] > 1) confidence = 0.75;
    if (!seen.has(primary)) {
      seen.set(primary, mkAnchor(fileId, manualType, 'decimal', primary,
        firstMeaningfulLine(text), p.pageNum, confidence));
    }
  }
  return [...seen.values()];
}

// MEL / CDL — ATA item numbers, typically as section headers at line start.
function extractAta(fileId, manualType, pages) {
  const seen = new Map();
  for (const p of pages) {
    for (const raw of (p.text || '').split('\n')) {
      const m = raw.trim().match(/^(\d{2}-\d{2})\b\s*(.*)$/);
      if (!m) continue;
      const value = m[1];
      if (seen.has(value)) continue;
      const confidence = m[2] && /[a-z]/i.test(m[2]) ? 0.85 : 0.6;
      seen.set(value, mkAnchor(fileId, manualType, 'ata', value, m[2], p.pageNum, confidence));
    }
  }
  return [...seen.values()];
}

function looksLikeNncTitle(s) {
  if (s.length < 4 || s.length > 70) return false;
  if (/[.;:,]$/.test(s)) return false;
  const letters = s.replace(/[^a-z]/gi, '');
  if (letters.length < 3) return false;
  const upper = s.replace(/[^A-Z]/g, '').length;
  const allCaps = upper / letters.length > 0.7;
  const titleCase = /^[A-Z][A-Za-z]+(\s+(?:[A-Z][A-Za-z]+|and|or|of|to|the))*$/.test(s);
  return allCaps || titleCase;
}

// QRH — Non-Normal Checklist titles. A page that also carries checklist markup
// (numbered steps, "Checklist Complete", "Condition:") gets higher confidence.
function extractNnc(fileId, manualType, pages) {
  const seen = new Map();
  for (const p of pages) {
    const text = p.text || '';
    const hasChecklist = /checklist complete|condition\s*:|^\s*1\s/im.test(text);
    for (const raw of text.split('\n')) {
      const line = raw.trim();
      if (!looksLikeNncTitle(line)) continue;
      const key = line.toLowerCase();
      if (seen.has(key)) break;
      seen.set(key, mkAnchor(fileId, manualType, 'nnc', line, line, p.pageNum,
        hasChecklist ? 0.7 : 0.4));
      break; // one primary NNC title per page
    }
  }
  return [...seen.values()];
}

/**
 * Extract anchors for a freshly-ingested file.
 * @param {string} fileId
 * @param {string} manualType  one of MANUAL_TYPES ids
 * @param {Array} pages         page records from extractPdf()
 * @returns {Array} anchor records ready for storage.putAnchors()
 */
export function extractAnchors(fileId, manualType, pages) {
  switch (anchorTypeFor(manualType)) {
    case 'decimal': return extractDecimal(fileId, manualType, pages);
    case 'ata':     return extractAta(fileId, manualType, pages);
    case 'nnc':     return extractNnc(fileId, manualType, pages);
    default:        return [];
  }
}
