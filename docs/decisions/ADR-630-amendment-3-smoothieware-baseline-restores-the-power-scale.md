## ADR-630 Amendment 3 - The Smoothieware baseline restores the laser power scale (2026-10-22)

**Status:** Accepted. Amends ADR-630 "What is sent" and "Review and Start". Keeps PROJECT.md
non-negotiable 21 and ADR-565: the completed Frame stays the only ordinary Start gate. Fixes
controller audit v2 finding C6-P2-1. | **Date:** 2026-10-22

### Context

Smoothieware's laser module keeps a power scale. In `Laser.cpp` (edge branch), `M221 S` sets
`scale = S / 100`, and every G1, G2 or G3 block fires at `requested_power x ratio x scale`. The scale
is 1 at power-up, and only another `M221` changes it. `M120`/`M121` (`Robot::push_state` and
`pop_state`) save the feed and seek rates, absolute and inch mode and the work coordinate system, not
the scale.

KerfDesk sends `M221 S0` in its tool-off lines (`SMOOTHIE_FRAME_TOOL_OFF_LINES`) before every Frame,
jog and Home. Its own Smoothieware output also writes `M221 S0` for each `M5`, and `M221 S100 P1|P0`
for each `M3`/`M4`, so its own jobs set the scale they need.

An opened program is different. Its Smoothieware baseline was `G17G21G90G0`, and it must be Framed
before Start (ADR-565). So a program that sets its power only with S on its moves, such as
`G1 X10 S0.5`, ran at scale 0: the head moved and the laser burned nothing. The Run review and the
Inspector read a Smoothieware program at the power-up scale, so they showed those burns at full power.
The operator had no way around it either: a Console `M221 S100` after the Frame clears the Frame
record. The audit reproduced this with the Smoothieware simulator and the real Frame and Start. The
program burned nothing; with `M221 S100` as its first line it burned at 0.5 on both moves.

### Decision

1. **The baseline sets the scale.** On Smoothieware the baseline is `G17G21G90G0` and then
   `M221 S100` on its own line, in the spelling KerfDesk's own output uses. The baseline sets every
   mode the review reads the program in that the controller keeps between programs, and the power
   scale is one of them. `M221 S100` puts back the power-up scale that the review already assumes.
   `M221` acts as soon as it is received, but Start begins with the controller Idle and its queue
   empty, so no `M400` is needed first. The `P` word (proportional power) is left as the board holds
   it: it changes the power only while the head speeds up or slows down, and the review draws
   programmed power, not that.
2. **The tool-off lines stay.** Dropping `M221 S0` from them was the other option. A G0 never fires
   (`Laser::get_laser_power` needs a G1-G3 block, and `Robot.cpp` marks G0 blocks as not G1-G3), and
   `fire off` already ends manual fire, so the zero scale adds no protection to a Frame, jog or Home.
   But KerfDesk's own job ends with `M221 S0` too. An opened program run after a KerfDesk job would
   still have burned nothing, so only setting the scale in the program covers both cases.
3. **The review does not count the baseline as the program.** The sent program's baseline lines set
   modes the review assumes; they are not the program's own commands. The `M3`/`M4` before `S`
   warning and the "still on at the end" warning skip them. The baseline's `S100` is a percent, not an
   S the program set, and its `M221` does not leave the program's laser on. The Inspector reads the
   baseline's `M221 S100` the way it reads KerfDesk's own `M221 S100` at an `M3`: the laser is
   enabled. So Program Health no longer reports a Smoothieware program without `M3` as cutting before
   the laser is on. On Smoothieware a G1 with S burns once the scale is set, without `M3`, and the
   review already draws that burn.
4. **Resume needs no change.** An interrupted external run offers no resume (ADR-630, "Not in this
   decision"). The resume builder (ADR-364) still handles the sent bytes correctly: a resume after
   the baseline scans `M221 S100` and re-arms at it after its zero-scale re-entry, and a resume from
   the first two lines replays the baseline itself. A program whose burns depend on a scale it never
   set exists only among external runs sent before this amendment.
5. **The dialog says so.** The Run review's "Sends" line lists `M221 S100` as the full laser power
   scale.

### Consequences

- An opened program on Smoothieware burns at the power the review shows, after its Frame and after
  a KerfDesk job.
- After the program ends, the board holds scale 100, as after a reboot. The next Frame, jog or Home
  sets it to 0 again, and KerfDesk's own jobs set their own scale. A program's own `M221` still
  applies from where it appears.

### Verification

- A simulator test Frames and Starts the audit's program through the real `frameExternalProgram`
  and `startExternalProgram`. The Frame leaves the scale at 0, and the run burns both moves at 0.5.
  Without the new line it burns nothing.
- A power-oracle test resumes the sent program from every line, on a board a Frame left at scale 0.
  Each resume burns what the program burns from that line on.
- A review test checks that the baseline neither silences the `M3` before `S` warning nor raises the
  "still on at the end" warning.
- The power oracle (`smoothie-laser-power-model.ts`) now splits a line into one command per G or M
  word, as `GcodeDispatch.cpp` does. Before, it threw on the baseline's `G17`.
- No hardware qualification is claimed.
