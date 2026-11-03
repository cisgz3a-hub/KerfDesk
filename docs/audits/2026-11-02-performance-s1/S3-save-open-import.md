# Performance audit S1 — S3 Save, Open and Import

- **When:** 2026-11-03 06:55 – 12:45 +0800.
- **Tree:** origin/main @ `df2279e26` (worktree `claude/performance-audit-s1`, HEAD `7a23c7a52`, which adds only the S1 and S2 reports).
  - Every set ran on a production build of the `j7-main` copy. A diff of that copy against `df2279e26` through a throw-away index (`src`, `public`, `scripts`, `index.html`, `vite.config.ts`, `package.json`) was empty. S2's `dist-main` was built from `c0610b891`, so a fresh build was made: `vite build --sourcemap hidden` with S2's config (fflate alias), into `zz-s3\dist-main`.
  - **Main moved during the audit** to `1405bc777` (#1550, #1551: golden 1.0.29 projects, Fill pools). `git diff --stat df2279e26 origin/main` touches none of the files cited below.
  - **Trend builds:** S1's `dist-33bc394c6` (1.0.28) and `dist-87ecb4f24` (1.0.23), built with main's `vite.config.ts` and main's `node_modules` (S1's method and caveat). Each release opened projects written by its **own** `serializeProject` (S2's `src` exports in `scratchpad\zz-s2-old\`) or saved by its own UI (the photo projects).
- **Machine state:** i7-1260P (12 cores, 16 threads), 16 GB, Intel Iris Xe. Chrome 156 (installed, headless, real GPU). The owner's own Chrome (9 processes) stayed open and is excluded from memory figures. `machine-state.log` in the harness records free memory, CPU load and other sessions' `vitest`/`eslint`/`tsc`/`vite build` command lines before and after every set.
  - **Other work:** a fix session (S2's Fill-pool fixes, #1551) ran `vitest`, `eslint` and `tsc` from about 07:44 to 08:30, and a second Playwright Chrome ran for part of the morning. From 08:18 every set waited for that tooling to finish first (`runset.sh` gate; one wait of 335 s). Sets taken from 07:44 to 08:30 and the early batch-B sets drifted in calibration and were **re-measured** (labels `R-`, `D-`, `TM-`); the scorecard uses only the re-measured sets.
  - **Gap:** at about 09:30 (local) every `node` process on the PC ended, my three hosts included, not by this audit. The coordinator reports the hosts were stopped by another session and restarted. Both probe runs that overlapped the gap (`probe-img1-edit20`, the first `probe-imgautosave`) were discarded and re-run (`probe-img4-single`, `probe-img1-single`, `probe-img4-edit60`).
  - **Calibration** (S1's 40M-step loop in the page, after a 3 s settle): 36–47 ms idle on every scorecard set; 56–95 ms while the fix session ran (those sets discarded). Sets that open a photo project read 55–62 ms after, because the app's own preparation worker was still busy (see S3-P2-3).
  - **Memory figures** are the private bytes of the measuring Chrome only: from 08:52 the poller follows the one browser process carrying a `--zz-s3-run=<pid>` flag, and its children, split into renderer (with its workers) and GPU. Earlier memory columns could include another session's Playwright Chrome and are not used.
- **Temp files:** none in `j7-main` (the build config was moved into the harness). Kept for the refuter: `scratchpad\zz-s3\` (scripts, `results.jsonl`, `results-prof.jsonl`, `machine-state.log`, `logs\`, profiles, the main build `dist-main` with hidden maps, the small projects and fixtures). The 90–99 MB photo projects and the large fixtures were deleted to save disk; the commands under "Re-running" remake them.
- **Scope:** Open (`.lf2` at 200 / 2,000 / 10,000 objects; 2,040 with four embedded fonts; 2,004 with four embedded 12 MP photos; 201 with one photo; `.lbrn2` at 200 and 2,000), Save (the same), the 30 s autosave pause at 200 / 2,000 / 10,000 and with photos, Import (SVG 1,000 and 50,000 paths, DXF with nested blocks ordinary and large, PDF 500 and 20,000 paths, AI, PNG 1.5 MP, JPEG 12 MP, the 4096 × 4096 benchmark PNG, 16-bit two-page TIFF ordinary and large), Paste of 200 and 2,000, Undo and Redo after each, Undo memory over 50 edits on 2,000 objects, and Recovery on start-up. Trend against 1.0.28 and 1.0.23 for 14 rows.
- **Counts:** 5 raised → 0 refuted → P1 0 / P2 3 / P3 2 (+ 5 KNOWN re-observed). **Refuter:** 4 CONFIRMED, 1 CONFIRMED with a corrected scenario (S3-P2-2), 0 PLAUSIBLE, 0 REFUTED; no severity changes. One sub-claim of S3-P2-2 is refuted (see `## Refuted`).

## Headline

**Save, autosave and Undo are clean at every size.** Save runs in a worker: 77 ms at 200 objects, 240 ms at 2,000 and 1.0 s at 10,000, with no main-thread task over 68 ms. The autosave pause is **zero**: no long task and no frame over 35 ms at 200, 2,000 and 10,000 objects. Compact files (#1488) are 3.8–3.9 times smaller than 1.0.23's and save faster (10,000 objects: 1.0 s and a 65 ms block, against 1.5 s and a 204–222 ms block). Undo keeps whole projects but shares their objects: 50 edits of every object of a 2,000-object project hold 34 MB.

**Open is within budget for vector work.** 2,000 objects open in 325 ms (budget 5 s) and 10,000 in 1.06 s; the same in 1.0.28 and 1.0.23. At 200 objects the only miss is the known 235–242 ms job-estimate block after the scene appears (S2-P3-1).

**Photos are where the time and memory go.**

- **S3-P2-1 (P2).** Importing an ordinary 12 MP phone photo freezes the window for **1.06–1.10 s** (5.5 times the 200 ms budget) with no progress: the JPEG is decoded, composited and turned into a base64 luma string on the UI thread, one character at a time. The 4096 × 4096 benchmark PNG blocks **1.30 s** and a 9 MP TIFF page **0.85–0.91 s** (the TIFF is decoded in a worker, then re-encoded to PNG and decoded again on the UI thread). Same in 1.0.23.
- **S3-P2-2 (P2).** In a project with bed-sized photos, autosave waits behind the background job preparation in the shared worker lane (ADR-288 Amendment 1). With four photos the first autosave after an edit landed **about 125 s** after it; at 60 s the app warns that "image-heavy projects can exceed browser storage", which is not the cause. A crash or forced close 50 s after an edit left **no recovery offer in 4 of 4 runs** (refuter: the harness closed the page without running `beforeunload`; an ordinary close of a dirty project shows the browser's leave prompt, or Save / Don't Save / Cancel on desktop, so the loss needs a crash, kill or power cut). With one bed-sized photo or one 100 mm photo the autosave stays inside its 30 s interval.
- **S3-P2-3 (P2).** While that preparation runs, the renderer's memory climbs to **9.5 GB** with four photos (two runs: 8.3 and 9.5 GB peak) and **3.3 GB** with one, against a 1.5 GB budget for the whole app; it falls by 7 GB within 2 s of the worker ending. A Save during it peaks at **4.1–4.5 GB**.
- **S3-P3-1 (P3).** A project of 25 MiB or more (any project with a few photos) is read by a character-at-a-time streamed JSON reader: the 90 MB, 2,004-object photo project opens in **8.4–8.8 s** (budget 5 s); in Node the reader takes 7.6 s where `JSON.parse` takes 0.09 s.

**Large vector imports** (50,000 SVG paths, 20,000 PDF paths) and 10,000-object Opens block the UI **0.55–0.86 s** when the parsed result arrives (S3-P3-2). The same in 1.0.23.

**Trustworthiness.** Production bundles in Chrome 156, a fresh browser context per run, the first run of six dropped, median and worst of the rest. Every scorecard set ran with calibration at 36–47 ms (idle machine) and no other tooling; the trend rows were run back to back per row in one sitting. Absolute times are good to about ±15%; main against 1.0.28 and 1.0.23 is firmer, because each trio ran within six minutes. Memory figures cover only the measuring Chrome. The photo findings rest on probes that log worker starts, worker ends, storage writes and memory together; the cause of S3-P2-3's memory (the preparation worker) is shown by timing, not by a heap snapshot.

## Scorecard

Times are median / worst of five kept runs (three where marked n=3). "Shown" is input → the first frame whose status bar shows the new object count. "Block" is the longest main-thread task in the window. "Memory" is the peak private memory of the measuring Chrome (renderer + GPU + browser) during the operation; a fresh app is about 1.03 GB. Budgets: 100 ms response, 200 ms longest block while designing, 50 ms autosave pause, 2,000-object Open 5 s, 1.5 GB peak memory. Trend is the shown time (or save time) and block for main / 1.0.28 / 1.0.23 from the interleaved `TM-` / `T28-` / `T23-` sets.

**Open**

| Input | Shown | Block | Memory | Budget | Verdict | Trend (shown; block) |
|---|---|---|---|---|---|---|
| `.lf2` 200 objects (0.32 MB) | 134 ms (137) | 235–242 ms (job estimate) | 1.16 GB | 5 s; 200 ms | Block 1.2× (KNOWN S2-P3-1) | — |
| `.lf2` 2,000 (3.3 MB) | 325 ms (339) | 146–154 ms | 1.32 GB | 5 s | Pass | 325 / 317 / 321 ms; 146 / 151 / 141 |
| `.lf2` 10,000 (16 MB) | 1,058 ms (1,173); settled 2.25 s | **550–683 ms** | 1.98 GB | 200 ms block | **S3-P3-2** | 1,058 / 1,053 / 1,015; 550 / 540 / 528 |
| `.lf2` 2,040 with 4 embedded fonts (4.0 MB) | 337 ms (388) | 152–184 ms | 1.32 GB | 5 s | Pass | — |
| `.lf2` 201 with one 12 MP photo (22 MB) | 505 ms (575) | 112–127 ms | 1.53 GB, then up to **3.9 GB** | 1.5 GB | **S3-P2-3** | — |
| `.lf2` 2,004 with four 12 MP photos (90 MB) | **8.4 s (8.8)** | 216–260 ms | **2.8–3.0 GB**, then up to **9.5 GB** | 5 s; 1.5 GB | **S3-P3-1**, **S3-P2-3** | 8.6 / 8.8 / 8.8 s (n=3); 244 / 234 / 215 |
| `.lbrn2` 200 shapes | 138 ms (154) | 269–284 ms (job estimate) | 1.10 GB | 200 ms | KNOWN S2-P3-1 | — |
| `.lbrn2` 2,000 shapes | 334 ms (344) | 151–153 ms | 1.26 GB | 5 s | Pass | — |

**Save** (Ctrl+S to the opened file; "Save" is key → file closed)

| Input | Save | Block | File | Memory | Verdict | Trend (save; file) |
|---|---|---|---|---|---|---|
| 200 objects | 77 ms (89) | 0 | 0.32 MB | 1.20 GB | Pass | — |
| 2,000 | 240 ms (257) | 0 | 3.26 MB | 1.34 GB | Pass | 240 / 246 / 318 ms; 3.26 / 3.26 / **12.5** MB |
| 10,000 | 1,031 ms (1,042) | 65–68 ms | 16.1 MB | 2.09 GB | Pass | 1,031 / 976 / 1,495 ms; 16.1 / 16.1 / **62.5** MB; block 65 / 63 / 204–222 |
| 2,040 with fonts | 291 ms (342) | 0 | 4.0 MB | 1.33 GB | Pass | — |
| 2,004 with four photos | 2.06–2.29 s | **401–459 ms** | 89.8 MB | **4.1–4.5 GB** | **S3-P2-3** (memory); block 2.2× | 2.1 / 2.1 / 2.3 s; 89.8 / 89.8 / 99.1 MB (n=3) |

Main writes compact JSON only (ADR-204 Amendment 2); 1.0.23's pretty files are the "compact vs pretty" comparison.

**Autosave pause** (open, nudge one object, then move the mouse over the margin until the 30 s autosave has written, plus 1.5 s)

| Input | Longest task | Longest frame | Verdict |
|---|---|---|---|
| 200 objects | 0 | 18 ms | Pass |
| 2,000 | 0 | 17 ms | Pass |
| 10,000 (n=3) | 0 | 21–35 ms | Pass |
| 201 with one photo | 0 | — | Written about 30 s after the edit (tick queued behind the preparation) |
| 2,004 with four photos | 89–95 ms | 83–100 ms | **No write within 45 s (3 of 3)**; first write about 125 s after the edit → **S3-P2-2** |

**Import** ("Shown" is from the click on Import..., or from **Import page** for PDF, AI and TIFF; Undo and Redo are response times to the count changing)

| Input | Shown | Block | Memory | Undo / Redo | Verdict | Trend (shown; block) |
|---|---|---|---|---|---|---|
| SVG 1,000 paths | 141 ms (146) | 102–104 ms | 1.09 GB | 29 / 30 ms | Pass | — |
| SVG 50,000 paths (benchmark) | 1,967 ms (2,004); settled 3.6 s | **801–863 ms** | 1.76 GB | 28 / 196 ms | **S3-P3-2** | 1,967 / 1,933 / 1,904; 801 / 763 / 752 |
| DXF 100 nested INSERTs + 250 entities | 128 ms (150) | 126–154 ms | 1.09 GB | two presses / 29 ms | Pass | — |
| DXF 2,000 nested INSERTs + 12,000 entities | 875 ms (916) | 237–246 ms | 1.56 GB | two presses / 29 ms | Block 1.2× | 875 / 875 / 942; 237 / 232 / 247 |
| PDF 500 paths | 136 ms (157) | 114–115 ms | 1.11 GB | 23 / 30 ms | Pass | — |
| PDF 20,000 paths | 2,354 ms (2,445) | **578–667 ms** | 1.92 GB | 112 / 96 ms | **S3-P3-2** | 2,354 / 2,308 / 2,322; 578 / 543 / 547 |
| AI (the PDF above, `.ai`) | 1,857 ms (1,875) | 456–459 ms | 1.92 GB | 129 / 97 ms | **S3-P3-2** | — |
| PNG 1500 × 1000 photo | 239 ms (287) | 118–136 ms | 1.27 GB | 28 / 30 ms | Pass | — |
| **JPEG 4000 × 3000 (12 MP phone photo)** | 1,214 ms (1,249) | **1,063–1,098 ms** | 1.86 GB | 57 / 45 ms | **S3-P2-1** | 1,214 / 1,212 / 1,189; 1,063 / 1,074 / 1,051 |
| PNG 4096 × 4096 (benchmark) | 1,378 ms (1,387) | **1,300–1,310 ms** | 2.08 GB | two presses / 96 ms | **S3-P2-1** | 1,378 / 1,395 / 1,378; 1,300 / 1,319 / 1,294 |
| TIFF 16-bit, 2 pages of 1600 × 1200 | 190 ms (196); dialog ready 0.49 s | 114–119 ms | 1.37 GB | 29 / 30 ms | Pass | — |
| TIFF 16-bit, 2 pages of 3000 × 3000 | 999 ms (1,058); dialog ready 2.0 s | **845–907 ms** | 1.99 GB | 28 / 30 ms | **S3-P2-1** | 999 / 1,027 / 1,012; 845 / 860 / 859 |
| EPS; Netpbm | — | — | — | — | Not offered by Import (Netpbm only in Pro Multi-File Trace) | — |

**Paste** (Ctrl+A, Ctrl+C, then Ctrl+V)

| Input | Shown | Block | Longest frame | Undo / Redo | Verdict | Trend (shown; redo) |
|---|---|---|---|---|---|---|
| 200 objects | 65 ms (130) | 0 | 50 ms | 45 / 52 ms | Pass | — |
| 2,000 objects | 323 ms (361) | 262–292 ms (hover pulse) | 733–850 ms | 175 / **683–857 ms** | KNOWN S2-P2-2, S2-P2-1 | 323 / 307 / 307; redo 683 / 685 / 498 |

**Undo memory** (2,000 objects, JS heap after forced GC; n=3)

| Step | Heap | Whole Chrome | Verdict |
|---|---|---|---|
| After Open | 29.1 MB | 1.36 GB | — |
| After 50 one-object nudges | 32.2 MB (+62 KB a step) | 1.47 GB | Pass |
| After 50 all-object nudges | 63.0 MB (+0.68 MB a step) | 1.64–1.69 GB | Pass; each nudge ≤ 81–102 ms |
| After 50 Undos | 62.6 MB (the steps move to Redo) | — | Pass |

**Recovery on start-up** (open, nudge, wait for the autosave, close the page; load the app again in the same profile)

| Input | Offer shown after load | Start-up block | Restore → shown | Verdict | Trend (offer; restore) |
|---|---|---|---|---|---|
| 2,000 objects | 3.48 s (3.50) | 100–104 ms | 210 ms (217) | Pass | 3.48 / 3.48 / 3.48 s; 210 / 212 / 197 ms (n=3) |
| 10,000 (n=3) | 3.62 s (3.63) | 178–184 ms | 882 ms (1,058); frames ≤ 833 ms | Restore response as Open | — |
| 2,004 with four photos | **no offer (0 of 4)**: no autosave existed 50 s after the edit (page closed without `beforeunload`, as after a crash) | — | — | **S3-P2-2** | — |

### Measurement method

Harness: `scratchpad\zz-s3\`. Entry points: `runset.sh` (one set: waits for other sessions' tooling to finish, logs machine state and tooling command lines, refuses under 1 GB free, runs `run.mjs`), `batch-a.sh` … `batch-d.sh` (the sets as run), `analyze.mjs` (median and worst without run 0), `map-profile.cjs` (S1's CPU-profile mapper), `zz-s3-probe-imgautosave.mjs` (autosave and memory timeline), `zz-s3-deser.mjs` (Node timing of Open's parse routes).

1. **Build and serve.** `node node_modules/vite/bin/vite.js build --config zz-s3-vite.config.ts --outDir <zz-s3>/dist-main --emptyOutDir --sourcemap hidden`, run in `j7-main` with the config copied back to its root. `node host.mjs <dist> <port>` serves the bundle with `_headers`' COOP, COEP and CSP, and the harness's inputs at `/__zz__/<name>` from `projects\` and `fixtures\` (same origin, so no Playwright route carries large bodies). Ports: 4801 main, 4803 1.0.28, 4804 1.0.23.
2. **Browser.** Playwright 1.61.1, installed Chrome 156, headless, 1440 × 900, service workers blocked, `--enable-precise-memory-info`, background throttling off, clipboard permissions granted. A fresh browser context (empty IndexedDB and history) for every run.
3. **Inputs.**
   - Projects: `gen.mjs` + `gen-entry.ts` (S2's generator; adds embedded fonts and text objects) write each tree's own `.lf2`: `mix-N` (N objects on a grid, even = Line circle of 32 points, odd = Fill rectangle). `font-2000` = `mix-2000` plus 40 text objects naming four of the app's bundled TTFs as embedded fonts (stored glyph paths are a stand-in box). Photo projects: `run.mjs` op `mkimg` opens `mix-2000` (or `mix-200`), imports four (or one) 4000 × 3000 JPEGs made in the page, and saves through a captured picker, in each build; the app places each photo at 400 × 300 mm, 10 lines/mm.
   - Imports: `mk-fixtures.mjs` writes the SVGs (the benchmark's 50,000-path SVG exactly, and its first 1,000 paths), the DXFs (block `B1` = circle, four lines, arc; block `B2` = three INSERTs of `B1`; plus LINEs and LWPOLYLINEs), uncompressed one-page PDFs of 500 and 20,000 rectangle-plus-Bezier paths, `ai-big.ai` (that PDF with an Illustrator header), `.lbrn2` files of 200 and 2,000 Rect / Ellipse / Path shapes, and uncompressed 16-bit two-page TIFFs. PNG and JPEG photos (gradients plus seeded noise) and the 4096 × 4096 benchmark PNG are encoded in the page.
4. **Operations** (`run.mjs`): file pickers are replaced in the page (`page-init.js`): the open picker hands back the named file, and both the save picker and the opened file's handle capture writes. Open = the toolbar's **Open...**; Import = **Import...**, then **Import page** for PDF, AI and TIFF; Save = nudge one object (arrow key), then Ctrl+S; Paste = Ctrl+A, Ctrl+C, Ctrl+V; Undo and Redo = Ctrl+Z and Ctrl+Shift+Z, pressed up to three times when an import leaves more than one step. The autosave and recovery runs wait for the app's own 30 s interval; nothing shortens it.
5. **What is measured** (`page-init.js`): input timestamp (the click's or key's `timeStamp`) → the first animation frame whose status bar shows the expected `Objects:` count; long tasks (PerformanceObserver, flushed at the end of each window, then a 1.5 s quiet wait); rAF frame intervals; timestamps of workers created and terminated, IndexedDB puts, large `localStorage` writes and save-picker writes. "Settled" is the later of "shown" and the end of the last long task after the input. Memory: `mem-poll.ps1` sums private bytes of the measuring Chrome's process tree every ~250 ms.
6. **Attribution.** CPU profiles (CDP, 200 µs sampling, run 1 of 2 in separate `P-` sets) mapped through the hidden source maps. The Open worker's parse was timed in Node on the same bundle source (`zz-s3-deser.mjs`, with a CPU profile).

**Re-running the key repros** (from `zz-s3`, hosts first):

- Fixtures: `node mk-fixtures.mjs`; projects: `node gen.mjs ../j7-main projects/main-mix-2000.lf2 '{"scene":"mix","n":2000}'`; photo projects: `node run.mjs '{"base":"http://127.0.0.1:4801/","label":"mk","op":"mkimg","file":"main-mix-2000.lf2","n":2000,"images":4,"outFile":"main-img-2000.lf2","runs":1}'` (`"images":1` and `main-mix-200.lf2` for the one-photo project).
- S3-P2-1: `./runset.sh '{"base":"http://127.0.0.1:4801/","label":"X1","op":"import","file":"photo.jpg","make":{"fn":"makePhoto","args":["photo.jpg",4000,3000,"image/jpeg",0.9]}}'`; with `"runs":2,"profile":true,"noUndo":true`, then `node map-profile.cjs prof-X1-import-r1.json dist-main 20`.
- S3-P2-2 and S3-P2-3: `node zz-s3-probe-imgautosave.mjs http://127.0.0.1:4801/ main-img-2000.lf2 2004 260` (single edit; the log has worker, terminate and storage events and the memory line every 2 s). Add a fifth argument `60` to edit every 60 s.
- S3-P3-1: `node zz-s3-deser.mjs projects/main-img-2000.lf2`.
- Summaries: `node analyze.mjs results.jsonl '^(TM|T28|T23|R|D)-'`.

### Refuter method (2026-11-03, afternoon +0800)

- **Tree:** origin/main @ `1405bc777`. `git diff df2279e26 origin/main` touches none of the cited files (it changes only the Fill-pool files, `draw-scene.ts`, `preview-projection.ts` and the 1.0.29 fixtures). The auditor's `zz-s3\dist-main` bundle was reused as the build under test. Everything else is the refuter's own, in `scratchpad\zz-s3r\` (deleted afterwards):
  - `host.mjs`: static host on port 4821 with COOP and COEP, without the CSP;
  - `poll.ps1`: private bytes from `Win32_Process.PrivatePageCount`, plus free physical memory;
  - `init.js`: worker create and terminate, IndexedDB and `localStorage` writes, autosave text, pickers, a page-made JPEG;
  - `probe.mjs`: fixtures, autosave and memory watch, close with `beforeunload`, a watchdog that ends a set below a free-memory floor;
  - `imp.mjs`: Import long tasks, plus a CPU profile mapped with `source-map-js`;
  - `pause.mjs`: the autosave pause;
  - `luma-bench.mjs`: Node timing of the luma builder.
- **Fixtures (own):**
  - `r-img1-bed.lf2`: `main-mix-200` plus one 4000 × 3000 JPEG, placed by the app at 400 × 300 mm, 10 lines/mm (23.9 MB);
  - `r-img1-100.lf2`: one 3000 × 3000 JPEG with its bounds set to 100 × 100 mm in the saved JSON (18.0 MB);
  - `r-img4-bed.lf2`: `main-mix-2000` plus four bed-sized JPEGs (97.4 MB).
- **Machine state:** i7-1260P, 16 GB, Chrome 156 headless (Playwright 1.61), Node 25.8.2.
  - Before each set: 4.0–5.8 GB free physical memory, CPU 0–39%; commit 22.6 of 44.1 GB (page file 26 GB).
  - Running alongside: the owner's Chrome (9 processes), the Claude desktop app, OneDrive and ChatGPT. No other session's `node`, `vitest`, `tsc`, `eslint` or `vite` ran; my host was the only `node` server, and ports 4811–4814 were not in use.
  - No calibration loop was run, so the refuter's times are single-sitting checks, not scorecard rows.
- **Memory caution:** a free-memory watchdog (1.0 GB, lowered to 0.5 GB and then 0.4 GB for the photo sets) ended the four-photo set at 73 s after the edit, when free memory had fallen to 27 MB. That set was not repeated.
- **Process hygiene:** the 192 MB heap-cap run hung and was stopped by PID (its `node`, poller and Chrome). Every process the refuter started was stopped and checked absent at the end.
- **Spot-check of one clean claim:** autosave pause at 2,000 objects, four runs with the mouse moving. **No long task, and the longest frame within ±1.5 s of the write was 17–18 ms.** The autosave worker lived 100–120 ms. The claim holds.

## Findings

### S3-P2-1 — Importing a photo decodes it and builds its luma string on the UI thread: a 12 MP JPEG freezes the window 1.06–1.10 s, the 4096 × 4096 PNG 1.30 s, a 9 MP TIFF page 0.85–0.91 s, with no progress or Cancel

- **Where:**
  - `src/ui/commands/import-image-action.ts:49` → `src/ui/import/prepare-image-samples.ts:59-66` (`loadImageSamples`): every JPEG, and every PNG under `PAGED_PNG_MIN_BYTES` (25 MiB, `qualified-png-raster.ts:51`) that the canvas can decode, takes the in-window path.
  - `src/ui/trace/image-loader.ts:88` (`decodeImageAsRawData`) → `:228` (`rasterizeImage`: canvas `drawImage` and `getImageData` of the whole image) → `:257` (`compositeRgbOverWhitePreservingAlpha`, a second full RGBA copy) → `:369` (`extractLumaBase64`), which builds the base64 input with `bin += String.fromCharCode(v)` for every pixel (12 million appends for a phone photo) and then `btoa`.
  - TIFF: the worker decodes the page (`tiff-artwork-source.ts:68-80`), then `page-artwork-object.ts:44,72` re-encodes it to PNG with `canvas.toBlob` and hands it to `importImageFile`, which decodes it again through the same path.
- **Anchor:** AREAS budget, longest UI block while designing 200 ms, "or a progress bar and Cancel if the work can take longer". ADR-357 Amendment 2 moved Multi-File Trace's TIFF and Netpbm decoding into the import worker (J6-P2-3), but the single-file Import route was not part of it.
- **Scenario:** a user imports a photo straight from a phone (4000 × 3000 JPEG) to engrave it. The window, Abort included, is frozen for over a second; nothing says it is working.
- **Evidence:** **REPRO** (main, production bundle, idle machine).
  - `TM-imp-jpeg12`: block **1,063–1,098 ms**, shown 1,214 ms (worst 1,249). `TM-imp-png4096`: block **1,300–1,310 ms**. `TM-imp-tiffbig` (3000 × 3000, 16-bit): block **845–907 ms** after Import page. A 1.5 MP PNG: 118–136 ms (passes).
  - Profile (`prof-P-jpeg-import-r1.json`, the 1.87 s block on a loaded machine): `loadImageSamples` 576 ms inclusive, of which `extractLumaBase64` 491 ms (470 ms self) and `rasterizeImage` 325 ms (`getImageData` 172 ms, `compositeRgbOverWhitePreservingAlpha` 131 ms); **garbage collection 997 ms**, most of it from the 12 million one-character string appends. The PNG and TIFF profiles show the same functions (`prof-P-png4096-import-r1.json`, `prof-P-tiffbig-import-r1.json`).
  - **Trend:** JPEG 1,063 / 1,074 / 1,051 ms block, PNG 1,300 / 1,319 / 1,294, TIFF 845 / 860 / 859 (main / 1.0.28 / 1.0.23). `extractLumaBase64` is byte-identical in 1.0.23. Not a regression.
- **Severity:** **P2.** An ordinary operation (a phone photo is the commonest import for engraving) blocks 5.3–5.5 times the 200 ms budget with no progress or Cancel. It is not a 5 s freeze, so not P2 on that ground.
- **Refuter:** **CONFIRMED, P2 kept.** It would be false if the JPEG went to a worker, or if the block were mostly decoding that cannot move. Checked with the refuter's own driver (`zz-s3r\imp.mjs`, a different page-made 4000 × 3000 JPEG, own long-task observer):
  - Unprofiled runs 2–6 on idle main: longest task **785–861 ms** (median 833 ms); shown 1,038–1,109 ms. That is about 20% below the auditor's 1,063–1,098 ms, probably because the test image differs, and still **4.2 times** the budget.
  - Profile (250 µs sampling, mapped through the hidden maps): `prepare-image-samples.ts:37` 281 ms inclusive; `image-loader.ts:369` (`extractLumaBase64`) 230 ms inclusive; `image-loader.ts:228` (`rasterizeImage`) 163 ms, of which `getImageData` 104 ms; `:257` composite 58 ms; **garbage collection 433 ms**. The hot spots are the ones the auditor names.
  - Node, second line of evidence (`zz-s3r\luma-bench.mjs`, function bodies copied from main): `extractLumaBase64` takes 706–802 ms on 12 MP and 1.0 s on 4096², while a chunked `String.fromCharCode.apply` gives **byte-identical** base64 in 164–180 ms. The fix direction holds.
  - The 4096² PNG and TIFF rows were not re-measured in the browser.
- **Fix direction** (no change to the luma bytes, so compiled G-code stays byte-identical; prove it with a hash of `lumaBase64` and of the G-code on the fixture set):
  - build the base64 from the luma bytes in chunks (`String.fromCharCode.apply` on subarrays of a few KB, or `Uint8Array.prototype.toBase64` where available); this alone removes most of the GC;
  - move decode, composite and luma into a worker (`createImageBitmap` and `OffscreenCanvas` are available there; the qualified-PNG worker already exists), with the import's existing progress and Cancel (`createPngImportControls`);
  - for TIFF, send the worker's RGBA straight to the luma step instead of PNG-encoding and decoding it again on the UI thread.

### S3-P2-2 — In a project with photos, autosave waits behind the background job preparation: the first autosave after an edit lands up to two minutes later, the app blames browser storage, and a crash in that window leaves nothing to recover

- **Where:**
  - `src/ui/worker-memory-lane.ts:15-60`: one FIFO lane serialises all worker heaps; only `'interactive'` reservations preempt.
  - `src/ui/workspace/preparation-worker-client.ts:387-396`: the job preparation reserves the lane as background work, preemptible only by interactive work.
  - `src/ui/state/autosave-preparation-client.ts:44-57`: autosave reserves the same lane **without a priority**, so it queues behind a running preparation; after 60 s it gives up (`'Autosave preparation timed out after 60 seconds.'`), and `use-autosave.ts:39-40` shows `AUTOSAVE_FAILURE_MESSAGE` ("…image-heavy projects can exceed browser storage").
  - `src/ui/state/autosave-loop.ts:101` (`if (inFlight) return;`): ticks that fall while the reservation waits are skipped.
- **Anchor:** ADR-288 Amendment 1 (DECISIONS.md:16631-16636): "Recovery keeps its normal interval but waits for an active preparation" — a deliberate choice, measured then on vector scenes. AREAS P1/P2 lines on lost work; the autosave contract is a recovery slot at most 30 s old.
- **Scenario:** a user opens (or builds) a project with photos placed at bed size, makes an edit, and then pauses — reads, checks settings, walks away. The preparation worker for the photos runs for about two minutes; the autosave queues behind it.
- **Evidence:** **REPRO** (probes on main, idle machine; event and memory logs in `logs\probe-*.log`).
  - Four photos, one edit (`probe-img4-single.log`, page-clock times; the edit fell at 15.7–17.7 s): preparation worker started 27.2 s; the 30 s tick queued; warning toast at about 91 s; preparation ended **139.7 s**; autosave worker 139.7 s; first IndexedDB write **142.1 s**, **about 125 s after the edit**. An earlier run (discarded for the host gap) gave the same shape: no autosave in 177 s.
  - `M-autosave-img2000`: no write within the 45 s window in 3 of 3 runs. `M-recover-img2000`: page closed 50 s after the edit, reopened: **no recovery offer in 4 of 4 runs**; the session's only copy of the edit was lost (the opened file still holds the pre-edit state).
  - One photo, 200 objects (`probe-img1-single.log`): preparation 12.6 → 38.2 s; autosave written at 38.6 s, about 30 s after the edit. Within the contract, barely.
  - With an edit every 60 s on the four-photo project (`probe-img4-edit60.log`) each edit cancels the preparation and the queued autosave then writes at once, but that write carries the snapshot taken at the earlier tick, so the newest edit always waits for the next one.
  - **Trend:** `worker-memory-lane.ts` is identical in 1.0.23 and the 60 s timeout is the same, so not a regression (READ; the probe was not run on the releases).
- **Severity:** **P2.** No crash was seen, so it is not P1 on evidence. But the recovery window grows from 30 s to the preparation's length (two minutes here), and the warning sends the user after storage, not the real cause. The coordinator may weigh it as P1 together with S3-P2-3: the same preparation drives memory to 9.5 GB, the condition under which a crash is most likely, and that is exactly when no recent autosave exists.
- **Refuter:** **CONFIRMED (mechanism and delay), scenario corrected, P2 kept.** It would be false if autosave preempted the preparation, if another net saved the edit, or if the delay only appeared at sizes nobody uses.
  - **Code** (main, unchanged since `df2279e26`): `autosave-preparation-client.ts:51` reserves with no options, so the request is not `'interactive'`. `worker-memory-lane.ts` preempts only for `'interactive'` work, and the preparation passes only `onPreempt` (`preparation-worker-client.ts:387-396`). The behaviour is deliberate, not drift. Two anchors should be added: **ADR-598 decision 2** ("Non-preemptible work, including an active autosave, finishes normally"; only Save and trace-part are interactive) and **ADR-598 Amendment 1**, which sets the 60 s deadline including lane wait and reports expiry "through the existing autosave failure path". That path is the `'storage-error'` → `AUTOSAVE_FAILURE_MESSAGE` toast (`src/ui/app/use-autosave.ts:38-39`), so the storage wording is real.
  - **Own probe** (`zz-s3r\probe.mjs`: own host, init script and memory poller):
    - **100 × 100 mm photo** (3000 × 3000 JPEG, 200 objects): preparation 2.8 s; autosave on the normal tick, 21.5 s after the edit.
    - **One bed-sized photo** (4000 × 3000 at 400 × 300 mm, 10 lines/mm): preparation 19.0 s and 21.0 s; first write 21.6 s and 23.6 s after the edit. The unsaved window is the larger of the interval and the preparation plus about 2 s, so it stays **at or under 30 s**.
    - **Four bed-sized photos** (2,004 objects): **no write 73 s after the edit**. The preparation was still running when my memory watchdog ended the set (see S3-P2-3). The auditor's raw `probe-img4-single.log` shows the toast at 92.9 s and the first write at 142 s. So the window grows past 30 s only when the preparation runs longer than the 30 s interval, about two or more bed-sized photos.
  - **Close is not silent.** The auditor's `recover` op ends with `page.close()`, which skips `beforeunload`, so it simulates a crash.
    - Browser: with `page.close({runBeforeUnload: true})` 8 s after an edit, the **`beforeunload` dialog fired** (`installUnsavedChangesGuard`, `use-unsaved-changes-guard.ts:35-51`). It fires whenever the project is dirty.
    - The unload path's synchronous `localStorage` write cannot hold an 18 MB project, so after "Leave" there was no offer. The user was warned first.
    - Desktop (READ): close asks **Save, Don't Save or Cancel** with "Changes you don't save may be lost" (`electron/desktop-window-close.ts:77-83`, ADR-549). A renderer crash offers Reload (ADR-482, `electron/renderer-crash-recovery.ts`), and recovery then restores the last autosave.
  - **Decision: not P1.** Losing about 2 minutes on a crash needs a crash, kill or power cut inside the window, and no crash was caused or seen in either session (S3-P2-3).
    - Every project already carries a 30 s crash window, and these projects' window grows only with multi-photo, bed-sized burns.
    - From about 90 s the app does warn: "Save the .lf2 file manually". The stated cause is wrong but the advice is right.
    - The finding fits P2: a broken 30 s recovery contract with a misleading message. It becomes P1 only if S3-P2-3 is shown to crash.
- **Fix direction** (no output change):
  - reserve the autosave as `'interactive'` (it then preempts the preparation through its existing `onPreempt`, which requeues), or give the autosave its own small lane when the project's estimated serialised size is far below the cage limit; ADR-288 Amendment 1 needs an amendment either way;
  - report a timed-out preparation as "Autosave is waiting for job preparation" rather than a storage failure;
  - take the snapshot when the reservation is granted, not at the tick, so a write after a wait carries the newest edit.

### S3-P2-3 — After Open or an edit of a project with bed-sized photos the renderer climbs to 3.3 GB with one photo and 8–9.5 GB with four, against 1.5 GB for the whole app; a Save during it peaks at 4.1–4.5 GB

- **Where:** the background job preparation (`src/ui/workspace/preparation-worker.ts`, ADR-244: compile, optimise, toolpath and estimate of the whole job in one worker) started by `preparation-worker-client.ts` on Open and on every edit. For four 400 × 300 mm photos at 10 lines/mm (48 million dots) it runs 112–164 s. **S4 owns the compile**; this finding is about what it does to Open, Save and autosave memory.
- **Anchor:** AREAS budget: peak memory on a 2,000-object project 1.5 GB for the whole app ("the maintainer's own PC is short of memory"). AREAS P1 names an out-of-memory on Save, autosave or Open.
- **Scenario:** as S3-P2-2. Four photos is a batch of photo engravings; one bed-sized photo is a single large engraving.
- **Evidence:** **REPRO** for the peaks; the attribution to the preparation worker is by timing.
  - `probe-img4-single.log` (renderer / total): 2.3 / 3.1 GB at 20 s, rising from about 80 s to **9.5 / 10.2 GB at 139.3 s**; the preparation worker ended at 139.65 s (page clock), and at 141.3 s the renderer was 2.4 GB (−7.1 GB). It settled at 0.56 / 1.33 GB once the autosave had run. Repeat (`probe-workermem-img4.log`): peak **7.7 / 8.3 GB** at 122 s, back to 1.33 GB by 152 s.
  - One photo, 200 objects (`probe-img1-single.log`): peak **3.3 / 3.9 GB** during the 26 s preparation, settling at 0.47 / 1.05 GB.
  - Save during the preparation (`R-save-img2000`, `TM-save-img2000`): peak **4.1–4.5 GB** (renderer 3.3–3.7 GB), Save's own block 401–459 ms. Open alone peaks at 2.8–3.0 GB (`R-open-img2000`).
  - Free memory on this 16 GB PC was 3.8–4.7 GB during these runs; no crash and no "Aw, Snap" occurred.
  - **Trend:** Save during the preparation peaks at 4.1 / 4.3 / 4.3 GB (main / 1.0.28 / 1.0.23, n=3), so the preparation's memory is not new.
- **Severity:** **P2** (an ordinary operation over three times its budget: 3.3 GB with one photo is 2.2 times, 9.5 GB with four is 6.3 times; no crash observed). On a PC with less free memory this is where an out-of-memory would come from; the refuter or S9 should try it under a memory limit.
- **Refuter:** **CONFIRMED, P2 kept (not raised: no crash shown).** It would be false if the peak were the page, another Chrome, or a poller artefact, or if it vanished at ordinary photo sizes. I re-measured with my own poller (`Win32_Process.PrivatePageCount` of the marked Chrome tree, plus the PC's free physical memory).
  - **One bed-sized photo** (three runs): renderer peak **3.38, 4.20 and 2.89 GB**; whole Chrome 3.65, 4.48 and 3.17 GB. Free physical memory on this 16 GB PC fell from 3.9 GB to **0.51–0.76 GB** in two runs, most of it in the last 4 s of the preparation. In the third run, which started with 5.1 GB free, it fell to 2.34 GB.
  - **Four bed-sized photos:** renderer 5.08 GB and still rising 73 s after the edit. Free memory fell to **27 MB** and my watchdog ended the set. I did not repeat this to the 9.5 GB peak.
  - **100 × 100 mm photo:** renderer 1.27–1.29 GB, Chrome **1.61–1.64 GB**. That is about 1.1 times the budget; a fresh app is about 1.0 GB. The finding is about bed-sized photos.
  - **Page against worker:** `performance.measureUserAgentSpecificMemory()` puts the page's own JS at 72–86 MB. It could not attribute the preparation worker, because it resolved only after the worker ended.
  - With `--js-flags=--max-old-space-size=1024`, the one-photo preparation still finished, wrote its autosave, and still took the renderer to 2.89 GB. So at least about 1.9 GB lives outside the V8 heaps (typed arrays or native memory), and a V8-heap out-of-memory is not the likely failure at one photo. With a 192 MB cap the page itself hung, so the flag does take effect.
  - **Crash risk:** commit was 22.6 of 44.1 GB with a 26 GB page file, so allocation does not fail on this PC; it pages instead. No crash or "Aw, Snap" in my runs or the auditor's. A crash on a smaller PC is plausible but not shown, so P1 is not reached on evidence.
  - The Save-during-preparation peak (4.1–4.5 GB) and the 7 GB fall after the worker ends were not re-measured, to protect the shared PC.
- **Fix direction** (S4; a speed or memory fix must keep the G-code byte-identical): find what the preparation keeps alive for raster jobs (the whole emitted program, the timeline and the render model at once is the likely shape; S1-P2-2 and S4 profile the same stages) and stream or drop it; or prepare only what the canvas needs (the estimate) until the user asks for Preview. Until then, bound it: refuse to start a background preparation whose estimated output exceeds a size, and say so.

### S3-P3-1 — A project file of 25 MiB or more is read by a character-at-a-time JSON tokenizer: the 90 MB photo project opens in 8.4–8.8 s, where `JSON.parse` needs 0.09 s

- **Where:** `src/ui/import/document-import-source.ts:27-49`: projects of at least `PROJECT_NATIVE_JSON_PARSE_MAX_BYTES` (25 MiB) go through `readJsonValueFromBlob` instead of `deserializeProject(text)`. `src/io/json/json-tokenizer.ts:39-47` (`write` loops one character at a time), `:66-77` (`consumeString`), `:168-173` (`appendString`: `stringBuffer += value` per character) and `:175` (`finishString`). Base64 photo data is almost all of such a file, so almost every byte takes this path.
- **Anchor:** AREAS budget, 2,000-object project Open 5 s. The 25 MiB switch is a "parser-selection tradeoff" (the comment above it), not a schema rule.
- **Scenario:** opening any project that holds a few photos (four 12 MP photos make 90 MB).
- **Evidence:** **REPRO.**
  - In the app (`R-open-img2000`): shown **8,419 ms** (worst 8,767); the UI stays responsive (longest task 216–219 ms). Under the fix session's load it took 11.4–13.3 s.
  - In Node, same source (`zz-s3-deser.mjs`): `readJsonValueFromBlob` **7.6–7.7 s** + `deserializeProjectValue` 0.7 s, against `deserializeProject(text)` 0.75–0.79 s and `JSON.parse` 0.08–0.09 s. CPU profile: garbage collection 7.9 s, `finishString` 4.9 s self, `write` 1.2 s, `consumeString` 0.7 s.
  - **Trend:** 8.6 / 8.8 / 8.8 s (n=3); the tokenizer is byte-identical in 1.0.23. Not a regression.
- **Severity:** **P3.** 1.7 times the Open budget, with the window responsive and a large file. It also stretches the time before a photo project can be edited or saved.
- **Refuter:** **CONFIRMED, P3 kept.** It would be false if large projects bypassed the tokenizer. READ: `document-import-source.ts:27-49` sends any project of 25 MiB or more to `readJsonValueFromBlob`, and `json-tokenizer.ts` `write` / `consumeString` / `appendString` handle it one character at a time (unchanged on main). REPRO: my own 97 MB four-photo project (2,004 objects) opened in **7.47 s** from the Open click to the count (one run, 100 ms poll). That is 1.5 times the 5 s budget.
- **Fix direction:** in the tokenizer, find the closing quote of a string with `indexOf` inside the current chunk and append the slice (not one character); or raise the switch to the size where a single string is actually at risk (V8's limit is about 512 M characters) and use `JSON.parse` below it. Output and validation are unchanged.

### S3-P3-2 — Large vector results block the UI 0.55–0.86 s when they arrive: 50,000 SVG paths, 20,000 PDF paths and a 10,000-object Open

- **Where:**
  - `src/ui/import/document-import-worker-client.ts:155` (`handleMessage`): the parsed result is structured-cloned onto the UI thread (366 ms self for the SVG, 277 ms for the 10,000-object Open, 201 ms for the PDF).
  - The first paint: `artwork-sprite-cache.ts:201` (`render`, 286 ms for the SVG's sprite) and, for the PDF, display flattening of its curves on the UI thread (`display-polylines.ts:92` → `curve-flatten.ts:60`, `flattenCubicChords`, 194 ms).
  - The PDF page is turned into paths on the UI thread (`src/ui/import/pdf-artwork-source.ts:33` → `src/io/pdf/pdf-vector-page.ts:17`, `pdfVectorPage`, 123 ms).
  - The idle canvas-motion worker's start packs the project on the UI thread (`idle-canvas-motion-worker-client.ts:116` → `packed-project-transfer.ts:101`, 89–119 ms).
- **Anchor:** AREAS budget, longest UI block while designing 200 ms. ADR-269 and its amendments (imports parse in workers); ADR-598.
- **Scenario:** importing the 50,000-path benchmark trace or a dense PDF drawing; opening a 10,000-object project.
- **Evidence:** **REPRO.** Blocks: SVG 50k **801–863 ms**, PDF 20k **578–667 ms**, AI 456–459 ms, Open 10,000 **550–683 ms**; DXF 2,000 nested INSERTs 237–246 ms. Profiles `prof-P-svg50k-import-r1.json`, `prof-P-pdfbig-import-r1.json`, `prof-P-open10k-open-r1.json`. **Trend:** the same in 1.0.28 and 1.0.23 (SVG 801 / 763 / 752, PDF 578 / 543 / 547, Open 550 / 540 / 528 ms).
- **Severity:** **P3.** Large inputs, 2.3–4.3 times the block budget, not a regression.
- **Refuter:** **CONFIRMED, P3 kept.** I imported the benchmark 50,000-path SVG with my own driver, five unprofiled runs. The longest task was **560–583 ms**, lower than the auditor's 801–863 ms but still 2.8–2.9 times the budget, and only for a large input. PDF, AI and the 10,000-object Open were not re-measured.
- **Fix direction:** send the parse result as packed geometry with transferred buffers (`packed-project-transfer.ts` already does this for preparation); pre-flatten display polylines in the import worker; run `pdfVectorPage` in the PDF worker. No output change.

## KNOWN re-observed

- **S2-P3-1** (job estimate on the UI thread after an edit of a small Fill design). Also fires after **Open** and **Import**: 235–242 ms after opening the 200-object project (`prof-P-open200-open-r1.json`: `recomputeEstimate`, `use-job-estimate.ts:351`, 502 ms inclusive over the profile), 269–284 ms after opening the 200-shape `.lbrn2`. Not re-raised.
- **S2-P2-2** (hover pulse on every same-settings piece). The 262–292 ms block after pasting 2,000 objects is the pulse (`prof-P-paste2000-paste-r1.json`: `tick` 308 ms inclusive; the paste itself, `pasteClipboard`, 68 ms), because the pointer rests on the pasted artwork.
- **S2-P2-1** (1.5 px strokes, GPU-bound frames). Redo of a 2,000-object paste shows the result 683–857 ms after the key (1.0.23: 498–534 ms); the main-thread part is 141–161 ms.
- **21-P3-7** (`.lbdev` quadratic regex on the UI thread): unchanged (`src/io/lightburn/lbdev-import.ts:279-287`, READ). Only a crafted file triggers it; it stays with its earlier rating and is not a new SECURITY item.
- **J10-P3-3 and #1488** (compact saves): holds. Main's files are 3.8–3.9 times smaller than 1.0.23's (2,000 objects 3.26 against 12.5 MB; 10,000 objects 16.1 against 62.5 MB), and Save at 10,000 objects is 1.5 times faster with its 204–222 ms block gone.

## Refuted

- **"Closing the page 50 s after an edit of a photo project loses the edit with no warning"** (refuter, sub-claim of S3-P2-2). The harness closed the page with Playwright's `page.close()`, which skips `beforeunload`, so the run simulated a crash. With `runBeforeUnload` the browser's leave prompt fired, because `installUnsavedChangesGuard` prompts whenever the project is dirty. On desktop, close asks Save, Don't Save or Cancel (ADR-549). The edit is lost without warning only on a crash, kill or power cut, and S3-P2-2 keeps that scenario.
- **"Opening the photo project takes 11–13 s."** Measured while a fix session ran `vitest` and `tsc`; on an idle machine it is 8.4–8.8 s (S3-P3-1).
- **"Recovery blocks start-up 355–441 ms at 10,000 objects."** Also measured under that load; idle, 178–184 ms, inside the budget.
- **"With photos, autosave never writes while the user keeps editing."** With an edit every 60 s, every edit cancels the preparation and the waiting autosave then writes (`probe-img4-edit60.log`). It is late, and one edit behind (S3-P2-2), but not starved.
- **"Every process memory figure from 07:41 to 08:52 is the app's."** The first poller matched any Playwright Chrome; another session's browser was running. Those columns are not used; from 08:52 only the measuring Chrome is counted.
- **"Open's 12 s is `deserializeProject`."** It takes 0.75 s in Node on the same file; the time is the streamed reader that runs before it (S3-P3-1).

## Verified clean

- **Save at every size** (worker, ADR-204 Amendment 2): 200 objects 77 ms, 2,000 objects 240 ms, 10,000 objects 1.0 s, with fonts 291 ms; no main-thread task over 68 ms.
- **The autosave pause** at 200, 2,000 and 10,000 objects: no long task and no frame over 35 ms while the tick serialises, validates and commits in its worker.
- **Undo memory:** history keeps whole `Project` values but shares unchanged objects. 50 one-object edits on 2,000 objects add 3.1 MB of heap (62 KB a step); 50 all-object edits add 34 MB (0.68 MB a step). Each all-object nudge is ≤ 102 ms.
- **Undo and Redo after imports** respond in 23–196 ms (pass at ordinary sizes); the 2,000-object paste's Redo is KNOWN S2-P2-1.
- **Open at 2,000 objects** (325 ms) and **with four embedded fonts** (337 ms); `.lbrn2` at 2,000 shapes (334 ms).
- **Ordinary imports:** SVG 1,000 paths, DXF with nested blocks, PDF 500 paths, 1.5 MP PNG, 16-bit two-page TIFF 1600 × 1200 (190 ms after Import page): all shown in 128–239 ms with blocks ≤ 154 ms.
- **Paste of 200 objects:** 65 ms, no long task.
- **Recovery:** the offer appears 3.5–3.6 s after load at 2,000 and 10,000 objects (the same in 1.0.28 and 1.0.23); Restore shows 2,000 objects in 210 ms.
- **J6-P2-3:** Multi-File Trace's TIFF and Netpbm decoding now runs in the import worker (`src/ui/import/batch-raster-pixels.ts:1-5`, ADR-357 Amendment 2). READ only.

## Not verified

- **The packaged desktop app.** Every number is Chrome 156 in a browser build.
- **EPS** (not an Import format: `import-dispatch.ts:21-37`) and **Netpbm** (only through Pro Multi-File Trace, which the browser's Free edition cannot run).
- **`.lbrn`** (the older LightBurn extension): it uses the same parser as `.lbrn2` (`project-open-parser.ts:35`), but only `.lbrn2` files were timed.
- **Photos placed smaller than the bed.** The app placed each 12 MP photo at 400 × 300 mm; S3-P2-2 and S3-P2-3 scale with the photo's burn size, so a 100 mm photo would be much milder. Not measured.
- **What the preparation keeps in memory** (S3-P2-3): no worker heap snapshot was taken (CDP did not attach to the app's module workers).
- **S3-P2-2 and S3-P2-3 on 1.0.28 and 1.0.23** were not probed; READ only (same lane, same timeout).
- **The fonts row** uses stand-in glyph paths; the text is not re-shaped on Open, so a project with many real text objects may cost more.
- **The first Undo after a DXF or 4096 × 4096 PNG import changes no object count**; a second Undo removes the object. Two undo steps per import, seen in every run on all three builds. Not a speed issue; noted for the refuter.

## Ranked list — what an ordinary user meets, by how often

1. **Importing a phone photo** (S3-P2-1): a 1.1 s freeze on every JPEG import; 1.3 s for a large PNG.
2. **The estimate block after opening or importing a small Fill design** (KNOWN S2-P3-1): 0.24–0.28 s on every Open.
3. **Working with photos placed at bed size** (S3-P2-2, S3-P2-3): autosave late by up to two minutes after an edit, a misleading storage warning, and 3–9.5 GB of memory while the job is prepared.
4. **Opening a project with a few photos** (S3-P3-1): 8.4 s for 90 MB.
5. **Large vector imports and very large projects** (S3-P3-2): 0.55–0.86 s blocks.

## Guard proposal

Counts and ratios, not milliseconds:

1. **Luma builder** (unit): `extractLumaBase64` on a 4000 × 3000 buffer must make O(chunks) string operations, not O(pixels); and the JPEG import path must not call `getImageData` on the window realm (spy). Byte-equality of `lumaBase64` with today's output on three fixtures.
2. **Streamed reader ratio** (unit, Node): `readJsonValueFromBlob` on a 30 MB fixture with one long base64 string must be within 5× of `JSON.parse` on the same text (today about 85×).
3. **Lane priority** (unit, fake timers): with a background preparation holding the lane, an autosave reservation must be granted within one preemption, not after the preparation ends.
4. **Memory ceiling** (nightly, this harness): open the one-photo project, nudge, and fail if the measuring Chrome's private memory passes 2 GB before the autosave has written.

```json
{
  "area": "S3-save-open-import",
  "tree": "df2279e26",
  "counts": { "raised": 5, "refuted": 0, "P1": 0, "P2": 3, "P3": 2, "known": 5 },
  "refuter": { "tree": "1405bc777", "confirmed": 5, "plausible": 0, "refuted": 0, "severity_changes": [], "refuted_subclaims": ["S3-P2-2: 'closing the page loses the edit with no warning' - harness skipped beforeunload; a real close prompts (browser leave dialog, desktop Save/Don't Save/Cancel)"] },
  "budgets": { "response_ms": 100, "design_block_ms": 200, "autosave_pause_ms": 50, "open_2000_s": 5, "memory_2000_gb": 1.5, "ordinary_size_result": "Save, autosave and Undo clean at all sizes; Open 2,000 in 325 ms; 200-object Open has the known 235-242 ms estimate block; a 12 MP JPEG import blocks 1.06-1.10 s (S3-P2-1)" },
  "findings": [
    { "id": "S3-P2-1", "severity": "P2", "evidence": "REPRO", "file": "src/ui/trace/image-loader.ts", "line": 369, "known": false, "regression": "none (same in 1.0.28 and 1.0.23)", "verdict": "CONFIRMED", "refuter": "own driver: 12 MP JPEG block 785-861 ms (median 833, 4.2x budget); profile image-loader.ts:369 230 ms + GC 433 ms, :228 163 ms; Node: chunked base64 byte-identical and 4.4x faster", "title": "Photo import decodes, composites and builds the luma base64 one character at a time on the UI thread: 12 MP JPEG block 1,063-1,098 ms, 4096x4096 PNG 1,300-1,310 ms, 9 MP TIFF page 845-907 ms; no progress or Cancel" },
    { "id": "S3-P2-2", "severity": "P2", "evidence": "REPRO", "file": "src/ui/state/autosave-preparation-client.ts", "line": 51, "known": false, "regression": "none (READ: same lane and timeout in 1.0.23)", "verdict": "CONFIRMED", "refuter": "deliberate per ADR-288 Amd 1 and ADR-598 decision 2 + Amd 1 (add as anchors); own probe: 100 mm photo and one bed photo autosave within 30 s, four bed photos no write 73 s after edit; loss needs a crash - a real close prompts (beforeunload dialog observed; desktop ADR-549); not P1: no crash shown, 90 s toast says save manually", "title": "With bed-sized photos, autosave queues behind the background job preparation in the shared worker lane (ADR-288 Amd 1): first autosave about 125 s after an edit, a 60 s timeout blamed on browser storage, no recovery offer in 4 of 4 runs closed 50 s after an edit" },
    { "id": "S3-P2-3", "severity": "P2", "evidence": "REPRO", "file": "src/ui/workspace/preparation-worker.ts", "line": 1, "known": false, "regression": "none (Save-time peak 4.1/4.3/4.3 GB main/1.0.28/1.0.23)", "verdict": "CONFIRMED", "refuter": "own poller: one bed photo renderer 2.89-4.20 GB, PC free memory to 0.51-0.76 GB; four photos 5.1 GB and rising at 73 s, free memory 27 MB (watchdog); 100 mm photo 1.61-1.64 GB total; page JS 72-86 MB; with a 1 GB JS heap cap the preparation still completes (bulk is off-heap); commit 22.6/44.1 GB, no crash -> P2 kept", "title": "Background job preparation after Open or an edit drives the renderer to 3.3 GB (one bed-sized photo) and 7.7-9.5 GB (four), budget 1.5 GB; Save during it peaks 4.1-4.5 GB; memory falls 7 GB within 2 s of the worker ending (S4 owns the compile)" },
    { "id": "S3-P3-1", "severity": "P3", "evidence": "REPRO", "file": "src/io/json/json-tokenizer.ts", "line": 168, "known": false, "regression": "none (same in 1.0.23)", "verdict": "CONFIRMED", "refuter": "READ 25 MiB switch + per-character tokenizer; own 97 MB project opened in 7.47 s (1.5x budget)", "title": "Projects of 25 MiB or more go through a character-at-a-time streamed JSON tokenizer: the 90 MB photo project opens in 8.4-8.8 s (budget 5 s); Node 7.6 s against JSON.parse 0.09 s" },
    { "id": "S3-P3-2", "severity": "P3", "evidence": "REPRO", "file": "src/ui/import/document-import-worker-client.ts", "line": 155, "known": false, "regression": "none (same in 1.0.23)", "verdict": "CONFIRMED", "refuter": "own driver: SVG 50k longest task 560-583 ms (2.8-2.9x budget, large input)", "title": "Large vector results block the UI on arrival: SVG 50k 801-863 ms, PDF 20k 578-667 ms, AI 456 ms, Open 10,000 objects 550-683 ms (structured clone, first sprite paint, display flattening, PDF page conversion on the UI thread)" }
  ],
  "known_reobserved": ["S2-P3-1 (estimate block after Open/Import of small Fill designs, 235-284 ms)", "S2-P2-2 (pulse after pasting 2,000 objects, 262-292 ms)", "S2-P2-1 (Redo of 2,000 pasted objects shown after 683-857 ms)", "21-P3-7 (.lbdev regex, unchanged)", "J10-P3-3 / #1488 (compact saves hold: 3.8-3.9x smaller than 1.0.23)"]
}
```
