## ADR-590 Amendment 3 - A Studio drawing is kept by whether a copy on disk holds its Apply

**Status:** Accepted; tested with the real persistence hook, the Studio's Apply, the real autosave
loop, Save and Open marks, the app's close autosave and project round trips, not in a packaged
build. |
**Date:** 2026-11-02

Fixes rolling audit v9 R6-P1-1, R6-P1-2 and R6-P2-1
(`docs/audits/2026-11-02-rolling-v9/R6-fix-studio-bed.md`), each confirmed by an independent
refuter. Amendment 2 kept an applied drawing when the opened project "may be an earlier state" of
its project, and guessed that from what the two share.

### Context

- **The guess missed real losses (R6-P1-1).** After the autosave, deleting the applied line and
  applying three on a new Studio layer, or applying empty and then applying three, gave a drawing
  that shares no shape and no operation with the autosave a crash restores. The Studio opened the
  autosave's drawing and saved it over the only copy, with no notice. Opening another project with
  its own Studio drawing after the crash did the same.
- **The guess filled the five kept places (R6-P1-2).** A project with no Studio drawing always "may
  precede", so every File > New after Studio work kept that work's applied drawing, though its
  saved file held it. Five of them dropped a real unapplied drawing, with no notice.
- **The guess offered the previous project (R6-P2-1).** File > New, a restart or a project with no
  Studio drawing offered the last project's saved drawing as "An applied drawing this project does
  not hold". The bar never named the project, and Restore then Apply added that artwork to the job.
  A Discard came back after that file was opened in the Studio and left again.

### Decision

1. **The saved drawing records the fact.** With each saved Studio session the slot records the
   file its project was saved or opened as (`projectName`, null while untitled) and whether a
   saved file or an autosave holds its last Apply (`projectHoldsApply`). A document is held once a
   Save, an Open (or a restored autosave) or a successful autosave write, interval or close, has
   written or read a project carrying it (`ui/state/design-document-copies.ts`). Documents are
   compared by identity: only an Apply makes one. A later save to the same file that does not
   finish (`markProjectSaveUncertain`) drops the record until a copy holds it again. The Studio
   rewrites its slot when that changes, and the close autosave runs before the Studio's last
   write, so a web close records it.
2. **Keep, offer and evict from that fact.** A drawing with unapplied work is kept, as before. An
   applied one is kept when the opened project does not hold it and no copy on disk does, whatever
   the two share: a crash after any Apply offers it back, on any project. One a copy holds is not
   kept, so it takes no place and New offers nothing. A drawing saved before this amendment records
   neither, and Amendment 2's guess still decides it.
3. **Past five, the cheapest goes first, and the Studio says so.** An applied drawing a copy may
   hold goes first, then an applied one only it holds, then unapplied work; the oldest first in
   each. The drawing being kept is never dropped. A toast names what was dropped (its shapes, its
   project and when it was kept). Amendment 1 item 2's limit of five stays.
4. **The bar names the source project.** "A drawing applied to "Bracket.lf2" that no saved file or
   autosave holds was kept: …", or "A drawing you had not applied, from an untitled project, was
   kept: …". Restore's tooltip says Apply puts it in this project. A drawing kept before this
   amendment keeps Amendment 2's wording.

### Consequences

- Amendment 2's Consequences change: an Apply only the drawing holds is kept for another project
  with its own drawing too (the third route of R6-P1-1), and "Other projects are unchanged" now
  holds: a project that holds no Studio drawing is offered nothing a file holds.
- An applied drawing that only an autosave holds is not kept. Declining that autosave's restore
  discards it with the rest of the autosave, as declining always did. Choosing not to save at File
  > New or at a close does the same once an autosave has held it; before one has, the drawing is
  kept and named.
- A Discard sticks: the drawing a file holds is not kept again when that file is opened in the
  Studio and left.
- `worthKeeping` reads `projectHoldsApply`; `savedDesignDrawing(session, owner, project, name)`
  builds the slot. `markSaved`, `markLoaded`, the autosave loop, the close autosave and Restore
  record what a copy holds.
- Tests: `design-kept-drawings-copies.test.tsx` covers the two crash routes and another project
  first, a saved Apply for another project, the web close (`beforeunload` then `pagehide` with the
  app's `useAutosave`) and the desktop close (Save at the close question), five New actions with a
  real unapplied drawing, New with and without Studio use, an unsaved Apply named after New, a
  discard then reopen, the eviction order and its notice, and a Studio session, kept drawing and
  two project files saved by the real 1.0.28 code (`src/__fixtures__/returning-user`). 12 of its 14
  cases fail on the code before this amendment; the two 1.0.28 cases pass on both.
  `design-kept-drawings.test.tsx` now keeps the third route's drawing.
