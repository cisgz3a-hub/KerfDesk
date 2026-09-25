## ADR-125 Amendment 1 - Imports keep their file size unless larger than the bed (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Amends the description of `fitObjectToBed` in ADR-125 Decision 1. Changes nothing in
`fitObjectToRegion`, auto-fit to a placed board or the array tiler.

### Context

Decision 1 describes fit-to-bed as scale-to-fit with a fixed 10% margin, capped at scale 1. Every
fresh import went through it, so anything over 90% of the bed width or height was quietly shrunk
to 90%: a 400 mm design on a 400 x 400 mm bed came in at 360 mm, and nothing said so. LightBurn
imports at the file's own size; centring the import is an optional setting. The LightBurn gap
audit of 2026-09-24 reproduced the shrink.

### Decision

1. A fresh import (SVG, DXF, image, STL mesh relief, library art, text) arrives at its file size,
   centred as before. A design exactly the bed size keeps that size.
2. Only a footprint larger than the bed in either axis, rotation and scale included, is scaled
   down uniformly about its centre into 90% of the bed. The margin keeps oversize art clear of the
   bed edges for raster overscan, kerf, Frame and the multi-import stagger.
3. That scale is its own undo step, so one Undo restores the original size. The SVG, DXF, image
   and STL imports report it with a warning, for example "design.svg is larger than the 400 x
   400 mm bed (1000 x 500 mm), so it was scaled to 36% to fit. Undo restores the original size."
4. A 1e-6 mm tolerance keeps unit-conversion float noise from counting as oversize, in the fit and
   in the canvas out-of-bed outline.
5. Height-map reliefs keep their authored size and are only centred, as before.

### Consequences

- Bed-sized art is no longer shrunk. Its Fill or image overscan can now reach past the bed edge,
  which preflight reports as before; the operator moves or resizes the art.
- A multi-file import adds two undo entries for each oversize file.
