## ADR-228 Amendment 1 - Camera placement with a relative Start from is said in Job Review (2026-10-25)

**Status:** Accepted. | **Date:** 2026-10-25

### Context

ADR-228 deleted the camera Start gates: the Absolute Coordinates requirement and the home or
position proof. The watched Frame trace became the placement proof. The camera Start test recorded
that they were "not even demoted to warnings". The snapshot kept `cameraPlacementActive` "for
warning context", but nothing read it.

The camera picture shows absolute bed positions. Artwork placed on it with Start from set to User
Origin, Verified Origin or Current Position burns where that origin puts it, not where it sits on
the picture. Only the Frame shows this, and only to an operator who is watching where the head goes.
LightBurn expects Absolute Coordinates for camera placement for the same reason. AGENTS.md keeps
policy findings in Job Review as warnings.

### Decision

While camera placement is active and Start from is not Absolute Coordinates, Job Review says:
"Camera placement is on, but Start from is <mode>. … this job burns where <mode> puts it, not where
the artwork sits on the camera picture. Choose Absolute Coordinates to burn it where it is placed,
and watch the Frame." (`cameraPlacementStartFromWarning`).

It is a warning only. Frame and Start are unchanged, and nothing is refused (ADR-228, ADR-565).

### Consequences

- An operator who places artwork on the camera picture learns before Start why it may not burn
  there.
- Code and test evidence only (`start-job-camera-placement.test.ts`).
