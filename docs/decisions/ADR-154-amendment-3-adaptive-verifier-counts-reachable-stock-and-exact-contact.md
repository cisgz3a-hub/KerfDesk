## ADR-154 Amendment 3 - The adaptive verifier counts only stock the cutter can reach and measures contact exactly; ring links step straight out (2026-09-28)

**Status:** Accepted; software-verified through planner, verifier, contact and compile tests,
hardware qualification pending. | **Date:** 2026-09-28

Amends ADR-154's verifier ("an independent bounded stock-removal verifier must confirm engagement
and at least 98.5% coverage"), the simulated engagement of ADR-154's 2026-08-02 amendment, and the
links between ADR-154's roughing rings. The Frame-first Start contract (ADR-228, PROJECT.md
non-negotiable 21) is unchanged: nothing here adds a guard, a refusal class or a warning. The
verifier still refuses, as a compile failure, any plan it cannot certify.

### Context

On main ee9f7e824 an adaptive pocket layer 3 mm deep at the default settings (Climb, 1.5 mm per
pass, 10% engagement) compiled no CNC group for these closed polygons, through
`compileCncJob(scene, DEFAULT_DEVICE_PROFILE, DEFAULT_CNC_MACHINE_CONFIG)`:

| Pocket | Bit, engagement | Refusal |
| --- | --- | --- |
| 12 mm square | 3.175 mm, 0.3175 mm | reachable stock left behind |
| 20 mm square | 6.35 mm, 0.635 mm and 3.175 mm | reachable stock left behind |
| right triangle, 30 mm legs | 3.175 mm, 0.3175 mm | engagement above the limit |
| the same | 3.175 mm, 1.5 mm | reachable stock left behind |
| right triangle, 20 mm legs | 3.175 mm, 0.3175 mm | engagement above the limit |

The 12 mm square compiled at 1.5 mm engagement; 20 and 30 mm squares, a 30 mm rhombus with 60 and
120 degree corners and a 40 x 35 mm isosceles triangle compiled at the default.

Each case was reproduced and the verifier run again with every step instrumented. Three defects
explain the refusals.

1. **The coverage target counted stock no cutter can reach.** The stock grid held every cell
   inside the pocket. A convex corner of interior angle a keeps r^2 (cot(a/2) - (pi - a)/2) that no
   pass of a cutter of radius r can remove. That is 1.50% of the 12 mm square, so even a perfect
   plan could clear at most 98.498% of it against the 98.5% target. It is 2.16% of the 20 mm square
   with the 6.35 mm cutter and 1.50% of the triangle with 30 mm legs. In every refused case each
   cell left over lay beyond the cutter's reach and no reachable cell was left, so the message
   "reachable stock left behind" was untrue. The grid's count of corner cells also moved with its
   cell size: the 12 mm square passed at 1.5 mm engagement only because its coarser grid counted 42
   corner cells instead of 100.

   | Pocket | Corner stock, exact | Corner stock, on the grid | Coverage read |
   | --- | --- | --- | --- |
   | 12 mm square, 3.175 mm cutter | 1.50% | 1.73% | 98.27% |
   | 20 mm square, 6.35 mm cutter | 2.16% | 2.13% | 97.88% |
   | right triangle, 30 mm legs | 1.50% | 1.84% | 98.16% |
   | right triangle, 20 mm legs | 3.39% | 3.83% | 96.17% |

2. **Ring links pushed into the corners.** Each roughing ring started at its vertex nearest the
   previous ring's start, and the straight link between them cut into the next ring's stock.
   Fillets put a ring's vertices on its corner arcs, so the chain of starts could settle on one
   corner. On the right triangles it ran up the right angle's bisector, where consecutive rings
   stand the spacing over sin(45 degrees) apart: each link pushed 0.226 mm diagonally into a
   concave corner instead of stepping 0.159 mm into a wall. Measured without a grid (below), the
   links held 84.8 degrees of contact, 0.415 mm on the verifier's scale against the 0.3175 mm limit.
   On every pocket measured the links were the largest engagement: 68 degrees (0.271 mm) on the
   squares, 0.318 and 0.320 mm on the rhombus and the isosceles triangle, just over the limit.

