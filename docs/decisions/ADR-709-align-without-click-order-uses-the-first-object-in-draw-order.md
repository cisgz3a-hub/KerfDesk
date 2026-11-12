## ADR-709 - Align without a click order uses the first object in draw order (2026-11-11)

**Status:** Accepted. Fixes the desktop half of rolling audit v7 finding L4-P3-2
(`docs/audits/2026-10-28-rolling-v7/L4-transform-arrange.md`). Keeps ADR-499 and its Amendment 2
(the align and Move Together keys) and ADR-678 (typed group rotation). It changes no G-code, Start
guard, Frame gate or controller command: it only changes which object stays still. |
**Date:** 2026-11-11

### Context

Align, Make Same Width / Height and Move H / V Together keep one object still, the reference, and
move the rest of the selection to it. The desktop picks the reference in
`referencedSelection` (`src/ui/state/selection-transform-actions.ts`):

- The object last clicked into the selection (a plain click, or a Shift+click that adds it) is the
  reference. `src/ui/state/selection-reference.ts` records it. This matches LightBurn and stays.
- A selection made at once has no click order: a marquee, Select All, or a selection whose clicked
  object was removed by Shift+click or deleted. It fell back to `ids[ids.length - 1]`, the last id
  in the selection list, which its comment called "the top-most in the stack".

LightBurn 1.7's Align reference
(https://docs.lightburnsoftware.com/1.7/Reference/Align/, read 2026-10-28 for the audit) says
objects are aligned by default to the last object added to the selection. When several are added
at once, they align to the first object in the selection's draw order. The audit's scenario drew A
at x 0, B at x 50 and C at x 100, marqueed them, and chose Align Left. KerfDesk moved A and B to x
100; LightBurn moves B and C to x 0.

The maintainer's standing preference is to copy what LightBurn does.

### Decision

A selection with no valid click record takes as its reference the first selected object in
`project.scene.objects`. That is the bottom of the stack and the first object the job draws.

- The candidate is chosen among the objects the edit can move: locked artwork and artwork on a
  hidden layer are already left out of the selection the actions work on, so they cannot be the
  reference. The old fallback could name a locked id, and the edit then did nothing.
- A group counts as one unit, as before: the edit builders move the reference's whole group with it.
- The same rule serves Align, Make Same Width / Height (and the proportional forms) and Move H / V
  Together, because they share `referencedSelection`.
- The click rule is unchanged: a valid record still wins over draw order.

### Not changed

- **Remote (`arrange_artwork`, `src/ui/remote-control/arrange.ts`).** It keeps the last listed id as
  its reference. The caller names the ids in the order it chooses, so the list is a deliberate
  order, like a click order. PR #1504 documented this in the tool text (`electron/mcp/tool-info.ts`).
- **Design Studio (`src/core/design/ops/arrange-entities.ts`).** It aligns to the selection's bounds
  and keeps the outside edge, so no single object is the reference. That is a different model from
  the canvas Align, and it is left as it is. The audit records it under L4-P3-2; a later change can
  take it up if Design Studio should follow LightBurn too.

### Consequences

- A marquee or Select All followed by Align Left now keeps the bottom-most selected object still,
  as LightBurn does. Users who relied on the old top-most fallback see a different object stay
  put. Clicking the object to keep last still picks it, as before.
- Tests that pinned the old fallback now pin draw order:
  `src/ui/state/selection-reference.test.ts` (marquee, a reference removed by Shift+click, a
  deleted reference, and a new case where the marquee lists the ids against the stacking order),
  `src/ui/state/selection-transform-actions.test.ts` and `src/ui/state/layout-actions.test.ts`
  (Match Size and Move Together).
- WORKFLOW.md F-A6h states the reference rule.
