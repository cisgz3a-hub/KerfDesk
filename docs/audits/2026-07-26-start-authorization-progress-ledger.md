> Historical archive added 6 September 2026. The report below retains its original July baseline, findings, priorities, source claims and reported checks. Those claims were not rerun or refreshed for this publication. Original task instructions are historical context; current Frame-first and Job Review warning policy remains governing. The recorded read-only/publication restrictions describe that original task loop. Its quarantined A-01/A-02 candidate edits remain separately pending current-main reconciliation; this archive does not apply them.

# KerfDesk Start-authorisation audit progress ledger

**Updated:** 2026-07-26T16:27:31+08:00
**Repository:** `C:\Users\Asus\LaserForge\continuous-audit-source`
**Branch:** `agent/frame-start-advisory-retention`
**Original audit baseline:** `de36b8674a8abf0c9276f5666ae34e14a3791476`
**Latest current-main refresh:** `9aad1207b8b0e54c5960be5ed42214235b222fad`
(`origin/main`; this branch remains at the original baseline and is three commits behind)
**External publication:** not authorised in the current loop; no commit, push, PR, merge, or
deployment

## Scope

Read-only audit of ordinary Start authorisation after a completed exact-job physical Frame and the
separate completed-job replay and transient-camera Start contracts. Preserve factual transport,
compile/materialisation, placement, motion ownership, controller setup/position, exact-artifact
handoff, interlock, and recovery boundaries. Distinguish real Start gates from Job
Review/display-only warnings. No product edit, publication, hardware action, or machine operation is
in scope.

## Completed checks and evidence

- Traced the full source path from `LaserWindow`/`JobControls` through Frame preparation and
  completion, permit retention, Job Review, compilation/preflight, final wire handoff, persistence,
  completed replay, and recovery.
- Refreshed current main and verified PR #446 / `de36b867` only refactored tile emission; it does not
  overlap the audited Start paths.
- Verified canonical preflight refusal is limited to five factual codes:
  `non-finite-coordinate`, `empty-output`, `relief-needs-cnc`, `no-output-layer`, and
  `program-materialization-failed`.
- Verified no separate curve-test gate exists. Curve complexity and compiled-work estimates are
  Job Review advisories. Three curve/preflight files passed 16 tests.
- Earlier focused current-path verification passed 15 files / 119 tests. The mocked-controller
  Frame -> Start -> live-run browser path passed.
- Researched primary US, EU/EEA, and Great Britain machinery/laser sources plus GRBL protocol and
  consensus standards. No reviewed software-only rule mandates KerfDesk's Frame/reframe UI,
  curve-size threshold, bed/no-go veto, `$30`/`$32` veto, or universal Job Review modal.
- The first full `pnpm release:check` reached Vitest but was non-green because this checkout's
  `node_modules` junction resolved through `C:\Users\Asus\LaserForge-2.0`; Vite denied external
  `lucide-static/*.svg?raw` IDs. It still completed 1,224 passing files / 7,327 passing tests before
  26 collection failures. The junction was replaced with this checkout's own frozen-lockfile
  dependency installation; no source or lockfile changed.
- Refreshed `origin/main` to merge commit `9aad1207`. The intervening PR #447 changes only
  G-code-inspector/viewer files; the audited Start/Frame files have identical Git object IDs between
  `de36b867` and `9aad1207`, so A-01/A-02 remain current-source findings.
- An exact-`9aad1207` archive outside the repository reproduced A-01 and A-02 in a two-assertion
  audit probe. Together with the unchanged current-main `framed-run` and canvas-plan tests, the
  probe run passed 3 files / 25 tests. This is **reproduced** evidence of current behavior, not
  evidence that the preserved candidate fix is correct.
- Current-main M7 evidence is internally inconsistent: `WORKFLOW.md:741-743` and `877-879` say
  proven missing option `M` refuses Frame/Start, while source makes it advisory and the targeted M7
  suite passed 4 files / 32 tests. This is a source-confirmed documentation finding, not a live
  Start blocker.
- Exact current main `9aad1207` reached terminal green for full CI, Chrome UX smoke,
  `pnpm audit`, and the web deploy. The immutable commit is therefore **CI-confirmed** and
  **release-confirmed** as built/tested/deployed; those checks do not prove that A-01/A-02 or the
  newly reproduced A-03 is fixed, and they provide no controller or hardware qualification.
- A disposable exact-`9aad1207` recovery/handoff snapshot passed 8 files / 90 tests, including
  ordinary Start persistence degradation, interrupted-capsule isolation, permit/handoff races,
  durable pending-Start reconciliation, final controller authorization, laser recovery, and both
  CNC recovery flows. The snapshot was removed after the run.
- A second disposable exact-`9aad1207` snapshot audited completed-job replay and transient-camera
  Start. Four files / 29 tests passed. A replay probe reproduced a final-handoff refusal when only
  same-value controller settings and their observation object were refreshed during staging; a
  physical-position-change control remained blocked. Transient-camera probes proved advisory
  settings/build-info refresh remained authorized after its completed Frame, while controller
  session and physical-position changes remained blocked. The snapshot was removed after the run.
- A third disposable exact-`9aad1207` snapshot audited cancellation, Abort, reconnect, queue-fence,
  and old-session transport ownership. Nine files / 94 tests passed. Abort during pending-ack drain
  and port-close/reconnect controls sent no program bytes; the replacement session could not inherit
  the old Start reservation. The visible `ABORT MOTION` control was present and functional during
  `start-arming`, but Ctrl+. ignored that same state. The snapshot was removed after the run.
- A fourth disposable exact-`9aad1207` snapshot audited all six controller families plus ordinary,
  completed-replay, and transient-permit Start. Fourteen files / 144 tests passed. An export-only
  probe seam reproduced that a file-only Ruida project can reach the connected GRBL live `startJob`
  action through all three Start paths when a stale serial connection remains. The same probe again
  reproduced the unhandled `start-arming` Ctrl+. event. The snapshot was removed after the run.
- A fifth disposable exact-`9aad1207` snapshot audited profile/controller drift through the repeated
  final authorization callback and the family-specific CNC fence before the first program write.
  Nineteen files / 224 tests passed, including eight probe assertions. Controller kind, streaming
  mode, RX-buffer size, and physical-envelope edits changed the exact execution signature and were
  refused at the repeated final handoff. A Marlin CNC probe wrote the owned `M400` queue-settlement
  marker and then refused because no realtime status channel exists, with zero program lines. A
  Smoothieware CNC simulator probe wrote `M400`, obtained realtime `?` status, and crossed the fence;
  that proves current app behavior only, not hardware/dialect safety. The snapshot was removed after
  the run.
- A sixth disposable exact-`9aad1207` snapshot audited controller `error`, Alarm, timeout,
  Abort/reset, and reboot at the CNC settle/status barriers. A final focused probe passed 9/9
  assertions; a broader ownership/recovery run passed 14 files / 132 tests. It reproduced a
  distinct overbroad invalidation: an owned GRBL `G4 P0.01` `error:20` correctly stopped before
  program bytes and cleaned the staged/pending recovery handoff, but also destroyed the completed
  Frame permit and retained verification. A completed-replay control retained its receipt yet
  could not prepare a retry without another Frame. Settle/status silence retained the Frame and
  succeeded on a later clean retry; Alarm, Abort/reset, and reboot correctly revoked it.
- Checked-in coverage inventory found no browser/E2E or unit contract for Ctrl+. during either
  `start-arming` phase. Existing shortcut tests cover active stream, idle, and Frame/jog motion;
  existing Live Motion coverage uses a generic probe operation; Playwright covers exact Frame ->
  Start but contains no Ctrl+., `start-arming`, or panic-Shortcut Abort scenario.

## Evidence labels

- **Source-confirmed:** the conclusion follows from exact immutable `origin/main` source/test lines.
- **CI-confirmed:** the cited exact commit completed the named hosted check successfully.
- **Release-confirmed:** the cited exact commit completed a deploy/release check successfully.
- **Reproduced:** a targeted local or disposable exact-main probe observed the stated behavior.
- **Hardware-only:** source/simulator evidence cannot establish the physical controller/machine fact.

Green CI or a later commit is never treated as proof that an unmerged candidate fix is correct.

## Findings

