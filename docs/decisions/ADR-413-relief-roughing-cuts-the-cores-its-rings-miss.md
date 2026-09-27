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
   interior (not at its ring limit), the level's leftover stock is cleared by ADR-289
   Amendment 1's planner (`relief-core-cleanup.ts`), with this reach as the radius each ring and
   cleanup path sweeps. That planner subtracts the rings' actual sweep from the level's tool-center
   region and gives each leftover piece its deepest-inset ring or a trace around it, round by
   round. Every path lies inside the region, so it inherits the rings' surface clearance
   (ADR-412).
3. An offset or difference failure is reported through the level's existing `offsetFailed`
   warning, and stock left after the planner's round budget through `passLimited`. Neither
   refuses output (rule 7).

#### Reconciliation with ADR-289 Amendment 1

This ADR first shipped its own cleanup: a trace around whatever the rings' sweep missed, up to
four rounds. ADR-289 Amendment 1 (#942) added a relief core cleanup at the same point, sized by the
stepover's cut width. Keeping both would cut each core twice, so one planner remains:
Amendment 1's, which gives a core a single small ring instead of a trace and drops hairlines
thinner than 0.02 mm. It reads this ADR's per-slice reach instead of the cut width, which
supersedes Amendment 1's item 3 sentence "the cleanup reads the same cut width as the stepover".
For a flat end mill both are the tool radius, and for a tapered ball nose on a full slice they
agree. They differ on the thin slices ADR-422's floor and flat levels add, and for a ball nose:
sized by the cut width, a 3.175 mm ball at 45% on 0.5 mm slices still left floor points 1.36 mm
from the nearest path against its 1.16 mm reach.

### Consequences

- On the bench the open floor's leftover is 1.0 mm at 40%, 75% and 90% stepover alike. That 1.0 mm
  is the terrace between the last level and the floor plus allowance, a separate planned change.
- `relief-roughing-3d.test.ts` checks that every deep floor point of a pit is within the cutter's
  reach of the last level's path, for an end mill at 75% and 90% and for a ball nose at 45% on
  0.5 mm slices. Without the cleanup the 90% case left points 1.61 mm from the path, and sizing
  the ball's cleanup by its radius left points 1.36 mm away against a 1.16 mm reach, with this
  ADR's first planner and with Amendment 1's alike.
- A tapered ball nose now gets cleanup on levels where its narrow tip cannot bridge the stepover,
  independently of how its stepover is sized.
