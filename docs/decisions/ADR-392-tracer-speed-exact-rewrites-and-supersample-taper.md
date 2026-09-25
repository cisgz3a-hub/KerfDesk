## ADR-392 - Tracer speed: output-identical rewrites, a corner-rebuild budget and a supersample taper (2026-09-25)

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
   0.033, every perceptual fixture 0.025 or less), so no fixture reaches it. Once spent, remaining
   rings keep their dense geometry. A per-loop noise gate was rejected: owl rings with 65-89% of
   vertices past the quick turn gate carry 52-109 genuine rebuilt corners each.
3. **A supersample taper at the budget edge.** Where the 2x grid would fill between 75% and 100% of
   the budget (sources 1060²-1224² for the outline presets, 866²-1000² for Edge Detection and
   Centerline), the factor eases from 2 to sqrt(1.2) so working pixels fall linearly from 4x to 1.2x
   of the source, on a rounded bilinear grid (`upscaleToWorkingGrid`), mapped back per axis. The
   support restoration of ADR-128 follows the rounded grid, and the pinhole radius cap rounds up to
   whole pixels (both reduce to the old arithmetic on integer grids).

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
1.2 s in Line Art (base 2.2 s). Uniform noise at 1024² traces in about 13 s in Line Art and Smooth.

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
- A trace that exhausts the corner budget (none measured).

### Consequences

- Owl Line Art is at 0.44-0.50x of the base and does not yet reach the 1.5 s target (1.83 s at best
  here); the hummingbird reaches it only in quieter runs. The remaining time is spread across
  boundary walking, cubic fitting, pinhole filling and the first topology round. Several of those
  files are being changed on parallel tracer branches, so they were left for a follow-up.
- `bridge-queue.ts` replaces the per-round rescan in `junction-pairing.ts`; a pair-validity rule
  added there belongs in `bridgeGap`. The tip-extension junction test now asks the shared point
  grid (`landmarkGrid`).
- `centerline/endpoint-grid.ts` is removed: the bridge queue keeps its own cells.
