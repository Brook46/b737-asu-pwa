// report.js — "Report an issue": one file with what the screen was built
// from (version, the flight, its reports, NOTAMs and route as fetched, the
// last errors), handed to the share sheet so the pilot sends it to himself —
// Mail or Notes — and the exact data comes with the report. Nothing is sent
// anywhere by the app.

import * as storage from './storage.js?v=309';

// The last errors, caught from the start (app.js calls watch()).
const errors = [];
export function watch() {
  const keep = (kind, msg) => { errors.push({ at: new Date().toISOString(), kind, msg: String(msg).slice(0, 400) }); if (errors.length > 30) errors.shift(); };
  window.addEventListener('error', (e) => keep('error', `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
  window.addEventListener('unhandledrejection', (e) => keep('rejection', e.reason && (e.reason.stack || e.reason.message) || e.reason));
}

function version() {
  const s = document.querySelector('script[src*="app.js"]');
  const m = s && /[?&]v=(\d+)/.exec(s.getAttribute('src'));
  return (location.pathname.includes('beta') ? 'beta ' : '') + (m ? 'v' + m[1] : '?');
}

export async function build(note = '') {
  const legs = storage.getLegs(), i = storage.getLegIndex(), leg = legs[i] || null;
  let route = null;
  try {
    const ru = await import('./route-ui.js?v=309');
    route = await ru.reportData(leg);
  } catch (e) { route = { error: String(e.message || e) }; }
  const wx = {};
  try {
    const w = await import('./wx.js?v=309');
    for (const code of [leg?.dep, leg?.arr]) if (code) { const e = w.peekCachedWx(code); if (e) wx[code] = { metar: e.metar, taf: e.taf, atis: e.datis, stale: !!e.stale }; }
  } catch {}
  const r = {
    app: 'flightcard-report', version: version(), at: new Date().toISOString(), note,
    device: { ua: navigator.userAgent, screen: `${screen.width}x${screen.height}`, view: `${innerWidth}x${innerHeight}`, online: navigator.onLine,
      standalone: !!(navigator.standalone || matchMedia('(display-mode: standalone)').matches) },
    screen: { tab: document.body.dataset.phase || '', open: [...document.querySelectorAll('.overlay:not(.hidden)')].map(o => o.id) },
    leg: leg ? { index: i, of: legs.length, ...leg } : null,
    brief: wx,
    route,
    errors: errors.slice(),
  };
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const name = `flightcard-report-${stamp}.json`;
  const summary = [
    `Flight Card ${r.version} — issue report`,
    note ? `What's wrong: ${note}` : '',
    leg ? `Flight: ${leg.flight || ''} ${leg.dep || ''}→${leg.arr || ''} ${leg.dep_date || ''}.${leg.dep_year || ''}` : 'No flight selected',
    `Screen: ${r.screen.tab}${r.screen.open.length ? ' · ' + r.screen.open.join(', ') : ''}`,
    errors.length ? `Last error: ${errors[errors.length - 1].msg}` : 'No errors caught',
  ].filter(Boolean).join('\n');
  return { name, json: JSON.stringify(r, null, 2), summary };
}

export async function share(note) {
  const { name, json, summary } = await build(note);
  const file = new File([json], name, { type: 'application/json' });
  if (navigator.canShare?.({ files: [file] })) {
    await navigator.share({ files: [file], title: 'Flight Card issue', text: summary });
    return 'shared';
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return 'saved';
}
