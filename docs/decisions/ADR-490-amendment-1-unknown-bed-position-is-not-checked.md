## ADR-490 Amendment 1 - A job whose bed position is unknown is not checked (2026-10-22)

**Status:** Accepted. | **Date:** 2026-10-22

### Context

Decision 4 checks only "a plan that can be placed on the bed", and otherwise the panel says why
not. `planPlacesOnBed` looked only at whether the plan could be drawn. ADR-642 §3 keeps a job
whose bed position is unknown in an artwork-relative frame with no `bed`, labelled "bed position
unverified": every machine without homing, a machine not homed this connection, and Verified
Origin. For such a job the watch graded the patch of bed under the artwork, not where the laser
burned.

Rolling audit v2, finding 12-P2-4, reproduced it for a no-homing front-left machine in User Origin,
which is the default for no-homing machines. The check photographed the artwork's area. It
reported almost none of the path burned, plus "marks outside the path" wherever the real burn fell
in the picture. Nothing said the bed position was unknown.

### Decision

1. A plan is placed on the bed only when KerfDesk knows where it burns: a machine frame, or an
   artwork-relative frame that keeps its `bed` (ADR-642 §3).
2. Otherwise the burn check is unavailable, and the panel says: "The bed position is unverified
   for this job, so KerfDesk does not know where on the bed it burns and the camera cannot check
   it."
3. The timelapse of such a job records plain camera frames, not flattened pictures of the
   artwork's area.
4. No new gate: the watcher still never refuses or delays a job (decision 5, ADR-228).

### Consequences

- No-homing machines get no burn check. A no-homing machine whose controller-to-bed mapping is
  confirmed some other way still has no `bed` frame, so it gets none either.
- Code and test evidence only (`job-burn-route.test.ts`, which replaces the test that pinned the
  old behaviour). No camera or machine was used.
