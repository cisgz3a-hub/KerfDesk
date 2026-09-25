## ADR-397 - Centerline strokes reach the scene as compact cubics (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This extends ADR-391, which kept the contour finisher's fitted cubics as canonical curves and listed
"fitting the unfitted finish and Centerline strokes" as not part of that decision. It also changes
the Centerline assembly order and adds a dot fallback. Filled-contour and Edge output are unchanged.
The Frame-first contract (PROJECT.md non-negotiable 21, ADRs 228, 230, 232 and 237) is untouched.

### Context

Centerline was the one trace mode whose curves stayed polylines. `withCanonicalTraceCurves` found no
fitted curve for its strokes, so each stroke became straight segments over a dense Catmull-Rom
resample (three samples per Douglas-Peucker chord). An anti-aliased 3 px ring of radius 50 became
128 line segments; the owl and hummingbird test art carried 81,476 and 53,435 segments. LightBurn
2.2 EA's Center Line Trace keeps Smoothness and Optimize; the LaserForge dialog hid both for
Centerline. Two assembly defects remained on main:

- Gap bridging ran before tip extension. The skeleton stops about one stroke radius short of each
  ink tip, so a gap was measured as the paper gap plus both radii: a 1 px break in a 3 px stroke
  measured about 4 px and stayed open under the 3 px join. Breaks of 1 to 4 px all stayed open.
- There was no dot fallback. A round component's skeleton is a point or a pixel stub, so a dot was
  either dropped as shorter than the minimum chain or tip-extended across its whole diameter into a
  dash. Dots of radius 2 to 4 px all came out as 2-point dashes.

### Decision

