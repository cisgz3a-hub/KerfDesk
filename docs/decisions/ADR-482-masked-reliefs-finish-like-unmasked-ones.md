## ADR-482 - Masked reliefs finish like unmasked ones: waterline round the excluded stock, linked stay-down rows (2026-09-27)

**Status:** Accepted; software-verified through unit, property, compile and removal-simulation
tests, hardware qualification pending. | **Date:** 2026-09-27

Amends relief finishing on masked reliefs (Phase H.8; ADR-098, ADR-289, ADR-412, ADR-421,
ADR-423 item 8). The Frame-first Start contract (ADR-228, PROJECT.md non-negotiable 21) is
unchanged: nothing here adds a guard, a refusal or a warning.

### Context

A relief with a mask outline leaves the stock outside the outline uncut. The dilation already
protects it at every sample (`heightmap-tool-offset.ts`): each excluded cell is a block over its
whole physical cell, standing an output quantum (0.001 mm) above stock top, and the cutter keeps
the mask's path uncertainty further off it in XY. Finishing such a relief had two gaps the
2026-09-26 3D carving audit listed as next:

- **No waterline.** ADR-423 item 8 gave masked reliefs the narrowed raster only, because the
  excluded cells have no triangulated surface to contour against. But the outline is itself a
  vertical wall of stock round the whole part, and the raster leaves the foot of it wherever it
  runs along the rows.
- **A plunge per sample near the mask.** Each column's run of included cells took its rows from
  its own first cell, so a row's selected samples came in scattered short runs wherever the
  outline was not parallel to the rows, and every run was its own pass: retract, rapid, plunge.

Bench: a 60 x 40 mm relief 10 mm deep (a dome, a plateau with 70 degree walls and a floor) inside
a 52 x 34 mm oval mask, 1/8" ball, 0.025 mm scallop, emitted G-code timed at feed 1000 mm/min,
plunge 300 mm/min and rapids 3000 mm/min. The raster took 96.2 min, 83.8 min of it plunging
straight down, with 4,000 retracts; Raster + waterline (the narrowed raster) took 193.7 min with
8,035 retracts.

### Decision

1. **Waterline round the excluded stock.** Under Raster + waterline a masked relief gets
   waterline passes like any other (`relief-waterline.ts`). Its tip surface is the dilation
   with the mask, raised over the blocks, and a point clears a level only when both the model's
   exact contact and the blocks clear it. `createMaskStock` (`relief-mask-stock.ts`) gives the
   blocks' requirement at any point: every block stands at the same height and every cutter law
   is nondecreasing in radius, so the nearest excluded cell decides, found by searching rings of
   cells outward. For waterline the blocks' XY clearance is the mask's path uncertainty plus half
   the quarter-cell check spacing plus the 0.001 mm a waterline move may reach sideways
   (`WALL_REACH_MM`): a level move is horizontal and every point of it lies within half a check
   spacing of a checked point, so the check holds everywhere along it, not just where it looks.
2. **One row phase.** Every column's run of included cells keeps the raster's rows (every
   stride-th row, the phase an unmasked raster uses) plus both its ends. No two of its selected
   samples lie more than a stride apart and a lobe narrower than the stride still gets its end
   rows, as before; a row's selected samples now sit side by side.
3. **Linked rows.** The rows' runs are cut nearest first, staying down across gaps up to four
   bit diameters, as ADR-450 links a skipping raster's: up to the highest tip on the straight
   line (the model's contact or the blocks'), across, and down. Farther gaps retract.
4. **Every move checked against the blocks.** Each move of a masked raster, links included, is
   checked exactly against every block within reach (`relief-mask-stock-move.ts`). Along a
   straight move the distance from the cutter's axis to a block's rectangle is convex, and every
   cutter law is convex and nondecreasing in radius, so while the block is in reach the move's
   height above what the block requires is convex. The stretch of the move in reach is found by
   bisection from its nearest point, and a golden-section search over that stretch, ends
   included, finds its lowest point: at the edge of reach the requirement drops away (the
   cutter's rim passes the block's side), so the lowest point may sit right there. Where a move
   dips in, that point is inserted at the blocks' requirement and both halves
   are checked again; after twelve splits the move is crossed at the highest requirement along
   it: up, across and down (`relief-mask-stock-path.ts`). Points are only added or raised.
