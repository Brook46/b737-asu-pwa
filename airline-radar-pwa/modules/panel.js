// panel.js — the two read-outs beside the map: the flight list and the detail
// sheet for one selected flight.
//
// Everything rendered here comes from a third-party feed, so every value goes
// through esc() before it reaches innerHTML — an aircraft's "registration" is
// whatever the transponder and the database say it is, not something we trust.

import * as fmt from './fmt.js';
import { altColor } from './aircraft.js';
import { familyOf } from './aircraft.js';
import { routeLabel, progress, haversine, eta } from './routes.js';
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
export function renderDetail(el, ac, route, info, { following, arrival }) {
  if (!ac) { el.innerHTML = ''; return; }

  const airlineName = (route && route.airline && route.airline.name)
    || (ac.airline && ac.airline.name)
    || (info && info.owner) || ac.code;
  // airlines.js stores the country as an ISO-2 code, which is what flag() wants.
  const iso = (route && route.airline && route.airline.countryIso)
    || (ac.airline && ac.airline.country) || '';
  const flightIata = route && route.iata ? route.iata : '';
  const alert = squawkAlert(ac.squawk) || (ac.emergency ? `Emergency: ${ac.emergency}` : '');

  el.innerHTML = `
    <div class="sheet-grip"></div>
    ${alert ? `<div class="sheet-alert">${esc(alert)}</div>` : ''}
    ${ac.ghost ? `<div class="sheet-ghost">
      ${ac.wentDark
    ? `Contact lost ${esc(fmt.ago(ac.lastSeenAt))}, airborne at ${esc(fmt.alt(ac.alt, ac.onGround))}.`
    : `Not transmitting. Last seen ${esc(fmt.ago(ac.lastSeenAt))}.`}
      <span>The symbol marks that last position — it is a memory, not a track.</span>
    </div>` : ''}
    <header class="sheet-head">
      <div class="sheet-id">
        <h2>${esc(ac.callsign || ac.reg)}</h2>
        <p>${fmt.flag(iso)} ${esc(airlineName)}${flightIata ? ` · ${esc(flightIata)}` : ''}</p>
      </div>
      <div class="sheet-alt" style="color:${ac.ghost ? '#9aa6bd' : altColor(ac.alt)}">
        <b>${esc(fmt.alt(ac.alt, ac.onGround))}</b>
        <span>${ac.ghost ? esc(fmt.ago(ac.lastSeenAt)) : esc(fmt.vs(ac.vs))}</span>
      </div>
      <button class="sheet-close" aria-label="Close">✕</button>
    </header>

    ${routeStrip(ac, route, arrival)}
    ${arrivalBlock(ac, arrival)}

    <div class="sheet-actions">
      ${ac.ghost ? '' : `<button class="act ${following ? 'on' : ''}" data-act="follow">${following ? 'Following' : 'Follow'}</button>`}
      <button class="act" data-act="fit">Show route</button>
      <button class="act" data-act="center">${ac.ghost ? 'Go to last position' : 'Centre'}</button>
    </div>

    <div class="sheet-grid">
      ${cell('Aircraft', familyOf(ac.type, ac.desc || (info && info.type)) || '—')}
      ${cell('Registration', ac.reg || (info && info.reg) || '—')}
      ${cell('Ground speed', fmt.kt(ac.gs))}
      ${cell('IAS / Mach', `${ac.ias ? Math.round(ac.ias) : '—'}${ac.mach ? ` / M${ac.mach.toFixed(2)}` : ''}`)}
      ${cell('Track', fmt.deg(ac.track))}
      ${cell('Altitude', fmt.feet(ac.alt))}
      ${ac.nav_alt ? cell('Selected alt', fmt.feet(Math.round(ac.nav_alt / 100) * 100)) : ''}
      ${ac.qnh ? cell('QNH set', `${ac.qnh.toFixed(1)} hPa`) : ''}
      ${ac.wind ? cell('Wind aloft', `${fmt.deg(ac.wind.dir)} / ${Math.round(ac.wind.speed)} kt`) : ''}
      ${ac.oat !== null ? cell('OAT', `${Math.round(ac.oat)} °C`) : ''}
      ${cell('Squawk', ac.squawk || '—')}
      ${cell('Mode S', ac.hex.toUpperCase())}
      ${info && info.owner ? cell('Operator', info.owner) : ''}
      ${cell('Position', fmt.age(ac.seen))}
    </div>

    ${info && (info.photo || info.thumb) ? `<figure class="sheet-photo">
      <img src="${esc(info.photo || info.thumb)}" alt="${esc(info.reg || ac.reg)}"
           loading="lazy" referrerpolicy="no-referrer"
           onerror="this.closest('figure').remove()">
      <figcaption>Photo: airport-data.com</figcaption>
    </figure>` : ''}

    ${!route ? `<p class="sheet-note">No route on file for this callsign — adsbdb only
      knows scheduled city pairs, so charters and repositioning flights show up blank.</p>` : ''}
  `;
}

function cell(label, value) {
  return `<div class="cellv"><span>${esc(label)}</span><b>${esc(value)}</b></div>`;
}

/**
 * The airline picker: every operator currently in view, busiest first, with the
 * ones already chosen pinned to the top so a selection can always be undone
 * even after its aircraft have flown out of the area.
 *
 * @param {Array<{code,name,count}>} options
 * @param {Set<string>} selected
 */
export function renderAirlines(el, options, selected, { query, onToggle, onClear }) {
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

  el.innerHTML = `
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

  return `<div class="route-strip">
    <div class="rs-end">
      <b>${esc(o ? (o.iata || o.icao) : '—')}</b>
      <span>${esc(o ? (o.city || o.name) : 'Unknown origin')}</span>
    </div>
    <div class="rs-mid">
      <div class="rs-bar"><i style="width:${pct === null ? 0 : Math.round(pct * 100)}%"></i>
        <span class="rs-plane" style="left:${pct === null ? 0 : Math.round(pct * 100)}%">✈</span></div>
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
  if (!arrival || (!arrival.eta && !arrival.staAt)) return '';
  const eta = arrival.eta;
  const etaAt = eta && eta.at ? eta.at : 0;
  const staAt = arrival.staAt || 0;

  // Both known: say whether it is running early or late, which is the number a
  // crew actually cares about.
  let delta = '';
  if (etaAt && staAt) {
    const mins = Math.round((etaAt - staAt) / 60000);
    const late = mins > 0;
    delta = Math.abs(mins) < 3
      ? '<span class="arr-delta on">on schedule</span>'
      : `<span class="arr-delta ${late ? 'late' : 'early'}">${Math.abs(mins)} min ${late ? 'late' : 'early'}</span>`;
  }

  return `<div class="arrival">
    <div class="arr-cell">
      <span>STA${arrival.staSource ? ` · ${esc(arrival.staSource)}` : ''}</span>
      <b>${staAt ? esc(fmt.hhmmZ(staAt)) : '—'}</b>
      <i>${staAt ? esc(fmt.hhmmLocal(staAt)) : 'no schedule feed'}</i>
    </div>
    <div class="arr-cell">
      <span>ETA · ground speed</span>
      <b>${etaAt ? esc(fmt.hhmmZ(etaAt)) : '—'}</b>
      <i>${etaAt ? `${esc(fmt.hhmmLocal(etaAt))} · ${esc(fmt.dur(eta.minutes))} to run` : (ac.onGround ? 'on the ground' : 'no destination on file')}</i>
    </div>
    ${delta ? `<div class="arr-cell delta">${delta}</div>` : ''}
  </div>`;
}
