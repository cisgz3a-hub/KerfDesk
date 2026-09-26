## ADR-457 - The flattener's joint-snap limit scales with the working grid (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

Gap backlog rank 16 (G15a, "Scale the joint-snap limit"). This completes the rule the flattener
already follows for its other pixel constants: every length it compares is denominated in source
pixels and multiplied by the trace's working-grid scale (`pixelScale`, the supersample or upscale
factor the contour route passes to `flattenStraightRuns`).

### Context

`flattenStraightRuns` (`src/core/trace/flatten-straight-runs.ts`) replaces a near-straight run of a
traced chain with its total-least-squares line. When two adjacent runs share a boundary vertex (a
soft bend between two straights), that joint snaps to the intersection of the two fitted lines,
which recovers the true apex of the bend. It snaps only when the intersection lies within
`JOINT_SNAP_LIMIT_PX` (2) of the original vertex. Otherwise it falls back to the midpoint of the
vertex's projections onto the two lines, because near-parallel fits intersect arbitrarily far away.

The amplitude cap, `MIN_RUN_LENGTH_PX`, `FLAT_LINE_SLACK_PX`, `MIN_OSCILLATION_PX` and
`SEAM_MERGE_PX` were all multiplied by `pixelScale` when the supersampled route arrived. The joint
limit was not. On a 2x working grid the joint therefore snapped only within 1 source pixel (1.33
at 1.5x), so the same artwork kept a soft-bend apex at 1x and replaced it with the projection
midpoint at 1.5x and 2x.

Measured on a synthetic sweep before the change: two wobbly straights meeting at a soft bend
(turn 8 to 30 degrees, sample step 1 to 2 px, wobble 0.2 to 0.4 px, three noise phases, with and
without an apex sample; 324 configurations), each traced at 1x, 1.5x and 2x and mapped back to
source pixels. 30 of the 324 gave different output at different scales. In the typical case the
1x joint sat at the apex (40.07, 0.00) and the 1.5x and 2x joints sat 1.5 source px down the second
leg at (41.50, 0.10).

### Decision

1. `JOINT_SNAP_LIMIT_PX` stays 2 and is now read as source pixels. `flattenStraightRuns` passes
   `JOINT_SNAP_LIMIT_PX * scale` (the same clamped `scale` its siblings use: `pixelScale` when it is
   finite and at least 1, else 1) through `emitWithFittedRuns` and `runStartVertex` to
   `jointVertex`, which compares the intersection distance against it.
2. Nothing else changes: the run collection, the classifier gates and the seam merge were already
   scaled, and the ratio gates (side balance, line-versus-arc tolerance, outlier fraction) are
   scale-free.

### Evidence

- After the change the same 324-configuration sweep gives identical output (to print precision)
  at 1x, 1.5x and 2x in all 324 configurations.
- `src/core/trace/flatten-straight-runs-scale.test.ts` pins three of the formerly divergent
  configurations: the 1x output keeps a joint within 0.4 source px of the true apex, and the 1.5x
  and 2x outputs have the same vertex count with every vertex within 0.05 source px of the 1x
  output. All three cases fail on the previous code.
- Bake-off (harness v3, regression set plus `owl-2x`, contestants P-default and O-default, one
  timing run), before = a10013827, after = this change: all 80 fixtures give identical metrics
  for both contestants (O-default mean IoU 0.94738 before and after), and all 160 output SVGs under
  `work/` are byte-identical. 20 of the fixtures trace O-default on a 2x upscaled grid
  (thin-bars, text-small, text-large, topology, hairlines, small-features, ramp-linear,
  ramp-vignette, text-lowres, two calibration cases). None of them has a shared joint whose
  line intersection lies between 2 and 4 grid px from its vertex, so none changes. Owl, owl-2x
  and hummingbird trace on a native grid (owl-2x's requested 2x is reduced to 1x by the work
  budget), so they cannot change, and they do not. There is no regression. The change is only
  visible where the sweep above shows it: gentle bends between noisy straights on a supersampled
  grid.

### Consequences

- A soft bend traced on a supersampled or upscaled working grid keeps the same apex it keeps on
  the native grid. At 1x the output is byte-identical to before, because the limit is unchanged
  there.
- On a 2x grid a joint may now move up to 2 source px (4 grid px) to reach the intersection, as it
  already could at 1x. The existing longitudinal-reversal bound documented in the flattener still
  holds in source pixels.
- Any future pixel constant added to the flattener must be scaled in the same commit (the lesson
  already recorded when the other constants were scaled).
