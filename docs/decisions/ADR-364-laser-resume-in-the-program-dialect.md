## ADR-364 - Laser resume re-arms the beam in the program's own dialect: Smoothieware M221, Marlin M3 I and M106 (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Amends ADR-362 decision 8: the refusal of a new resume on Smoothieware and Marlin is removed, and
nothing replaces it. Extends ADR-341 Amendment 3 with resume transform 3. Leaves the frame-first
Start contract (ADR-228) unchanged: no Start guard is added.

### Context

The laser resume builder (`core/controllers/grbl/resume-program.ts`) knew only GRBL power: M3/M4
arm the beam, M5 disarms it, and an S word on any line is power. Its preamble writes `M5`, the
beam-off re-entry `G0 X Y S0`, an `M3 S0`/`M4 S0` re-arm and a bare `F`, and its replay rewrites
power words to zero until the program reaches a burn move. The other output strategies write
different power commands:

- **Smoothieware** (`smoothieware-strategy.ts`) opens with `fire off`, writes `M400` +
  `M221 S100 P1` or `P0` for GRBL's M3/M4 and `M400` + `M221 S0` for M5, and puts a fractional S on
  G0/G1.
- **Marlin inline** (`marlin-inline-transform.ts`) writes `M5 I` and `M3 I S0` for the mode changes
  and keeps the S on G0/G1. It writes no `G54` or `G94`.
- **Marlin fan** (`marlin-fan-transform.ts`) turns the beam on with `M106 S<0-255>` lines and off
  with `M107`, and writes no S on moves.

A resume written in GRBL's commands therefore ran dark (controller audit recovery-3), so ADR-362
refused new resumes on these controllers:

- **Smoothieware:** every `M221 S100` in the rest of the job became `M221 S0`, and every burn's S
  became 0. A manual `fire` was never cleared.
- **Marlin inline:** a plain `M3 S0` either leaves the cutter in standard mode, where Marlin ignores
  the S of a G1, or leaves an output that `M5` disabled. The job ran dark until the next layer's
  `M3 I`. The bare `F` is an unknown command without `GCODE_MOTION_MODES`, so moves that relied on
  the modal feed ran at the controller's feed. `G54` and `G94` are unknown commands, and on a
  `CNC_COORDINATE_SYSTEMS` build `G54` selects a different origin.
- **Marlin fan:** every `M106 S` became `M106 S0`, and the re-entry move ran with whatever fan power
  the interruption left on.

Firmware semantics were checked in the upstream sources:

- **Marlin 2.1.2.6**, identical in 2.1.2.8: `M3-M5.cpp`,
  `GcodeSuite::get_destination_from_command` and `M400` (`planner.synchronize()`) in `gcode.cpp`,
  `parser.cpp`, `M106_M107.cpp`, `spindle_laser.h`, and the block power and fan capture in
  `planner.cpp` and `stepper.cpp`, with the default `Configuration_adv.h`.
- **Smoothieware**, edge branch at 38e2cc08: `Laser.cpp`, `Robot.cpp` and `GcodeDispatch.cpp`.

No hardware was available.

### Decision

1. **Resume transform 3 writes the program's own dialect.** The builder takes the dialect of the
   device profile the program was emitted with. `select-output-strategy.ts` makes the same choice,
   and for a saved recovery the profile is the archived one. The dialects are the GRBL family,
   Smoothieware, Marlin inline and Marlin fan. A GRBL-family program resumes exactly as under
   transform 2. The preamble keeps GRBL's order: hard-off, air, beam-off re-entry, re-arm at zero,
   feed.
2. **Smoothieware.** The preamble sends `fire off` when the program had, because manual fire
   ignores motion. It then sends units, `G90`, the work system and `G94`. When the program had set
   the scale, a hard-off `M400` + `M221 S0` follows. Then come air, `G0 X Y S0` and a re-arm
   `M400` + `M221 S<percent> P<mode>` with the scale and mode the program held (Laser.cpp applies
   `M221` at once, so `M400` waits for the re-entry first). The feed is a bare `F`, which
   GcodeDispatch runs as `G1 F`. In the replay, S on a G0-G3 line is power and an `M221 S` is a
   percent that passes unchanged. The first burn move that relies on the modal S gets the program's
   own S text.
3. **Marlin inline.** The preamble sends `M5 I`, air, `G0 X Y S0`, a re-arm `M3 I S0` (or
   `M4 I S0`) when the inline output was enabled, and `G1 F<feed>`. It writes no work system unless
   the program selected one, and never `G94`. The replay follows Marlin: the S of G1-G3 and of M3/M4
   is power, G0 and M5 zero it, and arm lines are replayed at `S0`.
