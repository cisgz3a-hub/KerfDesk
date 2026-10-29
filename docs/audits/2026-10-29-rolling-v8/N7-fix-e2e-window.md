# Rolling audit v8 — N7 Fix verification: the e2e red window and #1513

- **When:** 2026-10-29, night +0800   **Tree:** origin/main @ `4f71f1f41`. #1513 merged as `33bc394c6`, the desktop 1.0.28 source. Between `33bc394c6` and `4f71f1f41` nothing changed in `e2e/`, `electron/`, `scripts/installed-upgrade-profile.ps1`, `src/ui/app/notice-banner-style.ts` or `src/ui/app/App.tsx` (`git diff --stat`).
  - **Red window.** Main's full Browser smoke (`e2e.yml`, Chrome UX smoke shards 1–4) failed from `7a459ef2d` (run 40498942229, 2026-10-27 11:48 UTC) to `9dfa477a9` (run 40819623978). It went green at `33bc394c6` (run 40826138114), and has stayed green since: `08b5c669b`, `c1acfdff6` and `4f71f1f41`. The last green run before the window was on `eaa4bb015` (40494669654).
  - **What was read.** Every completed red run: 24 runs, read with `gh run view <id> --log-failed`. 19 more main runs in the window were cancelled, because a newer pending run replaced them. Also read: the full logs of three green runs, `gh pr view 1513` with its diff, and the Chrome UX smoke status of PRs #1466–#1513.
  - **Release evidence.** For run 40846112322 the coordinator's copy (`…\scratchpad\rel-qual-1028\`) was read as data. Also read: `git diff adf300522 33bc394c6 -- electron/` and the release workflow's run history.
- **Scope:** N7 (`fix-e2e-window`) has four parts:
  1. #1513's spec changes, read as test truth.
  2. #1513's banner-wrap fix (`notice-banner-style.ts`).
  3. Every PR merged while main's full suite was red (#1466–#1513).
  4. The coordinator item on why the first 1.0.28 release run exited non-zero.
