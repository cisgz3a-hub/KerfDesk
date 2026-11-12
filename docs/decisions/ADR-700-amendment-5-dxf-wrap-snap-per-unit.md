## ADR-700 Amendment 5 - Each DXF angle unit gets its own whole-turn allowance (2026-11-13)

**Status:** Accepted. Amends ADR-700 Amendment 4. Code quality audit C2 fix verification, area E4
(E4-P1-1, E3-P1-2 residual, E4-P3-1). | **Date:** 2026-11-13

### Context

Amendment 4 used one allowance, 1e-4 of a turn, for whether printed angles mean a whole turn. That
covered angles printed to 4 or more decimals or 5 or more significant digits. Coarser printing still
collapsed:

- A full ELLIPSE printed to 1–3 decimals or 3–4 significant digits imported as a 0.01–0.13 mm dot
  with no note. `−3.142 → 3.142` leaves 1.3e-4 of a turn. Across start angles: 83 / 32 / 19 % at
  1 / 2 / 3 decimals, and 41 / 27 % at 3 / 4 significant digits. None did before Amendment 2.
- An ARC printed to 4 significant digits still collapsed in 3.9 % of cases.

ARC angles are degrees and ELLIPSE parameters are radians, so the same printing leaves errors of
different sizes as a fraction of a turn. One allowance cannot cover both without also closing the
short arcs Amendment 4 keeps short (`0 → 360.5°`, `0 → 2π + 0.01`).

### Decision

1. **Angles at least a turn apart use an allowance per unit** (`wrapSnap`, passed to
   `counterClockwiseSweep`). A sweep within that allowance of a whole turn, or of zero, is a whole
   turn.
   - **ARC: `ARC_WRAP_SNAP` = 5e-4 of a turn (0.18°).** Degrees printed to 1 or more decimals or
     4 or more significant digits are off by at most 0.1°.
   - **ELLIPSE: `ELLIPSE_WRAP_SNAP` = 1.55e-3 of a turn (0.0097 rad).** Radians printed to 2 or
     more decimals or 4 or more significant digits are off by less than 0.01. `0 → 2π + 0.01` stays
     a 0.01 rad sweep.
2. **Angles less than a turn apart are unchanged from Amendment 4.** Only a sweep within
   `WHOLE_TURN_SNAP` (1e-4 of a turn) of a whole one closes, so a gap of at most R × 6.3e-4 is
   bridged (0.06 mm on a 100 mm radius; E4-P3-1). A small arc across 0° stays small. A circle whose
   printed end rounds short of a whole turn by more than that imports as a near-full open arc, not a
   dot.
3. **Coarser printing is left as written: a maintainer decision.** ELLIPSE radians at 1 decimal or
   3 significant digits, and ARC degrees at 3 significant digits, can be off by more than the
   allowances. Covering them would need allowances wide enough to close genuine short arcs a turn
   apart, such as `0 → 2π + 0.02`. Such files may still import as a dot.

### Consequences

- Full circles and ellipses import whole from every start angle at the printings in Decision 1.
- An ARC or ELLIPSE written more than a turn apart now closes when it is within 0.18° (ARC) or
  0.0097 rad (ELLIPSE) of a whole turn. Arcs written less than a turn apart keep their sweep.

### Verification

- `src/io/dxf/dxf-printed-angles.test.ts` sweeps 1,000 start angles across every printing:
  - ARC at 1–12 decimals and 4–12 significant digits;
  - ELLIPSE at 2–12 decimals and 4–12 significant digits.
  Every case is within 1 % of a whole turn, and exactly a whole turn when the written angles are at
  least a turn apart. It also keeps short sweeps a turn apart short, and closes the audit's cases
  (`−3.142 → 3.142`, `0 → 6.284`).
- On Amendment 4's rule, 9 of these tests fail: ARC at 4 significant digits, ELLIPSE at 2 and
  3 decimals and 4 significant digits, and the audit cases.
