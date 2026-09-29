## ADR-530 - Traced contours reach the scene as compact curves (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This extends ADR-391, which kept the contour finisher's fitted cubics as canonical curves only for
measured loops of at least 260 chain points, and builds on ADR-439's corner dial. It changes the
finishing tail of the filled-contour tracer (Line Art, Smooth, Sharp) and of the Edge lane that
shares it. The tracer still returns closed rings with canonical curves; bounds, compile, Frame and
Start contracts (PROJECT.md non-negotiable 21, ADRs 228, 230, 232 and 237) are untouched.

### Context

Measured on the base (`claude/tl-geometry-core` at `4aa8bbde3`, ADR-439 applied) and on main
(`fa8939b8d`) with the Potrace bake-off harness (TRACE_AUDIT-gated, untracked; Potrace 1.16 run
out of process only to measure its output):

- **Only big measured loops were curves.** Every other loop (binary sources, short loops) left
  the simplify + Catmull-Rom tail as straight segments: a binary disc of radius 48 was 128 lines, a
  120 px square 16 lines. The analytic discs (radius 8 to 100, anti-aliased) were 207 segments, 196
  of them lines; Potrace draws them with 31 cubics.
- **Optimize was not monotone.** It only scaled the Douglas-Peucker epsilon and the fit tolerance;
  a wavy binary disc gave 104, 112, 100, 88, 92, 84 segments at Optimize 0, 0.2, 0.5, 1, 1.5, 2.
- **Thin shapes grew.** Any measured loop under 260 x pixelScale points took the legacy tail.
  Douglas-Peucker turns each corner of a bar into two ~45 degree vertices, the spline bows outward
  along every edge and its ±epsilon cap lets it sit ~0.3 px outside the ink: the thin-bars fixture
  gained 22% area (IoU 0.780 on main, 0.798 with ADR-439; Potrace 0.838), a 100 x 8 anti-aliased
  bar +8.3% area.
- **Curves were lost by copying.** The fitted cubics rode a WeakMap keyed by the sample array; the
  dense-colour downscale route rebuilt its polylines, so the hummingbird traced as 112,343 lines and
  0 cubics.
- The shared fitter accepted on the parametric residual, only split, and never merged: anti-aliased
  discs took 6 to 8 cubics where 3 or 4 suffice.

### Decision

1. **Compact fit for every loop** (`core/trace/compact-curve-fit.ts`, `compact-curve-span.ts`, own
   implementation). A ring becomes the fewest cubic and line segments whose orthogonal distance from
   the ring stays within one tolerance, then the least summed squared error among those:
   - Breaks: ADR-439's corners split the ring C0 with one-sided tangents (a parabola through the
     corner and the points one and two window-halves along, window 2 source px) and stay exact.
   - Candidate joints: a split-at-the-worst-point cubic fit at a candidate tolerance that never
     follows Optimize (0.75 x the tolerance Optimize 0 gives). Each joint gets one centred tangent
     (chord over ±2 source px), used by every segment that meets there, so two cubics meeting at a
     kept joint are exactly G1. A span whose worst point sits at its ends splits at its farthest
     point from the chord instead, so a badly missed span cannot peel one point per level.
   - Span error: the least-squares arm lengths along the fixed end tangents and the Newton
     point-to-curve projection are the shared ones in `core/geometry/cubic-fit.ts`
     (`solveTangentArms`, `newtonProjectionStep`, `chordParameterize`, `evaluateCubic`); the error
     is the centreline fit's two-way orthogonal error (`centerline/curve-fit-error.ts`): every chain
     point to the curve by projection, and curve samples every 0.5 px back to the chain. Up to four
     Newton reparameterization passes run while they lower the error; the curve-to-chain check runs
     on the pass kept. A cubic that crosses itself or cusps is rejected outright (infinite error):
     a closed-form test solves B(s) = B(t) for s != t through the sum and product of the two
     parameters (own derivation). Within tolerance such a loop is invisible to both distance
     checks; without the test Edge Detection drew one on a binary 3 px C-arc at Optimize 1 and 2.
   - Work bounds (ADR-530 review). The first version re-fitted every merge extension from scratch
     and made contour traces 2.5 to 3.4x slower than the tail it replaced. Now a single candidate
     piece is the proposal's own fit (same span, same joint tangents); a span straight within the
     tolerance that meets its joints along their tangents is its chord without a cubic fit; a merge
     extension whose chord-parameter first pass already misses by 3x the tolerance (screened on
     about 48 of its points when longer than 96) skips its Newton passes, and one whose best pass
     misses skips the curve-to-chain check. Whether a span fits still depends on nothing but the
     tolerance, so none of this changes which plans are feasible. The proposal always runs its
     Newton passes: their worst point is where it splits, and giving up early there left a disc at
     4 cubics for every Optimize and moved the R=900 commit-grid disc off round. The Newton step in
     `cubic-fit.ts` no longer allocates (same arithmetic, same bits).
   - Merge: a shortest-path search over the candidate joints, after the optimal-knot formulation of
     M. Plass and M. Stone, "Curve-fitting with piecewise parametric cubics" (SIGGRAPH 1983): fewest
     segments, then least error. From each joint a segment grows one candidate piece at a time (at
     most 24) and stops at the first extension that misses the tolerance or whose pieces turn in
     opposite directions (a piece turning less than 4 degrees is neutral), so no segment crosses an
     inflection or a corner. A single candidate piece is always allowed. A cornerless ring tries up
     to 48 candidate joints as its seam.
   - Lines: a span straight within the tolerance that leaves and meets its joints within 4 degrees
     of their tangents (or at corners) is one line segment. A single piece no cubic through its joint
     tangents fits, such as a long flattened chord between tilted joints, is its chord when that is
     closer, with no tangent check. So the outline is G1 within 4 degrees wherever a line meets a
     smooth joint, exactly G1 where two cubics meet, and only those chord fallbacks may kink.
   - Compatibility polyline: line ends only, about one vertex per 1.5 working px along cubics and
     never more than 0.02 working px from them (uniform parameter steps bounded by the cubic's
     second differences), every joint exact, ending on the start (no collinear samples along
     lines). The topology repair tests these samples, so exact curves can only overlap where the
     samples pass within 0.04 px of each other; the worst case found (two tips of a broken
     0.8 px ring on Edge Detection) overlaps by 0.003 px. At 1.5 px steps alone the sampling hid
     real crossings of the exact curves (a bow-tie sliver on a 0.8 px ring, crossings between
     nested 0.8 px rings, the Edge Detection ring above at up to 4 crossings).
