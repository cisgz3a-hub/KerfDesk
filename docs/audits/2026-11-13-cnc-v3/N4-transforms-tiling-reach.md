# N4 — Transforms, tiling and reach (CNC audit v3, `transforms-tiling-reach`)

**Question.** Does a transformed, tiled or nested CNC job cut what its untransformed, untiled twin cuts, and does Job Review (or the tiled save) say so when it does not? The checks cover:
- object transforms (rotation, mirror, uniform and non-uniform scale, combinations) on every 2.5D cut type: offset side, cut direction, G2/G3, tabs, V-carve depth, drill centres, text and curves;
- tiling (`tile-plan.ts` and the tiled save core): each tile against the untiled program, seams, overlap, tabs and entries at tile edges, registration holes, depth and passes, drops and duplicates;
- tool reach and holder clearance for deep, narrow cuts against the bit's recorded flute length, stickout, shank and holder;
- the surfacing wizard's program;
- CNC nest spacing against the bit;
- the warnings each of these gets.

**Tree.** `origin/main` @ `9a0b1a80b` (read-only export `j38-main`).
- `git diff --stat 9a0b1a80b origin/main -- src/core/cnc src/core/geometry src/ui/laser` is empty. main is now at `69708de7d`; the only `src/core`, `src/io`, `src/ui/app|machine|commands` change since the tree is Save Original Image (#1868). Relief PR #1878 is not in either tree's CNC paths.
- The N4 code was last touched by `ab3226fd1` (C2-P3-1 helper sharing), which is in the tree.

**Method.**
- **My own G-code reader** (`n4-reader.ts`): modal G0/G1/G2/G3 (G17, I/J; arcs split into ≤ 0.05 mm chords), G90/G91, G20/G21, F, compact words (`G1X…Y…Z…`); tool and layer from the emitter's `; cnc tool-id:` / `; cnc layer-id:` comments. It shares no code with the CAM, the emitter, N1–N3's readers or J1's oracle.
- **Entry points.** `emitGcode` (the Save path); `prepareOutput` + `detectMachineJobWarnings` + `detectMinFeatureWarnings` + the emit preflight issues (Job Review's lines); `finalizeTiledOutput` (the tiled Save core: `tileJobs` → `emitTileFiles`, per-tile preflight, advisories) with `tileJobs` for each tile's rectangle; `cncProgramReachWarnings` with `cncToolPlan` and `cncToolSectionMaximumDepthsMm`, exactly as `save-output-emission.ts:95-103` calls it; `buildSurfacingProgram`; `cncNestSpacing`; `registrationDraftFromCurrentSettings` (the "Configure registration" draft).
- **Transform twin.** For each shape, cut setting and transform, program A is the shape on an object with that transform; program B is the same loops pre-transformed with `applyTransform` on an identity object; program C is B with every loop's winding reversed. A and B are compared as text (comments stripped), then by two-sided 3D Hausdorff distance if they differ. C against B shows what depends on drawn winding. The deepest loop's machine-frame shoelace sign gives the cut direction; for profiles, the share of deepest-level points at R, 0 or inside the drawn outline gives the offset side.
- **Tiling.** Each tile file is translated back by its tile's `rect.min` and pooled. Measured: untiled cutting points no tile covers ("dropped"); tile points the untiled program does not contain ("extra"); cutting length; deepest Z; straight plunges (Z-only feed descents) classified as into fresh stock or into an earlier cut, with the tile files run in index order (and reversed) on one physical stock; registration-hole centres in stock coordinates against the drawn parts.
- **Surfacing.** Each program swept through my own top-Z heightfield (flat end mill, 0.1 mm cells): area cells not at the total depth, cells cut below it, how far the cut runs past the area, rapids, plunges.
- **Scenes.** Transforms: an L (asymmetric), Ø20 circle (128-gon), a scalene triangle, a Ø32 disc with a rectangular island; a text object ("o" with counter overlapping an "l" stem); a canonical curve (two elliptical arcs, local r = 2 mm). Tiling: a 320 × 120 blank cut Outside through 6 mm with tabs, a 200 × 40 pocket, two V-carved stars, four Ø3.2 drill holes, under 150 × 200 tiles (overlap 20 and 0) and 150 × 80 tiles; a 390 × 300 blank under the default 380 × 380 / 20 mm tiling. Reach: a 4 × 60 slot 15 deep, a 30 mm pocket 19 deep, a 70 mm profile 19 deep, a pocket 10 deep, in 19 mm stock. Nest: two 30 mm squares at gaps 0.5–10 mm, on one and on two operations.
- **Settings.** profile outside / inside / on path (Climb, Conventional, Default direction; tabs off and on, 4 mm tabs), offset pocket, helical-entry pocket (8/2/3°), adaptive pocket, V-carve (`vb-60`), drill; ramp entry 5°; registration bore `em-3175` Ø6.35 × 8 and the default draft (Ø3.175 × layer depth). Bits `em-3175`, `vb-60`, plus `em-3175` variants with flute 12.7 / shank 6.35, stickout 20 / ER11 nut Ø19, flute 22 / stickout 25.
- **Not used:** Vitest, pnpm, a browser, hardware, the GRBL simulator. Node stayed under 900 MB.

## Headline

**Transforms are clean.** All 378 transformed programs are byte-identical to their pre-transformed twins, and so are 108 with automatic tabs emitted, 12 text-object programs and every warning list. Offset side, cut direction, tabs, V-carve depth and drill centres follow the transformed geometry exactly, because `collect-cnc-contours.ts:87,107-109` transforms every point to machine coordinates before anything is planned. Reversing a loop's winding changes nothing except On-path cuts, where Cut direction is inert (KNOWN). A scaled-up curve stays within 0.0248 mm of the true curve (tolerance 0.025). Profiles emit no G2/G3, so an ellipse is never written as a circular arc.

**Tiling keeps the geometry but drills into the parts.** Nothing is dropped and nothing is added except entry plunges at tile edges. Depth and passes match the untiled program.

**One P1, one P2 and three P3s are new.**
1. **N4-P1-1. Registration holes are drilled through the parts.** They go at 1/4 and 3/4 along every seam, in the middle of the overlap strip, with no check against the artwork, and they are never previewed. Nothing in the tiled save warns.

   | Job | Holes (unique stock positions) | Inside the kept part | Depth | Tiled-save warnings |
   |---|---|---|---|---|
   | 390 × 300 blank, default 380/20 tiling, default "Configure registration" draft | 2 | **2** (373.41, 143.41) and (373.41, 333.41) | Z−6.00 = through the 6 mm blank, Ø3.175 | **none** (one generic starter-feeds line) |
   | 320 × 120 blank + pocket, 150 × 200 tiles | 4 | **2**, one in the pocket floor | Z−8 (Ø6.35 plan) | **none** |
   | same, 150 × 80 tiles (3 × 2) | 14 | **13** | Z−8 | **none** |

2. **N4-P2-1. At a tile edge, each clipped piece re-enters with a straight plunge at the plunge feed.**
   - A helical-entry pocket goes from 0 plunges into fresh stock to 30.
   - A profile loses its lead-in: it plunges on the finished-wall path at every level.
   - Only contour ramps are disclosed, and the advisory calls a profile's ramp "Tiled V-carve output".
3. **N4-P3-1.** The overlap strip is cut twice: 1.31× the untiled cutting length at 3 × 1 tiles, 1.69× at 3 × 2.
4. **N4-P3-2.** The nest spacing both nest dialogs start at (bit + 1 mm = 4.2 mm) is just short of what the default arc lead needs. At 4.2 mm every pass on the facing edge plunges onto the cut line; this is announced. At 5 mm the leads stay.
5. **N4-P3-3.** The surfacing wizard cuts one bit radius past every edge of the area it is given, including behind and left of the zeroed corner (12.7 mm with a 1" cutter). The panel never says so.

**Reach and holder: no new gap.** With a recorded flute length or stickout, Save and Start warn ("Cut depth 19 mm exceeds the recorded 12.7 mm flute length"). Two KNOWN items were re-observed. No catalogue bit has a flute length, so a 1/8" end mill cutting 19 mm deep gets nothing (JR-5). The tiled save runs no reach review (F7-P3-2).

## Results

### Transforms (A = transformed object, B = pre-transformed identity twin, C = B with winding reversed)

| Cut setting (4 shapes; drill on circle and triangle only) | Transforms | A = B | C = B | Direction vs identity (machine frame) | Offset side |
|---|---|---|---|---|---|
| Outside, Inside (Climb), Outside Conventional, Outside/Inside Default direction | rot 17/90/180, mirror X, Y, 2×1, 0.5×3, mirX+17°+2×1, mirY+90°+0.5×3 | 9/9 each, **byte-identical** | identical | kept in every case (outside CW, inside CCW for Climb) | outside: deepest-level points at R and outside the outline; inside: at R and inside |
| Outside with tabs (6 mm in 12 mm stock: tabs skipped by ADR-258 Amd 1) | same | identical | identical | kept | kept |
| Through-cut with tabs (6/6 mm, 4 mm tabs), Outside / Inside / On path, plus a rectangle with a hole | id + the 8 above | **108/108 identical**, 4 tab rises per loop (8 with the hole) everywhere | — | — | — |
| On path | same | identical | **differs (36/36)** | **flips under every mirror** (16 cases); reversed winding flips it too | on the line |
| Offset pocket, helical pocket, V-carve, drill | same | identical | identical | pocket and helix CCW (G3) everywhere | — |
| Text object (non-zero glyph union), V-carve and pocket | mirror X/Y, 2×1, 0.5×3, 17°, mirX+33°+1.7×0.6 | **12/12 identical** | — | — | — |

- **Warnings:** Job Review lines identical between A and B for all 42 shape and cut pairs under the combined transform.
- **V-carve depth** follows the transformed width: 4.675 mm on the glyph, the 5.499 mm cone limit at 2×1. B gives the same.
- **Arcs.** No profile, pocket ring or V-carve emits G2/G3. Helix arcs stay G3 under mirror and non-uniform scale, with start and end radius equal (|Δr| = 0.0000). On the 0.5×3 ellipse (10 mm wide) the helix touches the wall's cutter line exactly (min distance 1.587 = R): no gouge.
- **Curves after scale-up** (On-path centreline against the true curve, sampled every 0.01 mm):

  | Curve | Segments | Max deviation |
  |---|---|---|
  | r 2 mm × 20 | 90 | 0.0247 |
  | r 2 × (20, 5) ellipse | 90 | 0.0239 |
  | r 2 × 20, 17°, mirror X | 90 | 0.0248 |
  | r 40 drawn (twin) | 90 | 0.0247 |
  | r 2 × (0.5, 8) | 58 | 0.0227 |

  `flattenColoredPathCurvesForTransform` divides the tolerance by the larger scale (`curve-path.ts:121-125`), and the transform has no skew (`transform.ts:10-21`), so that bound is exact.

### Tiling (each tile translated back to stock coordinates)

| Case | Tiles / files | Dropped (untiled cut not in any tile) | Extra (tile cut not in untiled) | Deepest Z | Cutting length (tiles / untiled) | Plunges into fresh stock, run in index order: untiled → tiles |
|---|---|---|---|---|---|---|
| T1 3 × 1, 150 × 200, overlap 20, Ø6.35 registration | 3 / 9 | 0.001 mm (sampling) | only entry plunges at tile edges (≤ 4.81 above the level) | −6.000 both (−8 = registration) | **1.31×** | pocket 2 → 32; profile 7 → 13; registration 67 |
| T2 overlap 0 | 3 / 7 | 0.001 | entry plunges only | −6.000 | 1.02× | pocket 2 → 32; profile 7 → 13 |
| T3 ramp 5° profile + helical pocket | 3 / 9 | 0.026 (the helix's chords) | entry plunges only | −6.000 | 1.31× | **helical pocket 0 → 30**; profile 4 → 10 |
| T4 3 × 2, 150 × 80 | 6 / 13 | 0 (the diagnostic's 4.81 was a registration hole masking pocket points) | entry plunges only | −6.000 | **1.69×** | — |
| T5 adaptive pocket (falls back to offset rings, notice shown) | 3 / 9 | 0.001 | entry plunges only | −6.000 | 1.31× | as T1 |

- **Rapids.** No G0 below Z0 lands where the same file has not already cut to that depth: 0 in every tile file. Clipping strips the air-floor certificate (`tile-plan.ts:186-188`).
- **Tabs** survive clipping. Tile pieces carry the same Z rises, and nothing was dropped.
- **Registration positions:** adjacent tiles bore identical stock positions (`tile-registration.ts:75-92`; each pair ×2 in the table above).
- **Bit files.** A tile that needs more than one bit is written per bit, and the advisory says so. In T1 the profile's own 1/8" bit comes back as bit 3 of 3 after the V-bit (ADR-392 Amd 2; by design).

### Reach and holder (Save/Start reach review, then the tiled save of the same job)

| Bit (1/8" end mill) | 4 × 60 slot, 15 deep | 30 mm pocket, 19 deep | Profile, 19 deep | Pocket, 10 deep | Tiled save |
|---|---|---|---|---|---|
| Catalogue (no assembly data) | nothing | nothing | nothing | nothing | nothing |
| Flute 12.7, shank 6.35 | "Cut depth 15 mm exceeds the recorded 12.7 mm flute length" | "…19 mm exceeds…" | "…19 mm exceeds…" | unknown stickout/holder disclosure only | **nothing** |
| Flute 12.7, stickout 20, ER11 Ø19 at 20 | flute warning | flute warning | flute warning | — | **nothing** |
| Flute 22, stickout 25, holder at 25 | — | — | — | — | nothing |

- **Holder against the stock.** A holder starts at or above the stickout (`cnc-tool-reach.ts:143-175` (`assemblyContradictions`) flags one below), so it enters a 2.5D cut only when depth > stickout, and `stickout-reach` covers that. A shank wider than the cutter enters only past the flute length, which `flute-reach` covers (READ). Fixtures are swept separately.
- Every review with reach data also carries F7-P3-1's generic lines ("initial approach … not evaluated", "Path coverage is incomplete").

### Surfacing (`buildSurfacingProgram`, my heightfield)

| W × H, bit, stepover, depth | Passes × rows | Area cells not at the total depth | Over-deep | Cut past the area | Rapids into stock | Plunges |
|---|---|---|---|---|---|---|
| 100 × 37.3, 25.4, 40 %, 1.2 in 0.5 | 3 × 5 | 0 / 373,000 | 0 | **12.65 mm** (R 12.7) | 0 | 3 at F500 |
| 100 × 37.3, 25.4, 100 %, 0.5 | 1 × 3 | 0 | 0 | 12.65 | 0 | 1 |
| 60 × 41, 6.35, 75 %, 0.9 in 0.3 | 3 × 10 | 0 | 0 | 3.12 | 0 | 3 |
| 60 × 30, 6.35, **100 %**, 1 | 1 × 6 | 568 cells on the touching lines (rows exactly D apart: zero-width seams, float rounding) | 0 | 3.12 | 0 | 1 |
| 50 × 0.9, 3.175, 40 % | 1 × 2 | 0 | 0 | 1.56 | 0 | 1 |
| 50 × 10, 3.175, 33.3 %, 0.6 in 0.25 | 3 × 11 | 0 | 0 | 1.56 | 0 | 3 |

- The last row lands exactly on the far edge. Corners are covered: the step to the next row runs along the edge. Each pass rapids to X0 Y0 at safe Z, then plunges at the plunge feed. The last pass stops exactly at the total depth.
- The only rapid lines below Z0 are the retracts after each pass.

### Nest spacing (two 30 mm squares, 1/8" bit, 6 mm through)

| Gap (mm) | Outside, one op: program enters the other part | Job Review | Outside, two ops: part A's cut enters B | Job Review | On path, two ops |
|---|---|---|---|---|---|
| 0.5 | 0.001 (union offset keeps the gap uncut) | MINF "gap … narrower than the bit … stays uncut" | 2.675 | `cnc-profile-cuts-kept-part` | 1.087 into B's outline, inside B's own cut (B's kept part is R = 1.59 in): no harm, no line |
| 1.5 / 2.5 / 3.0 | 0.001 | MINF | 1.675 / 0.675 / 0.175 | kept-part line | 0.087 / 0 / 0 |
| 3.175 | 0.001 | MINF | 0 | none | 0 |
| 3.5 | 0 | `cnc-profile-lead-plunge` | 0 | lead-plunge | 0 |
| **4.2 (the dialogs' value)** | 0 | **lead-plunge: "3 passes plunge straight down onto the cut line instead of using a lead-in"** | 0 | lead-plunge | 0 |
| 5 … 10 | 0 | leads kept | 0 | leads kept | 0 |

- `cncNestSpacing` gives 4.2 mm for a 1/8" Outside layer. With a 1/4" Inside layer and a 1/8" Outside layer it gives 4.2 (Inside does not count). It gives null for a pocket-only or V-carve-only project. ADR-433 Amd 4 matches each case.

## Findings

### N4-P1-1 — Tile registration holes are drilled through the parts: they are placed at fixed points on each seam with no check against the artwork, never previewed, and the tiled save says nothing

- **Where:** `src/core/cnc/tile-registration.ts:75-92` (`seamHoleCenters`). `src/core/cnc/tile-plan.ts:49-60` appends the group to each tile. `src/ui/app/tiled-output-preparation.ts:32-78` and `src/ui/app/tile-emission.ts:71-123` add no hole/artwork check.
- **Anchor:**
  - *Contract:* WORKFLOW F-CNC19 step 4 says only "Adjacent tiles use identical stock-space centers in the overlap strip". Nothing says the strip must be clear of parts or that holes can land in one. The UI says "Drill registration holes in overlap strips" (`DeviceSetupCncTilingFields.tsx:64-67`).
  - *Twin:* every other cut that reaches a part another operation keeps is checked (ADR-433 Amd 3, `cnc-kept-part-cuts.ts`, preflight `cnc-profile-cuts-kept-part`, which fires on the same layout at a 0.5 mm gap). The registration group is added after compile, so no such check sees it.
- **Evidence:** READ + REPRO (`n4-reg.ts`, `n4-tile.ts`).
  - Default tiling (380 × 380, 20 mm overlap), a 390 × 300 blank cut Outside through 6 mm, registration from `registrationDraftFromCurrentSettings`: `{"toolId":"em-3175","holeDiameterMm":3.175,"depthMm":6,…}`. Both tile files bore (373.41, 143.41) and (373.41, 333.41) to Z−6.00. Both points are inside the blank (machine X 5–395, Y 50–350).
  - In each case `tileAdvisories` [], `emissionAdvisories` [], `preparationAdvisories` [] and `machineWarnings` holds only the generic starter-feeds line.
  - 150 × 80 tiles: 13 of 14 hole positions are inside the blank.
  - 150 × 200 tiles: one hole lands in the pocket floor and is bored 8 mm through 6 mm stock.
  - The holes appear only in the tile files. `tileJobs` / `registrationGroupForTile` have no non-test caller outside the tiled save, so the canvas and Job Review never show them.
- **Scenario:** A maker tiles a 600 × 300 sign on a 400 mm machine and ticks "Drill registration holes". Configure registration takes the bit and the cut depth. The holes go wherever the seam crosses the sign: through the lettering field, the pocket floor, or the middle of the board, with a through hole at each one. The sign is ruined, and nothing warned.
- **Severity: P1.** It harms a job, with no warning. The hole is not even visible before cutting.
- **Announced?** No.
- **Novelty:** new. The 2026-07-13 workholding audit #7 covered the bore's tool and depth recipe (since fixed by the saved registration plan), not where the holes go. F7 did not cover tiling registration.
- **Fix direction:** place each seam's holes where the overlap strip is clear of every kept part and every cut (search along the seam, skipping the artwork's footprint plus the hole radius); when no clear spot exists, refuse or warn by hole. Show the holes in the preview. Optionally keep the bores to the strip outside the parts' bounding union.

### N4-P2-1 — At a tile edge each clipped piece starts with a straight plunge at the plunge feed: a pocket's helical entry and a profile's lead-in are dropped without notice, and the one advisory that does fire calls a profile's ramp a V-carve ramp

- **Where:** `src/core/cnc/tile-plan.ts:182-223` (`clipGroupToTile`). Helical contours become plain `path3d` pieces (`:202-205`), and contour pieces keep no lead. The advisories are `tiledRampAdvisories` / `hasClippedEntryRamp` (`:113-152`).
- **Anchor:**
  - *Contract:* WORKFLOW F-CNC19 discloses only ramp entries kept as plunges and V-carve pieces ("Each piece receives its own safe-Z entry at the configured plunge feed").
  - *Twin:* the untiled program enters the same pocket by helix (0 fresh plunges) and each profile level by its lead arc, off the wall (ADR-250 default-on leads exist to keep plunge marks off the kept wall).
- **Evidence:** REPRO (`n4-tile-plunge.ts`, `n4-edge-plunge.ts`; files `out/t-T3-*`, `out/t-T2-*`).
  - Plunges into fresh stock with the tiles run in index order (and reversed): helical pocket 0 → **30**; offset pocket 2 → 32; ramped profile 4 → 10; plain profile 7 → 13.
  - Profile plunges at the clip points sit on the finished-wall path: (178.41, 248.41) Z−2/−4/−6, wallDist 1.587 = R. The untiled lead starts at wallDist 3.175.
  - The T3 tile header for the profile says "cnc entry-advisory: tiled ramp starts below stock top". The save advisory reads "Tiled V-carve output is derived…" and "A tiled V-carve contour ramp crosses a tile boundary…", although the V-carve layer has no ramp and the ramp is the profile's. Nothing names the helical pocket or the lost leads.
- **Scenario:** A pocket set to helical entry (the operator's bit plunges poorly, or they want no plunge dwell) is tiled. Every ring crossing the seam starts with a straight plunge into uncut stock at the plunge feed. The outline gets a plunge dwell mark on the finished edge at each seam, at every depth level.
- **Severity: P2.** It ignores an entry setting and marks the kept edge, but the plunge runs at the plunge feed and stays within the depth per pass. Not P1: a centre-cutting end mill survives it.
- **Announced?** Partly. Contour ramps are announced (mislabelled as V-carve). Helical entry and leads are not.
- **Novelty:** new (tiling was read only in J1; F7-P3-2 is reach only).
- **Fix direction:** give each clipped piece an entry. Start it inside the overlap, where the neighbouring tile has already cut, or ramp it along its own path; lead it off the wall for profiles. Otherwise list the affected layers and entries in the tile advisory, with wording that names the actual cut type.

### N4-P3-1 — The overlap strip is cut twice, so every cut inside it runs in both tiles

- **Where:** `src/core/cnc/plan-tiles.ts:12-24` (rectangles overlap by `overlapMm`) and `tile-plan.ts:49-50,89-97` (each tile clips the whole job to its own rectangle).
- **Evidence:** REPRO. Cutting length is 1.31× the untiled program at 3 × 1 tiles with 20 mm overlap and 1.69× at 3 × 2. With overlap 0 it is 1.02× (seam entries only). Small features inside the strip, drill holes included, run twice.
- **Severity: P3 (structural).** The geometry is identical, so the re-cut runs in air when registration is exact. It costs time, and any registration error re-cuts finished walls in the strip. The overlap's purpose (registration, pre-cleared entries) does not need every cut repeated.
- **Announced?** The disclosure gives the overlap and step only. **Novelty:** new.
- **Fix direction:** assign each cut in the strip to one tile (split at the strip's midline, keeping the overlap for entries and registration), or state the duplicated length in the tile advisory.

### N4-P3-2 — The nest spacing both dialogs start at (bit + 1 mm) leaves too little room for the default arc lead, so the facing edges plunge onto the cut line

- **Where:** `src/core/cnc/cnc-nest-spacing.ts:15,38` (`CNC_NEST_SPACING_MARGIN_MM = 1`), used by `QuickNestDialog.tsx:117` and `production-nest-form.ts:26`.
- **Evidence:** REPRO (`n4-nest-lead.ts`). Two squares 4.2 mm apart (the 1/8" value), one op or two: `cnc-profile-lead-plunge: Layer L1: 3 passes plunge straight down onto the cut line instead of using a lead-in, because a lead-in there would cut into a part next to it`. At 5 mm and above, the leads are kept.
- **Severity: P3.** It is announced, and it stays safe: the lead check (ADR-250 Amd 3) refuses the lead rather than gouge the neighbour. But the recommended value produces the edge marks leads exist to avoid.
- **Novelty:** new. ADR-433 Amd 4 sized the margin for the bit only.
- **Fix direction:** include the default lead's reach in the spacing (≈ bit + lead radius + margin), or say in the dialog that closer spacing turns leads into plunges.
- Related but by decision, not raised: Quantity production's Part spacing has no warning when lowered (ADR-433 Amd 4 point 3 scoped it to "starts there"). A part placed too close is still caught at Job Review (table above).

### N4-P3-3 — The surfacing wizard faces one bit radius past every edge of the area, behind and left of the zeroed corner too, and the panel does not say so

- **Where:** `src/core/cnc/surfacing.ts:155-195` (tool centre on X 0..W, Y 0..H). UI text: `SurfacingFields.tsx:109-120` ("Area width to face (X).") and `SurfacingPanel.tsx:74-75` ("zero X/Y at the area's front-left corner").
- **Evidence:** REPRO (`n4-surf.ts`). The cut reaches 12.65 mm (grid) past every edge with a 25.4 mm cutter, 3.12 mm with 1/4".
- **Severity: P3.** Coverage is complete and correct, and running off a spoilboard's edge is normal. But an area set against a fence, a stop block or a clamp near the front-left zero gets cut into by up to half the cutter, and nothing says the faced area is (W + D) × (H + D).
- **Novelty:** new.
- **Fix direction:** state the faced footprint in the panel or the saved note ("the cutter reaches R past each edge, including left of and in front of X0 Y0"), or offer "keep the cutter inside the area" (centre on R..W−R).
- Seen but not raised: 100 % stepover is allowed and places rows exactly one diameter apart (zero-overlap seams). An ideal flat bit is exact; a bit with corner radii leaves ridges. The tooltip already says wider rows leave strips.

## KNOWN status (re-observed, not re-raised)

- **JR-5 (09-24; F7 KNOWN):** no starter or catalogue end mill has `fluteLengthMm`. A 1/8" end mill 19 mm deep in 19 mm stock gets no reach line at all (`cnc-program-reach.ts:35`: no fixtures and no reach data → `[]`). Still open.
- **F7-P3-2:** the tiled save runs no reach review. The flute-12.7 bit at 15–19 mm warns on Save and Start and is silent in the tiled save of the same job. Still open (`tiled-output-preparation.ts` has no `cncProgramReachWarnings` call).
- **F7-P3-1:** every review with reach data carries the generic "initial approach … not evaluated" and "Path coverage is incomplete" lines. Still open.
- **2026-07-25 full-chain survivor "Cut direction inert for On path":** On-path loops follow the drawn winding (`motion-polish.ts:118-125` returns null for On path), so a mirror flips the cut direction of an On-path cut (16 of 16 mirrored cases) while Climb is shown. Consequence re-observed; not re-raised.
- **F7-P2-1 / F7-P2-2:** fixed as far as N4 touched them. Depth now comes from the compiled job (ADR-572 Amd 2), so a deep cut reports its depth. The cutter is checked against fixtures without a flute length (Amd 1, `cnc-tool-reach.ts:212-224`).

## Verified clean

- **Transforms:**
  - 378 + 108 + 12 transformed programs equal their pre-transformed twins byte for byte: rotation, mirror, uniform and non-uniform scale, and combinations.
  - Offset side, Climb and Conventional direction for Outside, Inside and pocket, tab count and placement, helix direction, V-carve depth, drill centres and warnings all match.
  - Winding does not matter except On path (KNOWN).
  - Curves stay within the 0.025 mm tolerance after 20× and non-uniform scale-up.
  - No circular G2/G3 is emitted for a non-uniformly scaled circle.
  - The helix stays inside a narrow ellipse.
- **Tiling geometry:**
  - No cut dropped (≤ 0.001 mm; 0.026 mm where a helix is clipped as chords). No cut added except entry plunges at tile edges. Deepest Z, levels and tabs are preserved.
  - No rapid into uncut stock in any tile file.
  - Registration holes sit at identical stock positions in adjacent tiles.
  - Bit files are split and named, and the multi-bit advisory fires.
- **Reach:** the flute and stickout depth checks fire on compiled depth whenever the data exists. Holder and shank against the stock are covered by those two depth checks for 2.5D cuts (READ + REPRO).
- **Surfacing:** the whole requested area is faced to exactly the total depth (0 cells missing except zero-width seams at exactly 100 %). Nothing over-deep, corners covered, no rapid into stock, the plunge at the plunge feed, the last pass at the total depth.
- **Nest:**
  - Spacing = widest Outside/On-path bit + 1 mm, matching ADR-433 Amd 4.
  - Parts closer than the bit are reported: MINF on one operation, `cnc-profile-cuts-kept-part` across operations. On one operation the union offset keeps the gap uncut, as the message says.
  - On-path cross-operation overlap stays inside the neighbour's own cut, so it is correctly silent.

## Not verified

- A machine run of tile files (simulator) and physical registration with dowels (N5's ground).
- The tiled-save UI flow beyond `finalizeTiledOutput` (pickers, folder checks); the rendered Job Review dialog.
- Stroke-outline V-carve (`strokeWidthMm` with `strokeTransform`) under non-uniform object scale.
- Relief, two-sided and inlay pairs under object transforms (N2 / N6 ground).
- Drill on non-circular shapes: the hole goes at the bounding-box centre of the transformed outline, so it moves relative to a rotated asymmetric shape. Both twins agree; this is a design choice (`drill-peck.ts:1-5`), not measured further.
- Surfacing against the controller's travel limits (`standaloneCncSetupAdvisories` was not exercised).
- Fixture (clamp) sweeps with holder segments. Only depth findings were exercised; F7 covered fixtures.

## Repro files

All in `…\scratchpad\zz-n4\`, run with `node --no-experimental-webstorage --import ./register.mjs <file>`; outputs in `out\`.
- `n4-reader.ts`: my G-code reader, sampling and 3D Hausdorff. `n4-common.ts`: project builder, emit, Job Review lines. `globals.ts`: build-info globals for the tiled save core.
- `n4-xform.ts` → `out/xform-table.txt`, `out/xform-run.txt`: 378-case transform twin and winding sweep.
- `n4-xform-tabs.ts` → `out/xform-tabs-report.txt`: 108 through-cut tab twins.
- `n4-text.ts` → `out/text-report.txt`; `n4-curve.ts` → `out/curve-report.txt`; `n4-helix.ts` → `out/helix-report.txt`.
- `n4-tile.ts` → `out/tile-report.txt` and `out/t-*.nc`: tiled versus untiled, T1–T5.
- `n4-tile-diag.ts`: dropped and extra points by line. `n4-tile-plunge.ts`: fresh-stock plunges by layer, both run orders. `n4-edge-plunge.ts` → `out/edge-plunge-T2.txt`, `-T3.txt`: plunge sites and wall distance.
- `n4-reg.ts` → `out/reg-report.txt`, `out/reg-*.nc`: **N4-P1-1** with default tiling and the default registration draft.
- `n4-reach.ts` → `out/reach-report.txt`; `n4-surf.ts` → `out/surf-report.txt`; `n4-nest.ts` → `out/nest-report.txt`; `n4-nest-lead.ts` → `out/nest-lead-report.txt`.

## Counts

- **Raised:** 5 → **P1 1** (N4-P1-1) / **P2 1** (N4-P2-1) / **P3 3** (N4-P3-1..3).
- **KNOWN re-observed:** 4 open (JR-5, F7-P3-2, F7-P3-1, the On-path cut-direction survivor); F7-P2-1/2 confirmed fixed.

```json
[
  {"id":"N4-P1-1","severity":"P1","area":"transforms-tiling-reach","file":"src/core/cnc/tile-registration.ts","line":75,"anchor":"Contract: WORKFLOW F-CNC19 step 4 (holes in the overlap strip, nothing about parts); Twin: ADR-433 Amd 3 kept-part check covers every other cut","evidence":"REPRO","known":false,"summary":"Registration holes go at fixed 1/4 and 3/4 seam points in the overlap strip with no artwork check and no preview; default tiling + default registration draft bores two 3.175 mm holes through a 390x300 blank to Z-6 (through 6 mm), 13 of 14 holes inside the blank on 3x2 tiles; tiled save advisories and warnings empty"},
  {"id":"N4-P2-1","severity":"P2","area":"transforms-tiling-reach","file":"src/core/cnc/tile-plan.ts","line":182,"anchor":"Twin: untiled program enters by helix and lead arc; Contract: WORKFLOW F-CNC19 discloses only ramps and V-carve pieces","evidence":"REPRO","known":false,"summary":"Clipped pieces re-enter at the tile edge with straight plunges at plunge feed: helical pocket 0 -> 30 fresh-stock plunges, profile leads replaced by plunges on the finished-wall path (wallDist = R) at every level; only contour ramps are disclosed and the advisory calls a profile ramp 'Tiled V-carve output'"},
  {"id":"N4-P3-1","severity":"P3","area":"transforms-tiling-reach","file":"src/core/cnc/plan-tiles.ts","line":12,"anchor":"structural","evidence":"REPRO","known":false,"summary":"Every cut inside the overlap strip runs in both tiles: 1.31x the untiled cutting length at 3x1 / 20 mm overlap, 1.69x at 3x2"},
  {"id":"N4-P3-2","severity":"P3","area":"transforms-tiling-reach","file":"src/core/cnc/cnc-nest-spacing.ts","line":15,"anchor":"Twin: ADR-250 default arc leads","evidence":"REPRO","known":false,"summary":"The nest spacing both dialogs start at (bit + 1 mm, 4.2 mm for 1/8\") turns the facing edge's leads into plunges onto the cut line (announced); 5 mm keeps them"},
  {"id":"N4-P3-3","severity":"P3","area":"transforms-tiling-reach","file":"src/core/cnc/surfacing.ts","line":155,"anchor":"Contract: panel text 'Area width to face', 'zero X/Y at the front-left corner'","evidence":"REPRO","known":false,"summary":"Surfacing faces R past every edge of the entered area (12.7 mm with a 1\" cutter), behind and left of the zeroed corner too; not disclosed"}
]
```

## Refuter (2026-11-13)

**Tree and harness.** Same read-only export `j38-main` (`origin/main` @ `9a0b1a80b`). `git diff --stat 9a0b1a80b origin/main` (now `045670634`) over `src/core/cnc src/core/geometry src/ui/laser src/ui` is **not empty**, but it touches only relief rest step-down (`compile-cnc-relief*.ts`), V-carve/relief compiled-depth and relief reach warnings, Save Original Image and convert-to-path. No tiling, registration, transform, surfacing, nest-spacing, emitter or tiled-save file changed, so every N4 result stands on current main.

My scripts are in `zz-n4r\`. Run each with `node --no-experimental-webstorage --import ./register.mjs <file> [args]`. I read `n4-common.ts`, `n4-reg.ts` and `n4-tile.ts` for API shape only; nothing imports a `zz-n4` file.
- **Own builder** (`r-build.ts`): `createProject` / `createLayer`, the Save path (`emitGcode`), `prepareOutput` + `detectMachineJobWarnings`, the tiled Save core (`finalizeTiledOutput`) with `tileJobs` for each tile's rectangle, and `registrationDraftFromCurrentSettings` for the "Configure registration" draft.
- **Own G-code reader** (`r-gc.ts`): modal G0–G3 (I/J arcs at 0.02 mm sagitta), G90/G91, G20/G21, F, and the `layer-id:` comment; point-in-polygon and edge distance. It shares no code with the CAM, the emitter or `n4-reader.ts`.
- **Own measures, different from the auditor's:**
  - registration bores are clusters of every below-Z0 feed point in the `tile-registration` section, centred by their XY extent, then classified against the drawn parts **and the stock rectangle**;
  - plunge harm is judged by what is under the bit: whether its **centre** and what share of its **footprint** (61 points in a disc of R − 0.1) were already cut to the plunge depth by earlier moves of the same physical run (tiles in index order and reversed);
  - seam coverage is a two-way XYZ sample match (0.1 mm steps, 0.06 mm tolerance) between the untiled program and the pooled tiles.
- **Own geometry:** a 1000 × 150 sign with a lettering pocket on a board 10 mm larger; eight Ø90 coasters; a 600 × 300 panel in 12 mm under 3 × 2 tiles; a 160 × 80 pocket and a 340 × 180 outline in 12 mm stock; a 280 × 120 plate with a V-carved 12-point star, three drills and six tabs; an L flag, a scalene triangle and a disc with a square island under four transforms.
- **Not used:** Vitest, pnpm, a browser, hardware, the GRBL simulator. Node stayed under 900 MB with ≥ 2.5 GB free.

### Verdicts

| Finding | Verdict | Severity | Evidence (own) |
| --- | --- | --- | --- |
| N4-P1-1 | **CONFIRMED and wider (bores also land off the board), but KNOWN:** it is AC-5 of the 2026-09-24 CNC full audit ("Tile registration holes can land on the finished face or off the board"), still open at 09-29, re-observed as E3-K-1 (controller v4) at P3. Novelty refuted; severity **re-rated P1** under METHOD §3 | **P1** (KNOWN AC-5) | `r-reg.ts` → `out/reg.txt`, `out/reg-*.nc`; READ `tile-registration.ts:16,75-92`, `machine.ts:311-316`, `tile-registration-plan.ts:28-30`, `DeviceSetupRegistrationFields.tsx:13-27`, `cnc-stock-warnings.ts:21-41` |
| N4-P2-1 | **CONFIRMED, KNOWN, extended:** it is P2-advcam-1 (2026-09-29, open; E3-K-2 P2; F4 K-9), which already names the seam plunges, the helix and the V-carve wording on profile layers. New facet: a profile's lead-in is replaced by a plunge **on the cutter line** at every level. The auditor missed that the clipped helix still runs at the **cutting** feed | **P2** (KNOWN P2-advcam-1) | `r-entry.ts` → `out/entry-px130.txt`, `out/entry-px60.txt`, `out/entry-*.nc` |
| N4-P3-1 | **CONFIRMED.** The ratio depends on how much work sits in the strip: 1.074× (3 × 1, 20 mm), 1.078× (3 × 2), 1.148× (40 mm), 1.000× (0 mm) on my plate; nothing names the repeat | P3 | `r-misc.ts overlap` → `out/misc-overlap.txt` |
| N4-P3-2 | **CONFIRMED and sharpened:** the lead is refused below exactly 3R (4.7 mm blocked, 4.8 mm kept, 1/8"), and only when the loop's start lands on the facing edge. Two 40 × 25 parts side by side at 4.2 mm get no lead line at all, because the start goes to a long edge that faces away | P3 | `r-nest2.ts` → `out/nest2.txt`; `r-misc.ts nest` → `out/misc-nest.txt` |
| N4-P3-3 | **CONFIRMED, one wording fix:** the cutter reaches R **left of and in front of** the front-left zero (not "behind"). The file's own header says only "zero X/Y at the front-left corner of the area" | P3 | `r-misc.ts surf` → `out/misc-surf.txt` |

**N4-P1-1: CONFIRMED and wider; KNOWN (AC-5); P1.**

Setup: the default tiling (380 × 380, 20 mm overlap) or the tile size shown, and the registration plan from `registrationDraftFromCurrentSettings`, exactly as "Configure registration" makes it (`out/reg.txt`):

| Job (stock = parts + margin) | Draft | Unique bores | In a part | **Off the stock** | Waste | Any tiled-save line |
| --- | --- | --- | --- | --- | --- | --- |
| R1: 1000 × 150 sign + lettering pocket, 6 mm, 3 × 1 | Ø3.175, Z−6 (the Outside layer's depth) | 4 | **2, both in the lettering pocket's floor** (378.41, 313.41) and (738.41, 313.41), bored through | **2, 123.4 mm past the board edge** | 0 | **none** (all four lists empty) |
| R2: eight Ø90 coasters, 250 × 380 tiles | Ø3.175, Z−6 | 2 | 0 | **1, 81.9 mm off** | 1 (2.40 mm from a coaster, by chance) | none |
| R3: 600 × 300 panel, 12 mm, 250 × 200 tiles (3 × 2) | Ø3.175, Z−12 | 14 | **11** | **3** (13.4–30.9 mm off) | 0 | none |
| R4: as R1, but the first layer is a 3 mm pocket | Ø3.175, **Z−3** (the pocket's depth) | 4 | 2 | 2 | 0 | none |

- **Why off the board.** The bores sit at 1/4 and 3/4 of the **tile's** height (`tile-registration.ts:77-90`), and the tile rectangles are not clipped to the job or the stock. A job shorter than a tile, the usual long-sign case, always puts the 3/4 bore beyond the work. `cnc-stock-warnings.ts` checks only the untiled prepared job, so nothing warns that a bore leaves the board: it drills 6 mm into the spoilboard, or into a clamp or hold-down.
- **Defaults.** Ticking "Split this job into indexed tiles" sets `DEFAULT_CNC_TILING`, whose `registrationHoles` is **true** (`machine.ts:311-316`). The tiled export then refuses until the operator clicks **Configure registration** or unticks the box (`tile-registration-plan.ts:28-30`). So there is one deliberate click, but its hint speaks of "hole size, depth and feeds" and never of position. The draft takes the cutter from the default bit and the depth from the first CNC layer, so a through-cut first layer gives through-bores.
- **Preview or listing.** None anywhere. `tileJobs` / `registrationGroupForTile` have no caller outside the tiled save (`tiled-output-preparation.ts:48`). Job Review, the canvas, the 3D pane and Startup Setup's review ("Tiling: On") show no bore, and the tile files name none. The only route is to open a written tile file as G-code and read the `tile-registration` moves in tile coordinates.
- **The docs promise more than exists.** The tiling tutorial says "You can compare the planned spacing and optional registration holes with the physical fixture" (`production-tool-tutorials.ts:196`), but there is nothing to compare against.
- **Lowering tests (METHOD §3).**
  - *Is the output wrong?* Yes. The label "Drill registration holes in overlap strips" names a band, but not that the band crosses the part, nor that a bore can fall off the board. A registration feature needs neither: R2 shows a clear spot exists by chance, and a seam always has stock margin at its ends.
  - *Does a clear warning reach the operator?* No. All four advisory lists are empty in every case (G6: the app must name the specific mismatch).
  - So P1 stands. E3 rated AC-5 P3 on 2026-10-22, the day before the meta-audit clarification that P1 has no reach clause. The ledger should carry AC-5 as **KNOWN, P1** rather than as a new finding.
- **What a correct design would do:**
  - search along each seam inside (overlap strip ∩ stock), minus the parts and every cut footprint grown by the bore radius plus a margin;
  - if the strip has no clear spot, fall back to the board margins at the seam's ends;
  - keep two bores per seam as far apart as possible, and refuse or warn, naming the seam, when none fits;
  - list the bore centres per tile (stock and tile coordinates) in the tile advisory and the file header, and draw them in Preview.

**N4-P2-1: CONFIRMED, KNOWN (P2-advcam-1), extended; P2.**

Setup: 12 mm stock; a 160 × 80 pocket 6 deep (2 per pass, helix 6/2/3°) and an Outside profile 6 deep with the default arc lead; 200 × 300 tiles, 20 mm overlap, no registration. "Centre" means the bit's centre plunges into stock not yet cut to that depth; "footprint" means any stock under the bit (`out/entry-px130.txt`; the pocket moved left in `px60` gives the same picture).

| Layer | Untiled | Tiles, index order | Tiles, reversed |
| --- | --- | --- | --- |
| Helical pocket | 2 descents, **nothing under the bit**; helix G3 at **F300** | 188 plunges: centre 0, **footprint 93** (≤ 2.00 mm, one depth per pass); the helix runs as G1 at **F1000** | 188: centre 3, footprint 93 |
| Plain pocket (twin) | 3 plunges, centre 3 | 189: centre 3, footprint 96 | 189: centre 6, footprint 96 |
| Profile, arc lead | 3 plunges **3.175 mm off the outline** (lead start) | 9 plunges, **6 on the cutter line** (wall distance = R), each with 2 mm under the centre | same |
| Profile, ramp 5° | 2 plunges, nothing under the bit | 11 on the cutter line, 3 into uncut centre | 11, 6 into uncut centre |

- **Different measure, same conclusion.** My centre test finds fewer full plunges than the auditor's "0 → 30", because in index order an adjacent ring has usually cleared the bit's centre already. But the helix's purpose (no straight plunge into stock) is lost: 48–96 plunges per run land with stock under part of the bit.
- **Missed by the auditor; still open from P2-advcam-1.** A clipped helix becomes a `path3d` with no `lateralFeed` (`tile-plan.ts:202-205`), so `path3dSegmentFeed` returns the cutting feed (`cnc-grbl-strategy.ts:425-426`). The full-width helix runs at F1000 instead of F300, 3.3× faster. Its Z rate stays low (36 mm/min at 3°).
- **Advisory wording.** With ramp 5° on a job that has **no V-carve layer at all**, the tiled save still says "Tiled V-carve output is derived…" and "A tiled V-carve contour ramp crosses a tile boundary…". The helical pocket and the lost leads get no line, and the tile headers say nothing either.
- **Severity: P2 stands.**
  - Every plunge is at the plunge feed and within one depth per pass.
  - The profile's plunge mark sits on the finished wall at each seam and level: a quality defect.
  - A non-centre-cutting bit is not the norm for router end mills.
- **Fix direction:** P2-advcam-1's (split a clipped helix into a plunge-fed descent and its level contour, or keep native arcs inside a tile), plus give each clipped profile piece a lead, or start it inside the overlap that the neighbouring tile has cut. The advisory should name the layer and the entry type, not "V-carve".

**N4-P3-1: CONFIRMED P3.** The repeated length is the work inside the strip, so the ratio varies with layout. It is 1.07–1.15× on my plate against the auditor's 1.31–1.69×; with 0 mm overlap it is 1.000×. No advisory mentions it.

**N4-P3-2: CONFIRMED P3, sharpened.**
- The lead is refused below exactly **3R = 4.7625 mm** for the 1/8" bit: a lead start 2R off the cut line plus the cutter radius. Measured: 3.5 / 4.2 / 4.7 mm get `cnc-profile-lead-plunge` (one op and two ops alike); 4.8 / 5.0 mm keep the lead.
- It bites only when the loop start, which Climb rotates to the longest edge, faces the neighbour. Tall 25 × 40 parts side by side and 30 mm squares do; 40 × 25 parts at 4.2 mm do not.
- The fix is unchanged: spacing ≥ D + 2R_lead + margin, or say so in the dialog.

**N4-P3-3: CONFIRMED P3.**
- 300 × 200 with a 25.4 mm cutter: tool centre X 0..300, Y 0..200; cutter edge X −12.7..312.7, Y −12.7..212.7. With 6.35 mm: ±3.175.
- Overhanging the spoilboard edge is the normal surfacing practice, and the overhang is visible when zeroing with the bit on the corner. The risk is a fence or stop at the zeroed corner standing above the faced depth. That makes P3 (disclosure) right.

### Challenges to "Verified clean"

- **Transforms** (`r-misc.ts xform` → `out/misc-xform.txt`). **60 / 60** byte-identical (comments stripped, preflight lists equal) between the object transform and the pre-transformed twin.
  - Cut settings: On path Climb; Outside Conventional through-cut with tabs; Inside Climb with a 6° ramp; V-carve 60°; pocket with a helix.
  - Shapes: an L flag, a scalene triangle, and a disc with a square island.
  - Transforms: mirror X, mirror Y + 37°, scale 2.3 × 0.6, and mirror X + 0.7 × 1.9 + 113°.
  - The claim holds, including mirror with On path (twin-equal; its direction flip against the identity is the KNOWN survivor) and V-carve under non-uniform scale.
- **Tiling geometry** (`r-seam.ts` → `out/seam.txt`): plate + star V-carve + three drills + six tabs, at four seam positions (tile width 150 / 160 / 165 / 170, 15 mm overlap).
  - Nothing untiled is missing from the pooled tiles except 29 samples of one plunge line. The untiled program plunges from its air floor (Z−1); the tile plunges the same line from safe Z, because clipping strips `airFloorZMm`.
  - The deepest Z is equal everywhere: V −5.499, drill −6.000, profile −6.000. Tab rises are 6 / 6.
  - "Extra" tile samples are only Z moves at seam points (next item). The claim holds.
- **Tab on the seam** (`r-seam-tab.ts` → `out/seamtab.txt`). With a tile edge placed mid-tab, from either side, the tab top (Z−4) and its span are identical in both tiles. The piece that starts on the tab enters from safe Z to Z−4, never below the tab top. Clean.
- **Rapids, registration symmetry, bit files.** Not re-measured beyond the above: adjacent tiles bored identical stock points in all four of my registration cases.
- **Reach.** READ only:
  - no catalogue tool sets `fluteLengthMm` (JR-5);
  - `tiled-output-preparation.ts` has no `cncProgramReachWarnings` call, while `save-output-emission.ts:98` and `job-review-cnc-reach.ts:16` do (F7-P3-2).
- **Surfacing coverage and nest detection.** The extents above agree with the auditor. Not re-swept on a heightfield.

### New findings

None raised. Every gap I found is either a KNOWN item above or harmless:

- **Bores off the board:** part of AC-5, folded into N4-P1-1.
- **The cutting-feed helix:** part of P2-advcam-1, folded into N4-P2-1.
- **The Configure registration draft takes the first CNC layer's depth** (R4: a 3 mm blind bore when a pocket layer comes first, a through bore when a through profile does). It is a reviewed draft, so not raised.
- **V-carve seam pieces descend in place.** In tile r1-c2 at its left edge, five Z-only moves start below Z0 (−1.5 → −3.0 → −4.5 → −5.499 at (153.41, 320), `r-seam-v.ts`). The next piece starts where the last one ended, so the emitter does not lift (`cnc-grbl-strategy.ts:399`, `alreadyAtStartXy` in the path3d branch). It descends at the plunge feed, exactly as a safe-Z entry would at that point.
  - F-CNC19 says "Each piece receives its own safe-Z entry at the configured plunge feed": the feed is right, the lift is skipped. That is harmless wording drift, so not raised.

### Probes with no gap (new-gap search)

- **Tabs crossing a seam:** kept in both tiles at the same top Z and span; no entry below the tab top.
- **V-carve and drills across a seam:** no depth lost (−5.499 / −6.000 in both). Drills in the overlap are bored by both tiles (N4-P3-1's class).
- **Tile order:** reversing the run order changes only how many seam plunges meet uncut stock (table above). No rapid enters stock in either order.
- **Registration depth versus the spoilboard.** A bore deeper than the stock gets no spoilboard line, but the draft copies the first layer's depth, so a through-cut job bores through as intended. Not raised.
- **Origin per tile:** each tile's zero is its rectangle's minimum corner, which starts at the toolpath minimum. The files do not say where that is on the board: KNOWN, AC-5's second half.
- **Surfacing with the zero not at the front-left corner:** KNOWN CO-2 (E3-K-4). Not re-run.

### Not verified

- A simulator or machine run of the tile files, and physical dowel registration (N5).
- Text objects under transforms. The auditor ran 12; I did not repeat them.
- `cncNestSpacing` with mixed Inside / Outside bits: not re-run.
- The reach table: READ only, nothing re-run.
- The surfacing heightfield, and stepover at exactly 100 %.
- Whether any real fence or clamp sits above the faced depth at the zeroed corner (N4-P3-3's physical risk). This is reasoned, not measured.
- **Vitest:** none run.

### Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-n4r\`. Run each with `node --no-experimental-webstorage --import ./register.mjs <file> [args]`. Outputs go to `out\`. Nothing in the repo or in `j38-main` was touched.

| File | Covers | Output |
| --- | --- | --- |
| `r-build.ts` | Own project builder: Save path, prepare, Job Review lines | — |
| `r-gc.ts` | Own G-code reader; point-in-polygon and edge distance | — |
| `r-reg.ts` | N4-P1-1: bores against the parts and the stock, R1–R4, with the default draft | `out/reg.txt`, `out/reg-*.nc` |
| `r-entry.ts` (`PX0`/`PX1` env) | N4-P2-1: plunge centre and footprint, cutter-line plunges, helix feed, advisories | `out/entry-px130.txt`, `out/entry-px60.txt`, `out/entry-*.nc` (`out/entry.txt` is an earlier, superseded run) |
| `r-misc.ts overlap\|nest\|surf\|xform` | N4-P3-1, nest spacing value, N4-P3-3 extents, 60 transform twins | `out/misc-*.txt` |
| `r-nest2.ts` | N4-P3-2: the lead threshold on facing edges | `out/nest2.txt` |
| `r-seam.ts` (`TW` env), `r-seam-diag.ts`, `r-seam-v.ts`, `r-seam-tab.ts` | Seam coverage; plunge-artefact diagnosis; V-carve in-place descents; a tab on the seam | `out/seam.txt`, `out/seamtab.txt`, `out/seam*-*.nc` |

```json
{
  "area": "N4",
  "role": "refuter",
  "tree": "9a0b1a80b (origin/main 045670634 differs only in relief rest, compiled-depth/relief-reach warnings, Save Original Image and convert-to-path; no tiling, registration, transform, surfacing, nest or emitter file)",
  "verdicts": [
    {"id": "N4-P1-1", "verdict": "CONFIRMED and wider; KNOWN (AC-5, 2026-09-24; E3-K-1 P3)", "severity": "P1", "evidence": "REPRO default draft: 1000x150 sign 2 bores in the lettering pocket floor through 6 mm + 2 bores 123.4 mm off the board; 600x300 panel 3x2 11 of 14 in the part + 3 off the board; coasters 1 off the board; all tiled-save lists empty; no preview anywhere; tutorial claims holes can be compared"},
    {"id": "N4-P2-1", "verdict": "CONFIRMED, KNOWN (P2-advcam-1, 2026-09-29), extended", "severity": "P2", "evidence": "REPRO helical pocket 0 -> 93 plunges with stock under the bit (centre 0-3); clipped helix G1 F1000 vs G3 F300; profile 3 lead plunges 3.175 off the outline -> 9 with 6 on the cutter line; ramp advisory says V-carve on a job with no V-carve layer"},
    {"id": "N4-P3-1", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO 1.074x (3x1/20), 1.078x (3x2), 1.148x (40 mm), 1.000x (0 mm); no advisory"},
    {"id": "N4-P3-2", "verdict": "CONFIRMED, sharpened", "severity": "P3", "evidence": "REPRO lead refused below 3R = 4.7625 mm (4.7 blocked, 4.8 kept) and only when the loop start faces the neighbour"},
    {"id": "N4-P3-3", "verdict": "CONFIRMED, wording fix (left of and in front of the zero)", "severity": "P3", "evidence": "REPRO cutter edge -12.7..W+12.7 with a 25.4 mm bit"}
  ],
  "known": [
    {"id": "AC-5", "status": "re-observed, re-rated P1 (= N4-P1-1), including bores off the board"},
    {"id": "P2-advcam-1", "status": "re-observed (= N4-P2-1): helix at cutting feed, seam plunges, V-carve wording"},
    {"id": "JR-5", "status": "READ: no catalogue flute length"},
    {"id": "F7-P3-2", "status": "READ: tiled save runs no reach review"},
    {"id": "F7-P3-1", "status": "not re-run (auditor's observation stands)"},
    {"id": "On-path cut direction survivor", "status": "twin-equal under mirror; flip vs identity not re-measured"}
  ],
  "new": [],
  "counts": {"raised": 5, "refuted": 0, "P1": 1, "P2": 1, "P3": 3, "known": 6, "note": "P1 and P2 are KNOWN items (AC-5, P2-advcam-1); genuinely new: the three P3s"}
}
```

Refuter counts: raised 5, refuted 0, P1 1, P2 1, P3 3, known 6 (N4-P1-1 is KNOWN AC-5 re-rated P1 and N4-P2-1 is KNOWN P2-advcam-1 extended; only the three P3s are new)
