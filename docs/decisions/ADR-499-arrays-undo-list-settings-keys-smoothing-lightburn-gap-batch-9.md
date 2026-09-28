## ADR-499 - Arrays, named undo list, Settings window, align keys, fine nudge, path smoothing and merge tolerance, LightBurn gap batch 9 (2026-09-28)

**Status:** Accepted. | **Date:** 2026-09-28

Builds LBG-T13, LBG-T14, LBG-F18, LBG-T22 and LBG-C13 from
`docs/audits/2026-09-26-lightburn-gap-audit.md`, plus three conveniences the Rayforge comparison
(2026-09-27, borrow items 11 and 15) found KerfDesk missing: a named undo list, align and distribute
keys, and a 0.1 mm nudge. The maintainer asked for everything Rayforge is ahead on to be built and
built better. Nothing here moves the machine or bumps the project schema. The one new project
field, an optional merge tolerance, leaves G-code unchanged unless it is set above 0.

### Context

Array had rows and columns with one spacing and a circular mode with even spacing all the way round.
Undo had no names, so Window → Undo History showed "Step 12". Settings were scattered across the
canvas popover, Window → Appearance, the toolbar layout picker and Labs. Arrow keys nudged 1 mm and
Shift+arrow 10 mm with no finer step, and no align or distribute command had a key. The LightBurn
behaviour below is as the gap audit recorded it; the LightBurn and Rayforge reference pages were not
re-read for this batch.

### Decision

1. **Grid array extras (LBG-T13).** Arrange → Array… in Grid mode gains:
   - **Space by** Gap between copies or Distance between centres. Switching converts the numbers so
     the result does not move. A centre distance smaller than the design overlaps copies, which is
     allowed, for nesting.
   - **Row shift** moves rows 2, 4… right (negative: left) and **Column shift** moves columns 2, 4…
     down (negative: up), for brick and honeycomb layouts.
   - **Mirror alternate columns / rows**: Off, Horizontally, Vertically or Both ways. Mirrors in the
     same direction cancel, so both give a checkerboard. Each copy mirrors about its own design
     centre, like Flip, and a design of several objects mirrors as one.
   - **Build right to left** and **Build bottom to top**. The original always stays at row 1, column
     1 and is never moved; variable text advances in build order.
