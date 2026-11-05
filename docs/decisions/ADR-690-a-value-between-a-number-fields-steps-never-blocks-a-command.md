## ADR-690 - A value between a number field's steps never blocks a command

**Status:** Accepted. Fixes performance audit finding S6-P2-2 (P2, raised by the refuter)
(`docs/audits/2026-11-02-performance-s1/S6-geometry-commands.md`). Builds on ADR-307 (the grid
array, its totals) and the shared dialog shell in `src/ui/kit` (ADR-047's kit, restyled by ADR-049).
Tested in jsdom (the kit, every form in `src/ui`, the Array dialog, the full unit suite) and in Chrome
(a new e2e that fails without this change). Burn, G-code, Frame, Start and licences are unchanged.
| **Date:** 2026-11-05

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
About 90 number fields (`NumberInput` and raw `type="number"`) live in some 60 files. Some show
computed values, and any of them accepts a typed value finer than its step. Whole-number steps are
no safer: Adjust Image shows 304.8 DPI (12 lines/mm) in a `step={1}` field, and Scan Offset takes a
1000.25 mm/min speed in another. Number fields outside a form (jog, origin, offsets, layer and CNC
settings) never block anything: no code there asks the browser to validate, and no style shows
`:invalid`.

Every dialog's unit tests submit with `Simulate.submit`, which bypasses the browser's check. So
the dialogs' own handlers, not the browser, are the validation the code base tests: they parse,
clamp, round or refuse each value with their own message. Passes are floored, Array counts
truncated, Material Test refuses a fractional step count, and the box generator refuses a
fractional divider or rung count.

### Decision

1. **`step` only moves the arrow keys.** A value between steps, decimal or whole, is never a reason
   to refuse a command. Counts are the handlers' job, as above.
2. **Every form skips the browser's check and runs the app's.** The kit `Dialog` form, and each raw
   form, sets `noValidate` and submits through `checkedSubmit` (`src/ui/kit/form-validity.ts`). It
   reports the first control, in document order, that the browser would have refused for any other
   reason: below `min`, above `max`, an unreadable number, a missing required value, a pattern or
   length, or the field's own `setCustomValidity` message. It reports it with the browser's own
   `reportValidity`, at that field, and then does not call the dialog's handler. Code that asked a
   whole form for the browser's verdict (Cut Settings' **Place tabs**) uses `formProblemReported`
   instead.
3. **Forms that submit only clamped values skip even that.** Adjust Image's OK applies a draft that
   every field has already normalized and clamped, never the raw input text, and Add Text clamps
   size, line height, spacing, bend and maximum width before rendering or saving. Their `Dialog`s
   pass `clampsEveryValue`. Convert to Bitmap's raw form sets `noValidate` alone: its handler clamps DPI
   and brightness, and its Convert button (type `button`) never ran the browser's check, so Enter
   now submits the same way. Before, Enter refused a DPI the button would clamp.
4. **Chosen over `step="any"` on the affected fields.** That would fix the fields found today, and
   leave the next computed or typed value in any of the other forms to fail the same way. It would
   also change what the arrow keys do. `noValidate` alone everywhere would drop the range, required
   and custom checks that other dialogs rely on.

### Consequences

- The Grid array creates its copies for any selection size and any typed total or spacing. Adjust
  Image accepts its own 304.8 DPI, Scan Offset a fractional speed, and Add Text clamps a typed size
  of 9999 mm to 1,000 instead of refusing it.
- No form's range, required or custom refusals change, except in the two clamping forms (decision
  3): the same field reports the same problem as before.
- A fraction typed into a count reaches that dialog's handler, which rounds or refuses it in the app.
- A new form must follow decisions 2 or 3. The sweep below fails the build otherwise.

### Verification

- `src/ui/kit/form-validity.test.tsx`: a dialog form submits 223.85 in a `min=0 step=0.1` field,
  304.8 in a `step=1` field and 1000.25 in a field with no step. It still refuses a value below
  `min`, above `max`, a missing required value and a custom message, reporting each at its field.
  Its sweep reads every non-test source under `src/ui`. It requires `noValidate` and
  `checkedSubmit(` on each `<form>`, `clampsEveryValue` and the bare `noValidate` only in the listed
  clamping forms, and no `form.reportValidity()` or `form.checkValidity()` outside the kit.
- `src/ui/commands/ArrayDialog.test.tsx`: Create array, clicked, submits a 2 × 2 grid for a
  142 × 110.923 mm selection, and again after typing a vertical spacing of 2.054 mm; a negative
  spacing is still refused at its field. Without this change the first case fails.
- `AdjustImageDialog.test.tsx`, `ScanOffsetCommandDialog.test.tsx` and `AddTextDialog.test.tsx`
  pass unchanged. A first draft that still refused whole-step fractions and
  out-of-range values in these clamping dialogs failed them on CI.
- `e2e/array-grid-tenths.e2e.ts`: in Chrome, the dialog shows Total height 223.85, Create array
  closes it and the scene holds four rectangles. Without this change the dialog stays open.
