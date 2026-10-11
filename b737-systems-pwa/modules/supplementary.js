// supplementary.js — FCOM Supplementary Procedures, as a study aid: each
// chapter condensed to its actions, limits and warnings, in our own words,
// with the SP section cited on every topic. Figures (temperatures, altitudes,
// % N1, times) are the FCOM's; the full procedure is in the FCOM and governs.
//
// Line kinds: a plain string is a step or fact; ['!', text] is a WARNING
// (red); ['?', text] is a CAUTION (amber). **bold** marks the key words.

export const SUPPLEMENTARY = [
  { n: 16, t: 'Adverse Weather', topics: [
    { t: 'Wet or contaminated runway takeoff', ref: 'SP.16.1', pts: [
      'Wet runway: reduced thrust allowed (fixed derate, assumed temperature, or both), with the longer stopping distance on wet surface accounted for.',
      'Slush, snow, standing water or ice: fixed derate only — **no assumed temperature** reduction, alone or combined.',
      'V1 may be reduced to minimum V1 for more stopping margin, if the continued-takeoff field length and obstacle clearance still meet the rules (may need real-time performance tools or dispatch data).',
      ['!', 'Takeoff not recommended with slush, wet snow or standing water deeper than 13 mm (½ in), or dry snow deeper than 102 mm (4 in).']]},
    { t: 'Icing conditions', ref: 'SP.16.2', pts: [
      '**Icing:** OAT on the ground or TAT in flight is **10 °C or below**, and either visible moisture (cloud, fog ≤ 1 SM / 1600 m, rain, snow, sleet, ice crystals) or ice, snow, slush or standing water on the ramps, taxiways or runways.',
      ['!', 'Do not use engine or wing anti-ice when OAT (ground) or TAT (flight) is **above 10 °C**.'],
      'Exterior inspection: LE devices, control surfaces, tabs, upper wing, winglets and balance-panel cavities must be free of snow, ice and frost. Light frost (≤ 3 mm) on the lower wing from cold fuel is allowed for takeoff. Thin hoarfrost on the fuselage top is allowed with vents and ports clear.',
      'Check drainage after snow removal; check pitot probes and static ports are clear of snow and ice (refreezing run-off can disturb static readings even when the ports look clear).',
      'Check the outflow valve, air inlets and exits, and engine inlets (fan free to rotate); APU inlet door and cooling air inlet clear before APU start.',
      'Preflight (first officer): PROBE HEAT ON, all probe heat lights out.']},
    { t: 'Cold soak and engine start', ref: 'SP.16.4', pts: [
      ['!', 'Cold soaked **1 h or more** below **−40 °C**: do not start or motor the engine (maintenance heats the hydro-mechanical unit first).'],
      ['!', 'Cold soaked **3 h or more** below **−40 °C**: do not start or motor; maintenance services the starter.'],
      'Ambient below **−35 °C**: idle the engine for **2 minutes** before moving the thrust levers.',
      'Oil pressure can exceed its range until warm. If OIL FILTER BYPASS lights, stay at idle until pressure returns to range. If it stays high after oil temperature stabilises, shut the engine down.',
      'Displays need extra warm-up and may look dim; indications lag.']},
    { t: 'Engine anti-ice on the ground', ref: 'SP.16.5', pts: [
      'ON immediately after both engines start, and throughout ground operations when icing exists or is expected. Use temperature and visible moisture, not airframe icing cues — late selection risks ingesting ice.',
      ['!', 'Not above **10 °C** OAT.'],
      'ENGINE ANTI-ICE switches **ON** (F/O). COWL VALVE OPEN lights come on bright, then dim; COWL ANTI-ICE lights out.',
      'If COWL VALVE OPEN stays bright at idle: APU BLEED OFF, ISOLATION VALVE AUTO, and advance thrust slightly (up to 30 % N1).',
      'Off when no longer needed: switches OFF; COWL VALVE OPEN lights bright, then out.']},
    { t: 'Wing anti-ice on the ground', ref: 'SP.16.5', pts: [
      'Use between engine start and takeoff when icing exists or is expected, unless a Type II or IV fluid protects the airplane under an approved de-icing programme.',
      ['!', 'Wing anti-ice is not a substitute for de-icing. Confirm no frost, snow or ice on the wing, LE devices, stabiliser, controls or other critical surfaces before takeoff.'],
      ['!', 'Not above **10 °C** OAT.',],
      'WING ANTI-ICE switch **ON** (F/O): L and R VALVE OPEN lights bright then dim (they can cycle with thrust and duct temperature).']},
    { t: 'Before taxi and flight controls', ref: 'SP.16.6', pts: [
      'Generators ON; the IDGs can take up to **5 minutes** to give steady power in cold oil.',
      'Snow or ice on the wing: consider delaying the flight controls and flaps check until de-icing or anti-icing is done.',
      'Flight controls: expect higher forces when cold. Watch the flap position indicator and LE devices annunciator for movement; if flaps stop, put the lever in the position shown.',
      'Flaps: move from UP to 40 and back to UP (full travel) when snow, freezing rain or cold could restrict movement.',
      'If the taxi route is through ice, snow, slush or standing water in low temperatures, or precipitation below freezing: taxi out with flaps UP (slush can build up on flaps and LE devices).']},
    { t: 'Taxi-out and engine run-up', ref: 'SP.16.6', pts: [
      ['?', 'Taxi slowly, small nosewheel and rudder inputs, minimum thrust, differential thrust to help turns. Slippery surfaces at speed or in crosswinds can start a skid.'],
      ['?', 'Over deep de-icing or anti-icing fluid, limit thrust to the minimum — ingested fluid can stall or surge the compressor.'],
      'Engine anti-ice needed and OAT **3 °C or below**: run up to a minimum of **70 % N1** for about **30 s**, at intervals no longer than **30 min** (count taxi time since the last run-up if the fan was not de-iced). If the surface or traffic does not allow 70 %, set the highest thrust practical and time it.',
      'Freezing rain, freezing drizzle, freezing fog or heavy snow: run-ups to 70 % N1 for about **1 s**, at intervals no longer than **10 min**, to shed ice.']},
    { t: 'De-icing and anti-icing', ref: 'SP.16.8', pts: [
      'Undiluted fluid can leave residue on the wing through rotation and initial climb: a temporary loss of lift and extra drag. Use the normal rotation rate.',
      'APU: run only if needed (fumes and fluid ingestion can damage it). Set it OFF if not needed.',
      'Before de-icing: call FLAPS UP, flaps UP (keeps ice out of the flap cavities), thrust IDLE, stabiliser set in the green band (wheel handles stowed first), engine and APU BLEED OFF (keeps fumes out of the packs).',
      'After: wait about 1 minute, then engine BLEED ON; check flight controls and flaps again; APU bleed only if needed (smoke risk after de-icing).',
      'Before takeoff: flap lever to takeoff flaps; if flaps were held for slush, standing water, ice or exterior de-icing, extend them now. LE FLAPS EXT must be lit.']},
    { t: 'Takeoff after anti-ice', ref: 'SP.16.10', pts: [
      'When engine anti-ice is needed, the takeoff is preceded by a static run-up.',
      'OAT **3 °C or below**: run up to at least **70 % N1** and confirm stable operation before the takeoff roll. A **30 s** run-up is strongly recommended if possible.',
      'OAT above 3 °C: run up to at least 70 % N1 and confirm stable operation before the roll.']},
    { t: 'Engine anti-ice in flight', ref: 'SP.16.10', pts: [
      '**ON** in all icing conditions, and before and during descent in any icing, including below −40 °C SAT.',
      'Exception: during climb and cruise, not needed when SAT is below **−40 °C**.',
      'Activate before entering icing. Do not rely on airframe icing cues — late selection can ingest ice and damage the engine.',
      ['!', 'Not when TAT is above **10 °C**.'],
      'ENGINE ANTI-ICE switches **ON** (PM); check COWL VALVE OPEN bright then dim, COWL ANTI-ICE out. If the valves stay bright at idle: APU BLEED OFF, ISOLATION VALVE AUTO, thrust up to at least 30 % N1.']},
    { t: 'Fan ice removal', ref: 'SP.16.11', pts: [
      ['?', 'Avoid prolonged operation in moderate to severe icing. Change altitude or speed first. If it cannot be avoided, do this on each engine, one at a time.'],
      'ENGINE START switches (both) **FLT**; autothrottle **disengage**.',
      'Increase thrust to at least **80 % N1** for about 1 s to clear the fan blades and spinner. Vibration can peg full scale before shedding; that does no harm.',
      'Reduce thrust as needed for the flight; wait **15 s** for vibration to settle.',
      'Vibration **below 4.0 units** after reducing: repeat about every **15 min** or sooner. Autothrottle engage if needed.',
      ['!', 'Vibration **4.0 units or more** after reducing: do the ENGINE HIGH VIBRATION non-normal checklist.']]},
    { t: 'Wing anti-ice in flight', ref: 'SP.16.12', pts: [
      'Ice on the flight deck window frames, centre windshield post or wiper arm shows structural icing and the need for wing anti-ice.',
      '**Primary method (de-icer):** let ice build, then switch on. Cleanest surface, least runback ice, least thrust and fuel cost. No periodic shedding unless extended icing (such as holding).',
      '**Secondary method (anti-icer):** on before ice builds — only for extended operations in moderate or severe icing, such as holding.',
      ['!', 'Not when TAT is above **10 °C**.'],
      ['?', 'Above about **FL350** wing anti-ice can trip the bleed and possibly lose cabin pressure.'],
      ['!', 'Holding in icing with flaps extended is **prohibited**. Prolonged icing with flaps extended is not recommended.'],
      'WING ANTI-ICE switch **ON** (PM): L and R VALVE OPEN bright then dim. OFF when not needed; then bright then out.']},
    { t: 'Cold temperature altitude corrections', ref: 'SP.16.13–14', pts: [
      'Cold air is denser than ISA: true altitude is lower than indicated. Errors grow near −30 °C surface temperature and with height above the altimeter reference source.',
      '**Correct every published minimum altitude** (departure, en route, approach, missed approach) from the table; advise ATC of the corrections.',
      'MDA / DA: set at the corrected minimum for the approach. Corrections apply to QNH and QFE. Do not correct the altimeter setting itself.',
      '**Height above source** = published minimum − elevation of the altimeter reference source (usually the departure or destination airport).',
      'Enter the table with airport temperature and that height; add the correction to the published minimum (corrected altitude must stay above the published minimum). Above the last column, extrapolate linearly (6,000 ft = twice the 3,000 ft figure).',
      'If the corrected altitude falls between 100 ft steps, set the MCP altitude to the next 100 ft **above** it.',
      'Not needed: under ATC radar vectors; holding an assigned flight level; airport temperature above 0 °C, or at or above the procedure’s minimum published temperature. (Regulators may have their own rules.)'], tab: [0, 1]},
    { t: 'Approach, landing and after landing', ref: 'SP.16.14–15', pts: [
      'Approach and landing: normal procedures and reference speeds.',
      ['?', 'After landing, taxi with the same care as taxi-out: small nosewheel and rudder inputs, minimum thrust, differential thrust for turns.'],
      ['!', 'Over deep fluid: limit thrust to the minimum to avoid compressor stall and surge.'],
      'After prolonged icing with flaps extended, or airframe ice, or a contaminated runway or taxiway: **do not retract flaps below 15** until the flap areas are checked clear.',
      'Engine anti-ice ON on the ground while icing exists (switch steps as in the before-taxi section).',
      'After landing in icing: stabiliser trim set to **5 units** (stops melting snow and ice running into the tail, which can freeze and lock controls).']},
    { t: 'Secure in cold weather', ref: 'SP.16.17–18', pts: [
      'If the airplane is attended and warm air is wanted in the E/E compartments: APU start, APU GEN buses ON, PACK switches AUTO, ISOLATION VALVE OPEN, pressurization mode MAN, outflow valve OPEN (park into the wind — the outflow valve is full open), APU BLEED ON.',
      ['!', 'Do not leave the interior unattended with a pack running and all doors closed — unscheduled pressurization if the outflow valve closes.'],
      'Not attended, or overnight where support is not available: pressurization MAN, outflow valve **CLOSE** (fully closed keeps snow and ice out). Wheel chocks in place; parking brake released (avoids frozen brakes).',
      'Cold-weather maintenance (covers, plugs, drained water and toilets, doors and windows closed) is normally done by maintenance.',
      'Batteries exposed below **−18 °C**: remove and store above −18 °C and below 40 °C; reinstall warm to make sure the APU starts. (Battery count depends on the fleet — see the note in SP.16.18.)']},
    { t: 'Hot weather operation', ref: 'SP.16.19–20', pts: [
      'Electrically powered on the ground with OAT above **40 °C**: run the packs or supply cooling air, to protect the electronics.',
      'Plug in the cooling supply right after engine shutdown; keep it until just before engine start.',
      'Keep doors and windows closed. Turn off electronics not in use. Open the passenger gasper outlets and close shades on the sun side (fleet-specific).',
      'Cabin still hot: PASSENGER CABIN temperature selector **AUTO COOL**, PACK switches **HIGH**.',
      'Ground cooling is weak after start on engine bleed at idle. For extended ground ops: engine BLEED 1 and 2 **OFF**, ISOLATION VALVE **OPEN**, APU BLEED **ON**, PACKS **HIGH**, temperature selectors AUTO COOL. Before takeoff restore: PACKS AUTO, engine BLEED 2 **ON**, APU BLEED OFF, engine BLEED 1 **ON**, ISOLATION VALVE AUTO, temperature selectors as needed.',
      'With only a ground cart for cooling (no APU or external air), the TAT probes are not aspirated: the FMC may not accept an assumed temperature derate until bleed air is available.',
      ['!', 'Brakes overheat easily on short sectors: energy adds up, and fuse plugs can melt and deflate tyres. Extend the gear early for cooling; use the Brake Cooling Schedule in the QRH.'],
      'High temperatures cost performance: work out the penalties before takeoff; consider alternate takeoffs (no-engine-bleed takeoff, improved climb).']},
    { t: 'Moderate to heavy rain, hail or sleet', ref: 'SP.16.20', pts: [
      'Plan around thunderstorms and hail. Avoid flying over a storm that shows visible moisture at high altitude (storms without visible moisture up high can be overflown). Avoid moderate to heavy rain, hail and sleet as far as possible.',
      'If encountered or expected: ENGINE START switches **CONT**; autothrottle **disengage**; move thrust levers **slowly** and do not reverse their direction until the engines settle; hold a slightly higher minimum thrust.',
      'IAS or Mach: use a slower speed — better engine tolerance to heavy precipitation.',
      'Consider starting the APU, if available.']},
    { t: 'Sandy or dusty environment', ref: 'SP.16.21–26', pts: [
      'Hazards: fan erosion, sand on critical surfaces, blockage. Most ingestion happens on takeoff, landing and taxi. Engine deterioration raises fuel burn and cuts EGT margin.',
      ['?', 'After a sandstorm, sweep and inspect runways and taxiways before flight, or engine damage and wear risk rises.'],
      '**Exterior:** clean the windshield (no wipers — wash, then wipe with a soft cloth); wings and controls free of sand; probes, ram air inlets, outflow valve and positive pressure relief valves clear; LE and stabiliser leading edges undamaged; engine inlets clear and fan free; fuel tank vents clear; gear struts and doors clear; APU inlet clear.',
      '**Engine start:** use a filtered ground cart if available; ENGINE START **GRD**, motor the engine **2 min** to clear contaminants (fleet-specific: do not force the start lever on some airplanes).',
      '**Taxi:** APU bleed rather than engine bleed where possible (APU start and 2 min run before bleed). All engines, ground speed **10 kt**, thrust **below 40 % N1** where possible. Greater than normal separation; avoid other aircraft’s wake and unprepared surfaces; in a crosswind during 180° turns, turn away from the wind if possible; avoid full stops and heavy braking.',
      '**Takeoff:** maximum fixed derate or assumed temperature reduction that meets performance; no-engine-bleed takeoff if operations permit; allow dust to settle; do not take off into a cloud; rolling takeoff; consider delaying flap retraction until above the dust cloud.',
      '**Approach:** no-engine-bleed landing if operations permit.',
      '**Landing:** autobrakes to reduce reverse thrust; use reverse thrust sparingly (it is most effective at high speed and stirs dust that cuts visibility).',
      '**Taxi-in and after landing:** APU bleed where possible; same taxi limits as above.',
      '**Secure:** PACKS verify OFF; pressurization MAN; outflow valve **CLOSE** (keeps dust out). Maintenance covers and plugs as needed.']},
    { t: 'Turbulence', ref: 'SP.16.27–28', pts: [
      '**Light to moderate:** autopilot and autothrottle may stay on unless performance suffers. Expect more thrust lever movement and speed changes of 10–15 kt.',
      'Passenger signs **ON**; seat belts on before entering reported or expected turbulence. Crew check that passengers are belted (supernumeraries too).',
      ['!', '**Severe:** YAW DAMPER **ON**; autothrottle **disengage**; AUTOPILOT **CWS** (if trim is sustained, disengage); ENGINE START switches **FLT**; set thrust for the phase.'],
      'Change thrust only to correct an unwanted speed trend. If an approach must go into severe turbulence, delay flap extension as long as possible — the clean wing takes more gust.',
      'Speeds in severe turbulence: **climb** 280 kt or .76 M, whichever lower · **cruise** FMC thrust (if the FMC is out, the QRH unreliable-airspeed table gives near-optimum N1) · **descent** .76 M / 280 / 250 kt, whichever lower. Below 15,000 ft, with gross weight under the max landing weight, you may slow to 250 kt clean.']},
    { t: 'Windshear', ref: 'SP.16.29–31', pts: [
      'Windshear: a change of wind speed or direction over a short distance on the flight path. Indications are in the Windshear non-normal maneuver.',
      '**Clues:** thunderstorm activity, virga, pilot reports, LLWAS warnings. Stay clear of storm cells, heavy precipitation and known windshear areas. If confirmed, **delay takeoff** or do not continue the approach.',
      '**Takeoff:** full rated thrust unless a fixed derate is needed for dispatch · flaps 5, 10 or 15 for best performance unless obstacles or climb gradient limit · longest runway clear of known windshear · consider raising Vr toward the performance-limited rotation speed (not above actual-weight Vr + 20 kt); if windshear is met at or beyond Vr, rotate without hesitation · watch airspeed after rotation — fluctuations may be the first sign · know the all-engine initial climb pitch and rotate at the normal rate to it · if the stick shaker activates, reduce pitch attitude — but do not exceed the Pitch Limit Indication.',
      '**Approach and landing:** flaps 30 · a stabilised approach by **1,000 ft** above the airport · the most suitable runway clear of windshear and within the wind limits · glide path indications · if the autothrottle is off or going off before landing, add up to **15 kt** of airspeed correction · avoid big thrust cuts or trim changes after a sudden speed gain · crosscheck the flight director with vertical flight path instruments.',
      'Autopilot and autothrottle on the approach give more monitoring time.',
      ['!', '**Recovery:** Windshear Escape Maneuver, Non-Normal Maneuvers.']]},
    { t: 'Ice crystal icing (ICI)', ref: 'SP.16.31–32', pts: [
      ['!', 'Below freezing near convective weather: visible moisture of small ice crystals can build up behind the fan and in the core. Ice shedding causes vibration, power loss and engine damage. Avoid ICI conditions.'],
      'Fan hub ice (vibration above 4 units) is not cleared by fan ice removal. It sublimates when clear of cloud and can stay into descent.',
      'Hard to detect: ice crystals give little weather radar return and do not stick to cold surfaces. Careful pre-flight planning is the key.',
      '**Signs:** rain on the windshield at temperatures too cold for liquid water (crystals melting on the heated glass, sounds unlike rain) · light to moderate turbulence · in IMC with no airframe icing, little radar return at altitude and heavy precipitation below shown amber/red · cloud tops above typical cruise (above the tropopause) · ozone or sulphur smell · humidity rise · St. Elmo’s fire.',
      'The ice detection system does **not** detect ICI — it senses supercooled water only.',
      '**Avoid:** in IMC, do not fly directly over significant amber or red returns, even with none at altitude. Use the weather radar controls to read returns below the flight path.',
      'High ice water content areas can be flagged by some weather vendors — use them for planning and in-flight route changes.',
      '**If suspected:** leave the ICI area laterally (climbing or descending to leave it is not recommended); request a route change to cut time above amber and red returns; do the **Ice Crystal Icing** non-normal checklist.']},
  ], tables: [
    { t: 'Cold temperature altitude correction — feet', unit: 'ft', head: ['200', '300', '400', '500', '600', '700', '800', '900', '1000', '1500', '2000', '3000'], rows: [
      ['0 °C', [20, 20, 30, 30, 40, 40, 50, 50, 60, 90, 120, 170]],
      ['−10 °C', [20, 30, 40, 50, 60, 70, 80, 90, 100, 150, 200, 290]],
      ['−20 °C', [30, 50, 60, 70, 90, 100, 120, 130, 140, 210, 280, 420]],
      ['−30 °C', [40, 60, 80, 100, 120, 140, 150, 170, 190, 280, 380, 570]],
      ['−40 °C', [50, 80, 100, 120, 150, 170, 190, 220, 240, 360, 480, 720]],
      ['−50 °C', [60, 90, 120, 150, 180, 210, 240, 270, 300, 450, 590, 890]]] },
    { t: 'Cold temperature altitude correction — metres', unit: 'm', head: ['60', '90', '120', '150', '180', '210', '240', '270', '300', '450', '600', '900'], rows: [
      ['0 °C', [5, 5, 10, 10, 10, 15, 15, 15, 20, 25, 35, 50]],
      ['−10 °C', [10, 10, 15, 15, 20, 20, 25, 30, 30, 45, 60, 90]],
      ['−20 °C', [10, 15, 20, 25, 25, 30, 35, 40, 45, 65, 85, 130]],
      ['−30 °C', [15, 20, 25, 30, 35, 40, 45, 55, 60, 85, 115, 170]],
      ['−40 °C', [15, 25, 30, 40, 45, 50, 60, 65, 75, 110, 145, 220]],
      ['−50 °C', [20, 30, 40, 45, 55, 65, 75, 80, 90, 135, 180, 270]]] },
  ]},
];
