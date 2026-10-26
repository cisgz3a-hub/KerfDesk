## ADR-669 - Inside-first works part by part, and Reduce travel refines its route

**Status:** Accepted; software-verified with synthetic emitted programs and the project's GRBL
planner clock. No air-cut, material or hardware trial yet. | **Date:** 2026-10-24

Amends ADR-163 (Cut Planner policies) and the inside-first ordering it governs, including Cut in
direction order (`directional-order.ts`), the topology packet planner of ADR-486 Amendment 2, and
manual Job start selection. Layer, group, operation, pass and tab-power order are unchanged. CNC
ordering (ADR-276, ADR-310) is unchanged: CNC groups do not enter this planner. Frame, Start,
Job Review policy and the licence gates are unchanged (PROJECT.md non-negotiable 21, ADR-565).

### Context

A path-order audit (`scripts/audit-path-order-math.mjs`) compared the shipped planner with
constraint-respecting alternatives, holding the burn moves, feed, power, passes and group order
equal and timing each program with `estimateJobDuration`. It found the ordering correct but
optimizing the wrong thing:

- **Inside-first was depth-major across a whole group.** Every contour at the deepest level ran
  before any at the next. On a sheet of 24 parts with two holes each, all 48 holes ran before the
  first outline; with Cut in direction order the sheet was swept once for holes and again for
  outlines. CNC fixed exactly this in ADR-276 (the Drive/Safe field incident); laser did not.
  Depth-major guarantees "contained before container" only because containment means strictly
  deeper, and that is all the rule needs.
- **Nearest-neighbour was the whole planner.** Tour studies put greedy nearest-neighbour about 25
  percent above optimal on geometric instances, and 2-opt within about 5 percent (Johnson and
  McGeoch, *The Traveling Salesman Problem: A Case Study in Local Optimization*, 1997). The
  laser-cutting literature models the problem as a precedence-constrained generalized TSP, with
  inner contours as precedence constraints, not as a level-by-level sort (Dewil, Vansteenwegen and
  Cattrysse, KU Leuven, *A review of cutting path algorithms for laser cutters*).
- **The objective left out the park.** The GRBL postamble returns to `G0 X0 Y0`, so the program is
  a closed tour, but the planner scored an open path. On a scattered 60-shape sheet the shipped
  route ended 436 mm from the park.
- **A manual Job start broke the route.** The chosen contour moved to the front and the rest kept
  the route planned from the seed, so the second hop crossed the sheet back to the origin.

### Decision

1. **Inside-first holds, part by part** (`inside-first-holds.ts`). A container is ready once no
   strictly deeper item whose bounds lie inside its bounds is still waiting; planners choose only
   among ready items. Anything truly inside a contour is deeper and inside its bounds, so every
   precedence depth-major kept is kept. A deeper shape that merely sits in a container's bounds
   (in the notch of a C) only delays it. Only strictly deeper items hold, so the deepest waiting
   item is always ready and the route cannot deadlock. The rule needs depths but no parents, which
   matters because carried trace forests (ADR-531) give depths only.
   - Pieces that tabs or perforation cut from one contour hold as the whole contour: the union of
     the bounds of every piece with the same `topologyContour` (or, for historical pieces, the same
     forest and depth, which is wider and only delays). An open path that is no contour piece
     encloses nothing.
   - The nearest-entry index takes an optional, non-monotone eligibility test: a held entry is
     skipped, never retired, so it can win once released (`segment-entry-index.ts`).
   - Cut in direction order takes the ready item with the least sweep key, so the sheet is swept
     once. The topology packet planner applies the same holds to packets, with each packet's member
     boxes as what it cuts and its union box as what it encloses.
   - If a held segment is ever left unplaced (one whose blocker has no usable entry), the former
     depth-major route is used instead.
