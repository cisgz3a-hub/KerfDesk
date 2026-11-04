# Performance audit S1 — S5 Trace and image

- **When:** 2026-11-04 04:58 – 11:50 +0800.
- **Tree:** origin/main @ `a96bc8950` (worktree `claude/performance-audit-s4`, HEAD `c3f56ca13`, docs only).
  - **Engine rows (Node):** every file under `src/core/trace`, `src/ui/trace`, `src/ui/trace-cli`, `src/ui/raster`, `src/ui/image-editor`, `src/core/raster`, `src/core/image-adjust`, `src/core/image-edit`, `src/core/job` and `src/ui/import` in `j7-main` was hash-checked against `origin/main`. One differed (`src/ui/trace/trace-preview.css`, a focus-ring colour from #1570). It was refreshed with `git show` and re-checked.
  - **Browser rows, Free web build:** S4's `zz-s4\dist-main` (`c47579cb4`). `git diff c47579cb4 a96bc8950` touches no file on a measured path (the one trace file is that CSS), so the build was reused.
  - **Browser rows, Pro trace presets:** the web build is Free. Smooth, Sharp, Centerline, Line + fill, Edge Detection, Colour layers and Photo shading open "Advanced tracing is a Pro tool" there (`PRO_BUILD_ENTRIES` stubs them). So `zz-s5\dist-desktop` was built from `j7-main` with `vite build --mode desktop --sourcemap hidden` and `zz-s5\zz-s5-vite.config.mts`. That config's harness-only plugin loads `src/ui/licensing/edition-policy.ts` with `UNLICENSED_BUILDS_RUN_FREE = false`, as an activated desktop app runs. No compute file is changed.
  - **Trend:** 1.0.28 (`33bc394c6`) and 1.0.23 (`87ecb4f24`): S1's `dist-33bc394c6` and `dist-87ecb4f24` in the browser, and the `src` trees in `scratchpad\zz-s2-old\` for the engine bundles.
- **Machine state:** i7-1260P (12 cores, 16 threads), 16 GB, Iris Xe; Chrome 156 (installed, headless); Node 25.8.2. `zz-s5\machine-state.log` holds every set's free memory, load, other tooling, waits and overlaps.
  - **04:58–06:29, engine sets.** A quiet PC: no other tooling, 4.2–6.0 GB free. Calibration (S1's 40M-step loop, run in the bench process) was 34–41 ms before each set.
    - Long sets end at 42–47 ms on an otherwise idle PC: sustained single-thread load lowers this laptop's clock. Those sets are flagged.
    - Every engine comparison alternates the three trees round by round in one process, so the ratios hold. Absolute times in flagged sets may read 10–20% high.
  - **From about 06:50, OneDrive.Sync.Service** used about one core continuously. It is not the audit's. Browser calibration rose from 36–39 to 38–44 ms.
  - **From 07:27, other sessions** ran almost without a break:
    - `vitest` (`src/zz-s4-mem.test.ts`, recovery and parser tests) and `tsc`;
    - then two fix sessions' own measuring harnesses: `r.mjs` with bed-sized photo jobs and their own Chrome, on hosts 4914–4916 and 5397–5398. The coordinator confirmed these (photo job preparation memory; recovery archive off the UI thread) and said a main-red e2e fix may start.

    Free memory fell to 445–1,180 MB several times, and load was 74–91% for over an hour.
    - Sets taken then drifted (calibration 37–96 ms) or hit the 450 MB free-memory watchdog. They are **discarded** (`out\discarded-overlap.jsonl`), as are three engine re-runs of mine that overlapped a browser set (`06:31–06:34`).
    - From 08:35 every set ran from `queue5.sh`. Its `gate.ps1` waits until no other tooling, no other measuring harness and no other Chrome runs, CPU is under 35% and 3 GB is free, three times 20 s apart. `run5.mjs` checks the same gate before each run.
    - The queue then waited 2,738 s and 1,591 s, and from 09:54 to 11:45 it found no quiet window at all (another session's `vitest src/ui/state` and its workers, `tsc`, load 74–91%). The auditor then stopped its own queue and hosts.
  - **Consequence:** the browser plan (about 45 sets) could not be finished. The browser rows below are the sets that passed calibration, plus single clean runs (calibration 35–39 ms) of the harness smoke tests, marked "n=1". Everything else is under **Not verified** and **Re-running**. The prioritised queue (`q-b3.txt`) is left ready to run.
  - **Memory figures** are the private bytes of the measuring Chrome (S4's `mem-poll.ps1`) and the PC's free memory. Node rows give `maxRSS` only where stated.
- **Temp files:** none in the repo except this report; in `j7-main` only the refreshed CSS file (now equal to `origin/main`). Kept for the refuter in `scratchpad\zz-s5\`:
  - scripts;
  - `out\*.jsonl`, `results.jsonl`, `smoke.jsonl`, `machine-state.log`, `logs\`;
  - CPU profiles in `out\prof\`;
  - `dist-desktop` with hidden maps, and the small fixtures.

  Deleted to save disk (remade by "Re-running"): the 17–23 MB photo projects (523 MB in all), Potrace's `tmp\` files (112 MB), and the engine and dither bundles.
- **Scope** (AREAS S5):
  1. Trace time per preset on the Q4 set (72 images: 64 synthetic shapes at 16–200 px, the speckle field and the 7 real crops; Q4's 15 glyph images were left out) and the Q5 set (40 real-image cases). Then at ordinary full size (5 assets, 512–1254 px) and large: the 12 MP photo and the 4096 × 4096 benchmark at the dialog's 2048 px preview edge, then the benchmark and trace-bench's `sparse4096` at 4096. All against Potrace 1.16, the binary already in `scratchpad\potrace`, run as a black box.
  2. In the app: time to the traced preview, re-trace after a settings change, commit, the longest UI block and memory, through the worker and through the cooperative fallback.
  3. Image Studio's Brightness / Contrast, Levels (gamma) and Threshold at a 12 MP photo.
  4. Dithers: the core cost of each of the 12 modes at 100 mm and bed size, and the Photo engraving window's photo dithers.
  5. Photo engraving's On material view.
  6. Trend against 1.0.28 and 1.0.23.
- **Counts:** 4 raised → P1 0 / P2 1 / P3 3 (+ 3 KNOWN re-observed). Refuted 0. Refuter (2026-11-04): 3 of 3 confirmed at their severity, 0 refuted, 0 severity changes; the 3 KNOWN and the Potrace comparison confirmed; 1 new P3 raised (S5-P3-3). See **Refuter summary**.

## Headline

**Tracing never freezes the window on the normal route, but it is slow next to Potrace.** In a worker, an everyday 1024 px logo shows its Line Art preview **1.95 s** after the dialog opens. A re-trace after a settings change takes 1.31–1.44 s, and Trace commits in 69 ms, reusing the preview. No long task occurs at any point, and Chrome stays at 0.67–0.84 GB.
- Potrace 1.16 traces the same logo in **70 ms** per process, start included (152 ms with `mkbitmap`).
- Across the Q5 set, Line Art takes a median **127 ms** per image against Potrace's 16 ms (8 ×; 2.6 × against the `mkbitmap` pipeline). On the full-size assets it is 13 × (4.9 ×).
- Only Photo shading (7 ms per Q5 image) and the synthetic Q4 shapes (median 4.7 ms per shape, under Potrace's 8.5 ms process start) beat it.
- This is Q4-P2-1's "about 10× slower", re-measured (KNOWN).

**One P2 and three P3** (S5-P3-3 added by the refuter).
- **S5-P2-1. Image Studio adjusts the whole document on the UI thread for every slider step.** At a 12 MP phone photo, each step of Brightness / Contrast, Levels or Threshold blocks the window **154–275 ms**, and shows its result **172–370 ms** after the input (n=1 clean run). A drag therefore stutters at 3–6 frames a second, and memory climbed from 1.0 to 1.66 GB over five steps.
- **S5-P3-1. Sharp traces large pages 1.7–2.6 × slower than 1.0.28, for byte-identical paths.** The clean-art check added by ADR-530 Amendment 13 prepares the source a second time and scans it for two-level steps before every trace: on the 4096 benchmark at the 2048 px preview, 542 ms against 210 ms; at 4096, 1,025 ms against 597 ms. Amendment 13 records "Sharp's input is prepared twice" but no cost.
- **S5-P3-2. The cooperative fallback still blocks 205–285 ms in one stretch** at the inline size limit (Q5-P3-3, KNOWN, re-observed). Smooth blocks 206–285 ms on a 400 × 400 photo crop. Line Art blocks up to 205 ms on Q5's colour case; it blocked up to 122 ms when Q5 measured it.
- **S5-P3-3 (refuter). Committing a trace of a phone photo or a 4096 page blocks the window 335–342 ms** on a main-thread decode, and Chrome peaks at 1.9 GB. Colour layers' 96k-node result blocks 311–343 ms at 12 MP.
- **Refuter (2026-11-04):** all three confirmed at their severity. S5-P2-1 re-measures slightly worse (Threshold 411 ms, block 307 ms, n=5) and is partly a histogram recomputed on every render.

**Verified clean.**
- Every preset's worker route: no UI block on the result at 512–1024 px.
- Photo engraving's preview runs in a worker: tones, dithers and On material update in 0.45–0.52 s at 100 mm, with no long task.
- The core dither cost is unchanged since 1.0.23 for all 12 modes, byte for byte. Blue-noise changed output, at the same speed.
- The engine output is deterministic: every run of every image gave one hash.

**Trend.** No preset is two times slower than 1.0.23 on the Q4 or Q5 sets.
- Main is 1.14 × 1.0.28 on Q5 Line Art and 1.38 × on Q5 Sharp. Both come with different output (ADR-530 Amendments 11–14), so they are quality changes.
- The only same-output slowdown is S5-P3-1.

**Trustworthiness.**
- **Engine numbers:** three trees alternated in one process, the first run dropped, median of 3–5, hashes compared. They are solid as ratios. Late-set clock drift means absolute times can read up to about 15% high.
- **Browser numbers:** few. Other sessions' tooling and harnesses held the PC from 07:27 to the end. Every browser figure quoted came from a set or run with calibration within 15% of 36 ms. S5-P2-1 rests on one such run plus the code path. A refuter on a quiet PC should repeat it first.

## Scorecard

Budgets (AREAS): 100 ms from input to visible response; 200 ms longest UI block while designing (or a progress bar and Cancel); 1.5 GB peak memory. Times are median (worst).

### Trace, engine (Node; the worker's route; main / 1.0.28 / 1.0.23; Potrace per process including its 8.5 ms start)

Sum of per-image medians over the set; "/img" is the median image. "Same" counts images whose paths hash identically to main.

| Set | Preset | main | 1.0.28 | 1.0.23 | Same as 1.0.28 | Potrace plain / mkbitmap | Verdict |
|---|---|---|---|---|---|---|---|
| Q4, 72 images (16–512 px) | Line Art | 2,147 ms; 4.7 ms/img; worst 955 ms (stress spiral) | 2,155 | 2,603 | 54/72 | 652 ms (8.5 ms/img: process start) | Worker; KNOWN Q4-P2-1 on the real crops (63–955 ms against 9–29 ms) |
| | Smooth | 2,492 | 2,490 | 2,854 | 54/72 | | Flat |
| | Sharp | 1,028 | 950 | 1,017 | **72/72** | | 1.08 × 1.0.28, same output (S5-P3-1, small) |
| | Centerline | 1,467 | 1,473 | 1,470 | 72/72 | | Flat |
| | Line + fill | 2,828 | 2,762 | 2,816 | 55/72 | | Flat (cal 42) |
| | Edge Detection | 2,348 | 2,410 | 2,401 | 55/72 | | Flat |
| | Colour layers | 834 | 845 | 811 | 72/72 | | Flat |
| | Photo shading | 132 | 124 | 124 | 72/72 | | Flat |
| Q5, 40 real-image cases (≤ 512 px) | Line Art | **8,182 ms; 127 ms/img**; worst 625 ms | 7,155 | 7,200 | 4/40 | **708 / 2,151 ms (16 / 48 ms/img)** | 8 × Potrace (KNOWN Q4-P2-1); 1.14 × 1.0.28, different output |
| | Smooth | 8,603; 137 ms/img | 8,109 | 8,835 | 7/40 | | 8.7 × Potrace |
| | Sharp | 3,933; 45 ms/img | 2,850 | 3,129 | 0/40 | | 1.38 × 1.0.28, different output |
| | Centerline | 2,577 | 2,584 | 2,616 | 40/40 | | Flat |
| | Line + fill | 4,670 | 4,688 | 4,701 | 20/40 | | Flat |
| | Edge Detection | 7,596; worst 1,327 ms | 7,585 | 7,584 | 2/40 | | Flat |
| | Colour layers | 2,600 | 2,599 | 2,543 | 40/40 | | Flat (cal 44) |
| | Photo shading | 316 | 309 | 312 | 40/40 | | Flat; faster than Potrace |
| Full size, 5 assets (512–1254 px; cal 42–46, see above) | Line Art | 5,819; **arch logo 1,469 ms**; stress test 2,995 ms | 5,624 | 5,481 | 0/5 | 478 / 1,019 ms; **arch logo 70 / 152 ms** | 13 × Potrace (21 × on the logo) |
| | Smooth | 6,681 | 6,295 | 5,760 | 0/5 | | |
| | Sharp | 5,231; logo 358 ms | 4,436; 222 ms | 3,919; 205 ms | 0/5 | | 1.2–1.8 × per image (S5-P3-1 in part) |
| | Centerline | 2,665 | 2,680 | 2,641 | 5/5 | | Flat |
| | Line + fill | 7,907; stress test 5,065 ms | 7,618 | 7,366 | 0/5 | | |
| | Edge Detection | 4,547 | 4,605 | 4,620 | 0/5 | | Flat |
| | Colour layers | 2,635 | 2,648 | 2,474 | 5/5 | | Flat |
| | Photo shading | 156 | 165 | 162 | 5/5 | | Flat |
| 12 MP photo at the 2048 px preview edge | Line Art | 1,206 | 1,014 | 1,020 | 0 | 192 / 392 ms | 6.3 × Potrace |
| | Smooth | 1,379 | 1,220 | 1,214 | 0 | | |
| | Sharp | 912 | 559 | 572 | 0 | | 1.63 × 1.0.28, different output |
| | Centerline | 1,450 | 1,440 | 1,238 | 1 | | |
| | Line + fill | 2,522 | 2,525 | 2,299 | 0 | | |
| | Edge Detection | 1,140 | 1,160 | 1,147 | 0 | | |
| | Colour layers | 1,220 | 1,224 | 1,207 | 1 | | |
| | Photo shading | 62 | 54 | 55 | 1 | | |
| 4096 benchmark at the 2048 preview edge | Line Art | 921 | 823 | 828 | 0 | | |
| | Smooth | 1,284 | 1,149 | 997 | 0 | | |
| | **Sharp** | **542** | **210** | 223 | **1/1** | | **S5-P3-1** (2.58 ×, same paths) |
| | Centerline | 598 | 596 | 586 | 1 | | Flat |
| | Line + fill | 1,331 | 1,430 | 1,464 | 0 | | |
| 4096 benchmark at 4096 (the commit grid) | Line Art | 2,658 | 2,575 | 2,518 | 0 | 898 / 2,234 ms | 3.0 × Potrace |
| | Smooth | 3,751 | 3,619 | 3,520 | 0 | | |
| | **Sharp** | **1,025** | **597** | 617 | **1/1** | | **S5-P3-1** (1.72 ×, same paths) |
| `sparse4096` (trace-bench's page) | Line Art | 2,296 | 2,172 | 2,226 | 0 | | Flat |
| | Smooth | 3,677 | 3,367 | 3,351 | 0 | | |

### Trace, cooperative fallback (worker unavailable; images up to 160,000 px traced inline)

Longest stretch between the runner's yields, counted from the call, so the synchronous prelude counts. Node emulation of `cooperative-trace-runner.ts` (8 ms slices, a timer yield). Median of 4 runs (range).

| Input | Line Art | Smooth | Sharp | Centerline | Line + fill | Edge | Colour layers | Photo shading | Budget | Verdict |
|---|---|---|---|---|---|---|---|---|---|---|
| Astronaut crop 400 × 400 (Q5-P3-3's case) | 78 (56–105) | **272 (206–285)** | 59 (58–65) | 56 (53–59) | 61 (52–68) | 72 (60–80) | 45 (41–47) | — | 200 ms | **S5-P3-2 (KNOWN Q5-P3-3)** |
| 1.0.28 / 1.0.23, same crop | 74 / 53 | 205 / 251 | 47 / 55 | 56 / 68 | 58 / 72 | 66 / 65 | 40 / 42 | — | | Same in both releases |
| Q5 cases at inline size (29 images), worst | **205** (col-noise12) | 127 | 28 | 26 | 23 | 31 | 35 | 11 | 200 ms | 1 of 29 over 200 ms; 18–19 of 29 over 50 ms (Line Art, Smooth) |

In the app (Free build, worker disabled): not measured cleanly (see Not verified).

### Trace, in the app (worker route; time from the input to the preview's "Trace ready")

| Input, build | Open → preview | Re-trace (detection → manual; Threshold 150; Smoothness 0.5) | Commit | Longest block | Chrome | Verdict |
|---|---|---|---|---|---|---|
| Arch logo 1024 × 1024 PNG, Line Art, main (`M-tr-arch#2`, n=4) | **1,949 ms (1,984)** | 1,326 (1,477); 1,306 (1,440); 1,437 (1,440) | 69 ms (71) | **0** | 0.67–0.84 GB | Pass (progress card with Cancel) |
| Same, 1.0.28 (n=1 clean) | 1,736 | 1,203; 1,189; 1,318 | 62 | 0 | 0.78 GB | Same |
| Astronaut 512 × 512, Line Art, 1.0.28 (`T28-tr-astro#2`, n=4) | 599 (621) | 890; 854; 870 | 95 | 0 | 0.65–0.71 GB | Pass |
| Astronaut, Pro presets, main desktop build (n=1 clean) | Line Art 651 | Smooth 1,016; Colour layers 605; Photo shading 436 | — | 50 ms (Photo shading, drawing 162,950 nodes) | 0.55–0.71 GB | Pass |

### Image Studio (12 MP photo, `main-p12`; n=1 clean run, calibration 35/39 ms)

Input = the range input's event; shown = the first document-sized `putImageData` followed by a draw of the Studio canvas.

| Adjustment, step | Shown | Longest block | Chrome | Budget | Verdict |
|---|---|---|---|---|---|
| Open Image Studio | 384 ms | 204 ms | 1.01 GB | 200 ms | Pass (1.02 ×) |
| Brightness / Contrast: Brightness 10, 20 | **177, 172 ms** | **158, 154 ms** | 1.30, 1.34 GB | 100 ms response | **S5-P2-1** (1.7 ×) |
| Levels: Gamma 1.2 | **301 ms** | **202 ms** | 1.52 GB | 100 / 200 ms | **S5-P2-1** (3.0 ×) |
| Threshold: Level 100 | **370 ms** | **275 ms** | **1.66 GB** | 100 / 200 ms; 1.5 GB | **S5-P2-1** (3.7 ×) |

### Photo engraving window (12 MP photo at 100 mm, 10 lines/mm; n=1 clean run)

| Step | Preview shown | Longest block | Chrome | Verdict |
|---|---|---|---|---|
| Open | 497 ms ("Preparing engraving pixels…" at 31 ms) | 0 | 0.70 GB | Pass |
| Contrast 15 | 472 ms (status at 3 ms) | 0 | 0.61 GB | Pass |
| Dither Blue Noise / Stucki | 450 / 518 ms | 0 | 0.55–0.60 GB | Pass |
| On material | 517 ms | 0 | 0.64 GB | Pass |

The window shows its status within 3–31 ms and the result 0.45–0.52 s later (a 150 ms debounce, a new worker and the compile), with no main-thread task over 50 ms.

### Refuter rows (2026-11-04; queued sets from `q-b3.txt`, run from `scratchpad\zz-s5r`)

Median of 4–5 kept runs (range). Run 0 is dropped. "cal" is the calibration before each run; a set is used only when that was 36–41 ms. After trace and bed-photo sets, the calibration *after* the run read 57–125 ms in main and the desktop build, and in 1.0.28. The PC was otherwise quiet and the next run's calibration was normal again, so this is the app's own background work after the commit, not another process. 1.0.23's after-run calibration was normal (36–40 ms).

| Set (label) | Step | main | Trend | Longest block | Chrome peak | Verdict |
|---|---|---|---|---|---|---|
| Trace dialog, 12 MP JPEG, Line Art, Free (`R-tr-p12`) | Open → preview | 4,423 ms (3,919–4,504) | 1.0.28 3,573; 1.0.23 3,106 | 222 (203–230) | 1.16 GB | Progress card; block 1.1 × (S5-P3-3) |
| | Re-trace (detection, Threshold, Smoothness) | 2,506 / 2,431 / 2,285 | 1.0.28 1,880 / 2,085 / 1,741; 1.0.23 2,010 / 2,121 / 1,828 | 0–65 | 1.2 GB | Pass |
| | Commit (Trace → dialog closed) | 6,951 (6,747–7,335) | 1.0.28 4,191; 1.0.23 4,275 | **335 (318–497)** | **1.95 GB** | **S5-P3-3**; 1.6 × 1.0.23, different output |
| Trace dialog, 4096 benchmark (`R-tr-b4k`) | Open / re-traces / commit | 3,166 / 1,246–2,051 / 3,459 | not run | open 264 (242–324); **commit 342 (309–391)** | 1.30 / **1.91 GB** | **S5-P3-3** |
| Pro presets, 12 MP (desktop build, `RD-tr-p12`) | Smooth / Sharp / Centerline / Line + fill / Edge | 3,390 / 2,130 / 3,223 / 5,786 / 3,106 | | 0 / 0 / 0 / 0 / 80 | 1.09–1.47 GB | Pass (worker) |
| | Colour layers (4,505 paths, 95,942 nodes) / Photo shading | 3,820 / 588 | | **311 (298–358)** / 68 | 1.22 GB | Colour layers: S5-P3-3 |
| Cooperative fallback in the app, Free, 400 × 400 (`R-fb-astro400`) | Open / re-traces / commit | 1,122 / 840–981 / 70 | not run | **263 (259–349)** / 146–197 / 0 | 0.68 GB | S5-P3-2 |
| Same, Pro presets (`RD-fb-astro400`) | Smooth / Edge / Colour / others | 1,248 / 935 / 568 / 387–915 | | **311 (305–341)** / 107 / 94 / 0–70 | 0.64 GB | S5-P3-2 |
| Image Studio, 12 MP (`R-st-p12#2`, n=5) | Brightness / Levels / Threshold | 120–198 / 287–294 / 408–414 | 1.0.28 166–401 / 370–391 / 479–540; 1.0.23 191–367 / 332–349 / 496–530 | 102–180 / 185–189 / **306–310** | 1.47–2.20 GB | **S5-P2-1**; faster than both releases |
| Image Studio, 4096 × 4096 (`R-st-b4k`) | Brightness / Levels / Threshold | 188–400 / 358–382 / **492–570** | not run | 169–381 / 271–286 / **400–475** | 1.50–1.83 GB | S5-P2-1 |
| Photo engraving, 12 MP at bed size 400 × 300 mm (`R-ph-bed`, 2 sets) | Open / tones / Blue noise / Floyd-Steinberg / Stucki / Jarvis / On material | 2,200 / 1,758–1,862 / 1,205–1,223 / 1,834–1,923 / 3,218–3,241 / 3,206–3,374 / 2,956–3,074 | not run | ≤ 55 | 0.93–1.19 GB | Pass: status in 4–54 ms, worker |
| Photo engraving, 16 MP at bed size (`R-ph-p16-bed`, 2 sets) | Open / On material | 2,472 / 3,054–3,125 | | ≤ 61 | 0.99 GB | Pass |
| Photo engraving, 4096 benchmark at bed size (`R-ph-b4k-bed`) | Open / On material | 1,740 / 2,302 | | ≤ 75 | 0.88 GB | Pass |

### Dithers, core cost (Node; `dither()` on the engraving grid; median of 5; main / 1.0.28 / 1.0.23)

| Mode | 100 mm (1000 × 750) | Bed (4000 × 3000) | Same output in all three | Verdict |
|---|---|---|---|---|
| Threshold | 1.3 ms | 25 ms | yes | Pass |
| Ordered | 3.1 | 44 | yes | Pass |
| Grayscale | 5.5 | 71 | yes | Pass |
| Blue Noise | 13 | 217 | **no** (output changed since 1.0.23, same speed) | Pass |
| Sierra Lite | 20 | 357 | yes | |
| Floyd-Steinberg | 29 | 410 | yes | |
| Atkinson | 34 | 633 | yes | |
| Sierra 2 | 38 | 672 | yes | |
| Burkes | 40 | 784 | yes | |
| Sierra 3 | 54 | 1,021 | yes | |
| Stucki | 62 | 1,136 | yes | |
| Jarvis | 64 | **1,140** | yes | Bed-sized jobs: where this runs on the UI thread (job Preview, S4-P3-1) it adds up to 0.7 s over Floyd-Steinberg |

All 12 modes are within 6% of both releases (the run's calibration ended at 42 ms).

### Measurement method

Harness: `scratchpad\zz-s5\`.
- **Engine.** `build-engines.mjs` bundles `traceImageToColoredPaths`, `TRACE_PRESETS`, `mergeLightBurnTraceSettings` and `resolveFrozenTraceSourceOptions` from each tree with esbuild 0.28.1, as `scripts/trace-bench.mjs` does. `inputs5.mjs` makes the inputs; `tb5.mjs <set> <preset> <trees> <runs> time|block` runs one process per set and preset, alternating the trees each round, dropping each tree's first run per image and hashing the paths' JSON.
  - The 12 MP photo is the astronaut asset enlarged to 4000 × 3000, so it is a real photo at phone size.
  - `block` mode uses the cooperative runner's rule (yield on a timer once 8 ms have passed) and records the longest stretch from the call.
- **Potrace.** `pt5.mjs` runs `potrace -s` on a PBM (binary sets) or PPM, and `mkbitmap` then `potrace` (Q5's `P-mk`), per process with `spawnSync`. An 8 × 8 floor run measures process start (8.1–8.5 ms).
- **Profiles.** `prof-sharp.mjs` with `node --cpu-prof`, read by `top-prof.cjs`.
- **Browser.** `run5.mjs` (S4's `run.mjs` with the ops `trace`, `photo`, `studio` and `mkimg`), S4's `page-init.js` plus S5 probes: the trace status's `data-state`, the photo preview state, timed large canvas draws, and a switch that makes the trace worker's constructor throw.
  - Projects: each build imported and saved its own 4000 × 3000 JPEG of the astronaut (`mk-all.sh`); `mk-img.mjs` places it at 100 mm wide or as imported (400 × 300 mm).
- **Analysis.** `anal5.mjs`, `cmp-pt.mjs`, `sum5.mjs` and `dither5.mjs`.

## Findings

### S5-P2-1 — Image Studio recomputes the whole document on the UI thread for every slider step: at a 12 MP photo each step of Brightness / Contrast, Levels or Threshold blocks 154–275 ms and shows 172–370 ms after the input

- **Where:**
  - `src/ui/image-editor/AdjustDialog.tsx:48`: every parameter change schedules `refreshAdjustPreview` 16 ms later (`PREVIEW_DEBOUNCE_MS`, `:168`).
  - `src/ui/image-editor/adjust-dialog-store.ts:112-119` (`refreshAdjustPreview`) calls `computeAdjustPreview` synchronously.
  - `src/ui/image-editor/editor-adjust-session.ts:59-70`: `cloneRgbaBuffer(session.doc)` (48 MB at 12 MP), the adjustment over every pixel, then `compositeSession` over every layer into a new buffer.
  - `src/ui/image-editor/EditorCanvas.tsx:51-56` → `editor-canvas-draw.ts:43` (`docToCanvas`): the composite is copied once more into a new `ImageData` and drawn into a new document-sized canvas.
- **Anchor:** AREAS budgets: 100 ms from input to visible response, 200 ms longest block while designing. A slider is the case the first budget names.
- **Scenario:** a user opens a phone photo in Image Studio and drags Levels' gamma or Threshold's level to find the right setting. Each step freezes the window for about a quarter of a second, so the drag jumps 3–6 times a second and the slider lags the pointer.
- **Evidence:** **REPRO**, one clean run (`smoke-st2`; calibration 35 and 39 ms; `smoke.jsonl`).

  | Step | Shown | Longest block |
  |---|---|---|
  | Brightness 10, 20 | 177, 172 ms | 158, 154 ms |
  | Gamma 1.2 | 301 ms | 202 ms |
  | Level 100 | 370 ms | 275 ms |

  - Each step's block starts 5–24 ms after the input and is followed by the 48 MB `putImageData` (the `draws` trail).
  - Chrome's memory rose with each step: 1.01 → 1.30 → 1.34 → 1.52 → 1.66 GB. Each step allocates three document-sized buffers.
  - The 4096 × 4096 image and the trend sets could not be run (Machine state). The code path is the same in both releases (`zz-s2-old\…\editor-adjust-session.ts`), so it is not expected to be a regression.
- **Severity:** **P2**: an ordinary operation over three times its budget (Levels 3.0 ×, Threshold 3.7 × the 100 ms response budget; blocks 1.0–1.4 × the 200 ms budget). Brightness alone would be P3 (1.7 ×). The evidence is a single run; a refuter should repeat it on a quiet PC.
- **Fix direction** (no output change: the same adjustment code runs; prove the committed pixels are identical):
  - Run `computeAdjustPreview` in a worker, keeping only the newest request.
  - Or compute the preview on the visible, view-scaled region first and the full document on OK. The commit already runs the full adjustment once.
  - Reuse one preview buffer and one canvas instead of allocating three document-sized ones per step.
  - Budget: under 100 ms to the first visible update and no block over 50 ms per step at 12 MP.

**Refuter (2026-11-04): CONFIRMED P2** because a quiet-PC repeat (5 kept runs of 6, calibration 37–41 ms) is slightly worse than the auditor's single run, and Threshold alone is over three times the response budget.
- **Code** (origin/main `1bae65939`; no `src` file changed since `a96bc8950`): as cited. `AdjustDialog.tsx:46-50` (16 ms timer), `adjust-dialog-store.ts:112-119`, `editor-adjust-session.ts:59-71`, `EditorCanvas.tsx:51-56`, `editor-canvas-draw.ts:37-46`. One correction: for a single opaque layer `compositeSession` returns the clone itself (`editor-composite-identity.ts:5-19`, after an alpha scan of the whole buffer), so the three document-sized allocations per step are the clone, the `ImageData` copy and the new canvas, not a fresh composite.
- **A cause the report missed.** `AdjustDialog.tsx:175-190`: the Levels and Threshold histogram is drawn from an inline `ref` callback, so React calls it again on every render. Each step therefore recomputes `lumaHistogram` over the whole 12 MP document, on the parameter change and again when the preview buffer lands. The comment at `:173` says the histogram reflects the document at dialog-open time, so this work is never needed.
  - Measured: every Levels and Threshold step starts with an 82–93 ms task 6–13 ms after the input, which Brightness (no histogram) never has.
  - CPU profile of a Gamma step (`zz-s5r\prof-R-st-prof*-Levels_Gamma_1_4-r1.json`, source-mapped): `lumaHistogram` (via `AdjustDialog.tsx:183`) 306–327 ms inclusive against 256–274 ms for `computeAdjustPreview` (sampling at 200 µs inflates both).
- **Re-measured** (`R-st-p12#2`; `zz-s5r\results.jsonl`; median of 5 (range); shown is the first document-sized `putImageData` plus the draw):

  | Step at 12 MP | Shown | Longest block | Against 100 ms |
  |---|---|---|---|
  | Open Image Studio | 421 (390–467) | 205 (189–228) | |
  | Brightness 10 / 20 / 30 / 40 | 193 / 192 / 198 / 188 (118–211) | 175 / 174 / 180 / 170 | 1.9–2.0 × |
  | Brightness 50 / 60 | 122 / 120 (113–239) | 105 / 102 | 1.2 × |
  | Levels Gamma 1.2 / 1.4 / 1.6 | **290 / 294 / 287** (277–304) | 185 / 189 / 186 (178–201) | 2.9 × |
  | Threshold 100 / 140 / 180 | **411 / 414 / 408** (385–444) | **307 / 310 / 306** (283–334) | **4.1 ×**; block 1.5 × 200 ms |

- **Memory: collected, not leaked, but over budget at its peak.** Within one dialog Chrome's private bytes climb 50–250 MB a step. Run peaks were 1.47, 1.55, 1.53, 1.66 and 2.20 GB (4 of 5 over 1.5 GB; median 1.55 GB). Four seconds after Cancel they fall back to 1.17–1.44 GB (one run held 2.0 GB after its first dialog and was back at 1.26 GB after the third), and the run ends at 1.08–1.22 GB with the renderer at 394–486 MB. Repeated dialogs do not ratchet: run 5 ended lower than run 1.
- **Larger and trend** (both new):
  - **4096 × 4096** (`R-st-b4k`, median of 4 runs, 2 of them within calibration): Brightness 188–400 ms (block 169–381), Levels 358–382 ms (block 271–286), **Threshold 492–570 ms (block 400–475)**, open 991 ms (block 543 ms). Chrome peaked at 1.50–1.83 GB in every run.
  - **Not a regression; main is faster.** 1.0.28 (`R28-st-p12`) and 1.0.23 (`R23-st-p12`), their own projects of the same 12 MP JPEG, median of 4: Brightness 10 at 401 and 352 ms (main 193), Levels 1.2 at 391 and 332 (main 290), Threshold 100 at 511 and 496 (main 411), open 988 and 826 (main 421). Peaks were 2.0–2.65 GB and 1.3–2.0 GB.
- **Severity:** P2 stands. The median Threshold step takes 4.1 × the 100 ms response budget and blocks 1.5 × the 200 ms budget. Levels is 2.9 ×, just under the P2 line; Brightness alone would be P3.
- **Fix direction, added:** memoise the histogram once per dialog open, keyed on the session revision. This changes no pixels and should remove about 80 ms from each of the two renders in every Levels and Threshold step, before any worker move.

### S5-P3-1 — Sharp traces large pages 1.7–2.6 × slower than 1.0.28 for byte-identical paths: the ADR-530 Amendment 13 clean-art check prepares the source a second time before every trace

- **Where:**
  - `src/core/trace/trace-to-paths.ts:170` calls `asCleanArtWhereTwoLevel` for every binary contour preset.
  - `src/core/trace/trace-clean-art.ts:22-23`: `prepareContourTraceInput(image, options)` (the whole Otsu, flatten and threshold preparation), then `cleanStaircaseSource`. For Sharp, the prepared input is not carried (`:21`, only `supersampleContour` presets carry it), so the trace prepares it again.
  - `src/core/trace/staircase-source.ts:97` (`isCleanArt`) is checked only after that preparation. On a source with any grey edge it goes on to `withRingingInk`, `forEachCrack`, `passesStepShare` and `plateauTones` (`:102-110`, `:316-381`).
- **Anchor:** AREAS P2 names "a slowdown of two times or more since 1.0.23 with no reason in an ADR". ADR-530 Amendment 13 gives the reason ("A binary contour preset prepares the source once more on every trace (Sharp's input is prepared twice)") but no cost, so this is P3.
- **Evidence:** **REPRO**, engine bench (alternating trees, median of 3) and CPU profiles (`out\prof\sharp-bench*.cpuprofile`).
  - 4096 benchmark at the 2048 preview edge: **542 ms against 210 ms** (1.0.28) and 223 ms (1.0.23). The paths are identical to 1.0.28's.
    - Profile: `asCleanArtWhereTwoLevel` takes 320 ms of each trace. `cleanStaircaseSource` takes 229 ms of that, and the rest is the extra preparation.
    - The edge pixels there are grey, from the downscale the preview decode also makes, so the step scan runs.
  - Same image at 4096 (pure black and white, so `isCleanArt` stops the scan): **1,025 ms against 597 ms**, identical paths. Profile: `prepareTraceForContour` runs twice (2,753 against 1,360 ms inclusive over four traces).
  - Q4 (clean art, small): 1.08 × with 72/72 identical.
  - Other sets show 1.2–1.8 × with changed output (Amendments 11–14 change Sharp's paths too), so the overhead cannot be separated there.
  - Line Art and Smooth carry the prepared input, so they pay only the step scan. On the same 2048 image they are 1.12 × 1.0.28, but with changed paths, so the share cannot be isolated.
- **Severity:** **P3.** It runs in the worker, with a progress card and Cancel, so it is not a block. An ADR states the cause. On a large page it adds 0.3–0.4 s to every Sharp preview and re-trace.
- **Fix direction** (no output change; prove with the path hashes, as `tb5.mjs` does):
  - Check `isCleanArt(image)` and the other cheap refusals before `prepareContourTraceInput`.
  - Hand the prepared native input to Sharp's trace, as the enlarging presets already get it.
  - Budget: Sharp on the 4096 benchmark within 1.1 × of 1.0.28 at both sizes.

**Refuter (2026-11-04): CONFIRMED P3** because the same-path slowdown re-measures at 2.4–2.5 × (2048) and 1.6 × (4096), and the cause is one an ADR names.
- **Code** (origin/main): as cited. `trace-to-paths.ts:170`; `trace-clean-art.ts:18-29` (`carried` keeps the prepared input only when `supersampleContour` is set, `:20-21`); `staircase-source.ts:91-108` (`isCleanArt` at `:97`, after the caller has already prepared the input).
- **Re-measured** (`zz-s5r\out\tb5-time.jsonl`; the three trees alternate in one process, so ratios hold while the clock falls):

  | Input | main | 1.0.28 | 1.0.23 | main / 1.0.28 | Paths |
  |---|---|---|---|---|---|
  | 4096 benchmark at 2048, 5 runs | 583 ms | 243 | 236 | **2.40 ×** | main = 1.0.28 (`d5f1839a…`); 1.0.23 differs |
  | Same, 7 runs (the first three rounds before the clock fell: 486–492 against 206–235) | 690 | 274 | 279 | **2.52 ×** | same |
  | 4096 benchmark at 4096, 5 runs | 1,524 | 952 | 932 | **1.60 ×** | main = 1.0.28 (`04261dbb…`) |

  Calibration rose from 35–38 to 48–61 ms inside each set, on an idle PC (load 1–12%, no other tooling). This is the clock fall the auditor describes. Absolute times read about 1.2–1.5 × high, so only the ratios are used.
- **Profile** (`zz-s5r\out\prof\CPU.20261104.173320…` against `…173413…`, three traces each): `asCleanArtWhereTwoLevel` takes 1,307 ms of main's 2,283 ms (327 ms a trace). Of that, `cleanStaircaseSource` takes 933 ms (`passesStepShare` 531 ms, `withRingingInk` 255 ms) and `prepareContourTraceInput` 374 ms. 1.0.28 spends 946 ms in all. The auditor's 320 / 229 ms split holds.
- **Weighing AREAS' P2 line:** main is also 2.4–2.5 × 1.0.23 at the 2048 edge, so "two times or more since 1.0.23" is met. But 1.0.23's paths differ from main's, and the second condition, "with no reason in an ADR", is not met: ADR-530 Amendment 13 Consequences (`ADR-530…md:1106-1107`) names the extra preparation on every trace. It runs in the worker behind the progress card and Cancel, and adds 0.3–0.6 s to a large Sharp preview. So it is P3 (a measured cost the ADR does not size), not P2.

### S5-P3-2 — The cooperative fallback still traces in stretches of up to 205–285 ms at the inline limit (Q5-P3-3, KNOWN)

- **Where:** `src/ui/trace/use-trace-worker-client.ts:105` (`MAX_INLINE_TRACE_PIXELS = 160_000`), `:362` (`resolveFrozenTraceSourceOptions`, synchronous) and `:368`; `src/ui/trace/cooperative-trace-runner.ts:5` (`SLICE_MS = 8`).
  - The synchronous prelude of `traceImageToColoredPaths` (`trace-to-paths.ts:159-185`) runs before the runner gets its first step: the source decisions, `asCleanArtWhereTwoLevel` (S5-P3-1) and the scale plan. Since Q5 it has grown by the clean-art check.
- **Evidence:** REPRO (engine emulation of the runner, `tb5.mjs … block`).
  - Smooth on Q5-P3-3's 400 × 400 crop: **206–285 ms** (Q5: 300–340).
  - Line Art: 56–106 ms there, and **205 ms** on Q5's 400 × 240 colour case (Q5: 117–128 ms on the crop).
  - 18–19 of 29 inline-size Q5 cases exceed 50 ms on Line Art and Smooth. The other presets stay under 50 ms there.
  - The same in 1.0.28 and 1.0.23 (Smooth 205 and 251 ms).
- **Severity:** P3, KNOWN (Q5-P3-3, not fixed). The route is only taken when the trace worker cannot start.
- **Fix direction:** Q5's refuter's: bring the prelude into the stepped pipeline, so the runner can yield inside it. Budget: no stretch over 50 ms at the inline limit.

**Refuter (2026-11-04): CONFIRMED P3 (KNOWN Q5-P3-3)** because the engine emulation repeats, and the in-app fallback, which the auditor could not run, blocks longer than the emulation.
- **Code** (origin/main): `use-trace-worker-client.ts:105` (`MAX_INLINE_TRACE_PIXELS = 160_000`), `:352-370` (`traceInline`: `resolveFrozenTraceSourceOptions` synchronously at `:362`, then the runner at `:368`); `cooperative-trace-runner.ts:5,13` (8 ms slices, deadline set when the runner is made). The prelude at `trace-to-paths.ts:159-185` runs before the first `steps.next`.
- **Engine** (`tb5.mjs slice … block`; ratios only, calibration 36 → 57 inside the set on an idle PC): Smooth on the 400 × 400 crop **301 ms** (221–329) on main, 362 on 1.0.28 and 346 on 1.0.23. Line Art 81 ms (74–112), 88 and 156.
- **In the app, worker disabled** (new; `R-fb-astro400` Free and `RD-fb-astro400` desktop build; median of 4 runs (range); calibration before each run 36–41 ms):
  - Free, Line Art: open **263 ms** (259–349); re-traces 197, 166 and 146 ms (139–201); commit 70 ms with no block (it reuses the preview).
  - Pro presets: **Smooth 311 ms** (305–341), Edge Detection 107, Colour layers 94, Centerline 70, Sharp 65, Line + fill 65, Photo shading 0.
  - Line Art in the app is 3 × the emulation (263 against 81 ms). The emulation omits the dialog's own synchronous work around the trace; it was not profiled.
- **Severity:** P3 stands. The worst stretch is 1.6–1.7 × the 200 ms budget, and the route runs only when the trace worker cannot start.

### S5-P3-3 (refuter, new) — On the worker route, tracing a phone photo or a 4096 page blocks the window 300–500 ms when Trace is pressed, and Chrome peaks at 1.9 GB

- **Where:**
  - `src/ui/trace/trace-commit-at-grid.ts:104-109` (`traceDecoded`): the commit decodes the source again at the burn grid with `loadImageAsRawData`, on the UI thread.
  - That runs `decodeImageOntoCanvas` (`src/ui/trace/image-loader.ts:108`) → `readCompositedPixels` (`:275-285`: one `getImageData` of the whole grid) → `compositeRgbOverWhitePreservingAlpha` (`:287-…`: a per-pixel loop into a new buffer).
  - Only then does the trace go to the worker. #1557 (S3-P2-1) moved the import's luma pass off this path, but not the dialog's own decode.
- **Anchor:** AREAS: 200 ms longest UI block while designing; 1.5 GB peak memory.
- **Evidence:** **REPRO + PROFILE** (Free build `zz-s4\dist-main`; median of 4 runs (range); calibration before each run 36–41 ms).
  - The commit's first task starts 53–83 ms after the click. 12 MP JPEG (`R-tr-p12`): **335 ms** (318–497, one 697 ms in the second attempt). 4096 benchmark (`R-tr-b4k`): **342 ms** (309–391).
  - Source-mapped profile of the 4096 commit (`zz-s5r\prof-R-tr-b4k-prof-commit-r1.json`): `decodeImageOntoCanvas` 308 ms inclusive, of which `getImageData` 151 ms and `compositeRgbOverWhitePreservingAlpha` 130–154 ms.
  - Commit to dialog closed: 6.95 s (12 MP) and 3.46 s (4096). The status shows "decoding" (`trace-commit-at-grid.ts:108`), but the block freezes that status too.
  - Chrome peaks at commit: **1.67–1.95 GB** (12 MP) and 1.75–1.92 GB (4096), with the renderer at 1.0–1.4 GB. The preview stage stays at 1.1–1.3 GB.
  - Opening the dialog blocks once as well, 222 ms (203–230) at 12 MP and 264 ms (242–324) at 4096. This is likely the same decode at the 2048 preview edge; it was not profiled.
  - Pro presets at 12 MP (desktop build, `RD-tr-p12`): Colour layers' result (4,505 paths, 95,942 nodes) blocks **311–343 ms** (298–358) when it arrives. The other presets stay at or under 86 ms.
- **Trend:** not a regression in the block.
  - 1.0.28 (`R28-tr-p12#2`): commit block 296 ms (256–405), Chrome 2.2 GB.
  - 1.0.23 (`R23-tr-p12`): 277 ms (259–291), 2.1 GB.
  - Main's commit takes longer in total, 6.95 s against 4.19 s and 4.28 s (1.6 ×), with different output (ADR-530 Amendments 11–14).
- **Severity:** **P3.** The block is 1.7 × the 200 ms budget, once per commit and once per open, behind a status line. Memory is 1.3 × the 1.5 GB budget. Not ordinary-size input: 512–1024 px images commit in 62–95 ms with no block.
- **Fix direction** (no output change; keep the GPU and CPU decode bytes as `image-loader.ts:104-106` requires):
  - Decode with `createImageBitmap` and read and composite the pixels in the trace worker (an `OffscreenCanvas` there).
  - Or reuse the import's already-decoded pixels when the burn grid equals the source.
  - Budget: no block over 100 ms on commit at 12 MP, and under 1.5 GB.

## Trend

main / 1.0.28 / 1.0.23. Engine rows from the alternating bench; browser rows only where clean.

| Row | main | 1.0.28 | 1.0.23 | Output | Verdict |
|---|---|---|---|---|---|
| Q4, all presets (sum) | 0.83–1.08 × 1.0.28 | | | 54–72 of 72 identical to 1.0.28 | Flat |
| Q5 Line Art / Smooth | 8.2 / 8.6 s | 7.2 / 8.1 s | 7.2 / 8.8 s | 4 and 7 of 40 identical | 1.06–1.14 ×, quality change (ADR-530 Amd 11–14) |
| Q5 Sharp | 3.9 s | 2.9 s | 3.1 s | 0 of 40 | 1.38 ×, quality change, with S5-P3-1 inside |
| Q5 Centerline, Line + fill, Edge, Colour, Photo shading | | | | 20–40 of 40 | Flat (0.99–1.02 ×) |
| Full size, all presets | 1.0–1.2 × (Sharp 1.18 ×) | | | 0–5 of 5 | Flat or quality change |
| 12 MP photo at 2048, Sharp | 912 ms | 559 | 572 | different | 1.63 ×, quality change plus S5-P3-1 |
| 4096 benchmark, Sharp | 542 / 1,025 ms | 210 / 597 | 223 / 617 | **identical to 1.0.28** | **S5-P3-1** |
| Cooperative fallback, Smooth, 400 × 400 | 272 ms | 205 | 251 | | Flat (KNOWN) |
| Dithers, 12 modes, both sizes | | | | identical except Blue Noise | Flat (within 6%) |
| Trace dialog, arch logo, Line Art (browser) | open 1.95 s; re-trace 1.31–1.44 s | open 1.74 s; re-trace 1.19–1.32 s (n=1) | not clean | different (1,130 against 1,113 nodes) | about 1.1 ×, quality change |

Nothing is two times slower than 1.0.23 on a preset's ordinary set. The only same-output slowdown is S5-P3-1.

## KNOWN re-observed

- **Q4-P2-1 (speed part): tracing is about 10 × slower than Potrace.**
  - Now: Line Art is 8 × Potrace per process on the Q5 set (16 ms against 127 ms median) and 2.6 × the `mkbitmap` pipeline.
  - On the 7 real crops it takes 63–955 ms (median 171) against 9–29 ms. Q4 measured a median of 455 ms on these crops; the 1.0.28 bundle measures the same as main here (sum 0.996 ×), so the difference is method, not a speed-up.
  - On the arch logo it is 21 × (1,469 against 70 ms). At the 4096 benchmark, 3.0 ×.
  - The worker keeps the window responsive throughout, with a progress card and Cancel, so no UI budget is missed. Q4's quality fix direction (trace two-level art natively) also governs speed.
- **Q5-P3-3: the cooperative fallback blocks.** Re-measured as S5-P3-2 (still 206–285 ms for Smooth). Listed as a finding because the prelude has grown since Q5.
- **S4-P3-1: photo Preview compiles the raster on the UI thread.** The dither table above sizes the per-mode part. At bed size, Jarvis or Stucki would add about 0.7 s to S4's 673–737 ms block with Floyd-Steinberg. The per-mode Preview was not measured in the browser (Not verified).

**Refuter (2026-11-04) on the KNOWN items and the Potrace comparison:**
- **Q4-P2-1 speed / "slow next to Potrace": CONFIRMED.**
  - Potrace 1.16, the scratchpad binary run as a black box with `pt5.mjs` (`zz-s5r\out\pt5.jsonl`): process start 8.7–9.3 ms. Arch logo 71 ms plain and 161 ms with `mkbitmap`. Q5 median 22.5 ms plain and 69.5 ms with `mkbitmap`. Full-size sum 586 ms.
  - Line Art on main (`tb5.mjs`): Q5 median 179 ms (7.9 × plain, 2.6 × `mkbitmap`; the auditor had 8 × and 2.6 ×). Full-size sum 8,073 ms (13.8 ×; auditor 12.2 ×).
  - The arch logo took 2,244 ms at a calibration of 59 ms. Scaled to the 36 ms idle floor that is about 1,370 ms, or about 19 ×; the auditor had 21 ×.
  - Both sets ended at a calibration of 57–59 ms (the clock fall, on an idle PC), so their absolute times read high. Potrace's sets are short, so its times do not.
- **Q5-P3-3: CONFIRMED** as S5-P3-2, now also measured in the app.
- **S4-P3-1: partly re-observed.** The job Preview per mode was again not run. In the Photo engraving window, which compiles in a worker, Stucki and Jarvis take 3.2–3.4 s at bed size against 1.8–1.9 s for Floyd-Steinberg (+1.3–1.5 s), with no long task. That is consistent with the core table's ranking, with the window's own costs on top.

## Refuted

- **"Main traces 1.1–1.6 × slower than 1.0.28 (Q5 Line Art and Sharp, the 12 MP photo)."** The paths differ on almost every image: ADR-530 Amendments 11–14 changed the traced curves (Q4/Q5 and rolling-v9 fixes). That is a quality change, not a speed regression. Only S5-P3-1 compares identical paths.
- **"The browser calibration shows the PC slowing by 20–150% from 06:50."** This is other processes: OneDrive's sync service, then other sessions' tests and measuring harnesses (Machine state). Those sets are discarded, not reported.
- **"Engine calibration drifts to 42–47 ms in long sets because the PC is busy."** These happened with no other tooling running and under 30% load. A long single-thread set lowers this laptop's clock. The alternating design keeps the ratios.
- **"1.0.23's Trace never finishes committing."** That was a harness condition: 1.0.23 replaces the image on commit, so the object count does not change. The condition is now "dialog closed".

## Verified clean

- **The trace worker route:** no main-thread long task while tracing, re-tracing or committing at 512–1024 px in either build measured. Chrome stays at 0.55–0.84 GB. Commit reuses the preview's trace (62–95 ms) when the preview grid is the burn grid.
- **Pro presets' results arriving:** Smooth, Colour layers (1,820 paths, 28,974 nodes) and Photo shading (162,950 nodes) draw with at most one 50 ms task on the 512 px photo (n=1).
- **Engine determinism:** every image in every set gave one hash across all runs, in all three trees.
- **Photo engraving window at 100 mm:** status within 31 ms; tones, dithers and On material shown in 0.45–0.52 s; no long task (n=1).
- **Dither core:** 12 modes, both sizes, the same speed in all three builds and byte-identical output except Blue Noise.
- **Potrace comparison inputs:** the PBMs are written from the same masks Q4 used, and the floor run isolates process start.
- **Photo engraving window at bed size (refuter, 2026-11-04):** 12 MP, 16 MP and the 4096 benchmark at 400 × 300 mm. Status shows within 4–54 ms, the result in 1.2–3.4 s, no task over 75 ms, and Chrome at or under 1.19 GB.

## Not verified

- **Most browser sets** (Machine state: from 07:27 the PC had no quiet window long enough). Specifically:
  - the trace dialog at the 12 MP photo and the 4096 benchmark (preview at 2048, commit at full size), and its memory;
  - the Pro presets on large images, and Pro commits at full size;
  - the cooperative fallback in the app (worker disabled), Free and Pro;
  - Image Studio at 4096 × 4096, and its trend in 1.0.28 and 1.0.23;
  - the Photo engraving window at bed size, at 4096 × 4096 and at 16 MP (On material);
  - job Preview per dither mode;
  - every browser trend row except those listed.
- **The packaged desktop app.** Pro rows come from a desktop-mode bundle in Chrome.
- **Q4's glyph images** (15) were left out of the Q4 set.
- **Peak memory of a trace in the worker** (Node `maxRSS` per set is in `out\tb5-*.jsonl` `cal` rows; the browser's worker memory was not attributed).
- **Refuter update (2026-11-04).** Now run, from `q-b3.txt` and in its order (see Refuter rows):
  - Image Studio at 12 MP (repeat), at 4096, and in 1.0.28 and 1.0.23;
  - the trace dialog at 12 MP (main, 1.0.28, 1.0.23) and at 4096 (main);
  - the cooperative fallback in the app (Free and Pro);
  - the Pro presets at 12 MP;
  - the Photo engraving window at bed size for the 12 MP photo, the 16 MP photo and the 4096 benchmark.

  **Still not run:**
  - job Preview per dither mode (`PV-*`);
  - the Photo engraving window at 100 mm (repeat), for 16 MP and 4096 at 100 mm, and its 1.0.28 and 1.0.23 rows;
  - the trace dialog at 4096 in 1.0.28 and 1.0.23;
  - the astronaut and arch-logo trace rows in 1.0.23, and Pro presets on the arch logo, the astronaut and the 4096 benchmark;
  - Pro commits (`D-cm-*`);
  - the fallback in 1.0.28 and 1.0.23.

  Quiet windows were scarce (Machine state); the sets above came first by priority.

## Refuter summary

- **Refuter:** fresh session, 2026-11-04 11:50–18:15 +0800. Tree origin/main `1bae65939`; `git diff a96bc8950 1bae65939 -- src` is empty, so the auditor's builds were reused. The `j7-main` files under every trace, image, raster, job and import directory hash-equal origin/main.
- **Verdicts:** 3 of 3 findings confirmed at their severity, 0 refuted, 0 severity changes. The 3 KNOWN items and the Potrace comparison are confirmed. One new P3 (S5-P3-3).
  - **S5-P2-1: CONFIRMED P2.**
    - Quiet repeat, n=5: Threshold 408–414 ms to shown (4.1 × the 100 ms budget), blocks 306–310 ms. Levels 287–294 ms (2.9 ×), blocks 185–189 ms. Brightness 120–198 ms.
    - Memory peaks 1.47–2.20 GB inside a dialog and is collected after Cancel (1.08–1.22 GB at the end), so it is not a leak.
    - A missed cause: the histogram's inline `ref` (`AdjustDialog.tsx:183`) recomputes a whole-document `lumaHistogram` on every render, more than half of each Levels or Threshold step.
    - Not a regression: 1.0.28 and 1.0.23 are slower at every step.
  - **S5-P3-1: CONFIRMED P3.**
    - Sharp is 2.40–2.52 × 1.0.28 at the 2048 edge and 1.60 × at 4096, with path hashes identical to 1.0.28's.
    - It is also 2.4–2.5 × 1.0.23, but the second half of AREAS' P2 line ("no reason in an ADR") fails: ADR-530 Amendment 13 names the double preparation.
  - **S5-P3-2: CONFIRMED P3 (KNOWN Q5-P3-3).** In the app, the worker-less route blocks 263 ms (Line Art, Free) and 311 ms (Smooth, Pro) at 400 × 400.
  - **S5-P3-3 (new) P3.** Committing a 12 MP or 4096 trace blocks the window 335–342 ms on a main-thread decode (`image-loader.ts:275-296` via `trace-commit-at-grid.ts:109`), and Chrome peaks at 1.9 GB. Colour layers' 96k-node result blocks 311–343 ms at 12 MP. The block is the same in 1.0.28 and 1.0.23.
- **New "verified clean":** the Photo engraving window at bed size, for the 12 MP and 16 MP photos and the 4096 benchmark. Status shows in 4–54 ms and the result in 1.2–3.4 s, with no task over 75 ms and Chrome at or under 1.19 GB.
- **Machine state** (`zz-s5r\machine-state.log`, `zz-s5r\sampler.log`: a sample every 30 s):
  - No auditor harness process was running at the start. The auditor's leftover `until … q-b*.done` watcher shells were left alone; the refuter used its own queue files, so none of them fired.
  - Waits for a quiet window (no other tooling, harness or Chrome; ≥ 3 GB free; three checks 20 s apart): 940, 806, 839 and 2,544 s, then **10,539 s** (13:27–16:23).
  - In those waits, other sessions ran `vitest src/ui/state` and `src/ui/laser`, `tsc`, a Playwright e2e suite (14:48–16:20, with its own Chrome), and the recovery-archive fix session's `r.mjs` with Chrome (14:19 onward).
  - Free memory fell to 11–37 MB at 14:14–14:16, with no refuter process running.
  - From 13:52 the gate's CPU limit was raised from 35% to 45%. OneDrive's sync service holds about one core, which leaves the load at 30–40% with nothing else running. The per-run calibration check still decides what is kept.
  - One Image Studio attempt was skipped at 2,023 MB free (12:25).
  - The first making of the 16 MP project hit the 450 MB watchdog (186 MB free at 12:10, when another session started); it was remade at 17:35.
  - 1.0.28's first 12 MP trace attempt overlapped the refuter's own profile retry for about a minute. It is discarded, and `R28-tr-p12#2` is used.
- **Calibration:**
  - Browser sets kept only runs whose calibration before the run was 36–41 ms. The high after-run calibration after trace and photo commits is explained under Refuter rows.
  - Every Node set started at 35–43 ms and ended at 48–61 ms on an idle PC. The trees alternate within each set, so only ratios are quoted from these sets.
- **Files:** `scratchpad\zz-s5r\`.
  - `rq.sh` is the gated queue; the queues are `q-r1.txt`, `q-r2.txt` and `q-r3.txt`.
  - `run5.mjs` adds the after-Cancel memory reading. `sumr.mjs` and `med.mjs` summarise.
  - Results are in `results.jsonl`, `out\tb5-*.jsonl`, `out\pt5.jsonl` and `made.jsonl`.
  - Profiles are `prof-R-*.json` (Chrome, source-mapped with `map-profile.cjs`) and `out\prof\*.cpuprofile` (Node).
  - The photo projects (278 MB), Potrace's temporary files and the engine bundles were deleted; `mk-all.sh` and `build-engines.mjs` remake them.

## Re-running

From `scratchpad\zz-s5`.
- **Hosts:** `node host.mjs ../zz-s4/dist-main 4851`, `node host.mjs ../zz-s1/dist-33bc394c6 4852`, `node host.mjs ../zz-s1/dist-87ecb4f24 4853`, `node host.mjs dist-desktop 4854`.
- **Builds:** `node build-engines.mjs`. The desktop bundle, from `j7-main`: `node --max-old-space-size=6144 node_modules/vite/bin/vite.js build --config <zz-s5>/zz-s5-vite.config.mts --outDir <zz-s5>/dist-desktop --emptyOutDir --sourcemap hidden --mode desktop`.
- **Engine:** `./nodeq.sh q-node2.txt`, then `node anal5.mjs time`, `node anal5.mjs block`, `node anal5.mjs pt`, `node cmp-pt.mjs q5`, and `node dither5.mjs 5`.
- **S5-P3-1:** `node tb5.mjs bench2048 Sharp main,r28 3 time`, and `node --cpu-prof --cpu-prof-dir=out/prof prof-sharp.mjs main bench2048 Sharp` with `r28`; read with `node top-prof.cjs <file>`.
- **Projects:** `./mk-all.sh` (imports, saves, and runs `mk-img.mjs`); `node mk-dither.mjs main-p12-100 <modes>` for the per-mode projects.
- **Browser:** `./queue5.sh q-b3.txt` (prioritised, gated), then `node sum5.mjs '<label regex>'`.
- **S5-P2-1** first:

  ```
  node run5.mjs '{"base":"http://127.0.0.1:4851/","label":"X-st","op":"studio","file":"main-p12-100.lf2","studio":[{"menu":"Adjust","item":"Brightness / Contrast","slider":"Brightness","values":[10,20,30]},{"menu":"Adjust","item":"Levels","slider":"Gamma","values":[1.2,1.4,1.6]},{"menu":"Adjust","item":"Threshold","slider":"Level","values":[100,140,180]}],"runs":4}'
  ```

```json
{
  "area": "S5-trace-image",
  "tree": "a96bc8950",
  "builds": { "free": "zz-s4/dist-main (c47579cb4; no measured file changed since)", "pro": "zz-s5/dist-desktop (--mode desktop, edition policy flipped by the harness config)", "trend": ["1.0.28 33bc394c6", "1.0.23 87ecb4f24"] },
  "counts": { "raised": 4, "refuted": 0, "P1": 0, "P2": 1, "P3": 3, "known": 3 },
  "refuter": { "date": "2026-11-04", "tree": "1bae65939", "confirmed": 3, "refuted": 0, "severity_changes": 0, "new": ["S5-P3-3"], "s5_p2_1_n5": { "threshold_shown_ms": [408, 414], "threshold_block_ms": [306, 310], "levels_shown_ms": [287, 294], "brightness_shown_ms": [120, 198], "chrome_peak_gb": [1.47, 2.2], "collected_after_cancel": true, "histogram_ref_recompute": "AdjustDialog.tsx:183" }, "s5_p3_1_ratio_vs_1028": { "bench2048": [2.4, 2.52], "bench4096": 1.6 } },
  "budgets": { "response_ms": 100, "design_block_ms": 200, "memory_gb": 1.5 },
  "machine": "quiet 04:58-06:29 (engine sets); OneDrive sync from 06:50; other sessions' vitest/tsc and two fix sessions' measuring harnesses 07:27-11:45 (browser sets mostly discarded or not run)",
  "potrace": { "q5_line_art_median_ms": { "kerfdesk": 127, "potrace": 16, "potrace_mkbitmap": 48 }, "arch_logo_ms": { "kerfdesk_line_art": 1469, "potrace": 70, "potrace_mkbitmap": 152 }, "bench4096_ms": { "kerfdesk_line_art": 2658, "potrace": 898 }, "photo_shading_q5_median_ms": 6.8 },
  "findings": [
    { "id": "S5-P2-1", "severity": "P2", "evidence": "REPRO (n=1 clean run) + READ", "file": "src/ui/image-editor/editor-adjust-session.ts", "line": 65, "known": false, "regression": "not measured (same code in both releases)", "title": "Image Studio recomputes the whole document on the UI thread for every slider step: 12 MP Brightness 172-177 ms (block 154-158), Levels 301 ms (block 202), Threshold 370 ms (block 275); Chrome 1.0 -> 1.66 GB over five steps" },
    { "id": "S5-P3-1", "severity": "P3", "evidence": "REPRO + PROFILE", "file": "src/core/trace/trace-clean-art.ts", "line": 22, "known": "ADR-530 Amd 13 states the extra preparation, not its cost", "regression": "1.72-2.58x 1.0.28 with identical paths", "title": "Sharp traces large pages 1.7-2.6x slower than 1.0.28 for byte-identical paths: the clean-art check prepares the source again (4096 benchmark at 2048: 542 vs 210 ms; at 4096: 1,025 vs 597 ms)" },
    { "id": "S5-P3-2", "severity": "P3", "evidence": "REPRO (engine emulation)", "file": "src/ui/trace/use-trace-worker-client.ts", "line": 105, "known": "Q5-P3-3", "regression": "none (1.0.28 205 ms, 1.0.23 251 ms)", "title": "Cooperative fallback still traces in stretches of 206-285 ms (Smooth, 400x400) and up to 205 ms (Line Art) at the inline limit" },
    { "id": "S5-P3-3", "severity": "P3", "evidence": "REPRO + PROFILE (refuter)", "file": "src/ui/trace/image-loader.ts", "line": 279, "known": false, "regression": "none (1.0.28 296 ms, 1.0.23 277 ms block)", "title": "Trace commit of a 12 MP / 4096 image decodes the source on the UI thread: block 335-342 ms (309-497), Chrome 1.9 GB; Colour layers' 96k-node result blocks 311-343 ms at 12 MP" }
  ],
  "known_reobserved": ["Q4-P2-1 speed: Line Art 8x Potrace on Q5, 21x on the arch logo, 3x at 4096", "Q5-P3-3 (as S5-P3-2)", "S4-P3-1 (dither share: Jarvis/Stucki +0.7 s at bed size)"],
  "biggest_win": "Image Studio: compute the adjustment preview off the UI thread (or on the visible region) and reuse its buffers; for trace speed, Q4-P2-1's native route for two-level art"
}
```
