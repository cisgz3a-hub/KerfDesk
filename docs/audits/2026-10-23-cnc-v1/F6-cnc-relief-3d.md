# CNC audit v1 — F6 Relief and 3D (`cnc-relief-3d`)

- **When:** 2026-10-23   **Tree:** worktree `claude/rolling-audit-20261021` @ `2ff73f586`. Its `src/core/cnc`, `src/core/relief`, `src/core/heightfield`, `src/io/gcode`, `src/ui/layers` and `src/ui/state` relief files are identical to origin/main `87ecb4f24` (fetched 2026-10-23; `git diff --stat origin/main HEAD` lists no file in scope).
- **Scope:**
  - `src/core/cnc/compile-cnc-relief*.ts`, `relief-machine-space*.ts`, `relief-material-side.ts`, `relief-ramp-field.ts`, `cnc-relief-group.ts`, `cnc-two-sided-setup.ts`
  - `src/core/relief/**` on the toolpath side: finishing, strategy, rest (`relief-residual-stock.ts`, `relief-rest-passes.ts`), two-sided split, rail profile, `heightfield-to-heightmap.ts`, `mesh-to-heightmap.ts`, `relief-object-to-heightmap.ts`
  - Followed into: `src/ui/state/relief-two-sided-actions.ts`, `src/ui/layers/ReliefTwoSidedSplit.tsx`, `ReliefRailControls.tsx`, `src/io/gcode/prepare-output.ts`, `src/ui/laser/cnc-compiled-depth-warnings.ts`, `cnc-relief-planning-warnings.ts`
- **Governing:**
  - ADR-412 and Amd 1, ADR-421 and Amd 1, ADR-423, ADR-424, ADR-488, ADR-573, ADR-575, ADR-580
  - the 2026-10-08 leaders plan R05 (3D rest finishing), R07 (rail/profile) and D01 (two-sided); `docs/audits/2026-10-08-cnc-leaders/IMPLEMENTATION.md:202-210` and `BUILD.md:26-33`
  - PROJECT.md non-negotiables (no new Start gates; disclosures are advisory)
- **Lenses run:** L1, L3, L4 and L7 as separate passes (the stressed lenses), plus L2 for the scallop law, drop-cutter contact and the reference two-sided model. L5 was skipped: the only untrusted input is a project or STL file, which belongs to areas 13 and 14. L6 was light: rest and projection fallbacks reach Job Review, and setup failures are the KNOWN 16-P3-2.
- **Method:**
  - Small reliefs were compiled through the real path (`emitGcode`, which runs `prepareOutput` → `compileCncJob` → emit). The two-sided cases first ran the real store action `splitReliefForTwoSides`.
  - The repros were three temporary test files, now deleted: `src/io/gcode/zz-f6-relief.test.ts`, plus `src/core/cnc/zz-f6-rest-probe.test.ts` for the rest prediction and the rail sampler.
  - An independent oracle (`f6-oracle.mjs`, no app code) parsed the emitted G-code, mapped it back to relief-local millimetres, and checked two things:
    - a drop-cutter test at every cutting sample (0.05 mm): the cutter solid (lower profile plus shank) against every source pixel centre under its footprint, minus the stock to leave, reported both vertically and as normal penetration;
    - a removal grid (0.05 mm), with the leftover measured against the bilinear pixel surface, region by region.
  - `f6-two-sided.mjs` stamped each side's program in its own machine frame. It then mapped side B through the **physical** flip of the stock (its own equations), and compared the remaining part with the STL wedge placed where the original relief stood.
  - Every heightmap was at most 240 × 240 px.
- **Counts:** 5 raised → 0 refuted, 1 merged (F6-P2-1 into 16-P2-1) → P1 1 / P2 1 / P3 2 (+ 4 KNOWN re-observed, not re-raised). Refuter: 4 confirmed, 0 plausible, 0 refuted, 1 merged. Severity change: F6-P3-3 raised from P3 to P2.

## Headline

**Two-sided split (F6-P1-1).** Splitting an STL relief for two-sided carving bakes the current Machine Setup stock thickness into both side meshes. Each side gets a frame at its stock face, and the model is centred by `(T − D)/2`. Nothing records that thickness, and nothing re-checks it. If the stock thickness is edited after the split, both side programs still compile without a word, and the halves no longer meet:
- 14 → 18 mm makes the part 4.0 mm too thick.
- 14 → 12.5 mm makes it 1.5 mm too thin, and side B's floor ends 0.12–0.38 mm above side A's floor all the way round. The part is cut free during side B.
- The split's own "stock is thinner than the model" warning invites exactly this edit. Splitting on the default 6.35 mm stock and then entering the real 14 mm board gives a part 4.0 mm too thick.

With the stock unchanged, registration is correct: halves meet within the scallop, including under 30° rotation with an X flip.

**Depth-map finishing on slopes (F6-P2-1).** Finishing a depth-map relief leaves a uniform skin on every slope, whichever way the rows run. With the default 1/8" ball and 0.025 mm scallop on a 42° slope:
- the minimum is 0.100 mm and the median 0.141 mm (vertical);
- the same slope as an STL leaves a median of 0.008 mm;
- asking for a 25× finer scallop only halves it.

The refuter merged this into 16-P2-1, the same depth-map finishing-cell decision.

**Gouge check.** No new gouge was found for ball, tapered ball, end mill or engraver. Every intrusion is the KNOWN convex-crease chord (K-1 and 16-P2-1). Roughing keeps its 0.5 mm in 3D everywhere (≥ 0.4995).

**Rest and rail (P3).**
- Rest finishing silently turns into an unreduced full fine finish on any relief larger than about 22 mm square. The fallback reason does reach Job Review.
- Curved rails are refused as "not single-valued" at the default 32 sampling steps. The refuter re-rated this P2: ordinary arcs are refused at 16 steps too.

## Measurements

Bench: 24 × 24 mm depth map, 0.1 mm pixels (240²), 16-bit, 6 mm deep. Features:
- an R5 hemisphere;
- a 6 × 6 mm boss with vertical walls;
- a 0.4 mm rib, 4 mm tall;
- a plateau with a 0.8 mm valley.

