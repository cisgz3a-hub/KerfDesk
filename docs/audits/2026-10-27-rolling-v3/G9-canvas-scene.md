# Rolling audit v3 — Canvas and scene

- **When:** 2026-10-27   **Tree:** origin/main @ `9a2bf6b13` (the audit worktree's `src` is
  identical: `git diff --stat 9a2bf6b13 HEAD -- src` is empty)
- **Scope:**
  - Paths: `src/ui/workspace`, `src/ui/commands`, `src/core/scene`, `src/core/text`, `src/ui/text`.
    Followed into `src/ui/app/nudge-step.ts`, `src/ui/state/selection-transform-actions.ts`,
    `src/core/job/compile-job-raster.ts`, `src/core/raster/image-processing.ts`,
    `src/io/gcode/variable-text-anchor.ts` and `src/ui/state/board-*` only to trace twins.
  - Merges: `git log --first-parent --since=2026-10-21T00:00 9a2bf6b13 -- <paths>` lists 30. Read in
    full (non-test diff): #1357 (ADR-499 Amd 1), #1359, #1362 (ADR-654 canvas side and the
    #1384/ADR-653 Amd 2 repairs it carried), #1425 (ADR-653 Amd 3), #1346 (jig save through
    `commitProjectEdit`), #1344, #1350, #1341, #1292, #1365, #1352, #1351, #1287 (inch rulers,
    hover and measure readouts), #1322/#1325 (edit glow), #1330, #1308, #1442, #1443, #1329, #1420.
    #1419 and #1361 touch no scoped file; #1419 was read for the jig save path. #1290/#1273/#1295
    (hover pulse) merged on 2026-10-19, before the window, and were only skimmed.
  - Governing: WORKFLOW F-A6, F-A15, F-B15a; ADR-499 + Amd 1; ADR-606; ADR-652; ADR-653 Amd 2–3;
    ADR-654; ADR-670; ADR-671; ADR-028 Amd 1.
