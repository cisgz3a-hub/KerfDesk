## ADR-341 Amendment 4 - A second pass is offered for the job that just finished, and nothing older (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

### Context

The operator reported that **Paint a second pass…** in the Machine panel did nothing, that
the panel listed a growing set of older completed jobs in **Completed job for a second
pass**, and asked for the flow to be: when a job is done, offer a second pass for that job
only.

Reproduced in real Chrome against the fake Web Serial controller:

1. Finish a job, then start another and press **ABORT JOB**. Abort leaves the cancelled
   stream in the laser store, and its `activeRunId`, until the next Start.
2. The interrupted run clears the last completed receipt, so the picker fell back to the
   newest older completion in the execution history (the 2026-09-23 job in the report).
3. Clicking **Paint a second pass…** set the editor request. The editor treated any
   `activeRunId` other than its own run as a newer run that superseded the opening, and
   closed itself in the same tick. Nothing appeared.

Separately, painted drafts were retained for the 20 most recently edited jobs (rule 9 of
ADR-341), and the picker drew on the execution history, which retains up to 20 terminal
runs for export and recovery.

### Decision

1. **One job is offered: the last run, when it completed.** The Machine-panel button binds
   the last completed receipt, the same run the **Job complete** prompt offers. There is no
   history picker. A later run that is interrupted or aborted clears that receipt, so the
   button disappears rather than falling back to an older job. A CNC, Marlin or
   Smoothieware completion shows no button, and no older job is offered in its place.
2. **Only a live stream supersedes an opening.** The editor and the completion prompt cancel
   when another run holds the stream: a streamer exists for a different run (or an
   untracked one) and has not ended `cancelled` or `disconnected`. A leftover `activeRunId`
   from an aborted run is not a newer run. The Machine-panel button is enabled only when no
   stream needs the job controls, so the editor it opens can no longer close itself.
3. **One painted draft is kept.** Saving a draft replaces any other job's draft. An envelope
   written by an older build with up to 20 drafts still reads, and the next save trims it
   to the one job. The legacy v1 key is still left untouched.
4. The completion prompt says the Machine-panel button reopens the job until another job
   starts. The prompt's timing, focus and deferral rules (rule 10, Amendment 3) are
   unchanged.

The execution history and its **History & recovery → Execution archive** panel are not
changed: they keep up to 20 terminal runs within 100 MiB for export, recovery lineage and
painting from a recovered or painted run's original engraving. The second-pass workflow no
longer lists them.

### Consequences

- An operator cannot paint a second pass on a job older than the last run. Exporting that
  job's stored artifact from the Execution archive still works.
- After a painted pass or a recovery completes, the offer still opens the original full
  engraving when its verified ancestor is retained, as before.
- Painted strokes for an older job are discarded at the next draft save for another job.

### Evidence

- `SecondPassHost.test.tsx`: the Machine-panel button opens the job that just finished with
  a cancelled stream and a stale `activeRunId` present (fails before rule 2), offers only
  the newest completion, disappears after a later interrupted run, and does not fall back
  when the newest completion is unsupported.
- `second-pass-draft.test.ts`: one draft retained; a 20-draft envelope reads and trims.
- `e2e/recovery-second-pass-stress.spec.ts`: finish, **Not now**, **Paint a second pass…**
  opens the workbench with no picker; a later aborted job removes the button.

### Alternatives rejected

- **Clearing `activeRunId` when a run is aborted.** Recovery, variable-text advancement and
  hosted refill read it; changing its lifetime reaches well beyond this workflow. Checking
  for a live stream at the second-pass consumer is enough.
- **Shrinking the execution history to one run.** It serves export, recovery lineage and
  the original-engraving lookup above, not only the second pass.
