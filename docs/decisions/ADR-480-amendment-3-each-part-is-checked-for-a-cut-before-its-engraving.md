## ADR-480 Amendment 3 - Each part of an engraving is checked for a cut that runs before it, so two coasters are warned like one (2026-11-08)

**Status:** Accepted. Amends ADR-480 Amendment 2 Decision 2 (what counts) and its Consequences.
Fixes rolling audit v10 finding V7-P2-3 (P2,
`docs/audits/2026-11-07-rolling-v10/V7-fix-design-burn-safety.md`). Tested on the compiled job;
not burn-tested. The warning's words, Cut last, Job Review's ranking (ADR-687), Frame, Start,
G-code and licences are unchanged. | **Date:** 2026-11-08

### Context

Amendment 2 asked whether one cut outline holds the whole engraving operation: the box of every
Fill (or Image, or lighter Line) burn on that operation had to sit inside one outline. One
operation burns every part of a job, so the check warned for one coaster and said nothing for the
next ordinary step, making more than one. The v10 auditor and refuter both reproduced it on
`compileJob`: two coasters side by side, two made coaster-name-coaster-name, a 2 × 2 grid, and one
coaster plus a label elsewhere on the same Fill compiled to `cut, fill` (every part cut free, then
every name engraved) and were not warned. Two coasters inside one big outer cut were warned only
because the big outline held the whole Fill. That is U3-P2-4's harm again: a part that drops or
shifts before it is engraved.

### Decision

1. **The check asks about each piece of a burn.** A burn's segments that come within 0.5 mm of
   each other are one piece (`cut-before-engraving-pieces.ts`): a Fill's scan rows join into the
   shape they fill, a name in one coaster and a name in the next are two pieces. An image is one
   piece, its box. A cut holds a piece when every point of the piece, and the middle of every edge,
   is inside the outline or within 0.1 mm of it, and some point is clearly inside. One held piece is
   enough to warn.
2. **The rest of Amendment 2 Decision 2 stands.** Only a closed Line contour is an outline (tabs and
   perforation hold the part); the burn must be another operation; it must be weaker by Sort cuts
   last's measure (power × passes ÷ speed); CNC is not checked. So two equal cuts, or an inner cut
   run before the outer one, are not called a cut before an engraving.
3. **What stays quiet:** an engraving outside every outline; one that touches an outline from
   outside; one that crosses an outline, even where its rows inside are whole (the rows above and
   below join it into one piece the cut does not hold), and even across a round coaster whose
   centre is inside; a score that runs along the cut line itself; an engraving that runs before
   the cut that holds it.
4. **What is warned besides one coaster:** two coasters on one operation, a grid, a coaster plus a
   label elsewhere, nested cuts (each cut operation that holds a piece is named, in burn order),
   an engraving that fills the whole cut-free face, and an engraving inside a cut hole, whose slug
   is cut free first (as #1561's v10 refuter ruled).
5. **Fast on large jobs.** The pieces come from one sweep up the segments by height with
   union-find; a segment leaves the sweep once a joined later one spans it, so a Fill keeps about
   one live row per part. Cut outlines sit in a box index, so a piece meets only the outlines
   around it, and each outline's edges are indexed once for the point tests. A cut operation stops
   being asked once one piece is inside it. On this PC, 400 coasters (80,000 scan rows) take about
   30 ms; compiling that job takes 350–850 ms.

### Consequences

- The concave-outline exception in Amendment 2's Consequences is gone: points, not the box
  centre, are tested, so an engraving in the arm of a C-shaped part is warned and a row that
  leaves a U-shaped part between its arms is not held.
- Two engravings closer than 0.5 mm are judged as one piece, so a mark inside a coaster that
  touches an engraving crossing the coaster's edge is not warned. Close enough to touch is rare
  for separate parts, and the cost is a missed advisory, never a blocked Start.
- An image is still judged by its box centre, because its corners may be blank.
