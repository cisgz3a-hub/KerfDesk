## ADR-398 Amendment 1 - Marlin holds air and mode changes until a dark move, and the job end drops held air changes (2026-10-21)

**Status:** Accepted. Amends ADR-398 Decision 1. | **Date:** 2026-10-21

### Context

Rolling audit v2 (2026-10-21), laser output, found two ways KerfDesk output still stops the
head with the beam lit at an air change. Both reproduced, and the firmware behaviour below was
read in the primary sources.

- **A blank last group under M3 (03-P2-1).** Constant-power output whose last group switches air
  on but burns nothing: an all-white or 0% image, or a cut whose geometry rounds away at three
  decimals. The cursor holds that group's `M8` until a laser-off move, none comes, and the job
  end wrote it straight after the final lit burn: `G1 … S300` / `M8` / `M9` / `M5`. `M8` drains
  the planner with the beam lit. grblHAL's `coolant_set_state_synced` (coolant_control.c)
  synchronizes and then waits the configured on-delay (`$673`) whenever coolant comes on, and
  FluidNC has `coolant/delay_ms`, so the head can sit lit and stationary for the whole delay.
  Decision 1 allowed only "M9/M5 after the last burn" there.
- **Marlin (03-P2-2).** The Marlin strategy builds its body with the `grbl-dynamic` dialect (M4)
  and rewrites it to continuous inline power (`M3 I`) or to fan PWM. The cursor held transitions
  only under M3, so on Marlin `M9`/`M8` (and `M5 I`, `M3 I S0` at a mode change, and an image's
  opening) was written straight after a lit move. In Marlin 2.1.2.5:
  - `M3 I` selects `CUTTER_MODE_CONTINUOUS` (M3-M5.cpp);
  - at an empty planner the stepper turns the beam off only `if (cutter.cutter_mode ==
    CUTTER_MODE_DYNAMIC)` (stepper.cpp:2345-2349), so continuous power stays lit while stopped;
  - `M7`, `M8` and `M9` start with `planner.synchronize()` (M7-M9.cpp), on every call;
  - `M5` also synchronizes before it applies power 0 (M3-M5.cpp);
  - the next block starts only after `BLOCK_DELAY_FOR_1ST_MOVE` (100 ms, planner.cpp) unless
    three moves are queued, and its power is applied when it starts (stepper.cpp:2574-2584).

  So each air change between operations left the head stopped with the beam on, up to about
  100 ms: a dot at each such boundary. The idle fan output behaves the same way until `M107`.

### Decision

1. **Marlin output is held like M3.** The Marlin strategy passes `stopKeepsPower` to the GRBL
   body emitter (`OutputEmitOptions`). The output cursor then counts every burn, under either
   word, as leaving the beam lit at a stop, and holds mode and air changes until the next
   laser-off move, exactly as Decision 1 does under M3. That covers the fan dialect too: the fan
   transform turns that move into `M107` + `G0`, so the held change follows a dark fan.
2. **A move to where the head already is does not darken on Marlin.** Marlin plans no block for
   it (fewer than `MIN_STEPS_PER_SEGMENT` steps, planner.cpp:2247-2248), so a G0's zero power is
   never applied. Under the M4 body that move is still written, as before, and the held changes
   stay held; when the next burn starts there, the existing 1 mm laser-off move along its first
   edge and back takes the drain dark. Under M3 the move is still dropped (GRBL drains on it).
3. **The job end drops held air changes.** Lines still held when the job ends were held for groups
   that burned nothing. Their air changes are dropped instead of being written after the last
   burn; their spindle words stay, since they open with the `M5` that switches the beam off. The
   job's air-off `M9` follows the air word actually written, so a dropped `M8` brings no `M9`,
   and a dropped `M9` leaves the job's own `M9`. The job end itself (`M9`, then `M5`, after the
   last burn) is unchanged.

### Consequences

- GRBL M4 output is byte-identical, and so is M3 output except a job whose last groups held an
  air change and burned nothing. That ending loses a needless air switch, and the grblHAL or
  FluidNC on-delay is no longer spent lit.
- Marlin output changes only after a lit burn: an air change, a mode change or an image layer's
  opening now follows the next operation's first travel. A pass seam's travel to where the head
  already is stays in the program. Marlin output with no transition after a burn is unchanged.
- The header's emitter revision advances to `marlin-dark-air-changes-20261021-v22`, which also
  covers ADR-462 Amendment 1.
- `src/__fixtures__/controllers/grbl-lit-drain-checker.ts` now also reads the lines after the last
  burn: there, only `M9` and `M5` may drain with the beam lit.
  `src/__fixtures__/controllers/marlin-lit-drain-checker.ts` is its Marlin twin, built on the
  rules above.
- Regression tests: `grbl-strategy-job-end-held-air.test.ts` and
  `marlin-strategy-lit-stop.test.ts`.

### Not covered

- Marlin also drops a move that is not to the same written position but has fewer than six
  steps (0.075 mm at 80 steps/mm). KerfDesk does not know Marlin's steps/mm, so such a move
  still counts as dark. This is the same kind of limit as GRBL's sub-step move, which Decision 1
  already accepts.
- An image layer on Marlin with zero overscan can end its last row on a burn. The raster
  emitter then writes its closing `M5` (`M5 I`) straight after it, because the image emitter
  treats its M4 body as dark at a stop. That stop has no air change in it and is left for a
  separate decision. ADR-398 Amendment 2 resolves it.
- No hardware was operated. These are code and test results only.
