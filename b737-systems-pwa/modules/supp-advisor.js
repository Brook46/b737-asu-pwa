// supp-advisor.js — adverse weather for the decision you actually make.
// Step 1: where are you (on the ground, in flight, or arriving). Step 2: only
// the conditions for that place, and the temperature. Step 3: the answers —
// de-icing, anti-ice, run-up, flaps, performance — then the few things to
// know. Each answer links to its SP.16 topic. Study aid: the FCOM governs.

import { SUPPLEMENTARY } from './supplementary.js?v=40';

const esc = (s) => String(s).replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[x]);

const PLACES = [
  ['ground', 'On the ground, before takeoff', [['parked', 'Parked: before engine start or de-icing'], ['taxi', 'Taxi out'], ['takeoff', 'Holding for takeoff']]],
  ['flight', 'In flight', []],
  ['arrival', 'Arriving: the landing destination', []],
];

// ── Step 2 inputs per place ──
const GROUND_C = [
  ['moist', 'Visible moisture now (cloud, fog, rain, snow, sleet)'],
  ['surf', 'Snow, ice or frost on the wing, LE devices or control surfaces'],
  ['frz', 'Freezing rain, freezing drizzle, freezing fog or heavy snow'],
  ['deep', 'Deep slush or standing water (over 13 mm), or dry snow over 102 mm'],
  ['fluid', 'Already protected by de-icing fluid'],
  ['sand', 'Sand or dust'],
];
const FLIGHT_C = [
  ['moist', 'Visible moisture in cloud or precipitation (icing possible)'],
  ['iceSevere', 'Moderate to severe icing that cannot be avoided'],
  ['ici', 'Ice crystal conditions suspected'],
  ['thunder', 'Thunderstorm or convective weather on the route'],
  ['rainHeavy', 'Heavy rain, hail or sleet'],
  ['windshear', 'Windshear reported or suspected'],
];
const ARR_C = [
  ['moist', 'Visible moisture at the destination (icing possible)'],
  ['windshear', 'Windshear reported at the destination'],
  ['sand', 'Sand or dust at the destination'],
  ['atOff', 'Autothrottle off or going off before landing'],
];

// ── The decisions ──
/** Ground: de-icing, anti-ice, run-up, flaps, performance. */
function gIcing(i) {
  return i.oat <= 10 && (i.c.moist || i.c.surf || i.c.contam);   // SP.16.2
}

function groundDecisions(i) {
  const t = i.oat, c = i.c;
  const icing = gIcing(i);
  const dec = [];
  const d = (k, v, s, sp, cls) => dec.push({ k, v, s, sp, cls });
  // De-icing: any snow, ice or frost on the critical surfaces must go first.
  if (c.surf) d('De-icing', 'YES', c.fluid ? 'Snow, ice or frost on the wing: de-ice. Fluid is on, so check the holdover time.' : 'Snow, ice or frost on the wing: de-ice before takeoff.', 'SP.16.2', 'yes');
  else d('De-icing', 'NO', icing ? 'Surfaces clear. Anti-ice is still needed (below).' : t > 10 ? 'Above 10 °C and clear. Nothing to remove.' : 'Surfaces clear. Nothing to remove.', 'SP.16.2', 'no');
  // Engine anti-ice
  if (t > 10) d('Engine anti-ice', 'OFF', 'Above 10 °C: never on.', 'SP.16.5', 'no');
  else if (icing) d('Engine anti-ice', 'ON', 'Switch on as soon as both engines are started. Keep it on for all ground operations.', 'SP.16.5', 'on');
  else d('Engine anti-ice', 'OFF', 'No icing conditions.', 'SP.16.5', 'no');
  // Wing anti-ice
  if (icing && !c.fluid) d('Wing anti-ice', 'ON', 'From engine start until takeoff. It is not a substitute for de-icing.', 'SP.16.5', 'on');
  else if (icing && c.fluid) d('Wing anti-ice', 'NOT NEEDED', 'Fluid protects the wing. Check the holdover time.', 'SP.16.5', 'no');
  else d('Wing anti-ice', 'OFF', 'No icing conditions.', 'SP.16.5', 'no');
  return dec;
}

