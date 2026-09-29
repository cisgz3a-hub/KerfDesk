## ADR-378 Amendment 1 - A project dropped on the window opens like a double-click (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

### Context

The desktop gap audit of 2026-09-29 (item 11) found that dragging a KerfDesk (`.lf2`) or LightBurn
(`.lbrn`, `.lbrn2`) project onto the window was rejected as an unsupported file, while dragging
artwork in worked and a double-click in Explorer opened the same file (ADR-378). LightBurn opens a
project dropped on its window.

### Decision

1. A drop that holds a project file opens the first one through the same path as a file the
   operating system hands over (ADR-378 items 6 and 8): behind the Save / Don't Save / Cancel question
   when the current project has unsaved changes, and never over a running job or an open dialog,
   where it waits in the banner until the operator opens it.
2. The other files in that drop are not imported, because the project replaces the document they
   would have joined. A warning names the project and how many files were ignored.
3. A drop without a project is imported as before. The drag overlay reads "Drop to open or
   import".
4. Recent Projects lists a dropped project by name, and it reopens through the file picker: the
   window gets the file's contents, not a path or a handle it can reach again.

### Consequences

- Dragging a project onto the web or desktop app opens it, with the same safeguards as File >
  Open.
- Save after opening a dropped project asks where to save, as after a double-click.
- This decision operates no machine and changes no output.

### Tests

`src/ui/recent-projects/dropped-project-open.test.ts` covers the open, the unsaved-changes
question, a mixed drop and the job banner; `src/ui/app/use-import-drag-drop.test.tsx` covers the
window drop.
