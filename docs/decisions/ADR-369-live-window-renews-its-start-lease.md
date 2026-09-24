## ADR-369 - A live window renews its Start lease until the handoff closes (2026-09-24)

**Status:** Accepted. | **Date:** 2026-09-24

Amends the owner lease ADR-337 relies on (`PENDING_START_OWNER_LEASE_MS`,
`src/ui/state/recovery/recovery-start-handoff.ts`) and `WORKFLOW.md` "Edge — recovery job is
itself interrupted" item 2. It adds no Start gate: Frame remains the sole ordinary Start policy
gate (PROJECT.md non-negotiable 21, ADRs 228/230/232/237), and recovery storage is still not a
Start gate (ADR-337 item 5).

### Context

A pending Start is reconciled by a window that did not arm it: at initialization, or when its
owner lease runs out, a window reconciles `pendingStart` into an interruption capsule that says
motion may or may not have begun. The lease is five seconds, measured from `armedAtIso`, and was
never renewed. That was sized for what sat inside it before ADR-337: the controller Start
boundary and the first program write. The archive was staged before arming.

ADR-337 arms the durable handoff from a small start intent and builds the execution archive
**after** the controller accepts the program. It stays inside the same lease: provenance hashing
of the whole program, the integrity re-hash, the size estimate over every motion vertex, and the
IndexedDB write. ADR-337 measured about 0.6 s at 250k motion points in plain node, and the
archive budget allows 64 MiB. A big job can therefore outlast the lease while its owner is alive
and streaming. A second KerfDesk window that initializes during that time schedules
reconciliation for the lease's end and then reconciles the live Start.

Two regression tests reproduce it on main at `4fc476842` and again at `7fbbfdfb8`. Two
repositories share one in-memory backend and generation store, on fake timers. The first arms an
intent, the second initializes, the lease runs out, and the first then stages and activates. A
probe of the same sequence recorded what the owner gets:

- **Archive not yet stored when the lease runs out.** The second window writes the intent's
  fingerprint-only stand-in under the live run ID and an `unknown` capsule at 0 acknowledged
  lines. The owner's stage then finds that stand-in and returns `conflict`, so
  `activateAcceptedFreshRun` calls `noteUntrackedRunAccepted`. The operator is told the running
  job has no forensic record, and it has no archive and no tracking.
- **Archive stored, not yet activated.** The second window records an `exact-execution`
  capsule and an interrupted history record at 0 lines. The owner's activation meets a capsule
  for its own run and returns `ok(true)` without an active run. After that, every progress write
  and the completion return `ok(false)`. A job that completes stays saved as "Interrupted job",
  0 lines, "The application restarted while Start was being accepted". No completion receipt is
  written, so the second-pass offer, which waits for one, cannot appear.

### Decision

1. **The window that arms an intent renews its lease until the handoff closes.**
   `armFreshStartIntent` starts renewing `pendingStart.leaseRenewedAtIso` every second. It stops
   when the handoff closes (activation, cancel, an untracked Start, a purge) or when a renewal
   finds the record is no longer its own. A renewal is bound to the run ID and arm time, so it
   never revives a reconciled or cancelled handoff or touches a newer Start. A renewal is one
   slot write committed alone, like a progress write: no local reload, and no BroadcastChannel
   announcement that would make every other window reload. A failed renewal is retried on the
   next beat. It never delays, refuses or cancels Start.
2. **A reconciling window waits for a lease that stays unchanged.** At initialization the
   remaining lease is measured from the latest renewal, or from arming when there is none. When
   that wait ends, the window compares the record with what it observed. The same run, arm time
   and last renewal means the owner stopped renewing, and the Start is reconciled. A renewal,
   or a newer Start in the record's place, is watched again for one full lease measured on the
   watching window's own clock. The reconciling slot transition is bound to the renewal it
   observed, as it already was to the run and arm time. A renewal that lands during
   reconciliation's storage reads therefore leaves the Start pending.
3. **Crash reconciliation is unchanged.** A window that dies stops renewing. Once its last
   renewal is more than one lease old and another window has watched the record stay unchanged,
   the Start reconciles exactly as ADR-337 item 3 describes (the fingerprint-only stand-in, an
   `unknown` capsule at 0 lines), or as ADR-341 Amendment 3 item 7 describes when its archive was
   already stored (the verified archive backs the capsule and the run joins the history).
   A window already watching reconciles within at most two leases of the last renewal. A window
   opened after the owner died reconciles once one lease has passed since that renewal, or at
   once if it already has.
