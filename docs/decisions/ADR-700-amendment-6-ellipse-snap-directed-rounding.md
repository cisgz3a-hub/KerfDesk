## ADR-700 Amendment 6 - The ELLIPSE allowance covers angles rounded up or down (2026-11-13)

**Status:** Accepted. Amends ADR-700 Amendment 5. Code quality audit C2 fix verification, area E5
(E5-P1-1, E5-P3-3). | **Date:** 2026-11-13

### Context

Amendment 5 set `ELLIPSE_WRAP_SNAP` to 1.55e-3 of a turn (0.009739 rad), for radians printed to
2 or more decimals or 4 or more significant digits. Its tests rounded every angle to nearest. A
writer that rounds up instead can be off by more. `3.717 → 10.01` (4 significant digits, rounded
up) misses a whole turn by 0.009815 rad, 1.5621e-3 of a turn. It imported as a 0.19–0.34 mm dot,
in 0.76 % of start angles. That is inside Amendment 5's own "less than 0.01" bound. Before
Amendment 2 it was a closed outline.

### Decision

1. **`ELLIPSE_WRAP_SNAP` is 1.568e-3 of a turn (0.009852 rad).** It closes every ELLIPSE printed to
   2 or more decimals or 4 or more significant digits, whether the writer rounds to nearest, up,
   down or toward zero. It keeps `0 → 2π + 0.0099` a short 0.0099 rad sweep. Any value from
   1.563e-3 to 1.575e-3 meets both.
2. **`ARC_WRAP_SNAP` is unchanged** (5e-4 of a turn). Directed rounding at 1 decimal or
   4 significant digits misses by at most 0.1°, well inside it.
3. **Very large angles follow Amendment 5's "leave as written" (E5-P3-3).** At 4 significant digits,
   an ARC that starts at 640° or more ends at 1,000° or more, which keeps no decimals. An ELLIPSE
   parameter of 100 rad or more keeps 1 decimal or none. That is the coarse printing the maintainer
   chose to import as written.
4. Amendment 5's other rules, and the open question of `−3.14 → 3.14` (E5-P3-2), are unchanged.

### Verification

- `src/io/dxf/dxf-printed-angles.test.ts` now writes each angle four ways: rounded to nearest, up,
  down, and toward zero. It does this for every printing in its start × format sweep, now
  5,000 start angles. It also closes the audit's `3.717 → 10.01`.
- The sweep now catches allowances that are too tight:
  - Amendment 5's 1.55e-3 fails the 4-significant-digit rounded-up row.
  - An ELLIPSE allowance of 1.1e-3 fails.
  - An ARC allowance of a third of 5e-4 fails.
  Before these rows, the last two passed every DXF test.
