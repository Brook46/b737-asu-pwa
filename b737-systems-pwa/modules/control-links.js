// control-links.js — where a QRH step or limit lives in the airplane, and what
// a control does when you operate it. Links are [system id, control key] pairs
// (keys as in cockpit-info.js KEYS); a null key links the system only.
// Effects are our own words, cited to the FCOM system chapter.

export const MEMORY_LINKS = {
  'Aborted Engine Start': { 1: [['engines', 'lever1']] },
  'Airspeed Unreliable': { 1: [['autoflight', 'dis']], 2: [['autoflight', 'atArm']], 3: [['autoflight', 'fdL'], ['autoflight', 'fdR']], 4: [['autoflight', null]], 5: [['antiice', 'probeA'], ['antiice', 'probeB']] },
  'APU FIRE': { 1: [['fire', 'pullApu']], 2: [['engines', 'apu']] },
  'CABIN ALTITUDE WARNING or Rapid Depressurization': { 1: [['general', null]], 3: [['air', 'mode']], 4: [['air', 'ofvSw']], 5: [['general', 'passOxy']] },
  'Emergency Descent': { 2: [['general', 'belts']], 4: [['engines', 'start1'], ['engines', 'start2']], 5: [['engines', 'lever1'], ['engines', 'lever2']], 6: [['flightcontrols', 'sb']] },
  'CARGO FIRE (MAIN)': { 3: [['general', 'fdDoor']], 4: [['comms', 'alt']] },
  'ENGINE FIRE or Engine Severe Damage or Separation': { 1: [['autoflight', 'atArm']], 2: [['engines', 'lever1']], 3: [['engines', 'lever1']], 4: [['fire', 'pull1']], 5: [['fire', 'rot1']] },
  'Engine Limit or Surge or Stall': { 1: [['autoflight', 'atArm']], 2: [['engines', 'lever1']] },
  'ENGINE OVERHEAT': { 1: [['autoflight', 'atArm']], 2: [['engines', 'lever1']], 3: [['fire', 'ovht1']] },
  'Loss Of Thrust On Both Engines': { 1: [['engines', 'start1'], ['engines', 'start2']], 2: [['engines', 'lever1'], ['engines', 'lever2']], 3: [['engines', 'lever1']], 4: [['engines', 'lever1']] },
  'Runaway Stabilizer': { 2: [['autoflight', 'dis']], 3: [['autoflight', 'atArm']], 5: [['flightcontrols', 'stabMain']], 7: [['flightcontrols', 'stabMain'], ['flightcontrols', 'stabAp']] },
  'LANDING CONFIGURATION': { 1: [['gear', 'lever'], ['flightcontrols', 'flap']] },
  'TAKEOFF CONFIGURATION': { 1: [['flightcontrols', 'flap'], ['flightcontrols', 'sb']] },
  'WARNING HORN (INTERMITTENT) or WARNING LIGHT - CABIN ALTITUDE OR TAKEOFF CONFIGURATION': { 2: [['flightcontrols', 'flap'], ['flightcontrols', 'sb']] },
};

export const NUMBER_LINKS = {
  'Aborted start': [['engines', 'start1']],
  'Airspeed unreliable, gear up': [['autoflight', 'fdL']],
  'Dual engine failure airspeed': [['engines', 'lever1']],
  'Fire switch rotate': [['fire', 'rot1']],
  'Single-channel A/P on approach': [['autoflight', 'dis']],
  'Autoland flaps': [['flightcontrols', 'flap']],
  'APU bleed + electrics (in flight)': [['air', 'apuBleed']],
  'APU bleed + electrics (ground only)': [['air', 'apuBleed']],
  'APU bleed': [['air', 'apuBleed']],
};

