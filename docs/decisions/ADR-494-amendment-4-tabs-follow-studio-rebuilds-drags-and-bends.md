## ADR-494 Amendment 4 - Tabs placed by hand follow Design Studio rebuilds, a whole handle drag, Shear, Warp and Deform; Dogbone and a text edit say when they drop them (2026-11-02)

**Status:** Accepted; software-verified through unit and store tests on emitted G-code and CNC cuts,
not hardware-tested. | **Date:** 2026-11-02

Amends ADR-494 Amendment 3. Rolling audit v9 area R3 confirmed that Amendment 3 holds on every path
it names, and found five more routes that move or drop a tab placed by hand
(`docs/audits/2026-11-02-rolling-v9/R3-fix-tabs-jig.md`). On CNC, a tab in the wrong place can let a
part break free. Output changes only where one of these edits used to move such a tab, or where a
stale anchor stayed on the wrong glyph. No project schema change, no new guard or refusal (ADR-228).

### Context

- **R3-P1-1.** A Design Studio part or sketch is rebuilt from its dimensions, and each path is
  recovered by its name (ADR-573), but each tab kept its fraction. A Panel typed from W 100 to
  W 200 moved tabs at mid-right and mid-top 16.67 mm and others up to 30.67 mm, and a tab on the
  right edge landed on the bottom edge. No warning reached the operator.
- **R3-P1-2.** Amendment 3 ran inside `withObjectTransform`, and a handle drag calls that on every
  frame, measuring from the frame before. Once a frame had brought a tab into a corner its old place
  was gone. One drag of a 300 × 100 r 25 part down to W 50 and back to W 300 left tabs 13.41 and
  7.89 mm off, on a part back at its old size.
- **R3-P2-1.** Dogbone rebuilt the outline without placed tabs and said nothing, where Weld, the
  Booleans and Offset Shapes now name the same loss.
- **R3-P2-2.** Shear, Warp and Deform kept each tab's fraction while edge lengths changed: up to
  31.5 mm in a shear, with a tab changing edge from 30°, and 46 mm in a warp.
- **R3-P2-3.** A text edit kept tabs by contour index. In Roboto, "AB" edited to "XAB" put them on X
  and on the counter of A; "BA" put both on B; "A" left an anchor resolving to nothing, which would
  apply again if a later edit brought a contour back. A font change kept the fraction of a different
  outline.

### Decision

1. **A Design Studio rebuild carries each tab on its own contour**
   (`withTabsFollowingRebuiltContours`, `core/geometry/rebuilt-contour-tabs.ts`), in
   `regeneratePartGenerator` and `retainSketchTabBindings`, after the existing remap by path name.
   - Each contour stretches by its own box, because a hole moves by its own definition.
   - Not every dimension is a plain stretch: a bracket's inner wall stays at its leg width when its
     width changes. So a contour rebuilt with the same number of edges holds each tab on the edge at
     the same index: where the stretch puts it if that place is on the edge, otherwise at its old
     share of the edge. A tab never changes edge here.
   - A contour with a different number of edges has no matching edge, so the tab goes to the nearest
     point of the new outline, and counts as moved when that is off its stretched place.
   - An unchanged contour keeps its anchor exactly.
2. **The review says so before Apply.** The part and sketch reviews say "Placed tabs follow the new
   size, each on its own edge." for a source that has any, then name how many move to the nearest
   point and how many a removed path removes. Both counts count laser and CNC tabs separately, as
   Amendment 2's does. No toast repeats it after Apply, because the review is shown first.
3. **A handle drag measures each tab from where the drag began.** `setObjectTransform` and
   `setObjectTransforms` pass the object from `pendingUndo` to `withObjectTransform`. The size still
   comes from the current object, because a frame's scale is relative to it, and the tabs and the old
   outline come from the start, so every frame is one stretch from the start. Multi-selection and
   groups use the same writers. The drag stays one Undo step and Escape restores it exactly.
4. **Shear, Warp and Deform map each tab through the same transform as its outline**
   (`withTabsFollowingMap`), then re-express it as a fraction of the new contour. Shear uses its local
   bake matrix; Warp and Deform go local to world, through the map, and back to the result's own
   coordinates, in the plan their preview and Apply share, so the drawn shapes they convert to paths
   first are covered too. If a tab's mapped place is off the new outline, it goes
   to the nearest point and the toast adds Amendment 2's sentence. **This supersedes Amendment 1's
   Consequences for these three commands.** That text accepted a kept fraction for edits that
   "reshape a contour"; it still covers Smooth, Corner, Curve and Line, node and handle drags, and
   Join.
