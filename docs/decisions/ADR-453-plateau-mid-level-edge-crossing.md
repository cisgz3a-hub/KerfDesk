## ADR-453 - Automatic-cut edges cross at the local plateau mid-level (2026-09-27)

**Status:** Accepted | **Date:** 2026-09-27

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
(backlog item G2). The -0.12 px figure does not reproduce on a10013827's own synthetic disc on white
paper: there Otsu lands at 125, inside the deadband (Decision 5), and the end-to-end output is
byte-identical before and after at -0.029 px (see "End to end"). The bias shows where the automatic
cut is pulled away from the mid-level, as with the grey-patch fixtures below.

An anti-aliased or symmetrically blurred step between ink level I and paper level P has the value
(I + P) / 2 exactly at the edge (50% coverage), for a symmetric kernel of any width. So in theory
the right crossing level needs the two plateaus, not the kernel. The implementation reads those
plateaus from blocks 1-3 px past the crack and keeps the crossing inside the mask's own crack, so it
is only exact for anti-aliased edges and narrow blurs; see "Limits".

### Decision

1. **A walker-only crossing hook.** `CrackSubPixelField.crackCrossingAt(inkX, inkY, bgX, bgY)`
   (optional) returns the crossing t of one crack. `contour-boundary.ts` consults it before the
   threshold interpolation; `contour-support.ts` passes it through for unpatched cracks. Saddle
   decisions and cleanup read only `lumaAt` / `thresholdAt`, so the mask and its topology are
   unchanged. The finished contours can still shift by a component: the fits downstream see moved
   vertices (thin-bars.clean Smooth misses 2 components instead of 1; thin-bars.scan Smooth misses 4
   instead of 7). Fields without the hook run the old arithmetic unchanged. The plateau gate reads
   the thresholded mask before cleanup and restoration. On the upscale route,
   `restoreEnlargedContourSupport` vetoes the hook only when one of a crack's own two pixels is
   patched, so a gate block can overlap a restored cell and decide broad or thin on the
   pre-restoration mask. That affects vertex placement only, never topology.
2. **Local plateau mid-level on broad edges** (`crack-iso-levels.ts` `withPlateauCrossing`, wired by
   `walker-crack-field.ts` on the automatic cut only). For each crack, the (2r+1)^2 block just past
   the ink pixel (r = 1 source px x pixelScale, reaching 2r + 2 px along the normal) must be all ink
   in the mask, and the block just past the paper pixel all paper. The crack then crosses at the
   mid-level of the two blocks' extremes (darkest ink value, lightest paper value): the ramp of this
   or an opposite edge reaching into a block only pulls its extreme the other way. The crossing keeps the walker's gates (saturated steps
   and cracks the cut does not straddle keep the midpoint; t is clamped to 0.1-0.9, so an edge never
   leaves the mask's own crack).
3. **Thin features keep the cut.** A crack that fails either block (a hairline, a narrow counter or
   gap) keeps the crossing of the cut exactly as before. The block reaches past the crack in every
   direction, so diagonal hairlines fail it as well as axis-aligned ones.
4. **Local, not global, levels.** A first version took global levels (25%/75% quantiles of each Otsu
   class). An edge against grey paper then crossed at the wrong level: a disc half on 150-grey paper
   measured +0.09 px bias. Local block levels bring it under 0.02 px.
5. **A 2% deadband.** A cut already within 2% of the local step from the mid-level keeps its own
   crossing. The move would be under 0.02 px, and the finishing fits react to such a uniform nudge
   by re-choosing vertices rather than by moving the edge: on topology.clean (cut 130 against 127.5)
   Sharp's r = 40 rings moved only 0.008 px at the crack layer but came out with a +-0.2 px wobble,
   -0.003 IoU. With the deadband that fixture is byte-identical to base.
