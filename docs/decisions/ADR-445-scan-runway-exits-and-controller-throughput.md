## ADR-445 - Preserve scan speed at split burn edges and reduce controller traffic

**Date:** 2026-09-27
**Status:** Accepted in source; physical qualification pending.

## Context

Bidirectional Fill and Image can show displaced alternate rows even after scan-offset work.
Three reproducible software gaps were found during the investigation:

- Bounded raster and ADR-234 Fill splits had an entry runway but no internal exit. When a
  1500 mm/min burn was followed by an 800 mm/min controlled seek, the planner had to decelerate
  inside the burn. In a declared 100 mm/s² fixture, a 1 mm stroke entered at 19.4365 mm/s and
  exited at 13.3333 mm/s instead of its calibrated 25 mm/s. Generic Scan Line already shared
  split gaps between entry and exit.
- Fill ignored the dialect's compact motion setting. Dense short spans could exceed a
  115200-baud wire budget despite being vector Fill. The 4040 dialect also forced verbose
  Image output, adding avoidable traffic on the slower controller path.
- Calibration coupons burned requested-speed labels even when profile limits and feed
  formatting produced a different actual F word.

GRBL queues power with motion. A delayed command stream can starve its planner, but that is
different from physical laser-response delay or mechanical backlash. Neither the controller
model name nor a synthetic test establishes a machine's measured correction.

## Decision

1. Shared bounded split planning gives each adjacent sweep at most half the blank gap, capped
   by its effective Overscan, on both exit and entry. Outer runways remain full. Wide gaps
   retain their unused positioning remainder. This replaces the internal entry-only part of
   ADR-234 and the equivalent raster/Island bounded planning. Generic Scan Line's geometry is
   unchanged; ADR-234's 5 mm maximum remains. Explicit zero Image overscan still means zero.
   When the two runways consume the entire gap, both reuse one canonical meeting point. This
   prevents independent floating-point expansions from rounding to different 0.001 mm
   controller positions. Fill expansion and Raster output/preview consume that same point;
   signed offsets and powered coordinates retain their existing meaning. The head crosses a
   shared point at scan feed without stopping. Under M3, a laser-off move to where the head
   already is drains GRBL's planner (OR-1), so no such move is written there: Fill already
   dropped it, and an Image sweep that starts at the point the previous sweep closed on now
   omits its opening travel. Under M4 the planner drops the empty block and the bytes stay.
2. Fill honours `compactMotionWords`, resetting modal spelling at each sweep. GRBL Dynamic,
   Raster, and 4040 Safe scan output use compact spelling. The 4040 dialect still repeats F
   and S as configured, and keeps its power modes and controlled seek speed. GRBL Compatible
   retains verbose output. Numeric coordinates, feeds, powers, and burn order do not change.
3. Generated calibration layers, cells, and speed labels use the same effective feed after
   the active profile ceiling and G-code representation. The native signed reverse-only
   scan-offset convention and explicit LightBurn conversion remain unchanged.
4. Raster Diagnostics compares actual planned runway lengths against both the calibration
   margin and the conservative acceleration distance `v² / (2a)` from the profile. Unknown
   acceleration is not a passing check. A runway side that meets its neighbour at a shared
   point is continuous motion, not a start from rest, so it is not compared; more Overscan
   could not lengthen it anyway. This is an estimate and advice, not a new Start gate
   or an automatic change to feed, power, controller settings, or the Frame envelope.
5. Exported G-code receives a distinct scan-timing emitter revision, preserving prior CNC
   provenance, so saved output from before this change can be identified and regenerated.

## Consequences and verification

The repaired split plan keeps the tested burn at 25 mm/s in both directions and also improves
one-way scans. Shared planning keeps output, preview and Frame geometry consistent. Short gaps
cannot overlap or backtrack, and the existing outer envelope does not grow. More of a split
gap may be travelled at engraving feed, so duration can change.

Regression coverage includes emitted-motion kinematics, an independent braking-distance
calculation, signed correction, preview and Frame parity, random gap geometry, compact/verbose
semantic equivalence and wire demand, and UI-to-G-code calibration speed consistency.
Half-thousandth boundary regressions also check that shared gap endpoints cannot introduce
a backward dark move after controller rounding, including reversed and angled scans.

Runway distance cannot guarantee constant speed for every acceleration, block density or
transport. No controller setting or physical machine was changed. Physical delay/backlash
still requires a measured, machine/head-specific table at reachable speeds.

Primary sources checked on 2026-09-27:

- [GRBL laser mode](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Laser-Mode)
- [GRBL streaming interface](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface)
- [GRBL planner](https://github.com/gnea/grbl/blob/master/grbl/planner.c)
- [LightBurn scan-offset calibration](https://docs.lightburnsoftware.com/2.1/Guides/ScanningOffsetAdjustment/)
