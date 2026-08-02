import { initExplore } from './modules/orbits.js';
import { initSky } from './modules/sky.js';
import { initStarfield } from './modules/starfield.js';
import { installResumeHardening } from './modules/resume.js';
import { isMuted, setMuted, stop as stopSpeech } from './modules/speech.js';

function switchScreen(name) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.toggle('active', el.id === `${name}-screen`));
  document.getElementById('nav-explore').classList.toggle('active', name === 'explore');
  document.getElementById('nav-explore').setAttribute('aria-pressed', String(name === 'explore'));
  document.getElementById('nav-sky').classList.toggle('active', name === 'sky');
  document.getElementById('nav-sky').setAttribute('aria-pressed', String(name === 'sky'));
  stopSpeech();
}

function initMute() {
  const btn = document.getElementById('mute-btn');
  const apply = (muted) => {
    btn.textContent = muted ? '🔇' : '🔊';
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
  initStarfield(document.getElementById('starfield'));
  initMute();
  document.getElementById('nav-explore').addEventListener('click', () => switchScreen('explore'));
  document.getElementById('nav-sky').addEventListener('click', () => switchScreen('sky'));
  installResumeHardening();

  // Deliberately skipped on localhost: cache-first SW + a no-cache dev server means
  // every edit would keep serving stale modules/CSS (see airline-radar-pwa/CLAUDE.md).
  if ('serviceWorker' in navigator && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
