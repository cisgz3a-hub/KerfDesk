## ADR-572 Amendment 3 - A relief projection steps down by Depth per pass and takes tabs (2026-11-09)

**Status:** Accepted; software-verified through compile, Job Review and warning tests, hardware
qualification pending. | **Date:** 2026-11-09
**Fixes:** rolling audit v11 finding W6-P2-1 (raised to P1 by the refuter, after CNC v1 F3-P1-1).

Amends ADR-572's relief projection (`reliefProjection`, the vector operation that follows a named
relief at a Vertical depth). The Frame-first Start contract (ADR-228, PROJECT.md
non-negotiable 21) is unchanged: nothing here adds a guard or turns a warning into a block.

### Context

- A projection cut its whole Vertical depth in one pass (`relief-projection-plan.ts`). The layer
  card still showed Cut depth, Depth per pass and Tabs, and the projection ignored all three.
- In the refuter's repro, a closed 16 × 16 mm square projected 2 mm under a 5 mm relief floor
  was cut at Z−7 through 6.35 mm stock in one pass with Tabs on and no tab cut, so the part came
  free. Job Review said "tabs 4 per shape", or on 6 mm stock "skipped: the 5 mm floor holds the
  part", and counted passes from the ignored Cut depth.
- The stock-bottom advisory read the ignored Cut depth: a 3 mm projection 1 mm into the
  spoilboard went unreported, and a stale Cut depth of 8 mm reported a spoilboard cut that stayed
  in the stock.
- Vectric drops a projected toolpath onto the model and uses "the depth of the original toolpath
  below the surface of the material … as the projected depth below the surface of the model"; its
  profiles keep their tool's pass depth and tabs. Easel and the 2D profiles here (ADR-258) cut tabs
  only where a cut can free the part.

### Decision

1. **Step-down.** A projection cuts its Vertical depth in levels from `zPassDepths(Vertical depth,
   Depth per pass)`, shallow to deep, each vector all its levels before the next. The deepest level
   is the checked path as before. Each shallower level is that path raised by the depth it does not
   yet take. The checked path clears the cutter contact offset by the full depth, so raised it
   clears the contact offset by the level's depth, and raising never meets excluded stock. A Depth
   per pass at or above the Vertical depth gives one pass, the output before this amendment.
2. **Tabs.** On a profile cut type with Tabs on, a closed projected loop whose deepest tip can free
   the part (`cutCanFreePart`, ADR-258 Amendment 1) is raised to the tab top inside evenly spaced
   windows on every level: a 3D tab. The window is the tab width plus one bit diameter, as the 2D
   splitter sizes it. The tab top follows ADR-258 Amendments 3 and 4: one tab height above the stock
   bottom on a set stock thickness (half the stock when the tab is no thinner), and one tab height
   above the loop's deepest tip on the shipped default. Each window edge is a vertical pair at one
   XY, the wall `compiled-tab-rises.ts` recognises. Manual tab positions do not apply to projected
   loops; they take the automatic count.
3. **Evidence.** The projection's planning evidence records the levels cut, the deepest tip, and
   how many closed loops there were, how many rose into a tab, and how many were cut through the
   stock bottom all the way round (freed).
4. **Job Review line.** A projected operation's detail reads that evidence: "projected 2 mm under
   the relief surface in 2 passes of up to 1 mm, deepest 7 mm", then the tabs really cut, "no
   holding tab on N closed shapes cut free", or "tabs skipped: the N mm floor under the deepest
   projected cut holds the part". It no longer counts passes from Cut depth.
5. **Stock-bottom advisory.** A projected layer is judged on its compiled depth, not Cut depth:
   freed closed shapes give the loud through-cut note, a deepest tip past the stock gives the
   spoilboard note, and tabs dropped by the floor give the "skips its holding tabs" note on a set
   stock thickness. All stay advisory (rule 7).
6. **Layer card.** A projected layer hides Cut depth and "Set to stock thickness", which do
   nothing there, and says the cut goes Vertical depth under the relief surface, stepping down by
   Depth per pass. Depth per pass and Tabs stay, because they now apply.
7. **Budget.** Levels times projected points is bounded at 4,000,000 emitted vertices; past it the
   projection refuses with a named reason and asks for a larger Depth per pass.

### Consequences

- Projected groups now carry `depthPerPassMm` provenance, so the G-code header names the pass depth.
- A loop whose tab top would sit above its own surface still gets the window; the cutter rides in
  air there, which costs only Z travel.
- Not verified on hardware. A projected loop that crosses a slope, so that only part of it goes
  through, takes tabs at its evenly spaced windows wherever they fall; it is reported freed only
  when the whole loop goes through.
