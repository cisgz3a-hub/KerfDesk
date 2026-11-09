## ADR-421 Amendment 3 - Rest finishing steps down too, and a small finishing ball steps down in the edge band (2026-11-09)

**Status:** Accepted; software-verified through compile and analytic G-code stock simulation tests,
hardware qualification pending. | **Date:** 2026-11-09
**Fixes:** rolling audit v12 findings X6-P2-2 and X6-P2-3 (P2).

Amends ADR-421 Amendment 2. The Frame-first Start contract (ADR-228, PROJECT.md
non-negotiable 21) is unchanged: nothing here adds a guard or turns a warning into a block.

### Context

- **Rest finishing (X6-P2-2).** Amendment 2 stepped the finishing bit down where roughing left
  stock, but not the rest stage. In the refuter's 2.4 × 5 mm groove the 1/4" end mill and the 1/8"
  ball both ride over. The 1/16" rest ball then cut 4.72 mm deep at full width for 18.3 mm at F1000,
  with no note.
- **Small balls in the edge band (X6-P2-3).** Amendment 2 treated the strip within the allowance
  plus one cell of a wall, or of the relief's edge, as the next bit's side cut. That holds only for
  a bit whose centre stays out of the strip. The starter 1/16" ball (radius 0.79 mm) is smaller
  than a 1/8" end mill's strip (0.5 + 0.40 mm), so its first row along a floor that meets the edge
  ran 28.3 mm at Z−3, F1000, with 2.96 mm of stock under its centre. Amendment 2's Consequences
  said such an edge "usually gets levels".

### Decision

1. **Rest finishing steps down where finishing did not reach** (`compile-cnc-relief-rest-step-down.ts`).
   - The emitted finishing moves, step-down levels included, are swept on a grid an eighth of the
     finishing bit across, as roughing's are, with no allowance.
   - The rest bit then cuts what they missed in levels of the rest stage's own depth per pass,
     before its rest rows, as Amendment 2's levels do.
   - Each level pass carries `reliefStepDown`.
   - The rest plan records the missed area (`predecessorMissedAreaMm2`), the levels, or that the
     sweep exceeded its budget.
   - A note names the area and the rest bit's levels.
2. **The strip shrinks to a smaller next bit.** When the next bit's radius is smaller than the
   allowance plus one cell, the envelope that keeps a wall's allowance strip out of the missed
   region shrinks to that radius. The relief's edge then stops eroding the edge band in the
   opening. With a bit as large as the strip or larger, nothing changes.

### Consequences

- **Rest groove:** no rest move takes more than its 1.5 mm depth per pass off a cell (4.72 mm
  before).
- **Edge band:** no 1/16" finishing move has more than a pass under its centre along the edge
  band (2.96 mm before).
- **1/8" ball:** it still side-mills the edge band with no levels, as the refuter measured it
  holds.
- **Threshold:** X6-P3-1, the reach threshold's allowance-plus-cell slack at a fine Depth per
  pass, is not changed here.
- Not verified on hardware.
