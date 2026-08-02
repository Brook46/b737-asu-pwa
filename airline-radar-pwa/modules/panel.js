// panel.js — the two read-outs beside the map: the flight list and the detail
// sheet for one selected flight.
//
// Everything rendered here comes from a third-party feed, so every value goes
// through esc() before it reaches innerHTML — an aircraft's "registration" is
// whatever the transponder and the database say it is, not something we trust.

import * as fmt from './fmt.js';
import { altColor, familyOf, planeSvg } from './aircraft.js';
import { routeLabel, progress, haversine, eta, routeSanity } from './routes.js';
import { squawkAlert } from './adsb.js';

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
const CELLS = [
  ['type', 'Aircraft'],
  ['reg', 'Registration'],
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

let builtFor = '';   // hex the current skeleton belongs to

/** The card's fixed structure. Built once per aircraft, then only filled in. */
function skeleton() {
  return `
    <div class="sheet-grip" aria-hidden="true"></div>
    <div class="sheet-alert" data-f="alert" hidden></div>
    <div class="sheet-ghost" data-f="ghost" hidden></div>
    <header class="sheet-head">
      <div class="sheet-id">
        <h2 data-f="callsign"></h2>
        <p data-f="operator-line"></p>
      </div>
      <div class="sheet-alt">
        <b data-f="tail"></b>
        <span data-f="level"></span>
      </div>
      <button class="sheet-close" aria-label="Close">✕</button>
    </header>

    <div data-f="route-strip"></div>
    <div data-f="arrival"></div>

    <div class="sheet-actions">
      <button class="act" data-act="follow" data-f="follow-btn">Follow</button>
      <button class="act" data-act="fit">Show route</button>
      <button class="act" data-act="center" data-f="center-btn">Centre</button>
    </div>

    <div class="sheet-grid">
      ${CELLS.map(([k, label]) =>
    `<div class="cellv"><span>${esc(label)}</span><b data-f="c-${k}">—</b></div>`).join('')}
    </div>

    <figure class="sheet-photo" data-f="photo" hidden>
      <img alt="" loading="lazy" referrerpolicy="no-referrer">
      <figcaption>Photo: airport-data.com</figcaption>
    </figure>

    <p class="sheet-note" data-f="track-note" hidden></p>
    <p class="sheet-note" data-f="note" hidden></p>`;
}

/**
 * Draw or update the card for one aircraft.
 *
 * The structure is built once and then patched in place. Replacing innerHTML
 * on every 5-second refresh reflowed the whole card — text you were reading
 * moved, and a tap could land on a button that had just shifted.
 */
export function renderDetail(el, ac, route, info, { following, arrival, onAction }) {
  if (!ac) { el.innerHTML = ''; builtFor = ''; return; }

  if (builtFor !== ac.hex) {
    el.innerHTML = skeleton();
    builtFor = ac.hex;
    // Wire once per skeleton, so listeners can't stack up across refreshes.
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

  set('callsign', ac.callsign || ac.reg || '');
  set('operator-line', `${fmt.flag(iso)} ${airlineName}${flightIata ? ` · ${flightIata}` : ''}`.trim());

  // The aeroplane's own name leads here too; the level sits under it.
  set('tail', ac.reg || (info && info.reg) || ac.hex.toUpperCase());
  set('level', ac.ghost
    ? `${fmt.alt(ac.alt, ac.onGround)} · ${fmt.ago(ac.lastSeenAt)}`
    : `${fmt.alt(ac.alt, ac.onGround)} · ${fmt.vs(ac.vs)}`);
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

  // Route strip and arrival block are compact enough to re-render wholesale,
  // and their height is fixed, so they can't shove anything around.
  const rs = f('route-strip');
  const rsHtml = routeStrip(ac, route, arrival);
  if (rs.innerHTML !== rsHtml) rs.innerHTML = rsHtml;
  const ar = f('arrival');
  const arHtml = arrivalBlock(ac, arrival);
  if (ar.innerHTML !== arHtml) ar.innerHTML = arHtml;

  const followBtn = f('follow-btn');
  followBtn.hidden = !!ac.ghost;
  followBtn.textContent = following ? 'Following' : 'Follow';
  followBtn.classList.toggle('on', !!following);
  set('center-btn', ac.ghost ? 'Go to last position' : 'Centre');

  set('c-type', familyOf(ac.type, ac.desc || (info && info.type)) || '—');
  set('c-reg', ac.reg || (info && info.reg) || '—');
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

  const photo = f('photo');
  const src = info && (info.photo || info.thumb);
  const img = photo.querySelector('img');
  if (src && img.getAttribute('src') !== src) { img.src = src; img.alt = info.reg || ac.reg || ''; }
  photo.hidden = !src || img.dataset.failed === src;

  // Say what the drawn track is, so the solid line isn't taken for the whole
  // flight: it's what this app watched, not a track history from departure.
  const trk = f('track-note');
  const span = arrival && arrival.track;
  if (span && span.points >= 2) {
    trk.hidden = false;
    set('track-note', `Track shown: the last ${fmt.dur(span.minutes)} watched by this app`
      + `${route && route.origin ? `. The dashed line back to ${route.origin.iata || route.origin.icao} is the missing part — no free feed publishes a flight's earlier track.` : '.'}`);
  } else {
    trk.hidden = true;
  }

  const note = f('note');
  note.hidden = !!route;
  if (!route) {
    set('note', 'No route on file for this callsign — adsbdb only knows scheduled city pairs, so charters and repositioning flights show up blank.');
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
export function renderAirlines(el, options, selected, { query, onToggle, onClear, kinds, kindCounts, onToggleKind }) {
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
  const kindRows = (kinds || []).map(({ key, label, on, count }) => `
    <button class="kind-row${on ? ' on' : ''}" data-kind="${esc(key)}">
      <span class="pick-tick">${on ? '✓' : ''}</span>
      <span class="pick-name">${esc(label)}</span>
      <span class="pick-count">${count || ''}</span>
    </button>`).join('');

  el.innerHTML = `
    <div class="pick-head"><b>Show on the map</b></div>
    <div class="kind-list">${kindRows}</div>
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

  return `${sanity.ok ? '' : `<div class="route-doubt">
    Route may be wrong — ${esc(sanity.reason)}. Callsign routes come from a
    schedule database, and callsigns get reused.</div>`}
  <div class="route-strip${sanity.ok ? '' : ' doubted'}">
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
 * The arrival block: scheduled vs estimated.
 *
 * ETA is computed here from the aircraft's own ground speed (see routes.eta) —
 * every source we use is keyless ADS-B, and ADS-B carries no arrival time.
 *
 * STA is only shown when somebody who knows it tells us: the flight card passes
 * the roster's scheduled arrival in the deep link. There is no free, keyless
 * schedule feed, so for any other flight the honest answer is that we don't
 * know it, and the row says so rather than showing a made-up time.
 */
function arrivalBlock(ac, arrival) {
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

  let delta = '';
  if (compareAt && staAt) {
    const mins = Math.round((compareAt - staAt) / 60000);
    const late = mins > 0;
    if (Math.abs(mins) > 6 * 60) {
      // Hours apart means the scheduled time isn't this leg's — a stale roster
      // entry, or the tail flying a different sector. Saying "5h early" would
      // be worse than saying nothing.
      delta = '<span class="arr-delta off">schedule doesn\'t match this leg</span>';
    } else {
      const word = actual ? (late ? 'late' : 'early') : (late ? 'late' : 'early');
      delta = Math.abs(mins) < 3
        ? `<span class="arr-delta on">${actual ? 'landed on schedule' : 'on schedule'}</span>`
        : `<span class="arr-delta ${late ? 'late' : 'early'}">${actual ? 'landed ' : ''}${esc(fmt.dur(Math.abs(mins)))} ${word}${actual ? '' : ' (est.)'}</span>`;
    }
  }

  const rightLabel = actual ? 'ATA · observed' : 'ETA · ground speed';
  const rightSub = actual
    ? `${esc(fmt.hhmmLocal(ataAt))} · touchdown seen`
    : (etaAt ? `${esc(fmt.hhmmLocal(etaAt))} · ${esc(fmt.dur(eta.minutes))} to run`
      : (ac.onGround ? 'on the ground' : 'no destination on file'));

  return `<div class="arrival">
    <div class="arr-cell">
      <span>STA · scheduled${arrival.staSource ? ` · ${esc(arrival.staSource)}` : ''}</span>
      <b>${staAt ? esc(fmt.hhmmZ(staAt)) : '—'}</b>
      <i>${staAt ? esc(fmt.hhmmLocal(staAt)) : 'no schedule feed'}</i>
    </div>
    <div class="arr-cell">
      <span>${rightLabel}</span>
      <b>${compareAt ? esc(fmt.hhmmZ(compareAt)) : '—'}</b>
      <i>${rightSub}</i>
    </div>
    ${delta ? `<div class="arr-cell delta">${delta}</div>` : ''}
  </div>`;
}
