// panel.js — the two read-outs beside the map: the flight list and the detail
// sheet for one selected flight.
//
// Everything rendered here comes from a third-party feed, so every value goes
// through esc() before it reaches innerHTML — an aircraft's "registration" is
// whatever the transponder and the database say it is, not something we trust.

import * as fmt from './fmt.js?v=15';
import { altColor, familyOf, planeSvg, classLine } from './aircraft.js?v=15';
import { routeLabel, progress, haversine, eta, routeSanity } from './routes.js?v=15';
import { squawkAlert } from './adsb.js?v=15';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** The scrollable list of flights currently in view. */
export function renderList(el, list, { selectedHex, routeFor, onPick, emptyMessage }) {
  if (!list.length) {
    const m = emptyMessage || { title: 'No airline traffic in view.', hint: '' };
    el.innerHTML = `<div class="list-empty">${esc(m.title)}<br>
      <span>${esc(m.hint || '')}</span></div>`;
    return;
  }
  const rows = list.map((ac) => {
    const route = routeFor(ac.callsign);
    const r = routeLabel(route);
    const sel = ac.hex === selectedHex ? ' sel' : '';
    const alert = squawkAlert(ac.squawk) || ac.emergency;
    // Prefer the local table, fall back to whatever adsbdb told us about this
    // callsign, and only then show the bare operator code.
    const who = (ac.airline && ac.airline.name)
      || (route && route.airline && route.airline.name) || ac.code;
    // ETA rides on the route line: it is only meaningful next to the city pair.
    const arr = ac.ghost ? null : eta(ac, route);
    const etaBit = arr && arr.at ? ` · ETA ${fmt.hhmmZ(arr.at)}` : '';
    const right = ac.ghost
      ? `<span class="fl-alt ghosted">${esc(fmt.since(ac.lastSeenAt))}</span>
         <span class="fl-type">last seen</span>`
      : `<span class="fl-alt">${esc(fmt.alt(ac.alt, ac.onGround))}</span>
         <span class="fl-type">${esc(ac.type || '')}</span>`;
    return `<button class="fl-row${sel}${ac.ghost ? ' ghost' : ''}" data-hex="${esc(ac.hex)}">
      <span class="fl-dot" style="background:${ac.ghost ? '#9aa6bd' : altColor(ac.alt)}"></span>
      <span class="fl-main">
        <span class="fl-cs">${esc(ac.callsign || ac.reg)}${alert ? '<em class="fl-alert">!</em>' : ''}</span>
        <span class="fl-sub">${esc(who)}${r ? ` · ${esc(r)}` : ''}${esc(etaBit)}${ac.reg && ac.callsign ? ` · ${esc(ac.reg)}` : ''}</span>
      </span>
      <span class="fl-right">${right}</span>
    </button>`;
  }).join('');
  el.innerHTML = rows;
  el.querySelectorAll('.fl-row').forEach((b) => {
    b.addEventListener('click', () => onPick(b.dataset.hex));
  });
}

/** The detail sheet for one flight. `route` / `info` may still be loading. */
// Every row the card can ever show, in a fixed order. The set never changes
// between refreshes — a value that isn't known reads "—" rather than removing
// its row — because rows appearing and disappearing every five seconds is what
// made the card jump under the reader's finger.
//
// The aircraft's model and registration used to live here too. They don't any
// more: the header now leads with the tail and a "model · airline · callsign"
// subtitle, and a value repeated verbatim two inches below itself is not a
// second piece of information.
const CELLS = [
  ['class', 'Family / class'],
  ['gs', 'Ground speed'],
  ['ias', 'IAS / Mach'],
  ['track', 'Track'],
  ['alt', 'Altitude'],
  ['navalt', 'Selected alt'],
  ['qnh', 'QNH set'],
  ['wind', 'Wind aloft'],
  ['oat', 'OAT'],
  ['squawk', 'Squawk'],
  ['hex', 'Mode S'],
  ['operator', 'Operator'],
  ['seen', 'Position'],
];
export const CELL_KEYS = CELLS.map(([k]) => k);
// Fifteen equal cells was the same as no hierarchy at all. These four are the
// ones a pilot glances at most; anyone can pin a different set from here.
export const DEFAULT_PINNED = ['gs', 'navalt', 'track', 'squawk'];

