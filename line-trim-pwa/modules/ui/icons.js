// ui/icons.js — a small inline-SVG icon set (stroke icons, currentColor).

const svg = (body, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icon = {
  logo: `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="9" fill="var(--brand)"/><path d="M5 11.5Q16 5 27 11.5" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/><g stroke="#fff" stroke-width="1.5" stroke-linecap="round" opacity=".9"><path d="M8 12.6 16 25"/><path d="M12 10.2 16 25"/><path d="M20 10.2 16 25"/><path d="M24 12.6 16 25"/></g><circle cx="16" cy="25.5" r="2" fill="var(--accent)"/></svg>`,
  search: svg('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  chevron: svg('<path d="m9 6 6 6-6 6"/>'),
  back: svg('<path d="m15 6-6 6 6 6"/>'),
  check: svg('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  warn: svg('<path d="M12 3.5 2.5 20h19Z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01"/>'),
  x: svg('<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>'),
  ok: svg('<circle cx="12" cy="12" r="9"/><path d="m8 12.5 3 3 5-6"/>'),
  info: svg('<circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 7.5h.01"/>'),
  history: svg('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>'),
  sun: svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
  moon: svg('<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z"/>'),
  bt: svg('<path d="m7 7 10 10-5 4V3l5 4L7 17"/>'),
  laser: svg('<rect x="3" y="8" width="11" height="8" rx="2"/><path d="M14 12h7"/><path d="M18 9.5 21 12l-3 2.5"/>'),
  upload: svg('<path d="M12 16V4"/><path d="m7 9 5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/>'),
  share: svg('<path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"/><path d="M12 3v12"/><path d="m7 8 5-5 5 5"/>'),
  save: svg('<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z"/><path d="M8 3v5h7"/><path d="M8 21v-7h8v7"/>'),
  download: svg('<path d="M12 4v12"/><path d="m7 11 5 5 5-5"/><path d="M4 20h16"/>'),
  redo: svg('<path d="M20 12a8 8 0 1 1-2.3-5.7L20 8"/><path d="M20 3v5h-5"/>'),
  edit: svg('<path d="M4 20h4L19 9l-4-4L4 16v4Z"/><path d="m13.5 6.5 4 4"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  ruler: svg('<path d="m3 17 14-14 4 4L7 21Z"/><path d="m7 13 2 2M10 10l2 2M13 7l2 2"/>'),
  sliders: svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>'),
  target: svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/>'),
};

/** Status icon for good / warn / bad. */
export const statusIcon = s => (s === 'good' ? icon.ok : s === 'warn' ? icon.warn : s === 'none' ? icon.info : icon.x);
export const statusWord = s => (s === 'good' ? 'in tolerance' : s === 'warn' ? 'check' : 'out');
