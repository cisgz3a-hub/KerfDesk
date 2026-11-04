# Performance audit S1 — S6 Geometry commands

- **When:** 2026-11-04 18:22 – 2026-11-05 02:15 +0800.
- **Tree:** origin/main @ `45cbf63f9` (worktree `claude/performance-audit-s4`, HEAD `9217c8936`, docs only).
  - **`j7-main` refreshed.** Every file under `src`, `public`, `scripts`, `electron` and the root build files was hash-checked against `origin/main` with `git hash-object --no-filters`. 209 differed (#1572, #1574–#1576 and others since S5) and were rewritten with `MSYS_NO_PATHCONV=1 git show origin/main:<path>`, then hash-checked again: all equal. The only extra files are 12 old `zz-j7-*` test files, which nothing imports (`zz-s6\stale.txt`, `zz-s6\extra.txt`).
  - **Browser rows, main:** `zz-s6\dist-main`, built from `j7-main` with `vite build --sourcemap hidden` and `zz-s6\zz-s6-vite.config.mts` (S4's config, kept in the harness). Every S6 command is in the Free web build (`pro-features.ts` names none of them), so no desktop-mode build was needed.
  - **Engine rows (Node):** `build6.mjs` bundles the core geometry entry points of each tree with esbuild 0.28.1, as `scripts/trace-bench.mjs` does: `offsetShapes`, `combineVectorObjects`, `offsetVectorObjects`, `weldVectorObjects`, `prepareWeldSelection` / `finishWeldSelection`, `describeWeldChange`, `planOptimizeShapes` / `startOptimizeShapes`, `objectGeometryExtent`, `searchNestLayouts`. 1.0.23 has no `vector-path-nesting.ts` (ADR-410 Amd 3, #1501) and no `object-extent.ts` (ADR-677).
  - **Trend:** 1.0.28 (`33bc394c6`) and 1.0.23 (`87ecb4f24`): S1's `dist-33bc394c6` and `dist-87ecb4f24` in the browser, and the `src` trees in `scratchpad\zz-s2-old\` for the engine bundles. Each build opened a project written by its own `serializeProject` (`gen6.mjs`).
- **Machine state:** i7-1260P (12 cores, 16 threads), 16 GB, Iris Xe; Chrome 156 (installed, headless); Node 25.8.2. `zz-s6\machine-state.log` holds every set's free memory, load, waits and notes; `zz-s6\sampler.log` a line every 30 s (408 lines).
  - **18:22–21:57: no other audit agent, test tooling or measuring harness.** The whole engine plan and every main browser set ran then. Two single samples (20:13, 20:36) saw a second Chrome root for under 30 s; `run6.mjs`'s per-run gate would have held a run that met it.
  - **From about 21:58 another session (the Image Studio fix session) shared the PC:** extra Chrome roots (22:00–22:17), test tooling (22:13–22:26), free memory down to 465 MB (22:28), its measuring harness `run5-zz-mine.mjs` with its own Chrome and hosts on 4871–4872 (22:33–23:32, in batches), a `vitest` benchmark (23:42–23:52), more tooling at 01:00–01:10, and its hosts left idle between batches.
    - The 1.0.28 sets that ran 21:58–22:45 (Align, Array, node edits, turned circles, Subtract) are flagged; Align was re-run at 01:55–02:01 (still at calibration 39–54 ms, flagged).
    - `T23-off-r100` (22:59–23:03) overlapped its harness and is not used. I stopped my own waiting `T23-weld-ov2000` and re-ran it at 01:15.
    - The gate gained a check for another session's static host (22:58–00:15). Because that session then left its hosts idle for long stretches, the check was dropped again at 00:15 and the free-memory floor lowered to 2.5 GB; harness, Chrome, tooling and load checks stayed, and calibration decided what was kept.
  - **OneDrive.Sync.Service held about one core** (98% of one CPU at 21:21), so the PC idled at 20–45% load. As S5's refuter did, the gate's CPU limit was 45%, and calibration decided what was kept. From about 21:05 browser calibration sat at 42–55 ms even with nothing else running; those runs are flagged.
  - **Gate:** `gate.ps1` (no other tooling, harness or Chrome; load < 45%; ≥ 3 GB free, 2.5 GB after 00:15) had to pass three times 20 s apart before each set (`qe.sh`, `qb.sh`), and `run6.mjs` checks it again before each run (waiting up to 6 h). Waits of 90–2,989 s are logged.
  - **Calibration:** S1's 40M-step loop, before and after every engine set and every browser run. Engine sets start at 36–45 ms; long sets end at 42–102 ms on an idle PC (the laptop's clock falls under sustained single-thread load, as S5 found). The engine trees alternate round by round in one process, so **engine results are quoted as ratios between versions**; absolute engine times in a set whose calibration rose can read up to about 1.5 × high. Browser runs are kept when both calibrations are ≤ 41 ms (15% over the 36 ms idle floor) unless a row says otherwise.
  - **Two incidents, both mine, both discarded:**
    - 18:30–18:34 a duplicate copy of the engine queue ran beside the first. The two `offset rings50` sets it overlapped (18:33:42–52) are discarded (`discard-sets.json`) and were re-run at 11:48 UTC. No other set overlapped.
    - 18:51–19:20 the engine queue was paused for browser smoke tests (`smoke.jsonl`, not data).
  - Free memory stayed at 2.1–6.1 GB during my sets. The sampler's lowest readings were 555 MB at 18:24 (main building, before any measurement) and 465 MB at 22:28 (the other session, while my queue waited).
  - **Memory figures:** browser rows are the private bytes of the measuring Chrome (S4's `mem-poll.ps1`), so they include the vector and nesting workers. Engine rows give the process `maxRSS` per set.
- **Temp files:** none in the repo except this report. Kept for the refuter in `scratchpad\zz-s6\`: scripts, `out\gb6.jsonl`, `results.jsonl`, `smoke.jsonl`, `machine-state.log`, `sampler.log`, `logs\`, the CPU profiles, and `dist-main` with hidden maps. Deleted to save disk (remade by "Re-running"): the generated projects (`projects\`, about 400 MB) and the engine bundles.
- **Scope** (AREAS S6, ordinary size then large):
  1. **Offset Shapes:** a 20-shape design; 100 and 300 concentric separate rings (N3-P3-1). Also Outer shapes only and the Offset outlines row.
  2. **Weld and Combine Shapes** (Subtract, Intersect, Exclude) on 50 and 2,000 shapes, with 200 / 500 / 1,000 for scaling; **Optimize Shapes** on 50 and 2,000 traced-looking outlines and one 5,000-node path.
  3. **Node edits** on a 5,000-node path: pick, drag 20 moves, insert (I), delete (D), Undo.
  4. **Align, distribute** (20 and 2,000 objects), **Array** (grid 3 × 3 and 6 × 7, circular 40, of 50 parts), **Quick Nest** (50 and 32 parts, Outline method with "Try more arrangements"; 500 parts), plus `scripts/benchmark-quantity-nesting.mjs` and `scripts/performance-audit/nesting-probe.mjs`.
  5. **Tight bounds** (ADR-677) on 5,000 objects turned 30°, against the same 5,000 unturned.
  6. For each: time to result, longest UI block, peak memory, and whether a progress indicator or Cancel exists past 200 ms. Trend against 1.0.28 and 1.0.23, with the outputs compared by hash before any speed comparison.
- **Counts:** 4 raised by the auditor + 1 raised by the refuter → **P1 0 / P2 2 / P3 3** (+ 4 KNOWN re-observed: N3-P3-1, S2-P3-1, S2-P2-1 / S2-P3-3, and the idle canvas-motion reply). Auditor refuted 6 leads.
  - **Refuter (2026-11-05):** 4 confirmed, 0 refuted, 0 severity changes, 1 new (**S6-P2-2**, the Array dialog bug, raised from "Also noticed"). S6-P2-1's fix prototype is corrected: it is not output-identical in every case, though the burn cannot change.

## Headline

**At ordinary size every geometry command is clean.** On a 20-shape design, or 50 shapes or parts:
- Offset Shapes previews in 60 ms; Weld, Subtract and Exclude in 47–98 ms; Optimize Shapes in 388 ms, with a percentage while it works.
- Align, distribute and Undo show in 12–31 ms. An array of 450 copies takes 73 ms. Quick Nest of 50 parts tries 24 arrangements in 47–63 ms.
- Node edits on a 5,000-node path never block: each drag step shows within two frames (33 ms), and pick, insert (I) and Undo show in 10–28 ms; delete (D) leaves no long task.
- No ordinary operation has a long task. Every result is byte-identical in main, 1.0.28 and 1.0.23 except where ADR-410 Amendment 3 deliberately changed Offset's output.

**One P2 and three P3.**
- **S6-P2-1. The Combine Shapes dialog freezes the window for 5.2 s after the worker has finished a Weld of 2,000 shapes.** It checks which shapes the weld absorbs with clipper on the UI thread, one difference per neighbour against a growing remainder (5.9 s of the 6.3 s profiled). With a plate under 1,999 overlapping circles the dialog shows its result 5.7 s after the click, with one 5,153–5,378 ms task, and "Updating preview…" and Cancel frozen. The same check costs 23 ms at 50 shapes, 0.4 s at 500 and 1.1 s at 1,000. It is the same in 1.0.28 (block 4.9–5.1 s) and 1.0.23 (6.0–6.3 s). ADR-609 says the work left on the UI thread does not scale with clipper's work. One difference against all covering shapes at once gives identical decisions in 0.34–0.38 s (prototype); moving the check into the worker removes the block.
- **S6-P3-1. Outer shapes only pays N3-P3-1's depth search, although its output is unchanged since 1.0.23.** 100 concentric rings take 443 ms against 67 ms (6.6 ×), and 300 rings 2.8 s against 0.33 s (8.0 ×), byte-identical.
- **S6-P3-2. Exclude combines one shape at a time, so its cost grows with the square of the selection.** 200 shapes 0.31 s, 500 shapes 2.5 s, 2,000 shapes 55 s, in the worker. Cancel closes the dialog in 13–28 ms. Same in all three builds.
- **S6-P3-3. The before/after preview in Optimize Shapes and Combine Shapes rebuilds every selected outline on the UI thread when the dialog opens.** On 2,000 traced outlines Optimize Shapes opens with a 262–328 ms block (`VectorComparisonPreview`'s `previewGeometry`, 219 ms of it), and Chrome peaks at 1.5–1.6 GB. The optimizing itself is sliced and shows a percentage (4.3 s in all).
- **Commands that rewrite 2,000 objects** (Array 6 × 7 or circular 40, Align) respond in 116–280 ms with blocks of 98–250 ms. The Array commit itself is 56 ms; most of the block is the post-edit job preparation on the UI thread (`prepareOutput`'s route ordering, 160–187 ms), which is S2-P3-1 (KNOWN). Same in 1.0.28.

**N3-P3-1, re-measured (KNOWN).** Offset Shapes of concentric separate rings, in the worker:
- 25 / 50 / 100 / 300 rings: **69 ms / 184 ms / 1.50 s / 31.4 s** (Node), and **1.15 s and 29.2 s** in the browser.
- 1.0.23 (before #1501): 8 / 13 / 43 / 305 ms, with the old, wrong output. 1.0.28 already had #1501 and measures the same as main (0.98–1.04 ×).
- The app never freezes: no task over 62 ms, and the dialog says "Updating preview…" with Cancel. N3 measured 6.6–10 s and 301 s inside Vitest; a bundled build runs the same code about 4–10 × faster, but the growth (about n³) is the same.

**Tight bounds (ADR-677) cost nothing measurable.** Measuring 5,000 turned outlines takes 4 ms (Node). In the app, 5,000 turned and 5,000 unturned circles select, turn, nudge and drag at the same speed. Those 5,000-object interactions are slow in every build, but they belong to S2 (see KNOWN re-observed).

**Also noticed (not speed, for the coordinator).** The Array dialog cannot create a grid when the selection's total height or width has a non-zero second decimal. Its Total fields show `toFixed(2)` in a number input with `step=0.1`, so the browser's own validation refuses the form and "Create array" does nothing. This holds in 1.0.28 and 1.0.23. Details are under Not verified. *Refuter: reproduced for nearly any selection that is not whole-millimetre, with no way round it inside the dialog. Raised as **S6-P2-2**.*

**Trustworthiness.**
- **Engine numbers:** three trees alternated in one process, the first round dropped, median of 3–5, every result hashed. They are solid as ratios. Late-set clock fall makes absolute times read up to about 1.5 × high.
- **Browser numbers:** main's sets ran 19:47–21:47 with no other session active; the kept runs had calibration within 36–41 ms. From about 21:58 another session's tooling and measuring harness shared the PC (Machine state), so the 1.0.28 rows after that time are flagged or re-run, and some 1.0.23 rows could not be run.

## Scorecard

Budgets (AREAS): 100 ms from input to visible response; 200 ms longest UI block while designing, or a progress indicator and Cancel if the work can take longer; 1.5 GB peak memory. Browser times are median (range) of the kept runs, from the input (Enter in the command search, or the click) to the frame that shows the result. "Block" is the longest main-thread task in the step. "Chrome" is the measuring Chrome's private bytes, workers included.

### In the app (main, `zz-s6\dist-main`; `results.jsonl`)

| Operation, input | Time to result | Longest block | Chrome | Progress / Cancel | Budget | Verdict |
|---|---|---|---|---|---|---|
| Offset Shapes, 20 shapes (`M-off-d20`, n=5) | preview 60 (49–65); Offset 31 | 0 / 0 | 0.54 GB | "Updating preview…"; Cancel | 100 ms | Pass |
| Offset Shapes, 100 concentric rings (`M-off-r100`, n=3) | preview **1,150** (1,117–1,283); Offset 30 (settled 290) | 0 / 59–62 | 0.56 GB | yes (worker) | 200 ms block | Pass in the app; cost is **N3-P3-1 (KNOWN)** |
| Offset Shapes, 300 rings (`M-off-r300`, n=1) | preview **29,249**; Offset 46 | 0 / 0 | 0.85 GB | yes | | **N3-P3-1 (KNOWN)** |
| Weld, 50 shapes (`M-weld-ov50`, n=3) | preview 82 (70–90); Apply 46 | 0 / 0 | 0.60 GB | yes | 100 ms | Pass |
| **Weld, 2,000 shapes** (plate + 1,999 overlapping circles; `M-weld-ov2000`, n=3) | preview **5,707** (5,677–6,010); Apply 96 | **5,222 (5,153–5,378)** / 109–113 | 1.15–1.23 GB | status frozen; Cancel unreachable during the block | 200 ms block | **S6-P2-1** (26 ×) |
| Subtract, 50 / 2,000 shapes (`M-sub-*`) | 47 / **542** (505–773); Apply 38–46 / 80 | 0 / 101–158 | 0.58 / 1.13–1.23 GB | yes | 200 ms | Pass |
| Exclude, 50 shapes (`M-exc-ov50`, n=5+5) | 81–98; Apply 46–47 | 0 | 0.60 GB | yes | 100 ms | Pass |
| Exclude, 2,000 shapes (`M-exc-ov2000-cancel`, n=3+3) | not awaited (Node: **54.9 s**); **Cancel after 5 s closes in 13–28 ms** | 91–164 on opening | 1.14–1.27 GB | yes, and Cancel terminates the worker | | **S6-P3-2** |
| Optimize Shapes, 50 outlines of 200 nodes (`M-opt-n50`, n=5) | 388 (384–446); Optimize 53 | 0 / 0 | 0.59 GB | "Working it out… N%" | 100 ms (first status at 15 ms) | Pass |
| Optimize Shapes, 2,000 outlines (400,000 nodes; `M-opt-n2000`, n=3) | **4,331** (4,316–5,668); Optimize 222 | **262–328** on opening / 103–139 | **1.53–1.62 GB** | percentage; Cancel | 200 ms; 1.5 GB | **S6-P3-3** (the before/after preview) |
| Align Left / Centers / Undo / Distribute, 20 shapes (`M-arrange-d20`, n=3) | 18 / 15 / 12 / 16 | 0 | 0.53 GB | — | 100 ms | Pass |
| Same, 2,000 shapes (`M-arrange-sep2000`, n=4) | **184** / 119 / 116 / 119 | 98–138 | 1.16–1.46 GB | — | 100 ms | 1.2–1.8 ×: post-edit preparation, **S2-P3-1 (KNOWN)** |
| Array grid 3 × 3 of 50 parts → 450 (`M-array-p50`, n=4) | 73 (65–81), settled 216 | 0–58 | 0.54 GB | — | 100 ms | Pass |
| Array grid 6 × 7 → 2,100 (`M-array-p50-6x7`, n=5+3) | **216–232**, settled 544–558 | **184–219**, then 175–179 | 0.62–0.65 GB | — | 200 ms | 1.0–1.1 ×: post-edit preparation, **S2-P3-1 (KNOWN)** |
| Array circular 40 → 2,000 (`M-array-p50-circ40`, n=4) | **280** (267–332), settled 587 | **214–250** | 0.64–0.66 GB | — | 200 ms | 1.1–1.25 ×: **S2-P3-1 (KNOWN)** |
| Quick Nest, 50 parts, Outline + 24 arrangements (`M-nest-p50`, n=5) | 47 (44–63); Accept 31 | 0 | 0.52 GB | "Searching · n / 24", Stop search | 100 ms | Pass (over 32 parts the Outline method uses rectangles, by design) |
| Quick Nest, 32 parts, Outline + 24 arrangements (`M-nest-p32`, n=4+4) | **21,214–21,639** | 0 | 0.55–0.71 GB | yes, about 0.9 s an arrangement | | Pass (worker; see Verified clean) |
| Quick Nest, 500 parts (`M-nest-p500`, n=1) | search complete in 146 ms, no layout found | 0 | 0.52 GB | yes | | Pass (my fixture does not fit the bed) |
| Node edits on one 5,000-node path (`M-node-big5000`, n=5, cal 45–53) | pick 10; drag 20 moves at 33 ms each (p95 34); insert 13–15; delete (no response stamp, no task); Undo 27 | 0 | 0.55–0.58 GB | — | 33 ms a frame; 100 ms | Pass |
| Select all / turn 45° / nudge / drag 5,000 circles turned 30° (`M-rotate-rot5000`, n=4) | 1,965 / 860 / 323 / drag moves median 280, p95 2,378 | **466–583** / 339–425 / 249–262 / 150–175 | **1.73–1.99 GB** | — | | S2's area: KNOWN re-observed; ADR-677 adds nothing (next row) |
| Same, 5,000 unturned circles (`M-rotate-sep5000`, n=4) | 2,053 / 804 / 339 / moves median 339, p95 2,097 | 419–512 / 292–361 / 269–361 / 148–270 | 1.75–2.06 GB | — | | Same as turned: **tight bounds verified clean** |

### Engine (Node; the worker's or the UI thread's call; main / 1.0.28 / 1.0.23; `out\gb6.jsonl`)

Median of the kept rounds (worst). "=" means the result hashes equal main's; "≠" differs.

| Operation, input | main | 1.0.28 | 1.0.23 | Output | Where it runs | Verdict |
|---|---|---|---|---|---|---|
| Offset Shapes 1 mm, 20 shapes; Both | 16.9 (20.4); 24.5 | 16.6; 26.1 | 15.9; 24.4 | = | worker | Pass |
| Offset Shapes 0.5 mm, rings 25 / 50 / 100 / 300 | **68.6 / 184 / 1,496 / 31,426** | 68.2 / 183 / 1,435 / 31,975 | 8.3 / 13.2 / 43 / 305 | 1.0.28 =, 1.0.23 ≠ | worker | **N3-P3-1 (KNOWN)**: 8–103 × 1.0.23, a burn change by ADR-410 Amd 3 |
| Offset Shapes, **Outer shapes only**, 100 / 300 rings | **443** (505) / **2,773–2,878** | 508 / 2,696–2,856 | **67 / 322–346** | **all =** | worker | **S6-P3-1** (6.6 / 8.0 × 1.0.23, same output) |
| Offset outlines row 1 mm, 100 rings / 50 / 2,000 shapes | 1,439 / 28 / 420 | 1,700 / 28 / 400 | 53 / 12 / 139 | 1.0.23 ≠ | worker | N3-P3-1's mechanism; ADR-410 Amd 3 |
| Weld: prepare / union / absorbed check, 50 shapes | 0.5 / 8.6 / 22.8 | = | = | = | UI / worker / **UI** | Pass |
| Same, 200 / 500 / 1,000 / 2,000 shapes (plate + circles) | check **15 / 411 / 1,104 / 4,613** | 15 / 376 / 1,152 / 4,659 | 15 / 352 / 1,079 / 4,503 | = | **UI thread** | **S6-P2-1** |
| Same, 2,000 overlapping circles, no plate / 2,000 separate | check 51 / 75; union 134 / 119 | = | = | = | | Pass |
| Subtract 50 / 2,000 | 10.6 / 121 | 10 / 116 | 10.1 / 116 | = | worker | Pass |
| Intersect 50 / 2,000 (shapes sharing a middle) | 13.2 / 126 | 13.5 / 119 | 13.7 / 118 | = | worker | Pass |
| Exclude 50 / 200 / 500 / 2,000 | 58 / 306 / **2,545 / 54,886** | 61 / 303 / 2,519 / 54,880 | 61 / 305 / 2,529 / 53,568 | = | worker | **S6-P3-2** |
| Optimize Shapes 50 / 2,000 outlines: total; longest slice; start | 152; 31.8; 0.3 / **1,772**; 31.4; 12.5 | 157 / 1,757 | 154 / 1,757 | = | UI, 30 ms slices | Pass (the app's opening block is S6-P3-3) |
| Optimize Shapes, one 5,000-node path | 35.5, all in one slice of 34 ms | 35.3 | 36.8 | = | UI | Pass (one object cannot be sliced; 34 ms) |
| Tight bounds (`objectGeometryExtent`), 2,000 / 5,000 turned circles, cold | 1.7 / **4.1** | 1.3 / 4.1 | — (no ADR-677) | 1.0.28 = | UI | Pass |
| Quick Nest search, rectangles, 50 / 500 parts | 30.3 / 58.3 | 32.3 / 56.4 | 31.4 / 57.2 | = | worker | Pass |
| Quick Nest search, Outline, 32 / 50 parts | **22,960** / 17.1 | 22,680 / 17.3 | 22,619 / 17.2 | = | worker | Pass (progress, Stop) |

Peak process memory (Node `maxRSS` of the whole three-tree set): Weld 2,000 425 MB, Exclude 2,000 576 MB, Optimize 2,000 511 MB, 300 rings 231 MB.

### Repo benchmarks

Both run through esbuild copies in `zz-s6` (Re-running), because Node and Vite cannot resolve packages through `j7-main`'s `node_modules` junction. The measured code is unchanged.

| Benchmark | Result | Verdict |
|---|---|---|
| `scripts/benchmark-quantity-nesting.mjs` (six 20 × 10 panels on two 46 × 26 stocks; `out\bench-quantity-nesting.json`) | 6 of 6 placed on 2 sheets, 50.2% utilisation; planner median **0.21 ms**, worst 17.3 ms (first trial) of 10; emitted cut 360.0 mm, travel 1,672.5 mm | Pass |
| `scripts/performance-audit/nesting-probe.mjs` (the production rectangle validator; `out\nesting-probe.json`) | 1,000 / 5,000 / 10,000 placements: median **1.4 / 6.3 / 12.8 ms** (worst 2.3 / 6.5 / 14.4), all valid; RSS 55–93 MB | Pass (linear) |

## Findings

### S6-P2-1 — Weld on 2,000 overlapping shapes freezes the window for 5.2 s after the worker has finished: the "absorbed shapes" check runs clipper on the UI thread, one difference per neighbour

- **Where:**
  - `src/ui/commands/BooleanDialogHost.tsx:245-248`: when the worker's union arrives, a `useMemo` calls `describeWeldChange(sources, settled.value)` on the UI thread.
  - `src/core/geometry/vector-path-weld-change.ts:49-55` (`describeWeldChange`) → `:109-130` (`absorbedSourceIds`). A source none of whose vertices survives on the welded outline is a candidate. `weldBatchPieces` is built for every source whose box reaches a candidate.
  - `:132-157` (`pieceCovered`): for each candidate, one `differenceD` per neighbouring piece (`:143`), each against the remainder left by the last. It stops early only when the remainder is empty, so a candidate that is **not** covered walks every neighbour, and the remainder grows more complex with each cut.
- **Anchor:**
  - AREAS: 200 ms longest block while designing, or a progress bar and Cancel; P2 for "a freeze of 5 s or more … with no progress or Cancel" and "an ordinary operation over three times its budget".
  - Contract: ADR-609 Consequences (`ADR-609-vector-geometry-worker.md:100-117`): "What remains on the UI thread scales with the size of the selection and of the result, not with clipper's work". Its table lists Weld's UI-thread share as 9.2 ms. `describeWeldChange` is clipper's work on the UI thread.
- **Scenario:** a user welds a sign plate with many overlapping decorations, or a traced design, where one large shape has every vertex covered by others but is not itself covered. The dialog shows "Updating preview…", then the window stops answering for seconds: the status, the preview and Cancel all freeze until the check ends.
- **Evidence:** **REPRO** (engine split and browser), and **READ**.
  - **Engine** (`gb6.mjs weld-ui`; the dialog's three steps timed apart; main, with 1.0.28 and 1.0.23 equal in hash and within 10%):

    | Weld of | prepare (UI) | union (worker) | absorbed check (UI) |
    |---|---|---|---|
    | plate + 49 circles | 0.5 ms | 8.6 ms | 22.8 ms |
    | plate + 199 | 1.3 | 23.5 | 15 |
    | plate + 499 | 3.8 | 47 | **411** |
    | plate + 999 | 8 | 102 | **1,104** |
    | plate + 1,999 | 16.6 | 153 | **4,613** |
    | 2,000 overlapping circles, no plate | 10.8 | 134 | 51 |
    | 2,000 separate circles | 10.2 | 119 | 75 |

    The plate's four corners lie inside circles, so it is a candidate; it is not covered, so `pieceCovered` cuts it by all 1,999 neighbours in turn.
  - **Browser** (`M-weld-ov2000`, 3 kept runs, calibration 36–38 ms): Weld → result shown **5,707 ms** (5,677–6,010) after Enter. The window holds one task of **5,222 ms (5,153–5,378)**, starting 634 ms after the input, when the worker's reply lands. Apply then takes 96 ms. Chrome 1.15–1.23 GB.
  - **Trend:** 1.0.28 (`T28-weld-ov2000`, 4 kept runs): 5,514 ms, block 4,922–5,138 ms. 1.0.23: the same code and the same engine time (4,503 ms). Not a regression.
  - **Profile** (`zz-s6\prof-M-weld-ov2000-prof-open-weld-open-weld-r1.json`, source-mapped with `map-profile.cjs`; 200 µs sampling inflates totals): `describeWeldChange` 6,231 ms inclusive, of which `absorbedSourceIds` 6,051 ms and `pieceCovered` → `differenceD` at `vector-path-weld-change.ts:142` **5,882 ms**. `compareOutlines` (the `changed` test) is 174 ms and `weldBatchPieces` 129 ms. Self time is all clipper (`scalePath64`, `boundingBoxesOverlap`, `buildIntersectList`).
- **Severity:** **P2.**
  - A 5.2 s freeze with no progress or Cancel, at the area's own 2,000-shape size, which AREAS also budgets as a project size ("2,000-object project"). That is 26 × the 200 ms block budget.
  - S2-P2-1 set the precedent: an everyday operation at the budget's own object count, over three times its budget.
  - The cost depends on the shapes: everyday welds of 50–200 shapes take 15–23 ms, and 2,000 shapes without an uncovered candidate 51–75 ms. At 500–1,000 shapes with one, the block is 0.4–1.1 s (2–5.5 ×). A refuter may weigh the arrangement's frequency and lower this to P3.
- **Fix direction** (no output change: `absorbedIds` and `changed` must be identical; the welded geometry is not touched):
  - Run `describeWeldChange` in the vector worker with the union and return `{changed, absorbedIds}` with the reply. The worker already holds the sources. This alone removes the block.
  - And/or test each candidate piece once against all covering pieces together (one `differenceD` with the covering pieces as clips, which NonZero unions), instead of a chain. Prototype (`zz-s6\weldfix6.mjs`: main's `describeWeldChange` bundled as is and with this one function replaced; harness only): **identical `changed` and `absorbedIds` on all seven fixtures** (25 to 1,225 absorbed shapes, and the no-change case), and the check drops from 5,314–6,147 ms to **336–382 ms** at 2,000 shapes, from 1,283–1,499 to 194–230 ms at 1,000 and from 271–499 to 83–133 ms at 500. At 50–200 shapes and on the plate-less fixtures it is within noise. It still runs on the UI thread, so the worker move is the one that meets the budget; the existing tests must also pass.
  - Budget: no UI-thread task over 50 ms after the worker's reply at 2,000 shapes; the existing `vector-path-weld-change` tests and the bridge case (audit 2026-10-21 geometry P2-1) unchanged.

**Refuter (2026-11-05): CONFIRMED, P2.** The code, the freeze and the cause all hold. The prototype's "identical decisions" claim is corrected: the warning can name a different one of two identical shapes, though the burn cannot change.
- **Code on main** (`3a8acb3bb`; no cited file changed since `45cbf63f9`): `BooleanDialogHost.tsx:245-249` (`useMemo` → `describeWeldChange(sources, settled.value)`); `vector-path-weld-change.ts:109-130` (`absorbedSourceIds`) and `:132-156` (`pieceCovered`, the chain at `:142-149`).
  - `describeWeldChange` came in with `310cb363a` (2026-10-20), two days after ADR-609 (2026-10-18). So it is a later change that broke ADR-609's Consequences ("scales with the size of the selection and of the result, not with clipper's work").
- **Browser** (`R-weld-ov2000#2`, `zz-s6r\results.jsonl`, 4 kept runs, calibration 36–42 ms): the result shows after **6,379 ms** (6,298–6,724), with one task of **5,792 ms (5,628–5,989)** starting 538 ms after Enter; Apply 95–96 ms; Chrome 1.10–1.26 GB. The first set (`R-weld-ov2000`, 1 kept) gave a 6,560 ms block. My blocks are 0.4–0.6 s longer than the auditor's, on the same `dist-main`.
- **Engine** (`zz-s6r\weldtime.mjs`; one call per process; calibration before and after within 15%): the check takes **3.12 s** (3,116–3,124 ms, 3 sets, calibration 36–44 ms) on `ov2000`, 765 ms on `ov1000` and 267 ms on `ov500`. Sustained runs read up to 4.8–5.3 s as the clock falls, which matches the auditor's 4.6 s. In the browser the same call takes about 1.85 × as long as in Node.
  - Trend (`gb6.mjs weld-ui ov2000`, both tree orders): main 4.95 / 5.16 s, 1.0.28 5.77 / 5.55 s, 1.0.23 5.23 / 6.60 s, all with hash `d73d2e8cf898`. **Not a regression.**
- **Is the arrangement ordinary?** The cost needs one large candidate: a shape whose every vertex is buried under other shapes but which is not itself covered, and which most of the selection overlaps. A traced photo or a halftone does not trigger it. Their candidates are small and reach only a few neighbours, as `ovc2000` shows (51 ms). An everyday plate does trigger it. I timed two such designs in Node (median of 3, or one clean call at 2,000):

  | Design | 200 | 500 | 1,000 | 2,000 |
  |---|---|---|---|---|
  | `edge<K>`: 300 × 200 mm plate, corner circles, K circles overlapping its edge all round (a scalloped border) | 101 ms | 240 ms | 640 ms | **2.9–3.2 s** |
  | `inner<K>`: the same plate with K letter-sized shapes on it | — | 325 ms | 898 ms | **2.3 s** |

  At the browser's 1.85 × factor, a 1,000-circle scalloped plaque blocks about 1.2 s (6 × the 200 ms budget) and a 2,000-circle one about 5.5 s.
- **Severity:** P2 stands.
  - AREAS' second P2 clause ("an ordinary operation over three times its budget") applies as it did for S2-P2-1. Weld is an everyday command, and the 2,000-object size is the budget's own large size. The freeze reaches 6 × the budget at 1,000 shapes on a realistic plate design.
  - It is also METHOD's "broken contract with a clear failure scenario" (ADR-609).
  - It is not P1: no job is running and nothing is lost.
  - At ordinary sizes it is clean: 20–29 ms at 50 shapes (`weld-ui ov50`, all three builds) and 101 ms for a 200-circle border.
- **Fix prototype re-checked** (`zz-s6r\weldchk.mjs`; the auditor's replacement `pieceCovered`, copied verbatim from `weldfix6.mjs`):
  - The repo's own `vector-path-weld-change.test.ts` passes **14/14** against both the current and the prototype bundle (run under Node with a vitest shim).
  - **Random scenes: 3,599 of 3,600 identical** (600 with seed 12345, 3,000 with seed 777; about half have absorbed shapes). The one difference (seed 12345, scene 323) is which of two identical shapes the warning names: main names `copy`, the prototype names `o0`.
    - `weldchk-dbg.mjs` shows why. Main's chain of differences rounds to the 0.001 mm grid after each step, so after 14 neighbours it leaves a **4.8 × 10⁻⁴ mm²** sliver even after subtracting `o0`'s exact copy. So `o0` counts as not absorbed. The prototype's single difference leaves nothing.
    - The prototype is arguably the more correct of the two, but it is **not output-identical**.
  - **The burn cannot change:**
    - `absorbedIds` only feeds the warning text (`BooleanDialogHost.tsx:257-260, 305-307`).
    - `changed` comes from `compareOutlines`, which the prototype does not touch.
    - The welded geometry and Apply are untouched.
  - Speed (clean single calls): `ov2000` 3,116–3,124 → **206–213 ms**, `edge2000` 2,918–3,191 → 145–218 ms, `inner2000` 2.3 s → 131 ms.
  - **Recommended fix order:**
    1. Move `describeWeldChange` unchanged into the vector worker. That gives identical output by construction and removes the block.
    2. The single-difference rewrite is a further speed-up, but it changes the warning in rare ties. Its fix card should say so and add a test for the two-identical-shapes case.

### S6-P3-1 — Outer shapes only pays N3-P3-1's depth search, although its output is unchanged since 1.0.23: 100 concentric rings take 443 ms against 67 ms, 300 rings 2.8 s against 0.33 s

- **Where:** `src/core/geometry/offset-shapes.ts:202` calls `nestedSelectionRegion(closedBatches, outerShapesOnly)`. With `outermostOnly`, `src/core/geometry/vector-path-nesting.ts:75-79` still computes `ringDepths` for every ring (`:127-166`, the step N3-P3-1 measured), then keeps only the rings at depth 0.
- **Anchor:** AREAS P3 ("poor scaling that ordinary input does not reach"). ADR-410 Amendment 3 says Outer shapes only "offsets only the outlines that no other ring encloses" (`…amendment-3…md:63`), which needs only to know whether **any** larger ring encloses a ring, not how deeply.
- **Evidence:** **REPRO** (engine, `offset-outer rings100`, 3 kept rounds): main **443 ms** (505), 1.0.28 508 ms, 1.0.23 **67 ms**. **All three results hash the same**, so this is a same-output slowdown of 6.6 ×. The set's calibration rose from 45 to 89 ms; the three trees alternate, so the ratio holds.
  - 300 rings, Outer shapes only (2 rounds; calibration 87 → 69 ms, so ratios only): main **2,773–2,878 ms**, 1.0.28 2,696–2,856 ms, 1.0.23 **322–346 ms**, all hashing the same: **8.0 ×**. Full Offset (not Outer only) at 300 rings is 31.4 s; Outer only skips the painting step but still pays the depth search.
- **Severity:** **P3.** It runs in the worker behind "Updating preview…" and Cancel. AREAS' P2 line for a 2 × slowdown since 1.0.23 needs "no reason in an ADR"; ADR-410 Amendment 3 names the containment check (`:104`), though not this case.
- **Fix direction** (no output change; prove with the result hash, as `gb6.mjs` does): when `outermostOnly`, mark a ring as enclosed as soon as one larger ring of another batch encloses it, and skip the depth search. Budget: Outer shapes only within 1.5 × 1.0.23 on 100 and 300 rings.

**Refuter (2026-11-05): CONFIRMED, P3.**
- **Code on main:** `offset-shapes.ts:202` → `vector-path-nesting.ts:74-79`. `ringDepths(rings)` runs before the `outermostOnly` branch, which then keeps the rings at depth 0.
- **Engine** (`zz-s6r\out\gb6.jsonl`):
  - `offset-outer rings100`, run in both tree orders (calibration 37–41 and 37–39 ms): main **215–231 ms**, 1.0.28 210–226 ms, 1.0.23 **26–36 ms**, all with hash `ed521d3f2057`. That is **7–8 ×**.
  - `rings300` (calibration 37 → 36 ms): main **1,523 ms** against 1.0.23 **180 ms** (8.5 ×), both with hash `fbc7506261b3`.
  - The auditor's absolute times are about 2 × mine because their sets ran on a fallen clock. The ratios agree.
- **Severity:** P3, not AREAS' P2 for "2 × since 1.0.23 with no reason in an ADR".
  - ADR-410 Amendment 3 gives the reason: item 3 redefines Outer shapes only by enclosure, and its Consequences price the containment check.
  - It runs in the worker with a status and Cancel.
  - It shows only on many nested rings: about 0.2 s at 100 rings in Node.

### S6-P3-2 — Exclude combines the selection one shape at a time, so its cost grows with the square of the selection: 2,000 shapes take 55 s

- **Where:** `src/core/geometry/vector-path-booleans.ts:186-196` (`runBooleanOp`): Intersect and Exclude sort the shapes, then fold them with one `xorD` (or `intersectD`) per shape, each against the result so far (`:189-193`). The XOR result keeps every edge, so each step costs more. Intersect's result shrinks, so it stays cheap (126 ms at 2,000).
- **Anchor:** AREAS P3 (poor scaling; ordinary input does not reach it).
- **Evidence:** **REPRO**.
  - Engine (`exclude ov*`): 50 shapes 58 ms, 200 shapes 306 ms, 500 shapes **2,545 ms**, 2,000 shapes **54,886 ms**. 1.0.28 and 1.0.23 are the same (2,519 / 2,529 ms at 500; 54,880 / 53,568 ms at 2,000), with identical hashes.
  - Browser (`M-exc-ov2000-cancel`, 6 kept runs): the dialog opens with "Updating preview…", blocks 91–164 ms while it packs the selection, then stays responsive. **Cancel, pressed after 5 s, closes it in 13–28 ms** and releases (terminates) the worker (`vector-op-worker-client.ts:109-126`). Chrome 1.14–1.27 GB.
- **Severity:** **P3.** It is in the worker, with a status and a working Cancel. Excluding hundreds of shapes at once is rare.
- **Fix direction:** fold pairwise as a balanced tree (XOR is associative and commutative), so the work grows with n log n. Because grid rounding may differ, it must prove `canonicalizeVectorPaths`' output byte-identical on the fixtures before it counts as a speed fix; otherwise it is a product decision. Budget: 2,000 shapes under 5 s.

**Refuter (2026-11-05): CONFIRMED, P3.**
- **Code on main:** `vector-path-booleans.ts:186-196`, a sorted fold with one `xorD` per shape.
- **Engine:**
  - `exclude ov500`: main **1,661 ms** in round 0 (calibration 38 ms), then 2.56–2.61 s as the clock fell (the set ended at 65 ms, so flagged). 1.0.28 and 1.0.23 are the same (1.67–2.68 s and 1.96–2.74 s), all with hash `85419637f6b3`.
  - `exclude ov2000`, main: **50.7 s** (calibration 42 → 73 ms, flagged).
  - The growth is quadratic, as reported.
- **Browser** (`R-exc-ov2000-cancel` and `#2`, 6 runs; flagged because the worker's minute of work raised the after-run calibration to 43–73 ms):
  - the dialog shows "Updating preview…" in 204–221 ms, with an opening block of **153–193 ms**;
  - **Cancel after 5 s closes it in 27–28 ms** (`vector-op-worker-client.ts:109-126` terminates the worker).
- **Severity:** I weighed P2 and kept P3.
  - Nothing freezes, and the work can be cancelled at any time. AREAS' design budget explicitly allows longer work behind "a progress bar and Cancel".
  - "Updating preview…" is a status, not a progress bar. That is a polish gap, not a freeze.
  - Exclude of hundreds of shapes is rare, and at 50–200 shapes it is 58–306 ms.

### S6-P3-3 — The before/after preview of Optimize Shapes and Combine Shapes rebuilds every selected outline on the UI thread: 2,000 traced outlines open with a 262–328 ms block, and Chrome peaks at 1.5–1.6 GB

- **Where:** `src/ui/commands/VectorComparisonPreview.tsx:6-13` → `:82-91` (`previewGeometry`): when the dialog opens, every source object is materialized (`materializeVectorObject`) and turned into preview polylines on the UI thread, all of them, for a thumbnail a few hundred pixels wide. Optimize Shapes mounts it at `OptimizeShapesDialog.tsx:79`, Combine Shapes in `BooleanDialogHost.tsx` (`before={sources}`). The optimizing itself is cooperative: `use-optimize-shapes-preview.ts` waits 150 ms, then runs 30 ms slices (`:21-23`) and reports a percentage.
- **Anchor:** AREAS: 200 ms block; 1.5 GB.
- **Evidence:** **REPRO + PROFILE**.
  - `M-opt-n2000` (3 kept runs; 2,000 outlines of 200 nodes, 400,000 points): the first task after Enter is **262–328 ms** (7–70 ms after the input). The percentage then advances in 30 ms slices; the result shows at **4,331 ms** (4,316–5,668), with later tasks of 53–88 ms. Optimize then takes 222 ms (block 103–139 ms). Chrome peaks at **1.53–1.62 GB**.
  - Profile of the opening (`prof-M-opt-n2000-prof-open#2-open-r1.json`, the first task's window): `VectorComparisonPreview` → `previewGeometry` **219 ms**: `materializeVectorObject` 69 ms and building the polylines 147 ms.
  - In the other profiled run the opening task was instead the idle canvas-motion worker's reply being deserialized (`idle-canvas-motion-worker-client.ts:123`, 270 ms self), which can land after any open or edit. That is S2/S4's area and is listed under KNOWN re-observed.
  - The engine's sliced work is 1.77 s, its longest slice 31 ms, and its synchronous start 12.5 ms, so the opening block is the dialog's preview, not the optimizer.
  - Combine Shapes shows the same component: at 2,000 shapes its first task is 101–173 ms (Subtract, Weld, Exclude).
  - 1.0.28 (`T28-opt-n2000`, 3 kept): opening block 281–306 ms, result 4,380 ms, Chrome 1.60–1.64 GB. Not a regression.
  - 50 outlines: no task over 50 ms; result in 388 ms, with the percentage from 15 ms.
- **Severity:** **P3**: 1.3–1.6 × the block budget once per opening, and 1.02–1.08 × the memory budget, at the large size.
- **Fix direction** (no output change: the preview is display only; the burn and the committed geometry are untouched): build the preview at the thumbnail's resolution (skip outlines under a pixel, decimate to the preview scale) or in the vector worker alongside the result, and once per dialog. Budget: no opening task over 100 ms at 2,000 outlines.

**Refuter (2026-11-05): CONFIRMED, P3.**
- **Code on main:** `VectorComparisonPreview.tsx:13-14` (`useMemo(() => previewGeometry(props.before))`) and `:82-91` (`materializeVectorObject` and the polyline strings for every source).
- **Browser** (`R-opt-n2000` and `#2`, 6 runs, all flagged):
  - The after-run calibration rose to 43–89 ms, because each run ends with 4–5 s of sliced optimizing. The before-run calibrations were 38–43 ms in 5 of 6 runs.
  - The first task after Enter is **272–353 ms**, at 24 ms. The result shows after 4.7–5.3 s, with the percentage advancing. Chrome peaks at **1.48–1.53 GB**.
- **Engine** (`optimize-start noisy2000`): synchronous start 10.6–13.1 ms, longest slice 31–36 ms. So the opening block is not the optimizer, which supports the auditor's profile attribution. I did not re-profile.
- Same size as reported: 1.4–1.8 × the block budget once per opening, and about the memory budget.

### S6-P2-2 (raised by the refuter) — Grid Array's "Create array" does nothing for almost any selection whose size is not a whole tenth of a millimetre, with no message in the app

*A functional defect found during the speed round: the auditor's "Also noticed", confirmed and raised.*
- **Where:**
  - `src/ui/commands/ArrayGridFields.tsx:229-233` (`TotalField`): `<NumberInput value={draft ?? shown.toFixed(2)} min={0} step={0.1}>` for Total width and Total height.
  - `src/ui/commands/ArrayDialogFields.tsx:44-49` (`Field`): the spacing fields default to `step={props.step ?? 0.1}`, with `min={0}` (`ArrayGridFields.tsx:73, 84`).
  - `ArrayDialog.tsx:63-73` renders the dialog `as="form"`, with no `noValidate` (`kit/Dialog.tsx:60-61`).
  - With `min=0` the step base is 0, so any value that is not a multiple of 0.1 fails the browser's constraint validation. The form's submit event never fires, so `onSubmit` (`ArrayDialog.tsx:68-72`) never runs.
- **Anchor:**
  - METHOD P2: "Wrong behaviour an ordinary user will hit, with a misleading result".
  - ADR-307 / LBG-T13 (the grid array and its total width and height).
- **Scenario:** select any imported or drawn design whose height is, say, 110.923 mm, open Array (Grid, the default) and press Create array.
  - Nothing happens: no copies, the dialog stays open, and the app shows nothing. Its own status line says "2 rows of 2: the original and 3 copies, … 286 × 223.846 mm overall", and the button stays enabled.
  - In the web build Chrome's native bubble points at "Total height (mm)", a field the user never touched. The desktop app's (Electron) bubble is not verified.
- **Evidence:** **REPRO** (`zz-s6r\arrbug.mjs`, production `dist-main` and 1.0.23's build in headless Chrome; `out\arrbug.jsonl`, screenshots `shots\arrbug-*.png`) and **READ**.

  | Selection, case | Fields the browser rejects | Created? |
  |---|---|---|
  | `d20` (142 × 110.923 mm), Grid default 2 × 2 | Total height 223.85 ("nearest valid values are 223.8 and 223.9") | **no** |
  | `d20`, Grid 3 × 3 / **1 × 3** / Enter instead of the click | Total height 336.77 / **110.92** / 223.85 | **no** |
  | `d20`, Space by: Distance between centres | Vertical spacing **112.923** and Total height 223.85 | **no** |
  | `d20`, type Total height 223.9 (the bubble's own suggestion) | Vertical spacing becomes **2.054** | **no** |
  | `d20`, type Vertical spacing 2.05 | Vertical spacing 2.05 | **no** |
  | One circle, 20.913 mm, Grid default | Total width and height 43.83 | **no** |
  | 1.0.23, `d20` Grid default | Total height 223.85 | **no** (not a regression; the total fields came in with `a6c4b4598`, 2026-10-13) |
  | `parts50` (whole-mm rectangles), Grid default | none | yes (50 → 200) |
  | Circular, `d20` and the 20.913 mm circle (centre 33.33, 47.78) | none: the centre fields have no `min`, so the step base is the value itself | yes |

- **Reach:**
  - One row or one column does not help, and nor do typed totals or spacings. Inside the dialog the user cannot make a grid for this selection: the total's second decimal is fixed by n × size, and every spacing must itself be a multiple of 0.1.
  - Only a selection whose n × width and n × height round to a whole tenth works. For artwork with arbitrary dimensions (imports, text, traces, freehand rectangles) that is about 1 selection in 100.
  - The e2e and unit tests use whole-millimetre shapes, which is why they pass.
- **Severity: P2** (METHOD ordinary severity).
  - The everyday Grid array silently fails for most real artwork. The app's status says it will work, and the only hint, on the web, is the browser's bubble, which suggests values that fail in turn.
  - It is not P1: no wrong output and no data loss.
- **Fix direction:**
  - Give the Total and spacing inputs `step="any"` (or `noValidate` on the dialog's form, since the dialog already explains bad values itself through `problemFor` and `useRoomProblem`).
  - Add a unit test that submits a grid for a 110.923 mm selection.
  - This is not a speed fix and does not touch the burn of a created array.

## Trend

Engine rows alternate the three trees in one process (ratios); browser rows are median (range) of the kept runs. "Out" compares result hashes with main.

| Row | main | 1.0.28 | 1.0.23 | Out | Verdict |
|---|---|---|---|---|---|
| Offset Shapes, 20 shapes (engine) | 16.9 ms | 16.6 | 15.9 | = | Flat |
| Offset Shapes, 100 / 300 rings (engine) | 1,496 / 31,426 ms | 1,435 / 31,975 | 43 / 305 | 1.0.23 ≠ | N3-P3-1: a burn change (ADR-410 Amd 3), in 1.0.28 already |
| Offset Shapes, 100 rings (browser preview) | 1,150 (1,117–1,283) | 1,016 (966–1,100) | 86 (81–90; cal 44–47) | 1.0.23 ≠ | Same |
| Outer shapes only, 100 / 300 rings (engine) | 443 / 2,773–2,878 ms | 508 / 2,696–2,856 | 67 / 322–346 | **all =** | **S6-P3-1** (6.6–8 ×, same output) |
| Weld, 2,000 shapes (browser block) | **5,153–5,378 ms** | 4,922–5,138 | 5,998–6,272 (cal 38–45) | = (engine) | Not a regression (S6-P2-1 in every build) |
| Weld absorbed check, 500 / 1,000 / 2,000 (engine) | 411 / 1,104 / 4,613 | 376 / 1,152 / 4,659 | 352 / 1,079 / 4,503 | = | Flat |
| Subtract / Intersect, 2,000 (engine) | 121 / 126 | 116 / 119 | 116 / 118 | = | Flat |
| Exclude, 500 / 2,000 (engine) | 2,545 / 54,886 | 2,519 / 54,880 | 2,529 / 53,568 | = | Flat (S6-P3-2 in every build) |
| Optimize Shapes, 2,000 outlines (browser: result; opening block) | 4,331; 262–328 | 4,380; 281–306 | 5,183–5,253; 301–386 (cal ≤ 47) | = (engine) | Flat; main fastest |
| Optimize Shapes, 2,000 outlines (engine) | 1,772 | 1,757 | 1,757 | = | Flat |
| Array grid 6 × 7 → 2,100 (browser: shown; block) | 216–232; 184–219 | 216; 184–202 (flagged) | 232; 191–281 (cal ≤ 47) | | Flat |
| Align Left, 2,000 (browser: shown; block) | 184 (161–209); 105–128 | 173–193; 126–188 (flagged) | 205–207; 158–166 (flagged) | | Flat; main fastest |
| Select all, 5,000 turned circles (browser block) | 466–583 | 610–1,041 (flagged) | 564–730 (flagged; no ADR-677) | | ADR-677 adds nothing |
| Node drag on a 5,000-node path (browser, per move) | 33 ms (p95 34) | 33 ms (p95 34–36) | not run | | Flat |
| Tight bounds, 5,000 turned (engine) | 4.1 ms | 4.1 | — | = | Flat |
| Quick Nest, Outline, 32 parts (engine) | 22,960 ms | 22,680 | 22,619 | = | Flat |

Nothing is two or more times slower than 1.0.23 with the same output, except S6-P3-1 (an ADR names its cause).

## KNOWN re-observed

- **N3-P3-1 (v8): Offset's nesting step grows about with the cube of the nesting depth.** Not fixed; `vector-path-nesting.ts` is unchanged since #1501 (`git log`: last change `ef1cd4f85`).
  - Engine, 64-node concentric separate rings 2 mm apart, 0.5 mm outward, round (N3's refuter's case): 25 / 50 / 100 / 300 rings take **68.6 ms / 184 ms / 1,496 ms / 31,426 ms** on main, 68 / 183 / 1,435 / 31,975 ms on 1.0.28, and 8.3 / 13.2 / 43 / 305 ms on 1.0.23. Each doubling multiplies the time by about 2.7, then 8.
  - In the app (`M-off-r100`, `M-off-r300`): the preview arrives after **1.15 s** (1.12–1.28) at 100 rings and **29.2 s** at 300 rings. No task exceeds 62 ms; the status says "Updating preview…" and Apply stays disabled until it lands, as N3 found. Chrome peaks at 0.56 and 0.85 GB.
  - N3 measured 6.6–10 s (100 rings) and 301 s (300 rings) inside Vitest. The esbuild bundle runs the same code 4–10 × faster; the growth is the same.
  - 1.0.23's output differs (the old union filled the holes), so the slowdown is part of a burn change (ADR-410 Amendment 3), not a speed regression. 1.0.28 already had #1501.
  - The Offset outlines row (`offsetVectorObjects`) shares the step: 100 rings 1.44 s against 53 ms in 1.0.23 (different output).
  - New here: Outer shapes only pays the whole step for unchanged output (S6-P3-1).
  - **Refuter (2026-11-05): CONFIRMED (KNOWN).** `vector-path-nesting.ts` is unchanged on `3a8acb3bb`.
    - Engine `offset rings100`: main **925–928 ms** in rounds 0–1 (calibration 38 ms; the set ended at 65, so later rounds are not used); 1.0.28 924 ms; 1.0.23 25–32 ms. Main's hash `c5d6ea2cd6d3` differs from 1.0.23's `ed521d3f2057`, so the output differs, as stated.
    - The auditor's 1,496 ms ran on a fallen clock; the growth and the cause stand.
    - Browser (`R-off-r100` and `#2`, 6 runs, 1 kept): the preview shows after **1,366–1,564 ms** (kept run 1,548 ms), with **no long task** and "Updating preview…" from 22 ms. Chrome 0.56 GB.
- **Refuter (2026-11-05) on S2-P3-1 at 2,000 objects: CONFIRMED (KNOWN).** `R-array-p50-6x7` (6 runs, 1 kept at calibration 40/41 ms, the rest flagged at ≤ 52 ms): shown **232–265 ms**, blocks **202–232 ms** then 175–176 ms, settled 550–583 ms, Chrome 0.61–0.65 GB. This matches the auditor's 216–232 ms and 184–219 ms. I did not re-profile, and did not re-measure the idle canvas-motion reply or the 5,000-circle scenes (S2's area).
- **S2-P3-1 (the post-edit job preparation on the UI thread), seen after commands that rewrite 2,000 objects.**
  - Array grid 6 × 7 of 50 parts (2,100 objects; `M-array-p50-6x7`, 8 kept runs): shown **216–232 ms**, blocks **184–219 ms**, then 175–179 ms; settled 544–558 ms. Circular, 40 copies (2,000 objects; `M-array-p50-circ40`, 4 kept): shown 280 ms (267–332), blocks 214–250 ms. Align Left on 2,000 shapes (`M-arrange-sep2000`, 4 kept): shown 184 ms (161–209), block 105–128 ms; Align Centers, Undo and Distribute 116–119 ms, blocks 83–138 ms.
  - Profile of the array (`prof-M-array-p50-6x7-prof-grid-6x7-grid-6x7-r1.json`): the commit itself (`arraySelection` → `applySelectionPlacements`, `array-actions.ts:72-167`) is **56 ms**. Most of the rest is `prepareOutput` → `optimizePaths` → `refineRoute` (160–187 ms; reached after an `await`, so the caller is not in the stack; its UI callers are `live-job-estimate.ts` and `idle-canvas-motion-plan.ts`) and `buildIdleCanvasMotionPlanFromRequest` (73 ms).
  - 1.0.28: array shown 216 ms, blocks 184–202 ms (`T28-array-p50-6x7`, calibration 38–43 ms but during the other session's activity, so flagged); 1.0.23 232 ms, blocks 191–281 ms. Not a regression. At 450 objects the array shows in 73 ms; at 20 objects align in 15–18 ms.
  - So the commands themselves are cheap; the 1.0–1.25 × block and 1.2–2.8 × response at 2,000 objects are S2-P3-1's preparation, here on a Line-only design (S2 measured it with Fill).
- **The idle canvas-motion worker's reply is deserialized on the UI thread** (`idle-canvas-motion-worker-client.ts:123`, 270 ms self time on 2,000 outlines of 200 nodes) and can land in any interaction shortly after an open or edit. Seen once, inside the Optimize Shapes opening profile. S2/S4's area (canvas motion plans); not raised here.
- **S2-P2-1 / S2-P3-3 (canvas at 5,000 objects), seen while measuring tight bounds.** With 5,000 64-node circles selected (`M-rotate-*`), Select all shows after 1.97–2.05 s (block 419–583 ms), a typed 45° turn after 0.80–0.86 s (block 292–425 ms), an arrow nudge after 323–339 ms (block 249–361 ms), and a 10-step drag of the selection moves at a median of 280–339 ms per step, p95 2.1–2.4 s. Chrome holds 1.73–2.06 GB. 1.0.28 is no faster: Select all 2.6–3.0 s (block 610–1,041 ms), turn 1.4–1.5 s, nudge 386–470 ms, drag moves median 524–651 ms (these 1.0.28 runs overlapped another session; flagged). 1.0.23, which has no tight bounds, selects all in 2.6–2.8 s (block 564–730 ms; calibration 44–89 ms, flagged). These are S2's 5,000-object scenes (S2-P2-1's 1.5 px strokes were fixed by #1552, so what remains should go to S2's re-check or S9). They are listed for the coordinator, not raised here.

## Refuted

- **"ADR-677's tight bounds slow down large selections."** Measuring the outline of 5,000 turned circles takes 4.1 ms cold (Node), and the extent is cached per outline (`object-extent.ts:51-75`). In the app, 5,000 circles turned 30° and 5,000 unturned circles select, turn, nudge and drag at the same speed (within 4–17%, either way).
- **"Main's Offset is 9–35 × slower than 1.0.23 on rings, a speed regression."** The outputs differ: 1.0.23 filled the holes (ADR-410 Amendment 3, a deliberate burn change). Only S6-P3-1 compares identical outputs.
- **"Offset outlines on 2,000 shapes is 3 × slower than 1.0.23" (420 against 139 ms).** Different output for the same reason (holes kept).
- **"Weld got slower on 2,000 shapes."** In the engine main, 1.0.28 and 1.0.23 are within 10% of each other at every size in total (the 500-shape check alone is 411 against 352–376 ms, in a set whose calibration rose from 38 to 62 ms), with identical results; in the browser main's block (5.2 s) is shorter than 1.0.23's (6.0 s) and close to 1.0.28's (5.0 s).
- **"Quick Nest freezes on 500 parts."** The search completes in 146 ms; it finds no layout because my 500 parts (8–40 mm, 2 mm spacing) need more than the 400 × 400 mm bed. Accept is then correctly disabled.
- **"Node delete (D) is not timed, so it may block."** No long task and no slow frame followed the key in any run; only the response stamp is missing (see Not verified).

**Refuter (2026-11-05) on the six refutations:** I uphold all six. Five were re-measured; the sixth rests on the auditor's runs.
1. **Tight bounds: UPHELD.** `extent rot5000`: main 3.3–4.9 ms warm (11.1 ms cold), 1.0.28 4.0–4.5 ms, the same hash (`d3738feffebd`). I did not re-run the browser comparison of turned and unturned circles.
2. **Offset 9–35 × slower: UPHELD.** On rings the hashes differ between main and 1.0.23 (`c5d6ea2cd6d3` against `ed521d3f2057`).
3. **Offset outlines 3 × slower: UPHELD.** `outline ov2000`: main 434–647 ms against 1.0.23 138–214 ms, with different outputs. Main's result is 3.1 MB of JSON and 1.0.23's 152 kB: the holes are kept.
4. **Weld got slower: UPHELD.** `weld-ui ov2000`, run in both tree orders with the same hash: main 4.95 and 5.16 s, 1.0.28 5.77 and 5.55 s, 1.0.23 5.23 and 6.60 s. Main is never the slowest.
5. **Quick Nest freezes on 500 parts: UPHELD.** `nest-fast parts500`: 50–108 ms on main and 50–73 ms on 1.0.23, the same 39-byte "no layout" result. The parts need 277,704 mm² (326,916 mm² with padding) on a 160,000 mm² bed.
6. **Node delete: UPHELD on the auditor's evidence.** I did not re-run it.

## Verified clean

- **Everyday sizes, every command:** see the Scorecard's ordinary rows. No long task; results in 12–98 ms (Optimize 388 ms with a percentage from 15 ms).
- **Every costly vector operation runs in the vector worker** (ADR-609) with a status and Cancel: Offset Shapes, Subtract, Intersect, Exclude and the Weld union. Cancel terminates the worker (13–28 ms to close, `M-exc-ov2000-cancel`). Apply reuses the settled result: 30–96 ms.
- **Output determinism and equality:** every engine set gave one hash per tree across all rounds. Main equals 1.0.28 on every operation, and equals 1.0.23 on everything except Offset's nesting and the Offset outlines row.
- **Optimize Shapes' work** is sliced at 30 ms (engine longest slice 31–35 ms at 2,000 outlines). One 5,000-node path is a single 34 ms step.
- **Quick Nest** runs in its worker with "Searching · n / 24" and Stop search. The Outline method on 32 parts takes 21–23 s (about 0.9 s an arrangement) in all three builds with identical layouts; no long task. At 50 parts it uses rectangles, as `OUTLINE_NEST_ITEM_LIMIT = 32` intends.
- **Node edits on a 5,000-node path:** each of 20 drag moves lands on the next-but-one frame (33 ms, p95 34–36 ms), with no long task, in main and 1.0.28.
- **Tight bounds (ADR-677):** see Refuted.

## Not verified

- **The packaged desktop app.** All browser rows are the Free web bundle in Chrome.
- **Node delete's response time.** In every run no input stamp was recorded for the D key, so only "no long task, no slow frame" is known. Insert (I) was stamped (13–16 ms).
- **Pro-only paths:** none apply; no S6 command is Pro.
- **Weld at 1,000 shapes in the app.** Only the engine split (1.1 s on the UI thread) was measured; 50 and 2,000 were measured in the app.
- **Exclude at 2,000 in the app to completion** (only Cancel at 5 s; the engine gives 55 s).
- **Nesting by the Production nest dialog** ("Quantity production across sheets"): only the repo benchmark (Repo benchmarks).
- **Some trend rows.** Another session's tooling and harness shared the PC from about 21:58 (Machine state). The 1.0.28 re-runs of Array, rotate, Subtract and node edits and the 1.0.23 Subtract, node-edit and Offset rows were skipped once their trend was covered by the engine bench (identical outputs and times) or by earlier clean rows. In 1.0.23 the turn step could not find the "Selection rotation" field, so only its Select all row exists.
- **Calibration after 21:05.** OneDrive's sync service and the other session's idle processes kept browser calibration at 42–55 ms. Rows from those runs are kept only where marked, and only for comparison within the same sitting.
- **Out of scope, noticed (a functional bug, for the coordinator): the Array dialog refuses to create a grid when the selection's grid total has a non-zero second decimal.**
  - `src/ui/commands/ArrayGridFields.tsx:229-233` (`TotalField`): `<NumberInput value={shown.toFixed(2)} step={0.1} min={0}>`. A total such as 336.77 mm violates `step=0.1`, so the browser's constraint validation blocks the dialog's form submit. Chrome shows "Please enter a valid value. The two nearest valid values are 336.7 and 336.8." on the Total height field, and "Create array" does nothing.
  - Seen on my 20-shape design (selection 144 × 112.923 mm): a 3 × 3 grid fails in all three builds (the default 2 × 2 shows a total height of 223.85 mm, which breaks the same rule; not clicked) (`smoke4-M-array-d20`, `smoke5-T28-array-d20`, `smoke5-T23-array-d20`, screenshot `zz-s6\shots\dbg-array.png`). With whole-millimetre parts (`parts50`) it works.
  - Same in 1.0.28 and 1.0.23. Any selection whose width or height has more than one decimal can hit it.
  - Not measured further; the array timings above use `parts50`.
  - **Refuter (2026-11-05): reproduced and raised as S6-P2-2** (see Findings). One correction: the 20-shape selection is 142 × 110.923 mm; 144 × 112.923 mm is the centre-to-centre spacing. The default 2 × 2 fails too (reproduced), and so do a single row, Enter, typed totals and "Distance between centres".
- **Refuter, not verified:**
  - Whether the desktop app (Electron) shows Chrome's validation bubble on the blocked Array submit. I did not launch the installed app.
  - The auditor's Weld profile (not re-profiled). The engine split and the source read agree with it.

## Refuter summary

- **When and tree:** 2026-11-05 02:09–03:20 +0800, on origin/main `3a8acb3bb`.
  - Since the audit's `45cbf63f9`, only #1577 (docs) and #1578 (Image Studio, `src/ui/image-editor/*`) landed. No cited file changed, and the 12 cited sources in `j7-main` hash-equal origin/main.
  - So I reused the auditor's `zz-s6\dist-main`, read-only.
- **Harness:** `scratchpad\zz-s6r\` holds copies of the auditor's gate, driver, engine bench and generator, repointed to `zz-s6r` and ports 4891 (main) and 4893 (1.0.23).
  - New scripts: `weldchk.mjs` (repo tests and fuzz of the fix), `weldchk-dbg.mjs`, `weldtime.mjs` (the check now and with the fix, on the `ov`, `edge` and `inner` fixtures), `weldcmp.mjs`, `arrbug.mjs` and `gw.sh`.
  - Results: `results.jsonl`, `out\gb6.jsonl`, `out\weldtime.jsonl`, `out\arrbug.jsonl`, `machine-state.log`, `shots\arrbug-*.png`. The projects and bundles were deleted (remade by `gen6.mjs`, `build6.mjs` and `weldchk.mjs`).
- **Machine:** I was the only measuring agent, and no other session's tooling, harness or Chrome was seen.
  - Every set passed `gate.ps1` three times, 20 s apart (CPU < 45%, ≥ 2.5 GB free; 3.4–4.2 GB free before sets).
  - Calibration (S1's 40M-step loop) started at 36–44 ms.
  - Long single-thread sets and runs that end in seconds of heavy work drift upward (the laptop's clock falls), so those are flagged and quoted as ratios. The clean figures quoted for S6-P2-1 are single calls within 15%.
- **Verdicts:**

  | ID | Auditor | Refuter | Key re-measure |
  |---|---|---|---|
  | S6-P2-1 | P2 | **CONFIRMED P2** | browser block **5,628–5,989 ms** (4 kept); engine 3.12 s clean; plate-with-border designs 0.64 s at 1,000 and 2.9–3.2 s at 2,000 circles; ADR-609 contract broken by `310cb363a` |
  | S6-P2-2 (new) | — ("Also noticed") | **P2** | Grid Array refuses every submit for 142 × 110.923 mm and 20.913 mm selections, in main and 1.0.23; no workaround in the dialog |
  | S6-P3-1 | P3 | CONFIRMED P3 | Outer only, 100 rings 215–231 against 26–36 ms; 300 rings 1,523 against 180 ms; same hashes |
  | S6-P3-2 | P3 | CONFIRMED P3 | Exclude 500: 1.66 s (round 0); 2,000: 50.7 s; Cancel 27–28 ms |
  | S6-P3-3 | P3 | CONFIRMED P3 | opening block 272–353 ms (flagged); Chrome 1.48–1.53 GB; optimizer start 11–13 ms |
  | N3-P3-1 | KNOWN | CONFIRMED | 100 rings 925 ms in the engine (1.0.23 25–32 ms, other output); 1.37–1.56 s in the browser, no long task |
  | S2-P3-1 | KNOWN | CONFIRMED | Array 6 × 7: shown 232–265 ms, block 202–232 ms |
  | 6 refutations | — | all upheld | five re-measured; Node delete rests on the auditor's runs |

- **Corrections to the auditor's report:**
  1. The weld fix prototype is not identical in every case. It passes the repo's 14 tests, and 3,599 of 3,600 random scenes match. The one difference is which of two identical shapes the warning names, caused by main's step-by-step rounding. Prefer moving the unchanged check into the worker.
  2. Absolute engine times in the auditor's tables ran on a fallen clock, about 1.5–2 × high (Weld check 4.6 → 3.1 s, Outer only 443 → 222 ms, 100-ring Offset 1,496 → 925 ms). The ratios and verdicts stand.
  3. The Array selection is 142 × 110.923 mm, not 144 × 112.923 mm.

## Re-running

From `scratchpad\zz-s6`.
- **Tree:** refresh `j7-main` against `origin/main` as in the header (`tree-main.txt` is the hash list; `stale.txt` what was rewritten). Never delete `j7-main` or anything under it recursively (its `node_modules` is a junction).
- **Build main:** from `j7-main`, `node --max-old-space-size=6144 node_modules/vite/bin/vite.js build --config <zz-s6>/zz-s6-vite.config.mts --outDir <zz-s6>/dist-main --emptyOutDir --sourcemap hidden` (2 min 40 s).
- **Hosts:** `node host.mjs dist-main 4861`, `node host.mjs ../zz-s1/dist-33bc394c6 4862`, `node host.mjs ../zz-s1/dist-87ecb4f24 4863`.
- **Engine:** `node build6.mjs` (bundles `eng-main/r28/r23.mjs`), then `./qe.sh q-e1.txt` (gated), or one set: `node --expose-gc --max-old-space-size=6144 gb6.mjs <op> <fixture> main,r28,r23 <rounds>`. Summarise with `node anal6.mjs` (it skips the sets in `discard-sets.json`). Fixtures are in `gb6.mjs`'s `make()`, copied in `fixtures6.mjs`.
- **Projects:** `node gen6.mjs main,r28,r23 d20,rings100,rings300,ov50,ov2000,noisy50,noisy2000,big5000,rot5000,sep5000,sep2000,parts32,parts50,parts500` (about 400 MB; deleted after the audit).
- **Browser:** `node mkqb.mjs <queue> <templates> main,r28,r23 <runs>`, then `./qb.sh <queue>` (gated; re-runs a set once as `#2` when more than half its runs drifted). Summarise with `node sum6.mjs '<label regex>' [max calibration]`.
- **S6-P2-1 first** (one set, about 4 minutes):

  ```
  ./runset.sh '{"base":"http://127.0.0.1:4861/","label":"X-weld-ov2000","runs":6,"file":"main-ov2000.lf2","steps":[{"tag":"open-weld","pre":[{"k":"cmd-open","label":"Weld"}],"act":{"k":"enter"},"done":"ZZ.dlg('Combine Shapes')!==null && !/Updating preview/.test(ZZ.dlgStatus('Combine Shapes')) && ZZ.btn('Combine Shapes','Apply')!=='none'"}]}'
  ```

  and the engine split and the fix prototype: `node --expose-gc gb6.mjs weld-ui ov2000 main,r28,r23 4`; `node --expose-gc weldfix6.mjs ov500,ov1000,ov2000 3`.
- **Profiles:** add `"profile":"<step tag>"` to a set; read with `node map-profile.cjs <file> dist-main 50`, or `node map-profile6.cjs <file> dist-main 10 <fromMs> <toMs>` for one window; `node stack6.cjs <file> dist-main 0 <function>` prints one mapped stack.
- **Repo benchmarks:** `node bqn6.mjs` and `node np6.mjs --out out/nesting-probe.json`: copies of `scripts/benchmark-quantity-nesting.mjs` and `scripts/performance-audit/nesting-probe.mjs` that resolve vite and esbuild from the main checkout and use `j7-main` as the root (Node cannot resolve `vite` through `j7-main`'s junction).

```json
{
  "area": "S6-geometry-commands",
  "tree": "45cbf63f9",
  "builds": { "main": "zz-s6/dist-main (j7-main refreshed to 45cbf63f9, 209 files)", "engine": "esbuild bundles of main / 33bc394c6 / 87ecb4f24 (build6.mjs)", "trend": ["1.0.28 33bc394c6", "1.0.23 87ecb4f24"] },
  "counts": { "raised": 5, "refuted": 6, "P1": 0, "P2": 2, "P3": 3, "known": 4 },
  "refuter": { "date": "2026-11-05", "tree": "3a8acb3bb (no cited file changed)", "confirmed": 4, "refuted": 0, "severity_changes": 0, "new": 1, "new_ids": ["S6-P2-2"], "corrections": ["S6-P2-1 fix prototype not identical in all cases (1 of 3,600 random scenes names the other of two identical shapes in the warning; burn unaffected); prefer moving describeWeldChange unchanged to the worker", "auditor's absolute engine times ran on a fallen clock (~1.5-2x high); ratios stand"] },
  "budgets": { "response_ms": 100, "design_block_ms": 200, "memory_gb": 1.5 },
  "machine": "quiet 18:22-21:57 (all engine sets and main browser sets; OneDrive sync ~1 core); another session's tooling and harness from ~21:58 (1.0.28 rows flagged, some trend rows skipped); calibration 42-55 ms after 21:05",
  "n3_p3_1_now": { "engine_ms": { "rings25": 68.6, "rings50": 184, "rings100": 1496, "rings300": 31426 }, "r1028_ms": { "rings100": 1435, "rings300": 31975 }, "r1023_ms": { "rings100": 43, "rings300": 305 }, "browser_preview_ms": { "rings100": 1150, "rings300": 29249 }, "ui_block_ms_max": 62, "output_vs_1023": "different (ADR-410 Amd 3)" },
  "findings": [
    { "id": "S6-P2-1", "severity": "P2", "evidence": "REPRO + PROFILE + READ", "file": "src/core/geometry/vector-path-weld-change.ts", "line": 143, "known": false, "regression": "none (1.0.28 block 4.9-5.1 s, 1.0.23 6.0-6.3 s)", "title": "Weld of 2,000 overlapping shapes: describeWeldChange's absorbed-shape check runs a chain of clipper differences on the UI thread after the worker returns; block 5,153-5,378 ms, result 5.7 s; 0.4 s at 500, 1.1 s at 1,000 shapes; contradicts ADR-609 Consequences", "fix_prototype": "one differenceD against all covering pieces: identical decisions on 7 fixtures, 2,000 shapes 336-382 ms; or move to the worker" },
    { "id": "S6-P2-2", "severity": "P2", "evidence": "REPRO + READ (refuter)", "file": "src/ui/commands/ArrayGridFields.tsx", "line": 233, "known": false, "regression": "none (same in 1.0.23; since a6c4b4598, 2026-10-13)", "title": "Grid Array's Create array does nothing for selections whose n x size is not a whole tenth of a mm: Total fields show toFixed(2) and spacing fields take 3 decimals in <input type=number min=0 step=0.1>, so browser validation blocks the form submit; no in-app message, status line says the array is fine; no workaround in the dialog. Fix: step='any' or noValidate" },
    { "id": "S6-P3-1", "severity": "P3", "evidence": "REPRO (engine, hashes)", "file": "src/core/geometry/vector-path-nesting.ts", "line": 75, "known": "N3-P3-1 mechanism; ADR-410 Amd 3 names the containment check", "regression": "6.6x (100 rings) and 8.0x (300 rings) vs 1.0.23 with identical output", "title": "Outer shapes only computes every ring's nesting depth though it needs only 'enclosed or not': 100 rings 443 vs 67 ms, 300 rings 2.8 s vs 0.33 s" },
    { "id": "S6-P3-2", "severity": "P3", "evidence": "REPRO", "file": "src/core/geometry/vector-path-booleans.ts", "line": 189, "known": false, "regression": "none", "title": "Exclude folds the selection one xorD at a time: 500 shapes 2.5 s, 2,000 shapes 55 s in the worker; Cancel closes in 13-28 ms" },
    { "id": "S6-P3-3", "severity": "P3", "evidence": "REPRO + PROFILE", "file": "src/ui/commands/VectorComparisonPreview.tsx", "line": 82, "known": false, "regression": "none (1.0.28 281-306 ms, 1.0.23 301-386 ms)", "title": "The before/after preview rebuilds every selected outline on the UI thread when Optimize Shapes or Combine Shapes opens: 2,000 traced outlines block 262-328 ms (previewGeometry 219 ms); Chrome 1.53-1.62 GB" }
  ],
  "known_reobserved": [
    "N3-P3-1: 100 rings 1.50 s, 300 rings 31.4 s (worker; no UI block)",
    "S2-P3-1: Array 6x7 / circular 40 / Align at 2,000 objects block 98-250 ms, mostly post-edit prepareOutput (commit itself 56 ms)",
    "S2-P2-1 / S2-P3-3: 5,000 selected circles: Select all block 419-583 ms, nudge 249-361 ms, drag move p95 2.1-2.4 s, Chrome 1.73-2.06 GB; same turned or not",
    "Idle canvas-motion worker reply deserialized on the UI thread (270 ms at 400k points)"
  ],
  "out_of_scope_bug": "raised by the refuter as S6-P2-2",
  "biggest_win": "Weld's absorbed-shape check: one differenceD per candidate against all covering pieces (or in the worker) turns a 5.2 s UI freeze at 2,000 shapes into ~0.35 s (or none), with identical decisions"
}
```
