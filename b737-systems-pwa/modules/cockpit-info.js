// cockpit-info.js — "what does this do?" for anything you touch in the 3D
// cockpit. Switches on built systems point at the page (and flight-deck
// entry) that describes them; everything else gets a short note in our own
// words. Nothing here is copied from the FCOM.

// switch key → [part page, words that identify its flight-deck entry]
const KEYS = {
  hydraulics: {
    eng1: ['edp1', 'ENG 1'], eng2: ['edp2', 'ENG 2'], elec1: ['emdpB', 'ELEC 1'], elec2: ['emdpA', 'ELEC 2'],
    fcA: ['stby', 'FLT CONTROL'], fcB: ['stby', 'FLT CONTROL'], altFlaps: ['stby', 'ALTERNATE FLAPS'],
  },
  fuel: {
    m1aft: ['main1', 'FUEL PUMPS 1'], m1fwd: ['main1', 'FUEL PUMPS 1'], m2fwd: ['pumps2', ''], m2aft: ['pumps2', ''],
    ctrL: ['ctr', 'CTR'], ctrR: ['ctr', 'CTR'], xfeed: ['xfeed', 'CROSSFEED'],
  },
  electrical: {
    bat: ['bat', 'BAT'], stby: ['stbypwr', ''], busXfer: ['btb', 'BUS TRANSFER'], grd: ['gpu', 'GRD POWER'],
    gen1: ['idg1', 'GEN 1'], gen2: ['idg2', ''], apu1: ['apugen', ''], apu2: ['apugen', ''], disc1: ['idg1', 'DISCONNECT'], disc2: ['idg1', 'DISCONNECT'],
  },
  air: {
    bleed1: ['bleed1', 'BLEED 1'], bleed2: ['bleed2', ''], apuBleed: ['apubleed', 'APU BLEED'], iso: ['iso', 'ISOLATION'],
    packL: ['packL', 'L PACK'], packR: ['packR', ''], recircL: ['recirc', 'RECIRC'], recircR: ['recirc', 'RECIRC'],
    trim: ['trim', 'TRIM AIR'], mode: ['ofv', 'Pressurization mode'], ofvSw: ['ofv', 'OUTFLOW VALVE'],
    fltAltK: ['ofv', 'FLT ALT'], landAltK: ['ofv', 'FLT ALT'],
  },
};

const LATER = {
  engines: 'Engines and APU (chapter 7)', antiice: 'Anti-ice and rain (chapter 3)', general: 'Airplane general (chapter 1)',
  air: 'Air systems', comms: 'Communications (chapter 5)',
};

// Levers, screens and panels that aren't switches.
const NOTES = {
  'Landing gear lever': 'UP · OFF · DOWN. Raises and lowers the gear (system A, with B as the alternate source through the transfer valve). It follows the phase here.',
  'Thrust lever 1': 'Forward thrust for engine 1, with the reverse thrust lever on its front face. The autothrottle can drive both levers. It follows the phase here.',
  'Thrust lever 2': 'Forward thrust for engine 2, with the reverse thrust lever on its front face. It follows the phase here.',
  'Speed brake lever': 'DOWN · ARMED · FLIGHT DETENT · UP. In flight, not beyond the FLIGHT DETENT (FCOM L.10). Up on the landing rollout here.',
  'Flap lever': 'Detents UP, 1, 2, 5, 10, 15, 25, 30, 40 — selects trailing-edge flaps and the leading-edge devices. It follows the phase here.',
  'Start lever 1': 'IDLE · CUTOFF. CUTOFF closes engine 1\'s spar and engine fuel valves (see Fuel).',
  'Start lever 2': 'IDLE · CUTOFF. CUTOFF closes engine 2\'s spar and engine fuel valves (see Fuel).',
  'Stabilizer trim wheel': 'Turns with the stabiliser trim; can be used to trim manually.',
  'Control column and wheel': 'Pitch and roll. Either A or B hydraulics can power the surfaces (see Hydraulics).',
  'Captain PFD': 'Primary flight display: attitude, speed and altitude tapes, heading, and the flight mode annunciations along the top.',
  'First officer PFD': 'Primary flight display for the first officer.',
  'Captain ND': 'Navigation display, MAP mode: heading arc, route and waypoints, ground speed and true airspeed.',
  'First officer ND': 'Navigation display for the first officer.',
  'Upper DU — engines and fuel': 'Primary engine indications (N1, EGT) and fuel quantity with LOW / CONFIG / IMBAL alerts — fed by the Fuel system here.',
  'Lower DU — engines and hydraulics': 'Secondary engine indications (N2, fuel flow, oil, vibration) and the hydraulic system page — fed by the Hydraulics system here.',
  'Integrated standby flight display (ISFD)': 'Standby attitude, airspeed and altitude, powered from the standby system.',
  'Mode control panel (MCP)': 'Autopilot and autothrottle modes and targets: course, speed, heading, altitude, vertical speed. Automatic Flight is a later chapter in this app.',
  'Aft electronic panel': 'Radios, transponder and the engine / APU fire switches. Communications and Fire Protection are later chapters in this app.',
};

export function explain(systems, ev) {
  if (ev.name && NOTES[ev.name]) return { title: ev.name, text: NOTES[ev.name] };
  if (ev.name) return { title: ev.name, text: 'Part of the flight deck structure.' };
  const sysMod = systems.find((s) => s.id === ev.sys)?.mod;
  const c = ev.control;
  if (!c) return { title: ev.panel, text: sysMod ? `${sysMod.title} panel. Tap a switch, knob or light.` : 'Tap a switch, knob or light.' };
  const title = `${ev.panel} · ${c.name}`;
  const how = ev.result === 'guard-open' ? 'Guard lifted — tap the switch to move it; tap the lifted guard to close it (that returns the switch to normal).'
    : ev.result === 'guard-closed' ? 'Guard closed — the switch is back in its guarded position.' : '';
  if (!sysMod) {
    const later = LATER[c.about] || 'a later chapter';
    return { title, pos: ev.pos, text: `${how ? how + ' ' : ''}Not simulated yet — this switch moves, but its system comes with ${later}.` };
  }
  // Find the page and its flight-deck entry for this control.
  let partId = null, words = '';
  if (c.kind === 'lamp') {
    const leg = c.name.toUpperCase();
    for (const p of sysMod.parts) {
      const hit = (p.deck || []).find(([n]) => n.toUpperCase().includes(leg));
      if (hit) { partId = p.id; words = hit[0]; break; }
    }
  } else if (KEYS[ev.sys]?.[c.key]) [partId, words] = KEYS[ev.sys][c.key];
  const part = partId && sysMod.parts.find((p) => p.id === partId);
  const entry = part && words ? (part.deck || []).find(([n]) => n.toUpperCase().includes(words.toUpperCase())) : null;
  const text = [how, entry ? entry[1] : part?.lead || sysMod.overview.lead].filter(Boolean).join(' ').replace(/\*\*/g, '');
  return { title, pos: ev.pos, text, page: part ? `${ev.sys}/${part.id}` : ev.sys, pageTitle: part?.name || sysMod.title };
}
