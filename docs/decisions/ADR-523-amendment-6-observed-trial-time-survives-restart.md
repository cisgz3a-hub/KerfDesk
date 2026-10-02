## ADR-523 Amendment 6 - Observed trial time survives restart (2026-10-03)

**Status:** Implemented in source; installed protection requires a desktop release | **Date:** 2026-10-03 | **Amends:** ADR-523 Amendment 2 item 7 and ADR-540 Amendment 2

### Context

Fresh audit scenarios found that the five-minute wall-clock tolerance could
restore Pro after the original trial expiry was already recorded. A new process
anchored elapsed time to its current wall clock rather than the saved trial mark.
Progress observed during sessions shorter than a minute was not saved. These
behaviours could repeatedly restore time already consumed by the same trial.

The finding was reproduced with the shipped 1.0.8 modules and real Windows
safeStorage in isolated processes. No customer profile, provider grant or machine
was used. The existing clock tolerance remains useful for ordinary corrections,
and paid rights must keep working offline.

### Decision

1. A verified trial expires when either current time or its persisted high-water
   mark reaches the original signed deadline. The five-minute rollback tolerance
   does not restore spent trial time.
2. Each new trial session anchors its monotonic elapsed clock at the greater of
   current wall time and the saved mark. The existing raw wall-clock rollback
   check still reports clock-error for corrections outside its tolerance.
3. Every returned verified trial status saves each observed forward whole second for a
   trial. Unchanged or backward marks are not rewritten. This replaces the
   previous one-minute write threshold, including at the final second of expiry.
   Saved credentials, signed deadlines and paid keys retain their existing schema.
   Non-definitive request failures and refused fresh-grant clock checks also save
   their evaluated cached-trial time; an offline response cannot discard an expiry
   observed while that request was pending.
   The shared serial status boundary applies the same checkpoint to checkout,
   payment checks, order clearing and licence-store reset responses.
4. An observed-expired trial takes signed Free updates, including when the wall
   clock was corrected slightly backwards. Paid/developer update coverage and
   signature checks remain unchanged.
5. Only a newly authenticated service grant may re-anchor a legitimately
   corrected clock. Cached rereads cannot restore previously recorded time.
6. This remains the existing Pro tool-entry authority. It does not gate Frame,
   Start, machine control, output or existing Pro operations, or interrupt a job.
7. Trial status includes an optional main-process remaining-time budget. The
   renderer uses that bound with monotonic elapsed time, so its new Pro choices
   cannot restore time hidden by a small wall-clock correction. The original
   signed `accessExpiresAt` stays unchanged; older statuses without the budget
   remain compatible. Transport delay cannot renew the budget.

### Consequences and qualification

Trial status checks can write more often than before, but never more than once
for the same observed whole-second mark. Writes keep the existing serial queue,
durable temporary-file flush and secure-storage handling. Paid/developer reads
still do not write clock marks.

Local time is a deterrent, not hardware attestation. Unobserved time between
checks, replacement of client code, restored local state and a changed Windows
identity remain outside an absolute same-physical-computer guarantee. The server
continues to own the original device-bound 30-day trial. No new online, account or
machine gate is introduced.

Nineteen new native-source regressions fail on released source and pass with the repair: recorded
expiry across small corrections and fresh sessions, short-session observed
progress, the final second before restart, signed Free update eligibility and
time observed during failed requests and expiry returned by order/reset actions.
Renderer contract regressions cover the
native remaining-time budget and cached rereads. The focused cohort also covers
fresh-grant recovery, paid offline rights and existing update checks. A real
paid/trial customer installer upgrade and physical Windows shutdown remain
separate qualification.
