// scene.js — renderer, studio (grid floor, soft shadow, vignette lives in CSS),
// camera + orbit controls, solid ↔ x-ray skin, picking, and the frame loop.

import * as THREE from '../vendor/three.module.min.js?v=20';
import { OrbitControls } from './orbit-controls.js?v=20';

const XRAY_VERT = /* glsl */`
  varying vec3 vN; varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }`;
const XRAY_FRAG = /* glsl */`
  uniform vec3 uRim; uniform vec3 uBase; uniform float uAlpha; uniform float uFill;
  varying vec3 vN; varying vec3 vV;
  void main() {
    float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
    f = pow(f, 2.4);
    gl_FragColor = vec4(mix(uBase, uRim, f), (uFill + 0.62 * f) * uAlpha);
  }`;

const GRID_VERT = /* glsl */`
  varying vec2 vP;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vP = w.xz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const GRID_FRAG = /* glsl */`
  uniform vec3 uLine; uniform float uStrength; uniform float uFadeIn; uniform float uFadeOut;
  varying vec2 vP;
  float lineAt(float s, float w) {
    vec2 c = vP / s;
    vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
    return 1.0 - min(min(g.x, g.y) / w, 1.0);
  }
  void main() {
    float minor = lineAt(1.0, 1.0) * 0.28;
    float major = lineAt(5.0, 1.15) * 0.6;
    vec2 d = abs(fract(vP / 5.0 - 0.5) - 0.5) * 5.0;
    float dotm = 1.0 - smoothstep(0.07, 0.12, length(d));
    float r = length(vP);
    float fade = 1.0 - smoothstep(uFadeIn, uFadeOut, r);
    float a = max(max(minor, major), dotm * 0.9) * fade * uStrength;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uLine, a);
  }`;

export const THEMES = {
  light: { bg: 0xefefed, line: 0x1a1a1a, grid: 0.55, rim: 0x1e2630, base: 0x8d99a6, fill: 0.035,
    skin: 0xf3f3f1, dark: 0x2b2e33, metal: 0x9aa0a6, tyre: 0x232427, glass: 0x1c2530, shadow: 0.2, hemi: 0.9 },
  dark: { bg: 0x0e1013, line: 0xc9d2da, grid: 0.32, rim: 0x9fd0ff, base: 0x24303c, fill: 0.03,
    skin: 0x6f7780, dark: 0x1a1d21, metal: 0x7d848c, tyre: 0x141517, glass: 0x0b0f14, shadow: 0.45, hemi: 0.55 },
};

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  const dprCap = Math.min(window.devicePixelRatio || 1, 2);
  let dpr = dprCap;
  renderer.setPixelRatio(dpr);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.5, 600);
  const HOME = { pos: new THREE.Vector3(30, 15, 34), target: new THREE.Vector3(0, 3.4, 0) };
  camera.position.copy(HOME.pos);

  const controls = new OrbitControls(camera, canvas);
  controls.target.copy(HOME.target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = 140;
  controls.maxPolarAngle = Math.PI - 0.08;
  controls.screenSpacePanning = true;
  controls.update();

  // Lights: a big soft sky, a key light that casts the floor shadow, a fill.
  const hemi = new THREE.HemisphereLight(0xffffff, 0xbfc3c7, 0.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  key.position.set(12, 40, 18);
  key.castShadow = true;
  const sm = /iPhone|iPad|Android/i.test(navigator.userAgent) ? 1024 : 2048;
  key.shadow.mapSize.set(sm, sm);
  Object.assign(key.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 5, far: 90 });
  key.shadow.radius = 6;
  key.shadow.bias = -0.0006;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.45);
  fill.position.set(-20, 10, -14);
  scene.add(fill);

  // Floor: grid shader + a separate shadow catcher.
  const gridMat = new THREE.ShaderMaterial({
    vertexShader: GRID_VERT, fragmentShader: GRID_FRAG, transparent: true, depthWrite: false,
    uniforms: { uLine: { value: new THREE.Color() }, uStrength: { value: 0.5 }, uFadeIn: { value: 22 }, uFadeOut: { value: 95 } },
  });
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), gridMat);
  grid.rotation.x = -Math.PI / 2;
  grid.renderOrder = -2;
  scene.add(grid);
  const shadowMat = new THREE.ShadowMaterial({ opacity: 0.2, depthWrite: false });
  const catcher = new THREE.Mesh(new THREE.PlaneGeometry(120, 120), shadowMat);
  catcher.rotation.x = -Math.PI / 2;
  catcher.position.y = 0.002;
  catcher.receiveShadow = true;
  catcher.renderOrder = -1;
  scene.add(catcher);

  // Aircraft container: attitude (lift/pitch) is applied here.
  const world = new THREE.Group();
  scene.add(world);

  // Materials for the solid skin, keyed by userData.skin kind.
  const solid = {
    skin: new THREE.MeshStandardMaterial({ color: 0xf3f3f1, roughness: 0.42, metalness: 0.05, side: THREE.DoubleSide, transparent: true }),
    dark: new THREE.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide, transparent: true }),
    metal: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.35, metalness: 0.6, transparent: true }),
    tyre: new THREE.MeshStandardMaterial({ color: 0x232427, roughness: 0.9, metalness: 0, transparent: true }),
    glass: new THREE.MeshStandardMaterial({ color: 0x1c2530, roughness: 0.12, metalness: 0.5, side: THREE.DoubleSide, transparent: true }),
    fuselage: new THREE.MeshStandardMaterial({ color: 0xf3f3f1, roughness: 0.42, metalness: 0.05, side: THREE.DoubleSide, transparent: true }),
  };
  const xrayMat = new THREE.ShaderMaterial({
    vertexShader: XRAY_VERT, fragmentShader: XRAY_FRAG,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    uniforms: { uRim: { value: new THREE.Color() }, uBase: { value: new THREE.Color() },
      uAlpha: { value: 0 }, uFill: { value: 0.035 } },
  });

  let theme = THEMES.light;
  function applyTheme(name) {
    theme = THEMES[name] || THEMES.light;
    renderer.setClearColor(theme.bg, 1);
    gridMat.uniforms.uLine.value.set(theme.line);
    gridMat.uniforms.uStrength.value = theme.grid;
    xrayMat.uniforms.uRim.value.set(theme.rim);
    xrayMat.uniforms.uBase.value.set(theme.base);
    xrayMat.uniforms.uFill.value = theme.fill;
    solid.skin.color.set(theme.skin);
    solid.fuselage.color.set(theme.skin);
    solid.dark.color.set(theme.dark);
    solid.metal.color.set(theme.metal);
    solid.tyre.color.set(theme.tyre);
    solid.glass.color.set(theme.glass);
    shadowMat.opacity = theme.shadow;
    hemi.intensity = theme.hemi;
    hemi.groundColor.set(name === 'dark' ? 0x20252b : 0xbfc3c7);
  }

  // ── Airframe hookup: each skin mesh gets an x-ray twin sharing geometry ──
  let airframe = null;
  const twins = [];
  function setAirframe(af) {
    airframe = af;
    world.add(af.root);
    for (const m of af.skin) {
      const t = new THREE.Mesh(m.geometry, xrayMat);
      t.renderOrder = 5;
      t.visible = false;
      m.parent.add(t);
      t.position.copy(m.position);
      t.quaternion.copy(m.quaternion);
      t.scale.copy(m.scale);
      twins.push(t);
      m.userData.twin = t;
    }
  }

  // x-ray amount 0 (solid) … 1 (glass), eased toward its target each frame.
  let xray = 0, xrayTarget = 0;
  function setXray(v) { xrayTarget = v; }
  function applyXray() {
    const a = 1 - xray;
    for (const k in solid) {
      solid[k].opacity = a;
      solid[k].depthWrite = a > 0.6;
    }
    const showSolid = a > 0.01, showX = xray > 0.01;
    if (airframe) for (const m of airframe.skin) {
      m.visible = showSolid;
      m.castShadow = true;
      m.userData.twin.visible = showX;
    }
    xrayMat.uniforms.uAlpha.value = xray;
  }

  // ── Camera flights ──
  let flight = null;
  function flyTo(target, dist = null, dir = null, ms = 900) {
    const t0 = controls.target.clone(), p0 = camera.position.clone();
    const curDir = p0.clone().sub(t0).normalize();
    const d = dist ?? p0.distanceTo(t0);
    const t1 = target.clone();
    const p1 = t1.clone().addScaledVector(dir ? dir.clone().normalize() : curDir, d);
    flight = { t0, p0, t1, p1, start: performance.now(), ms };
  }
  function home() { flyTo(HOME.target, HOME.pos.distanceTo(HOME.target), HOME.pos.clone().sub(HOME.target), 1000); }
  controls.addEventListener('start', () => { flight = null; });

  // ── Picking (tap, not drag) ──
  const pickables = [];
  const ray = new THREE.Raycaster();
  let down = null;
  let onPick = () => {};
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
  // Which world the renderer draws: the airplane, or another (the cockpit).
  let mode = 'airplane', alt = null;
  function setMode(m, other = null) {
    mode = m; alt = other;
    controls.enabled = m === 'airplane';
  }
  canvas.addEventListener('pointerup', (e) => {
    if (!down || mode !== 'airplane') { down = null; return; }
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 500;
    down = null;
    if (moved > 6 || !quick) return;
    const r = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(pickables.filter((o) => o.visible && isShown(o)), false);
    onPick(hits.length ? hits[0].object.userData.part : null);
  });
  function isShown(o) { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; }

  // ── Projection helper for DOM hotspots ──
  const v = new THREE.Vector3();
  let W = 1, H = 1;
  function project(local, out = {}) {
    v.set(local[0], local[1], local[2]);
    if (airframe) airframe.root.localToWorld(v);
    v.project(camera);
    out.x = (v.x * 0.5 + 0.5) * W;
    out.y = (-v.y * 0.5 + 0.5) * H;
    out.visible = v.z < 1 && v.z > -1;
    return out;
  }
  function worldOf(local) {
    const p = new THREE.Vector3(...local);
    if (airframe) airframe.root.localToWorld(p);
    return p;
  }

  // ── Loop ──
  const frameFns = [];
  let running = false, last = performance.now(), slow = 0;
  // Insets: screen area covered by the page sheet. The projection is shifted
  // (setViewOffset) so the airplane centres in what's left, eased so the
  // view slides rather than jumps when the sheet opens or closes.
  const inset = { right: 0, bottom: 0 }, insetCur = { right: 0, bottom: 0 };
  function setInsets(r = 0, b = 0) { inset.right = r; inset.bottom = b; }
  function applyOffset() {
    // Frame as if the screen were only the free area (vw × vh), then widen
    // the window to the whole canvas: the extra strip simply extends the
    // view under the sheet, with no distortion (W/H aspect is preserved).
    const vw = Math.max(200, W - insetCur.right), vh = Math.max(200, H - insetCur.bottom);
    camera.aspect = vw / vh;
    camera.fov = vw / vh < 0.8 ? 52 : vw / vh < 1.2 ? 42 : 34;
    camera.setViewOffset(vw, vh, 0, 0, W, H);
  }
  function resize() {
    W = canvas.clientWidth || window.innerWidth;
    H = canvas.clientHeight || window.innerHeight;
    renderer.setSize(W, H, false);
    applyOffset();
  }
  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(() => resize()).observe(canvas);
  resize();

  function tick(now) {
    if (!running) return;
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    // Adaptive resolution: drop the pixel ratio if frames are consistently slow.
    if (dt > 0.026) slow++; else slow = Math.max(0, slow - 1);
    if (slow > 90 && dpr > 1) { dpr = Math.max(1, dpr - 0.5); renderer.setPixelRatio(dpr); resize(); slow = 0; }

    if (flight) {
      const k = Math.min(1, (now - flight.start) / flight.ms);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      controls.target.lerpVectors(flight.t0, flight.t1, e);
      camera.position.lerpVectors(flight.p0, flight.p1, e);
      if (k >= 1) flight = null;
    }
    if (insetCur.right !== inset.right || insetCur.bottom !== inset.bottom) {
      for (const k of ['right', 'bottom']) {
        insetCur[k] += (inset[k] - insetCur[k]) * Math.min(1, dt * 7);
        if (Math.abs(inset[k] - insetCur[k]) < 0.5) insetCur[k] = inset[k];
      }
      applyOffset();
    }
    if (Math.abs(xray - xrayTarget) > 0.001) {
      xray += (xrayTarget - xray) * Math.min(1, dt * 6);
      if (Math.abs(xray - xrayTarget) < 0.002) xray = xrayTarget;
      applyXray();
    }
    if (mode === 'airplane') controls.update();
    // Floor and shadow vanish when looking from below.
    const below = camera.position.y < 0.2;
    grid.visible = !below;
    catcher.visible = !below;
    for (const f of frameFns) f(dt, now);
    if (mode !== 'airplane' && alt) renderer.render(alt.scene, alt.camera);
    else renderer.render(scene, camera);
  }
  function start() { if (running) return; running = true; last = performance.now(); requestAnimationFrame(tick); }
  function stop() { running = false; }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stop(); else if (!paused) start();
  });
  let paused = false;
  function pause(p) { paused = p; if (p) stop(); else start(); }

  return {
    THREE, scene, camera, renderer, controls, world, materials: solid,
    setAirframe, setXray, applyTheme, flyTo, home, project, worldOf, pickables, setInsets, setMode, canvas,
    onFrame: (fn) => frameFns.push(fn),
    setPick: (fn) => { onPick = fn; },
    start, pause, resize,
    get size() { return { W, H }; },
    get theme() { return theme; },
  };
}
