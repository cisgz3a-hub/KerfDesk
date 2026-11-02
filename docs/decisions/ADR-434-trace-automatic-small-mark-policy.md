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

Bake-off, one timing run each. "Main" is origin/main `fa8939b` (before ADR-403). "First" is the
first version of this policy (tone tests plus "any ink within 5 px"). "Final" is this record's
rule set. Both are on the ADR-403 base, so they include ADR-403's smaller effect (about +0.012 owl
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
- The Trace dialog first shipped this default showing the unset controls as "Remove ink specks 0"
  and an unchecked "Fill tiny holes". Amendment 1 replaces that with an Auto choice.
- Tests that pinned the fixed-area erasure are updated: the Line Art and Smooth 2-px checkerboard is
  now kept at half the board (never welded), the Centerline connectivity test pins the fixed rule
  with an explicit 12 and asserts the automatic result separately, and the dialog tests expect the
  unset controls.

### Amendment 1 - the dialog shows Auto, and a preset switch resets what the new preset defines (2026-09-27)

**Auto is a control state, not a stand-in number.** "Remove ink specks" and "Fill tiny holes" each
carry an Auto checkbox (`TraceAreaControls.tsx`, `TraceNumberRow.tsx`, `TraceCheckboxRow.tsx`).
The controls read the merged options (`smallMarkControlState`), so they show what the engine
receives:

- Auto ticked: the stage has no explicit value and `smallMarkPolicy` is `'auto'`. The number input
  is empty, disabled and says "Auto"; the Fill checkbox is indeterminate and disabled.
- Auto unticked: the value is exact. A typed 0 removes nothing; Off fills nothing; On fills every
  candidate. Leaving Auto on a preset whose own choice is Auto (Line Art, Smooth) starts "Remove
  ink specks" at 12 px² (`AUTO_CANDIDATE_AREA_PX`, Auto's candidate ceiling and Line Art's former
  fixed cut) and "Fill tiny holes" at Off. Leaving Auto on a fixed-cleanup preset (Centerline,
  Sharp) removes the override, so the preset's own value returns (Sharp's 1 px², Centerline's
  Fill On) and "Settings edited" clears.
- Auto is offered on every preset that shows the controls. On a preset whose own choice is Auto
  ticking it removes the override; elsewhere it stores the override `'auto'`, which the merge
  turns into "no explicit value, policy on" for that stage only. The engine automates every stage
  without an explicit value, so when `'auto'` switches the policy on for a preset that has none,
  the merge pins the other stage to the fixed value the preset ran with if the operator has not
  set it (`despeckleMinPixels` 0, `fillPinholeCracks` false when the preset leaves them unset).
  Ticking ink Auto on Sharp therefore leaves its holes stage at "fill nothing"; it never starts
  auto-filling cracks the preset exists to keep.

The engine and its model are unchanged.

**Persistence (ADR-408).** The override keys keep their names; their values widen to
`number | 'auto'` and `boolean | 'auto'`. `TRACE_OVERRIDE_RULES` marks both rules `auto: true`,
so `'auto'` restores as Auto, and records written before this amendment (plain numbers and
booleans) restore as the exact values they held. `'auto'` is rejected for every other control.
Colour layers' "Remove specks" shares `despeckleMinPixels` and reads `'auto'` as its preset area.

