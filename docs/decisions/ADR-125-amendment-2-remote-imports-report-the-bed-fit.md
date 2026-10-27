## ADR-125 Amendment 2 - Remote imports report the bed fit and keep it as its own Undo step (2026-10-27)

**Status:** Accepted; software-verified through tests that drive the real remote adapter against
the desktop import actions. | **Date:** 2026-10-27

Extends [Amendment 1](ADR-125-amendment-1-imports-keep-file-size.md) item 3 to Remote Control
(ADR-569, ADR-584): the phone and the MCP tools `add_svg`, `import_file` and `apply_edits`. Follows
rolling audit v4 findings H8-P1-2 (P1) and H8-P2-3 (P2), which an independent refuter confirmed. The
coordinator re-verified them in code on main `a59f74ff9`. Changes nothing in Frame, Start or output.

### Context

Amendment 1 lets an import shrink art that is larger than the bed only with a warning, and with the
scale as its own Undo step. Remote Control ran the same store import, so it scaled the same way,
but:

- the receipt was only `{changedArtworkIds, history}`, and the PC showed no toast. A 1000 × 500 mm
  drawing on a 400 × 400 mm bed became 360 × 180 mm with a bare `ok`;
- `insertAndPlace` wrapped the import in one Undo step, so one Undo removed the import instead of
  restoring the file size;
- every other import notice was dropped: ignored SVG text and images, sanitised content, SVG
  presentation warnings, skipped DXF entities and DXF parser notes. One such note is "Unrecognized
  $INSUNITS 22 — assuming millimeters.", which a file in US survey inches gives at 1/25.4 of its
  size;
- a remote raster import lost the image importer's own fit notice, because its callback returned
  no outcome.

### Decision

1. **A remote import shows the PC what the desktop import shows.** SVG and DXF imports build their
   toasts with the desktop's own builders (`describeSvgImport`, `describeDxfImport`). A raster
   import runs `importImageFile`, which pushes its own toasts. The PC shows them once the import
   has committed, and a failed or rolled-back import shows none.
2. **The receipt carries the same text.** `add_svg` and `import_file` receipts, and each `add_svg`
   result of `apply_edits`, gain `notices`, the PC toasts in order as `{level, message}` (at most
   20). When the fit was applied they also gain `bedFit`:
   `{scale, fileWidthMm, fileHeightMm, bedWidthMm, bedHeightMm}`. The MCP output schemas and the
   `add_svg` and `import_file` descriptions say so. An unrecognised `$INSUNITS` stays a warning, as
   on the desktop. It is not refused.
3. **The fit is its own Undo step.** A single remote import inserts at file size, as one Undo step,
   then applies the desktop's fit (`fitImportedObjectsToBed`, the function `applyImportBedFit`
   uses) as a second one. A requested `xMm`/`yMm` goes into the second step. One Undo restores the
   file size, at the desktop's file-size position, and a second Undo removes the import. Both
   steps are computed and checked before the first is committed, so a refused placement still
   leaves nothing behind. The canvas view re-fits after the fit, as it does after a desktop import.
4. **A requested width replaces the fit.** With `widthMm` the client chose the size, so the import
   stays one Undo step, with no fit notice and no `bedFit`. The fit still decides where the width
   is measured from, as before, so the art stays on the bed.
5. **A batch stays one Undo step.** `apply_edits` is one Undo step by ADR-584, so an oversize
   `add_svg` inside it is fitted within that step. Its notice ends "Undo reverts the whole batch of
   remote edits." instead of "Undo restores the original size."

### Consequences

- An MCP agent and the PC operator both learn that the art was scaled or a part was dropped. The
  agent is asked to pass every warning on to the user.
- A single remote oversize import now adds two Undo entries, as a desktop one does.
- The phone's Import sheet still shows only "Imported."; the PC toast and the receipt carry the
  notices. Showing them on the phone needs a rebuild of the phone app bundle and a relay Worker
  deploy.
