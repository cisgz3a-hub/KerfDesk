# LASERFORGE FIX PLAN

This file converts verified external-repo lessons into LaserForge repair instructions.

No item may be implemented from this file unless it includes the required linkage fields and has been accepted after LaserForge cross-reference.

Before implementation, read `EXTERNAL_FINDINGS_VALIDATION.md`. External comparator findings are not LaserForge defects by themselves; they are audit lenses, adaptation candidates, or anti-pattern warnings until a LaserForge sector audit proves local evidence.

## Required Fix Item Template

```md
## LF-EXT-XXX: <title>

Risk: CRITICAL | HIGH | MEDIUM | LOW
Status: NEW | TRIAGED | ACCEPTED | REJECTED | CONVERTED TO TICKET | IMPLEMENTED | VERIFIED

Learned from: <external repo name>
Evidence: <repo file path, command output, or audit artifact>
LaserForge target: <local file/module/test>
Action type: COPY CONCEPT | ADAPT PATTERN | REJECT PATTERN | BLOCKED | NEEDS MANUAL REVIEW

### External Pattern
<what the external repo does>

### LaserForge Current State
<what local evidence shows>

### Gap
<specific mismatch or risk>

### Proposed Change
<smallest safe implementation direction>

### Tests Required
<tests that prove behavior, including negative path if safety-related>

### Verification
<commands to run>

### Stop Conditions
<what ambiguity or risk blocks implementation>
```

## Fix Candidates

These are not accepted fixes yet. They are cross-reference candidates generated from Rayforge and must be validated against LaserForge before implementation.

## LF-EXT-RAY-001: Compare pipeline generation model against LaserForge stale-output boundaries

Risk: MEDIUM
Status: VERIFIED

Learned from: Rayforge
Evidence: `repo-notes/01-rayforge.md`; Rayforge `website/docs/developer/pipeline.md`; Rayforge `rayforge/pipeline/`
LaserForge target: `src/app/PipelineService`, `src/core/job`, `src/core/plan`, `src/core/output`, preview/simulator modules
Action type: ADAPT PATTERN

### External Pattern

Rayforge uses DAG-scheduled artifacts, generation IDs, stale-artifact handling, and separate job/view artifacts.

### LaserForge Current State

LaserForge already carries the Rayforge lesson through focused mechanisms rather than a full DAG scheduler: `useCompileManager` uses monotonic request IDs and drops stale async results; `CompiledJobState` makes stale outputs unselectable; `ValidatedJobTicket` and `JobFingerprint` bind scene/profile/controller/start-mode/capability inputs to the compiled artifact; `ConnectionPanelMain` starts from the compile ticket rather than a mutable G-code prop; and `PipelineService` attaches emitted burn envelope/divergence metadata so preview/output drift is detected before start.

### Gap

No current evidence-backed gap. Rayforge's generation-ID/artifact-staleness pattern is already represented in LaserForge by request IDs, atomic compiled state, runtime ticket/fingerprint validation, and emitted-output parity checks. A full DAG rewrite would be unjustified.

### Proposed Change

No code change. Keep the current targeted stale-output and ticket-validation model; revisit DAG-style scheduling only if a concrete multi-artifact invalidation bug is found.

### Tests Required

If a gap is found, require deterministic preview/output and stale-output invalidation tests.

### Verification

Passed:
- `npx tsx tests\compile-race-guard.test.ts`
- `npx tsx tests\compiled-job-state.test.ts`
- `npx tsx tests\validate-job-ticket.test.ts`
- `npx tsx tests\stale-gcode-blocks-start.test.ts`
- `npx tsx tests\gcode-preview-output-parity-fixtures.test.ts`
- `npx tsx tests\burn-envelope-divergence.test.ts`
- `npx tsx tests\job-fingerprint-start-validation.test.ts`
- `npx tsx tests\ui-start-job-uses-ticket.test.tsx`
- `npx tsx tests\usecompilemanager-stale-no-loop.test.tsx`
- `npx tsx tests\validated-job-ticket-mismatch.test.ts`

### Stop Conditions

Stop if the sector review finds no evidence-backed LaserForge gap.

## LF-EXT-RAY-002: Compare GRBL streaming invariants against Rayforge character-counting transport

Risk: HIGH
Status: VERIFIED

Learned from: Rayforge
Evidence: `repo-notes/01-rayforge.md`; Rayforge `rayforge/machine/transport/grbl.py`; Rayforge `rayforge/machine/driver/grbl/grbl_serial.py`
LaserForge target: `src/controllers/grbl/GrblController.ts`, serial/communication/spool paths, streaming tests
Action type: ADAPT PATTERN

### External Pattern

Rayforge tracks pending command lengths, extracts `ok`/`error` acknowledgements before line splitting, bypasses RX accounting for realtime commands, and has buffer-stall recovery.

### LaserForge Current State

Reviewed against `src/controllers/grbl/GrblController.ts` and the focused streaming/safety tests. LaserForge already uses encoded-byte receive-buffer accounting for buffered and spool-backed jobs, tracks pending line byte counts, releases the oldest pending line on `ok` and `error:`, bypasses the buffered queue for realtime feed-hold/cycle-start/reset/status bytes, and routes active-job stream refill/error/alarm paths through fault/safety-off handling. The implementation also uses the controller-reported GRBL RX buffer from `[OPT:...]` when available and has a sustained no-controller-RX heartbeat path instead of treating a single delayed status reply as a disconnect.

### Gap

No concrete production gap found. The Rayforge streaming lesson is already covered by LaserForge's GRBL controller and regression suite, including byte-counting, `ok`/`error` acknowledgement accounting, realtime-command bypass, stream refill failure safety-off, synchronous transfer mode, streaming-health saturation detection, cable-pull heartbeat recovery, spool-backed execution without full materialization, and bounded large-job stream behavior.

### Proposed Change

No production code change. Keep the existing tests as the guardrail and continue using Rayforge as a reference benchmark for future streaming changes.

### Tests Required

No new tests required for this finding. Existing coverage already includes fake-controller tests for ack parsing, encoded byte accounting, controller-reported RX budget, realtime command bypass, refill failure safety-off, stop/pause behavior, streaming health, cable-pull heartbeat recovery, and gcode-stream execution.

### Verification

Passed:

- `npx tsx tests\grbl-byte-buffer-accounting.test.ts`
- `npx tsx tests\grbl-stream-fill-error-safety-off.test.ts`
- `npx tsx tests\grbl-synchronous-transfer-mode.test.ts`
- `npx tsx tests\streaming-health.test.ts`
- `npx tsx tests\pause-emits-m5-after-feed-hold.test.ts`
- `npx tsx tests\controller-stop-safety.test.ts`
- `npx tsx tests\error-handler-faults-active-job.test.ts`
- `npx tsx tests\error-handler-sends-safety-off.test.ts`
- `npx tsx tests\streaming-health-saturation.test.ts`
- `npx tsx tests\burn-progress-ack-timing.test.ts`
- `npx tsx tests\webserial-cable-pull-heartbeat.test.ts`
- `npx tsx tests\execute-job-output-contract.test.ts`
- `npx tsx tests\time-estimator-stream.test.ts`
- `npx tsx tests\gcode-streaming-foundation.test.ts`
- `npx tsx tests\raster-gcode-streaming.test.ts`

Non-finding note: `npx tsx tests\spool-progress-forwarding.test.ts` was attempted as an exploratory name and failed because that file does not exist in this checkout; equivalent spool/progress coverage exists in `execute-job-output-contract.test.ts`, `time-estimator-stream.test.ts`, and `raster-gcode-streaming.test.ts`.

### Stop Conditions

Stop if proposed changes would affect live device-control semantics without hardware validation plan.

## LF-EXT-RAY-003: Compare WCS coordinate model against LaserForge placement/origin behavior

Risk: MEDIUM
Status: VERIFIED

Learned from: Rayforge
Evidence: `repo-notes/01-rayforge.md`; Rayforge `website/docs/general-info/coordinate-systems.md`
LaserForge target: WCS settings, placement certainty, bounds/preflight, reset-to-baseline behavior
Action type: ADAPT PATTERN

### External Pattern

Rayforge explicitly distinguishes MACHINE, WORKAREA, WCS, and internal WORLD space in user-facing documentation and driver behavior.

### LaserForge Current State

Reviewed against the WCS/origin implementation and focused tests. LaserForge now treats work-coordinate state as explicit machine-control state: `GrblController` parses G54 from `$#`, classifies missing/malformed/non-zero WCS evidence fail-closed, exposes placement-uncertain state and reasons, and keeps WCS mutation behind controller operations. `sendResetWcsCommand` routes reset-to-machine-origin through `operations.resetWcsToMachineOrigin()` rather than raw UI G-code. `MachineService.startValidatedJob` blocks placement-uncertain starts by default, while profile policy can explicitly allow unverified-WCS starts for manual-zero machines. Saved-origin starts carry a G54 snapshot and reverify it before start. Bounds/preflight use transformed machine-plan bounds and include X/Y plus explicit Z-axis safety limits where supported.

### Gap

No current production gap found for the Rayforge coordinate-space lesson. The remaining caveat is hardware validation and operator education: software tests prove WCS parsing, gating, reset commands, transformed bounds, and saved-origin verification, but they do not prove every physical machine's reporting/setup behavior.

### Proposed Change

No production code change in this pass. Keep the current profile-aware WCS model: hard fail-closed behavior for unknown placement by default, explicit manual-zero compatibility policy for machines that cannot prove the same WCS settings, and direct Reset WCS baseline controls.

### Tests Required

No new tests required for this finding. Existing coverage already proves the WCS parser, fail-closed classification, query-error handling, no-listener default, WCS reset UI/control path, saved-origin G54 verification, transformed bounds, preflight X/Y/Z bounds, WCS mutation consent, operation-gated WCS helpers, current/head orientation, and relative-mode bounds.

### Verification

Passed:

- `npx tsx tests\grbl-wcs-parser.test.ts`
- `npx tsx tests\wcs-fail-closed-on-unknown.test.ts`
- `npx tsx tests\wcs-query-error-fails-closed.test.ts`
- `npx tsx tests\wcs-no-listener-blocks-job.test.ts`
- `npx tsx tests\wcs-profile-gate-contract.test.ts`
- `npx tsx tests\controls-reset-wcs-baseline.test.tsx`
- `npx tsx tests\start-mode-wcs-reset.test.ts`
- `npx tsx tests\saved-origin-verifies-wcs.test.ts`
- `npx tsx tests\origin-mode-wcs-zero.test.ts`
- `npx tsx tests\machine-transform-fused-bounds.test.ts`
- `npx tsx tests\preflight-bounds.test.ts`
- `npx tsx tests\preflight-z-axis-bounds.test.ts`
- `npx tsx tests\wcs-mutation-consent.test.ts`
- `npx tsx tests\wcs-command-helpers-use-gateway.test.ts`
- `npx tsx tests\current-head-front-origin-orientation.test.ts`
- `npx tsx tests\controller-bounds-checks-g91.test.ts`

### Stop Conditions

No stop condition was hit. Future WCS behavior changes still need hardware/profile validation because not all machines expose the same WCS/status evidence.

## LF-EXT-RAY-004: Compare material presets and beginner workflow against Rayforge

Risk: LOW
Status: VERIFIED

Learned from: Rayforge
Evidence: `repo-notes/01-rayforge.md`; Rayforge `README.md`; material/recipe modules listed in `file-list.txt`
LaserForge target: material preset model, Easy/Pro user-mode policy, guided first-run workflow, material test grids, start readiness flows
Action type: ADAPT PATTERN

### External Pattern

Rayforge exposes material libraries, recipe/preset matching, material test grids, and beginner-friendly safety education as first-class product concepts.

### LaserForge Current State

Reviewed in this study phase. LaserForge has the same product-level concepts represented locally:

- Built-in and user material presets with schema migration, storage, import/export, operation-specific fields, and drift snapshots.
- Material-first workflow that applies tested built-in presets, marks manual edits as unverified, and can save edited layer settings as user presets.
- Material/test-grid generation with validation, conservative safe ordering, bounds blocking, deterministic golden output, and preview/generate split.
- First-run guide with a low-power score project, explicit frame/set-zero/test steps, and wiring from the setup wizard.
- Easy/Pro user-mode policy gates that hide advanced console/pro-only controls without weakening service-layer safety.
- Start readiness panel that explains blocking gates without dead-end recovery checklist wording.

### Gap

No current evidence-backed gap found for this Low/P3 comparator. Rayforge remains a good product benchmark for richer material UX and recipe education, but LaserForge already has the core material/preset/test-grid/beginner workflow guardrails needed for this sector.

### Proposed Change

No production code change in this pass. Future material UX improvements should be product decisions, not audit-driven rewrites, and must preserve preset drift detection and service-layer start gates.

### Tests Required

No new tests required for this finding. Existing tests prove material presets, preset schema/storage/snapshots, material-first confidence, user-mode policy, Pro-scoped gates, first-run guide wiring, test-grid validation, material-test bounds/safe ordering, workflow panel mode coverage, frame-ticket start gates, and start-readiness gate copy.

### Verification

Passed:

- `npx tsx tests\materials.test.ts`
- `npx tsx tests\material-preset-schema.test.ts`
- `npx tsx tests\material-presets-storage.test.ts`
- `npx tsx tests\material-preset-snapshot.test.ts`
- `npx tsx tests\material-first-workflow.test.ts`
- `npx tsx tests\user-mode-gates.test.ts`
- `npx tsx tests\user-mode-policy-production-wiring.test.ts`
- `npx tsx tests\pro-feature-ui-scoped-gates.test.ts`
- `npx tsx tests\first-run-guide.test.ts`
- `npx tsx tests\first-run-guide-wiring.test.ts`
- `npx tsx tests\test-grid-dialog-validation.test.tsx`
- `npx tsx tests\test-grid-dialog-preview-flow.test.ts`
- `npx tsx tests\test-grid-generator.test.ts`
- `npx tsx tests\material-test-safe-ordering.test.tsx`
- `npx tsx tests\material-test-bounds-block.test.tsx`
- `npx tsx tests\workflow-panel-phase2-modes.test.ts`
- `npx tsx tests\workflow-panel-frame-ticket-start-gate.test.ts`
- `npx tsx tests\start-readiness-panel.test.tsx`
- `npx tsx tests\start-readiness-frame-control-gate.test.ts`
- `npx tsx tests\build-start-readiness.test.ts`

### Stop Conditions

Stop if proposed changes would alter beginner safety policy, material recommendations, or workflow education without product-owner approval and hardware validation notes.

## LF-EXT-MK-001: Compare device-family boundaries against LaserForge controller abstraction

Risk: MEDIUM
Status: VERIFIED

Learned from: MeerK40t
Evidence: `repo-notes/02-meerk40t.md`; MeerK40t `meerk40t/kernel/service.py`; MeerK40t `meerk40t/device/basedevice.py`; MeerK40t `meerk40t/grbl/device.py`
LaserForge target: `src/core/devices/DeviceProfile.ts`, `src/controllers/FirmwareAdapter.ts`, `src/controllers/ControllerInterface.ts`, GRBL/Falcon modules
Action type: ADAPT PATTERN

### External Pattern

MeerK40t gives each controller family its own device service, settings choices, transport options, driver, controller, and UI/config surface. GRBL-specific items such as M3/M4 preference, endstops, G1-for-power, red-dot, pulse, serial/TCP/WebSocket, axis flips, and home corner live in GRBL's device boundary.

### LaserForge Current State

Reviewed against the controller abstraction and profile/capability tests. LaserForge already separates protocol-neutral controller surfaces from GRBL-specific APIs, advertises controller capabilities through `ControllerCapabilities`, gates operations through `OperationGate`, records family/output compatibility in tickets, and keeps GRBL, Falcon WiFi, Marlin-shape, Ruida-shape, file-upload, and no-output controller expectations in tests. The profile layer also exposes split controller/job/transport/material sections and machine-settings capability confidence so GRBL-specific assumptions do not silently bleed into every controller family.

### Gap

No current production gap found from the MeerK40t device-boundary lesson. LaserForge should keep adding controller-family semantics through capabilities/profile sections and focused adapters, not by adding generic conditionals to UI start paths or pretending future controller families share GRBL semantics.

### Proposed Change

No production code change in this pass. Preserve the current capability/profile boundary and require future controller-family additions to update capability tests, output-contract tests, ticket matching, and profile mismatch checks.

### Tests Required

No new tests required for this finding. Existing coverage proves controller-family operation routing, protocol-neutral interfaces, app/controller type separation, GRBL/Falcon trust boundaries, output-kind rejection, capability snapshots, and profile/firmware mismatch reporting.

### Verification

Passed:

- `npx tsx tests\controller-family-profile-boundaries.test.ts`
- `npx tsx tests\controller-interface-protocol-neutral.test.ts`
- `npx tsx tests\controller-shared-types-neutral-layer.test.ts`
- `npx tsx tests\controller-matrix\operation-routing-by-family.test.ts`
- `npx tsx tests\controller-capabilities-enforced.test.ts`
- `npx tsx tests\execute-job-output-contract.test.ts`
- `npx tsx tests\falcon-wifi-trust-blocks-start.test.ts`
- `npx tsx tests\machine-settings-capability-indicators.test.ts`
- `npx tsx tests\feature-matrix-enforcement.test.ts`
- `npx tsx tests\family-agnostic-ticket.test.ts`
- `npx tsx tests\ticket-capability-snapshot-validation.test.ts`
- `npx tsx tests\preflight-capability-mismatches.test.ts`

### Stop Conditions

No stop condition was hit. Future hardware-family broadening still needs per-family safety semantics and hardware validation requirements.

## LF-EXT-MK-002: Audit LaserForge job execution as a spooler lifecycle state machine

Risk: HIGH
Status: FIXED

Learned from: MeerK40t
Evidence: `repo-notes/02-meerk40t.md`; MeerK40t `meerk40t/core/spoolers.py`; MeerK40t `meerk40t/core/laserjob.py`; MeerK40t `test/test_spooler.py`
LaserForge target: `src/app/MachineService.ts`, `src/app/ExecutionCoordinator.ts`, `src/controllers/grbl/GrblController.ts`, spool/output/ticket types, job progress/logging tests
Action type: ADAPT PATTERN

### External Pattern

MeerK40t models spooled work as jobs with priority, status, stop, estimate, queue ownership, hold checks, job start/finish hooks, clear-queue handling, and logging.

### LaserForge Current State

Reviewed. LaserForge already treats job execution as a service-owned lifecycle rather than a UI-only state: `MachineService.startValidatedJob` owns the validated-ticket handoff, service preconditions, active-job state, canvas context, recovery gates, running-session cleanup, failed-start logging, and spool-backed controller handoff. `JobExecutionSession` and `JobSession` encode job status/progress/completion semantics, and the controller layer has focused proofs for pause/resume/stop, stream refill failure, safety-off, and active-job error handling.

### Gap

No production lifecycle gap was found in this review. The concrete gap found was stale lifecycle test setup: several `MachineService` lifecycle tests created valid tickets without installing an explicit active device profile after the newer service-level "unknown bed dimensions" start gate. Those tests were accidentally exercising the bed-dimension preflight gate instead of the queued/running/finalize lifecycle paths they were intended to prove.

### Proposed Change

Updated the lifecycle test fixtures to install an explicit 120x100 active profile before creating validated tickets. Kept the unknown-bed start rejection as a separate regression test so the service-level bed gate remains protected. No production job lifecycle behavior was changed for this item.

### Tests Required

Lifecycle proof must continue to cover queue ownership, double-start rejection, failed-start cleanup/logging, stale finalization races, pause/resume/stop surface errors, stream refill failure safety-off, recovery-state blocking, event-ledger wiring, and unknown-bed start rejection.

### Verification

- `npx tsx tests\job-execution-session.test.ts`
- `npx tsx tests\job-session-transitions.test.ts`
- `npx tsx tests\machine-service-job-lifecycle-safety.test.ts`
- `npx tsx tests\machine-service-start-validated-job.test.ts`
- `npx tsx tests\machine-service-pause-resume.test.ts`
- `npx tsx tests\pause-resume-stop-surface-errors.test.ts`
- `npx tsx tests\grbl-stream-fill-error-safety-off.test.ts`
- `npx tsx tests\failed-start-preserves-unsafe-state-when-streamed.test.ts`
- `npx tsx tests\failed-start-persists-log.test.ts`
- `npx tsx tests\machine-service-job-log-checkpoint-wiring.test.ts`
- `npx tsx tests\try-finalize-respects-observed-running.test.ts`
- `npx tsx tests\try-finalize-after-observed-running.test.ts`
- `npx tsx tests\start-validated-job-then-immediately-tryfinalize.test.ts`
- `npx tsx tests\auto-finalize-without-mounted-ui.test.ts`
- `npx tsx tests\recovery-state-blocks-start.test.ts`
- `npx tsx tests\machine-event-ledger-pause-resume-wiring.test.ts`
- `npx tsx tests\service-start-blocks-unknown-bed.test.ts`

### Stop Conditions

Stop if the change can affect live stop/pause/resume/device-control behavior without a hardware validation plan.

## LF-EXT-MK-003: Compare inner-first and no-suppression planning tests against LaserForge path ordering

Risk: HIGH
Status: VERIFIED

Learned from: MeerK40t
Evidence: `repo-notes/02-meerk40t.md`; MeerK40t `meerk40t/core/cutplan.py`; MeerK40t `meerk40t/core/elements/operation_workflow.py`; MeerK40t `test/test_cutplan_optimization.py`; MeerK40t `test/test_hatched_geometry_fix.py`
LaserForge target: `src/app/OperationOrder.ts`, `src/core/plan/PlanOptimizer.ts`, vector/fill/raster planners, output/golden tests
Action type: ADAPT PATTERN

### External Pattern

MeerK40t has explicit tests that inner-first and grouped-piece planning do not suppress cutcode and preserve all geometry while optimizing path order.

### LaserForge Current State

Reviewed. LaserForge already has focused coverage for the MeerK40t planning lesson: `OperationOrderer` proves engrave-before-cut and inner-before-outer ordering, `PlanOptimizer` orders open cut/score paths before closed cutouts, compound-path output preserves contour roles, compound fill rows are generated per compound instead of pooling unrelated objects, and output-level fill tests prove holes/islands stay correct for line and cross-hatch modes.

### Gap

No production gap found. The current coverage proves no obvious nested/grouped geometry suppression and blocks the dangerous historical fallback where a too-small fill silently became an outline cut.

### Proposed Change

No code change required. Keep this as a verified comparison point and preserve the current golden/geometric tests when future planner changes are made.

### Tests Required

Maintain coverage for nested cuts, separated/overlapping compounds, fill/hatch objects, repeated compile determinism, preview/output consistency, and no fill-to-outline fallback.

### Verification

- `npx tsx tests\operation-ordering.test.ts`
- `npx tsx tests\cut-open-paths-before-closed.test.ts`
- `npx tsx tests\compound-output-boundary.test.ts`
- `npx tsx tests\compound-jobcompiler-metadata.test.ts`
- `npx tsx tests\compound-fill-generator.test.ts`
- `npx tsx tests\fill-with-holes.test.ts`
- `npx tsx tests\fill-no-rows-throws-not-outline-fallback.test.ts`
- `npx tsx tests\gcode-preview-output-parity-fixtures.test.ts`

### Stop Conditions

Stop if the proposed change would alter emitted G-code ordering without golden output tests and hardware risk review.

## LF-EXT-MK-004: Compare GRBL settings/status metadata against LaserForge profile and preflight gates

Risk: MEDIUM
Status: FIXED

Learned from: MeerK40t
Evidence: `repo-notes/02-meerk40t.md`; MeerK40t `meerk40t/grbl/controller.py`; MeerK40t `meerk40t/grbl/device.py`
LaserForge target: `src/controllers/grbl/GrblSettingsParser.ts`, profile compatibility, preflight settings gates, bounds/recovery messages
Action type: ADAPT PATTERN

