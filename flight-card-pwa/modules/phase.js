// phase.js — which part of the flight the Flight screen should show.
//
// GPS knows best: a logged take-off or landing settles it. Without GPS (it
// only runs while the app is open) the clock decides, with any CTOT delay
// added on, so a held aircraft isn't called airborne. It can only guess, which
// is why the screen's switch overrides it for the leg.
import { legTs, nearestHm } from './dates.js?v=198';

const TAXI_MS = 25 * 60000;     // STD → airborne, near enough
const ARRIVE_MS = 20 * 60000;   // STA → the flight's paperwork
const SLOT_MS = 15 * 60000;     // CTOT is normally this long after off-block

export function autoPhase(leg, data, now = Date.now()) {
  const d = data || {};
  if (d.landing_at || d.on_block || d.actual_block_time) return 'after';
  if (d.takeoff_at) return 'air';
  if (!leg) return 'before';
  const std = legTs(leg.dep_date, leg.dep_time, leg.dep_year, now);
  if (!Number.isFinite(std)) return 'before';
  const ctot = nearestHm(d.ctot || leg.ctot, std);
  const late = Number.isFinite(ctot) ? Math.max(0, ctot - std - SLOT_MS) : 0;
  const sta = legTs(leg.arr_date, leg.arr_time, leg.arr_year || leg.dep_year, now);
  if (Number.isFinite(sta) && now >= sta + late + ARRIVE_MS) return 'after';
  return now >= std + late + TAXI_MS ? 'air' : 'before';
}
