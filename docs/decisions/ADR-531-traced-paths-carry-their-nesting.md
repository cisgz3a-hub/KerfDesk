## ADR-531 - Traced paths carry their nesting, and the crossing guard sees the curves (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This builds on ADR-530 (traced contours reach the scene as compact curves) and ADR-406 (Break Apart
splits a trace into shapes). It changes what the binary filled-contour tracer (Line Art, Smooth,
Sharp) returns, how inside-first cutting and Break Apart learn which outline holds which, and what
the contour topology repair checks. Compile output for scenes without traced nesting, bounds, Frame
and Start (PROJECT.md non-negotiable 21, ADRs 228, 230, 232 and 237) are untouched.

### Context

Measured on the branch base (`claude/tl-geometry-core` at `a4e3954a4`, ADR-530 applied) and on main
(`fa8939b8d`) with the Potrace bake-off harness (TRACE_AUDIT-gated, untracked; Potrace 1.16 run out
of process only to measure its output):

- **Nesting was thrown away and guessed back.** The tracer walks every ink boundary on the pixel
  lattice, where which loop lies inside which is exact, then returned one flat `#000000` path. Holes
  were known only by their shoelace sign and the even-odd rule. Inside-first cutting rebuilt nesting
  with `containmentDepths`: a container's bounds must enclose the target's and the centre of the
  target's bounds must be inside the container. That probe is wrong for a concave target: the hole
  of an outlined C has its bounds centre in the C's mouth, outside the outline, so the hole was
  ordered as a second outer and could be cut after the outline that holds it. Break Apart
  (ADR-406) rebuilt nesting a second way, by a vote of vertex probes.
- **The orientation comment was wrong.** `contour-boundary.ts` said outer loops run
  counter-clockwise on screen. The walker keeps ink on the right of travel in y-down coordinates,
  so a single ink pixel is walked east, south, west, north: clockwise on screen, shoelace area +1.
- **The crossing guard checked the samples, not the curves.** Since ADR-530 a ring's canonical
  output is its cubics; the topology repair tested their compatibility samples, evenly spaced in
  the curve parameter. Three shapes of crossing hid between samples:
  - Hooks: on rings a pixel or two across, the joint tangent (estimated over +-2 px) can point
    against the chord, and the cubic runs past its end point and turns back, crossing its
    neighbouring segment in a loop about 0.01 px across. The Sharp owl's curves, flattened within
    0.02 px, had 96 self-crossings (all on 4 to 6 segment slivers) while its samples had none;
    Line Art owl 1, owl@2x 7, hummingbird luma 3, Smooth owl 4.
  - Spikes: at a corner tip a few degrees wide, the two legs can bend into each other and cross
    within 0.005 px of the tip. On the 4000 px mosaic (Sharp, 2048 px working grid) the curves
    flattened within 0.001 px had 149 crossings, all between adjacent segments at a joint (148
    hooks, 1 spike); the bake-off, flattening within 0.02 source px, counted 30.
  - Lenses: two stretches of curve, of one ring or of two, pass through each other and back
    within a few hundredths of a pixel, a lens thinner than any fixed sampling error. Measured
    after refining the samples at hooks and spikes (the first version of point 5): the curves
    flattened within 0.001 px still crossed in Line Art owl (spike legs, half a pixel from the
    tip), Smooth owl, Line Art hummingbird and hummingbird luma (two different outlines).

Potrace's documented API returns its paths as a signed forest (each path with its sign and its
children), so a consumer never has to rebuild nesting. This decision gives our trace the same
information without adopting Potrace's structure.

Options considered:

- A. Improve the geometric probe in `containmentDepths` (vertex probes, votes). Rejected as the
  primary source: it is still a guess on touching or thin shapes, and it runs on smoothed outlines
  whose nesting the lattice already knew exactly. It stays as the fallback for every path that does
  not carry a valid forest.
- B. Carry the forest in memory only (a WeakMap keyed by the path). Rejected: the trace crosses a
  worker boundary (structured clone), the downscale and upscale routes and the laser commit rebuild
  the path, and a saved project would lose it.
