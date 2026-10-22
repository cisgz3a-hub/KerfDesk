# Rolling audit v2 — Canvas commands

- **When:** 2026-10-21 15:40 +0800   **Tree:** origin/main @ `faf5a54f1` (worktree HEAD
  `687a57e16`; no `src/` difference from `faf5a54f1`)
- **Scope:** `src/ui/workspace/**` and `src/ui/commands/**`. That covers the canvas pointer
  pipeline, selection, handles, transforms, guides, the numeric edits bar, dialogs that
  commit vector work, and the commands and their shortcuts. It also covers the store code they
  drive:
  - `src/ui/state/store-actions.ts` (history and interactions)
  - `selection-transform-actions.ts`, `undo-stack.ts`, `undo-history.ts`
  - `numbering-edit-guard.ts`, `guide-actions.ts`
  - the shortcut matchers in `src/ui/app/shortcuts.ts`, `arrange-shortcuts.ts`,
    `editing-tool-shortcuts.ts` and `nudge-step.ts`
  - `src/core/scene/selection-transform.ts` and `hit-test.ts`, as far as the commands use them

  Governing documents:
  - `WORKFLOW.md` F-A5 (Selection), F-A6 (Transform), F-A6h (named undo list, align keys),
    F-A6j (inches), F-A14 (Undo / Redo) and F-A15 (Keyboard shortcuts)
  - ADR-196 (selection movement vs geometry picking), ADR-410 (everyday editing tools),
    ADR-499 (undo list, align keys, nudge), ADR-609 (background vector work), ADR-592 and
    02-P2-1 (guarded setter)
  - The guides contract, which lives only in code and in commit `abaa1f6bb` (LightBurn
    parity D074). No ADR or WORKFLOW section covers guides.
- **Lenses run:** L1, L3, L4, L6 and L7, as separate passes in one session. L2 (ground truth)
  was run only for the outside facts this area depends on (browser key auto-repeat, pointer
  events). No LightBurn behaviour is used as an anchor, because none was checked against a
  primary source. L5 was skipped: the area has no trust boundary of its own. `.lfart` and
  remote/MCP edits belong to areas 02 and 01.
- **Counts:** 12 raised → 0 refuted (two sub-claims narrowed: P2-3 plain buttons, P3-5 pick
  order) → P1 0 / P2 4 / P3 7 (+ 1 KNOWN). Refuter: 11 CONFIRMED, 1 PLAUSIBLE (K-1), 0 REFUTED;
  no severity changes.

## Headline

History is a whole-project snapshot, and it holds up for ordinary commands. For 30 commands and
edge selections, Undo put back the identical `Project` object. Commands on an empty, locked or
hidden selection push nothing. Background vector, nesting, bitmap, array and joint-resize
results are refused once the project has changed.

The real faults are at the edges of the pointer and keyboard pipeline:

1. **Ruler guides.** A guide drag takes a second interaction snapshot *after* the guide already
   exists. A plain click on a ruler therefore leaves a hidden stray guide and a dirty project.
   Esc does not cancel a guide pull, and Undo never removes a pulled guide.
2. **Arrow keys in the Artwork panel.** Arrow keys on the panel's tabs, or on any button there,
   also nudge the selected artwork by 1 mm (10 mm with Shift). The jog keys stand down in that
   panel; the nudge does not.
3. **Esc during a draw drag.** Esc removes the dashed preview, but the shape is still created on
   release.
4. **Numeric Width/Height on a straight line.** The boxes refuse any selection with zero height
   or zero width, which includes every horizontal or vertical line, with the message "Numeric
   edit could not be applied." Dragging a handle on the same line works.

## Findings

### P2-1 — Guide drags snapshot twice: a ruler click leaves a stray guide, Esc keeps a pulled guide, and Undo never removes it

- **Where:**
  - `src/ui/workspace/guide-drag.ts:59-61`: `beginGuideDrag` calls `app.beginInteraction()`,
    then `setGuidesDuringInteraction([...guides, guide])`.
  - `src/ui/workspace/workspace-pointer-owner.ts:152-163`: `initializeDragSurface` calls
    `deps.beginInteraction()` again for every drag kind other than pan, draw, warp-handle,
    marquee and measure, `guide` included. Trace-part drags avoid this with
    `interactionStarted: true`; guide drags have no such flag.
  - The second snapshot replaces the first (`store-actions.ts:338-354`), so `pendingUndo.project`
    already contains the new guide.
  - `guide-drag.ts:89-91` ("Dropped back on a ruler … A new one never existed") calls
    `cancelInteraction()`, which restores that second snapshot.
