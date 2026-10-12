// cues.js — "how do you recognise it?" for each memory item and maneuver:
// a drawn card of what you see (lights, fire switches, PFD / ND / engine
// display), hear and feel, plus where to look in the 3D cockpit and, where
// the simulator can show it, a demo that puts the airplane in that state.
// Drawings are our own sketches of the indications, not the real displays.

const esc = (s) => String(s).replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[x]);

// ── Pieces ──
// lamp: lettered face (most panel lights). solid: the glareshield master
// lights, whose whole lens lights up. sub: the small printed second line.
const lamp = (label, color = 'amber') => ({ k: 'lamp', label, color });
const master = (label, color, sub) => ({ k: 'lamp', label, color, solid: true, sub });
const FIREWARN = master('FIRE\nWARN', 'red', 'BELL CUTOUT'), MC = master('MASTER\nCAUTION', 'amber', 'PUSH TO RESET');
const fsw = (label) => ({ k: 'fsw', label });
const pfd = (kind) => ({ k: 'pfd', kind });
const nd = (kind) => ({ k: 'nd', kind });
const du = (kind) => ({ k: 'du', kind });
const gear = () => ({ k: 'gear' });

const RED = '#ff3b30', AMB = '#ffb21e', GRN = '#3df03d', CYN = '#28e3f2', WHT = '#f4f4f4', MAG = '#ff5ad2';

function pfdSvg(kind) {
  let pitch = 0, bank = 0;
  if (kind === 'upHigh') { pitch = 30; bank = 20; }
  if (kind === 'upLow') { pitch = -20; bank = 70; }
  const hy = 80 + pitch * 2.2;
  let extra = '';
  if (kind === 'ra') {
    // Pitch avoidance: red outline below (do not pitch down); VSI: red avoid band, green fly-to band.
    extra += `<path d="M70 104 L150 104 L162 140 L58 140 Z" fill="none" stroke="${RED}" stroke-width="2.5"/>`;
    extra += `<rect x="186" y="84" width="7" height="50" fill="${RED}"/><rect x="186" y="44" width="7" height="38" fill="${GRN}"/>`;
  }
  if (kind === 'pullup') extra += `<rect x="78" y="104" width="64" height="20" fill="#000"/><text x="110" y="119" fill="${RED}" font-size="14" font-weight="700" text-anchor="middle">PULL UP</text>`;
  if (kind === 'windshear') extra += `<rect x="66" y="104" width="88" height="20" fill="#000"/><text x="110" y="119" fill="${RED}" font-size="13" font-weight="700" text-anchor="middle">WINDSHEAR</text>`;
  if (kind === 'ias') extra += `<rect x="2" y="138" width="56" height="16" fill="#000" stroke="${AMB}"/><text x="30" y="150" fill="${AMB}" font-size="8.5" font-weight="700" text-anchor="middle">IAS DISAGREE</text><rect x="162" y="138" width="56" height="16" fill="#000" stroke="${AMB}"/><text x="190" y="150" fill="${AMB}" font-size="8.5" font-weight="700" text-anchor="middle">ALT DISAGREE</text>`;
  if (kind === 'stall') {
    extra += `<rect x="24" y="96" width="10" height="56" fill="${RED}"/><rect x="24" y="96" width="10" height="56" fill="url(#bp)"/><rect x="24" y="74" width="4" height="22" fill="${AMB}"/>`;
    extra += `<rect x="2" y="72" width="22" height="16" fill="#000" stroke="${WHT}"/><text x="13" y="84" fill="${WHT}" font-size="10" font-weight="700" text-anchor="middle">118</text>`;
  }
  if (kind === 'upHigh' || kind === 'upLow') {
    const dir = kind === 'upHigh' ? 1 : -1;     // chevrons point back to the horizon
    for (const y of [40, 56]) extra += `<path d="M96 ${y} L110 ${y + dir * 10} L124 ${y}" fill="none" stroke="${RED}" stroke-width="3" transform="rotate(${-bank} 110 80)"/>`;
  }
  return `<svg viewBox="0 0 220 160" class="cue-svg"><defs><pattern id="bp" width="8" height="8" patternUnits="userSpaceOnUse"><rect width="4" height="8" fill="#000"/></pattern></defs>
    <rect width="220" height="160" fill="#000"/>
    <g clip-path="inset(0)"><svg x="40" y="0" width="140" height="160" viewBox="40 0 140 160"><g transform="rotate(${-bank} 110 80)"><rect x="-100" y="-300" width="420" height="${hy + 300}" fill="#2a7be4"/><rect x="-100" y="${hy}" width="420" height="400" fill="#8a5a2b"/><line x1="-100" y1="${hy}" x2="320" y2="${hy}" stroke="${WHT}" stroke-width="1.5"/></g></svg></g>
    <path d="M86 80 L102 80 L106 86 M134 80 L118 80 L114 86" stroke="#ffd400" stroke-width="3" fill="none"/><rect x="108" y="78" width="4" height="4" fill="#ffd400"/>
    <rect x="0" y="0" width="36" height="160" fill="#3a3f45"/><rect x="184" y="0" width="36" height="160" fill="#3a3f45"/>
    ${extra}</svg>`;
}