3. **The stock grid could not resolve the contact.** The grid cell is the smallest of half the
   engagement, a sixteenth of the diameter and 0.25 mm, but at least 0.05 mm: 0.159 mm at the
   default, as wide as the ring spacing (half the engagement). Each ring's cut was one cell thick.
   The contact was read from occupied cells in a band that reached a half cell diagonal outside the
   cutter, each spread over its angular width. The contact was also computed exactly at the same
   samples: wherever the grid read more than 60% of the limit, and at 1% of the rest (1,300 to
   9,100 samples per pocket). The grid read up to 0.3 mm too high and up to 0.17 mm too low. On the
   triangle with 30 mm legs it read 0.5885 mm where the plan held 0.415 mm; once the links were
   fixed it still read 0.546 mm, over the limit and its 0.2245 mm allowance, where the plan held
   0.293 mm.

Two things the investigation found were left as they are:

- **Pockets longer than they are wide are refused, correctly.** A 10 x 40, 15 x 30, 20 x 30,
  20 x 40, 25 x 30 or 30 x 60 mm rectangle with the 3.175 mm cutter, or 40 x 60 mm with the
  6.35 mm cutter, is refused at the default engagement. The innermost offset ring is a thin loop
  round the pocket's middle line, and only the disk the entry helix clears (radius 1.75 r) is open
  before it. Beyond that disk the ring cuts a full slot, an engagement of r against a limit of
  0.1 D. The plan really does that, so the refusal stands. Opening a long pocket within the limit
  needs another opening strategy, such as trochoidal or medial-axis clearing, and its own decision.
  The existing rectangle tests run at 50% engagement, where a slot is allowed; the acceptance of
  2026-07-13 tried a 30 mm square.
- **The finishing rings are not measured.** The outermost roughing ring's corners are rounded to the
  cutter radius, and the finishing ring then cuts the corner stock left between that ring and the
  wall. Measured exactly, it meets 114 degrees of contact in a 90 degree corner and 163 to 209
  degrees, up to a full slot, in 60 and 45 degree corners. That is ADR-154's conventional cleanup
  contour; measuring it, or rough clearing the corners first, needs its own decision.

### Decision

1. **Stock is what the cutter can reach.** The verifier builds the reach region from the pocket
   alone, never from the plan: the pocket offset in by the cutter radius and out again (Clipper,
   round joins, 0.001 mm arc tolerance), less the 0.002 mm containment allowance. A cell is stock
   when its centre lies in the pocket and in that region. The 0.002 mm keeps out cell centres on the
   reach limit itself, such as a row of centres on a 45 degree wall that runs along the grid's
   diagonal: a disk sample only ever touches them. The coverage target stays 98.5%, of the stock
   the cutter can reach.
2. **The contact is exact.** `AdaptiveCutterContact` (`adaptive-pocket-contact.ts`, with the rim
   arcs in `adaptive-pocket-rim-arcs.ts`) keeps every move cut so far. At each sample it removes from the rim the arcs lying strictly within the cutter
   radius of an earlier move (a capsule), of the entry helix (a disk, or an annulus for a helix wider
   than the cutter) and of the current move up to the sample. The largest arc left is the contact,
   and the engagement is r (1 - cos(arc / 2)) as before. Containment is certified first, so the
   cutter never leaves the pocket and no boundary test is needed. The grid still measures coverage
   and clears at every sample, every half cell along each move. The contact is evaluated at each of
   those samples on a move at least a quarter cell long. Along a run of shorter moves, such as a
   dense curve's fillet slivers, it is evaluated once the path has run a quarter cell, so at least
   every half cell of path. A move is skipped when it cannot reach the arcs still open: when it lies
   r or more from them, or when both its ends face away from every direction in them (a move clears
   the rim point p + r u only through a point s with (s - p) . u > 0). That only saves time. The
   allowance of one grid cell diagonal above the limit is kept. With exact contact it is margin
   rather than measurement error, and it is kept so that no verdict moves except through the
   measurement.
