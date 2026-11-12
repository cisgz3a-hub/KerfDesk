## ADR-656 Amendment 5 - An Open that outlasted its click asks for a fresh one (2026-11-11)

**Status:** Accepted. Amends ADR-656 (decision 2) and ADR-656 Amendment 4 (Consequences). | **Date:** 2026-11-11
**Fixes:** what remained of annoyance audit A1 (2026-11-11) finding A4-P3-2 (P3)
(`docs/audits/2026-11-11-annoyance-a1/`, after fix group F6).
**Amends:** WORKFLOW F-A12 (Open Project), F-A13 (the unsaved-changes question) and the
**File → Open template** passage.

### Context

**File → Open** over unsaved work asks **Save changes?** first (`confirmDiscardAsync`). When the
project has no file yet, **Save** opens the OS Save dialog. The OS Open dialog that follows runs
on the click that answered **Save**. Chromium opens a file dialog only within 5 s of the last
click or key press, in the browser and the desktop app alike (measured in Amendment 4). A person
who takes more than 5 s to choose a folder and a name leaves the open picker no activation.

Reproduced on unchanged code in Chrome, with real key presses, a save picker held open for 6 s
and no page calls while it was open (Playwright's own page calls renew the activation). The page
recorded its own state:

| Route | Open picker asked | `navigator.userActivation.isActive` | What the operator saw |
|---|---|---|---|
| Ctrl+O, then Enter on **Save** | 7,923 ms after Ctrl+O | false | "Could not open project: Failed to execute 'showOpenFilePicker' on 'Window': Must be handling a user gesture to show a file picker." |
| Toolbar **Open**, then Enter | 7,929 ms | false | the same toast |
| **File → Open template**, then Enter | 8,044 ms | false | "Could not open template: Failed to execute 'showOpenFilePicker' …" |
| Ctrl+O, save picker open 1 s (control) | 2,740 ms | true | the open picker |

The project was saved each time, and pressing Open again worked. Three routes reach an open
picker behind the question: `openProjectCommand` (the menu and toolbar, and Recent Projects when
it falls back to the file picker), the Ctrl+O shortcut, which calls `handleOpenProject` directly
(`shortcuts.ts`), and `openTemplateCommand`. The other callers of `confirmDiscardAsync` (New, the
calibration generators, a production row, a local snapshot, Recover unsaved work) open no picker
afterwards. A recent project that reopens directly, or a file handed over by the operating
system, arrives with its file and opens no picker either.

### Decision

1. **An Open asks for its file through `pickFilesToOpen`** (`src/ui/app/pick-files-to-open.ts`),
   called where `handleOpenProject` and `openProjectTemplate` used to call the platform picker.
   Putting it there covers all three routes, the shortcut included.
2. **While the activation is live, nothing changes.** `hasPickerActivation()` is true, the picker
   opens at once and no dialog of ours appears.
3. **Once it has lapsed, a small dialog asks for a fresh click.** Its title is **Open project** or
   **Open template**. It reads "`<name>` is saved. Choose the project to open." with **Cancel**
   and **Choose file…**, and the picker opens inside that click. It is the dialog
   `pickPreparedSaveTarget` uses for saves (`SaveReadyDialog`, with `picks: 'open'` in its store
   request), so only one fresh-click dialog can be open at a time.
4. **"is saved" is said only when it is true.** The line is read from the document: not dirty and
   named. **Don't Save** with a slow clean-up reaches the same dialog, which then reads only
   "Choose the project to open."
5. **Choose file… has the first focus.** The operator has just answered **Save** and the OS Save
   dialog, often by keyboard; Enter continues the Open and Esc cancels it. Saves keep their
   order, with the first focus on **Cancel**.
6. **Every guard is asked again at the fresh click, and while the dialog waits.** The dialog can
   stay open for a long time. `stillWanted` is the Open's own owner check (the request epoch, the
   document epoch and the project revision) with `stillAllowed`. It is asked when the dialog is
   due, on every document change while it is open, and at the click. False closes the dialog and
   opens no picker. The existing checks after the picker and before the commit stay as they were.
7. **Cancel changes nothing.** It resolves no file, as a dismissed picker does. The saved project
   stays open, still saved, with no toast.
8. **A refused picker speaks plainly.** Should one still be refused for want of a click, the web
   adapter (`pickerError` in `web-adapter.ts`) replaces the browser's exception text for the
   open, save and folder pickers: "The file dialog did not open, because too much time had passed
   since your last click or key press. Try again." A `SecurityError` raised while a click is
   still active has another cause and is passed on unchanged. Where `navigator.userActivation`
   is missing, the refusal is recognised by its text.
9. **A browser with no file pickers is not asked for a click.** A click would not help it. It
   reports at once that it cannot open files, as before (ADR-688).

### Considered

- **Open the open picker before saving.** The file to open would be chosen while the click is
  fresh. But the operator would choose the next project before knowing the current one was
  saved, and a failed save would leave a chosen file with nowhere to go.
- **Check in `openProjectCommand` only.** It would have missed Ctrl+O, which does not go through
  that command.
- **Retry the picker after catching the `SecurityError`.** A retry has no click either. The
  refusal cannot be recovered without the operator.
- **A toast saying "press Open again".** That is the behaviour being fixed, in kinder words: the
  operator still has to start over.
- **A dialog of its own.** A second store and component for the same two buttons, and two
  fresh-click dialogs could then be open together.

### Consequences

- Open over unsaved work no longer ends in an error after a slow save. The slow case costs one
  extra click or Enter, which the platform makes unavoidable.
- A quick save is unchanged: **Save changes?**, the OS Save dialog, the OS Open dialog.
- `SaveReadyDialog` now serves Opens too, despite its name. Its store request says which.
- After the fix, on the same real-clock check: **Open project** appeared 14 ms after the save
  (13 ms from the toolbar, 17 ms for **Open template**), Enter on **Choose file…** opened the
  picker with `isActive` true, and no error toast appeared.

### Tests

- `src/ui/app/pick-files-to-open.test.ts`: the picker at once while the click is active; the
  boundary at 4,999 ms and 5,000 ms against the measured 5 s model; the picker opening inside the
  **Choose file…** click; the saved line only when true; Cancel; an Open no longer wanted at the
  click, while waiting, and before the dialog; a picker failure.
- `src/ui/commands/open-after-slow-save.test.ts`: `openProjectCommand` and `openTemplateCommand`
  through **Save changes?** and a save picker that outlasts the click: no dialog after a quick
  save; the dialog, then the picker inside the click; Cancel leaving the saved project; a newer
  Open or a replaced document closing the dialog; a file picked under a replaced document
  dropped; no dialog for a recent project.
- `src/ui/app/SaveReadyDialog.test.tsx`: the Open wording and the first focus.
- `src/platform/web/web-adapter.test.ts`: the plain-words refusal for the open and save pickers,
  the other `SecurityError` left alone, a dismissed picker still read as no file.
- `e2e/open-after-slow-save.e2e.ts` in Chrome: Ctrl+O after a quick save reaches the open picker
  with no dialog; after a lapsed activation it asks for **Choose file…** and then opens the
  project; Cancel keeps the saved project; **Open template** the same way.