- C. An optional field on the path, validated against the geometry it describes (chosen).

### Decision

1. **Exact forest on the lattice** (`core/trace/contour-nesting.ts`, own design). Before any
   vertex moves, every boundary loop's parent is found by one sweep per pixel row: a scan line
   through the pixel centres meets loops only at their vertical cracks, each crack belongs to
   exactly one loop, so the spans a row's cracks open and close are properly nested and a stack
   gives each loop the loop open around it. It is integer-only and O(E log E) in vertical cracks.
   Crossing spans, a loop off the lattice, or depth parity that disagrees with orientation (ink
   boundaries at even depth, positive area) return no forest, and the path is emitted without one.
   Loops dropped by the speckle gate are skipped by re-parenting to the nearest kept ancestor.
2. **Carried on the path** (`ColoredPath.subpathNesting` in `core/scene/scene-object.ts`,
   `core/scene/subpath-nesting.ts`): the parent of every subpath (-1 for an outer) and a 64-bit key
   of the canonical geometry it was computed for (every subpath's closure, segment kinds and
   coordinates; curves when present, else the polylines read as straight-segment curves, so a
   save that materializes curves keeps the key). Readers go through `carriedSubpathParents`, which
   returns the parents only while the key matches and the forest is well formed (one entry per
   subpath, each parent an earlier closed subpath). Any writer that rebuilds a path with
   `{ ...path, curves }` therefore cannot pass a stale forest on; it silently falls back.
   Stages that keep containment by construction re-stamp the key: the downscale and upscale routes
   and the boundary crop offset (`scaleTracedPaths`, `scaleTracedPathsUniform`,
   `offsetColoredPaths`: affine maps with positive determinant), the laser commit
   (`simplifyTracedPathsForLaser`, whose topology check keeps every nesting relation) and Break
   Apart pieces (`subsetSubpathNesting`: nearest kept ancestor). Region Enhance, the CNC fairing and
   node editing drop it, and their consumers probe as before.
3. **Order and orientation.** The tracer emits outers before their holes, each hole before the
   islands inside it (pre-order of the forest, siblings in scan order), so every parent precedes
   its children. Outers have positive and holes negative signed area in path coordinates (y down:
   clockwise and counter-clockwise on screen). The topology repair already keeps every outline's
   orientation equal to its lattice loop's; the tracer checks it and attaches the forest only
   when it holds. With alternating orientation and proper nesting every winding number is 0 or 1,
   so even-odd and nonzero fill the same region.
4. **Consumers read it, the old test is the fallback.**
   - Inside-first cutting: `compileJob` gives each line-mode segment of a path with a valid forest
     its depth and a forest key unique to that object's path (`CutSegment.nesting`).
     `containmentDepths` never probes contours of the same forest against each other and adds
     their carried depth; containers from other paths are probed as before. The tabs step keeps a
     contour's nesting, whether the contour takes no tab or is split into open pieces (each piece
     lies at its contour's depth). Kerf-offset contours are rebuilt, carry nothing and probe as
     before.
   - Break Apart (`groupSubpathsByOuterShape`): the carried forest is the tree; the probe vote of
     `loop-nesting.ts` runs only without it.
   - Fill needs no forest: scanline fill applies the fill rule, Follow Shape uses the Clipper
     PolyTree, and Island fill groups overlapping bounds. What fill gains is point 3: a trace fills
     identically under either rule.