- **Lenses run:** L8 (siblings of every #1357, #1384 and #1425 fix, and the #1357/#1362 and
  #1357/#1425/#1287 conflict resolutions), L3 (canvas and Preview against compiled output, jig
  against main canvas, single object against selection), L4 (zero-extent and flat selections,
  empty selection, held keys, Escape mid-gesture, Unicode text paths already covered by rolling-v2
  area 15), L7 (what the #1357 and #1384 tests exercise). L1, L2, L5 and L6 were not run as separate
  passes. No hardware was operated.
- **Counts:** 5 raised → 0 refuted → P1 0 / P2 1 / P3 4 (+1 KNOWN severity correction, confirmed:
  15-P2-1 was P1). Refuter: 5 CONFIRMED, 0 PLAUSIBLE, 0 REFUTED; no severity changes to raised
  findings.

## Headline

The #1357 fixes for rolling-v2 area 08 hold on the main canvas: Escape during a draw, ruler guides,
flat selections, arrow keys on tab strips and the held-arrow undo step all behave as ADR-499
Amendment 1 says, and the #1357/#1362 and #1357/#1425 merges kept both sides. The registration jig
editor, which has its own keyboard and gesture code, got none of the matching fixes: it nudges 1 mm
for Ctrl+arrow, records one undo step per auto-repeat, adds a no-op step (and a no-op main-canvas
undo step on Save) for an arrow with nothing selected, and keeps dragging through Escape.

The one P2 is a Preview twin from #1442. The Preview raster cache key never includes the ADR-670
tone curve, so after a calibration is applied the Preview keeps showing the uncalibrated burn while
the G-code uses the curve. ADR-670 says Preview shows the calibration.

No position error that only a Frame would reveal was found in this area. The one such defect in
area 15 (15-P2-1) is fixed, but it was rated against the old Frame rule (see KNOWN).

## Findings

### G9-P2-1 — Preview keeps the uncalibrated raster after a tone curve is applied; the cache key omits `photoToneCurve`

- **Where:**
  - `src/ui/workspace/draw-raster-preview.ts:158-167`: `previewSettingsKey` covers adjustments,
    Negative, pass-through, dither, power range, density, grid, scan angle, transform and mask. It
    has no tone-curve term.
  - `src/ui/workspace/draw-raster-preview.ts:306-308`: #1443 added ADR-671 sharpening to
    `adjustmentKey` ("sharpening rewrites burn pixels too, so it keys the cached canvas"). #1442
    added the curve to the same build path without a key term.
  - `src/core/job/compile-job-raster.ts:160` → `src/core/raster/image-processing.ts:17-28`: the
    build and the G-code both pass `layer.photoToneCurve` (the effective operation, so an object
    override too) through `prepareImageLuma`.
- **Anchor:**
  - Contract: ADR-670, "Verification and limits": "the canvas, Photo engraving preview, Preview and
    G-code do." That is, they show a calibration. ADR-670 Decision item 5 says every path that
    starts from `prepareImageLuma` burns "the same corrected tones".
  - Twin: Preview build (`compileRasterGroupsForLayer`) against emitted raster S values.
  - L8: rolling-v2 `20-raster.md:275-278` verified this key as covering every setting that changes
    the S grid. #1442 broke that; #1443 kept it for its own field.
- **Scenario:** Open Preview on a photo with a Grayscale (or any dither) Image operation, leave
  Preview, apply a measured tone curve to the operation (or change it), open Preview again. The key
  is unchanged, so the cached canvas from before the curve is drawn. Preview shows the old tones; the
  G-code burns the corrected tones. The stale entry stays until some keyed setting or the pixels
  change, or the app restarts. An operator comparing Preview before and after calibrating sees no
  effect and may "correct" it with brightness or contrast, which then burns doubly corrected.
- **Evidence:** REPRO. The real `drawRasterPreview` with the repo's own preview test support
  (`raster-preview.test-support.ts`), one 8×4 raster, Grayscale, valid curve
  (0→0, 128→64, 255→255):
  - Command:
    `NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run src/ui/workspace/zz-g9-tone-preview.test.ts --silent=false --reporter=verbose`
  - Output:
    ```text
    builds 1 draws 2
    compiled burn without curve [255,255,255,255,177,150,150,255,...,177,203,229,255]
    compiled burn with curve    [255,255,255,255,163,150,150,255,...,163,177,216,255]
    canvas preview after curve  [255,255,255,255,177,150,150,255,...,177,203,229,255]
    cold-cache preview with curve [255,255,255,255,163,150,150,255,...,163,177,216,255]
    ```
    The second draw reused the first build (1 build, 2 draws) and showed the curve-less pixels. A
    cold cache shows the curve, so only the key is wrong.
- **Severity note:** Preview misstates tone, not position, power range or scale, and the G-code is
  what the settings say. That is P2 by "misleading result an ordinary user will hit", not P1.
- **Overlap:** while this audit ran, a `zz-g10-tone-curve-preview.test.ts` probe of the same cache
  appeared in the shared worktree (area G10). Coordinator: de-duplicate with G10's report.
- **Refuter:** CONFIRMED, P2 kept.
  - **What would make it false:** another invalidation path, or a Preview that does not show
    tones. Neither exists.
    - The cache record is keyed by scene-object id and validated only by the raster's content
      fields (`raster-preview-cache.ts:28-69`). Apply writes the curve into
      `operationOverride` and leaves `dataUrl`/`lumaBase64` the same references
      (`photo-engraving-apply.ts:98-113`), so the new object reuses the old record.
    - Nothing else clears it. `retainPreviewCanvases` drops only rasters that are no longer
      previewed, and it runs only inside `drawRasterPreview` (`draw-raster-preview.ts:76`).
      The cache module has no other clear.
    - Preview does show tones. `drawPreviewModeScene` draws `drawRasterPreview`
      (`draw-scene.ts:214`), which renders the compiled S grid as greys on the machine's S scale
      (`compiled-raster-preview.ts:25-44`).
  - **Own repro through the real Apply path.** `photoEngravingImage` with a Grayscale patch and no
    curve, then Preview, then the same patch with a valid curve (0→0, 128→40, 255→255), then
    Preview again (`zz-g9r-tone-apply.test.ts`, since deleted):
    - `builds 1 -> 1`, and `preview after == G-code after false`. The second Preview drew the
      no-curve pixels (`…,177,203,229,255`) while the G-code had the curve (`…,159,167,211,255`).
    - An operation-level curve change, with no override (a process recipe can put one there,
      see G3-P3-2), shows the same miss: `builds 1 preview==G-code false`.
    - A cold cache matches the G-code, so only the key is wrong.
  - **Contract and L8.** ADR-670 "Verification and limits" lists Preview among the views that
    show a calibration. `20-raster.md:275-278` verified this key as complete before #1442.
  - **Severity.** Every S value is what the stored settings command, and the Photo engraving
    window's own preview shows the curve, so the output is not wrong. The stale Preview can lead
    the user to "correct" tones that are already corrected. That makes it a misleading result an
    ordinary user meets, which is P2, not P1. This follows the G1-P3-2 and G3-P3-2 refuters.
  - **Novelty.** There are no open PRs, and nothing after `9a2bf6b13` on `origin/main` touches
    the key. A G10 probe of the same cache is in the worktree, so the coordinator should
    de-duplicate with G10.
- **Fix direction:** Add the effective operation's tone curve (for example the curve's points, or
  `activePhotoToneCurve` of it) to `previewSettingsKey`. Add a cache test that changes only the curve,
  as the existing tests do for adjustments and power scale.

### G9-P3-1 — The jig editor's arrow-key nudge misses ADR-499 and its Amendment 1: Ctrl is 1 mm, Alt nudges, Settings distances are ignored, a held key evicts the jig history, and an arrow with nothing selected becomes an undo step

