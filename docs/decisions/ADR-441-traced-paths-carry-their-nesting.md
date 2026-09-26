## ADR-441 - Traced paths carry their nesting, and the crossing guard sees the curves (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This builds on ADR-440 (traced contours reach the scene as compact curves) and ADR-406 (Break Apart
splits a trace into shapes). It changes what the binary filled-contour tracer (Line Art, Smooth,
Sharp) returns, how inside-first cutting and Break Apart learn which outline holds which, and what
the contour topology repair checks. Compile output for scenes without traced nesting, bounds, Frame
and Start (PROJECT.md non-negotiable 21, ADRs 228, 230, 232 and 237) are untouched.

### Context

Measured on the branch base (`claude/tl-geometry-core` at `a4e3954a4`, ADR-440 applied) and on main
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
- **The crossing guard checked the samples, not the curves.** Since ADR-440 a ring's canonical
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
   The samples themselves go back to ADR-440's even sampling (about one vertex per 1.5 px, within
   0.02 px): a first version of this decision refined the samples instead (recursive halving,
   finer next to spikes). That still missed lens crossings thinner than its 0.02 px sampling
   error, and it grew the stored compatibility polylines by 30 to 55 percent and Sharp trace time
   by up to 60 percent.

### Measurements

Bake-off harness (owl and hummingbird, TRACE_AUDIT-gated, one timing run), this decision
(`7f88e6375`) against ADR-440 (`a4e3954a4`) and main (`fa8939b8d`). Crossings are the harness's
proper crossings of the output flattened within 0.02 source px.

| art / preset | IoU main / ADR-440 / this | crossings main / ADR-440 / this |
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
  Art 8.4 to 10.0 s and hummingbird Line Art 5.4 to 6.5 s against ADR-440.
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
