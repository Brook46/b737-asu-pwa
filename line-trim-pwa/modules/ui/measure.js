// ui/measure.js — screen 3: walk both sides, one line at a time.

import { $, el, esc, clear, toast, signed, fmtMm, rowColor } from './dom.js?v=7';
import { icon, statusIcon } from './icons.js?v=7';
import * as laser from '../ble/laser.js?v=7';
import {
  currentKey, walkKeys, record, clearLine, calibrate, rawToLength,
  progress, move, goto, nominalOf, endRecheck,
} from '../session.js?v=7';
import { renderPlanform } from './planform.js?v=7';
import { gauge } from './charts.js?v=7';
import { lineOf, sideOf, sideLabel, SIDES, parseLineId, RISER_LABEL } from '../linemodel.js?v=7';
import { targetFor } from '../trim.js?v=7';
import { createStabilizer } from '../capture.js?v=7';
import { prefs, draft } from '../store.js?v=7';

let unsub = null;

export function renderMeasure(root, ctx) {
  unsub?.(); unsub = null;
  const s = ctx.session;
  if (!s) { ctx.goto('wings'); return; }
  clear(root);
  const p = prefs.get();
  let autoCapture = p.autoCapture !== false;
  const stab = createStabilizer();
  let liveRaw = null;           // latest stable (or last) raw reading
  let armed = true;             // may the next stable reading be captured?
  let lastCapturedRaw = null;

  const mainOf = new Map();
  for (const m of s.mains) for (const id of m.lineIds) mainOf.set(id, m.id);

  const wrap = el(`
    <div>
      <div id="recheck"></div>
      <div class="measure-top"><div class="seg" id="sides" role="tablist" aria-label="Side"></div></div>
      <div class="planform-wrap" id="plan"></div>
      <div class="capture" id="card">
        <div class="capture-head">
          <div>
            <div class="line-id" id="lid"></div>
            <div class="line-where" id="where"></div>
          </div>
          <div class="target"><span>Target</span><b id="target" class="num"></b></div>
        </div>
        <div class="reading-box">
          <input id="len" type="number" inputmode="decimal" enterkeyhint="next" placeholder="–––– " aria-label="Measured length in millimetres">
          <span class="unit">mm</span>
        </div>
        <div class="gauge" id="gauge"></div>
        <div class="gauge-read" id="gread"></div>
        <div class="laser-row" id="laser">
          <span class="led" id="led"></span><span id="lstate">Type the reading, or connect a laser on the setup screen</span>
          <button class="btn sm soft" id="use" hidden>Use</button>
        </div>
        <div class="navrow">
          <button class="btn" id="prev" aria-label="Previous line">${icon.back}</button>
          <button class="btn" id="skip">Skip</button>
          <button class="btn primary" id="next">Save &amp; next ${icon.chevron}</button>
        </div>
        <div class="progress"><i id="bar"></i></div>
        <div class="progress-label"><span id="plabel"></span>
          <span><button class="btn ghost sm" id="calib">${icon.ruler} Calibrate</button>
          <button class="btn ghost sm" id="auto"></button></span></div>
      </div>
      <button class="btn block soft" id="finish" style="margin-top:12px">See results ${icon.chevron}</button>
    </div>`);
  root.appendChild(wrap);

  const input = $('#len', wrap);

  function statusFor(key, value) {
    if (value == null) return null;
    const d = Math.abs(value - targetFor(s, lineOf(key)));
    return d <= s.tolIndMm ? 'good' : d <= s.tolIndMm * 2 ? 'warn' : 'bad';
  }

  function draw() {
    const key = currentKey(s);
    const side = sideOf(key), id = lineOf(key);
    const { riser } = parseLineId(id);

    // recheck banner
    const rc = $('#recheck', wrap);
    clear(rc);
    if (s.queue?.length) {
      const pr = progress(s, s.queue);
      const b = el(`<div class="recheck-bar">${icon.redo} Re-check: ${pr.done ? `${pr.done}/` : ''}${pr.total} lines
        <button class="btn sm">Done</button></div>`);
      b.querySelector('button').addEventListener('click', () => { commit(); endRecheck(s); save(); ctx.goto('result'); });
      rc.appendChild(b);
    }

    // sides
    const seg = $('#sides', wrap);
    clear(seg);
    for (const sd of SIDES) {
      const keys = walkKeys(s).filter(k => sideOf(k) === sd.id);
      if (!keys.length) continue;
      const pr = progress(s, keys);
      const b = el(`<button role="tab" aria-pressed="${sd.id === side}">${sd.label} <small>${pr.done}/${pr.total}</small></button>`);
      b.addEventListener('click', () => {
        commit();
        goto(s, keys.find(k => s.measured[k] == null) || keys[0]);
        reset(); draw();
      });
      seg.appendChild(b);
    }

    // planform
    const statusByKey = {};
    for (const k of s.order) statusByKey[k] = statusFor(k, s.measured[k]) || 'todo';
    renderPlanform($('#plan', wrap), {
      lineIds: Object.keys(s.nominal), ribs: s.ribs, activeKey: key, statusByKey,
      onPick: k => { commit(); goto(s, k); reset(); draw(); },
    });

    // card
    $('#lid', wrap).innerHTML = `<span class="dot" style="background:${rowColor(riser)}"></span>${esc(id)}`;
    const rib = s.ribs?.[id];
    $('#where', wrap).textContent = [sideLabel(side) + ' side', `${RISER_LABEL[riser] || riser} row`,
      mainOf.get(id) && !/\*$/.test(mainOf.get(id)) ? `main ${mainOf.get(id)}` : null, rib != null ? `rib ${rib}` : null]
      .filter(Boolean).join(' · ');
    $('#target', wrap).textContent = fmtMm(targetFor(s, id));
    input.value = s.measured[key] ?? '';
    updateGauge();

    const all = walkKeys(s);
    const pr = progress(s, all);
    $('#bar', wrap).style.width = `${pr.pct}%`;
    $('#plabel', wrap).textContent = s.queue?.length
      ? `Re-check ${s.cursor + 1} of ${all.length}`
      : `${s.cursor + 1} of ${all.length} · ${pr.done} measured`;
    $('#auto', wrap).innerHTML = `${autoCapture ? icon.check : ''} Auto-capture ${autoCapture ? 'on' : 'off'}`;
    $('#auto', wrap).hidden = laser.getState().status !== 'connected';
    $('#finish', wrap).className = pr.done === all.length ? 'btn block primary big' : 'btn block soft';
    $('#finish', wrap).innerHTML = s.queue?.length ? `Back to results ${icon.chevron}` : `See results ${icon.chevron}`;
    input.focus({ preventScroll: true });
  }

  function updateGauge() {
    const key = currentKey(s);
    const v = parseFloat(input.value);
    const d = Number.isFinite(v) ? v - targetFor(s, lineOf(key)) : null;
    $('#gauge', wrap).innerHTML = gauge(d, s.tolIndMm);
    const g = $('#gread', wrap);
    if (d == null) { g.innerHTML = `<span class="muted small">Tolerance ±${s.tolIndMm} mm</span>`; return; }
    const st = statusFor(key, v);
    const implausible = Math.abs(d) > s.tolIndMm * 4;
    g.innerHTML = `<span class="val">${signed(d)}</span>
      <span class="status ${implausible ? 'bad' : st}">${implausible ? icon.warn : statusIcon(st)}
      ${implausible ? 'implausible — check the hook-up' : st === 'good' ? 'in tolerance' : st === 'warn' ? 'a bit out' : 'out of tolerance'}</span>`;
  }

  // Moving to another line clears the sample window but does NOT re-arm
  // auto-capture: the beam may still be on the line just captured, and re-arming
  // here saved one steady reading onto several consecutive lines. Only the beam
  // actually moving re-arms (see the laser handler below).
  function reset() {
    stab.reset();
    liveRaw = null;
    $('#use', wrap).hidden = true;
  }

  function commit(source) {
    const key = currentKey(s);
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) {
      const fromLaser = source === 'laser' || (liveRaw != null && Math.round(rawToLength(s, liveRaw)) === Math.round(v));
      record(s, key, v, { raw: fromLaser ? liveRaw : null, source: fromLaser ? 'laser' : 'manual' });
    } else if (s.measured[key] != null && input.value === '') {
      clearLine(s, key);
    }
    save();
  }
  function save() { draft.set(s); }

  function advance(step, source) {
    commit(source);
    move(s, step);
    reset();
    draw();
  }

  input.addEventListener('input', updateGauge);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#next', wrap).click(); } });
  $('#prev', wrap).addEventListener('click', () => advance(-1));
  $('#skip', wrap).addEventListener('click', () => { input.value = s.measured[currentKey(s)] ?? ''; advance(1); });
  $('#next', wrap).addEventListener('click', () => {
    if (!Number.isFinite(parseFloat(input.value))) { toast('Enter the reading, or tap Skip'); return; }
    const atEnd = s.cursor >= walkKeys(s).length - 1;
    advance(1);
    if (atEnd) toast('Last line done — see the results below');
  });
  $('#finish', wrap).addEventListener('click', () => {
    commit();
    if (s.queue?.length) endRecheck(s);
    save();
    ctx.goto('result');
  });
  $('#auto', wrap).addEventListener('click', () => {
    autoCapture = !autoCapture; prefs.set({ autoCapture }); draw();
  });
  $('#use', wrap).addEventListener('click', () => {
    if (liveRaw == null) return;
    input.value = rawToLength(s, liveRaw);
    updateGauge();
  });
  $('#calib', wrap).addEventListener('click', () => {
    const key = currentKey(s);
    const raw = liveRaw ?? parseFloat(input.value);
    if (!Number.isFinite(raw)) { toast('Take a reading on a line you know first'); return; }
    const t = parseFloat(prompt(`True length of ${lineOf(key)} (mm), from a tape or a spec you trust:`));
    if (!Number.isFinite(t)) return;
    const off = calibrate(s, t, raw);
    prefs.set({ refOffsetMm: off });
    toast(`Zero offset set to ${signed(off)} — applied to every reading`);
    save(); draw();
  });

  // swipe the card left/right to move
  let sx = 0;
  const card = $('#card', wrap);
  card.addEventListener('touchstart', e => { sx = e.changedTouches[0].clientX; }, { passive: true });
  card.addEventListener('touchend', e => {
    const dx = e.changedTouches[0].clientX - sx;
    if (Math.abs(dx) > 70 && e.target !== input) advance(dx < 0 ? 1 : -1);
  }, { passive: true });

  // ---- laser: steady-reading capture
  unsub = laser.subscribe((st, ev) => {
    const connected = st.status === 'connected';
    const led = $('#led', wrap), ls = $('#lstate', wrap), use = $('#use', wrap);
    $('#auto', wrap).hidden = !connected;
    if (!connected) {
      led.className = 'led';
      ls.textContent = 'Type the reading, or connect a laser on the setup screen';
      use.hidden = true;
      return;
    }
    if (ev?.type !== 'reading') { led.className = 'led on'; ls.textContent = `${st.message} · waiting for a reading`; return; }
    const state = stab.push(ev.mm);
    // re-arm once the beam has clearly moved off the last captured line
    if (!armed && (state.status === 'moving' || (lastCapturedRaw != null && Math.abs(ev.mm - lastCapturedRaw) > 15))) armed = true;
    if (state.status === 'stable') {
      liveRaw = state.value;
      const mm = rawToLength(s, state.value);
      led.className = 'led on';
      ls.innerHTML = `<span class="live">${fmtMm(mm)}</span> <span class="muted">steady</span>`;
      // "Use" stays available whenever auto-capture won't fire on its own
      use.hidden = autoCapture && armed;
      if (!armed) ls.innerHTML += ` <span class="muted">· move to the next line</span>`;
      if (autoCapture && armed) {
        armed = false;
        lastCapturedRaw = state.value;
        input.value = mm;
        updateGauge();
        if (navigator.vibrate) navigator.vibrate(30);
        setTimeout(() => {
          if (Number(input.value) === mm) advance(1, 'laser');
        }, 650);
      }
    } else {
      led.className = 'led moving';
      ls.innerHTML = `<span class="live">${fmtMm(rawToLength(s, ev.mm))}</span> <span class="muted">${state.status === 'moving' ? 'hold steady…' : 'settling…'}</span>`;
      use.hidden = true;
    }
  });

  if (s.cursor >= walkKeys(s).length) s.cursor = 0;
  draw();
}

export function stopMeasure() { unsub?.(); unsub = null; }
