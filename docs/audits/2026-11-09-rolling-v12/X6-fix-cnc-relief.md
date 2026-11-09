# Rolling audit v12 — X6 Fix verification: CNC and relief

- **When:** 2026-11-09, 19:10–21:30 +0800   **Tree:** origin/main @ `8c6b04869`. Repros ran on the scratchpad export `j17-main` (`7c3c00971`, whose `src`, `electron` and `e2e` trees equal `8c6b04869`; the 9 cited source files hash-equal `8c6b04869`). Parent code for #1622's rest filter was taken from `743d37bc4^1` with `git show`.
- **Scope:** the four merged PRs below, on fresh projects on main. X2 owns the returning-user side of #1622; X4 already proved #1606/#1607 G-code-identical.
  - #1603 `9da8d1633` adaptive offset-ring fallback shown in Preview and Job Review before Save (S8-P2-1, ADR-154 Amd 5).
  - #1622 `743d37bc4` height maps carve their pixel-centre surface; 3D rest keeps one G1 per stretch (pro-loop v1 L6-P2-1 / L6-P3-1, ADR-580 Amd 2). Another agent's PR.
  - #1643 `bddf477a8` relief projection steps down and takes tabs; finishing steps down where roughing missed (W6-P2-1 (P1), W6-P2-2; ADR-572 Amd 3, ADR-421 Amd 2).
  - #1646 `b0507a547` the carving comparison reads the surface CAM carves (main's smoke fix after #1622).
- **Lenses run:**
  - **L10:** each fix on its own case and siblings: projection on closed, open, nested, small and curved shapes, multiple outputs, a depth that is not a multiple of the step, ball and end-mill bits; finishing step-down across and along the rows, partial reach, edge bands, V-bit and end-mill finishing, a fine Depth per pass; adaptive fallback on non-rectangles.
  - **L3:** the emitted G-code against an independent stock simulator of my own (`h.mts`: flat and ball cutters on a 0.05 mm grid, the whole program in order) for step-down, tab size and gouge; Job Review lines and advisories against that; my own pixel-centre surface (upper envelope of both triangulations) against the carving; old against new rest filter.
  - **L6:** threshold edges of the reach check, a finishing ball that cannot enter, rest finishing behind it, projections run before finishing or on a roughing-only relief, a relief not output.
  - **L4:** 1 × 1 and 2 × 1 pixel maps, odd sizes, non-square pixels, 1-pixel ridges and spikes.
  - **L12:** main's CI for each merge.
  - Not run: a browser (see Not verified). No hardware.
- **Counts:** 5 raised → refuter pending → P1 1 / P2 2 / P3 2 (+ 3 KNOWN touched: X2's #1622 notes gap, F6-P3-1 rest-prediction budget, X4's F2-P3-1).

## Headline

**Three of the four PRs hold. #1643's finishing step-down holds on every case it targets; its projection half holds once the relief is finished, but not for the tabs it adds or the stock a projection really meets.**

- **#1643 finishing (W6-P2-2):** in the audit's 8 mm channel no finishing move takes more than one Depth per pass under the ball's centre (0.50 mm after levels at −1.5/−3/−4.5), and the widest cross-section falls from 13.97 to 6.06 mm² (5.99 along the rows). The same holds at 4 mm deep (2 levels + 1.0), at 0.5 mm per pass (9 levels), at 5 mm wide, and with a V-bit or 1/16" end-mill finisher. Job Review's "not reaching about N mm² (finishing steps down K levels there)" matches the G-code.
  - **Not covered:** the rest-finishing stage behind it. Where the finishing ball cannot enter, a 1/16" rest ball slots a 2.4 mm channel 4.7 mm deep for 18 mm at F1000, with no step-down and no note (**X6-P2-2**). The reach threshold also lets finishing slot up to Depth per pass + allowance + one roughing cell where roughing never entered (2.2 mm at 1.5 mm per pass, 1.25 mm at 0.5; **X6-P3-1**, documented in the ADR).
- **#1643 projection (W6-P2-1):** after a finished relief every projection level removes at most Depth per pass (≤ 1.02 mm at 1 mm), on squares, an r 8 circle, nested squares, 2.5-on-1 depths, a ball bit and two projection layers. Tabs are 6.00 mm wide, as set.
  - **The tab height is not what Job Review says** (**X6-P1-1**). The tab top is one tab height above the stock bottom even when the relief floor under the loop is lower, so the tab is only the floor the relief left: 0.20 mm thick where Job Review says "6 × 2 mm above the stock bottom", 0.50 mm for "6 × 3 mm", 1.00 mm for "6 × 2 mm". The natural cut-out setup (Vertical depth just through the floor) always lands here.
  - **The levels step from the target surface, not the stock there** (**X6-P2-1**). On the shipped relief layer (roughing only, no finishing bit) a 1 mm / 0.5 mm-per-pass engraving takes up to 2.58 mm in its first pass over 63 mm, while Job Review says "2 passes of up to 0.5 mm". W6-P2-1's own auditor named this case; ADR-572 Amd 3 does not.
  - A small loop the tab windows swallow is raised whole into the air above the floor and cuts nothing, while Job Review and the spoilboard note say "deepest 7 mm … 1.00 mm past the bottom" (**X6-P3-2**).
- **#1603:** the fallback is disclosed in the compile sidecar, the Preview banner, the Job Review line and the Save/Start advisory, in the same words, on rectangles, an L, an ellipse and an annulus (its own reason). Accepted square, triangle and circle stay silent. "(full-width first pass)" is true: the 40 × 20 program plunges straight and cuts a full-width first ring.
- **#1622:** on odd-sized, non-square, 1 × 1 and 2 × 1 pixel maps the carving sits on my own pixel-centre surface within 0.016 mm (median skin 0.001–0.008 mm); 1-pixel ridges and spikes within 0.011/0.026 mm at a finer grid, inside the simulator's error and the disclosed G1-interpolant limit. The rest filter gives the same geometry as its parent on 2,000 random cases with 5.5 % of the G1 points.
- **#1646:** the comparison measures, not merely passes: 0 cells cut too deep on three reliefs as emitted, and 68–94 % flagged (0.301 mm) when I lower the finishing by 0.3 mm.
- **L12:** no main commit ran CI green on #1603 or #1646 alone. #1622's merge failed Browser smoke (the relief stock-compare spec) until `a468f7bea`, the first all-green commit with #1646. #1643's own CI was cancelled; `c94993aa4` (CI) and `7c3c00971`/`8c6b04869` (all three) passed with it.

## Matrix

"Holds" means reproduced on the emitted G-code by my simulator. "Fresh under the centre" is stock above the cutter tip at its centre line, from the stock the program has left at that moment.

