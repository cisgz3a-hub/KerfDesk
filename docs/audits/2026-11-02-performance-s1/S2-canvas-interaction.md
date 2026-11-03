# Performance audit S1 — S2 Canvas interaction

- **When:** 2026-11-02 21:40 – 2026-11-03 05:20 +0800.
- **Tree:** origin/main @ `c0610b891` (worktree `claude/performance-audit-s1`, HEAD `2735c687e`, which adds only S1's report).
  - Every set ran on a production build of the `j7-main` copy. A diff of that copy against `c0610b891` through a throw-away index (`src`, `public`, `scripts`, `index.html`, `vite.config.ts`, `package.json`) was empty. One build, `vite build --sourcemap hidden` with S1's config (fflate alias), served every measured page; the hidden maps were read only by the profile mapper.
  - **Trend builds:** S1's `dist-33bc394c6` (1.0.28) and `dist-87ecb4f24` (1.0.23), built from `git archive` exports with main's `vite.config.ts` and main's `node_modules` (S1's method, same caveat). Each release opened projects written by **its own** `serializeProject` (fresh `src` exports in `scratchpad\zz-s2-old\`).
- **Machine state:** i7-1260P (12 cores, 16 threads), 16 GB, Intel Iris Xe. Chrome 156.0.8078.76 headless with the real GPU (ANGLE D3D11; `chrome://gpu`: Canvas and Rasterization "Hardware accelerated", Skia Graphite). Free memory 2.4–5.0 GB before every set (`machine-state.log`).
  - **Other work:** no `vitest`, `eslint`, `tsc`, Playwright test or `vite build` ran during any set (`tooling=0` on every line). The owner's own Chrome (9–10 processes, about 0.7 GB) stayed open; it is excluded from the memory figures. Around 23:40–23:58 `explorer.exe` held one core; the plates sets in that window are marked "loaded" (calibration 72–93 ms).
  - **Calibration** (S1's 40M-step loop, in the page): 41–47 ms idle. Before 00:30 the "before" value was taken about 2 s after the project opened, while the app's own ETA and idle-motion workers still ran, so many early sets read 55–66 ms before and 41–47 ms after. From 00:30 the harness waits 6 s and for a quiet main thread first; later sets read 41–47 ms at both ends. The A/B rows below were measured back to back with this fix.
    - **Deviation from AREAS rule 4, recorded:** sets were not thrown away for drift alone. A high "after" value (60–100 ms) followed GPU-heavy windows, where the GPU process was still rasterising the last run when the closing loop ran; it is the app's own load, not the PC's. Each finding's cause rests on a back-to-back A/B or a same-sitting release comparison, and the S2-P2-4 rows taken under external load (explorer.exe) were re-measured on an idle machine.
- **Temp files:** `j7-mainzz-s2-vite.config.ts` (the build config, a copy of S1's) was moved into the harness at the end, so `j7-main` holds no S2 file. Kept for the refuter: the harness `scratchpadzz-s2` (scripts, `results*.jsonl`, `machine-state.log`, `logs`, profiles, traces, screenshots, the main build `dist-main` with hidden maps, the projects) and `scratchpadzz-s2-old` (the two releases' `src`, for the project generator). The release builds are S1's, in `zz-s1`.
- **Scope:** pan (middle-drag), wheel zoom, pinch (Ctrl+wheel in pixel mode, ADR-359), drag one object and the whole selection, marquee, hover glow (the operation pulse, ADR-620/632/646), resize handles, response times (click-select, Delete, Undo, Redo, Duplicate, typed width), memory over 200 pans and zooms, and the trend against 1.0.28 and 1.0.23. Scenes: 200 / 5,000 / 10,000 objects, 5,000 Line circles, the 50,000-path benchmark trace, 5,000 overlapping Fill circles, plate-then-window arrays (5,000 and 10,000), the 4096 × 4096 benchmark image, 100 real text objects, and the CNC view.
- **Counts:** 8 raised → 0 refuted → P1 0 / P2 4 / P3 4 (+ 2 KNOWN re-observed, both raised: N6-P3-3 as S2-P2-3, R5-P3-1 as S2-P2-4). Refuter (2026-11-03): confirmed 7, plausible 1 (S2-P3-2), refuted 0; no severity changes. S2-P2-1's and S2-P2-2's main fix directions need ADR amendments (ADR-346, ADR-620); S2-P3-4's "no probe measures frame intervals" is corrected.

## Headline

**At everyday size the canvas is clean, apart from a hitch after each edit.** At 200 objects (laser and CNC) pan, zoom, pinch, marquee, hover and drag run at 60 fps (p95 16.8 ms), and click, Delete, Undo, Redo, Duplicate and a typed width show on screen in 29–46 ms. After every edit of a design with some Fill, the UI thread then re-estimates the job for **185–251 ms** (S2-P3-1, P3; the same in 1.0.28 and 1.0.23). The 4096 × 4096 image is clean at every interaction.

**At 5,000 objects, the budget's own size, nothing that moves meets 33 ms.** Pan from empty canvas p95 **83 ms**; pan or zoom begun over artwork **200–233 ms**; drag one **183 ms**; drag all **217 ms**; hover **100 ms**; a pure-Line design of 5,000 circles zooms at p95 **1.4 s** with single frames of up to **7.2 s**. The main thread is mostly idle in these windows: the GPU process is rasterising the canvas (Chrome traces: its main thread busy 99% of the window). Two causes, each confirmed by an A/B run back to back:

- **S2-P2-1 (P2).** Output strokes are 1.5 px through Skia's full stroker unless **one object** has 20,000 segments (ADR-346's rule is per object). Thousands of small shapes all take the slow path. Clamping workspace strokes to 1 px: `line-5000` pan 150 → **16.8 ms**, zoom 100 → 16.8, drag 250 → 33; `mix-5000` pan 83 → 16.8; Redo's next frame 723 → 95 ms. Unchanged since 1.0.23.
- **S2-P2-2 (P2).** The hover pulse lights **every** same-settings piece, with four bitmaps each and three blits per piece per frame, no cap. At 5,000 objects: hover p95 100 → **16.8 ms** with the pulse off; pan over artwork 183 → 83; zoom 217 → 50; click-select 151 → 64 ms. As costly in 1.0.23.
- With both off, `mix-5000` pans, zooms and drags at p95 16.8 ms, and `mix-10000` at 33–50 ms.

**Two pooled-Fill scenes are far worse, and slower than 1.0.23.**

- **S2-P2-3 (P2).** In 5,000 mutually overlapping Fill circles (N6's scene) each drag step takes 0.7–1.4 s, and a 40-step drag **hung the GPU for over ten minutes in 3 of 3 runs**, the pulse on or off. One step is 4–5 times slower than 1.0.23.
- **S2-P2-4 (P2).** A plate array followed by its window array pans at p95 **100 ms** at 5,000 and **250–283 ms** at 10,000, against **17 and 33 ms on 1.0.23**: every frame re-plans the fill pools and paints each two-member pool separately with a 1.5 px outline. R5-P3-1's fix (#1537) cut the planning, not the frame.

**Also:** the 50,000-path trace re-resolves all its paths every frame and repaints its sprite on every resize step (blocks 115–578 ms, S2-P3-2); with thousands selected, drag commits block 207–513 ms (S2-P3-3); no repo probe or guard is pointed at the many-object, pulse or pool scenes that show the GPU-bound costs (S2-P3-4; the refuter corrected "time only JavaScript": the packaged observer records frame intervals). **Memory** is flat over 200 pans and zooms on every scene, and sprites stay far inside ADR-346's budget.

**Trustworthiness.** Production bundles in Chrome 156 with the real Iris Xe GPU, fresh page per scenario, five kept runs. Absolute numbers are good to about ±20% (rep-to-rep spread is in the p95max column of `analyze.mjs`); every claimed cause rests on a back-to-back A/B or a release comparison in the same sitting, which do not depend on load. GPU-bound numbers are specific to this GPU and Chrome's Graphite rasteriser; the desktop app was not measured.

## Scorecard

Frame columns are p50 / p95 in ms (median of five kept runs) and the single worst frame. "Block" is the longest main-thread task (range over the kept runs). Response is input → the frame that shows the change. Budgets: 33 ms a frame at p95 (pan, zoom, drag at 5,000 objects), 100 ms response, 200 ms longest block. **Trend** is p95 (or response) for main / 1.0.28 / 1.0.23, from the interleaved trend sets (`TM-`, `T28-`, `T23-`); "—" = not in the trend sets. Main-batch and trend-set values for the same row differ by up to about 20%.

**200 objects (`mix-200`)**

| Operation | Frames p50 / p95, worst | Block | Response | Budget | Verdict | Trend |
|---|---|---|---|---|---|---|
| Pan, zoom, pinch, marquee, hover | 16.7 / 16.8, ≤ 50 | 0 | — | 33 ms | Pass | pan 16.8 / 16.8 / 16.8 |
| Drag one, drag all, resize | 16.7 / 16.8–50, ≤ 250 | **187–251** after release | — | 200 ms block | **S2-P3-1** | drag block 205–227 / 209–224 / 209–231 |
| Click-select | — | 0 | 30 ms (≤ 31) | 100 ms | Pass | 30 / 30 / 30 |
| Delete, Duplicate, typed width | — | **185–215** | 29–30 ms (≤ 46) | 100 ms; 200 ms block | Response pass; **S2-P3-1** | Delete block 195 / 198 / 190 |
| Undo, Redo | — | 0 | 29–30 ms (≤ 44) | 100 ms | Pass | — |

**5,000 objects (`mix-5000`, the budget's size)**

| Operation | Frames p50 / p95, worst | Block | Response | Verdict | Trend (p95) |
|---|---|---|---|---|---|
| Pan from the empty margin | 50 / **83**, 750 | 0 | — | **S2-P2-1** (2.5×) | 83 / 100 / 83 |
| Pan grabbed over artwork | 133 / **200**, 1,250 | 75–82 | — | **S2-P2-2**, P2-1 (6×) | 233 / 217 / 200 |
| Wheel zoom, cursor over artwork | 33 / **217**, 867 | 64–67 | — | **S2-P2-2**, P2-1 (6.6×) | at a gap 233 / 233 / 233 |
| Wheel zoom at the margin | 16.7 / 33.5, 617 | 0 | — | Pass at p95 | 33 / 33 / 33 |
| Pinch (Ctrl+wheel, 5 px) | 17 / **150**, 867 | 66–69 | — | **S2-P2-1/2** (4.5×) | — |
| Drag one object | 83 / **183**, 967 | 65–134 | — | **S2-P2-1/2** (5.5×) | 217 / 200 / 200 |
| Drag all 5,000 | 133 / **217**, 983 | **207–300** | — | **S2-P2-1**, S2-P3-3 | 167 / 167 / **3,167** |
| Marquee | 83 / **100**, 183 | 106–141 | — | **S2-P2-1** (3×) | 183 / 150 / 83 (bimodal, see Refuted) |
| Hover glow (rest 2.3 s) | 50 / **100**, 117 | 0 | — | **S2-P2-2** (3×) | 100 / 100 / 100 |
| Resize handle | 50 / 83, 117 | 77–90 | — | S2-P2-1 (2.5×) | — |
| Click-select | — | 51–77 | **159 ms** (≤ 228) | **S2-P2-2** (1.6×) | 170 / 175 / 160 |
| Delete | — | 110–142 | **131 ms** (≤ 154) | S2-P3-3 (1.3×) | 121 / 97 / 90 |
| Undo | frame after it 717–783 ms | 54–65 | 65 ms (≤ 79) | **S2-P2-1** (next frame) | — |
| Redo | 717–733 ms frame | 0–54 | **792 ms** (≤ 811) | **S2-P2-1** (7.9×) | — |
| Duplicate; typed width | — | 62–137 | 94 ms; 70 ms (≤ 149) | Pass (median) | width 64 / 66 / 57 |

**10,000 objects (`mix-10000`, the project limit)**

| Operation | Frames p50 / p95 (worst) | Block | Verdict |
|---|---|---|---|
| Pan from the margin | 133 / 217 (2,017) | 86–91 | S2-P2-1 |
| Pan over artwork | 217 / 333 (2,883) | 116–2,068 | S2-P2-1, S2-P2-2 |
| Zoom over artwork | 100 / 567 (3,100) | 125–134 | S2-P2-1, S2-P2-2 |
| Zoom at the margin | 17 / 100 (1,767) | 64–83 | S2-P2-1 |
| Pinch | 83 / 383 (3,583) | 127–206 | S2-P2-1, S2-P2-2 |
| Drag all | 300 / 533 (1,700) | **469–513** | S2-P2-1, S2-P3-3 |
| Drag one | 233 / 317 (4,050) | 148–198 | S2-P2-1, S2-P2-2 |
| Marquee | 234 / 317 (467) | **223–323** | S2-P2-1, S2-P3-3 |
| Resize | 133 / 233 (383) | 206–212 | S2-P2-1 |
| Hover | 50 / 100 (183) | 0–50 | S2-P2-2 |
| Both diagnostics on (pulse off, strokes ≤ 1 px): pan over artwork, zoom | 17 / 50; 17 / 33 | 91–99; 62–67 | — |

**Other scenes (main; budget 33 ms a frame)**

| Scene | Operation | Frames p50 / p95 (worst) | Block | Verdict | Trend (p95) |
|---|---|---|---|---|---|
| `line-5000` (Line circles) | pan from the margin | 117 / 217 (3,317) | 53–60 | **S2-P2-1** | 150 / 150 / 133 |
| | pan over artwork | 267 / 417 (4,367) | 103–133 | **S2-P2-1**, S2-P2-2 | — |
| | zoom over artwork | 133 / **1,417 (7,233)** | 105–121 | **S2-P2-1**, S2-P2-2 | at a gap 567 / 567 / 550 |
| | drag one | 250 / 417 (5,583) | 90–159 | **S2-P2-1** | 267 / 250 / 233 |
| `circles-5000` (overlapping Fill) | pan from the margin; marquee | 17 / 33; 17 / 17 | 73–80; 0 | Pass | pan 17 / 317 / 50 |
| | zoom over artwork, 20 notches | 83 / **3,483 (6,433)**, 49–56 s a run; pulse off 17 / 17 | 120–158 | **S2-P2-2** (this scene) | **2,067 / 2,117 / 133** |
| | drag one | 0.7–1.5 s a move; **one move gave no frame for 181 s; a 636 s frame** (3 of 3) | up to 1,133 | **S2-P2-3** | 0.75–1.26 / 0.96–1.60 / 0.15–0.45 s a move |
| | hover; pan over artwork | 33 / 67; 83 / 100 | 0; 112–184 | S2-P2-2 | — |
| `plates-5000` (2,500 plates, then 2,500 windows) | pan from the margin | 150 / 217 (283), loaded set; idle re-run 83 / **100** | 100–116 | **S2-P2-4** | **100 / 100 / 16.8** |
| | pan over artwork; zoom | 233 / 317 (550); 100 / 267 (433) | 143–151; 150–187 | **S2-P2-4** | — |
| | drag one; hover | 183 / 250 (367); 33 / 83 | 132–179; 0 | **S2-P2-4** | drag 217 / 217 / 67 |
| `plates-10000` | pan from the margin; over artwork | 200 / 283 (400); 283 / 383 (600) | 114–144; 140–167 | **S2-P2-4** (R5-P3-1) | pan **250 / 250 / 33** |
| | zoom; at the margin; drag one | 133 / 417; 17 / 150; 300 / 367 | 176–264; 84–89; 239–283 | **S2-P2-4** | drag 350 / 367 / 100 |
| `trace-50k` (benchmark SVG, one object) | pan; over artwork; hover | 17 / 50; 17 / 67; 17 / 17 | **116–152**; 116–141; 0 | S2-P3-2 | pan 67 / 50 / 33 |
| | zoom; at the margin; pinch | 17 / 67 each | **273–296**; 195–223; 249–281 | **S2-P3-2** | margin 67 / 50 / 33 |
| | drag one; marquee | 17 / 83; 17 / 84 | **453–495**; 176–183 | **S2-P3-2** | drag block 444 / 427 / 365 |
| | resize handle | 33 / **383** (567) | **513–578** | **S2-P3-2** | — |
| `image-4096` (benchmark PNG) | pan, over artwork, zoom, pinch, drag, hover, resize | 16.7 / 16.8 (≤ 150) | 0 | Pass | 16.8 / 16.8 / 16.8 |
| `text-100` (100 real text lines, 630k vertices) | pan; over artwork; zoom; hover | 17 / 50; 17 / 50; 17 / 33; 17 / 17 | 0 | Pass (pan 1.5× at p95) | — |
| | Delete | response 93 ms (≤ 105) | 0 | Pass | — |
| `cnc-200` (CNC view) | pan, zoom, drag, hover | 16.7 / ≤ 33 | 0–54 | Pass | — |
| `cnc-5000` | pan from the margin (started below the Stock chip; the default start point is on it); over artwork | 33 / 83 (733); 167 / 233 (1,233) | 0; 82–106 | S2-P2-1, S2-P2-2 (same code as laser) | — |
| | zoom over artwork; at the margin; drag one; hover | 83 / 317; 17 / 50; 150 / 167; 50 / 100 | 82–86; 0–53; 99–126; 0 | S2-P2-1, S2-P2-2 | — |

**Memory over 200 pans and zooms** (forced GC before each sample; "canvas px" is every live canvas the page made, workspace included)

| Scene | JS heap start → after 200 → settled | Live canvas px, peak (largest) | Canvases created | Playwright Chrome private | Verdict |
|---|---|---|---|---|---|
| `mix-5000` (pan starts over artwork) | 53 → 62 → 60 MB | 8.2 M (0.58 M) | **154,251** | 0.58 → 1.04 GB peak → 0.90 GB | No growth; pulse churn (S2-P2-2) |
| `trace-50k` | 110 → 142 → 126 MB | 2.66 M | 24 | 0.98 → 0.83 → 0.60 GB | Pass; sprites inside ADR-346's 12 M px budget |
| `trace-50k`, 1.0.23 | 109 → 137 → 125 MB | 2.66 M | 24 | 0.99 → 0.80 → 0.60 GB | Same |
| `image-4096` | 46 → 48 → 48 MB | 7.23 M (4.19 M raster cache) | 7 | 1.21 → 0.70 GB | Pass |
| `text-100` (100 sprites) | 97 → 101 → 101 MB | 5.67 M | 9,039 | 0.79 → 0.68 GB | Pass; inside the sprite budget |

ADR-346's sprite budget here is `max(4 M, 2.25 × 798 × 721)` × 3 = 12 M pixels; no scene came near it.

### Measurement method

The harness is in `…\scratchpad\zz-s2\`, kept for the refuter. Entry points: `runset.sh` (one set: logs machine state, refuses under 1 GB free, runs `run.mjs`), `batch-*.sh` (the sets in the order run), `analyze.mjs` (median and worst without rep 0), `map-profile.cjs` (S1's CPU-profile mapper), `trace-summary.mjs` (Chrome trace: busy time per thread, longest slices).

1. **Build and serve.** `node node_modules/vite/bin/vite.js build --config zz-s2-vite.config.ts --outDir <zz-s2>/dist-main --sourcemap hidden`, run in `j7-main` (the config is S1's, copied; it is now in `zz-s2`, so copy it back into the `j7-main` root to rebuild). `node host.mjs <dist> <port>` (S1's host without the controller simulator) serves with `_headers`' COOP, COEP and CSP. Ports: 4701 main, 4703 1.0.28, 4704 1.0.23.
2. **Browser.** Playwright 1.61.1, installed Chrome 156 (`channel: 'chrome'`, headless), 1440 × 900, DPR 1, service workers blocked, `--enable-precise-memory-info`, background throttling off. Headless Chrome uses the Iris Xe GPU here (checked in `chrome://gpu`), so GPU raster cost is in every number.
3. **Scenes.** `gen.mjs` + `gen-entry.ts` write each tree's own `.lf2` with `createProject`, `createLayer` and `serializeProject`:
   - `mix-N`: N separate objects on a grid over 380 × 380 mm; even = Line circle (32 points, red operation), odd = Fill rectangle (black operation, 0.1 mm). The everyday scene.
   - `line-5000`: 5,000 Line circles only. `circles-5000`: 5,000 Ø50 Fill circles scattered in a 40 mm square (N6-P3-3's scene). `plates-N`: N/2 Fill plates, then N/2 Fill windows centred on them (R5-P3-1's order). `cnc-N`: `mix-N` on `DEFAULT_CNC_MACHINE_CONFIG`.
   - `trace-50k.svg` and the 4096 × 4096 PNG are `scripts/large-file-benchmark-cases.mjs` exactly, brought in through the app's own **Import...** and **Import Image...** (the PNG is encoded in the page from the same pixel recipe).
   - `text-100`: `make-text.mjs` types one 55-character line with the app's Text tool (Roboto, 10 mm, 6,299 vertices), saves it through a captured save picker, and copies that object to 100 grid positions at scale 0.418 (4.1 mm text).
4. **Fresh page per scenario.** Each scenario gets a new browser context (empty storage and history) and opens its scene again, so one scenario's edits cannot move the next one's target. Six runs per scenario; rep 0 is discarded.
5. **Inputs** (Playwright mouse and keyboard; each move awaits the browser's acknowledgement, 8 ms apart):
   - **pan**: middle-drag, 60 moves round a 150 px circle, starting on the empty margin left of the bed (no artwork under the cursor). **pan-art**: the same, grabbed at the canvas centre over artwork, as most pans are.
   - **zoom**: 10 wheel notches in, 10 out, 40 ms apart, cursor at the centre (over artwork). **zoom-m**: the same at the empty margin. **pan-gap / zoom-gap** (trend and A/B sets): held at a corner between four shapes near the centre; the hover still reaches the neighbouring shapes from there (long tasks and A/B match the over-artwork rows), so they are reported as "at a gap" and read like the over-artwork rows. **pinch**: Ctrl+wheel with deltaY ±5 px, 30 in and 30 out (Chromium's trackpad pinch).
   - **dragone**: press on one object and drag it 40 moves round a 60 px circle back to its start. **dragall**: the same after Ctrl+A.
   - **marquee**: from the empty margin to the canvas centre in 40 moves. **hover**: move onto one object and rest 2.3 s (the pulse runs 1.9 s). **resize**: drag the selected object's corner handle 40 px out and back in 30 moves.
   - **Response rows**: click-select, Delete, Ctrl+Z, Ctrl+Shift+Z, Ctrl+D, and a new width typed into **Selection width** then Enter. Each is undone outside the window.
6. **What is measured** (`page-init.js`, in the page):
   - **Frame intervals** from a rAF chain over the window, plus one frame after it, so a task running at the end counts. p50 and p95 are per run; the table gives the median over the five kept runs, and "worst" is the single longest interval in any kept run.
   - **Longest main-thread task**: PerformanceObserver `longtask`, flushed with `takeRecords()` at the end of each window.
   - **Workspace redraws**: full-canvas `clearRect` on the `KerfDesk workspace` canvas; "draw" is the time from that call to the end of its task.
   - **Response**: from the input event's `timeStamp` to the first animation frame after the task that redrew the workspace.
   - **Memory**: `performance.memory` after a CDP forced GC, the live pixels of every canvas the page created (sprites and pulse bitmaps), CDP DOM counters, and the private memory of the Playwright Chrome's own processes.
7. **Attribution.** CPU profiles (CDP, 200 µs sampling, rep 1 of 2 in separate sets) mapped through the hidden source maps. Chrome traces (`gpu`, `viz`, `cc`, `devtools.timeline`) for frames where the main thread was idle. Two **diagnostic A/B switches**, used only in the A/B rows, never in the scorecard:
   - `hairline`: the page clamps `lineWidth` above 1 px to 1 px on the workspace canvas only (ADR-346's hairline width);
   - `nopulse`: the pulse overlay canvas (`data-testid="artwork-pulse-layer"`) gets no 2D context, so `ArtworkPulseOverlay.tsx:243` returns at once.

**Re-running the key repros** (from `zz-s2`, hosts first: `node host.mjs dist-main 4701`, `node host.mjs ../zz-s1/dist-33bc394c6 4703`, `node host.mjs ../zz-s1/dist-87ecb4f24 4704`):

- S2-P2-1: `./runset.sh '{"base":"http://127.0.0.1:4701/","label":"X1","project":"projects/main-line-5000.lf2","geo":{"kind":"grid","n":5000},"scenarios":["pan","zoom-m","dragone"]}'`, then the same with `"hairline":true` and another label.
- S2-P2-2: the same with `projects/main-mix-5000.lf2` and `"scenarios":["hover","pan-art","zoom","r-click"]`, then with `"nopulse":true`.
- S2-P2-3: `TIMEOUT=900 ./runset.sh '{…,"project":"projects/main-circles-5000.lf2","geo":{"kind":"circles","n":5000},"runs":1,"scenarios":["dragone-timed"]}'` and read the `move-time` and `move-stuck` rows.
- S2-P2-4: `projects/main-plates-5000.lf2` on 4701 and `projects/old-87ecb4f24-plates-5000.lf2` on 4704, `"geo":{"kind":"plates","n":5000},"scenarios":["pan","dragone"]`.
- Summaries: `node analyze.mjs results.jsonl '<label regex>'`; profiles: `node map-profile.cjs <prof.json> dist-main 15`; traces: `node trace-summary.mjs <trace.json>`.

**What the numbers mean.** A p95 of 16.8 ms is 60 fps. Frame times include the GPU process: when the main thread is idle and frames are still slow, the browser is waiting for the GPU to rasterise the canvas (see S2-P2-1). Timings are good to about ±20%; the A/B ratios are much firmer, because each pair ran back to back.

### Refuter method (2026-11-03, 05:19–06:52 +0800)

- **Tree.** origin/main `df2279e26` (after #1546–#1549). `git diff --stat c0610b891 origin/main` touches Preview, Marlin pause and camera files only; none of the files cited here (`draw-complexity.ts`, `object-display.ts`, `fill-pools.ts`, `fill-pool-clusters.ts`, `artwork-pulse.ts`, `draw-artwork-pulse.ts`, `pulse-piece-bitmap.ts`, `ArtworkPulseOverlay.tsx`, `draw-scene.ts`, `artwork-sprite-cache.ts`, `use-job-estimate.ts`, `live-job-estimate.ts`, `canvas-preparation-policy.ts`, `preparation-complexity.ts`, `draw-selection-overlay.ts`) changed, and the `j7-main` copies of the six main ones equal `origin/main` byte for byte. So the auditor's `dist-main` bundle is current for every finding, and no rebuild was made. Releases: S1's `dist-87ecb4f24` (1.0.23); 1.0.28 was not re-run.
- **Own harness** in `scratchpad\zz-s2r\` (deleted at the end), sharing no code with `zz-s2`: its own static host, its own Playwright driver, its own in-page probe and its own calibration (a seeded xorshift fill and sort of 1.5 M doubles, 175–200 ms idle, best of three). Inputs are paced at 16 ms (pan, drag) or 40 ms (wheel) without waiting for frames; metrics are rAF intervals, long tasks, and, for the circle drag, each move timed from input to the second frame after it. One warm-up run dropped, five kept, fresh context per scenario, the project opened through the app's own Open command. Scene files are the auditor's, checked independently (object counts, operations, segments, extents; `line-5000` 160,000 segments, at most 32 per object).
- **A/B switches, different from the auditor's:** the same bundle served with one minified constant or loop changed (`sft=1.5` → `sft=1`, ARTWORK_STROKE_WIDTH_PX; the pulse painter's piece loop emptied). The host counted the patched chunk being served on every page load.
- **GPU bound.** Chrome traces with the `toplevel` category only, summed per process and thread. `line-5000` margin zoom: GPU main thread busy 3,083 ms of 4,105 (longest 1,023 ms), renderer main 445 ms; with 1 px strokes, GPU main 266 ms. `mix-5000` pan over artwork: GPU main 8,230 ms of 8,386 (98%), renderer main 3,170 ms; pulse emptied: 4,332 of 6,491. The auditor's "GPU about 99% busy, main thread mostly idle" holds.
- **Second flag set** (`--disable-accelerated-2d-canvas`, canvas rasterised on the CPU in the renderer), `line-5000`: pan p95 83 ms (1.5 px) against 33 ms (1 px); margin zoom 50 against 16.8 ms. The work moves to the renderer's main thread (busy 4,752 ms of 5,280; long tasks 85–102 ms), and the 1.5 px stroker is still 2.5–3× the cost. The conclusion holds on CPU raster too; oddly, CPU raster is faster than Graphite on the Iris Xe for this scene (83 against 150 ms).
- **AREAS rule 4.** My calibration held within 15% on every set except `A-mix` (first run; before 237–266 ms, after 173–211, the app's workers still busy after Open), `T23-pl10` (213 → 177) and the circle sets (224–238 → 182–234). I added an 8 s settle after Open, re-ran `A-mix` as `A2-mix` (175–201 ms both ends, same results), and kept the others: a slower PC can only make 1.0.23 look slower, and the circle ratios (4–5×) far exceed the drift. The auditor's deviation (high "after" values from the GPU still rasterising) does not change any conclusion: every cause rests on a back-to-back A/B or same-sitting release comparison, and both reproduce here under stable calibration.
- **Machine state** (logged before each set; the log went with `zz-s2r`): free memory 3.0–6.9 GB before every set, never under 3.8 GB during the circle freeze; CPU load 0–48% at set start (the owner's Chrome, 9 processes; 14 Claude processes; one idle `codex`). No `vitest`, `eslint`, `tsc`, Playwright test or `vite build` ran. I was the only audit agent. Every host and browser I started was stopped, and no Playwright Chrome remained.
- **Not re-measured:** the trace scene (S2-P3-2), 1.0.28, the CNC view, pinch, resize, memory, and the bimodal marquee lead under Refuted.
- **New, not raised (lead for the coordinator):** in `line-5000` and `plates-5000`, every drag that followed an Undo held a **510–890 ms main-thread task** in its window, against 95–147 ms for the first drag of a fresh page, in main, main with 1 px strokes and 1.0.23 alike (`plates-5000` on 1.0.23: 531–559 ms). After each Undo the page also needed about 40–50 s before my quiet check passed (no long task and no frame over 40 ms for 1.5 s). Not attributed (no profile), not a regression, and outside the auditor's scenarios (which, apart from the circle scene, did not undo between drags).

## Findings

### S2-P2-1 — Every object under 20,000 segments strokes at 1.5 px through Skia's full stroker, so a design of thousands of small shapes makes the GPU the bottleneck: frames 2.5–43 times the budget, single frames of 2–7 s

- **Where:**
  - `src/ui/workspace/draw-complexity.ts:19-30`. `artworkStrokeWidthPx(displaySegmentCount, output)` gives 1 px only when **one object** has at least `HAIRLINE_STROKE_SEGMENT_THRESHOLD` (20,000) display segments; every other output stroke is `ARTWORK_STROKE_WIDTH_PX` (1.5 px).
  - Callers: `object-display.ts:186` (`paintObjectDisplay`, per path) and `:142` (sprite style key); `fill-pools.ts:316` (pool outlines).
  - Each object is its own `stroke()`: `draw-vector-strokes.ts:17` (`strokePolylinesBatched`), called once per object from `draw-scene.ts:344-367` (`drawObjects`' per-object loop), which runs on every redraw.
- **Anchor:** ADR-346 Decision 2 and its measured context: a 1.5 px stroke costs about 3 µs a segment in Skia's full stroker against about 0.05 µs at ≤ 1 device px. The threshold is per object, so 5,000 circles of 31 segments (155,000 segments) all take the expensive path. AREAS budget: 33 ms a frame at p95 for pan, zoom or drag at 5,000 objects.
- **Scenario:** a cut file of a few thousand small parts (stencil, perforation pattern, nested parts) on a Line operation, panned, zoomed or dragged.
- **Evidence:** **REPRO** (main, production bundle).
  - **Main, `line-5000`:** pan p95 **217 ms** (worst frame 3.3 s); zoom p95 **1,417 ms** (worst **7.2 s**); dragone p95 417 ms (worst 5.6 s). The longest main-thread task in those windows was 53–159 ms.
  - **A/B, back to back** (`A-` unchanged, `H-` every workspace stroke at ≤ 1 px; p95 / worst):

    | Scene and input | Unchanged | Strokes ≤ 1 px |
    |---|---|---|
    | `line-5000` pan (margin) | 150 / 1,900 ms | **16.8 / 34 ms** |
    | `line-5000` zoom (margin) | 100 / 1,183 ms | **16.8 / 17 ms** |
    | `line-5000` dragone | 250 / 1,967 ms | **33 / 183 ms** |
    | `mix-5000` pan (margin) | 83 / 633 ms | **16.8 / 33 ms** |
    | `mix-5000` dragone | 150 / 267 ms | **50 / 150 ms** |
    | `mix-10000` pan (margin) | 183 / 2,167 ms | **50 / 83 ms** |
    | `mix-5000` Redo, input → frame shown (pulse off in both) | 723 ms | **95 ms** |

  - **Chrome trace** (`trace-TR-line5000-zoom-zoom-gap.json`, 11.0 s window): the GPU process's main thread was busy 10.9 s, in `RasterDecoderImpl::DoRasterCHROMIUM` slices of 0.46–1.72 s; the renderer's main thread was busy 2.4 s. In the Redo trace one canvas raster took 598 ms while the renderer's main thread was busy 105 ms of 848 ms.
  - The cost is in rasterising the recorded canvas commands, which is why the main thread looks idle: `drawScene`'s own JavaScript is 15–28 ms a redraw at 5,000 objects (`drawTailMed` in `results.jsonl`).
  - **Trend** (same sitting, `line-5000`, p95 main / 1.0.28 / 1.0.23): pan 150 / 150 / 133 ms; drag 267 / 250 / 233 ms; zoom at a gap 567 / 567 / 550 ms. Unchanged since 1.0.23: the per-object threshold dates from ADR-346 (2026-09-22).
- **Severity:** **P2.** Pan, zoom and drag at the budget's own size are 2.5–43 times the 33 ms budget, and on `line-5000` single frames reach 5.6–7.2 s with no progress shown. It also causes the 0.7–0.8 s frame after every Undo and Redo at 5,000 objects (table, last row).
- **Fix direction** (display only; output never reads a display width, ADR-346):
  - decide the hairline from the **frame's** stroked segment total (or from on-screen segment density), not from one object's count; or stroke every output path at 1 device px when the scene's total passes the threshold;
  - and/or batch the small objects that share a paint into one path per paint, so 5,000 `stroke()` calls become a handful.
  - G-code is untouched; the existing `draw-scene-*` canvas tests cover the look. A guard: count segments stroked wider than 1 px per frame on the `line-5000` scene (below).
- **Refuter: CONFIRMED, P2 kept; the main fix direction needs an ADR-346 amendment.**
  - *Would be false if* the A/B were an artefact of the `lineWidth` hook (which also thins selection boxes and the grid), or the frames were main-thread bound. Re-measured with a different switch: main's own bundle with only `ARTWORK_STROKE_WIDTH_PX` patched from 1.5 to 1 (`sft=1.5` in `ui-workbench-TFv1LCsU.js`), so only artwork and pool outlines change. Back to back, p95 (median of 5 kept runs): `line-5000` pan from the margin **150 → 16.8 ms** (worst 2,000 → 33), zoom at the margin **100 → 16.8** (worst 1,616 → 34); `mix-5000` pan from the margin **83 → 16.8**. Trace of the `line-5000` margin zoom (`toplevel` slices per thread): GPU main thread busy **3,083 ms of a 4.1 s window** (longest slice 1,023 ms) against the renderer's 445 ms; with the patch, GPU main 266 ms of 2.4 s. Drag one: 217 → 183 ms only, because each drag window after the first also held a 510–730 ms main-thread task in both variants (see the refuter section, not stroke cost).
  - *Deliberate visual choice?* Yes, in part. ADR-346 Decision 2 keeps "ordinary artwork" at 1.5 px and rejects "Hairlines for all artwork" because it "would change the weight of every design"; the policy is meant to apply "only where the stroker cost is measurable". A per-scene (or per-frame) total is arguably what that sentence means, but it changes what ordinary designs look like, so the first fix direction is an ADR-346 amendment for the maintainer, not a pure speed fix. The batching alternative keeps the look but does not remove the cost: ADR-346 measured the stroker per segment (a single batched 120,000-segment path at 1.5 px still took 371–390 ms), so it should not be offered as an equivalent fix.
  - *Burn:* unaffected. `src/core` imports none of `draw-complexity.ts`, `fill-pools.ts` or the pulse modules (only a comment in `hit-test.ts` names `fill-pools.ts`), and ADR-346 states output never reads a display width.
  - *Ordinary?* 5,000 objects is AREAS' own budget size; `line-5000` is 5,000 Ø3.7 mm circles on a 380 mm grid (a perforation or stencil sheet). The everyday `mix-5000` margin pan alone is 2.5× budget (P3 level); P2 rests on `line-5000` (4.5× pan, 3× margin zoom, multi-second frames) and on the over-artwork rows where it compounds with S2-P2-2.

### S2-P2-2 — The hover pulse lights every piece that shares the settings, with four bitmaps each and no cap: at 5,000 objects hovering one shape drops the canvas to 10 fps, and a pan or zoom over artwork to 4–5 fps

- **Where:**
  - `src/ui/workspace/artwork-pulse.ts:159-186` (`pulseTargetFor`): the pulse takes **every** object whose operations match the hovered one's settings (2,500 pieces in `mix-5000`), on screen or not.
  - `draw-artwork-pulse.ts:98` (`draw`) runs every frame while the pulse or its resting edge is live. `:128` (`drawCurrent`) blits three bitmaps per piece per frame (`:279-290`, `drawPiece`). A change of view makes every piece stale, so each pan or zoom frame draws all of them scaled, and `:168` (`render`) re-renders them `VIEW_SETTLE_MS` (`:37`, 140 ms) after the view stops, inside a 6 ms budget per frame (`:35`), so the work spreads over many frames.
  - `pulse-piece-bitmap.ts:70` (`renderPieceBitmap`) makes four canvases per piece (flood, outline, edge halo, bloom halo, `:262` `createBitmap`), two of them drawn through `shadowBlur` (`:175`, `blurredHalo`).
  - The loop: `ArtworkPulseOverlay.tsx:288` (`tick`). The resting edge stays while the pointer is over artwork, so a pan or zoom begun over artwork keeps the loop running.
- **Anchor:** ADR-620, ADR-632 Amendment 1 and ADR-646 (the pulse); `artwork-pulse.ts:1-7` describes it as a tint "across every piece that shares its settings". `draw-artwork-pulse.ts:5-7` promises "pointing at one of many same-settings pieces never stalls a frame"; the 6 ms render budget holds, but the per-frame blits and the GPU raster do not. AREAS: 33 ms a frame at 5,000 objects; 100 ms response.
- **Scenario:** an ordinary large design where most shapes share one operation (one cut, one engrave). The pointer rests on any shape, or a pan or zoom starts with the pointer over the design.
- **Evidence:** **REPRO**, A/B back to back (`Q-` unchanged, `N-` pulse overlay given no context; p95, or response):

  | `mix-5000` unless stated | Pulse on | Pulse off | Off, and strokes ≤ 1 px |
  |---|---|---|---|
  | hover (rest on one shape 2.3 s) | 100 ms | **16.8** | 16.8 |
  | pan grabbed over artwork | 183 (worst 1,217) | 83 | **16.8** |
  | zoom, cursor over artwork | 217 (worst 867) | 50 | **16.8** |
  | drag one object | 167 | 83 | **17** |
  | click-select, input → frame | **151 ms** (worst frame 1.6 s) | 64 ms | 95 ms |
  | `mix-10000` pan over artwork | 383 (worst 2,867) | 167 | 50 |
  | `line-5000` pan over artwork | 367 (worst 2,783) | 150 | 17 |

  - Main batch, same scenes: `mix-5000` pan-art p95 200 ms (worst 1.25 s), zoom 217 ms, hover 100 ms; `mix-10000` pan-art 333 ms (worst 2.9 s); CNC `cnc-5000` pan-art 233 ms, hover 100 ms.
  - Profile (`prof-p5k-pan.json`, pan over artwork, 7.6 s): `tick` 692 ms inclusive, of which `render` 532 ms, `renderPieceBitmap` 363 ms, `blurredHalo` 180 ms, `drawCurrent` 97 ms self; `getContext` 80 ms self. Trace (`trace-TR-mix5000-panart-pan-art.json`): GPU main thread busy 11.7 s of an 11.8 s window, renderer main thread 4.0 s.
  - **Worst case, large pieces:** in `circles-5000` (5,000 pieces of Ø50 mm) 20 zoom notches over the artwork take 49–56 s, p95 3.5 s, worst frame 6.4 s; with the pulse off, p95 16.8 ms (S2-P2-3's scene; details there). That zoom is 15 times slower than on 1.0.23 (2,067 against 133 ms p95, six runs each), with the same pulse code.
  - At 200 objects the pulse costs nothing measurable (hover p95 16.8 ms).
  - **Trend** (same sitting, `mix-5000`, p95 main / 1.0.28 / 1.0.23): hover 100 / 100 / 100 ms; pan over artwork 233 / 217 / 200 ms; click-select 170 / 175 / 160 ms to the frame. The pulse is as costly in 1.0.23 on the ordinary scene: not a regression there (the overlapping-circle zoom above is the exception).
- **Severity:** **P2.** Hovering is the commonest canvas input. At the budget's size it runs at three times the frame budget on its own, and it doubles to quadruples the cost of a pan or zoom that starts over artwork (6–7 times the budget). Click-select's response passes 100 ms only because of it (151 → 64 ms). Over large overlapping pieces it reaches frames of several seconds.
- **Fix direction** (display only): bound the pulse to what can be seen — pieces in the viewport, and at most a few hundred, nearest first; draw one combined bitmap per colour source instead of four canvases per piece; stop the resting-edge loop, or freeze its bitmaps, while the view is moving. No output change.
- **Refuter: CONFIRMED, P2 kept; the "few hundred" cap is a product decision, not a speed fix.**
  - *Would be false if* a cap already existed or the pulse's cost were main-thread work a 6 ms budget hides. `draw-artwork-pulse.ts:32-33` keeps live pieces "even above" the 64 MB budget (ADR-632 Amendment 1's only bound), and `pulseTargetFor` (`artwork-pulse.ts:177-179`) takes every same-settings object: no cap.
  - Re-measured with a different switch: main's bundle with the painter's piece loop emptied (`for(const h of o)` → `for(const h of [])` in `draw`; the targets are still computed, so this is more conservative than the auditor's no-context switch). `mix-5000`, back to back, p95: hover **83–100 → 16.8 ms**; pan grabbed over artwork **150 → 67**; zoom over artwork **267 → 67**; click-select, pointer-down to the second frame **697 → 75 ms** (my click rests 400 ms first, so the pulse is under way; the auditor's 151 → 64 ms rested 300 ms). Trace of the pan over artwork: GPU main thread busy **8,230 ms of 8,386** with the pulse, 4,332 of 6,491 without.
  - *ADR check:* ADR-620 decisions 2–3 pulse "every piece whose operation has the same settings" so "one colour says 'these share the settings you point at'"; ADR-646 decision 3 keeps that for hovers and narrows only edits. A cap of "a few hundred, nearest first" would hide part of the group, so it needs an ADR-620 amendment. Culling to the viewport keeps the behaviour but does not help a fitted view (all 2,500 pieces are on screen in `mix-5000`). Behaviour-preserving directions come first: combined bitmaps per colour source (the ripple staggers pieces by up to 420 ms, so pieces would be grouped by phase band rather than merged into one), and the resting edge, which has no ripple, as one bitmap; and freezing the bitmaps while the view moves. ADR-632 Amendment 1 benchmarked 150 pieces, so 2,500 was never measured.

### S2-P2-3 — In a dense overlapping Fill pool every drag step takes 0.7–1.4 s, and a 40-step drag froze the canvas for minutes in 3 of 3 runs (escalates N6-P3-3)

- **Where:**
  - `src/ui/workspace/fill-pools.ts:176-199` (`drawFillPool`): a whole pool of at least 4,000 segments is drawn from a sprite (`artwork-sprite-cache.ts:100`, `drawArtworkSprite`), keyed on the pool's `contours` array, which is rebuilt whenever a member moves (`fill-pools.ts:381`, `poolGeometry`). Each drag step therefore repaints the whole even-odd pool (240,000 segments) into a new sprite (`artwork-sprite-cache.ts:201`, `render`). READ; consistent with 0.7–1.1 s a step with the pulse off.
  - `fill-pools.ts:306-336` (`poolParts`) and `:201-222` (`paintFillPool`): when artwork drawn between members covers the cluster, the pool is split into parts, each **clipped by the whole even-odd pool** (`clipClosedPolylines`, `:217`), up to `CLIP_BUDGET_SEGMENTS` (`:97`, 1,000,000 clipped segments) a pool.
- **Anchor:** ADR-683 and Amendment 1 (pools; "a still frame does not sweep again"); N6-P3-3 (the same scene, 413–1,000 ms a frame in jsdom without raster, P3 "unusual scene"); AREAS P2: "a freeze of 5 s or more on ordinary input with no progress".
- **Scenario:** 5,000 Ø50 mm Fill circles scattered in a 40 mm square, so every circle overlaps every other (N6's scene). Drag one circle.
- **Evidence:** **REPRO**, main.
  - **Drag, 40 moves round a 60 px circle** (`dragone`): in the main batch, rep 0 had not finished after 17 minutes; the GPU process held 100% of one core while the renderer used none, and the renderer held 2.49 GB. The set was stopped (`machine-state.log`, 23:41).
  - **Re-run with each move timed** (`D2-circles5000`, `dragone-timed`): moves 1–14 took 0.73–1.41 s each, moves 15–26 about 0.13 s, and move 27 produced **no frame for 181 s**, when the harness gave up and released the button. The window's longest frame was **636 s**; the page then needed about 10 more minutes before a quiet main thread allowed the closing calibration. Its longest main-thread task was 1.13 s, so the hang is in the GPU process.
  - **Short drag** (10 small moves): 0.70–1.54 s a move, twice (`D-circles5000`). **With the pulse off** (`N-circles5000`, six runs): 0.71–1.11 s a move, so the drag cost is the pool, not S2-P2-2. The 40-move drag **with the pulse off** (`N2-circles5000`) hung at the same step: moves 1–14 took 0.77–1.15 s, moves 15–26 about 0.13 s, and move 27 gave no frame for 181 s. The hang is the pool's, and it reproduced in 3 of 3 runs.
  - **Zoom over this scene is S2-P2-2, not the pool:** 20 notches at the centre take 49–56 s (p95 3.5 s, worst 6.4 s, n=5); with the pulse off the same zoom runs at p95 **16.8 ms** (worst 783 ms). The Chrome trace of the zoom (`trace-TR-circles5000-zoom-zoom.json`) shows the GPU main thread busy 30.65 s of 30.7 s in canvas rasters of 2.35–2.84 s, and the profile's top function is the pulse loop (`tick` 1,483 ms inclusive). Here the 5,000 pieces are each a 50 mm circle, so every pulse frame blits 15,000 large bitmaps.
  - Why move 27 hung while moves 15–26 were cheap is not attributed (no trace of that step). The clip path above is the READ candidate: it is the only per-part cost that multiplies the pool's 240,000 segments.
  - Pan p95 17–33 ms and marquee 17 ms are fine: the pool sprite is reused.
  - **Trend** (same sitting, 10-move drag, two runs each): one move took 0.75–1.26 s on main, 0.96–1.60 s on 1.0.28 and 0.15–0.45 s on 1.0.23. So a drag step is 4–5 times slower than 1.0.23; the pools arrived in between (#1511, ADR-683). Zoom with the pulse (six runs each): p95 **2,067 / 2,117 / 133 ms**; the pulse code did not change between 1.0.23 and 1.0.28 (`git log`), so the 15× difference comes from what changed under it with the pools, not attributed further. Pan is better than both releases (16.8 / 317 / 50 ms).
- **Severity:** **P2** (a freeze far past 5 s with no progress, on a drag, 3 of 3 runs). N6 rated the scene unusual, and that still holds; but 5,000 objects is the budget's size, a dot or halftone pattern on one Fill operation overlaps in the same way, and the measured cost is now minutes, not N6's hundreds of milliseconds. If the operator kills the frozen window, unsaved work since the last autosave is lost; the coordinator may weigh that as P1.
- **Fix direction** (display only; for the zoom see S2-P2-2):
  - while a member is being dragged, draw the pool **without** the moving member as a cached sprite, and draw the moving member on its own; rebuild the pool once on release;
  - never clip by the whole pool per part: clip each part by the bounding boxes of the artwork that covers it, or paint the parts in order without a clip;
  - re-measure N6's "1,000,000 segments" clip budget with GPU raster in the loop: the cost is in raster, not in the JavaScript the budget counts.
- **Refuter: CONFIRMED, P2 kept (not P1).**
  - *Would be false if* the step cost were the pulse, or 1.0.23 were as slow. Each move timed from input to the second frame after it, 10 moves of the 40-move path, two kept runs per build in one sitting: main **0.71–2.27 s a move** (steady 0.74–0.87 s); main with the pulse painter emptied **0.70–1.17 s** (so it is the pool, not S2-P2-2); 1.0.23 **0.13–0.30 s** after its first 2–3 moves (0.33–1.28 s). About 4–5× slower, as reported. Calibration drifted 224–238 → 182–234 ms on these sets (the project's own workers after Open); the ratios are far outside that.
  - *The freeze:* reproduced once (the only 40-move run I made). Moves 1–16 took 0.71–1.29 s, moves 17–24 **0.11–0.13 s** (the dragged circle was then about 57 mm from the cluster, so the 4,999-member pool's sprite was reused), and move 25, as the circle re-entered the cluster, gave **no frame for 120 s** when my driver gave up. The page then took **about 10.5 more minutes** before the release and Undo were processed and the main thread was quiet. It recovered: no crash, the Undo applied, free memory never fell below 3.8 GB, calibration afterwards 210 ms. The re-entry timing is a new clue for the attribution the report leaves open.
  - *Severity:* a freeze of 12–13 minutes with no progress is well past P2's 5 s line. It is not P1 under AREAS: no crash or out-of-memory, nothing lost, the app returns on its own. The risk is the operator killing a window that looks hung, losing work since the last autosave (at most 30 s plus the drag); the coordinator may still weigh that. The scene (every circle overlapping every other) remains the unusual one N6 described.

### S2-P2-4 — A plate array with separate window cut-outs pans at 4–10 fps, 6–7.5 times slower than 1.0.23: every frame re-plans and repaints thousands of two-member pools (escalates R5-P3-1)

- **Where** (profile `prof-P-plates10000-pan-pan.json`, 60 redraws, inclusive main-thread ms):
  - `src/ui/workspace/draw-scene.ts:336-340` calls `planFillPools` (`fill-pools.ts:104`) on **every** redraw: 1,731 ms, or 29 ms a frame. Inside it: `drawnOverClusters` (`fill-pool-clusters.ts:63`, 684 ms, with `sweepStartsWithin` `:107` and `artworkInGaps` `:131`), `clustersOf` (`fill-pools.ts:287`, 315 ms), `overlappingGroups` (`fill-pool-clusters.ts:11`, 272 ms), `poolParts` (`fill-pools.ts:306`, 278 ms), `poolMembers` (`:242`, 327 ms).
  - Then `drawFillPools` (`fill-pools.ts:159`, 1,125 ms): each plate-and-window pair is a pool of 8 segments, too small for a sprite (`:181-183`), so it is painted directly — `save`, an even-odd `fill` and a **1.5 px** outline `stroke` (`:316`, the same per-object width rule as S2-P2-1) — 5,000 times a frame at 10,000 objects.
  - `drawScene` is 73 ms a redraw in JavaScript; the frames are 183–283 ms, so the GPU carries the rest.
- **Anchor:** ADR-683 and Amendment 1 (pools; item 4, "a still frame does not sweep again"); R5-P3-1 (its refuter: "2 fps at the limit against about 16 on the parent, before raster"). AREAS: 33 ms a frame at 5,000 objects; P2 for a slowdown of two times or more since 1.0.23.
- **Scenario:** a sheet of name plates, tags or coasters, each with a separate window shape on the same Fill operation, made with an array: all plates first, then all windows.
- **Evidence:** **REPRO**.
  - Main: `plates-5000` pan p95 **217 ms** (loaded set), over artwork 317 ms, zoom 267 ms, drag one 250 ms; `plates-10000` pan **283 ms**, zoom 417 ms, drag one 367 ms, with 114–283 ms main-thread blocks.
  - **Trend** (same sitting, idle machine): `plates-10000` pan p95 **250 / 250 / 33 ms** (main / 1.0.28 / 1.0.23), drag one 350 / 367 / 100 ms. `plates-5000` (idle re-run): pan **100 / 100 / 16.8 ms**, drag one 217 / 217 / 67 ms.
  - #1537 (R5's fix) did cut the main-thread part: R5 measured 424–462 ms of planning a frame at 10,000 in a no-op context; the longest pan task is now 114–144 ms. The frame time did not follow, because the per-frame planning and the 5,000 separate pool paints remain.
  - **A/B** (`plates-5000`, back to back): with every workspace stroke at ≤ 1 px, pan p95 100 → **33 ms** and drag one 200 → 67 ms. So about two thirds of the frame is the 1.5 px pool outlines (S2-P2-1's rule, applied per 8-segment pool), and the rest is the per-frame planning and paint calls.
- **Severity:** **P2** on two counts: pan at the budget's size is 3 times the budget on an idle machine (6.6 times in the loaded set), and 6 times slower than 1.0.23 (7.5 times at 10,000). ADR-683 is the reason the canvas pools at all, but no ADR accepts this cost: Amendment 1 states that a still frame does not sweep again, and here every frame plans again.
- **Fix direction** (display only):
  - cache the whole `FillPoolPlan` on the identity of `scene.objects` and the layers (a pan, zoom or hover changes neither), not only the cluster groups;
  - paint all whole pools of one colour as **one** even-odd path, one `fill` and one hairline `stroke`, instead of one save/fill/stroke per pool;
  - or sprite small pools together per colour, as large ones already are.
- **Refuter: CONFIRMED on current main, P2 kept.**
  - *Would be false if* #1537 or later changed the frame, or 1.0.23 were as slow. `git diff c0610b891 origin/main` (`df2279e26`, after #1546–#1549) touches none of `fill-pools.ts`, `fill-pool-clusters.ts`, `draw-scene.ts`, `object-display.ts` or `draw-complexity.ts`, and #1537 is already in `c0610b891`; the measured bundle is current for this path. `draw-scene.ts:336` still calls `planFillPools` on every redraw.
  - Pan from the margin, p95, same sitting: `plates-5000` main **100 ms**, 1.0.23 **16.8 ms** (6×); `plates-10000` main **233–250 ms**, 1.0.23 **33.4 ms** (7×). Main with artwork strokes at 1 px: `plates-5000` 100 → **33 ms**, drag one 117 → 83 ms, so the 1.5 px pool outlines are about two thirds of it, as reported.
  - *ADR reason?* ADR-683 Amendment 2 records the remaining cost ("a still frame 193-262 ms" at the limit, jsdom, "No raster cost is included") but does not accept it or state a budget, so the 2× regression line applies. The 5,000 pan is only just over 3× its budget (100 against 33 ms); the regression count carries the P2 on its own.

### S2-P3-1 — Every edit of a small Fill design re-estimates the whole job on the UI thread: a 185–251 ms block a quarter-second after each move, delete, duplicate or typed size at 200 objects

- **Where** (profile `prof-p200-dragone.json`, one 226 ms task after the drag ends):
  - `src/ui/laser/use-job-estimate.ts:245` (the effect, after `JOB_ESTIMATE_DEBOUNCE_MS`, `:41`) → `:351` `recomputeEstimate` → `:54` `memoizedLiveEstimate` (217 ms inclusive) → `live-job-estimate.ts:56` `estimateLiveJob` → `:138` → `core/job/estimate-duration.ts:43,60` (188 ms): `buildProgramTimeline` (`core/gcode-time/program-timeline.ts:91`, 141 ms), `buildGcodeRenderModel` (`core/gcode-view/gcode-render-model.ts:5`, 104 ms), `emitJob` (`core/output/grbl-strategy.ts:455`, 47 ms), `planFillSweeps` (`core/job/fill-sweep-plan.ts:47`, 38 ms).
  - The route is chosen by `ui/workspace/canvas-preparation-policy.ts:28-46`: a scene stays on the UI thread while its fill spans are under `PREPARATION_COMPILED_SEGMENT_BUDGET` (20,000, `core/job/preparation-complexity.ts:29,73-77`). `mix-200` has 12,700 spans (100 rectangles of 17.7 × 12.7 mm at 0.1 mm), so it is "cheap" and runs here.
- **Anchor:** AREAS: 200 ms for the longest UI block while designing. ADR-346 (the estimate is memoised so two mounts pay once) and ADR-598 (heavy preparation in workers) set the route; neither states what the direct path may cost.
- **Scenario:** any edit to an ordinary design with a few square centimetres of Fill at the default 0.1 mm interval.
- **Evidence:** **REPRO** at 200 objects, every edit type, n=5 each: longest task 185–251 ms (medians 192–223) after dragone, dragall, resize, Delete, Duplicate and typed width; 0 ms after click-select, Undo and Redo, which reuse a memoised estimate. The canvas has already shown the edit 29–46 ms after the input, so this is a hitch after the response, not a slow response. Sixteen large Fill squares (64 vertices, 14,400 spans): 116–145 ms.
  - **Trend:** main 195–227 ms, 1.0.28 193–224 ms, 1.0.23 188–231 ms (same sitting): not a regression.
- **Severity:** P3. Just over the 200 ms budget (up to 1.25×), on the commonest edits of an everyday Fill design.
- **Fix direction:** route the estimate by a budget calibrated in milliseconds (the direct path now admits roughly 300 ms of work at 19,999 spans), or always estimate in the worker that `followUpWithWorkerEstimate` already uses and show the previous ETA meanwhile. The ETA value and the G-code do not change.
- **Refuter: CONFIRMED, P3 kept.** *Would be false if* the block were under 200 ms or not after the edit. `mix-200`, select and Delete, long tasks in the 1.2 s after the key: **185–214 ms** over 6 runs (n=5 kept plus one smoke pair, 194 and 213). The route is as described: `canvas-preparation-policy.ts:28,42` keeps a scene direct under 20,000 work units. ADR-346 Consequences already lists "the sub-budget estimate … still on the UI thread" as open, so this is a known gap now measured, not a new design flaw.

### S2-P3-2 — The 50,000-path trace re-resolves every path on every frame and repaints its sprite on every resize step: blocks of 115–578 ms, and pan JavaScript 1.65 times 1.0.23's

- **Where** (profiles `prof-P-trace50k-{pan,dragone,zoom-m}-*.json`):
  - `draw-scene.ts:442-460` (`placeObjects`) calls `resolveObjectDisplay` (`object-display.ts:98-143`) for the trace on every redraw, although the pan only blits its sprite: one loop over 50,000 paths with `resolvePath`, `resolvePaint` (`:222`), `displayPathFor` (`:295`) and a 50,000-part `styleParts.join` for the sprite key (`:120-142`). Pan: 3,035 ms over 60 redraws (51 ms each).
  - `planFillPools` → `poolMembers` (`fill-pools.ts:242-250`) walks the same 50,000 paths every frame (674 ms, 11 ms a frame); this walk is new since 1.0.23 (#1511).
  - With the trace selected, `drawSelectedOpenFillContours` (`draw-open-fill-contours.ts:7` → `core/job/open-fill-contours.ts:41-109`) recomputes open-contour diagnostics every frame (141 ms).
  - Resize changes the sprite's linear key at each step, so `artwork-sprite-cache.ts:201` (`render`) repaints all 200,000 segments every step (zoom, by contrast, waits 150 ms and shows a scaled placeholder). READ; the resize was not profiled.
- **Anchor:** ADR-346 ("pans, moves of the object, selection changes … reuse the bitmap"; a zoom shows the previous bitmap scaled). AREAS: 200 ms block; 33 ms frame.
- **Scenario:** the benchmark trace (`large-file-benchmark-cases.mjs`) imported, then panned, zoomed, dragged and resized.
- **Evidence:** **REPRO**. Pan p95 50–67 ms with 116–152 ms blocks; zoom-settle blocks 195–296 ms; drag release 444–495 ms; marquee 176–183 ms; **resize p95 383 ms with 513–578 ms blocks**. Trend (p95 main / 1.0.28 / 1.0.23): pan 67 / 50 / 33 ms, zoom at the margin 67 / 50 / 33 ms, drag-release block 444 / 427 / 365 ms; per-redraw JavaScript 61 / 49 / 37 ms (1.65×, under the 2× line).
- **Severity:** P3. Over the 200 ms block budget on drag release, zoom settle and resize, and 1.65 times slower per frame than 1.0.23, but below the 2× regression line and on the large benchmark input.
- **Fix direction:** cache `resolveObjectDisplay` per object identity, layers and zoom bucket (the result does not depend on translation), and the sprite key with it; skip `poolMembers` for objects with no pooled path; cache open-contour diagnostics per object; during a resize drag, blit the old sprite scaled and repaint once the handle stops, as zoom does.
- **Refuter: PLAUSIBLE, P3 kept (code confirmed, not re-timed).** The code path holds on current main: `draw-scene.ts:326-340` runs `placeObjects` → `resolveObjectDisplay` and `planFillPools` → `poolMembers` on every redraw, and ADR-346's own Consequences say rotating or resizing a dense object "re-renders its sprite every frame". The trace scene was not re-imported here (time and memory), so the block sizes rest on the auditor's runs. The resize repaint is accepted behaviour in ADR-346; only the 513–578 ms block length is a budget miss.

### S2-P3-3 — With thousands selected, every frame draws a box per object and the side panels recompute per selection: drag-all commits block 207–300 ms at 5,000 and 469–513 ms at 10,000

- **Where** (profile `prof-P-mix5000-dragall-dragall.json`, inclusive ms over the drag):
  - `draw-selection-overlay.ts:12` → `:80` (`drawSecondarySelectionBox`, 327 ms): a dashed box per selected object on every redraw, 5,000 of them.
  - React panels that recompute from the whole selection on each transform: `CommandShell.tsx:77` → `use-app-commands.ts:59,112` (`appCommandContext`, 439 ms); `AdvancedArtworkSettings.tsx:20,123` (`powerResults`, 229 ms); `CentreSelectionButton.tsx:19` → `artwork-centre-control-state.ts:7-14` → `selected-artwork-light-targets.ts:19` (219 ms); `fill-diagnostics.ts:22` (`selectedOpenFillContours`, 228 ms).
- **Anchor:** AREAS: 200 ms block; 100 ms response.
- **Evidence:** **REPRO**. Drag all: blocks 207–300 ms at 5,000 (n=5; 168–202 ms in the A/B sets) and 469–513 ms at 10,000; marquee release at 10,000 223–323 ms. Delete at 5,000: response 121–154 ms (blocks 110–142 ms; the profile run did not catch the block, so not attributed). 1.0.23's drag-all was far worse (3.2 s p95, 3.6 s block): this is the remainder after that fix.
- **Severity:** P3. Up to 1.5 times the block budget at the budget's size; 2.5 times at the project limit.
- **Fix direction:** draw one combined outline for a multi-selection instead of a box per member (or only above a zoom where boxes are distinguishable); derive panel state from a memoised selection summary keyed on the selection and the objects' identities, so a drag step does not recompute power, light targets and fill diagnostics for 5,000 objects.
- **Refuter: CONFIRMED, P3 kept.** `mix-5000`, Ctrl+A then a 40-move drag: longest task **206–391 ms** (n=5), frames p95 167 ms. Slightly worse than reported at the top; still under 2× the block budget at the budget's size, so P3. Not attributed again (no profile).

### S2-P3-4 — The repo's canvas performance probes time only JavaScript, so none of this report's causes is visible to them

- **Where:** `scripts/performance-audit/large-trace-canvas-browser.mjs:84-91` times `draw.drawScene` with `performance.now()` around the call; `hotpath-probe.mjs` times sprite painting in a bare page; `interaction.e2e.ts` covers G-code open and Refresh only. No probe or e2e test measures frame intervals, the hover pulse, many-object scenes or GPU raster.
- **Anchor:** AREAS: "a missing guard or benchmark".
- **Evidence:** READ, and REPRO by contrast: S2-P2-1's `line-5000` zoom at the margin spends 336 ms of JavaScript in a window where the renderer sat idle 3.7 s of about 4.1 s waiting for frames (`prof-P-line5000-zoom-m-zoom-m.json`), so a JavaScript-timing probe reports it as fast.
- **Severity:** P3.
- **Fix direction:** the guard proposal below (operation counts that predict GPU cost, plus a nightly frame-interval run on a GPU machine).
- **Refuter: CONFIRMED in substance, P3 kept; one sentence is wrong.** "No probe … measures frame intervals" is false: `scripts/performance-audit/packaged-canvas-observer.mjs:70-96` records rAF frame intervals, navigation frame intervals and long tasks, driven by `packaged-trace-navigation.mjs` on the packaged app. Those intervals would show GPU-bound frames. What holds: that observer is attach-only and manual (its tests in `test:release-integrity` check the observer, not a frame budget), it navigates one large trace, and nothing covers many-object scenes, the hover pulse or Fill pools, or runs with a frame budget in CI. The headline's "could not have seen any of the GPU-bound costs" should read "were never pointed at the scenes that show them".

## KNOWN re-observed

- **R5-P3-1** (plates then windows, the per-frame scan). Re-measured after #1537 in the browser. The main-thread part has shrunk: at 10,000 objects the longest task in a pan is 114–144 ms (R5's no-op-context figure was 424–462 ms a frame). The frames have not: on an idle machine pan p95 is 250–283 ms at 10,000 and 100 ms at 5,000, against 33 and 16.8 ms on 1.0.23. Raised as **S2-P2-4**.
- **N6-P3-3** (5,000 overlapping Fill circles). Re-measured with GPU raster: each drag step 0.7–1.4 s and a 40-step drag that hangs for minutes, pulse on or off. Raised as **S2-P2-3**. Its slow zoom (3.5 s frames) turned out to be the hover pulse (S2-P2-2).
- **ADR-346's dense-artwork work** (the 2026-09-09 canvas audit and its sprites) holds for what it targeted: one large object. The 50,000-path trace pans at p95 50–67 ms and the 4096 × 4096 image at 16.8 ms, with sprite and raster-cache memory flat over 200 pans and zooms. Its per-object hairline rule is the cause of S2-P2-1.

## Refuted

- **"Zoom is slow because display polylines are re-flattened per notch."** At the empty margin the same 20 notches on `mix-5000` run at p95 33 ms with no long task; the cost of the centre zoom is the pulse and the 1.5 px strokes (S2-P2-1/2 A/B). Display-polyline caching by tolerance bucket (`display-polylines.ts:92-113`) works.
- **"Marquee got twice as slow since 1.0.23."** Each marquee run is either about 83–100 ms p95 or 150–200 ms. On `mix-5000` main was fast in 4 of 5 runs in the main batch but 1 of 5 in the trend set; 1.0.28 2 of 5; 1.0.23 5 of 5. Main's fast runs equal 1.0.23's, and the per-redraw JavaScript is 25–27 ms on main against 20–22 ms on 1.0.23 (+25%), so a 2× regression is not shown. Recorded as a lead for the refuter, not raised.
- **"Frames stop for about 250 ms after a drag with no long task"** (seen in the first smoke runs). A harness artifact: long-task entries are delivered late, so a window that ended inside the post-edit task missed it. Fixed by flushing with `takeRecords()` and waiting one frame at the end of each window; the block is S2-P3-1.
- **"The 4096 × 4096 image slows the canvas."** All seven interactions run at p95 16.8 ms with no long task, in all three builds.
- **"A 200-line text project crashes the tab on Open."** Seen twice in early smoke runs (a 79 MB project written by the app's own save). A harness artifact: a bare `fetch` of the same 79 MB through Playwright's `page.route`, with no app code involved, closes the page too (`zz-route-test.mjs`). In the app, 100 text lines plus Ctrl+A and Ctrl+D make 200 (heap 195 MB); the page stays alive and pans (`text-crash.mjs dup`).
- **"Sprite memory grows with zooming."** Live canvas pixels stay flat over 200 pans and zooms on the trace, the image and 100 text sprites, far inside ADR-346's budget; the JS heap settles back after GC.

## Verified clean

- **Everyday size (200 objects, laser and CNC):** pan, zoom, pinch, marquee, hover and drag all run at p95 16.8 ms; every response (click, Delete, Undo, Redo, Duplicate, typed width) shows on screen in 29–46 ms. The one miss is the block after an edit (S2-P3-1).
- **The 4096 × 4096 benchmark image:** every interaction at 60 fps, no long task, raster cache flat (7.2 M pixels) over 200 pans and zooms; the same in 1.0.28 and 1.0.23.
- **The 50,000-path benchmark trace, pan and zoom frames:** p95 50–67 ms with sprites reused across pans (canvases created: 24 over 200 cycles). Its blocks are S2-P3-2.
- **Text:** 100 real text lines (630,000 vertices) pan at p95 50 ms and zoom at 33 ms, from 100 sprites inside the budget.
- **Memory:** no growth over 200 pans and zooms on any scene; the JS heap returns to within 2–16 MB of its start after GC, and the Playwright Chrome's private memory stays under 1.25 GB.
- **Resize rows grab a handle** at every size (check-only runs `V-mix*`, dragging the handle 30 px out): 200 objects, the corner (17.7 × 12.7 → 35.9 × 25.6 mm); 5,000, the east edge (width 3.7 → 21.9 mm); 10,000, a south edge (height 1.9 → 18.2 mm). The trace and the image changed size too.
- **Dragging all 5,000 objects** is 19 times faster than 1.0.23 (p95 167 ms against 3,167 ms; its 3.6 s commit block is gone).

## Not verified

- **The packaged desktop app** (Electron). Every number is installed Chrome 156 with Skia Graphite on an Iris Xe. The desktop's Chromium, other GPUs and software raster will differ, most in the GPU-bound rows (S2-P2-1/2/3).
- **A real touch-pad pinch.** Simulated as Chromium sends it (Ctrl+wheel in pixel mode, 5 px a step).
- **The CNC 3D preview** (`Cnc3DPane`, G-code 3D tab): S8 owns its frame rate. Only the CNC 2D canvas was measured.
- **Text-heavy scenes past 100 lines, by Open.** A 200-line file could not be served through the harness (see Refuted); 200 lines made in the app were checked for survival and one pan, not timed.
- **Text drag:** the drag target missed the glyphs, so the `text-100` "drag one" row is a marquee; it is left out of the scorecard.
- **Which draw step hangs in S2-P2-3's drag** (no trace of that step).
- **Delete at 5,000 objects** (121–154 ms response): the profiled run did not catch the 110–142 ms block, so it is not attributed.
- **Sets marked loaded** (plates, 23:40–23:58, calibration 72–93 ms) were not all re-run; the plates rows are confirmed by the trend sets taken later on an idle machine (calibration 43–47 ms).

## Ranked list — what an ordinary user meets, by how often

1. **The hitch after each edit of a Fill design** (S2-P3-1). Every user with a Fill operation, on every move, delete, duplicate or typed size: 0.19–0.25 s, felt as a stutter after the change appears.
2. **Hovering and panning over a large design** (S2-P2-2). Anyone with more than about a thousand shapes on one operation: every rest of the pointer drops the canvas to 10 fps for two seconds, and pans and zooms begun over the artwork to 4–5 fps.
3. **Large Line designs** (S2-P2-1). Cut files of thousands of small parts: every pan, zoom, drag, Undo and Redo, at 1–7 fps with stalls of seconds.
4. **Plate arrays with separate window cut-outs** (S2-P2-4). Batch name plates and tags: 4–10 fps panning, six times slower than 1.0.23.
5. **Large selections** (S2-P3-3). Select-all on a big design: 0.2–0.5 s blocks per drag commit.
6. **Large traces** (S2-P3-2). Resize and drag of a dense trace: 0.4–0.6 s blocks.
7. **Overlapping Fill pools** (S2-P2-3). Rare (halftone-like overlaps), but a single drag can hang the app for minutes.

## Guard proposal

Counts, not milliseconds, so CI timing noise does not matter:

1. **Stroke-width counter** (unit, jsdom canvas recorder): draw `line-5000` once and count the segments stroked with `lineWidth > 1` device px. Today it is about 155,000; after S2-P2-1's fix it must be under the hairline threshold (20,000).
2. **Pulse work counter** (unit): hover one object in `mix-5000` and count the piece bitmaps `renderPieceBitmap` creates and the `drawImage` calls one pulse frame issues. Today 2,500 pieces, four canvases each, and up to 7,500 blits a frame; after S2-P2-2 it must be bounded by the pieces in view and a fixed cap.
3. **Pool repaint counter** (unit): drag one member of the 5,000-circle pool by 10 steps and count pool sprite renders and the segments passed to `clip()`. Today one full-pool render per step; the fix should make it zero during the drag and one on release.
4. **Nightly production-bundle run** of this harness (`run.mjs`, not per PR): `mix-5000` pan from the margin, pan over artwork, zoom, hover and drag, with frame p95 under 33 ms, and `mix-200` with no long task over 200 ms after an edit. It needs a real GPU: a software-raster CI runner would measure something else.

```json
{
  "area": "S2-canvas-interaction",
  "tree": "c0610b891",
  "counts": { "raised": 8, "refuted": 0, "P1": 0, "P2": 4, "P3": 4, "known": 2 },
  "refuter": { "date": "2026-11-03", "tree": "df2279e26 (cited files unchanged since c0610b891)", "confirmed": 7, "plausible": 1, "refuted": 0, "known": 2, "severity_changes": "none", "notes": "S2-P2-1 fix by scene-wide hairline needs an ADR-346 amendment (1.5 px ordinary weight is deliberate); S2-P2-2 numeric cap needs an ADR-620 amendment (same-settings group); S2-P2-3 freeze reproduced (no frame 120 s, recovered after ~12 min, no crash, so P2 not P1); S2-P3-4 wording corrected (packaged-canvas-observer does record frame intervals); GPU bound confirmed by trace; conclusions hold with --disable-accelerated-2d-canvas" },
  "budgets": { "frame_p95_ms_at_5000": 33, "response_ms": 100, "design_block_ms": 200, "ordinary_size_result": "200 objects: frames and responses pass; 185-251 ms block after each Fill edit (S2-P3-1)" },
  "findings": [
    { "id": "S2-P2-1", "refuter": "CONFIRMED", "severity": "P2", "evidence": "REPRO", "file": "src/ui/workspace/draw-complexity.ts", "line": 25, "known": false, "regression": "none (same in 1.0.28 and 1.0.23)", "title": "Hairline rule is per object (20,000 segments), so thousands of small shapes stroke at 1.5 px through the full stroker; GPU-bound frames: line-5000 pan p95 150-217 ms, zoom 1,417 ms (worst 7.2 s), drag 250-417 ms; mix-5000 pan 83 ms; Redo frame 723 ms. A/B strokes <= 1 px: 16.8 / 16.8 / 33 / 16.8 ms, Redo 95 ms" },
    { "id": "S2-P2-2", "refuter": "CONFIRMED", "severity": "P2", "evidence": "REPRO", "file": "src/ui/workspace/draw-artwork-pulse.ts", "line": 98, "known": false, "regression": "none on mix-5000; overlapping-circle zoom 2,067 vs 133 ms on 1.0.23 (unattributed)", "title": "Hover pulse lights every same-settings piece (4 canvases each, 3 blits per piece per frame, no cap): mix-5000 hover p95 100 ms, pan over artwork 183-233, zoom 217, click-select 151 ms; pulse off: 16.8 / 83 / 50 ms, click 64 ms; circles-5000 zoom 49-56 s for 20 notches" },
    { "id": "S2-P2-3", "refuter": "CONFIRMED", "severity": "P2", "evidence": "REPRO", "file": "src/ui/workspace/fill-pools.ts", "line": 176, "known": true, "known_ref": "N6-P3-3", "regression": "drag step 4-5x slower than 1.0.23 (pools, ADR-683)", "title": "5,000 overlapping Fill circles: each drag step 0.7-1.4 s (pulse on or off); a 40-step drag hung the GPU over 10 min in 3 of 3 runs (no frame for 181 s at step 27)" },
    { "id": "S2-P2-4", "refuter": "CONFIRMED", "severity": "P2", "evidence": "REPRO", "file": "src/ui/workspace/fill-pools.ts", "line": 104, "known": true, "known_ref": "R5-P3-1", "regression": "6x (5,000) and 7.5x (10,000) slower than 1.0.23", "title": "Plates then windows: pan p95 100 ms at 5,000 and 250-283 ms at 10,000 vs 17 and 33 ms on 1.0.23; planFillPools every frame (29 ms at 10,000) plus one save/fill/1.5 px stroke per two-member pool; strokes <= 1 px: 100 -> 33 ms" },
    { "id": "S2-P3-1", "refuter": "CONFIRMED", "severity": "P3", "evidence": "REPRO", "file": "src/ui/laser/use-job-estimate.ts", "line": 351, "known": false, "regression": "none", "title": "After every edit of a small Fill design the live ETA compiles and times the job on the UI thread: 185-251 ms block at 200 objects (direct route up to 20,000 fill spans)" },
    { "id": "S2-P3-2", "refuter": "PLAUSIBLE", "severity": "P3", "evidence": "REPRO", "file": "src/ui/workspace/object-display.ts", "line": 98, "known": false, "regression": "1.65x per-redraw JS since 1.0.23 (poolMembers walk, #1511)", "title": "50,000-path trace re-resolves every path each frame and repaints its sprite per resize step: blocks 116-152 (pan), 195-296 (zoom settle), 444-495 (drag release), 513-578 ms (resize, p95 383 ms)" },
    { "id": "S2-P3-3", "refuter": "CONFIRMED", "severity": "P3", "evidence": "REPRO", "file": "src/ui/workspace/draw-selection-overlay.ts", "line": 80, "known": false, "regression": "improved: 1.0.23 drag-all 3.2 s p95", "title": "Thousands selected: a box per object per frame and selection-wide panel recomputes; drag-all commit blocks 207-300 ms at 5,000, 469-513 ms at 10,000; Delete response 121-154 ms at 5,000 (not attributed)" },
    { "id": "S2-P3-4", "refuter": "CONFIRMED", "severity": "P3", "evidence": "READ", "file": "scripts/performance-audit/large-trace-canvas-browser.mjs", "line": 84, "known": false, "title": "Canvas performance probes time only JavaScript (drawScene), so GPU-bound frame costs are invisible; no frame-interval or many-object guard exists" }
  ],
  "known_reobserved": ["N6-P3-3 (raised as S2-P2-3)", "R5-P3-1 (raised as S2-P2-4)"]
}
```
