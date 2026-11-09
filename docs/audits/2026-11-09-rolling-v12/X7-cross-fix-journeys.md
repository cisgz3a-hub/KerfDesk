# Rolling audit v12 — X7 Cross-fix journeys

- **When:** 2026-11-09, 21:20–22:45 +0800   **Tree:** origin/main @ `43d75cabb`. Repros ran on a mutable copy of the scratchpad export `j18-main` (`43d75cabb`, `.export-sha` checked), `zz-x7\mut`, with `node_modules` a junction. Main has since moved to `ffd9fe66b`; the only change after `43d75cabb` outside the audit docs is the notes line edited by #1660, checked below.
- **Scope:** whole jobs through main's real store, prepare/compile, Job Review, Start and the scripted GRBL simulator, crossing the fixes merged 2026-11-09: v12 (#1645, #1647, #1650, #1651, #1653, #1657) and v11 (#1635, #1636, #1639, #1640, #1641, #1643, #1644, #1649), plus #1646. Eight journeys:
  1. Returning 1.0.29 user on the converted laser: logo with copies, Leave white unburned, a led cut with a speed typed as `50/2 mm/s`, Job Review, Start, a door in the finishing tail, Pause/Resume, finish.
  2. Abort, controller power cycle, reconnect, Frame, re-run; the crash stop.
  3. A 500,000-line external program from the Run dialog, Abort latency; the phone/MCP route on a held job.
  4. A relief with a projected, tabbed cut-out on the converted-laser CNC; recovery gate; Save, reopen, re-run.
  5. Browser build: hidden-tab keep-awake and download saves.
  6. Camera logins against every save route the other fixes touch; rotary camera advice.
  7. Main's CI over the merge train.
  8. The merged 1.0.30 notes.
- **Lenses run:**
  - **L10:** each fix inside another fix's journey.
  - **L4:** a door in the tail on laser and CNC jobs, a power cycle after Abort, white knocked out of copies before a led cut, logins in ten address forms.
  - **L9:** door text against the phone's offer; notes against code.
  - **L12:** `gh run list --branch main`, per-merge runs, diffs grepped for skips and loosened budgets.
  - Not run: hardware, any live service, Firefox/Safari (none installed).
