// resume.js — iOS Home-Screen PWA resume-hardening (see CLAUDE.md).
//
// Safari freezes and bfcaches standalone PWAs hard; a live-tracking app that
// comes back from a long background shows a sky that is minutes old, or a
// half-dead page. We guard three ways: bfcache restore, long-away resume, and a
// heartbeat freeze detector.
//
// Forcing a reload is safe here because the only state worth keeping — the map
// view — is written to localStorage on every move, so we come back looking at
// the same patch of sky.

const LONG_AWAY_MS = 15 * 60 * 1000; // 15 min backgrounded ⇒ full reload
const FREEZE_MS = 90 * 1000;         // heartbeat gap ⇒ suspected freeze

export function installResumeHardening(onResume) {
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else {
      const away = Date.now() - hiddenAt;
      if (hiddenAt && away > LONG_AWAY_MS) { location.reload(); return; }
      if (hiddenAt && onResume) onResume(away);   // short trip: just refresh the sky
    }
  });

  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (now - last > FREEZE_MS && document.visibilityState === 'visible') location.reload();
    last = now;
  }, 15 * 1000);
}