4. **Marlin fan.** The preamble sends `M107` before the re-entry, `G0 X Y` without S, and
   `G1 F<feed>`. The fan power the program held comes back with its own `M106 S` immediately before
   the first move of the rest of the job. It does not come back when the program sets the fan
   first. Marlin captures a move's fan speed when the move is planned (planner.cpp), so the fan
   starts with that move.
5. **Versioning (ADR-341 Amendment 3).** New archived steps record transform 3, and the archive
   validator accepts transforms 1-3. A step recorded as 1 or 2 rebuilds GRBL bytes whatever its
   controller. A Smoothieware or Marlin recovery saved before ADR-362's refusal therefore still
   replays byte for byte.
6. **The refusal is removed from both resume paths** (`laserResumeDialectRefusal` and its table).
   The builder's existing errors are unchanged: G91, G53, G28/G30 and nothing left to run.
7. **Oracles.** `marlin-laser-power-model.ts` and `smoothie-laser-power-model.ts` in
   `src/__fixtures__/controllers` port the upstream rules that decide beam power, feed and
   position. They share no code with the builder. The Marlin and Smoothieware simulators now take
   their beam state and burn records from them.

### Consequences

- Resume and manual start-from-line work again on Smoothieware and Marlin (inline and fan), through
  the same recovery flow as GRBL.
- **Oracle test.** The test takes real emitter output: a dynamic-power fill with air, a
  constant-power line without air, and a grayscale photo with air. At every restart line, the
  resumed program burns exactly the original's moves, power, feed, beam mode and air according to
  the models. That is 193 lines on Smoothieware, 187 on Marlin inline and 259 on Marlin fan. Each
  run starts from a hostile reconnect state: a lit beam, a zero `M221` scale, an operator's manual
  fire and a framing feed. Under transform 2 the same check diverged at 193, 170 and 259 of those
  lines.
- **Mutation check.** Removing any one of these breaks the oracle test: `fire off`, the Smoothieware
  re-arm, the `I` of the Marlin re-arm, `G1 F`, the fan hard-off, the fan restore or its placement,
  and the first-burn power. Two elements change no burn of these programs and are pinned only by
  the exact-preamble tests. The Smoothieware scale hard-off does not, because a G0 never fires and
  the replay writes `S0` on moves the program runs disarmed. Marlin's `M5 I` does not, because a G0
  already zeroes the output. Both are kept so that the resume restores the program's own off state
  in its own commands, as GRBL's `M5` does.
- **Simulator end-to-end.** A job on the Smoothieware, Marlin-inline and Marlin-fan simulators runs
  whole, and its run record is interrupted. It is then resumed through the real recovery flow on a
  reconnected simulator whose board kept a lit beam. Each run resumes mid-way through the
  constant-power line (lines 118, 115 and 153) and burns the original's 40 remaining moves. Under
  transform 2 the same runs burned 66, 28 and 13 moves.
- **Transforms 1 and 2 are unchanged.** The refactored builder was compared with the shipped one,
  for every dialect, on 1,026 restart lines of real GRBL, Falcon, Smoothieware and Marlin output and
  65,725 restart lines of 2,500 seeded random programs. The bytes were identical. On the same
  inputs, transform 3 gave transform 2's bytes for GRBL-family programs.
- None of this is hardware-verified.
- **Residual: fan timing.** Marlin applies a fan speed "soon after" a move starts (its own
  `LASER_SYNCHRONOUS_M106_M107` note). If the re-entry move has zero length, the restored fan power
  can light the standing head until the first move starts. The original program does the same
  whenever its planner runs dry before an `M106`.
- **Residual: unmodelled modes.** Marlin dynamic inline mode (`M4 I`) and standard-mode power
  (`M3` without `I`) are re-armed in the mode the program used, but the oracle does not model them.
  Neither is modelled for Smoothieware manual `fire <power>` inside a program. KerfDesk's
  strategies write none of these.

### Alternatives rejected

- **Detecting the dialect from the program text**, as painted second passes do. The device profile
  is what chose the strategy, and it is archived with every recovery. A text heuristic would tie
  archived bytes to the detector.
- **Recording the dialect in each archived step.** That changes the archive schema for information
  the archived profile already holds.
- **Restoring the fan power at the end of the preamble.** It lights the standing beam when the next
  line of the program is not a move.
- **Refusing programs in Marlin standard or dynamic mode.** That is a new refusal for programs
  KerfDesk does not write.
