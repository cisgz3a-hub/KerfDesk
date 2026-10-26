## ADR-462 Amendment 1 - On Marlin, air repeats wait for a dark move under M4 too (2026-10-21)

**Status:** Accepted. Amends ADR-462 ("Where a repeat is placed"). | **Date:** 2026-10-21

### Context

ADR-462 places an air repeat under `M3` only after a laser-off move, and says: "Under `M4` any
stop is already dark." That holds for GRBL, which switches a rate-adjusted (M4) block's beam off
at an empty planner. It does not hold on Marlin.

Rolling audit v2 (2026-10-21), finding 03-P3-1: "Air restart" can be ticked on a Marlin profile.
The Marlin strategy writes its body under `M4` and rewrites it to continuous inline power
(`M3 I`) or to fan PWM (ADR-398 Amendment 1). In Marlin 2.1.2.5, continuous power stays lit at
an empty planner (stepper.cpp:2345-2349), and `M8` starts with `planner.synchronize()` on every
call, even when air is already on (M7-M9.cpp). The keep-alive therefore wrote `M8` between lit
burn moves, about every third move in the audit's reproduction, and each one stopped the head
with the beam on for up to `BLOCK_DELAY_FOR_1ST_MOVE` (100 ms).

### Decision

1. **The statement is corrected.** Under `M4` a stop is dark on GRBL. On Marlin it is not: every
   power word there runs as continuous power or fan PWM.
2. **On Marlin a repeat waits for a dark move under either word.** The GRBL emitter passes
   `stopKeepsPower` from the Marlin strategy to `withAirKeepAlive`. The repeat is then placed
   under `M4` as it is under `M3`: only after a move that left the beam dark.
3. **A move that goes nowhere is not dark on Marlin.** Marlin plans no block for it
   (planner.cpp:2247-2248), so it leaves the beam as it was, and a repeat still waits.

GRBL-family output is unchanged.

### Consequences

- On Marlin, continuous cutting under either word can now leave a gap longer than the trigger,
  as M3 cutting already could (ADR-462, "Limits of insertion only").
- `air-keep-alive-marlin.test.ts` pins the placement, and runs the Marlin inline and fan output
  through `src/__fixtures__/controllers/marlin-lit-drain-checker.ts`.
- No hardware was operated.
