## ADR-405 - Traced contours reach the scene as compact curves (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This extends ADR-391, which kept the contour finisher's fitted cubics as canonical curves only for
measured loops of at least 260 chain points, and builds on ADR-404's corner dial. It changes the
finishing tail of the filled-contour tracer (Line Art, Smooth, Sharp) and of the Edge lane that
shares it. The tracer still returns closed rings with canonical curves; bounds, compile, Frame and
Start contracts (PROJECT.md non-negotiable 21, ADRs 228, 230, 232 and 237) are untouched.

### Context

Measured on the base (`claude/tl-geometry-core` at `4aa8bbde3`, ADR-404 applied) and on main
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
  gained 22% area (IoU 0.780 on main, 0.798 with ADR-404; Potrace 0.838), a 100 x 8 anti-aliased
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
   - Breaks: ADR-404's corners split the ring C0 with one-sided tangents (a parabola through the
     corner and the points one and two window-halves along, window 2 source px) and stay exact.
     Knots (exact G1 joints) are supported for callers that pin feature points.
   - Candidate joints: a split-at-the-worst-point cubic fit at a candidate tolerance that never
     follows Optimize (0.75 x the tolerance Optimize 0 gives). Each joint gets one centred tangent
     (chord over ±2 source px), used by every segment that meets there, so the curve is G1 at every
     joint the merge keeps. A span whose worst point sits at its ends splits at its farthest point
     from the chord instead, so a badly missed span cannot peel one point per level.
   - Span error: the least-squares arm lengths along the fixed end tangents and the Newton
     point-to-curve projection are the shared ones in `core/geometry/cubic-fit.ts`
     (`solveTangentArms`, `newtonProjectionStep`, `chordParameterize`, `evaluateCubic`); the error
     is the centreline fit's two-way orthogonal error (`centerline/curve-fit-error.ts`): every chain
     point to the curve by projection, and curve samples every 0.5 px back to the chain. Up to four
     Newton reparameterization passes run while they lower the error; the curve-to-chain check runs
     on the pass kept. A span's error never depends on the tolerance.
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
     closer.
   - Compatibility polyline: line ends only, about one vertex per 1.5 working px along cubics,
     every joint exact, ending on the start (no collinear samples along lines).
2. **Tolerances** (`contour-trace.ts`). The fit tolerance is 0.25 source px of orthogonal distance
   (was 0.35 px parametric), 0.55 px for organic loops faired first (unchanged), times pixelScale and
   the Optimize scale. At 0.35 the merge drew a radius-17 disc with two half-circle cubics 0.33 px off
   round. Optimize now only scales this final tolerance: candidate joints and every shape stage use
   the tolerance at Optimize 0 or the neutral epsilon, so the segment count is monotone
   non-increasing in Optimize (proof: each span's error is fixed, a larger tolerance only adds
   feasible segments; tested).
3. **Fix A: every measured loop takes the fit tail.** The gate is `subPixelInformed` alone, not
   `subPixelInformed && chain >= 260 x pixelScale`. Organic loops (above 4096 x pixelScale points)
   are still Whittaker-faired first.