2. **Circular array extras (LBG-T14).** Circular mode gains:
   - **Centre**: Selection centre, Custom point, or a selected object when two or more are selected
     ("Rectangle at 50, 20 mm", top-most first; masks and guides carried by other objects are not
     offered). The centre object is not copied or moved, may be locked, and is left out of the
     selection afterwards. Picking an object fills Radius and Start angle so the original stays put.
   - **Spread copies**: Evenly all the way round, From start to end angle (end inclusive: 5 copies
     from 0° to 90° land at 0, 22.5, 45, 67.5 and 90°; a whole turn does not double the last copy;
     an end before the start runs anticlockwise), or By a step angle (signed). Switching converts
     the fields. Angles start at 0° = right and run clockwise.
   - The status line says what Apply will do ("The original and 4 copies, 22.5° apart from 0° to
     90°, on a 10 mm radius."), and notices say when copies land on top of each other or past a full
     turn.
   - Array… reopens with the settings last applied in this session, except a circle's centre
     object, which falls back to Selection centre; Advance variables always starts off; Cancel
     remembers nothing.
3. **Named undo list.** Every undo step has a name, kept in a side table beside the saved project
   states, so the undo stack and project file are unchanged.
   - Names come from the push site (`pushUndo(prev, stack, 'Trim Shapes')`, now in
     `src/ui/state/undo-stack.ts` and re-exported from `scene-mutations.ts`), else from the command
     that ran it (its menu label without "…", Delete as "Delete 3 objects"), else from what changed
     ("Move rectangle", "Change Cut settings", "Edit project notes"), with "Edit project" last.
   - An **Undo list** button between Undo and Redo lists the last 15 steps, newest first. Choosing
     one undoes back to just before it and keeps the whole redo side, so Redo walks forward again.
   - Window → Undo History shows every undo and redo step by name as one timeline with a "Current
     project" row, jumps either way, and stays open.
4. **One Settings window (LBG-F18).** Edit → Settings… or Ctrl+, (Cmd+, on macOS) opens one window
   with General (theme, workspace layout, recent projects limit, a note that autosave runs every 30
   seconds), Canvas (snapping and the snap settings, frame and start markers, nudge distances),
   Machine & materials (links to Machine Setup, the Bit Library for CNC, Materials or Recipes) and
   Labs (laser only). Every control writes the same store as its old home, which stays; nothing in
   it is saved in a project. The section is remembered for the session.
5. **Align and distribute keys.** Alt+Left/Right/Up/Down align left, right, top and bottom;
   Alt+PgUp and Alt+PgDn centre on X and Y (LightBurn's defaults, previously unbound here);
   Alt+Shift+H and Alt+Shift+V distribute spacing (LightBurn has none; these follow Figma). They are
   shown in the Arrange menu and the shortcut list. Alt+Left/Right are consumed even when there is
   nothing to align, so the browser never goes Back.
6. **Fine nudge.** Ctrl/Cmd+arrow nudges 0.1 mm. The three nudge distances (1, 10 and 0.1 mm) are
   set in Settings → Canvas, 0.01 to 1000 mm, and the shortcut list and toolbar hint show the
   distances actually set.
7. **Optimize Shapes (LBG-T22).** Tools → Vector → Optimize Shapes… smooths and fits the selected
   vector artwork.
   - **Smooth** (0.25 mm, 0.02 to 5 mm) resamples each run between corners at a third of the
     smoothing distance and applies a Gaussian step with Tukey's twicing (2G − G²), which removes
     jitter without shrinking the shape (a circle shrinks by about σ⁴/4R³). Corners sharper than
     **Corner angle** (30°) are pinned. Where one side is already a curve its exact turn decides;
     between straight lines the turn must hold at two window sizes, so noise does not make corners.
   - **Fit to lines, arcs and curves** (tolerance 0.05 mm, 0.005 to 1 mm) greedily replaces runs of
     points with a line, a tangent arc or a tangent-constrained cubic, or with lines, arcs and
     biarcs only ("Lines and arcs only", for controllers that should get G2/G3). The error is
     checked both ways and tangents carry across joins, so the result has no kinks. It reuses the
     Trace arc-fit and cubic-fit building blocks, not the Trace fairing entry points, which cannot
     pin corners or bound the error both ways.
   - The status line gives points before and segments after and the most the outline moves,
     measured as the two-way distance between the old and new outlines (exact at vertices, refined
     to 0.005 mm, rounded up). It is worked out in 30 ms slices with a progress figure, and
     Optimize applies that same result, so what is applied is what the line says.
   - One undo step, none when nothing changes. Imported and traced artwork keeps its kind, id,
     operations and tab anchors; a drawn line stays a drawn line; text and drawn shapes that change
     become paths in the same step; locked artwork is left as it is. Closed contours stay closed,
     open ends stay pinned, and a result that is all lines stays plain polylines; otherwise the
     path gets exact curves.
8. **Merge tolerance for Remove overlapping lines (LBG-C13).** Tools → Cut Planner gains **Merge
   tolerance (mm)**, 0 to 0.5 in 0.01 steps, shown under Remove overlapping lines.
   - 0, the default, keeps ADR-350's exact rule. The G-code is byte-identical for an absent field,
     0 and a reloaded project, on both machine types, with removal on and off.
   - Above 0, a later contour's stretch is dropped where it runs beside a stretch an earlier
     contour in the same operation keeps, within 5° of parallel and within the tolerance. A
     stretch that drifts across the band counts as a crossing and is kept, so crossings and
     T-junctions keep their full cut. Merges never chain along a row of near lines, a contour is
     never merged with itself, and nothing is joined or extended.
   - Stored as the optional `optimization.overlapMergeToleranceMm`, clamped on load, like
     `closedShapeStart` (ADR-494). No schema bump: an older build ignores it and cuts
     near-coincident lines twice, as every build did before. CNC output is untouched.

Better than LightBurn and Rayforge, in short: arrays mirror, shift and build in any direction and
say what Apply will do; the undo list keeps the redo side after a jump and names every step;
Settings links straight to Machine Setup or the Bit Library; the shortcut list shows the nudge
distances actually set; smoothing does not shrink shapes and pins corners exactly; Optimize Shapes
reports the true distance moved before it applies; and the merge tolerance never swallows a
crossing or a T-junction.

### Alternatives

- **An Edit submenu for the undo list.** The menu bar has no submenus; a button beside Undo is one
  click nearer.
- **Move project settings into the Settings window.** Rejected: the window is for this computer's
  preferences, and mixing in project fields would make it unclear what is saved with a file.
- **Shift by half a copy instead of free row and column shifts.** Free shifts cover it and more.
- **A live virtual array object.** Needs a new object kind and a schema bump; left for later.

### Consequences

- `pushUndo` and `HISTORY_DEPTH` live in `src/ui/state/undo-stack.ts`. `UndoHistoryDialog` now needs
  `onUndoSteps` and `onRedoSteps`.
- Units, autosave interval, mouse wheel and import options are not in Settings because KerfDesk has
  no such preferences yet.
- Each nudge press is still its own undo step.
- G-code changes only when a project sets a merge tolerance above 0. No schema bump; the one new
  optional project field is `optimization.overlapMergeToleranceMm`.
- Tools → Vector gains Optimize Shapes after Reverse Paths.

### Verification

- Arrays: `src/core/scene/array-grid-layout.test.ts`, `array-circular-layout.test.ts`,
  `src/ui/state/array-extras-actions.test.ts`, `src/ui/commands/ArrayDialog.test.tsx`,
  `array-dialog-form.test.ts`, `array-dialog-summary.test.ts` and `ArrayDialogHost.memory.test.tsx`.
- Undo names and jumps: `src/ui/state/undo-step-names.test.ts`, `undo-history.test.ts`,
  `src/ui/commands/command-undo-step-name.test.ts`, `UndoListButton.test.tsx` and
  `UndoHistoryDialog.test.tsx`.
- Settings, keys and nudge: `src/ui/settings/SettingsDialog.test.tsx`,
  `src/ui/app/arrange-shortcuts.test.ts`, `nudge-step.test.ts`, `settings-shortcut.test.ts`,
  `src/ui/state/nudge-preferences.test.ts` and `AppMenuBar.control-audit.test.tsx`.
- Optimize Shapes: `src/core/geometry/shape-optimize/optimize-contour.test.ts`,
  `optimize-object.test.ts`, `outline-deviation.test.ts`,
  `src/ui/state/optimize-shapes-actions.test.ts` and `src/ui/commands/OptimizeShapesDialogHost.test.tsx`.
- Merge tolerance: `src/core/job/remove-near-cut-overlaps.test.ts`,
  `src/io/gcode/overlap-merge-tolerance-output.test.ts` (unchanged G-code at 0),
  `src/io/project/project-optimization.test.ts` and
  `src/ui/laser/OptimizationSettingsDialog.test.tsx`.
- Nothing here has been tried on a machine or on real traced artwork by eye.
