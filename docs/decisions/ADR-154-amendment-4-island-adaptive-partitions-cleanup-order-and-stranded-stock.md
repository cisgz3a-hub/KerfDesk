## ADR-154 Amendment 4 - Island adaptive pockets: partitions without open-stock crossings, cleanup after the clearing beside it, no stranded stock (2026-10-23)

**Status:** Accepted; software-verified through planner, verifier, compile and independent G-code
height-field tests, hardware qualification pending. | **Date:** 2026-10-23

Amends ADR-154's scope ("Planning is limited to sanitized closed, island-free regions ... islands
... block preflight"), its verifier ("an independent bounded stock-removal verifier must confirm
engagement and at least 98.5% coverage") and Amendment 3's verifier. It records the island planner,
which shipped in the October CNC leaders build (`docs/audits/2026-10-08-cnc-leaders/BUILD.md`, C10)
without a decision of its own, and fixes CNC audit v1 findings F2-P1-1 (raised P1, P2 after
refutation), F2-P2-1 and F2-P3-2 (`docs/audits/2026-10-23-cnc-v1/F2-cnc-pocket-adaptive.md`). The
Frame-first Start contract (ADR-228, PROJECT.md non-negotiable 21) is unchanged: nothing here adds a
guard, a Start refusal or a warning class. As before, the verifier refuses as a compile failure any
plan it cannot certify, and the layer is cut as an ordinary offset pocket.

### Context

ADR-154 limited adaptive clearing to island-free pockets. The island planner
(`adaptive-pocket-islands.ts`) has since planned any pocket with a hole:

- It cut the region into a grid of cells along every island's x and y bounds and planned each cell
  as an ordinary adaptive pocket.
- It cut each cell's innermost ring as a seed slot at the plunge feed, outside the measured
  engagement.
- It added a cleanup ring along every wall and island of the whole region to the last planned
  cell.
- Job Review disclosed it as "Island adaptive uses N verified partitions ... seed slotting and
  final wall cleanup can engage more stock".

The audit and its refuter found two defects, each reproduced with an independent G-code parser and
height field:

1. **Pins at open-stock crossings (F2-P1-1).** A cell's centre region stops a cutter radius short of
   its bounds. Where an island's x bound crossed another island's y bound in open stock, the four
   cells' corners left a pin of stock standing to full depth, 4 r^2 (1 - pi/4) = 0.858 r^2 across,
   that no pass removed. A 100 x 60 mm pocket with two 20 x 15 mm islands and the 6.35 mm bit kept 8
   pins, 68.2 mm^2 in all. The verifier certified it at coverage 0.9874 against the 98.5% target, and
   Job Review was silent.
2. **Cleanup before clearing (F2-P2-1).** The program sorted the sequences by source region after
   verification (ADR-270), so the cleanup ring that rode on the last planned cell could run before a
   nested pocket, or a second pocket on the layer, was cleared. At the defaults, a 60 mm pocket
   holding a 36 mm island holding an 18 mm pocket had its nested wall cut from a straight plunge as a
   full-width slot at the cutting feed, 51.9 mm per depth at up to 173 degrees of contact. The
   verifier simulated the planned order, so it certified an order the program never ran.

### Decision

1. **Partition.**
   - Island pockets are planned as before by cutting the region along the islands' x and y bounds,
     unless two of those cut lines cross at a point of stock that lies on no wall or island.
   - Such a pocket is cut into strips across its shorter side instead: x bounds only when it is at
     least as wide as it is tall, otherwise y bounds only. Each island spans whole strips, so every
     cell corner lies on a wall or an island, where the cleanup rings reach it.
   - Pockets whose cut lines cross only on walls and islands keep their grid unchanged. That
     covers one island, or islands aligned on both axes. The grid is kept because long strips cost
     the default bit its verified plan on small pockets: the 30 mm square with a 10 mm island holds
     0.285 mm at 1/8" in squares, and goes over its limit in 10 x 30 mm strips.
   - Each cell's innermost ring stays a plunge-feed seed slot, unmeasured and disclosed. The
     256-cell budget stays.
2. **Cutting order.** The planner returns its sequences in the order the program cuts them: by
   source region (ADR-270), each region's sequences in planned order. Each cleanup ring goes to the
   last sequence of its own region; a ring whose region no sequence matches goes to the last
   sequence. The verifier certifies that order, and the emitter (`adaptivePocketPasses`) cuts the
   plan as it stands; it no longer sorts.
