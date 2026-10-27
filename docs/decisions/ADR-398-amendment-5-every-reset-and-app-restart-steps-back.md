## ADR-398 Amendment 5 - KerfDesk's own resets, the app closing and the app restarting step back over the planner (2026-10-27)

**Status:** Accepted. Extends ADR-398 Decision 2 to every reset KerfDesk sends against a running
job, to the Abort the app sends as it closes (ADR-548), and to a run left active by a crash,
reload or power loss. | **Date:** 2026-10-27

### Context

Rolling audit v4, findings H2-P2-1 and H2-P2-2, confirmed by a refuter and re-verified on `main`
(`docs/audits/2026-10-27-rolling-v3/H2-recovery-journey.md` on the audit branch).

ADR-398 Decision 2 has a planner-discarding stop record the controller's backlog, so the
automatic restart steps back over acknowledged moves that never ran. Only Abort, a rejected line
and a reboot were treated as planner-discarding. Three stops that throw the planner away were
not:

- **KerfDesk's own reset (H2-P2-1).** When status and acknowledgements stop for the heartbeat
  window (2 s), or a job write fails, KerfDesk contains the fault with the same soft reset Abort
  sends (`quarantineStreamFault`). The run was saved as `stream-stalled` or `write-failed` with no
  backlog, because those kinds were read as "the controller keeps running what it had". With 43
  lines acknowledged and 10 blocks queued, the heartbeat reset restarted at line 44 and Abort's
  identical reset at line 34.
- **The app closing (H2-P2-2 a).** Closing KerfDesk mid-job, including the forced Windows restart
  of ADR-548 Decision 3, sends Abort. The desktop close awaits it. The record dropped the backlog
  because "the stop may not have arrived before the page closed", a web-page doubt, and its cause
  said so on the desktop too. It restarted at line 44 instead of Abort's 34.
- **The app restarting (H2-P2-2 b).** A run left active by a crash, reload or power loss is
  promoted to `unknown` at the last saved progress, which is written every 25 acknowledgements.
  It kept no backlog, so a USB-powered board that lost power with the PC, or a board reset by the
  next connect before its planner drained, skipped up to a planner of moves. On grblHAL's 100
  blocks the restart was line 101 where Abort's would be 21.

The refuter narrowed H2-P2-1: the acknowledgement stall that fires while the controller is
responsive contains only on an `Idle` report, when GRBL's planner is empty, so it skips nothing.

### Decision

1. **A reset KerfDesk sent discards the planner, whatever the cause.** A stopped run records its
   planner backlog when its kind is planner-discarding (Abort, a rejected line, a reboot) or when
   KerfDesk sent a reset against that stream (`currentStreamWasReset`: the `streamReset` record of
   the same stream epoch). That covers the heartbeat-loss and write-failure resets, and the
   acknowledgement-stall reset, whose empty-planner report keeps its restart where it was. A
   failed write on a controller KerfDesk does not reset (Marlin) still records none: that
   controller runs what it had. A lost link is unchanged (ADR-398 Amendments 3 and 4).
2. **The app closing records the backlog like Abort.** Its record is `cancelled` with the
   backlog. Where the Abort may not have arrived (a web page unloading, a forced Windows restart,
   ADR-548 Amendment 1), a controller that kept running ran what it had, and the step back
   re-burns at most a planner. ADR-398 Decision 2 prefers that to skipping. The recorded cause
   now reads "KerfDesk was closed or reloaded while the job was running, and sent the controller
   an Abort as it closed."
3. **A run promoted after an app restart steps back over its whole planner.** The promoted
   `unknown` record carries a `planner-size` backlog at the saved progress: the planner the run's
   controller measured (idle `Bf` or `$I`, as CNC pass recovery reads it), else its family
   default (GRBL 15, grblHAL 100, FluidNC 15, Smoothieware 32, Marlin 15). Real progress was at
   least the saved count, and at most a planner of it was still queued, so the restart begins at
   or before the first move that may not have run. A controller that kept running until its
   planner drained re-burns up to a planner more than the saved lag, which Decision 2 prefers.
   The restart hint names the planner bound, as for any `planner-size` record.

### Alternatives rejected

- **Holding the heartbeat-loss or app-restart backlog for the reconnect's verdict**, as a lost
  link does (Amendments 3 and 4). After a heartbeat loss KerfDesk itself sent the reset, so
  there is nothing for a reconnect to decide. After an app restart the gap is unbounded, and a
  grblHAL or network board reads as unknown at the reconnect, which does not step back: the
  very case the audit measured. Decision 2's preference for re-burning applies.
- **Keeping the app-closing backlog only as an unconfirmed hint.** The desktop close awaits its
  Abort, so the stop is the common case, not the doubtful one.

### Consequences

- The automatic restart after a heartbeat loss, a contained write failure, the app closing or
  the app restarting steps back like Abort's. The Review's hint says which bound applied.
- More moves can burn twice after an app restart on a controller that kept running. The Review
  still shows the line and the route, and the operator may choose a later line.
- Regression tests: `src/ui/state/laser-stream-reset-backlog.test.ts` (the audit's 40
  acknowledged lines with 10 blocks queued: heartbeat loss and app closing restart at Abort's
  line), `src/ui/app/checkpoint-interruption.test.ts`, and the promotion cases in
  `src/ui/state/recovery/recovery-repository.test.ts`.

### Not covered

- Marlin's acknowledgement-stall stop sends `M410`, which drops its planner, without a reset
  record. That path was read only by the audit, and fires after 90 s without an acknowledgement,
  by which time a 15-block planner has normally drained.
- Whether a desktop app-closing record lands before the process exits was not verified. If it
  does not, the next start promotes the run (Decision 3), which now steps back too.
- No machine was operated. These are code and test results only.
