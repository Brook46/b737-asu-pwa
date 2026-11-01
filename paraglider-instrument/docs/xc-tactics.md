# XC tactics: what the instrument advises, and why

The instrument is for **cross-country flying**: long flights first, with
competition-style racing when a task is loaded. This page records the theory
it follows (English and French sources, plus the sailplane literature it
comes from), how each rule became code, and what the simulator showed.

## The theory, in short

**MacCready.** Set MC to the climb you expect in the next thermal. Then:

- take climbs better than MC;
- leave a thermal when its climb drops below MC;
- glide at the MacCready speed: faster in sink and into a headwind, slower in
  lift.

In French: *calage MacCready*, *vitesse à afficher*. In German: *Sollfahrt*.
John Cochrane's work makes the key point: when you stop and when you leave
matter far more to cross-country speed than the exact glide speed. Gliding at
an MC a knot off costs little. Taking climbs a knot too weak, or insisting on
climbs a knot too strong, costs a lot. ([Cochrane, *Flying Faster*][cochrane-ff];
[Cochrane, *MacCready theory with uncertain lift and limited altitude*][cochrane-ul])

**Set MC low, and lower still when low.**

- A common rule: think of the weakest thermal you'd stop for, halve it, and
  set that ([XC Magazine, *speed to fly and other myths*][xcmag-myths]).
- A UK paragliding competition guide puts it at the average climb of the
  whole thermal, "about half the perceived climb", and says anything within
  25 % of ideal is competitive ([search summary][comp-guide]).
- Cochrane's uncertain-lift paper: the MC that matters is the *expected
  value* of the next climb. That falls as you get lower and as glides come up
  empty, so MC should be turned down as you descend ([Cochrane][cochrane-ul]).
- In the working height band, pilots cruise at about ⅔ of the expected MC
  ([summary][comp-guide]).

**Cross-country distance vs racing.**

- The Swiss League's competition notes (in French) draw the line: in a race
  only crossing the line fast counts, while in cross-country the goal is to
  secure the climbs to cloud base and go as far as possible. Leaving at the
  right moment matters in both ([Swiss League notes][ch-notes]).
- Tom Payne's competition talk (also French notes) on the speed bar: keep the
  bar on as you arrive in lift, release it in the core, push it again on the
  way out. And stay ahead of collapses: the bar makes the wing more sensitive
  to turbulence ([Swiss League, Payne talk][fr-notes]).

**The speed bar on a paraglider.**

- Hands-up trim is best glide in still air. The bar costs glide ratio and
  adds roughly 10–15 km/h on most production wings.