function ndSvg(kind) {
  let extra = '';
  if (kind === 'ra' || kind === 'ta') {
    const c = kind === 'ra' ? RED : AMB;
    extra += kind === 'ra' ? `<rect x="122" y="56" width="12" height="12" fill="${c}"/>` : `<circle cx="128" cy="62" r="6.5" fill="${c}"/>`;
    extra += `<text x="128" y="50" fill="${c}" font-size="10" font-weight="700" text-anchor="middle">${kind === 'ra' ? '+02' : '-05'}</text><text x="141" y="67" fill="${c}" font-size="12" font-weight="700">${kind === 'ra' ? '↓' : '↑'}</text>`;
    extra += `<text x="214" y="152" fill="${c}" font-size="12" font-weight="700" text-anchor="end">TRAFFIC</text>`;
  }
  if (kind === 'terrain' || kind === 'cterrain') {
    const c = kind === 'terrain' ? RED : AMB;
    for (let i = 0; i < 26; i++) { const x = 70 + (i * 37) % 80, y = 40 + ((i * 53) % 50); extra += `<circle cx="${x}" cy="${y}" r="2.2" fill="${c}"/>`; }
    extra += `<text x="214" y="152" fill="${c}" font-size="12" font-weight="700" text-anchor="end">TERRAIN</text>`;
  }
  if (kind === 'pws') {
    extra += `<path d="M110 132 L86 46 A90 90 0 0 1 134 46 Z" fill="url(#ws)" stroke="${RED}" stroke-width="1.5"/>`;
    extra += `<text x="214" y="152" fill="${RED}" font-size="12" font-weight="700" text-anchor="end">WINDSHEAR</text>`;
  }
  return `<svg viewBox="0 0 220 160" class="cue-svg"><defs><pattern id="ws" width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="10" fill="${RED}"/><rect x="5" width="5" height="10" fill="#000"/></pattern></defs>
    <rect width="220" height="160" fill="#000"/>
    <path d="M30 132 A80 80 0 0 1 190 132" fill="none" stroke="${WHT}" stroke-width="1.2"/><path d="M70 132 A40 40 0 0 1 150 132" fill="none" stroke="${WHT}" stroke-width="0.8" stroke-dasharray="3 4"/>
    <line x1="110" y1="132" x2="110" y2="46" stroke="${MAG}" stroke-width="1.5"/>
    ${extra}
    <path d="M104 140 L110 126 L116 140 Z" fill="none" stroke="${WHT}" stroke-width="1.8"/></svg>`;
}

