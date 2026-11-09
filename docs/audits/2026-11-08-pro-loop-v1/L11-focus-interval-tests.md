# Pro loop v1 — L11 Focus test and interval test

- **When:** 2026-11-08   **Tree:** `devin/audit-loops-20261108`
- **Scope:** `src/core/job/focus-test.ts`, `interval-test-grid.ts`, through `emitGcode`
- **Lenses run:** L3 (labels against the emitted program), L4 (Z motion safety).
- **Counts:** 0 raised.

## Focus test (5 samples, −2 to +2 mm, 300 mm/min Z travel)

- Each sample burns at its labelled Z offset: −2, −1, 0, +1, +2 mm from the starting focus.
- Every Z move is preceded by `M5`, written as a relative `G91 G1 Z… S0` and followed by `G90`; the
  loop's GRBL model found no Z move with the laser lit.
- Each sample returns to the starting Z before the next, and the program ends at a net Z of 0.000 mm
  from where it began.

## Interval test (4 swatches, 0.1–0.4 mm, 3000 mm/min, 50 %)

| Label | Rows burned | Measured spacing | S |
|---|---|---|---|
| 0.4 mm | 20 | 0.4000 | 500 |
| 0.3 mm | 27 | 0.3000 | 500 |
| 0.2 mm | 40 | 0.2000 | 500 |
| 0.1 mm | 80 | 0.1000 | 500 |

## Verified clean

All of the above.
