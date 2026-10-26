## ADR-341 Amendment 10 - Start from line counts the project's program, a late alarm ends the run, and untracked runs retire older offers

**Status:** Accepted. | **Date:** 2026-10-21

### Context

The rolling audit of 2026-10-21 (`docs/audits/2026-10-21-rolling-v2/05-job-lifecycle.md`)
found three recovery defects against the rule that recovery recuts and never skips. A refuter
reproduced each one, the second with the Smoothieware simulator.

1. **05-P2-1.** The **Start from line** field was filled in with the saved interrupted run's
   automatic restart line for any laser record. When that run was itself a resumed recovery
   or a painted second pass, the line counted the run's own program. **Resume from line**
   always rebuilds the project's full program (the source deliberately skips a resumed or
   painted record), so it restarted at the same number in a different program. After a
   recovery stopped again, the project's line 32 was `X28` where the resume program's was
   `X82`, and everything in between burned twice. When the first resume started within its
   preamble's length of the program start, a few lines were skipped instead. The
   confirmation named only line numbers.
2. **05-P2-2.** An alarm that arrived after the last `ok` left the stream `done`, because the
   streamer keeps `done` terminal. Smoothieware answers a move once it is queued and holds up
   to 32 (`GcodeDispatch.cpp`, `Conveyor.cpp` `planner_queue_size`), and its kill button or a
   hard limit flushes that queue (`Conveyor::on_halt`). The alarm dropped the post-job settle,
   the next Idle released the stream, and the run was saved as an unexplained stop with no
   planner step-back. The automatic restart was the last line, so the discarded moves were
   skipped. The same alarm one acknowledgement earlier was saved as a cancellation with the
   planner step-back.
3. **05-P3-1.** An external G-code run (ADR-630) and the camera calibration target start
   without a run id. Unlike the manual restart, they left the previous job's recovery card,
   its Run again receipt and its second-pass offer in place, although the machine had since
   run something else. Amendment 4 decision 1 offers a second pass only for the last run.

### Decision

1. **The field is not filled in for a resumed or painted record.** A record whose archived
   program carries a resume chain or a second-pass chain leaves the field at 1. Its hint says
   that the record's lines count its own program, not the project's full program the control
   replays, and that the card's Review restarts that program where it stopped.
   **Choose restart point…** opens at the same line. The line is not translated into the
   project's numbering: the manual source may compile from the receipt, the last manual
   restart or the live settings, and only the card's Review replays the archived program
   itself.
2. **The confirmation says which program the line counts:** the project's full program, its
   length, and which run it reproduces (the interrupted job, the last completed job, the last
   manual restart, or the program as it compiles now). When a saved interrupted job ran a
   resume program or a painted pass, or the project no longer reproduces its program, the
   confirmation says that job's numbers are not these. **Choose restart point…** shows the
   same note.
3. **An alarm that reaches a `done` stream ends the run as `cancelled`.** This applies to an
   `ALARM:` line, numbered or text, and to an Alarm status report, unless KerfDesk's own reset
   raised it. A `done` stream stays in the store only until the post-job settle has seen its
   marker and fresh Idle, so every such alarm arrived before the motion was confirmed. The
   run is then saved as a stop that discarded the planner, with the planner step-back the
   same alarm gets while lines are still streaming. The streamer itself is unchanged.
4. **An untracked Start retires the older offers.** The external run, the camera target and
   the manual restart retire the recovery card, the Run again receipt and the second-pass
   offer once their program may have reached the controller: when Start returns, or after a
   program write was attempted. The in-memory second-pass offer for a job too large for the
   archive (Amendment 7) is withdrawn too. A refusal before any program write keeps them.

### Consequences

- After a recovery that stopped again, the manual control no longer suggests a line from
  another program. The card's Review remains the way to continue the archived program.
- A late alarm on Smoothieware replays up to 32 moves, some of which may already have burned.
  The Review says so. Skipping them was the worse failure, and it was invisible.
- On GRBL-family controllers, a hard limit after the last `ok` is now saved as a cancellation
  at the alarm instead of a reboot at the banner that follows. Both step back over the planner.
- The rail no longer holds the job lock after such an alarm: the stream is no longer active,
  as after an alarm mid-job.
- Running an external file or the camera target after a finished job removes **Paint a second
  pass…** and **Run again** for that job, and after an interrupted job removes its card. The
  job's archive stays in **History & recovery → Execution archive**.

### Evidence

- `StartFromLineControl.derived-run.test.tsx`: a resumed and a painted record leave the field
  at 1 (main filled in 22 and 23), and Resume from line asks a confirmation naming the
  project's program and the saved job's own program. A record of the project program still
  fills in its automatic line.
- `laser-alarm-done-tail.smoothie.simulator.test.ts`: on the Smoothieware simulator, the kill
  button after the last `ok`, and a silent halt seen only in the Alarm status report, end the
  stream `cancelled` (main left it `done`) and save a planner-size backlog of 32 with the
  matching restart line, the same as a kill while lines are still streaming.
- `untracked-start-retirement.test.ts`: an accepted untracked Start or an attempted write
  retires the receipt, the card and the in-memory offer; a refusal before writing keeps them.
  `external-run.store.test.ts` and `transient-camera-job.test.ts` check both Starts retire
  them once.
- **Not verified:** no hardware. Smoothieware's queue depth and halt behaviour come from its
  source, as cited in the driver and the simulator.