// Upper engine display as on the NG: per engine an N1 dial over an EGT dial,
// each a 210° white scale with the swept part shaded, the digital readout
// boxed above and to the right, amber caution and red limit radials, and the
// N1 / EGT labels in cyan between the engines. An exceedance turns the
// pointer, sweep and readout red; ENG FAIL shows amber in the N1 dial.
function duSvg(kind) {
  const P = (cx, cy, r, f) => { const a = (180 + 210 * f) * Math.PI / 180; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; };
  const dial = (cx, cy, f, txt, { amber, red, alarm, fail } = {}) => {
    const r = 23, [x0, y0] = P(cx, cy, r, 0), [x1, y1] = P(cx, cy, r, 1), [xv, yv] = P(cx, cy, r, f);
    const col = alarm ? RED : WHT;
    let g = `<path d="M${cx} ${cy} L${x0} ${y0} A${r} ${r} 0 ${210 * f > 180 ? 1 : 0} 1 ${xv} ${yv} Z" fill="${alarm ? 'rgba(255,59,48,.55)' : 'rgba(200,200,200,.28)'}"/>`;
    g += `<path d="M${x0} ${y0} A${r} ${r} 0 1 1 ${x1} ${y1}" fill="none" stroke="${WHT}" stroke-width="1.6"/>`;
    for (const [v, c] of [[amber, AMB], [red, RED]]) if (v != null) { const [a1, b1] = P(cx, cy, r - 3, v), [a2, b2] = P(cx, cy, r + 5, v); g += `<line x1="${a1}" y1="${b1}" x2="${a2}" y2="${b2}" stroke="${c}" stroke-width="2.4"/>`; }
    g += `<line x1="${cx}" y1="${cy}" x2="${xv}" y2="${yv}" stroke="${col}" stroke-width="2.2"/>`;
    g += `<rect x="${cx + 1}" y="${cy - r - 15}" width="38" height="14" fill="${alarm ? RED : '#000'}" stroke="${alarm ? RED : WHT}" stroke-width="1"/>`;
    g += `<text x="${cx + 37}" y="${cy - r - 4}" fill="${WHT}" font-size="11" font-weight="700" text-anchor="end" font-family="monospace">${txt}</text>`;
    if (fail) g += `<text x="${cx}" y="${cy + 15}" fill="${AMB}" font-size="8.5" font-weight="700" text-anchor="middle">ENG FAIL</text>`;
    return g;
  };
  const E = {
    egt: [[0.58, '68.4', {}], [0.84, '84.1', {}], [0.97, '1004', { alarm: true }], [0.72, '842', {}], 'one engine past the EGT limit'],
    engfail: [[0.17, '18.6', { fail: true }], [0.17, '17.9', { fail: true }], [0.3, '320', {}], [0.29, '311', {}], 'both N1 decaying — ENG FAIL on both'],
    start: [[0.04, '4.2', {}], [0, '0.0', {}], [0.68, '702', {}], [0, '0', {}], 'start: EGT climbing to the start limit'],
  }[kind];
  const [n1a, n1b, ea, eb, cap] = E;
  const N1 = { red: 0.95 }, EG = kind === 'start' ? { red: 0.7 } : { amber: 0.82, red: 0.9 };
  let g = `<text x="8" y="12" fill="${WHT}" font-size="8">TAT ${kind === 'egt' || kind === 'engfail' ? '−32' : '+12'}c</text><text x="212" y="12" fill="${GRN}" font-size="8" text-anchor="end">${kind === 'start' ? '' : 'CRZ'}</text>`;
  g += dial(56, 52, n1a[0], n1a[1], { ...N1, ...n1a[2] }) + dial(150, 52, n1b[0], n1b[1], { ...N1, ...n1b[2] });
  g += dial(56, 124, ea[0], ea[1], { ...EG, ...ea[2] }) + dial(150, 124, eb[0], eb[1], { ...EG, ...eb[2] });
  g += `<text x="103" y="56" fill="${CYN}" font-size="10" text-anchor="middle">N1</text><text x="103" y="128" fill="${CYN}" font-size="10" text-anchor="middle">EGT</text>`;
  g += `<text x="110" y="166" fill="#9aa4ad" font-size="8.5" text-anchor="middle">${cap}</text>`;
  return `<svg viewBox="0 0 220 172" class="cue-svg"><rect width="220" height="172" fill="#000"/>${g}</svg>`;
}

function pieceHtml(p) {
  if (p.k === 'lamp') return `<span class="cue-lamp ${p.color}${p.solid ? ' solid' : ''}">${esc(p.label).replace(/\n/g, '<br>')}${p.sub ? `<small>${esc(p.sub)}</small>` : ''}</span>`;
  if (p.k === 'fsw') return `<span class="cue-fsw"><svg viewBox="0 0 90 70" class="cue-fsw-s"><rect x="39" y="34" width="12" height="26" fill="#2b2f33"/><rect x="20" y="62" width="50" height="6" rx="1" fill="#3a3f45"/><rect x="5" y="6" width="80" height="32" rx="5" fill="${RED}" style="filter:drop-shadow(0 0 6px rgba(255,40,40,.9))"/><rect x="5" y="30" width="80" height="8" rx="3" fill="rgba(0,0,0,.25)"/><text x="45" y="28" fill="#fff" font-size="17" font-weight="800" text-anchor="middle">${esc(p.label)}</text></svg><span class="cue-fsw-l">${p.label === 'APU' ? 'APU' : 'engine'} fire switch lit</span></span>`;
  if (p.k === 'gear') return `<span class="cue-gear">${['NOSE', 'LEFT', 'RIGHT'].map((g) => `<span class="cue-lamp red solid">${g}<br>GEAR</span>`).join('')}</span>`;
  if (p.k === 'pfd') return `<figure class="cue-fig">${pfdSvg(p.kind)}<figcaption>PFD</figcaption></figure>`;
  if (p.k === 'nd') return `<figure class="cue-fig">${ndSvg(p.kind)}<figcaption>ND</figcaption></figure>`;
  if (p.k === 'du') return `<figure class="cue-fig">${duSvg(p.kind)}<figcaption>Engine display</figcaption></figure>`;
  return '';
}

