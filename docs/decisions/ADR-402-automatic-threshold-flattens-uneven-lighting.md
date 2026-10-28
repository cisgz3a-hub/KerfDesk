## ADR-402 - Automatic threshold flattens uneven lighting (2026-09-25)

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

### Amendment 1 - the automatic cut on tied and two-plateau histograms (2026-10-28)

Quality audit Q1 (`docs/audits/2026-10-27-quality-q1/`) found two failures of the cut itself, on
pages the gate rightly leaves alone:

- **Q4-P1-1 (P1).** On a two-level image (a 1-bit scan, a PBM, any pure black-and-white art) every
  Otsu cut between the two levels scores the same, and Otsu kept the first one: luma 1. The
  small-mark tone test (ADR-434 rule 2) then failed every ink mark of 3-11 px² by its cut margin, so
  Smooth traced six lone 3x3 dots beside a square as nothing (0 of 6; Line Art, Potrace and Smooth
  with a manual cut of 128 kept all 6). The Auto tooltip promises to keep drawn dots.
- **Q5-P2-1 (P2).** On sparse small text that is slightly blurred or enlarged from a low
  resolution, Otsu balances the two class variances by moving the cut deep into the paper side:
  Smooth cut at 180 and 191 against a 132 ink/paper mid-level, strokes came out 40-75% too heavy,
  and 5 and 15 of 22 letter counters closed (Sharp 3 and 11). Potrace kept them.

Decision (`otsuSeparation` and `automaticThreshold`, moved with Otsu's cut from `preprocess.ts` into
`core/trace/otsu-cut.ts` for size; used by `otsuBinarization`):

1. **Ties resolve to the middle.** Every cut inside an empty stretch of the histogram makes the same
   split with exactly the same score; Otsu now returns the middle of that stretch. A 0/255 image cuts
   at 128, a 30/170 image at 100. This is the gap-centring ADR-435 already applied to its frozen cut,
   now made where the cut is computed (ADR-435 Amendment 1). On a supersampled grid (`pixelScale`
   above 1) a tie keeps Otsu's lowest cut, as before. There the gaps lie between interpolated levels,
   and the middle of a gap is the bilinear saddle value between two-level pixels, where a 1 px
   diagonal line pinches. Smooth on a binary hairline attached to a block's side, 2x grid: recall
   1.000 at cuts 113-120 and 135-150, 0.475 at 127-129.
2. **Two-plateau art cuts at the plateaus' mid-level.** An anti-aliased or symmetrically blurred step
   has 50% coverage at the mid-level between its two plateaus whatever the blur width, the principle
   ADR-533 applies to edge crossings. `otsuSeparation` therefore reads two plateaus from Otsu's
   split: the ink level is the 2nd percentile of the dark class and the paper level the 98th
   percentile of the light class. These are robust to noise and to the edge pixels, and they still
   reach the ink on blurred strokes, where only the cores reach it. The art is two-plateau
   (`twoPlateau`) when the plateaus are at least 32 levels apart and the pixels strictly inside the
   middle half between them are between 0.5% and 25% of the frame. The upper bound leaves
   photographs, which spread their tones across that range, on Otsu's cut. Measured middle-half
   shares: 1.3-16% on clean, blurred, low-resolution, JPEG q35, grainy, salt-and-pepper and dim
   text and logos and on the Arch House source; 41% on the astronaut photo, which keeps cutting at
   101. The lower bound leaves two-level art (a 1-bit scan, a PBM: 0%) on Otsu's centred cut. Its
   edges carry no coverage to place, and the grey of its enlargement is interpolation. On
   two-plateau art the cut is the mid-level, rounded up (luma below it is ink).
3. **Filled outlines only.** The mid-level applies to the filled-outline lane: Smooth and Sharp,
   whose outline edges and counters it places (`automaticThreshold`, `cutsAtPlateauMidLevel`).
   Centerline, and Line + fill, which binarises as Centerline does (ADR-454), read a stroke's middle
   line, not its edges. Otsu's heavier mask keeps their thin anti-aliased strokes joined (2 px caps
   at 45° fragmented into 71 pieces at the mid-level), so they keep Otsu's cut. Line Art's fixed
   band is unchanged.
4. **The supersampled grid follows the source grid.** Smooth judges two-plateau art on its source
   grid; its 2x grid follows that verdict (`TraceOptions.sourcePlateauCut`, handed over with the
   lighting verdict of Amendment 2) and cuts at its own plateaus' mid-level, or at Otsu's cut.
5. The η and class contrast that the flattening fallback compares stay Otsu's own. Where the page is
   flattened, the cut is read from the flattened luma.

Measured through `traceImageToColoredPaths` (audit Q5 scenes, ink 20 on paper 245; area error
against the glyph outlines; counters lost of 22):

| Text page | Smooth before | Smooth after | Sharp before | Sharp after |
|---|---|---|---|---|
| clean | cut 155, +8.7%, 0 | 133, -0.4%, 0 | 144, +5.1%, 0 | 133, -2.5%, 0 |
| blur σ 1 | 180, +40.5%, 5 | 147, +6.6%, 0 | 176, +32.9%, 3 | 143, +2.7%, 0 |
| low-res x3 | 191, +75.0%, 15 (13 merged) | 151, +0.5%, 1 (2 merged) | 190, +69.6%, 11 | 145, -9.5%, 1 |
| JPEG q35 | 157, +10.9%, 0 | 132, -0.7%, 0 | 148, +7.3%, 0 | 128, -2.6%, 0 |
| grain σ 12 | 154, +9.0%, 0 | 133, -0.1%, 0 | 145, +4.9%, 0 | 128, -2.1%, 0 |

