## ADR-405 - Centerline strokes reach the scene as compact cubics (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This extends ADR-391, which kept the contour finisher's fitted cubics as canonical curves and listed
"fitting the unfitted finish and Centerline strokes" as not part of that decision. It also changes
the Centerline assembly order and adds a dot fallback. Filled-contour and Edge output are unchanged.
The Frame-first contract (PROJECT.md non-negotiable 21, ADRs 228, 230, 232 and 237) is untouched.

### Context

Centerline was the one trace mode whose curves stayed polylines. `withCanonicalTraceCurves` found no
fitted curve for its strokes, so each stroke became straight segments over a dense Catmull-Rom
resample (three samples per Douglas-Peucker chord). An anti-aliased 3 px ring of radius 50 became
128 line segments; the repository's Arch House logo and dragon drawing
(`src/__fixtures__/perceptual/assets/`) carried 2,478 and 64,172 segments. LightBurn 2.2 EA's Center
Line Trace keeps Smoothness and Optimize; the LaserForge dialog hid both for Centerline. Two assembly
defects remained on main:

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
   worst point, then one left-to-right pass that re-fits each adjacent pair over their joint range
   and keeps any merge still within tolerance (after a merge only the grown piece and its left
   neighbour are retried, so the pass makes at most about three attempts per piece). Acceptance is
   orthogonal both ways: every chain point must lie within the tolerance of the curve by Newton
   projection (not the fit's own parameter), and samples of the curve every 0.5 px of control polygon
   must lie within the tolerance of the chain, which rejects loops and bulges between data points.
   End tangents come from a parabola through the points 0, 1 and 2 px along the chain
   (second-order accurate); centred tangents span +-2 px.
   - Breaks are typed. Corners (Douglas-Peucker vertices chosen by the existing corner test in
     `curve-refine.ts`, including sharpener-marked corners) split the curve C0 with one-sided
     tangents. Branch attachments are exact G1 knots with one shared centred tangent, so a welded
     branch still ends exactly on its through-stroke. A closed ring without corners seams G1 at
     index 0.
   - A whole corner-to-corner run that is straight within tolerance is one `line` segment.
   - The compatibility polyline is the curve's own sampling (about one vertex per 1.5 px), registered
     with `registerTraceCurve` in `trace-curves.ts`, so `withCanonicalTraceCurves` keeps the cubics.
   - Relation to the shared fitter (`core/geometry/cubic-fit.ts`, used by the contour finisher,
     curve fairing and polyline rounding). The least-squares core is shared, not copied:
     `solveTangentArms` (the 2x2 normal equations), `newtonProjectionStep`, `chordParameterize` and
     `evaluateCubic` are exported from that module and used by both. The recursion and acceptance
     stay separate because they differ in ways the shared callers' pinned output depends on: the
     shared fitter accepts on the parametric residual at its own parameters, has one break kind,
     estimates tangents over three points rather than over arc length, and emits no line runs and no
     merge pass. Moving the centreline rules into it behind options would put four option branches
     into the path ADR-391's laser output and the contour tests pin, for no shared caller.
2. **Smoothness and Optimize for Centerline** (`centerline/stroke-curve-policy.ts`), shown in the
   dialog's Curve finishing section with their own tooltips and matching visible hints. They keep
   the roles Potrace-style tracers give them, applied to the centreline:
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
   - Measuring the paper gap would fuse dashed and stitched lines, whose gaps are deliberate and
     often narrower than the join. A gap therefore bridges only when both pieces are more than 6
     times longer than it (`bridgeNearbyEnds`' `pieceGapRatio`): a detection dropout splits one long
     stroke into long pieces, while a dash train is short pieces with short gaps.
4. **Dot fallback** (`centerline/dot-marks.ts`). An 8-connected ink component is a dot only when two
   independent kinds of evidence agree:
   - Shape: its outer radius (farthest ink from the centroid, plus 0.5 px) is at most 1.2 x the
     radius r of the disc with its area plus 0.5 source px, so a concave or open shape such as a "c"
     fails; and the axis ratio of its second moments is at most 1.2, so a 1.4:1 capsule is a stroke.
   - Skeleton: its own pruned medial axis has no junction, no closed chain and at most one open
     chain, no longer than the outer radius exceeds the inscribed radius plus 1.5 source px. A dash,
     a "+" or a small "e" with an open counter has a real skeleton and keeps its strokes.
   - Every pixel constant is a source-pixel distance scaled by `pixelScale`, so an auto-upscaled
     trace classifies the same ink the same way.
   - A dot's strokes, unless one bridges into other ink, are replaced by n = ceil(r / 1 source px)
     concentric closed circles of four cubics each, centred on the centroid, at radii
     (2j + 1) r / (2n). Burned on a LINE layer with kerf k, circle j covers its radius +- k/2, so the
     circles tile the disc exactly when k = r / n and cover it solid for any k >= r / n: any beam at
     least one source pixel wide (0.1 mm at the 254 DPI import default). A dot no wider than about a
     pixel gets one circle of radius r/2.
   - This applies at every size, deliberately. A large solid round blob (an eye pupil) is solid ink;
     concentric circles burn it solid, where the old path burned one dash across its diameter.
   - A point mark was rejected: output never emits a stationary beam-on move (PROJECT.md #3), so a
     zero-length mark would burn nothing. A single circle of radius r/2 was rejected: with an
     ordinary 0.1 mm beam it leaves a hole in any dot wider than about 2 source px.
   - The preset's speck filter (`despeckleMinPixels`, 12 px of area) still runs first, as the
     operator set it. On the default Centerline preset an anti-aliased dot of radius 1.25 px still
     vanishes; radius 1.5 px is the smallest that becomes a mark. Lower the speck filter to keep
     smaller periods and i-dots.

### Consequences

- Segment counts on the same anti-aliased fixtures, preset Centerline (`stroke-curves.test.ts`):
  ring r=50 3 px 128 to 7; S-curve 56 to 8; letter S 80 to 9; letter 8 112 to 13; letter a 108 to 12;
  handwriting 88 to 11; T 9 to 4; Y 9 to 8; X unchanged at 2 straight lines. Real art, traced with
  `traceCenterlineStrokePaths`: logo 2,478 to 506 segments (4.9x) and dragon 64,172 to 12,189 (5.3x);
  dragon subpaths 2,518 to 2,593 and closed subpaths 33 to 72, the concentric dot marks.
- Deviation from the analytic centreline, sampled every 0.25 px away from stroke ends, before to
  after as max / mean px: ring 0.360 / 0.148 to 0.331 / 0.103; S-curve 1.287 / 0.148 to 1.287 /
  0.149; letter S 1.213 / 0.262 to 1.213 / 0.276; letter 8 1.503 / 0.314 to 1.483 / 0.308; letter a
  1.608 / 0.342 to 1.576 / 0.415; handwriting 1.742 / 0.390 to 1.782 / 0.375; T 0.666 / 0.565 to
  0.666 / 0.546; Y 0.617 / 0.367 to 0.679 / 0.223. Junction and cap topology sets the maxima, shared
  by both pipelines. The tests pin each fixture at its before-value plus 0.07 px on the maximum and
  0.02 px on the mean.
  - Letter a's mean is the one accepted regression (+0.073 px, pinned at +0.08). Its stem's centre
    lies on a pixel edge; the faired chain settles on the pixel-centre column beside it, and the fit
    follows the chain within 0.25 px, where the old Douglas-Peucker chords (0.45 px) happened to cut
    closer to the truth. Fitting the old resample instead, a narrower or wider tangent window, a
    mean-error acceptance test and dropping the merge pass were each measured and none recovered
    it without losing elsewhere (the resample made Y 0.617 to 0.814 max and handwriting 1.90 max).
- Gaps in a 3 px stroke under the 3 px join: 1 and 2 px now bridge, 3 and 4 px stay open (strict
  "closer than"); before, all four stayed open. `centerline-preset-scale.test.ts` now measures its
  strict threshold on the extended tips: three blank working columns on a 2x grid are a 1.5 source px
  gap, so limits 1.4 and 1.5 keep two strokes and 1.6 joins them. Six 10 px dashes with 2 px gaps
  stay six strokes at 3 and 5 px wide; with 1 px gaps (a 10:1 piece-to-gap ratio) they join into one
  line, as a dropout would.
- Dots of radius 1 to 8 px (speck filter off) become concentric circles within 0.35 px of their
  centre. 2:1, 1.6:1 and 1.4:1 capsules, six 10x5 dashes with 3 px gaps, a 13 px "+", a small "e"
  and small "c"s keep the open strokes they had before, at 1x and on the upscaled grid, and a 6 px
  ring stays a ring. A small "e" of radius 3 drawn 2 px wide thresholds to a solid 8 px blob with no
  counter left, so it is filled like any dot.
- Consumers: laser conditioning keeps the cubics (ADR-391) and compile flattens open and closed cubic
  subpaths with their ends exact. CNC fairing (ADR-260) reads the compatibility polylines and
  rebuilds its own line curves as before. V-carve, relief and library CNC tests pass unchanged
  (`centerline-curve-consumers.test.ts`).
- Laser output has more, shorter moves, and this is accepted. Placed 100 mm wide, conditioned by
  `simplifyTracedPathsForLaser` and compiled: logo 809 to 1,224 burn moves and dragon 17,108 to
  26,464 (+51% and +55%); G-code 18 to 26 KiB and 417 to 602 KiB; median span of 15 consecutive moves
  12.74 to 9.38 mm and 7.35 to 4.84 mm. Before, the dense lines were reduced to the fewest vertices
  within 0.025 mm; now compile flattens the cubics by midpoint subdivision with a control-point
  flatness test, which emits more chords than the tolerance needs, as ADR-391 observed for contour
  cubics.
  - Job time is unchanged within 0.5%. `estimateJobDuration` (planner, acceleration, junction
    deviation and serial transport) gives logo 77.1 to 77.0 s and dragon 1,500.3 to 1,506.8 s at the
    default 1,500 mm/min Line speed, and 66.0 to 65.7 s and 1,456.9 to 1,459.4 s at 6,000 mm/min.
  - That estimator does not model GRBL 1.1's 15-block look-ahead. By ADR-391's formula, the
    square root of 2 x acceleration x the 15-move span, at 500 mm/s² the dragon's cap falls from
    about 5,140 to 4,170 mm/min and the logo's from 6,770 to 5,810 mm/min. The default 1,500 mm/min
    is far below both; a job run faster than about 4,000 mm/min on a slow-accelerating GRBL 1.1
    machine can reach the lower cap sooner.
  - Replacing the laser cubics with a Douglas-Peucker reduction of their fine flattening (within the
    same 0.025 mm of the curve) was measured and rejected: it still needs 865 and 18,240 moves (+7%)
    because the fitted curve follows the faired chain more closely than the old resample did, and
    it discards the cubics on the one committed path that keeps them (CNC fairing already rebuilds
    lines), so node editing, SVG export and later rescaling would get dense lines again.
  - The fix is chord-optimal cubic flattening in compile, which ADR-391 deferred because it changes
    the G-code of every curved path. It is still not part of this decision.
- Trace time: warm, alternating runs in one process, median of four: logo 791 to 866 ms and dragon
  9,276 to 10,510 ms (about 10 to 13% slower), for the fit, its two-way checks and the dot analysis.
- Smoothness and Optimize overrides now change Centerline output. The dialog keeps its overrides
  when the preset changes (`ImportImageDialog`'s `traceSettings` state), so an override set under
  another preset (for example Smoothness 0.55 on Line Art) now gives a 33 degree corner angle in
  Centerline, and Smoothness 0 gives the simplified polygon. Before, Centerline ignored both. Any
  saved Centerline settings a retrace restores are read with the new meaning too. Reset the two
  controls to the preset values to get the defaults above.
- Node editing, bounds, hit testing and SVG export read the cubics, as for contour traces.
- Traces committed before this ADR keep their geometry; re-trace to get curves.

Not part of this decision: chord-optimal cubic flattening in compile; exposing the join gap;
changing the speck filter's default; resetting trace overrides on a preset change.
