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
### Sharp small-mark audit (2026-09-28)

The speckle.clean benchmark calls forty one-pixel and forty two-by-two-pixel marks
unwanted noise. Sharp explicitly preserves single-pixel marks for pixel artwork; its
old and new output both have 93 outlines and retain all twelve genuine 5 px dots.
The old rounded one-pixel shapes fell below the benchmark's 50 percent survival test,
while the new square marks survive at their intended size. Consequently noise-removal
IoU changes from 0.9891 to 0.9855 even though intentional pixel fidelity improves.
This is a preset tradeoff, not lost artwork. A public-entry regression verifies Sharp's
one- and two-pixel square boundaries within 0.01 px. Line Art and Smooth remove the
same nuisance marks and independently measure IoU 0.9980 and 0.9981 respectively.

### Amendment 1 - binary leg apexes are bounded by the ink (2026-10-28)

Quality audit Q4-P2-2 (`docs/audits/2026-10-27-quality-q1/Q4-trace-vs-potrace.md`):
- Corner apexes stood up to 3.4 px off the true outline, mostly on paper, at serifs and slanted
  terminals. Line Art drew 20 sharp nodes 1 px or more off the true outline on 8 of 15 glyph
  images, Sharp 29 on 12 and Smooth 5 on 1. Potrace 1.16 drew none.
- Decision 3 lets a binary leg apex stand (0.9 + 0.5 / sin(interior / 2)) px off the crack chain,
  2.8 px at a 30 degree interior. Decision 5 re-seats it on legs grown at the flattener's
  amplitude, up to 2 px further. Nothing checked either against the pixels.
- With ADR-530 Amendment 11, small two-level glyphs leave the measured route for this binary one,
  so Smooth drew 27 such nodes on 10 images.

**Decision** (`contour-corner-ink.ts`, `contour-corners.ts`):

- A binary leg apex, after re-seating, is dropped when it would change the class of a source pixel
  centre. The loop then rounds that turn.
- Pixel-centre sampling put every ink centre inside the drawn shape and every paper centre outside
  it. So the region a convex apex adds may hold no paper centre, and the region a reflex apex
  removes may hold no ink centre. Measured loops keep Decision 3's own pixel-centre and field test.
- The region lies between the cracks the corner replaces and the apex. The outline reaches the
  apex along the leg lines or, where the fit cuts across, along the chords from those cracks, so
  the region is the polygon of those cracks and the apex together with the triangle of the apex and
  the feet of the end cracks on the two leg lines.
- A centre within 0.1 px of either leg line does not count. A leg fitted to a staircase locates its
  edge only that closely: the correct corners a slack-free test dropped claimed centres 0.03 to
  0.09 px outside the true edge.
- A true acute tip passes however far it stands off the ink, because its wedge holds only paper the
  sampling never saw. This is the binary counterpart of Potrace's unit-square vertex bound
  (Selinger 2003, §2.3.1), from KerfDesk's own sampling argument; no Potrace source was read.

**Rejected, measured** on the Q4 ground-truth set:

- **A fixed distance cap**, such as 0.71 px (half a pixel diagonal) off the ink. Correct sharp tips
  stand up to 2.07 px off the ink (the 30 degree base corners of a 120 degree triangle), while
  spikes start at 0.84 px, so no cap separates them.
- **The chord polygon alone, without slack** (and with the fallback below). It scored Line Art
  53 / 16 / 10, but dropped one true corner each of the 17 degree turned square at 64 and 200 px
  and of the 60 and 120 degree triangles at 32 px.
- **The leg triangle alone, without slack.** It scored 50 / 16 / 13 and kept 228 of 331 corners,
  against 237.
- **Slack of 0.15 to 0.25 px.** It readmitted a 17 degree serif tip on Tinos R at 48 px, 4.0 px off
  the outline (3.7 px off the ink).
