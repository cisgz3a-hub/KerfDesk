## ADR-434 - Line Art and Smooth judge small marks on evidence, not a fixed area (2026-09-25)

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

Tone does nothing against DARK noise: toner scatter beside strokes, dust clusters and dirty
photocopies are as black as ink. A first version of this policy kept every dark mark with other ink
within 5 px, and review showed it kept 24 of 24 toner specks 2-4 px from a stroke, most of a
40x40 px dust cluster and 20,223 components (fixed rule: 1,182) on a 2048² dirty scan. Binary
neighbourhood statistics cannot fix that on their own. On the owl's kept 3-11 px² marks and on a
dirty scan with one 1-9 px² speck per 105 px², the like-mark counts within 5 px (0 / 1 / 2 / 3 / 4+:
owl 26 / 28 / 19 / 13 / 14%, dirty scan 15 / 42 / 30 / 11 / 2%) and the size spread of those
neighbours (CV quartiles 0.14 / 0.25 / 0.38 against 0.14 / 0.27 / 0.39) are nearly identical.
What does differ, measured on the same masks:

- Grey bridges. The owl's fine marks are anti-aliased hatching and stipple that the cut broke into
  pieces. 87% of the kept owl marks are joined to other ink by pixels at least 0.1 of the span
  darker than paper. Dust and scatter lie in clean paper.
- Debris. A dirty scan scatters specks of every size, so it leaves specks under the size floor and
  lone specks (no ink within 5 px) around the larger ones: 114 lone specks per 100,000 px² of paper
  against the owl's 1.5. The owl's own sub-floor specks mostly come out grey (partial pixel
  coverage). Only 156 of its 1,115 unbridged sub-floor specks reach 0.9 of the span, against every
  one of a hard-edged speck's.
- Stroke halo. Toner scatter sits nearer a stroke than any other small mark. Stipple beside a stroke
  has its like marks nearer.

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
3. Neighbourhood (`src/core/trace/small-mark-neighbourhood.ts`), for ink marks only:
   a. BRIDGED: a path through ink or through paper at least 0.1 of the span darker than the paper
      tone joins the mark to other ink within 5 source px of its box, so the mark is kept.
   b. DUST: otherwise, if the mark's 16-source-px debris tile or one of the eight around it holds
      unbridged dark debris, the mark is removed. Debris is a sub-floor speck reaching 0.9 of the
      span, or a lone speck under 8 px² (no ink within 5 px) reaching 0.5 of it.
   c. Otherwise a mark of 8 px² or more is kept, so a lone 3x3 dot on clean paper stays.
   d. A smaller mark is kept only if its nearest neighbour within 5 source px (edge to edge) is a
      LIKE mark (another component of 3-31 px²) and no stroke (32 px² or more) is nearer. Stipple,
      dotted rows and small text pass; scatter in a stroke's halo and lone 2x2 specks do not.

Without a grey field (alpha masks) nothing is bridged and every speck counts as dark, so 1 and 3b-d
apply. Labelling is one linear pass. Debris is counted once into a coarse tile grid, and each
bridge or support query is bounded by a constant window. All areas are SOURCE pixels: the classifier
scales them by pixelScale² on the 2x path and by the working/source area ratio on the bounded
downscale route (`smallMarkAreaScale`, set in `trace-to-paths.ts`). Candidates are small, so the
work per mark is a constant window and the policy is linear in pixels.

Explicit values win exactly: a user-set "Remove ink specks" (`despeckleMinPixels`, 0 = none) or
"Fill tiny holes" (`fillPinholeCracks`, true = every candidate, false = none) replaces the automatic
policy for that stage only. "Ignore Less Than" is untouched. Sharp keeps its fixed keep-everything
cleanup (pixel-fidelity preset); Centerline and Edge Detection keep theirs.

Considered and not used: anti-aliased edge-profile consistency (the reach/margin/contrast triple
already separated every faint class, and a hard edge is only counted as debris evidence, 3b); a
regularity test (like-mark count or size spread) for stipple. The count and size-spread
distributions above are the same for the owl and for random dust, so such a test would either keep
the dust or delete the owl's texture. Dark clustered noise that is grey-bridged to the art, or that
sits in a tile with no debris, still passes. That is the residue measured below.

### Measurements

Bake-off, one timing run each. "Main" is origin/main `fa8939b` (before ADR-395). "First" is the
first version of this policy (tone tests plus "any ink within 5 px"). "Final" is this record's
rule set. Both are on the ADR-395 base, so they include ADR-395's smaller effect (about +0.012 owl
Line Art IoU). Census cells give two counts: blobs retained at all, then blobs whose traced area is
within 50% of the source blob (abs50).

