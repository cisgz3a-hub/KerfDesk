## ADR-498 - Trim, Cut Shapes, Warp and Deform, Copy Along Path and snapping, LightBurn gap batch 8 (2026-09-28)

**Status:** Accepted. | **Date:** 2026-09-28

Builds LBG-T04, LBG-T06, LBG-T08, LBG-T09 and LBG-F06 from
`docs/audits/2026-09-26-lightburn-gap-audit.md`, under the maintainer's standing direction to build
every gap and do better than LightBurn. These are design tools only: nothing here moves the
machine, changes how an existing project compiles, bumps the project schema or adds a project field.
Artwork edited with them burns as the edited artwork, with its operations unchanged.

### Context

The gap audit recorded that KerfDesk had only a planned Trim stub in the Design Studio, no Cut
Shapes, Warp, Deform or Copy Along Path, and snapping to bounding-box edges and centres with a fixed
10 mm grid and 2 mm distance (`src/ui/workspace/snapping.ts`). The LightBurn behaviour below is as
the gap audit recorded it; the LightBurn reference pages were not re-read for this batch.

Batch 5 (ADR-480) set the pattern these tools follow: a one-line notice for every outcome, one undo
step per action, an explaining notice (not a refusal) when a selection gives a tool nothing to do,
and text and drawn shapes handled explicitly because they rebuild from their settings.

### Decision

1. **Trim Shapes (LBG-T04).** Tools → Vector → Trim Shapes turns on a canvas tool; choosing it
   again, Esc, the hint's Done button or another tool turns it off.
   - Hovering within 8 screen pixels of an outline highlights, in red with dots at its ends, the
     stretch between the nearest crossings with any other visible vector outline or with itself.
     Touches count as crossings, so a line ending on a shape splits the shape there; a path's own
     open ends do not. An outline that crosses nothing highlights whole.
   - A click deletes the highlighted stretch as one undo step. A trimmed closed contour becomes one
     open path that runs through its old start point, not two pieces meeting there. A trimmed open
     path leaves up to two pieces. Deleting a whole outline that was an object's last removes the
     object, with the usual group, selection and unused-operation clean-up.
   - Locked artwork and registration boxes are never cut, and artwork on hidden operations takes no
     part. Locked artwork still counts as an edge to trim back to, so a locked border or jig outline
     can be trimmed against.
   - Lines, cubic curves (de Casteljau) and elliptical arcs are split exactly and their new ends are
     placed exactly on the crossing, so the exact curves survive trimming. A path whose curves and
     polylines do not pair up one to one cannot be trimmed (it still acts as an edge), rather than
     losing its curves.
   - Text and drawn rectangles, ellipses, polygons, stars and barcodes become plain paths in the
     same undo step, keeping their id, transform, operations, power scale, override, tabs and exact
     curves. The notice says so ("The trimmed text is now a plain path…"), and Undo restores them.
     Laser tabs placed on other contours of the object are kept and renumbered.

2. **Cut Shapes (LBG-T08).** Tools → Vector → Cut Shapes splits every selected vector object along
   the outline of the top-most selected closed shape, the cutter. This mirrors Subtract, whose
   bottom-most shape is the subject: the front shape cuts the ones behind it.
   - Closed regions are split with clipper2 into the part inside and the part outside the cutter;
     open paths are split at the crossings. Each source becomes two objects, labelled
     "<name> (inside)" and "<name> (outside)", that keep the source's colours, strokes, operation
     bindings, power scale, override and place in the run order.
   - The cutter is removed, the pieces are selected so they can be moved apart, and the whole
     command is one undo step. The notice counts the shapes cut, the pieces made and any selected
     object the cutter did not cross; those are left exactly as they were, curves included.
   - Fewer than two usable objects, no closed shape, or a cutter that crosses nothing each get a
     notice that says what to select, and nothing changes. Locked artwork, images and registration
     boxes in the selection are ignored.
   - Pieces are polylines, as Weld and Subtract produce.

3. **Warp and Deform (LBG-T06).** Tools → Vector → Warp and Deform start a handle tool on the
   selected unlocked vector artwork. Warp has four corner handles on the selection's bounding box,
   mapped with a projective transform (the camera homography solver); Deform has a 4×4 grid mapped
   with a bicubic Bézier patch that reproduces the identity until a handle moves.
   - The canvas shows the original box dashed, the cage and the handles, and previews the bent
     artwork live with the same code that applies it; the project does not change until Apply.
     Handles move by the pointer's offset rather than jumping to it.
   - Enter or Apply applies as one undo step and returns to the Select tool with the selection kept.
     Esc or Cancel leaves the artwork as it was. Reset handles puts every handle back. Shift while
     dragging a Warp corner keeps the four a parallelogram.
   - The maps are not linear, so curves are flattened, mapped and split adaptively to stay within
     0.05 mm of the true bent curve, and the result is plain polylines; the notice says curves
     became fine lines. Under Warp straight segments stay straight and are not split, and the
     corners land exactly on the handles. Closed contours stay closed.
   - Text and drawn shapes are converted to paths in the same undo step, keeping id, operations and
     tab anchors. Images and reliefs cannot bend and locked artwork is left alone; the notice says
     how many were left. Handles that never moved change nothing.
   - Handles that cross over are still applied, through a bilinear map where the projective one
     would go to infinity. The user sees the preview, so nothing is refused.

