// supp-advisor.js — adverse weather (FCOM SP.16) as answers, not reading.
//
// Three starting points: Departure (on the ground), In flight, Arrival. Each
// asks only what matters there, one question at a time, and skips questions
// that cannot change the answer (no precipitation question above 10 °C, no
// fluid question when nothing needs protecting). The result gives the
// decisions first (de-icing, anti-ice, run-ups, takeoff thrust), then a short
// sequence in the order you meet it, then extra notes folded away. Every line
// cites its SP.16 page; tapping it opens that topic in the full summary.
//
// Rules checked against FCOM Rev 57 SP.16 (pages cited inline). Study aid:
// the FCOM and the operator's de-icing programme govern.

import { SUPPLEMENTARY } from './supplementary.js?v=56';
import { nav, loadNav } from './navdb.js?v=56';
import { fetchMetar, parseMetar, ageMin, summary } from './metar.js?v=56';
import { relatedFor, procLink } from './supp-procs.js?v=56';

const esc = (s) => String(s).replace(/[&<>"]/g, (x) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[x]);
const SP16 = SUPPLEMENTARY[0];

// ── Questions ───────────────────────────────────────────────────────────
// opts: [value, label, short label for the answer chip]
const Q = {
  place: { t: 'Where are you?', opts: [['dep', 'Departure — on the ground', 'Departure'], ['flt', 'In flight', 'In flight'], ['arr', 'Arrival — planning the landing', 'Arrival']] },
  wx: { t: 'Weather', opts: [['apt', 'Look up the airport — use its latest METAR', 'Airport METAR'], ['hand', 'Enter the weather myself', 'Weather by hand']] },
  apt: { t: 'Which airport?', apt: true },
  oat: { t: 'Outside air temperature, °C', num: true },
  precip: {
    t: 'Precipitation or visible moisture now?',
    opts: [['none', 'None', 'No moisture'], ['fog', 'Fog or cloud (visibility 1,600 m or less)', 'Fog'], ['rain', 'Rain or drizzle', 'Rain'],
      ['snow', 'Snow, sleet or ice crystals', 'Snow'], ['frz', 'Freezing rain, freezing drizzle, freezing fog or heavy snow', 'Freezing precip.']],
  },
  airframe: {
    t: 'Wing, tail and control surfaces?',
    opts: [['clean', 'Clean', 'Wing clean'], ['lower', 'Frost under the wing only, from cold fuel (CSFF)', 'CSFF lower wing'],
      ['upper', 'Frost on top of the wing over the fuel tank, from cold fuel (CSFF)', 'CSFF upper wing'],
      ['contam', 'Snow, ice or frost on leading edges, controls, tail — or anything else', 'Wing contaminated']],
  },
  fuelT: { t: 'Tank fuel temperature −16 °C or warmer?', yn: true, chip: ['Fuel −16 °C or warmer', 'Fuel colder than −16 °C'] },
  thick: { t: 'Is the frost under the wing thicker than 3 mm?', yn: true, chip: ['Frost over 3 mm', 'Frost 3 mm or less'] },
  csffArea: { t: 'Is all the upper-wing frost inside the marked CSFF lines? (No lines on this airplane: No.)', yn: true, chip: ['Inside the CSFF lines', 'Outside the lines / no lines'] },
  surface: {
    t: 'Ramp, taxiways and runway?',
    opts: [['dry', 'Dry', 'Runway dry'], ['wet', 'Wet', 'Runway wet'], ['contam', 'Slush, snow, standing water or ice', 'Runway contaminated'],
      ['deep', 'Deep: slush or standing water over 13 mm, or dry snow over 102 mm', 'Runway deep contamination']],
  },
  fluid: {
    t: 'De-icing or anti-icing fluid?',
    opts: [['none', 'None', 'No fluid'], ['t1', 'Type I only', 'Type I'], ['t24', 'Type II or Type IV', 'Type II / IV']],
  },
  arrSurface: {
    t: 'Destination runway?',
    opts: [['dry', 'Dry', 'Runway dry'], ['wet', 'Wet', 'Runway wet'], ['contam', 'Slush, snow, standing water or ice', 'Runway contaminated']],
  },
  arrIce: { t: 'Icing expected on the approach (flaps out in icing)?', yn: true, chip: ['Icing on approach', 'No icing on approach'] },
  windshear: { t: 'Windshear reported or likely at the destination?', yn: true, chip: ['Windshear', 'No windshear'] },
};

// Flight: one screen, tick what applies.
const FLIGHT = [
  ['icing', 'Icing — visible moisture, TAT 10 °C or below'],
  ['iceSevere', 'Moderate or severe icing you cannot avoid'],
  ['ici', 'Ice crystal icing suspected'],
  ['turbL', 'Turbulence — light or moderate'],
  ['turbS', 'Turbulence — severe'],
  ['rain', 'Heavy rain, hail or sleet'],
  ['storm', 'Thunderstorms on the route'],
];

// Departure extras: rare, so offered under "Other conditions" on the result.
const EXTRAS = [['soak', 'Engine cold soaked below −40 °C'], ['sand', 'Sand or dust'], ['noApu', 'APU inoperative']];
const isExtra = (k) => EXTRAS.some((e) => e[0] === k);

// ── State ───────────────────────────────────────────────────────────────
const A = {};          // answers
let H = [];            // answered keys, in order (answer chips, Back)
let F = new Set();     // flight situations ticked
let fltShown = false;  // flight result showing
let runT = null;       // last taxi run-up (ms)
let SRC = {};          // key → 'METAR' when the answer came from the report
let WX = null;         // { apt, raw, m, error, loading } for the chosen airport

function flow() {
  if (A.place === 'dep') {
    const q = ['wx', ...(A.wx === 'apt' ? ['apt'] : []), 'oat'];
    const csff = A.airframe === 'lower' || A.airframe === 'upper';
    // Visible moisture decides icing at 10 °C or below, and CSFF at any temperature (SP.3.2).
    if (A.oat != null && A.oat <= 10) q.push('precip');
    q.push('airframe');
    if (csff && !(A.oat != null && A.oat <= 10)) q.push('precip');
    // CSFF: the extra conditions matter only when OAT and moisture allow it (SP.3.2).
    if (csff && A.oat >= 4 && A.precip === 'none') q.push('fuelT');
    if (A.airframe === 'lower' && !csffOk()) q.push('thick');
    if (A.airframe === 'upper' && csffOk()) q.push('csffArea');
    q.push('surface');
    if (A.surface != null && needsFluidQ()) q.push('fluid');
    return q;
  }
  if (A.place === 'arr') {
    const q = ['wx', ...(A.wx === 'apt' ? ['apt'] : []), 'oat'];
    if (A.oat != null && A.oat <= 10) q.push('precip', 'arrIce');
    q.push('arrSurface', 'windshear');
    return q;
  }
  return [];
}

// Fluid only changes the answer when the wing must be de-iced or icing exists.
function needsFluidQ() { return deiceNeeded() || depIcing(); }

// CSFF conditions (SP.3.2): OAT +4 °C or warmer, no visible moisture, fuel −16 °C or warmer.
function csffOk() { return A.oat != null && A.oat >= 4 && A.precip === 'none' && A.fuelT === true; }

// De-icing (SP.16.2, SP.3.2): contamination, CSFF beyond what is allowed.
function deiceNeeded() {
  if (A.airframe === 'contam') return true;
  if (A.airframe === 'lower') return !csffOk() && A.thick === true;
  if (A.airframe === 'upper') return !(csffOk() && A.csffArea === true);
  return false;
}

function nextKey() {
  if (A.place == null) return 'place';
  return flow().find((k) => A[k] == null) || null;
}

function answer(key, v) {
  if (key === 'place') { reset(); A.place = v; H = ['place']; return; }
  if (key === 'wx' && v === 'hand') { for (const k of Object.keys(SRC)) delete A[k]; SRC = {}; WX = null; }
  A[key] = v;
  delete SRC[key];                       // the user's answer, not the report's
  H = H.filter((k) => k !== key);
  H.push(key);
  prune();
  if (WX?.m && A.precip == null && flow().includes('precip')) { A.precip = WX.m.precip; SRC.precip = 'METAR'; H.push('precip'); prune(); }
  const order = ['place', ...flow()];
  H.sort((x, y) => order.indexOf(x) - order.indexOf(y));
}

// Drop answers to questions that no longer apply (e.g. the temperature changed).
function prune() {
  const live = new Set(['place', ...flow()]);
  for (const k of Object.keys(A)) if (!live.has(k) && !isExtra(k)) delete A[k];
  H = H.filter((k) => live.has(k));
}

// Change one answer: forget it and everything asked after it.
function edit(key) {
  if (key === 'place') { reset(); return; }
  if (key === 'apt' || key === 'wx') { const keep = A.place, w = A.wx; reset(); A.place = keep; H = ['place']; if (key === 'apt') { A.wx = w; H.push('wx'); } return; }
  delete A[key];
  delete SRC[key];
  H = H.filter((k) => k !== key);
  fltShown = false;
}

function reset() {
  for (const k of Object.keys(A)) delete A[k];
  H = []; F = new Set(); fltShown = false; runT = null; SRC = {}; WX = null;
}

// ── Rules ───────────────────────────────────────────────────────────────
// Icing conditions (SP.16.2): OAT 10 °C or below with visible moisture, or
// with ice, snow, slush or standing water on ramps, taxiways or runways.
const moist = () => A.precip != null && A.precip !== 'none';
const surfContam = (s) => s === 'contam' || s === 'deep';
function depIcing() { return A.oat != null && A.oat <= 10 && (moist() || surfContam(A.surface)); }
function arrIcing() { return A.oat != null && A.oat <= 10 && (moist() || A.arrSurface === 'contam'); }

// A result line: text, SP page, the summary topic it opens, level.
const L = (s, sp, topic, lvl = '') => ({ s, sp, topic, lvl });

function departure() {
  const t = A.oat, icing = depIcing();
  const deice = deiceNeeded();
  const fluid = A.fluid || 'none';
  const falling = ['rain', 'snow', 'frz'].includes(A.precip);
  const dec = [];
  const D = (k, v, cls, s, sp, topic) => dec.push({ k, v, cls, s, sp, topic });
  // De-icing (SP.16.2)
  if (A.airframe === 'contam') D('De-icing', 'YES', 'yes', 'Leading edges, controls, tabs, winglets, upper wing and tail must be free of snow, ice and frost.', 'SP.16.2', 'Icing conditions');
  else if (A.airframe === 'lower' && csffOk()) D('De-icing', 'NO', 'no', 'CSFF under the wing allowed: OAT +4 °C or warmer, no visible moisture, fuel −16 °C or warmer, leading edges and controls clear.', 'SP.3.2', 'Icing conditions');
  else if (A.airframe === 'lower' && A.thick) D('De-icing', 'YES', 'yes', 'Frost under the wing thicker than 3 mm: de-ice all the wings.', 'SP.3.2', 'Icing conditions');
  else if (A.airframe === 'lower') D('De-icing', 'NO', 'no', 'Light frost up to 3 mm under the wing is allowed; leading edges and controls clear.', 'SP.3.2', 'Icing conditions');
  else if (A.airframe === 'upper' && csffOk() && A.csffArea) D('De-icing', 'NO', 'no', 'Upper-wing CSFF inside the marked lines allowed: OAT +4 °C or warmer, no visible moisture, fuel −16 °C or warmer.', 'SP.3.2', 'Icing conditions');
  else if (A.airframe === 'upper') D('De-icing', 'YES', 'yes', csffOk() ? 'Frost outside the marked CSFF lines (or no lines): de-ice the wings.' : 'Upper-wing CSFF needs OAT +4 °C or warmer, no visible moisture and fuel −16 °C or warmer: de-ice the wings.', 'SP.3.2', 'Icing conditions');
  else D('De-icing', 'NO', 'no', 'Wing and tail clean.', 'SP.16.2', 'Icing conditions');
  // Engine anti-ice (SP.16.4)
  if (t > 10) D('Engine anti-ice', 'OFF', 'no', 'Not above 10 °C OAT.', 'SP.16.4', 'Engine anti-ice on the ground');
  else if (icing) D('Engine anti-ice', 'ON', 'on', 'Right after both engines start, and for all ground operations.', 'SP.16.4', 'Engine anti-ice on the ground');
  else D('Engine anti-ice', 'OFF', 'no', 'No icing conditions.', 'SP.16.4', 'Engine anti-ice on the ground');
  // Wing anti-ice (SP.16.5): unless protected by Type II or IV fluid.
  if (icing && fluid === 't24') D('Wing anti-ice', 'OFF', 'no', 'Type II or IV fluid protects the wing. Watch the holdover time.', 'SP.16.5', 'Wing anti-ice on the ground');
  else if (icing) D('Wing anti-ice', 'ON', 'on', `From engine start to takeoff.${fluid === 't1' ? ' Type I fluid does not replace it.' : ''} It does not replace de-icing.`, 'SP.16.5', 'Wing anti-ice on the ground');
  else D('Wing anti-ice', 'OFF', 'no', t > 10 ? 'Not above 10 °C OAT.' : 'No icing conditions.', 'SP.16.5', 'Wing anti-ice on the ground');
  // Takeoff thrust (SP.16.1)
  if (A.surface === 'deep') D('Takeoff', 'NOT RECOMMENDED', 'yes', 'Slush or standing water over 13 mm, or dry snow over 102 mm.', 'SP.16.1', 'Wet or contaminated runway takeoff');
  else if (A.surface === 'contam') D('Takeoff thrust', 'FIXED DERATE ONLY', 'on', 'No assumed temperature, alone or combined. Performance for the runway condition.', 'SP.16.1', 'Wet or contaminated runway takeoff');
  else if (A.surface === 'wet') D('Takeoff thrust', 'REDUCED ALLOWED', 'no', 'Fixed derate, assumed temperature or both — with wet-runway performance.', 'SP.16.1', 'Wet or contaminated runway takeoff');

  // Taxi run-up (SP.16.7): engine anti-ice required and OAT 3 °C or below.
  let runup = null;
  if (icing && t <= 3) {
    runup = { every: A.precip === 'frz' ? 10 : 30, lines: ['70 % N1 for about 30 s, at least every 30 min.'] };
    if (A.precip === 'frz') runup.lines.push('Freezing rain, drizzle, fog or heavy snow: also 70 % N1 for about 1 s, at least every 10 min.');
  }

  // The sequence: only what applies, in the order you meet it.
  const pre = [], start = [], taxi = [], tko = [];
  // Frost, snow or ice on the airplane (CSFF included): the extra exterior checks.
  // Probe heat in the preflight is for cold weather only (freezing OAT or
  // icing conditions) — otherwise the normal procedures switch it on as usual.
  const frosted = deice || A.airframe === 'lower' || A.airframe === 'upper' || A.airframe === 'contam';
  const cold = t <= 0 || icing;
  if (frosted || cold) pre.push(L('Exterior: leading edges, controls, upper wing, winglets and tail clear; pitot probes and static ports clear.', 'SP.16.2', 'Icing conditions'));
  if (cold) pre.push(L('PROBE HEAT switches ON; all probe heat lights out.', 'SP.16.3', 'Icing conditions'));
  if (deice) {
    pre.push(L('For de-icing: APU off unless needed · flaps UP · thrust levers idle · stabilizer trim set (green band) · engine and APU BLEED OFF.', 'SP.16.8', 'De-icing and anti-icing', 'warn'));
    pre.push(L('After de-icing: wait about 1 minute, then engine BLEED ON. Check flight controls and flaps full travel.', 'SP.16.8', 'De-icing and anti-icing'));
  }
  if (A.soak) start.push(L('Cold soaked 1 h or more below −40 °C: do not start or motor the engine — maintenance first (3 h or more: starter servicing too).', 'SP.16.4', 'Cold soak and engine start', 'warn'));
  if (t < -35) start.push(L('Below −35 °C: idle 2 minutes before moving the thrust lever.', 'SP.16.4', 'Cold soak and engine start', 'caution'));
  if (A.sand) start.push(L('Sand or dust: ENGINE START switch GRD and motor 2 minutes before the start lever to IDLE.', 'SP.16.22', 'Sandy or dusty environment'));
  if ((surfContam(A.surface) && t <= 10) || (falling && t < 0)) taxi.push(L('Taxi with flaps UP. Set takeoff flaps before takeoff; LE FLAPS EXT green.', 'SP.16.6', 'Before taxi and flight controls', 'warn'));
  if (!deice && (A.precip === 'frz' || A.precip === 'snow') && t <= 0) taxi.push(L('Before taxi: flaps full travel, UP → 40 → UP.', 'SP.16.6', 'Before taxi and flight controls'));
  if (surfContam(A.surface) || (falling && t <= 0)) taxi.push(L('Taxi slowly, small steering inputs, minimum thrust.', 'SP.16.6', 'Taxi-out and engine run-up', 'caution'));
  if (A.sand) taxi.push(L('Sand or dust: 10 kt, below 40 % N1, no heavy braking, keep clear of other engines.', 'SP.16.23', 'Sandy or dusty environment'));
  if (icing && A.surface !== 'deep') tko.push(L(`Static run-up before the roll: 70 % N1, engines stable${t <= 3 ? ' — about 30 s strongly recommended' : ''}.`, 'SP.16.9', 'Takeoff after anti-ice', 'warn'));
  if (A.sand) tko.push(L('Sand or dust: maximum derate, rolling takeoff, never into a dust cloud.', 'SP.16.24', 'Sandy or dusty environment'));
  const seq = [['Preflight', pre], ['Engine start', start], ['Taxi', taxi], ['Takeoff', tko]].filter(([, l]) => l.length);

  // Folded notes.
  const more = [];
  if (t <= 0) more.push(L('Generators: up to 5 minutes for steady power with cold oil.', 'SP.16.6', 'Before taxi and flight controls'));
  if (t <= 0) more.push(L('Expect higher control forces when cold. If the flaps stop moving, set the lever to the position shown.', 'SP.16.6', 'Before taxi and flight controls'));
  if (icing) more.push(L('Do not wait to see ice on the airframe: temperature and visible moisture decide engine anti-ice.', 'SP.16.4', 'Engine anti-ice on the ground'));
  if (icing) more.push(L('COWL VALVE OPEN stays bright at idle: APU BLEED OFF, ISOLATION VALVE AUTO, thrust up slightly (to 30 % N1 at most).', 'SP.16.4', 'Engine anti-ice on the ground'));
  if (deice) more.push(L('Fluid on the wing briefly reduces lift after rotation: use the normal rotation rate.', 'SP.16.7', 'De-icing and anti-icing'));
  if (deice) more.push(L('Over pools of de-icing fluid: minimum thrust — ingested fluid can cause compressor stalls.', 'SP.16.7', 'Taxi-out and engine run-up'));
  if (t > 40) more.push(L('OAT above 40 °C: packs or cooling air whenever electrically powered. Cabin hot: AUTO COOL, PACKS HIGH.', 'SP.16.18', 'Hot weather operation'));
  if (t > 40) more.push(L('Hot brakes on short sectors: brake energy adds up. QRH brake cooling schedule.', 'SP.16.19', 'Hot weather operation'));
  return { dec, runup, seq, more };
}

function arrival() {
  const t = A.oat, icing = arrIcing();
  const app = [], land = [], after = [];
  if (t <= 0) app.push({ ...L('Cold: correct the minimum altitudes, DA / MDA and the missed approach altitude.', 'SP.16.13', 'Cold temperature altitude corrections', 'warn'), cold: true });
  if (A.arrIce) {
    app.push(L('Engine anti-ice ON before and during descent in icing — even below −40 °C SAT.', 'SP.16.10', 'Engine anti-ice in flight', 'warn'));
    app.push(L('Holding in icing with flaps extended is prohibited.', 'SP.16.12', 'Wing anti-ice in flight', 'warn'));
  }
  if (A.windshear) {
    app.push(L('Windshear: flaps 30 · stabilised by 1,000 ft · runway clear of the windshear.', 'SP.16.29', 'Windshear', 'caution'));
    app.push(L('Autothrottle off or coming off: add up to 15 kt, applied as for gusts.', 'SP.16.29', 'Windshear'));
    app.push(L('Warning or unacceptable deviation: Windshear Escape Maneuver.', 'SP.16.29', 'Windshear', 'warn'));
  }
  if (icing || A.arrSurface !== 'dry') land.push(L('Normal procedures and reference speeds.', 'SP.16.14', 'Approach, landing and after landing'));
  if (A.arrIce || A.arrSurface === 'contam') after.push(L('Flaps: not below 15 until the flap areas are checked clear.', 'SP.16.15', 'Approach, landing and after landing', 'warn'));
  if (icing) after.push(L('Engine anti-ice ON for taxi-in.', 'SP.16.15', 'Approach, landing and after landing', 'warn'));
  if (icing && t <= 3) after.push(L(`Run-up: 70 % N1 for about 30 s, at least every 30 min${A.precip === 'frz' ? '; freezing precipitation: also about 1 s, every 10 min' : ''}.`, 'SP.16.16', 'Approach, landing and after landing'));
  if (A.arrSurface === 'contam' || (t <= 0 && moist())) after.push(L('Taxi slowly, small steering inputs, minimum thrust.', 'SP.16.14', 'Approach, landing and after landing', 'caution'));
  if (icing) after.push(L('Shutdown after landing in icing: stabilizer trim 5 units.', 'SP.16.16', 'Approach, landing and after landing', 'warn'));
  const seq = [['Approach', app], ['Landing', land], ['After landing', after]].filter(([, l]) => l.length);
  const more = [];
  if (t <= 0) more.push(L('Leaving the airplane cold and unattended: pressurization MAN, outflow valve CLOSED, chocks in, parking brake released.', 'SP.16.17', 'Secure in cold weather'));
  if (t < -18) more.push(L('Batteries exposed below −18 °C: have them removed and kept warm.', 'SP.16.17', 'Secure in cold weather'));
  return { dec: [], runup: null, seq, more };
}

function flight() {
  const seq = [];
  const add = (title, lines) => seq.push([title, lines]);
  if (F.has('icing')) add('Icing', [
    L('Engine anti-ice ON before entering icing. Exception: climb and cruise below −40 °C SAT. Always ON before and during descent in icing.', 'SP.16.10', 'Engine anti-ice in flight', 'warn'),
    L('Wing anti-ice: normally let ice build, then ON (de-icer). ON early only for long exposure, such as holding.', 'SP.16.12', 'Wing anti-ice in flight'),
    L('Neither above TAT 10 °C. Above about FL350 wing anti-ice can trip a bleed.', 'SP.16.12', 'Wing anti-ice in flight', 'caution'),
    L('Holding in icing with flaps extended is prohibited.', 'SP.16.12', 'Wing anti-ice in flight', 'warn'),
  ]);
  if (F.has('iceSevere')) add('Fan ice removal — one engine at a time', [
    L('Change altitude or speed first if you can.', 'SP.16.11', 'Fan ice removal'),
    L('ENGINE START switches FLT · autothrottle disengage · thrust to at least 80 % N1 for about 1 s, then back as needed · wait 15 s.', 'SP.16.11', 'Fan ice removal', 'warn'),
    L('Vibration below 4.0: repeat about every 15 min. 4.0 or more: Engine High Vibration checklist.', 'SP.16.12', 'Fan ice removal', 'warn'),
  ]);
  if (F.has('ici')) add('Ice crystal icing', [
    L('Leave the area sideways — climbing or descending out of it is not recommended. Do the Ice Crystal Icing checklist.', 'SP.16.32', 'Ice crystal icing (ICI)', 'warn'),
    L('In cloud, avoid flying over amber or red radar returns, even with nothing at your level.', 'SP.16.31', 'Ice crystal icing (ICI)'),
  ]);
  if (F.has('turbS')) add('Severe turbulence', [
    L('YAW DAMPER ON · autothrottle disengage · autopilot CWS (disengage if trim runs on) · ENGINE START switches FLT · thrust set for the phase.', 'SP.16.26', 'Turbulence', 'warn'),
    L('Climb 280 kt / .76 M · cruise FMC thrust · descent .76 M / 280 / 250 kt — whichever is lower.', 'SP.16.26', 'Turbulence'),
    L('Change thrust only for an unacceptable speed trend. On approach, delay flap extension.', 'SP.16.26', 'Turbulence'),
  ]);
  else if (F.has('turbL')) add('Light or moderate turbulence', [
    L('Passenger signs ON, seat belts fastened. Autopilot and autothrottle can stay on. Speed may vary 10–15 kt.', 'SP.16.26', 'Turbulence'),
  ]);
  if (F.has('rain')) add('Heavy rain, hail or sleet', [
    L('ENGINE START switches CONT · autothrottle disengage · move thrust levers slowly · keep a higher minimum thrust.', 'SP.16.20', 'Moderate to heavy rain, hail or sleet', 'warn'),
    L('Fly a slower speed. Consider starting the APU.', 'SP.16.20', 'Moderate to heavy rain, hail or sleet'),
  ]);
  if (F.has('storm')) add('Thunderstorms', [
    L('Avoid them. Do not overfly a cell that shows visible moisture up high.', 'SP.16.20', 'Moderate to heavy rain, hail or sleet'),
    L('Windshear is likely near storms — see Arrival for the approach.', 'SP.16.28', 'Windshear'),
  ]);
  return { dec: [], runup: null, seq, more: [] };
}

// ── Drawing ─────────────────────────────────────────────────────────────
const topicIdx = (title) => SP16.topics.findIndex((tp) => tp.t === title);
const spLink = (l) => { const k = topicIdx(l.topic); return k >= 0 ? `<button class="wz-sp" data-sp-go="16-${k}">${esc(l.sp)}</button>` : `<span class="qr-ref">${esc(l.sp)}</span>`; };

function chipText(key) {
  const v = A[key], q = Q[key];
  if (key === 'oat') return `${String(v).replace('-', '−')} °C`;
  if (key === 'apt') return v ? v.ident : 'No airport';
  if (q.yn) return v ? q.chip[0] : q.chip[1];
  return q.opts.find((o) => o[0] === v)?.[2] ?? String(v);
}

function questionHtml(key) {
  const q = Q[key];
  if (q.apt) {
    return `<div class="wz-qq"><div class="wz-qt">${A.place === 'arr' ? 'Destination airport?' : 'Departure airport?'}</div>
      <div class="wz-numrow"><input id="wz-apt" type="text" class="wz-in" placeholder="ICAO or name, e.g. LLBG" autocomplete="off" autocapitalize="characters" spellcheck="false"></div>
      <div id="wz-sug" class="wz-sug"></div>
      <div class="wz-hint">ICAO or IATA code, airport or city name. The METAR fills in temperature, precipitation and runway state — you can change any of them.</div></div>`;
  }
  if (q.num) {
    return `<div class="wz-qq"><div class="wz-qt">${esc(q.t)}</div>
      <div class="wz-numrow"><button class="tag tag-btn wz-pm" data-wz="neg" aria-label="Plus or minus">±</button>
      <input id="wz-t" type="text" inputmode="numeric" class="wz-in wz-num" placeholder="e.g. 2" autocomplete="off">
      <button class="tag tag-btn wz-ok" data-wz="ok">OK</button></div>
      <div class="wz-hint">${A.place === 'arr' ? 'At the destination.' : 'At the airport now.'} ± for below zero.</div></div>`;
  }
  const opts = q.yn ? [[true, 'Yes'], [false, 'No']] : q.opts;
  return `<div class="wz-qq"><div class="wz-qt">${esc(q.t)}</div><div class="wz-opts${q.yn ? ' yn' : ''}">${opts.map(([v, n]) => `<button class="wz-opt" data-wz-ans="${key}|${v}">${esc(n)}</button>`).join('')}</div></div>`;
}

function flightHtml() {
  return `<div class="wz-qq"><div class="wz-qt">What are you facing? Tick all that apply.</div>
    <div class="wz-opts">${FLIGHT.map(([k, n]) => `<button class="wz-opt wz-tog${F.has(k) ? ' on' : ''}" data-wz-tog="${k}" aria-pressed="${F.has(k)}">${esc(n)}</button>`).join('')}</div>
    <div class="wz-nav"><button class="tag tag-btn wz-ok" data-wz="show"${F.size ? '' : ' disabled'}>Show actions</button></div></div>`;
}

const clock = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

function resultHtml(r) {
  let h = '';
  if (r.dec.length) h += `<div class="wz-dec">${r.dec.map((x) => `<div class="wz-d ${x.cls}"><span class="wz-k">${esc(x.k)}</span><span class="wz-v">${esc(x.v)}</span><span class="wz-s">${esc(x.s)} ${spLink(x)}</span></div>`).join('')}</div>`;
  if (r.runup) {
    const due = runT ? runT + r.runup.every * 60000 : null;
    h += `<div class="wz-d runup"><span class="wz-k">Taxi run-up</span><span class="wz-v">REQUIRED</span>
      <span class="wz-s">${r.runup.lines.map(esc).join('<br>')} ${spLink({ sp: 'SP.16.7', topic: 'Taxi-out and engine run-up' })}</span>
      <div class="wz-rt"><button class="tag tag-btn wz-mini" data-wz="runup">Run-up done</button><span class="wz-due">${due ? `Last ${clock(runT)} · next by <b>${clock(due)}</b>` : 'Tap after each run-up to see when the next is due.'}</span></div></div>`;
  }
  for (const [title, lines] of r.seq) {
    h += `<div class="wz-sec"><div class="wz-g">${esc(title)}</div><ul class="wz-list">${lines.map((l) => `<li class="wz-r ${l.lvl}">${esc(l.s)} ${spLink(l)}${l.cold ? ' <button class="tag tag-btn wz-mini" data-wz="cold">Correct altitudes ›</button>' : ''}</li>`).join('')}</ul></div>`;
  }
  if (!r.dec.length && !r.runup && !r.seq.length) h += '<p class="wz-none">Nothing extra in SP.16 for these conditions — normal procedures.</p>';
  if (r.more.length) h += `<details class="wz-more"><summary>More notes (${r.more.length})</summary><ul class="wz-list">${r.more.map((l) => `<li class="wz-r">${esc(l.s)} ${spLink(l)}</li>`).join('')}</ul></details>`;
  const rel = relatedHtml();
  if (rel) h += rel;
  if (A.place === 'dep') {
    h += `<div class="wz-other"><span class="wz-g">Other conditions</span>${EXTRAS.map(([k, n]) => `<button class="wz-chip${A[k] ? ' on' : ''}" data-wz-x="${k}" aria-pressed="${!!A[k]}">${A[k] ? '✓ ' : '+ '}${esc(n)}</button>`).join('')}</div>`;
  }
  return h;
}

// Procedures from other chapters that go with these answers.
function relatedHtml() {
  const tags = [];
  if (A.place === 'dep') {
    if (A.airframe === 'lower' || A.airframe === 'upper') tags.push('csff');
    if (A.oat > 40) tags.push('hot');
    if (A.sand) tags.push('sand');
    if (A.noApu) tags.push('noApu');
  } else if (A.place === 'arr') {
    if (A.oat <= 0) tags.push('arrCold');
  }
  if (!tags.length) return '';
  const list = relatedFor(tags);
  if (!list.length) return '';
  const why = A.place === 'arr' && tags.includes('arrCold') ? 'Cold at the destination: fuel left in the wing tanks cold-soaks on the ground and can frost the wing before the next flight.' : '';
  return `<div class="wz-relb"><div class="wz-g">Related supplementary procedures</div>${why ? `<p class="wz-hint">${why}</p>` : ''}<div class="pr-rel">${list.map((r) => procLink(r.n, r.id)).join('')}</div></div>`;
}

export function wizardHtml() {
  reset();
  return `<section class="wz no-hl" id="wz"><div class="wz-top"><span class="wz-title">Adverse weather</span>
    <span class="wz-act"><button class="tag tag-btn wz-mini" data-wz="back" id="wz-back" hidden>‹ Back</button><button class="tag tag-btn wz-mini" data-wz="reset" id="wz-reset" hidden>Start over</button></span></div>
    <div id="wz-chips" class="wz-chips"></div><div id="wz-wx"></div><div id="wz-body">${questionHtml('place')}</div></section>`;
}

function draw() {
  const root = document.getElementById('wz');
  if (!root) return;
  root.querySelector('#wz-back').hidden = !H.length;
  root.querySelector('#wz-reset').hidden = !H.length;
  root.querySelector('#wz-chips').innerHTML = H.filter((k) => Q[k] && !(k === 'wx' && A.apt)).map((k) => `<button class="wz-chip${SRC[k] ? ' src' : ''}" data-wz-edit="${k}" title="Change this answer">${esc(chipText(k))}${SRC[k] ? '<sup>METAR</sup>' : ''}</button>`).join('')
    + (A.place === 'flt' && fltShown ? `<button class="wz-chip" data-wz="flt-edit" title="Change">${F.size} selected</button>` : '');
  const body = root.querySelector('#wz-body');
  root.querySelector('#wz-wx').innerHTML = wxHtml();
  if (A.place === 'flt') { body.innerHTML = fltShown ? resultHtml(flight()) : flightHtml(); return; }
  const key = nextKey();
  if (key) {
    body.innerHTML = questionHtml(key);
    (body.querySelector('#wz-t') || body.querySelector('#wz-apt'))?.focus();
    return;
  }
  body.innerHTML = resultHtml(A.place === 'dep' ? departure() : arrival());
}

const parseTemp = (s) => {
  const v = Number(String(s).replace(/[−–]/g, '-').replace(',', '.').trim());
  return String(s).trim() === '' || Number.isNaN(v) ? null : v;
};

function readTemp() {
  const el = document.getElementById('wz-t');
  if (!el) return;
  const v = parseTemp(el.value);
  if (v == null || v < -70 || v > 60) { el.classList.add('bad'); el.focus(); return; }
  answer('oat', Math.round(v));
  draw();
}

const flipSign = (el) => { if (!el) return; const s = el.value.trim(); el.value = s.startsWith('-') || s.startsWith('−') ? s.slice(1) : `-${s}`; el.focus(); };

/** Clicks inside the wizard (called from the sheet's click handler). */
export function wizardClick(el) {
  const d = el.dataset;
  if (d.wzAns) {
    const [k, raw] = d.wzAns.split('|');
    answer(k, raw === 'true' ? true : raw === 'false' ? false : raw);
    draw(); return true;
  }
  if (d.wzEdit) { edit(d.wzEdit); draw(); return true; }
  if (d.wzTog) {
    const k = d.wzTog;
    if (F.has(k)) F.delete(k); else F.add(k);
    if (k === 'turbS' && F.has(k)) F.delete('turbL');
    if (k === 'turbL' && F.has(k)) F.delete('turbS');
    draw(); return true;
  }
  if (d.wzX) { A[d.wzX] = !A[d.wzX]; draw(); return true; }
  if (d.wzApt) { pickAirport(d.wzApt); return true; }
  if (d.ctApt) { pickColdAirport(d.ctApt); return true; }
  return false;
}

/** Buttons with data-wz. */
export function wizardAct(action) {
  if (action === 'ok') { readTemp(); return; }
  if (action === 'neg') { flipSign(document.getElementById('wz-t')); return; }
  if (action === 'ctneg') { flipSign(document.getElementById('ct-t')); refreshCold(); return; }
  if (action === 'reset') { reset(); draw(); return; }
  if (action === 'apt-skip') { A.apt = false; H = H.filter((k) => k !== 'apt'); H.push('apt'); draw(); return; }
  if (action === 'wx-refresh') { refreshWx(); return; }
  if (action === 'back') {
    if (A.place === 'flt' && fltShown) { fltShown = false; draw(); return; }
    const k = [...H].reverse()[0];
    if (k) edit(k);
    draw(); return;
  }
  if (action === 'show') { fltShown = true; draw(); return; }
  if (action === 'flt-edit') { fltShown = false; draw(); return; }
  if (action === 'runup') { runT = Date.now(); draw(); return; }
  if (action === 'cold') {
    const c = document.getElementById('wz-cold');
    if (!c) return;
    c.open = true;
    const t = document.getElementById('ct-t');
    if (t && A.oat != null) t.value = A.oat;
    refreshCold();
    c.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }
}

/** Enter in the temperature box. */
export function wizardKey(e) {
  if (e.key !== 'Enter') return;
  if (e.target.id === 'wz-t') { e.preventDefault(); readTemp(); return; }
  const box = e.target.id === 'wz-apt' ? 'wz-sug' : e.target.id === 'ct-apt' ? 'ct-sug' : null;
  if (box) { e.preventDefault(); document.querySelector(`#${box} [data-wz-apt], #${box} [data-ct-apt]`)?.click(); }
}

// ── Airport and METAR ───────────────────────────────────────────────────
const elevTxt = (a) => (a && a.elev != null ? `elevation ${a.elev} ft` : 'elevation not in the database');

function sugHtml(list, attr) {
  if (!nav.ready) return '<div class="wz-hint">Loading the airport list…</div>';
  return list.map((a) => `<button class="wz-opt wz-sugi" data-${attr}="${a.ident}"><b>${a.ident}</b>${a.iata ? `<b class="iata">${a.iata}</b>` : ''} ${esc(a.name)}${a.city ? ` <span class="wz-city">${esc(a.city)}</span>` : ''}</button>`).join('');
}

function ensureNav() { if (!nav.ready) loadNav('data/navdb.json').then(() => { suggest('wz-apt', 'wz-sug', 'wz-apt'); suggest('ct-apt', 'ct-sug', 'ct-apt'); }).catch(() => {}); }

function suggest(inputId, boxId, attr) {
  const inp = document.getElementById(inputId), box = document.getElementById(boxId);
  if (!inp || !box) return;
  const q = inp.value.trim();
  if (q.length < 2) { box.innerHTML = ''; return; }
  ensureNav();
  const list = nav.search(q, 6);
  box.innerHTML = list.length || !nav.ready ? sugHtml(list, attr) : (/^[A-Za-z]{4}$/.test(q) ? `<button class="wz-opt wz-sugi" data-${attr}="${q.toUpperCase()}"><b>${q.toUpperCase()}</b> not in the database — get its METAR</button>` : '<div class="wz-hint">No airport found.</div>');
}

function wxHtml() {
  if (!WX) return '';
  const a = WX.apt;
  const head = `<b>${esc(a.ident)}</b>${a.name ? ` ${esc(a.name)}` : ''} · ${elevTxt(a)}`;
  if (WX.loading) return `<div class="wz-wx"><div>${head}</div><div class="wz-hint">Getting the latest METAR…</div></div>`;
  if (WX.error) return `<div class="wz-wx bad"><div>${head}</div><div class="wz-hint">No METAR available (${esc(WX.error)}). Answer by hand.</div></div>`;
  const age = ageMin(WX.m.time);
  return `<div class="wz-wx${age != null && age > 90 ? ' old' : ''}"><div class="wz-wxh">${head}<button class="tag tag-btn wz-mini" data-wz="wx-refresh">Refresh</button></div>
    <div class="wz-raw">${esc(WX.raw)}</div>
    <div class="wz-hint">Read: ${esc(summary(WX.m))}${age != null ? ` · ${age} min old${age > 90 ? ' — check for a newer report' : ''}` : ''}${A.place === 'arr' ? ' · This is the current report: check the TAF for your arrival time.' : ''}</div></div>`;
}

// Fill answers from the report, but never over an answer the user chose.
function prefill(m) {
  const put = (k, v) => {
    if (v == null || (A[k] != null && !SRC[k])) return;
    A[k] = v; SRC[k] = 'METAR';
    H = H.filter((x) => x !== k); H.push(k);
  };
  if (m.tempC != null) put('oat', Math.round(m.tempC));
  prune();
  if (flow().includes('precip')) put('precip', m.precip);
  if (A.place === 'dep' && m.surface) put('surface', m.surface);
  if (A.place === 'arr' && m.surface) put('arrSurface', m.surface === 'deep' ? 'contam' : m.surface);
  prune();
  // Order the chips as the questions are asked.
  const order = ['place', ...flow()];
  H.sort((x, y) => order.indexOf(x) - order.indexOf(y));
}

async function pickAirport(ident) {
  const a = nav.airport(ident) || { ident, name: '', elev: null };
  A.apt = a; H = H.filter((k) => k !== 'apt'); H.push('apt');
  WX = { apt: a, loading: true };
  draw();
  fillCold(a, null);
  try {
    const raw = await fetchMetar(ident);
    const m = parseMetar(raw);
    WX = { apt: a, raw, m };
    prefill(m);
    fillCold(a, m);
  } catch (e) {
    WX = { apt: a, error: e.message || 'not found' };
  }
  draw();
}

async function refreshWx() {
  if (!A.apt) return;
  for (const k of Object.keys(SRC)) { delete A[k]; H = H.filter((x) => x !== k); }
  SRC = {};
  await pickAirport(A.apt.ident);
}

// The cold correction takes the same airport unless the user typed their own.
function fillCold(a, m) {
  const t = document.getElementById('ct-t'), r = document.getElementById('ct-ref'), ap = document.getElementById('ct-apt');
  if (!t || !r) return;
  const unit = document.querySelector('input[name=ct-u]:checked')?.value || 'ft';
  if (ap && (!ap.value || ap.dataset.auto)) { ap.value = a.ident; ap.dataset.auto = '1'; }
  if (a.elev != null && (!r.value || r.dataset.auto)) { r.value = unit === 'm' ? Math.round(a.elev * 0.3048) : a.elev; r.dataset.auto = '1'; }
  if (m && m.tempC != null && (!t.value || t.dataset.auto)) { t.value = Math.round(m.tempC); t.dataset.auto = '1'; }
  const note = document.getElementById('ct-src');
  if (note) note.textContent = `${a.ident} · ${elevTxt(a)}${m && m.tempC != null ? ` · ${String(Math.round(m.tempC)).replace('-', '−')} °C from METAR ${m.time || ''}` : ''} — edit any value to override.`;
  refreshCold();
}

async function pickColdAirport(ident) {
  const a = nav.airport(ident) || { ident, name: '', elev: null };
  for (const id of ['ct-apt', 'ct-ref', 'ct-t']) { const el = document.getElementById(id); if (el) { el.dataset.auto = '1'; if (id !== 'ct-apt') el.value = ''; } }
  document.getElementById('ct-sug').innerHTML = '';
  fillCold(a, null);
  try { fillCold(a, parseMetar(await fetchMetar(ident))); } catch { /* elevation still filled */ }
}

/** Typing in the airport boxes and the cold correction (from the sheet's input handler). */
export function wizardInput(e) {
  const id = e.target.id;
  if (id === 'wz-apt') { suggest('wz-apt', 'wz-sug', 'wz-apt'); return; }
  if (id === 'ct-apt') { delete e.target.dataset.auto; suggest('ct-apt', 'ct-sug', 'ct-apt'); return; }
  if (e.target.closest?.('#wz-cold')) { if (e.type === 'input') delete e.target.dataset.auto; refreshCold(); }
}

// ── Cold temperature altitude correction (SP.16.13–14) ─────────────────
const NUM = (s) => Number(String(s).replace('−', '-').replace('°C', '').trim());

/**
 * One altitude corrected with the SP.16.14 table. The table has 10 °C rows
 * and fixed heights; between them this takes the colder row and the higher
 * height column (the larger correction). Above the last column the correction
 * grows linearly (SP.16.13: 6,000 ft takes twice the 3,000 ft figure).
 * No correction when the airport is above 0 °C (SP.16.13).
 */
export function coldCorrection({ temp, alt, refElev, unit }) {
  const tb = SP16.tables[unit === 'm' ? 1 : 0];
  const heads = tb.head.map(Number);
  const rows = tb.rows.map(([lbl, vals]) => ({ t: NUM(lbl), vals }));
  const u = unit === 'm' ? 'm' : 'ft';
  const steps = [];
  if (temp > 0) return { corr: 0, corrected: alt, steps: ['Airport above 0 °C: no correction.'] };
  if (temp < -50) return { error: 'Below −50 °C is outside the table.' };
  const h = alt - refElev;
  steps.push(`Height above the airport: ${alt} − ${refElev} = ${h} ${u}`);
  if (h <= 0) return { corr: 0, corrected: alt, steps };
  const row = rows.filter((r) => r.t <= temp).sort((a, b) => b.t - a.t)[0] || rows[rows.length - 1];
  steps.push(`Row ${row.t} °C${row.t !== temp ? ' (next colder)' : ''}`);
  const last = heads[heads.length - 1];
  let corr;
  if (h > last) {
    corr = Math.round(row.vals[heads.length - 1] * (h / last));
    steps.push(`Above ${last} ${u}: ${row.vals[heads.length - 1]} × ${h} / ${last} = ${corr} ${u}`);
  } else {
    const ci = heads.findIndex((x) => x >= h);
    corr = row.vals[ci];
    steps.push(`Column ${heads[ci]} ${u}${heads[ci] !== h ? ' (next higher)' : ''}: + ${corr} ${u}`);
  }
  return { corr, corrected: alt + corr, steps };
}

// The MCP is in feet: the next 100 ft above the corrected altitude (SP.16.13).
const mcpFt = (v, unit) => Math.ceil((unit === 'm' ? v * 3.28084 : v) / 100) * 100;

// [input id, what, where it is set, set on the MCP too]
const ALTS = [
  ['ct-min', 'Minimum altitude (fix, step-down or segment)', 'FMC LEGS altitude constraint, and the MCP', true],
  ['ct-mda', 'DA / MDA', 'MINS (BARO) on the EFIS control panel', false],
  ['ct-missed', 'Missed approach altitude', 'FMC LEGS constraint, and the MCP for the go-around', true],
];

export function coldHtml() {
  return `<details class="wz wz-cold no-hl" id="wz-cold"><summary><span class="wz-title">Cold temperature altitude correction</span> <span class="qr-ref">SP.16.13–14</span></summary>
    <div class="wz-cold-in">
      <label class="wz-q">Airport <span class="qr-ref">fills temperature and elevation</span><input id="ct-apt" type="text" class="wz-in" placeholder="ICAO or name" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
      <div id="ct-sug" class="wz-sug"></div>
      <div id="ct-src" class="wz-hint"></div>
      <div class="wz-row2">
        <label class="wz-q">Airport temperature, °C<span class="wz-numrow"><button class="tag tag-btn wz-pm" data-wz="ctneg" aria-label="Plus or minus">±</button><input id="ct-t" type="text" inputmode="numeric" class="wz-in" placeholder="15" autocomplete="off"></span></label>
        <label class="wz-q">Airport elevation<input id="ct-ref" type="number" inputmode="numeric" class="wz-in" placeholder="0"></label>
      </div>
      <div class="wz-units"><label><input type="radio" name="ct-u" value="ft" checked> feet</label><label><input type="radio" name="ct-u" value="m"> metres</label></div>
      <div class="wz-g">Published altitudes — fill in what you need</div>
      ${ALTS.map(([id, n]) => `<label class="wz-q">${esc(n)}<input id="${id}" type="number" inputmode="numeric" class="wz-in"></label>`).join('')}
      <div id="ct-out" class="wz-res"></div>
      <p class="wz-hint">Not needed under radar vectors, at an assigned flight level, or when the airport is above 0 °C or at or above the procedure's published minimum temperature. Do not correct the altimeter setting. Tell ATC.</p>
    </div></details>`;
}

export function refreshCold() {
  const out = document.getElementById('ct-out');
  if (!out) return;
  const val = (id) => document.getElementById(id)?.value.trim() ?? '';
  const unit = document.querySelector('input[name=ct-u]:checked')?.value || 'ft';
  const temp = parseTemp(val('ct-t'));
  const ref = parseTemp(val('ct-ref')) ?? 0;
  if (temp == null) { out.innerHTML = '<p class="wz-none">Enter the airport temperature.</p>'; return; }
  if (temp > 0) { out.innerHTML = '<p class="wz-none">Airport above 0 °C: no correction needed.</p>'; return; }
  const rows = ALTS.map(([id, n, where, mcp]) => {
    const a = parseTemp(val(id));
    if (a == null) return '';
    const cc = coldCorrection({ temp, alt: a, refElev: ref, unit });
    if (cc.error) return `<div class="wz-set"><div class="wz-sl">${esc(n)}</div><div class="wz-none">${esc(cc.error)}</div></div>`;
    const c = Math.round(cc.corrected);
    const mcpLine = mcp ? `<div class="wz-sw">MCP <b>${mcpFt(c, unit)} ft</b> (next 100 ft above)</div>` : '';
    return `<div class="wz-set"><div class="wz-sl">${esc(n)}</div>
      <div class="wz-sv">${a} → <b>${c} ${unit}</b>${cc.corr ? ` <span class="wz-plus">+${cc.corr}</span>` : ''}</div>
      ${mcpLine}<div class="wz-sw">Set in: ${esc(where)}</div>
      <details class="wz-work"><summary>How</summary><ol>${cc.steps.map((s) => `<li>${esc(s)}</li>`).join('')}</ol></details></div>`;
  }).join('');
  out.innerHTML = rows || '<p class="wz-none">Enter the published altitudes you need.</p>';
}
