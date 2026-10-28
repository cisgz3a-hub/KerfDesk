## ADR-410 Amendment 3 - Offsets keep shapes drawn inside other shapes as holes (2026-10-28)

**Status:** Accepted. | **Date:** 2026-10-28

### Context

ADR-410 item 3 says each ColoredPath is unioned under its own fill rule, "then the selection is
unioned as one design", and that Outer Shapes Only keeps the outer rings. The union used the
non-zero rule, so a shape drawn as its own object inside another one was absorbed before any
offset ran. Rolling audit v7 L1-P1-1 (`docs/audits/2026-10-28-rolling-v7/L1-boolean-offset-weld.md`)
measured it on `main` at f1d919fbf:

- A 50 × 30 mm plate and a separate 10 × 10 mm hole, Offset Shapes Outward 1 mm, gave one
  52 × 32 mm outline. The same art as one compound path gave 52 × 32 and 8 × 8 mm. With Delete
  original objects the compiled cut went from [50, 10] to [52], so the hole left the design and
  the burn with no notice.
- Inward and Both lost the hole too. So did an Ellipse-tool circle, two ColoredPaths of one
  object (an SVG with a `fill-rule` on each element imports that way), and the properties-panel
  offset (the Offset outlines row).
- Outer shapes only made no difference, although its tooltip and WORKFLOW F-A6c say that it is
  the switch that ignores shapes inside other shapes.

What the rest of KerfDesk and LightBurn do:

- **The kerf offset** (ADR-486 decision 1) counts a closed contour inside another path's contour
  as a hole, and an island inside that as an outline again. Its context notes that designs drawn
  on the canvas are made of exactly such separate objects.
- **Fill** uses one fill rule for the whole layer, so a separate inner shape is a hole there too.
- **LightBurn**'s Offset Shapes reference (1.7 docs, `Reference/OffsetShapes/`, read by the audit
  on 2026-10-28) describes Outer shapes only as ignoring shapes contained within others. In the
  LightBurn forum thread "Zig Zags on Offset Shapes (Bug?)" (2021) its developer explains that a
  separately selected shape lying inside another was offset as a hole.

The audit also raised two P3s in the same tools:

- **L1-P3-2.** The offset tools flattened a curved source at the usual 0.025 mm, and each round
  corner, centred on a chord vertex, added its own chords on top. An r 10 circle offset 50 mm sat
  0.031 mm off the true r 60 circle, 0.034 mm at 100 mm. ADR-486 decision 3 already flattens
  curved kerf sources at 0.005 mm so its contours stay within 0.025 mm of the offset curve.
- **L1-P3-3.** Weld, the Booleans and the panel offset refused a path flagged open whose last
  point repeats its first, and greyed out their commands for it. Fill, Offset Shapes and Select
  Open Shapes count the same path as closed (`isClosedEnough`, `polyline-closure.ts`).

### Decision

1. **Nesting.** Offset Shapes and the properties-panel offset build the region they offset as
   follows (`vector-path-nesting.ts`).
   - Each ColoredPath is still unioned under its own fill rule into rings.
   - A ring's depth is the longest chain of rings that strictly enclose it. Its own path's rings
     come from Clipper's tree; another path's ring encloses it when nothing of it lies outside
     that ring except slivers thinner than the 1 µm grid.
   - It is the longest chain, not a count: a hole drawn inside two overlapping plates is one
     level down, not two.
   - Each piece (an outline with its own holes) is added at an even depth and carved at an odd
     depth, level by level from the outside in.
   - A piece with another path's ring between its outline and one of its holes is taken ring by
     ring instead, each ring at its own depth, as the kerf offset does. That hole becomes an
     island again.
2. **Overlap still unions.** Pieces at one depth are unioned, so shapes that only overlap are
   offset as one outline, as ADR-410 item 3 decided.
   - A shape laid across another shape's hole fills it, as Weld would.
   - Two copies of one shape do not enclose each other, so they do not cancel.
3. **Outer shapes only** offsets only the outlines that no other ring encloses. Holes, and
   shapes inside other shapes, are ignored whether they belong to the same path or not.
4. **Nothing nested, nothing changed.** When no ring lies deeper than its own path puts it, both
   tools use the union they always used, so their results are identical to before.
5. **Weld is unchanged.** It stays the filled union that absorbs enclosed shapes, with the review
   that names them (WORKFLOW F-CNC22, "Edge — Weld absorbs enclosed shapes"). The Booleans keep
   their subject and clip union.
