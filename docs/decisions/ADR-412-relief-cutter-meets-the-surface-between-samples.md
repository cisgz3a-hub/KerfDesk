## ADR-412 - Relief toolpaths meet the model surface between samples, and roughing keeps its allowance in 3D (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This amends the Phase H.5/H.8 relief planners (ADR-098, ADR-289, ADR-294). The heightmap, its
cell sizes, the row and ring layout and the emitter are unchanged. What changes is how high the
tip must stay at each planned point, and how roughing measures its finishing allowance.

### Context

Relief roughing and finishing place the tool tip at every heightmap sample by max-plus dilation:
the tip may descend to `max over kernel offsets of (h(sample) - dz(offset))`, where `dz` is the
cutter's height above its tip at that radius. That tests the cutter only against the sample
points its lattice reaches. On a steep wall the cutter's real contact lies between two samples, so
the sampled maximum understates how high the tip must stay.

A bench relief (60 x 40 mm, 10 mm deep, a dome plus a plateau with 70 degree walls) was cut in the
material-removal simulator on a 0.1 mm grid with exact cutter stamping, and compared with the
analytic model. On main (c5ab27e):

| Cut | Where | Into the model, measured normal to it |
|---|---|---|
| Finish, 3.175 mm ball, 0.025 mm scallop | walls over 45 degrees | median 0.024, p95 0.068, worst 0.136 mm |
| Finish, same | 10 to 45 degree slopes | p95 0.013 mm |
| Rough, 3.175 mm end mill, 0.5 mm allowance | walls over 45 degrees | worst 0.30 mm |

The roughing result has a second cause. The 0.5 mm finishing allowance was added to the tip depth
only, so on a near-vertical wall roughing left no stock sideways: it cut to, and past, the wall
the finishing pass was meant to clean up.

### Decision

1. **Exact contact between samples.** `heightmap-surface-contact.ts` treats every grid quad whose
   four corners are included as the upper envelope of both of its diagonal triangulations. The
   two splits differ by `(za + zd - zb - zc)` times a nonnegative tent, so one split lies on top
   everywhere and only it (with its own diagonal) is solved. Quads with three included corners
   keep the triangles those corners form; any two adjacent included samples keep their edge. No
   triangle uses an excluded sample, so no surface is invented inside a mask. For each sample the
   tip is raised to the highest height at which the cutter touches any triangle or edge within
   its radius. Every supported cutter law is convex and nondecreasing in radius, so on a triangle
   the contact lies on the uphill ray where the cutter is as steep as the facet, and along an edge
   it is an endpoint, the nearest approach, a stationary point of one smooth piece of the cutter,
   or a crossing between pieces. `heightmap-surface-contact-geometry.ts` solves these in closed
   form for flat, ball, conical and tapered-ball cutters and falls back to a golden-section search
   for a widened ball or tapered law. Every candidate is scored with the kernel's own
   `surfaceDzAtRadius`.
2. The contact is applied after the existing lattice and mask constraints in
   `dilateHeightmapByTool` and `dilateHeightmapByToolWithMaskEvidence`, so it can only raise a
   tip. `betweenSamples: false` keeps the lattice alone for the bit-exact reference tests.
   Finishing computes only the rows it cuts (and, since ADR-421, the edge columns that link
   them); it never reads the others.
3. **Allowance in 3D.** Roughing plans with the cutter widened horizontally by the allowance plus
   the marching-squares clearance (`sqrt(10)/4` cells), using the law `dz(max(0, r - g))`, and
   then lifts the result by the allowance. Every ring point lies within that clearance of a
   selected sample, so the real cutter keeps at least the allowance from the surface sideways as
   well as vertically. The widened law also covers excluded-mask stock, so roughing adds no
   separate mask path uncertainty. `ToolKernel` gains `horizontalGrowthMm` (0 everywhere else).
4. Speed. Elements are pruned first by their highest corner at their nearest approach, then by a
   supporting-line bound (the cutter law lies above its tangent at the nearest approach, which
   makes the objective linear on each triangle, so its corners bound it), then facets are solved
   before edges, most promising first. Hot paths allocate nothing.

### Consequences

- The same bench after this change:

  | Cut | Where | Into the model, normal |
  |---|---|---|
  | Finish, ball | walls over 45 degrees | median none (stock left), p95 0.014, worst 0.083 mm |
  | Finish, ball | the dome's walls alone | p95 0.019, worst 0.040 mm |
  | Finish, ball | 10 to 45 degree slopes | p95 0.002 mm |
  | Rough, end mill | dome walls / plateau walls / floors | never closer than 0.21 / 0.56 / 0.50 mm |

  The finishing residue that remains is on the plateau: worst 0.083 mm on its walls (0.136
  before) and 0.108 mm on its top crease (0.133 before). That is the sampled model itself: a
  sharp convex crease between two samples is replaced by a chord below it, and the cutter can
  only be exact against the surface it is given. A finer grid is the remedy there, not a
  different contact.
- Compile time grows. Dilating a 1,200 x 1,200 map with a 0.1 mm ball went from 0.47 s to 2.9 s
  on a plane and from 0.45 s to 6.2 s on a steep wavy surface; the bench relief compiles in about
  0.6 s instead of 0.37 s. Finishing computes only its emitted rows, which cut the slowest existing
  test (0.1 mm ball, 0.005 mm scallop) from 3.3 s to 1.3 s.
- Roughing leaves slightly more stock on walls, and a level can end a little higher next to a
  wall. The emitted roughing G-code of the pyramid snapshot changed accordingly.
- Qualification. Each emitted vertex now clears the whole piecewise-linear surface under the
  cutter, not just its samples. The straight XY chord between two emitted vertices, subcell
  detail finer than the grid, and holder or shank clearance keep ADR-289 and ADR-294's
  qualification boundary.
- Tests: `heightmap-surface-contact.test.ts` pins every closed form against known answers on
  planes and ridges and compares arbitrary masked, shortened-edge maps with an independent search
  oracle and dense surface samples (it found and now guards a level-edge double root that
  rounding lost). `relief-roughing-3d.test.ts` checks the 3D allowance on a 70 degree wall; with a
  vertical-only allowance it measured 0.25 mm, and with none -0.55 mm.
