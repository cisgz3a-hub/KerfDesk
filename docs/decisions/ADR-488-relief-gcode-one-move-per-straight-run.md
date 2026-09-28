## ADR-488 - Relief roughing emits one move per straight run; relief output fits no arcs (2026-09-27)

**Status:** Accepted; software-verified through unit, property and compile tests, hardware
qualification pending. | **Date:** 2026-09-27

Amends relief roughing's moves (ADR-424, `relief-roughing-motion.ts`). The Frame-first Start
contract (ADR-228, PROJECT.md non-negotiable 21) is unchanged: nothing here adds a guard, a
refusal or a warning.

### Context

The 3D carving audit listed "XY arc fitting and collinear merge within a tolerance" among the
things a GRBL-aware post does (Fusion Smoothing, FreeCAD OptimizeLinearPaths and G2/G3, MeshCAM
arc-fit builds). Before building it, it was measured on ADR-424's bench: the 60 x 40 mm relief
10 mm deep, 1/8" end mill roughing at 1.5 mm per pass, 1/8" ball nose finishing as Raster +
waterline, the default machine, each program timed by `estimateJobDuration` (acceleration,
junction deviation, and arcs cut into GRBL's `$12` chords) at three accelerations. Rewrites of
the emitted programs stood in for each option.

| Program | Lines | 100 mm/s² | 300 mm/s² | 500 mm/s² (default) | No acceleration limit |
|---|---|---|---|---|---|
| Roughing as emitted | 9,549 | 13.85 min | 11.06 min | 10.37 min | 9.58 min |
| Collinear vertices dropped | 3,818 | 13.85 | 11.06 | 10.37 | 9.58 |
| Arc fitting (ADR-432's straight-run fitter), 0.1 mm | 2,615, 16 arcs | 13.84 | 11.05 | 10.37 | 9.58 |
| Arc fitting, 0.2 mm | 1,597, 149 arcs | 12.64 | 10.56 | 10.12 | 9.54 |
| Corners rounded by tangent arcs, 0.05 mm | 7,260, 3,442 arcs | 11.77 | 10.24 | 9.96 | 9.53 |
| Finishing as emitted | 21,687 | 19.74 | 18.09 | 17.67 | 16.88 |
| Arc fitting of its constant-Z runs, 0.01 mm | 16,479, 213 arcs | 19.78 | 18.08 | 17.67 | 16.88 |

- Roughing rings are traced from the proven-cell mask by marching squares, so they are
  staircases at the cell size (an eighth of the bit): straight runs of cell-long moves joined by
  45 degree steps. Of 9,442 ring vertices, 6,938 did not turn at all. An arc through the
  vertices within a tolerance well under the cell size rarely spans more than one step, so the
  fitter finds almost none.
- What slows roughing is the steps' corners. Rounding each with a tangent arc gains 4% at the
  default acceleration and 15% at 100 mm/s², but moves the cutter up to the tolerance off the
  proven path, to both sides of it. Ring 0 rides the level's region boundary, so ADR-412's
  allowance proof would need the planning cutter widened by the tolerance, and ADR-489's air
  floor relies on ring 0 cutting everything within the cutter's radius of that boundary, which
  a corner cut inside the step no longer does.
- Finishing arcs cut lines by a quarter and time not at all: its waterline loops already turn
  gently enough for GRBL's junction deviation, and its lost time is on the raster's sloped rows,
  which are not in the XY plane. An arc also leaves the chord the waterline's exact-contact
  check proved clear (ADR-423), so it would need a check of its own against the model.
- Neither program strains the link: at the default feed roughing streamed about 300 bytes a
  second and finishing about 480, against about 11,500 at 115200 baud.

### Decision

1. **One move per straight run.** Every relief roughing pass drops each vertex that lies on the
   straight segment between the vertices kept either side of it (`dropCollinearPoints`,
   `core/geometry/drop-collinear-points.ts`): within 1e-9 mm of it and moving forward along it,
   with Z counted, so a ramp's points along one side go too and its slope stays. Repeats of a
   point go; a reversal along the same line stays. The path is the same, so the allowance
   (ADR-412), link (ADR-424) and air-floor (ADR-489) proofs are untouched, and each chain's
   entry, chosen on the traced loop before this, does not move.
2. **No arc fitting for relief output.** Rounding roughing corners is not built for the reasons
   above; it would come with the planning cutter widened by the tolerance and ring 0 kept exact
   or given its own coverage proof. Finishing keeps its chords.
3. Everything else, 2D operations included, emits as before.

### Consequences

| Relief roughing (bench above) | Before | After |
|---|---|---|
| G-code lines | 9,549 | 3,172 |
| G-code size | 190 kB | 62 kB |
| Time, every acceleration | unchanged | unchanged |

- The drop also removes a ramp's in-line points, which the stand-in rewrite above left, hence
  3,172 lines rather than 3,818.
- Pause and lift (ADR-411) replays the program's own lines; a longer line re-enters at the stop
  point along it as before. Pass-boundary recovery offers the same passes.
- Tests: `drop-collinear-points.test.ts` (a staircase, a reversal and a kink one emit step off
  the line kept, a ramp, and a 300-seed property that every dropped point lies on the segment
  that replaces it, in order); `relief-roughing-motion.test.ts` (every roughing pass, plunged or
  ramped, is already reduced while the traced rings are not). The relief roughing snapshot loses
  328 lines and gains none. EMITTER_REVISION bumped.
