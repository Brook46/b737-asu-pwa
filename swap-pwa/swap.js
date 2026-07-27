// swap.js — "Roster Swap & Flight Exchange", a standalone PWA.
//
// Companion to the Duty Calendar app, but a separate app at a separate URL.
// It never imports from the calendar's code; it reads the parsed roster from
// shared localStorage via roster.js (same origin ⇒ same storage).
//
// Duties are picked from a list here rather than by tapping a calendar chip,
// so this app stands on its own without rendering a calendar grid.
//
// Everything personal (profile, selections, matches) lives under the 'swap:*'
// namespace so it never collides with the calendar's keys.
//
// Backend contract (see backend/Code.gs):
//   POST {action:'publish', token, profile, wants:[...], freeDays:[...]}  -> {ok, listingId}
//   POST {action:'matches', token, employeeId}                            -> {ok, matches:[...]}
//   POST {action:'respond', token, matchId, employeeId, decision}         -> {ok, status}
// All POSTs are text/plain (avoids a CORS preflight against Apps Script).

import {
  loadRoster, rosterById, tradableDuties, busyDays, rosterOwner, ymd, CALENDAR_URL,
} from './roster.js';

const CFG = {
  // Deployed Apps Script Web App /exec URL — set in ⚙︎ Settings.
  ENDPOINT: localStorage.getItem('swap:endpoint') || '',
  // Shared secret — must equal SHARED_TOKEN in Code.gs.
  TOKEN: localStorage.getItem('swap:token') || '',
};

// ---------- storage helpers ----------------------------------------------
const LS = {
  profile: 'swap:profile',
  wants: 'swap:wants',       // duties the pilot wants to drop/swap out (by event id)
  free: 'swap:free',         // 'YYYY-MM-DD' days the pilot is free to fly
  matches: 'swap:matches',   // last fetched matches (cache for offline)
};
const readJSON = (k, fb) => { try { return JSON.parse(localStorage.getItem(k)) ?? fb; } catch { return fb; } };
const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

const store = {
  get profile() { return readJSON(LS.profile, null); },
  set profile(v) { writeJSON(LS.profile, v); },
  get wants() { return readJSON(LS.wants, {}); },      // { [eventId]: {want, prefs, snapshot} }
  set wants(v) { writeJSON(LS.wants, v); },
  get free() { return readJSON(LS.free, []); },         // ['YYYY-MM-DD', ...]
  set free(v) { writeJSON(LS.free, v); },
  get matches() { return readJSON(LS.matches, []); },
  set matches(v) { writeJSON(LS.matches, v); },
};

// ---------- small DOM utils ----------------------------------------------
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) n.setAttribute(k, v);
  }
  for (const kid of kids.flat()) if (kid != null) n.append(kid.nodeType ? kid : document.createTextNode(kid));
  return n;
};
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
function toast(msg, kind = 'info') {
  const t = el('div', { class: `swap-toast swap-toast-${kind}` }, msg);
  document.body.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 2600);
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDate = d => `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`;

const PREF_OPTIONS = [
  ['morning', 'Morning flights only'],
  ['quickTurn', 'Quick turns'],
  ['highBlock', 'High block hours'],
  ['noRedeye', 'No red-eyes'],
];

// ---------- profile ------------------------------------------------------
function ensureProfile() {
  if (store.profile?.employeeId) return true;
  openProfileModal();
  return false;
}

function openProfileModal() {
  const p = store.profile || {};
  const f = {
    name: el('input', { class: 'swap-in', value: p.name || rosterOwner(), placeholder: 'Full name (as on roster)' }),
    employeeId: el('input', { class: 'swap-in', value: p.employeeId || '', placeholder: 'Employee ID' }),
    phone: el('input', { class: 'swap-in', type: 'tel', value: p.phone || '', placeholder: 'Phone' }),
    email: el('input', { class: 'swap-in', type: 'email', value: p.email || '', placeholder: 'Email' }),
  };
  const body = el('div', { class: 'swap-form' },
    el('label', {}, 'Name', f.name),
    el('label', {}, 'Employee ID', f.employeeId),
    el('label', {}, 'Phone', f.phone),
    el('label', {}, 'Email', f.email),
    el('p', { class: 'swap-hint' }, 'Stored only on this device. Sent to the swap board only when you publish a listing.'),
  );
  overlay('Pilot profile', body, [
    ['Save', 'primary', () => {
      const prof = {
        name: f.name.value.trim(), employeeId: f.employeeId.value.trim(),
        phone: f.phone.value.trim(), email: f.email.value.trim(),
      };
      if (!prof.name || !prof.employeeId || !prof.email) { toast('Name, ID and email are required', 'warn'); return false; }
      store.profile = prof;
      toast('Profile saved');
      render();
    }],
    ['Cancel', '', () => {}],
  ]);
}

