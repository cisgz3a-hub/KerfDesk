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
   - Paper starts as the cells the brightest cells reach through steps of at most 12 luma between
     neighbouring cells. Lighting changes gradually (a strong vignette about 9 luma per cell at
     its corners); a solid shape's edge jumps by its full contrast, so a black or grey block of any
     size starts as ink even though its flat interior looks like dark paper.
   - The paper cells are fitted with a Gaussian-weighted local plane (sigma 3 cells). A local plane,
     unlike a local mean, does not bias a ramp at the frame edges. Cells more than max(10, 3 sigma)
     luma below the fit are ink-covered and excluded, cells near it are re-admitted, and the fit
     repeats up to three times, so a solid block is bridged from the paper around it.
   - Luma is multiplied by brightest paper / local paper (bilinear between cell centres).
2. Flattening runs automatically, only when all of these hold; otherwise the page takes the exact
   historical global-Otsu path:
   - the paper model is credible: at least half the cells are paper and their robust residual
     around the fitted surface is at most 8 luma (lighting is smooth; light-on-dark art and busy
     pictures are not);
   - the paper is detectably non-uniform: the darkest fitted paper is below 92% of the brightest;
   - the flattened histogram is credibly two-class: its Otsu classes are at least 32 luma apart
     (valley check), and flattening removes at least 10% of the histogram's within-class variance
     (1 - eta). The test is relative because on dense art the ink/paper split dominates eta: on the
     owl under a vignette, lighting moved the cut from 139 to 113 but eta only from 0.894 to 0.866.
3. The flattened luma is both what the automatic cut thresholds and the scalar the sub-pixel crack
   field interpolates, so outline vertices sit on the iso-line of the field that was cut.
   `prepareTraceForContour` (`core/trace/trace-image.ts`) calls `levelForAutomaticThreshold` only
   when the automatic cut is the active one; explicit Cutoff/Threshold values keep precedence.
   `otsuSeparation` in `preprocess.ts` reports the cut, eta and class contrast from one histogram;
   `otsuThreshold` returns the same cut as before.

### Consequences

- Measured after, same pages (`src/__fixtures__/perceptual/uneven-lighting-trace.test.ts`):

  | Paper | Smooth IoU | Sharp IoU | Centerline precision / recall | Loops (Smooth, Sharp) |
  |---|---|---|---|---|
  | Linear ramp 150 to 250 | 0.051 to 0.958 | 0.051 to 0.994 | 0.176 / 0.198 to 1.000 / 1.000 | 3, 3 |
  | Radial vignette 250 to 140 | 0.077 to 0.958 | 0.077 to 0.994 | 0.289 / 0.579 to 1.000 / 1.000 | 3, 3 |
  | Bright corner 255 to 140 | 0.054 to 0.958 | 0.054 to 0.994 | 0.223 / 0.345 to 1.000 / 1.000 | 3, 3 |

  These equal the same ink on flat paper (Smooth 0.958, Sharp 0.994), so the shading no longer
  costs anything on these pages. Each solid shape stays one closed loop.
- Real art: the owl and hummingbird drawings (1254 x 1254) were darkened by a multiplicative
  lighting field and traced with Sharp; the score is IoU against the same preset's trace of the
  unshaded image.

  | Image, lighting | Global cut, shaded / unshaded | Before | After |
  |---|---|---|---|
  | owl, ramp 0.6 to 1.0 | 112 / 139 | 0.930 | 0.976 |
  | owl, vignette to 0.55 | 113 / 139 | 0.932 | 0.978 |
  | hummingbird, ramp 0.6 to 1.0 | 116 / 142 | 0.926 | 0.973 |
  | hummingbird, vignette to 0.55 | 116 / 142 | 0.923 | 0.968 |

  Flattening restores the unshaded cut to within 5 luma on all four (137 to 142).
- Uniform pages are untouched. Before and after, the traced paths were hashed for Smooth, Sharp and
  Centerline on every synthetic perceptual fixture (the shape set, the logo-like, hollow-logo,
  sketch-contrast and transparent-alpha fixtures, the filled star, the centerline truth strokes)
  and on five real images (owl, hummingbird, the Arch House logo, the astronaut photo, the dragon
  drawing): 63 of 63 cases are byte-identical. On all five real images the gate declines, so the
  pipeline thresholds the unmodified luma object itself; `uneven-lighting-trace.test.ts` pins this
  for the synthetic fixtures.
- Cost per automatic cut, measured on the 1254 x 1254 owl in Node: the global Otsu pass takes about
  23 ms; the uniformity check adds about 60 ms, and an uneven page about 100 ms (flat-field pass
  and a second histogram). Tracing the same image takes seconds.
- Limits: ink covering more than half the frame, or a hard shadow edge sharper than the cell grid,
  fails the credibility check and keeps the global cut. Line Art's fixed band does not flatten;
  its colour-rich path already uses local contrast.
- Tests: `background-flatten.test.ts` (uniform, grain, large black and grey blocks on flat paper,
  light-on-dark, ramp, solid-block bridging, gentle slope, inkless fallback, `otsuSeparation`
  agreement with `otsuThreshold`) and
  `uneven-lighting-trace.test.ts` (the three pages through Smooth, Sharp and Centerline, and the
  uniform fixtures staying on the unmodified luma).
