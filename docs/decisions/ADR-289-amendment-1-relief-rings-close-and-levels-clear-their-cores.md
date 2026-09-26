## ADR-289 Amendment 1 - Relief roughing rings end where they start, and each level is cleared to its centre (2026-09-27)

**Status:** Accepted; software-verified through unit, compile and removal-simulation tests,
hardware qualification pending. | **Date:** 2026-09-27

Amends ADR-289's roughing planner (items 2 and 7 plan and qualify the waterline rings) and
resolves the two ring-ladder defects ADR-368 Amendment 2 recorded as not changed. The Frame-first
Start contract (ADR-228, PROJECT.md non-negotiable 21) is unchanged: nothing here adds a guard, a
refusal or a warning.

### Context

Fixing tapered ball-nose cut widths (ADR-368 Amendment 2, #937) exposed two defects of relief
roughing's ring ladder. Both affect every cutter.

1. **Rings stopped short of their start.** `reliefRoughingLadder` closes each ring by repeating
   its first point. The compiler then orients each ring for the requested cut direction, and
   `rotateStartToLongestSegment` moves its start to the middle of its longest segment (ADR-251).
   Rotating a ring that is already closed keeps the old closing point as a repeated vertex and
   ends at the corner before the new start. The emitter cuts a contour pass exactly as listed, so
   nothing closed it again: every ring stopped half its longest segment short. The pinned end-mill
   snapshot showed it. A square ring started at `X10.000 Y398.730`, ended with
   `G1 X18.730 Y398.730` and retracted. The levels of a relief share their ring starts, so the
   missed half-sides stacked into stock standing to the stock top.
2. **No core cleanup above 50% stepover.** A level's rings step in from the region boundary until
   the next inset is empty, so the innermost ring can stop up to one stepover from the region's
   deepest point. Above 50%, that is further than the cutter reaches, and the centre stays uncut.
   Rings on an irregular region also leave cusps where an inset's sharp corner outruns the next
   ring's sweep. The pocket planner has cleared both since ADR-098's pocket core coverage
   amendment (2026-09-05); relief roughing had no equivalent.

The removal simulator the 3D preview uses measured both on a 20 mm flat relief 3 mm deep, with
1.5 mm levels, no finishing allowance and 0.05 mm cells:

| Cutter, stepover | Rings that stopped short | Stock left standing |
| --- | --- | --- |
| 3.175 mm end mill, 40% | 16 of 16, up to 8.73 mm short | 4,509 cells to the stock top, all on the half holding the seams |
| Amana 46282 tapered ball nose, 40% (rings 0.69 mm apart) | 30 of 30 | 14,876 cells above the ball's scallop on the seam half, 8,840 of them to the stock top; none on the other half |
| 3.175 mm end mill, 85% | 8 of 8 | 6,114 cells to the stock top, the centre included |
| 6.35 mm end mill, 85% | 4 of 4 | a 2.9 mm core to the stock top: 3,420 cells |
| Amana 46282, 85% | 14 of 14 | 9,824 cells to the stock top, the centre included |

### Decision

1. **Every ring ends where it starts.** The compiler still moves each ring's start to the middle
   of its longest segment. It now drops the repeated old closing point and closes the ring at its
   new start, as `contourPassFromPolyline` closes pocket rings. Ring order, direction and start
   points are unchanged, and each ring gains exactly its closing move. Opening the ring before the
   rotation would also close it, but it moves the start of reversed rings whose segments tie in
   length, which changes output for no benefit.
2. **Each level's leftover stock is cleared after its rings,** whenever the stepover is larger
   than the cutter radius (above 50%). At or below 50%, neighbouring sweeps overlap at every
   corner and the innermost one reaches the centre, so output is unchanged.
   `relief-core-cleanup.ts` subtracts the rings' actual cutter sweep from the level's tool-centre
   region and splits what is left into pieces. Like the pocket planner, it uses a ring bisected to
   a piece's deepest inset or a trace around the piece:
   - a piece whose deepest-inset ring sweeps all of it, such as a core or a cusp, gets that ring.
     At the centre of a level whose rings stop short, it is a loop a few hundredths of a
     millimetre across;
   - any other piece is traced around its boundary. That reaches every point of a piece no thicker
     than the cutter. A thicker piece, which needs a stepover above 100%, is cleared the same way
     in further rounds, each reaching one cutter radius deeper;
   - a piece no thicker than 0.02 mm (twice the bisection tolerance) is a hairline where two
     sweeps just meet, and gets no pass.

   The pocket planner bisects one central ring per region and traces every leftover. Choosing per
   piece gives each piece one pass wherever one reaches all of it, adds nothing where the rings
   already reach a region's centre, and bisects small pieces instead of whole waterline regions.
3. **Order, direction and the safety envelope are kept.** Cleanup paths follow the level's rings,
   before the next level, and the rings keep their outside-in order. The compiler orients, starts
   and closes cleanup paths like every other ring. They lie inside the level's tool-centre region:
   leftover stock is at least one cutter radius inside its boundary, which ring 0 sweeps. So
   ADR-289's dilated-heightmap envelope covers them as it covers the rings. The cleanup reads the
   same cut width as the stepover: the stored diameter, or a tapered ball nose's clearing width
   over one level (ADR-368 Amendment 2).
4. **Failures stay advisory.** A failed sweep, subtraction or grouping marks the level as an
   offset failure. Stock left after the cleanup's round budget (4,096, like the ring ladder's)
   marks it pass-limited. Both reuse the existing Job Review warnings (rule 7). A ladder already
   truncated by its own failure or budget keeps exactly its rings.
