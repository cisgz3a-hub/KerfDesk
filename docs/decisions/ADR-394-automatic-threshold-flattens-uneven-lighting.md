## ADR-394 - Automatic threshold flattens uneven lighting (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This refines the automatic Otsu cut used by Smooth, Sharp and Centerline (`useOtsuThreshold`,
Phase E.2 in `core/trace/preprocess.ts`). Line Art's fixed brightness band, explicit
Cutoff/Threshold values, Edge Detection and Photo shading are unchanged. The clean-room rule of
ADR-120/123 holds: nothing here is derived from Potrace or mkbitmap code.

### Context

Smooth, Sharp and Centerline binarize with one global Otsu cut. Otsu picks the cut that best splits
the whole histogram into two populations. When the paper itself spans the ink/paper gap (a phone
photo of a drawing, a vignetting scanner lid, a sheet lit from one corner), the best split of the
histogram runs through the paper, not between paper and ink. The darker part of the sheet then
traces as one filled blob and the strokes inside it are lost.

Reproduced on the base (`fa8939b8d`) with a 400 x 200 page carrying ink at luma 60 (a 200 x 5 bar, a
5 x 90 bar and a 20 x 20 square; 1,850 px² of ink) on three paper shadings:

| Paper | Global Otsu cut | Smooth IoU | Sharp IoU | Centerline precision / recall |
|---|---|---|---|---|
| Linear ramp 150 to 250 | 195 | 0.051 | 0.051 | 0.176 / 0.198 |
| Radial vignette 250 to 140 | 198 | 0.077 | 0.077 | 0.289 / 0.579 |
| Bright corner 255 to 140 | 188 | 0.054 | 0.054 | 0.223 / 0.345 |

Potrace's companion `mkbitmap` addresses this with a documented high-pass step: subtract a blurred
copy of the image, re-centre, then scale and threshold (mkbitmap(1) manual). Flat-field correction
for scanned documents does the same multiplicatively: observed brightness = reflectance x
illumination, so dividing by an illumination estimate recovers reflectance. Otsu's paper (N. Otsu, "A
Threshold Selection Method from Gray-Level Histograms", IEEE Trans. SMC 9(1), 1979) also defines the
separability measure eta = between-class variance / total variance, a goodness score for a cut.

### Decision

1. `core/trace/background-flatten.ts` (new, own design) estimates the paper surface and flat-fields
   the luma before the automatic cut:
   - The frame is split into about 48 cells along its long side (at least 4 px each). Each cell
     reports its 85th-percentile luma, which strokes narrower than the cell cannot move.
   - The cells are grouped into regions joined by steps of at most 12 luma between neighbouring
     cells, and paper starts as the region covering the most cells. Lighting changes gradually (a
     strong vignette about 9 luma per cell at its corners); a solid shape's edge jumps by its full
     contrast, so a black or grey block of any size starts as ink even though its flat interior
     looks like dark paper. The largest region is used rather than the region round the brightest
     cell, because a small, sharply edged object brighter than the paper (a white margin round a
     smaller sheet, glare, a sticker) would otherwise stand in for the paper and wall the real
     paper off as ink.
   - The paper cells are fitted with a robust Gaussian-weighted local plane (sigma 3 cells, in
     `core/trace/paper-surface-fit.ts`). A local plane, unlike a local mean, does not bias a ramp at
     the frame edges. Each cell's fit starts from the weighted 25th percentile of the nearby paper
     samples and refits the plane three times from only the cells within 24 luma of the current
     estimate. On a clean ramp every cell stays in that band and the result is the plain
     least-squares plane. The low start matters where a white margin joins the sheet at its lit
     end: the margin is then in the same region, and a least-squares plane split the difference
     between the two and misjudged both. The percentile sample and the region test already keep
     ink out, so what remains to resist is brighter than the paper.
   - Cells more than max(10, 3 sigma) luma from the fit, below it (ink-covered) or above it (glare,
     a white margin), are excluded, cells near it are re-admitted, and the fit repeats up to three
     times, so a solid block is bridged from the paper around it.
   - Luma is multiplied by brightest paper / local paper (bilinear between cell centres) and
     saturates at the brightest paper level. Flattening yields reflectance with the paper as
     white. A large object brighter than the paper, left above it, would be a third histogram
     class, and Otsu could split it from the paper instead of splitting the ink.
