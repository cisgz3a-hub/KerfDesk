## ADR-105 Amendment 1 - Raster pocket rows are never further apart than the cut (2026-11-13)

**Status:** Accepted; software-verified through emitted G-code carved into an independent height
field. | **Date:** 2026-11-13

This amends ADR-105 G10, the raster X / Y pocket fill.

### Context

CNC audit v3 area N3 (`docs/audits/2026-11-13-cnc-v3/N3-adaptive-and-pocket.md`, N3-P3-2, P3):
raster pockets above 100 % stepover left a full-depth strip between each pair of rows. A 36 × 28
pocket with a 1/4" bit left 14.6 mm² at 105 %, 97.2 mm² at 150 % and 162 mm² at 200 %. Offset
rings at the same stepover add core rings and leave nothing, and legacy rest assumed the strips were
cut. The only notice was the generic "outside the 10-85 % recommended range", which said the value
is used as stored.

### Decision

1. `pocketRasterToolpaths` spaces rows at the stored stepover, but never further apart than 100 % of
   the clearing width (`MAX_RASTER_STEPOVER_PERCENT`). The stored value is not rewritten.
2. Above 100 % on a raster pocket, the stepover advisory says the rows are spaced 100 % apart
   because wider rows would leave strips standing, instead of saying the value is used unclamped.
3. Offset rings are unchanged: they already find their cores.

### Consequences

- A raster pocket set above 100 % now takes more rows and longer than before, and clears its floor.
- Legacy rest after such a rough now meets the floor it assumes.
- `compile-cnc-pocket-seams-raster.test.ts` carves 105, 150 and 200 % raster programs: under
  0.5 mm² of reachable stock is left in each.
- `EMITTER_REVISION` advances (with ADR-286 Amendment 1).
