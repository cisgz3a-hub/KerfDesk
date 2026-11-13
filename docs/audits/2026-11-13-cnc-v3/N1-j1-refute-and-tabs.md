# N1 — J1 refute and tab sweep (CNC audit v3, `j1-refute-and-tabs`)

**Question.** Do the five open J1 findings of CNC audit v2 (`docs/audits/2026-11-11-cnc-v2/J1-cnc-oracle-sweep.md`) hold on current `main` when they are measured by a reader that shares no code with J1's oracle? Does every holding-tab path cut what an operator expects? That means automatic and dragged tabs, open and closed contours, inside, outside and on-path, holes, small parts, mixed layers, stock and depth, passes, curves, leads, ramps and finish allowance.

**Tree.** `origin/main` @ `9a0b1a80b` (read-only export `j38-main`). J1 ran on `a1518de75`. `git diff --stat a1518de75 9a0b1a80b` over `src/core/cnc`, `src/core/geometry/tabs-bridges.ts`, `src/core/output`, `src/core/scene` and `src/ui/laser/cnc-*.ts` shows only wording changes:
- `cnc-missing-primary-tool-warnings.ts` and `cnc-start-advisories.ts`: "Active bit" became "Default bit" / `SPINDLE_BIT_LABEL`;
- `cnc-recovery-open-project.ts`.

No tab, depth-warning, contour, pass or inlay code changed since J1. No open PR touches tabs: `gh pr list --state open` returned `[]`.

**Method.**
- **Own reader** (`n1-reader.ts`), sharing no code with J1's `oracle.ts.txt` or with the CAM:
  - a modal G0/G1/G2/G3 parser (G90/G91, G20/G21, I/J arcs cut into chords of 0.002 mm sagitta);
  - a removal-depth grid (0.05 mm cells; 0.2 mm for V-carve). For a flat end mill, every move is stamped exactly: the reach interval of the move over each cell comes from a quadratic, and the lowest Z is taken at its ends. For a ball or cone, a ternary search runs on the convex height function.
  - J1's oracle was not run. My numbers agree with J1's published tables to the 0.01 mm, so it served as a second opinion by comparison only.
- **Measures**, all taken from the emitted program:
  - Per source loop: removal is sampled at the kerf centre (offset r to the waste side) and 0.08 mm from the wall, every 0.05 mm of outline. From that come the through fraction, the uncut runs (tabs or shorts), their length and their depth.
  - **Bridge width:** the through-cut cells (removal ≥ cut depth − 0.01) are labelled into 4-connected components. Each tab separates two components, and the distance between neighbouring components is the narrowest cross-section of the bridge. On a straight edge with defaults this reads exactly **6.00 mm**, the set width.
  - Kept material: removal more than 0.06 mm inside the part.
  - Cells first cut by a rapid.
- **Entry points:** `compileCncJob` → `cncGrblStrategy.emit`; `detectMachineJobWarnings`; `detectCompiledVCarveDepthWarningsForJob`; `seedCncTabAnchors`. Projects are built like J1's evidence (an `imported-svg` with polylines or elliptical-arc curves, plus `cncTabAnchors` and transforms).
- **READ:**
  - `cnc-tabs.ts`, `cnc-tab-ramp.ts`, `tabs-bridges.ts`, `cnc-manual-tab-mapping.ts`, `cnc-tab-anchors.ts`, `tabbed-ramp-entry.ts`, `compiled-tab-rises.ts`, `finish-allowance-tabs.ts`;
  - `compile-cnc-layer-passes.ts`, `motion-polish.ts`, `profile-lead-passes.ts`;
  - `cnc-full-tab-coverage-warnings.ts`, `cnc-through-cut-tab-warnings.ts`, `cnc-compiled-depth-warnings.ts`, `tapered-inlay-settings.ts`;
  - `CncTabFields.tsx`, `CncTabPositionControls.tsx`, `CncOpenPathNote.tsx`, `CncTaperedInlayFields.tsx`;
  - ADR-258 Amendments 1–4.
- **Not used:** Vitest (no test file was needed), pnpm, a browser, hardware, the GRBL simulator.

## Headline

**All five J1 findings reproduce on `9a0b1a80b` with an independent reader. Nothing has changed since 2026-11-11.**
- **J1-P1-1 stays P1.** The 8 and 12 mm holes in a plate stop at 4.35 of 6.35 mm all the way round (through fraction 0.000) and no warning fires. Only a layer whose shapes are *all* swallowed warns.
- **J1-P3-2 narrows.** The "Radial fit gap" tooltip has said since #1418 that the plug sinks gap / tan deeper into the glue gap. What is left is the case where gap / tan exceeds the glue gap.

**The tab sweep found three P2s and three P3s, all new.** Every tab is at the right height, no head is lowered into a tab, no kept material is cut, and no rapid cuts stock. What fails is the **width of the physical bridge**:

1. **N1-P2-1. Default tabs sit on the corners of squares.** Direction enforcement moves each loop's start to the middle of its longest edge (`motion-polish.ts:21-22,74`). Tabs are then spaced from that seam, so with the default 4 tabs every square and every near-square rectangle gets its tabs **on or across the corners**. The tab window is measured along the path that turns the corner, so the bridge is much narrower than set:

   | Shape | Bridge |
   | --- | --- |
   | Square, any size | **3.31 mm** (6 set) |
   | 70 × 60 to 200 × 190 rectangle | 4.17 mm |
   | Equilateral triangle, 3 tabs | **1.40 mm** |
   | Wedge tab dragged to a 20° tip | 0.65 mm |

   With "Default direction", or after merely clicking "Edit positions", the same square has 6.00 mm bridges.
2. **N1-P2-2. An open outline cut through with Tabs on gets no tabs and no warning.** The bit closes any gap under its diameter, so the part comes free. The same cut with Tabs **off** warns "the part and any hole slugs come free". On path, the default cut type, has no open-path note at all.
3. **N1-P2-3. Default arc leads narrow the tabs next to the seam on small loops.**

   | Hole | Bridge with leads | Leads off |
   | --- | --- | --- |
   | 16 mm | **3.28 mm** | 5.20 mm |
   | 18 mm | 4.15 mm | 5.39 mm |
   | 18 mm, 3 mm lead radius | **2.15 mm** | 5.39 mm |

## J1 re-verification