1. **Cubic fit** (`centerline/stroke-curve-fit.ts`, an own implementation of the published
   least-squares scheme in P. J. Schneider, "An Algorithm for Automatically Fitting Digitized
   Curves", Graphics Gems, 1990). Each finished chain is fitted with G1 cubics over the dense faired
   chain: chord-length parameters, the 2x2 normal equations for the two arm lengths along fixed end
   tangents, Newton reparameterization while the error is within 6x the tolerance, a split at the
   worst point, then a greedy pass that re-fits adjacent pieces over their joint range and keeps any
   merge still within tolerance. Acceptance is orthogonal both ways: every chain point must lie
   within the tolerance of the curve by Newton projection (not the fit's own parameter), and samples
   of the curve every 0.5 px of control polygon must lie within the tolerance of the chain, which
   rejects loops and bulges between data points. End tangents come from a parabola through the
   points 0, 1 and 2 px along the chain (second-order accurate); centred tangents span +-2 px.
   - Breaks are typed. Corners (Douglas-Peucker vertices chosen by the existing corner test in
     `curve-refine.ts`, including sharpener-marked corners) split the curve C0 with one-sided
     tangents. Branch attachments are exact G1 knots with one shared centred tangent, so a welded
     branch still ends exactly on its through-stroke. A closed ring without corners seams G1 at
     index 0.
   - A whole corner-to-corner run that is straight within tolerance is one `line` segment.
   - The compatibility polyline is the curve's own sampling (about one vertex per 1.5 px), registered
     with `registerTraceCurve` in `trace-curves.ts`, so `withCanonicalTraceCurves` keeps the cubics.
2. **Smoothness and Optimize for Centerline** (`centerline/stroke-curve-policy.ts`), shown in the
   dialog's Curve finishing section with their own tooltips. They keep the roles Potrace-style
   tracers give them, applied to the centreline:
   - Smoothness s is the corner angle theta: a simplified vertex turning at least theta stays an
     exact corner. theta = 60 x s degrees up to the neutral 1 (the tree-wide 60 degree corner, so the
     default output keeps today's corners), rising linearly to 150 degrees at the maximum 4/3, where
     sharpener-marked corners turning less than theta - 60 degrees are released too. s = 0 keeps
     every simplified vertex: the output is the simplified polygon, all straight segments.
   - Optimize is the fit tolerance: 0.25 source px at the neutral 0.2, scaled by the shared Optimize
     curve (0.85x at 0, 2.35x at 2; `trace-optimize.ts`, moved out of `contour-trace.ts` so the
     centerline package can use it without an import cycle), by `lineTolerance`, and by the working
     grid's `pixelScale`, so an upscaled trace keeps the same physical tolerance.
3. **Tip extension before gap bridging** (`stroke-chains.ts`): loop closure, then tip extension of
   true tips, then bridging, then a closure pass for chains the bridge made closable. The join
   distance is now the drawn paper gap. The tip walk also judges a step that lands exactly on a pixel
   edge from the side it arrives on. Rounding the edge itself reached the ink boundary walking left
   or up but stopped half a pixel short walking right or down, skewing measured gaps by that amount.
4. **Dot fallback** (`centerline/dot-marks.ts`). An 8-connected ink component is round when its outer
   radius (farthest ink from the centroid, plus 0.5 px) is at most 1.2 x the radius r of the disc
   with its area plus 0.5 px, and at most 2 x its distance-field peak plus 1.5 px, so a ring such as
   an "o" with a counter wider than about 1.5 px keeps its ring. Its strokes, unless one bridges into
   other ink, are replaced by one closed circle of four cubics centred on the centroid, of radius
   max(r/2, 0.5 source px).
   - Representation on a LINE layer: burned with kerf k, the circle covers the annulus r/2 +- k/2,
     which is exactly the dot when k = r and a solid spot whenever k >= r (every pen-sized dot at
     ordinary engraving scale). A large round blob becomes a ring its own size, which a single-line
     trace cannot fill anyway.
   - A point mark was rejected: output never emits a stationary beam-on move (PROJECT.md #3), so a
     zero-length mark would burn nothing. A short stroke was rejected: it burns a stadium, the dash
     this decision removes.
   - The preset's speck filter (`despeckleMinPixels`, 12 px area) still removes smaller specks before
     tracing, as the operator set it.

### Consequences

- Segment counts on the same anti-aliased fixtures, preset Centerline (`stroke-curves.test.ts`):
  ring r=50 3 px 128 to 7; S-curve 56 to 8; letter S 80 to 9; letter 8 112 to 13; letter a 108 to 12;
  handwriting 88 to 11; T 9 to 4; Y 9 to 8; X unchanged at 2 straight lines. Real art end to end:
  owl (1254 px) 81,476 to 16,399 segments and hummingbird 53,435 to 10,586 (both 5.0x); subpaths
  3,939 to 3,872 and 2,426 to 2,382 as more gaps bridge; closed subpaths 21 to 121 and 11 to 40,
  the new round marks where dashes were.
- Deviation from the analytic centreline, sampled every 0.25 px away from stroke ends, before to
  after as max / mean px: ring 0.36 / 0.148 to 0.33 / 0.102; S-curve 1.29 / 0.148 to 1.29 / 0.150;
  letter S 1.21 / 0.262 to 1.21 / 0.279; letter 8 1.50 / 0.314 to 1.49 / 0.308; letter a 1.61 / 0.342
  to 1.57 / 0.411; handwriting 1.74 / 0.390 to 1.78 / 0.384; T 0.67 / 0.565 to 0.67 / 0.546;
  Y 0.62 / 0.367 to 0.68 / 0.222. Junction and cap topology sets the maxima, shared by both
  pipelines. The fit stays within 0.25 px of the faired chain, where the old resample was bounded to
  0.45 px of Douglas-Peucker chords. On straight stems with a half-pixel-ambiguous edge (letter a),
  the fit follows the faired chain where the old chords happened to cut closer to the truth.
- Gaps in a 3 px stroke under the 3 px join: 1 and 2 px now bridge, 3 and 4 px stay open (strict
  "closer than"); before, all four stayed open. `centerline-preset-scale.test.ts` now measures its
  strict threshold on the extended tips: three blank working columns on a 2x grid are a 1.5 source px
  gap, so limits 1.4 and 1.5 keep two strokes and 1.6 joins them.
- Dots of radius 1 to 4 px (speck filter off) each become one closed mark within 0.35 px of their
  centre. Dashes stay strokes and a 6 px ring stays a ring.
- Consumers: laser conditioning keeps the cubics (ADR-391) and compile flattens open and closed cubic
  subpaths with their ends exact. CNC fairing (ADR-260) reads the compatibility polylines and
  rebuilds its own line curves as before. V-carve, relief and library CNC tests pass unchanged
  (`centerline-curve-consumers.test.ts`).
- Laser G1 moves go up, not down, at 0.1 mm per trace pixel: owl 23,919 to 38,154 burn moves and
  hummingbird 15,884 to 24,877 (average move 0.57 to 0.36 mm). Before, the dense lines were reduced to
  the fewest vertices within 0.025 mm. Now compile flattens the cubics by midpoint subdivision with a
  control-point flatness test, which emits more chords than the tolerance needs, as ADR-391 observed
  for contour cubics. With the exact 3/4 control-distance bound alone the owl compiles to 33,589
  moves. Chord-optimal cubic flattening in compile, the item ADR-391 deferred, is the fix; it is not
  part of this decision because it changes the G-code of every curved path.
- Node editing, bounds, hit testing and SVG export read the cubics, as for contour traces.
- Traces committed before this ADR keep their geometry; re-trace to get curves.

Not part of this decision: chord-optimal cubic flattening in compile; exposing the join gap;
changing the speck filter's default.
