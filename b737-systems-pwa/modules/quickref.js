// quickref.js — Quick Reference: QRH memory items, non-normal maneuvers
// (done from memory), the limitations a pilot must know by heart (#) and the
// other key numbers, plus every number cited on the system pages.
//
// Source: 737 QRH (Quick Action Index, Rev 57, 30 Sep 2025), QRH.pdf. A memory
// item is every step above the dashed separator in its checklist, worded as
// printed, with its Condition. Markup: **bold** as printed; `red` / `amber`
// boxes are the QRH Warning! / Caution! boxes; `fire` tags the fire items.
// A study aid only: the QRH in the airplane governs.

// Step builders: n = step number, a = action, m = middle ("Confirm"), v = value,
// sub = indented lines (strings, or [action, value] rows), go = ►► instruction.
const R = (n, a, v, m, sub = []) => ({ k: 'row', n, a, v, m, sub });
const P = (n, a, sub = []) => ({ k: 'txt', n, a, sub });
const GO = (a) => ({ k: 'go', a });
const BOX = (a, lvl = 'caution') => ({ k: 'box', a, lvl });

export const MEMORY = [
  { t: 'Aborted Engine Start', ref: 'QRH 7.1', cond: ['On the ground, an aborted engine start is needed.'],
    steps: [R(1, 'Engine start lever (affected engine)', 'CUTOFF')] },
  { t: 'Airspeed Unreliable', ref: 'QRH 10.1', cond: ['Airspeed or Mach indications are suspected to be unreliable.'],
    steps: [R(1, 'Autopilot (if engaged)', 'Disengage'), R(2, 'Autothrottle (if engaged)', 'Disengage'), R(3, 'F/D switches (both)', 'OFF'),
      P(4, 'Set the following gear up pitch attitude and thrust:', [['Flaps extended', '10° and 80% N1'], ['Flaps up', '4° and 75% N1']])] },
  { t: 'APU FIRE', ref: 'QRH 8.1', fire: true, cond: ['Fire is detected in the APU.'],
    steps: [R(1, 'APU fire switch', 'Pull, rotate to the stop, and hold for 1 second', 'Confirm'), R(2, 'APU switch', 'OFF')] },
  { t: 'CABIN ALTITUDE WARNING or Rapid Depressurization', ref: 'QRH 2.1', tag: ['CABIN ALTITUDE', 'red'],
    cond: ['One or more of these occur:', ['A cabin altitude exceedance', 'In flight, the intermittent cabin altitude/configuration warning horn sounds or a **CABIN ALTITUDE** light (if installed and operative) illuminates.']],
    steps: [P(1, 'Don oxygen masks and set regulators to 100%.'), P(2, 'Establish crew communications.'),
      R(3, 'Pressurization mode selector', 'MAN'), R(4, 'Outflow VALVE switch', 'Hold in CLOSE until the outflow VALVE indication shows fully closed'),
      P(5, '**If** cabin altitude is **uncontrollable**:', [['Passenger signs', 'ON'], ['PASS OXYGEN switch', 'ON'], GO('Go to the Emergency Descent checklist on page 0.1')])] },
  { t: 'Emergency Descent', ref: 'QRH 0.1', cond: ['One or more of these occur:', ['Cabin altitude cannot be controlled', 'A rapid descent is needed.']],
    steps: [P(1, 'Announce the emergency descent. The pilot flying will advise the cabin crew, on the PA system, of impending rapid descent. The pilot monitoring will advise ATC and obtain the area altimeter setting.'),
      R(2, 'Passenger signs', 'ON'), P(3, '**Without delay**, descend to the lowest safe altitude or 10,000 feet, whichever is higher.'),
      R(4, 'ENGINE START switches (both)', 'CONT'), R(5, 'Thrust levers (both)', 'Reduce thrust to minimum or as needed for anti-ice'),
      R(6, 'Speedbrake', 'FLIGHT DETENT'), BOX('If structural integrity is in doubt, limit speed as much as possible and avoid high maneuvering loads.', 'caution'),
      P(7, 'Set target speed to Mmo/Vmo.')] },
  { t: 'CARGO FIRE (MAIN)', ref: 'QRH 8.2', fire: true, tag: ['MAIN', 'red'], cond: ['Fire is detected in the main deck cargo compartment.'],
    steps: [P(1, 'Don oxygen masks and set regulators to 100%, as needed.'), P(2, 'Don smoke goggles, as needed.'),
      P(3, 'Close the flight deck door. This step prevents smoke or fumes contamination from other compartments.'), P(4, 'Establish crew and cabin communications.')] },
  { t: 'ENGINE FIRE or Engine Severe Damage or Separation', ref: 'QRH 8.8', fire: true, cond: ['One or more of these occur:', ['Engine fire warning', 'Airframe vibrations with abnormal engine indications', 'Engine separation.']],
    steps: [R(1, 'Autothrottle (if engaged)', 'Disengage'), R(2, 'Thrust lever (affected engine)', 'Close', 'Confirm'),
      R(3, 'Engine start lever (affected engine)', 'CUTOFF', 'Confirm'), R(4, 'Engine fire switch (affected engine)', 'Pull', 'Confirm', ['To manually unlock the engine fire switch, press the override and pull.']),
      P(5, '**If** the engine fire switch or ENG OVERHEAT light is illuminated:', [['Engine fire switch (affected engine)', 'Rotate to the stop and hold for 1 second']])] },
  { t: 'Engine Limit or Surge or Stall', ref: 'QRH 7.2', cond: ['One or more of these occur:', ['Engine indications are abnormal', 'Engine indications are rapidly approaching or exceeding limits', 'Abnormal engine noises are heard, possibly with airframe vibration', 'There is no response to thrust lever movement or the response is abnormal', 'Flames in the engine inlet or exhaust are reported.']],
    steps: [R(1, 'Autothrottle (if engaged)', 'Disengage'), R(2, 'Thrust lever (affected engine)', 'Retard until engine indications stay within limits or the thrust lever is closed', 'Confirm')] },
  { t: 'ENGINE OVERHEAT', ref: 'QRH 8.12', fire: true, tag: ['ENG 1 / ENG 2 OVERHEAT', 'amber'], cond: ['An overheat is detected in the engine.'],
    steps: [R(1, 'Autothrottle (if engaged)', 'Disengage'), R(2, 'Thrust lever (affected engine)', 'Close', 'Confirm'),
      P(3, '**If** the ENG OVERHEAT light **stays illuminated**:', [GO('Go to the ENGINE FIRE or Engine Severe Damage or Separation checklist on page 8.8')])] },
  { t: 'Loss Of Thrust On Both Engines', ref: 'QRH 7.6', cond: ['Both of these occur:', ['Both engines have a loss of thrust', 'Both ENG FAIL alerts show.']],
    steps: [R(1, 'ENGINE START switches (both)', 'FLT'), R(2, 'Engine start levers (both)', 'CUTOFF'),
      P(3, '**When** EGT decreases:', [['Engine start levers (both)', 'IDLE detent']]),
      P(4, '**If** EGT reaches a redline or there is no increase in EGT within 30 seconds:', [['Engine start lever (affected engine) · Confirm', 'CUTOFF, then IDLE detent'], '**If** EGT again reaches a redline or there is no increase in EGT within 30 seconds, repeat as needed.'])] },
  { t: 'Runaway Stabilizer', ref: 'QRH 9.1', cond: ['Uncommanded stabilizer trim movement occurs continuously or in a manner not appropriate for flight conditions.'],
    steps: [R(1, 'Control column', 'Hold firmly'), R(2, 'Autopilot (if engaged)', 'Disengage'), R(3, 'Autothrottle (if engaged)', 'Disengage'),
      R(4, 'Control column and thrust levers', 'Control airplane pitch attitude and airspeed'), R(5, 'Main Electric Stabilizer trim', 'Reduce control column forces'),
      P(6, '**If** the runaway **stops** after the autopilot is disengaged:', ['Do **not** re-engage the autopilot or autothrottle.']),
      P(7, '**If** the runaway **continues** after the autopilot is disengaged:', [['STAB TRIM cutout switches (both)', 'CUTOUT'], ['**If** the runaway **continues**: Stabilizer trim wheel', 'Grasp and hold']])] },
  { t: 'LANDING CONFIGURATION', ref: 'QRH 15.1', cond: ['In flight, the steady warning horn sounds.'],
    steps: [P(1, 'Assure correct airplane landing configuration.')] },
  { t: 'TAKEOFF CONFIGURATION', ref: 'QRH 15.1', tag: ['TAKEOFF CONFIG', 'red'], cond: ['On the ground, the intermittent cabin altitude/configuration warning horn sounds or a TAKEOFF CONFIG light (if installed and operative) illuminates when advancing the thrust levers to takeoff thrust.'],
    steps: [P(1, 'Assure correct airplane takeoff configuration.')] },
  { t: 'WARNING HORN (INTERMITTENT) or WARNING LIGHT - CABIN ALTITUDE OR TAKEOFF CONFIGURATION', ref: 'QRH 15.2', tag: ['CABIN ALTITUDE / TAKEOFF CONFIG', 'red'],
    cond: ['One of these occurs:', ['In flight, at an airplane flight altitude above 10,000 feet MSL, the intermittent warning horn sounds or a CABIN ALTITUDE light (if installed and operative) illuminates', 'On the ground, the intermittent warning horn sounds or a TAKEOFF CONFIG light illuminates when advancing the thrust levers to takeoff thrust.']],
    steps: [P(1, '**If** the intermittent warning horn sounds or a CABIN ALTITUDE light illuminates **in flight** at an airplane flight altitude above 10,000 feet MSL:', ['Don the oxygen masks and set the regulators to 100%.', 'Establish crew communications.', GO('Go to the CABIN ALTITUDE WARNING checklist on page 2.1')]),
      P(2, '**If** the intermittent warning horn sounds or a TAKEOFF CONFIG light illuminates **on the ground** when advancing the thrust levers to takeoff thrust:', ['Assure correct airplane takeoff configuration.'])] },
];

