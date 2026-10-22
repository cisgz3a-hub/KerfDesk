## ADR-449 Amendment 1 - Capture stops keep the pull-off clear of the homing switch (2026-10-22)

**Status:** Accepted. | **Date:** 2026-10-22

### Context

Decision 4 makes each capture move "the same beam-off jog as **Move laser here**". Move laser here
clamps its target to the manual-motion limits (ADR-375 decision 3). With hard limits on (or `$21`
unread), stock GRBL then stops `$27` short of the homing switch on each axis's homing side. Homing
rests the head the pull-off inside the switch, and driving back onto it can reset the controller
into `ALARM:1` with the position lost
([limits.c L366-L384](https://github.com/gnea/grbl/blob/bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e/grbl/limits.c#L366-L384)).
The head capture sent its stops straight to the native bed position instead, and the plan
clamped them only to the bed.

Rolling audit v2, finding 12-P2-3, reproduced it on the real capture path. A camera beside the
module needs stops on the bed edges, and on a front-left 400 × 300 stock GRBL bed (`$23=0`,
`$27=2`) 13 of 48 stops fell outside the ADR-375 box, six of them aimed exactly at a switch point.
On firmware that refuses such a jog, the head never arrived, and after at least 15 s the panel
said "The head did not come to rest in time."

### Decision

1. **The same target as Move laser here.** Each capture jog goes to
   `positionLaserNativeTarget`, the function Move laser here uses: inside the bed, through the
   origin transform, and clamped to `resolveManualMotionLimits`.
2. **Planned inside what the head can reach.** `planHeadCaptures` takes the reach, the bed less
   the strip the limits keep the head out of (`positionLaserReach`), in place of the bed. Where
   that keeps the camera from seeing an edge of the area, the panel says so, as it already does
   for the bed edge.
3. **Settled where the jog goes.** A stop waits for the head at that clamped target. **Capture
   here** still settles where the head already is.
4. No new refusal: the limits only shorten a move KerfDesk already sends (ADR-375).

### Consequences

- With hard limits on, a stitched picture can stop up to `$27` (plus ADR-375's margin) short of the
  homing-side bed edges, and the panel says it stops short.
- Code and test evidence only (`head-capture-store.test.ts`): a corner capture on stock GRBL with
  `$21=1`, `$27=2` sends every jog inside the limits, goes exactly as far as Move laser here, and
  finishes. No machine was operated, and grblHAL's refusal path was not run.
