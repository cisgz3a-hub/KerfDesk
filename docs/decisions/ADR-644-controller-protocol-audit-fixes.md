## ADR-644 - EEPROM writes stream alone, alarms are judged by their own firmware, and grblHAL E-stop and motor-fault pins are shown

**Status:** Accepted; unit-tested, not hardware-tested. | **Date:** 2026-10-20

### Context

The 2026-10-20 controller protocol audit
(`docs/audits/2026-10-20-controller-protocol-audit.md`) found three small faults that need no
hardware to fix.

- **P-1.** GRBL's interface notes say lines that write EEPROM (`G10 L2`, `G10 L20`, `G28.1`,
  `G30.1` and any `$` write) are safe only with send-response streaming, because the write
  disables the serial receive interrupt. `fillBuffer` in
  `src/core/controllers/grbl/streamer.ts` packed them into the character-counted window like any
  other line, so bytes arriving during the write could be lost: a lost `ok` ends in the stall
  watchdog's reset, a damaged line in a rejected or wrong move. KerfDesk's own jobs contain none
  of these lines, and its origin, probe and setting writes already go one at a time; an external
  G-code file (ADR-630) can contain them.
- **P-5.** `runStopMayHaveLostPosition` (`src/ui/app/checkpoint-interruption.ts`) judged an alarm
  code against the stock GRBL and grblHAL tables only. FluidNC numbers alarms its own way
  (`FluidNC/src/Alarm.h`): its 13 is a hard stop, which loses position, while grblHAL's 13 is
  probe protection, so an interrupted-job checkpoint could record a FluidNC hard stop as keeping
  position.
- **P-6.** `pickPins` (`src/core/controllers/grbl/status-parser.ts`) decoded `Pn:` letters X, Y,
  Z, P and D. grblHAL also reports `E` (E-stop asserted), `M` (motor warning) and `F` (motor
  fault) (grblHAL core wiki, "Report extensions"); FluidNC reports its `estop_pin` and
  `fault_pin` as `E` and `F` (`Control.cpp`). A pressed E-stop before an alarm, or a motor fault,
  showed nothing.

### Decision

1. **An EEPROM-writing line is a sync point in the streamer.** `isEepromWriteLine`
   (`src/core/controllers/grbl/eeprom-write-line.ts`) recognises any `G10`, `G28.1`, `G30.1`, and
   a `$` line that assigns (`$10=`, `$N0=`, `$I=`, `$RST=`) other than a `$J=` jog. It reads the
   line with the shared word scanner after stripping comments the way GRBL does, so `G10L20`,
   `G 10 L 2` and `G010.0` match, `G28` does not, and `G0 X0 ; G10 L2` does not. `fillBuffer`
   sends such a line only when nothing is in flight, sends it alone, and `step()` sends nothing
   after it until its reply arrives. Every other line streams as before, so KerfDesk-compiled
   jobs are byte-for-byte unchanged.

   The streamer does not know the firmware, so the rule applies to grblHAL and FluidNC too. Their
   settings stores differ and may not need it, but the cost is a few round trips for lines a job
   rarely holds, and it is never unsafe. All of `G10` is included, not only L2 and L20, because
   grblHAL's tool-table writes (L1, L10, L11) are stored too, and stock GRBL rejects other L
   values anyway.

2. **An alarm is judged against the table of the firmware that raised it.**
   `runStopMayHaveLostPosition` now takes the active controller kind (and, when the welcome
   banner named one, the detected kind) and reads `presentAlarm`'s table for each, either
   verdict counting. The FluidNC table gains a `positionLost` flag for every code. It is false for
   2 (soft limit: FluidNC feed-holds before it alarms, as GRBL does, and its own action text says
   the position is kept), 4 and 5 (probe failures) and 17 (G-code error); every other code is
   conservatively true, as in the grblHAL table. Stock GRBL and grblHAL verdicts are unchanged.
   The checkpoint callers (`job-checkpoint-repository.ts`, `start-job-retained-execution.ts`)
   already pass the laser store's state, which carries both kinds.

3. **grblHAL pins E, M and F are decoded and shown.** `GrblPins` gains optional `estop`,
   `motorWarning` and `motorFault`, set only when the letter is present, so stock GRBL reports
   decode exactly as before. The machine rail shows one short line, under the alarm notice, while
   the controller reports E or F (`ControllerPinNotice`). A motor warning alone is decoded but
   not shown, since it does not stop the machine.

### Consequences

- An external program that writes offsets or settings streams a little slower around those
  lines and no longer risks losing bytes during the write.
- A FluidNC hard stop or probe hard limit during a job is recorded as position-lost, so recovery
  asks for a re-home instead of offering the retained position.
- grblHAL's old builds (up to 2022-09-22) reported a motor fault as `M` and a warning as `W`;
  on those, a fault shows as a decoded warning only, and `W` is read as nothing. This is
  presentation only.
- None of this is hardware-tested.