### External Pattern

MeerK40t maps GRBL settings, status reports, errors, alarms, and settings such as `$20`, `$22`, `$30`, `$31`, `$32`, `$130`, `$131`, and `$132` into controller metadata and user-facing behavior.

### LaserForge Current State

Reviewed. LaserForge has a dedicated `GrblSettingsParser` for `$$` lines and interpreted values including `$20`, `$22`, `$23`, `$30`, `$31`, `$32`, `$130`, `$131`, `$132`, feed, and acceleration settings. `ControllerSettingsSnapshot` records live settings/WCS evidence, profile mismatch rules compare live firmware identity against stored profile assumptions, machine settings UI labels live values as verified vs profile-only, and preflight blocks or warns on settings-dependent risks such as M4 without `$32=1`, homing-template mismatch, soft-limit mismatch, feed/travel mismatch, Z travel mismatch, and negative workspace output.

### Gap

No remaining gap found in this sector. The earlier class of risk is closed by parser, preflight, profile compatibility, and ticket capability snapshot tests. The current design avoids excluding machines solely for missing settings: unknown values are skipped or surfaced as unknown unless a concrete safety gate requires live proof.

### Proposed Change

No additional code change required for this item. Preserve the existing setting-derived gates and the compatibility posture: fail closed only for concrete safety blockers, warn or mark unknown when settings are absent, and keep machine-specific overrides explicit.

### Tests Required

Maintain settings parser tests, malformed/signed travel bounds tests, `$32`/laser-mode tests, `$30` S-scale/ticket mismatch tests, homing/soft-limit tests, Z-travel tests, and user-message/capability indicator tests.

### Verification

- `npx tsx tests\grbl-settings-parser.test.ts`
- `npx tsx tests\preflight-capability-mismatches.test.ts`
- `npx tsx tests\preflight-rejects-m4-without-laser-mode.test.ts`
- `npx tsx tests\template-validator.test.ts`
- `npx tsx tests\controller-settings-snapshot.test.ts`
- `npx tsx tests\ticket-capability-snapshot-validation.test.ts`
- `npx tsx tests\machine-settings-capability-indicators.test.ts`
- `npx tsx tests\grbl-status-report-parser.test.ts`
- `npx tsx tests\controller-bounds-checks-g91.test.ts`
- `npx tsx tests\preflight-z-axis-bounds.test.ts`
- `npx tsx tests\preflight-negative-coords.test.ts`

### Stop Conditions

Stop if a proposed gate would disable common machines without a compatible override path and clear safety warning.

## LF-EXT-LGRBL-001: Compare byte-counted GRBL streaming against LaserForge sender

Risk: HIGH
Status: VERIFIED

Learned from: LaserGRBL
Evidence: `repo-notes/03-lasergrbl.md`; LaserGRBL `LaserGRBL/Core/GrblCore.cs`
LaserForge target: `src/controllers/grbl/GrblController.ts`, spool send path, fake-controller streaming tests
Action type: ADAPT PATTERN

### External Pattern

LaserGRBL tracks queued, pending, and retry commands; sends only when the byte budget fits; increments used buffer by serialized command length; and decrements it when `ok` or `error` is received.

### LaserForge Current State

Reviewed. LaserForge's GRBL sender uses encoded-byte line accounting, rejects oversized manual/job/spool lines before streaming, honors controller-reported RX budget from `[OPT:...]`, uses pending/ack accounting to release byte budget on controller replies, keeps realtime pause/hold and `M5 S0` safety-off outside normal queued-line backpressure, supports spool-backed `gcode-stream` execution, and avoids flattening large spools through `collectStreamingOutput` in the controller start path.

### Gap

No remaining gap found for this LaserGRBL streaming lesson. The behavior to adapt is already present and covered by fake-controller transcript tests, including bounded buffers, line-boundary preservation, pending/ack accounting, reported RX buffer sizing, refill failure safety-off, and no hidden full-job materialization on the device-send path.

### Proposed Change

No code change required for this item. Preserve the existing separation between generation/spool output and GRBL transport buffering; do not collapse the sender into a LaserGRBL-style monolith.

### Tests Required

Maintain fake-controller transcripts for normal `ok`, `error`, delayed `ok`, buffer-full/backpressure, reported RX budgets, disconnect/refill failure, realtime pause/stop during a full buffer, and spool-backed large jobs.

### Verification

- `npx tsx tests\grbl-byte-buffer-accounting.test.ts`
- `npx tsx tests\grbl-synchronous-transfer-mode.test.ts`
- `npx tsx tests\streaming-health.test.ts`
- `npx tsx tests\streaming-health-saturation.test.ts`
- `npx tsx tests\grbl-stream-fill-error-safety-off.test.ts`
- `npx tsx tests\raster-gcode-streaming.test.ts`
- `npx tsx tests\execute-job-output-contract.test.ts`
- `npx tsx tests\time-estimator-stream.test.ts`

### Stop Conditions

Stop if a proposed sender change can alter live streaming, pause, stop, or safety-off behavior without focused tests and hardware-validation notes.

## LF-EXT-LGRBL-002: Compare resume modal reconstruction against LaserForge pause/resume

Risk: HIGH
Status: VERIFIED

Learned from: LaserGRBL
Evidence: `repo-notes/03-lasergrbl.md`; LaserGRBL `LaserGRBL/Core/GrblCore.cs`; LaserGRBL `LaserGRBL/StateBuilder.cs`
LaserForge target: `src/app/MachineService.ts`, `src/app/ExecutionCoordinator.ts`, active job context/ticket modules, pause/resume tests
Action type: ADAPT PATTERN

### External Pattern

LaserGRBL resumes by analyzing commands before the resume point, issuing `G90`, safe-traveling with `M5 G0 ...`, restoring settled modals, then queuing remaining commands with the first movement mode made explicit if needed.

### LaserForge Current State

Reviewed. LaserForge's recoverable resume path is not an arbitrary "resume from selected line" reconstruction path like LaserGRBL's `ContinueProgramFromKnown`; it is GRBL feed-hold/cycle-start resume in place. Because LaserForge's pause path sends `M5 S0` after feed-hold, the adapted invariant is narrower and safety-specific: capture the active `M3`/`M4` modal spindle mode from real G-code tokens, ignore comments/substrings, reassert `M3 S0` or `M4 S0` before cycle-start, await that critical write, and refuse resume if the reassert fails. MachineService routes pause/resume through controller operations and preserves safety/result state.

### Gap

No remaining gap found for the current LaserForge resume model. LaserForge does not claim arbitrary line-resume with safe travel/WCS reconstruction; if that feature is added later, it must be treated as a new hardware-risk feature with golden modal/WCS fixtures.

### Proposed Change

No code change required for this item. Preserve the existing distinction between feed-hold resume and arbitrary replay resume, and keep the modal reassert failure path release-blocking for resume.

### Tests Required

Maintain focused tests for tokenized M3/M4/M5 tracking, `M3/M4 S0` modal reassert before cycle-start, no stale modal leakage between jobs, failed reassert blocking cycle-start, pause laser-off confirmation, MachineService operation routing, pause/resume UI errors, and event-ledger visibility. Require new golden WCS/safe-travel fixtures before adding arbitrary line-resume.

### Verification

- `npx tsx tests\resume-modal-tokenization.test.ts`
- `npx tsx tests\resume-awaits-modal-restore.test.ts`
- `npx tsx tests\controller-safety-capabilities.test.ts`
- `npx tsx tests\machine-service-pause-resume.test.ts`
- `npx tsx tests\pause-emits-m5-after-feed-hold.test.ts`
- `npx tsx tests\pause-laser-off-confirmation.test.ts`
- `npx tsx tests\pause-resume-stop-surface-errors.test.ts`
- `npx tsx tests\machine-event-ledger-pause-resume-wiring.test.ts`

### Stop Conditions

Stop if a proposed resume fix changes emitted G-code or machine motion without golden output tests and hardware-validation notes.

## LF-EXT-LGRBL-003: Compare preview parser-state consistency against LaserForge preview/output

Risk: MEDIUM
Status: FIXED

Learned from: LaserGRBL
Evidence: `repo-notes/03-lasergrbl.md`; LaserGRBL `LaserGRBL/GrblFile.cs`; LaserGRBL `LaserGRBL/StateBuilder.cs`
LaserForge target: preview compiler/simulator modules, `src/core/output/*`, burn-bounds tests, export/send consistency tests
Action type: ADAPT PATTERN

### External Pattern

LaserGRBL preview draws by walking the same command list with parser-state analysis. Burn/non-burn color is derived from modal spindle state, `S`, and motion mode.

### LaserForge Current State

Reviewed. LaserForge preview/bounds behavior is covered by parser-state fixtures rather than UI-only estimates: G-code preview tests exercise same-block modal words, comments, relative mode, embedded laser mode and S values, arcs, and laser-state classification. Burn-bound analysis and emitted-burn-envelope tests cover M3/M4/S semantics, rapid/non-burn travel, I/J arcs, R-mode arcs, and canvas preview travel classification.

### Gap

No remaining gap found for this LaserGRBL preview lesson. The current coverage proves the important preview/output agreement points for vector/modal/arcs/raster gap behavior. As always, future new operation types need parity fixtures before being trusted.

### Proposed Change

No code change required for this item. Preserve the rule that preview and safety/bounds analysis must be derived from emitted output/plan truth, not reconstructed from UI state.

### Tests Required

Maintain preview/output parity fixtures for raster, vector, fill, arcs, G0 with M4, zero-power moves, relative mode, comments, and export-vs-send consistency.

### Verification

- `npx tsx tests\gcode-preview-output-parity-fixtures.test.ts`
- `npx tsx tests\gcode-preview-laser-state.test.ts`
- `npx tsx tests\gcode-preview-relative-mode.test.ts`
- `npx tsx tests\gcode-preview-arcs.test.ts`
- `npx tsx tests\analyze-burn-bounds.test.ts`
- `npx tsx tests\emitted-burn-envelope-arcs.test.ts`
- `npx tsx tests\emitted-burn-envelope-r-mode-arcs.test.ts`
- `npx tsx tests\canvas-toolpath-preview-travel-classification.test.ts`

### Stop Conditions

Stop if a proposed preview fix changes emitted output or hides a machine-control discrepancy instead of making it visible.

## LF-EXT-LGRBL-004: Compare M3/M4/M5 and laser-mode gating against LaserForge preflight

Risk: MEDIUM
Status: FIXED

Learned from: LaserGRBL
Evidence: `repo-notes/03-lasergrbl.md`; LaserGRBL `LaserGRBL/RasterConverter/ConvertSizeAndOptionForm.cs`; LaserGRBL `LaserGRBL/SvgConverter/ConvertSizeAndOptionForm.cs`; LaserGRBL `LaserGRBL/StateBuilder.cs`
LaserForge target: GRBL settings parser, M4 preflight, `outputUsesM4`, S-value scaling, output emitter, parser/burn-bounds tests
Action type: ADAPT PATTERN

### External Pattern

LaserGRBL exposes `M3 - Constant Power` and `M4 - Dynamic Power`, warns when M4 is selected and laser mode is not enabled, models M4 on G0 as non-burning, and uses M5 as the off command.

### LaserForge Current State

Reviewed. LaserForge gates dynamic-power M4 jobs on live `$32` laser mode when available, uses spool-aware `outputUsesM4` metadata for ticket-only jobs, emits raster output as one modal M4 scope with per-segment S values, treats overscan/gaps as S0 feed travel rather than burn, suppresses zero-distance dwell-burn G1 output, keeps relative/absolute mode explicit in generated G-code, and routes stop/emergency through soft-reset safety paths rather than queued normal G-code.

### Gap

No remaining gap found for the current M3/M4/M5 and laser-mode gating scope. The remaining product caveat is hardware validation: software tests prove emitted semantics and gates, but real firmware behavior must still be checked on supported machines.

### Proposed Change

No code change required for this item. Keep dynamic-power gating tied to live firmware settings where available, keep M4 detection metadata generated along the compile/spool path, and keep rapid/zero-power travel visible in preview/bounds as non-burning motion.

### Tests Required

Maintain tests for `$32=0` with M4 output, `$32=1` with M4 output, spool-aware M4 metadata, `$30`/S-value scaling, M4 G0/S0 non-burn preview, M3 constant power, M5/safety-off paths, zero-distance suppression, relative/absolute mode, and malformed settings fallback.

### Verification

- `npx tsx tests\preflight-rejects-m4-without-laser-mode.test.ts`
- `npx tsx tests\raster-output-uses-modal-m4.test.ts`
- `npx tsx tests\raster-m4-no-software-splitting.test.ts`
- `npx tsx tests\raster-overscan-as-s0-travel.test.ts`
- `npx tsx tests\gcode-emitter-purity-and-zero-distance.test.ts`
- `npx tsx tests\gcode-relative-mode.test.ts`
- `npx tsx tests\analyze-burn-bounds.test.ts`
- `npx tsx tests\controller-stop-safety.test.ts`

### Stop Conditions

Stop if a proposed gate would lock out real machines without a safe explicit override and clear warning.

## LF-EXT-LGRBL-005: Reject monolithic sender/test-thinness as a LaserForge pattern

Risk: LOW
Status: REJECTED_AS_ANTIPATTERN

Learned from: LaserGRBL
Evidence: `repo-notes/03-lasergrbl.md`; LaserGRBL `LaserGRBL/Core/GrblCore.cs`; LaserGRBL `LaserGRBL.Tests/LaserGRBL.Tests.csproj`
LaserForge target: module boundaries, tests, roadmap/audit fix discipline
Action type: REJECT COPY

### External Pattern

LaserGRBL's practical sender behavior is valuable, but the control class is large and the visible automated test coverage does not match the risk surface.

### LaserForge Current State

LaserForge has a larger TypeScript test suite and stronger sector-by-sector audit discipline.

### Gap

None asserted as a defect.

### Proposed Change

Do not copy the monolithic structure. Use LaserGRBL as a behavior comparator only.

### Tests Required

No new tests required from this lesson alone.

### Verification

Keep future fixes scoped and tested.

### Stop Conditions

Stop if future work proposes a broad sender rewrite justified only by "LaserGRBL does it this way."

## LF-EXT-LW4-001: Validate machine-control IPC and network payloads at trusted boundaries

Risk: HIGH
Status: FIXED

Learned from: LaserWeb4
Evidence: `repo-notes/04-laserweb4.md`; LaserWeb4 `src/components/com.js`; LaserWeb4 `src/lib/lw.comm-client.js`
LaserForge target: Electron IPC, Falcon WiFi handlers, serial/device command dispatch, `src/app/MachineService.ts`
Action type: ADAPT PATTERN

### External Pattern

LaserWeb4 separates the web UI from a communication-server style boundary and sends actions such as `connectTo`, `runJob`, `pause`, `resume`, `stop`, `laserTest`, `jog`, `jogTo`, and `resetMachine` over Socket.IO events.

### LaserForge Current State

Reviewed. LaserForge validates Electron IPC sender frames in the main process and Falcon WiFi service, restricts Falcon WiFi IPC targets to normalized private LAN IPs in the main process, removes the old native Electron serial `serial:*` bridge, keeps Web Serial as the renderer/device path, routes machine commands through service/controller operation gates, and marks Falcon WiFi as untrusted telemetry unless an explicit policy/override allows a safety-critical action.

### Gap

No remaining gap found for this LaserWeb4 trusted-boundary lesson. The current design avoids relying solely on UI-side validation for Falcon targets, IPC sender origin, native serial access, or command-capable machine-control surfaces.

### Proposed Change

No code change required for this item. Preserve main-process IPC sender checks, Falcon target normalization, no native serial IPC bridge, and service-level command gates.

### Tests Required

Maintain negative-path tests for malformed/invalid Falcon targets, untrusted IPC senders, missing IPC guards, removed serial bridge, raw command bypasses, command-gate safety state, and WiFi start/action trust.

### Verification

- `npx tsx tests\falcon-wifi-ipc-target-validation.test.ts`
- `npx tsx tests\trusted-command-boundary-contract.test.ts`
- `npx tsx tests\ipc-sender-verification.test.ts`
- `npx tsx tests\ipc-attack-surface.test.ts`
- `npx tsx tests\no-electron-sendgcode-export.test.ts`
- `npx tsx tests\no-direct-sendcommand-outside-gateway.test.ts`
- `npx tsx tests\machine-service-sendcommand-uses-gateway-policy.test.ts`
- `npx tsx tests\command-gates-honor-safety-state.test.ts`
- `npx tsx tests\falcon-wifi-trust-blocks-start.test.ts`
- `npx tsx tests\falcon-wifi-trust.test.ts`
- `npx tsx tests\electron-renderer-sandbox.test.ts`
- `npx tsx tests\electron-navigation-blocked.test.ts`

### Stop Conditions

Stop if validation would block legitimate supported machines without an explicit compatibility path and user-visible safety explanation.

## LF-EXT-LW4-002: Keep device-send streaming free of final string materialization

Risk: HIGH
Status: VERIFIED

Learned from: LaserWeb4
Evidence: `repo-notes/04-laserweb4.md`; LaserWeb4 `src/lib/cam-gcode.js`; LaserWeb4 `src/lib/cam-gcode-raster.js`; LaserWeb4 `src/lib/lw.raster2gcode/raster-to-gcode.js`
LaserForge target: output spool/ticket modules, start/send path, `PipelineService`, LF-004 regression tests
Action type: REJECT PATTERN

### External Pattern

LaserWeb4 uses queues, workers, and progress callbacks, but still stores generated operation output in arrays and finishes by joining all G-code into one full text payload.

### LaserForge Current State

LaserForge has already fixed and rechecked LF-004 to make the start path spool-backed instead of full-text materialized. The current ticket-only compile path keeps `gcodeText` empty and `gcodeLines` empty for device-start jobs, with `gcodeSpool` authoritative. Export/preview paths remain explicitly materialized, and controller execution consumes `gcode-stream` without collecting the stream into a final text payload first.

### Gap

No current production gap found in this sector. The external LaserWeb4 pattern remains useful as an anti-pattern: do not call a path "streaming" if it creates a full G-code string before send.

### Proposed Change

No code change required. Preserve the existing LF-004 regression guards and use LaserWeb4 as a standing regression warning: future LaserForge changes must not reintroduce a full string join before device send.

### Tests Required

Maintain or add tests proving ticket-only start jobs do not carry full `gcodeText` or `gcodeLines`, chunk boundaries remain valid, export explicitly materializes only by request, and LF-001 encoder context remains isolated.

### Verification

Verified with:

- `npx tsx tests\lf004-spooled-compile-materialization.test.ts`
- `npx tsx tests\execute-job-output-contract.test.ts`
- `npx tsx tests\raster-gcode-streaming.test.ts`
- `npx tsx tests\time-estimator-stream.test.ts`
- `npx tsx tests\gcode-streaming-foundation.test.ts`
- `npx tsx tests\large-raster-plan-lazy-materialization.test.ts`
- `npx tsx tests\gcode-preview-large-job-sampling.test.ts`
- `npx tsx tests\plan-optimizer-large-raster.test.ts`
- `npx tsx tests\emitted-burn-envelope-stream.test.ts`

### Stop Conditions

Stop if a proposed "streaming" fix still creates full G-code text before sending.

## LF-EXT-LW4-003: Compare raster feature controls against LaserForge Easy/Pro behavior

Risk: MEDIUM
Status: VERIFIED

Learned from: LaserWeb4
Evidence: `repo-notes/04-laserweb4.md`; LaserWeb4 `src/reducers/operation.js`; LaserWeb4 `src/lib/cam-gcode-raster.js`; LaserWeb4 `src/lib/lw.raster2gcode/raster-to-gcode.js`
LaserForge target: raster planner, raster settings UI, Easy/Pro mode feature map, raster output tests
Action type: ADAPT PATTERN

### External Pattern

LaserWeb4 exposes raster controls for overscan, trim-line, join-pixel, burn-white, dithering, diagonal scanning, grayscale/filtering, shades of gray, and power range.

### LaserForge Current State

LaserForge already exposes and verifies the raster controls that matter for the current product scope: `dither`, `grayscale`, and `threshold` image modes; multiple dithering algorithms; threshold; brightness/contrast/gamma/invert; smart/manual overscan; bidirectional row handling; grayscale power merge tolerance; worker-backed image preprocessing; cancellation; preview/output parity guards; and compiler-side entitlement stripping for Pro-only executable settings. The raster planner keeps white pixels off when `powerMin` is zero, warns for grayscale `powerMin > 0`, emits modal `M4` safely, treats overscan as `S0` travel, and preserves lazy/spooled large-raster behavior.

LaserWeb4-specific knobs such as trim-line, join-pixel, burn-white, diagonal scanning, and extra filter toggles are not copied by default. They are feature candidates only, not defects, unless a later LaserForge user workflow has a concrete trigger path and golden output expectation.

### Gap

No current production correctness gap found. The remaining difference is product-surface breadth: LaserForge intentionally has fewer raster knobs than LaserWeb4, while the implemented modes have stronger safety/output tests. Future raster feature additions must be introduced behind golden output, preview parity, and Easy/Pro entitlement tests.

### Proposed Change

No code change required for this finding. Keep LaserWeb4's broad raster surface as a comparison catalog, but do not add controls without evidence that the control improves a real LaserForge workflow and does not create preview/output or safety ambiguity.

### Tests Required

Require golden output fixtures for overscan, white gaps, power mapping, image filter settings, large image jobs, preview/output consistency, and Easy/Pro mode defaults.

### Verification

Verified with:

- `npx tsx tests\raster-output-uses-modal-m4.test.ts`
- `npx tsx tests\raster-m4-no-software-splitting.test.ts`
- `npx tsx tests\raster-overscan-as-s0-travel.test.ts`
- `npx tsx tests\raster-bidirectional-row-parity.test.ts`
- `npx tsx tests\raster-pixel-fixtures.test.ts`
- `npx tsx tests\raster-grayscale-merge-tolerance.test.ts`
- `npx tsx tests\raster-move-iterator.test.ts`
- `npx tsx tests\raster-power-min-preflight.test.ts`
- `npx tsx tests\image-processing.test.ts`
- `npx tsx tests\image-processing-worker-equivalence.test.ts`
- `npx tsx tests\image-settings-transforms.test.ts`
- `npx tsx tests\raster-dither-selection-commit.test.ts`
- `npx tsx tests\jobcompiler-uses-processed-data-pass4b.test.ts`
- `npx tsx tests\jobcompiler-raster-preprocessing-cancel.test.ts`
- `npx tsx tests\jobcompiler-strips-pro-settings-without-license.test.ts`
- `npx tsx tests\jobcompiler-keeps-pro-settings-with-license.test.ts`

### Stop Conditions

Stop if a feature request would alter emitted raster G-code without golden output and preview evidence.

## LF-EXT-LW4-004: Reject warning-only bounds and unsafe-start gating

Risk: HIGH
Status: FIXED

Learned from: LaserWeb4
Evidence: `repo-notes/04-laserweb4.md`; LaserWeb4 `src/components/jog.js`
LaserForge target: preflight bounds, WCS consent, frame-ticket/start gates, beginner/pro user-mode gates
Action type: REJECT PATTERN

### External Pattern

LaserWeb4 warns when G-code appears out of machine bounds and styles the run button, but the inspected UI path does not prove a service-level hard block.

### LaserForge Current State

LaserForge rejects LaserWeb4's warning-only safety pattern. Current service/UI evidence shows hard gates for unknown bed dimensions, output bounds, negative workspace unless explicitly allowed, stale/missing frame proof, WCS/placement uncertainty, recovery-required state, stale job tickets, profile/capability mismatch, active operation mutexes, and controller-side full-line bounds rechecks. Beginner mode requires a real frame before start; advanced mode may use an explicit unframed-start override, and that override is logged in the machine event ledger. Profile-specific compatibility exceptions exist for machines that cannot provide every proof, but they do not bypass core output/preflight blockers.