2. Flattening runs automatically, only when all of these hold; otherwise the page takes the exact
   historical global-Otsu path:
   - the paper model is credible: at least half the cells are paper and their robust residual
     around the fitted surface is at most 8 luma (lighting is smooth; light-on-dark art and busy
     pictures are not);
   - the paper is detectably non-uniform: the darkest fitted paper is below 92% of the brightest;
   - the flattened histogram is credibly two-class: the means of its Otsu classes are at least 32
     luma apart (a class-separation check on the distance between class means, not a
     histogram-valley test), and flattening removes at least 10% of the histogram's within-class
     variance (1 - eta). The test is relative because on dense art the ink/paper split dominates eta: on the
     owl under a vignette, lighting moved the cut from 139 to 113 but eta only from 0.894 to 0.866.
3. The flattened luma is both what the automatic cut thresholds and the scalar the sub-pixel crack
   field interpolates, so outline vertices sit on the iso-line of the field that was cut.
   `prepareTraceForContour` (`core/trace/trace-image.ts`) calls `levelForAutomaticThreshold` only
   when the automatic cut is the active one; explicit Cutoff/Threshold values keep precedence.
   `levelForAutomaticThreshold` returns the chosen luma with its Otsu cut, and
   `applyThresholdWithIso` uses that cut instead of running a second histogram pass. A uniform page
   gets one Otsu pass, as before; the global pass that flattening is compared against runs only
   when a flattened candidate exists. `otsuSeparation` in `preprocess.ts` reports the cut, eta and
   class contrast from one histogram; `otsuThreshold` returns the same cut as before.

### Consequences

- Measured after, same pages (`src/__fixtures__/perceptual/uneven-lighting-trace.test.ts`):

  | Paper | Smooth IoU | Sharp IoU | Centerline precision / recall | Loops (Smooth, Sharp) |
  |---|---|---|---|---|
  | Linear ramp 150 to 250 | 0.051 to 0.958 | 0.051 to 0.994 | 0.176 / 0.198 to 1.000 / 1.000 | 3, 3 |
  | Radial vignette 250 to 140 | 0.077 to 0.958 | 0.077 to 0.994 | 0.289 / 0.579 to 1.000 / 1.000 | 3, 3 |
  | Bright corner 255 to 140 | 0.054 to 0.958 | 0.054 to 0.994 | 0.223 / 0.345 to 1.000 / 1.000 | 3, 3 |
  | Ramp 150 to 250 inside a 20 px white margin | 0.053 to 0.958 | 0.053 to 0.994 | 0.348 / 0.698 to 1.000 / 1.000 | 3, 3 |
  | Ramp 150 to 220 with a 40 x 40 white glare patch | 0.050 to 0.958 | 0.050 to 0.994 | 0.172 / 0.191 to 1.000 / 1.000 | 3, 3 |

  These equal the same ink on flat paper (Smooth 0.958, Sharp 0.994; Sharp 0.996 on the vignette),
  so the shading no longer costs anything on these pages. Each solid shape stays one closed loop.
  The last two rows are review regressions: the first version of this ADR seeded the paper from
  the brightest cell, so a sharp-edged object brighter than the paper disabled flattening (the
  "Before" values for those rows are that first version, which matches the base on them). Further
  probes on a 440 x 240 page with the same ink, ink/paper pixel IoU after the automatic cut:
  150 to 220 in a 20 px or 40 px white margin, 0.023 and 0.032 to 1.000; a black margin, 1.000
  (unchanged).
