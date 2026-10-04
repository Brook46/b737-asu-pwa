// quickref.js — Quick Reference: QRH memory items, non-normal maneuvers
// (done from memory), the limitations a pilot must know by heart (#) and the
// other key numbers, plus every number cited on the system pages.
//
// Source: 737 QRH and FCOM D6-27370-858-ELA, Rev 57 (30 Sep 2025).
// Memory items are the steps above the dashed separator line in each Quick
// Action Index checklist — kept as short action lines, because the exact
// action matters. A study aid only: the QRH in the airplane governs.

export const MEMORY = [
  { t: 'Aborted Engine Start', ref: 'QRH 7.1', when: 'On the ground, the start must be aborted.',
    steps: [['Engine start lever (affected engine)', 'CUTOFF']] },
  { t: 'Airspeed Unreliable', ref: 'QRH 10.1', when: 'Airspeed or Mach suspected unreliable.',
    steps: [['Autopilot (if engaged)', 'Disengage'], ['Autothrottle (if engaged)', 'Disengage'], ['F/D switches (both)', 'OFF'],
      ['Gear-up pitch and thrust, flaps extended', '10° and 80 % N1'], ['Gear-up pitch and thrust, flaps up', '4° and 75 % N1']] },
  { t: 'APU FIRE', ref: 'QRH 8.1', when: 'Fire detected in the APU.',
    steps: [['APU fire switch', 'Confirm · pull, rotate to the stop, hold 1 s'], ['APU switch', 'OFF']] },
  { t: 'CABIN ALTITUDE WARNING or Rapid Depressurization', ref: 'QRH 2.1', when: 'Cabin altitude exceedance; in flight the intermittent horn or CABIN ALTITUDE light.',
    steps: [['Oxygen masks', 'On, regulators 100 %'], ['Crew communications', 'Establish'], ['Pressurization mode selector', 'MAN'],
      ['Outflow VALVE switch', 'Hold CLOSE until the valve shows fully closed'],
      ['If cabin altitude is uncontrollable', 'Passenger signs ON · PASS OXYGEN ON · Emergency Descent']] },
  { t: 'Emergency Descent', ref: 'QRH 0.1', when: 'Cabin altitude can\'t be controlled, or a rapid descent is needed.',
    steps: [['Announce the emergency descent', 'PF: cabin on the PA · PM: ATC, area altimeter setting'], ['Passenger signs', 'ON'],
      ['Descend without delay', 'Lowest safe altitude or 10,000 ft, whichever is higher'], ['ENGINE START switches (both)', 'CONT'],
      ['Thrust levers (both)', 'Minimum, or as needed for anti-ice'], ['Speedbrake', 'FLIGHT DETENT']] },
  { t: 'ENGINE FIRE or Engine Severe Damage or Separation', ref: 'QRH 8.8', when: 'Engine fire warning, airframe vibration with abnormal engine indications, or separation.',
    steps: [['Autothrottle (if engaged)', 'Disengage'], ['Thrust lever (affected engine)', 'Confirm · Close'], ['Engine start lever (affected engine)', 'Confirm · CUTOFF'],
      ['Engine fire switch (affected engine)', 'Confirm · Pull (override to unlock manually)'],
      ['If the fire switch or ENG OVERHEAT light is lit', 'Fire switch: rotate to the stop, hold 1 s']] },
  { t: 'Engine Limit or Surge or Stall', ref: 'QRH 7.2', when: 'Indications abnormal or near / beyond limits, abnormal noise, no or abnormal thrust response, flames reported.',
    steps: [['Autothrottle (if engaged)', 'Disengage'], ['Thrust lever (affected engine)', 'Confirm · Retard until indications stay within limits or the lever is closed']] },
  { t: 'ENGINE OVERHEAT', ref: 'QRH 8.12', when: 'Engine overheat detected.',
    steps: [['Autothrottle (if engaged)', 'Disengage'], ['Thrust lever (affected engine)', 'Confirm · Close'],
      ['If ENG OVERHEAT stays lit', 'Go to ENGINE FIRE or Engine Severe Damage or Separation']] },
  { t: 'Loss Of Thrust On Both Engines', ref: 'QRH 7.6', when: 'Both engines lose thrust; both ENG FAIL alerts.',
    steps: [['ENGINE START switches (both)', 'FLT'], ['Engine start levers (both)', 'CUTOFF'], ['When EGT decreases', 'Start levers (both) IDLE detent'],
      ['EGT at redline, or no EGT rise within 30 s', 'Start lever (affected) confirm CUTOFF, then IDLE detent — repeat as needed']] },
  { t: 'Runaway Stabilizer', ref: 'QRH 9.1', when: 'Uncommanded stabilizer trim, continuous or inappropriate.',
    steps: [['Control column', 'Hold firmly'], ['Autopilot (if engaged)', 'Disengage'], ['Autothrottle (if engaged)', 'Disengage'],
      ['Control column and thrust levers', 'Control pitch attitude and airspeed'], ['Main electric stabilizer trim', 'Reduce control column forces'],
      ['If the runaway stops after A/P disengage', 'Do not re-engage the A/P or A/T'],
      ['If the runaway continues', 'STAB TRIM cutout switches (both) CUTOUT'], ['If it still continues', 'Stabilizer trim wheel: grasp and hold']] },
  { t: 'LANDING CONFIGURATION', ref: 'QRH 15.1', when: 'In flight, the steady warning horn sounds.',
    steps: [['Landing configuration', 'Assure correct']] },
  { t: 'TAKEOFF CONFIGURATION', ref: 'QRH 15.1', when: 'On the ground, horn or TAKEOFF CONFIG light when advancing to takeoff thrust.',
    steps: [['Takeoff configuration', 'Assure correct']] },
  { t: 'WARNING HORN (INTERMITTENT) or CABIN ALTITUDE / TAKEOFF CONFIG light', ref: 'QRH 15.2', when: 'The intermittent horn or either light.',
    steps: [['In flight above 10,000 ft MSL', 'Oxygen masks on, 100 % · crew communications · CABIN ALTITUDE WARNING checklist'],
      ['On the ground, advancing thrust', 'Assure correct takeoff configuration']] },
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
    ['Max takeoff / landing tailwind', '15 kt'],
    ['Severe turbulence penetration (climb & descent)', '280 KIAS / M.76, whichever lower'],
    ['Do not operate HF radios', 'during refuelling'],
    ['Aileron trim with A/P engaged', 'prohibited'],
    ['A/P engagement after takeoff', 'not below 400 ft AGL'],
    ['Single-channel A/P on approach', 'off by 50 ft AGL'],
    ['Autoland winds', 'head 25 · cross 20 · tail 15 kt'],
    ['Autoland glideslope', '2.5° – 3.25°'],
    ['Autoland', 'flaps 30 or 40, both engines'],
    ['LVL CHG on final approach', 'not below 1,000 ft AFE'],
    ['Reverse thrust in flight', 'prohibited'],
    ['APU bleed + electrics (in flight)', 'max 10,000 ft'],
    ['APU bleed + electrics (ground only)', 'max 15,000 ft'],
    ['APU bleed', 'max 17,000 ft'],
    ['APU electrical load', 'max 41,000 ft'],
    ['Max altitude, flaps extended', '20,000 ft'],
    ['Holding in icing with flaps extended', 'prohibited'],
    ['Rapid large alternating control inputs', 'avoid — structural failure possible even below VA'],
    ['Speedbrakes in flight', 'not below 1,000 ft RA'],
    ['Weather radar', 'not in a hangar'],
  ]],
  ['Airplane (FCOM L.10)', [
    ['Max operating altitude', '41,000 ft pressure altitude'],
    ['Max takeoff / landing altitude', '8,400 ft pressure altitude'],
    ['Runway slope', '±2 %'],
    ['Max differential pressure (relief valves)', '9.1 psi'],
    ['RVSM: Capt vs F/O altitude in flight', '200 ft'],
    ['RVSM on the ground (SL–5,000 / 5,001–10,000 ft)', 'Capt–F/O 50 / 60 ft · either vs field 75 ft'],
    ['Speedbrake in flight', 'not beyond FLIGHT DETENT'],
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
  const table = (title, rows) => `<section class="qr-card"><h3>${esc(title)}</h3><table class="qr-num">${rows.map(([a, b, r]) => `<tr><td>${esc(a)}</td><td>${esc(b)}${r ? ` <span class="qr-ref">${esc(r)}</span>` : ''}</td></tr>`).join('')}</table></section>`;
  function body() {
    if (tab === 'memory') return `<p class="qr-note">Steps above the dashed line in each Quick Action Index checklist — do them, then read the rest of the checklist.</p>${MEMORY.map((c) => card(c, true)).join('')}
      <h2 class="qr-h2">Quick actions (read and do)</h2>${QUICK_ACTIONS.map((c) => card(c)).join('')}`;
    if (tab === 'maneuvers') return `<p class="qr-note">Non-normal maneuvers are flown from memory. Callout first: "STALL", "WINDSHEAR", "UPSET"…</p>${MANEUVERS.map((c) => card(c, true)).join('')}`;
    if (tab === 'numbers') return NUMBERS.map(([t, rows]) => table(t, rows)).join('');
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