// ---------- preference modal (per marked duty) ---------------------------
function openPreferenceModal(evt) {
  const wants = store.wants;
  const existing = wants[evt.id];
  const prefState = { ...(existing?.prefs || {}) };
  const dropChk = el('input', { type: 'checkbox', checked: existing ? existing.want !== false : true });

  const prefBoxes = PREF_OPTIONS.map(([key, label]) => {
    const box = el('input', { type: 'checkbox', checked: !!prefState[key], onchange: () => { prefState[key] = box.checked; } });
    return el('label', { class: 'swap-check' }, box, label);
  });

  const body = el('div', { class: 'swap-form' },
    el('div', { class: 'swap-duty-card' },
      el('div', { class: 'swap-duty-route' }, evt.title),
      el('div', { class: 'swap-duty-when' }, `${evt.dayKey} · ${evt.sub || ''}`),
      evt.details?.flights ? el('div', { class: 'swap-duty-meta' }, evt.details.flights) : null,
    ),
    el('label', { class: 'swap-check swap-check-lg' }, dropChk, 'Want to drop / swap this duty out'),
    el('div', { class: 'swap-sub' }, 'What I\'ll accept in return'),
    ...prefBoxes,
  );

  overlay('Mark duty', body, [
    ['Save mark', 'primary', () => {
      const w = { ...store.wants };
      if (!dropChk.checked) { delete w[evt.id]; }
      else {
        w[evt.id] = { want: true, prefs: prefState, snapshot: dutySnapshot(evt) };
      }
      store.wants = w;
      render();
      toast(dropChk.checked ? 'Duty marked for swap' : 'Mark removed');
    }],
    existing ? ['Remove mark', 'danger', () => {
      const w = { ...store.wants }; delete w[evt.id]; store.wants = w;
      render(); toast('Mark removed');
    }] : null,
    ['Cancel', '', () => {}],
  ].filter(Boolean));
}

// A compact, backend-friendly description of a duty (dates as ISO strings).
function dutySnapshot(evt) {
  return {
    eventId: evt.id,
    dutyId: evt.dutyId,
    date: evt.dayKey,
    route: evt.title,
    time: evt.sub || '',
    flights: evt.details?.flights || '',
    start: evt.start.toISOString(),
    end: evt.end.toISOString(),
  };
}

// ---------- "Free to fly" day picker -------------------------------------
function openFreeToFlyModal() {
  // Availability rules live in roster.js and default to "blocking" for any
  // unrecognised duty kind, so a new calendar category can never make the
  // pilot look free by accident.
  const busy = busyDays(loadRoster());
  const free = new Set(store.free);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = [];
  for (let i = 0; i < 60; i++) {
    const d = new Date(today.getTime() + i * 86400000);
    const key = ymd(d);
    days.push({ key, d, busy: busy.has(key) });
  }

  const grid = el('div', { class: 'swap-daygrid' });
  const draft = new Set(free);
  for (const { key, d, busy: isBusy } of days) {
    const cell = el('button', {
      class: `swap-day ${isBusy ? 'busy' : ''} ${draft.has(key) ? 'on' : ''}`,
      type: 'button',
      title: isBusy ? 'You already have duty this day' : key,
      onclick: () => {
        if (isBusy) { toast('You have duty that day', 'warn'); return; }
        if (draft.has(key)) draft.delete(key); else draft.add(key);
        cell.classList.toggle('on');
      },
    },
      el('span', { class: 'swap-day-dow' }, DOW[d.getDay()]),
      el('span', { class: 'swap-day-num' }, String(d.getDate())),
    );
    grid.append(cell);
  }

  overlay('Free to fly', el('div', {},
    el('p', { class: 'swap-hint' }, 'Pick days off where you\'d pick up an extra flight.'),
    grid,
  ), [
    ['Save', 'primary', () => { store.free = [...draft].sort(); render(); toast(`${draft.size} day(s) marked free`); }],
    ['Cancel', '', () => {}],
  ]);
}

