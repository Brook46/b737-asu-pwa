// media.js — pictures in notes (screenshots, photos, PDF pages), kept in
// IndexedDB: the main store lives in localStorage, whose ~5 MB would fill
// with a handful of screenshots. A note holds <img data-media="id">; the
// picture is looked up here when the note is shown. Backups carry them.

const DB = 'fc-media', STORE = 'img';
function open() {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function tx(mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(STORE, mode), st = t.objectStore(STORE);
    const req = fn(st);
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  });
}
export async function put(blob) {
  const id = 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await tx('readwrite', st => st.put(blob, id));
  return id;
}
export function get(id) { return tx('readonly', st => st.get(id)); }
export function del(id) { return tx('readwrite', st => st.delete(id)); }
export async function keys() { return (await tx('readonly', st => st.getAllKeys())) || []; }

// Blob URLs, made once per picture per session.
const urls = new Map();
export async function urlOf(id) {
  if (urls.has(id)) return urls.get(id);
  const b = await get(id).catch(() => null);
  if (!b) return '';
  const u = URL.createObjectURL(b);
  urls.set(id, u);
  return u;
}
// Fill in every <img data-media> under `el`.
export async function hydrate(el) {
  for (const img of el.querySelectorAll('img[data-media]')) {
    if (img.getAttribute('src')) continue;
    const u = await urlOf(img.dataset.media);
    if (u) img.src = u; else img.classList.add('is-missing');
  }
}

// A picture made small enough to keep: the long side at most `max` px, JPEG
// (PNG kept for small screenshots with few colours would bloat; JPEG 0.82 is
// sharp for text at this size).
export async function shrink(blob, max = 1800) {
  const bmp = await createImageBitmap(blob).catch(() => null);
  if (!bmp) return blob;
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext('2d');
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(b => res(b || blob), 'image/jpeg', 0.82));
}
// A PDF's pages as pictures (pdf.js, loaded only when needed). `onPage`
// reports progress.
export async function pdfPages(file, { maxPages = 30, width = 1600, onPage = () => {} } = {}) {
  const base = new URL('../vendor/pdfjs/', import.meta.url).href;
  const pdfjs = await import(base + 'pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.mjs';
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out = [], n = Math.min(doc.numPages, maxPages);
  for (let i = 1; i <= n; i++) {
    const page = await doc.getPage(i);
    const v0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: width / v0.width });
    const c = document.createElement('canvas');
    c.width = Math.round(vp.width); c.height = Math.round(vp.height);
    const g = c.getContext('2d');
    g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    out.push(await new Promise(res => c.toBlob(res, 'image/jpeg', 0.82)));
    onPage(i, n);
  }
  return { pages: out, total: doc.numPages };
}

// ---- Backup ----
const toB64 = (blob) => new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob); });
// The pictures the notes use, as data URLs.
export async function exportUsed(ids) {
  const out = {};
  for (const id of ids) { const b = await get(id).catch(() => null); if (b) out[id] = await toB64(b); }
  return out;
}
export async function importAll(map) {
  let n = 0;
  for (const [id, data] of Object.entries(map || {})) {
    if (!/^data:image\//.test(data)) continue;
    const blob = await (await fetch(data)).blob();
    await tx('readwrite', st => st.put(blob, id));
    n++;
  }
  return n;
}
