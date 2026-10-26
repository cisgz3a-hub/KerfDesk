# Rolling audit v2 — Job lifecycle

- **When:** 2026-10-21   **Tree:** origin/main @ `faf5a54f1` (no `src/` change between it and the audit worktree HEAD)
- **Scope:** `src/ui/state/**` job lifecycle (connect/disconnect, Frame permit and completed Frame,
  Start arming and first window, stream acks, Pause/Resume, Abort, alarms, tool-change holds,
  post-job settle), the Start and recovery wiring it serves (`src/ui/laser/start-job-*`,
  `framed-*`, `job-review/job-review-gate.ts`, `laser-recovery-flow.ts`, `manual-restart-source.ts`,
  `StartFromLineControl.tsx`, `src/ui/app/use-job-checkpoint.ts`, `checkpoint-interruption.ts`),
  the remote Start entry (`src/ui/remote-control/machine-execution.ts`) and the external-program
  Start (`src/ui/gcode-inspector/external-run.ts`). Governing: PROJECT.md NN21, ADR-565 (amending
  ADR-228/230/232/237), ADR-311, ADR-312, ADR-341 and Amendments 3/4/6/8, ADR-605 Amd 1, ADR-630.
- **Lenses run:** L1, L3, L4, L6, L7. L2 only through firmware behaviour already cited in the
  code (no new primary-source fetch). L5 skipped: the trust boundaries in reach (remote control,
  external files) belong to areas 01 and 14.
- **Counts:** 3 raised → refuter: 3 confirmed, 0 plausible, 0 refuted → P1 0 / P2 2 / P3 1 (+ 4 KNOWN)

## Headline

