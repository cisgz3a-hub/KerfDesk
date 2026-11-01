## ADR-306 Amendment 5 - A bit change inside apply_edits names its kept values, and the PC shows them (2026-10-27)

**Status:** Accepted; software-verified through tests that drive the real remote adapter and the
MCP output schemas. Hardware qualification pending. | **Date:** 2026-10-27

Completes [Amendment 4](ADR-306-amendment-4-remote-bit-change-follows-the-card.md) item 3 for
`apply_edits`, which Amendment 4 names ("alone or inside `apply_edits`"). Follows rolling audit v5
finding J3-P2-2 (P2), which an independent refuter confirmed. The coordinator re-verified it in code
on main `09f7c0087`. Adds no Frame or Start gate (ADR-306 decision 9).

### Context

A Manual operation hand-set for a 1/4" end mill (2400 / 960 / 12,000 RPM / 2.5 mm) keeps those
values when a remote edit changes it to a 1/16" bit, as Amendment 4 item 1 decides. A single
`update_operation` named them in its receipt's `message`. Inside `apply_edits` the item result kept
only `changedArtworkIds` and `operationId`, and the `results` item schema had no `message`, so the
batch receipt said nothing. In neither route did the PC show anything: the Artwork card's note is
local state, set only for a bit chosen on the card.

### Decision

1. **Each batch item carries its message.** An `apply_edits` result item keeps the `message` its
   edit returned: a bit change's kept values, or a recipe that changed nothing. The `apply_edits`
   `results` item schema accepts it (at most 2,048 characters), and the tool description asks the
   agent to pass it on.
2. **The PC shows the kept values.** When a remote bit change keeps a Manual operation's values,
   alone or inside `apply_edits`, the PC shows the same line as a warning toast once the change has
   committed, as Machine Setup's Save warns about the same values (CNC audit v1 F4-P2-1). A batch
   that rolls back shows nothing.

### Consequences

- An agent changing a bit inside a batch is told, item by item, which values did not follow the bit,
  and an operator at the PC sees it too.
- The relay Worker re-parses results with its bundled schemas, so relayed batch receipts carry the
  item `message` only after a Worker redeploy (ADR-125 Amendment 3).
