## ADR-550 - Save writes over the project you opened (2026-09-29)

**Status:** Accepted. Unit-tested; not yet tried in a packaged Windows build or a browser with a
real file. | **Date:** 2026-09-29 | **Builds on:** ADR-378 (Recent Projects and operating-system
opens; this decision amends its point 7) and F-A11 (Save Project)

### Context

The desktop gap audit of 2026-09-29 (item 4) found that after Open, Open Recent or a double-click
in Explorer, the first Save showed the Save dialog, which could start in another folder, so people
ended up with copies of their projects. Every load cleared the save destination, the handle a
picked file came with was kept only for Recent Projects, and a file Explorer handed over could
only be read back through main (ADR-378 point 7).

### Decision

1. **Open remembers where the project came from.** When a KerfDesk project (`.lf2`) opens from a
   file the platform can write back, that file becomes the Save destination, so File > Save and
   Ctrl+S replace it with no dialog. Save As still asks.
2. **Only KerfDesk's own projects.** A LightBurn file (`.lbrn`, `.lbrn2`) opens as an import and is
   never written; its first Save asks where to save the `.lf2`, as for templates and for projects
   dropped on the window, which arrive without a file handle.
3. **A file picked in the app or the browser.** Open gives the handle read access only, so the first
   write asks Chromium for write access, from the Save click. The browser shows its prompt once;
   the desktop app's permission handler already allows file access for its own page. A refusal
   fails the save with "KerfDesk may not change `<name>`. Use Save As to save a copy." and nothing
   is written.
4. **A file Explorer handed over (desktop).** ADR-378's routes gain one write:
   `PUT app://app/api/desktop-project-file?path=&token=`. It needs main's token for exactly that
   path, the `X-KerfDesk-Project` header and a same-origin request from the app's own page, and
   `application/octet-stream`. Main checks the path again as ADR-378 describes and accepts only
   `.lf2`, on the named path and on the real path behind any link. It writes the bytes to a new
   file beside the project and then renames it over the project, so a failed or cut-off save
   leaves the old file whole. The rename waits briefly for a virus scanner or sync client that
   holds the file. A save over 1 GiB is refused.
5. **Failures say why and leave the project unsaved.** A file that has gone, lost its permission,
   became read-only or stays held by another program reports that, and Save As still works.

### Consequences

- Opening a project and pressing Ctrl+S saves it where it was, as desktop programs do.
- An older project opened in this version is saved in the current format. Earlier KerfDesk versions
  then report a newer project instead of misreading it (F-A12).
- The desktop main process can now write, not only read, the `.lf2` files the operating system
  handed over. A compromised page still cannot name any other file, and can never write a
  LightBurn file or anything outside those paths.
- The web app's first Save after Open shows Chromium's own permission prompt.

### Tests

`electron/desktop-project-save-route.test.ts` covers the route's checks and answers, and
`electron/desktop-project-save.test.ts` the whole-file replacement, the size limit, a cut-off
save and a held file. `src/platform/electron/desktop-project-save.test.ts` and
`src/platform/web/opened-project-save-target.test.ts` cover the renderer's save targets and the
write permission, and `src/ui/app/project-open-save-target.test.ts` covers Open handing Save the
opened file.
