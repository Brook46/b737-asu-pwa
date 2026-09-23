// backup.js — everything the pilot has, out and back in.
//
// JSON is the complete backup (every saved check with its readings, plus wings
// added from their own sheets) and restores into another browser or device.
// CSV is for spreadsheets: one row per reading across every check.

import { sessions, customGliders } from './store.js?v=14';
import { analyse } from './trim.js?v=14';
import { download } from './exporter.js?v=14';

const today = () => new Date().toISOString().slice(0, 10);

export function exportAllJson() {
  const payload = {
    app: 'line-trim', format: 1, exportedAt: new Date().toISOString(),
    checks: sessions.all(), wings: customGliders.all(),
  };
  download(`line-trim-backup-${today()}.json`, 'application/json', JSON.stringify(payload, null, 1));
  return payload.checks.length;
}

export function exportAllCsv() {
  const q = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [['check', 'measured_on', 'wing', 'size', 'serial', 'owner', 'measured_from', 'side', 'line', 'main',
                 'target_mm', 'reading_mm', 'delta_mm', 'relative_mm', 'status', 'source']];
  for (const s of sessions.all()) {
    let a; try { a = analyse(s); } catch { continue; }
    for (const l of a.lines) {
      rows.push([s.name || '', s.measuredOn || new Date(s.savedAt || s.createdAt).toISOString().slice(0, 10),
        `${s.brand} ${s.model}`, s.sizeKey, s.serial || '', s.owner || '', s.measureFrom || 'riser', l.side, l.lineId, l.mainId || '',
        l.target, l.measured, l.delta, l.rel, l.implausible ? 'implausible' : l.status, l.source]);
    }
  }
  download(`line-trim-all-readings-${today()}.csv`, 'text/csv', rows.map(r => r.map(q).join(',')).join('\n'));
  return rows.length - 1;
}

/** Merge a backup file in. Newer copies of the same check win; nothing is deleted. */
export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data?.app !== 'line-trim' || !Array.isArray(data.checks)) throw new Error('Not a Line Trim backup file.');
  const have = new Map(sessions.all().map(s => [s.id, s]));
  let added = 0, updated = 0;
  for (const c of data.checks) {
    if (!c?.id || c.v !== 3) continue;
    const mine = have.get(c.id);
    if (!mine) { sessions.save(c); added++; }
    else if ((c.savedAt || 0) > (mine.savedAt || 0)) { sessions.save(c); updated++; }
  }
  let wings = 0;
  for (const w of data.wings || []) if (w?.id && !customGliders.get(w.id)) { customGliders.save(w); wings++; }
  return { added, updated, wings };
}
