# 737 NG Inside

A study companion for the Boeing 737 NG systems.

- **3D:** a see-through 737-800W. Pick a system and its parts light up inside
  the airplane, with flows that move when the line is live. Tap any part for
  its page.
- **Phases:** Ground · Takeoff · Cruise · Landing animate the airplane (gear,
  flaps, slats, speedbrakes, reversers) and change what each system is doing.
- **Schematic:** operate the system from an overhead-panel replica, inject
  failures, and watch lights, pressures and quantities respond.

Built so far: Air Systems, Electrical, Fuel, Hydraulics.

Content is paraphrased for study from the 737 FCOM (rev. Sep 2025), with
figures cited by section. It is **not an approved document** — the FCOM, QRH
and company manuals govern.

Vanilla ES modules, no build step; three.js (MIT) vendored in `vendor/`.
