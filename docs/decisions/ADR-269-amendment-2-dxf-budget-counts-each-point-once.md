## ADR-269 Amendment 2 - The DXF block budget counts each placed point once (2026-10-27)

**Status:** Accepted; software-verified through tests of the real entity collector and `parseDxf`.
| **Date:** 2026-10-27

Narrows [Amendment 1](ADR-269-amendment-1-remote-dxf-worker-and-block-budget.md) item 2's "every
point that placing a block creates counts, at any nesting". Follows rolling audit v5 finding
J3-P3-1 (P3), which an independent refuter confirmed. The coordinator re-verified it in code on main
`09f7c0087`.

### Context

`expandInsert` spent `instanceCount × points` for every INSERT, counting all of its block's
expanded points. Those already included the copies the block's own INSERTs had made and counted.
So each wrapper level counted the whole drawing again. 1,000 copies of a 100-point part in a SHEET
block, placed once, imported through two one-INSERT wrapper blocks and was refused through three,
"more than 500,000 points" for a 100,000-point drawing. Amendment 1 said a drawing "whose geometry
sits in a block placed once stays within it", and its message names points the file expands to.

### Decision

1. **Each placed point counts once.** An INSERT counts the points it places minus those its block's
   expansion already counted. A wrapper placed once adds only the entity it reads; a grid of N
   copies adds N − 1 copies of its block's points. The budget then equals the points the drawing
   places through blocks, plus one per entity read inside a placed block, as before.
2. **Still counted before the copies are made.** The block is expanded and counted first, and the
   placement's new points are counted before it allocates them, so a refused placement allocates
   nothing. The floor (500,000), the per-byte ratio and the message are unchanged.

### Consequences

- The same drawing costs the same whether or not its CAD export wraps it in blocks.
- Each wrapper level still copies the geometry it places. Measured under Node on 2026-10-27 on a
  heavily loaded PC, `parseDxf` took 6.4 to 6.5 s for Amendment 1's near-floor case of 249,000
  two-point lines in nested grids, and 6.6 to 6.9 s for the same lines through five wrapper blocks,
  which Amendment 1 refused. 490,000 points as 4,900 copies of a 100-point part took 0.33 s flat and
  0.74 s through six wrappers. The depth cap (8) bounds the levels.
