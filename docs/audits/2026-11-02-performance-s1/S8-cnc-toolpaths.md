# Performance audit S1 — S8 CNC toolpaths

- **When:** 2026-11-05 12:51 – 18:30 +0800 (engine sets 14:51 – 17:45; reading, profiles and the report around them).
- **Tree:** origin/main @ `790b95c4a` (worktree `claude/performance-audit-s7`, HEAD `4472089e5`, docs only). origin/main moved to `87f0ec583` during the audit; `git diff --stat 790b95c4a 87f0ec583` touches no CNC, relief, offset, G-code or preflight file (only laser raster preview files and 7 lines of `gcode-inspection-source.ts`), so every cited line is the same on `87f0ec583`.
  - **`j7-main` refreshed.** Every file under `src`, `public`, `scripts`, `electron`, `e2e` and the root build files was compared with `origin/main` by git blob hash (`zz-s8\refresh8.mjs`). 278 differed or were missing (67 outside `e2e`, none of them CNC code) and were rewritten from `git show origin/main:<path>`, then re-checked: 0 differ.
  - **`j7-main\node_modules` was missing** (the junction S6 and S7 used was gone). I re-created it as a junction to the main checkout's `node_modules`, whose `pnpm-lock.yaml` equals origin/main's.
  - **Browser build, main:** `zz-s8\dist-main`, built from `j7-main` with `vite build --sourcemap hidden` and `zz-s8\zz-s8-vite.config.mts` (S7's config). Free web build: V-carve, relief and adaptive clearing are Pro tools to *start*, but a project that holds them prepares and previews in Free (`pro-features.ts`), so no desktop-mode build was needed.
  - **Engine (Node):** `build8.mjs` bundles each tree's CNC entry points with esbuild 0.28.1, as `scripts/trace-bench.mjs` does: `prepareOutput`, `emitPreparedGcode`, `serializeProject` / `deserializeProject`, the leader fixture helpers (`benchmarkProject`, `benchmarkLayer`, `benchmarkVector`), `createReliefHeightfield`, `resolveAdaptivePocketOperation`, `findCncAdaptivePocketIssues`, `textToPolylines`.
  - **Trend:** 1.0.28 (`33bc394c6`) and 1.0.23 (`87ecb4f24`): the `src` trees in `scratchpad\zz-s2-old\`, and S1's `dist-33bc394c6` / `dist-87ecb4f24` for the browser.
- **Machine state:** i7-1260P (12 cores, 16 threads), 16 GB, Iris Xe; Chrome 156 (installed, headless); Node 25.8.2. `zz-s8\machine-state.log` holds every set's free memory, load and waits; `zz-s8\sampler.log` a line every 30–70 s (570 lines; under this load the 30 s loop slipped).
  - **There was no quiet window all afternoon (12:51–18:21).** Other sessions ran throughout: vitest suites (up to 10 tooling processes), Playwright e2e runs with their own Chrome (1–4 roots), the trace round's timing harness `tb5.mjs`, and vite dev servers. Free memory ranged from 4 MB to 3.4 GB (median about 1.4 GB); at 18:14 the PC had 12 MB free, 489 MB available and 89% of its commit in use. Load sat at 60–100%.
  - **The strict gate** (S7's: no other tooling, harness or Chrome, load < 45%, ≥ 2.5 GB free, three times 20 s apart) never passed between 13:33 and 14:38. From 14:38 the engine queue used a relaxed gate (`gate-e.ps1`): first no other tooling and ≥ 2 GB free, from 14:51 ≥ 1.2 GB free, from 15:40 memory only. Waits of 101–680 s are logged.
  - **Calibration** (S1's 40M-step loop, 36 ms on an idle PC) read **87–439 ms** before and after the engine sets, that is the PC ran 2.4–12 × slower than idle. So:
    - every engine number is an **alternating-tree ratio** (the trees run round by round in one process) or a **structural count** (calls, lines, hashes), and
    - absolute times are quoted as measured, with an **idle estimate** `ms × 36 / mean(calibration)`. These estimates are rough (about ± 50%); a refuter on a quiet PC should replace them.
  - **The browser queue never ran.** Its memory gate (2.5 GB, then 1.8 GB free) did not hold once from 17:45 to 18:21, when I stopped the queue. The only browser data are ungated smoke runs (functional, not data) at 13:54–14:00, before free memory collapsed. Three smoke runs (relief and rest-pocket projects) were closed by the harness watchdog at 360–449 MB free.
  - I stopped none of the other sessions' processes. My own incidents: two copies of the main build overlapped at 13:51 (the second was stopped at once; `dist-main` is the first, 13:33–13:51), and I stopped my own functional smoke runs at 13:33 and the `pocket-big` set after its round 1 (each call took 5–12 minutes).
  - **Memory figures:** engine rows give the process `maxRSS` and the heap retained by the prepared job. Browser smoke rows give the measuring Chrome's private bytes (S4's `mem-poll.ps1`), workers included.
- **Temp files:** none in the repo except this report. Kept for the refuter in `scratchpad\zz-s8\`:
  - scripts (`build8.mjs`, `buildmemo8.mjs`, `cases8.mjs`, `gen8.mjs`, `gt8.mjs`, `anal8.mjs`, `adsweep8.mjs`, `adload8.mjs`, `ademit8.mjs`, `projgen8.mjs`, `run8.mjs`, `mkq8.mjs`, `show8.mjs`, `page-init.js`, `cpu8.ps1`, gates, queues);
  - `out\gt8.jsonl` (engine), `out\prof.jsonl`, `out\smoke.jsonl`, `smoke.jsonl` (browser smoke), `machine-state.log`, `sampler.log`, `logs\`;
  - the CPU profiles in `prof\` (`rest-ord`, `pocket-ord`, `vcarve-ord`, `relief-sm`, `adaptsq-ord`, `adapt-40x40`);
  - `fixtures\letters-ord.json`, `fixtures\letters-big.json`, the engine bundles and `dist-main` with hidden maps.

  Deleted to save disk, and remade by "Re-running": the generated projects (`projects\`, 97 MB).
- **Scope** (AREAS S8, ordinary size first, then large):
  1. **Toolpaths** on an ordinary sign and a large one, 6 mm end mill unless stated. Text is Roboto Regular from main's `textToPolylines` (`gen8.mjs`), the same polylines for every tree:
     - **ordinary:** a 300 × 200 × 19 mm sign, "KERFDESK" (48 mm) and "Wood Signs" (30 mm), 24 contours and 2,395 points;
     - **large:** a 600 × 400 mm sign, a title and five lines (151 contours, 14,752 points).
     - Operations, each a project of its own (`cases8.mjs`):
       - **Profile:** letters cut Outside 6 mm deep (2 mm passes, default arc leads), plus the board cut out 19 mm deep with four tabs.
       - **Pocket:** the background between a 15 mm border and the letters, 3 mm deep, 40% stepover.
       - **Adaptive clearing:** the same background (falls back, see Also noticed); a plain 270 × 170 recess (`adaptr`); and a 60 × 60 square, which the planner accepts (`adaptsq`).
       - **Rest machining:** the background with a 2 mm end mill after the 6 mm one (`pocketRoughToolId`).
       - **V-carve:** the letters with a 12.7 mm 90° V-bit, 6 mm floor.
       - **Relief:** a 300 × 200 mm, 6 mm deep dome-and-ripple heightfield, roughed with the 6 mm end mill and finished with a 3.175 mm ball.
  2. **Height-field memory:** the relief from a 750 × 500 source (ordinary, 0.4 mm) and a 3000 × 2000 source (high, 0.1 mm).
  3. **The 3D views:** Cut 3D (Preview's 3D cut preview) and the G-code 3D canvas, orbit and pan (browser smoke only).
  4. **Cancel** reaching the worker: code reading only (the browser sets could not run).
  5. Trend against 1.0.28 and 1.0.23, with the G-code compared by SHA-256 before any speed comparison.
- **Counts (auditor):** 3 raised → **P1 0 / P2 0 / P3 3** (+ 0 KNOWN; + 1 functional bug for the coordinator, not counted: adaptive clearing refuses every non-square rectangle). The auditor refuted 4 leads.
- **Counts (refuter, 2026-11-05):** 3 raised + 1 raised by the refuter (S8-P2-1, the auditor's functional bug, corrected) → 0 refuted → **P1 0 / P2 1 / P3 3** (+ 0 KNOWN). 3 confirmed at their severity, 0 severity changes, 1 new. The auditor's 4 refuted leads stand (one with a corrected citation). See [Refuter summary](#refuter-summary).

## Headline

**Ordinary CNC toolpaths prepare in the workers, and their G-code has not changed since 1.0.28.**
- Every case gives one G-code hash in main and 1.0.28. 1.0.23 is identical too, except relief, whose output ADR-412 and its amendments changed.
- Idle estimates for the ordinary sign, measured under 2.4–8 × load:

  | Toolpath | Prepare | Emit |
  |---|---|---|
  | Profile | about 0.2 s | — |
  | V-carve | about 1.3 s | — |
  | Offset pocket | about 1.1 s | — |
  | Rest machining | about 3–4 s | about 1–3 s |
  | Relief | about 4 s | about 1.3 s |

- Pocket, V-carve, rest and relief always prepare in the preparation worker (`canvas-preparation-policy.ts:76-108`). Profile prepares there from 2,000 work units.
- No toolpath is slower than 1.0.23 by 2 × with the same output.

**Three P3. Each is time spent in a worker, with "Preparing preview…" showing and no progress.**
- **S8-P3-1. Rest machining plans its rest pocket three times per export, and adaptive clearing its plan and verification twice.**
  - The compile resolves the operation for the finishing passes and again for the roughing group. Emit's preflight resolves it once more, for its issue list.
  - On the ordinary sign's rest pocket (one process, calibration 252 → 168 ms), prepare plus emit took **39.6 s**. With a memo on the two resolve functions it took **11.2 s**, a factor of × 0.28, and the G-code is byte-identical.
  - Adaptive's emit falls from 6.4 s to 0.16 s, also identical.
  - Save G-code, Start and the G-code 3D view all emit, so they pay this.
- **S8-P3-2. Adaptive verification stamps the whole cutter disk at every half grid cell.**
  - Planning and verifying an ordinary 270 × 170 mm recess took 110–127 s under load, about 15–25 s on an idle PC. 97% of that is `verifyAdaptivePocket`.
  - Emit then repeats it (S8-P3-1). The result is refused anyway: see Also noticed.
- **S8-P3-3. An offset pocket on the large sign took 450 s under load (about 2.5–3 minutes idle).**
  - Each ring inflates the source contours by its full inset from scratch, so Clipper resolves ever larger overlapping island offsets. `inflatePathsD` is 95% of the profile.
  - The ordinary sign takes about 1 s. It is the same in 1.0.28 and 1.0.23, with identical G-code.

**Also noticed (functional, for the coordinator): adaptive clearing cannot clear a rectangle.**
- With the defaults, verification refuses every rectangle whose sides differ by more than about 5%. It refused 30 × 26, 40 × 20, 40 × 30, 60 × 40, 100 × 60 and 270 × 170 mm. It accepted 20 × 20, 30 × 29 to 30 × 31, 40 × 40 and 60 × 60 mm.
- Raising Radial engagement to 1.2, 1.8 or 2.4 mm (20–40%) does not help. Only the 50% cap (3 mm) is accepted, which is ordinary pocketing engagement.
- **Preview shows an offset pocket instead.** Save, Start and the G-code 3D view are blocked by the preflight issue "Offset pocket fallback: Adaptive verification simulated radial engagement above the configured limit."
- The same happens in 1.0.28 and 1.0.23.
- The ordinary sign's lettered background is refused for a different reason: "The selected bit does not fit one of the adaptive pockets".
- **Refuter (2026-11-05): corrected and raised as [S8-P2-1](#s8-p2-1).** Save and Start are **not** blocked. `cnc-adaptive-clearing-invalid` is not in `COMPILE_INTEGRITY_PREFLIGHT_CODES` (`src/core/preflight/blocking-codes.ts:32-48`), so Save writes the file and toasts afterwards, and Start lists the message as a warning. The program written is byte-identical to choosing Offset rings. The refusal is not a sampling artefact. ADR-154 Amendment 3 records it: a single entry helix cannot open a pocket longer than it is wide. On top of that, an entry tie-break refuses near-squares that a centred entry would pass.

**Height-field memory is bounded.**
- The CAM heightmap is always resampled to 0.2 mm cells (`heightmap.ts:36`), so a 3000 × 2000 source compiles in about the same time as a 750 × 500 one, at a Node `maxRSS` of 534–552 MB.
- What the source size does change is the project: 16 MB against 1 MB.

**Not measured, because the browser queue never ran:** UI blocks, frame rates and Cancel in the app. The smoke runs, all at 3–4.7 × load, saw:
- a 614 ms task when leaving Preview, a 312 ms task on the first G-code 3D orbit move, 774 ms on opening, and 230 ms after a nudge;
- Cut 3D drawing each orbit step in 25–31 ms in its worker, with no main-thread task.

These are listed under Not verified with the commands to re-run them.

## Scorecard

Budgets (AREAS): 100 ms from input to visible response; a 200 ms longest UI block while designing, or a progress indicator and Cancel if the work can take longer; 1.5 GB peak memory. AREAS sets no budget for the toolpath compile itself, which runs in a worker; S4 judged Preview against 8 s on a 2,000-object project, and that is used here as the reference for "time to toolpath".

Column meanings:
- **Prepare** is `prepareOutput`, the whole compile the preparation worker runs, on one thread here.
- **Emit** is `emitPreparedGcode`, which Save, Start and the G-code 3D view add.
- Each figure is the median (range) of kept rounds; round 0 is dropped.
- **"Idle est."** is the median × 36 ms / mean calibration of the set.
- **"Mem"** is the process `maxRSS` of the set (all trees in one process) and the heap retained by one prepared job.

### Engine (Node; main; `out\gt8.jsonl`)

| Toolpath, input | Prepare (loaded) | Emit (loaded) | Cal (ms) | Idle est. | Mem | G-code | Budget | Verdict |
|---|---|---|---|---|---|---|---|---|
| Profile, ordinary sign (`prof-ord`, n=5) | 900 (688–1,451) | 180 | 228 → 137 | 0.18 s | 232 MB; 16 MB | 4,821 lines | 8 s (worker) | Pass |
| V-carve, ordinary (`vcarve-ord`, n=5) | 8,034 (4,625–9,953) | 262 | 239 → 217 | 1.3 s | 288 MB; 74 MB | 9,665 lines | 8 s | Pass |
| Offset pocket, ordinary background (`pocket-ord`, n=4) | 6,008 (5,542–8,281) | 174 | 193 → 214 | 1.1 s | 234 MB; 23 MB | 8,948 lines | 8 s | Pass |
| Adaptive, 60 × 60 square (`adaptsq-ord`, n=4+3) | 5,764 / 6,274 | **10,038 / 6,358** | 110 → 87; 148 → 148 | 1.5–2 s + emit 1.5–2.5 s | 238 MB | 14,080 lines | 8 s | Pass; emit repeats the plan (**S8-P3-1**) |
| **Adaptive, 270 × 170 recess** (`adaptr-ord`, n=1; issue-only call in `dbg8.mjs` 110 s) | **126,649** | **111,391** | 290 → 347 | **14–25 s + 13 s** | 229 MB | refused at emit | 8 s | **S8-P3-2** (2–3 ×), then refused (Also noticed) |
| Adaptive, lettered background (`adaptf`, `dbg8.mjs`) | 0.4–1.2 s to refuse | — | ~150 | < 0.3 s | — | offset fallback | | Refused: "bit does not fit one of the adaptive pockets" |
| **Rest machining**, ordinary (`rest-ord`, n=3, two sets) | 14,060 / 23,041 | 4,527 / **16,580** | 176 → 161; 252 → 168 | 3–4 s + 1–3 s | 254 MB; 37–68 MB | 21,057 lines | 8 s | Within the reference, but **3 ×** the needed planning (**S8-P3-1**) |
| Relief, 750 × 500 source (`relief-ord`, n=2) | 22,046 (22,046–35,141) | 7,178 | 265 → 138 | 3.9 s + 1.3 s | 631 MB; 165 MB | 378,596 lines | 8 s; 1.5 GB | Pass |
| **Relief, 3000 × 2000 source** (`relief-hi`, n=1) | 18,989 | 2,212 | 141 → 117 | 5.3 s + 0.6 s | **534 MB** (main alone); 112 MB | 263,164 lines | 1.5 GB | Pass: the CAM grid is 0.2 mm whatever the source |
| Profile, large sign (`prof-big`, n=2) | 3,755 (3,755–10,498) | 201 | 439 → 137 | 0.5–1.3 s | 289 MB | 14,910 lines | 8 s | Pass |
| V-carve, large (`vcarve-big`, n=2) | 12,728 (12,728–14,376) | 269 | 94 → 112 | 4.4 s | 356 MB; 80 MB | 34,677 lines | 8 s | Pass |
| **Offset pocket, large background** (`pocket-big`, n=1 + round 0) | **454,394** (round 0: 424,415) | 781 | 89 → (stopped) | **≈ 150–180 s** | 357 MB; 100 MB | 37,701 lines | 8 s | **S8-P3-3** (large size) |

### Prototype (one process, alternating; `out\gt8.jsonl`, sets `rest-ord main,memo` and `adaptsq-ord main,memo`)

| Case | main prepare + emit | memo prepare + emit | Ratio | G-code |
|---|---|---|---|---|
| Rest, ordinary (cal 252 → 168) | 23,041 + 16,580 = **39.6 s** | 10,689 + 487 = **11.2 s** | **× 0.28** | `e7a79db4d03d5321` both |
| Adaptive 60 × 60 (cal 148 → 148) | 6,274 + 6,358 = 12.6 s | 6,220 + 157 = 6.4 s | × 0.51 | `fc59d8657723ea40` both |

### In the app (smoke only, not data; `smoke.jsonl`, `M-route-prof-ord`, calibration 111 → 168 ms)

| Step, ordinary profile sign | Shown | Longest block | Chrome | Budget | Verdict |
|---|---|---|---|---|---|
| Open | 669 ms | **774 ms** | 1.73 GB | 200 ms | Not verified (load; S3's area) |
| Nudge (select all, Arrow) | 41 ms | 230 ms | 1.68 GB | 200 ms | Not verified |
| Preview: route shown / 3D button ready | 154 ms / 3,543 ms | 93 ms | 1.41 GB | 100 ms; 200 ms | Not verified (worker) |
| Cut 3D open; orbit 30 steps | ready 1,886 ms; each step drawn in **25 (p50) / 31 (p95) ms**, 80 frames | 0 | 1.20–1.31 GB | 33 ms p95 | Not verified; looks clean |
| Leave Preview | 88 ms | **614 ms** | 1.27 GB | 200 ms | Not verified |
| G-code 3D open | 3,857 ms | 280 ms (6 tasks, 815 ms) | 1.36 GB | 200 ms | Not verified |
| G-code 3D orbit / pan, 40 / 30 moves | p50 33 / p95 37 ms; 33 / 35 ms | **312 ms** (first orbit move) / 0 | 1.29–1.33 GB | 33 ms p95 | Not verified |

Relief and rest-pocket smoke runs ended in the harness watchdog at 360–449 MB free, with Chrome at 1.8–2.4 GB. The PC itself had under 1 GB free then, so the figure is not attributed.

## Findings

### S8-P2-1

**Adaptive clearing on an ordinary rectangular pocket is silently replaced by Offset rings.** Raised by the refuter from the auditor's functional bug.
- **What fails.** With a 6 mm bit, every rectangle whose sides differ by 4 mm or more is refused at any engagement below the 50% cap.
- **What the operator sees:**
  - Preview shows the offset pocket and says nothing.
  - Save writes the Offset-rings program byte for byte, and only afterwards shows a toast.
  - Start lists the same message as a warning.
  - The message says to adjust Radial engagement, which cannot help.

- **Where:**
  - The refusal. One entry helix opens a disk of radius 1.75 r (`adaptive-pocket-sequences.ts:74-75`). The first ring cut is the innermost offset ring (`:85-91`, chain from the leaf). In a rectangle that ring is a thin loop of length L − W along the middle line, so beyond the helix disk it cuts a full slot. The verifier refuses that (`adaptive-pocket-verifier.ts:122-130`).
  - The entry. `maximumClearancePoint` keeps the first of equal-clearance grid points (`adaptive-pocket-entry.ts:58-67`, strict `>`). Every point on a thin leaf ring's middle line ties, so the helix goes at one end of the ring instead of its middle.
  - The fallback. The compile drops the adaptive passes (`adaptive-pocket-operation.ts:109-119` returns `null`) and cuts the layer as an offset pocket. The refusal is reported only by emit preflight (`cnc-adaptive-issues.ts:30-31` → `cnc-preflight.ts:148-152`, code `cnc-adaptive-clearing-invalid`). That code is not in `COMPILE_INTEGRITY_PREFLIGHT_CODES` (`blocking-codes.ts:32-48`), so Save (`save-preflight-policy.ts:18-24`, `prepare-gcode-save.ts:48`) and Start (`start-job-readiness.ts:335-336`) treat it as an advisory.
  - Disclosure:
    - Preview's banners (`preview-overlays.tsx:25-52`) have no kind for it, and `runCncPreflight` runs only at emit (`emit-gcode.ts:267`, `tile-emission.ts:91`).
    - Save's advisory is a notice pushed after `target.write` (`file-actions.ts:282-291`).
    - The layer panel says only "Unverified plans use a disclosed offset-pocket fallback" (`AdaptivePocketFields.tsx:32-37`).
    - The message's advice "Adjust Radial engagement or choose another fill method" comes from `cnc-preflight.ts:151`.
- **Evidence (REPRO, Node, main bundles from `j7-main` = origin/main for these files):**
  - **Prepare + emit** (`zz-s8r\emit-r.mjs`; the layer `benchmarkLayer` default, 6 mm end mill, 3 mm deep in 1.5 mm passes, 40% stepover, Radial engagement default 0.6 mm):

    | Rectangle | Preflight | Save split | G-code |
    |---|---|---|---|
    | 40 × 20 | `cnc-adaptive-clearing-invalid` | blocking 0, advisory 1 | `141a145c18dda7c8`, 62 lines, **identical to Offset rings** |
    | 100 × 60 | the same | blocking 0, advisory 1 | `10ede39e0b56073b`, 170 lines, identical to Offset rings |
    | 270 × 170 | the same | blocking 0, advisory 1 | `891b673353fb41e8`, 446 lines, identical to Offset rings |
    | 40 × 40 | none | — | `cc06816c27214137`, 8,628 lines, 12 arcs (real adaptive) |

  - **What is cut instead** (40 × 20, `zz-s8r\show-r.mjs`):
    - A straight plunge `G1 Z-1.500 F150` at the centre.
    - The first ring 4.4 mm wide, cut by a 6 mm bit at F600: a full-width slot.
    - Rings 2.4 mm apart (40% stepover).

    The operator chose a helical entry and 10% engagement.
  - **Where the engagement goes over the limit** (`zz-s8r\diag-r.mjs`, the verifier's own contact replayed without the grid; limit 0.6 mm + 0.354 mm allowance):

    | Rectangle | Side difference | main: largest engagement, where | Entry at the centre (experiment `eng-rc`) |
    |---|---|---|---|
    | 30 × 30, 100 × 98 | 0 / 2 mm | 0.50 / 0.53 mm, accepted | — / 0.30 mm |
    | 30 × 26, 100 × 96 | 4 mm | **2.69 / 2.72 mm on ring 0, refused** | **0.53 / 0.50 mm, accepted** |
    | 36 × 30, 100 × 94 | 6 mm | 3.0 / 3.0 mm on ring 0, refused | 1.70 / 1.63 mm, refused |
    | 30 × 22, 40 × 30, 40 × 20 | 8–20 mm | 3.0 mm on ring 0, refused | 2.7–3.0 mm, refused |

    - The refusal follows the absolute side difference, not the ratio: 100 × 98 passes and 100 × 96 does not.
    - Main's entry lands at one end of the innermost ring. On 30 × 26 it sits at (23, 23); the pocket's centre is (25, 23).
    - The 50% cap passes only because the kept allowance admits a full slot once the limit reaches about 41% of the diameter (ADR-154 Amendment 3, Consequences).
  - **Same in 1.0.28 and 1.0.23:** the auditor's `adload8.mjs`, 40 × 20.
- **Contract:**
  - ADR-154 Amendment 3 accepted the refusal of long pockets ("Pockets longer than they are wide are refused, correctly … Opening a long pocket within the limit needs another opening strategy … and its own decision"). So the refusal of rectangles 6 mm or more out of square is a decided limitation.
  - Three things are not covered by that decision:
    1. **The disclosure.** The ADR-154 core text says failures "block preflight instead of falling back silently". The code makes the fallback an advisory instead (ADR-228 rule 7), and Preview never shows it. CNC audit v1 F2-P3-2 found the same ADR drift for island adaptive and rest.
    2. **The advice.** No Radial engagement below the cap can open these pockets.
    3. **The tie-break.** It refuses rectangles 4 mm out of square that the planner's own geometry can open.
- **Severity: P2** (METHOD: "wrong behaviour an ordinary user will hit, with a misleading result").
  - A rectangle is the commonest pocket. Choosing the Pro tool for it yields Offset rings, and Preview gives no sign of it.
  - Not P1. The pocket's outline, depth, position and scale are exactly those of Offset rings, so no physical output is wrong in METHOD's sense. And the substitution is disclosed before the machine runs: Start's warning list, and Save's notice before the file is used.
  - The auditor's "Save, Start and the G-code 3D view are blocked" is incorrect for Save and Start. The G-code 3D view was not re-checked.
- **Fix direction:**
  - **Output-identical:**
    - Carry the fallback reason on the compiled job (S8-P3-1's fix carries the resolved operation anyway). Show it in Preview and beside the layer's Radial engagement field.
    - Name the cause in the message: the pocket is too long for a single adaptive entry; use Offset rings or split the pocket.
    - Stop verification at the first over-limit sample (S8-P3-2's refuter note).
  - **Burn changes, for the maintainer with an ADR amendment:**
    - Place the entry at the middle of a tied ridge. This opens rectangles up to about 4 mm out of square, and moves the entry of accepted pockets whose leaf ring has ties.
    - Add an opening strategy for long pockets, such as a slot along the medial line at reduced feed, or trochoidal opening.
  - **Test gap:** `adaptive-pocket-verifier.test.ts` checks rectangles only at the 50% cap. `compile-cnc-adaptive-simple-pockets.test.ts` keeps the 10 × 40 refusal.

### S8-P3-1 — Rest machining plans its rest pocket three times per export, and adaptive clearing plans and verifies twice: on the ordinary sign the rest pocket's prepare plus emit is 39.6 s under load against 11.2 s with one plan (× 0.28), byte-identical

- **Where:**
  - Rest, three calls of `resolveRestPocketOperation` (`src/core/cnc/cnc-rest-operation.ts:49`) on the same contours, settings and machine:
    - `src/core/cnc/compile-cnc-layer-passes.ts:202`: the finishing bit's passes;
    - `src/core/cnc/compile-cnc-operation-groups.ts:141` (`restPocketRoughingGroupForLayer`): the roughing group;
    - `src/core/cnc/cnc-rest-issues.ts:31` (`findCncRestPocketIssues`), called from `src/core/preflight/cnc-preflight.ts:142`, which `runEmitPreflight` (`src/io/gcode/emit-gcode.ts:254-267`) runs on every emit.
  - Adaptive, two calls of `resolveAdaptivePocketOperation` (`src/core/cnc/adaptive-pocket-operation.ts:30`), each a full `planAdaptivePocket` plus `verifyAdaptivePocket`:
    - `adaptive-pocket-operation.ts:109`: the compile, through `compile-cnc-special-passes.ts:26`;
    - `src/core/cnc/cnc-adaptive-issues.ts:25`: the emit preflight, `cnc-preflight.ts:148`.
- **Evidence:**
  - **PROFILE** (`prof\rest-ord.cpuprofile`, `node stack8.cjs prof/rest-ord.cpuprofile '^resolveRestPocketOperation$' 10`), loaded:
    - 22.6 s under `rawToolpathsForLayer`;
    - 18.1 s under `restPocketRoughingGroupForLayer`;
    - 12.1 s under `findCncRestPocketIssues` ← `runEmitPreflight` ← `emitPreparedGcode`.

    Each call is mostly `pocketRingToolpaths` → `buildOffsetLadder` → Clipper `inflatePathsD`.
  - **PROFILE** (`prof\adaptsq-ord.cpuprofile`): 8.2 s under the compile's `adaptivePocketPassesForSettings` and 7.8 s under `findCncAdaptivePocketIssues` ← `runEmitPreflight`.
  - **REPRO with a prototype** (`buildmemo8.mjs`, harness only, `j7-main` untouched). It loads the two files with each `resolve*Operation` export wrapped in a memo keyed by the JSON of its arguments; the memo is cleared before each run. One process, trees alternating, round 0 dropped:

    | Case | main prepare / emit | memo prepare / emit | Hash |
    |---|---|---|---|
    | `rest-ord` (cal 252 → 168) | 23,041 / 16,580 ms (n=3) | 10,689 / 487 ms | `e7a79db4d03d5321` both |
    | `adaptsq-ord` (cal 148 → 148) | 6,274 / 6,358 ms | 6,220 / 157 ms | `fc59d8657723ea40` both |

  - **Idle estimates:** the ordinary rest pocket's Save or Start does about 5–7 s of planning where about 2 s would do. On the 270 × 170 recess (S8-P3-2) emit repeats 13 s of adaptive verification only to refuse.
- **Why:**
  - Each consumer recomputes from the scene. Preflight already accepts the compiled job: `options.compiledJob` is used by `appendVCarveEntryIssues` at `cnc-preflight.ts:141`. The rest and adaptive checks do not use it.
  - Preview prepares only, so it pays two rest plans (or one adaptive). Save G-code, Start and the G-code 3D view prepare and emit, so they pay three (or two).
  - It all runs in the preparation or output worker. The window does not freeze, but the wait has no progress and nothing to cancel except leaving the view.
  - AREAS has no compile budget, so this is P3: time spent for no output.
  - The same in 1.0.28 and 1.0.23 (identical hashes; ratios × 0.91–1.02 for rest).
- **Fix direction:**
  - Resolve each rest or adaptive operation once per compile, and hand the result to the roughing group and to emit preflight. Either carry it on the compiled job, as `compiledJob` already does for V-carve entry, or keep a per-compile memo keyed by the operation's exact inputs.
  - The G-code is byte-identical (prototype above). The preflight messages are the same, because they come from the same result.
  - **Budget:** one plan per operation per output. The ordinary rest pocket's prepare plus emit should fall to about a third, and adaptive emit to the cost of emitting alone (about 0.2 s). Guard: count `resolve*Operation` calls in a compile + emit test (stable on CI), as S1-P3-3's guard proposal does with operation counts.

**Refuter (2026-11-05): CONFIRMED, P3.**
- **READ** on origin/main `87f0ec583`:
  - No file under `src/core/cnc`, `src/core/geometry`, `src/core/preflight`, `src/io/gcode` or `src/core/relief` changed since `790b95c4a`.
  - `j7-main`'s 912 files there equal origin/main by blob hash, so the bundles below are current main.
  - Every cited line holds: `compile-cnc-layer-passes.ts:202`, `compile-cnc-operation-groups.ts:141`, `cnc-rest-issues.ts:31` ← `cnc-preflight.ts:142`, `adaptive-pocket-operation.ts:109` and `cnc-adaptive-issues.ts:25` ← `cnc-preflight.ts:148`.
  - A fourth resolver, `cnc-offset-ladder-diagnostics.ts:218`, runs only when the job lacks the compile's exact ladder diagnostics. The compile always supplies them (`compile-cnc-job.ts:158-206`), so it is not hit here.
- **Call counts** (`zz-s8r\count-r.mjs`, a counting wrapper on main's two `resolve*Operation` exports; load-independent):

  | Case | Prepare: rest / adaptive | Emit: rest / adaptive |
  |---|---|---|
  | `rest-ord` | **2** / 1 (not requested) | **1** / 0 |
  | `adaptsq-ord` | 1 (not requested) / **1** | 0 / **1** |

  So rest plans 3 times per export and adaptive 2 times, as stated.
- **Re-measured, one process, trees alternating** (`zz-s8r\gtr.mjs`). This is a fresh build of main (`eng-base`) and a fresh build of the auditor's memo (`eng-memo-r`). Round 0 is dropped and the PC was loaded, so read the ratios, not the times:

  | Case | Calibration | main prepare + emit | memo prepare + emit | Ratio | G-code |
  |---|---|---|---|---|---|
  | `rest-ord` | 171 → 206 | 31,074 + 18,372; 32,456 + 21,168 ms | 13,692 + 642; 14,325 + 606 ms | **× 0.29 / × 0.28** | `e7a79db4d03d5321` in every row (the auditor's hash) |
  | `adaptsq-ord` | 118 → 239 | 11,336 + 12,062; 8,528 + 8,610 ms | 10,831 + 292; 9,546 + 334 ms | **× 0.47 / × 0.58**; emit × 0.024–0.039 | `fc59d8657723ea40` in every row |

  - Calibration drifted more than 15% in both sets, so the absolute times are discarded. The ratios agree with the auditor's × 0.28 and × 0.51.
  - The memo halves rest's prepare as well: two plans become one.
- **Severity, why P3 and not P2:**
  - Pocket jobs always prepare in the preparation worker (`canvas-preparation-policy.ts:76-88`).
  - Save emits off the UI thread (`save-gcode-emission.ts:65-67` → `prepareSaveOutputOffThread`, which takes `onProgress` and an `AbortSignal`).
  - So the window never freezes. The idle cost on the ordinary rest pocket is about 5–7 s, against a reference of 8 s that is not a CNC budget. That makes it wasted work, not a budget miss over 3 ×.

### S8-P3-2 — Adaptive verification stamps the full cutter disk at every half grid cell: an ordinary 270 × 170 mm recess spends about 15–25 s (110–127 s under load) in planning and verifying, then repeats it on emit

- **Where:**
  - `src/core/cnc/adaptive-pocket-verifier.ts:221` (`cutSegment`): one `clearDisk` (`:305`, `visitDiskCells` `:323`) every `cellMm / 2` along every move.
  - `src/core/cnc/adaptive-pocket-verification-grid.ts:82`: `cellMm = max(0.05, min(load / 2, d / 16, 0.25))`, which is 0.25 mm for a 6 mm bit. Each stamp visits about 450 cells of a 3 mm radius disk; 0.125 mm sampling makes consecutive disks overlap by 96%.
- **Evidence:**
  - **PROFILE** (`prof\adapt-40x40.cpuprofile`, a 40 × 40 square, 4.5 s under load): `verifyAdaptivePocket` 4,124 of 4,273 ms (97%), of which `cutSegment` takes 3,859 and `clearDisk` / `visitDiskCells` 2,556. `planAdaptivePocket` is 141 ms.
  - **Engine** (`adaptr-ord`, 270 × 170 recess, cal 290 → 347): prepare 126,649 ms, emit 111,391 ms (main). 1.0.28 took 167,956 + 189,335 ms and 1.0.23 240,014 + 155,200 ms, all giving the same refused output. A separate issues-only call (`dbg8.mjs adaptr-ord adaptive`, cal about 150–230) took 109,685 ms.
  - **Size sweep** (`adsweep8.mjs`, under load), resolve times:

    | Pocket | Time | Result |
    |---|---|---|
    | 20 × 20 mm | 1.3 s | accepted |
    | 30 × 30 mm | 4.2 s | accepted |
    | 40 × 40 mm | 5.9 s | accepted |
    | 40 × 30 mm | 3.5 s | refused |
    | 60 × 40 mm | 8.3 s | refused |
    | 100 × 60 mm | 14.8 s | refused |
    | 270 × 170 mm | 110 s | refused |

    The cost grows with the pocket's area, because the grid cell is fixed at 0.25 mm up to the 1,000,000-cell limit. Above that limit (the large sign's 570 × 370 recess) the verifier refuses in 0.27 s.
- **Why:**
  - ADR-154 requires an independent verifier, and that is not in question. The cost is how the verifier sweeps: it re-visits each disk instead of the leading edge of the swept area.
  - In the app it runs in the preparation worker behind "Preparing preview…", with no progress and no Cancel besides leaving Preview. It runs again on Save, Start or G-code 3D (S8-P3-1). With today's verifier the rectangle is then refused (Also noticed), so an operator waits about half a minute twice to learn that.
  - Not a freeze, so not P2. 15–25 s is 2–3 × the 8 s Preview reference, so P3 ("any other budget miss").
- **Fix direction:**
  - Stamp only the cells newly reached between consecutive samples: the crescent of the next disk not covered by the previous one, or a capsule sweep per move. This keeps the same cleared set, so the same decisions and the same G-code.
  - The `order.buried` bookkeeping in `clearDisk` must visit the same cells; prove it with the verifier's existing oracle tests and byte-identical G-code on the adaptive fixtures.
  - Also give the adaptive compile progress (region count) as the G-code 3D view already shows for fanned-out CNC jobs.
  - **Budget:** under 5 s idle for an ordinary 270 × 170 recess, and once per output (S8-P3-1).

**Refuter (2026-11-05): CONFIRMED, P3, with an output-identical fix the auditor missed.**
- **READ** on `87f0ec583`:
  - `adaptive-pocket-verifier.ts:221-247` (`cutSegment`) samples every `cellMm / 2` and calls `clearDisk` at each sample.
  - `adaptive-pocket-verification-grid.ts:82` gives `cellMm` 0.25 mm for a 6 mm bit at the default engagement.
- **Structural count** (`zz-s8r\adtime-r.mjs`, load-independent):

  | Pocket | Disk stamps | Cells per stamp | Cell visits | Grid cells |
  |---|---|---|---|---|
  | 270 × 170 | 1,178,030 | 452 | **532 M** (about 725 per cell) | 734,400 |
  | 40 × 40 | 35,160 | 452 | 15.9 M | 25,600 |

  On 270 × 170, `planAdaptivePocket` took 70 ms against 94,543 ms for `verifyAdaptivePocket` (calibration 100 → 247, so the times are discarded; the share stands).
- **The verifier keeps going after its verdict is settled.**
  - On every refused rectangle the largest engagement is a full slot (3.0 mm against a limit of 0.6 + 0.354 mm), and the first sample over the limit falls on ring 0, the first ring cut (`zz-s8r\diag-r.mjs`). See S8-P2-1 for why.
  - `verifyAdaptivePocket` still simulates all remaining rings (`:62-89`) before `verificationResult` checks the engagement first (`:123`).
  - Returning that refusal at the first over-limit sample gives the same verdict and reason. Nothing outside the verifier reads a failed result's `maxSimulatedEngagementMm` or `coverageRatio` (`git grep` on `src`).
- **Prototype** (`zz-s8r\buildfast-r.mjs` → `eng-fast.mjs`, harness only; `zz-s8r\emit-r.mjs`, one process, alternating; calibration 99 → 122 for the large set and 100 → 139 for the small):

  | Pocket | main prepare + emit | early exit prepare + emit | Ratio | G-code (main = early exit = Offset rings) |
  |---|---|---|---|---|
  | 40 × 20 (refused) | 840 + 667 ms | 119 + 55 ms | × 0.12 | `141a145c18dda7c8` |
  | 100 × 60 (refused) | 10,513 + 17,685 ms | 583 + 453 ms | × 0.037 | `10ede39e0b56073b` |
  | 270 × 170 (refused) | **99,109 + 98,754 ms** | **1,810 + 1,537 ms** | **× 0.017** | `891b673353fb41e8` |
  | 40 × 40 (accepted) | 3,099 + 3,956 ms | 4,054 + 4,043 ms | no change, as expected | `cc06816c27214137` |

  - Idle estimate for main's 270 × 170 at this set's calibration: about 32 s for Preview and about 64 s for Save or Start (prepare + emit). The auditor's 15–25 s per pass is at the low end; read it as 15–32 s.
  - Early exit brings a refused recess to under 1 s idle. Accepted pockets still need the auditor's crescent stamping.
- **Severity, why P3:** the work runs in the preparation worker and in Save's off-thread emit, so the window does not freeze. Leaving Preview cancels it (S8-P3-3's note). AREAS sets no CNC compile budget.
- **Fix direction, added:** stop verification at the first over-limit sample. That fixes the common case, a refused rectangle (S8-P2-1). Do it first, guarded by the existing refusal tests and byte-identical fallback G-code. Then do the crescent stamping for accepted pockets.

### S8-P3-3 — An offset pocket on a large sign (600 × 400 mm, 151 letter contours as islands) prepares for about 2.5–3 minutes idle (450 s under load) with no progress; each ring re-offsets the source by its full inset

- **Where:**
  - `src/core/geometry/offset-ladder.ts:42` (`buildOffsetLadder`): ring *k* is `offsetClosedPolylinesForKerfChecked(contours, -inset(k))`, computed from the original contours.
  - `src/core/geometry/kerf-offset.ts:58` (`offsetClosedPolylines`): it re-normalizes the even-odd tree and runs one Clipper `inflatePathsD` (Miter join) per ring.
  - Called from `pocketRingToolpaths` in `src/core/cnc/cnc-pocket-toolpaths.ts`.
- **Evidence:**
  - **Engine** (`pocket-big`, cal 89 at the start):

    | Build | Round 0 | Round 1 |
    |---|---|---|
    | main | 424,415 ms | 454,394 ms |
    | 1.0.28 | 284,713 ms | 448,812 ms |
    | 1.0.23 | 513,485 ms | 746,772 ms |

    The G-code is `dd6c25c517b541f3` in all three (37,701 lines). The set was stopped after round 1.
  - The ordinary sign's background (`pocket-ord`, 24 contours, 35 rings) takes 6.0 s under load (cal 193 → 214), about 1.1 s idle.
  - **PROFILE** (`prof\pocket-ord.cpuprofile`): `inflatePathsD` 15.6 of 16.4 s. Inside it, Clipper's `doIntersections` / `buildIntersectList` dominate. Each letter island is grown by up to half the pocket's height, so every ring unions many large overlapping polygons.
  - In the app, Preview of this pocket shows "Preparing preview…" for that long. Only the G-code 3D view and Frame show a region count.
- **Why:**
  - The cost per ring grows with the inset, so the whole ladder grows faster than the ring count. A sign twice as wide and tall with 6 × the letters cost 75 × the time as measured, and about 150 × by the idle estimates.
  - Same in 1.0.28 and 1.0.23 (identical G-code), so no regression.
  - It is large input in a worker, so P3 ("poor scaling that ordinary input does not reach").
- **Fix direction:**
  - Offsetting each ring from the previous ring, or clipping grown islands to the region, changes vertices. That is a burn change for the maintainer, not a speed fix.
  - Within the rule, the topology normalization could be shared across rings, but it is not where the time goes.
  - So the output-identical part of a fix is progress and Cancel: report rings or regions as they finish (the compile already fans CNC regions out to the bounded pool), and give Preview a Cancel.
  - **Budget:** a status with progress and Cancel within 200 ms. The 8 s Preview reference needs the maintainer's decision on incremental rings, with its own ADR.

**Refuter (2026-11-05): CONFIRMED, P3** (READ; not re-timed).
- **READ** on `87f0ec583`:
  - `offset-ladder.ts:49` offsets the original `contours` by `-insetMmForStep(step)` at every step.
  - `kerf-offset.ts:58-75` re-normalises the even-odd tree and runs one `inflatePathsD` per call.
- **Not re-timed.** One `pocket-big` round took 424–454 s under load for the auditor, and the PC sat at 65–97% load with 0.8–1.1 GB free throughout this refutation.
- **Not a freeze, so not the P2 freeze clause:**
  - Every pocket job prepares in the preparation worker (`canvas-preparation-policy.ts:79-88`).
  - Leaving Preview is a working Cancel. `cancelUnownedPreparation` (`preparation-worker-client.ts:212-229`) rejects the request and calls `retireWorker()` at once, without waiting for the compute.
  - What is missing is progress. `WorkspacePreviewDock.tsx:38-39` shows only "Preparing preview…" until the toolpath arrives, and nothing names leaving Preview as the way to cancel.
- **Not an ordinary operation over 3 ×:** AREAS sets no CNC compile budget. The 8 s figure is the 2,000-object Preview budget, borrowed by analogy, and this sign has 151 contours.
- **For the coordinator:** a 600 × 400 mm sign with a title and five lines is a plausible job for a sign maker. If the coordinator treats it as ordinary and adopts the 8 s reference as its budget, this becomes P2 (about 20 × that reference). The refuter keeps P3 under AREAS as written.

## Trend

Engine sets alternate the three trees round by round in one process. A ratio is main's median over each tree's; "Out" compares G-code hashes with main. Under this load single sets varied by ± 50% between rounds, so only ratios outside × 0.5–2 would mean anything.

| Row | main (loaded) | 1.0.28 | 1.0.23 | Out | Verdict |
|---|---|---|---|---|---|
| Profile ordinary / large | 900 / 3,755 ms | × 0.96 / 1.10 | × 0.92 / 1.78 | = / = | Flat |
| V-carve ordinary / large | 8,034 / 12,728 ms | × 1.19 / 0.97 | × 0.87 / 1.00 | = / = | Flat |
| Offset pocket ordinary / large | 6,008 / 454,394 ms | × 0.90 / 0.99 | × 1.30 / 1.64 | = / = | Flat; S8-P3-3 in every build |
| Adaptive 60 × 60 (prepare / emit) | 5,764 / 10,038 ms | × 1.57 / 0.79 | × 0.69 / 0.30 | = | Noisy, same output; S8-P3-1 in every build |
| Adaptive 270 × 170 recess | 126,649 + 111,391 ms | × 1.33 | × 1.90 | = (refused) | Same refusal in every build |
| Rest ordinary | 14,060 ms | × 0.91 | × 1.02 | = | Flat; S8-P3-1 in every build |
| Relief 750 × 500 / 3000 × 2000 | 22,046 / 18,989 ms | × 1.07 / (other set) 32,200 | × 0.91 / 30,949 | 1.0.28 = ; **1.0.23 differs** | 1.0.23 not comparable (ADR-412 changed relief output) |
| Browser rows (Preview, Cut 3D, G-code 3D, Cancel) | — | — | — | — | Not run (Machine state) |

Nothing is two or more times slower than 1.0.23 with the same output. The two 1.0.23 rows outside × 0.5–2 (adaptive emit × 0.30, pocket-big × 1.64) have one or two rounds under 3–12 × load and the same hashes; they need a quiet re-run before they mean anything.

## KNOWN re-observed

None. No earlier S1–S7 finding covers CNC toolpath compilation.
- S1-P2-2 (Start preparation, fixed by #1575) and S4's Start rows touch the output worker that S8-P3-1's emit runs in, but not the duplicate planning.
- S2-P3-1 (post-edit preparation on the UI thread) may be what the smoke saw after the nudge (230 ms). That is not verified, so it is not re-raised.

## Refuted

1. **"Height-field memory grows with the relief's source resolution."**
   - The CAM heightmap is resampled to `DEFAULT_HEIGHTMAP_CELL_MM = 0.2` (`src/core/relief/heightmap.ts:36`), advisory up to `MAX_HEIGHTMAP_CELLS = 4,000,000`.
   - A 3000 × 2000 source (0.1 mm) compiled at a `maxRSS` of 534 MB with main alone (112 MB retained). The 750 × 500 source reached 631 MB with all three trees in one process (165 MB retained).
   - Source resolution changes the project size (16.0 MB against 1.0 MB) and the decode and digest, not the toolpath memory.
   - **Refuter (2026-11-05): CONFIRMED, citation corrected** (READ; not re-measured).
     - The CAM grids do not use `heightmap.ts:36`'s 0.2 mm default.
     - Their cell sizes come from the tool and row spacing: roughing `tool.diameterMm / 8` (`compile-cnc-relief.ts:54,165`), finishing and rest `finishingCellSizeMm` (`compile-cnc-relief-finishing.ts:38-43`, at most a tenth of the contact diameter), projection `min(sampleSpacingMm, d / 10)` (`compile-cnc-relief-projection.ts:68`).
     - None of these reads the source resolution, so the conclusion holds.
2. **"ADR-412's exact contact makes relief compile slow at high resolution."**
   - The relief prepares in about 4–5 s idle at both resolutions. About 60% of the relief compile (`prof\relief-sm.cpuprofile`) is the finishing path's contact check (`checkedAgainstContact`), which is what ADR-412 accepted ("Compile time grows").
   - 1.0.28 has the same output and speed.
   - **Refuter (2026-11-05): CONFIRMED** (READ). ADR-412 records the cost under its Consequences, line 79: "Compile time grows". Not re-timed.
3. **"Main regressed against 1.0.28 or 1.0.23 in CNC."** Every case is byte-identical to 1.0.28, and to 1.0.23 except relief. No row is ≥ 2 × slower with the same output (Trend).
   - **Refuter (2026-11-05): CONFIRMED in part** (hashes).
     - A fresh build of main gives the auditor's hashes for `rest-ord` (`e7a79db4d03d5321`) and `adaptsq-ord` (`fc59d8657723ea40`).
     - The trend sets were not re-run: no quiet window, and the old trees cost minutes per round.
4. **"Adaptive is quick on refused pockets because it falls back early."**
   - Only two refusals are early: the "bit does not fit" partition check (0.4–1.2 s under load) and the 1,000,000-cell limit (0.27 s).
   - The radial-engagement refusal comes after the full verification (S8-P3-2), and emit repeats it.
   - **Refuter (2026-11-05): CONFIRMED, and the cost is avoidable.**
     - On every refused rectangle the first over-limit sample is on ring 0, the first ring cut (`zz-s8r\diag-r.mjs`). Yet `verifyAdaptivePocket` simulates every later ring before `verificationResult` checks the engagement (`adaptive-pocket-verifier.ts:62-97,123`).
     - Stopping at that sample gives the same verdict and the same G-code: see S8-P3-2's refuter note.

## Verified clean

- **Output equality:** one G-code hash per tree across all rounds in every set; main equals 1.0.28 everywhere.
- **Routing:** pocket, V-carve, inlay and relief jobs always prepare in the preparation worker (`canvas-preparation-policy.ts:76-100`, relief `:102-108`). Profile jobs do from 2,000 work units (`DIRECT_OUTPUT_WORK_BUDGET`, `:119`).
- **Ordinary profile and V-carve** compile in about 0.2 s and 1.3 s idle (estimates); the large V-carve in about 4.4 s.
- **Cancel, by reading** (not measured):
  - Leaving Preview aborts its consumer. When no consumer is left, `cancelUnownedPreparation` (`src/ui/workspace/preparation-worker-client.ts:212-229`) retires the worker with `terminate()` at once.
  - An edit to a different project terminates it too (`supersedeForNewProject`, `:250-259`).
  - The bounded compilation pool cancels a job through the bridge's detach and abort, then `retireWorkerSlotsForJob` (`bounded-compilation-worker-pool.ts:91-97`).
  - The CNC preview worker (removal grid, Cut 3D surface) retires on abort or supersede (`cnc-preview-worker-client-runtime.ts`, `abortMain`, `supersede`).
  - Nothing in these paths waits for the compute to finish.
- **Cut 3D orbit** (smoke, 3–4.7 × load): each of 30 right-drag steps is drawn by the offscreen worker in 25 ms (p50) and 31 ms (p95), with no main-thread long task.

## Not verified

- **Every browser row**, because the browser queue (`q-b1.txt`, `q-b2.txt`: 22 sets with trend) never met its memory gate (Machine state). That covers time to toolpath in the app, UI blocks, Cut 3D and G-code 3D frame rates on large toolpaths, Chrome memory for relief, and **Cancel latency to the worker**.
  - The harness is ready. `cancel` and `cancelEdit` record the worker `terminate()` events relative to the click, and Chrome's CPU seconds over the 20 s after Cancel (`cpu8.ps1`).
  - The smoke figures in the scorecard (`M-route-prof-ord`, calibration 111 → 168) suggest four things worth a profile on a quiet PC:
    - a **614 ms** task 346 ms after leaving Preview;
    - **312 ms** on the first G-code 3D orbit move;
    - **774 ms** on opening the sign, S3's area;
    - **230 ms** after a nudge, S2-P3-1's area. The ordinary profile compiles in about 0.2 s, and under the 20,000-unit direct budget the Design advisories compile it on the UI thread (`canvas-preparation-policy.ts:31`, `costlyCanvasPreparation` callers such as `use-canvas-motion-overlay.ts:203`).

    The set `M-prof-route-prof-ord` profiles these steps.
- **Relief and rest pockets in the browser.** The smoke runs reached Chrome 1.8–2.4 GB before the watchdog closed them at 360–449 MB free, with the PC below 1 GB free. Whether that is the app (several workers holding the project) or the PC is not known.
- **Idle absolute times.** Every engine figure ran at 2.4–12 × the idle calibration. The idle estimates assume the slowdown scales with calibration, which holds only roughly when other processes compete for memory as well as CPU.
- **The packaged desktop app**, and machine time on the router (estimates, rapids). S4 owns the ETA model.

## Also noticed (functional bug, for the coordinator; not counted)

> **Refuter (2026-11-05): RAISED as [S8-P2-1](#s8-p2-1), with corrections.**
> - The repro holds.
> - "Save, Start and the G-code 3D view are blocked" is wrong for Save and Start: the code is advisory, and the Offset-rings program is written and can run.
> - "Probably a sampling artefact" is wrong. The full slot is real (ring 0 beyond the entry helix), and ADR-154 Amendment 3 records it.
> - The "about 5%" threshold is really an absolute side difference: 100 × 98 passes and 100 × 96 is refused. The near-square refusals come from the entry tie-break.

**Adaptive clearing refuses every rectangle that is not nearly square, with the default radial engagement and up to 40% of the bit; only the 50% cap passes.**
- **REPRO** (Node, `adsweep8.mjs` and `adload8.mjs`; 6 mm end mill, `resolveAdaptivePocketOperation` on one closed rectangle):
  - **accepted:** 20 × 20, 30 × 29, 30 × 30, 30 × 31, 40 × 40 and 60 × 60 mm;
  - **refused**, "Adaptive verification simulated radial engagement above the configured limit.": 30 × 26, 30 × 24, 30 × 22, 36 × 30, 40 × 20, 40 × 30, 60 × 40, 100 × 60 and 270 × 170 mm.
  - At Radial engagement 1.2, 1.8 and 2.4 mm the 40 × 20 and 60 × 40 rectangles are still refused; 40 × 20 passes only at 3.0 mm, the 50% cap. With the 2 mm end mill, 40 × 20 is refused at 0.2 and 0.5 mm and passes at 1.0 mm (the cap).
  - 1.0.28 and 1.0.23 refuse 40 × 20 the same way.
- **What the operator sees** (`ademit8.mjs`):
  - `prepareOutput` succeeds, with the offset pocket in place of adaptive, so Preview shows a pocket.
  - `emitPreparedGcode` returns `preflight.ok: false` with `cnc-adaptive-clearing-invalid`: "Layer bg: Offset pocket fallback: Adaptive verification simulated radial engagement above the configured limit. Adjust Radial engagement or choose another fill method."
  - So Save, Start and the G-code 3D view are blocked. Adjusting Radial engagement helps only at the 50% cap, which is no longer adaptive clearing in any useful sense.
- The ordinary sign's lettered background is refused for another reason: "Island adaptive partition: The selected bit does not fit one of the adaptive pockets". Even with the letters' counters filled, and with a plain 270 × 170 recess, it is refused by the engagement check.
- ADR-154 makes the verifier fail closed on purpose. But a plain rectangle is the commonest pocket, and the engagement the verifier reports there is probably a sampling artefact (squares pass and near-squares pass; the refusal starts once one side is about 5% longer than the other).
- Suggested severity: P2 functional (a Pro tool that cannot clear a rectangle), for the refuter to raise or reject.
- Where to start:
  - `src/core/cnc/adaptive-pocket-verifier.ts:120-130` (the engagement check with `toleranceMm = cellMm * √2`);
  - the planner's corner rings in `adaptive-pocket-sequences.ts`;
  - `adaptive-pocket-verifier.test.ts:323-335` verifies a 40 × 20 rectangle only at the 50% cap (4 mm bit, 2 mm engagement); its other cases are squares and regular polygons.

## Refuter summary

**Refuter, 2026-11-05, 18:25–18:55 +0800.**
- **Tree:** origin/main `87f0ec583`.
  - `git diff 790b95c4a origin/main` touches no file under `src/core/cnc`, `src/core/geometry`, `src/core/preflight`, `src/io/gcode` or `src/core/relief`.
  - The 912 files there in `j7-main` equal origin/main by blob hash.
  - The refuter built its own bundles from them: `zz-s8r\buildr.mjs`, `buildfast-r.mjs`, `buildmemo-r.mjs`, `buildcount-r.mjs`.
- **Machine:** still loaded throughout.
  - Other sessions ran 2–3 vite dev servers and 2 vitest runs with 4 workers.
  - Free memory was 0.8–1.1 GB, load 65–97%, and calibration 99–247 ms (idle 36).
  - No browser set was run, because there was no quiet window.
  - Every number re-measured here is either a ratio within one process with trees alternating, a call or stamp count, or a G-code hash. Sets whose calibration drifted more than 15% are quoted for their ratios only.
  - No other session's process was stopped.

**Verdicts:**

| ID | Verdict | Severity | Basis |
|---|---|---|---|
| **S8-P2-1** (new) | **RAISED** | **P2** | REPRO (hashes, Save split, contact replay, centred-entry experiment) + READ |
| S8-P3-1 | CONFIRMED | P3 | Counts 3 rest / 2 adaptive; memo × 0.28–0.29 (rest) and × 0.47–0.58 (adaptive square), identical hashes; worker and off-thread Save, no freeze |
| S8-P3-2 | CONFIRMED | P3 | 532 M cell visits at 270 × 170; early exit at the first over-limit sample × 0.017 on prepare + emit with identical G-code (new fix direction) |
| S8-P3-3 | CONFIRMED | P3 | READ; not re-timed. Worker, and leaving Preview terminates it. No progress. P2 only if the coordinator rules the 600 × 400 sign ordinary and adopts the 8 s reference |
| Auditor's 4 refuted leads | CONFIRMED | — | No. 1's citation corrected (relief CAM cells come from the tool and row spacing, not `heightmap.ts:36`); no. 3 re-checked by hash only; no. 4 strengthened (the verdict is known at ring 0) |

**What changed from the auditor's report:**
1. **The adaptive "functional bug" becomes S8-P2-1, corrected.**
   - Save and Start do not block it. They write and run the byte-identical Offset-rings program: a straight plunge, then a full-width first ring. The disclosure comes after Save writes the file, or as one Start warning. Preview shows nothing.
   - The refusal of pockets 6 mm or more out of square is ADR-154 Amendment 3's decided limitation, not a sampling artefact.
   - Rectangles 4 mm out of square are refused only because the entry helix sits at one end of the innermost ring.
   - The threshold is an absolute side difference, not about 5%.
2. **S8-P3-2 gains the cheapest fix:** stop verification at the first over-limit sample. A refused 270 × 170 recess drops from 99 + 99 s to 1.8 + 1.5 s under load, with byte-identical G-code. That covers nearly every ordinary rectangle while S8-P2-1 stands.
3. **S8-P3-2's idle estimate widens** to about 15–32 s per pass (Preview), and about 30–64 s for Save or Start.

**For the coordinator:**
- S8-P2-1 has an output-identical part (disclose in Preview and the layer panel, name the cause, early exit) and a burn-change part (centred entry, an opening strategy for long pockets) that needs the maintainer and an ADR-154 amendment.
- Ask the maintainer whether a 600 × 400 mm sign counts as ordinary for S8-P3-3.

**Refuter files** (`scratchpad\zz-s8r\`):
- Scripts: `buildr.mjs`, `buildrc.mjs`, `buildfast-r.mjs`, `buildmemo-r.mjs`, `buildcount-r.mjs`, `diag-r.mjs`, `adtime-r.mjs`, `emit-r.mjs`, `show-r.mjs`, `count-r.mjs`, `gtr.mjs`.
- Results: `gtr.jsonl`, `count.txt`, `emit-small.txt`, `emit-large.txt`, `adtime-small.txt`, `adtime-270.txt`, `diag-40x20.txt`, `diag-centre.txt`, `diag-100-main.txt`, `diag-100-centre.txt`, `diag-main-more.txt`.
- The engine bundles were deleted after use. The build scripts remake them in seconds.
- Re-run on a quiet PC:
  - `node gtr.mjs rest-ord base,memo-r 4`
  - `node emit-r.mjs 40x20,100x60,270x170 base,fast 2`
  - `node diag-r.mjs 30x26,100x96` (main) and `ENG=rc node diag-r.mjs 30x26,100x96` (centred entry).

## Re-running

From `scratchpad\zz-s8`.
- **Tree:**
  - `node refresh8.mjs` (after regenerating `main-tree.tsv` with `git ls-tree -r origin/main -- src public scripts electron e2e <root files>`) lists differing files; `--write` rewrites them from `git show`.
  - Never delete `j7-main` or anything under it recursively. Its `node_modules` is a junction to the main checkout's.
- **Builds:**
  - Engine: `node build8.mjs` writes `eng-main/r28/r23.mjs`.
  - Prototype: `node buildmemo8.mjs` writes `eng-memo.mjs`.
  - Browser: `buildmain8.sh` (main bundle into `dist-main`, waits for 2.2 GB free).
- **Fixtures:** `node gen8.mjs` writes `fixtures\letters-*.json` (Roboto text from main). Cases are defined in `cases8.mjs`.
- **Engine:**
  - One set: `node --expose-gc --max-old-space-size=6144 gt8.mjs <case> main,r28,r23 <rounds>`.
  - Queues: `GATE=gate.ps1 ./qe8.sh q-e1.txt` and `q-e2.txt` (the strict gate on a quiet PC).
  - Summarise with `node anal8.mjs out/gt8.jsonl [regex]`.
  - Cases: `prof|pocket|adapt|adaptf|adaptr|adaptsq|pocketo|pocketr|rest|vcarve` with `-ord` or `-big`, and `relief-sm|relief-ord|relief-hi|relief-big`.
- **S8-P3-1 first** (about 5 minutes idle): `node --expose-gc gt8.mjs rest-ord main,memo 4` and `node --expose-gc gt8.mjs adaptsq-ord main,memo 4`. Compare the hashes and prepare + emit.
- **S8-P3-2:**
  - `node adsweep8.mjs main 40x40,100x60,270x170` (times and results);
  - `node --cpu-prof --cpu-prof-dir=prof adsweep8.mjs main 40x40 end6`, then `node profsum.cjs <file>`.
- **S8-P3-3:** `node --expose-gc gt8.mjs pocket-big main 2` (minutes), and `node --cpu-prof … gt8.mjs pocket-ord main 1`.
- **Call counts:** `node stack8.cjs prof/rest-ord.cpuprofile '^resolveRestPocketOperation$' 10`.
- **Adaptive bug:** `node adload8.mjs main 40x20 0.6,1.2,2.4` and `node ademit8.mjs main 40 20`.
- **Browser** (needs a quiet PC with about 3 GB free):
  - Projects: `node projgen8.mjs main,r28,r23 prof-ord,pocket-ord,adaptr-ord,rest-ord,vcarve-ord,relief-ord,prof-big,pocket-big,vcarve-big,relief-hi` (97 MB).
  - Hosts: `node host.mjs dist-main 4881`, `node host.mjs ../zz-s1/dist-33bc394c6 4882`, `node host.mjs ../zz-s1/dist-87ecb4f24 4883`.
  - Queues: `./qb8.sh q-b1.txt` (main: route, cancel, profiles) and `./qb8.sh q-b2.txt` (trend), with the strict `gate.ps1`. Write new queues with `node mkq8.mjs <queue> <template:case:runs,...> main|r28|r23`. Summarise with `node show8.mjs results.jsonl '<label regex>'`.
  - Templates:
    - `route`: open, nudge, Preview, Cut 3D, orbit, close, leave Preview, G-code 3D, orbit, pan;
    - `preview`;
    - `cancel` (leave Preview after 4 s);
    - `cancelEdit` (edit during Preview).
  - Profiles: `M-prof-route-prof-ord` writes `prof-*.json`; map them with `node map-profile.cjs <file> dist-main 20`.

```json
{
  "area": "S8-cnc-toolpaths",
  "tree": "790b95c4a (no CNC, relief, offset, G-code or preflight file changed to 87f0ec583)",
  "builds": { "main": "zz-s8/dist-main (790b95c4a, hidden maps, Free web build)", "engine": "esbuild bundles of main (j7-main = 790b95c4a) / 33bc394c6 / 87ecb4f24 (build8.mjs); prototype eng-memo.mjs (buildmemo8.mjs)", "trend": ["1.0.28 33bc394c6", "1.0.23 87ecb4f24"] },
  "counts": { "raised": 3, "refuted": 0, "auditor_refuted_leads": 4, "P1": 0, "P2": 0, "P3": 3, "known": 0, "functional_bug_not_counted": 1 },
  "refuter_counts": { "date": "2026-11-05", "tree": "87f0ec583 (no CNC/geometry/preflight/gcode/relief file changed since 790b95c4a; j7-main's 912 such files equal origin/main by blob hash)", "raised": 4, "refuter_raised": 1, "confirmed": 3, "refuted": 0, "severity_changes": 0, "P1": 0, "P2": 1, "P3": 3, "known": 0 },
  "budgets": { "response_ms": 100, "design_block_ms": 200, "memory_gb": 1.5, "preview_reference_s": 8 },
  "machine": "no quiet window 12:51-18:21: other sessions' vitest, Playwright e2e with Chrome, the trace round's tb5.mjs harness; free memory 4 MB-3.4 GB; engine sets ran under a relaxed memory-only gate at calibration 87-439 ms (idle 36), so engine results are alternating-tree ratios, call counts and hashes, with idle estimates ms*36/cal; the browser queue never met its memory gate (only ungated smoke runs, 3-4.7x load)",
  "engine_main_loaded_ms": {
    "prof_ord": { "prepare": 900, "emit": 180, "cal": [228, 137] },
    "vcarve_ord": { "prepare": 8034, "emit": 262, "cal": [239, 217] },
    "pocket_ord": { "prepare": 6008, "emit": 174, "cal": [193, 214] },
    "adaptsq_ord": { "prepare": [5764, 6274], "emit": [10038, 6358], "cal": [[110, 87], [148, 148]] },
    "adaptr_ord": { "prepare": 126649, "emit": 111391, "cal": [290, 347], "result": "refused at emit" },
    "rest_ord": { "prepare": [14060, 23041], "emit": [4527, 16580], "cal": [[176, 161], [252, 168]] },
    "relief_ord": { "prepare": 22046, "emit": 7178, "cal": [265, 138], "maxRssMB": 631 },
    "relief_hi": { "prepare": 18989, "emit": 2212, "cal": [141, 117], "maxRssMB": 534 },
    "prof_big": { "prepare": 3755, "emit": 201, "cal": [439, 137] },
    "vcarve_big": { "prepare": 12728, "emit": 269, "cal": [94, 112] },
    "pocket_big": { "prepare": 454394, "emit": 781, "cal": [89, null] }
  },
  "findings": [
    { "id": "S8-P2-1", "severity": "P2", "evidence": "REPRO (Node: prepare+emit hashes, Save split, contact replay, centred-entry experiment) + READ", "file": "src/core/cnc/adaptive-pocket-sequences.ts", "line": 75, "also": ["src/core/cnc/adaptive-pocket-entry.ts:58-67", "src/core/cnc/adaptive-pocket-verifier.ts:122-130", "src/core/cnc/adaptive-pocket-operation.ts:109-119", "src/core/cnc/cnc-adaptive-issues.ts:30-31", "src/core/preflight/cnc-preflight.ts:148-152", "src/core/preflight/blocking-codes.ts:32-48", "src/ui/app/file-actions.ts:282-291", "src/ui/workspace/preview-overlays.tsx:25-52", "src/ui/layers/AdaptivePocketFields.tsx:32-37"], "known": false, "raised_by": "refuter (auditor's functional bug, corrected)", "regression": "none (1.0.28/1.0.23 refuse the same)", "title": "Adaptive clearing on an ordinary rectangle (6 mm bit: sides differing by >= 4 mm) is refused below the 50% cap and silently becomes Offset rings: Preview shows no notice, Save writes the byte-identical Offset-rings program (straight plunge, full-width first ring) and toasts afterwards, Start lists a warning, and the advice 'Adjust Radial engagement' cannot help; long-pocket refusal is ADR-154 Amd 3's decided limitation, the near-square refusals come from an entry tie-break (helix at one end of the innermost ring)" },
    { "id": "S8-P3-1", "severity": "P3", "evidence": "PROFILE + REPRO (prototype, identical G-code)", "file": "src/core/cnc/cnc-rest-issues.ts", "line": 31, "also": ["src/core/cnc/compile-cnc-layer-passes.ts:202", "src/core/cnc/compile-cnc-operation-groups.ts:141", "src/core/cnc/cnc-adaptive-issues.ts:25", "src/core/cnc/adaptive-pocket-operation.ts:109", "src/core/preflight/cnc-preflight.ts:142,148", "src/io/gcode/emit-gcode.ts:254-267"], "known": false, "regression": "none (1.0.28/1.0.23 same hashes)", "title": "Rest machining resolves its rest pocket 3 times per export (finishing passes, roughing group, emit preflight) and adaptive plans+verifies twice (compile, emit preflight): ordinary rest pocket prepare+emit 39.6 s under load vs 11.2 s with one plan (x0.28); adaptive emit 6.4 s -> 0.16 s; byte-identical" },
    { "id": "S8-P3-2", "severity": "P3", "evidence": "PROFILE + engine", "file": "src/core/cnc/adaptive-pocket-verifier.ts", "line": 221, "also": ["src/core/cnc/adaptive-pocket-verification-grid.ts:82"], "known": false, "regression": "none (same refusal in all builds)", "title": "Adaptive verification stamps the full cutter disk every half 0.25 mm cell (97% of the time): an ordinary 270x170 mm recess takes ~15-25 s idle (110-127 s under load) in Preview and again on emit, then is refused" },
    { "id": "S8-P3-3", "severity": "P3", "evidence": "engine + PROFILE", "file": "src/core/geometry/offset-ladder.ts", "line": 42, "also": ["src/core/geometry/kerf-offset.ts:58"], "known": false, "regression": "none (identical G-code, x0.99 1.0.28)", "title": "Offset pocket of a large sign (600x400, 151 letter islands) prepares ~2.5-3 min idle (450 s under load) with only 'Preparing preview…': each ring inflates the source by its full inset, Clipper inflatePathsD 95%; ordinary sign ~1 s" }
  ],
  "functional_bug": "Adaptive clearing refuses every non-square rectangle (30x26 .. 270x170 mm; squares and +-3% pass) with 'Adaptive verification simulated radial engagement above the configured limit' at radial engagement 10-40% of the bit (0.6-2.4 mm for 6 mm; passes only at the 50% cap); Preview shows the offset fallback but emit preflight cnc-adaptive-clearing-invalid blocks Save/Start/G-code 3D; same in 1.0.28 and 1.0.23 (adaptive-pocket-verifier.ts:120-130; tests cover squares only). Suggested P2 functional",
  "not_verified": "all browser rows (queue never met its memory gate): time to toolpath in the app, UI blocks, Cut 3D / G-code 3D frame rates on large toolpaths, relief Chrome memory, Cancel latency; smoke hints at 614 ms on leaving Preview, 312 ms on the first G-code 3D orbit move, 774 ms on open, 230 ms after a nudge (3-4.7x load)",
  "refuter_verdicts": { "S8-P2-1": "RAISED (P2)", "S8-P3-1": "CONFIRMED P3 (counts 3/2; memo x0.28-0.29 rest, x0.47-0.58 adaptsq, identical hashes)", "S8-P3-2": "CONFIRMED P3 (532 M cell visits at 270x170; early exit at the first over-limit sample x0.017, identical G-code)", "S8-P3-3": "CONFIRMED P3 (READ; worker, Cancel = leave Preview, no progress; P2 only if the coordinator treats 600x400 as ordinary)", "auditor_refutations": "4 CONFIRMED (1: citation corrected to tool/row-spacing cells)" },
  "biggest_win": "S8-P3-1: resolve each rest/adaptive operation once per compile and pass it to the roughing group and emit preflight (preflight already takes compiledJob for V-carve): ordinary rest pocket prepare+emit x0.28 and adaptive emit to ~0.2 s, byte-identical G-code; then S8-P3-2's incremental disk stamping for adaptive verification"
}
```