5. **Emitter revision** advances to `relief-ring-seams-and-cores-20260927-v1`. Every relief
   roughing ring gains its closing move, and levels above 50% stepover gain cleanup paths.

### Consequences

- Relief roughing no longer leaves full-height stock at the ring seams, or a core above 50%
  stepover, with any cutter. The finishing pass meets only the finishing allowance and scallops.
- Every ring is longer by up to half its longest segment. Above 50% stepover, levels gain cleanup
  passes, each with its own retract and plunge. On a 150 mm square undulating relief with a
  3.175 mm end mill at 85%, 145 roughing passes became 445, and planning took about twice as long
  (roughly 1.3 s to 2.5 s on the development machine). At or below 50%, passes and planning time
  are unchanged.
- A tapered ball nose above 50% still leaves the ball's scallop between rings (0.49 mm at 85%,
  inside the 0.5 mm finishing allowance). The cleanup clears what the sweep at the clearing width
  misses, not the scallop.
- Not changed: relief rings keep the pocket rule's winding, which assumes rings cut from the
  inside out. Relief cuts outside in, so the stock lies on the inner side of each ring, and with
  Climb selected every ring after the first cuts conventional. That needs its own decision.
- Not changed: the adaptive pocket's finishing rings are also closed before the same start
  rotation and never closed again. A 30 mm square adaptive pocket's finishing ring stops 13.4 mm
  short of its start at every depth. That planner needs its own amendment.

### Verification

- `compile-cnc-relief-roughing-coverage.test.ts` compiles 20 mm and 13 mm flat reliefs and stamps
  them with the preview's removal simulator at 0.1 mm cells:
  - every roughing ring ends where it starts, for a 3.175 mm end mill at 40%, Amana 46282 at 40%
    and a 6.35 mm end mill at 85%;
  - the 3.175 mm end mill at 40% and Amana 46282 at 11% leave no cell above the floor;
  - the 6.35 mm end mill at 85% leaves no cell above the floor, and Amana 46282 at 85% cuts the
    centre to the floor;
  - the 13 mm relief at 85% gets its two rings per level and nothing more, and is cleared.

  Against the previous planner all but the last fail: every ring open, 1,122 and 3,081 seam cells,
  801 core cells, the centre at Z0.
- `relief-core-cleanup.test.ts` checks the planner directly:
  - nothing is added at 40% or 50%;
  - at 85%, a 20 mm square gets one ring within 0.02 mm of its centre;
  - at 85%, a 13 mm square gets nothing;
  - at 60%, 85%, 100% and 150%, three regions leave nothing thicker than 0.02 mm, and every added
    path stays inside the region. The regions are a dumbbell whose lobes split, two separate round
    pockets, and a square with a round island.

  With the cleanup disabled, the second and fourth fail.
- `compile-cnc-tapered-ball-layout.test.ts` now measures relief roughing's floor over the whole
  relief, the seam half included. The previous planner fails it with a 3 mm residual.
- The relief roughing G-code snapshot gains exactly one closing move per ring (8 lines), among
  them `G1 X10.000 Y398.730` after `G1 X18.730 Y398.730`.
- No hardware run was made. A physical cut on the 4040 remains the qualification step.
