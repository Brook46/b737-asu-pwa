// resume.js — iOS Home-Screen PWA resume-hardening (see CLAUDE.md).
//
// Safari freezes and bfcaches standalone PWAs aggressively. After a long
// background the page comes back half-dead: some buttons work, others don't,
// and the WebGL context may have been dropped entirely. We guard three ways:
//   • bfcache restore  → hard reload
//   • long-away resume → reload
//   • freeze detector  → reload if the main loop was suspended
//
// A reload is safe here because loaded flights live in IndexedDB and the active
// set is remembered — the app restores itself. But it is NOT safe mid-recording
// or mid-playback, so the caller passes a veto: anything that would lose real
// work keeps the page alive and just re-syncs instead.

const LONG_AWAY_MS = 25 * 60 * 1000;   // 25 min backgrounded ⇒ reload
const FREEZE_MS = 90 * 1000;           // heartbeat gap ⇒ suspected freeze
const HEARTBEAT_MS = 15 * 1000;

/**
 * @param {{onResume?:(awayMs:number)=>void, canReload?:()=>boolean}} opts
 *        `canReload` returning false vetoes a forced reload (e.g. recording).
 */
export function installResumeHardening(opts = {}) {
  const { onResume, canReload } = opts;
  const allowed = () => (typeof canReload === 'function' ? canReload() !== false : true);

  const reload = () => { if (allowed()) location.reload(); };

  window.addEventListener('pageshow', (e) => { if (e.persisted) reload(); });

  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    const away = Date.now() - hiddenAt;
    if (hiddenAt && away > LONG_AWAY_MS && allowed()) { location.reload(); return; }
    if (hiddenAt && onResume) onResume(away);
  });

  // If wall-clock jumps far beyond the heartbeat interval the tab was suspended;
  // reload to get a clean module + GL state.
  let last = Date.now();
  setInterval(() => {
    const now = Date.now();
    if (now - last > FREEZE_MS && document.visibilityState === 'visible') reload();
    last = now;
  }, HEARTBEAT_MS);

  // A lost WebGL context can't be recovered by redrawing — only by reloading.
  window.addEventListener('webglcontextlost', () => {
    if (allowed()) location.reload();
  }, true);
}