- **Lenses run:** L10 (the fix and its siblings), L7 (test truth of each changed spec and of the masked parts of each red test), L6 (the desktop quit path and the release harness's failure path). Not run: L2. #1499's A1 Pro ground truth is N2's.
- **Repros:** one existing unit test was run on main's tree. No temporary test file was created: no `zz-n7-*` file exists in `j7-main` or in the repo.
  - **No Playwright run.** The PC had 419 MB of physical memory free, with other agents' node processes at 4.9 GB, so no Vite server or Chrome was started. CI runs stand in for browser evidence.
- **Counts:** 3 raised → 0 refuted → P1 0 / P2 0 / P3 3 (+ 3 KNOWN re-observed). Refuter: 2 CONFIRMED (N7-P3-1, N7-P3-2), 1 PLAUSIBLE (N7-P3-3), 0 REFUTED, 3 KNOWN. No severity changes. Main verdicts: 3 CONFIRMED (#1513's spec changes, air on recovery, no masked regression on main), 1 PLAUSIBLE (no main-process cause for the 1.0.28 exit). Four small factual corrections are listed under "Refuter method".

## Headline

**All of #1513's test changes are legitimate.** Each one follows an intended, ADR-backed product change, and none weakens an assertion:

- **#1466 (ADR-500 Amd 2).** A file for the machine in use keeps that machine's homing, rotary and air assist. Four specs now set those values on the machine in use before Open: air assist, homing (focus test and Print and Cut) and rotary.
- **#1488 (ADR-204 Amd 2).** Manual saves are compact JSON. The two font specs now parse the saved project instead of matching indented text. The calligraphy check is stronger than before, because one text object must now carry both the font key and the content.
- **#1499 (ADR-322 Amd 3) with ADR-637 Amd 1.** The Falcon wizard no longer shows a Replace settings step.

**Refuter: CONFIRMED.** Read the whole #1513 e2e diff (`git diff 9dfa477a9 33bc394c6 -- e2e/`).
- **Assertions.** No assertion was removed or loosened. The two save checks now need both fields on one `kind: 'text'` object.
- **Setup moves.** Each setup move puts a value on the machine in use, and the file keeps carrying the same value. Under ADR-500 Amd 2 Decision 1 ("the current machine's whole profile is kept") that is the only path that still applies.
- **Falcon wizard.** `useMachineChoice` (`DeviceSetupMachinePicker.tsx:121-145`) dispatches nothing while a Replace prompt is pending. So `toBeChecked()` passing without a Replace click proves the choice applied at once, and the `toHaveCount(0)` check backs it up.
- **One small coverage loss (no finding raised).** The Replace prompt is now clicked only by the xTool spec (`:486`), at the default viewport. Its phone-width layout no longer has an e2e path.

**Air assist on recovery is correct on main.**

- The M8 assertions in `recovery-deep-audit.spec.ts:219` are unchanged. Their recovery half, which the red window had skipped for 42 hours, now runs and passes: shard 3 has 104 passed and 0 failed at `33bc394c6`.
- The unit oracle `resume-program.emitter-oracle.test.ts` passes 9/9 on main. It includes "every resumed burn keeps the air assist the original burn had".
- The "M8 → off" in the old red runs was real product behaviour under ADR-500 Amd 2. Two notices cover it:
  - the Open toast names "air assist";
  - Job Review warns that the job requests air assist but the machine has no M7/M8 output (`manual-air-assist-warnings.ts:6-9`).

**Refuter: CONFIRMED, with one framing correction.** The air did not go from M8 to off at recovery. It was off for the whole job from Open.
- **Red-run failure line.** In every red run the spec failed at `:234` on `9dfa477a9`, which is `expect(new Set(original.map(burn => burn.air))).toEqual(new Set(['M8']))`: the *original* burns. The recovery half never ran.
- **ADR text.** ADR-500 Amd 2 (`docs/decisions/ADR-500-amendment-2-open-keeps-the-machine-in-use.md`):
  - Decision 1: "the current machine's whole profile is kept".
  - Decision 2 lists "air assist" among the values the toast names.
- **Toast.** The label is in `SETUP_LABELS` (`project-bed-reconciliation.ts:245`, keys `airAssistCommand` and `airAssistRestartUnreliable`).
- **Job Review.** `detectManualAirAssistWarnings` fires when `airAssistCommand === 'none'` and a laser group has `airAssist` set. This fixture's layer has `airAssist: true` (`recovery-deep-audit.spec.ts:183-184`). The warning is wired into `job-review-model.ts:132`.
- **Recovery now.** Shard 3 at `33bc394c6` (job 123289493862) reports "104 passed", with no failed or skipped tests. So the air recovery test, including both unchanged M8 assertions, ran and passed.
- **Unit oracle not re-run.** The memory limit ruled it out. The CI evidence is the second line of evidence.

**The red window hid no regression that is still on main.**

- **Failing tests.** Across the 24 red runs, exactly 15 test IDs failed (7 spec locations, the calligraphy spec counting 8 fonts). The failure set only grew twice:
  - at `4ffba1039` (#1482: the Falcon wizard);
  - at the first completed run after #1488 (`25eb1a9dd`: calligraphy ×8 and weld).
- **Fixed earlier.** One more test, `laser-lead-start-reseed.e2e.ts:145`, failed in the first three red runs from the same #1466 cause. #1476 fixed it at `09f7c0087`.
- **Failure lines.** Every failure stayed on the same line in every run.
- **No suite changes.** No test was skipped or added in the window. Shard totals stayed identical (136/145/104/126 with 11+1 skipped), and no spec uses serial mode.
- **Now.** The whole suite is green on main with the tails of those tests unchanged.
- **One real product regression was masked.** #1482's phone-width banner was reported by main's own run at `4ffba1039`. It stayed unnoticed for about 37 hours and went out in 23 web deploys. #1513 fixed it before any desktop release. That masking is N7-P3-1.

**Refuter: CONFIRMED.**
- **Runs sampled.** 8 of the 24 red runs were parsed independently from the Playwright summaries (`gh run view <id> --log-failed`):
  - `7a459ef2d` (first);
  - `09f7c0087` (#1476);
  - `4ffba1039` (#1482);
  - `db79f49f0`;
  - `25eb1a9dd` (#1488);
  - `353b82b09`;
  - `6b79c2e2e` (the shard-3 Chrome install failure);
  - `9dfa477a9` (last).
- **Failure set.** Every failing test ID and stack line falls within the report's set, at the same lines:
  - `tools-create-audit:336`;
  - `focus-test-resume:39` → `recovery-flow.ts:297`;
  - `start-points:142`;
  - `recovery-deep-audit:234`;
  - `production-workflows:423`;
  - `calligraphy-fonts:75`;
  - `canvas-text-weld:70`;
  - `laser-lead-start-reseed:192` (only at `7a459ef2d`; gone at `09f7c0087`).
- **No masking mechanisms.** No retries or flaky results (`playwright.config.ts` sets no `retries`). No serial mode. Shard 3 at `6b79c2e2e` stopped at "Error: Failed to install chrome", as the report says.
- **No suite changes.** From `eaa4bb015` to `4f71f1f41`, `e2e/` has no deleted or added spec and no added `skip`, `fixme` or `only`: the `skip`/`fixme` count is 4 at both ends. `playwright.config.ts` and `e2e.yml` are unchanged.
- **Arithmetic (minor).** The 15 IDs are the 14 IDs from #1513's 7 spec locations (6 + 8 fonts) plus `laser-lead-start-reseed`, which makes 8 spec locations. The "(7 spec locations)" wording counts reseed in the 15 IDs but not in the locations.

**Release exit code: no main-process cause in 1.0.28.**

- **Quit path unchanged.** Between 1.0.27 and 1.0.28 the `electron/` quit path is unchanged:
  - the same `will-quit` wiring (`main.ts:573-576`);
  - the same fire-and-forget `cameraBridge.close()` with a `.catch` (`application-final-cleanup.ts:16-23`);
  - the same Electron, 44.9.1.
- **No new exit path.** The camera-bridge rewiring (`9354831c2`, `120b133db`) adds keys and an `app://` status route. It adds no exit path, no `process.exitCode`, and no child or utility process.
- **The failure is intermittent.** The same build closed with exit 0 twice in the same run: pid 1272 (`historical-upgrade-reopen`) and pid 4228 (licence cleanup, 8 s after the failure). The re-run passed every phase.
- **What it suggests.** The app exited 0.42 s after `WM_CLOSE` and left no JavaScript error box. That points at an abnormal native termination during teardown, not at KerfDesk code. It is unproven, because the harness did not record the code (N7-P3-2).

**Refuter: PLAUSIBLE.** The diff reading holds, but nothing positive proves the cause, and the history does not show the flake before 1.0.28.
- **Electron diff.** Read `git diff adf300522 33bc394c6 -- electron/` in full for quit paths:
  - `before-quit` (`main.ts:214-217`), `window-all-closed` (`:569-571`) and `will-quit` (`:573-576` with `application-final-cleanup.ts`) are unchanged apart from the bridge's construction.
  - `createDesktopCameraBridge` uses the same `cameraBridgeLifecycle.close` and the same `closeServer`.
  - Every `start()` and `close()` rejection is caught (`camera-bridge-lifecycle.ts:34-45`).
  - Nothing new sets `process.exitCode`, calls `app.exit` or `process.exit`, adds an `unhandledRejection` handler, or adds a child, utility or `worker_threads` process.
  - `CameraFrameSources` has no timers or spawns.
  - The licensing and update changes run only on update checks.
  - Electron is still 44.9.1. Serialport is unchanged. `package.json` adds only `fflate`, used only in `src/io/tiff/`.
- **Renderer close path (an addition).** #1479 changed `src/ui/app/desktop-close-controller.ts` and `desktop-close-runtime.ts` in 1.0.28. The new `output` branch acts only with a connected controller, and the phase connects none. In any case a renderer cannot set the main process's exit code.
- **Close timing.** In the coordinator's receipts, the failing close took 0.42 s from the `final-window` inspection to the receipt. The passing closes of the same run took 0.16 s (pid 1272), 0.23 s (pid 944, 1.0.27) and 0.25 s (pid 2556, 1.0.27). So the failing exit was slower, not abrupt.
- **No precedent.**
  - The 1.0.22 first-attempt failure (artifact `unsigned-installer-qualification-1.0.22-1`) is a different failure. Phase `native-historical-create` on the **1.0.21** binary failed with "Native control did not appear: Button Review setup" (`installed-upgrade-controls.ps1:73`). The app did not exit non-zero.
  - The other failed release runs are also different: 39960638656 (a Node `TimeoutError`) and 40045552515 (the dependency audit step).
  - Run 40846112322 is therefore the first "Owned app exited unsuccessfully" seen in this workflow's history, and it ran on 1.0.28. One occurrence in about nine qualification runs cannot separate a 1.0.28 cause from a runner flake.

## #1513's spec changes (L7)

| Spec | Change | Cause (PR / ADR) | Verdict |
|---|---|---|---|
| `calligraphy-fonts.spec.ts:18` (8 fonts) | Was: any saved file contains `"fontKey": "<key>"` and, anywhere, `Élodie & André`. Now: `savedSceneObjects` parses each saved project, and one object must be `kind: 'text'` with that `fontKey` and that `content` | #1488. ADR-204 Amd 2: "Manual Save writes compact JSON, as autosave does." Confirmed on main: `prepare-project-persistence.ts:24,35` `{ compact: true }` | **Legitimate, and stronger:** both fields must sit on the same object. The re-edit tail after the save (`:76-…`), unrun for 18 runs, passes again |
| `canvas-text-weld.spec.ts:17` | `"weldOverlaps": true` substring → a text object with `weldOverlaps === true` | #1488, ADR-204 Amd 2 | **Legitimate, equivalent.** The Undo/Redo/re-edit tail after the save passes again |
| `recovery-deep-audit.spec.ts:219` | Adds `useMachineInUse(page, { airAssistCommand: 'M8' })` before Open. The file still carries M8, and both M8 assertions (`:239`, `:244` on main; `:234` in the red runs) are unchanged | #1466. ADR-500 Amd 2 D1 ("the current machine's whole profile is kept"); D2 names "air assist" in the toast | **Legitimate.** The resume program restores M8 before the resumed burns (oracle `laser-burn-oracle.test-helper.ts:131` starts with air off and tracks M7/M8/M9). Unit 9/9 REPRO |
| `focus-test-resume.e2e.ts:11` | Homing enabled on the machine in use; the file's homing is the same object | #1466, ADR-500 Amd 2 D2 ("homing") | **Legitimate.** The red runs timed out at `recovery-flow.ts:297` (`home.click()`), because Home exists only with homing on. The spec's purpose (Focus Z refused before a program is sent) had not run since `eaa4bb015`, and now passes |
| `tools-create-audit.e2e.ts` `beforeEach` (Print and Cut `:329`, and every test in the file) | Homing on the machine in use before each Open | #1466. The gate `print-cut-command-family.ts:18` reads "Print-and-Cut requires a homing-enabled absolute-position profile." | **Legitimate.** Every test in the file had homing from the file before; it now has it from the machine. Same coverage |
| `start-points.spec.ts:124` | The rotary is set on the machine in use before Open | #1466, ADR-500 Amd 2 D2 ("rotary setup") | **Legitimate.** The red runs failed at `:142` (`aria-disabled` `false`): with no rotary, the start handles are live |
| `production-workflows.spec.ts:418` | Removes the **Replace settings** click; asserts the radio is checked and the Replace button count is 0 | #1499 (ADR-322 Amd 3: the A1 Pro preset homes front-left, `falcon-profiles.ts:24`). ADR-637 Amd 1: `machine-choice-replaces.ts` names only tuned values that change. project-basic's machine homes front-left too | **Legitimate.** The xTool spec still clicks Replace (`:486`). The spec no longer asserts the homing or kinematics it relies on: KNOWN N2-P3-5 |
| `laser-lead-start-reseed.e2e.ts:145` | #1476's private `useMachine` is replaced by the shared `useMachineInUse`; the body is the same | #1466 drift, already fixed by #1476 | Refactor only |
| `fixtures/machine-in-use.ts`, `fixtures/project-save.ts` | New helpers | — | **Sound.** `updateDeviceProfile` + `dirty: false` mirrors Machine Setup, and each test has its own page and storage. `savedSceneObjects` skips unparsable files, but each caller polls for a positive match, so a skipped file cannot make a test pass |

**Other vacuous string matches (L7 sibling check).** No other e2e spec or unit test matches indented project JSON (`git grep -F '": '` over `e2e/`, `src/**/*.test.*` and `scripts/*.mjs`). The three hits are all on indented serializers:
- `machine-profile-io.test.ts:165`;
- `project-machine-cnc.test.ts:293`, which uses a `\s*` regex on `serializeProject` (indented by default);
- `project-template-actions.test.ts:67`, where the template wrapper is still `JSON.stringify(…, null, 2)` at `project-template.ts:19`.

None is a negative match that compact saves could make vacuous.

## Red-window failures

The shard-3 job of run 40727062046 (`6b79c2e2e`, #1510) failed while installing Chrome. Its 104 tests did not run on that commit, which is why two rows below count 23 runs. The next run (`0cdee525a`) covers it.

| Test | First red (completed run) | Failing line | Cause | Now (main) |
|---|---|---|---|---|
| `tools-create-audit.e2e.ts:329` (Print and Cut) | `7a459ef2d` (#1470 tip; #1466's own run `1ce909730` was cancelled), 24/24 runs | `:91` click timeout via `:336`: the command is disabled | #1466 drift (homing came from the file) | Green at `33bc394c6` and later (shard 4: 125 passed, 0 failed) |
| `focus-test-resume.e2e.ts:11` | `7a459ef2d`, 24/24 | `recovery-flow.ts:297` Home click timeout | #1466 drift | Green |
| `start-points.spec.ts:124` (rotary) | `7a459ef2d`, 23/23 that ran | `:142` `aria-disabled` `"false"` | #1466 drift | Green (shard 3: 104/104) |
| `recovery-deep-audit.spec.ts:219` (air) | `7a459ef2d`, 23/23 that ran | `:234` original burns' air `off` ≠ `M8` | #1466 drift (the machine in use has no air output) | Green, M8 assertions unchanged |
| `laser-lead-start-reseed.e2e.ts:145` | `7a459ef2d`, runs 1–3 only | `:192` `native` `false` | #1466 drift | **Green from `09f7c0087`** (#1476 set the machine first). Not one of #1513's six; same cause |
| `production-workflows.spec.ts:418` (Falcon wizard) | **`4ffba1039`** (#1482), 19/19 from there. Green at `f730f5b03`; three runs in between were cancelled | `:423` Machine tab click: "Status bar intercepts pointer events" | **#1482 product regression** (`29ee16568` lengthened `opened-machine-notice-words.ts` while the banner's actions had `flexShrink: 0` and no wrap). #1499 drift was hidden behind it | Green after #1513's wrap fix and spec change |
| `calligraphy-fonts.spec.ts:18` ×8 | **`25eb1a9dd`** (first completed run after #1488 `24e1d2b61`, whose run was cancelled), 14/14 | `:75` | #1488 drift | Green (shard 1: 125 passed, 11 skipped) |
| `canvas-text-weld.spec.ts:17` | **`25eb1a9dd`**, 14/14 | `:70` | #1488 drift | Green |

**PR checks in the window.** Every PR from #1466 to #1513 merged with Chrome UX smoke SUCCESS (`statusCheckRollup`), all on the ADR-647 subset. None of them ran a spec that main was failing, except:
- #1476, which ran and fixed `laser-lead-start-reseed`;
- #1507, which changed `focus-test.e2e.ts` for schema 19, a spec that never failed;
- #1513.

## Findings

### N7-P3-1 — While main's full Browser smoke is red, nothing notices a new failure: #1482's phone-width banner regression was reported by main's own run and went unnoticed for about 37 hours, live on kerfdesk.com

- **Where:**
  - `.github/workflows/e2e.yml:3-8`: main runs are "OBSERVABILITY ONLY", and nothing notifies anyone of a red result.
  - `.github/workflows/e2e.yml:18-26`: a newer pending main run replaces an older pending one.
  - The standing auto-merge rule merges any PR whose own checks pass.
- **Anchor (Contract):** the ADR-647 Consequences rely on main's run to catch what the subset misses. A breakage outside the subset is reported by "Main's full Browser smoke run … about 40 minutes after the merge, and the fix is a revert or a follow-up" (`docs/decisions/ADR-647-lighter-pull-request-ci.md`, Consequences, "Residual risk"). That net works only while main's run is green.
- **Scenario:**
  - **The window.** From `7a459ef2d` (2026-10-27 11:48 UTC) to `33bc394c6` (2026-10-29 05:55 UTC), 47 commits reached main. 24 completed main runs failed, and 19 runs were cancelled.
  - **#1482.** It merged at 16:51 UTC. Its subset run passed, and its first main run (`4ffba1039`, 40544980543) added a new failure: `production-workflows.spec.ts:423`, "Status bar intercepts pointer events". This was a real regression: a 520 px banner at 390 × 844, a 16 px workspace, and the panel tabs under the status bar (#1513's measurements). In a suite that was already red, it looked like more of the same.
  - **Exposure.** `deploy.yml` gates on CI only (ADR-158). Between `93334429e` (17:08 UTC on 2026-10-27) and `9dfa477a9` (05:08 UTC on 2026-10-29), 23 successful web deploys carried the regression to kerfdesk.com.
  - **The desktop release was safe.** The unsigned desktop release waits for Browser smoke, so no desktop release carried the regression.
  - **Masked behind #1482.** #1499's Replace-settings drift sat behind #1482's failure at `:423`, and #1488's drift added 9 more red tests.
  - **Checks that did not run.** For 42 hours these never executed:
    - the Focus Z refusal in `focus-test-resume.e2e.ts`;
    - the recovery air check in `recovery-deep-audit.spec.ts:219`;
    - the rotary keyboard path in `start-points.spec.ts:124`;
    - the Print and Cut registration test.
- **Evidence:** READ, from the CI run history and the per-run failure matrix above. The run IDs are listed in the header.
- **Refuter: CONFIRMED** by two independent lines: the run logs and the deploy history.
  - **Run log.** Run 40544980543 (`4ffba1039`) newly fails `production-workflows.spec.ts:418` at `:423:65`. Both `<footer … aria-label="Status bar">` and `<section … aria-label="Opened project machine disclosure">` "intercepts pointer events". The previous completed run, `f730f5b03`, did not fail this test.
  - **Timeline.** #1482 merged at 16:51:14Z. #1513 opened at 05:03:48Z on 2026-10-29 (36.2 h later) and merged at 05:55:10Z (37.1 h). No issue or PR mentioned the failure before #1513 (`gh search`).
  - **Deploys.** `deploy.yml` runs on `workflow_run: [CI]` only. Between 17:08 on 2026-10-27 and 05:08 on 2026-10-29 there are 23 successful deploy runs, over 19 distinct SHAs.
  - **No tracker.** No workflow opens an issue for a red Browser smoke. `audit.yml` and `desktop-preview-cadence.yml` already use the one-tracking-issue pattern the fix proposes.
  - **ADR quote.** The ADR-647 "Residual risk" quote is accurate.
  - **Wording.** "Nothing notifies anyone" is slightly strong: GitHub's default failed-run notification goes to the pusher. But it fires on every red run, so it cannot single out a new failure. The finding's point stands.
  - **Corrections.**
    - The window holds 43 first-parent commits from `7a459ef2d` to `33bc394c6`. The "47" counts from `eaa4bb015`.
    - Main e2e runs cancelled: 18 after `7a459ef2d`, or 22 after `eaa4bb015` (including `1ce909730`), not 19.
    - The culprit file at `29ee16568` was `ProjectBedReconciliationBanner.tsx`. `opened-machine-notice-words.ts` did not exist until #1492 (`1058af31b`) extracted it.
  - None of these changes the finding.
- **Fix direction:**
  - **Tracking issue.** Add a workflow on `workflow_run` (Browser smoke, branch main). On failure, it opens or updates one tracking issue with:
    - the failing test IDs;
    - each ID's first failing commit, from a diff against the previous completed run's set;
    - a highlighted line for any ID that is new since the last run.
    It closes the issue when main is green again. This makes a second failure visible inside a red window.
  - **Optional gate.** Pause auto-merge while main's last completed Browser smoke is red. That is a gate, so it is the maintainer's decision under ADR-206.

### N7-P3-2 — The release harness throws before it records the app's exit code, and keeps none of the app's own evidence, so the 1.0.28 first-attempt failure cannot be classified

- **Where:**
  - `scripts/installed-upgrade-profile.ps1:107-113` (`Close-UpgradeAppNormally`): line 111 throws before line 112 records `$receipt.exitCode`.
  - `:259-271`: the `catch`/`finally` write the receipt with no exit code and copy no app log.
  - `scripts/qualify-windows-installer.ps1:417`.
- **Anchor (L6, failure path):**
  - **Exit code.** The harness's own receipt has an `exitCode` field (`:112`), set only on success.
  - **Support log.** The app's support log already records what would classify the exit (`electron/support-log.ts`, file `<userData>/logs/kerfdesk.log`, `:155`):
    - "KerfDesk quit." at `will-quit` (`:210`);
    - every main-process uncaught exception (`:191`);
    - every child process that ends, with its exit code (`:194-201`).
- **Scenario:** run 40846112322, phase `historical-reinstall-reopen`, pid 3788.
  - The data check passed: "Saved artwork, geometry, workspace … verified."
  - `final-window` was inspected at 09:09:17.268Z.
  - The receipt closed at 09:09:17.690Z with `"error": "Owned app exited unsuccessfully."` and no `exitCode`.
  - The same 1.0.28 binary exited 0 for pid 1272 (`historical-upgrade-reopen`, 09:08:43) and pid 4228 (`historical-licence-cleanup`, 09:09:25). Every phase of the re-run 40847952302 also exited 0.
  - Nothing in the evidence can say whether `will-quit` ran, or whether the code was a crash (`0xC0000005`) or a CHECK (`0x80000003`).
- **Evidence:** READ (harness source on main; the receipts in `rel-qual-1028\…\historical-upgrade\*\result.json` and `qualification.json`).
- **KNOWN-adjacent:** N1 noted the exit-code half in its Refuted section as a side note ("Harness gap"), without raising it.
- **Refuter: CONFIRMED** by two lines: the harness source and the receipt.
  - **Source.** `scripts/installed-upgrade-profile.ps1` on `4f71f1f41`:
    - `:111` throws `'Owned app exited unsuccessfully.'` before `:112` assigns `$receipt.exitCode`.
    - The `catch` (`:259-261`) records only `status` and `error`.
    - The `finally` (`:262-273`) refreshes `$app` but never reads `ExitCode`, and copies no log.
  - **Receipt.** The coordinator's `historical-reinstall-reopen/result.json` has `status: failed`, pid 3788, the error text, and no `exitCode`.
  - **Same run, other phases.** `historical-upgrade-reopen` (pid 1272) and `historical-licence-cleanup` (pid 4228) both record `exitCode: 0` on 1.0.28.
  - **Support log.** `electron/support-log.ts:155,191-210` records what the finding says: the log directory, `uncaughtExceptionMonitor`, `child-process-gone` with its exit code, and "KerfDesk quit." on `will-quit`.
  - **The 1.0.22 receipt.** It kept no app log either. Its failure was a UI timeout, not an exit code.
- **Fix direction (minimal):** record the code before the throw.

  ```powershell
  function Close-UpgradeAppNormally {
    Assert-UpgradeApp
    if (-not $app.CloseMainWindow() -or -not $app.WaitForExit(30000)) { throw 'Owned app did not close normally.' }
    $app.Refresh()
    $receipt.exitCode = $app.ExitCode
    $receipt.exitCodeHex = '0x{0:X8}' -f $app.ExitCode
    if ($app.ExitCode -ne 0) { throw "Owned app exited unsuccessfully: $($app.ExitCode) ($($receipt.exitCodeHex))." }
    $receipt.status = 'passed'
  }
  ```

  Two optional additions in the `catch` would make the next failure diagnosable. Both are read-only on a disposable runner:
  - **Support log.** Copy the last 64 KB of `$ExpectedProfile\logs\kerfdesk.log` into `$EvidenceRoot`. If it ends without "KerfDesk quit.", the process died before `will-quit`.
  - **Crash events.** Save `Get-WinEvent -FilterHashtable @{ LogName = 'Application'; ProviderName = 'Application Error', 'Windows Error Reporting'; StartTime = [DateTime]::Parse($receipt.startedAt) } -ErrorAction SilentlyContinue | Where-Object Message -match 'KerfDesk'` as JSON. For a native crash this gives the faulting module and the exception code.

### N7-P3-3 — The banner fix limits the width, not the height: the notice still has no maximum height, it is tallest just above the wrap point rather than at phone width, and the only test is at 390 × 844

- **Where:**
  - `src/ui/app/notice-banner-style.ts:11-34`;
  - `ProjectBedReconciliationBanner.tsx:18-41`;
  - `App.tsx:92-118` (the banner is a flex item in the column shell, `shellStyle` `:235-240`);
  - `workspace-layout.css:1-10` (`height: 100dvh; overflow: hidden`), with `mainStyle` `:241-247` (`flex: 1; minHeight: 0`).
- **Anchor (L10, sibling widths):** #1513 checked 390 × 844 (e2e, plus a dev-server measurement of 136 px) and 1280 × 800 (50 px). The words column is `flex: 1 1 20em`, which is 240 px at 12 px. The two buttons share the row while 240 + 12 + B ≤ W − 24, where B is the buttons' width.
  - **Below that width** the words take the full row (W − 24; 366 px at 390).
  - **Just above it** they are only about 240 px wide. A given notice therefore has about 1.5× as many lines there (366/240) as at 390 px.
  - **Height cap.** Nothing caps the height. The section keeps `min-height: auto` as a column flex item, so a long notice still takes height from `main`, which can shrink to 0.
  - **No minimum window size.** The desktop window sets no `minWidth` or `minHeight` (`git grep` in `electron/`).
- **Scenario (estimate, READ):**
  - **Typical notice.** The Falcon e2e notice (about 5 lines at 390 px) is about 8 lines, or ~150 px, at a ~600 px window. That is fine.
  - **Long notice.** `openedMachineNoticeWords` repeats the differing-settings list up to three times on the same-machine path: in `settingsWords` twice and again in `keepWords`. Add a camera and a workspace mismatch, and the words reach several hundred characters. That makes a banner of roughly 250–450 px at 390–600 px wide.
  - **Effect.** On a 600–700 px tall window, or a landscape phone (844 × 390), that leaves `main` with little or no height. This is the same failure mode #1513 fixed, through height instead of width.
  - **Not measured.** No browser was run (see Not verified).
- **Evidence:** READ (CSS geometry; the line counts are estimates).
- **Refuter: PLAUSIBLE.** The geometry holds on reading, and an independent estimate agrees. Nothing was measured in a browser.
  - **Geometry checked:**
    - `noticeBannerTextStyle` is `flex: '1 1 20em'`, and the section sets `fontSize: 12`, so the basis is 240 px.
    - The section has no `flex` or `max-height`.
    - `mainStyle` is `flex: 1; minHeight: 0`.
    - `.lf-app-shell` is `height: 100dvh; overflow: hidden`.
    - No height-based `@media` rule touches the shell; the only `workspace-layout.css` query is `max-width: 700px` for the side panels.
    - `electron/` sets no `minWidth`, `minHeight` or `setMinimumSize`.
  - **Repeated list.** `opened-machine-notice-words.ts` lists `differingSettings` twice in `settingsWords` and once more in `keepWords`, as the finding says.
  - **Independent estimate.** A same-profile notice with six differing settings, a camera change and a workspace mismatch comes to about 914 characters. At about 6.3 px per character and a 16.8 px line, that is about 16 lines (≈285 px) at a 366 px column and about 24 lines (≈420 px) at a 240 px column. This is consistent with 250–450 px.
  - **Landscape phone (844 × 390).** The words get about 520 px, which is about 11 lines (≈200 px). That case is the most likely to leave `main` nearly empty.
  - **Severity.** P3 stands: layout polish with a narrow trigger, and no wrong output.
- **Fix direction:**
  - Cap the words at about 30–40 dvh with `overflow-y: auto`, so the buttons always stay visible.
  - Add one e2e at about 600 × 700 and one at 844 × 390. Each should use the longest notice (same profile, camera, mismatch, four or more differing settings), and assert that the Machine tab is the hit target and that `main` keeps a minimum height.

## KNOWN re-observed

- **N2-P3-5** (`N2-fix-a1-pro.md`): #1513's Falcon wizard spec no longer asserts the homing or kinematics that removed the Replace step. Confirmed. N2's Refuted section also judged the change legitimate, and this audit agrees.
- **N1's "Harness gap" note** (`N1-fix-window-stall.md`, Refuted): `Close-UpgradeAppNormally` does not record the exit code. Raised here as N7-P3-2, with the support-log and WER additions.
- **Refuter (KNOWN entries).** All three references exist as cited:
  - `N2-fix-a1-pro.md:16,76`;
  - `N1-fix-window-stall.md:293`;
  - `2026-09-06-grok-pipelines-audit.md:19,104`.
  - The "19 main runs" below should read 18, or 22 counted from `eaa4bb015`.
- **pipelines-CI-09** (`2026-09-06-grok-pipelines-audit.md`): main Browser smoke runs can be skipped in a burst. `e2e.yml:18-26` now keeps main runs from being cancelled in progress, but a newer pending run still replaces an older pending one ("a burst of merges runs the tip"). In this window that cancelled 19 main runs, including #1466's own (`1ce909730`). The first red run was therefore `7a459ef2d`, and #1513 had to infer the culprit. This is documented behaviour; the effect is noted here because it made the attribution indirect.

## Refuted

- **"#1513's air-assist change hides a recovery regression."**
  - The recovery assertions (`:239`, `:244`) are unchanged, and they run and pass on main.
  - The resume oracle unit test passes 9/9 on main's tree.
  - The old red runs produced air `off` because ADR-500 Amd 2 keeps the machine in use, which had no air output. Two notices disclose that: the Open toast ("air assist" is in `project-bed-reconciliation.ts:245`'s label list) and Job Review's manual-air warning.
- **"A failure masked by the red window is still on main."**
  - Main's full suite has passed four times since #1513: `33bc394c6`, `08b5c669b`, `c1acfdff6`, `4f71f1f41`.
  - The shard totals match the last pre-window green run.
  - #1513 changed no assertion after any red test's failing line, except the Falcon Replace step, which is legitimate.
  - No `test.skip` or `fixme` was added in the window: `e2e/` changed only in `focus-test.e2e.ts` (#1507, schema 19) and `laser-lead-start-reseed.e2e.ts` (#1476).
- **"The camera-bridge rewiring (`9354831c2`, `120b133db`) can make a normal close exit non-zero."**
  - **Bridge changes.** `createDesktopCameraBridge` adds keys (`camera-bridge-keys.ts`), an `app://` status route that retries a failed start, and a stored failure reason (`camera-bridge-lifecycle.ts`).
  - **Quit wiring unchanged.** It is the same as 1.0.27 (`adf300522:electron/main.ts:570-571`): `remoteAccess.cleanup(() => cameraBridge.close())` is fire-and-forget in `will-quit`, and its rejection is caught.
  - **No exit path.** No `app.exit`, `process.exit` or `process.exitCode` was added. The only `app.exit(1)` calls are still the refused debug switch (`main.ts:118`), a failed first window (`:566`) and native smoke mode (`native-smoke.ts:218`); qualification runs in "no CDP or smoke mode". No `quitAndInstall` is called.
  - **Unrelated changes.** The other main-process changes in 1.0.28 cover update wording (#1475: `commercial-update.ts`, `update-status.ts`, `licensing-runtime.ts`, `licensing-update-cache.ts`) and MCP schemas. None runs at quit.
  - **Same runtime.** `package.json` changed only by adding `fflate`, which is used only in the renderer (`src/io/tiff/tiff-decompressed-length.ts`).
- **"`ExitCode` was unreadable, not non-zero (the Start-Process handle quirk)."** The harness starts the app with `[Diagnostics.Process]::Start($info)` (`installed-upgrade-profile.ps1:200`), which keeps the process handle. The same function recorded `exitCode: 0` in the three phases that passed.

**Refuter on the four refutations: all hold.**
- **Air assist.** The failing assertion was on the original burns (`:234`), and the recovery half passes on main.
- **Masked failure.** It is re-derived from 8 sampled runs and the unchanged skip count.
- **Camera bridge.** The diff was re-read, and the renderer close path (#1479) was added to the check.
- **ExitCode.** `:200` uses `[Diagnostics.Process]::Start`, and the coordinator's receipts show `exitCode: 0` for pids 2556, 944, 1272 and 4228. That is four phases, counting the licence cleanup.

## Verified clean

- **#1513's banner fix on its own terms.**
  - CI REPRO at 390 × 844: `production-workflows.spec.ts:418` clicks the Machine tab and passes, at `33bc394c6` and every later run.
  - The import banner (`ExternalGcodePreviewBanner.tsx`) uses the same wrap. Its single button is a direct flex item, so it drops below the words.
  - The sibling notices above the workspace already wrapped: `DesktopCloseNotice.tsx:33-45` and `DesktopSessionEndNotice.tsx:32-36`.
  - The unit test's assertions (`ProjectBedReconciliationBanner.test.tsx:74-91`: `flexWrap`, `flexGrow`, `flexBasis 20em`, a shrinkable wrapping actions row) are absent on the parent by construction, so they fail there. That is READ; the test was not run.
- **#1513's culprit attribution:**
  - #1482 is the only commit between `f730f5b03` and `4ffba1039` that touched `opened-machine-notice-words.ts`, the banner or `project-bed-reconciliation.ts` (`29ee16568`).
  - #1488 is the only commit between `db79f49f0` and `25eb1a9dd` that made manual saves compact (`24e1d2b61`).
- **The ADR-647 subset was honoured.** Every window PR's own Chrome UX smoke passed. No PR was merged with that check failing.
- **No failure arose in the window other than the 15 test IDs**, and no spec's failing line moved, so no second regression hid inside a red test before its failing line.

**Refuter on Verified clean:**
- **Banner fix: CONFIRMED.** Shard 2 is green at `33bc394c6` and later.
- **Culprit attribution: CONFIRMED.**
  - `f730f5b03..4ffba1039` holds #1479, #1481, #1480 and #1482.
  - Only #1482 (`29ee16568`) touched the banner (`ProjectBedReconciliationBanner.tsx`, not `opened-machine-notice-words.ts`, which did not yet exist) or `project-bed-reconciliation.ts`.
  - #1479 touched `DesktopCloseNotice.tsx`, which shows only on a desktop close.
- **ADR-647 subset honoured: CONFIRMED.** Sampled #1482, #1488, #1499 and #1507: each shows the core-and-changed job SUCCESS with the shards SKIPPED. There were no `merge_group` runs.
- **No other failure: CONFIRMED.**
- **Sibling check: holds.** It missed one positive indented match, `export-grbl-settings-backup.test.ts:54`, which checks the GRBL settings backup's own indented writer, not a project save. Compacting that writer would make the test fail, not pass vacuously.

## Not verified

- **The banner at widths other than 390 and 1280,** and at short heights. No browser or Vite server was started (419 MB free). N7-P3-3's line counts are estimates from the CSS.
- **The 1.0.28 first-attempt exit code and its cause.** It was not recorded. Whether real users' quits ever exit non-zero would need WER data from the field. It stays unclassified until N7-P3-2's additions run.
- **An earlier first-attempt failure of the same workflow step:** run 39847957270 (1.0.22, 2026-10-22, phase `native-historical-create`), from before the camera rewiring.
  - Its inner error is only in the artifact `unsigned-installer-qualification-1.0.22-1` (126 KB, not expired). That artifact was not downloaded.
  - `gh run download 39847957270 -n unsigned-installer-qualification-1.0.22-1` would show whether it was also "Owned app exited unsuccessfully". If so, the flake predates 1.0.28 entirely.
  - **Refuter: resolved, and it was not.** The artifact was downloaded, read as data, and deleted.
    - `native-historical-create/result.json` has `expectedVersion` "1.0.21", pid 7024, and `"error": "Native control did not appear: Button Review setup"`. The stderr points at `installed-upgrade-controls.ps1:73`.
    - It is a UI-automation timeout on the 1.0.21 binary, not a non-zero exit.
    - The non-zero exit therefore has no earlier occurrence among the release workflow's failed runs since 1.0.22: 39847957270, 39960638656, 40045552515 and 40846112322. Runs before 1.0.22 were not checked.
- **That an uncaught main-process exception would have left Electron's error dialog open** (so the app could not exit in 0.42 s). This is reasoning about Electron's default handler and was not checked against Electron's source (UNVERIFIED).
- **The shard-3 specs at `6b79c2e2e`** (#1510's merge) did not run, because Chrome failed to install. The next run, `0cdee525a`, includes #1510 and ran them.

## Refuter method

A fresh refuter ran on 2026-10-29 against the same tree (`4f71f1f41`; `origin/main` had since moved to `7d7cedcd6`). It had no access to the auditor's reasoning. It ran no Playwright, no Vite server and no vitest, because of the memory limit.

- **#1513.**
  - Read `gh pr view 1513` and `git diff 9dfa477a9 33bc394c6 -- e2e/`.
  - Read ADR-500 Amd 2 at `4f71f1f41`.
  - Read the toast label list, `manual-air-assist-warnings.ts` and its use in `job-review-model.ts`.
  - Read `machine-choice-replaces.ts`, `DeviceSetupMachinePicker.tsx` `useMachineChoice`, and project-basic's device.
- **Red window.**
  - Listed 100 main `e2e.yml` runs.
  - Parsed the Playwright summary blocks (`N failed` + `e2e/…:line`) and the `at …e2e/…:L:C` stack lines of 8 red runs with an awk script: first, middle, last, both growth points, #1476's fix, and the shard-3 Chrome install failure.
  - Read shard 3's job log at `33bc394c6` for its totals.
  - Ran `git diff --name-status eaa4bb015 4f71f1f41 -- e2e/ playwright.config.ts` and a `skip`/`fixme`/`only`/`serial` grep at both ends.
  - Checked the `statusCheckRollup` of 4 PRs and the deploy run list.
- **Release.**
  - Read `git diff adf300522 33bc394c6 -- electron/ package.json pnpm-lock.yaml` in full for the quit-path items, and the renderer close-path diff (`src/ui/app/desktop-close-*`).
  - Read the coordinator's `rel-qual-1028` receipts as data, for each phase's pid, exit code and timing.
  - Listed the release workflow's non-skipped runs and read the failed logs of 39960638656 and 40045552515.
  - Downloaded the 1.0.22 artifact (126 KB) into its own folder. It was read as JSON and text only, nothing in it was executed, and it was deleted afterwards.
- **P3s.**
  - Read the harness lines, `support-log.ts`, the banner style, the words builder, `App.tsx` and `workspace-layout.css`.
  - Estimated the notice length with a scratch Node script that repeats the words builder's string templates.

**Corrections to the auditor's text (none changes a verdict):**
1. 43 first-parent commits from `7a459ef2d`; "47" counts from `eaa4bb015`.
2. 18 cancelled main runs in the window, or 22 from `eaa4bb015`, not 19.
3. The 15 IDs span 8 spec locations including reseed, not 7.
4. #1482's words were in `ProjectBedReconciliationBanner.tsx`; `opened-machine-notice-words.ts` came later, with #1492.

Scratch files went in `…\scratchpad\zz-n7r\`, deleted at the end: the run logs, `parse.awk`, `len.cjs`, the release logs and the 1.0.22 artifact.

## Repro files

No file was created in the repo or in `j7-main`. One existing unit test was run on main's tree:

- `…\scratchpad\j7-main\src\core\controllers\grbl\resume-program.emitter-oracle.test.ts` passed 9/9 (61 s).
- Command: `NODE_OPTIONS="--no-experimental-webstorage --max-old-space-size=2048" node <repo>/node_modules/vitest/vitest.mjs run src/core/controllers/grbl/resume-program.emitter-oracle.test.ts`.

**Scratchpad working files, deleted at the end:**

- `…\scratchpad\n7-logs\<run-id>.log` (24 files): the `--log-failed` output of every red run.
- `…\scratchpad\n7-logs\<run-id>.log.err`: the error lines extracted from each.
- `…\scratchpad\n7-logs\green-<run-id>.log` (3 files): full logs of `eaa4bb015`, `33bc394c6` and `4f71f1f41`, for the shard totals.
- `…\scratchpad\n7-logs\matrix.tsv`: the run × test failure matrix.
- `…\scratchpad\n7-logs\installed-upgrade-profile.ps1`: a copy of the harness from main, for reading.

```json
[
  {"id":"N7-P3-1","severity":"P3","area":"fix-e2e-window","file":".github/workflows/e2e.yml","line":3,"anchor":"Contract: ADR-647 Consequences 'Residual risk' (main's full run reports a subset-missed breakage ~40 min after merge; fix is revert/follow-up) — only works while main is green","evidence":"READ","verdict":"CONFIRMED","refuter":"CONFIRMED: run 40544980543 (4ffba1039) newly fails production-workflows:423 with the status bar and the machine disclosure intercepting pointer events; #1513 opened 36.2 h and merged 37.1 h after #1482; 23 deploy runs (19 SHAs) in between; no workflow tracks a red Browser smoke. Corrections: 43 commits from 7a459ef2d (47 from eaa4bb015), 18 cancelled runs (22 from eaa4bb015); the culprit file was ProjectBedReconciliationBanner.tsx","known":"adjacent: grok pipelines-CI-09 (pending-run replacement), not this","summary":"Main's full Browser smoke was red 7a459ef2d..9dfa477a9 (24 failed + 19 replaced runs, 47 commits). #1482's run at 4ffba1039 added a real phone-width regression (production-workflows:423, banner 520 px, Machine tab under the status bar) that went unnoticed ~37 h and shipped in 23 web deploys; #1488 and #1499 drift landed the same way, and the Focus Z refusal, recovery air, rotary and Print-and-Cut checks did not execute for 42 h. Nothing reports a new failure inside a red window"},
  {"id":"N7-P3-2","severity":"P3","area":"fix-e2e-window","file":"scripts/installed-upgrade-profile.ps1","line":111,"anchor":"L6 failure path: the receipt's exitCode (:112) is set only on success; support-log.ts:155,191-210 already records will-quit, uncaught exceptions and child exits in <userData>/logs/kerfdesk.log","evidence":"READ","verdict":"CONFIRMED","refuter":"CONFIRMED: installed-upgrade-profile.ps1:111 throws before :112 records exitCode; catch :259-261 and finally :262-273 record no code and copy no log; the coordinator receipt for pid 3788 has no exitCode while pids 1272/4228 record 0; support-log.ts:155,191-210 records what is needed","known":"adjacent: N1 Refuted 'Harness gap' note (exit code only)","summary":"Close-UpgradeAppNormally throws 'Owned app exited unsuccessfully.' before recording $app.ExitCode, and the phase keeps neither kerfdesk.log nor WER events, so release run 40846112322's historical-reinstall-reopen exit (pid 3788, 0.42 s after WM_CLOSE; the same build exited 0 for pids 1272 and 4228 in that run and in every phase of the re-run) cannot be told apart as a crash, a CHECK or a clean non-zero code"},
  {"id":"N7-P3-3","severity":"P3","area":"fix-e2e-window","file":"src/ui/app/notice-banner-style.ts","line":25,"anchor":"L10 sibling widths: words flex 1 1 20em (240 px) — narrowest just above the wrap point; banner is a non-shrinking column flex item in a 100dvh overflow-hidden shell (App.tsx:235-247, workspace-layout.css:1-10); no window min size","evidence":"READ","verdict":"PLAUSIBLE","refuter":"PLAUSIBLE: the geometry holds on reading (20em = 240 px at 12 px, no flex or max-height on the section, main minHeight 0, a 100dvh overflow-hidden shell, no height media query, no window minimum size); an independent estimate of a 914-char same-profile notice is ~285 px at 366 px and ~420 px at 240 px; not measured in a browser","known":false,"summary":"#1513's wrap fixes the 390 px case (CI REPRO) but bounds width, not height: a notice has ~1.5x the lines just above the wrap threshold (~600 px window) as at 390 px, and nothing caps the banner, so a long same-profile notice (settings listed up to three times, plus camera and mismatch; ~250-450 px estimated) can still collapse main on a short window. Only 390x844 is tested"}
]
```
