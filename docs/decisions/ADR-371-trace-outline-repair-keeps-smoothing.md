## ADR-371 - Trace outline repair keeps smoothing on dense drawings (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

### Context

The filled-outline presets (Line Art, Smooth, Sharp, Edge Detection) finish each boundary loop, then
`preserveContourTopologySteps` checks that no finished outline crosses another or changes nesting.
Every outline in a conflict steps down: its curve-fit tolerance halves up to 12 times, then it falls
back to the smoothed chain without a fit, then to the raw pixel boundary. Both outlines of a crossing
pair step down, and every round re-checks the whole drawing.

The 2026-09-24 tracer audit measured this on the dragon fixture
(`src/__fixtures__/perceptual/assets/centerline-stress-test-20260909.png`, 1254 px):

- Line Art ran 21 rounds of the check, over 80% of an 18.2 s trace. 137 of its 1,804 outlines shipped
  without their curve fit, 129 of them as the raw pixel boundary. Together they were 42% of the
  drawing's outline length, including the whole outer outline. Sharp, Smooth and Edge Detection
  behaved the same way (22 to 24 rounds, 21.6 to 29.5 s).
- The corner rebuild (`centerline/sharpen-bends.ts`) extends a bend's straight sides to where they
  meet. It bounds the new tip by the bend's own size, not by neighbouring outlines, and on the dragon
  smoothed neighbours are a median 1.5 px apart. With the fitter bug below fixed, 108 of the 126
  outlines that still fell back to the raw boundary first crossed a neighbour at this step.
- `core/geometry/cubic-fit.ts` accepted least-squares control arms that are out of order. On one
  dragon outline a curve over a 7 px chord got arms of 99 px and 31 px and looped 22 px off the
  drawing. Its error at the data points stayed within tolerance, so the fitter could not see it.
- potrace bounds each adjusted vertex to the unit square around the original path vertex (Selinger
  2003, section 2.3.1). Paper.js's PathFitter, the same Schneider method, falls back to chord/3 arms
  when the arms' projections onto the chord add up to more than the chord.

### Decision

1. `generateBezier` falls back to chord/3 arms when the least-squares arms project onto the chord
   for more than the chord's length, as it already did for degenerate arms. The split recursion
   refits when chord/3 misses the tolerance.
2. A finished loop whose corner rebuild changed it carries `withoutRebuiltCorners`: the same boundary
   finished with full smoothing and no rebuilt corners. On that contour's first conflict the repair
   swaps this finish in, and backs it off only if it still conflicts.
3. The repair halves the fit tolerance at most 4 times, to 1/16 of its starting value, before the
   smoothed baseline and then the source boundary. Later halvings barely moved the curve but each
   cost a full check of the drawing.

### Consequences

- Dragon, before and after: check rounds 21 to 5 (Line Art), 23 to 7 (Sharp), 22 to 7 (Smooth), 24 to 7
  (Edge Detection). Outlines without a curve fit: 137 to 0, 264 to 1, 122 to 4, 237 to 6. Traces run
  3 to 4 times faster. On the Arch House logo the check drops from 15 rounds to 2, and the outlines
  that fell back (2 in Line Art, 4 in Sharp, 1 in Smooth) keep their fit.
- Output changes only where the repair used to fire or a fit used to loop. 43 of the audit's 48
  exact-answer traces are byte-identical, and the other 5 move mean edge error by 0.006 px or less.
- An outline that swaps in its finish without rebuilt corners keeps its smoothing but loses those
  rebuilt tips; the fit rounds them within its tolerance. Outlines that never conflict keep them.
- The fitter is shared with pen-drawing fairing (`round-polyline-curve.ts`, `curve-fairing.ts`), so
  new drawings get chord/3 arms where a fit used to loop. `fairLineCurvePath` already rejected
  looping fits by sampling and retrying. Existing drawings keep their stored curves:
  `CURRENT_POLYLINE_FAIRING_VERSION` (ADR-214) is not bumped, because re-fairing them would change
  geometry the user already approved.
- Both outlines of a crossing pair still step in the same round. Stepping only the outline that has
  a finish to swap could keep more outlines at full tolerance, at the cost of extra rounds; it is not
  measured and not part of this decision.
- `cubic-fit.test.ts` pins the looping run from the dragon; `contour-repair.test.ts` pins the swap
  before any back-off.