4. **Binary loops keep their approved shape, compactly.** Loops without sub-pixel information keep
   dense flatten, simplify, flatten and the corner-aware spline resample (at the neutral epsilon),
   and the compact fit then runs through that resample, with the resample's corners (ADR-404's plus
   any hard turn of the simplified outline) as breaks. Planned Fix B (bounding the spline by the
   dense sub-chain's offsets) was not needed: with ADR-404's corners pinned, binary bars no longer
   bow (small-squares binary area error +0.03%, hairlines binary +1.42% against main's +1.45%).
5. **Curves travel explicitly** (`trace-curves.ts`). A finished ring is a `TraceRing`, a polyline
   that carries its `curve`. The topology repair keeps or swaps whole ring objects, so each candidate
   keeps its own curve; `withCanonicalTraceCurves` reads the carried curve and emits plain polylines
   (the curve is not stored twice). The dense-colour downscale route maps curves with their points
   through `scaleTracedPaths` (exact for Beziers under independent axis scales; a path with an
   elliptical arc falls back to straight segments). The centreline's registration by sample array
   (ADR-397) is unchanged.

### Measurements

Bake-off, O-default (Line Art) against main `fa8939b8d` and Potrace 1.16 defaults (`-k 0.5 -t 2 -a 1
-O 0.2`); IoU, mean / Hausdorff deviation in px, native segments (cubic / line):

| Fixture | Main | This | Potrace |
|---|---|---|---|
| thin-bars clean | 0.780, 0.701 / 46.7, 612 (0 / 612) | 0.944, 0.071 / 1.07, 150 (123 / 27) | 0.838, 0.334 / 15.3, 91 |
| calibration bar 100 x 8 AA | 0.913, area +8.3% | 0.981, area +0.2% | 0.925 |
| calibration bar 100 x 1.5 AA | 0.735 | 0.911 | 0.128 |
| discs clean (r 8 to 100) | 0.9971, 0.102 / 0.334, 207 (11 / 196) | 0.9984, 0.054 / 0.200, 16 (16 / 0) | 0.9945, 0.193 / 0.891, 31 |
| discs binary | 0.9960, 0.140 / 0.675, 496 lines | 0.9961, 0.137 / 0.598, 23 cubics | 0.9945, 0.193 / 0.891, 31 |
| ellipses clean | 0.9945, haus 0.352, 208 | 0.9957, haus 0.220, 20 | 0.9830, haus 0.911, 29 |
| small-squares binary | 0.9811, haus 1.515, 448 | 0.9883, haus 0.794, 62 | 0.9880, haus 1.125, 114 |
| hairlines clean | 0.9411, 100 | 0.9856, 22 | 0.9623, 23 |
| hairlines binary | 0.8997, 56 | 0.9535, 236 | 0.9623, 23 |
| text-small clean | 0.7848, 2160 | 0.8057, 224 | 0.6793, 337 |
| text-lowres clean | 0.9424, 3686 | 0.9638, 444 | 0.9009, 523 |
| text-large clean | 0.9849, 3941 | 0.9907, 604 | 0.9683, 790 |
| counter-letters clean | 0.9560, 440 | 0.9664, 53 | 0.9163, 66 |
| stars clean | 0.9925, haus 0.891, 36 | 0.9959, haus 1.852, 51 | 0.9867, haus 2.256, 68 |
| wedges clean | 0.9962, haus 0.437, 9 | 0.9970, haus 1.785, 17 | 0.9838, haus 1.723, 21 |
| owl | 0.8655, 105,409 (14,703 cubics) | 0.8942, 34,981 (31,320 cubics) | 0.8916, 45,592 |
| hummingbird (downscale route) | 0.8147, 112,343 (0 cubics) | 0.8444, 20,103 (18,018 cubics) | 0.8901, 32,260 |

- Optimize sweep on the discs (bake-off, Optimize 0 / 0.2 / 0.5 / 1): 16, 16, 16, 15 segments
  (main 217, 207, 199, 162); Potrace `-O` 0 / 0.2 / 0.5 / 1: 87, 31, 21, 18 at Hausdorff 0.89, 0.89,
  0.63, 0.89 against ours 0.20, 0.20, 0.20, 0.31. Unit sweeps at Optimize 0 / 0.2 / 0.5 / 1 / 1.5 / 2:
  binary disc r48 4, 4, 3, 3, 3, 3 cubics (was 128 lines throughout, 64 at 2); 120 px square 4 lines
  at every value (was 16); wavy binary disc 28, 28, 24, 22, 19, 19 (was 104, 112, 100, 88, 92, 84).
- Segments at the laser commit tolerance (0.25 px, `g1SegmentsAtCommitTol0_25px`): discs 199 (main
  304, Potrace 193), thin-bars 277 (main 612, Potrace 220), owl 88,662 (main 129,650, Potrace
  114,159), hummingbird 53,491 (main 112,343, Potrace 80,157). Compile's midpoint flattening of
  cubics (ADR-391, ADR-397) still emits more chords than the tolerance needs; chord-optimal
  flattening remains its own change.
- Unit instruments (`contour-roundness`, `contour-straightness`, `contour-curve-controls`,
  `trace-diagonal-hairline`, `contour-glyph-fidelity`, arch-house fidelity and laser-move tests)
  pass. The anti-aliased ring radii 17.3 / 8.2 keep radial RMS 0.072 / 0.086 px (limit 0.15). Hairline cells
  (ADR-395): every binary Line Art and Smooth cell now scores recall 1.000 at IoU 0.986 or better
  (Line Art binary 30 / 60 degrees were IoU 0.740 / 0.760); anti-aliased Line Art 30 / 60 degrees score recall 0.938 / 0.875 at precision 0.987 / 1.000
  (IoU 0.926 / 0.875, was 0.597 / 0.619 at precision 0.611 / 0.629), so their recall floor moves to
  0.85 with a 0.95 precision floor; Smooth's anti-aliased cells beside the square follow its Otsu
  iso-line, 0.6 px wide: recall 0.775 / 0.887 at precision 1.000 (was 0.887 / 0.887), floor 0.75.
  Sharp's binary 30 / 60 degree cells keep recall 0.942 at precision 0.903 (was 0.929; IoU 0.878 to
  0.855); its anti-aliased cells beside the square rise from IoU 0.878 / 0.731 to 0.951.

### Consequences

- Traces are far more compact everywhere and the output is the canonical curve; the compatibility
  polyline is its sampling.
- The apex and Hausdorff increases on wedges, stars, s-curve and the sub-pixel calibration box come
  from ADR-404's corner dial, not this tail: the ADR-404 base with the old tail measures the same
  (wedges 1.775, stars 1.853, calibration 0.763 px). Tracked with the dial.
- Known gaps: binary 30 and 60 degree hairlines on the 2x route are measured as the bilinear
  enlargement of a staircase, and the fit follows it (112 cubics per 80 px hairline; the bake-off's
  hairlines binary is 236 segments against Potrace's 23). Averaging that staircase needs a
  staircase-aware prefilter; a tolerance floor from the chain's own roughness was measured and
  rejected (it cost text-small 0.807 to 0.774 IoU and did not reduce the hairline count).
  Rotated-rects scan is 51 segments against Potrace's 43.
- Trace time: the fit and its merge cost more than the old tail on large organic art. Warm, same
  process, Line Art, against the ADR-404 base: owl 3.5 to 10.0 s, hummingbird 2.9 to 6.1 s. Faster
  candidate proposal (coarse early exits, capped spans, fewer Newton passes) was measured and
  rejected: each changed the candidate joints enough to fail the R=900 commit-grid, Edge-dial or
  hairline instruments.
- Node editing, SVG export, bounds and the laser commit read the carried cubics; the downscale route
  no longer loses them.

Not part of this decision: chord-optimal cubic flattening in compile; the corner dial's apex
regressions; a staircase prefilter for binary sources on the 2x route; moving the centreline's
curve registration off the sample-array key.