**Preset switch.** Overrides used to carry silently into the next preset, so a Smoothness tuned
for contours became Centerline's corner angle and an exact 12 px² from Centerline replaced Line
Art's Auto. Switching preset now drops an override of a shared control that the new preset
defines itself (`trace-preset-switch.ts`, applied by `useTraceDialogSettings.selectPreset`):
Smoothness, Optimize, Ignore Less Than, Remove ink specks (defined by an explicit value, the
automatic policy, or Colour layers' own speck rule), Fill tiny holes, and line Invert. Smoothness
and Optimize are also dropped whenever the switch crosses the Centerline boundary, where they
change role (ADR-405). An `'auto'` small-mark override is a switch that turns the policy on, not a
value, so every line preset counts as defining it: a Centerline Auto never carries into Sharp,
which chose fixed cleanup. Everything else still carries: settings the new preset leaves to the engine
default, detection choices and the alpha mask (they describe the source), and style-exclusive
controls (Photo, Colour layers, Edge), which only apply to their own style.

Tests: `TraceSmallMarkControls.semantic.test.tsx` (Auto and exact values through the real
controls and the engine, the switch rule, the Re-trace round trip, pre-amendment records) and
`use-trace-dialog-settings.test.tsx` (the dialog hook applies the switch rule to what it records).

### Amendment 2 - i-dots and full stops stay: the pen-width rule and the coverage floor (2026-10-28)

Quality audit Q4-P2-3 (P1, `docs/audits/2026-10-27-quality-q1/Q4-trace-vs-potrace.md`): Line Art's
automatic policy removed i-dots and full stops from ordinary 20-28 px text, Line Art being the Free
default. The audit's own render of "mini quiz. jig, ii. lit." kept 3 of 12, 8 of 11 and 2 of 11 small
marks at 20, 24 and 28 px (anti-aliased), and 7 of 12 on 1-bit 24 px; a lone "i" at 28 px lost its
dot. Potrace kept them all. The pages hold no dust, so this is not the trade-off the Consequences
accept. Two rules did it:

- **Rule 3d.** A tittle or a full stop sits nearer its letter's stroke than any like mark, which
  is what 3d reads as a stroke's halo. Yet 3d says small text passes.
- **Rule 1 on the 3x small-source grid.** Bilinear enlargement rounds a 4-5 px² anti-aliased dot,
  so its pixels past the cut count only 2.3-2.8 source px², under the 3 px² floor. On the native
  grid the same dots count 4.

Decision (`small-mark-policy.ts`, `small-mark-neighbourhood.ts`):

1. **Rule 3d, pen width.** A mark that 3d would remove because a stroke is nearer than any like
   mark now stays when it is about as wide as that stroke where it faces the mark. Its width is
   the diameter of a disc of its area. The stroke's width is the thinnest ink run, along the two
   axes and two diagonals, through each pixel of the stroke within half the support radius of its
   nearest pixel, the widest of those winning. Runs through an edge, a corner or a tip cut across
   the stroke at a slant or one pixel deep; a pixel on the stroke's middle line spans it, and that
   pixel lies within half a width of the nearest one. The mark stays at 0.6 of that width or more
   (`AUTO_PEN_WIDTH_FRACTION`). A tittle or a full stop is
   drawn with the letter's own pen; toner scatter is finer than the stroke it surrounds. Measured
   through the trace entry: 268 marks of Roboto text at 20-28 px, 1-bit and anti-aliased, 0.75 and
   up; the dark-noise probe's 2x2 specks beside a 5 px stroke, 0.45. Bridged, dusty, 8 px² and
   like-supported marks are decided as before.
2. **Rule 1, ink coverage.** A mark whose pixel count is under the floor stays a candidate when the
   ink it carries reaches the floor. That ink is each pixel's coverage, (paper − luma) / span
   clamped to [0, 1], summed over the mark and the paper pixels of its one-source-pixel ring, other
   ink left out. Hard sub-floor specks carry exactly their pixel count, so they still fall under
   it. The dust census (3b) sizes sub-floor debris the same way, so a rescued dot is not counted as
   dust against itself. Without a grey field (alpha masks) the pixel count is all there is, as
   before.

Measured through `traceImageToColoredPaths`, small marks kept by Line Art and by Smooth
(anti-aliased / 1-bit):

| Text | Before (Line Art) | After (Line Art and Smooth) |
|---|---|---|
| "mini quiz. jig, ii. lit." 20 px | 3 / 12, 11 / 12 | 12 / 12, 12 / 12 |
| same, 24 px | 8 / 11, 7 / 12 | 11 / 11, 12 / 12 |
| same, 28 px | 2 / 11, 9 / 11 | 11 / 11, 11 / 11 |
| lone "i", 28 px, anti-aliased | 0 / 1 | 1 / 1 |

Smooth's 1-bit losses before this amendment were the tied cut of ADR-402 Amendment 1, not these
rules. Every existing dust and noise regression in `small-mark-policy.test.ts` holds: toner scatter
beside a stroke (clean and ±8 noise), the dust cluster, the dirty-scan bound, the JPEG-like scan,
the mid-tone threshold noise, and the speckle fixture.

Consequence: a dark speck about as wide as the stroke beside it, in a tile with no debris, now stays
whatever made it. On small text that is the full stop the drawing has. Beside a thin stroke it
can be toner the old rule removed. The dust veto (3b) still removes such specks wherever the scan
leaves sub-floor or lone debris. On the astronaut photo Smooth now traces 134 subpaths instead of
121 at the same cut (101): small dark marks beside the photo's strokes.

Tests: `small-mark-policy.test.ts` (a mark as wide as its stem stays and the same mark beside a
stroke almost twice as wide does not; a full stop's grey rim lifts it over the floor and the bare
two pixels do not); `trace-automatic-decisions.test.ts` (every i-dot and full stop at 20, 24 and
28 px, 1-bit and anti-aliased, Line Art and Smooth; a lone "i" at 28 px).

### Amendment 3 - full stops away from ink, and every floor reads the ink a mark carries (2026-10-29)

Rolling audit v8 N8-P2-1 and N8-P2-2 (both P1; they reopen Q4-P2-3,
`docs/audits/2026-10-29-rolling-v8/N8-tracer-remeasure.md`): Line Art (the Free default) and
Smooth still deleted full stops from ordinary 20-28 px text, and i-dots from small 1-bit words.
Amendment 2's test sentence put every full stop beside an 'i' or a 'z'. A stop after a letter with
no ink at its foot ('y', 'T', '7') fell to four causes:

- **Self-veto (3b).** With no ink within 5 px, the stop was a "lone speck" in the dust census, and
  `debrisAround` summed the stop's own tile, so it was its own debris. Lone stops a few words
  apart were each other's debris too.
- **Pixel counts on the enlarged grid (3c, 3d).** Rule 3c (8 px²) and the pen-width disc read the
  thresholded pixel count, which shrinks on the 2x grid while the ink does not. A Roboto 28 px
  stop is 8 px² natively and 6.5-6.75 px² on the 2x grid. Arial "day." at 24 px measured a disc
  of 4.787 against a need of 4.8.
- **The floor's arithmetic (1).** On the 3x small-source grid a hard 3 px² tittle's coverage sums to
  26.999999999999989 against a floor of 27. It was dropped, and then counted as hard sub-floor
  debris against the stop beside it ("lit." at 20 px, 1-bit: 0 of 2 kept).
- **No rule for a lone stop.** Even without the veto, rule 3d has no stroke within 5 px to compare
  the stop with, so it removed it.

Decision (`small-mark-policy.ts`, `small-mark-neighbourhood.ts`, new `small-mark-text-line.ts`):

1. **Tolerant floors.** A size within 10⁻⁶ mask px under a floor is at the floor
   (`underFloor`, `FLOOR_TOLERANCE_PX`). The judge and the census use the same comparison.
2. **One size per mark.** Every floor reads the mark's size, its pixel count or, when larger, the
   ink it carries (Amendment 2's coverage). That covers the 3 px² floor, the 8 px² lone-mark floor
   of 3c, the census's sub-floor and lone-speck sizes, and the pen-width disc of 3d. Coverage is
   computed only where the pixel count alone cannot decide.
3. **Never dust against itself.** The census records the tile each debris component was counted
   in, and `debrisAround` leaves the mark's own entry out.
4. **Text baseline (new 3e).** A mark under the lone-mark floor stays when it is a compact, solid
   dot sitting on the baseline of a letter nearby. Such a dot is also not a lone speck in the
   census, so stops do not veto each other. The test:
   - Compact and solid: its box is at most 2:1 and its pixels fill at least half of it.
   - On a baseline: its bottom row is within one source pixel of the bottom row of another
     component that is 3-12 times its height.
   - Nearby: that component is found within 12 dot heights (about an em) on the rows around the
     dot's bottom edge.
   A speck in clean paper has no such letter. The dirty-scan probes' neighbours are other specks
   and 3 px strokes, too low to be letters beside a compact dot at least 2 px tall. The dust veto
   (3b) still runs first, so a stop beside real debris goes as before.

Arial itself is not shipped. The tests use the PDF importer's Arial-metric Liberation Sans; the
hinted-text measurement below used Windows Arial through Pango/FreeType (sharp).

Measured through `traceImageToColoredPaths` with the shipped presets, main `33bc394c6` → this
amendment:

| Case | Line Art | Smooth |
|---|---|---|
| Roboto, anti-aliased, 20 / 24 / 28 px: "Have a good day.", "Call us today." (final stop) | 0 / 6 → 6 / 6 | 0 / 6 → 6 / 6 |
| same: "Made in Italy." (stop and tittle) | 3 / 6 → 6 / 6 | 3 / 6 → 6 / 6 |
| same: "easy. any. say. buy. dry." | 0 / 15 → 15 / 15 | 0 / 15 → 15 / 15 |
| same: "big jig. bag. dog. pug. egg." | 13 / 24 → 24 / 24 | 14 / 24 → 24 / 24 |
| Hinted Arial (Pango/FreeType), final stop of 8 sentences × 3 sizes | 12 / 24 → 24 / 24 | 12 / 24 → 24 / 24 |
| Hinted Roboto / Calibri / Verdana, same | 2 / 19 / 24 → 24 / 24 / 24 | the same |
| "so X." after 61 characters, 20 + 24 + 28 px, anti-aliased, Roboto / Tinos | 146 / 169 → 183 / 180 of 183 | 143 / 173 → 183 / 183 |
| same, 1-bit, Roboto / Tinos | 163 / 175 → 183 / 182 | 159 / 175 → 183 / 182 |
| 192 small 1-bit words (i, lit., mini., jig.; 18-24 px; 4 placements) | 265 → 355 of 492 marks | 346 → 357 |

Potrace 1.16 keeps every stop above, and 435 of the 492 small-word marks. Sharp keeps every stop.
The three Tinos 20 px strip stops Line Art "loses" are in the output: they trace as 2 px loops
that cover less than half of the stop's pixel centres. Judged on the glyph's own 4 x 4 samples,
as the new test does, all 183 are kept.

Nothing else moved:

- **Q4 scorecard.** The 79-image set against Potrace gives identical per-image metrics (80 of 80
  rows): Line Art 51 / 20 / 8, Sharp 49 / 22 / 8, Smooth 55 / 17 / 7.
- **Q5 real cases.** The 27 degraded real cases: A (Line Art against plain Potrace) 23 / 3 / 1 and
  B (Smooth against mkbitmap + Potrace) 26 / 1 / 0, both unchanged; C (best against best)
  23 / 3 / 1 → 24 / 2 / 1. 10 of 160 rows changed, each a logo part regained (lost 1 → 0). No row
  added a mark, and the 48 Arch House stability rows are identical.
- **Dark-noise probes** (`preprocessForTrace`, Line Art components):
  - toner scatter, clean and noisy: 1 and 1;
  - the dust cluster: 3;
  - the 512² dirty scan: 182;
  - the 2048² dirty scan: 2,715 → 2,717 of about 30,000 specks;
  - three text lines with 60 lone 3-7 px² hard specks in the clean paper around them: 4 / 5 / 5
    specks kept, before and after.
  Every dust and noise regression in `small-mark-policy.test.ts` holds.
- **Cost.** No measurable change: 2048² dirty scan, median of four alternating runs, 3.9 s before
  and 3.6 s after on a busy machine.

Considered and not used:

- **An x-height test for i-dots.** No i-dot in the measured sets failed once the floors,
  self-exclusion and sizes were fixed; a tittle sits within the support radius of its stem.
- **Keeping a glyph's own sub-floor pieces out of the census.** This is audit N8's K3: a 2 px²
  tittle or a 1 px descender tip is a real sub-floor speck, and this ADR's Consequences accept the
  veto it casts. It is most of the remaining gap to Potrace on the small-word sweep. Tinos "lit."
  at 20 px, 1-bit, still keeps 0 of 2 (its tittle is 2 px²; Potrace keeps the stop).

Consequence: a compact dark dot on the baseline of a letter, within about an em of it, now stays
whatever made it. A speck that lands there is indistinguishable from a full stop, and Potrace keeps
both. The dust veto still removes it wherever the scan leaves sub-floor or lone debris nearby.

Tests:
- `small-mark-policy.test.ts`:
  - a lone dot carrying a 3x3 dot of ink stays, and its bare 2x3 core does not;
  - a lone dot on a letter's baseline stays, and the same dot off the baseline or far from text
    does not;
  - three baseline stops in each other's debris tiles all stay.
- `src/__fixtures__/perceptual/trace-full-stops.test.ts`:
  - the final stop of everyday sentences in Roboto, Tinos and Liberation Sans at 20, 24 and 28 px;
  - the 61-character strip in Roboto and Tinos;
  - 1-bit "lit." at 20 px.

  All of them fail on main `33bc394c6`.

### Amendment 4 - text marks at any angle: turned baselines, colons, stops past descenders (2026-11-02)

Rolling audit v9 R2-P1-2 and R2-P1-3 (both P1, `docs/audits/2026-11-02-rolling-v9/R2-tracer-remeasure.md`):
Amendment 3's text-baseline rule read only horizontal lines, and three kinds of mark still fell.

- **Turned text.** A letter's box bottom is its foot only when upright. Past a few degrees the rule
  found no baseline, and the stop was a lone speck. An upside-down scan's stops sit at the top of
  their letters.
- **A colon.** Its top dot sits on no baseline, so it was a lone speck, and as debris it vetoed the
  bottom dot, which was on one. Amendment 3's Decision 4 fixed this between stops, not between the
  two dots of one character.
- **A stop past descenders ("spy.", "happy.", the refuter's open question).** Reach is 12 dot heights.
  Hinted Arial 22-26 px gives a 2 px tall stop, so 24 px, and "py" is about 25 px. The 's' was out
  of reach, and 'p' and 'y' do not end on the baseline. So the rule's reach and its letter's foot
  failed together, not the 's' itself.

On 1-bit art two further causes showed in the probes: a hinted colon's top dot can be 2 px²
(under the floor, and hard sub-floor debris against the bottom dot), and a letter's own sub-floor
piece (a tittle, a tail's tip) vetoed the marks around it. Amendment 3 left that as audit N8's K3.

Decision (`small-mark-text-line.ts`, new `small-mark-text-direction.ts`, `small-mark-neighbourhood.ts`,
`small-mark-policy.ts`):

1. **The text's direction comes from its letters.** Each letter-sized component (longer side 6-54
   source px) keeps its convex hull's support in each of 180 directions, 2° apart. In the tile
   around a mark, the direction where the most feet fall within one source pixel of each other is
   how the text runs. The mark plays no part in that vote. Two letters always share a tangent, so a
   line fitted through a speck would pass almost any speck beside text.
2. **Rule 3e reads that direction.** A compact, solid dot is on a baseline when its foot is within
   one source pixel of the foot of a letter 3-12 times its height, within 12 dot heights, along a
   direction at or within 20% of the best vote.
   - Where three or more letters name the direction, one letter is enough on the side with more
     feet, and two on the other side (its letters' heads), which is what reads upside-down text.
   - Where only two letters do, the direction must line up on both sides of the text and two letters
     must reach the dot's line. This is what removes the chance tangent.
   - **Letters that plainly run another way switch the upright rule off.** Without this, any letter's
     box bottom on a 90° page was one more place for a speck to line up.
3. **A stop past a descender.** Upright or along the text's direction, a dot just past a letter (at
   most 2 dot heights beyond its box), with its foot 55-92% down that letter, stays when the letter
   narrows there: its ink within 1.5 dot heights below the foot is at most 0.6 as wide as its ink
   above, and carries on at least that far. 'o', 'l' and 'T' fail this; 'y', 'p', 'g' and 'q' pass it.
4. **A colon's other dot.** A dot of about the same pixels (at most 2:1), straight above a dot on the
   baseline (at most 6 dot heights above it, leaning at most 0.3 of the distance between them), is a
   text mark, so neither vetoes the other. It also stays when under the 3 px² floor, the one
   exception to rule 1: on 1-bit art it is often a hinted 2 px².
5. **A letter's own piece is not debris.** A sub-floor speck within 2 source px of a letter-sized
   component is no longer counted in the census (3b). It is still removed by rule 1; it just no
   longer vetoes its neighbours. A dirty scan still leaves plenty of debris out on the paper.

Measured through `traceImageToColoredPaths`, main `54e0e19b8` → this amendment. Text is SVG through
sharp (Pango and librsvg), the mark drawn in its own colour so its ink is known, kept at 30% of its
ink (the refuter's method, rebuilt; the same set sizes). Potrace 1.16 on the 1-bit input, as a
separate test-only process.

| Full stops of 7 sentences, 6 fonts, 20-28 px (of 126) | Line Art AA | Line Art 1-bit | Smooth AA | Smooth 1-bit | Potrace 1-bit |
|---|---|---|---|---|---|
| 0° | 126 → 126 | 126 → 126 | 126 → 126 | 126 → 126 | 126 |
| 5° | 116 → **126** | 117 → **125** | 117 → **126** | 116 → **125** | 126 |
| 45° | 112 → **126** | 108 → **123** | 110 → **126** | 99 → **123** | 125 |
| 90° | 112 → **124** | 111 → **123** | 115 → **124** | 111 → **123** | 126 |
| 180° | 113 → **126** | 111 → **126** | 115 → **126** | 111 → **126** | 126 |

| Marks | Line Art AA | Line Art 1-bit | Smooth AA | Smooth 1-bit | Potrace 1-bit |
|---|---|---|---|---|---|
| "Scale 1:10", 8 fonts, 18-28 px, colon dots of 96 | 84 → 90 | 78 → 88 | 90 → 96 | 78 → 88 | 90 |
| 5 colon strings, 8 fonts, 16-32 px, of 640 | 571 → 577 | 556 → **593** | 625 → 633 | 555 → **597** | 584 |
| Stops after 6 descender strings, 8 fonts, 16-32 px, of 384 | 324 → 339 | 290 → 326 | 351 → 366 | 305 → 332 | 348 |

Line Art 1-bit colons now pass Potrace. Stops after descenders close most of the gap and do not
pass it. The loss that remains on Line Art anti-aliased is mostly at 16-18 px and in Courier New: the
policy keeps the mark and Line Art's fixed cut leaves almost none of it past the cut (Smooth keeps
those), or the strokes fall apart into pieces that really are debris.

Siblings, 6 fonts, 18-28 px, Line Art AA / 1-bit before → after, Potrace 1-bit last: colons 279 → 279 /
264 → 286 of 288 (274); semicolons 287 → 287 / 278 → 281 of 288 (283); commas 144 / 144 of 144 (144);
apostrophes 144 / 139 → 144 of 144 (129); quotation marks 384 / 382 → 384 of 384 (362); "!" 272 / 268 →
270 of 276 (264); "?" 242 / 234 of 242 (234); decimals 172 / 162 of 180 (162); stops after descenders
169 → 171 / 163 → 169 of 180 (169); rows of dots 314 / 291 → 294 of 324 (301).

**Dust did not come back, and on turned pages it fell.**

- **One speck on a clean page of two text lines, nothing to veto it** (the hardest case: 100 random
  places within 30 px of Roboto or Arial, 24 px, 3-6 px² hard specks; Line Art AA / 1-bit, kept):

  | Angle | Roboto | Arial |
  |---|---|---|
  | 0° | 13 → 14 / 15 → 15 | 9 → 10 / 10 → 11 |
  | 5° | 12 → 13 / 13 → 14 | 10 → 11 / 11 → 12 |
  | 45° | 8 → 5 / 12 → 8 | 17 → 13 / 18 → 13 |
  | 90° | 26 → 12 / 33 → 20 | 23 → 14 / 22 → 13 |
  | 180° | 6 → 6 / 7 → 7 | 13 → 13 / 13 → 13 |

  So 0° and 5° gain at most one speck in 100, from the descender and direction rules, and 45° and
  90° improve because the upright rule stops reading turned text. Potrace keeps all of them.
- **The audit's page: 60 hard specks around three text lines:** 2 of 60 kept, unchanged at 0°. Turned:
  5° 4 → 4, 45° 8 → 7, 90° 3 → 2, 180° 6 → 6.
- **Dark-noise probes** (`preprocessForTrace`, Line Art components): toner scatter 1 → 1; dust cluster
  3 → 3; 512² dirty scan 182 → 183; 2048² dirty scan 2,633 → 2,679 of 32,690; 2048² page of letter
  blocks turned 20° with 12,000 specks 5,488 → 5,501 of 13,732.
- Every dust and noise regression in `small-mark-policy.test.ts` holds.

Nothing else moved:

- **Q4 scorecard.** The 79-image set against Potrace gives identical per-image rows (80 of 80): Line Art
  51 / 20 / 8, Sharp 49 / 22 / 8, Smooth 55 / 17 / 7.
- **Q5 real cases.** A (Line Art against plain Potrace) 23 / 3 / 1, B (Smooth against mkbitmap +
  Potrace) 26 / 1 / 0, C (best against best) 24 / 2 / 1, all unchanged. 2 of 160 rows changed, each a
  logo part regained (Line Art `ramp40` lost 3 → 2, `paper` lost 1 → 0).
- **Cost, mask stage, median of 3, run side by side on a busy machine:** 512² dirty scan 144 → 259 ms;
  2048² dirty scan 1,978 → 2,703 ms; the turned dirty page 1,698 → 2,391 ms. About 40% on a page
  full of dust; the sweep's sort is most of it. A speck with no letter in reach never pays for a sweep.

Considered and not used:

- **A compact dot within an em of letter-sized ink, the veto still first** (the audit's second
  direction). It would keep every speck near text. The single-speck test exists to catch that.
- **Fitting a line through the dot and the letters beside it.** Any two letters share a tangent, so
  in a paragraph almost any speck finds a pair. The direction has to come from the letters alone.
- **Requiring two letters on every turned line.** It costs real stops (45° 126 → 122, 90° 124 → 119 on
  anti-aliased), and the single-speck test barely moved on the angles it was run at.
- **A wider reach than 12 dot heights.** It would fix "spy." and put more specks on the baseline
  rule; "happy." needs more than an em anyway.
- **A 3 px glyph-piece gap.** It kept no more marks and added dust (2048² dirty scan 2,679 → 2,705).

Consequences:

- A dot on a line of text at any angle now stays whatever made it, as Amendment 3 already accepted for
  upright text, and Potrace keeps both. The dust veto still removes it wherever the scan leaves debris.
- A speck in a colon's place, or just past a descender at the baseline, is indistinguishable from the
  mark and stays.
- A turned word of one letter and a stop ("y." at 45°, "a." at 90°) has no direction to read. Its stop
  goes unless a neighbouring line names one. Upright, "y." is kept.
- Hinted 18-22 px marks stay below a clean sweep. `trace-text-marks.test.ts` pins
  no loss from 24 px up and a measured ceiling under it, as a ratchet, not a claim that they are solved.
- A letter's sub-floor piece no longer vetoes marks nearby. On a dirty scan with very little debris out
  on the paper, a few more marks survive beside letters (the 2048² probe gains 46 components across all of this
  amendment's rules).

Tests:

- `small-mark-text-marks.test.ts`: a stop on a line turned 5-270° stays, and the same dot 6 px off the
  line at 0-180° goes; a line of specks with no letters goes at 0°, 30° and 90°; a row of specks in
  line with a baseline but out of reach goes; a colon stays at 0-180°, two stacked specks with no
  baseline go, and a speck too far above a stop goes; a stop past a descender stays and the same dot
  past a block goes; a sub-floor speck beside a letter does not veto a stop, and one on clean paper does.
- `src/__fixtures__/perceptual/trace-text-marks.test.ts`, through the Trace dialog's entry, Line Art and
  Smooth, anti-aliased and 1-bit: turned and skewed sentences; "Scale 1:10" at 18-28 px; turned colons;
  "spy.", "happy." and "y."; and one test per sibling family (`: ; , ' " ! ?`, i and j dots, decimals,
  stops after descenders, rows of dots) at 18-28 px. On main `54e0e19b8` these fail: every turned-line
  test, the colon and descender tests, and the colon, "!" and descender families. The other families
  and the skewed scan pass there too: they guard what already held, with their ceilings at the measured
  count.
