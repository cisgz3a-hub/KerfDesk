## ADR-362 Amendment 1 - The controller audit's gap sweep: Marlin laser Start, cancellable preparation, owned Unlock (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

### Context

ADR-362 listed the audit's gap-sweep findings as still open, pending verification. Each was
checked against the code before its fix. One had already been fixed in ADR-361: the silently
clamped layer speed (gap-start-3). The rest are recorded here. As before, no hardware was
available, so the evidence is code traces, store and simulator tests, and upstream firmware
sources.

### Decision

1. **Marlin lasers can Start after their Frame** (gap-start-1). The final Laser Start status
   query required a realtime `?`. Marlin has none, so every Frame-authorized laser Start on
   Marlin was refused after the Frame had already run. A queued-poll controller now gets an owned
   `M400` fence, whose `ok` proves the planner drained, then an owned `M114`. Its fresh
   Idle-shaped report must match the Frame, as a GRBL report must.
2. **Start says why it frames again** (gap-start-2). The invalidation subscription records
   whether the job or the controller drifted when it consumes a permit. The Start that re-frames
   because of that drift says so once.
3. **A Frame preparation can be cancelled** (gap-start-4). A preparation worker that never
   answered kept Frame and Start busy with no way out. The owned preparation's abort is offered as
   Cancel until motion starts. It is not offered during the outline trace, where Abort stops the
   machine.
4. **A reply that never arrives says how to clear it** (gap-start-5). The Frame and Start queue
   fences name disconnect-and-reconnect as the way out. The owed-ack ledger's safety design is
   unchanged: an ack is never expired by time.
5. **Variables advance only after a clean settle** (gap-start-6). One predicate,
   `post-job-clean-settle.ts`, now decides "completed" for both the recovery ledger and
   after-successful-stream variable advancement.
6. **Auto-focus** (gap-start-7, gap-start-8).
   - A cycle that keeps reporting activity extends its budget, as Home does.
   - A completed cycle voids the Z reference.
   - The button's effect stays narrower than a Console `$HZ1`, which is classified
     conservatively. This is documented because the vendor has not documented the cycle.
7. **Manual Air's Proceed discloses the Frame consequence** (gap-start-9). The maintainer's flow
   is unchanged.
8. **A main-thread preparation error is a named refusal** (gap-start-10), as the worker path's
   already was.
9. **Unlock owns its exchange** (gap-start-11).
   - The Alarm banner's and the hand-position guide's Unlock waits for the controller's answer,
     like the Console `$X`: an `error:N` rejects with its reason and keeps the alarm.
   - The guide returns to its Unlock step after a refusal or when no Idle follows within 5 s.

### Consequences

- The gap sweep is closed. The unused runCheckpointResumeFlow remains, covered only by its own
  tests; removing it is housekeeping, not a defect fix.
- Frame and Start gained no guard. Cancel and the new messages only give the operator a way out.
