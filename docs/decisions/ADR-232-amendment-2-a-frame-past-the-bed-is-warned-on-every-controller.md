## ADR-232 Amendment 2 - A Frame past the configured bed is warned on every controller (2026-11-03)

**Status:** Accepted (new-user experience audit U1, area U4, finding U4-P2-4, confirmed by an
independent refuter; the maintainer's standing instruction to fix confirmed audit findings). |
**Date:** 2026-11-03

### Context

Amendment 1 compared the Frame's own route with no-go zones. ADR-637 Amendment 5 added a Frame-time
warning when the route leaves grblHAL's homed area. A jog past the bed is warned
(`laser-jog-warnings.ts`). A stock GRBL, FluidNC or Marlin Frame past the bed edge got none: on a
never-homed 400 × 400 mm GRBL bed the audit's Frame drove the head to X 470, Y 410 and said "Frame
complete", and Job Review listed nothing about the bed. With `$20=0` (soft limits off, the default
on these kits) the head runs into the end of the rail.

### Decision

1. **The Frame route is compared with the configured bed.** `frameBedEdgeWarning` puts the
   approach, outline and return in native machine coordinates and maps them to the bed in the
   jog's convention (`nativePointsOnBed`): through a verified native-to-bed frame, or, on a machine
   that was never homed, with machine zero where the head was when the controller started. A homed
   machine without a verified frame is not compared, as its jogs are not. The bounds are
   `configuredMotionBounds` for the framed job's machine kind (rotary Y included).
2. **It is a warning.** Like a no-go crossing it is a toast as the Frame is sent unchanged, and the
   project Frame's candidate carries it into Start's Job Review (Amendment 1 item 2). Where grblHAL's
   homed-area warning applies, it is shown instead, since it already names the bed.
3. **A never-homed check says what it assumes.** The warning adds: "This machine has not been
   homed, so the bed check assumes the head was at the bed's corner (machine zero) when the
   controller was switched on."

### Consequences

- No guard is added (ADR-228): the Frame lines, its permit and the job's G-code are byte-identical.
- Verified against the GRBL simulator, not on hardware:
  `src/ui/laser/abort-unlock-frame.simulator.test.tsx`.