The ordinary Start path is very well defended: the streamed bytes are the reviewed bytes, every
in-review or post-review edit, undo, device-profile change, `$30` change or stale worker result is
caught by the retention-key signature, the power-scale binding and a synchronous final assertion
inside `startJob`, and every refusal on the path is a transport, compile or handoff fact. The
weak spots are in recovery: (1) the manual **Start from line** control fills in a line number
computed on the saved run's own program (a resume or painted second pass) and applies it to the
project's full program, so a second interruption leads to a large double burn; (2) a halt alarm
that arrives after the last acknowledgement, while the planner is still moving (reproduced on
Smoothieware's kill button / hard limit), is recorded without the planner step-back, so the
automatic restart skips the discarded moves, against "recut, never skip".

## Lifecycle map (store state)

```
Disconnected ─connect→ Connected/qualifying ─$$,$I,$G→ Idle
Idle ─Frame→ motionOperation:frame ─clean Idle→ completedFrame (+framedRun permit)
   drift/jog/alarm/reset/MPG/session → frameProofReset (framed-run-invalidation.ts)
Start: arm framedRun ← completedFrame → Job Review (single owner) → rebind permit to reviewed bundle
   → claim → durable start intent → startJob:
      controllerOperation start-arming {queue-fence → (CNC dwell | override fence) → live-status}
      → final sync assertion → consume framedRun → install streamer → reset bytes → first window
streaming ⇄ paused (door byte; hosted refill released first) ; streaming → tool-change (M0 held host-side)
streaming/paused/tool-change ─ALARM→ cancelled ; ─error:N→ errored(+reset) ; ─close→ disconnected
streaming ─last ack→ done ─post-job-settle (marker + 2 fresh Idle)→ streamer null, completedFrame rebased
done ─ALARM (no banner)→ done, controllerOperation null ─Idle→ streamer null (interrupted 'unknown')  ← P2-2
Abort: GRBL family → owned reset (recovery op, markErrored, frameProofReset); Marlin → cancel + stop lines
Recovery: capsule (interruption + acked) → card Review (archived program) | Start from line (project program) ← P2-1
```

## Findings

### P2-1 — Start from line pre-fills a line from the saved run's program and replays it on the project's full program
- **Where:** `src/ui/laser/StartFromLineControl.tsx:134` (default line =
  `automaticRecoveryRestart(capsule)` on `capsule.artifact.gcode`), `:33` (`runStartFromLineFlow(line)`),
  `src/ui/laser/manual-restart-source.ts:100-108` (a resumed or painted-second-pass artifact is
  excluded, so the source falls back to the receipt, the last manual restart or a live compile of
  the project, `:64-67`), `src/ui/laser/start-job-flow.ts:302-320`.
- **Lens:** L3 (twin), L4 (lifecycle: recovery of a recovery).
- **Anchor:** Twin — the card's Review (`laser-recovery-flow.ts:90-92`) computes and applies the
  automatic line on the same archived program; the manual control computes it on that program and
  applies it to another. Contract — "recut, never skip" (recovery) and ADR-341 Amd 3 (resume
  fidelity). The control's own hint says the card "restarts there too".
- **Scenario:** A laser job is interrupted, recovered from the card (the new run's archive is the
  resume program, `laserResumeChain` non-empty), and that recovery run is interrupted again. The
  rail's **History & recovery → Start from line…** field shows "Its automatic restart is file line
  32 … The Interrupted job saved card's Review restarts there too". Pressing **Resume from line**
  rebuilds the project's own program and restarts at *its* line 32: burn X28 instead of X82, so
  every segment from X28 to X81 burns a second time. With a painted second-pass capsule the line
  indexes the whole original job, which is replayed from there. If the first resume started within
  the resume preamble length (9 lines here) of the program start, the mapping goes the other way
  and up to that many lines are skipped. The confirmation shows only line numbers.
- **Evidence:** REPRO — temporary `src/ui/laser/zz-05-manual-restart-numbering.test.ts` (deleted):
  100-burn program (`G1 X<i> Y0 S500 F1000` after a 4-line header), `buildLaserResumeProgram(program,
  64, device)`, then `automaticRestart(resumeGcode, 30, undefined)`. Command:
  `node ../../../node_modules/vitest/vitest.mjs run src/ui/laser/zz-05-manual-restart-numbering.test.ts`.
  Output: `{"preamble":9,"defaultLine":32,"resumeLineText":"G1 X82 Y0 S500 F1000","projectLineTextAtSameNumber":"G1 X28 Y0 S500 F1000"}`.
  The source fallback is READ (`manual-restart-source.ts:103-108`). No test covers a resumed or
  second-pass capsule in this control (`StartFromLineControl.preview.test.tsx:317` only
  `laserResumeChain: []`).
- **Refuter:** CONFIRMED (P2 kept). Own repro (temporary `zz-05r-start-from-line.test.tsx`,
  deleted): a 40-segment project, a recovery capsule whose artifact is
  `buildLaserResumeProgram(original, 54)` with `laserResumeChain` set and 30 acks; the rendered
  control's field held 32 with the "restarts there too" hint, and the real `runStartFromLineFlow(32)`
  handed `streamResumeFromRawLine` the project's own program (`replayedIsProjectProgram: true`)
  at line 32: `G0 X13` instead of the resume program's `G0 X35`. No guard in
  `start-job-resume-stream.ts` compares the field's source program, and the confirmation names
  line numbers only. Reachable whenever a card recovery is interrupted again and the operator
  uses the manual control.
- **Fix direction:** Pre-fill only when the capsule's program is the one the manual source will
  compile (same fingerprint and no resume/second-pass chain); otherwise leave the field empty and
  point to the card's Review. "Choose restart point…" (`:90`, `initialLine={line}`) needs the same rule.

### P2-2 — A halt alarm after the last acknowledgement is recorded without the planner step-back, so recovery skips the discarded moves
- **Where:** `src/ui/state/laser-alarm-line.ts:74` (`advanceStream(..., 'alarm')`; a `done`
  streamer is terminal, `streamer.ts:292,336-339`, so it stays `done`) and `:85-89` (the
  post-job-settle operation is dropped); `src/ui/state/laser-terminal-stream-release.ts:18` (Idle
  releases `done` with no operation); `src/ui/app/use-job-checkpoint.ts:165-175` →
  `src/ui/app/job-checkpoint-repository.ts:63-82` → `src/ui/app/checkpoint-interruption.ts:98`
  (`done` is not an interruption status) and `:64-68` (`unknown` is not planner-discarding).
- **Lens:** L3 (twin), L6 (failure path).
- **Anchor:** Twin — the same alarm one acknowledgement earlier is recorded `cancelled` with a
  planner backlog (`checkpoint-interruption.ts:39-44`, `currentRunPlannerBacklog`), and
  `planner-backlog-restart.ts` exists because a stop that discards the planner must not restart
  at the first unacknowledged line (controller audit recovery-6 / OR-3). Contract — "recut, never skip".
- **Scenario:** Smoothieware streams one line at a time and acknowledges a move once it is queued,
  so after the last `ok` up to 32 moves (`DEFAULT_PLANNER_BLOCKS.smoothieware`) are still
  running. The operator presses the machine's kill button (`ALARM: Kill button pressed …`, which
  the driver already parses, `smoothieware/response.ts:9`) or a hard limit trips. The stream stays
  `done`, the settle operation is cleared, and after `M999` the Idle report releases the stream.
  The run is saved as `unknown` ("ended before clean physical completion") with no backlog, and
  the automatic restart is the last line: the up to 32 moves Smoothieware discarded are skipped.
  If the operator unplugs instead, the same `done` stream becomes `disconnected`, which is also
  not planner-discarding. GRBL/grblHAL/FluidNC hard limits need a reset whose banner turns `done`
  into a reboot interruption (with backlog), so they avoid this; grblHAL E-stop was not checked.
