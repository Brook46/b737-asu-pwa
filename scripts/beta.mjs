#!/usr/bin/env node
// Flight Card beta: a copy of flight-card-pwa at /flight-card-beta/, to try
// a change on the iPad before it reaches the app flown with.
//
//   node scripts/beta.mjs            copy flight-card-pwa → flight-card-beta
//
// Run it after stamp-version.mjs. Then ship ONLY the beta folder (commit
// flight-card-beta/, leave flight-card-pwa/ uncommitted, merge to main).
// When the pilot says it's good, commit flight-card-pwa/ and merge: that's
// the promotion. See CLAUDE.md → "Beta first".
//
// What differs from the live copy:
// - The cache is `fcbeta-vN`, never `flightcard-…`: the live worker deletes
//   every `flightcard-` cache but its own on activate, and would wipe beta's.
// - Manifest name "Flight Card β" (so a Home-Screen icon is told apart) and
//   a small β badge on every screen.
// - Same origin, so in a Safari tab localStorage is shared with the live
//   app. A Home-Screen icon on iOS has its own storage, though: the β app
//   starts empty and is filled from a backup restore, and can't touch the
//   live app's data.
// - The ASU worker isn't registered from beta (path test in app.js), so ASU
//   offline comes only from the live app.

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'flight-card-pwa');
const DST = join(ROOT, 'flight-card-beta');

execFileSync('rsync', ['-a', '--delete',
  '--exclude', 'cloudflare-worker/', '--exclude', 'mac-tools/',
  '--exclude', '_design-ref*', '--exclude', '.DS_Store',
  SRC + '/', DST + '/'], { stdio: 'inherit' });

const edit = (rel, fn) => {
  const p = join(DST, rel);
  if (!existsSync(p)) throw new Error(`missing ${rel}`);
  const before = readFileSync(p, 'utf8');
  const after = fn(before);
  if (after === before) throw new Error(`${rel}: nothing changed — has the source moved?`);
  writeFileSync(p, after);
};

let ver = '';
edit('sw.js', (s) => {
  const m = /const CACHE_VERSION = 'flightcard-v(\d+)';/.exec(s);
  if (!m) throw new Error('sw.js: CACHE_VERSION not found');
  ver = m[1];
  return s
    .replace(m[0], `const CACHE_VERSION = 'fcbeta-v${ver}';`)
    .replace(/k\.startsWith\('flightcard-'\)/g, "k.startsWith('fcbeta-')");
});
edit('manifest.json', (s) => {
  const j = JSON.parse(s);
  j.name = 'Flight Card β';
  j.short_name = 'FC β';
  return JSON.stringify(j, null, 2) + '\n';
});
edit('index.html', (s) => s
  .replace(/<meta name="apple-mobile-web-app-title"[^>]*>\s*/, '')
  .replace('<title>Flight Card</title>', '<title>Flight Card β</title>\n  <meta name="apple-mobile-web-app-title" content="FC β" />')
  .replace('</body>', `  <div class="beta-badge" aria-label="Beta version ${ver}" style="position:fixed;top:calc(env(safe-area-inset-top,0px) + 2px);left:50%;transform:translateX(-50%);z-index:9999;padding:1px 8px;border-radius:999px;background:#c2410c;color:#fff;font:700 11px/16px -apple-system,system-ui,sans-serif;pointer-events:none;opacity:.9">β v${ver}</div>\n</body>`));

console.log(`flight-card-beta ← flight-card-pwa v${ver} (cache fcbeta-v${ver})`);
console.log('Beta: https://brook46.github.io/b737-asu-pwa/flight-card-beta/');
