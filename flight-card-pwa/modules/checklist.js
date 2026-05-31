// checklist.js — render template + ticks, handle toggle / edit mode.

import * as storage from './storage.js';

let editMode = false;

export function setEditMode(on) {
  editMode = !!on;
}
export function isEditMode() { return editMode; }

export function render(root) {
  const template = storage.getTemplate();
  const current = storage.getCurrent();
  const ticks = current.ticks || {};
  const notes = current.notes || {};

  if (!template.sections.length) {
    root.innerHTML = `<p class="muted small" style="text-align:center; padding: 14px;">
      No sections. Tap ✎ to edit, then add some.</p>`;
    return;
  }

  const parts = [];
  template.sections.forEach((sec, sIdx) => {
    const total = sec.items.length;
    const done  = sec.items.filter(i => !!ticks[i.id]).length;
    const progress = total > 0 ? `${done}/${total}` : '';

    parts.push(`<div class="cl-section" data-section="${sec.id}">`);
    parts.push(`<div class="cl-section-head">`);
    if (editMode) {
      parts.push(`
        <input class="rename" data-rename-section="${sec.id}" value="${escape(sec.name)}" />
        <button class="btn ghost-btn" data-move-section="${sec.id}" data-delta="-1" aria-label="Move section up">▲</button>
        <button class="btn ghost-btn" data-move-section="${sec.id}" data-delta="1"  aria-label="Move section down">▼</button>
        <button class="btn ghost-btn" data-del-section="${sec.id}" aria-label="Delete section" style="color:var(--danger)">✕</button>
      `);
    } else {
      parts.push(`<span class="cl-section-name">${escape(sec.name)}</span>`);
      parts.push(`<span class="cl-progress">${progress}</span>`);
    }
    parts.push(`</div>`);

    sec.items.forEach((it) => {
      const done = !!ticks[it.id];
      const note = notes[it.id];
      const cls = ['cl-item'];
      if (done && !editMode) cls.push('done');
      parts.push(`<div class="${cls.join(' ')}" data-item="${it.id}">`);
      if (editMode) {
        parts.push(`
          <div class="item-edit-row">
            <input class="rename" data-rename-item="${it.id}" value="${escape(it.label)}" />
          </div>
          <button class="btn ghost-btn" data-move-item="${it.id}" data-section="${sec.id}" data-delta="-1" aria-label="Move up">▲</button>
          <button class="btn ghost-btn" data-move-item="${it.id}" data-section="${sec.id}" data-delta="1"  aria-label="Move down">▼</button>
          <button class="del" data-del-item="${it.id}" aria-label="Delete item">✕</button>
        `);
      } else {
        parts.push(`<span class="box" aria-hidden="true"></span>`);
        parts.push(`<div class="item-edit-row">
          <span class="label">${escape(it.label)}</span>
          ${note ? `<span class="item-note">${escape(note)}</span>` : ''}
        </div>`);
      }
      parts.push(`</div>`);
    });

    if (editMode) {
      parts.push(`<div class="cl-add">
        <input data-add-item="${sec.id}" placeholder="Add item to ${escape(sec.name)}" />
        <button class="btn primary" data-add-item-btn="${sec.id}">＋</button>
      </div>`);
    }

    parts.push(`</div>`);
  });

  if (editMode) {
    parts.push(`<div class="cl-section-add cl-add">
      <input id="add-section-input" placeholder="Add new section…" />
      <button class="btn primary" id="add-section-btn">＋</button>
    </div>`);
  }

  root.innerHTML = parts.join('');
  wire(root);
}

function wire(root) {
  // Toggle items
  root.querySelectorAll('.cl-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (editMode) return;
      // Don't trigger on long-press buttons
      if (e.target.closest('button, input')) return;
      const id = el.dataset.item;
      const current = storage.getCurrent();
      const on = !current.ticks[id];
      storage.setTick(id, on);
      el.classList.toggle('done', on);
      // Update progress label live
      const sec = el.closest('.cl-section');
      const head = sec?.querySelector('.cl-progress');
      if (head) {
        const total = sec.querySelectorAll('.cl-item').length;
        const done  = sec.querySelectorAll('.cl-item.done').length;
        head.textContent = `${done}/${total}`;
      }
    });
    // Long-press to add/edit note (non-edit mode)
    let pressT = null;
    el.addEventListener('touchstart', (e) => {
      if (editMode) return;
      pressT = setTimeout(() => {
        pressT = null;
        promptNote(el.dataset.item, root);
      }, 600);
    }, { passive: true });
    el.addEventListener('touchend', () => { if (pressT) clearTimeout(pressT); pressT = null; });
    el.addEventListener('touchmove', () => { if (pressT) clearTimeout(pressT); pressT = null; });
  });

  // Edit-mode handlers
  root.querySelectorAll('input[data-rename-section]').forEach(inp => {
    inp.addEventListener('change', () => storage.renameSection(inp.dataset.renameSection, inp.value.trim()));
  });
  root.querySelectorAll('input[data-rename-item]').forEach(inp => {
    inp.addEventListener('change', () => storage.renameItem(inp.dataset.renameItem, inp.value.trim()));
  });
  root.querySelectorAll('[data-del-section]').forEach(b => {
    b.addEventListener('click', () => {
      if (!confirm('Delete this section and all its items?')) return;
      storage.deleteSection(b.dataset.delSection);
      render(root);
    });
  });
  root.querySelectorAll('[data-del-item]').forEach(b => {
    b.addEventListener('click', () => {
      storage.deleteItem(b.dataset.delItem);
      render(root);
    });
  });
  root.querySelectorAll('[data-move-section]').forEach(b => {
    b.addEventListener('click', () => {
      storage.moveSection(b.dataset.moveSection, parseInt(b.dataset.delta, 10));
      render(root);
    });
  });
  root.querySelectorAll('[data-move-item]').forEach(b => {
    b.addEventListener('click', () => {
      storage.moveItem(b.dataset.section, b.dataset.moveItem, parseInt(b.dataset.delta, 10));
      render(root);
    });
  });
  root.querySelectorAll('[data-add-item-btn]').forEach(b => {
    b.addEventListener('click', () => {
      const sid = b.dataset.addItemBtn;
      const inp = root.querySelector(`input[data-add-item="${sid}"]`);
      const v = (inp?.value || '').trim();
      if (!v) return;
      storage.addItem(sid, v);
      render(root);
    });
  });
  root.querySelectorAll('input[data-add-item]').forEach(inp => {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const v = inp.value.trim();
        if (!v) return;
        storage.addItem(inp.dataset.addItem, v);
        render(root);
      }
    });
  });
  const addSecBtn = root.querySelector('#add-section-btn');
  const addSecInp = root.querySelector('#add-section-input');
  if (addSecBtn && addSecInp) {
    const submit = () => {
      const v = addSecInp.value.trim();
      if (!v) return;
      storage.addSection(v);
      render(root);
    };
    addSecBtn.addEventListener('click', submit);
    addSecInp.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  }
}

function promptNote(itemId, root) {
  const cur = storage.getCurrent().notes[itemId] || '';
  const v = prompt('Note for this item (empty to clear):', cur);
  if (v === null) return;
  storage.setNote(itemId, v);
  render(root);
}

function escape(s) {
  return String(s).replace(/[&<>"']/g, ch => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  })[ch]);
}
