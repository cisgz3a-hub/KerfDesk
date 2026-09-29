## ADR-535 - The flattener's joint-snap limit scales with the working grid (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

Gap backlog rank 16 (G15a, "Scale the joint-snap limit"). This extends the rule the flattener
already follows for most of its pixel constants to the joint-snap limit and the activity floor:
they are denominated in source pixels and read through the trace's working-grid scale
(`pixelScale`, the supersample, upscale or region factor its callers pass to
`flattenStraightRuns`). "Source pixels" holds on grids at or above native only; see the
Consequences for the commit grid and the downscale route.

### Context

`flattenStraightRuns` (`src/core/trace/flatten-straight-runs.ts`) replaces a near-straight run of a
traced chain with its total-least-squares line. When two adjacent runs share a boundary vertex (a
soft bend between two straights), that joint snaps to the intersection of the two fitted lines,
which recovers the true apex of the bend. It snaps only when the intersection lies within
`JOINT_SNAP_LIMIT_PX` (2) of the original vertex. Otherwise it falls back to the midpoint of the
vertex's projections onto the two lines, because near-parallel fits intersect arbitrarily far away.

Three routes reach `flattenStraightRuns` with `pixelScale` above 1, all through the contour
finisher (`contour-trace.ts`): the filled contour lane on a supersampled or upscaled grid, the
Edge Detection lane (`edge-trace.ts` passes `pixelScale: scale` into
`contourPolylinesFromMaskSteps`), and Region Enhance patches (`region-enhance.ts` sets
`pixelScale: priorScale * factor`). All three change with this ADR.

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
2. Apart from item 3, no other constant changes: the run collection, the classifier gates and the
   seam merge were already scaled, and the ratio gates (side balance, line-versus-arc
   tolerance, outlier fraction) are scale-free.
3. Review follow-up: `MIN_ACTIVE_DEVIATION_PX` (0.2), the floor under which the flattener is off,
   was compared against the SCALED budget (`1.0 * strength * scale`). A flatten strength in
   [0.1, 0.2) (Smoothness about 0.85 to 0.867, since strength = 6s - 5) was therefore off at 1x
   and on at 1.5x and 2x. The gate now compares the unscaled source-pixel budget
   (`1.0 * strength`) against 0.2. At 1x the comparison is the same expression, so 1x output is
   unchanged; the budget used downstream is the same product as before at every scale.

### Evidence

- After the change the same 324-configuration sweep gives identical output (to print precision)
  at 1x, 1.5x and 2x in all 324 configurations.
- `src/core/trace/flatten-straight-runs-scale.test.ts` pins three of the formerly divergent
  configurations: the 1x output keeps a joint within 0.4 source px of the true apex, and the 1.5x
  and 2x outputs have the same vertex count with every vertex within 0.05 source px of the 1x
  output. All three cases fail on the previous code. The same file pins the activity floor:
  at strengths 0.1, 0.15 and 0.19 a wobbly straight comes back untouched at 1x, 1.5x and 2x; all
  three cases fail on the previous gate (the 1.5x/2x output collapses to 2 vertices).
- Bake-off (harness v3, regression set plus `owl-2x`: `BAKEOFF_ONLY='^(?!hardphotos\.|perf-|decode-cap-)'`,
  contestants P-default, O-default and O-edge, one timing run). Before = the a10013827
  flattener; after = this ADR's final flattener (joint limit and activity floor). All 80
  fixtures give identical metrics (runtime excluded) for every contestant: P-default mean IoU
  0.90869, O-default 0.94738 and O-edge 0.67745 (5 thin-stroke fixtures), before and after.
  The sha256 manifests of all 165 output SVGs under `work/` (`find work -name '*.svg' | sort |
  xargs sha256sum`) are identical; the manifest file itself hashes to `7b2d78f8...c6961` in both
  phases, so the manifest diff is empty. 20 fixtures trace O-default on a 2x upscaled grid
  (thin-bars, text-small, text-large, topology, hairlines, small-features, ramp-linear,
  ramp-vignette, text-lowres, two calibration cases), and 4 of the 5 O-edge fixtures
  (thin-bars clean/scan, hairlines clean/binary) trace Edge Detection on a 2x grid. None has a
  shared joint whose line intersection lies between 2 and 4 grid px from its vertex, and none
  runs a flatten strength in [0.1, 0.2), so none changes. Owl, owl-2x and hummingbird trace on a
  native grid (owl-2x's requested 2x is reduced to 1x by the work budget), so they cannot change,
  and they do not. There is no regression. Region Enhance has no bake-off fixture; it reaches the
  flattener through the same `pixelScale` argument the unit tests drive, so it is covered at the
  flattener level only. The change is visible only where the sweep above shows it: gentle bends
  between noisy straights on a supersampled grid, and strengths just above Smoothness 0.85.

### Consequences

- A soft bend traced on a supersampled or upscaled working grid keeps the same apex it keeps on
  the native grid. At 1x the output is byte-identical to before, because the limit and the
  activity test are unchanged there.
- On a 2x grid a joint may now move up to 2 source px (4 grid px) to reach the intersection, as it
  already could at 1x. The existing longitudinal-reversal bound documented in the flattener still
  holds in source pixels.
- Commit grid and Multi-File traces (ADR-409) are NOT covered, deliberately.
  `traceOptionsForCommitGrid` scales the operator's area and length size controls by the
  commit/preview ratio but leaves `pixelScale` at 1, because ADR-409 keeps curve-fitting
  tolerances at one working pixel of the finer grid (that fidelity is why the finer grid exists).
  On those routes the joint limit is therefore 2 commit-grid px, as every other flattener
  constant is, and preview-to-commit joint equality is out of scope. It could not be reached by
  scaling the joint limit alone: modelling the commit as a 1.5x/2x grid traced with
  `pixelScale` 1, a reviewer measured 539 and 631 of 768 flattener configurations differing from
  the 1x preview, most of it from the sibling constants. A flattener length scale separate from
  `pixelScale` would be the tool if that equality is ever wanted.
- Grids at or below native are unchanged. The bounded downscale raster
  (`downscaleWorkingOptions`) forces `pixelScale` 1 and the flattener clamps any scale below 1
  to 1, so there the limit stays 2 working px (2/r source px at working ratio r, 4 source px at
  0.5), consistent with the downscale route's existing working-grid length policy
  (`trace-to-paths.ts`).
- Any future pixel constant added to the flattener must be scaled in the same commit (the lesson
  already recorded when the other constants were scaled).
