## ADR-656 - Save pickers open only once the file is ready (2026-10-22)

**Status:** Accepted | **Date:** 2026-10-22
**Fixes:** rolling audit v2 (2026-10-21) findings 19-P2-1 and 19-P3-3
(`docs/audits/2026-10-21-rolling-v2/19-platform-web.md`).
**Amends:** WORKFLOW F-CNC25 (the surfacing destination is chosen after preparation, not at the
Save click) and the `PlatformAdapter.pickFileForSave` contract in `src/platform/types.ts`.

### Context

- The WICG File System Access `showSaveFilePicker` algorithm sets the chosen entry's binary data
  to an empty byte sequence before it resolves. Chromium's `SELECT_SAVEAS_FILE` branch runs
  `CreateAndTruncateFile` before it hands back the handle. The desktop app uses the same
  `webAdapter.pickFileForSave`, so Electron empties the file the same way. When the operator
  confirms Replace, the old contents are gone the moment the picker returns.
- Several saves picked first and then did work that can fail or be cancelled: surfacing
  (preflight, generation, **Cancel surfacing save**), SVG, DXF, PDF/AI/EPS/GeoJSON artwork
  exports (variable text, embedded images), `.rd` (worker compile), timelapse video (encode),
  processed bitmap (hydrate, build, encode), the multi-file trace per-file writer (abort check),
  Save Original Image, Save Preview Image, the Inspector's Save as STL, Save as template and the
  preserved Pro project copy (asset reads). A failure or Cancel left the chosen file at 0 bytes,
  breaking F-CNC25's "existing file contents survive preflight, generation, or write failures".
- The picker needs the click's transient activation (5 s in Chromium). Several of those saves
  picked first for that reason: a slow preparation would otherwise lose the activation.
- The adapter test "does not open or truncate the file until prepared data is written" passed
  only because its mock picker could not truncate.
- Folder saves (`reserveSaveDirectory`) call `getFileHandle(name, { create: true })`, which
  creates an empty entry, before the write. A failed write left that empty file, and the next
  multi-file trace avoided the name and wrote `-2`.

### Decision

1. **Every save prepares all its bytes before it opens the save picker, and writes straight
   after.** Nothing that can fail or be cancelled runs between the pick and the write. The
   `pickFileForSave` contract says the chosen file is already empty when it resolves.
2. **`pickPreparedSaveTarget` (`src/ui/app/pick-prepared-save-target.ts`) opens the picker for
   prepared output.** While the click is still active (`navigator.userActivation.isActive`), it
   opens the picker at once. Otherwise it shows a small dialog naming what is ready (for example
   "Save timelapse video: The timelapse video is ready.") with **Cancel** and **Choose file…**,
   and the picker opens inside that fresh click, as the large project Save already does with
   `ProjectSaveDialog`. An abort closes the dialog. Once the picker is open, its
   answer stands. *(Extended by
   [Amendment 4](ADR-656-amendment-4-a-save-ready-in-time-opens-its-picker-at-once.md): Save
   G-code and the large project save open the picker at once too, and their "Preparing…" dialog
   appears only after 400 ms. Extended by
   [Amendment 5](ADR-656-amendment-5-an-open-that-outlasted-its-click-asks-for-a-fresh-one.md):
   an Open that had to wait for Save asks for its file the same way.)*
3. **The pick is the commit.** After it, no Cancel is offered. A save cancelled while the picker
   was open still writes its prepared bytes, because the picker has already emptied the file.
4. **Surfacing stages the whole program first.** Preflight and generation finish, with **Cancel
   surfacing save** available, before the destination is chosen. The program is collected into
   Blob parts in 1 MiB batches, so the page heap holds one batch at a time. The panel shows
   "Checking surfacing program…", then "Choose where to save the surfacing program…", then
   "Finishing surfacing save…" (no Cancel). `SaveTarget.writeChunks` and `writeSaveChunks` are
   removed: surfacing was their only caller, and discarding staged bytes could not protect a file
   the picker had already emptied.
5. **A failed folder write removes the entry that save created.** The adapter checks whether the
   name exists before creating it. If the write fails, a new entry is removed
   (`FileSystemDirectoryHandle.removeEntry`), and an existing file keeps its old contents. A
   temporary name plus rename was considered, but `FileSystemHandle.move()` is not in the WHATWG
   File System standard or TypeScript's DOM types, and its support for files in user-picked
   folders could not be confirmed. `removeEntry` is standard. *(Extended by
   [Amendment 3](ADR-656-amendment-3-a-tile-set-cut-short-names-its-stale-files.md): a tiled save
   that stops at a failed write names the earlier files it left under its names.)*
6. **Tests model Chromium.** `src/platform/web/chromium-save-picker.test-support.ts` empties the
   chosen file on pick and stages writes in a swap file. Each fixed save has a regression test
   that runs the real web adapter against it.

### Consequences

- A preparation failure is reported before any file dialog opens, and an existing file is left
  as it was.
- A preparation that outlasts the click's activation needs one more click (**Choose file…**).
- A write I/O failure after the pick still leaves the chosen file empty. The web platform gives
  no way to keep it. Project Ctrl+S over an opened `.lf2` is not affected: it writes through a
  swap file and never opens the picker.
- Not changed here: saves whose only post-pick step is a stale-document check (stamp export,
  CNC wrap study, relief component, personal artwork). A document change while the native picker
  is open is rare, and whether to write the bytes captured at the click or refuse is a separate
  decision. Saves whose post-pick step is a pure serialization, and the support report (its
  gathering catches its own failures), keep their order.
