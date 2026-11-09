## ADR-341 Amendment 13 - After a controller restart, Frame no longer puts the aborted job's origin back unhomed (2026-11-09)

**Status:** Accepted (rolling audit v12, area X1, finding X1-P1-1, confirmed by the auditor, an
independent refuter and the coordinator; the maintainer's standing instruction to fix confirmed
audit findings). Amends Amendment 12 Decision 5. |
**Date:** 2026-11-09

### Context

- Amendment 12 Decision 5 has Frame offer the operator Abort's saved origin (`originAtStopMm`)
  back while it is unrestored. The origin is an XY work offset in machine coordinates.
- Stock GRBL clears machine position only at power-up, not at a soft reset (gnea/grbl
  `grbl/main.c`: `memset(sys_position…)` runs once before the reset loop). Opening the port resets
  an Arduino- or ESP32-class board (KerfDesk's own note in `link-loss-restart.ts`). On a machine
  without homing, machine zero is then wherever the head stood.
- The offer keyed on the stop request's stream epoch alone, and nothing cleared it at a reconnect.
  In the refuter's repro the laser was power-cycled after an Abort:
  - the controller session went from 4 to 7;
  - machine position jumped from (35, 15) to (0, 0) with no motion sent;
  - no notice appeared;
  - Frame still said "The job you stopped ran from X 35, Y 15" and its OK wrote
    `G54 G21 G92 X-35.000 Y-15.000`, followed by "Origin restored" and "Frame complete".
  - The re-run landed (+35, +15) mm off. The interrupted job's Review already warns "home the
    machine if it was reset"; the offer did not.

### Decision

1. **The store counts the times machine zero may have moved unmeasured** (`machineZeroEpoch`,
   `machineZeroMovedPatch` in `work-origin-state.ts`). It advances:
   - on every new connection (`connectingStatePatch`), since opening the port may reset the board;
   - on a welcome banner that answers no reset KerfDesk sent (`awaitsOwnedResetBoundary` is
     false): a power-up or a reset from outside.
   A banner after KerfDesk's own soft reset (Abort, Reset, the stop before Disconnect) leaves it,
   because a soft reset keeps machine position.
2. **The Abort records the count with the origin** (`JobStopRequest.originMachineZeroEpoch`).
3. **Frame's offer reads it** (`unrestoredAbortOrigin` returns `machineZeroMoved`):
   - **Unchanged:** Amendment 12 Decision 5 as before.
   - **Moved, profile with homing:** the restore offer stays, but always homes first. Its text
     says "The controller has restarted since then, so its machine zero may have moved: Home
     measures it again before the origin goes back." The head's distance is not shown, since it
     would be measured in the new frame.
   - **Moved, no homing:** no restore is offered. The plain set-origin offer comes with: "The job
     you stopped ran from X …, Y … mm from machine zero, but the controller has restarted since
     then, and without homing its machine zero may have moved, so that origin cannot be put back.
     Move the head to where the job should start first." Its OK sets the origin at the head, as
     it says.

### Consequences

- After a reconnect or a power-up, a machine without homing never gets the saved origin back
  from the numbers. The operator positions the head, as the Review recovery already advises.
- A reconnect with no actual board reset (a native-USB board) is also treated as a possible
  re-zero. KerfDesk cannot tell the two apart, so it errs toward asking.
- No refusal is added, widened or removed (ADR-228). The offers change only their wording and
  their OK action.

### Verification

- `abort-origin-after-restart.simulator.test.tsx`, on the GRBL simulator with the real store and
  checkpoint tracker. The ABORT JOB's own reset leaves `machineZeroEpoch` unchanged. Then:
  - **Power cycle (link loss, then a fresh simulator), homing off:** Frame's offer says the saved
    origin cannot be put back. Cancel writes no G92, and OK writes the at-head origin, not
    `X-35 Y-15`.
  - **A banner KerfDesk did not cause, homing off:** the same.
  - **Power cycle, homing on:** the offer says Home comes first, and `$H` precedes the one G92 that
    restores (35, 15).
  - **Control, same session:** the offer still restores.
  - With the offer modules reverted to `main`, the three restart cases fail and the control passes.
- `start-blocked-setup-offers.test.ts` covers the texts and the choice of offer.
- No hardware was operated; all controllers are simulated.
