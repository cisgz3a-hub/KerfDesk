## ADR-554 - File > Exit and Help > Open Data Folder in the desktop app (2026-09-29)

**Status:** Accepted. Unit-tested; not yet tried in a packaged Windows build. | **Date:** 2026-09-29 |
**Builds on:** ADR-549 (Save, Don't Save or Cancel when closing), ADR-546 (the support log),
ADR-548 (the `app://app/api/desktop/` routes)

### Context

The desktop gap audit of 2026-09-29 found two missing Windows staples. Item 16: there is no
File > Exit, so the only ways out are the window's X and Alt+F4. Item 19: nothing tells a customer
or support where KerfDesk keeps its settings, licence record and log. The folder is still called
`laserforge` (ADR-378's pinned data path), which nobody would guess.

A renderer's own `window.close()` does not help with Exit: it destroys the page without the
window's close event, so the unsaved-changes question (ADR-549) and the job Abort handoff never
run.

### Decision

1. **Exit quits through the close guard.** File > Exit, shown only in the desktop app, sends
   `POST app://app/api/desktop/exit`. The main process answers first and then calls `app.quit()`,
   the same path as the operating system's Quit: each window asks Save, Don't Save or Cancel for
   unsaved changes, a running job gets the Abort handoff, and Cancel keeps KerfDesk open.
2. **Open Data Folder opens the pinned data folder.** Help > Open Data Folder, desktop app only,
   sends `POST app://app/api/desktop/data-folder`, and the main process opens
   `app.getPath('userData')` in the file manager. When the file manager cannot open it, the route
   answers 500 with the folder's path, and the window names the folder in an error toast.
3. **Same checks as the other routes.** Both routes take the exact `app://app` address, the
   `X-KerfDesk-Desktop` header and a same-origin request (`electron/app-route-guard.ts`), and
   answer 404 otherwise. They take no input: no path or command crosses from the page.

### Consequences

- Exit behaves exactly like the window's X, so it adds no new way to lose work or leave a job
  running.
- Support can say "Help > Open Data Folder" instead of spelling out `%APPDATA%\laserforge`.
- Opening a folder in Explorer is the only new thing a page can ask for, and only for that one
  folder.
- An option to remove the data folder when uninstalling (the rest of item 19) is left for later:
  it needs an uninstaller page that must not run during updates.

### Tests

`electron/desktop-window-commands.test.ts` covers both routes, answering before quitting, the
failure reply and the refused requests. `src/platform/electron/desktop-window.test.ts` covers the
window's requests and messages, `src/ui/commands/desktop-window-command-context.test.ts` the
toasts, and the menu control audit clicks both commands through the menu.
