// supp-advisor.js — adverse weather, step by step (SP.16): temperature, then
// conditions, then phase of flight. Shows one short line per action that
// applies; the full text is the SP.16 topic it links to. Plus the cold
// temperature altitude correction, worked step by step. Study aid: the FCOM governs.

import { SUPPLEMENTARY } from './supplementary.js?v=39';

const PHASES = [['preflight', 'Preflight'], ['taxi', 'Taxi & de-ice'], ['takeoff', 'Takeoff'], ['flight', 'Flight'],
  ['approach', 'Approach'], ['landing', 'Landing'], ['secure', 'Secure']];

const CONDS = [
  ['Ground', [
    ['moist', 'Visible moisture (cloud, fog, rain, snow, sleet, ice crystals)'],
    ['surf', 'Ice, snow, slush or standing water on the surface'],
    ['wetRwy', 'Wet runway'],
    ['rwyC', 'Contaminated runway (slush, snow, standing water, ice)'],
    ['deepSlush', 'Deep slush, wet snow, standing water or dry snow'],
    ['freezeRain', 'Freezing rain, drizzle, fog or heavy snow'],
    ['deice', 'De-icing or anti-icing in progress'],
    ['fluid', 'Protected by Type II / IV fluid'],
    ['sand', 'Sand or dust'],
    ['unatt', 'Left unattended or overnight'],
  ]],
  ['Flight', [
    ['rainHeavy', 'Moderate to heavy rain, hail or sleet'],
    ['thunder', 'Thunderstorm on the route'],
    ['windshear', 'Windshear suspected or reported'],
    ['iceSevere', 'Severe icing that cannot be avoided'],
    ['ici', 'Ice crystal conditions suspected'],
    ['atOff', 'Autothrottle off or going off before landing'],
    ['turb', 'Turbulence (light, or severe)'],
  ]],
];

const SOAK = [['none', 'No'], ['1', '1 h or more below −40 °C'], ['3', '3 h or more below −40 °C']];