- **Evidence:** REPRO — temporary `src/ui/state/zz-05-done-tail-alarm.test.ts` (deleted): line-handler
  harness with `smoothiewareDriver`, 40-line ping-pong program; case A emits 39 `ok` then
  `ALARM: Hard limit +X`; case B emits 40 `ok` then the same alarm. Output: A `aStatus:"cancelled"`,
  interruption `{"kind":"cancelled", "plannerBacklog":{"ackedAtStatus":39,"queuedBlocks":32,"bound":"planner-size"}}`,
  restart line 8; B `bStatus:"done"`, `bControllerOperation:null`, released interruption
  `{"kind":"unknown","message":"The job stream ended before clean physical completion."}`, restart
  line 40. No existing test sends an alarm to a `done` stream
  (`laser-alarm-line.smoothie.simulator.test.ts` covers only a streaming job).
- **Refuter:** CONFIRMED (P2 kept). Own end-to-end repro (temporary `zz-05r-done-tail-alarm.test.ts`,
  deleted): Smoothie simulator, real `installJobCheckpointTracking` and `RecoveryRepository`,
  40-line tracked job. Kill button after the last `ok` (stream `done`, settle op, 40 moves still
  queued) → stream stays `done`, op `null`; `unlockAlarm` (M999) → Idle releases it; capsule
  `{"kind":"unknown"}`, 40 acks, no backlog, restart line 40. Kill at 20 acks → `cancelled` with
  `planner-size` backlog, restart line 1. Firmware checked at source: Smoothieware sends a G1's
  `ok` before planning (GcodeDispatch.cpp), `planner_queue_size` defaults to 32 and `on_halt`
  flushes the queue (Conveyor.cpp), and the kill button prints "ALARM: Kill button pressed - reset,
  $X or M999 to clear HALT" (KillButton.cpp). GRBL 1.1 (`protocol.c`) and grblHAL (`protocol.c`,
  E-stop held until released) block hard-limit and E-stop alarms until a reset, so the exemption
  for the GRBL family holds. The card's generic hint ("acknowledged progress can be ahead of the
  physical cut") is the only mitigation.
- **Fix direction:** Treat an alarm (numbered or text) that reaches an active `done` stream as
  ending the run: mark it `cancelled`/`errored` like a reboot does (`rebootDuringJobPatch`), or let
  `checkpointInterruption` attach the backlog whenever an alarm was seen for the run. Add a
  regression for the tail case on every family.

### P3-1 — Running an external G-code file leaves the previous project job's recovery card, Run again and second-pass offer in place
- **Where:** `src/ui/gcode-inspector/external-run.ts:202-252` (`startJob` with no `runId`, and no
  recovery-repository call anywhere in `src/ui/gcode-inspector/`); compare
  `src/ui/laser/start-job-resume-stream.ts:64-67,73` (`noteUntrackedRunAccepted`).
- **Lens:** L3 (twin), L1.
- **Anchor:** Twin — every other untracked Start retires older recovery records because "an
  accepted stream changes physical machine state. An older capsule or completed-job receipt must
  not remain eligible afterward" (`start-job-resume-stream.ts:64-66`;
  `recovery-slot-mutations.ts:152-173` clears capsule, receipt and pending Start). Contract —
  ADR-341 Amendment 4 decision 1: the second pass is offered for "the last run, when it completed"
  and "a later run that is interrupted or aborted clears that receipt".
- **Scenario:** Job A completes (receipt kept, **Paint a second pass…** and **Run again** offered)
  or is interrupted (recovery card kept). The operator then runs an external file through the
  Inspector, completed or aborted. Afterwards the Machine panel still offers a second pass and Run
  again for job A, and the card still offers to resume job A, although the last thing the machine
  ran was the external program. Each still needs a Frame or a recovery review before motion, so
  this is drift rather than an unguarded burn.
- **Evidence:** READ — no `recoveryRepository` use in `src/ui/gcode-inspector/`; `startJob`
  without `runId` sets `activeRunId: null` (`laser-job-actions.ts:408`), which the checkpoint
  tracker ignores (`use-job-checkpoint.ts`, `observeStreamer` returns on `runId === null`).
