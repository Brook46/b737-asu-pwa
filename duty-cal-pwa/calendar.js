// Renders Day / Week / Month views into a container.
// Emits 'event-click' CustomEvent on the container when an event chip is tapped.

import { groupOf, badgeOf } from './kinds.js';
import { isAirborneNow } from './radar.js';

const DOW_SHORT = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];

function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x; }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate()+n); return x; }
function startOfWeek(d) {
  // Week starts Sunday (Israel convention).
  const x = startOfDay(d);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function ymd(d) { const p = n => String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}`; }
function fmt(d) { const p = n => String(n).padStart(2,'0'); return `${p(d.getHours())}:${p(d.getMinutes())}`; }

export function rangeLabel(view, anchor) {
  if (view === 'day') {
    return `${DOW_SHORT[anchor.getDay()]} ${anchor.getDate()} ${MONTH_NAMES[anchor.getMonth()].slice(0,3)} ${anchor.getFullYear()}`;
  }
  if (view === 'week') {
    const s = startOfWeek(anchor), e = addDays(s, 6);
    const sameMonth = s.getMonth() === e.getMonth();
    if (sameMonth) return `${s.getDate()}–${e.getDate()} ${MONTH_NAMES[s.getMonth()].slice(0,3)} ${s.getFullYear()}`;
    return `${s.getDate()} ${MONTH_NAMES[s.getMonth()].slice(0,3)} – ${e.getDate()} ${MONTH_NAMES[e.getMonth()].slice(0,3)} ${s.getFullYear()}`;
  }
  return `${MONTH_NAMES[anchor.getMonth()]} ${anchor.getFullYear()}`;
}

export function renderInto(container, { view, anchor, events }) {
  container.innerHTML = '';
  if (view === 'month') return renderMonth(container, anchor, events);
  if (view === 'day')   return renderTimeline(container, [startOfDay(anchor)], events);
  if (view === 'week')  {
    const s = startOfWeek(anchor);
    return renderTimeline(container, [0,1,2,3,4,5,6].map(i => addDays(s,i)), events);
  }
}

function renderMonth(container, anchor, events) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const today = new Date();

  // Group events into each day they overlap (multi-day sessions show every day)
  const eventsByDay = groupByOverlappingDays(events);

  // Outer scroll wrapper so the grid can overflow horizontally on narrow screens.
  const scroll = document.createElement('div');
  scroll.className = 'month-scroll';
  const wrap = document.createElement('div');
  wrap.className = 'month-grid';

  // DOW headers (Sunday-first)
  for (const d of ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']) {
    const c = document.createElement('div');
    c.className = 'dow';
    c.textContent = d;
    wrap.appendChild(c);
  }

  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const cell = document.createElement('div');
    cell.className = 'month-cell';
    if (d.getMonth() !== anchor.getMonth()) cell.classList.add('other-month');
    if (sameDay(d, today)) cell.classList.add('today');

    const num = document.createElement('span');
    num.className = 'day-num';
    num.textContent = d.getDate();
    cell.appendChild(num);

    const chipsWrap = document.createElement('div');
    chipsWrap.className = 'month-chips';
    const dayEvents = (eventsByDay.get(ymd(d)) || []).slice().sort((a,b) => a.start - b.start);
    for (const ev of dayEvents.slice(0, 4)) {
      const chip = document.createElement('div');
      chip.className = `month-chip chip-${chipKind(ev.kind)}`;
      chip.dataset.eventId = ev.id;
      // For multi-day events: show start time only on the first day, otherwise mark continuation
      const dStart = startOfDay(d);
      const isFirstDay = ev.start >= dStart && ev.start < addDays(dStart, 1);
      if (isAllDay(ev)) {
        // All-day duty: lead with the roster badge, not a meaningless 00:00.
        chip.classList.add('chip-allday');
        const badge = badgeOf(ev);
        if (badge) chip.appendChild(mkBadge(badge));
        chip.appendChild(document.createTextNode(shortTitle(ev)));
      } else {
        const icon = isFirstDay ? iconFor(ev) : '';
        const text = isFirstDay
          ? `${fmt(ev.start)} ${icon ? icon + ' ' : ''}${shortTitle(ev)}`
          : `↳ ${shortTitle(ev)}`;
        // Month is the default view, so the airborne marker has to live here
        // too — not only on the day/week timeline chips.
        if (isAirborneNow(ev)) chip.appendChild(mkLiveDot());
        chip.appendChild(document.createTextNode(text));
      }
      chip.title = `${ev.title} — ${ev.sub || ''}`;
      chip.addEventListener('click', e => { e.stopPropagation(); fire(container, ev); });
      chipsWrap.appendChild(chip);
    }
    if (dayEvents.length > 4) {
      const more = document.createElement('div');
      more.className = 'month-chip';
      more.style.background = '#3a4250';
      more.textContent = `+${dayEvents.length - 4} more`;
      chipsWrap.appendChild(more);
    }
    cell.appendChild(chipsWrap);
    cell.addEventListener('click', () => {
      container.dispatchEvent(new CustomEvent('day-click', { detail: { date: d } }));
    });
    wrap.appendChild(cell);
  }

  scroll.appendChild(wrap);
  container.appendChild(scroll);
}

function renderTimeline(container, days, events) {
  const today = new Date();

  // Split each day's events into an all-day set and a timed set. All-day
  // duties (vacation, home reserve, days off) get their own lane above the
  // hour grid instead of painting a full-height column over the timeline.
  const perDay = days.map(day => {
    const dayStart = startOfDay(day);
    const dayEnd   = addDays(dayStart, 1);
    const overlapping = events.filter(ev => ev.start < dayEnd && ev.end > dayStart);
    return {
      day, dayStart,
      allDayEvs: overlapping.filter(isAllDay),
      timedEvs:  overlapping.filter(ev => !isAllDay(ev)),
    };
  });
  // Reserve one shared lane height so all columns and the hour gutter align.
  const maxAllDay = perDay.reduce((n, p) => Math.max(n, p.allDayEvs.length), 0);
  const laneH = maxAllDay ? maxAllDay * 22 + 8 : 0;

  const wrap = document.createElement('div');
  wrap.className = 'tl-wrap';

  // Hours column
  const hoursCol = document.createElement('div');
  hoursCol.className = 'tl-hours';
  hoursCol.appendChild(spacer()); // align with day header
  if (laneH) {
    const gutter = document.createElement('div');
    gutter.className = 'tl-allday-gutter';
    gutter.style.height = laneH + 'px';
    gutter.textContent = 'all-day';
    hoursCol.appendChild(gutter);
  }
  for (let h = 0; h < 24; h++) {
    const hh = document.createElement('div');
    hh.className = 'tl-hour';
    hh.textContent = String(h).padStart(2,'0') + ':00';
    hoursCol.appendChild(hh);
  }
  wrap.appendChild(hoursCol);

  // Days — wrap in a horizontal scroller so a full week stays visible on phones
  const daysScroll = document.createElement('div');
  daysScroll.className = 'tl-days-scroll';
  const daysWrap = document.createElement('div');
  daysWrap.className = 'tl-days';
  daysWrap.style.gridTemplateColumns = days.length === 1
    ? '1fr'
    : `repeat(${days.length}, minmax(140px, 1fr))`;

  for (const { day, dayStart, allDayEvs, timedEvs } of perDay) {
    const col = document.createElement('div');
    col.className = 'tl-day';

    const head = document.createElement('div');
    head.className = 'tl-day-header';
    if (sameDay(day, today)) head.classList.add('today');
    head.textContent = `${DOW_SHORT[day.getDay()]} ${day.getDate()}`;
    col.appendChild(head);

    if (laneH) {
      const lane = document.createElement('div');
      lane.className = 'tl-allday';
      lane.style.height = laneH + 'px';
      for (const ev of allDayEvs) {
        const chip = document.createElement('div');
        chip.className = `tl-allday-chip chip-${chipKind(ev.kind)}`;
        chip.dataset.eventId = ev.id;
        const badge = badgeOf(ev);
        if (badge) chip.appendChild(mkBadge(badge));
        chip.appendChild(document.createTextNode(shortTitle(ev)));
        chip.title = ev.title;
        chip.addEventListener('click', e => { e.stopPropagation(); fire(container, ev); });
        lane.appendChild(chip);
      }
      col.appendChild(lane);
    }

    const body = document.createElement('div');
    body.className = 'tl-day-body';
    // Hour grid lines
    for (let h = 0; h < 24; h++) {
      const line = document.createElement('div');
      line.className = 'tl-hour-line';
      body.appendChild(line);
    }

    for (const ev of timedEvs) {
      const node = renderEventChip(ev, dayStart);
      node.addEventListener('click', e => { e.stopPropagation(); fire(container, ev); });
      body.appendChild(node);
    }

    col.appendChild(body);
    daysWrap.appendChild(col);
  }
  daysScroll.appendChild(daysWrap);
  wrap.appendChild(daysScroll);
  container.appendChild(wrap);
}

/**
 * All-day test. Prefers the explicit flag; falls back to a midnight-to-midnight
 * span so events persisted before the schema refactor still render correctly.
 */
export function isAllDay(ev) {
  if (ev.allDay != null) return !!ev.allDay;
  return ev.start.getHours() === 0 && ev.start.getMinutes() === 0
      && (ev.end - ev.start) >= 24 * 60 * 60 * 1000 - 1000;
}

function mkBadge(text) {
  const b = document.createElement('span');
  b.className = 'chip-badge';
  b.textContent = text;
  return b;
}

function mkLiveDot() {
  const d = document.createElement('span');
  d.className = 'live-dot';
  d.title = 'Airborne now — tap to track';
  return d;
}

function renderEventChip(ev, dayStart) {
  const node = document.createElement('div');
  const k = chipKind(ev.kind);
  node.className = `event ${k}`;
  node.dataset.eventId = ev.id;
  const rowH = getComputedStyle(document.documentElement).getPropertyValue('--row-h').trim();
  const rowHpx = parseFloat(rowH) || 36;

  const startMins = Math.max(0, (ev.start - dayStart) / 60000);
  const endMins   = Math.min(24*60, (ev.end   - dayStart) / 60000);
  const top    = (startMins / 60) * rowHpx;
  const height = Math.max(18, ((endMins - startMins) / 60) * rowHpx);

  node.style.top = top + 'px';
  node.style.height = height + 'px';

  if (ev.kind === 'restEnd') {
    node.classList.add('rest-marker');
    node.style.height = '18px';
    node.innerHTML = `<b>${ev.title}</b>`;
    node.title = ev.sub;
    return node;
  }

  const icon = iconFor(ev);
  const title = document.createElement('b');
  // Non-flying duties carry their roster badge inline so the category is
  // readable even when the chip is too short to show the full title.
  if (BADGED_KINDS.has(ev.kind)) {
    const badge = badgeOf(ev);
    if (badge) title.appendChild(mkBadge(badge));
  }
  // A flight in the air right now is worth spotting from the calendar itself.
  if (isAirborneNow(ev)) title.appendChild(mkLiveDot());
  title.appendChild(document.createTextNode(icon ? `${icon}  ${ev.title}` : ev.title));
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = ev.sub || `${fmt(ev.start)} – ${fmt(ev.end)}`;
  node.appendChild(title);
  node.appendChild(sub);
  return node;
}

// Pick a time-of-day icon for a flight chip, using TLV-local hours.
// - 🌙 22:00–04:00 (overnight)
// - ☀️ 04:00–22:00 (daytime)
// - 🌅 crosses dawn  (night → day)
// - 🌇 crosses dusk  (day → night)
function iconFor(ev) {
  if (ev.kind !== 'flight') return '';
  const sDay = isDayHour(ev.start.getHours());
  const eDay = isDayHour(ev.end.getHours());
  if (sDay && eDay)   return '☀️';
  if (!sDay && !eDay) return '🌙';
  if (!sDay && eDay)  return '🌅';
  return '🌇';
}
function isDayHour(h) { return h >= 4 && h < 22; }

function spacer() { const s = document.createElement('div'); s.className = 'tl-day-header'; s.style.background = 'transparent'; s.style.borderBottomColor = 'transparent'; return s; }

// Colour / filter group for an event, from the shared taxonomy.
// 'custom' is the pre-refactor id for what is now 'note'.
function chipKind(kind) {
  if (kind === 'custom') return 'note';
  return groupOf(kind);
}
function shortTitle(ev) {
  if (ev.kind === 'pickup') return 'Pickup';
  if (ev.kind === 'driveHome') return 'Home';
  if (ev.kind === 'restEnd') return 'Rest end';
  if (ev.kind === 'flight') return ev.title.replace(/^DH\s*/, '').split('  ')[0];
  return ev.title;
}
// Kinds that show a roster badge on the chip. Flights and the pickup /
// drive-home / rest markers read fine without one.
const BADGED_KINDS = new Set(['standby','ground','vacation','dayOff','miluim','note','custom','other']);

function groupByOverlappingDays(events) {
  const m = new Map();
  for (const ev of events) {
    const first = startOfDay(ev.start);
    const last  = startOfDay(new Date(ev.end - 1)); // inclusive end day
    for (let d = new Date(first); d <= last; d = addDays(d, 1)) {
      const key = ymd(d);
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(ev);
    }
  }
  return m;
}
function fire(container, ev) {
  container.dispatchEvent(new CustomEvent('event-click', { detail: { event: ev } }));
}

export { startOfWeek, addDays, startOfDay };
