## ADR-424 - Relief roughing cuts each piece inside out, stays down between rings and ramps in (2026-09-26)

**Status:** Accepted; software-verified through unit, property, compile and removal-simulation
tests, hardware qualification pending. | **Date:** 2026-09-26

This amends how the Phase H.5 relief roughing planner (ADR-098, ADR-289) moves between and into
the rings its levels already plan (ADR-412, ADR-413, ADR-422, ADR-289 Amendment 1). Where the
rings and core cleanup go is unchanged. The Frame-first Start contract (ADR-228, PROJECT.md
non-negotiable 21) is unchanged: nothing here adds a guard, a refusal or a warning.

### Context

The 3D carving audit (2026-09-26) compared KerfDesk's relief roughing with Vectric, Carveco,
Fusion, Carbide Create, Estlcam and MeshCAM. All of them order offset roughing so the cutter
widens a cleared area and stays down between offsets where it can. KerfDesk did neither:

1. **Every ring was its own pass.** The emitter lifts to safe Z before a pass that starts
   elsewhere and plunges from there at the plunge feed. On the ADR-412 bench relief (60 x 40 mm,
   10 mm deep, 1/8" end mill, 1.5 mm per pass, 40% stepover) roughing lifted 108 times and plunged
   937 mm straight down, 3.1 of its 13.2 minutes.
2. **Rings ran outside in, and the direction rule did not fit that order.** A level's first ring
   rides its region boundary and slots at the full cutter width. The compiler then wound each
   ring on its own with the pocket rule, which assumes the stock lies outside the ring, as it
   does when a pocket is cut inside out. Outside in, an outline ring's stock lies inside it, so
   every outline ring after the first cut conventional when climb was asked. Each ring was
   oriented alone, so a ring round an island was never recognised as a hole: island rings (stock
   outside them in that order) came out climb. One level cut its two sides in opposite
   directions.
3. **No ramp.** Relief roughing ignored the layer's ramp angle and always plunged.

### Decision

`reliefRoughingMotion` (`src/core/relief/relief-roughing-motion.ts`) turns each level's rings and
cleanup paths into passes, in heightmap mm; the compiler maps them to the machine.

1. **Order: each piece inside out, nearest first.** The rings of one offset step never cross, so
   the even-odd count of the loops containing a loop says whether it bounds a piece from outside
   or an island inside it. A piece one step in lies inside exactly one piece of the step before,
   which gives a tree (`ringPieces`, `relief-roughing-order.ts`). A piece is cut once every piece
   inside it is. Of the pieces ready, the one with a loop nearest the cutter comes next; its own
   loops (outline and islands) go nearest first. The level's core cleanup paths follow in the
   planner's order. The cutter enters where the rings are shortest and widens the cleared area
   one stepover at a time, as the pocket planner does.
2. **Direction.** Inside out, every ring meets its stock on the side toward the region boundary:
   outside an outline, inside a ring round an island. The compiler works out whether climb puts
   the stock right of travel in heightmap numbers (`materialOnRightInMap`: the placement's
   determinant and the machine frame's handedness), and every loop is wound so its stock is on
   the side the layer's cut direction asks for. Island rings wind opposite to outline rings, as
   ADR-252 does for profile holes. Core cleanup paths carry their own stock side: a traced piece
   has its stock inside its outline and outside its holes; a deepest ring the other way round.
3. **Links.** After a loop the cutter stays down and feeds straight to the nearest point of the
   next loop when the move:
   - is no longer than one cut width (it may cross stock the next loop has not cut yet), and
   - stays in the level's link region: no crossing of its boundary (the ends trimmed by 1e-6 mm,
     since ring 0 is that boundary) and its middle inside it by the even-odd rule. The link
     region is where the dilated heightmap proves the cutter may stand at that depth; for a
     band level (ADR-422) it is every cell the level's depth reaches, the deeper ones included,
     whose stock stands at the band's slice top too.
   Between the loops of one piece, a link of any length stays down when it stays inside that
   piece: the pieces within it are cut already, so it crosses cleared floor. Otherwise the
   cutter lifts, as before. A chain of linked loops is one open contour pass; the emitter feeds
   its links like any other move.
4. **Entry.** A chain starts at the middle of its first loop's longest side. With a ramp angle
   set, it descends along that loop from the level's slice top (where the level above left the
   stock) to its depth, wrapping round the loop as often as the angle needs, then cuts the loop
   once at depth from where the ramp ended. The angle is held to 0.5-45 degrees, as the pocket
   ramp holds it (`motion-polish.ts`). A loop shorter than one cut width plunges. A ramped chain
   is a path3d pass with the `z-rate-capped` lateral feed, so the descent keeps within the plunge
   rate and the level itself keeps the cutting feed.
