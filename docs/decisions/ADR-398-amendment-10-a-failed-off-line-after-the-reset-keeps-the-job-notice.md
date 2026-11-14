## ADR-398 Amendment 10 - A failed off line after KerfDesk's reset keeps the job's notice (2026-11-14)

**Status:** Accepted. | **Date:** 2026-11-14
**Fixes:** CNC audit v3 N5-P3-3 (P3), `docs/audits/2026-11-13-cnc-v3/N5-cnc-machine-run.md`.
Amends Amendment 5 (every reset steps back, and a failed job write is contained with a reset).

### Context

When a job line fails to write on a port that stays open, the containment sends the soft reset
and then a disconnect, whose cleanup writes `M5` and `M9` once the controller's banner shows the
reset happened. If those writes fail too:

- each failed cleanup line was written as action `stop`, so the safety notice became "The software
  Abort command was not written to the controller…", although the reset had been written and its
  banner had come back;
- the failed disconnect then replaced whatever notice stood with "The disconnect command was not
  written to the controller…".

The facts that matter, that the job's send failed and that the reset stopped the job and the
spindle, were left only in the log.

### Decision

1. **The off lines after a proven reset have their own action.** Cleanup flushed on the reset's
   banner writes as `stop-cleanup`. Its failure says: "The controller reset, which stops the job
   and turns the spindle, laser and coolant off, but the off lines KerfDesk sends after the reset
   were not written. Check that the spindle, laser and coolant are off; use physical E-stop or
   power cutoff now if unsafe." A cleanup flushed by the fallback timer, with no banner, still
   writes as `stop`.
2. **That failure adds to the standing notice.** A failed `stop-cleanup` write appends its sentence
   to the notice already shown (the job's own fault), instead of replacing it. Every other failed
   write replaces the notice, as before. The disconnect-safety set counts `stop-cleanup` as a
   write that leaves the physical stop uncertain.
3. **The failed containment disconnect keeps the standing notice.** It falls back to "The
   disconnect command was not written…" only when no notice stands, as an owned reset's own
   failure already does (`failOwnedResetWrite`).

### Consequences

- After a mid-job write failure whose disconnect fails too, the notice reads "A mid-job send
  failed, so the stream was stopped…" followed by the off-line sentence.
- When the reset byte itself is refused, the notice stays "The software Abort command was not
  written…", which is now no longer replaced by the disconnect's.
- Regression test: `src/ui/state/job-write-failure-notice.simulator.test.tsx` (the real store,
  Frame and Start on the GRBL simulator, with the fake port refusing every later program line),
  which fails on main. `laser-active-job-write-containment.test.ts` now expects the `stop` notice.
