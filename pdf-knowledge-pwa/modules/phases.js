// FCTM phases of flight + the phase->manual-section map that drives the
// dashboard, the contextual toggles and the multi-tab viewer.
//
// Each section entry is a "tab spec": a manual type plus a free-text `hint`
// that knowledge-graph.findAnchors() resolves to actual pages. The hints are
// sensible defaults — they match against anchor titles, which depend on the
// uploaded PDFs, so the anchor-admin titles are what make them land precisely.

export const PHASES = [
  { id: 'dispatch',     label: 'Dispatch' },
  { id: 'takeoff',      label: 'Takeoff' },
  { id: 'climb',        label: 'Climb' },
  { id: 'cruise',       label: 'Cruise' },
  { id: 'descent',      label: 'Descent' },
  { id: 'approach',     label: 'Approach' },
  { id: 'landing',      label: 'Landing' },
  { id: 'afterLanding', label: 'After Landing' },
];

export const TOGGLES = [
  { id: 'normal',    label: 'Normal Ops',        source: 'FCOM NP / Amplified Procedures' },
  { id: 'nonNormal', label: 'Non-Normal',        source: 'QRH NNCs' },
  { id: 'weather',   label: 'Weather / Adverse', source: 'FCOM SP.16 / OMA 8.3' },
];

// section: { manualType, hint, label }
const S = (manualType, hint, label) => ({ manualType, hint, label });

export const PHASE_SECTIONS = {
  dispatch: {
    normal:    [S('FCOM', 'Preflight', 'FCOM Preflight'), S('FCTM', 'Preflight', 'FCTM Preflight'), S('OMA', 'Dispatch', 'OMA Dispatch')],
    nonNormal: [S('MEL', '', 'MEL Items'), S('QRH', 'Dispatch', 'QRH Dispatch Deviation')],
    weather:   [S('FCOM', 'Adverse Weather', 'FCOM SP.16 Adverse Weather'), S('OMA', 'Weather', 'OMA 8.3 Weather')],
  },
  takeoff: {
    normal:    [S('FCOM', 'Takeoff', 'FCOM Takeoff'), S('FCTM', 'Takeoff', 'FCTM Takeoff'), S('OMA', 'Takeoff', 'OMA Takeoff')],
    nonNormal: [S('QRH', 'Rejected Takeoff', 'QRH Rejected Takeoff'), S('QRH', 'Engine', 'QRH Engine Failure')],
    weather:   [S('FCOM', 'Crosswind', 'FCOM Crosswind'), S('FCTM', 'Crosswind Takeoff', 'FCTM Crosswind Takeoff')],
  },
  climb: {
    normal:    [S('FCOM', 'Climb', 'FCOM Climb'), S('FCTM', 'Climb', 'FCTM Climb')],
    nonNormal: [S('QRH', 'Climb', 'QRH Climb'), S('QRH', 'Engine', 'QRH Engine')],
    weather:   [S('FCOM', 'Turbulence', 'FCOM Turbulence'), S('FCOM', 'Icing', 'FCOM Icing')],
  },
  cruise: {
    normal:    [S('FCOM', 'Cruise', 'FCOM Cruise'), S('FCTM', 'Cruise', 'FCTM Cruise')],
    nonNormal: [S('QRH', 'Cruise', 'QRH Cruise'), S('QRH', 'Depressurization', 'QRH Depressurization')],
    weather:   [S('FCOM', 'Turbulence', 'FCOM Turbulence'), S('OMA', 'Weather', 'OMA 8.3 Weather')],
  },
  descent: {
    normal:    [S('FCOM', 'Descent', 'FCOM Descent'), S('FCTM', 'Descent', 'FCTM Descent')],
    nonNormal: [S('QRH', 'Descent', 'QRH Descent')],
    weather:   [S('FCOM', 'Icing', 'FCOM Icing'), S('FCOM', 'Adverse Weather', 'FCOM SP.16')],
  },
  approach: {
    normal:    [S('FCOM', 'Amplified Procedures', 'FCOM Amplified Procedures'), S('FCTM', 'Instrument Approach', 'FCTM Instrument Approaches'), S('OMA', 'Minima', 'OMA Minima')],
    nonNormal: [S('QRH', 'Approach', 'QRH Approach'), S('QRH', 'Go-Around', 'QRH Go-Around')],
    weather:   [S('FCOM', 'Adverse Weather', 'FCOM SP.16 Adverse Weather'), S('OMA', 'Weather', 'OMA 8.3 Minima')],
  },
  landing: {
    normal:    [S('FCOM', 'Landing', 'FCOM Landing'), S('FCTM', 'Landing', 'FCTM Landing')],
    nonNormal: [S('QRH', 'Landing', 'QRH Landing'), S('QRH', 'Go-Around', 'QRH Go-Around')],
    weather:   [S('FCOM', 'Crosswind', 'FCOM Crosswind Landing'), S('FCTM', 'Crosswind Landing', 'FCTM Crosswind Landing')],
  },
  afterLanding: {
    normal:    [S('FCOM', 'After Landing', 'FCOM After Landing'), S('FCTM', 'Taxi', 'FCTM Taxi')],
    nonNormal: [S('QRH', 'Ground', 'QRH Ground')],
    weather:   [S('FCOM', 'Adverse Weather', 'FCOM SP.16')],
  },
};

export function phaseById(id) {
  return PHASES.find((p) => p.id === id) || PHASES[0];
}

export function sectionsFor(phaseId, toggleId) {
  const phase = PHASE_SECTIONS[phaseId];
  return (phase && phase[toggleId]) || [];
}

// Pure altitude->phase mapping for GPS auto-detect. `trend` is +1 climbing,
// -1 descending, 0 level. Without a barometric/FMC source this is a best
// effort — manual phase selection always overrides it.
export function phaseForAltitude(altFt, trend) {
  if (altFt == null || !Number.isFinite(altFt)) return null;
  if (altFt < 50) return trend > 0 ? 'takeoff' : 'afterLanding';
  if (trend >= 0) {
    if (altFt < 1500) return 'takeoff';
    if (altFt < 25000) return 'climb';
    return 'cruise';
  }
  // descending
  if (altFt > 3000) return 'descent';
  if (altFt > 1000) return 'approach';
  return 'landing';
}
