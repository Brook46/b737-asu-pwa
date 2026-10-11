// supp-advisor.js — "what do I do?" for adverse weather (SP.16). You give the
// temperature, the phase and the conditions; it lists only the actions that
// apply to them, each cited to its SP section. Plus the cold temperature
// altitude correction, worked step by step. Study aid: the FCOM governs.

import { SUPPLEMENTARY } from './supplementary.js?v=38';

const PHASES = [['preflight', 'Preflight'], ['taxi', 'Taxi & de-ice'], ['takeoff', 'Takeoff'], ['flight', 'Flight'],
  ['approach', 'Approach'], ['landing', 'Landing'], ['secure', 'Secure']];

const CONDS = [
  ['Ground', [
    ['moist', 'Visible moisture (cloud, fog ≤ 1 SM, rain, snow, sleet, ice crystals)'],
    ['surf', 'Ice, snow, slush or standing water on ramp, taxiway or runway'],
    ['wetRwy', 'Wet runway'],
    ['rwyC', 'Contaminated runway: slush, snow, standing water or ice'],
    ['deepSlush', 'Deep: slush / wet snow / standing water over 13 mm, or dry snow over 102 mm'],
    ['freezeRain', 'Freezing rain, freezing drizzle, freezing fog or heavy snow'],
    ['deice', 'De-icing or anti-icing being done now'],
    ['fluid', 'Airplane protected by Type II or IV fluid (approved programme)'],
    ['sand', 'Sand or dust'],
    ['unatt', 'Airplane will be left unattended or overnight'],
  ]],
  ['Flight & approach', [
    ['rainHeavy', 'Moderate to heavy rain, hail or sleet'],
    ['thunder', 'Thunderstorm or convective weather on the route'],
    ['windshear', 'Windshear suspected or reported'],
    ['iceSevere', 'Moderate to severe icing in flight, and it cannot be avoided'],
    ['ici', 'Ice crystal conditions suspected (IMC near convective weather)'],
    ['atOff', 'Autothrottle off, or going off before landing'],
  ]],
];

const SOAK = [['none', 'None'], ['1', 'Ambient below −40 °C for 1 h or more'], ['3', 'Ambient below −40 °C for 3 h or more']];
const TURB = [['none', 'None'], ['light', 'Light to moderate'], ['severe', 'Severe']];

