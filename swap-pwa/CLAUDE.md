# Roster Swap — app notes

"Roster Swap": crew flight-exchange board, a **separate app at its own URL**.

Reads the calendar's roster read-only from shared `localStorage` (`duty-cal:events`, same origin) via its own `roster.js`; it never imports calendar code and never writes `duty-cal:*`.

Talks to a Google Apps Script backend (`swap-pwa/backend/Code.gs`).

Availability rules in `roster.js` are an allow-list — an unrecognised duty kind counts as *busy*, so a new calendar category can never advertise the pilot as free by mistake.
