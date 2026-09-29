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
  A first fix stopped making 144 x 144 anywhere. A second audit of that fix found it broke
  PROJECT.md non-negotiable 21: a variable value that needs 144 x 144 then stopped Frame, Start
  and output, although the code can still be built. That it may not scan is a quality finding,
  which Job Review states; only factual inability may refuse output.
- **Text could sit outside the code's box.** EAN-13 and UPC-A set their outer digits in the quiet
  zone. With a quiet zone below the standard, which draws with a warning, those digits reached
  past the object's bounds: the selection box and click target missed them, arranging and nesting
  could overlap them, and an inverted plate stopped short of them, so part of a digit was
  engraved instead of left as a hole.
- **The dialog preview of an inverted code was a negative.** The preview drew what is engraved
  in black on white. With Invert, which engraves the light modules for stock that marks lighter
  than its surface, it showed dark modules white on a black quiet zone: the reverse of the
  finished piece, and a code many scanners do not read from the screen. Codes without Invert
  were already dark on light.

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
2. **Insert and Edit make Data Matrix codes up to 132 x 132; output still builds 144 x 144 and
   warns.** A code in the standard's order does not scan in ZXing, and one in the reader order
   could not be checked, so KerfDesk does not offer 144 x 144 where the operator types the data.
   - In the dialog, text that needs more than the 1304 codewords of 132 x 132 is refused under
     the preview with "Too much data for a Data Matrix: this text needs N codewords and the
     largest size KerfDesk makes, 132 × 132, holds 1304. Shorten the text or use a QR Code.",
     and Insert or Apply is disabled. For variable data this is the value the preview evaluates;
     a template whose current value fits is inserted as before.
   - At output (Save G-code, Start, Frame, previews and estimates through the output snapshot,
     SVG and DXF export) and on the canvas, a variable value that needs 144 x 144 is built at
     144 x 144, exactly as before this amendment: the standard's block order, which the
     repository's test reader reads back. The block order readers expect is not built, because
     nothing in the repository pins it. Job Review and Save G-code's warnings name each such code on an
     output operation, and a code saved at that size by an earlier build: "Barcode ID is a
     144 × 144 Data Matrix. 144 × 144 Data Matrix codes may not scan in common readers, so
     test-scan one before a run." Several codes share one warning ("Barcodes A, B and C are
     144 × 144 Data Matrix codes. ..."), naming four and counting the rest. The warning never
     refuses Frame, Start or Save. SVG and DXF export have no warning list and write the code as
     before.
   - Only a value longer than 144 x 144 holds (1558 codewords) stops output, with the barcode
     and value named, because no Data Matrix can carry it: "... the largest size KerfDesk makes,
     144 × 144, holds 1558. ..."
   - Offering 144 x 144 in the dialog again, or building it in the reader order, needs a verified
     reference for that order.
3. **A barcode's box holds its text.** The bounds are the quiet-zone box grown to hold every
   caption as drawn, with the padding kept under the text also kept beside it. An inverted 1D
   plate fills the same box, so all of its text stays knocked out. Codes whose text stays within
   the quiet zone, as at the standard quiet zones, keep the box they had.
4. **The dialog preview shows a code as it reads on the finished piece.** Engraving is black on
   white stock; with Invert it is white on black stock, and the text, a hole in the plate, shows
   the stock. Dark modules show dark on a light quiet zone either way, so the preview scans from
   the screen. The canvas is unchanged: like all artwork, it draws what is engraved in the
   operation's colour.

### Consequences

- Stepping the serial, choosing another CSV record, or a completed job redraws variable codes
  at once, with their text.
- Selecting, dragging and snapping still use the stored code's outline. When the new value
  changes the code's size (a longer serial in a 1D code, a larger QR version), the selection
  box follows the drawn code but a click on the added part does not select it until the code is
  edited. Convert to Path still converts the stored code.
- A 144 x 144 code saved by an earlier build keeps its stored outlines until it is edited; Edit
  barcode then shows the message. Text that long needs a QR Code or shorter text. Until then it
  engraves as before, with the Job Review warning.
- A variable code whose current value needs 144 x 144 draws at that size on the canvas, but Edit
  barcode shows the message until the data is shortened, since the dialog makes 132 x 132 at
  most.
- An EAN or UPC code with a narrow quiet zone is as wide as its digits, and the selected code's
  size shows that. A code saved by an earlier build keeps its stored box until it is edited.
- Tests: `src/ui/workspace/use-canvas-display-barcode.test.tsx` (the canvas after Next, QR Code
  and Code 128 with its text, project untouched) and `variable-barcode-display.test.ts`
  (bindings, the last value while encoding, values that cannot be encoded or evaluated);
  `src/core/barcode/data-matrix-encode.test.ts` (132 x 132 at most for Insert and Edit, the
  message; 144 x 144 for output, read back by the repository's reader, and the longer-value
  message); `src/ui/barcode/BarcodeDialog.test.tsx` and `barcode-form.test.ts` (the message in
  the dialog, Insert disabled; a variable template whose value fits is inserted);
  `src/core/barcode/materialize-barcode.test.ts` (the box holds the text, an inverted plate keeps
  it a hole, Insert and Edit refuse 144 x 144); `src/io/gcode/materialize-variable-barcode.test.ts`
  and `src/ui/laser/start-job-data-matrix.test.ts` (output and Start build 144 x 144 with the
  Job Review warning, and stop only beyond it); `src/ui/laser/data-matrix-scan-warnings.test.ts`
  (the warning, grouped, not for unused operations or unevaluated templates, and in Save
  G-code's warnings); `variable-barcode-display.test.ts` (the canvas draws 144 x 144);
  `src/ui/barcode/BarcodePreviewSvg.test.tsx` (a QR Code and an EAN-13 read from the preview,
  with and without Invert).
