// proxy.js — single Cloudflare Worker URL shared by TAF + calendar.
//
// After you deploy cloudflare-worker/taf-proxy.js (5-min one-time job)
// Cloudflare gives you a URL like https://fc-taf-proxy.<account>.workers.dev.
// Paste it here, save, and both features (TAF inside the wx popup, Google
// Calendar sync in the share sheet) start working.
//
// Until WORKER_BASE is non-null:
//   - TAF section falls back to the ↗ aviationweather.gov deep-link
//   - Calendar sync shows "Configure the proxy first" instead of running

// alonbrookstein.workers.dev is the git-connected account's subdomain
// (registered 2026-07-04). The old zy7ps9scwm URL was a manually-deployed
// copy in another account that never received git deploys — it kept
// serving stale code, which is why the logbook routes 503'd for a day.
export const WORKER_BASE = 'https://b737-asu-pwa.alonbrookstein.workers.dev';