Smooth's IoU against the glyphs rises on all ten Q5 text conditions (blur 0.699 to 0.839, low-res
0.557 to 0.652). On the regression test's own render (Roboto 26 px alone, 12 counters, the
audit's rule: a counter is lost when under half of it stays paper), σ 1 blur keeps 12 of 12 where
Smooth kept 6 and Sharp 9, and low-res x3 keeps 7 (Smooth) and 9 (Sharp) where both kept 1. Its
strokes never reach the ink level, so the plateau read from them is pale and the cut lands near
158; a few small counters still close there. The six dots beside a square now trace 6 of 6 with
Smooth on 0/255, 40/230 and 20/200 pages (cut 128 on the first).

Costs, measured on the same scenes:

- On the Q5 logo at low resolution (x3), the solid shapes' cores set the ink plateau, so the pale
  20 px fine print, which never reaches the mid-level, loses 24 of 50 parts instead of 14 (holes lost
  4 to 1). That is the behaviour of Line Art's fixed band and of plain Potrace on the same page
  (audit Q5-P3-2 tracks pale small text separately). The other logo conditions stay within 0.006
  IoU.
- Sharp, which has no median, on 1% salt-and-pepper text: the black impulses pull the ink plateau to
  0, the cut to 123, and IoU from 0.879 to 0.834. Smooth's automatic median removes the impulses
  first (0.879 to 0.909).

Tests: `trace-automatic-decisions.test.ts` (dots on three two-level pages and the reported cut;
counters and stroke weight of blurred and low-resolution text through Smooth and Sharp);
`background-flatten.test.ts` (the tied cut of a hand-computed histogram; anti-aliased art at its
mid-level, two-level art and a picture on Otsu's cut, Centerline on Otsu's cut, a supplied verdict
followed); `trace-upscale-cut-verdict.test.ts` (the 2x grid receives the source grid's verdict);
`trace-source-decisions.test.ts`; `trace-report.test.ts` (the reported cut is the lane's automatic
one); `crack-iso-levels.test.ts` (ADR-533's placement still moves the edge at the new cut).
`trace-diagonal-hairline.test.ts` and the Centerline suites pass unchanged.

### Amendment 2 - the lighting gate rejects tone ranges, and one verdict per trace (2026-10-28)

Quality audit Q5-P2-3 (P2): on the repository's astronaut photo the gate found 45.7-47.1% paper
cells, just under its 50% floor, and declined. Mild grain (the same N(0, σ) draw on R, G and B,
σ 1.5-6) lifted that to 50.4-54.1% on many draws, and the gate then accepted a "paper" surface
running from luma 1-5 to 220-224. Smooth's trace fell to IoU 0.70 against the clean photo's (121 to
829 subpaths; Sharp 0.73), and the dialog said "Uneven lighting was evened out before the cut".
Smooth also ran the gate twice, on the 1x detail pass and on the 2x trace pass, and only the second
reported; on one draw the 1x pass levelled and the 2x pass did not, so the output changed while the
dialog showed a plain threshold.

Probed alternatives that did not separate the photo from paper: deciding on a 3x3 box-denoised luma
(the clean photo then passed at 52%), and the share of each paper cell's pixels near its paper
level (0.51-0.83 on the photo against 0.73-1.00 on the pages). The photo sits on the 50% floor by
nature, so any cell-share rule stays a coin toss under noise.

Decision (`core/trace/background-flatten.ts`):

1. **A paper range, not a tone range.** Lighting dims a sheet; it does not turn it black. Flattening
   now also needs the darkest fitted paper level to be at least a quarter of the brightest. On the
   astronaut that ratio is 0.00-0.02 on every draw that passed the old checks, and 0.21 clean; on
   the measured uneven pages (ADR-402's five, the same with σ 3 grain, the Q5 ramp, dim-vignette
   and phone-photo pages, the Region Enhance ramp) it is 0.32-0.69. The ratio comes from the
   fitted surface, so grain does not move it, and flat-fielding past it would amplify the dark
   end's noise more than fourfold.
2. **One verdict per trace.** `prepareTraceForContour` returns the brightness lane's verdict
   (`lightingLevelled`). On the supersampled route, `prepareUpscaledTraceInput` hands the source
   grid's verdict to the enlarged grid as the internal `TraceOptions.sourceLightingLevelled`.
   `otsuBinarization` then levels exactly when the verdict says so, fitting only the surface, and
   does not judge the interpolated pixels again. Bilinear enlargement smooths grain and adds edge
   tones, which is why the two grids could disagree. The output and the report now come from the
   same decision, so the dialog's "Band in use" note describes what ran. Region Enhance crops
   (ADR-435) still judge their own grid, as before.

Measured: every astronaut draw above now declines (σ 1.5, 2, 3 and 6 on seeds 7, 1234 and 99,
per-channel σ 3, JPEG q35). Through the trace entry, against the clean photo's own trace: Smooth
IoU 0.972-0.983 (142-181 subpaths against 134 clean), Sharp 0.967-0.983; the reported cut stays 101-102. All 16
uneven pages above still flatten.

Tests: `trace-automatic-decisions.test.ts` (the astronaut at σ 3 on two seeds and σ 1.5, Smooth and
Sharp, IoU above 0.95 against the clean trace and no levelling report); `background-flatten.test.ts`
(a ramp to near black is declined, a deep ramp is flattened, and a supplied verdict is followed both
ways); `trace-upscale-cut-verdict.test.ts` (the enlarged grid receives and follows the source grid's
verdict).