/** The actions for one set of inputs: [{ phase, lvl, text, ref }]. */
export function advise(inp) {
  const t = inp.oat, c = inp.c || {}, soak = inp.soak || 'none', turb = inp.turb || 'none';
  if (t == null || Number.isNaN(t)) return [{ phase: inp.phase, lvl: 'info', text: 'Enter the temperature to see what applies.', ref: '' }];
  const icing = t <= 10 && (c.moist || c.surf);          // SP.16.2
  const aiOk = t <= 10;                                   // anti-ice allowed (SP.16.5)
  const aiNeeded = icing && aiOk;
  const frz = t < 0;
  const precipCold = c.moist && frz;
  const out = [];
  const R = (phases, lvl, text, ref) => { if (phases.includes(inp.phase)) out.push({ phase: inp.phase, lvl, text, ref }); };

  // ── Preflight ──
  R(['preflight'], 'warn', 'Exterior: leading-edge devices, control surfaces, tabs, upper wing, winglets and balance-panel cavities clear of snow, ice and frost. Light frost up to 3 mm on the lower wing (from cold fuel) is allowed for takeoff.', 'SP.16.2');
  R(['preflight'], 'warn', 'Pitot probes and static ports clear of snow and ice — refreezing run-off can foul the static ports even when they look clear.', 'SP.16.2');
  R(['preflight'], 'warn', 'PROBE HEAT switches ON (F/O). All probe heat lights out.', 'SP.16.3');
  R(['preflight'], 'info', 'Outflow valve, air inlets and exits, and engine inlets clear of snow and ice (fan free to rotate). APU inlet door and cooling air inlet clear before APU start.', 'SP.16.2–3');
  R(['preflight'], 'caution', 'Above 10 °C: do not use engine or wing anti-ice. Icing procedures do not apply.', 'SP.16.2, SP.16.5');
  R(['preflight'], 'info', 'Sand and dust: wash the windshield, then wipe with a soft cloth (no wipers). Wings and controls free of sand; probes, ram air inlets, outflow valve and pressure relief valves clear; fuel tank vents clear; gear struts and doors clear.', 'SP.16.21');
  R(['preflight'], 'warn', 'Cold soaked for 1 h or more below −40 °C: do not start or motor the engine. Maintenance heats the hydro-mechanical unit first.', 'SP.16.4');
  if (soak === '3') R(['preflight'], 'warn', 'Cold soaked for 3 h or more below −40 °C: do not start or motor the engine. Maintenance services the starter.', 'SP.16.4');
  R(['preflight'], 'caution', 'Ambient below −35 °C: idle the engine for 2 minutes before changing thrust lever position. If OIL FILTER BYPASS lights, stay at idle until oil pressure is in range; shut down if it stays high once oil temperature has settled.', 'SP.16.4');
  R(['preflight'], 'info', 'Sand: use a filtered ground cart for start air if available. ENGINE START switch GRD, motor the engine for 2 minutes to clear contaminants.', 'SP.16.21');
  R(['preflight'], 'info', 'Hot ground (above 40 °C): run the packs or supply cooling air while electrically powered. Plug the cooling in right after shutdown.', 'SP.16.19');

  // ── Taxi & de-ice ──
  R(['taxi'], 'warn', 'ENGINE ANTI-ICE switches ON as soon as both engines are started; keep on for all ground operations while icing exists or is expected. Do not rely on airframe icing cues.', 'SP.16.5');
  R(['taxi'], 'warn', 'WING ANTI-ICE ON from engine start until takeoff. It is not a substitute for de-icing: confirm the wing, LE devices, stabiliser and controls are clear before takeoff.', 'SP.16.5');
  R(['taxi'], 'info', 'Generators: allow up to 5 minutes for steady power from the IDGs in cold oil.', 'SP.16.6');
  R(['taxi'], 'caution', 'Flight controls: expect higher forces when cold. Watch the flap position indicator and LE devices annunciator; if flaps stop, set the lever to the position shown.', 'SP.16.6');
  R(['taxi'], 'info', 'Flaps: move from UP to 40 and back to UP (full travel) — snow, freezing rain or cold could restrict movement.', 'SP.16.6');
  R(['taxi'], 'warn', 'Taxi out with flaps UP: slush and ice build up in the flap cavities and on the LE devices.', 'SP.16.6');
  R(['taxi'], 'caution', 'Taxi slowly: small nosewheel and rudder inputs, minimum thrust, differential thrust to help turns. Slippery surfaces at speed or in a crosswind can start a skid.', 'SP.16.6');
  R(['taxi'], 'caution', 'Over deep de-icing or anti-icing fluid: limit thrust to the minimum — ingested fluid can stall or surge the compressor.', 'SP.16.6, SP.16.8');
  if (aiNeeded && t <= 3) R(['taxi'], 'warn', 'Static run-up on taxi out: to at least 70 % N1 for about 30 s, at intervals no longer than 30 min (count taxi time since the last run-up if the fan was not de-iced). If traffic or surface does not allow 70 %, set the highest thrust practical and time it.', 'SP.16.6');
  if (c.freezeRain && aiNeeded) R(['taxi'], 'warn', 'Freezing rain, drizzle, fog or heavy snow: run up to 70 % N1 for about 1 s, at intervals no longer than 10 min, to shed ice.', 'SP.16.6');
  if (c.deice) {
    R(['taxi'], 'warn', 'Before de-icing: call FLAPS UP; flaps UP (keeps ice out of the flap cavities); thrust IDLE; stabiliser in the green band (wheel handles stowed first); engine and APU BLEED OFF; APU off unless needed.', 'SP.16.8');
    R(['taxi'], 'info', 'After de-icing: wait about 1 minute, then engine BLEED ON. Check flight controls and flaps again. APU bleed only if needed — smoke risk after de-icing.', 'SP.16.8');
  }
  if (t > 40) {
    R(['taxi'], 'caution', 'Cabin hot: PASSENGER CABIN temperature selector AUTO COOL; PACK switches HIGH if still hot. Keep doors and windows closed; turn off electronics not in use.', 'SP.16.19');
    R(['taxi'], 'info', 'Extended ground cooling: engine BLEED 1 and 2 OFF, ISOLATION VALVE OPEN, APU BLEED ON, PACKS HIGH. Before takeoff restore: PACKS AUTO, engine BLEED 2 ON, APU BLEED OFF, engine BLEED 1 ON, ISOLATION VALVE AUTO.', 'SP.16.19');
  }
  if (c.sand) R(['taxi'], 'caution', 'Sand taxi: all engines, ground speed 10 kt, thrust below 40 % N1 where possible. APU bleed rather than engine bleed. Wide separation from other aircraft; avoid full stops and heavy braking.', 'SP.16.23–24');
  if (frz && (c.contam || precipCold || c.freezeRain)) R(['taxi'], 'info', 'Snow or ice on the wing: consider delaying the flight controls and flaps check until de-icing or anti-icing is done.', 'SP.16.6');

  // ── Takeoff ──
  if (c.rwyC) R(['takeoff'], 'warn', 'Contaminated runway: fixed derate only — no assumed temperature reduction, alone or combined. Takeoff performance must account for the surface condition.', 'SP.16.1');
  else if (c.wetRwy) R(['takeoff'], 'caution', 'Wet runway: reduced thrust allowed (fixed derate, assumed temperature, or both), with the longer stopping distance accounted for.', 'SP.16.1');
  if (c.wetRwy || c.rwyC) R(['takeoff'], 'info', 'Minimum V1 may be used for more stopping margin, if the continued-takeoff field length and obstacle clearance still meet the rules (may need real-time performance tools or dispatch data).', 'SP.16.1');
  if (c.deepSlush) R(['takeoff'], 'warn', 'Takeoff not recommended: slush, wet snow or standing water deeper than 13 mm, or dry snow deeper than 102 mm.', 'SP.16.1');
  if (c.deice || icing) R(['takeoff'], 'caution', 'Flap lever: set takeoff flaps. If flaps were held for slush, standing water, ice or exterior de-icing, extend them now. LE FLAPS EXT must be lit.', 'SP.16.9');
  if (aiNeeded) {
    R(['takeoff'], 'warn', 'Static engine run-up before the takeoff roll: to at least 70 % N1, and confirm stable engine operation.', 'SP.16.10');
    if (t <= 3) R(['takeoff'], 'info', 'A 30 s run-up is strongly recommended at OAT 3 °C or below, where possible.', 'SP.16.10');
  }
  if (c.thunder || c.windshear) R(['takeoff'], 'caution', 'Windshear precautions: full rated thrust unless dispatch needs a derate; flaps 5, 10 or 15 unless obstacles or climb gradient limit; longest runway clear of known windshear; watch airspeed after rotation; rotate at the normal rate to the all-engine initial climb pitch.', 'SP.16.29');
  if (c.windshear) R(['takeoff'], 'warn', 'Windshear confirmed: delay the takeoff. If windshear is met at or beyond Vr, rotate without hesitation.', 'SP.16.29');

  // ── Flight ──
  if (icing) {
    R(['flight'], 'warn', 'Engine anti-ice ON before entering icing, and on through the whole encounter. Do not use it when TAT is above 10 °C. Exception: climb and cruise with SAT below −40 °C.', 'SP.16.10');
    R(['flight'], 'caution', 'Wing anti-ice as a de-icer: let ice build (ice on the window frames, centre post or wiper arm shows the icing), then switch ON. As an anti-icer only for extended moderate or severe icing, such as holding.', 'SP.16.12');
    R(['flight'], 'caution', 'Above about FL350 wing anti-ice can trip the bleed and possibly lose cabin pressure.', 'SP.16.12');
    R(['flight', 'approach'], 'warn', 'Holding in icing with flaps extended is prohibited. Prolonged icing with flaps extended is not recommended.', 'SP.16.12');
  }
  if (c.iceSevere) {
    R(['flight'], 'warn', 'Fan ice: avoid prolonged moderate to severe icing (change altitude or speed first). If it cannot be avoided, on each engine one at a time: ENGINE START switches FLT, autothrottle disengage, thrust to at least 80 % N1 for about 1 s, reduce thrust, wait 15 s.', 'SP.16.11');
    R(['flight'], 'info', 'Vibration below 4.0 units after reducing thrust: repeat about every 15 min or sooner.', 'SP.16.11');
    R(['flight'], 'warn', 'Vibration 4.0 units or more after reducing thrust: do the ENGINE HIGH VIBRATION non-normal checklist.', 'SP.16.11');
  }
  if (c.ici) {
    R(['flight'], 'warn', 'Ice crystal icing: avoid. In IMC do not fly directly over significant amber or red radar returns, even with none at altitude. If suspected, leave the area laterally (climbing or descending is not recommended), request a route change, and do the ICE CRYSTAL ICING non-normal checklist.', 'SP.16.31–32');
  }
  if (turb === 'light') {
    R(['flight'], 'info', 'Light to moderate turbulence: autopilot and autothrottle may stay on unless performance suffers. Expect speed changes of 10–15 kt.', 'SP.16.27');
    R(['flight'], 'info', 'Passenger signs ON; seat belts on before entering the turbulence.', 'SP.16.27');
  }
  if (turb === 'severe') {
    R(['flight'], 'warn', 'Severe turbulence: YAW DAMPER ON; autothrottle disengage; AUTOPILOT CWS (disengage if trim is sustained); ENGINE START switches FLT; set thrust for the phase.', 'SP.16.28');
    R(['flight'], 'caution', 'Speeds: climb 280 kt or .76 M, whichever is lower · cruise FMC thrust · descent .76 M / 280 / 250 kt, whichever is lower. Below 15,000 ft and under the maximum landing weight, slow to 250 kt in the clean configuration if needed.', 'SP.16.28');
  }
  if (c.rainHeavy) R(['flight'], 'warn', 'Heavy rain, hail or sleet: ENGINE START switches CONT; autothrottle disengage; move thrust levers slowly and keep a slightly higher minimum thrust; use a slower IAS or Mach; consider starting the APU.', 'SP.16.20');
  if (c.thunder) R(['flight'], 'caution', 'Stay clear of thunderstorm cells and heavy precipitation. Do not fly over a cell showing visible moisture at high altitude.', 'SP.16.20, SP.16.29');
  if (c.windshear) R(['flight', 'approach'], 'warn', 'Windshear suspected: be alert to the danger signals. If the windshear warning comes on, fly the Windshear Escape Maneuver (Non-Normal Maneuvers).', 'SP.16.29–31');
  if (frz) R(['flight', 'approach'], 'caution', 'Cold: altitude corrections apply to all minimum altitudes, including missed approach. See the cold temperature altitude correction below.', 'SP.16.13');

  // ── Approach ──
  if (c.thunder || c.windshear) R(['approach'], 'caution', 'Windshear precautions on approach: flaps 30 for landing; stabilised approach no lower than 1,000 ft above the airport; use the runway clear of suspected windshear within the wind limits; use glide path indications.', 'SP.16.30');
  if (c.windshear && c.atOff) R(['approach'], 'caution', 'Autothrottle off or going off: add an airspeed correction up to 15 kt, applied as for gusts.', 'SP.16.30');
  if (c.windshear) R(['approach'], 'caution', 'Avoid large thrust reductions or trim changes in response to sudden airspeed gains. Crosscheck flight director commands against the vertical flight path instruments.', 'SP.16.30');
  if (c.sand) R(['approach'], 'info', 'Sand and dust: no-engine-bleed landing if operations permit.', 'SP.16.25');
  if (frz) R(['approach'], 'info', 'Cold: correct the minimum altitudes and set MDA / DA at the corrected values (see the cold temperature altitude correction below).', 'SP.16.13–14');

  // ── Landing ──
  if (icing || c.surf || c.rwyC) R(['landing'], 'info', 'Approach and landing: normal procedures and reference speeds.', 'SP.16.14');
  if (c.sand) R(['landing'], 'caution', 'Sand and dust: autobrakes to reduce reverse thrust. Use reverse thrust sparingly — it is most effective at high speed and stirs dust that cuts visibility.', 'SP.16.25');
  if (t > 40) R(['landing'], 'caution', 'Brakes overheat on short sectors: energy adds up and fuse plugs can melt and deflate the tyres. Extend the gear early for cooling; use the Brake Cooling Schedule in the QRH.', 'SP.16.19–20');
  if (icing || c.surf || c.rwyC) R(['landing'], 'warn', 'After prolonged icing with flaps extended, airframe ice, or a contaminated runway or taxiway: do not retract flaps below 15 until the flap areas are checked clear.', 'SP.16.14–15');
  if (aiOk && (icing || c.surf)) R(['landing'], 'warn', 'Engine anti-ice ON during taxi-in while icing exists. Do not use above 10 °C.', 'SP.16.15');
  if (icing || c.surf || c.rwyC) R(['landing'], 'warn', 'After landing in icing: stabiliser trim set to 5 units, so melting snow and ice do not run into the tail and freeze the controls.', 'SP.16.15');
  if (c.sand) R(['landing'], 'info', 'Taxi-in: all engines, ground speed 10 kt, thrust below 40 % N1 where possible; APU bleed rather than engine bleed; avoid heavy braking.', 'SP.16.25');

  // ── Secure ──
  if (frz || c.rwyC) R(['secure'], 'caution', 'If attended and warm air is wanted in the E/E compartments: APU start, APU GEN buses ON, PACKS AUTO, ISOLATION VALVE OPEN, pressurization MAN, outflow valve OPEN (park into the wind), APU BLEED ON. Do not leave the interior unattended with a pack running and all doors closed.', 'SP.16.17');
  if (c.unatt) R(['secure'], 'warn', 'Not attended, or overnight where support is not available: pressurization MAN, outflow valve CLOSE (fully closed keeps snow and ice out). Wheel chocks in place; parking brake released (avoids frozen brakes).', 'SP.16.17');
  if (t < -18) R(['secure'], 'caution', 'Batteries exposed below −18 °C: remove and store above −18 °C and below 40 °C; reinstall warm so the APU starts. (Fleet-specific: see SP.16.18.)', 'SP.16.18');
  if (c.sand) R(['secure'], 'caution', 'Sand and dust: PACKS OFF (verify); pressurization MAN; outflow valve CLOSE to keep dust out.', 'SP.16.25');
  return out;
}