- **Where:**
  - `src/ui/workspace/registration-jig/use-jig-editor.ts:238-264`: `handleJigEditorKey` maps any
    arrow to `event.shiftKey ? 10 : 1` mm. Ctrl, Alt, `repeat` and the nudge preferences are never
    read.
  - `src/ui/workspace/registration-jig/jig-editor-artwork.ts:122-142`: `nudgeJigSelection` always
    builds a new project object, even when nothing is selected or every selected object is locked.
  - `src/ui/workspace/registration-jig/jig-editor-session.ts:141`: `changeJigDraft` treats any new
    project object as an edit and keeps 50 steps (`slice(-50)`).
- **Anchor:**
  - Twin: the main canvas nudge, `src/ui/app/nudge-step.ts:17-53` (`nudgeStepMm`, the Settings
    distances, `isArrowKeyWidgetEvent`, `heldRepeat`), and
    `src/ui/state/selection-transform-actions.ts:292-308`.
  - Contract: WORKFLOW F-A6 "Move — keyboard" (`WORKFLOW.md:516-520`): "Ctrl/Cmd+Arrow: 0.1 mm
    nudge", "Alt+Arrow aligns instead of nudging", distances set in Settings → Canvas. ADR-499
    Amendment 1, Decision item 2: "A held arrow key moves the selection as one undo step."
  - Contract: WORKFLOW F-B15a step 6 (`WORKFLOW.md:2953-2956`): saving an existing jig with no
    edits "just closes the editor, adding no undo step". The jig's own `withJigTransforms`
    (`jig-canvas-selection.ts:230-232`) also states "a no-op never becomes an undo step".
- **Scenario:** In the Registration Jig editor, with one artwork selected on a saved jig:
  - Ctrl+→, meant as a 0.1 mm fine nudge, moves 1 mm. Alt+→ moves 1 mm (the main canvas aligns or
    does nothing). Ctrl+Shift+→ moves 10 mm. A user's Settings nudge distances are ignored.
  - Holding → for about 2 s pushes the 50-step jig history out. The art can no longer be undone
    back to where it was before the hold, or past any edit made before it.
  - With nothing selected, one arrow press marks the editor "Unsaved changes", enables Undo, and
    makes Close ask "Save jig changes?". Save then adds a main-canvas undo step with identical
    content and marks the project dirty.
  The moves are visible on the jig canvas, so this stays P3.
- **Evidence:** REPRO. The real `handleJigEditorKey` with a session from the real store
  (`addRegistrationBox`, an imported object, outlines locked):
  - Command: `... vitest.mjs run src/ui/workspace/registration-jig/zz-g9-jig-nudge.test.ts --silent=false --reporter=verbose`
  - Output:
    ```text
    ArrowRight: jig dx 1.000 mm | main canvas step 1
    Ctrl+ArrowRight: jig dx 1.000 mm | main canvas step 0.1
    Alt+ArrowRight: jig dx 1.000 mm | main canvas step none (align/unbound)
    Ctrl+Shift+ArrowRight: jig dx 10.000 mm | main canvas step none (align/unbound)
    held ArrowRight 60 events: jig history steps 50
    after undoing every step: art x 204.0 (before any edit 195.0, after the first Left nudge 194.0)
    arrow with nothing selected: dirty before false after true past 1 sameObjects true
    Save after that arrow press: saved undo 3 -> 4 dirty true sameContent true
    ```
- **Refuter:** CONFIRMED, P3 kept.
  - **What would make it false:**
    - a dialog-level handler that reads Ctrl, Alt or `repeat` before `handleJigEditorKey`;
    - a no-op guard in `changeJigDraft`;
    - a jig-specific rule (F-B15a or a jig ADR) that sets these keys on purpose.
  - **What the code shows.** None of those exist.
    - `handleJigCommandKey` returns false for any key except z, y and a, so Ctrl+arrow falls
      through to `event.shiftKey ? 10 : 1` (`use-jig-editor.ts:238-264`).
    - `changeJigDraft` compares only project identity (`jig-editor-session.ts:131-142`).
    - F-B15a does not mention arrow keys. No ADR in `docs/decisions` that mentions the jig
      defines a jig nudge.
  - **Own repro.** The real `RegistrationJigEditor` (canvas mocked as in its own test), with
    real `KeyboardEvent`s dispatched on the dialog (`zz-g9r-jig-keys.test.tsx`, since deleted):
    - The X field went 195 → 196 for Ctrl+→, → 197 for Alt+→, and → 207 for Ctrl+Shift+→.
    - After one press plus 70 repeats of ← and then 80 Ctrl+Z, X is 186, not 195.
    - With nothing selected, one → set the footer to "Unsaved changes". Save then took the main
      undo stack from 3 to 4 and marked the project dirty, with the art unchanged at 195.
  - **Severity.** Every move is drawn on the jig canvas and shown in X/Y. This matches the
    main-canvas precedents 08-P3-2 (held arrow) and 08-P3-6 (no-op undo step), so it stays P3.
- **Fix direction:** Reuse `nudgeStepMm` (with the Settings distances) and skip Alt and Ctrl+Shift
  as the main canvas does. Fold `event.repeat` presses into the press's draft step. Have
  `nudgeJigSelection` return the session unchanged when no editable object moves (route it through
  `withJigTransforms`).

