## ADR-573 Amendment 4 - An even resize is even to the size fields' rounding

**Status:** Accepted; unit- and store-tested through the toolbar's own edit builder, the editor's
folded values and the compiled outline, not hardware-tested. |
**Date:** 2026-11-02

Fixes rolling audit v9 R6-P2-2 (`docs/audits/2026-11-02-rolling-v9/R6-fix-studio-bed.md`),
confirmed by an independent refuter, who found it on round sketches too. Amendment 2 called two
factors one resize when they differ by no more than the sketch solver's tolerance (1e-5 mm) over
each side.

### Context

- The toolbar shows W and H to 3 decimals in mm and 4 in inches (`NumericEditsBar.tsx`), and its
  aspect lock is off by default. An operator types the sizes it shows.
- When a resize does not divide evenly, the typed H is rounded. 120 × 70 typed to W 100, H 58.333
  leaves the factors 5.7e-6 apart, 300 times Amendment 2's tolerance. The editor read "stretched
  (83.33%, 83.33%)" and Apply returned the part to 120 × 70. 70 × 45, 30 × 17, a hexagon's
  100 × 86.603 and a third-sized sketch did the same.

### Decision

1. **Amendment 2 item 1 is widened by what a field can show.** A factor is good to the solver's
   tolerance over the source's side, plus half a field's step over the size typed. The coarser
   field is the inch one: 0.0001 in, so 0.00127 mm either way (the mm field's is 0.0005 mm). The
   resize is even when |x / y − 1| ≤ Σ (tolerance / side + 0.00127 mm / (side × factor)) over the
   two sides. Item 3's "unit" uses the same slack on the longer side.
2. **A stretch anyone could measure is still a stretch.** 0.01 mm on any side is about eight times
   that rounding, and keeps Amendment 1 item 3's warning. Amendment 2 item 4's 0.6 µm example is
   now within a field's rounding and folds.
3. **What folds keeps its typed size.** Apply regenerates at the longer side's factor, so the burn
   is within 0.002 mm of what was typed.

### Consequences

- `retainedSourceScale` is the only change; the dialogs and the notice are unchanged.
- Tests: `retained-source-canvas-resize.test.ts` types W then H through the toolbar's builder, as
  each field shows them in mm and in inches, on round and non-round sketches. Each folds, applies
  at scale 1 and compiles within 0.002 mm of the typed sizes; 14 of the 16 fail before this
  amendment, the two 60 × 30 controls pass on both. A 0.01 mm stretch typed into H stays
  stretched on every sketch. `retained-source-scale.test.ts` pins the rounding and a 0.01 mm
  stretch.
