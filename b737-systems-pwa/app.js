// 737 NG Inside — app shell. Wires the 3D scene, the system layers, hotspots,
// the page sheet, the phase modes and the operable schematics together.
//
// One state object per system ({ sw, fail, q, mem }) is the single source of
// truth: the 3D flows and the schematic both draw from the same evaluate().

import { makeEnv } from './modules/world.js?v=12';
import { createOutside } from './modules/outside.js?v=12';
import { createViewCube } from './modules/viewcube.js?v=12';
import { createAirLink } from './modules/airlink.js?v=12';
import { createQuickRef } from './modules/quickref.js?v=12';
import { installResumeHardening } from './modules/resume.js?v=12';
import { createScene } from './modules/scene.js?v=12';
import { buildAirframe } from './modules/airframe.js?v=12';
import { createSystems3D } from './modules/systems3d.js?v=12';
import { createOverlay } from './modules/overlay.js?v=12';
import { createSheet } from './modules/sheet.js?v=12';
import { PHASES, createPhaseAnimator } from './modules/phases.js?v=12';
import { SYSTEMS, READY } from './modules/systems.js?v=12';
import { createSearch } from './modules/search.js?v=12';
import { createNotes, applyHighlights, attachSelection } from './modules/notes.js?v=12';
import { createProgress } from './modules/progress.js?v=12';
import { createLearn } from './modules/learn.js?v=12';
import { explain } from './modules/cockpit-info.js?v=12';
import { engineFor, flightFor } from './modules/cockpit-displays.js?v=12';
import { createCockpit } from './modules/cockpit.js?v=12';

const $ = (id) => document.getElementById(id);

// Early module state lives up here, before anything reads it.
let phase = 'ground';
let sysId = null;
let partId = null;
let view = '3d';
let schem = null;          // mounted schematic { update }
let schemFor = null;
const states = new Map();  // system id → { sw, fail, q, mem }