Roughing on every bench run: `em-3175` at 2 mm per pass, allowance 0.5 mm.

Slope map: 24 × 10 mm, 10 mm deep, in three bands: flat, 20° and 42°, all rising across X rows. Its STL twin is the same planes as a mesh.

"Leftover" is measured vertically against the bilinear pixel surface. Measured against a stepped-pixel surface, every slope figure is lower by about g·0.05 mm (0.045 mm at 42°).

| Relief / tool / strategy | Worst intrusion (normal; vertical) | Leftover vs promised | Source of "promised" |
|---|---|---|---|
| bench / `em-3175` roughing | none: min 3D clearance 0.4995 mm | stated 0.5 mm | ADR-412 item 3 |
| bench / `bn-3175` raster, 0.025 | 0.078 mm at the rib's top edge (2.05, 15.35): K-1 crease chord | flat ≤ 0.0249. Hemisphere crown (≤ 17°): p50 0.043, max 0.113. Flank (43–62°): min 0.157, p50 0.199, max 0.294 | UI "Scallop height target" 0.025; h = r − √(r² − (s/2)²) |
| bench / `bn-3175` raster + waterline | 0.038 mm (K-1) | flat ≤ 0.0124. Flank: min 0.066, p50 0.097, max 0.160 | same |
| bench / tapered ball (1.0 mm tip, 10° included, 3.175 mm) raster | 0.0000 | flat ≤ 0.0244. Flank: p50 0.078, max 0.172 | ADR-368 (tip-ball scallop) |
| bench / `em-1588` raster | 0.0005 | flat 0. Flank: p50 0.150, max 0.326 | non-ball rows 0.4·D (K-3) |
| bench / engraver 30°, 0.3 mm flat, raster | 0.058 mm at the boss corner (18.95, 2.05): 16-P2-1 class | floors keep the full 0.500 mm allowance (rows 1.27 mm apart): K-3 | K-3, 16-P2-1 |
| bench / `bn-6350` raster | 0.134 mm at the boss corner: K-1 (half cell 0.20) | flank p50 0.270, max 0.766 | same |
| slope 42° / `bn-3175` raster along the slope (axis Y), 0.025 | 0 | min **0.100**, p50 **0.141**, max 0.198 | 0.025 (ridge-free direction) |
| STL twin, same settings | 0.0005 | p50 0.008, max 0.034 (= 0.025/cos 42°) | ADR-580 exact contact |
| slope 42° / raster across the slope (axis X), 0.025 | 0.086 mm at the 20°/42° band edge (K-1) | max 0.205 | theory 0.061 (1/cos²φ); STL twin 0.061 |
| slope 42°, scallop 0.005 / 0.001 (axis Y) | 0 | p50 0.119 / 0.056; max 0.162 / 0.093; flat 0.0050 / 0.0009 | requested 0.005 / 0.001 |
| slope 20° (axis Y), 0.025 | 0 | min 0.041, p50 0.061, max 0.093 | STL twin p50 0.007, max 0.027 |
| two-sided wedge, stock 14, flip Y (and 30° rotation + flip X) | — | part thickness − model: p50 0.022 (0.024), max 0.099 (0.102); web 1.08–1.44 (frame shadow) | ADR-580 Decision 4 |
| two-sided, split at 14, stock then 18 | — | **+4.0 mm** part; web 5.1–5.4 | Vectric gap above/below shared by both sides |
| two-sided, split at 14, stock then 12.5 | — | **−1.5 mm** part; web **−0.12 to −0.38** (through-cut) | ADR-580 "the part stays held" |
| two-sided, split at 6.35 (warned), stock then 14 | — | **+4.0 mm** part; web 5.1–5.4 | same |
| rest: `bn-6350` then `bn-1588` rest, 12 × 12 mm | 0.0066 | no residual > threshold missed; selection 74 % of cells, 98.5 % of the full path | R05 acceptance |
| rest: same, bench 24 × 24 | 0.016 | budget fallback: rest path = full fine path (1961.7 vs 1961.6 mm), 24,173 vs 4,713 moves | R05; ADR-421 item 3 |

## Findings

### F6-P1-1 — A two-sided split freezes the stock thickness; a later stock edit silently makes the part the wrong thickness or cuts it free

- **Where:**
  - `src/ui/state/relief-two-sided-actions.ts:68-73`: the split passes `machine.stock.thicknessMm` as it is at that moment.
  - `:119-121`: each side relief keeps only its mesh. The thickness used is not recorded anywhere on the relief or the setup.
  - `src/core/relief/relief-two-sided-split.ts:74-86`: `above = (T − D)/2` and `below = T − D − above`. Side A's frame is set at `D + above`, side B's at `below`, and `depthMm = faceZ − floor`.
  - `src/core/cnc/cnc-two-sided-setup.ts:24-72`: the side B flip reads the stock's XY only.
  - `src/ui/laser/cnc-compiled-depth-warnings.ts:59-78`: the only stock-thickness check compares each program's deepest Z with T, separately for each side.