6. **Curved sources (L1-P3-2).** Both offset tools flatten curves at 0.005 mm
   (`OFFSET_SOURCE_CURVE_TOLERANCE_MM`) before offsetting. Round corners and caps are chorded at
   Clipper's default (1/500 of the distance), capped at 0.019 mm: the 0.025 mm machine curve
   tolerance less the source's 0.005 mm and one grid step. This replaces Amendment 1's 0.024 mm
   cap, so the whole result, and not only each corner, stays within 0.025 mm of the true offset
   curve. Offsets up to about 9.5 mm keep the chords they had.
7. **Closed enough (L1-P3-3).** Weld, the Booleans, the panel offset and Dogbone read contours
   with the shared closed-enough rule, and so do their availability checks. A path flagged open
   whose end returns to its start is closed; a path whose ends stay apart is still refused with
   its reason.

### Alternatives

- **Union the selection under the even-odd rule.** Rejected: two overlapping shapes would cancel
  where they overlap, and two copies of one shape would cancel each other, against ADR-410
  item 3 and against Weld.
- **Count enclosing rings, as `containment-depth.ts` does for cut order.** Rejected: a hole drawn
  inside two overlapping plates would count two and become an island. Cut order does not have
  to tell those apart; an offset region does. The geometry layer also cannot import `core/job`
  without a cycle.
- **Nest by material only (a piece is a hole only inside another piece's material).** Rejected:
  a square drawn around a compound plate's own small hole would fill that hole, while the kerf
  offset, Fill and the cut itself make it an island.
- **Warn that inner shapes are absorbed, as Weld's review does.** Rejected: the tooltip, WORKFLOW
  and LightBurn all say the shape is offset unless Outer shapes only is on.
- **Keep the 0.024 mm round-corner cap for polygon sources.** Rejected: a polygon source is often
  the chords of a curve already (a trace, an import), and one budget for both cases is simpler
  to hold and to test.

### Consequences

- A selection with a shape inside another shape now offsets with that shape as a hole, under
  Outward, Inward and Both and in the Offset outlines row. Offsets saved before this change are
  stored objects and keep their shape. G-code, Frame, Start and machine behaviour do not change.
- Separately drawn holes cost a containment check each. Measured on this PC:
  - A plate with 1,600 separate holes: 50 ms → 200 ms.
  - A frame around one 4,900-ring path: 36 ms → 330 ms.
  - The old times dropped every inner contour.
  - Two 2,500-ring paths that only cross: 570 ms either way.
- Offsets of curved sources carry about 2.2 times the vertices along their curves (√5, from the
  finer flattening). Round corners of offsets over 9.5 mm carry about 12 % more.
- Weld and Offset Shapes now differ for a shape inside another: Weld absorbs it and names it in
  its review, while Offset Shapes keeps it as a hole.

### Verification

- `src/core/geometry/offset-nesting.test.ts`:
  - A separate hole matches the compound twin for every direction, corner style and Outer
    shapes only setting.
  - Two paths of one object nest, and so does an island in a separate hole.
  - A hole inside two overlapping plates, and a square drawn around a plate's own hole, as the
    kerf offset places it.
  - A path straddling another object, a notch along the plate's edge, and selection order.
  - Overlap still unions: two squares, two copies of one shape, and a bar across a washer's hole.
  - The properties-panel offset gives the compound twin's result.
- `src/ui/state/offset-separate-holes.test.ts`: through `offsetShapesSelection` and
  `offsetSelection` with `compileJob`.
  - Rectangle- and Ellipse-tool holes keep their offset when Delete original objects removes the
    sources.
  - Inward grows the hole, Both keeps both sets, and Outer shapes only drops the hole.
  - The Offset outlines row offsets the hole both ways with no notice.
  - Five of these seven cases fail on the old union.
- `src/core/geometry/offset-round-chord-error.test.ts`: an r 10 Ellipse-tool circle offset 2, 12,
  25, 50 and 100 mm outward with both tools, and 2, 5 and 9 mm inward, stays within 0.025 mm of
  the true circle at 21 samples per edge. The existing chord, cap and small-offset cases still
  pass.
- `src/core/geometry/closed-enough-contours.test.ts` and
  `src/ui/commands/selection-command-state.test.ts`:
  - A square flagged open whose last point repeats its first welds, subtracts and offsets.
  - Its Weld, Combine and Offset row availability is on, for a polyline and for a curve.
  - A square whose ends stay apart is still refused.