// ── Cold temperature altitude correction ──
const NUM = (s) => Number(String(s).replace('−', '-').replace('°C', '').trim());

/**
 * The correction for one minimum altitude, worked as steps. unit: 'ft' | 'm'.
 * Temperature rounds to the next colder row, height to the next higher column
 * (the conservative reading of the table).
 */
export function coldCorrection({ temp, minAlt, refElev, unit }) {
  const tb = SUPPLEMENTARY[0].tables[unit === 'm' ? 1 : 0];
  const heads = tb.head.map(Number);
  const rows = tb.rows.map(([lbl, vals]) => ({ t: NUM(lbl), vals }));
  const steps = [];
  if (temp == null || minAlt == null || refElev == null || Number.isNaN(temp) || Number.isNaN(minAlt) || Number.isNaN(refElev)) {
    return { steps: [], error: 'Enter the airport temperature, the published minimum altitude and the altimeter reference elevation.' };
  }
  const u = unit === 'm' ? 'm' : 'ft';
  if (temp >= 0) return { steps: [`Airport temperature ${temp} °C is 0 °C or above: no cold temperature correction is needed.`], corr: 0 };
  if (temp < -50) return { steps: [], error: 'Below −50 °C is outside the table. Use the FCOM Supplementary Procedures table for the correction.' };
  const h = minAlt - refElev;
  steps.push(`1. Height above the altimeter reference source = ${minAlt} − ${refElev} = ${h} ${u}`);
  if (h <= 0) return { steps, corr: 0, corrected: minAlt, mcp: roundUp100(minAlt, unit), note: 'The minimum is at or below the reference source: no correction.' };
  // Row: the next colder temperature at or below the airport temperature.
  const row = rows.filter((r) => r.t <= temp).sort((a, b) => b.t - a.t)[0] || rows[rows.length - 1];
  steps.push(`2. Table row: ${row.t} °C (the airport is ${temp} °C; the next colder row is used)`);
  // Column: the next higher height, or extrapolate above the last column.
  const last = heads[heads.length - 1];
  let corr;
  if (h > last) {
    corr = row.vals[heads.length - 1] * (h / last);
    steps.push(`3. Above ${last} ${u}: extrapolate linearly from the ${last} ${u} figure — ${row.vals[heads.length - 1]} × ${h} ÷ ${last}`);
  } else {
    const ci = heads.findIndex((x) => x >= h);
    corr = row.vals[ci];
    steps.push(`3. Column: ${heads[ci]} ${u} (next higher height). Correction from the table: ${corr} ${u}`);
  }
  corr = Math.round(corr);
  const corrected = minAlt + corr;
  const mcp = roundUp100(corrected, unit);
  steps.push(`4. Corrected altitude = ${minAlt} + ${corr} = ${corrected} ${u}`);
  steps.push(`5. Set the MCP altitude to ${mcp} ft: the next 100 ft above the corrected altitude${unit === 'm' ? ' (converted to feet)' : ''}.`);
  steps.push('6. Advise ATC of the corrections. Set MDA / DA at the corrected minimum. Do not correct the altimeter setting.');
  return { steps, corr, corrected, mcp };
}

