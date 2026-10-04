// world.js — the shared environment every system evaluates against. The
// phase sets the scene; then the real models take over: engines say what is
// running, electrical what is powered, hydraulics what is pressurised, flight
// controls where the flaps are, the gear where the gear is. Every model is
// always consulted (its state created at its normal setting if nobody has
// opened that system yet) so no system ever assumes power or pressure.
//
// Used by app.js and by the logic audit harness (scratchpad) alike.

export function makeEnv({ PHASES, phase, stateOf, sysOf, flight }) {
  const e = { ...PHASES[phase].env, phase };
  // The flight sim (FMC route flying) says where the airplane really is.
  if (flight) { e.air = !flight.onGround; e.alt = flight.alt; e.wheel = flight.onGround ? Math.round(flight.ias) : 0; e.sim = true; }
  const ev = (id) => sysOf(id).mod.evaluate(e, stateOf(id));
  // Fire switches pulled cut the fuel (engines) or shut the APU down.
  const fire = stateOf('fire');
  e.cut1 = !!fire.sw.pull1; e.cut2 = !!fire.sw.pull2; e.cutApu = !!fire.sw.pullApu;
  // What is actually running.
  const eng = stateOf('engines');
  e.eng1 = eng.mem.e[0].run; e.eng2 = eng.mem.e[1].run;
  e.apu = eng.mem.apu.st === 'running';
  e.lever1 = !!eng.sw.lever1; e.lever2 = !!eng.sw.lever2;
  // Ground connections (Airplane General): external power and air carts.
  const gen = stateOf('general');
  e.gpu = !e.air && !!gen.sw.gpuCart;
  e.extAir = !e.air && !!gen.sw.acCart;
  // What is powered.
  const el = ev('electrical');
  e.bus = el.buses;
  e.acPower = !!(el.buses.xfr1 || el.buses.xfr2);
  // Flaps, stabiliser trim cutout.
  const fc = stateOf('flightcontrols');
  e.flaps = Math.round(fc.mem.flap); e.stabApCut = fc.sw.stabAp === 1;
  // Gear position and lever.
  const gr = stateOf('gear');
  e.gearDown = gr.mem.pos > 0.999; e.gearLever = gr.sw.lever;
  // Bleed duct and cabin.
  const av = ev('air').values;
  e.ductL = av.ductL; e.ductR = av.ductR; e.cab = +av.cab;
  // Hydraulic pressure for the users.
  const hy = stateOf('hydraulics');
  const h = ev('hydraulics');
  Object.assign(e, {
    hydA: h.users.A, hydB: h.users.B, leB: h.users.Ble, hydAfc: h.users.Afc, hydBfc: h.users.Bfc,
    stbyRud: h.users.Srud, stbyLe: h.users.Sle, altFlapsArmed: !!hy.sw.altFlaps, fcBOff: hy.sw.fcB !== 2,
  });
  return e;
}
