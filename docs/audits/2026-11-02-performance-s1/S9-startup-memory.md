# Performance audit S1 — S9 Startup and memory

- **When:** 2026-11-05 18:58 – 2026-11-06 01:20 +0800 (static analysis 19:00–19:40; browser sets 20:43–01:05; heap analysis and the report around them).
- **Tree:** origin/main @ `87f0ec583` (worktree `claude/performance-audit-s8`, docs only). origin/main did not move during the audit (checked 20:55 and 01:05).
  - **`j7-main` refreshed.** 11,216 files under `src`, `public`, `scripts`, `electron`, `e2e` and the root build files were compared with origin/main by git blob hash (`zz-s9\refresh9.mjs`, a copy of S8's). 62 differed (the changes #1590 and #1591 made since S8's `790b95c4a`). They were rewritten from `git show origin/main:<path>` and re-checked: 0 differ. `node_modules` is still the junction to the main checkout, whose `pnpm-lock.yaml` equals origin/main's.
  - **Browser build, main:** `zz-s9\dist-main`, built from `j7-main` at 19:12–19:28 with `vite build --sourcemap hidden` (`buildmain9.sh`, `zz-s9-vite.config.mts`, S8's config). S8's `dist-main` (`790b95c4a`) was not reused: #1590/#1591 touch startup-graph files (`TextBoxFields.tsx`, `draw-raster-preview.ts`, `image-loader.ts`, `ConnectionBar.tsx`).
  - **Trend:** S1's `zz-s1\dist-33bc394c6` (1.0.28) and `zz-s1\dist-87ecb4f24` (1.0.23). They were built with main's dependency versions and with the PWA plugin stubbed (S1), so they have no service worker. Their projects come from their own `serializeProject` (`zz-s2-old` trees, S4's generator).
  - **Desktop:** no packaged desktop build exists in the repo, its worktrees or the scratchpad (searched for `win-unpacked`, `app.asar`, `KerfDesk*.exe`). Desktop cold start is read from code only.
- **Machine state:** i7-1260P (12 cores, 16 threads), 16 GB, Iris Xe; Chrome 156 (installed, headless); Node 25.8.2. `zz-s9\machine-state.log` holds every set's gate, free memory, load and tooling; `zz-s9\sampler.log` a line every 30–45 s.
  - **There was no quiet window.** Over 486 samples (19:04–00:26) free memory was 4–2,770 MB (median 470), CPU load 0–100% (median 100%), other sessions' test tooling 0–20 processes (median 2), and 0–11 other Chrome instances. The commit charge stood at 33.6 of 40.5 GB at 19:43; 19 `claude`, 12 `node` and 28 `chrome` processes held 5.7, 5.6 and 2.9 GB. Not one sample met S7's strict gate (no tooling, load < 45%, ≥ 2.5 GB free); 29 had ≥ 1.5 GB free and 405 had < 1 GB.
  - **Gates.** `waitgate9.sh` held each set for the strict gate (three passes 20 s apart) and then fell back. From 19:51 to 20:19 neither the strict gate nor a relaxed one (≥ 1.5 GB free, load < 70%) passed. From 20:19 the relaxed gate was **≥ 800 MB free, one pass**, with load and tooling only logged. Waits of 103–2,576 s are logged.
  - **Calibration** (S1's 40M-step loop, 36 ms on an idle PC) read **150–337 ms**, that is the PC ran 4–9 × slower than idle. So every browser number below is either **a ratio between builds that alternate within each round** (the order flips every round), **a count** (bytes, workers, nodes, listeners, canvases) or **a memory figure** (commit, which paging does not change). Absolute times are quoted as measured, with an idle estimate `ms × 36 / mean(calibration)` only for CPU-bound spans (about ± 50%).
  - **Kept and discarded sets.** The startup trend set drifted 8% (153 → 165 ms) and is kept. The service-worker set (169 → 211 ms, 25%) and the emulated-network set (150 → 270 ms, 80%) drifted more than 15% and are **discarded**; they appear only under Not verified. From 20:33 to 20:43 two copies of my queue ran the trend set at once (`TaskStop` left the first queue's shell alive); both were killed and those 63 rows moved to `out\discarded-overlap-startup9.jsonl`.
  - I stopped none of the other sessions' processes.
  - **Memory figures** are the private bytes of the measuring Chrome (browser, renderer, GPU and utility processes; workers live in the renderer), from `zz-s9\mem-poll.ps1` called **with `-Marker`**. See [Method correction](#method-correction-memory-poller-s3s8) before comparing them with S3–S8.
- **Temp files:** none in the repo except this report. Kept for the refuter in `scratchpad\zz-s9\`:
  - scripts: `refresh9.mjs`, `buildmain9.sh`, `zz-s9-vite.config.mts`, `static9.mjs`, `depmap9.mjs`, `host9.mjs`, `startup9.mjs`, `anal9.mjs`, `leak9.mjs`, `leakanal9.mjs`, `page-init9.js`, `peak9.sh`, `start\` (a copy of S4's Start driver and host, with the poller fix), `mem-poll.ps1`, `memtypes9.ps1`, `memprobe9.mjs`, `chromeroots9.ps1`, `gate9.ps1`, `waitgate9.sh`, `state9.ps1`, `sampler9.ps1`, `samplesum9.mjs`, `queue9.sh`, `queue9b.sh`, `queue9c.sh`, `dbg9.mjs`, `peakanal9.mjs`, and for the heap `leak9-snap.mjs`, `snapdiff9.mjs`, `retainers9.mjs`, `retainers9b.mjs`, `chain9.mjs`, `nodeinfo9.mjs`, `mapsize9.mjs`;
  - results: `out\static9.json`, `out\startup9.jsonl`, `out\leak9.jsonl`, `out\leak9-first14.jsonl` (the first leak run, stopped at cycle 14 by a harness bug), `out\leak9-snap.jsonl`, `out\leak9-steps.jsonl`, `out\peak9.jsonl`, `out\smoke9.jsonl`, `out\discarded-overlap-startup9.jsonl`, `logs\` (static and dependency summaries, analysis output, memory timelines `mem-*.txt`), `machine-state.log`, `sampler.log`;
  - the generated 2,000-object projects in `projects\` (3 × 3.3 MB).

  Deleted to save disk, and remade by "Re-running": `dist-main` (121 MB with its hidden source maps) after the dependency map was taken, and the two heap snapshots (70 and 89 MB) after their summaries were saved in `logs\`.
- **Scope** (AREAS S9, the brief's six items):
  1. **Bundle and chunk sizes:** what the web app downloads before the workspace is usable, the lazy chunks and workers, the largest dependencies, the service worker's precache; main against 1.0.28 and 1.0.23.
  2. **Web first load and cached load:** time to the splash, to the main chunk, to the first workspace paint, to the welcome window, and to the moment input is released; long tasks; bytes; the JS heap, DOM nodes, listeners and workers at rest.
  3. **Desktop cold start:** code reading only (no packaged build).
  4. **Leak session:** a scripted cycle of draw (3 rectangles, 2 ellipses), trace (import a 1,200 × 900 PNG, Trace Image…, Trace), Preview (open, ready, close), Undo to an empty document, and five dialogs (Settings, Project Notes, Undo History, Box Generator, Material Test, through Find a command), repeated for one hour (98 cycles, 22:23–23:23), plus a 35-cycle session with heap snapshots and two 25-cycle sessions of single steps; after every cycle two GCs, then the JS heap, DOM counters, listeners, live / created / terminated workers, live and detached canvases, `OffscreenCanvas` and `ImageBitmap` objects, and Chrome's private bytes.
  5. **Peak memory, 2,000 objects:** S4's mix scene (1,000 Line circles and 1,000 Fill rectangles, 3.3 MB) through Open, Preview (held 20 s), Frame and Start on the simulated GRBL, 5 s of the job, then Abort.
  6. **Under 1 GB free:** observed, because most of the session ran there, and read in code.
- **Counts (auditor):** 3 raised → **P1 0 / P2 0 / P3 3** (+ 2 KNOWN re-observed; + 1 method correction for the coordinator, not counted). The auditor refuted 6 leads.
- **Counts (refuter, 2026-11-06):** 3 raised → 0 refuted → **P1 0 / P2 0 / P3 3** (+ 2 KNOWN). 3 confirmed at their severity, 0 severity changes, 0 new. The 6 refuted leads stand. The method correction is **confirmed in cause but narrowed in effect**: only S3's sets (and a handful of non-finding rows in S5, S6 and S8) ran beside another Chrome, so no ledgered verdict changes and the suggested S4/S5 re-measurements are not needed. See [Refuter summary](#refuter-summary).

## Headline

**KerfDesk starts lean and stays lean: at rest it holds a 17 MB heap and no workers, it paints its workspace in about half a second on a cached visit, and a 2,000-object job peaks at about 1.04 GB, under the 1.5 GB budget and below both releases. Nothing in this area harms a job or loses work: P1 0 / P2 0 / P3 3.**

- **Startup.** The workspace paints in an estimated 0.5–0.6 s on a cached web visit (2.3–2.5 s under 4.4 × load), no slower than 1.0.28 or 1.0.23. **Input is released only after the startup screen's fixed 4 s hold and 0.75 s fade** (ADR-049 Amendment 2), at 6.8–7.1 s under load and about 5.0–5.3 s idle, so the 3 s "usable canvas" budget is missed on every web start and, from the code, on every desktop start: **S9-P3-1**, a maintainer decision.
- **Download.** The workspace needs 2,233 KiB of gzip JavaScript before it paints (KNOWN: over PROJECT.md's 1 MB target since 2026-10-14). It has grown 9% since 1.0.23 and 19% since the October speed fixes, with nothing in CI to notice: **S9-P3-2**.
- **One hour of use** (98 cycles of draw, trace, Preview, Undo and five dialogs): DOM nodes, listeners, canvases and workers stay flat; 767 task workers were made and all 767 terminated. The JS heap alone creeps up 0.15 MB a cycle, because the Fill-pool cache added on 2026-11-03 (#1551) keeps every traced object ever seen: **S9-P3-3**.
- **2,000 objects** through Open, Preview, Frame and Start: Chrome peaks at 976–1,061 MB (main), against 1,255–1,462 MB (1.0.28) and 1,312–1,447 MB (1.0.23), and holds 83 MB of heap afterwards against 155–158 MB.
- **Under 1 GB free**, which was most of this session, the app only slowed down: no crash, no page error, every cycle and every completed Start finished. There is no low-memory handling in the web app; the desktop shell offers to reload after a renderer runs out of memory.
- **Method correction for S3–S8.** Every earlier memory poller summed every Chrome on the PC (a PowerShell argument-binding slip). See the [Method correction](#method-correction-memory-poller-s3s8); S9 uses the fixed call.
- **Not verified:** the packaged desktop cold start (no build exists), the first visit with the service worker installing its 13.4 MiB precache, and a first visit over a throttled network (both sets drifted over 15%).

## Scorecard

Budgets (AREAS): desktop cold start 3 s to a usable canvas; web 3 s on a cached visit, the first visit measured and reported; peak memory 1.5 GB for the whole app on a 2,000-object project; Open 5 s and Preview 8 s at 2,000 objects (S4's area). "Usable" here means the canvas takes input: the startup screen removed and `#app-root` no longer inert. Times are medians (worst) of 5 kept rounds under 4.2–4.6 × load (calibration 153 → 165 ms) unless marked; "idle est." = × 36 / 159.

### Startup (web, production builds, local gzip server with the deploy's headers)

| Row | Input | Main (loaded) | Idle est. | 1.0.28 | 1.0.23 | Budget | Verdict |
|---|---|---|---|---|---|---|---|
| Splash shown (FCP; inline HTML) | first / cached | 1,063 / 747 ms | ≈ 0.2 s | 1,418 / 1,035 | 1,144 / 823 | — | Pass |
| Workspace painted | first visit | 2,473 (3,314) ms | ≈ 0.56 s | 3,546 | 3,206 | 3 s | Pass (paint) |
| Workspace painted | cached visit | 2,263–2,549 (4,628) ms | ≈ 0.5–0.6 s | 2,596–2,749 | 2,441–3,705 | 3 s | Pass (paint) |
| **Input released (usable)** | **cached visit** | **6,808–7,142 (9,418) ms** | **≈ 5.0–5.3 s** (hold is wall-clock) | 6,966–7,181 | 6,517–7,198 | **3 s** | **Miss by design: S9-P3-1** |
| Input released + welcome | first visit | 7,050 (7,621) ms, then one click on "Continue with Free" | ≈ 5.3 s + click | 7,470 | 7,814 | reported | S9-P3-1 |
| Longest task before release | any | 619–679 (814) ms | ≈ 140–150 ms | 801–859 | 760–828 | 200 ms (design) | Pass (estimate) |
| Bytes to release | first visit | 2,541 KiB | — | 2,426 | 2,347 | PROJECT.md 1 MB JS | KNOWN; S9-P3-2 |
| Bytes to release | cached visit | under 1 KiB (`index.html` revalidates to 304) | — | 1 | 1 | — | Pass |
| At rest after start | — | heap 17 MB after GC; 1,495 DOM nodes; 429 JS listeners; **0 workers** | — | 16 MB; 1,488; 427; 0 | 16 MB; 1,487; 426; 0 | — | Clean |
| **Desktop cold start** | packaged app | not measured (no packaged build) | ≥ Electron launch + load + 4.75 s (code) | — | — | **3 s** | **Not verified; S9-P3-1 makes it a miss by design** |

### Bundle (static, `out\static9.json`)

| Row | Main | 1.0.28 | 1.0.23 | Budget | Verdict |
|---|---|---|---|---|---|
| Boot JS (entry + workspace `main` + static imports), gzip | **2,233 KiB** (12 files; 7,052 KiB raw; brotli-11 1,724) | 2,122 (11) | 2,043 (11) | 1 MB (PROJECT.md) | KNOWN, × 2.2; growth S9-P3-2 |
| `index.html` (inline splash art) | 206 KiB (142 gzip) | same | same | — | ADR-049 Amd 2 |
| Boot chunks over the 750 kB warning | 3 (`ui-workbench` 2,654 kB, `core` 1,723, `main` 1,621) | 3 | 3 | 750 kB (config) | S9-P3-2 |
| Lazy JS | 118 files, 11,764 KiB raw | 115, 10,982 | 112, 10,560 | — | Info |
| Worker entry chunks | 37 (8,631 KiB raw) | 34 (7,917) | 33 (7,554) | — | Info |
| WASM / fonts | HarfBuzz 431 KiB, packing solver 7,272 KiB / 25 fonts 5,763 KiB | same | same | — | Lazy (none at boot) |
| Service-worker precache (first web visit, in the background) | 422 entries, 35.0 MiB raw, 13.4 MiB gzip | (stubbed) | (stubbed) | — | Info; Not verified in time |

### Leak session (main; 98 cycles in 60 min, 22:23–23:23; `logs\leak-anal.txt`)

| Measure after 2 GCs | Cycle 2 → cycle 97 | Slope per cycle | Verdict |
|---|---|---|---|
| JS heap used | 27.0 → 44.1 MB | **+0.148 MB** | **S9-P3-3** (small, steady) |
| DOM nodes / documents | 1,563 → 1,564 / 2 → 2 | 0.002 | Clean |
| JS event listeners (all; window; document) | 562 → 562; 69; 3 | 0.003 | Clean |
| Workers live; made; terminated | 1 → 1; 767 made and 767 terminated in cycles 3–97 (about 8 a cycle) | 0.001 | Clean: every task worker retires |
| Canvases alive / not in the document | 7–9 / 4–6 (bounded; 6.0–7.4 MP) | 0.002 | Clean (bounded) |
| `OffscreenCanvas` / `ImageBitmap` alive | 0 / 0 | 0 | Clean |
| Chrome private MB (all processes) | 442 → 538 (peak 884 inside a cycle) | −0.5 | Clean; Chrome's own on-device-model utility (171 MB) appears mid-run, not the app's |
| Steps per cycle (median, worst; loaded) | draw 5.0 s (12.9), trace 6.3 s (15.7), Preview 1.6 s (3.0), Undo 2.1 s (4.7), dialogs 5.7 s (14.2) | — | All 98 cycles completed every step; 0 page errors |

### Peak memory, 2,000 objects (Open → Preview 20 s → Frame → Start → 5 s of job → Abort; `logs\peak-anal.txt`)

| Build | Complete runs | Peak Chrome private | Peak renderer | Heap retained after Abort + GC | Start's longest tasks (loaded) | Budget | Verdict |
|---|---|---|---|---|---|---|---|
| main | 4 | **976–1,061 MB** (median 1,037) | 637–776 MB | 83 MB | 611–764 ms | 1.5 GB | **Pass** |
| 1.0.28 | 3 | 1,255–1,462 MB (1,276) | 935–1,085 | 155–157 | 1,491–2,799 | 1.5 GB | Pass (close) |
| 1.0.23 | 3 | 1,312–1,447 MB (1,318) | 1,024–1,154 | 155–158 | 2,141–3,197 | 1.5 GB | Pass (close) |

In every run the peak came during Start preparation. Main is × 0.79 of 1.0.23 and × 0.81 of 1.0.28 at the peak, and holds half the heap afterwards.

### Under 1 GB free (item 6)

| Observation | Result | Verdict |
|---|---|---|
| Leak session with the PC at 0–2,946 MB free (76 of 98 cycle samples under 1 GB, 25 under 300 MB, the watchdog saw 43 MB) | every step completed, 0 page errors, no renderer crash | Degrades to slowness only |
| 2,000-object Start with the PC at 19–192 MB free (r28-4: 19 MB) | completed; Open 6–18 s, Start-to-review 12–57 s under load | Degrades to slowness only |
| A page load at 39 MB free (`peak-main-4`) | loaded; the S4 driver missed its toolbar check because the welcome window covered it (a harness race, screenshot `start\err-peak-main-4.png`) | Not an app failure |
| Memory-pressure handling in code | none in the web app (no `deviceMemory`, quota or pressure checks on the main paths); the desktop shell offers "Reload KerfDesk" on any renderer exit, naming "it ran out of memory" (`electron/renderer-crash-recovery.ts`, ADR-482); the web relies on autosave recovery after a crash (ADR-688) | Read only |

## Findings

### S9-P3-1 — The startup screen holds input for at least 4.75 s after the workspace module starts, so web cached load and desktop cold start cannot meet the 3 s budget; the workspace itself paints in about 0.5–0.6 s (idle estimate)

- **Where:**
  - `src/ui/app/startup-splash.ts:1-3` (`WORKSPACE_WAIT_MS = 5000`, `MINIMUM_VISIBLE_MS = 4000`, `FADE_MS = 750`) and `:94` (release only when painted **and** `visibleMs >= MINIMUM_VISIBLE_MS`); `:43-44` keeps `#app-root` inert and swallows every key until the fade ends.
  - `src/ui/app/main.tsx:131` installs it after the workspace module has loaded; `src/ui/workspace/Workspace.tsx:405` marks the first workspace paint.
  - Decided in **ADR-049 Amendment 2** (2026-10-18, "the loading screen is still too fast"): "A fast launch presents the complete timber screen for about 4.75 seconds after the workspace module starts." `e2e/startup-splash.e2e.ts:133` asserts the 4 s.
  - Desktop: `electron/main.ts:272` (`show: false`), `:392` (reveal on ready), and the same hold counted from the native window's visibility (`startup-splash.ts:50-61`).
- **Evidence** (trend set, production builds, 5 kept rounds each, calibration 153 → 165 ms, i.e. 4.2–4.6 × idle; `logs\anal-trend.txt`):

  | Main, local gzip server | FCP (splash) | Main chunk loaded | Workspace painted | Input released | Released − painted |
  |---|---|---|---|---|---|
  | First visit | 1,063 ms (1,570) | 608 (931) | 2,473 (3,314) | 7,050 (7,621) | 4,197 (4,791) |
  | Cached visit 1 | 770 (2,931) | 595 (2,520) | 2,549 (4,628) | 6,808 (9,418) | 4,193 (4,791) |
  | Cached visit 2 | 747 (887) | 469 (495) | 2,263 (2,603) | 7,142 (7,600) | 4,797 (5,386) |

  - The paint is CPU-bound work that scales with load: idle estimate **0.5–0.6 s** to a painted workspace on a cached visit. The hold is wall-clock (animation frames and `performance.now()`), so it does not shrink on a quiet PC: release ≈ module start + 4.0 s + 0.75 s fade, about **5.0–5.3 s** idle on a cached visit.
  - The same in 1.0.28 and 1.0.23 (released − painted 4.0–4.8 s in both), so not a regression. On 2026-10-14, before the amendment, the speed audit measured the welcome surface at a median 1.09 s.
  - On a first web visit the welcome window ("Choose your KerfDesk workspace") appears under the splash at 3.2 s (loaded) and needs one click once the splash has gone.
- **Why it matters:** the budget (approved 2026-11-02, after the amendment) is "desktop cold start to a usable canvas 3 s; web 3 s cached". Every start of the app misses it by about 2 s, by design, and for those seconds a ready workspace sits behind a screen that ignores keys and clicks. It is 1.6–1.8 × the budget, below P2's 3 ×, and decided in an ADR, so P3; but it is the largest single cost in this area, and every user meets it on every start.
- **Fix direction (maintainer decision; no burn change).** Choose one, then amend ADR-049:
  - count the 3 s budget to the painted workspace and treat the hold as branding (the app then passes with about 2.4 s to spare);
  - or shorten the hold to keep inside 3 s, for example a minimum of 1.5 s plus a 0.5 s fade, or release input at paint and let the artwork fade over the live workspace;
  - or hold the full 4 s on the first start only and release at paint on later starts (a stored "seen" flag).

  The budget to reach is **3 s** to an interactive canvas on a cached web visit and on desktop. The guard: `e2e/startup-splash.e2e.ts` already times the hold; a new bound would replace its `>= 4000` assertion.

**Refuter (2026-11-06): CONFIRMED, P3; a maintainer decision** (READ; not re-timed, the PC was never quiet).
- **Code on origin/main `87f0ec583`** (unchanged since the audit; origin/main has not moved):
  - `startup-splash.ts:1-3` holds the three constants.
  - `:43-44` sets `inert` and a capturing `keydown` blocker.
  - `:94` releases only when `(painted || timedOut) && visibleMs >= MINIMUM_VISIBLE_MS`, and `:97` then fades.
  - `main.tsx:131` installs it, `Workspace.tsx:405` sets `data-workspace-painted`, and `e2e/startup-splash.e2e.ts:133` asserts `fadedAt - releasedAt >= 4000`.
  - In Electron, `electron/main.ts:272` (`show: false`) and `:392` (reveal) apply, and the hold counts only native-visible time (`startup-splash.ts:50-61`).
  - Every citation matches.
- **ADR wording.** `docs/decisions/ADR-049-amendment-2-complete-startup-artwork-and-visible-hold.md` is Implemented. Its context says the maintainer found the screen "still too fast". Its decision holds "four visible seconds" and then fades "over 750 ms". Its consequence quoted in the report is verbatim.
- **Reduced motion does not escape it.** `fadeSplash` (`:6-10`) skips only the fade, so input is still held for at least 4.0 s.
- **Severity.** This is a deliberate, recent, maintainer-requested behaviour. The 3 s budget (2026-11-02) was approved after it, and the two conflict. The miss is about 1.7 × the budget, under P2's 3 ×, so P3 is right. The choice of fix belongs to the maintainer.

### S9-P3-2 — Nothing guards the startup download: the workspace's boot JavaScript is 2.18 MiB gzip (6.89 MiB raw), 9% more than 1.0.23 and 19% more than the 2026-10-14 speed fixes, and three boot chunks are 2–3.5 × over the configured 750 kB chunk limit, which only warns

- **Where:**
  - `vite.config.ts` `build.chunkSizeWarningLimit: 750` with the comment "keeps a clean, warning-free build while still flagging any NEW oversized chunk"; `manualChunks` puts all of `src/core` in `core`, all of `src/io` in `io` and `src/ui/laser` + `src/ui/workspace` in `ui-workbench`, and `src/ui/app/browser-entry.ts` imports `main` with all of them before the first paint.
  - `src/io/svg/index.ts:9` and `src/io/xml/index.ts:2-7` re-export the worker-side parsers, so `linkedom/worker`, `saxes`, `tiff` and `fflate` ride in the boot `io` chunk (`src/io/xml/read-xml-document-from-blob.ts:1`, `src/io/svg/parse-svg-worker.ts:1`).
  - `package.json` and the CI workflows: no size or startup check (`git grep` finds only `scripts/performance-audit/startup-probe.mjs`, which nothing runs).
- **Evidence** (`static9.mjs`, `out\static9.json`, `logs\static9.txt`; gzip level 6 as the startup probe uses; boot = the entry, its preload and the `main` chunk's static imports):

  | Build | Boot JS files | Raw | Gzip | Brotli 11 | Measured first-visit transfer to input release |
  |---|---|---|---|---|---|
  | main `87f0ec583` | 12 | 7,052 KiB | **2,233 KiB** | 1,724 KiB | 2,541 KiB |
  | 1.0.28 `33bc394c6` | 11 | 6,679 | 2,122 | 1,638 | 2,426 |
  | 1.0.23 `87ecb4f24` | 11 | 6,449 | 2,043 | 1,578 | 2,347 |

  - Boot chunks: `ui-workbench` 2,654 kB (816 kB gzip), `core` 1,723 kB (584), `main` 1,621 kB (505), `io` 694 kB (230); the build log prints "(!) Some chunks are larger than 750 kB after minification".
  - What the boot bytes are (`depmap9.mjs`, hidden source maps, `logs\depmap-boot.txt`): `src/ui/laser` 910 KiB, `src/ui/state` 854, `src/ui/workspace` 347, `src/ui/layers` 330, `src/ui/commands` 272, `src/core/text` 228, `src/core/job` 220, `src/core/cnc` 195, `src/core/geometry` 180, `src/core/trace` 173; dependencies `linkedom` 169 KiB (a DOM for workers; the window has `DOMParser`), `react-dom` 127, `clipper2-ts` 78, `zod` 73. Feature screens nobody needs at start ride along: `src/ui/gcode-inspector` 124 KiB, `src/ui/remote-control` 93, `src/ui/viewer3d` 75, `src/core/relief` 62, `src/ui/camera` 62.
  - The 2026-10-14 speed fixes left 1,917,675 gzip bytes of initial JavaScript; main's boot closure is 2,286,592 (+19%).
- **Why it matters:** the payload is already over PROJECT.md's "Web bundle target: < 1 MB compressed" (KNOWN, below), and it keeps growing by a few percent a release with nothing to notice. On this PC its cost is mostly parse and evaluation: two long tasks before the first paint, 579–806 ms and 475–633 ms under 4.4 × load (about 130–180 ms and 110–140 ms idle), and 0.5–0.6 s of CPU to the painted workspace. On a 20 Mbit/s first visit the download alone is about 1 s. Not a 2 × regression, so P3 (a missing guard).
- **Fix direction (no burn change):**
  1. A CI guard on the boot closure's gzip bytes (a static count, stable on any runner): fail above today's 2,233 KiB plus 3%, and print the per-directory map. `static9.mjs` and `depmap9.mjs` show the method.
  2. Take worker-only code out of the boot graph: import the worker parsers from their own modules instead of the `io` barrels (removes `linkedom`, `saxes`, `tiff`: about 0.2 MiB raw).
  3. Lazy-load feature screens that a fresh start never shows (G-code inspector, remote control, 3D viewer, camera, relief), as was done for the Design Library.

  The budget to reach is PROJECT.md's 1 MB compressed; a first step is to stop the growth (≤ 2,233 KiB) and then fall below 1.0.23's 2,043 KiB.

**Refuter (2026-11-06): CONFIRMED, P3** (static re-measurement; `zz-s9r\out\static9r.txt`).
- **Method.** `dist-main` (`87f0ec583`) had been deleted, and a rebuild needs 2 GB free, which the PC never had. So I ran the auditor's `static9.mjs` unchanged (copied as `static9r.mjs`) on the two release builds and on every main build the S1–S8 auditors left behind.
  - The method reproduces the auditor's release figures exactly: **1.0.28 2,122 KiB and 1.0.23 2,043 KiB** gzip, 11 files each.
  - It also shows main's boot closure growing through this audit:

  | Main build (built) | Boot JS gzip | Raw |
  |---|---|---|
  | S1 `dist-main` (11-02 15:08) | 2,186 KiB | 6,913 KiB |
  | S2 (11-02 21:48) | 2,194 | 6,936 |
  | S3 (11-03 07:00) | 2,195 | 6,940 |
  | S4 (11-03 22:34) | 2,211 | 6,989 |
  | S6 (11-04 18:24) | 2,223 | 7,023 |
  | S8 (11-05 13:49, `790b95c4a`) | 2,231 | 7,044 |
  | auditor, `87f0ec583` | 2,233 | 7,052 |

  That is **+47 KiB (+2.1 %) in four days**, with every step up and none down, which is exactly the "missing guard" the finding names. S8's build differs from `87f0ec583` only by #1590 and #1591, and reads 2,231 KiB, which agrees with the auditor's 2,233.
- **Worker-only code at boot.**
  - On main, `src/io/svg/index.ts:9` re-exports `parseSvgWorkerDocument`, and `src/io/xml/index.ts:3-7` re-exports `read-xml-document-from-blob`.
  - Those two modules import `linkedom/worker` and `saxes` at line 1 (`parse-svg-worker.ts:1`, `read-xml-document-from-blob.ts:1-2`).
  - `vite.config.ts:250-251` puts all of `src/io` in the `io` chunk, which is in the boot closure.
  - The S1 source-mapped build's `io` map (`zz-s1\dist-main-map`, `out\boot-deps9r.txt`) lists **linkedom, saxes, tiff and fflate** sources inside the boot `io` chunk.
  - No size or startup check exists in `.github`, `package.json` or `scripts` (`git grep`). `vite.config.ts:217` only warns.
- **One caveat.** The "+19 % since 2026-10-14" compares the static closure (2,286,592 bytes) with the speed-fix probe's transferred script bytes (1,917,675). Those are close but not identical measures. The like-for-like trend is +9 % against 1.0.23 and +5 % against 1.0.28, and both are confirmed. Not a 2 × regression, so P3.

### S9-P3-3 — The Fill-pool cluster cache keeps every traced image (and any Fill operation) it has ever seen for the rest of the session: the JS heap grows 0.15 MB per trace-and-undo cycle in the one-hour session, without bound

- **Where:** `src/ui/workspace/fill-pools.ts:255` — `const lastGroups = new Map<string, ClusterGroups>()`, a module-level Map keyed by `${run}\n${operationId}\n${color}\n${output}` (`:196`), written in `clustersOf` (`:240-249`) and never pruned. Its comment says "Overwritten every plan; holds one per key", but a key whose operation is gone is never removed, and each value holds `objects`, the pool's scene objects with their full geometry. Added by `ff1924ccc` (#1551, 2026-11-03, S2-P2-3/P2-4), so it is not in 1.0.29, 1.0.28 or 1.0.23. The `WeakMap` beside it (`clusterCache`, `:236`) is fine.
- **Evidence:**
  - **One-hour session** (98 cycles, `logs\leak-anal.txt`): after two GCs per cycle the JS heap rose from 27.0 MB (cycle 2) to 44.1 MB (cycle 97), a steady **+0.148 MB per cycle** (least squares). DOM nodes, listeners, canvases, workers and Chrome's private bytes stayed flat.
  - **Split by step** (25 cycles each, `out\leak9-steps.jsonl`): trace + Undo alone grows **0.146 MB per cycle** (25.9 → 30.6 MB); draw, Preview, Undo and the five dialogs without a trace grow 0.013 MB per cycle (22.6 → 22.9 MB).
  - **Heap snapshots** after cycles 4 and 34 of a second session (`leak9-snap.mjs`, `logs\snapdiff-4-34.txt`): +4.6 MB, almost all plain `Object`s (+82,457), heap numbers (+138,200) and arrays: trace geometry (`paths`, `curves`, `segments`, `points`, `control1/2`).
  - **Retainers** (`retainers9b.mjs`, `chain9.mjs`, `logs\retainers-object-deep.txt`): every sampled chain ends at the traced-image objects of earlier cycles, held by `{ objects, groups }` values in one module-scope `Map` (minified `IH` in `ui-workbench`; the bundle's `IH.set(e,i)` sits in `clustersOf`). That Map held **5 keys after cycle 4 and 35 after cycle 34**, one `\noperation-<traced object id>\n#1a1a1a\n1` per trace (`mapsize9.mjs`). Each trace's object was undone, and later cycles never touched it.
- **Why it matters:** every trace (each traced image gets its own Fill operation) and every Fill operation a user creates, previews or deletes adds an entry that lives until the tab closes, holding that object's whole geometry. Undo does not release it (measured); by reading, nothing else prunes it either (Delete, File > New). Here each entry is about 0.15 MB (a 1,200 × 900 line drawing); a dense photo trace holds proportionally more, and a long tracing session, the commonest beginner workflow, accumulates them. Over this hour it cost 17 MB of a 1.5 GB budget, so P3 (poor scaling that ordinary use reaches slowly), not a crash.
- **Fix direction (canvas cache only; G-code unaffected):** keep `lastGroups` to the keys of the current plan: build a fresh Map per `planPools` call (`:132`) and swap it in, or delete keys not seen in the plan just made. The guard: a unit test that plans pools for operation A, then for a project without A, and asserts `lastGroups` no longer holds A (or expose its size to the existing fill-pool perf test); the leak session's slope should fall to about 0 MB per cycle.

**Refuter (2026-11-06): CONFIRMED, P3.** The growth mechanism holds in code, and the cost per trace scales with the trace. It does not reach P2 in a working day. Sources: READ, plus trace output sizes measured in Node (`zz-s9r\trace-size9r.mjs`, `out\trace-size9r.jsonl`) and S5's segment counts.
- **Mechanism, on origin/main `87f0ec583`** (`fill-pools.ts` was last changed by `ff1924ccc`, #1551):
  - The key is `${run}\n${operationId}\n${color}\n${output}` (`:196`).
  - `lastGroups` is read and written only at `:245`, `:249` and `:255`. It has no delete, no clear and no test reset, so a key whose pool disappears keeps its last `ClusterGroups` until the tab closes.
  - Each value keeps the members' `VectorSceneObject`s (`:227`), and possibly a second, older `objects` array in `rest` (`:232-233`).
  - The live object then keeps alive the derived geometry the canvas caches in WeakMaps keyed by it or by its arrays: `fill-pool-geometry.ts:27` and `:47` (world-placed contours, a transformed copy of every point), `display-polylines.ts:80-81`, and `hit-test.ts:216`.
  - The auditor's retainer chains show exactly this: "part of key … -> val" WeakMap entries below `Object.curves`, next to `Object.objects <- Map.table` (`logs\retainers-object-deep.txt`).
  - `fill-pool-plan-cache.ts` holds at most 2 plans, and the pool rasters at most 6 (`fill-pool-raster.ts:55-58`). So canvases and bitmaps are **not** retained, which matches the flat canvas counts.
- **What adds a key.**
  - Every committed trace in a Fill-mode preset gets its own operation `operation-<object id>` (`artwork-operation.ts:171`). `fresh-artwork-mode.ts:24-30` gives traces `fill` unless they are Centerline or Edge (`line`), so Centerline and Edge traces never enter a pool.
  - Drawn shapes default to `line`, which matches the auditor's 0.013 MB per cycle without a trace.
  - Any key goes stale when its operation's last member is deleted or undone, or when the colour, run or output switch changes.
  - **Also when the document is replaced:** File > New or Open strands every Fill key of the previous project. So switching between large Fill projects accumulates too. That is the same mechanism, and the same fix covers it.
- **Title correction.** The finding says the Map keeps "every traced image". It keeps the traced **vector** objects and their derived contours, not the source photo (a `raster-image` is never a pool member, and `traceSourceId` is only an id).
- **Scale per trace.** Scaling assumes retained bytes grow with output points, which is approximate, about ± 2×. The auditor's 0.148 MB is for the synthetic 1,200 × 900 drawing, which in Node traces (Line Art, the dialog default) to 7,797 polyline points and 183 curve segments. Scaled by output points:

  | Trace (Node, main) | Points + curve segments | × synthetic | Retained per stranded trace (est.) |
  |---|---|---|---|
  | Synthetic 1,200 × 900, Line Art | 7,980 | 1 | 0.15 MB (measured) |
  | Astronaut 512², Line Art / Smooth | 31,700 / 38,300 | 4.0 / 4.8 | 0.6–0.7 MB |
  | Astronaut 512², Colour layers / Photo shading | 106,000 / 163,000 | 13 / 20 | 2–3 MB |
  | 12 MP photo at the 2,048 px dialog edge, Line Art / Colour layers (S5 `tb5-time.jsonl`) | 80,400 / 380,000 | 10 / 48 | 1.5 / 7 MB |

- **An 8-hour day.**
  - Take one stranded trace every 5 minutes (about 100: traced, then undone, deleted or re-traced). That retains **15–70 MB** for line art and logos, and **0.2–0.7 GB** if every one is a dense photo preset at full dialog size.
  - The app idles at 0.38 GB and a 2,000-object job peaks at about 1.04 GB (this report). So only the dense-photo worst case approaches the 1.5 GB budget.
  - A V8 out-of-memory (the renderer heap cage is about 4 GB) would need about 500 or more dense photo traces in one session. On desktop, the renderer lives as long as the window, so a multi-day session adds up.
  - Nothing is lost on reload, and autosave and recovery exist (ADR-688).
- **Severity.** P3 stands. A P2 needs an ordinary operation over 3 × its budget, and P1 an OOM that loses work. Neither is reached by a day of ordinary tracing. It is the cheapest P3 here to fix, and the one that grows with the commonest beginner workflow.
- **Fix-direction caution.** "A fresh Map per `planPools` call" would make the two canvases that plan in turn (the reason `fill-pool-plan-cache.ts` keeps 2 slots) evict each other's keys. That would lose the drag-anchor fallback that `:245` exists for (S2-P2-3, ADR-683 Amendment 3). Pruning to the keys seen in the **last two** plans (or capping the Map) keeps the drag behaviour and still bounds memory. The guard the auditor proposes is right.

## Trend

Builds alternate within each round (order flipped every round); a ratio is the median of per-round ratios (`logs\anal-trend.txt`). Memory rows are medians of complete runs.

| Row | main | 1.0.28 | 1.0.23 | main / 1.0.28 | main / 1.0.23 | Verdict |
|---|---|---|---|---|---|---|
| Boot JS gzip (static) | 2,233 KiB | 2,122 | 2,043 | × 1.05 | × 1.09 | Growing, < 2 × (S9-P3-2) |
| First visit: workspace painted | 2,473 ms | 3,546 | 3,206 | × 0.92 | × 0.77 | Flat or faster |
| Cached visit: workspace painted | 2,263–2,549 ms | 2,596–2,749 | 2,441–3,705 | × 0.87–0.93 | × 0.69–0.95 | Flat or faster |
| Input released (first / cached) | 7,050 / 6,808–7,142 ms | 7,470 / 6,966–7,181 | 7,814 / 6,517–7,198 | × 0.94–1.02 | × 0.90–1.04 | Flat (the hold dominates) |
| Longest task before release | 619–679 ms | 801–859 | 760–828 | × 0.81–0.90 | × 0.73–0.90 | Flat or better |
| At rest: heap / nodes / listeners / workers | 17 MB / 1,495 / 429 / 0 | 16 / 1,488 / 427 / 0 | 16 / 1,487 / 426 / 0 | — | — | Flat |
| 2,000 objects: peak Chrome private | 1,037 MB | 1,276 | 1,318 | × 0.81 | × 0.79 | Better |
| 2,000 objects: heap retained after Abort | 83 MB | 155–157 | 155–158 | × 0.53 | × 0.53 | Better |
| Heap growth per trace cycle | 0.15 MB | not measured | not measured | — | — | Introduced 2026-11-03 (#1551), after both releases (S9-P3-3) |

Nothing is two or more times slower than 1.0.23. The startup paint and the memory rows improved.

## KNOWN re-observed

1. **The startup payload is over PROJECT.md's 1 MB compressed target** (speed audit 2026-10-14, item 6; still listed as a remaining priority in `2026-10-14-speed-fixes.md`). Re-observed and larger. The four big chunks, gzip bytes:

   | Chunk | 2026-10-14 (after fixes: 1,917,675 in all) | 1.0.23 | 1.0.28 | main |
   |---|---|---|---|---|
   | `ui-workbench` | 735,226 | 761,285 | 783,575 | 815,848 (+11%) |
   | `core` | 481,878 | 531,077 | 564,988 | 584,225 (+21%) |
   | `main` | 394,234 | 477,073 | 494,208 | 504,589 (+28%) |
   | `io` | 217,349 | 219,555 | 226,851 | 230,295 (+6%) |

   S9-P3-2 adds what that item did not cover: there is no guard, and the growth.

   **Refuter (2026-11-06): CONFIRMED.** `PROJECT.md:679` reads "Web bundle target: < 1 MB compressed". `2026-10-14-speed-fixes.md:75` gives 1,917,675 gzip bytes and calls it "well above the 1 MB JavaScript target". The static re-run gives the same per-chunk ordering on S8's build: `ui-workbench` 795, `core` 570, `main` 493 and `io` 225 KiB gzip.
2. **S1-P2-2 / S4 Start preparation** blocks are visible in the 2,000-object Start rows (main 630 / 542 / 484 ms under 4.4 × load; 1.0.23 2,427 / 2,087 / 1,650 ms). Fixed by #1575 for the large jobs S1 measured; not re-raised.

   **Refuter (2026-11-06): CONFIRMED** (READ of `logs\peak-anal.txt`). The three longest Start tasks are 611–764 ms on main and 1,491–3,197 ms on the releases, in the complete runs. LEDGER marks S1-P2-2 fixed by #1575. Not re-raised.

## Refuted

1. **"Startup creates workers it does not need."** No worker is constructed before input is released, in any build (the `Worker` constructor is wrapped before the page loads; `workersMade` 0 in all 45 kept loads), and none is alive 3 s later. The serial worker starts on Connect.
2. **"Task workers are not retired."** In the hour, 767 workers were made and 767 terminated; one stays alive between cycles (`workersLive` 1, occasionally 2 while one retires).
3. **"Detached canvases accumulate."** 4–6 canvases out of the document survive GC at every sample, from cycle 0 to cycle 97, with no trend (slope 0.002 per cycle); `OffscreenCanvas` and `ImageBitmap` stay at 0.
4. **"Listeners leak through dialogs."** 562 JS listeners after every cycle from cycle 0 (window 69, document 3), across 490 dialog openings.
5. **"Main uses more memory than the releases on a 2,000-object job."** It uses less (Trend).
6. **"The app crashes or loses work below 1 GB free."** Not seen in 98 leak cycles and 10 complete Start runs, many with under 300 MB free; the PC slowed, the app did not fail.

**Refuter (2026-11-06), all six: CONFIRMED (the leads stay refuted)**, from the auditor's raw results:
1. **Startup workers.** All 88 rows of `out\startup9.jsonl` carry `workersMade: []`.
2. **Workers retired.** `logs\leak-anal.txt` ends "workers made 767, terminated 767". `workersLive` is 1–2 in every cycle.
3. **Detached canvases.** The detached count is 3–6 from cycle 0 to 97, with no trend. This is consistent with the bounded raster store (`fill-pool-raster.ts:55-58`, 6 rasters, 12 MP) and the sprite LRU.
4. **Listeners.** There are 562 JS listeners in every row, with one 564 at cycle 40 that returned to 562.
5. **Memory against the releases.** In `logs\peak-anal.txt`, main's complete runs peak at 976–1,061 MB. Those runs include the smoke run (1,050 MB), so main has 3 timed runs plus the smoke run, not 4. The releases peak at 1,255–1,462 MB, and main retains 83 MB of heap against 155–158 MB. The verdict holds either way.
6. **Under 1 GB free.** `out\leak9.jsonl` has 0 page errors in 99 cycle rows and one watchdog row at 43 MB free. 85 of the cycle rows' free-memory samples were under 1 GB, and 27 under 300 MB (the report's 76 and 25 count a different sample per cycle). The conclusion is unchanged.

## Verified clean

- **At rest after start:** JS heap 17 MB after GC, 1,495 DOM nodes, 2 documents, 429 JS listeners, 0 workers, 3 canvases.
- **Cached visits download only about 600 bytes** (`index.html` revalidates to a 304; every `/assets/*` file comes from the immutable HTTP cache, 15 of 16 requests).
- **Lazy loading holds:** the 7.3 MB packing-solver WASM, HarfBuzz, 25 fonts, pdf.js, three.js and all 37 worker chunks stay out of the startup requests (16–18 requests before release).
- **The welcome window's first-visit cost** is one click; its "Download unavailable" note was the local server's missing download catalogue, not an app fault.
- **Desktop renderer exit:** `electron/renderer-crash-recovery.ts` offers "Reload KerfDesk" for every abnormal exit, including `oom` ("it ran out of memory"), and its text tells the operator that streaming stopped (ADR-482). Read only.

## Not verified

- **Desktop cold start** (the packaged app): no packaged build exists here, and the brief forbids installing or launching the installed app. From the code it cannot meet 3 s while the hold stands (S9-P3-1): `electron/main.ts` creates the window with `show: false`, reveals it when ready, and the renderer then holds input for 4 s of visible window plus a 0.75 s fade.
- **First visit with the service worker** (`sw-main` set): discarded, calibration drift 25% (169 → 211 ms). In it, the second visit transferred 2.3 MB again while the 13.4 MiB precache was still installing; whether a real first visit's background precache competes with the workspace download on a slow line needs a quiet re-run.
- **First visit over 20 Mbit/s, 40 ms** (`net20` set, CDP throttling): discarded, drift 80% (150 → 270 ms). Its medians were 4.0 s to paint and 7.7 s to release for main (1.0.28 4.7 / 8.5 s, 1.0.23 3.4 / 7.2 s): no sign of a difference beyond noise.
- **Idle absolute times.** Every timed row ran at 4.2–9 × the idle calibration. The idle estimates assume the CPU-bound spans scale with calibration; the 4.75 s hold does not scale.
- **A user's real hour.** The scripted cycle repeats one 1,200 × 900 trace; heavier traces would make S9-P3-3 grow faster per trace, and other Fill operations add their own keys. Not measured.

## Method correction: memory poller (S3–S8)

**Every memory poller from S3 to S8 summed every Chrome on the PC, not just the measuring one.** Not a product finding; for the coordinator and the refuters.
- **Cause.** Each driver starts `powershell -File mem-poll.ps1 --zz-sN-run=<pid>`. Under `-File`, an argument that starts with `-` does not bind to `param([string]$Marker)`: PowerShell 5.1 hands it to `$args` and leaves `$Marker` empty. `[regex]::Escape('')` then matches every command line, so `$roots` holds every Chrome browser process.
- **Proof** (`zz-s9`, 19:35): a two-line script printing `$Marker` and `$args` gives `marker=[] args=[--zz-s4-run=55]` when called that way, and `marker=[--zz-s4-run=55]` when called with `-Marker --zz-s4-run=55`. The broken call listed 5 browser processes and 36 processes in all for one measuring Chrome.
- **Where:** the `spawn('powershell', [..., '-File', ..., 'mem-poll.ps1', marker])` line of `zz-s3\run.mjs:43`, `zz-s3\zz-s3-probe-*.mjs`, `zz-s4\run.mjs:36`, `zz-s4\start\start-run.mjs:26`, `zz-s5\run4.mjs` / `run5.mjs`, `zz-s5r\…`, `zz-s6\run6.mjs:42`, `zz-s6r\…`, `zz-s7\run7.mjs:49`, `zz-s7r\…` and `zz-s8\run8.mjs:52`; each area's `mem-poll.ps1` has the same `param` block.
- **Effect.** The "Chrome", "renderer" and "GPU" columns in S3–S8 include whatever other Chrome ran at the time: other sessions' Playwright Chromes and the maintainer's own browser. The free-memory column is unaffected, and so are the V8 heap figures (`performance.memory`, `Runtime.getHeapUsage`). How much a figure is inflated depends on the hour: at 21:57 two other automation Chromes held 293 and 906 MB (`chromeroots9.ps1`). Where an area also recorded a heap, a free-memory collapse or a heap-capped control (S3-P2-3, S4-P2-2), the finding does not rest on the poller alone.
- **S9 uses the fixed call** (`'-Marker', marker`), and `zz-s9\mem-poll.ps1` now throws on an empty marker. On this PC the app alone idles at about 0.38 GB of Chrome private bytes (`logs\memprobe-790.txt`: browser 46, renderer 77 + 44 + 15, GPU 167, utilities 34 MB), against 0.55 GB reported for S4's 200-object rows.
- **Suggested action:** re-read the S3–S8 memory rows as upper bounds, and re-measure any row whose verdict depends on the 1.5 GB budget (S4's 5,000-circle Preview 1.48 GB and SVG 50,000 1.66 GB; S5's 1.47–2.20 GB inside Image Studio) with the fixed poller.

**Refuter (2026-11-06): the cause is CONFIRMED; the effect is NARROWED. Only S3 is materially affected, and no ledgered verdict changes.**

**Cause, re-proved** (`zz-s9r\bind9r.ps1`, `out\bind9r.txt`). On this PC's Windows PowerShell 5.1, a two-line script with `param([string]$Marker)` behaves as the auditor says:
- `powershell -File bind9r.ps1 --zz-s4-run=55` gives `marker=[] args=[--zz-s4-run=55]`, and `[regex]::Escape('')` matches `"anything"` (`True`).
- With `-Marker --zz-s4-run=55` the marker binds and the match is `False`.

**Every driver has the slip.** The spawn line passes the marker positionally in each of these:
- `zz-s3\run.mjs:43`, `zz-s3\zz-s3-probe-imgautosave.mjs:12` and `zz-s3-probe-workermem.mjs:13`;
- `zz-s4\run.mjs:36` and `zz-s4\start\start-run.mjs:26`;
- `zz-s5\run4.mjs:37` / `run5.mjs:39` and `zz-s5r\` (same lines);
- `zz-s6\run6.mjs:42`, `zz-s6r\run6.mjs:42`, `zz-s7\run7.mjs:49`, `zz-s7r\run7r.mjs:49` and `zz-s8\run8.mjs:52`.

The auditor missed one: the S4 refuter's poller **`zz-s4r\r.mjs:31`** with `mempoll.ps1`, whose `-like "*$Marker*"` becomes `"**"` and also matches everything.

**But the sum only includes other Chromes when other Chromes ran.** Every `runset.sh` logs `chrome=@(Get-Process chrome).Count`, the PC-wide `chrome.exe` count, just before the measuring Chrome starts and just after it closes. I paired them per set (`zz-s9r\chromebracket9r.mjs`, `out\chromebracket9r.txt`). A set with 0 before and 0 after had no other Chrome at either end, so the broken sum was that set's own Chrome. From S5 on, each area's strict gate also refused to start while any other Chrome root ran (`gate.ps1:16`).

| Area | Sets bracketed | 0 / 0 (clean) | Other Chrome seen |
|---|---|---|---|
| S3 | 98 | **0** | **98** (9–17 other `chrome.exe` at every set: a browser that stayed open all session) |
| S4 auditor | 77 | 77 | 0 (the one `chrome=1` start, `M-line-5000` at 23:50, was SKIPPED and re-run clean at 01:51) |
| S4 refuter (`state.ps1`) | 17 | 17 | 0 |
| S5 auditor | 18 | 12 | 6: the 1,024 / 512 / 400 px trace-dialog rows `M-tr-arch`, `M-tr-astro#2`, `T23-tr-astro#2`, `M-fb-astro400`, `T28-fb-astro400(#2)` (all "Pass" rows at 0.55–0.84 GB) |
| S5 refuter | 25 | 25 | 0 (the one dirty start, `R-st-p12`, was SKIPPED) |
| S6 auditor | 69 | 67 | 2: `T23-weld-ov2000`, `T23-off-r100` (1.0.23 trend rows; the report notes the Image Studio fix session's Chromes 22:00–22:17) |
| S6 refuter | 10 | 10 | 0 |
| S7 auditor | 27 | 27 | 0 |
| S8 | no bracketed browser set | — | S8's report itself notes Playwright e2e Chromes (1–4 roots) during its smoke runs |

A Chrome that came and went entirely inside a clean set would not show, but the gates and short sets make that unlikely.

**Ledgered findings that use Chrome or renderer memory, and whether a verdict changes:**
- **S3-P2-3** (fixed: #1562, #1565, #1572). This is the only finding measured beside another Chrome, so its absolute peaks are upper bounds. **Verdict unchanged:**
  - the 4-photo renderer fell by 7.1 GB within 2 s of the preparation worker ending (139.3 → 141.3 s), which another browser cannot do;
  - free physical memory fell to 0.51–0.76 GB (one photo) and 27 MB (four photos), which the poller does not affect;
  - S4's clean-bracketed runs measure the same pipeline (bed photo Frame at 5.7–7.7 GB).
  - So 4 photos stay at 3 × or more of the 1.5 GB budget even after removing a whole extra browser.
- **S4-P2-2** (fixed by #1572). The auditor's `SM-img100` sets and the refuter's `H-bed`, `H-bed-cap` and `G-img100` sets are all 0 / 0. **Unaffected.**
- **S5-P2-1** (fixed by #1578). The ledger's memory note (Chrome 1.47–2.20 GB inside Image Studio) comes from the refuter's `R-st-p12#2`, `R-st-b4k` and `R28/R23-st-p12` (all 0 / 0). **Unaffected.** The auditor's own Image Studio rows (1.01 → 1.66 GB) have no bracket line in `zz-s5\machine-state.log`, so I could not check them, but the refuter's clean runs agree with them. The P2 rests on the UI block anyway.
- **S5-P3-3.** The 1.67–1.95 GB at commit comes from `R-tr-p12(#2)` and `R-tr-b4k(#2)` (0 / 0). **Unaffected.**
- **S6-P3-3.** The 1.5–1.6 GB comes from `M-opt-n2000` and `R-opt-n2000(#2)` (0 / 0). **Unaffected.**
- **S7-P2-1.** The 2.17–2.20 GB at 1,000 badges comes from an S7 browser set (`M-var-serial1000` and its siblings are 0 / 0, as are all 27 S7 sets). **Unaffected**, and the P2 rests on the freeze.
- **S1-P3-1** (renderer memory per G-code line, re-observed in S4). This uses S4's clean sets. **Unaffected.**
- **Not ledgered:** S8's "Chrome 1.8–2.4 GB" for relief and rest pockets in the browser (Not verified there) ran beside Playwright Chromes. It is very likely inflated and should not be quoted.

**So the auditor's suggested re-measurements are not needed.** S4's 5,000-circle 1.48 GB (`M-line-5000` at 01:51), SVG 50,000 1.66 GB (`M-svg50k`) and S5's Image Studio 1.47–2.20 GB were all measured with no other Chrome on the PC.

**One wording is wrong.** "Against 0.55 GB reported for S4's 200-object rows" implies inflation. Those S4 sets were 0 / 0, so the difference from the 0.38 GB empty-app idle is the loaded project and Preview, not other Chromes. Read S3's memory columns as upper bounds. Read S4–S7's as correct within the bracket's limits.

## Refuter summary

**Refuter, 2026-11-06, 01:10–02:00 +0800.**
- **Tree:** origin/main `87f0ec583`, fetched at 01:12; it has not moved since the audit. No cited file changed. Every cited line was re-read with `git show origin/main:<path>` and matches. The `j7-main` trace sources used for the Node bundle are the auditor's refreshed copy of that tree.
- **Machine:** still loaded. Free memory was 155–566 MB, load 72–100 %, and other sessions' tooling and Chromes were running.
  - No browser set and no timing set was run.
  - Re-measured here: static bundle sizes, PowerShell argument binding, the logged Chrome counts, and trace output sizes in Node. None of these depends on load.
  - No other session's process was stopped.

**Verdicts:**

| ID | Verdict | Severity | Basis |
|---|---|---|---|
| S9-P3-1 | CONFIRMED | P3 (maintainer decision) | READ: `startup-splash.ts:1-3,43-44,94`, ADR-049 Amd 2's "four visible seconds" and "750 ms". Reduced motion still holds 4.0 s |
| S9-P3-2 | CONFIRMED | P3 | Static re-run of `static9.mjs`: releases reproduce exactly (2,122 / 2,043 KiB). Main's boot closure grew 2,186 → 2,231 KiB across the S1–S8 builds (+2.1 % in four days). Linkedom, saxes, tiff and fflate are in the boot `io` chunk by source map. No guard anywhere |
| S9-P3-3 | CONFIRMED | P3 | READ: no delete or clear on `lastGroups`, and stranded objects keep their WeakMap-cached contours alive. Scale per trace: 0.6–0.7 MB for a photo in Line Art, 2–7 MB for dense photo presets. A heavy day is 15–70 MB (line art) to 0.2–0.7 GB (dense photos), so not P2. Also strands every Fill key on File > New / Open. Fix caution: prune to the last two plans, not one |
| KNOWN 1, 2 | CONFIRMED | — | `PROJECT.md:679`; `logs\peak-anal.txt` |
| Auditor's 6 refuted leads | CONFIRMED | — | Raw results re-read. Lead 5's main peak includes the smoke run (3 timed runs + 1 smoke) |
| Method correction | CAUSE CONFIRMED, EFFECT NARROWED | not counted | Binding re-proved. Also in `zz-s4r\r.mjs:31`. But S4, S4r, S5r, S6r and S7 ran every bracketed set with no other Chrome. Only S3 (98 of 98 sets) and 8 non-finding rows in S5 and S6 did, plus S8's unledgered smoke runs |

**Earlier findings and the memory correction.** S3-P2-3 is the only ledgered finding measured beside another Chrome. Its verdict stands on the 7.1 GB drop when the worker ended and on the free-memory collapse, and it is fixed. The following were all measured with no other Chrome, so their memory figures stand:
- S4-P2-2;
- the memory notes in S5-P2-1, S5-P3-3, S6-P3-3 and S7-P2-1;
- S1-P3-1 as re-observed in S4;
- S4's 1.48 GB and 1.66 GB rows.

**No ledgered verdict changes,** and the re-measurements the auditor suggested are not needed.

**Refuter files** (`scratchpad\zz-s9r\`):
- scripts: `build-engine9r.mjs`, `trace-size9r.mjs`, `shape9r.mjs`, `static9r.mjs`, `bind9r.ps1`, `chromebracket9r.mjs`;
- results: `trace-size9r.jsonl`, `out\static9r.txt`, `out\static9r.json`, `out\boot-deps9r.txt`, `out\bind9r.txt`, `out\chromebracket9r.txt`.
- `engine-main9r.mjs` (the 0.7 MB bundle) was deleted; `node build-engine9r.mjs` remakes it.

## Re-running

From `scratchpad\zz-s9`. Never delete `j7-main` or anything under it recursively; its `node_modules` is a junction.
- **Tree:** regenerate `main-tree.tsv` with `git ls-tree -r origin/main -- src public scripts electron e2e index.html package.json pnpm-lock.yaml tsconfig.json vite.config.ts vitest.config.ts`, then `node refresh9.mjs` (lists differing files) and `--write`.
- **Build:** `./buildmain9.sh` (waits for 2 GB free; writes `dist-main` with hidden maps, about 16 minutes on this PC).
- **Static (no quiet PC needed):** `node static9.mjs main=dist-main r28=../zz-s1/dist-33bc394c6 r23=../zz-s1/dist-87ecb4f24` and `node depmap9.mjs dist-main "^(<boot files from out/static9.json>)$" 40`.
- **Hosts:** `node host9.mjs dist-main 4801`, `… ../zz-s1/dist-33bc394c6 4802`, `… ../zz-s1/dist-87ecb4f24 4803` (startup and leak); `cd start && node host.mjs ../dist-main 4805` (and 4806, 4807 for the releases) for the Start runs.
- **Startup (S9-P3-1, trend):** `node startup9.mjs '{"label":"trend","builds":{"main":"http://127.0.0.1:4801/","r28":"http://127.0.0.1:4802/","r23":"http://127.0.0.1:4803/"},"rounds":6,"sw":"block"}'`, then `node anal9.mjs out/startup9.jsonl trend`. Service worker: `"sw":"allow"` with main only; throttled first visit: `"kinds":["first"],"net":{"down":20,"up":5,"rtt":40}`. On a quiet PC the "painted" column should read about 0.5–0.6 s and "released" about 5 s.
- **Leak (S9-P3-3):** `node leak9.mjs '{"label":"leak-main","base":"http://127.0.0.1:4801/","cycles":400,"untilMs":3600000,"freeFloorMb":60,"watchdogCloses":false}'` (one hour), then `node leakanal9.mjs out/leak9.jsonl leak-main`. Snapshots: `node leak9-snap.mjs '{…,"cycles":35,"snapAt":[4,34],"out":"out/leak9-snap.jsonl"}'`, then `node snapdiff9.mjs snap-…-4.heapsnapshot snap-…-34.heapsnapshot`, `DEPTH=20000 node --max-old-space-size=6144 retainers9b.mjs <a> <b> Object 300`, `node chain9.mjs <b> <id>`, `node mapsize9.mjs <snap> <Map id>`. The snapshots (70–90 MB each) were deleted.
- **Peak memory:** `./peak9.sh peak-main-N 4805 "$PWD/projects/main-mix-2000.lf2" 5` (and the release projects on 4806 / 4807), then `node peakanal9.mjs`. Projects are remade by `node ../zz-s4/gen.mjs <tree> projects/<name>.lf2 '{"scene":"mix","n":2000}'` with `j7-main` or the `zz-s2-old` trees.
- **Memory poller:** always pass `-Marker` (see Method correction). `memprobe9.mjs <base>` lists one Chrome's processes by type; `chromeroots9.ps1` lists every Chrome on the PC.
- **Queues:** `queue9.sh trend peak sw net leak`, `queue9b.sh`, `queue9c.sh` with `gate9.ps1` / `waitgate9.sh` (strict gate for `$1` s, then the relaxed one). Restore the strict gate's role on a quiet PC by passing a large limit, e.g. `GATE_S=36000`.

```json
{
  "area": "S9-startup-memory",
  "tree": "87f0ec583",
  "builds": { "main": "zz-s9/dist-main (87f0ec583, hidden maps, Free web build; deleted after use)", "trend": ["1.0.28 33bc394c6 (zz-s1/dist-33bc394c6)", "1.0.23 87ecb4f24 (zz-s1/dist-87ecb4f24)"], "desktop": "none packaged; not measured" },
  "counts": { "raised": 3, "refuted_leads": 6, "P1": 0, "P2": 0, "P3": 3, "known": 2, "method_correction_not_counted": 1 },
  "budgets": { "desktop_cold_start_s": 3, "web_cached_s": 3, "peak_memory_gb": 1.5, "design_block_ms": 200 },
  "machine": "no quiet window 19:04-00:26: 486 samples, free 4-2,770 MB (median 470), load median 100%, other tooling 0-20; strict gate never passed; relaxed gate >= 800 MB free one pass from 20:19; calibration 150-337 ms (idle 36); timed rows are alternating-build ratios; sw and net sets discarded for drift 25% and 80%",
  "startup_main_loaded_ms": { "calibration": "153 -> 165", "first": { "fcp": 1063, "main_chunk": 608, "painted": 2473, "welcome": 3173, "released": 7050, "longest_task": 619 }, "cached": { "painted": "2263-2549", "released": "6808-7142", "hold_after_paint": "4193-4797" }, "idle_estimate_s": { "painted_cached": "0.5-0.6", "released_cached": "5.0-5.3" } },
  "trend_ratios_main_over": { "r28": { "painted": "0.87-0.93", "released": "0.94-1.02" }, "r23": { "painted": "0.69-0.95", "released": "0.90-1.04" } },
  "bundle": { "boot_js_gzip_kib": { "main": 2233, "r28": 2122, "r23": 2043, "speed_fixes_2026_10_14": 1873 }, "boot_js_raw_kib": 7052, "chunks_over_750kB": ["ui-workbench 2654 kB", "core 1723 kB", "main 1621 kB"], "lazy_js": { "files": 118, "kib": 11764 }, "worker_chunks": 37, "precache": { "entries": 422, "raw_mib": 35.0, "gzip_mib": 13.4 }, "boot_top": { "src/ui/laser": 910, "src/ui/state": 854, "src/ui/workspace": 347, "npm:linkedom": 169, "npm:react-dom": 127 } },
  "at_rest": { "heap_mb": 17, "dom_nodes": 1495, "js_listeners": 429, "workers": 0 },
  "leak_session": { "cycles": 98, "minutes": 60, "heap_mb": "27.0 -> 44.1", "heap_slope_mb_per_cycle": 0.148, "nodes": "1563 -> 1564", "listeners": 562, "workers_made": 767, "workers_terminated": 767, "detached_canvases": "4-6, no trend", "cause": "fill-pools.ts:255 lastGroups Map: 5 keys after cycle 4, 35 after cycle 34" },
  "peak_2000_objects_mb": { "main": { "runs": 4, "range": "976-1061", "median": 1037, "retained_heap": 83 }, "r28": { "runs": 3, "range": "1255-1462", "median": 1276, "retained_heap": "155-157" }, "r23": { "runs": 3, "range": "1312-1447", "median": 1318, "retained_heap": "155-158" } },
  "under_1gb_free": "app slowed only; 0 page errors, no renderer crash in 98 cycles and 10 Start runs at 19-300 MB free; no web low-memory handling; desktop reload offer on renderer oom (ADR-482)",
  "findings": [
    { "id": "S9-P3-1", "title": "Startup screen holds input >= 4.75 s after the workspace module starts (ADR-049 Amd 2); web cached and desktop miss 3 s by design", "where": "src/ui/app/startup-splash.ts:1-3,94", "budget": "3 s usable canvas", "decision": "maintainer" },
    { "id": "S9-P3-2", "title": "No guard on boot download: 2,233 KiB gzip, +9% since 1.0.23, +19% since 2026-10-14; three boot chunks over the 750 kB warning", "where": "vite.config.ts manualChunks/chunkSizeWarningLimit; src/io/svg/index.ts:9; src/io/xml/index.ts:2-7", "budget": "PROJECT.md 1 MB; first stop growth" },
    { "id": "S9-P3-3", "title": "Fill-pool lastGroups Map keeps every traced object/Fill operation for the session: +0.15 MB heap per trace cycle", "where": "src/ui/workspace/fill-pools.ts:255 (added ff1924ccc, #1551)", "budget": "heap slope ~0 per cycle" }
  ],
  "refuter": { "date": "2026-11-06", "tree": "87f0ec583 (origin/main unmoved; no cited file changed)", "confirmed": ["S9-P3-1", "S9-P3-2", "S9-P3-3"], "refuted": [], "severity_changes": [], "new": [], "counts": { "P1": 0, "P2": 0, "P3": 3, "known": 2 }, "remeasured": "static boot closure of the S1-S8 main builds and both releases (releases reproduce 2122/2043 KiB; main 2186 -> 2231 KiB over the audit); PowerShell -File binding; logged chrome.exe counts around every runset set; trace output sizes in Node", "s9_p3_3_scale": "0.15 MB synthetic line art; 0.6-0.7 MB per 512 px photo Line Art; 2-7 MB per dense photo preset; 8 h day 15-70 MB (line art) to 0.2-0.7 GB (dense photos); P3 kept", "method_correction": "cause confirmed (also zz-s4r/r.mjs:31); effect limited to S3 (98/98 sets beside other Chrome) and 8 non-finding S5/S6 rows plus S8 smoke; S4, S4r, S5r, S6r, S7 clean; no ledgered verdict changes; suggested re-measurements not needed" }
}
```