5. **Settings.** The ramp is the layer's Ramp entry. A relief layer whose cut type has no Ramp
   entry row (anything but the profiles, pocket and engrave) gets a **Roughing ramp** row beside
   the relief rows (0 = plunge). The roughing group records the angle, so the G-code header carries
   `; cnc entry: contour-ramp; max-angle-deg: N`. Relief ramps carry no `entryRamp` marker: that
   marker's advisory ("tiled ramp starts below stock top") is written for ramps into uncut stock,
   and these start on stock the level above has cleared.
6. The emitter is unchanged. Relief groups already set `retractBetweenPasses: false`.

### Consequences

- Bench relief, roughing only (G-code time estimate at 1000/300 mm/min feed/plunge):

  | | time | lifts | straight plunge |
  |---|---|---|---|
  | Before | 13.2 min | 108 | 937 mm |
  | After, plunge entry | 10.6 min | 35 | 324 mm |
  | After, 3 degree ramp | 11.2 min | 34 | 283 mm |

  The leftover stock is unchanged by construction (same rings), and the 3D allowance holds
  through links and ramps. The remaining straight plunges are descents from safe Z through
  cleared air at the plunge feed; rapiding down to just above the slice top is an emitter change
  left for later.
- Climb and conventional now mean the same thing round islands as round outlines.
- The pinned roughing snapshot changes from 6 passes to 4: rings are linked at depth, and each
  chain starts at the middle of its first loop's longest side.
- Tests: `relief-roughing-motion.test.ts` (inside-out order, winding for climb and conventional,
  islands, long links inside a piece, lifts across gaps and between far pieces, a property test
  that links never leave the link region, ramp slope and depth, tiny-loop plunge, cleanup stock
  side); `relief-roughing-3d.test.ts` (the allowance through links and ramps);
  `compile-cnc-relief-roughing-coverage.test.ts` (one pass per level, ramped entries clear the
  floor, the entry comment, climb round an island through the compiler);
  `CncReliefFinishFields.test.tsx` (the Roughing ramp row).


### Integration with ADR-427 (2026-09-27)

Deepest cleanup now precedes regular rings, rather than following them. Cleanup
outline/island stock-side metadata describes that inside-out order. The piece tree,
nearest selection, checked links, ramps and slice-top contract remain unchanged.
ADR-427's compile/removal oracle includes links when checking newly removed stock.

### Closed-region property oracle (2026-09-27)

A first-failure diagnostic captured seed 20260927, case 317 (78% stepover).
The actual link from `(7.800000000000001, 18.8)` to `(7, 16.400000000000002)`
at Z -3.3 remains inside its proven region. Independent exact rational
intersection and interval tests over the original binary64 coordinates confirm
this. Floating interpolation at t = 0.75 rounds onto the hole vertex `(7.2, 17)`;
the strict ray-cast test oracle incorrectly classified that boundary as outside.

Only the test oracle now admits exact points on the closed region boundary, with
no epsilon or outside-distance allowance. Adjacent excluded points are negative
controls. The captured example is pinned in addition to all 25 generated cases.
The property reports the first counterexample without synchronous shrinking,
which Vitest's timeout cannot preempt. Production containment, link geometry,
motion, settings, warnings and Frame policy are unchanged.

### Entry precision and provenance follow-up (2026-09-27)

ADR-471 Amendment 1 now budgets relief entry Z in output coordinate quanta using final
machine-space XY placement. Positive requests below 0.5 degrees are honoured without an
upward clamp. Entry keeps the longest-side seam, complete floor cleanup and checked links.
Actual ramps carry `entryRamp`; short loops and unrepresentable descent carry explicit
plunge markers and distinct reasons. The former concern that a lower start was incorrectly
called tiled is resolved by checking the group's actual tiling marker. These findings stay
advisory. The tests inspect emitted coordinates; hardware qualification remains pending.
