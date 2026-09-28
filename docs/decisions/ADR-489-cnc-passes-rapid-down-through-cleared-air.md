## ADR-489 - CNC passes rapid down through the air earlier passes cleared (2026-09-27)

**Status:** Accepted; software-verified through unit, property, compile and removal-simulation
tests, hardware qualification pending. | **Date:** 2026-09-27

Amends the CNC emitter's motion contract (Phase H.1, `cnc-grbl-strategy.ts`), its plunged-travel
check (`core/invariants/cnc-motion.ts`) and relief roughing entries (ADR-424). The Frame-first
Start contract (ADR-228, PROJECT.md non-negotiable 21) is unchanged: nothing here adds a guard, a
refusal or a warning.

### Context

Every CNC pass that did not start where the last one ended was entered the same way: retract to
safe Z, rapid across, then a G1 plunge at the plunge feed all the way down to the pass's first
point. From the second relief roughing level on, most of that plunge is through air the level
above has already cut away. ADR-424 left this open: "rapiding down to just above the slice top is
an emitter change left for later."

Bench: the 60 x 40 mm relief 10 mm deep from ADR-424 (a dome, a plateau with 70 degree walls and
a floor), 1/8" end mill, 1.5 mm per pass, 40% stepover, the default machine (safe Z 3.81 mm, feed
1000 mm/min, plunge 300 mm/min), timed by `estimateJobDuration` on the emitted roughing program.
Roughing fed 324 mm straight down and took 11.05 min.

### Decision

1. **Air floor.** `CncContourPass`, `CncPath3dPass` and `CncArcPass` gain an optional
   `airFloorZMm`: the producer's proof, from the job's own earlier cuts, that with its tip at or
   above that Z the cutter touches no stock anywhere along the pass's path. It holds along the
   whole path, not only at its start, so a pass that is sliced or re-entered part way stays true.
   Absent means what it always meant.
2. **Emitter.** `cnc-grbl-entry-descent.ts` writes every contour, path3d and arc pass's descent.
   When the head is at safe Z and the pass carries a floor, it rapids Z-only down to the floor
   plus `CNC_AIR_RAPID_CLEARANCE_MM` (1 mm, `core/cnc/cnc-air-floor.ts`), then plunges the rest
   at the plunge feed. It rapids only when that target is below the head and above the pass's
   own first Z. It never rapids from inside a cut (a pass that starts where the last ended keeps
   feeding down) and never moves XY below safe Z. Helical passes keep their own entry. Nothing
   about the mechanism is relief-specific: a 2D producer (depth passes, pocket levels) can set
   the depth its previous pass cut along the same path.
3. **Relief roughing floors.** A level's floor is its slice top plus the cutter's rise at its full
   radius (0 for a flat end mill, the radius for a ball nose, radius / tan(half angle) for a
   V-bit). The level above cut its whole region to the slice top (a region only shrinks with
   depth), its outer ring rides that region's boundary, and its rings and core cleanup leave no
   point of the region more than a radius from a path. So nothing within the cutter's radius of
   the region stands higher than the slice top plus that rise, and the level's paths all lie in
   the region. The first level (slice top at the uncut stock top, which may be warped) and every
   level after one whose ladder stopped short (an offset failure or the ring limit) get no floor.
   Ramped entries keep their ramp: they start at the slice top as before, after the rapid.
4. **Plunged-travel check.** A rapid below safe Z is still a finding, except an air descent:
   Z-only, starting at safe Z, no deeper than the deepest Z the program has already fed to plus
   the clearance, and followed at once by a Z-only G1 going lower. A descent that cutting,
   another rapid, a rise or the end of the program follows is flagged at the descent's line.
   Whether the air above that pass really is clear cannot be read from the text; that is item
   3's proof, and the removal-simulation tests below.
5. **Restarts.** Pass-boundary recovery (ADR-215) and supervised contour recovery rebuild their
   job without floors (`cnc-recovery-air-floors.ts`): the operator may pick a later pass than the
   evidence proves, and a rapid onto stock that was never cut would hit it at rapid speed, where
   the plunge from safe Z only cuts it at the plunge feed, as recovery always has. Pause and lift
   (ADR-411) is unchanged: it replays the program's own lines, keeps the highest rapid Z before
   the stop as its lift height, and a stop during the descent re-enters at the stop point. Tiling
   rebuilds clipped passes without floors.
6. **Preview.** The toolpath preview keeps one vertical move per entry, matching the emitter's
   geometry step for step; the time estimate reads the emitted program, rapid included.

### Consequences

| Relief roughing (bench above) | Before | After |
|---|---|---|
| Time, plunge entries | 11.05 min | 10.37 min |
| Time, 3 degree ramps | 11.74 min | 11.07 min |
| Fed straight down, plunge entries | 324 mm | 83 mm (the level's own drop plus 1 mm, per entry) |
| 150 x 100 mm plaque 6 mm deep | 32.40 min | 32.24 min |

- The plaque gains little: its deep levels are few and wide. Finishing, the first roughing level
  and every 2D operation emit exactly as before. Lifts between pieces still go to safe Z.
- The floor is conservative for round and pointed bits: a ball nose's ridges on the bench stand
  0.6 mm above the slice top against a 1.59 mm floor.
- Tests: `relief-roughing-air-floor.test.ts` cuts every earlier pass in a stock simulation and
  checks nothing stands above the cutter held at each pass's floor anywhere on its path: a dome
  and plateau with an end mill (plunged, ramped, with slope steps and flats), a ball nose at 40%
  and 90% stepover, a 90 degree V-bit, inside a mask outline, and random reliefs (400 seeds
  checked while building, 15 in the suite). Leaving out the cutter's rise fails it by 0.6 mm
  (ball) and 0.9 mm (V-bit). `cnc-grbl-entry-descent.test.ts` (the descent's lines for each pass
  kind, when it does not rapid, and a property that honest floors never trip the plunged-travel
  check); `cnc-motion.test.ts` (accepted and flagged descents); `cnc-recovery-air-floors.test.ts`
  (recovery plunges from safe Z; Pause and lift plans through a descent). EMITTER_REVISION
  bumped.