// Quick Action Index checklists done by reading (not memory), and the back cover.
export const QUICK_ACTIONS = [
  { t: 'Engine Fire on the Ground', ref: 'QRH Back Cover.2', steps: [['Thrust levers (both)', 'Close · C'], ['PARKING BRAKE', 'Set · C'], ['Advise the cabin', 'C'],
    ['Engine start lever (affected)', 'CUTOFF · C'], ['Engine fire switch (affected)', 'Pull · F/O'], ['Engine fire switch (affected)', 'Rotate to the stop, hold 1 s · F/O'],
    ['Evacuation needed?', 'Yes: Evacuation checklist · No: advise cabin (C) and ATC (F/O)']] },
  { t: 'Evacuation', ref: 'QRH Back Cover.4', steps: [['PARKING BRAKE', 'Set · C'], ['Speedbrake lever', 'DOWN · C'], ['FLAP lever', '40 · F/O'],
    ['Pressurization mode selector', 'MAN · F/O'], ['Outflow VALVE switch', 'Hold OPEN until fully open · F/O'],
    ['If time allows', 'Verify flaps 40 before start levers to CUTOFF · C'], ['Engine start levers (both)', 'CUTOFF · C'],
    ['Advise the cabin to evacuate', 'C'], ['Advise ATC', 'F/O'], ['Engine and APU fire switches (all)', 'Override and pull · F/O'],
    ['If an engine or APU fire is observed or indicated', 'Related fire switch: rotate to the stop, hold 1 s · F/O']] },
  { t: 'Engine Tailpipe Fire (ground, no fire warning)', ref: 'QRH 8.14', steps: [['Engine start lever (affected)', 'CUTOFF'], ['Advise the cabin', ''],
    ['Bleed air available', 'Packs OFF · isolation AUTO · engine bleeds ON (APU bleed ON if running) — then motor the engine'], ['No bleed air', 'Advise ATC']] },
];