let builtFor = '';       // hex the current skeleton belongs to
let currentEditing = false;   // read by the grid's delegated click listener

// Two 48px icon actions beside Follow, which is the one people actually want —
// three equal-width text buttons said the three choices were equally likely.
const ICON_ROUTE = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 18 20 6"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="6" r="2"/></svg>`;
const ICON_CENTER = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2" fill="currentColor" stroke="none"/></svg>`;

/** The card's fixed structure. Built once per aircraft, then only filled in. */
function skeleton() {
  return `
    <div class="sheet-grip" aria-hidden="true"></div>
    <div class="sheet-alert" data-f="alert" hidden></div>
    <div class="sheet-ghost" data-f="ghost" hidden></div>
    <header class="sheet-head">
      <div class="sheet-id">
        <h2 data-f="tail"></h2>
        <p data-f="subtitle"></p>
      </div>
      <div class="sheet-alt">
        <b data-f="level"></b>
        <span data-f="vspeed"></span>
      </div>
      <button class="sheet-close" aria-label="Close">✕</button>
    </header>

    <div data-f="route-strip"></div>
    <div data-f="arrival"></div>

    <div class="sheet-actions">
      <button class="act act-primary" data-act="follow" data-f="follow-btn">Follow</button>
      <button class="act act-icon" data-act="fit" data-f="fit-btn" title="Show route" aria-label="Show route">${ICON_ROUTE}</button>
      <button class="act act-icon" data-act="center" data-f="center-btn" title="Centre" aria-label="Centre">${ICON_CENTER}</button>
    </div>

    <div class="values-head">
      <span>Your pinned values</span>
      <span class="values-rule"></span>
      <button type="button" class="values-edit" data-act="toggle-edit" data-f="edit-btn">Edit</button>
    </div>
    <div class="sheet-grid" data-f="grid">
      ${CELLS.map(([k, label]) =>
    `<div class="cellv" data-key="${k}"><span>${esc(label)}</span><b data-f="c-${k}">—</b></div>`).join('')}
    </div>
    <button type="button" class="fold-row" data-act="toggle-fold" data-f="fold-row">
      <span data-f="fold-text"></span>
      <span class="fold-arrow" data-f="fold-arrow"></span>
    </button>

    <figure class="sheet-photo" data-f="photo" hidden>
      <img alt="" loading="lazy" referrerpolicy="no-referrer">
      <figcaption>Photo: airport-data.com</figcaption>
    </figure>

    <p class="sheet-note" data-f="note" hidden></p>

    <div class="sheet-footer" data-f="footer" hidden>
      <span class="footer-dot"></span>
      <span data-f="footer-text"></span>
    </div>`;
}

/**
 * Draw or update the card for one aircraft.
 *
 * The structure is built once and then patched in place. Replacing innerHTML
 * on every 5-second refresh reflowed the whole card — text you were reading
 * moved, and a tap could land on a button that had just shifted.
 */
