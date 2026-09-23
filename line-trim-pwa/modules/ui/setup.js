// ui/setup.js — screen 2: how you'll measure, and the laser.

import { rememberedGlider } from './glider.js?v=10';
import { $, el, esc, clear, toast, classBadge, fmtMm } from './dom.js?v=10';
import { icon } from './icons.js?v=10';
import { loadWing, isReady, sizeOf, expectedLineIds } from '../library.js?v=10';
import { prefs, draft } from '../store.js?v=10';
import * as laser from '../ble/laser.js?v=10';
import { DRIVER_LIST } from '../ble/drivers.js?v=10';
import { createSession, canMeasureFromMaillon } from '../session.js?v=10';
import { ORDERS } from '../linemodel.js?v=10';

let unsub = null;

export async function renderSetup(root, ctx) {
  unsub?.(); unsub = null;
  clear(root);
  if (!ctx.wingId) { ctx.goto('wings'); return; }
  root.appendChild(el('<p class="empty">Loading wing…</p>'));

  let wing;
  try { wing = await loadWing(ctx.wingId); }
  catch (e) { clear(root); root.appendChild(el(`<div class="note warn">${icon.warn}<span>Couldn't load this wing: ${esc(e.message)}</span></div>`)); return; }
  clear(root);

  const sizeKey = ctx.sizeKey;
  const size = sizeOf(wing, sizeKey);
  const ready = isReady(wing, sizeKey);
  const p = prefs.get();
  const nLines = expectedLineIds(wing, sizeKey).length;
  const maillonOk = canMeasureFromMaillon(size);

  const wrap = el(`
    <div>
      <button class="btn ghost sm" id="change" style="margin-left:-8px">${icon.back} Change wing</button>
      <div class="card" style="margin-top:6px">
        <div class="wing-banner">
          ${classBadge(wing.wingClass)}
          <div class="grow"><div class="name">${esc(wing.brand)} ${esc(wing.model)} · ${esc(sizeKey)}</div>
            <div class="muted small">${esc(wing.source?.publisher || '')}</div></div>
        </div>
        <div class="facts">
          <div class="fact"><b>${nLines}</b><span>lines per side</span></div>
          <div class="fact"><b>${nLines * 2}</b><span>readings</span></div>
          <div class="fact"><b>${wing.method.tensionKg} kg</b><span>line tension</span></div>
          <div class="fact"><b>±${wing.method.tolIndMm}</b><span>mm tolerance</span></div>
        </div>
        ${size?.loops?.length ? `<p class="small muted" style="margin:12px 0 0">Trim loops on ${esc(size.loops.join(', '))} — the app will say when an adjustment can use them.</p>` : ''}
      </div>

      ${wing.caution ? `<div class="note warn" style="margin-top:12px">${icon.warn}<span>${esc(wing.caution)}</span></div>` : ''}
      <div id="needs" ${ready ? 'hidden' : ''}>
        <div class="note warn" style="margin-top:14px">${icon.warn}<span>
          No published check lengths for size ${esc(sizeKey)}${size?.reason ? ` (${esc(size.reason)})` : ''}.
          The line plan is ready — add the lengths from your own sheet and you're set.</span></div>
        <button class="btn primary block big" id="add-sheet" style="margin-top:12px">${icon.upload} Add the sheet for ${esc(sizeKey)}</button>
      </div>

      <div id="ready-part" ${ready ? '' : 'hidden'}>
        <h2>Where do you measure from?</h2>
        <label class="choice"><input type="radio" name="from" value="riser" ${p.measureFrom !== 'maillon' || !maillonOk ? 'checked' : ''}>
          <div><b>From the riser bottom</b><span>Lines + risers — how the check sheet is written${size?.risers?.length
            ? ` (risers ${size.risers.map(r => `${esc(r.name)} ${r.std}`).join(', ')} mm)` : size?.riserMm ? ` (${size.riserMm} mm risers)` : ''}.</span></div></label>
        <label class="choice"><input type="radio" name="from" value="maillon" ${p.measureFrom === 'maillon' && maillonOk ? 'checked' : ''} ${maillonOk ? '' : 'disabled'}>
          <div><b>From the maillons</b><span>${!maillonOk
            ? (size?.risers?.length
              ? 'Not available: the risers differ in length and the sheet doesn\'t say which riser each line reaches, so the targets can\'t be converted safely.'
              : 'Not available: this sheet doesn\'t state the riser length, so the targets can\'t be converted safely.')
            : size.linesOnly ? 'Risers off — uses the sheet\'s own lines-only lengths.'
            : `Risers off — targets drop by ${size.riserMm} mm on A–E lines (brakes unchanged).`}</span></div></label>

        <h2>Laser</h2>
        <div class="card">
          <label class="field"><span>Device</span>
            <select class="input" id="driver">${DRIVER_LIST.map(d => `<option value="${d.id}">${esc(d.label)}</option>`).join('')}</select></label>
          <div class="device"><span class="led" id="led"></span><span id="bmsg" class="grow">Not connected</span><span class="reading" id="breading"></span></div>
          <div class="row" style="margin-top:12px">
            <button class="btn primary grow" id="connect">${icon.bt} Connect</button>
            <button class="btn grow" id="disconnect" hidden>Disconnect</button>
          </div>
          <p class="small muted" id="bhint" style="margin:10px 0 0"></p>
          <details class="more" style="margin-top:6px"><summary>${icon.chevron} Device log</summary><div class="log" id="blog"></div></details>
        </div>

        <details class="more" style="margin-top:16px">
          <summary>${icon.chevron} More options</summary>
          <div class="card flat" style="margin-top:8px">
            <label class="field"><span>Measuring order</span>
              <select class="input" id="order">${ORDERS.map(o => `<option value="${o.id}">${esc(o.label)}</option>`).join('')}</select></label>
            <label class="field"><span>Tolerance <b id="tolv"></b></span><input type="range" id="tol" min="5" max="20" step="1"></label>
            <label class="field"><span>Laser zero offset (mm)</span>
              <input class="input" id="offset" type="number" inputmode="numeric" placeholder="0"></label>
            <p class="small muted" style="margin:-6px 0 0">Added to every raw laser reading, for a rig whose laser doesn't sit exactly at the reference point.
              You can also calibrate from a known line while measuring.</p>
          </div>
        </details>

        <button class="btn primary block big" id="start" style="margin-top:20px">Start measuring · ${nLines * 2} readings ${icon.chevron}</button>
        <p class="small muted" style="text-align:center;margin-top:10px">Hang the wing, put ${wing.method.tensionKg} kg on each line, and walk the lines left side first.</p>
      </div>
    </div>`);
  root.appendChild(wrap);

  $('#change', wrap).addEventListener('click', () => ctx.goto('wings'));
  $('#add-sheet', wrap)?.addEventListener('click', () => { ctx.fillTarget = { wingId: wing.id, size: sizeKey }; ctx.goto('import'); });
  if (!ready) return;

  // ---- options
  const order = $('#order', wrap); order.value = p.orderMode || 'rows';
  const tol = $('#tol', wrap); tol.value = p.tolIndMm || wing.method.tolIndMm || 10;
  const tolv = $('#tolv', wrap); const syncTol = () => { tolv.textContent = `±${tol.value} mm`; }; syncTol();
  tol.addEventListener('input', syncTol);
  const offset = $('#offset', wrap); offset.value = p.refOffsetMm || '';

  // ---- laser
  const driverSel = $('#driver', wrap);
  driverSel.value = p.driver && DRIVER_LIST.some(d => d.id === p.driver) ? p.driver : 'ir40';
  const led = $('#led', wrap), bmsg = $('#bmsg', wrap), bread = $('#breading', wrap);
  const bconn = $('#connect', wrap), bdisc = $('#disconnect', wrap), bhint = $('#bhint', wrap), blog = $('#blog', wrap);
  function hint() {
    const d = DRIVER_LIST.find(x => x.id === driverSel.value);
    if (d?.needsBluetooth && !laser.bluetoothAvailable()) {
      bhint.textContent = 'Bluetooth needs Chrome on Android or a computer. On iPhone, type the readings in — it works just as well.';
    } else if (driverSel.value === 'ir40') {
      bhint.textContent = 'Turn the IR40 on and set it to metres. The app starts continuous measuring and captures when the reading holds steady.';
    } else if (driverSel.value === 'bosch') {
      bhint.textContent = 'Switch Bluetooth on at the meter and keep it in single-distance mode. Press measure on each line — the value comes in by itself.';
    } else if (driverSel.value === 'leica') {
      bhint.textContent = 'Switch Bluetooth on at the DISTO. Press measure on each line — the value comes in by itself.';
    } else if (driverSel.value === 'manual') {
      bhint.textContent = 'You\'ll type each reading. No device needed.';
    } else bhint.textContent = '';
  }
  hint();
  unsub = laser.subscribe(st => {
    led.className = 'led ' + ({ connected: 'on', connecting: 'busy', error: 'err' }[st.status] || '');
    bmsg.textContent = st.status === 'connected' ? `Connected · ${st.message}` : st.status === 'connecting' ? 'Connecting…'
      : st.status === 'error' ? st.message : 'Not connected';
    bread.textContent = st.lastMm != null ? `${fmtMm(st.lastMm)}` : '';
    bconn.hidden = st.status === 'connected';
    bdisc.hidden = st.status !== 'connected';
    blog.textContent = st.log.join('\n') || 'Nothing yet.';
  });
  driverSel.addEventListener('change', () => { prefs.set({ driver: driverSel.value }); hint(); });
  bconn.addEventListener('click', () => { prefs.set({ driver: driverSel.value }); laser.connect(driverSel.value); });
  bdisc.addEventListener('click', () => laser.disconnect());

  // ---- start
  $('#start', wrap).addEventListener('click', () => {
    const measureFrom = wrap.querySelector('input[name="from"]:checked')?.value || 'riser';
    const refOffsetMm = Number(offset.value) || 0;
    prefs.set({ measureFrom, orderMode: order.value, tolIndMm: Number(tol.value), refOffsetMm,
                lastWing: { id: wing.id, size: sizeKey } });
    ctx.session = createSession(wing, sizeKey, { measureFrom, orderMode: order.value, tolIndMm: Number(tol.value), refOffsetMm,
                                                 ...rememberedGlider(wing.id, sizeKey) });
    draft.set(ctx.session);
    ctx.goto('measure');
  });
}

export function stopSetup() { unsub?.(); unsub = null; }