| ID | Severity | Confidence | Verified finding | Current disposition |
|---|---|---|---|---|
| A-01 | Medium operator-impact | High | **Source-confirmed; reproduced.** Current main compares advisory settings/build-info object identity at Frame completion and returns the generic controller-changed refusal. Exact-main probe reproduced the refusal. | Preserved uncommitted candidate is locally tested only; **not CI-confirmed or release-confirmed** and not to be applied in read-only mode. |
| A-02 | Medium operator-impact | High | **Source-confirmed; reproduced.** Current main serializes the whole device profile into the one-way retention key. Exact-main probe reproduced no-go metadata changing that key. | Preserved uncommitted candidate is locally tested only; **not CI-confirmed or release-confirmed** and not to be applied in read-only mode. |
| A-03 | Medium operator-impact | High | **Source-confirmed; reproduced.** Exact completed-job replay recompiles and fingerprint-checks the receipt, but its final handoff has no Frame claim and therefore compares advisory settings/build-info references by object identity. An exact-main probe reproduced zero calls to `startJob` after a same-value settings/observation refresh during staging; a physical-position-change control also remained blocked. | Verified special-replay blocker. Proposed scope is semantic equality for unchanged advisory evidence only; actual value, receipt, compile, placement, session, position, handoff, transport, and recovery changes remain authoritative. No implementation exists. |
| A-04 | Medium operator-impact | High for exact GRBL software path; hardware-unverified | **Source-confirmed; reproduced.** The owned CNC settle command rejects before streamer creation on `error:N`, but the shared error handler unconditionally clears `framedRun` and `frameVerification`, including when the rejected line is the non-motion GRBL `G4 P0.01` barrier. The exact-main probe observed `error:20`, zero program bytes, full staged/pending cleanup, permit loss, and a completed replay forced back through Frame despite its receipt remaining current. | Verified overbroad reframe, not authority to cross the failed queue fence. Preserve the current-attempt stop, acknowledgement ownership, persistent controller-error notice, Start alert, recovery cleanup, and all Alarm/Resend/reset/session/motion invalidations. Any future fix must be limited to causally owned non-motion GRBL settlement errors whose session, reported position, origin, and status remain unchanged; status-query errors and Smoothie/Marlin error vocabularies remain unqualified. No implementation exists. |
| U-01 | Medium control-surface impact | High | **Source-confirmed; reproduced.** `LiveMotionBar` treats any `start-arming` controller operation as live motion and exposes a working `ABORT MOTION` button wired to `stopJob`, but the documented Ctrl+. panic shortcut dispatches only for an active streamer or motion operation. Two disposable exact-main probes reproduced an unhandled Ctrl+. event and zero `stopJob` calls during the final queue fence. | Verified keyboard Abort parity defect, not a Start authorization gate. No checked-in unit or browser/E2E test covers Ctrl+. in `start-arming`; green CI therefore does not exercise this branch. Scope only Ctrl+. during `start-arming`; the visible Abort path and all queue/session/transport checks already behave correctly. No implementation exists. |
| CS-01 (cross-stream) | High potential safety/integrity impact | High for software path; hardware-unverified | **Source-confirmed; reproduced.** Current main deliberately allows configured/active/detected controller-family mismatch. The project selects emitted bytes and stream mode while the live connection owns parsing/reset/stop semantics. A disposable exact-main probe showed file-only Ruida reaching the connected GRBL live `startJob` action through ordinary, replay, and transient-permit Start. | Already canonical in the master ledger under the Controller systems stream; not duplicated as a Start-stream backlog entry. This is a missing compatibility boundary, not an accidental blocker. Any refusal change needs the recorded maintainer decision and must remain narrowly family/transport based rather than restoring a broad stale policy gate. |
| D-01 | Low future-regression risk | High | **Source-confirmed; reproduced.** Current-main workflow text says proven missing GRBL option `M` refuses Frame/Start, while current source and 4 files / 32 targeted tests make it a Job Review advisory. | Documentation-only correction proposed later; no live Start gate and no product-code change. |
| C-01 | Informational | High | **Source-confirmed; locally test-confirmed.** Large curve/vector/raster/work estimates are warnings, not Start gates; actual materialisation failure still blocks. | No code change. Existing results are not hardware evidence. |
| H-01 | High safety consequence | Hardware-unverified | **Hardware-only.** Software status cannot prove laser/spindle-off latency, door/e-stop/interlock wiring, USB-loss fail-safe, real CNC safe-Z clearance, step loss, or safe interrupted-job position. | Retain all related boundaries; require machine-family qualification before changing policy. |
| V-01 | Low product impact | High | **Reproduced environment failure.** Cross-checkout dependency junction prevented a trustworthy full local release result. | Local dependency isolation completed before read-only mode resumed; no subsequent full release result exists. |

## Local implementation state

Quarantined A-01/A-02 production and regression-test files, created before read-only mode resumed:

- `src/ui/state/framed-run.ts`
- `src/ui/state/framed-run.test.ts`
- `src/ui/state/canvas-motion-plan.ts`
- `src/ui/state/canvas-motion-plan.test.ts`
- `src/ui/state/laser-store-frame-advisory-refresh.test.ts`
- `src/ui/laser/framed-run-device-metadata-retention.test.ts`

Detailed audit artifact:

- `docs/audits/2026-07-26-start-authorization-hidden-blocker-audit.md`

Unrelated and excluded:

- `docs/audits/2026-07-26-kerfdesk-electron-desktop-quality-audit.md`

The candidate files are neither current-main nor published behavior. Their earlier local test
results do not establish CI, release, controller, or hardware correctness. They must remain
untouched and must not be applied, committed, pushed, or merged while the stream is read-only.

## Evidence links