### G9-P3-2 — Escape during a jig canvas drag only clears the selection; the dragged artwork keeps following the pointer and is committed on release

- **Where:**
  - `src/ui/workspace/registration-jig/RegistrationJigEditor.tsx:25-36` → `use-jig-editor.ts:186-190`:
    `onEscape` clears the selection or asks to close. It never touches the canvas gesture.
  - `src/ui/workspace/registration-jig/use-jig-canvas-gesture.ts:83-87,210-226`: the gesture resets
    only when the `project` prop changes. A selection change does not change it, so `endJigGesture`
    commits the move, resize or rotate with the `selectedIds` captured at pointer-down.
- **Anchor:**
  - Twin: main canvas `src/ui/workspace/use-esc-cancels-drag.ts:18-30`. Escape during a move,
    scale, selection-scale or rotate drag rolls it back and cancels only the drag (audit C4).
    rolling-v2 08-P2-4 closed the draw sibling in #1357.
  - Contract: WORKFLOW F-A15 (`WORKFLOW.md:1805`) "Escape — Deselect / cancel current operation";
    F-B15a (`WORKFLOW.md:2909-2910`) "Each drag is one undoable draft edit."
- **Scenario:** In the jig editor, drag a selected artwork 12 mm and press Escape with the button
  still held. The handles disappear, because the selection was cleared, but the artwork keeps
  following the pointer. Releasing 20 mm away commits a draft step. Save puts the artwork 20 mm from
  where it was. A marquee drag with nothing selected plus Escape instead closes the editor mid-drag
  when the draft is clean (read only, not run).
- **Evidence:** REPRO. The real `RegistrationJigEditor` with the real `RegistrationJigCanvas`.
  Only painting and the bitmap size are mocked, as in `RegistrationJigCanvas.small-selection.test.tsx`.
  - Command: `... vitest.mjs run src/ui/workspace/registration-jig/zz-g9-jig-esc-drag.test.tsx --silent=false --reporter=verbose`
  - Output:
    ```text
    before Esc fields shown: true
    selection after Esc: cleared
    footer after Esc (button still down): Draft only · saving keeps the current output mode. ...
    footer after release: Unsaved changes · Draft only · ... | jig Undo enabled: true
    after Save: art x 215.00 (before 195.00)
    ```
- **Refuter:** CONFIRMED, P3 kept.
  - **What would make it false:** a selection change that resets the gesture, or an Escape
    handler that reaches the canvas.
    - The gesture resets only when `project` changes (`use-jig-canvas-gesture.ts:85-89`).
      `project` is `editor.view`, memoised on `session.draft.project`
      (`use-jig-editor.ts:54-57`). `selectJigObjects` changes only the selection fields.
    - Escape reaches `useDialogA11y` → `editor.onEscape` and nothing else. The canvas
      `onKeyDown` handles Space only (`RegistrationJigCanvas.tsx:87-92`).
  - **Own repro.** The real editor with the real `RegistrationJigCanvas` (paint and bitmap size
    mocked), driven by pointer events on the canvas (`zz-g9r-jig-esc.test.tsx`, since deleted):
    - Pointer-down on the art, move +12 mm, then Escape on the focused canvas: the selection
      fields vanished.
    - Move to +20 mm, release: the footer read "Unsaved changes".
    - Save: the art moved from x 195 to 215 (20 mm).
  - **Position output.** This is not a silent position error. After release, the jig canvas paints
    the committed draft with the art at +20 mm, and the art follows the pointer all the way. After
    Save, the main canvas shows it at that position, and that is where it burns. One jig Undo
    reverts it.
  - **Severity.** The twin 08-P2-4 was P2 because its preview vanished and implied a cancel. Here
    the art keeps visibly following the pointer, so the result is not misleading. The jig's own
    Escape clause (F-B15a, "Otherwise Escape first clears the selection") is met. The finding
    rests on the Twin anchor, so it stays P3.
- **Fix direction:** While a jig gesture is live, let Escape cancel it (`cancel()`: clear the
  gesture, preview and marquee) and stop there, as `useEscCancelsDrag` does on the main canvas.
  Clear the selection or ask to close only when no gesture is live.

### G9-P3-3 — ADR-653 Amd 2's corner-drag rule reached the selection and jig helper but not the main canvas's single-object handle: a one-axis outward drag does nothing, and a mostly outward drag can shrink the object

