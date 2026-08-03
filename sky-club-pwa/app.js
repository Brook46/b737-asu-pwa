import { initExplore } from './modules/orbits.js';
import { initSky } from './modules/sky.js';
import { initStarfield } from './modules/starfield.js';
import { initBadges } from './modules/badges.js';
import { installResumeHardening } from './modules/resume.js';
import { isMuted, setMuted, stop as stopSpeech } from './modules/speech.js';

const NAV_SCREENS = ['explore', 'sky', 'badges'];

function switchScreen(name) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === `${name}-screen`));
  for (const s of NAV_SCREENS) {
    const tab = document.getElementById(`nav-${s}`);
    tab.classList.toggle('active', name === s);
    tab.setAttribute('aria-pressed', String(name === s));
  }
  stopSpeech();
  // Home is now the default screen, so #starfield's canvas sizes itself from a
  // display:none ancestor at init (0×0) and never recovers on its own — nudge
  // starfield.js's own resize (window 'resize' listener) once the target screen's
  // layout is live, same fix any newly-visible canvas benefits from.
  window.dispatchEvent(new Event('resize'));
}

function initMute() {
  const btn = document.getElementById('mute-btn');
  const apply = (muted) => {
    btn.innerHTML = muted ? '<i class="ph-fill ph-speaker-slash"></i>' : '<i class="ph-fill ph-speaker-high"></i>';
    btn.setAttribute('aria-pressed', String(muted));
  };
  apply(isMuted());
  btn.addEventListener('click', () => {
    const muted = !isMuted();
    setMuted(muted);
    apply(muted);
  });
}

function init() {
  initExplore();
  initSky();
  initBadges();
  initStarfield(document.getElementById('starfield'));
  initStarfield(document.getElementById('home-starfield'));
  initMute();
  document.getElementById('nav-explore').addEventListener('click', () => switchScreen('explore'));
  document.getElementById('nav-sky').addEventListener('click', () => switchScreen('sky'));
  document.getElementById('nav-badges').addEventListener('click', () => switchScreen('badges'));
  document.getElementById('home-blastoff').addEventListener('click', () => switchScreen('explore'));
  document.getElementById('home-lookoutside').addEventListener('click', () => switchScreen('sky'));
  installResumeHardening();

  // Deliberately skipped on localhost: cache-first SW + a no-cache dev server means
  // every edit would keep serving stale modules/CSS (see airline-radar-pwa/CLAUDE.md).
  if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
