## ADR-337 Amendment 2 - The staged archive is validated once, so activating the run does not repeat it in one task (2026-11-08)

**Status:** Accepted. A pure performance change: the stored archive and the G-code are
byte-identical. | **Date:** 2026-11-08

### Context

Amendment 1 built and stored the accepted run's archive in 8 ms slices, so Abort, Pause and
status reports are not held behind it while the job runs. Rolling audit v10 (area V1, finding
V1-P1-1, found by the refuter) showed that the step right after it was missed.

Once the archive is stored, `activateAcceptedFreshRun` activates the run. The repository commits
the slot change and refreshes its snapshot, handing the staged record to the refresh
(`additionalArtifacts`). The refresh checks every artifact it hydrates with
`isValidatedExecutionArtifact`, an identity memo over `isExecutionArtifact`. The new archive's
identity was not in the memo yet, so the refresh validated it again in full: the fingerprint of
the whole program, the packed manifest's columns and the sendable-line count, drained by
`runWorkSteps` in one task.

`stage` had already run exactly that check on the same object, through the archive's runner
(`artifactMayStage` calls `isCurrentExecutionArtifactSteps`, which yields to
`isExecutionArtifactSteps`), followed by the cryptographic integrity check. The second pass
proved nothing new, and it cost (Node, real modules, the refuter's repro):

| Job | Lines | One task at activation |
| --- | --- | --- |
| Raster | 375k | 53–59 ms |
| 100 mm grayscale photo | 838k | 110–132 ms |
| Raster | 1.0 M | 139–156 ms |

That misses the 50 ms running-job budget Amendment 1 set for every task after the first line.
Amendment 1's guard test stopped at staging, which is why it did not see this pass.

### Decision

1. The identity memo moves to its own module (`validated-execution-artifacts.ts`), shared by the
   snapshot and the artifact store. Its rule is unchanged: an identity is recorded only after
   full validation passed on it, and the memo trusts that hydrated artifacts are immutable, as
   it already did.
2. `RecoveryArtifactStore.stage` records the artifact as validated once it has passed
   `artifactMayStage` (full validation and integrity, through the caller's runner) and been
   stored. The refresh that activates the run receives that same identity and does no
   whole-program work for it.
3. An artifact read back from storage is a new identity, so it is still validated in full,
   together with its stored integrity check. That is the integrity boundary this code exists
   for, and it is unchanged: a window that reopens the run, a recovery and the archive in
   history are all read and checked as before.
4. Nothing else changes. `stage` still runs its checks in the same order with the same runner,
   and the stored record is the same object it stored before.

### What still runs in one task

- IndexedDB's structured clone of the record inside `add` (Amendment 1; audit V1-P3-1). The
  refuter's Node figures put its serializer at about 30 ms for the 100 mm photo and 28–30 ms for
  a 1,400-object mix, but Chrome's `add` on the 200-object mix was 50–73 ms in Amendment 1's
  profile, and object-heavy fill jobs may reach 150–200 ms there. That is an extrapolation;
  the Chrome measure is still owed (see Limits).
- `RecoveryArtifactStore.exact` validates a record in full when the staged copy is not this
  window's (the put found an identical stored record). That path reads storage, so it keeps
  its full check; it is rare on a fresh Start.
- Moving a finished run into history measures its size once (`memoizedExecutionArtifactBytes`,
  5–20 ms at 0.4–1.4 M lines in the refuter's repro). That runs when the run ends, not while it
  runs.

### Evidence

`start-job-archive-slices.test.ts` gains a guard that drives activation, not only the archive
build. It stages the 60,000-move archive through a runner that yields after every step, calls
the real `activateAcceptedFreshRun` against `RecoveryRepository`, and requires that no
synchronous drain during staging or activation crosses a single checkpoint (64 Ki characters
of program, or one manifest batch). Without the store's note, the activation refresh drains 55
checkpoints in one call and the test fails. The same test then opens a second repository over
the same storage and requires that the interrupted run's archive, read back as a new identity,
is validated in full (more checkpoints than the program has 64 Ki chunks).

The guard is an operation count, not a clock, as in Amendment 1: a checkpoint is the budget's
unit of work, well under a millisecond, so a drain that crosses none cannot approach 50 ms
at any program length. The refuter's at-scale repro, run against this change, is in the PR.

Byte identity: the same file's digest test still matches main `ede14589b`'s stored archive
(`58b026e9…`). No emitter, preparation or archive-building file is in the diff.

### Limits

Node timings with the real modules, not a browser profile; the PC had too little free memory
for a Chrome run when this was written. The Chrome measure of V1-P1-1 and of the IndexedDB
`add` (V1-P3-1) on the 375k Fill and a 1,400-object mix is still owed. No hardware.
