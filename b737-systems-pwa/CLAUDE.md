# 737 NG Inside — app notes

An Innerbody-style explorer for the 737 NG: pick a system, see where it lives
inside a see-through 3D airplane, tap any part for its page, and switch to an
**operable schematic** with an overhead-panel replica. Visual language is
borrowed from lab.patrickheintzmann.com/demo/demoBee: white studio floor with
a fine grid and vignette, thin leader lines to ring hotspots, black mono tag
chips, phase buttons along the bottom (Ground · Takeoff · Cruise · Approach · Landing).

## Content rules (read before writing any system text)

- **Source:** the 737 FCOM, `~/Downloads/FCOM.pdf` — D6-27370-858,
  **Rev 57, 30 Sep 2025** (`FCOM_737_20220213.pdf` is the older Rev 48; don't
  use it). Systems Description starts at PDF page ~1254; Limitations at 114.
  FCTM: `~/Downloads/FCTM 737 Eff. 14092021.pdf`.
- The FCOM is Boeing-copyrighted and EAR-marked, and this site is public.
  **Write in our own words, draw our own schematics, never paste FCOM text or
  figures.** Numbers are fine and must cite the section (`FCOM 13.20.6`,
  `FCOM L.10` for Limitations).
- Extract chapter text with pypdf/PyMuPDF into the session **scratchpad
  only** — never into this repo.
- Where the fleet differs (e.g. one battery = 30 min vs main + aux = 60 min;
  PTU flap condition), say so rather than picking one.

## Architecture

```
app.js            shell: state per system, selection, phases, view switch
modules/
  airframe.js     procedural 737-800W + geometry helpers (wingPoint, engPoint,
                  fusSection, fusPoint, loft) — metres, +x fwd, +y up, +z right
  scene.js        renderer, grid floor, shadows, solid↔x-ray skin, camera
                  flights, picking, view offset for the sheet (setInsets)
  world.js        makeEnv(): the shared env every system evaluates against —
                  phase scene + the real engines, electrical, hydraulics,
                  flaps, gear, air and ground-cart state (always consulted,
                  so no system assumes power or pressure). app.js and the
                  logic audit harness both use it.
  outside.js      the world around the airplane: exterior lights from the
                  General switches (strobes, beacons, beams, logo…), ground
                  crew / chocks / cones / GPU and air carts at the gate,
                  airflow streaks in flight scaled by TAS
  airlink.js      ties pages to the airframe: LINKS (system/part → movers
                  collections) get a pulsing overlay twin in the system
                  colour; MOTION moves them while the page is open (aileron
                  rolls, rudder sweeps, doors open…). Add new links there
  cockpit-cab.js  flight deck cab: moulded window frames (per-edge margins —
                  deep at the top so frames merge into the crown), 737 NG
                  control column (U-shaped wheel from the FCOM wheel detail:
                  horns rise from a bottom hub, checklist clip in the centre,
                  trim / A/P disengage / PTT on the outboard horn, memory
                  device inboard; the wheel group rolls with bank), hanging
                  rudder pedals with ribbed faces and kick panels, seats,
                  P6 / P18 circuit breakers on the aft bulkhead, door
  cockpit-stand.js control stand: body, top plate with slots and scales,
                  thrust levers (ivory knobs, TO/GA, A/T disengage, reverse
                  levers), speed brake, flap lever (airfoil knob, gates 1 & 15),
                  start levers, parking brake, trim wheels + indicators.
                  Lever angles in degrees, + = forward (SB_ANG, FLAP_ANG);
                  pose(d) follows the switches and the engines' N1
  viewcube.js     Fusion 360-style navigation cube (CSS 3D, matrix3d from the
                  camera each frame): 3×3 hit zones per face → face / edge /
                  corner views, swung round the target (slerp, never through
                  the airplane); drag to orbit; airplane views only
  quickref.js     QRH memory items (steps above the dashed separator of each
                  Quick Action Index checklist), back-cover quick actions,
                  non-normal maneuvers, # limitations and key numbers, plus
                  every number on the system pages. Source QRH/FCOM Rev 57;
                  ~/Downloads/QRH.pdf. Keep action lines exact — re-check
                  against the QRH on every revision
  systems3d.js    builds each system's 3D parts from its build(K); animated
                  flow tubes (shader dashes), unit states on/off/fault
  overlay.js      hotspot rings + leaders + chips; avoids HUD and sheet;
                  number-only chips under 760 px
  sheet.js        part / system / overview pages
  phases.js       the five phases: pose, attitude, environment (env)
  schem-kit.js    schematic SVG pieces (pipe, valve, unit, tank, bus) + the
                  HTML "instructor station" (readouts, failures, sim buttons)
  overhead.js     SVG overhead-panel kit drawn to look like the airplane:
                  bat-handle toggles (guards lift first; closing a guard
                  returns the switch to guardPos), knobs, gauges, LCDs,
                  annunciators styled like the FCOM figures. Panel layouts
                  in schem-<id>.js follow the FCOM chapter's panel figures.
  cockpit.js      3D flight deck (own scene; scene.setMode swaps what the
                  renderer draws). Overhead = every system's panels(O, ctx)
                  rendered SVG → texture; a tap maps uv → panel units →
                  panel.controls[].act(px, py). Texture top points AFT (that
                  is how the pilot sees the forward overhead). DUs/MCP/ISFD
                  are canvases redrawn at 5 Hz from cockpitData() in app.js.
  cockpit-displays.js  PFD, ND, upper/lower DU, MCP, ISFD drawing + typical
                  engine/flight numbers per phase (illustrative)
  cockpit-info.js "what does this do" card text: switch key → part page +
                  its flight-deck entry; levers/screens get short notes
  search.js       full-text index over every system/part page
  notes.js        favourites + highlights (localStorage, per device)
  speech.js       TTS (speakable() expands units/acronyms for reading aloud)
                  + speech recognition, feature-detected; tap fallback
  quizbank.js     study questions per page ({ sys, part|null, q, c[4], a,
                  why, ref }) — our own words; every number cited
  progress.js     per-page status new/seen/learning/learned/review (14 d)
  reader.js       read-along: splits the page on screen into sentences and
                  highlights sentence + word (CSS Custom Highlight API, no
                  DOM changes; paragraph outline fallback)
  learn.js        Learn dashboard, lesson player (reads pages aloud while
                  the 3D view follows), voice quiz (parseAnswer handles
                  letters, phonetics, spoken numbers, answer content)
  sys-<id>.js     one FCOM chapter: content + build(K) + logic
  schem-<id>.js   that chapter's schematic (mount) + export panels(O, ctx)
                  — the overhead panels, shared by schematic and cockpit
  systems.js      the 15 FCOM chapters, all built (v7)
vendor/three.module.min.js   three r169 (MIT), vendored for offline use
```

