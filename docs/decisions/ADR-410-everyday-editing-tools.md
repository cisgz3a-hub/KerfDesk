## ADR-410 - Everyday editing tools from the LightBurn gap list, batch 3 (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

Builds LBG-T01, LBG-T02, LBG-T03, LBG-F01, LBG-F02 and LBG-F04 from
`docs/audits/2026-09-26-lightburn-gap-audit.md`. Extends the ADR-103 offset. Nothing here changes
G-code, output order, Frame, Start or any machine path: every tool edits the scene or the view.

### Context

The maintainer asked to "build all from the gap and make better than lightburn". The rebuilt gap
list puts six everyday editing tools first because they touch no output path. LightBurn's
documented behaviour, read on 2026-09-26:

- **Move Selected Objects** (`Reference/MoveSelectedObjects/`): page centre, the four corners,
  the four edges "centered between" the other two sides, and the laser position. `P` moves to the
  page centre.
- **Rotate 90°** (`Reference/TransformControls/`): clockwise and counter-clockwise commands, bound
  to `.` and `,`.
- **Offset Shapes** (`Reference/OffsetShapes/`): distance; Outward, Inward or Both; Round, Bevel
  or Corner corners; Outer shapes only; Select resulting objects; Delete original objects;
  Optimize / Simplify results. Inward offsets need closed shapes, and the corner style behaves
  differently inward and outward depending on the corner's direction.
- **Edit menu** (`Reference/UI/EditMenu/`): Paste in Place (no shortcut listed); Invert Selection
  (`Ctrl/Cmd+Shift+I`); Select Open Shapes on every layer, beside the Fill-only variant.
- **View style** (`Reference/ViewStyle/`): Filled draws Fill-mode shapes solid; Wireframe draws
  every vector as an outline. `Option/Alt+W` toggles them from the Window menu.

KerfDesk had typed positions with an anchor picker, the rotate handle, an outward-or-inward offset
of closed shapes with round corners only, a Paste that always offsets 10 mm, open-contour
selection on Fill layers only, and always-filled Fill artwork.

### Decision

1. **Rotate 90°.** **Arrange → Rotate 90° Clockwise** (`.`) and **Counter-clockwise** (`,`) turn
   the selection as one rigid body about the centre of its combined bounds. The pivot rotation
   maps `(dx, dy)` to `(-dy, dx)` with no trigonometry, and `rotationDeg` is kept in 0..360, so
   four turns return every transform exactly. Scene +Y points down, so clockwise on screen is
   +90°. Plain `.` never reaches Abort: Abort is `Ctrl/Cmd+.` and this shortcut ignores any chord
   with `Ctrl` or `Cmd` held.
2. **Move to bed.** **Arrange → Move to bed** has nine entries: Bed Center, the four corners and
   the four edges, each centred along its edge as LightBurn documents. The selection's anchor
   point lands on the same anchor of the `0..bedWidth × 0..bedHeight` box, and every object moves
   by the same amount. There is no shortcut: `P` is KerfDesk's Preview (F-A15). Move to the laser
   position is not built here; it needs the machine-to-scene mapping that Frame uses and belongs
   with that work.
3. **Offset Shapes.** **Tools → Offset Shapes...** opens a dialog with the LightBurn options.
   - Round, Bevel and Corner map to Clipper round, bevel and miter joins. Corner keeps a true
     mitre to a limit of 4 × the distance (about 29°), so a hairline spike cannot shoot out of the
     art.
   - Inward uses the same join, so the style shapes the corners the offset moves away from. The
     corners of a convex shape therefore stay sharp inward for every style, and concave corners
     take the style, as LightBurn describes.
   - Each ColoredPath is unioned under the fill rule the canvas and CAM use, then the selection is
     unioned as one design. Outer Shapes Only keeps the positive (outer) rings.
   - Open paths offset outward into a closed outline around the line. Their end caps follow the
     corner style (round, butt or square), since LightBurn does not document caps. Inward on open
     paths alone explains that it needs a closed shape.
   - Both makes two new objects in one undo step. If only the inward half collapses, the outward
     half is added and a notice says so. The results get their own operation cloned from the first
     source (ADR-103 behaviour), and are always selected, as every KerfDesk command that makes
     new objects does, so Select resulting objects is not a separate switch. Delete original
     objects removes the unlocked sources in the same undo step. Locked shapes are left out of the
     offset. Optimize / Simplify results is not built in this batch; it is recorded as a
     follow-up on LBG-T03 in the gap audit.
   - The dialog computes the offset live with the same core call and shows the result drawn over
     the selection, with each result's size. Offset is unavailable while the offset cannot be
     made, and the reason is shown. The dialog reopens with the settings last applied in the
     session.
   - The properties-panel offset (ADR-103) stays as the quick one-field version.
