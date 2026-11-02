## ADR-684 Amendment 1 - The held-tail warning retires for good once motion has run, and its advice names what a reset costs (2026-11-02)

**Status:** Accepted; unit-tested through the real store and with a real Frame on the grblHAL
simulator (Falcon A1 Pro `$$`). Not hardware-tested. | **Date:** 2026-11-02

Follows rolling audit v9 finding R8-P2-2 (P2), confirmed by an independent refuter
(`docs/audits/2026-11-02-rolling-v9/R8-cross-fix-journeys.md`).

### Context

- **Decision 3 did not hold.** The warning was meant to retire when the machine moved more than
  0.001 mm from where Resume confirmed. The code recomputed that on every read from the current
  position and never cleared the record. A Frame returns the head to where it started, as every
  clean Frame must, so the warning was still up after the very Frame that ran the tail. A jog away
  and back brought it back too.
- **The advice had a cost it did not name.** Following "Reset the controller" after that Frame
  starts a new controller session, which drops the Frame's Start permit
  ("The controller session changed after Frame"), and the operator frames again.

### Decision

1. **Retirement is a latch.** With every status report the store clears the recorded tail when:
   - a Frame or jog has been sent to the controller (its motion operation is dispatched);
   - a later job has started (the streamer epoch differs from the one Resume recorded);
   - the report puts the machine more than 0.001 mm from the recorded point.

   Once cleared, nothing brings it back. A new controller session still retires it as before.
2. **The advice names the cost.** The warning, in the rail notice and Job Review, now adds: "A
   reset also ends the current Frame, so Frame the job again before Start. Any Frame, jog or job
   clears this warning, because it runs whatever was held." The Reset button's tooltip says the
   same.

Decisions 1, 2 and 4 are unchanged. Nothing is gated.

### Consequences

- After a Frame or a jog, the warning is gone and stays gone, so it no longer asks for a reset
  that would only cost a re-Frame.
- A Frame shorter than one status poll is still seen, because a dispatched motion operation stays
  open until a status report settles it.
- **Tests:** `laser-held-resume-tail.test.ts` (a jog away and back; a dispatched Frame at the same
  point; a later job) and `held-resume-tail-frame.simulator.test.ts` (a real Frame returns to the
  point, the warning stays retired and the permit stands).
