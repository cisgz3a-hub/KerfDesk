## ADR-700 Amendment 4 - A DXF circle or ellipse written with rounded angles stays whole (2026-11-12)

**Status:** Accepted. Amends ADR-700 Amendment 2 and the shared DXF sweep rule. Code quality audit C2
fix verification, area E3 (E3-P1-1, E3-P1-2). | **Date:** 2026-11-12

### Context

Amendment 2 made the DXF sweep a one-step remainder, and the shared rule (`counterClockwiseSweep`
in `dxf-curve-sampling.ts`) treated a remainder as a whole turn only within about 1e-12 of one.
DXF writers print angles to a fixed number of decimals or significant digits, so a whole circle or
ellipse often arrives a few millionths of a turn off:

- A full ELLIPSE `0 → 6.28319` (2π rounded up) kept the 3.5e-6 rad remainder as its sweep and
  imported as a dot with no note. Radians printed to 4–10 decimals collapsed in 31–85 % of cases.
  Before Amendment 2 the same file was a closed outline.
- An ARC `s → s + 360` printed to 6–12 significant digits still collapsed in 4–13 % of cases.

`isFullEllipseSweep` also asked "is this a whole turn?" with its own 1e-9 rad tolerance.

### Decision

1. **One tolerance, `WHOLE_TURN_SNAP` = 1e-4 of a turn** (0.036°, 0.00063 rad), decides whether printed
   angles mean a whole turn, for ARC (degrees) and ELLIPSE (radians) alike. Angles printed to 4 or
   more decimals, or 6 or more significant digits, round well inside it.
2. **A sweep within that tolerance of a whole turn is a whole turn.** That gap is under a
   thousandth of the radius: 0.06 mm on a 100 mm radius.
3. **A remainder within that tolerance of zero is a whole turn only when the angles are at least a
   turn apart** (`0 → 6.28319`, `12.3457 → 372.346`). Angles less than a turn apart keep their
   sweep, so a genuinely small arc, including one across 0° (`359.99 → 0.01`), stays small.
   Equal angles still mean a full turn, as before.
4. **`isFullEllipseSweep` uses the same rule**: an ellipse closes exactly when its sweep is a whole
   turn.

### Consequences

- Full circles and ellipses from CAD exports import whole and closed whatever the printed precision.
- A deliberately open arc whose gap is under 0.036° now imports as a full circle. That gap is about
  a kerf wide at a 150 mm radius, and in practice a rounding artefact.
- Sweeps that are neither near a whole turn nor near zero are unchanged bit for bit.

### Verification

- `src/io/dxf/dxf-curve-sampling.test.ts` ("a full ELLIPSE written with rounded radians") closes
  `0 → 6.28319`, `6.2832`, `6.28318531` and `6.28318`; closes 14,000 seeded `s → s + 2π` printed to
  4–10 decimals; keeps small sweeps small; and imports `0 → 6.28319` as a closed 138 mm outline.
- `src/io/dxf/dxf-arc-sweep.test.ts` keeps 14,000 seeded `s → s + 360` arcs printed to 6–12
  significant digits as full circles, and keeps `359.99 → 0.01`, `10 → 10.01` and `0 → 360.5` small.
- On the former rule all twelve full-turn tests fail; the small-arc tests pass on both.
