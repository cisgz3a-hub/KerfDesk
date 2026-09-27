## ADR-421 Amendment 1 - Relief finishing moves are checked against the exact contact (2026-09-27)

**Status:** Accepted; software-verified through unit, property, compile and emitted G-code
checks, hardware qualification pending. | **Date:** 2026-09-27

Amends ADR-421's stay-down finishing path. The Frame-first Start contract (ADR-228, PROJECT.md
non-negotiable 21) is unchanged: nothing here adds a guard, a refusal or a warning.

### Context

ADR-412 made every finishing vertex exact: its tip height is where the cutter first touches the
triangulated surface. ADR-421 then joined consecutive rows down their shared edge column and
said a link "carries the same qualification as a row". It does, and that qualification only
covers the samples. The bit travels straight between them, and where a move crosses the edge of
a wall the tip the cutter needs rises along a curve (a ball rolling over an edge traces a
circle), so the straight move cuts under it.

Johann's independent audit of PR #939 found it: a new finishing move between rows intersects
the model's wall, and the generated G-code predicts about 0.052 mm of gouging while the rows
themselves clear. Reproduced on a 10:1 wall running along the rows, from the emitted G-code:
the link down the edge column cut 0.082 mm into the wall, measured normal to the move (the
cutter sat 0.50 mm under the contact on that steep move). Rows that cross a wall do the same at
its top edge: on the ADR-412 bench relief with a 1/8" ball they cut up to 0.026 mm into the part.
CI stayed green because every existing check looked at vertices, not between them.

### Decision

1. **Every move checked.** `reliefFinishingPlan` checks every move of every strategy (raster
   rows, edge-column links, ADR-450's hops, ADR-423's waterlines) against the exact contact
   (`relief-finishing-contact.ts`). Checks sit every quarter cell of the move's length in 3D,
   the spacing ADR-423 and ADR-450 already use, plus three more in the first and last quarter
   cell (at 1/8, 1/4 and 1/2 of it from the vertex). Vertices sit on samples, and where a
   flat-bottomed cutter's rim leaves a ledge the contact bends sharply within a cell of one;
   without them a flat end mill could cut up to 0.009 mm there between two checks.
2. **Sampled tolerance, normal to the move.** Each sampled check uses a 0.002 mm deficit
   tolerance, measured normal to the move as ADR-412 measures cuts into a wall. This is the
   same nominal band as the one-sided reduction, not a certified maximum between samples or
   after G-code rounding. An independent wall/ledge probe sampled at 0.002 mm found a maximum
   planner deficit of 0.002174 mm and emitted deficit of 0.003134 mm. These observations do not
   establish a universal bound. A cutter sitting h under the contact partway along a move inclined
   at angle a cuts h cos(a) into the part: at the worst point of a smooth contact the contact
   runs parallel to the move, and where it bends sharply the cutter cuts in less. So a move down
   a near-vertical wall may pass well under the contact's height at its point without touching
   the wall.
3. **Lift, never lower.** Where a move cuts in further, the worst check point is inserted at its
   contact height and both halves are checked again. A move still failing after twelve splits
   is crossed at the highest of its two ends and every height found on it: up, across and down.
   Points are only added or raised, never lowered.
4. **Only the elements that can matter.** Checks run four cells at a time against only the
   elements that could rise above those four cells (`SurfaceContactField.alongMove`,
   `heightmap-surface-contact-move.ts`). An element is dropped when its highest corner is no
   higher than the lower end of the stretch plus the tolerance, when it lies beyond the cutter's
   radius of the stretch's bounding box, or when its facet planes stay within the tolerance of
   the stretch at both ends: the contact with a triangle never rises above the contact with its
   whole plane (`FacetResult.planeBound`), which is linear in the cutter's axis, and a convex
   function less a straight move peaks at one of its ends. Most of a finishing path lies on the
   contact, and there nothing is solved at all. The ADR-412 bench relief gives the same paths
   with and without this shortcut.

### Consequences

- Emitted G-code on the 10:1 wall: the worst cut normal to the move drops from 0.082 mm to
  0.0023 mm. What remains beyond 0.002 mm is the emitter's 0.001 mm XY rounding on a steep move.
- ADR-412 bench relief, both strategies and raster directions, with and without ADR-450 skips,
  checked every 0.01 mm: rows from 0.026 mm to 0.0022 mm, waterline moves at most 0.0025 mm.
- Random parts (300 of them, 1-3 plateaus with vertical, 0.3 mm and 1.5 mm walls, both
  strategies, both raster directions, ball and flat end mill, with and without ADR-450 skips):
  no move cuts more than 0.0026 mm into the part, checked every 0.01 mm.
- Paths grow where the contact curves: the ADR-412 bench relief's raster goes from 6,080 to
  8,279 points, a 70 degree boss from 365 to 738. Before the end checks, a 0.001 mm tolerance
  grew the bench to 10,617 points and 0.005 mm to 6,887.
- Planning time: the bench raster goes from 0.18 s to 1.0 s and raster + waterline from 2.3 s to
  4.8 s; a 0.1 mm ball over a 12 mm part (a two-million-cell grid) from 3.8 s to 7.2 s. Without
  item 4 that part took 40 s.
- The check measures against the triangulated heightmap (ADR-412), not the source mesh or image.
- Tests: `relief-finishing-contact.test.ts` (random parts, and a wall parallel to the rows; both
  fail without the check, at 0.062 mm and 0.033 mm; `checkedPath` keeps clear moves, adds points
  on the contact, never lowers a point, follows a flat end mill up a wall and holds the tolerance
  normal to the move); `heightmap-surface-contact-point.test.ts` (the kept elements give the full
  contact wherever it rises past the tolerance, on random and smooth maps and across a ridge);
  `relief-finishing-strategy.test.ts`, `compile-cnc-relief-flats.test.ts` and
  `relief-finishing-compile.test.ts` updated for the added points.
