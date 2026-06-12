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

export const WORKER_BASE = 'https://b737-asu-pwa.zy7ps9scwm.workers.dev';
