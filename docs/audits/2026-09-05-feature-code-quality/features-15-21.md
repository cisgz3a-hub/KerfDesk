# Feature code-quality audit: features 15–21

Audited source: `ccaa3064d9efe904821307f0603ce842d903b586`, the website inventory's displayed build. All source references below resolve against `C:\Users\Asus\.codex\audits\kerfdesk-features-20260905-ccaa3064`, not the inherited dirty working checkout. No application source, controller, provider, or hardware state was changed.

This is a code audit with five narrowly scoped local reproductions. It is not a new complete browser acceptance run, a full-suite pass, or physical machining/calibration qualification. Findings were checked against surrounding guards and existing tests. “No confirmed defect” means no additional actionable defect was established in the inspected paths, not that the entire feature is proved optimal.

## Results

| Feature | Assessment | Confirmed findings |
| --- | --- | --- |
| 15. Box generation and fit testing | Strong box-generation pipeline; fit-test validation is weaker | F15-01: blank CNC relief diameter generates unrelieved coupons |
| 16. Laser calibration and cut planning | Clear generation/output separation; inconsistent draft validation | F16-01: blank material/interval speed produces an unexportable calibration |
| 17. Registration jig and board placement | Good capture ownership and undo design; grid construction is unbounded | F17-01: unrestricted grid request runs synchronous rows × columns allocation |
| 18. Camera workflows | Strong source and coordinate-basis checks; alignment completion lacks ownership | F18-01: canceled detection writes alignment into the current project |
| 19. Rotary, Print and Cut, Labs | Coherent laser mapping and experimental-feature state | No additional confirmed defect; CNC rotary output is intentionally excluded |
| 20. Machine Setup / CNC Startup Setup | Coherent local draft, explicit save, and retained-setting semantics | No additional confirmed defect in inspected paths |
| 21. CNC machining | Substantial geometry/provenance separation and output invariants | No additional confirmed defect in inspected paths; shared group construction could be consolidated |

## 15. Box generation and fit testing

**Verdict:** Box Generator is one of the better structured workflows inspected. Its UI does not equate “a preview exists” with “the current parameters have finished generating.” `BoxGeneratorDialog.tsx` submits only `generation.currentSnapshot`; `use-box-generation.ts:150–151` requires the snapshot's serialized specification to match the current form. Worker request ownership, close/unmount cancellation, and replacement requests are explicit. The previous preview is labeled stale while work changes.

The pure generator validates dimensions, applies fit and CNC relief separately, checks generated coordinates, verifies assembly, then returns complete panels or a typed failure. Insertion creates a new operation and one undo entry, preserving internal cutouts as rings. CNC panels use outside profiles so cutter compensation remains in the machining pipeline rather than being applied twice.

**F15-01 — P2, reproduced: clearing CNC relief-tool diameter silently creates coupons without relief.**

- Source: `src/ui/box/BoxFitTestDialog.tsx:68–80`; `src/core/box/fit-coupon.ts:57–97`, especially line 68; `src/core/box/panel-fit.ts:49–60`; `src/ui/calibration/CalibrationNumberField.tsx:17–29`.
- Trigger: in CNC mode, open Box Fit Test, clear **Relief tool diameter**, then Generate. This is an ordinary incomplete-field edit. The HTML field has no `required`; blank passes browser validity and `Number('')` becomes zero.
- Defect: the coupon validator checks the thickness, finger width, ladder step, start and count. Its only relief-diameter check is whether the tool is at least as wide as the finger. It never requires a finite positive tool diameter. Zero proceeds to a radius-zero subtraction and returns `generated`.
- Impact: the workflow reports a generated CNC fit test even though its corners have no cutter relief. The coupon is not equivalent to a correctly relieved production box, so it can mislead fit calibration. This is a generated-geometry defect, not a claim of physical injury or of a changed Start policy.
- Reproduction: the real dialog accepted the blank field and invoked `onGenerate`. Direct generation with zero diameter produced the same vertex counts as the no-relief strips and only orthogonal edges; generation with 3.175 mm produced additional relief vertices. Clipper also normalizes/rounds nominal coordinates, so the report does not claim the zero-relief geometry is byte-identical to no relief.
- Scoped fix: validate a finite positive CNC relief diameter in `generateFitCoupon`, and preserve incomplete text until the dialog shows a field-specific validation message. Share the diameter rule with the box-spec validator if doing so avoids divergent constraints.
- Acceptance: blank, zero, negative and non-finite CNC relief values do not generate or insert; a valid positive tool still creates relieved corners; laser coupons remain independent of a hidden CNC diameter.