2. **Tolerances** (`contour-trace.ts`). The fit tolerance is 0.25 source px of orthogonal distance
   (was 0.35 px parametric), 0.55 px for organic loops faired first (unchanged), times pixelScale and
   the Optimize scale. At 0.35 the merge drew a radius-17 disc with two half-circle cubics 0.33 px off
   round. Optimize now only scales this final tolerance: candidate joints and every shape stage use
   the tolerance at Optimize 0 or the neutral epsilon, so each ring's segment count is monotone
   non-increasing in Optimize (proof: whether a span fits depends only on the tolerance, and a
   larger tolerance only adds feasible spans; tested on single shapes). This holds for a ring on
   its own, not for the drawing: when a looser fit makes neighbouring rings cross, the topology
   repair backs the conflicting ring off to half, a quarter, ... of its tolerance, which can add
   segments. Two binary radius-20 discs 0.3 px apart trace as 17, 12, 10, 6, 6, 11 segments at
   Optimize 0 / 0.2 / 0.5 / 1 / 1.5 / 2 (the discs cross at 2). Keeping the whole drawing monotone
   would need the largest conflict-free tolerance per ring; that is a non-goal here.
3. **Fix A: every measured loop takes the fit tail.** The gate is `subPixelInformed` alone, not
   `subPixelInformed && chain >= 260 x pixelScale`. Organic loops (above 4096 x pixelScale points)
   are still Whittaker-faired first.
4. **Binary loops keep their approved shape, compactly, and their size (Fix B).** Loops without
   sub-pixel information keep dense flatten, simplify, flatten and the corner-aware spline resample
   (at the neutral epsilon), and the compact fit then runs through that resample, with the
   resample's corners (ADR-439's plus any hard turn of the simplified outline) as breaks. The
   resample is bounded chord by chord (`contour-chord-band.ts`, own design): each spline sample of
   a simplified chord stays within the signed range of perpendicular offsets its own dense stretch
   takes from that chord, and on a chord of 32 source px or more also on the side the stretch
   bulges, at most twice the stretch's mean offset (an arc's mean offset is 2/3 of its sagitta;
   staircase wobble averages out). Without the band a thin binary bar whose end caps collapse to
   two ~45 degree vertices (no corner pinned) had each long side bowed outward by the spline: a
   2 px bar at 0 degrees on Line Art's 2x route was +41% area on the ADR-439 base and +49% with the
   first compact fit, and is +2.3% now. The mean bound only applies to long chords: on the 15 to
   30 px chords of a simplified ring of radius 60 to 90 px, a chord's mean mostly says where
   Douglas-Peucker put its two vertices on the wobble, and bounding by it made the
   threshold-jittered ring of `contour-roundness` measurably less round (RMS 0.28 to 0.32 px).
5. **Curves travel explicitly** (`trace-curves.ts`). A finished ring is a `TraceRing`, a polyline
   that carries its `curve`. The topology repair keeps or swaps whole ring objects, so each candidate
   keeps its own curve; `withCanonicalTraceCurves` reads the carried curve and emits plain polylines
   (the curve is not stored twice). The dense-colour downscale route maps curves with their points
   through `scaleTracedPaths` (exact for Beziers under independent axis scales; a path with an
   elliptical arc falls back to straight segments). Region Enhance (downscale, offset and the
   merge into the full trace) keeps each ring's curve with its polyline, including the rings of the
   full trace it keeps; it used to rebuild every path as polylines only. The centreline's
   registration by sample array (ADR-405) is unchanged.

### Measurements

Bake-off, O-default (Line Art) against main `fa8939b8d` and Potrace 1.16 defaults (`-k 0.5 -t 2 -a 1
-O 0.2`); IoU, mean / Hausdorff deviation in px, native segments (cubic / line). "This" is the
final state after the review fixes (run `out-geo-2review`):

| Fixture | Main | This | Potrace |
|---|---|---|---|
| thin-bars clean | 0.780, 0.701 / 46.7, 612 (0 / 612) | 0.943, 0.070 / 1.07, 153 (116 / 37) | 0.838, 0.334 / 15.3, 91 |
| calibration bar 100 x 8 AA | 0.913 | 0.981 | 0.925 |
| calibration bar 100 x 1.5 AA | 0.735 | 0.911 | 0.128 |
| discs clean (r 8 to 100) | 0.9971, 0.102 / 0.334, 207 (11 / 196) | 0.9988, 0.043 / 0.22, 17 (17 / 0) | 0.9945, 0.193 / 0.891, 31 |
| discs binary | 0.9960, 0.140 / 0.675, 496 lines | 0.9962, 0.135 / 0.53, 28 cubics | 0.9945, 0.193 / 0.891, 31 |
| ellipses clean | 0.9945, haus 0.352, 208 | 0.9965, haus 0.22, 23 | 0.9830, haus 0.911, 29 |
| small-squares binary | 0.9811, haus 1.515, 448 | 0.9883, haus 0.80, 62 | 0.9880, haus 1.125, 114 |
| hairlines clean | 0.9411, 100 | 0.9832, 23 | 0.9623, 23 |
| hairlines binary | 0.8997, 56 | 0.9535, 236 | 0.9623, 23 |
| text-small clean | 0.7848, 2160 | 0.8048, 225 | 0.6793, 337 |
| text-lowres clean | 0.9424, 3686 | 0.9646, 451 | 0.9009, 523 |
| text-large clean | 0.9849, 3941 | 0.9908, 622 | 0.9683, 790 |
| counter-letters clean | 0.9560, 440 | 0.9684, 56 | 0.9163, 66 |
| stars clean | 0.9925, haus 0.891, 36 | 0.9960, haus 1.85, 52 | 0.9867, haus 2.256, 68 |
| wedges clean | 0.9962, haus 0.437, 9 | 0.9975, haus 1.79, 19 | 0.9838, haus 1.723, 21 |
| owl | 0.8655, 105,409 (14,703 cubics) | 0.8947, 34,760 (30,507 cubics) | 0.8916, 45,592 |
| hummingbird (downscale route) | 0.8147, 112,343 (0 cubics) | 0.8448, 20,051 (17,652 cubics) | 0.8901, 32,260 |

