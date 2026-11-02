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

### Amendment 2 — Preview's whole-route summary is built beside the route (2026-11-02)

Performance audit S1-P2-1 (raised to P1) measured the UI thread blocked for
0.6–1.6 s when Preview opened during a 375k-line job. Two Aborts pressed inside
the block reached the controller 1,223 and 1,357 ms after the key. The route
itself was already built in the ADR-244 preparation worker. But four UI
consumers then each walked every step of it: the playback timeline, the
distance stats, the CNC pass stepper and the display-decimation notice. Each
read went through `unpackToolpathStep`, which builds a step object and a
polyline array per index.

1. The preparation worker builds a `PreviewRouteSummary` beside the route
   (`withPreviewRouteSummary` in `largeJobPreparationFromPrepared`). It holds
   the distance totals, the pass-start fractions, the display decimation of
   the route Preview draws, and the timeline basis. The basis is three running
   distance sums (cut, rapid travel, laser-off feed travel), one entry per step
   of nonzero length. The summary travels in the route's header on all three
   transports (`ok`, chunked, packed). With a packed route, its three buffers
   are transferred, not cloned. It adds 24 bytes per step: 8.6 MB at 375k.
2. The UI reads `previewRouteSummary(toolpath)`. It uses a carried summary
   only when its step count and total length match the route. Otherwise it
   builds one on this thread and caches it per route object. Only routes
   inside the synchronous Preview budget, and imported programs, take that
   path.
3. The timeline is built from the basis and the live estimate's breakdown,
   with no step loop. Time is linear in each category's distance, so each span
   is the running sums scaled by three rates. Lookups use a binary search,
   which also removes a per-frame linear scan during playback. An imported
   program keeps its explicit per-line spans, dwells included, and the same
   lookups serve both forms.
4. Whole-route walks that remain read step facts (kind, length, travel motion,
   plunge direction, segment count) from the packed columns
   (`visitToolpathStepFacts`), never step objects. This covers the worker's
   summary, the fallback in 2 and `summarizeToolpathDistances`.

Preview shows the same content. Distances, pass starts and decimation are
exactly equal to the walks they replace. Timeline positions agree to floating-
point rounding (1e-6 s and 1e-9 of the scrubber), because spans are sums of
category distances, not a running sum of span durations. A reference test runs
the replaced walks over random plain and packed routes. No compile, emission or
streaming code changed, so the G-code is untouched. A guard test sends a
130k-step route through the real packed transport and hydration. It then builds
the timeline and renders the stats, pass stepper and notices, and asserts zero
reads of the route other than its length. Without the carried summary, the
guard fails.

The Abort path was not reordered. Its key handler runs in the capture phase
and calls `stopJob` synchronously, and the stop path posts its reset before its
first await (ADR-334 §4). The measured delay was the blocked thread, not the
handler. Putting the reset ahead of the session-evidence invalidation it now
follows would let a boot banner overtake the armed cleanup.

Measured in Node 25 on the audit PC, timing the UI-thread work from when the
worker route arrives (median of 5, worst in brackets): at 374,843 lines,
1,205 ms (1,298) before and under 0.1 ms after. At 18,527 lines, 81 ms (92)
before and 0.02 ms after. A playback frame's lookup at 375k went from 5.4 ms to
under 0.01 ms. The worker spends 35 ms more building the summary, off the UI
thread. The fallback in 2 costs 45 ms at 375k on a route that never crossed the
worker. Not measured: the browser re-run of the audit's PV375 set, including
Abort latency inside Preview. This PC lacked the memory for a 375k-line browser
job while other sessions were working. With no block left to wait behind, Abort
inside Preview should match the audit's idle 1–18 ms. That remains an
inference until the harness re-measures it.
