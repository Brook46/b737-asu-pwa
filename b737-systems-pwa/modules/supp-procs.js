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
        id: 'neb', t: 'No engine bleed takeoff and landing', ref: 'SP.2.5–6',
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
        id: 'unpress', t: 'Unpressurized takeoff and landing', ref: 'SP.2.4–5',
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
        id: 'cart', t: 'External air cart', ref: 'SP.2.1–2',
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
        id: 'pca', t: 'Ground conditioned air', ref: 'SP.2.2',
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
];

// ── State: the open procedure and its ticked steps ──
let openId = null;
const done = new Set();

const esc = (s) => String(s).replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[x]);

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
    const open = p.id === openId;
    const steps = open ? p.phases.map(([title, list], pi) => `<div class="pr-ph"><div class="wz-g">${esc(title)}</div><ol class="pr-list">${list.map((st, si) => stepHtml(st, `${p.id}:${pi}:${si}`)).join('')}</ol></div>`).join('') : '';
    const total = p.phases.reduce((a, [, l]) => a + l.filter(Array.isArray).length, 0);
    const ticked = [...done].filter((k) => k.startsWith(`${p.id}:`)).length;
    return `<section class="pr${open ? ' open' : ''}${p.minor ? ' minor' : ''}">
      <button class="pr-head" data-pr-open="${p.id}" aria-expanded="${open}"><span class="pr-t">${esc(p.t)}</span><span class="qr-ref">${esc(p.ref)}</span></button>
      ${open ? `<p class="pr-use">${esc(p.use)}</p>${steps}<div class="wz-nav"><span class="wz-hint">${ticked} of ${total} done</span><button class="tag tag-btn wz-mini" data-pr-clear="${p.id}">Clear ticks</button></div>` : `<p class="pr-use">${esc(p.use)}</p>`}
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
