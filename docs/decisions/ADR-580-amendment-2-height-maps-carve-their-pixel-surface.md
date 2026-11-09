## ADR-580 Amendment 2 - A height map is carved on the surface through its pixel centres (2026-11-08)

**Status:** Accepted. | **Date:** 2026-11-08

This amends ADR-580 Decision 1 ("Height-map reliefs are unchanged") and ADR-412 Amendment 1 for
height-map reliefs. It fixes rolling audit v2 finding 16-P2-1 as extended by CNC audit v1 F6-P2-1
(`docs/audits/2026-10-21-rolling-v2/LEDGER.md`, `docs/audits/2026-10-23-cnc-v1/F6-cnc-relief-3d.md`),
re-measured on main by the 2026-11-08 pro loop audit (`docs/audits/2026-11-08-pro-loop-v1/`). No
Frame, Start, output or licence gate is added or removed (ADR-228, ADR-565).

### Context

Relief CAM read a height map into cells that each hold the highest pixel under the cell
(`heightfield-to-heightmap.ts`). Finishing cells are about a tenth of the ball's diameter, so on a
typical map (0.1 mm pixels) a cell spans more than a pixel, and the highest pixel stands above the
slope by up to half the cell plus half the pixel times the gradient. The finishing tip is the
max of the lattice kernel over those cells and the exact contact with them, so the whole rise was
left as stock. The 2026-11-08 loop compiled a 24 × 10 mm depth map with 0.1 mm pixels (flat, 20°,
42° bands) through `emitGcode`, then stamped the emitted program with its own ball drop-cutter:

| Same surface, 1/8" ball, 0.025 mm scallop, rows along the slope | 20° median skin | 42° median skin |
|---|---|---|
| Depth map, highest pixel per cell | 0.064 mm | 0.154 mm |
| STL of the same planes (ADR-580 exact mesh) | 0.004 mm | 0.008 mm |

A finer scallop did not help, because the cell rise does not depend on the row spacing. The same
map carved at one cell per pixel was already carved on the triangulated pixel-centre surface (the
ADR-412 grid contact field), so the result depended on the ratio of cell to pixel, not on the map.

### Decision

1. **Relief CAM reads a height map on the surface through its pixel centres.** Under
   `sampling: 'exact-mesh'` (every relief CAM call: roughing, finishing, rest, projection),
   `heightfieldToHeightmap` builds that surface (`heightfield-exact-surface.ts`): two triangles per
   quad of pixel centres, split along the diagonal whose midpoint stands higher, which is the upper
   envelope of both triangulations and bounds the bilinear patch from above, as ADR-412's grid field
   does. A half-pixel border carries each edge pixel's value out to the relief's edge, as that
   pixel's footprint did. Level runs of quads in a row are merged into one rectangle. Each cell reads
   the surface at its centre, and the map carries the triangles in `Heightmap.exactSurface`, which
   the mesh contact field already solves the cutter against (ADR-580 Decision 1), so detail
   narrower than a cell still lifts the tip.
2. **Where it does not apply, nothing changes.** A field whose mask excludes an area keeps its
   highest-pixel cells, because the mesh contact field does not model excluded whole-cell stock. A
   field over 1024 × 1024 pixel quads (`MAX_EXACT_HEIGHTFIELD_QUADS`, about 151 MB of coordinates)
   keeps them too. Previews keep their own sampling.

### Consequences

- The same bench now leaves a median 0.007 mm on 20° and 0.009–0.016 mm on 42° (rows across / along
  the slope), against the sampled pixel surface within 0.001 mm.
- A sharp convex crease that falls between pixel centres is cut on the chord between them, by up to
  a quarter pixel times the change in slope (0.016 mm on the bench's 42° crest, 0.1 mm pixels). This
  is the surface the map holds, and the result it already gave at one cell per pixel. A vertical
  step between two pixels becomes a one-pixel slope.
- Every height-map relief without an excluded mask emits different roughing and finishing G-code;
  the emitter revision advances to v42. STL reliefs and other cut types are unchanged.
- Finishing takes longer to compute: a 40 mm map took 10.5 s instead of 1.6 s at 400 × 400 pixels,
  and 25 s at 800 × 800, on the maintainer's PC. Roughing stayed under a second.
- Simulated evidence only: no air-cut, material or hardware result is claimed.

### Verification

- `heightfield-exact-surface.test.ts`: cell centres read the triangulated surface, a saddle quad
  takes its higher diagonal, a cropped field spans the relief edge to edge, a field over the budget
  keeps the old cells, and a masked field gets no surface.
- `compile-cnc-relief-heightfield-surface.test.ts`: through the compiler, a ball finishing a sampled
  ramp rides it at the ball-on-plane height within one 16-bit code and the check's 0.002 mm (it
  failed by the old cells' rise before this change); a masked field stays conservative.
- `compile-cnc-relief-entry-plunge.test.ts`: the plunge fixture now uses a 5.2 mm hole, because the
  6 mm hole's loop, read on its true surface, is long enough to ramp round.