/** Run-up needed on the ground (for the timer) and the one-line rule. */
function runupRule(i) {
  const t = i.oat, c = i.c;
  if (i.sub === 'parked' || !gIcing(i)) return null;      // run-ups are done taxiing out
  if (c.frz) return { every: 10, text: 'Run-up to 70 % N1 for about 1 s', sp: 'SP.16.6' };
  if (t <= 3) return { every: 30, text: 'Run-up to 70 % N1 for about 30 s', sp: 'SP.16.6' };
  return null;
}

/** The short lines: flaps, takeoff performance, engine start, takeoff run-up. */
function groundItems(i) {
  const t = i.oat, c = i.c, sub = i.sub, out = [];
  const icing = gIcing(i);
  const L = (lvl, s, sp, phases) => { if (!phases || phases.includes(sub)) out.push({ lvl, s, sp }); };
  if (c.soak === '1') L('warn', 'Cold soaked 1 h or more below −40 °C: do not start or motor. Maintenance first.', 'SP.16.4', ['parked']);
  if (c.soak === '3') L('warn', 'Cold soaked 3 h or more below −40 °C: do not start or motor. Starter needs service.', 'SP.16.4', ['parked']);
  if (t < -35) L('caution', 'Below −35 °C: idle 2 min before moving the thrust levers.', 'SP.16.4', ['parked', 'taxi']);
  if (c.sand) L('info', 'Sand: start on GRD and motor 2 min. Taxi at 10 kt, below 40 % N1.', 'SP.16.21', ['parked', 'taxi']);
  if (t > 40) L('caution', 'Above 40 °C: packs or cooling air while powered. Cabin: AUTO COOL, PACKS HIGH.', 'SP.16.19', ['parked', 'taxi']);
  if (c.frz || c.surf || c.deep) L('info', 'Generators: allow up to 5 min for steady power in cold oil.', 'SP.16.6', ['taxi']);
  if (t < 0 && (c.contam || c.deep || c.frz || c.moist || c.surf)) L('warn', 'Taxi out with flaps UP (slush and ice in the flap cavities).', 'SP.16.6', ['taxi']);
  if (c.frz || c.deep) L('info', 'Flaps: check full travel UP → 40 → UP before taxi.', 'SP.16.6', ['taxi']);
  if (icing) L('caution', 'Taxi slowly; minimum thrust; differential thrust to help turns.', 'SP.16.6', ['taxi']);
  if (c.deep) L('warn', 'Deep slush, standing water or dry snow: takeoff not recommended. Wait for the runway to clear.', 'SP.16.1', ['takeoff']);
  else if (c.contam) L('caution', 'Contaminated runway: fixed derate only, no assumed temperature.', 'SP.16.1', ['takeoff']);
  else if (c.wetRwy) L('info', 'Wet runway: reduced thrust allowed; the stopping distance is longer.', 'SP.16.1', ['takeoff']);
  if (icing && !c.deep) L('warn', 'Static run-up before the takeoff roll: 70 % N1, stable.', 'SP.16.10', ['takeoff']);
  if (icing && t <= 3) L('info', 'A 30 s static run-up is strongly recommended at 3 °C or below.', 'SP.16.10', ['takeoff']);
  if (icing && c.deice) L('caution', 'Before de-icing: flaps UP, thrust IDLE, engine and APU BLEED OFF.', 'SP.16.8', ['parked', 'taxi']);
  return out;
}

