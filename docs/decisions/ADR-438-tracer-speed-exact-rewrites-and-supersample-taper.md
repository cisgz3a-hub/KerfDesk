## ADR-438 - Tracer speed: output-identical rewrites, a corner-rebuild budget and a supersample taper (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

Amends ADR-128 (measured-boundary pipeline, supersampling) for sources just below the working-pixel
budget, and ADR-371 (outline topology repair) only in how its checks are computed. Trace output,
G-code, bounds and the Frame-first contract are otherwise untouched.

### Context

The 2026-09-25 tracer bake-off timed Potrace 1.16 at about 0.25 s on the owl (1254²) and 0.19 s on the
hummingbird, against 4.2 s and 2.9 s for main's Line Art. It also measured a 1024² noise image at
178 s, a 1200² ring image with 1-px strokes at 13.2 s, seconds for 192² noise in Edge Detection, Smooth
and Line Art, and a 4x step in working pixels between 1224² and 1225² sources (the 2x quality
supersample stops fitting the 6 M-pixel contour budget there).

Profiles of the base (`claude/tracer-lead-potrace`, fa8939b8d) put the time in:

- the closed-ring corner rebuild (`sharpenChainBendsSteps`): every rebuilt corner rotated a copy of
  the whole ring and restarted the scan, so a ring with k corners cost k full rescans and k copies;
- the outline topology repair: every round rebuilt a box tree over all outlines, re-measured every
  overlapping pair and walked every edge of the smaller outline of each pair against the other;
- in Centerline, four scans over all chains or all junctions per step: junction pairing looked up
  chain ends by scanning every chain for every junction, gap bridging rescanned every open end
  after each bridge, spur pruning rebuilt the whole degree map for each dissolved junction, and
  tip extension and seam repair scanned every junction per chain end; thinning ran one heap
  comparator per step that read the distance field.

### Decision

1. **Output-identical rewrites.** Each of these computes exactly what it replaces (canonical curves
   identical to the last bit on every fixture below):
   - Closed rings (`centerline/ring-bend-scan.ts`) keep the rotate-and-restart visiting order (the
     settled corner set depends on it), but judge each candidate on a bounded stretch of ring, store
     the ring once with a rotation offset and splice each rebuilt corner in place, keep edge lengths
     and prefix sums instead of re-measuring, and remember rejections until a rebuild lands inside
     the stretch they read. Every corner gate reads edge lengths from that table
     (`bend-geometry.ts`), and the concentration gate walks its two windows once.
   - The topology repair keeps overlapping pairs and their verdicts across rounds for outlines that
     did not change (`contour-pair-cache.ts`), skips pairs whose edges share no 8-px cell, walks only
     the edges of one outline that lie inside the other's box, indexes edges in sorted bands
     (`contour-edge-bands.ts`) and answers orientation signs with Shewchuk's filtered determinant
     before the exact fallback.
   - Centerline: a chain-end index for junction pairing, a queue of bridgeable pairs that re-measures
     only the two chains a bridge joins (`bridge-queue.ts`), a first-incidence queue for dissolving
     junctions (`passthrough-queue.ts`), a bucket queue for thinning keyed on the integer squared
     distances (`erosion-queue.ts`), and one point grid per junction list (`point-grid.ts`).
   - Smaller constant-factor work: typed buffers in curvature smoothing, reused distance-transform
     scratch, precomputed bilinear taps.
2. **A corner-rebuild budget per trace.** Attempts are capped at max(32,768, 0.1 x working pixels).
   It is a worst-case bound for colour noise thresholded into meandering outlines (measured 0.12 to
   0.14 attempts per pixel); traced art stays far inside it (owl 0.043 per pixel at most, hummingbird
   0.033, every perceptual fixture 0.025 or less), so no fixture reaches it. Uniform RGB noise does:
   from about 240² up (measured at 240², 280², 320², 700² and 1024² in Line Art) the budget runs out
   and the output differs from an uncapped trace; 192² noise stays inside the 32,768 floor. Once
   spent, remaining rings keep their dense geometry. A per-loop noise gate was rejected: owl rings with 65-89% of
   vertices past the quick turn gate carry 52-109 genuine rebuilt corners each.
