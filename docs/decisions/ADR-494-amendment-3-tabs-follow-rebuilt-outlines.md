## ADR-494 Amendment 3 - Tabs placed by hand follow a rebuilt rectangle and Optimize Shapes; Weld, the Booleans and Offset Shapes say when they drop them (2026-10-29)

**Status:** Accepted; software-verified through unit and UI tests. | **Date:** 2026-10-29

Amends ADR-494 Amendment 2, which keeps placed tabs in place through Edit nodes **Delete** and
**Radius / Fillet**. Three more edits rebuild or restart an outline and either moved tabs placed
by hand or dropped them without a word. Output changes only where one of these edits used to move
such a tab. No project schema change, no new guard or refusal (ADR-228).

### Context

A tab placed by hand, laser (`laserTabAnchors`) or CNC (`cncTabAnchors`), is stored as a fraction
`pathT` of one contour's length, measured from that contour's start (ADR-156). ADR-156 and ADR-494
item 4 say a resize carries placed tabs, and Amendment 1 requires any command that changes where a
contour starts to keep each tab at the same physical place, or deliberately handle it. Rolling
audit v8 area N3 found three gaps, each confirmed by a refuter on real GRBL and CNC output.

- **N3-P1-1 (P1, a regression from #1502).** ADR-144 Amendment 1 rebuilds a resized rounded
  rectangle at its new size so its corners stay round (`withObjectTransform`). The rebuilt outline
  starts at `(w − r, 0)` and shares its length between edges and corners differently, but every
  tab kept its fraction. On a 100 × 50 r 10 part with tabs at the middle of its right edge and of
  a long edge, a toolbar width of 200 burned and cut them 21.33 and 21.71 mm from where the stretch
  put them, one on a corner arc; a locked 2× resize moved them 7.57 mm, and a canvas handle drag
  as far as the toolbar. Before #1502 these routes kept them exact. **Shape Properties** Width
  (`rematerializeShapeSpecEdit`) moved them the same way even before #1502: 21.3 and 21.7 mm, and
  16.7 mm on a sharp rectangle.
- **N3-P1-2 (P1).** **Optimize Shapes** starts a closed contour with corners again at its first
  corner (`contour-corners.ts`, `optimize-contour.ts`), and kept each tab's fraction. On
  Amendment 2's own 40 × 20 part, drawn from the middle of its bottom edge, the laser and CNC tabs
  moved 14.42 mm onto other edges while the notice said "the outlines did not move".
  `optimize-object.ts` claimed tab anchors stayed valid because each contour keeps its index.
- **N3-P2-1 (P2).** **Weld**, **Subtract / Intersect / Exclude** and **Offset Shapes** with
  **Delete original objects** build new objects without the sources' placed tabs. ADR-156 lets an
  edit that changes an outline's shape drop them, and the new outline then takes its operation's
  automatic tabs, but nothing said so. **Extend** names the same loss.
- None of these was visible: placed tabs are drawn only while a tab tool is open.

### Decision

1. **A rebuilt outline carries each tab to where the stretch puts it.** When an object is rebuilt
   from its settings, each laser and CNC tab is located on the old outline in the artwork's own
   coordinates, moved by the stretch of the old box onto the new one (each axis on its own), and
   placed at the nearest point of the new outline on the same contour, measured on the flattened
   outline the output reads (`withTabsFollowingRebuild`, beside Amendment 2's
   `withTabsFollowingEdit` in `core/geometry/edited-tab-anchors.ts`).
   - It runs inside `withObjectTransform`, so every resize writer is covered: the toolbar W / H,
     Match size, the remote control and the other selection commands, the canvas handle drag's
     frames, and the registration jig editor's canvas (and its shared size box once that box bakes
     a rounded rectangle too, audit v8 N3-P1-3).
   - It runs inside `rematerializeShapeSpecEdit`, so Shape Properties edits of rectangles,
     ellipses, polygons and stars are covered.
   - A tab on a straight edge lands exactly where a plain stretch would have burned it, while that
     place is still on a straight edge of the new outline. A tab on a rounded corner, or one a
     shrink brings into a corner, lands on the nearest point of the new corner: the stretch would
     have made the corner an ellipse, which ADR-144 Amendment 1 no longer draws.
