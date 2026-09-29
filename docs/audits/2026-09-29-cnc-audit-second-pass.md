# KerfDesk CNC audit, second pass (2026-09-29)

A second full pass over the router side of KerfDesk. It rechecks every finding from the [first audit](https://github.com/cisgz3a-hub/KerfDesk/blob/main/docs/audits/2026-09-24-cnc-full-audit.md) and audits everything that changed since 24 September. Every new finding was reproduced or traced to the code and is backed by a cited source.

- **Checked:** main at 2f6f84de, 29 Sep 2026, against 490708c
- **Machine:** Neotronics 4040 Max, GRBL 1.1
- **Controller model:** GRBL 1.1h parser and planner built from source
- **Fixes:** [Draft PR #1019](https://github.com/cisgz3a-hub/KerfDesk/pull/1019)

## Verdict

The router side is in better shape than on 24 September. Of the 51 first-pass findings, 12 are fixed on main, 10 are partly fixed and 28 are still open; this pass fixes one more. The critical one (Resume with laser mode on) and the laser-mode warning are fixed, the bit-change park now moves with the job, and depth passes rapid down only into air an earlier pass has cut. More than 180,000 emitted lines went through the real GRBL 1.1h parser with no error, and none of the 73 rapid descents below the stock top ends inside stock.

The new work brought new gaps. The park height added on 26 September is never compared with the Z travel. Tabs vanish on sheet no thicker than the tab. A small hole or slot next to a finish allowance is cut in one full-depth pass. STL reliefs lose raised detail thinner than a roughing cell. The Inspector warns about KerfDesk's own multi-pass programs, and surfacing on the 4040 is seeded at a feed that rubs.

The draft PR fixes ten defects, listed below. The rest need a larger change or a decision, and each one says what I would do.

New findings: 28 (3 high, 14 medium, 11 low); 9 fixed in PR #1019, 1 partly, 18 open. First-pass findings: 12 fixed on main · 1 fixed in PR #1019 · 10 partly fixed · 28 still open.

## What this means for the 4040 losing position

**Laser mode left on ($32=1)** was the strongest suspect. It is now handled: Job Review opens its warning list for any router `$32` problem, names all three effects, offers a one-click `$32=0`, refuses to write `$32=1` on a router project, and Resume says plainly that it restarts with no spin-up (JR-1, MC-1, ADR-180 Amendments 5 and 6).

**Z driven into the top of its travel** had one route on 24 September (a deep job) and gained a second: the park height (ADR-491) lifts Z before every bit change and at the job end. Nothing compared either with the Z travel. The draft PR now shows the park height in Job Review and warns when the job's deepest cut plus its highest lift is longer than the travel (`$132`, or the machine profile's value), naming the lift to lower (P2-gcode-1, JR-3). The 4040 has no homing switches, so this static check is the one that applies to it. The live check for homed routers is P2-control-1.

**A touch-off with the clip off** is still open (MC-2): probing still seeks 25 mm down blind and never reads the probe input.

**A bit-change park past the end of travel** is fixed for a configured park (CO-1, ADR-392). With no park set, a homed Absolute job still parks at program X0 Y0, which is the homing-switch corner; that does not apply to the unhomed 4040.

Next step, unchanged: send the `$$` output from the 4040, and say whether the drifting job changed bits.

## Fixed in PR #1019

1. P2-toolpath-1: A small hole or slot that only the finishing pass reaches is cut down the layer's depth passes instead of in one full-depth plunge. ADR-140 Amendment 1.
2. P2-toolpath-2: Holding tabs are kept when the tab is as thick as the stock, cut half the stock thick, and Job Review names only the tabs the compiled passes cut. ADR-258 Amendment 4.
3. P2-relief-rough-1: STL reliefs are planned from each cell's highest point, so thin raised detail survives roughing and walls keep the allowance. ADR-412 Amendment 1.
4. P2-gcode-1: Job Review shows the park height and warns when a job's Z range is longer than the Z travel; this also closes the Z-travel half of JR-3. ADR-491 Amendment 1.
5. P2-preview-1: The Inspector no longer calls KerfDesk's own descents into already-cut air rapid plunges, and only a feed into the work counts as cutting before the spindle starts (WA-5). ADR-255 Amendment 1.
6. P2-review-1: "Use last machine" and a profile import bring the saved machine's router settings (safe Z, spindle maximum, max feed, park) into the job.
7. P2-review-2: Surfacing starting values no longer take the 4040 starter's 300 mm/min cap, which is meant for a 1/8" bit.
8. P2-review-4: Machine-limit advisories compare only the recipes the job runs, and every advisory names its layer (also P2-advcam-2). ADR-457 Amendment 2.
9. AC-7: Surfacing refuses a stepover above 100%, which left strips of the old surface standing.
10. P2-toolpath-4: The narrow-feature warning checks a V-bit, ball nose or tapered bit against the width it cuts at the layer's depth. ADR-433 Amendment 1.

## What I need from you

- The `$$` output from the 4040, so $20, $21, $22, $32, $110-$112, $120-$122 and $130-$132 are known instead of assumed.
- Whether the job that drifted changed bits, and what the park height was set to at the time.

## Fix these next

1. MC-2: Read the probe input (`Pn:P`) before a touch-off, and refuse to start the seek when it is already closed or never closes on a test touch, so a forgotten clip cannot drive the bit into the plate.
2. P2-control-1: On a homed router with a live work offset, warn when the park height or safe Z would lift Z above machine zero.
3. P2-preview-2: Draw the park lift, the bed park and the bit-change visits in the preview from the placed job, as the program runs them.
4. P2-relief-rough-2: Keep ball and tapered-ball roughing to the Depth per pass by choosing each level from the ridge the last one left.
5. P2-relief-rough-3: Plan the reliefs of one layer against their combined height, so one relief's roughing cannot cut into its neighbour.
6. P2-toolpath-3: Drop exact stacked copies of a closed shape before the even-odd step, or warn that they will not be cut.
7. P2-relief-finish-2: Space the finishing rows of V-bits, engravers and end mills from the requested scallop, or give them their own stepover and say what ridge they leave.
8. P2-relief-finish-3: Import an STL at its own size and depth in millimetres, as ADR-125 Amendment 1 already says for every other import.
9. TP-5: Keep automatic tabs off corners and at least one bit diameter from relieved box corners (also P2-advcam-3).
10. AC-2: Make adaptive clearing accept ordinary rectangles, and fix the engagement check that lets a full-width slot through at 50% (AC-6).

## Toolpaths

Depth passes, tabs, nesting and what gets cut.

### P2-toolpath-1: With a finish allowance, a small hole or slot was cut in one full-depth plunge

**High** · Fixed in PR #1019 · Reproduced

*Present since finish allowance was added (ADR-140); the same on 490708c.*

On a profile layer with a finish allowance, a hole or slot whose width lies between the bit diameter and the bit diameter plus twice the allowance loses its roughing path but keeps its finishing path. Finishing is always one pass at full depth (ADR-140). So that feature got one plunge to full depth and a full-width cut at the cutting feed, and the layer's Depth per pass was ignored. Nothing warned.

Ordinary job: a 40 mm part with a 4 mm screw hole or a 3.8 mm slot, cut 6.35 mm deep at 2 mm per pass with a 1/8" bit and a 0.5 mm allowance. That pass is 200% of the bit diameter. With a 1/4" bit the window is 6.35 to 7.35 mm, which includes an M6 clearance hole. When such a hole was alone on its layer, the whole layer was dropped instead.

**Fixed in PR #1019.** A finishing path that roughing never reached now follows the layer's depth passes, at the same Z levels the roughing uses. Every other finishing path stays one full-depth pass, so a part's outer wall is unchanged while the small hole in it is stepped down. A layer where only finishing leaves a path is cut instead of dropped. [ADR-140 Amendment 1](https://github.com/cisgz3a-hub/KerfDesk/blob/claude/cnc-audit-te9azb/docs/decisions/ADR-140-amendment-1-finish-only-features-follow-the-depth-ladder.md), commit [d30f02b91](https://github.com/cisgz3a-hub/KerfDesk/commit/d30f02b91).

**Evidence.**

- `finish-allowance.ts:48-60` built the finishing pass for every part even when its roughing was empty, and `:104-107` set `depths = [zMm]` unless a Wall finishing recipe existed.
- Probe on main: `plunges: … L103 Z3.81->-6.35, L199 Z3.81->-6.35; deepest cut -6.35; grbl 0; preflight []`. The 3.8 mm slot: `first vertical entry L103 Z3.81->-6.35 F300`, then `G1 X128.413 Y279.688 F1000`.
- In the PR, `finish-allowance-ladder.test.ts` cuts the 4 mm hole at Z-2, -4, -6 and -6.35 while the outer wall keeps its four roughing passes and one finishing pass at Z-6.35. A 16 mm hole keeps its single finishing pass, and a 3 mm hole still produces nothing. The hole, slot and alone-on-its-layer cases fail without the fix.

**Sources.**

- [Shapeoko CNC A to Z: Feeds and speeds basics](https://shapeokoenthusiasts.gitbook.io/shapeoko-cnc-a-to-z/feeds-and-speeds-basics): "10% to 50% of the endmill diameter for softer materials"
- [Harvey Performance: Speeds and Feeds 101](https://www.harveyperformance.com/in-the-loupe/speeds-and-feeds-101/): "A chip load that is too large can pack up chips in the cutter, causing poor chip evacuation and eventual breakage."

### P2-toolpath-2: Tabs vanished when the stock was no thicker than the tab, and Job Review still listed them

**High** · Fixed in PR #1019 · Reproduced

*Regression from 79677497 (ADR-258 Amendment 3), which fixed TP-1.*

With Stock thickness set and a tab at least as thick as the stock, a through cut or overcut got no tabs at all. That covers the default 2 mm tabs on 2 mm or thinner acrylic, plywood or aluminium sheet, and 3 mm tabs on 3 mm stock. Amendment 3 measures a tab from the stock bottom, and the pass builder keeps a tab only when the cut goes deeper than the tab top, which holds only while the stock is thicker than the tab. On 490708c the same overcut kept its tabs, thinner than set.

Job Review still said "tabs 4 per shape (6 × 2 mm) above the stock bottom". The only warning was the spoilboard note, with its tab sentence left out, and a cut exactly as deep as the stock got no warning at all. The part breaks free on the last pass. A related slip: the overcut note was built from the layer settings, so it told an open on-path line "Its holding tabs stay 2 mm thick above the stock bottom", though open paths never get tabs.

**Fixed in PR #1019.** A tab at least as thick as a set stock is now cut half the stock thick, standing on the stock bottom at any cut depth: 2 mm tabs on 2 mm sheet become 1 mm bridges, and 3 mm tabs on 3 mm stock 1.5 mm. Job Review and the overcut note now read tabs from the compiled passes and say when a tab was thinned, for example "tabs 4 per shape (6 × 2 mm) above the stock bottom, thinned to 1 mm (half the 2 mm stock)". An open line no longer claims tabs, and a through cut whose tabs cannot be cut warns. [ADR-258 Amendment 4](https://github.com/cisgz3a-hub/KerfDesk/blob/claude/cnc-audit-te9azb/docs/decisions/ADR-258-amendment-4-tabs-no-thinner-than-the-stock-are-halved.md), commits [94336cd87](https://github.com/cisgz3a-hub/KerfDesk/commit/94336cd87) and [67630f1fd](https://github.com/cisgz3a-hub/KerfDesk/commit/67630f1fd).

**Evidence.**

- `cnc-tabs.ts:47,73-80` (tab height handed to the pass builder as tab + depth - stock); `cnc-through-cut-tab-warnings.ts:53-56,94-96`; `job-review-detail-facts.ts:332-338`.
- Probe on main, bridges read from the stock left along the kerf line: `TAB stock2-depth2.3-tab2: bridges 0`; `TAB stock2-depth2-tab2: bridges 0` with no warning; `JRLINE stock2 depth2.3: … tabs 4 per shape (6 × 2 mm) above the stock bottom`. On 490708c the same job left 4 bridges 1.7 mm thick.
- In the PR, the same independent stock model on the emitted G-code finds 4 bridges 1 mm thick for 2/2.3/2 and 2/2/2, 0.75 mm for 1.5/1.7/2 and 1.5 mm for 3/3.2/3 (stock/cut/tab in mm). The control 3/3.3/2 is byte-identical. Seven compile tests and four Job Review tests fail without the fix.

**Sources.**

- [Easel: How To Use Tabs](https://support.easel.com/hc/en-us/articles/360012453214-How-To-Use-Tabs): "When you are cutting out a design entirely from your material, there is a risk that your design will break free and become damaged by the bit."
- [Easel: Additional Depth](https://easel.com/features/additional-depth-cut-throughs): "This is compatible with tabs and will not affect tab position or height."
- [ADR-258 Amendment 3, consequences](https://github.com/cisgz3a-hub/KerfDesk/blob/main/docs/decisions/ADR-258-amendment-3-tabs-stand-on-the-stock-bottom.md): "Cutting a little deeper to be sure of a clean through cut no longer weakens or removes tabs, as long as Stock thickness is set."

### P2-review-3: Quick Nest's default 2 mm spacing leaves CNC parts joined

**Medium** · Open · Reproduced

*Not a regression; ADR-433 now warns about it after the nest.*

In CNC mode Quick Nest packs parts 2 mm apart, using the default Part spacing and the workspace as the sheet. A 1/8" bit cannot fit in a 2 mm gap, so the two outside profiles merge into one path around both parts. The web between them is never cut, and the parts come off as one piece joined along the whole shared side. Job Review does warn, but only after the nest has been made.

**Fix.** In CNC mode, default Part spacing to the largest output bit's diameter plus a margin, and offer the stock as the sheet (gap-audit item CNG-J03).

**Evidence.**

- Nest `{"ok":true,"packedUnits":2,…}` gives "gap between nested parts: 2.000 mm". Outside profiles 2 mm apart, 6 mm through, 1/8" bit: `tool-centre samples inside the gap: 0`, with or without a lead.
- Job Review afterwards: `Layer "Operation": 1 gap between cut shapes or lines narrower than the 3.17 mm bit (Audit 3.175 end mill) — the bit cannot fit into it, so it stays uncut; narrowest 2 mm at X 141 · Y 300 mm.`
- `QuickNestDialog.tsx:11` `useState('2')`; `nest-actions.ts` takes no bit input and its bins are only `'workspace' | 'board'` (:22).

**Sources.**

- [ToolsToday: How to nest in Vectric VCarve](https://toolstoday.com/learn/how-to-nest-in-vectric-vcarve-a-step-by-step-workflow): "Your nested spacing must account for: the actual cutter diameter, tool deflection, machine accuracy, material movement, safe chip evacuation."

### P2-toolpath-3: A closed shape stacked exactly on its copy is never cut, with no warning

**Medium** · Open · Reproduced

*Present before the first audit.*

Two identical copies of a closed shape can end up on a profile or pocket layer: Duplicate without moving, a second import, or an SVG with doubled paths. The compiler fills closed shapes even-odd before offsetting, so the two copies cancel and neither is cut. With other shapes on the layer, the job runs normally and leaves that part in the sheet. Three copies are cut (an odd count).

ADR-433's narrow-feature check deliberately merges exact stacked copies, so it says nothing either. Alone on its layer, the loss is reported as an empty layer.

**Fix.** Drop exact stacked copies before the CNC even-odd step, using the same key as `StackedOutlines`, or warn "N shapes are stacked copies of another and will not be cut".

**Evidence.**

- `kerf-offset.ts:64` runs `normalizeClosedPolylineTreeEvenOddChecked`. `stacked-outlines.ts:1-5`: "Imports often carry the same outline twice… filled even-odd the copy cancels its twin … so the check keeps only the first copy".
- Probe (6 mm stock, 6.3 mm cut): `DUP2 A+A+B profile-outside: A kerf(98.4,120) 0, A centre 0, B kerf(158.4,120) -6.3; preflight []`. As a pocket: A centre 0, B centre -6.3. With three copies of A, A is cut.

**Sources.**

- [ADR-359 item 3](https://github.com/cisgz3a-hub/KerfDesk/blob/main/docs/decisions/ADR-359-burn-grid-area-resampling-and-raster-energy-advisories.md): "Duplicate-then-nudge, a second import or a kept old trace leaves several copies on output operations"

## 3D relief

Relief roughing and finishing, STL import and the Design preview.

### P2-relief-rough-1: STL reliefs were read at cell centres, so roughing cut away thin raised detail

**High** · Fixed in PR #1019 · Reproduced

*Mesh rasterizer from ADR-098 (Phase H.4); ADR-412 did not cover it.*

Every STL import becomes a mesh relief. Roughing turns the mesh into a grid one eighth of the bit wide, 0.79 mm for a 1/4" end mill, and each cell took the mesh height at its centre only. A raised detail narrower than a cell that held no cell centre did not exist for the planner, so the end mill cut straight through it. Walls that fell between centres were approached closer than planned. Depth-map reliefs were already safe, because each of their cells takes the highest pixel under it.

Ordinary job: an STL relief with fine raised lines (stems, lettering strokes, borders under about 0.8 mm) roughed with a 1/4" end mill. Roughing removes the detail, and finishing cannot put it back. The same sampling let the finishing ball shave the top edge of every sharp wall (P2-relief-finish-1).

**Fixed in PR #1019.** Relief roughing and finishing now read each cell of an STL relief at the mesh's highest point over the whole cell, as depth-map reliefs already did. Previews, the 3D view and STL import keep centre sampling. On the audit's part the 0.4 mm rib keeps the full 0.5 mm roughing allowance instead of losing 3.5 mm of its 4 mm height, boss walls are no longer cut, and the hemisphere finish no longer cuts into the model. The cost is a thin extra skin on smooth STL slopes: a median of 0.06 to 0.16 mm with a 1/8" ball at 0.025 mm scallop, and 0.12 to 0.32 mm with a 1/4" ball at 0.05 mm. A finer scallop reduces it. [ADR-412 Amendment 1](https://github.com/cisgz3a-hub/KerfDesk/blob/claude/cnc-audit-te9azb/docs/decisions/ADR-412-amendment-1-relief-cam-reads-each-mesh-cell-at-its-highest-point.md), commits [62fc267a3](https://github.com/cisgz3a-hub/KerfDesk/commit/62fc267a3) and [973ce74c7](https://github.com/cisgz3a-hub/KerfDesk/commit/973ce74c7).

**Evidence.**

- `triangle-raster.ts:4,143` ("cell value = MAX over all triangles" covering the cell centre); `compile-cnc-relief.ts:55,340` (roughing cells of tool diameter / 8). `heightfield-to-heightmap.ts:308` makes "One coarse CAM cell represent its whole overlapping source footprint" for depth maps.
- Probe on main, 40 × 40 mm STL, 6 mm deep, 0.4 mm ribs 4 mm tall, 1/4" end mill, 0.5 mm allowance: the rib that holds no cell centre gets `nearest cutter approach -3.1750 mm (CUT INTO) at line 223 tool (126.392,213.488,-5.500)`, 231 gouge samples. The same part as a 0.1 mm depth map: 0 gouges.
- In the PR: roughing clearance on that rib goes from 0 to the full 0.5 mm; the nearest approach anywhere is 0.455 mm at a rib corner. Wall tops on a finished boss at 8 sub-cell offsets go from 0.18-0.35 mm cut to 0.04-0.18 mm. Both new CAM tests fail with centre sampling. An 80 × 60 mm STL compiled in 6.5 s instead of 7.8 s (one run each).

**Sources.**

- [OpenCAMLib drop-cutter: pointdropcutter.cpp](https://github.com/aewallin/opencamlib/blob/95b036fe28ce6d77c97b98e5fbc337904ae49560/src/dropcutter/pointdropcutter.cpp#L68-L73): "if ( cutter->overlaps(clp,*it) ) { // cutter overlap triangle? check"

### P2-relief-finish-1: Finishing cuts into sharp STL walls by up to a finishing cell, and Job Review never gives the resolution

**Medium** · Partly fixed in PR #1019 · Reproduced

*Cell-centre sampling from ADR-098 (H.4/H.8); the finishing half of AC-3.*

ADR-412 makes the finishing ball exact against the triangles between samples, but a vertical wall between two samples becomes a sloped chord one cell wide. The chord lies inside the true wall near its top and outside it at the foot, so the side of the ball shaves the top of the wall and stays too far from the foot. A finishing cell is 0.28 mm for a 1/8" ball at 0.025 mm scallop and 0.56 mm for a 1/4" ball at 0.05 mm.

On a boss with vertical walls the ball cut 0.31 mm into the true part (0.55 mm with a 1/4" ball). The half cell between a relief's edge and its outermost samples has no modelled surface at all. Job Review says nothing about the finishing resolution.

**Done in PR #1019.** The footprint sampling of P2-relief-rough-1 halves the wall error. On the boss at 8 sub-cell offsets, wall tops were cut 0.18 to 0.35 mm before and 0.04 to 0.18 mm after, and the hemisphere is no longer cut.

**Still to do.** Take finishing contact from the STL's own triangles, as a drop cutter does, model the half cell at the relief's edge, and state the finishing cell size in Job Review, for example "walls and edges finer than 0.28 mm may be cut or left by up to one cell".

**Evidence.**

- Boss probe, deepest cut into the true part: 1/8" ball 0.3075 mm (raster) and 0.1487 mm (raster and waterline); 1/8" end mill 0.2633 mm; 1/4" ball up to 0.5478 mm. Against the sampled model the ball stays within 0.0022 mm, so the planner does what ADR-412 promises and the error is in the sampling.
- Corpus job c27: the sliver shaved off the top of the plateau wall is at most 0.17 mm thick, and finishing makes all of it. Relief edge: 0.2618 mm below the true surface in the outer half cell, against 0.0273 mm inside the samples.
- `cnc-relief-planning-warnings.ts:65-77` notes only the finishing stage; the grid size appears only above the 4M-cell advisory (`:94-104`).

**Sources.**

- [ADR-412](https://github.com/cisgz3a-hub/KerfDesk/blob/main/docs/decisions/ADR-412-relief-cutter-meets-the-surface-between-samples.md): "a sharp convex crease between two samples is replaced by a chord below it, and the cutter can only be exact against the surface it is given. A finer grid is the remedy there"

### P2-relief-rough-2: Ball and tapered-ball roughing can cut up to about twice the Depth per pass

**Medium** · Open · Reproduced

*ADR-368 Amendments 2 and 3 (cut width at depth).*

For round tips, roughing rings are spaced, and cores judged reached, by the radius at which the tip cuts one pass deep. Between rings and at ring corners the tip leaves ridges up to one pass tall, and the next level cuts the ridge plus its own pass. A 1/4" ball set to 2 mm per pass cut 2.66 mm at 40% stepover and 3.94 mm at 85%. This contradicts ADR-368 Amendment 2 item 4, "Each level removes at most one depth per pass". End mills are not affected.

**Fix.** Choose the next level's depth for round tips from the ridge left above it, or space rings and judge cores by the width that keeps ridges to a small fraction of the pass. Until then, say in Job Review how deep ball or tapered roughing can actually cut.

**Evidence.**

- Bench relief 60 × 40 × 10 mm as a 0.1 mm depth map, worst lateral cut against the pass: 1/4" ball 2.0 mm at 40% gives 2.66; at 85% 3.94; 1/8" ball 1.5 mm at 40% gives 2.02; Amana 46282 tapered ball 1.5 mm gives 1.78.
- Traced cell (174.38, 255.57), 1/4" ball at 40%: after level -4 the nearest pass was 2.04 mm away, so the stock stood at -3.26, and level -6 (`G1 X173.761 Y255.216`, line 668) cut 2.66 mm.
- `relief-roughing.ts:204,326-337`; `relief-core-cleanup.ts` ("Empty whenever the stepover is at most the cutter radius").

**Sources.**

- [Autodesk Fusion: 3D Adaptive Clearing](https://help.autodesk.com/view/fusion360/ENU/?guid=GUID09E44604-DAD8-47D6-ADC6-C100869DE724): "It is unique in that it guarantees a maximum tool load at all stages of the machining cycle"

### P2-relief-rough-3: A relief's roughing cuts into a neighbouring relief within one bit radius

**Medium** · Open · Reproduced

*The relief planner's edge rule (ADR-098, ADR-289); the first pass checked single reliefs only.*

Each relief on a layer is planned alone, and its map edge counts as bottomless. So the outer roughing ring rides the relief's own edge, and the cutter reaches one radius past it, into whatever relief sits there. Ordinary case: a relief picture next to a relief border or text on the same layer, closer than 3.175 mm for a 1/4" bit. Nothing in Job Review warns about relief spacing.

**Fix.** Plan the reliefs of a layer against the maximum of their heightmaps, or treat the other reliefs' footprints as uncuttable. At least warn when two reliefs are closer than the roughing bit's radius.

**Evidence.**

- Two reliefs 1 mm apart, the second with a 3 mm raised border on its near side, 1/4" end mill: the first relief's outer ring runs along X140.000 at Z-2, -4 and -5.5 (lines 89, 149, 245) and cuts a strip 2.175 mm wide off the whole height of the border (684 gouge samples).
- `compile-cnc-relief.ts:119` (one relief at a time); `heightmap-tool-offset.ts:14` ("Out-of-bounds neighbors are ignored (treated as bottomless)").

### P2-relief-finish-2: Non-ball finishing bits ignore Finish scallop; a V-bit leaves ridges 1.3 to 2 mm tall

**Medium** · Open · Reproduced

*H.8 finishing (`FLAT_TOOL_STEPOVER_FRACTION`); ADR-421 and ADR-423 did not change it.*

Any bit can be chosen as the relief finishing bit, but every bit except a ball or tapered ball gets rows 0.4 × its diameter apart, whatever Finish scallop says. The layer still shows "Finish scallop" with the tooltip "smaller = finer finishing rows, longer job", and Job Review's scallop warnings cover balls only. A 90° V-bit finishes with rows 2.54 mm apart and leaves ridges up to 1.27 mm tall on a flat; a 60° V-bit 2 mm; a 30° engraver 1.99 mm.

**Fix.** Work out the rows of non-ball bits from the requested scallop (for a V-bit or engraver the spacing is 2 × h × tan(half angle) beyond the tip flat), or give them an explicit finishing stepover field. Either way, add a Job Review line stating the ridge height the chosen bit leaves.

**Evidence.**

- Removal grid at 0.01 mm: 90° V 6.35 mm, 2.5400 mm rows at both 0.025 and 0.005 mm requested, ridges up to 1.2675 mm; 1/8" end mill on a 20° slope, 1.27 mm rows, steps up to 0.4322 mm; 1/8" ball control, 0.0249 and 0.0050 mm as requested.
- `relief-finishing.ts:55-56,387-394`; `CncLayerToolFields.tsx:54-62`; `cnc-relief-planning-warnings.ts:128-134`.

**Sources.**

- [ADR-291 item 6](https://github.com/cisgz3a-hub/KerfDesk/blob/main/DECISIONS.md): "Flat, V, or otherwise non-ball tools use explicit linear stepover and are not labelled scallop-controlled. No percentage clamp or automatic spacing change is silent."
- [Autodesk Fusion: Parallel finishing](https://help.autodesk.com/cloudhelp/ENU/Fusion-CAM/files/GUID17CC1F90-A2A5-4CC3-80EB-B7972E327E0F.htm): "Specifies horizontal stepover between passes."

### P2-relief-finish-3: An STL arrives 100 mm wide and 5 mm deep whatever its real size

**Medium** · Open · Reproduced

*H.4 STL import (ADR-098); ADR-125 Amendment 1 listed STL but did not change it.*

STL import always makes the relief 100 mm wide and 5 mm deep, and maps the mesh's whole Z range, base included, onto that depth. A model drawn to size is rescaled in X and Y and by a different factor in Z, so its proportions change. The toast gives the new size, not the model's own, and the Relief panel has only Width and Depth, so the original size is lost unless the operator knows it from CAD. A 40 × 20 mm wedge 12 mm tall arrived as 100 × 50 mm and 5 mm deep: height to width went from 0.30 to 0.05.

**Fix.** Import an STL at its own X size in millimetres and its own Z extent, with the ADR-125 bed fit and its undo step, and name the model's size in the toast. Keep 100 × 5 mm only for height maps, which have no units.

**Evidence.**

- `relief-import-defaults.ts:2,4`; `stl-import-action.ts:34-38,78-81,124-137`; `mesh-to-heightmap.ts:4-6,211-212`.
- WORKFLOW.md disagrees with itself: F-A3 (line 238) applies the ADR-125 rule to STL, while F-CNC7 (line 4547) says the mesh lands "at 100 mm wide (height by aspect), 5 mm relief depth". Orientation is correct (ADR-414).

**Sources.**

- [ADR-125 Amendment 1, decision 1](https://github.com/cisgz3a-hub/KerfDesk/blob/main/docs/decisions/ADR-125-amendment-1-imports-keep-file-size.md): "A fresh import (SVG, DXF, image, STL mesh relief, library art, text) arrives at its file size, centred as before."

### P2-relief-finish-4: Design Studio's instant preview draws engrave and drill layers differently from what is cut

**Low** · Open · Reproduced

*Design Studio instant tier (ADR-272 Amendment 1); not covered by the first pass.*

The Design view is titled "The target surface each layer asks for", but two layer types do not match the cut. A drill layer drills every closed shape at its bounding-box centre, while the preview draws holes only for circles and ellipses, so a rectangle shows nothing but is drilled. An engrave layer is previewed as a flat channel as wide as the bit's full diameter: a 90° 12.7 mm V-bit engraving 1 mm deep previews as a 12.6 mm flat channel but cuts a 2 mm V.

**Fix.** Stamp engrave grooves with the bit's own profile (the width-at-depth law profile slots already use), and put a drill disc at the bounding-box centre of every closed shape.

**Evidence.**

- `layer-surface.ts:58` (full-diameter engrave) and `:133-135` (circles and ellipses only); `drill-peck.ts:1-3,33-38`; `compile-cnc-layer-passes.ts:327-330`.
- Preview depth at the rectangle's centre (25, 23) is 0.0000; `drillPeckPasses` drills one hole there to -3 mm.

**Sources.**

- [ADR-272 Amendment 1, clause 4](https://github.com/cisgz3a-hub/KerfDesk/blob/main/DECISIONS.md): "profile kerf slots at tool diameter on the offset side; drill discs"

## Machine control and Z travel

Park height, bit changes and the live machine state.

### P2-gcode-1: The new park height was never checked against the Z travel, and Job Review did not show it

**Medium** · Fixed in PR #1019 · Reproduced

*ADR-491 item 3 (park height, 26 September).*

Since ADR-491, the job end and every bit-change stop lift to the operator's park height, written as a work coordinate `G0 Z`. Machine Setup accepts 0.5 to 200 mm, while the 4040 Max profile records 75 mm of Z travel, and nothing compared the two: the bounds checks are X and Y only, and Job Review's park row showed only the bed X and Y. The first audit's JR-3 found the same gap for any job whose depth plus safe Z exceeds the travel.

GRBL's soft limits are off by default, and they need homing, which the 4040 does not have. A lift past the top stalls the stepper, Z loses steps, and every later cut runs deeper. This is one of the suspects in the lost position.

**Fixed in PR #1019.** Job Review now shows "Park height: N mm above stock top · job end and bit changes" under Machine, in warning tone when it reaches the Z travel. A job whose deepest cut plus highest lift is longer than the travel gets a warning, using `$132` when connected and the machine profile's value otherwise: "This job needs 126 mm of Z, from its deepest cut at Z-6 up to the park height lift at Z120, but the machine profile records 75 mm of Z travel. No work zero fits both: Z runs into a stop, where it can stall and lose steps so later cuts run deeper. Lower the park height or cut less deep." It is a warning, not a Start block. [ADR-491 Amendment 1](https://github.com/cisgz3a-hub/KerfDesk/blob/claude/cnc-audit-te9azb/docs/decisions/ADR-491-amendment-1-park-height-shown-and-checked-against-z-travel.md), commit [64b8745b7](https://github.com/cisgz3a-hub/KerfDesk/commit/64b8745b7).

**Evidence.**

- Probe on main, 4040 profile (Z travel 75), 40 mm stock, park height 120: the program ends `G1 X16.826 Y371.588 Z-3.000 | G0 Z120.000 | M5 | G0 X10.000 Y390.000`, and `preflight ok=true issues=[]`.
- `DeviceSetupCncMachineStep.tsx:197-205` (0.5 to 200 mm); `device-profile.ts:453` (Z travel 75); `machine-bounds.ts:12-31` and `cnc-motion-bounds-preflight.ts` (X and Y only); `job-review-park-label.ts:15-16`.
- In the PR, `cnc-z-travel-warnings.test.ts` warns at 120 mm against 75 mm, stays silent at 30 mm, prefers a reported `$132`, names safe Z for an 80 mm deep job, and says nothing when no travel is known.

**Sources.**

- [GRBL defaults.h](https://github.com/gnea/grbl/blob/master/grbl/defaults.h#L56): "#define DEFAULT_SOFT_LIMIT_ENABLE 0 // false"
- [GRBL wiki: Configuration, $20](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration): "Soft limits requires homing to be enabled and accurate axis maximum travel settings, because Grbl needs to know where it is."
- [ADR-491](https://github.com/cisgz3a-hub/KerfDesk/blob/main/docs/decisions/ADR-491-pocket-stay-down-links-and-park-height.md): "a lift past the top of the Z travel stalls the axis, and a Z that lost steps at the top would cut the next job deeper"

### P2-control-1: On a homed router, a park height that fits the travel can still lift Z past its top

**Medium** · Open · Reproduced

*ADR-491 item 3 (park height).*

The operator sets a 50 mm park height once so the bit clears clamps at bit changes. On a later job the stock top is zeroed 40 mm below the homed top (a thick board, or a short bit). At every bit change and at the job end the program lifts with `G0 Z50.000`, which is 10 mm above the switch GRBL homes to. The static check in P2-gcode-1 cannot catch it, because 50 mm is less than the 75 mm travel.

With limits off (the GRBL default), Z drives into its top stop and every later cut runs deeper. With hard limits on, the bit change ends in ALARM:1. With soft limits on, GRBL alarms when it reads the lift line, which the streamer sends ahead while earlier passes are still cutting. KerfDesk had both numbers it needed: a confirmed Home and the live work offset.

**Fix.** When homing is confirmed and the work offset is live, warn in Job Review if the work offset Z plus the park height (or the job's highest retract) is above machine Z 0. Say by how much, and give the largest height that fits. This helps homed routers only; the unhomed 4040 relies on P2-gcode-1.

**Evidence.**

- Probe, User Origin homed with `$23=0`, bed park X10 Y390, park height 50, work offset (-250, -300, -40): both parks print `"z": "G0 Z50.000", "machine": {"x": -390, "y": -10, "z": 10}, "inTravel": false` with `"parkOrHeightWarnings": []`. The same for `$23=3`, Current Position, and Absolute with a leftover G92.
- `cnc-grbl-transitions.ts:40-45` (no upper bound); the only Z-travel item in Job Review is the informational "Powered Z assumption" (`job-review-live-rows.ts:157-165`).

**Sources.**

- [GRBL system.c](https://github.com/gnea/grbl/blob/master/grbl/system.c#L348): "if (target[idx] > 0 || target[idx] < settings.max_travel[idx]) { return(true); }"
- [GRBL limits.c](https://github.com/gnea/grbl/blob/master/grbl/limits.c#L382): "set_axis_position = lround(-settings.homing_pulloff*settings.steps_per_mm[idx]);"
- [GRBL wiki: Set up the Homing Cycle](https://github.com/gnea/grbl/wiki/Set-up-the-Homing-Cycle): "Default setting ($23=0), the home location is the top right of your work area, with the spindle all the way up."

## Preview, Inspector and time

What the preview, 3D pane, Inspector and estimate show.

### P2-preview-1: The Inspector warned "Rapid plunge below Z0" on KerfDesk's own multi-pass jobs

**Medium** · Fixed in PR #1019 · Reproduced

*ADR-520 and ADR-489 (rapid down to just above an earlier pass), which fixed gap-audit item CW-02.*

Since ADR-520, a second or later depth pass rapids down inside its own already-cut slot to 1 mm above the earlier floor (`G0 Z-2.000`, then `G1 Z-6.000 F300`). That is by design and safe. The Inspector's Program Health check still flagged every G0 that ends below Z0, saying it happens "instead of feeding in at plunge rate". It fired on 7 of 14 ordinary KerfDesk programs: multi-pass profiles with and without leads, offset and raster pockets, a tabbed part and a two-tool job. It told operators their own program was wrong and taught them to ignore the one check that catches a real rapid into stock in an imported file.

**Fixed in PR #1019.** A rapid descent below Z0 is now flagged only when no earlier feed move went through the same point at or below the depth it stops at. A descent beside, below or before an earlier cut is still flagged, and the message now says it goes "where no earlier move has cut that deep". The same change makes "Cutting begins before spindle/laser on" count only a feed move into the work (WA-5). [ADR-255 Amendment 1](https://github.com/cisgz3a-hub/KerfDesk/blob/claude/cnc-audit-te9azb/docs/decisions/ADR-255-amendment-1-program-health-reads-already-cut-air.md), commit [1e50d5d50](https://github.com/cisgz3a-hub/KerfDesk/commit/1e50d5d50).

**Evidence.**

- On main: `parity-profile-outside-noleads-notabs.nc`: `warning:rapid-plunge@L27 "Rapid plunge below Z0: 6 rapid (G0) move(s) descend below Z0, to Z -8.00 mm, instead of feeding in at plunge rate."` Each of those G0s stops 1 mm above the earlier pass at the same point.
- `finding-checks.ts:96-107` flagged `z1 < -0.001` for any rapid plunge; the emitter writes the descent in `cnc-grbl-entry-descent.ts:24-31`.
- In the PR, `rapid-descent-clearance.test.ts` compiles an outside profile, an offset pocket and a raster pocket 6 mm deep at 2 mm per pass through the real compiler and emitter: each has `G0 Z-` descents and no rapid-plunge finding, while descents 1 mm deeper than the earlier cut, 2 mm beside it or before any cut are still flagged. The check costs about 0.1 s for 600,000 segments.

**Sources.**

- [LinuxCNC G-code reference: G83](https://linuxcnc.org/docs/html/gcode/g-code.html): "Rapid move back down to the current hole bottom, less .010 of an inch or 0.254 mm."

### P2-preview-2: The preview draws the wrong end-of-job and bit-change moves, and never shows the park height

**Medium** · Open · Reproduced

*Contradicts ADR-392; hides what ADR-491 added (gap-audit CW-07).*

The 2D preview, the 3D pane and the Cut 3D overlay are drawn from the compiled job, not the program. At the end of every CNC job they draw a rapid at the stock top to program X0 Y0 with no lift, while the program lifts to the park height and goes to the configured bed park. Bit-change park visits are not drawn, and the retract is drawn to safe Z instead of the park height. "Retract between passes", on by default for profiles with no leads, is emitted but not drawn. An operator checking clamp clearance sees a rapid dragged across the stock top to the wrong corner, and never sees the park height set for exactly that purpose. Job Review's "Park after job" row is right, so the two disagree.

**Fix.** In the CNC toolpath builder, take the park from the placed job (as `resolveJobParkTarget` does), add the lift to park height and a travel carrying that Z at the job end and at each bit change, honour `retractBetweenPasses`, and extend the emitter-agreement test to cover parks and that flag.

**Evidence.**

- With park X20 Y380 Z30, the emitted `G0 Z30.000` and `G0 X20.000 Y380.000` are drawn as `rapid (140.000,196.825,0.000)->(0.000,0.000,0.000)`. Two-tool job: `L108 G0 Z40.000`, `L110 G0 X20.000 Y380.000` are not drawn.
- `draw-preview.ts:277-284` (`if (project.machine?.kind === 'cnc') return finishPosition ?? { x: 0, y: 0 };`); `toolpath.ts:53-54`; `toolpath-moves-3d.ts:53` (Z-less travel drawn at Z0); `toolpath-cnc.ts:84-96` never reads `group.retractBetweenPasses`.

**Sources.**

- [ADR-392](https://github.com/cisgz3a-hub/KerfDesk/blob/main/docs/decisions/ADR-392-cnc-park-is-a-bed-position.md): "Emission, the preview, the duration estimate, Job Review metrics (resolveJobParkTarget), the park-outside-frame note and recovery all read the same placed park."

### WA-4: Arcs in the G18 or G19 plane are skipped and the position is not advanced

**Medium** · Open · Reproduced

*Found by the weakness audit and handed to this audit; confirmed in the code.*

The Inspector skips G2 and G3 in the XZ (G18) and YZ (G19) planes and leaves the tool where it was, so every later move of an imported program is drawn, timed and checked from the wrong point. GRBL 1.1 runs arcs in all three planes. KerfDesk's own output never uses them, but router programs from Fusion's GRBL post can.

**Fix.** Build G18 and G19 arcs in their plane like G17 arcs, or at least advance the position to the arc's end point and flag the arc as not drawn.

**Evidence.**

- `gcode-render-model-builder.ts:243-247, 335-338`.

**Sources.**

- [GRBL wiki: Commands](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Commands): "Plane Select | G17, G18, G19"

### P2-preview-3: The carved stock is only half-cell exact on sloped ball and V moves

**Low** · Open · Reproduced

*ADR-487 carved stock.*

The Inspector's carved stock stamps a sloped ball or V move with its tip snapped to a cell centre, which ADR-487 calls "exact to half a cell"; in depth that is the slope times up to 0.7 of a cell. End mills, level moves and tabs are exact. On a 150 × 100 mm relief with steep walls, Compare shows 420 "cut too deep" cells, deepest 1.24 mm, where the exact removal of the same program gives 274, deepest 0.81 mm, all on slopes steeper than 45°. V-carve walls look stair-stepped. It is a picture, not a check, hence Low.

**Fix.** Sample sloped ball and V moves at a quarter cell or less with the real tip position, and make Compare slope-aware (tolerance plus slope × half a cell).

**Evidence.**

- `stock-sweep.ts:112-146` (tip snapped at `:139`). T1 plywood part at 0.147 mm cells: 0 of 372,837 cut cells off by more than 0.02 mm. V-carve sign at 0.134 mm cells: 16% of cut cells off by more than 0.1 mm.

### WA-3: CNC time estimates follow display chords on arcs, not GRBL's arc segments

**Low** · Open · Confirmed in code

*Found by the weakness audit and handed to this audit; confirmed in the code.*

The timing options set the controller's arc tolerance only for laser jobs on GRBL, so CNC arcs (helical entries, registration bores, imported programs) are timed along the preview's display chords instead of the segments GRBL cuts them into. The weakness audit's PR #1020 changes the same timing code to model GRBL's planner buffer.

**Fix.** Pass the controller's `$12` arc tolerance (or GRBL's 0.002 mm default) to CNC timing as well, after #1020 lands.

**Evidence.**

- `program-timing-options.ts:47-52`.

**Sources.**

- [GRBL wiki: Configuration, $12](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Configuration): "Grbl renders G2/G3 circles, arcs, and helices by subdividing them into teeny tiny lines, such that the arc tracing accuracy is never below this value."

## Machine setup and feeds

Which settings a job compiles from, and the feeds they seed.

### P2-review-1: "Use last machine" in CNC mode kept the generic router settings

**Medium** · Fixed in PR #1019 · Reproduced

*Pre-existing in `replaceDeviceProfile`; ADR-500 made it a one-click path at launch.*

A new session starts on the generic machine and offers the saved 4040. A router operator switches to CNC and then clicks "Use Neotronics 4040…". The device changed, but the settings the job compiles from stayed generic: safe Z 3.81 mm, spindle maximum 12,000, max feed 6,000 and no park height. The next Laser/CNC switch then wrote those over the saved values. An operator who saved Safe Z 10 mm to clear clamps got 3.81 mm rapids, and nothing flagged the change.

**Fixed in PR #1019.** A replaced profile that carries router settings now applies them to the active router machine, the cached one and the parked copy in the same undo step, and refreshes automatic feeds. A profile without router settings leaves them as they are. Commit [3b93debc7](https://github.com/cisgz3a-hub/KerfDesk/commit/3b93debc7).

**Evidence.**

- Saved machine: safe Z 10, spindle 10000, max feed 2500, park 30. After Use last machine in CNC mode on main: `device.cncSubProfile {"safeZMm":10,…}` but `machine.params {"safeZMm":3.81,"spindleMaxRpm":12000,…,"maxFeedMmPerMin":6000}`.
- `MachineSetupBanner.tsx:53` → `replaceDeviceProfile` (`store-actions.ts:89-106`) → `projectAfterDeviceProfileChange` (`cnc-machine-setup-scene.ts:63-85`) replaced only the device; `machine-actions.ts:200-203,213`.

**Sources.**

- [ADR-500](https://github.com/cisgz3a-hub/KerfDesk/blob/main/docs/decisions/ADR-500-first-run-machine-banner.md): "A returning operator gets their machine back in one click."

### P2-review-2: On the 4040, surfacing with a stock material was seeded at 300 mm/min

**Medium** · Fixed in PR #1019 · Reproduced

*Regression from a016f906 (remediation item C11), kept by ADR-457 Amendment 1.*

Flattening the 400 × 400 mm spoilboard with a 25.4 mm cutter and the stock material set to MDF was seeded at 300 mm/min feed, 120 plunge and 0.5 mm at 12,000 RPM: 0.0125 mm per tooth, half the Shapeoko A to Z floor. The pass took 56 minutes at feed instead of 6.7 with the 2500/600 values used before, which the Default profile still gets. The cap meant for a 1/8" bit in wood (FS-2) reached a facing cutter. Rubbing across a whole spoilboard wears the cutter and leaves a poorer surface.

**Fixed in PR #1019.** Surfacing now leaves the machine starter out of its calculation. The surfacing ceilings (2500/600 mm/min, 0.5 mm per pass), the CNC max feed and the live machine limits still apply, and layers keep the starter as before. Commit [0c1fe466e](https://github.com/cisgz3a-hub/KerfDesk/commit/0c1fe466e).

**Evidence.**

- Probe on main: `25.4 mm surfacing 2fl | 4040 + material MDF | seed {"feedMmPerMin":300,"plungeMmPerMin":120,"depthPerPassMm":0.5} @ 12000 RPM | chip 0.0125 mm/tooth | 56.0 min at feed`. Default profile: 2500/600/0.5, 6.7 min.
- `SurfacingFields.tsx:19-46,42`; `surfacing.ts:63-83` takes the minimum; the cap is `resolve-cnc-auto-settings.ts:147-155`.

**Sources.**

- [Shapeoko CNC A to Z: Feeds and speeds basics](https://shapeokoenthusiasts.gitbook.io/shapeoko-cnc-a-to-z/feeds-and-speeds-basics): "a value of 0.001'' (0.0254mm) is a good absolute lower limit guideline"
- [Harvey Performance: Speeds and Feeds 101](https://www.harveyperformance.com/in-the-loupe/speeds-and-feeds-101/): "A chip load that is too small can cause rubbing, chatter, tool deflection, and a poor overall cutting action."

## Job Review and warnings

What the operator is told before Start, and whether it matches what the program does.

### P2-toolpath-4: The narrow-feature warning used the stored diameter of V-bits and tapered bits

**Low** · Fixed in PR #1019 · Reproduced

*ADR-433 (narrow-feature check) against ADR-368 Amendment 3 (layout by cut width).*

ADR-433 checks pockets and profiles against the bit's stored diameter, but the compiler lays out a V-bit, ball nose or tapered bit by the width it cuts at the layer's depth. So Job Review said a feature "stays uncut" while the program cut it: a 5 mm wide pocket 2 mm deep with a 90° V-bit was cut at Z-1 and Z-2, and still warned. A tapered ball stored as 6.25 mm cuts about 2.8 mm at 6 mm deep, so most detail work drew the same false warning.

**Fixed in PR #1019.** The threshold is now the width the compiler lays the bit out by, and the message names it, for example "1 area narrower than the 4 mm the bit (90° V-bit — 12.7 mm (1/2") cut) cuts at 2 mm deep". Flat end mills keep their stored diameter. [ADR-433 Amendment 1](https://github.com/cisgz3a-hub/KerfDesk/blob/claude/cnc-audit-te9azb/docs/decisions/ADR-433-amendment-1-cnc-threshold-is-the-cut-width-at-depth.md), commit [dfb8697b2](https://github.com/cisgz3a-hub/KerfDesk/commit/dfb8697b2).

**Evidence.**

- On main: `JR2 v90-pocket5wide-depth2: pocket: … distinct Z [-1,-2]` with `WARN Layer "Operation": 1 area narrower than the 6.35 mm bit (90 V 6.35) — the bit cannot enter it, so it stays uncut; narrowest 5 mm`.
- In the PR, `project-check.test.ts`: threshold 4 mm for a 90° V-bit 2 mm deep; the 5 mm area gets no finding and compiles to passes, the 3 mm area gets one and compiles to none.

### P2-review-4: Machine-limit advisories counted stage recipes the job never runs, and named no layer

**Low** · Fixed in PR #1019 · Reproduced

*ADR-457 Amendment 1 (16050e26). Also found as P2-advcam-2.*

A layer keeps its V-carve clearing or pocket roughing recipe after its cut type changes or its second bit is removed, by design. The new advisories still compared that unused recipe with the machine limits: a profile layer at 1000/300 mm/min with a leftover clearing recipe of 5000/1500 at 18,000 RPM got four warnings about values the program never sends, and none named the layer. In the adaptive case the recipe is hidden in the layer panel, so it cannot even be removed there. False warnings train operators to skim the list that carries the real ones.

**Fixed in PR #1019.** With a compiled job, a recipe counts only where the job ran its stage, and every advisory names its layer, for example "The Wall finishing recipe on layer "Outline" requests feed 5000 mm/min, above …". [ADR-457 Amendment 2](https://github.com/cisgz3a-hub/KerfDesk/blob/claude/cnc-audit-te9azb/docs/decisions/ADR-457-amendment-2-limit-advisories-count-only-recipes-the-job-runs.md), commit [3ae311112](https://github.com/cisgz3a-hub/KerfDesk/commit/3ae311112).

**Evidence.**

- On main the program sends `F [300,1000] S [12000]` while Job Review shows "The V-carve clearing recipe's feed 5000 mm/min is above the machine's reported max rate 3000 mm/min…" and three more.
- `cnc-machine-limit-warnings.ts:113-116` accepted any recipe whose cutter is in the library; the compiler uses a recipe only for a stage cut with that cutter (`cnc-stage-settings.ts:9`).

**Sources.**

- [ADR-457 Amendment 1, decision 2](https://github.com/cisgz3a-hub/KerfDesk/blob/main/docs/decisions/ADR-457-amendment-1-surfacing-starters-and-recipe-limit-advisories.md): "A recipe counts only when its cutter is in the machine's tool library, since a recipe for an absent cutter cannot emit."

## G-code and GRBL

What the emitted program does on real GRBL 1.1h.

### P2-gcode-2: The post-emit safety scan accepts a rapid over uncut stock once anything deeper has been cut anywhere

**Low** · Open · Reproduced

*211e6bc2 (ADR-489); ADR-520 extended air floors to every 2D operation.*

The scan that guards emitted programs accepts a Z-only `G0` down from safe Z whenever it stops at least 1 mm above the deepest Z fed anywhere in the program, at any X and Y, even across a bit change. So once one part has been cut deep, a wrongly credited floor on a first-time path elsewhere passes as clean. ADR-520's own review found three producer bugs of exactly that kind. Today's output has none (no rapid ends inside stock in the whole corpus), so this is a missing safety net for the riskiest change of the week: a `G0` runs at the rapid rate.

**Fix.** Let the scan keep a coarse grid of the deepest Z fed, swept by the tool radius from the group's `; cnc tool:` header and cleared at `M0`, and accept an air descent only where that cell was fed at least 1 mm below the target.

**Evidence.**

- Cut at X50 Y50 to Z-6, then `G0 X300 Y300`, `G0 Z-4.000`, `G1 Z-5.000`: `air-descent-over-uncut-xy: NO ISSUE`. The same after `M0`: `NO ISSUE`.
- `cnc-motion.ts:176-181` (`isAirDescent`).

**Sources.**

- [GRBL planner.c](https://github.com/gnea/grbl/blob/master/grbl/planner.c#L392): "if (block->condition & PL_COND_FLAG_RAPID_MOTION) { block->programmed_rate = block->rapid_rate; }"

## Tiling, boxes and other strategies

Tiled output, box parts, dogbones and inlays.

### P2-advcam-1: Tiled files bore every helix at the cutting feed and add unannounced plunges at seams

**Low** · Open · Reproduced

*Tile clipping (`tile-plan.ts`); left unchecked in the first pass.*

Tiling turns every helical entry into a plain 3D path, which the emitter feeds at the cutting feed. Untiled, the same helix is a native arc at the plunge feed. So on a tiled job a helix-entry or adaptive pocket bores its full-width helix 3.3 times faster than planned at the default 1000/300. Where a seam crosses a helix or its rings, the first tile re-enters each clipped piece with a vertical plunge. Nothing in the file or the tile advisories says so, and the only tiled-entry advisories talk about V-carve even on plain profile layers.

**Fix.** Split a clipped helical pass into its descending part (fed at the plunge rate) and its level contour, or keep the native helix when the helix lies inside the tile; give helix and adaptive groups the tiled-entry advisory, worded without "V-carve".

**Evidence.**

- Untiled: `G3 X226.809 Y186.000 Z-0.188 I-1.191 J0.000 F300` (line 289). Tile r1-c2: `G1 X20.737 Y57.895 Z-0.016 F1000` (line 477), 384 descending G1 moves at F1000. Tile r1-c1: 100 vertical plunges into stock at the seam, 80 of them with 1 to 1.5 mm of stock under part of the bit. Advisories: `[]`.
- `tile-plan.ts:192-195`; `cnc-grbl-strategy.ts:424-425`; `cnc-grbl-helical.ts:65`.

**Sources.**

- [WORKFLOW.md, helical entry](https://github.com/cisgz3a-hub/KerfDesk/blob/main/WORKFLOW.md): "descends through a native tangent helix that ends at the contour start"

### P2-advcam-3: On the default CNC box, 12 of 72 dogbones stop at the holding-tab top

**Low** · Open · Reproduced

*Automatic tab placement (TP-5, CW-05); ADR-106 Amendment 2 documents the mechanism.*

With the box dialog's CNC defaults (inner 60 × 40 × 30, 6.35 mm stock, 3.175 mm bit, relief on), 60 of the 72 relieved seat corners are cut to full depth. The other 12 fall under a holding tab and are cut only to the tab top, 2 mm short. Those finger joints do not close until the operator carves the bottom of each notch corner by hand.

**Fix.** For box panels, keep tab windows at least one bit diameter away from any relieved corner.

**Evidence.**

- "Bottom outline corner (6.35,19.61): nearest full-depth centre 2.200 mm", cut to Z-4.350 against Z-6.35. Bottom ×4, Top ×4, Front ×2 and Back ×2.

**Sources.**

- [ADR-106 Amendment 2](https://github.com/cisgz3a-hub/KerfDesk/blob/main/docs/decisions/ADR-106-amendment-2-cnc-box-parts-cut-through.md): "A seat corner that falls under a holding-tab window is relieved only down to the tab top, like the rest of the tab. Trimming the tab clears it."

### WA-6: The dogbone tool merges its input with the non-zero rule, so an even-odd drawing can lose its holes

**Low** · Open · Confirmed in code

*Found by the weakness audit and handed to this audit; traced in the code, not reproduced here.*

The dogbone tool unions its rings with clipper2's two-argument call, which fills non-zero at two decimal places. A drawing that relies on even-odd filling, such as a ring drawn as two loops in the same direction, is filled solid before corners are relieved.

**Fix.** Normalise the input with the same even-odd rule the compiler uses before the union, and add a test with same-direction nested loops.

**Evidence.**

- `dogbone.ts:53`: `unionD(rings.value, FillRule.NonZero)`.

### WA-7: Inlay and V-carve reach offsets use a default arc tolerance that grows with the offset

**Low** · Open · Confirmed in code

*Found by the weakness audit and handed to this audit; confirmed in the code.*

The round-join offset helper uses clipper2's default arc tolerance, which grows with the offset distance: about 0.1 mm of sag at a 50 mm offset. The inlay pair and the V-carve tip reach check call it. At the small offsets these usually use the sag is a few thousandths of a millimetre, but nothing bounds it by the 0.1 mm inlay fit.

**Fix.** Pass an explicit arc tolerance (for example 0.005 mm) at the CNC call sites. The helper is shared with Offset Shapes, so the shared default is left to that thread.

**Evidence.**

- `kerf-offset.ts:33` (`offsetClosedPolylinesWithRoundJoins`); `inlay-pair.ts:90`; `vcarve-tip-reachability.ts:24`.

## Saving projects

What survives a save and a reopen.

### WA-1: A project re-saved by an older build loses newer router settings such as the park height

**Low** · Open · Reproduced

*Found by the weakness audit and handed to this audit; confirmed in the code.*

Project loading rebuilds the router machine, the parked machine's settings and stock, and each layer's CNC settings field by field. A build that predates a field drops it, so opening a project in an older build (an older desktop install, say) and saving it again silently loses, for example, the park height from ADR-491: the next job then stops for bit changes at safe Z.

**Fix.** Keep fields this build does not know when loading and write them back on save, or warn before saving over a file written by a newer build. The weakness audit's PR #1020 also changes project loading, so whichever lands second should carry this.

**Evidence.**

- `deserialize-project.ts` (the park height is read at line 191).

## The first audit, rechecked

Probed again on main 2f6f84de. First pass: 12 fixed on main · 1 fixed in PR #1019 · 10 partly fixed · 28 still open. Gap audit: 2 fixed on main · 1 partly fixed · 4 still open.

### Job Review

| ID | Finding | Now | Note |
|---|---|---|---|
| JR-1 | Laser mode on ($32=1) gets only a folded-away warning | Fixed on main | ADR-180 Amendments 5 and 6: the list opens for every router `$32` message, names all three effects, offers one-click `$32=0` and refuses `$32=1` on a router project. |
| JR-2 | Holes and slots narrower than the bit skipped silently | Fixed on main | ADR-433 warns per feature with the bit and a position. Its two gaps are fixed in this PR (P2-toolpath-1, P2-toolpath-4). |
| JR-3 | Z travel never checked; soft limits off shown as neutral | Partly fixed | This PR adds the Z-range warning and the park height row (P2-gcode-1). "Soft limits Off" is still shown in a neutral tone. |
| JR-4 | A failed helix, adaptive or rest plan drops the whole layer | Partly fixed | The dropped layer is now reported, but the message blames the bit width, the Helical entry rows still show for raster pockets, and one failing region still empties the layer. |
| JR-5 | No flute length on bits, no warning for deep passes | Still open | A 40 mm deep 1/8" profile, a single 6 mm pass and a 39.5 mm deep relief get no depth warning. |
| JR-6 | Job Review shows stored feeds, not what is sent | Still open | Cells show 7000/6500/20000 while the program sends 6000/6000/12000. |
| JR-7 | Warnings name internal layer ids and no outcome | Still open | Still true for several warnings, and one 2.5 mm slot is reported twice under two names. The stage-recipe advisories now name their layer (P2-review-4). |
| JR-8 | No warning for plunge faster than feed, or RPM below $31 | Still open | Plunge 2000 with feed 800 and S5000 under `$31=8000` still pass silently. |
| JR-9 | Override warnings worded as blocks | Still open | Two warnings still say "CNC Start blocks…" and "requires…" while Start is allowed; three docs still call ADR-172 a block. |

### Toolpaths

| ID | Finding | Now | Note |
|---|---|---|---|
| TP-1 | Tabs measured from the cut floor | Partly fixed | With Stock thickness set, tabs stand on the stock bottom (ADR-258 Amendment 3). Without it they are still measured from the floor. The change removed tabs on thin sheet (P2-toolpath-2), fixed in this PR. |
| TP-2 | A hidden laser setting could cut the outline before the pocket | Fixed on main | Fixed in #898. |
| TP-3 | Profiles on different layers not ordered inside-first | Still open | Layers still cut in layer order. |
| TP-4 | Ramps fall back to plunges and descend too fast | Fixed on main | ADR-471 and Amendment 1, ADR-273 Amendment 2, ADR-250 Amendment 2: no undisclosed plunge in 8 ramp jobs, and no descent faster than the plunge feed. |
| TP-5 | Automatic tabs land on corners | Still open | A 60 × 40 mm rectangle still gets all four tabs within 3.8 mm of a corner; a 10 mm disc gets four 5.6 mm tabs with no warning. Also gap-audit CW-05 and P2-advcam-3. |

### Feeds and speeds

| ID | Finding | Now | Note |
|---|---|---|---|
| FS-1 | A secondary bit inherits the primary's feed and depth | Partly fixed | ADR-457 stage recipes give a second bit its own values, but they are opt-in; without one the bit still inherits. |
| FS-2 | Every 4040 recipe capped at 300 mm/min at 12,000 RPM | Still open | Left as set in ADR-256 (see Choices). The calculator now shows the chip load; Job Review shows it only when the bit has a flute count, which the shipped bits lack. Its leak into surfacing is fixed in this PR (P2-review-2). |
| FS-3 | New 4040 layers get the 1/8" bit whatever the Active bit | Still open | Unchanged. |
| FS-4 | Nothing checks chip load or depth against the bit | Partly fixed | Surfacing has its own fields now; nothing checks them against the bit. |
| FS-5 | The chip-load chart jumps at band edges | Still open | Hardwood at 12k: 3.175 mm gives 960 mm/min and 3.18 mm gives 2400. |
| FS-6 | Chip thinning not modelled | Still open | Unchanged. |
| FS-7 | Automatic feeds depend on whether a controller was connected | Still open | Unchanged. |
| FS-8 | Depth per pass carried float noise | Fixed on main | Fixed in #898 (not probed again). |
| FS-9 | Machine presets cannot set a maximum feed | Still open | Unchanged. |

### G-code

| ID | Finding | Now | Note |
|---|---|---|---|
| GC-1 | Helical entries ran as straight plunges on GRBL | Fixed on main | Every revolution is two half arcs; 0 collapsed on GRBL's own arc code. |
| GC-2 | Saved files carried realtime-command bytes | Fixed on main | 0 bytes outside printable ASCII in 48 programs. |
| GC-3 | Negative zero, a zero dwell and scan gaps | Partly fixed | Arc Z is tracked now. `X-0.000`, `G4 P0.000` and several scan gaps remain, all harmless on GRBL; P2-gcode-2 is a new gap. |

### V-carve, inlay and other strategies

| ID | Finding | Now | Note |
|---|---|---|---|
| AC-1 | Straight inlay plugs could not seat | Fixed on main | Fixed in #898, holds with ADR-250 Amendment 2. |
| AC-2 | Adaptive clearing refuses ordinary rectangles | Still open | Still refused at 10%, 25% and 41% (also gap-audit CW-03); the message now names the wrong cause. |
| AC-3 | Relief roughing cuts into steep walls | Partly fixed | Fixed for depth-map reliefs (#939): walls keep 0.60 to 0.94 mm, 0 gouges. The STL half is fixed in this PR (P2-relief-rough-1). The Job Review resolution note is still missing. |
| AC-4 | A V-carve flat depth past the bit's reach is capped silently | Still open | Flat 5 mm with a 90° 6.35 mm bit still cuts 3.175 mm with no warning. |
| AC-5 | Tile registration holes can land on the face or off the board | Still open | Unchanged. |
| AC-6 | The adaptive engagement check under-reads | Still open | At 50% a 45 × 30 mm pocket still ships 13 mm of full-width cut. |
| AC-7 | Surfacing accepts a stepover above 100% | Fixed in PR #1019 | The field is limited to 1-100% and the generator refuses more, naming the uncut strips. Commit [399690d25](https://github.com/cisgz3a-hub/KerfDesk/commit/399690d25). |
| AC-8 | Drilling: one bit-sized hole per shape, air moves at plunge feed | Still open | Unchanged (also gap-audit CW-04). |
| AC-9 | Inlay fit settings hidden behind Advanced | Fixed on main | ADR-481: a named "Inlay fit" section with a clearance badge. |

### Machine control

| ID | Finding | Now | Note |
|---|---|---|---|
| MC-1 | Resume at $32=1 drags a stopped bit through the cut | Fixed on main | ADR-180 Amendment 5 and ADR-411: Resume says plainly that it restarts with no spin-up, and Pause-and-lift is refused unless `$32=0` is confirmed. The firmware behaviour itself cannot change. |
| MC-2 | Touch-off never checks the probe circuit | Still open | Still seeks `G38.2 Z-25.000 F150` blind; `Pn:P` is parsed but no screen reads it. |
| MC-3 | "Position retained" offered after Abort mid-cut | Fixed on main | ADR-215 Amendment 1; conservative in every state traced. |
| MC-4 | The bit-change stop is only 3.81 mm up | Partly fixed | An opt-in park height now applies at bit changes, but it has no default and the hold text does not say to raise Z. |
| MC-5 | Z jog too coarse for a paper touch-off | Still open | Smallest step is still 0.1 mm. |
| MC-6 | The in-repo GRBL model gets door and reset wrong | Partly fixed | Door:0 and no alarm after a completed hold are modelled; Door:2/3 and `$32` are not. |
| MC-7 | A park position cannot be cleared | Fixed on main | ADR-392 Amendment 1. |

### Placement and zero

| ID | Finding | Now | Note |
|---|---|---|---|
| CO-1 | The park is not moved with the job | Partly fixed | A configured park moves with the job and stays inside travel (ADR-392). With no park set, a homed Absolute job still parks at program X0 Y0, the homing-switch corner. |
| CO-2 | Other origin corners mirror or rotate the part | Still open | Unchanged. |
| CO-3 | The anchor sits on the bit's reach, not the artwork | Still open | The part still lands one bit radius in from zero. |
| CO-4 | False "outside the stock" warnings | Still open | Unchanged. |
| CO-5 | The default part zero is G92 | Still open | Deferred by design; ADR-411's lift now restores a G92 frame after its own reset. |

### Preview and time

| ID | Finding | Now | Note |
|---|---|---|---|
| PV-1 | The estimate ignores Z's own speed and acceleration | Still open | Three realistic jobs run 3.9%, 8.7% and 9.7% short, and the new air descents are priced at 27% of GRBL's time. With Z limits equal to X and Y the planner is within 1.2%. |
| PV-2 | The 3D pane hides shallow V-bit engraving | Still open | Unchanged. |
| PV-3 | G10, G92, G53 and G28 axis words drawn as moves | Still open | Now also carved into the stock (ADR-487). The weakness audit reproduced it with real posts (WA-2): OpenBuilds `G53 G0 Z-10` gives three false warnings, and Fusion's `G28 G91 Z0` is drawn as a move to work Z0. |
| PV-4 | The Inspector is silent on lines GRBL 1.1 rejects | Still open | Unchanged. |

### Gap audit, 24 September

| ID | Finding | Now | Note |
|---|---|---|---|
| CW-01 | Gap audit: pockets lift between every ring | Fixed on main | ADR-491 and ADR-154 Amendment 3: links stay down; none comes closer to a wall than the bit radius, none is longer than the bit diameter. |
| CW-02 | Gap audit: every pass plunges from safe Z | Fixed on main | ADR-520 and ADR-489: 36 jobs checked with the real bit shape, no rapid ends inside stock, smallest margin 1.000 mm. |
| CW-03 | Gap audit: adaptive refuses rectangles | Still open | Same as AC-2. |
| CW-04 | Gap audit: drilling | Still open | Same as AC-8. |
| CW-05 | Gap audit: tabs on corners | Still open | Same as TP-5. |
| CW-06 | Gap audit: arcs emitted as short lines | Still open | A 20 mm radius circle is still 64 G1 chords; only helices and registration holes emit arcs. |
| CW-07 | Gap audit: a park height | Partly fixed | ADR-491 added an opt-in park height with no default. This PR shows it in Job Review and checks it against the Z travel. |

## Handed over by the weakness audit

- WA-1: Saving drops newer router fields in older builds: kept as finding WA-1.
- WA-2: Real posts' G53 and G28 drawn as moves: folded into PV-3 in the recheck table.
- WA-3: CNC arcs timed with display chords: kept as finding WA-3.
- WA-4: G18 and G19 arcs skipped: kept as finding WA-4.
- WA-5: Cutting before the spindle counted rapids and moves above the work: fixed in this PR with P2-preview-1.
- WA-6: Dogbone union ignores even-odd input: kept as finding WA-6.
- WA-7: Default arc tolerance in inlay and V-carve offsets: kept as finding WA-7.

## Choices I made

- FS-2, the 4040 starter cap of 300 mm/min: left as John set it in ADR-256. Only its leak into surfacing is fixed (P2-review-2). The Onsrud charts still put it 8 to 18 times below the chip load for wood and MDF; the Settings audit owns the values.
- The park height and the Z range are Job Review warnings, never Start blocks, as the Frame-first rules require (PROJECT.md rule 21, ADR-228).
- The live work-offset half of the park check (P2-control-1) is left for a follow-up. It needs a confirmed Home, which the 4040 cannot give, so the static check covers John's machine now.
- A tab at least as thick as a set stock is cut half the stock thick. Falling back to the cut-floor rule would make the tab depend on the cut depth again, which ADR-258 Amendment 3 removed; ADR-258 Amendment 4 records the alternatives.
- STL reliefs take each cell's highest point for roughing and finishing, as height-map reliefs already do. This trades a thin extra skin on smooth slopes (0.06 to 0.16 mm with a 1/8" ball at 0.025 mm scallop) for no gouges into thin detail. A finer scallop reduces the skin.
- A finishing path that roughing never reached follows the layer's depth passes. The threshold errs toward more passes: only corners sharper than about 28 degrees can be stepped when they did not need to be.
- The informational "No program end" note on every KerfDesk program stays. Adding M2 to every program is a larger change with its own risks.
- The emitter revision stamp is bumped once for the three fixes that change G-code (depth passes on small features, tabs on thin stock, STL relief sampling).

## Checked and correct

These were probed on main 2f6f84de and behave correctly. They are listed so nobody audits them again.

### Toolpaths

- Stay-down links (ADR-491, ADR-154 Amendment 3) across 10 shapes in 5 variants: no link comes closer to a wall or island than the bit radius, none leaves the region, and the longest is 6.277 mm, under the 6.35 mm bit.
- With Stock thickness set, tabs stand on the stock bottom as ADR-258 Amendment 3 intends; grooves drop their tabs with a warning; manual tab anchors land within 0.05 mm of where they project onto the path.
- V-bit and tapered walls (ADR-368 Amendments 2 and 3) sit where the cone predicts (0.87 mm at Z-1.5 for a 60° V, 0.866 predicted) with no cut on the part side of the line.

### 3D relief

- Depth-map reliefs: 0 gouges in 21 runs across end mills, balls and the tapered ball; walls keep at least 0.60 mm and floors exactly 0.500 mm with a 0.5 mm allowance. No rapid runs through material, and every retained air floor was clear.
- Relief finishing follows the scallop law: rows exactly 0.5612 mm apart, flat leftover at most 0.0247 mm, and raster plus waterline holds the scallop on steep slopes. Masks never cut excluded stock, links are no worse than rows, and STL orientation is correct.

### Machine control and Z travel

- Pause and lift (ADR-411) on real GRBL 1.1h: no position change across the reset, the G92 frame restored, no X or Y move below safe Z before the descent, and re-entry spins up, dwells and feeds down in that order.
- Re-entry across 10 job types replays nothing late and nothing off the path; a stop during a rapid-down re-runs an already-cut pass and never skips material. Pass recovery drops the air-floor rapids and reaches the same `$32` warning as Start.
- At `$32=0` the spindle is at speed before the dwell starts (`M3` synchronises, then `G4` dwells), so the plunge waits for the spin-up. Abort classification (MC-3) is conservative in every state traced.

### Preview, Inspector and time

- The preview route and the re-parsed Save program differ by 0 cells over 0.05 mm on 7 jobs. The Inspector draws KerfDesk's own programs as emitted, and with Z limited like X and Y the time planner is within 1.2% of GRBL.

### Machine setup and feeds

- ADR-457 recipes apply only when their cutter matches the stage's bit, replace all four inherited values, and the surfacing starters never go above 2500/600 mm/min and 0.5 mm.

### Job Review and warnings

- All nine anchors land the cutter envelope within 0.001 mm on front-left and rear-left origins. The bed park (ADR-392) lands where configured, and relief-only layers report their true compiled depth (ADR-224 Amendments 3 and 4).

### G-code and GRBL

- Every change between the 41 program pairs on 490708c and main is explained by an ADR (air descents, stay-down links, park height, bed park, ramps, tabs from the stock bottom, adaptive order, relief, native curves, tiles). 11 pairs are byte-identical.
- Real GRBL 1.1h accepts every emitted program: 103,435 lines in 40 programs plus 80,277 lines of curve and V-carve programs, 0 errors. The longest sent line is 50 bytes, and every program starts `G21 G90 G54 G94 G17` and lifts before every `M3`.
- Of 73 `G0` moves that end below the stock top, none ends inside stock; the smallest margin to the cleared depth is 1.000 mm. No X or Y rapid runs below Z0. Tiles, recovery jobs and partial replays drop the air floors.
- Native curves (ADR-453) stay within the 0.025 mm tolerance with 23 to 34% fewer chords, and V-carve output from curves is unchanged apart from those chords. Ramps never exceed the requested angle or the plunge feed (a3606e80).

### Tiling, boxes and other strategies

- V-carve reuse (#958) is byte-identical across four trees; inlay inserts with a ramp equal those without; adaptive rings keep r - 0.002 mm from every wall; dogbones reach every relieved corner; box parts come out as drawn.

## How this was checked

Eight lanes each probed one part of the chain through the real compile, emit and preflight code: toolpaths, G-code, preview and Inspector, advanced strategies, Job Review and feeds, relief roughing, relief finishing, and machine control. Each lane ran the same probes on main 2f6f84de and on 490708c, the tree the first audit's fixes landed on, and compared the two. Emitted programs went through the GRBL 1.1h parser built from the gnea/grbl source (grbl-sim), and pause, lift and re-entry ran on a simulated GRBL 1.1h. Removal was checked with stock models written independently of the compiler, which stamp the real cutter shape of each tool named in the program.

I re-ran each fix's failing case myself before and after the change, and every fix has a regression test that fails without it. Quotes from outside sources were read from local clones of the GRBL source and wiki and of OpenCAMLib, or were fetched and checked word for word before web fetches were turned off.

### Limits

No hardware was used, so nothing here is an air-cut or material result. The 4040's real $$ values, spindle spin-up and Z speed are unknown; the time and Z findings use KerfDesk's own GRBL fixture ($112=600, $122=50). Vectric and Carbide Create pages could not be fetched, so no claim is made about how they behave. The weakness audit found items WA-1 to WA-7 and reproduced them with its own tests; I confirmed each in the code.

Probes and the G-code corpus were kept out of the repository. The Markdown copy of this report is in the draft PR as docs/audits/2026-09-29-cnc-audit-second-pass.md.