3. **A supersample taper at the budget edge, for the outline presets only.** Where the 2x grid would
   fill between 75% and 100% of the contour budget (sources 1060²-1224²), the factor eases from 2 to
   sqrt(1.2) so working pixels fall linearly from 4x to 1.2x of the source, on a rounded bilinear grid
   (`upscaleToWorkingGrid`), mapped back per axis (elliptical arcs through the exact affine ellipse
   transform, `transformVectorCurve`). The support restoration of ADR-128 follows the rounded grid,
   and the pinhole radius cap rounds up to whole pixels (both reduce to the old arithmetic on integer
   grids). Centerline and Edge Detection do not taper: they read the position of 1-px strokes from
   the working grid, and a fractional grid samples each row at a different sub-pixel phase. On a 950²
   page of 1-px lines (1.51x) the row-150 Centerline drifted up to 0.81 px off the stroke centre and
   grew hooked ends (13 points instead of 2; 2x keeps every row at +0.25 to +0.35 px, native +0.00
   to +0.19), and the Edge Detection outline offset varied from row to row (low side -1.04 to -1.59
   px; 2x gives -1.28/+1.30 on every row). Those two modes keep the integer policy and its 4x step
   at 1000²/1001² of their 4 M-pixel budget.

### Measurements

Best of three, base and new traced alternately in one process, on a machine shared with about ten
agents (a quieter hour gave owl Line Art 3.66 s to 1.83 s and hummingbird 2.43 s to 1.43 s):

| Source | Line Art | Smooth | Sharp | Edge Detection | Centerline |
|---|---|---|---|---|---|
| owl 1254² | 4.76 -> 2.08 s | 4.79 -> 2.20 | 10.03 -> 4.10 | 7.63 -> 3.38 | 14.99 -> 2.04 |
| hummingbird 1254² | 2.82 -> 1.62 | 3.14 -> 1.68 | 6.62 -> 2.81 | 6.34 -> 2.90 | 7.64 -> 1.73 |
| uniform noise 192² | 2.02 -> 0.43 | 2.42 -> 0.43 | 0.49 -> 0.24 | 1.66 -> 0.52 | 1.60 -> 0.39 |
| value noise 192², cell 3 | 0.79 -> 0.10 | 1.80 -> 0.26 | 0.56 -> 0.09 | 0.57 -> 0.13 | 0.13 -> 0.08 |

Photo shading is unchanged (under 0.1 s). The ring image (1200², 1-px rings every 4 px) traces in
1.2 s in Line Art (base 2.2 s). Uniform noise at 1024² traces in about 10-13 s in Line Art and Smooth.
That trace exhausts the corner budget, but the budget is not where its time went: with the cap
lifted, the same process measured 700² at 4.87 s against 4.96 s capped and 1024² at 10.61 s
against 10.34 s, so the speed-up over the bake-off's 178 s comes from the exact rewrites.

Owl in Line Art either side of the old cliff (single runs): base 9.5 s at 1224² and 4.0 s at 1225²,
a 2.4x step; now 2.4-2.6 s and 1.9-2.0 s. Entering the band (1059² exact 2x to 1061² at 1.9987x)
stays within 1.3x.

**Output equivalence.** Canonical curves were compared point by point between the base and this
change: identical (largest distance 0) on the five perceptual fixtures, the owl, the hummingbird and
three noise images, in all six presets. The intended differences are:

- Sources inside the taper band. Owl scaled with nearest-neighbour, ink IoU against the thresholded
  source: 1061² 0.817 (2x 0.816, native 0.804), 1150² 0.819 (2x 0.824, native 0.814), 1224² 0.818
  (2x 0.831, native 0.823). Thin-stroke art can change more: 1-px rings at 1100² in Smooth trace
  with IoU 0.72 where the 2x grid kept 0.08, and take 12 s instead of 2.6 s to finish the intact rings.
  Straight 1-px lines in Line Art at 1100²-1200² trace as curved outlines of about 2,200 points
  per four lines within +-0.8 px of the stroke centre, where the same page at 800²-990² on the 2x grid gave 25 points within +-1.03 px.
- Traces that exhaust the corner budget: no art fixture, but uniform noise from about 240² up
  (700² Line Art: 456,948 points capped against 456,783 uncapped).

### Consequences

- Owl Line Art is at 0.44-0.50x of the base and does not yet reach the 1.5 s target (1.83 s at best
  here); the hummingbird reaches it only in quieter runs. The remaining time is spread across
  boundary walking, cubic fitting, pinhole filling and the first topology round. Several of those
  files are being changed on parallel tracer branches, so they were left for a follow-up.
- `bridge-queue.ts` replaces the per-round rescan in `junction-pairing.ts`; a pair-validity rule
  added there belongs in `bridgeGap`. The tip-extension junction test now asks the shared point
  grid (`landmarkGrid`).
- `centerline/endpoint-grid.ts` is removed: the bridge queue keeps its own cells.

### Amendment 1 (2026-09-27): the speed gate, an alternating bench and trace independence

The second speed wave only takes output-identical changes, so it first needs a gate that can see
any output change and a benchmark that is not fooled by machine load.

**Parity oracle.** `src/__fixtures__/perceptual/trace-parity-oracle.ts` serialises the whole trace
result canonically: every `ColoredPath` field including `curves`, object keys sorted, numbers in
their round-trip decimal form with `-0` kept distinct, and array and path order kept. It hashes the
text with SHA-256. The corpus is the five perceptual fixtures, seeded uniform noise at 192² and
1024², seeded value noise at 1024² (cell 3, seed 7) and, from the lab folder outside the
repository, the owl and the hummingbird, each in Line Art, Photo shading, Centerline, Edge
Detection, Smooth and Sharp (60 cases). `trace-parity-oracle.test.ts` compares the hashes with a
base file recorded from the untouched base commit (952fb13e3). It runs only with
`TRACE_PARITY=1`; the real art and the 1024² noise also need `TRACE_PARITY_HEAVY=1`.

Proof that the gate works:

- It passes on the unchanged code: the 36 light cases passed twice, all 60 cases were recorded,
  and the full 60-case compare passes on the branch head that adds the gate.
- A fitted ring whose cubics are no longer registered, so that its curves fall back to straight
  segments, fails 4 cases: noise192 in Line Art, Edge Detection, Smooth and Sharp.
- Reversing the order of the corner Set in `contour-trace.ts` (the union of bend corners and feature
  anchors) still passes all 36 light cases. That Set is only used to test membership, so its order
  is not part of the output.
- `trace-parity-canonical.test.ts` checks that the hash changes when paths are reordered, a curve
  is dropped, a point moves by one ulp, `0` becomes `-0`, or a typed array is permuted.

**Alternating bench.** `scripts/trace-bench.mjs` bundles the tracer of two source trees into two
independent modules, loaded in one process. The trees can be two worktrees, or a detached
worktree of a commit. Each round alternates which side runs first. The script reports best of N,
the median, the new/base ratio, and whether both sides produced the same canonical hash. An A/A
run (the same code on both sides, best of 3, machine under load) gave new/base ratios from 0.86
to 1.33. So a claimed speed-up needs at least 5 alternating rounds, and must show in the best and
in the median.

**Trace independence (the 187-against-69 question).** The speed study saw owl Line Art's first
repair round report 187 conflicts after a noise trace in the same process, and 69 in a fresh
process. Findings:

- Neither the base nor tl-geometry-core has trace state at module level in the contour, topology
  or finishing path. Every topology cache (membership, contacts, measurements, nesting relations,
  pair cache) is created inside `preserveContourTopologySteps` for each trace. The only
  module-level tables are WeakMaps keyed by arrays that each trace allocates for itself: the
  fitted-ring curves in `trace-curves.ts` and the landmark grid in `centerline/point-grid.ts`.
  Their entries cannot be reached from a later trace. The remaining module-level value,
  `tracerPromise`, is a loader.
- The two rows came from the geometry-core worktree at 841d2e49a, which also carried another
  agent's uncommitted edits, measured through a `vi.mock` probe. The 69 row was written by a later
  version of that probe (it has fields the 187 row lacks), so it comes from a separate run.
  "Same final loops" compared only the loop count, not the output.
- On this base the effect does not reproduce. Owl in Line Art gives the same hash and the same
  conflicts in every round (310, 36, 26, 17, 12, 1, 1, 0) fresh, after noise192, after the
  hummingbird, and traced twice in a row. Owl in Sharp gives the same (329, 8, 5, 2, 2, 2, 0)
  fresh and after noise192. The oracle's owl hashes match as well, although there the owl runs
  after ten traces of other images.
- `src/core/trace/trace-independence.test.ts` keeps this true. It traces a seeded noise image in a
  fresh module instance, then again after Sharp, Centerline and Smooth traces of other images, and
  twice in a row, in all six presets. It requires the same hash every time and, in the four presets
  that run the topology repair (Line Art, Edge Detection, Smooth and Sharp), the same conflicts in
  every round. Photo shading and Centerline run no repair rounds.
- Nothing accumulates across traces in one process, as it would in the long-lived trace worker.
  Twenty light Line Art traces in one process (five fixtures alternating with noise192, twice
  round) keep the heap live after a forced GC flat: noise192 rows go from 56.8 to 57.5 MB and the
  others from 44.1 to 46.6 MB, settling after the first few traces, with every hash unchanged.
  Owl traced twice keeps 83.9 then 84.1 MB. Owl and hummingbird alternated three times in Line
  Art keep 83.9, 79.9 and 80.1 MB after each owl and 66.0, 66.2 and 66.4 MB after each
  hummingbird, and every owl and hummingbird trace repeats its hash and its repair conflicts.

No code change was needed, and none was made. The 187 against 69 difference is put down to
measuring different code, not to state leaking between traces.

### Amendment 2 (2026-09-27): output-identical cuts, speed wave 2

Each cut below leaves the serialised trace byte-identical: the Amendment 1 parity oracle
(`TRACE_PARITY=1`, plus `TRACE_PARITY_HEAVY=1` when the machine has 4 GB free) matches the hashes
frozen from 952fb13e3 in all six presets, and each cut has its own differential proof against a
frozen copy of the code it replaces. The frozen copies live in `*.test-support.ts` files, never
in production code. Shared fuzz masks come from `src/core/trace/mask-fuzz.test-support.ts`
(dense and sparse noise, blobs and rings, 1 px lines, ink on the border, checkerboard saddles,
all-ink, all-paper, 1xN and Nx1 shapes).

**Rank 2, whole-grid distance field (`centerline/distance-field.ts`).** The column pass
transforms a 0/INF indicator, and the lower envelope of parabolas that are all rooted at 0 is
exactly the squared distance to the nearest background pixel in the column (INF when the column
has none). Two row-major integer sweeps (down, then up, keeping a per-column run length) now give
those values, which removes the strided per-column envelope. The row envelope is unchanged in
operation order; it no longer needs a max(width, height) scratch, and the virtual border clamp
is folded into its write-back. Proof: `distance-field-parity.test.ts` compares every element with
`Object.is` against the frozen field on 3000 fuzzed masks, 300 px all-ink, all-paper, border and
blob grids, degenerate grids (0x0, 0x5, 1x40, 40x1) and masks holding values other than 0 and 1;
`src/__fixtures__/perceptual/trace-parity-distance-field.test.ts` (gated on `TRACE_PARITY=1`)
does the same for every mask the tracer builds from the oracle corpus in all six presets. A
mutation (border clamp off by one) fails both. Oracle: 60/60 heavy before a lint-only split of
the function into per-row helpers, and 36/36 light plus the corpus-mask check after it.

