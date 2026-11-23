// Flight Card regression tests — one per bug the pilot reported, so a fixed
// bug can't quietly come back. Pure logic only (no DOM, no network).
//
//   node --test tests/
//
// Run before every beta (CLAUDE.md → Flight Card: beta first).

import { test } from 'node:test';
import assert from 'node:assert/strict';

// ---- Browser globals the modules touch at import / call time ----
const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
  key: (i) => [...mem.keys()][i] ?? null,
  get length() { return mem.size; },
};
globalThis.window = globalThis;
globalThis.addEventListener ||= () => {};
globalThis.dispatchEvent ||= () => true;
globalThis.CustomEvent ||= class CustomEvent { constructor(t, o) { this.type = t; this.detail = o?.detail; } };

const M = '../flight-card-pwa/modules/';
const nb = await import(M + 'notam-brief.js');
const ri = await import(M + 'route-info.js');
const cp = await import(M + 'cpdlc.js');
const av = await import(M + 'avoid.js');
const ad = await import(M + 'atis-diagram.js');
const al = await import(M + 'altn.js');
const seen = await import(M + 'seen.js');

const LLBG = { lat: 32.0114, lon: 34.8867 }, UGTB = { lat: 41.6692, lon: 44.9547 }, LEBL = { lat: 41.2971, lon: 2.0785 };

// v288 — LEBL "RWY 06L/24R AND RWY 02/20 CLSD" read as RWY 02/20 only.
test('a NOTAM closing two runways names both', () => {
  assert.deepEqual(nb.closedRwys('RWY 06L/24R AND RWY 02/20 CLSD. REF AIRAC SUP 142/26').rwys, ['06L/24R', '02/20']);
  assert.deepEqual(nb.closedRwys('RWYS 12, 30 CLOSED').rwys, ['12', '30']);
  assert.equal(nb.closedRwys('TWY T3,T4 CLSD'), null);
});

// v276 — TIA closure shown all day: Item D bare days ("09 2000-0500, 10-12 1700-0500").
test('Item D bare days only count in their hours', () => {
  const n = { start: '2026-11-09T00:00:00Z', end: '2026-11-13T00:00:00Z', sched: '09 2000-0500, 10-12 1700-0500' };
  assert.equal(nb.inForce(n, Date.parse('2026-11-10T12:00:00Z')), false, 'midday on the 10th is open');
  assert.equal(nb.inForce(n, Date.parse('2026-11-10T18:00:00Z')), true, '18Z on the 10th is closed');
  assert.equal(nb.inForce(n, Date.parse('2026-11-09T22:00:00Z')), true, '22Z on the 9th is closed');
});

// v289 — the great circle crossed Syria; it must go round (TLV–TBS).
test('TLV–TBS goes round Syria and the avoided FIRs', () => {
  const r = av.avoidRoute(LLBG, UGTB);
  assert.ok(r && r.wps.length, 'a way round is found');
  const pts = [LLBG, ...r.wps, UGTB];
  for (let i = 0; i + 1 < pts.length; i++) {
    for (let f = 0; f <= 1; f += 0.05) {
      const lat = pts[i].lat + (pts[i + 1].lat - pts[i].lat) * f, lon = pts[i].lon + (pts[i + 1].lon - pts[i].lon) * f;
      const id = cp.firAt(lat, lon);
      assert.ok(!av.avoidedName(id), `leg ${i} passes through ${id} at ${lat.toFixed(2)},${lon.toFixed(2)}`);
    }
  }
});
test('TLV–BCN needs no detour', () => assert.equal(av.avoidRoute(LLBG, LEBL), null));

// v290 — TBS diagram framed the airfield next door: own runways only.
test('the diagram keeps the airport’s own runways', () => {
  const own = { ref: '13/31', pts: [[-1500, 1000], [1500, -1000]] };
  const nextDoor = { ref: '12/30', pts: [[4000, 3000], [6500, 1500]] };
  const joinedPiece = { ref: '', pts: [[1500, -1000], [1600, -1100]] };
  const keep = ad.ownRunways({ rw: [own, nextDoor, joinedPiece] }, ['13/31']);
  assert.ok(keep.has(own) && keep.has(joinedPiece));
  assert.ok(!keep.has(nextDoor));
});

// v280 — wind limits (QRH OI.2.22): tailwind 15 kt, crosswind by RWYCC.
test('wind limits follow the QRH table', () => {
  assert.equal(ri.TAILWIND_MAX, 15);
  assert.equal(ri.tailBand(16), 'r');
  assert.equal(ri.tailBand(12), 'o');
  const dry = ri.xwLimits(6, 148);
  assert.deepEqual([dry.to, dry.ldg], [34, 40]);
  assert.equal(ri.xwBandFor(41, dry), 'r');
  assert.equal(ri.speedBand(65, 0), 'r');
});