2. **Route refinement** (`route-refine.ts`). After nearest-neighbour, 2-opt (both orientations,
   over 16-nearest neighbour lists) and Or-opt (chunks of 1 to 3, forwards or reversed) improve the
   route, scored as a tour from the group's planning start back to its planning seed: where the
   park and the next group start. A move is rejected when it would cut an item before one it holds
   back, flip an item that may not be flipped, or displace a Line burn start's first contour. A
   closed contour is never flipped; an open path flips only under Allow reverse. Closed starts
   under Nearest point or Nearest corner are chosen again along the refined route. The work is
   bounded by a step count (256 per item plus 2^20), never by time; distances use only IEEE-exact
   operations, so output stays deterministic (PROJECT.md non-negotiable 5).
   - When the given order already keeps inside-first and is strictly shorter than the
     nearest-neighbour route, refinement starts from it. So a route is never made longer than the
     order it came in, and planning a planned job returns it.
   - Refinement applies to Line groups, Offset Fill rings, single-pass topology groups and, as whole
     packets that keep their passes and contour routes, to the topology packet route. It does not
     apply under Keep source order or Cut in direction order.
3. **Job start re-plans the rest.** `applyJobStartPoint` plans the rest of the first group again
   from where the chosen contour ends, under the same settings and refinement. Any segment nothing
   deeper waits inside may be chosen (formerly only the deepest contours), which matches the
   segments the planner itself may start with. Keep source order and Cut in direction order still
   keep their order behind the chosen contour.

### Measurements

`scripts/audit-path-order-math.mjs`, default 400 x 400 GRBL profile at 6000 mm/min and 500 mm/s²,
cut at 1200 mm/min unless stated. Before is `a9ad5080c`; after is this change. Burn moves are equal
in every pair (asserted), and an independent rectangle oracle checks containment precedence.

| Fixture | Rapid mm before → after | Job time before → after |
| --- | --- | --- |
| 24 parts × 2 holes | 3087 → 2318 (−24.9%) | 342.3 → 334.5 s (−2.3%) |
| Same, Cut direction top to bottom | 5255 → 3925 (−25.3%) | 363.9 → 350.6 s (−3.7%) |
| 60 scattered squares | 2739 → 2119 (−22.7%) | 130.5 → 124.3 s (−4.7%) |
| Same at 6000 mm/min cut | 2739 → 2119 (−22.7%) | 93.6 → 87.4 s (−6.6%) |
| 48 clustered squares | 1653 → 1408 (−14.8%) | 88.9 → 86.4 s (−2.8%) |
| 10 × 10 grid of squares | 1080 → 1000 (−7.4%) | 141.3 → 140.5 s (−0.5%) |
| 9 squares | 779 → 670, equal to the exhaustive optimum | 21.7 → 20.6 s (−5.0%) |
| 48 squares, drawn starts | 2364 → 2185 (−7.6%) | 327.3 → 325.5 s (−0.5%) |
| Job start at the far corner | 3196 → 2664 (−16.6%) | 335.6 → 330.3 s (−1.6%) |

The 60-square route after refinement (2119 mm) is shorter than an unbounded exhaustive 2-opt and
Or-opt pass from the same start (2149 mm). Clustered layouts keep a gap of about 3 percent to that
reference. Rapid share, and so the time saved, grows with cut speed and part count.

### Consequences

- G-code changes for jobs with nested Line work, and for most jobs with more than a few contours,
  whenever Reduce travel is on. Keep source order output is unchanged, and so are Fill, Image and
  CNC output.
- The sealed pre-K1 `mixed-open` program is now checked for equal burn moves and no more travel,
  not for equal bytes; every other sealed program keeps its bytes.
- Tests that asserted depth-major order now assert containment precedence. The stress script's
  greedy oracle now bounds the tour from above instead of requiring equality.
- Distance is still the cost. Controller cycle time (acceleration on short hops, junction speed)
  is not scored; a planner-clock cost is the natural next step if measurements call for it.
- Groups still start from their own planning seed rather than the previous group's exit. The audit
  measured that a bare hand-off made routes longer, and only about 2 percent shorter with refinement.
- Not part of this decision: CNC part order (deliberate source order under ADR-276, a workholding
  choice), heat-aware ordering, and common-cut sequencing beyond the existing shared-edge cleanup.
