## ADR-421 - Relief finishing cuts the scallop it is asked for and stays down between rows (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This amends the Phase H.8 relief finishing planner (ADR-098, ADR-292, ADR-294) and builds on the
exact surface contact of ADR-412. What the cutter is checked against is unchanged. What changes is
how far apart the rows are, how one row reaches the next, and how many vertices a row keeps.

### Context

On the ADR-412 bench relief (60 x 40 mm, 10 mm deep, 3.175 mm ball nose, 0.025 mm scallop):

- **Rows closer than asked.** The scallop asks for 0.561 mm between rows. The compiler sampled the
  relief at a tenth of the ball diameter (0.318 mm) and the planner rounded the stride down to
  whole cells, so rows landed every 0.318 mm: 76% more rows than the request needed.
- **A retract per row.** Every row was its own pass, so the emitter lifted to safe Z, moved and
  plunged at plunge feed before each one: 127 retracts, and 5.8 of the job's 17.4 minutes spent
  plunging straight down.
- **Every sample emitted.** A row carried one vertex per grid cell, flat or not: 24,076 G-code
  lines, 571 KB, for a part whose background is mostly flat. GRBL's 16-block planner starves on
  long runs of short segments.

### Decision

1. **Row spacing.** The compiler samples finishing at the largest cell no coarser than a tenth of
   the contact diameter that divides the requested row spacing into whole rows:
   `rowSpacing / ceil(rowSpacing / (diameter / 10))`. Interior rows then land at exactly the
   requested spacing. The planner's stride keeps its rule (the largest whole number of rows no
   wider than the request) with a relative slack of 1e-9 so rounding cannot drop a row.
2. **Stay-down links.** Without a mask, the serpentine rows form one path: row k ends on the edge
   column where row k + 1 starts, and the path follows that column's tip samples from one row to
   the next. The dilation computes both edge columns exactly, so a link is a short column of the
   same exact tip samples a row uses and carries the same qualification. A mask that excludes
   nothing plans exactly as no mask. A mask that excludes cells keeps one pass per run for now.
3. **One-sided point reduction.** A vertex is dropped only where the straight segment replacing
   it runs over the same XY line, in order, at or above every dropped vertex and no more than
   0.002 mm above any of them. The old and the new motion are both linear between their vertices,
   so the new motion is at or above the old one at every point of the same XY path: whatever the
   old path cleared, the new one clears too, and it leaves at most 0.002 mm of extra stock.
4. **Only what is read is computed.** Finishing asks the dilation for its emitted rows and its
   edge columns only (`rows`, `columns`); a cell it skips reads as stock top and is never read.

### Consequences

- The same bench, same settings:

  | | Before | After |
  |---|---|---|
  | Rows | 126 at 0.318 mm | 72 at 0.561 mm |
  | Retracts | 127 | 2 |
  | Machining time (estimate) | 17.4 min, 5.8 of them plunging | 6.5 min |
  | G-code | 24,076 lines, 571 KB | 6,249 lines, 151 KB |

- Accuracy against the model is unchanged. Batch 1's code on the new grid gives the same
  deviation numbers to the micrometre as this change, so linking and reduction alter nothing but
  the motion between samples. The open floor keeps at most 0.022 mm (p95) of the 0.025 mm scallop
  it asked for.
- Walls that the X raster runs along now get the scallop the requested spacing implies on a
  slope, which is larger than on a flat (by 1/cos² of the slope). They were finished 76% denser
  before: on the bench the leftover on walls over 45 degrees went from p95 0.17 mm to 0.38 mm. A
  steep-wall strategy (waterline, or a steep/shallow split) is the planned remedy; a smaller
  scallop request is the remedy today.
- The worst finishing residue on the plateau's sharp top edge moved from 0.108 mm to 0.163 mm
  because the new cell size puts the samples in a different place relative to that edge. Batch
  1's code on the same grid gives the same 0.163 mm; it is the sampled-model chord ADR-412
  describes, not a change in contact.
- The finer grid costs compile time only where the request lands just above a tenth of the
  diameter (the cell can be up to twice as fine per axis). Computing only the rows read offsets
  most of it: the slowest finishing compile test (0.1 mm ball, 0.005 mm scallop) takes 3.0 s,
  against 2.8 s before this change and 4.5 s with the finer grid alone.
- Tests: `relief-finishing-path.test.ts` checks the reduction (flat rows, slopes, ridges, dips,
  corners, plunges, and a property that the reduced path never lies below or more than the
  tolerance above the original anywhere along it). `relief-finishing.test.ts` checks that an
  unmasked plan is one path whose every move runs along a row or down an edge column, on exact
  tip samples. `relief-finishing-compile.test.ts` checks that interior rows land at the requested
  spacing, and `heightmap-tool-offset.test.ts` that only the requested rows and columns are
  computed. Tests that read rows as passes now read them through `relief-finishing-test-rows.ts`.