export function renderDetail(el, ac, route, info, {
  following, arrival, onAction, pinned, editing, foldOpen,
}) {
  if (!ac) { el.innerHTML = ''; builtFor = ''; return; }

  currentEditing = !!editing;   // read by the grid's delegated click listener below

  if (builtFor !== ac.hex) {
    el.innerHTML = skeleton();
    builtFor = ac.hex;
    // Wire once per skeleton, so listeners can't stack up across refreshes.
    // Every button carries its own action; a click just relays it upward — this
    // module renders and reports, it doesn't decide what an action means.
    el.querySelectorAll('[data-act]').forEach((b) => {
      b.addEventListener('click', () => onAction && onAction(b.dataset.act));
    });
    const close = el.querySelector('.sheet-close');
    if (close) close.addEventListener('click', () => onAction && onAction('close'));
    const img = el.querySelector('.sheet-photo img');
    if (img) {
      img.addEventListener('error', () => {
        // Remember which URL failed: the next refresh patches the same src back
        // in, and without this the broken-image icon returns every five seconds.
        img.dataset.failed = img.getAttribute('src') || '';
        el.querySelector('[data-f="photo"]').hidden = true;
      });
    }
    // Pinning is a tap on the cell itself, not a separate control per cell —
    // but only while editing, so an ordinary tap on a value never does
    // anything by surprise. currentEditing is read fresh on every click,
    // not captured here, because Edit can be toggled long after this
    // listener was attached without the skeleton being rebuilt.
    const grid = el.querySelector('[data-f="grid"]');
    if (grid) {
      grid.addEventListener('click', (e) => {
        if (!currentEditing) return;
        const cell = e.target.closest('.cellv');
        if (cell && onAction) onAction('pin', cell.dataset.key);
      });
    }
  }

  const f = (name) => el.querySelector(`[data-f="${name}"]`);
  const set = (name, text) => { const n = f(name); if (n && n.textContent !== text) n.textContent = text; };

  const airlineName = (route && route.airline && route.airline.name)
    || (ac.airline && ac.airline.name)
    || (info && info.owner) || ac.code;
  // airlines.js stores the country as an ISO-2 code, which is what flag() wants.
  const iso = (route && route.airline && route.airline.countryIso)
    || (ac.airline && ac.airline.country) || '';
  const flightIata = route && route.iata ? route.iata : '';
  const family = familyOf(ac.type, ac.desc || (info && info.type));

  // The tail leads: crews recognise aeroplanes, not callsigns. Model, airline
  // and callsign move to one subtitle line underneath — each already appears
  // nowhere else on the card, so nothing here is said twice.
  set('tail', ac.reg || (info && info.reg) || ac.hex.toUpperCase());
  set('subtitle', [family, `${fmt.flag(iso)} ${airlineName}`.trim(), flightIata ? `${ac.callsign} · ${flightIata}` : ac.callsign]
    .filter(Boolean).join(' · '));
  set('level', fmt.alt(ac.alt, ac.onGround));
  set('vspeed', ac.ghost ? fmt.ago(ac.lastSeenAt) : fmt.vs(ac.vs));
  const altBox = el.querySelector('.sheet-alt');
  if (altBox) altBox.style.color = ac.ghost ? '#9aa6bd' : altColor(ac.alt);

  const alert = squawkAlert(ac.squawk) || (ac.emergency ? `Emergency: ${ac.emergency}` : '');
  const alertEl = f('alert');
  alertEl.hidden = !alert;
  if (alert) set('alert', alert);

  const ghostEl = f('ghost');
  ghostEl.hidden = !ac.ghost;
  if (ac.ghost) {
    ghostEl.innerHTML = `${ac.wentDark
      ? `Contact lost ${esc(fmt.ago(ac.lastSeenAt))}, airborne at ${esc(fmt.alt(ac.alt, ac.onGround))}.`
      : `Not transmitting. Last seen ${esc(fmt.ago(ac.lastSeenAt))}.`}
      <span>The symbol marks that last position — it is a memory, not a track.</span>`;
  }

  // Route strip and answer line are compact enough to re-render wholesale, and
  // their height is fixed, so they can't shove anything around. The dispute
  // explainer's click listener has to be re-bound every time this HTML is
  // replaced — but only then, since an untouched node keeps its listener.
  const rs = f('route-strip');
  const rsHtml = routeStrip(ac, route, arrival);
  if (rs.innerHTML !== rsHtml) rs.innerHTML = rsHtml;
  const ar = f('arrival');
  const arHtml = arrivalBlock(ac, route, arrival);
  if (ar.innerHTML !== arHtml) {
    ar.innerHTML = arHtml;
    const disputeBtn = ar.querySelector('.badge.disputed');
    const explain = ar.querySelector('.badge-explain');
    if (disputeBtn && explain) {
      disputeBtn.addEventListener('click', () => { explain.hidden = !explain.hidden; });
    }
  }

  const followBtn = f('follow-btn');
  followBtn.hidden = !!ac.ghost;
  followBtn.textContent = following ? 'Following' : 'Follow';
  followBtn.classList.toggle('on', !!following);
  const centerBtn = f('center-btn');
  const centerLabel = ac.ghost ? 'Go to last position' : 'Centre';
  centerBtn.title = centerLabel;
  centerBtn.setAttribute('aria-label', centerLabel);

  set('c-class', ac.type ? classLine(ac.type, ac.category) : '—');
  set('c-gs', fmt.kt(ac.gs));
  set('c-ias', ac.ias || ac.mach
    ? `${ac.ias ? Math.round(ac.ias) : '—'}${ac.mach ? ` / M${ac.mach.toFixed(2)}` : ''}`
    : '—');
  set('c-track', fmt.deg(ac.track));
  set('c-alt', fmt.feet(ac.alt));
  set('c-navalt', ac.nav_alt ? fmt.feet(Math.round(ac.nav_alt / 100) * 100) : '—');
  set('c-qnh', ac.qnh ? `${ac.qnh.toFixed(1)} hPa` : '—');
  set('c-wind', ac.wind ? `${fmt.deg(ac.wind.dir)} / ${Math.round(ac.wind.speed)} kt` : '—');
  set('c-oat', ac.oat !== null && ac.oat !== undefined ? `${Math.round(ac.oat)} °C` : '—');
  set('c-squawk', ac.squawk || '—');
  set('c-hex', ac.hex.toUpperCase());
  set('c-operator', (info && info.owner) || '—');
  set('c-seen', fmt.age(ac.seen));

  // Which cells show: pinned ones always, the rest only while editing (so
  // there's something to pin) or while the fold is open. Editing shows every
  // cell rather than only the pinned four — you have to see a value to pin it.
  const pinnedSet = pinned || new Set();
  const showAll = !!editing || !!foldOpen;
  let unpinnedCount = 0;
  el.querySelectorAll('.cellv[data-key]').forEach((cell) => {
    const key = cell.dataset.key;
    const isPinned = pinnedSet.has(key);
    if (!isPinned) unpinnedCount++;
    cell.classList.toggle('pinned', isPinned);
    cell.hidden = !(isPinned || showAll);
  });
  const grid = f('grid');
  if (grid) grid.classList.toggle('editing', !!editing);
  const editBtn = f('edit-btn');
  if (editBtn) editBtn.textContent = editing ? 'Done' : 'Edit';
  const foldRow = f('fold-row');
  if (foldRow) {
    foldRow.hidden = !!editing || unpinnedCount === 0;
    set('fold-text', `Everything else — ${unpinnedCount} value${unpinnedCount === 1 ? '' : 's'}`);
    set('fold-arrow', foldOpen ? 'Close ▴' : 'Open ▾');
  }

  const photo = f('photo');
  const src = info && (info.photo || info.thumb);
  const img = photo.querySelector('img');
  if (src && img.getAttribute('src') !== src) { img.src = src; img.alt = info.reg || ac.reg || ''; }
  photo.hidden = !src || img.dataset.failed === src;

  const note = f('note');
  note.hidden = !!route;
  if (!route) {
    set('note', 'No route on file for this callsign — adsbdb only knows scheduled city pairs, so charters and repositioning flights show up blank.');
  }

  // One line of trust: how fresh the position is, and — only for the aircraft
  // being watched — how much of its track is real. This replaces what used to
  // be a whole paragraph about the dashed line back to the origin; the badge
  // system above now carries that kind of caveat.
  const footer = f('footer');
  if (ac.ghost) {
    footer.hidden = true;
  } else {
    footer.hidden = false;
    const span = arrival && arrival.track;
    set('footer-text', span && span.points >= 2
      ? `Position ${fmt.age(ac.seen)} · track watched for ${fmt.dur(span.minutes)}`
      : `Position ${fmt.age(ac.seen)}`);
  }
}