5. **Dogbone says when it drops placed tabs**, once for the edit: "Placed tabs on the relieved shapes
   were removed. Undo restores them." It says nothing when no relieved part held one, or when nothing
   was relieved. The tabs are not remapped, as in Amendment 3 D4.
6. **A text edit keeps a tab only while its contour is the same outline**
   (`textTabAnchorsAfterEdit`, `core/text/text-edit-tab-anchors.ts`).
   - An edit that keeps the glyph run (content, font, text style and weld unchanged: a size, spacing,
     alignment or layout change) keeps each tab whose contour still exists.
   - An edit that changes the run keeps a tab only if the contour at its index is the same points
     from the same start, wherever the layout put it and scaled by any size change. So adding a letter
     at the end keeps every tab; a letter in front, a reorder or a font change drops them. Which letter
     a dropped tab was meant for is not guessed (ADR-156), and the contour takes its operation's
     automatic tabs, so every letter stays held.
   - No edit leaves an anchor that resolves to no contour.
   - A colour change keeps each tab on its recoloured path, which used to leave it resolving to nothing.
   - The toast names the count, laser and CNC apart: "N placed tabs were on letters this edit changed,
     so they were removed. Undo restores them."
   - The registration jig's text edit, which replaced the object and dropped every tab without a word,
     follows the same rule and says the same thing.

### Consequences

- The audit's Panel, sketch, drag, shear and warp all burn and cut where the map puts each tab. Tab
  spans in emitted GRBL are within 0.003 mm (0.01 mm through a warp), and CNC rises match a twin drawn
  at the new shape with its tabs placed there.
- Nine scenes through these routes, with no placed tabs or on routes that were already right (one-way
  grow, sharp rectangle), emit byte-identical G-code on this change and on `origin/main`.
- A project saved by 1.0.28 with a tabbed part opens burning where it did, and its tabs follow an edit.
  Tabs that an earlier release already moved stay where the file has them: the old place is not
  recorded (audit R3-P3-2).
- Accepted: **W 50 typed and then W 300 typed** are two edits and two Undo steps, each within
  Amendment 3 D1, so a tab a shrink brought into a corner stays near it. Only one drag is one edit.
- Accepted: an edit changing both the text and its flattened point count (a size change large enough to
  flatten a curve differently, or welded text) can drop a tab on a letter that did not change. It says
  so, and Undo restores it.
- Not covered: variable text rendered per record at output, and text on a path that a content edit
  turns, which drops its tabs because each letter's angle changes.

### Verification

- `src/ui/state/rebuilt-part-tabs.test.ts`: Panel, stretched Panel, bracket inner wall, hole, removed
  hole and sketch through the real prepare and accept, and review and apply, with G-code spans, CNC
  rises, Undo and Redo; a sketch that gains a corner; the 1.0.28 save in
  `src/__fixtures__/older-projects/`, written by the real code at `33bc394c6`.
- `src/ui/layers/RebuiltTabsNote.test.tsx`: the review's words, in the part and sketch reviews.
- `src/ui/workspace/drag-resize-tabs.test.ts`: the audit's drag through the real `applyTransformDrag`,
  single, multi-selection and group, ending at the start size and at another; Undo, Redo and Escape;
  controls for a one-way grow, a sharp rectangle and no tabs.
- `src/ui/state/bent-outline-tabs.test.ts`: Shear at five angles including the near-corner tab, rotated,
  scaled and mirrored artwork, Warp and Deform with a converted drawn shape, multi-selection, spans and
  rises.
- `src/ui/state/removed-tabs-notice.test.ts`: Dogbone's notice, single and multi-selection, and its
  silent cases.
- `src/ui/state/text-edit-tabs.test.ts`: real Roboto and Anton through `textToPolylines` for "XAB", "BA",
  "A", "ABC", a font change, a size, spacing and colour change, and the jig; "XAB" emits the same G-code
  and CNC rises as text that never had a placed tab.
- On `origin/main`'s sources 37 of the 55 store tests fail. The 18 that pass are controls and the routes
  that were already right (Weld, Subtract, Offset, a same-size hole, "ABC", a size or spacing change).
- Not run: browser pointer events, and hardware. No machine was operated.