**Rank 4, boundary walk as direction bits (`contour-boundary.ts`).** `Map<vertex, Set<dir>>` is
replaced by a `Uint8Array` of four direction bits per lattice vertex plus the list of vertices in
the order their first edge was found. Loops start at vertices in that order, each with its
earliest-inserted remaining direction. Raster order inserts a vertex's edges W, N, S, E (from
pixels (x-1,y-1), (x,y-1), (x-1,y), (x,y)), so the new walker reproduces the Map and Set
iteration exactly, including after deletions, which never reorder either structure. Only
`collectBoundaryEdges`, `walkLoop`, `nextDirection` and the two-line start loop in
`traceBoundaryLoops` changed, so geometry-core's nesting-forest edit should merge cleanly. Proof:
`contour-boundary-parity.test.ts` deep-equals the loops (order, start, points, area) against the
frozen Map walker on 10 000 fuzzed masks with the default saddle rule, 3000 more with
paper-joining, ink-joining and position-hashed saddle resolvers, large 160 px masks, non-0/1
mask values and short ink arrays. Mutations: walking the vertices in raster order instead of
first-insertion order fails 3 of 5 tests. Swapping the per-vertex direction order (E before W,
or S before N) does NOT fail: by the time the outer loop reaches a saddle vertex, one of its two
out-edges has always been consumed by a loop that started at an earlier vertex, so that order
is not observable on any fuzzed mask. The exact order is kept anyway.

**Rank 5, thinning mechanics (`centerline/medial-thinning.ts`, `centerline/erosion-queue.ts`).**
Pop order is the thinning algorithm, so the queue still returns the least (squared distance,
neighbour tie, pixel index) every time. What changed is how it finds that entry:
- Keys are direct-addressed. Each distinct distance in the field gets a dense rank (an
  `Int32Array` table when the largest distance is below 2^23, otherwise a binary search over the
  sorted distinct values). The ranks are computed once per thinning and shared by both passes.
  Buckets live at `[rank][tie]`, and a cursor finds the least non-empty key. The cursor only
  moves back when a push lands below it. This replaces the per-push `Map` lookup and the key heap.
- An entry pushed while an identical (pixel, tie) entry is still pending is dropped. It would pop
  straight after its twin. If the first pop erodes the pixel, the second finds it gone, and
  eroded pixels never come back. If the first pop refuses, nothing has changed before the second
  pop, so it refuses too. Either way the second pop does nothing.
- Ring configurations, neighbour requeues and the maximal-disc test read interior pixels through
  per-width index deltas. Border pixels use flat `Int8Array` offset tables. This replaces
  destructuring the offset tuples.

Lazy seeding was dropped because it is not output-identical. A pixel seeded with a full ring
(tie 0) can become erodable after lower-distance neighbours erode. Its seed entry then pops
before its re-queued, higher-tie entries. Skipping or deferring that seed changes the erosion
order. Seeding stays one pass through the cheaper push.

Proof:
- `medial-thinning-parity.test.ts` compares skeletons byte for byte against the frozen 952fb13e3
  thinning and queue (`medial-thinning-reference.test-support.ts`,
  `erosion-queue-reference.test-support.ts`). It covers 4000 fuzzed masks, 1000 stroke ribbons of
  width 1 to 6 (even widths leave the 2 px ridge that the neighbour tie exists for), 160 px
  blob, border, line, dense and all-ink grids, fields scaled by 2^22 (the binary-search rank
  path), arbitrary small-integer keys, and non-integer keys (the comparator-heap path).
- `erosion-queue.test.ts` checks the pop sequence against a comparator model that keeps one
  pending copy per exact duplicate.
- `src/__fixtures__/perceptual/trace-parity-thinning.test.ts` (gated on `TRACE_PARITY=1`) checks
  every mask the tracer thins from the oracle corpus.
