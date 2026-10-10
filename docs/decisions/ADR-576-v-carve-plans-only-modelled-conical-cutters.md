## ADR-576 - V-carve plans only modelled conical cutters

**Date:** 2026-10-10

**Status:** Accepted. Supersedes the wrong-kind 60-degree V-carve fallback recorded in ADR-368
item (V-carve compatibility) and WORKFLOW's V-carve tool error. Frame, Start and output policy
are unchanged.

**Context.** A V-carve layer whose bit was an end mill, ball nose, tapered ball nose, or an
engraving bit without a valid tip angle was planned as a 60-degree pointed cone. A tool that
carried any stray `tipAngleDeg` used that value as its cone instead. The layer panel and Job
Review warned, but the compiled program still drove a flat or round cutter down a cone's depth
law. A flat end mill following those depths cuts full-width trenches far wider than the artwork,
because it has no conical flank: the V-carve depth law `(r - r_tip) / tan(theta/2)` is undefined
for it. The same fallback also drove the two-stage flat-floor clearing stage.

Current CAM practice does not invent a cone. Vectric's V-Carve toolpath selects a V-bit or
engraving tool and models a ball nose by its own shape. Carbide Create states that without a
V-bit nothing appears in the simulation or toolpath visualizer.

**Decision.** Every executable V-carve stage takes its included angle from
`vcarvePlanningAngleDeg`, which resolves only for a cutter that `isVCarveToolCompatible` accepts:
a V-bit, or an angled engraving bit with a valid tip angle and, where present, a valid tip
diameter. For any other cutter the medial planner, its flat-floor clearing stage and the effective
depth law resolve nothing, so that layer contributes no V-carve motion. This is the same outcome
an actual V-bit with invalid angle geometry already had. Simulation, design-surface and relief
contact kernels keep the 60-degree drawing fallback; they never emit motion.

The existing `cnc-settings-invalid` warning now says the layer produces no V-carve toolpath, and
the layer panel says the same beside the bit choice. The generic "shapes produced no toolpaths"
notice no longer duplicates it for these layers. Nothing here becomes a refusal: other layers
still compile, Save and Start proceed with the warning, and the Frame-first Start contract
(PROJECT.md non-negotiable 21, ADR-565) is unchanged.

**Consequences.** A saved project that relied on the fallback produces no output for that layer
until a compatible bit is selected; Job Review names the layer and bit. The emitter revision
advances because compiled output changes for these selections.

**Verification.** Unit tests cover end-mill, ball-nose and tapered-ball-nose depth resolution,
an angleless engraving bit, the clearing stage and the retained ladder reference. Preflight and
panel tests use a real V-bit where they test V-carve behaviour. No hardware was operated.

**Build and empty-geometry qualification.** The retired ladder remains test support only;
the browser-Free build manifest lists the production medial and region-worker entries and
no longer reads the removed ladder module. Direct browser/desktop bundle regressions cover
those boundaries. Angle validation uses the same even-odd normalization as the medial
planner: hairline filled regions still require a real angle, while cancelled or zero-area
contours cannot make an unused angleless V-bit refuse other executable layers.
