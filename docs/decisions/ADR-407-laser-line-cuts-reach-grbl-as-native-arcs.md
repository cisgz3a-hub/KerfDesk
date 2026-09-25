## ADR-407 - Laser line cuts reach GRBL as native arcs (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This extends ADR-391, which left every traced path reaching the laser as G1 moves: compile flattens
the canonical curves into chords at `DEFAULT_MACHINE_CURVE_TOLERANCE_MM` (0.025 mm) and the laser
GRBL emitter writes one G1 per chord. CNC output (ADR-260, `CncArcPass`) is unchanged. The
Frame-first contract (PROJECT.md non-negotiable 21, ADRs 228, 230, 232 and 237) is unchanged: Frame
still traces `computeFrameJobBounds` of the compiled job, which now bounds the arcs themselves.

### Context

On the current base (`fa8939b8d`) the Arch House logo traced with Line Art and placed 100 mm wide
compiles to 2,946 G1 burn moves: 814 fitted cubics and 1,664 straight segments, the cubics flattened
by compile's midpoint subdivision. Every G2/G3 consumer except the laser emitter already existed:
the CNC emitter writes arcs, and the program parser (`core/gcode/arc-solve.ts`), render model,
timeline, motion manifest and executable plan all read them.

Controller facts this decision rests on (gnea/grbl master, read 2026-09-25):