/** Flight: anti-ice, turbulence, windshear, storms, ICI. */
function flightItems(i) {
  const t = i.oat, c = i.c, turb = i.turb, out = [];
  const L = (lvl, s, sp) => out.push({ lvl, s, sp });
  const icing = t <= 10 && c.moist;
  if (icing) {
    L('warn', 'Engine anti-ice ON before entering icing (not above TAT 10 °C). Exception: climb and cruise below −40 °C SAT.', 'SP.16.10');
    L('caution', 'Wing anti-ice: let ice build, then switch ON. Early ON only when holding.', 'SP.16.12');
    L('warn', 'Holding in icing with flaps extended is prohibited.', 'SP.16.12');
  }
  if (c.iceSevere) {
    L('warn', 'Fan ice: each engine, 80 % N1 for 1 s, then wait 15 s. Vibration 4.0 or more: High Vibration checklist.', 'SP.16.11');
  }
  if (c.ici) L('warn', 'Ice crystals: avoid amber and red returns. If suspected: Ice Crystal Icing checklist.', 'SP.16.31');
  if (turb === 'light') L('info', 'Light to moderate turbulence: belts on, signs ON. Autopilot and autothrottle may stay on.', 'SP.16.27');
  if (turb === 'severe') {
    L('warn', 'Severe turbulence: YAW DAMPER ON, autothrottle off, CWS, ENGINE START FLT.', 'SP.16.28');
    L('caution', 'Speeds: climb 280 kt or .76 M; descent .76 M / 280 / 250 kt, whichever is lower.', 'SP.16.28');
  }
  if (c.rainHeavy) L('warn', 'Heavy rain, hail or sleet: ENGINE START CONT, autothrottle off, slow thrust changes, slower speed.', 'SP.16.20');
  if (c.thunder) L('caution', 'Stay clear of thunderstorm cells and tops with visible moisture.', 'SP.16.20');
  if (c.windshear) L('warn', 'Windshear: if the warning comes on, fly the Windshear Escape Maneuver.', 'SP.16.29');
  return out;
}

/** Arrival: the destination runway and the landing. */
function arrivalItems(i) {
  const t = i.oat, c = i.c, out = [];
  const L = (lvl, s, sp) => out.push({ lvl, s, sp });
  const icing = t <= 10 && (c.moist || c.contam);
  if (c.contam) L('warn', 'Contaminated runway: check the landing performance for the reported surface before committing.', 'Performance');
  else if (c.wetRwy) L('info', 'Wet runway: check landing distance for the wet surface.', 'Performance');
  if (c.windshear) {
    L('warn', 'Windshear: flaps 30, stabilised by 1,000 ft, pick a runway clear of windshear.', 'SP.16.30');
    if (c.atOff) L('caution', 'Autothrottle off: add up to 15 kt airspeed correction.', 'SP.16.30');
  }
  if (icing) {
    L('warn', 'Engine anti-ice ON on taxi-in while icing exists.', 'SP.16.15');
    L('warn', 'After landing in icing: stabiliser trim 5 units.', 'SP.16.15');
    L('warn', 'Flaps not below 15 until the flap areas are checked clear.', 'SP.16.14');
  }
  if (c.sand) L('caution', 'Sand: autobrakes; use reverse thrust sparingly; APU bleed rather than engine bleed on taxi-in.', 'SP.16.25');
  if (t < 0) L('caution', 'Cold: set MDA / DA at the corrected minimums (cold correction below).', 'SP.16.13');
  return out;
}

const SPQ = (sp) => (sp && sp.startsWith('SP.') ? sp : '');

/** Everything for the current answers. */
export function decide(i) {
  if (i.oat == null || Number.isNaN(i.oat)) return null;
  if (i.grp === 'ground') {
    const runup = runupRule(i);
    return { decisions: groundDecisions(i), runup, items: groundItems(i) };
  }
  if (i.grp === 'flight') return { decisions: [], runup: null, items: flightItems(i) };
  return { decisions: [], runup: null, items: arrivalItems(i) };
}

// ── Wizard state ──
const DEF = { step: 1, grp: 'ground', sub: 'parked', oat: null, c: {}, soak: 'none', turb: 'none', lastRunup: null };
const W = { ...DEF };

function topicIndex(sp) {
  return SUPPLEMENTARY[0].topics.findIndex((tp) => tp.ref.includes(sp));
}

const LVL = { warn: 'WARNING', caution: 'CAUTION', info: 'NOTE' };
const condList = (list, name) => list.map(([k, n]) => `<label class="wz-c"><input type="checkbox" name="${name}" value="${k}"> ${esc(n)}</label>`).join('');

