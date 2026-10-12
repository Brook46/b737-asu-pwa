// supp-procs.js — supplementary procedures you run as a checklist: pick one,
// its steps show phase by phase (Takeoff / After takeoff / Landing…), and you
// tick them off. Steps are switch → position, worded after FCOM Rev 57; notes
// and cautions sit where the FCOM puts them. Study aid: the FCOM governs.
//
// Step kinds: ['ITEM', 'POSITION'] · { note } · { caution } · { when } (a
// condition line that starts a block of steps).

export const CHAPTERS = [
  {
    n: 2, t: 'Air Systems', procs: [
      {
        id: 'neb', tags: ['hot', 'sand'], t: 'No engine bleed takeoff and landing', ref: 'SP.2.5–6',
        use: 'Engine bleeds off, the APU supplying the packs. For landing when more go-around thrust is wanted (SP.2.6); in sand or dust (SP.16.24).',
        phases: [
          ['Takeoff', [
            { note: 'Anti-ice needed for taxi: set this up just before takeoff. Not needed: just after engine start.' },
            ['Right PACK switch', 'AUTO'], ['ISOLATION VALVE switch', 'CLOSE'], ['Left PACK switch', 'AUTO'],
            ['Engine No. 1 BLEED air switch', 'OFF'], ['APU BLEED air switch', 'ON'], ['Engine No. 2 BLEED air switch', 'OFF'],
            ['Trim air switch', 'ON'], ['WING ANTI-ICE switch', 'OFF'],
            { caution: 'Wing anti-ice stays OFF until the engine bleeds are back ON and the isolation valve is in AUTO.' },
          ]],
          ['After takeoff', [
            { caution: 'Engine failure: engine bleeds stay OFF until 1,500 ft or obstacle clearance height.' },
            ['Engine No. 2 BLEED air switch', 'ON'], ['APU BLEED air switch', 'OFF'],
            { when: 'When the cabin rate of climb has stabilized:' },
            ['Engine No. 1 BLEED air switch', 'ON'], ['ISOLATION VALVE switch', 'AUTO'], ['APU switch', 'As needed'],
          ]],
          ['Landing', [
            { note: 'Use it for landing when more go-around thrust is wanted.' },
            { when: 'Below 10,000 ft:' },
            ['WING ANTI-ICE switch', 'OFF'], ['Right PACK switch', 'AUTO'], ['ISOLATION VALVE switch', 'CLOSE'], ['Left PACK switch', 'AUTO'],
            ['Engine No. 1 BLEED air switch', 'OFF'], ['APU BLEED air switch', 'ON'], ['Engine No. 2 BLEED air switch', 'OFF'],
          ]],
        ],
      },
      {
        id: 'unpress', tags: ['noApu', 'sand'], t: 'Unpressurized takeoff and landing', ref: 'SP.2.4–5',
        use: 'No engine bleed takeoff or landing when the APU is inoperative, or running but not giving bleed air.',
        phases: [
          ['Takeoff', [
            ['PACK switches', 'AUTO'], ['ISOLATION VALVE switch', 'CLOSE'], ['Engine BLEED air switches', 'OFF'], ['APU BLEED air switch', 'OFF'],
          ]],
          ['After takeoff', [
            { caution: 'Engine failure: engine bleeds stay OFF until 1,500 ft or obstacle clearance height.' },
            { when: 'Not below 400 ft and before 2,000 ft above field elevation:' },
            ['Engine No. 2 BLEED air switch', 'ON'],
            { when: 'When the cabin rate of climb has stabilized:' },
            ['Engine No. 1 BLEED air switch', 'ON'], ['ISOLATION VALVE switch', 'AUTO'],
          ]],
          ['Landing', [
            { when: 'Below 10,000 ft, starting the turn to final:' },
            ['Engine BLEED air switches', 'OFF'],
            { note: 'Avoid high rates of descent, for the cabin.' },
          ]],
        ],
      },
      {
        id: 'cart', tags: ['noApu'], t: 'External air cart', ref: 'SP.2.1–2',
        use: 'Air conditioning from a ground air cart. Engine start with ground air: SP.7.',
        phases: [
          ['Set up', [
            { caution: 'BAT switch ON whenever the airplane air conditioning runs — its protection circuits are DC.' },
            ['APU BLEED air switch', 'OFF'], ['ISOLATION VALVE switch', 'OPEN'], ['RECIRC FAN switches', 'AUTO'], ['Trim air switch', 'ON'],
            ['PACK switches', 'AUTO or HIGH'], ['Cabin temperature selectors', 'AUTO, as desired'], ['Duct pressure', '20 psi minimum'],
          ]],
          ['Cart below 20 psi, APU running', [
            ['ISOLATION VALVE switch', 'AUTO'], ['APU BLEED air switch', 'ON'],
            { note: 'The APU then feeds the left pack and the cart the right pack.' },
          ]],
        ],
      },
      {
        id: 'pca', tags: ['hot'], t: 'Ground conditioned air', ref: 'SP.2.2',
        use: 'A ground air-conditioning (preconditioned air) unit connected.',
        phases: [
          ['Before connecting', [['PACK switches', 'OFF'], { caution: 'Packs running with conditioned air connected can be damaged.' }]],
          ['After disconnecting', [['PACK switches', 'As needed']]],
        ],
      },
      {
        id: 'isopack', t: 'Isolated pack during engine start', ref: 'SP.2.2',
        use: 'Better cabin air between starting the first and the second engine.',
        phases: [
          ['Start', [
            { caution: 'Moving an engine BLEED switch while a starter is engaged can damage the starter.' },
            ['Engine No. 2', 'Start'],
            { when: 'Engine No. 2 stabilized:' },
            ['ISOLATION VALVE switch', 'CLOSE'], ['Right PACK switch', 'AUTO'], ['Duct pressure', 'Stabilized'],
            ['Engine No. 1', 'Start'],
            { when: 'Engine No. 1 stabilized:' },
            ['ISOLATION VALVE switch', 'AUTO'],
          ]],
        ],
      },
      {
        id: 'man', t: 'Manual pressurization', ref: 'SP.2.3–4',
        use: 'Flying the outflow valve by hand (pressurization mode MAN).',
        phases: [
          ['Set up', [
            { caution: 'The outflow valve answers MAN at once; full travel can take up to 20 seconds.' },
            ['Pressurization mode selector', 'MAN'], { note: 'MANUAL light on.' },
            ['CABIN / FLIGHT ALTITUDE placard', 'Check — choose the cabin altitude'],
          ]],
          ['Changing cabin altitude', [
            { when: 'Cabin higher: outflow valve switch OPEN, momentarily — valve moves right, cabin climbs, differential pressure falls.' },
            { when: 'Cabin lower: outflow valve switch CLOSE, momentarily — valve moves left, cabin descends, differential pressure rises.' },
          ]],
          ['Descent', [
            { note: 'Move the thrust levers slowly to avoid pressure bumps.' },
            ['Outflow valve switch', 'CLOSE, momentarily, now and then'], { note: 'Cabin altitude comes down as the airplane descends.' },
            { when: 'Before the landing pattern:' },
            ['Outflow valve', 'Slowly full OPEN'], ['Differential pressure', 'Zero'],
          ]],
        ],
      },
      {
        id: 'landalt', t: 'Landing altitude: alternate or high airport', ref: 'SP.2.4',
        use: 'Diverting, or landing above 6,000 ft (up to 8,400 ft) in automatic mode.',
        phases: [
          ['Alternate airport', [{ when: 'At top of descent:' }, ['LAND ALT indicator', 'Reset to the new field elevation']]],
          ['Field above 6,000 ft (to 8,400 ft)', [{ when: 'Before takeoff:' }, ['LAND ALT indicator', '6,000 ft'], { when: 'At initial descent:' }, ['LAND ALT indicator', 'Destination field elevation']]],
        ],
      },
      {
        id: 'tests', t: 'Tests: wing–body overheat, manual mode', ref: 'SP.2.1–3', minor: true,
        use: 'Maintenance-style checks on the ground.',
        phases: [
          ['Wing–body overheat test', [
            ['Wing–body OVHT TEST switch', 'Push, hold at least 5 s'],
            { note: 'Both WING–BODY OVERHEAT lights, MASTER CAUTION and AIR COND come on.' },
            ['Wing–body OVHT TEST switch', 'Release'], { note: 'All of them go out.' },
          ]],
          ['Manual mode test', [
            ['PACK switches', 'OFF'], ['Pressurization mode selector', 'MAN'], { note: 'AUTO FAIL and ALTN out; MANUAL on.' },
            ['Outflow valve switch', 'CLOSE — indicator moves toward CLOSE'], ['Outflow valve switch', 'OPEN — indicator moves toward OPEN'],
            ['Pressurization mode selector', 'AUTO — indicator moves toward OPEN; MANUAL out'],
          ]],
        ],
      },
    ],
  },
  {
    n: 3, t: 'Anti-ice, Rain', procs: [
      {
        id: 'csff', tags: ['csff', 'arrCold'], t: 'Cold-soaked fuel frost (CSFF)', ref: 'SP.3.1–3',
        use: 'Frost on the wing from cold fuel after a long flight with a big fuel load. The adverse weather advisor (SP.16 tab) works out the de-icing answer from these rules.',
        phases: [
          ['Inspect', [
            ['Lower and upper wing surfaces', 'Check'],
            { note: 'Frost or ice under the wing outboard of measuring stick 4 suggests frost on top too; how far outboard it reaches shows how far it extends on top.' },
          ]],
          ['Lower wing', [
            { when: 'Takeoff allowed with CSFF on the lower wing when all of these hold:' },
            { note: 'OAT +4 °C or warmer · no precipitation or visible moisture (rain, snow, drizzle, fog under 1 mile) · tank fuel −16 °C or warmer · leading edges, control and tab surfaces, winglets and balance panel cavities free of snow, ice and frost.' },
            { when: 'If not:' },
            { note: 'Light frost up to 3 mm on the lower wing is still allowed, with the same surfaces clear. More than 3 mm: de-ice all the wings.' },
          ]],
          ['Upper wing', [
            { when: 'Airplanes with the CSFF area marked on the wing:' },
            { note: 'Allowed only inside the marked lines, with the same three conditions and nothing on the leading edges or controls. Otherwise de-ice the upper wing.' },
            { when: 'Airplanes without the marked area:' },
            { note: 'No frost on the upper wing — de-ice the wings.' },
          ]],
        ],
        rel: [[12, 'gxfer'], [16, null]],
      },
      {
        id: 'ai', t: 'Engine and wing anti-ice', ref: 'SP.3.1',
        use: 'When to use them, and how, is in SP.16 Adverse weather — open its advisor.',
        phases: [], rel: [[16, null]],
      },
      {
        id: 'wh', t: 'Window heat tests', ref: 'SP.3.4–5', minor: true,
        use: 'Overheat and power tests of the window heat system.',
        phases: [
          ['Overheat test', [
            ['WINDOW HEAT switches', 'ON'], ['WINDOW HEAT TEST switch', 'OVHT'],
            { note: 'OVERHEAT lights on; the ON lights go out (or OFF lights come on, by airplane) after about 1 minute; MASTER CAUTION and ANTI-ICE on.' },
            ['WINDOW HEAT switches', 'Reset — OFF, then ON'],
          ]],
          ['Power test (some airplanes)', [
            { note: 'Only when an ON light is out with its switch ON — not when all ON lights are lit.' },
            ['WINDOW HEAT switches', 'ON'], ['WINDOW HEAT TEST switch', 'PWR'],
            { note: 'The controller goes to full power; overheat protection stays.' },
          ]],
        ],
      },
    ],
  },
  {
    n: 7, t: 'Engines, APU', procs: [
      {
        id: 'gndair', tags: ['noApu'], t: 'Engine start with ground air', ref: 'SP.7.4–5',
        use: 'Starting from an external air source, with AC power available.',
        phases: [
          ['Start', [
            { note: 'Engine No. 1 must be started first.' },
            { when: 'When cleared to start:' },
            ['APU BLEED air switch', 'OFF'], ['Engine No. 1', 'Start — normal procedure'],
            { caution: 'WARNING — protect the ground crew: disconnect the external air, then start engine No. 2 with the crossbleed start.' },
          ]],
        ],
        rel: [[7, 'xbleed'], [2, 'cart']],
      },
      {
        id: 'xbleed', tags: ['noApu'], t: 'Engine crossbleed start', ref: 'SP.7.5',
        use: 'Starting the second engine with bleed air from the running one.',
        phases: [
          ['Start', [
            { caution: 'Not during pushback. Make sure the area behind is clear.' },
            ['Engine BLEED air switches', 'ON'], ['APU BLEED air switch', 'OFF'], ['PACK switches', 'OFF'],
            ['ISOLATION VALVE switch', 'AUTO'], ['Thrust lever (running engine)', 'Advance to 30 psi duct pressure'],
            ['Other engine', 'Start — normal procedure, crossbleed air'],
            { when: 'After starter cutout:' }, ['Thrust (both engines)', 'Adjust as needed'],
          ]],
        ],
        rel: [[7, 'gndair']],
      },
      {
        id: 'batstart', tags: ['noApu'], t: 'Battery start', ref: 'SP.7.1–4',
        use: 'No external or APU electrical power yet: battery power, with APU bleed or ground air available.',
        phases: [
          ['Before power', [
            ['Maintenance documents', 'Check'], ['FLIGHT DECK ACCESS SYSTEM switch', 'Guard closed'], ['BATTERY switch', 'Guard closed'],
            ['ELECTRIC HYDRAULIC PUMPS switches', 'OFF'], ['LANDING GEAR lever', 'DN — green lights on, red out'],
            ['Emergency equipment', 'Check'], ['Flight recorder switch', 'Guard closed'], ['Circuit breakers (P6, control stand, P18)', 'Check'],
            { note: 'Interior and exterior inspection as needed, except items needing electrical or hydraulic power. Oxygen pressure sufficient.' },
            ['Overheat and fire protection panel', 'Check (detector NORMAL, FAULT/INOP and OVHT/FIRE tests, extinguisher test)'],
            ['APU switch', 'START (if it is the bleed source)'],
          ]],
          ['Set up (F/O reads, captain does)', [
            ['Oxygen', 'Test and set'], ['CAB/UTIL power switch', 'ON'], ['IFE/PASS seat power switch', 'ON (by airplane)'],
            ['EMERGENCY EXIT LIGHTS switch', 'Guard closed'], ['Passenger signs', 'Set'], ['HYDRAULIC PUMP switches', 'ON'],
            ['Air conditioning panel', 'Packs AUTO or HIGH · engine BLEEDs ON · APU BLEED ON'], ['SPEED BRAKE lever', 'DOWN detent'],
            ['Reverse thrust levers', 'Down'], ['Forward thrust levers', 'Closed'], ['Parking brake', 'Set — chock the wheels if brake pressure has bled down'],
            ['Engine start levers', 'CUTOFF'], ['Papers', 'Aboard'],
          ]],
          ['When cleared to start', [
            ['PACK switches', 'OFF'], ['ANTICOLLISION light switch', 'ON'], ['Ignition select switch', 'IGN-R'],
            ['Engine No. 1', 'Start'], { note: 'Only N1, N2 and oil quantity show until the EECs are powered.' },
            ['GENERATOR 1 switch', 'ON'], ['IRS mode selectors', 'OFF, then NAV — ON DC lights on then out; ALIGN on'],
            ['FMC/CDU', 'Set IRS position'], ['Hydraulic and engine oil quantity', 'Sufficient'],
            { caution: 'WARNING — if engine No. 1 was started with ground air: disconnect it and start No. 2 with the crossbleed start.' },
            ['Engine No. 2', 'Start'], ['GENERATOR 2 switch', 'ON'],
          ]],
          ['Finish', [
            ['Cabin pressurization panel', 'FLT ALT cruise · LAND ALT destination · mode AUTO (ALTN and MANUAL out)'],
            ['PSEU, GPS (and ILS/GLS where fitted) lights', 'Out'], ['SERVICE INTERPHONE switch', 'OFF'],
            ['ENGINE panel', 'REVERSER and ENGINE CONTROL lights out · EEC switches ALTN then ON'],
            ['Oxygen panel', 'Crew pressure checked · PASSENGER OXYGEN guard closed, PASS OXY ON out'],
            ['Landing gear lights', 'Illuminated'], ['Manual gear extension access door', 'Closed'],
            { note: 'Then the normal CDU preflight, preflight, before start and before taxi procedures; BEFORE TAXI checklist; IRS alignment complete.' },
          ]],
        ],
        rel: [[7, 'xbleed'], [7, 'gndair']],
      },
      {
        id: 'n1man', t: 'Manual N1 bugs (no FMC)', ref: 'SP.7.5–6', minor: true,
        use: 'Setting the N1 reference bugs when no FMC is working.',
        phases: [
          ['Set', [
            { note: 'N1 for the phase of flight from Performance – Inflight.' },
            ['N1 SET outer knob', 'BOTH'], ['N1 SET inner knob', 'Set N1'],
            { note: 'The bugs start from the last FMC value, or 104 % if none since power-up. Back to AUTO returns to that value.' },
          ]],
        ],
      },
    ],
  },
  {
    n: 12, t: 'Fuel', procs: [
      {
        id: 'balance', t: 'Fuel balancing', ref: 'SP.12.2–3',
        use: 'Keeping main tanks 1 and 2 within the balance limit.',
        phases: [
          ['First', [
            { caution: 'Engine fuel leak suspected: do the Fuel Leak Engine checklist. IMBAL alert: do the IMBAL checklist.' },
            { note: 'Keep pump pressure to the engines at all times — at high altitude, suction feed can lose thrust or flame out.' },
          ]],
          ['Fuel in the center tank', [
            ['Center tank fuel pump switches', 'OFF'], { note: 'A fuel CONFIG alert may show with fuel in the center tank.' },
            ['Crossfeed selector', 'Open'], ['Fuel pump switches (low tank)', 'OFF'],
            { when: 'When balanced:' }, ['Fuel pump switches (main tank)', 'ON'], ['Center tank fuel pump switches', 'ON'], ['Crossfeed selector', 'Close'],
          ]],
          ['Center tank empty', [
            ['Crossfeed selector', 'Open'], ['Fuel pump switches (low tank)', 'OFF'],
            { when: 'When balanced:' }, ['Fuel pump switches', 'ON'], ['Crossfeed selector', 'Close'],
          ]],
        ],
      },
      {
        id: 'gxfer', tags: ['csff', 'arrCold'], t: 'Ground transfer of fuel', ref: 'SP.12.5–6',
        use: 'Moving fuel from the main (wing) tanks to the center tank on the ground. AC power needed. Cold-soaked fuel in the wing tanks is what frosts the wing (SP.3).',
        phases: [
          ['Before', [
            { note: 'Make sure the FUEL PUMP LOW PRESSURE lights work.' },
            { caution: 'With passengers aboard, keep at least 900 kg in the tank you take fuel from. A pilot or technician monitors from the flight deck.' },
          ]],
          ['Main tanks to center tank', [
            ['Main tank fuel pump switches', 'ON'], ['Crossfeed selector', 'Open'], ['Manual defueling valve', 'Open'],
            ['Center tank fueling valve switch', 'OPEN'], ['Fuel transfer', 'Monitor — center rises, mains fall'],
            { note: 'A FUEL PUMP LOW PRESSURE light comes on: switch that pump OFF.' },
          ]],
          ['When enough is moved', [
            ['Center tank fueling valve switch', 'CLOSED'], ['Manual defueling valve', 'Close'], ['Crossfeed selector', 'Close'],
            ['Main tank fuel pump switches', 'OFF'], ['Main tanks', 'Refill'], ['Refueling and defuel panel access doors', 'Close'],
          ]],
        ],
        rel: [[3, 'csff']],
      },
      {
        id: 'refuel', t: 'Refueling', ref: 'SP.12.4–5', minor: true,
        use: 'Fuel load distribution and refueling without normal power.',
        phases: [
          ['Distribution', [{ note: 'Fill mains 1 and 2 equally until full, then the center tank. Mains must be full if the center tank holds more than 453 kg; with less, part-filled mains are allowed if balance is considered.' }, { note: 'Truck or pit: about 1,136 litres a minute at 50 psi nozzle pressure.' }]],
          ['Battery only (no APU, no external power)', [['Battery switch', 'ON'], { note: 'Normal refueling; limited only by battery life.' }]],
          ['No AC or DC power', [
            ['Fueling hose nozzle', 'On the refueling receptacle'], ['Fueling valves', 'Open the tanks to fill — hold each red override button while fuel flows'],
            { caution: 'No automatic shutoff: do not overfill.' },
          ]],
        ],
      },
      {
        id: 'xfchk', t: 'Crossfeed valve check', ref: 'SP.12.6', minor: true,
        use: 'Checking the crossfeed valve opens and closes.',
        phases: [['Check', [['Crossfeed selector', 'Open — VALVE OPEN bright, then dim'], ['Crossfeed selector', 'Close — VALVE OPEN bright, then out']]]],
      },
      {
        id: 'spar', t: 'Spar fuel shutoff valve check', ref: 'SP.12.1–2', minor: true,
        use: 'Once per flight day unless maintenance has done it (some airplanes; needs regulatory approval). Failed if SPAR VALVE CLOSED does not come on bright.',
        phases: [
          ['With the engines shut down (AC power on)', [
            { note: 'Both engine fire switches in.' }, ['ENGINE START switches', 'AUTO'],
            ['Start lever (first engine)', 'IDLE — wait about 10 s'], ['Start lever (first engine)', 'CUTOFF — SPAR VALVE CLOSED out, bright, then dim'],
            ['Start lever (second engine)', 'IDLE — wait about 10 s'], ['Start lever (second engine)', 'CUTOFF — SPAR VALVE CLOSED out, bright, then dim'],
          ]],
          ['Or during engine start', [['Start lever (each engine)', 'IDLE — SPAR VALVE CLOSED dim, bright, then out']]],
          ['Or during shutdown', [['Start lever (each engine)', 'CUTOFF — SPAR VALVE CLOSED out, bright, then dim']]],
        ],
      },
    ],
  },
];

