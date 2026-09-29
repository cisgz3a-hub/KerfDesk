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

### Consequences

- Stepping the serial, choosing another CSV record, or a completed job redraws variable codes
  at once, with their text.
- Selecting, dragging and snapping still use the stored code's outline. When the new value
  changes the code's size (a longer serial in a 1D code, a larger QR version), the selection
  box follows the drawn code but a click on the added part does not select it until the code is
  edited. Convert to Path still converts the stored code.
- Tests: `src/ui/workspace/use-canvas-display-barcode.test.tsx` (the canvas after Next, QR Code
  and Code 128 with its text, project untouched) and `variable-barcode-display.test.ts`
  (bindings, the last value while encoding, values that cannot be encoded or evaluated).