- Use it into a headwind, in sink, and for fast transitions, progressively:
  trim in no or light wind, more bar as the headwind grows past about 10 km/h
  ([Flybubble][flybubble]; [Paragliding SF][pgsf]; [XC Magazine][xcmag-bar];
  French wing manuals: *L'utilisation de l'accélérateur … dégrade la
  finesse*, *rend l'aile plus sensible aux turbulences*).
- Experienced pilots: quarter bar out of a thermal and up from there; the bar
  also manages pitch ([CPCL tips][cpcl]).

## How it became code (`lib/core/src/xc.*`, `advisor.*`, `thermal_model.*`)

| Rule | Implementation |
|---|---|
| Where to glide | Live thermals (FANET) > KK7 history × today's sun > sun-on-terrain sources, each placed at its column at your arrival height |
| MC = what you expect, set low | Auto-MC = 0.8 × the mean of your last three thermals; XC flies **0.75 ×** that |
| Lower MC when low (uncertain lift, limited altitude) | Working band from 300 m AGL to cloud base (or your best top so far). MC × (0.25 + 0.75 × position in the band): near the floor you take anything and glide at best L/D |
| Thermals die late in the day | XC: MC × 0.7 in the last 1.5 h before sunset |
| Race (task with a start, after the start) | MC × (0.5 + 0.5 × band): full MC high, half near the floor |
| Leave when the climb < MC | The existing GLIDE logic (last circle below 0.75 × MC for 15 s), now on the effective MC |
| Leave at the top | GLIDE "at cloud base" within 120 m of a cloud base measured in thermal air |
| Leave for something better | GLIDE "better lift nearby" when another pilot (FANET) is climbing ≥ 0.7 m/s better somewhere you can reach with 300 m |
| Final glide | Height to goal leg by leg at the current MC, with the profile's winds, plus 150 m over goal. FINAL GLIDE as soon as it's made; racing leaves the thermal at once |
| Speed to fly | MacCready speed for the air you're in (netto, 3 s average) and the headwind on course (to the next turnpoint, or your heading) |
| Bar | (STF − trim) / (full − trim), in quarters. **None** while circling or below 150 m AGL, **≤ ½** below 350 m AGL, **≤ ¼** in turbulence (vertical acceleration RMS > 2.2 m/s²) |

Constants are in `XcConfig` (trim speed, band floor, factors). Set
`trimSpeed` and the polar to your own wing.

## Where the next climb is (`sun.*`)

With a terrain grid and the clock, the instrument works out where thermals
start today, without a KK7 pack (and weights a pack's history by it):

- **Where the sun is:** the real solar position for the date, time and place.
- **Sun on each slope:** the angle between the sun and the slope. A ridge
  between a cell and the sun casts shade. Water barely heats.
- **Heating lags:** ground and air take about 45 minutes to respond, so the
  morning's east faces stay warm into midday, and west faces take over in the
  afternoon.
- **Triggers:** strong heating, hotter than the surroundings, helped by
  prominence (spurs and edges release the warm air). In wind, the warm air is
  pushed up to the crest downwind, which becomes the release point. Wind over
  ~20 km/h weakens thermals, and over ~45 km/h breaks them up.
- **Drift with height:** a thermal leaves its trigger and rises (a bubble
  rises at about 0.6 × its core updraft) while drifting with the wind in each
  layer, measured as you fly (the profile). At your arrival height it is
  downwind by wind × height ÷ rise speed. The glide target is that column,
  not the trigger, and the same applies to another pilot's climb at a
  different height.

In the simulator, which has rising, drifting bubbles over the real Gilboa
terrain and the true wind, every thermal that had lift at the pilot's height
was compared with the prediction for its own trigger:

| Wind | Distance from the predicted column | Distance from its trigger |
|---|---|---|
| 7 km/h | 578 m | 1109 m |
| 14 km/h | 1293 m | 2274 m |
| 25 km/h | 2278 m | 5288 m |

The prediction roughly halves the miss. What's left is the uncertainty of
when the bubble left the ground: a stream of bubbles spreads along the wind.
So expect to search downwind of the predicted point rather than upwind.
Limits: the terrain grid doesn't know what covers the ground (rock, fields,
forest, towns), nor cloud shadow.

## Turning in the thermal (`thermal_model.*`)

While circling, every vario sample is placed where it was flown in the
**air-mass frame**: gyro heading × airspeed, no GPS needed. The thermal
drifts with the wind, so in this frame it stands still. The air's own vertical
speed (netto, with the sink of your current bank) is fitted with a round
thermal: core position, 1/e radius R, strength W, and the air around it.

- **MOVE** (one long tone): your circle is off the core. When you hear it,
  straighten. The tone sounds as your heading points at the core. Hold for
  the time shown (distance ÷ airspeed); a double blip says "turn again".
- **TIGHTEN / WIDEN** (two up-chirps / two down-chirps): you're centred, but
  a steeper or flatter circle climbs better. The trade-off is the lift nearer
  the core against the extra sink of a steeper bank (polar sink ÷ cos^1.5 of
  the bank angle). The screen shows the bank now → best.
- It stays **silent when the data can't tell**: a steady centred circle can't
  distinguish a narrow strong core from a wide weak one. It also waits for a
  settled fit (two refits agreeing within 12 m) and a full circle after any
  straightening.

Why not temperature and humidity around the circle? The BME280 sits inside
the case and lags by tens of seconds, far slower than a 20 s circle. A
sensor on the remote (docs/hardware.md) reacts in seconds and is used for
cloud base and stability as soon as it's fitted; using it to map the core
around the circle is a possible next step. It does
feed the **profile** (temperature, dew point, wind and climb for every 100 m),
which gives glide arrival heights with the winds below you and the PROFILE
page.

Other pilots (FANET tracking) inside 400 m of you feed their climbs into the
same fit, and a pilot turning and climbing anywhere marks a **live thermal**:
a glide target ranked above any historical map.

## What the simulator showed

Thermals in the simulator are round Gaussians drifting with the wind. Over 8
simulated days, 30 minutes each, starting 450 m over the Gilboa:

| In thermals the pilot… | Height after 30 min | Landings | Distance from the true core |
|---|---|---|---|
| circles steadily, ignores the advice | 549 m (mean) | 10 | 92 m |
| **follows MOVE / TIGHTEN / WIDEN** | **938 m** | **4** | **64 m** |
| feels the core perfectly (cheat) | ~1550 m | 1 | 51 m |

The fit finds the true core to within 10–25 m. Following the advice gains a
lot over flying blind, but doesn't match a pilot who feels every surge.
Treat it as an assistant, not an autopilot. Real thermals are rarely round,
so expect less in the air than in the simulator.

[cochrane-ff]: https://www.johnhcochrane.com/s/FlyingFaster2.pdf
[cochrane-ul]: https://ts.journals.publicknowledgeproject.org/index.php/ts/article/view/385
[xcmag-myths]: https://xcmag.com/news/getting-up-to-speed/
[xcmag-bar]: https://xcmag.com/news/speed-bar-tips/
[flybubble]: https://flybubble.com/blog/speed-to-fly-basics
[pgsf]: https://www.paraglidingsanfrancisco.com/speed-to-fly
[cpcl]: https://groups.google.com/g/cpcl/c/kkK_GcCaRic
[comp-guide]: https://pngc.co.uk/wp-content/uploads/2024/03/Comp_Training_Flying_Faster_4.pdf
[ch-notes]: https://www.swissleague.ch/files/news/11.docx.pdf
[fr-notes]: https://www.swissleague.ch/files/v210104074243/news/12.pdf

The PNGC guide and the two Swiss League documents were read through search
results only; their pages couldn't be opened from the build environment.
