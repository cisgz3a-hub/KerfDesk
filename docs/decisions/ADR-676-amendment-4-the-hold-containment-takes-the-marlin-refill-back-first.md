## ADR-676 Amendment 4 - The 90 s acknowledgement-hold containment takes a worker-held Marlin refill back before it freezes the stream (2026-11-10)

**Status:** Accepted on 2026-11-10 |
**Amends:** ADR-676 Decision 2 (one side writes refills; the handback comes before a status change),
extending Amendment 1 decision 2 (Abort and Disconnect post the release and their stop lines at once,
and freeze after the reply) to the third Marlin no-reset stop. Closes rolling audit v8 **N1-P3-1**,
listed as a follow-up in Amendments 1 and 2.

### Context

Rolling audit v8 (`docs/audits/2026-10-29-rolling-v8/N1-fix-window-stall.md`) found **N1-P3-1 (P3,
latent; refuter PLAUSIBLE)**:

- When no acknowledgement has arrived for 90 s, the status poll calls
  `containStalledStreamAcknowledgements` (`laser-stream-heartbeat-containment.ts`).
- Marlin has no reset byte, so the containment marked the stream errored at once, then wrote
  `noResetStopLines`. It never took the worker-held refill back.
- If an `ok` reached the worker in that instant, the worker wrote one more job line, which this
  side's frozen ledger lacked. That line's reply then settled the `M107` reservation, so the
  untracked ledger reached zero one reply early (the audit F1 class).
- Abort and Disconnect already release first (Amendment 1, `runNoResetStop` in `laser-job-stop.ts`,
  `stopWithHostedRefillHandback` in `laser-disconnect-stop.ts`).

### Decision

1. **When the worker holds the refill, the containment hands it back before the freeze**
   (`containAfterHostedRefillHandback`), in Amendment 1's order:
   - the stop lines are decided from the state the watchdog saw, so a queued `M7`/`M8` still earns
     its `M9`;
   - the release is posted, then every stop line at once, before the first await;
   - only the freeze waits for the worker's reply. Until then an `ok` steps this side's stream
     exactly as the worker's refill did, so the line the worker sent is on this ledger too.
   - The freeze then marks the stream errored, publishes the stall incident and notice, and applies
     the quick-stop patch once every stop line was accepted, as before.
2. **The freeze runs only for the stream the watchdog saw.** After the reply it checks that the
   connection is the same and that the stream is still streaming at the same `streamerEpoch`. A
   Disconnect, an Abort or a job that ended meanwhile keeps its own state.
3. **One containment per connection while the handback is pending.** The stream still reads
   `streaming` until the reply, so the next poll tick's hold watchdog would ask again. A pending set,
   keyed by connection, makes those calls return at once. It is keyed by connection, not by the
   store refs, so a worker that never answers cannot block the containment of a later connection.
4. **A failed handshake still freezes.** The worker's state is then unknown, and freezing this side
   is the safe step.
5. **Unchanged:** the containment on a controller with a reset byte (GRBL family; the worker treats
   the reset as its own release), and the Marlin containment with no worker refill, which still
   freezes before anything yields.

### Consequences

- All three Marlin no-reset stops (Abort, Disconnect and the hold containment) now share one order:
  release, stop lines, then the freeze after the reply.
- For the time one worker message takes to cross, the stalled job reads `streaming` and the stall
  notice is not yet shown. The stop lines are already on the wire.
- The stall incident is captured at the freeze, after the reply, so its run facts include any reply
  that arrived during the handback.
- **G-code is unchanged.** The stop lines are the same `noResetStopLines`, in the same order.

### Verification

- `laser-ack-stall-hosted-handback.test.ts`, with a mocked `HostedStreamRefill`:
  - **Fails on `origin/main` `ccdca62a1`** (no release was requested). With the fix, the release and
    the four stop lines go out while the stream still streams; an `ok` during the handback steps the
    stream; after the reply the stream is errored, the worker's line's reply completes the job's
    ledger, and the four stop-line replies settle the untracked ledger to zero exactly.
  - Mutation check: freezing before the reply makes it fail again.
  - Repeated containment calls during the handback post one release and one set of stop lines;
    a call after the freeze writes nothing.
- Unchanged and passing: `laser-ack-stall-incident-integration.test.ts` (including the Marlin queued
  shutdown sequence without a worker), `laser-job-stop-write-race.test.ts`, the hosted-refill suites
  and the stream-heartbeat suites.
- **Not verified:** hardware, and the race itself in a browser (it needs an `ok` within a
  sub-millisecond window after 90 s of silence).
