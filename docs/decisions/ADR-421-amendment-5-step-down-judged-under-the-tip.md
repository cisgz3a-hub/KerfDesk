## ADR-421 Amendment 5 - Step-down is also judged by the stock under the tip (2026-11-14)

**Status:** Accepted; software-verified through analytic G-code stock simulation tests, hardware
qualification pending. | **Date:** 2026-11-14
**Fixes:** CNC audit v3 verification findings N7-P2-1 (P2) and N7-P3-2 (P3), the residual of
N2-P2-1 after Amendment 4.

Amends ADR-421 Amendments 2–4. The Frame-first Start contract (ADR-228, PROJECT.md
non-negotiable 21) is unchanged: nothing here adds a guard or turns a warning into a block.

### Context

Amendment 4 decided where the next bit steps down from regions. A strip was "missed" when it was
wide enough for the bit, judged by the bit's radius one Depth per pass above its tip. That holds
for a ball tip. It did not hold for a sharp V, a narrow engraver flat, or a band whose floor is
curved. Their tips ran down the band's slope beside the planned levels. On the N2 refuter's
surfaces the N7 verification measured, after Amendment 4:

- 60° V-bit: 3.12 mm under the tip along about 107 mm of the pyramid's edge band, and 2.56 mm on
  the ellipse dome.
- 30° engraver: 2.74 mm on the pyramid.
- 1 mm-tip tapered ball: 2.96 mm on the ellipse dome.
- Plain 1 mm ball: a new 1.5 mm stretch at 2.88 mm on the ellipse dome (N7-P3-2).

All of these came while the note promised one Depth per pass.

### Decision

1. **The stock under the tip counts on its own.** For every densified point of a finishing (or
   rest) row, the step-down reads the stock the previous bit left right under the tip. That is the
   highest of the roughing-grid cells round it, from the sweep of the emitted moves. For a ball or
   flat tip that is the four cells whose centres bracket the tip. For a pointed tip (tapered ball,
   V-bit, engraver) it is the 3 × 3 cells round the tip's cell, because the sweep knows roughing's
   cutter edge only to one cell, and a point can sit on uncut stock between centres it counts as
   cut. A ball reading that far would take the allowance strip it side-mills beside a wall as
   under its tip. Where that stands more than one Depth per pass above the row, the point's levels
   start from that stock, alongside the missed-region contact of Amendment 2. So a level never takes more than one pass
   under the tip, whatever the bit's shape or the band's slope.
2. **The limit is one Depth per pass,** with no allowance on top. That is the load Amendment 4's
   Consequences and the Job Review note promise.
3. **When only the path rule steps down** (no region was missed), the reach note still says so: the
   roughing bit "leaves more than one depth per pass under the … finishing bit's path in places",
   and the finishing bit cuts that first in N step-down levels.

### Verification measure

The regression tests read the stock one pass takes off a cell under the tip in all: the feed
moves between two rapids, not one G-code move at a time. A row going down a slope cuts the same
cell over several short moves. Per move, unfixed main showed no overload for the tapered and
1 mm balls; per pass it showed 2.88 and 1.66 mm. Every earlier W6, X6 and N2 simulator test also
holds under this stricter measure.

### Consequences

- In the N7 regression tests, simulated from the emitted G-code on the refuter's pyramid and
  ellipse, no lateral move takes more than 1.5 mm (plus 0.1 mm of grid slack) under its tip. The
  cases are the 60° V-bit, the 30° engraver, the 1 mm-tip tapered ball and the 1 mm ball.
- Terrace corners that roughing leaves more than one pass above the surface now also get short
  levels with pointed bits. That costs time, not material.
- Not verified on hardware.
