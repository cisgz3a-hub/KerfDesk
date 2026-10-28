## ADR-307 Amendment 3 - Point Rotation pivots on the centre of the drawn selection box

**Status:** Accepted. | **Date:** 2026-10-28

### Context

Decision 3 puts Point Rotation's pivot at "the transformed combined selection-bounds center". That
box was the axis-aligned box around the turned corners of each object's own bounds. For turned
round or irregular artwork it stuck out past the outline (rolling audit v2 08-P3-3; rolling audit
v7 L2 re-rated it P1, and v7 L4 found it in every arrange tool,
`docs/audits/2026-10-28-rolling-v7/L4-transform-arrange.md`). ADR-677 makes the combined selection
box the smallest box around the outline, as LightBurn measures a selection.

### Decision

The pivot is the centre of the combined selection box as ADR-677 defines it: the smallest
world-axis box around the selected outlines, which is the box the canvas draws. For a selection
square to the bed (no object turned off a quarter turn) the point is unchanged. The Circular and
Copy Along Path source centre follows the same box.

### Consequences

A rosette of turned artwork pivots on the centre of the box the operator sees. Everything else in
ADR-307 is unchanged.
