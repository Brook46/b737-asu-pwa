// resume.js — iOS Home-Screen PWA resume-hardening (see root CLAUDE.md).
//
// Safari aggressively freezes/bfcaches standalone PWAs. Symptoms after a long
// background are a half-dead page or a frozen sky. We guard three ways:
//   • bfcache restore  → hard reload
//   • long-away resume → reload so "now" isn't stale
//   • freeze detector  → reload if the main loop was suspended a long time
//
// A reload here is cheap (no session state worth keeping), so we can safely force one.

const LONG_AWAY_MS = 20 * 60 * 1000; // 20 min backgrounded ⇒ refresh
const FREEZE_MS = 90 * 1000;         // heartbeat gap ⇒ suspected freeze

export function installResumeHardening() {
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else if (hiddenAt && Date.now() - hiddenAt > LONG_AWAY_MS) {
      location.reload();
    }
  });

  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (now - last > FREEZE_MS && document.visibilityState === 'visible') {
      location.reload();
    }
    last = now;
  }, 15 * 1000);
}