6. **Rejected level estimators.** Block means (an opposite edge's ramp pulls them; stars.scan -0.003
   IoU), block medians (a clean 8 px bar widened by 3.5% area), extrapolating up to 0.5 px past a
   pixel centre on blurred ramps, and blocks one width further out were all measured worse. A
   trimmed extreme (the second darkest / second lightest value of the block) was measured
   against the residual-loss fixtures and set aside as a wash. It turned solid-gold.scan from -0.0003
   into a +0.0007/+0.0012 gain (Smooth/Sharp). But solid-dark-noise.scan stayed at -0.0007,
   rounded-rects.clean stayed at -0.0004, and the gains on solid-dark-noise.clean and topology.scan
   Sharp shrank.

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
| AA disc r=60 on white (Smooth, Sharp) | 125 | -0.0165 / 0.0565 | same (inside the deadband) |
| same + 180-grey patch, 80 px | 113 | -0.0703 / 0.0904 | -0.0229 / 0.0625 |
| same + 150-grey patch, 80 px | 109 | -0.0923 / 0.1087 | -0.0319 / 0.0705 |
| disc, right half on 150-grey paper | 97 | -0.0427 / 0.1665 | -0.0169 / 0.0937 |
| Line Art AA disc | - | -0.0003 / 0.0542 | unchanged (same bytes) |

The +/-0.03 px radius criterion is met at this crack-chain layer (rows two to four). The finished
output adds the finishing fits' own error; see "End to end".

Where the cut lands very far below the mid-level (109 against 127.5), pixels whose coverage lies
between the two levels are paper in the mask. The crossing cannot pass their centre without
changing topology, so a -0.03 px residual remains. Final-polyline vertex RMS is 0.11-0.14 px on
every preset, Line Art included. That comes from the finishing stages, not from this layer.

Hairline recall (`trace-diagonal-hairline.test.ts`; thin strokes take the unchanged crossing, and
all 36 cells are identical at base and head):
Smooth AA 30 deg / 60 deg is 0.9750 / 0.9375 alone and 0.8875 / 0.8875 beside the square. Smooth
binary is 1.0000 / 0.9130 alone and 0.8986 / 0.8986 beside the square. All are at or above the
0.887 target. The 0.75 floor the backlog refers to (ADR-440, from the geometry-core branch) did
not exist on this base: its Smooth-beside-square floor is 0.85, and it is left as is. The square-apex
gate the backlog cites is not on this base either. The bake-off's `maxApexErrPx` (px, identical for
O-smooth and O-sharp) still gives the apex numbers, base -> this change:

| fixture                                                       | base          | now           |
| ------------------------------------------------------------- | ------------- | ------------- |
| solid-red.clean                                               | 0.416         | 0.091         |
| solid-blue.clean                                              | 0.415         | 0.092         |
| solid-gold.clean / .scan                                      | 0.200 / 0.199 | 0.091 / 0.074 |
| solid-dark-noise.clean / .scan                                | 0.421 / 0.209 | 0.142 / 0.213 |
| rounded-rects.clean                                           | 0.155         | 0.109         |
| solid-red.scan, solid-blue.scan, small-squares, rotated-rects | unchanged     | unchanged     |

So the square apex is under 0.08 px only on solid-gold.scan (and on the .scan squares that were
already there). The clean 200 px squares reach 0.09 px; the rest of their apex error is the
finishing fit's.

### End to end

`traceImageToColoredPaths` on the same synthetic fixtures (vertex radial error within 1.5 px of the
true edge, bias / RMS px). Base is the same build with `walker-crack-field.ts` mocked to return the
plain field:

| fixture, preset                                         | base                     | now                      |
| ------------------------------------------------------- | ------------------------ | ------------------------ |
| AA disc r=60 on white, Smooth and Sharp                 | -0.0290 / 0.1215         | same bytes               |
| + 180-grey patch (Otsu 113), Smooth                     | -0.0789 / 0.1574         | -0.0325 / 0.1388         |
| + 180-grey patch, Sharp                                 | -0.1023 / 0.1438         | -0.0325 / 0.1388         |
| disc half on 150-grey paper, Smooth                     | +0.0058 / 0.1886         | -0.0242 / 0.1301         |
| disc half on 150-grey paper, Sharp                      | +0.0058 / 0.1886         | -0.0357 / 0.1362         |
| 56 px source, disc r=12 half on 170 grey, Smooth        | +0.0992 / 0.1929 (n=53)  | +0.1211 / 0.1843 (n=49)  |
| 56 px source, disc r=12 half on 170 grey, Sharp         | +0.0520 / 0.1226 (n=81)  | +0.0281 / 0.0868 (n=73)  |
| every fixture above, Line Art                           | -                        | same bytes               |

End to end, the far-Otsu disc lands at -0.0325 px: much closer, but just outside +/-0.03. So the
+/-0.03 criterion is met at the crack-chain layer only.

### Limits