3. **Verifier.** It simulates the emitted order: each sequence's roughing, then its finishing
   rings. It still refuses engagement above the limit and coverage below 98.5%, as before and
   first, and then also refuses:
   - **Stranded stock.** Any connected patch of reachable stock, touching edge or corner on the
     grid, larger than 0.1 r^2, whatever share of the pocket it is. That is 0.25 mm^2 with the
     3.175 mm bit. A pin is 0.858 r^2. Every certified plan measured below leaves no reachable cell.
   - **Early finishing.** A finishing ring whose centre crosses a stock cell that a later
     sequence's roughing still sweeps, over more than the same area. A finishing ring may still
     cross stock at a sharp corner no roughing reaches. It must not run where clearing is still to
     come. A slot through a pocket not yet cleared crosses stock along its whole length.
4. **Scope of ADR-154, as amended.** Adaptive planning covers closed pockets with islands through
   the partition above, and islands are no longer refused as such. A pocket the planner or verifier
   cannot certify compiles as the ordinary offset pocket, as do curved islands whose cells the bit
   cannot enter. Job Review then lists "Offset pocket fallback:" with the refusal reason
   (`cnc-adaptive-clearing-invalid`). Open contours and invalid parameters still compile no
   adaptive plan.
5. **Emitter revision** advances to `adaptive-island-strips-rest-cores-20261023-v27`, together
   with ADR-153 Amendment 1.

### Consequences

Measured with the verifier, and for the emitted programs with the independent height field
(`program-height-field.test-support.ts`, 0.1 mm cells, which imports no planner or verifier):

| Pocket | Bit, engagement | Before | After |
| --- | --- | --- | --- |
| 100 x 60, islands 20 x 15 at (20,10), (60,35) | 6.35 mm, 0.635 mm | 8 pins, coverage 0.9874, certified | 7 strips, coverage 1, 0.986 mm |
| 80 x 60, 15 mm islands at (15,12), (48,32) | 3.175 mm, 0.794 mm | 8 pins, coverage 0.9959, certified | strips, coverage 1, 0.680 mm |
| 60 x 40, 10 mm islands at (12,10), (36,20) | 4 mm, 0.5 mm | 4 pins, 13.8 mm^2 | strips, coverage 1, no reachable stock |
| 60 / 36 / 18 mm nested squares | 3.175 mm, 0.3175 mm | nested wall slotted before clearing | wall after clearing, 0.498 mm |
| 40 / 24 / 12 mm nested squares | 4 mm, 0.5 mm | 2 straight plunges into stock | none, no full-width cut at feed |

- The engagement column is the largest simulated engagement. The limit and its allowance of one
  cell diagonal are unchanged; the 100 x 60 pocket's 0.986 mm sits just within the 0.989 mm
  allowance.
- One-island and aligned-island pockets plan the same cells as before. The 30 mm square with a
  10 mm island keeps its 8 partitions at 4 mm and at 1/8". The 40 mm square with two aligned 8 mm
  islands keeps its 13 sequences at 4 mm.
- Plain pockets, without islands, are unchanged. Their sequences were already sorted the same way,
  and the plans measured (squares, triangles, a rhombus, a 40 mm circle, two squares) leave no
  reachable cell for either new check to find.
- The verifier's CPU time is unchanged within noise: 18.0 s against 18.6 s for the 360-edge test
  pocket, as a mean of three interleaved runs each.
- Strips are longer than grid cells, so a pocket with open-stock crossings has longer seed slots
  per cell. In the six-design sweep of the audit, the default 1/8" bit fell back to offset rings on
  every multi-island design before this change, and it may still do so; the fallback is disclosed.
- Seed slotting and the whole-region cleanup stay outside the measured engagement, as disclosed in
  Job Review, and the finishing rings stay unmeasured (Amendment 3).

### Verification

- `compile-cnc-adaptive-islands.test.ts` compiles and emits two pockets through the real compiler.
  The independent height field checks two things:
  - The 60 x 40 pocket leaves no reachable stock, and each of its four open-stock crossings is cut
    to depth.
  - The 40 / 24 / 12 nested pocket makes no straight plunge into stock and cuts no full-width
    strip at the cutting feed.
  - Against main both fail: 4 patches, and 2 plunges into stock.
- `adaptive-pocket-verifier.test.ts` refuses two plans:
  - four quadrants that leave a pin at coverage over 98.5%;
  - a plan whose second pocket's wall ring runs on the first sequence.
- The existing planner, verifier, emission, compile and preflight tests pass. The island grid
  expectations (8 partitions, Job Review disclosure) hold unchanged.
- No hardware run was made. ADR-154's hardware status stays CLAIMED.