| Finding | Verdict | Severity | Evidence (own reader, `out/j1.txt`, `out/vcarve.txt`) |
| --- | --- | --- | --- |
| **J1-P1-1** small holes / parts swallowed by tabs; a mixed layer does not warn | **CONFIRMED**, unchanged since J1 (code identical) | **P1** (KNOWN K-4 / TP-5 / AUDIT A5) | Plate 80×60 Outside + 8/12/16 mm holes, defaults: plate 4 tabs × 6.00 mm at 4.35; **hole8 and hole12 through 0.000, deepest 4.350 all round**; hole16 through 0.466. Inside 8/12/30: 8 and 12 at 4.35, 30 through. Small parts: 6 mm square and 8 mm disc at 4.35, 40×30 through. **`warnings: []` in all three.** Holes 8+12 alone on their layer: the full-coverage warning fires. Same on a second layer (`s-two-layers-small-and-big`). No clear warning reaches the operator, so it stays P1 under METHOD §3. |
| **J1-P2-1** V-carve at exactly the stock bottom raises no warning | **CONFIRMED** | **P2** | `vb-90`, 40×20 rectangle, flowing: field deepest **6.350** in 6.35 stock → `detectCompiledVCarveDepthWarningsForJob` `[]`. 6.0 stock → "0.35 mm past the bottom". 6.5 → `[]`. `vb-60` → 5.499, `[]`. `cnc-compiled-depth-warnings.ts:40-44` still lacks `warnAtStockBottom`. P2 kept: the depth is what flowing mode specifies, and only the twin's warning is missing. |
| **J1-P3-1** fully tabbed contour re-cut at the tab top per level | **CONFIRMED** | **P3** | 10 mm square Inside, 3 mm deep: header `passes: 3`, three `G1 Z-1.000` laps over one loop (2 through air). Holes 8+12, 6.35 mm: `passes: 10`, every lap at Z-4.35. |
| **J1-P3-2** "Radial fit gap" seats the plug deeper; real glue gap 0.42 | **CONFIRMED IN PART, narrowed** | **P3** | READ: the field's own tooltip (`CncTaperedInlayFields.tsx:42-43`, unchanged since #1418 `3865d4423`) says the taper closes the gap "as the plug sinks this gap divided by tan(half the V-bit angle) deeper, into the glue gap". The default 0.42 mm real glue gap is therefore disclosed, and that half is **refuted**. Still open: when `fit / tan(A/2) > glue gap`, the walls cannot meet before the plug lands on the floor. 30°, 0.2 mm: 0.746 > 0.5, so a seam of ≥ 0.066 mm is left (J1 measured 0.11 mm on the ridged floor). `plugWallIssue` (`tapered-inlay-settings.ts:69-77`) checks only surface clearance and border, and `inlayFindings` (`tapered-inlay.ts:83-94`) says nothing. Arithmetic + READ; J1's REPRO is the second opinion. |
| **J1-P3-3** real 6.35 mm stock reads as never set | **CONFIRMED, wider** | **P3** | Outside, 7 mm deep: tabs at 5.00 depth on 6.35 stock (1.35 mm in stock), at **4.36** on 6.36 stock; the warning says "Set Stock thickness to keep them full height". Also: **a 3 mm groove in real 6.35 stock gets four 2 mm tab bumps** (`s-default-stock-depth3`: tabs at 1.00 depth). On 6.36 stock the same groove skips its tabs and says so (`s-stock6.36-depth3`). Same root, `cnc-tabs.ts:55,72,88`. |

## Tab sweep

All programs come from `compileCncJob` → `cncGrblStrategy.emit` with the default 3.175 mm end mill (`em-3175`), 6.35 mm deep at 2 mm per pass, and an 80×60 plate Outside unless noted. "Bridge" is the narrowest gap between through-cut components (6.00 = the set width). In every program below, kept material cut = **0 cells**, cells first cut by a rapid = **0**, and every tab run is flat at the tab top (min = max). Raw output: `out/sweep.txt`, `out/bridges*.txt`, `out/corners*.txt`, `out/rects.txt`.

### Automatic count, width, height, passes

| Case | Tabs found | Run at kerf centre | Tab top depth | Bridge | Warning |
| --- | --- | --- | --- | --- | --- |
| 1 / 2 / 4 / 8 tabs | 1 / 2 / 4 / 8 | 6.00 each | 4.35 | 6.00 | — |
| 16 tabs | 16 | 5.55–6.00 (corners) | 4.35 | — | — |
| width 0.5 | 4 | 0.50 | 4.35 | — | — |
| width 12 | 4 | spans corners | 4.35 | — | — |
| height 0.2 / 5 | 4 | 6.00 | 6.15 / 1.35 | — | — |
| height 6.35 / 8 | **0** (through 1.000) | — | — | — | "no holding tabs: its 6.4 mm / 8 mm tabs are no shorter than the cut" |
| per pass 0.5 (14 passes) / 7 (2 passes) | 4 | 6.00 | 4.35 | — | — |
| depth 6, tab top on a ladder level | 4 | 6.00 | 4.00 | — | — |

### Stock thickness and depth

| Stock / depth | Tab top | Tab above stock bottom | Warning |
| --- | --- | --- | --- |
| 12 / 12.5 | 10.00 | 2.00 | overcut, "tabs reach 2 mm above the stock bottom" |
| 12 / 11 | 10.00 | 2.00 | — |
| 12 / 9 | none | — | "skips its holding tabs … 3 mm floor" |
| 3 / 3.5 | 1.00 | 2.00 | overcut note |
| 2 / 2.5 | 1.00 | 1.00 (half stock) | "thinned from the 2 mm set to half the 2 mm stock" |
| 1.5 / 1.5 | 0.75 | 0.75 (half stock) | none in machine warnings (Job Review detail line per ADR-258 Amd 4) |
| 6.35 default / 7 | 5.00 | **1.35** | "Set Stock thickness…" (J1-P3-3) |
| 6.36 / 7 | 4.36 | 2.00 | overcut note |
| 6.35 default / 3 | 1.00 | — | none: **bumps in a groove** (J1-P3-3) |
| 6.36 / 3 | none | — | "skips its holding tabs" |
| 6.35 / 5.35 | 3.35 | — | — |

### Profiles, contours, curves

| Case | Result |
| --- | --- |
| Inside plate | 4 tabs, 6.00, at 4.35 (centred near the corners, see N1-P2-1) |
| On path, closed plate | 4 tabs 5.90–6.00, bridges 5.95–6.00; On-path size warning fires |
| Circle Ø40 as two elliptical arcs, Outside | bridges 5.88–5.90 (the chord of a 9.175 mm window on a 21.6 mm radius) |
| Circle Ø20 arcs, Inside | bridges 5.51 (leads off) / 4.94 (leads on, N1-P2-3) |
| Hole Ø30 Inside | 5.78 with or without leads |
| Plate + 8/12/16 holes, Outside | plate 6.00; 16 mm hole cut through only in four 0.9 mm gaps of its path; 8 and 12 swallowed (J1-P1-1) |
| Small parts beside a big one | 6 mm square and 8 mm disc swallowed (J1-P1-1) |
| Two layers: Ø8 hole on L1, big part on L2 | L1 warns "will NOT be cut through" |
| `em-6350` on the plate | bridges **4.86** (the 12.35 mm window crosses a corner, N1-P2-1) |
| `bn-3175` ball nose | 4 tabs at 4.35; window uses the full-depth cut width |
| **Open polyline outline, On path, gap 0 / 0.3 / 1 mm** | **through all round, 1 through-cut piece, no tab, no warning** (N1-P2-2) |
| Open outline, Outside, gap 0.3 mm | joined (ADR-672), 4 tabs |
| Open outline, Outside, gap 1 mm | cut on the line, 1 piece, no tab, no warning (layer note: "comes out one cut width smaller") |
| Same with Tabs off (On path 0.3 / Outside 1) | "with no holding tabs — the part and any hole slugs come free" |

### Corners (N1-P2-1), `out/corners.txt`, `out/corners2.txt`, `out/rects.txt`, `out/seam.txt`, `out/seed.txt`

| Shape (Outside, defaults unless noted) | Bridges |
| --- | --- |
| 80×60 plate | 6.00 × 4 (window ends 0.41 mm before the corner) |
| 100×60 | 5.95–6.00 |
| 70×60, 100×90, 200×190 | **4.17** × 4 |
| 30×30, 60×60 squares | **3.31** × 4 |
| 60×60 square, Inside | **3.27** × 4 |
| 60×60 square, cut direction **Default** (no seam rotation) | 6.00 × 4 |
| 60×60 square after "Edit positions" (seeded, not dragged) | 6.00 × 4 |
| Equilateral triangle, 3 tabs | **1.40, 1.41, 2.30** |
| Hexagon, 6 tabs | 4.74–4.75 |
| 4- and 5-point stars | 5.96–5.98 (tabs land mid-edge) |
| Dragged tab on a 60° / 30° / 20° wedge tip | 3.14 / **1.00** / **0.65** |

### Leads, ramps, finish allowance (N1-P2-3), `out/bridges.txt`, `out/bridges2.txt`

| Case | Bridges |
| --- | --- |
| Plate, leads default / off / ramp 5° / ramp 20° / finish 0.3 | 6.00 in all |
| Hole Ø16 Inside, leads **off** | 5.20 × 4 |
| Hole Ø16 Inside, **default arc leads** | **3.28, 3.29, 3.29**, 5.20 |
| Hole Ø16, finish 0.3 + leads / + leads off | 3.24 / 5.13 (finish itself costs 0.07) |
| Hole Ø16, ramp 5° (ramp disables leads) | 5.20 |
| Hole Ø18 Inside, leads off / default / radius 3 mm | 5.39 / **4.15** / **2.15** |
| Hole Ø20 Inside, ramp 10° / default leads | 5.52 / **4.95** |

