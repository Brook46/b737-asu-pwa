// airlink.js — ties the pages to the real airframe. When a page is open,
// the actual pieces of the airplane it describes light up in the system's
// colour (ailerons, elevators, rudder, stabiliser, flaps, slats, spoilers,
// gear, doors, engines…) and, where it helps, move: the aileron rolls, the
// elevator and rudder sweep, the speedbrakes rise, the reversers open, the
// doors open. With only a system picked, all its pieces get a light tint.

import * as THREE from '../vendor/three.module.min.js?v=27';

// part page → airframe pieces (keys into collect()).
const LINKS = {
  flightcontrols: { ail: ['ailerons', 'spoilers'], elev: ['elevators'], rud: ['rudder', 'fin'], stab: ['stab'], flaps: ['flaps'], le: ['slats', 'kruegers'],
    sb: ['spoilers'], pcu: ['ailerons', 'elevators', 'rudder'], pdu: ['flaps'] },
  gear: { mlg: ['mains'], nlg: ['nose'], brakes: ['mains'], autobrake: ['mains'], park: ['mains'], lever: ['mains', 'nose'], manual: ['mains', 'nose'] },
  general: { doors: ['doors'], fddoor: [] },
  engines: { core: ['engines'], rev: ['engines'], eec: ['engines'], start: ['engines'], ign: ['engines'], oil: ['engines'], fuelsys: ['engines'] },
  antiice: { cowl: ['engines'], wingai: ['slats'] },
  fire: { loops1: ['engine1'], loops2: ['engine2'], fsw: ['engines'], bottles: ['engines'] },
  hydraulics: { fltctl: ['ailerons', 'elevators', 'rudder', 'spoilers'], gear: ['mains', 'nose'], revs: ['engines'] },
};
// Movement while a page is open.
const MOTION = {
  'flightcontrols/ail': (t) => ({ aileron: 18 * Math.sin(t * 1.4) }),
  'flightcontrols/elev': (t) => ({ elevator: 16 * Math.sin(t * 1.3) }),
  'flightcontrols/rud': (t) => ({ rudder: 22 * Math.sin(t * 1.1) }),
  'flightcontrols/pcu': (t) => ({ aileron: 14 * Math.sin(t * 1.4), elevator: 12 * Math.sin(t * 1.3 + 1), rudder: 16 * Math.sin(t * 1.1 + 2) }),
  'flightcontrols/sb': (t) => ({ speedbrake: 0.5 + 0.5 * Math.sin(t * 1.2) }),
  'engines/rev': (t) => ({ reverser: Math.sin(t * 0.8) > 0 ? 1 : 0 }),
  'general/doors': () => ({ doors: true }),
};

export function createAirLink(airframe) {
  const mv = airframe.movers;
  const meshesOf = (obj) => {
    const out = [];
    obj?.traverse?.((o) => { if (o.isMesh && o.userData.skin) out.push(o); });
    return out;
  };
  // Engine 1 is the left one (−z), whatever order they were built in.
  const engineOn = (sz) => mv.engines.find((e) => Math.sign(new THREE.Box3().setFromObject(e).getCenter(new THREE.Vector3()).z) === sz);
  const collect = {
    ailerons: () => mv.ailerons.flatMap(meshesOf), elevators: () => mv.elevators.flatMap(meshesOf),
    rudder: () => meshesOf(mv.rudder), fin: () => mv.fin, stab: () => mv.stab,
    flaps: () => mv.flaps.flatMap(meshesOf), slats: () => mv.slats.flatMap(meshesOf), kruegers: () => mv.kruegers.flatMap(meshesOf),
    spoilers: () => mv.spoilers.flatMap(meshesOf), mains: () => mv.mains.flatMap(meshesOf), nose: () => meshesOf(mv.nose),
    engines: () => mv.engines.flatMap(meshesOf), engine1: () => meshesOf(engineOn(-1)), engine2: () => meshesOf(engineOn(1)),
    doors: () => Object.values(mv.doors).flatMap((d) => meshesOf(d.pivot)),
  };
  // One overlay twin per mesh, created on first use.
  const overlays = new Map();
  const mats = new Map();
  function matFor(color) {
    if (!mats.has(color)) {
      mats.set(color, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    }
    return mats.get(color);
  }
  function overlay(mesh) {
    if (!overlays.has(mesh)) {
      const o = new THREE.Mesh(mesh.geometry, matFor('#ffffff'));
      o.position.copy(mesh.position); o.quaternion.copy(mesh.quaternion); o.scale.copy(mesh.scale);
      o.renderOrder = 7;
      o.visible = false;
      mesh.parent.add(o);
      overlays.set(mesh, o);
    }
    return overlays.get(mesh);
  }

  let key = '', strong = new Set(), soft = new Set(), color = '#3a86ff', t = 0;
  /** sel = { sys, part, color } (part may be null). */
  function select(sel) {
    const k = sel ? `${sel.sys}/${sel.part || ''}` : '';
    if (k === key) return;
    key = k;
    for (const o of overlays.values()) o.visible = false;
    strong = new Set(); soft = new Set();
    if (!sel) return;
    color = sel.color || color;
    const links = LINKS[sel.sys] || {};
    const pieces = (list) => list.flatMap((n) => (collect[n] ? collect[n]() : []));
    if (sel.part) for (const m of pieces(links[sel.part] || [])) strong.add(m);
    else for (const list of Object.values(links)) for (const m of pieces(list)) soft.add(m);
    const mat = matFor(color);
    for (const m of [...strong, ...soft]) { const o = overlay(m); o.material = mat; o.visible = true; }
  }
  /** Per frame: pulse the highlight; return pose extras / requests for the open page. */
  function frame(dt) {
    t += dt;
    if (!key) return {};
    const mat = matFor(color);
    mat.opacity = strong.size ? 0.38 + 0.2 * Math.sin(t * 3.2) : 0.16;
    const fn = MOTION[key];
    return fn ? fn(t) : {};
  }
  return { select, frame, has: (sys, part) => !!(LINKS[sys]?.[part]?.length) };
}
