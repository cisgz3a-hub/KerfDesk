## ADR-441 Amendment 3 - The calibration target fits small beds (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

The target grid always had at least 3 columns and 4 rows, 40 mm apart, so the anchor L has rings
around it. On a 100 × 100 mm bed with the default 5 mm margin that grid is 120 mm tall. It was
centred on the 90 mm area, which put a row of rings at y = −10 mm and another at 110 mm, off the
bed. An independent audit found it. Any bed under about 130 mm deep or 90 mm wide (after the
margin) was affected.

### Decision

1. When the smallest grid does not fit the area at the wanted size, the rings and their spacing
   shrink by the same factor until the outer rings just touch the area's edges. The step stays
   four ring diameters (eight radii), which the ring detector's anchor test expects, so detection
   and matching are unchanged. On a 90 × 90 mm area the target becomes 12 rings of 6.9 mm, 27.7 mm
   apart.
2. A target that already fits keeps exactly its old layout. Every area where the old grid stayed
   inside was checked to give an identical layout, so saved calibrations and **Check camera** on
   ordinary beds are unaffected.

### Consequences

- A target engraved on a small bed before this change hung off the bed and no longer matches the
  layout for its area. Engrave a new one.
- Smaller rings need a camera that resolves them. The camera usually sits closer over a small bed,
  so a ring covers about as many pixels as a 10 mm ring on a large bed. If it does not, the photo
  step reports too few rings as before.