### System module contract (`sys-<id>.js`)

```js
export default {
  id, num, title, fcom, color,
  anchor: [x,y,z],                 // overview hotspot
  view: { target, dist, dir },     // camera when the system is picked
  phaseQty: true?,                 // phase change resets st.q (fuel)
  overview: { lead, how[], limits[[label,value,ref]], memory[] },
  parts: [{ id, name, at:[x,y,z], lead, how[], deck[[name,text]],
            limits[[...]], fails[], related[] }],
  build(K),                        // K.flow(key, pts, {part,color,r}),
                                   // K.unit(part, shape, {color,glass}),
                                   // K.wingTank(part, side, z0, z1, u0, u1)
  normal(phase) → { sw, fail, q?, mem? },   // procedures' normal config
  evaluate(env, st) → { flows, units, lights, values, buses?, users?, note },
  tick?(dt, st, env) → changed,    // leaks, fuel burn, cabin pressure
  action?(st, key, label, env),    // spring-loaded switches, sim buttons
}
```

- **One state per system** (`{ sw, fail, q, mem }`) drives both views: 3D
  flows read `evaluate().flows[key]`, units read `units[part]`.
- Phase change resets `sw` (and `mem`, and `q` if `phaseQty`) to `normal()`;
  **failures persist** so you can set one and step through the phases.
- `env` from the phase: `eng1, eng2, apu, gpu, air, flaps, alt, wheel, gearDown, phase`,
  then overridden in `world.js` by the real models: engines (eng1/eng2/apu,
  lever1/lever2), fire (cut1/cut2/cutApu), General's carts (gpu, extAir),
  electrical (bus, acPower), flight controls (flaps, stabApCut), gear
  (gearDown, gearLever), air (ductL/ductR/cab), hydraulics (hydA/hydB/…).
