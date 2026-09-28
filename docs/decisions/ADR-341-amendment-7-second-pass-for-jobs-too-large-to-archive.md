## ADR-341 Amendment 7 - A job too large for the archive is still offered a second pass (2026-09-27)

**Status:** Accepted. | **Date:** 2026-09-27

### Context

After Amendment 4 merged, the operator finished a job on a Creality Falcon A1 Pro and saw
neither the **Job complete** prompt nor **Paint a second pass…**. The Execution archive showed
no entry for that job at all. The newest entry was a 124,792-line photo engraving from the day
before, stored at 61.4 MiB. The operator's photo engravings run to 250,000-300,000 lines
(ADR-356 records a 298,082-line one), so they need well over the archive's 64 MiB for each
job.

The second pass depended on the execution archive in two places:

1. **Completion.** The checkpoint tracker offered a second pass only after the repository
   recorded the run as completed. A run whose archive was refused at Start was never active in
   the repository, so its completion was a no-op. The tracker reported that no-op as "Job
   recovery tracking hit an unexpected error", and offered nothing.
2. **The source.** The prompt, the Machine-panel button and the editor all read the archived
   artifact through the last completed receipt.

Job Review already warned before Start that such a job "cannot be resumed from a saved copy,
and the offer to darken areas after it finishes will not appear". The operator asked for a
second pass on the job that just finished, whatever its size.

### Decision

1. **The page keeps a run the archive refused.** When staging a laser run's archive fails,
   because the program is over the budget or the write failed, the page keeps what it needs to
   build that run's execution artifact (`src/ui/state/laser-unarchived-run.ts`). Only laser
   runs on a controller the second-pass transformer reads are kept.
   - The artifact is built only when the operator opens the editor. It uses the same inputs and
     provenance the archive attempt used, without the archive budget
     (`createExecutionArtifact` with `enforceArchiveBudget: false`). Building it at Start would
     add the whole-job walk that ADR-352 took off the path between Start and the first
     acknowledgements.
   - The copy is never written to storage, so the budget, which protects IndexedDB and the
     execution history, still applies to every archive.
2. **A clean finish of the kept run is the job that just finished.** The checkpoint tracker
   applies the same clean-settle rule as for an archived run. When the repository answers the
   completion with a no-op and the run is the kept one, the tracker marks it completed and
   offers the second pass. The no-op is no longer reported as a tracking failure, for
   completions, interruptions and progress writes alike; Start has already told the operator
   that the run keeps no archive.
3. **The same prompt and button.** **Job complete** and **Paint a second pass…** accept either
   the archived receipt or the kept run, and the editor opens the kept run from memory. For a
   kept run the prompt adds that the offer also ends when KerfDesk is closed or reloaded.
4. **Only the job that just finished (Amendment 4).** A run that begins forgets the kept run,
   whatever kind of run it is. An interruption releases the kept copy as soon as the tracker
   sees it, whatever the repository answers for that interruption. Accepting a Start without an
   archive already clears the archived receipt, so at most one of the two exists.
5. The Job Review capacity warning now says that the darkening offer still appears until
   another job starts or KerfDesk closes. It still says that an interruption cannot be resumed
   from a saved copy.

### Consequences

- A photo engraving of any size gets the **Job complete** prompt and the Machine-panel button
  after it settles cleanly.
- The kept inputs stay in memory until the next run begins or the page closes. The streamer
  already held that program for the length of the job.
- A painted pass on a kept run starts through the ordinary Start path. When its own program is
  over the budget, it streams without an archive as any other large job does.
- Recovery after an interruption is unchanged: a job with no archive has no recovery capsule.
- Opening the editor for a very large job builds and verifies the full artifact once. That takes
  time proportional to the job, after the job has finished.

### Evidence

- `start-job-unarchived-completion.test.ts`: on the GRBL simulator, a Start whose archive write
  fails runs to a clean finish and is offered a second pass with no failure report. Its kept
  artifact carries the program that was sent and passes the integrity check. The test fails
  before the tracker change.
- `job-checkpoint-completion-offer.test.ts`: a kept run's clean finish offers a second pass
  with no failure report. An interruption releases the kept copy at once, including when the
  repository records it, and a later run forgets it.
- `SecondPassHost.test.tsx`: the prompt and the button open the kept run without reading the
  archive, and an older archived completion is not offered instead. A new run removes the
  button, and a kept run that never settled cleanly is not offered.
- `execution-artifact-unarchived.test.ts`: a program over 64 MiB is refused for the archive
  and built for the page, with valid integrity bindings.
- Not verified on the Falcon or with a real 250,000-line job in Chrome.

### Alternatives rejected

- **Raising the archive budget.** The execution history holds 100 MiB across up to 20 runs,
  and one of these jobs would exceed that alone. The budget also bounds structured-clone and
  IndexedDB costs that do not apply to a copy kept in the page.
- **Building the artifact at Start.** This would put a whole-job walk back between Start and
  the first acknowledgements (ADR-345, ADR-352).
