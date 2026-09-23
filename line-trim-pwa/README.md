# Line Trim

Check a paraglider's line trim against the **manufacturer's own check lengths**.
Pick your wing, connect a laser (the FNIRSI IR40 is supported directly) or type the
readings, walk the lines on both sides, and get a clear plan: which main to shorten
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
3. **Measure** — the wing is drawn from above with a dot on every attachment point,
   placed on its **real rib** when the sheet lists rib positions. Each line shows its
   target, a live deviation gauge (green band = tolerance), and where it sits
   (side · row · main · rib). Tap any dot to jump to it; swipe the card to move.
   With a laser connected the reading is captured automatically once it **holds
   steady** (3 samples within 2 mm, median recorded), and capture only re-arms after
   the beam moves — one steady reading can never land on two lines.
4. **Results**
   - a verdict and three numbers: **trim speed** (angle of incidence), **symmetry**,
     **worst line**;
   - **What to do** — a checklist: *"Left CR2 — shorten 11 mm"*, saying whether that
     main has a trim loop. **Preview result** re-runs the whole analysis as if the change
     were made; **Re-measure** walks just that main's lines, then drops you back here;
   - a **trim profile** per side (every row centre → tip against the tolerance band);
   - **angle of incidence** per section;
   - details: reference choice, left/right per main, every reading.

The check in progress is saved on every reading — closing the app loses nothing.

## The wing library

Every number comes from a manufacturer-published **manual / check** table:

| Class | Wings |
|---|---|
| EN A | BGD Anda, BGD Magic |
| EN B | BGD Base 3, BGD Epic 2, BGD Punk, Ozone Rush 6 |
| EN C | BGD Cure 2, BGD Cure 3, BGD Lynx 2 |
| EN D | Advance OMEGA ULS, BGD Diva 2 |
| Tandem | BGD Dual 2 |

12 wings, 49 sizes ready to measure. BGD sheets also give the full cascade
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

Web Bluetooth — **Chrome on Android or a computer**. iOS Safari has no Web Bluetooth;
manual entry works everywhere.

| Driver | |
|---|---|
| FNIRSI IR40 | direct support; starts continuous measuring, ignores area/rectangle frames, converts ft/in |
| Nordic UART | generic BLE meters and DIY ESP32 rigs |
| Sniff | watch an unknown meter's frames to identify it |
| Mock | a realistic simulated laser for trying the app |

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
| check-capture | steady-reading capture |
| check-ir40 | the IR40 frame parser against the documented packets |
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
