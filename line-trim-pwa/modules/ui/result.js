// ui/result.js — screen 4: what's wrong, what to do, and the picture.

import { $, $$, el, esc, clear, toast, signed, fmtMm, classBadge } from './dom.js?v=7';
import { icon, statusIcon } from './icons.js?v=7';
import { analyse, adjustHint, aoiNote } from '../trim.js?v=7';
import { RISER_ORDER, sideLabel, keyFor, SIDES, isBrakeRiser } from '../linemodel.js?v=7';
import { startRecheck, goto, progress } from '../session.js?v=7';
import { sessions, draft } from '../store.js?v=7';
import { exportJson, exportCsv, sessionSummaryText } from '../exporter.js?v=7';
import { trimProfile, profileScale, aoiBars, hideTip } from './charts.js?v=7';

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
      <div class="row" style="margin-bottom:6px">${classBadge(s.wingClass)}
        <b class="grow">${esc(s.brand)} ${esc(s.model)} · ${esc(s.sizeKey)}</b>
        <span class="small muted">${pr.done}/${pr.total} readings</span></div>
      <div id="verdict"></div>
      <div class="tiles" id="tiles"></div>
      <h2>What to do</h2>
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
      <div class="actions">
        <button class="btn primary" id="save">${icon.save} Save</button>
        <button class="btn" id="share">${icon.share} Share</button>
        <button class="btn soft" id="csv">${icon.download} CSV</button>
        <button class="btn soft" id="json">${icon.download} JSON</button>
      </div>
      <button class="btn ghost block" id="new" style="margin-top:6px">Start a new check</button>
    </div>`);
    root.appendChild(wrap);

    renderVerdict($('#verdict', wrap), a);
    renderTiles($('#tiles', wrap), a);
    renderTodo($('#todo', wrap), real);
    renderProfiles($('#profiles', wrap), a);
    renderAoi($('#aoi', wrap), a);
    const det = $('#details', wrap);
    det.addEventListener('toggle', () => { if (det.open && !$('#detail-body', wrap).childElementCount) renderDetails($('#detail-body', wrap), a); });

    $('#save', wrap).addEventListener('click', () => { s.savedAt = Date.now(); sessions.save(s); draft.clear(); toast('Saved to your history'); });
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

  // ------------------------------------------------------------------ todo
  function renderTodo(host, a) {
    const tasks = [];
    for (const k of a.integrity.implausible) {
      const l = a.lines.find(x => x.key === k);
      tasks.push({ key: `implausible:${k}`, kind: 'bad', title: `Re-measure ${sideLabel(l.side)} ${l.lineId}`,
        sub: `${signed(l.rel)} is more than ${s.tolIndMm * 4} mm out — usually a mis-hooked line or a typo.`,
        amt: signed(l.rel, ''), keys: [k] });
    }
    for (const m of a.recommendations) {
      const keys = m.lineIds.map(id => keyFor(m.side, id));
      if (m.action === 'inspect') {
        tasks.push({ key: m.key, kind: 'bad',
          title: `${m.sideLabel} ${m.id} — ${m.pinpointed.length ? `check ${m.pinpointed.join(', ')}` : 'uneven lines'}`,
          sub: m.pinpointed.length
            ? `${m.pinpointed.join(', ')} disagrees with the other side by more than ${s.tolIndMm} mm. Inspect it for shrinkage or damage — a main adjustment can't fix one line.`
            : `Lines ${m.outliers.join(', ')} spread ${m.spreadMm} mm within this main. Inspect them — a main adjustment moves the whole fan.`,
          amt: `${m.spreadMm}`, keys });
      } else if (m.action === 'note') {
        const brake = isBrakeRiser(m.riser);
        tasks.push({ key: m.key, kind: 'warn',
          title: `${m.sideLabel} ${brake ? 'brake' : m.id} — ${Math.abs(m.recommendMm)} mm ${m.recommendMm < 0 ? 'long' : 'short'}`,
          sub: brake ? 'Brakes aren\'t trimmed at the maillon: retie the brake knot, then check there\'s slack with full speedbar.'
                     : 'Not a maillon adjustment — check this line and its attachment.',
          amt: signed(m.recommendMm, ''), keys });
      } else {
        tasks.push({ key: m.key, kind: 'warn', sim: m,
          title: `${m.sideLabel} ${m.id} — ${m.action} ${Math.abs(m.recommendMm)} mm`,
          sub: adjustHint(m.recommendMm, m.hasLoop), amt: signed(m.recommendMm, ''), keys });
      }
    }

    if (!tasks.length) {
      host.appendChild(el(`<div class="allgood">${icon.ok} Nothing to adjust — every main is within ±${s.tolIndMm} mm on both sides.</div>`));
      return;
    }
    const ul = el('<ul class="todo"></ul>');
    for (const t of tasks) {
      const done = !!s.done[t.key];
      const simOn = t.sim && !!s.simOffsets[t.sim.key];
      const li = el(`<li class="${done ? 'done' : ''}">
        <button class="tick" aria-pressed="${done}" aria-label="Mark done">${icon.check}</button>
        <div class="what"><b>${esc(t.title)}</b><span>${esc(t.sub)}</span></div>
        <div class="amt num">${esc(t.amt)}</div>
        <div class="acts">
          ${t.sim ? `<button class="btn sm ${simOn ? 'primary' : 'soft'}" data-sim aria-pressed="${simOn}">${simOn ? icon.check : ''} Preview result</button>` : ''}
          <button class="btn sm soft" data-recheck>${icon.redo} Re-measure ${t.keys.length} line${t.keys.length > 1 ? 's' : ''}</button>
        </div></li>`);
      li.querySelector('.tick').addEventListener('click', () => { s.done[t.key] = !done; draft.set(s); draw(); });
      li.querySelector('[data-sim]')?.addEventListener('click', () => {
        if (s.simOffsets[t.sim.key]) delete s.simOffsets[t.sim.key];
        else s.simOffsets[t.sim.key] = Math.round(t.sim.recommendMm);
        draw();
      });
      li.querySelector('[data-recheck]').addEventListener('click', () => {
        s.simOffsets = {};           // re-measuring means the real wing again
        startRecheck(s, t.keys);
        draft.set(s);
        ctx.goto('measure');
      });
      ul.appendChild(li);
    }
    host.appendChild(ul);
    if (Object.keys(s.simOffsets).length) {
      const off = el(`<button class="btn ghost sm" style="margin-top:8px">Clear previews</button>`);
      off.addEventListener('click', () => { s.simOffsets = {}; draw(); });
      host.appendChild(off);
    }
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
      ${i.laser} laser · ${i.manual} typed readings${i.editedAfterComplete ? ' · edited after completion' : ''}
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
