# Pro loop v1 — L9 Material Test grid

- **When:** 2026-11-08   **Tree:** `devin/audit-loops-20261108`
- **Scope:** `src/core/job/material-test-grid.ts`, `material-test-axes.ts`, through `emitGcode`
- **Lenses run:** L3 (each cell's label against what the emitted program burns inside it).
- **Counts:** 0 raised.

## Result

A 4 × 5 grid (speed 600–6000 mm/min by row, power 10–90 % by column, 8 × 6 mm cells), as Fill and as
Line, on S1000 / 6000 mm/min and S255 / 3000 mm/min profiles. The loop's GRBL model collected every
lit move inside each cell's machine rectangle:

| Mode / profile | Cells | Cells whose burn differs from the label | Lit rapids |
|---|---|---|---|
| Fill, S1000, 6000 | 20 | 0 | 0 |
| Fill, S255, 3000 | 20 | 0 | 0 |
| Line, S1000, 6000 | 20 | 0 | 0 |
| Line, S255, 3000 | 20 | 0 | 0 |

Each cell burns at one S equal to its power × `$30` / 100 and one F equal to its effective speed. On
the 3000 mm/min profile the 4200 and 6000 mm/min rows run, and are labelled, at 3000.

## Not verified

Rotary output: it has its own regression suites (`emit-gcode-rotary*.test.ts`) and was not re-run
here.