Binary thin bars (unit probe: a 120 px bar, 200 x 200 image, area of the exact curves against the
ink pixel count; the bake-off has no binary thin-bar fixture, `contour-thin-shapes.test.ts` holds
these cells). ADR-439 base / first compact fit / this:

| Bar | Line Art | Smooth |
|---|---|---|
| 2 px, 0 degrees | +40.8% / +49.3% / +2.3% | +49.2% / -9.8% / -7.5% |
| 3 px, 30 degrees | +28.7% / +34.3% / +3.1% | +49.6% / +51.1% / +3.1% |
| 4 px, 15 degrees | +21.1% / +25.1% / +3.1% | +39.4% / +40.5% / +3.2% |
| 4 px, 30 degrees | +19.7% / +21.5% / +2.3% | +31.6% / +31.6% / +5.6% |
| 6 px, 30 degrees | +15.0% / +18.5% / +3.2% | +26.7% / +27.4% / +1.0% |

Sharp's binary bars stay within 1.5% throughout. Two cells stay worse than on the ADR-439 base:
Smooth's 1.5 and 2 px bars at 30 degrees (+9.1 / +7.0% there, +14.2 / +10.7% now). Smooth's 2x
route measures them as the bilinear enlargement of their staircase, so they take the measured fit
tail and follow that staircase; see Known gaps.

- Optimize sweep on the discs (bake-off, Optimize 0 / 0.2 / 0.5 / 1): 17, 17, 17, 15 segments
  (main 217, 207, 199, 162) at Hausdorff 0.18, 0.22, 0.22, 0.31; Potrace `-O` 0 / 0.2 / 0.5 / 1:
  87, 31, 21, 18 at Hausdorff 0.89, 0.89, 0.63, 0.89. Unit sweeps at Optimize 0 / 0.2 / 0.5 / 1 /
  1.5 / 2: binary disc r48 5, 5, 4, 3, 3, 3 cubics (main 128 lines throughout, 64 at 2);
  anti-aliased disc r30 4, 4, 3, 3, 3, 2; 120 px square 4 lines at every value (was 16); wavy
  binary disc 25, 25, 25, 23, 21, 20 (was 104, 112, 100, 88, 92, 84); wavy anti-aliased disc 18,
  18, 16, 14, 12, 12.
- Segments at the laser commit tolerance (0.25 px, `g1SegmentsAtCommitTol0_25px`): discs 193 (main
  304, Potrace 193), thin-bars 272 (main 612, Potrace 220), owl 87,869 (main 129,650, Potrace
  114,159), hummingbird 53,099 (main 112,343, Potrace 80,157).
- Trace time, warm, `traceImageToColoredPaths` in one process on this machine (base = ADR-439
  `4aa8bbde3` and first compact fit `882d81115` as the review measured them; this = the review
  fixes, same method):

  | Image, preset | ADR-439 base | First compact fit | This |
  |---|---|---|---|
  | owl, Line Art | 4.0 s | 10.3 s | 7.1 s |
  | owl, Smooth | 3.4 s | 8.0 s | 5.8 s |
  | owl, Sharp | 6.3 s | 13.8 s | 10.9 s |
  | owl, Edge Detection | 5.1 s | 10.7 s | 8.6 s |
  | hummingbird, Line Art | 2.7 s | 6.3 s | 4.8 s |
  | hummingbird, Smooth | 2.5 s | 6.4 s | 4.7 s |
  | hummingbird, Sharp | 3.6 s | 9.3 s | 7.5 s |
  | hummingbird, Edge Detection | 3.9 s | 9.1 s | 7.0 s |

  Bake-off runtimes (one run each): perf-noise-192 1.33 s base, 4.55 s first fit, 3.41 s now;
  perf-noise-1024 67 s main, 223 s first fit, 191 s now (941k segments, 799k of them lines;
  Potrace 211k); perf-mosaic-4000 1.35 / 2.37 / 1.81 s; text-large 1.23 / 1.98 / 1.61 s; owl
  (bake-off chain) 11.5 s first fit, 8.4 s now (main 5.3 s). On the owl with Line Art the fit
  itself went from 6.3 to 2.8 s; the 0.02 px compatibility sampling costs about 0.7 s of what
  remains (the topology repair tests about twice as many points and repairs the crossings the
  coarser sampling hid). The projected-point work of one
  organic ring (`compact-curve-fit-work.test.ts`) fell from 92 to 70 points per ring point.
- Unit instruments (`contour-roundness`, `contour-straightness`, `contour-curve-controls`,
  `trace-diagonal-hairline`, `contour-glyph-fidelity`, `contour-thin-shapes`, arch-house fidelity,
  the R=900 commit-grid disc and laser-move tests) pass. `contour-roundness` now samples the
  outline at an even arc-length step instead of at its vertices plus fill-ins: the 0.02 px sampling
  puts vertices where the curve bends, and vertex-weighted samples scored the same curve 0.035 px
  worse. Hairline cells (ADR-403): every binary Line Art and Smooth cell scores recall 1.000;
  anti-aliased Line Art 30 / 60 degrees score recall 0.938 / 0.875 at precision 0.987 / 1.000
  (IoU 0.926 / 0.875, was 0.597 / 0.619 at precision 0.611 / 0.629), so their recall floor moves
  to 0.85 with a 0.95 precision floor. Sharp's binary 30 / 60 degree cells keep recall 0.942 at
  precision 0.890 (was 0.929).

### Consequences

- Traces are far more compact everywhere and the output is the canonical curve; the compatibility
  polyline is its sampling, close enough that its crossings are the curve's.
