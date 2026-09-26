## ADR-413 - Relief roughing cuts the cores its rings miss (2026-09-26)

**Status:** Accepted. | **Date:** 2026-09-26

This extends the ADR-098 amendment of 2026-09-05, which gave pocket clearing a core cleanup, to
relief roughing (Phase H.5).

### Context

Relief roughing fills each Z level with rings inset by the stepover until they vanish. When the
stepover is wider than the cutter reaches, the last ring of a level (or a lobe that split off and
vanished between two insets) can sit farther from the region's middle than the cutter can clear.
A pillar of stock then stands inside a level that roughing reports as cleared, and the finishing
bit later plunges into it.

On the ADR-412 bench relief with a 3.175 mm end mill, the open floor kept stock 4.0 mm tall at
75% stepover and the full 10 mm at 90%. The Stepover field allows up to 85% for roughing and more
through presets, so this was reachable from ordinary settings.

A ball or tapered ball nose reaches less than its radius on a thin slice: it clears the whole
slice only within the radius where its cutting surface is still inside the slice. For a 3.175 mm
ball on a 0.5 mm slice that is 1.16 mm, not 1.59 mm, and a tapered ball nose's stored diameter is
the top of its flutes.

### Decision

1. Each level computes the cutter's reach on its slice, from the previous level down to this one:
   the widest radius whose cutting surface stays within the slice above the tip, by bisection on
   the tool's own `surfaceDzAtRadius`. A flat end mill reaches its full radius.
2. When the stepover is wider than that reach and the level's ring ladder ended by running out of
   interior (not at its ring limit), the planner subtracts the rings' swept area,
   `roundStrokeOutline(rings, 2 * reach)`, from the level's tool-center region and traces what is
   left as extra closed passes at that level. It repeats on what those passes leave, up to four
   rounds. Every traced boundary lies inside the region, so it inherits the rings' surface
   clearance (ADR-412).
3. An offset or difference failure is reported through the level's existing `offsetFailed`
   warning. It never refuses output (rule 7).

### Consequences

- On the bench the open floor's leftover is 1.0 mm at 40%, 75% and 90% stepover alike. That 1.0 mm
  is the terrace between the last level and the floor plus allowance, a separate planned change.
- `relief-roughing-3d.test.ts` checks that every deep floor point of a pit is within the cutter's
  reach of the last level's path, for an end mill at 75% and 90% and for a ball nose at 45% on
  0.5 mm slices. Without the cleanup the 90% case left points 1.61 mm from the path, and sizing
  the ball's cleanup by its radius left points 1.36 mm away against a 1.16 mm reach.
- A tapered ball nose now gets cleanup on levels where its narrow tip cannot bridge the stepover,
  independently of how its stepover is sized.
