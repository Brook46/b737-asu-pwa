// IndexedDB wrapper for the B737 Pilot Companion PWA.
// Stores: files (PDF blobs), pages (extracted text per page), kv (settings),
// summaries (cached query answers), anchors (content knowledge graph),
// annotations (personal notes/images), manuals (per-file manual metadata),
// tails (aircraft registrations).

const DB_NAME = 'pdf-knowledge';
const DB_VERSION = 5;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains('files')) {
        db.createObjectStore('files', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('pages')) {
        const pages = db.createObjectStore('pages', { keyPath: 'pageId' });
        pages.createIndex('byFile', 'fileId', { unique: false });
      }
      if (!db.objectStoreNames.contains('kv')) {
        db.createObjectStore('kv', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('summaries')) {
        db.createObjectStore('summaries', { keyPath: 'key' });
      }
      if (e.oldVersion < 2) {
        if (!db.objectStoreNames.contains('anchors')) {
          const anchors = db.createObjectStore('anchors', { keyPath: 'anchorId' });
          anchors.createIndex('byFile', 'fileId', { unique: false });
          anchors.createIndex('byManualType', 'manualType', { unique: false });
        }
        if (!db.objectStoreNames.contains('annotations')) {
          const ann = db.createObjectStore('annotations', { keyPath: 'noteId' });
          ann.createIndex('byAnchor', 'anchorId', { unique: false });
          ann.createIndex('byFile', 'fileId', { unique: false });
        }
        if (!db.objectStoreNames.contains('manuals')) {
          db.createObjectStore('manuals', { keyPath: 'fileId' });
        }
        if (!db.objectStoreNames.contains('tails')) {
          db.createObjectStore('tails', { keyPath: 'reg' });
        }
      }
      if (e.oldVersion < 3) {
        if (!db.objectStoreNames.contains('markup')) {
          const markup = db.createObjectStore('markup', { keyPath: 'key' });
          markup.createIndex('byFile', 'fileId', { unique: false });
        }
      }
      if (e.oldVersion < 4) {
        if (!db.objectStoreNames.contains('scenarios')) {
          db.createObjectStore('scenarios', { keyPath: 'id' });
        }
      }
      if (e.oldVersion < 5) {
        // 3-D indexing: user-defined briefing types as a new dimension.
        if (!db.objectStoreNames.contains('briefingTypes')) {
          db.createObjectStore('briefingTypes', { keyPath: 'id' });
        }
        // Backfill every anchor with the new fields and a default kind so old
        // bookmarks keep working until the user upgrades them via the Indexer.
        const anchors = e.target.transaction.objectStore('anchors');
        if (!anchors.indexNames.contains('byKind')) {
          anchors.createIndex('byKind', 'kind', { unique: false });
        }
        const cur = anchors.openCursor();
        cur.onsuccess = (ev) => {
          const c = ev.target.result;
          if (!c) return;
          const a = c.value;
          let touched = false;
          if (a.kind === undefined) { a.kind = 'nav'; touched = true; }
          if (a.phases === undefined) { a.phases = []; touched = true; }
          if (a.briefingTypes === undefined) { a.briefingTypes = []; touched = true; }
          if (a.scenarios === undefined) { a.scenarios = []; touched = true; }
          if (a.placements !== undefined) { delete a.placements; touched = true; }
          if (touched) c.update(a);
          c.continue();
        };
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeNames, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(storeNames, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
    try {
      result = fn(t);
    } catch (err) {
      reject(err);
    }
  }));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putFile(file) {
  await tx('files', 'readwrite', (t) => t.objectStore('files').put(file));
}

export async function getFile(id) {
  return tx('files', 'readonly', (t) => reqToPromise(t.objectStore('files').get(id)));
}

export async function listFiles() {
  return tx('files', 'readonly', (t) => reqToPromise(t.objectStore('files').getAll()))
    .then((files) => files.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0)));
}