5. **The guard sees the curves** (`core/trace/compact-curve-contacts.ts`,
   `core/trace/compact-curve-meet.ts`, own design from the convex-hull and subdivision properties
   of Bézier curves). Each repair round now tests the fitted curves as well as their samples. A
   fitted ring is cut into pieces (its lines, its cubics halved to about 3 px of control polygon)
   whose control-point boxes go in a box index. Pieces whose boxes meet, of two rings or of one,
   are tested by halving the larger until their boxes separate (they do not meet) or both lie
   within 1e-4 px of their chords, where chords closer than the two flatnesses count as meeting.
   A piece against its neighbour ignores the joint they share and ends at once when a line through
   the joint separates their control points (every smooth joint); a piece against itself is
   halved only while its control points do not run monotonically along its chord (a loop needs
   the curve to turn back). So every crossing and every touch of the curves is found, and a near
   miss is reported only below 2e-4 px. A ring whose curves meet is backed off like any other
   conflict (the finish without rebuilt corners, weaker refinement, the smoothed baseline, then
   the source boundary). The first round tests every pair of rings whose boxes meet; a later round
   re-tests only the pairs a ring it changed is in and keeps every other result (a randomized test
   checks this against a from-scratch run). Line against line stays with the sample test, which is
   exact for straight edges, and a path with no fitted curve (the laser commit guard) skips the
   check.
   The samples themselves go back to ADR-530's even sampling (about one vertex per 1.5 px, within
   0.02 px): a first version of this decision refined the samples instead (recursive halving,
   finer next to spikes). That still missed lens crossings thinner than its 0.02 px sampling
   error, and it grew the stored compatibility polylines by 30 to 55 percent and Sharp trace time
   by up to 60 percent.

### Measurements

Bake-off harness (owl and hummingbird, TRACE_AUDIT-gated, one timing run), this decision
(`7f88e6375`) against ADR-530 (`a4e3954a4`) and main (`fa8939b8d`). Crossings are the harness's
proper crossings of the output flattened within 0.02 source px.

| art / preset | IoU main / ADR-530 / this | crossings main / ADR-530 / this |
| --- | --- | --- |
| owl Line Art | 0.8655 / 0.8947 / 0.8947 | 2 / 1 / 0 |
| owl Line Art, luma | 0.8655 / 0.8947 / 0.8947 | 2 / 1 / 0 |
| owl Sharp | 0.9164 / 0.9231 / 0.9231 | 0 / 96 / 0 |
| owl Smooth | 0.8389 / 0.8795 / 0.8794 | 0 / 4 / 2 |
| hummingbird Line Art | 0.8147 / 0.8448 / 0.8448 | 0 / 0 / 0 |
| hummingbird Line Art, luma | 0.8490 / 0.8839 / 0.8839 | 1 / 3 / 2 |
| hummingbird Sharp | 0.9129 / 0.9186 / 0.9187 | 2 / 68 / 0 |
| hummingbird Smooth | 0.8204 / 0.8600 / 0.8600 | 0 / 1 / 0 |

- **The curves do not cross.** A probe flattening the same curves within 0.001 px found 0
  crossings in all nine owl, owl@2x and hummingbird cases (Line Art, luma, Sharp, Smooth). The 2 + 2
  the bake-off still counts are flattening artefacts: in hummingbird luma two adjacent segments leave
  a spike tip 0.24 px long, in Smooth owl two legs of one ring pass within less than 0.02 px, and
  two independent 0.02 px flattenings of them cross. Owl@2x shows a few such artefacts in Line
  Art and Sharp at 0.02 px and none at 0.001 px.
- **Output size:** segments +0.0 to +0.2 percent (owl Line Art 34760 to 34819), contour counts
  unchanged; Sharp SVG bytes fall 3 to 4 percent, IoU moves by at most 0.0001.
- **Cost of the curve guard**, same process, guard off then on, two runs each: owl Line Art 9.6-10.3
  to 10.3-10.4 s (+0 to 9 percent), owl Sharp 12.7-13.1 to 15.0-15.2 s (+15 to 19 percent),
  hummingbird Line Art 6.0-6.1 to 6.6-6.9 s (+10 to 13 percent), hummingbird Sharp 8.2-9.2 to
  9.8-10.0 s (+9 to 20 percent). Dense binary noise costs more: a 200 px noise field, same A/B,
  reads Line Art 7.2-9.2 to 9.3-9.9 s (+8 to 29 percent), Sharp 4.5-4.6 to 5.1-5.2 s (+10 to 15
  percent) and Smooth 6.3-6.6 to 7.2-7.3 s (+10 to 17 percent); the review's own A/B read Smooth
  +17 to 28 percent, so take about +25 percent for noisy art. Halftone, anti-aliased rings and
  checker art stay within noise. The forest itself is one integer sweep per pixel row and does not
  show above noise. The bake-off's single timing run (noisy, other worktrees active) read owl Line
  Art 8.4 to 10.0 s and hummingbird Line Art 5.4 to 6.5 s against ADR-530.