Inspected source: `src/ui/box/{BoxGeneratorDialog,use-box-generator-form,use-box-generation,BoxFitTestDialog,BoxFitTestHost}.tsx/ts`, `src/ui/state/box-insert-mutation.ts`, and `src/core/box/{box-spec,generate-box,panel-fit,fit-coupon}.ts`.

Existing test evidence inspected: `src/ui/box/use-box-generation.test.tsx` verifies that a closed dialog's response cannot satisfy a reopened request; `BoxGeneratorDialog.worker.test.tsx` covers matching geometry, invalid/incomplete drafts, cancellation and fallback disclosure. `src/core/box/generate-box.test.ts` checks deterministic panel counts/layout and failure-without-panels. `fit-coupon.test.ts` numerically checks each rung's notch-minus-tab clearance and positive-diameter CNC relief, but omits zero/blank relief.

## 16. Laser calibration and cut planning

**Verdict:** Material and Interval tests have a understandable UI → typed generator → undoable scene-replacement flow, and distinguish requested from capped effective feed in normal input cases. Scan Offset Test is more careful: it has explicit validation messages and separates uncorrected baseline from verification against the saved correction table. Cut Planner preserves bypassed settings and explains the precedence of source order; its legacy `reduceTravelMoves` flag is synchronized on Apply.

**F16-01 — P2, reproduced: blank speed is accepted as a successful calibration that cannot emit G-code.**

- Source: `src/ui/calibration/IntervalTestDialog.tsx:72–75,143–145`; `src/ui/calibration/MaterialTestDialog.tsx:78–81,156–158`; `src/ui/calibration/CalibrationNumberField.tsx:17–29`; `src/core/job/interval-test-grid.ts:65`; `src/core/job/material-test-grid.ts:80–81`.
- Trigger: clear Interval Test **Speed**, or clear Material Test **Min speed** while retaining the default multiple rows, and press Generate.
- Defect: neither dialog checks incomplete required fields before generation. The shared number input is optional from the browser's perspective. Both parsers convert blank to zero. The core helper named `clampFinite` keeps finite zero rather than enforcing its positive fallback, creating zero-speed operation(s).
- Downstream evidence: `src/ui/state/generated-scene-actions.ts:28–37` stores the generated scene unchanged. `src/core/job/vector-group-fields.ts:15` only applies the profile's upper ceiling, retaining zero. `src/core/output/grbl-strategy.ts:60–64` rejects zero when a fill group emits. Thus this is **not** an emitted dangerously slow cut: the generator succeeds and replaces artwork, while output generation subsequently fails. The existing scene replacement is undoable.
- Reproduction: real dialog inputs returned `checkValidity() === true` while blank; Generate invoked the callback. Actual generators returned effective speed zero and the actual GRBL strategy threw `speed must be finite and > 0` for the compiled result, for both dialogs.
- Scoped fix: perform complete finite/range draft validation before either replacing the scene or persisting the draft. Core generators should have a documented invalid-input contract rather than accidentally preserving zero through a misleadingly named helper. Reuse Scan Offset's explicit validation approach without imposing additional machine policy gates.
- Acceptance: no callback/scene replacement for missing speed; inline explanation names the field; valid min/max ordering and maximum-feed labels remain correct; generated scenes with accepted settings emit successfully.

Inspected source: `src/ui/commands/{CalibrationGridDialogs,ScanOffsetCommandDialog}.tsx`, `src/ui/calibration/{MaterialTestDialog,IntervalTestDialog,ScanOffsetCalibrationDialog,CalibrationNumberField}.tsx`, `src/core/job/{material-test-grid,interval-test-grid,scan-offset-calibration-pattern,vector-group-fields}.ts`, `src/ui/laser/OptimizationSettingsDialog.tsx`, plus the actual scene and emission boundaries above.

