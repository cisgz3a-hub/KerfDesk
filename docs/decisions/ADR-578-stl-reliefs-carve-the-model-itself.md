## ADR-578 - STL reliefs carve the model itself, at its own size, from both sides (2026-10-10)

**Status:** Accepted. | **Date:** 2026-10-10

Amends ADR-412 Amendment 1 (relief CAM's mesh sampling), ADR-423 (the default finish strategy)
and the Phase H.4 import size (ADR-098), and builds on ADR-573's two-sided setup and ADR-487's
carved stock. Requested by the maintainer after the 2026-10-10 audit of 3D carving.

### Context

The audit carved an analytic STL (a 60 × 40 mm plate with an R12 hemisphere, a 51° pyramid and a
Ø6 mm cylinder) through the real import, compiler and emitter, and swept every emitted move of the
G-code with an independent cutter simulator. Roughing never cut into the model and no rapid went
through stock, but:

1. **Finishing stood off every slope.** Relief CAM read the STL into cells holding the highest
   point of the mesh over each cell (ADR-412 Amendment 1), a dilation that rises above a slope by
   up to half a cell times its gradient. The 1/8" ball at the default 0.025 mm scallop left a
   median 0.06 / 0.10 / 0.13 / 0.32 mm (measured vertically) on slopes of 15–30 / 30–45 / 45–60 /
   60°+, and a quarter of the surface stood more than 0.1 mm above what the ball could reach. The
   app's own carved-stock compare agreed: 27% of the relief left above 0.1 mm.
2. **Steep walls kept the roughing allowance.** The default Raster finish never touches a wall
   parallel to its rows; raster + waterline existed but had to be chosen.
3. **An STL came in at 100 × 5 mm whatever its size.** A 60 × 40 × 12 mm model arrived 100 mm wide
   and 5 mm deep, its height squashed four times relative to its width, and the panel had no way
   to keep or restore proportions.
4. **Only the top could be carved.** A model needing both faces had no workflow, though the
   two-sided setup (ADR-573) already flips side B's placement before CAM.
5. **The canvas showed no carving.** Its G-code 3D tab drew lines only; the carved stock was in the
   full Inspector's readouts. Preview's Cut 3D sized its grid to the whole sheet, so on the default
   400 mm stock a 60 mm relief was a few dozen 1.2 mm cells.

### Decision

1. **The cutter meets the STL's own triangles.** `meshToHeightmap` gains `sampling: 'exact-mesh'`,
   which every relief CAM call now asks for: cells are read at their centres (the true surface
   there) and the map carries the mesh in its own millimetre frame (`Heightmap.exactSurface`).
   `createSurfaceContactField` then solves the cutter against those triangles
   (`heightmap-mesh-contact.ts`) instead of the triangulated samples: the drop-cutter of 3-axis CAM,
   with the same closed-form facet and edge solvers as ADR-412 for every modelled cutter and the
   widened roughing envelope, plus corner contacts for edges with no plan length. A bin index
   (`heightmap-mesh-index.ts`) lists each bin's triangles highest first, and a triangle no higher
   than the best tip so far is never solved. Roughing dilation, finishing rows and links, waterline
   contours, every finishing move check (ADR-421 Amendment 1), rest finishing and projection all go
   through that field, so all of them become exact. A 'top' background stands as whole-cell blocks at
   the stock top wherever no triangle covers a cell centre. Height-map reliefs are unchanged.
2. **Automatic finishes an STL with waterline passes.** An operation with no finish strategy set
   finishes an STL relief with Raster + waterline and a height map with Raster
   (`reliefFinishStrategyFor`). The select shows this as **Automatic**; choosing it removes the
   stored value. Explicit choices are kept.
3. **An STL imports at its own size.** Millimetres are the STL convention, so the model arrives at
   its own width and height with its own height as the relief depth. A model larger than the bed is
   scaled uniformly to fit through its width and depth (not its placement scale, which would leave
   the depth full size); one under 1 mm across is scaled uniformly to the 100 mm default width; a
   flat model takes the 5 mm default depth. Each case is said in the import toast, as is a model
   taller than the stock, which is not rescaled. Relief properties gain **Keep proportions** (on by
   default for an STL: a Width edit scales Depth and the reverse, one undo step) and **Use model
   proportions**, which sets Depth from the placed width and the model's own height ratio.
4. **An STL relief can be split for two-sided carving.** **Two-sided carving** in Relief properties
   replaces the relief, in one undo step, with a side A relief (the model from above, down to a split
   plane) and a side B relief (the model from below, in the same top-view frame, down to the split
   less a holding web), and assigns them to the two-sided setup, switching it on with ADR-573's
   defaults when it was off. Each side carries a 1 mm frame at its stock face round a margin, which
   fixes its Z datum at that face: the model sits centred in stock thicker than itself, and each
   side removes the stock between its face and the model. The two floors stand one web apart, so
   the part stays held. Stock thinner than the model is planned as stock exactly as thick as the
   model, and the result says so. A relief projection onto the original moves to side A.
5. **The canvas shows the carving.** The canvas's G-code 3D tab shows the carved stock's switches in
   a compact panel (ADR-487's controls), and a program carving a relief starts with its stock shown.
   Preview's removal grid, the 2D shading and Cut 3D frame the stock the whole job cuts, plus the
   widest bit's radius and 2 mm, instead of the whole sheet; the frame does not move while scrubbing.

### Consequences

- Measured with the same independent sweep, Raster + waterline at the default scallop now leaves a
  median 0.003–0.005 mm above the ball-reachable surface on every slope band (p99 0.01–0.05 mm),
  and 0.5% of the relief stands more than 0.1 mm above it (was 26%). Vertical walls finish to within
  the contact tolerance; no roughing cut into the model; the pyramid apex nick of ADR-412's grid
  interpolation is gone.
- Finishing now rides the model on its exact contact, so the finishing check's documented
  tolerance (0.002 mm normal to the move at every quarter-cell check, plus the chord's sagitta
  between checks) is the only clearance it keeps; the highest-point cells no longer add a margin
  of their own. On the steepest slopes this measures as up to 0.009 mm vertically.
- Every STL relief emits different roughing and finishing G-code; the emitter revision advances.
  Height-map reliefs, Raster-pinned operations aside from the contact itself, and other cut types
  are unchanged.
- Raster + waterline takes longer to compute and to cut than Raster: on the 60 × 40 mm bench 25 s
  of compile instead of 4 s; a 150 mm model about 75 s and 3.8 MB of G-code. Operations can still
  choose Raster.
- The split is a one-sided-per-face model: undercuts that neither face can see stay uncut, and
  physical flip accuracy, registration and holding are the operator's (ADR-573).
- No Frame, Start, output or licence gate is added; every new disclosure is a toast or a panel
  note. Simulated and rendered evidence is not air-cut, material or hardware qualification.

### Verification

- `heightmap-mesh-contact.test.ts`: on random triangle soups the field equals the independent
  search oracle for flat, ball, V, engraving and tapered-ball cutters and for the widened roughing
  envelope; a ball rides a plane at r(sec - 1) with no grid error; a vertical wall stops a flat end
  mill at its top; stock-top blocks hold the cutter; the per-move selection never drops a triangle
  that rises above the move.
- `compile-cnc-relief-exact-mesh.test.ts`: through the compiler, a ball finishing an STL ramp rides
  it within 1e-5 mm of the exact ball-on-plane height (0.042 mm off with highest-point cells), and
  Automatic adds waterline passes to an STL but not a height map.
- `compile-cnc-relief-mesh-sampling.test.ts`: the sub-cell rib keeps the roughing allowance and the
  finishing ball rides over it within the check's tolerance and sagitta.
- `relief-two-sided-split.test.ts`, `relief-two-sided-actions.test.ts`: a sphere's sides read as
  its own top and bottom surfaces at the depths their stock faces give, floors one web apart, thin
  stock disclosed; the action keeps the model in place, assigns the sides, preserves an existing
  setup's flip and undoes in one step.
- `stl-import-size.test.ts`, `cnc-removal-grid.test.ts`, `CncReliefFinishFields.test.tsx`: import
  sizing and notices, the cut-framed grid, and the Automatic strategy select.
- No hardware result is claimed.