function deleteByIndex(store, indexName, key) {
  const cur = store.index(indexName).openCursor(IDBKeyRange.only(key));
  cur.onsuccess = (e) => {
    const c = e.target.result;
    if (c) { store.delete(c.primaryKey); c.continue(); }
  };
}

export async function deleteFile(id) {
  await tx(['files', 'pages', 'anchors', 'annotations', 'manuals', 'markup'], 'readwrite', (t) => {
    t.objectStore('files').delete(id);
    t.objectStore('manuals').delete(id);
    deleteByIndex(t.objectStore('pages'), 'byFile', id);
    deleteByIndex(t.objectStore('anchors'), 'byFile', id);
    deleteByIndex(t.objectStore('annotations'), 'byFile', id);
    deleteByIndex(t.objectStore('markup'), 'byFile', id);
  });
}

export async function putPages(pages) {
  await tx('pages', 'readwrite', (t) => {
    const store = t.objectStore('pages');
    for (const p of pages) store.put(p);
  });
}

export async function getPagesForFile(fileId) {
  return tx('pages', 'readonly', (t) => {
    const idx = t.objectStore('pages').index('byFile');
    return reqToPromise(idx.getAll(IDBKeyRange.only(fileId)));
  }).then((pages) => pages.sort((a, b) => a.pageNum - b.pageNum));
}

export async function getAllPages() {
  return tx('pages', 'readonly', (t) => reqToPromise(t.objectStore('pages').getAll()));
}

export async function setKV(key, value) {
  await tx('kv', 'readwrite', (t) => t.objectStore('kv').put({ key, value }));
}

export async function getKV(key) {
  const row = await tx('kv', 'readonly', (t) => reqToPromise(t.objectStore('kv').get(key)));
  return row ? row.value : undefined;
}

export async function getSummary(key) {
  const row = await tx('summaries', 'readonly', (t) => reqToPromise(t.objectStore('summaries').get(key)));
  return row ? row.value : undefined;
}

export async function setSummary(key, value) {
  await tx('summaries', 'readwrite', (t) => t.objectStore('summaries').put({ key, value }));
}

export async function clearSummaries() {
  await tx('summaries', 'readwrite', (t) => t.objectStore('summaries').clear());
}

export async function estimateStorage() {
  if (!navigator.storage || !navigator.storage.estimate) return null;
  return navigator.storage.estimate();
}

export async function requestPersistent() {
  if (navigator.storage && navigator.storage.persist) {
    try { return await navigator.storage.persist(); } catch { return false; }
  }
  return false;
}

// --- Anchors (content knowledge graph) ---

export async function putAnchors(anchors) {
  await tx('anchors', 'readwrite', (t) => {
    const store = t.objectStore('anchors');
    for (const a of anchors) store.put(a);
  });
}

export async function putAnchor(anchor) {
  await tx('anchors', 'readwrite', (t) => t.objectStore('anchors').put(anchor));
}

export async function deleteAnchor(anchorId) {
  await tx('anchors', 'readwrite', (t) => t.objectStore('anchors').delete(anchorId));
}

export async function getAnchorsForFile(fileId) {
  return tx('anchors', 'readonly', (t) => {
    const idx = t.objectStore('anchors').index('byFile');
    return reqToPromise(idx.getAll(IDBKeyRange.only(fileId)));
  });
}

export async function getAnchorsByType(manualType) {
  return tx('anchors', 'readonly', (t) => {
    const idx = t.objectStore('anchors').index('byManualType');
    return reqToPromise(idx.getAll(IDBKeyRange.only(manualType)));
  });
}

export async function getAllAnchors() {
  return tx('anchors', 'readonly', (t) => reqToPromise(t.objectStore('anchors').getAll()));
}

// --- Annotations (personal notes / images) ---

export async function putAnnotation(note) {
  await tx('annotations', 'readwrite', (t) => t.objectStore('annotations').put(note));
}

export async function deleteAnnotation(noteId) {
  await tx('annotations', 'readwrite', (t) => t.objectStore('annotations').delete(noteId));
}