export function wizardHtml() {
  Object.assign(W, DEF, { c: {}, lastRunup: null });
  return `<section class="wz" id="wz">
    <div class="wz-top"><span class="wz-title">Adverse weather</span><span class="wz-count" id="wz-count">Step 1 of 3</span></div>
    <div class="wz-step" data-step="1">
      <div class="wz-g">Where are you?</div>
      ${PLACES.map(([k, n]) => `<label class="wz-c wz-big"><input type="radio" name="grp" value="${k}"${k === 'ground' ? ' checked' : ''}> ${esc(n)}</label>`).join('')}
      <div id="wz-sub" class="wz-sub"><div class="wz-g">Which ground phase?</div>
        ${PLACES[0][2].map(([k, n]) => `<label class="wz-c"><input type="radio" name="sub" value="${k}"${k === 'parked' ? ' checked' : ''}> ${esc(n)}</label>`).join('')}
      </div>
      <div class="wz-nav"><button class="tag tag-btn" data-wz="next">Next ›</button></div>
    </div>
    <div class="wz-step" data-step="2" hidden>
      <label class="wz-q">Temperature, °C<span class="qr-ref">OAT on the ground · TAT in flight · at the destination when arriving</span>
        <input id="wz-t" type="number" step="1" inputmode="numeric" class="wz-in" placeholder="e.g. -3"></label>
      <div class="wz-g" data-for="ground">Ground conditions now</div>
      <div class="wz-cs" data-for="ground">${condList(GROUND_C, 'wcg')}
        <div class="wz-g">Runway and taxiway</div>
        <label class="wz-c"><input type="radio" name="rwy" value="dry" checked> Dry</label>
        <label class="wz-c"><input type="radio" name="rwy" value="wet"> Wet</label>
        <label class="wz-c"><input type="radio" name="rwy" value="contam"> Contaminated: slush, snow, standing water or ice</label>
        <div class="wz-g">Engine cold soak</div>
        ${[['none', 'None'], ['1', '1 h or more below −40 °C'], ['3', '3 h or more below −40 °C']].map(([k, n]) => `<label class="wz-c"><input type="radio" name="soak" value="${k}"${k === 'none' ? ' checked' : ''}> ${n}</label>`).join('')}
      </div>
      <div class="wz-cs" data-for="flight" hidden>${condList(FLIGHT_C, 'wcf')}
        <div class="wz-g">Turbulence</div>
        ${[['none', 'None'], ['light', 'Light to moderate'], ['severe', 'Severe']].map(([k, n]) => `<label class="wz-c"><input type="radio" name="turb" value="${k}"${k === 'none' ? ' checked' : ''}> ${n}</label>`).join('')}
      </div>
      <div class="wz-cs" data-for="arrival" hidden>${condList(ARR_C, 'wca')}
        <div class="wz-g">Destination runway</div>
        <label class="wz-c"><input type="radio" name="rwyA" value="dry" checked> Dry</label>
        <label class="wz-c"><input type="radio" name="rwyA" value="wet"> Wet</label>
        <label class="wz-c"><input type="radio" name="rwyA" value="contam"> Contaminated: slush, snow, standing water or ice</label>
      </div>
      <div class="wz-nav"><button class="tag tag-btn" data-wz="back">‹ Back</button><button class="tag tag-btn" data-wz="next">Next ›</button></div>
    </div>
    <div class="wz-step" data-step="3" hidden>
      <div id="wz-res" class="wz-res"></div>
      <div class="wz-nav"><button class="tag tag-btn" data-wz="back">‹ Back</button><button class="tag tag-btn" data-wz="reset">Start over</button></div>
    </div>
  </section>`;
}

function show(step) {
  W.step = step;
  const root = document.getElementById('wz');
  if (!root) return;
  root.querySelectorAll('.wz-step').forEach((el) => { el.hidden = Number(el.dataset.step) !== step; });
  root.querySelector('#wz-count').textContent = `Step ${step} of 3`;
}

