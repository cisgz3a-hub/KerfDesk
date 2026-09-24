## ADR-379 - Move artwork onto an operation, switch every operation, and sort cuts last (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Extends ADR-211 (explicit operation bindings and artwork run order) and its amendment (the Run
order view). Keeps ADR-224 v2 and ADR-228: Job Review findings are warnings and never gate Start.

### Context

The 2026-09-24 LightBurn gap audit found three operations-panel gaps:

1. **No visible way to move artwork onto an existing operation.** `assignSelectionToLayer` existed,
   but its only button (`AssignSelectionButton`) was mounted nowhere in the app. In LightBurn,
   clicking a palette colour with shapes selected moves them to that layer
   (<https://docs.lightburnsoftware.com/2.1/Reference/UI/ColorPalette/>). The store action also
   left `operationOverride.byOperation` keys for the operations it removed, which the project
   validator rejects on load, and recorded an undo step when nothing changed.
2. **No whole-list switches.** LightBurn's Cuts / Layers header menu has Enable all, Disable all,
   Invert, Show all and Hide all
   (<https://docs.lightburnsoftware.com/2.1/Reference/CutsLayersWindow/>).
3. **No Sort Cuts Last.** LightBurn orders layers by strength, then pushes every Line layer to the
   end so engraving runs before cutting. If a cut frees a part before the engraving inside it
   runs, the part can drop or shift and the engraving lands in the wrong place.

The project has no "cut" flag: Line mode covers through-cuts, scores and line engraving alike.

### Decision

1. **Move artwork onto an existing operation.** One store command, three places to use it, one
   undo step:
   - Each row in **All operations** shows **Move selection here** while movable selected artwork
     is not already on that operation alone, or says `Selected artwork uses this operation` when it
     is.
   - The row's colour swatch is now its own button. With movable artwork selected elsewhere it
     moves that artwork (LightBurn's palette). Otherwise it picks the drawing operation, as
     LightBurn's palette does with nothing selected.
   - The inspector's **Move to operation** (a chooser and **Move**) moves the artwork it shows.

   Contract: the artwork is bound to exactly that operation (path-level bindings cleared). Its
   artwork-wide override keeps applying. Settings it holds for an operation it left stay keyed to
   that operation, unless that operation now has no artwork: then the operation is removed, and so
   is every artwork's setting for it, so the saved project validates. Locked artwork and the
   registration box never move, and nothing moves onto the registration operation (ADR-057).
   Artwork moved onto a hidden operation leaves the selection. A move that changes nothing
   records no undo step. This differs from **Use one operation** (ADR-211 §5), which chooses among
   the selection's own operations and clears the artwork's overrides; that control is unchanged.
2. **Switch every operation.** **Actions for every operation**, at the top of **All operations**,
   offers Enable all / Disable all / Invert for Output and Show all / Hide all / Invert for Show.
   Each is one undo step, a press that changes nothing records none, and artwork that becomes
   hidden leaves the selection. LightBurn's doc describes "Invert enabled layer" as turning off
   every enabled layer; KerfDesk's **Invert** flips every Output switch, as the name says. The
   registration operation is switched like any other.
3. **Sort cuts last (laser).** A Line operation is a **cut** when one of its closed shapes, burned
   in Line mode after artwork overrides, surrounds work from another output operation (Line or
   Fill paths, or an Image raster). "Surrounds" is the optimizer's inside-first test: the work's
   bounds lie inside the shape's bounds and their centre is inside the shape. Open paths, Fill and
   Image never count, nor does Line work around nothing or only its own operation, so scores and
   line engraving keep their place. The registration operation and output-off operations are
   ignored. The command writes both orders that decide output (ADR-211 §8-9):
   - operations: every other operation first, in its order, then the cuts, innermost first. With
     reverse layer priority the cuts are written first, so they still run last. This is what puts
     an SVG's own engraving before its own outline.
   - artwork runs: runs without a cut first, in their order, then runs holding cuts, innermost
     first, a run with its own engraving before a pure cut.

   It returns the number of cuts it found and whether anything moved; the toast says which. It is
   one undo step and does nothing on CNC, whose schedule already runs profiles after clearing
   (ADR-211 §9). Unlike LightBurn it does not sort by strength or move scores, and every order it
   does not have to change stays as the operator set it. It is offered in Run order, in **Actions
   for every operation**, and in Job Review.
4. **Job Review cut-order warning.** Job intent warnings read the prepared job, whose group order
   is the order Start streams. When a closed Line cut runs before later work of another operation
   inside it, Job Review shows one warning starting `Cut order:` that names up to three
   cut-before-work pairs. Tabbed cuts do not count: tabs split the contour into open pieces and
   hold the part. Contours on the same operation are left to inside-first. The warning never
   blocks or asks for confirmation (rule 7, ADR-228). Save G-code shows it among its advisory
   toasts, as it does every job intent warning. The Job Review warnings disclosure opens for it,
   as it does for controller identity, and shows **Sort cuts last** beside it until the order is
   right. The fix is an ordinary project edit: the review rebuilds, and at Start the changed job
   needs a new Frame, as after any in-review edit (ADR-230). A second-pass review is fixed to its
   Frame and offers no fix.

### Consequences

- Machine output changes only when the operator moves artwork or presses **Sort cuts last**.
  Nothing reorders automatically. Sorting reorders the same work, so the traced envelope stays
  the same (the G-code test checks the frame bounds signature); the exact-job Frame permit still
  needs a new Frame at Start.
- `Scene.artworkOrder` and `Scene.layers` keep their schema. Only their order changes.
- The panel and Run order buttons do no geometry work until pressed. Only the Job Review button
  checks the order as it renders and after each edit, so it can hide once nothing is left to sort.
- The multiple-operations inspector section still offers only **Use one operation**. The operation
  rows' **Move selection here** and colour swatches move a mixed selection.
- Not done: context menus, keyboard shortcuts, LightBurn's strength ordering, and a cut flag on
  operations.

### Verification

- `src/core/cut-enclosure.test.ts`: cut detection covers Fill/Line/Image work, open paths, Fill
  outlines, scores, output-off operations, the registration jig and nesting depth.
- `src/core/cuts-last-order.test.ts`: other operations keep their order, scores stay put, nested
  cuts run innermost first, runs sort with the rest stable, reverse layer priority, a second sort
  changes nothing, and no cuts means no change.
- `src/core/job/cut-order-hazards.test.ts`: a hazard is found only when a cut runs before work
  inside it; not after sorting, not for work outside, not with tabs, not on the same operation,
  and not for the registration jig.
- `src/io/gcode/emit-gcode-cuts-last.test.ts`: through `emitGcode`, the layer sections change from
  cut-first to engraving-first for separate artworks, for one SVG holding both, and with reverse
  layer priority. The frame bounds signature is unchanged.
- `src/ui/laser/cut-order-warnings.test.ts`: message format, the three-pair limit, and the warning
  disappearing from job intent warnings after sorting.
- `src/ui/state/operation-assignment.test.ts` and `operation-panel-actions.test.ts`: one undo step
  per command, override pruning, no-op moves, hidden targets, locked artwork, the registration
  operation, laser-only sorting.
- `src/ui/layers/OperationAssignAndSwitches.audit.test.tsx` and `SortCutsLastButton.test.tsx`: the
  row button, the swatch quick path, the inspector control, the bulk switches, the Run order
  button and its toasts, and the Job Review fix for each review purpose.
- NOT verified: nothing ran on hardware or in a browser e2e suite.