- **Keeping a corner at a corrected apex instead of dropping it.**
  - Falling back to the apex decided before re-seating readmitted spikes up to 2.7 px.
  - Pulling the apex toward the chain until it is consistent kept 31 false corners against 16, and
    Sharp scored 46 / 23 / 10 against 49 / 22 / 8.
  - Sliding it along the longer leg left glyph spikes up to 2.4 px.
  - Seating it on the nearest skipped crack, or on the nearest pixel corner, thinned binary 3 px
    bars by 11 to 15% of their area.
  - Pinning the cracks at the dropped corner's ends made Smooth's 3 px bar 12.6% too large.

**Measurements** (ADR-530 Amendment 11 alone, then with this amendment). Sharp nodes turning
90 degrees or more that lie 1 px or more off the true outline:

| Preset | Main | Amendment 11 alone | Both |
|---|---|---|---|
| Line Art, 15 glyph images | 20 on 8, worst 3.37 px | 21 on 8, worst 2.99 px | 0 |
| Smooth, 15 glyph images | 5 on 1, worst 2.99 px | 27 on 10, worst 2.99 px | 0 |
| Sharp, 15 glyph images | 29 on 12, worst 1.95 px | 29 on 12, worst 1.95 px | 0 |
| Line Art, all 79 images | 26 | 37 | 2, at most 1.10 px off the ink |

The two left are a 3 px bar's end at 32 px (1.42 px off the outline, 0.84 px off the ink) and a
2 px bar's end at 200 px (1.01 px, 1.10 px).

Win / tie / lose against Potrace, true corners kept sharp (of 331; Potrace 143) and false corners
(Potrace 9), Amendment 11 alone then both:

| Preset | W / T / L | Corners kept | False corners |
|---|---|---|---|
| Line Art | 45 / 16 / 18 -> 51 / 20 / 8 | 240 -> 237 | 53 -> 16 |
| Smooth | 44 / 19 / 16 -> 55 / 17 / 7 | 224 -> 228 | 60 -> 12 |
| Sharp | 40 / 19 / 20 -> 49 / 22 / 8 | 274 -> 279 | 90 -> 36 |

Line Art keeps 45 of 46 corners at 200 px. Hausdorff distance to the true outline, Line Art over all
79: max 4.20 -> 1.89 px (main 3.37, Potrace 2.98), median 0.64 -> 0.59 px (Potrace 0.95).

**Follow-ups:**
- Smooth's binary 3 px bar at 30 degrees (`contour-thin-shapes.test.ts`) measures +8.5% area, against
  +3.1% on the 2x route before ADR-530 Amendment 11.
  - Its end apexes stood 2.3 px past the bar, off the ink, and are withdrawn. Smooth's simplification
    (1.8 px at Line Tolerance 2) then tilts one long side by up to 0.7 px; Line Art measures +1.7%.
  - The test's ceiling for that one cell is 9% instead of 8%. The owner is the binary tail's handling
    of a loop that lost a corner.
- The apex of a 30 degree triangle still lands 1.3 to 1.7 px short of the true tip at 32 and
  200 px. It did so before this amendment (main 1.66 px at 200 px).
- One 105 degree base corner of the 30 degree triangle at 32 px moves from 0.16 to 0.92 px.

### Amendment 2 - measured leg apexes are bounded by the field (2026-10-29)

Rolling audit v8 N8-P2-4 (`docs/audits/2026-10-29-rolling-v8/N8-tracer-remeasure.md`):

- Anti-aliased loops are measured and skipped Amendment 1's bound. On 72 glyph images (Tinos
  A M N V W k v x y z R K 4 7 and Roboto y v w A k K M W 4 7 at 24, 32 and 48 px), Line Art drew 7
  sharp nodes 1 px or more off the true outline on 7 images, Smooth 7 on 7 and Sharp 25 on 18.
  Potrace 1.16 drew none.
- The worst stood in pure paper: Line Art 1.69 px from any pixel with ink (Tinos N at 32 px), Sharp
  4.25 px (Tinos V at 48 px).
