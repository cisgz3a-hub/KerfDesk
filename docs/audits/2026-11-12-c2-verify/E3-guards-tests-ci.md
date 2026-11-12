# E3 — guards, tests and CI (C2 fix verification)

**Question.** Do the C2 test (D3) and CI (D7) fixes do what they claim on `main`: does every new test kill its D3 mutant, are the D7 CI defects gone, does the new `main-is-green` status stop merges onto a red `main`, and does the camera overlay guard still catch a real camera long task? And, closing the round: do the fixes merged since E1/E2 (#1831, #1832, #1833, #1836) hold when E1's and E2's repros are re-run?

**Tree.** `origin/main` @ `8546953c6` (#1836), read-only export `j35-main`. Every PR in scope is an ancestor: #1808 `a74e38540`, #1828 `ca8734ce8`, #1827 `52c545886`, #1829 `1065be2af`, #1833 `e6f1ebcbe`, #1832 `f6401fc63`, #1831 `a1ca4f5ca`, #1836 `8546953c6`. Anchors below are on that tree. Mutation ran only in a copy (`zz-e3\mut`, `node_modules` junction); every mutated file was compared with `j35-main` after each run (`cmp`, all equal).

**Method.**
- **D3 mutants (#1829).** D3's own harness (`run-mutants.mjs`, copied unchanged) applied D3's mutant text from `zz-d3\mutants.json` to `mut`, one at a time, and ran Vitest 4 (one worker, bail 1, memory gate 1.5 GB) on the new or changed test file that #1829 names for that mutant. A clean baseline of all 11 touched test files passed first (90 tests). Then:
  - the 20 P2-gap mutants plus J06;
  - X10 in the form main needs (the D3 text no longer applies: main reads `reportedTurnScale`), plus a second X10 mutant inside `reportedTurnScale` itself;
  - four variants to check that the tests are not tuned to one spelling (T14 sampled at the end point; J03 through `startPreparationIsTimeBound`; J06 alone; J05 + J06 together);
  - the six P3 survivors whose module #1829 touched (X06, X09, X14, J12, T13, B08), against the new files.
- **Simulators.** READ of #1829's fixture diff and of main's `grbl-sim-lines.ts`, `fake-serial-port.ts`.
- **D7 (#1827).** READ of the Abort guard; a Node check of `functionSampleCounts` with inherited names. The PR smoke selector (`scripts/run-pr-browser-smoke.mjs` from `j35-main`) was run on main's `e2e/` for every non-spec e2e file (`sel.mjs`). An own import-graph walk (`graph.mjs`) approximates Playwright `--only-changed` for `src/` changes. `timeout-minutes` and `globalTimeout` were checked by READ.
- **`main-is-green` (#1828).** READ of the workflow and script; read-only `gh` for the 32 sync runs so far (logs: verdict and writes), ruleset 19573147 and the `fixes-main` label.
- **#1808.** Synthetic CPU profiles replayed through the real `attributeLongTasks` (`attr.mts`), plus READ of the cache fix and its callers.
- **CI re-measure.** Read-only `gh`: all CI and Browser smoke runs and their 518 jobs from 2026-11-12 07:48 to 13:24 UTC.
- **E1/E2 repros.** Copied from `zz-e1`, `zz-e1r`, `zz-e2` and `zz-e2r`, re-pointed at `j35-main`, and run unchanged. Security payloads (E1-P1-1) were re-run and probed further; their details are only in `zz-e3\SECURITY-DETAILS.md`. New probes: significant-digit DXF angles, the app's `.rd` ETA, the K40 Abort after home/jog, and a camera row in Job Review's reuse test.
- **Not used:** hardware, a browser, pnpm, building, live services (except read-only `gh` GETs on this repo).

## Headline

**#1829 does what it says.** All 20 targeted D3 mutants are killed by the test #1829 names: R10, R11, X01, X02, X05, X07, X10, X11, X13, P06, P14, T14, J01, J03, J04, J05, J08, J09, J14 and B03. So are the variants (T14 at the end point, J03 inside the time-bound check, X10 inside `reportedTurnScale`). J06 survives alone and dies with J05, which confirms #1829's equivalence argument. Two things remain:
- The simulators still model no motion time, no arcs and no open-port write failure. #1829 added only `$13=1` inch reports, so D3-P3-7 is open.
- One of #1829's own side notes is real: **Job Review's reuse check never sees camera facts (E3-P2-1).** Turning camera placement on, or confirming a camera position, while the review is open does not force a recompile, and Confirm binds bytes whose warnings miss the camera warning (4 warnings, where a fresh compile has 5).

**#1827:** D7-P2-1 is fixed (0 inherited-name hits, against 6 of 6 with the old code). D7-P2-2 is fixed: `generate.mjs` alone now selects 12 specs, not 141, and every PR in the window selected 11–15. D7-P3-1 is fixed for jobs, but Playwright `globalTimeout` is still missing.

**#1828 works as designed but is not yet in force.**
- It writes the last *completed* verdict, so a pending `main` keeps the last known one.
- On 2026-11-12 it marked every open PR red within 0.2–19.6 min of `main` turning red.
- 7 merges landed on a red `main` after that, #1836 among them with a `failure` status on its head. The status is not in ruleset 19573147 yet, and the `fixes-main` label does not exist (404).
- Its weak points are timing and fidelity, not correctness (E3-P3-1): the sync waits for a runner, a fix keeps `main` "red" until its own main run completes (about 1 h), and the description names one commit for both workflows.

**#1808 holds.** A synthetic camera task at 60–100 % camera samples fails the guard, and job renders pass. It misses a camera task that is mostly GC or native work (E3-P3-2).

**CI since 07:48 (5.6 h, small window):**
- `main` was red (by `main-is-green`'s own rule) 46 % of the time;
- CI completed on 8 of 34 `main` commits and Browser smoke on 3 of 33, all three red (C2: 47 % and 38 %);
- no job came near its new time limit.

**Closing the round:**
- **#1831 security:** SECURITY (redacted) — fixed for every E1 payload and for E3's own new ones.
- **#1836 K40:** fixed on every E2 repro (dose 101.6–102.2 %, slow-speed floor named, warnings from the Frame, row check, tab note; the home/jog Abort resets the board in about 85 ms).
- **#1833:** the `.rd` ETA now equals the route (31.1 s against 31.1 s), and the notice is right. Ordering is only partly fixed: laser-off travel fell 45–58 %, but rotary reversals rose from 60 to 66 per circle and from 192 to 374 for 8 rings (E3-P2-2).
- **#1832:** fixes E1's exact repros (0 of 146,800 and 0 of 404,280 collapse), but its shared whole-turn tolerance (1e-12) is too tight:
  - **a full DXF ELLIPSE written `0 → 6.28319` (2π rounded up) now imports as a dot, where it was a full ellipse before #1832 (E3-P1-1, regression);**
  - **an ARC `s → s+360` whose angles are printed to 6–12 significant digits still collapses in 4–13 % of cases (E3-P1-2, E1-P1-2 residual).**

## 1. #1829 — D3 test hardening

### Mutants re-run against main's tests

`results-e3.jsonl`, `results-e3b.jsonl`. Baseline: 11 files, 90 tests, pass (`baseline-e3.jsonl`).

| Mutant | D3 gap | Test (#1829) | Result on main | Failing assertion |
|---|---|---|---|---|
| R10 | D3-P1-2→P2 raster feed after controlled seek | `src/core/raster/emit-raster-controlled-seek-feed.test.ts` | **KILLED** | "burns every row at the layer feed on a modal-F GRBL 1.1 profile" |
| R11 | D3-P2-1 zero-length S0 under M3 | `src/core/output/grbl-strategy-m3-lit-drain.test.ts` | **KILLED** | "an S0 gap that rounds to zero length between two burns is not written" |
| X01 | D3-P1-3→P2 Smoothie stream freeze | `src/ui/state/laser-job-stop-smoothie-freeze.simulator.test.ts` | **KILLED** | "keeps the stream errored and sends no job line behind the reset" |
| X02 | D3-P2-2 | `src/ui/state/laser-job-stop-ownership.test.ts` | **KILLED** | "applies no stop outcome until the worker hands the refill back" |
| X05 | D3-P2-2 | same | **KILLED** | "writes no further stop line when 'a new job starts streaming'" |
| X11 | D3-P2-2 | same | **KILLED** | same row |
| X13 | D3-P2-2 | same | **KILLED** | "applies no jog-stop result to the replacement transport" |
| X07 | D3-P2-2 | `src/ui/state/laser-unowned-motion-stop.simulator.test.ts` | **KILLED** | "resets a Console jog at once when the page is closing" |
| X10 (main form: Z not scaled at the call) | D3-P2-3 | `src/ui/laser/rotary-axis-abort.simulator.test.tsx` | **KILLED** | "records the start turn in millimetres" |
| X10b (`reportedTurnScale` returns 1 for Z) | D3-P2-3 | same | **KILLED** | same |
| P06 | D3-P2-4 | `src/core/controllers/grbl/resume-program.test.ts` | **KILLED** | "follows a return from G55 to G54" |
| P14 | D3-P2-4 | same | **KILLED** | "keeps the beam off when the program turned it off with M5" |
| T14 | D3-P2-5 | `src/core/output/rotary-surface-feed.test.ts` | **KILLED** | "matches the feed at the radius under the midpoint of a 40 mm diagonal" |
| T14b (sample at `to.x`) | variant | same | **KILLED** | same |
| J01 | D3-P2-6 | `src/ui/laser/job-review/job-review-gate.recompile.test.ts` | **KILLED** | "asks for a second Confirm when the recompiled bytes differ" |
| J03 | D3-P2-6 | `job-review-gate.variable-clock.test.ts` | **KILLED** | "recompiles a time-bound job at Confirm" |
| J03b (`startPreparationIsTimeBound` ignores variable data) | variant | same | **KILLED** | same |
| J04 | D3-P2-6 | `job-review-gate.recompile.test.ts` | **KILLED** | "recompiles when 'the controller settings were read again'" |
| J05 | D3-P2-6 | same | **KILLED** | "recompiles when 'the controller reported new overrides'" |
| J06 | D3-P2-6 | same | SURVIVED (equivalent while J05's check stands) | — |
| J05 + J06 together | — | same | **KILLED** | confirms #1829's equivalence note |
| J08 | D3-P2-7 | same | **KILLED** | "closes when the compile no longer matches the completed program" |
| J14 | D3-P2-7 | same | **KILLED** | "closes when the job is no longer the completed one" |
| J09 | D3R-P2-1 | same | **KILLED** | "returns no confirmed review and starts nothing" |
| B03 | D3-P2-8 | `src/core/invariants/predicates.test.ts` | **KILLED** | "flags the bulge the offset pushes off the bed" |

**P3 survivors in touched modules, against the new tests only:** X06, X09, X14, J12, T13 and B08 all still survive. They are D3 P3s that #1829 did not target. X09 (a reset write that rejects while the port stays open) has no test. The X01 test holds the Ctrl-X write open but never rejects it. G15, M04, C03, C12, W10 and W11 were not re-run; #1829 does not touch them.

**No mutant behind a P2 gap survives.**

### Simulator fixtures (D3-P3-7)

#1829's fixture change is `formatReportedVec3`: MPos, WCO and `$#` in inches when `$13=1` (`grbl-sim-gcode.ts:92-98`, `grbl-sim-lines.ts:197-201`, `grbl-sim-machine.ts:385-392`). It does not do what D3-P3-7 asked:
- **Motion time:** every motion still takes a fixed `opts.motionMs`, and the position jumps to the target (`grbl-sim-lines.ts:337-346`).
- **Arcs:** G2/G3 are still not motion (`isMotionLine` admits only G0/G1 or no G word, `:335-336`).
- **Open-port write failure:** `fake-serial-port.ts:38-41` still throws only when closed. The Smoothieware freeze test wraps the adapter by hand to hold the write (`laser-job-stop-smoothie-freeze.simulator.test.ts:60-88`), and nothing makes a write reject on a live port.
- **Ruida and Moshi:** busy for a fixed number of reads (unchanged).

**D3-P3-7 stays open (KNOWN P3).**

## 2. #1827 — D7 CI fixes

- **D7-P2-1: fixed.**
  - `e2e/fixtures/profile-function-samples.ts` counts in a `Map` keyed only by the watched names, and `run-gcode-file-abort.e2e.ts:185-188` uses it. **REPRO** `d7p21.mts`: samples named `toString`, `valueOf`, `constructor`, `hasOwnProperty`, `__proto__` and `isPrototypeOf` give `{reviewExternalProgram:0, parseProgram:0}` and no extra keys. The old `name in counts` gives 6 of 6 false hits.
  - The unit spec `e2e/profile-function-samples.spec.ts` covers the same names.
  - None of the 3 Browser smoke failures on `main` in the window came from this guard.
- **D7-P2-2: fixed.** **REPRO** `sel.mjs` runs main's own selector over main's `e2e/` (176 specs, 11 core).
  - `document-import-generated/generate.mjs` alone selects **12** (was 141). `paced-grbl-serial.js` selects 19, `journey-grbl-serial.js` 14, `long-task-attribution.ts` 12, `profile-function-samples.ts` 13.
  - Of 60 non-spec e2e files, 4 select more than 40 and so run the shards: `startup-splash.ts` (143), `browser-apis.js` (142), `kerfdesk-test.ts` (142) and `workspace-ui.ts` (110). These are shared by nearly every spec, so that is correct. 47 files select 1–5.
  - **RUNS:** all 13 "Choose the pull request's browser specs" jobs in the window chose 11–15 specs and the focused job. None fell back to the shards.
- **`src/` changes still reach only the core** (D7-P1-1 option 3, a maintainer decision, KNOWN). By `graph.mjs` (a regex import walk, an approximation of `--only-changed`):
  - 0 specs import, even indirectly, `src/io/postscript/ps-vm.ts`, `src/ui/state/lihuiyu-usb/lihuiyu-usb-store.ts`, `src/ui/laser/LinkMachineWorkBar.tsx` or `src/ui/camera/helpers/view-reference.ts`;
  - 35 reach `grbl-strategy.ts`, and 14 reach `laser-job-stop.ts` and `job-review-gate.ts`.
  - #1831 (the PostScript worker) and #1836 (the K40 store) each ran the 11 core specs only.
- **D7-P3-1: partly fixed.**
  - Every job in `ci.yml` (6), `e2e.yml` (5) and `deploy.yml` (2) has `timeout-minutes`: unit 45, shard 75, PR suite 60, deploy 30 (180 by hand).
  - Playwright `globalTimeout` is still absent: no match in `playwright.config.ts`, `playwright-production.config.ts` or `e2e/`.

## 3. #1828 — `main-is-green` (ADR-710)

**What it computes (READ `scripts/main-is-green.mjs`).**
- **Which run counts.** For each of CI and Browser smoke, it takes the newest run that has *completed*, on `main`, from a `push` or `workflow_dispatch`, and that is not `cancelled`, `skipped` or `stale` (`pickVerdictRun`, `:37-47`).
- **Green or red.** Green only when both succeeded. A red run beats a missing one, and a missing run gives `error` (`mainVerdict`, `:53-82`).
- **Writes.** It sets that state on every open PR into `main`, writing only where it changes. A `fixes-main` label turns any non-green state into `success` (`desiredStatus`, `:85-94`).
- **Triggers.** `workflow_run` (CI or Browser smoke completed on `main`), `pull_request_target` (opened, synchronize, edited, labeled and others) and manual runs. One concurrency group, with no cancel of the run in progress.

**Answers to the brief.**

| Question | Answer | Evidence |
|---|---|---|
| Latest or stale verdict; is a pending `main` red, green or last-known? | **Last-known.** A pending run is skipped, so the status reflects the newest completed run with a verdict. "main is red … on 52c5458" while 1065be2af was pending is that rule. Browser smoke on 1065be2af did complete red at 13:01:37, and the status updated at 13:01:48. | Sync logs 43209857662, 43214086505, 43222944613; PR #1725's head statuses |
| How fast does a verdict reach the PRs? | 0.2–19.6 min after the `main` run completes (6 transitions). The sync job waits for a runner: queue 2 s to 19.5 min, median about 5 min. CI went red at 10:49:15, and the first `failure` statuses were written at 11:08:55. | `gh run view` job start times; sync logs |
| `fixes-main` escape | Works as written: any non-green becomes `success` on a labelled head. It is unconditional, so a PR labelled `fixes-main` that does not fix `main` also merges. **The label does not exist yet** (`GET /labels/fixes-main` → 404). | READ `:85-94`; `gh api` |
| A PR head pushed after the sync | Safe. The new head has no status, so a required check is missing and blocks. The `synchronize` event queues a new sync, which writes it. | READ; the GraphQL `current` is only for `head.oid === headRefOid` (`:136-139`) |
| A `main` commit landing mid-sync | Safe in the end: its run's completion queues another sync, and runs never overlap. Meanwhile the older verdict stands (last-known). | READ concurrency (`main-is-green.yml:35-37`) |
| Fork PRs | `pull_request_target` runs main's copy with `statuses: write`, so a fork head gets its status. If GitHub holds a first-time contributor's run for approval, the status is missing, which blocks (fails safe). | READ; no fork PR in the window |
| Cancelled or superseded `main` runs (D7-P2-3) | Skipped, looking further back. Only the last 30 completed runs are read (`per_page=30`). In this window Browser smoke had 20 cancelled `main` runs in a row (07:48–09:47). A burst of more than 30 merges inside one 80-min Browser smoke run would give `error` on every PR until a run completes. That fails safe, but stops all merges. | `runs-e2e.yml.tsv` |
| Would it block a merge onto red once required? | **Yes, for every head it has written.** On 2026-11-12 every open PR head carried `failure` from 11:08:55, and **7 merges landed on a red `main`** (1065be2af … 8546953c6). #1836 merged at 12:46 with `failure` on its head (written 12:06:35). Today it blocks nothing: ruleset 19573147 requires only the five CI and package contexts, with `integration_id` 15368. | `gh api rulesets/19573147`; sync logs |

**Owner actions still open (from ADR-710; not findings):**
- add `main-is-green` to ruleset 19573147, with integration GitHub Actions, so only this workflow can set it;
- create the `fixes-main` label.

## 4. #1808 — camera overlay guard (ADR-598 Amd 7)

- **Attribution (REPRO `attr.mts`).** Synthetic profiles (0.5 ms samples, a clock marker, one task) went through the real `attributeLongTasks`, with the spec's rule: fail when a task over 50 ms has `cameraShare >= 0.5`.

  | Synthetic task (120 ms unless stated) | cameraShare | Guard |
  |---|---|---|
  | A: camera decode (`/src/ui/camera/helpers/view-reference.ts`) 70 % + React 30 % | 0.70 | **fails (caught)** |
  | A2: camera code calling a shared `/src/core/camera/...` helper, 60 % | 0.60 | **fails (caught)** |
  | F: camera 100 %, 52 ms | 1.00 | **fails (caught)** |
  | B: job status render 100 % | 0.00 | passes |
  | B2: G-code viewer rebuild 90 % + camera 10 % | 0.10 | passes |
  | C: camera texture upload inside `bed-overlay-renderer` (the driver file) 100 % | 0.00 | passes (by design: GPU time on a GPU-less runner) |
  | D: camera decode 45 % + its garbage collection 55 % (GC is a root-level sample) | 0.45 | **passes: E3-P3-2** |
  | D2: camera 49 % + React 51 % | 0.49 | passes (threshold) |
  | E: camera work with no script on the stack (native decode) | 0.00 | passes (left to the structural checks) |

  It catches a real camera long task and does not fail on job renders.
- **The structural checks still hold the rest:** `windowShrinks 0`, `bigPixelReads 0`, `widestUpload ≤ 1920`, and more than 1,000 profile samples (`camera-overlay-mjpeg-ui-thread.e2e.ts:365-381`).
- **Base64 decode cache (READ).** `loadViewReference` keys the decoded thumbnail by storage key and stored text, and re-decodes when either changes (`view-reference.ts:115-150`). Its only caller is `moved-check.ts:78,134`. The reference reaches the picture worker by structured clone: only `frame` is transferred (`camera-picture-client.ts:66`), so the shared `Uint8Array` cannot be detached. Nothing writes to it. The unit test asserts one `atob` for two reads and a fresh read after a new save. **Clean.**
- **Not verified:** a CI run's measured `cameraShare`. The `github` reporter left no "measured" annotation on the shard jobs read.

## 5. CI re-measure (2026-11-12 07:48 → 13:24 UTC, 5.6 h: a small window)

| Measure | C2 D7 (94.8 h) | Now (5.6 h) |
|---|---|---|
| `main` commits with a completed CI verdict | 47 % | **8 of 34 (24 %)**; 26 cancelled while pending |
| `main` commits with a completed Browser smoke verdict | 38 % | **3 of 33 (9 %)**; all 3 red; 8546953c6 still running |
| `main` red (`main-is-green` rule: last completed verdict of either) | Browser smoke red 46 % | **CI red 98 min (29 %), Browser smoke red 136 min and still red (40 %), either red 155 min (46 %)** |
| Time to verdict on `main` | 66 min | CI 36–57 min; Browser smoke 80–83 min |
| PR browser smoke selection | 141 specs for one fixture | 11–15 specs, 13 PR runs, no shard fallback |
| Jobs near their limit | none had one | longest: shard 44.6 / 75 min; unit 23.1 / 45; PR suite 22.1 / 60; typecheck 14.0 / 30. **None timed out** |

- **Why `main` went red.**
  - **CI:** `src/ui/commands/open-after-slow-save.test.ts` expected the old "Opened" toast on ce6b84357 and 52c545886. That is a merge combination: #1764's test met #1748's toast rules. #1829 and #1835 changed the test, and CI was green from 1065be2af.
  - **Browser smoke:** `topology-repairs` timed out (1dcce9fa0). Then `small-text-focus-audit`'s "remaining Cancel" focus failed on 52c545886 and 1065be2af. It was first seen after six merges between 1dcce9fa0 and 52c545886; the cause was not traced. No PR smoke selects that spec for a `src/` change (D7-P1-1, KNOWN).
- **Re-run of a cancelled run:** b74d671a4's Browser smoke was re-run (attempt 2) and cancelled again. D7-P3-6 (KNOWN) pattern; no verdict was hidden this time.

## 6. Fixes merged since E1/E2

| Item | Fix | Status on `8546953c6` | Numbers |
|---|---|---|---|
| E1-P1-1 | #1831 | **SECURITY (redacted): fixed** | Every E1 auditor and refuter payload now ends with a budget or cap error in 0.5–2.1 s (the 5 s window limit), where E1 measured 6.5 s to more than 150 s. 9 new E3 payloads also end bounded (overshoot ≤ 34 ms). Details in `SECURITY-DETAILS.md` only |
| E1-P1-2 DXF ARC `s → s+360` | #1832 | **Fixed for E1's repros; residual E3-P1-2** | b2: 0 of 146,800 and r1: 0 of 404,280 collapse (was 10–12 %); r1: every listed case 125.59 mm; b4: 49 points (was 2). But printed to 6–12 significant digits: 4.4–13.2 % collapse to 0 mm |
| E1-P1-3 PS/AI hairlines | #1832 | **Fixed** | r2 EPS A–D, F and AI 8 G keep the 98.78 mm outline (was dropped); `stroke-width` 0 → 0.001 (a2) |
| E1-P1-4 PDF hairlines | #1832 | **Fixed** | r2 PDF H/I: widths `0.001`; 2 polylines, 98.78 mm (was 1) |
| E1-P2-1 ELLIPSE over one turn | #1832 | **Fixed as asked; regression E3-P1-1** | r3: 0 → 2π+π/2 is 24.20 mm, like ARC 0 → 450. But 0 → `6.28319` (2π rounded up) is now 0 mm |
| E1-P2-2 `.rd` pieces and ETA | #1833 | **Partly fixed** | ETA: app 31.1 s = `.rd` route 31.1 s (was 11.0 vs 43.6); 6000 mm/min 26.2 = 26.2; rings 54.5 = 54.5. Travel 1,526 → 839 mm (circle), 1,723 → 731 mm (rings). **Reversals 60 → 66 (circle), 192 → 374 (8 rings), 18 → 28 (36-gon), 54 → 78 (k > 1): E3-P2-2** |
| E1-P2-3 notice on drawn Line strokes | #1833 | **Fixed** | r5: pen-tool horizontal "none" (was 6.28×); 45° 1.40× (compiled 1.40×) |
| E1-P3-2 Max-feed hold misnamed | #1833 | **Fixed** | r5: "held there and burn up to 367 % … set the …" hold wording |
| E2-P1-1 K40 rotary dose rounding | #1836 | **Fixed** | m3/r1: Y strokes 101.6 % (Ø80) and 102.2 % (Ø150) from 200 to 6000 mm/min (was 32–80 %). Below the board floor, 120 mm/min gives 81.3 % / 43.4 % with "strokes burn between 81 % and 100 % … no slower than 23.5 mm/min" |
| E2-P1-2 K40 slow-speed floor | #1836 | **Fixed** | r9: 6 / 12 / 20 mm/min say "runs at 23.5 mm/min (26 / 51 / 85 % of the set dose)"; 23.5 and above, no note |
| E2-P2-1 K40 warnings only at Start | #1836 | **Fixed** | r2: 1 advisory during Frame, after Frame and at Start (was 0 until Start); m2: 2 after Frame |
| E2-P2-2 K40 row check | #1836 | **Fixed** | m3(b), r3: Save `.egv` and K40 USB both say "37 of its 100 rows land on the row before" (Ø80) and "66 of 100" (Ø150), Image and Fill |
| E2-P2-3 K40 tab note | #1836 | **Fixed** | r4: M2 "its burned tabs are set to 20 % … cut through"; M3-PWM expresses tab power, so no note |
| E2-P3-1 K40 home/jog Abort | #1836 | **Fixed** | `e3-r7-wait.mts`: Ctrl+. during a jog or Home → `stopping` → reset sent (1) → idle after 82–87 ms, "The board acknowledged the reset" |
| E2-P3-3 no K40 air note | #1836 | **Partly** | r4: M3-PWM now says "no air output"; M2 + air true shows the tab note only (not traced) |

## Findings

### E3-P1-1 — A full DXF ELLIPSE whose end parameter is 2π rounded up imports as a dot (regression from #1832)

- **Where:** `src/io/dxf/dxf-curve-sampling.ts:76-99`. `counterClockwiseSweep` treats a difference over one turn as "whole turns plus a remainder" and snaps the remainder to a full turn only within `TURN_TOLERANCE = 1e-12` relative plus `4·ε·(|s|+|e|)`. `normalizedSweep` gives ELLIPSE (radians) the same rule. Before #1832, ELLIPSE clamped anything at or over one turn to a full ellipse.
- **Anchor:** E1-P2-1's fix direction ("share one rule with ARC") applied the ARC rule exactly. The rule's own comment says "a remainder within rounding … of a whole turn is one", but 1e-12 is IEEE rounding, not decimal printing. The DXF ELLIPSE convention for a full ellipse is 41 = 0, 42 = 2π.
- **Evidence:** **REPRO** `e1/e3-ellipse-e2e.mts` (real `parseDxf`, LINE + ELLIPSE, ratio 0.5, major 20 mm):

  | 42 (end) written as | diff − 2π | main `8546953c6` | before #1832 (`52c545886`) |
  |---|---|---|---|
  | `6.283185307179586` | 0 | closed, 95.40 mm | closed, 95.40 mm |
  | `6.28319` (`%.5f`, `%.6g`: C++ stream default) | +4.7e-6 | **2 points, 0.00 mm, no note** | closed, 95.40 mm |
  | `6.2832` (`%.4f`) | +1.5e-5 | **0.00 mm** | closed |
  | `6.28318531` (`%.8f`, `%.9g`) | +2.8e-9 | **0.00 mm** | closed |
  | `6.283185` / `6.2831853` (rounded down) | −3e-7 / −7e-9 | closed, 96.80 mm | closed |
  | 41 = `1.570796`, 42 = `7.853982` (`%.7g`) | +6.9e-7 | **0.00 mm** | closed, 94.02 mm |

  - Census `e1/e3-ellipse-sig.mts`: a start s and end s + 2π, both printed to N significant digits, give a near-zero sweep in 40.1 % (N = 7), 34.8 % (10) and 17.8 % (12) of 20,000 random starts. N = 15 gives 0 %.
  - E1's r3 cases pass because they use exact `Math.PI` values.
- **Scenario:** a sign maker exports a cut file with an oval cut-out from a CAD/CAM tool that writes reals with 4, 5 or 8 decimals. KerfDesk imports the drawing with no note and the oval is a 2-point dot. The job burns without its outline, and the part is not cut out. It was correct before #1832.
- **Severity:** P1. A silent loss of a cut outline (METHOD §3, as E1-P1-2), and a regression on `main`.
- **Announced?** No; `notes` is empty.
- **Novelty:** New, introduced by #1832's E1-P2-1 fix.
- **Fix direction:**
  - When `|end − start|` is more than one turn, snap a remainder below about 1e-6 of a turn (or below 1e-6 rad / 1e-4°) to a full turn. A genuine sub-micro-radian arc written *past* a whole turn is not a real drawing. The within-one-turn branch, which keeps tiny arcs, is untouched.
  - Test 0 → `6.28319`, `6.2832`, `6.28318531` and a `%.7g` s → s + 2π.

### E3-P1-2 — A DXF ARC `s → s+360` printed to 6–12 significant digits still imports as a dot (E1-P1-2 residual)

- **Where:** the same rule: `dxf-entities.ts:108-117` `arcSweep` → `counterClockwiseSweep(start, end, 360)`.
- **Anchor:** E1-P1-2 (P1, routed; #1832 "Keep DXF full circles"). Pre-#1820 (`j31-main`), these arcs imported as full circles.
- **Evidence:** **REPRO** `e1/e3-dxf-sigdigits.mts` (`arcSweep`, 20,000 random starts per row) and `e1/e3-dxf-sig-e2e.mts` (real `parseDxf`):
  - `%.Ng`, N = 6 / 7 / 8 / 10 / 12: **13.2 / 13.0 / 13.0 / 13.1 / 4.4 %** collapse to under 0.001°. N ≥ 14 gives 0 %. Every `%.Nf` (fixed decimals) gives 0 %.
  - End to end:
    - ARC `45.12346 → 405.1235` (diff 360.00004) and `7.123457 → 367.1235`: **2 points, 0.000 mm, no note** on `main`, where pre-#1820 gave 125.57 mm;
    - controls `152.2 → 512.2` and `300.1235 → 660.1235`: 125.59 mm.
- **Scenario:** as E1-P1-2. A writer that does not normalise angles and prints significant digits loses about one full circle in eight from a cut file, silently.
- **Severity:** P1, as E1-P1-2. The reach caveat is the same as E1's: no real exporter's habit is verified.
- **Announced?** No.
- **Novelty:** The E1-P1-2 symptom through a trigger E1's census did not cover (it printed fixed decimals). #1832 fixed E1's repros: 0 collapses in 551,080 cases.
- **Fix direction:** one fix with E3-P1-1 (a decimal-printing tolerance for remainders past a whole turn). Add a `%.7g` census to `dxf-arc-sweep.test.ts`.

### E3-P2-1 — Job Review's "reuse the displayed compile" check compares camera facts with themselves

- **Where:** `src/ui/laser/job-review/job-review-gate.ts:346-351`. `startMachineInputsKey(app.project, previous.laser, camera) !== startMachineInputsKey(app.project, laser, camera)` passes the *live* camera store to both sides. The key includes `cameraPlacementActive`, `cameraConfirmedPositionEpoch`, `cameraMovedWarning` and the camera's calibration (`start-machine-snapshot.ts:61-67`). The bundle keeps the old key (`:446-449`).
- **Anchor:**
  - ADR-345 / ADR-224: "the bundle that streams is provably the bundle the operator last saw". The function's own comment says "camera placement: every machine fact the compile reads".
  - ADR-663 Amd 5 (the "camera may have moved" Start warning) and ADR-228 Amd 1 (the camera placement Start-from warning) are produced by this compile (`start-job-readiness-policy.ts:105-127`).
  - #1829's PR body raised it as "suspected, not traced".
- **Evidence:** **REPRO** `e3-camera-reuse-probe.test.ts` (a copy of #1829's recompile harness with camera rows; run from `mut/src/ui/laser/job-review/`):
  - "camera placement turned on" and "a camera position was confirmed" during an open review: Confirm returns the **same** `prepared` object (`not.toBe` fails). The control row (new overrides) recompiles.
  - With Start from Current Position, turning placement on during the review: the confirmed bundle carries **4 warnings, and a fresh compile 5**. The missing one is the camera placement / Start-from warning.
- **Scenario:**
  - The live camera's moved-check flags "camera may have moved" while the review dialog is open, or the operator confirms a camera position.
  - Confirm reuses the displayed bytes, the review does not refresh, and the job burns without the warning that it may land away from where the artwork shows.
  - Laser bytes do not change (placement is in the project), so the harm is the missing warning.
- **Severity:** P2. A real defect with limited harm (a warning, not a refusal) and narrow reach: the review must be open when the camera fact changes.
- **Announced?** No.
- **Novelty:** New to the ledger. #1829's PR body mentioned it as suspected.
- **Fix direction:**
  - keep the camera state the bundle was prepared with (`previous.camera`, as `previous.laser`), and compare `startMachineInputsKey(app.project, previous.laser, previous.camera)` against the live one;
  - add camera rows to `job-review-gate.recompile.test.ts`.

### E3-P2-2 — `.rd` rotary pieces: laser-off travel halved, but rotary reversals rose (E1-P2-2 residual)

- **Where:** `src/core/controllers/ruida/rd-rotary-feed.ts` / `rd-encoder.ts` nearest-first piece order (ADR-127 Amd 7 Decision 1).
- **Anchor:** E1-P2-2 (P2) fix direction: "emit class parts in path order, merging pieces of the same class". ADR-127 Amd 7 accepts that "some reversals are left".
- **Evidence:** **REPRO** `e1r/e3-rd-eta.mts`, E1 refuter's own method: the encoder's motion plan, counting sign changes of Y over every move. Chuck 40 mm/turn, Ø80, 600 mm/min:

  | Shape | Parts | Laser-off travel (E1 → now) | Y reversals (E1 → now) | Flat-bed reversals |
  |---|---|---|---|---|
  | Ø30 circle, 180 sides | 30 | 1,526 → 839 mm | **60 → 66** | 2 |
  | Ø30 circle, 36 sides | 9 | 364 → 216 mm | **18 → 28** | 2 |
  | 8 rings Ø5 | 12 | 1,723 → 731 mm | **192 → 374** | 16 |
  | Ø30 circle on a k = 4.58 roller | 27 | 6,475 → 3,660 mm | **54 → 78** | — |

  The ETA part is fixed: the app's estimate, through `withRuidaRotaryRoute`, equals the route's motion clock in every row.
- **Scenario:** a Ruida owner engraves text round a tumbler. Each letter's strokes still burn in many speed-class pieces. The rotary now changes direction about twice as often for small letters, and every reversal adds the chuck's backlash where two pieces must meet.
- **Severity:** P2, as E1-P2-2. The seam effect is unverified on hardware.
- **Announced?** Yes, partly: Rotary Setup's Ruida note now says a curved stroke burns in pieces "with short moves between them". It says nothing about reversals or seams.
- **Novelty:** The E1-P2-2 residual. The reversal count got worse.
- **Fix direction:**
  - within a class, prefer the next piece that continues in the current rotary direction (or order by Y within each X band) before the nearest one;
  - or merge consecutive same-class pieces along the path as E1 proposed;
  - assert a reversal bound in `rd-rotary-route.test.ts` (no more than the flat-bed count × the class count).

### E3-P3-1 — `main-is-green`: right verdict, but late and with one mislabel

- **Where:** `scripts/main-is-green.mjs:37-82,163-167`; `.github/workflows/main-is-green.yml:24-37,44`.
- **Evidence:** **RUNS** (sync logs, job timings):
  1. **Late both ways.** The sync job waits for an `ubuntu-latest` runner. CI went red at 10:49:15; 6 PR heads got `failure` at 11:08:55, so stale green lasted 19.7 min. A fix, in turn, keeps `main` "red" until its own `main` run completes: 36–57 min (CI) or 80–83 min (Browser smoke). If the status were required, every PR would be held that long.
  2. **The description names one commit for both workflows.** At 11:08 it said "CI and Browser smoke failed on ce6b843", but Browser smoke failed on 1dcce9fa0 (`:62-69` uses `red[0].run.head_sha`).
  3. **The window is 30 runs** (`:166`). Browser smoke had 20 cancelled `main` runs in a row in this window. More than 30 gives `error` for every PR until a run completes.
  4. **`fixes-main` is unconditional,** and on this repository any agent session can label its own PR.
- **Severity:** P3. Each case fails safe or is bounded; none lets a defect reach `main` that the status was meant to stop.
- **Fix direction:**
  - name each red workflow with its own commit;
  - read 100 runs;
  - consider a `main-is-green` job on `ubuntu-latest` with a short queue, or a `workflow_run` trigger on `requested` that marks PRs red as soon as a red-prone run starts (optional);
  - document that `fixes-main` needs the owner.

### E3-P3-2 — The camera guard's share counts GC and native samples against the camera

- **Where:** `e2e/fixtures/long-task-attribution.ts:107-114` divides camera samples by *all* samples in the task. `(garbage collector)` and `(program)` are root-level nodes with no app frame, so they never count as the camera's.
- **Evidence:** **REPRO** `attr.mts` case D: a 120 ms task, 45 % camera decode + 55 % GC → share 0.45 → passes. Case D2: 49 % → passes.
- **Scenario:** a regression that allocates heavily in camera code (for example, a per-frame base64 decode, which is what the #1808 cache fixed) can spend most of a long task in GC and pass the guard.
- **Severity:** P3. A guard gap behind code that is correct today.
- **Fix direction:** leave GC and `(program)` samples out of the denominator, or attribute a GC sample to the area of the nearest preceding script sample.

### E3-P3-3 — A Z-rotary's first Start after turning the part is refused (from #1829's PR notes)

- **Where:** Frame's own `G92 Z0` versus the Frame permit at Start. Seen in `rotary-axis-abort.simulator.test.tsx:160-163`, which frames twice to get past it.
- **Evidence:** **READ** of the test comment and #1829's PR body ("Start refuses with 'The framed coordinates or machine setup changed during review. Frame the job again.' … happens with `$13=0` too"). Not reproduced in E3.
- **Severity:** P3. It fails safe, but forces a second Frame on every Z-rotary job after a turn.
- **Announced?** In #1829's PR body only.
- **Fix direction:** make the permit's coordinate identity account for the Frame's own `G92 Z0`, or have Frame claim the permit after writing it. Add a single-Frame test.

## KNOWN — status of every item in scope

| Item | Fix | Status on `8546953c6` | Evidence |
|---|---|---|---|
| D3-P1-2→P2 (R10) raster feed after controlled seek | #1829 | **Fixed (test kills)** | R10 KILLED |
| D3-P1-3→P2 (X01) Smoothie freeze | #1829 | **Fixed (test kills)** | X01 KILLED |
| D3-P2-1 (R11) zero-length S0 under M3 | #1829 | **Fixed** | R11 KILLED |
| D3-P2-2 (X02, X05, X07, X11, X13) Abort ownership | #1829 | **Fixed** | all 5 KILLED |
| D3-P2-3 (X10) Z start turn in inches | #1829 | **Fixed** | X10 and X10b KILLED |
| D3-P2-4 (P06, P14) resume modal scan | #1829 | **Fixed** | both KILLED |
| D3-P2-5 (T14) taper sample point | #1829 | **Fixed** | T14 and T14b KILLED |
| D3-P2-6 (J01, J03–J06) reuse shortcut | #1829 | **Fixed**; J06 equivalent (J05 + J06 killed); **camera blind spot E3-P2-1** | results-e3/e3b; probe |
| D3-P2-7 (J08, J14) run-again guards | #1829 | **Fixed** | both KILLED |
| D3-P2-8 (B03) arc bulge at max X | #1829 | **Fixed** | B03 KILLED |
| D3R-P2-1 (J09) Cancel during re-prepare | #1829 | **Fixed** | J09 KILLED |
| D3-P1-4→P3 (X09), D3-P3-2 (X06), D3-P3-6 (X14, J12, W10, W11), D3-P3-3 (T13, C03), D3-P3-4 (B08), D3-P1-5→P3 (C12), D3-P3-1 (M04), D3-P3-5 | — | **Open (P3, not targeted)**. X06, X09, X14, J12, T13 and B08 still survive the new tests; the rest were not re-run | results-e3 |
| D3-P3-7 simulators | — | **Open**: #1829 added inch reports only | READ |
| D7-P1-1 untested combinations reach `main` | #1828 (option 2) | **Mechanism merged, not in force** (not required; no label). 7 merges onto red `main` today; the CI red was a merge combination (#1764 + #1748) | §3, §5 |
| D7-P2-1 Abort guard inherited names | #1827 | **Fixed** | d7p21 |
| D7-P2-2 PR smoke selector cascade | #1827 | **Fixed** (12 for `generate.mjs`; PRs 11–15) | sel.mjs; 13 PR runs |
| D7-P2-3 `main` mostly unverified | maintainer decision | **Open, worse in this window** (24 % CI / 9 % Browser smoke) | §5 |
| D7-P3-1 time limits | #1827 | **Jobs fixed; Playwright `globalTimeout` open** | READ |
| D7-P3-2..6 | — | Open (not re-measured beyond §5; D7-P3-5 "chrome install failed; using the runner's Chrome" still logged) | logs |
| Camera overlay guard (ADR-598 Amd 7) | #1808 | **Holds**; GC dilution E3-P3-2 | attr.mts |
| E1-P1-1 SECURITY (redacted) | #1831 | **Fixed** | SECURITY-DETAILS.md |
| E1-P1-2 DXF ARC full circle | #1832 | **Fixed for E1's repros; residual E3-P1-2** | b2, r1, b4; sigdigits |
| E1-P1-3 PS/AI hairlines | #1832 | **Fixed** | r2, a2 |
| E1-P1-4 PDF hairlines | #1832 | **Fixed** | r2 |
| E1-P2-1 ELLIPSE over one turn | #1832 | **Fixed as asked; regression E3-P1-1** | r3; ellipse-e2e |
| E1-P2-2 `.rd` pieces and ETA | #1833 | **ETA fixed; travel −45–58 %; reversals worse (E3-P2-2)** | e3-rd-eta |
| E1-P2-3 notice on drawn Line strokes | #1833 | **Fixed** | r5 |
| E2-P1-1 K40 rotary dose | #1836 | **Fixed** | m3, r1 |
| E2-P1-2 K40 slow floor | #1836 | **Fixed** | r9 |
| E2-P2-1 K40 warnings at Frame | #1836 | **Fixed** | r2, m2 |
| E2-P2-2 K40 row check | #1836 | **Fixed** | m3(b), r3 |
| E2-P2-3 K40 tab note | #1836 | **Fixed** | r4 |
| E2-P3-1 K40 home/jog Abort | #1836 | **Fixed** | e3-r7-wait |

## Verified clean

- **#1829:** 20 of 20 targeted mutants plus 3 variants are killed by their named tests. The baseline of the 11 touched files passes (90 tests). The fixture change keeps `$13=0` byte-identical (`formatReportedVec3` returns `formatVec3` unless `$13=1`).
- **#1827:** the counter, the selector and the job time limits as described.
- **#1828:**
  - it reads only main's script (`sparse-checkout` of `scripts/main-is-green.mjs`, no PR code) and its permissions are minimal;
  - a new head is blocked until written;
  - runs never overlap;
  - its verdicts on 2026-11-12 matched the run history every time.
- **#1808:** the attribution maths and the decode cache, including that no transfer can detach the cached reference.
- **#1831:** the worker route with Esc and a 45 s guard that retires the worker. Every production caller goes through `importPostscriptFile`.
- **#1832:** ARC within one turn is unchanged (b1). `-Z` extrusion, huge, NaN and Inf angles and E1's 551,080-case census are clean. Hairlines become `0.001`.
- **#1833:** flat-bed `.rd` unchanged (rotary-off rows identical to E1). Passes do not multiply parts (r6). Notice and hold wording correct.
- **#1836:** every E2 K40 repro, plus Z/A refusal, passes, cross-hatch and 45° parity, and the Ruida/K40 Frame footprint under scope (r6).

## Not verified

- **Hardware:** Ruida seams and backlash (E3-P2-2); K40 timing.
- **Browser:**
  - no browser run: the real Job Review dialog for E3-P2-1, the camera guard on CI hardware, and the PostScript worker's termination in Chrome;
  - with no `Worker` (jsdom), an EPS import shows the "background worker could not start" warning twice: once for the reader and once for the SVG step. Cosmetic, and only where no Worker exists.
- **Real exporters:** their DXF number formats (E3-P1-1/P1-2 rest on plausible `printf` formats, not on files from real tools).
- **D3 P3 mutants outside the touched modules:** G15, M04, C03, C12, W10, W11 (not re-run).
- **Full suite:** each mutant ran against its named test file only. Kills are therefore lower bounds, and survivors of P3 mutants may die elsewhere.
- **Playwright `--only-changed`:** approximated by an import walk (`graph.mjs`), not run (no git in the export).

## Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-e3\`. Run TS with `node --no-experimental-webstorage --import ./register.mjs <file>` from the file's folder.

| File | What | Output |
|---|---|---|
| `run-mutants.mjs` (D3's, unchanged), `mutants-e3.json`, `mutants-e3b.json`, `baseline-e3.json` | Mutant specs and runner (mutates `mut\` only) | `results-e3.jsonl`, `results-e3b.jsonl`, `baseline-e3.jsonl` |
| `e3-camera-reuse-probe.test.ts` | E3-P2-1 probe (copy into `mut\src\ui\laser\job-review\` to run) | console |
| `d7p21.mts` | D7-P2-1 inherited names | console |
| `sel.mjs`, `graph.mjs` | PR smoke selection on main's `e2e/`; `src/` import reach | console |
| `attr.mts` | #1808 synthetic profiles | console |
| `runs-ci.yml.tsv`, `runs-e2e.yml.tsv`, `allruns.tsv`, `alljobs.tsv`, `main-commits.tsv` | `gh` GET snapshots, 2026-11-12 06:00/07:48 → 13:24 UTC | — |
| `e1\e3-ellipse-e2e.mts`, `e1\e3-ellipse-sig.mts` | E3-P1-1 (`e3-ellipse-e2e.mts ../../j34-main/src/` for the pre-#1832 run) | console |
| `e1\e3-dxf-sigdigits.mts`, `e1\e3-dxf-sig-e2e.mts` | E3-P1-2 (`… ../../j31-main/src/` for pre-#1820) | console |
| `e1r\e3-rd-eta.mts` | E3-P2-2 and the app ETA | console |
| `e2r\e3-r7-wait.mts` | E2-P3-1 re-check with a wait | `e2r\out\e3-r7-wait.txt` |
| `e1\*.mts`, `e1r\*.mts`, `e2\*.mts`, `e2r\*.mts` | E1/E2 repros re-pointed at `j35-main` | `out\e1-*.txt`, `out\e1r-*.txt`, `out\e2-*.txt`, `e2\out\`, `e2r\out\` |
| `sec\*` | SECURITY (redacted) | `sec\out-sec.txt`; `SECURITY-DETAILS.md` (private) |

## Counts

Raised **7** — P1 **2** (E3-P1-1, E3-P1-2), P2 **2** (E3-P2-1, E3-P2-2), P3 **3** (E3-P3-1, E3-P3-2, E3-P3-3). Known items with a status: **35** in the table above (D3, D7, the camera guard, and E1/E2 P1/P2/P3 in scope). E3-P1-2 and E3-P2-2 are residuals of known E1 items.

## Refuter (2026-11-12)

**Tree and harness.** Same read-only export `j35-main` (`origin/main` @ `8546953c6`). Own scripts in `zz-e3r\`, run with `node --no-experimental-webstorage --import ./register.mjs <file>` from `zz-e3r`. The loader is copied from `zz-e3`, plus one rule: bare package imports from the old trees resolve through `j35-main`'s `node_modules`. The auditor's scripts were read for API shape only; nothing imports or reruns them.
- **Before trees:** `git archive` (read only) of `src/` at `1f016b610` (= `f6401fc63^1`, main before #1832) into `zz-e3r\pre1832\`, and at `b0e4ee3ce` (= `e6f1ebcbe^1`, main before #1833) into `zz-e3r\pre1833\`. The auditor compared against `52c545886` (`j34-main`); these are the exact first parents.
- **DXF:** the UI entry `importDxfFiles` (`src/ui/app/dxf-import-action.ts`) with a text-only file handle, so the real main-thread `parseDxf` path, its toasts and `importObject` run. Own DXF text (R12 entities only; ellipse major axis 30 mm at 30°, ratio 0.4). Own census over 36,000 golden-ratio starts per row through the exported `normalizedSweep` / `arcSweep`.
- **`.rd`:** own byte reader. It unscrambles (magic 0x88), tokenises by the high bit, and reads only the move records `0x88–0x8B` / `0xA8–0xAB` and the `0xC9 0x02` speed. It uses neither the repo decoder nor the encoder's motion plan.
- **K40:** own read of the `CV` codes in the Save `.egv` text, with an own M2 suffix-C speed formula: value = 65536 − (1010·T + 8), where T = 25.4 / v ms per mil.
- **Mutants:**
  - own variant text, not D3's;
  - applied to a copy `zz-e3r\mut\` (`src`, `public`, `scripts`, root configs, `node_modules` junction);
  - each run covers the whole named test file, with no bail: `--pool=threads --no-file-parallelism --maxWorkers=1 --reporter=verbose`;
  - every mutated file compared equal to `j35-main` afterwards (`cmp`).
- **Simulator:** one own Vitest file in `mut` for E3-P3-3 (GRBL simulator, no hardware).
- **`gh`:** read-only GETs only (ruleset, label, PR heads, commit statuses).
- **Not used:** hardware, a browser, pnpm, building, and live services other than those GETs. Vitest ran one file at a time with 2.0–2.3 GB free.

### Verdicts

| Finding | Verdict | Evidence (own) |
|---|---|---|
| E3-P1-1 | **CONFIRMED, P1, regression from #1832**. Wider than stated: radians printed to fixed decimals collapse too | R1, R1b, R2 |
| E3-P1-2 | **CONFIRMED, P1**. Residual of KNOWN E1-P1-2; #1832 halved it | R1, R2 |
| E3-P2-1 | **CONFIRMED, P2**. The bytes cannot differ; only warning text is missing. **Fix direction corrected** | R3, READ |
| E3-P2-2 | **CONFIRMED, P2**, with nuance: total reversals rose, reversals while lit fell, and pieces entered against the rotary's direction are mixed | R4, R5 |
| E3-P3-1 | **CONFIRMED, P3** | READ, `gh` statuses |
| E3-P3-2 | **CONFIRMED, P3** | READ |
| E3-P3-3 | **CONFIRMED, P3**, now reproduced; scope narrowed to "after a Z turn" | R8 |

**"Fixed" claims checked.** All agree with the auditor:
- #1829: all 5 own mutant variants are killed.
- #1827: the selector picks 12 specs (own grep walk).
- #1828: the 7 merges onto a red `main`, the ruleset and the missing label are confirmed.
- #1836: the K40 dose matches with an own formula.
- #1831: SECURITY (redacted). Fixed, including against own new payload shapes.

### Per-finding notes

**E3-P1-1: CONFIRMED P1 (regression).**
- **Through the UI import (R1).** A full ELLIPSE with 41 = `0` and 42 written as below. The full outline is 138.0 mm (Ramanujan: 138.08). Every row shows only "Imported 1 path from r1.dxf." and no note.

  | 42 written as | 42 − 2π | main `8546953c6` | before #1832 (`1f016b610`) |
  |---|---|---|---|
  | `6.283185307179586`, `6.283185307179`, `6.28318530718` | 0, −5.9e-13, +4.1e-13 | closed, 138.00 mm | closed, 138.00 mm |
  | `6.2831853072` (`%.10f`) | +2.0e-11 | **2 points, 0.00 mm** | closed, 138.00 mm |
  | `6.28318531` (`%.8f`) | +2.8e-9 | **0.00 mm** | closed |
  | `6.283186` | +6.9e-7 | **0.00 mm** | closed |
  | `6.28319` (`%g`; the C++ stream default) | +4.7e-6 | **0.00 mm** | closed |
  | `6.2832`, `6.2833` | +1.5e-5, +1.1e-4 | **0.00 mm** | closed |
  | `6.29` | +6.8e-3 | 0.08 mm (an arc of 0.4°) | closed |
  | `3.14159265 → 9.42477796`, `-3.141593 → 3.141593`, `0.5 → 6.78319` | > 0 | **0.00 mm** | closed |
  | `0 → 12.566371` (4π rounded up) | +3.9e-7 past two turns | **0.00 mm** | closed |
  | `6.2831853`, `6.283185`, `0.5 → 6.783185` (rounded down) | < 0 | closed, 138.00 mm | closed |
- **The curve collapses too (R1b).** For `6.28319` the imported `curves` entry is one open cubic from (3.3e-10, 5.6e-5) to (0, 0). For full precision it is four cubics, closed. So the job's own canonical curve is a dot as well, not only the preview polyline.
- **Census (R2): 36,000 starts per row, with `s` and `s + 2π` both printed.**
  - `%.Nf` in radians, collapsed on main: **85.3 % (4 decimals), 53.1 % (5), 30.7 % (6, plain `printf("%f")`), 71.8 % (8), 79.6 % (10)**. 0 % at 12 decimals. Before #1832: 0 % in every row.
  - `%.Ng`: 66.8 / 51.2 / 40.2 / 30.0 / 35.2 / 18.2 % for N = 5 / 6 / 7 / 8 / 10 / 12; 0 % from N = 14. Before #1832: 0 %.
  - The auditor's census used `%.Ng` only and states that fixed decimals give 0 %. That holds for ARC, whose angles are in degrees, where 360 is exact. It does **not** hold for ELLIPSE, because 2π is never exact in decimal. So the regression is wider: it hits any writer that prints radians to 4–10 decimals.
- **Is the tolerance the cause? Yes.** `counterClockwiseSweep` (`dxf-curve-sampling.ts:88-95`) snaps a remainder to a whole turn only within `1e-12·turn + 4ε·(|s|+|e|)`. For ELLIPSE that is about 6.3e-12 rad. Before #1832, `normalizedSweep` clamped any positive difference to `min(sweep, 2π)`, so an over-full end gave a full ellipse whatever its digits.
- **What tolerance is safe (R2, a candidate rule).** Keep the within-one-turn branch exactly as on main. Only when `|end − start| > turn`, snap a remainder below δ·turn to a full turn.
  - δ = 1e-4 turn: 0 collapses for 5 or more significant digits and 4 or more decimals, ARC and ELLIPSE alike. δ = 1e-3 turn also covers 3 decimals; 2 decimals need about 2e-3.
  - Genuine tiny arcs are untouched. `100 → 100.0001`, `0 → 1e-6`, `359.99999 → 360` and `12 → 12.00001` give the same sweep as main (0 disagreements), because the rule never touches a difference inside one turn.
  - **Correction to the auditor's fix direction.** "Below about 1e-6 of a turn (or 1e-6 rad / 1e-4°)" is too tight. At δ = 1e-6 turn:
    - `%.4f` ELLIPSE still collapses in 85.3 % of cases;
    - `%.6g` ELLIPSE in 16.5 %;
    - `%.6g` ARC in 4.2 %;
    - the auditor's own test case `6.2832` (2.3e-6 turn) still fails.
  - A genuine arc under 0.36° written as "s → s + 360° + a tiny remainder" is not a plausible drawing, so δ up to 1e-3 turn loses nothing real.
- **Do real exporters print these digits? The repo does not show it.**
  - The only ELLIPSE end parameter in the repo is `6.283185307179586` (`parse-dxf.test.ts:193`).
  - The one DXF fixture (`src/io/vector-formats/__golden__/traced-image-page.dxf`) has no ELLIPSE.
  - KerfDesk's own writer emits bulges, so its own round trip is not affected.
  - The plausibility argument is generic: `printf("%g")` and a default C++ stream both print 2π as `6.28319`, and `%f` prints six decimals.
  - METHOD §3 has no reach clause, so P1 stands.

**E3-P1-2: CONFIRMED P1** (residual of KNOWN E1-P1-2).
- **R1 (UI import), ARC with r = 20.**
  - Collapse to 2 points, 0.00 mm, no note: `45.12346 → 405.1235`, `7.123457 → 367.1235`, `270 → 630.0000001`, `0 → 360.0000001` and `359.9999 → 720`.
  - Full circle, 125.59 mm: `0 → 360`, `123.4568 → 483.4568`, `33.33333 → 393.3333` (rounded down), `10.1 → 370.1` and `12.5 → 12.5`.
  - Before #1832 the first five collapse the same way. This is not a #1832 regression: it is E1-P1-2 (from #1820), not fully fixed.
- **R2 census (ARC, degrees).**
  - Main collapses in 12.2–12.7 % of cases for `%.5g`–`%.10g` and 4.1 % for `%.12g`. It collapses in 0 % for every `%.Nf` and from `%.14g`.
  - Before #1832: 10.4–11.1 % for `%.Nf` and 23.0–23.6 % for `%.Ng`.
  - So #1832 fixed the fixed-decimal class and halved the significant-digit class. The auditor's 4.4–13.2 % agrees.
- **Fix:** one fix with E3-P1-1, the δ rule above with δ of at least 1e-4 turn.

**E3-P2-1: CONFIRMED P2; fix direction corrected.**
- **Trace (READ).** `preparedStartReusable` (`job-review-gate.ts:346-351`) passes the live `camera` to both sides of `startMachineInputsKey`, so the camera fields of `machineSnapshot` (`start-machine-snapshot.ts:61-72`) cancel out. When the bundle is reused, it keeps the old `preparedMachineInputsKey` (`:446-449`).
- **Own run (R3).** With the real stores:
  - the key computed the gate's way does not change when `placementActive` turns on or `confirmedPositionEpoch` rises (`gate sees change=false`);
  - the bundle's stored key does differ from the live key (`true`).
- **A twin does it right.** The remote review compares the stored key with a fresh live key (`src/ui/remote-access/prepared-job-review.ts:164-169`). So the phone path will not reuse a bundle that desktop Confirm does reuse.
- **Can the confirmed bundle burn something different? No.** Every camera fact in the key feeds only warnings:
  - `placementWarnings` (`start-job-readiness-policy.ts:105-127`): the Start-from camera warning, the camera-target warning and "camera may have moved";
  - `cameraOffTargetWarnings` (`camera-off-target-warning.ts`, "Said, never refused").

  `cameraConfirmedPositionEpoch` has no consumer besides the key. The G-code is the same bytes either way; up to three warning texts can be missing.
- **The moved case does even less harm.** The moved check also pushes a "The camera may have moved" toast when the Camera panel is closed (`moved-check.ts:240-264`). So P2, not P1.
- **Correction to the fix direction.**
  - The proposed fix keeps `previous.camera` and compares `startMachineInputsKey(app.project, previous.laser, previous.camera)`. That does not cover the moved warning.
  - The reason: `cameraMovedStartWarning` reads the global `useCameraMovedStore` (`camera-moved-start-warning.ts:18`), not the camera object. A saved camera object still yields the live moved text on both sides.
  - Instead, compare `previous.preparedMachineInputsKey`, which is already stored at prepare time, with `startMachineInputsKey(app.project, laser, camera)`, as the remote path does.

**E3-P2-2: CONFIRMED P2, with nuance.** Own `.rd` byte reader (R4): Save `.rd` of four shapes at 900 mm/min, flat and on two rotaries. The flat files are identical before and after #1833.

| Rotary / shape | Laser-off travel (before → main) | Y reversals, all moves | Y reversals while lit | Lit runs entered against the last Y direction |
|---|---|---|---|---|
| chuck 40 mm/turn Ø80, circle Ø30 (120 sides) | 1,075 → 594 mm | 44 → **50** | 44 → 38 | 42/85 → 24/64 |
| same chuck, ellipse 40×10 | 596 → 307 | 18 → **32** | 18 → 4 | 16/33 → 15/25 |
| same chuck, star | 98 → 59 | 10 → **14** | 8 → 4 | 5/9 → 6/8 |
| same chuck, 6 rings Ø6 | 1,314 → 599 | 120 → **249** | 120 → 83 | 108/222 → **134/209** |
| roller k > 1 (360 mm/turn, Ø25), circle | 5,095 → 2,918 | 44 → **63** | 44 → 27 | 42/85 → 41/63 |
| same roller, ellipse | 1,979 → 1,326 | 38 → **44** | 38 → 30 | 36/73 → 25/64 |
| same roller, star | 213 → 176 | 8 → 8 | 6 → 6 | 4/9 → 4/7 |
| same roller, 6 rings | 2,599 → 934 | 108 → **194** | 108 → **184** | 96/198 → **175/184** |

- **Travel** fell 17–64 %, so that claim holds.
- **Total Y reversals** rose in 7 of 8 cases. The auditor's point holds in the bytes, not only in the motion plan. But the extra reversals are mostly laser-off: reversals while lit fell in 6 of 8 cases.
- **What decides a seam** is whether a piece starts against the direction the rotary last moved, because the backlash is then taken up inside the piece. That improved for single outlines (from 42 to 24 of a circle's pieces). It got **worse for clusters of small shapes**, the text-like case: from 108 to 134 pieces, and on the roller from 96 to 175 of 184.
- **Rating.** Seam size is still unverified on hardware, and P2 stands. The fix direction should bound "pieces entered against the last Y direction", not raw reversals.
- **ETA (R5).** An own time bracket from the decoded bytes: the lower bound has no acceleration; the upper bound runs every move from rest to rest at 500 mm/s².
  - Main's app ETA sits at the rest-to-rest bound: 22.9 s in [6.9, 23.3]; 39.8 s against [8.1, 39.6], 0.5 % over.
  - Before #1833 it sat near the no-acceleration bound: 8.2 s in [7.3, 32.1]; 10.8 s in [8.8, 53.3].
  - This agrees with the auditor's "ETA = route clock". It does not decide which bound a real Ruida follows, because that depends on how the controller blends moves.

**E3-P3-1: CONFIRMED P3.**
- `mainVerdict` names `red[0].run.head_sha` for both workflows (`scripts/main-is-green.mjs:55-59`).
- #1836's head carried "CI and Browser smoke failed on 52c5458" (12:06:34) and "Browser smoke failed on 52c5458" (12:29:17).
- `per_page=30` is at `:151`.
- Timing was not re-measured.

**E3-P3-2: CONFIRMED P3** (READ). `attributeLongTasks` divides by every sample inside the task, GC and `(program)` samples included (`e2e/fixtures/long-task-attribution.ts:107-114`).

**E3-P3-3: CONFIRMED P3, reproduced (R8).** Own simulator test: stock GRBL, a Z rotary at 40 mm/turn, User Origin. The Z jog, origin and setup follow the shipped test; then **one** Frame and Start.
- With `$13=0` and with `$13=1`: no stream. The toasts are "Frame complete — press Start to review and run the current settings at this placement." and then "The framed coordinates or machine setup changed during review. Frame the job again."
- Framed twice: the job streams.
- **No Z turn before the Frame: the job streams after one Frame.**

So it hits every Z-rotary job whose part was turned since the last zero, which is the normal way to line up a part. It also tells the operator to Frame again right after saying "press Start". It still fails safe, so P3.

### Fixed claims re-checked

- **#1829 (R6).** The baseline of the 5 files passes (1 / 35 / 14 / 11 / 7 tests). Each own variant is killed by the named test:
  - T14r (the taper sampled at the quarter point): "matches the feed at the radius under the midpoint of a 40 mm diagonal" fails.
  - B03r (the X bound uses `offset.y`): both "flags the bulge the offset pushes off the bed" and "accepts a bulge the offset brings back" fail.
  - P14r (M5 clears only M4): "keeps the beam off when the program turned it off with M5" fails.
  - R11r (`constantPower && previousM3StillLit`): "an S0 gap that rounds to zero length between two burns is not written" fails.
  - J01r (the same-artifact check compares only the G-code *length*): "asks for a second Confirm when the recompiled bytes differ" fails. So the test's bytes differ in content, not only in length.
- **#1827.**
  - Own grep walk for `document-import-generated/generate.mjs`: the folder name appears only in `fixtures/document-import-browser.ts` and a README. One spec names that module (`document-import-acceptance.e2e.ts`); four fixtures name it too, but no other spec names them. 11 core specs + 1 = **12**, as the auditor says.
  - `functionSampleCounts` counts in a `Map` seeded only with the watched names (READ).
  - `timeout-minutes` appears six times in `ci.yml`, five times in `e2e.yml` and twice in `deploy.yml`. Neither Playwright config has a `globalTimeout`.
- **#1828 (`gh`, read only).**
  - Ruleset 19573147 is active and requires only the five contexts with `integration_id` 15368.
  - `GET /labels/fixes-main` returns 404.
  - At merge time, the PR heads of #1829, #1835, #1833, #1830, #1832, #1831 and #1836 all carried `main-is-green` = `failure`: **7 merges onto a red `main`**, confirmed.
  - #1835 was the CI fix. Once the status is required, a PR like it will need the label, which does not exist yet.
  - The workflow header says "main's ruleset requires that status", which is not yet true. That is an owner action from ADR-710, not a finding.
- **#1836 (R7, own formula).** One Y stroke of 20 mm round the part.
  - Ø80: 101.6 % of the set dose at 300–1,200 mm/min, 101.7 % at 3,000.
  - Ø150: 102.2 %.
  - At 120 mm/min: 81.3 % (Ø80) and 43.4 % (Ø150), with the floor note.
  - This matches the auditor.
  - With only Y strokes, the note reads "strokes burn between 81 % and 81 % of the set dose". The range is degenerate; it is cosmetic and not raised.
  - The steady +1.6 / +2.2 % is unexplained, but far below the size of any dose finding.
- **#1831:** SECURITY (redacted). Fixed, and bounded on the refuter's own new payload shapes too. Details are only in `zz-e3r\SECURITY-DETAILS.md`.

### New findings

None. The notes above correct two fix directions (the E3-P1-1/P1-2 tolerance and the E3-P2-1 key comparison) and narrow the scope of E3-P3-3.

### Probes with no gap

- **DXF sweep callers.** No other code calls the sweep rule: `arcSweep` and `normalizedSweep` are called only from `dxf-entities.ts` and `dxf-curve-sampling.ts`. KerfDesk's DXF writer emits no ARC or ELLIPSE, so its own round trip is safe.
- **ELLIPSE rounded down.** An ELLIPSE whose end is rounded *down* to 3 or fewer decimals (`6.283`, `6.28`) imports open: 56 points with a gap of 6 µm to 0.1 mm. It behaves the same before and after #1832. Pre-existing and narrow, so not raised.
- **Remote reuse check.** The remote job review's reuse check compares the stored key, which is correct.
- **#1827 pieces.** `functionSampleCounts`, the PR selector and the job time limits behave as described.
- **Flat-bed `.rd`.** The bytes are identical before and after #1833 (R4).

### Not verified

- **Hardware:** Ruida seams and backlash, and K40 timing.
- **Browser:** none was run. Not checked:
  - the real Job Review dialog;
  - whether camera placement can change on the desktop while the dialog is open (the moved check can, from its timer);
  - the camera guard on CI;
  - the PostScript worker in Chrome.
- **Real exporters' DXF number formats:** the repo has no evidence either way.
- **Ruida ETA:** which bound a real Ruida follows.
- **CI:** timing and the 5.6 h re-measure were not repeated.

### Repro files

All in `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-e3r\`. Run them from that folder.

| File | What it covers | Output |
|---|---|---|
| `register.mjs`, `ts-resolve.mjs` | Loader, copied from `zz-e3`; bare imports from `pre18xx` and `mut` resolve through `j35-main` | — |
| `pre1832\src`, `pre1833\src` | `git archive` of `1f016b610` and `b0e4ee3ce` (read only) | — |
| `r1-ellipse.mts [tree]` | E3-P1-1 and E3-P1-2 through `importDxfFiles` | `out/r1-main.txt`, `out/r1-pre1832.txt` |
| `r1b-curve.mts` | The imported canonical curve for `6.28319` | console |
| `r2-census.mts [tree] [delta]` | The census and the candidate δ rule | `out/r2-main*.txt`, `out/r2-pre1832.txt` |
| `r3-camera-key.mts` | E3-P2-1 reuse key | `out/r3.txt` |
| `r4-rd-decode.mts [tree]` | E3-P2-2, own `.rd` reader | `out/r4-main.txt`, `out/r4-pre1833.txt` |
| `r5-rd-eta.mts [tree]` | `.rd` ETA bracket | `out/r5-main.txt`, `out/r5-pre1833.txt` |
| `r6-mutants.mjs` | #1829 own variants (mutates `mut\` only, then restores) | `out/r6-baseline.txt`, `out/r6-mutants.txt` |
| `r7-k40-dose.mts` | #1836 dose, own formula | `out/r7-main.txt` |
| `mut\src\ui\laser\zz-e3r-z-first-start.simulator.test.tsx` | E3-P3-3 (R8; run with Vitest from `mut`) | console |
| `sec\rs1.mts` | SECURITY (redacted) | `sec/out-rs1.txt`; `SECURITY-DETAILS.md` (private) |

```json
{
  "area": "E3",
  "role": "refuter",
  "tree": "8546953c6",
  "verdicts": [
    {"id": "E3-P1-1", "verdict": "CONFIRMED", "severity": "P1", "evidence": "REPRO r1 via importDxfFiles: 42 = 6.28319 / 6.2832 / 6.28318531 / 6.2831853072 / 6.283186 -> 2 points 0.00 mm, no note; pre-#1832 (1f016b610) closed 138.00 mm; r2: %.4f-%.10f radians collapse 30.7-85.3 %, %.5g-%.12g 18.2-66.8 %, pre 0 %", "note": "wider than reported (fixed decimals too); auditor's 1e-6-turn fix too tight, use >= 1e-4 turn past one turn only"},
    {"id": "E3-P1-2", "verdict": "CONFIRMED", "severity": "P1", "evidence": "REPRO r1, r2: ARC %.5g-%.10g 12.2-12.7 %, %.12g 4.1 % (pre-#1832 23 %); %.Nf 0 %", "note": "residual of known E1-P1-2, not a #1832 regression"},
    {"id": "E3-P2-1", "verdict": "CONFIRMED", "severity": "P2", "evidence": "REPRO r3; READ job-review-gate.ts:346-351, twin prepared-job-review.ts:164-169", "note": "bytes cannot differ; fix must compare the stored preparedMachineInputsKey (the moved warning reads a global store)"},
    {"id": "E3-P2-2", "verdict": "CONFIRMED", "severity": "P2", "evidence": "REPRO r4 own .rd reader: travel -17..-64 %, all-move reversals up 7/8, lit reversals down 6/8, against-direction entries worse for clusters (108->134, 96->175)"},
    {"id": "E3-P3-1", "verdict": "CONFIRMED", "severity": "P3", "evidence": "READ; gh statuses on #1836 head"},
    {"id": "E3-P3-2", "verdict": "CONFIRMED", "severity": "P3", "evidence": "READ"},
    {"id": "E3-P3-3", "verdict": "CONFIRMED", "severity": "P3", "evidence": "REPRO r8 simulator: single Frame after a Z turn refused ($13=0 and 1), twice ok, no turn ok"}
  ],
  "fixed_checks": {"#1829": "5/5 own variants killed", "#1827": "12 specs for generate.mjs (own grep walk)", "#1828": "7 merges onto red confirmed; not required; label 404", "#1836": "101.6/102.2 %, floor 81.3/43.4 % with note", "#1831": "SECURITY (redacted) fixed"},
  "new": [],
  "counts": {"raised": 7, "refuted": 0, "P1": 2, "P2": 2, "P3": 3, "known": 2}
}
```

Refuter counts: raised 7, refuted 0, P1 2, P2 2, P3 3, known 2
