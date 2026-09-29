## ADR-412 Amendment 1 - Relief CAM reads each mesh cell at its highest point (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

### Context

ADR-412 makes the cutter meet the piecewise-linear surface through the heightmap's samples. That
is only as safe as the samples: a sample lower than the model over its cell lets the cutter into
the model. A depth-map relief already gives relief CAM a conservative map, because each coarse
cell holds the highest source pixel under it (`heightfield-to-heightmap.ts`). A legacy-mesh (STL)
relief did not. `meshToHeightmap` read each cell at its centre, for CAM as for previews, so a
raised detail narrower than a cell that held no cell centre was not in the map at all.

The second CNC audit reproduced it (P2-relief-rough-1, high). A 0.4 mm rib standing 4 mm tall
between two roughing cell centres of a 1/4" end mill (0.794 mm cells) was cut 3.5 mm down, and a
boss's walls kept 0.40 mm of a 0.5 mm allowance. Finishing (P2-relief-finish-1) shaved 0.17 to
0.55 mm off the tops of walls that stand between finishing cell centres.

### Decision

1. **Relief CAM reads each cell at its highest point.** Both relief heightmaps in
   `compile-cnc-relief.ts`, roughing and finishing, ask `reliefObjectToHeightmap` for
   `sampling: 'footprint-max'`. For a mesh source each cell then holds the highest point of any
   triangle over the cell's whole closed footprint (`triangle-footprint-raster.ts`). Z is linear on
   a triangle, so its highest point over triangle ∩ cell is a vertex of that convex polygon: a
   triangle vertex in the cell, a cell corner inside the triangle, or a point where a triangle edge
   crosses the cell boundary. Each edge is clipped to the cell, and the corners are tested with the
   centre rasterizer's edge function. A cell wholly inside a triangle takes its highest corner. The
   value is clamped to the triangle's highest vertex, so rounding cannot lift a cell above it.
2. **No tie rule; walls count.** Footprints are closed. A triangle that only touches a cell's
   boundary lifts that cell, which can only keep the cutter higher. A triangle with almost no plan
   area, such as a vertical STL wall, lifts the cells under its edges. Max accumulation keeps the
   map independent of triangle order.
3. **The grid is unchanged.** Cell sizes, the nominal cell frame and the short terminal cell stay
   as they were. The mesh never reaches past its nominal extent, so a unit footprint reads a short
   terminal cell exactly as far as the mesh goes.
4. **A 'top' background stays centre-resolved.** With `emptyCells: 'top'`, a cell whose centre no
   triangle covers stays at the stock top, decided exactly as centre sampling decides it. Without
   this, a cell half on the model and half on the background would drop from the stock top to the
   model's edge. So the CAM map is never below the centre-sampled map, under either background.
5. **Previews keep centre sampling.** `sampling` defaults to `'center'`. The workspace relief
   drawing, the 3D relief viewer, STL import preparation and the G-code inspector's design target
   (ADR-487) do not pass it. They show the design or compare the carved stock with it, and a
   conservative bound would hide the stock finishing leaves. Depth-map reliefs ignore the option.
6. Nothing new is shown to the operator: no warning, no Start gate.

### Consequences

- Measured through the real compiler, sweeping every move against the true model (scratch audit
  probes, not committed):

  | Case | Centre sampling | Highest point |
  |---|---|---|
  | Rough, 1/4" end mill, 0.5 mm allowance: 40 mm STL, 3 bosses, 5 ribs 0.4 x 4 mm | a rib cut 3.5 mm deep; boss walls 0.40 mm; two ribs 0.19 and 0.23 mm | nothing closer than 0.455 mm (a rib's corner); boss walls 0.89 mm or more |
  | Rough, 1/8" end mill, same model | nothing closer than 0.265 mm | nothing closer than 0.47 mm |
  | Finish, 1/8" ball, default scallop: vertical-walled STL boss at 8 sub-cell offsets | wall tops cut 0.18 to 0.35 mm | wall tops cut 0.04 to 0.18 mm |
  | Finish, 1/8" ball, 0.025 mm scallop: R12 hemisphere STL | cut up to 0.065 mm into the model | no cut |