// Non-normal maneuvers: "flight crews are expected to do them from memory" (QRH MAN.05).
export const MANEUVERS = [
  { t: 'Approach to Stall or Stall Recovery', ref: 'QRH MAN.1.1', when: 'First indication of stall: buffet or stick shaker. Treat it as a real stall; no flight director.',
    steps: [['Initiate', 'Hold the column firmly · A/P and A/T off · nose down until buffet / shaker stops (nose-down trim if needed)'],
      ['Continue', 'Roll the shortest way to wings level · thrust as needed · speedbrakes in · don\'t change gear or flaps (except: at lift-off with flaps up, call flaps 1)'],
      ['Complete', 'Check speed, adjust thrust · establish pitch · back to the flight path · A/P and A/T if desired']] },
  { t: 'Rejected Takeoff', ref: 'QRH MAN.1.2', when: 'Captain decides and calls "REJECT".',
    steps: [['Below 80 kt — reject for', 'Master caution, system failure, unusual noise / vibration, tire failure, slow acceleration, takeoff config warning, fire, engine failure, predictive windshear warning, side window open, unsafe to fly'],
      ['80 kt to V1 — reject only for', 'Fire or fire warning, engine failure, predictive windshear warning, unsafe or unable to fly'],
      ['Captain', 'Thrust levers closed · A/T off · max manual braking or verify RTO · speedbrake UP · max reverse consistent with conditions · keep braking until stopping is certain'],
      ['First officer', 'Verify actions; "SPEEDBRAKES UP / NOT UP", "REVERSERS NORMAL / NO REVERSER…" · call 60 kt · tell the tower']] },
  { t: 'GPWS Warning (PULL UP / TERRAIN TERRAIN PULL UP)', ref: 'QRH MAN.1.5', when: 'A pull-up warning, or other unacceptable flight toward terrain. No flight director.',
    steps: [['A/P and A/T', 'Disengage'], ['Thrust', 'Aggressively maximum'], ['Attitude', 'Wings level and rotate to 20° pitch together'],
      ['Speedbrakes', 'Retract'], ['Terrain still a threat', 'Rotate up to the pitch limit indicator / stick shaker / initial buffet'],
      ['Configuration', 'No gear or flap change until terrain separation is assured']] },
  { t: 'GPWS Caution', ref: 'QRH MAN.1.4', when: 'SINK RATE, TERRAIN, DON\'T SINK, TOO LOW FLAPS / GEAR / TERRAIN, GLIDESLOPE, BANK ANGLE, AIRSPEED LOW, CAUTION TERRAIN / OBSTACLE.',
    steps: [['Pilot flying', 'Correct the flight path, configuration or airspeed']] },
  { t: 'Traffic Avoidance (TCAS)', ref: 'QRH MAN.1.7', when: 'Any TA or RA, by recall. Comply with the RA even if ATC says otherwise; no F/D until clear.',
    steps: [['TA', 'Look for the traffic; don\'t maneuver on a TA alone'], ['RA', 'A/P and A/T off · smoothly fly pitch and thrust to the RA · keep the planned lateral path'],
      ['Climb RA in landing configuration', 'Max thrust, flaps 15, positive rate → gear up'], ['Never', 'Follow a DESCEND RA below 1,000 ft AGL']] },
  { t: 'Upset Recovery — Nose High', ref: 'QRH MAN.1.10', when: 'Upset: diverting from the intended state (historically > 25° nose up, > 10° nose down, > 45° bank, or wrong speed). Recover from a stall first.',
    steps: [['A/P and A/T', 'Disengage'], ['Recover', 'Nose-down elevator for a nose-down pitch rate · nose-down trim if needed · reduce thrust · bank to get the nose down'],
      ['Complete', 'Near the horizon roll wings level · check speed, adjust thrust · establish pitch']] },
  { t: 'Upset Recovery — Nose Low', ref: 'QRH MAN.1.10', when: '',
    steps: [['A/P and A/T', 'Disengage'], ['Recover', 'Recover from the stall if needed · roll the shortest way to wings level (beyond 90° bank: unload, then roll)'],
      ['Complete', 'Nose-up elevator · nose-up trim if needed · adjust thrust and drag']] },
  { t: 'Windshear Escape', ref: 'QRH MAN.1.13', when: 'Windshear warning, or unacceptable path deviations below 1,000 ft: ±15 kt, 500 fpm, 5° pitch, 1 dot G/S, odd thrust lever position.',
    steps: [['Manual', 'A/P off · TO/GA · aggressively max thrust · A/T off · wings level, rotate toward 15° · speedbrakes in · follow TO/GA F/D'],
      ['Automatic', 'TO/GA · verify TO/GA mode and GA thrust · speedbrakes in · monitor (be ready to fly manually)'],
      ['Both', 'No flap or gear change until clear · wings level · don\'t chase lost airspeed until clear'],
      ['Predictive warning', 'Takeoff roll: before V1 reject, after V1 escape · approach: escape or normal go-around']] },
];

