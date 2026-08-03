// events.js — "what's happening in the sky soon": the next real Full Moon,
// the next eclipse actually visible from here, or the next time two bright
// worlds pass close together. Every date comes from a real search in the
// vendored astronomy-engine (astro.js) — nothing here is fabricated.

import { nextFullMoon, nextLunarEclipse, nextSolarEclipse, nextConjunction } from './astro.js';

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const BODY_LABEL = { Moon: 'the Moon', Mercury: 'Mercury', Venus: 'Venus', Mars: 'Mars', Jupiter: 'Jupiter', Saturn: 'Saturn' };

function fmtDate(d) {
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
}

function daysUntil(d, from) {
  return Math.round((d - from) / 86400000);
}

/** The soonest interesting real event in the next ~45 days — full moon,
 * a visible eclipse, or a close pairing of two bright worlds — as one short
 * spoken-friendly line. Returns null if nothing qualifies. */
export function nextEventHeadline(now, lat, lon) {
  const candidates = [];

  try {
    const fullMoon = nextFullMoon(now);
    candidates.push({ date: fullMoon, text: `Full Moon on ${fmtDate(fullMoon)}!` });
  } catch {}

  try {
    const lunar = nextLunarEclipse(now, lat, lon);
    if (lunar.visible) candidates.push({ date: lunar.date, text: `A Moon eclipse on ${fmtDate(lunar.date)}!` });
  } catch {}

  try {
    const solar = nextSolarEclipse(now, lat, lon);
    if (solar.visible) candidates.push({ date: solar.date, text: `A Sun eclipse on ${fmtDate(solar.date)}!` });
  } catch {}

  try {
    const conj = nextConjunction(now, lat, lon);
    if (conj) {
      const a = BODY_LABEL[conj.a] || conj.a, b = BODY_LABEL[conj.b] || conj.b;
      candidates.push({ date: conj.date, text: `${a} and ${b} will be close together on ${fmtDate(conj.date)}!` });
    }
  } catch {}

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.date - b.date);
  const soonest = candidates[0];
  if (daysUntil(soonest.date, now) <= 0) return soonest.text.replace(` on ${fmtDate(soonest.date)}`, ' tonight');
  return soonest.text;
}