- A raised detail narrower than a cell now lifts every cell it touches, so roughing no longer cuts
  into it and finishing rides over it instead of through it. Next to the detail's edge the
  planning surface still slopes down from the raised sample, so the allowance there can come up a
  little short, as at the rib corner above.
- Finishing a wall that stands between samples is better, not exact. The planning surface between
  a raised sample and its lower neighbour can still pass under the wall's top edge, now by at most
  half a cell horizontally instead of a whole cell. ADR-412's qualification boundary for subcell
  detail still applies to what is left.
- The map is a small dilation of the mesh. Each sample is at most half a cell (per axis) outside
  the feature it carries, and on a smooth slope a cell rises above its centre value by up to
  `(|gx| + |gy|)` times half a cell. Roughing keeps that as extra stock. Finishing leaves it on
  slopes, as it already did for depth maps: on the hemisphere, measured normal to the surface at
  the emitted points, a 1/8" ball at 0.025 mm scallop leaves a median 0.06 / 0.12 / 0.16 mm on
  slopes under 30 / 30 to 56 / 56 to 73 degrees (p95 0.18 mm), and a 1/4" ball at 0.05 mm scallop
  0.12 / 0.24 / 0.32 mm (p95 0.36 mm). Centre sampling left about nothing there, and cut into the
  model elsewhere (table above). A finer scallop shrinks the finishing cell and this stock with it.
- Rasterizing is not slower. For an 80 x 60 mm sculpted STL (239k triangles) the highest-point
  raster takes 86 ms at 0.79 mm cells and 133 ms at 0.28 mm cells, against 132 and 187 ms for the
  centre raster. The whole relief compile took 6.5 s instead of 7.8 s (one run each, on a loaded
  machine), and roughing emitted 53 passes instead of 81.
- Every legacy-mesh relief emits different roughing and finishing G-code. The emitter revision is
  not advanced by this change alone; it is advanced once for the audit's fix set.
- The pyramid G-code snapshot in `relief-roughing.test.ts` changed. Its 0.4-slope faces rise by
  0.079 mm (the slope times half of a 0.397 mm cell): the corner clean-up level moves from Z-2.799
  to Z-2.720, and the Z-1.5 level's island grows by one cell on two sides, so the middle ring is
  kept only at the corners (4 passes become 6). A separate sweep of both programs against the true
  pyramid finds the cutter never closer than 0.638 mm before and 0.713 mm after (allowance 0.5).

### Verification

- `triangle-footprint-raster.test.ts`: a triangle covering part of a cell but not its centre raises
  that cell; a strip narrower than a cell lifts every cell it touches; a vertical wall lifts the
  cells under its top edge; a triangle touching only a cell boundary counts; on random triangles
  each cell equals the highest point of triangle ∩ cell from an independent polygon clip, and is
  never below the centre sample; triangle order does not matter.
- `mesh-to-heightmap-footprint.test.ts`: a rib between two centres keeps its full height; a short
  terminal cell reads only as far as the mesh reaches; the footprint map is never below the centre
  map under 'floor' or 'top'; 'top' background stays where no triangle covers the centre; a
  one-cell domain reads the mesh's highest point.
- `compile-cnc-relief-mesh-sampling.test.ts` compiles an STL rib narrower than a cell with no cell
  centre on it. Roughing with a 1/4" end mill keeps the full 0.5 mm allowance to the rib (0 mm
  before, cut into it). Finishing with a 1/8" ball rides over a 0.2 mm rib within the finishing
  path's 0.002 mm contact tolerance (worst -0.0002 mm; before, the ball ran through the rib at floor
  height, -1.59 mm). Both fail with centre sampling.
- The existing relief tests under `src/core/relief`, the relief compile tests under `src/core/cnc`,
  and the preflight, recovery, Job Review and G-code tests that compile reliefs pass; only the
  pyramid snapshot above changed.
- No hardware result is claimed.
