// ui/measure.js — screen 3: walk both sides, one line at a time.
//
// Auto-next: a laser reading (single shot or steady stream) or a typed 4-digit
// value close to the target is saved and the next line comes up by itself. The
// "Saved … · Redo" chip jumps straight back to re-enter the last value.

import { $, $$, el, esc, clear, toast, signed, fmtMm, rowColor } from './dom.js?v=18';
import { icon, statusIcon } from './icons.js?v=18';
import * as laser from '../ble/laser.js?v=18';
import {
  currentKey, walkKeys, record, clearLine, calibrate, rawToLength,
  progress, move, goto, endRecheck, setOrder,
} from '../session.js?v=18';
import { renderLinePlan } from './lineplan.js?v=18';
import { gliderCard } from './glider.js?v=18';
import { gauge } from './charts.js?v=18';
import { lineOf, sideOf, sideLabel, SIDES, parseLineId, RISER_LABEL } from '../linemodel.js?v=18';
import { targetFor } from '../trim.js?v=18';
import { createCapture } from '../capture.js?v=18';
import { prefs, draft } from '../store.js?v=18';

let unsub = null;
const TYPED_PLAUSIBLE_MM = 600;   // a typed value this close to target may auto-advance
const TYPED_PAUSE_MS = 900;
const LASER_SHOW_MS = 650;        // show the captured number briefly before moving on

