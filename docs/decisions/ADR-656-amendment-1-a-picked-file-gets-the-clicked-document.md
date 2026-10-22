## ADR-656 Amendment 1 - A picked file gets the document from the click (2026-10-22)

**Status:** Accepted. Amends ADR-656 (decision 3, Consequences). | **Date:** 2026-10-22
**Fixes:** the four saves ADR-656 left out of rolling audit v2 finding 19-P2-1.

### Context

ADR-656 left out four saves whose only step after the pick was a stale-document check:

- Stamp **Export PNG…** (`src/ui/commands/stamp-export.ts`) returned when the review had been
  closed, edited or superseded. It also threw after the pick when the prepared draft was not a
  PNG data URL.
- CNC wrap **Save study and reference program as JSON**
  (`src/ui/laser/device-setup/CncWrapStudyReview.tsx`) threw "The source project changed before
  writing" when the open project had been replaced.
- Relief **Save component…** (`src/ui/layers/ReliefLocalAssetControls.tsx`) returned when the
  relief document or component had changed, or the controls had closed.
- My artwork **Export library...** (`src/ui/library/personal-artwork-actions.ts`) returned when
  the panel had closed.

Chromium has already emptied the chosen file when its picker returns, so each refusal left an
existing file at 0 bytes. The wrap study's message did not say the file had been emptied, and the
other three said nothing at all.

None of these files is run on a machine as saved. The stamp PNG's physical extent is named in the
success toast. The wrap study records `machineOutputAvailable: false` and the SHA-256 of its
source and reference program. The relief component and the library are reusable local assets.
The bytes captured at the click are what the operator reviewed and clicked Save for.

### Decision

1. **Check first, then pick.** These four saves run their staleness check and every step that can
   fail (the stamp PNG decode, the relief component serialization, the library listing) before
   `pickPreparedSaveTarget`. A save that is already stale or broken at the click opens no picker,
   and an existing file keeps its contents.
2. **After the pick, write the bytes from the click.** A document change while the picker is open
   no longer cancels the write. This is decision 3 applied to a document change. Once the picker
   has returned, the file is already empty, so writing is the only outcome that leaves a usable
   file.
3. **The wrap study says when it saved an older project.** Its review re-renders from the new
   project, so the file and the review on screen can differ. After such a save it shows "Saved the
   study from before the source project changed. Save again to include the change." The stamp
   toast already names the extent that was saved. The relief component and the library report
   nothing on success, as before.
4. **The picker model can stay open.** In
   `src/platform/web/chromium-save-picker.test-support.ts`, `whilePicking` may return a promise,
   and the dialog stays open until it settles. A test can then re-render or close a component
   while the picker is open.

### Consequences

- Replaces the ADR-656 Consequences bullet that left these four saves unchanged. The rest of that
  bullet (pure serialization after the pick, the support report) stands.
- Unticking the stamp review while the picker is open no longer withdraws the export. A test
  written against a mock picker pinned that withdrawal. A real picker blocks input to the page,
  so the box cannot be unticked while it is open, and a withdrawal at that point would only have
  left the emptied file. The test now expects the reviewed draft to be written.
- A document change during the native picker is rare: the dialog blocks input to the page, so
  only background work or another device can change the document. When it happens, the operator
  gets the file they clicked Save for instead of an empty one.
- Each save has a regression test that runs the real web adapter against the Chromium picker
  model: `stamp-export.test.ts`, `CncWrapStudyReview.test.tsx`,
  `ReliefLocalAssetControls.test.tsx` and `PersonalArtworkPanel.test.tsx`.
