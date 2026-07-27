// summary.js — FTL / duty counters for a date range.
//
// Deliberately advisory: these are convenience tallies computed from the
// roster PDF, not a certified FTL calculation. Block time comes from the
// roster's own [FT hh:mm] figures where present, otherwise from the
// scheduled start/end of the event.

import { KINDS } from './kinds.js';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function ymd(d) {
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Every calendar day an event touches, clamped to [start, end). */
function daysTouched(ev, start, end) {
  const out = [];
  const from = startOfDay(new Date(Math.max(ev.start, start)));
  const to   = new Date(Math.min(ev.end - 1, end - 1));
  for (let d = from; d <= to; d = new Date(d.getTime() + DAY_MS)) out.push(ymd(d));
  return out;
}

/** Minutes of an event that fall inside [start, end). */
function clampedMinutes(ev, start, end) {
  const s = Math.max(ev.start, start);
  const e = Math.min(ev.end, end);
  return e > s ? Math.round((e - s) / 60000) : 0;
}

/**
 * @param {Array} events  all events (unfiltered by the legend)
 * @param {Date} start    range start, inclusive
 * @param {Date} end      range end, exclusive
 */
export function summarise(events, start, end) {
  const inRange = events.filter(ev => ev.start < end && ev.end > start);

  let blockMinutes = 0, groundMinutes = 0, sectors = 0;
  const dayFlags = new Map(); // dayKey → Set of kinds present

  for (const ev of inRange) {
    if (ev.kind === 'flight') {
      // Prefer the roster's own block figure; fall back to scheduled duration.
      blockMinutes += ev.blockMinutes ?? clampedMinutes(ev, start, end);
      sectors += ev.sectors ?? 0;
    } else if (ev.kind === 'ground') {
      groundMinutes += ev.dutyMinutes ?? clampedMinutes(ev, start, end);
    }
    for (const key of daysTouched(ev, start, end)) {
      if (!dayFlags.has(key)) dayFlags.set(key, new Set());
      dayFlags.get(key).add(ev.kind);
    }
  }

  const countDaysWith = kind => {
    let n = 0;
    for (const kinds of dayFlags.values()) if (kinds.has(kind)) n++;
    return n;
  };
  let dutyDays = 0;
  for (const kinds of dayFlags.values()) {
    if ([...kinds].some(k => KINDS[k]?.countsAsDuty)) dutyDays++;
  }

  return {
    blockMinutes,
    groundMinutes,
    sectors,
    dutyDays,
    standbyDays:  countDaysWith('standby'),
    daysOff:      countDaysWith('dayOff'),
    vacationDays: countDaysWith('vacation'),
    miluimDays:   countDaysWith('miluim'),
  };
}

/** 405 → "6:45" */
export function hhmm(minutes) {
  const m = Math.max(0, Math.round(minutes));
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Tiles for the month-summary strip, in display order.
 * `accent` maps to the same CSS custom property the legend and chips use, so
 * the strip cannot drift out of sync with the calendar's colour language.
 */
export function summaryTiles(s) {
  return [
    { key: 'block',    label: 'Block',    value: hhmm(s.blockMinutes),  unit: 'hrs',   accent: 'flight'   },
    { key: 'ground',   label: 'Ground',   value: hhmm(s.groundMinutes), unit: 'hrs',   accent: 'ground'   },
    { key: 'sectors',  label: 'Sectors',  value: String(s.sectors),     unit: '',      accent: 'flight'   },
    { key: 'duty',     label: 'Duty',     value: String(s.dutyDays),    unit: 'days',  accent: 'pickup'   },
    { key: 'standby',  label: 'Standby',  value: String(s.standbyDays), unit: 'days',  accent: 'standby'  },
    { key: 'off',      label: 'Days off', value: String(s.daysOff),     unit: 'days',  accent: 'dayOff'   },
    { key: 'vacation', label: 'Vacation', value: String(s.vacationDays),unit: 'days',  accent: 'vacation' },
  ];
}
