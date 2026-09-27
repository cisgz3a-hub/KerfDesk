## ADR-414 - An imported STL keeps its CAD top-view orientation (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This amends the Phase H.4 STL import (ADR-098, ADR-309).

### Context

An STL is modelled Z-up and read from above with +Y toward the top of the view: the back of the
model. KerfDesk's canvas is Y-down, and the relief rasterizer puts the model's minimum Y in the
heightmap's first row, which is the top of the canvas. An embedded mesh taken verbatim therefore
came out mirrored front-to-back. A ramp modelled high at +Y imported with its first row 4.75 mm
deep and its last row 0.25 mm deep, the reverse of the CAD view; raised text came out flipped top
to bottom. The canvas preview, the 3D views and the carve all used the same flipped grid, so
nothing on screen showed the mirror until the part was cut.

### Decision

1. `prepareParsedStlImport` negates every vertex's Y once, before the preparation probe, and
   stores that mesh. The canvas, the 3D views and the carve then all match the CAD top view.
2. The flip happens at import, not in the shared rasterizer, so meshes that saved projects already
   store keep the orientation they were saved and cut with. A Float64-backed mesh stays Float64,
   and an exact zero stays +0.

### Consequences

- Newly imported STLs read the right way round. Reliefs in existing projects do not change; one
  imported before this change can be re-imported, or mirrored vertically on the canvas, to match
  its CAD view.
- `stl-import-preparation.test.ts` checks the flipped coordinates, the preserved array type and
  a ramp's orientation (first row high, last row low).
