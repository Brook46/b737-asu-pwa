// ui/result.js — screen 4: what's wrong, what to do, and the picture.

import { gliderCard } from './glider.js?v=10';
import { $, $$, el, esc, clear, toast, signed, fmtMm, classBadge } from './dom.js?v=10';
import { icon, statusIcon } from './icons.js?v=10';
import { analyse, adjustHint, aoiNote } from '../trim.js?v=10';
import { RISER_ORDER, sideLabel, keyFor, SIDES, isBrakeRiser } from '../linemodel.js?v=10';
import { startRecheck, goto, progress } from '../session.js?v=10';
import { sessions, draft } from '../store.js?v=10';
import { exportJson, exportCsv, sessionSummaryText } from '../exporter.js?v=10';
import { trimProfile, profileScale, aoiBars, hideTip } from './charts.js?v=10';
import { methodFor } from './guide.js?v=10';
import { checkDate } from './history.js?v=10';

export function renderResult(root, ctx) {
  const s = ctx.session;
  if (!s) { ctx.goto('wings'); return; }
  s.done ||= {};
  draw();

  function draw() {
    hideTip();
    const a = analyse(s);
    // The checklist always comes from the REAL readings: a previewed change must
    // not make its own task disappear. Only the verdict and charts show the preview.
    const real = Object.keys(s.simOffsets || {}).length ? analyse({ ...s, simOffsets: {} }) : a;
    clear(root);
    const pr = progress(s);

    const wrap = el(`<div>
      <div id="glider"></div>
      <div class="small muted" style="margin:-2px 0 8px">${pr.done}/${pr.total} readings</div>
      <div id="verdict"></div>
      <div class="tiles" id="tiles"></div>
      <div class="row" style="margin:26px 0 10px"><h2 style="margin:0" class="grow">Your trim plan</h2>
        <button class="btn ghost sm" id="guide">${icon.info} Trimming guide</button></div>
      <div id="todo"></div>
      <h2>Trim profile</h2>
      <p class="small muted" style="margin-top:-4px">Each line against the reference, centre to tip. The green band is ±${s.tolIndMm} mm.
        Rear rows sitting above the A row = trimmed faster; below = slower.</p>
      <div id="profiles"></div>
      <h2>Angle of incidence</h2>
      <div id="aoi"></div>
      <details class="more" style="margin-top:18px" id="details">
        <summary>${icon.chevron} Details — reference, left/right, every reading</summary>
        <div id="detail-body" style="margin-top:8px"></div>
      </details>
      <div id="save-panel"></div>
      <div class="actions">
        <button class="btn primary" id="save">${icon.save} ${s.savedAt ? 'Saved — edit' : 'Save'}</button>
        <button class="btn" id="share">${icon.share} Share</button>
        <button class="btn soft" id="csv">${icon.download} CSV</button>
        <button class="btn soft" id="json">${icon.download} JSON</button>
      </div>
      <button class="btn ghost block" id="new" style="margin-top:6px">Start a new check</button>
    </div>`);
    root.appendChild(wrap);
    $('#glider', wrap).appendChild(gliderCard(s, { onChange: () => { if (s.savedAt) sessions.save(s); else draft.set(s); } }));

    renderVerdict($('#verdict', wrap), a);
    renderTiles($('#tiles', wrap), a);
    renderTodo($('#todo', wrap), real);
    renderProfiles($('#profiles', wrap), a);
    renderAoi($('#aoi', wrap), a);
    const det = $('#details', wrap);
    det.addEventListener('toggle', () => { if (det.open && !$('#detail-body', wrap).childElementCount) renderDetails($('#detail-body', wrap), a); });

    $('#guide', wrap).addEventListener('click', () => ctx.goto('guide'));
    $('#save', wrap).addEventListener('click', () => openSave($('#save-panel', wrap)));
    $('#csv', wrap).addEventListener('click', () => exportCsv(s));
    $('#json', wrap).addEventListener('click', () => exportJson(s));
    $('#share', wrap).addEventListener('click', async () => {
      const text = sessionSummaryText(s, a);
      try {
        if (navigator.share) await navigator.share({ title: `Line trim — ${s.brand} ${s.model} ${s.sizeKey}`, text });
        else { await navigator.clipboard.writeText(text); toast('Summary copied'); }
      } catch { /* user cancelled */ }
    });
    $('#new', wrap).addEventListener('click', () => {
      if (!s.savedAt && pr.done && !confirm('This check isn\'t saved. Start a new one anyway?')) return;
      ctx.session = null; draft.clear(); ctx.goto('wings');
    });
  }

  // ------------------------------------------------------------------ save
  function openSave(host) {
    clear(host);
    const def = `${s.model} ${s.sizeKey} — ${checkDate(s)}`;
    const box = el(`<div class="card" style="margin-top:14px">
      <h3 style="margin-top:0">Save this check</h3>
      <div class="row wrap">
        <label class="field grow"><span>Name</span><input class="input" id="sv-name" value="${esc(s.name || def)}"></label>
        <label class="field"><span>Measured on</span><input class="input" id="sv-date" type="date" value="${esc(checkDate(s))}"></label>
      </div>
      <label class="field"><span>Notes (optional)</span><input class="input" id="sv-notes" value="${esc(s.notes || '')}" placeholder="e.g. after 60 h, before re-trim"></label>
      <div class="row"><button class="btn primary grow" id="sv-go">${icon.save} Save</button><button class="btn ghost" id="sv-cancel">Cancel</button></div>
    </div>`);
    host.appendChild(box);
    box.querySelector('#sv-name').select();
    box.querySelector('#sv-cancel').addEventListener('click', () => clear(host));
    box.querySelector('#sv-go').addEventListener('click', () => {
      s.name = box.querySelector('#sv-name').value.trim() || def;
      s.measuredOn = box.querySelector('#sv-date').value || checkDate(s);
      s.notes = box.querySelector('#sv-notes').value.trim();
      s.savedAt = Date.now();
      sessions.save(s);
      draft.clear();
      toast(`Saved "${s.name}" — find it under Your checks`);
      draw();
    });
  }

  // --------------------------------------------------------------- verdict
  function renderVerdict(host, a) {
    const v = a.verdict;
    const lvl = v.level;
    const simulating = a.integrity.simulating;
    host.appendChild(el(`<div class="verdict ${lvl}" role="status">
      <div class="vicon">${statusIcon(lvl)}</div>
      <div><b>${esc(v.title)}</b><p>${esc(shortDetail(v.detail))}</p>
      ${simulating ? `<p class="small" style="margin-top:6px"><b style="display:inline;font-size:inherit">Preview:</b> showing the wing as if the ticked changes were made.</p>` : ''}
      </div></div>`));
    if (s.custom) host.appendChild(el(`<p class="small muted" style="margin:8px 2px 0">Targets from your own sheet.</p>`));
  }
  // function declaration, not a const arrow: draw() runs before this line is reached
  function shortDetail(t) { return t.split(/(?<=\.)\s+/).slice(0, 2).join(' '); }

  // ----------------------------------------------------------------- tiles
  function renderTiles(host, a) {
    const aois = [...(a.perSide.L?.aoi || []), ...(a.perSide.R?.aoi || [])];
    const aoi = aois.length ? Math.round(aois.reduce((x, y) => x + y.aoiMm, 0) / aois.length * 10) / 10 : null;
    const asym = a.asymmetry.filter(x => !isBrakeRiser(x.riser)).sort((x, y) => Math.abs(y.diffMm) - Math.abs(x.diffMm))[0];
    const worst = [...a.lines].sort((x, y) => Math.abs(y.rel) - Math.abs(x.rel))[0];
    const tile = (label, value, sub) => `<div class="tile"><span>${label}</span><b>${value}</b><small>${sub}</small></div>`;
    host.innerHTML =
      tile('Trim speed', aoi == null ? '–' : signed(aoi, ''), aoi == null ? 'needs A and rear rows'
        : Math.abs(aoi) <= s.tolIndMm / 2 ? 'as factory' : aoi > 0 ? 'mm faster' : 'mm slower')
      + tile('Left vs right', asym ? signed(asym.diffMm, '') : '–', asym ? `mm on ${esc(asym.mainId)}` : 'measure both sides')
      + tile('Worst line', worst ? signed(worst.rel, '') : '–', worst ? `mm · ${esc(sideLabel(worst.side))} ${esc(worst.lineId)}` : '');
  }

  // ------------------------------------------------------------------ plan
  function renderTodo(host, a) {
    const steps = [
      { title: 'Re-measure the odd readings', tasks: [] },
      { title: 'Inspect uneven lines', tasks: [] },
      { title: 'Adjust the mains', tasks: [] },
      { title: 'Set the brakes', tasks: [] },
    ];
    for (const k of a.integrity.implausible) {
      const l = a.lines.find(x => x.key === k);
      steps[0].tasks.push({ key: `implausible:${k}`, title: `Re-measure ${sideLabel(l.side)} ${l.lineId}`,
        sub: `${signed(l.rel)} is more than ${s.tolIndMm * 4} mm out — usually a mis-hooked line or a typo.`,
        amt: signed(l.rel, ''), keys: [k] });
    }
    for (const m of a.recommendations) {
      const keys = m.lineIds.map(id => keyFor(m.side, id));
      if (m.action === 'inspect') {
        steps[1].tasks.push({ key: m.key,
          title: `${m.sideLabel} ${m.id} — ${m.pinpointed.length ? `check ${m.pinpointed.join(', ')}` : 'uneven lines'}`,
          sub: m.pinpointed.length
            ? `${m.pinpointed.join(', ')} disagrees with the other side by more than ${s.tolIndMm} mm. Inspect it for shrinkage or damage and replace it — adjusting the main can't fix one line.`
            : `Lines ${m.outliers.join(', ')} spread ${m.spreadMm} mm within this main. Inspect them — adjusting the main moves the whole fan.`,
          amt: `${m.spreadMm}`, keys });
      } else if (m.action === 'note') {
        const brake = isBrakeRiser(m.riser);
        steps[brake ? 3 : 2].tasks.push({ key: m.key, method: brake ? 'brake' : null,
          title: `${m.sideLabel} ${brake ? 'brake' : m.id} — ${Math.abs(m.recommendMm)} mm ${m.recommendMm < 0 ? 'long' : 'short'}`,
          sub: brake ? 'Re-tie at the handle so both brakes match, keeping the factory free play.'
                     : 'Not a maillon adjustment — check this line and its attachment.',
          amt: signed(m.recommendMm, ''), keys });
      } else {
        const how = methodFor(m.recommendMm, m.hasLoop);
        steps[2].tasks.push({ key: m.key, sim: m, method: how.id,
          title: `${m.sideLabel} ${m.id} — ${m.action} ${Math.abs(m.recommendMm)} mm`,
          sub: how.text, amt: signed(m.recommendMm, ''), keys });
      }
    }
    // mains: biggest first, so the one that matters most is done first
    steps[2].tasks.sort((x, y) => Math.abs(parseFloat(y.amt)) - Math.abs(parseFloat(x.amt)));

    const active = steps.filter(st => st.tasks.length);
    if (!active.length) {
      if (!a.measuredCount) { host.appendChild(el(`<p class="muted">The plan appears once lines are measured.</p>`)); return; }
      host.appendChild(el(`<div class="allgood">${icon.ok} Nothing to adjust — every main is within ±${s.tolIndMm} mm on both sides.</div>`));
      return;
    }
    let n = 0;
    for (const st of active) {
      host.appendChild(el(`<p class="plan-step"><span>${++n}</span>${esc(st.title)}</p>`));
      const ul = el('<ul class="todo"></ul>');
      for (const t of st.tasks) ul.appendChild(taskItem(t));
      host.appendChild(ul);
    }
    host.appendChild(el(`<p class="plan-step"><span>${++n}</span>Re-measure what you changed, then test fly in calm air</p>`));
    if (Object.keys(s.simOffsets).length) {
      const off = el(`<button class="btn ghost sm" style="margin-top:8px">Clear previews</button>`);
      off.addEventListener('click', () => { s.simOffsets = {}; draw(); });
      host.appendChild(off);
    }
  }

  function taskItem(t) {
    const done = !!s.done[t.key];
    const simOn = t.sim && !!s.simOffsets[t.sim.key];
    const li = el(`<li class="${done ? 'done' : ''}">
      <button class="tick" aria-pressed="${done}" aria-label="Mark done">${icon.check}</button>
      <div class="what"><b>${esc(t.title)}</b><span>${esc(t.sub)}${t.method ? ` <a href="#guide" class="how" data-how="${t.method}">How →</a>` : ''}</span></div>
      <div class="amt num">${esc(t.amt)}</div>
      <div class="acts">
        ${t.sim ? `<button class="btn sm ${simOn ? 'primary' : 'soft'}" data-sim aria-pressed="${simOn}">${simOn ? icon.check : ''} Preview result</button>` : ''}
        <button class="btn sm soft" data-recheck>${icon.redo} Re-measure ${t.keys.length} line${t.keys.length > 1 ? 's' : ''}</button>
      </div></li>`);
    li.querySelector('.tick').addEventListener('click', () => { s.done[t.key] = !done; draft.set(s); draw(); });
    li.querySelector('.how')?.addEventListener('click', e => { e.preventDefault(); ctx.guideAnchor = t.method; ctx.goto('guide'); });
    li.querySelector('[data-sim]')?.addEventListener('click', () => {
      if (s.simOffsets[t.sim.key]) delete s.simOffsets[t.sim.key];
      else s.simOffsets[t.sim.key] = Math.round(t.sim.recommendMm);
      draw();
    });
    li.querySelector('[data-recheck]').addEventListener('click', () => {
      s.simOffsets = {};
      startRecheck(s, t.keys);
      draft.set(s);
      ctx.goto('measure');
    });
    return li;
  }

  // -------------------------------------------------------------- profiles
  function renderProfiles(host, a) {
    const yMax = profileScale(a.lines);
    let legendRows = null;
    const cards = [];
    for (const { id, label } of SIDES) {
      const lines = a.lines.filter(l => l.side === id);
      if (!lines.some(l => /^[A-E]$/.test(l.riser))) continue;
      const { svg, rows } = trimProfile({ lines, ribs: s.ribs, tol: s.tolIndMm, yMax, title: `${label} side` });
      legendRows = legendRows || rows;
      const card = el(`<div class="card chart-card"><div class="chart-title"><b>${label} side</b><span>deviation, mm</span></div></div>`);
      card.appendChild(svg);
      cards.push(card);
    }
    if (!cards.length) { host.appendChild(el(`<p class="muted">Measure some A–D lines to see the profile.</p>`)); return; }
    const legend = el(`<div class="legend" aria-label="Rows">${legendRows.map(r =>
      `<span><i style="background:var(--row-${r})"></i>${r} row</span>`).join('')}</div>`);
    host.appendChild(legend);
    cards.forEach(c => host.appendChild(c));
  }

  // ------------------------------------------------------------------- AoI
  function renderAoi(host, a) {
    const secs = new Map();
    for (const side of ['L', 'R']) for (const x of a.perSide[side]?.aoi || []) {
      if (!secs.has(x.section)) secs.set(x.section, { label: `${x.frontId} → ${x.rearId}`, L: null, R: null });
      secs.get(x.section)[side] = x.aoiMm;
    }
    if (!secs.size) { host.appendChild(el(`<p class="muted">Needs readings on the A row and a rear row.</p>`)); return; }
    const items = [...secs.entries()].sort((x, y) => x[0] - y[0]).map(([, v]) => v);
    const card = el(`<div class="card chart-card"><div class="chart-title"><b>Rear minus front, per section</b><span>+ faster · − slower</span></div></div>`);
    card.appendChild(aoiBars({ items, tol: s.tolIndMm }));
    const all = items.flatMap(i => [i.L, i.R]).filter(v => v != null);
    const avg = Math.round(all.reduce((x, y) => x + y, 0) / all.length * 10) / 10;
    card.appendChild(el(`<p class="small" style="margin:8px 6px 2px;color:var(--ink-2)">Wing average <b>${signed(avg)}</b> — ${esc(aoiNote(avg, s.tolIndMm))}</p>`));
    host.appendChild(card);
  }

  // --------------------------------------------------------------- details
  function renderDetails(host, a) {
    // reference
    const ref = el(`<div class="card flat"><label class="field" style="margin:0"><span>Deviations measured against</span>
      <select class="input" id="ref"></select></label>
      <p class="small muted" style="margin:8px 0 0">Uniform stretch is normal and barely changes how a wing flies, so by default every
      line is compared with the median of all lines. Pick a main to see everything relative to it.</p></div>`);
    const sel = ref.querySelector('select');
    sel.appendChild(el('<option value="auto">Median of all lines (recommended)</option>'));
    sel.appendChild(el('<option value="absolute">Factory lengths, absolute</option>'));
    for (const side of ['L', 'R']) for (const m of a.perSide[side]?.mains || []) {
      sel.appendChild(el(`<option value="main:${side}:${esc(m.id)}">${sideLabel(side)} ${esc(m.id)}</option>`));
    }
    sel.value = s.refMode;
    sel.addEventListener('change', () => { s.refMode = sel.value; draft.set(s); draw(); });
    host.appendChild(ref);

    // integrity
    const i = a.integrity;
    host.appendChild(el(`<p class="small muted" style="margin:10px 2px">
      ${i.laser} laser · ${i.manual} typed${i.imported ? ` · ${i.imported} imported` : ''} readings${i.editedAfterComplete ? ' · edited after completion' : ''}
      · measured from the ${s.measureFrom === 'maillon' ? `maillons (targets −${s.riserMm} mm)` : 'riser bottom'}
      · zero offset ${signed(s.refOffsetMm || 0)} · whole set ${signed(a.globalOffsetMm)} (allowance ±${a.tolGlobal} mm)</p>`));

    // left/right
    if (a.asymmetry.length) {
      host.appendChild(el('<h3>Left vs right, per main</h3>'));
      const t = el(`<div class="scroll-x"><table class="data"><thead><tr><th>Main</th><th>Left</th><th>Right</th><th>L − R</th></tr></thead><tbody></tbody></table></div>`);
      for (const x of a.asymmetry) t.querySelector('tbody').appendChild(el(`<tr><td>${esc(x.mainId)}</td>
        <td>${signed(x.leftMm, '')}</td><td>${signed(x.rightMm, '')}</td>
        <td><span class="status ${x.status}">${statusIcon(x.status)} ${signed(x.diffMm, '')}</span></td></tr>`));
      host.appendChild(t);
    }

    // every reading
    for (const { id, label } of SIDES) {
      const lines = a.lines.filter(l => l.side === id);
      if (!lines.length) continue;
      host.appendChild(el(`<h3>${label} side — every reading</h3>`));
      const t = el(`<div class="scroll-x"><table class="data"><thead><tr><th>Line</th><th>Target</th><th>Measured</th><th>vs ref</th><th>vs other side</th><th></th></tr></thead><tbody></tbody></table></div>`);
      const tb = t.querySelector('tbody');
      for (const l of lines) {
        const row = el(`<tr><td><span class="prov ${l.source}" title="${l.source}"></span>${esc(l.lineId)}</td>
          <td>${fmtMm(l.target)}</td><td>${fmtMm(l.measured)}</td>
          <td><span class="status ${l.implausible ? 'bad' : l.status}">${statusIcon(l.implausible ? 'bad' : l.status)} ${signed(l.rel, '')}</span></td>
          <td>${l.lrMm == null ? '–' : signed(l.lrMm, '')}</td>
          <td><button class="btn sm ghost" aria-label="Re-measure ${esc(l.lineId)}">${icon.redo}</button></td></tr>`);
        row.querySelector('button').addEventListener('click', () => { goto(s, l.key); ctx.goto('measure'); });
        tb.appendChild(row);
      }
      host.appendChild(t);
    }
    host.appendChild(el(`<p class="small muted" style="margin-top:8px"><span class="prov laser"></span>laser reading
      <span class="prov" style="margin-left:10px"></span>typed reading</p>`));
  }
}