2. **Resizes say nothing; Shape Properties says when a tab moved.** A resize keeps the outline's
   form, and a tab on a corner stays on that corner, so the toolbar, the handles and the jig editor
   push no toast (a drag would push one every frame). A Shape Properties edit can change the form
   (a corner radius, a side or point count), so when a tab's stretched place lies off the new
   outline it pushes Amendment 2's sentence: "N placed tab(s) sat on the changed outline and moved
   to the nearest point of it. Undo restores them." Off means farther than the flattening
   tolerance times one plus the largest axis stretch, since a stretch enlarges the old outline's
   flattening error with it; without a stretch that is Amendment 2's 0.05 mm.
3. **Optimize Shapes re-measures each tab where it was**, with `withTabsFollowingEdit` as Delete
   and Fillet do, in `optimizedSceneObject`, which the dialog's preview and Apply share. Its
   notice adds Amendment 2's sentence when a tab's old place lies more than 0.05 mm from the
   optimized outline (smoothing can move it), and says nothing more otherwise. The header of
   `optimize-object.ts` now says the start can move and the caller re-measures.
4. **Weld, the Booleans and Offset Shapes say when they drop placed tabs.** When the edit replaces
   sources that carried any, it pushes, once the edit commits, "Placed tabs on the welded shapes /
   combined shapes / deleted originals were removed. Undo restores them.", worded like Extend's.
   With **Keep original objects**, or without Delete original objects for Offset Shapes, the
   sources keep their tabs and nothing is said. The tabs are not remapped onto the new outline:
   ADR-156 permits the invalidation, and which part of a weld or an offset should carry a tab is
   a choice for a later decision.
5. Each of these remains one Undo step, which restores the anchors with the outline.

### Consequences

- The audit's part keeps both tabs exactly where the stretch puts them through the toolbar width,
  a locked 2× resize, a three-frame handle drag, the jig editor canvas and a Shape Properties width,
  with round or sharp corners. The burned GRBL tab spans are within 0.003 mm (the G-code's three
  decimals), and the CNC tab rises match a part drawn at the new size with its tabs placed there.
- A Shape Properties corner radius change keeps tabs on straight edges in place; before, the
  shorter or longer outline carried every tab round the part.
- Optimize Shapes keeps every tab of a part drawn from mid-edge in place, laser and CNC.
- Weld, Subtract and Offset Shapes still drop placed tabs, now with a notice; the result takes the
  automatic tabs its operation sets, as before.
- The moved count in a notice counts laser and CNC tabs separately, as Amendment 2's does.
- Unchanged: Smooth, Corner, Curve and Line, and dragging a node or a handle, still keep each tab's
  fraction (Amendment 1, Consequences).

### Verification

- `src/ui/commands/NumericEditsBar.rect-tabs.test.tsx`, through the real Numeric Edits Toolbar,
  Shape Properties and the emitted GRBL G-code: toolbar W 200, a locked 2× resize and a Shape
  Properties width of 200 (r 10 and r 0) burn each tab span within 0.003 mm of where the stretch
  puts it and resolve the CNC tabs within 1e-6 mm, with no toast; a corner radius of 20 keeps both
  edge tabs in place.
- `src/ui/state/resized-rectangle-tabs.test.ts`: a three-frame canvas handle drag and the jig
  editor canvas burn the tab spans and resolve the laser and CNC tabs where the stretch puts them,
  and the drag's CNC tab rises match those of a part drawn at that size with its tabs placed
  there; a tab on a rounded corner lands on the new corner, as near its stretched place as that
  corner comes; a Shape Properties radius of 0 moves the corner tab to the sharp corner's
  edge, keeps the edge tabs, toasts the moved sentence, and Undo restores the anchors.
- `src/ui/state/optimize-shapes-tabs.test.ts`: the 40 × 20 mid-edge part and an L-shaped part keep
  their burned tab spans and their laser and CNC tabs in place, the notice reads exactly "Optimized
  1 object: 5 points became 4 segments; the outlines did not move.", and Undo restores the part.
- `src/ui/state/removed-tabs-notice.test.ts`: Weld, Subtract and Offset Shapes with Delete
  original objects name the removed tabs and Undo restores them; kept originals and sources
  without placed tabs say nothing about tabs.
- On `origin/main`'s sources the 13 tests that are not controls fail. The toolbar width, the
  handle drag, the jig canvas and the Shape Properties width burn three tab spans where two belong:
  the first at the audit's `(178.289, 250)`, the other split across a corner arc. The locked 2×
  resize misses by 7.567 mm, Optimize Shapes by 14.42 mm, and the corner tab by 17.44 mm. The
  sharpened corner leaves its tab at x 154.03 instead of 200, and Weld, Subtract and Offset Shapes
  push no notice.
