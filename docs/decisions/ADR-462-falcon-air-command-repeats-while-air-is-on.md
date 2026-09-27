## ADR-462 - The Falcon's air command is repeated while a job wants air (2026-09-27)

**Date:** 2026-09-27
**Status:** Implemented; software verification recorded below. Hardware qualification requires
separate evidence (WORKFLOW F.3 step 13).

This builds on ADR-335 and ADR-345, which recorded the Creality A1 family's air standby timer, and
on ADR-370, which let the Falcon Console send `$152`. It adds no Start guard. Job Review stays
advisory (rule 7 / ADR-228).

### Context

The maintainer reported that the fans on their Falcon A1 Pro "go off after a while" during a job.
They first reported air that "works for a few minutes and then stops" on 2026-09-22 (ADR-345).

- **KerfDesk's bytes.** A Falcon A1 Pro job with every operation's Air on emits one `M8` before
  the first burn and one `M9` after the last. An Air-off operation between two Air-on ones is
  bridged (ADR-335). No idle timer, keep-alive, or status poll sends an air word. The Air assist
  switch that ADR-430 restyled writes the same `airAssist` field as before. Nothing KerfDesk sends
  mid-job switches the air off.
- **The firmware.** The A1 firmware stops the pump a fixed time after `M8`.
  - A user testing A1 firmware 1.0.6 (`$152=30`) found that air "does turn off after a while
    (20ish seconds) with the main fan unless I continue issuing M8s".
  - The same user found that `$152=0` turns air off immediately after `M8`, that `$152=5` runs it
    for about 2 s, and that `$152=100` "seems to be the magic value that disables standby". These
    tests are in LightBurn forum thread 181704, posts 19, 22 and 24.
  - LightBurn staff call "air assist turning off after 30 seconds on the Falcon A1 and A1 Pro" a
    confirmed firmware bug (same thread, post 2).
  - On the Creality forum (thread 41420), `M8` is described as switching the exhaust along with
    the air. That makes "the fans go off" the same event as the pump stopping.
- **Why ADR-345 was not enough.** Its advisory tells the operator to send `$152=100`. The A1 Pro's
  GRBL page does not list `$152`, and KerfDesk cannot read it back. The job itself still sent a
  single `M8`.

### Decision

On a profile that declares `airAssistRestartUnreliable`, the GRBL laser emitter repeats the air
command while air is on. The Falcon A1 Pro preset declares it. `withAirKeepAlive` in
`core/output/air-keep-alive.ts` post-processes the finished program as follows:

- **When a repeat is written.** Before a motion line, once the time since the last air command
  reaches `AIR_KEEP_ALIVE_SECONDS` (5 s), it writes the command the program last used to switch
  air on (`M7` or `M8`). Nothing is written after `M9` or while air is off.
- **How time is counted.** Each move counts as if it started and ended at rest, under the
  profile's acceleration and at no more than its maximum feed. `G4` dwells count as well. The
  resulting figure is higher than the real time, so on a machine at least that quick, two
  repeats are never further apart than the interval. The shortest standby reported (20 s) is four
  times longer.
- **Where a repeat is placed.** Under `M3`, a repeat waits for a laser-off move, following the
  output cursor's rule for air changes (OR-1). A vendor firmware that drained its planner on the
  repeat would then stop the head with the beam dark. Under `M4` any stop is already dark.
- **Firmware that handles `M8` normally.** A repeat changes nothing there. Stock GRBL syncs
  coolant only when the state differs (`grbl/gcode.c` lines 952-956). grblHAL drops an unchanged
  `M8` before executing the block (`gcode.c` line 2647). So on those firmwares a repeat never
  stops the head.
- **Profiles without the flag.** Their bytes are unchanged, and so are CNC coolant and the Marlin
  and Smoothieware strategies.

The Job Review standby advisory, the Machine Setup "Air restart" tooltip, and WORKFLOW F.3 now
describe the repeat. `$152=100` stays the advice for when air still stops.

The repeat uses the existing flag rather than a new profile field. Both behaviours work around
the same firmware timer, and an operator who clears the flag after sending `$152=100` needs
neither of them. This also leaves the saved-profile schema unchanged.

### Consequences

- A dense fill gains one short line roughly every 50 motion lines. The count is conservative
  because every segment is counted as a full stop. A synthetic 362,007-line fill gained 6,856
  repeats (20,568 bytes, 0.5%), and the pass took 266 ms.
- A program that never switches air on skips the pass entirely.
- Resume programs are rebuilt from the emitted text, so they carry the repeats too. The selective
  second pass writes its own program and does not repeat the command.
- A saved Falcon profile whose "Air restart" is cleared sends a single `M8`, as before.

### Evidence and limits

- `air-keep-alive.test.ts` pins the following:
  - the interval, `M7` versus `M8`, and no repeat after `M9`;
  - that under `M3` a repeat waits for a dark move, and that under `M4` it does not;
  - that dwells count and comments are ignored;
  - the rest-to-rest time bound.
- `prepare-output-air-assist.test.ts` compiles a Falcon A1 Pro fill-and-line job through the real
  pipeline. Timed by KerfDesk's own planner (`buildProgramTimeline`), no two air commands are more
  than 6 s apart, the program still switches air exactly once each way, and every repeat precedes
  a motion line.
- The same file pins that the unflagged profile still emits `M8 M9 M8 M9`. Removing the emitter
  hook fails two of its tests.
- **Not verified:**
  - whether A1 Pro firmware restarts its timer on a repeated `M8` during a running job, as the A1
    user saw from the console;
  - whether the enclosure fan follows `M8` on the A1 Pro.

  No hardware was operated. WORKFLOW F.3 step 13 is the check.

Sources:
- https://forum.lightburnsoftware.com/t/creality-falcon-a1-support/181704
- https://forum.creality.com/t/creality-falcon-a1-air-assist-always-on/41420
- https://github.com/gnea/grbl/blob/master/grbl/gcode.c
- https://github.com/grblHAL/core/blob/master/gcode.c