- On the clean analytic fixtures, the apex and Hausdorff increases (wedges, stars, s-curve, the
  sub-pixel calibration box) come from ADR-439's corner dial, not this tail: the ADR-439 base with
  the old tail measures the same (wedges 1.775, stars 1.853, calibration 0.763 px). That does not
  hold for every scan variant. Against the ADR-439 base (`out-geo-step1`) this step moves
  small-squares scan Hausdorff 0.90 to 0.99 px (1.08 with the first compact fit), wedges scan 2.43
  to 2.56 (Potrace 1.92) and stars scan 2.28 to 2.39; rotated-rects scan went 0.94 to 1.02 with the
  first fit and is 0.91 now.
- Accepted regression, with its owner: Smooth's anti-aliased 1 px hairline beside the broad square
  (ADR-403 cells) scores recall 0.775 / 0.887 at 30 / 60 degrees, precision 1.000; the ADR-439 base
  scored 0.887 / 0.887, and Potrace 0.887 at 60 degrees. The outline now follows the measured
  iso-line exactly, and with the square in the image Smooth's automatic (Otsu) level puts that
  iso-line on a 0.6 px ribbon inside the 128-cut truth pixels; the old tail's recall came from
  bowing every edge ~0.3 px outward, which the same fixture without the square shows as precision
  0.563. The geometry core cannot tell a thin ribbon's true width from its threshold, so the
  recall floor for these two cells stays 0.75 with a 0.95 precision floor. Follow-up owner: the
  threshold stage that sets Smooth's automatic level (a width-preserving level for sub-pixel
  ribbons), not this tail.