export function renderMeasure(root, ctx) {
  unsub?.(); unsub = null;
  const s = ctx.session;
  if (!s) { ctx.goto('wings'); return; }
  clear(root);
  let autoNext = prefs.get().autoNext ?? prefs.get().autoCapture ?? true;
  const cap = createCapture();
  let liveRaw = null;           // newest raw laser reading not yet used
  let usedRaw = null;           // raw value behind the number in the box, if it came from the laser
  let lastEntry = null;         // { key, value } for the Redo chip
  let typeTimer = null, laserTimer = null;

  const mainOf = new Map();
  for (const m of s.mains) if (!m.synthetic) for (const id of m.lineIds) mainOf.set(id, m.id);

  const wrap = el(`
    <div>
      <div id="glider"></div>
      <div class="order-toggle" role="group" aria-label="Measuring order">
        <span class="small muted">Measuring order</span>
        <div class="seg sm" id="ordertog">
          <button data-o="side">Left, then right</button>
          <button data-o="tip">Tip to tip</button>
        </div>
      </div>
      <div id="recheck"></div>
      <div class="measure-top"><div class="seg" id="sides" role="tablist" aria-label="Side"></div></div>
      <div class="planform-wrap" id="plan"></div>
      <div class="capture" id="card">
        <div id="last"></div>
        <div class="capture-head">
          <div>
            <div class="line-id" id="lid"></div>
            <div class="line-where" id="where"></div>
          </div>
          <div class="target"><span>Target</span><b id="target" class="num"></b></div>
        </div>
        <div class="reading-box">
          <input id="len" type="number" inputmode="numeric" enterkeyhint="next" placeholder="–––– " aria-label="Measured length in millimetres">
          <span class="unit">mm</span>
        </div>
        <div class="gauge" id="gauge"></div>
        <div class="gauge-read" id="gread"></div>
        <div class="laser-row" id="laser">
          <span class="led" id="led"></span><span id="lstate" class="grow">Type the reading, or connect a laser on the setup screen</span>
          <button class="btn sm primary" id="use" hidden>Use</button>
        </div>
        <div class="navrow">
          <button class="btn" id="prev" aria-label="Previous line">${icon.back}</button>
          <button class="btn" id="skip">Skip</button>
          <button class="btn primary" id="next">Save &amp; next ${icon.chevron}</button>
        </div>
        <div class="progress"><i id="bar"></i></div>
        <div class="progress-label"><span id="plabel"></span>
          <span><button class="btn ghost sm" id="calib">${icon.ruler} Calibrate</button>
          <button class="btn ghost sm" id="auto" aria-pressed="false"></button></span></div>

      </div>
      <button class="btn block soft" id="finish" style="margin-top:12px">See results ${icon.chevron}</button>
    </div>`);
  root.appendChild(wrap);

  $('#glider', wrap).appendChild(gliderCard(s, { compact: true, onChange: () => save() }));
  const input = $('#len', wrap);
  const laserOn = () => laser.getState().status === 'connected';

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
      const b = el(`<div class="recheck-bar">${icon.redo} Re-check: ${pr.total} lines
        <button class="btn sm">Done</button></div>`);
      b.querySelector('button').addEventListener('click', () => { commit(); endRecheck(s); save(); ctx.goto('result'); });
      rc.appendChild(b);
    }

    // the last saved value, one tap from being redone
    const last = $('#last', wrap);
    clear(last);
    if (lastEntry) {
      const chip = el(`<button class="last-chip">${icon.check}
        <span>Saved <b>${esc(sideLabel(sideOf(lastEntry.key))[0])} ${esc(lineOf(lastEntry.key))}</b> = <b class="num">${fmtMm(lastEntry.value)}</b></span>
        <span class="redo">${icon.redo} Redo</span></button>`);
      chip.addEventListener('click', () => {
        clearTimers(); commit();
        goto(s, lastEntry.key);
        lastEntry = null; reset(); draw();
        input.focus(); input.select();
      });
      last.appendChild(chip);
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
        clearTimers(); commit();
        goto(s, keys.find(k => s.measured[k] == null) || keys[0]);
        reset(); draw();
      });
      seg.appendChild(b);
    }

    // line plan
    const statusByKey = {};
    for (const k of s.order) statusByKey[k] = statusFor(k, s.measured[k]) || 'todo';
    renderLinePlan($('#plan', wrap), {
      lineIds: Object.keys(s.nominal), mains: s.mains, cascade: s.cascade, ribs: s.ribs, activeKey: key, statusByKey,
      onPick: k => { clearTimers(); commit(); goto(s, k); reset(); draw(); },
    });

    // card
    $('#lid', wrap).innerHTML = `<span class="dot" style="background:${rowColor(riser)}"></span>${esc(id)}`;
    const rib = s.ribs?.[id];
    $('#where', wrap).textContent = [sideLabel(side) + ' side', `${RISER_LABEL[riser] || riser} row`,
      mainOf.get(id) && !/\*$/.test(mainOf.get(id)) ? `main ${mainOf.get(id)}` : null, rib != null ? `rib ${rib}` : null]
      .filter(Boolean).join(' · ');
    $('#target', wrap).textContent = fmtMm(targetFor(s, id));
    input.value = s.measured[key] ?? '';
    usedRaw = s.rawByLine[key] ?? null;
    updateGauge();

    const all = walkKeys(s);
    const pr = progress(s, all);
    $('#bar', wrap).style.width = `${pr.pct}%`;
    $('#plabel', wrap).textContent = s.queue?.length
      ? `Re-check ${s.cursor + 1} of ${all.length}`
      : `${s.cursor + 1} of ${all.length} · ${pr.done} measured`;
    $$('#ordertog button', wrap).forEach(b => b.setAttribute('aria-pressed', String((s.orderMode === 'tip') === (b.dataset.o === 'tip'))));
    const auto = $('#auto', wrap);
    auto.innerHTML = `${autoNext ? icon.check : ''} Auto-next ${autoNext ? 'on' : 'off'}`;
    auto.setAttribute('aria-pressed', String(autoNext));
    $('#finish', wrap).className = pr.done === all.length ? 'btn block primary big' : 'btn block soft';
    $('#finish', wrap).innerHTML = s.queue?.length ? `Back to results ${icon.chevron}` : `See results ${icon.chevron}`;
    // with a laser the keyboard would only get in the way
    if (!laserOn()) input.focus({ preventScroll: true });
    paintLaser();
  }

  function updateGauge(note) {
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
      ${implausible ? 'implausible — check the hook-up' : st === 'good' ? 'in tolerance' : st === 'warn' ? 'a bit out' : 'out of tolerance'}</span>
      ${note ? `<span class="muted small">${esc(note)}</span>` : ''}`;
  }

  function clearTimers() { clearTimeout(typeTimer); clearTimeout(laserTimer); typeTimer = laserTimer = null; }

  function reset() {
    cap.reset();
    liveRaw = null;
  }

  function commit() {
    const key = currentKey(s);
    const v = parseFloat(input.value);
    if (Number.isFinite(v)) {
      const fromLaser = usedRaw != null && rawToLength(s, usedRaw) === Math.round(v);
      record(s, key, v, { raw: fromLaser ? usedRaw : null, source: fromLaser ? 'laser' : 'manual' });
      return true;
    }
    if (s.measured[key] != null && input.value === '') clearLine(s, key);
    return false;
  }
  function save() { draft.set(s); }

  function advance(step) {
    clearTimers();
    const key = currentKey(s);
    const saved = commit();
    if (saved && step > 0) lastEntry = { key, value: s.measured[key] };
    save();
    const atEnd = step > 0 && s.cursor >= walkKeys(s).length - 1;
    move(s, step);
    reset();
    draw();
    if (atEnd && saved) toast('Last line done — tap See results');
  }

  // ---- typing: Enter, the button, or auto-next after 4 plausible digits
  input.addEventListener('input', () => {
    usedRaw = null;                         // typed over the laser value
    updateGauge();
    clearTimeout(typeTimer);
    if (!autoNext) return;
    const raw = input.value.trim();
    const v = Number(raw);
    const target = targetFor(s, lineOf(currentKey(s)));
    if (/^\d{4}$/.test(raw) && Math.abs(v - target) <= TYPED_PLAUSIBLE_MM) {
      updateGauge('saving…');
      const keyAtType = currentKey(s);
      typeTimer = setTimeout(() => {
        if (currentKey(s) === keyAtType && input.value.trim() === raw) advance(1);
      }, TYPED_PAUSE_MS);
    }
  });
  input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#next', wrap).click(); } });

  $('#prev', wrap).addEventListener('click', () => advance(-1));
  $('#skip', wrap).addEventListener('click', () => {
    clearTimers();
    input.value = s.measured[currentKey(s)] ?? '';
    advance(1);
  });
  $('#next', wrap).addEventListener('click', () => {
    if (!Number.isFinite(parseFloat(input.value))) { toast('Enter the reading, or tap Skip'); return; }
    advance(1);
  });
  $('#finish', wrap).addEventListener('click', () => {
    clearTimers(); commit();
    if (s.queue?.length) endRecheck(s);
    save();
    ctx.goto('result');
  });
  // switch the walking order mid-check; readings stay, the current line stays.
  // "Left, then right" goes back to the pilot's chosen side-by-side order.
  $$('#ordertog button', wrap).forEach(b => b.addEventListener('click', () => {
    const tip = b.dataset.o === 'tip';
    if (tip === (s.orderMode === 'tip')) return;
    clearTimers(); commit();
    const side = prefs.get().sideOrderMode || 'rows';
    if (tip && s.orderMode !== 'tip') prefs.set({ sideOrderMode: s.orderMode || 'rows' });
    setOrder(s, tip ? 'tip' : side);
    prefs.set({ orderMode: s.orderMode });
    save(); reset(); draw();
    toast(tip ? 'Tip to tip: A row from the right stabilo across to the left, then B back' : 'Left side first, then the right');
  }));
  $('#auto', wrap).addEventListener('click', () => {
    autoNext = !autoNext;
    prefs.set({ autoNext });
    if (!autoNext) clearTimers();
    draw();
  });
  $('#use', wrap).addEventListener('click', () => { if (liveRaw != null) useReading(liveRaw, false); });
  $('#calib', wrap).addEventListener('click', () => {
    const key = currentKey(s);
    const raw = liveRaw ?? usedRaw ?? parseFloat(input.value);
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

  // ---- laser
  /** Put a raw laser reading in the box; auto-next moves on after a beat. */
  function useReading(raw, automatic) {
    clearTimers();
    usedRaw = raw;
    liveRaw = null;
    const mm = rawToLength(s, raw);
    input.value = mm;
    // a shot far off the target is usually the wrong line or the rig behind it:
    // hold it on screen instead of saving — the next shot replaces it
    const held = Math.abs(mm - targetFor(s, lineOf(currentKey(s)))) > s.tolIndMm * 4;
    updateGauge(automatic && autoNext ? (held ? 'held — shoot again, or tap Next to keep it' : 'saving…') : '');
    if (navigator.vibrate) navigator.vibrate(held ? [30, 60, 30] : 30);
    paintLaser();
    if (automatic && autoNext && !held) {
      const keyAt = currentKey(s);
      laserTimer = setTimeout(() => {
        if (currentKey(s) === keyAt && Number(input.value) === mm) advance(1);
      }, LASER_SHOW_MS);
    }
  }

  let lastStatus = null;
  function paintLaser(status = lastStatus) {
    lastStatus = status;
    const led = $('#led', wrap), ls = $('#lstate', wrap), use = $('#use', wrap);
    if (!led) return;
    if (!laserOn()) {
      led.className = 'led';
      ls.textContent = 'Type the reading, or connect a laser on the setup screen';
      use.hidden = true;
      return;
    }
    // "Use" is there whenever a reading is waiting that isn't in the box
    use.hidden = liveRaw == null;
    if (liveRaw != null) use.textContent = `Use ${fmtMm(rawToLength(s, liveRaw))}`;
    if (!status || status.status === 'idle') {
      led.className = 'led on';
      ls.innerHTML = `${esc(laser.getState().message)} · <span class="muted">measure the line</span>`;
      return;
    }
    const mm = fmtMm(rawToLength(s, status.last));
    if (status.status === 'moving' || status.status === 'settling') {
      led.className = 'led moving';
      ls.innerHTML = `<span class="live">${mm}</span> <span class="muted">hold steady…</span>`;
    } else if (status.status === 'waiting') {
      led.className = 'led moving';
      ls.innerHTML = `<span class="live">${mm}</span> <span class="muted">reading…</span>`;
    } else {
      led.className = 'led on';
      ls.innerHTML = `<span class="live">${mm}</span> <span class="muted">${cap.armed ? '' : 'captured · aim at the next line'}</span>`;
    }
  }

  const offLaser = laser.subscribe((st, ev) => {
    if (ev?.type !== 'reading') { paintLaser(); return; }
    const r = cap.push(ev.mm);
    if (r.capture) { paintLaser(r); useReading(r.capture.value, true); return; }
    liveRaw = ev.mm;
    paintLaser(r);
  });
  // single shots are taken once it's clear no stream follows
  const ticker = setInterval(() => {
    const k = cap.tick();
    if (k?.capture) { paintLaser(k); useReading(k.capture.value, true); }
  }, 150);

  // desk mocks aim near the line on screen (raw = length − zero offset)
  laser.setAimHint(() => { const k = currentKey(s); return k ? targetFor(s, lineOf(k)) - (s.refOffsetMm || 0) : null; });

  unsub = () => { offLaser(); clearInterval(ticker); clearTimers(); laser.setAimHint(null); };

  if (s.cursor >= walkKeys(s).length) s.cursor = 0;
  draw();
}

export function stopMeasure() { unsub?.(); unsub = null; }
