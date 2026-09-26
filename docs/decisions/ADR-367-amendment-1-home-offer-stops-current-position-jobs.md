## ADR-367 Amendment 1 - After an in-place Home, a job placed at the head stops for the head to be placed (2026-09-25)

**Status:** Accepted. | **Date:** 2026-09-25

### Context

ADR-367 has Frame job offer Home in place when the controller is in Alarm and the profile has
homing, then continue the same Frame once the cycle finishes. It weighed the User Origin case
("after Home the head sits at the switches"), but not Current Position.

A Current Position job is anchored wherever the head is when it is framed. Suppose the operator
places the head over the work with the power off, then powers on, and GRBL boots in Alarm with
`$22=1`. When the operator accepts Home, the cycle parks the head at the switches. The Frame then
traced the job at the homing corner, and a clean trace there enabled Start for that corner. The
physical Frame shows the wrong place before Start, but nothing said the job had moved. If the job
overran the travel from the corner, the continued Frame ran into the limits. The 2026-09-25 audit
of PRs #845-#904 found this (FRM-1).

### Decision

1. When the job is placed at the head's current position, the Home offer says that homing moves
   the head and that framing stops after the cycle.
2. After the cycle, the offer ends the Frame with the next step: jog the head to where the job
   should start, then Frame again. This is the same hand-back the Unlock path uses. No trace runs
   and no permit is earned.
3. Absolute, User Origin and verified-origin jobs keep ADR-367's behaviour and continue after
   Home. After the post-repair position report, the Frame also waits for the work offset, as the
   non-alarm path already did, so an origin set before Home is not refused just because its offset
   has not been reported yet.
4. No refusal is added. The Frame-first Start policy (PROJECT.md non-negotiable 21) is unchanged.

### Consequences

- An operator who powers on in Alarm with a Current Position job homes once, re-places the head
  and frames. The job can no longer land at the homing corner.
- Verified against the scripted GRBL controller, not on hardware.
