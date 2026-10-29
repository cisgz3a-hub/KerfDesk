## ADR-573 Amendment 2 - An even resize is even to the sketch solver's tolerance

**Status:** Accepted; unit- and store-tested against the compiled outline, not hardware-tested. |
**Date:** 2026-10-29

Fixes rolling audit v8 N5-P2-1 (`docs/audits/2026-10-29-rolling-v8/N5-fix-studio-io.md`).
Amendment 1 folds an even canvas resize ("the same factor on both axes") into a sketch's or a
part's dimensions, and called the factors the same when they agreed to 1e-9 relative.

### Context

- The constrained-sketch solver stops once every residual is under a tenth of
  `SKETCH_SOLVE_TOLERANCE_MM` (1e-5 mm). A sketch changed by less than 1 mm stops after one step,
  so its solved size is about 1e-6 mm off: a 60 × 30 rectangle solves to 59.999999 × 29.999999.
- The toolbar's W and H are separate edits while the aspect lock is off, which is its default.
  Each divides by its own solved extent, so W 120 and then H 60 left the two factors 3.3e-9 to
  4.0e-8 apart. That is up to 40 times the 1e-9 tolerance.
- The editor then called an even 200 % × 200 % resize "stretched (width 200%, height 200%)" and
  did not fold it. Apply returned the part from the 120 × 60 the canvas showed to 60 × 30. The
  refuter found 24 of 32 sub-millimetre changes did this.

### Decision

1. **Two factors are one resize to the solver's tolerance.** Each factor is a size on the canvas
   divided by the source's own size. A solved size is good to `SKETCH_SOLVE_TOLERANCE_MM`, so a
   factor is good to that tolerance over its own extent. The resize is even when
   |x / y − 1| ≤ tolerance / width + tolerance / height. For a 60 × 30 sketch that is 5e-7. The
   tolerance is in millimetres, so it does not grow with the resize factor.
2. **The longer side's factor is folded,** because it is the one measured more closely. A side with
   no length has no factor to measure, so a resize along a straight line is even.
3. **The same tolerance decides "unit".** A factor within the tolerance of 1 over the longer side
   is no resize. The editor shows the sketch's own values, and Apply writes scale 1.
4. **A stretch anyone could measure is still a stretch.** 1e-5 apart on 60 × 30 is 0.6 µm across
   the width, 60 times the tolerance, and it keeps Amendment 1 item 3's warning. Generated parts
   are exact, and a difference within the tolerance is just as invisible on them.

### Consequences

- `retainedSourceScale` takes the object (its bounds and transform), not the transform alone.
  The dialogs pass the object to `RetainedScaleNotice`.
- Tests: `retained-source-canvas-resize.test.ts` changes a dialog rectangle by 0.5 mm, types W
  then H through the toolbar's own builder, applies the editor's folded values and compiles
  120 × 60. `retained-source-scale.test.ts` pins the tolerance, the folded side and a genuine
  stretch.