- **Wide blurs.** The plateau blocks sit 1-3 source px past the crack, and t stays in 0.1-0.9 of
  the mask's own crack. For a symmetric blur, both block extremes fall short of their plateaus by
  about the same amount, so the mid-level still holds. The residual comes from the crack
  confinement: once the ramp is wide, the 50% point often lies beyond the paper pixel of the crack
  the cut chose. On the far-Otsu disc blurred by a Gaussian (crack-chain layer, Sharp; recorded by
  `crack-iso-levels.test.ts`), bias / RMS px goes -0.145 / 0.160 -> -0.067 / 0.117 at sigma 1 px and
  -0.262 / 0.272 -> -0.151 / 0.201 at sigma 2 px. Walking the blocks outward while the block mean
  keeps ramping by more than 3% of the step (up to 4 px further) was measured and dropped: sigma 1
  was unchanged and sigma 2 only moved -0.151 -> -0.136. Lifting the clamp entirely (a measurement
  only; it lets vertices leave their crack) still left -0.050 and -0.101. A wide-blur fix therefore
  needs crossings that can move to the neighbouring crack, which is a topology question outside
  this ADR.
- **Upscale route.** On a small Smooth source traced through the upscale route, the plateau crossing
  adds to the fit tail's outward push (+0.099 -> +0.121 px bias, RMS 0.193 -> 0.184, End to end
  table). Sharp improves on the same fixture. At the crack-chain layer, pixelScale 2 doubles the
  block radius and leaves -0.037 px on the far-Otsu disc (the cut alone gives -0.07); a test
  records it.

Bake-off (owl, hummingbird, analytic set; O-default / O-smooth / O-sharp vs P-default, before /
after): see "Bake-off" below.

### Bake-off

Base a10013827 against this change (final code: block extremes + 2% deadband). Fixtures: owl,
hummingbird, all 57 analytic clean/scan/binary fixtures and the 6 calibration placements.
Contestants: P-default, O-default, O-smooth and O-sharp.

- O-default (Line Art): all 63 O-default output files are byte-identical (sha256), and every
  metric is equal. P-default is unchanged as well.
- owl IoU: O-smooth 0.8787 -> 0.8789, O-sharp 0.9181 -> 0.9187. Area error: 3.38% -> 3.12% and
  3.90% -> 3.67%.
- hummingbird IoU: O-smooth 0.8768 -> 0.8773, O-sharp 0.9138 -> 0.9146. Area error: 4.94% -> 4.72%
  and 5.75% -> 5.55%.
- Analytic set (57): mean IoU change is +0.00101 on O-smooth and +0.00160 on O-sharp. Mean |area
  error| goes 5.27% -> 4.99% (Smooth) and 3.28% -> 2.96% (Sharp). 29-30 fixtures per preset are
  byte-identical to base.
- Residual per-fixture losses, all at most 0.0008 IoU:
  - rounded-rects.clean -0.0004 (cut 122, just outside the deadband)
  - solid-dark-noise.scan -0.0008 (the extreme of a noisy dark block reads about 8 levels dark)
  - solid-gold.scan -0.0003, solid-blue.clean -0.00014, solid-red.clean -0.00008. Area error
    improves on all three.
- Deviation, apex and component changes that the IoU means hide (O-smooth and O-sharp alike unless
  noted):
  - RMS deviation worse: solid-dark-noise.scan 0.082 -> 0.128 (the extreme of a noisy block follows
    the noise), solid-gold.scan 0.137 -> 0.152, rounded-rects.clean 0.131 -> 0.137 (Smooth) and
    0.127 -> 0.134 (Sharp).
  - RMS deviation better: solid-dark-noise.clean 0.182 -> 0.090, calibration-subpixel-aa 0.199 ->
    0.091, counter-letters.scan Sharp 0.214 -> 0.162, and 12 smaller gains.
  - Apex worse: s-curve-band.scan 0.275 -> 0.316, text-large.scan Sharp 2.799 -> 2.841,
    solid-dark-noise.scan 0.209 -> 0.213. Apex better: the table above, text-small and
    counter-letters.scan.
  - Components: thin-bars.clean Smooth misses 2 instead of 1 and has 2 spurious instead of 1;
    thin-bars.scan Smooth misses 4 instead of 7; owl Smooth misses 4589 instead of 4588, owl Sharp
    564 instead of 567.