- A-01 source: [`framed-run.ts:120-178` at `9aad1207`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/framed-run.ts#L120-L178);
  current-main test contract: [`framed-run.test.ts:99-117`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/framed-run.test.ts#L99-L117).
- A-02 source: [`canvas-motion-plan.ts:218-241`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/canvas-motion-plan.ts#L218-L241)
  plus one-way invalidation at
  [`framed-run-invalidation.ts:15-49`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/framed-run-invalidation.ts#L15-L49).
- D-01 stale text: [`WORKFLOW.md:735-743`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/WORKFLOW.md#L735-L743)
  and [`WORKFLOW.md:874-879`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/WORKFLOW.md#L874-L879);
  advisory source:
  [`start-job-controller-policy.ts:12-31`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-controller-policy.ts#L12-L31);
  advisory tests:
  [`start-job-controller-guards.test.ts:146-176`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-controller-guards.test.ts#L146-L176).
- Baseline CI/release: exact `de36b867` completed
  [CI](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30186962467/job/89753288022),
  [Chrome smoke](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30186962465/job/89753288012),
  and [web deploy](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30187676911/job/89755180800).
  These checks validate that baseline as built/tested/deployed; they do **not** validate the
  uncommitted A-01/A-02 candidate.
- Latest-main CI at this checkpoint: exact `9aad1207`
  [full CI passed](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190007099/job/89761479051),
  [Chrome smoke passed](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190007104/job/89761479259),
  and [`pnpm audit` passed](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190793272/job/89763589150).
  The exact commit's
  [web deployment passed](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190558190/job/89762946652),
  making this commit release-confirmed for the web bundle. These green jobs contain the verified
  blockers and are not proof of a candidate fix or physical-machine behavior.

## Read-only process self-audit

| Control | Result | Evidence / remediation |
|---|---|---|
| Repository and baseline identity | PASS | Canonical repo is `continuous-audit-source`; branch HEAD is `de36b867`; refreshed `origin/main` is `9aad1207`; relevant Start objects are unchanged. |
| Scope boundaries | PASS | Only audit ledgers and a disposable external probe were written; no repository product file was changed after read-only mode resumed. |
| Evidence labels and links | PASS after remediation | A-01/A-02/D-01 now separate source, reproduction, CI, release, and hardware evidence. Earlier wording that could imply candidate correctness was narrowed. |
| Master-ledger synchronization | PASS after remediation | Stable Start IDs are synchronized with the shared ledger; D-01 is documentation-only and distinct from live blockers. |
| Historical artifact reconciliation | PASS | Exact-name `out`/`outputs` inventory, exclusions, deduplication, and unmapped result are recorded in the shared ledger. |
| Uncommitted-work quarantine | PASS | Working-tree product/test paths match the pre-read-only inventory and remain unstaged, uncommitted, and explicitly not to be applied. |
| No product-code/publication/hardware action | PASS with disclosure | No repo product edit, commit, push, PR, merge, deploy, controller command, or hardware action occurred. Disposable exact-main tests were created under the system temp directory solely to reproduce behavior and were removed after each run. |

## Recovery, persistence, and final-handoff checkpoint

This slice found **no additional verified accidental ordinary-Start blocker**. A-01 and A-02 remain
the only source-confirmed ordinary completed-Frame blockers; A-03 below is a distinct completed-job
replay blocker. The remaining recovery/handoff conditions classify as follows:

| Condition | Classification | Current-main evidence |
|---|---|---|
| An isolated interrupted-job capsule exists | Valid non-blocking advisory | Ordinary Start does not consult the capsule as an authorization gate; the recovery card says it is isolated, and the exact-main test starts a different job despite a 118,035-line capsule. |
| Fresh-run artifact storage is unavailable | Valid non-blocking advisory | Staging catches persistence failure and returns `false`; Start continues, then warns that recovery/archive is unavailable. |
| A different pending Start owns the durable handoff | Valid integrity stop | Only a successfully staged artifact can arm; a conflicting live owner blocks duplicate handoff. The ownership lease is bounded to five seconds and stale/future-skewed state reconciles into an uncertain recovery capsule. |
| Permit, execution signature, output scope, placement, registration, camera/rotary environment, or completed receipt changes during staging | Valid exact-artifact stop | Authorization is repeated after staging and synchronously again after the controller's last asynchronous fence, before streamer creation or the first program write. |
| Controller session, reported position, WCO/origin, trusted-position epoch, or Work-Z evidence changes | Valid safety-critical stop | Ordinary claimed Start ignores advisory settings/build-info refresh but retains physical/session evidence checks. |
| Recovery claim/package/qualification/arming changes or cannot be durably bound | Valid recovery-integrity stop | Recovery uses separate claim, sealed artifact, package, operator qualification, and final live-controller assertions; failure sends zero recovery G-code. |
| Initial transport write rejects or has uncertain acceptance | Valid transport stop; physical consequence hardware-only | The store enters fail-dark containment and does not replace the older recovery capsule. Web Serial proves only the browser write-promise/backpressure boundary, not controller parsing or physical motion. |
| Recovery activation/archive persistence fails after the first Start write is accepted | Valid non-blocking advisory | The accepted job remains running; tracking is marked unavailable and the operator receives an explicit warning. |

The official GRBL interface requires response-ordered `ok`/`error` accounting, distinguishes
asynchronous push messages, and documents character-counted RX tracking. That supports retaining
the queue fence, pending-ack drain, and maximum-line-size checks. It does not prove USB delivery,
firmware execution, beam/spindle state, or physical motion on any connected machine.

### Checkpoint source and test links

- Best-effort ordinary persistence:
  [`start-job-execution-tracking.ts:73-160`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-execution-tracking.ts#L73-L160).
- Staging, arming, re-authorization, and cleanup:
  [`start-job-flow.ts:289-371`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-flow.ts#L289-L371).
- Final synchronous handoff and cleanup:
  [`start-job-transmission.ts:44-83`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-transmission.ts#L44-L83)
  and
  [`start-job-authorization.ts:43-89`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-authorization.ts#L43-L89).
- Controller queue fence, final caller assertion, permit consumption, streamer creation, and first
  write:
  [`laser-job-actions.ts:111-207`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-job-actions.ts#L111-L207).
- Durable handoff lease and reconciliation:
  [`recovery-start-handoff.ts:40-123`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/recovery/recovery-start-handoff.ts#L40-L123).
- Ordinary persistence/isolation tests:
  [`start-job-flow.test.ts:281-386`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-flow.test.ts#L281-L386).
- Staging/final-boundary race tests:
  [`start-job-recovery-intent.test.ts:181-280`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-recovery-intent.test.ts#L181-L280).
- Durable handoff tests:
  [`recovery-start-handoff.test.ts:57-177`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/recovery/recovery-start-handoff.test.ts#L57-L177).
- Primary protocol/platform references:
  [official GRBL interface](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md)
  and [Web Serial specification](https://wicg.github.io/serial/#writable-attribute).

## Completed-job replay and transient-camera checkpoint

These are separate contracts. A completed-job replay is not an ordinary claimed-Frame Start: it is
offered only while a sealed completion receipt still matches the current execution signature, then
freshly compiles, fingerprint-checks, reviews, stages, authorizes, and streams a new run from line
one. Transient camera work performs a fresh immutable-project review and physical Frame before
claiming that exact transient permit.

| Condition | Classification | Current-main evidence |
|---|---|---|
| Completed receipt, current execution signature, freshly compiled bytes/fingerprint, placement/registration, external camera/rotary state, or durable receipt ownership changes | Valid exact-artifact stop | Replay checks the receipt before offering, after compilation, after review, after staging/refresh, and at the final synchronous queue fence. Existing tests require canvas drift to invalidate replay. |
| Controller session, reported physical position, WCO/origin, trusted-position epoch, or Work-Z evidence changes during replay | Valid safety-critical stop | Final authorization compares those facts. The exact-main audit control changed reported `mPos` during staging and sent zero job calls. |
| Same-session, same-value advisory controller settings/observation or build-info references refresh during replay | **Accidental/overbroad block: A-03** | Replay does not carry a Frame claim, so `ignoreAdvisoryControllerEvidence` is false and reference identity is authoritative. The exact-main probe refreshed only equal settings/observation objects during staging; final authorization refused and `startJob` was never called. Build-info reference identity follows the same source branch; that half is source-confirmed but was not separately reproduced. |
| Transient camera Frame does not complete, permit is consumed/replaced, external environment changes, or controller session/position/origin/Work-Z changes | Valid exact-permit/safety stop | Transient Start claims the exact completion permit and repeats readiness synchronously inside the store's final assertion. Session and reported-position audit controls were refused. |
| Same-session advisory settings/build-info refresh after the transient camera Frame | Valid non-blocking advisory | Transient readiness explicitly ignores advisory controller evidence while retaining the session and physical checks. The exact-main audit probe completed Start authorization after settings/build-info refresh. |
| Transient camera `$32` unknown/disabled or other reviewed warnings | Valid operator advisory/acknowledgement | Current tests require the informed acknowledgement, preserve unrelated warnings, and send no bytes when the acknowledgement is declined. This is distinct from a silent Start blocker. |

A-03 should be fixed only for advisory evidence that is semantically unchanged. The audit does not
support ignoring a changed controller session, changed settings/build-info values, physical motion,
changed receipt/artifact, compile/materialisation failure, durable handoff conflict, transport
failure, or recovery boundary. Whether a factual advisory value change after Job Review may remain
non-blocking is a separate product-policy question and is not part of this finding.

### Special-path source and test links

- Replay offer and immutable receipt handoff:
  [`RunAgainControl.tsx:25-70`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/RunAgainControl.tsx#L25-L70).
- Fresh compile, fingerprint check, Job Review, authorization, and staging:
  [`start-job-flow.ts:159-250`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-flow.ts#L159-L250)
  and
  [`start-job-flow.ts:289-347`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-flow.ts#L289-L347).
- Replay signature/fingerprint/receipt currentness:
  [`start-job-execution-tracking.ts:28-70`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-execution-tracking.ts#L28-L70).
- A-03 comparison mechanism:
  [`start-job-authorization.ts:43-89`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-authorization.ts#L43-L89)
  and
  [`start-job-authorization.ts:92-132`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-authorization.ts#L92-L132).
- Checked-in completed-replay tests:
  [`start-job-flow.test.ts:389-443`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-flow.test.ts#L389-L443).
- Transient physical Frame, exact permit claim, and final assertion:
  [`transient-camera-job.ts:37-46`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/camera/align-wizard/transient-camera-job.ts#L37-L46),
  [`transient-camera-job.ts:157-204`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/camera/align-wizard/transient-camera-job.ts#L157-L204),
  and
  [`framed-run-readiness.ts:12-48`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/framed-run-readiness.ts#L12-L48).
- Checked-in transient tests:
  [`transient-camera-job.test.ts:140-297`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/camera/align-wizard/transient-camera-job.test.ts#L140-L297)
  and
  [`use-frame-action.transient-frame.test.ts`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/use-frame-action.transient-frame.test.ts).

## Cancellation, Abort, and reconnect checkpoint

This slice found **no additional accidental Start-authorization blocker**. Queue ownership, explicit
Abort, disconnect, reconnect, and late old-session completion are valid integrity/safety stops. It
did verify U-01, a separate keyboard escape-path inconsistency during the final fence.

| Condition | Classification | Current-main evidence |
|---|---|---|
| Pending non-job transport write or terminal acknowledgement before Start | Valid queue-integrity stop | The store reserves transport and acknowledgement ownership before awaiting the adapter, suppresses background polling while Start owns the fence, waits up to 1.5 seconds for convergence, and sends no program bytes if the queue remains unsettled. This prevents an old `ok` from advancing the new stream. |
| Operator clicks visible `ABORT MOTION` during `start-arming` | Valid deliberate stop | `LiveMotionBar` mounts for the controller operation and calls `stopJob`. The exact-main probe aborted while Start waited for an older acknowledgement, invalidated the controller/Frame evidence, and wrote zero program lines. GRBL uses reset/fail-dark cleanup; non-reset controllers retain an explicit unconfirmed-stop warning. Physical stop remains hardware-only. |
| Operator presses Ctrl+. during `start-arming` | **Accidental control-surface gap: U-01** | The shortcut handler checks only active streamer or motion operation, not the controller operation that mounted the visible Abort button. The exact-main probe observed no event claim and no `stopJob` call. This does not silently authorize Start—the visible button still works and the integrity gates remain—but it breaks documented keyboard Abort parity at the final fence. |
| Port closes or an operator replaces/reconnects the controller during the fence | Valid session/safety stop | Teardown advances the write epoch, cancels lifecycle owners, clears dead-session ledgers, increments controller/trusted-position/Work-Z epochs, and revokes the Frame permit. The exact-main reconnect control sent zero program bytes on both ports and refused the old Start reservation. |
| Reconnect handshake/settings read is incomplete | Valid connection-integrity stop | Connection handshake owns the controller operation and acknowledgement ledger; Start remains unavailable until its terminal acknowledgement settles. A reconnect cannot reuse the old Frame because teardown invalidates session and position evidence. |
| Old-session write completion/rejection or acknowledgement arrives after reconnect | Valid session-integrity containment | The captured write epoch prevents the late completion from decrementing or qualifying the replacement session's transport/ack ledger. Existing tests preserve the new session's owed acknowledgement and disconnected streamer ownership. |
| Initial program write rejects or port closes after streamer creation | Valid fail-dark transport containment; physical consequence hardware-only | Host stream ownership is cancelled/quarantined, reset/de-energize cleanup is attempted, pending recovery handoff is not promoted, and a persistent safety notice remains. Web Serial promise rejection cannot prove whether the controller physically accepted bytes. |
| Disconnect-during-arming safety notice survives reconnect | Valid non-blocking advisory | A successful serial open deliberately preserves an unacknowledged safety notice. It does not restore the Frame or old Start authority and is not consulted as a new Start veto. |

U-01 should not change the queue fence or make reconnect inherit a permit. Its implementation scope
is only to make Ctrl+. invoke the same `stopJob` path already exposed by `LiveMotionBar` while
`controllerOperation.kind === 'start-arming'`. Tests should prove modal/editable-target bypass,
single dispatch, zero program bytes, permit/recovery cleanup, and unchanged behavior for idle Ctrl+.

### Cancellation/reconnect source and test links

- Queue fence, final synchronous assertion, first write, and Abort:
  [`laser-job-actions.ts:111-207`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-job-actions.ts#L111-L207)
  and
  [`laser-job-actions.ts:209-271`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-job-actions.ts#L209-L271).
- Transport/ack queue identity and refusal copy:
  [`laser-start-queue-fence.ts:1-25`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-start-queue-fence.ts#L1-L25).
- U-01 visible Abort versus keyboard shortcut:
  [`LiveMotionBar.tsx:24-60`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/LiveMotionBar.tsx#L24-L60),
  [`LiveMotionBar.tsx:128-147`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/LiveMotionBar.tsx#L128-L147),
  and
  [`use-job-shortcuts.ts:19-50`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/use-job-shortcuts.ts#L19-L50).
- Write reservation and session-epoch quarantine:
  [`laser-safe-write.ts:51-118`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-safe-write.ts#L51-L118)
  and
  [`laser-safe-write.ts:138-163`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-safe-write.ts#L138-L163).
- Session teardown and reconnect invalidation:
  [`laser-connection-teardown.ts:161-194`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-connection-teardown.ts#L161-L194),
  [`laser-disconnected-state.ts:7-45`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-disconnected-state.ts#L7-L45),
  and
  [`laser-connection-actions.ts:233-252`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-connection-actions.ts#L233-L252).
- Checked-in queue/session/containment tests:
  [`laser-store-untracked-ack-guard.test.ts:107-264`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-store-untracked-ack-guard.test.ts#L107-L264),
  [`laser-store-untracked-ack-guard.test.ts:312-379`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-store-untracked-ack-guard.test.ts#L312-L379),
  [`laser-safe-write-epoch.test.ts:110-172`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-safe-write-epoch.test.ts#L110-L172),
  [`laser-connection-epoch.test.ts:113-187`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-connection-epoch.test.ts#L113-L187),
  and
  [`laser-active-job-write-containment.test.ts:136-247`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-active-job-write-containment.test.ts#L136-L247).

## Controller-family and panic-shortcut coverage checkpoint

This slice found **no new accidental blocker that withholds a valid completed Frame**. The ordinary,
replay, and transient paths all preserve their previously classified Frame/artifact/session/queue
boundaries. It did strengthen U-01 with a checked-in coverage inventory and reproduce a separate
missing safety/integrity boundary already tracked as cross-stream `CS-01`.

### Controller-family matrix

| Configured family | Current app contract | Ordinary / replay / transient Start consequence | Classification and evidence limit |
|---|---|---|---|
| GRBL v1.1 | Serial `grbl-live`; realtime `?`, hold, Safety Door, resume, Ctrl-X reset, jog cancel; configurable char-counted or ping-pong streaming; GRBL CNC enabled. | All three Start paths use the project streaming settings and the connected GRBL driver. Abort freezes host refill, sends Ctrl-X, then owns M5/M9 cleanup after the reset boundary. | Valid live family contract. GRBL primary docs support realtime control, ordered responses, and dwell synchronization. USB delivery, installed firmware, reset cleanup, output-off latency, and physical stop remain **hardware-only**. |
| grblHAL | Shares the GRBL driver runtime contract; strict stock `$I` build proof is disabled. | Same live Start/queue/reset path as GRBL in all three flows. | Source/simulator-confirmed app classification only. Actual grblHAL board/version/options and physical behavior remain **hardware-only**. |
| FluidNC | Shares GRBL realtime, streaming, jog, and reset; settings are read-only and strict stock `$I` proof is disabled. | Same live Start/queue/reset path as GRBL in all three flows. | Source/simulator-confirmed app classification only. Installed FluidNC lifecycle macros/startup behavior and physical output remain **hardware-only** and are separately tracked by the Controller systems stream. |
| Marlin | Serial `marlin-line`; forced ping-pong; queued `M114`; no realtime status/hold/resume/reset; `M400` settle; CNC disabled. | All three laser Start paths use one-line acknowledgement pacing. Abort stops host refill and queues M5/M107, while retaining an explicit unconfirmed-physical-stop notice. | Valid conservative contract. Marlin documents normal `M114` as projected position and `M112` as non-safety-rated and potentially queue-delayed without `EMERGENCY_PARSER`; source/simulator cannot prove a physical stop. |
| Smoothieware | Serial `smoothie-live`; forced ping-pong; realtime `?`, hold/resume, Ctrl-X; `M400` settle; CNC disabled. | All three laser Start paths use one-line pacing but retain realtime status/reset Abort. | Valid conservative contract. Smoothie documents `ok` as queued rather than finished and `M400` as the queue-empty acknowledgement. Installed firmware, reset/output semantics, and physical stop remain **hardware-only**. |
| Ruida | Declared `file-only`; no live jog/status/pause/reset/console; the UI disables Connect and says to export `.rd`. Preview preparation falls back to GRBL G-code. | **Cross-stream CS-01:** none of the three final Start paths asserts file-only transport or start-protocol compatibility. With a stale connected GRBL state, the exact-main probe handed the fallback G-code to live `startJob` for ordinary, completed-replay, and transient-permit Start. | Missing valid integrity boundary, not an overbroad blocker. Already deduplicated to master `CS-01`; physical Ruida/GRBL effects were not tested. Do not restore the old universal mismatch gate without the recorded maintainer decision. |

The same `preparedStartOptions`/`startJob` handoff is used after each path's distinct authorization:
ordinary Start adds the exact completed-Frame claim, replay adds the sealed receipt/fresh compile
fingerprint, and transient Start adds the reviewed completion-issued permit. The project chooses
the output dialect and streaming mode, while the connected store driver chooses response parsing,
realtime control, reset, and cleanup. Current final authorization snapshots do not bind
`activeControllerKind`, `capabilities.transport`, or `startProtocol`.

PR #169 / commit `ebbaf3dd` deliberately removed the earlier blanket controller-profile mismatch
refusal and added a test that profile switching does not require reconnect. That history explains
why this condition exists but does not qualify the file-only/live mismatch. The existing master
plan correctly requires a maintainer decision before any cross-family refusal and calls for
same-family uncertainty to remain advisory. Frame remains the ordinary spatial authority; a
controller transport/dialect equality check would be a separate exact-handoff boundary.

### U-01 checked-in coverage inventory

| Layer | Current checked-in coverage | Result |
|---|---|---|
| Shortcut unit tests | Ctrl+. active stream, modal stream, idle no-op, Frame/jog cancellation; Ctrl+Enter connection/editable-target behavior. | No `controllerOperation` or `start-arming` Ctrl+. case. |
| Live Motion component tests | Active job and a generic `probe` controller operation render Abort. | No `start-arming` render/click case on current main. |
| Start/queue unit tests | Queue-fence ownership, zero-byte refusal, permit races, and `start-arming` state are covered. | No keyboard event is joined to that state. |
| Playwright/browser | Exact Frame -> Start workflow and serial fixture behavior are covered. | Repository-wide inventory found no Ctrl+., `start-arming`, or panic-shortcut Abort scenario. |
| Exact-main disposable probe | Installed the real shortcut handler with `controllerOperation = start-arming`. | **Reproduced:** event not claimed; `stopJob` called zero times. |

Therefore U-01 is not merely missing E2E coverage: the current behavior is source-confirmed and
reproduced, while the coverage gap explains why exact-main full CI and browser smoke remain green.
A future fix needs a focused unit contract plus one browser/E2E scenario that holds Start in the
queue fence, presses Ctrl+., observes the same stop path as the visible button, and proves zero
program bytes. No such fix was made in this read-only loop.

### Current-main source, history, test, and primary documentation

- Family capability vocabulary:
  [`controller-capabilities.ts:33-54`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/core/controllers/controller-capabilities.ts#L33-L54).
- GRBL, grblHAL, and FluidNC drivers:
  [`grbl/driver.ts:37-88`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/core/controllers/grbl/driver.ts#L37-L88),
  [`grblhal/driver.ts:12-20`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/core/controllers/grblhal/driver.ts#L12-L20),
  and
  [`fluidnc/driver.ts:10-23`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/core/controllers/fluidnc/driver.ts#L10-L23).
- Marlin, Smoothieware, and Ruida drivers:
  [`marlin/driver.ts:25-79`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/core/controllers/marlin/driver.ts#L25-L79),
  [`smoothieware/driver.ts:25-75`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/core/controllers/smoothieware/driver.ts#L25-L75),
  and
  [`ruida/driver.ts:11-68`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/core/controllers/ruida/driver.ts#L11-L68).
- Forced one-line pacing:
  [`controller-streaming-mode.ts:4-21`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/core/devices/controller-streaming-mode.ts#L4-L21).
- Shared live handoff and transient handoff:
  [`start-job-transmission.ts:44-109`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-transmission.ts#L44-L109)
  and
  [`transient-camera-job.ts:157-196`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/camera/align-wizard/transient-camera-job.ts#L157-L196).
- File-only UI versus preview fallback:
  [`ControllerConnectionControls.tsx:27-100`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/ControllerConnectionControls.tsx#L27-L100)
  and
  [`select-output-strategy.ts:15-31`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/core/output/select-output-strategy.ts#L15-L31).
- Intentional mismatch policy and history:
  [`start-job-controller-compatibility.test.ts:54-89`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-controller-compatibility.test.ts#L54-L89)
  and [PR #169](https://github.com/cisgz3a-hub/KerfDesk/pull/169).
- U-01 checked-in unit coverage:
  [`use-job-shortcuts.test.ts:50-110`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/use-job-shortcuts.test.ts#L50-L110)
  and
  [`LiveMotionBar.test.tsx:154-170`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/LiveMotionBar.test.tsx#L154-L170).
- Current checked-in browser Frame -> Start contract:
  [`workbench.e2e.ts:321-358`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/e2e/workbench.e2e.ts#L321-L358).
- Primary protocol documentation:
  [official GRBL interface](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md),
  [Marlin M114](https://marlinfw.org/docs/gcode/M114.html),
  [Marlin M400](https://marlinfw.org/docs/gcode/M400.html),
  [Marlin M112 safety note](https://marlinfw.org/docs/gcode/M112.html),
  and [Smoothieware supported G-codes](https://smoothieware.github.io/Webif-pack/documentation/web/html/supported-g-codes.html).
- Exact `9aad1207` remains
  [CI-confirmed](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190007099/job/89761479051),
  [browser-smoke-confirmed](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190007104/job/89761479259),
  and
  [web-release-confirmed](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190558190/job/89762946652)
  as containing these current contracts. The green jobs neither exercise the missing Ctrl+.
  branch nor qualify any physical controller.

## Profile/controller drift and pre-program family-fence checkpoint

This slice found **no new accidental blocker that withholds a valid completed Frame**. It confirmed
that execution-relevant profile edits remain valid exact-artifact stops, advisory-only device
metadata remains the already verified A-02 overreach, and live identity compatibility remains the
missing boundary already tracked as cross-stream CS-01. It also distinguished an owned controller
fence write from a program write: a CNC Start can legitimately write `G4 P0.01`, `M400`, or `?` and
still refuse before creating a streamer or sending any job line.

| Condition between completed Frame and first program write | Classification | Current-main result |
|---|---|---|
| Project controller family, streaming mode, RX-buffer size, bed/envelope, emitted bytes, placement, or registration changes | Valid exact-artifact/transport stop | These inputs are part of the execution signature. Project subscriptions consume an ordinary permit on first drift, and the same signature is checked again synchronously after the final asynchronous controller fence. The exact-main probe confirmed four representative execution-relevant profile edits change the signature and a controller-family edit returns `execution-inputs-changed`. |
| Advisory/non-emission device metadata changes | **Accidental/overbroad block: A-02** | Current main still serializes the whole device profile, so advisory metadata can force reframe. This loop did not create a second finding or weaken the proposed allowlist-only remedy. |
| Open project/profile changes while an immutable transient-camera permit is being handed off | Valid non-blocking separation | The transient permit intentionally follows its captured project and bytes, not the unrelated open canvas. Its controller session/position/claim checks remain live. |
| Actual disconnect, reconnect, or welcome/reset banner after Frame | Valid session/safety stop | Connect selects a driver only as part of a new connection lifecycle. A welcome banner advances both write and controller-session epochs, clears status/origin/position evidence, and revokes the Frame permit. No old completed Frame survives. |
| Configured/active/detected family mismatch without a new session | Missing integrity boundary, not a blocker | Identity labels are not part of the Frame controller snapshot or final authorization comparator. The probe confirmed label-only mutation remains authorized while session drift refuses. This is the existing cross-stream CS-01, not a new Start-ledger item; real mismatches can arise when the wrong profile is selected at connect or the profile changes without reconnect. |
| GRBL, grblHAL, or FluidNC CNC final fence | Valid safety/transport stop | The shared GRBL-family contract sends the owned `G4 P0.01` settlement marker, then realtime `?`, and requires a fresh connected Idle report, unchanged setup epochs, no MPG owner, no Alarm, settled acknowledgements, and final exact authorization before the first program write. Controller error, timeout, reconnect, or non-Idle status refuses. |
| Marlin CNC final fence | Valid conservative transport/liveness stop; hardware/controller qualification unresolved | The driver advertises CNC unsupported and has no realtime status query. The store first owns `M400` to settle the queue, then refuses at the live-status boundary. The probe observed `M400`, the explicit fresh-status error, no `?`, no streamer, and zero program lines. This is not the demoted CNC-dialect warning silently regaining authority: the stop is triggered by absent causally fresh live status, not `cncJobsSupported === false`. Ordinary `M114` reports projected position and cannot safely substitute as global Idle proof. |
| Smoothieware CNC final fence | Valid non-blocking dialect warning followed by an **unverified hardware/controller condition** | `cncJobsSupported === false` remains Job Review-only. Because the driver exposes realtime `?`, the simulator crossed `M400` + fresh-Idle fencing and sent the first program line. This is source-confirmed/reproduced app behavior, not proof that installed Smoothieware mode, spindle timing, power scale, reset, or CNC dialect is safe; those limits are already covered by CS-03. |
| Ruida profile in the normal UI | Valid file-only product boundary; stale-live mismatch remains CS-01 | Connect is disabled and the UI directs export to `.rd`. If a stale serial connection survives a profile change, the missing final transport/family compatibility check remains the already reproduced CS-01 path, not an accidental refusal. |
| Any pre-program store exception | Valid error surface, subject to the classification above | `transmitPreparedStart` cancels a pending durable handoff, discards staged state, records a Start blocker, and shows a job-aware `Could not start job` alert. Authorization races use the narrower `Cannot start job` refusal surface. A zero-program-byte result can still include the owned settlement/status bytes described above. |

The Frame-first change in PR #286 explicitly demoted CNC dialect, override, accessory, Work-Z, and
other product-policy checks to Job Review warnings while retaining transport preconditions. Current
source follows that split: `cncJobsSupported === false` only appends a warning, whereas missing
realtime status, Alarm/not-Idle, MPG ownership, unsettled acknowledgements, controller-session
change, exact-artifact drift, and final handoff loss remain factual stops. PR #291 then added the
completion-issued permit and repeated final assertion; neither history authorizes treating a
completed Frame as controller-family or transport proof.

### Profile/family source, test, history, and primary documentation

- Whole-profile execution signature and repeated final authorization:
  [`canvas-motion-plan.ts:212-241`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/canvas-motion-plan.ts#L212-L241),
  [`start-job-authorization.ts:43-89`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-authorization.ts#L43-L89),
  and
  [`start-job-transmission.ts:44-121`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-transmission.ts#L44-L121).
- Store ordering from queue fence to first program write:
  [`laser-job-actions.ts:111-207`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-job-actions.ts#L111-L207)
  and CNC live-state refusals at
  [`cnc-live-start-readiness.ts:14-103`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/cnc-live-start-readiness.ts#L14-L103).
- Advisory-only CNC dialect policy:
  [`start-job-readiness-policy.ts:15-33`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-readiness-policy.ts#L15-L33).
- Real session/reset invalidation:
  [`laser-connect-action.ts:49-60`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-connect-action.ts#L49-L60)
  and
  [`laser-line-handler.ts:279-351`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-line-handler.ts#L279-L351).
- Current driver facts:
  [`grbl/driver.ts:37-88`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/core/controllers/grbl/driver.ts#L37-L88),
  [`marlin/driver.ts:25-79`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/core/controllers/marlin/driver.ts#L25-L79),
  [`smoothieware/driver.ts:25-75`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/core/controllers/smoothieware/driver.ts#L25-L75),
  and
  [`ruida/driver.ts:11-68`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/core/controllers/ruida/driver.ts#L11-L68).
- Intentional mismatch policy:
  [`start-job-controller-compatibility.test.ts:54-89`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-controller-compatibility.test.ts#L54-L89)
  and [PR #169](https://github.com/cisgz3a-hub/KerfDesk/pull/169).
- Frame-first history:
  [PR #286](https://github.com/cisgz3a-hub/KerfDesk/pull/286) retained factual transport and
  handoff preconditions while demoting policy warnings; [PR #291](https://github.com/cisgz3a-hub/KerfDesk/pull/291)
  introduced the completion-issued permit and final synchronous assertion.
- Primary controller evidence:
  the [official GRBL interface](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md)
  documents ordered terminal responses, realtime `?`, and `G4 P0.01` planner synchronization;
  [Marlin M400](https://marlinfw.org/docs/gcode/M400.html) waits for planner completion while
  [Marlin M114](https://marlinfw.org/docs/gcode/M114.html) normally reports projected position;
  the [Smoothieware supported-G-code reference](https://smoothieware.github.io/Webif-pack/documentation/web/html/supported-g-codes.html)
  documents `M400` as waiting for an empty queue before `OK`.
- Verification result: **reproduced** on a disposable exact-`9aad1207` snapshot, 19 files /
  224 tests passed, including eight targeted profile/family assertions. Exact main remains
  **CI-confirmed** and **web-release-confirmed** through the previously recorded jobs as containing
  the audited behavior. Neither local tests nor hosted checks qualify controller hardware.
- Shared-ledger synchronization: no new Start entry was added. Profile metadata remains
  START-AUTH-A-02; label/transport mismatch remains CS-01; Smoothieware dialect qualification and
  Marlin status truth remain CS-03/CS-04. The master plan therefore remains deduplicated.

## Barrier failure, ownership cleanup, and retry checkpoint

This slice found **one distinct accidental blocker, A-04**. It does not challenge the CNC queue or
fresh-status fences: a failed settle marker still must stop the current Start, and no program line
may be sent. The defect is the unrelated destruction of a completed physical Frame after a
causally owned, non-motion GRBL settlement line is rejected.

| Barrier event | Classification | Exact-main result |
|---|---|---|
| Owned GRBL `G4 P0.01` returns `error:20` | **Valid current-attempt transport stop plus accidental/overbroad reframe: A-04** | The semantic command owner rejects immediately; `startJob` never creates a streamer or sends program bytes. The shared `handleErrorLine` then clears both permit fields without checking that the rejected owned line is the non-motion Start settlement marker. Ordinary Start must Frame again. A completed-replay probe cleaned the pending/staged handoff and retained its receipt, but its next preparation still failed the ordinary Frame requirement because retained verification had been erased. |
| Owned settle command receives `ALARM:N`, or the status query produces an Alarm state | Valid safety-critical stop | Alarm advances the write epoch, clears controller/origin/position/Work-Z and Frame authority, zeroes dead acknowledgement ownership, cancels lifecycle owners, and sends zero program bytes. Another Frame is required after the controller is safely recovered. |
| Owned `G4`/`M400` acknowledgement never arrives | Valid queue-integrity stop | The semantic command times out before program bytes. The newline acknowledgement remains quarantined, the completed Frame remains spatially valid, pending/staged persistence is cleaned, and retry stays blocked until the late terminal response settles or reconnect clears the old epoch. The probe delivered the late `ok`; the same permit then crossed a clean fence and started. |
| Realtime `?` produces no fresh status | Valid controller-liveness stop | The attempt refuses after three seconds, with no program bytes and no outstanding acknowledgement. The permit, position, and session remain unchanged, persistence is cleaned, and a later clean status response allows retry without Frame. |
| An `error:N` appears after realtime `?` | Unverified controller/error-causality condition; current attempt must stop | GRBL documents `?` as a realtime query outside the line-response FIFO, so the app cannot safely claim that an `error:N` is its response. Current source records the raw error in the persistent controller-error notice, then times out the fresh-status fence and clears the permit through the same global error handler. This loop does **not** recommend retaining authority for that ambiguous case. |
| Visible Abort during settle wait | Valid deliberate reset/safety stop | `stopJob` sends the family reset/stop path, clears Frame authority, and a GRBL welcome boundary cancels the semantic owner. The ordinary pending/staged handoff is cleaned and no program bytes are sent. Physical stop latency and output-off remain hardware-only. U-01 still tracks only the missing Ctrl+. parity. |
| Welcome/reboot or reconnect while settle/status is owned | Valid session-integrity stop | Teardown/welcome advances ownership epochs, cancels lifecycle refs, invalidates controller/position/origin evidence and the Frame permit, and cleans ordinary persistence. Previous exact-main reconnect probes also proved that late old-session completion cannot authorize the replacement port. |
| Ordinary/replay persistence after any pre-program exception | Valid cleanup | `transmitPreparedStart` cancels the durable `pendingStart`, discards the staged artifact, leaves no `activeRun`, records a display-only persistent Start blocker, and opens a job-aware `Could not start job` alert. The blocker banner itself authorizes nothing and clears on the next attempt or project edit. |
| Transient-camera pre-program exception | Valid claim/error cleanup | The transient path has no durable staged artifact; it catches the same store rejection, reports `Could not burn camera markers`, and releases the exact permit claim in `finally`. A-04 still destroys that permit on the owned GRBL error, forcing another transient physical Frame. This consequence is source-confirmed; the exact-main runtime probe covered ordinary and replay. |
| Marlin `M400` / Smoothieware `M400` error vocabulary | Unverified hardware/controller condition | The shared store ordering is source-confirmed, but Marlin text errors and Smoothieware's collapsed error/halt markers do not provide the same narrow GRBL `error:N` semantics. Preserve their current refusal and permit invalidation until a qualified controller-specific distinction exists. `Resend` remains a valid protocol-desynchronization invalidation for every path. |

### A-04 scope and evidence boundary

The [official GRBL interface](https://github.com/gnea/grbl/blob/master/doc/markdown/interface.md)
defines `G4 P0.01` as the queue-empty synchronizer and separately states that `error:X` purges the
rejected line without executing anything inside it. Therefore:

- the failed Start cannot continue because queue-empty proof was not obtained;
- rejection of the owned, non-motion marker does not itself report motion, reset, Alarm, session
  replacement, WCO/origin drift, or position drift; and
- requiring the operator to resolve the controller error is valid, while requiring another
  physical Frame for unchanged spatial facts is the overreach.

The future implementation boundary is deliberately narrower than `handleErrorLine` generally:
retain Frame authority only for a causally owned GRBL Start settlement error with no stream or
motion owner and unchanged live session/status/position/origin evidence. Do not preserve on Alarm,
Sleep, reset/welcome, disconnect/reconnect, `Resend`, stream or Frame/Jog line rejection, reported
motion/state drift, ambiguous status-query errors, or unqualified Marlin/Smoothie error classes.
The operator must still see the raw controller error and the current attempt must still cleanly
refuse before program bytes.

### Barrier source, test, CI, and release evidence

- Store ordering and exact first-program boundary:
  [`laser-job-actions.ts:111-207`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-job-actions.ts#L111-L207).
- Semantic timeout/error ownership:
  [`laser-interactive-command.ts:115-230`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-interactive-command.ts#L115-L230).
- Global routing and overbroad permit clearing:
  [`laser-line-handler.ts:87-122`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-line-handler.ts#L87-L122)
  and
  [`laser-error-line.ts:15-47`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-error-line.ts#L15-L47).
- Current checked-in test intentionally locks the broad expiration:
  [`laser-error-line.test.ts:293-334`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-error-line.test.ts#L293-L334);
  the existing positive-fence/reboot tests stop at zero program bytes and do not assert permit or
  retry behavior
  ([`laser-store-tool-change.test.ts:226-257`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-store-tool-change.test.ts#L226-L257)).
- Fresh status and Alarm boundaries:
  [`cnc-live-start-readiness.ts:26-102`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/cnc-live-start-readiness.ts#L26-L102),
  [`laser-status-line.ts:143-175`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-status-line.ts#L143-L175),
  and
  [`laser-line-handler.ts:403-441`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-line-handler.ts#L403-L441).
- Durable staging/error cleanup:
  [`start-job-flow.ts:289-345`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-flow.ts#L289-L345)
  and
  [`start-job-transmission.ts:44-83`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-transmission.ts#L44-L83).
- Replay's default Frame preparation and transient claim cleanup:
  [`start-job-source.ts:41-90`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-source.ts#L41-L90),
  [`start-job-flow.ts:175-208`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-flow.ts#L175-L208),
  and
  [`transient-camera-job.ts:157-204`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/camera/align-wizard/transient-camera-job.ts#L157-L204).
- **Reproduced:** final disposable exact-main probe 9/9; broader run 14 files / 132 tests. The
  exact-main checked-in test suite passed while affirmatively expecting every `error:20` to expire
  a completed permit, so green tests encode the overbroad contract rather than refute A-04.
- **CI-confirmed / release-confirmed as containing the behavior:** exact `9aad1207` passed
  [full CI](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190007099/job/89761479051),
  [Chrome smoke](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190007104/job/89761479259),
  [`pnpm audit`](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190793272/job/89763589150),
  and the
  [web deploy](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190558190/job/89762946652).
  Those jobs do not qualify physical controllers or validate a future fix.

## Adapter rejection, late reply, reconnect, and browser-coverage checkpoint

This follow-up **did not find another accidental Start blocker**. It separates A-04's confirmed
controller-terminal overreach from the valid queue quarantine required after an adapter rejects a
write whose physical delivery is ambiguous.

| Event | Classification | Exact-main result |
|---|---|---|
| Adapter rejects the owned GRBL `G4 P0.01\n` write | **Valid current-attempt stop and queue-integrity quarantine; not a reframe condition** | `safeWrite` has already reserved one terminal acknowledgement before awaiting the adapter. Rejection retires transport ownership but deliberately keeps that acknowledgement debt because the line may have reached the controller. The completed Frame remains present, no streamer/program byte exists, and an immediate retry refuses with `Controller queue is not settled`. A late `ok` consumes only the quarantine and leaves the same Frame permit intact. |
| Controller returns owned `error:20` for accepted `G4 P0.01\n` | **Valid current-attempt stop plus A-04 accidental/overbroad reframe** | The terminal reply consumes the owned acknowledgement and rejects the semantic fence with no program bytes. Unlike adapter rejection, global error routing also clears the completed Frame. This is the already-deduplicated A-04 defect, not a new finding. |
| Adapter rejects GRBL realtime `?` | **Valid controller-liveness stop; not an acknowledgement or reframe condition** | `?` is outside the newline FIFO, so the rejected query creates no terminal-ack debt. The attempt refuses, transport returns to zero, and the completed Frame remains intact for a clean retry. An `error:N` observed after `?` remains causally ambiguous and is still deferred. |
| Adapter rejects Marlin/Smoothieware `M400` | **Source-confirmed queue quarantine; controller-terminal meaning remains unverified** | The same `safeWrite` and semantic-command code owns the newline and therefore retains one ack on adapter rejection independent of controller family. `M400` is the selected settle marker for both drivers. This loop did not reproduce or hardware-qualify either family's terminal error vocabulary, so it does not extend A-04 beyond GRBL. |
| Disconnect/reconnect before an old late response or adapter completion | **Valid session-integrity invalidation with correct containment** | Teardown increments the write epoch, cancels semantic owners, unsubscribes old line/close callbacks, clears dead-session acknowledgement debt, and invalidates old Frame authority. A disposable probe installed a new-session permit and then emitted `error:20` plus `ok` on the old port; neither touched the replacement state. Checked-in tests also prove a late old-session write rejection cannot subtract a new-session ack or let old callbacks mutate the replacement connection. |
| Browser/E2E coverage of A-04 | **Coverage gap attached to A-04; not a separate product blocker** | Existing browser tests cover completed Frame through successful Start and later Alarm/disconnect recovery, but none exercises completed Frame -> owned pre-program settle rejection -> zero program bytes -> raw error/cleanup -> retry. The browser fixture can inject a raw controller line, but its writable always resolves and it has no payload-scoped adapter-rejection control. Therefore green Browser smoke does not cover A-04 or the adapter-versus-terminal distinction. |

### Current-main source and test evidence

- **Source-confirmed:** [`laser-safe-write.ts:80-100`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-safe-write.ts#L80-L100)
  reserves transport and FIFO response ownership before the first await;
  [`laser-safe-write.ts:138-160`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-safe-write.ts#L138-L160)
  retires only transport ownership after an ambiguous adapter rejection.
- **Source-confirmed:** Start feeds the active driver's `settleDwell` into the same semantic owner
  ([`laser-job-actions.ts:173-207`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-job-actions.ts#L173-L207));
  current driver tests lock GRBL `G4 P0.01`, Marlin `M400`, and Smoothieware `M400`
  ([GRBL](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/core/controllers/grbl/driver.test.ts#L25-L32),
  [Marlin](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/core/controllers/marlin/marlin-driver.test.ts#L117-L124),
  [Smoothieware](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/core/controllers/smoothieware/smoothieware-driver.test.ts#L110-L115)).
- **Source-confirmed:** replacement-session isolation is implemented at
  [`laser-connection-teardown.ts:161-194`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-connection-teardown.ts#L161-L194).
- **Reproduced:** a disposable exact-main `9aad1207` comparison passed 4/4: queued adapter
  rejection retained Frame plus one ack; retry stayed blocked until late `ok`; controller
  `error:20` consumed the ack and reproduced A-04; rejected realtime `?` retained Frame with zero
  ack; and old-port terminal replies were ignored after replacement. The disposable snapshot was
  removed after the run.
- **Reproduced:** checked-in exact-main ownership/recovery suites passed 6 files / 67 tests:
  `laser-safe-write-epoch`, `laser-connection-epoch`, `laser-store-untracked-ack-guard`,
  `laser-store-tool-change`, `start-job-recovery-intent`, and `laser-store-frame-races`. These
  include old-epoch completion isolation, old-session rejection isolation, queue-drain refusal,
  terminal fence refusal, staging/recovery preservation, and generic ambiguous-write quarantine.
- **Source-confirmed browser gap:** the fixture's write method always records and resolves
  ([`browser-apis.js:39-45`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/e2e/fixtures/browser-apis.js#L39-L45));
  its exposed controls are line injection, setting mutation, acknowledgements, disconnect, and
  auto-ack only
  ([`kerfdesk-test.ts:14-22`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/e2e/fixtures/kerfdesk-test.ts#L14-L22),
  [`browser-apis.js:208-221`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/e2e/fixtures/browser-apis.js#L208-L221)).
  The completed-Frame browser path is happy-path only
  ([`workbench.e2e.ts:324-358`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/e2e/workbench.e2e.ts#L324-L358));
  the production Alarm scenario occurs after Start/Stop rather than at the owned pre-program fence
  ([`production-workflows.spec.ts:442-488`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/e2e/production-workflows.spec.ts#L442-L488)).
- **CI-confirmed / release-confirmed as containing the behavior:** refreshed exact-head results
  remain green for
  [full CI](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190007099),
  [Browser smoke](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190007104),
  [Dependency audit](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190793272), and
  [web deploy](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190558190).
  The fixture/coverage inventory explains why green Browser smoke does not contradict A-04.

## A-04 operator-visible surfaces and implementation-ready browser seams

This slice found **no additional accidental Start-authorisation blocker**. It verified that the
existing A-04 terminal-error invalidation is visible as an unnecessary reframe, while the separate
adapter-rejection acknowledgement quarantine remains a valid wire-integrity stop that is currently
under-signalled in the Start control. Neither persistent banner is itself a gate.

### Surface matrix

| Surface or transition | Current exact-main behavior | Classification |
|---|---|---|
| Job Review at the pre-program fence | Confirm closes Job Review before `startJob` enters the CNC settlement fence. A later terminal or adapter failure does not leave the review dialog open. Ordinary permit review evidence is returned to the caller but is not written back into the permit, so a legitimate retry asks for a fresh review; a transient-camera permit already carries its review. | Valid conservative acknowledgement; not a hidden Start gate. |
| Native failure alert | With no streamer created, both ordinary/replay terminal failure and adapter rejection use a native alert: `Could not start job: ...`. The transient-camera path instead alerts `Could not burn camera markers: ...`. At this boundary no job exists, so the blocking alert does not suppress an active Abort control. | Valid operator error surface, not authorization. |
| `Last Start attempt blocked` banner | Ordinary and completed-replay transmission store the raw thrown message beside Start. The banner's own source contract says it is display-only and gates nothing. A fresh Start, Frame, or project edit clears it. The transient-camera path does **not** report this banner. | Valid non-blocking advisory. |
| `Controller rejected a command` safety banner | Owned `error:20` records a persistent controller-error notice including `Rejected line: G4 P0.01` and cautious Idle/home-if-uncertain guidance. It offers acknowledgement, but not reconnect for a still-connected Idle controller. Dismissing the warning clears only the warning; it never restores or revokes Frame authority. Adapter promise rejection for this action has no safety action tag, so it records `lastWriteError`/log but creates no safety banner. | Valid non-blocking safety advisory; retain it in any A-04 fix. |
| Ordinary Start after owned terminal `error:20` | Global error routing clears `framedRun` and `frameVerification`. After the alert closes and `controllerOperation` releases, the button is enabled but changes to `Set up & Frame`; status reads `Not framed — prepare and Frame this job first`. Clicking it clears the display-only Start banner and dispatches Frame. | **A-04 accidental/overbroad reframe.** The missing permit, not either warning, is the actual block. |
| Ordinary Start after adapter rejection | The completed permit remains ready. After the alert, Start is enabled and still reads `Start framed job`; status remains `Ready to start — framed job unchanged`. If the owed response has not arrived, the next click clears the prior banner, reopens Job Review, then the real queue fence waits and refuses with `Controller queue is not settled`. A late same-session `ok` releases only that quarantine, after which the same Frame can be reviewed and retried. | Valid transport/response containment with an under-signalled temporary block. Do not bypass it and do not classify it as A-04. |
| Completed replay after terminal `error:20` | The immutable completed receipt remains eligible, so `Run same job again from start` remains visible. The lost `frameVerification` makes the next replay preparation offer another physical Frame before review. | Same A-04 reframe expressed through the replay repair offer; the replay button itself is not proof of readiness. |
| Transient camera Start after terminal `error:20` | The specialized path returns `false`, shows the camera-marker alert plus the shared controller-error safety banner, and returns the alignment wizard from `burning` to `setup` with `The burn did not start...`. It does not use the shared Start-blocker store or durable fresh-run staging. Because the transient reviewed permit was globally cleared, retry repeats review and physical Frame. | Same A-04 reframe with a distinct, source-confirmed surface; existing tests do not cover a real terminal failure here. |

The temporary adapter quarantine is intentionally not folded into `framedRunReadinessIssue`: it is
wire/session state rather than spatial evidence. The current enabled `Start framed job` button is
therefore truthful about Frame validity but incomplete about immediate dispatchability. A future UX
improvement may expose `Waiting for 1 controller response` or disable Start while the debt is live,
but it must not clear the debt, consume the permit, or imply that a new physical Frame resolves it.
This observation remains attached to A-04's coverage plan rather than becoming a removal candidate.

### Implementation-ready test seams

1. **Owned terminal error — no fixture change required.** Add a CNC browser fixture/project that
   can establish Work Z, connect/home, and complete the exact Frame. Immediately before confirming
   Job Review, call existing `setAutoAcknowledge(false)`, wait for exact
   `G4 P0.01\n`, then use existing `emitSerialLine('error:20')`. Capture and accept the native
   dialog. Assert:
   - Job Review is closed and the alert contains `Could not start job` plus `error:20`;
   - the Start-blocker banner contains the raw terminal response;
   - the safety banner says `Controller rejected a command` and names `G4 P0.01`;
   - no streamer/Abort/Pause control or program payload appears after the owned fence;
   - the current regression is `Set up & Frame`/`Not framed`; the corrected contract is retained
     `Start framed job`/`Ready to start`;
   - acknowledgement of the safety banner changes no permit/button state; and
   - a clean retry performs another Job Review, obtains a successful settle plus fresh Idle, and
     sends the first program line without another Frame.

2. **Adapter rejection — add one exact-payload fixture fault.** Extend the fixture API with a
   one-shot control such as
   `rejectNextSerialWrite({ exactText: 'G4 P0.01\n', message: 'fixture adapter rejected dwell' })`
   and record a `serial-write-rejected` event. Assert the native alert and display-only Start banner,
   absence of the controller-error safety banner, zero program bytes, retained
   `Start framed job`, and a real queue refusal while the acknowledgement debt remains.

   The current fixture uses a standards-backed `WritableStream`. Rejecting its sink `write()`
   errors that stream permanently, so that version can qualify only the failure surface plus
   reconnect invalidation. It **cannot honestly prove a usable same-session writer after a late
   `ok`**. Keep same-session late-response/retry proof in the existing store-level
   `FakeConnection`, or deliberately replace the browser fixture's writable with an
   application-boundary writer double implementing the exact methods KerfDesk consumes. Label the
   latter as an app-adapter test, not Web Serial conformance.

3. **Recovery/persistence stays below the browser seam.** The shared ordinary/replay transmission
   already cancels the pending handoff and discards staging before reporting the error; transient
   camera does not create that durable handoff. Keep exact repository cleanup assertions in focused
   integration tests rather than inferring cleanup from a hidden browser store. A browser test may
   additionally assert that no interrupted-job recovery card appears, but that is supporting
   evidence, not a substitute for repository-state assertions.

4. **Negative controls remain separate and mandatory.** Reuse or add browser cases proving Alarm,
   reset/welcome, disconnect/reconnect, position/WCO/Work-Z drift, Frame/Jog/program-line error, and
   final artifact/handoff changes still revoke or stop. Do not reuse the qualified GRBL
   `G4 P0.01` exception for realtime `?`, Marlin/Smoothieware text errors, or any active motion/job
   owner.

### Evidence and verification

- **Source-confirmed:** shared cleanup, raw Start blocker, and alert:
  [`start-job-transmission.ts:44-83`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-transmission.ts#L44-L83);
  display-only banner contract:
  [`start-blocker-invalidation.ts:1-32`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-blocker-invalidation.ts#L1-L32)
  and
  [`StartBlockerNotice.tsx:3-15`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/StartBlockerNotice.tsx#L3-L15).
- **Source-confirmed:** Job Review closes on confirmation before transmission:
  [`job-review-gate.ts:66-99`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/job-review/job-review-gate.ts#L66-L99);
  ordinary review evidence is returned rather than persisted:
  [`framed-run-start-review.ts:24-60`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/framed-run-start-review.ts#L24-L60).
- **Source-confirmed:** controller-error invalidation and rejected-line capture:
  [`laser-error-line.ts:14-47`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-error-line.ts#L14-L47);
  command-context copy:
  [`laser-safety-notice.ts:197-238`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/state/laser-safety-notice.ts#L197-L238);
  safety actions:
  [`SafetyNoticeBanner.tsx:12-83`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/SafetyNoticeBanner.tsx#L12-L83).
- **Source-confirmed:** button/status derive from Frame readiness, while button disabling derives only
  from active job/motion/controller ownership:
  [`JobControls.tsx:69-115`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/JobControls.tsx#L69-L115),
  [`JobControls.tsx:151-192`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/JobControls.tsx#L151-L192),
  and
  [`JobControls.tsx:367-371`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/JobControls.tsx#L367-L371).
- **Source-confirmed:** completed replay eligibility is receipt/signature based
  ([`RunAgainControl.tsx:25-68`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/RunAgainControl.tsx#L25-L68)),
  while replay preparation still runs the full current Start/Frame repair path
  ([`start-job-flow.ts:159-250`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/laser/start-job-flow.ts#L159-L250)).
- **Source-confirmed:** transient camera has its own catch/alert and no Start-blocker/persistence
  wrapper
  ([`transient-camera-job.ts:137-201`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/camera/align-wizard/transient-camera-job.ts#L137-L201));
  a failed Start returns the wizard to setup
  ([`AlignWizardSteps.tsx:27-35`](https://github.com/cisgz3a-hub/KerfDesk/blob/9aad1207b8b0e54c5960be5ed42214235b222fad/src/ui/camera/align-wizard/AlignWizardSteps.tsx#L27-L35)).
- **Focused-test-confirmed:** all audited production/test files matched exact `origin/main`
  `9aad1207`; 5 surface/ownership files passed 46 tests, and 4 replay/transient files passed 25
  tests. These tests confirm current component/store contracts but contain no integrated A-04
  failure surface.
- **Browser-reproduced baseline only:** the existing completed Frame -> successful Start/live
  canvas Playwright scenario passed 1/1 in 22.1 seconds. A first invocation incorrectly requested
  a nonexistent named Playwright project and was rerun against the repository's default project.
  This validates the current fixture/path, not A-04.
- **CI-confirmed / release-confirmed as containing the gap:** exact `9aad1207` remains green in
  [full CI](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190007099),
  [Browser smoke](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190007104), and
  [web deploy](https://github.com/cisgz3a-hub/KerfDesk/actions/runs/30190558190). None contains the
  terminal-failure or payload-scoped adapter-rejection scenario above.

## Next concrete checkpoint

1. Keep A-04 as one deduplicated blocker; do not create a separate removal item for the display
   banners or the valid acknowledgement quarantine.
2. In the next read-only loop, audit whether the shared Start and transient-camera failure paths
   produce any stale recovery card, toast, or wizard state after a failed owned fence, using only
   current source/tests and disposable exact-main probes.
3. Keep realtime-query errors and Marlin/Smoothie terminal classes deferred unless
   controller-primary evidence supports a causal, non-motion distinction.
4. Preserve the uncommitted product/test quarantine and update only audit ledgers.
