## ADR-255 Amendment 2 - The Inspector's Size leaves out the start it assumes (2026-09-29)

**Status:** Accepted; software-verified through unit tests. | **Date:** 2026-09-29

Amends ADR-255 stage 2 (program statistics). Read-side only: the drawing, the view fit, the
isolate and Z range controls, times, findings and every exported program are unchanged.

### Context

A program read from a file starts wherever the machine happens to be. The viewer draws that start
as 0,0,0, so the first move of a file is drawn from there, and `stats.motionBounds` measured every
segment end, that start included. The weakness audit (G-8) opened a LightBurn-style scan that burns
X 90 to 160 and Y 100 to 104.9: the Inspector's Size read 160 mm by 104.9 mm. A router program that
begins with `G0 Z5` and ends with `G28` was measured from 0,0 at both ends, although `G28` goes to a
position stored in the controller that the viewer also only assumes.

### Decision

1. **A new `stats.programBounds` holds the program's own extent** (`program-bounds.ts`). An axis
   counts from the moment the program sets it: an absolute word on it, or a relative move from a
   position the program already set. The assumed start, and an axis after `G28` homes it, stay out
   until then. Arcs count where their start does, since they are drawn about it. A drilling cycle
   takes its hole's X and Y and, in absolute mode, its R plane and depth.
2. **An axis the program never sets keeps the drawn extent.** Z in most laser files is 0 to 0 as
   before, and a program that only moves relative to its start is measured from that start, which
   is where its moves really are measured from. A known starting position (`initialPositionMm`)
   counts from the start as before.
3. **Both Size readouts use it**: the stats strip under the viewer and the Size row of the
   statistics. `motionBounds` keeps its meaning and its other readers.

### Consequences

- The scan above reads 70 mm by 4.9 mm, the router program 30 mm from where it first cuts, not
  from 0.
- The view still frames the drawn travel in from 0,0, so a file far from the origin opens showing
  both, as before.

### Verification

`program-bounds.test.ts` measures the scan, a router program with `G0 Z5` first and `G28` last, a
relative program, relative moves after an absolute one, an arc that bulges past its ends, a known
start and a drilling cycle with and without earlier moves. `inspector-readouts.test.ts` shows Size
reading 20 mm across where it read 30 mm before the change.
