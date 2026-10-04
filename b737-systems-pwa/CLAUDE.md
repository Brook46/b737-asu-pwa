# 737 NG Inside — app notes

An Innerbody-style explorer for the 737 NG: pick a system, see where it lives
inside a see-through 3D airplane, tap any part for its page, and switch to an
**operable schematic** with an overhead-panel replica. Visual language is
borrowed from lab.patrickheintzmann.com/demo/demoBee: white studio floor with
a fine grid and vignette, thin leader lines to ring hotspots, black mono tag
chips, phase buttons along the bottom (Ground · Takeoff · Cruise · Landing).

## Content rules (read before writing any system text)

- **Source:** the El Al 737 FCOM, `~/Downloads/FCOM.pdf` — D6-27370-858-ELA,
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
  systems3d.js    builds each system's 3D parts from its build(K); animated
                  flow tubes (shader dashes), unit states on/off/fault
  overlay.js      hotspot rings + leaders + chips; avoids HUD and sheet;
                  number-only chips under 760 px
  sheet.js        part / system / overview pages
  phases.js       the four phases: pose, attitude, environment (env)
  schem-kit.js    schematic SVG pieces (pipe, valve, unit, tank, bus) + the
                  HTML "instructor station" (readouts, failures, sim buttons)
  overhead.js     SVG overhead-panel kit drawn to look like the airplane:
                  bat-handle toggles (guards lift first; closing a guard
                  returns the switch to guardPos), knobs, gauges, LCDs,
                  annunciators styled like the FCOM figures. Panel layouts
                  in schem-<id>.js follow the FCOM chapter's panel figures.
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
  schem-<id>.js   that chapter's schematic + panel
  systems.js      the 15 FCOM chapters; ones with `mod` are built
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
- `env` from the phase: `eng1, eng2, apu, gpu, air, flaps, alt, wheel, gearDown, phase`.

## Shipping

- `node scripts/stamp-version.mjs b737-systems-pwa <N>` — it only walks
  `app.js` + top-level `modules/*.js`, so **keep modules flat** (no subfolders).
- OrbitControls lives in `modules/orbit-controls.js` (not vendor/) so that it
  imports three through the same stamped URL as everything else — two URLs
  would load three twice.
- `sw.js` matches `/vendor/` ignoring the query string; new modules must be
  added to `APP_SHELL`.
- Linked from Flight Card's header (`doSystems()` in flight-card-pwa/app.js).

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
- **M2:** Flight Controls, Landing Gear, Engines/APU, Fire Protection, Anti-Ice.
- **M3:** Auto Flight, Instruments, FMS/Nav, Warnings (match gpws-pwa), Comms,
  Airplane General.
- New systems need quiz questions in quizbank.js too, or their pages only
  count as learned by listening.