Existing test evidence inspected: Material/Interval dialog tests cover normal parsing, persisted settings and Escape; they omit empty-field generation. `scan-offset-calibration-pattern.test.ts` checks both-direction sweeps and zero-offset baseline against an existing saved table. `OptimizationSettingsDialog.test.tsx` checks all policies and saved-but-bypassed values. Focus Test remains an explicitly disabled/unqualified workflow; it is not counted as an enabled failure.

## 17. Registration jig and board placement

**Verdict:** Jig objects and generated copies remain associated with their operations, and repeated auto-fit replaces generated copies instead of multiplying them. Board capture distinguishes captured-board geometry from free jig outlines. It binds capture to controller session, trusted-position and work-origin identities. Verification requires a fresh status after dispatched motion; cancellation preserves ownership until cancellation settles. Those are meaningful lifecycle protections.

**F17-01 — P2, UI boundary reproduced and loop verified statically: jig grid accepts unrestricted synchronous work.**

- Source: `src/ui/workspace/RegistrationJigOutlineFields.tsx:55–72`; `src/ui/workspace/RegistrationJigOutlineControls.tsx:87–97,235–237`; `src/ui/state/registration-jig-set-actions.ts:90–110,135–137`.
- Trigger: type/paste `10000` for both Jig rows and columns, then press the offered **Create 100000000 jigs** button.
- Defect: the fields have no maximum, the Create action is not gated on total work, and both normalizers accept any positive safe integer. The state action immediately performs nested loops on the UI thread and allocates one outline per cell. There is no bound, chunking, worker, or cancellation at that boundary.
- Impact: a user-editable count can request 100 million objects and stall/exhaust the tab, risking unsaved work. Actual hang time and memory exhaustion were deliberately not exercised; the iteration count is exact from the code. This is a computational-integrity concern, not a proposed limit based on material fit or machine policy.
- Safe reproduction: the real UI accepted both values and dispatched `{rows:10000, columns:10000}` to an intercepted action. The dangerous allocation was not run.
- Scoped fix: validate total generated work before constructing objects. For workloads intended to remain supported, use bounded/cancellable preparation and an atomic final insert; otherwise reject the oversized construction with a clear computational limit. Also keep incomplete/invalid draft states distinct from silently defaulting to one row or 1 mm.
- Acceptance: oversized product is rejected or handled asynchronously without entering the synchronous allocator; invalid/blank counts do not mutate; ordinary grids preserve fixture origin, object IDs, locked state and one-step undo.

Inspected source: `src/ui/workspace/{RegistrationJigPanel,RegistrationJigOutlineControls,RegistrationJigOutlineFields}.tsx`, `src/ui/state/{registration-jig-set-actions,registration-jig-artwork-actions}.ts`, `src/ui/laser/board-capture/{use-board-capture-handlers,use-board-capture,use-board-verification}.ts` and its validation/placement entry points.

Existing test evidence inspected: `registration-jig-set-actions.test.ts` covers centered grids, replacement identity/lock behavior and captured-board protection. `registration-jig-artwork-actions.test.ts` covers operation references, repeat insertion, groups and circle fit. `use-board-verification.test.tsx` covers fresh Idle, stale epochs, physical-cancellation settlement and missing cancellation capability. None provides a work bound for the jig grid.

## 18. Camera workflows

**Verdict:** Source management is thoughtfully separated from consumers. USB startup releases orphaned streams when superseded; status callbacks are scoped to the current source/epoch. RTSP monitoring distinguishes one transient unavailable reading from repeated failures. Alignment, overlays and tracing explicitly distinguish raw versus rectified bases, source capture identities, changed resolution and surface height. However, the alignment consumer does not carry the same ownership discipline through its async completion.

**F18-01 — P2, reproduced with mocked camera capture: exiting detection does not cancel its later profile write.**

