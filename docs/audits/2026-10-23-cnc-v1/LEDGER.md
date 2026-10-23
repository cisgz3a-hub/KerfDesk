# CNC audit v1 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| F2 | Pocket and adaptive clearing | b9202d5aa | [F2-cnc-pocket-adaptive.md](F2-cnc-pocket-adaptive.md) | 5 | 0 | 0 (P1-1 lowered) | 3 | 2 | 3 |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| F2-P1-1 (P2) | pocket-adaptive | Island adaptive splits the pocket into a grid along each island's bounding lines; where two lines cross inside the pocket a pin of stock stays to full depth (refuter: 8 pins of 8.52 mm², about 2.6 mm across, 3 mm tall in a 100 × 60 two-island pocket with a 1/4" bit), the final cleanup follows only walls and islands, and the 98.5 % coverage verifier passes it with no warning. Lowered from P1 for reach: adaptive is a Pro opt-in, off by default, and the default 1/8" bit fell back to offset rings in 6/6 designs; the 1/4" bit produced pins in 2/2 island-adaptive compiles | **READ**: `adaptive-pocket-islands.ts:33-40` builds `xs`/`ys` island cuts and plans one cell per grid square. No ADR accepts reachable stock left standing. Auditor + refuter REPRO with independent G-code parser and exact cutter height field | open |
| F2-P2-1 | pocket-adaptive | The whole-region wall cleanup is planned after the last cell, but the emitter re-sorts sequences by source region, so a pocket nested inside an island (or a second pocket on the layer) gets its wall ring cut before it is cleared: a straight plunge then a full-width slot at F1000 at every depth (refuter: 51.9 mm per level at up to 173°; a second pocket at 180°); the verifier and `adaptive-pocket-islands.test.ts` check the planned order, not the emitted one | **READ**: `adaptive-pocket-operation.ts:74-81` re-sorts `plan.sequences` by `vcarveSourceRegionRankFromLayout`. Auditor + refuter REPRO in the emitted program (plunge at line 16917, helix at 18163) | open |
| F2-P2-2 | pocket-adaptive | The rest-pocket ladder has no core ring, unlike ordinary pockets (July item 1.10 fixed only `pocket-paths.ts`), so above 50 % stepover a fin stays at full depth with no warning (8 mm arm, 9.525 mm rougher then 1/8" at 85 %: 58.9 mm² legacy, 60.8 mm² stock-aware) | **READ**: `coreRing` exists only in `pocket-paths.ts:91,135`; `rest-pocket.ts` `centerRegionRings` has none. Auditor + refuter REPRO | open |