/**
 * The airline picker: every operator currently in view, busiest first, with the
 * ones already chosen pinned to the top so a selection can always be undone
 * even after its aircraft have flown out of the area.
 *
 * @param {Array<{code,name,count}>} options
 * @param {Set<string>} selected
 */
export function renderAirlines(el, options, selected, {
  query, onToggle, onClear, kinds, kindCounts, onToggleKind, tierInfo,
}) {
  const q = String(query || '').trim().toUpperCase();
  const rows = options
    .filter((o) => !q || o.code.includes(q) || o.name.toUpperCase().includes(q))
    .sort((a, b) => {
      const sa = selected.has(a.code) ? 0 : 1;
      const sb = selected.has(b.code) ? 0 : 1;
      if (sa !== sb) return sa - sb;
      if (b.count !== a.count) return b.count - a.count;
      return a.name.localeCompare(b.name);
    });

  // Which layers are drawn at all comes before which airline within them.
  const kindRows = (kinds || []).map(({ key, label, on, count, muted }) => `
    <button class="kind-row${on ? ' on' : ''}${muted ? ' muted' : ''}" data-kind="${esc(key)}">
      <span class="pick-tick">${on ? '✓' : ''}</span>
      <span class="pick-name">${esc(label)}${muted ? '<i>hidden — zoomed out</i>' : ''}</span>
      <span class="pick-count">${count || ''}</span>
    </button>`).join('');

  // The rule that decides which traffic gets a full symbol+label, which gets
  // muted, and which is just a dot — stated here, once, so nothing on the map
  // is quietly hidden without an explanation the user can find.
  const tierNote = tierInfo ? `<p class="pick-info">Full detail within ${esc(String(tierInfo.near))} NM
    — and always for your own fleet or the selected flight. Dimmed
    ${esc(String(tierInfo.near))}–${esc(String(tierInfo.far))} NM. Beyond that, just a dot.</p>` : '';

  el.innerHTML = `
    <div class="pick-head"><b>Show on the map</b></div>
    <div class="kind-list">${kindRows}</div>
    ${tierNote}
    <div class="pick-head">
      <b>Airlines in view</b>
      <button class="pick-clear" ${selected.size ? '' : 'disabled'}>Show all</button>
    </div>
    <label class="pick-search">
      <input type="search" id="airline-q" placeholder="Filter airlines" value="${esc(query || '')}"
             autocomplete="off" aria-label="Filter airlines">
    </label>
    <div class="pick-list">
      ${rows.length ? rows.map((o) => `
        <button class="pick-row${selected.has(o.code) ? ' on' : ''}" data-code="${esc(o.code)}">
          <span class="pick-tick">${selected.has(o.code) ? '✓' : ''}</span>
          <span class="pick-name">${esc(o.name)}<i>${esc(o.code)}</i></span>
          <span class="pick-count">${o.count || ''}</span>
        </button>`).join('')
    : '<div class="pick-empty">No airlines match.</div>'}
    </div>`;

  el.querySelectorAll('.pick-row').forEach((b) => {
    b.addEventListener('click', () => onToggle(b.dataset.code));
  });
  el.querySelectorAll('.kind-row').forEach((b) => {
    b.addEventListener('click', () => onToggleKind && onToggleKind(b.dataset.kind));
  });
  el.querySelector('.pick-clear').addEventListener('click', onClear);
}