export async function getAnnotationsForAnchor(anchorId) {
  return tx('annotations', 'readonly', (t) => {
    const idx = t.objectStore('annotations').index('byAnchor');
    return reqToPromise(idx.getAll(IDBKeyRange.only(anchorId)));
  });
}

export async function getAnnotationsForFile(fileId) {
  return tx('annotations', 'readonly', (t) => {
    const idx = t.objectStore('annotations').index('byFile');
    return reqToPromise(idx.getAll(IDBKeyRange.only(fileId)));
  });
}

export async function getAllAnnotations() {
  return tx('annotations', 'readonly', (t) => reqToPromise(t.objectStore('annotations').getAll()));
}

// --- Manuals (per-file manual metadata) ---

export async function putManual(manual) {
  await tx('manuals', 'readwrite', (t) => t.objectStore('manuals').put(manual));
}

export async function getManual(fileId) {
  return tx('manuals', 'readonly', (t) => reqToPromise(t.objectStore('manuals').get(fileId)));
}

export async function listManuals() {
  return tx('manuals', 'readonly', (t) => reqToPromise(t.objectStore('manuals').getAll()));
}

// --- Tails (aircraft registrations) ---

export async function putTail(tail) {
  await tx('tails', 'readwrite', (t) => t.objectStore('tails').put(tail));
}

export async function deleteTail(reg) {
  await tx('tails', 'readwrite', (t) => t.objectStore('tails').delete(reg));
}

export async function listTails() {
  return tx('tails', 'readonly', (t) => reqToPromise(t.objectStore('tails').getAll()));
}

// --- Markup (freehand annotations drawn on PDF pages) ---

export async function getMarkup(fileId, pageNum) {
  const row = await tx('markup', 'readonly', (t) =>
    reqToPromise(t.objectStore('markup').get(`${fileId}:${pageNum}`)));
  return row || null;
}

export async function putMarkup(record) {
  await tx('markup', 'readwrite', (t) => t.objectStore('markup').put(record));
}

export async function deleteMarkup(key) {
  await tx('markup', 'readwrite', (t) => t.objectStore('markup').delete(key));
}

export async function getMarkupForFile(fileId) {
  return tx('markup', 'readonly', (t) => {
    const idx = t.objectStore('markup').index('byFile');
    return reqToPromise(idx.getAll(IDBKeyRange.only(fileId)));
  });
}

// --- Scenarios (group bookmarks; assigned to phases of flight) ---

export async function putScenario(scenario) {
  await tx('scenarios', 'readwrite', (t) => t.objectStore('scenarios').put(scenario));
}

export async function getScenario(id) {
  return tx('scenarios', 'readonly', (t) => reqToPromise(t.objectStore('scenarios').get(id)));
}

export async function listScenarios() {
  return tx('scenarios', 'readonly', (t) => reqToPromise(t.objectStore('scenarios').getAll()));
}

export async function deleteScenario(id) {
  await tx('scenarios', 'readwrite', (t) => t.objectStore('scenarios').delete(id));
}

// --- Briefing types (user-defined dimension #2: e.g. Normal Ops, Legal…) ---

export async function putBriefingType(bt) {
  await tx('briefingTypes', 'readwrite', (t) => t.objectStore('briefingTypes').put(bt));
}

export async function listBriefingTypes() {
  return tx('briefingTypes', 'readonly', (t) => reqToPromise(t.objectStore('briefingTypes').getAll()));
}

export async function deleteBriefingType(id) {
  await tx('briefingTypes', 'readwrite', (t) => t.objectStore('briefingTypes').delete(id));
}

// --- Anchor extensions for 3-D indexing ---

export async function getAnchorsByKind(kind) {
  return tx('anchors', 'readonly', (t) => {
    const idx = t.objectStore('anchors').index('byKind');
    return reqToPromise(idx.getAll(IDBKeyRange.only(kind)));
  });
}

export async function bulkPutAnchors(anchors) {
  await tx('anchors', 'readwrite', (t) => {
    const store = t.objectStore('anchors');
    for (const a of anchors) store.put(a);
  });
}
