# Pro loop v1 — L5 CNC 2D output

- **When:** 2026-11-08   **Tree:** `devin/audit-loops-20261108` (after the L6 fix)
- **Scope:** profile outside / inside / on path, pocket with and without an island, drill, engrave,
  ramp entry, as compiled by `emitGcode` for the default CNC machine
- **Lenses run:** L1 (ADR-256 cut sides, ADR-250 leads, ADR-489 air floors), L2 (router motion
  rules), L3 (part size against the drawn size), L4.
- **Counts:** 0 raised.

## Headline

Eight 2D operations came out with the right size, depth ladder and motion rules. The only rapid
below Z0 is ADR-489's air floor: a `G0` down to 1 mm above the previous level, at a point the
previous level already cut along the same path, which the model confirmed at every occurrence.

## Router rules checked on every move

| Rule | Result |
|---|---|
| No XY rapid with the tip below Z0 | none |
| Rapid descent below Z0 only into cleared air | only ADR-489 air floors, each over a point the level above cut |
| Spindle running before the first cut, off at the end | `M3 S12000`, `G4 P3` spin-up, `M5` before the final move |
| Straight plunges at the plunge feed (300) | yes; XY cuts at the feed (1000) or slower |
| Depth never past the layer depth, steps no larger than depth per pass | 6 mm in 2 / 4 / 6; pocket 3 mm in 2 / 3 |
| Program ends at the safe height | Z 3.81 |

## Sizes (1/8" end mill)

| Operation | Drawn | Cut | |
|---|---|---|---|
| Outside, 40 × 30 rectangle | tool-centre path 43.175 wide | 43.175 (part 40.000) | plus an R-sized arc lead-in and lead-out on the scrap side (ADR-250) |
| Inside, Ø20 circle (96-gon) | tool-centre path 16.825 | 16.823 | the 96-gon's chord |
| Pocket 30 × 20, 3 mm | wall to wall 30.000 × 20.000 | 30.000 × 20.000 | 91 of 58,509 interior 0.1 mm cells uncut, all in the four corners a round bit cannot reach; nothing outside the walls cut |

Drill pecks to 2, 4 and 6 mm, retracting to Z0 between pecks at the plunge feed; GRBL has no canned
`G83`, so the cycle is written out. Retracting at rapid would be faster, not safer.

## Verified clean

All of the above.

## Not verified

V-carve, inlays, adaptive and rest pockets, tabs geometry and helical entry; CNC audit v1 F1–F5
covered them and their fixes (#1416–#1423) carry regression tests.