4. **Only intent-armed Starts renew.** They are the ones whose lease holds the post-acceptance
   archive. Supervised recovery still stages and verifies its archive before arming
   (`armClaimedRecoveryStart`), so its lease still covers only the Start boundary, the first
   write and activation, as before ADR-337.
5. **An unreadable renewal stamp is dropped, not fatal.** The stamp is a liveness hint, not
   operator-facing data, so the parser drops a non-string value and the lease is measured from
   arming, which was the behaviour before this decision. This differs from ADR-337 item 4, which
   fails a malformed intent closed because it would misreport the program. A rejected
   `pendingStart` would reject the whole slot record, capsule and history included.
6. **Tests model a crashed window explicitly.** A dead window cannot renew. In-process tests
   keep the old repository object alive, so they call `RecoveryRepository.abandonStartLease()`,
   which stops that repository's renewals and lease watching for good. The recovery stress
   harness's `stopTracking` does so.

### Consequences

- A second window no longer turns a live Start into a false "Interrupted job" card, destroys
  its archive, or leaves a finished job recorded as interrupted at line 0.
- Handoffs shorter than a second write nothing extra. A longer one writes one slot record of a
  few hundred bytes per second. No other window reloads because of a renewal; a watching window
  reads the record when its own watch ends. Nothing proportional to the job's geometry is added
  to the Start path.
- The `pendingStart` record and its strict parser moved to
  `src/ui/state/recovery/pending-start-record.ts`, because `recovery-model.ts` had reached its
  400-line budget. `recovery-model.ts` re-exports the type, so no importer changed.
- **Limits.** The window must still run its event loop to renew. If a live owner is blocked for
  more than about four seconds by a synchronous step, its lease can still lapse and meet the
  outcomes above, now only in that case. A forward step of the system clock by more than a lease
  can still make a window that initializes just then reconcile at once, as it could with
  `armedAtIso` before. A build predating this decision ignores the stamp and keeps the old
  five-second lease. If a window running it rewrites the slots, the stamp is dropped, and the
  owner's next renewal restores it, because renewals are bound only to the run and arm time.

### Verification and limits

`src/ui/state/recovery/recovery-start-handoff.test.ts` covers the following:

- A live owner that is still building its archive, and one that has stored it but not
  activated, both keep the handoff past twelve seconds of a second window's watch. The first
  then stages and activates; the second activates, records progress and completes normally.
- Renewals are not announced to other windows.
- An owner abandoned mid-archive is reconciled.
- An owner that died inside the lease still reconciles to the stand-in, or to the stored archive
  and a history record.
- A newer Start that replaces the watched one gets a lease of its own.

The two live-owner tests, the abandoned-owner test and the newer-Start test fail against main's
product code; the dead-owner tests pass on both. `recovery-start-intent-handoff.test.ts` covers
the renewal mutation (only the owner's own run and arm time, never a cancelled handoff), a
reconciliation refused after a renewal it did not observe, and the parser round trip and drop.
The repositories run in one process over the in-memory backend. No browser window was killed or
duplicated, and no renewal was timed against a 64 MiB IndexedDB commit in a browser. There is no
hardware evidence of any kind; no machine is available to this project.

### Alternatives rejected

- **Renew once when the controller accepts, or again before staging.** This bounds each phase
  to five seconds, not the archive. A slow IndexedDB commit of a large archive is a single phase,
  and the main thread is free while it waits, so a timer keeps the lease where fixed points
  cannot.
- **Record acceptance in `pendingStart` and give accepted Starts a longer lease.** Any fixed
  length guesses at the archive's cost on an unknown machine. A long lease also delays
  reconciliation after a real crash and keeps the next Start refused for as long.
- **A liveness ping over the recovery window link.** It writes nothing, but it needs a new
  request/response protocol with timeouts on a channel that is optional in browsers and
  disabled under test. The renewal is visible to every window in the store they already read.
- **Let the owner take back a run another window reconciled.** That breaks the rule that a
  late activation never turns an interrupted run back into a live one, and the second window
  still shows a false card in the meantime.