- Laser mode fires in G1, G2 and G3 motion modes, and the laser-mode document's own example is
  `G2 X0 I5 S80` ([laser_mode.md](https://github.com/gnea/grbl/blob/master/doc/markdown/laser_mode.md)).
- `mc_arc` ([motion_control.c](https://github.com/gnea/grbl/blob/master/grbl/motion_control.c))
  cuts an arc into `floor(|0.5 travel r| / sqrt($12 (2r - $12)))` equal chords and ends with a line
  to the target, so a count of 0 or 1 is one straight move. The stock `$12` is 0.002 mm
  (`DEFAULT_ARC_TOLERANCE`, [defaults.h](https://github.com/gnea/grbl/blob/master/grbl/defaults.h)).
  Because the count rounds down, the chords sag up to about 4 x `$12` (0.008 mm) inside a short arc.
- The offset form's angular travel is `atan2` of the start and end radius vectors, pushed a full
  turn the commanded way when it reads the other way within `ARC_ANGULAR_TRAVEL_EPSILON` (5e-7 rad,
  [config.h](https://github.com/gnea/grbl/blob/master/grbl/config.h)). A rounded sliver that reads
  backwards becomes a near-full circle.
- `gc_execute_line` rejects an I/J arc only when the start and end radii differ by more than
  0.005 mm and also by more than 0.5 mm or 0.1% of the radius
  ([gcode.c](https://github.com/gnea/grbl/blob/master/grbl/gcode.c)).
- grblHAL and FluidNC execute G2/G3 in G17 with I/J offsets on the same model. LightBurn reportedly
  writes G1 only for GRBL devices; that was not verified here.

### Decision

1. **Arc fitting** (`core/geometry/arc-fit/`, own design from published methods; no Potrace code).
   `fitArcMoves` maps a canonical subpath into machine millimetres (cubics exactly by their control
   points; elliptical arcs flattened at 0.001 mm), splits it at every joint turning more than 1 degree
   between curves and at every vertex turning 60 degrees or more between lines (ADR-391's corner
   convention), and fits each run greedily:
   - smooth runs (curves and the lines tangent to them), densely sampled with exact tangents: the
     candidate covering the most samples per move among a straight chord, one arc leaving along the
     source tangent, one arc through both ends whose centre is Kasa's algebraic least-squares fit
     constrained to the ends' bisector (I. Kasa, "A circle fitting procedure and its error analysis",
     IEEE Trans. Instrum. Meas. IM-25(1):8-14, 1976), and the equal-tangent-length biarc
     (K. M. Bolton, "Biarc curves", Computer-Aided Design 7(2):89-92, 1975; see also M. Held and
     J. Eibl, "Biarc approximation of polygonal curves with asymmetric tolerance bands",
     Computer-Aided Design 37(4), 2005, and R. L. S. Drysdale, G. Rote and A. Sturm, "Approximation
     of an open polygonal curve with a minimum number of circular arcs and biarcs", Computational
     Geometry 41(1-2), 2008; none was re-read from the build environment). Single arcs must meet the
     source tangent within 2 degrees at both ends; biarcs meet it exactly;
   - straight-segment runs (no tangents): a line or the fitted arc through the run's ends,
     whichever reaches farther.

   Every candidate passes an exact two-sided check against the sampled source
   (`arc-piece-check.ts`): for a line, distance to a segment is convex; for an arc, every source
   point must sit inside the arc's sector (sweep at most 179 degrees, so the sector is convex) within
   the bound of the circle, and every source chord's closest approach to the centre too. The bound
   is the 0.025 mm machine tolerance minus the source sampling error (0.001 mm), 3-decimal rounding
   (0.002 mm) and, for arcs, the sag of the chords GRBL will cut that arc into at the stock `$12`.
   Radii run from 0.1 mm (there one 0.0005 mm I/J rounding step is 0.5% of the radius, and the arc is
   under a diode spot) to 1,000 mm (32-bit float spacing is at most 0.00012 mm for coordinates under
   2,048 mm; any flatter arc is emitted as the line that fits).
2. **Compile.** In a line-mode layer on an arc-capable machine, each CutSegment keeps its polyline
   exactly as before and gains `arcMoves` (from `polyline[0]`, ending exactly on its last point)
   when the fit takes fewer moves than the chords. Kerf offsets, tabs and fills never carry arcs.
3. **Capability.** `laserArcMovesEnabled` (`core/devices/laser-arc-moves.ts`): on for profiles
   naming GRBL 1.1, grblHAL or FluidNC; off for a profile naming no controller (including the
   built-in Default 400x400), for any other controller, for a vendor command set whose firmware build
   is not established (the Falcon A1 Pro profile), for the qualified `neotronics-4040-safe` dialect,
   and while a rotary is enabled (its Y scale turns circles into ellipses). Machine Setup shows an
   **Arc moves** switch on arc-capable controllers; `laserArcMoves: 'off'` persists in projects and
   `.lfmachine` files.
4. **Emission** (`core/output/grbl-laser-arc-moves.ts`). G2/G3 in the offset form, I/J from the
   already-rounded start, with the G1 path's F and S placement, zero-length skipping, power mode,
   passes and air assist. Before writing an arc, its rounded words are replayed as GRBL reads them
   (radius check, angular travel with the full-turn push); an arc whose words would not reproduce it
   is written as G1 chords. A contour with an ADR-239 tangential entry runway stays G1.
5. **Consumers.** `validCutArcMoves` guards every reader: moves that no longer end on the polyline
   are ignored. Job and Frame bounds include arc extrema; the preview route samples the arcs; job
   origin translation and path reversal carry the moves; rotary scaling and overlap-removal splits
   drop them. Laser timing on GRBL-family controllers interpolates G2/G3 as `mc_arc` does at the
   stock `$12` (`controllerArcToleranceMm`), so arcs are timed by the chords the planner really
   sees rather than the display's 15-degree ones; CNC timing is unchanged.

### Consequences

- Measured with a Node harness on the current base, traced, committed and compiled 100 mm wide
  with a Line operation for a GRBL 1.1 profile with Arc moves on, then off (off is the G1 program
  every earlier build writes); time is the app's estimate at the layer's default 1,500 mm/min and
  the stock 500 mm/s², and at 6,000 mm/min with 1,000 mm/s²; deviation is the largest two-sided
  distance from the canonical curves to what GRBL executes (arcs as `mc_arc` chords at `$12` 0.002),
  read back from the emitted program:

  | Image, preset | Burn moves (G2/G3) | Program bytes | Time 1,500 (s) | Time 6,000 (s) | Largest deviation (mm) |
  |---|---|---|---|---|---|
  | logo, Line Art | 2,946 to 1,508 (507) | 61,084 to 40,158 | 126.4 to 126.0 | 71.1 to 69.7 | 0.0186 to 0.0226 |
  | logo, Smooth | 2,269 to 1,132 (414) | 47,204 to 30,834 | 104.0 to 103.6 | 61.2 to 59.9 | 0.0187 to 0.0225 |
  | logo, Centerline | 809 to 543 (164) | 18,820 to 16,022 | 77.0 to 76.9 | 50.9 to 50.4 | 0.0007 to 0.0207 |
  | four discs, Line Art | 251 to 96 (53) | 5,280 to 3,014 | 21.2 to 21.2 | 12.5 to 12.3 | 0.0006 to 0.0211 |
  | three rings, Line Art | 523 to 226 (101) | 10,788 to 6,454 | 39.0 to 39.0 | 17.5 to 17.3 | 0.0006 to 0.0200 |
  | owl, Line Art | 60,967 to 35,973 (8,841) | 1,293,955 to 926,894 | 2,167 to 2,161 | 1,596 to 1,587 | 0.0219 to 0.0228 |
  | hummingbird, Line Art | 33,908 to 20,209 (5,258) | 725,737 to 530,920 | 1,271 to 1,260 | 894 to 885 | 0.0007 to 0.0222 |

  The discs and rings are synthetic 400 px images (radii 8 to 150 px). "Before" deviations near
  zero are straight-segment traces the G1 program reproduces exactly; the arc program uses the
  tolerance there too, as ADR-391's simplification does.
- Much of the saving on curves is the fitter's chord placement, not the arcs: the greedy fit
  reaches as far as the tolerance allows, where compile's midpoint subdivision stops early (ADR-391
  measured the same gap). On the logo's Line Art curved outlines alone the fit takes 1,055 moves (405
  arcs) for compile's 2,309 chords; on the owl's, 18,003 (3,449 arcs) for 34,985.
- Joints get fewer and smoother, not uniformly G1. On the logo's Line Art, joints between burn
  moves go from 2,886 to 1,448; turning under 0.05 degrees, 9 to 154; up to 4 degrees, 790 to 311;
  4 to 60 degrees, 1,878 to 747; 60 degrees or more, 209 to 236. The last group grows where a chord
  bridges a feature too tight for an arc (radius under 0.1 mm) or merges two sub-60-degree turns, as
  ADR-391's simplification does. Biarcs meet exactly; single arcs within 2 degrees of the source.
- Speed is not measured on hardware. The estimate improves 2% at 6,000 mm/min on the logo and less
  at the default speed, where acceleration and travel dominate. The estimator plans with unlimited
  lookahead; GRBL 1.1 plans 15 blocks, and an arc occupies one block per `mc_arc` chord (about
  0.28 mm at 5 mm radius, against a 1.0 mm tolerance chord), so a very fast job on GRBL 1.1 reaches
  less lookahead distance through arcs while turning its junctions far more gently. grblHAL's
  default 100-block planner is not short of lookahead.
- The serial link carries 30 to 58% fewer lines and 15 to 43% fewer bytes on these cases.
- Commit-time cost is unchanged; compile gains the fit: about 40 ms on the logo and 210 ms on the
  owl (60,967 G1 moves) in a Node harness.
- Traced straight-segment subpaths gain least: ADR-391 already reduced them to vertices up to
  0.025 mm off the traced samples, so an arc through those vertices rarely fits (the largest traced
  disc, 45 mm across, goes from 97 G1 moves to 48). Fitting their dense samples at commit instead measured 18 moves against 48 for
  one disc, and 14,343 against 17,929 over the owl's straight subpaths, but would store arcs in the
  scene and change the G1 program for every machine; it is left to its own decision.
- The preview keeps the prepared job's route wherever the executable-plan route disagrees with it
  at emitted precision. The plan samples G2/G3 as the display parser does, not as the prepared
  route does, so expect arc jobs to show the prepared route, which draws the arcs.
- Profiles that name no controller, including the built-in Default profile, stay G1; so every
  existing test and saved project without an explicit GRBL-family controller emits byte for byte
  what it did. Assumed controller setting: stock `$12`. A larger `$12` sags GRBL's chords further
  (GRBL's own behaviour); the switch turns arcs off.
- Tests: `fit-arc-moves.test.ts` (circles, corners, placement, independent Hausdorff oracle),
  `grbl-laser-arc-moves.test.ts` (golden G2/G3, semantics identical to G1, byte-identical G1 where
  arcs are off, parse-back, no full-circle from rounding), `cut-arc-moves.test.ts` (compile, bounds
  of a half-turn whose chord hull is flat, preview, origin, reversal, rotary, overlap removal),
  `laser-arc-moves.test.ts`, `controller-arc-points.test.ts`, `project-laser-arc-moves.test.ts`, and
  `arch-house-laser-arcs.test.ts`, which traces, commits, compiles, emits and parses the logo end to
  end.

Not part of this decision: fitting arcs at trace commit; arcs for kerf-offset contours, Follow
Shape fills or CNC output; reading `$12` from the controller; modelling the finite planner ring in
the estimate; hardware or material qualification.