### Gap

No production safety-gate gap found. One stale test fixture was corrected: `tests/frame-ticket-start-gate.test.ts` now installs a known-bed active profile before asserting frame-ticket rejection, so the test exercises the intended frame proof invariant instead of failing earlier on the newer unknown-bed service gate.

### Proposed Change

Keep the current model: hard service/controller gates for unsafe output and machine uncertainty, with narrow profile-backed compatibility exceptions and auditable explicit overrides for non-critical workflow recommendations such as advanced unframed start.

### Tests Required

Require negative-path tests for out-of-bounds jobs, stale/missing frame ticket, WCS uncertainty, recovery-required state, active test-fire mutex, and explicit override audit logs.

### Verification

Verified with:

- `npx tsx tests\user-mode-gates.test.ts`
- `npx tsx tests\user-mode-policy-production-wiring.test.ts`
- `npx tsx tests\workflow-panel-frame-ticket-start-gate.test.ts`
- `npx tsx tests\ui-start-frame-ticket-proof.test.ts`
- `npx tsx tests\preflight-bounds.test.ts`
- `npx tsx tests\machine-transform-fused-bounds.test.ts`
- `npx tsx tests\service-start-blocks-unknown-bed.test.ts`
- `npx tsx tests\preflight-negative-coords.test.ts`
- `npx tsx tests\controls-reset-wcs-baseline.test.tsx`
- `npx tsx tests\start-mode-wcs-reset.test.ts`
- `npx tsx tests\wcs-no-listener-blocks-job.test.ts`
- `npx tsx tests\recovery-state-blocks-start.test.ts`
- `npx tsx tests\validated-job-ticket-mismatch.test.ts`
- `npx tsx tests\ticket-capability-snapshot-validation.test.ts`
- `npx tsx tests\profile-change-blocks-start.test.ts`
- `npx tsx tests\operation-mutex-prevents-overlap.test.ts`
- `npx tsx tests\machine-service-start-validated-job.test.ts`
- `npx tsx tests\failed-start-preserves-unsafe-state-when-streamed.test.ts`
- `npx tsx tests\start-readiness-panel.test.tsx`
- `npx tsx tests\frame-ticket-start-gate.test.ts`
- `npx tsx tests\frame-required-before-start.test.ts`
- `npx tsx tests\start-readiness-frame-control-gate.test.ts`
- `npx tsx tests\controller-bounds-recheck.test.ts`
- `npx tsx tests\preflight-z-axis-bounds.test.ts`
- `npx tsx tests\controller-bounds-full-scan.test.ts`
- `npx tsx tests\controller-bounds-checks-g91.test.ts`
- `npx tsx tests\wcs-profile-gate-contract.test.ts`
- `npx eslint tests\frame-ticket-start-gate.test.ts --max-warnings 0`
- `npx tsc --noEmit --pretty false`

### Stop Conditions

Stop if a proposed safety gate would lock out legitimate machines without a safe override, or if a proposed override weakens hard safety invariants without evidence.

## LF-EXT-LW4-005: Compare parsed-output preview parity against LaserForge preview/output

Risk: MEDIUM
Status: VERIFIED

Learned from: LaserWeb4
Evidence: `repo-notes/04-laserweb4.md`; LaserWeb4 `src/lib/tmpParseGcode.js`; LaserWeb4 `src/draw-commands/GcodePreview.js`; LaserWeb4 `src/draw-commands/LaserPreview.js`
LaserForge target: preview compiler, simulator, output parser, burn-bounds tests, export/send consistency tests
Action type: ADAPT PATTERN

### External Pattern

LaserWeb4 reparses emitted G-code text and derives both path preview and laser preview from the same parsed output array.

### LaserForge Current State

LaserForge already adapts the useful part of the LaserWeb4 pattern: emitted G-code is parsed for preview/burn-envelope checks, while the live canvas preview is pinned to compiled plan/output context instead of guessed UI state. Current tests cover modal laser state, same-block words, comments, relative mode, arcs, stream chunk modal continuity, raster overscan, frame-vs-burn equivalence, large preview sampling, and UI start sending the same ticket/output that was previewed.

### Gap

No current preview/output parity gap found in this sector.

### Proposed Change

No code change required. Keep this as a regression guard: preview must expose emitted-output risks, not hide them behind a prettier independent UI model.

### Tests Required

Require preview/output parity fixtures for M3, M4, M5, G0, G1, S-values, raster gaps, fill engraving, arcs if supported, export-vs-send consistency, and large spool-backed jobs.

### Verification

Verified with:

- `npx tsx tests\gcode-preview-output-parity-fixtures.test.ts`
- `npx tsx tests\gcode-preview-laser-state.test.ts`
- `npx tsx tests\gcode-preview-relative-mode.test.ts`
- `npx tsx tests\gcode-preview-arcs.test.ts`
- `npx tsx tests\analyze-burn-bounds.test.ts`
- `npx tsx tests\emitted-burn-envelope-arcs.test.ts`
- `npx tsx tests\emitted-burn-envelope-r-mode-arcs.test.ts`
- `npx tsx tests\emitted-burn-envelope-stream.test.ts`
- `npx tsx tests\canvas-toolpath-preview-travel-classification.test.ts`
- `npx tsx tests\frame-vs-burn-equivalence.test.ts`
- `npx tsx tests\gcode-preview-large-job-sampling.test.ts`
- `npx tsx tests\ui-start-job-end-to-end.test.ts`

### Stop Conditions

Stop if proposed preview code would hide unsafe emitted output instead of exposing it.

## LF-EXT-LW4-006: Reject legacy dependency, test, and release posture

Risk: LOW
Status: VERIFIED

Learned from: LaserWeb4
Evidence: `repo-notes/04-laserweb4.md`; LaserWeb4 `package.json`; LaserWeb4 `.travis.yml`; LaserWeb4 `.github/`
LaserForge target: npm dependency policy, CI gates, release packaging, SBOM/signing/provenance workflows
Action type: REJECT PATTERN

### External Pattern

LaserWeb4 has old packages, git dependencies, a separate binaries repo, no confirmed modern GitHub Actions gate in the inspected clone, and no confirmed test command.

### LaserForge Current State

LaserForge rejects this LaserWeb4 anti-pattern. The current repo has a real `npm test` runner, default CI release-confidence checks, production dependency audit coverage, typecheck/lint/build/test gates, pinned security-sensitive dependencies, production bundle leak checks, signed Windows/macOS workflows, machine-checkable release QA confirmation, installer QA documentation, checksums, SBOM generation, draft release publishing controls, and artifact attestations.

### Gap

No current release/dependency posture gap found in this sector. Hardware validation and actual signed release execution still remain operational release tasks, but they are not evidence of a code/workflow anti-pattern matching LaserWeb4.

### Proposed Change

No code change required. Keep LaserForge's release gates stronger than this comparator and do not weaken the QA confirmation, signed workflow, SBOM, checksum, or attestation requirements.

### Tests Required

Require CI workflow checks, release QA gate tests, SBOM/checksum/provenance verification, and no placeholder test scripts.

### Verification

Verified with:

- `npx tsx tests\security-deps-pinned.test.ts`
- `npx tsx tests\production-security-source-checks.test.ts`
- `npx tsx tests\release-openbuilds-antipatterns.test.ts`
- `npx tsx tests\production-bundle-smoke.test.ts`
- `npx tsx tests\release-github-publish-workflows.test.ts`
- `npx tsx tests\release-sbom-workflows.test.ts`
- `npx tsx tests\release-artifact-attestations.test.ts`
- `npx tsx tests\windows-signing-release-workflow.test.ts`
- `npx tsx tests\macos-signing-notarization-workflow.test.ts`
- `npx tsx tests\installer-qa-matrix.test.ts`
- `npx tsx tests\code-signing-config.test.ts`
- `npx tsx tests\default-ci-release-confidence.test.ts`
- `npx tsx tests\release-artifact-integrity.test.ts`
- `npx tsx tests\native-deps-prebuild-check.test.ts`
- `npx tsx tests\tester-secret-not-in-source.test.ts`

### Stop Conditions

Stop if release changes would loosen existing gates or publish artifacts without machine-checkable QA evidence.

## LF-EXT-VISI-001: Compare VisiCut job-preparation boundary against LaserForge architecture

Risk: MEDIUM
Status: VERIFIED

Learned from: VisiCut
Evidence: `repo-notes/05-visicut.md`; VisiCut `src/main/java/de/thomas_oster/visicut/VisicutModel.java`; VisiCut `src/main/java/de/thomas_oster/visicut/model/LaserProfile.java`
LaserForge target: `PipelineService`, scene/job/plan/output modules, validated tickets, preview/output modules
Action type: ADAPT PATTERN

### External Pattern

VisiCut converts PLF parts, mappings, profiles, focus, rotary settings, and start point into one `LaserJob`, then delegates output/send behavior to `LaserCutter`.

### LaserForge Current State

Reviewed in this study phase. LaserForge already has a comparable separation pattern:

- Scene/profile/material/start-mode inputs are snapshotted into compile-time artifacts and `ValidatedJobTicket` fingerprints.
- Stale compile results are dropped by request id and stale tickets are blocked before device start.
- UI start uses the compiled ticket reference instead of re-splitting arbitrary UI G-code text.
- Controller execution consumes family/format-checked ticket output (`gcode-lines` or `gcode-stream`) rather than raw project state.
- Preview/burn-envelope checks are derived from compiled output and pinned active-job canvas context, not live mutable UI state.
- Electron IPC does not expose native serial `sendGcode` shortcuts that would bypass the app/controller boundary.

### Gap

No current architecture-boundary gap found for this comparator. LaserForge adapts the useful VisiCut concept of separating project/job preparation from driver output while adding runtime ticket/fingerprint validation.

### Proposed Change

No code change required. Keep this as a regression sector: future output, preview, import, or device-send work must preserve the scene/job/plan/output/device boundary and must not introduce UI-to-device raw G-code shortcuts.

### Tests Required

Covered by existing tests for scene/job snapshotting, compile race guards, stale-output rejection, validated job tickets, family/output format gates, UI start ticket use, preview/output parity, burn-envelope divergence, and Electron serial IPC boundary.

### Verification

Passed:

- `npx tsx tests\validated-job-ticket-phase1.test.ts`
- `npx tsx tests\validate-job-ticket.test.ts`
- `npx tsx tests\validated-job-ticket-mismatch.test.ts`
- `npx tsx tests\ticket-determinism-entitlement-and-presets.test.ts`
- `npx tsx tests\compiled-job-state.test.ts`
- `npx tsx tests\compile-race-guard.test.ts`
- `npx tsx tests\stale-gcode-blocks-start.test.ts`
- `npx tsx tests\ui-start-job-uses-ticket.test.tsx`
- `npx tsx tests\pipeline-compile-accepts-profile-snapshot.test.ts`
- `npx tsx tests\execute-job-output-contract.test.ts`
- `npx tsx tests\family-agnostic-ticket.test.ts`
- `npx tsx tests\controller-interface-protocol-neutral.test.ts`
- `npx tsx tests\scene-canvas-machine-coord-check.test.ts`
- `npx tsx tests\no-gcode-in-ui.test.ts`
- `npx tsx tests\no-electron-sendgcode-export.test.ts`
- `npx tsx tests\job-fingerprint-start-validation.test.ts`
- `npx tsx tests\burn-envelope-divergence.test.ts`
- `npx tsx tests\ui-start-job-end-to-end.test.ts`
- `npx tsx tests\active-job-canvas-context-pinned.test.ts`
- `npx tsx tests\active-job-canvas-context-cleared.test.ts`

### Stop Conditions

Stop if future work tries to solve this by a broad architecture rewrite instead of preserving the validated ticket/fingerprint/output contract.

## LF-EXT-VISI-002: Verify bounds and capability checks happen at send/export boundaries

Risk: HIGH
Status: VERIFIED

Learned from: VisiCut
Evidence: `repo-notes/05-visicut.md`; LibLaserCut `LaserCutter.java`; LibLaserCut `AllDriversTest.java`
LaserForge target: preflight bounds, ticket validation, send/export paths, profile/device capability modules
Action type: ADAPT PATTERN

### External Pattern

LibLaserCut's `LaserCutter.checkJob()` validates supported resolution, bed bounds, rotary support, and rotary diameter before send/save. Tests expect oversized jobs to throw.

### LaserForge Current State

Reviewed in this study phase. LaserForge has hard checks at multiple send/export-adjacent boundaries:

- Preflight blocks negative output coordinates, bed overrun, missing output G-code, unknown laser mode for M4 output on connected hardware, unsupported Z stepping, and emitted G-code semantic hazards.
- Start service rejects unknown bed dimensions before streaming any G-code.
- Runtime ticket validation rejects scene/profile/controller/G-code drift before `executeJob`.
- Ticket capability snapshots reject controller setting, identity, bed-size, laser-mode, and execution-model drift.
- Controller-side GRBL job bounds scanning checks the full line stream, including late absolute moves and accumulated relative `G91` moves.
- Controller family/output format gates reject unsupported output families and formats before device execution.
- Output-layer filters keep guide/non-output geometry out of preflight and frame bounds.
- UI generators for kerf/material tests block out-of-bed generated jobs before adding them to the scene.

### Gap

No current send-boundary capability/bounds gap found for this comparator. Rotary remains an unsupported/future capability, so there is no active rotary send path to harden here.

### Proposed Change

No code change required. Keep the LibLaserCut `checkJob()` idea as a regression standard: every future device/export path must have a machine-checkable preflight/ticket/capability gate, not just UI warnings.

### Tests Required

Covered by existing tests for oversized-job rejection, negative coordinate policy, Z-axis caveat, unknown bed blocking, capability mismatch, ticket capability snapshots, profile/ticket drift, semantic emitted-G-code validation, full controller bounds scan, relative bounds, output-layer filtering, and generated test-grid bounds.

### Verification

Passed:

- `npx tsx tests\preflight-bounds.test.ts`
- `npx tsx tests\preflight-negative-coords.test.ts`
- `npx tsx tests\preflight-z-axis-bounds.test.ts`
- `npx tsx tests\controller-bounds-full-scan.test.ts`
- `npx tsx tests\controller-bounds-checks-g91.test.ts`
- `npx tsx tests\controller-bounds-recheck.test.ts`
- `npx tsx tests\controller-capabilities-enforced.test.ts`
- `npx tsx tests\preflight-capability-mismatches.test.ts`
- `npx tsx tests\conservative-unknown-capability-handling.test.ts`
- `npx tsx tests\ticket-capability-snapshot-validation.test.ts`
- `npx tsx tests\profile-change-blocks-start.test.ts`
- `npx tsx tests\output-gcode-semantic-preflight.test.ts`
- `npx tsx tests\fill-interval-cap-preflight.test.ts`
- `npx tsx tests\kerf-wizard-bounds-block.test.tsx`
- `npx tsx tests\material-test-bounds-block.test.tsx`
- `npx tsx tests\svg-file-size-preflight.test.ts`
- `npx tsx tests\validated-job-ticket-mismatch.test.ts`
- `npx tsx tests\validate-job-ticket.test.ts`
- `npx tsx tests\execute-job-output-contract.test.ts`
- `npx tsx tests\family-agnostic-ticket.test.ts`
- `npx tsx tests\preflight-output-layer-filter.test.ts`
- `npx tsx tests\frame-bounds-output-layer-filter.test.ts`
- `npx tsx tests\wcs-profile-gate-contract.test.ts`
- `npx tsx tests\service-start-blocks-unknown-bed.test.ts`

### Stop Conditions

Stop if future hard gates would block legitimate machines without a safe explicit override, logged audit trail, and clear capability/profile reason.

## LF-EXT-VISI-003: Verify WCS/start-point transforms are idempotent

Risk: HIGH
Status: VERIFIED

Learned from: VisiCut
Evidence: `repo-notes/05-visicut.md`; LibLaserCut `LaserJob.java`
LaserForge target: WCS reset-to-baseline, origin transforms, placement certainty, preflight bounds, repeated compile/start paths
Action type: ADAPT PATTERN

### External Pattern

LibLaserCut's `applyStartPoint()` subtracts the start point once, stores transformed origin, then resets the start point so multiple calls do not corrupt coordinates.

### LaserForge Current State

Reviewed in this study phase. LaserForge has an explicit WCS/origin model:

- Reset WCS to baseline is a dedicated operation (`G10 L2 P1 X0 Y0 Z0`) routed through operation gates rather than hidden inside job start.
- WCS normalization requires idle/no-active-job conditions and marks placement uncertain when it cannot safely apply.
- Saved-origin mode records/verifies G54 snapshots before frame/start and invalidates them on approved G10/G92 mutations.
- Saved-origin placement does not make compile output depend on the stored origin value; repeated compile/output paths remain deterministic.
- Runtime start validation rejects profile/capability drift and job-fingerprint drift before streaming.
- Machine transforms fuse transformed bounds with output moves so preflight uses the intended coordinate space.

### Gap

No current idempotence gap found for this comparator. LaserForge adapts the LibLaserCut idea by keeping WCS/start-position effects explicit, gated, snapshot-verified, and not repeatedly baked into output.

### Proposed Change

No code change required. Keep WCS/start-position behavior as a regression sector: future frame/start/import work must prove offsets are applied exactly once and that start does not silently normalize or mutate WCS.

### Tests Required

Covered by existing tests for reset-to-baseline, WCS operation gating, saved-origin lifecycle, saved-origin G54 verification, saved-origin compile determinism, frame saved-origin verification, no-listener placement uncertainty, ticket/capability drift, G-code encoder state isolation, relative/absolute modes, machine transform bounds, and preflight bounds.

### Verification

Passed:

- `npx tsx tests\controls-reset-wcs-baseline.test.tsx`
- `npx tsx tests\start-mode-wcs-reset.test.ts`
- `npx tsx tests\saved-origin-wcs-lifecycle.test.ts`
- `npx tsx tests\savedorigin-not-compile-invalidating.test.ts`
- `npx tsx tests\saved-origin-verifies-wcs.test.ts`
- `npx tsx tests\saved-origin-production-tip.test.ts`
- `npx tsx tests\frame-saved-origin-verify.test.ts`
- `npx tsx tests\wcs-no-listener-blocks-job.test.ts`
- `npx tsx tests\wcs-normalization-operation-gate.test.ts`
- `npx tsx tests\profile-change-blocks-start.test.ts`
- `npx tsx tests\ticket-capability-snapshot-validation.test.ts`
- `npx tsx tests\gcode-encoder-state-isolation.test.ts`
- `npx tsx tests\gcode-emitter-purity-and-zero-distance.test.ts`
- `npx tsx tests\gcode-relative-mode.test.ts`
- `npx tsx tests\machine-transform-fused-bounds.test.ts`
- `npx tsx tests\preflight-bounds.test.ts`

### Stop Conditions

Stop if hardware-specific WCS assumptions are needed but not documented for supported machines.

## LF-EXT-VISI-004: Audit raster white-pixel and rapid-move compatibility

Risk: HIGH
Status: VERIFIED

Learned from: VisiCut
Evidence: `repo-notes/05-visicut.md`; LibLaserCut `LaserCutter.java`; LibLaserCut `GenericGcodeDriver.java`; LibLaserCut `Grbl.java`
LaserForge target: raster planner, G-code emitter, preview/bounds parser, M3/M4/M5/S-value preflight, machine profile compatibility
Action type: ADAPT PATTERN

### External Pattern

LibLaserCut explicitly chooses between `lineto()` with 0% power and `moveto()` for white pixels depending on machine compatibility, and its GRBL driver uses `S0` during rapid moves to blank the laser.

### LaserForge Current State

Reviewed in this study phase. LaserForge has explicit raster/travel separation and G-code semantic checks:

- Raster output uses one modal `M4` scope for raster operations with `M5` only at the end.
- Overscan approach/exit and white/gap travel are emitted as `S0` feed moves, while burn bounds exclude overscan.
- White pixels and blank rows do not produce burn segments.
- Disconnected vector subpaths emit safe non-burn travel between subpaths and keep the laser off at the boundary.
- Output semantic preflight blocks unsafe `M3` rapid moves with non-zero `S`, over-max `S`, missing final laser-off, overlong lines, and unsupported emitted commands.
- Preview/burn-envelope analyzers classify rapid, burn, S0 travel, mid-job laser-off, M3/M4 modal state, arcs, and stream chunk continuity.
- Preflight rejects M4 output unless `$32=1` is confirmed or spool metadata indicates the dynamic-power requirement safely.

### Gap

No current white-gap/rapid-move compatibility gap found for this comparator. The current test suite directly covers the user-reported "unwanted connector cut" class via disconnected subpath travel safety and preview/output parity.

### Proposed Change

No code change required. Keep LibLaserCut's white-pixel compatibility pattern as a regression standard: future raster/vector changes must prove whether non-burn travel is `G0`/laser-off or `G1 S0`, and preview/bounds must not count it as burn.

### Tests Required

Covered by existing tests for modal M4 raster output, no software splitting, S0 overscan travel, bidirectional row parity, white-pixel fixtures, grayscale merge/gaps, power-min warning, semantic G-code preflight, preview laser state, preview travel classification, burn bounds, stream burn-envelope parsing, disconnected subpath travel safety, preview/output parity, frame-vs-burn equivalence, and M4 `$32` preflight.

### Verification

Passed:

- `npx tsx tests\raster-output-uses-modal-m4.test.ts`
- `npx tsx tests\raster-m4-no-software-splitting.test.ts`
- `npx tsx tests\raster-overscan-as-s0-travel.test.ts`
- `npx tsx tests\raster-bidirectional-row-parity.test.ts`
- `npx tsx tests\raster-pixel-fixtures.test.ts`
- `npx tsx tests\raster-grayscale-merge-tolerance.test.ts`
- `npx tsx tests\raster-power-min-preflight.test.ts`
- `npx tsx tests\output-gcode-semantic-preflight.test.ts`
- `npx tsx tests\gcode-preview-laser-state.test.ts`
- `npx tsx tests\canvas-toolpath-preview-travel-classification.test.ts`
- `npx tsx tests\analyze-burn-bounds.test.ts`
- `npx tsx tests\emitted-burn-envelope-stream.test.ts`
- `npx tsx tests\disconnected-subpath-travel-safety.test.ts`
- `npx tsx tests\gcode-preview-output-parity-fixtures.test.ts`
- `npx tsx tests\frame-vs-burn-equivalence.test.ts`
- `npx tsx tests\preflight-rejects-m4-without-laser-mode.test.ts`

### Stop Conditions

Stop if a proposed change alters emitted machine motion without golden output tests and hardware-validation notes.

## LF-EXT-VISI-005: Strengthen golden output and repeated-generation proof

Risk: HIGH
Status: VERIFIED

Learned from: VisiCut
Evidence: `repo-notes/05-visicut.md`; LibLaserCut `AllDriversTest.java`; LibLaserCut `test-output/*.out`
LaserForge target: output emitter tests, generator determinism tests, export/send fixture suite, LF-001 state-isolation tests
Action type: ADAPT PATTERN

### External Pattern

LibLaserCut compares driver output against committed known-good files and repeats generation to catch hidden mutable driver state.

### LaserForge Current State

Reviewed in this study phase. LaserForge has committed G-code golden snapshots for major output sectors and repeated-generation/state-isolation tests:

- E2E snapshots cover rectangle, circle, mixed scene, engrave/fill, multi-pass cut, score line, text outlines, absolute origin, saved origin, and default test grid output.
- Snapshot tests include semantic assertions for laser-off before laser-on, no burn during rapid moves, max S, positive feeds, finite coordinates, final laser-off, burn bounds, and expected mode.
- Repeated-generation tests cover per-run encoder state isolation, compile determinism across entitlement/material preset inputs, deterministic clock injection, deterministic path-optimizer budget behavior, and ticket-only spool materialization.
- The default test grid is snapshot-pinned and deterministic.

### Gap

No current golden-output/repeated-generation gap found for the output sectors inspected here. Remaining future output modes should follow the same snapshot-plus-semantic pattern before being considered release-safe.

### Proposed Change

No code change required. Keep the LibLaserCut golden-output pattern as a regression requirement: every output-affecting change must either preserve existing snapshots or update them with explicit human review and safety notes.

### Tests Required

Covered by existing golden snapshots and determinism tests for vector, raster/fill, mixed scenes, text, origin modes, test grids, ticket determinism, encoder isolation, path optimizer determinism, and spool ticket-only compile.

### Verification

Passed:

- `npx tsx tests\e2e\rectangle-cut.test.ts`
- `npx tsx tests\e2e\circle-cut.test.ts`
- `npx tsx tests\e2e\mixed-scene.test.ts`
- `npx tsx tests\e2e\engrave-fill.test.ts`
- `npx tsx tests\e2e\multi-pass-cut.test.ts`
- `npx tsx tests\e2e\score-line.test.ts`
- `npx tsx tests\e2e\text-hershey-sans.test.ts`
- `npx tsx tests\e2e\text-bundled-inter.test.ts`
- `npx tsx tests\e2e\origin-absolute.test.ts`
- `npx tsx tests\e2e\origin-saved.test.ts`
- `npx tsx tests\test-grid-generator.test.ts`
- `npx tsx tests\gcode-encoder-state-isolation.test.ts`
- `npx tsx tests\ticket-determinism-entitlement-and-presets.test.ts`
- `npx tsx tests\output-deterministic-with-clock-injection.test.ts`
- `npx tsx tests\path-optimizer-deterministic-budget.test.ts`
- `npx tsx tests\lf004-spooled-compile-materialization.test.ts`

### Stop Conditions

Stop if fixture updates would bless changed unsafe output without human review.

## LF-EXT-VISI-006: Compare PLF-style source/transform/mapping persistence against LaserForge documents

Risk: MEDIUM
Status: VERIFIED

Learned from: VisiCut
Evidence: `repo-notes/05-visicut.md`; VisiCut `VisicutModel.loadPlfFile()`; VisiCut `VisicutModel.savePlfToStream()`
LaserForge target: project save/load, autosave recovery, import/export, document transforms, operation/material mappings
Action type: ADAPT PATTERN

### External Pattern

VisiCut's PLF container preserves source graphics, transforms, mappings, and parametric parameter files.

### LaserForge Current State

Reviewed in this study phase. LaserForge preserves project/source state through several explicit mechanisms:

- Project fixtures for current and legacy `.lfproj` files deserialize, compile, optimize, and emit G-code.
- Scene serialization/autosave round trips preserve image sources and raster payloads while keeping autosave compact.
- Atomic autosave records include checksums, previous-slot fallback, and manual-save/autosave dirty-state separation.
- Migration pipeline and repair reports load legacy/future-ish project envelopes without silently dropping repair evidence.
- Device profile snapshots and material preset snapshots survive round trip and detect drift.
- SVG/DXF imports preserve transforms, units, nested transforms, operation mappings, and legacy polyline vertices.
- Image-setting transforms invalidate caches and preserve committed settings.
- Source text migration preserves editable source text while moving away from legacy `_sourceText`.
- Missing IndexedDB image references are detected and annotated instead of silently compiling bad output.
- Large project load/save paths warn before expensive reads and route large parses through the shared parser/worker boundary.

### Gap

No current PLF-style persistence gap found for this comparator. LaserForge does not use a PLF ZIP container, but it preserves the relevant project/source/transform/profile/material/image state through its own `.lfproj`, autosave, migration, and validation layers.

### Proposed Change

No code change required. Keep the VisiCut PLF pattern as a regression standard: future project-format changes must prove source graphics, transforms, operation mappings, profile/material snapshots, image references, and recovery metadata survive round trip.

### Tests Required

Covered by existing tests for project fixtures, autosave serialization/images, atomic autosave/previous slot, manual-save separation, migrations, repair reports, profile/material snapshots, SVG/DXF import transforms and units, operation mapping, image settings/cache invalidation, source text migration, image reference validation, and large-project handling.

### Verification

Passed:

- `npx tsx tests\autosave-serialization.test.ts`
- `npx tsx tests\autosave-preserves-images.test.ts`
- `npx tsx tests\atomic-autosave-record.test.ts`
- `npx tsx tests\autosave-previous-slot.test.ts`
- `npx tsx tests\autosave-manual-save-separation.test.ts`
- `npx tsx tests\autosave-dirty-flag-on-failure.test.ts`
- `npx tsx tests\autosave-pauses-during-active-job.test.ts`
- `npx tsx tests\manual-save-needs-acknowledgement.test.ts`
- `npx tsx tests\backward-compat-project-fixtures.test.ts`
- `npx tsx tests\migration-pipeline.test.ts`
- `npx tsx tests\migration-pipeline-wired-into-loader.test.ts`
- `npx tsx tests\load-repair-report.test.ts`
- `npx tsx tests\project-profile-snapshot.test.ts`
- `npx tsx tests\app-profile-apply-import.test.ts`
- `npx tsx tests\material-preset-snapshot.test.ts`
- `npx tsx tests\import-operation-mapping.test.ts`
- `npx tsx tests\svg-import.test.ts`
- `npx tsx tests\svg-import-placement.test.ts`
- `npx tsx tests\dxf-unit-import.test.ts`
- `npx tsx tests\dxf-polyline-vertex-import.test.ts`
- `npx tsx tests\image-settings-transforms.test.ts`
- `npx tsx tests\source-text-migration.test.ts`
- `npx tsx tests\image-reference-validation.test.ts`
- `npx tsx tests\large-project-handling.test.ts`

### Stop Conditions

Stop if proposed project-format changes require migration decisions or backward compatibility policy.

## LF-EXT-LLC-001: Verify controller capability checks at trusted boundaries

Risk: HIGH
Status: FIXED

Learned from: LibLaserCut
Evidence: `repo-notes/06-liblasercut.md`; LibLaserCut `LaserCutter.java`; LibLaserCut `AllDriversTest.java`
LaserForge target: device profiles, preflight bounds, start/send ticket validation, export path, profile compatibility, rotary/Z caveats
Action type: ADAPT PATTERN

### External Pattern

LibLaserCut centralizes cutter suitability checks in `LaserCutter.checkJob(...)`, rejecting unsupported rotary use, invalid rotary diameter, unsupported DPI, negative bounds, and jobs outside the bed before driver send/save.

### LaserForge Current State

Reviewed against the current code. LaserForge already had profile/ticket/fingerprint gates, bed-dimension gates, output-target resolution, and UI operation capability gates. The focused review found one trusted-boundary gap: a direct `MachineService.startValidatedJob()` caller could bypass the controller operation matrix when a controller advertised no executable output format.

### Gap

Closed. `MachineService.startValidatedJob()` now resolves the controller capability declaration with the active profile and calls the central `canExecuteOperation('job-start', ...)` gate before ticket validation or streaming. Controllers without `capabilities` fall back to GRBL capabilities for backward-compatible existing mocks/controllers.

### Proposed Change

Production change made at the device-start boundary only: expose controller capabilities on the controller interfaces/GRBL controller, then reject non-executable controller output at `MachineService.startValidatedJob()` before `executeJob()`.

### Tests Required

Added/updated tests prove:
- a controller with no executable output is rejected at the service start boundary;
- rejection happens before `executeJob()`;
- existing ticket, family, output-target, profile-change, unknown-bed, controller-matrix, capability-mismatch, and output tests still pass.

### Verification

Passed:
- `npx tsx tests/machine-service-start-validated-job.test.ts`
- `npx tsx tests/controller-matrix/operation-routing-by-family.test.ts`
- `npx tsx tests/family-agnostic-ticket.test.ts`
- `npx tsx tests/service-start-blocks-unknown-bed.test.ts`
- `npx tsx tests/validated-job-ticket-mismatch.test.ts`
- `npx tsx tests/ticket-capability-snapshot-validation.test.ts`
- `npx tsx tests/profile-change-blocks-start.test.ts`
- `npx tsx tests/output-target-resolution.test.ts`
- `npx tsx tests/pipeline-compile-accepts-profile-snapshot.test.ts`
- `npx tsx tests/preflight-capability-mismatches.test.ts`
- `npx tsx tests/controller-settings-snapshot.test.ts`
- `npx tsx tests/controller-bounds-recheck.test.ts`
- `npx tsx tests/feature-matrix-enforcement.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint . --max-warnings 0`
- `npm run test:output`
- `npm run build`

### Stop Conditions

Stop if the fix would change supported-machine policy or require hardware-specific capability decisions.

## LF-EXT-LLC-002: Audit GRBL modal safety defaults by firmware profile

Risk: HIGH
Status: VERIFIED

Learned from: LibLaserCut
Evidence: `repo-notes/06-liblasercut.md`; LibLaserCut `drivers/Grbl.java`; LibLaserCut `drivers/GenericGcodeDriver.java`; `test-output/de.thomas_oster.liblasercut.drivers.Grbl.out`
LaserForge target: GRBL settings parser, output emitter, G-code modal semantics, M3/M4/M5/S-values, `$30/$31/$32`, rapid travel behavior, preflight dynamic-power checks
Action type: ADAPT PATTERN

### External Pattern

The LibLaserCut GRBL driver owns GRBL-specific safety defaults: wait-for-ok, pre-job `M3`, post-job `M5`, spindle max `1000`, and `G0 ... S0` rapid blanking because GRBL rapid motion does not itself guarantee laser-off semantics.

### LaserForge Current State

Reviewed against the current code. LaserForge uses explicit GRBL strategy/pipeline settings for `M3`/`M4`, max spindle scaling, `M5 S0`, `$32` dynamic-power preflight, `$30` max-spindle mismatch/unknown gates, and emitted-output burn-envelope parsing.

### Gap

No production gap found in this pass. LaserForge should not copy LibLaserCut's unconditional pre-job `M3` because LaserForge defaults to GRBL `M4` dynamic power and blocks M4 when connected firmware has not proven `$32=1`. The stale `$32=bogus` test text was corrected to match the existing fail-closed behavior: malformed `$32` is treated as unknown, not safe.

### Proposed Change

No production code change required. Keep the current LaserForge pattern: explicit `M5 S0` safety header/footer, parsed M4 detection, `$32`/`$30` preflight blockers, hard-off zero-power travel for compatibility, and output/parser tests rather than copying LibLaserCut's exact `M3` default.

### Tests Required

Coverage verified for M3/M4/M5/S-values, malformed `$32`, M4-without-laser-mode rejection, G0/non-burn parsing, hard-off zero-power travel, disconnected subpath travel safety, tab gap safety, burn-envelope divergence, and relative-mode output.

### Verification

Passed:
- `npx tsx tests/preflight-rejects-m4-without-laser-mode.test.ts`
- `npx tsx tests/gcode-emitter-purity-and-zero-distance.test.ts`
- `npx tsx tests/disconnected-subpath-travel-safety.test.ts`
- `npx tsx tests/tab-gap-uses-feed-not-rapid.test.ts`
- `npx tsx tests/gcode-preview-laser-state.test.ts`
- `npx tsx tests/burn-envelope-divergence.test.ts`
- `npx tsx tests/gcode-relative-mode.test.ts`
- `npx tsx tests/grbl-settings-parser.test.ts`

### Stop Conditions

Stop if a proposed change alters emitted laser-on/off behavior without golden output review and hardware-validation notes.

## LF-EXT-LLC-003: Prove WCS/start-point transforms are idempotent

Risk: HIGH
Status: VERIFIED

Learned from: LibLaserCut
Evidence: `repo-notes/06-liblasercut.md`; LibLaserCut `LaserJob.java`; LibLaserCut `LaserCutter.java`
LaserForge target: WCS reset-to-baseline, placement certainty, scene/job/plan coordinate transforms, repeated compile/preflight/start/export flows
Action type: ADAPT PATTERN

### External Pattern

LibLaserCut applies a start point once, records transformed origin, and resets the start point so repeated calls do not silently stack offsets.

### LaserForge Current State

Reviewed against the current code. LaserForge has explicit WCS reset-to-baseline helpers, saved-origin verification, placement-uncertain fail-closed behavior, WCS normalization operation gating, and deterministic compile tests.

### Gap

No production gap found in this pass. Repeated compile and saved-origin paths do not double-apply saved-origin offsets, WCS drift blocks start, failed/unknown WCS queries fail closed, and WCS normalization is refused during active/non-idle machine states.

### Proposed Change

No production code change required. Preserve the current model: scene geometry is compiled through one transform/fingerprint path, saved-origin mode normalizes design-local output instead of stacking the stored origin value, and live WCS proof is required before start.

### Tests Required

Coverage verified for local-origin transforms, fused machine bounds, right-origin X flip, WCS reset result handling, saved-origin lifecycle, WCS normalization operation gate, saved-origin verification, fail-closed WCS query behavior, no-listener WCS blocking, reset-WCS UI button, deterministic compile output, and saved-origin non-invalidating compile behavior.

### Verification

Passed:
- `npx tsx tests/origin-mode-wcs-zero.test.ts`
- `npx tsx tests/local-origin-transform-preserves-orientation.test.ts`
- `npx tsx tests/machine-transform-fused-bounds.test.ts`
- `npx tsx tests/right-origin-x-flip.test.ts`
- `npx tsx tests/start-mode-wcs-reset.test.ts`
- `npx tsx tests/saved-origin-wcs-lifecycle.test.ts`
- `npx tsx tests/wcs-normalization-operation-gate.test.ts`
- `npx tsx tests/saved-origin-verifies-wcs.test.ts`
- `npx tsx tests/wcs-query-error-fails-closed.test.ts`
- `npx tsx tests/wcs-fail-closed-integration.test.ts`
- `npx tsx tests/wcs-no-listener-blocks-job.test.ts`
- `npx tsx tests/controls-reset-wcs-baseline.test.tsx`
- `npx tsx tests/determinism-gate.test.ts`
- `npx tsx tests/savedorigin-not-compile-invalidating.test.ts`
- `npx tsx tests/app-start-mode-selection-helpers.test.ts`
- `npx tsx tests/app-start-mode-decisions.test.ts`

### Stop Conditions

Stop if the implementation depends on unsupported-machine WCS assumptions or would remove an operator safety consent gate.

## LF-EXT-LLC-004: Audit raster white-gap and overscan travel semantics

Risk: HIGH
Status: VERIFIED

Learned from: LibLaserCut
Evidence: `repo-notes/06-liblasercut.md`; LibLaserCut `LaserCutter.java`; LibLaserCut `RasterizableJobPartTest.java`; LibLaserCut `drivers/Grbl.java`
LaserForge target: raster planner, fill planner, vector travel, output emitter, preview/output consistency, machine profile compatibility
Action type: ADAPT PATTERN

### External Pattern

LibLaserCut makes white-gap behavior a deliberate compatibility choice: either smooth 0%-power line motion or travel/move commands for machines that do not honor power scaling. It also clamps raster overscan/padding to transformed machine-space limits unless explicitly allowed.

### LaserForge Current State

Reviewed against the current code. The user's earlier unintended-cut-line report is directly relevant, so this pass checked separated vector subpaths, raster white pixels, tab gaps, hard-off zero-power travel, preview laser-state parsing, and burn-envelope divergence.

### Gap

No production gap found in this pass. LaserForge preserves disconnected subpaths without burn bridges, emits hard laser-off boundaries before separated burns, treats white raster pixels as non-burning, uses feed-rate S0 linear tab traversals rather than rapid burns, and derives preview/burn envelopes from emitted G-code semantics.

### Proposed Change

No production code change required. Preserve LaserForge's current compatibility choice: hard-off zero-power linear travel where needed, explicit M5 safety boundaries, M4/$32 preflight gates, and emitted-output parser verification.

### Tests Required

Coverage verified for separated islands, white pixels, raster M4 dynamic mode, tab gaps, zero-distance suppression, M4 preflight, preview laser-state, burn-envelope divergence, and output golden fixtures.

### Verification

Passed:
- `npx tsx tests/disconnected-subpath-travel-safety.test.ts`
- `npx tsx tests/raster-pixel-fixtures.test.ts`
- `npx tsx tests/raster-m4-no-software-splitting.test.ts`
- `npx tsx tests/tab-gap-uses-feed-not-rapid.test.ts`
- `npx tsx tests/gcode-emitter-purity-and-zero-distance.test.ts`
- `npx tsx tests/preflight-rejects-m4-without-laser-mode.test.ts`
- `npx tsx tests/gcode-preview-laser-state.test.ts`
- `npx tsx tests/burn-envelope-divergence.test.ts`
- `npm run test:output`

### Stop Conditions

Stop if fixing the issue requires choosing between `G0`, `G1 S0`, or `M5`/restart behavior without hardware profile evidence.

## LF-EXT-LLC-005: Expand golden output and repeated-generation proof

Risk: HIGH
Status: VERIFIED

Learned from: LibLaserCut
Evidence: `repo-notes/06-liblasercut.md`; LibLaserCut `AllDriversTest.java`; LibLaserCut `test-output/*.out`; LibLaserCut `test-output/README`
LaserForge target: output emitter tests, profile-specific golden fixtures, repeated compile tests, export/send consistency, LF-001 regression coverage
Action type: ADAPT PATTERN

### External Pattern

LibLaserCut compares every save-capable driver against committed output files and generates the same job twice to catch hidden driver state leakage.

### LaserForge Current State

Reviewed against the current code. LaserForge has committed golden G-code snapshots under `tests/e2e/snapshots/`, semantic output tests in the output lane, a golden material test-grid fixture, LF-001 encoder state-isolation tests, and LF-004 spool materialization tests.

### Gap

No production gap found in this pass. Golden fixtures currently cover common cut/score/engrave/text/origin/mixed scenes and the material test grid, while repeated-generation tests cover same-job determinism, compile order independence, interleaved compile contexts, relative/absolute mode isolation, max-spindle isolation, and spool-backed compile behavior.

### Proposed Change

No production code change required. Preserve the LibLaserCut-inspired pattern already present: versioned output snapshots plus semantic G-code assertions plus state-isolation tests, instead of relying only on ad hoc generated output.

### Tests Required

Coverage verified for GRBL output snapshots, profile-sensitive state isolation, repeated compile ordering, raster/fill/vector/text/test-grid output, relative mode, disconnected subpaths, spool-backed compile materialization, and semantic output checks.

### Verification

Passed:
- `npx tsx tests/gcode-encoder-state-isolation.test.ts`
- `npx tsx tests/gcode-emitter-purity-and-zero-distance.test.ts`
- `npx tsx tests/test-grid-generator.test.ts`
- `npx tsx tests/lf004-spooled-compile-materialization.test.ts`
- `npx tsx tests/gcode-relative-mode.test.ts`
- `npx tsx tests/disconnected-subpath-travel-safety.test.ts`
- `npm run test:output`
- `npx tsc --noEmit --pretty false`

### Stop Conditions

Stop if golden fixtures would bless changed unsafe output without review.

## LF-EXT-LLC-006: Treat local/network upload paths as device-control trust boundaries

Risk: MEDIUM
Status: VERIFIED

Learned from: LibLaserCut
Evidence: `repo-notes/06-liblasercut.md`; LibLaserCut `GenericGcodeDriver.java`; `audit-artifacts/liblasercut/driver-abstraction-surface.txt`
LaserForge target: Electron IPC, Falcon WiFi, serial/device permissions, future network-send/upload paths, URL/host validation, device-control schemas
Action type: ADAPT PATTERN

### External Pattern

LibLaserCut's generic G-code driver exposes host, HTTP upload URL, autoplay, API key, serial, and upload-method settings. This shows that once a laser sender supports local/network upload, configuration fields become part of the device-control security boundary.

### LaserForge Current State

Reviewed against the current code. LaserForge has a main-process Falcon target policy, trusted-sender checks on Falcon IPC handlers, strict renderer/Electron navigation controls, sandboxed renderer settings, removed native serial send IPC, and WiFi trust gates for safety-critical operations.

### Gap

No production gap found in this pass. Falcon IPC accepts only private LAN IPv4 targets at the main-process boundary and rejects renderer-supplied hostnames, URLs, ports, localhost, public IPs, link-local IPs, malformed values, and non-strings. Falcon HTTP/WebSocket clients can still accept `host:port` only in lower-level test harness paths, not through the exposed IPC policy.

### Proposed Change

No production code change required. Preserve the current boundary: renderer validation is advisory only; main-process IPC normalizes/blocks Falcon targets, every Falcon IPC handler calls `assertTrustedSender`, and safety-critical WiFi actions remain subject to explicit trust/override policy.

### Tests Required

Coverage verified for valid private Falcon targets, rejected external/malformed targets, main-process policy use, trusted-sender IPC checks, Falcon fake-server parsing limits, WiFi start-job trust gates, Electron sandbox/navigation hardening, no native serial send IPC, and IPC fuzz manifest coverage.

### Verification

Passed:
- `npx tsx tests/falcon-wifi-ipc-target-validation.test.ts`
- `npx tsx tests/falcon-wifi-fake-server.test.ts`
- `npx tsx tests/falcon-wifi-trust.test.ts`
- `npx tsx tests/falcon-wifi-trust-blocks-start.test.ts`
- `npx tsx tests/ipc-sender-verification.test.ts`
- `npx tsx tests/ipc-attack-surface.test.ts`
- `npx tsx tests/electron-renderer-sandbox.test.ts`
- `npx tsx tests/no-electron-sendgcode-export.test.ts`
- `npx tsx tests/production-security-source-checks.test.ts`
- `npx tsx tests/electron-navigation-blocked.test.ts`
- `npx tsx tests/electron-serial-permission-trust.test.ts`
- `npx tsx tests/ipc-fuzz/ipc-fuzz.test.ts`

### Stop Conditions

Stop if a fix would require product policy for supported network devices or cloud activation/relay behavior.

## LF-EXT-K40-001: Keep K40/Lihuiyu protocol support separate from GRBL

Risk: HIGH
Status: FIXED

Learned from: K40 Whisperer
Evidence: `repo-notes/07-k40-whisperer.md`; K40 Whisperer `nano_library.py`; K40 Whisperer `egv.py`; official Scorchworks K40 Whisperer docs
LaserForge target: device profiles, firmware adapters, controller interfaces, GRBL/Falcon start/send paths, future K40/non-GRBL support
Action type: ADAPT BOUNDARY / DO NOT COPY PROTOCOL

### External Pattern

K40 Whisperer's stock K40 path is a Nano/Lihuiyu USB packet protocol with EGV output, fixed home/unlock/estop packets, response codes, and packet error handling. It is not GRBL with different settings.

### LaserForge Current State

LaserForge is currently GRBL/Falcon-focused. The controller registry only registers `grbl`; controller-family and output-format tests prove non-GRBL/future output shapes are modeled as separate capability surfaces. The real local gap was the first-run wizard copy: the "Small CO2" preset named `K40`, which could imply stock K40/Lihuiyu/Nano protocol support even though LaserForge does not ship a K40 adapter.

### Gap

Closed for current support scope. Unsupported stock K40/Lihuiyu protocol support is not implemented, and the wizard no longer advertises stock K40 as a ready GRBL-style machine profile.

### Proposed Change

Keep K40/Lihuiyu protocol support separate from GRBL. Do not implement a K40 adapter as part of this finding. The applied fix changes the first-run wizard CO2 preset wording from a stock-K40 example to explicit `GRBL-compatible CO2` wording, while relying on the existing controller-family/output gates for runtime separation.

