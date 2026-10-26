## ADR-398 Amendment 2 - A Marlin image layer that ends lit leaves its closing M5 for a dark move (2026-10-21)

**Status:** Accepted. Amends ADR-398 Decision 1 and closes the image-layer item in Amendment 1's
"Not covered". | **Date:** 2026-10-21

### Context

ADR-398 Amendment 1 holds Marlin's mode and air changes until a dark move, because Marlin runs
the body's M4 as continuous inline power (`M3 I`) or fan PWM, and that stays lit when the head
stops. It left one ending out: an image layer with zero overscan.

Such a layer ends each row on a burn, followed by the row's close, `G1 X.. S0` at the same X. The
raster emitter still treated its M4 body as dark at a stop, so it wrote its closing `M5` straight
after that close. In Marlin 2.1.2.5:

- the zero-length close plans no block (fewer than `MIN_STEPS_PER_SEGMENT` steps,
  planner.cpp:2247-2248), so its zero power is never applied: power is applied when a block
  starts (stepper.cpp:2574-2584);
- at an empty planner only dynamic mode switches the beam off (stepper.cpp:2345-2349);
- `M5` (`M5 I`) synchronizes before it applies power 0 (M3-M5.cpp).

So `G1 X31.000 F3000 S200`, `G1 X31.000 S0`, `M5 I` stopped the head with the beam at 200 until the
planner drained. `findMarlinLitPlannerDrains` reports it. Of 400 seeded zero-overscan inline jobs,
100 had this drain before the fix and none after. The fan dialect never had it (0 of 400): its
transform writes `M107` before that close.

### Decision

1. **The raster reports a lit ending on Marlin.** The GRBL strategy passes the cursor's
   `stopKeepsPower` to the raster emitter (`EmitRasterInput.stopKeepsPower`). A sweep then
   reports a lit ending when the last line that moved the head was a burn. A line that does not
   move the head (a zero-length close, or an opening travel to where the previous sweep ended)
   leaves that state unchanged. The group's closing `M5` is then left for the next laser-off move,
   as Decision 1 already does for an M3 image layer.
2. **The raster's lines stay those of M4.** Zero-length closes and coincident sweep openings are
   still written, as before. Only the closing `M5` moves. Under M3 these lines are still left out,
   because GRBL drains on them.
3. **The deferred M5 leaves the raster's own word in effect.** After a lit ending the cursor
   records the raster's mode word (M3, or M4 on Marlin) rather than always M3. A following travel
   to where the head already is is still written on Marlin, and the held lines wait, as in
   Amendment 1 Decision 2, for the existing 1 mm laser-off move along the next burn's first edge.

### Consequences

- Marlin inline output changes only after an image layer whose last row ends on a burn: the
  layer's `M5 I`, and the next operation's arm and air change, now follow that operation's first
  travel. On fan output only an air change after such a layer moves past the travel, and a next
  operation that starts where the layer ended gains the 1 mm move. The fan power lines are
  unchanged.
- Marlin output with overscan, and all GRBL output, is byte-identical. This was checked on
  2,400 seeded jobs across both Marlin dialects and the four GRBL dialects.
- An image layer last in the job ends as before: its `M5 I` is the job's own end, which Decision 1
  accepts.
- The header's emitter revision advances to `marlin-dark-raster-end-20261021-v23`.
- Regression test: `src/core/output/marlin-raster-lit-end.test.ts` (the Marlin checker on inline
  and fan, a seeded property, and byte identity with overscan).

### Not covered

- Marlin drops moves of fewer than six steps that are not to the same written position (see
  Amendment 1). A row close that short still counts as dark.
- No hardware was operated. These are code and test results only.
