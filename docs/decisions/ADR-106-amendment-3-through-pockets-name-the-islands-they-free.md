## ADR-106 Amendment 3 - A through pocket names the islands it frees, and offers a holding floor (2026-11-13)

**Status:** Accepted; software-verified through emitted G-code carved into an independent height
field. | **Date:** 2026-11-13

This amends ADR-106 Amendment 2 Decision 3, which put CNC box slots on a pocket operation on the
premise that "a pocket clears the whole slot, so no piece is left for a tab to hold". Only Job
Review advisory text changes. No G-code changes, and nothing blocks Frame, Start or Save (ADR-565,
rule 7).

### Context

CNC audit v3 area N3 (`docs/audits/2026-11-13-cnc-v3/N3-adaptive-and-pocket.md`, N3-P1-1, P1)
showed the premise is false as soon as a pocket region has an island: material it holds as a hole,
such as the centre panel of a frame or the counter of a letter "O".

- Every pocket strategy (offset, raster, adaptive and rest) ends on a wall ring that runs one bit
  radius off every edge of the region, islands included. Cut to the stock bottom, that ring closes
  a loop round each island, so the island is a separate piece. Pockets take no holding tabs
  (ADR-258), so nothing holds it.
- The bit keeps cutting beside the loose piece: an offset plaque ran 541 mm more at full depth after
  its first island came free, and a two-island adaptive pocket 1,837 mm.
- Job Review said nothing. Past the bottom it gave only the spoilboard line. The same loops as an
  Inside profile with tabs off are warned ("the part and any hole slugs come free").
- The Pocket tutorial told the operator "To keep an island, use one compound outline with an inner
  hole", which does not keep it at the stock bottom.

A floor a few hundredths of a millimetre thick still joins the island, but it tears. The relief and
V-carve warnings (ADR-421 Amendment 4, CNC audit v3 N2-P2-3) treat a floor under 0.2 mm as gone;
pockets use the same rule.

### Decision

1. **A pocket operation whose floor is under 0.2 mm above the stock bottom, or below it, names the
   islands its wall ring goes round.** `pocketFreedIslands` (`core/cnc/pocket-freed-islands.ts`)
   reads the region even-odd, as the planner does, and insets it by the bit's wall radius at the
   operation's depth (`cncLayoutCutWidths`). Each hole of that tool-centre region encloses a piece
   that comes free: the islands inside it, with any strip narrower than the bit between them. An
   island the bit cannot get all the way round leaves no hole and is not named. A failed offset
   names every island rather than none.
2. **The line names the pieces by size and offers the holding floor.** "Layer "Pocket" pockets
   through the stock (6.35 mm ≥ 6.35 mm) round a 10 × 10 mm island. Pockets take no holding tabs,
   so it comes free while the bit is still cutting beside it. To keep it, set Cut depth to 5.85 mm
   to leave a 0.5 mm holding floor and cut it free afterwards; otherwise check workholding and keep
   clear of the loose pieces." A thin floor reads "leaves only 0.05 mm of stock under its pocket
   floor, so … is held only by that skin, which can tear". Past the bottom the line also says how
   far into the spoilboard, and replaces the plain spoilboard line for that operation, as the
   through-cut profile line does (`cnc-through-pocket-island-warnings.ts`, called from
   `detectCncThroughCutTabWarnings`).
3. **The holding floor is the remedy offered, not tabs on island loops.** A tab on an island's own
   ring holds nothing: every other ring between the island and the wall cuts through at full depth
   beside it, so a tab would need a bridge across the whole pocket. The 0.5 mm floor is thick
   enough to hold a small island and thin enough to cut free with a knife.
4. **The Pocket tutorial says so:** "Pockets take no holding tabs: cut to the stock bottom, an
   island comes free, so leave a holding floor under it."
5. **Box slots are unchanged.** A generated box slot has no island, so Decision 3 of Amendment 2
   still holds for it and no line is shown.

### Consequences

- A stencil, a cut-through sign or a through frame with a raised centre now gets one named Job
  Review line per pocket operation. An operator who means to drop the counters can ignore it.
- `cnc-through-pocket-island-warnings.test.ts` carves the emitted program into a height field and
  flood-fills the stock left at the bottom: each warned island is disconnected there (offset,
  raster and adaptive), the offered 5.85 mm depth keeps it attached and is silent, and an island
  5 mm from a wall under a 6.35 mm bit stays attached and is silent.
- NOT changed: the order rings run in, so the bit still cuts beside a loose island when the operator
  goes ahead. Cutting each island's own ring last is left for later.
- NOT verified: no hardware or air cut.
