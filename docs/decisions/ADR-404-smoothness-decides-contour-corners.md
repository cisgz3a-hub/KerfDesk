## ADR-404 - Smoothness decides contour corners, before any smoothing (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This changes how the filled-contour tracer (Line Art, Sharp, Smooth, and the edge lane that shares
its finisher) finds corners. It does not change output, G-code, bounds or Frame contracts: the
tracer still returns closed rings with canonical curves (ADR-391).

### Context

The trace dialog's Smoothness uses LightBurn's 0 to 1.33 range, but on the base
(`claude/tracer-lead-potrace`, `fa8939b8d`) it only set the straight-run flattener and arc-noise
evening strength, `max(0, 6s - 5)`. Corners came from three places that ignored it: the corner
rebuild (`sharpenChainBends`), which only ran on loops of 260 to 4096 x pixelScale chain points;
a 60 and 50 degree windowed detector on larger measured loops; and hard-turn pins in the sparse
stages. Taubin pre-smoothing ran before all of them. Measured on the base:

- Binary squares from 6 to 64 px lost 0.43 to 0.47 px at every corner in Sharp and 0.33 to 0.34 px
  in Line Art, at every Smoothness; 120 px squares were exact (they reach the rebuild's range).
- Smoothness 0 never gave the pixel polygon and 1.33 never removed corners: a 4x4 sprite traced as
  a rounded blob (0.48 px Hausdorff from its pixels) at every setting, while Potrace 1.16's `-a`
  (measured out of process as data) goes from 0.990 to 0.979 IoU across the same range.

### Decision

1. **One corner stage, on every loop.** `decideContourCorners` (`core/trace/contour-corners.ts`, with
   `contour-corner-lattice.ts` and `contour-corner-legs.ts`) runs on each loop's raw crack chain,
   binary or anti-aliased, of any length, before Taubin smoothing. Its apexes are spliced into the
   chain and pinned by reference through span-wise Taubin smoothing, curvature evening, arc-noise
   evening, flattening, simplification and the spline or cubic-fit tail. The size-limited rebuild
   and the windowed detector are no longer called by the contour finisher.
2. **Each candidate carries a rounding cost in source pixels; Smoothness sets one threshold**,
   `t(s) = (2/3) s / (4/3 - s)`: 0 at s = 0, 2 px at the default 1, unbounded at 4/3. A candidate is
   a corner when its cost exceeds t. Candidates come from:
   - every turn of a binary pixel staircase, costing at least tan(22.5 degrees) = 0.414 px, so any
     threshold below that keeps every pixel corner (s = 0 is the exact pixel polygon);
   - pixel features: a run the staircase U-turns around (same-sign turns at both ends) that is no
     longer than the runs flanking its sides, unless it is the tip of a one-pixel staircase. Its
     cost is its height (the shorter side), since smoothing melts it entirely;
   - leg corners: two straight legs meeting at 15 degrees or more, the apex at their intersection,
     costing the fillet gap `min(leg) x tan(turn / 4)`, capped at 10 x (one-circle RMS residual minus
     two-leg RMS residual) so a digitized or wobbly arc never pays a corner's price.

   Selection is greedy by cost; a corner whose apex lies inside a costlier corner's legs is dropped.
3. **Measured (anti-aliased) loops** allow their apex only 0.3 + 0.15 / sin(interior / 2) px from the
   chain (binary loops 0.9 + 0.5 / sin), and reject an apex whose swapped region contains a source
   pixel centre, since the chain is the field's own iso-line.
4. **Pixel-exact contacts.** An exact apex on a lattice vertex where ink touches only diagonally is
   moved 1/128 px into its own corner, so the topology repair does not strip the corners of two
   touching sprite pixels.
5. **Where the flattener will straighten wobble** (binary loops, s above about 0.83), apexes are
   re-seated on legs grown at the flattener's amplitude, and loops with corners are flattened once on
   the dense chain before simplification as well as after. Corner-free loops skip the dense pass so
   circles are not cut into secants.

Hoshyari et al. 2018 (perception-driven semi-structured boundary vectorization) suggested pricing
corner against smooth for each candidate. The cap rule, the leg model, the fillet-gap cost and the
circle cap are this change's own design. No Potrace source was read.

### Measurements

Apex gap in px (largest distance from a true corner to the traced outline), app path
(`traceImageToColoredPaths`), base then this change; Potrace 1.16 `-t 2 -O 0.2` on the same pixels:

| Shape | Line Art | Sharp | Potrace a=0.5 | Potrace a=1 |
|---|---|---|---|---|
| square 6 px | 0.338 -> 0.002 | 0.471 -> 0.000 | 0.000 | 0.689 (round) |
| square 8 px | 0.335 -> 0.002 | 0.463 -> 0.000 | 0.000 | 0.000 |
| square 16 px | 0.327 -> 0.002 | 0.450 -> 0.000 | 0.000 | 0.000 |
| square 64 px | 0.336 -> 0.002 | 0.435 -> 0.000 | 0.000 | 0.000 |
| square 120 px | 0.000 -> 0.000 | 0.000 -> 0.000 | 0.000 | 0.000 |
| 45 degree square 8 px | 0.633 -> 0.195 | 0.752 -> 0.205 | 0.701 | 0.701 |
| 45 degree square 64 px | 1.015 -> 0.173 | 0.081 -> 0.173 | 0.173 | 0.173 |
| 30 degree wedge | 0.396 -> 0.182 | 0.439 -> 0.300 | 0.448 | 0.448 |
| 60 degree wedge (direct, s=1) | 0.872 -> 0.041 | 0.895 -> 0.700 | 0.806 | 1.599 |
| 120 degree wedge (direct, s=1) | 2.069 -> 0.637 | 2.069 -> 1.825 | 1.612 | 1.612 |

A 45 degree apex can only be located to within its digitization; ours matches or beats Potrace
there. The small 60 and 120 degree wedges traced through Line Art's supersampled route are unchanged
(0.817 and 2.151): the supersampled field rounds those tips beyond the measured standoff.

Smoothness sweep (binary, direct): squares from 4 px are exact at s = 0 and s = 1 and have no
corners at s = 1.33 (0.46 to 2.4 px rounding); the base gave 0.43 to 0.48 px at every s.
Decided-corner counts never rise with s on a 134-step grid for 26 shapes (squares 4 to 120 px,
45 degree squares, 30/60/120 degree wedges, discs r = 4 to 60, three sprites). Discs r = 4 to 60
get no corner at s = 1; at Sharp's 0.55, r = 4 gets 2 and r = 12 gets 4, the rest none (Potrace
a = 0.5: 4, 2 and 3 on r = 4, 6, 8, none from r = 20).