- **Where:**
  - `src/ui/workspace/selection-handles.ts:92-105` (from #1384, merged with #1362): aspect-locked
    corner drags take the factor with the larger proportional travel. This helper serves
    multi-selection handles and every jig resize, including a single jig object.
  - `src/ui/workspace/handles.ts:209-211,228-234`: the main canvas's single-object corner drag still
    uses `applyLockAspect`, which takes `Math.min(|factorX|, |factorY|)`. Corner drags lock aspect
    unless Shift is held (`drag-state.ts:407`).
- **Anchor:**
  - Contract: ADR-653 Amendment 2, Decision, fifth item: "Aspect-locked corner resizing follows
    proportional pointer travel on either axis." The remediation ledger row UI-P2-3
    (`docs/audits/2026-10-22-weekly-pr-remediation.md:22`) describes it as general corner
    behaviour.
  - Twin: the same object and the same pointer travel give different sizes on the main canvas and in
    the jig, and with one object or two selected on the main canvas.
- **Scenario:** A 10 × 10 mm object on the main canvas, plain corner drag (no Shift) of the `se`
  handle:
  - 10 mm straight right: the object stays 10 × 10. The selection and jig path give 20 × 20.
  - 10 mm right and 2 mm up: the object shrinks to 8 × 8. The selection and jig path give 20 × 20.
  The drag is drawn live, so the result is seen before release (P3).
- **Evidence:** REPRO. The real `scaleObjectByHandleDrag` against the real `selectionResizeEditFromDrag` →
  `buildSelectionTransformEdit` on the same object:
  - Command: `... vitest.mjs run src/ui/workspace/zz-g9-corner-rule.test.ts --silent=false --reporter=verbose`
  - Output:
    ```text
    se corner dragged 10 mm right only: main-canvas single object -> 10.00 x 10.00 | selection/jig path -> 20.00 x 20.00
    se corner dragged 10 mm down only: main-canvas single object -> 10.00 x 10.00 | selection/jig path -> 20.00 x 20.00
    se corner dragged right 10, up 2: main-canvas single object -> 8.00 x 8.00 | selection/jig path -> 20.00 x 20.00
    ```
  - L7: `selection-handles.test.ts` (+17 lines in #1384) tests only the shared helper. No test covers
    `handles.ts` against the amended rule.
- **Refuter:** CONFIRMED (Twin). The contract anchor is weaker than stated. P3 kept.
  - **What would make it false:**
    - a single selected object taking the selection-scale path;
    - an ADR that keeps `min()` for single objects;
    - an ADR-653 Amd 2 rule scoped to the jig only.
  - **Path check.** One selected object always takes the `scale` drag
    (`drag-state.ts:139-140` → `scaleObjectByHandleDrag`). Two or more take `selection-scale`
    (`drag-state.ts:321`, `pickSelectionScaleDrag` returns null for ≤ 1 object) →
    `selectionResizeEditFromDrag`.
  - **Own repro.** A 10 × 10 rectangle, `se` handle, lock aspect (`zz-g9r-corner.test.ts`, since
    deleted). Single-object handle against the selection helper:
    - right 10: `10.00 x 10.00` against `20.00 x 20.00`;
    - right 10, up 2: `8.00 x 8.00` against `20.00 x 20.00`;
    - diagonal, and inward 4: equal (20 × 20 and 6 × 6).
  - **Anchor note.** The ADR-653 Amd 2 sentence sits in the jig bullet (line 11, "Jig Save
    validates …"). UI-P2-3 reviewed #1253, the jig canvas. So the ADR does not clearly cover the
    main canvas's single-object handle.
    - The Twin anchor holds on the main canvas alone: one object and two objects answer the same
      drag differently.
    - `selection-handles.ts:71-72` still says the selection rule is "matching single-object corner
      scaling", which is no longer true.
  - **Severity.** The resize is drawn live, so it stays P3.
- **Fix direction:** Apply the same larger-proportional-travel rule in `applyLockAspect`, or record
  in ADR-653 Amd 2 that it covers only the selection and jig paths and say why.

### G9-P3-4 — Jig size fields give every refusal as "rotated artwork", including the flat-selection reasons #1357 named; the advice it gives is already in effect

- **Where:** `src/ui/workspace/registration-jig/JigSelectionFields.tsx:22-25`. Any
  `buildSelectionTransformEdit` error shows "This selection cannot use that size. Keep proportions
  locked for rotated artwork." The `reason` is never read.
- **Anchor:**
  - Twin: `src/ui/commands/NumericEditsBar.tsx` `messageForError`. #1357 added
    `zero-height-selection` / `zero-width-selection` / `degenerate-selection` messages, for example
    "The selection has no height to scale, like a horizontal line. Change its width instead."
  - Contract: WORKFLOW F-A6, typed values. Only typing mistakes are refused, and the notice says what
    to do (as cited for 08-P2-2).
- **Scenario:** Select a horizontal line in the jig editor. Keep proportions is on by default. Type
  5 in Height and leave the field. Nothing changes, and the alert tells the operator to keep
  proportions locked, which they already are. Width works.
- **Evidence:** REPRO. The real `JigSelectionFields`:
  - Command: `... vitest.mjs run src/ui/workspace/registration-jig/zz-g9-jig-line-field.test.tsx --silent=false --reporter=verbose`
  - Output:
    ```text
    core refusal reason: zero-height-selection
    jig message: This selection cannot use that size. Keep proportions locked for rotated artwork. | commits 0
    ```
- **Refuter:** CONFIRMED, P3 kept.
  - **What would make it false:** the fields reading `result.reason` elsewhere, or the generic
    message being right for the flat-selection reasons. Neither holds: `edit()` drops the reason
    (`JigSelectionFields.tsx:21-28`).
  - **Own repro.** The real `JigSelectionFields` (`zz-g9r-jig-field.test.tsx`, since deleted):
    - A vertical line, Width 5: 0 commits and the "Keep proportions locked for rotated artwork"
      alert. This happens with Keep proportions on and also with it off.
    - A horizontal line, Height 5: the same alert.
    - A vertical line, Height 20: commits.

    The advice is wrong in both states.
  - **Severity.** Nothing changes and the canvas is unchanged, so it stays P3.
- **Fix direction:** Map `result.reason` to text, reusing the NumericEditsBar messages.

### KNOWN — severity correction

#### G9-K-1 (KNOWN 15-P2-1, fixed by #1359) — Under METHOD §3 (2026-10-27), 15-P2-1 was P1, not P2

- **Where:** `docs/audits/2026-10-21-rolling-v2/15-scene-text.md:105-121` (refuter severity) and
  `LEDGER.md:112`. It was kept P2 because "The Frame and the output preview use the prepared job, so
  they show the shift. That keeps this out of P1." Meta-v1 M2 agreed: "Frame shows it, so not
  silent" (`M2-meta-rolling-v2-p2.md:456`).
- **Why it is a correction:** With Max width on, centred or right-aligned variable records burned
  up to 47 mm off their designed place, and the canvas showed the template unmoved. Neither Frame
  nor Preview names that mismatch; the operator would have to spot it unprompted. That is the case
  the 2026-10-27 clarification keeps at P1.
- **Status:** fixed by #1359 (`text-style.ts:80-87` carries the anchor through `mapped()`;
  `variable-text-anchor.ts:58-65` compares frames). G1 re-checked the output twin. Ledger severity
  only; no new work.
- **Refuter:** CONFIRMED, P1 (retroactive, already fixed).
  - **Read.** `15-scene-text.md:56-126` gives the effect: the emitted G-code put record burns
    +8.66 / −23.79 mm off when centred and +17.55 / −47.08 mm off when right-aligned, against
    ±0.7 mm without Max width. That is wrong physical position. The canvas showed the template
    unmoved.
  - **Why P2 was kept.** The 15-P2-1 refuter kept P2 only because Frame and the output preview
    show the shift. M2 (`M2-meta-rolling-v2-p2.md:456`) did the same: "Frame shows it, so not
    silent".
  - **The 2026-10-27 rule** allows lowering only when the app itself names the mismatch before
    output. The Preview, like Frame, shows the job and compares it with nothing. Neither says that
    records left the template's anchor.
  - **Reach.** The defect was reachable through `buildTextObject` → `prepareOutputSnapshot` →
    `emitPreparedGcode` (the 15 refuter's own repro). The 2026-10-23 clarification removes reach as
    a reason to lower.
  - **Fix.** #1359 is on `origin/main` (`b68a53beb`), and `text-style.ts:80-87` maps the anchor.
  - **Novelty.** Neither the v2 nor the v3 ledger has this correction, and the 2026-10-27
    clarification names only 12-P2-2, 12-P2-1 and M2-P3-3.

## Refuted

The refuter did not refute any raised finding. Only one claim was narrowed: in G9-P3-3, ADR-653
Amd 2's corner rule sits in its jig bullet, so the finding rests on the Twin anchor.

Candidates the auditor dropped before raising:

- **The jig size fields commit a typed value to artwork clicked next (the SG-006 sibling that #1425
  fixed in NumericEditsBar).** Dropped. The jig canvas's pointer-down calls
  `event.currentTarget.focus()` (`use-jig-canvas-gesture.ts:112`) before it changes the selection,
  so the field's blur commits to the old selection first. The project change then resets the
  gesture (`:83-87`).
- **#1425's glyph ownership (ART-008) is lost through the text worker.** Dropped:
  `packTextRenderResult` and `unpackTextRenderResult` spread the whole result
  (`text-render-result-transfer.ts:46,51`), so `glyphContours` travels as plain arrays.
- **Max width or italic with a bend leaves a stale variable anchor.** Dropped: both bends return no
  anchor, which `TextRenderResult.anchor` documents (`text-to-polylines.ts:93-101`), so variable
  output keeps the placed transform.
- **Inch rulers misplace ticks (#1287).** Dropped: ticks are drawn at `offset + value × scale` with
  `scale × 25.4`, the same scene position as in mm. Area in in² divides by 25.4 once in
  `MeasureHoverReadout` and once in `length()`, which is correct.
- **A held-nudge repeat after Undo merges into the step below** (`nudgeResults` holds an earlier
  nudge's project). Dropped as not reachable from the keyboard: Ctrl+Z stops the arrow's
  auto-repeat. It would need a mouse-clicked Undo during a hold whose restored project was itself
  a nudge result. Not run.
- **Outline-board registration does not scale the artwork with the measured board scale (≤ 5 %).**
  Dropped: this is a design choice, and no anchor says the artwork must scale (ADR-654).

## Verified clean

- **#1357 on the main canvas.**
  - Escape during draw or measure: `useToolChangeCancelsDrag` ends the drag when the tool changes.
  - Ruler guides: `initializeDragSurface` skips `guide`, so one snapshot is taken.
  - Flat selections: refused per axis in the core, in the multi-selection handle drag and in the jig
    resize (`resizeEditSetsSize`).
  - Arrow keys on widgets: `isArrowKeyWidgetEvent` on the nudge, `defaultPrevented` on the align keys.
  - Held arrow: coalesced through `nudgeResults`.
  - Escape in a numeric box: reverts the draft.
- **Conflict resolutions kept both sides.**
  - `selection-handles.ts` (#1357 flat axes, #1362/#1384 corner rule).
  - `jig-canvas-selection.ts` (#1357 `resizeEditSetsSize`, #1384 small-artwork interior move).
  - `NumericEditsBar.tsx` (#1357 Escape, #1425 `selectionKey`, #1287 inch boxes).
- **SG-006 siblings.** `NodeCoordinateControls` drafts are keyed by node reference and base value.
  The jig fields are covered by the focus order (Refuted, first item).
- **#1359 and text.**
  - `mapped()` carries the anchor through squeeze and italic.
  - Bold leaves it in place, and output compares frames (G1 checked the output side).
  - #1425 glyph ownership reaches bold and the undistorted bend on both the worker and in-thread paths.
  - Path-text guide dedupe is used by canvas and output alike.
  - #1352 uses `embeddedFontChoice` for imports; jig text offers only fonts the project already has.
  - #1351 caches embedded fonts by their bytes.
- **Place Board canvas side (ADR-654).**
  - `fitObjectToBoard` on outline boards uses `largestInscribedRect`: whole inside cells, shrunk by
    one cell on each side. Containment holds.
  - Rectangle and circle boards keep `transformedBBox` and the inscribed circle.
  - Captured-outline registration rotates on-board, unlocked artwork about the same vertex centre
    the outline is re-centred on.
- **Jig save path.** Save goes through `commitProjectEdit`, so the composed store guards apply, with
  `jobMachineGuardSetter` innermost. The rebase refuses scene-limit and integrity conflicts before
  it publishes (#1384).
- **Raster preview key.** It covers ADR-671 sharpening (#1443) and every other setting that changes
  the S grid, apart from the tone curve (G9-P2-1).

## Not verified

- **Real browser and Electron behaviour:** key auto-repeat rates, focus order on pointer-down, and
  blur on removal. All runs used jsdom with synthetic events.
- **A second window** editing the same project.
- **Variable barcode siblings of ADR-653 Amd 3 item 4.** Warp now commits the displayed barcode.
  Whether Convert to Path, Offset, Boolean and hit-testing also use the displayed geometry for a
  variable barcode whose value changed its width was not checked. That display code predates the
  window.
- **ADR-654 outline-registration math** (`board-outline-registration.ts`, similarity fit and view
  signs). Read only; G6 and G7 own capture.
- **The hover pulse and edit glow canvas code** (#1290, #1273, #1295, #1322, #1325). It is display
  only, and G3 covered edit glow.
- **LightBurn reference behaviour** for corner-drag aspect locking. No primary source was fetched,
  so none is used as an anchor.
- **Open PRs.** `gh pr list --state open` returned none, so no open-PR overlap exists.

Repro files were deleted from the worktree. Copies are in
`C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\repros-g9\`,
each at its repo path. To rerun one, copy it back and run
`NODE_OPTIONS=--no-experimental-webstorage node ../../../node_modules/vitest/vitest.mjs run <file> --silent=false --reporter=verbose`.

```json
[
  {"id":"G9-P2-1","severity":"P2","area":"canvas-scene","file":"src/ui/workspace/draw-raster-preview.ts","line":166,"anchor":"Contract: ADR-670 Verification and limits ('the canvas, Photo engraving preview, Preview and G-code do'), Decision item 5; Twin: compile-job-raster.ts:160 prepareImageLuma with photoToneCurve; L8: #1443 keyed sharpen, #1442 did not key the curve (20-raster.md:275-278 verified-clean claim broken)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro via real photoEngravingImage Apply (curve only): builds 1->1, Preview shows the no-curve pixels while the compiled S has the curve; an operation-level curve misses too; a cold cache matches. No other invalidation (the record is keyed by id plus content refs; retainPreviewCanvases drops only rasters no longer previewed). P2 kept: S values are as commanded and the Photo engraving window shows the curve; only the Preview misleads (precedent G1-P3-2, G3-P3-2). De-dup with G10","known":false,"summary":"Preview raster cache key omits the ADR-670 tone curve: after applying or changing a calibration, Preview keeps drawing the cached uncalibrated burn while G-code uses the curve (possible duplicate of G10, in flight)"},
  {"id":"G9-P3-1","severity":"P3","area":"canvas-scene","file":"src/ui/workspace/registration-jig/use-jig-editor.ts","line":261,"anchor":"Twin: nudge-step.ts nudgeStepMm/heldRepeat, selection-transform-actions.ts:292-308; Contract: WORKFLOW F-A6 Move-keyboard (Ctrl 0.1 mm, Alt aligns, Settings distances), ADR-499 Amd 1 Decision item 2, WORKFLOW F-B15a step 6 (no-edit save adds no undo step)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro via real RegistrationJigEditor key events: Ctrl+Right and Alt+Right 1 mm, Ctrl+Shift+Right 10 mm; held Left (71 events) then 80 Undo ends at 186, not 195; an arrow with nothing selected marks Unsaved, and Save takes undo 3->4 and dirty with the art unchanged. No jig rule (F-B15a, ADRs) defines arrows. P3 kept (visible; precedents 08-P3-2, 08-P3-6)","known":false,"summary":"Jig arrow nudge: Ctrl+arrow 1 mm (not fine), Alt+arrow and Ctrl+Shift+arrow nudge, Settings distances ignored, each auto-repeat is a draft step (50-step history evicted), an arrow with nothing selected becomes a dirty no-op step and Save then adds an identical main-canvas undo step"},
  {"id":"G9-P3-2","severity":"P3","area":"canvas-scene","file":"src/ui/workspace/registration-jig/use-jig-canvas-gesture.ts","line":226,"anchor":"Twin: use-esc-cancels-drag.ts:18-30 (main canvas Esc cancels move/scale/rotate); Contract: WORKFLOW F-A15 Escape cancels current operation, F-B15a each drag one draft edit","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro with the real editor and real jig canvas: Esc mid-drag clears only the selection, release commits, Save moves the art 195->215. The gesture resets only when the view project changes, and a selection change does not change it. Not a silent position error: the art follows the pointer, the committed draft and the main canvas show it where it burns, and one Undo reverts it. P3 kept (unlike 08-P2-4, nothing implies a cancel; the F-B15a jig Escape clause is met, so only the Twin anchor applies)","known":false,"summary":"Escape during a jig canvas drag only clears the selection; the gesture keeps previewing and commits on release (artwork saved 20 mm away)"},
  {"id":"G9-P3-3","severity":"P3","area":"canvas-scene","file":"src/ui/workspace/handles.ts","line":229,"anchor":"Contract: ADR-653 Amd 2 Decision item 5 ('Aspect-locked corner resizing follows proportional pointer travel on either axis'); Twin: selection-handles.ts:94-105 (selection and jig path)","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro: 10x10 se drag right 10 -> single object 10x10 vs selection helper 20x20; right 10 up 2 -> 8x8 vs 20x20. One object always takes the scale path (drag-state.ts:139-140); 2+ take selection-scale. Anchor note: the ADR-653 Amd 2 sentence sits in the jig bullet (UI-P2-3 reviewed #1253), so its contract scope is unclear; the main-canvas 1-vs-2-object twin and the stale selection-handles.ts:71-72 comment hold. P3 kept","known":false,"summary":"Main-canvas single-object corner drag still uses min(|fx|,|fy|): a one-axis outward drag does nothing and right-10/up-2 shrinks 10x10 to 8x8, while the selection/jig path gives 20x20"},
  {"id":"G9-P3-4","severity":"P3","area":"canvas-scene","file":"src/ui/workspace/registration-jig/JigSelectionFields.tsx","line":24,"anchor":"Twin: NumericEditsBar messageForError zero-height/zero-width/degenerate (from #1357); Contract: WORKFLOW F-A6 typed values name the reason","evidence":"REPRO","verdict":"CONFIRMED","refuter":"Own repro with the real JigSelectionFields: a vertical line, Width 5 (aspect on and off), and a horizontal line, Height 5, are refused with the rotated-artwork advice; the reason is never read. P3 kept","known":false,"summary":"Jig size fields report every refusal as rotated artwork; a Height on a horizontal line is refused with advice to keep proportions locked, which they already are"},
  {"id":"G9-K-1","severity":"P1","area":"canvas-scene","file":"src/core/text/text-style.ts","line":80,"anchor":"METHOD §3 clarification 2026-10-27 (Frame is not a warning)","evidence":"READ","verdict":"CONFIRMED","refuter":"Read 15-scene-text.md:56-126 (G-code burns up to 47 mm off while the canvas shows the template) and M2:456. P2 rested only on Frame and the output preview showing the shift, which the 2026-10-27 rule rejects; no app warning names the mismatch, and reach no longer lowers. Fixed by #1359 (b68a53beb). Not yet in either ledger","known":"docs/audits/2026-10-21-rolling-v2/15-scene-text.md 15-P2-1 (fixed by #1359)","summary":"Severity correction only: 15-P2-1 was kept P2 because Frame and output preview show the shift; under the 2026-10-27 rule it was P1. Already fixed"}
]
```