/**
 * The View sheet: display preferences the reader sets once and shouldn't have
 * to keep looking at afterwards, moved off the map into labelled switches —
 * each with the one-line explanation a bare icon can't give — plus the
 * altitude legend, which only needs explaining in one place.
 *
 * @param {Array<{key,label,desc,on}>} rows
 * @param {Array<[label,color]>} legend
 */
export function renderView(el, rows, legend, { onToggle }) {
  const rowHtml = rows.map(({ key, label, desc, on }) => `
    <button class="view-row" data-view="${esc(key)}" aria-pressed="${on}">
      <span class="view-row-text"><b>${esc(label)}</b><i>${esc(desc)}</i></span>
      <span class="switch" aria-hidden="true"><span class="switch-knob"></span></span>
    </button>`).join('');

  el.innerHTML = `
    <div class="pick-head"><b>View</b></div>
    <div class="view-list">${rowHtml}</div>
    <div class="pick-head"><b>Altitude colour</b></div>
    <div class="legend-inline">${(legend || []).map(([label, color]) =>
    `<span><i style="background:${color}"></i>${esc(label)}</span>`).join('')}</div>`;

  el.querySelectorAll('[data-view]').forEach((b) => {
    b.addEventListener('click', () => onToggle && onToggle(b.dataset.view));
  });
}

