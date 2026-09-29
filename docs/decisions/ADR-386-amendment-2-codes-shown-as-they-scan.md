## ADR-386 Amendment 2 - Codes are shown as they scan (2026-09-29)

**Status:** Accepted. | **Date:** 2026-09-29

### Context

The weakness audit of 2026-09-28 found places where what KerfDesk showed for a barcode was not
what it engraves or what a scanner reads.

- **The canvas kept the old value of a variable code (F-6).** ADR-386 item 3 says the canvas
  shows the code for the current value. The code was built only on insert and edit, and
  advancing the serial (Next, or a completed job) changes only the project's variables, so the
  canvas kept the old serial while every output encoded the new one. The human-readable text
  under a 1D code was stale in the same way.
- **The largest Data Matrix did not scan (F-7).** Text of 1305 to 1558 codewords made a
  144 x 144 symbol, built to the letter of ISO/IEC 16022. ZXing could not read it: readers expect
  the ten check blocks of that one size in another order than the standard's text gives. No test
  vector or reader in the repository pins that order, so it cannot be verified offline.
- **Text could sit outside the code's box.** EAN-13 and UPC-A set their outer digits in the quiet
  zone. With a quiet zone below the standard, which draws with a warning, those digits reached
  past the object's bounds: the selection box and click target missed them, arranging and nesting
  could overlap them, and an inverted plate stopped short of them, so part of a digit was
  engraved instead of left as a hole.

### Decision

1. **The canvas draws each variable barcode for its current value.** What the canvas draws is
   already a display copy of the project (a canvas text draft and a Warp preview use it). Each
   variable barcode in that copy is re-encoded with `materializeVariableBarcode`, the step every
   output takes, so the bars, modules and text are the ones output engraves. Nothing is written
   back: the project, its undo history, Frame and output are unchanged by what the canvas shows.
   - The value is evaluated when the project changes, with that moment's clock, so a date or
     time field shows the value from the last change, not a running clock.
   - Encoding runs after the frame is drawn. Until it lands, the last value shown stays on
     screen, so the code never flashes back to the stored one.
   - A value that cannot be evaluated or encoded leaves the stored code on the canvas; output
     stops on that value with the reason, as before.
   - Preview mode's faint artwork shows the current value too, so it lines up with the route.
2. **The largest Data Matrix made is 132 x 132.** 144 x 144 is no longer offered, because a code
   in the reader order could not be checked and a code in the standard's order does not scan.
   Text that needs more than the 1304 codewords of 132 x 132 is refused with "Too much data for a
   Data Matrix: this text needs N codewords and the largest size KerfDesk makes, 132 × 132, holds
   1304. Shorten the text or use a QR Code." The dialog shows it under the preview and disables
   Insert or Apply; a variable value that long stops output with the barcode and value named, as
   any value that cannot be encoded does. The size table still lists 144 x 144 so its placement
   stays tested; offering it again needs a verified reference for the reader order.
3. **A barcode's box holds its text.** The bounds are the quiet-zone box grown to hold every
   caption as drawn, with the padding kept under the text also kept beside it. An inverted 1D
   plate fills the same box, so all of its text stays knocked out. Codes whose text stays within
   the quiet zone, as at the standard quiet zones, keep the box they had.

### Consequences

- Stepping the serial, choosing another CSV record, or a completed job redraws variable codes
  at once, with their text.
- Selecting, dragging and snapping still use the stored code's outline. When the new value
  changes the code's size (a longer serial in a 1D code, a larger QR version), the selection
  box follows the drawn code but a click on the added part does not select it until the code is
  edited. Convert to Path still converts the stored code.
- A 144 x 144 code saved by an earlier build keeps its stored outlines until it is edited; Edit
  barcode then shows the message. Text that long needs a QR Code or shorter text.
- An EAN or UPC code with a narrow quiet zone is as wide as its digits, and the selected code's
  size shows that. A code saved by an earlier build keeps its stored box until it is edited.
- Tests: `src/ui/workspace/use-canvas-display-barcode.test.tsx` (the canvas after Next, QR Code
  and Code 128 with its text, project untouched) and `variable-barcode-display.test.ts`
  (bindings, the last value while encoding, values that cannot be encoded or evaluated);
  `src/core/barcode/data-matrix-encode.test.ts` (132 x 132 at most, the message);
  `src/ui/barcode/BarcodeDialog.test.tsx` (the message in the dialog, Insert disabled);
  `src/core/barcode/materialize-barcode.test.ts` (the box holds the text, an inverted plate keeps
  it a hole).