// v293/v295 — several alternates; an old single-string save still reads.
test('alternates: old save, per destination and per flight', () => {
  localStorage.clear();
  localStorage.setItem('fc.altn', JSON.stringify({ BCN: 'LEGE' }));
  const leg = { flight: 'LY395', dep_date: '23.11', dep_year: '2026', dep: 'TLV', arr: 'BCN' };
  assert.deepEqual(al.altnsOfLeg(leg), ['LEGE']);
  assert.ok(al.addAltn(leg, 'LERS'));                 // this flight only
  assert.ok(!al.addAltn(leg, 'lege'), 'no duplicates');
  assert.deepEqual(al.altnsOfLeg(leg), ['LEGE', 'LERS']);
  assert.deepEqual(al.altnsOfLeg({ ...leg, dep_date: '30.11' }), ['LEGE'], 'another BCN flight has the destination’s only');
  al.moveAltn(leg, 'LERS', 'dest');
  assert.deepEqual(al.altnsFor('BCN'), ['LEGE', 'LERS']);
  al.removeAltn(leg, 'LEGE');
  assert.deepEqual(al.altnsOfLeg(leg), ['LERS']);
});

// v295 — "changed since you last looked": a re-issued TAF with the same
// forecast isn't a change; a new group is.
test('TAF changes ignore the header, catch new groups', () => {
  localStorage.clear();
  const t1 = 'TAF LEBL 231100Z 2312/2412 35008KT 9999 FEW030 BECMG 2312/2314 VRB04KT TEMPO 2318/2324 13010KT';
  const t2 = 'TAF LEBL 231700Z 2318/2418 35008KT 9999 FEW030 BECMG 2312/2314 VRB04KT TEMPO 2318/2324 13010KT';
  const t3 = t2 + ' PROB30 TEMPO 2406/2412 RA SHRA FEW020TCU';
  assert.equal(seen.changes('LEBL', t1, []), null, 'first look is just remembered');
  assert.equal(seen.changes('LEBL', t2, []), null, 'same forecast, new issue time');
  const c = seen.changes('LEBL', t3, [{ id: 'A1', line: 'RWY 02/20 closed' }]);
  assert.deepEqual(c.taf, ['PROB30 TEMPO 2406/2412 RA SHRA FEW020TCU']);
  assert.equal(c.notams.length, 1);
  seen.gotIt('LEBL', t3, [{ id: 'A1' }]);
  assert.equal(seen.changes('LEBL', t3, [{ id: 'A1' }]), null);
});

// v295 — CPDLC: every FIR / sector along TLV–BCN, in order.
test('FIRs along TLV–BCN in order', () => {
  const route = ri.routePoints(LLBG, LEBL);
  const ids = cp.firsAlong(route.pts).map(s => s.id).filter(Boolean);
  const order = ['LCCC', 'LGGG', 'LECB'].map(id => ids.indexOf(id));
  assert.ok(order.every(i => i >= 0), `got ${ids.join(' ')}`);
  assert.ok(order[0] < order[1] && order[1] < order[2]);
  assert.equal(cp.cpdlcOf('LECB').code, 'LECB');
  assert.equal(cp.cpdlcOf('LGGG').on, false);
});

// v292 — restoring a backup filled nothing on flights the calendar had
// already added: roles, crew names, notes and ticks must come across.
test('backup merge fills flights already on the iPad', async () => {
  localStorage.clear();
  const st = await import(M + 'storage.js');
  const base = { flight: 'ELY395', dep: 'TLV', arr: 'BCN', dep_date: '23.11', dep_year: '2026', dep_time: '10:00' };
  st.setLegs([{ ...base, flight: 'LY395', dataCard: { to_role: 'PF', ldg_role: 'PM', cpt: 'TEST CAPTAIN' }, notes: { a: 'note' }, ticks: { a: 1 } }]);
  st.flush();
  const backup = localStorage.getItem('fc.state');
  st.setLegs([{ ...base, dataCard: { cpt: 'ALREADY HERE' }, notes: {}, ticks: {} }]);
  st.flush();
  const added = st.mergeStateFrom(backup);
  const leg = st.getLegs()[0];
  assert.equal(added.filled, 1);
  assert.equal(st.getLegs().length, 1, 'LY395 and ELY395 are one flight');
  assert.equal(leg.dataCard.to_role, 'PF');
  assert.equal(leg.dataCard.cpt, 'ALREADY HERE', 'never overwrites');
  assert.equal(leg.notes.a, 'note');
  assert.equal(leg.ticks.a, 1);
});
