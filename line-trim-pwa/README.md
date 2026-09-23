# Line Trim

Check a paraglider's line trim against the **manufacturer's own check lengths**.
Pick your wing, connect a laser (FNIRSI IR40, Bosch GLM/PLR and Leica DISTO are supported directly)
or type the readings, walk the lines on both sides, and get a clear plan: which main to shorten
or lengthen and by how much, which single line to inspect, and whether the wing is
trimmed faster or slower than factory.

Vanilla ES modules + a service worker. No build step, no framework, no backend.
Works offline once loaded — take-off rarely has signal.

---

## Using it

1. **Wing** — search or filter by class, tap your wing, tap your size. Dashed sizes
   have no published lengths yet; tapping one lets you add your own sheet.
2. **Setup** — choose where the tape starts:
   - **riser bottom** (lines + risers) — how the check sheets are written, or
   - **maillons** (lines only) — targets drop by the riser length on every A–E line;
     brakes are unchanged. Only offered when the sheet states the riser length.

   Connect the laser, or stay on manual entry.
3. **Measure** — the glider (model, size, and its **serial number and owner**, which
   you can add or edit right there) heads the screen. Below it is a **line plan drawn
   like a manufacturer's rigging diagram**: the canopy with its ribs, every line drawn
   from its attachment point down its cascade to the riser — front lines up to the A
   riser, rear lines down to theirs, the side's brakes on the other half down to the
   handle. The line being measured is traced end to end (e.g. A10 → AMU9 → AM5 → AML1
   → AR3 → A riser), so it's clear which physical line to put the laser on. Cascade
   levels come from the sheet when it names them (BGD); otherwise point → main →
   riser. Tap any point to jump to it; swipe the card to move. The last serial and
   owner used for a model + size are offered on the next check.
   **Auto-next** (on by default, toggle on the card): a laser shot is entered and the
   card moves on by itself — no Next to press. Both kinds of meter work: *single-shot*
   meters (Bosch, Leica, the IR40 in single mode) are taken the moment a shot arrives
   with nothing following it; *streaming* meters are taken once they **hold steady**
   (3 samples within 2 mm, median recorded). Capture re-arms only on a new shot or the
   beam moving, so one reading can never land on two lines. A shot more than 4× the
   tolerance off target is **held** on screen instead of saved — usually the wrong
   line — and the next shot replaces it. Typing works the same way: four digits near
   the target move on after a short pause. The **Saved · Redo** chip on the card
   jumps back to the line just entered.
4. **Results**
   - a verdict and three numbers: **trim speed** (angle of incidence), **symmetry**,
     **worst line**;
   - **Your trim plan**, in working order — re-measure odd readings, inspect uneven
     lines, adjust the mains (*"Left CR2 — shorten 11 mm"*, with the way to do it:
     trim loop, extra larks-head turn or knot in the end loop, and a **How →** link
     to the drawing in the guide), set the brakes, re-measure, test fly. **Preview result** re-runs the whole analysis as if the change
     were made; **Re-measure** walks just that main's lines, then drops you back here;
   - a **trim profile** per side (every row centre → tip against the tolerance band);
   - **angle of incidence** per section;
   - details: reference choice, left/right per main, every reading.

   - **Save** — give the check a name and the date it was measured, plus notes.
5. **Your checks** (clock icon) — every saved check, grouped by wing and size, newest
   first. Rename, re-date or delete; tick two of the same wing and **Compare** to see
   what moved between them (trim speed, symmetry, whole-set length, a per-side change
   chart, the biggest movers, every main).
   - **Add past check** — load readings taken before, from an .xlsx/.csv or pasted
     text ("A1 6421 6425"); the app finds the line column and asks which column is
     left and which right (L/R, Left/Right, Links/Rechts, Gauche/Droite are
     recognised). Saved as an imported, dated check.
   - **Export backup** (JSON — every check and your own wings; **Restore backup**
     merges it back, newer copy wins) and **Export CSV** (every reading of every
     check, one row each, for a spreadsheet).
6. **Trimming guide** (i icon) — how to change a length, each with a before → after
   drawing (drawn the right way up: riser at the bottom, lines up to the wing) and
   numbered steps: larks head, trim loops, an extra turn, a knot in the end loop,
   **soft links** (how to open, adjust and re-close them, and when to replace one),
   brake lines. Then the order to work in.

The check in progress is saved on every reading — closing the app loses nothing.

## The wing library

Every number comes from a manufacturer-published **manual / check** table:

| Class | Wings |
|---|---|
| EN A | BGD Anda, BGD Magic |
| EN B | BGD Base 3, BGD Epic 2, BGD Punk, Ozone Rush 6 |
| EN C | BGD Cure 2, BGD Cure 3, BGD Lynx 2 |
| EN D | Advance OMEGA ULS, BGD Diva 2, Ozone Zeolite, Ozone Zeolite GT\*, Ozone Zeolite 2\*\*, Ozone Zeolite 2 GT |
| Tandem | BGD Dual 2 |

16 wings, 65 sizes ready to measure.

\* Ozone's Zeolite GT chart is the Zeolite chart with the outer B lines (B9–B17)
blank and "Zeolite" headers; the app shows that caution on setup — check it against
your GT's manual. Nova publishes no absolute line lengths (relative, via NOVA Trim
Tuning), so Nova wings can't be listed; load an NTT report as a past check instead.