3. **Ring links step straight out.** Ring starts are chosen from the wall inward. The outermost
   ring of each sequence starts at its point nearest the entry centre, and each ring inside it at
   its point nearest that start, anywhere along the ring's segments. On a straight wall each link is
   then the perpendicular step of one ring spacing, and its engagement is that spacing, half the
   limit. Ring order, ring geometry, the entry helix, the cut direction and the finishing rings are
   unchanged. A start within 0.001 mm of a vertex uses the vertex.
4. **Emitter revision** advances to `adaptive-ring-links-straight-out-20260928-v3`. Every adaptive
   pocket's roughing starts each ring at a new point and links the rings differently.

### Consequences

The pockets that were refused compile, and the engagement below is measured exactly:

| Pocket | Bit, engagement limit | Largest engagement |
| --- | --- | --- |
| 12 mm square | 3.175 mm, 0.3175 mm | 0.278 mm |
| 20 mm square | 6.35 mm, 0.635 mm | 0.538 mm |
| 20 mm square | 6.35 mm, 3.175 mm | 2.158 mm |
| right triangle, 30 mm legs | 3.175 mm, 0.3175 mm | 0.295 mm |
| right triangle, 30 mm legs | 3.175 mm, 1.5 mm | 1.033 mm |
| right triangle, 20 mm legs | 3.175 mm, 0.3175 mm | 0.332 mm |

- The pockets measured that compiled before still compile: 0.285 mm on the 30 mm square, 0.272 mm
  on the rhombus (its links held 0.318 mm) and 0.227 mm on the isosceles triangle (0.320 mm). On
  the squares the largest engagement is now at the first links outside the entry disk, which step
  into its concave edge rather than into a flat wall.
- The triangle with 20 mm legs holds 0.332 mm, 4.7% over its limit, in its innermost rings' acute
  corners beside the entry. That is within the kept allowance, so it compiles. Tightening the
  allowance now that the contact is exact would refuse it, and would refuse a full slot at
  engagement limits of 41% of the diameter and more, which the allowance admits today. That needs
  its own decision.
- Long pockets stay refused, as above.
- Verifier cost in CPU time, planning included, as a share of the grid measurement's (medians of
  three runs interleaved with the previous code): 0.61 for the 30 mm square and 0.71 for the 20 mm
  square at the default, 1.01 for two squares with a 4 mm cutter, 0.94 for the 90-edge curved test
  pocket and 1.12 for the 360-edge one, whose rings are dense with short moves.

### Verification

- `adaptive-pocket-contact.test.ts` checks the contact against closed forms: a side cut beside an
  earlier pass, a straight step into a wall (engagement equal to the step), a slot (the radius), the
  inside and edge of the entry disk, and the core a helix wider than the cutter leaves. In 150
  random arrangements of earlier moves it agrees with a rim sampled at 0.05 degrees to 0.005 mm.
- `adaptive-pocket-verifier.test.ts`: the 12 mm square verifies with coverage 1; a plan missing its
  outer rings and finishing ring is still refused for reachable stock left behind; the right
  triangle with 30 mm legs verifies with its largest engagement within 0.3175 mm.
- `adaptive-pocket.test.ts`: on a square and on the right triangle every link is at most the ring
  spacing plus 0.015 mm (interior rings sit on a 0.01 mm grid).
- `compile-cnc-adaptive-simple-pockets.test.ts` compiles the six refused pockets above through the
  real compiler, and a 10 x 40 mm rectangle is still refused for its slot.
- Against the previous code nine of these fail; the two refusal tests pass before and after.
- The existing adaptive tests pass unchanged, among them ADR-154 Amendment 2's finishing-ring
  G-code and its removal simulation of the 12 mm square's seam.
- The tables' measurements came from one-off probes: an instrumented copy of the verifier, and an
  exact contact computation independent of `AdaptiveCutterContact`.
- No hardware run was made. ADR-154's hardware status stays CLAIMED.
