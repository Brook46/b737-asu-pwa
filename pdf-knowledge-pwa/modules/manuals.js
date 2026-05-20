// Manual-type definitions, anchor-type mapping, and filename heuristics.
// Each B737 manual family uses a different persistent anchor scheme:
//   FCOM/FCTM/OMA -> decimal page numbers (e.g. 13.20.3)
//   MEL/CDL       -> ATA item numbers   (e.g. 21-44)
//   QRH           -> NNC checklist titles

export const MANUAL_TYPES = [
  { id: 'FCOM', label: 'FCOM — Flight Crew Operations Manual', anchorType: 'decimal' },
  { id: 'FCTM', label: 'FCTM — Flight Crew Training Manual', anchorType: 'decimal' },
  { id: 'MEL',  label: 'MEL / CDL — Minimum Equipment List', anchorType: 'ata' },
  { id: 'OMA',  label: 'OMA — Operations Manual Part A', anchorType: 'decimal' },
  { id: 'QRH',  label: 'QRH — Quick Reference Handbook', anchorType: 'nnc' },
  { id: 'PERSONAL', label: 'Personal Document', anchorType: 'page' },
];

const TYPE_BY_ID = new Map(MANUAL_TYPES.map((m) => [m.id, m]));

export function anchorTypeFor(manualType) {
  const m = TYPE_BY_ID.get(manualType);
  return m ? m.anchorType : 'decimal';
}

export function manualLabel(manualType) {
  const m = TYPE_BY_ID.get(manualType);
  return m ? m.label : manualType;
}

export function anchorTypeLabel(anchorType) {
  if (anchorType === 'decimal') return 'Decimal page';
  if (anchorType === 'ata') return 'ATA item';
  if (anchorType === 'nnc') return 'NNC title';
  if (anchorType === 'page') return 'Page';
  return anchorType;
}

// Best-effort guess of the manual type from the uploaded filename so the
// import modal can pre-fill the selector.
export function guessManualType(filename) {
  const n = (filename || '').toLowerCase();
  if (/\bfctm\b|training/.test(n)) return 'FCTM';
  if (/\bqrh\b|quick.?reference|non.?normal/.test(n)) return 'QRH';
  if (/\bmel\b|\bcdl\b|minimum.?equipment/.test(n)) return 'MEL';
  if (/\boma\b|om.?a\b|part.?a\b/.test(n)) return 'OMA';
  if (/\bfcom\b|operations.?manual/.test(n)) return 'FCOM';
  return 'FCOM';
}
