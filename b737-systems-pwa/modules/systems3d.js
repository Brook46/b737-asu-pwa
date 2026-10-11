// systems3d.js — turns each system's declarative 3D description into meshes
// inside the airframe, and keeps them in step with that system's logic:
// pipes/ducts/feeders are tubes whose dashes move when the line is live;
// units (pumps, reservoirs, generators…) glow when running, grey when off,
// amber when failed. Tapping any of them opens its page.

import * as THREE from '../vendor/three.module.min.js?v=37';
import { loft, wingChord, wingLE, wingTC, wingY } from './airframe.js?v=37';

const FLOW_VERT = /* glsl */`
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main() {
    vUv = uv;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const FLOW_FRAG = /* glsl */`
  uniform vec3 uColor; uniform float uTime; uniform float uActive; uniform float uLen;
  uniform float uReveal; uniform float uSel; uniform float uDir;
  varying vec2 vUv; varying vec3 vN; varying vec3 vV;
  void main() {
    if (vUv.x > uReveal) discard;
    float lit = 0.55 + 0.45 * abs(dot(normalize(vN), normalize(vV)));
    float s = fract(vUv.x * uLen / 1.1 - uTime * 1.4 * uDir);
    float dash = smoothstep(0.0, 0.08, s) * (1.0 - smoothstep(0.42, 0.5, s));
    vec3 live = uColor * (0.75 + 0.55 * dash);
    float g = dot(uColor, vec3(0.33));
    vec3 idle = mix(vec3(g), uColor, 0.22) * 0.75;
    vec3 c = mix(idle, live, uActive) * lit;
    c += uSel * 0.35 * (0.6 + 0.4 * sin(uTime * 6.0));
    gl_FragColor = vec4(c, 1.0);
  }`;

const GREY = new THREE.Color(0x7d858d);
const AMBER = new THREE.Color(0xffa31a);

export function createSystems3D(api, airframeRoot) {
  const systems = new Map();
  let current = null, selected = null, time = 0;

  function build(sys) {
    const group = new THREE.Group();
    group.name = 'sys-' + sys.id;
    group.visible = false;
    airframeRoot.add(group);
    const entry = { sys, group, flows: [], units: [], byPart: new Map(), reveal: 0 };
    const color = new THREE.Color(sys.color);

    const track = (part, mesh) => {
      if (!part) return;
      mesh.userData.part = part;
      api.pickables.push(mesh);
      if (!entry.byPart.has(part)) entry.byPart.set(part, []);
      entry.byPart.get(part).push(mesh);
    };

    const K = {
      /** A pipe / duct / feeder along points; live when evaluate().flows[key]. */
      flow(key, points, o = {}) {
        const pts = points.map((p) => new THREE.Vector3(...p));
        const curve = pts.length === 2
          ? new THREE.LineCurve3(pts[0], pts[1])
          : new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05);
        const len = curve.getLength();
        const geo = new THREE.TubeGeometry(curve, Math.max(8, Math.round(len * 5)), o.r ?? 0.07, 8, false);
        const mat = new THREE.ShaderMaterial({
          vertexShader: FLOW_VERT, fragmentShader: FLOW_FRAG,
          uniforms: {
            uColor: { value: new THREE.Color(o.color ?? sys.color) }, uTime: { value: 0 },
            uActive: { value: 0 }, uLen: { value: len }, uReveal: { value: 0 }, uSel: { value: 0 },
            uDir: { value: o.reverse ? -1 : 1 },
          },
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = 1;
        group.add(mesh);
        entry.flows.push({ key, mesh, mat, target: 0, cur: 0 });
        track(o.part, mesh);
        return mesh;
      },
      /** A component. shape: box | sphere | cyl | geometry. */
      unit(part, shape, o = {}) {
        let geo;
        if (shape.geometry) geo = shape.geometry;
        else if (shape.box) {
          geo = new THREE.BoxGeometry(...shape.size);
          geo.translate(...shape.box);
        } else if (shape.sphere) {
          geo = new THREE.SphereGeometry(shape.r ?? 0.25, 20, 14);
          geo.translate(...shape.sphere);
        } else if (shape.cyl) {
          const a = new THREE.Vector3(...shape.cyl[0]), b = new THREE.Vector3(...shape.cyl[1]);
          const h = a.distanceTo(b);
          geo = new THREE.CylinderGeometry(shape.r ?? 0.2, shape.r2 ?? shape.r ?? 0.2, h, 20);
          geo.translate(0, h / 2, 0);
          const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
          geo.applyQuaternion(q);
          geo.translate(a.x, a.y, a.z);
        }
        const c = new THREE.Color(o.color ?? sys.color);
        const glass = !!o.glass;
        const mat = new THREE.MeshStandardMaterial({
          color: c, roughness: 0.4, metalness: 0.1, emissive: c.clone(), emissiveIntensity: 0.25,
          transparent: glass, opacity: glass ? 0.4 : 1, depthWrite: !glass, side: glass ? THREE.DoubleSide : THREE.FrontSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = glass ? 3 : 1;
        group.add(mesh);
        entry.units.push({ part, mesh, mat, base: c, glass, state: 'on' });
        track(part, mesh);
        return mesh;
      },
      /** A tank volume inside the wing between spans z0..z1 and chord u0..u1. */
      wingTank(part, side, z0, z1, u0, u1, o = {}) {
        const zs = [];
        const n = Math.max(2, Math.round(Math.abs(z1 - z0) / 1.5) + 1);
        for (let i = 0; i < n; i++) zs.push(z0 + (z1 - z0) * (i / (n - 1)));
        const secs = zs.map((z) => ({
          le: [wingLE(z), wingY(z), side * z], chord: wingChord(z), t: wingTC(z) * (o.ts ?? 0.82),
          thick: [0, 1, 0], u0, u1, camber: 0.018,
        }));
        return K.unit(part, { geometry: loft(secs, 10) }, { glass: true, ...o });
      },
      label: null,
    };

    sys.build(K);
    systems.set(sys.id, entry);
    return entry;
  }

  function show(id) {
    for (const [sid, e] of systems) {
      const on = sid === id;
      if (on && !e.group.visible) e.reveal = 0;
      e.group.visible = on;
    }
    current = id ? systems.get(id) : null;
  }

  /** Apply a system's evaluated state to its meshes. */
  function apply(id, result) {
    const e = systems.get(id);
    if (!e || !result) return;
    for (const f of e.flows) f.target = result.flows?.[f.key] ? 1 : 0;
    for (const u of e.units) u.state = result.units?.[u.part] ?? 'on';
  }

  function select(part) { selected = part; }

  function frame(dt) {
    time += dt;
    const e = current;
    if (!e) return;
    e.reveal = Math.min(1, e.reveal + dt / 1.3);
    const rv = 1 - Math.pow(1 - e.reveal, 3);
    for (const f of e.flows) {
      f.cur += (f.target - f.cur) * Math.min(1, dt * 5);
      const u = f.mat.uniforms;
      u.uTime.value = time;
      u.uActive.value = f.cur;
      u.uReveal.value = rv * 1.001;
      u.uSel.value = selected && f.mesh.userData.part === selected ? 1 : 0;
    }
    const pulse = 0.5 + 0.5 * Math.sin(time * 6);
    for (const u of e.units) {
      const m = u.mat;
      const sel = selected && u.part === selected;
      if (u.state === 'fault') { m.color.copy(AMBER); m.emissive.copy(AMBER); m.emissiveIntensity = 0.5; }
      else if (u.state === 'off') { m.color.copy(u.base).lerp(GREY, 0.75); m.emissive.copy(m.color); m.emissiveIntensity = 0.05; }
      else { m.color.copy(u.base); m.emissive.copy(u.base); m.emissiveIntensity = 0.28; }
      if (sel) m.emissiveIntensity += 0.35 + 0.35 * pulse;
      m.opacity = (u.glass ? 0.4 : 1) * rv;
      const tr = u.glass || rv < 1;
      if (m.transparent !== tr) { m.transparent = tr; m.needsUpdate = true; }
    }
  }

  return { build, show, apply, select, frame, get current() { return current?.sys.id ?? null; } };
}
