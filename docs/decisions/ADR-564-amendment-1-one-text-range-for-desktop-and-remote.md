## ADR-564 Amendment 1 - Desktop and remote text share one size, line height and spacing range (2026-10-28)

**Status:** Accepted; software-verified through tests of the text dialog, the remote validators and
the MCP schemas. | **Date:** 2026-10-28

Follows rolling audit v7 finding L3-P2-3 (P2), which an independent refuter and the coordinator
confirmed in main's code. Changes nothing in Frame, Start or output policy.

### Context

Remote and MCP text accepted a size up to 1000 mm (any positive value), a line height of 0.1–20
and letter spacing of −1–20, and a test pins that the remote never clamps to the desktop's limits.
The desktop text dialog, canvas editor and jig editor clamped to 1–300 mm, 0.5–5 and −0.5–2, both
when they opened a text and when they built it. Fixing one word of a remote-made 500 mm sign on the
PC silently made it 300 mm with line height 5 and spacing 2; 0.5 mm micro-text doubled to 1 mm.

### Decision

1. **One range** (`src/core/text/text-limits.ts`): size 0.1–1000 mm, line height 0.1–20 × size,
   letter spacing −1–20 × size.
2. **Every entry point uses it.** The text dialog and canvas editor clamp to it and show it as the
   fields' limits (the Size field steps by 0.1 mm). The jig editor accepts the same sizes. The
   remote validators refuse values outside it, and the MCP input schemas of `add_text`,
   `update_text` and `apply_edits` match it (`MCP_TEXT_LIMITS`, checked against the core range by
   a test).
3. **The remote range is kept**, except that the smallest size becomes 0.1 mm instead of any
   positive value: below a laser spot, and the size the phone already offered. `get_text` still
   reads back older, smaller text.

### Consequences

- A value one entry point accepts is never changed by an unrelated edit in another.
- The desktop now accepts text up to 1000 mm and micro-text down to 0.1 mm.
- The relay Worker validates with the MCP schemas bundled into it, so until it is redeployed it
  passes a size below 0.1 mm to the desktop, which refuses it with `invalid_arguments`.
