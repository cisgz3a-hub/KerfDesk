# CNC audit v3 — ledger

Plan: [AREAS.md](AREAS.md). Severity follows [METHOD.md §3](../2026-10-21-rolling-v2/METHOD.md):
- **P1:** harms a job, loses work or exposes a secret, or lets such a defect reach `main` unchecked. There is no reach clause, and a visible result is not a warning.
- **P2:** a real defect with limited harm. A test gap behind correct code is P2 at most.
- **P3:** structural.

| # | Area | Tree | Report | Raised | Refuted | P1 | P2 | P3 | Known |
|---|---|---|---|---|---|---|---|---|---|
| N1 | J1 refutation and every tab path | origin/main @ 9a0b1a80b (auditor and refuter). The coordinator re-read 3464b48e4: no tab, contour or warning file changed. Both wrote their own G-code reader through the real CNC compile; the refuter measured the material each tab leaves (cross-section, and whether the part is still attached), with J1's oracle as a second reader on six programs (agreement within 0.06 mm²) | [N1-j1-refute-and-tabs.md](N1-j1-refute-and-tabs.md) | 6 | 0 | 2 | 1 | 3 | 5 |
| N2 | Relief and 3D | origin/main @ 9a0b1a80b (auditor and refuter). The coordinator re-read cf13dd4ab: no relief, CNC or warning file changed. The auditor swept 117 relief programs through its own exact heightfield sweep (flat, ball, V, engraver, tapered ball); the refuter used its own 0.04 mm height grid on its own surfaces and measured stock under the bit centre and across its width | [N2-relief-and-3d.md](N2-relief-and-3d.md) | 5 | 0 | 0 | 4 | 1 | 5 |
| N3 | Adaptive pockets, pockets, helical entry and rest | origin/main @ 9a0b1a80b (auditor and refuter). The coordinator re-read 155b76f74: no CNC, warning or geometry file changed. The auditor measured 96 programs from the real Save path with its own G-code reader and a 2.5D grid stock model; the refuter used polygon booleans per Z level and the width each move removes, on 12 programs of its own plus real script fonts | [N3-adaptive-and-pocket.md](N3-adaptive-and-pocket.md) | 5 | 0 | 1 | 2 | 2 | 5 |
| **Total** | | | | **16** | **0** | **3** | **7** | **6** | **15** |

## CNC v2 (J1) findings, now refuted independently

| J1 item | Verdict on main | Fix status |
|---|---|---|
| J1-P1-1 tabs swallow small holes and parts | **CONFIRMED, P1.** Exact threshold: a hole under n·(W+D)/π + D, a part under n·(W+D)/π − D (n tabs of width W, bit D). Defaults: 14.86 mm holes, 8.51 mm parts; with the ¼" bit every hole under 22 mm stays uncut. The warning (`cnc-full-tab-coverage-warnings.ts:76-77`) fires only when a whole layer never cuts below the tab top | proposed in a CNC tabs card |
| J1-P2-1 V-carve at exactly the stock bottom: no warning | **CONFIRMED, P2** (`cnc-compiled-depth-warnings.ts:120`, `warnAtStockBottom` relief-only) | proposed in a CNC depth-warnings card |
| J1-P3-1 a fully tabbed loop re-cut at the tab top per level | CONFIRMED, P3 | P3 sweep |
| J1-P3-2 inlay "Radial fit gap" seats the plug deeper | **Narrowed:** the tooltip has disclosed it since #1418. Still open: a fit gap over glue · tan(half angle) leaves a seam with no note. P3 | P3 sweep |
| J1-P3-3 real 6.35 mm stock reads as never set | CONFIRMED and wider: a 3 mm groove in real 6.35 mm stock also gets 2 mm tab bumps. P3 | **maintainer decision** (changes what a saved thickness means) |

## Confirmed P1/P2 (coordinator-verified)

