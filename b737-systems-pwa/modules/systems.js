// systems.js — the FCOM Systems Description chapters, in FCOM order. Systems
// with `mod` are built; the rest are listed so the map of the airplane is
// complete and show as "soon".

import hydraulics from './sys-hydraulics.js?v=3';
import * as schemHydraulics from './schem-hydraulics.js?v=3';
import fuel from './sys-fuel.js?v=3';
import * as schemFuel from './schem-fuel.js?v=3';
import electrical from './sys-electrical.js?v=3';
import * as schemElectrical from './schem-electrical.js?v=3';
import air from './sys-air.js?v=3';
import * as schemAir from './schem-air.js?v=3';

export const SYSTEMS = [
  { id: 'general', num: 1, title: 'Airplane General', color: '#6b7280' },
  { id: 'air', num: 2, title: 'Air Systems', color: '#ff6a3d', mod: air, schem: schemAir },
  { id: 'antiice', num: 3, title: 'Anti-Ice, Rain', color: '#4cc9f0' },
  { id: 'autoflight', num: 4, title: 'Automatic Flight', color: '#9b5de5' },
  { id: 'comms', num: 5, title: 'Communications', color: '#00a6a6' },
  { id: 'electrical', num: 6, title: 'Electrical', color: '#f5a300', mod: electrical, schem: schemElectrical },
  { id: 'engines', num: 7, title: 'Engines, APU', color: '#e63946' },
  { id: 'fire', num: 8, title: 'Fire Protection', color: '#d62828' },
  { id: 'flightcontrols', num: 9, title: 'Flight Controls', color: '#3a86ff' },
  { id: 'instruments', num: 10, title: 'Flight Instruments', color: '#8338ec' },
  { id: 'fms', num: 11, title: 'FMS, Navigation', color: '#06d6a0' },
  { id: 'fuel', num: 12, title: 'Fuel', color: '#d6336c', mod: fuel, schem: schemFuel },
  { id: 'hydraulics', num: 13, title: 'Hydraulics', color: '#2f7cf6', mod: hydraulics, schem: schemHydraulics },
  { id: 'gear', num: 14, title: 'Landing Gear', color: '#495057' },
  { id: 'warnings', num: 15, title: 'Warning Systems', color: '#e85d04' },
].map((s) => ({ ...s, ready: !!s.mod, ...(s.mod ? { color: s.mod.color } : {}) }));

export const READY = SYSTEMS.filter((s) => s.ready);