### Manual / dragged tabs, `out/sweep.txt`, `out/transform.txt`, `out/bridges2.txt`

| Case | Result |
| --- | --- |
| 2 anchors (pathT 0.1, 0.6) | exactly 2 tabs, 6.00 |
| 3 overlapping anchors | merged into one 11.6 mm tab (1 through piece) |
| Anchors under offset, rotation 30° + scale 1.5 × 0.8, mirrorX + rotation −45° | every tab centre **1.59 mm (= r) from its anchor**, i.e. on the toolpath beside it |
| Two squares joined by a 2 mm neck, Inside, automatic | the offset splits into 2 loops, and **each gets 4 tabs (8 for one shape)**, all on corners, bridges 3.27 (N1-P3-1) |
| Same, one tab dragged onto the left lobe | **the right lobe also gets a tab**, on its corner nearest the anchor (`X51.588 Y378.413`, a 4.59 mm rise), N1-P3-1 |

## Findings

### N1-P2-1 — Default tabs land on the corners of every square and near-square part, where the bridge is far narrower than the set width

- **Where:**
  - `src/core/cnc/motion-polish.ts:21-24,74,130-150`: with a cut direction set (the default is `climb`, `machine.ts:368`), each closed toolpath's start is rotated to the midpoint of its longest segment, "so entry witness marks land on a flat span instead of a corner".
  - `src/core/cnc/cnc-tab-ramp.ts:64,181-197`: automatic tab centres sit at `(i + 0.5)·P / n` along the toolpath from that start, and each window is `tabWidth + cut width` long, measured **along the path**.
  - For a square (or any regular n-gon with n tabs), `P / 2n` from a mid-edge is exactly a vertex. For a rectangle W × H with 4 tabs the centre lies `|W − H| / 4` from a corner, so any |W − H| < 18.35 mm (2 × the 9.175 mm window) puts the window across a corner.
- **Anchor:**
  - Contract: the Tab width field (`CncTabFields.tsx:56`), "Length of each tab along the cut path". `cnc-tab-ramp.ts:61-63` adds one tool diameter "so the PHYSICAL bridge is the requested width".
  - Twins:
    - the same square with cut direction "Default direction" (no seam rotation) cuts 6.00 mm bridges;
    - the editor's own seed (`cnc-tab-anchors.ts:36-63`, `(k + 0.5)/n` of the *source* outline from its first vertex) puts the same 4 tabs mid-edge, 6.00 mm (`out/seed.txt`).
- **Evidence:** REPRO (own reader, bridge = gap between through-cut components; a straight-edge tab reads 6.00):
  - 30×30 and 60×60 squares Outside, defaults: **3.31 mm × 4** (`out/corners.txt`, `out/rects.txt`); Inside 3.27.
  - 70×60, 100×90, 200×190: **4.17 mm**.
  - Equilateral triangle, 3 tabs: **1.40 / 1.41 / 2.30**.
  - Hexagon, 6 tabs: 4.75.
  - `em-6350` on the 80×60 plate: 4.86.
  - Dragged tab on a 20° tip: 0.65.
  - `seam-square-climb` and `-conventional` 3.31; `-default-direction` 6.00 (`out/seam.txt`).
- **Scenario:** a new CNC layer set to Outside, 6.35 mm through 6.35 mm ply, with the default 4 × 6 mm tabs. The part is a 100 mm square coaster. All four tabs straddle the corners, and each holds by a 3.3 mm neck (55 % of what was set) at the one place hardest to sand clean. A triangle holds by 1.4 mm necks, which can snap under the last pass and free the part under the spindle. The program, the layer card and Job Review all say "6 × 2 mm".
- **Severity:** P2. The tabs exist at the right count and height, and along the path they are 6 mm, so the tooltip's literal definition holds. But the bridge that holds the part is 23–55 % of the set width on the commonest shapes, with defaults and no warning. A refuter who reads a narrowed bridge as wrong physical output (METHOD §3) could argue P1 for the triangle and tip cases.
- **Announced?** No. `motion-polish.ts` documents the seam rotation for entry marks only.
- **Novelty:** New as a defect. `docs/audits/2026-07-13-cnc-workholding-…md:894,1181` noted "no curvature, corner … model" and "tabs placed near corners" as a research gap, without measurement.
- **Fix direction:** place automatic tabs from a corner-free phase instead of the entry seam. Either offset the centres by half a spacing from the rotated seam, or snap each centre to the nearest straight span whose length holds the whole window. Failing that, measure the window by chord so a turned window keeps the set bridge. Seed the editor from the same placement (see N1-P3-2).

### N1-P2-2 — An open outline cut through with Tabs on is freed with no tab and no warning; Tabs off warns

- **Where:**
  - `src/core/cnc/cnc-tab-ramp.ts:52` and `compile-cnc-layer-passes.ts:366,391`: open toolpaths never take tabs (ADR-258 Amd 4).
  - `src/ui/laser/cnc-through-cut-tab-warnings.ts:139-158`: the through-cut warning fires with Tabs off, or with Tabs on only when the tab height reaches the cut.
  - `src/ui/laser/job-review/job-review-detail-facts.ts:312`: the tab part is dropped when no pass rises.
  - `src/ui/layers/CncOpenPathNote.tsx:96-99,107-119`: On path gets no note; Outside/Inside say "comes out one cut width smaller" and nothing about tabs.
  - ADR-672 joins near-closed outlines only for Outside/Inside (`cnc-profile-outline-join.ts:1-16,47-52`).
- **Anchor:** Twin: the same open outline with Tabs **off** warns "cuts through the stock … with no holding tabs — the part and any hole slugs come free on the final pass" (`out/open.txt`). ADR-258 Amd 4 ("no mention of tabs for an open line through 6 mm stock") was written for a line, not for an outline the bit closes.
- **Evidence:** REPRO `n1-open.ts` (`out/open.txt`), 80×60 outline drawn as an open polyline, 6.35 mm in 6.35 stock, Tabs on:
  - On path, gap 0.3 mm: **1 through-cut piece, no tab top level (`passes: 4`), no warning**;
  - Outside, gap 1 mm: the same;
  - On path, gap 0 (last point = first, `closed: false`): the same (`s-onpath-open-line`);
  - Tabs off: the warning above.
- **Scenario:** a part outlined in KerfDesk with the pen or line tool, or a CAD export whose last segment stops short by more than the import closure tolerance. It is cut On path (the default cut type) or Outside, through the sheet, with Tabs on as shipped. The 3.175 mm bit sweeps across the gap, the part comes free on the last pass with the spindle running, and nothing on screen mentions tabs. Imported SVG/DXF outlines that return to their start are closed at import (`shape-to-polylines.ts:106-111`, `dxf-join-touching.ts`), which narrows the reach.
- **Severity:** P2. The depth is what ADR-258 Amd 4 specifies for an open path. What is missing is the warning the Tabs-off twin gives, for an outline whose gap the bit closes.
- **Announced?** Partly: ADR-258 Amd 4 decided open paths take no tab. The sided layer note talks about size only.
- **Novelty:** New.
- **Fix direction:** in `throughCutWarning`, treat an open contour whose end gap is under the cut width (and which encloses area) like a closed shape with no tab: "N open outlines on layer X get no holding tabs and will come free; close them with Join paths". Optionally extend the ADR-672 join to On path for such outlines.

### N1-P2-3 — Default arc leads cut through-depth beside the tabs that flank the seam, narrowing them on small loops

