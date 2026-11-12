# F6 Save dialogs: fix record

**Date:** 2026-11-11. **Decision:** [ADR-656 Amendment 4](../../decisions/ADR-656-amendment-4-a-save-ready-in-time-opens-its-picker-at-once.md).
**Findings:** A4-P2-4 (P2), A1-P3-9 (P3), A4-P3-2 (P3). All three reproduced before any change;
none refuted. One premise of the fix brief was refuted (below).

## Reproduction, on unchanged code

Run in Chrome through Playwright against `vite --mode desktop`, with the file pickers stubbed by
the e2e fixture.

| Finding | What was done | Result |
|---|---|---|
| A4-P2-4, Save G-code | Opened `project-basic.lf2`, pressed Ctrl+Shift+E | **Save as…** became enabled 128 ms after the key press. The picker had been asked for 0 times; it opened only on the click |
| A4-P2-4, project Save As | Opened a project with 550,000 characters of notes (past the worker threshold), clicked **Save As** | **Choose file…** enabled after about 2.1 s, picker asked for 0 times until the click. Text: "Your project is ready. Choose a filename and folder to save it." |
| A1-P3-9 | New empty project, Ctrl+Shift+E | Native alert "Cannot save G-code: • No output layers. Enable Output on at least one layer." Behind it the dialog stayed open ("No final file was selected or modified because output preparation did not succeed.") with **Cancel** and a disabled **Save as…** |
| A4-P3-2 | Unsaved large project with no file, **Open** | Four steps: **Save changes?**, **Save project**, the save picker (after **Choose file…**), the open picker |

## The activation limit (refutes one premise)

The brief expected Electron to have its own save dialog with no activation limit. It does not:
the desktop app calls the same `showSaveFilePicker` in the renderer (`src/platform/web/web-adapter.ts`;
there is no `dialog.showSaveDialog` in `electron/`). Two probes measured the rule:

| Check | Chrome 157 (Playwright, headless) | Electron 44.5.1 renderer (Chromium 152) |
|---|---|---|
| `showSaveFilePicker()` with no click or key press | `SecurityError: Must be handling a user gesture to show a file picker.` | the same `SecurityError` |
| `navigator.userActivation.isActive` after a click | true for 5,016 ms | true for 5,009 ms (`executeJavaScript` with a user gesture) |
| The same after Ctrl+Shift+E | true for 5,001 ms | not run |
| A second picker after the first closed, same click | opens: a picker does not use the activation up | not run |
| A second picker called straight after the first, before it closed | `NotAllowedError: User activation required.` | not run |

The app pins Electron 44.9.1; the probe ran on the 44.5.1 binary installed on the maintainer's PC,
the same Electron major. Playwright's own `evaluate` calls run with a user gesture, so the probe
page measured itself and was read once at the end.

## What changed

| Finding | Before | After |
|---|---|---|
| A4-P2-4, Save G-code (laser) | Dialog, then **Save as…** | Ctrl+Shift+E opens the file dialog. The dialog appears only after 400 ms of preparation, with progress and **Cancel**; it asks for **Save as…** only when the export is ready more than 5 s after the key press |
| A4-P2-4, Save G-code (CNC) | Dialog, then **Save as…** or **Save setup sheet + program…** | Unchanged on purpose: that dialog is a choice. It no longer shows "Preparing…" for a quick export |
| A4-P2-4, tiled CNC and `.rd` | Dialog "Choose a destination for this prebuilt … export", then **Save as…** | No dialog in front: tiles ask for their folder, `.rd` asks for its file once compiled |
| A4-P2-4, project Save As | **Save project** dialog, then **Choose file…** | The OS dialog opens from the click; the dialog appears only after 400 ms and asks for **Choose file…** only past 5 s |
| A1-P3-9 | Native alert, then **Cancel** on the dialog behind it | One error toast ("Cannot save G-code: …", further reasons folded), or the reasons inside the dialog with one **Close** when it is already open. The same toast for "Cannot export tiles: …" and "Cannot save .rd file: …" |
| A1-P3-9, empty canvas | Preparing dialog, alert, **Cancel** | One toast: "Cannot save G-code: No output layers. Enable Output on at least one layer." No dialog |

## A4-P3-2: what remains

Checked on the changed code with real key presses (Ctrl+O, then Enter on **Save**) and a save
picker held open for a set time. The page recorded each dialog, picker request and toast.

| Project, with no file yet | Save picker open for | What appeared | Open picker |
|---|---|---|---|
| Large (worker-prepared) | 1 s | **Save changes?**, then the save picker by itself about 2.3 s after **Save** (**Save project** showed "Preparing…" meanwhile and needed no click), then the open picker | opened: the activation was still live |
| Large | 6 s | the same up to the save picker | **refused**: the activation had lapsed |
| Small | 6 s | **Save changes?**, the save picker, the open picker | **refused**: the activation had lapsed |

So the stack is now at most **Save changes?**, the OS save picker and the OS open picker, and
**Choose file…** is gone from it for a project validated within 5 s. Before, a large project
needed that click every time.