- Real art: the owl and hummingbird drawings (1254 x 1254) were darkened by a multiplicative
  lighting field and traced with Sharp; the score is IoU against the same preset's trace of the
  unshaded image.

  | Image, lighting | Global cut, shaded / unshaded | Before | After |
  |---|---|---|---|
  | owl, ramp 0.6 to 1.0 | 112 / 139 | 0.930 | 0.976 |
  | owl, vignette to 0.55 | 113 / 139 | 0.932 | 0.972 |
  | owl, ramp 0.6 to 0.95 plus a white 15% x 15% corner patch | 109 / 139 | 0.935 | 0.978 |
  | hummingbird, ramp 0.6 to 1.0 | 116 / 142 | 0.926 | 0.973 |
  | hummingbird, vignette to 0.55 | 116 / 142 | 0.923 | 0.968 |
  | hummingbird, ramp 0.6 to 0.95 plus a white 15% x 15% corner patch | 112 / 142 | 0.932 | 0.974 |

  The patch rows score outside the patch. Their "Before" is the first version of this ADR, whose
  brightest-cell seeding declined on them. With the 0.6 to 0.95 ramp and the vignette, with and
  without the patch, the flattened cut lands at 132 to 137, against 139 (owl) and 142
  (hummingbird) unshaded and a global cut of 108 to 118.
- Uniform pages are untouched. `uneven-lighting-uniform-pipeline.test.ts` traces the synthetic
  perceptual fixtures (the shape set, the logo-like, hollow-logo and sketch-contrast fixtures, the
  filled star, ink on flat grey paper) with Smooth, Sharp and Centerline through the real
  preprocessing chain twice. One run is as shipped; the other has `levelForAutomaticThreshold`
  forced to identity, which is the pre-ADR chain. The paths are identical, and a ramp page
  confirms that the bypass does change output. The same instrumented gate, run on the full traces
  of five real images (owl, hummingbird, the Arch House logo, the astronaut photo, the dragon
  drawing), declined on every call, so those pipelines threshold the unmodified luma with the
  historical cut. The first version of this ADR also hashed 63 of 63 traces byte-identical.
- Cost. The gate runs once per `prepareTraceForContour` call. That includes Smooth's supersampled
  raster and the detail detector's separate 1x pass, so a trace makes one or two calls (two on
  the Arch House logo and the astronaut with Smooth). Measured per call in Node (vitest, best of
  four), with the Otsu pass alone for scale:

  | Image | Otsu alone | Uniform page (declines) | Uneven page (flattens) |
  |---|---|---|---|
  | owl, 1254 x 1254 | 22 ms | 126 ms | 185 to 220 ms |
  | synthetic 4000 x 3000 | 95 to 100 ms | 205 ms | 530 to 560 ms |

  The first version of this ADR measured 91 ms and 168 ms on the owl. The robust fit costs about
  35 ms more on the owl; skipping the second Otsu pass saves about 22 ms. A region whose own cell
  samples are already uniform exits before any fitting. For scale, the owl traces in 4 to 15 s
  depending on the preset.
- Limits:
  - A sharp-edged object brighter than the paper (margin, glare, sticker) is handled while the
    paper is still the largest smooth region and covers at least half the cells. A bright object
    larger than that, or ink covering more than half the frame, fails the credibility check and
    keeps the global cut, as does a hard shadow edge sharper than the cell grid.
  - Soft tonal shading that blends into the paper on every side (soft graphite shading, a gentle
    shaded backdrop) is indistinguishable from lighting and is removed. Probe: a 245 page whose
    right 40% shades smoothly down to 170, plus the ink bars, is flattened, and only the bars
    trace. Shading with a hard edge on any side, and small soft radial glows, are declined and
    keep tracing as before.
  - Line Art's fixed band does not flatten; its colour-rich path already uses local contrast.
- Tests: `background-flatten.test.ts` covers uniform pages, grain, large black and grey blocks on
  flat paper, and light-on-dark pages, flat and unevenly lit. It also covers the ramp, a white
  margin that joins the paper's lit end, a white margin and a glare patch that do not, solid-block
  bridging, the gentle slope, the inkless fallback, `otsuSeparation` against a hand-computed
  histogram, and `levelForAutomaticThreshold` handing back the cut of the luma it returns.
  `uneven-lighting-trace.test.ts` runs the five pages above through Smooth, Sharp and Centerline,
  and checks that the uniform fixtures stay on the unmodified luma.
  `uneven-lighting-uniform-pipeline.test.ts` holds the pipeline-level equality proof.
