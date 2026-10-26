## ADR-441 Amendment 7 - Fewer lens terms, an honest straight-down grade, and a ring size (2026-10-25)

**Status:** Accepted. | **Date:** 2026-10-25

### Context

An audit rendered target photos from known cameras and measured the calibration's true error over
the whole bed, at the sheet's height and at 0 and 25 mm. Three gaps showed.

- **Bed corners.** `fitDeterminedLens` kept a lens term once it exceeded one sigma of itself. The
  third and fourth terms then often survived while cutting the residual by about 1 %. They bent the
  model past the rings by up to 0.58 mm (overhead 1280 px camera) and 0.83 mm at 25 mm (600 × 300
  bed). Two-term fits of the same photos stayed near 0.2 mm. Polynomial lens models extrapolate
  unpredictably where they have no data (Heller, Henrion and Pajdla). The usual advice is to stop
  adding terms that do not clearly improve the fit (Bouguet; Ma, Chen and Moore).
- **Straight down without a measured height.** One flat target seen square-on cannot fix the focal
  length (Sturm and Maybank 1999, "On plane-based camera calibration"), so the photo leaves the
  camera height loose. The free fit wandered to k4 = 46 057 and a camera height of 1555 mm instead
  of 450 mm. The rings still fit at 0.07 mm and were graded "good", while the bare bed was 1.85 mm
  out and 25 mm material 9.4 mm out.
- **Small rings.** Rings whose median outer diameter in the picture was 7.7–8.9 px lost their holes
  and anchors; 9.5 px and up calibrated. A 640 px camera over a 400 mm bed sees 10 mm rings at about
  7.7 px. It failed with "the three solid discs were not found … make sure nothing covers them",
  which names the wrong cause.

### Decision

1. **Two-sigma terms.** The highest free lens term is kept only when it is at least twice its own
   sigma.
2. **Loose height, two terms.** When no height was measured and the full fit leaves the camera
   height looser than 25 mm, the lens is refitted with its two dominant terms. The reported height
   sigma stays the full fit's, since the refit pins the height only by leaving terms out.
3. **An honest grade.** With no measured height and a height sigma above 10 mm, the saved record
   carries `accuracy.onlyAtTargetHeight`. A fit that would otherwise be good or fair is then graded
   fair: "Lined up at the height of the N mm target sheet only." The advice asks for a tape-measured
   camera height. The calibration row in Camera settings keeps showing this after saving.
4. **Priors on one noise scale.** The aspect-ratio and principal-point priors are scaled into
   pixels of ring noise (0.25 px), as the camera-height prior already was. Their constants now state
   the strength they always had: aspect sigma 0.0025, principal point 2 % of the width (previously
   0.01 and 8 % applied unscaled). The fit is numerically unchanged. Applying 0.01 and 8 % at their
   stated strength fitted off-height material worse in the audit (600 × 300 bed at 25 mm: 0.58 mm
   instead of 0.35 mm), so the effective strength is kept.
5. **Ring size.** The wizard has **Ring size (mm)** under Engrave settings, 10 mm by default, with
   the grid step four ring sizes. The size travels with the engraved target, the canvas target, the
   remembered target, the nudge ring and the saved calibration (`accuracy.targetRingDiameterMm`,
   absent for 10 mm). **Check camera** and the layout-mismatch check use it. A remembered target is
   assumed only while its ring size matches the settings.
6. **Rings too small.** When matching fails and the rings' median diameter is under 9.5 px, the
   photo fails as `rings-too-small`. The message names the size seen and the ring size that would
   put rings at about 12 px, or asks for a larger picture or a closer camera beyond 25 mm rings.
7. **Canvas wording.** A remembered target put on the canvas is described as "added to the canvas",
   not "engraved".

### Measured after the change

| Case | Worst error over the bed at the sheet, before → after | At 25 mm, before → after |
|---|---|---|
| Overhead camera, 1280 px | 0.58 → 0.21 mm | 0.80 → 0.22 mm |
| Side-mounted camera | 0.36 → 0.23 mm | 0.49 → 0.23 mm |
| 600 × 300 bed | 0.45 → 0.20 mm | 0.83 → 0.35 mm |
| Straight down, no height | 0.59 → 0.14 mm, graded fair (was good) | needs the measured height |
| 640 px camera, 10 mm rings | fails, "rings too small, use 16 mm" | — |
| 640 px camera, 16 mm rings | calibrates, 0.18 mm average | — |

The overhead 960 px fixture went from 0.38 to 0.45 mm worst at its corners. The fisheye, webcam,
front-mounted and measured-height straight-down cases stayed within 0.03 mm.

### Consequences

- Corners outside the rings follow the measured model more closely; the average error on the rings
  does not change.
- A straight-down calibration without a tape-measured height no longer looks better than it is.
- A low-resolution camera has a way to calibrate, and is told which.
- Code and rendered-photo evidence only (`bed-calibration.test.ts`, `calibration-result.test.ts`);
  no camera was used.
