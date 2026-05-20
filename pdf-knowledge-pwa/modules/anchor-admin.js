// Anchor admin panel — the manual-override surface for the knowledge graph.
// Auto-extraction is imperfect, so this lets the user review every anchor
// (with its confidence), correct the value/title/page, delete bad anchors and
// add ones the heuristics missed.

import * as storage from './storage.js';
import * as kg from './knowledge-graph.js';
import { anchorTypeFor, anchorTypeLabel, manualLabel } from './manuals.js';
import { escapeHtml } from './ui.js';

function makeAnchorId(fileId, anchorType, value) {
  return `${fileId}:${anchorType}:${String(value).trim().toUpperCase()}`;
}

function confidenceClass(c) {
  if (c == null) return 'conf-manual';
  if (c >= 0.75) return 'conf-high';
  if (c >= 0.55) return 'conf-mid';
  return 'conf-low';
}

/**
 * Render the anchor admin UI for one file into `container`.
 * @param {HTMLElement} container
 * @param {object} file    file record {id, name, numPages}
 * @param {object} manual  manuals-store record {fileId, manualType, ...}
 * @param {object} opts    { onChanged }
 */
export async function renderAnchorAdmin(container, file, manual, opts = {}) {
  const onChanged = opts.onChanged || (() => {});
  const manualType = manual ? manual.manualType : 'FCOM';
  const anchorType = anchorTypeFor(manualType);
  const numPages = file.numPages || 9999;

  async function refresh() {
    const anchors = (await storage.getAnchorsForFile(file.id))
      .sort((a, b) => a.pageNum - b.pageNum || String(a.value).localeCompare(String(b.value)));
    paint(anchors);
  }

  function paint(anchors) {
    const low = anchors.filter((a) => (a.confidence ?? 1) < 0.55).length;
    container.innerHTML = `
      <div class="admin-head">
        <div>
          <strong>${escapeHtml(file.name)}</strong>
          <div class="admin-sub">${escapeHtml(manualLabel(manualType))} · anchor type: ${escapeHtml(anchorTypeLabel(anchorType))}</div>
        </div>
        <span class="admin-count">${anchors.length} anchor(s)${low ? ` · ${low} low-confidence` : ''}</span>
      </div>
      <form class="anchor-add" autocomplete="off">
        <input name="value" placeholder="${anchorType === 'ata' ? '21-44' : anchorType === 'nnc' ? 'NNC title' : '13.20.3'}" required />
        <input name="title" placeholder="Title / description" />
        <input name="pageNum" type="number" min="1" max="${numPages}" placeholder="Page" required />
        <button class="btn primary" type="submit">Add anchor</button>
      </form>
      <ul class="anchor-list">
        ${anchors.length ? anchors.map(rowHtml).join('') : '<li class="empty">No anchors yet — auto-extraction found nothing, add them manually.</li>'}
      </ul>`;

    container.querySelector('.anchor-add').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const value = String(fd.get('value') || '').trim();
      const pageNum = parseInt(fd.get('pageNum'), 10);
      if (!value || !Number.isFinite(pageNum)) return;
      await saveAnchor({
        anchorId: makeAnchorId(file.id, anchorType, value),
        fileId: file.id, manualType, anchorType,
        value, title: String(fd.get('title') || '').trim(),
        pageNum, source: 'manual', confidence: null,
      });
    });

    container.querySelectorAll('.anchor-list li[data-id]').forEach((li) => {
      const id = li.getAttribute('data-id');
      const anchor = anchors.find((a) => a.anchorId === id);
      li.querySelector('[data-act="save"]').addEventListener('click', async () => {
        const value = li.querySelector('[data-f="value"]').value.trim();
        const title = li.querySelector('[data-f="title"]').value.trim();
        const pageNum = parseInt(li.querySelector('[data-f="pageNum"]').value, 10);
        if (!value || !Number.isFinite(pageNum)) return;
        const newId = makeAnchorId(file.id, anchorType, value);
        if (newId !== id) await storage.deleteAnchor(id);
        await saveAnchor({
          ...anchor, anchorId: newId, value, title, pageNum,
          source: 'manual', confidence: null,
        });
      });
      li.querySelector('[data-act="del"]').addEventListener('click', async () => {
        await storage.deleteAnchor(id);
        kg.invalidate();
        onChanged();
        refresh();
      });
    });
  }

  function rowHtml(a) {
    const conf = a.confidence == null
      ? '<span class="conf conf-manual">manual</span>'
      : `<span class="conf ${confidenceClass(a.confidence)}">${Math.round(a.confidence * 100)}%</span>`;
    return `
      <li data-id="${escapeHtml(a.anchorId)}">
        <input class="anchor-f" data-f="value" value="${escapeHtml(a.value)}" />
        <input class="anchor-f grow" data-f="title" value="${escapeHtml(a.title || '')}" placeholder="(no title)" />
        <input class="anchor-f num" data-f="pageNum" type="number" min="1" value="${a.pageNum}" />
        ${conf}
        <button class="btn ghost" data-act="save" title="Save">Save</button>
        <button class="btn ghost danger" data-act="del" title="Delete">✕</button>
      </li>`;
  }

  async function saveAnchor(anchor) {
    await storage.putAnchor(anchor);
    kg.invalidate();
    onChanged();
    refresh();
  }

  await refresh();
}