// What the control does in the airplane (own words, FCOM chapter cited).
export const EFFECTS = {
  fire: {
    pull1: { name: 'Engine 1 fire switch — pulled', ref: 'FCOM 8.20.2', does: [
      'Closes the engine 1 fuel shutoff valve and the spar fuel shutoff valve.',
      'Closes the engine 1 bleed air valve: wing anti-ice on that wing is lost and that pack valve closes.',
      'Trips the engine 1 generator (generator control relay and breaker).',
      'Closes the engine 1 hydraulic shutoff: the engine-driven pump LOW PRESSURE light goes out.',
      'Disables the engine 1 thrust reverser.',
      'Unlocks the switch, so it can be rotated to discharge a bottle, and arms one discharge squib on each bottle.']},
    rot1: { name: 'Engine 1 fire switch — rotated', ref: 'FCOM 8.20.2', does: [
      'Discharges the selected bottle (left or right) into engine 1, once.',
      'The BOTTLE DISCHARGED light comes on after the bottle has emptied.']},
    pullApu: { name: 'APU fire switch — pulled', ref: 'FCOM 8.20.4', does: [
      'Closes the APU fuel shutoff valve, which shuts the APU down.',
      'Arms the APU extinguisher bottle squib.']},
    rotApu: { name: 'APU fire switch — rotated', ref: 'FCOM 8.20.4', does: [
      'Discharges the APU extinguisher bottle into the APU compartment.']},
    ovht1: { name: 'Engine 1 overheat detection', ref: 'FCOM 8.20.2', does: [
      'A loop overheat lights ENG 1 OVERHEAT (amber) and unlocks the engine 1 fire switch.']},
    armFwd: { name: 'Forward cargo fire ARMED', ref: 'FCOM 8.20.7', does: [
      'Arms the forward cargo fire extinguisher, so the DISCH switch can release the first bottle.']},
  },
  engines: {
    start1: { name: 'Engine 1 start switch', ref: 'FCOM ch. 7', does: [
      'GRD: motors the engine on the ground with the start lever at IDLE.',
      'AUTO: the start is automatic when the start lever goes to IDLE.',
      'CONT: ignition stays on continuously.',
      'FLT: flight start — ignition on for a relight in flight.']},
    lever1: { name: 'Engine 1 start lever', ref: 'FCOM ch. 7', does: [
      'IDLE: opens the spar and engine fuel valves; fuel and ignition follow once the starter has the engine turning.',
      'CUTOFF: closes the fuel valves and shuts the engine down.']},
    apu: { name: 'APU switch', ref: 'FCOM ch. 7', does: [
      'ON: starts the APU (starter, fuel, ignition).',
      'OFF: shuts the APU down; the APU fire switch is separate.']},
  },
  autoflight: {
    dis: { name: 'Autopilot disconnect', ref: 'FCOM 4.10', does: [
      'Disconnects the autopilots: the red A/P light flashes and a tone sounds.',
      'A second push silences and resets it.']},
    atArm: { name: 'A/T ARM', ref: 'FCOM 4.20', does: [
      'ARM: the autothrottle can drive the thrust levers in the modes you select.',
      'OFF: the autothrottle is not available; the A/T light flashes if it was driving.']},
    fdL: { name: 'Captain flight director', ref: 'FCOM 4.10', does: [
      'ON: the captain\'s flight director bars come on and guide roll and pitch.',
      'OFF: the bars go away.']},
    fdR: { name: 'First officer flight director', ref: 'FCOM 4.10', does: [
      'ON: the first officer\'s flight director bars come on.',
      'OFF: the bars go away.']},
  },
  air: {
    mode: { name: 'Pressurization mode selector', ref: 'FCOM ch. 2', does: [
      'AUTO: the controller sets the outflow valve for the cabin altitude.',
      'MAN: the outflow valve is driven by the OUTFLOW VALVE switch.']},
    ofvSw: { name: 'OUTFLOW VALVE switch', ref: 'FCOM ch. 2', does: [
      'Only in MAN: holds the outflow valve open or closed; hold until the indication shows fully open or closed.']},
    apuBleed: { name: 'APU bleed switch', ref: 'FCOM ch. 2', does: [
      'Opens the APU bleed valve, supplying bleed air from the APU to the pneumatic system (altitude limits apply).']},
    packL: { name: 'L PACK switch', ref: 'FCOM ch. 2', does: [
      'AUTO: the left pack runs and regulates. OFF: the pack valve closes and the left pack stops.']},
  },
  general: {
    passOxy: { name: 'PASS OXYGEN switch', ref: 'FCOM ch. 1', does: [
      'ON: drops the passenger oxygen masks in the cabin.']},
    belts: { name: 'FASTEN BELTS switch', ref: 'FCOM ch. 1', does: [
      'AUTO: the sign comes on with flaps or gear out. ON: the sign is on regardless.']},
    fdDoor: { name: 'Flight deck door lock', ref: 'FCOM ch. 1', does: [
      'Locks or unlocks the flight deck door (UNLKD · AUTO · DENY).']},
    exitLt: { name: 'EMER EXIT LIGHTS switch', ref: 'FCOM ch. 1', does: [
      'ARMED: the emergency lights come on by themselves if DC power is lost.',
      'OFF: they will not come on, NOT ARMED and MASTER CAUTION show.']},
  },
  gear: {
    lever: { name: 'Landing gear lever', ref: 'FCOM ch. 14', does: [
      'UP: retracts the gear (the lever lock stops UP on the ground).',
      'DN: extends the gear.']},
  },
  flightcontrols: {
    flap: { name: 'Flap lever', ref: 'FCOM ch. 9', does: [
      'Moves the flaps (system B) to the selected detent; the leading edge devices follow.']},
    sb: { name: 'Speed brake lever', ref: 'FCOM ch. 9', does: [
      'ARMED: arms automatic extension on landing. FLT DET: the flight detent. UP: retracts.']},
    stabMain: { name: 'STAB TRIM main electric cutout', ref: 'FCOM ch. 9', does: [
      'CUT OUT: removes power from the main electric stabilizer trim switches.']},
    stabAp: { name: 'STAB TRIM autopilot cutout', ref: 'FCOM ch. 9', does: [
      'CUT OUT: removes the autopilot stabilizer trim.']},
  },
  antiice: {
    probeA: { name: 'PROBE HEAT switch (system A)', ref: 'FCOM ch. 3', does: [
      'ON: heats the captain\'s pitot and alpha probes; the probe heat light goes out when they are warm.']},
    probeB: { name: 'PROBE HEAT switch (system B)', ref: 'FCOM ch. 3', does: [
      'ON: heats the first officer\'s pitot and alpha probes.']},
  },
};

// Engine 2 and the second fire switch work as engine 1 does: same text, other side.
const twin = (e, from, to) => ({ ...e, name: e.name.replace(from, to), does: e.does.map((d) => d.replace(from.toLowerCase(), to.toLowerCase())) });
EFFECTS.fire.pull2 = twin(EFFECTS.fire.pull1, 'Engine 1', 'Engine 2');
EFFECTS.fire.rot2 = twin(EFFECTS.fire.rot1, 'Engine 1', 'Engine 2');
EFFECTS.fire.ovht2 = twin(EFFECTS.fire.ovht1, 'Engine 1', 'Engine 2');
EFFECTS.engines.start2 = twin(EFFECTS.engines.start1, 'Engine 1', 'Engine 2');
EFFECTS.engines.lever2 = twin(EFFECTS.engines.lever1, 'Engine 1', 'Engine 2');

/** The effects of one control: { name, ref, does[] } or null if not written yet. */
export function effectsOf(sys, key) {
  return EFFECTS[sys]?.[key] || null;
}
