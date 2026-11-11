## ADR-695 Amendment 3 - The rotary turn-back waits at the axis's own rate (2026-11-11)

**Status:** Accepted; simulator evidence. No hardware. | **Date:** 2026-11-11

Follows rolling audit v14 finding Z4-P3-1, re-rated to P2 by the refuter
(`docs/audits/2026-11-10-rolling-v14/Z4-round-glass-journey.md`). Amends Amendment 2 Decision 3.

### Context

Amendment 2 timed the turn-back's wait at the jog feed (1500 per minute, held to Max feed). The
planner turns the axis no faster than its own max rate, `$113` on A or `$112` on Z, though.
Job Review's own advice for a slow axis is to keep `$113` low and slow the layer instead. At
`$113=500` a correct turn-back of more than about 85° was reported as failed: 180° takes 21.6 s
against a 15.8 s wait. At 300 °/min even 45° failed, and the Frame offer then refused.

### Decision

The wait is timed at the slower of the jog feed and the axis's reported max rate. It is the turn
divided by that speed, × 1.5, plus 5 s, so it also covers the acceleration ramp. Without a reported
rate it stays at the jog feed.

### Consequences

- A turn-back on a slow rotary axis finishes and is reported as done.
- A controller that never reported `$112`/`$113` keeps Amendment 2's timing.
