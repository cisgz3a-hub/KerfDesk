## ADR-423 - Relief finishing can circle steep walls and run its raster along Y (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This adds two opt-in choices to the Phase H.8 relief finishing planner (ADR-098, ADR-421) and
builds on the exact surface contact of ADR-412. The default plan, a raster along X at the scallop's
row spacing, is unchanged byte for byte.

### Context

A raster rides the relief in rows. On a slope across the rows the rows stay the same distance
apart in XY but move apart along the surface, so the scallop grows; on a wall parallel to the rows
the bit only touches the face where a row happens to pass. ADR-421 recorded the cost on its bench
relief (60 x 40 mm, 10 mm deep, 3.175 mm ball nose, 0.025 mm scallop): on walls steeper than 45
degrees the finish left p95 0.38 mm and at worst 0.58 mm above what the ball can reach.

The research for this work (the 3D carving audit) found the same split everywhere it is solved:
Fusion's Steep and Shallow uses Contour (waterline) above a threshold angle and Parallel below it;
MeshCAM limits Parallel and Waterline by surface angle, with users overlapping them near 45
degrees; Carveco has Constant Z in Pro only; Vectric, Carbide Create Pro and Estlcam finish with a
raster or offset alone. Vectric and Carveco also let the raster run along X or Y.

### Decision

1. **Two layer settings.** `reliefFinishStrategy` is `'raster'` (the default) or
   `'raster-waterline'`; `reliefRasterAxis` is `'x'` (the default) or `'y'`. Both are optional on
   `CncLayerSettings`, stored as given, and shown in the relief block of the layer's Advanced
   settings together with the roughing allowance the relief already read (`finishAllowanceMm`,
   0.5 mm when unset) and, for cut types without a direction row of their own, the cut direction
   relief roughing already read.
2. **Raster along Y** plans the same serpentine on the transposed map and swaps the coordinates
   back, so every rule of ADR-421 holds unchanged with the axes exchanged.
3. **Split at 45 degrees.** Under `'raster-waterline'`, with s the scallop's row spacing: the
   raster's rows are s·cos 45° apart, and waterline levels are s·sin 45° apart on every part of
   the tip surface that slopes 45 degrees or more. On a slope φ below 45° the rows lie at most
   s·cos45°/cos φ ≤ s apart along the surface; on a slope at or above it the levels lie
   s·sin45°/sin φ ≤ s apart. Passes are never further apart along the surface than s anywhere on
   the part. The raster still covers the whole part, so the two overlap on the steep region.
4. **Waterline contours.** Levels sit at whole multiples of the level step below stock top, so
   neighbouring features share them. Each level is contoured by marching squares over the squares
   that touch a steep sample. Each crossing is placed on its grid edge by bisection with the exact
   contact at a point (ADR-412 extended from samples to any point), keeping the end of the bracket
   the cutter provably clears, so every vertex clears the model exactly as a raster sample does.
   Segments are oriented by the case topology alone, so they chain without floating-point ties.
5. **Checked moves.** Every move a waterline emits is checked by the exact contact at its middle
   and at points no more than a quarter cell apart. A move may reach into the wall sideways by no
   more than the 0.001 mm the G-code is written on (a chord across a convex arc always reaches in a
   little). A failing move gets a vertex pushed off the wall, or lifted to the tip where it cannot
   be pushed within half a cell; one still failing after four splits is lifted over the model.
   Douglas-Peucker reduction (0.002 mm) keeps a chord only if it passes the same check.
6. **Order and links.** Each feature is finished top down in one stay-down pass: after a contour,
   the next is the nearest contour one level lower within two bit diameters, linked across at the
   upper level and then straight down onto it, with the move across checked. Otherwise the chain
   ends (the emitter retracts) and the next starts at the highest level left.
7. **Direction.** Climb keeps the material on the right of travel on the physical bed. The
   compiler works out which side that is in heightmap numbers from the relief's placement (its
   determinant) and the machine origin's handedness, so a mirrored placement or origin still cuts
   climb when climb is asked for.
8. **Masked reliefs** (a mask that excludes cells) get the narrower raster only; their excluded
   cells have no triangulated surface to contour against. This is disclosed in the setting's hint.

### Consequences

- The ADR-421 bench, same bit and scallop (cut length at 1000 mm/min as the time proxy):

  | | Raster X | Raster Y | Raster + waterline 45° | Same, split at 30° |
  |---|---|---|---|---|
  | Walls over 45°, leftover p95 / max | 0.384 / 0.580 mm | 0.415 / 0.601 mm | 0.032 / 0.049 mm | 0.072 / 0.104 mm |
  | Plateau walls along X / along Y, p95 | 0.086 / 0.520 mm | 0.529 / 0.170 mm | 0.031 / 0.035 mm | 0.083 / 0.079 mm |
  | Plateau top, leftover p95 | 0.062 mm | 0.065 mm | 0.042 mm | 0.090 mm |
  | Cutting (estimate) | 5.0 min | 4.9 min | 9.4 min | 9.5 min |
  | Planning | 0.15 s | 0.12 s | 3.5 s | 3.6 s |

  The waterline cuts the worst steep-wall leftover twelvefold for about twice the cutting time. A
  30° split costs the same time and leaves twice as much, so the angle is fixed at 45°. Raster Y
  only moves the weak walls from those along X to those along Y.
- Dips below the analytic bench model stay the sampled-model chord ADR-412 describes (0.137 mm
  vertical on the plateau walls against 0.204 mm for the raster, on the finer grid). Against the
  sampled model the planner checks, the waterline tests measure no reach into a wall beyond
  0.0015 mm.
- Planning is the new cost: about 3 s on the bench's 300 x 200 grid, most of it in exact contact
  queries. A decision query ("does the tip clear z here?") stops at the first element that lifts
  the tip higher and skips every element no higher than z, which halved it; starting each
  crossing search from the interpolated guess and checking only emitted moves took it to a third.
- Job Review's oversized-scallop warning quotes the strategy's row spacing.
- The roughing allowance field sets `finishAllowanceMm`, which a profile cut on the same layer
  also reads; its hint says so on such layers.
- Tests: `heightmap-surface-contact-point.test.ts` (point contact against the oracle; the decision
  query against the height, either side of its slack), `relief-waterline-contours.test.ts`
  (vertices clear and touch the wall, orientation, the ball-on-plane position on a sampled wall,
  open contours at the region edge), `relief-waterline.test.ts` (levels, wall side, no reach into
  the wall, lifted moves, the vertical-wall level spacing), `relief-finishing-strategy.test.ts`
  (the default is unchanged, Y rows ride the same tip, the narrowed raster plus waterline),
  `compile-cnc-relief-waterline.test.ts` (climb and conventional, mirrored placement and origin),
  and `CncReliefFinishFields.test.tsx` for the settings.
