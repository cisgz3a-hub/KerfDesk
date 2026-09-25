## ADR-409 - Line Art and Smooth judge small marks on evidence, not a fixed area (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

Clean-room constraint (ADR-017, ADR-120, ADR-123) unchanged: the policy below is our own design from
connected-component analysis and the measurements in this record. Potrace 1.16 was only run as a
binary by the bake-off harness; no tracer source was read.

### Context

The Potrace bake-off (main `fa8939b`, owl and hummingbird ink drawings plus analytic fixtures) found
that Line Art's default mask cleanup erased real fine detail that Potrace keeps:

- `despeckleMinPixels: 12` erased every ink mark under 12 px². Owl component census, 3-8 px² blobs:
  Line Art kept 9 of 1,865, Potrace 1,809. The 2-px checkerboard (32 cells of 4 px²) disappeared;
  text at 6 px cap height lost 20 of 20 parts; on the 4000² mosaic, traced on the 2048 decode grid,
  616 of 1,260 truth contours were missed (Potrace: 40).
- `fillPinholeCracks: true` filled every thin enclosed paper hole up to 120 px², so the owl's
  stipple swatch (paper holes in dense ink) traced as a solid block.
- Potrace on OUR mask lost the same parts (the identical-bitmap control), so the loss was in the
  mask stage, not the vectoriser.

Lowering the numbers was not enough: on the speckle fixture Line Art correctly removed 40 1-px and
40 2x2 black noise specks and kept 12 genuine 5-px dots, while Potrace kept the 2x2 noise. Genuine
stipple and scanner dust are the same size, so the cleanup has to discriminate.

Measured on the pre-threshold luma of the Line Art mask (probe, not committed): 3-8 px² owl ink
marks reach, at their darkest pixel, at least 0.55 of the way from paper to the ink tone (1st
percentile), sit at least 7 levels below the cut, and are brighter-ringed by at least 0.51 of the
ink-to-paper span; 99.8% have other ink within 5 px. The hummingbird (colour art, local-contrast
path) is similar but softer (1st percentiles 0.37 / 6 / 0.32). Noise sits clearly elsewhere: in a
mid-grey area straddling the cut with ±8 noise, marks miss the cut by 2-5 levels and contrast with
their ring by 0.13-0.26; faint scan specks (luma 150-220) that local-contrast detection flags as ink
on a colour-noisy scan reach only 0.03-0.42; the Arch House binarisation cracks reach 0.38-0.49 and
contrast by 0.01-0.31; the speckle fixture's noise is full black but lies at least 8 px from any
other ink.

### Decision

Add `TraceOptions.smallMarkPolicy: 'auto'` (`src/core/trace/small-mark-policy.ts`) and make it the
Line Art and Smooth default in place of their fixed `despeckleMinPixels` (12 and 24) and
`fillPinholeCracks: true`. For an ink mark under 12 source px² (above it nothing changes) and for
each thin enclosed paper hole the fixed fill would have filled:

1. Under 3 source px²: removed / filled.
2. With a grey field (every luma path): the mark must REACH at least 0.5 of the span from the
   opposite tone at its extreme pixel, clear the cut there by 0.04 of the span, and CONTRAST with its
   one-source-pixel ring by 0.3 of the span. Tones are the medians of mask ink and mask paper luma;
   the span is floored at 64 levels. A hole that fails is a threshold crack and is filled; an ink
   mark that fails is removed.
3. An ink mark under 8 source px² with no other ink within 5 source px (edge to edge) is removed. A
   lone 3x3 dot stays, a lone 2x2 speck goes.

Without a grey field (alpha masks) only 1 and 3 apply. All areas are SOURCE pixels: the classifier
scales them by pixelScale² on the 2x path and by the working/source area ratio on the bounded
downscale route (`smallMarkAreaScale`, set in `trace-to-paths.ts`). Candidates are small, so the
work per mark is a constant window and the policy is linear in pixels.

Explicit values win exactly: a user-set "Remove ink specks" (`despeckleMinPixels`, 0 = none) or
"Fill tiny holes" (`fillPinholeCracks`, true = every candidate, false = none) replaces the automatic
policy for that stage only. "Ignore Less Than" is untouched. Sharp keeps its fixed keep-everything
cleanup (pixel-fidelity preset); Centerline and Edge Detection keep theirs.

Considered and not used: anti-aliased edge-profile consistency (the reach/margin/contrast triple
already separated every measured class); a regularity (spacing) test for stipple (the neighbourhood
test keeps 99.8% of owl marks; noise that clusters is removed by the tone tests).

### Measurements