- Hard photos were not run before and after, so "no IoU loss on hard photos" is not evaluated.
- Calibration thin bars (report-only placements) lose: 100x8 -0.015/-0.017 and 100x20
  -0.007/-0.007 (Smooth/Sharp). This does not come from the crossing. The crack layer on the 8 px bar
  improves: the top edge was 0.29 px inside the ink and is now 0.10 px inside. The measured-loop fit
  tail then pushes the long sides of these out-of-sharpener-range loops about 0.28 px OUTWARD, on
  base and head alike. That push is a fit-tolerance bulge on a stadium-shaped loop. At base, the
  inward crossing bias cancelled it; with the bias removed, the bars trace 0.2-0.3 px wide. The fix
  belongs to the fit tail (geometry-core work), not to edge placement.

Two further attempts on the residual losses were measured on the same set (O-smooth and O-sharp,
against base) and set aside; the committed code is unchanged:

- **Deadband 3% instead of 2%** (about the ±0.03 px bias tolerance). rounded-rects.clean and
  solid-gold.scan no longer lose, but five fixtures that gained now lose against this
  change: topology.scan Sharp -0.0034, small-features.scan Sharp -0.0042, counter-letters.clean
  Sharp -0.0033, s-curve-band.scan Sharp -0.0037, text-large.scan Smooth -0.0011. Mean IoU gain
  drops from +0.00067 / +0.00111 to +0.00062 / +0.00084 (Smooth / Sharp, 63 fixtures).
- **Coverage-sum crossing.** Instead of interpolating the plateau mid-level between the two pixel
  centres, the edge sits where the summed coverage of the two pixels on each side of the crack puts
  it (levels from the mean of the outer block row). This is exact for a box-filtered straight edge,
  and it clears the solid-red/blue/gold and rounded-rects losses. The linear interpolation it
  replaces has a phase-dependent error of up to about ±0.07 px on a box-filtered edge, and on the
  200 px squares that shifts one side out and the opposite side in, which is where the solid-*
  losses come from. But the sum picks up the ramps of nearby edges and curvature: counter-letters
  loses 0.006-0.013, owl 0.0008-0.0009 and hummingbird 0.0003-0.0005. Mean IoU change goes
  negative (-0.00021 / -0.00001).

So the residual losses are below what a level or deadband choice can remove without new losses
elsewhere.

### On top of claude/tl-geometry-core

The calibration loss above is a property of this base's fit tail. To check how the change behaves
once it merges with the compact fit, it was applied to claude/tl-geometry-core (417a44cdb) in a
scratch worktree (its own files merge without conflict; trace-image.ts took the same three-line
call-site edit by hand). A synthetic probe traced anti-aliased bars at (40.3, 50.35) and the grey-patch
disc through the full pipeline (traceImageToColoredPaths). Area error is traced area over true area,
minus 1. Four builds were measured: base, this change, geometry-core, and geometry-core plus this change.

| fixture, preset         | a10013827 | + ADR-453 | geometry-core | + ADR-453 |
| ----------------------- | --------- | --------- | ------------- | --------- |
| bar 100x8, Smooth       | +14.3%    | +18.1%    | -4.77%        | -0.36%    |
| bar 100x8, Sharp        | +0.73%    | +4.68%    | -4.77%        | +0.01%    |
| bar 100x20, Smooth      | +5.87%    | +7.26%    | -2.14%        | +0.13%    |
| bar 100x20, Sharp       | +0.05%    | +1.58%    | -2.14%        | +0.06%    |
| bar 100x3, Smooth       | +60.1%    | +55.9%    | +10.8%        | +0.86%    |
| bar 100x3, Sharp        | +18.5%    | +18.5%    | +5.30%        | +4.95%    |
| bars, Line Art (all)    | unchanged | unchanged | unchanged     | unchanged |
| disc on 180 grey, Smooth | -0.026 / 0.176 | -0.046 / 0.110 | -0.037 / 0.115 | -0.011 / 0.081 |
| disc on 180 grey, Sharp  | -0.053 / 0.137 | -0.039 / 0.108 | -0.032 / 0.099 | -0.021 / 0.064 |

The disc rows are radial bias / RMS in px over vertices and segment midpoints.

With the compact fit, the bulge is gone. The fit then shows the inward crossing bias directly: the
bars come out 2-5% thin. This change removes it, and the thin-bar area errors drop to at most 0.4%
on the 8 and 20 px bars. So the calibration-bar loss on this base reverses once geometry-core lands.

### Consequences

- Smooth and Sharp place broad anti-aliased edges at 50% coverage, including against grey paper.
- Line Art is byte-identical: its field has no hook.
- The hook is a general seam: any future edge-level policy can place crossings without touching
  topology.
