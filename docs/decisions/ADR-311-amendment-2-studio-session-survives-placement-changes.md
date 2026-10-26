## ADR-311 Amendment 2 - A closed Image Studio session survives placement changes (2026-10-22)

**Status:** Accepted by the maintainer's request to fix rolling audit v2 finding 23-P2-3.
**Date:** 2026-10-22.

ADR-311 §2 binds Image Studio open, stash, decode and Apply to the initiating
`projectDocumentEpoch` and the exact source object, and keeps same-document reopen
resumable. ADR-313 §1 restates the exact owner for Edit Image. Every scene edit
replaces the image object, though, so a 1 mm nudge, a layer reassignment or a
power override made a closed session's owner stale. Reopening then decoded the
image fresh and dropped the unapplied edits and their Undo history without a word,
although the Close button promised "the editing session is kept and resumes on
reopen" (`docs/audits/2026-10-21-rolling-v2/23-image-editor.md`, P2-3).

### Decision

- A stashed session resumes when the reopened image is in the same document and
  has the same id, file name (`source`), `dataUrl`, `imageAsset`, `editorDocument`,
  pixel size and bounds as the image the session was stashed against. Transform,
  layer colour, power, dither and the other engrave settings may differ. Apply
  writes only pixel fields and bounds (`applyEditedImage`), so it keeps the newer
  placement and settings.
- The resumed session is bound to the current image object, so Apply, Close and
  later completions check against what is on the canvas now.
- Exact owners still fence every asynchronous completion: a decode or Apply that
  finishes after its object was replaced still silently no-ops, as ADR-311 §2
  requires. This amendment only decides whether a reopen may resume.
- When the image itself changed (new pixels or a new extent, for example after
  Crop Image), the stash no longer matches. Studio opens the image as it is now,
  and if the stash held unapplied edits a warning toast says they were discarded.
  The Close button title says when edits are kept and when they are not. There is
  still no confirmation dialog in the editor (WORKFLOW F-L1).

### Evidence and limits

`image-editor-lifecycle.test.ts` pins both paths: a nudge through the real store
keeps the session, its Undo step and a later Apply that lands on the moved image;
a changed `dataUrl` opens fresh with the warning. Unit-tested only.
