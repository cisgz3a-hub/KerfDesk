## ADR-397 - Smoothieware: KerfDesk asks the board what it can do, and warns instead of refusing (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

Amends the Smoothieware driver of ADR-094/ADR-096, the Smoothieware power rules of ADR-322 §3,
and the Smoothieware parts of ADR-361 (jog and Frame modal state) and ADR-364 (resume). The
Frame-first Start contract (PROJECT.md non-negotiable 21, ADRs 228, 230, 232, 237 and 372) is
unchanged: nothing here refuses a Frame or a Start. What the board cannot do goes to Job Review.

### Context

Controller audit 2026-09-25, Smoothieware track (Smoothieware edge `38e2cc08`): SM-2 to SM-9,
CG-3, CG-5 and CG-7. KerfDesk assumed every Smoothieware board had its Laser and Endstops
modules and a usable S range. It read `ok` as proof of work the board had not done.

- **S range (SM-7).** The planner keeps each block's S in a 12-bit 1.11 fixed-point field
  (Block.h:81 `uint16_t s_value:12`, stored as `roundf(s*2048)`, Planner.cpp:81, read back at
  Laser.cpp:246). Only 0 ≤ S < 2 reaches the laser. S255 on a 255 scale fires at 0.39 %, and S50
  on a 100 scale fires at 0 %. The shipped `firmware.bin` does the same.
- **Laser module (SM-3, SM-2).** The Laser module deletes itself unless `laser_module_enable` is
  true and its pin is a hardware-PWM pin (Laser.cpp:51-74). Without it nothing answers `fire`
  (SimpleShell.cpp:286-288), so every jog, Frame, Home and job that began with `fire off` left an
  acknowledgement owed forever. `M221 P` (constant power) exists only since edge `971eb8cf`
  (2021-06-15).
- **Home (SM-6).** `$H` answers `ok` whether or not anything homed (SimpleShell.cpp:241-252). A
  board without homing pins has no Endstops module (Endstops.cpp:114-129).
- **Frame state (SM-5).** A Frame is wrapped in `M120`…`M121` so its feed does not become the G0
  seek rate (Robot.cpp:1144-1149). A Frame stopped before its `M121` left the framing feed as the
  seek rate for every later job; Robot has no halt handler (Robot.cpp:131-133).
- **Abort (CG-3).** Ctrl-X halts the board: `HALTED, M999 or $X to exit HALT state`
  (`ALARM: Abort during cycle` in grbl mode), USBSerial.cpp:204-208 and 298-311. It does not
  reboot or print a banner, so the banner that re-arms qualification after a GRBL reset never
  came, and qualification stayed pending for the rest of the session.
- **Smaller defects.** Unsolicited `ALARM:` lines were booked as the reply to an innocent job
  line (SM-8). The status row showed the requested feed as a live feed (SM-9). The Manual Air
  latch ignored the `M9` in the tool-off lines (CG-5). "Read ($$)" was offered with no settings
  query (CG-7). The simulator was more forgiving than the firmware and hid all of this (SM-4).

### Decision

1. **Full-power S is 1.** Machine Setup holds a Smoothieware profile's Full-power S at 1 and says
   why. A saved profile with another value keeps it and gets an explicit "Set to 1": KerfDesk
   never migrates it silently (ADR-322 §6). Job Review and Save G-code warn for a Full-power S of
   2 or more. The setup guide says to set `laser_module_maximum_s_value 1.0`.
2. **Qualification asks `M221`.** One owned `M221` with no argument per qualification. The
   answer is connection evidence:
   - a `Laser power: …, disable auto power: …` report means the module is loaded, with M221 P;
   - a `Laser power scale at …` report means a build before `971eb8cf`: Job Review warns that
     constant-power layers run speed-proportional;
   - a bare `ok` means no Laser module. Jog, Frame, Home and the streamed job program leave out
     `fire off`. Test Fire and the Console `fire` are refused, because nothing would answer
     them. A laser job's Frame and Start are **not** refused: the program can be streamed, and
     it runs with the laser off. Job Review says "This job will not burn: …" with the config
     fix. An earlier draft refused the Frame and Start; that was a policy gate and was removed.
3. **A Home is confirmed only when `G28.6` says so.** After `$H` settles, KerfDesk sends an owned
   `G28.6`, which prints `X:<0|1> Y:<0|1> …` for each axis with a homing pin
   (Endstops.cpp:1114-1120). The Home is confirmed only when X and Y report 1. Otherwise it ends
   with "Home was not confirmed." and the reason: no homing switches, or the cycle did not home
   an axis.
4. **A stopped Frame's state is restored.** Each accepted Frame `M120` is counted and a completed
   Frame pops its own. Each push left over gets one `M121` at the next Idle report with nothing
   else owning the controller, so only once the board is unhalted. `M121` on an empty stack does
   nothing (Robot.cpp:340-352).
5. **Abort re-qualifies without a banner.** Capability `softResetReboots: false`. After Abort's
   Ctrl-X, or the stream-error stop, KerfDesk re-arms qualification itself. Qualification runs on
   the first fresh Idle after an Alarm report, so a report printed before the reset landed
   cannot start it; in practice it runs once the operator clears the halt with `M999`.
6. **Reports, not assumptions, elsewhere.** `ALARM:` lines are a code-less alarm event that
   settles no line (SM-8). The status row shows feed only while the board runs, S from `S:` and
   the live power from `L:` (SM-9). A jog, Frame or Home write containing `M9` clears the Manual
   Air latch (CG-5). "Read ($$)" and the settings auto-read appear only with a settings query
   (CG-7). The modal-state query is `$G` (ADR-396).
7. **Simulator.** The Smoothieware simulator follows the firmware: Ctrl-X halts, halted lines
   draw `!!`, G92 is an offset, Laser and Endstops modules are options, `G28.6` and `M221` report,
   and S is stored in 12 bits.

### Consequences

- A Smoothieware board with homing but no Endstops module can no longer show a confirmed Home.
  The operator configures homing or turns homing off in Machine Setup.
- On a board without the Laser module a laser job runs dark, with a Job Review warning. Nothing
  wedges.
- Every Smoothieware Home costs one more round trip (`G28.6`).
- Regression tests: `smoothie-power-scale.test.ts`, `smoothie-full-power-s.test.tsx`,
  `laser-module.test.ts`, `laser-module-readiness.test.ts`,
  `laser-module-probe.simulator.test.ts`, `start-laser-module-readiness.test.ts`,
  `home-verification.test.ts`, `laser-home-smoothie-verification.simulator.test.ts`,
  `laser-frame-modal-restore.simulator.test.ts`, `laser-job-stop.smoothie.simulator.test.ts`,
  `laser-controller-qualification-alarm-wait.test.ts`,
  `laser-alarm-line.smoothie.simulator.test.ts`, `laser-tool-off-air.simulator.test.ts`,
  `smoothieware-driver.test.ts`, `smoothie-simulator.test.ts`.
