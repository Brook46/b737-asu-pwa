// Draggable global "Scratchpad" — a floating notes window for quick jottings
// during any flight phase. Position, text and open/closed state persist to the
// kv store so it survives reloads and works offline.

import { getKV, setKV } from './storage.js?v=5';

const POS_KEY = 'scratchpad-pos';
const TEXT_KEY = 'scratchpad-text';
const OPEN_KEY = 'scratchpad-open';

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Wire up the scratchpad element.
 * @param {HTMLElement} el        the floating window root
 * @param {object} parts { handle, textarea, closeBtn, toggleBtn }
 */
export async function initScratchpad(el, { handle, textarea, closeBtn, toggleBtn }) {
  const pos = await getKV(POS_KEY);
  if (pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)) {
    el.style.left = clamp(pos.x, 0, window.innerWidth - 80) + 'px';
    el.style.top = clamp(pos.y, 0, window.innerHeight - 80) + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  }
  const savedText = await getKV(TEXT_KEY);
  if (savedText) textarea.value = savedText;

  function setOpen(open) {
    el.classList.toggle('hidden', !open);
    if (toggleBtn) toggleBtn.setAttribute('aria-pressed', open ? 'true' : 'false');
    setKV(OPEN_KEY, open);
  }

  setOpen(!!(await getKV(OPEN_KEY)));

  let saveTimer = null;
  textarea.addEventListener('input', () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => setKV(TEXT_KEY, textarea.value), 400);
  });

  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => setOpen(el.classList.contains('hidden')));
  }
  if (closeBtn) closeBtn.addEventListener('click', () => setOpen(false));

  // Pointer-drag via the title bar.
  let dragging = false, offX = 0, offY = 0;
  handle.addEventListener('pointerdown', (e) => {
    dragging = true;
    const r = el.getBoundingClientRect();
    offX = e.clientX - r.left;
    offY = e.clientY - r.top;
    handle.setPointerCapture(e.pointerId);
    el.classList.add('dragging');
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const x = clamp(e.clientX - offX, 0, window.innerWidth - el.offsetWidth);
    const y = clamp(e.clientY - offY, 0, window.innerHeight - el.offsetHeight);
    el.style.left = x + 'px';
    el.style.top = y + 'px';
    el.style.right = 'auto';
    el.style.bottom = 'auto';
  });
  function endDrag(e) {
    if (!dragging) return;
    dragging = false;
    el.classList.remove('dragging');
    try { handle.releasePointerCapture(e.pointerId); } catch {}
    setKV(POS_KEY, { x: el.offsetLeft, y: el.offsetTop });
  }
  handle.addEventListener('pointerup', endDrag);
  handle.addEventListener('pointercancel', endDrag);

  return { setOpen };
}