- **Tests:** six nested square bands (depths 0 to 5, outers first) and B, 8 and @ glyph topologies
  and islands inside holes in all three presets; a thin hollow C whose bounds-centre probe reads
  depths `[0, 0]` without the forest and `[0, 1]` with it (inside-first order of the compiled job
  flips the same way); a 62-blob field with rings inside holes; even-odd and nonzero agree at every
  sample of every fixture; saves without the field, with a malformed field or with moved geometry
  load and fall back to the probe.

### Consequences

- A binary trace knows its own nesting exactly, in memory, across the worker, through save and
  load (schema v9, no version bump: an older reader ignores the optional field and gets the same
  job it computes today) and through the laser commit.
- Inside-first cutting is exact within a trace; it still probes between separate objects.
- The tracer's subpath order changes (outers first). Nothing depends on the scan order.
- The forest is all or nothing per path: if the row sweep finds spans that do not nest, or any
  one ring's orientation disagrees with its depth parity, the whole path carries no forest and
  every consumer falls back to the probe. No test or real-art trace has triggered this (in the
  review's probes 137 synthetic paths and 6 real-art paths all kept their forest), but a single bad ring degrades the
  whole trace, not only its own subtree.
- A traced contour on a layer with tabs keeps its nesting through the tabs step, so a hole inside
  a tabbed outline now orders before the outline's pieces. Previously the split outline was no
  container and the hole read depth 0.
- Known gaps: the Edge Detection lane shares the finisher but filters loops by length afterwards
  and carries no forest yet (it does get the curve guard); Region Enhance and the CNC fairing drop
  the forest; kerf-offset contours probe; Island fill still groups by bounds. The guard proves the
  curves disjoint, not a clearance between them: a flattening of two curves that pass within its
  tolerance of each other can still show a crossing its curves do not have (the bake-off's 0.02 px
  flattening does, at a few near misses; compile's machine-tolerance flattening can too).

Not part of this decision: a minimum clearance between curves; carrying the forest through the Edge
lane, Region Enhance and CNC fairing; forest-aware Island fill grouping; fixing the joint tangent
estimate on rings smaller than its window (the cause of the hooks, which the guard now repairs).
### Integration audit (2026-09-28)

The current compiler applies kerf over a whole layer, then supports automatic, placed
and powered tabs. Carried nesting survives each tab span and perforated dash. When all
contours are open pieces, their carried depths still order holes before outlines; an
empty geometric-container list must not replace those depths with zero. Regression
jobs exercise tabs on both inner and outer contours, tab power, and perforation through
the compiler and optimiser. Main's strict containment rule is retained for coincident
bounds, and kerf rebuilding still falls back to geometric containment.

### Amendment 1 - the curve guard skips pieces the samples keep apart, same output (2026-09-29)

Each repair round runs the sample test and then the curve guard of point 5 on the same rings, and
the guard's work is nearly all proof that pieces do not meet. On the centerline stress test (Line
Art) the guard tested 17,803 pairs of rings and 3,382 rings against themselves, and in 17,680 of
those pairs no sample edge of one ring comes within 0.045 px of the other. The sample test now
records that, and the guard skips the work it proves unnecessary:

- `ContourBoxIndex.overlapIdsSteps` takes an optional margin, default 0 (the same comparisons on the
  same doubles as before), and tells its visitor whether the two boxes themselves overlap.
- `ContourContactCache` visits the edge pairs of a measured pair of boundaries, and of each boundary
  against itself, whose boxes come within `SAMPLES_NEAR_PX` = 0.045 px. The contact test still runs
  only on pairs whose boxes overlap, so every contact and every earliest-contact choice is
  unchanged. Next to its cached contacts, each pair records whether two of its edges come within
  0.045 px, and each boundary whether two of its edges that are not neighbours do (`samplesNear`,
  `samplesNearItself`: undefined when the cache has not measured the pair or the boundary). The
  coarse cells that decide which pairs are measured are widened by the same 0.045 px. A pair that
  shares no widened cell has no edges that close, and a pair that shares a cell only once widened
  has no overlapping edge boxes, so no contact is lost or added.
- `CurveContactCache`, given those lookups by `preserveContourTopologySteps`, skips `ringsMeet` for
  two rings only when `samplesNear` is exactly false. When `samplesNearItself` is exactly false and
  the ring's pieces were not halved to make up four (`RingPieces.halved`), `ringMeetsNeighbours`
  tests each cubic piece against itself and against the pieces one and two places along the ring
  either way, under the same joint rules, instead of every pair of pieces whose boxes meet. With
  fewer than six pieces every two are that close, and the full test runs.

Why no verdict can change (each step re-derived for this amendment):

1. A ring carries a curve only as `curvedTraceRing(sampleCompactCurve(curve), curve)`
   (`compactRefinement`); `closeContour` passes such a ring through unchanged or makes a new ring
   without a curve. A line segment is one sample edge. A cubic is sampled at n even parameter steps,
   n at least `cubicFlatnessSteps` for 0.02 px: the distance from B(t) to the chord of its step is at
   most h^2/8 x max|B''| (the linear interpolation error, which holds for a vector-valued curve in
   its integral form), and |B''| is at most 6 x the larger second difference of the control points,
   the bound `cubicFlatnessSteps` meets. So every point of a fitted curve lies within 0.02 px of the
   edge of its own sample step.
2. `piecesMeet` reports a meeting only for two leaves within 1e-4 px of their chords whose chords
   come within the two flatnesses. Every chord point is within its flatness of its curve, so the
   curves come within 4e-4 px. The depth cap never decides: 2^k >= len / 3 pieces of a control
   polygon of length len have second differences of at most len / 4^k <= 3 px, each halving
   quarters them, and a piece's flatness is at most its largest second difference, so a piece is
   flat to 1e-4 px after 8 halvings and a pair after 16 of the 48.
3. Two rings: pieces that meet put two curve points within 4e-4 px, each within 0.02 px of an edge
   of its ring, so two edges come within 0.0404 px; the rest of 0.045 px is room for rounding. The
   edge distance is the least end-to-edge distance, or 0 for a crossing; the sign test misses a
   crossing only when an end lies within rounding of the other edge, where the end distance finds
   it. Two such edges have boxes within 0.045 px (visited under the margin) and widened boxes that
   share a cell (the pair is measured). A pair the cache has not measured is tested in full.
4. One ring: a cubic is cut into 2^k pieces of equal parameter length, and 2^k is at most its sample
   steps. 2^k = 2^ceil(log2 m) with m = max(ceil(len / 3), 2 for a cubic that returns to its start,
   else 1), and the samples take at least max(4, ceil(len / 1.5)) steps of the same polygon length:
   for m = ceil(len / 3) >= 2, 2^ceil(log2 m) <= 2m - 2 <= ceil(len / 1.5), and otherwise
   2^ceil(log2 m) <= 2 < 4. A single piece need not hold a whole step, but two pieces in a row always
   do: two of one cubic span two steps, the last piece of a cubic covers its last step and the first
   piece its first, and an unhalved line is itself an edge. A curve point that is a sample lies on
   both edges at that sample, so the points of the pieces on either side can be placed on edges
   before and after the held step. Pieces three or more places apart both ways round the ring
   therefore lie on edges that are not neighbours, and a meeting between them makes the ring near
   itself. Both limits are tight: pieces two apart can lie on neighbouring edges (a cubic of 5 steps
   in 4 pieces: the first and third lie on edges 0 to 1 and 2 to 3), so they are tested, and pieces
   three apart can lie on edges two apart, so the flag counts edges two apart. A halved ring has
   lines of half an edge and pieces shorter than a step, and keeps the full test. A repeated sample
   point, or a closing edge that is not a sample step, only adds edges, which can only turn a flag
   to near.
5. Line against line is tested by neither path: the sample test is exact for straight edges.

Equivalence instrument: a SHA-256 of the whole traced output (every path, polyline vertex and curve
coordinate). It is unchanged from `9fdc73cd0` on noise192 (Line Art, Smooth, Sharp, Edge
Detection), noise512 Line Art, the centerline stress test (Line Art, Smooth, Sharp), astronaut (Line
Art, Smooth, Sharp, Edge Detection) and the arch house (Line Art, Sharp). The parity oracle
(`TRACE_PARITY=1`, light corpus, 66 cases) recorded on `9fdc73cd0` passes. Tests pin the margin
against brute force, the flags at 0.03 and 0.06 px (between rings and within one), curves that meet
between their samples, and the guard with and without the lookups on random rings, looped and
cusp-like cubics included.

How often the skips apply (Line Art; a pair is counted each time the guard reaches it, a ring once):

| Case | Pairs skipped / near / not measured | Rings by neighbours / full, near / full, under six pieces or halved |
|---|---|---|
| centerline stress test | 17,680 / 9 / 114 | 2,485 / 424 / 473 |
| noise512 | 44,128 / 601 / 161 | 3,472 / 317 / 2 |
| noise192 | 4,313 / 66 / 10 | 476 / 41 / 1 |

Measured (node bundles, one process per run, base and change interleaved in alternating order on a
machine running other benchmarks, so only ratios within a round mean anything; the splits come from
a timing wrapper around each named function, and self tests are the guard's per-ring entry):

| Case | Base (`9fdc73cd0`) | After |
|---|---|---|
| stress test Line Art, whole trace, 3 rounds | 6.51 / 6.79 / 6.98 s | 6.14 / 6.59 / 6.38 s |
| noise512 Line Art, whole trace, 3 rounds | 24.5 / 25.9 / 23.4 s | 21.6 / 22.8 / 21.7 s |
| stress test, `preserveContourTopologySteps`, 2 rounds | 2.42 / 2.53 s | 2.16 / 2.15 s |
| stress test, `ringsMeet` | 407 / 489 ms (17,803 calls) | 6 / 6 ms (123 calls) |
| stress test, self tests | 390 / 452 ms | 384 / 371 ms |
| noise512, `preserveContourTopologySteps`, 2 rounds | 17.1 / 17.0 s | 15.7 / 15.4 s |
| noise512, `ringsMeet` | 1,542 / 1,539 ms (44,890 calls) | 626 / 676 ms (762 calls) |
| noise512, self tests | 1,372 / 1,485 ms | 1,132 / 1,113 ms |

The whole trace is 3 to 8.5 percent faster on the stress test and 7 to 12 percent on noise512. Of
the self tests after the change, the full tests took 207 / 214 ms (897 rings, 389 of them under six
pieces and reached through `ringMeetsNeighbours`) and the neighbour tests 178 / 161 ms (2,874 rings)
on the stress test; 844 / 869 ms (319 rings) and 272 / 231 ms (3,474 rings) on noise512. The near
flags cost the sample test up to about 10 percent: run cold (fresh caches) on every round's rings
of a trace, 7 runs each, it took 983 / 994 ms before and 1,076 / 1,087 ms after on the stress test
(minimums; medians 1,144 / 1,088 and 1,211 / 1,202 ms), 6,323 / 5,878 ms before and 6,827 / 5,859
ms after on noise512 (medians 6,834 / 6,441 and 7,422 / 6,843 ms). The laser commit guard pays this
too, and its rings carry no curve to skip. The wrapped `intersectingContourLoopsSteps` and
`ringPiecesSteps` times move both ways between runs (they absorb collection pauses from the rest of
the repair). Peak RSS stays within collector noise: noise512 958 to 1,128 MB after against 1,015 to
1,080 MB before over 7 and 6 runs, and under `--trace-gc` the largest heap before a full collection
was 675 MB after against 737 MB before.

What is left: the self tests of rings whose samples are near themselves, and the pair tests of
rings whose samples are near somewhere, still test every piece. On noise512 those 319 rings and 762
pairs take about 1.5 s. Of the rings near themselves, 233 of 424 on the stress test and 206 of 317
on noise512 are near only through edges two apart, mostly because the edge between them is shorter
than 0.045 px (median 0.04 px), which puts its two neighbours that close by itself. Testing only
the pieces around the near edges, or a flag that ignores edges two apart, would need its own
argument and is not attempted here.

### Amendment 2 - the curve guard keeps pieces only while a pair test needs them, same output (2026-09-29)

On uniform noise the repair's live heap grew by about 100 MB a round on noise512 (Line Art), all
of it in the curve guard. Measured with a full collection as each round's guard ends, rounds 1 to
3: 268, 381 and 465 MB, against main's 159, 235 and 241 MB at the same point of each round (main
has no curve guard). A heap snapshot of noise192 at round 3 (87 MB) put 30 MB in the guard's
rings. Two copies of the background ring, neither with a fitted curve, held 11.6 MB each, 10.5 MB
of it in the index of their straight pieces, which made one object per edge. Most of the rest were
pieces of rings the repair had already replaced, which it never tests again.

- `CurveContactCache` now keeps, per ring, its box, whether it has cubic pieces and its self-test
  result (`RingSummary`). A fitted ring is cut into pieces for its self-test and the pieces are
  dropped. A ring without a fitted curve (`piecesCurve` undefined) is not cut at all: its box comes
  from its points (`straightRingBox`). A ring's pieces are cut again the first time a pair test
  needs them and kept on its summary until the repair replaces the ring, when they are dropped.
- A ring with more than 16 straight pieces indexes them through `ContourBoxIndex.overBoundsSteps`
  over their boxes, making each into a piece only when a query finds it.

Why no verdict can change: `ringPiecesSteps` is a pure function of the ring, so pieces cut again
are the same pieces, and dropping them only costs a later cut. A straight ring's pieces' box is
the box of its points, because halving adds only midpoints, and it has no pieces exactly when
every point is the same, which `straightRingBox` reports as null. The straight index is built over
the same boxes in the same order as before, so its tree and query order are the same and each
query returns equal pieces. A replaced ring never returns: a ring only moves on toward its source,
and if it did return, its pieces would be cut again. Tests pin the straight box against the
pieces' on random rings with repeated points, and the straight index on a 400-edge ring beside a
fitted circle.

Whole-output hashes are unchanged against `144593dab` on noise192 (Line Art, Sharp), noise512 and
noise1024 (Line Art), the astronaut (Line Art, Sharp), the centerline stress test, the arch house
and text-sans-96 (Line Art).

Measured (node bundles, one process per run, interleaved; the live heap under `--expose-gc` with a
collection at each mark):

| noise512 Line Art | Main | Before | After |
|---|---|---|---|
| Live heap as the guard ends, rounds 1, 2 and 3 | 159, 235, 241 MB | 268, 381, 465 MB | 236, 256, 259 MB |
| Peak RSS | 681 to 734 MB (4 runs) | 870 to 913 MB (4 runs) | 692, 719 MB |
| Time | 7.5 to 8.7 s | 10.0 to 11.7 s | 10.0, 10.7 s |

Peak RSS on noise1024 Line Art was 2,230 MB against main's 2,120 MB (one run each, 1.05x), on
noise192 Line Art 189 and 198 MB against main's 175 and 181 MB, and on the real images in the set
between 7% below main's (the stress test, 372 and 373 MB against 396 and 401 MB) and 3% above (the
arch house). Time is unchanged within run-to-run noise: over 3 interleaved rounds the stress test
took 5.63 to 5.99 s after against 5.76 to 6.02 s before.

What still separates the branch from main on noise is the repair's input: the live heap as the
repair starts is 191 MB against main's 110 MB (the samples at 0.02 px and the finished contours).
That is a follow-up the tracer work owns (ADR-530, Known gaps).