// The MCP altitude is always in feet: metres convert, then round up to 100 ft.
function roundUp100(v, unit) {
  const ft = unit === 'm' ? v * 3.28084 : v;
  return Math.ceil(ft / 100) * 100;
}

// ── The tab ──
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function advisorHtml() {
  return `<div class="adv" id="adv">
    <div class="adv-form">
      <label class="adv-t">Temperature, °C <span class="qr-ref">OAT on the ground · TAT in flight</span>
        <input id="adv-oat" type="number" step="1" inputmode="numeric" placeholder="e.g. 2" class="adv-in"></label>
      <div class="adv-g"><div class="adv-gt">Phase</div><div class="adv-phase">${PHASES.map(([k, n]) => `<label class="tag tag-btn adv-ph"><input type="radio" name="ph" value="${k}"${k === 'preflight' ? ' checked' : ''}>${n}</label>`).join('')}</div></div>
      ${CONDS.map(([g, list]) => `<div class="adv-g"><div class="adv-gt">${g}</div>${list.map(([k, n]) => `<label class="adv-c"><input type="checkbox" name="c" value="${k}"> ${esc(n)}</label>`).join('')}</div>`).join('')}
      <div class="adv-g"><div class="adv-gt">Engine cold soak</div>${SOAK.map(([k, n]) => `<label class="adv-c"><input type="radio" name="soak" value="${k}"${k === 'none' ? ' checked' : ''}> ${esc(n)}</label>`).join('')}</div>
      <div class="adv-g"><div class="adv-gt">Turbulence</div>${TURB.map(([k, n]) => `<label class="adv-c"><input type="radio" name="turb" value="${k}"${k === 'none' ? ' checked' : ''}> ${esc(n)}</label>`).join('')}</div>
    </div>
    <div id="adv-out" class="adv-out" aria-live="polite"></div>
    <section class="adv-cold"><h3>Cold temperature altitude correction <span class="qr-ref">SP.16.13–14</span></h3>
      <div class="adv-row"><label class="adv-t">Airport temperature, °C<input id="ct-t" type="number" step="1" class="adv-in"></label>
      <label class="adv-t">Published minimum altitude<input id="ct-min" type="number" step="10" class="adv-in"></label>
      <label class="adv-t">Reference source elevation<input id="ct-ref" type="number" step="10" class="adv-in"></label>
      <label class="adv-t">Units<select id="ct-u" class="adv-in"><option value="ft">feet</option><option value="m">metres</option></select></label></div>
      <div id="ct-out" class="adv-steps"></div>
    </section>
    <p class="qr-foot">Study aid, condensed from the FCOM Supplementary Procedures SP.16. The FCOM and the QRH on board govern.</p>
  </div>`;
}

