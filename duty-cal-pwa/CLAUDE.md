# Duty Calendar — app notes

Duty roster calendar (parses duty-plan PDFs). Day/week/month views, all-day lane, FTL counters, .ics export.

`kinds.js` is the single source of truth for the duty taxonomy (kind / subtype / roster codes / colours) — parser, renderer, summary and ICS all read from it, so a new duty category is one entry there plus one CSS variable.
