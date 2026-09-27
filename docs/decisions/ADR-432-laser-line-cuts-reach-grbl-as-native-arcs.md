## ADR-432 - Laser line cuts reach GRBL as native arcs (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

This extends ADR-391, which left every traced path reaching the laser as G1 moves: compile flattens
the canonical curves into chords at `DEFAULT_MACHINE_CURVE_TOLERANCE_MM` (0.025 mm) and the laser
GRBL emitter writes one G1 per chord. CNC output (ADR-260, `CncArcPass`) is unchanged. The
Frame-first contract (PROJECT.md non-negotiable 21, ADRs 228, 230, 232 and 237) is unchanged: Frame
still traces `computeFrameJobBounds` of the compiled job, which now bounds the arcs as GRBL runs
them.

### Context

On the current base (`fa8939b8d`) the Arch House logo traced with Line Art and placed 100 mm wide
compiles to 2,946 G1 burn moves: 814 fitted cubics and 1,664 straight segments, the cubics flattened
by compile's midpoint subdivision. Every G2/G3 consumer except the laser emitter and the painted
second pass already existed: the CNC emitter writes arcs, and the program parser
(`core/gcode/arc-solve.ts`), render model, timeline, motion manifest and executable plan all read
them.

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
  0.005 mm and also by more than 0.5 mm or 0.1% of the radius, and an arc with no axis word in its
  plane ([gcode.c](https://github.com/gnea/grbl/blob/master/grbl/gcode.c)). The plane is modal
  (G17/G18/G19): in G18/G19 an XY I/J pair is an invalid offset (error:33) and Z becomes a circular
  axis, the hazard `cnc-grbl-transitions.ts` already pins G17 against.
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
     Geometry 41(1-2), 2008; none was re-read from the build environment). Biarcs meet the source
     tangent exactly, single arcs within 2 degrees at both ends, and a straight chord arrives within
     29 degrees (`ARC_FIT_MAX_CHORD_TANGENT_DEG`). Every candidate must also leave the move before
     it with a turn under the 60-degree corner angle, and the chord's arrival bound leaves the next
     move room to do the same, so no joint of 60 degrees or more appears where the source is smooth
     (short of a feature finer than the sampling, whose own sample chord is the fallback). Without
     this rule a chord bridging a feature too tight for an arc made a sharp joint where the source
     curve had none;
   - straight-segment runs (no tangents): a line or the fitted arc through the run's ends,
     whichever reaches farther; one spanning several source vertices must also leave the move
     before it under the corner angle, as the source vertices inside a run do.

   Every candidate passes an exact two-sided check against the sampled source
   (`arc-piece-check.ts`): for a line, distance to a segment is convex; for an arc, every source
   point must sit inside the arc's sector (sweep at most 179 degrees, so the sector is convex) within
   the bound of the circle, and every source chord's closest approach to the centre too. The bound
   is the 0.025 mm machine tolerance minus the source sampling error (0.001 mm), 3-decimal rounding
   (0.002 mm) and, for arcs, the sag of the chords GRBL will cut that arc into at the stock `$12`.
   Radii run from 0.1 mm (there one 0.0005 mm I/J rounding step is 0.5% of the radius, and the arc is
   under a diode spot) to 1,000 mm (32-bit float spacing is at most 0.00012 mm for coordinates under
   2,048 mm; any flatter arc is emitted as the line that fits).
2. **Compile.** In a line-mode layer on an arc-enabled machine, each CutSegment keeps its polyline
   exactly as before and gains `arcMoves` when the fit takes fewer moves than the chords: the moves
   (from `polyline[0]`, ending exactly on its last point) with a fingerprint of the polyline they
   were fitted against (first point, point count and length). Kerf offsets, tabs and fills never
   carry arcs. The fit runs for every line-mode path on such a machine, SVG, text, shapes and DXF
   included, not only traces.
3. **Capability** (`core/devices/laser-arc-moves.ts`). Only a profile naming GRBL 1.1, grblHAL or
   FluidNC without a vendor command set (the Falcon A1 Pro) and without the qualified
   `neotronics-4040-safe` dialect can carry arcs, and never while a rotary is enabled (its Y scale
   turns circles into ellipses). Naming the family does not establish the firmware, so arcs are on
   by default only for a firmware-family profile: vendor unnamed or `Generic` (the generic GRBL,
   grblHAL and FluidNC starters, and machines the operator describes by controller alone) on a stock
   dialect. Brand machine profiles (xTool, Sculpfun, Ortur, the Falcon-compatible fallback), whose
   vendor firmware build the catalogue does not establish, and the `grbl-compatible` dialect (the
   escape hatch for older firmware) keep G1 unless the operator turns arcs on. A profile naming no
   controller, including the built-in Default 400x400, never gets arcs. Machine Setup shows an
   **Arc moves** switch wherever the family can carry arcs, starting at the profile's default and
   disabled with a note while a rotary is enabled; `laserArcMoves: 'on' | 'off'` persists in
   projects and `.lfmachine` files, and anything else reads as the default.
4. **Emission** (`core/output/grbl-laser-arc-moves.ts`). G2/G3 in the offset form, I/J from the
   already-rounded start, with the G1 path's F and S placement, zero-length skipping, power mode,
   passes and air assist. The laser preamble selects `G17` after `G94` whenever the job writes arcs,
   so a plane left changed by a console command or a `$N` startup block cannot turn an arc into
   error:33 or a Z swing; a job without arcs stays byte-identical. Before writing an arc, its rounded
   words are replayed as GRBL reads them (`emittedArc` in `core/job/cut-arc-moves.ts`: radius
   check, angular travel with the full-turn push); an arc whose words would not reproduce it is
   written as G1 chords. A contour with an ADR-239 tangential entry runway stays G1. Laser resume
   transform 4 (`resume-program.ts`) re-selects the plane the program had active, or `G17` when the
   replayed tail holds G2/G3 and the program named none; archived resume steps keep their recorded
   transform and bytes.
5. **Consumers.** One predicate, `emittedCutArcMoves(segment, { arcMovesEnabled, entryRunwayMm })`,
   decides for the emitter, bounds and preview whether a segment goes out as arcs; moves whose
   polyline no longer matches the fingerprint are ignored everywhere. Job and Frame bounds take
   `laserArcMovesEnabled(device)` and bound each arc both as fitted and about the centre and radius
   its rounded words give GRBL, whose chords lie inside that circle; move ends are bounded
   unrounded, as on the G1 path. Without a device, bounds hold both the polyline and the arcs. The
   preview samples the arcs within 0.01 mm. Job origin translation and path reversal carry the moves
   with a fresh fingerprint; rotary scaling and overlap-removal splits drop them. Laser timing on
   GRBL-family controllers interpolates G2/G3 as `mc_arc` does at the stock `$12`
   (`controllerArcToleranceMm`), and each such arc counts against the live-countdown segment budget
   (`maxSegments`) as the chords the machine curve tolerance would spend on it
   (`controllerArcBudgetSegments`), not as its denser `mc_arc` chords. The painted second pass
   (`core/laser-second-pass/source.ts`) reads a G17 I/J arc as the `mc_arc` chords at the stock
   `$12`, refusing what GRBL refuses (radius mismatch, no end point) and R arcs; its writer emits
   those chords as G1, so the darkening offer made for GRBL-family controllers keeps working.
   The executable-plan preview route is not attempted for a job that writes arcs (see
   Consequences). CNC timing is unchanged.

### Consequences

- Measured with a Node harness on this branch, traced, committed and compiled 100 mm wide with a
  Line operation for a GRBL 1.1 profile (vendor Generic) with Arc moves on, then off (off is the G1
  program every earlier build writes); time is the app's estimate at the layer's default
  1,500 mm/min and the stock 500 mm/s², and at 6,000 mm/min with 1,000 mm/s²; deviation is the
  largest two-sided distance from the canonical curves to what GRBL executes (arcs as `mc_arc`
  chords at `$12` 0.002), from the fitted moves:

  | Image, preset | Burn moves (G2/G3) | Program bytes | Time 1,500 (s) | Time 6,000 (s) | Largest deviation (mm) |
  |---|---|---|---|---|---|
  | logo, Line Art | 2,946 to 1,605 (522) | 61,080 to 42,324 | 126.4 to 125.5 | 71.1 to 69.3 | 0.0196 to 0.0234 |
  | logo, Smooth | 2,269 to 1,233 (407) | 47,200 to 32,753 | 104.0 to 103.2 | 61.2 to 59.5 | 0.0194 to 0.0234 |
  | logo, Centerline | 809 to 543 (165) | 18,816 to 16,038 | 77.0 to 76.9 | 50.9 to 50.4 | 0.0010 to 0.0217 |
  | four discs, Line Art | 300 to 109 (58) | 6,256 to 3,363 | 24.1 to 24.1 | 13.2 to 13.0 | 0.0010 to 0.0203 |
  | three rings, Line Art | 504 to 284 (87) | 10,404 to 7,414 | 40.8 to 40.8 | 18.2 to 18.1 | 0.0010 to 0.0227 |
  | owl, Line Art | 60,967 to 44,664 (9,048) | 1,293,951 to 1,103,833 | 2,167 to 2,121 | 1,596 to 1,558 | 0.0228 to 0.0236 |
  | hummingbird, Line Art | 33,908 to 20,289 (5,219) | 725,733 to 531,928 | 1,271 to 1,260 | 894 to 885 | 0.0010 to 0.0230 |

  The discs (radii 8, 30, 80 and 110 px) and rings (150/130, 90/70 and 30/16 px, concentric) are
  synthetic 400 px images drawn by the harness. "Before" deviations near 0.001 mm are
  straight-segment traces the G1 program reproduces exactly; the arc program uses the tolerance
  there too, as ADR-391's simplification does.
- Much of the saving on curves is the fitter's chord placement, not the arcs: the greedy fit
  reaches as far as the tolerance allows, where compile's midpoint subdivision stops early (ADR-391
  measured the same gap).
