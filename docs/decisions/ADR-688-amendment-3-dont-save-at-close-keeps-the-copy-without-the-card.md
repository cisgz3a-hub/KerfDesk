## ADR-688 Amendment 3 - Don't Save at the desktop close question keeps the copy, and the next launch does not ask about it (2026-11-11)

**Status:** Accepted; unit evidence that runs the main process's close guard against the renderer's
close receiver, unload hooks, autosave write and recovery card in jsdom. No Electron window was
run. | **Date:** 2026-11-11

Follows user annoyance audit A1 finding A5-P2-3
(`docs/audits/2026-11-11-annoyance-a1/REPORT.md`), approved by the maintainer on 2026-11-11.
Amends Decisions 1 and 2. Decision 3 stands: no slot is removed.

### Context

- Closing the desktop app with unsaved changes asks Save, Don't Save or Cancel (ADR-549). After
  Don't Save the window unloads, and the unload handler writes the dirty project to this session's
  autosave slot (`use-autosave.ts`), as it does for every unload.
- The next launch finds that copy and the card asks "Your last session wasn't saved. Restore it?".
  The user answered that question seconds before closing, so every unsaved close cost an extra
  card and a click.
- Don't Save before New or Open clears the session's copy (`confirm-discard.ts`). Don't Save at
  close kept it and asked again, so one answer behaved in two ways.
- The close copy is worth keeping: Don't Save at close cannot be undone the way New can, and
  Decision 3 keeps unsaved work reachable until the user removes it.

### Decision

1. **The copy written at that close is kept and goes quiet.** When the window unloads for a
   desktop close whose unsaved-changes question was answered Don't Save, the unload copy is written
   as before and its identity (storage key and save time) is added to the Start fresh list of
   Decision 2. The next launch's card does not ask about that copy. File > Recover unsaved work
   lists it like any other session.
2. **Only that exact copy.** The mark is made after the unload write succeeds, from that write's
   own key and time. An earlier copy of the session and any later one are not covered, so newer
   unsaved work is asked about as before. If the unload write fails (a project too large for
   localStorage), nothing is marked and the last interval copy is asked about, as before.
3. **Only that answer.** The renderer treats an unload as that answer when the main process's
   close attempt reported unsaved changes, was approved, was never asked to save, and still matches
   the document and machine state it was prepared with. The main process asks for approval of
   unsaved work only after the close question (`window-close-guard.ts`), so no message was added
   to the close hand-off. Closing to install an update asks the same question and behaves the
   same.
4. **Everything else still asks.** A crash, a forced kill, the operating system ending the
   session, a close forced past an unresponsive window, a reload, a page navigation's Leave or
   Stay, and the browser's own "Leave site?" set no mark. Cancel keeps the window. Save leaves
   nothing unsaved to write.

### Consequences

- Closing with Don't Save no longer brings a card at the next launch, and the work can still be
  brought back from File > Recover unsaved work.
- Don't Save still differs between close (copy kept, quiet) and New or Open (copy cleared). The
  difference is now only whether the work can be recovered, not whether the user is asked again.
- The card asks about the newest unsaved copy only (Decision 1). When the newest copy is a quiet
  one, an older session's unsaved work is not offered by the card, as after Start fresh; it stays
  in the list.
- Kept copies add to the storage that Decision 3 already leaves uncapped.
- The Start fresh list holds 16 identities. Marks for older closes fall off it, but the card asks
  only about the newest copy, whose mark is the newest entry.
- No change to the web app, the close question, the Abort hand-off, the autosave format, burns,
  G-code or licensing.

### Verification

`desktop-close-dont-save.test.tsx`: the real `WindowCloseGuard` drives the renderer's close
receiver with each answer. Don't Save writes the copy, marks exactly it and the card stays away
while the copy remains in storage; a later copy of the same session is asked about; Cancel, then
an unload nobody answered, is asked about; Save writes nothing; a Save that leaves the work dirty
is asked about. The controller cases cover a clean document, an unapproved close, no close
attempt, work changed after the answer, and both orders of the unload hooks.
**Not verified:** a packaged or development Electron window, and the update-install close.
