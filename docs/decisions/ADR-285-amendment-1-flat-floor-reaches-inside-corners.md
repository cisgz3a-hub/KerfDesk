## ADR-285 Amendment 1 - The V-carve flat floor reaches every inside corner (2026-10-23)

**Status:** Accepted; software-verified with an independent emitted-program removal oracle,
hardware qualification pending. | **Date:** 2026-10-23

Fixes CNC audit v1 findings F1-P2-1 and F1-P3-1 (`docs/audits/2026-10-23-cnc-v1/F1-cnc-vcarve.md`),
both confirmed by an independent refuter and the audit coordinator. ADR-285 item 3 puts repeated
floor-clearing lines in "the mathematical core left by an explicit depth cap or by the selected
V-bit's finite cutting diameter", and ADR-319 item 6 accepts only the physical scallops between
pointed-bit floor passes. The planner broke both at every inside corner. The Frame-first Start
contract (PROJECT.md non-negotiable 21, ADR-565) is unchanged: nothing here adds a guard, a refusal
or a warning.

### Context

The flat core is every point at least one cone radius `r = depth x tan(A/2)` from the artwork
boundary: the region eroded by a disc. `vcarveFlatCoreRoutes` built it with
`insetContoursChecked`, whose Clipper offset uses mitred joins. At a convex corner the mitred
inset and the true core agree. At an inside (reflex) corner the true core boundary is an arc of radius `r` around the
corner vertex, but the mitre extends the two straight offsets until they meet, one `r x sqrt(2)`
from a 90-degree vertex. The floor's first ring sits on that boundary at full depth and is also what
cuts the wall near the corner. With the ring squared off, the cone never swept the curved strip
between the arc and the mitre, so a fin of uncut stock stood at every inside corner of every flat
floor.

The audit's independent oracle measured the fin on emitted G-code, and a finer Detail setting did
not reduce it. The end-mill clearing stage did not hide it either: that stage pockets the same
mitred core, and rest finishing keeps only the V-bit's own floor rings, which also stopped short.
Nothing warned. The 3D viewer showed the fin; the Design Studio preview did not. F1-P3-1 was the
reason it went unnoticed: the depth-law suite already carved an L junction and a slab with an
island, but it only checked that no point cut too deep, never what was left.

### Decision

1. **The V-bit's flat core reaches the arc.** `vcarveFlatCoreRoutes` builds the core as the union
   of two Clipper insets of the normalized region. One is the mitred inset at `r`, as before. The
   other is a round-join inset at `r / (1 - 0.002)`, where 0.002 is Clipper's default arc
   tolerance as a fraction of the offset. That inset puts its arc points on a circle just outside
   radius `r`, so its chords touch the radius-`r` circle from outside. Where a corner turns less
   than one round-join step (about 7.25 degrees), the enlarged arc lies inside the mitred inset,
   and the union keeps the single mitre point. That point is no further off the true arc than
   Clipper's own chords (0.2% of `r`). Where a corner turns more, the union follows the arc. The
   ring ladder inside the core is unchanged. Each ring is a mitred inset of the core, so at a sharp
   corner every ring is a concentric arc one floor pitch further out. The corner is cleared to the
   same scallop as the rest of the floor. This is the refuter's corner-arc fix, built into the core
   instead of added as extra passes.
2. **Plain round joins were rejected.** A plain round-join inset at `r` was tried first. It
   cleared the corners, but Clipper puts its arc points on the circle, so every chord dips inside
   radius `r`. The floor pass then has to rise and fall along each chord, and the certified depth
   profile split those passes into 0.025 mm blocks. On the recovered `Safe` fixture (ADR-285
   item 6), the worst 16-block GRBL planner window went from 13.8 ms of wire margin to -5.7 ms, and
   the program grew from 15,866 to 18,530 lines. Clipper's round join also writes at least two
   points at every vertex, even one turning less than a degree. With the union, `Safe` keeps its
   13.8 ms margin at 17,769 lines.
3. **Depth law, outline and containment are unchanged.** Every point of the core is at least `r`
   from the outline, so every floor ring still runs at full depth. It is profiled by the certified
   boundary-distance law on the 0.001 mm grid as before. The medial routes, convex corners,
   straight walls and source-boundary coverage are untouched. A flat core with no inside corner
   sharper than one join step emits the same G-code as before.
4. **The end-mill clearing stage keeps its mitred boundary.** `vcarveClearanceFloor` still pockets
   the mitred core, which lies wholly inside the true core, so it can never cut a wall. Rest
   finishing (WORKFLOW F-CNC6 Success 5) drops only V-bit spans whose whole swept volume the
   clearing passes already removed. The new corner arcs lie outside that pocket, so the V-bit keeps
   them and finishes the corner. Eligibility and refusal of a clearing bit (`vcarveHasFlatFloor`)
   read the same boundary as before.
5. **A test measures what is left (F1-P3-1).** The depth-law suite compiles an L junction (60 and
   90 degree bits), the slab with an island, a square with a 0.8 mm island in flowing depth, and a
   wide L behind an end-mill stage. It emits each program and sweeps the cutters along every
   emitted feed move with the independent removal oracle (`vcarve-removal.test-support.ts`: cone
   and flat disc, no production simulator or planner geometry). Over the whole region on a
   0.05 mm grid, the stock left must stay within `pitch / (2 tan(A/2))` plus the 0.01 mm
   emitted-footprint tolerance and 0.002 mm rounding, and nothing may go deeper than the law.
   All five cases fail on the mitred core, with 0.17-0.26 mm left.

### Evidence

Independent oracle, whole region, 0.05 mm cells, automatic Detail (0.1 mm floor pitch). The
scallop for that pitch is 0.050 mm with a 90-degree bit and 0.087 mm with a 60-degree bit.

| Shape | Stock left before (mm) | After (mm) | G-code lines before | After |
| --- | --- | --- | --- | --- |
| 8 mm-arm L, 90-degree 6.35 mm V-bit, 1 mm floor | 0.175 | 0.050 | 305 | 740 |
| Depth-law L junction, 60-degree 6 mm V-bit, 1 mm floor | 0.174 | 0.090 | 153 | 297 |
| Slab with a 2 mm island, 90-degree 6.35 mm V-bit, 1 mm floor | 0.175 | 0.050 | 473 | 998 |
| 16 mm-arm L, 2 mm floor, 3.175 mm end mill and rest finishing | 0.337 | 0.050 | 584 | 1,439 |
| 20 mm square with a 0.8 mm island, flowing 90-degree 6.35 mm V-bit | 0.553 | 0.051 | 384 | 1,493 |
| 10 mm square with a 0.8 mm island, flowing 90-degree 3.175 mm V-bit | 0.264 | 0.051 | 259 | 801 |

No case removes material below the depth law: the worst removed-minus-target is zero within
rounding.

### Consequences

- Every floor ring carries the arc of each sharp inside corner, about 13 blocks per 90 degrees,
  so corner-heavy floors emit more lines (table above) while their cutting length grows only a
  few percent. The arc blocks are up to 0.13 mm long at a 1 mm cone radius, longer on outer
  rings, and run at constant full depth. ADR-285 item 6's 115200-baud planner-window check on the
  recovered `Safe` fixture keeps its 13.8 ms margin, and that program stays under its
  18,000-line budget at 17,769 lines.
- The emitter revision is `vcarve-floor-inside-corners-20261023-v27`.
- Not verified: air-cut, material cut, surface finish or machine behaviour on the extra blocks.