// ── What each item looks, sounds and feels like ──
// see: pieces drawn; hear / feel / notes: short lines; view: cockpit view;
// demo: the simulator state that shows it (fails, scenario, phase).
export const CUES = {
  'Aborted Engine Start': { see: [du('start')], notes: ['EGT rising fast toward the start limit', 'No EGT rise within 10 s of the start lever to IDLE', 'No N1 rotation, or N1 / N2 stop rising (hung start)', 'No oil pressure by the time the engine is at idle'], view: 'center' },
  'Airspeed Unreliable': { see: [pfd('ias')], notes: ['IAS or ALT DISAGREE on the PFDs', 'Speed or altitude that do not fit pitch and thrust', 'Captain, F/O and standby speeds disagree'], hear: ['Stick shaker or overspeed clacker — possibly false'], view: 'capt', demo: { fails: [['instruments', 'capPitot']], phase: 'cruise', label: 'Captain pitot blocked' } },
  'APU FIRE': { see: [fsw('APU'), FIREWARN], hear: ['Fire warning bell', 'On the ground: APU horn in the wheel well'], view: 'pedestal', demo: { fails: [['fire', 'apuFire']], label: 'APU fire' } },
  'CABIN ALTITUDE WARNING or Rapid Depressurization': { see: [lamp('CABIN\nALTITUDE', 'red')], hear: ['Intermittent warning horn'], notes: ['Cabin altitude above 10,000 ft on the cabin altitude indicator'], feel: ['Rapid decompression: bang, fog, cold, ears', 'Passenger masks drop at about 14,000 ft cabin'], view: 'capt' },
  'Emergency Descent': { see: [lamp('CABIN\nALTITUDE', 'red')], notes: ['Cabin altitude keeps climbing after the cabin altitude steps', 'Or any situation needing a rapid descent'], view: 'mcp' },
  'CARGO FIRE (MAIN)': { see: [lamp('MAIN', 'red'), FIREWARN], hear: ['Fire warning bell'], notes: ['MAIN light on the cargo fire panel (main-deck cargo airplanes)'], view: 'pedestal' },
  'ENGINE FIRE or Engine Severe Damage or Separation': { see: [fsw('1'), FIREWARN], hear: ['Fire warning bell'], notes: ['Severe damage: airframe vibration with abnormal engine indications', 'Separation: engine indications lost, airplane yaws'], view: 'pedestal', demo: { fails: [['fire', 'fire1']], label: 'Engine 1 fire' } },
  'Engine Limit or Surge or Stall': { see: [du('egt')], notes: ['EGT, N1 or N2 near or past the red line', 'No or wrong response to the thrust lever'], hear: ['Bangs or abnormal engine noise'], feel: ['Possible airframe vibration; flames reported at the inlet or exhaust'], view: 'center' },
  'ENGINE OVERHEAT': { see: [lamp('ENG 1\nOVERHEAT'), MC, lamp('OVHT/DET')], view: 'pedestal', demo: { fails: [['fire', 'ovht1']], label: 'Engine 1 overheat' } },
  'Loss Of Thrust On Both Engines': { see: [du('engfail')], notes: ['ENG FAIL on both engines', 'Generators off: many lights, displays on standby power', 'No response to the thrust levers'], view: 'center', demo: { fails: [['engines', 'flameout1'], ['engines', 'flameout2']], phase: 'cruise', label: 'Both engines flamed out' } },
  'Runaway Stabilizer': { see: [lamp('STAB OUT\nOF TRIM')], notes: ['Stabilizer trim wheels turning on their own — continuously, or when they should not', 'STAB OUT OF TRIM can light with the autopilot engaged'], feel: ['Column force building up'], view: 'pedestal' },
  'LANDING CONFIGURATION': { see: [gear()], hear: ['Steady warning horn'], notes: ['Gear not down and locked when the flaps or thrust say landing'], view: 'capt' },
  'TAKEOFF CONFIGURATION': { see: [lamp('TAKEOFF\nCONFIG', 'red')], hear: ['Intermittent warning horn as thrust is advanced'], notes: ['Flaps out of the takeoff range, speedbrake not down, parking brake set, or stabilizer trim out of the green band'], view: 'capt' },
  'WARNING HORN (INTERMITTENT) or WARNING LIGHT - CABIN ALTITUDE OR TAKEOFF CONFIGURATION': { see: [lamp('TAKEOFF\nCONFIG', 'red'), lamp('CABIN\nALTITUDE', 'red')], hear: ['Intermittent warning horn'], notes: ['In flight above 10,000 ft: cabin altitude', 'On the ground with thrust advancing: takeoff configuration'], view: 'capt' },
  // Maneuvers
  'Approach to Stall or Stall Recovery': { see: [pfd('stall')], hear: ['Stick shaker'], feel: ['Buffet'], notes: ['Speed in the amber band, toward the red and black minimum speed'], view: 'capt', demo: { scen: 'stall', phase: 'cruise', label: 'Approach to stall' } },
  'Rejected Takeoff': { see: [MC, FIREWARN, du('engfail')], notes: ['Below 80 kt: any item on the reject list', '80 kt to V1: fire or fire warning, engine failure, predictive windshear warning, unsafe or unable to fly', 'Practise it: Cockpit → TAKEOFF MALFUNCTION'], view: 'rto' },
  'GPWS Caution': { see: [nd('cterrain'), lamp('BELOW G/S\nP-INHIBIT')], hear: ['SINK RATE · TERRAIN · DON\'T SINK · TOO LOW FLAPS / GEAR / TERRAIN · GLIDESLOPE · BANK ANGLE · CAUTION TERRAIN'], view: 'capt', demo: { scen: 'gs', phase: 'approach', label: 'Below glideslope' } },
  'GPWS Warning': { see: [pfd('pullup'), nd('terrain')], hear: ['"PULL UP" · "TERRAIN TERRAIN PULL UP"'], view: 'capt', demo: { scen: 'closure', phase: 'cruise', label: 'Terrain closure' } },
  'Traffic Avoidance (TCAS)': { see: [pfd('ra'), nd('ra'), nd('ta')], hear: ['TA: "TRAFFIC, TRAFFIC"', 'RA: "CLIMB, CLIMB" · "DESCEND, DESCEND" · "ADJUST VERTICAL SPEED, ADJUST" · "MONITOR VERTICAL SPEED"', 'End: "CLEAR OF CONFLICT"'], notes: ['RA: red pitch area to avoid on the attitude, red and green bands on the vertical speed', 'ND: amber circle (TA), red square (RA), relative altitude and an arrow if climbing or descending'], view: 'capt', demo: { scen: 'traffic', phase: 'cruise', label: 'Traffic (TA, then RA)' } },
  'Upset Recovery — Nose High': { see: [pfd('upHigh')], notes: ['Pitch above about 25° nose up, or speed falling fast for the attitude', 'Red chevrons point back to the horizon'], view: 'capt' },
  'Upset Recovery — Nose Low': { see: [pfd('upLow')], notes: ['Pitch below about 10° nose down or bank beyond 45°, speed building', 'Red chevrons point back to the horizon'], view: 'capt' },
  'Windshear': { see: [pfd('windshear'), nd('pws')], hear: ['Two-tone siren, "WINDSHEAR, WINDSHEAR, WINDSHEAR"', 'Predictive: "MONITOR RADAR DISPLAY" (caution) · "WINDSHEAR AHEAD" (takeoff) · "GO-AROUND, WINDSHEAR AHEAD" (approach)'], notes: ['Below 1,000 ft: ±15 kt, ±500 fpm, ±5° pitch, 1 dot glideslope, or unusual thrust lever position for a long time'], view: 'capt', demo: { scen: 'windshear', phase: 'approach', label: 'Windshear' } },
};

/** The card for one item, or '' if none. */
export function cueHtml(title) {
  const c = CUES[title];
  if (!c) return '';
  const list = (head, items, cls) => (items?.length ? `<div class="cue-h">${head}</div><ul class="cue-l ${cls}">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
  return `<div class="cue-card">
    <div class="cue-top"><span class="cue-k">INDICATIONS</span><button class="cue-x" data-cue-close aria-label="Close">✕</button></div>
    <div class="cue-t">${esc(title)}</div>
    ${c.see?.length ? `<div class="cue-h">See</div><div class="cue-see">${c.see.map(pieceHtml).join('')}</div>` : ''}
    ${list('Also', c.notes, '')}${list('Hear', c.hear, 'hear')}${list('Feel', c.feel, '')}
    <div class="cue-act"><button class="cue-go" data-cue-cockpit="${esc(title)}">${c.demo ? 'Show in cockpit' : 'Where in cockpit'} ›</button></div>
    <p class="cue-foot">Sketches of the indications, not the real displays.</p>
  </div>`;
}