// ── State: the open procedure and its ticked steps ──
let openId = null;
const done = new Set();

const esc = (s) => String(s).replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[x]);

// ── Related procedures across chapters ──
const CH_NAME = { 16: 'Adverse weather' };
const find = (n, id) => CHAPTERS.find((c) => c.n === n)?.procs.find((p) => p.id === id);

/** Procedures (any chapter) carrying any of these tags: [{ n, id, t, ref }]. */
export function relatedFor(tags, skip = []) {
  const out = [];
  for (const c of CHAPTERS) for (const p of c.procs) {
    if (skip.includes(`${c.n}:${p.id}`)) continue;
    if ((p.tags || []).some((t) => tags.includes(t))) out.push({ n: c.n, id: p.id, t: p.t, ref: p.ref });
  }
  return out;
}

/** A link chip to a procedure, or to a whole chapter (id null). */
export function procLink(n, id) {
  const p = id ? find(n, id) : null;
  const label = p ? p.t : CH_NAME[n] || `Chapter ${n}`;
  return `<button class="wz-chip pr-link" data-sp-proc="${n}:${id || ''}">SP.${n} · ${esc(label)} ›</button>`;
}

/** Open this procedure when its chapter is drawn next. */
export function openProc(id) { if (id) openId = id; }

function relatedHtml(n, p) {
  const seen = new Set([`${n}:${p.id}`]);
  const links = [];
  for (const [rn, rid] of p.rel || []) { const k = `${rn}:${rid || ''}`; if (!seen.has(k)) { seen.add(k); links.push(procLink(rn, rid)); } }
  for (const r of relatedFor(p.tags || [], [...seen])) if (r.n !== n) { seen.add(`${r.n}:${r.id}`); links.push(procLink(r.n, r.id)); }
  return links.length ? `<div class="pr-rel"><span class="wz-g">Related</span>${links.join('')}</div>` : '';
}

