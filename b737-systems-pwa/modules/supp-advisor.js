// supp-advisor.js — adverse weather for the decision you actually make.
// Step 1: where are you (on the ground, in flight, or arriving). Step 2: only
// the conditions for that place, and the temperature. Step 3: the answers —
// de-icing, anti-ice, run-up, flaps, performance — then the few things to
// know. Each answer links to its SP.16 topic. Study aid: the FCOM governs.

import { SUPPLEMENTARY } from './supplementary.js?v=43';

const esc = (s) => String(s).replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[x]);

const PLACES_UNUSED = [
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
  if (c.surf) d('De-icing', 'YES', c.fluid ? 'Snow, ice or frost on the wing: de-ice with Type II or IV fluid, then check the holdover time.' : 'Snow, ice or frost on the wing: de-ice before takeoff.', 'SP.16.2', 'yes');
  else if (c.wingFrost) d('De-icing', 'NO', 'Light frost (up to 3 mm) on the lower wing from cold fuel is allowed for takeoff. Upper surfaces must be clear.', 'SP.16.2', 'no');
  else d('De-icing', 'NO', icing ? 'Surfaces clear. Anti-ice is still needed (below).' : t > 10 ? 'Above 10 °C and clear. Nothing to remove.' : 'Surfaces clear. Nothing to remove.', 'SP.16.2', 'no');
  // Engine anti-ice
  if (t > 10) d('Engine anti-ice', 'OFF', 'Above 10 °C: never on.', 'SP.16.5', 'no');
  else if (icing) d('Engine anti-ice', 'ON', 'Switch on as soon as both engines are started. Keep it on for all ground operations.', 'SP.16.5', 'on');
  else d('Engine anti-ice', 'OFF', 'No icing conditions.', 'SP.16.5', 'no');
  // Wing anti-ice
  // Wing anti-ice is for the ground unless Type II or IV fluid protects the airplane (SP.16.5).
  if (c.fluid) d('Wing anti-ice', 'OFF', 'Type II or IV fluid protects the wing: wing anti-ice stays off. Check the holdover time.', 'SP.16.5', 'no');
  else if (icing) d('Wing anti-ice', 'ON', 'From engine start until takeoff. It is not a substitute for de-icing.', 'SP.16.5', 'on');
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
  if (c.surf) L('caution', 'De-icing: flaps UP, thrust IDLE, engine and APU BLEED OFF; after, BLEED ON and check flaps.', 'SP.16.8', ['parked', 'taxi']);
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

// ── The questions, one at a time: each answer leads to the next. ──
const A = {};            // answers
let H = [];              // answered keys, for Back
let OPT = null;          // an optional question opened from the result

const Q = {
  place: { t: 'Where are you?', opts: [['ground', 'On the ground'], ['flight', 'In flight'], ['arrival', 'Arriving at the destination']] },
  phase: { t: 'Which ground phase?', opts: [['parked', 'Parked: before engine start or de-icing'], ['taxi', 'Taxi out'], ['takeoff', 'Holding for takeoff']] },
  oat: { t: 'Temperature, °C', num: true, hint: 'OAT on the ground · TAT in flight · at the destination when arriving' },
  moist: { t: 'Visible moisture now? (cloud, fog, rain, snow, sleet)', yn: true },
  surf: { t: 'Snow, ice or frost on the upper wing, LE devices, controls or winglets?', yn: true },
  fluid: { t: 'Will the airplane be de-iced or anti-iced with Type II or IV fluid?', yn: true },
  rwy: { t: 'Runway and taxiway', opts: [['dry', 'Dry'], ['wet', 'Wet'], ['contam', 'Contaminated: slush, snow, standing water or ice']] },
  deep: { t: 'Deep slush or standing water over 13 mm, or dry snow over 102 mm?', yn: true },
  frz: { t: 'Freezing rain, freezing drizzle, freezing fog or heavy snow?', yn: true },
  sand: { t: 'Sand or dust?', yn: true },
  iceSevere: { t: 'Moderate to severe icing that cannot be avoided?', yn: true },
  turb: { t: 'Turbulence', opts: [['none', 'None'], ['light', 'Light to moderate'], ['severe', 'Severe']] },
  windshear: { t: 'Windshear reported or suspected?', yn: true },
  rain: { t: 'Heavy rain, hail or sleet?', yn: true },
  thunder: { t: 'Thunderstorm on the route?', yn: true },
  ici: { t: 'Ice crystal conditions suspected?', yn: true },
  atOff: { t: 'Autothrottle off, or going off before landing?', yn: true },
  // Optional, from the result
  soak: { t: 'Engine cold soak: how long below −40 °C?', opts: [['none', 'Not cold soaked'], ['1', '1 h or more'], ['3', '3 h or more']], opt: true },
  wingFrost: { t: 'Wing cold soak: only light frost (up to 3 mm) on the lower wing, from cold fuel?', yn: true, opt: true },
};

/** The next question for the answers so far, or null when the answers are complete. */
function nextKey() {
  if (A.place == null) return 'place';
  if (OPT) return OPT;
  if (A.place === 'ground') {
    if (A.phase == null) return 'phase';
    if (A.oat == null) return 'oat';
    if (A.moist == null) return 'moist';
    if (A.surf == null) return 'surf';
    if ((A.surf || A.moist) && A.fluid == null) return 'fluid';
    if (A.rwy == null) return 'rwy';
    if (A.rwy === 'contam' && A.deep == null) return 'deep';
    if ((A.moist || A.rwy === 'contam') && A.frz == null) return 'frz';
    if (A.sand == null) return 'sand';
    return null;
  }
  if (A.place === 'flight') {
    if (A.oat == null) return 'oat';
    if (A.moist == null) return 'moist';
    if (A.moist && A.oat <= 10 && A.iceSevere == null) return 'iceSevere';
    if (A.turb == null) return 'turb';
    if (A.windshear == null) return 'windshear';
    if (A.rain == null) return 'rain';
    if (A.thunder == null) return 'thunder';
    if (A.oat < 0 && A.ici == null) return 'ici';
    return null;
  }
  if (A.oat == null) return 'oat';
  if (A.moist == null) return 'moist';
  if (A.rwy == null) return 'rwy';
  if (A.rwy === 'contam' && A.deep == null) return 'deep';
  if (A.windshear == null) return 'windshear';
  if (A.windshear && A.atOff == null) return 'atOff';
  if (A.sand == null) return 'sand';
  return null;
}

function setAnswer(key, v) {
  A[key] = v;
  H.push(key);
}

function clearAnswers() { for (const k of Object.keys(A)) delete A[k]; H = []; OPT = null; }

const inputs = () => ({
  grp: A.place, sub: A.phase, oat: A.oat ?? null,
  turb: A.turb || 'none',
  c: {
    moist: !!A.moist, surf: !!A.surf, fluid: !!A.fluid, wingFrost: !!A.wingFrost,
    contam: A.rwy === 'contam', wetRwy: A.rwy === 'wet', deep: !!A.deep, frz: !!A.frz, sand: !!A.sand,
    windshear: !!A.windshear, atOff: !!A.atOff, iceSevere: !!A.iceSevere, ici: !!A.ici,
    rainHeavy: !!A.rain, thunder: !!A.thunder, soak: A.soak || 'none',
  },
});

function questionHtml(key) {
  const q = Q[key];
  let body = '';
  if (q.num) body = `<input id="wz-t" type="number" step="1" inputmode="numeric" class="wz-in" placeholder="e.g. -3" data-wz-num="oat"><div class="wz-hint">${q.hint} · press Enter</div>`;
  else if (q.yn) body = `<div class="wz-btns"><button class="tag tag-btn" data-wz-ans="${key}|yes">Yes</button><button class="tag tag-btn" data-wz-ans="${key}|no">No</button></div>`;
  else body = `<div class="wz-btns">${q.opts.map(([v, n]) => `<button class="tag tag-btn" data-wz-ans="${key}|${v}">${esc(n)}</button>`).join('')}</div>`;
  return `<div class="wz-qq"><div class="wz-qt">${esc(q.t)}</div>${body}</div>`;
}

export function wizardHtml() {
  clearAnswers();
  return `<section class="wz" id="wz">
    <div class="wz-top"><span class="wz-title">Adverse weather</span><button class="tag tag-btn" data-wz="back" id="wz-back" hidden>‹ Back</button></div>
    <div id="wz-q">${questionHtml(nextKey())}</div>
    <div id="wz-res" class="wz-res"></div>
    <div class="wz-nav"><button class="tag tag-btn" data-wz="reset">Start over</button></div>
  </section>`;
}

const LVL = { warn: 'WARNING', caution: 'CAUTION', info: 'NOTE' };

// The SP.16 topic an answer links to (by its reference, e.g. SP.16.5).
function topicIndex(sp) {
  return SUPPLEMENTARY[0].topics.findIndex((tp) => tp.ref.includes(sp));
}
function resultHtml() {
  const res = decide(inputs());
  const place = { ground: 'On the ground', flight: 'In flight', arrival: 'Arriving' }[A.place];
  const ref = (sp) => { const k = topicIndex(SPQ(sp)); return sp ? (k >= 0 ? `<button class="wz-sp" data-sp-go="16-${k}">${esc(sp)}</button>` : `<span class="qr-ref">${esc(sp)}</span>`) : ''; };
  let html = `<div class="wz-h">${place}${A.phase ? ` · ${{ parked: 'parked', taxi: 'taxi out', takeoff: 'holding for takeoff' }[A.phase]}` : ''} · ${A.oat} °C</div>`;
  if (res.decisions.length) {
    html += `<div class="wz-dec">${res.decisions.map((x) => `<div class="wz-d ${x.cls}"><span class="wz-k">${esc(x.k)}</span><span class="wz-v">${esc(x.v)}</span><span class="wz-s">${esc(x.s)} ${ref(x.sp)}</span></div>`).join('')}</div>`;
  }
  if (res.runup) {
    const due = runT ? new Date(runT + res.runup.every * 60000) : null;
    html += `<div class="wz-d runup"><span class="wz-k">Run-up</span><span class="wz-v">${esc(res.runup.text)}</span><span class="wz-s">Repeat at least every ${res.runup.every} min. ${ref(res.runup.sp)}</span>
      <div class="wz-rt"><button class="tag tag-btn" data-wz="runup">Run-up done now</button>${due ? ` <span class="wz-due">Done ${clock(runT)} · next by <b>${clock(due.getTime())}</b></span>` : ' <span class="wz-due">Not done yet</span>'}</div></div>`;
  }
  if (res.items.length) html += `<div class="wz-g">Also</div><ul class="wz-list">${res.items.map((a) => `<li class="wz-r ${a.lvl}"><span class="wz-l">${LVL[a.lvl]}</span> ${esc(a.s)} ${ref(a.sp)}</li>`).join('')}</ul>`;
  else if (!res.decisions.length && !res.runup) html += '<p class="wz-none">Nothing extra for these conditions — normal procedures.</p>';
  if (A.place === 'ground') {
    html += `<div class="wz-g">Check if it applies (optional)</div><div class="wz-btns">
      <button class="tag tag-btn" data-wz-opt="soak">Engine cold soak ›</button>
      <button class="tag tag-btn" data-wz-opt="wingFrost">Wing cold soak ›</button></div>`;
  }
  return html;
}

const clock = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
let runT = null;

/** Draw the current question, or the result once the answers are complete. */
function draw() {
  const root = document.getElementById('wz');
  if (!root) return;
  const key = nextKey();
  const back = root.querySelector('#wz-back');
  if (back) back.hidden = H.length === 0;
  const qEl = root.querySelector('#wz-q'), rEl = root.querySelector('#wz-res');
  if (key) {
    qEl.innerHTML = questionHtml(key);
    rEl.innerHTML = '';
    const t = qEl.querySelector('#wz-t');
    if (t) t.focus();
  } else {
    qEl.innerHTML = '';
    rEl.innerHTML = resultHtml();
  }
}

/** Answer a question (buttons), or the temperature (Enter). */
export function wizardAnswer(key, value) {
  if (key === 'place') { clearAnswers(); setAnswer('place', value); draw(); return; }
  if (key === 'phase') { setAnswer('phase', value); draw(); return; }
  if (key === 'oat') { setAnswer('oat', Number(value)); draw(); return; }
  if (key === 'rwy') { setAnswer('rwy', value); draw(); return; }
  if (key === 'turb') { setAnswer('turb', value); draw(); return; }
  if (key === 'soak') { setAnswer('soak', value); OPT = null; draw(); return; }
  if (key === 'wingFrost') { setAnswer('wingFrost', value === 'yes'); OPT = null; draw(); return; }
  setAnswer(key, value === 'yes');
  if (OPT === key) OPT = null;
  draw();
}

/** Start over, back one answer, or open an optional question, or take a run-up. */
export function wizardAct(action, arg) {
  if (action === 'reset') { clearAnswers(); runT = null; draw(); return; }
  if (action === 'back') {
    const k = H.pop();
    if (k) { delete A[k]; if (k === 'place') clearAnswers(); }
    OPT = null; draw(); return;
  }
  if (action === 'opt') { OPT = arg; draw(); return; }
  if (action === 'runup') { runT = Date.now(); draw(); return; }
}

/** Refresh after typing (no redraw of the question). */
export function refreshWizard() { /* answers are set on press/Enter */ }

// Buttons inside the wizard. Called from the sheet's click handler.
export function wizardClick(el) {
  if (el.dataset.wzAns) { const [k, v] = el.dataset.wzAns.split('|'); wizardAnswer(k, v); return true; }
  if (el.dataset.wzOpt) { wizardAct('opt', el.dataset.wzOpt); return true; }
  return false;
}

// Enter in the temperature box.
export function wizardKey(e) {
  if (e.key === 'Enter' && e.target.dataset?.wzNum === 'oat' && e.target.value !== '') { wizardAnswer('oat', e.target.value); }
}

// ── Cold temperature altitude correction (worked) ──
// The same table for every altitude: height above the altimeter reference
// source (the airport the QNH is from), temperature row, height column.
const NUM = (s) => Number(String(s).replace('−', '-').replace('°C', '').trim());

/**
 * One altitude, corrected. Temperature takes the next colder table row,
 * height the next higher column (the conservative reading of the table).
 * unit: 'ft' | 'm'. Returns steps, the correction and the corrected altitude.
 */
export function coldCorrection({ temp, minAlt, refElev, unit }) {
  const tb = SUPPLEMENTARY[0].tables[unit === 'm' ? 1 : 0];
  const heads = tb.head.map(Number);
  const rows = tb.rows.map(([lbl, vals]) => ({ t: NUM(lbl), vals }));
  const steps = [];
  const u = unit === 'm' ? 'm' : 'ft';
  if (temp >= 0) return { steps: ['Above 0 °C: no correction.'], corr: 0, corrected: minAlt };
  if (temp < -50) return { steps, error: 'Below −50 °C is outside the table: use the FCOM table.' };
  const h = minAlt - refElev;
  steps.push(`Height above the reference source: ${minAlt} − ${refElev} = ${h} ${u}`);
  if (h <= 0) return { steps, corr: 0, corrected: minAlt };
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
    steps.push(`Height column: ${heads[ci]} ${u} (next higher) → correction ${Math.round(corr)} ${u}`);
  }
  corr = Math.round(corr);
  const corrected = minAlt + corr;
  steps.push(`Corrected: ${minAlt} + ${corr} = ${corrected} ${u}`);
  return { steps, corr, corrected };
}