| PR | Route / twin | Result |
|---|---|---|
| #1643 | finishing, 8 mm × 5 mm channel, 1/4" EM rough / 1/8" ball, across rows (W6's case) | holds: 3 levels, ≤ 0.50 mm fresh under the centre, 6.06 mm² (13.97 before) |
| #1643 | same along rows / 4 mm deep (non-multiple) / 0.5 mm per pass / 5 mm wide | holds: 5.99 mm² / 2 levels + 1.0 / 9 levels, 2.75 mm² / 3 levels |
| #1643 | V-bit 60° or 1/16" EM finishing in the 8 mm channel | holds: levels 1.5 each |
| #1643 | edge band: whole relief a 5 mm pocket; ramp down to the edge | holds: the ball meets 0.5 mm at its centre and a 0.4 mm wall strip; 4.5 mm only at inside corners (the documented sliver) |
| #1643 | 2.7 mm deep channel (under the threshold), 1.5 and 0.5 mm per pass | **X6-P3-1** (2.2 / 1.8 / 1.25 mm full-width, no levels, no note) |
| #1643 | **rest finishing** behind a ball that cannot enter (2.4 mm channel) | **X6-P2-2** (1/16" ball 4.7 mm deep, 18.3 mm at F1000) |
| #1643 | projection after a finished relief: closed 16 mm square, 2.5 on 1, nested 24 + 10, r 8 circle, ball bit, two projection layers | holds: ≤ 1.02 mm per level (1.09 at nested corners, grid), tabs 6.00–6.30 mm long, Job Review counts match |
| #1643 | projection tab **height** on a set stock: floor 5 / 5.5 / 5.8 in 6 mm | **X6-P1-1** (1.00 / 0.50 / 0.20 mm against "2 / 3 / 2 mm above the stock bottom") |
| #1643 | projection on a roughing-only relief; engrave run before finishing (default bit order); relief not output | **X6-P2-1** (2.58 / 1.00 / 5.50 mm first pass at 0.5 per pass) |
| #1643 | small loop (r 3) all one bridge | **X6-P3-2** (nothing cut; Job Review "deepest 7 mm", spoilboard note) |
| #1643 | stale Cut depth 8 on 5.3 mm stock; projection 1.05 mm past the bottom | holds: no false spoilboard note; the real one names 7.4 mm |
| #1603 | 40 × 20, L, ellipse 40 × 30 (engagement refusal); annulus (island refusal) | disclosed on all four routes, same words; annulus keeps its reason |
| #1603 | square 40, triangle, circle 40, square with island | accepted, no notice (island gets its existing advisory) |
| #1603 | Start / phone review | Start's list includes the emit advisory (`start-job-readiness.ts:376-377`); the phone projects it or the "Review this … on the PC" fallback (READ) |
| #1622 | pixel-centre surface: 37 × 23 odd, 100 × 50 non-square, 1 × 1, 2 × 1, 1-px ridge, 1-px spike + rest | gouge ≤ 0.016 / 0.014 / 0 / 0.006 / 0.011 / 0.026 mm (simulator error ~0.025) |
| #1622 | rest one-G1-per-stretch vs parent | 2,000 / 2,000 random cases same geometry, 40,289 vs 733,541 points |
| #1646 | carving comparison: dome, steps, ramp 33 × 17, rotated 30° | as emitted 0 gouged; finishing −0.3 mm gives 68–94 % gouged |

## Findings

### X6-P1-1 — A projected loop's tabs are only as thick as the relief floor under them; Job Review says the set tab height

- **Where (8c6b04869):**
  - `src/core/cnc/compile-cnc-relief-projection.ts:141-149` (`tabTopZ`): on a set stock the tab top is `-stockMm + stockLimitedTabHeightMm(…)`, whatever the relief surface under the loop.
  - `src/core/relief/relief-projection-plan.ts:203-214` (`projectedLadder`) and `src/core/relief/relief-projection-tabs.ts:119-121` (`raised`): inside a window a point is lifted to the tab top only if below it. Where the relief has already carved below the tab top, the window rides in air.
  - `src/ui/laser/job-review/job-review-projection-detail.ts:78-88`: "tabs N per shape (W × H mm above the stock bottom)" from the settings, counted as tabbed whenever a window rose (`relief-projection-tabs.ts:123-144`).
  - `src/ui/laser/cnc-projection-stock-warnings.ts:26-53`: "cut free" is judged only when the whole last level is below the stock bottom (`relief-projection-plan.ts:217-218`), so it never fires once a window exists.
- **Anchor:**
  - **Contract:** ADR-572 Amendment 3 Decision 2 (`docs/decisions/ADR-572-amendment-3-…md:35-41`): a loop that can free the part "is raised to the tab top … a 3D tab", "one tab height above the stock bottom on a set stock thickness". Decision 4: Job Review names "the tabs really cut". Consequences (`:63-64`) note only that a window above the surface "costs only Z travel", not that the tab is then thinner.
  - **Precedent:** W6-P2-1 was raised to P1 for a projected part cut free with Tabs on while Job Review listed tabs (CNC v1 F3-P1-1).
  - **Lens:** L3 (Job Review against the emitted G-code and the stock it leaves).
- **Scenario:** a maker carves a plaque whose background floor sits 5.5 mm into 6 mm plywood, then cuts the plaque out with a projected profile along the floor, Vertical depth 1 mm, Tabs on (4 × 6 mm, height 3 mm), Stock thickness set to 6.
  - Job Review: "projected 1 mm under the relief surface in 1 pass, deepest 6.5 mm · tabs 4 per shape (6 × 3 mm above the stock bottom) on 1 of 1 closed shape".
  - The G-code raises four windows to Z−3, 2.5 mm above the floor, in air. What holds the plaque is the 0.5 mm of floor under each window.
  - The only advisory is the spoilboard note ("0.50 mm past the bottom"). Nothing mentions the tabs.
  - Any Vertical depth chosen to go just through the floor gives a tab no thicker than the floor left, which is less than the Vertical depth.
