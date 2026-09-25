## ADR-398 - Break Apart splits a trace into shapes that keep their holes (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

### Context

A trace (ADR-013, ADR-026) is one `TracedImage` whose filled output is a single `ColoredPath` holding
every boundary of every shape as one list of closed subpaths. Which subpath is an outer and which is
a hole is decided only by the fill rule (absent `fillRule` means even-odd for traces). Break Apart
(`arrange.break-apart`) accepted only `imported-svg` (`selectionCanBreakApart`, `canBreakApart` in
`ui/state/break-apart-actions.ts`), so it stayed disabled on a trace. The workaround was Convert to
Path, then Break Apart. It is hard to find, it drops the trace's identity, and it splits one object
per subpath, so in a Fill operation every hole becomes a separate filled disc that burns over the
shape it was cut from. LightBurn lets users ungroup a traced result into its shapes.

Measured on the tracer test art (1254 x 1254 px, traced in a Node harness on the current base
`fa8939b8d`). The coverage check samples a 7.3 px grid, 29,584 points, with even-odd point-in-polygon
over the traced loops:

| Image, preset | Subpaths | Workaround objects | Workaround samples filled wrongly | Shapes (with holes) | Samples wrong after split |
|---|---|---|---|---|---|
| owl, Line Art | 2,187 | 2,187 | 7,818 (the trace covers 9,945) | 425 (24) | 0 |
| owl, Sharp | 14,389 | 14,389 | 7,494 (of 10,312) | 9,276 (39) | 0 |
| hummingbird, Line Art | 1,397 | 1,397 | 5,433 (of 7,733) | 551 (15) | 0 |
| hummingbird, Sharp | 11,348 | 11,348 | 5,486 (of 7,664) | 7,545 (24) | 0 |

### Decision

1. Break Apart accepts an unlocked `traced-image` with more than one subpath (`canBreakApartTrace`,
   `ui/state/trace-break-apart.ts`). The gate and the action both count a path's canonical curves when
   present and its polylines otherwise (`subpathCount`), for imported SVGs too.
2. A filled trace (`traceMode` `filled-contours` or absent) splits into one object per outer shape.
   `groupSubpathsByOuterShape` (`core/geometry/outer-shape-groups.ts`) builds the containment tree of
   the closed subpaths: each loop's parent is its smallest strictly larger container. The coverage of
   the region just inside a loop is its parent's plus that loop (one more crossing, and the loop's
   direction added to the winding). A loop whose outside region is unfilled under the path's rule
   starts a new shape: an outer, or an island inside a hole. Any other loop joins its parent's shape:
   a hole, or under nonzero an inner boundary that winds the same way. At any point the loops around
   it form one chain, and the loops of that chain that belong to enclosing shapes add up to an
   unfilled region, so each shape reproduces the original even-odd parity or nonzero winding inside
   itself. The shapes partition the original burn area exactly and do not overlap. Open or degenerate
   subpaths become shapes on their own.
3. Containment comes from `nearestContainers` (`core/geometry/loop-nesting.ts`). Every edge goes into
   horizontal bands a quarter of the mean edge height tall. A probe casts the same half-open rightward
   ray as `pointInPolygon` against its band only, which gives every loop around it at once. Traced
   boundaries can touch at a pixel corner, so up to nine vertices spread along a loop vote, and a
   probe within 1e-9 of a candidate's boundary, relative to coordinate size, abstains for that
   candidate. Three probes run first. The rest run only when those three touch a boundary or disagree.
4. Centerline and Edge traces are strokes: each subpath becomes its own object, and a closed stroke
   inside another is never treated as a hole.
5. Each piece stays a `traced-image` with the original's pixel grid (`tracePixelWidth`/`Height`),
   `traceMode`, `transform`, `operationIds`, `operationOverride`, `powerScale` and path fields
   (colour, operations, fill rule, stroke). Its canonical curves are the original's, unchanged. Its
   compatibility polylines are the original's committed chords (ADR-391) when they pair 1:1 with the
   curves, and are re-flattened otherwise. Bounds are the piece's own. CNC tab anchors move with the
   subpath they sit on. Pieces are named `<source>#part-N` and get ids `<id>__part_N`, as imported-SVG
   parts do. They replace the trace at its place in the object list, artwork order and groups, become
   the selection, and one undo step restores the trace.
6. Provenance: the source raster object is left in the scene untouched. Pieces drop `traceSourceId`,
   so Re-trace Original is disabled on them. A re-trace would replace only one piece with a whole new
   trace. Copying a piece no longer pulls the source raster along (`sceneObjectCopyDependencyIds`).
   Undo brings back the linked trace.
7. A trace that is already one shape (an outer and its holes) is left unchanged, and an info toast
   says so. Locked traces are refused, as locked SVGs are. The command keeps the name Break Apart, and
   its tooltip now says that a trace splits into one object per shape, each keeping its holes.

### Consequences

- Burn output is unchanged. Pieces have the same transform, curves and compatibility chords as the
  trace, and compile's trace-specific handling (direct scanline hatching of a single even-odd traced
  path, `canHatchTraceDirectly`) still applies because the pieces are traces. The regression test
  compiles a rotated, mirrored, non-uniformly scaled trace before and after and gets identical Line
  moves.
- Grouping time in the same harness, first run: owl Line Art 150 ms, owl Sharp 603 ms, hummingbird
  Line Art 72 ms, hummingbird Sharp 368 ms (454,614 compatibility points on owl Sharp). A pairwise
  point-in-polygon version of the same grouping took 5,414 ms on owl Line Art.
- Imported SVGs still split one object per subpath, so an SVG letter "O" still becomes two discs.
  Applying the same grouping to SVGs would change existing behaviour and its tests, so it is left to
  a separate decision.
- The containment tree assumes boundaries do not cross, which the tracer's topology repair keeps
  true (ADR-391). For crossing input the vote picks the container most probes agree on. That is
  still a grouping, but not necessarily an exact partition.
- Tests: `outer-shape-groups.test.ts` (scrambled nesting, side-by-side outers, a hole touching its
  outer at a corner, nonzero same-direction and reversed inner loops, curves with a misaligned
  compatibility view, open subpaths) and `break-apart-trace.test.ts` (two rings with holes and a speck
  give three pieces with cubic curves kept, identical even-odd coverage on a 0.5 px grid and
  identical compiled Line moves, operation bindings, output overrides, z-order, groups and a single
  undo, a locked trace refused, a single ring left whole with a toast, Centerline one stroke per
  piece).

Not part of this decision: grouping holes for imported SVGs; an "Ungroup trace" that keeps pieces
linked to the source raster for later re-tracing; splitting a Photo shading trace by tone band.
