## ADR-315 Amendment 2 - Rotary image rows are checked as the controller places them, and the advice names only intervals that fit as typed (2026-11-10)

**Status:** Accepted. | **Date:** 2026-11-10

Amends ADR-315 Amendment 1, Decision 1. The warning stays advisory and per image layer. Rolling
audit v13 Y5-P1-3 (re-rated P2 by the refuter) raised this on main `144e45d76`.

### Context

Amendment 1 judged a line interval by its step arithmetic alone: within 0.02 of a whole number of
steps. Its first suggestion was the one-step interval.

The emitter places row `i` at `minY + (i + 0.5) × pitch` (`emit-raster.ts`) and writes it to 3
decimals. With a one-step pitch on the Creality chuck (0.0125 machine mm a step), every row centre
is a half step: 0.00625, 0.01875 and so on. The 3-decimal rounding breaks these ties both ways, so
the controller steps the rows 0, 2, 2, 4, 4 …

- Typed exactly (12.7324 lines/mm), a 30 mm photo on an Ø80 glass doubles **136 of 382** rows, and
  the warning went silent.
- Typed as printed (0.079 mm), it doubles 4 of 380.
- Cut Settings takes the interval in mm or DPI, not lines/mm, and clamps the stored density to 5–25
  lines/mm.

### Decision

1. **Check the rows as placed** (`ui/laser/job-review/rotary-row-placement.ts`). For each image
   layer the check takes:
   - the compiler's own row count and pitch;
   - row centres at `(i + 0.5) × pitch × k`, written to 3 decimals;
   - `Math.round` to the controller's steps, from work zero on a whole step (an Absolute rebase, or
     an origin set at the head).

   Rows land evenly when none doubles and at most 2 % of gaps differ from the most common one (the
   compiler's whole-row rounding drifts a long image off an exact step count).
2. **Say what happens:** "so 136 of its 382 rows land on the row before and burn twice", or "so its
   rows land 0.0785 or 0.1571 mm apart and band". Surface millimetres are given to 4 decimals.
3. **Suggest only what works as typed.** Each candidate step count is printed as a 4-decimal mm
   interval. It is converted the way the Line interval field converts it, so clamped entries drop
   out, and is re-checked through the same model.
   - Up to two that land evenly are named: the nearest at or below the current step count, and the
     nearest above it.
   - When none does (an Ø150 bowl at 80 steps/mm, where only a one-step interval is settable), the
     warning says no interval lands every row, and names the closest with its doubled-row count.

### Consequences

- On an Ø80 glass at `$101` = 80 the advice is now "0.1571 mm (6.37 lines/mm, 2 steps)". Typing it
  as printed silences the warning. This holds on Ø70, at 100 and 160 steps/mm and for 60 mm photos,
  and a test types each suggestion back in.
- On an A axis (`$103` = 8.9 steps/°) a one-step 0.0784 mm interval lands evenly and is offered.
- Phase is modelled at a whole step only. Artwork that sets work zero off a step can shift ties
  either way, which the warning does not claim to know.
- Writing rotary rows on the step grid, so that a one-step interval always works, would change
  image bytes. It is left out.