- **Evidence:** REPRO, `zz-x6\proj.mts` → `proj.out.txt`, `proj-P15.out.txt`. The whole program (relief roughing 1/8" EM + finishing 1/8" ball + projection 1/8" EM) is simulated; then the stock is read along the loop's centre line, and runs above the stock bottom are the bridges that hold.

  | Case (16 mm square on a dish floor) | Job Review tab text | Bridges in the stock after the program |
  |---|---|---|
  | P1: floor 5 in 6.0, Vd 2, 1 per pass | "6 × 2 mm above the stock bottom" | 4 × 6.00 mm long, **1.00 mm** thick |
  | P14: floor 5.5 in 6.0, Vd 1, tab 3 mm | "6 × 3 mm above the stock bottom" | 4 × 6.00 mm, **0.50 mm** |
  | P13: floor 5.8 in 6.0, Vd 0.5 | "6 × 2 mm above the stock bottom" | 4 × 6.00 mm, **0.20 mm** |
  | P1b: floor 5 in 6.35 (shipped default) | "6 × 2 mm above the cut floor" | 4 × 6.00 mm, 1.35 mm |
  | P15 (2D twin, no projection): profile-on-path 6.5 deep, floor 5.5 in 6.0, tab 3 | "tabs 4 per shape (6 × 3 mm) above the stock bottom"; warning "Its holding tabs stay 3 mm thick above the stock bottom" | 4 × 6.00 mm, **0.50 mm** |

- **Severity: P1.**
  - **For P1:** the output is physically wrong against what the operator set and what Job Review states: tabs of 0.2–0.5 mm where 2–3 mm were set and are shown. A 0.2 mm tab does not hold a part against the cutter, so the part comes free beside a running spindle, with Tabs on and no warning: W6-P2-1's P1 harm (CNC v1 F3-P1-1). A Preview that shows the windows in air is a visible result, not a warning (METHOD §3).
  - **Against (P2):** a tab exists; at 1 mm in plywood a small part may well hold, and the spoilboard note does appear. The thinnest cases need a relief floor within a tab height of the stock bottom. The refuter should weigh whether only the P13/P14 range is P1.
- **Announced?** No. ADR-572 Amd 3 Consequences mention windows above the surface only as Z travel. Job Review states the set height.
- **Novelty:** new for projections, whose tabs #1643 introduced. The same root exists in the 2D profile (P15: same 0.50 mm tab, and its warning says "stay 3 mm thick"), older than #1643 (ADR-258 Amd 3). `git grep` over `docs/audits` finds no tab thinned by an earlier relief or pocket.
- **Fix direction:**
  - The projection knows the relief surface under each window: measure the tab from the material there, and refuse or warn ("tabs only N mm thick: the relief floor is N mm above the stock bottom") when the floor is thinner than the tab height.
  - Job Review should report the thickness the tab really has, and the cut-free check should count a window whose tab top is above the surface as no tab.
  - The 2D through-cut warning has the same false "stay 3 mm thick" wording when an earlier relief or pocket lowered the floor.
- **Refuter:** PENDING.

### X6-P2-1 — A projection steps down from the relief's target surface, not from the stock that is there: on a roughing-only relief, or run before finishing, its first pass takes the roughing allowance and terrace too, while Job Review says "passes of up to" Depth per pass

- **Where (8c6b04869):**
  - `src/core/relief/relief-projection-plan.ts:207-209`: each level is the deepest checked path lifted by `finalDepth - depth`, so level 1 sits one Depth per pass under the **target** surface.
  - `src/ui/laser/job-review/job-review-projection-detail.ts:58-65`: "in N passes of up to D mm".
  - `src/ui/laser/cnc-relief-projection-order-warnings.ts:34`: the order warning fires only when relief machining of the target runs **later**; a roughing-only relief has none.
  - The shipped layer has no finishing bit: `reliefFinishToolId` is optional (`src/core/scene/machine.ts:117`) and absent from `DEFAULT_CNC_LAYER_SETTINGS`.
- **Anchor:**
  - **Original finding:** W6-P2-1's auditor wrote "with the surface prepared by roughing only, the projected cut sits up to Vertical depth + 0.5 mm allowance + one roughing step below the stock that is actually there" (`docs/audits/2026-11-08-rolling-v11/W6-relief-generators.md`, "One-pass load"). The fix steps the Vertical depth only.
  - **Contract:** ADR-572 Amd 3 Decision 1 ("A projection cuts its Vertical depth in levels … shallow to deep") and Decision 4's Job Review line "in 2 passes of up to 1 mm".
  - **Twin:** relief roughing steps from the stock top (ADR-368 Amd 2 item 4, "Each level removes at most one").
  - **Lens:** L10, L3.
- **Scenario:** a maker imports a relief, keeps its layer as created (roughing only, 1/8" EM, 1.5 mm per pass), and engraves a name onto it with a projected engrave at 1 mm, 0.5 mm per pass.
  - Job Review reads "projected 1 mm under the relief surface in 2 passes of up to 0.5 mm".
  - The relief is roughed to its 0.5 mm allowance with terraces up to 1.5 mm, so the first projection pass takes up to 2.58 mm.
  - The same happens by default with a finishing bit, when the engrave uses the roughing bit: bit grouping runs it between roughing and finishing (`relief-rough > proj:engrave > relief-finish`). That case gets the order warning.
- **Evidence:** REPRO, `zz-x6\proj.mts` → `proj.out.txt`. Largest stock removed from any cell by one projection move, simulated over the whole program:

  | Case (Vd / per pass) | Section order | Job Review | Removed in one move | Travel over Depth per pass | Specific warning |
  |---|---|---|---|---|---|
  | P1–P4, P11–P14: relief finished first | rough > finish > proj | "passes of up to 1 mm" | ≤ 1.02 mm | 0 | — |
  | **P9: roughing-only relief** (1 / 0.5) | rough > proj | "2 passes of up to 0.5 mm" | **2.58 mm** | 63.4 mm | none (only the standing projection note) |
  | P8: engrave listed above the relief (1 / 0.5) | rough > proj > finish | the same | 1.00 mm | 63.6 mm | the order warning |
  | P6: open line on a ramp (3 / 1) | rough > proj > finish | "3 passes of up to 1 mm" | 5.55 mm (near the relief edge) | 36.0 mm | the order warning |
  | P10: relief not output (1 / 0.5) | proj only | "2 passes of up to 0.5 mm" | 5.50 mm (plunge) | 63.4 mm | none |

- **Severity: P2.**
  - **For P2:** the harm is cutter load. One pass of 2.6 mm with a 1/8" bit is 5× the Depth per pass the operator set and 1.6× the app's own 0.5 × D guide (`src/core/cnc/feeds-calculator.ts:55-61`). That is the class of the open-line half of W6-P2-1 and of CNC v1 F3-P2-1, both kept at P2 (meta v1 M6). Job Review's "passes of up to 0.5 mm" is a misleading result.
  - **Against (P3):** every projection job carries the standing note "Prepare the named surface before this operation; projection does not verify actual remaining stock" (`cnc-relief-planning-warnings.ts:148`), and the before-finishing order has its own warning. P10 may be intended (the relief carved in an earlier job). No depth or position is wrong.
- **Announced?** Partly: the standing note says remaining stock is not verified. ADR-572 Amd 3 does not mention the roughing-only case its source finding named.
- **Novelty:** named in W6-P2-1's evidence (a READ, not measured), not fixed or announced by #1643. No open PR touches `relief-projection-plan.ts`.
- **Fix direction:**
  - Step the projection from the stock the job leaves before it. The compile already sweeps roughing (`relief-roughing-reach.ts`) and finishing (`relief-residual-stock.ts`) stock, so add its own top level(s) from that stock, as ADR-421 Amd 2 does for finishing.
  - Or say it in Job Review: "first pass up to N mm: the relief is only roughed".
- **Refuter:** PENDING.

### X6-P2-2 — Rest finishing has no step-down: where the finishing ball cannot enter, the smaller rest ball slots the whole depth at full feed, with no note

- **Where (8c6b04869):**
  - `src/core/cnc/compile-cnc-relief-rest.ts:43-92` (`compileReliefRestGroup`): the rest passes go out as predicted, with no `finishingStepDown`. Only finishing calls it (`compile-cnc-relief-finishing.ts:147-156`).
  - `src/core/relief/relief-roughing-reach.ts:71-78`: the reach check flags nothing in a channel narrower than about 2 × (allowance + one roughing cell), 2.6 mm with a 1/4" bit. There the envelope (`:204-223`) is the wall top on both sides, so no note is raised either.
- **Anchor:**
  - **Contract:** ADR-421 Amendment 2 Decision 2: "Where roughing missed stock, the finishing bit first cuts it in levels of the finishing stage's depth per pass". Its scope is roughing → finishing. The same reasoning ("the smaller tool is the finishing bit, which is already on the layer", Context) applies to finishing → rest, and the amendment does not mention rest.
  - **Twin:** the finishing stage now steps down where its predecessor missed stock; the rest stage does not.
  - **Precedent:** W6-P2-2 (P2), a 1/8" ball slotting 5 mm.
- **Scenario:** a relief with a narrow groove (2.4 mm), roughed with a 1/4" EM, finished with a 1/8" ball and rest-finished with a 1/16" ball (the relief stages the layer offers).
  - Neither the roughing bit nor the 1/8" ball enters the groove.
  - The 1/16" rest ball then cuts the whole 5 mm.
  - Job Review says "no relief roughing levels". The rest note says only that remaining stock is a conservative estimate.
- **Evidence:** REPRO, `zz-x6\rest.mts` → `rest.out.txt` (groove across the rows) and `rest-x.out.txt` (along them). 20 × 20 mm relief, 0.05 mm pixels, 1.5 mm per pass:

  | Groove 2.4 × 5 mm | 1/8" ball finishing | 1/16" ball rest | Reach note / step-down |
  |---|---|---|---|
  | across the rows | 0.15 mm², touches 0.16 mm | each row descends 4.2 mm at F300, then a 0.69 mm full-width slot at Z−5 F1000 (7.10 mm²) | none / none |
  | along the rows | 0.33 mm² | **18.3 mm at Z−5, F1000, 4.71 mm fresh under the centre, 7.15 mm²** (full width × 4.5 mm) | none / none |

- **Severity: P2.**
  - **For P2:** the same harm as W6-P2-2 (P2), worse in ratio: 3.0 × D axial at full width for a 1/16" ball (W6-P2-2 was 1.6 × D for a 1/8"). This is the usual way to snap a small ball, and the plan looks complete.
  - **Not P1:** no gouge and no wrong depth, so it is cutter load (meta v1 M6, CNC v1 F3-P2-1).
  - **Against:** rest finishing is opt-in (a third bit), and the groove is narrower than the finishing ball.
- **Announced?** No. ADR-421 Amd 2's Consequences say rest "sees the stock they removed", not that rest itself steps down.
- **Novelty:** new. W6-P2-2 and its refuter cover roughing → finishing only. `git grep` over `docs/audits` and pro-loop v1–v3 finds no rest-finishing load finding. #1643 does not touch `compile-cnc-relief-rest.ts`, so this is a sibling route the fix left out, as old as rest finishing.
- **Fix direction:**
  - Run `finishingStepDown` for the rest stage with the residual stock `relief-residual-stock.ts` already predicts (finishing's swept stock) and the rest stage's Depth per pass.
  - Name in Job Review the area the finishing bit could not enter and how many levels the rest bit takes there.
- **Refuter:** PENDING.

### X6-P3-1 — Below the reach threshold, finishing still slots a channel roughing never entered, up to Depth per pass + allowance + one roughing cell, with no level and no note

- **Where (8c6b04869):** `src/core/relief/relief-roughing-reach.ts:71-78`. The threshold is `depthPerPassMm + allowanceMm + mmPerCell`, with the cell at 1/8 of the roughing bit (0.79 mm for 1/4"), and `relief-finishing-step-down.ts:40` makes nothing below it.
- **Anchor:** ADR-421 Amd 2 Decision 1 (`docs/decisions/ADR-421-amendment-2-…md:30-34`) states this threshold, so it is decided. Its Consequences, however, set "the 6.35 mm² a 1/8" bit meets after a roughing that reached" as the yardstick, and the 2D twin ADR-140 Amd 2 steps down from half the bit in stock.
- **Scenario:** an 8 mm channel 2.7 mm deep, 1/4" EM roughing (cannot enter: too narrow for the bit plus allowance and clearance), 1/8" ball finishing at the default 1.5 mm per pass.
- **Evidence:** REPRO, `zz-x6\fin.mts` → `fin.out.txt`, `fin-E.out.txt`, `edge.mts`:

  | Channel | Per pass | Fresh under the ball's centre | Length | Cross-section | Levels / note |
  |---|---|---|---|---|---|
  | 2.7 mm, across rows | 1.5 | 2.18 mm (2.09–2.70 across the ball) | 4.5 mm, F1000 | 6.44 mm² | none / none |
  | 2.7 mm, along rows | 1.5 | 1.81 mm | 26.4 mm, F1000 | 5.43 mm² | none / none |
  | 1.75 mm, across rows | 0.5 | 1.25 mm (2.5 × the setting) | 9.8 mm | 3.44 mm² | none / none |

- **Severity: P3.** The ADR decides the threshold; the slot is shallower than one finishing ball's diameter. What is wrong is that at a fine Depth per pass the slack (allowance + cell = 1.29 mm) dominates, and the full-width slot is unannounced while a terrace of the same height after a complete roughing is only partial width.
- **Announced?** Yes in the ADR's Decision 1; no in Job Review.
- **Novelty:** new (introduced with #1643's threshold).
- **Fix direction:** measure missed stock against the Depth per pass alone where the roughing bit swept nothing, keeping the allowance slack only beside roughed terraces. Or step down whenever the finishing ball would have half its width in stock deeper than a pass (ADR-140 Amd 2's rule).
- **Refuter:** PENDING.

### X6-P3-2 — A small projected loop raised whole to its tab top cuts nothing, while Job Review and the spoilboard note report it reaching 7 mm into the stock

- **Where (8c6b04869):**
  - `src/core/relief/relief-projection-tabs.ts:44-47`: windows that cover the loop raise all of it to the tab top.
  - `src/core/relief/relief-projection-plan.ts:204`: `deepestZ = extremeZ(safe, 'min')` is taken before the tabs. It feeds `facts.deepestMm` (`:131`), Job Review (`job-review-projection-detail.ts:63-65`) and the spoilboard note (`cnc-projection-stock-warnings.ts:38-42`).
- **Anchor:** ADR-572 Amd 3 Decision 3, "the deepest tip"; Decision 4, the line reads the evidence. Twin: the evidence against the emitted levels.
- **Scenario:** a 6 mm circle projected 2 mm under a relief floor 5 mm deep in 6 mm stock, Tabs on (4 × 6 mm). Four windows of 9.2 mm cover its 18.8 mm, so the loop rises to the tab top at Z−4, 1 mm above the floor.
  - Nothing is cut (largest removal 0.00 mm). The 3D preview shows that.
  - Job Review: "projected 2 mm under the relief surface in 2 passes of up to 1 mm, deepest 7 mm · tabs 4 per shape … on 1 of 1 closed shape".
  - Warning: "reaches 7 mm into 6 mm stock — 1.00 mm past the bottom, into the spoilboard".
- **Evidence:** REPRO, `zz-x6\proj.mts` case P5 → `proj.out.txt` (both levels at Z−4.000; loop "never cut through", 1.00 mm left).
- **Severity: P3.** Harmless in direction (less is cut than stated), and Preview shows it. But the twin is false twice, and the operator who wanted the part cut out gets no cut and no notice. The 2D splitter cuts such a loop down to its tab top; here that is in air, the X6-P1-1 root.
- **Announced?** No.
- **Novelty:** new (#1643).
- **Fix direction:** take `deepestMm` from the emitted last level. When the windows swallow a loop, say "too small for its tabs: left uncut" (or cut it to the floor and keep one tab).
- **Refuter:** PENDING.

## Refuted

Candidates I dropped:

- **"#1622's one G1 per stretch skips or adds rest material."** Old (`743d37bc4^1`) and new filters on 2,000 random passes, maps, selections and radii: every new point is an old point, and every old point lies on the new segment covering it, in order. Pass count is equal and points fall to 5.5 % (`rest1622.mts`).
- **"#1646 makes the comparison pass by moving the target."** With finishing lowered 0.3 mm the same pipeline reports 67.6–93.9 % of cells gouged at 0.301 mm, and as emitted 0 (dome, steps, ramp; turned 30°) (`cmp1646.mts`). The design and CAM now read the same surface, as ADR-580 Amd 2 decides. Masked and over-budget maps fall back to the old cells in both (`heightfield-to-heightmap.ts` `withExactSurface`).
- **"Finishing step-down levels cut deeper than the finishing row."** Never: each level is the row held up (`relief-finishing-step-down.ts:51-54`). In the sim, no move takes more than one Depth per pass under its centre in A, B, C, F, K, M and N.
- **"The edge band of a relief whose floor meets its edge is still slotted."** In the full 5 mm pocket the first row's ball meets 0.50 mm at its centre and 4.5–4.8 mm only in its outer 0.4 mm (a wall strip). 4.5 mm under the centre occurs only at inside corners for ≤ 6.8 mm, the sliver ADR-421 Amd 2 drops on purpose (`edge.mts`, `worst.out.txt`).
- **"The adaptive notice's cause ('Pockets longer than they are wide') is false for other shapes."** The engagement refusal fired on 40 × 20, the L and a 40 × 30 ellipse, all longer than wide. The annulus got its own reason ("An island could not be opened …"). Square, triangle and circle were accepted (`ad.mts`).
- **"A 1-pixel spike is gouged after #1622."** 0.045 mm at a 0.05 grid fell to 0.026 mm at 0.025 / 0.005 mm. It sits on an 87° flank, inside the simulator's error and the standing "G1 interpolants … not a continuous swept-volume proof" note.

## Verified clean

- **#1643 finishing step-down:** see Matrix. Job Review's operation line and the reach note match the G-code's levels (3, 2, 9) and say which bit cuts them. Cross-sections are 5.99–6.15 mm², under the ADR's 6.35, against 13.97 before.
- **#1643 projection after a finished relief:**
  - Levels at Depth per pass to the Vertical depth (2.5 on 1 gives −1/−2/−2.5 below the surface).
  - G-code header `depthPerPassMm` matches.
  - Tabs: 4 bridges 6.00 mm on squares (inner and outer of a nested pair), 6.25–6.30 mm on an r 8 circle, and 6.2 mm tapered with a ball.
  - Two projection layers get separate lines.
  - The spoilboard note uses the compiled depth, and a stale Cut depth of 8 no longer warns (`stale.mts`).
  - The layer card hides Cut depth for a projected layer (`CncLayerFields.tsx:294`, READ).
- **#1603:**
  - Every route that can fall back discloses it in the same words: compile sidecar → Preview banner (`preview-cnc-fallbacks.ts`), the Job Review line ("offset rings (adaptive fell back)"), and the emit advisory on Save and Start.
  - Start's warning list includes the emit split (`start-job-readiness.ts:376-377`, READ). The phone review carries Start's warnings, worded or replaced by the "Review this artwork-specific warning in KerfDesk on the PC" fallback when a private label appears (`review-message-sharing.ts`, READ).
  - The shape, tool and reason are right for the 40 × 20 case: straight plunge `G1 Z-1.500 F150` and a full-width first ring.
- **#1622:** the pixel-centre surface on odd, non-square, 1 × 1 and 2 × 1 maps (Matrix); skin median 0.001–0.008 mm, p95 ≤ 0.04 mm on smooth maps.
- **#1646:** the comparison measures (Refuted). The test's new assertion (0 gouged at 0.1 mm) and its lowered gouge bound (0.35 mm, from the analytic 0.43 mm) are justified in the test's own comments.
- **Local Vitest** (`zz-x6\vt-focused.txt`, `vt-rerun.txt`): 17 files for the four PRs in `j17-main`, one worker, `--no-experimental-webstorage`, launched at 2.5 GB free.
  - 104 of 108 tests passed. The 4 others timed out on this PC: transform took 154 s and import 293 s from the temp tree.
  - Rerun at 2.1 GB free with a 180 s timeout: `stock-design-compare` passed 3/3.
  - `browser-free-relief-build` has a 30 s budget inside the test and took 33 s. CI passed it on `7c3c00971` and `8c6b04869`.

### CI on the merged results (L12)

Main's push runs per merge commit (`gh api …/actions/runs?head_sha=`).

| PR | Merge commit | CI / Browser smoke / Desktop package on the merge | First later main commit where each passed |
|---|---|---|---|
| #1603 | `9da8d1633` (11-06) | failure / failure / failure (billing lock; nothing ran) | `82458c902` (#1612, 11-08): all three (X3) |
| #1622 | `743d37bc4` | success / **failure** (`gcode-viewer-stock.e2e.ts:421`, the relief stock compare) / success | Browser smoke: `a468f7bea` |
| #1646 | `b0507a547` | cancelled ×3 | `a468f7bea`: all three, the first green Browser smoke since #1622 |
| #1643 | `bddf477a8` | **cancelled** / success / success | CI: `c94993aa4` (#1650). All three: `7c3c00971`, `8c6b04869` |

- `59d66bb86` (between them) failed CI on `electron/native-smoke.test.ts`, which is not in these PRs, and the Desktop package on the Linux build.
- `870764802` (docs) was running Browser smoke at 19:30.

## Not verified

- **Browser:** no rendered Preview banner, Job Review card or 3D view. The rows were read from the functions that build them (`previewCncFallbacksOf`, `cncOperationDetail` as `JobReviewOperations.tsx:175-184` calls it, `detectMachineJobWarnings`). The memory gate allowed a browser only briefly, and Node covered every claim.
- **Physical:** no cut was made. "Comes free" (X6-P1-1) is inferred from 0.2–0.5 mm bridges, and the load (X6-P2-1, X6-P2-2) from the simulator's cross-section and axial depth, not force.
- **STL reliefs, masked height maps, and maps over 1024 × 1024 pixels:** not run for #1643 or #1622. The ADR keeps the old cells for the last two.
- **Job Review time against the G-code:** not compared.
- **The P6/P7 removals near the relief edge** (5.55 mm over 36 mm; 5.03 mm over 0.9 mm): seen but not localised. They sit where vectors run within a bit radius of the relief's boundary. P6 is covered by the order warning.
- **Phone/MCP Start:** READ only (no simulated remote session).
- **Hardware:** none, by instruction.

## Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-x6\`. Run each with `node --import ./register.mjs <file>`. Nothing in the repo was touched except this report.

| File | What it does |
|---|---|
| `register.mjs`, `ts-resolve.mjs` | Node TS loader (from W6/W4), pointed at `j17-main` |
| `h.mts` | scene builders and my stock simulator of emitted G-code (cross-section, fresh stock under the centre, per-cell removal, gouge against a surface) |
| `fin.mts` → `fin.out.txt`, `fin-A.out.txt`, `fin-E.out.txt`; `worst.mts` → `worst.out.txt`; `edge.mts` | #1643 finishing step-down cases; locating moves over Depth per pass; stock profile under one move |
| `rest.mts` → `rest.out.txt`, `rest-x.out.txt`; `dumprest.mts` | X6-P2-2 rest finishing |
| `proj.mts` → `proj.out.txt`, `proj-P1.out.txt`, `proj-P15.out.txt` | #1643 projection P1–P15: levels, per-move removal, bridges, Job Review, warnings (X6-P1-1, X6-P2-1, X6-P3-2) |
| `stale.mts` → `stale.out.txt` | stale Cut depth and spoilboard note |
| `ad.mts` → `ad.out.txt` | #1603 routes on eight shapes |
| `g1622.mts` → `g1622.out.txt`, `g1622-fine.out.txt` | #1622 pixel-centre surface (my own) against the carving |
| `rest1622.mts` → `rest1622.out.txt`, `old\relief-rest-passes.ts` | #1622 rest filter, parent vs main |
| `cmp1646.mts` → `cmp1646.out.txt` | #1646 comparison with a Z-shift negative control |
| `vt-focused.txt`, `vt-rerun.txt` | focused Vitest output |

```json
{
  "area": "X6",
  "id": "fix-cnc-relief",
  "tree": "8c6b04869",
  "raised": 5,
  "findings": [
    {"id": "X6-P1-1", "severity": "P1", "area": "X6", "file": "src/core/cnc/compile-cnc-relief-projection.ts", "line": 141, "anchor": "Contract ADR-572 Amd 3 D2/D4 (3D tab, 'the tabs really cut'); precedent W6-P2-1 P1 / CNC v1 F3-P1-1; twin Job Review vs emitted stock", "evidence": "REPRO (zz-x6/proj.mts: bridges 1.00/0.50/0.20 mm vs Job Review '6 x 2/3/2 mm above the stock bottom'; 2D twin P15 same 0.50 mm)", "verdict": "PENDING", "known": false, "summary": "Projected tab top is one tab height above the stock bottom regardless of the relief floor; where the floor is lower the window rides in air and the tab is only the floor left (0.2-1.0 mm), while Job Review states the set height and no note fires"},
    {"id": "X6-P2-1", "severity": "P2", "area": "X6", "file": "src/core/relief/relief-projection-plan.ts", "line": 207, "anchor": "Original W6-P2-1 'one-pass load' note; ADR-572 Amd 3 D1/D4; twin relief roughing steps from stock", "evidence": "REPRO (zz-x6/proj.mts P8/P9/P10: first-pass removal 1.00/2.58/5.50 mm at 0.5 mm per pass; Job Review 'passes of up to 0.5 mm')", "verdict": "PENDING", "known": "named in W6-P2-1 evidence, not fixed", "summary": "Projection levels are measured from the target surface, so on the shipped roughing-only relief (or before finishing) the first pass takes allowance + terrace + a pass"},
    {"id": "X6-P2-2", "severity": "P2", "area": "X6", "file": "src/core/cnc/compile-cnc-relief-rest.ts", "line": 43, "anchor": "ADR-421 Amd 2 D2 (roughing->finishing only); twin finishing step-down; precedent W6-P2-2 P2", "evidence": "REPRO (zz-x6/rest.mts: 1/16in rest ball 18.3 mm at Z-5 F1000, 4.71 mm fresh under the centre, 7.15 mm^2; no reach note)", "verdict": "PENDING", "known": false, "summary": "Rest finishing has no step-down: where the finishing ball cannot enter a narrow groove the rest ball slots its whole depth at full feed, with no note"},
    {"id": "X6-P3-1", "severity": "P3", "area": "X6", "file": "src/core/relief/relief-roughing-reach.ts", "line": 71, "anchor": "ADR-421 Amd 2 D1 threshold vs its 6.35 mm^2 yardstick; ADR-140 Amd 2 twin", "evidence": "REPRO (zz-x6/fin.mts E/E2/E3: 2.18/1.81/1.25 mm full-width slots, no levels, no note)", "verdict": "PENDING", "known": false, "summary": "Below dpp + allowance + one roughing cell, finishing still slots a channel roughing never entered, unannounced in Job Review"},
    {"id": "X6-P3-2", "severity": "P3", "area": "X6", "file": "src/core/relief/relief-projection-plan.ts", "line": 204, "anchor": "ADR-572 Amd 3 D3/D4; twin evidence vs emitted levels", "evidence": "REPRO (zz-x6/proj.mts P5: both levels at Z-4 in air, nothing cut; Job Review 'deepest 7 mm', spoilboard note 1.00 mm past the bottom)", "verdict": "PENDING", "known": false, "summary": "A small loop raised whole to its tab top cuts nothing while Job Review and the spoilboard note report a 7 mm cut"}
  ]
}
```

## Refuter (2026-11-09)

- **Refuter:** a fresh session that did not see the auditor's reasoning.
- **Tree:** origin/main @ `8c6b04869`. Repros ran with Node against `j17-main` (`7c3c00971`; `git diff --stat 7c3c00971 8c6b04869 -- src` is empty).
- **Oracle:** my own stock simulator, `zz-x6r\x.mts`. It does not reuse `h.mts`.
  - For every feed or rapid move and every 0.05 mm (or 0.025 mm) cell, it solves the cutter bottom exactly.
  - The t-interval where the cell lies under the tool disc comes from the quadratic |p − xy(t)|² ≤ R².
  - A flat end mill takes the lower interval end. A ball takes the minimum of the convex z(t) + R − √(R² − d(t)²), by golden-section search.
  - It throws if any G2/G3 appears.
  - Bridges are read along the loop after the whole program (relief roughing, finishing, then the cut-out).
- **Runs:** no Vitest, no browser, no hardware. Free memory was 2.3–3.0 GB at each run.

### Verdicts

#### X6-P1-1 — CONFIRMED mechanism; RE-RATED P1 → P2

**Reproduced** (`tabs.mts` → `tabs.out.txt`). The plaque is closer to the scenario than a dish: a 50 mm relief with a raised disc (r 12) and a 3 mm frame at full height. The background floor F lies between them. A projected profile-on-path circle r 16 runs in the floor ring, with a 1/8" EM and Tabs on.

| Case | Bridges after the whole program | Part rim beside the kerf | Job Review | Advisory |
|---|---|---|---|---|
| T0 control: F 4 in 6, Vd 2.5, tab 2 | 4 × 6.15 mm × **2.00** | 2.00 | "6 × 2 mm above the stock bottom" | spoilboard 0.50 |
| T1: F 5 in 6, Vd 2, tab 2 (default) | 4 × 6.15 × **1.00–1.02** | 1.00 | "6 × 2 mm above the stock bottom" | spoilboard 1.00 |
| T2: F 5.5 in 6, Vd 1, tab 3 | 4 × 6.15 × **0.50–0.52** | 0.50 | "6 × 3 mm above the stock bottom" | spoilboard 0.50 |
| T3: F 5.8 in 6, Vd 0.5 | 4 × 6.15 × **0.20–0.22** | 0.20 | "6 × 2 mm …" | spoilboard 0.30 |
| T4: F 5.95 in 6, Vd 0.5 (new) | 4 × 6.15 × **0.05–0.07** | 0.05 | "6 × 2 mm …" | spoilboard 0.45 only |
| T5: F 6.0 in 6 (new) | none (residue ≤ 0.02 mm); the part is free | 0.00 | "tabs 4 per shape … on 1 of 1" | spoilboard, plus the relief note "reaches the configured stock bottom … Relief paths have no holding tabs; … confirm workholding" |
| T6: F 5 in 6.35 (shipped) | 4 × 6.15 × 1.35 | 1.35 | "6 × 2 mm above the cut floor" | spoilboard 0.65 |
| T7, the 2D twin: Cut depth 6.5, F 5.5 in 6, tab 3 | 4 × 6.15 × 0.50 | 0.50 | "tabs 4 per shape (6 × 3 mm) above the stock bottom" | "Its holding tabs stay 3 mm thick above the stock bottom" (false) |
| T8: Tabs off, F 5.5 | none | 0.50 | "no holding tab on 1 closed shape cut free" | the loud cut-free note |

- Every tab window rides in air at the tab top (Z−3 / Z−4), as `compile-cnc-relief-projection.ts:141-149` and `relief-projection-tabs.ts:119-121` say.
- A further sliding-scale case: with a nested 40 mm square on a cone (`chal.mts` K2), the windows land where the surface is 2.4 mm deep in 4 mm stock, so the tabs are 1.6 mm where the set height is 2 mm.

**No warning is specific.**
- Before Start, the operator sees only the spoilboard note (`cnc-projection-stock-warnings.ts:38-43`). It never mentions tabs.
- The cut-free note cannot fire once a window exists (`relief-projection-plan.ts:217-218`).
- The relief note fires only when the emitted relief depth equals the stock exactly (`cnc-compiled-depth-warnings.ts:120`), so T4 (a 0.05 mm floor) gets no note at all.
- Preview showing windows in air is not a warning (METHOD §3).

**Answer to "is a 0.2–1 mm bridge likely to break?"**
- 1.0 mm × 6 mm bridges (T1, the default tab on a 5 mm floor in 6 mm stock) normally hold a small part.
- 0.5 mm is marginal. At 0.2 mm and below (T3, T4) the bridge is about as thin as plywood's face veneer, and within ordinary sheet-thickness and spoilboard tolerance. It will likely break, so the part comes loose.

**Why I re-rate to P2 anyway.** METHOD §3 lets a refuter lower a P1 by showing "that the output is not wrong". It holds here:
- The emitted program keeps every bit of material under every window. The bridge always equals the floor the operator's own relief left: the "part rim" column equals the bridge column in every row.
- The T0 control shows the full set height wherever the floor allows it.
- No tabbed program could leave a thicker tab at those positions, because the material is not there. The part itself is only that thick all along its edge.
- The thin floor comes from two numbers the operator set directly: relief Depth and Stock thickness.
- ADR-572 Amd 3 decides the in-air window (Consequences: "the cutter rides in air there, which costs only Z travel").

So the program is right. What is wrong is the description:
- Job Review states the set height.
- The ADR's consequence understates the effect.
- No note says "tabs only N mm: the floor there is N mm".
- The 2D warning says the tabs "stay 3 mm thick".

That is a misleading result on an ordinary route, which is P2.

**Contrast with the P1 precedent.** W6-P2-1 / CNC v1 F3-P1-1 dropped tabs the material could carry. Here the tabs carry all the material there is.

**For the coordinator.** If the coordinator reads "Job Review lists tabs while the part is effectively free" (T4) as F3-P1-1's harm regardless of cause, the P1 band is floors within about 0.2 mm of the stock bottom. Rows T3–T4 are the evidence.

**Novelty.** I confirm it is new.
- `docs/audits` has no tab thinned by an earlier relief or pocket. Pro loop v2 T11 measured 2D tabs on flat stock only.
- No open PR touches these files (#1657, #1623).
- The 2D twin (T7) is the same finding, older than #1643 (ADR-258 Amd 3).

#### X6-P2-1 — CONFIRMED, P2

**Reproduced** (`load.mts` → `load.out.txt`). The relief is a ramp 0 → 5 mm, roughed with a 1/8" EM at 1.5 mm per pass. A projected engrave on a 16 mm square runs at Vd 1, dpp 0.5. The "depth of cut" is the largest stock removed at any cell by one move: the leading edge, since a flat bit's centre line is pre-cut by its own front.

| Case | Order | Worst move | Level 1 / level 2 | Job Review |
|---|---|---|---|---|
| L1: layer as created (roughing only) | rough > engrave | **2.58 mm** at F1000 (and the plunge 2.58) | level 1 is over 0.5 along all 37.9 mm of its measured lateral travel; level 2 ≤ 0.50 | "2 passes of up to 0.5 mm" |
| L4: roughing at 3 mm per pass | rough > engrave | **3.80 mm** | the same | the same |
| L5: dome instead of ramp | rough > engrave | 1.68 mm | the same | the same |
| L3: finishing bit on the layer, engrave with the roughing bit | rough > engrave > finish | 2.58 mm | the same | the same + the order warning |
| L2 control: engrave with a 1/8" ball, so it runs after finishing | rough > finish > engrave | 0.14 mm (plunge 0.51) | ≤ 0.5 | the same |

- The auditor's 2.58 mm comes out exactly from an independent simulator.
- **Where the note shows:** `cnc-relief-planning-warnings.ts:148` ("Prepare the named surface before this operation; projection does not verify actual remaining stock") is part of `detectMachineJobWarnings`. That list feeds Save (`save-gcode-emission.ts`), the Start warnings (`start-job-warnings.ts:22`) and the Start advisories. So the operator does see it before Start, on every projection job.

**Severity.** P2 stands; I tried P3.
- **For P3:** Job Review's "passes of up to 0.5 mm" is literally true of the levels relative to the relief surface, and the standing note names the hazard class.
- **Against P3:**
  - The note is generic, shown on every projection whether or not the surface is prepared.
  - The app knows the case: the job has no finishing stage for that relief. It warns specifically when finishing runs later (`cnc-relief-projection-order-warnings.ts:34`), but not when finishing never runs, which is the worse case.
  - The layer as created is roughing only (`reliefFinishToolId` absent from the defaults; only the setup wizard sets one).
  - Cutter load is P2 at most (meta v1 M6), so it is not P1.

**Correction to the report.** P10 (relief not output, 5.50 mm) is not a defect. An unprinted relief declares the surface carved earlier. The auditor's simulator started from flat stock, which is the wrong premise for that case.

#### X6-P2-2 — CONFIRMED, P2

**Reproduced** (`rest.mts` → `rest.out.txt`, 0.025 mm grid). A 20 mm relief with a 2.4 × 5 mm groove: 1/4" EM rough, 1/8" ball finish, 1/16" ball rest.

| Case | 1/8" ball | Rest bit | Notes |
|---|---|---|---|
| R1: along rows | 0.30 mm | **bn-1588: 4.72 mm depth of cut, 4.69 mm under the centre, 18.3 mm at Z−5, F1000, 7.05 mm²** | Job Review "no relief roughing levels"; only the generic rest-prediction note |
| R2: across rows | 0.16 | 4.61 mm, 7.08 mm², 22.9 mm of travel over the depth per pass | the same |
| R3: 1/8" EM roughing | — | identical to R1 (the 1/8" EM cannot enter 2.4 mm either) | the same |
| R4: 3 × 3 groove, 1/16" **EM** rest | 0.55 | 2.95 mm, 36.5 mm over the depth per pass | the same |
| R5: layer Depth per pass 0.5 | — | unchanged, 4.72 mm | the rest stage ignores Depth per pass (`compile-cnc-relief-rest.ts:73`) |

- **Broken-bit risk:** yes.
  - 4.7 mm is 3 × D axial and about 6 × the app's own 0.5 × D guide (`feeds-calculator.ts`, plywood/softwood 0.5).
  - It is at full width, at F1000, with a 1/16" ball. That is the classic way to snap one.
  - No flute length exists in the starter tools (`cnc-tool-starters.ts:63-68`), so over-reach cannot be shown.
- **Why P2:** meta v1 M6 keeps cutter load at P2 ("a full-width slot … not a P1 output"), as for W6-P2-2, which W6's refuter also kept at P2 for this reason. No depth, position or gouge is wrong.
- **KNOWN overlap:** F6-P3-1 (rest falls back to a full fine finish over about 22 mm) widens reach; the fallback still slots the groove.

#### X6-P3-1 — CONFIRMED, P3

**Reproduced** (`rest.mts` E1–E4):

| Case | Worst depth of cut | Under the centre | Cross-section | Levels / note |
|---|---|---|---|---|
| E1: 8 × 2.7 mm channel across rows | 2.54 mm | 2.18 mm | 6.49 mm² | none / none |
| E2: along rows | 2.42 | 1.84 | 5.65 mm² | none / none |
| E3: 8 × 1.75 at 0.5 per pass | 1.59 | 1.23 | 3.48 mm² | none / none |
| E4 control: 3.2 deep | 1.50 | 0.20 | 6.08 mm² | 60 step-down passes, Job Review "not reaching about 118 mm² (finishing steps down 2 levels there)" |

- **New data point** (`chal.mts` K3a/b → `chal-K3.out.txt`): with a 3/8" EM roughing, the cell is 1.19 mm, so the slack grows. A 6 mm shelf 2.5 mm deep is under the 2.99 mm threshold. There the 1/8" ball takes up to 2.32 mm over 121 mm at F1000, with no level.
- **Why it stays P3:**
  - ADR-421 Amd 2 Decision 1 decides this threshold verbatim.
  - At 1.5 mm per pass the worst cross-section is within 2 % of the ADR's own 6.35 mm² yardstick.
  - The gap that matters is fine Depth per pass and large roughing bits: polish of a decided rule, not a broken contract.

#### X6-P3-2 — CONFIRMED, P3 (narrower than "cuts nothing")

**Reproduced** (`chal.mts` K1 → `chal.out.txt`). The floor is 5 mm deep in 6 mm stock, Vd 2, and the loops are on-path circles beside the raised disc.

| Loop | Emitted levels | What is cut | Job Review / advisory |
|---|---|---|---|
| r 3 (18.8 mm < 4 windows of 9.175 = 36.7 mm) | stop at Z−4 | 3.5 mm³, where the loop touches the disc wall | "deepest 7 mm"; spoilboard "1.00 mm past the bottom" |
| r 5.5 (34.6 mm) | stop at Z−4 | 53 mm³: it cuts 2 mm into the raised disc where it crosses it, and never through | "deepest 7 mm"; spoilboard "1.00 mm past the bottom" |
| r 6 (37.7 mm, not swallowed) | reach Z−6 / −7 | normal | — |

- So it is "never cut through", not always "cuts nothing".
- **Severity:** harmless in direction, and like the 2D single-bridge rule. The twin is false twice, so it stays P3.

### Challenges to "Verified clean"

- **#1643 finishing step-down at the relief edge with a small ball.** This does **not** hold; see the new finding **X6-P2-3**. The auditor's edge-band case used a 1/8" ball only.
- **#1643 finishing with a 3/8" EM, allowance 0.3 and 1.0, a 4.3 mm (non-multiple) channel, 8-bit and 16-bit maps** (K3): holds where the reach check fires (96 step-down passes). The shelf below the threshold is X6-P3-1's class (above).
- **#1643 projection, nested 40 / 20 / r 2.5 loops, a 1/4" EM over a 1/16"-ball-finished cone, Vd 1.7 at 0.6 per pass** (K2): holds.
  - The worst projection move removes 0.63 mm (≤ 0.6 + grid).
  - Job Review "3 passes of up to 0.6 mm … tabs … on 2 of 3 closed shapes" is right:
    - the inner square stops within a tab height of the bottom, so it keeps its tabs under ADR-258 Amd 1;
    - the r 2.5 circle is shallow, so it has no tabs.
  - The outer tabs are 1.6 mm, not the stated 2 mm: X6-P1-1 again.
- **"After a finished relief, every level ≤ Depth per pass"** holds only when the projection runs after finishing.
  - With an engrave on the roughing bit, the default bit grouping puts it between roughing and finishing (L3). The order warning covers that case.
  - A different tool can run after finishing; the L2 control removes ≤ 0.14 mm.
- **#1622 surface, 16-bit vs 8-bit, a 25:1 cliff and a 1-pixel pit** (K3): no gouge.
  - The final stock is never more than 0.015 mm below the lowest of the four surrounding pixel centres, on both maps.
  - Against bilinear it is 0.015 mm (16-bit) and 0.053 mm (8-bit). The 8-bit figure is not localised, and on a 25:1 cliff it is inside a 0.05 mm grid's error. I do not raise it.
- **#1603 and #1646:** not re-run (see Not verified).

### New findings

#### X6-P2-3 — With a small finishing ball, the first finishing row along a relief edge that its floor meets still slots the unroughed edge band at full depth, with no level and no note

- **Where (8c6b04869):**
  - `src/core/relief/relief-roughing-reach.ts:202-223` (`allowanceEnvelope`): past-the-edge cells stand at the stock top, so a cell within allowance + one roughing cell of the relief edge never counts as missed. This is the "wall's allowance strip" of ADR-421 Amd 2 Decision 1.
  - `:79` (the opening by half the next bit) and `src/core/cnc/compile-cnc-relief.ts:304` (`minWidthMm: nextTool.diameterMm / 2`).
- **Anchor:**
  - **Contract:** ADR-421 Amendment 2, Consequences: "A relief whose deep floor meets its own edge usually gets levels along that edge … Before this amendment the ball met that band at full depth with up to half its width in stock: ADR-140 Amendment 2's threshold for a profile."
  - **Decision 1:** a sliver is "side-milled, not slotted".
  - **Twin:** the same band with a 1/8" ball holds (X6's Matrix "edge band").
  - **Precedent:** W6-P2-2 (P2).
- **Scenario:** a depth map whose background floor (3 mm) reaches the image edge, which is common for a logo without a border.
  - It is roughed with a 1/8" EM (the default) at 1.5 mm per pass and finished with the starter 1/16" ball (`bn-1588`).
  - Roughing stops short of the edge by its allowance and contour clearance.
  - The ball's first row runs 0.857 mm inside the edge, with its centre inside that unroughed band.
- **Evidence:** REPRO (`k2diag.mts` → `edge.out.txt`, `edge2.out.txt`, `k2diag.out.txt`; my simulator, 0.05 mm grid).

| Relief | Finishing ball / allowance | First edge row | Levels / reach note |
|---|---|---|---|
| 30 mm, flat 3 mm floor to every edge | 1/16" / 0.5 | **28.3 mm at Z−3, F1000, 2.96 mm under the centre, 2.31 mm²** | none / none (Job Review "relief roughing 2 levels to 2.5 mm") |
| the same | 1/16" / 0.2 | the same row, 2.96 mm under the centre, 1.05 mm² | the reach check flags 0.79 mm² and makes 4 step-down passes, none on this row |
| the same | 1/8" / 1.0 | 1.00 mm under the centre (the allowance), 2.70 mm at the side | none (side-milling, as the ADR intends) |
| the same | 1/8" / 0.5 | 0.50 mm under the centre, 2.44 mm at the side | none (holds; the auditor's case) |
| the same | 1/4" / 1.0 | 1.00 mm under the centre | none (holds) |
| 50 mm cone 0 → 3 mm, floor meeting the corners (`chal.mts` K2) | 1/16" / 0.5 | 32.6 mm at Z−3 over two stretches, 2.96 mm under the centre | none / none |

- Only the first row of the serpentine is hit.
  - The band along the other parallel edge is eaten by the sides of the rows before it.
  - Along the row ends, each row plunges 2.2 mm into the band at the plunge feed (F300).
- **Severity: P2.** The class is W6-P2-2: cutter load, not a wrong depth.
  - 2.96 mm is 1.9 × D and 3.7 × the app's 0.5 × D guide, for a 1/16" ball, with its centre and about half its width in stock, at F1000.
  - That is over ADR-140 Amd 2's half-width threshold that ADR-421 Amd 2 cites. The ADR's "usually gets levels along that edge" is false for this starter bit.
  - Not P1, by meta v1 M6.
- **Announced?** No. The ADR's rationale for the envelope (a strip the next bit side-mills) assumes a ball wider than the strip.
- **Novelty:** new.
  - W6-P2-2 measured interior channels.
  - X6's edge-band row used a 1/8" ball.
  - `git grep` "edge band" over `docs/audits` finds no relief case.
  - No open PR touches `relief-roughing-reach.ts`.
- **Fix direction:**
  - Count the edge strip as missed when the next bit's radius is smaller than allowance + one cell.
  - Or let the step-down hold the first row up where its centre line has stock.
  - Have Job Review name the edge band.
- **Refuter:** this is the refuter's own finding. The coordinator should re-verify it with `k2diag.mts bn-1588 30 flat`.

### Not verified

- **#1603 (adaptive fallback) and #1646 (carving comparison):** not re-run. The auditor's results stand unchallenged.
- **Browser:** no rendered Job Review, Preview banner or 3D view. Rows come from `cncOperationDetail` and `detectMachineJobWarnings`, as the auditor read them.
- **Physical:** no cut was made and no bit load was measured. "Likely breaks" (0.2 mm bridges) and "snaps a 1/16" ball" are engineering judgement from DOC/D ratios and bridge section, not tests.
- **The X6-P2-3 cause with allowance 0.2:** not localised. The step-down that did run missed the first row.
- **The L6 case** (1/16" EM projection on a roughing-only relief): my move filter found no lateral moves, so it is unmeasured.
- **STL reliefs, masked maps, and maps over 1024 px:** not run.

### Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-x6r\`. Run each with `node --import ./register.mjs <file> [case]`. Nothing in the repo was touched except this section.

| File | What it does |
|---|---|
| `register.mjs`, `ts-resolve.mjs` | the W4 loader, pointed at `j17-main` |
| `x.mts` | scene builders and my analytic stock simulator (exact disc interval; golden-section ball bottom) |
| `tabs.mts` → `tabs.out.txt` | X6-P1-1: T0–T8 plaque bridges, part rim, Job Review, advisories |
| `load.mts` → `load.out.txt` | X6-P2-1: L1–L5 projection depth of cut per level |
| `rest.mts` → `rest.out.txt` | X6-P2-2 (R1–R5) and X6-P3-1 (E1–E4) |
| `chal.mts` → `chal.out.txt`, `chal-K3.out.txt` | X6-P3-2 (K1); the nested-loop projection (K2); finishing with a 3/8" EM, allowance 0.3/1.0, 8-bit vs 16-bit, cliff and pit, gouge bounds (K3) |
| `k2diag.mts` → `k2diag.out.txt`, `edge.out.txt`, `edge2.out.txt` | X6-P2-3: the edge-band row by ball and allowance |

No security finding, so there is no `SECURITY-DETAILS.md`.

Refuter counts: raised 6, refuted 0, P1 0, P2 4, P3 2, known 3
