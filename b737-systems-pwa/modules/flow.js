// flow.js — the flight sequence (FLOW): stage by stage through the normal
// procedures (flow-data.js), on the airplane's own panels.
//
// The page (a sheet, key 'flow') lists the stages and their steps. A step
// with switch positions is done when the airplane is in that state — so the
// list ticks itself as you fly the flow; checks and verifies are ticked by
// hand. The player is a pop-up that walks the steps one by one, showing the
// live panel with the control ringed: operate it there yourself (Do it), or
// let the app do it (Watch / Play). Each stage ends with its QRH checklist.

import { STAGES, COMING } from './flow-data.js?v=64';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const md = (s) => esc(s).replace(/"([^"]+)"/g, '<b>"$1"</b>');
const WHO_CLS = { C: 'c', 'F/O': 'fo' };

/**
 * host: { ensureCockpit(), ctxFor(id), stateOf(id), refresh(), setLive(on) }
 */
export function createFlow(sheet, host) {
  let stageId = STAGES[0].id;
  let mode = 'watch';                       // 'watch' | 'do'
  const ticked = new Set();                 // `${stage}:${i}` checks / verifies, `${stage}:cl:${i}` checklist
  const stage = () => STAGES.find((s) => s.id === stageId);

  // ── Switch positions: labels → state values through the panel's control ──
  const controlOf = (sys, key, panel) => {
    const c = host.ensureCockpit();
    const sets = [sys, ...[...c.panelSets.keys()].filter((k) => k !== sys)];
    for (const s of sets) {
      const ps = c.panelSets.get(s)?.panels || [];
      const order = panel ? [...ps.filter((p) => p.title === panel), ...ps.filter((p) => p.title !== panel)] : ps;
      for (const p of order) { const ct = p.controls.find((x) => x.key === key); if (ct) return { ct, P: p }; }
    }
    return null;
  };
  const valueOf = (sys, key, pos, panel) => {
    if (typeof pos === 'number') return pos;
    const r = controlOf(sys, key, panel);
    const i = r?.ct.positions?.indexOf(pos);
    return i >= 0 ? i : null;
  };
  const q = {
    sw: (sys, key) => host.stateOf(sys)?.sw?.[key],
    mem: (sys) => host.stateOf(sys)?.mem || {},
  };
  /** true / false for a step the app can check; null for a hand-ticked one. */
  function isDone(st) {
    if (st.done) return !!st.done(q);
    if (st.set) return st.set.every(([sys, key, pos]) => q.sw(sys, key) === valueOf(sys, key, pos, st.p?.[1]));
    return null;
  }
  const stepDone = (s, i) => { const st = s.steps[i], d = isDone(st); return d == null ? ticked.has(`${s.id}:${i}`) : d; };

  /** Watch: the app moves the switches (and presses the spring-loaded ones). */
  function doStep(st) {
    for (const [sys, key, pos] of st.set || []) { const v = valueOf(sys, key, pos, st.p?.[1]); if (v != null) host.ctxFor(sys).sw[key] = v; }
    for (const [sys, key, label] of [...(st.act ? [st.act] : []), ...(st.acts || [])]) host.ctxFor(sys).action(key, label);
    host.refresh();
  }
  /** Do it: put every switch this stage moves somewhere else first, so there is something to do. */
  function coldStart(s) {
    for (const st of s.steps) for (const [sys, key, pos] of st.set || []) {
      const v = valueOf(sys, key, pos, st.p?.[1]);
      const r = controlOf(sys, key, st.p?.[1]);
      const n = r?.ct.positions?.length || 2;
      if (v == null) continue;
      const other = [...Array(n).keys()].find((k) => k !== v && r?.ct.positions?.[k] && r.ct.positions[k] !== '·');
      if (other != null) host.ctxFor(sys).sw[key] = other;
    }
    for (let i = 0; i < s.steps.length; i++) ticked.delete(`${s.id}:${i}`);
    host.refresh();
  }

  // ── The page ──
  function html() {
    const s = stage();
    const n = s.steps.length, d = s.steps.filter((_, i) => stepDone(s, i)).length;
    const row = (st, i) => {
      const done = stepDone(s, i), auto = isDone(st) != null;
      return `<li class="fl-step${done ? ' done' : ''}">
        <button class="fl-box" ${auto ? `data-fl-play="${i}" title="Set by the switches — open the step"` : `data-fl-tick="${i}" title="Tick"`}>${done ? '✓' : ''}</button>
        <button class="fl-main" data-fl-play="${i}"><span class="fl-who ${WHO_CLS[st.who] || 'both'}">${esc(st.who)}</span><span class="fl-t">${esc(st.t)}</span><span class="fl-a">${md(st.a)}</span>${st.p ? '<span class="fl-eye" aria-hidden="true">◎</span>' : ''}</button></li>`;
    };
    const cl = s.checklist ? `<section class="fl-cl"><div class="fl-clh"><b>${esc(s.checklist.t)}</b> checklist <span class="qr-ref">${esc(s.checklist.ref)}</span></div>
      <div class="fl-clr">Call: ${esc(s.checklist.call)} · Read: ${esc(s.checklist.read)} · Respond: ${esc(s.checklist.respond)}</div>
      <ol class="qr-steps fl-cli">${s.checklist.items.map(([a, b], i) => `<li class="${ticked.has(`${s.id}:cl:${i}`) ? 'done' : ''}"><button class="fl-clb" data-fl-cl="${i}"><span class="qr-a">${esc(a)}</span><span class="qr-dots"></span><span class="qr-b">${esc(b)}</span></button></li>`).join('')}</ol></section>` : '';
    return `<div class="qr fl no-hl">
      <div class="kicker">FLIGHT SEQUENCE · FCOM NP.21 · QRH NC</div>
      <h2>Flow</h2>
      <div class="fl-stages">${STAGES.map((x, k) => `<button class="tag tag-btn${x.id === stageId ? ' on' : ''}" data-fl-stage="${x.id}">${k + 1} ${esc(x.t)}</button>`).join('')}${COMING.map(([t]) => `<span class="tag fl-soon" title="Coming next">${esc(t)}</span>`).join('')}</div>
      <div class="fl-head"><div><b>${esc(s.t)}</b> <span class="qr-ref">${esc(s.ref)}</span><div class="fl-intro">${esc(s.intro)}</div></div>
        <div class="fl-prog"><span>${d} / ${n}</span><span class="fl-bar"><i style="width:${(100 * d) / n}%"></i></span></div></div>
      <div class="fl-modes"><span class="seg"><button class="tag tag-btn${mode === 'watch' ? ' on' : ''}" data-fl-mode="watch">Watch</button><button class="tag tag-btn${mode === 'do' ? ' on' : ''}" data-fl-mode="do">Do it</button></span>
        <button class="tag tag-btn fl-go" data-fl-play="0">▶ ${mode === 'watch' ? 'Walk me through' : 'Start the flow'}</button>
        ${mode === 'do' ? '<button class="tag tag-btn" data-fl-cold title="Move this stage\'s switches out of position, so you set them">Cold cockpit for this stage</button>' : ''}</div>
      <p class="fl-hint">${mode === 'watch' ? 'Each step shows its panel with the control ringed; "Do it for me" sets it. Play runs the stage.' : 'Operate the ringed control on the panel yourself — the step ticks when the airplane is in that state. Checks are ticked by hand.'}</p>
      <ol class="fl-list">${s.steps.map(row).join('')}</ol>
      ${cl}
      <p class="qr-foot">Our own words after the FCOM normal procedures (Rev 57); checklists as printed in the QRH. Company procedures and the books on board govern.</p>
    </div>`;
  }
  function open(id) { if (id) stageId = id; sheet.custom(html(), 'flow'); }
  function redraw() { if (sheet.key === 'flow' && sheet.open) { const b = document.getElementById('sheet-body'), top = b?.scrollTop; sheet.custom(html(), 'flow'); if (b) b.scrollTop = top; } }

  // ── The player ──
  let pl = null;                            // { el, i, moved: [], ring: [], timer, play }
  function restore() {
    if (!pl) return;
    for (const r of pl.ring) r.remove();
    for (const { node, parent, next, style } of pl.moved) { node.classList.remove('cp-node'); node.setAttribute('style', style); if (parent) parent.insertBefore(node, next); else node.remove(); }
    pl.ring = []; pl.moved = [];
  }
  function close() {
    if (!pl) return;
    clearInterval(pl.timer); clearTimeout(pl.auto);
    restore();
    pl.el.remove();
    pl = null;
    host.setLive(false);
    redraw();
  }
  function ringAround(P, key) {
    const ct = P.controls.find((x) => x.key === key);
    if (!ct) return null;
    const cx = ct.cx ?? (ct.x0 + ct.x1) / 2, cy = ct.cy ?? (ct.y0 + ct.y1) / 2;
    const r = Math.max(16, ((ct.x1 ?? cx + 14) - (ct.x0 ?? cx - 14)) / 2 + 6);
    const ns = 'http://www.w3.org/2000/svg';
    const c = document.createElementNS(ns, 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r);
    c.setAttribute('fill', 'none'); c.setAttribute('stroke', '#ffd43b'); c.setAttribute('stroke-width', '3');
    c.setAttribute('pointer-events', 'none');
    const a = document.createElementNS(ns, 'animate');
    a.setAttribute('attributeName', 'stroke-opacity'); a.setAttribute('values', '1;0.25;1'); a.setAttribute('dur', '1.2s'); a.setAttribute('repeatCount', 'indefinite');
    c.append(a);
    P.svg.append(c);
    return c;
  }
  function showStep() {
    const s = stage(), st = s.steps[pl.i];
    restore();
    const box = pl.el.querySelector('.flp-panel');
    box.replaceChildren();
    if (st.p) {
      const c = host.ensureCockpit();
      const P = c.panelSets.get(st.p[0])?.panels.find((x) => x.title === st.p[1]);
      if (P) {
        const node = P.svg;
        pl.moved.push({ node, parent: node.parentNode, next: node.nextSibling, style: node.getAttribute('style') || '' });
        node.classList.add('cp-node'); node.removeAttribute('style');
        box.append(node);
        const keys = [...(st.set || []).map((x) => x[1]), ...(st.act ? [st.act[1]] : []), ...(st.acts || []).map((x) => x[1])];
        for (const k of new Set(keys)) { const r = ringAround(P, k); if (r) pl.ring.push(r); }
        const cap = document.createElement('div'); cap.className = 'flp-cap'; cap.textContent = st.p[1]; box.append(cap);
      }
    } else box.innerHTML = '<div class="flp-none">A check — no switch to move.</div>';
    paint();
  }
  function paint() {
    if (!pl) return;
    const s = stage(), st = s.steps[pl.i], d = isDone(st), done = stepDone(s, pl.i);
    const el = pl.el;
    el.querySelector('.flp-k').textContent = `${s.t.toUpperCase()} · STEP ${pl.i + 1} OF ${s.steps.length}`;
    el.querySelector('.flp-who').className = `fl-who flp-who ${WHO_CLS[st.who] || 'both'}`;
    el.querySelector('.flp-who').textContent = st.who;
    el.querySelector('.flp-t').textContent = st.t;
    el.querySelector('.flp-a').innerHTML = md(st.a);
    el.querySelector('.flp-why').textContent = st.why || '';
    el.querySelector('.flp-why').hidden = !st.why;
    const state = el.querySelector('.flp-state');
    state.textContent = done ? '✓ Done' : d === false ? (mode === 'do' ? 'Set it on the panel' : 'Not set yet') : 'Check, then tick';
    state.className = 'flp-state' + (done ? ' ok' : '');
    el.querySelector('[data-flp="do"]').hidden = !(st.set || st.act || st.acts) || mode === 'do' || done;
    el.querySelector('[data-flp="tick"]').hidden = d != null || done;
    el.querySelector('[data-flp="prev"]').disabled = pl.i === 0;
    el.querySelector('[data-flp="next"]').textContent = pl.i === s.steps.length - 1 ? (s.checklist ? 'Checklist ›' : 'Finish') : 'Next ›';
    el.querySelector('[data-flp="play"]').hidden = mode !== 'watch';
    el.querySelector('[data-flp="play"]').textContent = pl.play ? '❚❚ Pause' : '▶ Play';
  }
  function go(i) {
    const s = stage();
    if (i >= s.steps.length) { close(); if (s.checklist) requestAnimationFrame(() => document.querySelector('.fl-cl')?.scrollIntoView({ block: 'start', behavior: 'smooth' })); return; }
    pl.i = Math.max(0, i);
    showStep();
  }
  function play(on) {
    pl.play = on;
    clearTimeout(pl.auto);
    const tickPlay = () => {
      if (!pl?.play) return;
      const s = stage(), st = s.steps[pl.i];
      if (isDone(st) === false) doStep(st); else if (isDone(st) == null) ticked.add(`${s.id}:${pl.i}`);
      paint();
      pl.auto = setTimeout(() => { if (!pl?.play) return; if (pl.i >= s.steps.length - 1) { pl.play = false; paint(); return; } go(pl.i + 1); pl.auto = setTimeout(tickPlay, 900); }, 1600);
    };
    if (on) tickPlay(); else paint();
  }
  function openPlayer(i) {
    close();
    host.setLive(true);
    const el = document.createElement('div');
    el.className = 'cue-pop flp';
    el.innerHTML = `<div class="cue-pop-box flp-box">
      <div class="cue-pop-head"><div class="flp-k cue-pop-k"></div><button class="cue-pop-x" data-flp="x" aria-label="Close">✕</button></div>
      <div class="flp-line"><span class="fl-who flp-who"></span><span class="flp-t"></span></div>
      <div class="flp-a"></div><div class="flp-why"></div>
      <div class="flp-panel"></div>
      <div class="flp-foot"><span class="flp-state"></span>
        <button class="tag tag-btn" data-flp="prev">‹ Back</button>
        <button class="tag tag-btn" data-flp="play">▶ Play</button>
        <button class="tag tag-btn" data-flp="do">Do it for me</button>
        <button class="tag tag-btn" data-flp="tick">✓ Checked</button>
        <button class="tag tag-btn fl-go" data-flp="next">Next ›</button></div></div>`;
    document.body.append(el);
    pl = { el, i, moved: [], ring: [], play: false };
    el.addEventListener('click', (e) => {
      if (e.target === el) { close(); return; }
      const b = e.target.closest('[data-flp]');
      if (!b) return;
      const s = stage(), st = s.steps[pl.i];
      const a = b.dataset.flp;
      if (a === 'x') close();
      else if (a === 'prev') { play(false); go(pl.i - 1); }
      else if (a === 'next') { play(false); if (isDone(st) == null && mode === 'watch') ticked.add(`${s.id}:${pl.i}`); go(pl.i + 1); }
      else if (a === 'do') { doStep(st); paint(); }
      else if (a === 'tick') { ticked.add(`${s.id}:${pl.i}`); paint(); }
      else if (a === 'play') play(!pl.play);
    });
    // The step ticks itself when its switch is moved on the panel.
    pl.timer = setInterval(paint, 300);
    showStep();
  }
  addEventListener('keydown', (e) => { if (e.key === 'Escape' && pl) close(); });

  // ── Page clicks ──
  document.addEventListener('click', (e) => {
    if (sheet.key !== 'flow') return;
    const t = e.target.closest('[data-fl-stage],[data-fl-mode],[data-fl-play],[data-fl-tick],[data-fl-cl],[data-fl-cold]');
    if (!t || !t.closest('#sheet-body')) return;
    const d = t.dataset, s = stage();
    if (d.flStage) { stageId = d.flStage; open(); }
    else if (d.flMode) { mode = d.flMode; open(); }
    else if (d.flPlay != null) openPlayer(Number(d.flPlay));
    else if (d.flTick != null) { const k = `${s.id}:${d.flTick}`; if (ticked.has(k)) ticked.delete(k); else ticked.add(k); redraw(); }
    else if (d.flCl != null) { const k = `${s.id}:cl:${d.flCl}`; if (ticked.has(k)) ticked.delete(k); else ticked.add(k); redraw(); }
    else if (d.flCold != null) { coldStart(s); redraw(); }
  });

  return { open, redraw, get key() { return 'flow'; } };
}
