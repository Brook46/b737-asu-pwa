# Knowledge — PDF library PWA

Offline-capable personal PDF library. Add PDFs (with or without annotations),
search across them, get an extractive summary with citations, and jump straight
to the cited page in the original file. Works on iPad and iPhone as an
installable PWA.

## Run locally

```sh
cd "pdf-knowledge-pwa"
python3 -m http.server 8080
```

Open http://localhost:8080 in Safari or Chrome.

## Install on iPad / iPhone

1. Deploy to any HTTPS static host (Cloudflare Pages, Netlify, GitHub Pages).
2. Open the deployed URL in iOS Safari.
3. Share → **Add to Home Screen**.
4. Launch the icon — it runs standalone, with offline support after the first
   load.

## What works today (Tier A)

- Add / delete PDFs at any time. Per-page text and annotations are extracted
  with PDF.js and stored in IndexedDB.
- Full-text search across the library (MiniSearch). Annotations are weighted
  higher than body text.
- Extractive summary with `[file p.N]` citations that jump to the cited page in
  an inline PDF viewer; first annotation on the page is highlighted.
- Light / dark mode, follows `prefers-color-scheme` with a manual toggle.
- Hebrew toggle exposes the UI affordance and a hint that on-device translation
  needs the optional model.
- Service worker precaches the app shell so the app launches offline.

## On-device neural mode (Tier B) — planned

The summary and Hebrew translation get a quality lift by lazily loading small
`transformers.js` models, cached by the service worker. Off by default; opt in
via Settings (UI to be added). See plan in
`~/.claude/plans/i-d-like-to-create-shimmying-panda.md`.

## Online LLM (Tier C) — planned

Optional: paste a Claude API key in Settings to use Claude for higher-quality
summaries when online. Cached results stay available offline.

## Layout

```
pdf-knowledge-pwa/
  index.html, app.css, app.js, sw.js, manifest.json, icon.svg, icons/
  modules/
    storage.js     IndexedDB wrapper
    pdf-ingest.js  PDF.js text + annotation extraction
    search.js      MiniSearch index
    summarize.js   Tier A extractive summary
    translate.js   Hebrew (Tier A passthrough; Tier B/C hooks)
    viewer.js      PDF.js single-page viewer with highlight
    ui.js          theme, language, formatters
  vendor/
    pdfjs/         PDF.js (vendored for offline)
    minisearch.min.js
```
