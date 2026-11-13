## ADR-286 Amendment 1 - Pockets and every inlay pair resolve a text object's glyphs non-zero (2026-11-13)

**Status:** Accepted; software-verified through emitted G-code carved into an independent height
field. | **Date:** 2026-11-13

This widens ADR-286 Decision 1 from V-carve (and, since the 2026-10-09 released-CNC-output audit,
the tapered inlay pair) to every cut type that clears a closed region.

### Context

CNC audit v3 area N3 (`docs/audits/2026-11-13-cnc-v3/N3-adaptive-and-pocket.md`, N3r-P2-1, P2):
a pocket on script text left every join between overlapping letters standing at full height.
Pacifico "Hello" at 30 mm left 18.7 mm² in three joins, Great Vibes "Anna" 10.1 mm². The pocket
planner resolves the layer's contour pool even-odd, so the overlap where two glyphs of one text
object meet cancels into an island. V-carve and laser Fill handle the same text non-zero, and the
tapered-inlay twin of this was rated P2 and fixed the same way. Weld overlaps avoided it, but
nothing pointed there.

### Decision

1. `layerPolylinesFromContours` (`core/cnc/collect-cnc-contours.ts`) runs
   `mergeTextObjectContours` for `v-carve`, `pocket` and `inlay-pair` (straight and tapered). Every
   rule of ADR-286 holds unchanged: one text object at a time, even-odd between objects (ADR-270
   Amendment 1), open contours never merged, and a union failure keeps the original contours.
2. Profiles, engraves and drills still read the raw pool. They follow each contour, and profiles on
   overlapping text were left out as ambiguous (rolling audit v7 L1); manual tab positions are also
   mapped to the raw contours.
3. Pockets, adaptive, rest and the minimum-feature check all read this one function, so they agree
   on where the material is.

### Consequences

- A script word pocketed for a paint fill is cleared through its joins. Text whose glyphs do not
  overlap is unchanged in area, though its vertices now pass through clipper's 1 µm grid.
- `EMITTER_REVISION` advances to `cnc-pocket-text-seams-raster-20261113-v46` (with ADR-154
  Amendment 6 and ADR-105 Amendment 1).
- `compile-cnc-pocket-text.test.ts` carves the emitted program: the join between two overlapping
  glyph boxes of one text object is cut to the floor with offset rings, raster rows and a straight
  inlay pair, and is still left for an imported SVG, which may mean even-odd.
- NOT verified: no hardware cut.
