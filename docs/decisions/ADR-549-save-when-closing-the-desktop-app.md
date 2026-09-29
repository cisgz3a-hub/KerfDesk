## ADR-549 - Save, Don't Save or Cancel when closing the desktop app (2026-09-29)

**Status:** Accepted. Unit-tested; not yet tried in a packaged Windows build. | **Date:**
2026-09-29 | **Builds on:** ADR-482 (the desktop shell), the desktop close handoff
(`electron/window-close-guard.ts`) and the unsaved-changes guard (H-U6)

### Context

The desktop gap audit of 2026-09-29 (item 3) found that closing KerfDesk with unsaved changes asks
"Leave without saving?" with only **Leave** and **Stay**, and **Leave** is the default, so pressing
Enter throws the changes away. The usual desktop question offers Save, Don't Save and Cancel, with
Save as the default. Autosave usually lets people recover, but only if they know to look for it.

### Decision

1. **Closing asks Save, Don't Save or Cancel.** When the window closes, or KerfDesk quits, with
   unsaved changes and no job running, the question is "Save your changes before closing
   KerfDesk?" with **Save** (the default, so Enter keeps the work), **Don't Save** and **Cancel**
   (also Esc).
2. **Save is the project's own Save.** The main process asks the window to save through the same
   fixed close handoff it already uses (`save` beside `prepare`, `approve` and `cancel`). The window
   runs File > Save: the same file as the last save, or the Save dialog for a new project. Main runs
   that step as the operator's gesture, so Chromium may show its file picker. There is no time
   limit, since the operator may be choosing a folder.
3. **The close goes on only after a finished save.** If the save is cancelled or fails, KerfDesk
   stays open with the changes unsaved and the error on screen. A finished save changes the
   document, so the approval that follows starts the close again with the saved project, which
   is clean and closes without another question.
4. Only the window's own close asks this. A page navigation keeps the Leave or Stay question, and a
   close during a job keeps the Abort handoff first; the question comes after it, as before.

### Consequences

- Pressing Enter at the close question keeps the work instead of discarding it.
- A save that ends with newer edits, or an error, keeps the window open, so no close throws away
  changes the operator did not choose to lose.
- The web app is unchanged: browsers show only their own leave-site prompt.
- No new renderer capability: `save` is one more fixed operation in the same DOM event, and the
  window has no preload or IPC.

### Tests

`electron/window-close-save.test.ts` covers Save, a save that does not finish, Don't Save, Cancel,
a save that finishes after the window closed, and navigations keeping Leave or Stay.
`electron/desktop-window-close.test.ts` covers the question's buttons and default and that only
the save step runs as a gesture. `src/ui/app/desktop-close-save.test.ts` covers the window side,
driven by the script the main process runs.