- Source: `src/ui/camera/align-wizard/AlignWizardDetectStep.tsx:23–39`; `src/ui/camera/auto-align.ts:40–54`; `src/ui/camera/align-wizard/camera-align-wizard-store.ts:65–73`; `src/ui/state/store-actions.ts:68–78`.
- Trigger: start Detect markers with a delayed network-camera frame; close the wizard; open/replace the project before the frame completes.
- Defect: the operation captures its old source, calibration and bed dimensions, awaits a frame, then calls the unscoped `updateDeviceProfile`. Closing only resets `open` and the step. It does not invalidate a request token. The store action writes its patch into whichever project is current when called, and completion subsequently sets the closed wizard's step to done.
- Impact: an operation the user canceled can overwrite alignment on another project/device using a solve from the earlier setup. Even without a new project, Exit does not prevent the canceled write. The source-binding check compares the old source to the old calibration, so it does not reject this ownership problem.
- Reproduction: actual wizard/DetectStep/store actions were used; only camera capture and marker-detection/solve math were mocked. While capture was pending, the real Exit unmounted the wizard. After replacement of the project and release of the deferred frame, the replacement device gained `cameraAlignment`; the closed wizard's step became `done`. No camera/network/hardware calls occurred.
- Scoped fix: return the proposed alignment as data, and commit only if the initiating wizard request, project identity/epoch and device/source inputs still match. Invalidate on Exit, reopen, source replacement and document replacement. Scope completion messages and surface-height changes to the same request. Aborting available network work can save resources but is not a substitute for checking ownership before mutation.
- Acceptance: delayed successful capture after Exit/reopen/project switch performs no profile or wizard-state mutation; delayed older results cannot overwrite a newer solve; the unchanged initiating session still saves successfully.

Inspected source: `src/ui/state/{camera-source-actions,camera-source-lifecycle}.ts`, `src/platform/web/web-camera.ts`, `src/ui/camera/{frame-source,auto-align,trace-from-camera}.ts`, `TraceFromCameraButton.tsx`, wizard shell/calibration review and alignment state/DetectStep.

Existing test evidence inspected: `camera-source-lifecycle.test.ts` explicitly tests stale USB/RTSP callbacks and status-channel hiccups, while `auto-align.test.ts` tests missing frames, missing markers and mismatched calibration. Those do not cover wizard Exit or project replacement during detection. `TraceFromCameraButton.tsx` has a similar unowned delayed completion that can open a stale trace dialog; this is a related follow-up candidate, not a separately reproduced finding here.

## 19. Rotary, Print and Cut, Labs

**Verdict:** The laser rotary model separates surface distance from controller Y travel and centralizes machine-space transformation for output consumers. Reverse mapping includes raster traversal direction. Rotary is configurable in CNC mode, but `src/core/job/rotary-job.ts:19–24` deliberately excludes CNC output. That matches the inventory's caution: the enabled setup command is not proof of rotary CNC machining support.

Print and Cut converts reported controller positions into the same scene frame as design targets and normalizes inch reports before solving. It requires distinct point pairs, and captured-point trust epochs invalidate registration when position trust changes. Labs defaults to off, uses explicit boolean persistence, and survives unavailable browser storage.

Inspected source: `src/ui/laser/{RotarySetupDialog,RotarySetupHost,PrintAndCutDialog,PrintAndCutDialogHost}.tsx`, `src/core/devices/rotary.ts`, `src/core/job/{rotary-job,rotary-transform}.ts`, `src/core/registration/similarity-transform.ts`, `src/ui/laser/print-cut-capture-frame.ts`, `src/ui/state/{print-cut-session-store,experimental-laser-features}.ts` and the rotary command.

Existing test evidence inspected: rotary dialog tests assert wrap math and enablement before generating; `emit-gcode-rotary.test.ts` exercises actual emitted Y/rebasing and mixed raster/vector output. `similarity-transform.test.ts` verifies both target mapping and inverse roundtrip; `PrintAndCutDialog.test.tsx` checks missing/distinct captures. No additional confirmed defect was established in these paths. A useful future UI clarification is to describe rotary setup as a saved laser-output configuration while CNC mode is active; it should not imply unsupported CNC motion.

## 20. Machine Setup / CNC Startup Setup

**Verdict:** This is a coherent draft transaction. `DeviceSetupWizard` captures a local profile/machine draft, and final Save replaces device, machine, workspace sizing, operation bindings and custom-tool state together. CNC tool-plan drafts distinguish “follow default”/manual binding from explicit cutter/material ownership. Material-derived feeds are recomputed when their source changes; manual values are retained. Separately immediate library Save/Delete behavior is explicitly disclosed.

Detected settings are merged deliberately and cleared after a real disconnect. Changes invalidate queued firmware decisions. The wizard compares only settings the controller actually reported; queued writes must also be classified writable. `use-machine-setup-save.ts` honestly distinguishes successful software save from later firmware sync failure. The local store transaction and external controller write sequence cannot be called one atomic transaction, and the UI/reporting does not hide that separation.