- **Where:** `src/core/cnc/profile-lead-passes.ts:51-90,393-424`. The lead-in/out are spliced at the ring's seam, at the pass depth. The default radius is the tool radius (`resolveProfileLeadOptions`, `:95-107`). The seam lies midway between two tabs (`cnc-tab-ramp.ts:191-195`), so on a short loop the lead's cutter sweeps the waste-side roots of both neighbouring tabs. Nothing checks the lead against tab windows; `leadClearsPart`, `leadClearsSiblings` and `leadClearsKeptWalls` test kept walls only.
- **Anchor:** Twin: the same hole with leads off (`profileLead.shape: 'none'`) or with a ramp entry (which disables leads) keeps 5.20 mm bridges. ADR-258's header (`cnc-tab-ramp.ts:10-11`) sold tabs-as-Z-rise as letting "ADR-250 lead-in/out still apply" without weakening tabs.
- **Evidence:** REPRO (`out/bridges.txt`, `out/bridges2.txt`):

  | Hole, Inside | Default arc leads | Leads off |
  | --- | --- | --- |
  | Ø16 | **3.28 / 3.29 / 3.29** / 5.20 | 5.20 × 4 |
  | Ø18 | 4.15 / 4.15 / 4.13 / 5.39 | 5.39 |
  | Ø18, lead radius 3 mm | **2.15** / 2.15 / 2.15 / 5.39 | 5.39 |
  | Ø20 | 4.95 | 5.52 (ramp 10°) |
  | Ø30 | 5.78 | 5.78 |
  | 80×60 plate | 6.00 | 6.00 |

- **Scenario:** a bracket with 16 mm bolt holes cut Inside, through, with the default tabs and leads. The two tabs beside each hole's seam hold the slug by 3.3 mm instead of about 5.2 mm. A larger lead radius thins them further. A freed slug is the hazard the code comment at `cnc-tabs.ts:138-139` names ("a freed hole slug is as dangerous as a freed part").
- **Severity:** P2: wrong behaviour on default settings, with a misleading tab width and no notice. The tabs still exist.
- **Announced?** No.
- **Novelty:** New.
- **Fix direction:** when a loop carries tabs, either move the seam to the middle of the longest tab-free span and cap the lead so its swept disc stays clear of the windows, or drop the lead (keeping the legacy plunge) when the free span is shorter than the lead plus one cut width. Add a bridge-width assertion to `compile-cnc-tabs.test.ts`.

### N1-P3-1 — A shape whose offset splits gets the full tab count on every piece, and a dragged tab is copied onto every piece

- **Where:**
  - `compile-cnc-layer-passes.ts:365-381`: tabs are per toolpath, and an offset that splits one shape yields several toolpaths.
  - `cnc-manual-tab-mapping.ts:35-43`: every closed toolpath takes the closest source contour and projects **all** of that source's anchors onto itself, with no distance limit.
- **Anchor:** the field label "Tabs per shape" (`CncTabFields.tsx:61`); the "Edit positions" contract "drag them to better locations".
- **Evidence:** REPRO `b2-neck-inside-*` (`out/bridges2.txt`, program `out/b2-neck-inside-manual-1.nc:113-118`): two 20 mm squares joined by a 2 mm neck, Inside.
  - Automatic: 8 tabs for one shape, all on corners (bridges 3.27).
  - One tab dragged onto the left lobe: the right lobe also rises at `X56.175→X51.588 Y378.413…Y373.826`, a tab on its corner nearest the anchor.
- **Severity:** P3. These are extra bridges (more cleanup, never fewer tabs). The dragged layout is not what is cut.
- **Fix direction:** project an anchor only onto the toolpath nearest the anchor (or within one cut width plus tolerance), as `tabFractionsNear` already does for finish-allowance rings. Decide whether "per shape" means per source contour.

### N1-P3-2 — "Edit positions" says it shows the tabs, but it seeds new positions; one click changes the program

- **Where:**
  - `src/ui/layers/CncTabPositionControls.tsx:50,54`: "Show the tabs on the selected contour…"; the click calls `seedSelectedCncTabAnchors`.
  - `cnc-tab-anchors.ts:36-63`: seeds at `(k + 0.5)/n` of the source outline from its first vertex.
  - The automatic compile uses toolpath fractions from the rotated seam (N1-P2-1).
- **Evidence:** REPRO `n1-seed.ts` (`out/seed.txt`): 60 mm square, automatic bridges 3.31 at the corners. After seeding (no drag), 6.00 mid-edge. The handles shown were never where the job put the tabs, and "Reset automatic" goes back to the corners.
- **Severity:** P3 (UI contract drift; the shown handles are cut once seeded).
- **Fix direction:** seed from `tabCenterPoints` of the compiled toolpath (mapped back to the source), or fix N1-P2-1 so both placements agree.

### N1-P3-3 — Tab height is documented as measured from the cut floor; with a set stock it is measured from the stock bottom

- **Where:**
  - `src/ui/layers/CncTabFields.tsx:45` ("Material left under each tab, measured up from the cut floor.");
  - `src/ui/tutorials/cnc-detail-tutorials.ts:82` ("Height is measured up from the cut floor").
  - Against: `cnc-tabs.ts:77-91` (ADR-258 Amd 3) and Amd 4 halving.
- **Evidence:** REPRO `s-stock12-depth12.5`: the tab top is at 10.00, so 2.5 mm above the cut floor and 2.0 above the stock bottom. `s-stock2-depth2.5`: a 1.0 mm tab where 2 was set. The overcut warning and the Job Review line say "above the stock bottom", but the field and the tutorial do not.
- **Severity:** P3 (doc/UI drift).
- **Fix direction:** "Measured up from the stock bottom when Stock thickness is set (from the cut floor while it is the default); a tab as thick as the stock is cut half the stock thick."

## KNOWN — status of every item in scope

| Item | Status on `9a0b1a80b` | Evidence |
| --- | --- | --- |
| J1-P1-1 / K-4 / TP-5 / AUDIT A5 (2026-09-24) | **Open, unchanged, P1** | `out/j1.txt` |
| J1-P2-1 | **Open, P2** | `out/vcarve.txt` |
| J1-P3-1 | **Open, P3** | `out/j1-p3-1-square10-inside-3mm.nc` |
| J1-P3-2 | **Open, narrowed to the gap / tan > glue gap case** | READ |
| J1-P3-3 | **Open, P3; also leaves tab bumps in partial grooves on real 6.35 stock** | `out/sweep.txt` |
| ADR-258 Amd 4: open paths take no tab | As decided; its warning gap is N1-P2-2 | `out/open.txt` |

## Verified clean

- **Tab height:** every tab top lies exactly where ADR-258 Amd 1–4 put it, for:
  - the cut floor on default stock;
  - the stock bottom on 12, 3, 2 and 1.5 mm stock;
  - half the stock when the tab ≥ stock;
  - skipped where the floor holds (with the "skips" warning);
  - no tab when the tab ≥ the depth (with the through-cut warning).
- **No head lowered into a tab:** every uncut run is flat at the tab top (min = max) in 50+ programs. Tab walls are pure-Z moves at the plunge feed. No rapid first-cuts stock, and no kept material is cut (0 cells everywhere `kept` was measured).
- **Count and width on straight edges:** 1, 2, 4, 8 and 16 tabs; widths 0.5 and 6 measure exactly at the kerf centre. Per-pass depth 0.5 or 7 and a tab top on a ladder level change nothing.
- **Ramps:** 5° and 20° on the plate and on a Ø16 / Ø20 hole keep every tab (`rampTabbedPath` descends only on low spans).
- **Finish allowance 0.3:** roughing rises beside the finishing tabs. The plate keeps 6.00 and the Ø16 hole 5.13 (vs 5.20).
- **Manual tabs under transforms:** offset, rotation + non-uniform scale, mirror + rotation each put every tab centre exactly r = 1.59 mm from its anchor (`out/transform.txt`). Overlapping anchors merge.
- **Curves:** elliptical-arc circles flatten and tab like polylines; the bridges match the chord of the window (Ø40 Outside 5.88–5.90).
- **Warnings:**
  - the full-coverage warning fires per layer, on a second layer too;
  - the through-cut and overcut tab notes match the measured tabs (stock 12 / 3 / 2);
  - the V-carve overcut warning fires past the bottom.

