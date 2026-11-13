## ADR-154 Amendment 6 - Island adaptive runs a cleanup pass along each cell seam (2026-11-13)

**Status:** Accepted; software-verified through emitted G-code replayed with an undersize cutter.
| **Date:** 2026-11-13

This amends ADR-154 Amendment 4, which partitions an adaptive pocket with islands into cells at the
islands' bounds. The 50 % radial-engagement cap (Amendment 3, AC-6) is not changed.

### Context

CNC audit v3 area N3 (`docs/audits/2026-11-13-cnc-v3/N3-adaptive-and-pocket.md`, N3-P3-1, P3):
cells met with zero overlap. Each cell is planned on its own, and its finishing ring stops exactly
one bit radius short of the cut line it shares with the next cell, so the seam is cleared only by a
bit exactly its nominal size. Replayed with a 6.30 mm cutter on 6.35 mm programs, a 50 × 50 pocket
with one island left 2.94 mm² of 0.05 mm full-depth foils on its seams; a bit only 0.01 mm
undersize already left one. Offset rings overlap by (1 − stepover) of the bit and left nothing.

Growing each cell 0.1 mm across its cut lines was tried first. Beside an island the grown cell took
a 0.1 mm notch from the island's edge, which split the cell's clearing levels into two leaves; one
entry could no longer open the cell and the verifier refused the plan for the engagement cap
(`compile-cnc-adaptive-islands.test.ts`, the crossing-bounds pocket).

### Decision

1. Cells stay exact. `adaptiveIslandSequences` adds one straight pass along each inner cut line,
   wherever the bit centre can sit on it: the line clipped to the region inset by the bit radius
   (`seamPasses`, `adaptive-pocket-islands.ts`). Stretches under 0.01 mm are dropped.
2. The passes join the wall cleanup rings, so they run with the last sequence of their source
   region, after all the clearing beside them (Amendment 4), and meet only what a seam left. They
   are open paths; cut-direction enforcement leaves them as they are.

### Consequences

- An island-adaptive program gains one short pass per seam stretch per depth.
- `compile-cnc-pocket-seams-raster.test.ts` replays a 30 × 30 pocket with a 10 mm island, cut with
  a 4 mm bit, using a 3.96 mm cutter: nothing stands on any seam. Every existing island-adaptive
  test, the verifier's coverage and the containment check pass unchanged.
- `EMITTER_REVISION` advances (with ADR-286 Amendment 1).
- NOT verified: no hardware cut.