// MCP altitudes are set in feet, to the next 100 ft above the corrected value.
const mcpFt = (v, unit) => Math.ceil((unit === 'm' ? v * 3.28084 : v) / 100) * 100;

/** Every altitude the approach needs, corrected, and where it is set. */
export function coldSet({ temp, refElev, unit, minAlt, mda, missed }) {
  const out = [];
  const add = (label, pub, where, mode) => {
    if (pub == null || Number.isNaN(pub)) return;
    const cc = coldCorrection({ temp, minAlt: pub, refElev, unit });
    if (cc.error) { out.push({ label, error: cc.error }); return; }
    const value = mode === 'mcp' ? mcpFt(cc.corrected, unit) : cc.corrected;
    out.push({ label, pub, corr: cc.corr, corrected: cc.corrected, value, where, unit, steps: cc.steps, mode });
  };
  add('Minimum altitude (segment, en route or departure)', minAlt, 'MCP ALT (next 100 ft above)', 'mcp');
  add('MDA / DA (approach minimum)', mda, 'FMC approach minimums, and the altimeter minimum', 'exact');
  add('Missed approach altitude', missed, 'FMC missed approach altitude and MCP ALT (next 100 ft above)', 'mcp');
  return out;
}

export function coldHtml() {
  return `<details class="wz-cold" id="wz-cold"><summary>Cold temperature altitude correction <span class="qr-ref">SP.16.13–14</span></summary>
    <div class="wz-cold-in">
      <label class="wz-q">Airport temperature, °C<input id="ct-t" type="number" step="1" class="wz-in"></label>
      <label class="wz-q">Altimeter reference elevation (the airport the QNH is from)<input id="ct-ref" type="number" step="10" class="wz-in"></label>
      <label class="wz-q">Units<select id="ct-u" class="wz-in"><option value="ft">feet</option><option value="m">metres</option></select></label>
      <div class="wz-cold-alt"><div class="wz-g">Published altitudes (fill in what applies)</div>
        <label class="wz-q">Minimum altitude for the segment<input id="ct-min" type="number" step="10" class="wz-in"></label>
        <label class="wz-q">MDA / DA<input id="ct-mda" type="number" step="10" class="wz-in"></label>
        <label class="wz-q">Missed approach altitude<input id="ct-missed" type="number" step="10" class="wz-in"></label>
      </div>
      <div id="ct-out" class="wz-res"></div>
      <details class="wz-work"><summary>Working</summary><div id="ct-steps"></div></details>
    </div></details>`;
}

