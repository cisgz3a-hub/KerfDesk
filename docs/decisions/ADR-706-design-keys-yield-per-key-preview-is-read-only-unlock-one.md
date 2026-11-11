## ADR-706 - Design shortcuts yield per key, Preview is read-only, and one object can be unlocked (2026-11-11)

**Status:** Accepted. Extends ADR-493 and ADR-499 Amendment 1 (which arrow keys a focused control
keeps). Keeps ADR-242 and ADR-272 (an open modal owns the keyboard) and ADR-590 Amendment 1 (a
closed Studio keeps its session). Leaves ADR-565 and PROJECT.md non-negotiable 21 unchanged: no
Start, Frame or output rule moves, and the machine keys (jog, Start, Abort) are not touched. |
**Date:** 2026-11-11

### Context

The user annoyance audit A1 (`docs/audits/2026-11-11-annoyance-a1/`) listed five blocks in the
design workspace that stop work with no reason shown. Each was reproduced with a failing test before
it was changed (fix group F4).

1. **A4-P2-2.** `isEditableShortcutTarget` counted every `INPUT` and `SELECT` as a text field. After
   a tick box, slider, colour button or drop-down was touched, Delete, Ctrl+Z, copy, paste, the
   arrows and Esc did nothing until the canvas was clicked, which can change the selection.
2. **A4-P2-5.** In Preview the canvas only pans and the selection is not drawn, but Delete, Cut,
   Paste, the arrows and the flips still changed that hidden selection. A click did nothing and said
   nothing, and the tool strip looked usable.
3. **A4-P2-6.** With a dialog, Design Studio or Image Studio open, Ctrl+S returned before
   `preventDefault`. On the desktop nothing happened; in a browser "Save page as" opened.
4. **A4-P2-3.** Locked artwork could be freed only with Unlock All. The locked row in the artwork
   tree was disabled under the title "Select {name} directly for editing."
5. **A4-P2-7.** **More cut settings** was disabled during a job, jog, Frame or autofocus with its
   ordinary tooltip, and an open dialog was closed and its draft dropped when motion began.

### Decision

1. **A focused control keeps only the keys that work it** (`focusedControlOwnsKey` in
   `src/ui/common/keyboard-targets.ts`).
   - A text field keeps every key: `textarea`, an editable element, the `textbox` and `searchbox`
     roles, and every `input` except the types below. An input type the browser does not know shows
     as a text field and counts as one.
   - A slider (`range`) keeps the arrow keys, Home, End, PageUp and PageDown, with any modifier.
   - A drop-down (`select`) keeps those, Enter, Space and a bare typed character, which jumps to an
     option.
   - A radio button keeps the arrows and Space. A tick box keeps Space. A colour, file or button
     input keeps Enter and Space.
   - Every other key passes to the design shortcuts: Edit, Tools, Transform, View, the rotate and
     flip keys, the align and draw-order keys, the node-editing keys and the warp Apply and Cancel
     keys. In Image Studio, Ctrl+Z and the other Ctrl chords now work from a slider or tick box, as
     they already did from a button. Esc in the Studio's Photos tab follows the same rule.
   - `isArrowKeyWidgetEvent` also reads a native slider, radio button and drop-down, which have no
     `role` attribute.
   - **The machine keys keep the old, broad rule.** `isEditableShortcutTarget` is unchanged and is
     still what the jog keys and Ctrl+Enter (Start) ask, so a focused form control of any kind never
     lets a key through to the machine. Design Studio's own keymap (`design-shortcuts.ts`) is also
     unchanged.
2. **Enter in a `DraftNumberInput` commits and releases focus**, so the shortcuts work without a
   canvas click. A table row that commits on blur (`commitOnBlur`, such as a scan-offset row whose
   Enter sorts the rows) keeps its field as before. Otherwise focus stays where it is in three
   cases: the field holds an error; the field is inside a dialog (the dialog owns the keyboard and would move a released focus to its first
   control); or Enter came from the numeric keypad. With a machine connected the bare keypad digits
   jog the head whenever no form control has focus (ADR-493), so a person typing the next number on
   the keypad must stay in the field.