- Logic audit: a harness in the session scratchpad evaluated every system in
  every phase plus cross-system scenarios (lever OFF → no NORM steering,
  cold & dark → standby displays / IRS ON DC, A leak → A/P A off). Re-run the
  same idea after logic changes: import world.js + systems.js in node.
- `needsOthers: true` gives `evaluate` an `env.resOf(id)` to read other
  systems' results (warnings six-pack, instruments, FMS, general). Panels can
  read another system with `ctx.resOf(id)` and bind a switch to it with
  `toggle(…, { ctx: ctx.ctxOf(id) })`.
- Lamp values: truthy = on, `'dim'` (blue lights), `'flash'`. A 9th argument
  to `lamp()` makes it a push-light (MASTER CAUTION, MCP buttons).
  `toggle(…, { invert: true })` when the state's 1 is the TOP position.

### Cross-system links worth knowing

- **Warnings** six-pack (`SIXPACK` in sys-warnings.js) maps each annunciator
  to other systems' amber light keys — rename a light key, update it there.
- **Flight Controls** flap/speedbrake and **Gear** position drive the 3D pose
  (`anim.setOverride` in app.js's frame loop).
- **Instruments** `du` formats choose what each cockpit screen draws
  (`DU_OF`/`FORMAT` in cockpit.js); captain screens read `capIas`.
- **Automatic Flight** owns the MCP (three panels on the glareshield) and
  the FMA (`flight.fma/fmaArm/ap` in cockpitData).

## Shipping

- `node scripts/stamp-version.mjs b737-systems-pwa <N>` — it only walks
  `app.js` + top-level `modules/*.js`, so **keep modules flat** (no subfolders).
- OrbitControls lives in `modules/orbit-controls.js` (not vendor/) so that it
  imports three through the same stamped URL as everything else — two URLs
  would load three twice.
- `sw.js` matches `/vendor/` ignoring the query string; new modules must be
  added to `APP_SHELL`.
- Linked from Flight Card's header (`doSystems()` in flight-card-pwa/app.js).

## Doors, exits and slides

`buildDoors()` in airframe.js: curved skin patches over the painted outlines
(`skinPatch`), each on a hinge pivot — entry/service doors (FCOM: integral
slides) hinge on the forward edge and swing forward; overwing exits are
canopy hatches (top hinge, up and out); cargo doors open in and up. Slides
inflate only once their door is mostly open; escape straps run from the AFT
overwing exits to the wing (FCOM 1.40). Driven by `setDoors()` +
`doorsFrame(dt)` from app.js: General's door state, the Show menu
(Doors open / Evacuation) and the Doors page.

## Panels true to the airplane

Panel layouts follow the FCOM controls figures (Rev 57) and the chapter 1
panel-arrangement figures (1.20.24–1.20.33): forward overhead in five columns
with the lights / ENGINE START row at the front; centre forward panel strip
(N1 SET, SPD REF, FUEL FLOW, MFD, AUTO BRAKE, flap gauge, LE FLAPS); gear
lights over the 3D gear lever; HYD BRAKE PRESS on the F/O panel; A/P-A/T-FMC
lights, speedbrake lights and display select across the top of each forward
panel; parking brake and STAB TRIM cutouts flush on the control stand. Aft
electronic panel per the FCOM figure: fire panel across the front (behind the
CDUs), then left VHF 1 / ACP / nav radios / door lock, centre cargo fire /
transponder, right VHF 2 / ACP. Aft overhead behind the forward overhead:
IRS mode select, oxygen, warning tests. Circuit breakers on the aft bulkhead
behind the seats: P6 floor-to-ceiling behind the F/O, P18 at shoulder height
behind the captain (`breakers()` in cockpit-cab.js). Placement is in cockpit.js
(`onMip`, `AFT`, `COLUMNS`, `FRONT_ROW`). Exterior light switches: OFF up.
Kit extras in overhead.js: `knob({grey})`, `fireHandle()`, `placard()`,
`panel(..., {bg})`, `toggle({noLabels})`.

## FMC, CDU, flight sim (v13)

A study FMC you can program and fly — numbers are rough approximations,
labelled "not for operational use" on the CDU.

- `navdb.js` + `data/navdb.json` — OurAirports (public domain) airports with
  runway ends, VOR/DME/NDB navaids; built by `scripts/build-navdb.py` from the
  CSVs at davidmegginson.github.io/ourairports-data. No named fixes, airways
  or procedures, so waypoints are navaids, airports, lat/lon (`N33E034`,
  `N3201.5E03452.1`) or place/bearing/distance (`BGN270/20`, magnetic).
  Magnetic variation comes from the nearest VOR. Loaded ~1 s after boot.
- `fmc.js` — route with a MOD copy (ACTIVATE arms, EXEC makes it active;
  direct-to inserts PPOS), legs (origin runway → waypoints → FFxx 8 NM out
  on the centreline → threshold), V-speeds / VREF / N1 approximations,
  vertical profile (T/C by climb integration, T/D on a 3° path, 318 ft/NM),
  LNAV sequencing (turn anticipation; reversals > 100° fly over). Persisted
  in localStorage `b737inside.fmc`.
- `cdu.js` — pages (IDENT, POS INIT, RTE, DEP/ARR, LEGS, PERF INIT, N1 LIMIT,
  TAKEOFF REF, CLB/CRZ/DES, PROG, APPROACH REF) as a 14 × 24 cell grid with
  colours; `drawCDUScreen` paints it for the 3D CDUs. `cdu-view.js` is the
  floating keypad (physical keyboard works while open).
- `flightsim.js` — kinematic airplane flying the active route: TO/GA roll,
  LNAV at 50 ft, VNAV at 400 ft, VNAV SPD/PTH/ALT, "RESET MCP ALT" at T/D if
  the MCP isn't lowered, LVL CHG / V/S / ALT HOLD / HDG SEL, LOC and G/S
  capture (APP), approach steps via the autopilot's `step` action, flare,
  rollout, go-around if the runway is overflown. It writes the modes into
  the Automatic Flight `mem`, so the FMA and MCP lights are the real ones.
  Auto flaps and gear by speed / distance to go.
- Integration: `makeEnv({ flight })` overrides air / alt / wheel while
  flying; phases change *softly* (`softPhase` — no switch reset); the phase
  buttons stop the sim. ND MAP (`navData()` in app.js → `drawND`) is track
  up with the route, waypoints, runways, T/C, T/D, VNAV deviation; PFD has
  bank, speed / altitude bugs, V1/VR, RA. Cockpit bar: CDU · LINE UP ·
  TO/GA · pause · 1–64× · ND range. The 3D CDUs sit at the front of the aft
  pedestal; tapping one opens the keypad.
- Debug: `__app.fmc`, `__app.sim`, `__app.cdu`; `__app.cockpit.screens`.

## Voice

speech.js ranks installed voices (Premium / Natural / Enhanced first, novelty
voices never) and the Learn page has a voice picker with a sample; iOS users
are told to download a Premium voice when only basic ones exist.

## Toolbar

Views on top; then tools (QRH · Learn · Search · Saved) and display (Show ▾ ·
Night · Home). Show menu toggles are stored in localStorage
`b737inside.show`. On a mouse the HUD fades to 42 % over the 3D view and comes
up on hover.

## Engines

CFM56-7B nacelle (`buildAirframe`, "Engine"): inlet ~4 m ahead of the wing
LE, fan nozzle at the LE, core cowl + long plug under the wing, lower half
flattened (`flattenBottom`), ~0.45 m ground clearance. `ENG` moves every
engine-mounted system part with it (engPoint).

## Fuselage windows

Windows and door outlines are painted (`paintLivery`) onto a canvas in the
fuselage's UV space (u nose→tail, v round the section from the belly), from
side-view outlines in metres — they follow the nose curvature exactly. Edit
the `shield` outlines there, not geometry.

## Debugging

On localhost `window.__app = { api, airframe, anim, s3d, states }`, e.g.
`__app.api.flyTo(new __app.api.THREE.Vector3(15,3,0), 14)`.
Dev server: `.claude/launch.json` → "737 NG Inside" (port 8101).

## Milestones

- **M1 (done):** shell, airframe, phases, Electrical, Hydraulics, Fuel, Air.
- **M2 (done, v7):** Flight Controls, Landing Gear, Engines/APU, Fire Protection, Anti-Ice.
- **M3 (done, v7):** Auto Flight, Instruments, FMS/Nav, Warnings (GPWS phrasing
  matches gpws-pwa), Comms, Airplane General.
- Not modelled in 3D cockpit: the door lights panel (not on this fleet's
  overhead figures) — it lives in the schematic view.
- New systems need quiz questions in quizbank.js too, or their pages only
  count as learned by listening.