\*\* Ozone publishes one set of inspection files for the Zeolite 2 and Zeolite 2 GT, all titled
"Zeolite2 GT" (MS and ML chart sheets marked "preprod"); the chart matches Ozone's per-size
manual line checks exactly. Both wings use it, each with a caution on setup. The chart gives
lines + risers only, so these two are measured from the riser bottom; the sections follow
Ozone's own check (lines 1–4, 5–8, 9–11, stabilo) with A+B at the front and C+D at the rear.

 BGD sheets also give the full cascade
(top → middle → main), the rib of every attachment point, the riser length, and which
mains carry trim loops — so the advice and the diagram are specific to the wing.

**Only manual tables are used.** Manufacturer sheets often carry a *production* table
beside the manual one, and they differ by up to 40 mm (Cure 3 M brake K1: 7573 manual
vs 7533 production) — four times the tolerance. A size whose sheet has no clearly
labelled manual table is left for you to add rather than filled with the wrong numbers.
Sizes waiting for a sheet: BGD Magic ML, Base 3 M, Dual 2 38, Advance OMEGA ULS 21 and 24.

Advance delivers its sheets by email (advance.swiss → Downloads → model → Maintenance →
Total line length), so those come from you.

### Adding a wing or a missing size

Drop the manufacturer's `.xlsx` or `.csv` on the import screen. The reader finds the
manual check table (never a production one), plus the cascade and rib positions when
the sheet has them; if a workbook holds several candidate tables you pick one. Your
wings stay in your browser — they are never uploaded anywhere.

## How the numbers are read

| | |
|---|---|
| Check length | riser bottom → canopy at **5 kg** line tension |
| Per-line tolerance | **±10 mm** (adjustable) |
| Whole-set offset | up to **±50 mm** is normal stretch |
| Implausible | more than **4× tolerance** — a mis-hooked line or typo |

- **Left and right are measured separately.** A wing that turns is an asymmetric wing.
- **A main's length is the mean of its suspension points** — the main is what you
  adjust, and it moves its whole fan.
- **Deviations are relative to a reference** (median of all lines by default), not raw
  against nominal: uniform stretch barely changes how a wing flies.
- **Angle of incidence** = rear main − front main, per span-wise section.
  **+ = faster** (rears long, nose trimmed down), **− = slower**.
- One line off inside a main is an **inspect**, not a trim number — adjusting the main
  moves every line on it. On a two-line main the same line on the other side names the
  culprit.

## Laser meters

Web Bluetooth — **Chrome or Edge on Android, macOS, Windows, ChromeOS or Linux**.
On a Mac, allow Chrome under System Settings → Privacy & Security → Bluetooth the
first time. Safari (including every browser on iPhone/iPad) and Firefox have no Web
Bluetooth; manual entry works everywhere.

| Driver | |
|---|---|
| FNIRSI IR40 | direct support; starts continuous measuring, ignores area/rectangle frames, converts ft/in |
| Bosch GLM / PLR | Bluetooth "C" models (GLM 50 C, 100 C, 50-27 C…, PLR 30/40/50 C); press measure on the meter, each shot is entered |
| Leica DISTO | Bluetooth models (D1, D110, D2, D510, D810, X3/X4…); press measure on the meter |
| Nordic UART | generic BLE meters and DIY ESP32 rigs |
| Sniff | watch an unknown meter's frames to identify it |
| Mock (stream / button presses) | simulated lasers for trying the app; they aim near the line on screen, with the odd mis-aimed shot |

**Zero offset**: if your laser doesn't sit exactly at the reference point, calibrate on a
line you know (measure screen → Calibrate) or set the offset in setup.

## Development

```bash
python3 dev-server.py 8060
```

No-cache static server. The service worker is **off on localhost** (and cleared if
present) so edits show on reload.

Tests — plain Node, no dependencies:

```bash
for t in test/check-*.mjs; do node "$t" || break; done
```

| test | covers |
|---|---|
| check-library | every built wing: structure, and a full analysis per size (perfect wing → in trim; long rears → faster) |
| check-extract | every sheet-reading trap met on real files (styled empty cells, side-by-side tables, production/manual labels, formulas, cascade markers) |
| check-sheet | the .xlsx/.csv reader |
| check-capture | single-shot and stream capture, re-arming, never one reading on two lines |
| check-meters | IR40, Bosch and Leica frame parsers |
| check-pastcheck | past-check import: wide/long layouts, side headers in four languages |
| check-omega | Advance OMEGA ULS data: every published main = mean of its points |
| check-imports | every named import exists — a missing export blanks the whole app |

### Rebuilding the library

```bash
node scripts/build-library.mjs <folder-with-the-downloaded-sheets>
```

`scripts/library-sources.json` lists each wing's source files. The build refuses any
wing that fails validation, including sizes whose lengths don't increase from small to
large — the check that catches a sheet filed under the wrong size. Legacy `.xls` files
need converting to a grid first (see the script header).

### Deploying

Static files, any host (GitHub Pages works as is). On a change: bump `CACHE_VERSION` in
`sw.js` and `?v=` on `app.js`/`app.css` in `index.html`; new modules go in the `SHELL`
list. The wing library is precached from `data/wings/index.json` automatically.

## Credits

Line-check method and the left/right, mains-as-mean, reference and AoI conventions
follow [we-measure.io](https://we-measure.io). Check lengths from BGD, Ozone and
Advance's published sheets (retrieved 2026-09-23); the manufacturer's current sheet is
always the authority. IR40 protocol from
[MultiMote/fnirsi-ir40-webtool](https://github.com/MultiMote/fnirsi-ir40-webtool).

---

**Not a certified measuring instrument.** Line lengths affect airworthiness. If in
doubt, have a qualified workshop check the wing.
