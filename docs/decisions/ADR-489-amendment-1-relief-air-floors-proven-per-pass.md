## ADR-489 Amendment 1 - A relief roughing pass keeps its air floor only where the cuts before it proved it clear (2026-09-28)

**Status:** Accepted; software-verified through unit, property and removal-simulation tests and
GRBL simulator streaming, hardware qualification pending. | **Date:** 2026-09-28

Amends ADR-489 item 3 (relief roughing floors) and its tests. The emitter, the plunged-travel
check, restarts, Pause and lift and 2D floors are unchanged. The Frame-first Start contract
(ADR-228, PROJECT.md non-negotiable 21) is unchanged: nothing here adds a guard, a refusal or a
warning.

### Context

`relief-roughing-air-floor.test.ts` draws random reliefs, and CI drew two it failed on: seed
594578632 on #997 (two bumps, 1/8" end mill, 84% stepover, 0.8 mm per pass) and seed 1167848472
on #1007 (one bump, 53% stepover, the level at the relief's floor). In each, a pass with a floor
came within the cutter's radius of stock the level above left standing, 0.8 mm above the floor.

Item 3 gave a level its floor on an argument, not a check: that every point within the
cutter's radius of the level above's region lies within the radius of one of its paths. Nothing
proves that. The ladder does not promise its rings and core cleanup reach every point of the
region, and the level below's paths were never compared with what was actually cut.

Measured on main (b1d07b61), with the distance from each stock sample the test flagged to the
nearest cut made at or below the slice top:

| Shapes | Failed | Stock beyond the cutter's reach | Height above the floor |
|---|---|---|---|
| The two CI seeds | 2 | 0.0010 and 0.0012 mm | 0.8 mm |
| 600 random reliefs, 15-95% stepover | 2 | 0.0012 and 0.0021 mm | 1.5 and 1.33 mm |
| 300 random reliefs, 70-95% stepover | 0 | - | - |

The rings are traced on the heightmap's grid, and a 1/8" bit's radius is exactly four cells, so
the test's stock samples, on a half-cell grid, sit at a ring's exact reach and a micron decides.
No stock was found wider than that, but only because these shapes happen not to leave it: rings
4 mm apart with a 3.175 mm cutter leave a strip 0.8 mm wide, and a ring below that passes within
a radius of the strip would have been given a floor all the same.

### Decision

1. **Each pass proves its own floor.** The ladder's floor per level (slice top plus the cutter's
   rise at its full radius) is now a candidate. `reliefRoughingMotion` keeps it on a pass only
   when `keepProvenAirFloors` (`core/relief/relief-air-floor-proof.ts`) shows that every point
   within the cutter's radius of the pass's path lies within that radius of a cut made before it
   at or below the level's slice top: the level above, deeper levels already cut (the separate
   flat levels come last), and the same level's earlier passes. A ramp counts only the stretches
   of it at or below the slice top. Such a cut leaves the stock within d of it no higher than the
   slice top plus the rise at d, so the tip at the floor clears it.
2. **How it is checked.** The earlier cuts' sweeps (every point within the radius of their
   paths) are Clipper2 round offsets, unioned and eroded by the radius; the pass keeps its floor
   when no part of its path leaves the eroded area. Cuts are swept once each and the union is
   kept per slice top, so each pass adds one sweep. The pass's own path is checked against the
   eroded area with a plain crossing test (`core/geometry/polyline-stays-inside.ts`), touching
   its edge counting as leaving it: Clipper's open-path clip looped forever on a ramp that
   doubled back along a loop 0.001 mm wide. A pass whose check fails, or throws inside Clipper,
   plunges from safe Z as before.
3. **No radial stock tolerance.** A thin strip is still stock; its width does not bound its
   height. The PR audit reproduced a false proof for a flat cutter shifted sideways by
   0.001 mm. Earlier sweeps are now drawn 0.0003 mm inside the true radius to cover grid
   rounding and eroded by the radius plus 0.0015 mm, covering the erosion's chord error.
   Exact centre-line retraces are proven separately by interval coverage of earlier cut
   segments (`relief-cut-path-coverage.ts`), retaining repeated rings without expanding the
   cutter. Merely tangent sweeps may conservatively lose their floor. The stock simulation
   uses the actual radius and no longer shares an inflated-radius tolerance with the proof.
4. **The compiler passes the bit's radius** (`cutterRadiusMm`). Without it no pass keeps a
   floor.

### Consequences

The benchmark table below records the original tolerant candidate, before the PR audit removed
radial stock expansion. Its retained-floor counts and byte-identity results are historical,
not a promise for the conservative implementation. The focused stock simulations retain fast
descents and pass with the actual cutter radius. Dense-region containment also now computes
bounds iteratively; a 150,000-vertex regression previously exceeded the JavaScript argument limit.

| Relief roughing, 60 x 40 mm bench relief (heightfield image, default allowance) | Air descents, main / now | G-code | Estimated time |
|---|---|---|---|
| 1/8" end mill, 40%, 1.5 mm per pass | 29 / 29 | byte-identical | 11.26 min |
| The same, 3 degree ramps | 28 / 28 | byte-identical | 11.81 min |
| 1/8" end mill, 90%, 3 mm per pass | 65 / 65 | byte-identical | 7.14 min |
| 1/8" ball nose, 85%, 3 mm per pass | 44 / 43 | one more line | 7.14 to 7.15 min |

- ADR-489's time savings stand. On the stock-simulation benches every candidate floor was
  proven: the dome and plateau with an end mill (28 of 28), a ball nose (41 of 41) and an end
  mill at 85% stepover (91 of 91), and a 150 x 100 mm plaque (31 of 31).
- The check adds planning time, about one sweep per pass: 0.2 to 0.4 s per compile of the bench
  relief above, about 0.6 s on the plaque, whose ring ladder takes 1.8 s.
- Tests: `relief-air-floor-proof.test.ts` (a retrace keeps its floor, a sweep past every earlier
  cut or into the strip between two drops it, cuts above the slice top and the risen part of a
  ramp do not count, no radius keeps nothing); `relief-roughing-air-floor.test.ts` now passes
  the radius, uses the actual cutter reach, pins the two CI shapes and the
  ball-nose ramp that doubled back, and adds the 0.8 mm strip, which the old floors fail;
  `polyline-stays-inside.test.ts` covers crossing, touching, holes, single points and the
  doubled-back ramp. 1,500 random reliefs pass with the check, 300 of them at 70-95% stepover.
  EMITTER_REVISION bumped.
