## ADR-472 - Contour and tabbed ramps descend within the plunge rate and within their angle once emitted (2026-09-28)

**Status:** Accepted; software-verified through unit and compile/emit checks, hardware
qualification pending. | **Date:** 2026-09-28

This settles the two follow-ups ADR-471 recorded for the generic ramp entry (`applyRampEntry`,
WORKFLOW F-CNC18): contour ramps rode the cutting feed, and rounding to 0.001 mm steepened short
moves past the header's angle. The tabbed-profile ramp in the same function had both defects and
follows the same rules. The Frame-first Start contract (ADR-228, PROJECT.md non-negotiable 21) is
unchanged: nothing here adds a guard, a refusal or a Job Review finding.

### Context

Evidence was taken on ADR-471's branch (0e32cc27b), and repeated with identical results on main
after it merged (1465f9ef5), by compiling 13 jobs with `compileCncJob` and emitting them with
`cncGrblStrategy.emit`:

- the inside profile of a 6 mm hole with the 3.175 mm end mill (a 64-move 2.825 mm circle), with
  tabs off: the shipped tabs' windows would cover its whole ring and keep it at the tab top;
- 6 and 20 mm square pockets;
- engraved circles of 2 mm and 10 mm (360 moves), and a wave in 0.05 mm steps;
- 5 and 30 mm lines, engraved and on-path;
- a 3 mm circle outside profile, also with tabs off;
- a tabbed 20 mm square inside profile and a tabbed 50 mm (720-move) through-cut disc.