function routeStrip(ac, route, arrival) {
  if (!route || (!route.origin && !route.destination)) {
    return `<div class="route-strip empty">${esc(routeLabel(route) || 'Route unknown')}</div>`;
  }
  const o = route.origin, d = route.destination;
  const pct = progress(route, ac.lat, ac.lon);
  const toGo = d && Number.isFinite(d.lat) ? haversine(ac.lat, ac.lon, d.lat, d.lon) : null;
  const gone = o && Number.isFinite(o.lat) ? haversine(o.lat, o.lon, ac.lat, ac.lon) : null;
  const mins = arrival && arrival.eta ? arrival.eta.minutes : null;
  const sanity = routeSanity(ac, route);

  // The "route may be wrong" explanation used to be a paragraph pinned above
  // this bar. It's now a badge below the fold — the tint here is the only
  // ambient trace of doubt, and it's enough: the reader either isn't looking
  // closely (fine, nothing broke) or taps the badge for the actual reason.
  return `<div class="route-strip${sanity.ok ? '' : ' doubted'}">
    <div class="rs-end">
      <b>${esc(o ? (o.iata || o.icao) : '—')}</b>
      <span>${esc(o ? (o.city || o.name) : 'Unknown origin')}</span>
    </div>
    <div class="rs-mid">
      <div class="rs-bar"><i style="width:${pct === null ? 0 : Math.round(pct * 100)}%"></i>
        <span class="rs-plane" style="left:${pct === null ? 0 : Math.round(pct * 100)}%">${
  // Our own silhouette at track 090 — it points right, along the bar, towards
  // the destination. The ✈ glyph was rotated per-font and pointed anywhere.
  planeSvg({ color: '#ffffff', track: 90, scale: 0.52 })}</span></div>
      <div class="rs-meta">
        ${gone !== null ? `<span>${esc(fmt.nm(gone))} flown</span>` : '<span></span>'}
        ${Number.isFinite(mins) ? `<span>${esc(fmt.dur(mins))} to run</span>`
    : (toGo !== null ? `<span>${esc(fmt.nm(toGo))} to go</span>` : '<span></span>')}
      </div>
    </div>
    <div class="rs-end right">
      <b>${esc(d ? (d.iata || d.icao) : '—')}</b>
      <span>${esc(d ? (d.city || d.name) : 'Unknown destination')}</span>
    </div>
  </div>`;
}