### Tests Required

Added `tests/wizard-grbl-support-scope.test.ts` to prove first-run machine presets do not advertise stock K40/Lihuiyu boards as GRBL-ready and that the CO2 wizard copy names the `GRBL-compatible` support scope explicitly. Existing controller-family/output tests prove unsupported non-GRBL output shapes cannot silently pass as GRBL.

### Verification

- `npx tsx tests/wizard-grbl-support-scope.test.ts`
- `npx tsx tests/wizard-complete-does-not-enable-material.test.tsx`
- `npx tsx tests/prt4040-wizard-and-start-mode.test.ts`
- `npx tsx tests/home-corner-wizard-profile.test.ts`
- `npx tsx tests/family-agnostic-ticket.test.ts`
- `npx tsx tests/output-target-resolution.test.ts`
- `npx tsx tests/controller-matrix/operation-routing-by-family.test.ts`
- `npx tsx tests/controller-interface-protocol-neutral.test.ts`
- `npx tsx tests/no-electron-sendgcode-export.test.ts`

### Stop Conditions

Future stock K40/Lihuiyu support remains a product/protocol decision and must require a separate adapter with protocol-specific safe-off semantics, packet error handling, and tests before being exposed to users.

## LF-EXT-K40-002: Audit protocol-specific safety operations

Risk: HIGH
Status: VERIFIED

Learned from: K40 Whisperer
Evidence: `repo-notes/07-k40-whisperer.md`; K40 Whisperer `nano_library.py`; K40 Whisperer `k40_whisperer.py`; `audit-artifacts/k40-whisperer/laser-safety-surface.txt`
LaserForge target: test fire, frame, jog, start, pause, resume, stop, alarm, unlock, recovery, controller error handling
Action type: ADAPT PATTERN

### External Pattern

K40 Whisperer exposes controller-specific `e_stop`, `unlock_rail`, `home_position`, `pause_un_pause`, `send_data`, and packet error paths. The useful pattern is that unsafe operations live at the controller/protocol boundary, not only as UI buttons.

### LaserForge Current State

LaserForge routes safety operations through controller-owned protocol methods and service/coordinator gates. GRBL-specific bytes for test fire, frame, pause/resume, stop, emergency stop, unlock, homing, WCS reset, and two-stage laser-off live behind `GrblController.operations` / `GrblController.safetyOff`, while `ExecutionCoordinator` and `MachineService` hold operation mutexes and recovery/laser-output state.

### Gap

No current code gap found in the focused K40-002 safety-operation sector. The useful K40 Whisperer pattern is already represented: unsafe protocol-specific operations are controlled at the controller/protocol boundary, not only by UI buttons.

### Proposed Change

No production change required for this finding. Keep future stock K40/Lihuiyu operations in a separate adapter if support is added later.

### Tests Required

Current test coverage includes fake-controller/controller-boundary coverage for test fire, frame, jog, pause, resume, stop, emergency stop, alarm/fault acknowledgment, safety-off fallback, operation mutexes, recovery start blocking, and bad-number rejection.

### Verification

- `npx tsx tests/execution-coordinator-deadman.test.ts`
- `npx tsx tests/frame-dot-finally-emits-m5.test.ts`
- `npx tsx tests/operation-mutex-lease-tokens.test.ts`
- `npx tsx tests/machine-service-pause-resume.test.ts`
- `npx tsx tests/controller-stop-safety.test.ts`
- `npx tsx tests/safety-off-two-stage.test.ts`
- `npx tsx tests/safety-off-outcome-routing.test.ts`
- `npx tsx tests/acknowledge-fault-awaits-safety-off.test.ts`
- `npx tsx tests/grbl-operation-validators-reject-bad-numbers.test.ts`
- `npx tsx tests/recovery-state-blocks-start.test.ts`
- `npx tsx tests/safety-operations-controller-routing.test.ts`
- `npx tsx tests/operation-gate-decisions.test.ts`
- `npx tsx tests/machine-service-jog-respects-mutex.test.ts`
- `npx tsx tests/run-frame-fail-fast-on-blocked-command.test.ts`
- `npx tsx tests/controller-operations-api.test.ts`

### Stop Conditions

Future non-GRBL/K40 protocol behavior still requires a separate adapter and hardware-specific verification; this verification covers the current GRBL/Falcon-focused codebase only.

## LF-EXT-K40-003: Prove travel gaps cannot burn

Risk: HIGH
Status: VERIFIED

Learned from: K40 Whisperer
Evidence: `repo-notes/07-k40-whisperer.md`; K40 Whisperer `egv.py`; `audit-artifacts/k40-whisperer/pipeline-surface.txt`
LaserForge target: raster planner, fill planner, vector planner, G-code emitter, preview parser, output fixtures, user-reported unintended connecting-line behavior
Action type: ADAPT SAFETY INVARIANT

### External Pattern

K40 Whisperer's EGV emitter tracks laser ON/OFF modal state and flushes laser-off at operation and path boundaries. It does not rely on UI intent to imply burn state.

### LaserForge Current State

The user previously reported an unintended cutting line between parts of an image. Focused verification now shows the current compiler/emitter preserves disconnected vector subpaths as separate burn segments, emits laser-off boundaries before disconnected subpath travel, treats zero-power raster/fill gap moves as non-burning, blocks M4 when connected GRBL laser mode is disabled, and computes emitted burn envelopes from output for preview/output divergence checks.

### Gap

No current code gap found in the focused travel-gap safety sector. Any specific file that still cuts an unexpected connector should be treated as a file-specific reproduction or stale-output/start-mode issue, not as an unverified general emitter defect.

### Proposed Change

No production change required for this finding. Keep the disconnected-subpath and burn-envelope tests as regression coverage for the earlier user-reported connector-line risk.

### Tests Required

Current test coverage includes fixtures for disconnected vector subpaths, raster white/blank rows, modal M4 behavior, tab gaps, zero-distance suppression, M4 laser-mode preflight, preview laser-state parsing, emitted burn-envelope parsing, R-mode arc burn envelopes, and plan-vs-output divergence.

### Verification

- `npx tsx tests/disconnected-subpath-travel-safety.test.ts`
- `npx tsx tests/raster-pixel-fixtures.test.ts`
- `npx tsx tests/raster-m4-no-software-splitting.test.ts`
- `npx tsx tests/tab-gap-uses-feed-not-rapid.test.ts`
- `npx tsx tests/gcode-emitter-purity-and-zero-distance.test.ts`
- `npx tsx tests/preflight-rejects-m4-without-laser-mode.test.ts`
- `npx tsx tests/gcode-preview-laser-state.test.ts`
- `npx tsx tests/burn-envelope-divergence.test.ts`
- `npx tsx tests/emitted-burn-envelope.test.ts`
- `npx tsx tests/emitted-burn-envelope-r-mode-arcs.test.ts`

### Stop Conditions

Future changes to `G0`, `G1 S0`, `M5`/restart semantics still require hardware-profile evidence; current verification is software-output evidence only.

## LF-EXT-K40-004: Make import-derived operation mapping visible and testable

Risk: MEDIUM
Status: FIXED

Learned from: K40 Whisperer
Evidence: `repo-notes/07-k40-whisperer.md`; K40 Whisperer `svg_reader.py`; K40 Whisperer `dxf.py`; official Scorchworks manual
LaserForge target: SVG/image/DXF import if present, operation classification, Easy/Pro import UX, preview/output operation mapping
Action type: ADAPT PATTERN WITH GUARDS

### External Pattern

K40 Whisperer uses documented red/blue/raster conventions for SVG and color/layer conventions for DXF. The convention is simple, but it can be fragile if users do not see the resulting operation type.

### LaserForge Current State

LaserForge already maps imported SVG colors and DXF layer names into visible operation layers:

- `src/import/svg/SvgToScene.ts` maps red to cut, blue to engrave, green to score, black fill to engrave, and other colors to cut.
- `src/import/svg/SvgToScene.ts` preserves inherited group style colors for import-into-scene as well as new-scene import.
- `src/import/dxf/DxfToScene.ts` maps DXF layer names such as Cut, Engrave/Fill/Etch/Raster, Score/Mark/Line, and numeric layers 1/2 into cut/engrave/score layers.
- `src/ui/components/LayerPanel.tsx` exposes layer names/modes so users can inspect and correct imported operation layers before output.

### Gap

The behavior existed, but the K40-style import convention was not pinned in one explicit fixture. SVG inherited style mapping was tested, but direct red/blue/green/black SVG mapping and DXF layer-name operation mapping were easy to regress without a focused test.

### Change Made

Added `tests/import-operation-mapping.test.ts` as a test-only guard. It proves:

- SVG red stroke imports on a cut layer.
- SVG blue stroke imports on an engrave layer.
- SVG green stroke imports on a score layer.
- SVG black fill imports on an engrave layer.
- Existing-scene SVG import preserves those color-derived operation layers.
- DXF Cut, Engrave Fill, Score Mark, numeric layer 1, numeric layer 2, and unknown-layer fallback map into visible LaserForge operation layers.

No production import behavior was changed.

### Tests Required

Covered by `tests/import-operation-mapping.test.ts` plus the existing SVG/DXF import fixtures.

### Verification

- `npx tsx tests/import-operation-mapping.test.ts`
- `npx tsx tests/svg-import.test.ts`
- `npx tsx tests/svg-inherited-group-styles.test.ts`
- `npx tsx tests/svg-use-defs-import.test.ts`
- `npx tsx tests/svg-unsupported-feature-warning.test.ts`
- `npx tsx tests/svg-text-import-warning.test.ts`
- `npx tsx tests/dxf-unit-import.test.ts`
- `npx tsx tests/dxf-polyline-vertex-import.test.ts`
- `npx tsx tests/import-limits.test.ts`
- `npx tsx tests/image-import-dragdrop-supported-types.test.tsx`
- `npx tsx tests/app-layer-mode-helpers.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint tests/import-operation-mapping.test.ts --max-warnings 0`

### Stop Conditions

Stop if changing import defaults would alter existing user projects without a migration or compatibility decision.

## LF-EXT-K40-005: Treat device permission failures as product behavior

Risk: MEDIUM
Status: FIXED

Learned from: K40 Whisperer
Evidence: `repo-notes/07-k40-whisperer.md`; K40 Whisperer `README_Linux.txt`; official Scorchworks manual
LaserForge target: serial/Web Serial permissions, Electron native device access, Falcon WiFi connection errors, connection diagnostics, support bundle evidence
Action type: ADAPT SUPPORT PATTERN

### External Pattern

K40 Whisperer documents Linux udev/group setup and warns that sudo/root success indicates a permissions issue. Device permissions are part of the product support story.

### LaserForge Current State

LaserForge already had strong lower-level cleanup and trust boundaries:

- `src/communication/WebSerialPort.ts` unwinds partial opens, preserves unknown rejection diagnostics, and supports known-port reuse/forget.
- `src/app/MachineService.ts` only assigns the port reference after full USB open plus controller handshake, then closes and disconnects on partial failure.
- Electron serial permission handlers are trusted-origin gated.
- Falcon WiFi IPC target validation rejects arbitrary hostnames and non-private-LAN targets.
- Support bundles include recent errors and logs with redaction.

### Gap

The user-facing USB connection path still logged only raw failures such as `Connection failed: Failed to open serial port: permission denied`. That preserved diagnostics but did not distinguish permission denied, no port selected, busy serial port, unsupported browser/runtime, handshake/wrong-firmware, or rejected network target as product support cases.

### Change Made

Added `src/app/ConnectionFailureGuidance.ts` and wired `src/ui/components/ConnectionPanelMain.tsx` to format actionable connection guidance:

- permission denied: allow browser USB serial permission, close competing sender apps, use normal OS device-permission setup rather than administrator/root workarounds;
- no port selected: power/connect machine and choose the laser port in the browser picker;
- port busy: close LightBurn/LaserGRBL/OpenBuilds CONTROL/browser tabs/serial monitors and reconnect;
- unsupported browser: use Chrome, Edge, Opera, or packaged LaserForge;
- GRBL handshake failure: check selected port, baud rate, and firmware profile;
- network target rejection: use a trusted private-LAN Falcon target.

Machine-control behavior was not changed.

### Tests Required

Covered by `tests/connection-failure-guidance.test.ts` plus existing Web Serial, connection cleanup, Electron serial permission, Falcon WiFi, support bundle, and build verification tests.

### Verification

- `npx tsx tests/connection-failure-guidance.test.ts`
- `npx tsx tests/connect-browser-guidance.test.tsx`
- `npx tsx tests/connect-cleanup-on-partial-failure.test.ts`
- `npx tsx tests/webserial-unknown-catch.test.ts`
- `npx tsx tests/web-serial-partial-open-cleanup.test.ts`
- `npx tsx tests/falcon-wifi-ipc-target-validation.test.ts`
- `npx tsx tests/falcon-wifi-trust.test.ts`
- `npx tsx tests/falcon-wifi-trust-blocks-start.test.ts`
- `npx tsx tests/connection-details-panel.test.tsx`
- `npx tsx tests/connect-button-mutex.test.tsx`
- `npx tsx tests/serial-known-port-reuse.test.ts`
- `npx tsx tests/support-bundle.test.ts`
- `npx tsx tests/electron-serial-permission-trust.test.ts`
- `npx tsx tests/serial-port-subscription-wiring.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint src/app/ConnectionFailureGuidance.ts src/ui/components/ConnectionPanelMain.tsx tests/connection-failure-guidance.test.ts --max-warnings 0`
- `npm run build`

### Stop Conditions

Stop if remediation requires OS-specific installer changes or a support policy decision.

## LF-EXT-K40-006: Copy the beginner workflow clarity, not the legacy architecture

Risk: LOW
Status: VERIFIED

Learned from: K40 Whisperer
Evidence: `repo-notes/07-k40-whisperer.md`; K40 Whisperer `k40_whisperer.py`; `audit-artifacts/k40-whisperer/test-release-surface.txt`
LaserForge target: Easy mode, Pro mode, operator workflow, guided workflow panel, test coverage posture
Action type: ADAPT UX PATTERN / REJECT STRUCTURE

### External Pattern

K40 Whisperer exposes beginner-readable operation buttons: initialize, home, unlock rail, jog, raster engrave, vector engrave, vector cut, run G-code, and pause/stop.

### LaserForge Current State

LaserForge already has the useful beginner-workflow pieces without copying K40 Whisperer's monolithic structure:

- `src/app/UserModeGates.ts` defaults new users to beginner mode, requires framing before Start, hides raw manual G-code send, and hides the production console.
- Advanced mode is explicit and exposes the unframed-start override and manual console surfaces.
- `src/ui/components/ConnectionPanelMain.tsx` derives beginner/advanced policy from `computeUserModeGatePolicy`.
- `src/ui/components/connection/buildStartReadiness.ts` gives visible readiness gates instead of a mystery-disabled Start button.
- The first-run guide creates a conservative low-power test scene and instructs the operator through material/zero/frame/test steps.
- WorkflowPanel v2 remains feature-flag/beta-lock controlled, with tests proving start still requires framed-ticket proof when the panel is enabled.
- Service-layer Pro gates remain enforced independently of UI visibility.

### Gap

No current code gap found for this external-study item. The caveat is operational: broader public UX still needs real hardware validation, but the repo has enough automated coverage to reject K40 Whisperer's weak-test/monolithic-code posture.

### Proposed Change

No production code change. Keep the current pattern: beginner clarity through mode gates/readiness panels/first-run guide, while preserving service-level safety gates and modular tests.

### Tests Required

Covered by existing user-mode, workflow-panel, readiness, material-first, first-run, and Pro-gate tests.

### Verification

- `npx tsx tests/user-mode-gates.test.ts`
- `npx tsx tests/user-mode-policy-production-wiring.test.ts`
- `npx tsx tests/workflow-panel-feature-flag.test.ts`
- `npx tsx tests/workflow-panel-scaffold.test.ts`
- `npx tsx tests/workflow-panel-derive-mode.test.ts`
- `npx tsx tests/workflow-panel-phase2-modes.test.ts`
- `npx tsx tests/workflow-panel-phase3-setup.test.ts`
- `npx tsx tests/workflow-panel-frame-ticket-start-gate.test.ts`
- `npx tsx tests/workflow-panel-phase4-live-job.test.ts`
- `npx tsx tests/build-start-readiness.test.ts`
- `npx tsx tests/start-readiness-panel.test.tsx`
- `npx tsx tests/material-first-workflow.test.ts`
- `npx tsx tests/first-run-guide.test.ts`
- `npx tsx tests/app-mode-preference-helpers.test.ts`
- `npx tsx tests/pro-feature-ui-scoped-gates.test.ts`
- `npx tsx tests/service-layer-pro-gate-coverage.test.ts`
- `npx tsx tests/profile-selector-pinned-to-header.test.ts`

### Stop Conditions

Stop if UX changes would relax safety gates or hide machine state.

## LF-EXT-UGS-001: Audit GRBL streaming byte/accounting invariants

Risk: HIGH
Status: VERIFIED

Learned from: Universal G-Code Sender
Evidence: `repo-notes/08-universal-g-code-sender.md`; UGS `BufferedCommunicator.java`; UGS `GrblCommunicator.java`; `audit-artifacts/universal-g-code-sender/controller-streaming-surface.txt`
LaserForge target: `GrblController`, stream/spool send path, active command tracking, `ok`/`error` handling, pause-on-error, cancellation
Action type: ADAPT PATTERN

### External Pattern

UGS treats streaming as byte-budgeted controller state: stream reader, manual command buffer, active command list, next-command cache, sent buffer size, pause state, and controller RX capacity. It only releases buffer capacity after the controller completes a command.

### LaserForge Current State

LaserForge already matches the UGS streaming lesson in the GRBL sender:

- `src/controllers/grbl/GrblController.ts` uses `GRBL_BUFFER_SIZE = 127` and `grblLineByteCount(line)` based on encoded serial bytes plus newline, not JavaScript string length.
- Manual commands, buffered jobs, and spool-backed jobs reject encoded-overlong lines before writing them to serial.
- `_pending` records each active line with its byte cost; `_handleOk()` and `_handleError()` release the oldest pending line and update progress.
- `_drainQueue()` and `_drainStreamWindow()` only send when bytes fit in the remaining controller buffer.
- Synchronous transfer mode sends one job line per acknowledgement.
- Spool-backed jobs maintain a bounded window and do not require full materialization.
- Stream refill failures command safety-off, stop the controller job state, and require inspection.
- Connection-generation guards drop stale callbacks from old ports so stale serial events cannot corrupt the active stream.

### Gap

No current code gap found for this external-study item. A future improvement would be hardware-profile-specific RX buffer sizing if LaserForge supports non-standard GRBL forks with different receive buffer capacities, but the current fixed 127-byte GRBL default is conservative and covered by tests.

### Proposed Change

No code change. Keep the current encoded-byte accounting, ack/error release, spool windowing, and refill-failure safety-off behavior.

### Tests Required

Covered by the existing GRBL streaming, spool, byte-accounting, progress, stop/pause, connection-generation, and bounds/parser tests.

### Verification

- `npx tsx tests/grbl-byte-buffer-accounting.test.ts`
- `npx tsx tests/grbl-stream-fill-error-safety-off.test.ts`
- `npx tsx tests/lf004-spooled-compile-materialization.test.ts`
- `npx tsx tests/perf/streaming-expected-blockers.test.ts`
- `npx tsx tests/grbl-synchronous-transfer-mode.test.ts`
- `npx tsx tests/burn-progress-ack-timing.test.ts`
- `npx tsx tests/streaming-health.test.ts`
- `npx tsx tests/controller-stop-safety.test.ts`
- `npx tsx tests/machine-service-pause-resume.test.ts`
- `npx tsx tests/webserial-cable-pull-heartbeat.test.ts`
- `npx tsx tests/output-progress-cancel.test.ts`
- `npx tsx tests/grbl-connection-generation-guard.test.ts`
- `npx tsx tests/connection-generation-guard.test.ts`
- `npx tsx tests/grbl-job-line-parser.test.ts`
- `npx tsx tests/grbl-job-bounds-checker.test.ts`

### Stop Conditions

Stop if the fix requires choosing controller buffer policy without firmware/profile evidence.

## LF-EXT-UGS-002: Test pause/resume/cancel by firmware capability and state

Risk: HIGH
Status: FIXED

Learned from: Universal G-Code Sender
Evidence: `repo-notes/08-universal-g-code-sender.md`; UGS `GrblController.java`; UGS `AbstractController.java`; UGS `GrblControllerTest.java`; UGS `ControllerState.java`
LaserForge target: start, pause, resume, stop, cancel, door, hold, alarm, jog, unlock, test fire, frame, recovery
Action type: ADAPT TEST PATTERN

### External Pattern

UGS tests pause, resume, cancel, door/hold, jog cancel, and soft reset differently depending on GRBL version and realtime capability.

### LaserForge Current State

LaserForge has a central `OperationGate`, controller safety capabilities, GRBL realtime pause/resume/stop implementations, operation mutexes, recovery-state gates, door/alarm handling, and broad fake-controller coverage. The focused review found one service-layer bypass: `MachineService.pause()` and `MachineService.resume()` called controller operations directly, so direct callers could skip the already-defined state/capability gate.

### Gap

Closed. `MachineService.pause()` / `resume()` now resolve controller/profile capabilities, map the live controller state into `OperationGate`, and return a refused `SafetyActionResult` without issuing controller operations when the current state or capability disallows the operation. Stop/e-stop remain universal safety exits.

### Proposed Change

Adapted the UGS pattern narrowly: direct pause/resume service calls now share the same state/capability decision authority as the rest of the operation gate, without broad controller rewrites.

### Tests Required

Added service-level tests proving pause is only forwarded in `run` and resume only in `hold`, and that `canPause=false` / `canResume=false` refuse before hitting controller operations. Existing adjacent tests cover door/alarm/recovery, unknown-controller refusals, stop/e-stop bytes, pause-time M5 confirmation, resume modal restore, operation mutexes, and controller-family routing.

### Verification

Passed:
- `npx tsx tests/machine-service-pause-resume.test.ts`
- `npx tsx tests/operation-gate-decisions.test.ts`
- `npx tsx tests/safety-operations-controller-routing.test.ts`
- `npx tsx tests/machine-event-ledger-pause-resume-wiring.test.ts`
- `npx tsx tests/machine-service-safety-state-machine.test.ts`
- `npx tsx tests/safety-controls-bypass-entitlement.test.ts`
- `npx tsx tests/controller-safety-capabilities.test.ts`
- `npx tsx tests/safety-controller-matrix/unknown-controller-safety.test.ts`
- `npx tsx tests/controller-stop-safety.test.ts`
- `npx tsx tests/pause-laser-off-confirmation.test.ts`
- `npx tsx tests/resume-awaits-modal-restore.test.ts`
- `npx tsx tests/recovery-state-blocks-start.test.ts`
- `npx tsx tests/controller-operations-api.test.ts`
- `npx tsx tests/execution-coordinator-deadman.test.ts`
- `npx tsx tests/operation-mutex-lease-tokens.test.ts`
- `npx tsx tests/machine-service-jog-respects-mutex.test.ts`
- `npx tsx tests/run-frame-fail-fast-on-blocked-command.test.ts`
- `npx tsx tests/acknowledge-fault-awaits-safety-off.test.ts`
- `npx tsx tests/safety-off-two-stage.test.ts`
- `npx tsx tests/safety-off-outcome-routing.test.ts`
- `npx tsx tests/door-status-classification.test.ts`
- `npx tsx tests/controller-matrix/operation-routing-by-family.test.ts`
- `npx tsx tests/frame-dot-finally-emits-m5.test.ts`
- `npx tsx tests/grbl-operation-validators-reject-bad-numbers.test.ts`
- `npx tsx tests/family-agnostic-ticket.test.ts`
- `npx tsx tests/controller-safety-action-result-methods.test.ts`
- `npx tsx tests/pause-emits-m5-after-feed-hold.test.ts`

