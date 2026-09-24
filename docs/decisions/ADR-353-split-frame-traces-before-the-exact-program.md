## ADR-353 - The Frame traces the compiled outline before the exact program exists (2026-09-22)

**Status:** Accepted. | **Date:** 2026-09-22

Follows ADR-345 (dense-job preparation cost) and the same 2026-09-22 Falcon A1
Pro report. The Frame-only Start policy of ADR-228/230/232/237 and the exact
permit model are unchanged: a permit still names exact bytes, and Frame is
still the only Start guard. Hardware qualification remains separate.

### Context

Pressing Frame on the reported owl fill (200 mm, 0.1 mm spacing, 364k lines)
waits for the whole Start preparation before the head moves. ADR-345 cut that
preparation from 35 s to about 14 s, but the remainder is structural: the
program has to be emitted, scanned by preflight, timed, and packed before the
exact candidate exists, and the exact candidate is what the Frame carried.

The Frame itself needs only two rectangles — the burn bounds and the emitted
motion envelope — and both are known the moment the job is compiled and
placed, about 0.7 s in. They are computed by `computeFrameJobBounds` and
`computeFrameJobMotionBounds` on the compiled job; `PreparedJobMetrics`
computes the same two rectangles, by the same functions, on the same compiled
job, later in the same preparation. The rectangle the Frame would trace after
14 s is therefore fully determined after 0.7 s.

The maintainer's suggestion was to frame "the outline, not the whole picture".
An artwork outline is the wrong rectangle — a laser Frame must trace the
emitted motion envelope with its runways and scan offsets, or it proves the
wrong thing (ADR-323) — but the observation behind it is right: the Frame does
not need the program, only the program's rectangles.

### Decision

Split the Frame in time, not in what it proves.

1. **The preparation reports the outline as soon as it exists.** Between
   compiling the job and emitting the program, `prepareStartJobAsync` and
   `prepareStartJobSnapshot` call an `onFrameBounds` hook with a
   `FrameBoundsPreview`: the two rectangles and the retention key the finished
   program will carry. The worker posts it as a `frameBounds` message on the
   same request id; the client delivers it only to that request's caller.
   Main-thread preparations finish in one turn and never report early.

2. **The Frame traces the preview with a deferred candidate.** `runFrameNow`
   starts the exact preparation and races its first outline against its
   program. Given an outline, it dispatches `traceFrame` with a
   `FrameTraceCandidate` — every `FramedRunCandidate` field except the program
   and review evidence, marked `exactProgram: 'deferred'` — after the same
   currency checks an exact Frame makes (execution signature, controller
   evidence, coordinate inputs, reported work position). The store runs the
   same physical Frame and the same completion boundary; a clean final Idle
   records a `FrameTrace` in `frameTrace` instead of minting a permit. A trace
   is not an authorization: nothing reads it except the Frame flow.

3. **The permit is minted only from the exact program.** When the program
   arrives, `frameBoundsPreviewMatches` requires its own metrics to reproduce
   the traced rectangles to the emit precision the Frame verified and its
   retention key to equal the traced signature. The trace must still be the
   store's trace, the machine must be settled, and `framedRunReadinessIssue`
   must be null against it. Only then does `mintDeferredFramedRunPermit`
   assemble the permit from the trace's completion evidence and the program —
   indistinguishable from a permit minted at an ordinary Frame's clean Idle.
   A refused program, a mismatch, or any drift discards the trace and issues
   nothing; a cancelled trace aborts the preparation so the next Frame owns
   the worker.

4. **A trace expires exactly as a permit does.** The permit-expiry
   subscription voids `frameTrace` on any transient activity or drift, and
   every site that voids frame proofs because the machine or setup changed
   voids `frameTrace` beside `framedRun` (`frameProofReset`). A permit and a
   trace never exist together: dispatching any Frame clears both, and the
   only two mint sites clear the trace in the same update. So a clear scoped
   to one specific permit (Start consuming it, a second-pass revoke) has no
   trace to void, and must not reach into another Frame still in flight.

5. **No early outline means the old Frame.** Without a preview — a small job
   prepared on the main thread, an untraceable preview, an early refusal — the
   flow waits for the program and dispatches the exact candidate as before.

The owned-Frame store gains a `stage` (`preparing`, `tracing`, `finishing`) so
the controls say what is happening: the outline is being framed while the
exact job is still being prepared, then the trace is complete and Start waits
for the exact job.

### Evidence and limits

`frame-bounds-preview.test.ts` pins the invariant through the real
preparation, live and snapshot: the outline reported before the program
equals the finished program's metrics and passes `frameBoundsPreviewMatches`.
`use-frame-action.split-frame.test.ts` covers the mint from a matching
program, refusal when the machine moves between trace and program, when the
program is refused, when its envelope differs, abort on a cancelled trace, and
the fallback to the exact Frame. `laser-store-frame-trace.test.ts` drives the
real store through a fake controller: the trace is recorded only at the final
clean Idle, never as a permit, and a settlement error records nothing.

What the operator gains is the wait before motion: the head moves once the
job is compiled and placed rather than once the program is packed. The wait
before Start is unchanged — the permit still cannot exist before the exact
program does — and the Frame flow now spans that wait, with the outline
traced first. A program that fails preflight after the trace has moved the
head around a laser-off rectangle it would have been refused before; the
rectangle is the same one the exact Frame would have traced had the program
passed, and the refusal is reported with no permit issued. No machine was
operated for this decision.