- Known gaps:
  - Binary 30 and 60 degree hairlines on the 2x route are measured as the bilinear enlargement of
    a staircase, and the fit follows it (the bake-off's hairlines binary is 236 segments against
    Potrace's 23; Smooth's 1.5 and 2 px binary bars at 30 degrees are 10 to 14% fat). Averaging
    that staircase needs a staircase-aware prefilter; a tolerance floor from the chain's own
    roughness was measured and rejected (it cost text-small 0.807 to 0.774 IoU and did not reduce
    the hairline count), and so was a mean-offset term in the span error (it kept those bars at the
    base's area but raised the staircase fits from 108 to 165 cubics and fattened other
    anti-aliased bars).
  - Rotated-rects scan is 59 segments against Potrace's 43.
  - After the laser commit (0.025 mm) several fixtures still have more G1 moves than Potrace
    despite fewer native segments: text-large 3,109 against 2,962, thin-bars 272 against 220,
    hairlines binary 253 against 45, small-squares scan 247 against 189, rotated-rects scan 123
    against 87, stars scan 172 against 132. Compile flattens cubics by midpoint subdivision
    (ADR-391, ADR-405), which emits more chords than the tolerance needs; chord-optimal flattening
    is the follow-up that closes this.
  - Trace time is still 1.5 to 1.9x the ADR-439 base on large art (table above) and 2.9x main on
    uniform noise. Faster candidate proposal (coarse early exits, capped spans, fewer Newton passes,
    giving up after one pass) was measured and rejected: each changed the candidate joints enough
    to fail the R=900 commit-grid, filled-disc Optimize, Edge-dial or hairline instruments.
    Incremental span evaluation (reusing the previous extension's parameters) is the next lever;
    the exact part of it is done (Amendment 1), and the fit is no longer where most of the gap is.
    The topology repair's exact savings are Amendment 2, and its memory and the corner legs are
    Amendments 3 and 4; Amendment 5 counts where the fit's work goes, and Amendment 6 takes the
    pow calls out of the arm solve. What remains is the sample count and the proposal's Newton
    passes.
- Node editing, SVG export, bounds and the laser commit read the carried cubics; the downscale and
  Region Enhance routes no longer lose them.

Not part of this decision: chord-optimal cubic flattening in compile; the corner dial's apex
regressions; a staircase prefilter for binary sources on the 2x route; moving the centreline's
curve registration off the sample-array key; a drawing-wide monotone Optimize under neighbour
conflicts.

### Amendment 1 - compact-fit speed, same output (2026-09-27)

The compact fit was made cheaper without moving a single output bit. Every change keeps the
arithmetic of the pass it replaces, in the same operation order:

- Span passes run on allocation-free kernels (`compact-curve-project.ts`): parameters go into two
  reused buffers (kept up to 65,536 points, so a huge ring never pins its size), and the Newton
  step and evaluation are inlined on the cubic's coordinates and control-point differences, read
  once per pass. A unit test holds the pass against `cubic-fit.ts`'s own step bit for bit.
- Exact early stops: a Newton pass stops once its running maximum reaches the best error so far
  (it can then neither be kept nor improve, which ends the passes anyway); a merge extension's
  first pass stops at its give-up bound and its curve-to-chain check at the tolerance, because the
  rest of either pass cannot change the decision.
- A merge extension over a span the proposal already split reaches its decision from the
  proposal's Newton passes (they are deterministic for the same span and joint tangents) instead
  of refitting it. The merge's span cache is a flat error array plus full evaluations only for
  usable spans, and the fewest-segments walk no longer prepends in a loop.
- `hypot2` (`geometry/fast-hypot.ts`) reproduces V8's two-argument `Math.hypot` bit for bit at
  about a quarter of its cost; its test pins the equality.

Equivalence instrument: every `fitCompactRing` call of real traces (owl in Line Art, Smooth and
Sharp; hummingbird in Line Art; perf-noise-192 and perf-noise-1024 in Line Art; 34,876 calls) was
recorded and replayed through the fitter before and after. Structural differences 0, numeric
differences 0 on every corpus. The bake-off owl keeps 30,530 cubics and 4,335 lines.

Measured (one process per run, interleaved, machine under heavy load from other work, so ratios
only; `traceImageToColoredPaths`, the fit timed inside it):

| Case | Before (`225346494`) | After | main (`fa8939b8d`) |
|---|---|---|---|
| owl, Line Art, fit only | 6.6 to 8.2 s | 4.1 to 4.9 s | - |
| owl, Line Art, whole trace | 21.7 to 24.5 s | 18.7 to 23.2 s | 8.5 to 11.5 s |
| owl, Line Art, peak RSS | 860 to 867 MB | 865 to 871 MB | 718 to 779 MB |
| perf-noise-1024, Line Art, fit only | 254 s | 109 s | - |
| perf-noise-1024, Line Art, whole trace | 578 s | 419 s | 110 s |
| perf-noise-1024, Line Art, peak RSS | 6.4 GB | 6.5 GB | 2.3 GB |

Replaying the recorded owl Line Art calls alone (interleaved, same load): 3.2 to 3.3 s before,
2.1 to 2.4 s after.

Rejected, because it moves output past 0.01 px: Bernstein cubes as products (`x * x * x`) in the
arm solve. V8's `x ** 3` differs from the product in about a quarter of cases and is not correctly
rounded either, and the product version changed three owl-Sharp rings structurally with control
points up to 0.389 px apart. An exact double-double cube with a fallback near rounding midpoints
matched on 3e7 values but was no faster.

Status against the speed targets (owl Line Art at most 4.0 s, perf-noise-1024 at most 67 s, memory
not above main): not met. The fit is now about a quarter of the trace (owl 22%, noise 26%), so even
a free fit leaves both traces well above the targets and above main. The rest is outside the fit and not yet profiled (the likely
owners are the 0.02 px compatibility sampling that the topology repair and the curve contacts of
ADR-531 test, and the memory that sampling and the carried cubics hold: peak RSS is 2.8x main on
perf-noise-1024).
Within the fit, about 75% of the remaining projection work is the candidate proposal's split-at-
worst recursion, whose joints decide the output; the earlier proposal shortcuts moved joints and
failed the R=900 commit-grid, filled-disc Optimize, Edge-dial and hairline instruments. Reaching
the targets therefore needs an output-changing step (a coarser compatibility sampling or a
redesigned proposal), which is a separate decision with its own instruments.

### Amendment 2 - topology-repair speed, same output (2026-09-27)

A CPU profile of a whole owl Line Art trace, taken from a plain node bundle of
`traceImageToColoredPaths` (vitest's worker wrote no profile), put half of it in
`preserveContourTopologySteps`: 7.2 s against 2.6 s on main. The 0.02 px compatibility sampling
gives the owl 365,074 polyline points against main's 189k, and every stage of the repair grows
with the edge count. Four changes remove work without changing a coordinate:

- The contact cache pairs overlapping edges by descending both edge trees together
  (`ContourBoxIndex.overlapPairsSteps`) instead of one index query per edge; the earliest contact
  it keeps does not depend on the order pairs arrive in.
- A boundary's first membership query scans its edges; the second builds the crossing index.
- Box-index nodes take their bounds from their children, and the tree is built on an explicit
  stack in one generator instead of a recursive generator that resumed once per level at every
  checkpoint. The nodes, their order and their partitions are the same.
- `ContourMembership` answers a candidate ring from the contact cache's edge index
  (`ContourContactCache.preparedEdges`), from the first query. A horizontal edge never crosses
  the ray and a repeated closing point adds only a horizontal edge, so an index of all edges gives
  the same winding as the crossing index; `contour-membership.test.ts` pins it.

Equivalence instrument: an FNV hash of every polyline vertex and every curve coordinate of the
whole trace. It is unchanged on owl Line Art, Smooth and Sharp, hummingbird Line Art,
perf-noise-192 and perf-noise-1024 (941,017 segments, 2,619,458 points), from `172a27538` to
this amendment.

Measured (node bundles, one process per run, machine under load from other work, so pairs run
back to back and only ratios mean anything):

| Case | Before (`172a27538`) | After | main (`fa8939b8d`) |
|---|---|---|---|
| owl Line Art, topology repair (CPU profile) | 7.2 s | 5.5 s | 2.6 s |
| owl Line Art, nesting checks (CPU profile) | 1.5 s | 1.1 s | - |
| perf-noise-1024 Line Art, whole trace | 358.7 s | 144 to 232 s | 86.6 s |
| perf-noise-1024 Line Art, peak RSS | 6.7 GB | 5.0 to 6.3 GB | 2.3 GB |

The back-to-back noise pair just before the last two changes and after them measured 234 s and
144 s; owl whole-trace wall time on this machine swung from 7.6 to 16 s for the same code and is
not ranked.

Status against the targets: not met. Owl Line Art is about twice main in the topology repair
alone; perf-noise-1024 is 1.7 to 2.7x main in time and 2.7x in memory. Tried without gain and
dropped: testing a small ring's later cubics in place instead of filtering them in
`ringMeetsItself`. What remains is proportional to the sample count (perf-noise-1024: 2.62M
points against main's 0.97M; perf-noise-192: 100,405 against 30,110), which the repair, the
contact indexes and the curve pieces all hold. Only a coarser compatibility sampling removes it,
and that changes the output, so it is a separate decision with its own instruments.

### Amendment 3 - index memory and corner legs, same output (2026-09-27)

Peak memory is garbage-collector slack over a live set about three times main's. A heap snapshot
at the end of the topology repair (perf-noise-256) held 123 MB against main's 39 MB, mostly boxed
doubles: every contour edge and every box-index node stored four bounds as heap numbers. Four
changes remove that and some corner-leg work without changing a coordinate:

- Contour edges compute their box from their end points (`Math.min`/`Math.max` of the same two
  values) instead of storing it.
- The box index copies each item's bounds once into a `Float64Array`; leaves list a range of the
  partition order instead of an array of items, and queries and the dual-tree walk test the flat
  copies. The build partitions over typed centre arrays by the same swaps.
- The box index keeps its nodes in flat typed arrays sized by the build's exact node count. Nodes
  are built, numbered and visited in the same order and compare the same doubles.
- `fitLeg` and `isStraight` step the ring index instead of reducing it modulo the ring length for
  every point. The points and the order of every sum are unchanged (`x ** 2` is `x * x` exactly).

Tried without gain and dropped: moving the partition keys with the order so partitions read them
in sequence.

Equivalence instrument: the same FNV hash of every polyline vertex and curve coordinate. It is
unchanged on owl Line Art, Smooth and Sharp, hummingbird Line Art and perf-noise-192, -256, -512
and -1024 from Amendment 2 to this amendment. The heap at the end of the repair on perf-noise-256
is 103 MB after the first two changes, before the node arrays.

Measured (node bundles, one process per run, runs interleaved, machine less loaded than for
Amendment 2):

| Case | Amendment 2 (`0300fd3e8`) | After | main (`fa8939b8d`) |
|---|---|---|---|
| owl Line Art, whole trace | 7.2 to 8.3 s | 6.2 to 7.3 s | 4.3 to 4.5 s |
| owl Line Art, peak RSS | 705 to 718 MB | 595 to 673 MB | 562 to 564 MB |
| perf-noise-512 Line Art, `fitLeg` (CPU profile) | 1.22 s | 0.49 s | - |
| perf-noise-1024 Line Art, whole trace | 107 s | 96 s | 61 s |
| perf-noise-1024 Line Art, peak RSS | 6.3 GB | 4.3 GB | 2.7 GB |

Status against the targets: not met. Owl Line Art is about 1.5x main and above the 4.0 s target
(main itself measured 4.3 to 4.5 s in this run); perf-noise-1024 is 1.6x main in time and in
peak memory. The fit is about 44% of the perf-noise-512 trace in a CPU profile and has no known
exact saving left (Amendment 1). The rest still grows with the sample count (2.62M points against
main's 0.97M on perf-noise-1024).

### Amendment 4 - on-demand edges, corner coverage and curve subdivision, same output (2026-09-27)

A heap snapshot taken after round 0 of the topology repair (perf-noise-256, 116 MB live) showed
one object per contour edge in two places: the contact cache's edge index, and the crossing index
that membership builds for boundaries the cache has not lent it. Each crossing edge was a spread
`{minX, minY, maxX, maxY, a, b}` with a property array and four boxed bounds. Five changes remove
those objects and some finishing and curve-contact work without changing a coordinate:

- The box index can be built over a flat bounds array with an item factory
  (`ContourBoxIndex.overBoundsSteps`), and `overlapIdsSteps` walks overlapping pairs by item
  number. Contour edges (`contour-edges.ts`) keep the ring's points and edge count; an edge object
  is made only when something asks for one. The contact cache tests each pair from the points by
  index and makes edges only for pairs that meet. The boxes, tree, pairs and contact choices are
  the same.
- Membership's own crossing index is now that edge index. It also holds horizontal edges and drops
  a repeated closing point, which gives the same winding: a horizontal edge never crosses the ray,
  and the dropped point adds only a horizontal edge. Cubic pieces for the curve guard are written
  as a literal of known shape instead of a spread, so their fields stay in the object.
- The wedge coverage behind the measured-apex field check (`contour-corner-field.ts`) computes its
  row and column products once per pixel, by the same operations, so each of the 64 sample tests
  compares the same two values. Its memo keys integer pixels by number.
- `chainWithCorners` finds the corner after a crack through a typed array instead of a `Map`, and
  steps the ring index from the same start.
- The curve meet test (`compact-curve-meet.ts`) carries each piece's box and flatness through
  subdivision. The box is taken once, when the piece is made, by the same `min` and `max`. The
  flatness is measured the first time it is needed, so the piece that is kept while the other is
  halved is not measured again.

Equivalence instrument: the same FNV hash of every polyline vertex and curve coordinate, after
each change, on owl Line Art, Sharp and Smooth, hummingbird Line Art and perf-noise-192, -256 and
-512. perf-noise-1024 was checked at the end. The topology, membership, contact, box-index,
corner and curve-contact test files pass.

Measured (node bundles, one process per run, runs interleaved; owl from three interleaved
rounds on a lightly loaded machine; wall times vary by about 15% between runs of the same code):

| Case | Amendment 3 (`de96e0da7`) | After | main (`fa8939b8d`) |
|---|---|---|---|
| owl Line Art, whole trace | 5.3 to 6.1 s | 5.0 to 5.5 s | 3.5 to 3.7 s |
| owl Line Art, peak RSS | 584 to 605 MB | 528 to 598 MB | 532 to 581 MB |
| perf-noise-512 Line Art, whole trace | 19.1 to 20.0 s | 18.5 to 19.4 s | 10.7 to 11.3 s |
| perf-noise-512 Line Art, peak RSS | 1,323 to 1,338 MB | 1,136 to 1,231 MB | 711 to 734 MB |
| perf-noise-1024 Line Art, whole trace | 89 s | 80 s | 48 s |
| perf-noise-1024 Line Art, peak RSS | 4.27 GB | 3.68 GB | 2.35 GB |

On owl Line Art, timing wrappers show where the rest goes (they add their own overhead):
finishing takes about 2.3 s, of which the fit is about 1.8 s and the corner dial's leg candidates
about 0.8 s. The topology repair takes about 1.9 s, of which about 1.3 s is round 0. A CPU
profile's self time for `chainWithCorners` (0.2 s) was misattributed: timed directly, it is
23 ms.

Status against the targets: owl Line Art's peak memory is now within main's run-to-run range, so
that part of the memory target is met there. perf-noise-512 and -1024 still peak at 1.6x main,
because live data grows with the 2.7x sample count; about a third of the round-0 heap on
perf-noise-256 is boxed point coordinates. The time targets are still not met: owl is about 1.45x
main, and perf-noise-1024 is 1.7x main.

### Amendment 5 - distance roots only where they decide, same output (2026-09-27)

Counting the fit's work on owl Line Art (2,472 ring fits, 395k ring points, no ring fitted twice
with the same input) shows where it goes. The joint proposal makes 101k span fits over 2.76M span
points, and their Newton passes project 9.17M points: about 80% of the fit's projection work. The
merge's 45k decision fits project 2.24M points, and 15k more reuse the proposal's passes. A
proposal span runs its passes until they stop improving, because its worst point decides where it
splits, and that decides the joints the merge can use. So the proposal's cost cannot be cut
without moving joints, and that changes the output.

Two exact changes:

- The projection pass, the reverse check's window minimum and the chord deviation compare each
  squared distance with the square of the running maximum (or minimum), with a margin of 1e-9.
  They take the root (`hypot2`) only where it can change the result. The square and `hypot2` each
  round by a few ulps (about 1e-15 relative), far inside the margin, so a skipped point could not
  have won the comparison. No pruning is done below 1e-150, where squares lose relative precision.
  New tests in `compact-curve-project.test.ts` compare the chord deviation and the reverse check
  with unpruned references over exact ties and five decades of scale. The existing
  projection-pass reference test also still passes.
- The corner legs' straightness test fits the leg's line without computing the residual, which it
  never reads (`legLine` in `contour-corner-legs.ts`); `fitLeg` adds the residual to the same
  sums.

Equivalence instrument: the whole-trace hash of every polyline vertex and curve coordinate is
unchanged on owl Line Art, Sharp and Smooth, hummingbird Line Art and perf-noise-192, -256, -512
and -1024 (`84472a71`).

Measured (node bundles, interleaved, one process per run): owl Line Art fit time fell from
1.73-1.76 s to 1.66-1.68 s over three rounds. Whole-trace time on owl (5.1 to 5.3 s before, 5.1 to
5.2 s after) and on perf-noise-512 moved less than the run-to-run noise. perf-noise-1024 took 92 s against 97 s
back to back, with peak RSS unchanged at 3.66 GB, on a machine more loaded than in Amendment 4.

Status against the targets: unchanged. Owl Line Art is about 1.45x main, perf-noise-1024 about
1.7x main in time and 1.6x in memory. No exact lever of more than a few percent is known. The
remaining cost is in the proposal's passes, which are 80% of the fit, and in the topology repair's
work on the 0.02 px sampling. Both can only be reduced by a change to the output.

### Amendment 6 - the arm solve's cubes without pow, same output (2026-09-27)

A CPU profile of perf-noise-512 put the shared arm solve (`solveTangentArms` in
`core/geometry/cubic-fit.ts`) at 14% of the whole trace, second only to the projection pass. Most
of that was its two cubes, `(1 - t) ** 3` and `t ** 3`. V8 computes `x ** 3` with its pow routine,
which is about ten times slower than multiplying. The result is also not `x * x * x`: the two
differ in the last bit for about a quarter of all x. (`x ** 2` is already `x * x`, bit for bit.)

Changes, all with identical output:

- `cube01` (`core/geometry/fast-cube.ts`) returns `x ** 3` bit for bit for x in [2^-300, 1]
  without calling pow. It forms the exact cube as a double-double (Dekker's product, twice) and
  rounds it. If the exact cube lies within 2^-57 times its value (at least 1/32 ulp) of a
  rounding boundary, it returns `x ** 3` instead. Everywhere else, any pow that stays that close to
  correctly rounded returns the same double. Measured against exact integer cubes, V8's pow was
  at most 0.0036 ulp past correct rounding over 4e6 cubes, so the band has about nine times that
  margin. An instrumented run compared all 2.28e8 cubes of the seven traces below with `x ** 3`:
  none differed, and 8% took the fallback. `fast-cube.test.ts` pins 8e5 cubes (uniform, near 0,
  near 1, products, grid values) and the edge values. Parameters always lie in [0, 1], so the arm
  solve uses it for both cubes.
- The compact span fit (`compact-curve-span.ts`) writes the chord parameters into a reused buffer
  with `chordParameterize`'s operations in the same order. It fits the first-pass cubic once for
  both the screen and the passes. It runs the first pass before the Newton loop, and it keeps the
  last span's chord deviation, since the chord is tried before the cubic on the same span.
- A single-piece merge span that reuses the proposal's fit reads only the piece's two end points,
  so its span is no longer copied out of the ring (`compact-curve-fit.ts`).

Equivalence instrument: the whole-trace hash of every polyline vertex and curve coordinate is
unchanged on owl Line Art, Sharp and Smooth, hummingbird Line Art and perf-noise-192, -256, -512
and -1024 (`84472a71`).

Measured (node bundles, interleaved, one process per run): perf-noise-512 went from 15.7-16.0 s
to 14.4-14.8 s (main 9.4-9.6 s), and the arm solve's share of the trace from 14% to 10% including
`cube01`. perf-noise-1024 went from 77.7-77.8 s to 75.0-75.6 s over two rounds (main
45.8 s), with peak RSS unchanged at 3.67 GB (main 2.65 GB). Owl Line Art moved less than the run-to-run noise
(4.8-5.4 s before and after; main 3.4-3.6 s), because its fit is a smaller share of the trace.
Peak memory is unchanged.

Status against the targets: not met. Owl Line Art is about 1.4x main, and perf-noise-1024 is
1.6x main in time and 1.4x in memory. The projection pass is now the largest cost
(22% of perf-noise-512), and its arithmetic is already at the reference's operation count. The
remaining gap is the proposal's Newton passes and the topology repair's work on the 0.02 px
sampling. Both can only be reduced by a change to the output.

### Amendment 7 - the arm solve's cubes are correctly rounded on every engine (2026-09-28)

Amendment 6's `cube01` returned `x ** 3` bit for bit only on the V8 it was measured on. V8's pow
is not the same routine in every version. CI runs Node 22 (V8 12.4), and there `cube01` differed
from `x ** 3` on 29,783 of the unit test's 8e5 cubes, so the test failed. Node 24 (V8 13.6) and
Chrome 152 agree with each other, and their pow is off from the correctly rounded cube on about
1 in 2,800 inputs. So before this amendment the trace already depended on the engine's pow,
and "same output" held only on the engine that measured it.

Change: `cube01` returns the correctly rounded cube (round to nearest, ties to even) for x in
[2^-300, 1] on every engine, and never calls pow there.

- The double-double remainder is off by at most about 2^-104 of the cube: Dekker's products are
  exact, and only `pErr * x` and one addition round. So the boundary band shrinks from 2^-57 to
  2^-100 of the cube. The fallback now occurs about once in 2^47 random inputs, and on exact
  ties. It was taken 8% of the time before.
- The fallback no longer calls pow. It rounds the exact integer cube of the 53-bit significand
  (a BigInt) to nearest, ties to even.
- Outside [2^-300, 1] it still returns `x ** 3`. The arm solve never goes there.

Test: `fast-cube.test.ts` no longer compares against the engine's `x ** 3`. It checks each
result against the exact cube from the definition: the cube must lie between the midpoints to
its two neighbouring doubles, and on a midpoint only when the result is even. It covers 4e5
cubes (uniform, near 0, near 1, products and grid values, and their mirrors), about 400 exact
ties and near-ties (k / 2^18 and k / 2^19), and the edge values. A `x * x * x` mutant fails the
first case, and a ties-to-odd mutant fails two cases. Removing the fallback does not fail the
test, because plain floating point already rounds an exact tie correctly, and a near tie that
needs the fallback has no known constructed input.

Measured:

- Correct rounding: the new `cube01` was correctly rounded on all of 6e5 random cubes on Node 24
  and on Chrome 152. On both engines pow was wrong on 217 of those 6e5.
- Output: compared against 6c834c673 on Node 24, about 0.1-0.15% of all output coordinates
  move, by at most 2.2e-12 px. This holds for owl and hummingbird in Line Art, Sharp and Smooth,
  and for noise192 and noise37x113. The number and order of curves, segments and kinds are
  unchanged in every case. Only `subpathNesting.geometryKey`, a hash of the coordinates, differs.
  The parity-oracle hashes recorded before this amendment need re-recording.
- Speed: over 8.4e6 uniform cubes (best of 5, Node 24), the new version took 159 ms, Amendment
  6's version 249 ms, pow 372 ms and `x * x * x` 140 ms. The gain comes from the fallback, which
  called pow 8% of the time and now almost never runs.

### Amendment 8 - the repair refits a ring no finer than a quarter of its tolerance (2026-09-29)

The 2026-09-29 audit of this decision's branch timed the topology repair on seeded uniform noise
(the parity oracle's generator; the perf-noise images were not available). On the 1024 px image,
1,405 whole-ring refits took 34.9 s of a 116.6 s trace. Each halving cost more than the one
before it (5.6, 7.5, 9.3 and 12.7 s) and cleared fewer rings: 578 rings reached 1/2, 338 reached
1/4, 266 reached 1/8, 223 reached 1/16 and 202 the baseline, and 187 ended at their source.

Change: `compactRefinement` (`contour-trace.ts`) refits a ring at 1/2 and 1/4 of its tolerance
only. Below `MIN_REFIT_AMOUNT` (1/4) it returns the ring's baseline, which the repair then passes
over as geometry the ring already has. A ring that still conflicts after 1/4 goes to its
baseline, then to its source. Below a quarter a refit mostly follows the chain's own noise, and
each one costs a whole fit of the ring.

Output: a ring changes only if it used to clear at 1/8 or 1/16. Such a ring now keeps its
baseline, the smoothed chain as a polyline, instead of a tight curve. The audit counted 1 of 455
rings on noise192 Line Art, 2 of 931 on Sharp and 16 of 3,271 on noise512. The whole-trace hash
is unchanged on the astronaut (Line Art and Sharp), the 1254 px Centerline stress-test drawing,
the arch house (Line Art) and text-sans-96.

Measured with esbuild bundles of `traceImageToColoredPaths`, one process per run, interleaved with
main (`01c49d2f5`), medians of 2 rounds on a 4-core machine. Warm runs were used where a process
traced more than once.

| Case | Before (`9fdc73cd0`) | After | main |
|---|---|---|---|
| noise512, Line Art | 23.1 s, 1,021 MB | 16.9 s, 932 MB | 8.3 to 8.9 s, 680 MB |
| noise192, Line Art | 2.71 s | 2.25 s | 1.08 to 1.12 s |
| noise192, Sharp | 1.91 s | 1.51 s | 0.84 s |
| stress-test 1254, Line Art (same output) | 6.76 s | 6.85 s | 4.18 to 4.27 s |

The audit measured noise1024 at 116.6 s before and 94.4 s after, against main's 40.4 s. Noise is
still about 1.9x main, above the 1.46x target. The rest of the back-off is the whole-ring retry
without rebuilt corners, plus the refits of the few large rings that meet many others.

### Amendment 9 - a ring that meets many others skips the weaker refits (2026-09-29)

After Amendment 8, most of the back-off on uniform noise is a few large rings that meet many
others. On noise512 Line Art, 5 rings of 15k to 40k samples each met 11 to 39 other rings in the
first round. Every one of them was refitted at 1/2 and at 1/4 and still ended at its source.
Rings that met 2 to 7 others often cleared: of 13 on noise512, 7 cleared at the retry without
rebuilt corners and 1 at 1/2.

Change: each repair round counts, for every conflicting ring, the other rings it meets in the
sample crossing test, the curve guard (ADR-531) or the nesting check. A ring that meets 8 or more
(`CROWDED_PARTNERS`, `contour-topology.ts`) passes over the weaker refinements and takes its
baseline next. It still gets its retry without rebuilt corners first. A weaker refinement would
have to clear every one of those contacts at once, and it costs a whole fit of what is usually a
large ring. The laser commit guard's steps are all the source, so it is unaffected.

Output: the whole-trace hash is unchanged on the astronaut (Line Art and Sharp), the 1254 px
stress-test drawing, the arch house (Line Art) and text-sans-96. In the first three, no ring met
more than one other in the first round. On noise, the crowded ring reaches its baseline sooner, so fewer of its neighbours back
off. Against Amendment 8, 63 of 3,271 rings change on noise512 Line Art, 8 of 455 on noise192
Line Art and 7 of 931 on noise192 Sharp. No ring goes from a curve to a polyline, and 31, 3 and 3
rings go from a polyline to a curve. Of noise512's rings, 3,227 are curves instead of 3,196.

Measured as in Amendment 8, against it, 2 rounds, with another benchmark sharing the machine:

| Case | Amendment 8 | After |
|---|---|---|
| noise512, Line Art | 18.2 s, 932 MB | 14.9 s, 916 MB |
| noise192, Line Art | 2.26 s | 1.87 s |
| noise192, Sharp | 1.56 s | 1.39 s |