- **Anchor:**
  - Contract: `guide-drag.ts:5-6` ("Each drag is one undo step, and a click on a ruler that
    creates nothing leaves no history"), `guide-actions.ts:1-3` and commit `abaa1f6bb`.
  - Contract: `WORKFLOW.md` F-A15 "Escape — Deselect / cancel current operation".
    `use-esc-cancels-drag.ts:53` lists `guide` as an Esc-cancellable drag.
- **Scenario:** Select tool, default view.
  1. Click the top ruler without moving. A horizontal guide is saved at the ruler's own position
     (−57 mm in the harness, hidden under the ruler strip). No undo step is added, and the project
     is marked dirty.
  2. Pull a guide down onto the canvas and press Esc. The guide stays, snapped back to the press
     position under the ruler.
  3. Pull a guide and release, then press Ctrl+Z. The guide only jumps back under the ruler.
     There is no undo step left that removes it. The only remedies are Window → Clear Guidelines,
     or dragging it out from under the ruler.
  Each stray guide keeps attracting snaps and is saved in the `.lf2`.
- **Evidence:** REPRO, using the real `useDragMove` hook and the real pointer owner.
  - Command:
    `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run src/ui/workspace/zz-08-hook.test.tsx --silent=false --reporter=verbose`
  - Output:
    ```text
    RULER CLICK -> guides [{"…","axis":"y","positionMm":-57.14}] undo 0 dirty true
    PULL+ESC   -> guides [{"…","axis":"y","positionMm":-57.14}] undo 0
    PULL       -> guides [{"…","positionMm":257.14}] undo 1
    PULL+UNDO  -> guides [{"…","positionMm":-57.14}] undo 0
    ```
  - Same result through `beginOwnedPointerDrag` alone (`zz-08-guide-drag.test.ts`).
  - L7: the existing `guide-drag.test.ts` (4/4 pass) calls `beginGuideDrag` and
    `finishGuideDrag` directly. It never goes through `initializeDragSurface`, so it cannot see
    the double snapshot.
- **Refuter:** CONFIRMED. My own repro mounted the real `useDragMove` plus `useShortcuts` (400 px
  canvas). It gave: ruler click → guide `y −23.53`, undo 0, dirty true; pull + Esc → guide back at
  `−23.53`; pull, release, Undo → guide at `−23.53`, undo 0. The control case works: moving an
  existing guide and pressing Esc restores it, because that path mutates nothing before the second
  snapshot. Code reading agrees: `beginOwnedPointerDrag` calls `createDrag` (which runs
  `beginGuideDrag`) and then `initializeDragSurface`. That excludes only pan, draw, warp-handle,
  marquee, measure and a pre-started move. Severity stays P2: ruler clicks are ordinary, and the
  stated contract (`guide-drag.ts:5-6`) is broken. After a zoom or pan, the stray guide sits at
  a real scene position that becomes visible and attracts snaps. No work is lost, so it is not P1.
- **Fix direction:** Give guide drags the trace-part treatment: mark the drag as having started
  its own interaction so `initializeDragSurface` skips it, or stop `beginGuideDrag` from calling
  `beginInteraction` itself. Add a hook-level test covering a ruler click, Esc and Undo.

### P2-2 — Numeric Width/Height refuse any selection with zero height or width, including every horizontal or vertical line

- **Where:**
  - `src/core/scene/selection-transform.ts:172-174` and `:202-204`: `hasDegenerateDimensions`
    rejects a resize when *either* extent is ≤ 1e-6 mm, even if only the other axis is being set.
  - `src/ui/commands/NumericEditsBar.tsx:118-125` turns that into
    `messageForError('degenerate-selection')`. That is the generic "Numeric edit could not be
    applied." (`:383-390`).
  - The multi-selection handle drag (`apply-transform-drag.ts:118-124`) silently does nothing on
    the same error.
- **Anchor:**
  - Contract: `WORKFLOW.md` F-A6 "Typed values … The X, Y, Width, Height … boxes take a number …
    Enter or leaving the box applies it". Only typing mistakes are refused, and those come with a
    notice saying what to type.
  - Twin: the single-object handle drag on the same line works (`handles.ts:206-207` treats a
    zero-length axis as factor 1).
- **Scenario:**
  1. Draw a horizontal line with the pen tool (Shift-constrained), or import a DXF/SVG `LINE`.
     W shows 30 and H shows 0.
  2. Type 50 in W and press Enter. A warning toast says "Numeric edit could not be applied." and
     nothing changes. The lock-aspect variant does the same.
  3. Selecting two collinear lines and dragging the selection's side handle does nothing, with no
     message.
  An ordinary job, such as score lines or a fixed-length cut line, cannot be sized numerically.
- **Evidence:** REPRO, `src/ui/workspace/zz-08-line-resize.test.ts` (same command form):
  ```text
  metrics {"bbox":{"minX":10,"minY":20,"maxX":40,"maxY":20},"width":30,"height":0,…}
  numeric W=50 -> {"kind":"error","reason":"degenerate-selection"}
  numeric W=50 locked -> {"kind":"error","reason":"degenerate-selection"}
  single handle drag e -> scaleX 1.6666666666666667 x -6.67
  multi handle drag e -> updates 0
  ```
- **Refuter:** CONFIRMED. My repro used the real `NumericEditsBar` on a `createPolyline` line from
  (10,20) to (40,20). The boxes show W 30 and H 0. W=50 + Enter, unlocked or locked, leaves scaleX
  1 and shows the toast "Numeric edit could not be applied." No ADR or test pins the
  `hasDegenerateDimensions` refusal (grep of `docs/decisions` and the tests). WORKFLOW F-A6 refuses
  only typing mistakes, with a reason. The pen's Shift constraint gives an exact `dy = 0` (`sin 0`),
  so drawn horizontal lines reach this path. LightBurn's Numeric Edits page
  (docs.lightburnsoftware.com/2.1/Reference/NumericEditsToolbar) says nothing about zero-height
  shapes, so there is no ground-truth anchor. The finding rests on the WORKFLOW contract and the
  single-handle twin. P2 stands, since it hits ordinary score and fixed-length lines. Nothing is
  lost, because the single-object handle drag works.
- **Fix direction:** Refuse only the axis being changed when that axis is degenerate. A width edit
  needs `width > 0`, and a height edit needs `height > 0`. With preserve-aspect on, scale both
  axes by the factor from the non-degenerate axis. Name the reason when a refusal is genuine.

### P2-3 — Arrow keys on Artwork-panel tabs and buttons also nudge the selected artwork (1 mm, or 10 mm with Shift)

- **Where:**
  - `src/ui/app/shortcuts.ts:437-444`: `handleTransformShortcut` skips only editable targets.
  - `nudge-step.ts:37-46` then `preventDefault`s and nudges.
  - `src/ui/layers/ArtworkEditorTabs.tsx:28-39` and `ArtworkPanelTabs.tsx:38-48` handle
    ArrowLeft/Right as an ARIA tablist, with `preventDefault` but no `stopPropagation`.
- **Anchor:**
  - Twin: `src/ui/common/keyboard-targets.ts:20-32` says arrow keys inside `.lf-artwork-panel`
    mean "scroll this", so window shortcuts must leave them alone. `use-jog-shortcuts.ts:66`
    honours that; the nudge does not.
  - Contract: `WORKFLOW.md` F-A15 Transform, "Arrow keys — Nudge", which describes a canvas
    action.
- **Scenario:**
  1. Select artwork. The Artwork panel shows its Operation/Artwork tabs.
  2. Keyboard-switch the tab with ArrowRight. The tab changes *and* the artwork moves 1 mm right,
     with an undo step "Move rectangle".
  3. Shift+ArrowRight on the Properties/Run order tabs moves it 10 mm.
  4. ArrowDown on any plain button in the panel moves the art 1 mm down, and the panel does not
     scroll.
  The move happens while the operator is looking at the panel. At fit zoom it is about 2 px on the
  canvas, and the next job burns that far off.
- **Evidence:** REPRO, using the real `useShortcuts` hook with the real tab components:
  `src/ui/app/zz-08-tab-arrows.test.tsx`
  ```text
  before: x 30 tabs layers/operation undo 0
  after ArrowRight on the Operation/Artwork tab: x 31 tabs layers/artwork undo 1
  after Shift+ArrowRight on the Properties tab: x 41 tabs run-order/artwork undo 2
  after ArrowDown on a plain button in the Artwork panel: y 41 defaultPrevented (panel cannot scroll) true
  ```
  READ: the CNC pane splitter (`use-cnc-pane-width.ts:84-86`, ArrowLeft/Right) has the same
  shape; it was not run.
- **Refuter:** CONFIRMED for the tabs, with the plain-button sub-claim narrowed. I mounted the real
  `CutsLayersPanel` (inside `.lf-artwork-panel`) next to the real `useShortcuts`.
  - ArrowRight on the Operation tab switched to Artwork and moved x 0 → 1, undo 1.
  - Shift+ArrowRight on Properties switched to Run order and moved x → 11, undo 2.
  - A mouse user who clicks the Artwork tab and then presses ArrowLeft to nudge gets the nudge and
    also an unwanted switch back to Operation.

  No ancestor stops the key. `WorkspaceSidePanels` handles keys only on its own tab buttons,
  `keyboardOwnedElsewhere` covers only modals and text sessions, and `handleTransformShortcut`
  never checks `defaultPrevented`. WORKFLOW (Artwork inspector) says "Both levels of tabs support
  arrow keys, Home and End", so one key doing two things breaks a contract.

  The plain-button part is not a defect. ADR-493 decision 6 keeps "Bare arrows still nudge the
  selection (F104)". The `isScrollRegionTarget` rule is written for machine moves, not the nudge.
  The fix should therefore skip events already `defaultPrevented` (or tab/slider targets), not
  every `.lf-artwork-panel` target.

  P2 stands as a broken contract with a clear failure: keyboard tab navigation shifts the burn
  position by 1 or 10 mm. It is not P1, because the move is drawn and has a named undo step.
- **Severity note:** this is P2 rather than P1 because the moved position is drawn on the canvas
  and undoable. The coordinator may weigh METHOD's "silently produces wrong physical output
  (position)".
- **Fix direction:** Leave arrow keys alone in the transform handler when
  `isScrollRegionTarget(e.target)` is true, or when the event was already `defaultPrevented`.
  Alternatively, have the tablists stop propagation.

### P2-4 — Esc during a rectangle/ellipse/polygon/star drag hides the preview, but the shape is still created on release

- **Where:**
  - `src/ui/workspace/use-esc-cancels-drag.ts:43-58`: `draw` is not Esc-cancellable. The comment
    says draw keeps "the existing global Esc (resetToolMode) behavior".
  - The global Esc (`shortcuts.ts:330-337`) clears `draftShape` and the tool, but the React drag
    stays `kind: 'draw'`.
  - The next move re-creates the draft (`workspace-drag-updates.ts:66-69`), and pointer-up runs
    `commitDrawDraft` (`use-workspace-drag.ts:357-360` → `workspace-drag-updates.ts:123-135` →
    `draw-tool.ts:96-106`).
- **Anchor:** Contract: `WORKFLOW.md` F-A15 "Escape — Deselect / cancel current operation", and
  the intent stated at `use-esc-cancels-drag.ts:44-45`.
- **Scenario:**
  1. Ctrl+R, then start dragging a rectangle.
  2. Press Esc while the button is still down. The dashed preview disappears and the tool shows
     Select.
  3. Release. A rectangle is added as one undo step.
- **Evidence:** REPRO, `zz-08-hook.test.tsx` (real hook):
  ```text
  DRAW after Esc: tool select draft false
  DRAW+ESC+UP -> objects 1 undo 1
  ```
  Also with the real functions only, in `zz-08-draw-esc.test.ts`.
- **Refuter:** CONFIRMED. My repro used the real `useDragMove` plus the real `useShortcuts` global
  Esc, with a rectangle tool drag.
  - After Esc the tool is Select, the draft is cleared, and the drag is still live.
  - Pointer-up with no move after Esc → objects 1, undo 1.

  Pointer-up runs `commitDrawDraft`, which calls `updateDrawDraft` again. That rebuilds the draft
  from the React drag, ignoring the tool mode, and commits it, so no move is needed. No ADR makes
  draw non-cancellable. The `use-esc-cancels-drag.ts:44-45` comment expects the global Esc to
  cancel. ADR-597 (remote canvas) states the same rule: "Escape first cancels an active gesture".

  P2 stands: Esc mid-drag is ordinary, and the vanished preview tells the user the shape was
  cancelled. The shape is visible after release and takes one Undo, so nothing is lost.
- **Fix direction:** Add `draw` (and `measure`) to the Esc-cancellable kinds so that Esc clears
  the React drag as well as the draft.

### P3-1 — Keyboard edits during a live drag are not refused: Ctrl+Z leaves the rest of the drag unrecorded, and a Delete merges into the drag or is silently undone by Esc

- **Where:**
  - `src/ui/state/store-actions.ts:161-171`: Undo while `pendingUndo` is set restores the
    snapshot ("cancels that uncommitted gesture").
  - Nothing in `use-workspace-drag.ts` or `workspace-pointer-owner.ts` ends the pointer drag when
    that happens, so later moves call `setObjectTransform`, and `endInteraction`
    (`:362-372`) finds no snapshot and records nothing.
  - Other edits (Delete, nudge, flip) pass `handleEditShortcut` / `handleTransformShortcut` during
    a drag. `endInteraction` then rebuilds the undo stack from the snapshot's stack, dropping
    their steps, and `cancelInteraction` discards them.
- **Anchor:**
  - Contract: `store-actions.ts:162` comment, and `WORKFLOW.md` F-A14 (each action one undo
    step).
  - Twin: remote edits are refused while `pendingUndo` is set (`remote-control/adapter.ts:274`),
    and the numbering guard refuses edits during its interaction (`numbering-edit-guard.ts`).
- **Scenario:**
  1. Nudge object B (step "Nudge").
  2. Drag A, press Ctrl+Z with the button held, keep moving, release.
  3. A ends up moved with no step of its own. The only step left reads "Move 2 objects", and one
     Undo reverts both B's nudge and A's drag.
  Separately: start a drag, press Delete, then press Esc. The deletion is reverted with nothing in
  Undo or Redo.
- **Evidence:** REPRO, `zz-08-hook.test.tsx` (real hook):
  ```text
  MOVE+UNDO -> r1.x 50 r2.x 125 undo depth 1
  then Undo -> r1.x 20 r2.x 120
  ```
  Store level, `src/ui/state/zz-08-drag-interleave.test.ts`:
  ```text
  after Delete mid-drag: objects a undo depth 1
  after Esc: objects a,b … undo depth 0 redo 0
  ```
- **Refuter:** CONFIRMED. My repro used the real hook and `useShortcuts`.
  - Nudge r2, drag r1, press Ctrl+Z mid-drag, keep moving, release: r1.x 50, r2.x 125, undo 1.
    One Undo then reverts both (20 / 120).
  - Drag, press Delete, then Esc: objects a,b, undo 0, redo 0.

  P3 is right: this needs a keyboard edit while the mouse button is held, which is unusual.
- **Fix direction:** While a canvas drag owns `pendingUndo`, either refuse document-changing
  shortcuts (as remote and numbering already do), or have Undo also end the pointer drag through
  `clearDrag`.

### P3-2 — Holding an arrow key creates one undo step per auto-repeat, and about 2 s evicts the whole 50-step history

- **Where:** `src/ui/app/nudge-step.ts:37-46` ignores `e.repeat`. Every repeat calls
  `nudgeSelection`, which pushes a step (`selection-transform-actions.ts:350-354`).
  `HISTORY_DEPTH = 50` (`undo-stack.ts:10`).
- **Anchor:**
  - Twin: `arrange-shortcuts.ts:5-9,36`. The align keys drop `e.repeat` so that "one press is
    one undo step".
  - Contract: `WORKFLOW.md` F-A14 (50-step history).
  - Ground truth: browsers send `keydown` with `repeat: true` at the OS repeat rate, typically
    about 30 per second on Windows. This rate was not measured here.
- **Scenario:** Delete an object by mistake, then hold → for about 2 s to slide other artwork. The
  60 nudges fill the history, and the deletion can no longer be undone.
- **Evidence:** REPRO, `zz-08-drag-interleave.test.ts -t holding`:
  ```text
  arrow held for 60 repeats: handled 60 undo depth 1 -> 50 ; after undoing everything, b restored? false
  ```
- **Refuter:** CONFIRMED. With `useShortcuts`, deleting b and then sending 60 ArrowRight keydowns
  (`repeat: true` after the first) moved a to x 60 and filled the history to 50. b could not be
  restored. ADR-499 Consequences says "Each nudge press is still its own undo step", so one step
  per *press* is a recorded decision. Auto-repeat is not addressed there. The fix should coalesce
  a held run into one step rather than drop repeats, because holding an arrow to slide artwork is
  ordinary use. P3 stands.
- **Fix direction:** Fold a run of repeated nudges into one step (coalesce while `e.repeat`
  holds), or step once per press as the align keys do.

### P3-3 — Rotated round or irregular artwork is measured by its rotated bounds rectangle: false canvas out-of-bed outline, oversized W/H, and Move to bed leaves a gap

- **Where:**
  - `src/core/scene/hit-test.ts:255-293`: `transformedBBox` and `combinedBBox` use the corners
    of the local bounds rectangle.
  - Consumers: `src/ui/workspace/out-of-bounds.ts:11-15` (red dashed outline and preview banner),
    `NumericEditsBar.tsx:116`, and `selection-placement.ts:56-78` (Move to bed). Align and
    distribute work the same way.
- **Anchor:** Twin. Preflight checks the emitted G-code coordinates (`preflight.ts:293`), so the
  canvas says "out of bed" for work that preflight accepts.
- **Scenario:** Rotate a 100 mm circle (or an irregular logo) by 45° and place its geometry at
  x = 2…102 mm on a 400 mm bed.
  - The canvas draws the red out-of-bed outline.
  - W reads 141.42.
  - Move to bed → Left leaves the geometry 20.74 mm from the edge.
  - Typing W = 100 makes the circle 70.7 mm.
- **Evidence:** REPRO, `zz-08-loose-bbox.test.ts`:
  ```text
  geometry box {"minX":2,…,"maxX":101.97}
  canvas/bounds box {"minX":-18.74,…,"maxX":122.68}
  numeric W shown 141.42 geometry width 99.97
  canvas out-of-bed outline (bed 400x400)? true
  Move to bed -> Left: geometry minX 20.74
  ```
- **Refuter:** CONFIRMED. My repro used a 100 mm ellipse at 45°, with its geometry placed at
  x 2…101.97.
  - `transformedBBox` gives −18.74…122.68 (W 141.42), and `isObjectOutOfBed(…, 400, 400)` is true.
  - `moveSelectionToBed('w')` leaves the geometry at minX 20.74.

  No ADR chooses loose rotated bounds. The `transformedBounds` comment is about not
  *understating* bounds, not about over-reporting. LightBurn's rotated W/H is still unverified, so
  only the out-of-bed and Move to bed parts are firmly wrong. P3 stands, since preflight is the
  real gate.
- **Fix direction:** At least make the out-of-bed outline and banner use transformed geometry
  extents, matching preflight. Decide, and record in an ADR, whether W/H, align and Move to bed
  use geometry bounds.

### P3-4 — Handle-drag scale pivot follows the 9-dot anchor for one object but not for a multi-selection

- **Where:**
  - `src/ui/workspace/drag-state.ts:401-411` passes `selectionAnchor` to
    `scaleObjectByHandleDrag`, and `handles.ts:78-110` uses it as the pivot when it can.
  - The multi-selection drag (`selection-handles.ts:57-66`) always pins the opposite corner or
    edge.
- **Anchor:**
  - Contract: `WORKFLOW.md` F-A6 Scale: "Ctrl/Cmd+drag: scale from center instead of opposite
    edge", which implies the opposite edge is the default.
  - Twin: single-object and multi-object handles behave differently.
  - The picker's tooltip (`TransformAnchorPicker.tsx:52`) calls the anchor the "resize anchor",
    which agrees with neither rule.
- **Scenario:** Set the 9-dot to centre, for example to type a centre X/Y. A plain corner drag on
  one object now scales about its centre (x 20 → −10), while the same drag on two objects pins the
  top-left corner.
- **Evidence:** REPRO, `zz-08-hook.test.tsx`:
  ```text
  ONE object se-drag, anchor c -> x -10.00 y 0.00 scale 2.000
  TWO objects se-drag, anchor c -> r1.x 20.00 r1.y 20.00 scale 1.500
  ```
- **Refuter:** CONFIRMED. My repro used the real hook with anchor `c`.
  - One object, `se` drag: x/y 20 → −20, scale 3.
  - Two objects, `se` drag: r1 stays at (20, 20), scale 1.444.

  The single-object anchor pivot came in commit `1459d87dd` with a test, but no ADR records it, and
  WORKFLOW F-A6 still says "scale from center instead of opposite edge" for Ctrl only. The two paths
  disagree. P3 stands.
- **Fix direction:** Pick one rule for handle drags (WORKFLOW's opposite edge, with Ctrl for the
  centre), apply it to both paths, and fix the tooltip.

### P3-5 — Object picking uses a fixed 2 mm tolerance at every zoom; handles, nodes and snaps are sized in pixels

- **Where:**
  - `src/core/scene/hit-test.ts:20,80,182`: `VECTOR_STROKE_HIT_TOLERANCE_MM = 2`, with the
    topmost candidate in range winning.
  - By contrast, `handles.ts:61-62`, `selection-move-handle.ts:21` and node/segment hits all use
    `pxToMm`.
  - Handles are resolved before the move handle (`drag-state.ts:187-196`).
- **Anchor:**
  - Twin: pixel-sized handles, nodes and snaps against fixed-millimetre artwork picking.
  - Contract: ADR-196 ("precise vector selection"; a move handle that is "stable across zoom").
- **Scenario:**
  - At zoom 16 (1 px = 0.034 mm), a click exactly on a lower line 1.5 mm below another line
    (44 px apart on screen) selects the upper line.
  - At zoom 0.1 the tolerance is 0.4 px, so an open line is practically unclickable.
  - At fit zoom, a press in the middle of a selected 3 mm part grabs the `nw` scale handle instead
    of moving it.
  Alt+click cycling is the workaround for the first case.
- **Evidence:** REPRO, `zz-08-hit-zoom.test.ts`:
  ```text
  zoom 0.1: … 2 mm tolerance = 0.4 px
  zoom 16:  … 2 mm tolerance = 59.2 px; gap between lines = 44.4 px
  click exactly on lower line -> upper
  zoom 1 (5.6 px object, 3 mm): press at centre -> scale nw
  ```
- **Refuter:** CONFIRMED, narrowed.
  - `hitTest` with lines at y 50 and 51.5 (upper on top): a press exactly on the lower line returns
    `upper`. A lone line is hit at 1.9 mm and missed at 2.1 mm, whatever the zoom.
  - The fixed millimetre tolerance is real and no ADR chooses it. With a pixel tolerance, the
    zoom-16 case would pick the lower line.
  - Two sub-claims are deliberate, by DECISIONS.md ADR-196: topmost-first among direct hits ("Direct
    geometry candidates remain topmost-first", with Alt+click cycling), and scale/rotate handles
    resolved before the move handle.

  The fix should change only the tolerance unit, not the pick order or the handle precedence. P3
  stands.
- **Fix direction:** Express the stroke tolerance in screen pixels (pass `pxToMm` into `hitTest`),
  and prefer the nearest stroke over the topmost one within that tolerance. Let the move handle
  win over scale handles when a selection is smaller than about two handles.

### P3-6 — No-op transforms still add an undo step and mark the project dirty

- **Where:** `src/ui/state/selection-transform-actions.ts:339-349`. `changed = true` is set for
  every unlocked, visible object that has an edit, even when its transform is identical.
- **Anchor:** Twin: `endInteraction` skips unchanged drags (`store-actions.ts:365`), and a
  repeated Align adds no step. Move to bed, rotate-by and the numeric boxes do add one.
- **Scenario:**
  - A second Arrange → Move to bed → Centre adds an empty "Move" step and sets dirty, so closing
    prompts to save.
  - Typing 370 in R on a 10° object adds a step, and the 360° turn moves the origin by about
    1e-14 mm.
- **Evidence:** REPRO, `src/ui/state/zz-08-undo-roundtrip.test.ts`:
  ```text
  second Move to bed centre: same content true undo 1
  R=370 on 10deg: … undo 1 dirty true
  {"name":"applySelectionTransforms identical","sameContent":true,"steps":1,"dirty":true,…}
  ```
- **Refuter:** CONFIRMED. A second `moveSelectionToBed('c')` gave the same transform, +1 step and
  dirty true. As a control, a single-object Align pushed 0 steps. The code agrees:
  `applySelectionTransformsToState` sets `changed = true` without comparing transforms. P3 stands.
- **Fix direction:** Set `changed` only when the transform differs, and normalise a whole-turn
  rotation delta to zero.

### P3-7 — Esc in a numeric edits box keeps the typed value, and leaving the box applies it

- **Where:** `src/ui/commands/NumericEditsBar.tsx:297-308` has no Escape branch, and
  `onBlur={commitIfEdited}` (`:325`) applies the draft.
- **Anchor:**
  - Twin: `NodeCoordinateControls.tsx:143-146` and `CompoundNumberField.tsx:47-50` discard the
    draft on Escape.
  - Contract: `WORKFLOW.md` F-A15 "Escape — … cancel current operation".
- **Scenario:** Type 200 in W, press Esc to abandon, click the canvas. The selection is resized
  ×10.
- **Evidence:** REPRO, `src/ui/commands/zz-08-numeric-esc.test.tsx`:
  ```text
  after Escape: box shows 200 scaleX 1
  after blur: scaleX 10 undo 1
  ```
- **Refuter:** CONFIRMED. With the real `NumericEditsBar`, I typed 200 in W and pressed Escape: the
  box shows 200, scaleX 1 and the selection is kept. On blur, scaleX becomes 10, undo 1. The global
  Esc stands down for INPUT targets (`isEditableTarget`), so nothing else resets the draft.
  WORKFLOW F-A6 has no Esc rule for these boxes, but both sibling fields discard on Esc. P3 stands.
- **Fix direction:** On Escape, restore the shown value (`setDraft(shown)`) and stop
  propagation, as the sibling fields do.

### KNOWN

#### K-1 (P3, class of 02-P2-1) — Three more raw `useStore.setState` writers skip the store's guarded setter

- **Where:**
  - `src/ui/commands/use-joint-resize-review.ts:65` and `src/ui/commands/use-stamp-work.ts:162`
    wrap `useStore.setState` only in `proOperationMutationSetter`.
  - `src/ui/workspace/registration-jig/use-jig-editor.ts:151` calls `useStore.setState`
    directly.
  - The store's own `set` adds three guards (`store.ts:425-433`): `freeProArtworkSetter`,
    `numberingEditGuardSetter` and `reliefLinkMutationSetter`.
- **Anchor:** Contract: ADR-592 decision 5. Twin: `numbering-edit-guard.ts:1-8` ("a menu or
  Ctrl+K command … would land inside that interaction and Cancel would silently throw it away").
- **Scenario:** These sites skip all three guards.
  - Without Pro, Joint resize can change the artwork of a V-carve layer. This is the same Pro
    bypass class as 02-P2-1.
  - A Joint resize or Stamp applied while Run order → Number on canvas is open lands inside
    numbering's interaction. Numbering Cancel then discards it without notice, and Done folds it
    into the numbering step.
  - A relief linked to a resized vector is not refreshed in the same step.
- **Evidence:** READ only. 02-P2-1 reproduced the class at `personal-artwork-actions.ts:62`.
- **Refuter:** PLAUSIBLE (not reproduced). I read all three sites.
  - `use-joint-resize-review.ts:65` and `use-stamp-work.ts:162` pass `useStore.setState` to
    `proOperationMutationSetter`. That setter checks only newly introduced Pro features, not
    `changedProArtworkFeature`.
  - `use-jig-editor.ts:151` calls `useStore.setState` directly.
  - The store's `set` composes `numberingEditGuardSetter(reliefLinkMutationSetter(freeProArtworkSetter(rawSet)))`.
    No command in `src/ui/commands` stands down during numbering.
- **Known:** class KNOWN as 02-P2-1. These call sites are new, and so are the numbering and
  relief-link consequences.
- **Fix direction:** Fix together with 02-P2-1: route these commits through a store action, so
  they get the composed setter.

## Refuted

No finding was refuted outright. Two sub-claims were refuted, and their findings narrowed:

- **P2-3, plain buttons:** "ArrowDown on any plain button in the panel moves the art, and the
  panel does not scroll" is decided behaviour. ADR-493 decision 6 says "Bare arrows still nudge the
  selection (F104)". `isScrollRegionTarget` is documented for machine-moving keys, not the nudge.
  Only the tab double action (tab switch plus nudge) breaks a contract.
- **P3-5, pick order and handle precedence:** topmost-first among direct geometry hits (with
  Alt+click cycling) and scale/rotate handles resolving before the move handle are both
  DECISIONS.md ADR-196 decisions. Only the fixed millimetre tolerance stands.

Candidates the auditor dropped before raising:

- **Switching or adding a project sheet clears Undo history** (`project-sheet-actions.ts:91-104`
  via `setProject`). Dropped: no contract covers sheets and history, and WORKFLOW F-A14 clears
  history on every document replacement.
- **A right-to-left crossing marquee selects a hollow frame by its bounding box.** Dropped:
  F-A5 defines enclosing by bounding box, and "touched" for crossing is ambiguous.
- **Ctrl+S while typing in a numeric box saves without the uncommitted draft.** Dropped:
  conventional behaviour, and the dirty flag stays set.
- **The rotate handle can sit under the top ruler, where a press starts a guide instead.**
  Dropped: no contract, and the scenario is rare. Noted only.

## Verified clean

- **Undo exactness.** For each command below, run on a three-object fixture, Undo restored the
  identical `Project` object and Redo restored the post-command object: nudge, flip, quarter turn,
  rotate-by, align, distribute, Move to bed, group, duplicate, cut, copy+paste, delete, lock,
  subtract, offset, convert to path. Copy and select-all push nothing. History is a
  whole-project snapshot (`undo-stack.ts`, `store-actions.ts:157-218`). The 50-step and 256 MB
  caps apply to Undo and Redo alike.
- **Edge selections.** Delete, flip, group, ungroup, lock, duplicate, cut, quarter turn, weld and
  offset on an empty selection, single-object group/ungroup/align, paste with an empty clipboard
  and a delete of a stale id all leave the project and history untouched. Locked and hidden
  objects are filtered out of the selection (`scene-group-actions.ts:216-243`) and out of every
  transform (`selection-transform-actions.ts:365-372`).
- **Async stale apply.**
  - Background one-click vector commands (`background-vector-command.ts:97-105`), dialog
    previews (`use-vector-op-preview.ts:67-70`) and offset reuse of prepared results compare the
    source and project.
  - Quick Nest accept (`nest-actions.ts:64-88`), Convert to Bitmap (`bitmap-conversion.ts:35-49`),
    arrays (`ArrayDialogHost.tsx:114-190`), the boolean dialog, joint resize and stamp check
    project and epoch identity.
  - The jig editor rebases or refuses.
- **Shortcuts in inputs and dialogs.**
  - Edit, Tool, Transform, View, Arrange and editing-tool matchers all return early on editable
    targets (`keyboard-targets.ts:1-8` covers INPUT, TEXTAREA, SELECT, contenteditable and
    role=textbox).
  - Every kit `Dialog` registers `modalDepth`, and `keyboardOwnedElsewhere` stands all shortcuts
    down in it and during a canvas text session.
  - Open menus stop propagation and keep Ctrl+. (Abort) reachable.
  - Only File shortcuts (Ctrl+N/O/S/I) fire inside an input, which is conventional.
- **Esc rollback** for move, scale, selection-scale, rotate, path-node, path-segment, cnc-tab,
  laser-tab, marquee and pan drags, through `cancelWorkspaceDrag`. Existing hook tests C4 and pan
  confirm it, and read-through confirms the rest.
- **Units in typed values** (`evaluateNumericEntry`):
  - In an inch box, `1` is 25.4 mm, `1/2` is 12.7, `10mm` is 10, `1+10mm` is 35.4 and `50%`
    takes the current mm size.
  - In mm, `1in` and `1"` are 25.4.
  - `1e400` and `1,5` are refused with reasons, and angle boxes refuse lengths.
  - W/H of 0 or below is refused with "Width and height must be greater than 0".
- **Pivots.**
  - Rotate handle: the object's centre, or the combined centre for a multi-selection.
  - Numeric rotate, quarter turn, flip and shear: the selection's centre. Four quarter turns use
    integer swaps only.
  - Numeric resize and move: the 9-dot anchor.
  - Rotation 0/90/360 normalises; a 360° turn drifts by about 1e-14 mm only.
- **Remote and numbering exclusion.** Remote edits are refused while any interaction is held, and
  the numbering guard refuses history-changing store edits during numbering. Gaps: K-1 for raw
  setState writers, and P3-1 for local keys.
- **Pointer ownership.** One captured pointer owns a drag (`workspace-pointer-owner.ts`).
  Pointer cancel and lost capture roll back. A document replacement clears the live drag
  (`use-workspace-pointer-state.ts:181-191`).

## Not verified

- **Real browser and Electron pointer behaviour.** Alt+Tab or a window blur mid-drag, touch and
  pen input, and high-DPI bitmap scaling of handle sizes. All runs used jsdom with synthetic
  pointer events.
- **LightBurn reference behaviour** for rotated-shape W/H (P3-3), the handle-scale pivot (P3-4)
  and nudge coalescing (P3-2). No primary source was fetched, so none is used as an anchor.
- **The Free-mode consequence of K-1.** It was not reproduced with the edition locked. The
  numbering and relief-link consequences are read only.
- **Out of scope here:**
  - Canvas text editing (area 15)
  - Design Studio (area 25)
  - Image editor (area 23)
  - CNC/laser tab editors beyond their Esc and undo wiring
  - Start-point drags (ADR-594), only skimmed
  - Preview and preparation workers, which write no document state
  - Remote and MCP authoring (area 01)

Repro files (deleted from the worktree as instructed) are kept in this session's scratchpad:
`C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\repros-08\`.
Each keeps its repo path, so copy it back next to the code and run
`NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run <file> --silent=false --reporter=verbose`.

```json
[
  {"id":"P2-1","severity":"P2","area":"canvas-commands","file":"src/ui/workspace/workspace-pointer-owner.ts","line":162,"anchor":"Contract guide-drag.ts:5-6 / guide-actions.ts:1-3 / commit abaa1f6bb; WORKFLOW F-A15 Escape","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Guide drags snapshot twice (beginGuideDrag + initializeDragSurface): a ruler click leaves a hidden stray guide and dirty project, Esc keeps a pulled guide, Undo never removes it"},
  {"id":"P2-2","severity":"P2","area":"canvas-commands","file":"src/core/scene/selection-transform.ts","line":172,"anchor":"Contract WORKFLOW F-A6 typed values; Twin single-object handle drag","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Numeric W/H refuse any zero-height or zero-width selection (every horizontal/vertical line) with 'Numeric edit could not be applied.'; multi handle drag silently no-ops"},
  {"id":"P2-3","severity":"P2","area":"canvas-commands","file":"src/ui/app/shortcuts.ts","line":437,"anchor":"Twin keyboard-targets.ts:20-32 isScrollRegionTarget / use-jog-shortcuts.ts:66; WORKFLOW F-A15","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Arrow keys on Artwork-panel tabs and buttons also nudge the selected artwork 1 mm (10 mm with Shift), with an undo step; panel cannot scroll"},
  {"id":"P2-4","severity":"P2","area":"canvas-commands","file":"src/ui/workspace/use-esc-cancels-drag.ts","line":46,"anchor":"Contract WORKFLOW F-A15 Escape cancels current operation; use-esc-cancels-drag.ts:44-45 intent","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Esc during a draw drag hides the preview and resets the tool, but release still creates the shape"},
  {"id":"P3-1","severity":"P3","area":"canvas-commands","file":"src/ui/state/store-actions.ts","line":162,"anchor":"Contract store-actions.ts:162, WORKFLOW F-A14; Twin remote adapter.ts:274 and numbering-edit-guard","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Edits during a live drag are not refused: Ctrl+Z leaves the rest of the drag unrecorded (merged into the previous step); Delete merges into the drag or is silently reverted by Esc"},
  {"id":"P3-2","severity":"P3","area":"canvas-commands","file":"src/ui/app/nudge-step.ts","line":37,"anchor":"Twin arrange-shortcuts.ts:5-9,36 (e.repeat); WORKFLOW F-A14 depth 50","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Held arrow key pushes one undo step per auto-repeat; ~2 s evicts the 50-step history"},
  {"id":"P3-3","severity":"P3","area":"canvas-commands","file":"src/ui/workspace/out-of-bounds.ts","line":11,"anchor":"Twin preflight.ts:293 G-code bounds vs transformedBBox","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Rotated round/irregular art measured by rotated bounds rectangle: false out-of-bed outline, W 141 for a 100 mm circle, Move to bed leaves 20.7 mm gap"},
  {"id":"P3-4","severity":"P3","area":"canvas-commands","file":"src/ui/workspace/drag-state.ts","line":409,"anchor":"Contract WORKFLOW F-A6 Scale (opposite edge, Ctrl centre); Twin selection-handles.ts:57-66","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Handle-drag scale pivot follows the 9-dot anchor for one object but not for a multi-selection"},
  {"id":"P3-5","severity":"P3","area":"canvas-commands","file":"src/core/scene/hit-test.ts","line":20,"anchor":"Twin pxToMm-sized handles/nodes/snap; Contract ADR-196","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Object picking uses a fixed 2 mm tolerance at every zoom (59 px at zoom 16, 0.4 px at 0.1); small selected parts grab a scale handle instead of moving"},
  {"id":"P3-6","severity":"P3","area":"canvas-commands","file":"src/ui/state/selection-transform-actions.ts","line":344,"anchor":"Twin store-actions.ts:365 endInteraction no-op skip; repeated Align","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"No-op transforms (repeat Move to bed, R=370 on 10 deg, identical edits) push an empty undo step and set dirty"},
  {"id":"P3-7","severity":"P3","area":"canvas-commands","file":"src/ui/commands/NumericEditsBar.tsx","line":297,"anchor":"Twin NodeCoordinateControls.tsx:143-146, CompoundNumberField.tsx:47-50; WORKFLOW F-A15 Escape","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Esc in a numeric edits box keeps the typed draft; leaving the box applies it"},
  {"id":"K-1","severity":"P3","area":"canvas-commands","file":"src/ui/commands/use-joint-resize-review.ts","line":65,"anchor":"Contract ADR-592 decision 5; Twin numbering-edit-guard.ts:1-8, store.ts:425-433","evidence":"READ","verdict":"PLAUSIBLE","known":"class KNOWN: 02-P2-1 (new call sites use-joint-resize-review.ts:65, use-stamp-work.ts:162, registration-jig/use-jig-editor.ts:151)","summary":"Raw useStore.setState writers skip freeProArtworkSetter, numberingEditGuardSetter and reliefLinkMutationSetter"}
]
```
