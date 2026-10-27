# Rolling audit v3 — Job state

- **When:** 2026-10-27   **Tree:** origin/main @ `9a2bf6b13` (the audit worktree's source is identical)
- **Scope:** `src/ui/state/**` for connect, settings read, Frame, Start, stream, pause/resume, abort,
  link loss, recovery and restart-from-line, jog, origin and phone stop, plus the callers those
  fixes rely on (`src/ui/laser/*recovery*`, `StartFromLineControl.tsx`, `use-job-shortcuts.ts`,
  `src/ui/app/link-loss-restart-tracking.ts`, `checkpoint-interruption.ts`,
  `src/ui/gcode-inspector/external-run.ts`, `src/ui/remote-control/machine-*.ts`). 49 first-parent
  merges touched `src/ui/state` since 2026-10-21. The hotspots were read in full: #1419 (ADR-416
  Amd 2), #1346, #1366/#1397 (ADR-398 Amd 3–4), #1370 (ADR-341 Amd 10), #1305 (ADR-640),
  #1333/#1338/#1427 (ADR-648), #1328 (ADR-611 Amd 2), #1439 (ADR-585 Amd 1), #1364, #1378
  (ADR-375 Amd 3), #1381, #1392, #1413/#1427 (ADR-630 Amd 6) and #1450 (ADR-103 Amd 2).
- **Lenses run:**
  - L8 (siblings, conflicts, claims);
  - L6 (failure path);
  - L4 (interleavings: Undo during a hold, a switch before Start, reconnect, a double stop);
  - L3 (twins).
  - L1, L2, L5 and L7 were not run as separate passes. L2 was used only to check novelty
    (Ortur firmware search for D7-R1).
- **Counts:** 1 raised → 0 refuted → P1 1 / P2 0 / P3 0 (+1 KNOWN)
- **Refuter (2026-10-27, fresh context):** confirmed 1, plausible 0, refuted 0; KNOWN G2-K-1
  still present.
  - G2-P1-1 stays P1. It was reproduced end to end from the real card, through the real wizard,
    flow and `startJob`, to the hold.
  - Two scenario corrections are noted in place: starting a Laser job removes the card, and the
    drag needs a Laser-mode Z jog.
  - No severity changes.

## Headline