export function refreshCold() {
  const g = (id) => document.getElementById(id)?.value ?? '';
  const num = (s) => (s === '' ? null : Number(s));
  const out = document.getElementById('ct-out'), work = document.getElementById('ct-steps');
  if (!out) return;
  const unit = g('ct-u');
  const lines = coldSet({ temp: num(g('ct-t')), refElev: num(g('ct-ref')), unit, minAlt: num(g('ct-min')), mda: num(g('ct-mda')), missed: num(g('ct-missed')) });
  if (num(g('ct-t')) == null || num(g('ct-ref')) == null) { out.innerHTML = '<span class="wz-none">Enter the airport temperature and the reference elevation.</span>'; work.innerHTML = ''; return; }
  if (!lines.length) { out.innerHTML = '<span class="wz-none">Enter at least one published altitude.</span>'; work.innerHTML = ''; return; }
  out.innerHTML = lines.map((l) => l.error
    ? `<div class="wz-set"><span class="wz-none">${esc(l.label)}: ${esc(l.error)}</span></div>`
    : `<div class="wz-set"><div class="wz-sl">${esc(l.label)}</div>
        <div class="wz-sv">${l.corr ? `${l.pub} → <b>${l.value} ${l.mode === 'mcp' ? 'ft' : unit}</b>` : `<b>${l.value} ${l.mode === 'mcp' ? 'ft' : unit}</b> (no correction)`}</div>
        <div class="wz-sw">Set: ${esc(l.where)}</div></div>`).join('') +
    '<div class="wz-none">Do not correct the altimeter setting. Advise ATC of the corrections.</div>';
  work.innerHTML = lines.filter((l) => !l.error).map((l) => `<div class="wz-wk"><b>${esc(l.label)}</b><ol>${l.steps.map((x) => `<li>${esc(x)}</li>`).join('')}</ol></div>`).join('');
}