4. **Copy Along Path (LBG-T09).** Arrange → Layout → Copy Along Path…, beside Array, copies the
   selected artwork along a guide path.
   - KerfDesk keeps no selection order, so the guide is the top-most selected object that is exactly
     one vector path with length; text and barcodes never guide. When several single paths are
     selected, the dialog offers a Guide path choice.
   - **Place copies by** Number of copies (5), Spacing between centres (starting at the artwork width
     plus 2 mm, so first use never overlaps) or Gap between copies (2 mm, edge to edge). **Start
     offset** and **End offset** trim the ends of an open guide; a closed guide has no end.
     **Rotate copies to follow the path** is on; **Keep the original** is on.
   - Each copy's bounding-box centre sits on the path, several selected objects move as one block,
     and a rotated copy turns with the path direction at its point. On an open guide the first copy
     sits at the start offset and the last at the end offset. On a closed guide copies go evenly all
     the way round with no doubled copy at the seam; an open path whose ends meet counts as closed.
   - Copies keep operation bindings, image masks, path-text guides and groups, using the Array
     helpers. The guide stays, the copies are selected, and it is one undo step. A status line
     under the fields says what Apply will do, from the same plan Apply carries out.
   - A selection with no guide, a guide of no length, only a guide, offsets that leave no room, or a
     spacing of zero gets a notice saying what to change, and nothing changes.

5. **Snapping (LBG-F06).** SNAPPING_DECISION

Better than LightBurn, in short: Trim keeps exact curves, counts touches and trims back to locked
edges; Cut Shapes leaves shapes it does not cross untouched; Warp previews live with a dashed
original, a parallelogram lock and a reset; Copy Along Path adds edge-to-edge gaps, a guide picker
and a safe first spacing; SNAPPING_BETTER

### Alternatives

- **Refuse text and drawn shapes and ask the user to convert them first, as ADR-480's Close Path
  does.** Rejected for these tools: trimming, cutting and bending always end in a plain path, so
  converting in the same undo step saves a step and Undo still restores the original.
- **Keep the cutter after Cut Shapes.** Rejected: the cutter has done its job, and a leftover copy
  on top of the pieces is easy to burn twice by mistake. Undo brings it back.
- **Keep exact curves through Warp and Deform.** Rejected: a projective or bicubic map does not keep
  Bézier curves Bézier, so any curve kept would be an approximation presented as exact. Fine
  polylines within 0.05 mm are honest and far below a laser spot.
- **Pick the Copy Along Path guide by selection order, as LightBurn does.** Not possible without a
  new selection-order model; the top-most rule plus a Guide path choice covers it.

### Consequences

- The Tools menu's Vector group gains Warp, Deform, Cut Shapes and Trim Shapes, and the Arrange
  menu's Layout group gains Copy Along Path. The Vector group's ids moved to
  `src/ui/commands/tools-vector-menu-ids.ts` to keep `AppMenuBar.tsx` under the size cap.
- Two canvas tool modes are added (`trim-shapes`, `warp-deform`); laser-tab, warp-handle, Trim and
  Position Laser clicks are routed from `handle-tool-drag.ts` and `workspace-click-tools.ts`.
- No G-code, schema or project-format change, and no output snapshot changes.
- Not tried in a browser by hand: the hover highlight, handle dragging and snapping markers are
  covered by unit and component tests only.

### Verification

- `src/core/geometry/trim-curve-split.test.ts` and `trim-shapes.test.ts`: exact line, cubic and arc
  splits, nearest crossings, self-crossings, touches, whole outlines, locked edges, hidden
  operations and world transforms. `cut-shapes.test.ts`: regions and open paths inside and outside,
  untouched shapes and the refusal messages.
- `src/core/geometry/warp-deform-map.test.ts` and `warp-deform-paths.test.ts`: identity handles,
  exact Warp corners, a bent Deform, the 0.05 mm tolerance, straight lines under Warp and closed
  contours.
- `src/core/geometry/copy-along-path.test.ts` and `copy-along-path-guide.test.ts`: open and closed
  guides, offsets and the seam, rotation at corners and ends, spacing and gap modes, and the guide
  choice.
- `src/ui/state/trim-cut-shapes-actions.test.ts`, `warp-deform-actions.test.ts` and
  `copy-along-path-actions.test.ts`: every store action's selection, undo step and notice.
- `src/ui/workspace/TrimShapesHint.test.tsx`, `WarpDeformHint.test.tsx`, `warp-deform-tool.test.ts`,
  `src/ui/commands/vector-cut-commands.test.ts`, `command-copy-along-path.test.ts`,
  `CopyAlongPathDialogHost.test.tsx` and `AppMenuBar.control-audit.test.tsx`: hints, keys, the
  dialog and every new menu entry.
- SNAPPING_TESTS
