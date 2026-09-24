## ADR-380 - The pen places exact corners and dragged smooth nodes (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Amends ADR-051 (B6, the pen) and builds on ADR-214's fairing stamp. Follows LightBurn's Draw Lines
tool (https://docs.lightburnsoftware.com/2.1/Reference/DrawLines/).

### Context

The pen recorded the clicked points, then `createPolyline` refitted every open path of four or more
points (closed: five) into smooth cubics. A clicked corner did not stay a corner, and a curve could
not be drawn on purpose. The pen snapped only to its own first node, Escape threw the path away,
and it could not continue or join existing paths.

LightBurn's Draw Lines places a corner node exactly where clicked. Click-and-drag places a smooth
node with handles, and `S` switches between corner and smooth nodes. A click on the start closes
the shape; a right-click or `Esc` ends it. Starting on the open end of a path continues it, ending
on another open end auto-joins it, and `Ctrl`/`Cmd` turns auto-join off. Shift holds 45° steps and
Alt snaps from farther away.

### Decision

1. **Exact nodes.** `createPenPath` (`core/shapes/pen-path.ts`) builds the curve from the nodes as
   placed. Two corner sides give a line segment; a smooth side gives a cubic. `spec.points` records
   the nodes, and nothing is refitted. The drawing is stamped with
   `CURRENT_POLYLINE_FAIRING_VERSION`, so the ADR-214 migration skips it. `fairingVersion` already
   persists, so there is no schema change and no migration.
2. **Smooth nodes.** A press dragged more than 3 screen pixels makes a smooth node. The drag sets
   its outgoing handle and the incoming handle mirrors it. Shift holds the handle at 45° steps.
   `S` switches clicks between corners and auto-smooth nodes. An auto-smooth node's tangent is
   parallel to the line between its neighbours, and each handle reaches a third of the way to its
   neighbour. The ends of an open path stay corners.
3. **Keys and finishing.** Backspace or Delete removes the last node. Enter, Escape, a right-click
   or a double-click finishes an open path of two or more nodes as one undo step, then returns to
   Select. ADR-051's "Esc returns to Select" still holds, and with fewer than two nodes Escape
   cancels as before. Pressing the first node of a path with three or more nodes closes it, and a
   drag there shapes that node.
4. **Continue and join.** A press on an open end of an unlocked pen drawing, imported SVG or trace
   continues that path. Finishing on another open end joins it, and finishing on the far end of the
   continued path closes it. `Ctrl`/`Cmd` opts out of both. The continued path survives, or the
   joined one if nothing was continued. It keeps its id, operation and direction, and the drawn
   nodes are mapped into its local space.
   - A continued path absorbs the path it reaches only when the result cuts as both did. The
     settings must be equal: every operation setting that reaches the machine, power scale,
     override, fill rule and stroke. Operation id, name and colour are ignored, because each drawn
     object gets an operation of its own. A stroke also needs the same transform.
   - Otherwise the new line ends exactly on that end and both paths stay separate.
   - Locked artwork, artwork with CNC tabs and non-invertible transforms are never extended. A tab
     sits at a fraction of path length, so extending the path would move it.
   - Image masks and path-text guides can be extended but are never absorbed.
   - An operation left with no artwork by an absorb is pruned.
5. **Snapping.** The pen reuses the Design Studio snap engine (`core/design/snap`) and the
   workspace snap settings.
   - Within 8 screen pixels (24 with Alt), it snaps first to nodes and image corners, then to
     crossings between different subpaths, then to segment midpoints (half arc length), then to the
     nearest point on a line.
   - Only when no geometry is in reach does the grid pull, each axis on its own. Its reach is the
     smaller of the pixel reach and the move-snap `distanceMm`, so the default 10 mm grid does not
     take over drawing when zoomed out.
   - Artwork on hidden operations is not a target.
   - The marker glyph is the Design Studio's.
   - Object-move snapping is unchanged.

### Consequences

- Pen drawings saved earlier keep their stored curves. They load, render and cut as before, and
  continuing one keeps its curves. Only its `spec.points` are re-read from the curve's anchors.
- A future bump of `CURRENT_POLYLINE_FAIRING_VERSION` must keep skipping pen drawings. Otherwise
  the migration would refit a line-only pen drawing's corners. A comment beside the constant says
  so.
- Where LightBurn's page is silent, this decision chooses:
  - `S` is a placement mode. It stays on until pressed again and resets when the tool changes. The
    preview of the next segment shows the current mode.
  - Backspace removes the last node.
  - Joins require identical cut settings.
  - The grid pull is capped as above.
  - Locked artwork is a snap target but is never joined.
- Not done:
  - adjusting a placed node's handles before finishing (the node editor does it afterwards)
  - cusp nodes with independent handles while drawing
  - tangent and perpendicular snaps
  - separate toggles for object and grid snapping

### Verification

- New Vitest suites:
  - `core/shapes/pen-path.test.ts`
  - `ui/workspace/pen-tool.test.ts` (rewritten)
  - `ui/workspace/pen-snap.test.ts`
  - `ui/workspace/draw-pen-preview.test.ts`
  - `ui/state/pen-path-join.test.ts`
  - `ui/state/pen-path-legacy-load.test.ts`
  - `ui/app/pen-shortcuts.test.ts`
- The suites cover:
  - exact corners at the clicked points
  - a drag giving a cubic with the dragged handles
  - the `S` toggle
  - closing by pressing the start
  - continuing, joining and the `Ctrl` opt-out
  - node, midpoint, intersection and grid snaps
  - faired and exact drawings surviving save, reopen and the fairing migration unchanged
- `tsc --noEmit`, scoped ESLint and Prettier pass. So do `check-adr-numbers`,
  `check-file-size-policy` and `check-index-exports`.
- NOT verified: no browser (e2e) run; the canvas behaviour is covered by unit tests only.
