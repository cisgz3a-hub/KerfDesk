## ADR-395 - Marlin: Abort quick-stops with M410, Pause switches the beam off, and "Unknown command" is a skipped line (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

Amends the Marlin stop and pause handling of ADR-094/ADR-361 and the stream-hold wording of ADR-333.
The Frame-first Start contract (PROJECT.md non-negotiable 21, ADRs 228, 230, 232, 237 and 372) is
unchanged: nothing here gates Start. A job that Marlin runs without one of its commands is stopped,
because the rest of it would run in a different state from the one the operator framed.

### Context

Controller audit 2026-09-25, Marlin track (Marlin 2.1.2.8 source): MA-1, MA-3, MA-4, MA-5, MA-7,
MA-9, MA-10, MA-11, MA-12, CG-10 and ST-5.

- **Abort did not stop Marlin (MA-7).** KerfDesk sent `M5` and `M107`. `M5` synchronizes with the
  planner (M3-M5.cpp:140-156), so it waits behind every queued move while the laser keeps burning.
  `M410` is acted on as soon as it is read, before the queue, even without `EMERGENCY_PARSER`
  (queue.cpp:537-545), and drops the planner.
- **Pause left the beam on (MA-1).** Marlin has no realtime pause, so Pause stops sending and the
  accepted moves run out. In the fan dialect the fan speed stays applied to the idle fan header
  (planner.cpp:1385-1399); in the inline dialect the last block's power stays applied.
- **"Unknown command" counted as success (MA-12).** A build without, say, `AIR_ASSIST` answers
  `echo:Unknown command: "M8"` and then `ok` (parser.cpp:388-393, gcode.cpp:1114-1122), so a job
  ran without its air assist and nothing said so.
- **Smaller defects.** Busy keepalives (`echo:busy: processing`, every 2 s) did not keep an owned
  command or the stall clock alive (MA-4, MA-9); a comment-only Console line gets no reply at all
  (queue.cpp), wedging the session (MA-5); M112 and `kill()` need a reset or power cycle, not a
  reconnect (MA-10); M9 is the only command that switches Marlin's air off (M7-M9.cpp; CG-10); a
  programmed `G4` spin-up dwell was announced as a held program on GRBL-family controllers (ST-5).

### Decision

1. **Abort quick-stops Marlin.** ABORT JOB, ABORT MOTION and the fail-dark stops send `M107`,
   `M410`, `M5 I`, and `M9` when air may be on (Manual Air on, or the job has an M7/M8 line). The
   stream is cancelled but its in-flight lines stay counted, because Marlin still answers them.
   An active job raises the notice: "Marlin was quick-stopped: KerfDesk sent M107, M410 and M5 I,
   which drop the moves Marlin had queued and switch the laser off within about a second. A quick
   stop halts the motors without slowing down, so the position may have slipped: re-home, or
   re-check the origin, before running again. …" Homing becomes unknown. The stream-error stop and
   Disconnect while anything may still run send the same lines. GRBL-family controllers and
   Smoothieware are unchanged.
2. **Abort keeps Marlin's origin.** Only a stop that sent a reset byte forgets the work origin;
   Marlin was not reset and keeps its G92 shift (MA-3).
3. **Pause switches the beam off behind the accepted moves.** After freezing the stream KerfDesk
   queues `M107` (fan dialect, fan above 0) and/or `M5 I` (inline mode active), and says so in the
   log. Resume is refused while those are still owed; when they are acknowledged, Resume writes
   the held power into the next burn move and re-arms the laser (`M106 S<held>` and/or
   `M3 I S0` / `M4 I S0`) before refilling the stream.
4. **"Unknown command" is a skipped line.** It becomes its own event naming the build option the
   command needs (M3-M5: LASER_FEATURE; M7: COOLANT_MIST; M8: AIR_ASSIST or COOLANT_FLOOD; M9:
   AIR_ASSIST or COOLANT_CONTROL; M106/M107: a fan output). During a job the `ok` after it counts
   as an error: the stream stops, the quick stop is sent, and the notice names the command and the
   missing option. An owned command is refused with the same text.
5. **Keepalives and dwells.** A busy line refreshes an activity-timed owned command (the M400
   settle, G28 Home) and the stall clock. A hold names a controller state only when a status
   report arrived during the wait. On GRBL-family controllers, a head line `G4 P<s>` is shown as
   "DWELLING (SPINDLE SPIN-UP)" for its programmed time plus 2 s, with no hold notice.
6. **Console and halts.** The Marlin Console refuses a comment-only line. `Error:Printer halted.
   kill() called!` raises a notice that the controller needs its reset button or a power cycle,
   and no stop lines are written after it. The M112 quick command says the same.
7. **Simulator.** The Marlin simulator models the 4-line command buffer, the 16-block planner,
   planner-synchronizing commands, busy lines, silent comment lines, build options, M410, M112,
   and G92 with its position echo.

### Consequences

- A Marlin Abort stops within about a second, at the cost of position certainty; the operator is
  told to re-home or re-check the origin.
- ABORT MOTION or Disconnect during a Marlin `G28` now sends `M410`, after which stock Marlin halts
  with "homing failed"; the halted notice explains the reset.
- Stop lines sent to a halted board are never answered and stay owed until reconnect.
- Regression tests: `laser-job-stop.marlin.test.ts`, `laser-quick-stop.test.ts`,
  `laser-stream-pause-beam.test.ts`, `stream-pause-beam.test.ts`,
  `laser-interactive-command.busy.test.ts`, `laser-stream-hold.marlin.test.ts`,
  `laser-stream-hold.test.ts`, `LiveMotionBar.hold.test.tsx`, `laser-unknown-command.test.ts`,
  `laser-lifecycle-marlin.simulator.test.ts`, `laser-console-marlin.simulator.test.ts`,
  `laser-error-line.marlin.test.ts`, `marlin-driver.test.ts`, `marlin-simulator.test.ts`.