Bake-off, one timing run each. "Main" is origin/main `fa8939b` (before ADR-395); "after" is this
branch (ADR-395 base + this change), so the table includes ADR-395's smaller effect (it moved owl
Line Art IoU by about +0.012). The mask-level probe below isolates this change on the same base.

| Measure | Main | After | Potrace 1.16 (-t 2) |
|---|---|---|---|
| Owl IoU vs iso reference, Line Art | 0.8655 | 0.9057 | 0.8916 |
| Hummingbird IoU, Line Art | 0.8147 | 0.8619 | 0.8901 |
| Owl IoU / hummingbird IoU, Smooth | 0.8389 / 0.8204 | 0.8792 / 0.8777 | |
| Owl census 1-2 / 3-8 / 9-32 px² retained, Line Art | 5 / 9 / 189 | 44 / 1,439 / 363 | 0 / 1,809 / 359 |
| Same, Potrace on our Line Art mask | 4 / 12 / 184 | 81 / 1,795 / 358 | |
| Hummingbird census 3-8 / 9-32, Line Art | 270 / 219 | 1,291 / 361 | 1,783 / 402 |
| Owl ROI IoU stipple swatch / wing stipple / crosshatch | 0.863 / 0.843 / 0.896 | 0.912 / 0.891 / 0.896 | 0.912 / 0.881 / 0.845 |
| Speckle fixture, clean and scan: dots kept, noise specks kept | 12/12, 0/80 | 12/12, 0/80 | 12/12, 40/80 |
| Speckle fixture, Smooth: dots kept | 0/12 | 12/12 | |
| small-features clean: ink 9 px², holes 4 px², 1-px line 10 px | 0/3, 0/2, 0/1 | 3/3, 2/2, 1/1 | 3/3, 2/2, 0/1 |
| topology (2-px checkerboard) missed, clean / scan | 32 / 32 | 0 / 0 | 0 / 0 |
| text-small missed, clean / scan (Smooth: 17 / 17 -> 0 / 14) | 27 / 44 | 10 / 35 | 0 / 27 |
| perf-mosaic-4000 missed truth contours | 616 | 376 | 40 |
| Spurious contours on every fixture above, Line Art | 0 | 0 | |

Mask-level probe (owl, 1× luma < 128 blobs covered by the cleaned mask): 3-8 px² 34 -> 1,850 of
1,865; holes 3-8 px² 64 -> 1,245 of 1,280; mask IoU 0.935 -> 0.986. The Arch House source keeps its
input-mask IoU gate (the crack holes are still filled). Cleanup cost: +36 ms on the 1254² owl,
+47 ms on the hummingbird, about +5% on 1024²-2048² random noise. Whole-trace time rises with the
number of outlines it now keeps (owl Line Art 5.3 s -> 7.1 s, hummingbird 4.3 s -> 4.4 s).

A synthetic JPEG-like scan (±8 colour noise, faint specks luma 150-220 beside the art) keeps every
dark stipple dot and gains no speck; a mid-grey patch with noise straddling the cut yields no marks
(`small-mark-policy.test.ts`).

### Consequences

- The mask now carries what Potrace keeps: on the owl, Potrace run on our mask retains 1,795 of
  Potrace's own 1,809 3-8 px² blobs. The Line Art trace retains 1,439 (80% of Potrace): the rest is
  lost in the contour finisher, which smooths 3-8 px² loops until they cover under half their blob
  (1,192 traced outlines now fall in the 1-2 px² bucket). That is the vectoriser, not this stage.
- The hummingbird stays below Potrace (0.8619 vs 0.8901) because Line Art takes the colour
  local-contrast path on a dense-colour downscaled grid; on the same image's luma it scores 0.9073.
  That gap belongs to the colour/scale policy, not the small-mark stage.
- Isolated 2x2 ink squares (small-features ink-area-4) are still removed; they are indistinguishable
  from the speckle fixture's noise, and the noise result wins.
- The decode cap is still invisible to the core: a 4000 px file decoded to 2048 px is judged in
  decoded pixels. Marks that pass the tone and neighbourhood tests no longer depend on that scale.
- The Trace dialog shows the unset controls as "Remove ink specks 0" and an unchecked "Fill tiny
  holes"; their tooltips now say an unset value means the automatic policy. A tri-state "Auto"
  display is left to the dialog owners. Unchecking "Fill tiny holes" after checking it is an
  explicit "never fill".
- Tests that pinned the fixed-area erasure are updated: the Line Art and Smooth 2-px checkerboard is
  now kept at half the board (never welded), the Centerline connectivity test pins the fixed rule
  with an explicit 12 and asserts the automatic result separately, and the dialog tests expect the
  unset controls.