### Stop Conditions

Stop if real hardware behavior is needed to decide whether a transition is safe.

## LF-EXT-UGS-003: Keep large-job streaming proof hard to fake

Risk: HIGH
Status: VERIFIED

Learned from: Universal G-Code Sender
Evidence: `repo-notes/08-universal-g-code-sender.md`; UGS `GcodeStreamWriter.java`; UGS `GcodeStreamReader.java`; UGS `GcodeStreamTest.java`
LaserForge target: output spool, ticket-only start path, LF-004 regression tests, export/send materialization distinction
Action type: ADAPT TEST PATTERN

### External Pattern

UGS writes a metadata-bearing file-backed stream and tests it with 1,000,000 rows. The stream representation is read command-by-command and exposes remaining row count.

### LaserForge Current State

LF-004 is currently protected by explicit ticket-only versus full materialization paths. `tests/lf004-spooled-compile-materialization.test.ts` proves ticket-only compile returns empty `gcode`, `ticket.gcodeText`, and `ticket.gcodeLines` while preserving a replayable `gcodeSpool`. `tests/execute-job-output-contract.test.ts` proves GRBL `gcode-stream` execution does not flatten through `collectStreamingOutput` and does not accumulate every parsed stream line before sending. `tests/perf/streaming-expected-blockers.test.ts` proves a 1,000,000-line spool is replayable without a flat line array.

### Gap

No current LaserForge gap found. The remaining caveat is architectural, not an active finding: the replayable spool computes metadata by a streaming pass and reopens the deterministic factory for consumers rather than persisting a UGS-style file-backed stream. That is acceptable for current no-full-materialization proof because the start path does not carry full `gcode`/`gcodeLines` and the sender keeps a bounded window.

### Proposed Change

No code change. Keep the existing tests as regression guards. Future work may replace the deterministic replay factory with a temp-file-backed spool if generation cost or hardware start latency becomes a measured problem, but that should be a separate performance ticket.

### Tests Required

Current coverage includes ticket-only start shape, no full `gcode`/`gcodeLines`, spool line-boundary replay, million-line replay without a flat line array, bounded controller send-window behavior, cancellation during spool pre-validation, and explicit export/materialized compile behavior.

### Verification

Verified with:

- `npx tsx tests/lf004-spooled-compile-materialization.test.ts`
- `npx tsx tests/perf/streaming-expected-blockers.test.ts`
- `npx tsx tests/execute-job-output-contract.test.ts`
- `npx tsx tests/time-estimator-stream.test.ts`

### Stop Conditions

Stop if a fix would require broad output architecture rewrite instead of targeted stream/ticket preservation.

## LF-EXT-UGS-004: Compare preview/output through parser fixtures

Risk: MEDIUM
Status: FIXED

Learned from: Universal G-Code Sender
Evidence: `repo-notes/08-universal-g-code-sender.md`; UGS `FixturesTest.java`; UGS `GcodeParser.java`; UGS `GcodeViewParse.java`; UGS fixture resources
LaserForge target: preview compiler, simulator, output parser, emitted G-code fixtures, export/send consistency
Action type: ADAPT TEST PATTERN

### External Pattern

UGS fixture tests compare generated stream output and parsed command output, while the visualizer derives line segments from parser state.

### LaserForge Current State

LaserForge has output tests and preview/simulation surfaces. This pass confirmed existing coverage for laser state, relative mode, arc preview, emitted burn envelopes, stream-derived envelopes, and burn-envelope divergence. It also added a paired preview/output parity fixture test modeled after UGS parser fixtures.

### Gap

Before this pass, LaserForge had separate preview-parser and emitted-output-parser checks, but lacked one fixture-style test that compared preview cut geometry against emitted burn geometry for multiple high-risk modal cases in one place.

### Proposed Change

Added `tests/gcode-preview-output-parity-fixtures.test.ts`. No production code change was required.

### Tests Required

Coverage now includes paired fixtures for same-block relative modal ordering, embedded M/S laser words, comment/whitespace stripping, and arc preview versus emitted arc envelope. Existing adjacent tests cover laser state, relative mode, large preview sampling, emitted burn envelope parsing, emitted arcs, burn-envelope divergence, spool-backed start shape, and materialized export behavior.

### Verification

Verified with:

- `npx tsx tests/gcode-preview-output-parity-fixtures.test.ts`
- `npx tsx tests/gcode-preview-laser-state.test.ts`
- `npx tsx tests/gcode-preview-relative-mode.test.ts`
- `npx tsx tests/gcode-preview-arcs.test.ts`
- `npx tsx tests/emitted-burn-envelope.test.ts`
- `npx tsx tests/emitted-burn-envelope-arcs.test.ts`
- `npx tsx tests/burn-envelope-divergence.test.ts`

### Stop Conditions

Stop if fixture updates would bless changed machine output without reviewer approval.

## LF-EXT-UGS-005: Treat run-from/resume as modal-state reconstruction

Risk: HIGH
Status: FIXED

Learned from: Universal G-Code Sender
Evidence: `repo-notes/08-universal-g-code-sender.md`; UGS `RunFromProcessor.java`; UGS run-from fixture resources
LaserForge target: resume/restart/recovery features, pause/resume logic, future resume-from-middle behavior, job logs
Action type: ADAPT CAUTION / BLOCK UNSAFE FEATURE

### External Pattern

UGS reconstructs parser state before the requested line, emits state preamble, moves to clearance, moves XY, restores accessory state, plunges, and appends normalized command.

### LaserForge Current State

LaserForge does not expose a UGS-style run-from-line/resume-from-middle feature in the audited code paths. Existing pause/resume is GRBL feed-hold/cycle-start during an active host-streamed job. `GrblController.pause()` sends feed hold plus `M5 S0`; `GrblController.resume()` reasserts the captured `M3/M4 S0` modal spindle state before sending cycle-start (`~`).

### Gap

The behavior was already guarded, but `grblSafetyCapabilities.resumeRequiresStateRestore` incorrectly said `false` even though the implemented LaserForge pause/resume contract does require host-side modal state restore after `M5 S0`.

### Proposed Change

Updated the GRBL safety capability declaration to `resumeRequiresStateRestore: true` and updated its test expectation. No run-from-middle feature was added.

### Tests Required

Current tests cover M3/M4 modal restore, comment-safe modal tracking, stale modal state isolation across jobs, capability/state-gated service pause/resume, and refusal when pause/resume is not supported. A future run-from-middle feature must still require separate modal/WCS/position/safe-travel reconstruction tests before it is exposed.

### Verification

Verified with:

- `npx tsx tests/controller-safety-capabilities.test.ts`
- `npx tsx tests/resume-awaits-modal-restore.test.ts`
- `npx tsx tests/resume-modal-tokenization.test.ts`
- `npx tsx tests/pause-emits-m5-after-feed-hold.test.ts`
- `npx tsx tests/machine-service-pause-resume.test.ts`

### Stop Conditions

Stop if safe resume requires hardware-specific evidence or product policy on whether mid-job resume should exist.

## LF-EXT-UGS-006: Gate WCS, homing, unlock, check-mode, and reset commands by profile

Risk: HIGH
Status: FIXED

Learned from: Universal G-Code Sender
Evidence: `repo-notes/08-universal-g-code-sender.md`; UGS `GrblUtils.java`; UGS `GrblController.java`; UGS `ControllerUtils.java`
LaserForge target: reset-WCS-to-baseline, homing, alarm unlock, check mode, parser-state query, jog, coordinate commands, soft limits
Action type: ADAPT CAPABILITY PATTERN

### External Pattern

UGS chooses homing, WCS reset, alarm unlock, check-mode, parser-state, soft reset, and jog commands by GRBL version/capability rather than assuming one command fits all machines.

### LaserForge Current State

LaserForge already has profile/capability-aware gates for homing, unlock, and set-origin through `src/app/OperationGate.ts` and `src/controllers/ControllerCapabilities.ts`. `sendResetWcsCommand` calls the controller operation instead of writing raw G-code directly, while `GrblController.applyWcsNormalization` refuses to rewrite G54/`$10` during active jobs or non-idle machine states. The reset-WCS-to-baseline path intentionally remains available for idle connected GRBL machines so the UI is not over-gated for machines that cannot satisfy every optional setup check.

### Gap

The production behavior did not need a broad policy change. The real gap was proof: the external-study register did not have a focused contract test showing that UGS-style capability gates are applied to homing/unlock/set-origin while WCS reset/normalization remains idle-state gated and fails closed when unsupported.

### Proposed Change

Added `tests/wcs-profile-gate-contract.test.ts` to pin the intended policy:

- homing is blocked when the profile disables homing;
- unlock is blocked when the profile disables unlock;
- set-origin is blocked when the profile disables work-origin writes;
- WCS normalization is blocked while running;
- WCS normalization remains allowed while idle so the reset-baseline button is not over-gated;
- reset WCS fails closed if the controller operation is absent;
- reset WCS surfaces controller-level unsupported refusals.

### Tests Required

Covered by `tests/wcs-profile-gate-contract.test.ts`, with existing corroboration from `tests/operation-gate-decisions.test.ts`, `tests/start-mode-wcs-reset.test.ts`, `tests/wcs-normalization-operation-gate.test.ts`, `tests/wcs-fail-closed-integration.test.ts`, and `tests/controller-capabilities-enforced.test.ts`.

### Verification

Passed:

- `npx tsx tests\wcs-profile-gate-contract.test.ts`
- `npx tsx tests\operation-gate-decisions.test.ts`
- `npx tsx tests\start-mode-wcs-reset.test.ts`
- `npx tsx tests\wcs-normalization-operation-gate.test.ts`
- `npx tsx tests\wcs-fail-closed-integration.test.ts`
- `npx tsx tests\controller-capabilities-enforced.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint tests\wcs-profile-gate-contract.test.ts src\app\OperationGate.ts src\app\sendResetWcsCommand.ts --max-warnings 0`

### Stop Conditions

No stop condition was hit. The fix deliberately avoided imposing homing/soft-limit requirements on reset-WCS baseline behavior.

## LF-EXT-BCNC-001: Audit GRBL streaming as byte-budgeted controller state

Risk: HIGH
Status: FIXED

Learned from: bCNC
Evidence: `repo-notes/09-bcnc.md`; bCNC `Sender.py`; `audit-artifacts/bcnc/controller-streaming-surface.txt`
LaserForge target: `GrblController`, spool-backed send path, active command accounting, wait barriers, pause/error handling
Action type: ADAPT INVARIANT / TEST PATTERN

### External Pattern

bCNC tracks command lengths in `cline`, uses `RX_BUFFER_SIZE = 128`, polls controller status, and only sends when the active byte budget is below the controller capacity.

### LaserForge Current State

LaserForge's `GrblController` already models GRBL streaming as byte-budgeted controller state. It uses `GRBL_BUFFER_SIZE = 127`, records each pending line with an encoded serial byte count, subtracts that count when sending, releases it only on controller `ok`/`error`, and keeps spool-backed jobs in a bounded window instead of flattening the whole output.

### Gap

The production sender did not need a rewrite. The remaining gap was proof that the live sender refuses to overfill the active GRBL RX byte budget before an acknowledgement, not merely proof that individual long lines are rejected.

### Proposed Change

Extended `tests/grbl-byte-buffer-accounting.test.ts` with a fake-controller regression where three approximately 59-byte G-code lines are queued. The controller sends only two before an `ok`, withholds the third until the first acknowledgement frees byte budget, and then sends exactly the third line. This adapts bCNC's `cline`/RX-budget invariant without changing LaserForge streaming semantics.

### Tests Required

Covered by `tests/grbl-byte-buffer-accounting.test.ts`, with corroborating streaming coverage from `tests/execute-job-output-contract.test.ts`, `tests/grbl-stream-fill-error-safety-off.test.ts`, `tests/grbl-synchronous-transfer-mode.test.ts`, and `tests/streaming-health-saturation.test.ts`.

### Verification

Passed:

- `npx tsx tests\grbl-byte-buffer-accounting.test.ts`
- `npx tsx tests\execute-job-output-contract.test.ts`
- `npx tsx tests\grbl-stream-fill-error-safety-off.test.ts`
- `npx tsx tests\grbl-synchronous-transfer-mode.test.ts`
- `npx tsx tests\streaming-health-saturation.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint tests\grbl-byte-buffer-accounting.test.ts tests\wcs-profile-gate-contract.test.ts src\controllers\grbl\GrblController.ts --max-warnings 0`

### Stop Conditions

No stop condition was hit. The change is test-only and proves the existing byte-budgeted sender behavior with fake-controller evidence.

## LF-EXT-BCNC-002: Treat stop and purge as safe-state recovery

Risk: HIGH
Status: VERIFIED

Learned from: bCNC
Evidence: `repo-notes/09-bcnc.md`; bCNC `Sender.py`; bCNC `_GenericController.py`
LaserForge target: stop, pause, resume, alarm, unlock, recovery, safe laser-off, job logs
Action type: ADAPT CAUTION / VERIFY INVARIANT

### External Pattern

bCNC uses feed hold, soft reset, modal state capture/restore, TLO restore, queue/probe cleanup, and state/parameter refresh during purge/recovery.

### LaserForge Current State

LaserForge intentionally does not copy bCNC's modal purge/restore behavior for laser recovery. Current GRBL recovery favors laser-safe transitions: `pause()` sends feed hold then awaitable `M5 S0`, `resume()` awaits modal `M3/M4 S0` reassert before cycle-start, `stop()` uses realtime soft reset and does not auto-unlock, active-job `error:` and `ALARM:` paths run safety-off, stream refill failure transitions to `faulted_requires_inspection`, and `acknowledgeFault()` clears the fault only after safety-off succeeds.

### Gap

No current production gap was found in this targeted comparison. The bCNC lesson is already represented as LaserForge-specific safety invariants rather than modal state restoration: force laser-off first, do not auto-restore controller state after destructive stop/reset, and require inspection when the software cannot prove safe state.

### Proposed Change

No production code change. Preserve the existing LaserForge recovery policy and continue using fake-controller transcript tests as the acceptance gate. Do not copy bCNC's modal/TLO restore path unless a future machine-profile design proves it safe for laser hardware.

### Tests Required

Existing tests cover the required recovery evidence: stop/e-stop soft reset, two-stage safety-off, active-job error/alarm safe-off, acknowledgement safety-off, pause feed-hold plus M5, resume modal reassert before cycle-start, stream refill failure safe-off, and disconnect-with-running-job gating.

### Verification

Passed:

- `npx tsx tests\controller-stop-safety.test.ts`
- `npx tsx tests\safety-off-two-stage.test.ts`
- `npx tsx tests\error-handler-sends-safety-off.test.ts`
- `npx tsx tests\acknowledge-fault-awaits-safety-off.test.ts`
- `npx tsx tests\pause-emits-m5-after-feed-hold.test.ts`
- `npx tsx tests\resume-awaits-modal-restore.test.ts`
- `npx tsx tests\grbl-stream-fill-error-safety-off.test.ts`
- `npx tsx tests\disconnect-stops-job-gating.test.ts`

### Stop Conditions

No stop condition was hit. No hardware-specific recovery policy change was made.

## LF-EXT-BCNC-003: Make WCS and controller reporting assumptions explicit

Risk: HIGH
Status: FIXED

Learned from: bCNC
Evidence: `repo-notes/09-bcnc.md`; bCNC README; bCNC `CNC.py`; bCNC `GRBL1.py`; bCNC `_GenericController.py`
LaserForge target: reset-WCS-to-baseline, placement certainty, bounds, origin transforms, profile settings, unsupported-machine UX
Action type: ADAPT CAPABILITY PATTERN

### External Pattern

bCNC documents `$10` MPos reporting and `$13=0`, parses MPos/WCO, subtracts WCO from probe results, and routes coordinate-setting through G10/G92/G28/G30.

### LaserForge Current State

LaserForge already fail-closes startup WCS consent when G54/`$10` are missing or malformed, refuses `$#` query errors, verifies saved-origin G54 snapshots, and controller-bounds-checks relative moves only from a confirmed position. Reset-WCS-to-baseline remains available on the idle controller path rather than becoming a blanket homing/soft-limit prerequisite.

### Gap

The targeted bCNC comparison found one real parser hardening gap: GRBL live status parsing accepted non-finite `MPos`/`WPos` coordinates as a position object. `_handleStatusReport` could then mark `_positionConfirmed = true`, which weakens the relative-motion bounds model that depends on confirmed head position.

### Proposed Change

Updated `src/controllers/grbl/GrblStatusReportParser.ts` so malformed or non-finite `MPos`/`WPos` coordinates return `null` instead of a position object. Missing Z still defaults to `0` for two-axis GRBL reports. Added parser and controller-boundary tests proving malformed status coordinates do not mark position confirmed, while a valid alternate position field still parses.

### Tests Required

Covered by `tests/grbl-status-report-parser.test.ts` and `tests/controller-bounds-checks-g91.test.ts`, with existing corroboration from WCS parser/classifier, WCS query fail-closed, saved-origin verification, WCS fail-closed integration, and GRBL job-bounds checker tests.

### Verification

Passed:

- `npx tsx tests\grbl-status-report-parser.test.ts`
- `npx tsx tests\controller-bounds-checks-g91.test.ts`
- `npx tsx tests\grbl-wcs-consent-classifier.test.ts`
- `npx tsx tests\wcs-query-error-fails-closed.test.ts`
- `npx tsx tests\grbl-wcs-parser.test.ts`
- `npx tsx tests\wcs-fail-closed-integration.test.ts`
- `npx tsx tests\saved-origin-verifies-wcs.test.ts`
- `npx tsx tests\grbl-job-bounds-checker.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint src\controllers\grbl\GrblStatusReportParser.ts tests\grbl-status-report-parser.test.ts tests\controller-bounds-checks-g91.test.ts --max-warnings 0`

### Stop Conditions

No stop condition was hit. The change rejects malformed controller reports more safely without adding machine-compatibility restrictions.

## LF-EXT-BCNC-004: Keep controller-family commands and errors profile-specific

Risk: MEDIUM
Status: FIXED

Learned from: bCNC
Evidence: `repo-notes/09-bcnc.md`; bCNC `bCNC/controllers/*`; bCNC `_GenericGRBL.py`
LaserForge target: device profiles, firmware adapters, command capability gates, error/alarm messages
Action type: ADAPT PATTERN

### External Pattern

bCNC separates GRBL0, GRBL1, Smoothie, and G2Core behavior and keeps explicit GRBL error/alarm descriptions.

### LaserForge Current State

LaserForge is GRBL/Falcon-focused today. Broader support remains profile-gated through:

- `src/controllers/ControllerCapabilities.ts`
- `src/controllers/ControllerSafetyCapabilities.ts`
- `src/app/OperationGate.ts`
- `src/controllers/GrblFirmwareAdapter.ts`
- `src/controllers/MarlinFirmwareAdapter.ts`

### Gap

Targeted audit found a small controller-family leak in the generic operation gate:

- `raw-console` was treated as an app-level operation and could be allowed even when a future profile/controller did not advertise G-code text support.
- `wcs-normalize` was treated as app-level and could be allowed even when the profile disabled work-origin writes.

That was not a current GRBL/Falcon output bug, but it was exactly the profile-boundary drift bCNC's controller-family split warns against.

### Proposed Change

Updated `src/app/OperationGate.ts` so:

- `raw-console` requires a G-code output/console capability.
- `wcs-normalize` requires `canSetWorkOrigin`.

Added `tests/controller-family-profile-boundaries.test.ts` to prove GRBL keeps its console path, non-G-code/native controllers do not inherit it, WCS normalization follows work-origin capability, GRBL adapter rejects wrong-firmware output, and the Marlin stub remains declared-not-supported rather than borrowing GRBL behavior.

### Tests Required

- `tests/controller-family-profile-boundaries.test.ts`
- existing operation-gate, WCS, capability, safety-capability, GRBL adapter, Marlin adapter, and unknown-controller matrix tests

### Verification

- `npx tsx tests\controller-family-profile-boundaries.test.ts`
- `npx tsx tests\operation-gate-decisions.test.ts`
- `npx tsx tests\wcs-profile-gate-contract.test.ts`
- `npx tsx tests\controller-capabilities-enforced.test.ts`
- `npx tsx tests\controller-safety-capabilities.test.ts`
- `npx tsx tests\grbl-firmware-adapter.test.ts`
- `npx tsx tests\marlin-firmware-adapter-stub.test.ts`
- `npx tsx tests\safety-controller-matrix\unknown-controller-safety.test.ts`
- `npx tsx tests\wcs-normalization-operation-gate.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint src\app\OperationGate.ts tests\controller-family-profile-boundaries.test.ts tests\operation-gate-decisions.test.ts tests\wcs-profile-gate-contract.test.ts --max-warnings 0`

### Stop Conditions

No stop condition was hit. The change does not expand machine support; it refuses unsupported controller/profile paths more explicitly.

## LF-EXT-BCNC-005: Make laser-mode, power, pass, and Z policy visible before output

Risk: MEDIUM
Status: FIXED

Learned from: bCNC
Evidence: `repo-notes/09-bcnc.md`; bCNC `plugins/LaserCut.py`; `audit-artifacts/bcnc/cam-laser-surface.txt`
LaserForge target: Pro/Easy mode settings, M3/M4/S/M5 output, tab/gap travel, repeated passes, Z policy, preview/output validation
Action type: ADAPT UX/TEST PATTERN

### External Pattern

bCNC's LaserCut plugin exposes feed, power, M3/M4/Auto mode, block repeats, Z start/down-step, backup copies, header `M3/M4 S0`, and footer `M5`, then warns the operator to validate generated blocks.

### LaserForge Current State

LaserForge already has:

- layer-level power, speed, pass, Z-step, tab, fill, overscan, and image-mode controls;
- `grblLaserPowerMode` profile selection for Dynamic M4 versus Constant M3;
- preflight blockers for M4 without verified `$32=1`;
- Z-axis fail-closed preflight unless the profile explicitly declares bounded Z travel;
- output tests for multi-pass M4/M5 cycles and raster modal M4 behavior.

### Gap

The final pre-start Job Review showed power, speed, and passes, but it did not surface the selected M3/M4 output mode and could not show non-zero Z step per pass in the operation list. That made a safety-relevant output policy less visible at the final operator checkpoint.

### Proposed Change

Updated:

- `src/ui/components/ConnectionPanelMain.tsx` to pass the active profile's laser-power mode into the Job Review.
- `src/ui/components/connection/ReadyToRunPanel.tsx` to display the laser mode and non-zero `Z <value> mm/pass` on operation rows.
- `src/ui/components/connection/connectionPanelLabels.ts` and `src/app/OperationOrder.ts` to carry `zStepPerPassMm` through the operation-row model.
- `tests/ready-to-run-panel.test.tsx` to prove Dynamic M4 and Z-step policy are visible before Start.

This is visibility-only; it does not change generated G-code semantics or default machine behavior.

### Tests Required

- `tests/ready-to-run-panel.test.tsx`
- `tests/connection-panel-labels.test.ts`
- `tests/operation-order-warning.test.ts`
- `tests/preflight-z-axis-bounds.test.ts`
- `tests/preflight-rejects-m4-without-laser-mode.test.ts`
- `tests/e2e/multi-pass-cut.test.ts`
- `tests/raster-output-uses-modal-m4.test.ts`

### Verification

