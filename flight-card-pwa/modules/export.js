// export.js — a file of just the things the pilot picks: some Notes tabs,
// airport notes, crew notes and colours, PAs, past / future / chosen
// flights. For a friend's device or another of the pilot's own; read back in
// Settings → Backup → Restore, which only ever adds (storage.mergeExport).
// Unlike the backup, no settings or links (calendar, feeds) go in a file.

import * as storage from './storage.js?v=276';
import { legTs } from './dates.js?v=276';

export const TAG = 'flightcard-export';

const legId = (l) => [l.flight, l.dep_date, l.dep_year, l.dep, l.arr].join('|');
export function legWhen(l) { return legTs(l.dep_date, l.dep_time, l.dep_year); }

// Every flight once, newest first, each with its id.
export function allFlights() {
  const seen = new Set(), out = [];
  for (const l of storage.everyLeg()) {
    if (!l || !l.dep_date) continue;
    const id = legId(l);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, leg: l, t: legWhen(l) || 0 });
  }
  return out.sort((a, b) => b.t - a.t);
}

// What there is to export, for the chooser.
export function inventory() {
  const st = storage.getState();
  const now = Date.now();
  const flights = allFlights();
  const crew = storage.allCrew().filter(p => p.note || p.color || p.nickname);
  return {
    notes: (st.myNotes || []).filter(n => n.html).map(n => ({ id: n.id, name: n.name })),
    airportNotes: Object.keys(st.airportNotes || {}).filter(k => st.airportNotes[k]).length
      + Object.keys(st.airportSocial || {}).filter(k => st.airportSocial[k]).length,
    crew: crew.length,
    speeches: (st.speeches || []).length,
    past: flights.filter(f => f.t && f.t <= now).length,
    future: flights.filter(f => f.t > now).length,
    flights,
  };
}

// sel: { notes: [ids], airportNotes, crew, phones, speeches, past, future, flights: [ids] }
export function build(sel) {
  storage.flush();
  const st = storage.getState();
  const parts = {};
  const counts = {};
  if (sel.notes && sel.notes.length) {
    parts.myNotes = (st.myNotes || []).filter(n => sel.notes.includes(n.id)).map(n => ({ name: n.name, html: n.html }));
    counts.notes = parts.myNotes.length;
  }
  if (sel.airportNotes) {
    parts.airportNotes = { ...(st.airportNotes || {}) };
    parts.airportSocial = { ...(st.airportSocial || {}) };
    counts.airportNotes = Object.values(parts.airportNotes).filter(Boolean).length + Object.values(parts.airportSocial).filter(Boolean).length;
  }
  if (sel.crew) {
    parts.crew = {};
    for (const p of storage.allCrew()) {
      if (!(p.note || p.color || p.nickname)) continue;
      parts.crew[p.name] = { note: p.note, color: p.color, nickname: p.nickname, ...(sel.phones && p.phone ? { phone: p.phone } : {}) };
    }
    counts.crew = Object.keys(parts.crew).length;
  }
  if (sel.speeches) { parts.speeches = (st.speeches || []).map(x => ({ ...x })); counts.speeches = parts.speeches.length; }
  const now = Date.now();
  const want = new Set(sel.flights || []);
  const legs = allFlights().filter(f => (sel.past && f.t && f.t <= now) || (sel.future && f.t > now) || want.has(f.id))
    .map(f => JSON.parse(JSON.stringify(f.leg)));
  if (legs.length) { parts.legs = legs; counts.legs = legs.length; }
  return { app: TAG, v: 1, at: new Date().toISOString(), counts, parts };
}

export function filename(x) {
  const d = new Date(x.at);
  const ymd = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return `flightcard-export-${ymd}.json`;
}

export function summary(c) {
  const bits = [];
  if (c.notes) bits.push(`${c.notes} note${c.notes === 1 ? '' : 's'}`);
  if (c.airportNotes) bits.push(`${c.airportNotes} airport note${c.airportNotes === 1 ? '' : 's'}`);
  if (c.crew) bits.push(`${c.crew} crew`);
  if (c.speeches) bits.push(`${c.speeches} PA${c.speeches === 1 ? '' : 's'}`);
  if (c.legs) bits.push(`${c.legs} flight${c.legs === 1 ? '' : 's'}`);
  return bits.join(' · ');
}