The job machine lock (#1419) does what ADR-416 Amendment 2 says on the ordinary Start path:
every store write goes through the guarded setter, and the guard holds there. It has one gap.
CNC recovery (pass and supervised) replays the archived CNC job with `machineKind: 'cnc'`
whatever project is open. The lock then freezes the open project's machine, not the job's. In a
recovery held at a bit change while a Laser project is open, the point move drags the bit across
the work, as in M4-P1-1:

- the move sends XY with no safe-Z lift and no Work-Z check;
- Zero Z and the probe are hidden;
- the lock refuses switching back to CNC;
- Continue asks the operator to select a bit the open project cannot hold.

The other fixes in this window, and the merge-conflict resolutions in `src/ui/state`, hold on
the sibling paths that were checked.

## Findings

### G2-P1-1 — CNC recovery streams the archived CNC job against whatever project is open; the job lock then pins the open project, and the bit-change hold moves the bit without the safe-Z lift
- **Where:**
  - `src/ui/laser/cnc-supervised-recovery-stream.ts:96-112`: `startJob(planned.gcode, { …,
    machineKind: 'cnc', …toolPlanOption(planned.recovery) })`. The stream is planned from the
    sealed artifact, "never the open canvas" (`cnc-pass-recovery-flow.ts:1-6`). Both
    `runCncPassRecoveryFlow` (`cnc-pass-recovery-flow.ts:56-82`) and
    `runCncSupervisedRecoveryFlow` (`cnc-supervised-recovery-flow.ts:103`) reach it.
  - The final assertion checks only the controller: `recovery-start-authorization.ts:10-26` and
    `cnc-pass-recovery-flow.ts:186`.
  - The card and wizard open on the capsule's kind alone: `CheckpointResumeBanner.tsx:70-71`,
    mounted in both modes at `JobControls.tsx:127`.
  - The hold reads the open project:
    - `laser-jog-actions.ts:389` reads `useStore.getState().project.machine` for the safe-Z lift;
    - `laser-jog-actions.ts:405` holds the Work-Z point-move check;
    - `ProbeControls.tsx:72` returns null unless the project is CNC;
    - `FocusJogControls.tsx:60` shows Zero Z only for CNC;
    - `laser-origin-actions.ts:159` and `laser-probe-actions.ts:70` bind Work-Z evidence to
      `selectedCncToolId(project)`;
    - `laser-store-helpers.ts:150`: Continue requires that tool id to equal `pendingToolId`
      from the archived plan.
  - The lock pins the open project: `job-machine-lock.ts:71-96`.
- **Anchor:**
  - **Contract:** ADR-416 Amendment 2, Decision 1: the setter refuses "any change whose
    project differs from the live one in the job's machine". Its Consequences, first bullet,
    say a held CNC job "keeps its mode, safe-Z lift and Work-Z check through a bit change".
    Here the live project is not the job's machine. The lock keeps the wrong machine, and the
    hold has no safe-Z lift or Work-Z check.
  - **Twin 1:** the external run re-checks the open project's machine mode at its final
    assertion, because "the Laser/CNC switch stays usable" during Start arming
    (`external-run.ts:257-266`; `externalHandoffIssue` `:194`, mode check `:201`).
  - **Twin 2:** Run again binds to the live execution signature (`RunAgainControl.tsx:52`).
  - **Twin 3:** CNC Pause and lift reads the job's own `activeJobMachineKind`
    (`cnc-pause-lift.ts:110`).
  - **Twin 4:** the fingerprint-only CNC recovery refuses unless the open project is CNC:
    "Open the original CNC project…" (`cnc-recovery-preview-model.ts:177-181`). The exact
    (sealed) path has no such check.
- **Scenario:**
  1. A two-bit CNC job is interrupted (link loss, crash, Abort).
  2. The operator then switches the toolbar to Laser, or opens or starts a Laser project. The
     card "Interrupted job saved · router" stays in the rail.
  3. They review it and start the CNC recovery. Nothing compares the open project with the
     archived machine.
  4. At the M0 bit change the stream holds (`activeJobMachineKind: 'cnc'`). The open project is
     Laser:
     - the Laser/CNC switch is locked, and the store refuses `setMachineKind('cnc')`;
     - the Z panel shows "Focus / Z" jog without Zero Z, and the Probe panel is gone.
  5. The operator jogs the new bit down to the stock. Any point move then sends
     `$J=G91 G21 X… Y…` at stock-top height. Point moves are the canvas Position-laser click,
     a saved position, or the recovery move, all through `jogToMachinePosition`. In CNC mode the
     same move first lifts to safe Z.
  6. Continue never unlocks. Its message asks to "select it as the Active bit … and Zero Z",
     which the Laser project cannot do and the lock will not allow. Only Abort ends the run.
  - **A CNC project for another machine:** the lift goes to that project's safe Z, not the
    job's, and the lock pins those values for the whole recovery.
- **Evidence:** REPRO (store level), plus READ for the wizard path.
  - **Test:** a temporary
    `src/ui/state/zz-g2-recovery-machine.test.ts` (deleted). It built on the harness of
    `laser-tool-change-jog.test.ts`. The open project was left at its default (Laser).
  - **Steps:**
    1. Connect a fake GRBL 1.1.
    2. Call `startJob(TWO_BIT_JOB, { machineKind: 'cnc', cncToolPlan: [{id:'tool-a',…},{id:'tool-b',…}], cncSetupAttestation })`.
       This is the option shape `cnc-supervised-recovery-stream.ts:96-112` passes.
    3. Acknowledge to the M0 hold, then report Idle.
    4. Call `setMachineKind('cnc')`.
    5. Record Work-Z evidence the way Zero Z does, with `selectedCncToolId(open project)`.
    6. Read `toolChangeContinueBlockMessage`, then call `jogToMachinePosition(60, 70, 1000)`.
  - **Command:**
    `node ../../../node_modules/vitest/vitest.mjs run src/ui/state/zz-g2-recovery-machine.test.ts`
    → 1 passed.
  - **Output:**
    `{"streamerStatus":"tool-change","activeJobMachineKind":"cnc","projectKindAfterSwitchAttempt":"laser","firstJogLine":"$J=G91 G21 X50.000 Y50.000 F1000\n","pendingToolId":"tool-b","continueBlock":"Work Z belongs to a different bit. Load 3.175 mm end mill, select it as the Active bit, then touch it to the stock top and Zero Z — or probe again — before continuing."}`
  - **Baseline:** the same harness with the project set to CNC sends
    `$J=G90 G21 Z3.810 F1000` first (`laser-tool-change-jog.test.ts:253-279`).
  - **READ only:** that the wizard reaches this Start with a Laser project open. That rests on
    `CheckpointResumeBanner.tsx:70`, `cnc-pass-recovery-flow.ts:56-82` (no project check) and
    `JobControls.tsx:127`.
- **Novelty:**
  - M4-P1-1, fixed by #1419, covered Undo, Redo and Open during a hold. It did not cover a
    machine that differs before the stream starts.
  - No audit in `docs/audits/` mentions CNC recovery against the open project's kind.
  - No open PR touches these files.
- **Refuter:** CONFIRMED (REPRO, end to end through the UI) — stays **P1**.
  - **What would make it false:**
    - the card or wizard is not reachable with a Laser project open;
    - a guard before the stream compares the open project with the archived machine;
    - the hold's point move still lifts;
    - a clear warning reaches the operator before the motion.
  - **The repro:** a temporary `src/ui/laser/zz-g2r-recovery-laser-open.test.tsx` (deleted; a
    copy is in the refuter's scratchpad). The setup:
    - a fake GRBL 1.1 is connected and qualified;
    - a two-bit CNC project (`em-3175`, then `em-6350`) runs on a combo device with `z-axis` and
      confirmed Z travel;
    - the run is interrupted (`saveInterruptedRun`), then the toolbar's own
      `setMachineKind('laser')` is applied.
  - **The UI steps:**
    1. `<CheckpointResumeBanner>` is rendered and **Review supervised recovery** is clicked.
    2. In the real `CncPassRecoveryWizard`, the four checks and "re-zeroed" are ticked and
       **Start pass recovery** is clicked.
    3. This runs the real `runCncPassRecoveryFlow` and the real `startJob`. The app's default
       repository is swapped for an in-memory one.
  - **Command:**
    `node ../../../node_modules/vitest/vitest.mjs run src/ui/laser/zz-g2r-recovery-laser-open.test.tsx`
    → 2 passed.
  - **Output with Laser open:**
    - `summary: "Interrupted job saved · router · 3 of 31 lines acknowledged"`
    - `dialogHasCncRecovery: true`, `startDisabled: false`, `alerts: []`
    - The three confirms were the controller warning, `START CNC PASS RECOVERY?` and the CNC setup
      attestation. None of them mentions Laser or the open project.
    - `streamerStatus: "tool-change"`, `activeJobMachineKind: "cnc"`, `pendingToolId: "em-6350"`
    - `kindAfterSwitchAttempt: "laser"`: the lock refused `setMachineKind('cnc')`.
    - `zJogShown: true`, and the Laser-mode Z jog sent `$J=G91 G21 Z-5.000 F300`.
    - With no Work-Z evidence for the new bit, `jogToMachinePosition(60, 70, 1000)` sent only
      `$J=G91 G21 X50.000 Y50.000 F1000`, with no lift and no refusal.
  - **Baseline with the CNC project open:** the same run and the same point move are refused with
    "CNC point move blocked: set or probe Work Z before moving". After Zero Z, the existing
    `laser-tool-change-jog.test.ts:253-279` shows the lift `$J=G90 G21 Z3.810` comes first.
  - **Guards checked, none of which compares the open project with the archive:**
    - `prepareArchivedRecoverySource` (`start-job-source.ts:253-314`) checks only qualification and
      `artifact.controller.kind`, and qualifies the archived project.
    - `startJob`'s CNC gates (`laser-job-actions.ts:215-250`, `cnc-live-start-readiness.ts`) check
      the controller only.
    - `finalRecoveryStartAssertion` checks the controller only.
    - The existing test `cnc-pass-recovery-flow.test.ts:85-123` opens a default (Laser) project on
      purpose and expects the CNC recovery to start. The isolation is designed in, but the hold is
      not.
  - **Warning:** none. The card says the run "is isolated from the current canvas, project,
    profile…" (`CheckpointResumeBanner.tsx:216-218`). That tells the operator the open mode does
    not matter. The twin `external-run.ts:201,257-266` does re-check the mode (verified).
  - **Scenario corrections (severity unchanged):**
    - **Starting a Laser job does not leave the card.** Any new run sets `recoveryCapsule: null`
      (`recovery-slot-mutations.ts:52`). Only switching the toolbar, or opening a Laser project
      without running it, leaves the card in place.
    - **The drag needs the bit lowered in the hold.** In Laser mode the Z jog (the pad,
      PageUp/PageDown and the phone) needs `z-axis` plus confirmed Z travel (`focusJogReady`,
      `FocusJogControls.tsx:80-86`; `machine-execution.ts:120`).
      - `DEFAULT_DEVICE_PROFILE` lacks `z-axis`. There the bit stays at park height and the
        unlifted move cannot reach the stock.
      - It is reachable on the catalog Neotronics 4040 combo (`device-profile.ts:417-447`, with
        `z-axis` and `cnc-output`) once Z travel is confirmed. It is also reachable on any profile
        marked "powered Z" (`DetectedSettingsBanner.tsx:79-96`).
    - Under §3, narrow reach cannot lower a reachable P1. The output is the M4-P1-1 drag, which
      was ruled P1, and no warning comes first.
  - **Continue never unlocks:** confirmed by reading.
    - Zero Z is hidden in Laser mode (`FocusJogControls.tsx:60`), and so is the probe
      (`ProbeControls.tsx:72`).
    - The phone's Zero Z records `selectedCncToolId(laser project) = undefined` against
      `pendingToolId: "em-6350"`, which `laser-store-helpers.ts:150` blocks.
    - This holds safe (fail-closed). Only Abort ends the run.
  - **Novelty:** no match in `docs/audits/`. The one open PR touching these files is #1456 (step
    jog queue in `laser-jog-actions.ts`), and it does not change the lift or the Work-Z check.
- **Fix direction:** two options.
  - Refuse CNC recovery, at review and again at the final assertion, unless
    `sameJobMachine(open project, archived project)` holds. Name the project to open.
  - Or make the hold's motion and Work-Z paths (the point-move lift, Zero Z, probe tool id,
    Continue) read the running job's machine snapshot instead of the open project.

