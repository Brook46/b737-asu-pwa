// app.js — shell, hash router, screen orchestration.

import { $, $$ } from './modules/ui/dom.js?v=10';
import { icon } from './modules/ui/icons.js?v=10';
import { renderPicker } from './modules/ui/picker.js?v=10';
import { renderSetup, stopSetup } from './modules/ui/setup.js?v=10';
import { renderMeasure, stopMeasure } from './modules/ui/measure.js?v=10';
import { renderResult } from './modules/ui/result.js?v=10';
import { renderHistory } from './modules/ui/history.js?v=10';
import { renderImport } from './modules/ui/import.js?v=10';
import { renderCompare } from './modules/ui/compare.js?v=10';
import { renderPast } from './modules/ui/past.js?v=10';
import { renderGuide } from './modules/ui/guide.js?v=10';
import { hideTip } from './modules/ui/charts.js?v=10';
import { progress } from './modules/session.js?v=10';
import { prefs, draft } from './modules/store.js?v=10';

const screen = $('#screen');
const stepper = $('#stepper');

$('#logo').innerHTML = icon.logo;
$('#btn-history').innerHTML = icon.history;
$('#btn-guide').innerHTML = icon.info;

// The wing being set up, and the check in progress (restored after a reload).
const ctx = {
  wingId: prefs.get().lastWing?.id || null,
  sizeKey: prefs.get().lastWing?.size || null,
  session: (() => { const d = draft.get(); return d && d.v === 3 ? d : null; })(),
  fillTarget: null,
  goto(name) {
    if (location.hash === '#' + name) route();
    else location.hash = name;
  },
  chooseWing(id, size) {
    this.wingId = id;
    this.sizeKey = size;
    prefs.set({ lastWing: { id, size } });
    this.goto('setup');
  },
};

const SCREENS = {
  wings: renderPicker,
  setup: renderSetup,
  measure: renderMeasure,
  result: renderResult,
  history: renderHistory,
  import: renderImport,
  compare: renderCompare,
  past: renderPast,
  guide: renderGuide,
};

function route() {
  let name = location.hash.replace('#', '') || 'wings';
  if (!SCREENS[name]) name = 'wings';
  if ((name === 'measure' || name === 'result') && !ctx.session) name = 'wings';
  if (name === 'setup' && !ctx.wingId) name = 'wings';

  stopSetup(); stopMeasure(); hideTip();
  window.scrollTo(0, 0);
  // async wrapper so a synchronous throw inside a screen lands in .catch too
  (async () => SCREENS[name](screen, ctx))().catch(err => {
    console.error(err);
    screen.innerHTML = `<div class="note warn">Something went wrong on this screen: ${String(err.message || err)}</div>`;
  });
  paintStepper(name);
}

function paintStepper(name) {
  const order = ['wings', 'setup', 'measure', 'result'];
  const idx = order.indexOf(name);
  stepper.hidden = idx === -1 && name !== 'import';
  const s = ctx.session;
  $$('button', stepper).forEach(b => {
    const st = b.dataset.step, i = order.indexOf(st);
    const reachable = st === 'wings' || (st === 'setup' && ctx.wingId)
      || ((st === 'measure' || st === 'result') && s);
    b.disabled = !reachable;
    b.dataset.state = st === name ? 'current'
      : (st === 'measure' && s && progress(s).done) || (st === 'result' && s?.savedAt) || i < idx ? 'done' : '';
  });
}

$$('button', stepper).forEach(b => b.addEventListener('click', () => { if (!b.disabled) ctx.goto(b.dataset.step); }));
$('#btn-history').addEventListener('click', () => ctx.goto('history'));
$('#btn-guide').addEventListener('click', () => ctx.goto('guide'));

// ---- theme: system by default, a tap cycles light ↔ dark and remembers it
function paintThemeButton() {
  const dark = document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  $('#btn-theme').innerHTML = dark ? icon.sun : icon.moon;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0e1210' : '#f3f4f1');
}
$('#btn-theme').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const next = dark ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  prefs.set({ theme: next });
  paintThemeButton();
});
paintThemeButton();

window.addEventListener('hashchange', route);
route();

// ---- service worker + resume hardening ----
// On localhost the SW's cache-first shell serves stale modules on every edit, so
// keep it off in dev and actively tear down one left over from an earlier run.
const IS_DEV = ['localhost', '127.0.0.1'].includes(location.hostname);
if ('serviceWorker' in navigator) {
  if (IS_DEV) {
    navigator.serviceWorker.getRegistrations()
      .then(rs => rs.forEach(r => r.unregister()))
      .then(() => caches?.keys().then(ks => ks.forEach(k => caches.delete(k))))
      .catch(() => {});
  } else {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  }
}
// long-away or bfcache restore → re-render so nothing is left frozen; the draft
// means a full reload loses nothing
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); if (ctx.session && !ctx.session.savedAt) draft.set(ctx.session); }
  else if (hiddenAt && Date.now() - hiddenAt > 30 * 60 * 1000) location.reload();
});
window.addEventListener('pageshow', e => { if (e.persisted) route(); });