const LVL = { warn: 'WARNING', caution: 'CAUTION', info: 'NOTE' };

export function refreshAdvisor() {
  const root = document.getElementById('adv');
  if (!root) return;
  const val = root.querySelector('#adv-oat').value;
  const oat = val === '' ? null : Number(val);
  const phase = root.querySelector('input[name=ph]:checked')?.value || 'preflight';
  const c = Object.fromEntries([...root.querySelectorAll('input[name=c]')].map((i) => [i.value, i.checked]));
  const soak = root.querySelector('input[name=soak]:checked')?.value || 'none';
  const turb = root.querySelector('input[name=turb]:checked')?.value || 'none';
  const acts = advise({ oat, phase, c, soak, turb });
  const name = PHASES.find((p) => p[0] === phase)?.[1] || phase;
  const lines = acts.map((a) => `<li class="adv-a ${a.lvl}"><span class="adv-lvl">${LVL[a.lvl]}</span> ${esc(a.text)} ${a.ref ? `<span class="qr-ref">${esc(a.ref)}</span>` : ''}</li>`);
  root.querySelector('#adv-out').innerHTML = `<h3 class="adv-h">${esc(name)}${oat != null ? ` · ${oat} °C` : ''}</h3>` +
    (lines.length ? `<ul class="adv-list">${lines.join('')}</ul>` : `<p class="adv-none">${oat == null ? 'Enter the temperature to see what applies.' : 'Nothing extra for these conditions in this phase — normal procedures.'}</p>`);

  // Cold correction, worked.
  const g = (id) => root.querySelector(id).value;
  const num = (s) => (s === '' ? null : Number(s));
  const cc = coldCorrection({ temp: num(g('#ct-t')), minAlt: num(g('#ct-min')), refElev: num(g('#ct-ref')), unit: g('#ct-u') });
  const out = root.querySelector('#ct-out');
  if (cc.error) { out.innerHTML = `<p class="adv-none">${esc(cc.error)}</p>`; return; }
  out.innerHTML = `<ol class="adv-steps-l">${cc.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>` +
    (cc.mcp != null ? `<div class="adv-res">Set MCP altitude <b>${cc.mcp} ft</b>${cc.corr ? ` (corrected ${cc.corrected} ${g('#ct-u')}, +${cc.corr} ${g('#ct-u')})` : ''}</div>` : '') +
    (cc.note ? `<p class="adv-none">${esc(cc.note)}</p>` : '');
}
