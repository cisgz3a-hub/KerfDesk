## ADR-391 - Laser traces reach G-code as fewer, longer moves (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

This amends ADR-260, whose decision said "Laser commits pass the tracer's output through untouched".
CNC commits keep ADR-260's fairing unchanged. The Frame-first contract (PROJECT.md non-negotiable 21,
ADRs 228, 230, 232 and 237) is untouched: Frame and Start read the compiled job as before.

### Context

Tracer audit Finding 5 (2026-09-24): every trace preset that finishes outlines fits least-squares
cubics to each measured outline, then samples them every 1.5 trace pixels and keeps only the
samples. Outlines finished without a fit and Centerline strokes are runs of vertices at a similar
pitch. Laser commits passed that through, so each sample became one G1 move. On the current base
(`85ee406`), the Arch House logo traced with Line Art and placed 100 mm wide compiles to 26,997 burn
moves averaging 0.077 mm; the dragon drawing (`centerline-stress-test-20260909.png`) compiles to
158,539. The audit measured 28,892 on an earlier revision.

Why short moves matter on GRBL-family controllers:

- GRBL 1.1 plans over a ring of 16 blocks (`BLOCK_BUFFER_SIZE`, 15 when line numbers are enabled,
  [planner.h](https://github.com/gnea/grbl/blob/master/grbl/planner.h)), and reports the ring full
  while one slot is still empty (`plan_check_full_buffer`,
  [planner.c](https://github.com/gnea/grbl/blob/master/grbl/planner.c)), so 15 moves are planned
  ahead. The note above `planner_recalculate()` in planner.c says motions with "lots of short line
  segments ... may seem to move slow" because the buffer holds too little distance to accelerate and
  still stop, and its second remedy is to "Maximize line motion(s) distance per block to a desired
  tolerance".
- grblHAL's core default is 100 planner blocks (`DEFAULT_PLANNER_BUFFER_BLOCKS`,
  [config.h](https://github.com/grblHAL/core/blob/master/config.h)); drivers can change it.
- Each move is also one line on the serial link, about 20 bytes in KerfDesk's GRBL output.

What the pipeline already provides: `ColoredPath.curves` is the canonical geometry. Compile, fill
and Job Review flatten it once through `compilationPolylines`, at `DEFAULT_MACHINE_CURVE_TOLERANCE_MM`
(0.025 mm) divided by the placement's largest axis scale. A cubic curve can reach G-code without any
migration. Main's compact saving (`compact-line-geometry.ts`) drops a path's curves only when every
curve is exactly its polyline, so curves that differ from the polyline are saved beside it.

Options, measured on both images and five presets at 100 mm wide with a Line operation, by compiling
the committed trace and counting burn moves in the emitted GRBL program (moves; largest distance from
the traced samples; tracer corners still vertices at their exact positions):

| Image, preset | Before | A: keep the cubics | A + simplify the rest (chosen) | Simplify everything, no cubics | B: CNC fairing at 0.025 mm |
|---|---|---|---|---|---|
| logo, Line Art | 26,997 | 3,973; 0.019; 175/175 | 2,946; 0.025; 175/175 | 2,232; 0.025; 175/175 | 13,129; 0.025; 170/175 |
| logo, Sharp | 12,949 | 4,933; 0.022; 313/313 | 2,640; 0.025; 313/313 | 2,082; 0.025; 313/313 | 9,240; 0.025; 174/313 |
| logo, Centerline | 2,478 | 2,478; 0.000; 37/37 | 809; 0.025; 37/37 | 809; 0.025; 37/37 | 2,340; 0.025; 37/37 |
| dragon, Line Art | 158,539 | 104,260; 0.019; 5696/5696 | 49,026; 0.025; 5696/5696 | 39,556; 0.025; 5696/5696 | 107,194; 0.025; 4971/5696 |
| dragon, Sharp | 298,766 | 241,500; 0.019; 21092/21092 | 84,218; 0.025; 21092/21092 | 74,995; 0.025; 21092/21092 | 144,265; 0.025; 9708/21092 |

B, the CNC fairing (ADR-260) with a laser tolerance, resamples to an even chord and moves corners, so
it keeps fewer of them and more moves. Simplifying every subpath without the cubics gives 11 to 24%
fewer moves on the outline presets today, but freezes the outline at the commit scale and discards
the fitted curves that export, node editing and any later rescale use. Nearly all of that gap is
compile's cubic flattening, which subdivides at midpoints and emits more chords than the tolerance
needs: a prototype that flattens the same cubics with the fewest chords within 0.025 mm measured
2,244 moves on the logo's Line Art and 39,534 on the dragon's. Fixing that in compile helps every
curved path, not only traces, so it is left to its own change.

### Decision

1. The contour finisher keeps its fitted cubics as the outline's canonical curve (`fittedTraceRing`
   and `withCanonicalTraceCurves` in `core/trace/trace-curves.ts`). The sample points are unchanged.
   A ring whose samples a later stage copies (the downscale route, region enhance) falls back to
   straight segments over the same samples.
2. At trace commit, `conditionTracedImageForMachine` (`ui/trace/trace-machine-conditioning.ts`)
   conditions the trace at the exact placement the store will apply. In a laser project, or one with
   no machine (saved before CNC support), vector output other than Photo shading goes through
   `simplifyTracedPathsForLaser` (`ui/trace/laser-trace-moves.ts`):
   - A curved subpath keeps its curve, and its compatibility polyline becomes the chords compile
     emits at that placement, so the scene and the saved project hold what the laser burns.
   - A straight-segment subpath is reduced by `simplifyToolpathPolyline`
     (`core/toolpath/simplify-toolpath-polyline.ts`) to the fewest of its own vertices that stay
     within 0.025 mm of it, measured in millimetres on each axis (Douglas and Peucker, "Algorithms
     for the reduction of the number of points required to represent a digitized line or its
     caricature", The Canadian Cartographer 10(2):112-122, 1973, doi:10.3138/FM57-6770-U75U-7727;
     the publisher's page could not be opened from the build environment). Vertices turning at least
     60 degrees, open-chain ends and ring seams are always kept at their exact positions. A ring that
     would drop below three distinct vertices is kept as traced, so no mark is deleted.
   - Closed boundaries are checked together after simplification, including neighbours in other
     colored paths. A distance bound on each outline alone can make a narrow hole cross its outer
     outline. The existing topology repair restores only conflicting simplified subpaths, comparing
     canonical compiled boundaries at the commit placement. Unrelated simplifications and native
     fitted curves are retained; compatibility polylines stay paired with the curves compile reads.
3. CNC commits keep ADR-260's fairing. Photo shading keeps its ribbons, whose widths encode tone.
   Raster scan output burns pixels, not traced moves, and is not conditioned.

### Consequences

- Measured before and after on the current base, Line operation, 100 mm wide:

  | Image, preset | Moves | Average move (mm) | Shortest move (mm) | 15-move span, median (mm) | Largest deviation (mm) |
  |---|---|---|---|---|---|
  | logo, Line Art | 26,997 to 2,946 | 0.077 to 0.703 | 0.0073 to 0.0264 | 1.08 to 9.81 | 0.0250 |
  | logo, Smooth | 19,455 to 2,269 | 0.083 to 0.715 | 0.0103 to 0.0283 | 1.08 to 9.21 | 0.0249 |
  | logo, Sharp | 12,949 to 2,640 | 0.128 to 0.628 | 0.0020 to 0.0020 | 2.10 to 9.34 | 0.0249 |
  | logo, Edge Detection | 14,287 to 2,843 | 0.143 to 0.716 | 0.0040 to 0.0345 | 2.12 to 9.86 | 0.0249 |
  | logo, Centerline | 2,478 to 809 | 0.353 to 1.081 | 0.0071 to 0.0495 | 4.24 to 12.74 | 0.0249 |
  | dragon, Line Art | 158,539 to 49,026 | 0.092 to 0.298 | 0.0020 to 0.0130 | 1.40 to 3.85 | 0.0250 |
  | dragon, Smooth | 123,105 to 41,324 | 0.115 to 0.342 | 0.0010 to 0.0127 | 1.62 to 4.40 | 0.0250 |
  | dragon, Sharp | 298,766 to 84,218 | 0.062 to 0.217 | 0.0010 to 0.0010 | 1.02 to 3.88 | 0.0250 |
  | dragon, Edge Detection | 180,775 to 53,867 | 0.093 to 0.311 | 0.0020 to 0.0106 | 1.43 to 3.84 | 0.0250 |
  | dragon, Centerline | 64,172 to 17,108 | 0.138 to 0.515 | 0.0041 to 0.0380 | 1.91 to 7.35 | 0.0250 |

- Every corner the tracer found (a fitted joint or a vertex turning at least 60 degrees) stays a
  vertex at its exact position. Measured as the angle between the two moves beside it, a few read
  lower than before, because each move follows the outline within the tolerance rather than its
  direction at the corner: 1 of 175 on the logo's Line Art and at most 42 of 21,092 on the dragon's
  Sharp fall below 60 degrees, all from turns of 60 to 95 degrees (worst 91.8 to 51.4).
- The shortest move does not grow on Sharp. That preset leaves sliver rings thinner than the
  tolerance (13 on the logo, 863 on the dragon, none longer than 0.9 mm) that simplification would
  collapse, so the ring guard keeps them as traced, short moves included. The logo keeps 49 moves
  under 0.01 mm and the dragon 2,901; Line Art keeps none on either.
- Which jobs benefit: a Line operation (Edge Detection and Centerline traces default to one; the
  filled-outline presets when switched to Line) and a Follow Shape fill, which offsets the outline
  (logo Line Art 89,957 to 11,906 moves). The default Scanline fill emits one move per scan crossing
  and is unchanged (4,548 to 4,535).
- Speed is not measured on hardware. Estimates from the audit's formulas: the 15-move stopping
  distance caps GRBL 1.1 at the square root of 2 x acceleration x span, which for the logo's Line
  Art rises from about 1,970 to 5,940 mm/min at 500 mm/s² and from 4,830 to 14,550 mm/min at
  3,000 mm/s²; at about 576 lines per second the serial link rises from about 2,660 to 24,300 mm/min.
  At the default Line speed of 1,500 mm/min neither estimate bound the logo before on a machine
  accelerating at 500 mm/s² or more, so the gain shows on faster jobs.
- CNC output is byte-identical on all ten cases, compared by hashing the emitted programs.
- Saved projects get smaller: the stored traced path data shrinks by 13 to 73% across the ten cases
  (logo Line Art 1,255,753 to 337,044 bytes), because curved outlines store cubics and chords instead
  of every sample.
- Readers of the canonical curve follow it: the canvas draws the fitted curve, bounds and hit
  testing use it, node editing shows the fitter's Bezier nodes instead of one node per sample, and a
  scene SVG export writes these outlines as cubic Beziers.
- Commit-time cost is at most about 190 ms on the dragon in a Node harness.
- As with ADR-260, conditioning uses the commit placement. Compile re-flattens curved outlines at
  any later scale. Straight-segment subpaths stay as committed: scaling a trace up k times lets them
  deviate up to k x 0.025 mm from the traced samples. Re-trace at the final size when that matters.
- Traces committed before this ADR keep their geometry; re-trace to condition them.
- Tests: `simplify-toolpath-polyline.test.ts` (tolerance, per-axis scale, corners, ring guards, a
  property test), `trace-curves.test.ts` (the cubics reach a traced path), `laser-trace-moves.test.ts`,
  `trace-machine-conditioning.test.ts`, `ImportImageDialog.cnc-fairing.test.ts`, and
  `arch-house-laser-moves.test.ts`, which traces, commits, compiles and emits the logo end to end.
  `laser-trace-topology.test.ts` checks narrow holes with independent intersection and containment
  predicates on compiled output, cross-path neighbours, stale compatibility samples, and retention
  of unrelated simplification and native fitted curves.

Not part of this decision: chord-optimal cubic flattening in compile; keeping cubics through the
downscale route and region enhance; fitting the unfitted finish and Centerline strokes;
reconditioning a trace when it is rescaled; removing sliver rings below the tolerance.