function readAll(root) {
  W.grp = root.querySelector('input[name=grp]:checked')?.value || 'ground';
  W.sub = root.querySelector('input[name=sub]:checked')?.value || 'parked';
  root.querySelector('#wz-sub').hidden = W.grp !== 'ground';
  root.querySelectorAll('.wz-cs, [data-for]').forEach((el) => { if (el.dataset.for) el.hidden = el.dataset.for !== W.grp; });
  const v = root.querySelector('#wz-t').value;
  W.oat = v === '' ? null : Number(v);
  const grpName = { ground: 'wcg', flight: 'wcf', arrival: 'wca' }[W.grp];
  W.c = {};
  for (const i of root.querySelectorAll(`input[name=${grpName}]`)) if (i.checked) W.c[i.value] = true;
  const rwyName = W.grp === 'arrival' ? 'rwyA' : 'rwy';
  W.rwy = root.querySelector(`input[name=${rwyName}]:checked`)?.value || 'dry';
  W.c.contam = W.grp !== 'flight' && W.rwy === 'contam';
  W.c.wetRwy = W.grp !== 'flight' && W.rwy === 'wet';
  W.soak = root.querySelector('input[name=soak]:checked')?.value || 'none';
  W.turb = root.querySelector('input[name=turb]:checked')?.value || 'none';
  W.c.soak = W.soak;
}

/** Buttons: next / back / reset / runup. */
export function wizardAct(action) {
  const root = document.getElementById('wz');
  if (!root) return;
  if (action === 'next') {
    readAll(root);
    if (W.step === 1) { show(2); return; }
    if (W.step === 2) {
      if (W.oat == null) { root.querySelector('#wz-t').focus(); return; }
      show(3); refreshWizard(); return;
    }
  } else if (action === 'back') {
    show(Math.max(1, W.step - 1));
  } else if (action === 'reset') {
    Object.assign(W, { ...DEF, c: {}, lastRunup: null });
    root.querySelector('#wz-t').value = '';
    root.querySelectorAll('input[type=checkbox]').forEach((i) => { i.checked = false; });
    root.querySelector('input[name=grp][value=ground]').checked = true;
    root.querySelector('input[name=sub][value=parked]').checked = true;
    show(1);
  } else if (action === 'runup') {
    W.lastRunup = Date.now();
    refreshWizard();
  }
}

const clock = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

/** The answers for the current inputs, with the run-up timer. */
export function refreshWizard() {
  const root = document.getElementById('wz');
  if (!root) return;
  readAll(root);
  const res = decide(W);
  const out = root.querySelector('#wz-res');
  if (!res) { out.innerHTML = '<p class="wz-none">Enter the temperature.</p>'; return; }
  const place = { ground: 'On the ground', flight: 'In flight', arrival: 'Arriving' }[W.grp];
  const ref = (sp) => { const k = topicIndex(SPQ(sp)); return sp ? (k >= 0 ? `<button class="wz-sp" data-sp-go="16-${k}">${esc(sp)}</button>` : `<span class="qr-ref">${esc(sp)}</span>`) : ''; };
  let html = `<div class="wz-h">${place} · ${W.oat} °C</div>`;
  if (res.decisions.length) {
    html += `<div class="wz-dec">${res.decisions.map((x) => `<div class="wz-d ${x.cls}"><span class="wz-k">${esc(x.k)}</span><span class="wz-v">${esc(x.v)}</span><span class="wz-s">${esc(x.s)} ${ref(x.sp)}</span></div>`).join('')}</div>`;
  }
  if (res.runup) {
    const due = W.lastRunup ? new Date(W.lastRunup + res.runup.every * 60000) : null;
    html += `<div class="wz-d runup"><span class="wz-k">Run-up</span><span class="wz-v">${esc(res.runup.text)}</span><span class="wz-s">Repeat at least every ${res.runup.every} min. ${ref(res.runup.sp)}</span>
      <div class="wz-rt"><button class="tag tag-btn" data-wz="runup">Run-up done now</button>${due ? ` <span class="wz-due">Done ${clock(W.lastRunup)} · next by <b>${clock(due.getTime())}</b></span>` : ' <span class="wz-due">Not done yet</span>'}</div></div>`;
  }
  if (res.items.length) {
    html += `<div class="wz-g">Also</div><ul class="wz-list">${res.items.map((a) => `<li class="wz-r ${a.lvl}"><span class="wz-l">${LVL[a.lvl]}</span> ${esc(a.s)} ${ref(a.sp)}</li>`).join('')}</ul>`;
  } else if (!res.decisions.length && !res.runup) {
    html += '<p class="wz-none">Nothing extra for these conditions — normal procedures.</p>';
  }
  out.innerHTML = html;
}

// ── Cold temperature altitude correction (worked) ──
const NUM = (s) => Number(String(s).replace('−', '-').replace('°C', '').trim());

