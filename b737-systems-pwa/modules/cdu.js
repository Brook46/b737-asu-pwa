// cdu.js — the Control Display Unit: pages, line select keys, scratchpad,
// EXEC, and the screen as a 14 × 24 character grid (title, six label / data
// line pairs, scratchpad). The grid is drawn by the HTML CDU here and, as a
// texture, by the 3D cockpit's CDUs. Page layouts are our own rendering of
// the standard 737 CDU pages; numbers come from fmc.js (approximate).

import { nav, geo } from './navdb.js?v=25';

const W = 24, ROWS = 14;
const COL = { w: '#f2f2f2', g: '#3df03d', m: '#ff5ad2', c: '#28e3f2', a: '#ffb21e' };
const pad = (s, n) => String(s).padStart(n, ' ');
const fl = (alt) => (alt == null ? '' : alt >= 18000 ? `FL${String(Math.round(alt / 100)).padStart(3, '0')}` : String(Math.round(alt)));
const BOX = (n) => '□'.repeat(n);
const hhmm = (min, now = new Date()) => {
  const t = new Date(now.getTime() + min * 60000);
  return `${String(t.getUTCHours()).padStart(2, '0')}${String(t.getUTCMinutes()).padStart(2, '0')}z`;
};

/** Parse an altitude entry: FL350, 350, 35000. */
export function parseAlt(s) {
  const m = String(s).toUpperCase().match(/^(FL)?(\d{2,5})$/);
  if (!m) return null;
  let v = +m[2];
  if (m[1] || v < 1000) v *= 100;
  return v >= 1000 && v <= 41000 ? v : null;
}

