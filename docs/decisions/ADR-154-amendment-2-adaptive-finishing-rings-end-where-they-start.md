## ADR-154 Amendment 2 - Adaptive finishing rings end where they start (2026-09-27)

**Status:** Accepted; software-verified through compile, G-code and removal-simulation tests,
hardware qualification pending. | **Date:** 2026-09-27

Amends ADR-154's cleanup contours ("each sequence uses a native locally fitted helical entry and
conventional cleanup contours") as ADR-312 item 4 oriented them, and resolves the adaptive half of
the ring-seam defect ADR-289 Amendment 1 recorded as not changed. The Frame-first Start contract
(ADR-228, PROJECT.md non-negotiable 21) is unchanged: nothing here adds a guard, a refusal or a
warning.

### Context

The adaptive planner closes each finishing ring by repeating its first point (`toPolyline`,
`adaptive-pocket-geometry.ts`). Since ADR-312 (2026-08-30), `adaptivePocketPasses` orients the
rings for the requested cut direction with `enforceCutDirection`, which also moves each ring's
start to the middle of its longest segment (`rotateStartToLongestSegment`, ADR-251). Rotating a
ring that is already closed keeps the old closing point as a repeated vertex and ends at the
corner before the new start. The pass went out as a closed contour exactly as listed, and neither
the emitter (`appendCutMoves`) nor the preview's simulator closes a contour pass itself. Every
finishing pass stopped half its longest segment short, at every depth. The adaptive verifier
certifies the planned rings, which are closed, before the rotation, so it never saw the open
passes.

The reproduction was a 30 mm square at 40..70 scene mm on an adaptive pocket layer 3 mm deep at
the default settings (Climb, 1.5 mm per pass, the 3.175 mm end mill). Its finishing pass at Z-1.5
and at Z-3 started at (68.413, 345.000), ended at (68.413, 331.588) and listed that corner twice:
13.4 mm of the wall pass was never cut.

The stock this leaves is small, because the roughing's outermost ring is the same wall ring with
its corners rounded to the cutter radius. On a straight wall it already cuts to the wall. The
dropped span mattered beside the corner before each ring's start: between the corner the
finishing pass still reached and the point where the roughing ring's rounded corner rejoins the
wall, a sliver stood to the stock top. A sharper corner leaves a thicker sliver, because the
rounded corner leaves the wall sooner. The simulator's cutter is rigid; any stock a deflecting
cutter leaves along the dropped span also went without its finishing pass.

The removal simulator the 3D preview uses measured it with the 3.175 mm end mill, 3 mm deep in two
levels. It counts cells within the cutter's reach that stand above the floor. The corners of a
pocket, which no pass reaches, are excluded.

| Pocket | Grid | Each finishing pass stopped short by | Stock left standing |
| --- | --- | --- | --- |
| 30 mm square, default settings | 0.05 mm | 13.41 mm | 30 cells to the stock top, up to 0.13 mm in from the wall |
| 12 mm square, 1.5 mm engagement | 0.025 mm | 4.41 mm | 119 cells to the stock top, up to 0.14 mm in from the wall |
| the same, Conventional | 0.05 mm | 4.41 mm | 30 cells to the stock top |
| the same, Climb on a front-right frame | 0.05 mm | 4.41 mm | 30 cells to the stock top |
| the same, no cut direction | 0.05 mm | 0 | none |
| 30 mm rhombus, seam beside a 60° corner, 1.5 mm engagement | 0.05 mm | 13.17 mm | 153 cells to the stock top, up to 0.42 mm in from the wall |
| triangle 40 mm wide and 35 mm high, seam beside a 60° corner, 1.5 mm engagement | 0.05 mm | 17.40 mm | 148 cells to the stock top, up to 0.43 mm in from the wall |

After this amendment, every pass in the table ends where it starts and no cell is left standing.

### Decision

1. **Every finishing ring ends where it starts.** `adaptivePocketPasses` still orients each
   finishing ring and moves its start to the middle of its longest segment. It now drops the
   repeated old closing point and closes the ring at its new start with `contourPassFromPolyline`,
   as ordinary pocket rings are closed and as ADR-289 Amendment 1 closes relief rings. Start
   points, direction, ring order and depth order are unchanged, and each finishing pass gains
   exactly its closing move. Opening the ring before the rotation would also close it, but it
   moves the start of reversed rings whose segments tie in length, such as a square's four sides.
   That changes output for no benefit.
2. **Rings without a cut direction are unchanged.** They keep the planner's start and closing
   point, which the same code leaves as they are.
3. **Nothing else changes.** The roughing chain, the helical entries, the engagement limit, the
   verifier and Job Review stay as they were.
4. **Emitter revision** advances to `adaptive-finish-ring-seams-20260927-v1`. Every adaptive pocket
   compiled with a cut direction, Climb by default, gains one closing move per finishing pass.

The other callers of `enforceCutDirection` already close their rings again before output.
Ordinary pocket and profile passes and rest roughing use `contourPassFromPolyline`, and the
profile finishing allowance uses its own copy of it. Tabbed profiles walk the closed perimeter in
`tabRampedPoints`. Helical pocket entries re-order each ring to start and end at the helix
(`reorderClosedRing`), and ramp entry walks back to the first point. Relief roughing had the same
defect and ADR-289 Amendment 1 fixed it. `rotateStartToLongestSegment` has no other caller.

### Consequences

- An adaptive pocket's finishing pass cuts the whole wall at every depth, and the sliver beside
  the seam's corner is gone, for either cut direction and on mirrored machine frames too.
- Each finishing pass is longer by half its longest segment, 13.4 mm per pass on the 30 mm square.
- Not changed: the verifier still certifies the planned rings rather than the emitted passes,
  which is how this defect passed it. Checking the emitted passes needs its own decision.

### Verification

- `compile-cnc-adaptive-finish-rings.test.ts` compiles adaptive square pockets through the real
  compiler and emitter:
  - the 30 mm square's finishing passes at Z-1.5 and Z-3 run from (68.413, 345.0005) round the
    square to (68.413, 331.588) and back to (68.413, 345.0005), and the emitted G-code ends each
    with `G1 X68.413 Y345.000` before the retract;
  - on a 12 mm square at 1.5 mm engagement, with Conventional and with Climb on a front-right
    frame, each pass starts mid-way along a side, ends there and repeats no vertex. Without a cut
    direction, the planner's closed rings are kept;
  - the removal simulator at 0.05 mm cells finds no reachable cell of the 12 mm square above the
    floor.

  Against the previous code every case but the one without a cut direction fails: the rings end
  13.4 mm and 4.4 mm short, and 30 cells stand to the stock top.
- The existing adaptive tests pass unchanged. No pinned G-code snapshot holds an adaptive pocket.
- The table's measurements were one-off simulator runs before and after this change. The 30 mm
  square takes about two and a half minutes to simulate at 0.05 mm, too long for the test suite.
- No hardware run was made. ADR-154's hardware status stays CLAIMED.