const store = {
  get(k) { try { return localStorage.getItem('b737i.' + k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem('b737i.' + k, v); } catch { /* private mode */ } },
};

function init() {
  installResumeHardening();

  const api = createScene($('gl'));
  const airframe = buildAirframe(api.materials);
  api.setAirframe(airframe);
  const anim = createPhaseAnimator(airframe, api.world);
  anim.go('ground', true);
  const s3d = createSystems3D(api, airframe.root);
  // Lights, ground crew and carts, airflow — the world around the airplane.
  const outside = createOutside(api, airframe);
  // Fusion 360-style navigation cube (airplane views only).
  const viewcube = createViewCube(document.body, api, { onHome: () => $('home-btn').click() });
  // Pages light up (and move) the real airframe pieces they describe.
  const airlink = createAirLink(airframe);

  // ── Show menu: what to draw around the airplane (remembered per device) ──
  const SHOW_DEFAULT = { airflow: true, lights: true, crew: true, doors: false, evac: false, links: true };
  const show = (() => { try { return { ...SHOW_DEFAULT, ...JSON.parse(localStorage.getItem('b737inside.show') || '{}') }; } catch { return { ...SHOW_DEFAULT }; } })();
  for (const cb of document.querySelectorAll('[data-show]')) {
    cb.checked = !!show[cb.dataset.show];
    cb.addEventListener('change', () => {
      show[cb.dataset.show] = cb.checked;
      try { localStorage.setItem('b737inside.show', JSON.stringify(show)); } catch { /* private mode */ }
    });
  }
  const showMenu = (open) => {
    $('show-menu').hidden = !open;
    $('show-btn').classList.toggle('on', open);
    $('show-btn').setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('show-open', open);
  };
  $('show-btn').addEventListener('click', (e) => { e.stopPropagation(); showMenu($('show-menu').hidden); });
  document.addEventListener('pointerdown', (e) => { if (!e.target.closest('#show-menu, #show-btn')) showMenu(false); });
  for (const s of READY) s3d.build(s.mod);

  const overlay = createOverlay(api, $('leaders'), $('hotspots'), (id) => {
    if (id.startsWith('sys:')) selectSystem(id.slice(4)); else selectPart(id);
  });
  // ── Favorites & highlights ──
  const notes = createNotes();
  // Title + subtitle for a page key "sys" or "sys/part".
  const describe = (key) => {
    const [sid, pid] = key.split('/');
    const m = SYSTEMS.find((x) => x.id === sid)?.mod;
    if (!m) return { title: key };
    const p = pid && m.parts.find((q) => q.id === pid);
    return p ? { title: p.name, sub: m.title } : { title: m.title, sub: 'System' };
  };
  const progress = createProgress();
  const ST_COLOR = { new: '#c6c9cc', seen: '#74c0fc', learning: '#ffa94d', learned: '#40c057', review: '#be4bdb' };
  const ST_NAME = { new: 'New', seen: 'Seen', learning: 'Learning', learned: 'Learned', review: 'Review due' };
  function decorate(body, key) {
    if (!key || key === 'learn') return;
    progress.markSeen(key);
    // Learning status: on this page, and as a dot on each part chip.
    const st = progress.status(key);
    const kick = body.querySelector('.kicker');
    if (kick) kick.insertAdjacentHTML('afterend', `<div class="page-st no-hl"><i class="dot st-${st}"></i>${ST_NAME[st]}</div>`);
    const sid = key.split('/')[0];
    for (const c of body.querySelectorAll('.chips [data-rel]')) {
      const r = c.dataset.rel;
      if (r.startsWith('sys:')) continue;
      const k2 = `${sid}/${r}`;
      c.dataset.st = progress.status(k2);
      c.style.setProperty('--st', ST_COLOR[c.dataset.st]);
    }
    applyHighlights(body, notes.hls(key));
    const star = body.querySelector('[data-star]');
    if (star) {
      const on = notes.isFav(key);
      star.classList.toggle('on', on);
      star.textContent = on ? '★' : '☆';
      star.setAttribute('aria-label', on ? 'Remove from favorites' : 'Add to favorites');
    }
  }
  function showFavorites() {
    favOpen = true;
    sheet.favorites(notes.favs(), notes.hls());
  }
  let favOpen = false;

  const sheet = createSheet($('sheet'), $('sheet-body'), $('sheet-close'), {
    onRelated: (id) => (id.startsWith('sys:') ? selectSystem(id.slice(4)) : selectPart(id)),
    onClose: () => { favOpen = false; partId = null; s3d.select(null); overlay.setSelected(null); },
    onStar: (key) => { if (key) { notes.toggleFav(key, describe(key)); decorate($('sheet-body'), key); } },
    onUnfav: (key) => { notes.removeFav(key); showFavorites(); },
    onDelHL: (id) => { notes.removeHL(id); showFavorites(); },
    onGo: (key, hl) => goTo(key, hl),
    decorate,
  });
  attachSelection($('sheet-body'), $('hl-pop'), {
    getKey: () => sheet.key,
    notes,
    meta: () => describe(sheet.key || ''),
    onChange: () => {
      // Re-render the page so the new mark (or its removal) shows.
      const key = sheet.key;
      if (key) goTo(key, null, true);
    },
  });

  /** Open the page for "sys" or "sys/part", optionally flashing a highlight. */
  function goTo(key, hl, keepScroll = false) {
    favOpen = false;
    const [sid, pid] = key.split('/');
    const body = $('sheet-body');
    const top = body.scrollTop;
    if (sysId !== sid) selectSystem(sid);
    if (pid) selectPart(pid, keepScroll); else sheet.system(sysOf(sid).mod);
    if (view === 'schem' && !pid) sheet.system(sysOf(sid).mod);
    if (keepScroll) body.scrollTop = top;
    if (hl) {
      const m = body.querySelector(`mark[data-hl="${hl}"]`);
      if (m) { m.scrollIntoView({ block: 'center', behavior: 'smooth' }); m.classList.add('flash'); }
    }
  }

  // The sheet covers part of the screen: shift the camera's centre into the
  // free area and keep hotspot labels out of the sheet and the HUD bars.
  function relayout() {
    const sh = $('sheet');
    const narrow = window.innerWidth < 760;
    let right = 0, bottom = 0;
    if (!sh.hidden) {
      // offsetLeft/Top ignore the slide-in transform still running.
      if (narrow) bottom = window.innerHeight - sh.offsetTop; else right = window.innerWidth - sh.offsetLeft + 8;
    }
    api.setInsets(right, bottom);
    // Phase bar centres in the free area too.
    document.querySelector('.hud-bottom').style.left = `${(window.innerWidth - right) / 2}px`;
    // The lesson player follows: centred in the free area, above a bottom sheet.
    document.documentElement.style.setProperty('--free-cx', `${(window.innerWidth - right) / 2}px`);
    document.documentElement.style.setProperty('--sheet-b', `${bottom}px`);
    // In Split the airplane has the left half: keep the cube there.
    const splitW = document.body.classList.contains('view-split') && !narrow ? window.innerWidth / 2 : 0;
    document.documentElement.style.setProperty('--vc-right', `${Math.max(right, splitW)}px`);
    const obs = ['.hud-tl', '.hud-tr', '.hud-bottom', '.vc'].map((q) => {
      const r = document.querySelector(q).getBoundingClientRect();
      return { x: r.left - 4, y: r.top - 4, w: r.width + 8, h: r.height + 8 };
    });
    overlay.setBounds({ right, bottom }, obs);
  }
  new MutationObserver(relayout).observe($('sheet'), { attributes: true, attributeFilter: ['hidden'] });
  new MutationObserver(relayout).observe($('sys-list'), { attributes: true, attributeFilter: ['hidden'] });
  window.addEventListener('resize', relayout);

  // ── Theme ──
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  let theme = store.get('theme') || (prefersDark ? 'dark' : 'light');
  function applyTheme() {
    document.documentElement.dataset.theme = theme;
    document.querySelector('meta[name="theme-color"]').content = theme === 'dark' ? '#0e1013' : '#efefed';
    api.applyTheme(theme);
  }
  applyTheme();
  $('theme-btn').addEventListener('click', () => {
    theme = theme === 'dark' ? 'light' : 'dark';
    store.set('theme', theme);
    applyTheme();
  });

  // ── System state ──
  const sysOf = (id) => SYSTEMS.find((s) => s.id === id);
  // The phase sets the scene; the real models (engines, electrical,
  // hydraulics, flaps, gear…) say what is actually running — see world.js.
  const env = () => makeEnv({ PHASES, phase, stateOf, sysOf });
  function stateOf(id) {
    if (!states.has(id)) states.set(id, sysOf(id).mod.normal(phase));
    return states.get(id);
  }
  function evaluate(id) {
    const s = sysOf(id);
    const e = env();
    // Warning systems listen to every other system.
    if (s.mod.needsOthers) e.resOf = (o) => (o !== id && sysOf(o)?.mod ? evaluate(o) : null);
    const res = s.mod.evaluate(e, stateOf(id));
    res.env = e;
    return res;
  }

  function refresh() {
    let note = '';
    const inCockpit = view === 'cockpit' && cockpit;
    const results = {};
    for (const s of READY) {
      if (s.id !== sysId && !inCockpit) continue;
      const res = evaluate(s.id);
      results[s.id] = res;
      if (s.id === sysId) {
        s3d.apply(s.id, res);
        if (schem && schemFor === s.id) schem.update(res);
        note = res.note || '';
      }
      if (inCockpit) cockpit.update(s.id, res);
    }
    if (inCockpit) cockpit.setData(cockpitData(results));
    $('phase-note').textContent = PHASES[phase].note.toUpperCase() + (note ? ' — ' + note : '');
  }

  // ── Systems list / prev-next ──
  const list = $('sys-list');
  const pad = (n) => String(n).padStart(2, '0');
  for (const s of SYSTEMS) {
    const b = document.createElement('button');
    b.className = 'tag tag-btn' + (s.ready ? '' : ' soon');
    b.innerHTML = `<span class="sw" style="background:${s.color}"></span>[${pad(s.num)}] ${s.title}${s.ready ? '' : '<span class="soon-l">soon</span>'}`;
    b.disabled = !s.ready;
    b.addEventListener('click', () => { toggleList(false); selectSystem(s.id); });
    list.append(b);
  }
  const ov = document.createElement('button');
  ov.className = 'tag tag-btn';
  ov.innerHTML = `<span class="sw" style="background:var(--tag-fg)"></span>[00] Overview`;
  ov.addEventListener('click', () => { toggleList(false); selectSystem(null); });
  list.prepend(ov);
  function toggleList(v = list.hidden) {
    list.hidden = !v;
    $('sys-current').setAttribute('aria-expanded', String(v));
  }
  $('sys-current').addEventListener('click', () => toggleList());
  const cycle = [null, ...READY.map((s) => s.id)];
  $('sys-prev').addEventListener('click', () => selectSystem(cycle[(cycle.indexOf(sysId) - 1 + cycle.length) % cycle.length]));
  $('sys-next').addEventListener('click', () => selectSystem(cycle[(cycle.indexOf(sysId) + 1) % cycle.length]));

  // ── Selection ──
  function hotspotsFor(id) {
    if (!id) {
      return READY.filter((s) => s.mod.anchor).map((s) => ({ id: 'sys:' + s.id, label: s.title, at: s.mod.anchor }));
    }
    return sysOf(id).mod.parts.map((p) => ({ id: p.id, label: p.short || p.name, at: p.at }));
  }

  function selectSystem(id, quiet = false) {
    sysId = id;
    partId = null;
    s3d.show(id);
    s3d.select(null);
    api.setXray(id ? 1 : 0);
    overlay.set(hotspotsFor(id));
    const s = id && sysOf(id);
    $('sys-current').textContent = id ? `[${pad(s.num)}] ${s.title.toUpperCase()} ▾` : '[00] OVERVIEW ▾';
    if (view === 'schem' || view === 'cockpit' || quiet) sheet.hide(); else if (id) sheet.system(s.mod); else sheet.overview(SYSTEMS);
    const v = s?.mod.view;
    if (v) api.flyTo(new api.THREE.Vector3(...v.target), v.dist, new api.THREE.Vector3(...v.dir), 1100);
    else api.home();
    if (view === 'schem' || view === 'split') mountSchematic();
    refresh();
  }

  function selectPart(id, noFly = false) {
    if (!sysId) return;
    const s = sysOf(sysId);
    const idx = s.mod.parts.findIndex((p) => p.id === id);
    if (idx < 0) return;
    const p = s.mod.parts[idx];
    partId = id;
    s3d.select(id);
    overlay.setSelected(id);
    sheet.part(s.mod, p, idx);
    if (view === '3d' && !noFly) {
      // Keep the part left of the sheet on wide screens by aiming a bit right of it.
      const t = api.worldOf(p.at);
      api.flyTo(t, p.zoom ?? 15, null, 900);
    }
  }

  api.setPick((part) => {
    if (part) selectPart(part);
    else if (partId && sysId) { partId = null; s3d.select(null); overlay.setSelected(null); sheet.system(sysOf(sysId).mod); }
  });

  // ── Phases ──
  function setPhase(p) {
    phase = p;
    for (const b of document.querySelectorAll('#phases [data-phase]')) b.classList.toggle('on', b.dataset.phase === p);
    anim.go(p);
    // Each phase starts from its normal configuration; failures you set stay.
    for (const [id, st] of states) {
      const fresh = sysOf(id).mod.normal(p);
      st.sw = fresh.sw;
      if (fresh.q && sysOf(id).mod.phaseQty) st.q = fresh.q;
      if (fresh.mem) st.mem = fresh.mem;
    }
    refresh();
  }
  $('phases').addEventListener('click', (e) => {
    const b = e.target.closest('[data-phase]');
    if (b) setPhase(b.dataset.phase);
  });

  // ── 3D / Schematic ──
  // ── Views: Airplane · Schematic · Split · Cockpit ──
  let cockpit = null;
  const MCP_LIT = { ground: [], takeoff: ['N1'], cruise: ['LNAV', 'VNAV', 'CMD A'], landing: [] };
  function cockpitData(r) {
    const e = env();
    const hf = states.get('hydraulics')?.fail || {};
    return {
      phase, env: e, flight: (() => {
        const f = flightFor(phase), af = r.autoflight?.values;
        return af ? { ...f, fma: af.fma, fmaArm: af.arm, ap: af.status } : f;
      })(),
      ...(() => {
        const ev = r.engines?.values.e;
        if (!ev) return { e1: engineFor(phase, e.eng1 && !hf.eng1), e2: engineFor(phase, e.eng2 && !hf.eng2) };
        const base = (i) => engineFor(phase, ev[i].run);
        return { e1: { ...base(0), n1: ev[0].n1, n2: ev[0].n2, egt: ev[0].egt, ff: ev[0].ff },
          e2: { ...base(1), n1: ev[1].n1, n2: ev[1].n2, egt: ev[1].egt, ff: ev[1].ff } };
      })(),
      levers: { l1: stateOf('engines').sw.lever1, l2: stateOf('engines').sw.lever2 },
      flapLever: stateOf('flightcontrols').sw.flap, gearLever: stateOf('gear').sw.lever, sb: stateOf('flightcontrols').sw.sb,
      rev: phase === 'landing', fuel: r.fuel?.values, tai: r.antiice?.values.tai, warn: r.warnings?.values, dus: r.instruments?.values.du, capIas: r.instruments?.values.capIas, hyd: r.hydraulics?.values,
      tat: { ground: 18, takeoff: 16, cruise: -32, landing: 12 }[phase], mcp: r.autoflight?.values.lit || new Set(MCP_LIT[phase]),
    };
  }
  /** The switch/failure context for one system (shared by schematic and cockpit). */
  function ctxFor(id) {
    const s = sysOf(id);
    return {
      get sw() { return stateOf(id).sw; },
      get fail() { return stateOf(id).fail; },
      set(k, v) { stateOf(id).sw[k] = v; refresh(); },
      toggleFail(k) { const f = stateOf(id).fail; f[k] = !f[k]; refresh(); },
      action(k, label) {
        const e = env();
        if (s.mod.needsOthers) e.resOf = (o) => (o !== id && sysOf(o)?.mod ? evaluate(o) : null);
        s.mod.action?.(stateOf(id), k, label, e); refresh();
      },
      onPart(pid) { selectPart(pid); },
      reset() { states.set(id, s.mod.normal(phase)); refresh(); },
      env,
      ctxOf: (other) => ctxFor(other),
      resOf: (other) => (sysOf(other)?.mod ? evaluate(other) : null),
    };
  }
  function showInfo(ev) {
    const x = explain(READY, ev);
    $('cp-info-t').textContent = x.title;
    $('cp-info-pos').textContent = x.pos ? `Now: ${x.pos}` : '';
    $('cp-info-pos').hidden = !x.pos;
    $('cp-info-text').textContent = x.text;
    const go = $('cp-info-go');
    go.hidden = !x.page;
    go.textContent = x.page ? `Open “${x.pageTitle}” ›` : '';
    go.dataset.page = x.page || '';
    $('cp-info').hidden = false;
  }
  $('cp-info-x').addEventListener('click', () => { $('cp-info').hidden = true; });
  $('cp-info-go').addEventListener('click', () => { const p = $('cp-info-go').dataset.page; if (p) goTo(p); });
  for (const b of document.querySelectorAll('[data-look]')) b.addEventListener('click', () => cockpit?.goView(b.dataset.look));

  function setView(v) {
    const was = view;
    view = v;
    for (const b of document.querySelectorAll('[data-view]')) {
      const on = b.dataset.view === v;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    document.body.classList.remove('view-3d', 'view-schem', 'view-split', 'view-cockpit');
    document.body.classList.add('view-' + v);
    const sch = v === 'schem' || v === 'split';
    $('schematic').hidden = !sch;
    overlay.visible(v === '3d' || v === 'split');
    viewcube.visible = v === '3d' || v === 'split';
    relayout();
    $('hint').classList.add('gone');
    api.pause(v === 'schem');
    if (sch) { if (v === 'schem') sheet.hide(); mountSchematic(); } else { schem = null; schemFor = null; }
    // Cockpit: built the first time it's opened (it renders every panel).
    if (v === 'cockpit') {
      if (!cockpit) cockpit = createCockpit({
        canvas: api.canvas, systems: READY, ctxFor, onControl: showInfo,
        // Start levers in the cockpit work: they toggle CUTOFF / IDLE.
        onLever(name) {
          if (name === 'Flap lever' || name === 'Speed brake lever') {
            const st = stateOf('flightcontrols');
            const k = name === 'Flap lever' ? 'flap' : 'sb', n = k === 'flap' ? 9 : 4;
            st.sw[k] = (st.sw[k] + 1) % n;
            refresh();
            return k === 'flap' ? (['UP', '1', '2', '5', '10', '15', '25', '30', '40'][st.sw.flap]) : ['DOWN', 'ARMED', 'FLIGHT DETENT', 'UP'][st.sw.sb];
          }
          if (name === 'Landing gear lever') {
            const st = stateOf('gear');
            st.sw.lever = st.sw.lever === 2 ? 0 : 2;
            if (!env().air && st.sw.lever === 0) { st.sw.lever = 2; refresh(); return 'DN — lever lock (on the ground)'; }
            refresh();
            return ['UP', 'OFF', 'DN'][st.sw.lever];
          }
          const m = name.match(/^Start lever (\d)$/);
          if (!m) return false;
          const st = stateOf('engines');
          st.sw[`lever${m[1]}`] = st.sw[`lever${m[1]}`] ? 0 : 1;
          refresh();
          return st.sw[`lever${m[1]}`] ? 'IDLE' : 'CUTOFF';
        },
      });
      sheet.hide();
      api.setMode('cockpit', cockpit);
      cockpit.enter();
      $('cp-bar').hidden = false;
      const h = document.querySelector('.cp-hint');
      h.classList.remove('gone');
      setTimeout(() => h.classList.add('gone'), 6000);
    } else if (was === 'cockpit') {
      cockpit?.exit();
      api.setMode('airplane');
      $('cp-bar').hidden = true;
      $('cp-info').hidden = true;
    }
    relayout();
    refresh();
  }
  for (const b of document.querySelectorAll('[data-view]')) b.addEventListener('click', () => setView(b.dataset.view));

  function mountSchematic() {
    const s = sysId && sysOf(sysId);
    if (!s?.schem) {
      $('schem-svg').innerHTML = `<div class="schem-empty">${s ? 'Schematic coming soon' : 'Pick a system (top left) to operate it'}</div>`;
      $('schem-panel').replaceChildren();
      $('schem-panel').hidden = true;
      schem = null; schemFor = null;
      return;
    }
    if (schemFor === s.id && schem) return;
    $('schem-panel').hidden = false;
    schem = s.schem.mount($('schem-svg'), $('schem-panel'), ctxFor(s.id));
    schemFor = s.id;
  }

  // ── Frame loop pieces ──
  api.onFrame((dt) => {
    cockpit?.frame(dt);
    viewcube.frame(dt);
    const fcs = states.get('flightcontrols');
    const gr = states.get('gear');
    // The open page can move its piece of the airplane (aileron, rudder, doors…).
    airlink.select(show.links && sysId && view !== 'cockpit' ? { sys: sysId, part: partId, color: sysOf(sysId).color } : null);
    const ex = airlink.frame(dt);
    const { doors: exDoors, ...exPose } = ex;
    if (fcs) anim.setOverride({ flaps: fcs.mem.flap, slats: fcs.mem.le, speedbrake: [0, 0, 0.55, 1][fcs.sw.sb], ...(gr ? { gear: gr.mem.pos } : {}), ...exPose });
    // Doors: open in Airplane General (instructor), from the Show menu, or for the Doors page.
    {
      const gen = stateOf('general'), open = gen.mem.open || {}, all = show.doors || show.evac || !!exDoors;
      const onGround = !PHASES[phase].env.air;
      const doorT = {}, slideT = {};
      for (const k of ['fwdEntry', 'fwdSvc', 'aftEntry', 'aftSvc', 'fwdCargo', 'aftCargo']) doorT[k] = onGround && (all || !!open[k]);
      for (const k of ['owL1', 'owL2', 'owR1', 'owR2']) doorT[k] = onGround && (show.evac || !!exDoors);
      if (show.evac && onGround) for (const k of ['fwdEntry', 'fwdSvc', 'aftEntry', 'aftSvc']) slideT[k] = true;
      if (show.evac) { doorT.fwdCargo = false; doorT.aftCargo = false; }
      airframe.setDoors(doorT, slideT, show.evac && onGround);
      airframe.doorsFrame(dt);
    }
    anim.frame(dt);
    {
      const gen = stateOf('general'), e = PHASES[phase].env;
      outside.update(dt, {
        phase, air: e.air, tas: flightFor(phase).tas, lights: show.lights ? gen.sw : {}, gpu: gen.sw.gpuCart, pca: gen.sw.acCart,
        airflow: show.airflow, crew: show.crew,
        gearDown: (states.get('gear')?.mem.pos ?? 1) > 0.5,
      });
    }
    s3d.frame(dt);
    overlay.frame();
  });
  // System ticks (leaks draining, fuel burning) run in both views.
  let lastTick = performance.now();
  setInterval(() => {
    const now = performance.now();
    const dt = Math.min(0.5, (now - lastTick) / 1000);
    lastTick = now;
    let moved = false;
    for (const s of READY) {
      if (!states.has(s.id) || !s.mod.tick) continue;
      if (s.mod.tick(dt, stateOf(s.id), env())) moved = true;
    }
    if (moved) refresh();
  }, 100);

  // ── Learn by voice ──
  const learn = createLearn({
    systems: READY, progress, describe, sheet,
    goTo: (key) => goTo(key),
    els: {
      body: $('sheet-body'), player: $('player'), plK: $('pl-k'), plT: $('pl-t'), plProg: $('pl-prog'),
      plPlay: $('pl-play'), plNext: $('pl-next'), plPrev: $('pl-prev'), plBack: $('pl-back'), plFwd: $('pl-fwd'),
      plRate: $('pl-rate'), plRateV: $('pl-rate-v'), plSlower: $('pl-slower'), plFaster: $('pl-faster'), plClose: $('pl-close'),
      quiz: $('quiz'), card: $('quiz-card'),
    },
  });
  $('learn-btn').addEventListener('click', () => (sheet.key === 'learn' && !$('sheet').hidden ? sheet.hide() : learn.dashboard()));

  // ── Quick reference (memory items, maneuvers, limits) ──
  const quickref = createQuickRef(sheet, SYSTEMS);
  $('qr-btn').addEventListener('click', () => (sheet.key === 'quickref' && !$('sheet').hidden ? sheet.hide() : quickref.open()));

  // ── Search ──
  const search = createSearch($('search'), READY, (sid, pid) => goTo(pid ? `${sid}/${pid}` : sid));
  $('search-btn').addEventListener('click', () => search.open());
  $('fav-btn').addEventListener('click', () => (favOpen && !$('sheet').hidden ? (sheet.hide(), favOpen = false) : showFavorites()));

  $('home-btn').addEventListener('click', () => {
    const v = sysId && sysOf(sysId).mod.view;
    if (v) api.flyTo(new api.THREE.Vector3(...v.target), v.dist, new api.THREE.Vector3(...v.dir), 900);
    else api.home();
  });

  // Hint fades after the first interaction.
  const gone = () => $('hint').classList.add('gone');
  $('gl').addEventListener('pointerdown', gone, { once: true });
  setTimeout(gone, 9000);

  // Keyboard: ← → cycle systems, Esc closes the sheet.
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if (e.key === '/' || ((e.metaKey || e.ctrlKey) && e.key === 'k')) { e.preventDefault(); search.open(); return; }
    if (e.key === 'ArrowRight') $('sys-next').click();
    else if (e.key === 'ArrowLeft') $('sys-prev').click();
    else if (e.key === 'Escape') { sheet.hide(); partId = null; s3d.select(null); overlay.setSelected(null); }
  });

  document.body.classList.add('view-3d');
  selectSystem(null, true);
  relayout();
  api.start();
  window.__booted = true;
  // Debug handle for local development only.
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__app = { api, airframe, anim, s3d, states, get cockpit() { return cockpit; } };

  if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