- `npx tsx tests\ready-to-run-panel.test.tsx`
- `npx tsx tests\connection-panel-labels.test.ts`
- `npx tsx tests\operation-order-warning.test.ts`
- `npx tsx tests\preflight-z-axis-bounds.test.ts`
- `npx tsx tests\preflight-rejects-m4-without-laser-mode.test.ts`
- `npx tsx tests\e2e\multi-pass-cut.test.ts`
- `npx tsx tests\raster-output-uses-modal-m4.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint src\app\OperationOrder.ts src\ui\components\connection\ReadyToRunPanel.tsx src\ui\components\connection\connectionPanelLabels.ts src\ui\components\ConnectionPanelMain.tsx tests\ready-to-run-panel.test.tsx --max-warnings 0`

### Stop Conditions

No stop condition was hit. The change only improves the pre-start review surface; output/default behavior was not changed.

## LF-EXT-BCNC-006: Adapt transcript diagnostics but reject GUI-smoke-only verification

Risk: MEDIUM
Status: FIXED

Learned from: bCNC
Evidence: `repo-notes/09-bcnc.md`; bCNC README; bCNC `.travis.yml`; bCNC `tests/fake-grbl.sh`; bCNC `tests/test_smoke.py`
LaserForge target: support bundle, event ledger, fake-controller tests, hardware-validation evidence capture
Action type: ADAPT DIAGNOSTIC PATTERN / REJECT WEAK TEST POSTURE

### External Pattern

bCNC documents serial-spy logging and includes a fake-GRBL smoke path, but its current CI posture is old and the pytest smoke run is commented out in Travis.

### LaserForge Current State

LaserForge has support bundle and fake-controller style tests. The targeted audit confirmed that the support bundle assembler can carry structured controller transcript entries, machine-event ledger evidence, compile metadata, preflight reports, and opt-in emitted G-code.

### Gap

The production channels existed, but the support-bundle test did not prove that bCNC-style transcript evidence survives into the bundle alongside safety and preflight context.

### Proposed Change

Added a focused support-bundle regression that proves structured TX/RX command evidence, RX controller line numbers, buffer-state evidence, safety-off ledger entries, M4/spool compile metadata, preflight safety issues, and opt-in emitted G-code are preserved in the diagnostic package. No production behavior change was needed.

### Tests Required

Covered by `tests/support-bundle.test.ts` plus existing ZIP export, structured RX/TX, machine-event ledger, and safe diagnostics command tests.

### Verification

- `npx tsx tests\support-bundle.test.ts`
- `npx tsx tests\support-bundle-zip-export.test.ts`
- `npx tsx tests\structured-rx-tx-entries.test.ts`
- `npx tsx tests\machine-event-ledger.test.ts`
- `npx tsx tests\machine-event-ledger-production-wiring.test.ts`
- `npx tsx tests\machine-event-ledger-safety-off-wiring.test.ts`
- `npx tsx tests\grbl-diagnostics-commands.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint tests\support-bundle.test.ts src\diagnostics\SupportBundle.ts src\diagnostics\SupportBundleExport.ts src\app\StructuredRxTxEntry.ts src\app\MachineEventLedger.ts --max-warnings 0`

### Stop Conditions

No stop condition was hit. This is diagnostic/test hardening only; it does not claim real hardware behavior and does not replace the external beta hardware evidence pass.

## LF-EXT-BCNC-007: Reject monolithic UI/sender and legacy CI posture

Risk: LOW
Status: VERIFIED

Learned from: bCNC
Evidence: `repo-notes/09-bcnc.md`; bCNC `CNC.py`; bCNC `CNCCanvas.py`; bCNC `.travis.yml`
LaserForge target: architecture boundaries, test posture, future refactors
Action type: REJECT STRUCTURE / KEEP CONCEPTS ONLY

### External Pattern

bCNC is useful behaviorally but tightly couples sender, parser, UI, canvas, CAM, and legacy GUI workflows.

### LaserForge Current State

LaserForge already has stronger sector boundaries and modern TypeScript tests. The current `src/` tree separates app orchestration, controllers, core planning/output, diagnostics, imports, transports, UI, storage, security, and workers. The repo also has explicit test lanes (`test`, `test:unit`, `test:output`, `test:sim`, `test:perf`) rather than a GUI-smoke-only posture.

### Gap

No direct product gap identified from this external note alone. This remains an anti-pattern guard for future refactors, not a current LaserForge defect.

### Proposed Change

No code change. Use bCNC for behavioral prompts only, and reject copying its monolithic UI/sender/CAM shape.

### Tests Required

No new test required for this anti-pattern note. Future refactors that touch UI/sender/CAM boundaries must add characterization tests before moving behavior.

### Verification

- `Get-ChildItem -Path src -Directory`
- `rg -n "class .*Manager|class .*Controller|TODO.*split|monolith|CNCCanvas|bCNC|LF-EXT-BCNC-007" src tests laserforge-external-repo-study\LASERFORGE_FIX_PLAN.md laserforge-external-repo-study\FINDINGS_REGISTER.md`
- `Get-Content -Path package.json -TotalCount 220`

### Stop Conditions

Stop any attempt to copy bCNC structure wholesale.

## LF-EXT-CANDLE-001: Audit GRBL streaming as a bounded active-command budget

Risk: HIGH
Status: FIXED

Learned from: Candle
Evidence: `repo-notes/10-candle.md`; Candle `src/candle/frmmain.h`; Candle `src/candle/frmmain.cpp`
LaserForge target: `GrblController`, output spool/send path, active command accounting, realtime commands, large-job start path
Action type: ADAPT PATTERN

### External Pattern

Candle defines a 127-byte sender budget, tracks active command lengths in `m_commands`, queues commands when the budget is full, and releases active commands as controller responses arrive.

### LaserForge Current State

LaserForge has a spool-backed start path and GRBL controller tests. The targeted Candle comparison confirmed that `GrblController` uses encoded byte counts, active pending-command accounting, one oldest-command release on `ok`/`error`, bounded spool windows, synchronous one-line-per-ack mode, and realtime pause/stop commands that bypass the buffered job queue.

### Gap

The remaining missing proof was Candle's explicit realtime/buffer separation: a full RX budget must not prevent feed-hold or laser-off intent from reaching the controller.

### Proposed Change

Extended `tests/grbl-byte-buffer-accounting.test.ts` with a regression that fills the active GRBL RX byte budget, verifies the third job line waits, then calls `pause()` and proves realtime feed-hold plus critical `M5 S0` are sent immediately without draining another queued job line. No production behavior change was needed.

### Tests Required

Covered by byte-buffer, execute-job output contract, synchronous transfer, stream-refill safety-off, streaming health, pause/resume, stop safety, stop-on-error override, output-lane, typecheck, and focused lint checks.

### Verification

- `npx tsx tests\grbl-byte-buffer-accounting.test.ts`
- `npx tsx tests\execute-job-output-contract.test.ts`
- `npx tsx tests\grbl-synchronous-transfer-mode.test.ts`
- `npx tsx tests\grbl-stream-fill-error-safety-off.test.ts`
- `npx tsx tests\streaming-health-saturation.test.ts`
- `npx tsx tests\pause-emits-m5-after-feed-hold.test.ts`
- `npx tsx tests\controller-stop-safety.test.ts`
- `npx tsx tests\stop-on-error-override.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint tests\grbl-byte-buffer-accounting.test.ts src\controllers\grbl\GrblController.ts tests\execute-job-output-contract.test.ts tests\grbl-synchronous-transfer-mode.test.ts tests\pause-emits-m5-after-feed-hold.test.ts tests\controller-stop-safety.test.ts --max-warnings 0`
- `npm run test:output`

### Stop Conditions

No stop condition was hit. The change is test-only transport-accounting proof and does not change emitted G-code semantics.

## LF-EXT-CANDLE-002: Bind controller errors to hold/reset decisions

Risk: HIGH
Status: VERIFIED

Learned from: Candle
Evidence: `repo-notes/10-candle.md`; Candle `src/candle/frmmain.cpp`; `audit-artifacts/candle/laser-safety-surface.txt`
LaserForge target: stream error handling, refill failure, pause/resume/stop, alarm/recovery, final laser-off behavior
Action type: ADAPT SAFETY PATTERN WITH STRICTER LASER POLICY

### External Pattern

Candle sends realtime feed hold `!` after program `error` responses, shows the operator the error, and then either resumes with `~` or resets.

### LaserForge Current State

LaserForge has stricter laser-specific behavior than Candle's operator ignore/abort flow. Active-job `error:` responses run controller-owned safety-off, stop the job, preserve the GRBL error code, and transition to `faulted_requires_inspection`. Hardware `ALARM` tokens run defense-in-depth safety-off and remain distinct as firmware-reported `alarm`. Stream-refill failures also run safety-off and require inspection. Fault acknowledgement awaits safety-off and refuses to clear if both M5 and soft reset fail.

### Gap

No current LaserForge product gap found in this targeted comparison. The useful Candle lesson is already implemented as a stricter laser-safe policy: do not silently continue after controller errors unless an explicit unsafe stop-on-error override token exists for diagnostics.

### Proposed Change

No production code change. Preserve the existing service/controller-layer safety-off, faulted-state, and acknowledgement gates. Do not copy Candle's operator "Ignore" continuation model into normal laser job execution.

### Tests Required

Covered by controller error/alarm, fault acknowledgement, stream-refill failure, pause/resume, stop/e-stop, disconnect gating, safety-off two-stage, stop-on-error override, typecheck, and focused lint checks.

### Verification

- `npx tsx tests\error-handler-sends-safety-off.test.ts`
- `npx tsx tests\error-handler-faults-active-job.test.ts`
- `npx tsx tests\acknowledge-fault-awaits-safety-off.test.ts`
- `npx tsx tests\grbl-stream-fill-error-safety-off.test.ts`
- `npx tsx tests\pause-emits-m5-after-feed-hold.test.ts`
- `npx tsx tests\resume-awaits-modal-restore.test.ts`
- `npx tsx tests\controller-stop-safety.test.ts`
- `npx tsx tests\disconnect-stops-job-gating.test.ts`
- `npx tsx tests\safety-off-two-stage.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint src\controllers\grbl\GrblController.ts tests\error-handler-sends-safety-off.test.ts tests\error-handler-faults-active-job.test.ts tests\acknowledge-fault-awaits-safety-off.test.ts tests\grbl-stream-fill-error-safety-off.test.ts tests\pause-emits-m5-after-feed-hold.test.ts tests\resume-awaits-modal-restore.test.ts tests\controller-stop-safety.test.ts tests\disconnect-stops-job-gating.test.ts --max-warnings 0`

### Stop Conditions

No stop condition was hit. Any future change that allows continuation after controller `error:` must prove laser state and motion state are safe.

## LF-EXT-CANDLE-003: Treat WCS/parser-state recovery as capability-gated behavior

Risk: HIGH
Status: VERIFIED

Learned from: Candle
Evidence: `repo-notes/10-candle.md`; Candle help files; Candle `src/candle/frmmain.cpp`; `audit-artifacts/candle/origin-wcs-surface.txt`
LaserForge target: WCS reset-to-baseline, placement certainty, start gates, resume/restart, unsupported-machine diagnostics
Action type: ADAPT PATTERN

### External Pattern

Candle refreshes offsets after `G92`/`G10`, parses `$G` and `$#`, builds line-start preambles, stores GRBL settings, and warns that user commands do not restore work coordinates after reset or emergency stop.

### LaserForge Current State

LaserForge already separates hard safety gates from compatibility/profile gates. WCS reset-to-baseline is a direct operation (`G10 L2 P1 X0 Y0 Z0` through the operation gateway), WCS normalization is refused while running/non-idle, WCS query failures fail closed, saved-origin jobs verify G54 drift before start/frame, G10/G92 console mutations invalidate saved-origin snapshots, GRBL status/settings/WCS parsers reject malformed or non-finite evidence, and profile flags can intentionally allow manual-zero starts when a machine cannot prove WCS.

### Gap

No current LaserForge product gap found in this targeted comparison. The important caveat is intentional: compatibility mode for machines that cannot report G54/$10 must remain explicit operator consent, not a silent safety proof.

### Proposed Change

No production code change. Preserve the current split between hard blocks, profile capability checks, explicit reset-baseline behavior, and manual-zero compatibility consent.

### Tests Required

Covered by WCS profile/gate, normalization, fail-closed, parser, settings, reset-baseline, saved-origin, operation-gate, capability, position-trust, WCS mutation consent, origin-mode, request-work-offsets, typecheck, and focused lint checks.

### Verification

- `npx tsx tests\wcs-profile-gate-contract.test.ts`
- `npx tsx tests\wcs-normalization-operation-gate.test.ts`
- `npx tsx tests\wcs-query-error-fails-closed.test.ts`
- `npx tsx tests\wcs-fail-closed-integration.test.ts`
- `npx tsx tests\grbl-wcs-parser.test.ts`
- `npx tsx tests\grbl-wcs-consent-classifier.test.ts`
- `npx tsx tests\grbl-status-report-parser.test.ts`
- `npx tsx tests\grbl-settings-parser.test.ts`
- `npx tsx tests\start-mode-wcs-reset.test.ts`
- `npx tsx tests\controls-reset-wcs-baseline.test.tsx`
- `npx tsx tests\saved-origin-verifies-wcs.test.ts`
- `npx tsx tests\saved-origin-wcs-lifecycle.test.ts`
- `npx tsx tests\operation-gate-decisions.test.ts`
- `npx tsx tests\controller-capabilities-enforced.test.ts`
- `npx tsx tests\controller-family-profile-boundaries.test.ts`
- `npx tsx tests\position-trust-transitions.test.ts`
- `npx tsx tests\wcs-mutation-consent.test.ts`
- `npx tsx tests\wcs-command-helpers-use-gateway.test.ts`
- `npx tsx tests\origin-mode-wcs-zero.test.ts`
- `npx tsx tests\grbl-request-work-offsets.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint src\controllers\grbl\GrblWcsParser.ts src\controllers\grbl\GrblWcsConsentClassifier.ts src\controllers\grbl\GrblStatusReportParser.ts src\controllers\grbl\GrblSettingsParser.ts src\app\sendResetWcsCommand.ts src\app\OperationGate.ts src\app\savedOriginVerify.ts tests\wcs-profile-gate-contract.test.ts tests\wcs-normalization-operation-gate.test.ts tests\wcs-query-error-fails-closed.test.ts tests\wcs-fail-closed-integration.test.ts tests\grbl-wcs-parser.test.ts tests\grbl-wcs-consent-classifier.test.ts tests\grbl-status-report-parser.test.ts tests\grbl-settings-parser.test.ts tests\start-mode-wcs-reset.test.ts tests\controls-reset-wcs-baseline.test.tsx tests\saved-origin-verifies-wcs.test.ts tests\saved-origin-wcs-lifecycle.test.ts tests\operation-gate-decisions.test.ts tests\controller-capabilities-enforced.test.ts tests\controller-family-profile-boundaries.test.ts tests\position-trust-transitions.test.ts tests\wcs-mutation-consent.test.ts tests\wcs-command-helpers-use-gateway.test.ts tests\origin-mode-wcs-zero.test.ts tests\grbl-request-work-offsets.test.ts --max-warnings 0`

### Stop Conditions

No stop condition was hit. Future changes must not assume all machines support the same WCS/status capabilities.

## LF-EXT-CANDLE-004: Use parser-derived geometry as preview/progress parity evidence

Risk: MEDIUM
Status: FIXED

Learned from: Candle
Evidence: `repo-notes/10-candle.md`; Candle `src/candle/parser/*`; Candle `src/candle/drawers/*`
LaserForge target: preview/output consistency, progress reporting, burn bounds, export/send parity
Action type: ADAPT TEST PATTERN

### External Pattern

Candle builds visualizer/progress geometry from parsed G-code state: line segments, bounds, arc expansion, S-values, modal state, and line indexes.

### LaserForge Current State

LaserForge's G-code preview is derived from emitted G-code, not UI state. The preview parser tracks G0/G1/G2/G3, G90/G91, M3/M4/M5, S-values, feed, I/J/R arcs, cut/travel classification, duration, total move count, and sampled large-job previews. The emitted burn-envelope parser independently validates actual burn bounds from materialized and streamed output.

### Gap

The remaining Candle-style proof gap was sampled-preview bounds: large previews must keep full-job bounds and counts even when only a subset of moves is retained for rendering.

### Proposed Change

Extended `tests/gcode-preview-large-job-sampling.test.ts` to prove sampled preview models report full emitted-job bounds, not merely the bounds of retained sample moves. No production behavior change was needed.

### Tests Required

Covered by preview/output parity fixtures, arc parity, relative mode, laser-state classification, large-job sampling, emitted-burn-envelope, streamed burn-envelope, raster row parity, canvas preview classification, output-lane semantic snapshots, typecheck, and focused lint.

### Verification

- `npx tsx tests\gcode-preview-large-job-sampling.test.ts`
- `npx tsx tests\gcode-preview-output-parity-fixtures.test.ts`
- `npx tsx tests\gcode-preview-arcs.test.ts`
- `npx tsx tests\gcode-preview-relative-mode.test.ts`
- `npx tsx tests\gcode-preview-laser-state.test.ts`
- `npx tsx tests\emitted-burn-envelope.test.ts`
- `npx tsx tests\emitted-burn-envelope-arcs.test.ts`
- `npx tsx tests\emitted-burn-envelope-r-mode-arcs.test.ts`
- `npx tsx tests\emitted-burn-envelope-stream.test.ts`
- `npx tsx tests\raster-bidirectional-row-parity.test.ts`
- `npx tsx tests\canvas-toolpath-preview-travel-classification.test.ts`
- `npm run test:output`
- `npx tsc --noEmit --pretty false`
- `npx eslint src\ui\components\gcodePreviewModel.ts src\ui\components\GcodePreview.tsx src\core\output\emittedBurnEnvelope.ts tests\gcode-preview-large-job-sampling.test.ts tests\gcode-preview-output-parity-fixtures.test.ts tests\gcode-preview-arcs.test.ts tests\gcode-preview-relative-mode.test.ts tests\gcode-preview-laser-state.test.ts tests\emitted-burn-envelope.test.ts tests\emitted-burn-envelope-arcs.test.ts tests\emitted-burn-envelope-r-mode-arcs.test.ts tests\emitted-burn-envelope-stream.test.ts tests\raster-bidirectional-row-parity.test.ts tests\canvas-toolpath-preview-travel-classification.test.ts --max-warnings 0`

### Stop Conditions

No stop condition was hit. The change strengthens emitted-output parity proof only; it does not change preview rendering or G-code semantics.

## LF-EXT-CANDLE-005: Make machine setup requirements and compatibility limits visible

Risk: MEDIUM
Status: FIXED

Learned from: Candle
Evidence: `repo-notes/10-candle.md`; Candle README; Candle help files
LaserForge target: machine setup UX, beginner/pro gates, WCS reset button, recovery checklist removal, supported-machine profiles
Action type: ADAPT UX/DIAGNOSTIC PATTERN

### External Pattern

Candle tells users to use the correct GRBL version/configuration and documents `$10`, `$5/$6`, `$22/$23`, homing, probing, and WCS setup as normal product setup.

### LaserForge Current State

LaserForge now separates hard safety gates from machine-compatibility gates. Beginner mode requires real frame proof; advanced mode keeps the explicitly labelled "Start without framing" override. WCS reset-to-baseline remains reachable through a visible button and a service operation. Machine Settings exposes live/profile capability confidence, GRBL compatibility modes, manual-zero WCS compatibility, and known-machine profile settings. The PRT4040 router-laser profile explicitly disables homing, disables post-job return-to-origin, and allows manual-zero start only as a profile-level compatibility decision.

### Gap

The production behavior did not need another safety change. The gap was proof consolidation: the compatibility story was scattered across user-mode, WCS, machine-settings, recovery, and known-profile tests, making it too easy to regress the "not all machines can prove all checks" policy.

### Proposed Change

Added `tests/machine-setup-compatibility-contract.test.ts` to prove the Candle-derived setup contract in one place:

- beginner mode cannot start without framing;
- advanced mode exposes the unframed-start override explicitly;
- unsupported Home and WCS-normalize capability paths refuse cleanly;
- capable idle machines still have WCS reset/normalize available;
- WCS reset is surfaced before generic recovery copy;
- manual-zero compatibility accepts unverified WCS only through profile policy;
- active recovery still blocks Start without the dead-end "Recovery checklist incomplete" wording;
- PRT4040 is a manual-zero known-machine profile;
- Machine Settings exposes capability confidence and compatibility controls;
- the setup wizard scopes generic CO2 support to GRBL-compatible machines.

### Tests Required

`tests/machine-setup-compatibility-contract.test.ts` plus the existing adjacent setup, WCS, recovery, settings, and profile tests.

### Verification

- `npx tsx tests\machine-setup-compatibility-contract.test.ts`
- `npx tsx tests\user-mode-gates.test.ts`
- `npx tsx tests\build-start-readiness.test.ts`
- `npx tsx tests\controls-reset-wcs-baseline.test.tsx`
- `npx tsx tests\machine-settings-capability-indicators.test.ts`
- `npx tsx tests\grbl-compatibility-settings-ui.test.tsx`
- `npx tsx tests\prt4040-router-laser-profile.test.ts`
- `npx tsx tests\wcs-profile-gate-contract.test.ts`
- `npx tsx tests\operation-gate-decisions.test.ts`
- `npx tsx tests\recovery-state-blocks-start.test.ts`
- `npx tsx tests\start-mode-wcs-reset.test.ts`
- `npx tsx tests\controller-settings-snapshot.test.ts`
- `npx tsx tests\wizard-grbl-support-scope.test.ts`
- `npx tsx tests\preflight-capability-mismatches.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint tests\machine-setup-compatibility-contract.test.ts src\app\UserModeGates.ts src\app\OperationGate.ts src\ui\components\connection\buildStartReadiness.ts src\ui\components\settings\MachineSettingsTab.tsx src\ui\components\WelcomeWizard.tsx --max-warnings 0`

### Stop Conditions

No stop condition was hit. This was a proof-only change; it does not weaken hard laser/motion safety or change product behavior.

## LF-EXT-CANDLE-006: Treat script, network, and manual command surfaces as trusted-boundary risks

Risk: MEDIUM
Status: FIXED

Learned from: Candle
Evidence: `repo-notes/10-candle.md`; Candle `src/candle/script/scriptdevice.cpp`; Candle `src/candle/connections/*`; Candle `src/candle/frmmain.cpp`
LaserForge target: Electron IPC, Falcon WiFi, manual console, serial permissions, macro/script surfaces
Action type: ADAPT VALIDATION PATTERN

### External Pattern

Candle exposes command sending through serial, telnet, websocket, script device APIs, runtime commands, and command expression evaluation.

### LaserForge Current State

LaserForge has Electron IPC, Falcon WiFi, manual console, and device-control paths. Current trusted-boundary protections include main-process sender verification for IPC handlers, renderer sandbox/context isolation, typed storage IPC, no broad native serial/sendGcode IPC bridge, Falcon main-process private-LAN IPv4 target validation, WiFi start-job trust gates, and service-layer approval tokens for warn/dangerous user commands.

### Gap

No current product gap was found in this focused pass. The remaining gap was proof consolidation: the security posture was spread across many focused tests and needed one Candle-derived command-boundary contract tying Falcon, IPC, manual console, and preload exposure together.

### Proposed Change

Added `tests/trusted-command-boundary-contract.test.ts` to prove:

- Falcon IPC accepts only private LAN IPv4 targets and rejects hostnames, localhost, external IPs, URL syntax, custom ports, paths, and non-strings;
- Falcon IPC handlers are guarded by `assertTrustedSender`;
- Electron main IPC handlers are guarded by `assertTrustedSender`;
- renderer hardening keeps `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`;
- manual console classifier catches embedded `M3`/`M4`, `G10`, and `G92` command words;
- service command gateway blocks warn/dangerous user commands without command-bound approval tokens;
- workflow setup console does not directly send warn/dangerous commands;
- preload exposes a narrow bridge and no broad `sendGcode` shortcut.

