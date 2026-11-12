# D6 — structure and drift (code quality audit C2)

**Question.** Have C1's gains held, and do the documents match the code?
**Tree.** `origin/main` @ `a74e38540` (git archive `j32-main`), read-only. Baselines:
- C1: `f61a0757a`, the tree C1 measured;
- the end of the C1 sweep: `ab5c84eba`, where #1699 and #1700 merged.

Both were exported with `git archive` into `zz-d6\c1` and `zz-d6\sweep`.

**Method.**
1. **Census.** One script (`census.mjs`) ran on all three trees. It uses the TypeScript parser and the repo's own counted-line rule (`check-soft-line-limit.mjs`). It counts:
   - escape hatches: `any`, `!`, `as unknown as`, `@ts-expect-error`, `eslint-disable`, TODO, skipped tests;
   - counted lines per file, and the length and complexity of every function;
   - exports and their uses (C1's whole-word rule);
   - top-level helper bodies normalised two ways:
     - parameters renamed, as the guard does;
     - parameters and locals renamed, which catches a copy with different local names.
2. **Guards.** I ran the guard tests, read where CI runs each one, and read CI's result on `a74e38540`.
3. **ADRs.**
   - Every code name and file path cited in backticks in the 74 ADR files added or changed since C1 was checked against the tree (1,459 spans: 386 paths, 355 identifiers).
   - 30 behaviour sentences from 22 of those ADRs were traced to the code.
4. **Comments.**
   - Comments naming code that no longer exists were found by script.
   - The D1–D5 hot spots were read by hand.
5. **Hotspots.** Churn comes from `git log --numstat`, both since C1 and over 60 days. It is joined with file size and complexity, plus a safety-critical path filter.
6. **Proof.** Suspected defects were run as Node scripts on the real modules (`zz-d6\k1`–`k3`, using D5's loader re-pointed at `j32-main`).

**Runs.**
- Vitest ran on two named files.
- `tsc` ran on the Electron test project only.
- Free memory stayed at 2.0–3.9 GB.
- Nothing touched hardware, a live service, pnpm or a build.

## Headline

**C1's gains have mostly held, but its two softest gains are slipping.**
- All six C1 guards still exist, run in CI and pass. CI on `a74e38540` is green (run 43161455984).
- Shipped code still has no `any`, no `!`, no TODO and no file over the 400-line cap.
- Copied helpers crept back from 89 to 97 groups (3 or more files each) after the sweep. Exported names that nothing uses rose from 7 to 12. Neither has a guard that would catch this:
  - the copy guard matches a copy only token for token, with parameters renamed;
  - nothing checks for exports nothing uses.

**The main drift is a third link route that skipped every choke point ADR-705 Amendment 4 added.** That amendment says:
- "One request for every link job";
- "One job-warning list on every route";
- the Moshi rows "follow the G-code raster plan".

The amendment, and ADR-127 Amendment 5 for the `.rd`, closed D1/D2's findings for Moshi and Ruida only. The K40 (Lihuiyu, ADR-703, #1724) builds its own job and has its own row planner. D2 never tested it, because its tree predates #1724. Reproduced on main:
- **D6-P1-1.** K40 USB Start and Frame ignore "Selected artwork only". Save `.egv` honours it, so the USB stream is not the one Save writes. This is D2-P1-1's twin.
- **D6-P1-2.** On a Y-port rotary, `.egv` and K40 USB write one speed per layer. Strokes round an Ø80 glass on the Creality chuck burn at about 16 % of the set dose. GRBL writes F600 and F95 for the same job. This is D2-P1-2's twin.
- **D6-P1-3.** A K40 Fill ignores the bidirectional scan offset, from the layer and from the device table: the bytes are identical with 0 and 0.6 mm. K40 Image rows read neither the offset nor Dot width. These are the twins of D2-P1-3 and D1-P1-2.

Two P2s, both of a shape already seen:
- **D6-P2-1.** The K40 route gets none of the shared job warnings. Its USB job never advances "After completed job" variables.
- **D6-P2-2.** The autosave job gate sees only laser-store jobs. During a Moshi, Ruida or K40 job every autosave runs at once, which ADR-305 Amendment 1's limits were written to stop. This is the D4-P2-1 shape.

Eight P3s:
- the copy guard's blind spots;
- 5 new exports that nothing uses;
- an ADR-127 Amendment 4 wording gap that makes a 45° cross-hatch notice say 6.28× when the real change is 1.40×;
- the in-app dialog refusal reading only the laser store;
- non-negotiable 15's "components ≤ 250 hard", which nothing enforces (96 components exceed it);
- comments that hide the K40 gaps;
- base ADRs with no pointer to the amendments that changed them;
- one Vitest file that runs nowhere.

## C1 guards

| Guard (C1 item) | Still present | Runs in CI | Passes |
|---|---|---|---|
| Shared-helper copy guard (`src/core/util/shared-helpers-not-copied.test.ts`, C2-P3-1) | Yes, 13 shared modules, unchanged list | Yes: a `src` test, in `unit-tests` shards (`vitest.config.ts:28`) | **Yes**, locally 1/1 in 12.5 s; CI green. **Blind spots: D6-P3-1** |
| Dead-export removal (#1700, C2-P3-2) | The removal holds (the 73 stayed removed) | **No guard exists**; C1 removed once | **12 dead now** vs 7 after the sweep: 5 new (D6-P3-2) |
| Electron tests typecheck (`typecheck:electron-tests`, C1-P2-1) | Yes, `electron/tsconfig.test.json` | Yes: `ci.yml:76` (static-checks) and `release:check` | **Yes**, locally `tsc` exit 0 in 31 s, 166 test files |
| Electron tests lint (`lint:electron` incl. tests) | Yes, `eslint.electron.config.mjs` projects both tsconfigs | Yes: `ci.yml:71` | CI green |
| Script tests listed (`scripts/script-tests-listed.test.mjs`, C1-P2-2) | Yes; itself listed in `test:release-integrity` (101 words) | Yes: `ci.yml:128` | **Yes**, 1/1. Covers `.test.mjs` only (D6-P3-8) |
| e2e promise rules (C1-P3-2) | Yes, `eslint.config.mjs` e2e block (`no-floating-promises`, `no-misused-promises`) | Yes: `run-eslint.mjs` lints `e2e` in its own process | CI green |
| React rules (C1-P3-3) | Yes, 19 rules on `src/**/*.tsx` | Yes: `pnpm lint` | CI green; 2 reviewed disables (Button type, TracePreview `no-danger`) |
| 400 counted-line cap, 80-line functions, complexity 12 (ESLint, `src` and `electron`) | Yes | Yes | Yes: 0 files over 400 counted lines; 2 functions over 80 and 4 over complexity 12, all with the same reviewed disables as C1 |
| Raw-line backstop (`check-file-size-policy.mjs`, 600 / 900 for tests) | Yes | Yes: `ci.yml:145` | CI green. `electron/main.ts` is 572 raw / 390 counted lines |
| Soft 250 report (`check-soft-line-limit.mjs`) | Yes, report-only | Yes: `ci.yml:148` | Never fails, by design |

## Drift numbers

Same script on all three trees. Shipped = `src` and `electron`, not tests, fixtures or test support. C1's own figures are given where its method differs.

| Metric | C1 `f61a0757a` | After sweep `ab5c84eba` | Now `a74e38540` |
|---|---|---|---|
| Shipped TS files | 5,326 | 5,364 | 5,531 |
| `any` / `!` in shipped code | 0 / 0 | 0 / 0 | 0 / 0 |
| `as unknown as` (C1: 57) | 54 | 56 | 57 |
| `@ts-expect-error` shipped | 3 | 3 | 3 (same three) |
| `eslint-disable` shipped (C1 counted 87 by another rule) | 69 | 71 | 71: no new shipped disable since the sweep |
| `eslint-disable` in tests and e2e | 63 | 65 | 70: +6 `no-explicit-any` in 3 camera and jog e2e specs |
| TODO / FIXME in shipped code (C1: "five") | 0 | 0 | 0 |
| Skipped tests: `.skip` / `skipIf` / `runIf` / `.only` / `.todo` lines | 2 / 32 / – / 0 / 0 | 2 / 34 / 0 / 0 | 3 / 34 / 0 / 0. New since C1: one opt-in perf spec, one `runIf`, and C1's own `skipIf` fix |
| Files over 400 counted lines | 0 | 0 | 0 |
| Files at exactly 400 / ≥ 395 / ≥ 380 (C1: 65 at 380–399) | 9 / 26 / 66 | 7 / 25 / 66 | 6 / 29 / 69 |
| Functions over 80 lines / over complexity 12 (all disabled) | 2 / 4 | 2 / 4 | 2 / 4 |
| Functions at exactly complexity 12 / at 75–80 lines | 475 / 174 | 473 / 175 | 492 / 178 |
| Exported names | 17,922 | 18,012 | 18,769 |
| **Dead exports** (C1: 74; sweep removed 73) | 77 | 7 (4 kept on purpose, 3 MCP entry points) | **12 (+5)** |
| Exports used only by tests (my rule, broader than C1's 220) | 1,239 | 1,251 | 1,332 |
| **Identical helper bodies, groups in 3 or more files / repeated lines** (C1 sweep: 149 → 83, 2,700 → 930) | 153 / 2,749 | 89 / 1,005 | **97 / 1,085** |
| The same, locals renamed too | 162 / 2,942 | 99 / 1,185 | 107 / 1,299 |
| Groups in 2 or more files | 449 | 386 | 401 |
| `samePoint` / `sleep` / `distanceToSegment` / `encodeBase64` definitions | 46 / 8 / 10 / 3 | 33 / 3 / 10 / 3 | **35 / 4 / 11 / 4** |
| `isRecord` / `errorMessage` / `clamp` / `formatMm` definitions | 45 / 22 / 26 / 23 | 3 / 5 / 22 / 18 | 3 / 5 / 22 / 18 (held) |

The groups that grew or appeared since the sweep (14) include:
- `withLayerLabel` written out three times in `egv`, `moshi` and `rd` preflight. This is the copied preflight adapter, KNOWN as D2-P3-2.
- `jobActive = () => anyMachineJobActive()` three times.
- `sleep` and `samePoint` in the new K40 store.
- `polylineLength` as `polylineLengthMm`, exported from `fill-sweeps.ts` by the Z4-P1-1 fix (D6-P3-1).

The full list is in `out\dup.txt`.

## ADR / code drift

Sentences come from ADRs and amendments added or changed since C1. "Holds" means the code does what the sentence says.

| # | ADR | Sentence (shortened) | What the code does | Verdict |
|---|---|---|---|---|
| 1 | 127 Amd 2 D2 | The GRBL-family emitter writes `F = speed × hypot(dx,dy)/hypot(dx,dy/k)` | `grbl-strategy.ts:439` builds `rotaryFeedMatchFor`; F600/F95 on the chuck (k1) | Holds |
| 2 | 127 Amd 2, out of scope | `.rd` "corrected by Amendment 5 … not out of scope" | `rd-encoder.ts:127` matches speeds | Holds; **D2-P3-5 resolved** |
| 3 | 127 Amd 2 Context | Speed is the speed across the material, on a rotary as on a flat bed | `emit-egv.ts:84` scales Y (`machineSpaceJob`), and nothing in `io/egv` or `core/controllers/lihuiyu` reads a feed match | **Contradicted for K40 (D6-P1-2)** |
| 4 | 127 Amd 3 D1 | The warning names `floor(speed / rise)` and no axis | `rotary-surface-speed-warnings.ts:59-62` | Holds |
| 5 | 127 Amd 3 D2 | Schema 21 and older get the notice; 22 gets none | `old-project-rotary-feed.ts:28` (`FIRST_MATCHED_FEED_SCHEMA = 22`) | Holds |
| 6 | 127 Amd 4 D1 | Fires only when the rise rounds above 100 % | `noticeable()` `:69-70` | Holds |
| 7 | 127 Amd 4 D2 | "a Fill's hatch (and across it for a cross-hatch or a turned pass)" | `old-project-rotary-feed.ts:90` adds a stroke round the part (90°), not hatch + 90° | **Partly contradicted (D6-P3-3)**: 45° cross-hatch notice 6.28×, real 1.40× |
| 8 | 127 Amd 5 D1–D2 | One `.rd` part per speed class, at 5 %, then 10 %, then 20 % | `rd-rotary-feed.ts:25,35-44` | Holds |
| 9 | 127 Amd 5 D4 | Rotary Setup on a Ruida says the controller's rotary must stay off | `RotarySetupHost.tsx:15-18,73` | Holds. No such note exists for Moshi or K40, where KerfDesk also scales Y |
| 10 | 315 Amd 3 D2 | Offered only when rows land evenly at 8 phases | `rotary-row-placement.ts:23` (`PHASES = 8`) | Holds |
| 11 | 341 Amd 14 D1–D2 | Auto-restore only on stock GRBL or FluidNC; a 10 s window | `abort-auto-restore-eligibility.ts:64`, `abort-auto-restore.ts:48` | Holds |
| 12 | 695 D3 | Y on every controller; Marlin, Smoothieware and Ruida stay on Y | `rotary-axis.ts:57-70` (K40 and Moshi Y only) | Holds. It makes D6-P1-2 reachable |
| 13 | 695 D5 | "Nothing reports where a dedicated rotary stands" | Amd 1 D1 keeps a fourth MPos value as `a`; `abort-rotary-turn.ts` reads it. The comment `rotary-axis-output.ts:10` still repeats the base sentence | **Base text and comment stale**: KNOWN Z2-P3-1 (comment); D6-P3-7 (no pointer) |
| 14 | 695 Amd 2 D2–D3 | A stale turn is never jogged; the wait is `|turn|/feed × 1.5 + 5 s` | `abort-rotary-turn.ts:93-123` | Holds |
| 15 | 695 Amd 3 | Timed at the slower of the jog feed and the axis max rate | `abort-rotary-turn.ts:115` (`turnSpeed`) | Holds |
| 16 | 696 D1, D4 | 1 s Idle on identified GRBL-family firmware, 15 s otherwise, none without an ordered `$G`; release after 2 s; give up after 10 s | `laser-lost-ack-reconcile.ts:65-71`; `laser-motion-reply-probe.ts:121-122,239-251` | Holds |
| 17 | 697 D5 | "A Frame counts … only after … busy at least once and then idle twice" | Amd 1 changed it (4 idle reads with no busy); `ruida-network-monitor.ts:22-24,64` | Code holds Amd 1. **Base text superseded with no pointer (D6-P3-7)** |
| 18 | 697 Amd 1 D1–D3 | First read at once; 2 idle after busy; 4 idle without busy | `ruida-network-monitor.ts:20-24,64,73` | Holds |
| 19 | 699 Amd 1 D2 | `mapRasterGroup` refuses an angled raster | `rotary-transform.ts:154-160` | Holds |
| 20 | 700 Amd 1 | A zero-size axis gets a minimum extent, counting stroke width | `ps-svg.ts:15-16` (`withMinimumSize`) | Holds (READ) |
| 21 | 703 D2–D3 | The encoder writes from the prepared job (preview = save); `.egv` runs "the same post-compile checks a G-code save runs (bed bounds, no-go zones)" | `emit-egv.ts:93` runs bed and no-go only; the K40 USB job builds its own options (`lihuiyu-usb-job.ts:46`) | The named checks hold. **USB ≠ Save with a scope (D6-P1-1)**; the shared job warnings are missing (D6-P2-1) |
| 22 | 705 Amd 2 D1–D2 | Moshi rows from `planRasterRowSweeps`, with scan offset and Dot width | `moshi-raster-plan.ts` header and body | Holds for Moshi. **The K40 row plan (`lhy-motion-plan.ts:82-104`) has neither (D6-P1-3)** |
| 23 | 705 Amd 3 D1 | "The two link stores report into it" | `link-machine-work.ts:14` names Moshi and Ruida | Holds as worded; the third link store does not: **KNOWN D4-P1-1** |
| 24 | 705 Amd 3 D3 | "Every 'is a job running' guard sees link work" | The autosave gate (`use-autosave.ts:104-112`) and `app-dialogs.ts:30` read only `useLaserStore`. Wake lock, crash screen and unsaved guard are KNOWN D4-P2-1/2/3 | **Contradicted (D6-P2-2, D6-P3-4)** |
| 25 | 705 Amd 4 D1 | "One request for every link job" (scope, placement, variable advance) | Used by Moshi and Ruida; `LihuiyuUsbDetails.tsx:78` calls `prepareLihuiyuUsbJob(project, jobPlacement, head)` with no scope and no completion | **Contradicted (D6-P1-1, D6-P2-1)** |
| 26 | 705 Amd 4 D3 | The Moshi Fill from `planFillSweeps`; `withRunways` gone | `moshi-fill-plan.ts`; no `withRunways` anywhere | Holds |
| 27 | 705 Amd 4 D4 | "One job-warning list on every route" | `rd-job-warnings.ts:19`, `moshi-usb-job.ts:50`; nothing under `io/egv` or `lihuiyu-usb` | **Contradicted for K40 (D6-P2-1)** |
| 28 | 705 Amd 5 D1 | One function per header gives both the byte and the reported speed | `moshiVectorSpeedMmS` / `moshiRasterSpeedCmS`, `moshi-job-encoder.ts:134,146` | Holds |
| 29 | 707 D2 | `refuseDuringJob`: a question asked "while a job is active" is answered no | `app-dialogs.ts:30`: `isActiveJob(useLaserStore…streamer)` only | **Partly contradicted (D6-P3-4)**; one caller today |
| 30 | 707 D5 | "Don't ask again" is stored under `kerfdesk.dont-ask-again.v1.<key>`, inside try/catch | `dont-ask-again.ts:9-40` | Holds |

**Name and path check.** Of the 741 code names and file paths cited in backticks across the 74 changed ADRs, the only misses are of three kinds:
- names the ADR itself says were removed (`withRunways`, `jogCancelDropsUnparsedLines`, `writeSaveChunks`, two ADR-372 files);
- external sources (MeerK40t `.py` files, firmware symbols);
- `vite.config.ts` at the repo root.

No ADR cites code that silently disappeared (`out\adr-idents.txt`).

**Non-negotiables most likely to drift.**

| NN / rule | Check | Verdict |
|---|---|---|
| 9: Abort reachable always | A K40 job is invisible to `Ctrl+.` and the bars | **KNOWN D4-P1-1** (still open on `a74e38540`: `link-machine-work.ts:14`) |
| ADR-040: preview = output | K40 Fill and Image ignore the scan offset the preview applies | **D6-P1-3** |
| 21: Frame is the only Start guard | K40 Start runs only the footprint the last Frame traced (`sameLhyFootprint`) | Holds. The Frame and Start share the same unscoped job, so the permit is consistent, and wrong together |
| 15: "components ≤ 250 hard", plus the Definition of done "no component > 250 lines" and "No file in the repo exceeds 400 lines. Enforced by ESLint" | No rule exists for 250. 96 `.tsx` files exceed 250 counted lines (95 at C1). The 400 rule counts code lines in `src` and `electron` only | **Stale (D6-P3-5)** |
| 16/17 and the doc table cite `CLAUDE.md` as the "operating manual: file-size limits, naming, anti-patterns" | `CLAUDE.md` is now a 6-line redirect to `AGENTS.md` | **Stale (D6-P3-5)**, the C1-P3-4 remainder |
| 3: laser-off on travel, property-tested | `core/invariants/predicates.ts` present | Holds (G-code only, as written) |

## Comments that lie

| Where | Comment says | The code does | Could mislead into | Status |
|---|---|---|---|---|
| `src/ui/state/lihuiyu-usb/lihuiyu-usb-job.ts:1-3` | "the same stream Save .egv writes (emitPreparedEgvFile, preview = save)" | Save passes `outputScope`; this job does not, so the streams differ whenever "Selected artwork only" is on | Trusting the USB route to match Save | **D6-P1-1** |
| `src/io/egv/emit-egv.ts:1-5` | "then runs the post-compile checks a G-code save runs" | Runs bed and no-go preflight only; Save G-code also runs `detectMachineJobWarnings` | A new route author assuming the job warnings are covered | **D6-P2-1 / D6-P3-6** |
| `src/ui/laser/machine-job-warnings.ts:1-5` | "for the Save G-code and Start job paths … so both call sites stay simple" | 7 callers now: `.rd`, Moshi, tiled, output preparation, Start and Save | It reads as G-code-only, which is how the K40 route left it out | D6-P3-6 |
| `src/ui/state/autosave-job-gate.ts:4-5` and `use-autosave.ts:104-112` | "A job needs the canvas thread … Pause and Abort start there on every route" | "Job" means a laser-store stream only; link jobs never close the gate | A developer assuming link jobs are protected | **D6-P2-2** |
| `src/io/project/old-project-rotary-feed.ts:84-86` (also ADR-127 Amd 4 D2) | "(and across it for a cross-hatch)" | Adds 90° (round the part), not hatch + 90° | Over-warning (6.28× vs 1.40×) | **D6-P3-3** |
| `src/core/output/rotary-axis-output.ts:10-12` | "Nothing reports where a dedicated rotary stands" | The status parser keeps `a`; the turn-back reads it | Building a rotary feature that ignores the reported turn | KNOWN Z2-P3-1 (still open) |
| `scripts/check-soft-line-limit.mjs:26-28` | "Tests and fixtures are exempt from the file-size limits (eslint.config.mjs relaxes them…)" | ESLint applies `max-lines` 400 to tests; only `max-lines-per-function` is off (as `check-file-size-policy.mjs:6-9` says correctly) | Low: a report script | D6-P3-6 |
| `src/ui/state/use-unsaved-changes-guard.ts:9-15` | "deliberately gated OFF during an active job" | Laser store only | — | KNOWN D4-P2-3 |
| `src/ui/state/laser-job-stop.ts:298-301` | The stream freeze prevents feeding a job after the reset | A rejected reset write skips the freeze | — | KNOWN D3-P1-3→P2 (X01) / D3-P1-4→P3 |

The scripted scan found 79 comment references to names that exist nowhere in the code (`out\stale-comment-idents.txt`). All but two are firmware, MeerK40t or generated-bundle symbols. The two others (`safeRadius`, `cursorCanvasPx`) are harmless renames.

## Complexity hotspots

Sizes are counted lines. cx is the sum of the complexity of the file's functions. Churn counts non-merge commits since C1 (`f61a0757a..a74e38540`, 169 commits) and since 2026-09-12.

**Largest by total complexity:**
- `execution-provenance-evidence-validation.ts` (198);
- `ps-ops-control.ts` (189, new);
- `machine-profile-shape.ts` (165);
- `topology-cut-packets.ts` and `svg-stylesheet.ts` (162);
- `remote-access/runtime.ts` (161);
- `job-review-detail-facts.ts` (152, 22 commits in 60 days).

**Most churned since C1:**
- `moshi-job-encoder.ts`: 7 commits, 250 lines;
- `rotary-row-step-warnings.ts`: 6 commits, 319 lines;
- `moshi-usb-store.ts`, `unrestored-abort-origin.ts`, `file-actions.ts` and `ControllerConnectionControls.tsx`: 5 commits each.

**Most churned over 60 days:**
- `gcode-metadata.ts`: 74 commits;
- `platform/types.ts`: 49;
- `job.ts`: 47;
- `laser-store.ts`: 43;
- `deserialize-project.ts`: 40.

**Riskiest five** (high churn, high complexity, on the beam, stop or motion path):

| # | File | Size / cx | Churn (C1 / 60 days) | Why risky |
|---|---|---|---|---|
| 1 | `src/ui/state/laser-job-stop.ts` (Abort) | 388 / 111; `freezeAndStopWithoutReset` cx 11, 47 lines | 3c / 20c | D3 killed only 4 of 14 Abort mutants. It owns NN 9 for the laser store. 12 lines below the cap |
| 2 | `src/ui/laser/job-review/job-review-gate.ts` | 398 / 75; `runJobReviewGate` cx 12, 52 lines | 3c / 23c | At the cap and at max complexity. D3 killed 5 of 14 mutants (J01–J14 gaps). It decides what program a Start streams |
| 3 | `src/ui/state/laser-line-handler.ts` | **400** / 92; `handleWelcomeLine` 73 lines; `controllerResetBoundaryPolicy` cx 12 | 2c / 29c | Grew from 398 to exactly the cap. Reply routing and acknowledgement ledger for every GRBL-family stream; the next edit must split it |
| 4 | `src/ui/state/laser-store.ts` + `laser-store-helpers.ts` | **400** / 57 and 399 / 94 | 3c / 43c + 35c | Both at the cap. `isActiveJob` here is the job-running source for 53 shipped files, while 10 consult link work (D6-P3-4) |
| 5 | The link-route encoders: `moshi-job-encoder.ts`, `moshi-usb-store.ts`, `lhy-motion-plan.ts`, `lihuiyu-usb-store.ts` (342 / 123, 48 functions) | small files, many copies | Highest since C1 (Moshi 7c + 5c; K40 new) | Each route writes its own options, planners and warnings. 5 P1s in D1/D2 and 3 here come from this one shape |

`job-review-detail-facts.ts` (393 / 152) is the runner-up: it is Job Review text, not motion.

## Findings

### D6-P1-1 — K40 USB Start and Frame ignore "Selected artwork only" and "Anchor from selected artwork"; Save .egv honours them

- **Where:**
  - `src/ui/lihuiyu-usb/LihuiyuUsbDetails.tsx:78`;
  - `src/ui/state/lihuiyu-usb/lihuiyu-usb-job.ts:26-48`.
- **Anchor:**
  - ADR-705 Amd 4 D1 ("One request for every link job");
  - ADR-703 D2 ("preview = save");
  - the twin is D2-P1-1 (P1).
- **Evidence:**
  - READ: the panel calls `prepareLihuiyuUsbJob(project, jobPlacement, board.head)`. That builds `EmitEgvOptions` with no `outputScope` (`:39-45`) and calls `prepareOutput(project, egvPreparationOptions(options))` (`:46`).
  - READ: `link-job-request.ts` (`currentLinkJobRequest`) exists and is used only by the Moshi and Ruida panels.
  - READ: `save-egv-action.ts:35` does pass `ctx.outputScope`.
  - The "Selected artwork only" checkbox (`JobPlacementControls.tsx`) is not gated by controller.
  - **REPRO** `k1-k40-route-rules.mts`: A (X 20–40, selected) and B (X 150–170).
    - Save `.egv` with the scope: burn bounds 787–1575 mil (A only).
    - The K40 USB job: 0–5906 mil, so **it burns B**. Stream 158 bytes vs Save's 82.
- **Scenario:** the operator has two name tags on the sheet and ticks "Selected artwork only" to burn one. Frame traces both, which may not register as wrong. Start then burns every design on the sheet.
- **Severity:** P1. It burns material the operator excluded, with no warning, as in D2-P1-1.
- **Fix direction:**
  - build the K40 job from `currentLinkJobRequest()` (scope plus completion), as Moshi and Ruida do;
  - better, make the link-job request a parameter every link store must take, so a fourth route (JCZ, #1725) cannot skip it.

### D6-P1-2 — A K40 job on a Y-port rotary writes one speed per layer, with no surface-feed match

- **Where:**
  - `src/io/egv/emit-egv.ts:84` (`encodeLhyJob(machineSpaceJob(…))`);
  - `src/core/controllers/lihuiyu/` (no `rotaryFeedMatchFor` anywhere).
- **Anchor:**
  - ADR-127 Amd 2 (the layer Speed is the speed on the part);
  - Amd 5 fixed `.rd`, ADR-705 Amd 1 fixed Moshi;
  - twins Z3-P1-2 and D2-P1-2 (both P1);
  - ADR-695 D3 offers Y on a Lihuiyu (`rotary-axis.ts:66-69`).
- **Evidence:** **REPRO** `k1(b)`, using the Creality chuck at 40 mm per turn, Ø80 glass, and a 20 mm Line square at 600 mm/min:
  - `.egv`: one `CV…` speed code in the whole stream. The only advisory is the M2 power-knob note.
  - GRBL, same job: `F600` and `F95` (k = 0.159).

  So strokes round the part move the surface at 600 / 0.159 mm/min, which is 15.9 % of the set dose. A 360 mm-per-turn roller on an Ø25 pen would get 458 %, as in D2-P1-2. The USB job sends the same stream (`lihuiyu-usb-job.ts:46-48`).
- **Scenario:** the stock K40 rotary is a Y-motor swap. Lines round a tumbler barely mark, or overburn and chip glass on a k > 1 roller.
- **Severity:** P1. Silent wrong dose, as D2-P1-2.
- **Fix direction:**
  - split the K40 parts by surface speed class, as `rd-rotary-feed.ts` does, or change speed codes mid-program if MeerK40t documents that;
  - or refuse a Y-rotary `.egv` until then;
  - long-term, D2's recommended core "rotary feed runs" helper that every encoder must call;
  - add a Rotary Setup note for K40 and Moshi like `RUIDA_ROTARY_NOTE`.

### D6-P1-3 — A K40 Fill ignores the bidirectional scan offset; K40 Image rows ignore the offset and Dot width

- **Where:**
  - `src/core/controllers/lihuiyu/lhy-motion-plan.ts:57-104` (`vectorSteps` walks `segment.polyline` as is; `rasterSteps` reads only `group.bidirectional`).
- **Anchor:**
  - ADR-705 Amd 2 D1–D2 and Amd 4 D3 (Moshi now uses the G-code planners);
  - ADR-052 Amd 2;
  - ADR-040 (preview = output);
  - twins D2-P1-3 and D1-P1-2 (both P1).
- **Evidence:**
  - **REPRO** `k2-k40-scan-offset.mts`: a 20 mm Fill at 6000 mm/min, two-way.
    - The `.egv` stream hash is `a5bff216` with the layer offset at 0 or 0.6 mm, and with an empty device table or `{6000: 0.6}`.
    - The G-code hash changes `803fc89a` → `39ff5cd2` in both cases.
  - READ: there is no `scanOffset`, `dotWidth`, `planFillSweeps` or `planRasterRowSweeps` reference under `core/controllers/lihuiyu`.
- **Scenario:** a two-way Fill or photo on a K40 with a calibrated scan offset gets jagged edges the preview does not show. Every reverse row lands 0.6 mm off.
- **Severity:** P1, by the D1-P1-2 and D2-P1-3 precedent (silent position error; preview ≠ output).
- **Fix direction:**
  - take K40 Fill sweeps from `planFillSweeps(group, scanOffsetMm)` and Image rows from `planRasterRowSweeps`, walked as `moshi-fill-plan.ts` and `moshi-raster-plan.ts` walk them;
  - or warn before Start while the offset or Dot width is set.

### D6-P2-1 — The K40 route shows none of the shared job warnings, and its USB job never advances "After completed job" variables

- **Where:**
  - `src/io/egv/emit-egv.ts:93-102`;
  - `src/ui/app/save-egv-action.ts`;
  - `src/ui/state/lihuiyu-usb/lihuiyu-usb-job.ts:60`.
- **Anchor:**
  - ADR-705 Amd 4 D1 and D4;
  - twins D2-P2-1 (refuter rated it P1) and D2-P2-3.
- **Evidence:** READ:
  - `detectMachineJobWarnings` has 7 callers (Save G-code, tiled, output preparation, Start, `rd-job-warnings.ts`, `moshi-usb-job.ts:50`), and none under `io/egv`, `save-egv-action` or `lihuiyu-usb`;
  - no `advanceVariablesAfter` call exists in the K40 store or panel.

  Save `.egv` does advance on export (`advanceExportVariables`).
- **Scenario:**
  - a kerf-compensated slot that closed up ("will NOT be cut") or a failed Fill gives no word on `.egv` or K40 USB, while G-code warns;
  - a serial-number tag run over USB repeats the same serial on the next part.
- **Severity:** P2, as D2's ledger kept D2-P2-1 and D2-P2-3.
- **Fix direction:**
  - an `emitPreparedEgvWithJobWarnings` twin of `rd-job-warnings.ts`;
  - the link-job request's `completed` from D6-P1-1;
  - better, compute job advisories in core behind `PreparedOutput` (D2's recommendation 2).

### D6-P2-2 — The autosave job gate sees only laser-store jobs: during a Moshi, Ruida or K40 job every autosave runs at once

- **Where:** `src/ui/app/use-autosave.ts:104-112`. `createSnapshotForAutosave` sets `isStreaming` from `useLaserStore…streamer` only, and that drives `gate.noteJob` and `writeDuringJob`.
- **Anchor:**
  - ADR-305 Amd 1 / A4-P2-1: a heavy project's hand-off, or a localStorage-fallback write, must wait for the job to end;
  - ADR-705 Amd 3 D3 ("every 'is a job running' guard sees link work");
  - same shape as D4-P2-1 (P2).
- **Evidence:** READ:
  - the gate's `allows()` check (weight limit, slow hand-off, IndexedDB reached) is consulted only when `isStreaming` is true;
  - a link job leaves it false, so the interval writes as if idle;
  - `anyMachineJobActive()` exists and is not used here.

  Not driven: no browser run (memory).
- **Scenario:** a K40 or Moshi job is refilled by the window. A 30-million-character project, or a profile whose IndexedDB write failed, takes its autosave hand-off, or a synchronous localStorage write, on the canvas thread mid-job. The packet stream pauses. D4 measured the K40 beam flag on at 18 of 20 packet boundaries, so a pause can stand the head with the beam flag set (unqualified on hardware).
- **Severity:** P2. A real gap of a known shape with limited, probabilistic harm. The refuter may lower it to P3 if the hand-off stays a few ms on realistic projects.
- **Fix direction:** read `anyMachineJobActive()` in `createSnapshotForAutosave`; one shared "job active" query, as D4 recommends.

### D6-P3-1 — The shared-helper guard misses copies with renamed locals or an arrow body, and copies are growing again

- **Where:** `src/core/util/shared-helpers-not-copied.test.ts:115-142`. `normalBody` renames parameters only, and compares tokens, so `=> expr` and `=> { expr; }` differ.
- **Anchor:** C1 C2-P3-1 and the sweep's rule.
- **Evidence:** census with locals renamed (`out\dup.txt`, `out\dup2.txt`):
  - `fill-sweeps.ts:46` `polylineLengthMm` (exported, added by 71ec3978f for Z4-P1-1) is `point-math.ts:62` `polylineLength` with `i` for `index`;
  - `lihuiyu-usb-store.ts:62` `sleep` is `ui/common/sleep.ts` in arrow form; 2 older copies differ by braces;
  - `samePoint` went from 33 to 35 definitions (K40 store, `laser-second-pass`);
  - `distanceToSegment` 10 → 11, `encodeBase64` 3 → 4;
  - groups in 3 or more files went 89 → 97 (1,005 → 1,085 repeated lines) since the sweep.
- **Scenario:** the next copy drifts, as C1 found 29 `samePoint` bodies.
- **Severity:** P3.
- **Fix direction:** in the guard:
  - rename locals by order;
  - normalise an expression body to `{ return …; }` before tokenising, as the census `locals` mode does;
  - add `sleep` written either way.

### D6-P3-2 — Five new exports nothing uses since the sweep, and no check for them

- **Where:**
  - `core/controllers/lihuiyu/lhy-speed-code.ts:19` `LIHUIYU_BOARDS`;
  - `core/controllers/moshi/moshi-live-commands.ts:32-33` `CH341_VENDOR_STATUS_REQUEST` / `_LENGTH`;
  - `core/design/dimensions/sketch-dimension.ts:62` `dimensionEntityIds`;
  - `io/postscript/ps-types.ts:84` `isProcedure`.
- **Anchor:** C1 C2-P3-2 / #1700.
- **Evidence:**
  - census: dead exports went 77 (C1) → 7 (sweep) → 12;
  - grep: no other reference;
  - the unused CH341 constant sits beside a second copy of the same value in `core/controllers/usb/ch341-epp.ts:28` (`GET_STATUS = 0x52`);
  - `LihuiyuBoard` and `LihuiyuBoardId` repeat the board list in two types (`lhy-speed-code.ts:17`, `device-profile.ts:45`).
- **Severity:** P3.
- **Fix direction:** remove the five, or use `CH341_VENDOR_STATUS_REQUEST` in `ch341-epp.ts`; add a dead-export step to CI (`census.mjs`'s rule, or knip), with a small allow-list.

### D6-P3-3 — ADR-127 Amd 4's "across the hatch" is coded as "round the part": a 45° cross-hatch notice says 6.28× for a 1.40× change

- **Where:** `src/io/project/old-project-rotary-feed.ts:85-92`. `strokeAngles` returns `[hatch, ROUND_THE_PART]`.
- **Anchor:** ADR-127 Amd 4 D2; the file's own comment `:84-86`.
- **Evidence:** **REPRO** `k3-crosshatch-notice.mts` on the Creality chuck, Ø80:

  | Hatch | Notice says | Real change |
  |---|---|---|
  | 45°, no cross | 1.40× | 1.40× |
  | 45°, cross-hatch | **6.28×** | 1.40× |
  | 0°, cross-hatch | 6.28× | 6.28× |
- **Scenario:** a 1.0.30 project with a 45° cross-hatch is told "up to 6.28× the energy". An operator who scales power down by that factor under-burns.
- **Severity:** P3. A one-time notice that also asks for a test burn. P2 if the refuter judges that it leads the operator into a wasted part.
- **Fix direction:** return `[hatch, hatch + 90°]` for a cross-hatch, and the actual pass angles for a turned pass.

### D6-P3-4 — "Job is running" has two sources, and the newest guards read only the laser store

- **Where:**
  - `src/ui/state/app-dialogs.ts:30` (ADR-707 `refuseDuringJob`);
  - 53 shipped files call `isActiveJob(...)` on the laser store; 10 consult link work.
- **Anchor:** ADR-705 Amd 3 D3; ADR-707 D2.
- **Evidence:** READ. `refusedForJob` checks `isActiveJob(useLaserStore.getState().streamer)`. Its one caller today (`machine-offer.ts:44`) is a line-store machine offer, so no harm today. But ADR-707 plans to move the `job-aware-dialogs.ts` call sites to it, and they would lose the link-work check #1753 gave them. No type forces a new link store to register (K40 did not: KNOWN D4-P1-1).
- **Severity:** P3.
- **Fix direction:**
  - `refusedForJob` reads `anyMachineJobActive()`;
  - make `LinkMachineSource` derive from the set of link stores, so registration is checked by the compiler.

### D6-P3-5 — The non-negotiables state size rules nothing enforces, and cite a manual that no longer holds them

- **Where:**
  - `PROJECT.md:502`: NN 15, "components ≤ 250 hard";
  - `PROJECT.md:815`: the Definition of done, "no component > 250 lines";
  - the success metric "No file in the repo exceeds 400 lines. Enforced by ESLint";
  - `DECISIONS.md:466`: ADR-015, "React component: 250 hard";
  - `PROJECT.md:12,503-504,788`: these cite `CLAUDE.md` for file-size limits, naming and anti-patterns.
- **Evidence:**
  - census: 96 `.tsx` files over 250 counted lines (95 at C1); the largest is 395;
  - ESLint's only cap is 400 counted lines in `src` and `electron`;
  - `electron/main.ts` is 572 raw lines, and scripts have no 400 cap (C1-P3-1);
  - `CLAUDE.md` is a 6-line redirect to `AGENTS.md`.
- **Severity:** P3. Doc drift with no defect behind it.
- **Fix direction:** reword NN 15 and the Definition of done to the enforced rule (400 counted lines, 80-line functions, complexity 12, the 250 soft report), or add the component rule; point the citations at `AGENTS.md`.

### D6-P3-6 — Comments that hide the link-route gaps or misstate the size rules

- **Where:** see the lying-comments table:
  - `lihuiyu-usb-job.ts:1-3`;
  - `emit-egv.ts:1-5`;
  - `machine-job-warnings.ts:1-5`;
  - `autosave-job-gate.ts:4-5`;
  - `check-soft-line-limit.mjs:26-28`.
- **Severity:** P3. The first three would have told a reviewer the K40 route was covered.
- **Fix direction:**
  - correct them with D6-P1-1 and D6-P2-1/2;
  - say in `machine-job-warnings.ts` that every output route must call it.

### D6-P3-7 — Base ADRs carry no pointer to the amendments that changed their decisions

- **Where:**
  - ADR-697 D5 (Frame completion, changed by Amd 1);
  - ADR-695 D5 ("Nothing reports where a dedicated rotary stands", contradicted by Amd 1);
  - ADR-705 D3 (row and Fill planning, replaced by Amd 2 and Amd 4).
- **Evidence:** 194 ADRs have amendment files. 68 of their base files never name one of their own amendment numbers, ADR-697, 699, 700 and 705 among them. ADR-695's base mentions only other ADRs' amendments, and its D5 sentence stands uncorrected. In-file ADRs in `DECISIONS.md` do get "Amended by" lines (ADR-227 this cycle), and ADR-640 and 372 Amd 1 got them in their own files.
- **Severity:** P3.
- **Fix direction:** add an "Amended by" line to each base ADR when an amendment changes a decision. A check in `check-adr-numbers.mjs` could require it.

### D6-P3-8 — A Vitest file under `scripts/` runs in no CI job and no typecheck

- **Where:** `scripts/performance-audit/worker-scheduling.test.ts`, with its own `vitest.config.ts`.
- **Evidence:**
  - no workflow or `package.json` script references `performance-audit/vitest.config.ts`;
  - root Vitest includes only `src` and `electron`;
  - `script-tests-listed.test.mjs` looks only for `.test.mjs`;
  - present at C1 and unchanged;
  - run locally: 4/4 pass.

  It imports real worker clients (preparation, trace part, project save), so it can drift silently.
- **Severity:** P3. The C1-P2-2 class with no failure in it today.
- **Fix direction:** run it in the unit job (it is fast) or delete it; extend the listed-tests guard to `scripts/**/*.test.ts`.

## KNOWN (not re-reported)

- **D4-P1-1.** The K40 is missing from the machine-work registry. It is still open on `a74e38540`.
- **D4-P2-1, D4-P2-2, D4-P2-3.** The wake lock, crash screen and unsaved guard read the laser store only.
- **Z2-P3-1.** The comment at `rotary-axis-output.ts:10` is still stale.
- **D2-P3-2.** The copied preflight adapter (`withLayerLabel` ×3).
- **D3-P2-2 and D3-P1-3→P2 / D3-P1-4→P3.** The Abort test gaps and the X01 freeze comment.
- **C1's maintainer decisions.** Tolerance helpers, `clamp` variants, the flat `ui/state` folder (C5-P3-1), validators not tied to their types (C3-P3-1) and script typing (C1-P3-1).
- **C1-P1-2.** The merge queue. D7 owns it.

## Refuted

- **"41 shipped files exceed the 400-line cap"** (my first counter). It counted comment lines. The repo's own counter gives 390–393 for the same files, and 0 files are over.
- **"Shared helpers copied under a new name slipped past the guard."** With parameters renamed, 0 copies of a shared export exist; the guard catches renamed copies. The slips are local-name and arrow-body variants only (D6-P3-1).
- **"ADRs cite code that is gone."** All 741 cited names and paths resolve, apart from the deliberate removals and external sources.
- **D2-P3-5** (ADR-127 Amd 2's Ruida wording). Corrected by Amd 5; not re-raised.

## Verified clean

- **CI on `a74e38540`:** green (run 43161455984). Static checks, the release-integrity tests, file size, soft size and the unit shards all passed.
- **Guards:** `shared-helpers-not-copied.test.ts` passed 1/1 locally; `script-tests-listed.test.mjs` 1/1; `tsc -p electron/tsconfig.test.json` exit 0.
- **Escape hatches in shipped code:**
  - no `any`, `!` or TODO;
  - the same three `@ts-expect-error`;
  - no new shipped `eslint-disable` since the sweep;
  - no `.only` or `.todo`.
- **ADR sentences that hold:** rows 1, 2, 4–6, 8–12, 14–16, 18–20, 26, 28 and 30 of the drift table.
- **The Moshi and Ruida routes** now pass the Amd 4 choke points: the scope, warnings, Fill planner and variable advance as written.

## Not verified

- D6-P2-2 in a browser: the hand-off cost on a large project during a link job. Free memory was under the 2 GB browser gate for most of the run.
- K40 Image rows with Dot width or the scan offset by bytes. That part is READ; the Fill part is reproduced.
- Real K40 behaviour when the host pauses mid-stream.
- `knip` or another dead-export tool. Not installed, and I downloaded nothing.
- The e2e promise rules and React rules were not run locally (typed-lint memory); CI's green lint is the evidence.

## Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-d6\`.

**Scripts.** Run the `.mts` files with `node --no-experimental-webstorage --import ./register.mjs <file>` from that folder.
- `register.mjs`, `ts-resolve.mjs`: D5's loader, pointed at `j32-main`.
- `k1-k40-route-rules.mts`: D6-P1-1 and D6-P1-2. Output in `out\k1-k40-route-rules.txt`.
- `k2-k40-scan-offset.mts`: D6-P1-3. Output in `out\k2-k40-scan-offset.txt`.
- `k3-crosshatch-notice.mts`: D6-P3-3. Output in `out\k3-crosshatch-notice.txt`.
- `census.mjs <tree> <out.json>`: the census, with `softcount.mjs` (the repo's counter, extracted).
- `diff.cjs`, `dup.cjs`, `dup2.cjs`, `hot.cjs`: comparisons. Output in `out\diff.txt`, `out\dup.txt`, `out\dup2.txt`, `out\hot.txt`.
- `adr-idents.cjs`: the ADR name and path check. Output in `out\adr-idents.txt`.
- `stale-comment-idents.cjs`: the comment name check. Output in `out\stale-comment-idents.txt`.

**Data.**
- `c1\`, `sweep\`: `git archive` exports of `f61a0757a` and `ab5c84eba`.
- `c1.json`, `sweep.json`, `now.json`: the census results, with summaries in `out\c1.txt`, `out\sweep.txt` and `out\now.txt`.
- `churn.txt`, `churn90.txt`: `git log --numstat` since C1 and over 60 days.

No security findings.

```json
[
  {"id":"D6-P1-1","severity":"P1","area":"structure-and-drift","pr":1724,"file":"src/ui/state/lihuiyu-usb/lihuiyu-usb-job.ts","line":46,"anchor":"ADR-705 Amd 4 D1; ADR-703 D2 preview = save; twin D2-P1-1","evidence":"REPRO","known":false,"summary":"K40 USB Start/Frame compile without outputScope (LihuiyuUsbDetails.tsx:78 bypasses linkJobRequest): 'Selected artwork only' burns every design; Save .egv honours it"},
  {"id":"D6-P1-2","severity":"P1","area":"structure-and-drift","pr":1724,"file":"src/io/egv/emit-egv.ts","line":84,"anchor":"ADR-127 Amd 2 (Amd 5 fixed .rd only); twin D2-P1-2 / Z3-P1-2","evidence":"REPRO","known":false,"summary":"K40 .egv and USB on a Y-port rotary write one speed per layer with no surface-feed match: strokes round an Ø80 glass on the Creality chuck burn at ~16 % dose (GRBL writes F600/F95)"},
  {"id":"D6-P1-3","severity":"P1","area":"structure-and-drift","pr":1724,"file":"src/core/controllers/lihuiyu/lhy-motion-plan.ts","line":57,"anchor":"ADR-705 Amd 2/Amd 4 D3; ADR-052 Amd 2; ADR-040; twins D2-P1-3, D1-P1-2","evidence":"REPRO","known":false,"summary":"K40 Fill ignores layer and device bidirectional scan offset (stream identical at 0 and 0.6 mm; G-code changes); K40 Image rows read neither offset nor Dot width (READ)"},
  {"id":"D6-P2-1","severity":"P2","area":"structure-and-drift","pr":1724,"file":"src/io/egv/emit-egv.ts","line":93,"anchor":"ADR-705 Amd 4 D1/D4; twins D2-P2-1, D2-P2-3","evidence":"READ","known":false,"summary":"Save .egv and K40 USB never call detectMachineJobWarnings; the K40 USB job never advances 'After completed job' variables"},
  {"id":"D6-P2-2","severity":"P2","area":"structure-and-drift","file":"src/ui/app/use-autosave.ts","line":108,"anchor":"ADR-305 Amd 1 (A4-P2-1); ADR-705 Amd 3 D3; D4-P2-1 shape","evidence":"READ","known":false,"summary":"Autosave job gate reads only the laser streamer: during Moshi/Ruida/K40 jobs every autosave runs unconditionally on the canvas thread"},
  {"id":"D6-P3-1","severity":"P3","area":"structure-and-drift","file":"src/core/util/shared-helpers-not-copied.test.ts","line":115,"anchor":"C1 C2-P3-1","evidence":"REPRO","known":false,"summary":"Copy guard renames parameters only and compares arrow vs braced bodies as different; polylineLengthMm (Z4-P1-1 fix), sleep, samePoint copies slipped; 3+-file groups 89 -> 97 since the sweep"},
  {"id":"D6-P3-2","severity":"P3","area":"structure-and-drift","file":"src/core/controllers/moshi/moshi-live-commands.ts","line":32,"anchor":"C1 C2-P3-2 / #1700","evidence":"REPRO","known":false,"summary":"5 new dead exports since the sweep (7 -> 12) and no CI check; unused CH341_VENDOR_STATUS_REQUEST beside ch341-epp.ts GET_STATUS = 0x52"},
  {"id":"D6-P3-3","severity":"P3","area":"structure-and-drift","file":"src/io/project/old-project-rotary-feed.ts","line":90,"anchor":"ADR-127 Amd 4 D2","evidence":"REPRO","known":false,"summary":"Cross-hatch/turned pass counted as a stroke round the part, not across the hatch: 45° cross-hatch notice says 6.28× for a real 1.40× change"},
  {"id":"D6-P3-4","severity":"P3","area":"structure-and-drift","file":"src/ui/state/app-dialogs.ts","line":30,"anchor":"ADR-705 Amd 3 D3; ADR-707 D2","evidence":"READ","known":false,"summary":"appConfirm/appPrompt refuseDuringJob reads only the laser store; 53 files ask isActiveJob vs 10 that consult link work; no type forces a link store to register"},
  {"id":"D6-P3-5","severity":"P3","area":"structure-and-drift","file":"PROJECT.md","line":502,"anchor":"NN 15; ADR-015; Definition of done","evidence":"READ","known":false,"summary":"'components ≤ 250 hard' is not enforced (96 components over); 'no file exceeds 400 lines' counts code lines in src/electron only; CLAUDE.md cited as the manual it no longer is"},
  {"id":"D6-P3-6","severity":"P3","area":"structure-and-drift","file":"src/ui/state/lihuiyu-usb/lihuiyu-usb-job.ts","line":1,"anchor":"comments vs code","evidence":"READ","known":false,"summary":"Comments claim K40 USB = Save .egv, .egv runs the G-code save's checks, job warnings serve 'both call sites', autosave gate covers every route, tests exempt from size limits"},
  {"id":"D6-P3-7","severity":"P3","area":"structure-and-drift","file":"docs/decisions/ADR-697-live-ruida-control-over-udp-on-the-desktop.md","line":77,"anchor":"ADR amendment convention","evidence":"READ","known":false,"summary":"Base ADRs (697 D5, 695 D5, 705 D3; 68 of 194 amended bases) carry no pointer to amendments that changed their decisions"},
  {"id":"D6-P3-8","severity":"P3","area":"structure-and-drift","file":"scripts/performance-audit/worker-scheduling.test.ts","line":1,"anchor":"C1-P2-2 class","evidence":"REPRO","known":false,"summary":"A Vitest file on real worker clients runs in no CI job or typecheck; the listed-tests guard checks .test.mjs only (passes 4/4 today)"}
]
```

Auditor counts: raised 13, P1 3, P2 2, P3 8, known 7

## Refuter (2026-11-12)

**Tree.** The latest `origin/main` is `d7e55dd71` (merge of #1818). It is 48 commits past the auditor's `a74e38540`.
- It is exported with `git archive` into `scratchpad\zz-d6r\tree`, with its own `node_modules` junction. Nothing in `j32-main` was edited.
- `git log a74e38540..d7e55dd71` names no commit that touches the K40 output route: `core/controllers/lihuiyu`, `io/egv`, `save-egv-action`, `lihuiyu-usb-job` or `LihuiyuUsbDetails`.
- #1818 (`d2610eb4f`, ADR-705 Amd 6) changes only the link machine-work registry, the K40 store's link-work reports, the wake lock, the crash screen and the unsaved guard. It does not touch `use-autosave.ts`, `app-dialogs.ts` or the first-job guide.
- So every K40 finding below is re-run on `d7e55dd71`.

**Harness.**
- My own scripts are in `scratchpad\zz-d6r\`. They run with `node --no-experimental-webstorage --import ./register.mjs <file>`, using the auditor's loader, copied and pointed at `zz-d6r\tree`. The `zz-d6` scripts were read for API shape only.
- Streams are decoded with the repo's `LhyDecoder` fixture. Speeds are read back with `lhySpeedFromCode`.
- P1-1 is driven through the real app store (`useStore`) and the panel's exact call. The doses come from my own chuck model over the decoded moves.
- The file-cap counts come from ESLint's own `max-lines` rule (`r4-cap.mjs`), not from a line scanner.
- No Vitest and no browser run; free memory was 2.8–3.0 GB. No hardware, USB, network, live service, download, pnpm or build.

### Verdicts

| ID | Verdict | Severity | Holds on |
|---|---|---|---|
| D6-P1-1 | CONFIRMED (the scope half). The anchor half cannot be told apart, see below | P1 kept | `d7e55dd71` |
| D6-P1-2 | CONFIRMED, including my own dose model and USB | P1 kept | `d7e55dd71` |
| D6-P1-3 | CONFIRMED for Fill and Image, by bytes, including Dot width | P1 kept | `d7e55dd71` |
| D6-P2-1 | CONFIRMED, now by REPRO (was READ) | P2 kept | `d7e55dd71` |
| D6-P2-2 | CONFIRMED, with the cost measured | P2 kept | `d7e55dd71` |
| D6-P3-1 | CONFIRMED; mechanism partly corrected | P3 | `a74e38540` / `d7e55dd71` |
| D6-P3-2 | CONFIRMED (all 5 still dead) | P3 | `d7e55dd71` |
| D6-P3-3 | CONFIRMED, and worse for turned passes | **P3 → P2** | `d7e55dd71` |
| D6-P3-4 | CONFIRMED (READ) | P3 | `d7e55dd71` |
| D6-P3-5 | CONFIRMED | P3 | `d7e55dd71` |
| D6-P3-6 | CONFIRMED, plus one more stale comment | P3 | `d7e55dd71` |
| D6-P3-7 | CONFIRMED for the three named bases | P3 | `d7e55dd71` |
| D6-P3-8 | CONFIRMED | P3 | `d7e55dd71` |

**D6-P1-1. CONFIRMED, P1.** REPRO `r1-k40-p1s.mts`, part 1.
- **The setup.** The real `useStore` holds the project: tag A at X 20–40 is selected, and tag B is at X 150–170. `outputScopeSettings.cutSelectedGraphics` is true, and `jobPlacement.startFrom` is User Origin.
  - `currentLinkJobRequest()` returns the scope `{selectedObjectIds:["A"]}`.
  - The USB job is built exactly as `LihuiyuUsbDetails.tsx:77-78` builds it, from `useStore.getState()`.
- **The decoded burns, with the same placement on both sides** (Save with `resolveExportJobPlacement`'s `jobOrigin` plus the scope, as `handleSaveEgv` does):
  - Save `.egv`: 4 burns over X 0–20 mm, so A only.
  - K40 USB: 8 burns over X 0–150 mm, so A and B. The USB stream is 173 bytes, Save's is 82.
- **"Anchor from selected artwork":** that checkbox shows only while "Selected artwork only" is on (`JobPlacementControls.tsx:107`). In this case, Save's stream is the same with the anchor on or off, so the anchor half is not observable on its own. The scope half alone carries the P1.
- **Reachable:**
  - `JobPlacementControls` has no controller gate. It is the same placement dropdown the Moshi and Ruida panels read, as the D2 refuter showed.
  - The K40 panel (`ControllerConnectionControls.tsx:156`) shows no notice that the scope is ignored.
  - Not driven in a browser.

**D6-P1-2. CONFIRMED, P1.** REPRO `r1-k40-p1s.mts`, part 2.
- **Reachable:**
  - `rotaryAxesForController(K40_M2_NANO_PROFILE)` is `["Y"]`, so Rotary Setup offers Y for the K40.
  - Device Setup's "Rotary attachment" section (`DeviceSetupOptionsStep.tsx:150-155`), the command-palette `rotary` entry and the Rotary switch all have no controller gate.
  - With rotary on Y, `rotaryAppliesTo` is true and `rotaryOutputAxis` is null, so `emitPreparedEgvFile`'s refusal at `emit-egv.ts:76-81` (A/Z only) never fires.
- **Bytes:** Creality chuck, 40 mm per turn, Ø80, a 20 mm Line square at 600 mm/min.
  - The `.egv` stream holds 1 speed code. The encoder writes `CV2452421011000060C` for 10 mm/s; the decoder drops the `C` suffix, and the code reads back as 9.998 mm/s.
  - The only advisory is the M2 power-knob note.
  - The K40 USB job (User Origin) also carries 1 distinct speed code.
  - GRBL, same job: `F600` and `F95`.
- **My own chuck model** gives k = 40 / (π·80) = 0.1592. Per decoded burn, the surface speed is the code's speed × surface length / machine length:

  | Burn | Machine mm | Surface mm | Surface speed | Dose |
  |---|---|---|---|---|
  | along X | 20.02 | 20.02 | 600 mm/min | 100 % |
  | round the part | 3.17 | 19.95 | 3,769 mm/min | **15.9 %** |

  A 360 mm/turn roller on an Ø25 part gives k = 4.584: still 1 speed code, so 458 % dose round the part.
- **Can the K40 protocol change speed mid-program? Yes, at a cost.**
  - The speed code is set only when program mode is entered. `LhyWriter.enterProgram` (`lhy-writer.ts:68-83`) already leaves program mode (`FNSE-`) and re-enters it with `I<code>N…S1E` whenever the code differs.
  - So a per-stroke speed is possible with today's writer. Each change costs a program exit. The writer's own notes say `FNSE-` makes the host wait for the board to finish, so the head stops at each change.
  - Line parts already travel in rapid mode between polylines (`lhy-encoder.ts:122-127`), so a speed per polyline costs nothing extra. A speed change inside one polyline (a square's corners) adds a stop at each change.
  - This is from KerfDesk's writer, which cites MeerK40t's driver. MeerK40t itself was not consulted (nothing downloaded).
  - The fix directions stand; refusing a Y-rotary K40 job is the cheap interim.

**D6-P1-3. CONFIRMED for Fill and Image, by bytes, P1.** REPRO `r1-k40-p1s.mts`, part 3.
- **Fill** (a 20 mm square, 6000 mm/min, two-way): the `.egv` hash is `a5bff216` in all four cases (layer offset 0 or 0.6 mm; device table empty or `{6000: 0.6}`). The G-code control changes from `803fc89a` to `39ff5cd2`.
  - The prepared Fill group does carry `bidirectionalScanOffsetMm = 0.6`, so the value is dropped in `lhy-motion-plan.ts:57-80`, not upstream.
- **Image** (a real `raster-image` object, 20 × 4 px, two-way, 6000 mm/min, through `emitEgvFile`):

  | Case | `.egv` hash | Prepared group | G-code hash |
  |---|---|---|---|
  | baseline | `83cb6cce` | offset –, dot 0 | `880b9547` |
  | layer offset 0.6 | `83cb6cce` | offset 0.6 | `909a5523` |
  | device table {6000: 0.6} | `83cb6cce` | – | `909a5523` |
  | Dot width 0.2 | `83cb6cce` | dot 0.1 | `65a0ea22` |

  - The first decoded K40 burns are identical in every case (32.99 → 46.99 → 32.99 mm).
  - `rasterSteps` (`lhy-motion-plan.ts:82-105`) reads only `group.bidirectional`.
- **Reachable:**
  - Device Setup's "Raster scan-offset calibration" (`DeviceSetupOptionsStep.tsx:109-120`) has no controller gate.
  - `validatedScanOffsetMm` ignores the device (`scan-offset.ts:46-53`).
  - The layer value is set by the measured-offset apply, recipes and imports, and `object-properties-actions.ts:314` also writes it.
  - The shared Job Review warning even tells a K40 user to "calibrate these speeds" (see D6-P2-1), and calibrating changes nothing on this route.

**D6-P2-1. CONFIRMED, now by REPRO, P2.** `r5-k40-warnings-guide.mts`, part (a): `detectMachineJobWarnings` is compared with what `.egv` and K40 USB actually show for the same prepared job.

| Case | Shared warnings | `.egv` / USB advisories | Shared warnings missing from `.egv` |
|---|---|---|---|
| Line, kerf −3 mm, a 2 mm square and a 20 mm square | 1 | 1 / 1 | 1: "…shrank 1 part … to nothing … will NOT be cut" |
| Fill, two-way, 18000 mm/min | 2 | 2 / 2 | 2: the runway and the scan-offset table |
| Fill, 0.01 mm interval | 1 | 1 / 1 | 1 |

- The `.egv` and USB advisories present are the M2 power note and the preflight notes, not the shared list.
- `grep` on `d7e55dd71`: still no `detectMachineJobWarnings` under `io/egv`, `save-egv-action` or `lihuiyu-usb`, and no `advanceVariablesAfter` or `linkJobRequest` in the K40 store or panel.
- P2 is kept to match the ledger's twin D2-P2-1. The kerf row is the D2 refuter's P1 argument (a part silently not cut). If the coordinator re-rates the twin, re-rate this one with it.

**D6-P2-2. CONFIRMED, P2.**
- **READ on `d7e55dd71`:** `use-autosave.ts:104-118` still sets `isStreaming` from `useLaserStore…streamer` only. #1818 now puts the K40 in `anyMachineJobActive()`, so the fix is one call.
- **Cost (REPRO `r2-autosave-cost.mts`, Node 25.8.2 on this PC).** `structuredClone` stands in for postMessage's clone; `JSON.stringify` stands in for the text the localStorage fallback builds synchronously.

  | Project | Gate weight | Laser job | Link job | Clone | Stringify |
  |---|---|---|---|---|---|
  | 1 photo, 5 M chars | 5.0 M | write | write | 3.8 ms | 6.0 ms |
  | 1 photo, 22 M chars | 22.0 M | write | write | 17.9 ms | 26.6 ms |
  | 2 photos, 88 M chars | 88.0 M | **wait** | **write** | 61.9 ms | 140.7 ms |
  | 10,000 small shapes | 42.8 M | **wait** | **write** | 43.1 ms | 11.2 ms |

  - Only projects over the 30 M weight limit differ, and those cost 43–62 ms of canvas-thread clone here. That is above the 30 ms the gate was built to cap (`AUTOSAVE_JOB_HAND_OFF_LIMIT_MS`), and it repeats every 30 s with no slow-hand-off latch.
  - The localStorage fallback (after an IndexedDB failure) adds a synchronous stringify of the whole project: 141 ms at 88 M.
  - These agree with the Chrome figures in `autosave-hand-off-weight.ts:17-20` (53–80 ms at 88 M; 21–46 ms for 10,000 objects).
- **Harm is probabilistic:**
  - A K40 or Moshi job is refilled from the window. A Ruida job runs from controller memory after upload, so only its upload is exposed.
  - Whether a 40–140 ms stall drains the board's buffer depends on the job's bytes per second and the board's buffer, and both are unmeasured.
  - The audit's P2 definition (a real defect with limited harm) fits. P3 would fit only if realistic projects stayed under the weight limit, and two photos or 10,000 shapes are realistic.

**D6-P3-1. CONFIRMED, with the mechanism partly corrected.**
- The guard **does** normalise an outer expression body: `shared-helpers-not-copied.test.ts:136` rewrites `=> expr` as `{ return expr; }`.
- **The K40 `sleep` slips because of its nested callback, not its arrow form.**
  - The shared `ui/common/sleep.ts` has `(resolve) => { setTimeout(resolve, ms); }`.
  - The copies (`lihuiyu-usb-store.ts:63`, `head-capture-store.ts:347`, `unowned-motion-stop.ts:177`) have `(resolve) => setTimeout(resolve, ms)`.
- **`polylineLengthMm`** (`fill-sweeps.ts:46`) is confirmed: it is `point-math.ts:62` `polylineLength`, with `i` in place of `index`.
- **Copy counts.** A definition grep on the sweep tree and on `a74e38540` gives the same increases the census reports: `samePoint` +2, `sleep` +1, `distanceToSegment` +1, `encodeBase64` +1. My absolute counts are higher (39 / 5 / 11 / 4) because the grep is broader.
- **Correction:** the two new `samePoint` copies are `lihuiyu-usb-store.ts` and **`core/controllers/ruida/rd-rotary-feed.ts:110`**. `laser-second-pass/program-writer.ts:99` was already there at the sweep.

**D6-P3-2. CONFIRMED.**
- On `d7e55dd71`, each of `LIHUIYU_BOARDS`, `CH341_VENDOR_STATUS_REQUEST`, `CH341_VENDOR_STATUS_LENGTH` (the report's "`_LENGTH`"), `dimensionEntityIds` and `isProcedure` appears only in its own file.
- The same holds for the 7 older entries, so the total of 12 holds.

**D6-P3-3. CONFIRMED; severity P3 → P2.** REPRO `r3-crosshatch.mts`. The real change is measured from the compiled Fill segments (surface length / machine length, k = 0.1592), not from the formula.

| Layer | Notice | Compiled stroke angles | Real worst change |
|---|---|---|---|
| 45° | 1.40× | 45° | 1.40× |
| 45°, cross-hatch | **6.28×** | 45° / 135° | 1.40× |
| 30°, cross-hatch | **6.28×** | 30° / 120° | 1.93× |
| 45°, 3 passes turned 30° | **6.28×** | 45° / 75° / 105° | 3.32× |
| 0°, cross-hatch | 6.28× | 0° / 90° | 6.28× |

- `fill-hatching-cache.ts:39-48` compiles the cross-hatch at hatch + 90°. `strokeAngles` adds 90° flat (`old-project-rotary-feed.ts:90`).
- **Why P2:** the operator is shown a wrong number, up to 4.5× too high, in words that tell them to retune ("If you tuned power or speed for the old burn, set them again"). That is a real defect, and the audit's P3 means no defect behind it. The harm is limited: the notice is one-time, it asks for a test, and it reaches only ≤1.0.30 rotary projects with an angled cross-hatch or turned passes.

**D6-P3-4. CONFIRMED (READ, `d7e55dd71`).** `app-dialogs.ts:21,29-30` still reads `isActiveJob(useLaserStore…streamer)`. #1818 did not touch it. Its one caller is still `machine-offer.ts`.

**D6-P3-5. CONFIRMED.**
- `PROJECT.md:502` ("components ≤ 250 hard"), `:815` ("no component > 250 lines") and `:523` ("No file in the repo exceeds 400 lines. Enforced by ESLint") are as quoted.
- `CLAUDE.md` is 7 lines.
- `eslint.config.mjs:162` is the only `max-lines` rule.

**D6-P3-6. CONFIRMED,** with one more stale comment of the same kind: `scripts/check-soft-line-limit.mjs:4` says the 250 tier comes "from CLAUDE.md's size table", and `CLAUDE.md` has no size table now. The test-exemption comment at `:26-28` is wrong, as reported: `check-file-size-policy.mjs:5-10` and `eslint.config.mjs:383-390` show that tests keep `max-lines`.

**D6-P3-7. CONFIRMED for the named bases.** The ADR-697, ADR-695 and ADR-705 base files never mention an amendment of their own; `grep "Amendment"` finds none there. The figure "68 of 194" was not recounted.

**D6-P3-8. CONFIRMED.**
- `scripts/performance-audit/` holds `vitest.config.ts` and `worker-scheduling.test.ts`.
- No workflow references it. `package.json` lists only that folder's `.test.mjs` files (in `test:release-integrity`). The root Vitest `include` is `src/**` and `electron/**`.

**KNOWN.**
- **Closed by #1818 on `d7e55dd71`:** D4-P1-1 and D4-P2-1/2/3 (the auditor's NN 9 row and KNOWN list say "still open on `a74e38540`").
  - `LINK_MACHINE_SOURCES` now includes `lihuiyu-usb`.
  - The K40 store calls `reportLinkMachineWork` (`lihuiyu-usb-store.ts:402`).
  - The wake lock and the unsaved guard read `anyMachineJobActive()`.
- **Still open:** Z2-P3-1, D2-P3-2, D3-P2-2 and D3-P1-3/4, C1's decisions and C1-P1-2.

### Spot-checks

**Drift numbers.**
- **Files at the cap.** ESLint's own `max-lines` count (skipBlankLines + skipComments) on shipped `src` and `electron`:

  | Tree | Files | Over 400 | At 400 | ≥ 395 | ≥ 380 |
  |---|---|---|---|---|---|
  | `a74e38540` | 5,692 | 0 | 6 | 29 | 69 |
  | `d7e55dd71` | 5,703 | 0 | 7 | 28 | 70 |

  - The `a74e38540` figures match the auditor's exactly. Since then, `store.ts` has reached 400 too.
  - Riskiest-five sizes on `d7e55dd71`: `laser-line-handler.ts` 400, `laser-store.ts` 400, `laser-store-helpers.ts` 399, `job-review-gate.ts` 398, `laser-job-stop.ts` 388.
- **Dead exports, 7 → 12:** confirmed by whole-word grep on `d7e55dd71`. All 12 are referenced only in their own file.
- **Copy groups, 89 → 97.** Not re-censused. I spot-checked 4 of the 14 grown groups by grep against the sweep tree:
  - `withLayerLabel`: 1 → 3 files (`rd`, then `egv` and `moshi`);
  - `encodeBase64`: + `desktop-ruida-network.ts`;
  - `sleep`: + the K40 store;
  - `samePoint`: + the K40 store and `rd-rotary-feed.ts`.

  All four are real. The `jobActive` "0 → 3" group is not a new copy: the same three functions existed at the sweep with an `isActiveJob(useLaserStore…)` body, and #1753 changed the body. That group's old body vanished at the same time, so the net count is unaffected.

**ADR "Holds" rows** (6 checked on `d7e55dd71`; all hold):

| Row | Check |
|---|---|
| 5 | `FIRST_MATCHED_FEED_SCHEMA = 22`, used as `version < 22` (`old-project-burn-notice.ts:91`) |
| 8 | `CLASS_STEPS = [1.05, 1.1, 1.2]`, tried in turn (`rd-rotary-feed.ts:25,38-43`) |
| 10 | `PHASES = 8` (`ui/laser/job-review/rotary-row-placement.ts:23`) |
| 11 | `CLEARS_ORIGIN_AT_RESET = ['grbl-v1.1', 'fluidnc']`, `ABORT_AUTO_RESTORE_WINDOW_MS = 10_000` (the files are in `src/ui/laser/`) |
| 16 | 1,000 / 15,000 / 2,000 / 10,000 ms constants; ordered-probe kinds GRBL, grblHAL, FluidNC (`laser-lost-ack-reconcile.ts`, `laser-motion-reply-probe.ts:115-122`) |
| 30 | key prefix `kerfdesk.dont-ask-again.v1.`; every access in try/catch (`dont-ask-again.ts:9-43`) |

**Extra ADR checks.**
- **ADR-709 (align fallback) holds.** `referencedSelection` uses a valid click record, else `firstInDrawOrder`. Locked objects and objects on hidden layers are filtered (`selection-transform-actions.ts:262-279,400-407`). The remote tool keeps `requested.at(-1)`, as the ADR says.
- **ADR-708 (toast rules) is not on main.** PR #1748 is still open, so there was nothing to check.
- **ADR-698 drifts:** D6-P2-3 below.

### New findings

**D6-P2-3 — On a K40, Moshi or Ruida profile, the guided first job (ADR-698) can never get past "Connect your laser"**
- **Where:** `src/ui/first-job/use-first-job-signals.ts:26,31,38,48`. The signals for connected, Frame and job-started read `useLaserStore` only (connection, `currentCompletedFrame`, streamer).
- **Anchor:**
  - ADR-698 D1: "Each step is done when the app's own state says so: the controller connection; … the same Frame evidence Start uses; a streaming, paused or tool-change job";
  - ADR-705 Amd 3 D3 and Amd 6 (link work is machine work).
- **Evidence:** REPRO `r5-k40-warnings-guide.mts`, part (b).
  - `isFileOnlyController` is true for `lihuiyu`, `moshi` and `ruida`, so the serial Connect the guide points at is disabled (`ControllerConnectionControls.tsx:71,132`).
  - With the K40 store in `phase: 'running'`, the guide's own reads give `connected=false` and `jobStarted=false`.
  - `firstJobProgress` stays at `current: 'connect'` even with every step in the skipped set: Connect, Frame and Start are not skippable (`first-job-steps.ts:55,93,103`).
  - The K40 Frame never records laser-store Frame evidence, so the Frame step could not complete either.
  - The step text still says "press Connect in the machine controls".
- **Scenario:** a new K40 owner (the stock beginner machine) opens Help → Guided first job. The guide points at a greyed-out Connect, says nothing about the "Connect K40" button, and never moves on. This holds even while their job is burning.
- **Severity:** P2. A real, user-visible failure of a feature on three controller families today. The harm is limited: no burn changes, and the guide adds no Start guard.
- **Fix direction:**
  - read connection and job state from one route-neutral source: `anyMachineJobActive()`, plus a link-connected query over `LINK_MACHINE_SOURCES`;
  - take Frame evidence from the active route's own permit (`board.framed` for the K40);
  - point "Show me" at the link panel's Connect on file-only profiles.

### Not verified

- No browser run of any finding. Visibility of "Selected artwork only" and of Rotary Setup with a K40 profile is READ: the components have no controller gate.
- The board-side effect of a 40–140 ms window stall during a K40 or Moshi job (buffer depth, beam flag), on hardware or in a simulator.
- MeerK40t's own handling of speed changes mid-job. KerfDesk's writer comments are the only source here; nothing was downloaded.
- The full copy-group census (89 → 97) and the "68 of 194 amended bases" figure. I spot-checked them, not recounted.
- D6-P3-6's other comments and the ADR name and path check were not re-run.

### Repro files

All files are in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-d6r\`. Run the `.mts` files with `node --no-experimental-webstorage --import ./register.mjs <file>`.

| File | Covers | Output |
|---|---|---|
| `tree\` | `git archive` of `d7e55dd71`, `node_modules` a junction | – |
| `register.mjs`, `ts-resolve.mjs` | the auditor's loader, pointed at `tree` | – |
| `r1-k40-p1s.mts` | P1-1, P1-2, P1-3 | `out\r1-k40-p1s.txt` |
| `r2-autosave-cost.mts` | P2-2 | `out\r2-autosave-cost.txt` |
| `r3-crosshatch.mts` | P3-3 | `out\r3-crosshatch.txt` |
| `r4-cap.mjs <tree> <label>` | ESLint `max-lines` census | `out\r4-cap-a74e38540.txt`, `out\r4-cap-d7e55dd71.txt` |
| `r5-k40-warnings-guide.mts` | P2-1, D6-P2-3 | `out\r5-k40-warnings-guide.txt` |
| – | helper definitions: sweep vs `a74e38540` | `out\def-*.txt` |

```json
[
  {"id":"D6-P1-1","verdict":"CONFIRMED","severity":"P1","main":"d7e55dd71","evidence":"REPRO","note":"Real useStore + panel call: Save .egv 4 burns X 0-20 (A only); K40 USB 8 burns X 0-150 (A and B); anchor half not separately observable"},
  {"id":"D6-P1-2","verdict":"CONFIRMED","severity":"P1","main":"d7e55dd71","evidence":"REPRO","note":"Rotary Setup offers Y for lihuiyu; one speed code (9.998 mm/s) in .egv and USB; own chuck model: round-the-part 3769 mm/min = 15.9 % dose; roller k 4.584 = 458 %; writer can change speed only via a program exit (FNSE-)"},
  {"id":"D6-P1-3","verdict":"CONFIRMED","severity":"P1","main":"d7e55dd71","evidence":"REPRO","note":"Fill .egv a5bff216 in all 4 offset cases; Image .egv 83cb6cce for baseline, layer offset 0.6, device table and Dot width 0.2 while G-code changes; prepared groups carry the values"},
  {"id":"D6-P2-1","verdict":"CONFIRMED","severity":"P2","main":"d7e55dd71","evidence":"REPRO","note":"'will NOT be cut' kerf warning, Fill runway and scan-table warnings absent from .egv and USB advisories"},
  {"id":"D6-P2-2","verdict":"CONFIRMED","severity":"P2","main":"d7e55dd71","evidence":"REPRO","note":"Over-limit projects the gate holds during laser jobs are written during link jobs: 43-62 ms clone, 141 ms stringify at 88 M chars (Node); board-side effect unmeasured"},
  {"id":"D6-P3-1","verdict":"CONFIRMED","severity":"P3","main":"d7e55dd71","evidence":"REPRO","note":"Guard already normalises outer expression bodies; misses nested-callback braces and local names; new samePoint copies are lihuiyu-usb-store and rd-rotary-feed (not laser-second-pass)"},
  {"id":"D6-P3-2","verdict":"CONFIRMED","severity":"P3","main":"d7e55dd71","evidence":"REPRO","note":"All 12 dead exports still referenced only in their own file"},
  {"id":"D6-P3-3","verdict":"CONFIRMED","severity":"P2","from":"P3","main":"d7e55dd71","evidence":"REPRO","note":"From compiled strokes: 45 cross 6.28x vs 1.40x, 30 cross 6.28x vs 1.93x, turned passes 6.28x vs 3.32x; wrong number that tells the operator to retune"},
  {"id":"D6-P3-4","verdict":"CONFIRMED","severity":"P3","main":"d7e55dd71","evidence":"READ"},
  {"id":"D6-P3-5","verdict":"CONFIRMED","severity":"P3","main":"d7e55dd71","evidence":"READ"},
  {"id":"D6-P3-6","verdict":"CONFIRMED","severity":"P3","main":"d7e55dd71","evidence":"READ","note":"plus check-soft-line-limit.mjs:4 cites CLAUDE.md's size table"},
  {"id":"D6-P3-7","verdict":"CONFIRMED","severity":"P3","main":"d7e55dd71","evidence":"READ","note":"named bases only; 68/194 not recounted"},
  {"id":"D6-P3-8","verdict":"CONFIRMED","severity":"P3","main":"d7e55dd71","evidence":"READ"},
  {"id":"D6-P2-3","verdict":"NEW","severity":"P2","area":"structure-and-drift","file":"src/ui/first-job/use-first-job-signals.ts","line":26,"anchor":"ADR-698 D1; ADR-705 Amd 3 D3 / Amd 6","main":"d7e55dd71","evidence":"REPRO","known":false,"summary":"Guided first job reads only useLaserStore for connect/frame/start; on file-only K40, Moshi and Ruida profiles the non-skippable Connect step never completes, even during a running link job, and points at a disabled Connect"}
]
```

Refuter counts: raised 14, refuted 0, P1 3, P2 4, P3 7, known 5
