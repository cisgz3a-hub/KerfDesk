## ADR-412 Amendment 2 - A relief is carved inside its own footprint (2026-10-26)

**Status:** Accepted. | **Date:** 2026-10-26

### Context

ADR-412 decides how high the cutter must stay over a relief's surface. It said nothing about the
relief's edge, and the dilation (`heightmap-tool-offset.ts`) ignored every kernel offset past the
map: "Out-of-bounds neighbors are ignored (treated as bottomless)". A cutter centred on the map's
last sample could therefore descend to that sample's depth with a whole radius hanging past the
footprint. `compile-cnc-relief.ts` plans each relief alone, so nothing else stopped it either.

The 2026-09-29 CNC second pass recorded it (P2-relief-rough-3, Medium). Later rounds only re-filed
it as KNOWN (rolling v2 16 K-2, CNC v1 F6), and the meta audit of 2026-10-23 raised it to P1
(M7-P1-1), with an independent refuter repro:

- Two 24 x 24 mm reliefs 1 mm apart, a 3 mm deep floor and a border kept at the stock top, a
  1/4" end mill at 1.5 mm per pass: the floor's outer ring rode X 124, the floor's own edge, and
  cut 2.175 mm into the border at Z-1.5 and Z-3. Default settings (0.5 mm allowance) gave the same
  2.175 mm. Putting the reliefs on two operations changed nothing.
- The floor alone cut 3.175 mm past its own edge into bare stock.
- Job Review, preflight and every CNC job warning said nothing.

### Decision

1. **The outside of a relief map is stock at the stock top.** Whatever lies past the map's
   physical edge (bare stock, a neighbouring relief on any layer or operation, a part the job
   keeps) is treated exactly like an excluded mask cell (ADR-484): a cutter whose axis stands `d`
   from it keeps its tip at `CNC_MASK_EMISSION_Z_CLEARANCE_MM - dz(d - uncertainty)` or above,
   capped at the stock top as every tip is. `heightmap-outside-stock.ts` measures `d` to the map's
   physical rectangle, so a shortened terminal cell needs no special case, and the dilation applies
   it to every sample (`dilateHeightmapByTool` and `dilateHeightmapByToolWithMaskEvidence`), before
   the exact surface contact. Roughing, ADR-450 flat levels, raster and waterline finishing, rest
   finishing and projection all read that dilation, so all of them stop at the footprint. The
   widened roughing kernel covers ring paths beside the edge as it covers them beside a mask
   (ADR-412 item 3): the roughing cutter keeps the allowance plus the contour clearance off the
   footprint's edge. A tip with the outside in reach is stored on the stock-safe side of Float32
   rounding, as a masked tip already was; one rounded a hundred-millionth of a millimetre deep
   made the exact move check below lift a sample it had no need to.
2. **Every finishing move is checked against it.** `createMaskStock` now models the outside as four
   strips past the map's sides, beside any excluded blocks, and returns a stock for an unmasked map
   too. Each straight move is checked against each strip in reach exactly, as against a block
   (`relief-mask-stock-move.ts`), and is split and lifted where it would dip in. The outside's
   requirement is capped at the stock top: a tip at Z 0 cannot cut stock whose top is Z 0, and
   without the cap every unmasked raster row beside the edge would be lifted an output quantum into
   the air. The unmasked raster, which had no such check, now runs it on every row and link
   (`relief-finishing.ts`), as the masked raster, the waterline and projection already did.
3. **Overlapping reliefs are named in Job Review.** With 1 and 2 no relief cuts past its own
   footprint, so reliefs side by side never cut each other. Where two footprints overlap, though,
   each relief is still carved to its own surface across its whole footprint, and each cut reaches
   into the other there. `detectCncReliefPlanningWarnings` warns for every pair of reliefs on output
   layers whose placed footprints overlap, on the same or different operations, and names both and
   their layers. It is a warning only (rule 7); KerfDesk does not pick one surface over the other.
4. A part the job keeps on another operation (ADR-250 Amendment 3) needs nothing further. A relief
   normally sits inside the part it is carved into, and with 1 and 2 its cuts never leave its own
   footprint, so they cannot reach a kept part beside it.

### Consequences

- The footprint's edge is now a wall. A relief whose edge is deep is carved like a pocket: the
  roughing bit keeps the allowance plus the contour clearance off the wall, and a ball finishes the
  floor up to the wall's foot, leaving its own radius as a fillet there. To clear stock round a
  relief, draw that clearing as its own operation or make the relief larger. A relief whose edge
  is at the stock top, the usual depth-map border, cuts as before except for tips a fraction of a
  cell higher right at the edge.
- Measured through `emitGcode` on the audit's scenes (24 x 24 mm reliefs, a 3 mm floor, the border
  1 mm away, a 1/4" end mill at 1.5 mm per pass), with every feed move walked in 0.02 mm steps by
  the independent drop-cutter model in `emit-gcode-cnc-relief-footprint.test.ts`. "Past its
  footprint" is how far the cut below the stock top reaches past the footprint of the relief the
  bit's axis stands over; negative stays inside.

  | Case | Main (79720dd5c) | This amendment |
  |---|---|---|
  | One operation, 0 allowance, roughing only | 3.175 mm past, at Z-1.5 and Z-3 (2.175 mm into the border) | 0.794 mm inside; the floor is cut at Z-3 to 0.794 mm from its wall |
  | Two operations, default allowance, 1/8" ball finish | 3.175 mm past | 0.0008 mm inside (the ball rides the edge); finished at Z-3 to 0.10 mm plus the ball's radius from the wall |
  | The floor alone, ball finish | 3.175 mm past, into bare stock | 0.0008 mm inside |

- A deep-edged relief's finishing grows: each row now rides up the ball's profile at both ends,
  and the move check splits the chords between samples that would dip past the edge. The 24 mm
  floor's ball finish went from 88 to 3,235 cutting moves.
- Tests: `heightmap-outside-stock.test.ts` pins the outside law, including a shortened terminal
  cell; `relief-mask-stock.test.ts` checks the strips' tip and move checks; the dilation reference
  (`heightmap-tool-offset-test-reference.ts`) carries the same rule, written independently;
  `emit-gcode-cnc-relief-footprint.test.ts` compiles the audit's scenes through `emitGcode` and
  walks every emitted feed move with an independent drop-cutter model (flat and ball profiles):
  no cut below the stock top may reach past the footprint its axis stands over. It also checks
  that the floor is still cut to its wall, and that only overlapping reliefs are reported. Run
  against main's planner it fails at 3.175 mm.
- Existing relief tests that leaned on the bottomless edge keep their subject: one-row strips
  became strips tall enough for a middle row, roughing coverage is counted inside the wall band,
  the waterline tests judge the contours round their feature (and one pins the new edge wall),
  and the pyramid ring-order test stands its pyramid on a plate. The roughing G-code snapshot
  changed accordingly.
- Qualification is unchanged otherwise: emitted vertices and finishing moves clear the outside
  exactly; roughing's contour vertices clear it through the widened kernel; holder and shank
  clearance keep ADR-289 and ADR-294's boundary.
