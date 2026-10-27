## ADR-306 Amendment 4 - A remote bit change takes the Artwork card's path (2026-10-27)

**Status:** Accepted; software-verified through tests that drive the real remote adapter against
the card's transform. Hardware qualification pending. | **Date:** 2026-10-27

Extends [Amendment 3](ADR-306-amendment-3-artwork-bit-change-names-kept-values.md) items 2 and 3
to Remote Control's `update_operation` (ADR-584), alone or inside `apply_edits`. Follows rolling
audit v4 finding H8-P2-1 (P2), which an independent refuter confirmed. The coordinator re-verified
it in code on main `a59f74ff9`. Adds no Frame or Start gate (ADR-306 decision 9).

### Context

Amendment 3 item 1 makes a hand edit of feed, plunge, spindle speed or depth per pass Manual "on the
Artwork card, or through Remote Control". It lists those four values, not the bit. Item 2 says "A
material-recipe operation is recalculated for the new bit", and ADR-233 decision 5 says the same.
Remote Control applied a `toolId` through `withManualCncFeedPatch`, the hand-edit path, so a bit
change was treated as a hand edit:

- Hardwood with a 1/4" end mill (2400 / 960 / 2.5) changed to a 1/16" bit kept 2400 / 960 / 2.5 and
  became Manual. The card recalculates it to 960 / 380 / 0.6.
- Nothing named the kept values.
- A mistyped bit id was stored and projected back. Compile fell back to the job default bit, so
  profile offsets were cut for a bit other than the one the client named.

A pinned test asserted the hand-edit behaviour.

### Decision

1. **One transform for the card and the remote.** `cncSettingsAfterOperationChoice`
   (`src/ui/state/cnc-operation-choice.ts`) applies a bit or material choice to one operation
   through `sceneWithCncStartupOperationDrafts`, the Machine Setup tool plan. The Artwork card and
   Remote Control both call it. A material-recipe operation is recalculated for the new bit and
   keeps its material. A Manual operation keeps its values.
2. **Hand edits in the same patch come after the bit.** A remote patch that sets `toolId` and also
   feed, plunge, spindle speed or depth per pass applies the bit first, then those values as hand
   edits (item 1 of Amendment 3), as an operator choosing a bit and then typing would.
3. **The receipt names kept values.** When the bit change keeps all four values of a Manual
   operation for a different cutter, the receipt's `message` is the card note's first line, in
   millimetres. For example: "Bit changed. Kept from the previous bit: feed 2400 mm/min, plunge
   960 mm/min, spindle 12,000 RPM, depth per pass 2.5 mm. Check them for … before cutting."
4. **A bit must be in Machine Setup's library.** A `toolId` that names no bit in the open project's
   CNC machine is refused with `invalid_arguments`, and nothing changes. The card can only offer
   bits from that library.

### Consequences

- An MCP client that changes a bit gets the numbers the PC card would give, and is told when the
  numbers did not follow the bit.
- The pinned test now covers the four hand-edit values only. Bit changes have their own tests,
  single and in a batch, against the card's transform.
