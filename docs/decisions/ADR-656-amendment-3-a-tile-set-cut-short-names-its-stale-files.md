## ADR-656 Amendment 3 - A tile set cut short names the files it did not replace (2026-10-27)

**Status:** Accepted. | **Date:** 2026-10-27
**Fixes:** rolling audit v5 J2-P2-2 (P2). **Builds on:** decision 5 of this ADR and ADR-392
Amendment 2 decision 4 (the tiled save names the files it replaces).

### Context

A tiled G-code save writes one file per tile into the chosen folder and stops at the first failed
write, such as a full disk or a lost permission. Decision 5 keeps an existing file's contents when
its write fails. So a save into a folder holding an earlier save of the same job left the failed
tile, and every tile after it, with the earlier save's contents under this save's names. In a
four-tile set whose second write failed, three files were stale. The toasts said "Saved 1 of 4
tile files." and named the failed write, but never called the rest stale, and the earlier-files
check left out every name this save planned.

### Decision

1. **A set cut short says it is incomplete:** "Saved 1 of 4 tile files, so the set is
   incomplete. Save it again before cutting."
2. **The names it did not replace are named as an error.** Those of this save's names that the
   folder already held, from the failed write on: "These files still hold an earlier save, not
   this one, because this save stopped before replacing them: … Delete them, or save the tiles
   again, before cutting." Only the files this save wrote are called replaced.
3. **Nothing is removed or renamed.** Inspecting the folder never changes it
   (`SaveDirectoryTarget.listFiles`), and deleting files the operator did not ask to delete, on an
   error path, was judged worse than naming them. Writing every tile to a temporary name and then
   swapping them in was considered again and set aside for decision 5's reason:
   `FileSystemHandle.move()` is not in the WHATWG File System standard, and its support in
   user-picked folders is unconfirmed.
4. A save through per-file pickers, with no reserved folder, cannot see the folder. Its
   incomplete-set message (1) still says to save again.

### Tests

`src/ui/app/save-tiled-gcode-partial.test.ts` runs the real web adapter on the Chromium file model
(`chromium-save-picker.test-support.ts`). A second write that fails on a full disk leaves the later
tiles with the earlier save's contents, and the save names each of them. A folder that held none
of the names gets no stale warning, and a complete set keeps its success message.