## KNOWN (cited, not re-raised)

- **M3-P3-4** (`docs/audits/2026-10-23-meta-v1/M3-meta-controller-v2-v3.md:324`).
  - `link-loss-restart-tracking.ts:70-76` `bannerMayGreet` trusts `detectedControllerKind` or
    `activeControllerKind` only.
  - So a grblHAL build that greets as "Grbl 1.1f" under a stock-GRBL profile still reads a USB
    DTR greeting as a restart.
  - `grblHalEvidence` (`src/core/controllers/grblhal/grblhal-evidence.ts`, ADR-375 Amd 5)
    exists but is not consulted. At reconnect the new session has not read `$$` or `$I` yet, so
    only the run's own archived evidence could help.
  - Still present on 9a2bf6b13.
  - **Refuter:** CONFIRMED still present (READ), so it stays KNOWN P3.
    - `bannerMayGreet` (`link-loss-restart-tracking.ts:68-74`) still tests only `link`,
      `detectedControllerKind` and `activeControllerKind`.
    - `grblHalEvidence` has one non-test consumer, `console-setting-writes.ts:111`.
    - The meta v1 refuter kept M3-P3-4 at P3, and nothing here changes that.

## Refuted

Candidates the auditor dropped while checking:

- **A store write bypasses the job lock.** No non-test `useStore.setState` exists. Every action
  slice gets its setter from `store-setters.ts`, with `jobMachineGuardSetter` innermost.
  `setProject` checks first and returns `job-machine-locked`, and every caller handles it:
  - `file-actions.ts:384`;
  - `project-open-completion.ts:39,82`;
  - `project-template-actions.ts:72`;
  - `use-autosave.ts:156`;
  - `project-sheet-actions.ts:101`;
  - `production-manifest-actions.ts:136`.