Sprites at s = 0 (Sharp, Hausdorff distance from the pixel boundary): 4x4 0.481 -> 0.000, L-shape
0.542 -> 0.000, 10x10 face with diagonal contacts 0.685 -> 0.008 (the saddle step).

Real art, 1254 px: IoU against each preset's own binarized mask, and full trace time:

| Image | Line Art | Sharp | Smooth |
|---|---|---|---|
| owl | 0.9489 -> 0.9474; 3.7 -> 2.9 s | 0.9581 -> 0.9560; 7.4 -> 7.1 s | 0.9312 -> 0.9338; 3.4 -> 2.5 s |
| hummingbird | 0.8886 -> 0.8903; 2.5 -> 1.9 s | 0.9612 -> 0.9600; 5.9 -> 3.9 s | 0.9486 -> 0.9513; 2.7 -> 1.9 s |

Jittered bars (18 angles and phases, Line Art): mean edge RMS 0.361 -> 0.143 px. The single-bar
straightness gate (contour-straightness.test) and the jittered-ring roundness gate still pass.

### Consequences

- `contourPolylinesFromMask` takes `cornerThresholdPx`; the edge lane passes none and gets the
  default Smoothness 1.
- Two touching exact squares now keep their 1 px gap exactly (contour-topology.test's golden moved
  from 0.110 to 1).
- `sharpen-bends.ts` and `bend-geometry.ts` are unchanged and still serve the centerline tracer.
- Follow-ups: Smooth's blurred field places straight edges about 0.13 px inside the pixel edge
  (0.18 px apex gaps on squares), which is not a corner decision; and Line Art's supersampled route
  still rounds small acute wedge tips.
