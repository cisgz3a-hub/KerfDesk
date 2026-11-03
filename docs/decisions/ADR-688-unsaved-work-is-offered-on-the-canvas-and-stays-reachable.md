## ADR-688 - Unsaved work is offered on the canvas and stays reachable; a browser that can't save says so

**Status:** Accepted; code and unit evidence. | **Date:** 2026-11-03

Amends the recovery presentation of ADR-305 decision 7 and records the move made by #1137
(ef9f5435c), which no ADR covered. Keeps the Chromium-only web app of PROJECT.md "Delivery
targets" and WORKFLOW F-A9 step 7: no second persistence path is added.

### Context

New-user audit U1 (2026-11-03, `docs/audits/2026-11-03-ux-u1/U1-install-first-launch.md`) acted as a
beginner on a production build, and a refuter confirmed both findings.

- **U1-P2-3 (raised to P1).** #1137 replaced the recovery banner with a 12 px grey "Recover autosave"
  link at the right end of the status bar. A beginner who closes the tab and returns sees an empty
  canvas and "Your artwork starts here". Any edit retires the offer, and the next launch offers only
  the newest snapshot (ADR-305 decision 5), so the first design stays in IndexedDB but no part of
  the app reaches it.
- **U1-P2-1.** Firefox and Safari have no `showOpenFilePicker` or `showSaveFilePicker` (MDN
  browser-compat-data). The app loads and draws, then Open, Import and Save fail with "File System
  Access API is required…". Ctrl+O on an edited canvas asks to save, the Save fails, and only Cancel
  or Don't Save remain. Drag-and-drop import works but is never mentioned.

### Decision

1. **A card on the canvas asks.** When startup recovery finds unsaved work and the opening project
   is still empty and untouched (ADR-305 decision 5, unchanged), a card centred on the canvas reads
   "Your last session wasn't saved. Restore it?". It shows a picture of vector artwork (Autosaves
   hold no file name; images, reliefs and very large scenes show only the count), the object count
   and how long ago it was saved, with **Restore** and **Start fresh**. It is not modal, takes no
   focus and blocks nothing; the corner cards (ADR-500) keep their place. The status-bar link is
   removed. The same renderer code runs in the desktop app, where the card says "on this computer".
2. **Start fresh keeps the autosave.** It closes the card without clearing or rewriting the slot,
   and the card does not ask about that same snapshot again (a short list of declined snapshots in
   localStorage). Newer unsaved work is asked about as before. Editing or opening a project
   retires the card the same way.
3. **File > Recover unsaved work… lists earlier sessions.** The autosave service's `readRecent()`
   returns every eligible slot newest first, excluding this window's own slot (the work on screen)
   and live windows' slots, as ADR-305 decision 4 already excludes them. The dialog shows up to 10
   with picture, object count and save time. Restore goes through the ordinary Save / Don't Save /
   Cancel question for the open document, then restores exactly as startup recovery does: load,
   mark dirty, re-home into this session's slot, then clear the source (ADR-305 decision 5, M15).
   Unsaved slots are still removed only by Restore, by Don't Save on the restored document, or by
   the existing unreadable-slot retirement. Nothing new prunes them.
4. **A browser without file pickers is told as it opens.** `PlatformAdapter.filePickersAvailable`
   reports whether both pickers exist (absent means yes, as on the desktop app). When they are
   missing, a banner above the workspace reads "This browser can't open or save files. Use Chrome
   or Edge, or the desktop app.", says that dragging files onto the canvas still imports them and
   that work is autosaved in this browser, links to the download page, and hides with **Not now**
   until the next launch. The picker errors say the same in place of the API name.
5. **No dead Save.** Where the pickers are missing, the Save-changes question becomes "Unsaved
   changes" with **Cancel** (first, initial focus) and **Don't Save** only, and explains why. A
   `save` choice that arrives anyway is treated as Cancel and never opens a picker.

### Consequences

- A returning beginner sees their work on the canvas they are looking at, and a missed or declined
  offer no longer makes earlier work unreachable.
- Storage held by abandoned sessions grows as before: this decision adds a way to reach it, not a
  cap. A future cap or Remove action needs its own decision, because removing a slot discards work.
- Firefox and Safari users learn the limit before they invest work, and keep it in autosave.
- No change to burns, G-code, Frame, Start, licensing or the project file format.
