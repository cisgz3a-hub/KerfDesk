## ADR-462 - Best-effort air repeats at eligible job boundaries (2026-09-27)

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
    the air. This suggests a possible shared control path; the installed A1 Pro's fan mapping
    remains unverified.
- **Why ADR-345 was not enough.** Its advisory tells the operator to send `$152=100`. The A1 Pro's
  GRBL page does not list `$152`, and KerfDesk cannot read it back. The job itself still sent a
  single `M8`.

### Decision

On a profile that declares `airAssistRestartUnreliable`, the GRBL laser emitter attempts air
command repeats while air is on. The Falcon A1 Pro preset declares it. `withAirKeepAlive` in
`core/output/air-keep-alive.ts` post-processes the finished program as follows:

- **When a repeat is written.** Before an eligible motion line, once estimated time since the
  last air command reaches `AIR_KEEP_ALIVE_SECONDS` (5 s), it writes the command the program last
  used to switch air on (`M7` or `M8`). Nothing is written after `M9` or while air is off. The
  trigger is best effort, not a maximum elapsed-time gap or a promise that a firmware timer
  cannot expire.
- **How time is counted.** Each move counts as if it started and ended at rest, under the
  profile's acceleration and at no more than its maximum feed. `G4` dwells count as well.
  Generated absolute-mm XY-plane `G2`/`G3` use the shared I/J/R center and sweep math, including
  full circles, rather than the endpoint chord. Full-circle center-only blocks are motion
  boundaries too. Counting short blended moves from rest can overestimate their duration, but
  these configured assumptions are not a controller wall clock. Unresolved arc duration makes
  the next eligible boundary due without changing or rejecting the supplied motion.
- **Where a repeat is placed.** Under `M3`, a repeat waits for a laser-off move, following the
  output cursor's rule for air changes (OR-1). A vendor firmware that drained its planner on the
  repeat would then stop the head with the beam dark. Under `M4` any stop is already dark.
- **Limits of insertion only.** A single long line or arc, a dwell, or continuous M3 burns can
  leave a gap longer than 5 s, including longer than the reported 20–30 s standby. No repeat is
  inserted inside a block and no motion is segmented or otherwise rewritten to force a repeat.
  A final long burn followed by `M9` may have no repeat at all. Firmware/`$152` advice therefore
  remains necessary even when this option is enabled.
- **Firmware that handles `M8` normally.** A repeat changes nothing there. Stock GRBL syncs
  coolant only when the state differs (`grbl/gcode.c` lines 952-956). grblHAL drops an unchanged
  `M8` before executing the block (`gcode.c` line 2647). So on those firmwares a repeat never
  stops the head.
- **Profiles without the flag.** Their bytes are unchanged, and so are CNC coolant and the Marlin
  and Smoothieware strategies.
- **Output identity.** `EMITTER_REVISION` becomes
  `trace-arcs-relief-width-ramp-contact-air-scan-v2-20260927-v7`, preserving the existing relief,
  adaptive-ring, cutter-width, ramp and sampled-contact provenance, native laser arcs and
  compact Fill, plus ADR-445's scan-v2 state and dark handoff repairs.

The Job Review standby advisory, the Machine Setup "Air restart" tooltip, and WORKFLOW F.3
describe the best-effort repeat and its gaps. `$152=100` and installed-firmware qualification
stay the advice for when air still stops; no controller setting is written automatically.

The repeat uses the existing flag rather than a new profile field. Both behaviours work around
the same firmware timer, and an operator who clears the flag after sending `$152=100` needs
neither of them. This also leaves the saved-profile schema unchanged.

### Consequences

- A dense fill can gain frequent short air-command lines. The original owner's synthetic
  362,007-line fill gained 6,856 repeats (20,568 bytes, 0.5%) in a reported 266 ms run. That
  fixture measurement is not a throughput or repeat-frequency guarantee for other programs.
- A program that never switches air on skips the pass entirely.
- Resume programs are rebuilt from the emitted text, so they carry the repeats too. The selective
  second pass writes its own program and does not repeat the command.
- A saved Falcon profile whose "Air restart" is cleared sends a single `M8`, as before.

### Evidence and limits

- `air-keep-alive.test.ts` pins the following:
  - the trigger on short moves, `M7` versus `M8`, and no repeat after `M9`;
  - that under `M3` a repeat waits for a dark move, and that under `M4` it does not;
  - that dwells count and comments are ignored;
  - the individual rest-to-rest estimate under supplied limits.
- `air-keep-alive-arcs.test.ts` independently brackets the timing of radius-10 full circles,
  minor arcs and 270-degree arcs with I/J and positive/negative R words. It also checks modal
  arcs and center-only circles. These independently check duration beyond chord length;
  integration with ADR-432 preserves native G2/G3 output and existing per-profile arc eligibility.
- `air-keep-alive-boundaries.test.ts` explicitly retains the limitations: a 100-second G1,
  30-second dwell and more than 30 seconds of continuous M3 cutting exceed the trigger.
  Repeats after M3 lines or a full circle remain after a dark move.
- `prepare-output-air-assist.test.ts` compiles a Falcon A1 Pro fill-and-line job through the real
  pipeline. In that specific short-block fixture, timed by KerfDesk's planner
  (`buildProgramTimeline`), no two air commands are more than 6 s apart; that observation is not
  a bound for arbitrary jobs. The program switches air once each way, and every repeat precedes
  a motion line. `prepare-output-air-keep-alive-boundaries.test.ts` compiles a 100-mm line at
  60 mm/min through the same real Falcon pipeline in constant and dynamic power modes: the
  single intact burn leaves at least a 100-second gap with only the initial `M8` and final `M9`.
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