- **Refuter:** CONFIRMED (P3 kept). Read: no recovery call in `src/ui/gcode-inspector/` and no
  store-level retirement on a run-less `startJob` (`noteUntrackedRunAccepted` has only explicit
  callers). Repro (same temporary harness): after a tracked run left a capsule, a run-less
  `startJob` (the call `external-run.ts:225` makes) streamed to the simulator and settled, and
  the capsule was unchanged. ADR-630 only says the external run itself gets no resume, so it does
  not make this deliberate. `src/ui/camera/calibrate/transient-camera-job.ts:165` is a second
  run-less Start with the same gap.
- **Fix direction:** After the external program's first window is accepted (or a write was
  attempted), call `recoveryRepository.noteUntrackedRunAccepted()` as the manual restart does, or
  record in ADR-630 that external runs deliberately leave project recovery untouched.

## KNOWN (cited, not re-raised)

- **K-1** Laser Start's reservation refusal says "CNC Start lost its exclusive controller/setup
  reservation…" (`src/ui/state/laser-job-actions.ts:319-321`). Open item 3 of
  `docs/audits/2026-09-24-post-frame-start-block-audit.md`; still present.
- **K-2** Job Review Confirm recompiles when advisory controller evidence was refreshed
  (`src/ui/laser/job-review/job-review-gate.ts:326`, no `ignoreAdvisoryControllerEvidence`). Open
  item 2 of the same audit; still present, never a refusal.
- **K-3** Owned Abort / `error:N` / heartbeat stops send Ctrl-X mid-motion on GRBL-family
  controllers (`laser-job-stop.ts:256`). D-1 of `2026-10-20-controller-design-audit.md`.
- **K-4** Any `error:N` during a job resets the controller. P-2 of
  `2026-10-20-controller-protocol-audit.md`.

## Refuted

None by the refuter: P2-1, P2-2 and P3-1 were each reproduced. Candidates the auditor itself dropped:

- *Pause sends the door byte with no active job.* The remote entry checks `isActiveJob`
  (`remote-control/machine-actions.ts:150`) and the rail shows Pause only for a running job.
- *A write failure on Marlin/Smoothieware sends no stop lines.* `containActiveStreamWriteFailure`
  marks the stream errored and the notice tells the operator to press ABORT, which runs the
  no-reset stop lines; truthful, not silent.
- *Alarm leaves `completedFrame` set.* It bumps `trustedPositionEpoch`, so the stale proof can never
  pass `framedRunReadinessIssue` again.
- *"Continue from where the head stopped" assumes the controller kept running.* Opt-in, and it
  discloses the unconfirmed lines and their travel (ADR-341 Amd 6/8).

## Verified clean

- **Exact-program binding (Q1).** Start re-prepares in `prepareFramedStartReview`, Confirm re-runs
  the preparation and accepts only identical bytes and an identical review model
  (`job-review-gate.ts:123-127`), `rebindReviewedFramedRun` requires the live retention key to equal
  the reviewed bundle's (`framed-start-preparation.ts:117-126`), and `startJob` calls the
  synchronous `currentLaserForAuthorizedStartNow` after its last await
  (`start-job-transmission.ts:61-66,217-226`; `laser-job-actions.ts:202-207`). The key covers scene,
  machine, CNC setup, every non-descriptive device field, optimisation, start points, variables,
  scope, placement and registration (`canvas-motion-plan.ts:266-298`). Edit, undo (new project
  object), device-profile change, `$30` change (`laserPowerScaleStillCurrent` at rebind and at the
  wire), late worker result (`start-preparation-owner.ts`, STALE refusal) and a print-and-cut
  toggle all fail closed. A second window cannot drive the same port, and the recovery handoff is
  armed exclusively.
- **Double Start / remote vs local Start.** One Job Review owner per window
  (`job-review-presentation.ts:27`), one claim (`framed-run-start-claim.ts`), and
  `armPermitFromCompletedFrame` refuses while a claim is held. A losing review abandons on its next
  signal; nothing streams twice.
- **Start during Frame.** A running Frame expires `completedFrame` (`framed-run-invalidation.ts:73-85`);
  the shortcut path only toasts.
- **Abort during start arming, held reset bytes and first window.** The reset owner replaces the
  `start-arming` operation and clears frame proof (`laser-reset-ownership.ts:84-116`);
  `sendResetThenFirstWindow` writes the window only while Start still owns the wire.
- **Abort while streaming / paused / tool-change / done tail.** GRBL family: owned reset,
  `jobStopRequest` and `streamReset` recorded, stream marked errored → `cancelled` interruption with
  backlog. Marlin: freeze before the first await, old ack ledger retained (KNOWN fixes F1).