| ID | Area | Summary | Coordinator evidence | Fix status |
|---|---|---|---|---|
| N1-P2-1→P1 (refuter) | N1 | **Tabs land on corners, and at widths the field allows a part is cut completely free with no warning.** With a cut direction set (default Climb), each loop starts mid-way along its longest edge, so the default 4 tabs sit on or across the corners of squares and near-square rectangles. At defaults the corner tab keeps about 7.2 of 12 mm² (60 %) and still holds by the refuter's load estimate. But a square with 1 mm tabs on the ⅛" bit, or 2.5 mm tabs on the ¼" bit, is cut free; a plate with a square hole loses both the plate and the slug; a 3-tab triangle on the ¼" bit loses a tab even at the default 6 mm. Job Review still lists the tabs, because the program still lifts at each one. "Default direction" holds the same parts. | **READ** on main `3464b48e4`: `motion-polish.ts:74` calls `rotateStartToLongestSegment` for every closed loop once a cut direction is set, moving its start to the longest edge's midpoint; the automatic tabs are then spaced along the perimeter from that start (`cnc-tabs.ts` `splitPassForTabs` → `applyAutomaticTabsToPolylines`). Auditor and refuter **REPRO** (own readers; the refuter's holding cross-section; J1's oracle agrees). | proposed in a CNC tabs card. Fix: keep tabs off corners (place them by arc length away from vertices, or seed them before the seam rotation) and warn when a tab's holding section falls below a floor |
| N1-P2-2→P1 (refuter) | N1 | **An outline that stops 0–3 mm short of its start, cut On path or Outside with Tabs on, is freed with no tabs and no warning.** The same cut with Tabs off warns that the part comes free. SVG import closes a path only when its ends meet within 0.0001 mm, so this is easy to hit (meta audit v1 M6-P1-2 rated near-closed outlines P1). | **READ** on main: `cnc-tabs.ts:129` `splitPassForTabs` returns an open polyline unsplit (`if (!polyline.closed) return [polyline]`), so it gets no tabs, and ADR-258 Amendment 4 limits the Tabs-on warning to closed shapes. Auditor and refuter **REPRO**. | proposed in the CNC tabs card. Fix: give the Tabs-on case the same "part comes free" warning as Tabs off, and consider treating a gap under the bit diameter as closed for tabs. ADR-258 Amd 4's scope needs revisiting |
| N1-P2-3 | N1 | **Default arc leads thin the two tabs beside the seam on small holes** (Ø16: 6.68 mm² against 10.5 with leads off). A lead radius of 4.5 mm or more erases them on a Ø18 hole; the other tabs still held the slug in every probe. Outside cuts are not affected. | Auditor and refuter **REPRO**. | proposed in the CNC tabs card. Fix: keep leads clear of the tab spans, or move the seam between tabs |
| N2-P2-1 | N2 | **A tapered ball, V-bit or engraver finishing a relief cuts the uncut edge band at full depth.** The small-bit step-down (the X6-P2-3 fix) judges the bit by its full diameter, not its tip: a 1 mm-tip tapered ball runs 22–24 mm at Z−2.3, F1000, with 2.3–2.8 mm of stock under its centre; a 0.5 mm tip up to 3.39 mm; the engraver up to 4.3 mm. A plain 1 mm ball gets 3 levels of 0.5 mm. Where levels are planned, the note names "the 3.175 mm finishing bit". | **READ** on main `cf13dd4ab`: `compile-cnc-relief.ts:295-296` passes `nextTool.diameterMm / 2` (the widest cut) as `nextToolRadiusMm`; `relief-roughing-reach.ts:79` `smallNext = nextRadius < stripMm`. Auditor and refuter **REPRO** (independent stock models). Kept P2: the load per pass is 1.2–2.9× a normal pass and nothing is gouged. | routed to the relief session (local_10fcf503). Fix: judge the next bit by its tip (or its effective radius at the band depth) |
| N2-P2-2 | N2 | **Rest finishing with the 1/16" ball after the 1/4" ball cuts the band the big ball left in one pass:** 8.7 mm at Z−4, F1000, 3.76 mm under the centre (2.4× the bit diameter), with no levels or note. A 1.587 mm ball gets 2 levels. A 1/8" rest ball also takes 3.06 mm. The strongest P1 candidate in N2; kept P2 for consistency with X6-P2-2. | **READ** on main: `compile-cnc-relief-rest-step-down.ts:50-56` uses `allowanceMm: 0` on a grid of `finishing.diameterMm / 8`, so `stripMm` = 6.35 / 8 = 0.79375 = a 1/16" ball's radius exactly, and `relief-roughing-reach.ts:79` (strict `<`) treats it as large. Auditor and refuter **REPRO**. | routed to the relief session. Fix: decide "small" from the band the larger tool left (or compare against a stated depth guide), not a tie on the grid cell; a tolerance alone does not cover the 1/8" case |
| N2-P2-3 | N2 | **A relief that leaves a floor 0.001–0.15 mm thick above the stock bottom gets no warning** (3, 6.35, 12.7 and 18 mm stock); only an exact match or a deeper cut warns. A paper-thin floor tears out or lets the part break free. | **READ** on main: `cnc-compiled-depth-warnings.ts:119-120` warns only when `emittedDepthMm > representedStockMm` or, with `warnAtStockBottom`, `===`. Auditor and refuter **REPRO**. | routed to the relief session. Fix: warn when the floor left is under about 0.2 mm (shared with J1-P2-1's V-carve case) |
| N2r-P2-1 (refuter) | N2 | **A 1 mm ball cuts the uncut strip beside an interior wall parallel to the rows at full depth:** 9.97 mm at Z−3.000, F1000, up to 3.0 mm under the centre, while the note says it steps down one Depth per pass. Seen in all four bar positions, with raster + waterline and allowance 0.2. | Refuter **REPRO**; likely cause (READ, not proven): the X6-P2-3 fix keeps the strip only at the relief's outer edge, so a strip beside an island wall is dropped before levels are planned. | routed to the relief session |
| N3-P1-1 | N3 | **A pocket cut to or past the stock bottom frees every island in it, with no warning** (offset, raster, adaptive and rest alike): a 10 mm island, or the counter of a letter "O". The bit then keeps cutting at full depth beside the loose island (541 mm in an offset pocket, 1,837 mm in a two-island adaptive pocket). Pockets have no tabs; Job Review is silent, and past the bottom gives only the spoilboard line. The same loops as an Inside profile with tabs off warn "the part and any hole slugs come free". The Pocket tutorial says "To keep an island…", and ADR-106 Amd 2 assumes a through pocket leaves nothing to hold, which is false with an island. A floor 0.05 mm above the bottom still attaches the island by a skin, which is N2-P2-3's class. | **READ** on main `155b76f74`: `cnc-through-cut-tab-warnings.ts:145` returns no warning unless the cut type is a profile. Auditor and refuter **REPRO** (independent stock models). | proposed in a CNC pockets card. Fix: warn on a through pocket that contains an island (naming it), and offer tabs or a holding floor for islands; revisit ADR-106 Amd 2 |
| N3r-P2-1 (refuter) | N3 | **A pocket on script text leaves every join between overlapping letters as a full-height island** (Pacifico "Hello": 18.7 mm²; Great Vibes "Anna": 10.1 mm²). V-carve and laser Fill handle the same text; the tapered-inlay twin was rated P2 and fixed by merging. The text card's "Weld overlaps" avoids it, but nothing points there. | **READ** on main: `collect-cnc-contours.ts:42-45` merges a text object's overlapping glyphs (`mergeTextObjectContours`) only for `v-carve` and tapered `inlay-pair`. Refuter **REPRO** (real fonts). | proposed in the CNC pockets card. Fix: merge text glyphs for pockets too (or every closed-region cut type) |
| N3r-P2-2 (refuter) | N3 | **A pocket arm, channel or island gap exactly the bit's width is left uncut with no warning**: a 25 mm × 6.35 mm arm stays whole. 0.01 mm narrower gets the "stays uncut" warning; 0.001 mm wider is cut. The minimum-feature check counts width equal to the bit as enterable, while the planner's inset produces no path there. | Refuter **REPRO**. | proposed in the CNC pockets card. Fix: make the check and the inset agree at equality (warn, or cut the centreline) |

### P3s (9, plus J1's three)

- **N1-P3-1:** a shape whose offset splits into two loops gets the full tab count on each loop, and a dragged tab is copied onto every loop.
- **N1-P3-2:** "Edit positions" says it shows the tabs, but it seeds new positions, so one click changes the program.
- **N1-P3-3:** the Tab height tooltip and tutorial say "measured from the cut floor"; with stock thickness set it is measured from the stock bottom, and halved when the tab is as thick as the stock.
- **N2-P3-1:** rest finishing defaults to a 0.05 mm scallop (`compile-cnc-relief-rest.ts:105`), coarser than the 0.025 mm finish it refines; at defaults 27.8 % of cells end more than 0.05 mm above a plain 1/16" finish (worst 0.56 mm). A rest scallop of 0.025 leaves none.
- **N3-P3-1:** island-adaptive cells meet with zero overlap (each finishing ring stops exactly one bit radius from the seam), so a bit 0.01 mm undersize leaves foils on every seam; 6.30 mm leaves 2.94 mm² of 0.05 mm walls.
- **N3-P3-2:** raster pockets above 100 % stepover leave full-depth strips from 105 % (32.9 mm² at 110 %, 100 mm² at 150 %); rest with a smaller bit leaves them standing. Only an out-of-range advisory.
- J1-P3-1, J1-P3-2 (narrowed) and J1-P3-3 (maintainer decision), above.

### Verified clean

- **Tab height** is right everywhere measured: default and set stock, overcut, the half-stock rule, skipped tabs and no-tab warnings.
- **No program** lowers the head into a tab, cuts kept material or rapids into stock.
- **Placement:** ramps, finish allowance and curves place tabs correctly, and manual tabs stay on their anchors under rotation, scaling and mirroring.
- **New-gap search (refuter):** two layers on one shape, long strips, very large parts, a layer with its own bit and finish allowance show nothing.

### N2 verified clean

- **Shape:** across 117 auditor programs and the refuter's own surfaces, no gouge beyond grid error (0.001 mm), every program bottoms out exactly at the relief depth, and nothing is cut outside the footprint.
- **Process:** roughing keeps its full allowance in 3D; scallop on flats and gentle ramps tops out at the stated value; every plunge is at the plunge feed; no rapid into stock.
- **Two-sided:** the halves meet (median 0.02 mm, web 1.00 mm) after stock edits to 12.5 or 18 mm, so F6-P1-1's fix holds; X6's projection fixes hold on new geometry.
- **ETA:** 1.04–1.54× a feed-only lower bound, never under it.
- **Re-observed KNOWN:** F6-P3-1 (the rest-prediction budget fallback now triggers at 20 mm square for 1/4" → 1/16"), K-3 (V-bits and engravers leave the allowance and 1.1–1.9 mm ridges), K-4 / ADR-423, X6-P3-1, K-1.

### N3 verified clean

- **108 programs** (96 auditor, 12 refuter): no kept material cut, nothing below the floor, no rapid into stock, every plunge at the plunge feed, and all reachable stock cleared by offset, raster, adaptive, island adaptive, helical, ramped, and legacy and stock-aware rest. ETA 1.02–1.27× a lower bound, never under it.
- **F2 fixes hold** (F2-P1-1, F2-P2-1, F2-P2-2, F2-P3-2).
- **Re-observed KNOWN:** AC-6 (at the default 10 % the median removed width is at or below the limit; 99 % of the path within 0.69–2.07 mm against 0.635 mm; not re-rated); JR-4 / F3-P3-4 (a helix on an island pocket, raster pocket or 6–6.4 mm hole refuses the layer, and the message says why); F2-P3-1, AC-2, V6-P3-2, CNG-T05, J1's V-bit pocket ribs.
- **Maintainer decision (from ADR-154 Amd 3, never taken):** at 50 % radial engagement the verifier accepts full-width slots at the cutting feed (92.5 mm on an L, 22.4 mm on a 44 × 30 rectangle).

### Not verified

- A physical strength test; the load estimate for corner tabs is arithmetic.
- V-bit profile, relief-projection, tiled and multi-tool tabs (tiling read only).
- Machine runs on the simulator (N5) and the rendered Job Review dialog.