**What remained (not fixed in F6, and the same on `main` for small projects; fixed in the
follow-up below):** the open picker
runs on the click that answered **Save changes?**. A person who takes more than 5 s in the save
picker leaves it no activation, so Chromium refuses it and Open ends in the toast "Could not
open project: Failed to execute 'showOpenFilePicker' on 'Window': Must be handling a user
gesture to show a file picker." The project is saved by then; pressing Open again works. In the
check the page read `navigator.userActivation.isActive` as false at that moment and the stub
then threw the error real Chromium was measured to throw. A fix would ask for a fresh click
("Saved. Choose the project to open.") when the activation has lapsed, as
`pickPreparedSaveTarget` does for saves. The same applies to **Open template** behind the same
question. A project that already has a file is not affected: it saves with no picker.

## A4-P3-2: the remainder, fixed

**Decision:** [ADR-656 Amendment 5](../../decisions/ADR-656-amendment-5-an-open-that-outlasted-its-click-asks-for-a-fresh-one.md). A follow-up to F6, in its own change.

**Reproduced first, on unchanged code.** Chrome through Playwright against `vite --mode desktop`.
A project with one imported square and no file. Real key presses (the route, then Enter on
**Save**), a save picker stub held open for a set time, an open picker stub that recorded
`navigator.userActivation.isActive` and threw Chromium's `SecurityError` when it was false, and
plain waits with no page calls. Times are from the start of the route.

| Route | Save picker open for | Open picker asked | `isActive` | Result |
|---|---|---|---|---|
| Ctrl+O | 6 s | 7,923 ms | false | "Could not open project: Failed to execute 'showOpenFilePicker' on 'Window': Must be handling a user gesture to show a file picker." |
| Toolbar **Open** | 6 s | 7,929 ms | false | the same toast |
| **File → Open template** | 6 s | 8,044 ms | false | "Could not open template: Failed to execute 'showOpenFilePicker' …" |
| Ctrl+O (control) | 1 s | 2,740 ms | true | the open picker opened |

Not refuted. The brief named two routes; the check found a third. Ctrl+O does not go through
`openProjectCommand`: `shortcuts.ts` calls `handleOpenProject` itself.

**The fix.** `pickFilesToOpen` (`src/ui/app/pick-files-to-open.ts`) now asks for the file inside
`handleOpenProject` and `openProjectTemplate`. While the activation is live it opens the picker
at once. Once it has lapsed it shows the fresh-click dialog that saves already use, titled
**Open project** or **Open template**: "`<name>` is saved. Choose the project to open." with
**Cancel** and **Choose file…** (focused). The Open's guards (request epoch, document epoch,
project revision, `stillAllowed`) are asked again while the dialog waits and at the click.

**The same check after the fix.**

| Route | Save picker open for | What appeared | Open picker |
|---|---|---|---|
| Ctrl+O | 6 s | **Open project**, 14 ms after "Saved project to untitled.lf2" | asked on Enter (**Choose file…** had the focus), `isActive` true, no error toast |
| Toolbar **Open** | 6 s | **Open project**, 13 ms after the save | the same |
| **File → Open template** | 6 s | **Open template**, 17 ms after the save | the same |
| Ctrl+O (control) | 1 s | no dialog | asked 2 ms after the save, `isActive` true, as before |

**Also changed.** A file dialog that is still refused for want of a click now reads "The file
dialog did not open, because too much time had passed since your last click or key press. Try
again." in place of the browser's exception text (open, save and folder pickers).

**Checks for this follow-up.** Unit: `pick-files-to-open.test.ts` (10 tests),
`open-after-slow-save.test.ts` (10), `SaveReadyDialog.test.tsx` (4) and the new cases in
`web-adapter.test.ts` (5), with the suites that open projects and templates. E2E in Chrome:
`e2e/open-after-slow-save.e2e.ts` (4 tests: quick save with no dialog, slow save with
**Choose file…**, Cancel, Open template). No shared e2e fixture changed.

## Checks

- Unit: `gcode-save-flow.test.tsx` (14 tests), `gcode-save-flow-other-saves.test.ts` (4),
  `project-save-fast-path.test.ts` (6), and the updated save suites: 74 files, 499 tests, all
  passing. The boundary is tested at 4,999 ms (picker opens) and 5,000 ms (asks for a click)
  against a model of the measured 5 s.
- Bytes: `gcode-save-flow.test.tsx` compares the one-action save with the prepared export, on the
  web and desktop adapters. Nothing under `src/io` or `src/core` changed, and the existing G-code
  snapshot tests pass unchanged (6 files, 57 tests, no snapshot rewritten).
- E2E in Chrome: `save-gcode-one-action.e2e.ts` (4 tests) and `project-save-worker.e2e.ts` (3),
  plus every spec this change edited or whose fixture it edited that was run here (Focus Test,
  white knockout, topology repairs, V-carve conversion, workbench, large raster, Photo raster,
  saves by download, and the four Save G-code tests of `production-workflows.spec.ts`): all pass.
  Not run here: the other specs that import `fixtures/project-save.ts`; CI runs them.
- Lint and Prettier on every changed file: clean. Type check: a narrow program over the changed
  source, test and e2e files, clean apart from the known `findLast` library error in an untouched
  file; CI runs the full one.
