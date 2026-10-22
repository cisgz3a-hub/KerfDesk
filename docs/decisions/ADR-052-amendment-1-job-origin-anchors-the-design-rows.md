## ADR-052 Amendment 1 - Job Origin anchors the design rows, not the compensated ones (2026-10-22)

**Status:** Accepted. | **Date:** 2026-10-22

Amends ADR-052 Decision step 4. Changes nothing in the table lookup, the sign, reverse-only
correction, or where reverse rows are emitted.

### Context

Step 4 made job and Frame bounds scan-offset aware, so that Frame and the safety checks see where
the head is commanded to go. The Job Origin anchor read the same bounds. User Origin, Current
Position and Verified Origin therefore anchored on the commanded reverse rows. When a reverse row
of a bidirectional fill or image defined the anchor-side edge, turning a table on moved the whole
placed job by the offset, forward rows and Line cuts included:

- At User Origin, front-left, a +0.3 mm table moved a Line cut drawn on the fill's outline from
  X 0 to X 0.3. Current Position at (100, 100) moved it from 100 to 100.3.
- A centre anchor moved by half the offset. A front-right anchor moved with a negative table.
- Absolute placement did not move, and nor did a fill enclosed by its own Line outline.
- The Frame envelope was the same with and without the table, so nothing showed the move.

The test that pinned this (`prepare-output-scan-offset-placement.test.ts`, from #306) asserted
that the program has no negative coordinate. That holds only with 0 mm overscan. With the layer
default of 5 mm, a Neotronics 4040 program placed at User Origin already goes to X -5 and passes
preflight. No ADR accepted moving vector cuts, and three contracts say the opposite:

- ADR-052 itself: forward rows and all vector cuts stay at exact design coordinates, and
  reverse-only correction keeps the design position authoritative.
- WORKFLOW F-B13c item 2: Job Origin aligns artwork bounds.
- LightBurn places the Job Origin on "the smallest possible rectangle that can fully contain all
  graphics" (Coordinates & Origin reference, 2.0): the graphics, not the output.

Controller audit v3 found this (D8-P2-1). An independent refuter and the coordinator confirmed it.

### Decision

1. Job Origin placement measures reverse rows at design. `computeJobPlacementBounds` is the burn
   extent with every scan offset left out: the device table and a layer's local offset alike.
   User Origin, Current Position and Verified Origin use it. So does the whole-scene anchor for
   selected output (`computeSceneOutputBounds`), which the Frame placement binding shares.
2. Everything that measures real motion keeps the commanded reverse rows: burn and motion bounds,
   Frame, the bed, envelope and no-go checks, the start point, the estimate and Preview. The
   compensation exists so that reverse rows burn on top of forward rows; it does not change where
   the artwork burns.
3. Absolute placement and the registration-jig anchor (ADR-057) are unchanged. Neither read the
   shift.

### Consequences

- Turning a scan-offset table on or off, or changing it, no longer moves a placed job. The Line
  cuts, the forward rows and the anchor stay where they are without a table.
- A job placed at a front-left User Origin can command its reverse rows up to the offset below
  X 0, as overscan runways already do. A device table entered in KerfDesk is capped at 1% of the
  shorter bed axis and at most 5 mm; a larger layer offset is a Job Review warning (ADR-236).
  Frame traces that extent either way.
- Job Review's burn-area size still reads the commanded extent, so with a table it can be up to
  the offset wider than the artwork. That is a display figure, not a placement input.
- G-code saved by an earlier version keeps its old placement. Preparing the project again gives
  the corrected program.

### Verification

- `src/core/job/job-placement-bounds.test.ts`: `computeJobPlacementBounds` keeps image rows and
  fill sweeps at design for positive and negative tables and for a layer's local offset, while
  `computeJobBounds` keeps the commanded reverse row.
- `src/core/job/job-origin.test.ts`: an image placed at User Origin (front-left, front-right,
  centre) or Current Position gets the same offset with and without a table.
- `src/io/gcode/prepare-output-scan-offset-placement.test.ts` now pins the corrected contract.
  User Origin, Verified Origin and Current Position keep a Line cut on the anchor with +0.5 mm
  (front-left) and -0.5 mm (front-right) tables, and centre anchors stay centred. The placement
  offset equals the offset with no table. Burn bounds still reach the commanded reverse rows, the
  emitted program commands `X-0.5` and passes preflight, and selected output anchors the full or
  selected design bounds.
- Code and test evidence only. Nothing was burned or run on a machine.