Inspected source: `src/ui/laser/device-setup/{DeviceSetupWizard,DeviceSetupCncProfiles}.tsx`, `{cnc-startup-wizard-draft,use-machine-setup-save,device-setup-flow,device-setup-firmware-diff}.ts`, `src/ui/state/{machine-setup-actions,cnc-startup-setup}.ts`.

Existing test evidence inspected: `DeviceSetupWizard.detected-values.test.tsx` covers applied-but-draft-only detections and fresh-read invalidation; `DeviceSetupWizard.cnc.test.tsx` covers preserving user-selected firmware profile and real disconnect. `cnc-startup-setup.test.ts` verifies stable unchanged references, unseeded CNC settings, material-feed recomputation and preserving manual values. No additional confirmed defect was established. No firmware write was performed by this audit.

## 21. CNC machining

**Verdict:** The inspected core is deliberately structured around geometry, operation settings, compiled evidence and emission. It keeps profile-release operations after clearing, resolves primary/secondary tool provenance, applies machine-frame handedness to cut direction, and carries typed relief failures separately. Tabs are represented as continuous Z-rise paths; the tab-top pass prevents a nominal tab height from accidentally becoming full-stock height. The V-carve authoring UI distinguishes flowing depth from explicitly enabled flat floor depth.

The emitter sets units, absolute position, G54, feed mode and XY arc plane, raises Z before starting the spindle, uses plunge feed on entry, retracts for travel, and explicitly handles post-tool-change head uncertainty. These are source/test-backed properties, not physical qualification claims.

Inspected source: `src/ui/layers/{CncLayerFields,CncLayerPrimitives,CncLayerAdvancedFields,CncInlayFields,CncTabPositionControls}.tsx`, `src/ui/layers/use-debounced-commit.ts`, `src/core/cnc/{compile-cnc-job,compile-cnc-operation-groups,compile-cnc-layer-passes,compile-cnc-helpers,inlay-pair-operation}.ts`, `src/core/output/cnc-grbl-strategy.ts`, and tab action/mapping boundaries.

Existing assertions inspected: `compile-cnc-inlay.test.ts` checks pocket-before-insert, exact female/male depths, led male paths and right-origin physical placement. `compile-cnc-tabs.test.ts` checks actual tab rise heights, exact tab-top loops and retaining tabs through a finishing allowance. `cnc-grbl-strategy.test.ts` checks concrete emitted preamble/motion sequences and repositioning after tool change. Pocket/provenance test coverage was also mapped. A candidate that manual inlay tab editing was falsely enabled was rejected after inspecting `CncTabPositionControls`: the edit action requires a profile cut type.

**Optional maintainability improvement:** `cncGroupForPasses` is duplicated in `compile-cnc-job.ts` and `compile-cnc-operation-groups.ts`. Both own feed selection, caps, spindle, coolant, safe Z, park and retract metadata. Their current reviewed behavior agrees, but this is an avoidable divergence point when adding a field. Extract one shared group builder with representative primary, inlay and secondary-tool output checks. This is a refactor opportunity, not a confirmed present-output defect or a reason to rewrite the compiler.

## Reproduction record

Audit-only fixture: `src/__fixtures__/audit-feature15-21.test.tsx` in the extracted snapshot. A retained copy and output log accompany this report. Command:

```text
pnpm exec vitest run src/__fixtures__/audit-feature15-21.test.tsx
```

Final run: **1 file, 5 tests passed**, 13.34 seconds total. The passing tests characterize the current bad behavior; they do not certify the four features as correct. The first run had four passes and one failing over-strict byte/vertex comparison; that comparison was corrected to examine relief geometry, after observing Clipper's normalization/rounding. No application implementation changed. The extracted archive lacks `.git`, so build-label lookup printed three `not a git repository` warnings; Vitest itself completed normally.

The jig allocation was intercepted before construction, and the camera test used deferred mocked capture and mocked marker math. The remaining calibration and fit tests exercised the real dialogs and generators; Material/Interval tests also exercised the real compile and GRBL-emission code. Existing broad suites were inspected, not rerun in this lane.