- Joints get fewer and smoother. On the logo's Line Art, joints between burn moves go from 2,886 to
  1,545; turning under 0.05 degrees, 11 to 175; 0.05 to 4 degrees, 784 to 300; 4 to 60 degrees,
  1,881 to 915; 60 degrees or more, 210 to 155. On the owl, joints of 60 degrees or more go from
  11,691 to 7,417. The remaining sharp joints are the source's corners and features finer than the
  fitter's sampling; `fit-arc-moves.test.ts` pins that a smooth hairpin gets no joint sharper than
  the G1 chords' own, and none of 60 degrees once it is wider than the tolerance, and the
  arch-house test that the arc program has no more 60-degree joints than the G1 program.
- The joint rule has a price in moves. An earlier revision of this decision, without it, measured
  1,508 logo moves with 235 joints of 60 degrees or more (more than the G1 program's 210), and
  35,973 owl moves with 12,355 (G1: 11,691). The rule costs 97 moves on the logo and 8,691 on the
  owl, whose fur texture is full of sub-tolerance wiggles a free chord would cut across; a sharp
  joint forces the head almost to a stop with the beam on, which is the burn mark the arcs are
  meant to avoid, so the moves are spent.
- Speed is not measured on hardware. The estimate improves 1 to 3% on the logo and the owl, most
  at 6,000 mm/min, where junctions dominate. The estimator plans with unlimited lookahead; GRBL 1.1
  plans 15 blocks, and an arc occupies one block per `mc_arc` chord (about 0.28 mm at 5 mm radius,
  against a 1.0 mm tolerance chord), so a very fast job on GRBL 1.1 reaches less lookahead distance
  through arcs while turning its junctions far more gently. grblHAL's default 100-block planner is
  not short of lookahead.
- The serial link carries 27 to 64% fewer burn lines and 15 to 46% fewer bytes on these cases. The
  machine setup switch says only that; it no longer promises smoother motion, which is not
  measured.
- The timing model holds more segments than the G1 program it replaces, because `mc_arc` chords at
  0.002 mm are about 3.5 times denser than tolerance chords: 3,007 to 3,874 on the logo, 305 to 533
  on the discs, 63,155 to 77,496 on the owl and 35,306 to 42,955 on the hummingbird. Counting each
  arc against the 25,000-segment live-countdown budget as its tolerance-chord equivalent keeps a
  program that fits the budget as G1 inside it as arcs (`controller-arc-points.test.ts`). The owl
  and the hummingbird exceed the budget either way. The hummingbird placed 50 mm wide, a mid-size
  job, has 28,002 segments as G1 (no live countdown) and 29,487 as arcs, which count as fewer than
  25,000, so it gains the countdown. The model's memory for arc-heavy jobs near the budget grows by
  up to the chord factor on the arc part, a few megabytes at most.
- The G-code Inspector's own timeline is unchanged and overstates arc time: it is a fixed-limit,
  device-independent model (500 mm/s², 0.01 mm, 6,000 mm/min) built on the display parse, which
  draws G2/G3 at up to 15-degree chords whose junctions slow it, as it already did for every CNC
  and imported arc program. The job estimate, live countdown and Job Review use the controller's
  chords. On an earlier revision, the logo at 6,000 mm/min measured 97.2 s in the Inspector against
  the estimate's 92.1 s for the arc program; the two agree on G1 programs.
- The preview keeps the prepared job's route for any job that writes arcs. The executable-plan
  route draws G2/G3 with the display parser's chords and declares arc-true lengths, so it can never
  match the prepared route at emitted precision (measured: 35 plan segments against 101 prepared on
  one 10 mm circle); `planPreviewRouteEligible` declines arc jobs before paying for the emission,
  plan and comparison. The prepared route samples arcs within 0.01 mm, fewer points than the G1
  chords it replaces.
- Frame bounds of an arc hold what GRBL executes from the rounded words: on a constructed arc whose
  rounded start lengthens GRBL's radius by 0.00054 mm the Frame reaches the executed apex, and on
  the logo every point the app's parser executes from the emitted program lies within half a
  3-decimal step of the Frame bounds, as for the G1 program.
- Default output changes only for firmware-family profiles: the generic grblHAL and FluidNC
  starters, and saved or user-built profiles naming GRBL 1.1, grblHAL or FluidNC with no vendor or
  vendor `Generic`. Their line-mode curves (traces, SVG, text, shapes, DXF) now go out as arcs.
  Brand profiles, the Default profile and every profile naming no controller emit byte for byte
  what they did, unless the operator turns Arc moves on.
- Compile gains the fit on arc-enabled machines: about 40 ms on the logo and 350 ms on the owl in
  a Node harness. It also runs on subpaths whose fit is then discarded; a pre-check was considered and
  not added, because the fit of an all-corner polygon (the only case it could skip cheaply) already
  costs next to nothing and curves, where the time goes, are where the fit pays.
- Traced straight-segment subpaths gain least: ADR-391 already reduced them to vertices up to
  0.025 mm off the traced samples, so an arc through those vertices rarely fits. Fitting their dense
  samples at commit instead would store arcs in the scene and change the G1 program for every
  machine; it is left to its own decision.
- Assumed controller setting: stock `$12`. A larger `$12` sags GRBL's chords further (GRBL's own
  behaviour); the switch turns arcs off.
