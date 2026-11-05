## ADR-690 - A value between a number field's steps never blocks a command

**Status:** Accepted. Fixes performance audit finding S6-P2-2 (P2, raised by the refuter)
(`docs/audits/2026-11-02-performance-s1/S6-geometry-commands.md`). Builds on ADR-307 (the grid
array, its totals) and the shared dialog shell in `src/ui/kit` (ADR-047's kit, restyled by ADR-049).
Tested in jsdom (the kit, every form in `src/ui`, the Array dialog) and in Chrome (a new e2e that
fails without this change). Burn, G-code, Frame, Start and licences are unchanged. | **Date:** 2026-11-05

### Context

The Grid array's Total width and Total height show n × the design's size to 0.01 mm
(`ArrayGridFields.tsx`) in a `NumberInput` with `min={0} step={0.1}`, and the spacing fields use
`step={0.1}` too. With `min` set, the browser measures steps from `min`, so 223.85 fails its
constraint check (`stepMismatch`). The Array dialog renders as a `<form>` without `noValidate`, so
the browser refused to submit it: for a 142 × 110.923 mm selection, and for almost any selection
whose n × size is not a whole tenth of a millimetre, **Create array did nothing**. The dialog's own
status said all was well and the button stayed enabled. Typing the total Chrome's bubble suggested
moved the failure to the spacing field. 1.0.23 behaved the same.

The same trap waits in every form. `src/ui` has 41 dialogs rendered `as="form"` and 4 raw forms.
About 90 number fields (`NumberInput` and raw `type="number"`) live in some 60 files, many with
`min` and a decimal `step`. Some show computed values, and any of them accepts a typed value finer than its step.
Number fields outside a form (jog, origin, offsets, layer and CNC settings) never block anything:
no code there asks the browser to validate, and no style shows `:invalid`.

### Decision

1. **A decimal `step` only moves the arrow keys.** A value between 0.1 mm steps is never a reason
   to refuse a command. A whole-number step (an explicit `step="1"`, or none, which the browser
   reads as 1) still refuses a fraction, at that field, as before: those fields count things
   (passes, copies, rungs, patches), and Focus Test already chose `step="1"` for its count and
   `step="any"` for its distances on purpose.
2. **Every form skips the browser's check and runs the app's.** The kit `Dialog` form, and each raw
   form, sets `noValidate` and submits through `checkedSubmit` (`src/ui/kit/form-validity.ts`). It
   reports the first control, in document order, that the browser would have refused for any other
   reason: below `min`, above `max`, an unreadable number, a missing required value, a pattern or
   length, or the field's own `setCustomValidity` message. It reports it with the browser's own
   `reportValidity`, at that field, and then does not call the dialog's handler. Only a mismatch
   with a decimal step no longer blocks. Code that asked a whole form for the browser's verdict (Cut Settings'
   **Place tabs**) uses `formProblemReported` instead.
   Convert to Bitmap is the one form that sets `noValidate` without `checkedSubmit`: its handler
   clamps DPI and brightness, and its Convert button (type `button`) never ran the browser's
   check, so Enter now submits the same way instead of being refused for a DPI the button clamps.
3. **Chosen over `step="any"` on the affected fields.** That would fix the fields found today, and
   leave the next computed or typed value in any of the other forms to fail the same way. It would
   also change what the arrow keys do. `noValidate` alone would drop the range, required and custom
   checks that other dialogs rely on.

### Consequences

- The Grid array creates its copies for any selection size and any typed total or spacing.
- No form's other refusals change: the same field reports the same problem as before.
- A whole-number field that showed a computed fraction would still be refused. The sweep finds
  none; such a value would be a display bug in that field.
- A new form must follow decision 2. The sweep below fails the build otherwise.

### Verification

- `src/ui/kit/form-validity.test.tsx`: a dialog form submits a `min=0 step=0.1` field holding
  223.85, and still refuses a value below `min`, above `max`, a missing required value, a fraction
  in a whole-number or default step, and a custom message, reporting it at that field. Its sweep reads every non-test source under `src/ui` and
  requires `noValidate` and `checkedSubmit(` on each `<form>`, no `form.reportValidity()` or
  `form.checkValidity()` outside the kit, and no number field (`NumberInput` or raw
  `type="number"`) that shows `toFixed(n)` decimals with a whole-number or default step, the one
  case that can still block.
- `src/ui/commands/ArrayDialog.test.tsx`: Create array, clicked, submits a 2 × 2 grid for a
  142 × 110.923 mm selection, and again after typing a vertical spacing of 2.054 mm; a negative
  spacing is still refused at its field. Without this change the first case fails.
- `e2e/array-grid-tenths.e2e.ts`: in Chrome, the dialog shows Total height 223.85, Create array
  closes it and the scene holds four rectangles. Without this change the dialog stays open.
