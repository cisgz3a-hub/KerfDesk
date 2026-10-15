## ADR-598 — Preserve worker memory bounds while prioritising interaction and reusing work

**Status:** Implemented; local source, browser and test evidence is recorded in the linked audit. No release or hardware qualification is implied. **Date:** 2026-10-14.

## Context

The [speed audit](../audits/2026-10-14-speed-audit.md) reproduced expensive whole-project cloning at the output/design worker boundary, interactive Save and trace-part work waiting behind long background jobs, duplicate compilation when ETA started before Preview, sprite eviction on every draw of nine dense objects, and quadratic nesting validation. These are independent costs; increasing the number of simultaneous workers would not remove the copying or rendering work and would violate the existing memory budget.

## Decision

1. Extend ADR-346's exact packed project geometry to output preparation and the CNC design worker. Public callers still supply a complete immutable `Project`. Pack only when dispatching, transfer fresh buffers, and unpack before hydration/preparation in the worker. Queueing does not allocate another packed snapshot. Snapshot evaluation time, controller state, placement, scope and other metadata retain their existing values. Start, Frame and output policies under ADR-565 are unchanged.
2. Retain one active heap in the shared worker memory lane. Interactive project Save and trace-part editing take priority over queued background work. Only an owner explicitly supporting preemption can be interrupted: Preview/ETA and idle-marker clients retire their workers before releasing the reservation, retain still-owned promises, and restart behind interactive work. Non-preemptible work, including an active autosave, finishes normally. This prioritises user actions at the cost of restarting interrupted background computation.
3. Track Preview and ETA ownership separately from shared cache promises. Aborting one consumer does not cancel other consumers of the same project/options. Removing the final consumer retires its worker or cancels its queued request. Existing supersession and stale-result checks still apply. Closing Preview releases its ownership.
4. An active ETA compile may satisfy Preview requested for the same immutable project and exact options. The worker reports the estimate while retaining one prepared intermediate until the main realm chooses whether to upgrade. If Preview is still wanted, build its route from that exact compilation and clear the retained intermediate before transfer. Otherwise retire the worker. Do not retain a pool of compiled projects or build every estimate's full route eagerly.
5. Amend ADR-346's sprite admission policy. Pixels remain the primary memory budget, with a 256-entry metadata backstop. Protect entries used in the current or previous complete artwork pass. When all eligible capacity is in use, overflow objects use the existing direct painter rather than allocating and evicting a full scan. Entries absent for a complete pass become reclaimable. Normal workspace, Preview underlay and Design Studio passes advance residency even when empty. This changes cache admission, not source geometry or output.
6. Index nesting validation bounds and apply the existing exact predicates only to nearby candidates. Inclusive broad-phase contacts retain tolerance-boundary cases, both directed outline checks remain, and non-finite derived boxes stay on the exact fallback path. No packing, clearance or acceptance policy is relaxed.
7. Load the Design Library catalogue on first open. Keep one modal shell through loading, loaded content and chunk failure so cancellation and opener focus remain intact. This reduces initial requested code; the complete PWA offline inventory remains available for precaching. The broad shared core/I/O/workbench dependencies need separate coverage before deeper splitting.

## Verification and limits

The follow-up audit records reproducible before/after fixtures and receipts. Regression checks cover actual client transfer/detachment, exact output equality, worker ownership and priority, ETA/Preview reuse, sprite memory bounds and retention, and nesting decisions compared with an independent brute-force oracle. Browser measurements distinguish dispatch time, receiver reconstruction, end-to-end interaction, and cold startup.

First-time packing, receiver reconstruction, unavoidable compilation, direct painting of overflow artwork and non-preemptible active work still cost time. Synthetic fixtures on one computer do not establish performance on every machine, packaged Electron behaviour, or hardware qualification.

### Amendment 1 — Bound autosave preparation liveness (2026-10-16)

Autosave remains non-preemptible while healthy, preserving decision 2. Its worker
preparation now has a 60-second deadline including time queued for the memory lane.
A silent module worker otherwise holds both that lane and the durable write queue
indefinitely, preventing an explicit discard from reaching its ordered recovery clear.
Expiry terminates an active autosave worker before releasing its reservation, or
removes only its queued reservation. It reports preparation failure through the
existing autosave failure path; it does not substitute an empty snapshot, clear
recovery, retry synchronously, or bypass the document revision check. Previously
committed recovery remains intact unless the user has separately requested a clear.
A later interval may retry. Late worker replies cannot commit the expired result.

Focused tests reproduce silent-worker and queued-wait expiry, retain healthy
non-preemption, and check that preparation failure preserves committed recovery,
permits an explicitly queued clear, and allows later valid writes. This bounds
worker preparation, not an unresponsive IndexedDB transaction or session lock.
