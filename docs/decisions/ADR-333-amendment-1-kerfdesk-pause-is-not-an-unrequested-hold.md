## ADR-333 Amendment 1 - KerfDesk's own Pause is not logged as an unrequested hold (2026-11-14)

**Status:** Accepted. | **Date:** 2026-11-14
**Fixes:** CNC audit v3 N5-P3-2 (P3), `docs/audits/2026-11-13-cnc-v3/N5-cnc-machine-run.md`.
Amends ADR-333 decision 5.

### Context

Decision 5 records one log line when the controller enters Hold or Door during a job "without the
app having asked for it". The code (`controllerHoldLogPatch` in `laser-status-line.ts`) checked
only that a job was active, and an active job includes a paused one. So every operator Pause,
including CNC Pause and lift (ADR-411), logged "Controller entered Door during the job. Motion is
stopped until the machine's own cycle start releases it; KerfDesk did not request this pause."
KerfDesk had sent the hold byte, and its Resume releases the hold.

### Decision

The line is not written while KerfDesk owns the hold: the stream is paused, a Pause or Resume
transition is in flight (`pauseResumeTransition`), or a CNC Pause and lift is running
(`cncPauseLift`). A hold the controller enters by itself while the stream is running is logged as
before.

### Consequences

- The log no longer contradicts the operator's own Pause.
- Regression test: `laser-status-line.test.ts` ("stays silent when the hold is KerfDesk's own
  Pause"), which fails on main.