function stepHtml(st, key) {
  if (Array.isArray(st)) {
    const on = done.has(key);
    return `<li><button class="pr-step${on ? ' on' : ''}" data-pr-tick="${key}" aria-pressed="${on}"><span class="pr-box">${on ? '✓' : ''}</span><span class="pr-a">${esc(st[0])}</span><span class="pr-dots"></span><span class="pr-b">${esc(st[1])}</span></button></li>`;
  }
  if (st.caution) return `<li class="pr-c"><b>CAUTION</b> ${esc(st.caution)}</li>`;
  if (st.when) return `<li class="pr-w">${esc(st.when)}</li>`;
  return `<li class="pr-n">${esc(st.note)}</li>`;
}

/** The chapter: a list of procedures; the open one shows its steps. */
export function procsHtml(n) {
  const ch = CHAPTERS.find((c) => c.n === n);
  if (!ch) return '';
  const card = (p) => {
    if (!p.phases.length) {
      return `<section class="pr${p.minor ? ' minor' : ''}" id="pr-${p.id}"><div class="pr-head static"><span class="pr-t">${esc(p.t)}</span><span class="qr-ref">${esc(p.ref)}</span></div><p class="pr-use">${esc(p.use)}</p>${relatedHtml(n, p)}</section>`;
    }
    const open = p.id === openId;
    const steps = open ? p.phases.map(([title, list], pi) => `<div class="pr-ph"><div class="wz-g">${esc(title)}</div><ol class="pr-list">${list.map((st, si) => stepHtml(st, `${p.id}:${pi}:${si}`)).join('')}</ol></div>`).join('') : '';
    const total = p.phases.reduce((a, [, l]) => a + l.filter(Array.isArray).length, 0);
    const ticked = [...done].filter((k) => k.startsWith(`${p.id}:`)).length;
    return `<section class="pr${open ? ' open' : ''}${p.minor ? ' minor' : ''}" id="pr-${p.id}">
      <button class="pr-head" data-pr-open="${p.id}" aria-expanded="${open}"><span class="pr-t">${esc(p.t)}</span><span class="qr-ref">${esc(p.ref)}</span></button>
      ${open ? `<p class="pr-use">${esc(p.use)}</p>${steps}${relatedHtml(n, p)}<div class="wz-nav"><span class="wz-hint">${ticked} of ${total} done</span><button class="tag tag-btn wz-mini" data-pr-clear="${p.id}">Clear ticks</button></div>` : `<p class="pr-use">${esc(p.use)}</p>`}
    </section>`;
  };
  const main = ch.procs.filter((p) => !p.minor), minor = ch.procs.filter((p) => p.minor);
  return `<div class="pr-chap no-hl" id="pr-chap">${main.map(card).join('')}${minor.length ? `<details class="sp-ref"${minor.some((p) => p.id === openId) ? ' open' : ''}><summary>Tests and less common <span class="qr-ref">${minor.length}</span></summary>${minor.map(card).join('')}</details>` : ''}</div>`;
}

/** Clicks inside a procedures chapter. Returns true when handled; the caller redraws. */
export function procClick(el) {
  const d = el.dataset;
  if (d.prOpen) { openId = openId === d.prOpen ? null : d.prOpen; return true; }
  if (d.prTick) { if (done.has(d.prTick)) done.delete(d.prTick); else done.add(d.prTick); return true; }
  if (d.prClear) { for (const k of [...done]) if (k.startsWith(`${d.prClear}:`)) done.delete(k); return true; }
  return false;
}
