## ADR-410 - Region Enhance patches binarise and join like the full trace (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This amends ADR-113 (Boundary mode **Enhance region**). Enhance still traces the full image,
re-traces the boxed crop at 2x (1x when 2x is over the working-pixel budget) with `pixelScale` x2
and the automatic upscales off, and swaps in re-traced subpaths that lie fully inside the box
shrunk by 1 px. The alpha verdict already reached the crop (`resolveTraceSourceOptions` carries
`sourceHasTransparency`). This decision fixes what else made the patch disagree with its
surroundings.

### Context

A tracer audit against Potrace 1.16 and LightBurn's Trace Image found three defects in the patch:

1. **Otsu was recomputed on the crop.** Sharp, Smooth and Centerline cut at the Otsu threshold of
   the pixels they are handed. On a 240 x 160 image whose paper darkens from luma 250 to 80, the
   whole image cuts at 157 and a box in the dark half cuts at 26. The full trace inked the dark
   paper; the patch did not.
2. **The auto-sketch trigger was recomputed on the crop.** Line Art switches to its local-detail
   mask when coloured pixels reach max(32, 0.2% of the pixels). A crop, supersampled to four times
   the pixels, crosses that floor where the whole image does not, and a colourless crop of a
   colourful image falls below it. A pale gold stroke under the floor for the whole image appeared
   inside the box only.
3. **The merge discarded canonical data.** `replacePathsInRegion` rebuilt every path as
   `{ color, polylines }`: the fitted cubics (ADR-391) and `operationIds` were lost for all art,
   inside the box or not, and the replacement's own cubics were dropped by the filter.

Two seam defects were found while measuring:

4. **The crop had no context.** Pixels near the box edge were filtered (median, sketch window,
   Edge Detection's local-contrast window) against the crop border instead of their real
   neighbours.
5. **A shape grazing the interior border could be doubled or lost.** Its 1x and 2x traces can land
   a fraction of a pixel apart, one on each side of the border, and each copy was judged alone. On
   26 AA discs placed at -0.75..+0.75 px from the border, 4 came out doubled. An even-odd fill
   renders a doubled outline as a hole.

Measured before this change, as the IoU inside the box between the crop's binary mask and the full
image's mask at the same 2x grid:

| Image | Line Art | Smooth | Sharp | Centerline |
|---|---|---|---|---|
| owl.png (1254 x 1254) | 0.9973 | 0.9339 | 0.9385 | 0.9319 |
| hummingbird.png (1254 x 1254) | 0.9941 | 0.9310 | 0.9370 | 0.9318 |

On the synthetic lighting ramp the patch's vector fill matched the full trace at IoU 0.90 (Sharp);
on the pale-stroke case it shared no ink with it.

### Decision

1. **Whole-source decisions are frozen once** (`resolveFrozenTraceSourceOptions` in
   `core/trace/trace-source-decisions.ts`). It runs `resolveTraceSourceOptions`, then, unless the
   trace is Photo shading or an alpha mask:
   - `sourceAutoSketch`: the auto-sketch verdict on the whole image (as Invert presents it to the
     lanes, ADR-396), set only while `autoSketchTrace` is on. `shouldUseSketchTrace` reads it before
     counting pixels. The literal suggestion, `sketchTrace: true` with `autoSketchTrace: false`, was
     rejected: `sketchTrace: true` selects the pure sketch mask, not the automatic detail mask that
     a positive auto verdict uses, so it would change the full trace.
   - `sourceOtsuThreshold`: the whole image's Otsu cut through the same tone, Invert and median
     chain the brightness path uses, set only when that path would read Otsu (`useOtsuThreshold` on,
     no explicit band or threshold, no sketch mask, not Edge Detection, whose detector never reads
     it). The brightness path uses it in place of its own histogram while `useOtsuThreshold` is on.
     It is a separate field, not `thresholdLuma`, so the zero-paths retry that drops Otsu drops it
     too. When the histogram is empty just above the cut, every cut up to the next occupied level
     splits the image the same way and Otsu reports the lowest (1 for a clean black-on-white
     image); the frozen cut takes the middle of that gap (128), which splits the image identically
     and still separates ink from the interpolated edges of a 2x crop.

   The field names follow `sourceHasTransparency`: internal verdicts carried with one execution's
   derived options. `resolveTraceSourceOptions` itself cannot compute them, because they need the
   `trace-image` preprocessing chain and `trace-image` imports `trace-alpha` (`import/no-cycle`).
2. **Both passes use the frozen options, resolved off the UI thread.** For Enhance,
   `traceImageWithBoundaryMode` asks the full pass for them (`freezeSourceDecisions` on the trace
   request). The trace worker, or the inline fallback, which is bounded to 160 000 px, resolves
   them next to the trace, traces with them and returns them as `sourceOptions`. The zero-paths
   retry relaxes those resolved options and still returns the unrelaxed ones. They then go to
   `enhanceRegionPaths`, which resolves again for callers that pass raw options; on resolved
   options that is a no-op (under 0.01 ms at 2048 x 2048). The dialog keeps the last answer per
   decoded image and settings, so dragging or resizing the box reuses it and any settings change
   resolves again. Crop mode is unchanged.
3. **The crop is padded with real pixels.** The box grows by the widest neighbourhood a lane reads,
   in this image's pixels, plus 1 for bilinear reach: 8 x `pixelScale` (the sketch, auto-detail and
   faint-line window, which also covers the 3x3 median and the automatic median's two-link check),
   or Edge Detection's local-contrast radius when larger, clamped to the image. Re-traced subpaths
   are offset from the padded origin; anything reaching into the padding fails the interior test,
   so clipped fragments are discarded as before.
4. **The merge keeps canonical data** (`core/trace/region-merge.ts`). Subpaths travel with their
   index-aligned curve. A path nothing touched is returned as the same object; an edited path
   keeps its `operationIds`, fill rule and stroke fields; additions folded into it bring their
   downscaled, offset curve, or a straight-segment curve when they had none and the path has
   curves.
5. **Border shapes follow their original.** Within 1 px of the interior border, each re-traced
   subpath is paired with the original of the same colour and closedness whose bounds match within
   1 px, closest first, one to one. A paired re-trace is kept exactly when its original was
   replaced; unpaired subpaths follow containment as before.

### Consequences

- After, same measure as the table: owl 1.0000 / 1.0000 / 1.0000 / 1.0000 and hummingbird
  0.9999 / 1.0000 / 1.0000 / 0.9999 (Line Art / Smooth / Sharp / Centerline). The patch's vector
  fill matches the full trace at IoU 1.0000 on the lighting ramp (Sharp, Smooth) and the pale-stroke
  case. The grazing-disc census is 1 outline for each of the 26 discs, 0 doubled or lost.
- The full trace in Enhance mode is unchanged where the pixels decide the same way: with frozen
  options it is byte-identical to the plain trace on owl and hummingbird for Line Art, Smooth,
  Sharp and Centerline. It can differ where the plain pass decided on another grid: a source the
  scale plan enlarges or shrinks computed Otsu and the auto-sketch count there, and now uses the
  native-grid values; a histogram gap moves the brightness path's sub-pixel iso value to the gap's
  middle.
- Region Enhance output keeps fitted cubics and operation bindings, so node editing, SVG export
  and laser conditioning (ADR-391) see the same curves inside and outside the box.
- The crop is up to 2 x (8 x `pixelScale` + 1) px wider and taller (2 x 33 px for Edge Detection at
  its widest), which counts against the 2x pixel budget.
- Resolving the decisions adds work to the full pass, in the worker, not on the UI thread. In a
  Node harness on a 1254 x 1254 image it took 3 to 20 ms for Line Art, 63 to 93 ms for Sharp and
  Centerline, and 400 to 524 ms for Smooth, whose automatic median is part of the Otsu chain. At
  the 2048 px preview limit it took 16 ms (Line Art), 82 to 90 ms (Sharp, Centerline) and 796 ms
  (Smooth); review measured about 1.7 s for Smooth at 4000 x 3000. A superseded preview retires the worker, so
  this work is cancelled with the trace. Moving the box does not repeat it.
- The crop's context ring is what keeps its edge pixels right. With Line Art's detail mask, pale
  strokes just inside the box and dark blocks 3 px outside it: the crop's mask matches the full
  image's 2x mask exactly in the box's outer 4 px and 16 px rings (2x grid) with the padding, and
  at IoU 0.26 and 0.75 without it. Sharp, Smooth (median forced on) and Centerline showed no
  difference on that art or on a dark hatch straddling the box edge.
- The automatic median's gate (impulse ratio) is still decided per image, as are the zero-paths
  retries, which the two passes take independently.
- The border pairing only covers a shape both passes trace within 1 px of each other, inside the
  1 px band around the interior border. A shape the 2x pass resolves differently there (a blob
  that splits at 2x, or an original crossing the border by more than 1 px) still follows
  containment and can be doubled or lost.
- Tests: `region-enhance-seams.test.ts` (Otsu over a ramp for Sharp, Smooth and Centerline;
  auto-sketch both ways; the context ring against an unpadded control; curves byte-identical for
  every subpath leaving the box on any side; operationIds; grazing-disc census),
  `trace-source-decisions.test.ts`, the merge cases in `region-enhance.test.ts`, the worker and
  client cases in `trace-worker-source-decisions.test.ts` and `use-trace-worker-client.test.ts`,
  and the UI-thread and reuse cases in `region-enhance-trace.test.ts`.