/**
 * The correction for one minimum altitude, worked as steps. unit: 'ft' | 'm'.
 * Temperature takes the next colder table row, height the next higher column
 * (the conservative reading of the table).
 */
export function coldCorrection({ temp, minAlt, refElev, unit }) {
  const tb = SUPPLEMENTARY[0].tables[unit === 'm' ? 1 : 0];
  const heads = tb.head.map(Number);
  const rows = tb.rows.map(([lbl, vals]) => ({ t: NUM(lbl), vals }));
  const steps = [];
  if ([temp, minAlt, refElev].some((x) => x == null || Number.isNaN(x))) return { steps, error: 'Enter the temperature, the minimum altitude and the reference elevation.' };
  const u = unit === 'm' ? 'm' : 'ft';
  if (temp >= 0) return { steps: ['Above 0 °C: no correction needed.'], corr: 0 };
  if (temp < -50) return { steps, error: 'Below −50 °C is outside the table: use the FCOM table.' };
  const h = minAlt - refElev;
  steps.push(`Height above the reference source: ${minAlt} − ${refElev} = ${h} ${u}`);
  if (h <= 0) return { steps, corr: 0, corrected: minAlt, mcp: roundUp100(minAlt, unit) };
  const row = rows.filter((r) => r.t <= temp).sort((a, b) => b.t - a.t)[0] || rows[rows.length - 1];
  steps.push(`Temperature row: ${row.t} °C (next colder)`);
  const last = heads[heads.length - 1];
  let corr;
  if (h > last) {
    corr = row.vals[heads.length - 1] * (h / last);
    steps.push(`Above ${last} ${u}: linear extrapolation from the ${last} ${u} figure`);
  } else {
    const ci = heads.findIndex((x) => x >= h);
    corr = row.vals[ci];
    steps.push(`Height column: ${heads[ci]} ${u} (next higher) → correction ${corr} ${u}`);
  }
  corr = Math.round(corr);
  const corrected = minAlt + corr;
  steps.push(`Corrected altitude: ${minAlt} + ${corr} = ${corrected} ${u}`);
  return { steps, corr, corrected, mcp: roundUp100(corrected, unit) };
}

// The MCP altitude is always in feet: metres convert, then round up to 100 ft.
function roundUp100(v, unit) {
  const ft = unit === 'm' ? v * 3.28084 : v;
  return Math.ceil(ft / 100) * 100;
}

export function coldHtml() {
  return `<details class="wz-cold" id="wz-cold"><summary>Cold temperature altitude correction <span class="qr-ref">SP.16.13–14</span></summary>
    <div class="wz-cold-in">
      <label class="wz-q">Airport temperature, °C<input id="ct-t" type="number" step="1" class="wz-in"></label>
      <label class="wz-q">Published minimum altitude<input id="ct-min" type="number" step="10" class="wz-in"></label>
      <label class="wz-q">Reference source elevation<input id="ct-ref" type="number" step="10" class="wz-in"></label>
      <label class="wz-q">Units<select id="ct-u" class="wz-in"><option value="ft">feet</option><option value="m">metres</option></select></label>
      <div id="ct-out" class="wz-res"></div>
      <details class="wz-work"><summary>Working</summary><ol id="ct-steps"></ol></details>
    </div></details>`;
}

export function refreshCold() {
  const g = (id) => document.getElementById(id)?.value ?? '';
  const num = (s) => (s === '' ? null : Number(s));
  const cc = coldCorrection({ temp: num(g('ct-t')), minAlt: num(g('ct-min')), refElev: num(g('ct-ref')), unit: g('ct-u') });
  const out = document.getElementById('ct-out');
  if (!out) return;
  const steps = document.getElementById('ct-steps');
  if (cc.error) { out.innerHTML = `<span class="wz-none">${esc(cc.error)}</span>`; steps.innerHTML = ''; return; }
  steps.innerHTML = cc.steps.map((s) => `<li>${esc(s)}</li>`).join('');
  out.innerHTML = cc.mcp != null ? `Set MCP altitude <b>${cc.mcp} ft</b>${cc.corr ? ` · correction +${cc.corr} ${g('ct-u')}` : ''}` : '';
}
