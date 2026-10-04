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
  engines: {
    start1: ['start', 'ENGINE START'], start2: ['start', 'ENGINE START'], ign: ['ign', 'Ignition select'],
    apu: ['apu', 'APU switch'], eec1: ['eec', 'EEC switches'], eec2: ['eec', 'EEC switches'],
    lever1: ['start', ''], lever2: ['start', ''],
  },
  fire: {
    ovht1: ['loops1', 'OVHT DET'], ovht2: ['loops1', 'OVHT DET'], pull1: ['fsw', 'Engine fire switch'], pull2: ['fsw', 'Engine fire switch'],
    pullApu: ['apufire', 'APU fire switch'], rot1: ['fsw', 'Engine fire switch'], rot2: ['fsw', 'Engine fire switch'], rotApu: ['apufire', 'APU fire switch'],
    test: ['test', ''], ext: ['test', ''], armFwd: ['cargo', 'ARMED'], armAft: ['cargo', 'ARMED'],
  },
  flightcontrols: {
    flap: ['flaps', 'FLAP lever'], sb: ['sb', 'SPEED BRAKE lever'], yd: ['rud', 'YAW DAMPER'], spA: ['ail', 'SPOILER'], spB: ['ail', 'SPOILER'],
    altPos: ['flaps', 'FLAP lever'], stabMain: ['stab', 'STAB TRIM MAIN'], stabAp: ['stab', 'STAB TRIM MAIN'],
  },
  antiice: {
    wh1: ['windows', 'WINDOW HEAT'], wh2: ['windows', 'WINDOW HEAT'], wh3: ['windows', 'WINDOW HEAT'], wh4: ['windows', 'WINDOW HEAT'],
    test: ['windows', 'Test'], probeA: ['probes', 'PROBE HEAT'], probeB: ['probes', 'PROBE HEAT'], wing: ['wingai', 'WING ANTI-ICE'],
    eng1: ['cowl', 'ENG ANTI-ICE'], eng2: ['cowl', 'ENG ANTI-ICE'], wiperL: ['wipers', 'WIPER'], wiperR: ['wipers', 'WIPER'],
  },
  warnings: {
    flapInh: ['gpws', 'FLAP / GEAR / TERR'], gearInh: ['gpws', 'FLAP / GEAR / TERR'], terrInh: ['gpws', 'FLAP / GEAR / TERR'],
    xpdr: ['tcas', 'Transponder mode'], range: ['tcas', 'Altitude range'],
  },
  autoflight: {
    fdL: ['mcp', 'F/D'], fdR: ['mcp', 'F/D'], atArm: ['mcp', 'A/T ARM'], dis: ['mcp', 'DISENGAGE bar'], bank: ['mcp', ''],
    spd: ['mcp', ''], hdg: ['mcp', 'HDG SEL'], alt: ['mcp', 'ALT HLD'], vs: ['mcp', 'V/S'],
  },
  instruments: {
    source: ['deu', 'DISPLAYS SOURCE'], cp: ['deu', 'CONTROL PANEL'], capMain: ['dus', 'MAIN PANEL'], foMain: ['dus', 'MAIN PANEL'],
    capLower: ['dus', 'LOWER DU'], foLower: ['dus', 'LOWER DU'],
  },
  fms: {
    irsL: ['irs', 'IRS mode selector'], irsR: ['irs', 'IRS mode selector'], irsX: ['irs', 'IRS transfer'],
    vhfX: ['radios', 'VHF NAV transfer'], fmcX: ['fmc', 'FMC source'],
  },
  comms: {
    alt: ['acp', 'ALT – NORM'], mask: ['acp', 'MASK – BOOM'], cvr: ['cvr', 'VOICE RECORDER'], svcInt: ['interphone', 'SERVICE INTERPHONE'], stbyTune: ['vhf', 'Radio tuning'],
  },
  general: {
    llL: ['lights', 'LANDING'], llR: ['lights', 'LANDING'], rtoL: ['lights', 'RUNWAY TURNOFF'], rtoR: ['lights', 'RUNWAY TURNOFF'], taxi: ['lights', 'TAXI'],
    logo: ['lights', 'LOGO'], pos: ['lights', 'POSITION'], beacon: ['lights', 'ANTI COLLISION'], wingLt: ['lights', 'WING'], wwLt: ['lights', 'WHEEL WELL'],
    exitLt: ['emergency', 'EMER EXIT LIGHTS'], smoke: ['signs', 'NO SMOKING'], belts: ['signs', 'FASTEN BELTS'], passOxy: ['oxygen', 'PASS OXY ('],
    fdDoor: ['fddoor', 'FLT DK DOOR'], coolSup: ['signs', ''], coolExh: ['signs', ''],
  },
  gear: {
    lever: ['lever', 'LANDING GEAR lever'], ab: ['autobrake', 'AUTO BRAKE ('], park: ['park', 'PARKING BRAKE'], nws: ['nlg', 'NOSE WHEEL'],
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
  'Landing gear lever': 'UP · OFF · DOWN — tap to move it (the lever lock stops UP on the ground). Raises and lowers the gear on system A, with B through the transfer valve.',
  'Thrust lever 1': 'Forward thrust for engine 1, with the reverse thrust lever on its front face. The autothrottle can drive both levers. It follows the phase here.',
  'Thrust lever 2': 'Forward thrust for engine 2, with the reverse thrust lever on its front face. It follows the phase here.',
  'Speed brake lever': 'DOWN · ARMED · FLIGHT DETENT · UP — tap to move it. In flight, not beyond the FLIGHT DETENT (FCOM L.10); never below 1,000 ft RA in flight.',
  'Flap lever': 'Detents UP, 1, 2, 5, 10, 15, 25, 30, 40 — tap to select the next one; the flaps run on system B and the LE devices follow.',
  'Start lever 1': 'IDLE · CUTOFF — tap to move it. IDLE opens the spar and engine fuel valves (fuel and ignition once the starter has the engine turning, ~25 % N2); CUTOFF closes them and shuts the engine down.',
  'Start lever 2': 'IDLE · CUTOFF — tap to move it. Same as lever 1, for engine 2.',
  'Stabilizer trim wheel': 'Turns with the stabiliser trim; can be used to trim manually.',
  'Control column and wheel': 'Pitch and roll. Either A or B hydraulics can power the surfaces (see Hydraulics).',
  'Captain PFD': 'Primary flight display: attitude, speed and altitude tapes, heading, and the flight mode annunciations along the top.',
  'First officer PFD': 'Primary flight display for the first officer.',
  'Captain ND': 'Navigation display, MAP mode: heading arc, route and waypoints, ground speed and true airspeed.',
  'First officer ND': 'Navigation display for the first officer.',
  'Upper DU — engines and fuel': 'Primary engine indications (N1, EGT) and fuel quantity with LOW / CONFIG / IMBAL alerts — fed by the Fuel system here.',
  'Lower DU — engines and hydraulics': 'Secondary engine indications (N2, fuel flow, oil, vibration) and the hydraulic system page — fed by the Hydraulics system here.',
  'Integrated standby flight display (ISFD)': 'Standby attitude, airspeed and altitude, powered from the standby system.',
  'Mode control panel (MCP)': 'Autopilot and autothrottle modes and targets: course, speed, heading, altitude, vertical speed.',
  'Aft electronic panel': 'Radios, transponder and the engine / APU fire switches.',
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
  if (c.kind === 'lamp' || !c.key) {
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