- **Alarm while streaming, paused or in a tool-change hold** → `cancelled` with planner backlog
  (repro case A above); probe alarm in a drained hold keeps the hold.
- **Console and jog during a job** are refused (`console-command-readiness.ts:90-101`); only a drained,
  fresh-Idle tool-change hold admits a jog.
- **Policy vs fact (Q3).** Every refusal on the Start path is factual or handoff consistency:
  empty program, RX/line-buffer/FluidNC length, unencodable byte, pending owed reply, CNC driver
  capability, MPG, non-Idle/Alarm/no-status, session/position/origin change, consumed or replaced
  permit, power-scale change, tool-plan mismatch, missing review evidence. No bounds, no-go,
  homing, licence or `$32` refusal was found.
- **Tool-change Continue** checks MPG, drained fresh Idle and work-Z evidence before writing; its
  writes are job-sourced and owe no untracked acks.
- **Deferred ack batching (ADR-352)** defers only while streaming with a line still in flight, no
  untracked debt, no hosted refill and no MPG.
- **Post-job settle** owns completion only after the marker and two fresh Idle reports; a failure
  clears its operation instead of wedging the panel.

## Not verified

- No hardware. Smoothieware's kill-button text and queue depth are taken from the driver's own
  source citations; the grblHAL E-stop path (whether a banner follows ALARM:10) was not checked.
- Multi-window IndexedDB races were reasoned about, not run.
- Hosted (worker) refill crash and transport internals belong to `platform-web` (area 19).
- Job Review card editing (ADR-638) belongs to area 06; core recovery math (`automatic-restart-line`,
  `planner-backlog-restart`) to area 18 and was used, not audited.
- CNC pause-lift and re-entry (ADR-411) and CNC supervised recovery were only skimmed.

```json
[
  {"id":"P2-1","severity":"P2","area":"job-lifecycle","file":"src/ui/laser/StartFromLineControl.tsx","line":134,"anchor":"Twin: laser-recovery-flow.ts:90-92 applies the automatic line to the same archived program; Contract: recut never skip, ADR-341 Amd 3","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Start from line pre-fills the automatic line of a resumed/second-pass capsule's program and replays that number on the project's full program (double burn; narrow skip)"},
  {"id":"P2-2","severity":"P2","area":"job-lifecycle","file":"src/ui/app/checkpoint-interruption.ts","line":98,"anchor":"Twin: same alarm while streaming records cancelled + planner backlog; Contract: recut never skip (controller audit recovery-6/OR-3)","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"Halt alarm after the last ack (Smoothieware kill button/hard limit) leaves the stream done; it is recorded 'unknown' without planner backlog, so automatic restart skips the discarded moves"},
  {"id":"P3-1","severity":"P3","area":"job-lifecycle","file":"src/ui/gcode-inspector/external-run.ts","line":225,"anchor":"Twin: start-job-resume-stream.ts:64-67 noteUntrackedRunAccepted; Contract: ADR-341 Amd 4 decision 1","evidence":"REPRO","verdict":"CONFIRMED","known":false,"summary":"External G-code run does not retire the previous job's recovery capsule, Run again receipt or second-pass offer"},
  {"id":"K-1","severity":"P3","area":"job-lifecycle","file":"src/ui/state/laser-job-actions.ts","line":319,"anchor":"Copy","evidence":"READ","verdict":"PENDING","known":"2026-09-24-post-frame-start-block-audit.md open item 3","summary":"Laser Start reservation refusal says CNC Start"},
  {"id":"K-2","severity":"P3","area":"job-lifecycle","file":"src/ui/laser/job-review/job-review-gate.ts","line":326,"anchor":"Performance","evidence":"READ","verdict":"PENDING","known":"2026-09-24-post-frame-start-block-audit.md open item 2","summary":"Confirm recompiles after an advisory controller-evidence refresh"},
  {"id":"K-3","severity":"P2","area":"job-lifecycle","file":"src/ui/state/laser-job-stop.ts","line":256,"anchor":"Ground truth: GRBL reset mid-motion raises ALARM:3","evidence":"READ","verdict":"PENDING","known":"2026-10-20-controller-design-audit.md D-1","summary":"Owned stops reset mid-motion on GRBL-family controllers"},
  {"id":"K-4","severity":"P3","area":"job-lifecycle","file":"src/ui/state/laser-error-line.ts","line":207,"anchor":"Policy choice","evidence":"READ","verdict":"PENDING","known":"2026-10-20-controller-protocol-audit.md P-2","summary":"Any error:N during a job resets the controller"}
]
```
