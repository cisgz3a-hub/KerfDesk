## ADR-395 Amendment 1 - Marlin: a move it skips stops the Frame, jog or job (2026-10-22)

**Status:** Accepted. Amends ADR-395 (decision 4). | **Date:** 2026-10-22

The Frame-first Start contract (PROJECT.md non-negotiable 21, ADR-565) is unchanged: a completed
Frame is still the Start gate. This amendment stops a Frame whose moves never ran from counting as
completed.

### Context

Controller audit v2, finding C6-P2-2 (Marlin 2.1.2.8 source):

- **`NO_MOTION_BEFORE_HOMING` skips every move.** The option is off by default
  (Configuration.h:1697). With it, `MOTION_CONDITIONS` is `IsRunning() && !homing_needed_error()`
  (module/motion.h:461-465) and G0/G1 (and G2/G3) return early when it is false
  (gcode/motion/G0_G1.cpp:48, G2_G3.cpp:426). `homing_needed_error()` echoes `MSG_HOME_FIRST`,
  "Home %s First", with every unhomed main axis (module/motion.cpp:1479-1496,
  lcd/language/language_en.h:596), so the line is `echo:Home XYZ First`. gcode.cpp:1122 still
  answers the line `ok`.
- **A stopped Marlin does the same.** stop() prints STR_ERR_STOPPED once as `Error:`
  (MarlinCore.cpp:965-980). After that, queue.cpp:523-535 prints it bare for every G0-G3 it
  reads, and the handler skips the move (`IsRunning()` is false) and answers `ok`. That line is
  printed when the move is read, so it can arrive before an earlier line's `ok`.
- **KerfDesk took both for success.** `echo:Home … First` was a plain message and the stopped
  line an unknown line; only `echo:Unknown command` was a skipped line (decision 4). Frame
  completion compares the end position with the start position (framed-run.ts), so a Frame whose
  moves were all skipped passed and unlocked Start. During a job every move was skipped with
  `ok` while `M106 S<n>` still ran, which lights a fan-wired laser (`marlin-fan` dialect) at the
  parked head.
- **KerfDesk's Home is `G28 X Y`** (marlin/commands.ts), so a build with a Z axis still needs Z
  homed after Home.

### Decision

1. **A skipped move is a rejection of the line.** The Marlin driver classifies
   `echo:Home <axes> First` and the stopped line (bare or `Error:`) as an error that keeps the
   line's acknowledgement debt, like a handler `Error:` (its own `ok` follows), and tags it with
   the reason (`home-first` with the axes, or `stopped`). The existing rejection path then acts:
   - a job stream freezes before its next line and the quick stop is sent (`M107`, `M410`,
     `M5 I`); with ping-pong streaming nothing after the skipped line was written, so an `M106`
     after it is never sent;
   - the Frame or jog whose line it answers is cancelled, so the Frame never mints a permit;
   - an owned command is refused on its `ok`, with the plain reason.
2. **A stopped Marlin stops whatever Frame or jog is running**, not only the one that owns the
   oldest reply, because its notice arrives in read order and every later move is skipped too.
   `Home … First` is printed while its own line runs, so it keeps answer-order attribution.
3. **The notice says why and what to do.** It names the unhomed axes. KerfDesk's Home stays
   `G28 X Y`: a plain `G28` drives Z toward an endstop that many laser conversions do not have.
   When the echo names an axis other than X or Y, the notice says that Home homes X and Y only,
   and asks the operator to home that axis from the Console (`G28 Z`) if it has an endstop, or to
   turn `NO_MOTION_BEFORE_HOMING` off. A stopped controller is told to read the error in the Laser
   Log and send `M999 S1`: plain `M999` also flushes and asks for a line resend
   (gcode/control/M999.cpp), which KerfDesk does not support. The Console transcript decodes both
   lines with the same reason.
4. **Simulator.** The Marlin simulator gains the `noMotionBeforeHoming` build option, per-axis
   homing (`G28 X Y` homes X and Y; `G28` homes all), and `stop()`.

### Consequences

- On a `NO_MOTION_BEFORE_HOMING` build, a Frame before every axis is homed fails at its first leg
  with the reason, instead of passing in place.
- A spontaneous `Error:Printer stopped…` now raises the stopped notice with `M999 S1` advice
  instead of the generic "unrecognized controller error" one.
- Regression tests: `src/ui/laser/marlin-home-first.test.ts` (Frame, Home then Frame, homed
  control, job before `M106`, jog, stopped Marlin), `laser-motion-refusal.test.ts`,
  `marlin-driver.test.ts`, `marlin-simulator.test.ts`.
- Not hardware-tested.
