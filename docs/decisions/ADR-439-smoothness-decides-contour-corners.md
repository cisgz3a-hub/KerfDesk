## ADR-439 - Smoothness decides contour corners, before any smoothing (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This changes how the filled-contour tracer (Line Art, Sharp, Smooth, and the edge lane that shares
its finisher) finds corners. It does not change output, G-code, bounds or Frame contracts: the
tracer still returns closed rings with canonical curves (ADR-391).

### Context

The trace dialog's Smoothness uses LightBurn's 0 to 1.33 range, but on the base
(`claude/tracer-lead-potrace`, `fa8939b8d`) it only set the straight-run flattener and arc-noise
evening strength, `max(0, 6s - 5)`. Corners came from three places that ignored it: the corner
rebuild (`sharpenChainBends`), which only ran on loops of 260 to 4096 x pixelScale chain points;
a 60 and 50 degree windowed detector on larger measured loops; and hard-turn pins in the sparse
stages. Taubin pre-smoothing ran before all of them. Measured on the base:

- Binary squares from 6 to 64 px lost 0.43 to 0.47 px at every corner in Sharp and 0.33 to 0.34 px
  in Line Art, at every Smoothness; 120 px squares were exact (they reach the rebuild's range).
- Smoothness 0 never gave the pixel polygon and 1.33 never removed corners: a 4x4 sprite traced as
  a rounded blob (0.48 px Hausdorff from its pixels) at every setting, while Potrace 1.16's `-a`
  (measured out of process as data) goes from 0.990 to 0.979 IoU across the same range.

### Decision

1. **One corner stage, on every loop.** `decideContourCorners` (`core/trace/contour-corners.ts`, with
   `contour-corner-lattice.ts` and `contour-corner-legs.ts`) runs on each loop's raw crack chain,
   binary or anti-aliased, of any length, before Taubin smoothing. Its apexes are spliced into the
   chain and pinned by reference through span-wise Taubin smoothing, curvature evening, arc-noise
   evening, flattening, simplification and the spline or cubic-fit tail. The size-limited rebuild
   and the windowed detector are no longer called by the contour finisher.
2. **Each candidate carries a rounding cost in source pixels; Smoothness sets one threshold**,
   `t(s) = 2 tan(22.5 degrees) x tan(90 degrees x s / (4/3))`. The slider is read as a fraction of
   a quarter turn and priced on the same tangent scale as the fillet costs below. Each constant is
   fixed by this design: the pole is the slider maximum 4/3 (LightBurn's range), where the quarter
   turn's tangent is unbounded (no corners); the scale 2 tan(22.5 degrees) puts the neutral default
   s = 1 (67.5 degrees) at exactly 2 px, the fillet gap of a right angle with ~5 px legs; s = 0 gives
   0. A candidate is a corner when its cost exceeds t. Candidates come from:
   - every turn of a binary pixel staircase at native resolution, costing at least
     tan(22.5 degrees) = 0.414 px, so any threshold below that keeps every pixel corner (s = 0 is
     the exact pixel polygon). That threshold is reached at s = 0.39, so the pixel-staircase plateau
     is the bottom 30% of the slider. A supersampled mask (Line Art and Smooth on small sources)
     never uses this regime: its steps are the upscaler's rounding, not source pixels, and keeping
     them would round the corners the leg candidates place exactly. There, s = 0 keeps every
     compatible feature and leg corner;
   - pixel features: a run the staircase U-turns around (same-sign turns at both ends) that is no
     longer than the runs flanking its sides, unless it is the tip of a one-pixel staircase, or the
     circle fitted to its surroundings (never through the cap and its sides) explains those
     surroundings to 0.35 px RMS and passes within 0.75 px of every cap crack. That last case is a
     digitized circle's own extreme: a disc centred on a pixel centre ends in one-pixel nipples,
     and an off-centre one in short caps a pixel proud of a longer row. A tooth on a straight edge
     stands 1 px off the line, and a square's cap has only a straight run beyond its sides, which
     fits no circle. A feature's cost is its height (the shorter side), since smoothing melts it
     entirely;
   - leg corners: two straight legs meeting at 15 degrees or more, the apex at their intersection,
     costing the fillet gap `min(leg) x tan(turn / 4)`, capped at 10 x (one-circle RMS residual minus
     two-leg RMS residual) so a digitized or wobbly arc never pays a corner's price.

   Selection is greedy by cost; a corner whose apex lies inside a costlier corner's legs is dropped.
3. **Measured (anti-aliased) loops** allow their apex 0.3 + 0.15 / sin(interior / 2) px from the
   chain (binary loops 0.9 + 0.5 / sin), and reject an apex whose swapped region contains a source
   pixel centre, since the chain is the field's own iso-line. A box filter rounds a true corner
   further than that: its half-coverage iso-line recedes 0.25 / tan(interior / 2) px from the apex,
   and the crack chord near the tip cuts up to 0.3 / sin(interior / 2) px more. A threshold off half
   coverage (Otsu puts Sharp and Smooth at 97 of 255 on the anti-aliased calibration rectangle)
   recedes the tip a little further, so the allowance takes another 0.1 / sin(interior / 2) px. An
   apex out to that allowance, or over a pixel centre, stands only when the pre-threshold field
   confirms it (`contour-corner-field.ts`): the box-filtered wedge the two legs bound must predict
   each source pixel's coverage within 0.2 (mean 0.05) over the pixels within 2 px of the apex, with
   paper and ink levels read 1.25 px off each leg. Each leg is first moved onto the drawn edge its
   field profile implies (the coverage integral across the leg, 2 px either side), so an iso-line
   off half coverage still matches. On a supersampled field (Line Art and Smooth trace small
   sources at 2x through the pixel-centre bilinear enlargement) each field pixel is compared with
   the same bilinear blend of the source pixels' box coverages, and the levels are read 1 source px
   further off. A rounded or organic tip leaves paper where the wedge predicts ink and a
   neighbouring outline adds ink, so most organic candidates fail: on the owl, 641 of 24420 field
   checks confirm on Line Art (2.6 %), 1455 of 56574 on Sharp and 640 of 23627 on Smooth; on the
   hummingbird 141 of 11506, 447 of 32160 and 138 of 11345. Those that pass do change the output. The check needs 48 luma of paper-to-ink
   contrast; paler art (the same anti-aliased wedge in luma 210 ink on 255 paper) is never
   confirmed and keeps the tight allowance, as before this amendment. In selection, a measured leg
   at least 3 x (2 + 1) source-pixel lengths of cracks long (9 cracks at 1x, 18 at 2x) is trimmed by
   one source pixel's length of cracks at its far end: a turn stop can sit one crack past an
   anti-aliased tip's peak, so the next corner's leg wraps round that tip.
4. **Pixel-exact contacts.** An exact apex on a lattice vertex where ink touches only diagonally is
   moved 1/128 px into its own corner, so the topology repair does not strip the corners of two
   touching sprite pixels.
5. **Where the flattener will straighten wobble** (binary loops, s above about 0.83), apexes are
   re-seated on legs grown at the flattener's amplitude, and loops with corners are flattened once on
   the dense chain before simplification as well as after. Corner-free loops skip the dense pass so
   circles are not cut into secants.

Hoshyari et al. 2018 (perception-driven semi-structured boundary vectorization) suggested pricing
corner against smooth for each candidate. The cap rule, the leg model, the fillet-gap cost, the
circle cap, the circle test on caps (Kåsa 1976 least-squares circle) and the quarter-turn dial are
this change's own design. No Potrace source was read. The dial's first form, `(2/3) s / (4/3 - s)`,
was replaced in review. It had no independent derivation, and its hyperbolic shape with a pole at
4/3 resembled the published Potrace paper's corner criterion. The tangent form keeps the same
endpoints (0, 2 px at s = 1, unbounded at 4/3) from its own derivation above.

### Measurements

The claims below are for binary sources traced with Line Art and Sharp; Smooth is a follow-up (see
Consequences). Apex gap in px (largest distance from a true corner to the traced outline), app path
(`traceImageToColoredPaths`), each preset at its own Smoothness, base then this change; Potrace 1.16
`-t 2 -O 0.2` on the same pixels:

| Shape | Line Art | Sharp | Potrace a=0.5 | Potrace a=1 |
|---|---|---|---|---|
| square 6 px | 0.338 -> 0.002 | 0.471 -> 0.000 | 0.000 | 0.689 (round) |
| square 8 px | 0.335 -> 0.002 | 0.463 -> 0.000 | 0.000 | 0.000 |
| square 16 px | 0.327 -> 0.002 | 0.450 -> 0.000 | 0.000 | 0.000 |
| square 64 px | 0.336 -> 0.002 | 0.435 -> 0.000 | 0.000 | 0.000 |
| square 120 px | 0.000 -> 0.000 | 0.000 -> 0.000 | 0.000 | 0.000 |
| 45 degree square 8 px | 0.633 -> 0.195 | 0.752 -> 0.205 | 0.701 | 0.701 |
| 45 degree square 64 px | 1.015 -> 0.173 | 0.081 -> 0.173 | 0.173 | 0.173 |
| 30 degree wedge | 0.396 -> 0.182 | 0.439 -> 0.300 | 0.448 | 0.448 |
| 60 degree wedge (direct, s=1) | 0.872 -> 0.041 | 0.895 -> 0.700 | 0.806 | 1.599 |
| 120 degree wedge (direct, s=1) | 2.069 -> 0.637 | 2.069 -> 1.825 | 1.612 | 1.612 |

A 45 degree apex can only be located to within its digitization; ours matches or beats Potrace
there. The small 60 and 120 degree wedges traced through Line Art's supersampled route are unchanged
(0.817 and 2.151): the supersampled field rounds those tips beyond the measured standoff.

Smoothness sweep (binary, direct): squares from 4 px are exact at s = 0 and s = 1 and have no
corners at s = 1.33 (0.46 to 2.4 px rounding); the base gave 0.43 to 0.48 px at every s.
Decided-corner counts never rise with s on a 134-step grid for 30 shapes (squares 4 to 120 px,
45 degree squares, 30/60/120 degree wedges, discs r = 4 to 60 at two centre offsets, an L sprite,
the face sprite and a row of one-pixel teeth). Discs r = 4 to 60 get no corner at s = 1.

Small sources on Line Art's supersampled route (squares with a 10 px margin): at s = 0 to 0.5 the
6, 8 and 16 px squares had 0.338, 0.335 and 0.327 px apex gaps (rounder than at s = 1, where they
are 0.002) and now have 0.025, 0.023 and 0.011. The 4x4 sprite goes 0.455 -> 0.099 px and the 3 px
L 0.437 -> 0.102 px (Hausdorff to the pixels). A 2 px L gets 0.799 px, its value at every s: see
Consequences.

Digitized circles at Sharp's own Smoothness (0.55): a sweep of r = 4 to 30, fifteen centre offsets
and s = 0.45, 0.55, 0.75 and 1 found corners in 577 of 1620 cases on the first version of this
change and 22 now, all on discs of radius 8 or less. On the review grid (r = 4 to 24, offsets 0,
0.37 and 0.5), only r = 4 at offset 0.37 still gets corners (2): an 8 px disc is as much an octagon
as a circle in pixels. Largest radial deviation of the traced vertices from the true circle, first
version then now: r = 5 offset 0.5 0.966 -> 0.424, r = 4 offset 0.5 0.528 -> 0.313, r = 24 offset
0.37 0.623 -> 0.498 (the base: 0.424, 0.313 and 0.498). Potrace a = 0.5 puts 4, 2 and 3 corners
on r = 4, 6 and 8, and none from r = 20.

Sprites at s = 0 (Sharp, Hausdorff distance from the pixel boundary): 4x4 0.481 -> 0.000, L-shape
0.542 -> 0.000, 10x10 face with diagonal contacts 0.685 -> 0.008 (the saddle step), the same under
all three saddle policies (auto, connect-ink, connect-paper; ADR-403).

Real art (owl 1254 px, hummingbird), potrace bake-off, IoU against the 4x iso-contour reference
(Potrace 1.16 defaults: owl 0.8916, hummingbird 0.8901), main then this change:

| Image | Line Art | Sharp | Smooth |
|---|---|---|---|
| owl | 0.8655 -> 0.8780 | 0.9164 -> 0.9169 | 0.8389 -> 0.8508 |
| hummingbird | 0.8147 -> 0.8322 | 0.9129 -> 0.9130 | 0.8204 -> 0.8387 |

main includes other merged tracer work; against the first version of this change, Line Art and
Smooth are identical and Sharp moves by at most 0.0003.

Trace time, the app path, medians of three runs in two alternating rounds against the parent
commit: owl Line Art 4.2 -> 3.6 s, owl Sharp 6.3 -> 6.4 s (equal within noise; the first version
of this record claimed 7.4 -> 7.1 s, which did not reproduce), hummingbird Sharp 5.2 -> 3.8 s,
hummingbird Line Art 3.5 -> 2.8 s.

Jittered bars (18 angles and phases, Line Art): mean edge RMS 0.361 -> 0.143 px. The single-bar
straightness gate (contour-straightness.test) and the jittered-ring roundness gate still pass.

### Consequences

- `contourPolylinesFromMask` takes `cornerThresholdPx`; the edge lane (`edge-trace.ts`) passes its
  own Smoothness, so Edge Detection follows the same dial. The Edge Detection preset sets no
  Smoothness, so its default output is unchanged.
- The Smoothness hint now says what the dial does: "Low keeps sharp pixel corners; high rounds
  corners and smooths jagged edges." Sharp's preset comment says the same.
- Sharp's 0.55 now maps to 0.627 px (first form: 0.468 px). Its pixel features (height 1 px or
  more) and drawn corners are kept; the weakest leg corners (cost 0.47 to 0.63 px) are not.
- Two touching exact squares now keep their 1 px gap exactly (contour-topology.test's golden moved
  from 0.110 to 1).
- `sharpen-bends.ts` and `bend-geometry.ts` are unchanged and still serve the centerline tracer.
- Follow-ups:
  - Smooth misses the square target at every s <= 1: 0.18 to 0.19 px apex gaps on 6 to 64 px
    squares (base 0.56 to 0.58). Its blurred field places straight edges about 0.13 px inside the
    pixel edge, which is edge placement, not a corner decision.
  - Line Art's supersampled route still rounds small acute wedge tips.
  - On a supersampled mask, a leg between two corners 4 source px apart runs into the next
    corner's rounding and tilts. A 2 px-cell L sprite's apexes overshoot by 0.8 px at every s.
  - Anti-aliased (measured) corners: the first form of this ADR blunted them against the parent
    commit (Line Art wedges 0.317 -> 1.793 px, stars 0.726 -> 1.871, rounded rectangles
    0.105 -> 0.730, the sub-pixel calibration rectangle 0.125 -> 0.763). Accurate apexes stood
    0.53 to 1.62 px off their chains, past the 0.512 px (at 90 degrees) tight standoff. The
    field-confirmed allowance (Decision 3) restores them. Bake-off, before -> after: wedges.clean
    1.803 -> 0.122, stars.clean 1.870 -> 0.074 (all 34 corners), rounded-rects.clean
    0.740 -> 0.105, calibration-subpixel-aa 0.752 -> 0.125, rotated-rects.clean 0.740 -> 0.118,
    shallow-edges.clean 0.716 -> 0.097, thin 100x20 / 100x8 0.818 / 0.968 -> 0.097 / 0.132.
    Binary fixtures and spurious-corner counts on the clean fixtures are unchanged. On the owl and
    hummingbird, outer, hole and component counts are unchanged, and IoU moves by at most -0.0001.
    Their reference is the rounded 0.5 iso-contour, which a true corner overshoots by design.
    The allowance alone, without the field check, cost up to 0.0036 IoU there and raised the owl
    Line Art's first-round topology conflicts from 75 to 190. With the field check they are 75 -> 77
    (Line Art), 3025 -> 3028 (Sharp) and 68 -> 69 (Smooth) on the owl, 68 -> 67, 1877 -> 1876 and
    62 -> 61 on the hummingbird (tight allowance only -> this design, same code otherwise).
  - Sharp and Smooth: the sub-pixel calibration rectangle goes 0.633 / 0.664 -> 0.386 px (main
    0.386), the 100x20 bar 0.633 / 0.730 -> 0.348 and the 100x8 bar 0.633 / 0.704 -> 0.306;
    rounded-rects.clean stays 0.155. The remaining 0.39 px is the Otsu iso-line's edge inset, not a
    corner decision.
  - Side effects on the calibration bars (Line Art, before this amendment -> after): each edge is
    now the line between two apexes, so apex bias moves the whole edge. calibration-subpixel-aa IoU
    0.9965 -> 0.9951, mean deviation 0.066 -> 0.093 px (Hausdorff 0.752 -> 0.126);
    calibration-thin-100x20-aa 0.9906 -> 0.9888, 0.080 -> 0.094 (0.818 -> 0.126);
    calibration-thin-100x8-aa 0.9812 -> 0.9716, 0.072 -> 0.107 (0.968 -> 0.250). Sharp and Smooth
    improve on all three. counter-letters.clean moves 0.9684 -> 0.9677 IoU on Line Art (apex error
    unchanged). Follow-up: fit the legs without the cracks nearest the tip, which the anti-aliased
    rounding pulls inward, so apex-to-apex edges keep the chain's ~0.07 px accuracy.
  - Scanned (noisy) variants gain less, and several stay behind main. Line Art, main -> this
    change (Potrace in brackets): rounded-rects.scan 0.037 -> 0.828 px (0.801), so the lead
    over Potrace is gone there; shallow-edges.scan 0.097 -> 1.106 (0.910), so it now trails
    Potrace; stars.scan 2.392 px with 2 spurious corners (main 1); stars-lowres.scan
    2.251 -> 2.350 px with 3 spurious corners (the dial parent: 3). Sharp and Smooth recover
    rounded-rects.scan to 0.108 px (dial parent 0.718 / 0.834). Scan noise makes the field check
    miss its thresholds, so a noisier candidate inside the tight standoff wins. With a looser check
    (0.25, mean 0.08), those fixtures have 0 extra spurious corners, but the owl loses up to 0.0005
    IoU. So the apex lead over Potrace is back on clean anti-aliased art in every preset, but not on
    scans.
  - Sharp's spurious corners on text, dial parent -> this change: text-large.clean 11 -> 13,
    text-lowres.scan 31 -> 33, text-lowres.clean 18 -> 17, counter-letters.scan 3 -> 2; the other
    text fixtures are equal.
  - Discs of radius 8 px or less can still take 1 to 4 corners at s = 0.45 to 0.75.
