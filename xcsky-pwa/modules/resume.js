// resume.js — iOS Home-Screen PWA resume-hardening (see CLAUDE.md).
//
// Safari aggressively freezes/bfcaches standalone PWAs. Symptoms after a long
// background are a half-dead page or stale data. We guard three ways:
//   • bfcache restore  → hard reload
//   • long-away resume → reload so data isn't stale
//   • freeze detector  → reload if the main loop was suspended a long time
//
// A reload here is cheap (all state is in localStorage / re-fetched), so unlike
// the live-map apps we can safely force one.

const LONG_AWAY_MS = 20 * 60 * 1000; // 20 min backgrounded ⇒ refresh
const FREEZE_MS = 90 * 1000;         // heartbeat gap ⇒ suspected freeze

export function installResumeHardening(onResume) {
  // bfcache restore.
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) location.reload();
  });

  // Long-away resume.
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
    } else {
      const away = Date.now() - hiddenAt;
      if (hiddenAt && away > LONG_AWAY_MS) { location.reload(); return; }
      if (hiddenAt && onResume) onResume(away); // lighter refresh for short trips
    }
  });

  // Freeze detector: if wall-clock jumps far beyond our tick interval, the tab
  // was suspended — reload to recover a clean module state.
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (now - last > FREEZE_MS && document.visibilityState === 'visible') {
      location.reload();
    }
    last = now;
  }, 15 * 1000);
}
