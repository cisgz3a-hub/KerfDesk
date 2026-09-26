## ADR-372 Amendment 1 - Run same job again needs a fresh Frame, like Start (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

### Context

ADR-372 made Start wait for a clean Frame of the exact job and stream that Frame's one-run permit.
Start never runs a Frame itself. The decision left **Run same job again from start** out of scope,
and that button still used the older receipt flow:

- It compiled the job again, compared the fingerprint with the completed run's receipt, and
  accepted the retained `FrameVerification` of the first run as its Frame. After a completed job
  that proof usually still held, so the replay streamed with no new Frame while Start sat greyed
  out. A Current Position job replayed at the first run's frozen origin, wherever the head now was.
- When that proof had expired, the replay refused with the Frame message, and the blocked-Start
  dispatcher offered to trace the job itself ("OK: trace the job outline now"). Start stopped
  making that offer in ADR-372.

The 2026-09-25 audit of PRs #845-#904 asked for an explicit rule (DOC-1). Maintainer decision,
2026-09-26: Run again needs a fresh Frame, like Start.

### Decision

1. **Run again follows Start exactly.** It streams the current Frame permit through the same path
   as Start: the permit's single Job Review, its claim, and the final Start boundary that consumes
   it. The completed job's own permit was spent at its Start, so the button stays greyed out until a
   clean Frame of this exact job issues a new one. Its title says so. It never runs a Frame and
   offers none.
2. **The permit must be the completed job.** The button shows only while the current job matches
   the receipt, and a ready permit matches the current job. At the click, a permit whose execution
   signature is not the receipt's stops the replay with a warning, which catches either one
   changing in between.
3. **The receipt remains provenance.** The replay passes the receipt to the start path, so the run
   still records `completedReplaySourceRunId`. It is still refused if a newer run replaced the
   receipt.
4. **The receipt flow and its Frame offer are removed.** `runStartJobFlowWithReceipt`, the
   blocked-Start dispatcher `start-blocked-fix-offers.ts` with its Frame-run offer, and
   `completed-replay-invalidation.ts` had no other callers. Frame job still reaches the alarm and
   origin offers through `frame-blocker-repair` (ADR-367). The alarm offer's tests moved beside
   their module.

### Consequences

- A repeat costs one Frame. In exchange it runs exactly where its Frame traced it. A Current
  Position job framed at a new head position runs there, not at the first run's origin.
- Start and Run again are one contract. The only difference is the replay provenance and the
  button's matching rule.

### Evidence

- `start-job-current-position-repeat.test.ts`: with the permit spent and no new Frame, Run again
  sends nothing and the receipt stays. After a fresh Frame at the moved head, it streams that
  permit's exact bytes, the run's origin is the new head position, and the run records the
  completed run it repeats. With the original replay flow restored, this test fails.
- `RunAgainControl.test.tsx`: without a ready permit the button is disabled, says to Frame first,
  and does nothing when clicked.
- The simulator stress test and the pre-archive completion tests run the real Start boundary,
  which consumes the first permit, so they now Frame again before Run again. The start-flow replay
  test mocks `startJob`, so it spends the permit itself before framing again
  (`renewFramedRunPermit`).