- They are serif ends. A serif's slab is about a pixel thick, and its top and bottom legs converge
  by 15 to 20 degrees, so they meet 2 to 4 px past its blunt end.
- Decision 3's loose allowance for such an acute apex is 0.25 / tan(interior / 2) +
  0.4 / sin(interior / 2), about 5 px at 15 degrees. The apex then needs the field's confirmation
  (`contour-corner-field.ts`). But a wedge that thin covers only about 0.1 to 0.15 of each pixel
  near its tip, inside the fit's 0.2 coverage tolerance, so the field confirmed it (on Tinos N at
  32 px the apex stood 2.5 px off the chain, past the tight allowance of 1.45 px).

**Decision** (`contour-corner-ink.ts`, `contour-corners.ts`):

- A measured leg apex is dropped when the field at the apex reads paper, and the loop then rounds
  that turn. Lattice apexes are exact and exempt, as in Amendment 1.
  - "Reads paper" means that the field, interpolated bilinearly between its pixel centres, is
    lighter than the paper level by less than 2% of the step from paper to ink.
  - The levels are the brightest and the darkest field pixels within 2 source px of the apex and
    of the cracks it replaces. The chain's ink side lies within a pixel of those cracks.
  - Below 48 luma of contrast the field cannot say, and the apex stays.
- **Why the field at the apex.**
  - A true tip's last pixels each hold some of its ink, and the bilinear field at the apex
    interpolates them: about 3% of the step for a 15 degree tip, more as the tip widens.
  - The apex of two legs extrapolated past a blunt end stands where every pixel within a pixel of
    it is paper.
  - It is the measured counterpart of Amendment 1. The pixel centres of an anti-aliased source do
    not bound a tip, because a thin true tip covers less than half of each pixel it crosses. The
    field's coverage does bound it.
- Binary loops keep Amendment 1.

**Rejected, measured:**

- **A cap on the apex's distance to the ink for binary loops,** to also catch the 1-bit spikes
  outside Amendment 1's 15 images. Amendment 1 measured it on the Q4 set, and the 72 glyph images
  agree. The 1-bit spikes left stand 0.72 to 2.37 px off the ink, while true binary tips stand up
  to 2.08 px off it: the 30 degree corners of the 120 degree triangle at 32 px.

**Measurements** (main `33bc394c6`, then this with ADR-530 Amendment 12):

| Anti-aliased, 72 glyph images | Main | This | Potrace |
|---|---|---|---|
| Line Art: sharp nodes 1 px or more off the outline | 7 on 7 | 0 | 0 |
| Smooth | 7 on 7 | 0 | 0 |
| Sharp | 25 on 18 | 0 | 0 |

- **Depth into paper.** This is the distance from a node to the nearest pixel with more than 2% ink.
  Over every node of anti-aliased Tinos A M N V W K R k v x y z 4 7 at 20 to 40 px, the deepest
  was:
  - Line Art 1.69 -> 0.45 px;
  - Smooth 1.69 -> 0.46 px;
  - Sharp 2.51 -> 0.47 px.
- **Anti-aliased Q4 set** (the 79 ground-truth shapes rendered with 8 x 8 coverage, Potrace on the
  same greymap):
  - win / tie / lose is unchanged: Line Art 69 / 10 / 0, Sharp 67 / 11 / 1, Smooth 66 / 10 / 3;
  - true corners kept sharp fall by two on each preset (225 -> 223, 295 -> 293, 219 -> 217), all on
    Tinos R at 24 px;
  - those were serif overshoots: that image's Hausdorff distance falls from 0.83 to 0.75 px on
    Line Art and Smooth.
- The clean binary Q4 set is unchanged in every metric. The 1-bit spikes on the 72 glyph images are
  unchanged too: 11 on 9, 11 on 9 and 5 on 5.
- Test: `contour-corner-ink.test.ts` traces anti-aliased Tinos A, K, M, N, R and W at 24, 32 and
  40 px and allows no node more than 0.5 px into paper. On main it fails at every size.