| Measure | Main | First | Final | Potrace 1.16 (-t 2) |
|---|---|---|---|---|
| Owl IoU vs iso reference, Line Art | 0.8655 | 0.9057 | 0.9050 | 0.8916 |
| Hummingbird IoU, Line Art | 0.8147 | 0.8619 | 0.8616 | 0.8901 |
| Owl / hummingbird IoU, Smooth | 0.8389 / 0.8204 | 0.8792 / 0.8777 | 0.8787 / 0.8768 | |
| Owl census 3-8 px², retained / abs50, Line Art | 9 / 6 | 1,439 / 845 | 1,321 / 778 | 1,809 / 1,523 |
| Same, Potrace on our Line Art mask | 12 / 7 | 1,795 / 1,531 | 1,577 / 1,335 | |
| Owl census 9-32 px², retained / abs50 | 189 / 181 | 363 / 350 | 363 / 350 | 359 / 353 |
| Hummingbird census 3-8 px², retained / abs50 | 270 / 263 | 1,291 / 1,144 | 1,254 / 1,112 | 1,783 / 1,575 |
| Owl ROI IoU stipple swatch / crosshatch / wing stipple | 0.863 / 0.896 / 0.843 | 0.912 / 0.896 / 0.891 | 0.912 / 0.896 / 0.887 | 0.912 / 0.845 / 0.881 |
| Speckle fixture, clean and scan: dots kept, noise specks kept | 12/12, 0/80 | 12/12, 0/80 | 12/12, 0/80 | 12/12, 40/80 |
| Speckle fixture, Smooth: dots kept | 0/12 | 12/12 | 12/12 | |
| small-features clean, parts missed (ink 9 px² / holes 4 px² / 1-px line 10 px) | 20 (0/3, 0/2, 0/1) | 14 (3/3, 2/2, 1/1) | 18 (0/3, 2/2, 0/1) | 10 |
| topology (2-px checkerboard) missed, clean / scan | 32 / 32 | 0 / 0 | 0 / 0 | 0 / 0 |
| text-small missed, clean / scan | 27 / 44 | 10 / 35 | 10 / 35 | 0 / 27 |
| text-small missed, Smooth, clean / scan | 17 / 17 | 0 / 14 | 0 / 14 | |
| perf-mosaic-4000 missed truth contours | 616 | 376 | 386 | 40 |
| Spurious contours on the fixtures above, Line Art | 0 | 0 | 0 | |

Dark-noise probes (`preprocessForTrace`, Line Art, components after cleanup):

| Probe | No cleanup | Fixed 12 px² | First | Final |
|---|---|---|---|---|
| 24 black 2x2 toner specks 2-4 px from a 5-px stroke, clean and ±8 noise | 25 | 1 | 25 | 1 |
| 25 black 1-9 px² specks in a 40x40 px area | 17 | 3 | 13 | 3 |
| 512² scan, 25 strokes + 2,500 black 1-9 px² specks | 2,041 | 171 | 1,457 | 183 |
| 2048² scan, 400 strokes + 40,000 black 1-9 px² specks | 31,045 | 2,206 | 21,989 | 2,507 |

On the dirty scans the final rule keeps about 1% of the specks the fixed rule removes (12 of 1,870
and 301 of 28,839). These are 8-11 px² specks or like-supported pairs in debris-free tiles.

Cost of the mask stage (median of 5, native grid): owl 1254² 303 ms fixed, 362 ms first, 411 ms
final; hummingbird 289 / 341 / 390 ms; 2048² dirty scan 496 / 602 / about 740 ms. Whole-trace time
(single runs) rises with the outlines kept: owl Line Art 5.3 s on main, 7.1 s first, 8.0 s final;
hummingbird 4.3 / 4.4 / 5.1 s.

A synthetic JPEG-like scan (±8 colour noise, faint specks luma 150-220 beside the art) keeps every
dark stipple dot and gains no speck. A mid-grey patch with noise straddling the cut yields no marks.
The Arch House source keeps its input-mask IoU gate (the crack holes are still filled). Regression
tests for all of these are in `small-mark-policy.test.ts`.

### Consequences

- Dark noise is judged by what surrounds it, not by tone. Toner scatter in a stroke's halo, dust
  clusters with sub-floor specks and dirty-scan backgrounds come out as under the fixed rule (probes
  above). Dark noise that is grey-bridged to the art, or sits in a debris-free tile beside another
  small mark, still passes. So "no spurious contours" holds on the bake-off fixtures and on the
  probes above, not for every possible scan.
- The dust veto costs genuine detail wherever a drawing has hard sub-floor or lone specks nearby.
  On the owl the 3-8 px² census drops from 1,439 to 1,321 retained (73% of Potrace; abs50 778 vs
  1,523). The small-features fixture loses its lone 3x3 squares and 10-px line again, because the
  fixture's lone 1x1, 1x2 and 2x2 squares next to them are exactly what dust looks like. The 90% of
  Potrace owl retention target is not met. Part of the gap is still the contour finisher, which
  smooths tiny loops below half their blob, and part is this veto.
- The hummingbird stays below Potrace (0.8616 vs 0.8901) because Line Art takes the colour
  local-contrast path on a dense-colour downscaled grid; on the same image's luma it scores 0.9073.
  That gap belongs to the colour/scale policy, not the small-mark stage.
- Isolated 2x2 ink squares (small-features ink-area-4) are still removed; they are indistinguishable
  from the speckle fixture's noise, and the noise result wins.
- The decode cap is still invisible to the core: a 4000 px file decoded to 2048 px is judged in
  decoded pixels.
- The zero-paths retry (`relaxAggressivePreprocessing`) now removes `smallMarkPolicy` together with
  `despeckleMinPixels`. Otherwise an unset despeckle would mean "automatic" again and the retry
  would repeat the same cleanup. `hasAggressivePreprocessing` counts the policy as a lever.
  Small-mark-only art that the policy empties (a sparse grid of 3x2 dots) recovers on the retry, as it did under the
  fixed rule.
- The Trace dialog still shows the unset controls as "Remove ink specks 0" and an unchecked "Fill
  tiny holes". The tooltips now say what each state does. A typed value, 0 included, is exact. Line
  Art and Smooth show 0 or unticked until the user sets a value and judge automatically meanwhile.
  The dialog cannot yet show or restore an "Auto" state (tri-state control). That belongs to the
  dialog owners and should land before or with this default.
- Tests that pinned the fixed-area erasure are updated: the Line Art and Smooth 2-px checkerboard is
  now kept at half the board (never welded), the Centerline connectivity test pins the fixed rule
  with an explicit 12 and asserts the automatic result separately, and the dialog tests expect the
  unset controls.