- Tests: `fit-arc-moves.test.ts` (circles, corners, placement, smooth hairpin joints, independent
  Hausdorff oracle), `grbl-laser-arc-moves.test.ts` (golden G2/G3, G17 before the first arc and only
  with arcs, semantics identical to G1, byte-identical G1 where arcs are off, parse-back, no full
  circle from rounding), `cut-arc-moves.test.ts` (compile, fingerprint, device- and runway-aware
  bounds, bounds of the rounded arc, bounds of a half-turn whose chord hull is flat, preview,
  origin, reversal, rotary, overlap removal), `laser-arc-moves.test.ts` (capability matrix,
  brand and catalogue defaults), `controller-arc-points.test.ts` (mc_arc chords, countdown budget),
  `resume-program.transform.test.ts` (transform 4 plane pin), `arc-source.test.ts` (second pass over
  an arc program), `executable-plan-preview-arcs.test.ts`, `project-laser-arc-moves.test.ts`,
  `LaserArcMovesRow.test.tsx`, and `arch-house-laser-arcs.test.ts`, which traces, commits,
  compiles, emits and parses the logo end to end.

Not part of this decision: fitting arcs at trace commit; arcs for kerf-offset contours, Follow
Shape fills or CNC output; reading `$12` or the firmware build (`$I`) from the controller; modelling
the finite planner ring in the estimate; the Inspector's fixed-limit timeline; hardware or material
qualification.
