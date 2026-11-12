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
3. **Coarser printing imports as its numbers say: a maintainer decision (2026-11-13).** Asked
   whether a full DXF circle or ellipse whose angles are written with only 1 decimal (or 3
   significant digits) should import as a full turn, the maintainer chose "No, leave as written".
   Such angles can be off by more than the allowances, and covering them would need allowances wide
   enough to close genuine short arcs a turn apart, such as `0 → 2π + 0.02`. These files may import
   as a short arc or a dot.
   - The allowances are set by the size of the rounding error, not by the printing, which the
     importer cannot see. So a coarse file whose rounding happens to land inside the allowance still
     closes. Of 1,000 start angles, 34.5 % of ELLIPSEs at 3 significant digits close (a start of 1 to
     10 rad has 2 decimals, the same precision as Decision 1). So do 64.2 % of ARCs at 3 significant
     digits, almost all written exactly a whole turn apart. No ELLIPSE at 1 decimal closes.
   - ARC degrees at 1 decimal stay covered. Their error, at most 0.1°, is the same as at 4
     significant digits for angles of 100° or more, which Decision 1 covers.

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
- The same file checks Decision 3 on ARC at 3 significant digits and ELLIPSE at 1 decimal and
  3 significant digits. Every case outside the allowance imports exactly as written, and at least a
  tenth of the start angles fall outside it.
- On Amendment 4's rule, 9 of these tests fail: ARC at 4 significant digits, ELLIPSE at 2 and
  3 decimals and 4 significant digits, and the audit cases.
