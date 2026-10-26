## ADR-409 Amendment 2 - A finer commit grid keeps the detector windows the preview used (2026-10-22)

**Status:** Accepted. Amends ADR-409 Decision 4. (The earlier "Amendment: Multi-File Trace Size
row" counts as Amendment 1.) | **Date:** 2026-10-22

### Context

Rolling audit v2, finding 07-P2-2. When the commit traces a grid finer than the 2048 px preview,
ADR-409 Decision 4 converts the operator's size controls so they keep their physical meaning.
The detectors' own windows were not converted. Those are the Sketch, automatic-detail and Faint
lines local mean (8 px), the thin-stroke test and light-solid fill that go with it, and Edge
Detection's neighbourhood (12 px at Detail 60). On the finer grid they covered less of the image,
so strokes the preview filled were hollowed or thinned in the committed geometry.

This was measured through the real planner. A 3000 x 1200 source is placed at its import size
(10 px/mm, so the commit traces it natively at 1.46x the 2048 x 819 preview). Committed ink over
the preview's, in source pixels squared:

| Detection | Strokes | Before | After |
|---|---|---|---|
| Line Art + Sketch | 16 / 20 / 22 px, luma 40 on 240 | 0.809 | 0.990 |
| Edge Detection | 28 / 34 px, luma 150 on white | 0.721 | 1.001 |
| Line Art + Faint lines | 2 / 4 px, luma 170 on white | 0.309 | 0.845 |

On a 1600 x 960 source with an 800 x 480 preview (2x), the first two rows were 0.661 and 0.602
before and 0.995 and 1.006 after. Line Art's automatic detail on gold strokes already agreed
before (0.987), because its light-solid fill covers broad strokes. The remaining Faint lines gap
comes from the preview's resample blur widening 1 to 2 px lines, not from the windows.

### Decision

1. `traceOptionsForCommitGrid` sets an internal `detectorWindowScale` to the longest-edge ratio
   of the commit grid to the preview, as it already does for Minimum line and the join gaps. It
   is multiplied into any value already set.
2. The detector windows use `pixelScale x detectorWindowScale`
   (`detectorWindowScale(options)` in `trace-image.ts`): the sketch / automatic-detail / Faint
   lines window (rounded to whole pixels, ADR-438 Amendment 3), the light-solid fill and the Faint
   lines thin-stroke test, Edge Detection's neighbourhood, and the region-enhance context.
   Curve-fitting tolerances and the cleanup caps (pinhole fill, despeckle, minimum area) do not
   read it. They keep the ADR-409 policy: fitting stays at one working pixel, and the operator's
   size controls are converted separately.
3. The bounded dense-colour downscale route resets `detectorWindowScale` to 1. Its windows are in
   working-grid pixels, and the preview and a finer commit both trace a working grid of the same
   bounded size (about 1.25 MP), so the windows already agree there.
4. Multi-File Trace and the headless CLI use `traceOptionsForCommitGrid`, so they get the same
   windows.

### Consequences

- For a source over 2048 px, the committed trace keeps the ink the preview showed in the Sketch,
  automatic detail, Faint lines and Edge Detection modes. The finer grid still adds detail the
  preview could not resolve, which is ADR-409's purpose.
- Sources up to 2048 px, previews and integer supersample grids are unchanged, because the scale
  is 1 there.
- The 3x3 median filters are fixed windows and are not converted, as in ADR-409. Centerline's
  internal thresholds remain the known difference ADR-409 records.

### Verification

`src/ui/trace/trace-commit-detector-windows.test.ts` traces the three cases in the table through
`planTraceCommitGrid` and `traceOptionsForCommitGrid`. It requires 0.95 to 1.05 for Sketch and
Edge Detection, and above 0.8 for Faint lines. All three fail on the code before this amendment.
It also checks the planned grid and the scale it sets.