export function createCDU(fmc, hooks) {
  // hooks: aircraft(), phase(), onChange()
  let page = 'IDENT', sub = 0, sp = '';
  let screen = null, dirty = true;

  // ── Screen grid ──
  const blank = () => Array.from({ length: ROWS }, () => Array.from({ length: W }, () => ({ ch: ' ', c: 'w', sm: false })));
  function put(g, row, col, text, c = 'w', sm = false) {
    const s = String(text);
    for (let i = 0; i < s.length; i++) {
      const x = col + i;
      if (x >= 0 && x < W) g[row][x] = { ch: s[i], c, sm };
    }
  }
  const putR = (g, row, text, c, sm) => put(g, row, W - String(text).length, text, c, sm);
  const putC = (g, row, text, c, sm) => put(g, row, Math.floor((W - String(text).length) / 2), text, c, sm);

  // ── Pages: each returns { title, pg, L[6], R[6], rows(g) } ──
  const ac = () => hooks.aircraft?.();
  const S = fmc.S;
  const titleRte = (base) => `${fmc.mod ? 'MOD ' : S.active ? 'ACT ' : ''}${base}`;

  const PAGES = {
    INDEX: () => ({
      title: 'INIT/REF INDEX',
      draw(g) {
        put(g, 2, 0, '<IDENT'); putR(g, 2, 'NAV DATA>');
        put(g, 4, 0, '<POS'); put(g, 6, 0, '<PERF'); put(g, 8, 0, '<TAKEOFF'); put(g, 10, 0, '<APPROACH');
      },
      L: [() => go('IDENT'), () => go('POS'), () => go('PERF'), () => go('TAKEOFF'), () => go('APPROACH')],
      R: [() => go('IDENT')],
    }),
    IDENT: () => ({
      title: 'IDENT',
      draw(g) {
        put(g, 1, 1, 'MODEL', 'w', true); putR(g, 1, 'ENG RATING', 'w', true);
        put(g, 2, 0, '737-800W'); putR(g, 2, '26K');
        put(g, 3, 1, 'NAV DATA', 'w', true); putR(g, 3, 'ACTIVE', 'w', true);
        put(g, 4, 0, nav.ready ? 'OURAIRPORTS' : 'LOADING'); putR(g, 4, 'PUBLIC DOMAIN', 'w', true);
        put(g, 7, 1, 'OP PROGRAM', 'w', true); put(g, 8, 0, 'STUDY FMC - NOT FOR OPS', 'w', true);
        put(g, 11, 0, '------------------------', 'w', true);
        put(g, 12, 0, '<INDEX'); putR(g, 12, 'POS INIT>');
      },
      L: [null, null, null, null, null, () => go('INDEX')],
      R: [null, null, null, null, null, () => go('POS')],
    }),
    POS: () => {
      const ref = S.refApt && nav.airport(S.refApt), a = ac() || ref;
      return {
        title: 'POS INIT',
        draw(g) {
          put(g, 3, 1, 'REF AIRPORT', 'w', true);
          put(g, 4, 0, S.refApt || '----');
          if (ref) putR(g, 4, `${geo.fmtLat(ref.lat)} ${geo.fmtLon(ref.lon)}`, 'w', true);
          put(g, 5, 1, 'GATE', 'w', true); put(g, 6, 0, '-----');
          putR(g, 7, 'SET IRS POS', 'w', true);
          putR(g, 8, S.posSet && a ? `${geo.fmtLat(a.lat)} ${geo.fmtLon(a.lon)}` : `${BOX(3)}°${BOX(2)}.${BOX(1)} ${BOX(4)}°${BOX(2)}.${BOX(1)}`, S.posSet ? 'w' : 'w', S.posSet);
          putR(g, 9, 'GPS POS', 'w', true);
          if (a) putR(g, 10, `${geo.fmtLat(a.lat)} ${geo.fmtLon(a.lon)}`, 'w', true);
          put(g, 9, 1, 'UTC (GPS)', 'w', true);
          const d = new Date();
          put(g, 10, 0, `${String(d.getUTCHours()).padStart(2, '0')}${String(d.getUTCMinutes()).padStart(2, '0')}z`);
          put(g, 11, 0, '------------------------', 'w', true);
          put(g, 12, 0, '<INDEX'); putR(g, 12, 'ROUTE>');
        },
        L: [null, (v) => { if (!v) return { copy: S.refApt || '' }; if (!nav.airport(v)) return 'NOT IN DATA BASE'; S.refApt = v; fmc.changed(); hooks.placeAtAirport?.(v); return null; }, null, null, null, () => go('INDEX')],
        R: [null, () => (ref ? { copy: `${geo.fmtLat(ref.lat).replace('°', '')}${geo.fmtLon(ref.lon).replace('°', '')}` } : null),
          null,
          (v) => { if (!v) return null; S.posSet = true; fmc.changed(); hooks.enterIrsPos?.(); return null; },
          () => (a ? { copy: `${geo.fmtLat(a.lat).replace('°', '')}${geo.fmtLon(a.lon).replace('°', '')}` } : null),
          () => go('RTE')],
      };
    },
    RTE: () => {
      const r = fmc.route();
      if (sub === 0) return {
        title: titleRte('RTE 1'), pg: [1, 1 + Math.max(1, Math.ceil((r.wpts.length + 1) / 5))],
        draw(g) {
          put(g, 1, 1, 'ORIGIN', 'w', true); putR(g, 1, 'DEST', 'w', true);
          put(g, 2, 0, r.origin || BOX(4)); putR(g, 2, r.dest || BOX(4));
          put(g, 3, 1, 'RUNWAY', 'w', true); putR(g, 3, 'FLT NO', 'w', true);
          put(g, 4, 0, r.depRwy ? `RW${r.depRwy}` : '-----'); putR(g, 4, r.flt || '--------');
          putR(g, 5, 'CO ROUTE', 'w', true); putR(g, 6, '----------');
          put(g, 11, 0, '------------------------', 'w', true);
          if (fmc.mod) put(g, 12, 0, '<ERASE');
          putR(g, 12, !S.active ? 'ACTIVATE>' : 'PERF INIT>');
        },
        L: [(v) => (v ? fmc.setOrigin(v) : { copy: r.origin || '' }), (v) => { if (!v) return null; const id = v.replace(/^RW/, ''); if (!nav.runway(r.origin, id)) return 'NOT IN DATA BASE'; fmc.setDepRwy(id); return null; },
          null, null, null, () => { if (fmc.mod) fmc.erase(); }],
        R: [(v) => (v ? fmc.setDest(v) : { copy: r.dest || '' }), (v) => { if (!v) return null; fmc.edit((m) => { m.flt = v.slice(0, 8); }); return null; },
          null, null, null, () => { if (!S.active) { fmc.activate(); return null; } return go('PERF'); }],
      };
      // RTE 2+: VIA / TO — DIRECT only (no airway data in this database).
      const first = (sub - 1) * 5;
      const rows = r.wpts.slice(first, first + 5);
      return {
        title: titleRte('RTE 1'), pg: [sub + 1, 1 + Math.max(1, Math.ceil((r.wpts.length + 1) / 5))],
        draw(g) {
          put(g, 1, 1, 'VIA', 'w', true); putR(g, 1, 'TO', 'w', true);
          rows.forEach((w, i) => { put(g, 2 + i * 2, 0, 'DIRECT'); putR(g, 2 + i * 2, w.ident); });
          if (rows.length < 5) { put(g, 2 + rows.length * 2, 0, '-----'); putR(g, 2 + rows.length * 2, '-----'); }
          put(g, 11, 0, '------------------------', 'w', true);
          if (fmc.mod) put(g, 12, 0, '<ERASE');
          putR(g, 12, !S.active ? 'ACTIVATE>' : 'PERF INIT>');
        },
        L: [0, 1, 2, 3, 4].map((i) => (v) => { if (v === 'DELETE' && rows[i]) { fmc.deleteWpt(first + i); return null; } return v ? null : null; }).concat([() => { if (fmc.mod) fmc.erase(); }]),
        R: [0, 1, 2, 3, 4].map((i) => (v) => {
          if (!v) return rows[i] ? { copy: rows[i].ident } : null;
          if (v === 'DELETE') { if (rows[i]) fmc.deleteWpt(first + i); return null; }
          if (rows[i]) { fmc.deleteWpt(first + i); return fmc.insertWpt(first + i, v); }
          return i <= rows.length ? fmc.insertWpt(first + i, v) : 'INVALID ENTRY';
        }).concat([() => { if (!S.active) fmc.activate(); else go('PERF'); }]),
      };
    },
    DEPARR: () => {
      const r = fmc.route();
      return {
        title: 'DEP/ARR INDEX',
        draw(g) {
          put(g, 2, 0, '<DEP'); putC(g, 2, r.origin || '----'); putR(g, 2, 'ARR>');
          putC(g, 4, r.dest || '----'); putR(g, 4, 'ARR>');
        },
        L: [() => (r.origin ? go('DEP') : 'INVALID ENTRY')],
        R: [() => (r.origin ? go('ARRo') : 'INVALID ENTRY'), () => (r.dest ? go('ARR') : 'INVALID ENTRY')],
      };
    },
    DEP: () => rwyPage('DEP'),
    ARR: () => rwyPage('ARR'),
    ARRo: () => rwyPage('ARR', true),
    LEGS: () => {
      const legs = fmc.legs(), start = S.active && !fmc.mod ? S.activeIdx : Math.min(1, legs.length - 1);
      const view = legs.slice(Math.max(1, start)).map((l, i) => ({ l, idx: Math.max(1, start) + i }));
      const nPg = Math.max(1, Math.ceil(view.length / 5));
      const pgI = Math.min(sub, nPg - 1);
      const rows = view.slice(pgI * 5, pgI * 5 + 5);
      const prof = fmc.profile();
      const enrouteIndex = (idx) => idx - (legs[0] ? 1 : 0);           // legs[0] is the origin runway
      return {
        title: titleRte('RTE 1 LEGS'), pg: [pgI + 1, nPg],
        draw(g) {
          rows.forEach(({ l, idx }, i) => {
            const isActive = S.active && !fmc.mod && idx === S.activeIdx;
            put(g, 1 + i * 2, 1, `${String(l.crs ?? '').padStart(3, '0')}°`, 'w', true);
            put(g, 1 + i * 2, 7, `${(l.dist ?? 0) < 10 ? (l.dist ?? 0).toFixed(1) : Math.round(l.dist ?? 0)}NM`, 'w', true);
            put(g, 2 + i * 2, 0, l.ident, isActive ? 'm' : 'w');
            const pl = prof.legs?.find((x) => x.ident === l.ident && Math.abs(x.lat - l.lat) < 1e-6);
            if (l.alt != null) putR(g, 2 + i * 2, `${l.spd ? `${l.spd}/` : ''}${fl(l.alt)}${l.altType === 'A' ? 'A' : l.altType === 'B' ? 'B' : ''}`, 'c');
            else if (pl?.predAlt != null) putR(g, 2 + i * 2, `${pl.predAlt > 10000 ? '280' : '250'}/${fl(pl.predAlt)}`, 'w', true);
            else putR(g, 2 + i * 2, '---/-----', 'w', true);
          });
          if (!rows.length) putC(g, 6, legs.length ? 'END OF ROUTE' : 'NO ROUTE', 'w', true);
          put(g, 11, 0, '------------------------', 'w', true);
          if (fmc.mod) put(g, 12, 0, '<ERASE');
          putR(g, 12, !S.active ? 'ACTIVATE>' : 'RTE DATA>');
        },
        L: [0, 1, 2, 3, 4].map((i) => (v) => {
          const row = rows[i];
          if (!v) return row ? { copy: row.l.ident } : null;
          const eIdx = row ? enrouteIndex(row.idx) : fmc.route().wpts.length;
          if (v === 'DELETE') { if (row && row.l.kind === 'wpt') { fmc.deleteWpt(eIdx); return null; } return 'INVALID DELETE'; }
          // Typed into the active (first) line in flight: DIRECT TO.
          const a = ac();
          if (i === 0 && pgI === 0 && S.active && a && !a.onGround) return fmc.directTo(v);
          return fmc.insertWpt(Math.max(0, Math.min(eIdx, fmc.route().wpts.length)), v);
        }).concat([() => { if (fmc.mod) fmc.erase(); }]),
        R: [0, 1, 2, 3, 4].map((i) => (v) => {
          const row = rows[i];
          if (!row || row.l.kind !== 'wpt') return v ? 'INVALID ENTRY' : null;
          if (!v) return null;
          return fmc.setConstraint(enrouteIndex(row.idx), v);
        }).concat([() => { if (!S.active) fmc.activate(); }]),
      };
    },
    PERF: () => {
      const gw = fmc.gw(), p = S.perf;
      return {
        title: 'PERF INIT',
        draw(g) {
          put(g, 1, 1, 'GR WT', 'w', true); putR(g, 1, 'CRZ ALT', 'w', true);
          put(g, 2, 0, gw != null ? gw.toFixed(1) : '---.-'); putR(g, 2, p.crzAlt ? fl(p.crzAlt) : BOX(5));
          put(g, 3, 1, 'FUEL', 'w', true); putR(g, 3, 'COST INDEX', 'w', true);
          put(g, 4, 0, `${fmc.fuelT().toFixed(1)}`); put(g, 4, 6, 'CALC', 'w', true); putR(g, 4, p.ci != null ? String(p.ci) : BOX(4));
          put(g, 5, 1, 'ZFW', 'w', true); putR(g, 5, 'TRANS ALT', 'w', true);
          put(g, 6, 0, p.zfw != null ? p.zfw.toFixed(1) : BOX(5)); putR(g, 6, String(p.transAlt));
          put(g, 7, 1, 'RESERVES', 'w', true);
          put(g, 8, 0, p.reserves != null ? p.reserves.toFixed(1) : BOX(4));
          putC(g, 10, 'WEIGHTS IN 1000 KG', 'w', true);
          put(g, 11, 0, '------------------------', 'w', true);
          put(g, 12, 0, '<INDEX'); putR(g, 12, 'N1 LIMIT>');
        },
        L: [(v) => { if (!v) return null; const n = +v; if (!(n > 40 && n < 80)) return 'INVALID ENTRY'; p.zfw = +(n - fmc.fuelT()).toFixed(1); fmc.changed(); return null; },
          null,
          (v) => { if (!v) return null; const n = +v; if (!(n > 35 && n < 70)) return 'INVALID ENTRY'; p.zfw = n; fmc.changed(); return null; },
          (v) => { if (!v) return null; const n = +v; if (!(n >= 0 && n < 20)) return 'INVALID ENTRY'; p.reserves = n; fmc.changed(); return null; },
          null, () => go('INDEX')],
        R: [(v) => { if (!v) return null; const a = parseAlt(v); if (!a) return 'INVALID ENTRY'; p.crzAlt = a; fmc.changed(); return null; },
          (v) => { if (!v) return null; const n = +v; if (!(n >= 0 && n <= 999)) return 'INVALID ENTRY'; p.ci = n; fmc.changed(); return null; },
          (v) => { if (!v) return null; const a = parseAlt(v); if (!a) return 'INVALID ENTRY'; p.transAlt = a; fmc.changed(); return null; },
          null, null, () => go('N1')],
      };
    },
    N1: () => {
      const n = fmc.n1(), t = S.tko;
      return {
        title: 'N1 LIMIT',
        draw(g) {
          put(g, 1, 1, 'SEL/OAT', 'w', true); putR(g, 1, '26K N1', 'w', true);
          put(g, 2, 0, `${t.selTemp != null ? `${t.selTemp}°C` : '--'}/+15°C`, 'g'); putR(g, 2, n.to.toFixed(1), 'g');
          put(g, 4, 0, '<TO'); put(g, 4, 5, '<ACT>', 'g', true); putR(g, 4, 'CLB>');
          putR(g, 6, `${n.clb.toFixed(1)}`, 'w', true);
          putC(g, 9, 'APPROXIMATE VALUES', 'w', true);
          put(g, 11, 0, '------------------------', 'w', true);
          put(g, 12, 0, '<PERF INIT'); putR(g, 12, 'TAKEOFF>');
        },
        L: [(v) => { if (!v) return null; const n = parseInt(v, 10); if (!(n >= -40 && n <= 70)) return 'INVALID ENTRY'; t.selTemp = n; fmc.changed(); return null; }, null, null, null, null, () => go('PERF')],
        R: [null, null, null, null, null, () => go('TAKEOFF')],
      };
    },
    TAKEOFF: () => {
      const t = S.tko, sug = fmc.vspeeds();
      const v = (k) => (t[k] != null ? [String(t[k]), false] : sug ? [String(sug[k]), true] : ['---', false]);
      return {
        title: 'TAKEOFF REF',
        draw(g) {
          put(g, 1, 1, 'FLAPS', 'w', true); putR(g, 1, 'V1', 'w', true);
          put(g, 2, 0, `${String(t.flaps).padStart(2, '0')}°`);
          const [a, as] = v('v1'), [b, bs] = v('vr'), [c, cs] = v('v2');
          putR(g, 2, `${a}KT`, as ? 'c' : 'w', as);
          put(g, 3, 1, 'CG', 'w', true); putR(g, 3, 'VR', 'w', true);
          put(g, 4, 0, '--.-%'); putR(g, 4, `${b}KT`, bs ? 'c' : 'w', bs);
          put(g, 5, 1, 'RUNWAY', 'w', true); putR(g, 5, 'V2', 'w', true);
          put(g, 6, 0, fmc.route().depRwy ? `RW${fmc.route().depRwy}` : '-----'); putR(g, 6, `${c}KT`, cs ? 'c' : 'w', cs);
          put(g, 7, 1, 'GW', 'w', true);
          put(g, 8, 0, fmc.gw() != null ? fmc.gw().toFixed(1) : '---.-');
          putC(g, 10, 'APPROX - NOT FOR OPS', 'w', true);
          put(g, 11, 0, '------------------------', 'w', true);
          put(g, 12, 0, '<INDEX'); putR(g, 12, 'POS INIT>');
        },
        L: [(val) => { if (!val) return null; const f = +val; if (![1, 5, 10, 15, 25].includes(f)) return 'INVALID ENTRY'; t.flaps = f; t.v1 = t.vr = t.v2 = null; fmc.changed(); return null; },
          null, null, null, null, () => go('INDEX')],
        R: ['v1', 'vr', 'v2'].map((k) => (val) => {
          if (!val) { if (sug) { t[k] = sug[k]; fmc.changed(); } return null; }
          const n = +val; if (!(n > 90 && n < 190)) return 'INVALID ENTRY'; t[k] = n; fmc.changed(); return null;
        }).concat([null, null, () => go('POS')]),
      };
    },
    APPROACH: () => {
      const a = S.appr;
      const rw = fmc.route().arrRwy && nav.runway(fmc.route().dest, fmc.route().arrRwy);
      return {
        title: 'APPROACH REF',
        draw(g) {
          put(g, 1, 1, 'GROSS WT', 'w', true); putR(g, 1, 'FLAPS   VREF', 'w', true);
          put(g, 2, 0, fmc.gw() != null ? (fmc.gw() - 0).toFixed(1) : '---.-');
          [15, 30, 40].forEach((f, i) => putR(g, 2 + i * 2, `${f}°   ${fmc.vref(f) ?? '---'}KT`));
          if (rw) { put(g, 7, 1, `${fmc.route().dest}${rw.id}`, 'w', true); put(g, 8, 0, `${rw.len}FT`); put(g, 9, 1, 'CRS', 'w', true); put(g, 10, 0, `${String(Math.round((rw.hdgT - nav.magVar(rw) + 360) % 360)).padStart(3, '0')}°`); }
          putR(g, 9, 'FLAP/SPD', 'w', true);
          putR(g, 10, a.flaps ? `${a.flaps}/${a.vref}` : '--/---');
          put(g, 11, 0, '------------------------', 'w', true);
          put(g, 12, 0, '<INDEX');
        },
        L: [null, null, null, null, null, () => go('INDEX')],
        R: [15, 30, 40].map((f) => () => ({ copy: `${f}/${fmc.vref(f) ?? ''}` })).concat([null,
          (v) => { if (!v) return null; const m = v.match(/^(15|30|40)\/(\d{3})$/); if (!m) return 'INVALID ENTRY'; a.flaps = +m[1]; a.vref = +m[2]; fmc.changed(); return null; }, null]),
      };
    },
    CLB: () => vnavPage('CLB'),
    CRZ: () => vnavPage('CRZ'),
    DES: () => vnavPage('DES'),
    PROG: () => {
      const legs = fmc.activeLegs(), a = ac(), prof = fmc.profile(S.route);
      const to = legs[S.activeIdx], next = legs[S.activeIdx + 1], dest = legs[legs.length - 1];
      const dTo = to && a ? geo.dist(a, to) : null;
      const dtg = fmc.dtg(a);
      const gs = Math.max(120, a?.gs || 250);
      const eta = (d) => (d == null ? '----z' : hhmm((d / gs) * 60));
      const fuelAt = (d) => (d == null ? '--.-' : Math.max(0, fmc.fuelT() - ((d / gs) * 60 * 45) / 1000).toFixed(1));
      return {
        title: `${S.route.flt || ''} PROGRESS`.trim(), pg: [1, 1],
        draw(g) {
          put(g, 1, 1, 'TO', 'w', true); putR(g, 1, 'DTG  ETA   FUEL', 'w', true);
          if (to) { put(g, 2, 0, to.ident, 'm'); putR(g, 2, `${pad(Math.round(dTo), 4)} ${eta(dTo)} ${fuelAt(dTo)}`); }
          put(g, 3, 1, 'NEXT', 'w', true);
          if (next) { const d = dTo + (next.dist || 0); put(g, 4, 0, next.ident); putR(g, 4, `${pad(Math.round(d), 4)} ${eta(d)} ${fuelAt(d)}`); }
          put(g, 5, 1, 'DEST', 'w', true);
          if (dest && dtg != null) { put(g, 6, 0, S.route.dest || dest.ident); putR(g, 6, `${pad(Math.round(dtg), 4)} ${eta(dtg)} ${fuelAt(dtg)}`); }
          if (prof.tod != null && a && !a.onGround && dtg != null) {
            const toTod = dtg - prof.todFromEnd;
            put(g, 7, 1, toTod > 0 ? 'TO T/D' : 'PAST T/D', 'w', true);
            if (toTod > 0) put(g, 8, 0, `${eta(toTod)}/${Math.round(toTod)}NM`);
          }
          put(g, 9, 1, 'GS', 'w', true); putR(g, 9, 'FUEL QTY', 'w', true);
          put(g, 10, 0, a ? `${Math.round(a.gs)}KT` : '---'); putR(g, 10, `${fmc.fuelT().toFixed(1)}`);
          put(g, 11, 0, '------------------------', 'w', true);
        },
        L: [], R: [],
      };
    },
    NA: () => ({ title: 'NOT AVAILABLE', draw(g) { putC(g, 6, 'NOT IN THIS STUDY FMC', 'w', true); put(g, 12, 0, '<INDEX'); }, L: [null, null, null, null, null, () => go('INDEX')], R: [] }),
    MENU: () => ({ title: 'MENU', draw(g) { put(g, 2, 0, '<FMC'); putR(g, 2, '<ACT>', 'g', true); }, L: [() => go('IDENT')], R: [] }),
  };

  function rwyPage(kind, originArr = false) {
    const r = fmc.route();
    const apt = kind === 'DEP' || originArr ? r.origin : r.dest;
    const list = nav.runways(apt).sort((a, b) => a.id.localeCompare(b.id));
    const nPg = Math.max(1, Math.ceil(list.length / 5)), pgI = Math.min(sub, nPg - 1);
    const rows = list.slice(pgI * 5, pgI * 5 + 5);
    const sel = kind === 'DEP' ? r.depRwy : r.arrRwy;
    return {
      title: `${apt} ${kind === 'DEP' ? 'DEPARTURES' : 'ARRIVALS'}`, pg: [pgI + 1, nPg],
      draw(g) {
        put(g, 1, 1, kind === 'DEP' ? 'SIDS' : 'STARS', 'w', true); putR(g, 1, kind === 'DEP' ? 'RUNWAYS' : 'APPROACHES', 'w', true);
        put(g, 2, 0, 'NONE IN DB', 'w', true);
        rows.forEach((w, i) => putR(g, 2 + i * 2, `${w.id === sel ? '<SEL> ' : ''}${kind === 'DEP' ? '' : 'RW'}${w.id}`, w.id === sel ? 'g' : 'w'));
        rows.forEach((w, i) => putR(g, 3 + i * 2, `${w.len}FT`, 'w', true));
        put(g, 11, 0, '------------------------', 'w', true);
        put(g, 12, 0, '<INDEX'); putR(g, 12, 'ROUTE>');
      },
      L: [null, null, null, null, null, () => go('DEPARR')],
      R: rows.map((w) => () => { if (kind === 'DEP') fmc.setDepRwy(w.id); else fmc.setArrRwy(w.id); return null; }).concat([null, null, null, null, null].slice(rows.length), [() => go('RTE')]),
    };
  }

  function vnavPage(kind) {
    const p = S.perf, prof = fmc.profile(S.route), a = ac();
    const dtg = fmc.dtg(a);
    const stage = hooks.vnavStage?.() || '';
    const act = (kind === 'CLB' && stage === 'climb') || (kind === 'CRZ' && stage === 'cruise') || (kind === 'DES' && stage === 'descent');
    const names = { CLB: 'ECON CLB', CRZ: 'ECON CRZ', DES: 'ECON PATH DES' };
    return {
      title: `${act ? 'ACT ' : ''}${names[kind]}`, pg: [1, 1],
      draw(g) {
        if (kind === 'CLB') {
          put(g, 1, 1, 'CRZ ALT', 'w', true); put(g, 2, 0, p.crzAlt ? fl(p.crzAlt) : BOX(5));
          put(g, 3, 1, 'ECON SPD', 'w', true); put(g, 4, 0, '280/.780');
          put(g, 5, 1, 'SPD REST', 'w', true); put(g, 6, 0, '250/10000');
          if (prof.tc != null) { putR(g, 1, 'TO T/C', 'w', true); putR(g, 2, `${Math.round(prof.tc)}NM`); }
          putR(g, 5, 'N1', 'w', true); putR(g, 6, fmc.n1().clb.toFixed(1));
        } else if (kind === 'CRZ') {
          const w = fmc.gw() ?? 65, max = Math.round((41000 - Math.max(0, w - 60) * 450) / 100) * 100, opt = max - 2000;
          put(g, 1, 1, 'CRZ ALT', 'w', true); putR(g, 1, 'STEP TO', 'w', true);
          put(g, 2, 0, p.crzAlt ? fl(p.crzAlt) : BOX(5)); putR(g, 2, 'NONE');
          put(g, 3, 1, 'ECON SPD', 'w', true); put(g, 4, 0, '.780');
          put(g, 5, 1, 'N1', 'w', true); put(g, 6, 0, '87.6/87.6');
          putR(g, 5, 'OPT    MAX', 'w', true); putR(g, 6, `${fl(opt)}  ${fl(max)}`);
          if (dtg != null && prof.todFromEnd != null) { putR(g, 7, 'TO T/D', 'w', true); putR(g, 8, `${Math.max(0, Math.round(dtg - prof.todFromEnd))}NM`); }
          put(g, 9, 1, 'FUEL AT DEST', 'w', true);
          put(g, 10, 0, dtg != null ? Math.max(0, fmc.fuelT() - ((dtg / Math.max(250, a?.gs || 400)) * 60 * 42) / 1000).toFixed(1) : '--.-');
        } else {
          const end = prof.legs?.[prof.legs.length - 1];
          put(g, 1, 1, 'E/D ALT', 'w', true); putR(g, 1, 'AT', 'w', true);
          put(g, 2, 0, end?.alt != null ? fl(end.alt) : '-----'); putR(g, 2, end?.ident || '-----');
          put(g, 3, 1, 'ECON SPD', 'w', true); put(g, 4, 0, '.780/280');
          put(g, 5, 1, 'SPD REST', 'w', true); put(g, 6, 0, '240/10000');
          put(g, 7, 1, 'PATH', 'w', true); put(g, 8, 0, '3.00°');
          if (dtg != null && prof.todFromEnd != null) {
            const toTod = dtg - prof.todFromEnd;
            putR(g, 7, toTod > 0 ? 'TO T/D' : 'VERT DEV', 'w', true);
            if (toTod > 0) putR(g, 8, `${Math.round(toTod)}NM`);
            else if (a) { const dev = Math.round((a.alt - fmc.pathAlt(dtg)) / 10) * 10; putR(g, 8, `${dev >= 0 ? 'HI' : 'LO'} ${Math.abs(dev)}`); }
          }
        }
        put(g, 11, 0, '------------------------', 'w', true);
      },
      L: [(v) => { if (kind === 'DES' || !v) return null; const al = parseAlt(v); if (!al) return 'INVALID ENTRY'; p.crzAlt = al; fmc.changed(); return null; }],
      R: [],
    };
  }

  // ── Navigation between pages ──
  function go(p, s = 0) { page = p; sub = s; dirty = true; hooks.onChange?.(); return null; }
  const pageCount = () => {
    const pd = PAGES[page]?.();
    return pd?.pg ? pd.pg[1] : 1;
  };

  // ── Keys ──
  const FUNC = {
    'INIT REF': () => go(!S.posSet ? 'POS' : S.perf.zfw == null || !S.perf.crzAlt ? 'PERF' : ac()?.onGround !== false ? 'TAKEOFF' : 'APPROACH'),
    RTE: () => go('RTE'), CLB: () => go('CLB'), CRZ: () => go('CRZ'), DES: () => go('DES'), MENU: () => go('MENU'),
    LEGS: () => go('LEGS'), 'DEP ARR': () => go('DEPARR'), HOLD: () => go('NA'), PROG: () => go('PROG'),
    'N1 LIMIT': () => go('N1'), FIX: () => go('NA'),
    'PREV PAGE': () => { const n = pageCount(); sub = (sub - 1 + n) % n; dirty = true; },
    'NEXT PAGE': () => { const n = pageCount(); sub = (sub + 1) % n; dirty = true; },
    EXEC: () => { if (fmc.execLit) fmc.exec(); dirty = true; },
  };
  function key(k) {
    if (fmc.S.msg && k !== 'CLR') { /* a message sits in the scratchpad until cleared */ }
    if (FUNC[k]) { FUNC[k](); hooks.onChange?.(); return; }
    if (/^[LR][1-6]$/.test(k)) { lsk(k[0], +k[1] - 1); return; }
    if (k === 'CLR') { if (fmc.S.msg) fmc.clearMsg(); else sp = sp.slice(0, -1); dirty = true; return; }
    if (k === 'CLRALL') { fmc.clearMsg(); sp = ''; dirty = true; return; }
    if (k === 'DEL') { sp = sp ? sp : 'DELETE'; dirty = true; return; }
    if (k === '+/-') { sp = sp.endsWith('-') ? `${sp.slice(0, -1)}+` : `${sp}-`; dirty = true; return; }
    if (k === 'SP') k = ' ';
    if (k.length === 1 && sp.length < 22) { if (fmc.S.msg) fmc.clearMsg(); sp += k; dirty = true; }
  }
  function lsk(side, i) {
    const pd = PAGES[page]?.();
    const fn = pd?.[side]?.[i];
    if (!fn) return;
    const res = fn(sp.trim());
    if (typeof res === 'string') fmc.msg(res);
    else if (res && res.copy != null) { if (!sp) sp = String(res.copy); }
    else if (sp) sp = '';
    dirty = true;
    hooks.onChange?.();
  }

  // ── Render ──
  function render() {
    const g = blank();
    const pd = PAGES[page]?.() || PAGES.IDENT();
    putC(g, 0, pd.title);
    if (pd.pg) putR(g, 0, `${pd.pg[0]}/${pd.pg[1]}`, 'w', true);
    pd.draw(g);
    const msg = fmc.S.msg;
    put(g, 13, 0, (msg || sp).slice(0, W), msg ? 'w' : 'w');
    screen = g;
    dirty = false;
    return g;
  }

  return {
    key, render, go,
    get screen() { return screen || render(); },
    get page() { return page; },
    get scratch() { return sp; },
    get dirty() { return dirty; },
    touch() { dirty = true; },
    COL, W, ROWS,
  };
}

/** Draw a CDU screen grid on a canvas (for the 3D cockpit CDUs). */
export function drawCDUScreen(g, Wpx, Hpx, grid, execLit) {
  g.fillStyle = '#050607'; g.fillRect(0, 0, Wpx, Hpx);
  if (!grid) return;
  const cw = Wpx / W, ch = Hpx / (ROWS + 0.4);
  g.textBaseline = 'middle'; g.textAlign = 'center';
  grid.forEach((row, r) => row.forEach((c, x) => {
    if (c.ch === ' ') return;
    g.fillStyle = COL[c.c] || COL.w;
    g.font = `${c.sm ? 600 : 700} ${Math.round(ch * (c.sm ? 0.62 : 0.84))}px Menlo, monospace`;
    g.fillText(c.ch, x * cw + cw / 2, r * ch + ch * 0.62);
  }));
  void execLit;
}