### Tests Required

`tests/trusted-command-boundary-contract.test.ts` plus the existing Falcon, command-classifier, service-token, IPC, sandbox, and storage IPC tests.

### Verification

- `npx tsx tests\trusted-command-boundary-contract.test.ts`
- `npx tsx tests\falcon-wifi-ipc-target-validation.test.ts`
- `npx tsx tests\falcon-wifi-trust.test.ts`
- `npx tsx tests\falcon-wifi-trust-blocks-start.test.ts`
- `npx tsx tests\command-classifier.test.ts`
- `npx tsx tests\machine-service-user-sendcommand.test.ts`
- `npx tsx tests\ipc-attack-surface.test.ts`
- `npx tsx tests\electron-renderer-sandbox.test.ts`
- `npx tsx tests\typed-storage-ipc.test.ts`
- `npx tsx tests\storage-ipc-no-broad-clear.test.ts`
- `npx tsx tests\no-electron-sendgcode-export.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint tests\trusted-command-boundary-contract.test.ts electron\falcon-wifi\FalconTargetPolicy.ts electron\falcon-wifi\FalconWiFiService.ts electron\main.ts electron\preload.ts src\controllers\grbl\CommandClassifier.ts src\app\MachineCommandGateway.ts src\app\MachineService.ts src\ui\components\ConnectionPanelMain.tsx src\ui\components\ConnectionPanel.tsx --max-warnings 0`

### Stop Conditions

No stop condition was hit. This was a proof-only change; it did not require a broad network/device-control rewrite.

## LF-EXT-CANDLE-007: Reject monolithic sender/UI structure and unproven test posture

Risk: LOW
Status: VERIFIED

Learned from: Candle
Evidence: `repo-notes/10-candle.md`; Candle `src/candle/frmmain.cpp`; `audit-artifacts/candle/build-test-status.txt`
LaserForge target: architecture boundaries, release confidence, future refactors
Action type: REJECT STRUCTURE / KEEP CONCEPTS ONLY

### External Pattern

Candle is behaviorally useful but centralizes much of the app in `frmMain.cpp`; this static pass did not prove a maintained local test command.

### LaserForge Current State

LaserForge has large hot files (`GrblController.ts`, `MachineService.ts`, `ConnectionPanelMain.tsx`), but its repo-level structure already separates app orchestration, controllers, core job/plan/output, diagnostics, import/io, runtime, security, storage, UI, transports, and workers. Its package scripts expose typecheck, lint, build, output/unit/sim/perf test lanes, project-map checks, license checks, and signed Electron build checks.

### Gap

No direct LaserForge product gap identified from this external note alone. The anti-pattern remains useful as a guardrail: do not use Candle's central `frmMain.cpp` shape to justify broad UI/sender rewrites.

### Proposed Change

No code change. Use Candle's behavior as audit input, not as an architecture template.

### Tests Required

No test required unless a future refactor touches equivalent boundaries.

### Verification

- `Get-ChildItem src -Directory`
- `node -e "const p=require('./package.json'); console.log(JSON.stringify(p.scripts,null,2))"`
- `git ls-files src | ... | Sort-Object Lines -Descending | Select-Object -First 20`

### Stop Conditions

Stop broad UI/sender rewrites inspired by Candle's implementation shape.

## LF-EXT-OBC-001: Treat Electron, local-server, Falcon, and IPC surfaces as hardware-control APIs

Risk: HIGH
Status: FIXED

Learned from: OpenBuilds CONTROL
Evidence: `repo-notes/11-openbuilds-control.md`; OpenBuilds `index.js`; `package.json`; `audit-artifacts/openbuilds-control/electron-security-surface.txt`
LaserForge target: Electron main/preload IPC, Falcon WiFi, manual console, serial/device commands, file upload/import, external URL handling
Action type: ADAPT VALIDATION PATTERN / REJECT BROAD LOCAL-SERVER MODEL

### External Pattern

OpenBuilds exposes hardware-control commands through a local Express/Socket.IO server and Electron renderer. The inspected code listens on `0.0.0.0`, sets broad CORS/private-network headers, allows command-capable Socket.IO handlers, and creates a BrowserWindow with Node integration enabled and context isolation disabled.

### LaserForge Current State

LaserForge has Electron IPC, Falcon WiFi, manual console, import/export, and serial/device-control surfaces. Current evidence shows it does not expose an OpenBuilds-style unauthenticated Express/Socket.IO hardware-control LAN server; hardware-control APIs are kept behind Electron IPC, Web Serial, Falcon target validation, and service-level command approvals. Electron renderer hardening, sender verification, navigation blocking, CSP, typed storage IPC, and no broad native serial/sendGcode IPC are pinned by tests.

### Gap

No current product gap was found in this focused comparison. The OpenBuilds lesson is retained as a regression guard: do not add a broad local-server command surface, and keep validation in main/service code.

### Proposed Change

Added `tests/openbuilds-boundary-comparison.test.ts` to prove:

- no Express/Socket.IO/CORS/Koa/Fastify command-capable local-server dependency;
- no source-level `0.0.0.0` listener, private-network CORS header, or Socket.IO hardware-command handler;
- Electron main and Falcon IPC handlers are sender-guarded;
- renderer hardening remains `nodeIntegration: false`, `contextIsolation: true`, and `sandbox: true`;
- external navigation is intercepted through trusted URL handling;
- Falcon IPC rejects arbitrary hostnames, localhost, external IPs, ports, and URL/path syntax;
- manual dangerous commands are classified;
- the service command gateway blocks unapproved user commands;
- preload does not expose broad serial/sendGcode shortcuts.

### Tests Required

`tests/openbuilds-boundary-comparison.test.ts` plus existing IPC, Falcon, command, sandbox, CSP, storage, and production-security tests.

### Verification

- `npx tsx tests\openbuilds-boundary-comparison.test.ts`
- `npx tsx tests\trusted-command-boundary-contract.test.ts`
- `npx tsx tests\electron-navigation-blocked.test.ts`
- `npx tsx tests\electron-csp-integration.test.ts`
- `npx tsx tests\production-security-source-checks.test.ts`
- `npx tsx tests\ipc-attack-surface.test.ts`
- `npx tsx tests\falcon-wifi-ipc-target-validation.test.ts`
- `npx tsx tests\command-classifier.test.ts`
- `npx tsx tests\machine-service-user-sendcommand.test.ts`
- `npx tsx tests\no-electron-sendgcode-export.test.ts`
- `npx tsx tests\electron-renderer-sandbox.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint tests\openbuilds-boundary-comparison.test.ts tests\trusted-command-boundary-contract.test.ts electron\main.ts electron\preload.ts electron\falcon-wifi\FalconTargetPolicy.ts electron\falcon-wifi\FalconWiFiService.ts src\controllers\grbl\CommandClassifier.ts src\app\MachineCommandGateway.ts src\app\MachineService.ts --max-warnings 0`
- `npm run build`

### Stop Conditions

No stop condition was hit. This was a proof-only regression-guard change; no Electron/network rewrite or machine-control behavior change was required.

## LF-EXT-OBC-002: Audit GRBL streaming against RX-byte accounting and ACK/error release

Risk: HIGH
Status: FIXED

Learned from: OpenBuilds CONTROL
Evidence: `repo-notes/11-openbuilds-control.md`; OpenBuilds `index.js`; `audit-artifacts/openbuilds-control/control-surface.txt`
LaserForge target: `GrblController`, spool-backed device send, ACK/error release, realtime commands, cancellation, progress reporting
Action type: ADAPT STREAMING INVARIANT

### External Pattern

OpenBuilds tracks `sentBuffer`, parsed controller RX size, buffer space, blocked/paused state, response-driven `ok` release, and realtime-command bypass.

### LaserForge Current State

LaserForge has a spool-backed send path and prior LF-004 fixes. The focused streaming comparison confirmed that LaserForge already performs encoded-byte accounting, response-driven `ok`/`error` release, realtime pause/stop bypass, stream-refill safety-off, and no full materialization on the `gcode-stream` path. The remaining gap was that LaserForge used a fixed 127-byte receive-buffer budget even when the controller identity line reported a smaller `[OPT:...,rx]` receive buffer.

### Gap

Resolved. `GrblController` now parses the reported RX byte count from `[OPT:...]` and uses `min(127, reportedRxBytes - 1)` as the usable send budget. This keeps default GRBL behavior unchanged, remains conservative for larger controller buffers, and avoids overfilling smaller firmware receive buffers.

### Proposed Change

Implemented a targeted streaming-buffer fix only. No LF-004 spool materialization behavior was changed and no pause/stop/error semantics were rewritten.

### Tests Added / Verified

`tests/grbl-byte-buffer-accounting.test.ts` now proves:

- manual commands respect a smaller controller-reported RX buffer;
- spool-backed device-send streaming respects that smaller RX buffer before and after `ok` release;
- default 127-byte behavior still rejects encoded-overlong lines;
- existing realtime pause still bypasses a full normal queue.

### Verification

Passed:

- `npx tsx tests\grbl-byte-buffer-accounting.test.ts`
- `npx tsx tests\execute-job-output-contract.test.ts`
- `npx tsx tests\grbl-stream-fill-error-safety-off.test.ts`
- `npx tsx tests\grbl-synchronous-transfer-mode.test.ts`
- `npx tsx tests\pause-emits-m5-after-feed-hold.test.ts`
- `npx tsx tests\controller-stop-safety.test.ts`
- `npx tsx tests\error-handler-faults-active-job.test.ts`
- `npx tsx tests\error-handler-sends-safety-off.test.ts`
- `npx tsx tests\streaming-health-saturation.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint src\controllers\grbl\GrblController.ts tests\grbl-byte-buffer-accounting.test.ts --max-warnings 0`

### Stop Conditions

No stop condition was hit. The fix changed only the receive-buffer budget used by existing send logic; it did not re-materialize large jobs or alter G-code semantics.

## LF-EXT-OBC-003: Audit pause, resume, stop, jog cancel, and test fire as firmware-specific safety sequences

Risk: HIGH
Status: VERIFIED

Learned from: OpenBuilds CONTROL
Evidence: `repo-notes/11-openbuilds-control.md`; OpenBuilds `index.js`; `audit-artifacts/openbuilds-control/control-surface.txt`
LaserForge target: test fire, frame, jog, start, pause, resume, stop, alarm, unlock, stream-refill failure
Action type: ADAPT SAFETY-OPERATION CHECKLIST

### External Pattern

OpenBuilds uses distinct realtime/device-control sequences for pause, resume, stop, jog cancel, and laser test. It also has firmware-version special behavior for laser/spindle stop.

### LaserForge Current State

LaserForge already models these safety operations through controller-owned safety methods and service/coordinator gates. Pause/resume/stop/emergency stop route through GRBL realtime bytes or two-stage safety-off logic; app-level callers use `ctrl.operations.*`; test-fire holds the operation mutex until `M5`/safety-off completes and has a deadman; frame-dot forces laser-off in `finally`; jog, frame, set-origin, autofocus, and test-fire share the operation mutex.

### Gap

No current production gap was found in this focused sector. OpenBuilds remains useful as a behavioral checklist, but no OpenBuilds-specific firmware shortcut should be copied blindly into LaserForge without a controller-family proof.

### Proposed Change

No code change. Keep the existing controller/service separation and targeted safety-operation tests.

### Tests Verified

Normal completion, pause, resume, stop, jog cancel, test-fire timeout/error/cancel, stream-refill failure, alarm, disconnect, clear alarm/unlock, final laser-off, and recovery-state proof.

### Verification

Passed:

- `npx tsx tests\operation-mutex-prevents-overlap.test.ts`
- `npx tsx tests\operation-mutex-lease-tokens.test.ts`
- `npx tsx tests\execution-coordinator-testfire-setorigin.test.ts`
- `npx tsx tests\frame-dot-finally-emits-m5.test.ts`
- `npx tsx tests\safety-operations-controller-routing.test.ts`
- `npx tsx tests\machine-service-pause-resume.test.ts`
- `npx tsx tests\pause-laser-off-confirmation.test.ts`
- `npx tsx tests\resume-awaits-modal-restore.test.ts`
- `npx tsx tests\grbl-stream-fill-error-safety-off.test.ts`
- `npx tsx tests\execution-coordinator-unlock-home-frame.test.ts`
- `npx tsx tests\grbl-legacy-jog-mode.test.ts`
- `npx tsx tests\safety-off-two-stage.test.ts`

### Stop Conditions

No stop condition was hit. This was a source/test recheck only; hardware-specific behavior still belongs in the external beta hardware validation matrix.

## LF-EXT-OBC-004: Preserve no-full-materialization for large device-send jobs

Risk: HIGH
Status: VERIFIED

Learned from: OpenBuilds CONTROL
Evidence: `repo-notes/11-openbuilds-control.md`; OpenBuilds `index.js`; `app/js/websocket.js`; `app/js/main.js`
LaserForge target: LF-004 spool-backed start path, output spool, ticket types, export/send parity
Action type: REJECT FAKE STREAMING / KEEP INVARIANT

### External Pattern

OpenBuilds chunks the actual send, but `runJob()` still receives a full string, splits it, and enqueues all lines before send. This is queue streaming, not bounded job generation.

### LaserForge Current State

LaserForge fixed LF-004 with ticket-only start jobs and spool-authoritative output. The current recheck confirms the OpenBuilds fake-streaming anti-pattern is not present on the start/device-send path.

### Gap

No current production gap was found. `compileGcode(..., { gcodeMaterialization: 'ticket-only' })` leaves `ticket.gcodeText === ''` and `ticket.gcodeLines === []`, carries the replayable `gcodeSpool`, and `MachineService.startValidatedJob` hands a `gcode-stream` output to the GRBL controller instead of rematerializing the job. Export/preview paths still request full materialization explicitly.

### Proposed Change

No code change. Preserve the existing spool-backed start path and explicit materialization mode.

### Tests Verified

Large synthetic job start/send ticket shape, no full `gcodeText`/`gcodeLines` on device-send tickets, chunk boundary integrity, deterministic repeated generation, explicit export materialization, and LF-001 regression tests.

### Verification

Passed:

- `npx tsx tests\lf004-spooled-compile-materialization.test.ts`
- `npx tsx tests\execute-job-output-contract.test.ts`
- `npx tsx tests\time-estimator-stream.test.ts`
- `npx tsx tests\raster-gcode-streaming.test.ts`
- `npx tsx tests\large-raster-plan-lazy-materialization.test.ts`
- `npx tsx tests\perf\streaming-expected-blockers.test.ts`
- `npx tsx tests\gcode-encoder-state-isolation.test.ts`
- `npx tsx tests\gcode-emitter-purity-and-zero-distance.test.ts`

### Stop Conditions

No stop condition was hit. This was a focused recheck of the prior LF-004 fix, not a new output rewrite.

## LF-EXT-OBC-005: Separate machine capability diagnostics from hard safety gates

Risk: MEDIUM
Status: VERIFIED

Learned from: OpenBuilds CONTROL
Evidence: `repo-notes/11-openbuilds-control.md`; OpenBuilds `index.js`; `app/js/grbl-settings.js`; `app/js/grbl-settings-defaults.js`; `api.doc`
LaserForge target: machine profiles, WCS reset-to-baseline, beginner/pro setup, unsupported-machine compatibility, start gating
Action type: ADAPT DIAGNOSTIC/PROFILE PATTERN

### External Pattern

OpenBuilds surfaces firmware/profile details, machine travel, GRBL laser mode, hard/soft limits, homing, WCS reset, controller families, and unsupported firmware messaging as explicit setup data.

### LaserForge Current State

LaserForge now distinguishes hard laser/motion safety gates from optional compatibility/setup diagnostics. Known manual-zero machines can explicitly opt into unverified-WCS start behavior, WCS reset-to-baseline is exposed as a direct action where safe, and Machine Settings surfaces live/profile-backed capability confidence for laser mode, homing, soft limits, travel, and GRBL compatibility choices.

### Gap

No current production gap was found in this focused sector. The compatibility model preserves hard blockers for unsafe laser/motion/recovery state while avoiding universal gates for optional homing/WCS capabilities.

### Proposed Change

No code change. Keep profile-aware diagnostics/operator consent for machine-specific compatibility and keep hard safety gates independent.

### Tests Verified

Unsupported homing/status modes, `$10`/WCO/MPos/WPos variants, WCS reset button behavior, known-machine defaults, beginner/pro gates, explicit unproven-machine consent, and no unsafe bypass of hard laser/motion gates.

### Verification

Passed:

- `npx tsx tests\machine-setup-compatibility-contract.test.ts`
- `npx tsx tests\wcs-profile-gate-contract.test.ts`
- `npx tsx tests\user-mode-gates.test.ts`
- `npx tsx tests\build-start-readiness.test.ts`
- `npx tsx tests\controls-reset-wcs-baseline.test.tsx`
- `npx tsx tests\machine-settings-capability-indicators.test.ts`
- `npx tsx tests\grbl-compatibility-settings-ui.test.tsx`
- `npx tsx tests\prt4040-router-laser-profile.test.ts`
- `npx tsx tests\start-mode-wcs-reset.test.ts`
- `npx tsx tests\controller-settings-snapshot.test.ts`
- `npx tsx tests\wizard-grbl-support-scope.test.ts`
- `npx tsx tests\preflight-capability-mismatches.test.ts`

### Stop Conditions

No stop condition was hit. This was a compatibility/safety-gate recheck only; no hard safety gate was weakened.

## LF-EXT-OBC-006: Tie support evidence to actual controller and send state, with redaction

Risk: MEDIUM
Status: FIXED

Learned from: OpenBuilds CONTROL
Evidence: `repo-notes/11-openbuilds-control.md`; OpenBuilds `index.js`; `app/js/diagnostics.js`; `audit-artifacts/openbuilds-control/control-surface.txt`
LaserForge target: support bundles, event ledger, hardware validation evidence, preview/output logs, privacy redaction
Action type: ADAPT OBSERVABILITY PATTERN

### External Pattern

OpenBuilds exposes queue counts, firmware buffers, ports, alarms, console logs, preview parsing, diagnostic toggles, and system details.

### LaserForge Current State

LaserForge support bundles now preserve controller/send evidence that is useful for support triage: structured TX/RX entries, buffer-state snapshots, safety-off event-ledger entries, compile metadata including `outputUsesM4` and spool line count, preflight issue reports, and opt-in emitted G-code for replay.

### Gap

Closed. The support evidence path existed, but the central redaction layer did not scrub MAC addresses, controller serial identifiers, bearer/API tokens, private-key blocks, or structured secret fields such as `apiKey`/`privateKey` when they appeared in support evidence or opted-in G-code comments.

### Proposed Change

Implemented a small central redaction extension in `src/diagnostics/Redaction.ts` for always-sensitive machine/credential identifiers, including key-aware redaction for structured support fields. Added support-bundle and redaction tests proving sensitive identifiers are scrubbed while opted-in G-code keeps motion and laser modal commands useful for replay.

### Tests Required

Support-bundle tests for firmware/settings/queue/event evidence and redaction tests for serial numbers, MAC/IP addresses, paths, tokens, private keys, and local user names.

### Verification

Passed:
- `npx tsx tests\support-bundle.test.ts`
- `npx tsx tests\redaction.test.ts`
- `npx tsx tests\crash-reporting-privacy.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint src\diagnostics\Redaction.ts tests\redaction.test.ts tests\support-bundle.test.ts --max-warnings 0`

### Stop Conditions

Stop if diagnostics would expose sensitive identifiers without a redaction design.

## LF-EXT-OBC-007: Reject release/signing/test anti-patterns

Risk: HIGH
Status: FIXED

Learned from: OpenBuilds CONTROL
Evidence: `repo-notes/11-openbuilds-control.md`; OpenBuilds `package.json`; `.github/workflows/build.yml`; `audit-artifacts/openbuilds-control/test-release-surface.txt`
LaserForge target: signed release workflows, QA/hardware gates, artifact allowlists, secret handling, CI tests
Action type: REJECT ANTI-PATTERN / HARDEN RELEASE GATES

### External Pattern

OpenBuilds provides a useful release comparator because it shows real packaging concerns, but it also has a placeholder test script, release-on-push workflow, signing certificate output in logs, broad package globs, and SSL material in package includes.

### LaserForge Current State

LaserForge has real release workflow and QA-gate work: signed Windows/macOS release workflows are manual-only, signing/notarization secrets are verified before build, `electron-builder` is run with `--publish never`, GitHub Release publishing is gated by explicit `publish_release`, `release_tag`, and `release_qa_confirmed` inputs, artifacts include checksums/SBOM/provenance attestations, and default CI runs real typecheck/lint/build/full-test gates.

### Gap

Closed. Added a dedicated static regression test that rejects the specific OpenBuilds anti-patterns: placeholder `npm test`, signed release on push/tag/PR, secret/certificate printing, automatic `electron-builder` publishing, missing QA confirmation, and repository-wide or credential-bearing package globs.

### Proposed Change

Added `tests/release-openbuilds-antipatterns.test.ts` as a proof-only guard. No release workflow behavior change was needed because the current workflows already satisfy the hardened contract.

### Tests Required

Workflow/static tests for no fake test gates, no secret printing, no private keys in packaged artifacts, no broad artifact globs without allowlist review, signed-release QA gate artifact, checksums/SBOM/provenance presence, and no publish on unverified paths.

### Verification

Passed:
- `npx tsx tests\release-openbuilds-antipatterns.test.ts`
- `npx tsx tests\release-github-publish-workflows.test.ts`
- `npx tsx tests\release-sbom-workflows.test.ts`
- `npx tsx tests\release-artifact-attestations.test.ts`
- `npx tsx tests\windows-signing-release-workflow.test.ts`
- `npx tsx tests\macos-signing-notarization-workflow.test.ts`
- `npx tsc --noEmit --pretty false`
- `npx eslint tests\release-openbuilds-antipatterns.test.ts --max-warnings 0`

### Stop Conditions

Stop if a release hardening change might alter product behavior or requires credentials/secrets not available locally.

## LF-EXT-OBC-008: Reject monolithic Node/Electron control structure

Risk: LOW
Status: VERIFIED

Learned from: OpenBuilds CONTROL
Evidence: `repo-notes/11-openbuilds-control.md`; OpenBuilds `index.js`; `audit-artifacts/openbuilds-control/file-list.txt`
LaserForge target: architecture boundaries and future refactors
Action type: REJECT STRUCTURE / KEEP BEHAVIORAL LESSONS ONLY

### External Pattern

OpenBuilds combines Express server, Electron window creation, streamer, firmware flashing, Socket.IO command handling, diagnostics, and release/update concerns in a large main-process file.

### LaserForge Current State

LaserForge has more explicit sector boundaries than the OpenBuilds monolith pattern: Electron main/preload IPC, Falcon WiFi IPC, controller command gateway, Web Serial controller code, release workflows, diagnostics, and support-bundle logic are split into separate modules and guarded by targeted tests.

### Gap

No current LaserForge product gap identified from this structural observation alone. Existing large files remain maintainability concerns for future roadmap work, but the OpenBuilds comparator does not justify a broad rewrite.

### Proposed Change

No code change. Use OpenBuilds for targeted behavioral checks, not as an architecture template.

### Tests Required

No new test required. Existing boundary/security tests already cover the relevant anti-pattern: no unauthenticated local command server, guarded Electron/Falcon IPC, no broad preload `sendGcode`, and renderer sandboxing.

### Verification

Passed:
- `npx tsx tests\openbuilds-boundary-comparison.test.ts`
- `npx tsx tests\trusted-command-boundary-contract.test.ts`
- `npx tsx tests\ipc-attack-surface.test.ts`
- `npx tsx tests\electron-renderer-sandbox.test.ts`

### Stop Conditions

Stop any broad rewrite justified only by "OpenBuilds did it differently."