- Mutations:
  - Swapping two interior ring bits fails all 5 skeleton tests.
  - Deduplicating by pixel alone, ignoring the tie, fails 8 tests.
  - Never clearing the pending bit fails the 3 queue tests. The thinning never re-pushes an
    identical entry after its pop in a way that changes the skeleton, so the skeleton tests
    still pass.
  - A cursor that never moves back fails the queue tests and hangs the thinning.
- Oracle: 36/36 light cases plus the corpus thinning check (62/62 with the unit parity tests).
  On the final code (ranks 2, 4 and 5 together) the heavy gate passed 76/76. That covers the 60
  oracle cases, the corpus distance-field and thinning checks, and the distance-field, boundary
  walk and thinning fuzz suites. It also covers rank 2 after its lint-only helper split.

**Measurements (speed wave 2).** All numbers come from `scripts/trace-bench.mjs`: 5 alternating
rounds, with the side that runs first switching each round, on one heavily shared machine. Other
agents' vitest runs were active, so absolute times are inflated 2-10x and swing from run to run.
An earlier A/A smoke (same code on both sides) gave ratios between 0.857 and 1.333, so a single
ratio inside that band is noise. The table gives new/base of the best times, with the median
ratio in brackets. Every row reported `identical true`: the serialised trace hash matched on
both sides.

| Comparison                  | Case        | Line Art      | Sharp         | Centerline    |
| --------------------------- | ----------- | ------------- | ------------- | ------------- |
| 952fb13e3 -> rank 2         | owl         | 1.036 (0.962) | 1.070 (1.143) | 0.974 (0.960) |
|                             | hummingbird | 0.988 (0.975) | 1.050 (0.976) | 0.996 (1.042) |
|                             | noise1024   | 1.004 (0.954) | 1.222 (1.093) | 1.006 (1.079) |
|                             | sparse4096  | 0.898 (0.828) | 0.631 (0.624) | 0.936 (0.912) |
| rank 2 -> rank 4            | owl         | 0.891 (0.890) | 0.865 (0.904) | not run       |
|                             | hummingbird | 0.978 (0.969) | 0.890 (0.902) | not run       |
|                             | noise1024   | 0.873 (0.895) | 0.887 (0.970) | not run       |
|                             | sparse4096  | 0.981 (0.920) | 0.971 (1.051) | not run       |
| 952fb13e3 -> rank 5 (all)   | owl         |               |               | 0.937 (0.965) |
|                             | hummingbird |               |               | 0.965 (0.965) |
|                             | noise1024   |               |               | 0.904 (0.951) |
|                             | sparse4096  |               |               | 0.828 (0.809) |
| rank 4 -> rank 5            | owl         |               |               | 0.971 (0.898) |
|                             | hummingbird |               |               | 0.932 (0.928) |
|                             | noise1024   |               |               | 0.930 (1.007) |
|                             | sparse4096  |               |               | 0.915 (0.976) |

Reading:
- The rank 2 distance field clearly pays only where it dominates, on the sparse 4096 page
  (Sharp 0.63). On owl, hummingbird and noise1024 it is within noise. The noise1024 Sharp row
  (1.22) is inside the A/A band, and the rank 4 and rank 5 rows re-ran rank 2's code as their
  base without a comparable slowdown.
- The rank 4 boundary walk gives a consistent 0.87-0.98 on the contour presets. That is
  suggestive, not proven: each row is inside the A/A band on its own.
- Rank 5 moves Centerline by 0.91-0.97 (best) end to end. The thinning is only part of a
  Centerline trace. Isolated, in one process, alternating best-of-9 against the frozen copy, the
  thinning takes 0.75x the time on a 1200 px stroke page (median 0.75x). Log:
  `lfbake/speed2/thin-bench-r5.log`, outside the repo.
- None of this changes the size of the gap to Potrace. Owl Line Art is still seconds, not a
  quarter-second. The remaining plan ranks, workers and topology repair are where that gap
  lives.
