## ADR-319 Amendment 1 - Convert to Path keeps curves as curves (2026-11-14)

**Status:** Accepted; unit and output evidence (Vitest on the real store action, the compile
flattening and GRBL 1.1 G-code). No hardware or packaged desktop app was run. |
**Date:** 2026-11-14

Follows tools audit T1 finding T26-P2-1 (`docs/audits/2026-11-13-tools-t1/T26-convert-to-path.md`).
Amends Decision 1 ("Convert to Path materializes the current centreline").

### Context

- Convert to Path (Tools menu, and the node-mode hint of ADR-351 item 7; both call
  `convertSelectionToPath`) baked the object's placement into world coordinates by flattening
  every curve to 0.025 mm chords and dropping the canonical `curves`. A converted 10 mm circle
  had 33 nodes and no curves. Scaled ×10 afterwards it burned 0.247 mm off-round (unconverted:
  0.025 mm), and on GRBL with arcs on a circle went from 2 G2/G3 moves to 64 G1 lines.
- LightBurn's converted result is "lines, curves, and nodes". KerfDesk's own Trim Shapes,
  Optimize Shapes and Extend already keep exact curves through `localPathArtwork`, and the rolling
  v7 L6 notes say Convert to Path does too. No ADR accepted the flattening.

### Decision

1. **Convert to Path keeps each path's canonical curves.** The object's transform (scale, mirror,
   rotation, position) is baked into the curves' points: lines and cubics map exactly through
   their points. The affine image of an elliptical arc is again an elliptical arc (ADR-431), so a
   circle under a non-uniform scale or a rotation stays an arc with new radii and axis angle.
   Converting arcs to cubics is not needed for correctness.
2. **Where the scene's endpoint arc form cannot hold the mapped arc, cubics are written.** The
   scene stores arcs in SVG endpoint form, and re-deriving a very thin image ellipse's centre from
   its endpoints can drift (0.003 mm measured on a near-singular squeeze). When that drift exceeds a
   tenth of the 0.025 mm machine tolerance, the arc is written as cubic Béziers of at most 45° of
   its parameter, carried through the arc's affine basis (error below 5e-6 of the major radius).
   ADR-431's export-only parametric marker is never stored in the scene.
3. **The compatibility polylines, bounds, tabs, pen and fill rule are unchanged.** The polylines
   are the same world flattening as before, one per curve, so tab anchors (ADR-494), every polyline
   reader, and Decision 1's composed pen transform and nonzero text winding see what they saw.
   Paths that never had curves (polyline-only imports) convert as before.
4. **Skips and undo are unchanged.** Variable text and the registration jig outlines are still left
   as they are with a notice (PR #1875), live Boolean compounds are still skipped, and the whole
   selection converts in one undo step.

### Consequences

- A converted circle keeps its few source curve segments instead of 32 chords. Node editing shows the curve's own nodes
  and handles, and a converted shape scaled up later burns as round as the unconverted shape.
  GRBL native arcs are emitted for converted shapes as they were before conversion.
- The burn of the conversion itself is unchanged within tolerance (tested by Hausdorff distance
  between the compiled polylines before and after, under rotation, mirror and non-uniform scale).
- The other geometry tools that read the same outlines (Weld, the Booleans, Offset, Dogbone, Cut
  Shapes, Union Silhouette, Join Paths) already leave variable data out through ADR-350
  Amendments 1 and 2. Copy Along Path copies objects and keeps their templates, and Delete
  Duplicates only compares outlines, so neither needs the skip.
