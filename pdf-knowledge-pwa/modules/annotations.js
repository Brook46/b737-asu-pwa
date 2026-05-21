// Annotation engine — personal text notes and pictures attached to a content
// anchor (decimal id / ATA item / NNC title), NOT a page index. Binding to the
// anchor is what lets notes survive a manual revision (see revision.js).
// Everything is stored in IndexedDB as Blobs, so it is fully available offline.

import * as storage from './storage.js?v=4';

function makeNoteId() {
  return 'n_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
}

export async function listForAnchor(anchorId) {
  return (await storage.getAnnotationsForAnchor(anchorId))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

export async function listForFile(fileId) {
  return storage.getAnnotationsForFile(fileId);
}

export async function countForFile(fileId) {
  return (await storage.getAnnotationsForFile(fileId)).length;
}

/**
 * Attach a note (text and/or image) to an anchor.
 * @param {object} anchor  anchor record from the knowledge graph
 * @param {object} payload { text, imageBlob }
 */
export async function addNote(anchor, { text = '', imageBlob = null } = {}) {
  const note = {
    noteId: makeNoteId(),
    anchorId: anchor.anchorId,
    fileId: anchor.fileId,
    manualType: anchor.manualType,
    // Denormalised so revision re-linking can rematch by content, not key,
    // and so the Notes view can reopen the viewer without a kg lookup.
    anchorValue: anchor.value,
    anchorTitle: anchor.title || '',
    pageNum: anchor.pageNum || 1,
    kind: imageBlob ? 'image' : 'note',
    text: text || '',
    imageBlob: imageBlob || null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await storage.putAnnotation(note);
  return note;
}

export async function updateNote(note, patch) {
  const next = { ...note, ...patch, updatedAt: Date.now() };
  await storage.putAnnotation(next);
  return next;
}

export async function removeNote(noteId) {
  await storage.deleteAnnotation(noteId);
}
