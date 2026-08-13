#!/usr/bin/env node
// Stamp one cache-busting version across an app's whole ES-module graph.
//
// Why this exists
// ---------------
// GitHub Pages serves every file with `cache-control: max-age=600`. Bumping
// `app.js?v=N` therefore buys a fresh entry point and nothing else: the modules
// it imports keep their old URLs, so for ten minutes after a deploy the browser
// happily pairs a new app.js with a cached modules/*.js.
//
// That pairing isn't degraded, it's dead. A module missing an export its
// importer names is a SyntaxError raised before a single line runs, so the
// whole graph fails to evaluate — the HTML and CSS paint, and nothing else in
// the app exists. It looks exactly like a redesign that shipped without its
// JavaScript, which is what shipped v10 and v11 of Airline Radar broken.
//
// So the version goes on every module URL, not just the entry point. One bump
// invalidates the entire graph at once, and old and new can never be mixed.
//
//   node scripts/stamp-version.mjs <app-dir> <version>
//   node scripts/stamp-version.mjs airline-radar-pwa 13

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

const [dirArg, verArg] = process.argv.slice(2);
if (!dirArg || !/^\d+$/.test(verArg || '')) {
  console.error('usage: node scripts/stamp-version.mjs <app-dir> <version>');
  process.exit(2);
}
const root = resolve(dirArg);
const V = verArg;

/** Every relative `.js` specifier gets exactly one ?v= — never two. */
const stampImports = (src) =>
  src.replace(/(from\s+["'])(\.\.?\/[^"']+?\.js)(\?v=\d+)?(["'])/g, `$1$2?v=${V}$4`);

const changed = [];
const save = (path, before, after) => {
  if (before === after) return;
  writeFileSync(path, after);
  changed.push(path.replace(root + '/', ''));
};

// 1. The entry point and every module it can reach.
const files = ['app.js', ...(existsSync(join(root, 'modules'))
  ? readdirSync(join(root, 'modules')).filter((f) => f.endsWith('.js')).map((f) => join('modules', f))
  : [])];
for (const rel of files) {
  const path = join(root, rel);
  if (!existsSync(path)) continue;
  const before = readFileSync(path, 'utf8');
  save(path, before, stampImports(before));
}

// 2. index.html — the two URLs the browser is told to load directly.
const indexPath = join(root, 'index.html');
if (existsSync(indexPath)) {
  const before = readFileSync(indexPath, 'utf8');
  const after = before
    .replace(/(["'])(\.?\/?app\.(?:js|css))(\?v=\d+)?(["'])/g, `$1$2?v=${V}$4`);
  save(indexPath, before, after);
}

// 3. sw.js — the precache list must ask for the same URLs the page will, or
//    the service worker stores one copy and the page requests another.
const swPath = join(root, 'sw.js');
if (existsSync(swPath)) {
  const before = readFileSync(swPath, 'utf8');
  const after = before
    .replace(/(CACHE_VERSION\s*=\s*')([a-z0-9-]*?)-v\d+(')/i, `$1$2-v${V}$3`)
    .replace(/(['"])(\.\/(?:app\.(?:js|css)|modules\/[^'"]+?\.js))(\?v=\d+)?(['"])/g,
      `$1$2?v=${V}$4`);
  save(swPath, before, after);
}

console.log(changed.length
  ? `stamped v${V} across ${changed.length} file(s):\n  ${changed.join('\n  ')}`
  : `already at v${V}`);
