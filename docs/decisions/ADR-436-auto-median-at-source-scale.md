## ADR-436 - Smooth's automatic median runs at source scale (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This refines the selective automatic median (`medianFilter: 'auto'`, used by the Smooth preset) and
amends ADR-435, whose consequences said "The automatic median's gate (impulse ratio) is still
decided per image". The median's own rules are unchanged: a pixel is written back only when the
3x3 median moves it by more than 40 luma and it has fewer than 3 eight-connected like-valued
supporters within two links, and only when such isolated changes reach 0.4% of the frame. Forced
medians (`medianFilter: true`, Edge Detection's `edgeMedianFilter: true`) keep their order.

### Context

Every rule of the automatic median is counted in pixels of the grid it runs on: the 3x3 window,
the two-link support search and the frame fraction. Three routes ran it on a grid other than the
source image's:

1. **The contour upscale route.** A small or thin-featured source traced with Smooth is enlarged
   2x or 3x by bilinear sampling and traced on that working grid (the small-source, thin-stroke and
   quality-scale policies). The median ran there. A one-source-pixel speck becomes a 2x2 blob at
   2x (a plus of 5 pixels at 3x) whose pixels support each other, so the repair left it. On a
   64 x 64 test image with 61 one-pixel impulses, all 61 survived at 2x and at 3x, while the same
   image traced natively lost all 61. The native pass (`prepareContourTraceInput`) had already
   computed the source-scale median for the resolution decision and discarded it.
2. **Region Enhance.** The crop was enlarged 2x and then median-filtered, with the same effect,
   and the 0.4% gate was counted on the crop, not the whole image.
3. Edge Detection already reused its source-grid cleaned image on its upscale route
   (`trace-upscale-input.ts`); it is the model followed here.

mkbitmap, the preprocessor that ships with Potrace, documents its filtering before its scaling;
the task brief cites that order and it was not re-read from the build environment. No Potrace or
mkbitmap source was consulted.

### Decision

1. **The upscale route cleans once, at source resolution, and enlarges the cleaned pixels.**
   `prepareTraceForContour` now returns its median stage (`median: { adjusted, cleaned }`, the
   tone-adjusted input and the median's output, the same object when nothing was repaired).
   `prepareUpscaledTraceInput` reuses it from the native `ContourTraceInput` when that input
   belongs to the same image and options (the Smooth preset always has it, because
   `supersampleContour` is on). Otherwise `sourceMedianStage` computes it on the source grid,
   mirroring the branch choice (alpha masks and the local-contrast sketch lanes never run the
   median). Then:
   - nothing repaired: the source is enlarged as before, with its tone controls, and the working
     grid gets `medianFilter: false`;
   - pixels repaired: the cleaned image is enlarged, and the working grid gets
     `medianFilter: false` and neutral tone controls (brightness 0, contrast 0, gamma 1, no invert),
     because those were applied before the median.
2. **Region Enhance takes the whole image's verdict and cleans the crop before enlarging it.**
   `resolveFrozenTraceSourceOptions` adds `sourceAutoMedian` (true when the whole image's median
   repairs anything) for luma lanes with `medianFilter: 'auto'`, from the same median pass that
   already feeds the frozen Otsu cut, so freezing costs no extra median. `enhanceRegionPaths`
   applies the median to the padded crop with a density floor of 0 when the verdict is true, and
   skips it when false, then enlarges. The padding ring (ADR-435) is at least 9 px, wider than the
   median's 3x3 window plus its two-link search. On the native and upscale routes, where the full
   pass runs the median on the source grid, interior pixels are therefore repaired exactly as the
   full pass repaired them. Dense artwork that the scale plan traces on a smaller working grid is
   the exception: the full pass runs the automatic median on that grid, with that grid's own
   density check, while the crop is cleaned at source scale by the source verdict, so the two can
   repair different impulses (ADR-435 notes the same for its Otsu cut on grids the plan enlarges
   or shrinks).
3. **Isolated one-pixel dots stay a preset choice.** A one-pixel halftone dot on paper and a
   one-pixel noise speck on paper present the same neighbourhood to any detector that reads a
   pixel's surroundings: one dark pixel among light ones. A regular screen differs from noise only
   by its period over many pixels, and stochastic (FM) screens are made aperiodic on purpose, to
   look statistically like noise. A density gate cannot separate them either: a screened area is as
   dense as heavy noise. So no impulse detector can tell them apart. The escape is Sharp: it runs
   no median, no pinhole fill and a despeckle of 1 px, and keeps a lattice of one-pixel dots and
   one-pixel holes. Smooth and Line Art already dropped isolated dark dots (despeckle, 24 and
   12 px) and filled isolated paper dots in ink (pinhole fill) before this change, at every scale
   and with or without the median, so for a crisp one-pixel lattice this decision removes nothing
   they kept; the owl test-strip swatches that did change (Consequences) are downsampled screens,
   which the median now reaches at source scale, before enlargement. What the
   median adds in Smooth is limited to impulses that cleanup does not catch: specks left when
   **Remove ink specks** or **Fill tiny holes** is lowered or off, and specks near an outline,
   which shift its fitted position even after cleanup removes them from the mask (a 60 px block
   with paper specks inside traces to the same subpath with or without the median, at different
   coordinates). The same holds for a mesh of one-pixel lines with one-pixel holes, whose holes are
   isolated paper impulses; meshes with holes of two pixels or more are connected and kept.

### Consequences

- A one-source-pixel impulse is removed identically at 1x, 2x and 3x: the traced mask equals the
  speck-free source's at the same scale (`trace-upscale-median.test.ts`). Connected one-pixel
  hairlines (horizontal, vertical, both diagonals), a 2 px pitch grating and a grid with 2 px cells
  stay unchanged at every scale while the median fires on specks elsewhere.
- Native traces are unchanged: Smooth on the full-size owl and hummingbird (1254 x 1254) is
  byte-identical before and after, clean and with 0.5%, 1% and 3% salt-and-pepper noise.
- Clean art on the upscale route can change, because the median now sees one-source-pixel features
  it could not see on the working grid. It is the decision the native trace makes: the full-size
  owl and hummingbird repair 8,697 and 6,624 source pixels natively. Downscaled to 300 px (traced
  at 2x), the owl repairs 1,548 source pixels and the hummingbird 947; the working-grid mask
  changes in 2,076 of 170,766 and 545 of 136,231 ink pixels, and the traced subpaths go from 321
  to 325 and from 157 to 152. On the owl's test strip, the dot-grid and fine-mesh swatches, which
  are one pixel at 300 px, are dropped and filled (item 3).
- Noise robustness, measured as source pixels where the traced mask of a noisy copy disagrees with
  the clean image's, Smooth at a fixed cut of 147 to isolate the median from Otsu, 2x:

  | Image | 0.5% noise | 1% noise | 3% noise |
  |---|---|---|---|
  | owl 600 px | 1,285 to 1,168 | 2,964 to 2,709 | 7,561 to 6,760 |
  | hummingbird 600 px | 1,190 to 1,041 | 2,087 to 1,918 | 5,531 to 4,774 |
  | owl 300 px | 415 to 452 | 729 to 711 | 2,149 to 1,851 |
  | hummingbird 300 px | 317 to 212 | 684 to 473 | 1,665 to 1,313 |

  With the preset's own Otsu cut the comparison is dominated by one-level shifts of the cut: the
  clean 600 px owl cuts at 151 after and 150 before (its noisy copy at 150 both times), which moves
  2,394 pixels far from any noise. The working grid's Otsu cut still differs from the native one
  (150 against 144 on that image); freezing it for the whole-image trace is not part of this change.
- Cost: the upscale route no longer runs the median on the 4x or 9x larger working grid, and the
  source-grid median is reused, not recomputed. Preparing the enlarged mask, interleaved median of
  seven runs in a Node harness: owl 600 px at 2x 580 to 338 ms, hummingbird 600 px 539 to 299 ms,
  owl 300 px 132 to 76 ms at 2x and 288 to 164 ms at 3x, 60 and 90 px sources about 11 to 6 ms.
  Whole Smooth traces, back to back, median of five: 13 of 16 cases faster (owl 600 px 2,638 to
  2,141 ms with 3% noise, hummingbird 600 px 1,395 to 1,178 ms clean), 3 slower (owl 600 px 0.5%
  noise 2,266 to 2,303 ms, hummingbird 300 px 0.5% and 3% noise 605 to 668 and 689 to 802 ms),
  where the cleaned mask gives the contour stages different work; the machine was shared.
- Region Enhance with Smooth on the full-size owl and hummingbird (three boxes each, clean and 1%
  noise): IoU inside the box between the crop's 2x mask and a reference built in the new order
  (the whole image cleaned at source scale, then enlarged 2x, which is what the upscale route now
  traces) was 0.9928 to 0.9980 and is 0.9986 to 1.0000. This measures agreement with the new
  order, so the earlier figure is lower partly by construction: the old crop followed the old
  enlarge-then-median order. It was not measured against the full trace's own mask or paths. The
  residual is outside the median, which matches the reference pixel for pixel in the interior
  (`region-enhance-seams.test.ts`); it was not investigated. Freezing the verdict adds no median:
  Smooth already ran one for the frozen Otsu cut. The whole image's verdict decides, not the
  crop's own density: specks packed in a box of an otherwise clean image survive (the crop alone
  would cross the floor), and a few specks in a box of an image that crosses the floor elsewhere
  are repaired (the crop alone would not).
- Memory: the median stage (the tone-adjusted input and the cleaned copy) is carried on the native
  `ContourTraceInput` only for the upscale route to resample. `traceImageToColoredPaths` releases
  it before a native trace, and `prepareUpscaledTraceInput` drops the working grid's own stage, so
  neither route keeps an extra image-sized buffer (up to 9x the source on the working grid, twice
  with a tone control set) alive through the contour trace.
- Tests: `trace-upscale-median.test.ts` (impulses at 1x, 2x and 3x; the working-grid control;
  hairlines, diagonals, grating and grid at every scale; one source-grid median, reused; the
  fallback computing the same stage; tone controls kept when nothing is repaired and cleared when
  pixels are; forced median, Line Art and Centerline unchanged; a 60 px noisy source tracing like
  its clean original with the Smooth preset; the median stage released on the native route and on
  the working grid; Sharp keeping a one-pixel dot and hole lattice that Smooth and Line Art clean
  up with or without the median), `trace-source-decisions.test.ts` (the verdict, its idempotence
  and its absence for presets without the automatic median) and `region-enhance-seams.test.ts`
  (the patch matches the new-order reference exactly inside the box, with the enlarge-first
  control; a sub-floor image keeps its specks; and the whole image's verdict, not the crop's
  density, decides in both directions).
