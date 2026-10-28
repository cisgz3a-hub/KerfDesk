# Rolling audit v7 — ledger

Method: [../2026-10-21-rolling-v2/METHOD.md](../2026-10-21-rolling-v2/METHOD.md). Plan: [AREAS.md](AREAS.md).

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| L1 | Booleans, offset, weld | f1d919fbf (src unchanged at 5f3c420f4) | [L1-boolean-offset-weld.md](L1-boolean-offset-weld.md) | 4 | 0 | 1 | 0 | 3 | 1 (10-P3-1 still open) |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| L1-P1-1 | L1 | **Offset Shapes (and the Offset outlines row) drop a shape drawn inside another as its own object.** Every selected object is merged by one NonZero union before the offset, so a separately drawn inner shape is swallowed: a 50 × 30 plate with a separate 10 × 10 hole and a separate circle, Outward 1 mm with Delete original objects on, cuts one 52 × 32 outline (the compiled cut goes from 50 × 30, 10 × 10, 8 × 8 to 52 × 32), with no message. The same artwork as one compound path keeps the hole (52 × 32 plus 8 × 8). Outer shapes only, selection order, Inward and Both all lose it the same way. Delete original objects is off by default but remembered for the session once applied; with it off the originals stay and only the new outline lacks the inner shapes. KerfDesk's own tooltip and WORKFLOW F-A6c say only Outer shapes only ignores inner shapes; LightBurn 1.7 docs and a LightBurn developer post treat a separately selected inner shape as a hole; KerfDesk's kerf offset (ADR-486) does too | **READ** (main): `const region = unionAll(closedBatches);` (`offset-shapes.ts:198`), a `FillRule.NonZero` union of every selected object's batches (`:273-278`); Outer shapes only filters only the rings left after that union (`:200-203`); the panel offset does the same (`vector-path-booleans.ts:109-114`, `vector-path-regions.ts:96-111`); Delete original objects removes every source (`offset-shapes-actions.ts:146,159-175`). Auditor + refuter REPRO (real store action and compiled job) | fix card proposed |
