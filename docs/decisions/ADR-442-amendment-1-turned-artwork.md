## ADR-442 Amendment 1 - Placing artwork that is already turned (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

When the design is not on a piece, the fill centres it on each piece with its long side along the
piece's long side. The design's size and long side came from the selection's page-aligned
bounding box, which only describes artwork at 0° or 90°. An 80 × 20 mm design already turned 30°
has a 79 × 57 mm page box, was read as lying along x, and was placed still turned 30° on the
blank, so its ends stuck out past a 100 × 40 mm blank. At 60° it was read as lying along y and
ended 30° off the other way. An independent audit found it.

### Decision

1. `designFrame` (`core/camera/pieces/design-frame.ts`) reads the design in its own frame. When
   every selected object is turned by the same angle, give or take whole quarter turns, that angle
   is the design's turn. Its box, size and centre are measured along that turn. Mixed turns fall
   back to the page frame, which is also what unturned artwork gets, so both keep their old
   placement.
2. `DesignFrame` carries `turnDeg`. The aligned turn onto an oblong piece subtracts the design's
   own long-side angle (its turn, plus 90° when it is taller than wide) from the piece's; a square
   piece subtracts the design's turn within a quarter turn. Round pieces still leave the design as
   it is.
3. The sample path (design on a piece) is unchanged. It already carries the design's turn relative
   to the sample.

### Consequences

- A selection of objects turned by unrelated angles is still read in the page frame. There is no
  single long side to align in that case.