## Not verified

- **GRBL kinematic simulator / machine runs:** not run (N5 covers them). Every result here is the emitted program.
- **Relief-projection tabs** (rolling v11/v12, `cnc-projection-stock-warnings.ts`), **tiled** jobs, **V-bit profile** tabs, and **multi-tool** layers: not swept.
- **Physical strength:** the bridge figure is a geometric cross-section; no material model or break test.
- **The Job Review dialog itself:** read through `detectMachineJobWarnings` and the detail-fact code only, not rendered.
- **J1's oracle:** not executed. The comparison is against J1's published numbers.
- **Tapered inlay:** not re-measured (J1-P3-2 rests on READ + arithmetic + J1's REPRO).

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-n1\`. Run with `node --no-experimental-webstorage --import ./register.mjs <file>` from that folder; the tree is `../j38-main/src`. Programs and per-case JSON go to `out\<case>.nc` / `.json`.

| File | What | Output |
| --- | --- | --- |
| `n1-reader.ts` | Own G-code reader, removal grid, flat/ball/cone cutters, geometry helpers | — |
| `n1-harness.ts` | Project builder, compile + emit, loop sampling, kept-material check, bridge analysis | — |
| `n1-j1.ts` | J1-P1-1, J1-P3-1, J1-P3-3 cases | `out/j1.txt` |
| `n1-vcarve.ts` | J1-P2-1 | `out/vcarve.txt` |
| `n1-sweep.ts` (`n1-sweep-cases.ts`) | 46-case tab sweep | `out/sweep.txt` |
| `n1-bridges.ts`, `n1-bridges2.ts` | Bridge widths; leads, ramps, finish, split loops | `out/bridges.txt`, `out/bridges2.txt` |
| `n1-corners.ts`, `n1-corners2.ts`, `n1-rects.ts`, `n1-seam.ts`, `n1-seed.ts` | N1-P2-1, N1-P3-2 | `out/corners.txt`, `out/corners2.txt`, `out/rects.txt`, `out/seam.txt`, `out/seed.txt` |
| `n1-open.ts` | N1-P2-2 | `out/open.txt` |
| `n1-transform.ts` | Manual tabs under transforms | `out/transform.txt` |

## Counts

Raised **6**: P1 **0**, P2 **3** (N1-P2-1, N1-P2-2, N1-P2-3), P3 **3** (N1-P3-1, N1-P3-2, N1-P3-3).

Known items with a status: **5**, all still open:
- J1-P1-1 P1 (KNOWN K-4) confirmed;
- J1-P2-1 P2 confirmed;
- J1-P3-1 P3 confirmed;
- J1-P3-2 P3 narrowed;
- J1-P3-3 P3 confirmed and wider.

```json
[
  {"id":"N1-P2-1","severity":"P2","file":"src/core/cnc/motion-polish.ts","line":74,"anchor":"Twin: Default direction / Edit-positions seed give 6.00 mm","evidence":"REPRO","known":null,"summary":"Seam rotation to mid-longest-edge puts default tabs on every corner of squares and near-squares; bridges 3.31 mm (square), 4.17 (near-square), 1.40 (triangle) for 6 mm set"},
  {"id":"N1-P2-2","severity":"P2","file":"src/ui/laser/cnc-through-cut-tab-warnings.ts","line":148,"anchor":"Twin: Tabs-off through-cut warning","evidence":"REPRO","known":"ADR-258 Amd 4 (open paths take no tab)","summary":"Open outline (gap under the bit) cut through with Tabs on gets no tab and no warning; part comes free"},
  {"id":"N1-P2-3","severity":"P2","file":"src/core/cnc/profile-lead-passes.ts","line":51,"anchor":"Twin: leads off / ramp keep 5.2 mm","evidence":"REPRO","known":null,"summary":"Default arc leads narrow the seam-side tabs on small loops: 16 mm hole 3.28 vs 5.20 mm; 18 mm with 3 mm lead 2.15"},
  {"id":"N1-P3-1","severity":"P3","file":"src/core/cnc/cnc-manual-tab-mapping.ts","line":39,"anchor":"Contract: Tabs per shape / Edit positions","evidence":"REPRO","known":null,"summary":"Split offset loops each get the full tab count and every dragged anchor"},
  {"id":"N1-P3-2","severity":"P3","file":"src/ui/layers/CncTabPositionControls.tsx","line":50,"anchor":"Contract: 'Show the tabs on the selected contour'","evidence":"REPRO","known":null,"summary":"Edit positions seeds new positions (mid-edge) instead of showing the automatic ones (corners); one click changes the program"},
  {"id":"N1-P3-3","severity":"P3","file":"src/ui/layers/CncTabFields.tsx","line":45,"anchor":"Contract: ADR-258 Amd 3/4","evidence":"REPRO","known":null,"summary":"Tab height tooltip and tutorial say 'from the cut floor'; with a set stock it is from the stock bottom (and halved when ≥ stock)"}
]
```

## Refuter (2026-11-13)

**Tree and harness.** Same read-only export `j38-main` (`origin/main` @ `9a0b1a80b`). Own scripts are in `zz-n1r\`. Run them with `node --no-experimental-webstorage --import ./register.mjs <file>` (the loader was copied from `zz-n1`). The auditor's `n1-harness.ts` and `n1-reader.ts` were read for API shape only, and nothing imports them.
- **Own builder** (`r-build.ts`): `createProject` and `createLayer`, then an `imported-svg` object with polylines, `cncTabAnchors` and transforms. It runs `compileCncJob` → `cncGrblStrategy.emit` and `detectMachineJobWarnings(project)`. Through cuts are 6.35 mm deep at 2 mm per pass in 6.35 mm stock. Everything else is `DEFAULT_CNC_LAYER_SETTINGS` (Climb, 4 × 6 × 2 mm tabs, default arc leads, `em-3175`) unless a case says otherwise.
- **Own reader** (`r-reader.ts`), sharing no code with the auditor's reader or with J1's oracle:
  - a modal G0–G3 parser, with arcs cut into chords of at most 0.05 mm;
  - an exact flat-end-mill removal grid (0.05 mm cells), solving the quadratic for the cutter's reach interval on each move.
- **Holding cross-section, a new metric.** The auditor's "bridge" is the plain Euclidean gap between through-cut components. Mine is a weighted 2D min-cut, computed by Dijkstra on a 16-neighbour grid:
  - **area** = the minimum over plan curves from one through-cut component to the next of ∫ (stock − removal) ds, in mm². This is the vertical fracture surface the part must break to come free. A curve through the 2 mm tab costs 2 per mm; a curve that cuts through the full-thickness part or sheet costs 6.35 per mm.
  - **gap** = the same with weight 1, which is the auditor's measure.
  - **"held"** is a flood fill from a point inside the part through not-through cells. `false` means the piece is cut free.
  - A straight-edge default tab reads **12.00 mm² / gap 6.00** (`out/calib.txt`), exactly 6 mm × 2 mm.
- **Second reader.** J1's oracle (`docs/audits/2026-11-11-cnc-v2/evidence/oracle.ts.txt`, copied unchanged to `zz-n1r\mut\oracle.ts`) parsed and stamped six key programs, and my min-cut ran on its field (`r-oracle.ts`, `out/oracle.txt`). It agrees with my reader to 0.06 mm² and 0.04 mm on every case, and gives the same free/held result.
- **Not used:** Vitest, pnpm, a browser, hardware, the GRBL simulator. `gh pr list --state open` (read-only) returned only #1871 (CI cache), which touches no tabs.

### Verdicts

| Finding | Verdict | Severity | Evidence (own) |
| --- | --- | --- | --- |
| J1-P1-1 (KNOWN K-4) | **CONFIRMED**, exact threshold found | **P1** | `r-j1.ts` → `out/j1.txt` |
| J1-P2-1 | **CONFIRMED** | P2 | `r-vc.ts` → `out/vc.txt`; READ `cnc-compiled-depth-warnings.ts:36-45,58-67` |
| J1-P3-1 | **CONFIRMED** | P3 | `r-p31.ts` → `out/p31.txt` |
| J1-P3-2 | **CONFIRMED as narrowed** | P3 | READ `CncTaperedInlayFields.tsx:42-43`, `tapered-inlay-settings.ts:43,69-77`; arithmetic |
| J1-P3-3 | **CONFIRMED, incl. the groove bumps** | P3 | `r-p33.ts` → `out/p33.txt` |
| N1-P2-1 | **CONFIRMED, raised to P1** | **P1** | `r-calib`, `r-corners`, `r-width`, `r-width2`, `r-width3`, `r-oracle` |
| N1-P2-2 | **CONFIRMED, raised to P1** | **P1** | `r-open.ts` → `out/open.txt`; `out/oracle.txt` |
| N1-P2-3 | **CONFIRMED** (and leads can erase tabs) | P2 | `r-leads*.ts` → `out/leads*.txt` |
| N1-P3-1 | **CONFIRMED** | P3 | `r-p3.ts` → `out/p3.txt` |
| N1-P3-2 | **CONFIRMED** | P3 | `r-p3.ts` (seeded 12.0 mm² vs automatic 7.2) |
| N1-P3-3 | **CONFIRMED** | P3 | READ `CncTabFields.tsx:45`, `cnc-detail-tutorials.ts:82` vs `cnc-tabs.ts:54-57,83-91`; `out/p33.txt` |

**J1-P1-1: CONFIRMED P1.** Own geometry is Ø-n discs (256-gon) on one Outside layer, with either a 210 mm plate around them (holes) or a 120 × 60 part beside them (small parts). Removal was sampled on the kerf-centre circle (`out/j1.txt`). The swallow threshold is exactly where the tab windows reach the toolpath perimeter:
- **hole:** d* = n·(W + D)/π + D;
- **part:** d* = n·(W + D)/π − D.

| Tabs n, width W, bit D | Predicted d* | Measured (through fraction) |
| --- | --- | --- |
| 4, 6, 3.175 (defaults), hole | 14.86 | 14.8: **0.000** (Z-4.35 all round); 15.0: 0.440 |
| 4, 6, 3.175, part | 8.51 | 8.4: **0.000**; 8.6: 0.396 |
| 2, 6, 3.175, hole | 9.02 | 8.8: **0.000**; 9.2: 0.617 |
| 4, 6, **6.35** (`em-6350`), hole | 22.07 | 21.8: **0.000**; 22.4: 0.688 |
| 4, 3, 3.175, hole | 11.04 | 10.6: **0.000**; 11.2: 0.687 |

`warnings: []` in all five mixed layers. With the default list's ¼" bit, every hole under 22 mm stays uncut. No warning reaches the operator, so the finding cannot be lowered (METHOD §3).

**J1-P2-1: CONFIRMED P2.** A `vb-90` V-carve of a 40 × 20 rectangle has an emitted minimum Z of −6.350:
- 6.00 mm stock warns "0.35 mm past the bottom";
- 6.35 and 6.50 mm stock: `[]` from both `detectCompiledVCarveDepthWarningsForJob` and `detectMachineJobWarnings`.

The relief twin passes `warnAtStockBottom: true` (`:66`), and the V-carve call does not (`:40-44`). Kept at P2, not P1: the depth is the one flowing V-carve specifies. Only the boundary warning is missing, and that warning is the twin's.

**J1-P3-1: CONFIRMED P3.** A 10 mm square, Inside, 3 mm deep at 1 mm per pass: the header says `passes: 3`, and the only feed level is Z-1.000 with 96.81 mm of XY feed, i.e. three laps of a 32.3 mm loop. Two of the laps cut air.

**J1-P3-2: CONFIRMED as narrowed.**
- The tooltip discloses the deeper seat (`CncTaperedInlayFields.tsx:42-43`).
- `tapered-inlay-settings.ts:43` fixes pocket = engagement + glue gap.
- `plugWallIssue` (`:69-77`) compares the fit depth gap/tan only with the surface clearance, and nothing compares it with `glueGapMm`. When gap/tan > glue gap, the plug lands on the floor before the walls meet. Example: 30°, 0.2 mm gives 0.746 > 0.5. Arithmetic plus READ; not re-cut.

**J1-P3-3: CONFIRMED P3.** On the shipped 6.35 mm stock:
- a 7 mm cut puts its tab tops at Z-5.000 (1.35 mm in stock), and the overcut warning says "only 1.3 mm of each is in the stock. Set Stock thickness…" (announced);
- on 6.36 mm stock the tab tops are at Z-4.360;
- a 3 mm groove on 6.35 mm stock gets 8 tab rises to Z-1.000 with no text;
- on 6.36 mm stock the same groove skips its tabs and says so.

**N1-P2-1: CONFIRMED, raised to P1.** The auditor's numbers reproduce. The holding cross-section is a little better than the Euclidean gap, but the same mechanism **removes tabs entirely** at legal widths and frees the part.

- **Mechanism check (READ).** `motion-polish.ts:61-73,130-150` rotates every Outside/Inside loop's start to the middle of its longest segment when a cut direction is set, and Climb is the default (`machine.ts:368`). `cnc-tab-ramp.ts:181-197` puts automatic centres at (i + 0.5)·P/n from that start, with a window of W + D measured along the path (`:61-64`). On a mitred square toolpath P/8 from mid-edge is exactly the corner. The window then turns 90°, and the gap between its ends is (W + D)/√2 − D: **3.31 mm** for the defaults. That gap is **≤ 0** once W ≤ (√2 − 1)·D, which is 1.31 mm on the ⅛" bit and 2.63 mm on the ¼" bit.
- **Defaults (holding cross-section, mm² at a 2 mm tab; 12.00 is the set tab):**

  | Shape (Outside unless noted) | Gap (Euclidean) | Area → equivalent width |
  | --- | --- | --- |
  | 30, 60, 100, 360 mm squares | 3.29 | 7.0–7.2 → **3.56–3.60 mm** |
  | 60 mm square, Inside | 3.25 | 7.09–7.12 → 3.54 |
  | 60 mm square, "Default direction" / seeded anchors | 6.00 | 12.00 → 6.00 |
  | 70 × 60 / 78 × 60 | 4.27 / 5.90 | 8.54 / 11.8 |
  | Equilateral triangle 80, 3 tabs | 1.45 / 2.42 / 2.29 | **3.41** / 6.39 / 6.31 → **1.71** / 3.19 / 3.15 |
  | Same triangle, 4 tabs (default count) | 5.97–6.00 | 11.93–12.00 |
  | Hexagon, 6 tabs / pentagon, 5 tabs | 4.74–4.80 / 4.24–4.29 | 9.6–9.7 / 8.7–8.9 |
  | 60 mm square with 5 mm corner radius | 5.20 | 10.39 |
  | 80 × 60 plate, `em-6350` | 4.90 | 9.79 (auditor 4.86) |
  | 60 mm square, `em-6350` | 2.37 | 4.73 → **2.37** |

  Small differences from the auditor's gaps (4.27 vs 4.17; 1.45 vs 1.40) come from metric discretisation; both readers agree on the mechanism.
- **Partial challenge: the 20° wedge.** The auditor's "0.65 mm" is a Euclidean gap. For a tab dragged to a 20° tip, the cheapest fracture surface mostly crosses the full-thickness tip. On my 60 mm-leg wedge the gap is 1.45, but the area is **6.36 mm² (3.18 mm-equivalent)**. The Euclidean gap understates the hold wherever the shortest line crosses the part. This does not change the verdict, and it is a user-dragged placement anyway.
- **Tabs that vanish (the P1 evidence):**

  | Case (Climb default) | Through components / tabs set | Part held? | Warning | Same case, "Default direction" |
  | --- | --- | --- | --- | --- |
  | 60 mm square, W 1, ⅛" | 1 / 4 | **no, cut free** | none | 4 tabs, 1.00 mm, held |
  | 60 mm square, W 1.5, ⅛" | 4 / 4, gap **0.11** (0.22 mm²) | barely | none | 1.50 mm |
  | 60 mm square, W 2.5, ¼" (`em-6350`, a default-list bit) | 1 / 4 | **no, cut free** | none | 2.55 mm, held |
  | 60 mm square, W 3, ¼" | gap **0.25** (0.49 mm²) | barely | none | — |
  | 100 mm plate with a 30 mm square hole, W 1, ⅛" | 2 rings, no bridges | **plate and slug both free** | none | — |
  | Triangle, 3 tabs, W 6 (default), ¼" | 2 / 3, so **one tab gone**, worst survivor 1.62 | yes | none | — |
  | Triangle, 3 tabs, W 3 / W 2, ⅛" | 2 / 3, worst survivor 0.78 / 0.28 | yes | none | 3 tabs ≈ 3.0 |

  - Both readers give the free results (`out/width3.txt`, `out/oracle.txt`).
  - The G-code still contains every tab wall. `compiled-tab-rises.ts` therefore finds rises, so Job Review lists the tabs as cut while the corner passes on either side mill each one away.
  - No cell is cut between the tab top and through (`partial 0`). The tab is not split; it is simply surrounded and isolated.
  - The Tab width field allows 0.5 mm (`CncTabFields.tsx:53`).
- **Severity.**
  - **Defaults alone, a weaker bridge (P2 face):** square tabs keep 60 % of the set section (7.2 of 12 mm²); the worst triangle tab keeps 28 % (3.4 mm²), and the triangle's total is 16.1 of 36 mm².
    - **Loads:** a 360 mm square of 6.35 mm ply weighs about 0.5–0.6 kg. Cutting force on a ⅛" bit at the default 0.042 mm chip load is roughly 1–6 N at 0.35–2 mm per pass. That is an order-of-magnitude estimate, not measured.
    - **Strength:** even at a deliberately low 1–2 MPa (plywood rolling shear or MDF interlaminar-type), 7.2 mm² holds about 7–14 N per tab, and 3.4 mm² holds about 3–7 N.
    - **Conclusion:** the narrowed default bridges still hold, with a margin of roughly 2–20×. That face alone would be P2.
  - **Allowed widths, a tab that does not exist (P1):** the same defect at allowed settings deletes the tab outright: 1 mm on ⅛", 2.5 mm on ¼", and one triangle tab on ¼" with the default 6 mm. **The part is cut free under a running spindle with Tabs on and no warning**, while the "Default direction" twin holds it with the set width.
    - This is silently wrong physical output: full depth where a tab was set and is still listed.
    - No warning reaches the operator, so under METHOD §3 (no reach clause) it is **P1**.
- **Fix direction:** keep the auditor's (a corner-free phase or straight-span snapping, with the seed taken from the same placement). In addition, have the compile check each window's chord gap, (window chord − D), and either move the tab or warn when it falls below the set width. A bridge-section assertion belongs in `compile-cnc-tabs.test.ts`.

**N1-P2-2: CONFIRMED, raised to P1.** An 80 × 60 outline drawn as an open polyline, through, Tabs on (`out/open.txt`; the second reader agrees for On path 0.3 mm):

| Cut type, end gap | Levels | Part held? | Warnings |
| --- | --- | --- | --- |
| On path, 0 / 0.3 / 2 / 3 mm | −2, −4, −6, −6.35 (no tab level) | **no** | **none** |
| Outside, 1 mm | same | **no** | **none** |
| Outside, 0.3 mm (ADR-672 join) | includes −4.35 | yes, 4 tabs | none |
| On path 0.3 / Outside 1, **Tabs off** | same | no | "…with no holding tabs — the part and any hole slugs come free on the final pass." |

- **Reach.** SVG import closes a path only within `CLOSURE_EPS_MM = 1e-4` mm (`src/core/scene/polyline-closure.ts:13`, via `subpath-closure.ts:17`). ADR-672's join uses 0.5 mm (`open-fill-contours.ts:39`), and only on Outside/Inside (`cnc-profile-outline-join.ts:51`). An outline that stops 0.01–3 mm short, cut On path (the default cut type), therefore frees its part with Tabs on and says nothing.
- **Why P1 and not "decided".**
  - ADR-258 Amendment 4, Decision 4, scopes the Tabs-on through-cut warning to "an operation that carries a closed shape". Its Verification line covers "an open line through 6 mm stock".
  - Neither considers an outline that the bit itself closes. The Tabs-off twin proves the app classes this exact outcome as warn-worthy.
  - The precedent ADR-672 / meta audit v1 M6-P1-2 rated the same near-closed outlines **P1** on Outside/Inside, for coming out a cut width small.
  - A freed part is the hazard ADR-258 (`machine.ts:346-349`) defaults tabs on to prevent.
  - No warning reaches the operator, so it cannot be lowered. **P1.** The coordinator may route it as an ADR-258 Amendment 4 scope question.
- **Fix direction:** as the auditor's. The minimal form is the Tabs-off sentence, also fired for open contours whose end gap is under the cut width and that enclose area.

**N1-P2-3: CONFIRMED P2.** Inside holes, adjacent-tab areas in mm² (`out/leads.txt`, `out/leads2.txt`, `out/leads3.txt`):

| Hole | Default arc lead | Leads off |
| --- | --- | --- |
| Ø16 | **6.68 / 6.68** / 10.51 / 10.51 (gap 3.29–3.33) | 10.49–10.51 (5.24) |
| Ø18 | 8.32–8.37 | 10.83 |
| Ø18, radius 3 / 4 | 4.39–4.46 / **1.47** | 10.83 |
| Ø18, radius 4.5 | **0.11** | 10.83 |
| Ø18, radius 5 | **the two seam tabs are gone** (2 through components) | 4 tabs |
| Ø10–12, 2 tabs, default lead | 4.27–7.58 | 7.69–9.06 |

- Outside parts (Ø12 disc, default, radius 3 arc or line) are untouched: 10.9 with or without a lead. The lead turns into the waste, away from the part's tabs.
- **In every probe the slug stays held** by the tabs away from the seam. Kept material is uncut (Ø18, radius 4: 0 cells).
- The harm is a weaker or missing seam-side bridge on a hole slug, not a freed piece, so **P2** stands. The erasure at radius ≥ 4.5 should be added to the finding's evidence.

**N1-P3-1: CONFIRMED P3.** Two 20 mm squares joined by a 2 mm neck, Inside:
- automatic: **8 through components** (4 tabs per lobe);
- one anchor on the left lobe: 2 components, and **both** lobe slugs are held, so the right lobe received a copied tab (`cnc-manual-tab-mapping.ts:35-43`).

The copy is protective (without it the right slug would be free), so P3 is right.

**N1-P3-2: CONFIRMED P3.** Anchors at pathT 0.125 / 0.375 / 0.625 / 0.875 (the `seedCncTabAnchors` output for 4 tabs, `cnc-tab-anchors.ts:49-62`) on a 60 mm square give 12.0 mm² each. The automatic corners give 7.2. One click on "Edit positions" (`CncTabPositionControls.tsx:50,54`) changes the program.

**N1-P3-3: CONFIRMED P3** (READ, plus the `out/p33.txt` tops). The tooltip and tutorial say "from the cut floor". The code measures from the stock bottom on a set stock, and halves a tab of stock thickness or more. The overcut warning and Job Review state the real rule, and the drift errs toward thicker tabs.

### Challenges to "Verified clean"

- **Tab height, no head lowered into a tab:** held. Across every program here (40+), no cell lies between the tab top and through (`partial 0`). The only exception is 16 cells with a 10° ramp on the 60 mm square, all at x = 50.00, exactly on the part wall, at 6.000. That is a cell-centre-on-the-wall rounding artefact, not a cut (`out/ramp.txt`).
- **No rapid into stock:** held, `rapidHit 0` in every program.
- **No kept material cut:** held, 0 cells on a 60 mm square Outside (W 6 and W 1), a Ø18 hole with a 4 mm lead, a 60 mm square Inside with a 10° ramp and a 0.3 mm finish allowance, and a 3-tab triangle (`out/kept.txt`).
- **Manual tabs under transforms:** held, including a combination the auditor did not run (mirrorY + rotation 120° + scale 0.9 × 1.3). Every final-level tab centre is 1.587–1.588 mm (= r) from its transformed anchor, and the bridges are 11.93–11.95 (`out/tf.txt`).
- **"Count and width on straight edges", "Curves":** not challenged, and consistent with my straight-edge 12.00 calibration.
- **Caveat on the auditor's "bridge" column:** it is a Euclidean gap, a lower bound on the holding section. The ranking and every verdict survive, but the tip and wedge figures understate the hold (see N1-P2-1).

### New findings

None counted separately. The two new pieces of evidence share the root causes of N1-P2-1 and N1-P2-3 and are folded into them:
- corner tabs that vanish and free the part at allowed widths, and on ¼" with the default width;
- seam-side tabs erased by a lead of radius 4.5 mm or more.

**Novelty:** `docs/audits` has only the research-gap lines the auditor cited (`2026-07-13-cnc-workholding-…md:894,1181`) and no measured corner-tab defect. No open PR touches tabs.

### Probes with no gap (new-gap search)

- **Two layers over one shape** (3 mm, then through): 4 tabs, 12.00 mm² each, held; the first layer's bumps do not reach the through layer's tabs (`out/misc.txt`).
- **Long thin part** (300 × 20 strip): 4 tabs, all 12.00 mm², held.
- **Very large part** (360 mm square): the N1-P2-1 corner placement (≈ 7.0 mm²), nothing else.
- **Multi-tool:** a layer with its own `toolId: em-6350` sizes its windows with that bit, not with the machine's ⅛" (2.5 mm set gives 2.55 under "Default direction").
- **On path, closed square, W 1:** no seam rotation (direction is undefined on On path, `motion-polish.ts:118-125`), so 1.00 mm bridges, held.
- **Finish allowance 0.3 on the square / triangle:** 6.44–6.51 / 2.78–5.99 mm², held; the allowance costs about 0.7 mm² on top of N1-P2-1.
- **Tiled jobs (READ only):** `tile-plan.ts:182-225,259-310` clips the compiled job after tabs are applied and interpolates Z, so tab rises survive tiling unchanged. Not run.

### Not verified

- **Physical strength:** the mm² sections are geometry. The strength and load figures in N1-P2-1 are order-of-magnitude estimates (no material test, no source fetched), and only the P2 face rests on them. The P1 cases need no strength model: the part is cut free.
- **V-bit profile tabs, relief-projection tabs, tiled jobs** (READ only), and the **GRBL kinematic simulator:** not run.
- **The Job Review dialog** was not rendered. "Lists the tabs" rests on READ of `compiled-tab-rises.ts` (it finds same-XY rises, and the program keeps them).
- **J1-P3-2:** not re-cut; READ plus arithmetic.
- **Vitest:** none run.

### Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-n1r\`. Run with `node --no-experimental-webstorage --import ./register.mjs <file>`; programs go to `out\<case>.nc`.

| File | Covers | Output |
| --- | --- | --- |
| `r-reader.ts` | Own parser, flat removal grid, components, weighted min-cut (area/gap), free-part flood fill | — |
| `r-build.ts` | Own project builder, compile + emit + warnings, `measure` | — |
| `mut/oracle.ts`, `r-oracle.ts` | J1 oracle as second reader + own min-cut | `out/oracle.txt` |
| `r-calib.ts` | Straight-edge calibration, square Climb vs Default | `out/calib.txt` |
| `r-corners.ts`, `r-width.ts`, `r-width2.ts`, `r-width3.ts` | N1-P2-1 shapes, width sweep, ¼" bit, vanishing tabs, free test | `out/corners.txt`, `out/width*.txt` |
| `r-j1.ts` | J1-P1-1 thresholds | `out/j1.txt` |
| `r-open.ts` | N1-P2-2 | `out/open.txt` |
| `r-leads.ts`, `r-leads2.ts`, `r-leads3.ts` | N1-P2-3 and lead erasure | `out/leads*.txt` |
| `r-p3.ts` | N1-P3-1, N1-P3-2 | `out/p3.txt` |
| `r-p31.ts`, `r-p33.ts`, `r-vc.ts` | J1-P3-1, J1-P3-3, J1-P2-1 | `out/p31.txt`, `out/p33.txt`, `out/vc.txt` |
| `r-tf.ts`, `r-kept.ts`, `r-ramp.ts`, `r-misc.ts`, `r-misc2.ts` | Verified-clean spot checks and new-gap probes | `out/tf.txt`, `out/kept.txt`, `out/ramp.txt`, `out/misc*.txt` |

```json
{
  "area": "N1",
  "role": "refuter",
  "tree": "9a0b1a80b",
  "verdicts": [
    {"id": "J1-P1-1", "verdict": "CONFIRMED", "severity": "P1", "known": "K-4", "evidence": "REPRO r-j1: hole d* = n(W+D)/pi + D, part d* = n(W+D)/pi - D, exact on 5 configs; em-6350 swallows holes < 22.07 mm; warnings [] on mixed layers"},
    {"id": "J1-P2-1", "verdict": "CONFIRMED", "severity": "P2", "evidence": "REPRO r-vc: Z-6.350 in 6.35 stock, no warning; 6.0 warns; relief twin has warnAtStockBottom"},
    {"id": "J1-P3-1", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO r-p31: 3 laps at Z-1 (96.81 mm)"},
    {"id": "J1-P3-2", "verdict": "CONFIRMED (narrowed)", "severity": "P3", "evidence": "READ: no fit/tan vs glueGapMm check"},
    {"id": "J1-P3-3", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO r-p33: tabs Z-5.000 on 6.35/7; groove 3 mm gets 8 rises to Z-1 silently"},
    {"id": "N1-P2-1", "verdict": "CONFIRMED", "severity": "P1", "from": "P2", "evidence": "REPRO two readers: default square 7.2 of 12 mm2; at W 1 (1/8in) or W 2.5 (1/4in) every corner tab is milled away and the part is cut free with Tabs on, no warning; Default direction twin holds at set width; triangle loses a tab with 1/4in at default W"},
    {"id": "N1-P2-2", "verdict": "CONFIRMED", "severity": "P1", "from": "P2", "evidence": "REPRO two readers: open outline gap 0-3 mm On path / 1 mm Outside, Tabs on: part free, no tab level, no warning; Tabs-off twin warns; precedent M6-P1-2", "note": "ADR-258 Amd 4 D4 scopes the warning to closed shapes; coordinator may route as an ADR scope question"},
    {"id": "N1-P2-3", "verdict": "CONFIRMED", "severity": "P2", "evidence": "REPRO r-leads*: D16 6.68 vs 10.5 mm2; lead r>=4.5 erases the two seam tabs; slug always still held; Outside parts unaffected"},
    {"id": "N1-P3-1", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO r-p3: 8 components auto; one anchor -> both lobes held"},
    {"id": "N1-P3-2", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO r-p3: seeded 12.0 vs automatic 7.2 mm2"},
    {"id": "N1-P3-3", "verdict": "CONFIRMED", "severity": "P3", "evidence": "READ + out/p33"}
  ],
  "new": [],
  "partial_refutation": "N1-P2-1 wedge '0.65 mm' is a Euclidean gap; holding section on a 20 deg tip is 6.36 mm2 (3.18 mm-equivalent) because the cheapest fracture crosses the full-thickness tip",
  "counts": {"raised": 6, "refuted": 0, "P1": 2, "P2": 1, "P3": 3, "known": 5}
}
```

Refuter counts: raised 6, refuted 0, P1 2, P2 1, P3 3, known 5
