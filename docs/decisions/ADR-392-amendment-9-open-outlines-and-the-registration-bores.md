## ADR-392 Amendment 9 - Registration bores keep out of open outlines the tab compiler closes, and name the rest (2026-11-14)

**Status:** Accepted. | **Date:** 2026-11-14
**Fixes:** CNC audit v3 **N8-P1-1** (P1; `docs/audits/2026-11-13-cnc-v3/N8-n7-fix-verify.md`).
**Also records** the CNC P3 sweep's tiling and surfacing items: N4-P3-1 and N4-P3-3. N4-P3-2 is
ADR-433 Amendment 7.

### Context

Amendment 8 found a part's ring by reading the cut's own path. A part drawn as an **open**
outline compiles to a cut whose ends do not meet, so it never forms a ring. The verification
measured bores going through such parts:

| Job | Bores in the part |
|---|---|
| 600 × 300 panel, 3 × 2 tiles | 11 of 14 |
| 500 × 250 tabletop, gaps of 2, 4 and 8 mm | 11 of 14 |
| Ø300 disc | 5 of 8 |

This happened even when the tab compiler (ADR-258 Amendment 7) treats the outline as closed and
Job Review says "the cut frees it like a closed shape". With a gap under the bit's width the cut
does go round the outline, yet the listing said the bores were "outside every outline the
toolpaths go round". Its generic caveat named no outline and no bore.

### Decision

1. **One rule for "effectively closed"** (`src/core/cnc/tile-registration-open-outlines.ts`).
   - The bore keep-out uses the tab compiler's limit, `closedForTabsBelowMm`. An open cut is
     closed when its ends lie closer than the cut width plus the sliver that holds less than one
     tab, and at least 0.2 mm more. That is D + 1.89 mm with the default 6 × 2 mm tabs through
     6.35 mm.
   - The limit is read from the outline's own layer: its tab width, tab height and depth. The
     tiled save and Preview pass the project's layers. Without the layer, the default tabs and
     the group's own depth stand in.
   - Such an outline is kept clear like a part, closed across its gap.
2. **A genuinely open outline that a bore lands inside is named.** Any other open cut that
   encloses more than the bit's own footprint is not known as a part. When a bore lands inside
   it, the tiled save and Preview warn, naming:
   - the layer;
   - the outline's size;
   - how far apart its ends are;
   - each bore inside it, in stock coordinates.

   The warning tells the operator to close the outline (Tools > Join paths) or turn registration
   holes off. Nothing is refused (AGENTS.md).
3. **The listing is true in every case.** Each bore is described as at least the cutter's
   radius, the hole's radius and 2 mm from every toolpath, outside every outline the toolpaths
   go round or nearly close, and on the stock. "Nearly close" means ends closer than the bit plus
   what a tab holds, as tabs count it. Any hole inside another open outline is named in its own
   warning. The generic caveat is gone.
4. **The sweep's other tiling and surfacing items:**
   - **N4-P3-1** (the overlap strip is cut twice): disclosure only. Amendment 7 Decision 6 already
     states the repeated length in the tiled save. **Won't fix** the repeat itself:
     - giving each strip cut to one tile changes every tile's geometry and the seam entries
       (Amendment 7 Decision 4);
     - with exact registration the repeat cuts air.
   - **N4-P3-3** (surfacing reaches past the area): fixed by disclosure. The surfacing panel says
     the bit's edge cuts one radius past every edge of the area, left of and in front of the zero
     corner too. For a 1" cutter that is 12.7 mm. It asks for fences, stops and clamps to stay that
     far out or below the faced depth. Facing to the edge is the usual practice, so the program is
     unchanged.

### Consequences

- A part drawn open within the tab compiler's limit gets its bores kept out of it, as Job Review's
  own line implies.
- A wider-open outline can still have a bore inside it. The tiled save and Preview now name it,
  with the bores.

### Verification

`src/core/cnc/tile-registration-open-outlines.test.ts` reads the written tile programs:
- the limit is D + 1.89 mm for 6 × 2 tabs through 6.35 mm;
- a 600 × 300 panel left open by 2.5, 3.5 and 4.5 mm, On path and Outside, drills bores and none
  lands inside the panel;
- a Ø300 disc whose outline stops 2 mm short keeps every bore outside it;
- a panel left open by 40 mm has bores inside, and the warning names its layer, its 40 mm gap and
  each of those bores.

All seven fail on the code before this amendment.

`src/ui/machine/SurfacingFields.overhang.test.ts` checks the overhang note against the program's
own extents: the bit's centre runs from 0 to the area's width and height.
