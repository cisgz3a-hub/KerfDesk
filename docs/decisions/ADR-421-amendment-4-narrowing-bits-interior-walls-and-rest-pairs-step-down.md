## ADR-421 Amendment 4 - Narrowing bits, interior walls and rest pairs step down too, and a thin floor warns (2026-11-13)

**Status:** Accepted; software-verified through compile, warning and analytic G-code stock
simulation tests, hardware qualification pending. | **Date:** 2026-11-13
**Fixes:** CNC audit v3 findings N2-P2-1, N2-P2-2, N2r-P2-1, N2-P2-3 (P2) and N2-P3-1 (P3), and
CNC audit v2 J1-P2-1 (P2), whose fix shares N2-P2-3's lines.

Amends ADR-421 Amendments 2 and 3. The Frame-first Start contract (ADR-228, PROJECT.md
non-negotiable 21) is unchanged: nothing here adds a guard or turns a warning into a block.

### Context

Amendment 3 judged whether the next bit rides in the strip roughing leaves beside a wall from the
bit's nominal radius. Four routes still took that strip in one pass:

- **N2-P2-1, narrowing bits.** A tapered ball, V-bit or engraver is stored by its widest cut. A
  tapered ball with a 1 mm tip on a 1/8" body counted as 1.59 mm, "large". Its tip then rode the
  edge band at Z−2.3 for 22–24 mm, with 2.3–2.8 mm under it (a 0.5 mm tip took 3.39 mm, the
  engraver 4.3 mm). Where levels were planned, the note named "the 3.175 mm finishing bit".
- **N2r-P2-1, interior walls.** Under a small bit, the strip beside a wall became missed, but the
  opening eroded it away. Only the map edge was kept. A 1 mm ball ran 9.97 mm beside a raised bar
  at Z−3 with 3.0 mm under its centre, while the note said it stepped down.
- **N2-P2-2, rest pairs.** The rest sweep ran on a grid of the finishing ball / 8 with no allowance.
  So the strip was one cell, 0.79375 mm for a 1/4" ball, exactly the 1/16" rest ball's radius. The
  strict "smaller than" made the rest ball "large", and it ran 8.7 mm at Z−4 with 3.76 mm under its
  centre. A 1/8" rest ball took 3.06 mm, because one cell of slack on that grid also hid the 1.9 mm
  band the 1/4" ball left.
- **N2-P2-3 and J1-P2-1, floors.** The stock-bottom advisory fired only on an exact match at
  output precision, and only for relief. A relief 6.30 deep in 6.35 mm stock left a 0.05 mm skin
  with no note. A flowing V-carve at the stock bottom, which the default 1/2" 90° bit reaches in
  default stock, said nothing at all.
- **N2-P3-1.** The rest scallop defaulted to 0.05 mm, twice the finish's 0.025 mm.

### Decision

1. **A narrowing next bit is judged by its width at one pass.** For a tapered ball, V-bit or
   engraver, the radius used for the strip and for the opening is the bit's radius one Depth per
   pass above its tip (`relief-next-tool-radius.ts`), as ADR-368 Amendment 3 lays such bits out by
   their width at depth. Balls and end mills keep their nominal radius. The reach note names such a
   bit by kind and tip ("the 1 mm-tip tapered ball finishing bit").
2. **A wall's strip survives the opening under a small bit.** When the next bit is small, a cell
   whose envelope stands more than the threshold above its own target lies in a wall's shadow. That
   covers a wall, and the relief's edge, which stands at the stock top. Such a cell no longer erodes
   the missed strip beside it. When half the small bit is under one grid cell (a 1 mm ball on a
   1/8" roughing grid), the opening is skipped: no region on the grid is narrower than that, and a
   one-cell disk would erase the one-cell strip the bit rides in. This replaces Amendment 3's
   edge-only rule; with a bit as large as the strip, nothing changes.
3. **A rest bit narrower than the finishing bit is small.** The band beside a wall in the rest stage
   is the finishing ball's own fillet, not an allowance strip. So the rest sweep treats any rest bit
   narrower than the finishing bit (both at one rest Depth per pass) as small. It runs on a grid an
   eighth of the narrower of the two bits, so one cell of slack no longer hides a band the rest bit
   would slot.
4. **A floor thinner than 0.2 mm warns like the stock bottom.** The compiled-depth advisory warns
   when a relief or a V-carve leaves less than 0.2 mm under its floor (compared in 0.001 mm), as
   well as at the stock bottom: "leaves only 0.05 mm of stock under its floor … paths have no
   holding tabs". V-carve gets the stock-bottom rule relief already had (J1-P2-1). 0.2 mm is where
   the X6 refuter put "effectively free"; ADR-572 Amendment 4 counts 0.1 mm as cut free.
5. **The rest scallop defaults to the finish's** (`reliefScallopMm`, else 0.025 mm), in compile and
   on the layer card. The rest stage refines the finish, so it is never coarser by default.

### Consequences

- In the N2 regression tests, simulated from the emitted G-code, no lateral move of these bits has
  more than one 1.5 mm pass (plus 0.1 mm of grid slack) under its centre. The cases are the 1 mm-tip
  tapered ball and the 30° engraver along an edge band, a 1 mm ball beside a raised bar, and 1/16"
  and 1/8" rest balls after a 1/4" ball.
- More reliefs get step-down levels with narrowing and small bits, which costs time, not material.
- A V-carve that reaches, or nearly reaches, the stock bottom now carries a workholding note.
- Not verified on hardware.