// Each rule: phases, level, the short line, and the SP.16 topic it links to.
// A rule can carry a test (c) to run on the inputs.
function rules(i) {
  const t = i.oat, c = i.c, soak = i.soak, turb = i.turb;
  const icing = t <= 10 && (c.moist || c.surf);      // SP.16.2
  const aiOk = t <= 10;                               // SP.16.5
  const aiNeeded = icing && aiOk;
  const frz = t < 0;
  const hot = t > 40;
  const R = [];
  const r = (ph, lvl, s, sp) => R.push({ ph, lvl, s, sp });
  // Preflight
  if (icing || c.surf) r(['preflight'], 'warn', 'Clear snow, ice and frost from leading edges, controls and upper wing', 'SP.16.2');
  if (icing || c.surf) r(['preflight'], 'warn', 'Pitot probes and static ports clear of snow and ice', 'SP.16.2');
  if (icing) r(['preflight'], 'warn', 'PROBE HEAT ON (F/O); probe heat lights out', 'SP.16.3');
  if (t > 10 && (c.moist || c.surf || c.deice)) r(['preflight', 'taxi'], 'caution', 'Above 10 °C: no engine or wing anti-ice', 'SP.16.5');
  if (c.sand) r(['preflight'], 'info', 'Sand: clean the windshield (no wipers); clear probes, ram inlets and outflow valve', 'SP.16.21');
  if (soak === '1') r(['preflight'], 'warn', 'Cold soaked: do not start or motor the engine (maintenance first)', 'SP.16.4');
  if (soak === '3') r(['preflight'], 'warn', 'Cold soaked 3 h or more: do not start or motor; starter needs service', 'SP.16.4');
  if (t < -35) r(['preflight'], 'caution', 'Below −35 °C: idle 2 min before moving the thrust levers', 'SP.16.4');
  if (c.sand) r(['preflight'], 'info', 'Sand: start on GRD and motor 2 min to clear contaminants', 'SP.16.21');
  if (hot) r(['preflight'], 'info', 'Above 40 °C: packs or cooling air while electrically powered', 'SP.16.19');
  // Taxi & de-ice
  if (aiNeeded) r(['taxi'], 'warn', 'ENGINE ANTI-ICE ON after both engines start; keep on for ground ops', 'SP.16.5');
  if (icing && aiOk) r(['taxi'], 'warn', 'WING ANTI-ICE ON from engine start to takeoff (not a substitute for de-icing)', 'SP.16.5');
  if (c.surf || icing) r(['taxi'], 'info', 'Generators: allow up to 5 min for steady power in cold oil', 'SP.16.6');
  if (frz && (c.surf || c.freezeRain || c.moist)) r(['taxi'], 'caution', 'Flight controls: higher forces; watch flaps and LE devices move', 'SP.16.6');
  if (frz && (c.surf || c.freezeRain || c.moist)) r(['taxi'], 'info', 'Flaps: check full travel UP → 40 → UP', 'SP.16.6');
  if (frz && (c.surf || c.freezeRain || c.moist)) r(['taxi'], 'warn', 'Taxi out with flaps UP (slush and ice in flap cavities)', 'SP.16.6');
  if (icing || c.surf) r(['taxi'], 'caution', 'Taxi slowly; minimum thrust; differential thrust for turns', 'SP.16.6');
  if (c.deice) r(['taxi'], 'caution', 'Deep de-icing fluid: minimum thrust (compressor stall)', 'SP.16.6');
  if (aiNeeded && t <= 3) r(['taxi'], 'warn', 'Run-up to 70 % N1 for about 30 s, at least every 30 min', 'SP.16.6');
  if (c.freezeRain && aiNeeded) r(['taxi'], 'warn', 'Run-up to 70 % N1 for about 1 s, at least every 10 min', 'SP.16.6');
  if (c.deice) r(['taxi'], 'warn', 'De-icing: FLAPS UP, IDLE, stab in green band, engine and APU BLEED OFF', 'SP.16.8');
  if (c.deice) r(['taxi'], 'info', 'After de-icing: wait 1 min, engine BLEED ON; recheck flaps and controls', 'SP.16.8');
  if (hot) r(['taxi'], 'caution', 'Cabin hot: AUTO COOL; PACKS HIGH if still hot', 'SP.16.19');
  if (c.sand) r(['taxi'], 'caution', 'Sand: 10 kt ground speed, below 40 % N1, no heavy braking', 'SP.16.23');
  // Takeoff
  if (c.rwyC) r(['takeoff'], 'warn', 'Contaminated runway: fixed derate only, no assumed temperature', 'SP.16.1');
  else if (c.wetRwy) r(['takeoff'], 'caution', 'Wet runway: reduced thrust allowed, longer stopping distance', 'SP.16.1');
  if (c.deepSlush) r(['takeoff'], 'warn', 'Takeoff not recommended: slush or standing water over 13 mm, dry snow over 102 mm', 'SP.16.1');
  if (c.deice || icing) r(['takeoff'], 'caution', 'Takeoff flaps set; extend now if held for ice or de-icing (LE FLAPS EXT lit)', 'SP.16.9');
  if (aiNeeded) r(['takeoff'], 'warn', 'Static run-up to 70 % N1 and stable before the roll', 'SP.16.10');
  if (c.thunder || c.windshear) r(['takeoff'], 'caution', 'Windshear precautions: full thrust, flaps 5/10/15, longest clear runway', 'SP.16.29');
  if (c.windshear) r(['takeoff'], 'warn', 'Windshear confirmed: delay the takeoff', 'SP.16.29');
  // Flight
  if (icing) r(['flight'], 'warn', 'Engine anti-ice ON before entering icing; not above TAT 10 °C', 'SP.16.10');
  if (icing) r(['flight'], 'caution', 'Wing anti-ice: let ice build first, or ON early only when holding', 'SP.16.12');
  if (icing) r(['flight', 'approach'], 'warn', 'Holding in icing with flaps extended is prohibited', 'SP.16.12');
  if (icing) r(['flight'], 'caution', 'Above about FL350 wing anti-ice can trip the bleed', 'SP.16.12');
  if (c.iceSevere) r(['flight'], 'warn', 'Fan ice: each engine, 80 % N1 for 1 s, then wait 15 s', 'SP.16.11');
  if (c.iceSevere) r(['flight'], 'warn', 'Vibration 4.0 or more after reducing thrust: High Vibration checklist', 'SP.16.11');
  if (c.ici) r(['flight'], 'warn', 'Ice crystals: avoid amber and red returns; Ice Crystal Icing checklist', 'SP.16.31');
  if (turb === 'light') r(['flight'], 'info', 'Light to moderate turbulence: belts on, signs ON', 'SP.16.27');
  if (turb === 'severe') r(['flight'], 'warn', 'Severe turbulence: YAW DAMPER ON, autothrottle off, CWS, ENGINE START FLT', 'SP.16.28');
  if (turb === 'severe') r(['flight'], 'caution', 'Severe turbulence speeds: climb 280 kt / .76 M; descent .76 M / 280 / 250 kt', 'SP.16.28');
  if (c.rainHeavy) r(['flight'], 'warn', 'Heavy rain, hail or sleet: ENGINE START CONT, autothrottle off, slow thrust changes', 'SP.16.20');
  if (c.thunder) r(['flight'], 'caution', 'Stay clear of thunderstorm cells and tops with visible moisture', 'SP.16.20');
  if (c.windshear) r(['flight', 'approach'], 'warn', 'Windshear: if the warning comes on, fly the Windshear Escape Maneuver', 'SP.16.29');
  if (frz) r(['flight', 'approach'], 'caution', 'Cold: correct the minimum altitudes (cold correction below)', 'SP.16.13');
  // Approach
  if (c.thunder || c.windshear) r(['approach'], 'caution', 'Windshear: flaps 30, stable by 1,000 ft, clear runway', 'SP.16.30');
  if (c.windshear && c.atOff) r(['approach'], 'caution', 'Autothrottle off: add up to 15 kt airspeed correction', 'SP.16.30');
  if (c.sand) r(['approach'], 'info', 'Sand: no-engine-bleed landing if operations permit', 'SP.16.25');
  if (frz) r(['approach'], 'info', 'Cold: set MDA / DA at the corrected minimums', 'SP.16.13');
  // Landing
  if (icing || c.surf || c.rwyC) r(['landing'], 'info', 'Normal procedures and reference speeds', 'SP.16.14');
  if (c.sand) r(['landing'], 'caution', 'Sand: autobrakes; reverse thrust sparingly', 'SP.16.25');
  if (hot) r(['landing'], 'caution', 'Brakes overheat: extend the gear early; Brake Cooling Schedule', 'SP.16.19');
  if (icing || c.surf || c.rwyC) r(['landing'], 'warn', 'Icing or contamination: do not retract flaps below 15 until clear', 'SP.16.14');
  if (icing || c.surf || c.rwyC) r(['landing'], 'warn', 'After landing in icing: stabiliser trim 5 units', 'SP.16.15');
  if (aiOk && (icing || c.surf)) r(['landing'], 'warn', 'Engine anti-ice ON on taxi-in while icing exists', 'SP.16.15');
  // Secure
  if (frz || c.rwyC) r(['secure'], 'caution', 'Attended, warm air wanted: APU, PACKS AUTO, ISOLATION OPEN, MAN, outflow OPEN', 'SP.16.17');
  if (c.unatt) r(['secure'], 'warn', 'Unattended or overnight: MAN, outflow valve CLOSE; chocks; parking brake off', 'SP.16.17');
  if (t < -18) r(['secure'], 'caution', 'Below −18 °C: remove batteries and store them above −18 °C', 'SP.16.18');
  if (c.sand) r(['secure'], 'caution', 'Sand: PACKS OFF, MAN, outflow valve CLOSE', 'SP.16.25');
  return R;
}

