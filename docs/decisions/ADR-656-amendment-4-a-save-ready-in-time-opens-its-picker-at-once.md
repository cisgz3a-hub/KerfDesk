## ADR-656 Amendment 4 - A save ready in time opens its picker at once, and a refusal is said once (2026-11-11)

**Status:** Accepted. Amends ADR-656 (decision 2, Consequences). | **Date:** 2026-11-11
**Fixes:** annoyance audit A1 (2026-11-11) findings A4-P2-4 (P2) and A1-P3-9 (P3), and reduces
A4-P3-2 (P3) (`docs/audits/2026-11-11-annoyance-a1/`, fix group F6).
**Amends:** WORKFLOW F-A9 (Save G-code) and F-A11 (Save Project).

### Context

Decision 2 says a prepared save opens its picker at once while the click is still active.
`pickPreparedSaveTarget` does. The two saves used most did not:

- **Save G-code** always opened a dialog, "Preparing your G-code file…", and then waited for a
  click on **Save as…**. Reproduced on a one-line job: the export was ready 128 ms after
  Ctrl+Shift+E and the picker had not been asked for.
- **Project Save As** did the same (**Choose file…**) for any project sent to the worker: 250
  objects, about 5,000 path points, a 375 KB image or embedded fonts (`project-save-size.ts`).
- **A refused export** raised a native alert ("Cannot save G-code: …") over that dialog, which
  then still needed **Cancel**. An empty canvas took both steps to say "No output layers." Tiled
  and `.rd` saves raised the same kind of alert.

**The activation limit, measured.** The desktop app has no save dialog of its own: Electron's
renderer calls the same `showSaveFilePicker` as the browser (ADR-656 Context). Probes in Chrome
157 and in the Electron 44.5.1 renderer (Chromium 152; the app pins 44.9.1, the same Electron
major) gave the same rule in both:

| Check | Chrome 157 | Electron 44.5.1 renderer |
|---|---|---|
| Picker with no click or key press | `SecurityError` | `SecurityError` |
| Still active after a click | 5,016 ms | 5,009 ms |
| Still active after Ctrl+Shift+E | 5,001 ms | not run |
| A second picker after the first closed, same click | opens | not run |

So one limit serves both platforms: a picker may open within 5 s of the last click or key press,
and opening one does not use the activation up. `navigator.userActivation.isActive` reports it.

### Decision

1. **Ready while the activation is live: the picker opens at once.** Save G-code
   (`gcode-save-flow.ts`) and a worker-prepared project save (`large-project-save.ts`) check
   `hasPickerActivation()` when preparation finishes. If it holds, they open the picker with no
   click in between. ADR-656 decision 1 is unchanged: every byte is prepared before the picker
   opens, and nothing that can fail runs between the pick and the write.
2. **The "Preparing…" dialog appears only after 400 ms** (`PREPARING_DIALOG_DELAY_MS`). A save
   that is ready sooner shows no dialog of ours at all. One that takes longer shows the dialog
   with **Cancel**, which aborts the preparation, and Save G-code shows the progress its worker
   reports ("Planning toolpaths: 3 of 12"). If the save is ready before the 5 s are up, the picker
   still opens by itself and the dialog reads "Choose a destination in the file dialog."
3. **Ready after the activation lapsed: one click, as before.** The dialog says the file is ready
   and waits for **Save as…** or **Choose file…**. The platform leaves no other way to open a
   picker.
4. **A CNC export keeps its dialog whenever it is ready.** **Save as…** or **Save setup sheet +
   program…**, with its output mode and filename, is a real choice (ADR-392). The dialog is not
   shown while the export prepares for less than 400 ms.
5. **A tiled or controller-specific save gets no dialog in front of it.** A tiled CNC save asks
   for its folder at the click, and a `.rd` save asks for its destination once compiled
   (`pickPreparedSaveTarget`); the old "Choose a destination for this prebuilt … export" step
   added a click and nothing else. With no dialog on screen while such a save compiles, one still
   working after 400 ms says "Preparing the export…" in a toast until it is done.
6. **One save at a time.** A second Save G-code request while one is under way is ignored. The
   modal dialog used to enforce this; the first 400 ms now have no modal.
7. **A refusal is said once.** Preparation returns its reasons instead of raising an alert
   (`prepareGcodeSave`, `prebuildGcodeSaveResult`). With no dialog open they are one error toast,
   "Cannot save G-code: <first reason>", with any further reasons folded under it (ADR-687's
   fold, one slot keyed `export-refused`). With the dialog open they are listed inside it with a
   single **Close**. Tiled and `.rd` refusals use the same toast ("Cannot export tiles: …",
   "Cannot save .rd file: …"). No save raises a native alert.
8. **The saved bytes do not change.** The same `prepareGcodeSave` output is written through the
   same `handleSaveGcode`, and the Save policy is untouched: Save refuses only the
   compile-integrity set Start refuses (`save-preflight-policy.ts`, ADR-228).

### Considered

- **Keeping the click once the dialog has appeared.** It would leave both shared e2e fixtures
  untouched, but a worker-prepared project that takes longer than 400 ms (the reproduced one took
  about 2 s) would keep the second click the finding is about.
- **No dialog at all inside the 5 s.** Up to 5 s with nothing on screen reads as a dead key.
- **A separate check for "no output layers" before preparing.** Not needed: that refusal comes
  back in milliseconds, before the dialog's delay, so no preparing step is shown. A second copy of
  the preflight rule would be free to drift from it.

### Consequences

- A laser export is one action: Ctrl+Shift+E, then the operating system's Save dialog.
- An error toast leaves after 8 s unless its notes are opened, where the alert waited for a click.
  The message is the same text, and Save G-code can be pressed again.
- Opening over unsaved work (A4-P3-2) is now at most **Save changes?**, the save picker and the
  open picker for a project ready within 5 s. Not fixed here: the open picker runs on the click
  that answered **Save changes?**, so a save picker left open for more than 5 s leaves it no
  activation and Open reports the browser's error. Checked for a small project too, whose path
  this amendment does not touch (`docs/audits/2026-11-11-annoyance-a1/F6-fix-save-dialogs.md`).
  *(Fixed by
  [Amendment 5](ADR-656-amendment-5-an-open-that-outlasted-its-click-asks-for-a-fresh-one.md):
  the Open then asks for a fresh **Choose file…** click.)*
- Tests that used the dialog as their slow path now state it: `lapseUserActivation()` in unit
  tests, `lapseClickActivation(page)` in e2e. Playwright runs its page calls with a user gesture,
  so an e2e cannot reach the lapse by waiting.

### Tests

- `src/ui/app/gcode-save-flow.test.tsx`: one action on the web and desktop adapters with no dialog
  state; the same bytes as the prepared export; nothing shown before 400 ms; ready at 4,999 ms
  opens the picker and at 5,000 ms asks for **Save as…** (`installTransientActivation` models the
  measured 5 s); progress; Cancel; a second request; the CNC dialog; a refusal as one toast and
  inside the open dialog.
- `src/ui/app/gcode-save-flow-other-saves.test.ts`: a `.rd` save with no dialog, its
  "Preparing the export…" toast, and a save that throws leaving the next one free to run.
- `src/ui/app/project-save-fast-path.test.ts`: the same boundary for a worker-prepared project,
  and no dialog for a refused or replaced one.
- `e2e/save-gcode-one-action.e2e.ts` and `e2e/project-save-worker.e2e.ts` in Chrome: a small job
  saves from Ctrl+Shift+E alone; a lapsed activation still shows the dialog and saves on the
  click; an empty canvas is one error toast with no native dialog.
