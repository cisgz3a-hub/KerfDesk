## ADR-410 Amendment 5 - The nested selection's work grows with its rings, not their square (2026-11-05)

**Status:** Accepted. | **Date:** 2026-11-05

### Context

Amendment 3 reads a selection the way a compound path is read: a shape drawn inside another is a
hole. It finds each ring's depth, then paints the depths from the outside in, one clipper union or
difference per level. Its Consequences priced the containment check on plates and frames. Two
costs it did not price grow faster than the selection:

- **The depth search** (perf audit S1, S6-P3-1, `docs/audits/2026-11-02-performance-s1/S6-geometry-commands.md`)
  asked every larger ring of another object whether it encloses this ring, two clipper
  differences each, and kept the deepest. On concentric rings every pair was asked. Outer shapes
  only, whose output has not changed since 1.0.23, paid it in full: 100 rings 215–443 ms against
  26–67 ms in 1.0.23, 300 rings 1.5–2.9 s against 0.18–0.35 s, identical results.
- **The painting** (N3-P3-1, rolling v8) ran each level against the whole region painted so far.
  Clipper's sweep keeps every ring that spans a scan line in its active list, so each level of a
  target paid for all the rings around it: 100 rings about 1.5 s, 300 rings about 31 s (Node), in
  the worker behind "Updating preview…".

AREAS' rule binds the fix: a speed fix may not change the result.

### Decision

1. **Depths, deepest encloser first.** A ring's depth is the deepest enclosing ring's depth plus
   one, which is a maximum, so the larger rings are tried by depth from the deepest down and the
   first that encloses settles it. The depths are the same numbers as before; on nested rings each
   ring is tested against the ring around it instead of all of them
   (`vector-path-nesting.ts`, `ringDepths`).
2. **Painting only what a level can change, when nothing can touch.** When every ring of the
   selection is simple and keeps 4 µm (four grid steps) clear of every edge but its two
   neighbours, checked once on a grid about one edge long, no union or difference can cross,
   touch or re-split a ring; each only decides which whole rings remain. A level is then painted
   against only the rings it could change (`vector-path-nesting-paint.ts`):
   - rings whose box misses the level's box are set aside;
   - rings around the level are set aside in cancelling pairs (an outline and the hole inside it),
     which leaves the innermost outline when the level sits in filled area and nothing when it
     sits in a hole;
   - a ring that could lie inside the level, a ring that winds differently around two of the
     level's units, or units whose boxes meet, send that level to the whole region as before;
   - the last level always takes the whole region, so the result is clipper's own output over the
     same rings.

   A selection whose rings come closer than 4 µm anywhere is painted level by level against the
   whole region, exactly as before.

### Alternatives rejected

- **Set rings aside whenever the level comes near none of them.** Rejected after it failed the
  equivalence test: where other rings cross (rings a grid step apart, turned), clipper re-splits
  untouched slivers each time it sees them, so a ring set aside came back different from the one
  the whole-region painting re-processed. The precondition is now on the whole selection.
- **Paint all levels in one pass with the even-odd rule.** Rejected: clipper rounds intersections
  per operation, so overlapping shapes would get different vertices, which is a geometry change.

### Consequences

- Same output: the result hash of every S6 fixture is unchanged (Offset, Outer shapes only, Both,
  the Offset outlines row; 20 everyday shapes, 200 overlapping circles, 25–300 concentric rings),
  and a seeded test compares the painter with the whole-region painter on 250 scenes (1,500 when
  run locally), half of them targets whose levels take the new path.
- Measured in Node on the S6 harness (median of five, production esbuild bundle; numbers in the
  P3 sweep table, `docs/audits/2026-11-02-performance-s1/P3-SWEEP.md`).
- Guards count work, not time: painting 120 concentric rings feeds clipper under 4 × the ring
  points (the level-by-level painter fed about 60 ×), and 80 concentric rings take at most two
  clipper differences each for their depths (before, 80 × 79).
- Selections with rings closer than 4 µm keep the old cost.

### Verification

- `src/core/geometry/vector-path-nesting-paint.test.ts` (equivalence and work counts) and
  `src/core/geometry/offset-nesting.test.ts` (Amendment 3's behaviour, unchanged).
