// Renders Day / Week / Month views into a container.
// Emits 'event-click' CustomEvent on the container when an event chip is tapped.

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
      // For multi-day events: show start time only on the first day, otherwise mark continuation
      const dStart = startOfDay(d);
      const isFirstDay = ev.start >= dStart && ev.start < addDays(dStart, 1);
      const label = isFirstDay
        ? `${fmt(ev.start)} ${shortTitle(ev)}`
        : `↳ ${shortTitle(ev)}`;
      chip.textContent = label;
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
  const eventsByDay = groupByDayKey(events);

  const wrap = document.createElement('div');
  wrap.className = 'tl-wrap';

  // Hours column
  const hoursCol = document.createElement('div');
  hoursCol.className = 'tl-hours';
  hoursCol.appendChild(spacer()); // align with day header
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

  for (const day of days) {
    const col = document.createElement('div');
    col.className = 'tl-day';

    const head = document.createElement('div');
    head.className = 'tl-day-header';
    if (sameDay(day, today)) head.classList.add('today');
    head.textContent = `${DOW_SHORT[day.getDay()]} ${day.getDate()}`;
    col.appendChild(head);

    const body = document.createElement('div');
    body.className = 'tl-day-body';
    // Hour grid lines
    for (let h = 0; h < 24; h++) {
      const line = document.createElement('div');
      line.className = 'tl-hour-line';
      body.appendChild(line);
    }

    // Events for this day — including events whose date overlaps midnight
    const dayStart = startOfDay(day);
    const dayEnd   = addDays(dayStart, 1);
    const evs = events.filter(ev => ev.start < dayEnd && ev.end > dayStart);

    for (const ev of evs) {
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

function renderEventChip(ev, dayStart) {
  const node = document.createElement('div');
  const k = chipKind(ev.kind);
  node.className = `event ${k}`;
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

  const title = document.createElement('b');
  title.textContent = ev.title;
  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = ev.sub || `${fmt(ev.start)} – ${fmt(ev.end)}`;
  node.appendChild(title);
  node.appendChild(sub);
  return node;
}

function spacer() { const s = document.createElement('div'); s.className = 'tl-day-header'; s.style.background = 'transparent'; s.style.borderBottomColor = 'transparent'; return s; }

function chipKind(kind) {
  if (kind === 'pickup' || kind === 'driveHome') return 'pickup';
  if (kind === 'flight') return 'flight';
  if (kind === 'restEnd') return 'rest';
  return 'other';
}
function shortTitle(ev) {
  if (ev.kind === 'pickup') return 'Pickup';
  if (ev.kind === 'driveHome') return 'Home';
  if (ev.kind === 'restEnd') return 'Rest end';
  if (ev.kind === 'flight') return ev.title.replace(/^DH\s*/, '').split('  ')[0];
  return ev.title;
}
function groupByDayKey(events) {
  const m = new Map();
  for (const ev of events) {
    if (!m.has(ev.dayKey)) m.set(ev.dayKey, []);
    m.get(ev.dayKey).push(ev);
  }
  return m;
}

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