// The limitations marked # (must be memorized), then other key numbers.
export const NUMBERS = [
  ['Memorize (FCOM L.10, marked #)', [
    ['Maximum takeoff and landing tailwind component', '15 kt (takeoff and manual landing with tailwind)'],
    ['Severe turbulent air penetration speed (climb and descent only)', '280 KIAS / M.76, whichever is lower'],
    ['HF radios', 'do not operate during refuelling'],
    ['Aileron trim with the autopilot engaged', 'prohibited'],
    ['Autopilot engagement for takeoff', 'do not engage below 400 ft AGL'],
    ['Single-channel autopilot on approach', 'must not stay engaged below 50 ft AGL'],
    ['Autoland wind limits (steady wind, landing minima on autoland)', 'headwind 25 kt · crosswind 20 kt · tailwind 15 kt'],
    ['Autoland glideslope angle', '2.5° to 3.25°'],
    ['Autoland configuration', 'flaps 30 or 40, both engines operative'],
    ['LVL CHG on final approach', 'do not use below 1,000 ft AFE'],
    ['Reverse thrust in flight', 'intentional selection prohibited'],
    ['APU bleed + electrical load, in flight', 'max altitude 10,000 ft'],
    ['APU bleed + electrical load, ground only', 'max altitude 15,000 ft'],
    ['APU bleed (alone)', 'max altitude 17,000 ft'],
    ['APU electrical load (alone)', 'max altitude 41,000 ft'],
    ['Maximum altitude with flaps extended', '20,000 ft'],
    ['Holding in icing conditions with flaps extended', 'prohibited'],
    ['Rapid and large alternating control inputs', 'avoid: structural failure possible at any speed, including below VA'],
    ['SPEED BRAKE lever in flight', 'do not deploy the speed brakes below 1,000 ft radio altitude'],
    ['Weather radar operation in a hangar', 'avoid; also avoid when personnel are within the radome area'],
  ], true],
  ['Airplane (FCOM L.10)', [
    ['Max operating altitude', '41,000 ft pressure altitude'],
    ['Max takeoff / landing altitude', '8,400 ft pressure altitude'],
    ['Runway slope', '±2 %'],
    ['Max differential pressure (relief valves)', '9.1 psi'],
    ['RVSM: Capt vs F/O altitude in flight', '200 ft'],
    ['RVSM on the ground (SL–5,000 / 5,001–10,000 ft)', 'Capt–F/O 50 / 60 ft · either vs field 75 ft'],
    ['SPEED BRAKE lever in flight', 'do not move beyond the FLIGHT DETENT'],
    ['Alternate flaps', '15 s between selections · 5 min after 0→15→0'],
    ['ADIRU alignment', 'not above 78°15′ latitude'],
    ['Brakes', 'not before touchdown'],
    ['Engine ignition on for', 'takeoff, landing, heavy rain, anti-ice'],
    ['APU', '2 min running before bleed use · 15 min cooling after 3 aborted starts'],
    ['Packs HIGH with engine bleed', 'not for takeoff, approach or landing'],
  ]],
  ['Fuel (FCOM L.10)', [
    ['Max tank fuel temperature', '49 °C'],
    ['Min tank fuel temperature', '−43 °C or freeze point + 3 °C, whichever higher'],
    ['Random lateral imbalance', '453 kg max'],
    ['Center tank > 453 kg', 'main tanks must be full'],
    ['Center pump dry running', 'prohibited (LOW PRESSURE lit)'],
  ]],
  ['Weights (FCOM L.10 — MTOW: Weight & Balance Manual)', [
    ['Max taxi weight', '4X-EK* 79,242 · 4X-EKZ 79,151 · 4X-EH* 85,366 kg'],
    ['Max landing weight', '4X-EK* 66,360 · 4X-EKZ 66,224 · 4X-EH* 71,350 kg'],
    ['Max zero fuel weight', '4X-EK* 62,731 · 4X-EKP 62,142 · 4X-EKZ 61,688 · 4X-EH* 67,721 kg'],
  ]],
  ['Narrow runway (30 m) — 4X-EHA…EHI only (FCOM L.10)', [
    ['Takeoff crosswind: dry / wet / snow / flooded / icy', '36 (34)¹ / 25 / 25 / 15 / 15 kt'],
    ['Landing crosswind: dry / wet / snow / flooded / icy', '40 / 40 / 35 / 20 / 17 kt'],
    ['Sideslip-only landing not recommended above', '17 kt flaps 15 · 20 kt flaps 30 · 23 kt flaps 40'],
    ['¹', '36 kt with both blended winglets'],
  ]],
  ['QRH numbers worth knowing', [
    ['Airspeed unreliable, gear up', 'flaps out 10° / 80 % N1 · flaps up 4° / 75 % N1'],
    ['Emergency descent to', 'lowest safe altitude or 10,000 ft, whichever higher'],
    ['Dual engine failure airspeed', '≥ FL270: 275 kt · below: 300 kt'],
    ['Aborted start', 'motor 60 s after N2 below 20 %'],
    ['Fire switch rotate', 'to the stop, hold 1 s'],
    ['Windshear path deviations (< 1,000 ft)', '15 kt · 500 fpm · 5° · 1 dot'],
    ['GPWS pull-up initial pitch', '20° · windshear escape 15°'],
    ['RTO: 80 kt', 'above it reject only for fire, engine failure, PWS warning, unsafe to fly'],
  ]],
];

