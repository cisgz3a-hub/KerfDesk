## ADR-377 - Selection pick order, group operands and selection cleanup (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

### Context

The 2026-09-24 LightBurn gap audit found four selection behaviours that
differed from LightBurn, and two missing cleanup commands:

- The **Align** lesson said "Shift-click the object you want to line up with
  last. This last object stays in place." The selection was only ever held in
  stacking order (`scene.objects`), so the reference was really the top-most
  selected object, whatever the click order.
- **Subtract** kept the bottom-most selected object (WORKFLOW F-CNC22).
  LightBurn subtracts the second shape selected from the first
  (https://docs.lightburnsoftware.com/2.1/Reference/BooleanTools/), so an
  operator following LightBurn habits got the opposite result whenever the
  cutter sat below the base.
- **Groups** were expanded to their members, so Booleans and Weld treated a
  grouped donut (outer circle + inner circle) as two discs. Intersecting that
  group with a star kept the star's part inside the inner circle, not the part
  inside the ring. LightBurn treats a group as one shape.
- There was no **Delete Duplicates** (LightBurn: Edit menu, Alt+D) and no
  **Rubber Band Outline** (LightBurn: Tools menu).
- The audit also listed z-order commands (Bring to Front, Send to Back). In
  KerfDesk stacking order is output order: `compileJob` passes `scene.objects`
  as the vector source order inside each operation, and `compileCncJob` reads
  `scene.objects` too. `artworkOrder` only orders operation runs and images.

### Decision

1. **The selection keeps its pick order** as an optional `selectionOrder`
   beside `selectedObjectId`/`additionalSelectedIds`, which stay in stacking
   order. A click, Select All, select-by-operation and a plain drag-box start a
   new record in stacking order. Shift-click and Shift-drag keep the earlier
   picks' order and append new objects in stacking order. Toggling an object
   off removes it. Clicking a group member picks the whole group at once.
   `orderedSelectionIds` reads the record, drops ids no longer selected and
   appends selected ids it does not know in stacking order. Selection setters
   that do not track pick order therefore stay correct without changes. Pick
   order is session state: it is not saved and not part of undo.
2. **Align's reference is the last object picked**, or that object's whole
   group, and stays put. Distribute is unchanged.
3. **Boolean operands follow pick order, and a group is one operand.** The
   first-picked shape or group is the subject. Subtract keeps it and cuts every
   later operand from it, and every Boolean tool gives the result the subject's
   colour and settings. Weld, Union silhouette and the Boolean tools count a
   group as one shape. Groups that share members merge, as they do for
   Align and Distribute (`selection-units.ts`). A drag-box selection records
   stacking order, so its subject is still the bottom-most object, as before.
4. **A group's region is built by nesting, not even-odd parity.** A member that
   lies inside another member is a hole in it. A member inside that hole is
   solid again. Members that overlap or sit side by side are united, and exact
   copies count once. Even-odd would also punch holes where two grouped letters
   overlap, which Weld exists to remove. A member counts as inside when at most
   0.1% of its area (minimum 0.0001 mm²) falls outside, so a tessellated circle
   touching the outer circle from inside is still a hole.
5. **Edit → Delete Duplicates (Alt+D)** removes paths that repeat another path.
   It works on the selection, or on the whole design when nothing is selected.
   Beyond LightBurn's exact-copy check:
   - Paths are compared in world space within **0.01 mm**. Closed paths match
     from any start vertex and in either direction. Open paths match in either
     direction, and an open path whose ends meet counts as closed. When vertex
     counts differ, every vertex and segment midpoint of each path must lie
     within the tolerance of the other, and their lengths must agree.
   - Repeats inside one object are found as well as repeats between objects.
   - Two paths are only copies when they produce the same output: the same
     operations (or colour, for legacy artwork), power scale, operation override
     and stroke width. A line meant to be both cut and scored is never touched.
   - The first copy in stacking order is kept. An image's mask and a path
     text's guide are checked first, and they are never removed or trimmed.
   - Imported vector artwork loses only its repeated paths. Tab anchors move to
     the kept paths and the bounds shrink. Text and shapes are generated from
     their settings, so they are removed only when every path repeats.
   - Images, traced images and reliefs are never candidates. Locked objects and
     objects with no visible operation are skipped.
   - A pair too large to compare within the work cap is kept, not deleted.
   - It is one undo step, and a toast gives the count or says none were found.
   The existing stacked-copy warning is unchanged.
6. **Tools → Rubber-band outline** adds the tightest convex outline around the
   selection as a new closed shape. Vector artwork contributes every point of
   its flattened paths in world space. Images and other objects without paths
   contribute their placed box corners, so a rotated photo is wrapped by its
   rotated edges. The outline goes on a new **Line** operation with the next
   free colour, and new-layer defaults apply as for any new artwork. It is added
   last, so the existing output order is unchanged. The outline is selected,
   and it is one undo step. A selection with no area (one straight line, a
   point) warns and changes nothing.
7. **No z-order commands.** Bring to Front and Send to Back would reorder the
   machine's cuts as a side effect of a canvas change. They wait until
   stacking order no longer feeds vector output order.
8. There is no command palette, so the new commands are in the menus, the
   command help and the shortcut list only.

### Consequences

- Clicking the base first and Shift-clicking the cutters now works as it does
  in LightBurn. An operator who relied on "bottom-most is kept" with
  click-picking gets the other result. A drag-box selection behaves as before.
- To make a specific object Align's reference after a drag-box selection,
  Shift-click it twice (off, then on) so it becomes the last pick.
- Booleans, Weld and Union silhouette on a grouped donut now use the ring.
  Ungrouped members still act as separate shapes.
- Delete Duplicates never changes output order: survivors keep their stacking
  and `artworkOrder` positions. It also never changes what an image mask or a
  path text depends on.

### Verification

- `selection-order.test.ts` and `selection-order-tools.test.ts`: the pick-order
  rules above on the real store, including groups, Select All, select by
  operation and a stale record; Align's last-picked reference below the top of
  the stack; Subtract keeping the first pick, with a group as subject or cutter.
- `group-operand-region.test.ts` and `group-operands.test.ts`: donut, island,
  overlapping members, stacked copies, a tangent inner circle and a bar across
  the ring; the donut group intersected with a star keeps only the star's part
  inside the ring; Weld and Union silhouette keep a grouped donut's hole.
- `duplicate-contours.test.ts`, `delete-duplicates.test.ts` and
  `selection-cleanup-actions.test.ts`: tolerance, start point, direction, extra
  points, open and closed paths, output settings, repeats inside one object,
  tab anchors, bounds, curves, text, images, masks, locked and hidden objects,
  groups, toasts and a single undo step.
- `rubber-band-outline.test.ts` and `selection-cleanup-actions.test.ts`: hull
  order, inner and collinear points, rotated images, transformed vectors, the
  new Line operation and its colour, one undo step, and selections with no
  area.
- `command-selection-cleanup.test.ts`, `shortcuts-delete-duplicates.test.ts`
  and `AppMenuBar.control-audit.test.tsx`: menu wiring and enablement, a group
  counted as one Boolean operand, Alt+D (including macOS Option+D), and Alt+D
  left to text fields.
- **NOT verified on hardware.** None of this reaches a controller except
  through the artwork it edits.
