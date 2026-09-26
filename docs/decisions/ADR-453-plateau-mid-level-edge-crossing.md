## ADR-453 - Automatic-cut edges cross at the local plateau mid-level (2026-09-27)

**Status:** Proposed (open: per-fixture IoU losses, see Bake-off). | **Date:** 2026-09-27

Amends the sub-pixel crack field of ADR-128 (measured boundary) for the automatic (Otsu) cut used by
Smooth (the CNC default) and Sharp. The binary mask, despeckle, pinhole fill, saddle decisions and
every finishing stage are unchanged; only where the contour walker puts each crack's vertex moves.
Line Art (explicit Threshold 128) and every explicit Cutoff/Threshold are untouched.

### Context

The walker interpolates each crack's crossing against the cut that made the mask. That is right when
the cut is the edge level, but the automatic cut splits the histogram where the two class variances
balance, which on real art is usually darker than the mid-level. Every crossing then lands inside the
ink: the 2026-09-25 bake-off measured a -0.12 px mean radius on an anti-aliased disc for Smooth and
Sharp, 0.18-0.19 px apex gaps, and Smooth AA hairline recall 0.775 against Potrace 1.16's 0.887
(backlog item G2).

An anti-aliased or symmetrically blurred step between ink level I and paper level P has the value
(I + P) / 2 exactly at the edge (50% coverage), for a symmetric kernel of any width. So the right
crossing level needs the two plateaus, not the kernel.

### Decision

1. **A walker-only crossing hook.** `CrackSubPixelField.crackCrossingAt(inkX, inkY, bgX, bgY)`
   (optional) returns the crossing t of one crack. `contour-boundary.ts` consults it before the
   threshold interpolation; `contour-support.ts` passes it through for unpatched cracks. Saddle
   decisions and cleanup read only `lumaAt` / `thresholdAt`, so the mask and topology are exactly the
   cut's. Fields without the hook run the old arithmetic unchanged.
2. **Local plateau mid-level on broad edges** (`crack-iso-levels.ts` `withPlateauCrossing`, wired by
   `walker-crack-field.ts` on the automatic cut only). For each crack, the (2r+1)^2 block just past
   the ink pixel (r = 1 source px x pixelScale, reaching 2r + 2 px along the normal) must be all ink
   in the mask, and the block just past the paper pixel all paper. The crack then crosses at the
   mean of those two blocks' luma, halved. The crossing keeps the walker's gates (saturated steps
   and cracks the cut does not straddle keep the midpoint; t is clamped to 0.1-0.9, so an edge never
   leaves the mask's own crack).
3. **Thin features keep the cut.** A crack that fails either block (a hairline, a narrow counter or
   gap) keeps the crossing of the cut exactly as before. The block reaches past the crack in every
   direction, so diagonal hairlines fail it as well as axis-aligned ones.
4. **Local, not global, levels.** A first version took global levels (25%/75% quantiles of each Otsu
   class). An edge against grey paper then crossed at the wrong level: a disc half on 150-grey paper
   measured +0.09 px bias. Local block means bring it to -0.007 px.

### Rejected: a per-component ribbon level

The backlog asked for a ribbon level for components under ~2 px (traced width equal to integrated
darkness). It was implemented and measured worse. Moving a thin loop's edges outward past the mask's
cracks folds the loop onto itself at saddles, and even-odd fill cancels the overlap. Smooth AA 60 deg
hairline alone fell to 0.875 (floor 0.9), and a hairline attached at a block corner fell to 0.275
(floor 0.6). An axis-run broadness gate instead of the block gate also failed: 0.5875 on the 60 deg
AA hairline, because a diagonal line passes an axis-run test. Thin features therefore keep the old
crossing. Their recall on this base already meets the target (below).

### Measurements

Crack-chain layer (mid-crack chain of the traced mask, vertex radial error against the analytic
disc; bias / RMS px), base a10013827 -> this change. The fixtures are synthetic, 8x8 supersampled
coverage (`crack-iso-levels.test.ts`):

| fixture | Otsu | base | now |
| --- | --- | --- | --- |
| AA disc r=60 on white (Smooth, Sharp) | 125 | -0.0165 / 0.0565 | -0.0086 / 0.0567 |
| same + 180-grey patch, 80 px | 113 | -0.0703 / 0.0904 | -0.0233 / 0.0643 |
| same + 150-grey patch, 80 px | 109 | -0.0923 / 0.1087 | -0.0325 / 0.0719 |
| disc half on 150-grey paper | 104 | -0.0026 / 0.1738 | -0.0065 / 0.0994 |
| Line Art AA disc | - | -0.0003 / 0.0542 | unchanged (same bytes) |

Where the cut lands very far below the mid-level (109 against 127.5), pixels whose coverage lies
between the two levels are paper in the mask. The crossing cannot pass their centre without
changing topology, so a -0.03 px residual remains. Final-polyline vertex RMS is 0.11-0.14 px on
every preset, Line Art included. That comes from the finishing stages, not from this layer.

Hairline recall (`trace-diagonal-hairline.test.ts`; thin strokes take the unchanged crossing, and
all 36 cells are identical at base and head):
Smooth AA 30 deg / 60 deg is 0.9750 / 0.9375 alone and 0.8875 / 0.8875 beside the square. Smooth
binary is 1.0000 / 0.9130 alone and 0.8986 / 0.8986 beside the square. All are at or above the
0.887 target. The 0.75 floor the backlog refers to (ADR-405 on the geometry-core branch) does not
exist on this base: its Smooth-beside-square floor is 0.85, and it is left as is. The square-apex
gate the backlog cites is also not on this base.

Bake-off (owl, hummingbird, analytic set; O-default / O-smooth / O-sharp vs P-default, before /
after): see "Bake-off" below.

### Bake-off

Base a10013827 vs this branch (block-mean variant), owl + hummingbird + all analytic clean/scan/
binary fixtures (57), contestants P-default / O-default / O-smooth / O-sharp:

- O-default (Line Art): all 63 O-default output files byte-identical (sha256); every metric equal.
- owl IoU: O-smooth 0.8787 -> 0.8788, O-sharp 0.9181 -> 0.9185. Hummingbird: O-smooth
  0.8768 -> 0.8776, O-sharp 0.9138 -> 0.9145. Area error falls about 0.2 points on both.
- Mean IoU change over 57 fixtures: O-smooth +0.00055, O-sharp +0.00115. Mean area error:
  O-smooth 4.88% -> 4.65%, O-sharp 2.88% -> 2.61%.
- Per-fixture losses (block-mean variant): stars.scan -0.0030, topology.clean (Sharp) -0.0028,
  small-squares.scan -0.0014, rounded-rects.scan -0.0014, solid-blue.scan -0.0010, a few under
  0.0007.
- Block-extreme variant (current code), on 24 affected fixtures x 2 presets: mean IoU change
  +0.00016. Remaining losses: topology.clean Sharp 0.9838 -> 0.9806, solid-blue.scan
  0.9986 -> 0.9977, rounded-rects.clean -0.0004, rotated-rects.clean Smooth -0.0004.
- Tried and rejected: extrapolating up to 0.5 px past a pixel centre on blurred ramps (stars.scan
  0.9889), and a block one width further out (mean IoU change -0.00008).

### Consequences

- Smooth and Sharp place broad anti-aliased edges at 50% coverage, including against grey paper.
- Line Art is byte-identical: its field has no hook.
- The hook is a general seam: any future edge-level policy can place crossings without touching
  topology.
