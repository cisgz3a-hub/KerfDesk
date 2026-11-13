## ADR-392 Amendment 7 - Tile registration bores miss the parts and the board edge, and seam pieces keep their entry (2026-11-13)

**Status:** Accepted. | **Date:** 2026-11-13
**Fixes:** CNC audit v3 area N4 (`docs/audits/2026-11-13-cnc-v3/N4-transforms-tiling-reach.md`,
confirmed by its refuter):
- **N4-P1-1** (P1; re-raises AC-5 of the 2026-09-24 CNC audit, open since): registration bores
  were drilled through the parts and off the board, with no check, no preview and no warning.
- **N4-P2-1** (P2; re-raises P2-advcam-1 of the 2026-09-29 audit): a piece a tile edge started
  began with a straight plunge, whatever entry its operation asked for.
- **N4-P3-1** (P3): the overlap strip is cut by both tiles, and nothing said so.

Amends ADR-318 Decision 3 (where the registration bores go; their recipe is unchanged) and
ADR-278 Decision 5 (the tiled-ramp notice). The Frame-first contract (PROJECT.md non-negotiable
21, ADR-565) is unchanged: nothing here refuses a save or a Start.

### Context

`tile-registration.ts` put two bores on every seam at 1/4 and 3/4 of the tile's side, in the
middle of the overlap strip. It never looked at the artwork or the stock, and the tile rectangles
run past the job, so the bores landed wherever the seam crossed: through a 390 × 300 blank, in a
sign's lettering pocket, and 123 mm off a 150 mm tall board, into the spoilboard or a clamp. The
holes appeared only inside the tile files; Preview, Job Review and the save said nothing, although
the tiling tutorial tells the operator to compare them with the fixture.

`tile-plan.ts` clipped each toolpath at the tile edge and started the new piece with the
emitter's straight plunge. A helical pocket's helix became sloped `path3d` pieces cut at the
cutting feed (F1000 for an F300 helix), plunging part-way down at each edge. A profile's lead-in
stayed where the loop started, so at every depth level the edge piece plunged onto the cutter line
and marked the finished wall. The one notice covered ramps only and called any of them "Tiled
V-carve output", on jobs with no V-carve.

### Decision

1. **Bores are placed, not fixed** (`src/core/cnc/tile-registration-placement.ts`). For each
   seam, candidate centres are searched along the seam inside the overlap strip (so both tiles
   reach them), inside the tile's own side of the seam (so neither tile file goes outside its
   rectangle along it), and inside the stock less the bore radius plus a 2 mm wall. A centre is
   clear when it is at least the cut's cutter radius + the bore radius + 2 mm from every cut of
   the job, outside every closed cut loop (a part, a pocket or a hole; non-zero winding, so a ring
   ramped round more than once still counts), and a bore's width plus 2 mm from every bore
   already placed. The stock margin at the seam's ends is part of the search. The two clear
   centres furthest apart along the seam win (the strip's middle line first on a tie), so the
   pins square the stock as well as locate it. Adjacent tiles still drill identical stock
   positions.
2. **A seam with too few clear spots is named, not drilled through the work.** No clear spot: the
   seam gets no bore and the tiled save warns "No registration hole fits on the seam between tiles
   r1-c1 and r1-c2 …". One spot: one bore, and a warning that one pin locates but does not square.
   This is a warning, not a refusal: the files are written and nothing is cut where it should not
   be (AGENTS.md; a policy finding stays advisory).
3. **The bores are shown before anything is cut.** Preview draws each planned bore at its true
   size in the registration layer's purple and lists them with any seam warning
   (`src/ui/workspace/preview-tile-registration.ts`; carried on the preview route like the CNC
   fallback notices, so it survives the preparation Worker). The tiled save lists every bore by
   tile, in stock and tile coordinates, and each tile file's header carries a
   `; tile registration hole:` line per bore.
4. **A piece a tile edge starts gets its operation's entry**
   (`src/core/cnc/tile-clipped-entries.ts`):
   - a helical pocket: its helix cannot be cut whole in a tile its circle crosses, so its XY (one
     circle, then the pocket contour) is cut level at the helix depth, and every piece of the
     pocket a tile edge starts ramps in along its own path at the helix's own slope, descending
     at the plunge feed as the helix did;
   - a ramp entry: the piece ramps in at the layer's angle (`rampContourPass`, as untiled);
   - an Outside or Inside profile (default leads): the piece ramps in at 3°, so the cutter is
     moving when it reaches depth and leaves no plunge mark on the wall. A lead arc cannot be
     placed reliably at a tile edge; the layer's own lead stays where the loop starts.
   Each ramp descends from the level this tile has already cut along the same piece, or from the
   stock top. A ring whose stay-down link (ADR-491) was clipped away counts as a new piece. A piece
   too short to ramp keeps its motion and plunge and gets the existing `entryPlunge` marker.
   V-carve detail, tabbed rings and plain-plunge operations keep their plunge as before.
5. **The notices name the operation.** "Tiled V-carve output is derived …" becomes "Tiled
   <operations> ramp entries are derived …", naming only the operations that ramp. The old
   V-carve-only "contour ramp crosses a tile boundary" line becomes two counts by operation: the
   pieces that now ramp in ("3 pieces of pocket (helical entry)") and those that still plunge, the
   latter only for operations that asked for a non-plunge entry.
6. **The overlap repeat is stated** (N4-P3-1, disclosure only). When the strips repeat more than
   1% of the job's cutting length, the tiled save says how many mm run twice and what share that
   is. Assigning each strip cut to one tile is left for later: the repeat cuts air when
   registration is exact.

### Consequences

- A tiled save of a blank cut out to its edges, or of a part that fills every strip, now drills
  no bore on those seams and says so. The operator registers them another way, widens the
  overlap or the stock margin, or changes the tile size so a seam crosses waste. Before, those
  seams were bored through the part.
- Bores stay within each tile's side of the seam along it, so a margin below the job's minimum is
  never used: a tile file never moves behind its own zero to reach a bore.
- Seam entries add ramp length; a helical pocket's seam pieces descend at the plunge feed.
- Tile files change wherever a bore moved or an edge piece now ramps. Untiled output is
  unchanged.

### Verification

`tile-registration-placement.test.ts` and `tile-seam-entries.test.ts` read the written tile
programs with their own G-code reader (`tile-gcode-reader.test-support.ts`) and compiled scenes:
every bore outside the part's cutter line by the cutter + bore radius and wholly on the board (a
390 × 300 blank, a 600 × 300 panel in 3 × 2 tiles, a 1000 × 150 sign with a lettering pocket); a
seam with only the part under it drills nothing and is named; no plunge into uncut stock in a
helical pocket cut through its helix, every descent at the plunge feed; no plunge into stock on a
lead-in profile's cutter line at a seam; the ramp notice names Outside profile, not V-carve. All
seven fail on the code before this amendment. Air-cut and material qualification remain separate.
