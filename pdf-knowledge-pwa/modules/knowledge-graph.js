// Knowledge graph — the single query API for content anchors.
//
// Every other module asks this module "where is content X?" and gets back an
// anchor {fileId, pageNum, ...}. Nothing else in the app resolves raw page
// numbers, so a revision that renumbers pages only needs the anchor store
// rebuilt — callers are unaffected.

import * as storage from './storage.js?v=5';

let cache = null; // { all: [anchor] }

export async function load(force = false) {
  if (cache && !force) return cache;
  cache = { all: await storage.getAllAnchors() };
  return cache;
}

export function invalidate() { cache = null; }

export async function allAnchors() {
  return (await load()).all;
}

export async function anchorsByManualType(manualType, { fileIds = null } = {}) {
  return (await allAnchors()).filter(
    (a) => a.manualType === manualType && (!fileIds || fileIds.has(a.fileId))
  );
}

export async function anchorsForFile(fileId) {
  return (await allAnchors()).filter((a) => a.fileId === fileId);
}

/**
 * Query indexed anchors by ANY combination of the three dimensions.
 *  - phases:        match if anchor.phases includes ANY of these
 *  - briefingTypes: match if anchor.briefingTypes includes ANY of these
 *  - scenarios:     match if anchor.scenarios includes ANY of these
 *  - query:         free-text match against title + excerpt
 *  - fileIds:       optional Set to restrict to specific files
 *  - kind:          default 'idx' (the new 3-D indexed items only)
 * All non-empty filters are AND-combined.
 */
export async function indexedAnchors({ phases, briefingTypes, scenarios,
  fileIds = null, query = '', kind = 'idx' } = {}) {
  const wantP = phases && phases.length ? new Set(phases) : null;
  const wantB = briefingTypes && briefingTypes.length ? new Set(briefingTypes) : null;
  const wantS = scenarios && scenarios.length ? new Set(scenarios) : null;
  const terms = String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  return (await allAnchors()).filter((a) => {
    if (kind && a.kind !== kind) return false;
    if (fileIds && !fileIds.has(a.fileId)) return false;
    if (wantP && !(a.phases || []).some((p) => wantP.has(p))) return false;
    if (wantB && !(a.briefingTypes || []).some((b) => wantB.has(b))) return false;
    if (wantS && !(a.scenarios || []).some((s) => wantS.has(s))) return false;
    if (terms.length) {
      const hay = `${a.title || ''} ${a.excerpt || ''} ${a.value || ''}`.toLowerCase();
      if (!terms.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

// Resolve a content id (e.g. FCOM "13.20.3") to its best anchor.
export async function resolveAnchor(manualType, value, { fileIds = null } = {}) {
  const v = String(value).trim().toLowerCase();
  const hits = (await allAnchors()).filter(
    (a) => a.manualType === manualType
      && String(a.value).trim().toLowerCase() === v
      && (!fileIds || fileIds.has(a.fileId))
  );
  return hits.sort((a, b) => (b.confidence || 0) - (a.confidence || 0))[0] || null;
}

// Anchors whose value/title starts with (or contains) a section hint, used by
// phase navigation to find e.g. all "Amplified Procedures" pages.
export async function findAnchors(manualType, hint, { fileIds = null } = {}) {
  const h = String(hint || '').trim().toLowerCase();
  if (!h) return [];
  return (await allAnchors())
    .filter((a) => a.manualType === manualType && (!fileIds || fileIds.has(a.fileId)))
    .filter((a) => {
      const v = String(a.value).toLowerCase();
      const t = String(a.title).toLowerCase();
      return v === h || v.startsWith(h) || t.includes(h);
    })
    .sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
}

// Free-text anchor search for the "Jump to Link" feature.
export async function searchAnchors(query, { fileIds = null } = {}) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return [];
  const terms = q.split(/\s+/).filter(Boolean);
  return (await allAnchors())
    .filter((a) => !fileIds || fileIds.has(a.fileId))
    .map((a) => {
      const hay = `${a.manualType} ${a.value} ${a.title}`.toLowerCase();
      const hits = terms.filter((t) => hay.includes(t)).length;
      return { anchor: a, score: hits };
    })
    .filter((r) => r.score === terms.length)
    .sort((a, b) => b.score - a.score || (b.anchor.confidence || 0) - (a.anchor.confidence || 0))
    .map((r) => r.anchor);
}

// Search results grouped by manual type for the grouped "Jump to Link" UI.
export async function groupedSearch(query, opts) {
  const hits = await searchAnchors(query, opts);
  const groups = new Map();
  for (const a of hits) {
    if (!groups.has(a.manualType)) groups.set(a.manualType, []);
    groups.get(a.manualType).push(a);
  }
  return [...groups.entries()].map(([manualType, anchors]) => ({ manualType, anchors }));
}