Each job ran at 2 to 45 degrees, with three recipes (the 1000/300 mm/min default and the feeds
calculator's plunge ratios of 0.4 for wood and 0.15 for aluminium). Each was placed three ways: no
job-origin shift, a half 0.001 mm step, and an arbitrary shift.

1. **Z rate.** Contour and tabbed ramp passes carried no `lateralFeed`, so every descending move
   rode the cutting feed, and its Z component is feed times sin(angle). Above asin(plunge / feed) the
   ramp descends faster than the plunge rate:

   | Recipe | Passes the plunge rate from | Worst, at 45 degrees |
   |---|---|---|
   | Default 1000/300 | 17.5 degrees | 714 mm/min against 300 (2.38x) |
   | Wood, 0.4 | 23.6 degrees | 1.79x |
   | Aluminium, 0.15 | 8.6 degrees | 4.76x |

   At 15 degrees one default job already passed it (1.36x), on a move rounding had steepened. The
   2026-09-24 CNC audit (TP-4) and the motion-control audit (section 5.3) recorded the same.
2. **Angle after rounding.** Ramp Z was planned in floating point, and the emitter rounds X, Y and Z
   to 0.001 mm.
   - At 5 degrees, 34 of 39 placed jobs had moves steeper than the header: 1,760 of 3,657 ramp
     moves.
   - The hole's moves came out at 5.43 degrees (5.53 placed on a half step), the wave's 0.05 mm
     moves at 5.77.
   - Where a ramp ended within a micrometre of a vertex, a 1 to 2 micrometre move came out at 24
     degrees under a 15 degree header, and on the tabbed disc at 45 under 17.5 and at 63.4 under 45.

ADR-424's relief ramps already use `lateralFeed: 'z-rate-capped'`. ADR-278's V-carve ramp (historical
since ADR-285) fed its descent at the plunge feed, and planned Z in whole 0.001 mm steps against move
lengths that survive job-origin placement, so its angle was a true maximum.

### Options measured

For the Z rate, job time is summed over the 13 jobs:

| Feed for the descent | Z rate / plunge | Job time | Program size |
|---|---|---|---|
| Cutting feed (before) | up to 2.38 (4.76 aluminium) | - | - |
| `z-rate-capped` | at most 1.00 | +0% below the threshold angle, up to +1.5% above (+5.0% aluminium) | 16 to 17% smaller (compact lines) |
| Plunge feed for the descent, cutting feed at depth (ADR-278's shape) | at most 0.71 | +13 to 56% (wood +8 to 31%, aluminium +26 to 139%) | smaller |
| Plunge feed for the whole pass | at most 0.71 | +43 to 286% | about the same |

For the angle, a prototype of ADR-278's budget:
- left no move above the header in 351 placed jobs;
- made ramps 0.2 to 3.6% longer in aggregate, and up to 37% longer on the wave at 2 degrees;
- added no plunge.

A pure budget has a catch. On a path of moves too short to carry whole steps, it stretches the
ramp (2.15x on 0.01 mm moves at 5 degrees) or cannot descend at all. A 10 mm circle could not descend
with 0.087 mm moves at 0.5 degrees, with 0.031 mm moves at 1 degree, or with 0.01 mm moves at 5.

KerfDesk's own geometry rarely gets there:
- compile flattens curves into near-fewest chords within 0.025 mm (ADR-453), about 1 mm long on a
  10 mm circle, and drawn circles are 24- to 512-sided polygons (1.3 mm sides at 10 mm);
- CNC trace commits use 0.4 mm chords;
- profile and pocket offsets use mitred joins;
- welded text, flattened at 0.001 mm into chords of roughly 0.1 to 0.2 mm, is the densest ordinary
  case.

Dense imported polylines can get there.

The maintainer chose on 2026-09-28: cap Z at the plunge rate, and budget in whole steps with a
disclosed fallback that keeps the ramp. The alternatives were feeding the descent at the plunge feed,
a plunge fallback (ADR-278's and ADR-471's rule), and keeping the planned angle and documenting the
rounding.

### Decision

1. **Z rate.** Contour and tabbed ramp passes carry `lateralFeed: 'z-rate-capped'` (ADR-424's rule).
   - Each descending move rides the cutting feed, slowed only as much as keeps its Z component
     within the plunge feed. The emitter works this out from the coordinates it writes.
   - Level moves keep the cutting feed, and vertical tab walls the plunge feed.
   - The emitter writes these passes as compact modal lines (`G1X..Y..Z..F..`, then `X..Y..Z..`), as
     it already does for relief.
2. **Angle.** `ramp-descent-budget.ts` plans the descent in whole 0.001 mm steps.
   - A move may descend `floor(L * tan(angle) / 0.001)` steps. L is the move's length with each axis
     shortened by one step: the most that rounding can take off it, before or after a job-origin
     shift.
   - A loop descends each move by what it can carry, lapping as needed. Its ramp ends at the earliest
     point of a move that carries the rest.
   - An open path's zig-zag span is the shortest whose legs carry the descent. Each move takes its
     share of the descent, in proportion to what it can carry.
   - The tabbed ramp budgets its low spans the same way.

   No emitted ramp move is then steeper than the angle, wherever the job is placed.
3. **Fallback, disclosed.** Whole steps are not used when they would more than double a ramp, that is
   when the path's moves (a tabbed ring's low spans) can carry less than half the descent the angle
   allows along them.
   - The ramp then keeps the angle as planned before rounding, with ADR-471's geometry, so an emitted
     move can be one step steeper.
   - It still ramps and keeps within the plunge rate. It never plunges.
   - The pass is marked `entryAngleApproximate`, and tiling keeps the marker.
   - The G-code header adds
     `; cnc entry-advisory: N ramps keep max-angle-deg before rounding: moves too short`.
4. A pass whose level above is written at the same 0.001 mm depth has nothing to descend, and stays
   as it is.
5. **No new refusal or guard.**
6. `EMITTER_REVISION` advances to `ramp-entry-z-rate-whole-steps-20260928-v1`.

### Consequences

The same probe on the final code:

- **Angle:** no move above the header at any angle, recipe or placement. Before, 161 to 4,102 moves
  per angle were above it.
- **Z rate:** at most the plunge rate everywhere.
- **Ramp length:** whole steps add 0.2 to 3.6% in aggregate. Per job the most is 37% (the wave at 2
  degrees) and 21% (the hole at 2 degrees); from 5 degrees up it is under 13%.
- **Ramp time:** above the threshold angle the Z cap also slows the descent. At the defaults ramp time
  rises 14% at 20 degrees, 67% at 30 and 136% at 45.
- **Job time:** default recipe +0.0 to 1.6%, wood +0.0 to 0.6%, aluminium +0.1 to 5.0%.
- **Program size:** 16% smaller over the probe's jobs, from the compact lines.
- **Byte identity:** every ramped program's bytes change. Jobs without a ramp are byte-identical: 120
  programs (4 shapes, 5 cut types, 3 depths, with and without helical entry) hashed the same as on
  main.
- **Dense paths:** the 0.01 and 0.005 mm circles and the 0.01 mm wave, the 0.031 mm circle at 1
  degree or less and the 0.087 mm circle at 0.5 degrees keep ramping under the advisory, where the
  pure budget stopped. Moves of 0.031 to 0.087 mm at 1 to 5 degrees otherwise budget to 1.1 to 1.7
  times the nominal ramp.

Not changed, recorded for follow-up:

- Relief roughing ramps (ADR-424) already ride `z-rate-capped`, but plan Z in floating point, so
  rounding can steepen their short moves under the same header.
- Tiling clips a ramp at a tile edge by interpolating a new end, which can steepen that one move.
  Tiled contour ramps keep `max-angle-deg` (ADR-471's follow-up), and tiling drops ADR-471's
  `entryPlunge` marker from contour passes.
- The doubling test weighs the whole path or lap. Where the dense moves sit at the start of an open
  path, its zig-zag span reaches past them and can still more than double.

### Verification

- `contour-ramp-feed-angle.test.ts`:
  - The hole's ramp at 2, 5, 30 and 45 degrees, and the tabbed disc's at 45, each emitted at three
    placements, keep every move within the angle.
  - At 45 degrees and 1000/300 mm/min, both keep every descending move's Z rate within 300 mm/min,
    and the lap at depth keeps 1000.
  - A 10 mm circle of 0.01 mm moves keeps ramping within the plunge rate and carries the marker and
    the header line. The hole carries neither.
  - Eight of its nine tests fail on main without this change: moves at 2.05, 5.07, 30.06, 45.07 and
    45.005 degrees, Z rates of 705 mm/min, and no marker. The ninth guards against a false advisory.
- Four tests pinned the floating-point slope or ramp length exactly, in `contour-ramp-entry.test.ts`,
  `contour-ramp-stage-integration.test.ts`, `motion-polish.test.ts` and `tabbed-ramp-entry.test.ts`.
  They now assert the angle as a maximum: slopes under two steps short of it, and ramps no shorter
  than the angle's length and at most a few percent longer.
- ADR-471's emitter test filtered lines with `^G[01]\b`, which would have skipped every compact ramp
  move. It now reads modal lines and asserts that it saw ramp moves.
- NOT verified: air cuts, material cuts, or any hardware. There is no machine for this project.