- **ADR-648 keeps a stale `$$` after a hidden `$` write such as `(x)$30=255` or `/$30=…`.**
  `settingCommand` strips controller comments and leading `/`
  (`eeprom-write-line.ts:52-55`). Every `safeWrite` line is noted (`laser-safe-write.ts:122`).
  A job program is noted whole at Start (`laser-job-actions.ts:157`), which also covers hosted
  refill. #1427's `sessionSettingsReadHolds` makes the resumed `$G`-only read fall back to `$$`
  after a write.
- **A run-less Start skips ADR-341 Amd 10 decision 4.** The only run-less `startJob` callers
  all retire the older offers:
  - external run (`external-run.ts:244`);
  - camera target (`transient-camera-job.ts:169`);
  - manual restart (`start-job-resume-stream.ts`).
- **05-P2-1's sibling: another derived program pre-fills Start from line.**
  - A second pass carries `laserSecondPassChain` (`manual-restart-source.ts:56-60`).
  - Material Test and tone cards burn as project artwork.
  - Run again binds to the live signature.
  - A manual restart's own record maps lines back to the job (`untracked-run-record.ts`).
- **An X/Y origin writer runs in a tool-change hold (ADR-375 Amd 3).** Every origin transaction
  goes through `assertOriginActionReady(…, 'xy')`. That includes #1362's
  `setOriginAtMachinePoint` (via `writeXyOffset`, `laser-origin-restore.ts:165`) and the
  host-recorded reset, which runs after `resetOrigin`'s check. Only Zero Z passes `'z'`.