4. **Paste in Place.** **Edit → Paste in Place** (`Ctrl/Cmd+Shift+V`) pastes the scene clipboard
   at the copied position, with every rule of ordinary Paste. LightBurn lists no shortcut; this
   chord is the Illustrator and Figma one and was free.
5. **Invert Selection** (`Ctrl/Cmd+Shift+I`) selects every unlocked object on a visible operation
   that is not selected now. **Select Open Shapes** selects such objects that have a path of two or
   more points whose ends do not meet (`isClosedEnough`), on every operation, and reports how many
   objects and open paths it found. When there are none it says so and keeps the selection. Both
   follow Select All's eligibility and group expansion.
6. **Wireframe view.** **Window → Wireframe View** (`Alt+W`, also matched by key code so Option+W
   works on macOS) draws Fill artwork as outlines in its operation colour. It is display only and
   session only, so a forgotten toggle does not outlive the app. The sprite cache keys on the draw
   mode, so cached filled artwork redraws. Preview is unchanged.

### Alternatives

- **Bind `P` to Move to bed centre for LightBurn parity.** Rejected: `P` is Preview (F-A15), and
  moving it would break a documented KerfDesk shortcut for a less frequent command.
- **Rotate through the existing rotate-selection path with trigonometry.** Rejected: floating
  error would let four turns drift, and the quarter turn is exact.
- **Offset Both into one object.** Rejected: LightBurn makes separate shapes, and separate objects
  let the inner and outer outlines take different operations.
- **Persist the wireframe toggle.** Rejected for now: a view setting that survives restarts makes
  Fill artwork look broken to a user who forgot it. Revisit if users ask.
- **Refuse Select Open Shapes when nothing is open.** Rejected: an always-available command with a
  truthful notice is the repo's rule against new guards.

### Consequences

- The Arrange menu is grouped (Align, Distribute, Rotate & flip, Move to bed, Layout) because it
  grew from 16 to 27 entries.
- Five shortcuts are added: `.`, `,`, `Ctrl/Cmd+Shift+V`, `Ctrl/Cmd+Shift+I` and `Alt+W`. None
  was bound before.
- No output, G-code, Frame, Start or machine behaviour changes, so no output snapshot changes.

### Verification

- `src/core/scene/selection-placement.test.ts`: world vertices turn about the centre, four turns
  restore the exact transform, CW then CCW undoes, and all nine bed anchors land correctly.
- `src/core/geometry/offset-shapes.test.ts`: corner-style areas for a square (round 140 + π,
  bevel 142, corner 144), inward 64 for every style, Both, Outer Shapes Only, open-line caps,
  mixed open and closed, and each error.
- `src/ui/state/offset-shapes-actions.test.ts` and `src/ui/state/editing-tools-actions.test.ts`:
  one undo step, selection, locked shapes, Delete originals, Paste in Place position, Invert
  Selection and Select Open Shapes.
- `src/ui/commands/OffsetShapesDialogHost.test.tsx`: live summary, disabled Offset with the reason,
  remembered settings.
- `src/ui/app/editing-tool-shortcuts.test.ts`: the five chords, `Ctrl+.` left to Abort, editable
  fields left alone.
- `src/ui/workspace/object-display.test.ts`: wireframe strokes Fill artwork and changes the style
  key.
- `src/ui/commands/AppMenuBar.control-audit.test.tsx`: every new menu entry clicks through to its
  action.
