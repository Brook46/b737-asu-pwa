# Sky Club — app notes

"Sky Club": a solar-system + real-sky explorer for a toddler (age 2–5) — near-zero reading, big taps, spoken narration. Four screens: a **Home** landing screen (rocket hero, shown once per load) plus **Explore**/**Sky**/**Badges**, switched by a 3-tab bottom nav.

## Explore: a 3-D solar system (current architecture)

Rebuilt on request ("give it 3-D options, really elliptic orbits, real-looking
planets, fire and solar storms on the Sun"). **Read this before touching
`orrery3d.js`, `globe.js`, `sunfx.js` or `cardglobe.js`** — the older Explore
notes further down describe the nested-`<div>` orrery this replaced.

**Why a rebuild, not a restyle:** the old orrery rotated nested divs, which can
only ever trace circles. Real ellipses and a camera you can tilt need real 3-D
positions and a projection, so the orrery is now one canvas.

**Orbits are real (`astro.js::helioEcliptic`/`orbitPath`, `orrery3d.js`)**:
- Each planet is at its real heliocentric 3-D position (`HelioVector`, EQJ
  rotated to the J2000 ecliptic). Each orbit line is traced from the ephemeris
  itself over one period — the sampled paths reproduce the textbook elements
  (Mercury a 0.387 AU, e 0.206, i 7.00°; Mars e 0.093; Neptune a 30.07 AU).
- Each orbit is scaled **uniformly** (display radius ÷ real semi-major axis),
  so every ellipse keeps its true shape with the Sun at the focus; only the
  gaps between orbits are compressed. **Spacing uses real geometry**: each
  orbit is pushed out only as far as its actual closest approach to the one
  inside it requires (orbits sampled by direction). Padding for the naive
  worst case (inner aphelion vs outer perihelion) made the system ~50% bigger
  and every planet a third smaller on a phone, because the orbits' long axes
  point in different directions and never line up like that.
- **Real distances** (ruler button) morphs to true AU spacing — the inner
  planets collapse into a knot round the Sun; that's the lesson.
- Planets are drawn `PLANET_BOOST` (1.6×) larger than the room the layout
  reserves: at a size that can never touch a neighbouring orbit, Earth is 3 px.

**Camera**: perspective, orbiting the Sun. Drag = swing round / tilt (with
inertia), pinch/wheel/± = zoom, cube button = Tilted (42°) / Top / Side. Clean
view slowly turns the camera. The fit allows ~12% for perspective widening of
the near half of the outer orbit. Draw order: orbit lines behind the Sun's
depth → bodies behind the Sun → the Sun → orbit lines in front → nearer bodies,
so the Sun correctly hides what's behind it. The loop idles when Explore isn't
showing or a card is open. Measured: the heaviest frame callback ~1.5 ms on a
desktop at 120 fps.

**Worlds are real lit spheres (`globe.js`)** — plain 2-D canvas, no WebGL
(still the app's rule). Per pixel: surface normal → body frame → lat/lon →
texel from the equirectangular texture, lit by the true Sun direction. So each
planet shows its real phase from where the camera is (a crescent when it's
between you and the Sun), spins about its **real pole** (IAU pole RA/Dec →
ecliptic: Uranus on its side, Venus and Uranus turning backwards), with a soft
terminator. The asin/atan2 per pixel depend only on orientation, not spin
(spin is a longitude offset), so they're cached in tables rebuilt only when the
camera moves. Extras: Earth's procedural clouds (tileable fbm noise), ocean sun
glint (half-vector specular on blue texels), atmosphere rims and halos; Venus
washed cream (its texture is too brown for its cloud deck); gas-giant limb
darkening. **Saturn's rings** are a square texture of the real radial profile
(sampled from `saturn-ring.png`'s major axis) drawn through the affine
projection of the ring plane, split into a far half (before the globe) and a
near half (after), so they wrap round it at the real 27° tilt.

**The Sun (`sunfx.js`)**: the real texture on a sphere, brightness mapped onto
a solar palette (the raw texture's hues included greens) with strong limb
darkening that also reddens, and animated granulation. Around it: chromosphere
rim, flickering spicules (the "fire"), soft corona streamers, prominences as
wavering filamentary loops in hydrogen-alpha red that grow, sway and fade, and
flares — a white-hot flash, a shock arc, and a coronal mass ejection of
streaking plasma that cools from white to red (sometimes carrying a prominence
away). Real physics, compressed timing. `'full'` detail on the card, `'lite'`
in the orrery.

**Cards (`cardglobe.js`)**: planets and the Sun get the rendered globe (the
`is-globe` class hides the old CSS spin texture); the canvas is larger than the
hero wrap so rings, halos and the corona have room. Real axial tilts, tipped
16° toward the viewer so a pole shows, studio light from the left. The Moon
keeps its own phase renderer (`moonphase.js`).

## Sky screen: a real camera over the real sky (current architecture)

Rebuilt after the report that pointing the phone at a star didn't put it on
screen. **Read this before touching `sky.js`/`sensors.js`** — the sections
further down describe earlier versions and are kept for their lessons.

**Why pointing didn't work — five stacked bugs, all fixed:**
1. **The projection was not a camera.** Objects were placed at
   `Δazimuth × px-per-degree`, which is only right looking at the horizon. Near
   the zenith, 30° of azimuth is a few degrees of sky, so anything high up was
   drawn far from where it is (a star 20° off in azimuth at 50° altitude landed
   ~7° / ~100 px wrong), and constellations were visibly sheared.
2. **Roll and landscape were ignored.** Pitch was `beta − 90`, which only means
   pitch in upright portrait. An iPad held landscape — the natural way to hold
   one — swapped the axes entirely; a tilted phone showed an untilted sky.
3. **Magnetic north treated as true north.** iOS's `webkitCompassHeading` is
   magnetic. Declination is ~5.0° in Tel Aviv, 12.8° in San Francisco, −12.5° in
   New York, −26.8° in Cape Town.
4. **The compass flips 180° as you look up.** Measured on real iPhones (see the
   calibration comment in `sensors.js`): the reported heading follows the TOP
   edge while the screen faces up, then switches to the CAMERA past ~120° of
   tilt — exactly the pose used to look at the sky. WebKit passes `CLHeading`
   straight through (`WebCoreMotionManager.mm`), so this is Core Location's
   behaviour and can't be configured away from JS.
5. **The Milky Way was computed with RA in degrees where `Horizon()` wants
   hours** (`astro.js`'s old `milkyWayPositions`), so the band was drawn in an
   unrelated part of the sky. Plus: two hand-typed catalogue stars were well
   off (Kaus Borealis 2.5°, Algorab 1.4°), and the reticle sat at 44% height
   while the projection centred at 50%, a few degrees of built-in aiming error.

**Orientation (`sensors.js::readView()`)** — the SkyView/Star Walk model. The
device's full orientation is a quaternion from W3C alpha/beta/gamma
(`Rz(α)·Rx(β)·Ry(γ)`, world = East-North-Up), right-multiplied by
`Rz(−screen.orientation.angle)` for landscape (same convention as three.js's
DeviceOrientationControls), then rotated about "up" by the compass correction
and the WMM declination. The camera looks out of the back (`−z`); `right`/`up`
are the screen's axes. Light motion-adaptive smoothing (steady when still,
immediate when swung).
- **iOS calibration**: alpha is gyro-fused but its yaw reference is arbitrary
  (WebKit uses CoreMotion's default `XArbitraryZVertical` frame), so an offset
  to magnetic north is learned from `webkitCompassHeading`. Samples taken
  **screen-up** are authoritative (then it is unambiguously the top edge, in
  portrait or landscape). Before one arrives, a provisional estimate uses the
  top edge below ~110° of tilt, the camera past ~130°, and nothing in the
  switch band between. Once authoritative, other poses are ignored and the gyro
  carries the view. A 60° jump gate (adopt only if it persists ~¾ s) rejects
  flips and magnetic disturbances; `webkitCompassAccuracy < 0` is discarded.
- **Android**: `deviceorientationabsolute` alpha is already north-referenced
  (magnetic); only declination is added.
- **Declination** (`geomag.js` + `wmm2025.js`): World Magnetic Model 2025,
  degree-12 spherical-harmonic synthesis, no dependencies. Verified against the
  `geomagnetism` npm package's implementation to 1e-9° across 30 place/date
  cases. The model is valid to late 2029 — swap in WMM2030 coefficients then.
- **Tested with physical-pose scenarios** (28 checks): each pose (bearing,
  altitude, roll, portrait/landscape) is turned into the events iOS would send
  — arbitrary alpha frame, magnetic compass following top edge or camera by
  pose — and the recovered view must match within 1°. Covers glancing at the
  screen then looking up, starting already pointed up, both landscape
  rotations, rolled phones, and swinging through the switch band.

**Sky model (`astro.js`)** — everything is a unit vector. Stars, figures and the
Milky Way are fixed in J2000 (EQJ); `eqjToEnu()` is one `Rotation_EQJ_HOR`
matrix per second (includes precession/nutation; matches `Horizon()` to
<0.01″). Each frame the camera basis is rotated into EQJ instead, so a star is
three dot products. Sun/Moon/planets come from `skyBodies()` with refraction and
real apparent magnitude (`Illumination().mag`).

**Rendering (`sky.js`)** — gnomonic (pinhole) projection, `x = f·(v·right)/(v·fwd)`,
60° across the screen's short side, pinch/wheel zoom 18–110°. Great circles are
straight lines, so constellation figures stay straight at any angle. Lines
crossing behind the viewer are clipped to a near plane before projecting.
- `#sky-bg`: **per-pixel sky model at low resolution** (≤18k px, browser
  upscale = free softness): night gradient with horizon airglow, daylight
  Rayleigh blue, twilight band on the Sun's side, sun glare, moon glow and
  moonlight brightening, the ground below a gentle procedural skyline, and the
  Milky Way sampled from `data/milkyway.png`. Redrawn only when the view turns
  by ~half a backdrop pixel or the sky changes.
- `#sky-fg` (DPR ≤2, ≤3.2 MP): constellation figures (the one under the
  reticle highlighted; underground ones faint), ~5,000 stars as point-spread
  sprites sized/brightened by magnitude and tinted by real B−V colour, with
  atmospheric extinction near the horizon, scintillation on bright stars, and
  stars below the skyline shown faintly "through" the ground. Sun, Moon (real
  phase via `moonphase.js`, rotated so its lit limb faces the Sun's real screen
  direction) and planets (real textures, small, inside a brightness-scaled
  glow; Venus washed cream, Saturn ringed). Skyline and N/E/S/W points.
  Labels are placed in priority order with overlap rejection.
- **Brightness follows the real sky**: limiting magnitude falls from 5.3 (dark,
  deliberately suburban so the screen matches what you can actually see) with
  twilight and moonlight; zooming in reveals fainter stars. In daylight, stars
  are still drawn faintly to mag 2.3 ("they're still up there").
- **Performance**: measured with a direct render benchmark. Before the redraw
  threshold the backdrop cost ~5.6 ms per redraw and redrew on every hand
  tremor; now a still-ish frame is ~0.3 ms of script and a steady pan ~1.2 ms
  on a desktop. Label halos are `strokeText`, never `shadowBlur` (slow on iOS).
  The loop idles when the Sky tab isn't showing.

**Data (`tools/build-sky-data.mjs` → `data/sky.json` + `data/milkyway.png`)**:
d3-celestial (BSD-3, Olaf Frohn; HYG/Hipparcos stars, Stellarium figures,
Milky Way contours). 5,044 stars to mag 6.0 (brightest first, so the draw loop
stops at the limiting magnitude), 378 proper names, 88 constellations with
Latin labels. `data/stars.json` remains the hand-edited source of facts, kid
names and distances; the build **joins it to the catalogue by position and
fails** if a curated star doesn't match a real one (which is how the two bad
coordinates were found). The Milky Way contours are rasterised to a 720×160
map in galactic coordinates — they can't be filled as screen polygons because
the band encircles the viewer and has no well-defined inside once projected.

**Testing aids**: `?at=2026-10-11T18:30Z` runs the Sky screen at that moment
(day, twilight, moonless night on demand). `sensors.js::_feedOrientation()`
accepts synthetic events through the real path — import it from an injected
`<script type="module">` (same module instance as the app; `javascript_tool`'s
own `import()` is a separate realm). The app's freeze detector reloads to Home
when the preview pane is hidden (rAF pauses), so enter the sky and act in one step.

## "Mission Control" visual redesign (Nocturne)

The app's chrome (buttons, nav, cards, backgrounds, text — NOT the real per-body colors in `catalog.js`/`stars.json`, which are untouched) uses a dark-violet "Nocturne" design-system palette, imported from a Design-tool mockup and adapted into this vanilla-JS/no-build app by hand (the mockup's own React/`DCLogic` runtime was never a dependency — visual/UX intent only). Tokens live in `app.css`'s `:root` (`--color-bg`, `--accent-300`..`--accent-900`, etc.).

**CDN assets** (real Phosphor Icons + Google Fonts "Inter", not local approximations): loaded via `<link>` tags in `index.html`'s `<head>`, same "vendor a real CDN dependency, cache it after first load" pattern as `xcsky-pwa`'s Leaflet. `sw.js` has a dedicated cache-first-after-first-fetch branch for `fonts.googleapis.com|fonts.gstatic.com|unpkg.com` (mirrors `xcsky-pwa/sw.js`'s Leaflet-URL branch) — this is *runtime* caching, not precaching, since Google Fonts' actual `.woff2` URLs are content-negotiated per browser and unknowable ahead of time. Chrome glyphs use `<i class="ph-fill ph-{name}">`; real body glyphs (planet/Sun/Moon emoji, star/constellation content) are untouched.

**Home screen** (`#home-screen`, the default active screen on load): reuses the exact same `modules/starfield.js::initStarfield()` call (a second canvas instance, `#home-starfield`) and `.galaxy` blobs as Explore's background — no separate star/aurora generator. Two CTAs (`#home-blastoff`/`#home-lookoutside`) jump straight to Explore/Sky via `switchScreen()`. There's no dedicated way back to Home from the tab bar (matches the mockup's actual structure — the 3-tab nav only ever targets Explore/Sky/Badges) — reloading the app (e.g. via resume-hardening after backgrounding) is what brings it back, which is fine since this app already force-reloads on resume and holds no session state worth preserving.

**Badges** (`modules/badges.js` + `#badges-screen`): a "spot the sky" collection game, scoped to `BADGE_BODIES = [SUN, ...PLANETS, MOON]` — Sun, Moon and the 8 planets, 10 total (originally 8 planets only, matching the mockup's grid; expanded on request — Sun/Moon are just as "collectible" as any planet). Stars/constellations stay fully tappable/informative everywhere but never get a badge card; a 100+ star catalog isn't a "collect them all" checklist the way ten solar-system bodies are. Spotted state is a plain `Set` of ids persisted to `localStorage` (`skyclub.spotted`), with a tiny `onChange()` pub-sub so the Badges grid, the topbar's `#badge-chip` count, and (indirectly) the Explore card's Spot-it button/orrery outline all stay in sync without any shared framework. `isBadgeBody(id)` is the one place that scope is defined — `orbits.js`/`sky.js` both call it instead of checking `PLANETS` directly. Two entry points feed the same `spot(id)`: `orbits.js::renderCard()`'s "Spot it"/"Got it!" toggle button (button state IS the feedback, no toast), and `sky.js::catchBody()` when a real marker is tapped or dwelt-on in Sky mode (shows a `#sky-toast` banner via `badges.js::showToast()`, since there's no persistent card there to carry the feedback).

**Planet card as a bottom sheet**: `#planet-card` changed from a full-screen centered overlay to a bottom-sheet layout (`.sheet` slides up from the bottom, backdrop dims/blurs) to match the mockup's detail-sheet style. This was a pure layout/CSS change — every real-rendering child (`#spin-texture`, `.sphere-vignette`/`.sphere-shade`, `#moon-phase-canvas`, the ring layers) kept its exact existing class names and JS wiring, just resized into a smaller left-side globe instead of a big centered one.

**Orrery/Sky markers are flat gradient spheres, not photo textures or emoji**: the first redesign pass kept the orrery's small bodies (14-46px) as the same photo-texture rendering the detail card uses — reasonable in theory ("preserve the real engine"), but at that size a JPG texture just reads as a blurry smudge, not a crisp planet. The Nocturne mockup's own recipe for small bodies is a flat two-tone `radial-gradient(circle at 33% 28%, #fff, LIGHT 42%, DARK 88%)` plus a size-proportional glow (`--dot-glow`) — `catalog.js` now carries the mockup's exact `light`/`dark` hex pairs per body, and `orbits.js::makeBodyButton()` builds a `.body-dot` span with those instead of a `.planet-frame`/`.planet-texture` pair. Saturn's orrery ring is a single rotated ellipse border (`.body-ring`, the mockup's own simple treatment) rather than the front/back-split PNG. **The detail card is untouched** — at ~100px the real photo texture, self-rotation, sphere-shading and PNG ring still look good, so `renderCard()`/`#spin-texture`/`.ring-layer` etc. keep working exactly as before; only the ORRERY's tiny bodies changed. The Sky screen's Sun/Moon/planet markers (`sky.js::makeMarker()`/`makeArrow()`) got the same `.body-dot` treatment in place of the old 34px emoji glyph, which read as a cartoon sticker floating in an otherwise sleek sky — real stars/constellations (`makeStarMarker()`) were already a proper glowing-dot treatment and are untouched.

## Second design pass (from the project's "build prompt" spec)

The Design project later added a literal, mechanical build spec (`Sky Club - build prompt.md`) with exact colors/keyframes/measurements. Diffing it against what had shipped surfaced a few concrete gaps, since fixed:

- **Full palette**: added the spec's remaining tokens — `--color-deep` (#0d0f1c, the planet-card scrim), `--color-dim` (#75798c, inactive nav-tab text — distinct from the existing `--color-text-dim` #9397ab used for muted labels), `--color-body` (#cfd3e5, descriptive copy like `.card-fact`/`.screen-subtitle`), `--accent-pale` (#e7e5fe, active-tab text / earned-badge names / the "Got it!" spot button).
- **Sky screen reticle**: `.reticle` went from a bare circle to the spec's layered target — a pulsing outer ring (`.reticle-ring`), a static dashed inner ring (`.reticle-dash`), and a small glowing center dot (`.reticle-dot`) — plus a pulsing `.sky-arrow-hint` (`ph-arrow-up`) above it, since neither existed before.
- **Spotted-planet outline**: tapping "I spotted it" now visibly rings that planet — `2px solid rgba(181,171,252,.85)` — directly on its orrery dot AND its Sky-mode marker (if currently visible), not just inside the card/Badges grid. `orbits.js`/`sky.js` each keep a `refreshSpottedOutlines()` wired to `badges.js::onChange()`, toggling a `.spotted` class whose CSS (`.spotted .body-dot`) is shared by both screens since both markers carry the `.body-dot` class.
- **Marker float + screen-entry rise**: Sky-mode body markers get a gentle idle float (`.marker-dot`'s own `marker-float` animation, staggered via an inline `--float-delay` — deliberately on the inner dot span, NOT the outer `.sky-marker-body` button, since that button's `transform` is overwritten every frame by `sky.js::project()` for real screen placement, and a CSS animation on the same property would fight the inline one and win). Screen content (`.home-hero`, `.screen-header`, `.badges-header`, `#badges-grid`) replays a `rise` fade/slide-up automatically whenever its ancestor `.screen` goes from `display:none` back to `:flex` — free entrance animation, no JS trigger needed, since `display:none` removes an element from the render tree and re-adding it restarts any `animation` on its subtree.

**Milky Way in Sky mode** (superseded — see the architecture section): the first version scattered points along the galactic plane and projected them with `Horizon()`, but passed RA in degrees where hours were expected, so the band was in the wrong place. It is now a brightness map sampled per pixel.

**Sky mode never dead-ends on missing location**: `sensors.js::geolocate()` used to throw all the way up to `startSky()` on any geolocation failure (denied, timed out, unsupported), leaving the gate stuck on an error message with no in-app way forward — a toddler (or anyone) can't go fix a Settings permission themselves, so that was a real hard stop, not a recoverable retry. `geolocate()` now never throws: on any failure it falls back to a fixed approximate default location (`DEFAULT_LAT`/`DEFAULT_LON`, `sensorState.usingDefaultLocation = true`) so the sky view always renders — positions are just for that default location instead of the user's real one. `sky.js::startSky()` shows a one-time `#sky-toast` note ("Not sure exactly where you are…") when this fallback kicks in, instead of a dead-end error.

## Third pass: catching mechanic, star facts, real events, Sun/Moon badges

- **Edge-arrow direction bug (fixed)**: the off-screen "turn this way" arrows were pointing (and positioning themselves) on the wrong side whenever the target had any up/down offset — `sky.js::project()`'s arrow-angle math used `Math.atan2(-dAlt, dAz)`, but the `(ax,ay)` parametric-circle formula right below it (`x=cx+cos·r, y=cy-sin·r`) already expects an up-positive math angle to match how `dAlt` itself is defined (`y=cy-dAlt·pxPerDeg` for the main placement). Negating `dAlt` flipped the vertical axis, so an arrow for a target above you pointed at the BOTTOM of the screen and vice versa. Fixed to `Math.atan2(dAlt, dAz)`; verified with a standalone script confirming "target above" now resolves to the top of the screen.
- **"Point and hold" catching** (`sky.js::updateLock()`): the reticle is now a real target, not decoration — if a visible body or star stays within `LOCK_RADIUS_PX` (42px) of the reticle (now exactly the projection centre — it used to sit at 44% height) for `LOCK_MS` (1.6s), it's caught automatically, exactly like a tap. Feedback is just the center dot growing (`--reticle-dot` scaled inline each frame by dwell progress) and the ring brightening (`.reticle.locking`) — no separate progress-ring markup needed. A `LOCK_COOLDOWN_MS` (4s) per-id guard stops it from re-firing every frame while still held. This matters for a toddler holding a phone one-handed: tapping a small moving marker while also aiming is hard; holding still over the glowing target is not.
- **Star facts**: `data/stars.json` now carries a real, single-breath `fact` for the ~20 always-labeled bright stars plus Polaris (23 total) — e.g. Sirius "The brightest star in the whole night sky", Betelgeuse "A giant red star so big it could swallow Mars' whole orbit". `sky.js::catchBody()` was refactored to take the full entity object (body or star) instead of a bare id/name pair, so it can speak `entity.fact` for stars too, not just Sun/Moon/planets — previously stars only ever got the generic "That's Sirius!" fallback regardless of any fact data.
- **Real "what's coming up" events** (`modules/astro.js` + `modules/events.js`): the next Full Moon (`SearchMoonQuarter`/`NextMoonQuarter`, looped to the quarter===2 event), the next visible lunar/solar eclipse (`SearchLunarEclipse`/`SearchLocalSolarEclipse` from the vendored engine, each checked for real local visibility via `Horizon()` at peak time), and the next real conjunction — a day-by-day scan (45 days) of angular separation between Moon/Mercury/Venus/Mars/Jupiter/Saturn via `Equator()`, reporting the closest pairing under 5°. `events.js::nextEventHeadline()` picks whichever is soonest and turns it into one spoken-friendly line, shown under the Sky screen's title (`#sky-event-note`) computed once when `startSky()` succeeds (deferred via `setTimeout(...,0)` so the day-by-day scan never blocks the transition into the sky view). Every date here is a real search result — nothing is hardcoded or fabricated, consistent with the rest of this app.
- **Sun/Moon are now badges too**: badges expanded from 8 planets to `[SUN, ...PLANETS, MOON]` (10 total) — see the Badges section above for the `isBadgeBody()` API this introduced.
- **Horizon/radar-sweep graphic** (removed): a decorative ground dome fixed to the bottom of the screen. It stayed put when you pointed up, which contradicted the sky; replaced by a real projected skyline.

## Sky-mode performance, first round (DOM-marker era — superseded)

The DOM markers are gone (everything is canvas now), but the method stands:
**measure per-frame work, never frame rate** — desktop FPS hid the problem
entirely. The big win then was removing a forced synchronous layout per marker
per frame (reading `offsetWidth` right after writing a transform: 13.5× the
cost). Also still true: `.bottom-nav` has no `backdrop-filter` (it would
re-blur the constantly repainting sky every frame).

## Sky mode: instant start, and the second performance pass

**"It takes ages to show the stars" was not a rendering problem at all** —
`startSky()` did `await geolocate()` *before* revealing the sky. With a slow
indoor fix that's an 8s timeout, a 1.5s pause, then another 8s (and it was 15s
each before), so the user could sit on "Finding you… hold on a moment" for up to
half a minute before one star appeared. Reproduced here: the sky view failed to
appear within a 30s probe. Now:

- `sensors.js::primeLocation()` synchronously supplies the **last real fix**
  (persisted to `localStorage` under `skyclub.lastFix`) or the default, so the
  sky renders on the next frame — **measured 5.3ms from tap to visible**.
- `geolocate()` still runs, but in the background via `sky.js::refineLocation()`,
  which forces an immediate recompute only if the true position turns out to be
  meaningfully different (>0.01°).
- `useDefaultLocation()` now **refuses to downgrade a location we already
  trust**. It used to overwrite a good remembered fix with the generic default
  whenever a background refresh timed out — which would silently move the user's
  sky to another country. (Caught in testing: a seeded location kept getting
  replaced by the default.)

**Resting on a star now names it.** Only stars at `mag <= NAMED_STAR_MAG` carry
a permanent label (otherwise the sky becomes a wall of text), so dwelling on an
ordinary star used to highlight it while leaving you with no idea what it was.
`updateLock()` finds whatever named star or body is nearest the reticle and
`drawLabels()` writes its name there, highlighted, even for a star with no
permanent label.

**Removed the pulsing up-arrow above the reticle** (was `.sky-arrow-hint`, from
the build-prompt spec). It always pointed straight up regardless of where
anything actually was, so it read as an instruction with no meaning. The
per-body edge arrows (`.sky-arrow`) are the real "turn this way" cue and do
point at something.

## Explore: clean view + year scrubber

- **Clean view** (`#clean-btn` → `.clean-view` on `<body>`): hides **all UI** —
  topbar, bottom nav, scrubber, controls, screen title — and leaves the scene
  (starfield, nebulae, orbit lines, Sun, planets) completely untouched. Starts
  playback if paused; the point of the mode is watching the planets go round.
  - The class goes on `<body>`, not `#explore-screen`, because `.topbar` and
    `.bottom-nav` are siblings of `#screens`, not children of the screen.
  - **This was built backwards first time round**: the initial version hid the
    *scenery* and kept the controls. The ask was the opposite — "don't wanna see
    any buttons, numbers, sliders", background is fine. Worth remembering that
    "clean" here means chrome-free, not decoration-free.
  - Exit is **tap anywhere**, since by definition there's no visible button
    left. `.body-btn` gets `pointer-events: none` while clean so tapping a
    planet exits instead of opening a card whose close button is also hidden.
    The exit listener is attached on the *next tick* — attach it synchronously
    and the very click that enabled clean view bubbles straight into it and
    turns it back off.
  - `#clean-hint` shows "Tap anywhere to bring the buttons back" for ~2.6s on
    entry, then fades itself. Without it there is no affordance at all and the
    mode is a trap.
  - `.screen-header` needs `opacity: 0 !important`. It runs the `rise` entry
    animation with `animation-fill-mode: both`, and **animation values outrank
    normal declarations in the cascade**, so a plain `opacity: 0` silently loses
    to the animation's final `opacity: 1` and the title stays on screen. An
    important declaration is the one thing that beats an animation.
- **Year scrubber** (`#year-slider`, ±50 years): the slider's value is an offset
  in *years from app launch* (`BASE_MS`), which keeps date↔slider trivially
  invertible with no calendar-month arithmetic. `step 0.01yr` ≈ 3.7 days, fine
  enough that even Mercury glides instead of jumping. Dragging pauses playback,
  otherwise the rAF tick rewrites the date underneath the gesture and the thumb
  fights the user.
  - `syncYearScrubber()` keeps it in step with Play / Today / the date picker.
    The `scrubbing` guard suppresses **only the thumb position** (writing
    `.value` mid-drag makes it stutter) — the year readout must keep updating,
    since that's the entire point of dragging it. Getting this guard too broad
    was a real bug: the planets moved but the year stayed frozen at 2026.
  - Sanity check that this is driven by real ephemeris, not a fake sweep: at
    whole-year offsets Earth sits at essentially the same angle (it has returned
    to the same ecliptic longitude), while Neptune swept ~66° over 30 years —
    which is 30/165 of its real orbit.
  - Scoped to Explore only. The Sky tab deliberately still tracks live "now";
    letting the scrubber drive it would mean re-deriving star/Milky Way
    positions per frame against a scrubbed clock.

## Design-polish pass (realistic Moon/stars, detail sheets, one control dock)

Built from a design canvas ("Sky Club Polish"), matched to the tokens already in
`app.css` rather than a new look.

- **The Moon is the headline.** `moonphase.js` keeps the real terminator geometry
  exactly as it was and adds the three things that separate a photographed moon
  from a disc with a bite out of it: a **soft terminator** (a blurred alpha mask
  — a hard cut is the single biggest tell), **limb darkening**, and **earthshine**
  on a blue-tinted base, because the night side is lit by light bounced off Earth
  and Earth is blue — but FAINT (texture at 8.5%): at the original 20% the dark
  side showed its maria so clearly that a 6% crescent read as a full grey Moon.
  The mask is cached per `(size, phase)` — it only changes when
  the phase does, not on every frame of the cosmetic surface spin, which matters
  because that spin runs in a rAF loop.
- **`describePhase()`** names the phase for the chip. The four "exact" phases get
  narrow windows and crescent/gibbous cover the long stretches — nearest-of-eight
  bucketing produced *"First quarter · 62% lit"*, which is a contradiction (a
  quarter moon is 50% lit by definition).
- **Detail card is now hero-above-sheet.** The body floats in the sky at ~208px
  instead of sitting in the sheet as a 100px thumbnail; at that size the texture,
  terminator and Saturn's ring are actually legible. `.card-hero` + `.card-phase`
  chip + `.card-stats`.
- **Stat strip is real data only.** The Moon's distance is live from
  `astro.js::moonDistanceKm()` (`Libration().dist_km` — it genuinely swings
  ~50,000 km a month); planets carry `diameter`/`dayLength` in `catalog.js`.
  Deliberately **no moon counts** — those figures keep being revised. A body with
  no facts shows no strip (`.card-stats:empty`).
- **Stars got a sheet at all.** Tapping a star used to only speak. `openStarCard()`
  (exported from `orbits.js`, which owns the card DOM) shows a point-source render
  — core, chromatic halo, diffraction spikes in the star's real catalogue tint —
  plus constellation, brightness as a *word* (the magnitude scale is backwards to
  everyone and meaningless to a pre-reader), colour, and distance. Real
  light-year distances added to `data/stars.json` for the 23 named stars; stars
  without one omit the row rather than guess.
  - Tapping a body in **Sky** mode now opens the same sheet too. Dwelling still
    only speaks — throwing a full-screen sheet up every time the reticle rests on
    something while you pan would be unusable.
  - `.card-stat-val` must **wrap, not `nowrap`**: "548 light-years" and
    "400,904 km" both overrun a third of a 375px screen, and an ellipsised number
    is worthless. Watch for U+2011 NON-BREAKING hyphens in these strings — one in
    "Orange‑red" silently defeated the wrap.
- **Shooting stars are properly random.** `starfield.js` re-rolls entry edge,
  position, angle, speed, trail length, width, brightness and lifetime for every
  meteor, and the gap between them (5–21s). The old one always started top-left
  and always travelled down-right, so after a minute it read as one looping streak.
- **Controls.** `.ctrl-btn` went 38px → **52px**: 38 is under the 44px floor, on an
  app a three-year-old drives with a whole fingertip. Everything gained a real
  pressed state (a touch control that doesn't move under a finger reads as
  broken), and primaries are raised (gradient + lift shadow + inner highlight)
  rather than flat outlines.
- **`.explore-dock` replaced `.explore-scrub` + `.explore-controls`.** Those were
  two separately-positioned floating pills, and growing the buttons to 52px made
  them **collide** — the scrubber sat at `bottom: 144px` while the controls now
  reached 150. One container with two `.dock-row`s fixes it structurally instead
  of by re-tuning two magic offsets against each other. "Today" became an icon
  button to give the date field back some width.

## Original two-mode structure (Explore / Sky)

- **Explore** — SUPERSEDED by the 3-D section at the top of this file. Historical notes on the original (`modules/orbits.js`): a 2D/CSS orrery — Sun in the center, planets on rings built from nested divs (outer div rotates the orbit, an inner counter-rotating div keeps the planet upright — see the comment block at the top of the file for why the counter-rotation has to sit on a small edge-positioned element, not a full-ring-sized one, or the translation cancels out along with the orientation). Tapping a body opens a full-screen card with a spinning-globe effect (a 200%-wide texture strip, `background-size: 50% 100%`, animated with `translateX(-50%)` — an exact, seamless loop with no baked-in image width needed) plus a spoken name + one-sentence fact. Deliberately **no WebGL/Three.js** — matches the no-build-step ethos and keeps it light and reliable in a toddler's hands.
  - **Positions are real, not decorative**: each planet's angle is its actual heliocentric ecliptic longitude on the selected date, via `astro.js::planetLongitudes()` (`EclipticLongitude()` from the vendored astronomy-engine). `catalog.js`'s `orbitPx`/`sizePx` are sqrt-scaled from real AU distance / km diameter — compressed to fit a phone screen, but the *relative* spacing and sizing now tracks reality instead of being arbitrary.
  - **Date / Play / Today / Zoom controls** (`.explore-controls`): the date `<input>` jumps straight to a date (pauses play, eases into place over 0.6s via the `.orrery:not(.playing)` CSS transition); Play advances `currentDate` by `DAYS_PER_SEC` simulated days per real second in a plain rAF loop (no easing, since every frame already sets a fresh transform); Today snaps back to `new Date()`. Zoom buttons and two-finger pinch (`wirePinchZoom()`) both multiply into the same `zoom` value, applied on top of `fitScale` — `computeFit()` still exists as the small-screen safety net (iPhone SE), now just the base layer zoom multiplies against.
  - **Background**: `modules/starfield.js` draws twinkling stars + an occasional shooting star on a canvas behind the orrery; the `.galaxy` blobs (blurred, screen-blended radial gradients, slow CSS drift) are pure CSS, no JS, since a blurred gradient div is free to composite. A handful of the background stars (`flareCount` in `resize()`) get a bigger disc plus a drawn cross-sparkle in `drawStars()` — real astrophotography reads as "real" partly *because* a few hero stars have that lens-flare sparkle, not just more/smaller dots.
  - **Sun flare** (`.body-btn.sun-btn::before` for the orrery, `.planet-card.is-sun .spin-wrap::before` for the card): a thin cross-shaped double linear-gradient behind the Sun's texture (pseudo-elements paint before real children, so it sits behind, not on top). Keep this SUBTLE — the first version (210%+ wide bars at 0.55 opacity) visually swallowed neighboring planets and looked like a giant plus-sign; current values are a deliberately thin band (`48.7%→49.85%→50.15%→51.3%` gradient stops) at ~0.4 opacity. If this is ever revisited, nudge those percentages closer together rather than widening the box — a bigger box scales the whole bar, not just its reach.
  - **Non-overlapping, distance-ordered spacing**: `catalog.js::computeOrbitRadii()` derives each planet's `orbitPx` from the previous body's outer edge + a fixed `ORBIT_GAP`, not from a pure sqrt(AU) scale — a pure distance scale bunches the four inner planets close enough that their circles overlap the Sun and each other on a phone screen. Saturn gets an extra `RING_PAD` so its rendered ring never touches a neighbor. This only works because `.body-btn`'s *visual* size is the true `sizePx` (small planets stay small) — the 44px touch-target floor is a separate invisible `::after` (`inset: calc(-1 * max(0px, (44px - var(--size-px)) / 2))`), not a min-width/min-height on the visible circle. Restoring a `min-width` on `.body-btn` itself will silently blow the no-overlap guarantee for every planet smaller than 44px (Mercury/Venus/Earth/Mars).
  - **Day/night sphere shading** (`.sphere-vignette` + `.sphere-shade`): a flat circle with `background-size: cover` doesn't read as a lit 3D sphere on its own. `.sphere-vignette` is a static all-around rim darkening (roundness cue, no rotation needed). `.sphere-shade` is the actual terminator + sunward highlight, defined in LOCAL space with "toward the Sun" = local +y — orbits.js rotates it by the planet's own orbital angle every time `applyDate()` runs (same angle as `.orbit-spin`, since it lives inside the counter-rotated/upright `body-btn` and needs that upright-ness undone to face the Sun correctly). Getting the sign wrong here means every planet's shadow points the same fixed screen direction instead of tracking its actual position around the Sun.
  - **Orbit-line centering**: `.orbit-counter`'s transform is `translate(-50%, -50%) rotate(...)`, not `(-50%, 0)`. The counter's anchor (`top:0; left:50%`) pins its top-left corner to the ring's edge point — only a *full* `-50%` vertical shift moves the box's own *center* onto that point; `0` leaves the center sitting half the box's height below the ring line, so every planet reads as merely touching its orbit instead of riding on it.
  - **Self-rotation**: each orrery planet is a clipped `.planet-frame` containing a `.planet-texture` that scrolls with the exact same seamless trick as the card's `#spin-texture` (200%-wide strip, `background-size: 50% 100%`, `translateX(-50%)` loop) — `spinSec`/`reverse` per planet live in `catalog.js` (Venus and Uranus spin backwards, matching reality). `body-btn` itself can't get `overflow:hidden` for this clipping, because the Saturn ring and Earth's mini-moon are its *other* children and need to render outside the circle — hence the separate `.planet-frame` wrapper. Pauses via `.orrery:not(.playing) .planet-texture` alongside the orbital motion. `spinSec` is deliberately slow (10–34s per full turn) — anything faster reads as a toy spinning top instead of a planet turning; this was a real complaint, tune it up rather than down if it ever needs to change.
  - **Saturn's ring** (`.ring-layer`/`.ring-back`/`.ring-front`, built by `addRing()`): `icons/textures/saturn-ring.png` is a **generated** elliptical ring image, not the original download — the stock `2k_saturn_ring_alpha.png` from solarsystemscope is a 1D radial density *strip* (800×48px, meant to be wrapped around a 3D ring mesh in a real renderer), and displaying that strip directly is exactly why the ring used to render as a flat diagonal bar. It was regenerated by sampling that strip radially onto a proper flattened ellipse (see git history / regenerate by mapping strip pixel at fraction `(t − t_inner)/(1 − t_inner)` onto each pixel's elliptical radius `t = sqrt((dx/outer_rx)² + (dy/outer_ry)²)`, inner/outer ellipses sharing the same aspect ratio). To actually look like it wraps AROUND the sphere rather than sitting on top, it's split into two layers with the same `clip-path: inset()` trick used elsewhere: `ring-back` is inserted BEFORE `.planet-frame` in the DOM (so the opaque planet naturally occludes the far half), `ring-front` is appended after everything (on top, for the near half). `.ring-layer`'s `width:288%; height:102%` is sized to match the *generated* PNG's own aspect ratio (480:170) and is reused as-is for both the orrery icon and the card (percentage-relative to whatever box it's in) — `catalog.js`'s `RING_PAD` has to account for this real extent (0.94× the planet's own size beyond its edge) or Saturn's ring visually overlaps its orbit neighbors.
  - **Planet card polish**: the card reuses `.sphere-vignette`/`.sphere-shade`, but `.sphere-shade` gets a fixed `rotate(90deg)` (`.card-shade`) instead of a per-frame orbit angle — there's no orbital context in a full-screen close-up, so it's a static "light from the left" like the reference photo's Sun-on-the-left framing. Hidden for the Sun (self-luminous) and the Moon (has its own phase graphic instead).
  - **Moon phase** (`modules/moonphase.js`): the Moon's card shows a real phase — a canvas draws the actual limb (fixed semicircle, waxing=right/waning=left) and terminator (an ellipse with horizontal radius `r·cos(phaseAngle)`, from `astro.js::moonPhase()`/`MoonPhase()`), then clips the real moon texture into that lune instead of using a flat gradient. One sign rule covers all four quarters: the terminator bulges the *same* side as the limb when `cos(phaseAngle) ≥ 0` (crescents), the *opposite* side when negative (gibbous) — verified by rendering the full 0–360° range in 45° steps and eyeballing new/crescent/quarter/gibbous/full in order. `drawMoonPhase(canvas, phaseDeg, rotationDeg)` also takes a cosmetic rotation: `orbits.js::startMoonSpin()` redraws it every frame (rAF, only while the Moon's card is open) with `rotationDeg` slowly advancing, sampling the texture with a manual two-`drawImage` wrap (canvas has no `background-position` to lean on). This is a deliberate accuracy trade — the real Moon is tidally locked and doesn't visibly turn from Earth, but a frozen card read as static/dead on screen, which was a real complaint; the phase OUTLINE stays scientifically correct for the date either way, only the surface drifting under it is decorative. There's also a faint whole-disc "earthshine" pass (texture at ~16% alpha) so the dark side isn't a flat void, and `.moon-phase-canvas` gets a tiny CSS `blur(0.6px)` so the algorithmically-sharp terminator/limb edges don't read as a vector cutout.

- **Sky** (`modules/sky.js`): see the architecture section at the top of this file.

**Virtual sky, not camera passthrough** — chosen over real AR camera overlay for reliability, battery, and glare reasons; this is how most kid-facing sky apps (Star Walk Kids, SkyView) actually work despite feeling like AR.

**Star catalog**: see "Data" in the architecture section. `data/stars.json` is now a build input (facts, kid names, distances), not fetched by the app.

**iOS sensor permission**: `DeviceOrientationEvent.requestPermission()` is called in exactly one place (`sensors.js::requestOrientationPermission()`), triggered by the "🔭 Look at the Sky" tap — same pattern as the root app's G-meter and `flight-card-pwa`. iOS remembers "granted" per-origin, so it only prompts once ever. That same tap is also the only allowed call site for `requestOrientationPermission()` inside `startSky()` — it has to run synchronously before any `await`, or the permission request silently loses the user-gesture context on iOS.

**Textures**: solarsystemscope.com's free CC-BY 2K planet textures, downloaded once and re-encoded small (resized + recompressed to ~2–55 KB each in `icons/textures/`) — full offline set is under 300 KB total, cached by the service worker like everything else.

No worker, no key, no account — fully local like `xcsky-pwa`/`debrief-pwa`.