- **A done-tail halt is not ended on Marlin or Smoothieware.**
  - A killed Marlin needs a reset; its `start` banner takes `rebootDuringJobPatch` with the
    backlog.
  - A Smoothieware limit halt reports `Alarm` status, which `cancelActiveStreamerPatch` ends
    (`laser-alarm-stream-end.ts`). Owned resets are excluded at both entries
    (`laser-alarm-line.ts:74`, `laser-status-line.ts:342`).
- **ADR-585 Amd 1 drops the retry of a failed Cancel.** Amendment 1's Consequences record this
  as unchanged behaviour.
- **#1364 moved `useRemoteAccess` inside the workspace boundary, so a render crash detaches the
  phone.** NN#9 covers the PC software Abort, which stays mounted in `AppProtections`, and the
  crash screen has its own Abort. This is not a contract breach; it is left to G7.

## Verified clean

- **Merge conflicts in `src/ui/state` since 2026-10-21.** `git show --remerge-diff` over all 83
  merges found conflicts in four:
  - `bff122984` (`laser-origin-actions.ts` imports);
  - `0d7686cb1` (`project-actions.ts`);
  - `8f99c231a` (`store.ts` comments);
  - `b230b1cde` (laser-dot ADR renumber).
  Each kept both sides.
- **#1419 on the ordinary paths.**
  - `isActiveJob` covers streaming, paused, tool-change, the done tail and errored.
  - The errored tail is released at Idle (`laser-terminal-stream-release.ts`).
  - Pause and lift reads the job's own kind.
  - The toolbar pre-check and the store guard agree.
