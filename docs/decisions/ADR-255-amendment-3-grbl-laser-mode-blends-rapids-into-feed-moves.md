## ADR-255 Amendment 3 - The time model blends rapids into feed moves on GRBL in laser mode (2026-11-05)

**Status:** Accepted (maintainer, 2026-11-05: "Use GRBL laser model"); software-verified through
unit tests. | **Date:** 2026-11-05

Amends ADR-255 stage 8 (the shared motion planner that the job estimate, Job Review and the
Inspector time programs with). The G-code, the route and the burn do not change; only the times
shown do.

### Context

`junctionVelocity` (`src/core/motion-planner/junction.ts`) planned every junction where a rapid (G0)
meets a feed move (G1) at zero speed: "Rapid and feed motion retain the estimator's conservative
stop boundary". No ADR stated it; it predates the planner's extraction.

Performance audit S1, area S4 (`docs/audits/2026-11-02-performance-s1/S4-compile-preview.md`,
S4-P3-3) checked it against GRBL 1.1 (gnea/grbl `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e`):

- `gcode.c:868-880`: in laser mode (`$32=1`) a G0 or G1 with axis words sets
  `GC_PARSER_LASER_ISMOTION`; `gcode.c:917-929` runs `spindle_sync` only when it is clear.
- `planner.c:399-449`: the junction speed comes from junction deviation alone; a collinear junction
  is not limited.
- `doc/markdown/laser_mode.md`: "`M4` does not stop for anything but a spindle state change".

KerfDesk's Fill rows hop over other artwork with `G1 … S0` → `G0` → `G1 … S0`. The 200-object mix
has 10,903 such hops, and the estimate stopped twice at each: its badge said 3 h 05 min where a GRBL
model gives 1 h 51 min (+66 %). With the stop rule, the audit's independent model matched the app on
all seven of its jobs to 0.0–2.7 %, so this rule, not the rest of the planner, made the difference.

### Decision

1. A rapid/feed junction is limited by junction deviation, like any other, when the program is
   timed for **GRBL 1.1 or grblHAL in laser mode**: a laser job, a device with `laserModeEnabled`
   (`$32=1`, which the app reads at connect since #1567), and a GRBL 1.1 or grblHAL controller
   (`deviceRunsRapidsAsLaserMotion`, `program-timing-options.ts`). Each block carries
   `laserModeMotion`, set from the timing options, and `junctionVelocity` stops at a change of
   motion kind only when neither this rule nor the feed-matched laser rule holds.
2. Everything else keeps the stop: a CNC job, `$32=0` (GRBL then syncs on S changes), FluidNC,
   Marlin, Smoothieware and Ruida. Each can change only after its own firmware is checked, one at
   a time.
3. The Inspector times a program for a laser machine with the same rule as Job Review
   (`deviceInspectionContext`). A file opened without a machine kind keeps the stop.
4. Route and overscan are unchanged: the maintainer decided on 2026-11-05 to keep the nearest-start
   route and the overscan defaults as they are.

### Consequences

- The ETA badge, Job Review's time and the Inspector's time drop for laser jobs on GRBL and grblHAL
  with laser mode on, most for Fill layers whose rows hop over other artwork. Numbers are in
  `docs/audits/2026-11-02-performance-s1/P3-SWEEP.md`.
- Emitted G-code is byte-identical: emission never reads the junction rule.
- A controller that does stop at a G0 in laser mode would now be under-estimated. GRBL 1.1's and
  grblHAL's sources say they do not; vendor builds may differ, and an air run on one machine is
  still owed (this is not hardware qualification).
