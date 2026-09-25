## ADR-378 - Recent Projects, and project files opened from the operating system (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Extends ADR-249 item 4 (exact same-origin `app://` routes instead of a preload or IPC) with three
more routes, and the single-instance behaviour in `electron/main.ts` with a project hand-over.
There is still no preload and no `ipcMain` surface.

### Context

LightBurn's File > Recent Projects is "a running list of up to 24 projects recently opened in
LightBurn" (<https://docs.lightburnsoftware.com/latest/Reference/UI/FileMenu/>), and LightBurn
opens a project double-clicked in Explorer. KerfDesk had neither. Every open went through the
file picker, WORKFLOW.md F-A1 still promised "File > Open Recent (Phase C)", and a second desktop
launch only raised the running window, dropping any file it was given.

Three constraints shape the design:

- The web app can reopen a file only through a File System Access handle. A handle kept in
  IndexedDB survives a restart, but Chromium resets its read permission and asks again only
  straight after a click.
- The desktop renderer is sandboxed with no preload and no IPC (ADR-024, ADR-249). Main cannot
  hand it a path or bytes except through a route the renderer fetches.
- A double-click in Explorer can arrive in the middle of a job, from someone who did not see that
  the machine is running.

### Decision

1. **A workstation list.** Recent Projects lives in this browser profile's IndexedDB
   (`kerfdesk-recent-projects`), never in a project file. A successful open or save records the
   file. The same file reopened moves to the top instead of being listed twice: same name first,
   then the platform's identity check (`isSameEntry` for handles; the path, case-insensitive on
   Windows, for desktop paths; name, size and modification time between a handle and a path).
   Several windows update one stored list inside one IndexedDB transaction each. A browser that
   cannot store a handle keeps the name only, and that entry reopens through the picker.
2. **Length and pins.** 10 unpinned projects by default, settable from 1 to 24, LightBurn's
   ceiling. KerfDesk adds pins: up to 24 pinned projects stay on top, never fall off and are not
   counted in the length, so a new open always has a place. The setting is kept in
   `localStorage` on this computer.
3. **Where the list appears.** The foot of the File menu lists the projects for one-click
   reopening, where LightBurn has its submenu. **File > Recent Projects...** opens a manager with
   each project's name, folder (only for files the desktop operating system opened; a browser
   never reveals one), when it was last opened or saved, **Open**, **Pin**/**Unpin**,
   **Remove**, **Clear unpinned**, **Clear all** and the length setting. There is no start
   screen (F-A1), so no list there.
4. **Missing files stay listed.** When a check finds a file gone, the menu and the manager mark
   it Missing and it stays until the operator removes it. Reopening it, or a file whose
   permission was refused, opens the manager with the reason and **Choose file...**. Checks
   never prompt for permission.
5. **Reopen order.** The file is read first, while the click still counts as a gesture for the
   browser's permission prompt, then the unsaved-changes guard runs exactly as for File > Open.
   Like File > Open, Recent Projects stays available during a job; it is an in-app command, and
   ADR-228 adds no guards to those.
6. **Operating-system opens on the desktop.** The Windows installer associates `.lf2` with
   KerfDesk (the macOS Preview declares the same document type). `.lbrn` and `.lbrn2` are not
   associated, because that would take LightBurn's own files away from LightBurn; they still
   open when named on the command line or chosen with Open With. The single-instance lock carries
   a second launch's project paths in its `additionalData` (its argv is the fallback, since
   Chromium may reorder switches), and macOS `open-file` events are taken as well. Main queues at
   most 16 paths and signals the trusted renderer with a fixed script that carries no data; the
   renderer then collects them.
7. **Three exact routes, and nothing else readable.** On the existing `app://` handler, with
   ADR-249's validation (GET only, exact scheme, host and path, exact query keys, no
   credentials, port or fragment):
   - `/api/desktop-project-opens` drains the queue into `{ name, path, token, size }` or
     `{ name, reason }` for a file that is missing, not a project or unreadable;
   - `/api/desktop-project-file?path=&token=` returns the file's bytes;
   - `/api/desktop-project-status?path=&token=` returns present with size and time, or missing.

   A path is served only with main's token for exactly that path: an HMAC-SHA256 under a 32-byte
   per-install key in `userData`, minted only when the operating system handed the path over.
   Recent Projects keeps `{ path, token }`, so entries reopen after a restart, while a
   compromised page still cannot name any other file. Before every answer main checks the path
   again: absolute and canonical, a project extension, links resolved, a project extension on
   the real path too, and a regular file. The renderer parses every response fail-closed.
   `contextIsolation`, the sandbox, the CSP and the serial rule of ADR-366 are unchanged.
8. **Jobs and open dialogs are never interrupted.** A file the operating system hands over while
   a job runs, or while a modal dialog is open (Job Review, Machine Setup, another
   unsaved-changes question), does not replace the project. It waits in a nonmodal banner whose
   **Open project** button is available whenever no job runs; a newer file replaces a waiting
   one and **Dismiss** drops it. The job check runs again after the unsaved-changes dialog,
   which can stay open while a job is started, and immediately before the parsed file replaces
   the document. A job that starts while either a native or LightBurn file is being read keeps
   that file in the banner; the banner's Open project action repeats the same check.
   This is not a Start guard: nothing the operator
   asks for inside the app is blocked. It only stops an event from outside the app from
   replacing the document unasked.
9. **Installed web app.** The PWA manifest registers `.lf2` in `file_handlers` with
   `launch_handler` `focus-existing`; `launchQueue` hands the file to the open window and it
   follows the same path as a desktop open. Browsers without these members are unaffected.

### Consequences

- An operator can reopen recent work from the File menu, manage the list, and double-click a
  `.lf2` in Explorer, Finder or (installed web app) the file manager to open it in the running
  window, behind the usual unsaved-changes question.
- The routes are unreachable from the development server (`LASERFORGE_DEV_URL`), as the Preview
  update route is; operating-system opens need a packaged build.
- Files opened with the in-app picker, on the desktop too, are remembered by handle: no folder is
  shown, and a restarted browser may ask for permission once more. Files opened from the
  operating system are remembered by path.
- Losing the key file only means those entries must be chosen again: the file route answers
  "not allowed" and the manager offers **Choose file...**.
- A macOS Finder open that arrives before any window exists waits in main's queue until the
  renderer collects it.
- Real-OS checks for the association, the second-launch hand-over and the job banner are added to
  WORKFLOW.md F-DESK3 and described in F-DESK4.