5. **The check's tolerance.** A move may dip 0.002 mm (the one-sided reduction's tolerance) below
   the blocks' requirement, and for this check the blocks stand 0.002 mm higher, with every
   sample within reach raised over them (`raisedOverStock`), so a move that dips the whole
   tolerance still clears the real block. Checked exactly, a ball rolling over each block's edge
   split every move twelve times: 213,972 points and 11.7 s on a small test map.
6. ADR-421 Amendment 1's check against the model's exact contact still runs after, on every
   move of every strategy.

### Consequences

- The bench, before and after (excluded stock cut in the removal simulation: none, both):

  | Strategy | G-code time | Retracts | Beside the mask p95 | Steep walls p95 |
  |---|---|---|---|---|
  | Raster, before | 96.2 min | 4,000 | 3.97 mm | 0.225 mm |
  | Raster, after | 4.8 min | 6 | 4.90 mm | 0.384 mm |
  | Raster + waterline, before | 193.7 min | 8,035 | 2.34 mm | 0.154 mm |
  | Raster + waterline, after | 14.0 min | 115 | 0.586 mm | 0.049 mm |

  Leftover above the reachable surface (the part opened by the ball with the excluded stock
  standing), within the ball's radius plus 1 mm of the mask for "beside the mask" and on model
  slopes of 45 degrees or more elsewhere. Planning takes 1.3 s for the raster and 7.5 s for
  Raster + waterline.
- **Raster alone leaves more beside steep walls parallel to its rows.** The scattered row phases
  put samples on every row in places, at the price of a plunge each; one phase is the unmasked
  raster's. Along the mask edge where it runs with the rows, the raster leaves the foot of the
  stock wall as it leaves the foot of any wall parallel to its rows (ADR-423): how much depends
  on where the nearest row falls. Raster + waterline finishes both.
- The waterline's contour is interpolated on the grid, so at the foot of the stock wall it stands
  up to one cell further off than the exact clearance, as it does from any vertical wall. On the
  bench that leaves a skin under 0.2 mm thick on the stock wall, finer than the mask's own cell.
- Samples within the bit's reach of the mask stand up to 0.002 mm above their exact tip.
- Round a square island in the tests, a 3.175 mm ball's waterline starts at the second level below
  stock top: at the first, the ball stands clear of the stock on its rounded rim, which slopes at
  less than 45 degrees and so is the raster's.
- The masked raster still ignores ADR-450's finished flats and keeps its full raster.
- Tests: `relief-mask-stock.test.ts` (the requirement matches every excluded cell checked one by
  one, on and off the map, a lone cell at every distance and a nearer cell one ring further
  out); `relief-mask-stock-path.test.ts` (a move is never found higher above a block than 4,000
  samples along it show, for random moves, blocks and cutters, and a checked path of random moves
  clears the real blocks at every 0.01 mm; searching the whole move instead of its stretch in
  reach failed the first, on a flat end mill passing along a block's side);
  `relief-waterline-mask.test.ts` (a square island is circled at every level down to the floor,
  no point of any move of Raster + waterline reaches into the stock on random disc masks, and
  the simulated cut leaves the island whole);
  `relief-finishing-mask-safety.test.ts` (rows inside a round mask make one pass with no lone
  plunges, every point of every move clears the blocks, and the simulated cut leaves the stock
  whole); `compile-cnc-relief-waterline.test.ts` (a compiled relief circles its mask outline);
  `relief-finishing.test.ts`, `relief-finishing-strategy.test.ts` and
  `relief-mask-ball-emission-margin.test.ts` updated. Removing the move check or the row phase
  fails them.
