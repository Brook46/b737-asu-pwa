// cdu-view.js — the CDU you can type on: a floating, draggable unit with the
// 14 × 24 screen, six line select keys each side, the function / mode keys,
// alpha and numeric keys, EXEC with its light, and the MSG / OFST lights.
// A physical keyboard works while it is open (letters, digits, / . space,
// Backspace = CLR, Delete = DEL, Enter = EXEC, PgUp / PgDn = PREV / NEXT).

const FN = [
  ['INIT REF', 'RTE', 'CLB', 'CRZ', 'DES'],
  ['MENU', 'LEGS', 'DEP ARR', 'HOLD', 'PROG'],
  ['N1 LIMIT', 'FIX', 'PREV PAGE', 'NEXT PAGE'],
];
const ALPHA = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').concat(['SP', 'DEL', '/', 'CLR']);
const NUM = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '+/-'];

export function createCDUView(cdu, fmc, { onKey } = {}) {
  const el = document.createElement('div');
  el.className = 'cdu';
  el.hidden = true;
  el.innerHTML = `
    <div class="cdu-head"><span>CDU · FMC</span><span class="cdu-note">study FMC — not for operational use</span><button class="cdu-x" aria-label="Close">✕</button></div>
    <div class="cdu-mid">
      <div class="cdu-lsk L"></div>
      <div class="cdu-scr" role="img" aria-label="CDU screen"></div>
      <div class="cdu-lsk R"></div>
    </div>
    <div class="cdu-keys">
      <div class="cdu-fn"></div>
      <div class="cdu-pad"><div class="cdu-num"></div><div class="cdu-alpha"></div></div>
    </div>`;
  document.body.append(el);
  const scr = el.querySelector('.cdu-scr');
  const rows = [];
  for (let r = 0; r < 14; r++) { const d = document.createElement('div'); d.className = 'cdu-row'; scr.append(d); rows.push(d); }
  const press = (k) => { cdu.key(k); onKey?.(k); render(); };
  const btn = (label, cls, k = label) => {
    const b = document.createElement('button');
    b.className = 'cdu-k ' + cls;
    b.textContent = label;
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); press(k); });
    return b;
  };
  for (const side of ['L', 'R']) {
    const col = el.querySelector(`.cdu-lsk.${side}`);
    for (let i = 1; i <= 6; i++) col.append(btn('', 'lsk', `${side}${i}`));
  }
  const fn = el.querySelector('.cdu-fn');
  FN.forEach((row, ri) => {
    const r = document.createElement('div'); r.className = 'cdu-fnrow';
    for (const k of row) r.append(btn(k, 'fn'));
    if (ri === 1) {
      const ex = btn('EXEC', 'fn exec');
      ex.innerHTML = '<i></i>EXEC';
      r.append(ex);
    }
    fn.append(r);
  });
  const num = el.querySelector('.cdu-num'), alpha = el.querySelector('.cdu-alpha');
  for (const k of NUM) num.append(btn(k, 'num'));
  for (const k of ALPHA) alpha.append(btn(k, 'al' + (k.length > 1 && k !== '/' ? ' sm' : '')));
  const lights = document.createElement('div');
  lights.className = 'cdu-lights';
  lights.innerHTML = '<span data-l="msg">MSG</span><span data-l="ofst">OFST</span><span data-l="dspy">DSPY</span><span data-l="fail">FAIL</span>';
  el.querySelector('.cdu-keys').prepend(lights);

  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  function render() {
    if (el.hidden) return;
    const g = cdu.render();
    g.forEach((row, r) => {
      let html = '', run = '', cls = null;
      const flush = () => { if (run) html += `<span class="${cls}">${esc(run)}</span>`; run = ''; };
      for (const c of row) {
        const k = `c-${c.c}${c.sm ? ' sm' : ''}`;
        if (k !== cls) { flush(); cls = k; }
        run += c.ch;
      }
      flush();
      rows[r].innerHTML = html;
    });
    el.querySelector('.exec').classList.toggle('lit', fmc.execLit);
    el.querySelector('[data-l="msg"]').classList.toggle('lit', !!fmc.S.msg);
  }

  // Drag by the header.
  const head = el.querySelector('.cdu-head');
  let drag = null;
  head.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = el.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    head.setPointerCapture(e.pointerId);
  });
  head.addEventListener('pointermove', (e) => {
    if (!drag) return;
    el.style.left = `${Math.max(0, Math.min(innerWidth - 60, e.clientX - drag.dx))}px`;
    el.style.top = `${Math.max(0, Math.min(innerHeight - 40, e.clientY - drag.dy))}px`;
    el.style.right = 'auto'; el.style.bottom = 'auto';
  });
  head.addEventListener('pointerup', () => { drag = null; });
  el.querySelector('.cdu-x').addEventListener('click', () => hide());

  // Physical keyboard while open.
  window.addEventListener('keydown', (e) => {
    if (el.hidden || e.metaKey || e.ctrlKey || e.altKey || e.target.closest?.('input, textarea')) return;
    const k = e.key;
    let key = null;
    if (/^[a-zA-Z0-9]$/.test(k)) key = k.toUpperCase();
    else if (k === '/' || k === '.') key = k;
    else if (k === ' ') key = 'SP';
    else if (k === '-') key = '+/-';
    else if (k === 'Backspace') key = 'CLR';
    else if (k === 'Delete') key = 'DEL';
    else if (k === 'Enter') key = 'EXEC';
    else if (k === 'PageUp') key = 'PREV PAGE';
    else if (k === 'PageDown') key = 'NEXT PAGE';
    if (!key) return;
    e.preventDefault(); e.stopPropagation();
    press(key);
  }, true);

  let timer = 0;
  function show() { el.hidden = false; render(); clearInterval(timer); timer = setInterval(render, 500); }
  function hide() { el.hidden = true; clearInterval(timer); }
  return { show, hide, toggle() { if (el.hidden) show(); else hide(); }, render, get open() { return !el.hidden; } };
}
