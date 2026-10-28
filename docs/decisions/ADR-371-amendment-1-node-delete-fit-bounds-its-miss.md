## ADR-371 Amendment 1 - Node delete bounds its fit, so a hump or a wave crest keeps its shape (2026-10-28)

**Status:** Accepted; software-verified through unit tests. | **Date:** 2026-10-28

Amends ADR-371 Decision 1, which keeps the single-cubic, fixed-tangent fit that Edit nodes
**Delete** uses to combine curves ("it cannot split") but never bounds how far that cubic may miss
the curve it replaces. Output changes only where that fit missed by more than 2% of the removed
curve's size and letting the handles turn halves the miss.

### Context

Deleting a node between curves combines the adjacent segments into one cubic
(`core/geometry/curve-node-delete.ts`). The cubic keeps the outer handle directions, so its joins
with the kept segments stay smooth, and least-squares fits only the two handle lengths
(`fitCubicWithTangents`). The module promises that "the outline keeps its shape".

Rolling audit v7 (finding L6-P2-1, P2, confirmed by a refuter) found where it cannot. When both
outer handles lie along the chord, as at a hump or a wave crest with nodes at its extremes (the
usual SVG and font convention), every control point lies on the chord and no handle length can
bulge. A 20 mm hump on a 40 mm base became a straight line (20.000 mm off) and a wave crest sank
10 mm onto the trough line. `fitCubicWithTangents` returns its best cubic whatever its error.

What other editors do:

- **LightBurn** (Edit Nodes reference, 1.7 and 2.0, read 2026-10-28) documents D on a node only as
  "Delete nodes and combine adjacent lines". It says nothing about the shape of a combined curve,
  and no forum thread found describes it, so there is no LightBurn behaviour to copy for curves.
  Combining into one segment, which KerfDesk does, is kept.
- **Inkscape**, whose default Delete "preserves shape", samples the removed stretch and refits the
  two neighbouring handles, seeded with their existing directions, and does not check the error
  of the fit (behaviour read from its current `path-manipulator.cpp`; no code was used). It has
  the same blind spot.

### Decision

1. **The smooth-join fit is kept while it follows the curve.** Delete still fits one cubic that
   keeps the outer handle directions first. Its miss is measured both ways between the cubic and
   the removed segments, sampled densely, so a cubic that bulges away between samples counts too.
   If the miss is at most 2% of the removed curve's size (its farthest control or end point from
   the first kept node), that cubic is used, exactly as before.
2. **Past that, the handles turn freely, if that at least halves the miss.** The same samples are
   fitted with both handles free (`fitCubicFree`, `core/geometry/cubic-fit-free.ts`: chord-length
   parameters, the least-squares normal equations for the two handles, Newton reparameterization
   while it lowers the error). If its miss is under half the smooth-join fit's, it is used: the
   outline keeps its shape, and the kept nodes on either side may become corners. Otherwise the
   smooth-join cubic stays.
3. Delete is never refused for the fit's sake, as LightBurn combines lines into a chord however far
   that moves the outline. Delete is still refused only below the node floor (an open path keeps 2
   nodes, a closed one 3), and now says so (audit L6-P3-3).

### Consequences

- The audit's 20 mm hump stays a hump: its single cubic misses the two original curves by 2.05 mm
  at most (20.0 before) and still reaches the crest height. A deleted wave crest misses by 0.92 mm
  (10 before). In both cases the joins at the kept nodes turn into corners, since a smooth join is
  what made the shape impossible.
- Ordinary deletes are unchanged: deleting a node of a four-node circle of radius 20 mm misses by
  0.28 mm, inside 2%, so the handles stay vertical and the joins smooth. The arch, quarter-circle,
  elliptical-arc and eccentric-ellipse cases of `curve-node-delete.test.ts` keep their outer handle
  directions, so they still take the smooth-join cubic.
- A run that one cubic cannot follow either way, such as several nodes of a long wiggle deleted at
  once, still combines into the better of the two cubics.
- ADR-371 Decision 1's trace-fit guard is unchanged; the free fit is used only by node deletion.

### Verification

- `src/core/geometry/curve-node-delete.test.ts`: the hump keeps both handles above the crest line
  and misses by under 2.5 mm, reaching over 18 mm at its middle; the wave crest misses by under
  1.5 mm and its untouched last segment is the same object; a circle node keeps vertical handles at
  both kept nodes and misses by under 0.3 mm. The existing cases pass unchanged.
