## ADR-441 Amendment 3 - The calibration target fits small beds (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

The target grid always had at least 3 columns and 4 rows, 40 mm apart. On a 100 × 100 mm bed
with the default 5 mm margin that grid is 120 mm tall. It was
centred on the 90 mm area, which put a row of rings at y = −10 mm and another at 110 mm, off the
bed. An independent audit found it. Any bed under about 130 mm deep or 90 mm wide (after the
margin) was affected. Simply shrinking that grid fits the bed but leaves two anchors on its
edge. The detector requires rings surrounding each anchor, so an ideal photo of that 3 × 4
target finds only one anchor and cannot match. Five-row grids also put the long-arm anchor on
the edge when the origin stays in the middle.

### Decision

1. Use at least 4 columns and 5 rows, and leave one row or column of rings beyond both arms of
   the anchor L. All three anchors must be inside the grid, as the existing detector requires;
   its rejection thresholds remain unchanged.
2. When the smallest grid does not fit the area at the wanted size, the rings and their spacing
   shrink by the same factor until the outer rings just touch the area's edges. The step stays
   four ring diameters (eight radii), which the ring detector's anchor test expects, so detection
   and matching use the same scale contract. On a 90 × 90 mm area the target becomes 20 marks
   of about 5.3 mm diameter, 21.2 mm apart, including the three solid anchors.
3. A target that already fits with all three anchors inside its grid keeps exactly its old
   layout. Ordinary beds, including the 390 × 390 mm target area, are unchanged. Previously
   fitting grids with edge anchors must change because those anchors were not detectable.

### Consequences

- A target engraved before this change that hung off the bed or had an edge anchor no longer
  matches the layout for its area. Engrave a new one. Existing camera models remain usable.
- Smaller rings need a camera that resolves them. The camera usually sits closer over a small bed,
  so a ring covers about as many pixels as a 10 mm ring on a large bed. If it does not, the photo
  step reports too few rings as before.
- Regression photos run through the actual ring detector and matcher at resolved pixel sizes
  for small, narrow and boundary-size areas, and retain every mark's index and centre. This is
  synthetic layout evidence; physical camera resolution and engraving quality still need a
  real camera and material check.