- **ADR-341 Amd 10 decision 3.** It applies to `ALARM:` lines (numbered and text) and to Alarm
  status reports on a `done` stream, and skips KerfDesk's own resets. A `done` stream that loses
  its link becomes `disconnected` and keeps `plannerBacklogIfRestarted` for the reconnect
  verdict (`checkpoint-interruption.ts:41-44`).
- **#1364 Ctrl+. Abort.**
  - It listens in the capture phase on `window` from `AppProtections`, outside the crash
    boundary.
  - Its precedence follows the Live Motion bar: job, then controller operation, then motion,
    then Fire or the laser dot, then unowned motion.
  - The only iframe is the transient print frame.
- **Work-origin version.** It moves on with Console XY, Z and reference effects (#1427), with
  external-program XY words, with origin transactions and with the corner probe. Place Board
  registrations cannot outlive a typed G92 or G10.
- **ADR-103 Amd 2 test touch.** It is voided while a job streams, re-armed in a hold, and only
  GRBL-family drivers advertise probing.

## Not verified

- **No hardware was operated.**
- **ADR-640 jog-cancel timing** (`laser-motion-cancel.ts`, `laser-motion-release.ts`) was read
  only. Its grace windows and missing-reply release were not simulated.
- **The Falcon laser dot's auto-off (ADR-664)** was read only. The 2026-10-23 last-100 PR audit
  and #1424 already cover it.
- **Remote-control hold and abort receipts beyond #1439's diff** are G7's.
- **Multi-window and IndexedDB races, and CNC pause-lift re-entry (ADR-411)**, were not run.
- **The tests added by the 2026-10-26 merges** (#1440, #1441, #1446, #1450) were not re-run. The
  PC load allowed one focused file at a time.
- **G2-P1-1's wizard path** was not driven end to end by the auditor: its repro starts at
  `startJob` with the recovery's option shape. The refuter then drove it end to end, from the
  card through the wizard to the hold (see G2-P1-1).
  - The supervised "Advanced: mid-pass runway" path was read only. It reaches the same
    `streamCncRecoveryProgram` through `prepareArchivedRecoverySource` for exact capsules
    (`cnc-supervised-recovery-flow.ts:277-279`).
  - The refuter's fake GRBL did not settle a Z jog's `G4 P0.01` marker inside the hold. The point
    move was therefore run before any Z jog, and the Laser-mode Z jog was checked on its own.

```json
[
  {"id":"G2-P1-1","severity":"P1","area":"job-state","file":"src/ui/laser/cnc-supervised-recovery-stream.ts","line":107,"anchor":"Contract: ADR-416 Amendment 2 Decision 1 and Consequences bullet 1; Twin: external-run.ts:257-266 final machine-mode check, RunAgainControl.tsx:52 signature binding, cnc-pause-lift.ts:110 activeJobMachineKind, cnc-recovery-preview-model.ts:177-181 legacy path requires a CNC open project","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"CNC recovery replays the archived CNC job with machineKind 'cnc' whatever project is open; with a Laser project open the job lock pins Laser, the bit-change hold's point move sends XY with no safe-Z lift or Work-Z check, Zero Z/probe are hidden and Continue can never unlock"},
  {"id":"G2-K-1","severity":"P3","area":"job-state","file":"src/ui/app/link-loss-restart-tracking.ts","line":70,"anchor":"Twin: grblhal-evidence.ts (ADR-375 Amd 5) not consulted by bannerMayGreet","evidence":"READ","verdict":"CONFIRMED","known":"docs/audits/2026-10-23-meta-v1/M3-meta-controller-v2-v3.md M3-P3-4","summary":"A 'Grbl 1.1f' grblHAL build under a stock-GRBL profile still reads its USB DTR greeting as a restart and steps back over burned moves"}
]
```