3. **Preview is read-only, and says so.**
   - The first plain click on the canvas in each visit to Preview shows one keyed toast: "Preview
     shows the job and cannot be edited. Press P or click Preview to go back to the design." Later
     clicks in that visit are quiet, a pan never shows it, and it is dismissed on leaving Preview.
   - The canvas tools in the tool strip are disabled with the reason "Not available in Preview.
     Press P or click Preview to edit." Create artwork and the design library open their own
     windows and stay enabled.
   - A key that would change artwork changes nothing and shows the same toast: Delete, Backspace,
     Cut, Paste, Paste in Place, Duplicate, Group, Ungroup, Delete Duplicates, nudge, flip, rotate,
     align, Move Together, draw order, and the keys that arm a drawing tool
     (`src/ui/app/preview-shortcut-guard.ts`). The key is matched and consumed exactly as before,
     so it never reaches the browser.
   - Undo, Redo, Copy, Select All, Esc, the view keys and P are unchanged. So are menu and toolbar
     commands and the settings panels: they name what they do, and Preview rebuilds after each edit
     (F-A8 Live updates).
4. **Ctrl/Cmd+S and Ctrl/Cmd+Shift+S are always consumed.** While a dialog, a Studio or on-canvas
   text owns the keyboard, a capture-phase window listener (`save-shortcut-when-owned.ts`) prevents
   the default and shows one keyed toast that says what to do first: apply the drawing and close
   Design Studio, apply the image and close the Studio, finish the text, or close the window.
   Nothing is saved from there. A Studio session that has not been applied is not in the project,
   so a save would write the project without it while looking like a full save. Ctrl+Alt+S is left
   alone: it is AltGr+S on many layouts.
5. **One object can be unlocked** (`unlockObjects` in `scene-lock-actions.ts`), as one named undo
   step that leaves every other lock in place.
   - A locked row in the artwork tree has **Unlock**. An artwork row unlocks that artwork and
     selects it; a group row unlocks the locked artwork inside the group. The disabled name button
     of a locked row now reads "{name} is locked. Unlock it to select or edit it."
   - A right-click on locked artwork on the canvas opens the context menu with **Unlock** first,
     which unlocks that object and selects it. Unlocked artwork above it is still picked first.
   - Lock Selection and Unlock All are unchanged.
6. **More cut settings opens whatever the machine is doing**, and an open Cut Settings dialog stays
   open, with its draft, when a job, jog, Frame or autofocus begins.

### Why the Cut Settings block had no safety reason

The block came in with commit `8d91809b8` (2026-06-09, "gate cut settings while machine is active"),
which gives no reason, and no ADR, audit or WORKFLOW entry names one. Checked against the code:

- The Power, Speed, Passes, process and switch fields beside the button edit the same operation
  throughout a job, and so does the sub-operation editor (`LayerSubLayers.tsx`), which opens the
  same dialog and was never blocked.
- A running job streams the program it was started with. Editing an operation changes the project,
  not the stream.
- A changed setting reaches Frame and Start through the ordinary path: a footprint change expires
  the Frame evidence (ADR-565), and each Start reviews the current program.
- Abort (Ctrl/Cmd+.) ignores an open modal, and the Live Motion bar with ABORT sits above every
  overlay. Other dialogs, and both Studios, already open during a job.

### Consequences

- Delete, Backspace and Esc now act on the artwork when a tick box, slider, colour button or
  drop-down has focus, as they always did from a button. A person who expects Backspace to do
  nothing there will delete the selection; Ctrl+Z restores it.
- A drop-down still swallows bare letters, so `T`, `P`, `H`, `V`, `F` and the zoom keys do nothing
  while one has focus. That is the price of leaving its type-ahead alone.
- In a browser other than Chromium, Esc on an open drop-down may both close it and clear the
  selection. Chromium, which Web Serial requires, keeps keys in an open drop-down to itself.
- In Preview, menu and toolbar edit commands still act on the hidden selection. They are named
  clicks, not stray keys, and were left for a later decision.
- Number fields that are not a `DraftNumberInput` (the toolbar's X, Y, W and H boxes, and the
  debounced layer fields) keep focus on Enter as before.

### Verification

- `src/ui/common/keyboard-targets.test.ts`, `src/ui/app/shortcuts-focused-control.test.ts`,
  `src/ui/kit/DraftNumberInput.enter-focus.test.tsx`
- `src/ui/app/use-shortcuts-preview-and-save.test.tsx`, `src/ui/state/preview-edit-hint.test.ts`,
  `src/ui/workspace/ToolStrip.test.tsx`, `src/ui/workspace/use-workspace-drag-preview-lock.test.tsx`
- `src/ui/state/scene-lock-actions.test.ts`, `src/ui/layers/DesignHierarchyPanel.unlock.test.tsx`,
  `src/ui/commands/WorkspaceContextBar.unlock.test.tsx`
- `src/ui/layers/LayerRow.double-click.test.tsx`
- `e2e/shortcuts-after-panel-control.e2e.ts`: the keyboard journey in a real browser.
- No file under `src/core`, `src/ui/laser` or `src/ui/state/laser-*` changed, so emitted G-code is
  unchanged.