// ---------- API module ---------------------------------------------------
async function api(action, payload) {
  if (!CFG.ENDPOINT) throw new Error('No backend endpoint set. Open ⚙︎ Settings.');
  const res = await fetch(CFG.ENDPOINT, {
    method: 'POST',
    // text/plain keeps Apps Script simple (no CORS preflight). Body is JSON text.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, token: CFG.TOKEN, ...payload }),
  });
  if (!res.ok) throw new Error(`Backend ${res.status}`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Backend rejected the request');
  return data;
}

async function publishListing() {
  if (!ensureProfile()) return;
  const wantList = Object.values(store.wants).filter(w => w.want).map(w => ({ ...w.snapshot, prefs: w.prefs }));
  if (wantList.length === 0 && store.free.length === 0) { toast('Mark a duty or a free day first', 'warn'); return; }

  setBusy(true);
  try {
    const r = await api('publish', { profile: store.profile, wants: wantList, freeDays: store.free });
    toast(`Published to swap board (${wantList.length} duty, ${store.free.length} free)`);
    if (r.listingId) writeJSON('swap:listingId', r.listingId);
    await refreshMatches();
  } catch (e) {
    toast(e.message, 'warn');
  } finally { setBusy(false); }
}

async function refreshMatches() {
  const prof = store.profile;
  if (!prof?.employeeId) { openProfileModal(); return; }
  setBusy(true);
  try {
    const r = await api('matches', { employeeId: prof.employeeId });
    store.matches = r.matches || [];
    render();
    toast(`${store.matches.length} match(es) found`);
  } catch (e) {
    toast(e.message, 'warn');
    render(); // fall back to cached matches
  } finally { setBusy(false); }
}

async function respondToMatch(match, decision) {
  setBusy(true);
  try {
    const r = await api('respond', { matchId: match.matchId, employeeId: store.profile.employeeId, decision });
    // Server decides when both sides have accepted and fires the crew-scheduling email.
    if (r.status === 'confirmed') {
      toast('Both pilots accepted — swap request emailed to crew scheduling ✈', 'ok');
    } else if (decision === 'accept') {
      toast('Accepted — waiting for the other pilot', 'ok');
    } else {
      toast('Declined');
    }
    await refreshMatches();
  } catch (e) {
    toast(e.message, 'warn');
  } finally { setBusy(false); }
}

// ---------- overlay / modal primitive ------------------------------------
function overlay(title, bodyNode, buttons) {
  const back = el('div', { class: 'swap-overlay' });
  const foot = el('div', { class: 'swap-foot' });
  const card = el('div', { class: 'swap-card', role: 'dialog', 'aria-modal': 'true' },
    el('div', { class: 'swap-card-head' }, el('h3', {}, title),
      el('button', { class: 'swap-x', 'aria-label': 'Close', onclick: () => back.remove() }, '×')),
    el('div', { class: 'swap-card-body' }, bodyNode),
    foot,
  );
  for (const [label, variant, fn] of buttons) {
    foot.append(el('button', {
      class: `swap-btn ${variant}`,
      onclick: () => { const keep = fn?.(); if (keep !== false) back.remove(); },
    }, label));
  }
  back.append(card);
  back.addEventListener('click', e => { if (e.target === back) back.remove(); });
  document.body.append(back);
  return back;
}

function openSettings() {
  const f = {
    endpoint: el('input', { class: 'swap-in', value: CFG.ENDPOINT, placeholder: 'https://script.google.com/.../exec' }),
    token: el('input', { class: 'swap-in', value: CFG.TOKEN, placeholder: 'Shared token' }),
  };
  overlay('Swap settings', el('div', { class: 'swap-form' },
    el('label', {}, 'Apps Script endpoint (/exec)', f.endpoint),
    el('label', {}, 'Shared token', f.token),
    el('p', { class: 'swap-hint' }, 'These match the deployed Web App URL and SHARED_TOKEN in Code.gs.'),
  ), [
    ['Save', 'primary', () => {
      CFG.ENDPOINT = f.endpoint.value.trim(); CFG.TOKEN = f.token.value.trim();
      localStorage.setItem('swap:endpoint', CFG.ENDPOINT);
      localStorage.setItem('swap:token', CFG.TOKEN);
      toast('Settings saved');
    }],
    ['Cancel', '', () => {}],
  ]);
}

// ---------- app shell ----------------------------------------------------
let busyFlag = false;
const setBusy = b => { busyFlag = b; document.getElementById('swap-root')?.classList.toggle('busy', b); };

function render() {
  const root = document.getElementById('swap-root');
  if (!root) return;

  const roster = loadRoster();
  const duties = tradableDuties(roster);
  const byId = rosterById(roster);
  const wants = store.wants;
  const wantEntries = Object.entries(wants).filter(([, w]) => w.want);
  const prof = store.profile;
  const matches = store.matches;

  // No roster yet — this app has nothing to work with until the calendar app
  // has imported a duty plan on this device.
  if (roster.length === 0) {
    root.replaceChildren(
      section('Get started', [
        el('p', { class: 'swap-hint' },
          'No roster found on this device. Import your duty-plan PDF in the Duty Calendar app first — this app reads the same roster.'),
        el('a', { class: 'swap-btn primary swap-link', href: CALENDAR_URL }, 'Open Duty Calendar →'),
      ]),
      section('Settings', [
        el('button', { class: 'swap-btn', onclick: openSettings }, '⚙︎ Backend settings'),
      ]),
    );
    return;
  }

  root.replaceChildren(
    // profile row
    el('div', { class: 'swap-row swap-profile' },
      prof?.employeeId
        ? el('div', {}, el('strong', {}, prof.name), el('div', { class: 'swap-hint' }, `ID ${esc(prof.employeeId)} · ${esc(prof.email)}`))
        : el('div', { class: 'swap-hint' }, 'No profile yet'),
      el('div', { class: 'swap-row-actions' },
        el('button', { class: 'swap-btn small', onclick: openProfileModal }, prof?.employeeId ? 'Edit' : 'Set up'),
        el('button', { class: 'swap-btn small', onclick: openSettings, title: 'Backend settings' }, '⚙︎'),
      ),
    ),

    // the duty list — this replaces "tap a chip on the calendar"
    section(`Your duties (${duties.length})`, duties.length
      ? [
          el('p', { class: 'swap-hint' }, 'Tap a duty to mark it for swap.'),
          el('div', { class: 'swap-list' }, ...duties.map(d => dutyListRow(d, !!wants[d.id]))),
        ]
      : [emptyNote('No flight duties in the imported roster.')]),

    // free days
    section('Free to fly', [
      el('div', { class: 'swap-toolbar' },
        el('button', { class: 'swap-btn', onclick: openFreeToFlyModal }, '📅 Pick days'),
      ),
      store.free.length
        ? el('div', { class: 'swap-chips' }, ...store.free.map(d => el('span', { class: 'swap-chip' }, d)))
        : emptyNote('No free days picked.'),
    ]),

    // publish + refresh
    section(`Marked to swap out (${wantEntries.length})`, [
      ...(wantEntries.length
        ? wantEntries.map(([id, w]) => dutyRow(byId.get(id) || reviveSnapshot(w.snapshot), w, id))
        : [emptyNote('Nothing marked yet.')]),
      el('div', { class: 'swap-toolbar' },
        el('button', { class: 'swap-btn primary', onclick: publishListing }, '⤒ Publish to board'),
        el('button', { class: 'swap-btn', onclick: refreshMatches }, '⟳ Find matches'),
      ),
    ]),

    // matches
    section(`Matches (${matches.length})`, matches.length
      ? matches.map(matchCard)
      : [emptyNote('No matches yet. Publish, then refresh.')]),
  );
}

function dutyListRow(evt, marked) {
  const past = evt.end < new Date();
  return el('button', {
    class: `swap-list-row ${marked ? 'marked' : ''} ${past ? 'past' : ''}`,
    type: 'button',
    onclick: () => openPreferenceModal(evt),
  },
    el('span', { class: 'swap-list-check' }, marked ? '☑' : '☐'),
    el('span', { class: 'swap-list-main' },
      el('span', { class: 'swap-list-route' }, evt.title),
      el('span', { class: 'swap-list-when' }, `${niceDate(evt.start)} · ${evt.sub || ''}`),
    ),
  );
}

function section(title, kids) {
  return el('section', { class: 'swap-section' }, el('h4', {}, title), ...kids);
}
const emptyNote = t => el('p', { class: 'swap-hint swap-empty' }, t);

function reviveSnapshot(s) {
  return {
    id: s.eventId, dutyId: s.dutyId, dayKey: s.date, title: s.route, sub: s.time,
    details: { flights: s.flights }, kind: 'flight',
    start: new Date(s.start), end: new Date(s.end),
  };
}

function dutyRow(evt, w, id) {
  const prefs = Object.entries(w.prefs || {}).filter(([, on]) => on).map(([k]) => PREF_OPTIONS.find(o => o[0] === k)?.[1]).filter(Boolean);
  return el('div', { class: 'swap-duty-card' },
    el('div', { class: 'swap-duty-route' }, evt.title),
    el('div', { class: 'swap-duty-when' }, `${evt.dayKey} · ${evt.sub || ''}`),
    prefs.length ? el('div', { class: 'swap-duty-meta' }, '↔ ' + prefs.join(', ')) : null,
    el('button', { class: 'swap-btn small danger', onclick: () => { const wj = { ...store.wants }; delete wj[id]; store.wants = wj; render(); } }, 'Remove'),
  );
}

function matchCard(m) {
  // m: { matchId, status, mine:{route,date,time}, theirs:{route,date,time,pilot}, note }
  const status = m.status || 'open';
  const badge = { open: 'New', accepted_by_me: 'You accepted', accepted_by_them: 'They accepted', confirmed: 'Confirmed ✈', declined: 'Declined' }[status] || status;
  const acted = status === 'confirmed' || status === 'declined' || status === 'accepted_by_me';
  return el('div', { class: `swap-match ${status}` },
    el('div', { class: 'swap-match-head' }, el('span', { class: 'swap-match-badge' }, badge),
      m.theirs?.pilot ? el('span', { class: 'swap-hint' }, esc(m.theirs.pilot)) : null),
    el('div', { class: 'swap-match-grid' },
      el('div', {}, el('div', { class: 'swap-sub' }, 'You give'), el('div', { class: 'swap-duty-route' }, m.mine?.route || '—'), el('div', { class: 'swap-duty-when' }, `${m.mine?.date || ''} ${m.mine?.time || ''}`)),
      el('div', { class: 'swap-arrow' }, '⇄'),
      el('div', {}, el('div', { class: 'swap-sub' }, 'You get'), el('div', { class: 'swap-duty-route' }, m.theirs?.route || '—'), el('div', { class: 'swap-duty-when' }, `${m.theirs?.date || ''} ${m.theirs?.time || ''}`)),
    ),
    m.note ? el('div', { class: 'swap-hint' }, m.note) : null,
    acted ? null : el('div', { class: 'swap-match-actions' },
      el('button', { class: 'swap-btn primary', onclick: () => respondToMatch(m, 'accept') }, 'Accept swap'),
      el('button', { class: 'swap-btn danger', onclick: () => respondToMatch(m, 'decline') }, 'Decline'),
    ),
  );
}

// ---------- boot ---------------------------------------------------------
document.getElementById('refresh-btn')?.addEventListener('click', () => { render(); toast('Roster reloaded'); });
render();

// The calendar app may import a new roster in another tab — pick it up.
window.addEventListener('storage', e => { if (e.key === 'duty-cal:events') render(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') render(); });

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});

window.RosterSwap = { render, refreshMatches, store };
