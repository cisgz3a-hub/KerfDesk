# Performance audit S1 — S4 Compile, Preview and ETA

- **When:** 2026-11-03 22:20 – 2026-11-04 04:00 +0800.
- **Tree:** origin/main @ `c47579cb4` (worktree `claude/performance-audit-s4`, HEAD `1b8a408d9`, which adds only docs).
  - The `j7-main` copy was refreshed to `c47579cb4` file by file (`git cat-file blob origin/main:<path>` for each of the 215 files whose blob hash differed; the two files `c47579cb4` deleted were removed one by one). Afterwards a hash check of **all 10,578** files under `src`, `public`, `scripts`, `index.html`, `vite.config.ts`, `package.json` and `tsconfig.json` matched `origin/main`. Fourteen old `zz-j7-*` test files from earlier audits remain in `j7-main`; nothing imports them.
  - Main build: `vite build --sourcemap hidden` with `zz-s4\zz-s4-vite.config.mts` (main's config plus the fflate alias, `root` set to `j7-main`; the config stays in the harness), into `zz-s4\dist-main`.
  - **Main moved during the audit** to `a96bc8950` (#1566–#1570, the UX fix sessions). `git diff c47579cb4 a96bc8950` touches none of the compute files cited below; in `src/ui/laser/job-review/` it adds the "Before you start" panel and the laser-mode button (dialog content, not the model or gate).
  - **Trend builds:** S1's `dist-33bc394c6` (1.0.28) and `dist-87ecb4f24` (1.0.23), built with main's `vite.config.ts` and main's `node_modules` (S1's method and caveat). Every project was written by each tree's **own** `serializeProject` (S2's `src` exports in `scratchpad\zz-s2-old\`), and the photo projects were made by each build's own Import and Save.
- **Machine state:** i7-1260P (12 cores, 16 threads), 16 GB, Intel Iris Xe; Chrome 156 (installed, headless); Node 25.8.2. `machine-state.log` holds free memory, CPU load and other sessions' tooling before and after every set (77 sets).
  - **Overlap with other work.** The maintainer started five UX fix sessions at about 23:00 (laser `$32=0` setup, Abort/Unlock and Frame, screen reader, locked controller, Job Review safety block, PR #1566; they merged as #1566–#1570). From 23:01 to 01:51 their `vitest`, `eslint` and `tsc` runs (up to 16 processes, `tsc` with 6–8 GB heaps) loaded the PC to 60–100% CPU and left as little as **265 MB** free.
    - Sets taken from 23:01 to 23:15 drifted (calibration 43–114 ms) and are **discarded and re-run** (labels `R-`).
    - One set was refused at 265 MB free, and one was ended by the free-memory watchdog.
    - From 23:59 every set ran from `queue.sh`. It waits with no time limit until two checks 20 s apart both show no other tooling, CPU under 35% and at least 3 GB free. It waited **6,703 s** once (to 01:51), then 25–69 s.
  - **Calibration** (S1's 40M-step loop in the page, 3 s settle): 36–39 ms on every scorecard set of the flow harness. Runs over 41 ms (15% above 36 ms) are dropped by `analyze.mjs`, and a set with more than half of its runs dropped was re-run.
    - The Start harness calibrates while connected to the simulated controller, so its idle floor is higher: 39–51 ms, as S1 found 38–55 ms.
    - After a large job's Start/Abort cycles it reads 55–68 ms, because the app is still busy.
  - **Memory figures** are the private bytes of the measuring Chrome only (`mem-poll.ps1` follows the browser carrying a `--zz-s4-run=<pid>` flag and its children). The PC's free physical memory is polled with them. A watchdog closes the browser when free memory falls under 450 MB (300 MB in the `SMM-` sets).
- **Temp files:** none in `j7-main`; none in the repo except this report. Kept for the refuter in `scratchpad\zz-s4\`: scripts, `results.jsonl`, `results-start.jsonl`, `machine-state.log`, `logs\` (including `mem-SMM-*.txt` memory timelines), profiles, `jt-*.json`, the main build `dist-main` with hidden maps, the projects under 4 MB, and the ordinary-size G-code in `gcode\`. Deleted to save disk (remade by the commands under "Re-running"): the 21 MB photo projects, the 13 MB 5,000-circle projects, the benchmark SVG, and the large G-code files.
- **Scope:**
  - Open → estimate (ETA), Preview, Preview again, Save G-code and Save G-code again for laser Line, Fill and Image. Everyday rows: 200 Line circles, 200 Fill rectangles, a 200-object mix, and one phone photo engraved at 100 × 75 mm. Large rows: 5,000 circles, 5,000 rectangles, the 50,000-path benchmark SVG, and the same photo at bed size (400 × 300 mm).
  - CNC pocket and profile at 200 objects.
  - Start preparation on a simulated GRBL (S1's harness, USB worker route) at 18,527, 53,987, 374,843 and 507,535 lines, plus the bed photo, with memory.
  - Preview and Abort during a 375k-line job (S1-P2-1, fixed by #1548).
  - Machine job time for seven jobs.
  - Trend against 1.0.28 and 1.0.23 for every row.
- **Counts:** 5 raised by the auditor + 1 by the refuter → 0 refuted → P1 0 / P2 2 / P3 4. **Coordinator:** S4-P2-3 raised to P1 (a UI block that delays Abort while a job runs, as S1-P2-1), so P1 1 / P2 1 / P3 4 (+ 5 KNOWN re-observed, 3 merged fixes verified).
  - **Refuter (2026-11-04):** 4 CONFIRMED as raised (S4-P2-2, S4-P3-1, S4-P3-2, S4-P3-3), 1 SEVERITY CHANGE (S4-P2-1, P2 → P3: every median is under 3 × the budget), 0 REFUTED.
  - One new finding: **S4-P2-3**, a UI block inside the running job, right after its first line. It is 260–334 ms on an ordinary 100 mm photo, and an Abort pressed then reached the controller 125–504 ms later at 375k lines.
  - Two sub-claims corrected: S4-P2-2's "Where" (the bed photo's memory is not on the window side), and S4-P2-1's "about 1.1 s for Frame plus Start" (two separate blocks, not one freeze). See `## Refuter summary`.

## Headline

**Large vector jobs are well handled.** 5,000 circles, 5,000 Fill rectangles and the 50,000-path SVG all show Preview in 110–221 ms. Their estimate comes from the background worker in 1.6–5.0 s, and Save G-code takes 0.7–2.9 s, with no UI block over 94 ms after Open. Reopening Preview reuses the worker's route (29–31 ms). The merged fixes hold:
- **#1548:** Preview during a 375k-line job now blocks 0–59 ms (was 0.6–1.6 s), and an Abort pressed inside it reaches the controller 1–6 ms after the key (was 1,223–1,357 ms).
- **#1562 and #1565:** the bed photo's background estimate peaks at 1.19 GB (1.0.28: 4.26 GB) and finishes in 16.2 s (25.2 s).

**The everyday design is where the UI thread works.**
- **S4-P2-1 (P2).** A 200-object design of 100 circles and 100 small Fill rectangles (54k lines) falls under the 20,000-unit "direct" threshold. So Preview, Frame, Start, the ETA and Save G-code each compile the whole job **on the UI thread**, separately and without reuse:
  - Preview blocks **527–557 ms**, and every reopen blocks **469–539 ms**;
  - Frame blocks **494–546 ms**;
  - Start blocks **565–773 ms**;
  - Open blocks 211–223 ms (the estimate, KNOWN S2-P3-1);
  - Save blocks 185–194 ms.

  The same is true in 1.0.28 and 1.0.23.

**Photos still cost memory at Start.**
- **S4-P2-2 (P2).** The background estimate is fixed, but Frame and Start build the job a second time with no such limit:
  - An everyday 100 mm photo takes the measuring Chrome to **2.5–3.9 GB** during Frame → Start.
  - Frame on a bed-sized photo drove the renderer past **6.2–7.7 GB**. The PC's free memory fell to **60–365 MB** within 50 s of the click in 4 of 4 runs, and the watchdog ended each one before Frame finished. 1.0.28 and 1.0.23 reach 7.6–8.4 GB the same way.
  - A 375k-line Fill job peaks at 1.9–4.05 GB during Start.

**S1-P2-2 now** (375k lines, idle PC): Frame 4.2–4.6 s; Start → Job Review **4.8–5.5 s** with blocks of **628–967 ms** and 371–459 ms; Start job → first line 0.56–0.77 s. The same as at S1 and in both releases. The profile shows the same functions as S1's. A 100 mm photo is better than in the releases: Start → Review 3.6 s against 6.0–6.2 s.

**Machine job time.** An independent GRBL 1.1 planner model reproduces the app's ETA to within 0.0–0.6% on six of seven jobs (2.7% on the photo) when given the estimator's one extra rule: a full stop wherever rapid and feed motion meet. GRBL in laser mode does not stop there (S4-P3-3). For the 200-object mix, whose Fill rows rapid over the circle columns, the ETA says **3 h 05 min** where the model says **1 h 51 min**.
- Travel on the 200-circle job is 5,183 mm against a lower bound of 1,520 mm. 2-opt finds no better order with each shape's start fixed, and the project's own "nearest" start option gives 3,851 mm (−2% job time).
- Overscan costs 7% of a Fill job and 11% of a photo.
- The 115,200-baud link is never the limit on these jobs.

**Trustworthiness.** Production bundles in Chrome 156, a fresh context per run, the first run of each set dropped, and median and worst of the rest. Every scorecard set had calibration within 15% of idle, and drifted sets were re-run on a quiet PC. Times are good to about ±15%. The trend trios ran back to back per row. The two P2s rest on source-mapped profiles (S4-P2-1) and per-second memory timelines (S4-P2-2). The memory attribution to the Frame/Start preparation is by timing, not by heap snapshot.

## Scorecard

Times are median (worst) of five kept runs on main, three on each release, unless marked. "Ready" is input → the first animation frame showing the result: the estimate badge's "≈", Preview's controls with no "Updating route view…", or the "Save as…" button enabled. "Block" is the longest main-thread task in that window. "Memory" is the peak private memory of the measuring Chrome; a fresh app is about 0.5 GB in this harness.

Budgets: 100 ms response, 200 ms longest block while designing, 1.5 GB peak memory.

**Open → estimate** (Open click → the badge's final "≈ time"; large jobs show "large job" first, at the "first" time)

| Input | G-code | Estimate ready | Block | Memory | Budget | Verdict |
|---|---|---|---|---|---|---|
| 200 Line circles | 6.6k lines, 0.14 MB | 447 ms (447) | 0 | 0.55 GB | 200 ms block | Pass |
| 200 Fill rectangles | 101k, 4.1 MB | first 380 ms, ready 846 ms (847) | 0 | 0.62 GB | 200 ms | Pass |
| **200 mixed** (100 + 100) | 54k, 2.1 MB | 637 ms (641) | **211–222 ms** | 0.60 GB | 200 ms | KNOWN S2-P3-1 (S4-P2-1) |
| 100 mm photo (4000 × 3000 JPEG at 100 × 75 mm) | 508k, 4.6 MB | first 605 ms, ready 2,046 ms (2,080) | 77–80 ms | 0.90 GB | 200 ms; 1.5 GB | Pass |
| CNC 200 (profile-outside + pocket, 3 mm in 1 mm passes) | 25k, 0.68 MB | first 414 ms, ready 1,383 ms (1,447) | 55–59 ms | 0.55 GB | 200 ms | Pass |
| 5,000 Line circles | 165k, 3.5 MB | first 1,329 ms, ready 1,847 ms (1,880) | 258–265 ms (Open) | 1.31 GB | 200 ms | KNOWN S3-P3-2 |
| 5,000 Fill rectangles | 271k, 3.4 MB | first 580 ms, ready 1,613 ms (1,615) | 169–186 ms | 0.74 GB | 200 ms | Pass |
| SVG 50,000 paths (Import) | 703k, 6.2 MB | first 1,763 ms, ready 5,013 ms (5,063) | 591–616 ms (Import) | 1.29 GB | 200 ms | KNOWN S3-P3-2 |
| Bed-sized photo (400 × 300 mm), n=3 | 8.0M, 76 MB | first 597 ms, ready **16.2 s** (16.3) | 71–76 ms | **1.19 GB** | 1.5 GB | Pass (S3-P2-3's estimate part fixed) |

**Preview** (toggle on; then off, quiet, and on again)

| Input | Ready | Block | Again: ready / block | Memory | Budget | Verdict |
|---|---|---|---|---|---|---|
| 200 Line circles | 131 ms (131) | 93–96 ms | 100 ms / 72–74 ms | 0.55 GB | 200 ms | Pass |
| 200 Fill rectangles | 31 ms (32) | 0 | 29 ms / 0 | 0.60 GB | 200 ms | Pass (reuses the estimate's worker route) |
| **200 mixed** | **719 ms (735)** | **527–557 ms** | 648 ms / **469–539 ms** | 0.71 GB | 200 ms | **S4-P2-1** |
| 100 mm photo | route 249 ms; image 2,041 ms (2,049) | **203–212 ms** | 229 ms / 0–52 ms | 1.05 GB | 200 ms | S4-P3-1 (1.05×) |
| CNC 200 | 31 ms (31) | 0 | 30 ms / 0 | 0.56 GB | 200 ms | Pass |
| 5,000 Line circles | 175 ms (182) | 0 | 146 ms / 0 | 1.30 GB | 200 ms | Pass |
| 5,000 Fill rectangles | 110 ms (114) | 0 | 126 ms / 0 | 0.73 GB | 200 ms | Pass |
| SVG 50,000 | 212 ms (215) | 89–94 ms | 185 ms / 71–78 ms | 1.24 GB | 200 ms | Pass |
| Bed-sized photo (n=3) | 735 ms (781) | **673–737 ms** | 30 ms / 0 | 0.85 GB | 200 ms | **S4-P3-1** |
| During a 375k-line job (Start harness, 2 × 4 windows) | — | 0–59 ms; controller starved ≤ 7 ms | — | — | 50 ms (job running) | Pass (#1548 holds; S1: 610–918 ms) |

**Save G-code** (Ctrl+Shift+E → "Save as…" enabled = preparation; then the write; then Save G-code again)

| Input | Prepared | Write | Block | Again | File | Memory | Verdict |
|---|---|---|---|---|---|---|---|
| 200 Line circles | 34 ms (35) | 48 ms | 0 | 29 ms | 0.14 MB | 0.57 GB | Pass |
| 200 Fill rectangles | 480 ms (497) | 64 ms | 0 | 394 ms | 4.1 MB | 0.65 GB | Pass |
| 200 mixed | 199 ms (200) | 79 ms | **185–194 ms** | 194 ms, block 187–197 | 2.1 MB | 0.69 GB | S4-P2-1 (just inside) |
| 100 mm photo | 1,165 ms (1,166) | 64 ms | 0 | 1,083 ms | 4.6 MB | 1.17 GB | Pass |
| CNC 200 | 745 ms (751) | 58 ms | 95–100 ms | 829 ms | 0.68 MB | 0.61 GB | Pass |
| 5,000 Line circles | 679 ms (681) | 64 ms | 0 | 553 ms | 3.5 MB | 1.48 GB | Pass |
| 5,000 Fill rectangles | 999 ms (1,094) | 64 ms | 0 | 847 ms | 3.4 MB | 1.04 GB | Pass |
| SVG 50,000 | 2,829 ms (2,861) | 64 ms | 53–57 ms | 2,609 ms | 6.2 MB | 1.66 GB | Pass (S4-P3-2) |
| Bed-sized photo (n=3) | **16.2 s** (16.3) | 221 ms | 163–166 ms | 15.5 s | 76.3 MB | 1.52 GB | S4-P3-2 (no reuse) |

**Start preparation** (simulated GRBL at 1,000 blocks/s, USB worker route; median (worst) of the kept starts, the first of each set dropped; n = 5 + 5 on main, 3 + 3 on each release)

| Job | Frame | Frame block | Start → Job Review | Start blocks | Start job → first line | Memory (Chrome) | Budget | Verdict |
|---|---|---|---|---|---|---|---|---|
| S1 rings, 18,527 lines | 3.2 s (3.2) (head moving) | 0 | 0.34–0.90 s (two modes, also in both releases) | ≤ 77 ms | 104 ms (112) | 0.77–0.86 GB | 200 ms | Pass |
| **200 mixed, 53,987 lines** | 3.7 s (3.7) | **494–546 ms** | 641 ms (827) | **565–773 ms**, then 88–134 | 170 ms (211) | 0.83–1.05 GB | 200 ms | **S4-P2-1** |
| S1 Fill, 374,843 lines | 4.4 s (4.6) | 377–650 ms | **5.0 s (5.5)** | **628–967 ms**, then 371–459 | 0.62 s (0.77) | **1.9–4.05 GB**; PC free down to 617 MB | 200 ms; 1.5 GB | **S1-P2-2** (KNOWN); memory S4-P2-2 |
| 100 mm photo, 507,535 lines | 3.6 s (3.9) | 140–325 ms | 3.6 s (4.2) | 284–778 ms, then 205–231 | 0.47 s (0.53) | **2.5–3.9 GB**; timeline 2.8–3.2 GB | 200 ms; 1.5 GB | S1-P2-2; **S4-P2-2** |
| Bed-sized photo, 8.0M lines (n=0 of 3 attempts) | **never finished**: watchdog at 45–51 s after the click | — | — | — | — | **6.2–7.7 GB**; PC free 60–365 MB | 1.5 GB | **S4-P2-2** |
| Abort inside Preview, 375k (n=6) | — | — | — | — | key → stop byte **1–6 ms** | — | 50 ms | Pass (#1548; S1: 1,223–1,357 ms) |

**CNC compile** (200 objects: 100 circles profile-outside, 100 rectangles pocket, 3.175 mm end mill, 3 mm deep in 1 mm passes): estimate 1.38 s in the worker (block 55–59 ms), Preview 31 ms (reusing it), Save G-code 0.75 s (block 95–100 ms), 25,185 lines, 0.68 MB. Pass.

### Measurement method

Harness: `scratchpad\zz-s4\`.

1. **Build and serve.**
   - Build: `node node_modules/vite/bin/vite.js build --config <zz-s4>/zz-s4-vite.config.mts --outDir <zz-s4>/dist-main --emptyOutDir --sourcemap hidden`, run from `j7-main`.
   - Hosts: S3's `host.mjs` serves the bundle with COOP, COEP and CSP and the inputs at `/__zz__/<name>` on ports 4811 (main), 4812 (1.0.28) and 4813 (1.0.23). S1's `start\host.mjs`, which also serves the controller simulator, runs on 4814–4816.
2. **Inputs.**
   - `gen.mjs` + `gen-entry.ts` write each tree's own `.lf2`. The grid is over 380 × 380 mm: Line circles of 32 points, Fill rectangles 0.7 × 0.5 of the pitch with a 0.1 mm hatch at 6,000 mm/min, both on a 400 × 400 GRBL that homes front-left and starts from absolute. `cnc` sets those layers to profile-outside and pocket on the default CNC machine.
   - `run.mjs` op `mkimg` imports a page-made 4000 × 3000 JPEG (S3's `makePhoto`) and saves it in each build. `mk-img.mjs` then writes `-img-bed` (as placed, 400 × 300 mm) and `-img-100` (scale 0.25), image layer at 6,000 mm/min and 10 lines/mm.
   - `mk-svg.mjs` writes the benchmark's 50,000-path SVG.
   - The Start rows also use S1's `main-20k`, `main-375k` and `old-*` projects.
   - Variants with `closedShapeStart: "nearest"` (`main-line-200-nearest`, `main-mix-200-nearest`) were made for the machine-time comparison.
3. **Flow** (`run.mjs` op `flow`, one fresh context per run):
   1. Open, or Import for the SVG;
   2. the estimate badge;
   3. Preview, then Preview again;
   4. Save G-code, then Save G-code again.

   `page-init.js` (S3's, plus a per-frame trail of the badge text, the Preview state and the "Save as…" button) stamps each change by animation frame. Times are taken from that trail, not from Playwright round trips. The captured G-code's SHA-256 and size come from the save picker, and the first kept run's text is written to `gcode\`.
4. **Start** (`start\start-run.mjs`, S1's driver plus the memory poller, a watchdog and a per-second memory timeline): the plan runs Frame, Start, Job Review, Start job and the first line at the simulator, then Abort, six times (four or three on the releases). The simulator's state is set before the port opens (S1's fake serial port).
5. **Queue.** `queue.sh` / `queue2.sh` run the sets only on a quiet PC and re-run drifted sets (suffix `#2`; `analyze.mjs` keeps the last attempt).
6. **Attribution.** CDP CPU profiles (200 µs sampling) on separate `P-` and `SP-` sets, mapped with `map-profile.cjs` through the hidden source maps.

## Findings

### S4-P2-1 — An everyday design under the 20,000-unit direct threshold is compiled on the UI thread by Preview, Frame, Start, the ETA and Save, each separately: a 200-object mix blocks 0.53–0.56 s on Preview (and on every reopen), 0.49–0.55 s on Frame, 0.57–0.77 s on Start

- **Where:**
  - `src/ui/workspace/canvas-preparation-policy.ts:28`: `DIRECT_VECTOR_CANVAS_WORK_BUDGET = 20_000`. Below it, `classifyCanvasPreparation` (`:31-45`) keeps the job on the UI thread. Our mix is about 12.7k Fill segments plus 100 circles.
  - **Preview:**
    - `src/ui/workspace/use-preview-toolpath.ts:172-175` calls `buildPreviewToolpath` on the UI thread, with no cache.
    - That goes through `draw-preview.ts:113,154,197` to `executable-plan-preview-route.ts:80` (`registerExecutablePlanPreviewRoute`, 524 ms inclusive).
    - That function emits the whole program (`emitPreparedGcodeWithExecutablePlan`, `src/io/gcode/executable-plan-emission.ts:83`, 439 ms; preflight 138 ms), builds the executable plan (181 ms), parses the G-code back into a render model (93 ms) and compares the two routes (`preview-route-parity.ts:54`, 74 ms).
  - **Start and Frame:** `src/ui/laser/start-job-readiness.ts:236` `prepareStartJobSnapshot`, then `:329` `finalizeStartPreparation` (1,043 ms inclusive across one Frame and one Start). Under it:
    - `emitStartProgram` `:415` (423 ms);
    - `buildPreparedJobMetrics` (`prepared-job-metrics.ts:38`, 376 ms, a whole-program duration estimate);
    - preflight (312 ms);
    - Job Review's `planFillSweeps` (175 ms).
  - **ETA:** `use-job-estimate.ts:351` `recomputeEstimate` (229 ms; KNOWN S2-P3-1).
  - **Save:** `src/ui/app/save-gcode-emission.ts:139` `prepareSaveDirect` (195 ms).
- **Anchor:** AREAS budget, longest UI block while designing 200 ms, or a progress bar and Cancel. ADR-598 decision 4 lets an ETA compile satisfy Preview, but only on the worker path. ADR-244 Amendment (2026-07-22) moved Start, Save and Frame to a worker only for large plain projects.
- **Scenario:** a user lays out an ordinary job: a sheet of tags, coasters or labels, each with a cut outline and a small filled area. They open Preview, close it, and open it again to check after a change. Then they Frame and Start. Each of those clicks freezes the window for half a second or more. Frame plus Start freezes it about 1.1 s in total, with Abort and the status display waiting too. A 200-object Fill-only design (101k lines) is over the threshold and gets all of this in a worker, with no block.
- **Evidence:** **REPRO** (production build, idle PC).
  - Flow sets `M-mix-200` (n=4 after a drifted run was dropped): Preview block **527–557 ms**, ready 719 ms (735); Preview again 469–539 ms; Open 211–222 ms; Save G-code 185–194 ms.
  - Start sets `SM-mix200` and `#2` (n=10): Frame block **494–546 ms**; Start → Review 641 ms (827) with blocks **565–773 ms**; Start job → first line 170 ms (211).
  - Profiles: `prof-P-mix-200-preview-preview-r1.json`, `prof-P-mix-200-open#2-open-r1.json`, `prof-P-mix-200-save-save-r1.json`, `start\prof-SP-mix200.json`.
  - Below the threshold the same path is cheap at smaller sizes: 200 circles (6.6k lines) preview with a 93–96 ms block.
  - **No reuse:** each of the five consumers emits and preflights the same program again. Reopening Preview on an unchanged project costs the full compile again.
  - **Trend:** Preview block 527–557 / 532–542 / 534–537 ms; Start blocks 565–773 / 557–685 / 540–580 ms; Frame blocks 494–546 / 487–531 / 465–526 ms (main / 1.0.28 / 1.0.23). Not a regression.
  - **G-code:** main's mix-200 program is byte-identical to 1.0.28's apart from the provenance header. 1.0.23's cut order differs (see Trend), with the same length.
- **Severity:** **P2.** An ordinary operation over three times its budget: Start's block reaches 773 ms (3.9 ×), and the Frame-then-Start path blocks about 1.1 s. Medians are close to the line (Start 590 ms, 2.95 ×; Preview 540 ms, 2.7 ×), so a refuter may argue for P3. It is met on every Preview toggle and every Start of an everyday mixed job.
- **Fix direction** (no output change: the same emitter runs, so the G-code stays byte-identical; prove it on the fixture set):
  - Send plain projects' Preview, Frame, Start and Save through the workers that already exist for large jobs. Or lower `DIRECT_VECTOR_CANVAS_WORK_BUDGET` to what fits in 200 ms on this PC: the 6.6k-line circle job costs 93 ms, the 54k-line mix 540 ms, so about 2,000–3,000 units.
  - Keep one prepared output per immutable project and options. Preview, ETA, Frame, Start and Save would read it, as ADR-598 decision 4 already does for ETA → Preview on the worker path.
  - Preview does not need the executable-plan sidecar and parity check on the UI thread when the route is never streamed.
  - Budget to reach: no block over 200 ms for these five actions at 200 objects; reopening Preview of an unchanged project under 100 ms.
- **Refuter (2026-11-04): SEVERITY CHANGE → P3.** The mechanism and the numbers hold. The P2 test fails on medians.
  - **What would make it false:** blocks under 200 ms, a worker route for this design, or reuse between consumers.
  - **READ** (origin/main `a96bc8950`): every cited line is unchanged since `c47579cb4`:
    - `canvas-preparation-policy.ts:28` and `:31-45`;
    - `use-preview-toolpath.ts:175`;
    - `executable-plan-preview-route.ts:80` and `:102`;
    - `executable-plan-emission.ts:83`;
    - `preview-route-parity.ts:54`;
    - `start-job-readiness.ts:236`, `:329`, `:334` and `:415`;
    - `prepared-job-metrics.ts:38`;
    - `save-gcode-emission.ts:139`.

    One path correction: the ETA's `recomputeEstimate` is `src/ui/laser/use-job-estimate.ts:351`.
  - **REPRO.** I used my own driver and long-task observer (`zz-s4r\r.mjs`, `probe.js`) on the auditor's `dist-main`, with the same `main-mix-200.lf2`, on an idle PC. Calibration was 36–41 ms. Medians are of five kept runs, with the range after them.

    | Action | Block, median (range) | Notes |
    |---|---|---|
    | Preview (`A-mix`, n=5) | **527 ms** (517–539) | Ready in 584–756 ms |
    | Preview again (n=5) | **478 ms** (468–485) | |
    | Frame (`B-mix`, `B-mix#2`, n=10) | **497 ms** (448–529) | See below |
    | Start (n=10) | **574 ms** (549–619) | Start → Review 649 ms (626–700); first line 186–209 ms |
    | Save G-code (n=5) | 185 ms (184–198) | Prepared in 201–220 ms |

    The Frame block starts 88–93 ms after the click and ends before the Frame's first motion line reaches the controller (555–646 ms). It does not hold up a moving head.
  - **Severity.** The budget is 200 ms, so three times the budget is 600 ms.
    - Every median is 2.4–2.9 × the budget. Only the worst Start reaches 3 × (mine 619 ms, the auditor's 773 ms).
    - Frame and Start are two separate tasks, seconds apart, with the Frame's motion between them. The "about 1.1 s" is not one freeze.
    - Nothing comes near the 5 s freeze test.

    That makes it P3 ("any other budget miss"). It stays first in the ranked list by frequency: it is met on every Preview toggle.
  - **G-code.** My Save's SHA-256 (`8593a0f9bdf866d5…`) matches the auditor's `M-mix-200.gcode` byte for byte.
    - 1.0.28's file differs only in the `built` and `emitter` header lines.
    - 1.0.23's file holds the same lines (sorted, with comments stripped) in a different order.
  - **Same Start, inside the job:** a further 94–113 ms block lands just after the first line is sent (S4-P2-3).

### S4-P2-2 — Frame and Start prepare photo jobs with no memory bound: an everyday 100 mm photo takes Chrome to 2.5–3.9 GB, and Frame on a bed-sized photo drove the renderer past 7 GB and the PC to 60–365 MB free in 4 of 4 runs without finishing

- **Where:**
  - Frame and Start of a large plain project run in the output-preparation worker. The result is hydrated and archived on the window side:
    - `src/ui/laser/output-preparation-worker-client.ts:83-95` (`hydrateTransferredStartPreparation`) and `:294`;
    - `src/ui/state/recovery/execution-artifact-canvas.ts:54` (`executionArtifactCanvasPlan`);
    - `execution-artifact.ts:193` (`createExecutionArtifact`);
    - `packed-motion-manifest.ts:42` (`packMotionManifest`);
    - `src/core/recovery/job-checkpoint.ts:74` (`fingerprintGcode`).
  - These hold the whole program, its motion manifest and the canvas plan at once (S1-P2-2's profile and `start\prof-SP-375k.json`).
  - The background estimate no longer does this (ADR-244 Amendments 1 and 2). Frame and Start have no such plan.
  - The attribution is by timing; there is no heap snapshot of the worker (CDP did not attach to module workers in S3).
- **Anchor:**
  - AREAS budget: peak memory for the whole app is 1.5 GB ("the maintainer's own PC is short of memory").
  - AREAS P1 names an out-of-memory that loses work.
  - S3-P2-3, whose estimate part #1562 and #1565 fixed; its "emission" part was left to S4.
- **Scenario:**
  - A user engraves a phone photo at 100 mm: an everyday photo job. Between Frame and the first line Chrome holds about 3 GB.
  - A user engraves a photo across the bed: one 12 MP photo, 400 × 300 mm. When they press Frame, the PC runs out of free memory within a minute.
- **Evidence:** **REPRO**.
  - **100 mm photo** (507,535 lines):
    - `SM-img100` and `#2` (n=6): Chrome peak **2.5–3.9 GB** (renderer 2.2–3.6 GB) between Start and the first line, and 2.1–3.3 GB during Frame.
    - The timeline (`logs\mem-SMM-img100#2.txt`) climbs 0.97 → 1.63 → 2.21 → 3.11 GB across Frame and Start, and settles at 1.59 GB after Abort and GC (heap 230 MB).
  - **Bed-sized photo** (8.0M lines, 76 MB of G-code). `SM-imgbed`, `#2` and `SMM-imgbed`, `#2` were ended by the watchdog 45–51 s after Frame. Chrome was at 6.2, 6.6, 7.1 and 7.7 GB, and the PC's free memory at 60, 240, 104 and 206 MB.
    - The timeline (`logs\mem-SMM-imgbed#2.txt`) rises from 1.3 GB at Frame to 4.1 GB at +45 s, then **7.3 GB at +50 s** (renderer 7.1 GB). Free memory fell from 3.5 GB to 0.37 GB in 5 s.
    - Frame never finished, so Start, Job Review and the first line were not reached.
  - **375k-line Fill job** (`SM-375k`, `#2`, n=10): Chrome peak 1.9–4.05 GB during Start, rising over successive Start/Abort cycles. PC free memory went down to 617 MB. After GC between cycles: heap 202 MB, Chrome 1.5–1.7 GB.
  - **For contrast:** the background estimate of the same bed photo peaks at **1.19 GB** (`M-img-bed`), and Save G-code at 1.52 GB.
  - **Trend:**
    - 100 mm photo: 1.0.28 3.0–3.5 GB and 1.0.23 2.7–3.2 GB (`ST28/ST23-img100`, `STM28-img100` timeline 3.3 GB).
    - Bed photo: 1.0.28 and 1.0.23 were also stopped by the watchdog, at 7.6–8.4 GB.
    - Not a regression.
  - No crash or "Aw, Snap" was seen. Commit headroom (page file) existed, so Windows would have paged rather than failed.
- **Severity:** **P2**, as S3-P2-3: no crash shown.
  - The 100 mm photo is an ordinary job at about 2 × the budget.
  - The bed photo is a single large engraving that cannot reach Job Review without exhausting a 16 GB PC with 6 GB free.
  - **The coordinator may weigh P1:** this is the out-of-memory condition AREAS names, reached by Frame, the first step of a burn, and the watchdog had to stop it every time.
- **Fix direction** (the G-code must stay byte-identical: hash the emitted program before and after on the photo fixtures):
  - Give Frame and Start the treatment ADR-244 Amendments 1 and 2 gave the estimate. Compute bounds, duration and the canvas plan from columns as the program is emitted, without keeping the text, the render model and the manifest together.
  - Stream the emitted program to the controller and to the recovery archive in chunks, instead of materialising it, hydrating it and fingerprinting it as one string.
  - Until then, refuse to start a preparation whose estimated size would exceed the free-memory budget, and say so (a product decision, with its own ADR).
  - Budget: Frame → first line of the 100 mm photo under 1.5 GB for the whole app. The bed photo must reach Job Review on this PC.
- **Refuter (2026-11-04): CONFIRMED, P2 kept (not P1). The "Where" is corrected for the bed photo.**
  - **What would make it false:** the peak being harness noise or another process, a leak artefact that ordinary use never reaches, or Frame finishing within budget on a different photo.
  - **READ** (main `a96bc8950`):
    - The cited lines hold: `output-preparation-worker-client.ts:85`, `:95` and `:294`; `execution-artifact-canvas.ts:54`; `execution-artifact.ts:193`; `packed-motion-manifest.ts:42`; `job-checkpoint.ts:74`.
    - `required-frame-readiness.ts:18-23`: every Start needs "a Frame recorded for this exact compiled job". Start therefore cannot be reached until Frame's exact program arrives.
    - `frame-trace-flow.ts` (ADR-353, the split Frame): the outline is traced first, and the exact program is finished off the UI thread.
  - **REPRO with my own photo.** A different page-made 4000 × 3000 JPEG, imported and saved by main. At bed size its program is 65 MB, against the auditor's 76 MB. I used my own poller (`PrivatePageCount` of the marked Chrome tree, plus free memory) and a 400 MB free-memory watchdog.
  - **Bed photo, Frame (`H-bed`).**
    - The outline trace completed by +4 s. From then on the window showed "Frame traced — finishing the exact job before Start is authorized — finishing…", with a **Cancel** button and no progress bar.
    - Chrome held 1.0 GB to +18 s, 2.7 GB at +38 s and 3.6 GB at +40 s, then **5.7 GB at +42 s**. Free memory fell from 1.77 GB to **130 MB** in about 2 s, and the watchdog ended the run.
    - Throughout, the main thread answered a probe every 2 s, and its JS heap stayed at **50–65 MB**. So the growth is in the output-preparation worker or in native memory. It is not the window-side hydration and archiving that the "Where" names (that matters for the 100 mm photo and for S4-P2-3).
  - **Same Frame with V8's old space capped at 1.5 GB (`H-bed-cap1536`).**
    - Memory still reached **6.1 GB** at +62 s, and the main thread stopped answering from +55 s.
    - So most of the memory is outside the V8 heaps. A V8 out-of-memory crash is not the likely end. Windows paging is: commit was 23.5 of 37.5 GB.
  - **200 × 150 mm photo (`H-img200`):** Frame completed in about 10 s at a **2.76 GB** peak. From 100 mm (about 1.45 GB) to 200 mm (2.76 GB), memory grows by roughly 0.9 GB per 1.5M lines. The bed photo would need well over the 6 GB this PC has free.
  - **100 mm photo, six Frame/Start/Abort cycles per set (`G-img100`, `#2`):**
    - The first Frame peaked at 1.44–1.45 GB and the first Start at **1.83–1.95 GB**.
    - Later Starts climbed: **2.3–5.4 GB, median 3.3 GB** over the 10 kept. One set ended with 543 MB free.
    - A forced GC afterwards gave a 204 MB heap and 1.18 GB for Chrome. So this is uncollected garbage, not a leak. The peak depends on how many Frame/Start attempts came before, which is why the auditor's 2.5–3.9 GB and my 1.8–5.4 GB differ.
  - **Answers to the coordinator's questions:**
    - *What the user sees:* the "finishing…" status with Cancel, then a PC that slows down as it pages. The watchdog belongs to the harness, not the app. Neither session ever let a run continue, and no run crashed.
    - *Project and autosave:* Frame does not edit the project, and autosave writes only a dirty project (`use-autosave.ts:84,109`). Nothing was at risk in these runs.
    - *Burn:* not affected. The outline trace finished, laser off, before the climb. No program streams, and Start stays disabled until the exact program arrives.
    - *Start:* it cannot be reached for the bed photo. On the 100 mm photo, Start prepares again and peaks higher than Frame. It neither refused nor crashed.
    - *Workaround:* Save G-code of the bed photo works at about 1.5 GB (auditor; 13 s here).
  - **Severity.** AREAS's P1 needs "a crash or out-of-memory that loses work". Neither was shown, no work was at risk, and a Cancel is on screen. P2 fits: a single bed-sized photo needs over 4 × the 1.5 GB budget and cannot reach Job Review on this PC, and repeated attempts at an everyday photo reach 2–3.6 × the budget. **For the coordinator:** this becomes P1 only if a run without a watchdog shows a renderer crash or a hung PC. I did not try that, to protect the shared PC.

### S4-P3-1 — Preview of a photo compiles the raster on the UI thread: a 100 mm photo blocks 203–212 ms, a bed-sized photo 673–737 ms

- **Where:** `src/ui/workspace/draw-raster-preview.ts:192` → `:270` (`buildPreviewCanvas`, 226 ms inclusive at 100 mm) → `src/core/job/compile-job-raster.ts:154` (`compileRasterGroup`, 209 ms) → `src/core/job/raster-luma-decode.ts:40` (`decodeBase64Luma`: the whole 12 MP luma string is decoded again, 147 ms), then the dither (30 ms). Profile `prof-P-img-100-preview-preview-r1.json`.
- **Evidence:** **REPRO.**
  - Bed-sized photo (`M-img-bed`, n=3): blocks **673–737 ms**.
  - 100 mm photo (`M-img-100`, n=4): blocks 203–212 ms. The vector route shows at 249 ms and the burned image at 2.0 s; the image part runs in a worker.
  - Reopening Preview costs 30 ms (cached).
  - **Trend:** 100 mm 203–212 / 1,355–1,374 / 1,229–1,241 ms; bed 673–737 / 2,060–2,127 / 1,808–1,953 ms (main / 1.0.28 / 1.0.23, the `R-` sets for 100 mm). Main is 3–6 × better than both releases.
- **Severity:** **P3.** Large input, 3.4–3.7 × the block budget. 1.05 × at the ordinary size.
- **Fix direction:**
  - Decode the luma once per image (the import already holds it) and reuse it.
  - Or build the preview canvas in the raster preview worker that already renders the image.
  - No output change. Budget: under 200 ms for the bed photo.
- **Refuter (2026-11-04): CONFIRMED, P3 kept.**
  - READ: `draw-raster-preview.ts:195` calls `buildPreviewCanvas` (`:270`) inside the scheduled build. `raster-luma-decode.ts:40` (`decodeBase64Luma`) and `compile-job-raster.ts:154` are unchanged on main.
  - REPRO with my own photo:
    - 100 mm (`I-img100`, n=5): block **200–211 ms** (median 204), ready in 267–283 ms.
    - Bed size (`I-bed`, n=2 kept): block **665–681 ms**. Reopening took 64 ms with no long task.

### S4-P3-2 — Save G-code prepares the whole program again on every Save, even right after the estimate and Preview prepared the same unchanged project: 16.2 s, then 15.5 s, for a bed-sized photo

- **Where:**
  - `src/ui/app/GcodeSaveDialog.tsx:35` (`prebuildGcodeSave` on every open of the dialog) → `src/ui/app/file-actions.ts` → the output-preparation worker. The direct path goes through `save-gcode-emission.ts:139`.
  - Nothing is shared with the preparation-worker result that the estimate and Preview reuse (ADR-598 decision 4).
- **Evidence:** **REPRO.** The second Save of an unchanged project takes about as long as the first:
  - bed photo 16.2 → 15.5 s;
  - SVG 50k 2.8 → 2.6 s;
  - 5,000 rectangles 1.0 → 0.85 s;
  - 100 mm photo 1.17 → 1.08 s;
  - mix 199 → 194 ms, with the UI block both times.

  Preview's second open reuses its route (29–31 ms). The UI stays responsive on the worker path, and the dialog says "Preparing your G-code file…" with Cancel.
  - **Trend:** bed photo 16.2 / 17.8 / 18.4 s. Better than both releases. Not a regression.
- **Severity:** **P3.** A missing reuse. A user saving twice, or saving after looking at Preview, waits the full time again.
- **Fix direction:** keep the last prepared program per immutable project and output options (the transfer already exists for Start) and hand it to Save. The G-code is byte-identical by construction; prove it with the Save hashes above. Budget: an unchanged second Save under 1 s at every size.
- **Refuter (2026-11-04): CONFIRMED, P3 kept.**
  - READ: `GcodeSaveDialog.tsx:35` calls `prebuildGcodeSave` on every open of the dialog, unchanged on main.
  - REPRO, Save then Save again on an unchanged project:
    - 100 mm photo (n=5): **998–1,032 ms, then 918–964 ms**, with no UI block.
    - Bed photo (n=2 kept): **13.5 s, then 13.0–13.8 s**, with blocks of 138–140 ms.
  - Every run of a row gave the same SHA-256, so the output is deterministic and a cached program would be byte-identical.

### S4-P3-3 — The ETA stops the head wherever rapid and feed motion meet, which GRBL 1.1 in laser mode does not: the 200-object mix shows 3 h 05 min where a GRBL model gives 1 h 51 min (+66%)

- **Where:** `src/core/motion-planner/junction.ts:14-15`: "Rapid and feed motion retain the estimator's conservative stop boundary". Any junction between a G0 and a G1 is planned at zero speed. No ADR states it; the rule predates the 2026-07-25 extraction (`d21661f3f`).
- **Anchor:**
  - GRBL 1.1 source (`scratchpad\zz-q6\grbl-src`):
    - `grbl_gcode.c:868-893`: in laser mode, a G0 with axis words is `GC_PARSER_LASER_ISMOTION`, so no `spindle_sync`.
    - `grbl_planner.c:399-449`: the junction speed comes from junction deviation alone.
  - The emitted fill rows go `G1 … S0` → `G0` (collinear) → `G1 … S0`: the Fill rows skip over the circle columns. On GRBL these blend at full speed.
  - AREAS "Machine job time": the estimate is checked against a modelled controller.
- **Evidence:** **READ and model** (`jobtime.mjs`, independent of the app's planner; `jt-*.json`).
  - With the stop rule (`--stop-rapid`), the model reproduces the app's badge on all seven jobs to within 0.0–2.7%:
    - 200 circles 547 s against 548;
    - 200 rectangles 6,907 against 6,908;
    - mix 11,092 against 11,101;
    - 100 mm photo 1,822 against 1,872;
    - SVG 15,207 against 15,207;
    - 5,000 circles 3,634 against 3,642;
    - 5,000 rectangles 7,978 against 7,979.
  - Without the rule (GRBL's behaviour), the mix is **6,680 s** (1 h 51 min, −40%). The 5,000 circles drop 6.6%, the photo 4.1%, the others 0.2–2.2%.
  - Not measured on hardware.
- **Severity:** **P3.** The badge and Job Review overstate the burn time by two-thirds for any Fill layer whose rows hop over other artwork. A user may plan around the wrong time, or split a job that would fit. No burn harm, and no change to the G-code.
- **Fix direction:** for GRBL-family dialects in laser mode, plan a collinear G0 ↔ G1 junction like any other junction. Keep the stop for dialects that do stop. Check one dialect at a time against its firmware source, as in this report. This changes the estimate only, not the burn.
- **For the maintainer (not a fix under the speed rule):** if a supported controller does stop at a mid-row G0, the in-row G0 hops themselves cost about 4,400 s in this job. Emitting `G1 S0` there instead is a burn change (ADR-683 pools).
- **Refuter (2026-11-04): CONFIRMED, P3 kept (not P2).**
  - **What would make it false:** GRBL stopping at a G1 ↔ G0 junction in laser mode, or the app's estimate not using the rule.
  - **READ (app, main):** `junction.ts:10-15` returns 0 for any junction where the motion kind changes, unless both blocks are feed-matched laser motion. The file is unchanged since `8a7794c10`.
  - **READ (GRBL 1.1, gnea/grbl @ `bfb67f0c7963fe3ce4aaf8a97f9009ea5a8db36e`, Q6's pinned copy):**
    - `gcode.c:868-880`: in laser mode, a G0 or G1 with axis words sets `GC_PARSER_LASER_ISMOTION`.
    - `gcode.c:917-929`: `spindle_sync` runs only when that flag is clear.
    - `planner.c:399-449`: the junction speed comes from junction deviation alone, and a collinear junction gets `SOME_LARGE_VALUE`.
    - `doc/markdown/laser_mode.md`: "`M4` does not stop for anything but a spindle state change".
  - **The mix program:** one `M4 S0` (line 17) and one `M5` at the end, with **10,903** collinear `G1 … S0` → `G0` → `G1 … S0` hops inside the rows.
  - **Independent size check.** Stopping and restarting at 100 mm/s with 500 mm/s² costs v/a = 0.2 s. Two of those per hop give 10,903 × 0.4 s ≈ **4,360 s**. The auditor's model gives 11,092 − 6,680 = 4,412 s.
  - **Severity.** AREAS's P2 tests are freezes, multiples of a budget, and regressions. The ETA has no budget, the burn and G-code are unchanged, and the rule is not new (1.0.23's estimate is the same). On the other six jobs the effect is 0.2–6.6%. P3, with the beginner trust issue named for the maintainer.
  - **Caveat for the fix.** With `$32=0` GRBL does sync on S changes. The rule must therefore follow the controller's laser-mode state, which the app now reads (#1567), as well as the dialect.

### S4-P2-3 (raised by the refuter, 2026-11-04) — Once the first line is sent, the window builds the job's recovery archive on the UI thread: an ordinary 100 mm photo blocks 260–334 ms inside the running job, and an Abort pressed then reached the controller 125–504 ms later at 375k lines

- **Where** (main `a96bc8950`):
  - `src/ui/laser/start-job-transmission.ts:90` awaits `laser.startJob`, so the stream is already running.
  - Then `:98-101` (the ADR-337 comment) calls `archiveAcceptedFreshRun` (`:141`), which runs:
    - `start-job-execution-tracking.ts:100` `stageFreshExecutionArtifact` → `execution-artifact.ts:193` `createExecutionArtifact` → `execution-artifact-canvas.ts:31` `archiveCanvasMotionPlan` → `packed-motion-manifest.ts:42` `packMotionManifest`, plus `job-checkpoint.ts:74` `fingerprintGcode`;
    - then `activateAcceptedFreshRun` (`:177`) → `job-checkpoint.ts:95` `createJobCheckpoint`, which fingerprints the program again.
  - Profile `zz-s4r\logs\prof-E-375k-prof-confirm.json` (`segs.cjs`): the in-job block is `stageFreshExecutionArtifact` 123 + 71 ms, of which `packMotionManifest` 59 ms and `fingerprintGcode` 29 ms, then `createJobCheckpoint` 47 ms.
- **Anchor:**
  - AREAS budget: 50 ms for the longest UI block while a job runs ("Abort, status and any window-side streaming share this thread").
  - AREAS P1 names "a UI block that delays Abort … while a job runs".
  - ADR-337 moved the archive after the first byte ("off the path between Start and motion"). It did not move it off the UI thread.
- **Scenario:** a user presses Start job, sees the head start in the wrong place, and presses Abort at once. For about the first second the window does not take the key.
- **Evidence:** **REPRO** (USB GRBL worker route, simulated controller, own driver).
  - **Long tasks that start after the first motion line reached the controller:**

    | Job | Block, median (range) | Sets |
    |---|---|---|
    | 200-object mix | 100 ms (94–113) | `B-mix#2`, n=5 |
    | 100 mm photo | **about 285 ms (260–334)** | `G-img100`, `#2`, n=10 |
    | 375k-line Fill | 275 ms (270–305) | `C-375k`, n=5 |

    In 2 of the 10 Abort cycles at 375k lines, the block was 606–622 ms.
  - **Abort at 375k lines** (`D-375k-abort#3`, `#4`, n=10 kept):
    - Ctrl+. was issued from Node 717–742 ms after the confirm click. The job's first line had reached the controller at 551–676 ms.
    - `0x18` reached the controller **125–504 ms** later (median about 181 ms).
    - The key event is created and handled only when the block ends: from handling to `0x18` took 1–6 ms. As S1-P2-1's refuter found, scripted key events are stamped when they are handled, so I timed the key from the Node clock.
    - The fill head moves at 100 mm/s, so it burns up to about 50 mm more before the stop.
  - The worker route keeps streaming through the block, so the controller is not starved. Only Abort, Pause and status wait.
  - **Calibration:** 38–41 ms before each set. After six 375k Start/Abort cycles it read 43–53 ms, because the app was still busy (the auditor saw 55–68 ms). The PC was quiet before and after each set (`zz-s4r\machine-state.log`).
  - Not measured on 1.0.28 or 1.0.23.
- **Severity:** **P2** (proposed). An ordinary photo job's in-job block is 5–7 × the 50 ms budget.
  - **The coordinator may weigh P1:** this is the case the letter of AREAS's P1 names, and S1-P2-1 was raised for a delayed Abort.
  - Against P1: it happens once per Start, within the first second; the delay is at most 0.5 s, not S1-P2-1's 1.2 s; and the burn's stream itself is unaffected.
- **Fix direction** (no output change: only where the archive is built):
  - Build the execution artifact, packed manifest and fingerprint in the output-preparation worker, which already holds the program. The window side then reuses the worker's fingerprint, as S1-P2-2's fix direction also asks.
  - Or yield in slices under 50 ms.
  - Budget: no long task over 50 ms from the first line on, for the 100 mm photo and the 375k Fill.

## Machine job time

Report only. Any route change is a burn change and goes to the maintainer as a decision.

The model (`jobtime.mjs`) is GRBL 1.1's planner:
- per-axis rate and acceleration from the project's device: 6,000 mm/min, 500 mm/s², junction deviation 0.01 mm;
- a 15-block look-ahead window;
- laser mode: S changes do not stop, M3/M4/M5 changes do;
- the serial link at 115,200 baud 8N1, with character counting and a block received only when a planner slot is free.

The G-code is main's own Save G-code output (`gcode\M-*.gcode`).

| Job | G-code | App ETA | Model (GRBL) | Model with the app's stop rule | Cut | Rapid | Overscan | Other laser-off feed | Serial floor |
|---|---|---|---|---|---|---|---|---|---|
| 200 Line circles | 139 kB, 6,622 lines | 9 m 08 s (548 s) | 536 s | 547 s | 451 s / 11.1 m | 85 s / 5.3 m | — | — | 12 s |
| 200 Fill rectangles | 4.1 MB, 101,382 | 1 h 55 m (6,908 s) | 6,857 s | 6,907 s | 4,524 s / 449 m | 69 s | **473 s (6.9%)** / 17.7 m | **1,791 s (26%)** / 179 m, gaps between pooled shapes | 236 s |
| 200 mixed | 2.1 MB, 54,004 | **3 h 05 m (11,101 s)** | **6,680 s** | 11,092 s | 2,503 s | **2,614 s (39%)** / 258 m, in-row hops over circles | **1,563 s (23%)** / 127 m | — | 124 s |
| 100 mm photo | 4.6 MB, 507,551 | 31 m 12 s (1,872 s) | 1,796 s | 1,822 s | 708 s | 24 s | **200 s (11%)** / 7.5 m | 864 s (white pixels inside rows) | 397 s |
| 5,000 Line circles | 3.5 MB, 165,022 | 1 h 00 m 42 s (3,642 s) | 3,403 s | 3,634 s | 2,499 s | 904 s / 27.2 m | — | — | 300 s |
| 5,000 Fill rectangles | 3.4 MB, 271,408 | 2 h 12 m 59 s (7,979 s) | 7,925 s | 7,978 s | 5,043 s | 255 s | 508 s (6.4%) | 2,119 s | 284 s |
| SVG 50,000 | 6.2 MB, 702,822 | 4 h 13 m 27 s (15,207 s) | 15,174 s | 15,207 s | 9,800 s | 579 s | 612 s (4.0%) | 4,183 s | 531 s |
| Bed-sized photo | 76.3 MB, 8.0M lines | 7 h 24 m 40 s | not modelled (file not kept) | — | — | — | — | — | about 6,600 s |

- **Estimate against the controller:**
  - With the app's stop rule the model matches the badge to 0.0–0.6% on six jobs and 2.7% on the photo, so the estimator is faithful in everything else.
  - The rule itself costs +66% on the mix (S4-P3-3).
- **The serial link is never the limit.** The streamed schedule equals the motion time on every job, and the floor is at most 22% of the job (the photo). About a third of a Fill program's bytes are the inline comment `; kerfdesk:laser-off-motion`, which S1's controller capture shows is sent to the controller (34% of fill-200's file). A further 13% of fill-200's file is zero-length `G0` lines between pooled shapes. Neither costs time at 115,200 baud on these jobs. On faster, shorter rows they would cost bandwidth.
- **Travel against a lower bound** (200 circles; the bound sums, over the shapes, the gap from each shape's motion envelope to the nearest other envelope or the origin):
  - emitted travel **5,183 mm** against a bound of **1,520 mm**;
  - nearest neighbour from the origin 5,632 mm; 2-opt with each shape's emitted start kept 5,214 mm. **The app's order is already the best of the three.**
  - The gap to the bound is the drawn start point: every circle starts and ends at its 0° point. The project's own `closedShapeStart: "nearest"` option (`main-line-200-nearest`, saved by the app) gives **3,851 mm** and 524 s against 536 s (−2.2%; badge 8 m 54 s against 9 m 08 s).
  - 1.0.23's route for the same project was 5,844 mm (547 s): main's order is 11% shorter in travel.
- **Time lost to overscan:** 6.4–6.9% of a Fill job, 4% of the SVG, 11% of the 100 mm photo, and 23% of the mix. In the mix every rectangle gets its own 5 mm runway on both sides, because the row is broken by a G0 over each circle column. In the pure Fill job, pooled shapes share one runway per row and cross 7.6 mm gaps at feed.
- **Time lost to cut order and grouping:** in the mix, 39% of the modelled time is in-row rapids over the circle columns. Whether filling each rectangle separately would be faster depends on the extra row reversals. That is a question for the maintainer (ADR-683 pools), not measured here.
- **Not modelled:** arcs (none were emitted), CNC (Z rates), and the bed photo (its 76 MB file was not kept).
- **Refuter (2026-11-04): CONFIRMED where checked; the rest not re-modelled.**
  - The badge reads "≈ 3h 5m 1s" for the mix in every one of my runs, which is 11,101 s.
  - The stop rule's cost on the mix is confirmed by an independent estimate: 4,360 s against the model's 4,412 s (S4-P3-3).
  - The GRBL laser-mode reading is confirmed against the pinned source.
  - I did not re-run `jobtime.mjs`, the travel bound, the 2-opt tour, the overscan split or the serial floor. They rest on the auditor's model alone.

## Trend

main / 1.0.28 / 1.0.23, run back to back per row. Times are medians; blocks are ranges. G-code: main and 1.0.28 are **byte-identical** on every kept row apart from the provenance header (the bed photo by size only). 1.0.23 is identical on the Fill rows, the photo and the SVG apart from inline comments. Its cut order differs on the Line rows and the mix (the same lines in another order): travel 5,844 against 5,183 mm on 200 circles, and 29.3 against 27.2 m on 5,000 circles.

| Row | Estimate ready | Preview ready; block | Save prepared | Start → Review; block | Verdict |
|---|---|---|---|---|---|
| 200 circles | 447 / 433 / 415 ms | 131 / 131 / 117 ms; 93–96 / 94–97 / 84–88 | 34 / 36 / 26 ms | — | Flat |
| 200 rectangles | 846 / 863 / 880 ms | 31 / 31 / 31 ms; 0 | 480 / 463 / 461 ms | — | Flat |
| 200 mixed | 637 / 644 / 622 ms; block 211–222 / 234–256 / 225–231 | 719 / 751 / 745 ms; 527–557 / 532–542 / 534–537 | 199 / 194 / 183 ms | 641 / 610–628 / 599–617 ms; 565–773 / 557–685 / 540–580 | Flat (S4-P2-1 since 1.0.23) |
| 100 mm photo | **2.0 / 4.9 / 5.0 s** | 2.0 s; **203–212 / 1,355–1,374 / 1,229–1,241** | **1.2 / 3.9 / 3.4 s**; memory 1.17 / 2.90 / 2.81 GB | **3.6 / 6.1–6.2 / 5.9–6.0 s**; 284–778 / 397–613 / 495–605 | **Better** (2–6 ×) |
| CNC 200 | 1.38 / 1.41 / 1.40 s | 31 / 31 / 31 ms | 745 / 746 / 863 ms | — | Flat |
| 5,000 circles | 1.85 / 1.93 / 1.68 s | 175 / 171 / 177 ms; 0 | 679 / 680 / 546 ms | — | Flat (Save 1.24 × since 1.0.23 with a shorter route; inside budget) |
| 5,000 rectangles | 1.61 / 1.72 / 1.70 s | 110 / 113 / 78 ms; 0 | 999 / 960 / 963 ms | — | Flat |
| SVG 50,000 | 5.01 / 5.06 / 5.00 s; Import block 591–616 / 567–589 / 562–573 | 212 / 221 / 221 ms; 89–94 / 96–112 / 98–100 | 2.83 / 2.73 / 2.73 s | — | Flat |
| Bed photo (n=3 / 2 / 2) | **16.2 / 25.2 / 24.7 s; memory 1.19 / 4.26 / 3.58 GB** | 735 ms / 2.13 s / 1.92 s; **673–737 / 2,060–2,127 / 1,808–1,953** | 16.2 / 17.8 / 18.4 s; memory 1.52 / 2.74 / 2.71 GB | Frame never finished in any build (S4-P2-2) | **Better** |
| S1 rings 18,527 lines | — | — | — | 0.34–0.90 s in all three; blocks ≤ 77 / 87 / 80 ms | Flat |
| S1 Fill 374,843 lines | — | — | — | 5.0 / 4.94–4.97 / 4.90–4.95 s; 628–967 / 627–939 / 613–679 | Flat (S1-P2-2) |

No row is 2 × slower than 1.0.23. The only row slower than 1.0.23 beyond noise is Save G-code of 5,000 circles (679 against 546 ms, 1.24 ×, in a worker with no block). Main emits a different, shorter route there (27.2 against 29.3 m of travel; 3,403 against 3,428 s modelled), so the extra preparation buys a shorter burn. It is noted, not raised.

## KNOWN re-observed

- **S1-P2-2** (Start preparation blocks the UI on large jobs; open). Current numbers at 374,843 lines on an idle PC:

  | Stage | Main (n=10) | S1 (idle) |
  |---|---|---|
  | Frame | 4.2–4.6 s, blocks 377–650 ms | 4.3–4.9 s |
  | Start → Job Review | **4.8–5.5 s**, blocks **628–967 ms** and 371–459 ms | 5.0–5.4 s, blocks 641–995 ms |
  | Start job → first line | 0.56–0.77 s | 0.57–0.72 s |

  Unchanged since S1 and the same in 1.0.28 and 1.0.23 (trend table).
  - Profile `start\prof-SP-375k.json`: `handleWorkerMessage` (`output-preparation-worker-client.ts:294`) 682 ms; `runJobReviewGate` 487 ms → `buildJobReviewModel` 454 ms (`planFillSweeps` 331 ms, `analyzeFillHeatRisk` 209 ms); `stageFreshExecutionArtifact` 239 ms; `preparedFrameBounds` 144 ms; `gcodeUsesM7` 122 ms; `fingerprintGcode` 104 ms. These are the same functions as S1's profile.
  - At a 100 mm photo (507k lines): Start → Review 3.6 s, with blocks of 284–778 ms.
  - Not re-checked: the missing progress display and Cancel between Start and Job Review (S1's refuter read it from the DOM).
  - **Refuter (2026-11-04): CONFIRMED.** Own driver, `C-375k`, n=5 kept of 6, idle PC:

    | Stage | Median (range) |
    |---|---|
    | Frame | 4.20–4.42 s, block 404–425 ms |
    | Start → Job Review | **4.91 s** (4.80–5.19) |
    | Start blocks | **692 ms** (647–961) |
    | Start job → first line | 629 ms (582–648) |

    - The `D-` sets give Start → Review of 4.74–5.23 s.
    - **New detail.** At 375k lines the Frame block lands 3.66–4.00 s after the click, well after the Frame's first motion line (0.75–0.83 s). On a real machine the outline trace is still running then, so a Stop pressed during it waits up to 0.4 s. That belongs to this finding's fix.
    - The block after the first line of the job is S4-P2-3.
- **S2-P3-1** (the estimate on the UI thread after Open of a small Fill design): 211–222 ms on the 200-object mix (`recomputeEstimate`, `use-job-estimate.ts:351`, 229 ms). It is part of S4-P2-1's family, not re-raised.
- **S3-P3-2** (large vector results block the UI on arrival): Import of the SVG blocks 591–616 ms (S3: 801–863 ms); Open of 5,000 circles 258–265 ms.
- **S3-P2-3** (memory while photo jobs are prepared). The estimate part is fixed:
  - the bed photo's background preparation peaks at 1.19 GB (1.0.28 4.26 GB, 1.0.23 3.58 GB) and finishes in 16.2 s;
  - Save G-code peaks at 1.52 GB.

  The emission part remains, at Frame and Start, as S4-P2-2.
- **S1-P3-1** (renderer memory per G-code line): after GC between Start/Abort cycles, the 375k job holds heap 202 MB and Chrome 1.5–1.7 GB, as S1 found (199–202 MB).

**Merged fixes verified:**
- **#1548 (S1-P2-1).** Preview during a 375k-line job blocks 0–59 ms, with the controller starved at most 7 ms. Abort inside Preview reaches the controller 1–6 ms after the key (input → first `0x18`, n=6; S1: 1,223–1,357 ms). Large-job Preview opens in 110–221 ms with no block.
- **#1551 (Fill pools planned once).** The 5,000-rectangle Preview opens in 110 ms with no long task, and the canvas meets the response budget (this area measured Preview and compile, not drag).
- **#1562 and #1565 (ETA plans from totals and columns).** See S3-P2-3 above.
- **Refuter (2026-11-04):**
  - **#1562 and #1565:** partly re-checked. My bed photo's badge appeared 13.9–16.4 s after Open, in line with the auditor's 16.2 s. Its memory was not measured separately.
  - **#1548 and #1551:** not re-measured.
  - **S2-P3-1, S3-P3-2 and S3-P2-3's estimate part:** not re-measured.
  - **S1-P3-1:** consistent. After six 375k Start/Abort cycles and a forced GC the heap was 204–256 MB.

## Refuted

- **"Preview and Save of the 100 mm photo freeze 1.0.28 for 1.7–4.0 s and take 5.9 s."** These came from sets taken while five other sessions started (calibration 43–114 ms). The re-run `R-` sets give 1.36 s and 3.9 s. 1.0.28 is still much slower than main, but the first numbers were inflated.
- **"The CNC estimate takes 2.2–3.2 s and Save G-code 1.7 s on main."** These were measured during other sessions' `vitest` and `tsc` runs. On a quiet PC (`R-M-cnc-200`) the figures are 1.38 s and 0.75 s.
- **"Start → Job Review regressed to 850 ms at 18,527 lines."** It is bimodal in every build: 337–390 ms or 830–900 ms. The 850 ms mode appears in main, 1.0.28 and 1.0.23 alike.
- **"The 50,000-path SVG compiles to different G-code each time (a speed or determinism defect)."** The five runs' files differ in byte order but hold the same multiset of lines, with identical cut, rapid and overscan distances and the same modelled time. Shapes of equal cost are ordered differently between imports (fresh object ids). It is not a speed issue. It is noted for the maintainer: two imports of the same file can burn the same shapes in a different order.
- **"The app's estimator is generally optimistic or pessimistic."** With its one stop rule modelled, an independent GRBL model reproduces it to 0.0–0.6% on six of seven jobs (S4-P3-3 is that rule alone).
- **Refuter (2026-11-04), sub-claims corrected:**
  - **S4-P2-2's attribution for the bed photo.** The climb to 5.7–6.1 GB happens while the main thread's JS heap stays at 50–65 MB and the main thread keeps answering. So it is not "hydrated and archived on the window side". It is in the preparation worker or native memory, and mostly outside the V8 heap: a 1.5 GB old-space cap did not stop it. The window-side path does matter for the 100 mm photo (0.5–1.5 GB of uncollected main-thread heap after each Start) and for S4-P2-3.
  - **S4-P2-1's "the Frame-then-Start path blocks about 1.1 s".** These are two separate tasks, seconds apart, with Frame motion between them. The Frame block on this design also ends before the head moves.
  - **S4-P2-2's "2.5–3.9 GB for an everyday photo".** That depends on the attempt count. The first Frame → Start of a session peaked at 1.83–1.95 GB. Repeated Start/Abort cycles reached 2.3–5.4 GB of collectable garbage, which a forced GC brought back to 1.18 GB.

## Verified clean

- **Large vector jobs** (5,000 circles, 5,000 rectangles, 50,000 paths): the estimate is in a worker, Preview takes 110–221 ms, and Save G-code 0.7–2.9 s with no block over 94 ms.
- **Preview reuse:** for every worker-class job, reopening Preview on an unchanged project takes 29–31 ms (ADR-598 decision 4 and the preparation result cache). It does **not** hold for direct-class jobs (S4-P2-1).
- **The 200-object Fill-only job** (101k lines) is handled entirely in the worker: no block over 0 ms in Open, Preview or Save.
- **Ordinary CNC pocket and profile:** estimate 1.38 s in a worker, Preview 31 ms, Save 0.75 s (block 95–100 ms).
- **Start at 18,527 lines:** blocks of 77 ms at most; first line 104 ms after Start job.
- **G-code identity:** main's G-code is byte-identical to 1.0.28's apart from the provenance header on the eight rows whose files were kept (`gcode-cmp.mjs`; CNC by the `R-` files). The bed photo was compared by size only: 76,348,000 against 76,347,993 bytes, the header's 7-byte difference. Nothing in this report rests on a burn difference.
- **Serial throughput:** at 115,200 baud the link is never the limit on these jobs (model).
- **Refuter (2026-11-04), G-code identity: CONFIRMED** on the kept files (`line-200`, `mix-200`, `fill-200`, `img-100`, `cnc-200`).
  - Main against 1.0.28: after the 12-line header, the only differences are, for `img-100`, the `; image layer operation-<uuid>` comment. Each build's own import mints that id, so it is not part of the burn.
  - 1.0.23: the same lines (sorted, inline comments stripped) and the same line counts. The order differs on `line-200` and `mix-200`, and the inline comments differ on the Fill rows.
  - My own `mix-200` Save is byte-identical to the auditor's main file.
  - My own photo projects saved the same SHA-256 on every run: `bad8b1690330e01c…` at 100 mm and `07d8fa95a3f5eda7…` at bed size.

## Not verified

- **The packaged desktop app.** Every number is Chrome 156 in a browser build.
- **Start, Job Review and the first line of the bed-sized photo.** Frame never finished before the watchdog (S4-P2-2). How much memory it would finally need is unknown.
- **What exactly holds the 7 GB.** The attribution to the output-preparation path is by timing; there is no worker heap snapshot.
- **The ETA rule on real controllers** (S4-P3-3) is from GRBL 1.1 source and a model, not hardware. grblHAL, FluidNC and Marlin were not checked.
- **Arcs and CNC time** were not modelled. The CNC row covers compile time only.
- **The Start route on the window fallback and on Marlin**: only the USB GRBL worker route was run.
- **The progress display or Cancel during Start preparation** (S1-P2-2) was not re-read from the DOM.
- **A fill-per-shape alternative** for the mix's in-row rapids: no such option was found to compile.

## Re-running

From `scratchpad\zz-s4`. Hosts first: `node host.mjs dist-main 4811`, plus `../zz-s1/dist-33bc394c6 4812` and `../zz-s1/dist-87ecb4f24 4813`; then `cd start && node host.mjs ../dist-main 4814`, and the same for 4815 and 4816.

- **Projects:**
  - `node gen.mjs ../j7-main projects/main-mix-200.lf2 '{"scene":"mix","n":200}'`, the same with `line`, `fill`, `cnc` and `n` 5000, and with `../zz-s2-old/<sha>` for each release.
  - Photos: `node run.mjs '{"base":"http://127.0.0.1:4811/","label":"mk","op":"mkimg","outFile":"main-img-raw.lf2","runs":1}'`, then `node mk-img.mjs main`.
  - SVG: `node mk-svg.mjs`.
- **Rows:** see `q1.txt`, `q2.txt` and `batch-a.sh`.
  - Flow example: `./runset.sh '{"base":"http://127.0.0.1:4811/","label":"X-mix","op":"flow","file":"main-mix-200.lf2","n":200,"runs":6,"keepGcode":true}'`, then `node analyze.mjs results.jsonl '^X-'`.
- **S4-P2-1:** the line above, plus `"profile":"preview"` and `node map-profile.cjs prof-X-mix-preview-r1.json dist-main 15`. Start: the `SM-mix200` line of `q1.txt`, then `node start-summary.cjs mix200`.
- **S4-P2-2:** the `SMM-` lines of `q3.txt` (`"memLog":true`) write `logs\mem-<label>.txt`. **Mind the PC:** the bed photo drove free memory to 60 MB; keep the watchdog (`freeFloorMb`).
- **Machine job time:** `node jobtime.mjs gcode/M-mix-200.gcode projects/main-mix-200.lf2`, and again with `--stop-rapid`. `STRIP_INLINE=1 node gcode-cmp.mjs line-200 mix-200 img-100` for the G-code comparison.

## Ranked list — what an ordinary user meets, by how often

1. **Every Preview, Frame and Start of an everyday mixed design** (S4-P2-1): 0.5–0.8 s freezes, three or more times per job.
2. **Every Start of a photo engraving** (S4-P2-2): 2.5–3.9 GB at 100 mm. At bed size the PC runs out of memory at Frame.
3. **A job with Fill rows hopping over other artwork** (S4-P3-3): the ETA is two-thirds too long.
4. **Start of large jobs** (S1-P2-2, KNOWN): about 5 s to Job Review with 0.6–1.0 s freezes.
5. **Saving G-code twice, or after Preview** (S4-P3-2): the full preparation again, up to 16 s for a bed photo.
6. **Previewing a large photo** (S4-P3-1): a 0.7 s freeze, though 3 × better than 1.0.28.

**Refuter (2026-11-04):** insert **S4-P2-3** after item 2. Every Start of a photo or large Fill job has a 0.26–0.33 s window, right after the first line, where Abort waits. Item 1 is now P3, but it stays first by frequency.

**Single biggest speed win in this area:** one prepared output per unchanged project, built off the UI thread and shared by Preview, ETA, Frame, Start and Save (S4-P2-1 with S4-P3-2). It removes five separate UI-thread compiles of everyday jobs (about 1.7 s of freezes per Preview → Frame → Start round at 200 objects) and every repeat preparation, with byte-identical G-code by construction.

## Guard proposal

Counts and ratios, not milliseconds:

1. **Direct-path budget** (unit): `classifyCanvasPreparation` must send the S4 `mix-200` fixture to the worker, or the direct compile must run in under N emitted lines (a count, not time).
2. **Reuse** (unit, spy): Preview off/on and Save twice on an unchanged project must call `emitPreparedGcode` once in total.
3. **Frame memory** (nightly, this harness): Frame → first line of the 100 mm photo must stay under 2 GB of Chrome private memory; the bed photo must reach Job Review with at least 1 GB free.
4. **ETA rule** (unit): a collinear `G1 S0` → `G0` → `G1 S0` sweep on a GRBL laser profile plans no zero-speed junction, while a stop-dialect fixture keeps one.

```json
{
  "area": "S4-compile-preview",
  "tree": "c47579cb4",
  "tree_moved_to": "a96bc8950 (no cited compute file changed)",
  "counts": { "raised": 6, "raised_by_refuter": 1, "refuted": 0, "P1": 0, "P2": 2, "P3": 4, "known": 5 },
  "refuter": { "date": "2026-11-04", "tree": "a96bc8950 (no cited compute file changed since c47579cb4)", "confirmed": ["S4-P2-2", "S4-P3-1", "S4-P3-2", "S4-P3-3"], "severity_changes": ["S4-P2-1 P2 -> P3 (medians 2.4-2.9x the 200 ms budget: Preview 527, reopen 478, Frame 497, Start 574 ms)"], "refuted": [], "new": ["S4-P2-3 (P2 proposed; coordinator may weigh P1)"], "corrected": ["S4-P2-2 bed-photo memory is in the worker/native memory, not window-side hydration (main heap 50-65 MB during the climb)", "S4-P2-1 Frame+Start 1.1 s is two separate blocks", "S4-P2-2 100 mm photo: first Start 1.83-1.95 GB; 2.3-5.4 GB only after repeated Start/Abort (collectable garbage)"], "s1_p2_2": { "frame_s": "4.20-4.42", "start_to_review_s": "4.91 (4.80-5.19)", "start_blocks_ms": "692 (647-961)", "first_line_ms": "629 (582-648)" } },
  "budgets": { "response_ms": 100, "design_block_ms": 200, "job_block_ms": 50, "memory_gb": 1.5, "ordinary_size_result": "200-object mixed design blocks 0.53-0.56 s on Preview and every reopen, 0.49-0.55 s on Frame, 0.57-0.77 s on Start (S4-P2-1); 100 mm photo Start 2.5-3.9 GB (S4-P2-2); large vector jobs clean" },
  "s1_p2_2_now": { "lines": 374843, "frame_s": "4.2-4.6", "start_to_review_s": "4.8-5.5", "blocks_ms": "628-967 and 371-459", "confirm_to_first_line_s": "0.56-0.77", "same_in": ["1.0.28", "1.0.23"] },
  "fixes_verified": ["#1548 S1-P2-1: Preview during 375k job blocks 0-59 ms, Abort 1-6 ms", "#1562/#1565: bed photo ETA 1.19 GB (1.0.28 4.26 GB), 16.2 s", "#1551: 5,000-rectangle Preview 110 ms, no block"],
  "findings": [
    { "id": "S4-P2-1", "severity": "P3", "severity_auditor": "P2", "evidence": "REPRO", "file": "src/ui/workspace/canvas-preparation-policy.ts", "line": 28, "known": false, "regression": "none (same in 1.0.28 and 1.0.23)", "title": "Everyday jobs under the 20,000-unit direct threshold compile on the UI thread separately for Preview, Frame, Start, ETA and Save: 200-object mix blocks Preview 527-557 ms (every reopen 469-539), Frame 494-546, Start 565-773, Open 211-222, Save 185-194" },
    { "id": "S4-P2-2", "severity": "P2", "evidence": "REPRO", "file": "src/ui/laser/output-preparation-worker-client.ts", "line": 95, "known": false, "regression": "none (1.0.28/1.0.23 same or worse)", "title": "Frame/Start prepare photo jobs with no memory bound: 100 mm photo Chrome 2.5-3.9 GB; bed photo Frame drove the renderer past 6.2-7.7 GB and PC free memory to 60-365 MB in 4 of 4 runs without finishing; 375k fill 1.9-4.05 GB (coordinator may weigh P1)" },
    { "id": "S4-P3-1", "severity": "P3", "evidence": "REPRO", "file": "src/ui/workspace/draw-raster-preview.ts", "line": 270, "known": false, "regression": "improved (1.0.28 3-6x slower)", "title": "Photo Preview compiles the raster on the UI thread: 100 mm 203-212 ms, bed-sized 673-737 ms" },
    { "id": "S4-P3-2", "severity": "P3", "evidence": "REPRO", "file": "src/ui/app/GcodeSaveDialog.tsx", "line": 35, "known": false, "regression": "none", "title": "Save G-code re-prepares the whole program every time, even after ETA/Preview of the unchanged project: bed photo 16.2 then 15.5 s" },
    { "id": "S4-P3-3", "severity": "P3", "evidence": "READ+MODEL", "file": "src/core/motion-planner/junction.ts", "line": 14, "known": false, "regression": "none", "title": "ETA stops at every rapid/feed junction, which GRBL 1.1 laser mode does not: 200-object mix ETA 3 h 05 min against 1 h 51 min modelled (+66%); with the rule the model matches the app to 0.0-2.7% on all seven jobs" },
    { "id": "S4-P2-3", "severity": "P2", "raised_by": "refuter", "evidence": "REPRO", "file": "src/ui/laser/start-job-transmission.ts", "line": 101, "known": false, "regression": "not measured", "title": "After the first line is sent, the recovery archive (stageFreshExecutionArtifact, packMotionManifest, fingerprintGcode, createJobCheckpoint) is built on the UI thread: in-job block 94-113 ms (200-object mix), 260-334 ms (100 mm photo), 270-305 ms (375k fill, once 606-622); Abort issued then reached the controller 125-504 ms later at 375k (coordinator may weigh P1)" }
  ],
  "known_reobserved": ["S1-P2-2 (Start preparation, 375k: Review 4.8-5.5 s, blocks 628-967 ms)", "S2-P3-1 (ETA block after Open, 211-222 ms)", "S3-P3-2 (SVG Import 591-616 ms; Open 5,000 circles 258-265 ms)", "S3-P2-3 (estimate part fixed: 1.19 GB; emission part = S4-P2-2)", "S1-P3-1 (heap 202 MB after GC at 375k)"],
  "machine_job_time": { "eta_vs_model_with_rule_pct": "0.0-2.7", "mix_eta_s": 11101, "mix_model_s": 6680, "line200_travel_mm": 5183, "line200_travel_lower_bound_mm": 1520, "line200_nearest_start_travel_mm": 3851, "overscan_share": "4-7% fill/SVG, 11% photo, 23% mix", "serial_limit": "never" },
  "biggest_win": "One prepared output per unchanged project, built off the UI thread and shared by Preview, ETA, Frame, Start and Save"
}
```

## Refuter summary

**Refuter:** fresh session, 2026-11-04, 04:00–04:50 +0800. Tree: origin/main @ `a96bc8950`.

**Result:** 5 auditor findings re-checked: 4 CONFIRMED, 1 SEVERITY CHANGE, 0 REFUTED. One new P2 raised. Three sub-claims corrected (`## Refuted`).

| ID | Auditor | Refuter | Key numbers (refuter, median and range) |
|---|---|---|---|
| S4-P2-1 | P2 | **P3** | Preview 527 (517–539) ms; reopen 478 (468–485); Frame 497 (448–529); Start 574 (549–619); Save 185. Every median is 2.4–2.9 × the 200 ms budget, under the 3 × P2 line. |
| S4-P2-2 | P2 | **P2, not P1** | Bed photo Frame: 5.7–6.1 GB, free memory down to 130 MB about 42 s after the click (also with V8 capped at 1.5 GB). A Cancel is on screen; no crash, no lost work, no burn. 100 mm photo: first Start 1.83–1.95 GB, repeated Start/Abort 2.3–5.4 GB of garbage (1.18 GB after GC). |
| S4-P3-1 | P3 | P3 | 100 mm 200–211 ms; bed 665–681 ms |
| S4-P3-2 | P3 | P3 | 100 mm 1.0 s → 0.93 s; bed 13.5 s → 13.0–13.8 s; same SHA every run |
| S4-P3-3 | P3 | P3 | GRBL 1.1 @ `bfb67f0`: an M4 G0 with axis words blends, with no stop. 10,903 in-row hops × 0.4 s ≈ 4,360 s, against the model's 4,412 s. No budget, no burn change, not a regression, so not P2. |
| **S4-P2-3 (new)** | — | **P2** (coordinator may weigh P1) | In-job UI block after the first line: mix 100 ms, 100 mm photo about 285 ms (260–334), 375k Fill 275 ms (606–622 twice). Abort at 375k reached the controller 125–504 ms after the key (median about 181). |
| S1-P2-2 (KNOWN) | P2 | confirmed | 375k: Start → Review 4.91 s (4.80–5.19), blocks 692 ms (647–961), first line 629 ms; the Frame block lands during the outline trace. |

**What changes for the ledger:**
- S4 is now 6 raised, 0 refuted: P1 0 / P2 2 (S4-P2-2, S4-P2-3) / P3 4.
- The single biggest win is unchanged: one prepared output, built off the UI thread.
- S4-P2-3 and S1-P2-2 share one fix: build the Job Review model, the execution archive and the fingerprint in the worker that already holds the program.

**Method.**
- Harness: own driver and probes in `scratchpad\zz-s4r\`:
  - `r.mjs` (flow, start, bedframe and mkimg ops);
  - `probe.js` (long tasks, frame gaps, keydown stamps, pickers, its own synthetic photo);
  - `mempoll.ps1` (Chrome-tree `PrivatePageCount` and the PC's free memory);
  - `host.mjs` (port 4891);
  - `gate.sh` (two quiet checks 15 s apart before every set);
  - `mapwin.cjs` and `segs.cjs` (profile attribution);
  - `mk.cjs` (photo projects).
- Reused from the auditor: the `dist-main` bundle (`c47579cb4`; no compute file differs on `a96bc8950`), S1's simulated GRBL (`sim-core.js` and the fake serial port; infrastructure only), and the input projects `main-mix-200` and `main-375k`. The photos are the refuter's own.
- **Machine state** (`zz-s4r\machine-state.log`): 5.4–6.2 GB free and CPU 0–27% before and after every set. No other session's vitest, eslint, tsc, vite build or Playwright ran, and no other Chrome was open.
- **Calibration:**
  - flow sets: 36–41 ms before and after;
  - Start sets: 38–41 ms before. After them it read 43–53 ms, because the app was still busy after six Start/Abort cycles, as the auditor also saw. Results agreed across repeated sets.
- **Runs:** the first run or cycle of each set dropped. Bed-photo flow n=2 kept, and the photo-memory runs are single watched Frames (watchdog 400–500 MB free).
- **Not done:**
  - no run without a watchdog (to protect the shared PC);
  - no release trend for S4-P2-3;
  - no re-run of `jobtime.mjs`, #1548 or #1551.
- **Clean-up:** the photo and 375k projects (about 96 MB) were deleted. Scripts, `results.jsonl`, memory timelines, the confirm profile and `gcode\A-mix.gcode` are kept. All processes the refuter started were stopped.