- **Anchor:**
  - Contract: ADR-580 Decision 4. "Each side carries a 1 mm frame at its stock face … the model sits centred in stock thicker than itself … The two floors stand one web apart, so the part stays held." The split UI repeats it: "centred in the {T} mm stock, with a holding web" (`ReliefTwoSidedSplit.tsx:46-50`).
  - Twin: the stock Machine Setup now holds, and which Job Review shows on its stock card, against the stock frozen into the side meshes.
  - Ground truth: Vectric keeps one model-in-material position, a gap above or below the model, that derives both sides from the current material thickness. Vectric Material Setup: "The gaps defined here are for the entire combined models from both sides" (https://docs.vectric.com/docs/V12.0/Aspire/ENU/Help/form/material-setup-flat).
- **Scenario:**
  1. Import a 20 × 12 × 10 mm STL wedge with a recess in its bottom.
  2. Split it with split 5, web 1 and margin 4, on 14 mm stock.
  3. The operator measures the board and enters 12.5 mm in Machine Setup › Stock.
  4. Side A still cuts its floor to Z−7, and side B to Z−6.
  5. Side A's floor is now 12.5 − 7 = 5.5 mm above the bottom, and side B's floor is 6 mm above it. The floors cross by 0.5 mm, and side B's floor ends 0.12–0.38 mm above side A's floor (measured on the scallop and frame-shadow floor).
  6. The part comes free during side B, beside the running cutter. The model is also 1.5 mm thinner than the STL.

  The same split followed by 18 mm stock gives a part 4.0 mm thicker and a 5 mm web.

  The most natural path: split on the default 6.35 mm stock. The toast warns "The stock is thinner than the 10 mm model, so the sides were planned for stock exactly as thick as the model." The operator then enters the real 14 mm board. The split stays planned for 10 mm, so the part comes out 4.0 mm thick too thick, with a 5 mm web. Neither program raises a preflight issue or a Job Review note. Each side's depth (7 / 6 mm, or 5 / 4 mm) is inside the stock, so the depth advisory never fires.
- **Evidence:** REPRO.
  - `zz-f6-relief.test.ts` "split and emit both sides", with `F6_TS` set to base, rot-x, stale-18, stale-12.5, thin-then-14 and off. It runs the real store action, edits the stock, then runs `emitGcode` for side A and side B. Command: `F6_TS=stale-12.5 node ../../../node_modules/vitest/vitest.mjs run src/io/gcode/zz-f6-relief.test.ts -t "split and emit"`.
  - Then `node f6-repros/f6-two-sided.mjs f6-out <variant>`:
    - `variant stale-12.5 … part thickness - model thickness: min -1.506 p50 -1.478 max -1.401` and `web thickness in margin … min -0.380 p50 -0.116 max -0.116`
    - `variant stale-18 … part thickness … p50 4.022`
    - `variant thin-then-14 … part thickness … p50 4.013`
    - control `variant base … part thickness … p50 0.022 max 0.099`
  - The only preflight issue in every case was `cnc-secondary-tool-feed-retained`.
  - L7: `relief-two-sided-split.test.ts` checks the meshes at one thickness, and `relief-two-sided-actions.test.ts` checks the action. `prepare-output-two-sided.test.ts` uses vector lines only. No test compiles both sides of a relief, and none changes the stock after a split.
- **Severity reasoning:** wrong physical output (part thickness, plus a through-cut that frees the part), reachable today, with no warning before the output is produced. The split-time toast is about the stock at split time, and the thin-stock toast invites the very edit that breaks the result.
- **Refuter:** **CONFIRMED, P1 kept.**
  - **Own repro.** A temporary `src/io/gcode/zz-f6r-twosided.test.ts`, now deleted.
    - Model: a closed 20 × 12 × 10 mm block STL, not the auditor's wedge.
    - Split: the real store action, with split 5, web 1 and margin 5.
    - Stock edit: applied the way Machine Setup's Stock thickness commit applies it.
    - Output: `emitGcode` for side A and for side B.
    - Bits: the 1/8" end mill both roughs and finishes, so the stamp is exact.
    - Simulation (own, no app code): every move is sampled every 0.05 mm and stamped as a flat disc on a 0.2 mm grid, one grid per side.
    - Side B mapping: side B is mapped onto side A because the frame box must mirror onto itself, x_B = c − x_A. Both programs' cut extents give c = 160.00, which equals 2 × origin X + stock width; Y does not change.
    - Material per column: T + z_A + z_B.

    | Split on → stock then | Side depths A / B | Part at the centre | Web in the margin (8.8k cells) | Through-cut cells |
    |---|---|---|---|---|
    | 14 → 14 (control) | 7 / 6 | 10.0 (top 12, bottom 2) | 1.0 (max 1.2 beside walls) | 0 |
    | 14 → 18 | 7 / 6 | **14.0 (+4.0)** | 5.0 | 0 |
    | 14 → 12.5 | 7 / 6 | **8.5 (−1.5)** | **−0.5** (max −0.30) | **8,850**: the whole margin |
    | 6.35 (thin-stock toast) → 14 | 5 / 4 | **14.0 (+4.0)** | 5.0 | 0 |
    | 14 → 12.5, then saved and reloaded | 7 / 6 | 8.5 | −0.5 | 8,850 |

    No case raised a preflight issue on either side. The auditor's figure of −0.12 to −0.38 is this same 0.5 mm overlap, read with ball scallops.
  - **Re-derivation from the current stock: none.**
    - `splitReliefForTwoSides` has one caller, the button in `ReliefTwoSidedSplit.tsx:24`.
    - Relief compile never reads `stock.thicknessMm`. The only CNC compile reader is the tab gate at `compile-cnc-layer-passes.ts:84`.
    - `cncSideOutputProject` reads only the stock's XY.
    - The side reliefs carry baked meshes and a baked depth (7 / 6).
  - **Stored, and survives save and reload.**
    - The saved `cncSetup` holds `twoSided` with: activeSide, flipAxis, sideBStockOriginMm, sideAObjectIds, sideBObjectIds, registration. No thickness is stored.
    - The reloaded project emits the same stale programs.
  - **No warning reaches the operator.**
    - No code compares the two sides' depths, or a split thickness, with the stock. The side-ID lists are read only for scene filtering, the setup panel, Frame identity, nesting copies and validation.
    - The relief depth advisory checks each side's 7 or 6 mm against T alone.
    - Job Review's stock card shows T and the active side.
    - Neither Machine Setup › Two-sided machining nor the stock fields say anything about re-splitting.
    - Worse, the split panel's note reads the *current* stock. After the edit it says "centred in the 12.5 mm stock", the opposite of what the sides hold.
  - **The thin-stock path.**
    - The split-time toast (warning level) says the sides "were planned for stock exactly as thick as the model". It is accurate when shown, but it does not say to split again after a stock change, and it is gone before that edit. Nothing fires afterwards.
    - "The toast invites the edit" is a little strong. The clearer invitation comes earlier, from the STL import notice (`stl-import-size.ts:122-127`). It offers "use thicker stock, or split it for two-sided carving" as alternatives, and doing both gives the +4.0 mm part.
  - **Severity.** The part comes out the wrong thickness (+4.0 or −1.5 mm), and a through-cut frees it during side B. An ordinary stock edit reaches this, and no warning comes first. Neither §3 way to lower a P1 applies, so P1 stands.
- **Fix direction:** Store the split's model-in-material (gap above/below, or the T used) on the side reliefs or the setup, and either rebuild the side meshes from the current stock or block on a mismatch. At minimum, put a Job Review advisory on a stock-thickness mismatch, and on a combined web that falls to zero or below.

### F6-P3-1 — 3D rest finishing falls back to a full fine finish on any relief over about 22 mm square

- **Where:**
  - `src/core/relief/relief-residual-stock.ts:9, 28-36, 75-93`: `MAX_PREDICTION_WORK = 32,000,000`, against (predecessor path ÷ half a rest cell) × (2⌈R_pred/cell⌉ + 3)².
  - `src/core/cnc/compile-cnc-relief-rest.ts:131-140`: the fallback selects every cell.
- **Anchor:** Contract: leaders plan R05 acceptance, "the smaller cutter covers those regions within tolerance … Report estimated savings" (`IMPLEMENTATION.md:210`). The fallback is disclosed (`cnc-relief-planning-warnings.ts:116-118`), so this is a reach problem, not wrong output.
- **Scenario:** a 1/4" ball finish, then a 1/16" ball rest, at the default 0.025 mm scallop, on a flat relief with one groove. The selection works at 16 and 20 mm square (854 of 14,884 and 1,064 of 23,104 cells). At 24, 30 and 40 mm square it is "Remaining-stock prediction exceeded its work budget; full fine finishing retained." On the 24 mm bench the rest path equals the full 1/16" finish: 1961.7 mm against 1961.6 mm.
- **Evidence:** REPRO. `zz-f6-rest-probe.test.ts` "rest fallback vs relief size" (log `f6-out/rest-probe.txt`), and `f6-rest-compare.mjs`.
- **Refuter:** **CONFIRMED (P3).** The second line of evidence is the work formula in the code (`relief-residual-stock.ts:9, 28-36, 75-93`), worked by hand for a 1/4" ball followed by a 1/16" ball rest at 0.025 mm:
  - The rest cell is 0.132 mm. The stamp side is 2⌈3.175/0.132⌉ + 3 = 53, so each sample costs 2,809 cells.
  - Predecessor rows are 0.795 mm apart, sampled every 0.066 mm (half a cell).
  - A 20 mm square: about 26 rows × 304 samples × 2,809 ≈ 22 M, under the budget, so it selects.
  - A 24 mm square: about 31 × 365 × 2,809 ≈ 32 M plus the links between rows, over the budget, so it falls back.
  - The limit is therefore about 23–24 mm square ("about 22" in the headline is slightly low). This agrees with the auditor's measured 20 mm selects / 24 mm falls back.
  - The fallback still finishes the whole relief, and Job Review discloses it (`cnc-relief-planning-warnings.ts:116-118`). The problem is reach, not wrong output, so P3.
- **Fix direction:** Bound the prediction work by stamping the predecessor footprint per cell row, or by a coarser conservative grid, so ordinary sign-size reliefs get a real rest selection. Report the size limit in the panel.

### F6-P3-2 — Rest finishing output is not point-reduced: 5× the G-code lines of the identical finishing path

- **Where:** `src/core/relief/relief-rest-passes.ts:37-45` (the refuter corrected this from `:236-248`). Every kept move is cut into half-cell pieces and emitted vertex by vertex. Nothing reduces them again, unlike `reduceFinishingPath` in `relief-finishing.ts:366`.
- **Anchor:** Twin: ADR-421 item 3 (one-sided point reduction) and its Context: "GRBL's 16-block planner starves on long runs of short segments".
- **Scenario:**
  - The 24 mm bench rest, which is a full-path fallback, emits 24,173 cutting moves (671 KB) for the same 1961.7 mm path that plain finishing emits in 4,713 moves (131 KB).
  - The 12 mm relief, with a real selection, emits 6,640 moves against 2,134 for 586 mm.
  - Segments are 0.066 mm long, about 250 blocks per second at 1000 mm/min.
- **Evidence:** REPRO (`f6-rest-compare.mjs`: `rest bn-1588 { L: 1961.7, moves: 24173 }`, `full bn-1588 { L: 1961.6, moves: 4713 }`).
- **Refuter:** **CONFIRMED (P3). Citation corrected.**
  - **The cited lines do not exist.** `relief-rest-passes.ts` is 114 lines long.
    - The half-cell split is at `:37-45`: `count = ceil(len / (cell/2))`, and every piece is pushed as its own point.
    - `compile-cnc-relief-rest.ts:140-149` maps those points to machine coordinates and never reduces them.
    - `reduceFinishingPath` has a single caller, `relief-finishing.ts:366`.
  - **Second line of evidence.** Counting motion lines by operation comment in the auditor's emitted `bench-bn6-rest.nc` gives about 25.6k lines in the rest operation, against 4,729 in the plain 1/16" finish (`bench-bn16-raster.nc`).
  - **Severity.** The cost is controller throughput; the cut is not wrong. P3.
- **Fix direction:** Run the kept runs through `reduceFinishingPath`. Its one-sided tolerance keeps the contact proof.

### F6-P3-3 (refuter: P2) — Curved rails are refused as "not single-valued" at the default 32 sampling steps

- **Where:**
  - `src/core/relief/relief-rail-profile.ts:183-197`: stations are the sampling steps plus every rail vertex.
  - `:204-217`: the cross-section at a station uses the local segment normal, or the bisector exactly at a vertex.
  - `:54-55`: `reliefBoundaryError` rejects the outline.
  - `src/ui/layers/ReliefRailControls.tsx:314`: new rails get `samplingSteps: 32`.
- **Anchor:**
  - Contract: R07, "Crossing/folded/multi-valued surfaces are rejected" (`BUILD.md:32`), and ADR-575's "injective bilinear rail strips". A rail whose radius of curvature exceeds the half-width is single-valued.
  - L7: the app's own curved-rail test (`relief-rail-authoring.test.ts:166-176`) passes only at `samplingSteps: 16`.
- **Scenario:** within about (w/2)·tan(turn/2) of a vertex, a station on the inner side gets an offset point that crosses its neighbour's. The outline then "touches" itself and the sweep is refused with "Rail sweep is not single-valued: Self-intersecting, overlapping or touching relief boundaries are unsupported." Measured:
  - The app test's own 4-point curve fails at widths 1, 1.5, 2 and 3 mm with 32 steps.
  - Quarter-circle rails (radius 10, width 4) fail with 7, 9, 31, 33 or 63 segments.
  - A Bezier (minimum radius above 10 mm) fails at width 4 with 24 points, and at width 2 with 48 or 100 points.
  - Evenly spaced straight rails can also fail. A 5-point, 37.3 mm rail has a vertex at t = 0.75000000000000011, next to the 24/32 station.
  - A straight rail whose width changes is exact (the 10-09 fix holds: 9 of 9 points match the analytic profile to 1e-4).
- **Evidence:** REPRO. `zz-f6-rest-probe.test.ts` "rail curve widths", "rail arc segment counts", "rail parameter coincidence" and "rail arc ring debug" (the debug test prints the crossing inner-side segments next to vertices).
- **Refuter:** **CONFIRMED. Re-rated P3 → P2.**
  - **Own repro.** A temporary `src/core/relief/zz-f6r-rail.test.ts`, now deleted, called `reliefRailProfileError` directly. The profile was the app test's triangle, 4 mm tall.
    - **The app test's 4-point curve.** At 32 steps it is refused at widths 1, 2 and 3. At 16 steps it passes only at width 1.
    - **Quarter arcs, radius 10, width 4.** With 7, 9, 16 or 31 segments they are refused at 16 steps as well as 32. With 16 segments the reason is "invalid or repeated points": a station lands on a vertex.
    - **Radius 30, width 4.** Refused with 20 and 24 segments; 30 segments pass.
    - **Radius 30, width 10.** Three of five segment counts are refused.
    - **Radius 50, width 6** (radius 17× the half-width). Refused with 8, 12, 20 and 24 segments; 30 segments pass.
    - **A sine rail** (amplitude 5, length 40, 25 points, minimum radius 8.1 mm). At width 6 it is refused at 32 and 64 steps with "folds or collapses". At width 4 it is refused at 64 steps.
  - **Why P2.**
    - These rails are single-valued, so R07 (`BUILD.md:32`) says they should be accepted. They are ordinary rails, and they are refused at the shipped default.
    - The message is wrong: it says the sweep is "not single-valued" or "folds".
    - The only lever, Sampling steps (`ReliefRailControls.tsx:155`), does not reliably help. Neither does 16.
    - That fits METHOD §3 P2: "wrong behaviour an ordinary user will hit, with a misleading result", and a broken contract with a clear failure scenario.
    - It is not higher, because it fails safe: nothing is cut wrongly.
- **Fix direction:** Section the sweep along a smoothed normal field (interpolated vertex normals), or merge stations within the corner's swallowtail length of a vertex. Snap near-equal station parameters before building the outline. Keep the fold check for genuinely folded strips.

## Merged

### F6-P2-1 — Depth-map finishing stands off every slope by about slope × half a finishing cell, many times the requested scallop; a finer scallop barely helps

- **Where:**
  - `src/core/relief/heightfield-to-heightmap.ts:305-313` (`sampleTargetCell`): each CAM cell holds the highest pixel of its whole overlapping footprint.
  - `src/core/relief/relief-object-to-heightmap.ts:28-29`: a heightfield always takes that path, whatever `sampling` asks for.
  - `src/core/cnc/compile-cnc-relief-finishing.ts:38-43, 113-120`: the finishing cell is `rowSpacing / ceil(rowSpacing / (D/10))`.
  - The ball is then solved exactly against those lifted samples (ADR-412). On a slope with gradient g, the surface it rides is about g·(cell/2 + px/2) above the source, wherever the rows run.
- **Anchor:**
  - Contract and UI: ADR-421's title, "Relief finishing cuts the scallop it is asked for", and the Finish scallop tooltip "Scallop height target (mm) … smaller = finer finishing rows" (`CncLayerToolFields.tsx:62`). ADR-412 Amd 1 Consequences does document this stock for depth maps. It names the remedy: "A finer scallop shrinks the finishing cell and this stock with it". Measured, that remedy is ineffective: the D/10 cap ties the cell to √scallop.
  - Twin: ADR-580 Context 1 calls the identical stand-off a defect for STL ("Finishing stood off every slope") and fixed it there with exact contact. The same planes as an STL finish to the scallop.
  - Ground truth: the scallop law h = r − √(r² − (s/2)²) assumes a cutter that touches the surface at every row. OpenCAMLib's drop-cutter "drops a cutter … until it touches the 3D model" (https://github.com/aewallin/opencamlib).
- **Scenario:** a depth-map relief (photo or sculpt) finished with the default 1/8" ball at 0.025 mm scallop.
  - On a 42° face the ball never comes closer than 0.100 mm vertical. Median 0.141, max 0.198 (about 0.074–0.147 mm normal). That holds even with the rows running down the slope, where the scallop law predicts 0.025.
  - On 20°: min 0.041, median 0.061.
  - On the bench hemisphere's 43–62° flank: median 0.199, max 0.294.
  - Asking for 0.005 mm gives a median of 0.119. Asking for 0.001 mm (5× the rows) gives 0.056, while the flats drop to 0.0009.
  - The STL twin on the same planes leaves a median of 0.008 and a max of 0.034.
  - Job Review states neither the cell nor the slope stock. Its scallop notes compare only the scallop with the ball radius (`cnc-relief-planning-warnings.ts:174-207`).
- **Evidence:** REPRO. `zz-f6-relief.test.ts` "slope scallop variants" and "same slopes as an STL mesh", then `node f6-repros/f6-oracle.mjs f6-out slope-bn-raster-y "regions=$(cat f6-repros/slope-regions.b64)"`:
  - `residual slope42: … min 0.1001 p50 0.1413 … max 0.1975`
  - STL twin: `residual slope42: … p50 0.0079 … max 0.0340`
  - finest: `residual slope42: … p50 0.0555 … max 0.0933` with `residual flat: … max 0.0009`

  Novelty: ADR-412 Amd 1 records the depth-map stock; no audit ledger raises it. 16-P2-1, the KNOWN gouge from the same full-diameter cell, is the opposite symptom for non-ball bits. 09-29 P2-relief-finish-2 is the non-ball row spacing.
- **Refuter:** **MERGE-INTO 16-P2-1** (rolling v2). Reproduced; P2.
  - **Own repro.** A temporary `src/io/gcode/zz-f6r-slope.test.ts`, now deleted.
    - Surface: one analytic 42° plane (g = 0.9). As a depth map it is 100 × 80 px at 0.1 mm, 16-bit, plus a 0.2 mm full-height pin in a far corner to fix the Z datum. The STL twin is the same plane as 2 triangles.
    - Finish: 1/8" ball, raster rows along the gradient (`reliefRasterAxis: 'x'`; the rows ran 147 mm in X against 8 mm in Y).
    - Window: 5 × 4 mm, away from the edges.
    - Measured, with no app code: the analytic cutter stand-off at every 0.02 mm sample (ball centre against the plane plus r·sec θ), and a ball removal grid at 0.02 mm.

    | Source, scallop | Finishing cell | Stand-off, vertical: min / p50 | Leftover, vertical: min / p50 / max |
    |---|---|---|---|
    | depth map, 0.025 | 0.281 | 0.100 / 0.136 | **0.100 / 0.142 / 0.196** |
    | depth map, 0.005 | 0.252 | 0.088 / 0.120 | 0.088 / 0.116 / 0.162 |
    | depth map, 0.001 | 0.113 | 0.028 / 0.066 | 0.028 / **0.058** / 0.091 |
    | STL, 0.025 | 0.281 | −0.0006 / 0.0000 | −0.0003 / 0.009 / 0.033 (= 0.025 · sec 42°) |

    The stand-off follows g · cell/2 (0.126, 0.113 and 0.051 mm), plus up to g · px/2. That is the lift from taking the highest pixel in each cell, not the scallop.
  - **ADR-412 Amendment 1, read in full.**
    - Its Consequences record that finishing leaves this stock on slopes "as it already did for depth maps".
    - It also says "A finer scallop shrinks the finishing cell and this stock with it." That is true in direction but weak in effect. `finishingCellSizeMm` caps the cell at D/10, and the cell follows the row spacing (√scallop) only once the spacing is below that cap.
    - So a 5× finer scallop (0.025 → 0.005) removes 18 % of the stock. A 25× finer one, with 5× the rows, halves it, and the stock is still 58× the request.
    - The report should call the remedy "weak", not "ineffective".
  - **Why merge rather than keep it separate.**
    - Same code: 16-P2-1's root is the D/10 cap in `finishingCellSizeMm` (`compile-cnc-relief-finishing.ts:40`), applied to a depth map whose cells hold the highest pixel of their footprint (`sampleTargetCell`). The cutter is solved against those cell samples, not against the pixel surface.
    - Same discretisation, two symptoms: this finding is the ball-nose side of it. The lift leaves stock on slopes; the chord gouges convex edges (16-P2-1).
    - Same fix: solve contact against the pixel surface, as ADR-580 did for STL, or size the cell from the pixel pitch. Either closes both.
    - Same decision: 16-P2-1 is already awaiting the maintainer's decision on that cell. A second ledger row would count one decision twice.
  - **New facts for 16-P2-1's decision card.**
    1. Balls are affected too, as stock rather than a gouge: 0.10–0.20 mm vertical on a 42° depth-map slope at the default 0.025 mm scallop. That is 4–8× the request; the STL twin's p50 is 0.009.
    2. Finish scallop cannot fix it: 0.001 mm still leaves a p50 of 0.058.
    3. ADR-412 Amendment 1's remedy sentence overstates the effect.
    4. Job Review states neither the cell nor the slope stock.
  - **Severity: P2, not P1.**
    - The output is extra stock, never a gouge, and it is a consequence ADR-412 Amendment 1 documents.
    - Meta v1 M2 kept the worse symptom of the same root, 16-P2-1's gouge, at P2 for that reason.
- **Fix direction:** Solve depth-map finishing contact against the heightfield's own pixel surface (bilinear or pixel triangles), as ADR-580 did for STL triangles, or size the depth-map finishing cell from the source pixel pitch. In either case, state the slope stock in Job Review until then.

## KNOWN (re-observed on this tree, not re-raised)

- **16 K-1 / ADR-412 Amd 1 (ball crease chord).** 1/8" ball: 0.078 mm normal at the rib's top edge (raster) and 0.038 mm (raster + waterline). 1/4" ball: 0.134 mm at the boss corner. All are within half a finishing cell.
- **16-P2-1 (non-ball cell sized from the full diameter).** 30° engraver with a 0.3 mm flat: 0.058 mm normal at the boss's top corner.
- **16 K-3 / 09-29 P2-relief-finish-2.** Engraver rows are 1.27 mm apart, so the floors keep the whole 0.500 mm roughing allowance (bench background p50 0.500).
- **ADR-421 Consequences / 2026-10-13 quality audit item 1 (raster scallop grows across rows on slopes).** STL twin at 42°: 0.061 mm, which matches 0.025/cos² 42°.

## Refuted

These candidates were dropped by the auditor before raising:
- **"Rest finishing missed 4 cells (0.01 mm²) by up to 0.134 mm near the boss corner."** This was an oracle sampling artifact at r ≈ R on a steep move. Re-sampled finely (`f6-point-min.mjs`), both the full fine program and the rest program reach Z−3.371 there.
- **"0.797 mm vertical intrusion at the boss corner (`bn-3175`)."** The point sits under the shank at r = 1.585 of R = 1.5875. The normal penetration is 0.0025 mm, so this is a measuring artifact, not a gouge. The report uses normal penetration.
- **"Two-sided switched off after a split cuts side B from the top."** It does: both side reliefs compile into one top-side program (4 roughing and 2 finishing passes, no preflight issue). Side B's recess then cuts up to about 0.6 mm into the wedge top. Not raised: it needs the operator to disable the setup while both overlapping reliefs stay on the canvas, and it belongs to the reliefs-on-one-layer class (16 K-2).
- **"A model region visible from above but below the split (for example a flange) is carved by neither side."** By reading only. This is ADR-580 Decision 4's definition ("down to a split plane"). It was not checked against Vectric's zero-plane behaviour, so it was not raised.

## Verified clean

- **Roughing 3D allowance (ADR-412 item 3).** Minimum clearance was 0.4995 mm against 0.5 in every bench, slope and two-sided program.
- **Rapids and bounds.**
  - No program has a lateral rapid below Z0.
  - Minimum Z equals −relief depth.
  - Every cutter-centre sample lies inside the relief's XY extent. The cutter reaches past the edge only by its radius, under the documented bottomless-edge rule.
- **New tools, no new gouge.** The tapered ball (1.0 mm tip, 10° included) finishing the bench and the slopes: 0.0000. The 1/16" end mill: 0.0005. The 1/16" ball: 0.016 (K-1).
- **Scallop law.**
  - `scallopRowSpacingMm` is s = 2√(c(2r − c)), the exact inverse of h = r − √(r² − (s/2)²) (algebra checked).
  - Flats leave the request or less: 0.0249 / 0.0050 / 0.0009 at 0.025 / 0.005 / 0.001.
  - On STL slopes, finishing matches theory (0.034 along the slope, 0.061 across it at 42°).
- **STL exact contact (ADR-580).** Penetration ≤ 0.0005 mm on the STL slope twin.
- **Two-sided registration with the stock unchanged.**
  - Flip around Y, and 30° rotation with a flip around X: the halves meet (thickness error p50 0.02, max 0.10 mm, from scallops).
  - The bottom recess lands under its top-view position.
  - Side depths match ADR-580: A = D + above − split = 7, B = below + split − web = 6.
  - The web is ≥ 1 mm where the finishing reaches.
  - Roughing loops wind the same way (CCW in machine coordinates) on both sides after the flip.
- **Rest coverage when the prediction runs (12 × 12 mm).** No cell that the 1/16" ball removes in a full fine finish (residual > 0.05 mm) was left by the rest program.
- **Z datum.** `CncMachiningSetup.zDatum` is only `'stock-top'` (`cnc-machining-setup.ts:23`), and every relief maps its highest point to Z0. Configurable bottom-of-stock zero does not exist, so it has nothing to get wrong.
- **Rail, straight with changing width (10-09 P2 fix).** Exact to 1e-4.
- **Novelty.** `gh pr list --state open` returned no open PRs (2026-10-23). No commit touching the relief files has landed since `#1136` (ADR-580), apart from test-only changes.

## Not verified

- V-bit finishing (KNOWN 16-P2-1). Projection depth (R06), beyond the 10-09 result of exactly −1.200 mm.
- Rail CAM output beyond the sampler; two-rail sweeps; the authoring sculpt path.
- Twin with the viewers:
  - the CNC 3D viewer and Cut 3D against the program (F8 scope; area 16 measured the removal grid within 0.03 mm);
  - the Relief 3D viewer's mirror (KNOWN 16-P3-4) for side B.
- Two-sided cases not run:
  - a scaled, nonuniformly scaled or mirrored original;
  - a non-default side B stock origin;
  - flip around X without rotation;
  - Raster + waterline (Automatic) finishing of the sides.
- Waterline and masked reliefs with the tapered ball. Reliefs larger than 24 mm (machine load). Hardware, air cuts or material.

## Repro files

Saved in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\f6-repros\`:
- **`zz-f6-relief.test.ts`:** place it in `src/io/gcode/`. The `describe` blocks are "F6 dumps" (bench, slope), "F6 STL slope twin", "F6 small rest" and "F6 two-sided". Cases are chosen with `F6_CASES` and `F6_TS`.
- **`zz-f6-rest-probe.test.ts`:** place it in `src/core/cnc/`. It holds the rest selection, the rest fallback by size, and the rail probes, and logs to `f6-out/rest-probe.txt`.
- **Scripts:** `f6-oracle.mjs` (drop-cutter plus removal grid), `f6-two-sided.mjs`, `f6-rest-compare.mjs`, `f6-near.mjs`, `f6-point-min.mjs` and `f6-winding.mjs`. The regions are `bench-regions.b64` and `slope-regions.b64`.

Outputs (`*.nc`, `*.meta.json`, `*.field.json`, `*.stock.json` and `oracle-*.txt`) are in `scratchpad\f6-out\`. The temporary `zz-f6-*` files were removed from the worktree.

The refuter's repros were `src/io/gcode/zz-f6r-twosided.test.ts`, `src/io/gcode/zz-f6r-slope.test.ts` and `src/core/relief/zz-f6r-rail.test.ts`, all now deleted. Their outputs are `f6r-out.txt`, `f6r-slope.txt` and `f6r-rail.txt` in the scratchpad folder.

```json
[
  {"id":"F6-P1-1","severity":"P1","area":"cnc-relief-3d","file":"src/ui/state/relief-two-sided-actions.ts","line":72,"anchor":"Contract: ADR-580 Decision 4 (model centred in the stock, floors one web apart, part stays held); Twin: Machine Setup stock thickness vs the thickness baked into the side meshes (relief-two-sided-split.ts:74-86); Ground truth: Vectric Material Setup gap above/below shared by both sides","evidence":"REPRO; refuter REPRO zz-f6r-twosided.test.ts (block STL 20x12x10, real split action, stock edit, emitGcode both sides, own flat-disc column sim, flip c=160 measured): control 10.0/web 1.0; 14->18 part 14.0 web 5.0; 14->12.5 part 8.5 web -0.5 (8,850 through cells); 6.35->14 part 14.0 web 5.0; save+reload identical; no preflight issue; no code stores or compares the split thickness; split panel note shows the current stock","verdict":"CONFIRMED","known":false,"summary":"Two-sided split bakes the stock thickness at split time into both side frames and records it nowhere; a later stock edit silently changes the part: 14->18 mm gives +4.0 mm part and 5 mm web, 14->12.5 mm gives -1.5 mm part and a web of -0.12..-0.38 (through-cut, part freed during side B), split on default 6.35 (thin-stock toast) then real 14 mm gives +4.0 mm; no preflight or Job Review note"},
  {"id":"F6-P2-1","severity":"P2","area":"cnc-relief-3d","file":"src/core/relief/heightfield-to-heightmap.ts","line":313,"anchor":"Contract: ADR-421 title + Finish scallop tooltip; ADR-412 Amd 1 remedy 'a finer scallop shrinks ... this stock' measured ineffective; Twin: ADR-580 exact STL contact on the same planes; Ground truth: scallop law h=r-sqrt(r^2-(s/2)^2) and drop-cutter touch (OpenCAMLib)","evidence":"REPRO; refuter REPRO zz-f6r-slope.test.ts (analytic 42deg plane, 0.1 mm 16-bit map vs 2-triangle STL, bn-3175 rows along the gradient): map 0.025 leftover min 0.100 p50 0.142 max 0.196 (stand-off p50 0.136 = g*cell/2); 0.005 p50 0.116; 0.001 p50 0.058; STL p50 0.009 max 0.033","verdict":"MERGE-INTO 16-P2-1","known":"merged into rolling-v2 16-P2-1 (same finishingCellSizeMm D/10 cap + sampleTargetCell max-of-footprint, same fix, same pending maintainer decision); new facts: balls leave 0.10-0.20 mm slope stock, scallop cannot fix it, ADR-412 Amd 1 remedy sentence overstates (weak, not ineffective)","summary":"Depth-map finishing rides max-of-footprint cells, so it stands off every slope by ~g*(cell/2+px/2): default 1/8in ball 0.025 on 42 deg leaves min 0.100 / p50 0.141 mm with rows along the slope (STL twin p50 0.008); 0.005 and 0.001 scallop still leave p50 0.119 / 0.056; hemisphere flank p50 0.199; Job Review silent"},
  {"id":"F6-P3-1","severity":"P3","area":"cnc-relief-3d","file":"src/core/relief/relief-residual-stock.ts","line":30,"anchor":"Contract: leaders plan R05 acceptance (IMPLEMENTATION.md:210)","evidence":"REPRO; refuter READ work formula relief-residual-stock.ts:75-93: 2,809 cells/sample, 20 mm ~22M selects, 24 mm ~32M+ falls back (threshold ~23-24 mm); fallback disclosed","verdict":"CONFIRMED","known":false,"summary":"Rest prediction work budget (32M) overflows for 1/4in->1/16in at default scallop on any relief >= ~24 mm square (16/20 mm select 6%/5% of cells; 24/30/40 mm fall back), so rest = full fine finish (1961.7 vs 1961.6 mm); fallback is disclosed in Job Review"},
  {"id":"F6-P3-2","severity":"P3","area":"cnc-relief-3d","file":"src/core/relief/relief-rest-passes.ts","line":37,"anchor":"Twin: ADR-421 item 3 point reduction and its planner-starvation context","evidence":"REPRO; refuter READ relief-rest-passes.ts:37-45 (file is 114 lines; cited :236-248 corrected) + compile-cnc-relief-rest.ts:140-149 no reduceFinishingPath; emitted rest op ~25.6k motion lines vs 4,729","verdict":"CONFIRMED","known":false,"summary":"Rest passes are split into half-cell pieces and never re-reduced: 24,173 moves (671 KB) vs 4,713 (131 KB) for the identical 1961.7 mm path; 6,640 vs 2,134 on a 12 mm relief"},
  {"id":"F6-P3-3","severity":"P2","area":"cnc-relief-3d","file":"src/core/relief/relief-rail-profile.ts","line":204,"anchor":"Contract: R07 (BUILD.md:32) and ADR-575 reject only folded/multi-valued strips; L7: relief-rail-authoring.test.ts:166-176 passes only at 16 steps","evidence":"REPRO; refuter REPRO zz-f6r-rail.test.ts: app curve refused w1-3 at 32 (only w1 passes at 16); r10 w4 arcs 7/9/16/31 seg refused at 16 and 32; r50 w6 8/12/20/24 seg refused; sine A5 L40 w6 refused at 32/64 (folds or collapses); re-rated P3->P2: ordinary valid rails refused with a misleading reason, R07 contract broken, fails safe","verdict":"CONFIRMED","known":false,"summary":"At the UI default samplingSteps 32, stations near a rail vertex take segment normals, so inner offsets cross and curved rails are refused as 'not single-valued' (app test's 4-point curve at widths 1-3, quarter arcs r10 w4 with 7-63 segments, Bezier 24 pts w4 / 48-100 pts w2); near-equal station parameters also refuse evenly spaced straight rails"},
  {"id":"K-1","severity":"P2","area":"cnc-relief-3d","file":"src/core/relief/heightmap-surface-contact.ts","line":1,"anchor":"ADR-412 Consequences + Amd 1 half-cell bound","evidence":"REPRO","verdict":"PENDING","known":"16 K-1 / 09-29 P2-relief-finish-1","summary":"Ball crease chord on depth maps: 0.078 (1/8in raster), 0.038 (raster+waterline), 0.134 (1/4in) mm normal"},
  {"id":"K-2","severity":"P2","area":"cnc-relief-3d","file":"src/core/cnc/compile-cnc-relief-finishing.ts","line":40,"anchor":"ADR-412 'finer grid is the remedy'","evidence":"REPRO","verdict":"PENDING","known":"16-P2-1","summary":"30 deg engraver (0.3 flat) cuts 0.058 mm normal into the boss's top corner"},
  {"id":"K-3","severity":"P2","area":"cnc-relief-3d","file":"src/core/relief/relief-finishing.ts","line":393,"anchor":"ADR-291 item 6","evidence":"REPRO","verdict":"PENDING","known":"16 K-3 / 09-29 P2-relief-finish-2","summary":"Engraver rows 1.27 mm apart leave the 0.5 mm roughing allowance on floors"},
  {"id":"K-4","severity":"P3","area":"cnc-relief-3d","file":"src/core/relief/relief-finishing-strategy.ts","line":76,"anchor":"ADR-421 Consequences","evidence":"REPRO","verdict":"PENDING","known":"ADR-421 Consequences; 2026-10-13 quality audit item 1","summary":"Raster scallop grows 1/cos^2 across rows on slopes (STL 42 deg: 0.061 vs 0.025)"}
]
```
