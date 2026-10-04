// systems.js — the FCOM Systems Description chapters, in FCOM order. Systems
// with `mod` are built; the rest are listed so the map of the airplane is
// complete and show as "soon".

import hydraulics from './sys-hydraulics.js?v=13';
import * as schemHydraulics from './schem-hydraulics.js?v=13';
import fuel from './sys-fuel.js?v=13';
import * as schemFuel from './schem-fuel.js?v=13';
import electrical from './sys-electrical.js?v=13';
import * as schemElectrical from './schem-electrical.js?v=13';
import air from './sys-air.js?v=13';
import * as schemAir from './schem-air.js?v=13';
import engines from './sys-engines.js?v=13';
import * as schemEngines from './schem-engines.js?v=13';
import fire from './sys-fire.js?v=13';
import * as schemFire from './schem-fire.js?v=13';
import flightcontrols from './sys-flightcontrols.js?v=13';
import * as schemFlightcontrols from './schem-flightcontrols.js?v=13';
import gear from './sys-gear.js?v=13';
import antiice from './sys-antiice.js?v=13';
import warnings from './sys-warnings.js?v=13';
import autoflight from './sys-autoflight.js?v=13';
import instruments from './sys-instruments.js?v=13';
import fms from './sys-fms.js?v=13';
import comms from './sys-comms.js?v=13';
import general from './sys-general.js?v=13';
import * as schemGeneral from './schem-general.js?v=13';
import * as schemComms from './schem-comms.js?v=13';
import * as schemFms from './schem-fms.js?v=13';
import * as schemInstruments from './schem-instruments.js?v=13';
import * as schemAutoflight from './schem-autoflight.js?v=13';
import * as schemWarnings from './schem-warnings.js?v=13';
import * as schemAntiice from './schem-antiice.js?v=13';
import * as schemGear from './schem-gear.js?v=13';

export const SYSTEMS = [
  { id: 'general', num: 1, title: 'Airplane General', color: '#6b7280', mod: general, schem: schemGeneral },
  { id: 'air', num: 2, title: 'Air Systems', color: '#ff6a3d', mod: air, schem: schemAir },
  { id: 'antiice', num: 3, title: 'Anti-Ice, Rain', color: '#4cc9f0', mod: antiice, schem: schemAntiice },
  { id: 'autoflight', num: 4, title: 'Automatic Flight', color: '#9b5de5', mod: autoflight, schem: schemAutoflight },
  { id: 'comms', num: 5, title: 'Communications', color: '#00a6a6', mod: comms, schem: schemComms },
  { id: 'electrical', num: 6, title: 'Electrical', color: '#f5a300', mod: electrical, schem: schemElectrical },
  { id: 'engines', num: 7, title: 'Engines, APU', color: '#e63946', mod: engines, schem: schemEngines },
  { id: 'fire', num: 8, title: 'Fire Protection', color: '#d62828', mod: fire, schem: schemFire },
  { id: 'flightcontrols', num: 9, title: 'Flight Controls', color: '#3a86ff', mod: flightcontrols, schem: schemFlightcontrols },
  { id: 'instruments', num: 10, title: 'Flight Instruments', color: '#8338ec', mod: instruments, schem: schemInstruments },
  { id: 'fms', num: 11, title: 'FMS, Navigation', color: '#06d6a0', mod: fms, schem: schemFms },
  { id: 'fuel', num: 12, title: 'Fuel', color: '#d6336c', mod: fuel, schem: schemFuel },
  { id: 'hydraulics', num: 13, title: 'Hydraulics', color: '#2f7cf6', mod: hydraulics, schem: schemHydraulics },
  { id: 'gear', num: 14, title: 'Landing Gear', color: '#495057', mod: gear, schem: schemGear },
  { id: 'warnings', num: 15, title: 'Warning Systems', color: '#e85d04', mod: warnings, schem: schemWarnings },
].map((s) => ({ ...s, ready: !!s.mod, ...(s.mod ? { color: s.mod.color } : {}) }));

export const READY = SYSTEMS.filter((s) => s.ready);