**Follow-ups:**

- The 1-bit spikes outside Amendment 1's set remain, the worst Roboto A at 24 px (2.01 px off the
  outline, 2.37 px off the ink).
  - The legs of a narrow stroke's flat end meet in a needle that threads between paper centres, and
    true acute tips stand as far off the ink.
  - Neither the centre test nor a distance cap separates them. It needs another discriminator.
- On Sharp, which walks a JPEG natively, see ADR-530 Amendment 12's "Not part" list.

### Amendment 3 - the measured apex bound allows for the paper's own noise (2026-11-02)

Rolling audit v9 R2-P2-4 (`docs/audits/2026-11-02-rolling-v9/R2-tracer-remeasure.md`): after JPEG
quality 75 the anti-aliased serifs grew spikes again. Line Art and Smooth drew sharp nodes 1 px or
more off the outline on 4 of the 72 glyph images, Sharp 10 on 7; Tinos M at 32 px stood 2.5 px from
any pixel holding ink. Potrace drew none.

**Cause.** Amendment 2 drops a measured apex when the field there reads within 2% of the step of
the paper level, and took the paper level as the brightest pixel near the apex. JPEG ringing both
raises that brightest pixel and moves the field at a paper apex by more than 2% of the step (about
5 levels).

**Decision** (`contour-corner-ink.ts`): the paper level is the median of the window's levels on the
paper side of the middle, and an apex is dropped when the field there reads within the larger of 2%
of the step and 3 times the median distance of those paper levels from their median. Clean paper is
one level, so on clean art the test reads as it did.

**Measurements** (72 glyph images, sharp nodes 1 px or more off the outline):

| Input | Main: Line Art / Smooth / Sharp | This | Potrace |
|---|---|---|---|
| Anti-aliased | 0 / 0 / 0 | 0 / 0 / 0 | 0 |
| Anti-aliased, JPEG 75 | 4 on 4 / 4 on 4 / 10 on 7 (2.60 px) | 0 / 0 / 4 on 4 (1.35 px) | 0 |
| 1-bit | 11 on 9 / 11 on 9 / 5 on 5 | unchanged | 0 |
| 1-bit, JPEG 75 | 12 on 10 / 12 on 10 / 17 on 13 | 11 on 9 / 11 on 9 / 5 on 5 | 0 |

The 1-bit JPEG row is ADR-530 Amendment 13 (the JPEG traces as its clean art). The anti-aliased Q4
set is unchanged: 69 / 10 / 0, 67 / 11 / 1, 66 / 10 / 3.

Test: `contour-corner-ink.test.ts` traces Tinos A, M, N, V, k and x at 24, 32 and 48 px after
quality 75 and allows no Line Art or Smooth node more than 1 px from the clean glyph's ink.

**Follow-up:** Sharp keeps 4 anti-aliased JPEG nodes of 1.0 to 1.35 px. ADR-530 Amendment 12 lists
Sharp's native walk of a JPEG.

### Amendment 4 - binary apexes on a short leg are held to the chain's reach (2026-11-10)

Amendment 2's follow-up: on the 72 glyph images (Tinos A M N V W k v x y z R K 4 7 and Roboto
y v w A k K M W 4 7 at 24, 32 and 48 px), 1-bit at pixel centres, Line Art and Smooth drew 11 sharp
nodes 1 px or more off the true outline on 9 images and Sharp 5 on 5. The worst was Roboto A at
24 px, 2.01 px off the outline and 2.37 px off the ink. Potrace 1.16 drew none.

**Cause.** Every such node is a binary leg apex that passes Amendment 1, in one of two shapes:

- **A flat end.** A narrow stroke ends in a cut one or two pixels wide (Roboto A's foot, the foot
  of Tinos 7's stem, a Tinos K serif's end, the flat top of a W's middle peak). Its two sides
  converge and meet two to four pixels past the cut.
- **A short tilted face.** The top of Roboto y's or K's arm is a flat run of three pixels. Its leg
  runs on over the step into the next face, so the dial fits a 45 or 30 degree corner where the
  true one is 71 or 48 degrees, and places the apex a pixel above the flat.

Both needles thread between rows of paper centres, so Amendment 1's bound cannot see them. Under
pixel-centre sampling a wedge cut flat and a wedge with its tip sample the same pixels, and true
acute tips stand as far off the ink (2.07 to 2.08 px at the 30 degree corners of the 120 degree
triangle at 32 px).

**Measured discriminator: the shorter leg.** This was measured over every binary leg apex that
survives Amendment 1, on the 72 glyph images and the Q4 79-image set, in all three presets. A true
corner here is an apex under 0.5 px from the true outline and within 1.5 px of a true corner.

- True corners standing more than 1.1 px past the chain have a shorter leg of 11 cracks or more.
  Sharp's Tinos v at 32 px and M at 24 px have 11, the triangle and star tips 21 to 36.
- True corners with a shorter leg under 10 cracks stand at most 1.07 px past the chain (Roboto A
  and 7 at 48 px).
- The spikes' shorter legs have 5 to 8 cracks, and they stand 1.14 to 2.65 px past the chain.
  The exceptions are the long-legged ones under Follow-ups.
- The short leg is the cut itself, or a serif's face. Its direction comes from a run too short to
  place a tip that far out.

**Decision** (`contour-corner-reach.ts`, `contour-corners.ts`):

- A binary leg apex that Amendment 1 keeps is moved when two things hold:
  - its shorter leg has fewer than 10 cracks;
  - it stands more than 1.1 px from the cracks it replaces, measured as Decision 3 measures the
    standoff (`distanceToGap`).
  Both lengths are in source pixels (times the pixel scale).
- It moves along its longer leg's line, the better-determined one, to the farthest point the chain
  reaches along that line. That point is the least distance, along the longer leg from the apex,
  of the longer leg's last crack, the skipped cracks and the shorter leg's cracks. Beyond it only
  the shorter leg's direction claims ink. If the chain does not reach back toward the apex, the
  apex stays.
- The corner is kept, with its crack span and cost, so which corners exist and the count's
  monotonicity in Smoothness are unchanged. Lattice apexes and measured loops are untouched.

**Rejected, measured:**

- **One threshold on a single feature.** Candidates were the extrapolation over the leg length,
  the standoff alone, the wedge's width at the standoff, the end's width across the bisector, the
  gap's asymmetry and the acuteness. None removed more than 2 of the 11 Line Art spikes without
  also moving a true corner. With up to 5 true corners moved, the best (standoff over the
  shorter leg's length) removed 4.
- **Dropping the corner, as Amendment 1 does.** It removed the same spikes. But the binary tail
  then rounded the end of the Q4 bars and tilted a long side:
  - Smooth's 3 px bar at 32 px went from +0.8% to +18.6% area (tie to loss);
  - the 2 px bar at 200 px went from -0.01% to -5.2% (win to tie);
  - Smooth scored 56 / 15 / 8.
- **Moving the apex to the foot of the longer leg's last crack.** This cut 2 px off the 2 px bar's
  end (Hausdorff 1.22 -> 1.68 px).
- **Moving it before Amendment 1's test.** This moved apexes that Amendment 1 drops back into the
  outline. False corners rose from 10 to 25 on Line Art, and Sharp scored 44 / 24 / 11.
- **No leg condition.** Moving every apex more than 1.1 px out clipped the triangle tips. At 32 px
  the 120 degree triangle went from 0.19 to 1.84 px Hausdorff, and Line Art kept 234 corners
  against 236.
- **A shorter leg under 16 cracks.** This clipped true notches: Tinos 4 at 48 px went from 0.76 to
  1.57 px Hausdorff, and Sharp's Tinos v at 32 px from 0.35 to 1.16 px. Under 8 cracks kept three
  more spikes (Roboto k at 32 px; Sharp's Tinos k and K at 48 px).
- **A standoff of 0.9 or 1.0 px.** This moved true corners. At 1.0 px, Roboto A at 48 px went from
  1.17 to 1.27 px Hausdorff on Smooth. At 0.9 px, Roboto 7 at 48 px went from 0.61 to 1.60 px on
  Line Art, and Tinos W at 48 px's mean error from 0.148 to 0.208 px.

**Measurements** (main `8493f590c`, then this):

| 1-bit, 72 glyph images: sharp nodes 1 px or more off the outline | Main | This | Potrace |
|---|---|---|---|
| Line Art | 11 on 9, worst 2.01 px | 5 on 4, worst 1.51 px | 0 |
| Smooth | 11 on 9, worst 2.01 px | 5 on 4, worst 1.51 px | 0 |
| Sharp | 5 on 5, worst 1.42 px | 3 on 3, worst 1.16 px | 0 |

- **The same 72 images, scored as Q4 scores them** (Line Art / Smooth / Sharp):
  - glyph turns kept sharp, of 1134: 647 / 594 / 917 -> 647 / 595 / 919;
  - false corners: 14 / 12 / 28 -> 13 / 11 / 28;
  - median Hausdorff: 1.10 / 1.17 / 0.97 -> 1.08 / 1.11 / 0.93 px.
  The one image that got worse is Tinos A at 24 px: its 31% area error on Line Art rose to 33%, and
  its 35% on Smooth to 42%.
- **Held out.** These were not used to set the two thresholds, and no new spike appeared:
  - the same letters at 20, 28, 40 and 56 px: Line Art and Smooth 22 on 17 -> 18 on 14 (worst
    3.25 px, unchanged), Sharp 7 on 7 -> 6 on 6;
  - Tinos E F H L T X Z Y w h n and Roboto V N x z Z Y T L E at 24, 32 and 48 px: Line Art and
    Smooth 8 on 7 -> 5 on 4, Sharp 9 on 8 -> 8 on 7.
- **Q4 scorecard, 79 images** (win / tie / lose against Potrace):
  - Line Art 53 / 18 / 8 -> 54 / 18 / 7;
  - Sharp 49 / 22 / 8, unchanged;
  - Smooth 57 / 15 / 7 -> 58 / 14 / 7.
  True corners kept (236 / 279 / 228 of 331) and false corners (10 / 36 / 7) are unchanged. Only
  the bars change:
  - the 3 px bar at 32 px goes from 1.42 to 0.91 px Hausdorff: a loss becomes a win on Line Art,
    and a tie a win on Smooth;
  - the 2 px bar at 200 px goes from 1.22 to 1.29 px and from -0.01% to -0.51% area, and is still
    a win.
- The anti-aliased 72 images are unchanged: 0 / 0 / 0.
- Test: `contour-corner-reach.test.ts` traces 1-bit Roboto A and K at 24 px, Roboto k and y at
  32 px, Tinos 7 at 24 px and Tinos k at 48 px. It allows no node turning 90 degrees or more to
  stand 1 px or more off the true outline. On main every one of them fails.

**Follow-ups:**

- Five Line Art and Smooth nodes remain (1.07 to 1.51 px), all with legs long enough to place
  their apex as well as a true tip's:
  - the flat tops of Tinos W's middle peaks at 24 and 48 px (0.5 to 1 px wide; legs 13 to 36
    cracks);
  - Roboto 7 at 32 px (legs 16 and 33);
  - Tinos K at 48 px's lower serif. Its shorter leg has 8 cracks, but it stands only 0.92 px past
    the chain, inside the standoff, and lowering the standoff moves true corners.
- Sharp keeps Tinos W at 24 px, Tinos 7 at 48 px and Roboto M at 24 px.
- Only a prior can decide these. Type cuts its convex tips; geometric art does not.
