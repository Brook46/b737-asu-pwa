// 737 NG Inside — app shell. Wires the 3D scene, the system layers, hotspots,
// the page sheet, the phase modes and the operable schematics together.
//
// One state object per system ({ sw, fail, q, mem }) is the single source of
// truth: the 3D flows and the schematic both draw from the same evaluate().

import { makeEnv } from './modules/world.js?v=15';
import { createOutside } from './modules/outside.js?v=15';
import { createViewCube } from './modules/viewcube.js?v=15';
import { createAirLink } from './modules/airlink.js?v=15';
import { createQuickRef } from './modules/quickref.js?v=15';
import { installResumeHardening } from './modules/resume.js?v=15';
import { createScene } from './modules/scene.js?v=15';
import { buildAirframe } from './modules/airframe.js?v=15';
import { createSystems3D } from './modules/systems3d.js?v=15';
import { createOverlay } from './modules/overlay.js?v=15';
import { createSheet } from './modules/sheet.js?v=15';
import { PHASES, createPhaseAnimator } from './modules/phases.js?v=15';
import { SYSTEMS, READY } from './modules/systems.js?v=15';
import { createSearch } from './modules/search.js?v=15';
import { createNotes, applyHighlights, attachSelection } from './modules/notes.js?v=15';
import { createProgress } from './modules/progress.js?v=15';
import { createLearn } from './modules/learn.js?v=15';
import { explain } from './modules/cockpit-info.js?v=15';
import { engineFor, flightFor } from './modules/cockpit-displays.js?v=15';
import { createCockpit } from './modules/cockpit.js?v=15';
import { nav, geo, loadNav } from './modules/navdb.js?v=15';
import { createFMC } from './modules/fmc.js?v=15';
import { createCDU } from './modules/cdu.js?v=15';
import { createCDUView } from './modules/cdu-view.js?v=15';
import { createFlightSim } from './modules/flightsim.js?v=15';

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
  const env = () => makeEnv({ PHASES, phase, stateOf, sysOf, flight: sim?.flying ? sim.flight() : null });
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

  // ── FMC, CDU and the flight that flies its route ──
  const fuelKg = () => { const q = stateOf('fuel').q || {}; return (q.c || 0) + (q.m1 || 0) + (q.m2 || 0); };
  const fmc = createFMC({ fuelKg, aircraft: () => sim?.ac || null });
  const cdu = createCDU(fmc, {
    aircraft: () => sim?.ac || null,
    vnavStage: () => sim?.vnavStage() || '',
    enterIrsPos: () => ctxFor('fms').action('enterPos'),
  });
  const cduView = createCDUView(cdu, fmc, { onKey: () => refresh() });
  const sim = createFlightSim({
    fmc,
    af: () => { const st = stateOf('autoflight'); return { mem: st.mem, sw: st.sw, bank: [10, 15, 20, 25, 30][st.sw.bank], action: (k) => ctxFor('autoflight').action(k) }; },
    flaps: () => stateOf('flightcontrols').sw.flap,
    setFlap: (i) => { stateOf('flightcontrols').sw.flap = i; },
    gearLever: () => stateOf('gear').sw.lever,
    setGear: (v) => { stateOf('gear').sw.lever = v; },
    engines: () => { const e = stateOf('engines').mem.e; return e[0].run && e[1].run; },
  });
  let ndRange = 40;
  // Load the navigation database once the app is up (it is precached).
  setTimeout(() => loadNav('data/navdb.json').then(() => cduView.render()).catch(() => {}), 1200);

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
    const pn = sim.flying ? `${fmc.S.route.origin || ''}–${fmc.S.route.dest || ''} · ${sim.ac.stage} · ${Math.round(sim.ac.ias)} kt · ${Math.round(sim.ac.alt)} ft` : PHASES[phase].note;
    $('phase-note').textContent = pn.toUpperCase() + (note ? ' — ' + note : '');
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
  function setPhase(p, keepSim = false) {
    if (!keepSim) sim.stop();
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
  /** What the ND MAP draws: the airplane, the FMC route, runways, T/C, T/D. */
  function navData() {
    if (!nav.ready) return null;
    const S = fmc.S, route = fmc.route();
    let ac = null;
    if (sim.flying) ac = { lat: sim.ac.lat, lon: sim.ac.lon, trk: sim.ac.trk };
    else {
      const o = S.route.origin || route.origin, rw = o && (S.route.depRwy || route.depRwy) && nav.runway(o, S.route.depRwy || route.depRwy);
      const ap = o && nav.airport(o);
      if (rw) ac = { lat: rw.lat, lon: rw.lon, trk: rw.hdgT };
      else if (ap) ac = { lat: ap.lat, lon: ap.lon, trk: 0 };
    }
    if (!ac) return null;
    ac.trkM = (ac.trk - nav.magVar(ac) + 360) % 360;
    const legs = S.active ? fmc.activeLegs() : fmc.legs();
    const rwys = [], apts = [];
    for (const [apt, id, arr] of [[route.origin, route.depRwy, false], [route.dest, route.arrRwy, true]]) {
      if (!apt) continue;
      const rw = id && nav.runway(apt, id);
      if (rw) rwys.push({ ...rw, far: geo.dest(rw, rw.hdgT, rw.len / 6076), ext: arr ? geo.dest(rw, (rw.hdgT + 180) % 360, 14) : null, label: `${apt} ${id}` });
      else { const a = nav.airport(apt); if (a) apts.push(a); }
    }
    // T/C and T/D along the route, while still ahead.
    let tc = null, tod = null, to = null, vdev = null;
    const prof = fmc.profile(S.active ? S.route : route);
    const pointAt = (sAlong) => {
      let acc = 0;
      for (let i = 1; i < prof.legs.length; i++) {
        const l = prof.legs[i], d = l.dist || 0;
        if (acc + d >= sAlong) { const a = prof.legs[i - 1]; return geo.dest(a, geo.brg(a, l), sAlong - acc); }
        acc += d;
      }
      return null;
    };
    if (prof.tc != null) {
      const dtg = sim.flying ? fmc.dtg(sim.ac) : null, along = dtg != null ? prof.total - dtg : 0;
      if (prof.tc > along + 0.5) tc = pointAt(prof.tc);
      if (prof.tod > along + 0.5) tod = pointAt(prof.tod);
      if (sim.flying && sim.ac.vnav === 'descent' && dtg != null) vdev = sim.ac.alt - fmc.pathAlt(dtg);
    }
    if (S.active && sim.flying) {
      const w = fmc.activeLegs()[S.activeIdx];
      if (w) {
        const d = geo.dist(sim.ac, w), t = new Date(Date.now() + (d / Math.max(100, sim.ac.gs)) * 3600000);
        to = { ident: w.ident, dist: d, eta: `${String(t.getUTCHours()).padStart(2, '0')}${String(t.getUTCMinutes()).padStart(2, '0')}.${Math.floor(t.getUTCSeconds() / 6)}z` };
      }
    }
    return { ac, legs, active: S.active, activeIdx: S.activeIdx, mod: S.active && fmc.mod ? fmc.legs() : null, rwys, apts, tc, tod, to, vdev, range: ndRange };
  }
  function cockpitData(r) {
    const e = env();
    const hf = states.get('hydraulics')?.fail || {};
    return {
      phase, env: e, nav: navData(), mcpHdg: r.autoflight?.values.fma?.[1] === 'HDG SEL' ? r.autoflight.values.hdg : null,
      flight: (() => {
        const sf = sim.flying ? sim.flight() : null;
        const f = sf ? { ...flightFor('cruise'), ...sf } : flightFor(phase), af = r.autoflight?.values;
        if (sf && af) {
          const vnav = af.fma[2]?.startsWith('VNAV');
          f.spdTgt = vnav ? null : af.spd;
          f.altTgt = af.alt;
          const v = fmc.vspeeds();
          if (sf.onGround && sf.stage !== 'rollout' && sf.stage !== 'stopped') f.vBugs = [['V1', fmc.S.tko.v1 ?? v?.v1], ['VR', fmc.S.tko.vr ?? v?.vr]].filter((b) => b[1]);
        }
        return af ? { ...f, fma: af.fma, fmaArm: af.arm, ap: af.status } : f;
      })(),
      ...(() => {
        const ev = r.engines?.values.e;
        if (!ev) return { e1: engineFor(phase, e.eng1 && !hf.eng1), e2: engineFor(phase, e.eng2 && !hf.eng2) };
        const base = (i) => engineFor(phase, ev[i].run);
        const out = { e1: { ...base(0), n1: ev[0].n1, n2: ev[0].n2, egt: ev[0].egt, ff: ev[0].ff },
          e2: { ...base(1), n1: ev[1].n1, n2: ev[1].n2, egt: ev[1].egt, ff: ev[1].ff } };
        // Flying the route: thrust follows the flight (rough numbers).
        if (sim.flying) for (const [k, i] of [['e1', 0], ['e2', 1]]) if (ev[i].run) {
          const n1 = sim.ac.n1;
          Object.assign(out[k], { n1, n2: 58 + n1 * 0.42, egt: 380 + n1 * 5, ff: +(0.25 + Math.max(0, n1 - 22) * 0.04).toFixed(2) });
        }
        return out;
      })(),
      levers: { l1: stateOf('engines').sw.lever1, l2: stateOf('engines').sw.lever2 },
      flapLever: stateOf('flightcontrols').sw.flap, gearLever: stateOf('gear').sw.lever, park: !!stateOf('gear').sw.park, sb: stateOf('flightcontrols').sw.sb,
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
      openCdu: () => cduView.show(),
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
        canvas: api.canvas, systems: READY, ctxFor,
        onControl: (ev) => (ev.kind === 'cdu' ? cduView.show() : showInfo(ev)),
        cdu: { screen: () => cdu.render(), exec: () => fmc.execLit, msg: () => !!fmc.S.msg },
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
      $('cp-sim').hidden = false;
      const h = document.querySelector('.cp-hint');
      h.classList.remove('gone');
      setTimeout(() => h.classList.add('gone'), 6000);
    } else if (was === 'cockpit') {
      cockpit?.exit();
      api.setMode('airplane');
      $('cp-bar').hidden = true;
      $('cp-sim').hidden = true;
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
    const flying = sim.flying ? sim.ac : null;
    const simPose = flying ? { y: flying.onGround ? 0 : Math.min(5, 1 + flying.ra / 400), pitch: flying.pitch, bank: flying.bank } : {};
    if (fcs) anim.setOverride({ flaps: fcs.mem.flap, slats: fcs.mem.le, speedbrake: [0, 0, 0.55, 1][fcs.sw.sb], ...(gr ? { gear: gr.mem.pos } : {}), ...exPose, ...simPose });
    // Doors: open in Airplane General (instructor), from the Show menu, or for the Doors page.
    {
      const gen = stateOf('general'), open = gen.mem.open || {}, all = show.doors || show.evac || !!exDoors;
      const onGround = sim.flying ? sim.ac.onGround : !PHASES[phase].env.air;
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
        phase, air: sim.flying ? !sim.ac.onGround : e.air, tas: sim.flying ? sim.ac.tas : flightFor(phase).tas, lights: show.lights ? gen.sw : {}, gpu: gen.sw.gpuCart, pca: gen.sw.acCart,
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
    if (sim.flying) {
      sim.tick(dt);
      // The phase follows the flight without resetting any switch.
      const a = sim.ac, flaps = stateOf('flightcontrols').sw.flap;
      const want = a.stage === 'rollout' || a.stage === 'stopped' ? 'landing' : a.onGround || flaps > 0 && a.vnav === 'climb' ? 'takeoff' : 'cruise';
      if (want !== phase) softPhase(want);
      simStatus();
      moved = true;
    }
    if (moved) refresh();
  }, 100);
  function softPhase(p) {
    phase = p;
    for (const b of document.querySelectorAll('#phases [data-phase]')) b.classList.toggle('on', b.dataset.phase === p);
    anim.go(p);
  }
  function simStatus() {
    const a = sim.ac, o = $('sim-state');
    if (!o) return;
    if (!a) { o.textContent = fmc.S.active ? 'ROUTE ACTIVE · LINE UP' : 'CDU: RTE → ACTIVATE → EXEC'; return; }
    const f = sim.flight();
    o.textContent = `${a.stage.toUpperCase()} · ${Math.round(f.ias)} KT · ${f.alt >= 18000 ? 'FL' + Math.round(f.alt / 100) : Math.round(f.alt) + ' FT'}${sim.paused ? ' · PAUSED' : ''}`;
  }
  // ── Flight controls in the cockpit bar ──
  $('sim-cdu').addEventListener('click', () => cduView.toggle());
  $('sim-lineup').addEventListener('click', () => {
    if (!fmc.S.active) { fmc.msg('ACTIVATE ROUTE'); cduView.show(); return; }
    setPhase('takeoff');
    const r = fmc.S.route, af = stateOf('autoflight'), fc = stateOf('flightcontrols');
    const err = sim.lineUp();
    if (err) { fmc.msg(err); cduView.show(); return; }
    // Ready for takeoff: LNAV / VNAV armed, flaps set, MCP at the cruise altitude, V2 in the speed window.
    Object.assign(af.mem, { at: 'ARM', lat: '', latArm: 'LNAV', pit: '', pitArm: 'VNAV', cmdA: false, cmdB: false, app: false, step: -1,
      alt: fmc.S.perf.crzAlt || 10000, spd: fmc.S.tko.v2 || fmc.vspeeds()?.v2 || 150, hdg: Math.round(((sim.ac.trk - nav.magVar(sim.ac)) + 360) % 360) });
    af.sw.atArm = 1; af.sw.fdL = 1; af.sw.fdR = 1;
    const det = [0, 1, 2, 5, 10, 15, 25, 30, 40].indexOf(fmc.S.tko.flaps);
    fc.sw.flap = det < 0 ? 3 : det; fc.mem.flap = fmc.S.tko.flaps;
    stateOf('gear').sw.lever = 2; stateOf('gear').sw.park = 0;
    void r;
    softPhase('takeoff');
    simStatus(); refresh();
  });
  $('sim-toga').addEventListener('click', () => {
    if (!sim.flying) $('sim-lineup').click();
    if (sim.flying) { ctxFor('autoflight').action('TOGA'); sim.paused = false; }
  });
  $('sim-pause').addEventListener('click', () => { sim.paused = !sim.paused; $('sim-pause').textContent = sim.paused ? '▶' : '❚❚'; simStatus(); });
  $('sim-rate').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rate]');
    if (!b) return;
    sim.rate = +b.dataset.rate;
    for (const x of $('sim-rate').children) x.classList.toggle('on', x === b);
  });
  const RANGES = [5, 10, 20, 40, 80, 160, 320, 640];
  $('nd-rng-dn').addEventListener('click', () => { ndRange = RANGES[Math.max(0, RANGES.indexOf(ndRange) - 1)]; refresh(); });
  $('nd-rng-up').addEventListener('click', () => { ndRange = RANGES[Math.min(RANGES.length - 1, RANGES.indexOf(ndRange) + 1)]; refresh(); });

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
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) window.__app = { api, airframe, anim, s3d, states, fmc, sim, cdu, get cockpit() { return cockpit; } };

  if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
