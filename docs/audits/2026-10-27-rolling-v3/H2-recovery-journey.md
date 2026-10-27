# Rolling audit v4 — Recovery journey

- **When:** 2026-10-27   **Tree:** origin/main @ `9a2bf6b13` (the audit worktree's `src` was identical).
  Re-checked on the branch after it merged main `a59f74ff9`: `git diff 9a2bf6b13 HEAD` is empty for
  every file cited below, and all three repros were re-run on that tree with the same output.
- **Scope:** every way back into an interrupted laser or CNC job, and how each one records the stop.
  - **Records:** `src/ui/app/checkpoint-interruption.ts`, `job-checkpoint-repository.ts`,
    `use-job-checkpoint.ts`, `link-loss-restart-tracking.ts`, `desktop-close-runtime.ts`;
    `src/ui/state/laser-stream-heartbeat-containment.ts`, `laser-stream-hold.ts`,
    `recovery/recovery-slot-mutations.ts`.
  - **Restart line and program:** `src/core/recovery/*` (`automatic-restart-line.ts`,
    `planner-backlog-restart.ts`, `link-loss-restart.ts`, the CNC pass, supervised and pause
    re-entry builders); `src/core/controllers/grbl/resume-program.ts`,
    `laser-resume-reentry.ts`, `native-laser-resume*.ts`.
  - **Entry points:** the recovery card (`CheckpointResumeBanner.tsx`,
    `LaserRecoveryReviewDialog.tsx`, `LaserRecoveryPlacement.tsx`, `laser-recovery-flow.ts`,
    `CncPassRecoveryWizard`, `cnc-pass-recovery-flow.ts`, `cnc-supervised-recovery-*.ts`), Start
    from line and Choose restart point (`StartFromLineControl.tsx`, `manual-restart-source.ts`,
    `start-job-flow.ts:306`, `start-job-resume-stream.ts`, `start-job-source.ts`), Run again,
    second pass, CNC Pause and lift, phone and MCP pause/resume (`machine-actions.ts:197`), and
    the crash screen (`ErrorBoundary.tsx`, `crash-recovery.tsx`).
  - **Governing:** ADR-398 (Decision 2, Amendments 3 and 4), ADR-341 Amendments 3, 5, 6 and 8,
    ADR-411, ADR-416 Amendment 2, ADR-443, ADR-548, ADR-546 Amendment 2.
- **Lenses run:**
  - L9 entry-point parity (main lens);
  - L3 twins;
  - L6 failure path;
  - L4 interleavings (stall, app close, app restart, reconnect).
  - L1 was used only for the ADR clauses cited. L2 was not run as a separate pass: no firmware
    claim here goes beyond what the cited ADRs already source. L5 and L7 were not run.
  - The resume transform itself was checked by running its independent burn oracle
    (`resume-program.emitter-oracle.test.ts`, 9/9 pass), not re-derived.
- **Counts:** 5 raised → 0 refuted → P1 1 / P2 2 / P3 2 (+3 KNOWN). One sub-scenario of H2-P2-1
  was refuted and narrowed; see Refuted.
- **Refuter (2026-10-27, fresh context, on `a59f74ff9`):** confirmed 4, plausible 1, refuted 0;
  KNOWN 3, all still present. No severity changes.
  - **H2-P1-1 stays P1.** Reproduced with the real Start compile and the real restart stream,
    measured by an independent G-code reader. No dialog names the registration.
  - **H2-P2-1 and H2-P2-2 stay P2.** Reproduced. The Review names the restart line, shows the
    route and acknowledged progress, and tells the operator to inspect the work and choose an
    earlier movement. That is a prompted check, unlike Frame. Meta audit v1 M2 also ruled
    "Severity OK" at P2 for the same skip in 05-P2-2 and 18-P2-1.
  - **H2-P2-1 narrowed:** the responsive acknowledgement stall cannot skip moves. Only heartbeat
    loss and the write-failure quarantine reset do.
  - **Novelty:** no earlier audit and no open PR (#1461–#1464) covers any of the five.

## Headline

The sealed recovery card is the best-guarded way back into a job. The manual Start from line,
however, rebuilds the program without the Print-and-Cut registration that ordinary Start applies:

- with a valid registration, the restart burns at the unregistered design position (5.8 mm off in
  the repro);
- with no valid registration, it runs where Start refuses;
- no confirmation says so (P1).

Three stops that throw the controller's planner away record no planner backlog, unlike Abort's
identical reset, so their automatic restart skips up to a planner of acknowledged moves (P2):

- a heartbeat-loss stall or write failure, which KerfDesk contains with its own soft reset (the
  refuter found that a responsive acknowledgement stall cannot skip moves);
- KerfDesk closing mid-job, including the ADR-548 forced Windows restart;
- KerfDesk restarting after a crash or power loss.

The CNC side's open-project gap (G2-P1-1) is KNOWN, and open PR #1462 fixes it for the running
job. The laser Review's pre-start moves still read the open project (P3).

## Entry-point parity (L9)

| Guard | Card, exact | Card, fingerprint | Start from line / Choose point | Run again | CNC pass / supervised | Pause and lift |
|---|---|---|---|---|---|---|
| Fresh qualification, controller kind | yes (`start-job-source.ts:257-263`) | yes | qualification only | as Start | yes | n/a (live job) |
| Program | sealed bytes, lineage re-emitted (`recovery-artifact-binding.ts`) | current compile, fingerprint must match | current compile, **no Print-and-Cut registration** (H2-P1-1) | live signature | sealed job, ordinary emitter | streamed lines |
| Machine/project match | archived project | open project + fingerprint | open project | live | **none** (G2-P1-1, KNOWN; #1462 open) | job's |
| Origin evidence | Origin then/now, Restore, Continue | refusal names saved origin | refusal only when the origin is gone | Frame required | re-zero attestation | G92 restored after reset |
| Planner step-back | from the record (H2-P2-1, H2-P2-2) | same | pre-fills the card's line | n/a | firmware max reserve | planner window match |
| Modal re-assertion | units, G90, WCS, G94, plane, M5, air, G0 S0, M3/M4 S0, F | same | same | n/a | ordinary preamble (safe Z, spin-up dwell, plunge feed) | `G21 G90 G54 G94 G17`, lift, spin-up, plunge |
| Frame | offered, not required | offered | not required | required | wizard | n/a |
| Review moves read | **open project** (H2-P3-2) | same | n/a | n/a | job (after #1462) | job |

Phone and MCP have no recovery entry: `resume_job` resumes a paused job through the same store
action as the desktop (`runConfirmedResumeJob`), and `start_job` is the ordinary framed Start,
which retires older recovery offers.

## Findings

### H2-P1-1 — Start from line and Choose restart point rebuild a Print-and-Cut job without its registration, and run it where Start refuses
- **Where:**
  - `src/ui/laser/start-job-source.ts:331-368`. `prepareRecoveryProjectSource` compiles with
    `prepareStartJob` (`:360`), which takes no registration. Its off-thread branch passes
    `registration: undefined` (`:355`), with the comment "Re-evaluating variables/registration
    would alter checkpoint bytes" (`:356`).
  - `src/ui/laser/manual-restart-source.ts:66-94`: no earlier run's fingerprint matches an
    unregistered compile, so it falls back to that compile with "the current job placement
    settings".
  - Reached from `start-job-flow.ts:306-326` (`runStartFromLineFlow`) and from
    `StartFromLineControl.tsx:37` (Choose restart point).
  - The twin is ordinary Start, `prepareCurrentStartJob` (`start-job-source.ts:84-108`). It reads
    `currentPrintCutOutputRegistration` (`print-cut-output.ts:15-29`) and compiles through the
    snapshot path, which:
    - applies the transform (`prepare-output-snapshot.ts:103-105`);
    - refuses a `null` registration (`:82-84`, "Print-and-Cut registration is not valid").
- **Anchor:**
  - **Twin:** Start versus the manual restart on the same project, controller and placement.
    Run again binds the registration into its execution signature
    (`RunAgainControl.tsx:41-52`).
  - **Contract:** ADR-443, Context: the two-point solve "moves, turns and scales the output". The
    manual restart's own guidance says it "uses that run's job placement"
    (`StartFromLineControl.tsx:176-179`).
  - **METHOD §3:** the restart is not Framed (`requireFrame: false`), and Frame would not count as
    a warning anyway.
- **Scenario:**
  1. Labs Print and Cut is on. The printed sheet sits 5 mm right of and 3 mm away from the design.
     Both marks are captured, and the job uses Absolute placement.
  2. Start burns registered. The job is interrupted (Abort, alarm or link loss).
  3. The operator uses Start from line, or Choose restart point.
  4. The rest of the job burns at the design position, 5.83 mm from the cut already made and from
    the print.
  5. Neither confirmation names the registration. They say "Line numbers count this project's full
     program as it compiles now" and "Placement: the current job placement settings".
  - **Labs off:** with Labs off, or after the captures went stale (epoch or frame change), Start
    refuses. The manual restart runs the unregistered program anyway.
  - **No escape through the card:** the sealed card replays the registered bytes. The
    fingerprint-only card refuses the mismatch. Only the manual path is open.
- **Evidence:** REPRO.
  - **Test:** a temporary `src/ui/laser/zz-h2-printcut-restart.test.ts` (deleted; a copy is in the
    auditor's scratchpad).
    - The setup is a fake GRBL 1.1 that is connected and qualified. A 20 × 20 mm rectangle sits at
      (40, 40), with `printAndCutTargets` (0,0)/(100,0) and session captures (5,3)/(105,3).
    - The test compares Start's snapshot compile (`prepareStartJobSnapshot` with
      `currentPrintCutOutputRegistration`) with `prepareManualRestartSource()`.
    - It then runs the real `runStartFromLineFlow(4)`, with every confirmation accepted.
  - **Command:**
    `node ../../../node_modules/vitest/vitest.mjs run src/ui/laser/zz-h2-printcut-restart.test.ts`
    → 1 passed.
  - **Output** (on `9a2bf6b13`, and again on the `a59f74ff9` merge):
    - `registration: {scale 1, rotation 0, translation (5,3)}`
    - Start: `G0 X45.000 Y357.000 S0`, `G1 X65.000 Y357.000 F1500 S300`
    - Manual restart: `G0 X40.000 Y360.000 S0`, `G1 X60.000 Y360.000 F1500 S300`
    - `runStartFromLineFlow`: `streamerStatus: "streaming"`, first streamed moves
      `G0 X40.000 Y360.000 S0`, `G1 X60.000 Y360.000 F1500 S300`, and `alerts: []`.
    - Labs off: Start returned "Print-and-Cut registration is not valid. Capture both machine
      points again."; the manual restart compiled `G0 X40.000 Y360.000 S0`.
- **Novelty:**
  - No audit in `docs/audits/` covers Print-and-Cut with Start from line, restart or recovery.
  - No open PR touches these files.
- **Refuter:** CONFIRMED (REPRO, with an independent output check). It stays **P1**.
  - **What would make it false:**
    - the manual restart applies the registration somewhere downstream;
    - Start from line is refused or hidden for a project with `printAndCutTargets`;
    - a confirmation or Job Review warning names the dropped registration;
    - the registration is identity in practice, so the burn does not move.
  - **The repro:** a temporary `src/ui/laser/zz-h2r-printcut.test.ts` (deleted). It differs from
    the auditor's in four ways:
    - Start is compiled through the real `prepareCurrentStartJob`, with the off-thread compile
      routed in-thread through the worker's own `prepareOutputRequest`.
    - The interrupted run is sealed in a real `RecoveryRepository` capsule from that registered
      compile.
    - The restart is run through `streamResumeFromRawLine` with the same arguments that
      `runStartFromLineFlow` and `ManualLaserRestartDialog` pass. Every dialog is captured, and
      `laser.startJob` records the streamed program and calls its final authorization.
    - The geometry is measured by the refuter's own G-code reader, which takes the burn box of
      `G1` moves with M3/M4 on and `S > 0`.
  - **Output (the 20 × 20 mm square at (40, 40), captures (5, 3)/(105, 3)):**
    - Start burns X 45–65, Y 337–357.
    - The streamed restart burns X 40–60, Y 340–360. It is 5.831 mm off, and its final
      authorization passed.
    - Start and the restart carry the same three generic warnings (bed mapping, controller
      identity, default settings). Neither has a Print-and-Cut warning. The restart's two dialogs
      (the warning acknowledgement and "Review resume from requested line") never name the
      registration.
    - With the sealed capsule present, the confirmation adds: "This project no longer reproduces
      the saved interrupted job's program, so that job's line numbers may point elsewhere here"
      (`manual-restart-source.ts:181`). It speaks of line numbers, not position. It is not a
      warning of the offset.
  - **Stale captures:** `trustedPositionEpoch` was bumped by one, as an alarm, reset, reconnect
    or home does (`laser-alarm-line.ts:70`, `laser-disconnected-state.ts:43`,
    `laser-home-action.ts:353`).
    - Start then refused: "Print-and-Cut registration is not valid. Capture both machine points
      again."
    - The real `runStartFromLineFlow(2)` still streamed the unregistered burn box X 40–60,
      Y 340–360.
    - So the usual state right after an interruption is the refused one. Recapturing does not
      help the manual path, as the registered case shows.
  - **The Labs-off gate:** `currentPrintCutOutputRegistration` returns `null`, and so refuses,
    for a project with targets when Labs is off (`print-cut-output.ts:20`).
    - ADR-443 adds "No new Start policy gate" (Decision, closing paragraph).
    - ADR-443 Amendment 1 item 4 keeps a refusal only where "no transform exists". A missing or
      stale capture is that factual case, not a policy gate.
    - So the refusal is the code's own contract, and the manual path bypasses it. The Labs
      toggle is a minor variant; the stale-capture path is the main one.
  - **Severity, under METHOD §3 and the G6 clarification:** the output position is wrong and
    nothing names the mismatch. The restart is not framed, and Frame is not a warning anyway.
    The operator would have to notice it unprompted.
  - **Novelty:** the only audit mention of Print-and-Cut with restart is this report. Open PRs
    #1461–#1464 do not touch these files.
- **Fix direction:**
  - Compile the manual restart (and the fingerprint-only card source) with the same registration
    input as Start: refuse a `null` registration, and apply a valid one.
  - Alternatively, refuse manual restart for a project with `printAndCutTargets` and point to the
    card's sealed replay.
  - Check the variable-text sibling in the same change (see Not verified).

### H2-P2-1 — A stream stall or write failure is contained with a planner-discarding stop, but recorded as if the controller kept running, so the automatic restart skips the discarded moves
- **Where:**
  - `src/ui/app/checkpoint-interruption.ts:67-76`. `PLANNER_DISCARDING_KINDS` is `cancelled`,
    `controller-error` and `controller-reboot`. The comment at `:68` says "A failed write or a stall
    leaves the controller running what it had", so `stream-stalled` and `write-failed` drop the
    backlog (`:45-49`).
  - The containments send that stop themselves:
    - `src/ui/state/laser-stream-heartbeat-containment.ts:103-134`: heartbeat loss → 0x18 through
      `quarantineStreamFault` → `runGrblDisconnectTransaction`;
    - `:53-80`: acknowledgement stall → 0x18 on GRBL-family controllers (`retainConnection: true`),
      or Marlin's `M410` quick stop (`requestQueuedStallStop`, `laser-quick-stop.ts:30-35`).
      *(Refuter: this one fires only on a report other than `Run`, with an empty GRBL planner, so
      it skips nothing; see Refuted.)*
    - `:139-172`: active-job write failure → the same quarantine reset.
  - The notice itself says "KerfDesk froze the stream and requested a controller soft reset"
    (`laser-safety-notice.ts:129-136`).
  - With no backlog, `automaticRestart` keeps the first unacknowledged line
    (`automatic-restart-line.ts:87-102`).
- **Anchor:**
  - **Contract:** ADR-398 Decision 2: a planner-discarding stop "records the controller's whole
    planner at the stop". ADR-398 Consequences: a restart "after an Abort or stream error may repeat
    up to a planner's worth" of moves.
  - **Twin 1:** Abort sends the same 0x18 and records the backlog.
  - **Twin 2:** a lost link keeps the backlog aside for the reconnect's verdict, and names the
    earlier line when the verdict is unknown (`link-loss-restart.ts:93-107`). A stall gets neither.
- **Scenario:**
  1. A GRBL-family job streams with the planner full: GRBL 15 blocks, grblHAL 100, Falcon 512.
  2. Status and acknowledgements stop for the heartbeat window (2 s), for example from a USB hub
     glitch or a Wi-Fi stall. Alternatively, a job write is rejected. *(Refuter: "or a responsive
     controller stops acknowledging (90 s in Run)" is refuted. That containment never fires while
     `Run` reports keep coming.)*
  3. KerfDesk sends 0x18 (Marlin: `M410`). Where it arrives, it discards the queued blocks.
  4. The run is saved as `stream-stalled` or `write-failed` with no `plannerBacklog`.
  5. The card's automatic restart, and Start from line's pre-filled line, start after the last
     acknowledged line. Every acknowledged move still in the planner is skipped.
  6. The hint is only the generic "can be ahead of the physical cut", with no line named. A lost
     link gets a named "restart from line N" hint, and Abort a step back.
- **Evidence:** REPRO.
  - **Test:** a temporary `src/ui/state/zz-h2-stall-backlog.test.ts` (deleted).
    - Real store, fake GRBL 1.1 (idle `Bf:15,128`).
    - The job is 60 `G1` lines. 40 are acknowledged, then `<Run|…|Bf:5,100|…>` reports 10 blocks
      queued.
    - Case 1 then goes silent; case 2 presses Abort instead.
    - The recorded interruption comes from the tracker's own `observedStreamInterruption`, and is
      passed through `automaticRestart`.
  - **Command:**
    `node ../../../node_modules/vitest/vitest.mjs run src/ui/state/zz-h2-stall-backlog.test.ts`
    → 2 passed.
  - **Output:**
    - **Stall:**
      - `snapshot {ackedLines 40, queuedBlocks 10}`, `resetWritten: true`
      - `interruption {kind "stream-stalled", positionLost true}` (no backlog)
      - `restart.line 41` (`G1 X38`)
    - **Abort:**
      - `resetWritten: true`
      - `interruption {kind "cancelled", plannerBacklog {40, 10}}`
      - `restart.line 31` (`G1 X28`), `basis "status-backlog"`
    - Ten moves the stall's reset threw away are not replayed.
- **Novelty:**
  - Controller v3 D7 and ADR-398 Amendment 4 note only that a 2 s silence "ends as
    `stream-stalled`, which awaits no verdict". They used that to narrow D7-P2-1, and raised
    nothing about the restart line.
  - No open PR touches these files.
- **Severity note:** P2, as for the same skip after a lost link (18-P2-1, D7-P2-1): an
  operator-confirmed Review with a generic "can be ahead of the physical cut" hint.
- **Refuter:** CONFIRMED (REPRO) for heartbeat loss, and by the same code for the write-failure
  quarantine reset. **Narrowed:** the responsive acknowledgement stall is refuted, see Refuted. It
  stays **P2**.
  - **What would make it false:**
    - the containment's 0x18 is not planner-discarding;
    - the stall record carries a backlog some other way;
    - the restart steps back anyway;
    - ADR-398 or ADR-341 exclude stalls by design;
    - the stall cannot happen with a non-empty planner.
  - **The repro:** a temporary `src/ui/state/zz-h2r-stall.test.ts` (deleted). It uses the real
    store and a fake GRBL 1.1 with an idle `Bf:15,128`.
    - The job is 64 sendable lines. 43 are acknowledged, then `<Run|…|Bf:5,100|…>` reports 10
      blocks queued.
    - Each scenario's record comes from `observedStreamInterruption` and is passed through
      `automaticRestart`.
  - **Output:**

    | Scenario | 0x18 written | Record | Restart |
    |---|---|---|---|
    | Heartbeat loss (status and acks silent 2 s) | yes | `stream-stalled`, `positionLost`, no backlog | line 44 (`G1 X40`) |
    | Abort at the same state | yes | `cancelled`, `plannerBacklog {43, 10}` | line 34 (`G1 X30`), `status-backlog` |
    | No acks, controller still reporting `Run`, 95 s | **no** | none, still streaming | — |
    | No acks, controller reporting `Idle` (`Bf:15`) | yes | `stream-stalled`, no backlog | line 44, correct: snapshot `queuedBlocks 0` |

  - **The ack-stall narrowing:** the stall probe restarts its clock on every new `Run` report
    (`freshRunStatus`, `laser-stream-stall.ts:91-98`).
    - So `containStalledStreamAcknowledgements` (`laser-stream-hold.ts:48`,
      `laser-connection-actions.ts:433-434`) fires only on a report that is not `Run`, `Hold` or
      `Door`.
    - On GRBL, `Idle` means an empty planner, so its reset discards no acknowledged move.
    - The scenario's "a responsive controller stops acknowledging (90 s in Run)" does not
      contain at all.
    - Marlin's no-reset `M410` path was not run. It needs 90 s with no acknowledgement and no
      busy keepalive, by which time a stock 15-block planner has normally drained.
  - **What stays:** the heartbeat and write-failure paths send 0x18 through
    `quarantineStreamFault`, whose own notice says the reset was "requested … while the link was
    still present". They also record `streamReset`, and so `positionLost: true`, but no backlog.
    - Whether the byte arrives is uncertain. That is the lost-link case, where ADR-398
      Amendment 4 Consequences keep the backlog unconfirmed and "the hint names the line that
      replays it".
    - The stall gets neither the step back nor the named line.
    - ADR-341 Amendment 10, Context, calls this "the rule that recovery recuts and never skips".
    - ADR-398 Amendment 4 Context notes only that a 2 s silence "awaits no verdict". It decides
      nothing that excludes stalls.
  - **Severity: P2, not P1.**
    - The restart is not silent. The card's Review shows the restart line in a route preview
      with the acknowledged progress (`LaserRecoveryRestartPicker.tsx:44,136`).
    - It says "Automatic restarts at line N, from acknowledged command progress, which can be
      ahead of the physical cut. Inspect the work and choose an earlier movement if needed"
      (`laser-recovery-automatic-restart.ts:32`).
    - Start from line's confirmation says the same (`resume-confirmation.ts:21`).
    - That names the specific risk and prompts an inspection before output. That is unlike Frame
      under the G6 clarification.
    - Meta audit v1 M2 re-checked the identical skip in 05-P2-2 and 18-P2-1 under the no-reach
      §3 rule and recorded "Severity OK" at P2 (`M2-meta-rolling-v2-p2.md:445,458`).
  - **Novelty:** controller v3 D7 and ADR-398 Amendment 4 mention `stream-stalled` only as
    awaiting no verdict. No open PR touches these files.
- **Fix direction:**
  - Record the backlog whenever the containment sends a planner-discarding stop.
  - Where arrival is uncertain (heartbeat loss), at least keep it as `unconfirmedPlannerBacklog`,
    so the hint names the line, as a lost link's does.

### H2-P2-2 — Closing or restarting KerfDesk mid-job records no planner backlog and no earlier-line hint, so the automatic restart skips what a reset or power loss threw away
- **Where:**
  - **App close:** `checkpoint-interruption.ts:45-49`. `stopMayNotHaveArrived` drops the backlog
    for `app-closing`. On desktop, the close handoff awaits that stop
    (`desktop-close-runtime.ts:66-78`, `await laser.stopJob('app-closing')`). ADR-548 Decision 3
    sends the same Abort when Windows ends the session: "Recovery records it as the app closing."
  - **App restart:** `recovery/recovery-slot-mutations.ts:348-391`. `promoteStaleActiveRunMutation`
    turns a run left active by a crash, reload or power loss into `kind: 'unknown'`, "The
    application restarted while this job was active". It has no backlog and no verdict, and it
    keeps the last persisted ack count, which is written only every 25 acknowledgements
    (`job-checkpoint-storage.ts:18`, `use-job-checkpoint.ts:209`).
  - `link-loss-restart-tracking.ts` settles only `disconnect` records, so the first reconnect
    after the restart cannot change it.
- **Anchor:**
  - **Contract:** ADR-398 Decision 2, as in H2-P2-1. It prefers re-burning to "skipping moves that
    never ran".
  - **Twin:** a lost link with the same uncertainty keeps the backlog for the reconnect, and names
    the earlier line when that stays unknown (ADR-398 Amendments 3-4).
- **Scenario:**
  - **(a) Forced close.** A grblHAL or Falcon job runs. Windows forces an update restart (ADR-548
    Decision 3), or the operator quits and confirms. KerfDesk sends Abort, and on desktop awaits
    its write, so the planner (100 or 512 blocks) is discarded. The record is `cancelled`
    (app-closing) with no backlog, and recovery restarts after the last acknowledged line.
  - **(b) Crash with an Arduino-class GRBL board.** The renderer crashes mid-job. On reload,
    auto-connect asserts DTR and resets the board before its planner drains. Alternatively, a PC
    power loss takes a USB-powered board with it.
    - The promoted record starts after the last persisted count.
    - That count lags by 0-24 lines, while GRBL's planner holds 15. Whenever the lag is under 15,
      moves are skipped. For a 32- to 512-block planner, moves are skipped every time.
- **Evidence:** REPRO.
  - **Test:** a temporary `src/ui/app/zz-h2-app-restart-backlog.test.ts` (deleted). It calls the
    real `promoteStaleActiveRunMutation`, `checkpointInterruption`, `settleLinkLossRestart` and
    `automaticRestart` on a 204-line program.
    - Real acks: 120. Persisted progress: 100.
    - Backlog: `{120, 100, planner-size}`, grblHAL's default.
  - **Command:**
    `node ../../../node_modules/vitest/vitest.mjs run src/ui/app/zz-h2-app-restart-backlog.test.ts`
    → 1 passed.
  - **Output:**

    | Record | Restart line | Backlog or hint |
    |---|---|---|
    | App restart (`unknown`, acked 100) | 101 | none |
    | App closing (`cancelled`) | 121 | none |
    | Abort | 21 | `plannerBacklogBlocks 100` |
    | Lost link, banner verdict | 21 | backlog applied |
    | Lost link, unknown verdict | 121 | `ifRestarted.line 21` |

- **Novelty:**
  - Rolling v2 27 covers the unload stop path only. No audit covers the restart line after an app
    close or restart.
  - `docs/audits/2026-09-24-post-frame-start-block-audit.md:127` mentions the promotion only.
- **Severity note:** P2 on the same basis as H2-P2-1.
- **Refuter:** CONFIRMED (REPRO) for both (a) and (b). (b) is narrowed: it skips only when the
  planner is discarded before it drains. It stays **P2**.
  - **What would make it false:**
    - the desktop stop is not awaited, so the "may not have arrived" doubt is real;
    - a later reconnect settles the record;
    - ADR-548 or ADR-398 decide that app-closing drops the backlog;
    - the promoted record carries a backlog or a hint;
    - a crash never discards the planner.
  - **(a) App closing:** in the same `zz-h2r-stall.test.ts` harness (43 acknowledged, 10 blocks
    queued), `stopJob('app-closing')` was called, as `stopBeforeClose` does
    (`desktop-close-runtime.ts:66-78`).
    - It wrote 0x18 and was awaited.
    - The record was `cancelled` with `positionLost` and no backlog, so the restart was line 44.
      Abort at the same state restarted at line 34.
    - The record's cause, shown in the Review as "Recorded cause"
      (`CheckpointResumeBanner.tsx:226`), says "The stop may not have arrived before the page
      closed" (`job-stop-request.ts:76`). That is a web-unload rationale. On desktop the write
      was awaited.
    - ADR-548 Amendment 1 confirms the doubt only for a forced session end, where Windows can kill
      the process before the Abort leaves. ADR-548 Decision 3 says nothing about the backlog.
    - The lost-link twin keeps an unconfirmed backlog and names the line. This keeps neither.
  - **(b) App restart:** a temporary `src/ui/laser/zz-h2r-restart.test.ts` (deleted) does a real
    persistence round trip.
    - One `RecoveryRepository` stages and activates a 204-line run, then persists progress 100.
      The real tracker writes every 25 acknowledgements (`job-checkpoint-storage.ts:18`,
      `use-job-checkpoint.ts:209`).
    - A second repository over the same backend runs `initialize()`. Jsdom has no Web Locks, so
      the run counts as abandoned.
    - The capsule is `unknown`, "The application restarted while this job was active", acked
      100, with no backlog. `automaticRecoveryRestart` gives line 101 with the generic hint.
    - At 120 real acknowledgements with grblHAL's 100-block bound, Abort's record would give
      line 21.
  - **Narrowing for (b):** a renderer crash closes the port but does not reset the board on
    close.
    - A board that keeps power runs out its planner and receive buffer, so the restart re-burns
      the 0–24-line lag instead of skipping.
    - Moves are skipped only when the planner is discarded before it drains: PC power loss with
      a USB-powered board, or a DTR reset at an auto-connect that comes before the drain.
    - So "for a 32- to 512-block planner, moves are skipped every time" holds only for those
      cases.
  - **Severity: P2, not P1.** The same Review applies as for H2-P2-1: the restart line, the
    route with acknowledged progress, and "can be ahead of the physical cut. Inspect the work and
    choose an earlier movement if needed". Its "Recorded cause" also says the app closed or
    restarted. This matches meta audit M2's "Severity OK" for 05-P2-2 and 18-P2-1.
  - **Novelty:** confirmed. Rolling v2 27 covers only the unload stop path, and
    `2026-09-24-post-frame-start-block-audit.md:127` only the promotion. No open PR touches
    `checkpoint-interruption.ts` or `recovery-slot-mutations.ts`.
- **Fix direction:**
  - Keep the backlog on `app-closing` records. The desktop handoff awaits the stop, so the
    "may not have arrived" doubt is a web-unload case; at least store it as
    `unconfirmedPlannerBacklog`.
  - Persist the last backlog snapshot with run progress, so a promoted stale run carries it the
    same way.

### H2-P3-1 — A render error in a crash-screen host blanks the window: both boundaries re-render the same hosts in their fallback (G7 refuter lead)
- **Where:**
  - `src/ui/common/ErrorBoundary.tsx:82-96,129`: the fallback renders `{props.hosts}`.
  - `src/ui/app/crash-recovery.tsx:52-60`: the hosts are `DesktopCloseNotice`, `ProjectSaveDialog`
    and `Toasts`.
  - The workspace also mounts `DesktopCloseNotice` and `Toasts` (`App.tsx:96,124`).
  - The root boundary (`main.tsx:102-123`) renders the same hosts and has nothing above it.
  - The Ctrl+. listener lives in `AppProtections` (`App.tsx:87,182`), inside the root.
- **Anchor:**
  - **Contract:** PROJECT.md non-negotiable 9 and ADR-546 Amendment 2 (crash Abort).
  - **Twin:** the workspace boundary was split out so that protections survive a workspace crash.
- **Scenario:**
  1. A state-driven render bug in `Toasts` crashes the workspace.
  2. The workspace fallback renders `Toasts` again, which throws.
  3. The root fallback renders it a third time.
  4. React unmounts the root: a blank window, with no ABORT and no Ctrl+. listener.
- **Evidence:** READ.
  - Checked and ruled out:
    - none of the three hosts depends on a provider missing above the root boundary (no
      `usePlatform`);
    - their inputs are typed store values;
    - so no reachable throw was found.
  - The finding is therefore latent.
- **Refuter:** CONFIRMED (REPRO of the mechanism). It stays **P3** (latent).
  - **What would make it false:** the hosts have their own boundary, or a throwing fallback
    host stays contained inside its boundary.
  - **Structure:** both boundaries pass `crashHosts={<CrashScreenHosts />}`
    (`App.tsx:79-85`, `src/ui/app/main.tsx:102-106`). `CrashScreen` renders them first
    (`ErrorBoundary.tsx:129`). The workspace also mounts `DesktopCloseNotice` and `Toasts`.
  - **The repro:** a temporary `src/ui/common/zz-h2r-boundary.test.tsx` (deleted) rendered two
    nested `ErrorBoundary`s whose `crashHosts` throw, with a sibling standing in for
    `AppProtections`.
    - The container ended empty (`""`), and the error escaped the root.
    - The control, with hosts that render, kept the sibling and the crash screen.
  - No reachable host throw was searched for beyond the auditor's check, so it stays latent.
- **Fix direction:** render a minimal, dependency-free Abort-and-Save fallback at the root, without
  the shared hosts, or wrap the hosts in their own boundary.

### H2-P3-2 — The laser Review's Home button and Go to job origin / restart point read the open project, not the sealed job's
- **Where:**
  - `src/ui/laser/CheckpointResumeBanner.tsx:134,151`: `homingEnabled` comes from
    `useStore … project.device.homing`.
  - `laser-recovery-move.ts:26-31`: the jog feed comes from the open device, through
    `jogToMachinePosition`.
  - The point-move check and lift use the open project (`laser-jog-actions.ts:389,405-421`).
- **Anchor:**
  - **Twin:** the Review says it "is isolated from the current canvas, project, profile…"
    (`CheckpointResumeBanner.tsx:216-218`), and its Start uses the archived project.
  - **Twin:** G2-P1-1 for the CNC hold.
- **Scenario:**
  - **A CNC project open** while a laser job is recovered on a combo machine:
    - "Go to restart point" is refused with "CNC point move blocked…";
    - or, with current Work Z, it first lifts the head to the CNC safe Z, which changes the laser's
      focus before the recovery burns.
  - **An open project without homing** for a machine that has it: the Review hides Home, which its
    own origin message asks for ("home the machine if it was reset").
- **Evidence:** READ.
  - Open PR #1462 (ADR-416 Amendment 3) makes motion follow the running job's machine, but "With no
    job, it is the open project's" (`job-motion-machine.ts` in the PR). The Review's moves run before
    the recovery starts, so they are not covered.
- **Refuter:** PLAUSIBLE (READ; code and PR diff checked, not run). It stays **P3**.
  - **The code reads the open project:**
    - `CheckpointResumeBanner.tsx:134` reads `state.project.device.homing.enabled`;
    - `laser-recovery-move.ts:26-30` takes the feed from the open `device`/`machine`;
    - `laser-recovery-flow.ts` checks only `capsule.artifact.machineKind`, never the open
      project's.
  - **PR #1462's diff:** `assertCncPointMoveWorkZReady` and `retractToCncSafeZ` now use
    `motionMachineKind(get(), project)` and `pointMoveSafeZMm`, which follow a *running* job.
    The Review moves before any job runs, so the open project still decides.
  - **Why not higher:** the laser resume never commands Z ("No Z words",
    `resume-program.ts:319`), so a CNC safe-Z lift before a laser restart would carry into the
    burn. But the lift needs current Work Z evidence, and a reconnect clears it
    (`laser-connection-actions.ts:257`).
    - So the operator must have set or probed CNC Work Z in CNC mode after the interruption.
    - That Z work itself moves or re-references the head.
    - The other outcomes are a visible refusal ("CNC point move blocked…") or a hidden Home
      button with Home still available in the Machine panel.
    - None is a silent wrong output reached without the operator's own Z change.
- **Fix direction:** pass the archived artifact's device and machine to the Review's Home and move
  hosts.

## KNOWN (cited, not re-raised)

- **G2-P1-1 (rolling v3 G2):** CNC recovery runs against whatever project is open.
  - Still present on `a59f74ff9`.
  - Open PR #1462 adds the open-project refusal and job-machine motion.
- **M3-P3-4 / G2-K-1:** `bannerMayGreet` ignores `grblHalEvidence`. Unchanged
  (`link-loss-restart-tracking.ts:68-74`).
- **18-P3-3 (rolling v2):** the resume parsers still miss leading-dot S words.
  - `WORD_RE` is unchanged (`resume-program.ts:66`, `laser-resume-reentry.ts:59`).
  - `formatGcodePowerS` still drops the leading zero (`decimal-word.ts:28`).
- **Refuter:** all three are still present on `a59f74ff9` (READ).
  - `src/ui/laser/cnc-recovery-open-project.ts`, which #1462 adds, does not exist on the tree,
    and #1462 is still open.
  - `bannerMayGreet` reads only `detectedControllerKind` and `activeControllerKind`.
  - Both `WORD_RE`s still need a digit before the dot.
    `src/core/gcode/decimal-word.ts:28` still slices the leading `0` off long decimals.

## Refuted

Refuted by the refuter:

- **H2-P2-1's responsive acknowledgement stall** ("a responsive controller stops acknowledging
  (90 s in Run)") **skips moves.** It does not. The containment cannot fire while the controller
  keeps reporting `Run`: every new `Run` report restarts the stall clock (`freshRunStatus`,
  `laser-stream-stall.ts:91-98`).
  - In the refuter's repro, 95 s with no acknowledgement and `Run, Bf:5` (10 queued) wrote no
    0x18.
  - It contains only on a report other than `Run`, `Hold` or `Door`. With `Idle`, GRBL's
    planner is empty: the last snapshot had `queuedBlocks 0`, and the restart at the first
    unacknowledged line skipped nothing.
  - The heartbeat-loss and write-failure paths of H2-P2-1 stand.

Candidates the auditor dropped:

- **Continue from where the head stopped ignores a proven restart.** This is by design: ADR-398
  Amendment 3 Decision 4, "Continue from where the head stopped is unchanged". Its text names the
  earlier-stop risk (`LaserRecoveryHeadStop.tsx:50-59`).
- **The frozen power-scale warning compares the live `$30` with the profile, not the archived
  scale.** The prepared project's `device.maxPowerS` is the execution scale
  (`prepare-output.ts:219-227`).
- **Phone or MCP Resume skips the desktop's resume confirmation.** Both call the store's
  `resumeJob` → `runConfirmedResumeJob` (`machine-actions.ts:197-208`).
- **CNC Pause and lift pins G54 (`CNC_REENTRY_MODAL_LINE`) and could reframe a G55 program.** The
  scanner refuses G55-G59, G20, G91, G92, G53 and G28 before the resume line
  (`cnc-pause-reentry-program.ts:17-19`).
- **The root crash screen's hosts need a provider missing above the root boundary.** None calls
  `usePlatform`; they read stores only.

## Verified clean

- **The laser resume transform 4:**
  - it re-asserts units, G90, WCS, G94, the plane, M5 hard-off, M7/M8 air, a `G0 … S0` re-entry,
    the M3/M4 re-arm at S0 and F;
  - it rebuilds Marlin and Smoothieware beams in their own dialect;
  - its independent burn oracle passes on this tree
    (`resume-program.emitter-oracle.test.ts`, 9/9).
- **Abort, controller error, reboot and alarm** each record the planner backlog. The repro baseline
  steps back 10 lines.
- **Lost link:** the ADR-398 Amendments 3-4 verdict, and the unknown-verdict hint.
- **The exact card:**
  - it needs fresh qualification and a matching controller kind;
  - it re-emits the archived lineage before use;
  - it shows Origin then/now, Restore and Continue.
- **The fingerprint-only card** refuses when the open project does not reproduce. Print-and-Cut is
  therefore safe there.
- **Run again** binds the Print-and-Cut registration into its signature and needs a clean Frame.
- **CNC pass and supervised recovery** use the ordinary emitter preamble (safe-Z lift, spin-up
  dwell, plunge feed) and the firmware-maximum planner reserve.

## Not verified

- **The variable-text sibling of H2-P1-1.** `prepareStartJob` does not evaluate variable data
  either, so a manual restart of a serial-number job may burn other text than the interrupted run.
  Not run.
- **Hardware.** Whether a heartbeat-loss 0x18 reaches the controller in real USB or Wi-Fi faults,
  and DTR-reset timing against planner drain, were not tested on a machine.
- **Whether the app-closing terminal record lands before the process exits.** If it does not, the
  next start promotes the run as `unknown` (H2-P2-2 b), with the same skip.
- **Read only:** the Marlin `M410` acknowledgement-stall path and the FluidNC and grblHAL
  post-reset modal states.
- **Not driven:** the CNC supervised runway and the second-pass workbench.
- **Refuter, not verified:**
  - Marlin's no-reset `M410` acknowledgement-stall path, which was read only.
  - The variable-text sibling of H2-P1-1.
  - Whether a desktop app-closing record lands before the process exits. Both outcomes skip:
    the `cancelled` record without a backlog, or the promoted `unknown` run.
  - The H2-P3-2 lift and defocus sequence, which was not run.

```json
[
  {"id":"H2-P1-1","severity":"P1","area":"recovery-journey","file":"src/ui/laser/start-job-source.ts","line":360,"anchor":"Twin: prepareCurrentStartJob applies/refuses currentPrintCutOutputRegistration (start-job-source.ts:84-108, prepare-output-snapshot.ts:82-105); Contract: ADR-443 Context (two-point solve moves, turns and scales the output); StartFromLineControl.tsx:176-179 'uses that run's job placement'","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Start from line / Choose restart point compile the project without the Print-and-Cut registration: with captures (5,3) Start emits G0 X45 Y357, the real runStartFromLineFlow streams G0 X40 Y360 (5.83 mm off) with no alert; with Labs off Start refuses 'registration is not valid' but the manual restart runs unregistered","refuter":"Reproduced via the real prepareCurrentStartJob and streamResumeFromRawLine with an independent burn-box reader: Start X45-65 Y337-357, streamed restart X40-60 Y340-360 (5.831 mm), final authorization passed, no dialog names the registration; after a position-epoch bump (any alarm, reset, reconnect or home) Start refuses and runStartFromLineFlow still streams unregistered. Stays P1."},
  {"id":"H2-P2-1","severity":"P2","area":"recovery-journey","file":"src/ui/app/checkpoint-interruption.ts","line":72,"anchor":"Contract: ADR-398 Decision 2 (planner-discarding stop records the whole planner) and Consequences ('after an Abort or stream error'); Twin: Abort records the backlog, lost link keeps it for a verdict/hint","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Heartbeat-loss and write-failure containment send 0x18 but stream-stalled and write-failed are not planner-discarding kinds: with 10 blocks queued the stall restarts at line 41 while Abort's identical reset restarts at line 31","refuter":"Reproduced: heartbeat 0x18 with 43 acked and Bf 10 queued records stream-stalled with no backlog, restart 44 vs Abort 34. Narrowed: the responsive ack-stall never contains while Run reports arrive (95 s, no 0x18) and contains only on Idle with an empty planner (queuedBlocks 0, no skip). P2 kept: the Review names the line, shows acked progress and says it can be ahead of the physical cut, as for 05-P2-2 and 18-P2-1 (meta M2 Severity OK)."},
  {"id":"H2-P2-2","severity":"P2","area":"recovery-journey","file":"src/ui/app/checkpoint-interruption.ts","line":46,"anchor":"Contract: ADR-398 Decision 2; ADR-548 Decision 3 (forced session end sends Abort, recorded as app closing); Twin: lost-link record keeps plannerBacklogIfRestarted and names the earlier line","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"An app-closing stop (awaited on desktop, incl. forced Windows restart) drops the backlog, and a run promoted after a crash/power loss is 'unknown' with the 25-line-lagged ack and no backlog or verdict: restarts at 121/101 vs Abort 21 and lost-link hint 21 (grblHAL 100 blocks)","refuter":"Reproduced: stopJob('app-closing') writes 0x18 and records cancelled without a backlog (restart 44 vs Abort 34); a real RecoveryRepository round trip promotes the active run as unknown at persisted ack 100 (restart 101 vs 21). (b) skips only when the planner is discarded before it drains (power loss, or a DTR reset before the drain); otherwise it re-burns the lag. P2 kept on the same Review basis."},
  {"id":"H2-P3-1","severity":"P3","area":"recovery-journey","file":"src/ui/common/ErrorBoundary.tsx","line":129,"anchor":"Contract: PROJECT.md NN9, ADR-546 Amd 2 crash Abort; Twin: workspace boundary split to keep protections","evidence":"READ","verdict":"CONFIRMED","known":false,"summary":"Both boundaries render the same crash hosts (Toasts, DesktopCloseNotice, ProjectSaveDialog) that the workspace also mounts; a host render bug cascades past the root, blanking the window with no ABORT or Ctrl+. (latent: no reachable host throw found)","refuter":"Mechanism reproduced: nested ErrorBoundarys with throwing crashHosts leave an empty root and lose the sibling; the control keeps both. Latent, stays P3."},
  {"id":"H2-P3-2","severity":"P3","area":"recovery-journey","file":"src/ui/laser/laser-recovery-move.ts","line":26,"anchor":"Twin: Review claims isolation from the open project (CheckpointResumeBanner.tsx:216-218) and its Start uses the archived project; G2-P1-1","evidence":"READ","verdict":"PLAUSIBLE","known":false,"summary":"The laser Review's Home button (open project's homing flag) and Go to origin/restart point (open project's feed and CNC point-move lift/refusal) read the open project; #1462 covers only a running job","refuter":"READ confirmed, including the #1462 diff (motionMachineKind and pointMoveSafeZMm follow a running job only). The CNC lift needs Work Z set again after a reconnect cleared it, so it stays P3."},
  {"id":"H2-K-1","severity":"P1","area":"recovery-journey","file":"src/ui/laser/cnc-supervised-recovery-stream.ts","line":107,"anchor":"Contract: ADR-416 Amd 2","evidence":"REPRO","verdict":"KNOWN","known":"docs/audits/2026-10-27-rolling-v3/G2-job-state.md G2-P1-1 (open PR #1462)","summary":"CNC recovery streams against whatever project is open; still present on a59f74ff9","refuter":"Still present on a59f74ff9 (READ)."},
  {"id":"H2-K-2","severity":"P3","area":"recovery-journey","file":"src/ui/app/link-loss-restart-tracking.ts","line":68,"anchor":"Twin: grblhal-evidence.ts","evidence":"READ","verdict":"KNOWN","known":"docs/audits/2026-10-23-meta-v1/M3-meta-controller-v2-v3.md M3-P3-4 (G2-K-1)","summary":"bannerMayGreet ignores grblHalEvidence; unchanged","refuter":"Still present on a59f74ff9 (READ)."},
  {"id":"H2-K-3","severity":"P3","area":"recovery-journey","file":"src/core/controllers/grbl/resume-program.ts","line":66,"anchor":"Twin: decimal-word.ts:28 leading-dot S","evidence":"READ","verdict":"KNOWN","known":"docs/audits/2026-10-21-rolling-v2/18-preflight-recovery.md 18-P3-3","summary":"Resume parsers still miss leading-dot S words","refuter":"Still present on a59f74ff9 (READ)."}
]
```