- **Counts:** 3 raised → refuter pending → P1 0 / P2 0 / P3 3 (+ 2 KNOWN re-observed: H8's unnumbered "Remote Pause in the `done` tail" note, which X7-P3-1 extends; ADR-637 Amd 10's announced external-run gap, which X7-P3-3's notes overclaim rests on).

## Headline

**The fixes hold together.** No fix's guard is skipped by another fix's route on the journeys run, and no new P1 or P2 was found.

- **J1, returning user:**
  - The 1.0.29 logo opens with "4 white shapes", and Leave white unburned removes all 4, including copies without `svgImport`. Lit length goes from 32,060 to 24,380 mm.
  - `50/2 mm/s` commits 1,500 mm/min and the cut's G-code says `F1500`.
  - A led cut that runs before the logo it surrounds is warned on 12/12 cases, before and after the knock-out.
  - On the simulator, a door opened in the finishing tail gets Pause, and Pause → Resume finishes the job; the completion offer appears.
- **J2, J4:**
  - #1647's restart rule and #1650's question hold on every route tried: Frame, Run again, both CNC recoveries and Job Review.
  - A relief with a projected cut-out saves, reopens and re-emits byte-identical G-code (14,151 lines).
- **J6:** no camera login reaches any written file. Ten login forms were tried against Save, chunked Save, autosave, the recovery-copy plan, a template, the remembered machine and the G-code header.
- **What is left is three P3s where a fix stops at the route it was written for:**
  - **X7-P3-1:** the phone still has no way forward for the tail hold that #1657 fixed on the PC.
  - **X7-P3-2:** #1640's "a browser Start says it first" fires only on Job Review's Start.
  - **X7-P3-3:** the merged notes promise the laser question "before any job", which the ADR excludes for the Run dialog.
- **L12:**
  - Only #1635 (CI, Desktop), #1643 (Browser smoke, Desktop) and #1650 (CI) had any required check green on their own merge commit. Each of the others got its first fully green run later (table below).
  - #1657's own merge `43d75cabb` is fully green.
  - No test was skipped, quarantined or given a looser budget.
  - #1639's new 300 ms Frame-Abort bound failed twice locally (382 and 357 ms) on a loaded 4-core host with the CPU profiler attached. It passed on CI (see Not verified).

## Journey matrix

"Holds" means the step behaved as its fix says, on main's real modules.

| Journey | Step | Result |
|---|---|---|
| J1 | 1.0.29 converted machine (`1.0.29-laser-made-cnc-last-machine.json`), GRBL sim `$32=0`, `$30=1000` | question open (`generic-grbl-400x400`, CNC) — holds |
| J1 | Open `1.0.29-white-logo-copies.lf2.gz` on it | opens as a laser job (device takes `cnc-output`, mode stays laser), so no question: the program is `M4`, correct for a laser. Open toast and Job Review both name "4 white shapes" — holds (#1651) |
| J1 | Leave white unburned | returns 4; review warning gone; lit 32,060 → 24,380 mm — holds |
| J1 | Speed typed `50/2 mm/s` (`dimensionEntry`) | 1,500 mm/min; emitted `F1500` — holds (#1657) |
| J1 | Led cut (lead-in arc 2 mm) around a copy, listed after the logos | runs last (`; layer x7-cut … leads in arc` at line 6,807 of 6,817); no Cut-last row, correctly |
| J1 | Same cut moved first in `artworkOrder`, with and without lead, around the original, an Array copy and the Duplicate, before and after the knock-out | Cut-last warning 1 in all 12 cases — holds (#1653 × #1651) |
| J1 | Frame, Start through the real review, simulator to the finishing tail (`done`, 15 blocks pending), door open | state `Door`; bar `Pause`, `ABORT JOB`; door text present — holds (#1657) |
| J1 | Door closed, Pause → Resume | `paused` → stream ends, `pendingMotions` 0, completion offered — holds |
| J3 | Same tail hold, read by the phone/MCP projection | **Pause "No running job to pause.", Resume "No paused job to resume.", job state `unknown` (phone shows "Running"); only Abort offered — X7-P3-1** |
| J5 | Door in the tail of a CNC profile job, Pause | `Pause` offered; Pause skips the lift ("spindle was off at the stop point" / "`$32` on or unconfirmed"); Resume finishes. The lift-in-tail path was not reached (see Not verified) |
| J2 | Abort → power cycle → reconnect → Frame (no homing / homing), same-session control | #1647's 4 simulator cases pass on `43d75cabb` (local Vitest) — holds |
| J2 | Alarm 3 card after a power-up | READ: an unowned banner sets `alarmCode` from `takeAlarmBeforeBanner` only (`laser-line-handler.ts:412-414`, `:437`), so the card's no-home "Restore saved origin" cannot outlive a power-up; the Frame offer reads `machineZeroEpoch` — holds |
| J2 | Renderer crash or close during a job (#1645 + #1647) | `machine-network-crash-during-close.test.ts` passes locally. READ: the crash stop is a main-process soft reset, and the reload starts a fresh store with no stop request; a reconnect bumps `machineZeroEpoch` (`laser-connection-actions.ts:233`) — no interaction |
| J2 | Run again after a re-run | READ: `runCompletedJobAgainFlow` → `runFreshFramedJobFlow` → `framed-run-start-review.ts:51` `runJobReviewGate`, so the converted-laser question and the Frame permit apply — holds |
| J3 | 500,000-line program, Run dialog, Abort during the stream | 53 ms to the controller; no whole-program pass on the page thread (`reviewExternalProgram` 0, `findLitRapids` 0) — holds (#1639) |
| J3 | Same file, Abort during the Frame | 382 ms and 357 ms against the spec's 300 ms bound; before #1639 this was 5,874 ms (W7 refuter). Not raised (Not verified) |
| J3 | Phone/MCP Resume of a paused CNC job (#1644) | `machine-resume-advisory.test.ts` passes locally; local stubs only, no Worker |
| J4 | Relief + projected profile with Tabs on, on the converted CNC | `convertedLaserQuestion` open; Job Review model holds it; `cncRecoveryOpenProjectIssue` refuses with the question; program would be `M3 S12000`, `G4 P3.000` — gate holds (#1650 × #1643) |
| J4 | Answer "This is a CNC router" | question and recovery refusal clear |
| J4 | Save → reopen → re-emit | 14,151 = 14,151 lines, byte-identical; device unchanged; question returns for the reopened file if the answer is cleared — holds |
| J5 | Hidden tab during any active job (#1640 D1) | READ: `use-active-job-wake-lock` keys on `isActiveJob`, so every route gets the log, the title mark and the toast |
| J5 | Browser Start advisory (#1640 D3) | **only `job-review-gate.ts:235` calls it; the Run dialog, laser recovery, Start from line and camera burns start without it — X7-P3-2** |
| J5 | Firefox/Safari Save downloads | READ only (no such browser here): `web-adapter.ts` and `download-save-target.ts` download under the file name, the autosave is kept, and the bytes come from the same `prepareProjectForPersistence` the camera check ran on. The unit tests pass on CI |
| J6 | Older project with a login in each of 10 address forms, opened on main, then written by Save, `serializeProjectChunks`, autosave, `planRecoveryCopy`, template, remembered machine (write and reload), G-code header | stand-in secret found in 0 of 90 outputs; also 0 in the in-memory device after open — holds (#1649 × #1636 × #1640) |
| J6 | Phone/MCP projections | READ: `machineProjection` (`projections.ts:169-188`) carries bed, feed and CNC limits only; camera snapshots are pixels (W4) — clean |
| J6 | Rotary camera advice (#1641) | `start-job-rotary-camera-placement.test.ts` passes locally (stub camera state). READ: a jig layout's outline warning still comes first (`start-job-readiness-policy.ts:100-102`); jig mode is dropped (maintainer) |
| J7 | CI over the train | see the CI section |
| J8 | Notes | see the notes-truth table |

## Findings

### X7-P3-1 — A door or hold in the finishing tail leaves the phone with only Abort: Pause says "No running job to pause." while the PC now offers Pause and the door text names it

- **Where (43d75cabb):**
  - `src/ui/remote-control/machine-projections.ts:102`: `streaming: active && laser.streamer?.status === 'streaming'`.
  - `:126`: Pause is unavailable with "No running job to pause." unless the stream is `streaming`.
  - `:131`: Resume needs `paused`.
  - `:190`: a `done` stream projects job state `unknown`.
  - `services/remote-control/app/src/ui/machine-job.tsx:114` shows "Running" for that state; `:154-155` greys Pause with the projected reason.
  - The PC twin, changed by #1657: `src/ui/laser/LiveMotionBar.tsx:169-170` (`status === 'done' && (isControllerRunning || isControllerHolding)`).
  - The desktop action itself would accept the pause: `machine-actions.ts:237` checks `isActiveJob` only. So an MCP client that ignores the availability can pause; the phone cannot.
- **Anchor:**
  - **Twin:** `LiveMotionBar` `canPause` against `extendedAvailability.pause`.
  - **Contract:** ADR-207 Amendment 4 (a held finishing tail keeps Pause). ADR-585: the remote actions mirror the desktop's.
  - **Lens:** L10 (a fix that stops at one route) and L9 (the phone's reason is false: the job is running and held).
- **Scenario:**
  - A maker starts a 100 mm square cut from the PC and walks away with the phone, which is what the phone remote is for.
  - All 6 moves are buffered, and the lid is lifted. The PC bar now offers Pause, and its door text says "press Pause and then Resume here".
  - The phone shows "Running", greys Pause with "No running job to pause." and greys Resume with "No paused job to resume.". Hold is refused because a job is active.
  - The only way forward on the phone is Abort, which keeps an interrupted-job record that restarts 15 moves back. Otherwise the operator walks to the PC or uses a cycle-start button.
- **Evidence:** REPRO, `zz-x7\mut\src\zz-x7\j3-remote-tail.test.tsx` → `zz-x7\out\j3.jsonl`. This is the stress harness (real store, `LiveMotionBar`, `machineStatusProjection`) on the scripted GRBL with the stock 15-block planner.

  | Moment | Controller | Stream | PC bar | Phone Pause | Phone Resume |
  |---|---|---|---|---|---|
  | control, lines still sent | Idle/Run | `streaming` | Pause | available | "No paused job to resume." |
  | door in the tail | `Door` | `done` | **Pause**, ABORT JOB | **"No running job to pause."** | "No paused job to resume." |
  | door closed, +5 s | `Door` | `done` | Pause | "No running job to pause." | "No paused job to resume." |

- **Severity:** P3.
  - **For P2:** this is X5-P2-1's dead end, rated P2 at the PC, now only on the phone, and the phone's reason is untrue. Its owner is by definition away from the PC.
  - **Against:**
    - The PC offers Pause since #1657, and the beam is off throughout the door hold.
    - Abort keeps a recovery record, and MCP `pause_job` works.
    - The phone needs pairing, and its UI waits on the owed Worker redeploy. H8 judged the same done-tail gap "a missing control, not a skipped guard".
- **Announced?** No. ADR-207 Amendment 4 does not mention the remote.
- **Novelty:** partly KNOWN.
  - Rolling v3 H8 noted "Remote Pause in the `done` tail" with no ID ("not raised"), when the PC offered Pause only while the controller reported `Run`.
  - W2-P3-4 raised the same "Running / No running job to pause." wording for a CNC tool change.
  - New here: after #1657 a Door/Hold tail has a PC way forward and none on the phone, and the PC's door text names a control the phone greys.
  - No open PR touches `machine-projections.ts`.
- **Fix direction:**
  - Project `pause` as available when the stream is `done` and the controller reports Run, Hold or Door, the same rule as `LiveMotionBar`. Ideally share one predicate between the two.
  - Map that state to `running` (or a held state) rather than `unknown`.
  - Add the door-in-tail case to the remote availability tests.
- **Refuter:** PENDING.

### X7-P3-2 — The browser's "keep KerfDesk in front" advisory before Start exists only on Job Review's Start; the Run dialog, recoveries, Start from line and camera burns start a browser job without it

- **Where (43d75cabb):**
  - `src/ui/laser/job-review/browser-keep-awake-warning.ts:15-20` builds the advisory. Its only caller is `src/ui/laser/job-review/job-review-gate.ts:235`.
  - Starts that never pass that gate:
    - the G-code Inspector's Run (`src/ui/gcode-inspector/external-run.ts:250`), offered in every build (`GcodeInspectorDialog.tsx:111-127`, `RunOnMachineButton`, has no platform gate);
    - laser recovery (`src/ui/laser/laser-recovery-flow.ts:307`);
    - Start from line / manual restart (`src/ui/laser/start-job-resume-stream.ts:62`);
    - CNC supervised recovery (`src/ui/laser/cnc-supervised-recovery-stream.ts:97`);
    - camera calibration burns (`src/ui/camera/calibrate/transient-camera-job.ts:141`).
- **Anchor:**
  - **Contract:** ADR-117 Amendment 1, Decision 3: "**A browser Start says it first.** Job Review for a Start on a connection opened in the browser build … adds an advisory warning". Its Consequences say "A browser operator learns before Start".
  - **Twin:** Job Review Start against the other Start routes.
  - **Lens:** L10.
- **Scenario:**
  - A browser user opens a large photo-engrave `.gcode` from LightBurn and runs it from the Run dialog. #1639 made this route fast for big files, so it is the natural one for them.
  - Nothing before Start says the tab must stay in front.
  - They switch tabs and the computer sleeps. The stream stops, and an `M3` program's beam stays on over the stopped head (ADR-117 Amd 1 Context).
  - The same job started from Job Review would have said it first.
- **Evidence:** READ. `git grep browserKeepAwakeWarnings` finds the definition and one caller. The five routes call `startJob` directly. The runtime part (Decision 1: log line, "⚠ Keep visible" title mark, return toast) keys on `isActiveJob` and so covers all routes; only the before-Start advisory is missing.
- **Severity:** P3.
  - Decision 1 still tells the operator while the tab is hidden: a title mark and a log line, then a toast on return.
  - Decision 3 is advisory only, never a Start gate.
  - The gap is a missing advisory on less-used Start routes in the browser build, with no wrong output.
  - **For P2:** the Run dialog is where a big external `M3` file goes, the case the ADR names.
- **Announced?** No. ADR-117 Amd 1 names Job Review and the phone review only, and lists no other route as not covered.
- **Novelty:** new. Neither W9 nor the v11 refuter (`zz-w9r`) covered Start routes outside Job Review. No open PR touches these files.
- **Fix direction:**
  - Show the same advisory in the Run dialog's summary and in the recovery and Start-from-line confirmations when `connectionHost === 'web'`.
  - Or narrow ADR-117 Amd 1 D3 to "a Start from Job Review".
- **Refuter:** PENDING.

### X7-P3-3 — The merged 1.0.30 notes say KerfDesk asks whether a 1.0.29-converted CNC is a laser "before any job or recovery starts"; ADR-637 Amd 10 excludes the G-code Inspector's Run, which streams on that CNC without asking

- **Where (43d75cabb):**
  - `docs/releases/desktop-update-notes.json:6`, unchanged on main `ffd9fe66b`: "If 1.0.29 set your laser up as a CNC, KerfDesk asks whether it's a laser before any job or recovery starts".
  - `src/ui/gcode-inspector/external-run.ts:11-28` imports `confirmCncSetup` and the laser-mode evidence, but no `convertedLaserQuestion`.
  - The only gates are `job-review-converted-laser.ts:13-26` (Job Review) and `cnc-recovery-open-project.ts:37-43` (recoveries).
- **Anchor:**
  - **Contract:** ADR-637 Amendment 10, Consequences, "Still not covered" (`:79-80`): "An external G-code run (the G-code Inspector's Run) streams the operator's own file, not a CNC job KerfDesk compiled for this machine, so it is not asked."
  - **Lens:** L9 (the notes promise more than the code does).
  - Amendment 10's own suggested line says "before any job or recovery starts" too, so the ADR's suggestion contradicts its own "Still not covered".
- **Scenario:**
  - A returning user whose laser became a CNC reads the update notes and trusts that every job will ask first.
  - They open a LightBurn `.gcode` and use Run on machine. On a machine set up as CNC, KerfDesk asks for its CNC setup confirmation, not whether the machine is a laser.
  - The bytes are the file's own (a LightBurn laser program is still a laser program), so the burn is what the file says.
  - The notes' promise is simply not true for that route.
- **Evidence:** READ of the notes, the ADR and the route. J4 shows the question does hold Job Review and both recoveries (REPRO, `j4.jsonl`), so the overclaim is the external route only.
- **Severity:** P3, doc/code drift.
  - The ADR's reason holds: the external file carries no KerfDesk CNC preamble. Nothing burns differently from the file.
  - Only the promise is wider than the code.
- **Announced?** In the ADR, yes ("Still not covered"); in the notes, no.
- **Novelty:** new for the merged notes. X2 checked the then-open #1638 against v10's list and flagged a different overclaim on this line (the spindle-edited machines, now fixed by #1650). #1660 edited the notes after `43d75cabb` and left this line unchanged.
- **Fix direction:** reword the line to "before any job KerfDesk prepares, or a recovery, starts", or drop "any". Optionally add the external Run to the notes' caveats.
- **Refuter:** PENDING.

## Refuted

Candidates the auditor dropped:

- **"A led cut added around a 1.0.29 logo copy gets no Cut-last row after Leave white unburned (#1653 × #1651)."** Rejected. The outline ran last in `artworkOrder`, so it really ran after the engraving (`j1b.jsonl`). Moved first, all 12 cases warn, before and after the knock-out (`j1c.jsonl`).
- **"The Alarm 3 card's 'Restore saved origin' (no home) survives a power-up and writes the old machine-coordinate origin, bypassing #1647."** Rejected. A banner KerfDesk did not cause takes `alarmCode` only from an ALARM line before it (`laser-line-handler.ts:412-414`, `:437`). A power-up after ALARM:3 therefore clears the code and unmounts the card (`abort-alarm-recovery.ts:25-31`). The remaining offer, Frame's, checks `machineZeroEpoch` (`unrestored-abort-origin.ts:43-52`).
- **"Run again skips Job Review, so it misses the converted-laser question."** Rejected. `start-job-flow.ts:216-220` goes through `runFreshFramedJobFlow`, and `framed-run-start-review.ts:51` runs `runJobReviewGate`.
- **"#1649 cleans only `serializeProject`; chunked Save, templates, autosave or the recovery copy still carry an older file's login."** Rejected. All of them go through `withCurveGeometry` / `prepareProjectForPersistence`, and the open already cleans the in-memory device. Result: 0 of 90 outputs (`j6.jsonl`).
- **"Opening a 1.0.29 laser logo on the converted CNC skips the question and fires `M3` and a dwell."** Rejected. The job opens and runs as a laser job (`activeJobMachineKind` `laser`, `M4` program), so there is nothing to ask (`j1.jsonl`).
- **"#1643's projection changes a project's saved program on reopen."** Rejected. It is byte-identical after Save and reopen (`j4.jsonl`). The change against 1.0.29 is a notes item (table below).

## Verified clean

- **J1 end to end** (`j1-returning.test.tsx` → `j1.jsonl`):
  - #1651 counts and removes 4 white shapes on copies without `svgImport`.
  - #1657's `50/2 mm/s` emits `F1500`.
  - #1653 warns on led cuts, including around knocked-out copies.
  - #1657's tail Pause runs on a real stream: Door → Pause → Resume → completion offer.
- **J4** (`j4.jsonl`):
  - #1650 holds Job Review and CNC recovery on a #1643 relief projection job; the answer releases both.
  - Save, reopen and re-emit are byte-identical.
- **J6** (`j6.jsonl`): every login form in `camera-login-forms.test-fixture.ts` stays out of every route tried. No security issue found, so there is no `SECURITY-DETAILS.md`.
- **J3, #1639 on a 500,000-line file:** the stream starts with no whole-program pass on the page thread, and the stream Abort reaches the controller in 53 ms.
- **Local Vitest** (`zz-x7\out\vt-batch.txt`), `43d75cabb`, one worker, `--no-experimental-webstorage`, launched at 3.3 GB free:
  - 12 of the fix PRs' own files passed (129 tests):
    - `door-hold-tail.simulator`, `lightburn-path-u8` (#1657);
    - `abort-origin-after-restart.simulator` (#1647);
    - `cnc-recovery-converted-laser` (#1650);
    - `cut-order-warnings-prepared` (#1653);
    - `returning-user-white-copies` (#1651);
    - `machine-resume-advisory` (#1644);
    - `start-job-rotary-camera-placement` (#1641);
    - `project-camera-login` (#1649);
    - `use-active-job-wake-lock` (#1640);
    - `RunGcodeFileDialog.review-cost` (#1639);
    - `electron/machine-network-crash-during-close` (#1645).
  - My J6 (10 cases) also passed. J4 failed in that batch on my own fixture's relief bounds, not on code under audit; after the fixture fix it passed alone.

### CI on the merged results (L12)

Main's push runs per merge commit (`gh run list --branch main`, `gh api …/actions/runs?head_sha=`).

- **The three workflows** are CI, Browser smoke and Desktop package check.
- **Required checks:** the ruleset "Protect main branch" requires "Lint, typecheck, license, test, build", "Chrome UX smoke", the desktop package/launch, the Linux AppImage/.deb and the commercial Linux rehearsal. `strict_required_status_checks_policy` is false, so a PR merges without being current with main.
- **Why so many cancellations:** concurrency cancels a run when the next merge lands. The four merges from 17:02 to 17:08 (#1649, #1639, #1650, #1651) had no run on the combined tree until `7c3c00971`.

| PR | Merge commit | CI / Browser smoke / Desktop package on the merge | First fully green main commit containing it |
|---|---|---|---|
| #1635 | `af1573c77` | success / **failure** (#1622's relief spec, fixed by #1646) / success | `a468f7bea` |
| #1636 | `0cefa7723` | cancelled / failure (same spec) / success | `a468f7bea` |
| #1640 | `287007670` | cancelled ×3 | `a468f7bea` |
| #1645 | `be671b158` | cancelled / cancelled / failure (504 Electron fetch flake, X3) | `a468f7bea` |
| #1646 | `b0507a547` | cancelled ×3 | `a468f7bea` |
| #1647 | `637fd6a22` | cancelled ×3 | `a468f7bea` |
| #1644 | `7fcdd81b4` | cancelled ×3 | `a468f7bea` |
| #1641 | `59d66bb86` | **failure** / cancelled / **failure** | `a468f7bea` |
| #1643 | `bddf477a8` | cancelled / success / success | `7c3c00971` |
| #1653 | `24bdba5a8` | cancelled ×3 | `7c3c00971` |
| #1649 | `751a0fc32` | cancelled / cancelled / success | `7c3c00971` |
| #1639 | `a2a33b925` | cancelled ×3 | `7c3c00971` |
| #1650 | `c94993aa4` | success / cancelled / cancelled | `7c3c00971` |
| #1651 | `62e9321ed` | cancelled / cancelled / success | `7c3c00971` |
| #1657 | `43d75cabb` | **success ×3** | itself |

- **Both failures on `59d66bb86` are infrastructure:**
  - CI Unit tests (3/4): `electron/native-smoke.test.ts` failed with "Electron failed to install correctly"; 9,782 tests passed.
  - Desktop package: "Response code 504 (Gateway Time-out) failedTask=build" in both the Windows and the Linux packaging jobs.
- **Fully green main commits** (all three workflows success): `a468f7bea`, `7c3c00971`, `724a08ce1`, `8c6b04869`, `870764802`, `1bb55b48f`, `43d75cabb`.
  - Later: `130d71715` has CI and Desktop success but Browser smoke cancelled; on `ffd9fe66b` CI and Browser smoke were in progress at 22:40.
  - So every fix in scope has a fully green main commit, and #1657 is green on its own merge.
- **Skips, quarantines, budgets:** I grepped every merge's diff (`git diff <merge>^1 <merge>`) over tests, e2e, configs, `.github` and `scripts`. I searched for `.skip`, `.skipIf`, `.fixme`, `.todo(`, `.only(`, `retries`, `testTimeout`, `timeout:` and raised numeric budgets.
  - **None added.** Every timeout found belongs to a test the same PR added: #1639's 600 s spec, the 60 s cases in #1644, 120 s in #1643, 30 s in #1650 and #1647, and 120 s in #1640's e2e.
  - **No test file was deleted.** The removed `it(` calls in #1635 (3), #1640 (2) and #1650 (4) are renames or rewrites that match each PR's stated change. For example, #1650's "asks nothing of a router whose spindle was set up" became "still asks a converted laser whose spindle RPM was set to its S scale", which is ADR-637 Amd 10 D2.
  - #1646 fixed the failing smoke by changing production code (`relief-object-to-heightmap.ts`, `stock-design-target.ts`), not the spec. X6 audited that change.
  - Nothing hides a regression. The only test I saw fail locally is #1639's timing bound (Not verified).

### 1.0.30 notes truth (`docs/releases/desktop-update-notes.json` on `43d75cabb`; #1660's later edit noted)

| Highlight | Claim | On `43d75cabb` | Evidence |
|---|---|---|---|
| 1 | a held Enter can't resume a pause | true | X1 (V8-P2-1, #1615) |
| 1 | a network laser stops at once if the window crashes, even while closing | true | #1645; `machine-network-crash-during-close.test.ts` passes locally; X1-P2-1 fixed |
| 1 | a laser left on delays shutdown | true | X1 |
| 1 | Abort restores the origin even on `$10=0` | true in the controller session. Since #1647 it declines after a power-up or port reset on a machine without homing, and says why | #1647 tests pass locally. Not an overclaim; "unless the controller restarted" would be more exact |
| 1 | Reconnect waits for the job | true | X1 (ADR-637 Amd 9) |
| 2 | Machine Setup's Save switches to that machine's driver | true | READ `use-machine-setup-save.ts:93` (`switchDriverAfterSave`) |
| 2 | asks whether it's a laser before any job or recovery starts | **overclaims: the Run dialog is not asked** | **X7-P3-3**; true for Job Review Start, Run again and both CNC recoveries (J4) |
| 2 | a controller locked before connecting is offered Reset | not re-run | #1569, pre-v12 |
| 3 | Cut last for each part and for cuts with leads | true, also around 1.0.29 copies after the knock-out | J1c, 12/12 |
| 3 | missing-font notice (`43d75cabb`); replaced by "speeds typed in mm/s" in #1660 | mm/s true for whole expressions | J1: `50/2 mm/s` → `F1500`; #1657 tests pass |
| 4 | older logos and their copies are offered it; Re-import removes their white shapes; CSS transforms and DXF/HPGL arcs as drawn, so a re-import may move parts | true | J1 (4 of 4 removed); X2, X3 |
| 5 | the Run dialog reviews a big file once | true | J3 e2e: no page-thread review pass; stream Abort 53 ms |
| 5 | background prepare, off-thread photo/trace/text, GRBL times | not re-checked | X4 |
| 6 | Camera logins are no longer kept in saved or shared files; change the password if you shared | true for files written by this build; files already written stay until rewritten, which is why the note says to change the password | J6, 0 of 90 |
| 6 | Recover unsaved work never clears a newer copy | true | X2 (#1618) |
| 6 | Saved reliefs may cut slightly differently | **understates rather than overclaims** for a saved relief projection | ADR-572 Amd 3 D1–D2: one pass becomes levels of Depth per pass, and with Tabs on (ignored before) the loop now keeps tabs. #1660 left tabs out on purpose, per the coordinator (X6-P1-1). Not raised: nothing is promised that the code does not do |

Earlier overclaims, rechecked:
- **X2:** the white Re-import, the relief and the CSS re-import lines are all present now.
- **X3:** "Cut last … and for cuts with leads" is now true (#1653, J1c).
- **X5:** the door text now has its Pause (#1657, J1) on the PC; the phone is X7-P3-1.
- **X6:** tab and step-down overclaims are in Job Review lines, not the notes. They stay routed to #1643's session.

## Not verified

- **#1639's Frame-Abort bound.**
  - The repo spec failed twice here: 382 ms and 357 ms against its own 300 ms bound. The stream Abort was 53 ms.
  - The host had other agents' Vitest and ESLint running (as little as 0.3 GB free between my runs), and the spec runs with the CDP CPU profiler attached.
  - CI passed the same spec on `7c3c00971` and `43d75cabb`. Before #1639 the same Abort took 5,874 ms (W7 refuter).
  - Not raised, but the 300 ms bound may flake on slower runners. A quiet-host re-measure without the profiler would settle it.
- **CNC Pause in the tail with a real lift.** The simulator moves `mpos` to the planned end when a line is planned, so at the door the stop point was the program's end with the spindle off, and the lift was skipped (`j5.jsonl`). Whether a lift reset in a held tail replays the discarded tail correctly (ADR-411 re-entry with every line acknowledged) needs a time-faithful controller model or hardware.
- **Firefox/Safari:** not installed; the download Save is READ only (J5 row).
- **Main-process crash route:** READ plus the repo's crash-during-close test; no run of the packaged app, by instruction.
- **Phone UI:** the phone page itself was not rendered; X7-P3-1 rests on the projection the desktop sends and on `machine-job.tsx`.
- **Live Worker, camera, updater:** none, by instruction. Hardware: none.
- **The converted-laser answer is app-wide.** One "This is a CNC router" (or a CNC Machine Setup Save on a draft that was never in question) silences the question for any later project whose device is a converted starter. ADR-637 Amd 8 D3 calls this "asked once". A two-machine owner was not modelled; noted for the X2 owner, not raised.

## Repro files

All files are under `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-x7\`. Nothing in the repo was touched except this report.

- **The tree:** `mut\` is a copy of `j18-main` (`43d75cabb`) with `node_modules` a junction. Remove it with `cmd /c rmdir` on the junction only.
- **Vitest command:** from `mut\`, `node node_modules/vitest/vitest.mjs run <file> --maxWorkers=1` with `NODE_OPTIONS=--no-experimental-webstorage`.

| File | What it does |
|---|---|
| `mut\src\zz-x7\j1-returning.test.tsx` → `out\j1.jsonl` | J1 end to end on the GRBL simulator |
| `mut\src\zz-x7\j1b-cutlast.test.ts` → `out\j1b.jsonl` | led cut appended (runs last): no warning, correctly |
| `mut\src\zz-x7\j1c-cutfirst.test.ts` → `out\j1c.jsonl` | led and plain cut first in `artworkOrder`, before and after the knock-out: 12/12 warned |
| `mut\src\zz-x7\j3-remote-tail.test.tsx` → `out\j3.jsonl` | X7-P3-1: PC bar against phone projection on a door in the tail |
| `mut\src\zz-x7\j4-relief.test.ts` → `out\j4.jsonl` | J4: question, recovery refusal, answer, Save/reopen byte identity |
| `mut\src\zz-x7\j5-cnc-tail.test.tsx` → `out\j5.jsonl` | CNC tail Pause (lift not reached, see Not verified) |
| `mut\src\zz-x7\j6-camera.test.ts` → `out\j6.jsonl` | J6: 10 login forms × 9 routes |
| `mut\e2e\zz-x7-run-abort.e2e.ts`, `mut\playwright.zz.config.ts`, `mut\vite.zz.config.ts` → `out\e2e-run-abort.log`, `out\e2e-run-abort-2.log` | #1639's spec with delay logging; headless Chrome for Testing 1248, one worker, Vite on 4811 (stopped after) |
| `out\vt-batch.txt` | the 14-file local Vitest batch |

```json
{
  "area": "X7",
  "id": "cross-fix-journeys",
  "tree": "43d75cabb",
  "raised": 3,
  "findings": [
    {"id": "X7-P3-1", "severity": "P3", "area": "X7", "file": "src/ui/remote-control/machine-projections.ts", "line": 126, "anchor": "Twin: LiveMotionBar.tsx:169-170 canPause (ADR-207 Amd 4, #1657) vs extendedAvailability.pause", "evidence": "REPRO", "verdict": "PENDING", "known": "partly (H8 unnumbered note; W2-P3-4 wording)", "summary": "Door in the finishing tail: PC offers Pause and its text names Pause/Resume; the phone shows Running with Pause 'No running job to pause.' and Resume unavailable, leaving only Abort"},
    {"id": "X7-P3-2", "severity": "P3", "area": "X7", "file": "src/ui/laser/job-review/job-review-gate.ts", "line": 235, "anchor": "Contract ADR-117 Amd 1 D3 'A browser Start says it first'; twin: Job Review Start vs Run dialog / recoveries / Start from line / camera burns", "evidence": "READ", "verdict": "PENDING", "known": false, "summary": "The browser keep-awake advisory has one caller (Job Review); external Run (#1639 route), laser and CNC recovery, Start from line and camera burns start a browser job without it"},
    {"id": "X7-P3-3", "severity": "P3", "area": "X7", "file": "docs/releases/desktop-update-notes.json", "line": 6, "anchor": "Contract ADR-637 Amd 10 'Still not covered' (external G-code run not asked)", "evidence": "READ", "verdict": "PENDING", "known": false, "summary": "Merged 1.0.30 notes promise the converted-laser question 'before any job or recovery starts'; the G-code Inspector's Run is excluded by the ADR and does not ask"}
  ]
}
```

**Summary.** Raised 3 / P1 0 / P2 0 / P3 3 / KNOWN 2 (re-observed).
- **X7-P3-1:** a door or hold in the finishing tail gets Pause on the PC since #1657, but the phone shows "Running" with Pause "No running job to pause.", so its only way forward is Abort (REPRO).
- **X7-P3-2:** #1640's browser "keep KerfDesk in front" advisory exists only on Job Review's Start; the Run dialog, recoveries, Start from line and camera burns start without it (READ).
- **X7-P3-3:** the merged notes promise the converted-laser question "before any job", but ADR-637 Amd 10 excludes the Run dialog, which does not ask (READ).

## Refuter (2026-11-09)

- **Tree:** origin/main @ `43d75cabb`. `git log 43d75cabb..origin/main -- src` is empty at `ffd9fe66b`, so the code has not changed since; only docs and the notes moved (#1659, #1660).
- **How:** Node with main's real modules on the export `j18-main`. For the Vitest and Chrome runs, my own mutable copy `zz-x7r\mut` (`43d75cabb`, `node_modules` a junction). Headless Chrome for Testing 1248, one worker, one spec, Vite on 4893 (stopped after). Free memory was checked before each run: 3.3–4.8 GB for the browser and Vitest, about 0.4–0.7 GB at the start, when only Node ran.
- **Result in one line:** X7-P3-3 rises to **P2** (the notes and an in-app tooltip promise a question the external Run never asks, and on that route the converted type also switches off the lit-rapid warning a laser gets). X7-P3-1 and X7-P3-2 stay P3. One new P3 (X7-P3-4). #1639's Frame-Abort bound is not a regression: 14–36 ms here on a quiet host.

### Verdicts

#### X7-P3-1 — CONFIRMED, P3

- **Where the logic lives:** on the desktop, not in the Worker. Pause availability and its reason ("No running job to pause.") come from `src/ui/remote-control/machine-projections.ts:102,123-127`, and the "Running" title from `jobState` `:185-191`. The phone only renders what it is sent (`services/remote-control/app/src/ui/machine-job.tsx:114`, `:146-151`).
  - That phone code has rendered `availability.pause` since #1156 (`22868ee92`, 2026-10-11). Its only later change, `b667558a1`, added the Resume advisory.
  - So this gap reaches users with desktop 1.0.30 whatever happens with the Worker redeploy. It is also not new: before #1657 the PC and the phone both lacked Pause for a Door/Hold tail (X5-P2-1), and the phone never had Pause for a `Run` tail (H8).
- **Correction to the scenario:** "Hold is refused because a job is active" is beside the point. The remote `hold` is the dead-man held jog (`machine-hold.ts:20-24`), not a feed hold, so it was never a way forward. The phone also shows the controller state "Door" with a warning tone (`MachineScreen.tsx:64`). The page is still misleading: it says "Running" and greys Pause with a false reason.
- **Why not P2:**
  - X5-P2-1 was P2 because the machine had **no** way forward short of Abort. Since #1657 the PC has one: it offers Pause, and its door text names Pause.
  - The PC is the computer the controller is connected to, normally within reach of the machine on USB. The phone is a secondary surface.
  - The beam is off throughout the door hold, and the phone's Abort keeps the interrupted-job record.
  - What is left is a missing control with a wrong reason string on the secondary surface: P3. A network controller with the PC in another room is the strongest P2 case. I am noting it for the coordinator rather than raising it, because nothing burns.
- **Repro:** the auditor's `j3.jsonl` stands. I checked the projection code by reading it and did not re-run the stress harness.

#### X7-P3-2 — CONFIRMED, P3

- **Each route, read:** `git grep` finds one caller of `browserKeepAwakeWarnings`, at `job-review-gate.ts:235`. The `startJob` callers outside that gate:
  - `external-run.ts:250`;
  - `laser-recovery-flow.ts:307`;
  - `start-job-resume-stream.ts:62` (reached from `ManualLaserRestartDialog.tsx` and `start-handoff-arming.ts`, neither of which runs `runJobReviewGate`);
  - `cnc-supervised-recovery-stream.ts:97`;
  - `transient-camera-job.ts:141`.

  The Job Review route is `start-job-transmission.ts:92`, called after the gate. The auditor's list is complete.
- **Does a missed warning lead to a stalled or killed job?** Only through W9-P2-1's mechanism (a hidden tab lets the computer sleep, which stops the stream), which is a maintainer decision and KNOWN.
  - The runtime half of #1640 is keyed on `isActiveJob`, so it covers every route: a log line and a "⚠ Keep visible" title mark while hidden, and a toast on return.
  - What is missing is only the before-Start advisory, on routes that ADR-117 Amendment 1 Decision 3 does not name. Its text: "Job Review for a Start on a connection opened in the browser build … adds an advisory warning".
  - Its Consequences line ("A browser operator learns before Start") is wider than Decision 3, and that is the drift.
- **Why not P2:** the advisory adds no new protection against the KNOWN P2. It is never a gate (ADR-565), and the same hazard is reported while it happens on every route. Doc/code drift plus a missing advisory: P3.

#### X7-P3-3 — RE-RATED to P2

- **Is it a real path that fires the beam unasked?** Yes. It is not only an overclaim in the notes.
  - On a CNC-typed machine, the Run dialog drops the two laser-mode checks it gives a laser:
    - the Run review's lit-rapid warning, which returns null unless the type is laser (`external-run-readiness.ts:62,77`);
    - the `$30`/`$32` acknowledgement, which returns `undefined` for a non-laser (`laser-mode-start-acknowledgement.ts:35`).
  - It asks only the CNC workholding attestation, "Before starting the CNC spindle, confirm…" (`external-run.ts:236-242`, `cnc-setup-attestation.ts:4`).
  - A 1.0.29-converted machine is by construction at `$32=0`: that is why 1.0.29 converted it (ADR-637 Amd 8, Context). So the type error the question exists to catch also removes exactly the warning that would name the burn.
- **Ground truth:** ADR-630 Amendment 4, Context item 2 says LightBurn-style output "runs every rapid at `S800` when `$32=0`". That was rolling D5-P2-2, rated P2 on a laser that was **not** warned.
- **REPRO** (`zz-x7r\r3-external-converted.mts` → `out\r3-*.json`):
  - **Setup:** the real 1.0.29 machine file through `loadLastMachineSelection` / `resolveProjectMachineCapability`. The Run dialog's own chain: `normalizeExternalProgram`, `inspectGcodeText`, `prepareExternalRun` with `reviewExternalProgram`, `externalControllerWarnings`, `externalLaserModeStartPrompt` and `confirmLaserModeStartEvidence`.
  - **Program:** a LightBurn-shaped file: `M4`, two 30 mm squares at `S800`, `G0` travel between them, `M5`.
  - **Same machine typed as a laser:** the controller warning "The controller reports $32=0 (laser mode off), so it keeps the beam on during rapid moves. 3 rapid commands … each burns a line where the head travels", plus a Start acknowledgement that leads with it.
  - **Converted CNC, stock as 1.0.29 left it** (`$30=1000`, spindle 12000): the question is open. No lit-rapid warning and no acknowledgement. The Run review shows:
    - "The program never moves Z, as a laser program does. KerfDesk is in CNC mode.";
    - the `$30` advisory "if this machine is a laser, it is set up as a CNC and this job fires the beam at full power, so do not start it" (`controller-readiness-messages.ts:142`).

    That advisory is a clear warning, so on this machine it is P2, not P1.
  - **Converted CNC after 1.0.29's own advice** (spindle max RPM set to 1000, or `$30` written to 12000; the X2-P1-2 machines Amd 10 was written for): the `$30` advisory is **gone**. The only hint left is "The program never moves Z, as a laser program does. KerfDesk is in CNC mode." Then the CNC attestation follows.
  - **The burn,** from the repo's GRBL power oracle (`grbl-laser-power-model.ts`): **130.7 mm of `G0` travel lit at S800** at `$32=0`, 0 mm at `$32=1`.
- **The promise is in the app too, not only the notes:**
  - The canvas card's **Not now** tooltip says "KerfDesk asks again before any job or recovery starts" (`MachineSetupBanner.tsx:126`, from Amd 10 Decision 3).
  - An owner who presses Not now and opens a `.gcode` is never asked: there is no `convertedLaser` reference anywhere in `src/ui/gcode-inspector/`.
  - The notes line (`desktop-update-notes.json:6`) and Amd 10's suggested notes line say the same.
  - Amd 10's "Still not covered" (`:79-80`) states the gap. Its reason ("streams the operator's own file … so it is not asked") overlooks that the machine type also governs the Run review's laser checks.
- **Severity: P2.** A broken safety contract with a clear failure scenario, and the same burn D5-P2-2 was rated P2 for.
  - **Not P1:**
    - The Run review names the mismatch itself before Start ("as a laser program does. KerfDesk is in CNC mode."). By METHOD §3, that is a warning about the specific mismatch, which bars P1.
    - The startup card asks at every launch until it is answered.
  - The coordinator may weigh P1 for the X2-P1-2 machines, where that Z sentence and the workholding attestation are all that is left. That is the X2-P2-1 precedent ("P1 on an X2-P1-2 machine").
- **Fix direction:**
  - Make the Run dialog honour the open question. Either refuse with the recovery's wording, as `cncRecoveryOpenProjectIssue` does, or at least show the question and the lit-rapid warning whenever `convertedLaserQuestion` is open.
  - Or reword the notes, the tooltip and Amd 10 Decision 3 to "before any job KerfDesk prepares".
  - Of the two, the code change is the better one.

### Challenges to "Verified clean"

- **"#1639's 300 ms bound may flake; host load."** Settled by measurement. The CPU profiler was not to blame: the spec stops it before the press (`wholeProgramPassSamples`).
  - My spec, `zz-x7r\mut\e2e\zz-x7r-frame-abort.e2e.ts`, is the repo's Frame case plus in-page key and long-task probes. 500,000 lines, paced GRBL at 4 blocks/s, Ctrl+. over CDP.
  - Results from the press to `0x85`/`0x18` reaching the controller:

    | Variant | Ms |
    |---|---|
    | Repo shape (profiler on, press at the first jog) | 36 |
    | No profiler, press at the first jog | 19 |
    | No profiler, press 600 ms after the first jog | 14 |
    | Repo shape again | 19 |

  - The keydown handler ran 3–8 ms after the press. The page's long tasks in the 2 s before the press were 60–134 ms each, so no task alone comes near 300 ms.
  - So the auditor's 357/382 ms was host load (other agents, 0.3 GB free), not a regression. 1.0.29 has no comparable fix: W7's refuter measured 5,874 ms there (v11 W7 report, "The jog cancel (0x85) reached the controller 5,874 ms after the press"). I did not re-run 1.0.29, because Vite would write into the read-only `zz-v2\old29`.
  - A slow CI runner can still exceed 300 ms if one long task (up to 134 ms here) lands on a loaded host. The bound has about 2× headroom over the worst single task. That is not a defect.
- **J3/J5 "Hold refused":** see X7-P3-1. The remote hold is a jog dead-man, not a feed hold.
- **"Nothing burns differently from the file" (X7-P3-3):** true for the bytes, but the warnings that would name the burn are type-gated (above).
- **The rest of Verified clean** (J1, J4, J6, CI table): not contradicted by anything I ran.

### Journeys the auditor did not run

1. **Inch display units in the speed and length boxes** (`r4-inch-speed.mts` → `out\r4.json`; `r4b.mts` → `out\r4b.txt`; main's `dimension-entry.ts`).
   - #1657 holds in inches: `50/2 mm/s` 1,500, `1/2 in/s` 762, `(50+50) mm/s` 6,000, `20 in/min` 508, a bare `20` 508, and mm/s mid-expression refused.
   - New finding X7-P3-4 below.
2. **Undo/Redo across Leave white unburned and an Array** (`zz-x7r\mut\src\zz-x7r\r5-undo-white-array.test.ts` → `out\r5.jsonl`; real store, prepare and emit).
   - Open 1.0.29's logo: 4 burning whites, lit 32,060 mm. Array 2 more copies: 6 whites, 48,091.
   - Leave white: 6 removed, 36,571. Undo: 48,091. Redo: 36,571. Undo ×2 back to the open: 4 whites and the warning again.
   - Array of a knocked-out logo, placed clear of the others: copies stay knocked out (+6,095 mm each, 48,761).
   - After Undo of Leave white, the warning and the open notice stay silent, also after Save → reopen. That matches ADR-686 Amendment 2 Decision 5 ("Undo is the choice to burn white") and the repo's own test. Not raised.
   - A trap for testers: Array copies placed exactly on earlier copies cancel in the Fill (lit fell to 24,380 in my first run). That is my placement, not a defect.
3. **Phone/MCP after a #1647 origin void** (READ). The remote Frame calls `runFrameNow({ interactiveSetup: false })` (`machine-execution.ts:156`), and `use-frame-action.ts:112` skips `offerFrameBlockerFixes` when that is false. So the remote can neither restore nor skip the voided origin, and a blocked Frame returns its refusal. Holds.
4. **grblHAL/Marlin for the tail Pause** (READ). `isControllerHold` (`LiveMotionBar.tsx:386`) reads the parsed state with its substate stripped (`status-parser.ts:298-305`), so grblHAL's `Door:n` gets #1657's Pause. Marlin reports no Door; its `done`-tail Pause rests on the pre-#1657 `Run` rule, which is unchanged. No new defect.

### New findings

#### X7-P3-4 — In the Speed box "/s" now covers the whole expression but "/min" still binds to the last term: "10+5 in/min" commits 137 mm/min (15 in/min is 381), while "10+5 in/s" commits 22,860

- **Where (43d75cabb):**
  - `src/ui/layers/dimension-entry.ts:25-31`: per-second wraps the whole body, `(${body}) unit`.
  - `:34`: per-minute only rewrites `in/min` → `in` and evaluates the text as written, where a unit binds to its own term.
- **Anchor:**
  - **Twin:** `/s` against `/min` in the same box.
  - **Contract:** ADR-480 Amendment 5, Context: "there, a unit after the expression covers all of it". That is untrue for sums: the length box reads `10+5 in` as 137 mm in mm display (`out\r4b.txt`).
  - **Lens:** L9.
- **Repro** (`out\r4b.txt`), in the **mm display:**
  - `10+5 in` (length) → 137;
  - `10+5 in/min` → **137**;
  - `(10+5) in/min` → 381;
  - `10+5 in/s` → 22,860 (= 381 × 60);
  - in the inch display, `10 + 5 mm/min` → 259 (10 in + 5 mm).
- **Severity: P3.**
  - The per-term reading is the box's own mixed-unit arithmetic (ADR-480 Decision 7) and matches the length boxes. So 137 is a defensible reading of the text, not a corruption like X5-P3-4's "1/2 mm/s" → 1.
  - The defect is the inconsistency #1657 introduced: the same expression scales by 167 between `/min` and `/s` instead of 60, and an ADR sentence says the length box does what it does not.
  - **For P2:** a 2.8× slower lit speed with no warning.
- **Fix direction:** wrap a trailing `/min` the same way as `/s`, or reword Amd 5's Context. Add `10+5 in/min` and `10+5 in/s` to `lightburn-path-u8.test.tsx`.
- **Novelty:** new. X5 tested only per-second sums.

### Not verified

- 1.0.29 Frame-Abort was not re-run (see above). The phone page itself was not rendered.
- The Run dialog's converted-CNC path was run through its modules, not clicked in the browser.
- The power-oracle result is a model of GRBL, not hardware.
- Marlin, grblHAL and FluidNC were READ only.
- A loaded CI runner's Frame-Abort distribution was not measured.
- "A project saved on main, reopened and re-run after a controller reset" is covered only by journey 3's READ and the auditor's J2.

### Repro files

All files are under `C:\Users\stolk\AppData\Local\Temp\claude\C--Users-stolk-OneDrive-Desktop-KerfDesk\34485e99-fb85-4112-957b-e0432f213833\scratchpad\zz-x7r\`. Nothing in the repo was touched except this section.

| File | What it does |
|---|---|
| `r3-external-converted.mts` → `out\r3-stock.json`, `out\r3-rpm1000.json`, `out\r3-dollar30-12000.json` | X7-P3-3: Run dialog chain on the converted CNC and the same machine as a laser, plus the GRBL power oracle |
| `r4-inch-speed.mts` → `out\r4.json`, `r4b.mts` → `out\r4b.txt` | Inch journey and X7-P3-4 |
| `mut\src\zz-x7r\r5-undo-white-array.test.ts` → `out\r5.jsonl`, `out\r5-vitest.txt` | Undo/redo across Leave white and Array |
| `mut\e2e\zz-x7r-frame-abort.e2e.ts`, `mut\playwright.zz.config.ts`, `mut\vite.zz.config.ts` → `out\e2e-frame-abort.log` | #1639 Frame-Abort, 4 variants |

- **Run the Node scripts** from `zz-x7r\` with `node --import ./register.mjs <file>` (a copy of `zz-w4`'s loader), with `NODE_OPTIONS=--no-experimental-webstorage` and `VARIANT=stock|rpm1000|dollar30-12000` for r3.
- **The mutable tree:** `mut\` is a copy of `j18-main` with `node_modules` a junction. Remove it with `cmd /c rmdir` on the junction only.
- No security issue was found, so there is no `SECURITY-DETAILS.md`.

Refuter counts: raised 1, refuted 0, P1 0, P2 1, P3 3, known 2