/** The short lines that apply to this phase, most urgent first. */
export function advise(i) {
  if (i.oat == null || Number.isNaN(i.oat)) return [];
  const order = { warn: 0, caution: 1, info: 2 };
  return rules(i).filter((x) => x.ph.includes(i.phase)).sort((a, b) => order[a.lvl] - order[b.lvl]);
}

// ── Wizard state ──
const W = { step: 1, oat: null, c: {}, soak: 'none', turb: 'none', phase: 'preflight' };

function topicIndex(sp) {
  return SUPPLEMENTARY[0].topics.findIndex((tp) => tp.ref.includes(sp));
}

const esc = (s) => String(s).replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[x]);
const LVL = { warn: 'WARNING', caution: 'CAUTION', info: 'NOTE' };

export function wizardHtml() {
  Object.assign(W, { step: 1, oat: null, c: {}, soak: 'none', turb: 'none', phase: 'preflight' });
  return `<section class="wz" id="wz">
    <div class="wz-top"><span class="wz-title">Adverse weather</span><span class="wz-count" id="wz-count">Step 1 of 3</span></div>
    <div class="wz-step" data-step="1">
      <label class="wz-q">Temperature, °C<span class="qr-ref">OAT on the ground · TAT in flight</span>
        <input id="wz-t" type="number" step="1" inputmode="numeric" class="wz-in" placeholder="e.g. 2"></label>
      <div class="wz-nav"><button class="tag tag-btn" data-wz="next">Next ›</button></div>
    </div>
    <div class="wz-step" data-step="2" hidden>
      <details class="wz-drop"><summary>Conditions <span id="wz-nc" class="qr-ref">none</span></summary>
        ${CONDS.map(([g, list]) => `<div class="wz-g">${g}</div>${list.map(([k, n]) => `<label class="wz-c"><input type="checkbox" name="wc" value="${k}"> ${esc(n)}</label>`).join('')}`).join('')}
        <div class="wz-g">Engine start</div>${SOAK.map(([k, n]) => `<label class="wz-c"><input type="radio" name="wsoak" value="${k}"${k === 'none' ? ' checked' : ''}> ${esc(n)}</label>`).join('')}
        <div class="wz-g">Turbulence</div>${[['none', 'None'], ['light', 'Light to moderate'], ['severe', 'Severe']].map(([k, n]) => `<label class="wz-c"><input type="radio" name="wturb" value="${k}"${k === 'none' ? ' checked' : ''}> ${n}</label>`).join('')}
      </details>
      <div class="wz-nav"><button class="tag tag-btn" data-wz="back">‹ Back</button><button class="tag tag-btn" data-wz="next">Next ›</button></div>
    </div>
    <div class="wz-step" data-step="3" hidden>
      <label class="wz-q">Phase of flight<select id="wz-ph" class="wz-in">${PHASES.map(([k, n]) => `<option value="${k}">${n}</option>`).join('')}</select></label>
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

/** Buttons: next / back / reset. */
export function wizardAct(action) {
  const root = document.getElementById('wz');
  if (!root) return;
  if (action === 'next') {
    if (W.step === 1) {
      const v = root.querySelector('#wz-t').value;
      if (v === '') { root.querySelector('#wz-t').focus(); return; }
      W.oat = Number(v);
    }
    if (W.step === 2) readConds(root);
    if (W.step < 3) show(W.step + 1);
    if (W.step === 3) refreshWizard();
  } else if (action === 'back') {
    show(Math.max(1, W.step - 1));
  } else if (action === 'reset') {
    Object.assign(W, { oat: null, c: {}, soak: 'none', turb: 'none', phase: 'preflight' });
    root.querySelector('#wz-t').value = '';
    root.querySelectorAll('input[name=wc]').forEach((i) => { i.checked = false; });
    root.querySelector('#wz-ph').value = 'preflight';
    root.querySelector('#wz-nc').textContent = 'none';
    show(1);
  }
}

function readConds(root) {
  W.c = Object.fromEntries([...root.querySelectorAll('input[name=wc]')].map((i) => [i.value, i.checked]));
  W.soak = root.querySelector('input[name=wsoak]:checked')?.value || 'none';
  W.turb = root.querySelector('input[name=wturb]:checked')?.value || 'none';
  const n = Object.values(W.c).filter(Boolean).length;
  root.querySelector('#wz-nc').textContent = n ? `${n} selected` : 'none';
}

/** The result for the current phase: short lines, each linked to its SP.16 topic. */
export function refreshWizard() {
  const root = document.getElementById('wz');
  if (!root) return;
  readConds(root);
  W.phase = root.querySelector('#wz-ph').value;
  const acts = advise({ oat: W.oat, phase: W.phase, c: W.c, soak: W.soak, turb: W.turb });
  const name = PHASES.find((p) => p[0] === W.phase)?.[1] || W.phase;
  const head = `<div class="wz-h">${esc(name)} · ${W.oat} °C</div>`;
  const list = acts.length
    ? `<ul class="wz-list">${acts.map((a) => {
        const k = topicIndex(a.sp);
        return `<li class="wz-r ${a.lvl}"><span class="wz-l">${LVL[a.lvl]}</span> ${esc(a.s)} ${k >= 0 ? `<button class="wz-sp" data-sp-go="16-${k}">${esc(a.sp)}</button>` : `<span class="qr-ref">${esc(a.sp)}</span>`}</li>`;
      }).join('')}</ul>`
    : '<p class="wz-none">Nothing extra for these conditions — normal procedures.</p>';
  root.querySelector('#wz-res').innerHTML = head + list;
}

// ── Cold temperature altitude correction ──
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
  if (temp >= 0) return { steps: [`Above 0 °C: no correction needed.`], corr: 0 };
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
