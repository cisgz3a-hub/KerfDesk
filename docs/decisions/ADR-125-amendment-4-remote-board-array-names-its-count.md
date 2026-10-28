## ADR-125 Amendment 4 - A remote board array names how many copies it placed (2026-10-28)

**Status:** Accepted; software-verified through tests that drive the real remote adapter against
the store's Array on board action. Not tested against a live MCP client. | **Date:** 2026-10-28

Extends the 2026-07-08 amendment of ADR-125 (the 100-per-axis and 500-copy cap) and
[Amendment 2](ADR-125-amendment-2-remote-imports-report-the-bed-fit.md) (remote receipts carry the
PC's notices) to the MCP tool `place_on_board`. Follows rolling audit v7 finding L4-P2-2
(`docs/audits/2026-10-28-rolling-v7/L4-transform-arrange.md`), which an independent refuter
confirmed at P2. Changes nothing in Frame, Start, output or the copies that are made.

### Context

The desktop Array on board form says how many copies the layout makes before it is applied: "20
fit; 25 requested." for rows × cols that do not fit, and "Layout capped at 100 per axis and 500
copies." when the cap applies. The remote `place_on_board` array ran the same store action
(`tileSelectionIntoBoard`) but always answered `{status: 'placed', action: 'array',
artworkCount: 1}`:

- a 5 × 5 grid of a 30 × 20 mm design on a 200 × 100 mm board placed 20 copies;
- "fit as many as fit" of a 1 × 1 mm design placed 484 copies, where 20,000 fit, because of the
  cap.

The PC showed no toast either, so an agent could tell its user 25 copies were made. The phone app
has no place-on-board control, so MCP agents are the only remote callers.

### Decision

1. **One plan for the store action and the receipt.** `selectionBoardArrayPlan` resolves the
   placed board and the one design, and returns the `planBoardArray` result that Array on board
   applies. The remote reads it just before the store action runs, so its counts are those of
   the layout made.
2. **The array receipt names the counts.** An array receipt gains `placedCount`, the number of
   slots including the original, and for rows × cols `requestedCount`, rows times cols.
3. **A shortfall is a notice, on the PC and in the receipt.** When fewer copies were placed than
   requested, or the cap applied, the receipt gains `notices` with one warning, in the
   `{level, message}` form of Amendment 2, and the PC shows the same text as a warning toast:
   - "Array on board placed 20 of the 25 requested copies: no more fit on the board."
   - "Array on board placed 484 copies: the layout is capped at 100 per axis and 500 copies."
4. **Nothing is refused for it.** The copies that fit are placed, as on the desktop, where the form
   shows the shortfall and the operator still presses Array on board. The missing copies would not
   fit the board. Center and fit receipts are unchanged.
5. **The MCP output schema and the tool description say so.** The description asks the agent to
   tell the user about the notice.

### Consequences

- An agent can report the number of copies actually made, and the PC operator sees the same
  shortfall the desktop form would have shown.
- Older desktops omit the new fields. They are optional in the MCP output schema, so a client
  should treat a missing `placedCount` as unknown, not as zero.
