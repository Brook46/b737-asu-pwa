// checklist.js — collapsible sections with auto-collapse when 100% ticked.

import * as storage from './storage.js';

let editMode = false;

// Manual collapse overrides (per section id). Tri-state:
//   true   → user-forced collapsed
//   false  → user-forced expanded
//   undef  → automatic (collapsed iff all items done)
const manualCollapse = new Map();

export function setEditMode(on) {
  editMode = !!on;
  // Edit mode forces all sections expanded for visibility
  if (on) manualCollapse.clear();
}
export function isEditMode() { return editMode; }

function sectionAllDone(sec, ticks) {
  return sec.items.length > 0 && sec.items.every(i => !!ticks[i.id]);
}

function isCollapsed(sec, ticks) {
  if (editMode) return false;
  if (manualCollapse.has(sec.id)) return manualCollapse.get(sec.id);
  return sectionAllDone(sec, ticks);
}

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
  template.sections.forEach((sec) => {
    const total = sec.items.length;
    const done  = sec.items.filter(i => !!ticks[i.id]).length;
    const allDone = sectionAllDone(sec, ticks);
    const collapsed = isCollapsed(sec, ticks);

    const cls = ['cl-section'];
    if (collapsed) cls.push('collapsed');
    if (allDone)   cls.push('all-done');

    parts.push(`<div class="${cls.join(' ')}" data-section="${sec.id}">`);

    if (editMode) {
      parts.push(`<div class="cl-section-head edit">
        <input class="rename" data-rename-section="${sec.id}" value="${escape(sec.name)}" />
        <button class="btn ghost-btn" data-move-section="${sec.id}" data-delta="-1" aria-label="Up">▲</button>
        <button class="btn ghost-btn" data-move-section="${sec.id}" data-delta="1"  aria-label="Down">▼</button>
        <button class="btn ghost-btn" data-del-section="${sec.id}" aria-label="Delete" style="color:var(--danger)">✕</button>
      </div>`);
    } else {
      parts.push(`<button class="cl-section-head" data-toggle-section="${sec.id}">
        <span class="cl-section-mark">${allDone ? '✓' : ''}</span>
        <span class="cl-section-name">${escape(sec.name)}</span>
        <span class="cl-progress">${done}/${total}</span>
        <span class="chev">${collapsed ? '▸' : '▾'}</span>
      </button>`);
    }

    parts.push(`<div class="cl-items">`);
    sec.items.forEach((it) => {
      const done = !!ticks[it.id];
      const note = notes[it.id];
      const cls2 = ['cl-item'];
      if (done && !editMode) cls2.push('done');
      parts.push(`<div class="${cls2.join(' ')}" data-item="${it.id}">`);
      if (editMode) {
        parts.push(`
          <input class="rename" data-rename-item="${it.id}" value="${escape(it.label)}" />
          <button class="btn ghost-btn" data-move-item="${it.id}" data-section="${sec.id}" data-delta="-1" aria-label="Up">▲</button>
          <button class="btn ghost-btn" data-move-item="${it.id}" data-section="${sec.id}" data-delta="1"  aria-label="Down">▼</button>
          <button class="del" data-del-item="${it.id}" aria-label="Delete">✕</button>
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
    parts.push(`</div>`); // .cl-items

    if (editMode) {
      parts.push(`<div class="cl-add">
        <input data-add-item="${sec.id}" placeholder="Add item to ${escape(sec.name)}" />
        <button class="btn primary" data-add-item-btn="${sec.id}">＋</button>
      </div>`);
    }

    parts.push(`</div>`); // .cl-section
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
  // Section header toggle (non-edit mode)
  root.querySelectorAll('[data-toggle-section]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.toggleSection;
      const sec = storage.getTemplate().sections.find(s => s.id === id);
      const ticks = storage.getCurrent().ticks;
      const autoCollapsed = sectionAllDone(sec, ticks);
      const current = isCollapsed(sec, ticks);
      // Toggle to opposite, store as manual override (or clear if it matches auto)
      const next = !current;
      if (next === autoCollapsed) manualCollapse.delete(id);
      else manualCollapse.set(id, next);
      render(root);
    });
  });

  // Item tap → toggle, with auto-collapse logic
  root.querySelectorAll('.cl-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (editMode) return;
      if (e.target.closest('button, input')) return;
      const id = el.dataset.item;
      const current = storage.getCurrent();
      const on = !current.ticks[id];
      storage.setTick(id, on);

      // If section now 100% done, clear any manual-expanded override so
      // the auto-collapse takes effect on next render.
      const sec = sectionFor(id);
      if (sec && sectionAllDone(sec, storage.getCurrent().ticks)) {
        manualCollapse.delete(sec.id);
      }
      // If user unticked an item, clear any manual-collapse override so
      // the section re-expands automatically.
      if (!on && sec) manualCollapse.delete(sec.id);

      render(root);
    });

    // Long-press to add/edit note (non-edit mode)
    let pressT = null;
    el.addEventListener('touchstart', () => {
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

function sectionFor(itemId) {
  const t = storage.getTemplate();
  for (const sec of t.sections) {
    if (sec.items.some(i => i.id === itemId)) return sec;
  }
  return null;
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

// Called externally on New Flight to reset overrides
export function resetOverrides() {
  manualCollapse.clear();
}