/** HTML for the sheet. `systems` adds every number cited on the system pages. */
export function createQuickRef(sheet, systems) {
  let tab = 'memory';
  const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  // Short actions read like the QRH ("item ……… ACTION"); long ones wrap below the item.
  const steps = (list) => `<ol class="qr-steps">${list.map(([a, b]) => {
    if (!b) return `<li><span class="qr-a">${esc(a)}</span></li>`;
    if (b.length > 30) return `<li class="long"><span class="qr-a">${esc(a)}</span><span class="qr-b">${esc(b)}</span></li>`;
    return `<li><span class="qr-a">${esc(a)}</span><span class="qr-dots"></span><span class="qr-b">${esc(b)}</span></li>`;
  }).join('')}</ol>`;
  const card = (c, mem) => `<section class="qr-card${mem ? ' mem' : ''}"><h3>${esc(c.t)}<span class="qr-ref">${esc(c.ref)}</span></h3>${c.when ? `<p class="qr-when">${esc(c.when)}</p>` : ''}${steps(c.steps)}</section>`;
  const table = (title, rows, mem = false) => `<section class="qr-card"><h3>${esc(title)}</h3><table class="qr-num">${rows.map(([a, b, r]) => `<tr><td>${mem ? '<span class="qr-hash">#</span>' : ''}${esc(a)}</td><td>${esc(b)}${r ? ` <span class="qr-ref">${esc(r)}</span>` : ''}</td></tr>`).join('')}</table></section>`;
  // Memory items as printed: numbered steps with leader dots, sub-lines,
  // ►► instructions, boxed Caution / Warning, Condition panel with tags.
  const md = (x) => esc(x).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  const line = (a, v, m) => `<div class="qr-line${v && v.length > 28 ? ' long' : ''}"><span class="qr-a">${md(a)}</span>${m ? `<span class="qr-m">${md(m)}</span>` : ''}<span class="qr-dots"></span>${v ? `<span class="qr-b">${md(v)}</span>` : ''}</div>`;
  const subHtml = (x) => {
    if (typeof x === 'string') return `<div class="qr-sub">${md(x)}</div>`;
    if (Array.isArray(x)) return `<div class="qr-sub">${line(x[0], x[1])}</div>`;
    return `<div class="qr-go">►► ${md(x.a)}</div>`;
  };
  const stepHtml = (st) => {
    if (st.k === 'row') return `<div class="qr-row"><span class="qr-n">${st.n}</span><div class="qr-fill">${line(st.a, st.v, st.m)}${st.sub.map(subHtml).join('')}</div></div>`;
    if (st.k === 'txt') return `<div class="qr-row"><span class="qr-n">${st.n}</span><div class="qr-fill"><div class="qr-t">${md(st.a)}</div>${st.sub.map(subHtml).join('')}</div></div>`;
    if (st.k === 'box') return `<div class="qr-box ${st.lvl}">${st.lvl === 'caution' ? '⚠ ' : ''}${md(st.a)}</div>`;
    return '';
  };
  const condHtml = (list) => list.map((x) => (Array.isArray(x) ? `<ul>${x.map((li) => `<li>${md(li)}</li>`).join('')}</ul>` : `<p>${md(x)}</p>`)).join('');
  const memCard = (c) => `<section class="qr-card mem${c.fire ? ' fire' : ''}">
    <h3>${md(c.t)}<span class="qr-ref">${esc(c.ref)}</span></h3>
    ${c.tag ? `<span class="qr-tag ${c.tag[1]}">${esc(c.tag[0])}</span>` : ''}
    <div class="qr-cond"><span class="qr-lbl">Condition:</span><div>${condHtml(c.cond)}</div></div>
    ${c.steps.map(stepHtml).join('')}
    <div class="qr-sep"></div>
  </section>`;
  function body() {
    if (tab === 'memory') return `<p class="qr-note">Steps above the dashed line in each Quick Action Index checklist — do them, then read the rest of the checklist.</p>${MEMORY.map(memCard).join('')}
      <h2 class="qr-h2">Quick actions (read and do)</h2>${QUICK_ACTIONS.map((c) => card(c)).join('')}`;
    if (tab === 'maneuvers') return `<p class="qr-note">Non-normal maneuvers are flown from memory. Callout first: "STALL", "WINDSHEAR", "UPSET"…</p>${MANEUVERS.map((c) => card(c, true)).join('')}`;
    if (tab === 'numbers') return NUMBERS.map(([t, rows, mem]) => table(t, rows, mem)).join('');
    // Every number on the system pages, by chapter.
    return systems.filter((s) => s.mod).sort((a, b) => a.num - b.num).map((s) => {
      const rows = [...s.mod.overview.limits];
      for (const p of s.mod.parts) for (const l of p.limits || []) if (!rows.some((r) => r[0] === l[0])) rows.push(l);
      return rows.length ? table(`${String(s.num).padStart(2, '0')} ${s.mod.title}`, rows) : '';
    }).join('');
  }
  function html() {
    const tabs = [['memory', 'Memory items'], ['maneuvers', 'Maneuvers'], ['numbers', 'Limits & numbers'], ['systems', 'By system']];
    return `<div class="qr">
      <div class="kicker">QUICK REFERENCE · QRH / FCOM REV 57</div>
      <h2>Quick reference</h2>
      <div class="qr-tabs">${tabs.map(([k, n]) => `<button class="tag tag-btn${k === tab ? ' on' : ''}" data-qr-tab="${k}">${n}</button>`).join('')}</div>
      ${body()}
      <p class="qr-foot">Study aid in our own layout. The QRH and FCOM on board govern — check effectivity for your tail.</p>
    </div>`;
  }
  function open(t) { if (t) tab = t; sheet.custom(html(), 'quickref'); }
  // Tab clicks inside the sheet.
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-qr-tab]');
    if (!b) return;
    tab = b.dataset.qrTab;
    open();
  });
  return { open, get key() { return 'quickref'; } };
}