/**
 * The answer, in one sentence, plus badges saying where each number in it came
 * from.
 *
 * Three kinds of fact end up on this card, and they deserve three different
 * amounts of trust: what the aircraft broadcast (the default — true as ADS-B
 * gets, so it earns no badge at all), what this app worked out from that
 * (COMPUTED HERE — good arithmetic, no descent profile, runs a few minutes
 * optimistic), and what a third-party database claims on the strength of a
 * callsign that gets reused (CLAIMED BY A DATABASE — the layer that produces
 * a wrong answer often enough to need calling out, so its badge reads ROUTE
 * DISPUTED the moment the aircraft's own telemetry contradicts it).
 *
 * ATA is the interesting middle case: it's not computed, it's *observed* — we
 * watched this aircraft go from airborne to on-ground — so once it lands the
 * badge disappears rather than changing, because a landing you watched happen
 * is back to being as true as ADS-B gets.
 */
function arrivalBlock(ac, route, arrival) {
  if (!arrival || (!arrival.eta && !arrival.staAt && !arrival.ataAt)) return '';
  const eta = arrival.eta;
  const etaAt = eta && eta.at ? eta.at : 0;
  const staAt = arrival.staAt || 0;
  const ataAt = arrival.ataAt || 0;

  // Once it's down, the actual time is the one that matters and the estimate is
  // history — so ATA replaces ETA in the same slot rather than sitting beside
  // it, and the difference is measured against whichever is the live answer.
  const actual = !!ataAt;
  const compareAt = ataAt || etaAt;

  let deltaText = '', deltaCls = '';
  if (compareAt && staAt) {
    const mins = Math.round((compareAt - staAt) / 60000);
    const late = mins > 0;
    if (Math.abs(mins) > 6 * 60) {
      // Hours apart means the scheduled time isn't this leg's — a stale roster
      // entry, or the tail flying a different sector. Saying "5h early" would
      // be worse than saying nothing.
      deltaText = "schedule doesn't match this leg"; deltaCls = 'off';
    } else if (Math.abs(mins) < 3) {
      deltaText = actual ? 'landed on schedule' : 'on schedule'; deltaCls = 'on';
    } else {
      deltaText = `${actual ? 'landed ' : ''}${fmt.dur(Math.abs(mins))} ${late ? 'late' : 'early'}${actual ? '' : ' (est.)'}`;
      deltaCls = late ? 'late' : 'early';
    }
  }

  let headline = '';
  if (actual) headline = `Landed ${fmt.hhmmZ(ataAt)}`;
  else if (ac.onGround) headline = 'On the ground';
  else if (etaAt) headline = `Lands ${fmt.hhmmZ(etaAt)}`;
  else if (route) headline = ''; // routeStrip's own empty-state carries this

  const metaBits = [];
  if (!actual && eta && Number.isFinite(eta.minutes)) metaBits.push(fmt.dur(eta.minutes) + ' to run');
  if (deltaText) metaBits.push(deltaText);

  const sanity = routeSanity(ac, route);
  const badges = [];
  if (!actual && etaAt) badges.push('<span class="badge computed">COMPUTED HERE</span>');
  if (staAt) badges.push(`<span class="badge neutral">STA FROM ${esc((arrival.staSource || 'roster').toUpperCase())}</span>`);
  let explainHtml = '';
  if (!sanity.ok) {
    badges.push('<button type="button" class="badge disputed">ROUTE DISPUTED <span class="badge-i">ⓘ</span></button>');
    explainHtml = `<p class="badge-explain" hidden>Route may be wrong — ${esc(sanity.reason)}. Callsign routes come from a schedule database, and callsigns get reused.</p>`;
  }

  if (!headline && !badges.length) return '';

  return `<div class="answer-line">
    ${headline ? `<div class="answer-headline${deltaCls ? ` ${deltaCls}` : ''}">
      <b>${esc(headline)}</b>
      ${metaBits.length ? `<span>${esc(metaBits.join(' · '))}</span>` : ''}
    </div>` : ''}
    ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}
    ${explainHtml}
  </div>`;
}

