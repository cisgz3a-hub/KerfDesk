# Audit remediation ledger

Current authoritative 2026-09-01 remediation: isolated worktree label `ade9`, branch
`codex/fix-vector-topology-output-20260901`, reconstructed from exact `origin/main`
`26745bc7a36adc9d6890d54aa3f906330d32df6b` (tree
`7463233cc5c8396896186486603317cab240b6b0`). The preceding design-state remediation merged through
PR #711; its exact-head required checks and exact-main Chrome smoke are green, while the independent
exact-main full-CI/automatic-Pages evidence remains a separate live lane below. The original dirty checkout was
re-fingerprinted read-only at `9209fcb33f4807ebfc1f7a55780069b6a7b0e23c`, branch
`claude/vcarve-stamp-subcell`, with 9 modified tracked files, 0 staged files, 13 untracked files,
and tracked-diff hash `6a1fc1cb119a370814a5eb65c66f78c4038f41a5`. The detached `6b32` donor retained the same
HEAD/tracked-diff hash with 9 modified tracked, 0 staged, and 4 untracked files. The historical
`ab91` donor path is absent. Both extant evidence trees remain read-only; current verification and
integration evidence is recorded in the dated section appended below.

Historical 37-item implementation donor worktree: no longer present.

Current independent Ultra-audit remediation worktree: isolated review worktree, branch
`codex/remediate-ultra-audit-20260830`, audited from exact `origin/main`
`c26c9ca96a42ca26a883b968a5f539bc473cee5e` (tree
`21ed530c3f712abde7ab07acab61fff65fb0e7d4`). The preceding advanced-CNC remediation is in that
base through merged PR #704.

Current-main integration worktree: historical isolated integration worktree, branch
`codex/laserforge-audit-remediation-37`, based on
`a6a4ba4885507fbac8320417708b9fcc6a0748b2`. The verified 37-item source integration commit is
`b4c272654b18fc167762a46bc491a626c880bba1`.

Audited base: detached `9209fcb33f4807ebfc1f7a55780069b6a7b0e23c`, inheriting the
original checkout's nine modified tracked files and four untracked files. The original checkout is
read-only for this remediation run.

This is the single integration record for the confirmed 2026-08-25 remediation inventory. It does
not authorize a new guard: Frame remains the only ordinary Start guard, policy concerns stay
nonblocking warnings in Job Review, and hardware/perceptual qualification stays separate from
source and automated-test evidence.

## Preserved last-100-PR audit history

The following history is retained from `codex/pr100-remediation` rather than overwritten. Its source
is the retained last-100-PR evidence report, `audit-findings.md`.

| Finding | Remediation | Status | Verification |
|---|---|---|---|
| AUD-100-001 | Preserve an existing G-code target when preparation fails | verified on its implementation branch | Single-file saves retain an editable filename; tiled saves reserve one directory and create no file target before successful preparation; web adapter, file-action, and tiled-worker regressions passed there. |
| AUD-100-002 | Re-land sub-cell cutter-position stamping | verified on its implementation branch | Exact sub-cell regression cases and simulator suite passed there. |
| AUD-100-003 | Ignore hidden engraving tip-flat state for other tool kinds | verified on its implementation branch | Add CNC bit form suite passed there. |
| AUD-100-004 | Align V-carve AABB filtering with tolerant intersection domain | verified on its implementation branch | Near-endpoint deterministic regression passed there. |
| AUD-100-005 | Re-land material-library streaming on current main | verified on its implementation branch | Streamed material and SVG import suites passed there. |
| AUD-100-007 | Use the visible `Traced edges` term in the accessible name | verified on its implementation branch | DOM accessible-name regression passed there. |
| AUD-100-008 | Move autosave session/clear state out of mutable module globals | verified on its implementation branch | Autosave suite passed there with sessionStorage state and per-window history-state fallback. |
| AUD-100-009 | Reconcile the orphan wood viewer with current main | superseded | Current main already carried the later carved-wood material and shader architecture. |
| AUD-100-010 | Keep the open-path note scoped to its layer | verified on its implementation branch | Layer clarity suite passed there. |
| AUD-100-011 | Use deterministic casing for fixed-English tooltip copy | verified on its implementation branch | Fixed-English implementation and TypeScript verification passed there. |
| AUD-100-012 | Replace obsolete Start-blocking probe copy with warning truth | verified on its implementation branch | Reminder-only notice and readiness-policy suites passed there. |
| AUD-100-013 | Replace custom-bit deletion refusal with assignment reset | verified on its implementation branch | Library UI/store action regressions passed there. |
| AUD-100-014 | Preserve every positive Stepover value through planners | verified on its implementation branch | 1%, 40%, and 200% pocket/rest/surfacing/relief cases passed there. |

Those results are historical evidence, not verification of this detached worktree. Every applicable
item is rechecked here before it is marked complete.

## 2026-08-25 confirmed inventory

The exact audit finding text was supplied in the delegated implementation authorization. Source
anchors are added or narrowed as each slice is reproduced; `delegated audit S1`, for example, is an
exact anchor to that immutable inventory item rather than a claim that source has already been
re-inspected.

| ID | Severity | Remediation and evidence anchors | Status | Verification evidence | Remaining limits |
|---|---|---|---|---|---|
| S1 | CRITICAL | Keyboard Fire fail-off; delegated audit S1; `src/ui/laser/MomentaryFireControl.tsx:41,65-92`; ADR-162 (`DECISIONS.md:7575-7590`) | verified in this worktree | `pnpm exec vitest run src/ui/laser/MomentaryFireControl.test.tsx src/ui/state/laser-fire-actions.test.ts src/ui/laser/LiveMotionBar.test.tsx` — 26/26 passed; focused ESLint, Prettier, and `git diff --check` passed | No physical beam-off qualification; rejected `M5` intentionally retains the visible retry latch |
| S2 | HIGH | Autofocus fresh same-session Idle and motion-uncertain ownership; delegated audit S2; `src/ui/state/autofocus-fresh-idle.ts:21-45`; `src/ui/state/laser-autofocus-actions.ts:38-114`; `src/ui/state/laser-status-line.ts:126-138`; `src/ui/state/laser-connection-actions.ts:95-101,254-279` | verified in this worktree | `pnpm exec vitest run src/ui/state/autofocus-action.test.ts src/ui/state/laser-store-autofocus-ownership.test.ts src/ui/laser/ControllerConnectionControls.test.ts src/ui/laser/LiveMotionBar.test.tsx src/ui/state/laser-line-handler.test.ts src/ui/state/laser-connection-epoch.test.ts` — 71/71 passed; focused ESLint, Prettier, and `git diff --check` passed | No physical autofocus/controller qualification; timeout and write-receipt uncertainty deliberately require fresh Idle, reset, or reconnect before later motion |
| S3 | HIGH | Ordinary laser Start final fresh-status/position fence; delegated audit S3; `src/ui/state/laser-live-start-readiness.ts:22-85`; `src/ui/state/framed-run.ts:177-192`; `src/ui/state/laser-job-actions.ts:209-217` | verified in this worktree | `pnpm exec vitest run src/ui/state/laser-store-laser-start-fresh-status.test.ts src/ui/state/framed-run.test.ts src/ui/state/laser-store-start-evidence-wire-guard.test.ts src/ui/state/laser-store-mpg-ownership.test.ts src/ui/laser/start-job-framed-permit-claim.test.ts src/ui/laser/start-job-current-position-repeat.test.ts src/ui/laser/start-job-flow.review-at-start.test.ts` — 50/50 passed; focused ESLint, Prettier, and `git diff --check` passed | No hardware streaming qualification; recovery/replay intentionally retain their separate resumability evidence and do not carry an ordinary Frame permit |
| S4 | MEDIUM | Direct jog no-go/unresolved-XY policy findings become warnings; delegated audit S4; `src/ui/state/laser-jog-actions.ts:312-391`; `src/ui/laser/MachineSetupSafetyZones.tsx:33-39`; ADR-129 amendment (`DECISIONS.md:6756-6765`) | verified in this worktree | `pnpm exec vitest run src/ui/state/laser-jog-actions.zone-guard.test.ts src/ui/state/laser-jog-actions.bounds-warning.test.ts src/ui/state/laser-store-jog-to-point.test.ts src/ui/state/laser-store-jog-to-point-readiness.test.ts src/ui/state/laser-store-motion-operation.test.ts src/ui/state/laser-store-motion-disconnect.test.ts src/ui/laser/MachineSetupSafetyZones.test.tsx src/ui/laser/SafetyZonesPanel.test.tsx` — 50/50 passed; focused ESLint, Prettier, and `git diff --check` passed | No hardware jog qualification; homing remains outside configured-zone comparison, and operator response to transient toasts is not perceptually qualified |
| P1 | HIGH | Profile max-feed wording and requested/effective Frame feed disclosure; delegated audit P1; `src/ui/laser/DeviceProfileFields.tsx:150-178`; `src/ui/laser/job-review/job-review-live-rows.ts:78-154`; `src/ui/laser/job-review/JobReviewMachineSection.tsx:24-31` | verified in this worktree | `pnpm exec vitest run src/ui/state/frame-feed-limits.test.ts src/ui/laser/job-review/job-review-live-rows.test.ts src/ui/laser/DeviceSettings.test.tsx src/ui/laser/use-frame-action.framed-run.test.ts` — 31/31 passed; focused ESLint, Prettier, and `git diff --check` passed | Live controller limits remain hardware observations; unknown X or Y is disclosed and the existing full-request fallback is unchanged |
| P2 | MEDIUM | Validate and recover persisted/imported `cncSubProfile`; delegated audit P2; `src/core/devices/cnc-sub-profile-validation.ts`; `src/io/machine-profile/machine-profile-io.ts:158-213`; `src/io/project/project-cnc-sub-profile-recovery.ts`; `src/core/preflight/cnc-machine-params.ts` | verified in this worktree | `pnpm exec vitest run src/core/devices/profile-catalog.test.ts src/io/machine-profile/machine-profile-io.test.ts src/io/project/project-device-profile-metadata.test.ts src/io/gcode/prepare-output.test.ts src/core/preflight/pre-emit.test.ts src/ui/app/save-preflight-policy.test.ts` — 71/71 passed; `pnpm typecheck`, focused ESLint, and Prettier passed | Recovery is disclosed and uses editable defaults; malformed in-memory params fail as structured compile integrity before output, but no CNC hardware qualification was performed |
| P3 | MEDIUM | Canonical runtime device bed plus mismatch/machine-change disclosure and reconciliation; delegated audit P3; `src/ui/state/project-bed-reconciliation.ts`; `src/ui/state/project-actions.ts:27-102`; `src/ui/app/ProjectBedReconciliationBanner.tsx` | verified in this worktree | `pnpm exec vitest run src/ui/state/project-bed-reconciliation.test.ts src/ui/app/ProjectBedReconciliationBanner.test.tsx src/ui/state/project-machine-capability.test.ts src/ui/app/file-actions-machine-capability.test.ts src/ui/app/file-actions.test.ts` — 30/30 passed; `pnpm typecheck`, focused ESLint, Prettier, and `git diff --check` passed | The canonical bed is device-profile width/height; opening a mismatch marks the project dirty and offers Use project machine / Keep current machine, but no physical bed measurement was performed |
| P4 | MEDIUM | Legacy/statusless scan-offset provenance and pending/verified actions; delegated audit P4; `src/ui/laser/MeasuredScanOffsetApply.tsx:133-188`; `src/ui/laser/MachineSetupRasterDiagnostics.tsx:179-207`; `src/ui/laser/job-review/job-review-live-rows.ts` | verified in this worktree | `pnpm exec vitest run src/ui/laser/MeasuredScanOffsetApply.test.tsx src/ui/laser/job-review/job-review-live-rows.test.ts src/ui/laser/device-setup/device-setup-option-status.test.ts src/core/devices/scan-offset-profile.test.ts src/io/project/project-scan-offset.test.ts src/io/machine-profile/machine-profile-io.test.ts` — 46/46 passed; `pnpm typecheck`, focused ESLint, and Prettier passed | Legacy tables remain active and are not rewritten; no physical coupon or burn calibration was performed |
| P5 | MEDIUM | Capability mismatch refusals and silent load rewrites become warnings; delegated audit P5; `src/ui/state/machine-actions.ts:119-133`; `src/ui/state/store-actions.ts:98-112`; `src/ui/state/project-machine-capability.ts`; `src/ui/machine/MachineModeToggle.tsx` | verified in this worktree | `pnpm exec vitest run src/ui/state/machine-actions.capability.test.ts src/ui/machine/MachineModeToggle.hybrid.test.tsx src/ui/state/project-machine-capability.test.ts src/ui/state/store-machine-capability.test.ts src/ui/app/file-actions-machine-capability.test.ts src/ui/laser/device-setup/DeviceSetupWizard.test.tsx src/ui/app/use-autosave.test.ts` — 36/36 passed; `pnpm typecheck`, focused ESLint, and Prettier passed | Capability labels are declarative warnings and do not prove installed hardware or controller-family compatibility |
| P6 | MEDIUM | CNC powered-Z assumption disclosure; delegated audit P6; `src/ui/laser/device-setup/DeviceSetupCncMachineStep.tsx`; `src/ui/laser/job-review/job-review-live-rows.ts` | verified in this worktree | Detached snapshot verification passed 30/30 focused tests. Current-main reconciliation passed `DeviceSetupWizard.test.tsx` 11/11 and `job-review-effective-operations.test.ts` 7/7, plus typecheck and full lint. | CNC mode assumes an installed powered Z; recorded travel remains informational and no powered-Z hardware proof was performed |
| M1 | HIGH | Requested/effective calibration-grid feed labels, previews, review, and emitted facts; delegated audit M1; `src/core/job/material-test-grid.ts`; `src/core/job/interval-test-grid.ts`; `src/core/job/vector-group-fields.ts`; `src/ui/laser/job-review/job-review-effective-operations.ts`; `src/core/output/grbl-strategy.ts` | verified in this worktree | `pnpm exec vitest run src/core/job/material-test-grid.test.ts src/core/job/interval-test-grid.test.ts src/ui/calibration/MaterialTestDialog.test.tsx src/ui/calibration/IntervalTestDialog.test.tsx src/ui/laser/job-review/job-review-effective-operations.test.ts src/core/output/grbl-strategy.test.ts` — 33/33 passed; `pnpm typecheck`, focused ESLint, and Prettier passed | Coupon geometry now burns effective feed values and retains requested provenance; no perceptual coupon inspection or physical burn/feed qualification was performed |
| M2 | HIGH | One effective-operation contract across override editor/review/preview/output; delegated audit M2; `src/core/scene/effective-operation.ts`; `src/core/job/compile-job.ts`; `src/core/job/compile-job-raster.ts`; `src/ui/layers/SelectedOperationInspector.tsx`; `src/ui/workspace/draw-raster-preview.ts`; `src/ui/laser/job-review/job-review-effective-operations.ts`; `src/core/output/grbl-strategy.ts` | verified in this worktree | `pnpm exec vitest run src/core/scene/effective-operation.test.ts src/core/job/compile-job-object-overrides.test.ts src/core/job/compile-job-raster.test.ts src/ui/workspace/draw-scene-object-overrides.test.ts src/ui/workspace/draw-raster-preview.test.ts src/ui/layers/SelectedObjectProperties.test.tsx src/ui/state/object-properties-actions.test.ts src/ui/laser/job-review/job-review-effective-operations.test.ts src/ui/laser/job-review/job-review-detail-facts.test.ts src/core/output/grbl-strategy.test.ts src/core/raster/emit-raster.test.ts` — 122/122 passed; `pnpm typecheck`, focused ESLint, and Prettier passed | Exact compiled override facts now cover fill style/interval/angle/direction/cross-hatch and image dither/resolution/direction/negative; no perceptual preview comparison or physical output qualification was performed |
| M3 | MEDIUM | Material/scan-offset qualification guards become warnings; delegated audit M3; `src/ui/layers/material-library-preset-options.ts`; `src/ui/layers/MaterialLibraryRecipeControls.tsx`; `src/ui/state/material-library-actions.ts`; `src/ui/calibration/ScanOffsetCalibrationDialog.tsx` | verified in this worktree | `pnpm exec vitest run src/ui/calibration/ScanOffsetCalibrationDialog.test.tsx src/ui/layers/material-library-preset-options.test.ts src/ui/layers/MaterialLibraryPanel.test.tsx src/ui/state/material-library-actions.test.ts` — 24/24 passed; `pnpm typecheck`, focused ESLint, and Prettier passed | Unsupported/mismatched recipe confidence and missing scan-offset qualification now remain prominent warnings while assignment/link/generation stay available; malformed coupon values still fail factual generation integrity; no physical calibration or burn was performed |
| M4 | HIGH | Revisioned linked preset identity, stale truth, and explicit refresh; delegated audit M4; `src/core/scene/layer.ts`; `src/io/project/project-layer-shape-validator.ts`; `src/ui/state/material-library-actions.ts`; `src/ui/layers/material-binding-status.ts`; `src/ui/layers/MaterialLibraryPanel.tsx`; `src/ui/laser/job-review/job-review-detail-facts.ts` | verified in this worktree | `pnpm exec vitest run src/io/project/project-material-binding.test.ts src/ui/state/material-library-actions.test.ts src/ui/state/material-binding-snapshot.test.ts src/ui/layers/MaterialLibraryPanel.test.tsx src/ui/layers/MaterialLibraryPanel.management.test.tsx src/ui/laser/job-review/job-review-detail-facts.test.ts` — 38/38 passed; `pnpm typecheck`, focused ESLint, and Prettier passed | New links persist library/preset identity plus preset revision; legacy revisionless links remain editable and are truthfully labelled untracked; stale settings are preserved until explicit refresh; external library interoperability beyond checked fixtures was not exercised |
| M5 | MEDIUM | Persist/apply all effective image recipe fields; delegated audit M5; `src/core/material-library/material-library.ts`; `src/ui/state/material-library-actions.ts`; `src/io/material-library/material-library-io.ts` | verified in this worktree | `pnpm exec vitest run src/core/material-library/material-library.test.ts src/io/material-library/material-library-io.test.ts src/ui/state/material-library-actions.test.ts src/ui/layers/MaterialLibraryPanel.test.tsx src/ui/layers/MaterialLibraryPanel.management.test.tsx` — 48/48 passed; `pnpm typecheck`, focused ESLint, and Prettier passed | Recipes now carry effective image direction, uncalibrated-bidirectional intent, and finite local scan-offset override; legacy omissions normalize explicitly and clear target-local overrides rather than silently inheriting them; no perceptual raster or hardware output was performed |
| M6 | MEDIUM | Registration Jig editor/inspector and Job Review coverage; delegated audit M6; `src/ui/workspace/RegistrationJigOperationSettings.tsx`; `src/ui/workspace/RegistrationJigPanel.tsx`; `src/ui/laser/job-review/JobReviewLayersTable.tsx` | verified in this worktree | `pnpm exec vitest run src/ui/workspace/RegistrationJigPanel.test.tsx src/ui/laser/job-review/JobReviewLayersTable.test.tsx src/ui/state/registration-output-actions.test.ts src/core/job/registration-placement.test.ts` — 31/31 passed; `pnpm typecheck`, focused ESLint, and Prettier passed | Jig outline power/speed/passes/air/advanced Line settings now edit the actual compiled operation; Job Review names the outline operation and count through the ordinary review/start path; no physical jig alignment or burn was performed |
| M7 | MEDIUM | Canonical sublayer IDs and sublayer-preserving scene actions; delegated audit M7; `src/core/scene/layer.ts`; `src/ui/state/duplicate-artwork.ts`; `src/ui/state/operation-actions.ts`; `src/ui/state/scene-clipboard-actions.ts`; `src/ui/state/vector-path-actions.ts`; `src/ui/laser/job-review/JobReviewLayersTable.tsx`; `src/ui/laser/job-review/job-review-live-rows.ts` | verified in this worktree | `pnpm exec vitest run src/core/scene/layer.test.ts src/ui/state/duplicate.test.ts src/ui/state/operation-actions.test.ts src/ui/state/scene-clipboard-actions.test.ts src/ui/state/layer-settings-clipboard.test.ts src/ui/laser/job-review/JobReviewLayersTable.test.tsx src/ui/laser/job-review/job-review-live-rows.test.ts src/io/project/project-sub-layers.test.ts` — 48/48 passed; `pnpm typecheck`, focused ESLint, and Prettier passed | Compiler materialization, Job Review, and live fact naming now share one parent+sublayer ID function; duplicate/add/make-unique/copy-paste/offset-derived operations deep-preserve sublayers and project IO round-trips them; compatibility beyond local fixtures remains unverified |
| M8 | MEDIUM | Mixed Power Scale displays `Mixed`; delegated audit M8; `src/ui/layers/SelectedObjectProperties.tsx` | verified in this worktree | `pnpm exec vitest run src/ui/layers/SelectedObjectProperties.test.tsx src/ui/layers/SelectedObjectProperties.power-scale-mixed.test.tsx src/ui/state/object-properties-actions.test.ts` — 25/25 passed; `pnpm typecheck`, focused source/new-test ESLint, and Prettier passed | A mixed multi-selection now displays the literal `Mixed` placeholder instead of a false 100%; typing a number applies it to the selection; UI-only, no hardware implications |
| M9 | MEDIUM | Material/scan-offset workflow and ADR/docs alignment; delegated audit M9; `PROJECT.md`; `WORKFLOW.md` F-ML2/F-ML3/F-ML4/F-SO1; `DECISIONS.md` ADR-044/045/052/093 | verified in this worktree | `pnpm exec prettier --check PROJECT.md WORKFLOW.md DECISIONS.md docs/remediation-ledger.md` passed; stale-current-claim search for planned material UI, deferred linked presets, and pending scan-offset workflow returned no current claims; `pnpm typecheck` passed | Docs now record warning-only qualification, revisioned explicit refresh, complete image recipe fields, and scan-offset generation/provenance without claiming physical calibration; hardware/perceptual qualification remains explicitly pending |
| T1 | P1 | Raster Preview from compiled rotated machine sampling grid; delegated audit T1; `src/ui/workspace/compiled-raster-preview.ts`; `src/ui/workspace/draw-raster-preview.ts`; `src/ui/workspace/RasterPreviewDisplayBanner.tsx` | verified in this worktree | `pnpm vitest run src/ui/workspace/compiled-raster-preview.test.ts src/ui/workspace/draw-raster-preview-compiled.test.ts src/ui/workspace/draw-raster-preview.test.ts src/ui/workspace/draw-raster-preview-cache.test.ts src/ui/workspace/draw-raster-preview-async.test.ts src/ui/workspace/draw-scene-preview-async.test.ts src/ui/workspace/preview-overlays.test.tsx` — 36/36 passed; `pnpm typecheck`, focused ESLint, and Prettier passed | Preview now consumes the exact compiled materialized or streamed S-grid and only then max-pools displays above 2048 px/edge with source/display disclosure; no perceptual/reference-CAM comparison or physical burn qualification was performed |
| T2 | P1 | Truthful and explicitly disclosed route Preview decimation; delegated audit T2; `src/ui/workspace/preview-display-decimation.ts`; `src/ui/workspace/draw-preview.ts`; `src/ui/workspace/RoutePreviewDisplayBanner.tsx`; `src/ui/app/gcode-2d-preview-pressure.ts` | narrowed by the 2026-08-31 current-main audit | `pnpm vitest run src/ui/workspace/preview-display-decimation.test.ts src/ui/workspace/draw-preview.test.ts src/ui/workspace/preview-overlays.test.tsx src/ui/app/gcode-2d-preview-pressure.test.ts src/ui/app/gcode-open-action.test.ts` — 33/33 passed; `pnpm typecheck`, focused ESLint, and Prettier passed | Disclosure and endpoints are retained, but stride sampling can connect distant retained vertices across hairpins/holes and therefore is not yet topology-preserving; no perceptual large-route topology inspection was performed |
| T3 | MEDIUM | Remove stale unsupported-raster-rotation warning; delegated audit T3; `src/core/preflight/preflight.ts`; `src/core/preflight/preflight-raster.test.ts`; `WORKFLOW.md`; ADR-028 in `DECISIONS.md` | narrowed here, then closed by current-main finding TL-O4 below | `pnpm vitest run src/core/preflight/preflight-raster.test.ts src/core/job/compile-job-raster-rotation.test.ts src/core/job/compile-job-raster-stream.test.ts` — 31/31 passed at this historical stage; TL-O4 adds the missing rectangular quarter-turn regression and implementation | Rotation support is real; no physical rotated burn or external reference-CAM comparison was performed |
| T4 | MEDIUM | Define keep-source-order precedence and incompatible controls; delegated audit T4; `src/ui/laser/OptimizationSettingsDialog.tsx`; `src/core/job/optimize-paths-source-order.test.ts`; `src/io/gcode/prepare-output-source-order.test.ts` | verified in this worktree | Source-order and T5 combined verification: `pnpm exec vitest run src/ui/laser/OptimizationSettingsDialog.test.tsx src/core/job/optimize-paths.test.ts src/core/job/optimize-paths-source-order.test.ts src/io/project/project-optimization.test.ts src/ui/state/project-optimization-actions.test.ts src/io/gcode/prepare-output.test.ts src/io/gcode/prepare-output-source-order.test.ts ...T5 focused files...` — 101/101 passed; `pnpm typecheck`, focused ESLint, Prettier, and `git diff --check` passed | Source order now bypasses inside-first, path-direction, and start-point settings without rewriting them; layer priority remains independent; no hardware motion or large-job perceptual comparison was performed |
| T5 | MEDIUM | Expose 4040-safe shared Line contour-entry value and exact effective review/output facts; delegated audit T5; `src/ui/layers/LayerRowFields.tsx`; `src/ui/layers/CutSettingsCommonFields.tsx`; `src/ui/laser/job-review/job-review-contour-entry-facts.ts`; `src/ui/laser/job-review/job-review-effective-operations.ts`; `src/core/output/grbl-strategy.ts` | verified in this worktree | `pnpm exec vitest run src/ui/layers/LineContourEntryFields.test.tsx src/ui/laser/job-review/job-review-detail-facts.test.ts src/ui/laser/job-review/job-review-effective-operations.test.ts src/ui/laser/job-review/job-review-output-quality.test.ts src/core/job/compile-job-contour-entry.test.ts src/core/job/toolpath-contour-entry.test.ts src/core/job/job-bounds-contour-entry.test.ts src/core/output/grbl-strategy-4040-contour-entry.test.ts` — 48/48 passed within the 101-test combined run; `pnpm typecheck`, focused ESLint, Prettier, and `git diff --check` passed | Line and Fill edit one stored shared value; 4040-safe compiled effective entry (including the 5 mm cap) is disclosed in Job Review and G-code metadata without a guard; generic profiles truthfully may not apply it; no physical contour-entry qualification was performed |
| I1 | P1 | One any-visible artwork resolver with deterministic first-visible styling across canvas, hit-test, node-hit, marquee, and Preview; delegated audit I1; `src/core/scene/visibility.ts`; `src/core/scene/hit-test.ts`; `src/ui/workspace/draw-scene.ts`; `src/ui/workspace/draw-preview.ts` | verified in this worktree | `pnpm exec vitest run src/core/scene/visibility.test.ts src/core/scene/hit-test-operation-visibility.test.ts src/ui/workspace/draw-scene-operation-visibility.test.ts src/ui/workspace/draw-preview.test.ts src/ui/workspace/path-node-hit-test.test.ts src/ui/workspace/selection-marquee.test.ts src/core/job/operation-binding-compile.test.ts` — 31/31 passed; `pnpm typecheck`, focused ESLint, Prettier, and `git diff --check` passed | First-hidden/second-visible geometry now draws and hits with the second operation's style; all-hidden geometry stays hidden; every bound operation still compiles; no perceptual browser/canvas inspection was performed |
| I2 | P1 | Transactional Save G-code with prebuilt exact artifact and fresh destination gesture; delegated audit I2; `src/ui/app/transactional-gcode-save.ts`; `src/ui/app/GcodeSaveDialog.tsx`; `src/ui/app/file-actions.ts`; `src/platform/web/web-adapter.ts` | verified in this worktree | `pnpm exec vitest run src/ui/app/GcodeSaveDialog.test.tsx src/ui/app/file-actions-transactional-save.test.ts src/ui/app/file-actions.test.ts src/ui/app/prepare-gcode-save.test.ts src/ui/app/file-actions.save-preflight.test.ts src/ui/app/file-actions.save-placement.test.ts src/platform/web/web-adapter.test.ts src/ui/app/shortcuts.test.ts src/ui/commands/use-app-commands.test.tsx` — 61/61 passed; browser and Electron renderer contracts both prove no picker on failed prepare and write only from an identity-bound prebuilt artifact; web adapter proves `createWritable` remains lazy until write; full Playwright 63/63 includes successful prepared-save activation and failed-prepare no-write recovery; `pnpm typecheck`, focused ESLint, Prettier, and `git diff --check` passed | Ordinary export prepares before any final target exists, then uses a second explicit destination click to preserve transient activation; packaged native smoke exercised project save rather than the OS G-code destination picker, so installer/permission behavior remains unqualified |
| I3 | MEDIUM | Ordered mixed-format drop dispatcher with one success-only stagger index; delegated audit I3; `src/ui/app/import-dispatch.ts:29-64`; `src/ui/app/use-import-drag-drop.ts` | verified in this worktree | `pnpm exec vitest run src/ui/app/import-dispatch.test.ts src/ui/app/use-import-drag-drop.test.tsx src/ui/app/svg-import-action.test.ts src/ui/app/dxf-import-action.test.ts src/ui/app/stl-import-action.test.ts` — 24/24 passed; mixed SVG/bad PNG/DXF/JPG/STL order, per-file isolation, and success-only indices are asserted; `pnpm typecheck` passed | Original `FileList` order and global staggering are source/test verified; no OS drag/drop gesture smoke or very-large mixed batch was performed |
| I4 | MEDIUM | Selected-only output scope/count in Job Review with selection-triggered rebuild; delegated audit I4; `src/ui/laser/job-review/job-review-model.ts:147-160`; `src/ui/laser/job-review/job-review-gate.ts:115`; `src/ui/laser/job-review/use-job-review-rebuild.ts:20-22` | verified in this worktree | I4/I5 focused rerun — `pnpm exec vitest run src/ui/laser/job-review/job-review-model.test.ts src/ui/laser/job-review/use-job-review-rebuild.test.tsx ...I5 files...` — 74/74 passed; `pnpm typecheck` passed | Job Review states Entire job or Selected artwork only plus exact selected count and rebuilds on scope/selection changes; no perceptual dialog interaction was performed |
| I5 | MEDIUM | Fresh same-name imports append; explicit selected source-aware undoable re-import; delegated audit I5; `src/ui/state/object-insert-actions.ts:63`; `src/ui/app/reimport-selected-artwork.ts`; `src/ui/layers/SelectedSourceReimportControl.tsx:11-25` | verified in this worktree | Included in the 74/74 I4/I5 focused run: store/library insertion identity, explicit selected re-import, Selected Object UI, undo, and same-name collision regressions passed; `pnpm typecheck` passed | Explicit re-import is limited to a selected imported SVG/DXF source and replaces that object undoably; external file handles do not provide a durable cross-session filesystem identity |
| I6 | MEDIUM | Independent validated X/Y DPI, axis-specific sizing, and fallback disclosure; delegated audit I6; `src/ui/common/image-density.ts:25-41,203-206`; `src/ui/common/image-import.ts:44-60` | verified in this worktree | `pnpm exec vitest run src/ui/common/image-density.test.ts src/ui/common/image-import.test.ts src/ui/commands/import-image-action.test.ts src/ui/import/png-incremental-decoder.test.ts src/ui/import/qualified-png-raster.test.ts` — 40/40 passed; anisotropic PNG pHYs, JFIF, and EXIF fixtures passed; `pnpm typecheck` passed | Invalid/missing metadata falls back per axis to the disclosed 254 DPI default; no external camera/scanner corpus or physical ruler measurement was used |
| I7 | MEDIUM | Project-owned placement/output scope with schema migration and prepared-byte round trip; delegated audit I7; `src/core/scene/project.ts:51-69,85-93`; `src/ui/state/project-job-setup.ts:15-29`; `src/ui/state/store.ts:402-426` | verified in this worktree | I7/I8 combined verification — `pnpm exec vitest run` across project migration/persistence/store and unified import entry points — 141/141 passed; `src/ui/state/project-job-setup-roundtrip.test.ts` proves prepared G-code is byte-identical before versus after save/reopen and v3 migrates to an explicit full-job setup; `pnpm typecheck` passed after correcting two test-fixture return annotations | v3 files deliberately migrate to full-job scope with placement derived from homing; no corpus-wide external project migration or hardware-origin validation was performed |
| I8 | MEDIUM | Unified SVG/DXF/PNG/JPG/STL Import picker/dispatcher across toolbar, command, drop, and Ctrl+I with secondary format actions retained; delegated audit I8; `src/ui/app/import-dispatch.ts:80-108`; `src/ui/commands/command-families.ts:40-54`; `src/ui/common/Toolbar.tsx:153`; `src/ui/app/shortcuts.ts:140-146`; `src/ui/commands/workspace-context-commands.ts:19` | verified in this worktree | The same 141/141 I7/I8 run covers unified picker extensions, mixed-format drop, toolbar icon, command invocation, Ctrl+I, active-job availability, CNC command visibility, and the retained SVG/DXF/image secondary commands; `pnpm typecheck` exited 0 | Picker/renderer contracts are automated; packaged native picker and real OS drag/drop remain for V1/manual smoke, and STL retains the existing CNC-only factual format rule |
| V1 | MEDIUM | Nonblocking packaged native smoke with isolated userData; delegated audit V1; `electron/native-smoke.ts`; `scripts/verify-windows-packaged-native-smoke.mjs`; `.github/workflows/packaged-native-smoke.yml` | verified in this worktree | Windows unpacked `release/0.1.0/win-unpacked/KerfDesk.exe` launched with isolated `userData` and `sessionData`, reached `app://app/index.html` ready-to-show, imported SVG, saved a 4,439-byte v4 project, recorded no renderer/load failures, shut down idle, and exited 0; focused native-smoke tests passed 6/6 within the V1/V3/V4 integrity set | This is unpacked-app evidence, not installer/OS-picker permission, GPU-perceptual, serial, controller, or hardware qualification; captured Chromium stderr contained two nonfatal GPU shutdown diagnostics |
| V2 | MEDIUM | Stable Vite/Playwright cold start including `opentype.js`; delegated audit V2; `vite.config.ts`; `playwright.config.ts`; `scripts/run-playwright-cold-start.mjs`; `e2e/cold-start-variable-text.spec.ts` | verified in this worktree | `pnpm test:e2e:cold` removed `node_modules/.vite`, forced a fresh Vite optimizer start, then passed 1/1 variable-text/outline-font smoke in 23.5 s with no dependency-optimization 504, 5xx response, or outdated-optimization reload; the corrected full browser suite passed 63/63 in 5.0 min; `pnpm typecheck:e2e` and Electron/web builds passed | The cold-cache and full-browser runs are local runtime evidence, not repeatability proof across other machines or a deployment gate |
| V3 | MEDIUM | SHA-correlated, separated release-readiness report; delegated audit V3; `scripts/report-release-readiness.mjs`; CI/browser/deploy/packaged workflows | verified in this worktree | Local artifact for SHA `9209fcb33f4807ebfc1f7a55780069b6a7b0e23c` records independent lanes with `blocking:false` and `browserGatesDeploy:false`: browser passed (63/63 plus cold 1/1), packaged-runtime passed, hosted CI/deploy/perceptual-reference-CAM/hardware not run; release-report/coverage/native integrity tests passed | Hosted CI was not run; the local `release:check` lifecycle wrapper was twice host-terminated with exit `-1`, while its exact constituent checks passed independently; no provider state was queried |
| V4 | MEDIUM | Scheduled report-only coverage artifacts and checked-in baseline; delegated audit V4; `scripts/run-vitest-coverage.mjs`; `scripts/report-coverage-trend.mjs`; `scripts/coverage-baseline.json`; `.github/workflows/coverage-report.yml` | verified in this worktree | `pnpm test:coverage` passed 1,556/1,556 files and 9,687/9,687 tests; baseline totals are lines/statements 152,756/171,894 (88.86%), branches 42,248/49,621 (85.14%), functions 10,883/12,042 (90.37%); `pnpm report:coverage` emitted zero-delta JSON/Markdown and states no threshold; focused report/runner tests passed | Coverage is scheduled/manual and report-only; instrumentation excludes listed perceptual/performance, heavyweight camera/raster/CNC, and Windows-WSL shell test files while ordinary `pnpm test` covers them; coverage is not hardware or product-behavior proof |
| V5 | MEDIUM | README/CLAUDE/PROJECT drift corrections; delegated audit V5; `README.md`; `CLAUDE.md`; `PROJECT.md` | verified in this worktree | Docs now separate analytic/raster G-code perceptual evidence from screen/subcell/material/reference-CAM qualification, omit dependency audit from `release:check`, and describe checked-in Desktop Preview workflows without claiming publication; focused and repo-wide Prettier checks passed | Documentation cannot supply perceptual, deployment/provider, native installer, or hardware evidence |

## Current-main integration reconciliation (2026-08-26)

- The completed second-pass task `LaserForge Audit and PR Sweep` was inspected and is terminal.
  Its release-readiness findings overlap V1-V5 and are represented by the packaged native smoke,
  cold-start, SHA-correlated reporting, report-only coverage, and documentation work already listed
  above. No additional second-pass software defect remained outside this inventory at the integration
  boundary.
- The inherited dirty snapshot and remediated snapshot were materialized with temporary Git indexes,
  without creating a commit or ref. The inherited tree is
  `fde966c2d53899b9317becb522ab0960d7c41c3f`; the remediated tree is
  `0e9b200e2e71f72003148dd72a77c0482f378fc4`. Applying that exact tree-to-tree delta excludes
  unrelated inherited edits while retaining the audited feature state.
- The delta was reconciled onto current main
  `a6a4ba4885507fbac8320417708b9fcc6a0748b2`. Current main's newer CNC setup, relief, V-carve,
  tiled-save, import-worker, and project-migration architecture was retained; the removed legacy
  `CncSetupPanel` was not resurrected.
- Current-main focused behavior verification passed after correcting only stale integration
  assertions: the 22-file safety/profile/import/preview matrix had 21 files green and three stale
  Save assertions in one file; the corrected Save transaction/background group passed 25/25. The
  current-main structural group passed seven files and 69/69 tests, then the corrected unified Import
  inventory passed 33/33. `pnpm typecheck` and full `pnpm lint` both exited 0.
- Repo-wide formatting found two conflict-resolution test files, both mechanically formatted. The
  ordinary full suite, second coverage run, cold and full browser runs, builds, and packaged Windows
  native smoke now pass on the current-main integration tree. Hosted CI, review, merge, and deployment
  state remain pending until the authorized remote integration begins.

## Current-main integration verification (2026-08-26)

| Gate | Terminal evidence |
|---|---|
| Ordinary Vitest suite | `pnpm exec vitest run --reporter=dot` — 1,760 passed files + 14 skipped (1,774 total); 11,070 passed tests + 22 skipped (11,092 total); exit 0 in 1,771.30 s |
| Report-only coverage | Second `pnpm test:coverage` — 1,727/1,727 files and 10,902/10,902 tests passed; lines/statements 171,745/192,320 (89.30%), branches 47,938/56,193 (85.30%), functions 12,353/13,630 (90.63%). The checked-in baseline remains lines/statements 88.86%, branches 85.14%, functions 90.37%, so this run is +0.44, +0.16, and +0.26 percentage points respectively. Reporting remains nonblocking. |
| Coverage harness triage | V8 instrumentation exceeded the ordinary-test budgets for the adaptive-pocket 360-edge case and V-carve floor-depth reference case, and the latter caused a Vitest worker-RPC timeout after its assertion completed. The adaptive test received an instrumentation-aware 60 s budget and passed under V8; the 127 s V-carve reference test remains owned by the ordinary suite and is narrowly excluded from coverage instrumentation, while other included tests cover its source. Focused coverage tests passed 13/13 and the coverage-runner contract tests passed 2/2. |
| Browser integration | Second `pnpm test:e2e` — 78/78 passed in 9.8 min after E2E helpers were updated for the transactional browser Save flow's prepared-artifact destination step. The 200 MiB PNG case measured 8,056,028 bytes of main-frame heap growth and 723 heartbeat ticks. |
| Cold browser startup | `pnpm test:e2e:cold` — 1/1 passed in 21.3 s after a clean Vite dependency cache, with variable outline text and no dependency-optimization 504 or reload. |
| Type and lint | `pnpm typecheck:e2e`, `pnpm lint:electron`, and `pnpm build:electron-main` exited 0 after the final E2E-helper edits. Earlier current-main `pnpm typecheck` and full `pnpm lint` also exited 0; the authoritative wrapper below will rerun the repository-required source gates. |
| Format and policy | Targeted Prettier and `git diff --check` pass after the final test changes. Repo-wide formatting and policy checks will be rerun by the authoritative wrapper below. |
| Release integrity | `pnpm test:release-integrity` — 28/28 passed. |
| Builds | `pnpm build:web` and `pnpm build:electron-main` exited 0; the web build retained its nonfatal 1,275.95 kB `ui-workbench` chunk advisory. |
| Authoritative wrapper | Final `pnpm release:check` exited 0 on this current-main integration tree. It reran typecheck, full source and Electron lint, repo-wide Prettier, ADR numbering, production-license policy, the ordinary Vitest suite, 28/28 release-integrity tests, web and Electron-main builds, raw and report-only soft file-size scans, and the legacy public-export no-growth ratchet. |
| SHA-correlated readiness | `pnpm report:release-readiness` emitted a nonblocking report for source commit `b4c272654b18fc167762a46bc491a626c880bba1`: browser and packaged-runtime passed; hosted CI, deploy, perceptual/reference-CAM, and hardware remained not run. `browserGatesDeploy` is false. |
| Native runtime | `pnpm exec electron-builder --win --x64 --dir --config electron-builder.preview.yml --publish never` succeeded with electron-builder 26.15.3 and Electron 42.3.0. `node scripts/verify-windows-packaged-native-smoke.mjs <win-unpacked\\KerfDesk.exe> --output=artifacts/native-smoke-current-main --timeout-ms=60000` exited 0 with `NATIVE_SMOKE_OK=true`: packaged and isolated user/session data, ready-to-show, import, 4,439-byte save, app URL, and clean idle shutdown all passed. Two nonfatal GPU shutdown diagnostics remained. |
| Explicitly not verified | Hosted CI/checks and reviews have not run; no PR is open and nothing is merged or deployed. Installer/OS-picker permissions, reproducibility across independent build hosts, human perceptual review, reference-CAM parity, serial hardware, laser/spindle/motion, air-cut, and burn qualification remain unverified. |

## Detached implementation snapshot verification

| Gate | Terminal evidence |
|---|---|
| Ordinary Vitest suite | 1,588 passed files + 16 skipped (1,604 total); 9,854 passed tests + 24 skipped (9,878 total); 864.73 s |
| Report-only coverage | 1,556/1,556 files and 9,687/9,687 tests passed; lines/statements 152,756/171,894 (88.86%), branches 42,248/49,621 (85.14%), functions 10,883/12,042 (90.37%); zero-delta trend artifact |
| Browser integration | `pnpm test:e2e` — 63/63 passed in 5.0 min; 200 MiB PNG case measured 18,526,540 bytes of main-frame heap growth and 596 heartbeat ticks in that full run |
| Cold browser startup | `pnpm test:e2e:cold` — 1/1 passed after clean Vite dependency cache, with no optimization 504/reload |
| Type and lint | `pnpm exec tsc --noEmit`, `pnpm typecheck:e2e`, full `pnpm lint`, `pnpm lint:electron`, and focused final E2E/source ESLint all exited 0 |
| Format and policy | Repo-wide `pnpm format:check`, ADR-number check, license check, raw file-size policy, report-only soft-size scan, and final public-export no-growth ratchet exited 0 |
| Release integrity | `pnpm test:release-integrity` — 22/22 passed |
| Builds | `pnpm build:web` and `pnpm build:electron-main` exited 0; the web build retained its nonfatal 1,124.43 kB `ui-workbench` chunk advisory |
| Authoritative wrapper | `pnpm release:check` was attempted twice and was externally terminated with exit `-1` during ESLint/Prettier without a diagnostic; every constituent command was then run to a terminal result independently, with the results above |
| Native runtime | Unpacked Windows smoke exited 0 with isolated profile, ready/import/save/idle-shutdown evidence; two nonfatal GPU shutdown stderr diagnostics remained |
| Explicitly not verified | Hosted CI, deployment/provider state, installer/OS-picker permissions, human perceptual review, reference-CAM parity, serial hardware, laser/spindle/motion, air-cut, and burn qualification |

## Completion fingerprint

- Isolated implementation worktree: detached
  `9209fcb33f4807ebfc1f7a55780069b6a7b0e23c`; 242 modified tracked files, zero staged
  files, and 70 untracked files after remediation; tracked diff hash
  `8677458b1d0e335e8872473d1e5e16295ad1a624`; staged diff hash
  `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`.
- Original checkout: branch `claude/vcarve-stamp-subcell` at the same audited HEAD; still exactly
  nine modified tracked files, zero staged files, and four untracked files; tracked diff hash
  `6a1fc1cb119a370814a5eb65c66f78c4038f41a5`; staged diff hash
  `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`.
- The original checkout's four untracked SHA-256 values still exactly match the recorded inherited
  snapshot: `FDE16BEA...E83C` (audit ledger), `7BD2BD52...C3BE` (program parse reason),
  `CF6C7C71...3CC0` (V-carve note test), and `6F5ABFEC...C8F8` (V-carve note source).
- The original checkout therefore retained the audited dirty feature state unchanged. The isolated
  implementation snapshot contains those same inherited files plus the remediation delta. The
  current-main integration was committed only in the separate integration worktree; nothing was
  staged, committed, or written in the original checkout, and nothing was pushed, merged, or
  deployed at this evidence point.

## Integration rules

- Preserve the inherited dirty snapshot and record our delta separately.
- Keep one implementation owner and this single ledger.
- Write a failing regression before each bug fix where the behavior is directly testable.
- Keep Frame as the sole ordinary Start guard; warnings inform and never refuse.
- Run focused tests per slice and the authoritative local release gate before completion when
  practical.
- Never report automated source evidence as perceptual, native-OS, controller, or hardware proof.

## Third-pass confirmed remediation inventory (2026-08-26)

These entries were independently reconciled against merge commit
`78ea8c86309c2d7c1ff2b54d900bdddcf2d71261`. Findings that refine earlier M2/M7/M8 work retain
separate IDs so their narrower acceptance evidence is not hidden. Status and verification evidence
will be updated in place as each slice lands. None of these items changes the Frame-only contract.

| ID | Severity | Exact source evidence anchor | Implementation status | Verification evidence | Remaining hardware / perceptual / native limit |
|---|---|---|---|---|---|
| TP-SC1 | P1 | `.github/workflows/{ci,audit,coverage-report,deploy,e2e,packaged-native-smoke,release-desktop-dry-run}.yml` contained mutable third-party action tags while Preview/Stable already demonstrated reviewed full-SHA pins | implemented: every third-party action is pinned to an allowlisted reviewed full SHA and a repository verifier rejects mutable, unknown, or changed pins | `pnpm check:action-pins` green (7 actions); release-integrity Node set green (4/4) | Secret rotation, least-scope review, and provider policy changes require separate authority |
| TP-SC2 | P2 | `.github/workflows/audit.yml` exited when an issue already existed and did not refresh/close it or separate runtime reachability; `package.json` `audit:deps` was one undifferentiated audit | implemented: each run refreshes/closes the issue, publishes evidence, distinguishes product runtime, packaged Electron, release-build-only, and build/test-only findings; Electron updated to exact `42.5.1` | live `pnpm audit --prod` green (0 advisories); classifier/action tests green; live full audit retains report-only nonruntime findings | Scanner results do not prove exploitability; release-build/test findings remain tracked maintenance rather than product-runtime defects |
| TP-SC3 | P2 | `.github/workflows/release-desktop-stable.yml` validated a tag/ancestor but not an approved exact SHA and published `latest.yml` without staged feed rollback or checksum/SBOM/provenance verification | implemented: exact approved SHA, versioned staging, signed-installer verification, checksums/SPDX/provenance generation and remote comparison, rollback copy, and final atomic feed switch | workflow Prettier check and release-evidence/action contract tests green | Stable lane remains inactive; signing-provider credentials and policy are external and no stable release was executed |
| TP-SC4 | P3 | `electron/main.ts` `logSerialPorts` and selection diagnostics emitted port identifiers, names, VID/PID in packaged runtime logs | implemented: packaged logs expose only counts/reason codes; detailed identifiers require an explicit development-only opt-in | `electron/serial-port-diagnostics.test.ts` green (2/2) within focused 248/248 matrix | Real OS serial enumeration remains unqualified; user-visible picker identity is intentionally retained |
| TP-SC5 | P3 | desktop workflows recorded artifact identity but no normalized cross-build comparison or exact build-toolchain provenance report | implemented: deterministic checksums/SPDX plus normalized provenance records exact source and toolchain and documents normalized nondeterminism | `scripts/generate-release-evidence.test.mjs` green within Node 4/4; `docs/release/reproducible-builds.md` documents comparison | No independent hosted-Windows two-build equality claim; documented timestamps/signatures remain normalized nondeterminism |
| TP-G1 | P1 | `src/core/job/compilation-polylines.ts` and `src/core/cnc/collect-cnc-contours.ts` flattened at `0.025` in local coordinates before object scale while `src/ui/workspace/draw-scene.ts` already adjusted for transformed scale | implemented: shared flattening tolerance is derived in transformed physical space for laser/CNC, including nonuniform/negative scale and rotation | geometry/compile focused matrix green, including `curve-path.test.ts`; all third-pass product tests 248/248 | Automated geometry does not qualify physical motion or material kerf |
| TP-G2 | P1 | `src/core/geometry/kerf-offset.ts` classified containment from `path[0]`, making results dependent on cyclic start, winding, and input order | implemented: normalized cyclic topology and containment-tree classification replace seed-point decisions | `kerf-offset-topology.test.ts` green for cyclic start, winding, order, overlap/touch/nesting/bow-tie within 248/248 | Reference-CAM and physical kerf qualification remain separate |
| TP-G3 | P1 | `src/core/job/fill-rule.ts` promoted an entire layer to nonzero if any text existed; `src/core/job/layer-fill.ts` pooled unrelated objects before fill-rule resolution | implemented: fill rule resolves per object, then resolved geometry is pooled without text changing unrelated vector topology | `compile-job-fill.test.ts` green, including text-plus-vector-donut fixtures, within 248/248 | Screen/material perceptual fill quality is not source-test evidence |
| TP-G4 | P2 | `src/core/geometry/tabs-bridges.ts` Skip-inner used one subject point, accepting partial overlap/touch and varying with cyclic start | implemented: automatic Skip-inner requires strict full containment and is cyclic-start invariant | `tabs-bridges.test.ts` green (12/12) within 248/248 | Physical tab holding strength remains unqualified |
| TP-MS1 | P1 | `src/core/controllers/grbl/status-parser.ts` parsed components with `Number`, so blank components fabricated zero; Smoothie comma status delegated to the same parser | implemented: canonical finite decimal components reject blank/noncanonical fields independently while preserving valid zero and siblings | `status-parser.test.ts` green (34/34) within 248/248 | No controller serial session was operated |
| TP-MS2 | P1 | raw status/WCO/feed values reached `laser-jog-actions.ts`, `OriginRow.tsx`, `StatusDisplay.tsx`, `JogPad.tsx`, and board capture while only selected newer paths used `$13` normalization | implemented: one canonical reported-units-to-mm selector now feeds jog, origin, DRO, board capture, JogPad, and zone comparisons | `infer-machine-position.test.ts` plus consumer/fence tests green within 248/248; metric/imperial equivalence covered | Firmware `$13` behavior is source/fixture tested only, not hardware-qualified |
| TP-MS3 | P1 | G-code coordinate formatting could enter exponential notation for finite large values; Ruida signed-35-bit encoding could wrap out-of-range values before a typed failure | implemented: materialization validates fixed-decimal and Ruida signed-35-bit encodability and returns typed compile-integrity failure before bytes | `emit-gcode.test.ts` (12/12) and `ruida.test.ts` (17/17) green, including exact boundaries/manifests, within 248/248 | Controller acceptance of boundary programs is not hardware-qualified |
| TP-MS4 | P2 | manual jog/frame/origin paths trusted cached Idle without the same-session post-query fence already used by Start | implemented: manual motion writes require a same-session post-query fresh Idle; silence and reset/reconnect epochs are nonreusable | `manual-motion-fresh-idle.test.ts` green (5/5) within 248/248 | No real-controller timing, reset, or motion test is claimed |
| TP-PA1 | P1 | `src/io/project/project-scene-integrity-validator.ts` rejected otherwise-finite geometry after 250,000 points solely by content size | implemented: content-size-only geometry caps removed while structural, finite-number, and amplification integrity checks remain | dense manual save/autosave/reopen tests green in `project-scene-curve-budget` and `prepare-project-autosave` within 248/248 | Very-large-project interactive performance remains machine-dependent |
| TP-PA2 | P2 | duplicate and clipboard payloads omitted dependency closure/groups; deletion could leave `imageMaskId` dangling | implemented: duplicate/copy/paste clone and remap masks/groups; delete repairs dangling references and emits nonblocking diagnostics | `scene-dependency-closure.test.ts` green (4/4) within 248/248 | Perceptual mask rendering remains separately unqualified |
| TP-PA3 | P2 | undo stacks retained `Project` only while machine/setup actions also changed placement, cached CNC setup, selection/probe identity, and output derivation | implemented: setup history captures and atomically restores the associated context only for setup entries | `machine-setup-history.test.ts` green with emitted-output signature roundtrip within 248/248 | No machine movement or probing was performed |
| TP-PA4 | P3 | interaction cancellation restored `pendingUndo` project but not the prior dirty/history/selection state | implemented: cancellation restores project, undo/redo, dirty, and selection snapshots exactly | cancellation assertions in `store.test.ts` green (37/37 file total) within 248/248 | Pointer/device-specific behavior remains browser/native smoke territory |
| TP-PA5 | P3 | generic/document/PNG/paged worker clients retired or rejected all pending requests on worker error instead of rejecting only active work and restarting FIFO | implemented: crash rejects only the active request, retires/restarts the worker, preserves FIFO, and ignores stale-worker events; PNG assets are cleaned | all four worker-client and paged-lifecycle suites green within 248/248 | Browser-engine crash recovery beyond controlled worker errors remains unqualified |
| TP-HF1 | HIGH | Job Review rebuild keys omitted live same-session `$30/$32` evidence identity, so verified text/acknowledgement could survive a setting change | implemented: Job Review subscribes to controller session/settings/observation changes and rebuilds/announces immediately without disabling Start | `JobReviewDialog.test.tsx` green (14/14 file total) within 248/248 | No live controller setting read was performed; Start remains available after Frame |
| TP-HF2 | HIGH | merged M2 exposed effective trace values but later operation edits could be masked by stored rasterized-trace object overrides without a direct override editor/source map | implemented and deduplicated with M2: operation edits update effective overrides; Job Review names artwork and maps requested base operation to effective artwork override | effective-operation and inspector tests green within 248/248 | Raster appearance and material output remain perceptual/hardware limits |
| TP-HF3 | MEDIUM | merged M7 canonicalized IDs, but parent:child compiled sublayer lookup/review mapping lacked an exact named-artwork matrix for fill/raster/runway/corrections and disabled omission | implemented and deduplicated with M7: canonical compiled IDs resolve parent:child rows, named artwork reports exact effective settings, disabled sub-ops are absent | `JobReviewLayersTable.test.tsx` (11/11) and effective-operation tests green within 248/248 | Job Review visual hierarchy still needs browser/perceptual confirmation |
| TP-HF4 | MEDIUM | merged M8 rendered mixed power but lacked the complete accessible indeterminate/no-op-preservation/apply-to-all acceptance contract | implemented and deduplicated with M8: mixed state exposes accessible `Mixed`, blur/no-op preserves values, explicit edit applies to all | mixed-power suite green (2/2) within 248/248 | Screen-reader behavior outside automated DOM assertions remains unqualified |
| TP-HF5 | MEDIUM | Job Review focus trap did not wrap Shift+Tab from its initial focus target while forward Tab/Escape/restore paths existed | implemented: initial-surface Shift+Tab moves to last control and Tab moves to first while Escape/restore behavior remains | `use-dialog-a11y.test.tsx` green (3/3) within 248/248 | Platform assistive-technology integration remains native/browser manual evidence |
| TP-HF6 | LOW | numeric editing surfaces used inconsistent `Number`/`parseFloat` handling and could silently normalize invalid locale text | narrowed here, then closed by current-main finding TL-U2 below: `NumericEditsBar` received the same explicit draft-validity contract without turning HTML `step` into a refusal | Historical `english-decimal-input.test.ts` passed 7/7 and the mounted probe reproduced blank X `20 -> 0`; TL-U2 records the final focused repair evidence | Locale-aware number entry is not claimed |

## Third-pass integration verification (2026-08-26)

| Gate | Terminal evidence |
|---|---|
| Focused third-pass regressions | All 24 confirmed third-pass items passed their focused acceptance matrix (248/248). After removing unintended new barrel exports, the affected direct-import regression set passed 7 files and 58/58 tests. |
| Ordinary Vitest suite | `pnpm exec vitest run --reporter=dot` — 1,767 passed files + 14 skipped (1,781 total); 11,111 passed tests + 22 skipped (11,133 total); exit 0. A second clean run reached the same totals. |
| Type, lint, and format | `pnpm typecheck`, full `pnpm lint`, `pnpm lint:electron`, and `pnpm format:check` exited 0. `git diff --check` is clean. |
| Release integrity and policy | `pnpm test:release-integrity` passed 33/33 after regenerating the dependency notices; ADR numbering, full-SHA GitHub Action allowlisting, and production-license policy passed. |
| Builds and repository ratchets | `pnpm build:web` and `pnpm build:electron-main` exited 0. Raw file-size policy and the public-export no-growth ratchet passed (`scene` 208, `job` 85); the report-only soft-size scan reported 187 files over 250 lines. The web build retained only its existing nonblocking large-chunk advisory. |
| Authoritative wrapper | The final local `pnpm release:check` attempt completed all tests, release-integrity checks, and builds, then found unintended barrel-export growth (`scene` 209 vs 208; `job` 88 vs 85). That integration-only issue was corrected with direct imports. The affected tests, typecheck, lint, format, both builds, file-size checks, and the export ratchet then all passed independently. An exact post-fix wrapper rerun is deferred to hosted PR CI rather than claiming the earlier terminal result was green. |
| Packaged native runtime | `electron-builder --win --x64 --dir --config electron-builder.preview.yml --publish never` succeeded with Electron 42.5.1. `pnpm smoke:desktop:native -- <win-unpacked\\KerfDesk.exe>` exited 0 with `NATIVE_SMOKE_OK=true`: packaged/isolated user and session data, ready-to-show, import, 4,439-byte save, `app://app/index.html`, and clean idle shutdown all passed with no recorded load or console failures. |
| Explicitly not verified | No hardware, serial device, motion, air-cut, laser/spindle firing, calibration, material burn, independent reference-CAM, or human perceptual qualification was performed. Installer/OS-picker permissions and independent-host reproducibility remain unverified. The stable lane remains inactive. Credential rotation and provider least-scope changes were outside authorization. The native smoke covers launch/import/save/idle only. |

## Final open-PR reconciliation (2026-08-28)

This reconciliation ends at current `origin/main` `653e2a7963a6b67459fa8ecb9355661049afed66`.
The earlier 37-item remediation and all 24 independently confirmed third-pass findings are already
in main through merge commits `78ea8c86309c2d7c1ff2b54d900bdddcf2d71261` (PR #699) and
`5705421a22c4de02dc1cf74feff259907df254dd` (PR #700). The former `ab91` donor worktree is no
longer present; retained donor trees are read-only evidence and are not integration authority.
Point Rotation reconciliation is in main through merge commit
`73d7fa69c3f9fe6fd1cf517cd17eb805cf1c6e8a` (PR #701). Its exact head
`4f06f2ecb0adb9da78f1b8c6b48da21fbb2314ca` passed repository CI and the 78-test browser smoke;
the Cloudflare preview deployment failed separately and was not treated as repository verification.
The combined relief replacement passed the full local `pnpm release:check`: typecheck, repository
and Electron lint, formatting, ADR/action/license policy, all 1,789 Vitest files, 33/33 release-integrity
tests, web and Electron builds, raw and soft file-size checks, and the public-export no-growth ratchet
(`scene` 207). Replacement PR #702 merged as
`653e2a7963a6b67459fa8ecb9355661049afed66`; its exact head
`b624fbc6f1a646601077a5b578662d4c81d0ad45` passed repository CI in 27m16s and the 78-test browser
smoke in 9m15s. Hosted Vitest reported 1,775 files passed, 14 skipped, 11,145 tests passed, and 22
skipped. The separate Cloudflare preview deployment failed and no manual deployment was performed.
Stale PRs #651, #670, #686, #687, #689, and #690 were closed only after their legitimate unique
intent reached main. The final open-PR count is zero.

| PR | Current-main classification | Reconciliation status | Evidence boundary |
|---|---|---|---|
| #651 Point Rotation arrays | source-confirmed unique behavior, but stale branch retains a forbidden 500-placement policy cap and unrelated stacked history | reconstructed without the cap under ADR-307, merged through replacement PR #701, then closed as superseded; exact-head repository CI and 78-test browser smoke are green; deterministic rosette IoU/precision/recall is 1.0000 | no human perceptual review; no hardware relevance |
| #670 Relief gamma mapping | source-confirmed unique UI behavior was present in earlier ancestry but is absent from the pre-reconciliation main | reconstructed under ADR-308 with an uncapped positive-finite control, exact mapping-only revision updates, keyed cancellation, and focused 57/57 tests; merged through replacement PR #702, then closed as superseded | browser interaction and relief-render appearance remain unverified |
| #686 Non-finite legacy relief materialization | source-confirmed Float32 overflow defect, but the proposed new refusal widens compile-integrity policy without current-chat permission | replaced under ADR-309 by finite-preserving Float32/Float64 selection, exact ASCII/project persistence, and pre-raster extreme-Z normalization; focused adjacent 73/73 tests and finite G-code emission are green; merged through PR #702, then closed as superseded | normal Float32 behavior is retained; reference-CAM, packaged import, and material output remain unverified |
| #687 Relief Width intent/schema v5 plus Cut 3D cleanup | the schema-v5 Width intent is a policy/product proposal already recorded as a planned representation gap, not a current-main defect; the head commit's bare-`queueMicrotask` receiver bug is source-confirmed unique behavior | schema-v5 work remains planned and is not merged; the Cut 3D cleanup wrapper merged through PR #702 under ADR-288 Amendment 2 after installed-Chrome reproduction and focused tests; stale draft closed as superseded | browser reproduction establishes the thrown scheduling call, not packaged Electron/WebGL cleanup or GPU appearance |
| #689 Mixed integration branch | duplicate/superseded history plus #651 intent | legitimate Point Rotation intent merged through replacement PR #701; mixed branch closed as superseded | no unique branch history was merged |
| #690 Mixed relief integration branch | duplicate/superseded history plus #670/#686/#687 intent | legitimate relief intent merged through replacement PR #702; mixed branch closed as superseded | no unique branch history was merged |

## Advanced CNC audit remediation (2026-08-29)

The completed advanced-toolpath audit was rechecked against current main before edits. All five
delegated findings remain source-confirmed and unique. This local branch adds no Start refusal,
confirmation, or policy gate: Frame remains the sole ordinary physical Start permit, and clamp/
no-go findings remain Job Review advisories through the existing preflight partition.

| ID | Current-main reproduction | Remediation status | Focused evidence | Remaining qualification limit |
|---|---|---|---|---|
| ACNC-1 shallow surfacing | Positive totals below 0.05 mm were floored to 0.05 mm before emission | implemented: validated positive depth-per-pass and total-depth values are preserved exactly; final pass is the requested total | 0.001, 0.010, 0.049, 0.050, and 0.051 mm regressions pass | No spindle, cutter, spoilboard, or surface-finish test |
| ACNC-2 physical stock placement | Prepared physical bounds were unplaced before the stock advisory; 2D/3D removal stock stayed fixed while the route was artwork-relative | implemented: prepared warnings use physical output bounds; preview/pane stock is mapped into the same placement-relative scene frame as the route | X150–170 outside-stock warning, worker placement carrier, 2D grid, and 3D pane placement regressions pass | No browser perceptual review or physical stock/fixture alignment |
| ACNC-3 global release order | Tool-major bucketing could emit an A profile before remaining B clearing | implemented: clearing is globally phase-first, followed by profiles; tools are contiguous inside each phase and may recur | A-clear, B-clear, A-profile, B-profile regression passes | Repeated tool changes are intentional and have no controller/operator qualification |
| ACNC-4 helix parity | Preview sampled one circle while emitted G-code produced every descending revolution | implemented: one shared XYZ expansion drives preview, removal, and tiled derivatives | 1/2/23-turn, clockwise/counter-clockwise seam-depth tests and a two-turn removal-depth test pass | No reference-CAM, WebGL perceptual, air-cut, or material-cut comparison |
| ACNC-5 cutter envelope warnings | No-go collision scanning checked only cutter centerlines | implemented: generated tool comments switch the active radius per section; advisory rectangles expand by that radius and disclose holder/stickout/fixture-height/Z unknowns | 2 mm clear vs 6 mm overlap, multi-tool switching, and CNC warning-copy regressions pass | Holder geometry, stickout, fixture height, Z clearance, and hardware remain unknown |

Local verification: the primary focused matrix passed 110/110 tests; the removal/pane/warning matrix
passed 42/42; and the preview-carrier structural-parity matrix passed 29/29. A clean
`pnpm release:check` exited 0: typecheck, full source/Electron lint, format, ADR numbering, action
pinning, license closure, 1,775 Vitest files with 11,162 passing tests (14 files/22 tests skipped),
release-integrity tests, production web build, Electron TypeScript build, file-size policy, and the
public-export ratchet all passed. Browser interaction, packaged runtime, hosted CI, review, merge,
deployment, hardware, reference-CAM, and human perceptual evidence remain separate and are not
claimed here.

## Independent Ultra-audit remediation (2026-08-30)

The post-PR-704 audit re-fingerprinted exact current main and deduplicated the earlier 37-item,
third-pass, relief, Point Rotation, and advanced-CNC inventories before product changes. The entries
below are the surviving source-confirmed defects and bounded test/release gaps. They do not change
compiled laser/CNC geometry or add an ordinary guard. Frame remains the sole ordinary Start guard;
MPG ownership, live controller state, and fresh status are factual transport preconditions, while
status traffic and schedule-bounded recovery/fail-off traffic remain available.

| ID | Severity | Current-main reproduction / source evidence | Remediation status | Focused software evidence | Remaining qualification limit |
|---|---|---|---|---|---|
| UA-M1 external MPG ownership at command entry | P1 machine motion/beam; P2 settings/air | Latched `MPG:1` already fenced Start and Jog/Frame, but Home, Probe, Autofocus, Origin/manual motion, motion/modal Console/macros, Settings, Work-Z recovery, realtime overrides, Air-on, and Fire-on could still begin app-owned traffic | implemented: every listed entry boundary rejects known MPG ownership. Status remains available. Exact recovery/fail-off traffic may bypass the app-operation fence during a known takeover only after host refill is paused; normal active streaming retains its operation block | table-driven zero-write/recovery matrix plus active-takeover and ordinary-active-job schedules | No controller, pendant, accessory, spindle, laser, motion, or hardware operation |
| UA-M2 Home controller state | P1 | Home attempted `$H` while cached state was Run and also lacked a known-state precondition; a later numbered `ALARM:N` recorded an alarm code but left the stale Run report authoritative | implemented: Home requires known Idle or explicit Alarm evidence; Run/Hold/Jog/unknown write nothing. `ALARM:N` clears stale status while retaining the alarm code as exact Home recovery evidence; Home-from-Alarm remains available | Home state/recovery and prior-Run-then-numbered-Alarm regressions | No firmware-family or physical homing qualification |
| UA-M3 Console freshness | P1 | motion/modal Console dispatch trusted cached Idle without a same-session post-query observation | implemented: non-recovery commands that require Idle use the existing fresh-status fence before dispatch and recheck ownership afterward | fresh Idle vs fresh Run and command-matrix regressions | No serial timing, external sender, or controller execution evidence |
| UA-M4 MPG continuation, latch, and active-stream ownership | P1 | An action could pass its entry check and then continue after an awaited reply delivered `MPG:1`; connection qualification, Probe, multi-line Origin, Settings, and Work-Z each had such continuations. An active stream could also step/refill on later acknowledgements, while Resume, tool-change Continue, and realtime overrides lacked the same competing-owner fence. Alarm, Sleep, and numbered Alarm paths cleared the latch without `MPG:0` or a new session | narrowed by the 2026-08-31 current-main audit: command and stream ownership fences remain, but a `$$` collector could still publish settings and retain `qualified` after the line stream reported `MPG:1`; that residual publication owner is remediated in the current branch | handshake, takeover-at-boundary, no-continuation, active-stream freeze/refill, Resume/Continue, Work-Z query, sparse/explicit Alarm/Sleep, numbered-Alarm regressions, plus an independent `$$`-then-MPG reproduction | Software cannot prove controller-side arbitration, pendant release timing, already-buffered motion, or physical recovery behavior |
| UA-M5 ambiguous accessory activation and fail-off ownership | P1 Fire; P2 Air | Fire cleared its on latch when the `M3` transport promise rejected, and Air set its latch only after `M7`/`M8` resolved; transport rejection therefore hid an outcome that could already be active. A too-broad fail-off exemption could also bypass the normal active-job operation owner without an MPG takeover | implemented: Fire and Air latch potentially-on before activation dispatch and retain that state after an ambiguous rejection. MPG takeover after a pending Air-on write attempts `M9` and clears the latch only when that write is accepted. Exact Console/dedicated fail-off bypass is limited to a known takeover with host refill paused; ordinary active streaming stays blocked | ambiguous activation rejection, takeover cleanup success/failure, exact fail-off, and normal-active-job exclusion regressions | A software latch cannot prove whether the controller accepted the first or compensating write or whether beam/air actually changed |
| UA-D1 Image Studio document/request ownership | P1 | stashed sessions and asynchronous Apply were keyed only by persisted object ID, so a replacement document with the same ID could resume or receive old pixels; one global Apply flag also let an unresolved request for image A keep image B busy, and old-document stashes retained image buffers | implemented: open/stash/decode/Apply bind document epoch plus exact source-object identity. Apply has an exact request/session owner, so B can proceed after A closes and late A success/failure cannot publish, clear, or toast over B. Open/close purge other-document stash resources while preserving same-document reopen | same-ID and different-ID replacement, same-document resume, unresolved A versus B Apply, stale success/error, and stash-purge regressions | No human image-quality/perceptual, large-image memory profiling, or packaged-runtime qualification |
| UA-D2 Convert/Crop ownership | P1 | late Convert-to-Bitmap and Crop completions published by ID into the current project; deterministic delayed callbacks replaced same-ID artwork from another document | implemented: both operations capture document epoch and exact source identity; Crop also binds exact mask identity; stale success and failure silently no-op without a misleading toast | cross-document, source-only replacement, mask-only replacement, valid same-document success, and stale-error regressions | No large-image performance or human perceptual qualification |
| UA-E1 packaged-window visibility | P2 | the production `ready-to-show` listener was attached after awaited renderer load; native smoke observed readiness but not actual visibility | implemented: listener is installed before renderer loading and native smoke requires `windowVisible:true` | ordering-policy test, validator tests, Electron-main build | No installed package, real OS picker, GPU, or visible-window run in this remediation |
| UA-E2 native-smoke terminal ownership | P2 | the timeout set a finished flag, but a renderer promise already continuing after `ready-to-show` could still attempt a second result write/exit after the timeout finalized the run | implemented: timeout, renderer success, and renderer failure compete for one atomic terminal claim; every late path becomes a no-op | deferred-renderer timeout-versus-late-success terminal-claim regression | A unit race does not establish packaged process timing or real OS launch behavior |
| UA-R1 current-tip Pages deployment | P1 | successful rerun of historical main CI run 31500435119 (`18fab79a...`) triggered production Pages run 32620299883 after main had advanced | implemented: candidate SHA must equal current main, gate code comes from the workflow revision on protected main rather than the candidate checkout, freshness is rechecked immediately before publish, and all production candidates use a serialized queue so stale reruns cannot cancel an eligible publication; stale runs are intentional provider-free no-ops | resolver unit tests and workflow structural tests, including pre-fix candidate ancestry and stale-rerun concurrency isolation | Automatic post-merge GitHub/Cloudflare execution remains separate; no manual deployment |
| UA-R2 exact release readiness | P2 | deploy reports defaulted to event `GITHUB_SHA`, and all hosted lane reports omitted their available run evidence | implemented: reports default to checked-out HEAD, deploy checkout/report/artifact share one SHA, and CI/browser/deploy/native lanes record run/result evidence | readiness CLI and workflow regressions | Reports remain informational and do not qualify hardware/perceptual lanes |
| UA-R3 stable asset closure | P2 | checksums included build-only files while published sets omitted named assets; actual Electron output includes `builder-debug.yml`; immutable staging omitted `latest.yml`; root publication verified the installer but did not read back and hash the root blockmap | implemented: evidence requires an explicit exe/blockmap/latest allowlist, ignores build inputs/diagnostics, fails closed on missing declared assets, stages/downloads `latest.yml`, verifies the full manifest, and reads back/hash-compares both root installer and root blockmap before mutable metadata moves | generator fixtures include `runtime-dependencies.json` and `builder-debug.yml`; stable ordering, closure, and remote-readback structure tests | Stable lane remains inactive; signing, protected environment, R2 credentials, provider execution, installer, and updater are unqualified |
| UA-R4 browser/release coverage | P2 test gap | browser smoke served only Vite development output; desktop package jobs installed a browser they never used | implemented: the independent Browser workflow adds a real `dist/web` build-and-preview smoke; package jobs remove unused browser provisioning; discovery keeps production smoke out of the default suite | production-bundle Playwright test, discovery/typecheck, workflow policy tests | One narrow production smoke is not perceptual review or full built-bundle E2E coverage |
| UA-R5 coverage provenance | P3 | coverage Markdown dropped the checked-in baseline's explicit dirty-remediation scope | implemented: report JSON/Markdown preserves `baselineScope` | coverage-report unit regression | The historical mixed-state baseline remains non-reproducible from a commit alone |

PR #705's exact-head review then exposed two additional UA-M4 schedules. A completed streamer could
be cleared at Idle and immediately overwritten back to paused when that same report first carried
`MPG:1`; and Probe could accept its final fresh-Idle proof after MPG takeover because the last check
validated only transaction identity. Both deterministic regressions failed before their source fixes.
They now pass in `laser-status-line.test.ts` and `laser-probe-actions.test.ts`: terminal Idle release
wins without suppressing the MPG latch, and Probe rechecks factual wire ownership immediately before
publishing Work-Z evidence. The 27-test focused set and 67 adjacent MPG/Frame/post-job/session tests
passed under independent read-only review; no Start or warning policy changed.

Source anchors for the table above:

- **UA-M1 through UA-M5:** `src/ui/state/laser-store-helpers.ts`,
  `console-command-readiness.ts`, `laser-controller-handshake.ts`, `laser-probe-actions.ts`,
  `laser-origin-transaction.ts`, `grbl-settings-actions.ts`, `work-z-recovery-actions.ts`,
  `laser-job-pause-resume.ts`, `laser-pause-resume-refill.ts`, `laser-status-line.ts`, and
  `laser-stream-ack.ts`, plus the numbered-Alarm handler in `laser-line-handler.ts`,
  `laser-fire-actions.ts`, and the Air actions in `laser-store.ts`; the table-driven entry matrix is
  `src/ui/state/laser-store-mpg-command-matrix.test.ts`, with continuation schedules in the
  adjacent handshake, Probe, Origin, Settings, active-WCS, Work-Z, Fire, and Air tests.
- **UA-D1 and UA-D2:** `src/ui/image-editor/image-editor-ownership.ts`,
  `image-editor-lifecycle.ts`, `image-editor-store.ts`,
  `src/ui/commands/bitmap-conversion.ts`, and `image-command-actions.ts`; the request-liveness,
  stash-release, same-ID/source, and exact-mask schedules are in the adjacent ownership/lifecycle
  tests.
- **UA-E1 and UA-E2:** `electron/main.ts`, `electron/native-smoke.ts`,
  `electron/native-smoke-terminal-claim.ts`, `electron/window-readiness-policy.test.ts`,
  `electron/native-smoke-terminal-claim.test.ts`, and
  `scripts/verify-windows-packaged-native-smoke{,.test}.mjs`.
- **UA-R1 through UA-R5:** `.github/workflows/{deploy,e2e,ci,packaged-native-smoke,
  release-desktop-dry-run,release-desktop-preview,release-desktop-stable}.yml`,
  `scripts/resolve-web-deploy-identity.mjs`, `report-release-readiness.mjs`,
  `generate-release-evidence.mjs`, `report-coverage-trend.mjs`,
  `check-playwright-discovery.mjs`, `playwright-production.config.ts`, and
  `e2e/production-bundle.spec.ts`, with unit/structural contracts beside each script and under
  `src/platform/{web,electron}/`.

### Audit classifications retained without product changes

- **Already covered / duplicate:** all five ACNC findings remain closed; the cutter bed-bound concern
  was refuted because bed bounds describe tool-center travel while cutter expansion belongs to
  warning-only no-go/fixture analysis. No additional compile, preview, placement, or emission defect
  survived reconciliation.
- **Policy-only:** browser trigger documentation drift is corrected with ADR-311; no runtime change.
- **Review-refuted / tooling drift:** current GitHub Actions documentation explicitly supports
  `concurrency.queue: max`; the older actionlint bundled with the review did not. The production
  Playwright scenario also retains `.spec.ts`, matching the configured E2E convention and existing
  browser suite rather than unit-test sibling naming.
- **Review hygiene:** public-ledger paths were redacted, Electron window readiness was extracted to a
  source-matching module/test, the production Playwright config and module constants were renamed to
  repository conventions, ownership tests were placed beside their tested source, and the Fire latch
  contract/JSDoc/test scheduler were corrected without changing product policy.
- **External qualification:** the stable desktop lane remains deliberately inactive and requires a
  repository `STABLE_APPROVED_RELEASE_SHA` variable plus the protected environment/secrets before
  any authorized stable tag.
- **Not claimed:** no serial/device call, hardware motion, spindle/beam/accessory operation, air-cut,
  material cut, reference-CAM comparison, human perceptual review, installer/OS-picker test, stable
  release, or manual deployment was performed.

### Integration verification state

Recorded local verification milestones are revision-bounded:

- the terminal post-review machine/Frame matrix: 24 files and 247 tests passed in 45.22 s, with
  typecheck and diff checks green; Frame/Start contracts were included and remained unchanged;
- initial focused document/Electron regressions: 6 files and 36 tests passed;
- the later Image Studio Apply/stash ownership slice: 6 files and 38 tests passed, with scoped
  ESLint, Prettier, typecheck, and diff checks green;
- exact-head review reconciliation: 11 directly affected files and 76 tests passed, including the
  two before/after machine-race regressions; 27 focused plus 67 adjacent machine ownership tests
  independently passed, and scoped ESLint/Prettier/diff checks were green;
- release-integrity contracts: 41 of 41 Node tests passed;
- an earlier `pnpm release:check`: typecheck, lint, Electron lint, format, ADR numbering, action pinning,
  license closure (52 production packages across 8 licenses), 1,778 Vitest files and 11,202 tests,
  two 2,360-module production builds, Electron-main build, file-size/export ratchets, and all remaining
  release checks passed; 14 perceptual-probe files containing 22 tests remained explicitly skipped;
- at that same milestone, E2E typecheck passed; Playwright independently discovered 34 development suites and one production
  suite; the production `dist/web` bundle smoke passed 1 of 1 in Chromium; and
- `git diff --check` passed.

The review-remediated source tree then passed an exact-final `pnpm release:check`: typecheck, full
source and Electron lint, repo-wide Prettier, ADR numbering, seven pinned-action checks, license
closure for 52 production packages across eight licenses, the full 1,796-file Vitest schedule with
no failures, 41 of 41 release-integrity tests, the 2,360-module production web build, Electron-main
build, both file-size policies, and the public-export no-growth ratchet all exited zero. This terminal
evidence note is the only post-gate documentation mutation and is covered by the scoped Prettier and
diff checks recorded with the integration commit. Hosted exact-head CI, hosted browser evidence,
mergeability, review threads, automatic post-merge Pages publication, and final main ancestry remain
separate states until their own terminal evidence is recorded.

## Chief Code / Grok multi-pack reconciliation (2026-08-31)

This pass re-audited the submitted `.lf2`, transport, tool-change, override, undo, clipboard,
scan-offset, homing, box, Electron, relief, and shorthand follow-up packs against current main
`cbaecbbeb5e6f67f17bb757bc2ceb5471934fb0e`, not their older `97f93b9` baseline. Evidence is source
read plus deterministic software tests. No serial/controller, spindle, laser, camera, installer,
GPU, reference-CAM, LightBurn physical-equivalence, material, or hardware run is claimed. Frame
remains the sole ordinary Start guard; new output concerns below are either compile integrity,
handoff consistency, or Job Review disclosures.

### Source-confirmed defects remediated

| Finding IDs | Disposition and bounded remediation |
|---|---|
| Original eight: `KD-CTRL-01`, `KD-MAIN-V5`, `KD-CNC-04`, `KD-GEO-01/02/03/04/07` | already integrated by PR 706 on the audited base, including its CNC/document corrections |
| `KD-UND-01`, `KD-UND-04` | every Job Review Confirm synchronously re-prepares; changed bytes/evidence require review of the rebuilt model, and Undo during an active transform restores that transform's pending snapshot instead of popping older history |
| `KD-CLP-01/02/03/05/06/07/08/10` | Duplicate no longer manufactures sibling operations, preserves overrides, deep-clones nested state, and remaps mask/path-text dependencies; same-project Paste reuses existing operations, cross-project Paste keeps one mapped operation set, CNC tab-color anchors follow remapped operations, and unmapped artwork receives an explicit operation |
| `KD-EL-01/02/04/07` | Electron is single-instance, restores/focuses the primary window, has idempotent `ready-to-show` plus load-finish fallback and failure visibility, and resolves the packaged workflow path from `package.json` version |
| `KD-SO-01/02/03` | Job Review discloses missing/out-of-table scan calibration coverage and the emitter now resolves scan offsets from the rounded feed actually written for both raster and scanline fill |
| `KD-HOME-03/04` | failed Home and unlock invalidate coordinate evidence and suppress status-driven position/WCO reconstruction until explicit Home or origin re-establishment succeeds; dedicated and console unlock paths now share that invalidation contract |
| `KD-BOX-01/02/03/04/06/08/09` | CNC boxes default to profile-outside, laser zero-kerf boxes warn in Job Review, Generate runs the assembly referees, slide-lid notch geometry is bounded by lid length, dimensional fields name millimetres, and CNC dogbones default on |
| `KD-REL-01/02/03/04/05/06/09/10/12` | Job Review names the unproven continuous finishing interpolant and mixed depth semantics; CNC motion bounds include cutter radius; full-design origin includes relief; stock-bottom relief without tabs warns; 3D lateral descents use Z-capped feed; finish allowance and climb/conventional rough contours are honored; stored stepover wording now matches unclamped compilation |
| `KD-LF2-05` | an unknown saved `machine.kind` is rejected as an invalid project instead of silently becoming a laser project |
| `KD-M0-07` | structured tool-plan counting and streamer holds share one stop parser for `M0/M00/M1/M01`, including comment-suffixed lines; the parser now removes semicolon comments before the queued newline |
| `KD-GIO-01` | imported G-code remains an inspector/simulator input, but an always-visible banner and Start-time Job Review warning explicitly state that Frame/Start run the current design, not the previewed file |

Duplicate remains intentionally in-place, matching the documented command behavior; the change removes
unintended process duplication but cannot make overlapping artwork non-overlapping. The selected clone
is ready to move. `KD-CLP-04` therefore remains a feature-parity request for a separate Paste-in-Place
command rather than an output defect in this remediation.

### Findings closed by current behavior or classified as non-defects

- `KD-LF2-01/02/04`: `.lf2` is a project, not a live controller snapshot. Current Frame and Job Review
  bind/display the active origin, Work Z, controller, and exact compiled program; choosing the current
  machine is explicit. `KD-LF2-03/06/07/08` describe intentionally session-only/unapplied editor,
  camera, and history state. `KD-LF2-09` is stale because current serialization includes `jobSetup`
  and groups. `KD-LF2-10` is deterministic legacy migration, not current-schema data loss.
- `KD-RX-01/02` are factual controller transport limits and stay compile/transport preconditions.
  `KD-RX-03` is valid per-run emission, not one concatenated scanline. `KD-RX-04` is already disclosed
  by FluidNC Job Review warnings. `KD-RX-05/06` are profile-versus-firmware evidence disagreements,
  not authority to write beyond the configured channel; no firmware capability was invented.
- `KD-M0-01/02/03/04/05/06/08` describe the intentional supervised tool-change ownership model:
  no automatic continuation, fresh Idle, exact tool-bound Work Z when available, and MPG ownership.
- `KD-OVR-01..14` were checked against the current effective-operation inspector, Job Review effective
  rows, and compilation contracts. Layer and object-local settings are now separately disclosed;
  CNC intentionally ignores laser overrides, while image overscan remains a layer setting.
- `KD-UND-02/03/05..12` are stale against persisted `jobSetup`, atomic machine transitions, and current
  interaction history, or describe intentional session/UI history. `KD-CLP-09/11..14` are intentional
  group validity, clipboard-scope, calibration, identity, and in-memory clipboard contracts.
- `KD-SO-04` is correctly advisory under the Frame-only rule. `KD-SO-05` is an offset-contour fill,
  not bidirectional scan motion. `KD-SO-06/08` need a reference file or primary LightBurn semantics
  before an equivalence claim can be made; `KD-SO-07/09` match current profile policy and fail-closed
  numeric materialization.
- `KD-HOME-01/02` are factual transport/handoff behavior. `KD-HOME-05` accurately separates dedicated
  recovery Home from console commands. `KD-HOME-06` remains hardware-unqualified.
- `KD-BOX-05` is a preview-surface limitation, `KD-BOX-07` is covered by the production referee, and
  `KD-BOX-10` describes fail-closed validation and variants outside the current generator model.
- `KD-EL-03/05/06` describe qualification scope or deliberate packaged/smoke routing, not product
  defects. `KD-REL-07/08/11/13/14` are current fail-closed materialization, mixed-mode routing, preview,
  or input-unit contracts; no unsafe coercion was added.
- `KD-RC-01..06` do not justify automatic replay after connection loss. The current checkpoint is
  evidence for supervised requalification, not proof of physical completion or a resumable live
  controller queue.

### Shorthand-only follow-ups

The submitted shorthand rows did not include fixtures or line-level reproductions. Current source was
nevertheless checked for their named contracts: tabs have containment/full-coverage and through-stock
warnings; default/small/angled cutter feeds and controller RPM limits reach Job Review; rotary and
print-and-cut carry setup/registration evidence; fill rules are per object and artwork order persists;
imports retain current supported semantics; and recovery copy explicitly denies true-resume proof.
Therefore `TAB-01/02`, `FEED-01..03`, `ROT-01..03`, `PNC-01/02/05`, `FILL-01/02`, `$32-01..04`,
`IMP-01..05`, `TXT-01/02`, `ARR-01/02`, `RC-02..06`, `LASER-01`, and `LB-01/02` do not receive an
unproven geometry or policy mutation here. `GIO-01` was independently reproducible and is the one
shorthand finding remediated above. A concrete counterexample can reopen any retained classification;
hardware and LightBurn equivalence remain explicitly unqualified.

## Ten-loop current-main reconciliation and yesterday-change audit (2026-08-31)

This audit started from clean branch `codex/audit-yesterday-20260831` at exact
`origin/main` `ffdd60d1f893bed4b4356062d06785b747c0f34f`. It independently reconciled the
unfinished ten-loop evidence, the 55-item UI/performance/compatibility inventory, and every merged
change from PRs #704 through #708. The original dirty checkout and the detached donor were read-only.
Frame remains the sole ordinary Start guard. Nothing in this section authorizes a new refusal,
confirmation, cap, clamp, hidden action, or second warning surface.

### Yesterday's integrated changes

- PRs #704, #705, #706, #707, and #708 and their merge commits are all ancestors of exact current
  main. The five advanced-CNC corrections, MPG/document ownership work, packaged-window evidence,
  release-publication freshness, Chief Code/Grok remediations, and CNC box submission remain present.
- Current-main release evidence is terminal green: CI run `33361799111`, Browser run `33361799131`,
  and automatic Pages run `33363629336` all succeeded for `ffdd60d1`. The published deployment
  `https://b8421a56.laserforge-2fj.pages.dev` and `https://kerfdesk.com/` both served the same
  SHA-bearing `index-mQQxk8lH.js` asset when checked. Open PR inventory was zero.
- The independent audit narrowed three earlier closure claims: TP-HF6 omitted `NumericEditsBar`, T2's
  stride decimator did not prove topology preservation, and T3 used only square quarter-turn fixtures.
  UA-M4 also omitted `$$` publication ownership after MPG takeover. The rows above now say so.

### Source-confirmed ownership, compatibility, output, and transport findings

| ID | Severity | Exact current-main result | Current disposition |
|---|---|---|---|
| TL-D1 generic import owner | P1 | delayed SVG/DXF/raster/STL work publishes into whichever project exists at completion; the `project` accessor was not read | implemented in this branch: document-epoch ownership makes stale mutation and feedback a silent no-op; document/Open focused schedule 9 files, 74 tests |
| TL-D2 concurrent Open/document owner | P1 | older Open completion can replace a newer selected project or a New document and publish stale feedback | implemented in this branch: Zustand owns a session-only request epoch while each Open binds that request plus the initiating document epoch across picker, read, parse, replacement, and feedback; the winning Open adopts only its committed document epoch, so its success remains visible while later picker/read/error and deferred autosave-cleanup feedback is suppressed after New or a newer Open; repair matrix 11 files/94 tests plus final ownership matrix 3 files/11 tests |
| TL-D3 ASCII/binary STL integrity | P1 | ASCII grouping ignores facet boundaries and accepts numeric prefixes; binary input accepts non-finite coordinates | source-confirmed, policy-blocked: stricter import refusal requires explicit prior maintainer permission |
| TL-D4 DXF numeric integrity | P1 | numeric prefixes such as `1junk` become geometry and malformed `$INSUNITS` can alter scale | source-confirmed, policy-blocked: stricter import refusal requires explicit prior maintainer permission |
| TL-D5 SVG primitive units | P1 | child primitive lengths use `parseFloat`; `1in` becomes 1 mm instead of 25.4 mm | implemented in this branch: absolute `in/cm/mm/q/pt/pc/px` geometry lengths resolve in the SVG 96-DPI user space before the existing root transform; malformed-unit fallback and guard policy are unchanged; 37 SVG tests passed |
| TL-D6 LightBurn vertex identity | P1 | an invalid middle vertex is compacted away and numeric segment indices reconnect other vertices without a warning | source-confirmed, policy-blocked: rejecting or dropping malformed geometry requires explicit prior permission |
| TL-D7 external G-code token consumption | P2 | the inspector's 50%-consumed heuristic accepts a motion token such as `X10junk`; this path is preview-only and cannot Start the imported file | implemented in this branch: comment-free preview/glossary parsing requires complete word consumption, classifies the malformed line as junk, preserves leading optional-block-delete and line/checksum framing, and adds no import/Start refusal; preview/PNG schedule 7 files, 58 tests; adversarial repair matrix 11 files/94 tests |
| TL-D8 qualified PNG route mismatch | P2 | a valid compressed 20,000-by-1 PNG is refused by the embedded route even though the incremental decoder handles it | implemented in this branch: the existing incremental worker samples an oversized-edge compressed PNG, folds bounded luma into the portable embedded representation, and removes temporary pages; preview/PNG schedule 7 files, 58 tests |
| TL-O1 grbl-compatible laser mode | P1 | the profile described as supporting firmware without M4 still emits M4 for Fill/Raster | implemented in this branch: GRBL-compatible Cut/Fill/Raster all use supported constant-power M3 semantics; no output gate; machine/output schedule 16 files, 195 tests |
| TL-O2 high raster power storage | P1 | `Uint16Array` wraps configured S values above 65,535; `70000` became `4464` | implemented in this branch: compiled/materialized/streamed power buffers use `Float64Array`, never cap or clamp, and preserve values above 65,535; machine/output schedule 16 files, 195 tests |
| TL-O3 selected mask dependency | P1 | selected-only output removes an unselected mask before the raster compiler resolves it, changing `[0,300,300,0]` to `[300,300,300,300]` | implemented in this branch: selected rasters retain masks as compile-only dependencies without emitting those masks as independent artwork; machine/output schedule 16 files, 195 tests |
| TL-O4 rectangular quarter-turn raster | P1 | a 2-by-3 pass-through grid at 90 degrees remains 2-by-3 over 3-by-2 compiled bounds | implemented in this branch: exact 90/270-degree pass-through rotations swap the source pixel grid; machine/output schedule 16 files, 195 tests |
| TL-O5 CNC precision collapse | P1 | a contour whose XY path collapses at three-decimal emission precision can still plunge and emit no XY cut; the initial no-plunge repair then silently omitted that requested pass while Preview retained it, and later iterations stopped after preserving only one segment or mistook distinct p3 text for parsed motion | implemented in this branch: contours stay byte-identical at three decimals only when every nonzero consecutive segment survives staged GRBL parsing; otherwise rounded-then-shortened candidates continue until exact IEEE-754 parser-prefix stabilization and select the narrowest representation preserving every representable segment; if that is impossible, emission and Preview retain the candidate preserving the most segments and Job Review warns about residual loss; any changed coordinate text conservatively repositions before plunge, while in-cut dedup follows parser values; focused precision matrix includes partial-segment, signed-zero, float32-boundary, p9 carry, p18 next-value, and mixed-pass regressions |
| TL-O6 tool-change Continue ownership | P1 | Continue can overlap a setup jog because `motionOperation` is omitted from the factual competing-owner check | source-confirmed, policy-blocked: widening this refusal requires explicit prior maintainer permission |
| TL-O7 stale write containment | P1 | Start/Continue/refill rejection handlers can mark a replacement stream errored because containment is not bound to the originating epoch | implemented in this branch: controller-session plus streamer epochs contain only the exact originating Start/Continue/resume/refill write owner; machine/output schedule 16 files, 195 tests |
| TL-O8 Console settings owner | P1 | a `$$` collector can publish `$30=900` and retain qualification after the same session reports `MPG:1`; clearing all cached settings then makes inch status look like millimetres | implemented in this branch: explicit MPG takeover clears collection, observation, detected settings, live caps, and qualification before late rows publish, while retaining the last completed snapshot only as best-known status-unit interpretation; machine/output schedule 16 files/195 tests plus adversarial repair matrix 11 files/94 tests |
| TL-O9 no-go boundary warning | P2 | a configured zone wholly outside the bed is filtered before cutter-radius expansion, so an expanded cutter envelope entering the bed can miss the warning | implemented in this branch: bed intersection is evaluated on the cutter-expanded fixture envelope and remains a Job Review warning only; warning/poll focused 22/22 and related 115/115 passed |
| TL-O10 status poll overlap | P2 | background `?` polling has no single-flight owner and can queue overlapping writes under a slow channel | implemented in this branch: one unresolved background status write owns the poll loop and later ticks coalesce until settlement; no action guard was added; warning/poll focused 22/22 and related 115/115 passed |
| TL-O11 emitter provenance | P1 | output-shaping changes in this remediation retained the ADR-294 `EMITTER_REVISION`, so exported headers mislabeled new laser/raster/CNC bytes | implemented in this branch: export provenance advances to `adr-313-audit-output-parity-v1`; metadata regression updated |

### Late independent side-audit reconciliation

After the first frozen release gate, independent exact-head reviews challenged the integrated branch
rather than accepting its green suite as closure. The following unique findings survived source
reconciliation; all are implemented in the same branch without adding a guard or changing Frame/Start
authorization.

| ID | Severity | Confirmed result | Current disposition |
|---|---|---|---|
| TL-L1 adjacent document owners | P1 | direct SVG/DXF/image commands, Edit Image, Height Map, Design Library insertion, and selected-source re-import could finish against a replacement document; Edit Image and Text could also inherit a same-id replacement session; a deferred Library load could mutate or close after Close/Escape or close a same-document reopened dialog | implemented: every route captures the initiating document epoch and, where applicable, exact object/session identity; Library also owns the exact open dialog/request across Close, Escape, unmount, StrictMode replay, and reopen; Text owns the exact render request; stale mutation, dialog publication, close, success, and failure feedback no-op |
| TL-L2 exact export metadata | P2 | static dialect defaults could report M4 when a layer override emitted M3, while independently normalized controller/dialect fields could label GRBL output as Marlin fan | implemented: deserialization uses the canonical controller-profile compatibility seam, and the metadata header consumes exact compiled-job power-mode facts from the same owner as emission; absent families report `none`, mixed families report every effective word |
| TL-L3 Alarm settings completion | P2 | the first Alarm regression asserted only `$$` dispatch and an empty response; a fast repeated-Alarm poll could cancel a slow read-only settings/build-info workflow, and both settings re-qualification and initial handshake released their final `$G` owner at transport acceptance rather than terminal `ok` | implemented: exact Alarm evidence permits the upstream-supported read-only query while all factual transport/MPG/activity fences remain; tagged terminal-exchange ownership pauses background polling, and both `$G` callers use the semantic command arbiter through terminal acknowledgement; polling resumes afterward, while ordinary interactive operations such as Set Origin remain pollable; regressions prove completed rows/qualification, preserved Alarm, no pre-`ok` poll, resumed polling, and Set Origin WCO refresh |
| TL-L4 production nested dialogs | P2 | Resize, Text, and Color dialogs did not own the shared topmost focus trap/restore contract, and ancestor Enter handlers could commit when Cancel was keyboard-activated | implemented: production dialogs use the shared owner, restore the opener, and preserve native button activation so Cancel never commits |
| TL-L5 explicit operation activation | P2 | clicking Show/Output label text bubbled through the operation section and changed the active drawing operation | implemented: only the accessible activation button changes the operation; labels and all other controls retain their own native behavior |
| TL-L6 selected-mask advisory parity | P2 | selected-only compilation retained an unselected mask as an output dependency, but Image Studio's kerf advisory searched only emitted objects and could analyze unmasked pixels | implemented: the advisory resolves the same scoped dependency graph as compilation without independently emitting the mask |
| TL-L7 qualified PNG worker ownership | P2 | a dimension-qualified embedded PNG used the incremental worker without exposing progress or Escape cancellation | implemented: every qualified worker route owns progress and cancellation independently of page-backed storage selection |
| TL-L8 Home takeover cleanup | P1 | `MPG:1` after `$H` dispatch invalidated position proof and prevented the settle `G4`, but the epoch mismatch also prevented failure cleanup and could strand the Home owner after explicit MPG release | implemented: every Home phase carries an exact transaction identity; takeover still invalidates proof and emits no continuation, while failure releases only that exact owner and leaves Home unknown with no proof |
| TL-L9 Trace commit ownership | P1 | deferred Trace completion compared only source ID, embedded data URL, and pixel dimensions, so a replacement document with an equivalent raster could receive stale geometry/delete-source mutation and an old dialog could close a reopened Trace request; page-backed asset identity was omitted entirely; the first owner repair did not remount local React state, so a new request could inherit the old file or busy flag | implemented: Submit captures the exact document epoch, live source object, and unique Trace-dialog request; every post-worker mutation, feedback, busy release, and close reclaims that owner, while stale completion silently no-ops and cannot close a newer dialog; the request identity keys the rendered dialog lifetime and source changes clear retained files; page-backed source eligibility includes exact asset identity |
| TL-L10 CNC recovery/duration contour parity | P1 | ADR-313 made contour emission and the main Preview use GRBL-parser-represented coordinates, but pass-recovery Preview and duration estimation still consumed raw contour points; a parser-collapsed contour therefore rendered nonexistent recovery motion and received 8.4168 seconds of nonexistent motion/entry time, while a partially collapsed contour retained extra planner time | implemented: a shared represented-XY helper keeps non-contour behavior unchanged while recovery Preview preserves the sealed pass identity with only represented contour motion; duration planning uses the same representation and omits plunge/retract time when the emitter returns before an unrepresentable contour |
| TL-L11 supervised runway representation | P1 | advanced CNC recovery treated raw manifest segments as selectable/executable geometry, so a parser-collapsed event could be offered as the uncertainty segment; a later retained segment incorrectly required proof of the immediately preceding raw event, and a mathematically exact runway start could round toward re-entry and emit shorter than the reviewed minimum | implemented: sealed raw event IDs remain stable, but each event resolves through retained source-point provenance to represented motion and its preceding emitted event; collapsed and first-represented events are not offered; Preview, review-plan, package identity, and the generated recovery job share one re-represented polyline, and a bounded safe-candidate search accepts only an emitted tangent runway at least as long as the qualified minimum |
| TL-L12 final CNC bounds ownership | P1 | the one raw bounds API served both pre-placement transforms and final physical disclosure; replacing it globally would lose detail that placement/tiling can restore, while leaving it raw made final Frame, canvas, stock, and park comparisons include parser-collapsed contour tails | implemented: pre-placement and tiling retain requested geometry; distinct final-output bounds use represented contour motion and cutter radius; Frame uses those exact bounds for mixed jobs plus the established raw fallback only when the whole job has no represented process motion, preserving Frame as the sole ordinary Start permit; stock warnings use final emitted bounds and park disclosure compares against the actual Frame outline |
| TL-L13 represented actual max depth | P2 | an emissionless deep contour still drove exported `actual-max-depth` metadata, Job Review depth, and stock-depth warnings despite emitting neither a plunge nor cut motion | implemented: actual compiled depth ignores only contour passes with no representable motion, retains every partially represented contour depth, and leaves requested-depth and tab-policy provenance unchanged |

The expanded late-repair matrix passed 44 files and 333 tests. It includes delayed final-`$G`
acknowledgement, Close/Escape/StrictMode/reopen Library schedules, isolated Text request cancellation,
Home takeover cleanup, and pending-Fire takeover compensation with `M5`. Exact-current TypeScript,
scoped ESLint, scoped Prettier, and `git diff --check` also passed. The product-source snapshot then
passed the full local `pnpm release:check`: typecheck, full source and Electron lint, repository-wide
format, ADR/action-pin/license gates, 1,812 test files with 11,424 tests, 41 release-integrity tests,
production web and Electron builds, file-size policy, and the public-export no-growth ratchet. Only
these evidence lines changed after that terminal gate; hosted exact-head and post-merge verification
remain separate.

SVG root `preserveAspectRatio` behavior is **policy-only**, not a defect in this branch: ADR-046
explicitly requires independent X/Y scaling when both physical dimensions exist. Recovery from
`ackedLines` remains an explicit physical-uncertainty disclosure rather than proof of execution.
Broad partial-output refusal proposals and clearing Frame for every controller error remain policy
questions, not autonomous remediations.

### Source-confirmed UI, accessibility, and input findings

| ID | Result | Current disposition |
|---|---|---|
| TL-U1 absolute raster power Preview | 10% (`S100`) and 100% (`S1000`) compiled pixels render identically because each group normalizes by its own maximum | implemented in this branch against the device maximum; emitted bytes are unchanged; UI priority schedule 11 files, 75 tests |
| TL-U2 numeric draft semantics | blank X/Y/rotation commits zero and creates undo through `Number('')`; the initial repair also treated HTML step mismatch as a refusal of finite values such as 0.05 mm or 10.5 degrees | implemented in this branch: blank/browser-unparseable drafts expose invalid state and create no mutation or undo, while `step` remains a spinner increment and every finite value remains accepted; UI priority schedule 11 files/75 tests plus adversarial repair matrix 11 files/94 tests |
| TL-U3 pointer ownership/cancel | `pointercancel` commits partial drag; a foreign pointer can move another pointer's drag | implemented in this branch: one pointer owns the drag and cancel/lost-capture restores the exact starting project or pan; UI priority schedule 11 files, 75 tests |
| TL-U4 direct hit geometry | raster/relief direct hits and empty vectors can fall back to transformed AABBs | implemented in this branch: direct raster/relief selection uses the transformed bounds quadrilateral and an empty vector has no direct-hit geometry; bounding-box marquee policy is unchanged; 19/19 focused scene tests passed |
| TL-U5 Studio modal ownership | Image/Design Studio overlays do not use the shared topmost focus trap/restore helper | implemented in this branch: both Studios use the shared topmost focus trap/restore contract while retaining their own Escape ladders; accessibility schedule 13 files, 65 tests |
| TL-U6 operation activation | a mouse-only section owns activation; nested buttons bubble and the active cue is color-only | implemented in this branch: a keyboard-operable activation button owns the row, nested controls do not bubble activation, and visible Active text supplements color; accessibility schedule 13 files, 65 tests |
| TL-U7 wheel edge math | horizontal-only wheel input zooms; pan uses unclamped zoom at the existing limit | implemented in this branch: horizontal-only input is inert and cursor-anchor pan uses the already-clamped zoom; existing limits retained; UI priority schedule 11 files, 75 tests |
| TL-U8 relief visibility | operation-hidden relief can still schedule and paint through legacy color visibility | implemented in this branch using the shared operation-binding visibility resolver for draw and worker scheduling; UI priority schedule 11 files, 75 tests |
| TL-U9 stride-decimation chords | every-Nth vertex retention can invent chords through hairpins/holes | source-confirmed; deferred topology-preserving preview slice |
| TL-U10 Image Studio reachability | nonwrapping actions, non-scrolling rail, and a 2-D color pad without complete keyboard behavior fail narrow/high-zoom reachability | implemented in this branch: actions wrap, the tool rail scrolls, the picker fits the viewport, and arrow keys control the 2-D color pad; accessibility schedule 13 files, 65 tests; browser/perceptual qualification remains separate |
| TL-U11 toast/motion/focus residuals | short color-variant toasts, unconditional selection animation, and an input rule suppressing focus outline remain | implemented in this branch: visible/readable severity plus longer lifetime, live reduced-motion ownership, and restored native input focus outlines; accessibility schedule 13 files, 65 tests; assistive-technology qualification remains separate |
| TL-U12 mixed-DPI refresh | ordinary 3-D scenes do not refresh DPR on same-CSS-size monitor changes; workspace remains deliberately 1x | source-confirmed residual plus packaged multi-monitor qualification |

### Source-confirmed scalability findings

| ID | Current classification and bounded evidence | Current disposition |
|---|---|---|
| TL-P1 repeated executable parsing | multiple independent semantic traversals/materializations occur during preparation and Start | confirmed; deferred artifact-reuse slice; parity must remain independent |
| TL-P2 page-raster hydration churn | immutable page-backed luma is reread and base64-encoded for multiple consumers | confirmed; deferred owner-keyed cache slice |
| TL-P3 Quick Nest obstacles | sequential subtraction/pruning measured 119/275/617/1,174 ms for 160/240/320/400 obstacles | confirmed; deferred indexed algorithm, no cap or guard |
| TL-P4 flat-core V-carve linking | repeated remaining-loop/point scans survive the earlier medial-detour fix | confirmed; deferred deterministic index slice |
| TL-P5 preview worker payload | boxed preview data is cloned without transferables | confirmed; deferred packed-transfer protocol |
| TL-P6 global canvas/scrubber work | budgets remain per path and scrubber allocates prefix arrays | confirmed; deferred browser-profiled global budget and zero-copy slice |
| TL-P7 multi-selection drag commits | every selected object causes a whole-scene map/store update | confirmed; deferred atomic batch commit |
| TL-P8 Run Order grouping | growing `objectIds` arrays are spread for every member | implemented in this branch with mutable internal accumulation and one immutable copy at return; 4,000-object regression included, 4/4 focused tests passed |
| TL-P9 trace supersession | stale callers reject but their queued worker compute is not retired, contrary to ADR-137 | confirmed contract drift; FIFO imports and named warm-worker lanes remain deliberate |
| TL-P10 page-asset reclamation | current source deliberately never deletes page assets | accepted/deferred debt under ADR-283, not a novel defect |
| TL-P11 long-line readers | 2/4/8/16 MiB single lines measured 138/566/2,163/8,381 ms before remediation | implemented in this branch with fragment accumulation; post-fix readers measured 9.8/15.7/29.5/53.5 ms and 20.8/30.1/53.3/89.5 ms |
| TL-P12 operation-card work | all cards mount and each rescans all objects | confirmed; deferred preaggregation/virtualization slice |
| TL-P13 relief double decode/hash | roughing and finishing independently validate/decode/digest one immutable source | confirmed; deferred compilation-owned cache |
| TL-P14 page-source copies/cancel | source reconstruction copies every page and unmount suppresses publication without aborting the read | confirmed; deferred zero-copy/abort slice |
| TL-P15 two-hop V-carve clone | boxed V-carve results clone child-to-broker and broker-to-outer worker | confirmed; deferred packed transfer across both owners |

### Release, documentation, and qualification classifications

- The checked-in `public/_headers` requires `/sw.js` `Cache-Control: no-cache`; both immutable Pages
  aliases complied, but canonical `https://kerfdesk.com/sw.js` returned `max-age=14400` with the same
  bytes/ETag. This is a source-confirmed provider/config drift affecting update discovery freshness;
  its provider-side cause is externally unverified and no manual deployment/provider mutation is
  authorized in this remediation.
- `PROJECT.md`, `README.md`, and `WORKFLOW.md` retained first-Preview/import/schema wording that no
  longer described current behavior. Those documentation-only corrections are in this branch.
- Canonical-domain header/offline coverage, hosted coverage-report, hosted packaged-native-smoke,
  inactive stable release, installed-package/real-picker, mixed-DPI, assistive-technology,
  perceptual/reference-CAM, and all hardware lanes remain separate evidence states.
- Existing scene/raster/tile/CSV ceilings are policy-only guard candidates. They are not widened,
  relabelled, or treated as source fixes here.

### Current audit evidence

- A clean pre-remediation `pnpm release:check` passed typecheck, source/Electron lint, Prettier, ADR
  numbering, seven action-pin checks, license closure, 1,802 scheduled Vitest files with 11,267 tests
  passed and 22 skipped, 41/41 release-integrity tests, a 2,367-module production build,
  Electron-main build, file-size policies, and export ratchet.
- Independent focused lanes passed 30 files/358 machine-output tests, 315 document/runtime tests,
  17 files/111 UI tests, and 25 files/170 performance tests. Blind verification passed 23 files/241
  tests for ownership/parser/output/transport and 10 files/71 tests for the priority UI cases.
- The final independent integrated review found four repair regressions and one follow-up: Open had to
  bind New/document epochs without suppressing its own post-commit feedback; post-MPG Frame needed the
  last completed report-unit interpretation; Numeric Edits could not turn spinner steps into value
  refusals; valid optional-block-delete/line-checksum framing had to remain visible; and the new raster
  type could not grow a legacy public barrel. The repaired matrix passed 11 files/94 tests, typecheck,
  and `check:index-exports`; the advancing-epoch Open follow-up passed 3 files/9 tests.
- The final CNC precision side audits then found and repaired partial-segment early selection,
  rounded-prefix carry, signed-zero/p3 parser mismatch, and parser-stationary p3 fallback words. The
  adjacent precision matrix passed 8 files/93 tests; two independent reviews passed 45/45 focused
  tests, 5,000-contour exhaustive candidate comparison, 2,000-case selection/warning parity, and
  299,854 finite-value exact-prefix/parser comparisons with no mismatch. Ten-thousand-point medians
  were 7.75 ms at ordinary p3, 59.93 ms at p4, and 405.82 ms for an adversarial best-partial p18 case;
  a persistent pathological benchmark remains a test/optimization gap, not a correctness closure.
- Three final read-only policy side audits found two repository-review defects: Open request ownership
  used forbidden module-level mutable state, and the new 2 MiB line-reader regression was attached to
  the UI forwarding module instead of its `src/io` owner. The request epoch now lives in the existing
  Zustand project slice, survives document replacement, and covers deferred picker and autosave
  feedback; the direct regression is now `src/io/blob-line-reader.test.ts` while the historical UI
  forwarding tests remain in place. The parent focused matrix passed 10 files/51 tests; independent
  ownership and guard reviews passed 3 files/11 tests and 7 files/22 tests, scoped ESLint/Prettier,
  typecheck, and `git diff --check`, with no new Start/Frame gate or parser refusal.
- The exact-final frozen source snapshot (`git diff --binary` hash `56bf60f81e3f00042eb6c1c6fba38a1e05c6bb27`)
  passed `pnpm release:check`: typecheck, source and Electron lint, repository-wide Prettier, ADR
  numbering, action-pin and license checks, 1,803 passing Vitest files plus 14 skipped (11,380 passing
  tests plus 22 skipped), 41/41 release-integrity tests, a 2,379-module production build,
  Electron-main build, file-size and soft-size policies, and the public-export ratchet. The first
  exact-final attempt had exposed only stale M3-mode, empty-vector-hit, and device-absolute raster
  Preview expectations; their focused repair matrix passed 6 files/61 tests before this frozen rerun.
- Independent late review then found the adjacent ownership, metadata, Alarm polling, production-dialog,
  operation-label, selected-mask advisory, and qualified-PNG gaps recorded above. Exact-owner challenge
  added the Library lifetime, final-`$G`, and Home-takeover repairs plus isolated Text and Fire takeover
  coverage. The expanded exact-current matrix passed 44 files/333 tests plus TypeScript, scoped
  ESLint/Prettier, and `git diff --check`; the post-repair repository-wide release gate is tracked
  separately rather than retroactively attributed to the earlier frozen snapshot.
- A final independent handoff audit reproduced stale Trace completion against an equivalent same-ID
  replacement raster: the pre-fix focused regression performed one unintended `traceExistingImage`
  mutation. Exact document/source/dialog ownership now makes that schedule and close/reopen stale
  completion silent no-ops, and a rendered replacement-request schedule proves the new source inherits
  neither the old file nor its in-flight busy state. The focused Trace matrix passed 6 files/64 tests; TypeScript and scoped
  ESLint passed. Hosted checks and the final repository-wide release gate are tracked separately.
- The post-Trace exact-head safety audit then reproduced one adjacent ADR-313 parity defect before
  merge: an emissionless contour still exposed both requested points in pass-recovery Preview and
  received 8.4168 seconds of estimated motion/entry travel; a partially collapsed contour also kept
  nonexistent planner time. The pre-fix matrix failed all three targeted assertions. Recovery Preview
  and duration now consume the same parser-represented contour points as emission, while retaining the
  sealed `(groupIndex, passIndex)` recovery identity; emissionless contours receive no plunge/retract
  estimate. The focused parity matrix passed 4 files/42 tests. Hosted exact-head and final
  repository-wide verification are restarted on the resulting commit rather than credited from the
  canceled pre-fix CI run; the expanded emission/Preview/duration/recovery matrix then passed 17
  files/117 tests.
- The ensuing independent raw-contour ownership sweep classified every post-compilation consumer.
  Origin placement, tiling, coordinate-integrity scans, raw semantic manifest identities, precision
  warnings, and the deliberately conservative warning-only compiled-work estimate remain requested-
  geometry owners. Four final-output seams survived: advanced recovery selection/replay, final bounds,
  park-versus-Frame disclosure, and actual compiled depth. Pre-fix regressions proved a collapsed
  runway event was selectable, a later emitted event demanded proof of the wrong raw predecessor, a
  re-rounded runway could emit shorter than its reviewed minimum, final bounds retained a phantom
  tail, park disclosure lost the all-emissionless Frame fallback, and an emissionless Z -7 contour
  reported 7 mm actual depth despite emitting no plunge or cut.
- Raw recovery IDs now map through retained source-point provenance without renumbering archived
  manifests; the generated recovery contour is canonicalized to exact parser coordinates and a
  safe-candidate search accepts only a tangent emitted runway meeting the qualified minimum. Final
  represented bounds are separate from raw pre-transform bounds, and Frame alone keeps the existing
  all-emissionless outline fallback. Actual-depth disclosure ignores only contours with no represented
  motion. The exact-current focused matrix passed 29 files/209 tests; TypeScript, all changed-file
  ESLint, scoped Prettier, and `git diff --check` passed. An independent current-byte side review passed
  17 files/85 tests and returned CLEAN after verifying recovery, bounds, depth, call-site, and Rule-7
  behavior. The first post-review `pnpm release:check` passed 1,818 Vitest files and 11,450 tests,
  41/41 release-integrity tests, both builds, and file-size policy, then correctly failed the final
  public-export ratchet because four new bounds helpers had grown the legacy Job barrel from 85 to 89
  exports. Those helpers now remain leaf-module APIs at their seven internal consumers. The repair
  passed 7 files/43 independent focused tests, TypeScript, scoped ESLint/Prettier, `git diff --check`,
  and the 85-export ratchet. An exact-byte full `pnpm release:check` rerun then exited 0 across
  typecheck, source/Electron lint, repository formatting, ADR/action-pin/license checks, the same
  1,818 passing test files plus 14 skipped (11,450 passing tests plus 22 skipped), 41/41 release-
  integrity tests, the 2,388-module production build, Electron-main build, file-size policy, soft-size
  reporting, and the public-export ratchet. Only this evidence text changed after that terminal gate;
  hosted exact-head remains a separate state.
- These are software/source results, not controller acceptance, physical execution, material output,
  image quality, reference-CAM equivalence, installed-package behavior, or human-perceptual proof.

## 2026-09-01 independent re-audit and ADR-314 remediation

This section is the authoritative record for the current branch. It does not rewrite evidence from
the historical 2026-08-29 advanced-CNC remediation above. The re-audit reconciled current source,
focused reproductions, the existing ledger, and independent side reviews before accepting a finding.
No finding in this section adds a guard: Frame remains the only ordinary Start permit, Image Studio
actions retain their last valid value rather than refusing an invalid transient draft, and CNC
requested/effective differences remain disclosures rather than output blocks.

| ID | Classification and current-main reproduction | Current disposition | Current evidence | Remaining evidence boundary |
|---|---|---|---|---|
| RA-314-01 concurrent project-save ownership | confirmed defect: request-global publication and destination-global ordering allowed an unresolved unrelated picker to delay another save, while out-of-order pickers for one physical file could leave older bytes or publish state into a replacement document | implemented: request ownership lives in the project store; every selected write begins before identity comparison; stalled comparisons and distinct targets remain independent; proven same-file overlaps replay newest captured bytes only in background repair; only a current successful handoff publishes file ownership | focused schedules cover unresolved pickers, stalled identity, immediate same-target overlap, late older selection, distinct wrappers, rejection recovery, document lifecycle, commands, shortcuts, and discard | Real Chromium/native picker-handle behavior and installed-package persistence remain externally unqualified |
| RA-314-02 save/recovery replay failure | confirmed defect: failure while replaying newest bytes could be hidden by a merely pending then cancelled newer picker, and raw recovery export supplied no restore-failure owner after reporting success | implemented: restore failure marks the still-current successful handoff uncertain, while a genuinely newer successful handoff or replacement document suppresses stale failure; recovery export reports when its selected artifact could not be restored | exact pending-newer/cancel, newer-success, canonical-save replay, and raw-recovery replay regressions pass in focused verification | Filesystem failure injection is automated; power loss, OS picker integration, disk-full behavior, and installed-package behavior remain unqualified |
| RA-314-03 Image Studio Text ownership | confirmed defect: Text raster/font completion was bound too loosely and could mutate or speak over a same-id replacement, removal, close, retry, or later draft | implemented: the request owns the exact Image Studio session plus source; current errors remain in the owned dialog with the draft; stale success/failure is silent | focused Text owner/retry/edit/removal/replacement schedules pass within the Image Studio matrix | Font rendering quality, browser perception, and assistive-technology integration remain external qualification |
| RA-314-04 transient numeric drafts and dialog ownership | confirmed defect: Text/Resize/Canvas/Ink drafts collapsed editable text into numbers and same-id source replacement could receive an older commit | implemented: transient strings are separate from last-valid values; blur restores invalid text; valid represented dimensions display immediately; exact session/source ownership gates mutation; OK/Enter uses the last valid value and does not become a new refusal | the rendered Text-size snap-back reproduction failed before repair; the exact Text/Resize/Ink matrix then passed 4 files/43 tests, scoped lint/Prettier, and TypeScript | Browser focus/IME behavior, perception, and assistive-technology integration remain unqualified |
| RA-314-05 CNC represented coordinate parity | confirmed defect: ordinary emitted three-decimal Z could differ from Preview, removal, helix seams, pass exit, maximum depth, provenance, warnings, and standalone surfacing disclosure through raw or twice-rounded values | implemented: one source-faithful GRBL eight-digit/float32 parser and exact emitted text/value representation own ordinary CNC Z; maximum-depth and surfacing retain exact winning text; provenance advances to `adr-314-cnc-represented-z-v1` | independent represented-Z matrix passed 12 files/125 tests; wider CNC matrix passed 25 files/257 tests; exact snapshot/recovery/performance matrix passed 7 files/72 tests; connected-script bytes and SHA remained unchanged | Controller parsing, machine resolution, tool/spindle behavior, material removal, surface finish, and reference-CAM parity remain external qualification |
| RA-314-06 duration and emission eligibility | confirmed defect: estimates priced raw XYZ/safe-Z/feed rather than represented emitted motion, and disclosure consumers could count emissionless passes | implemented: duration selects feed from emitter-formatted XYZ, plans represented motion, rounds emitted feed, and uses represented safe Z; maximum depth and duration share existing pass-emission eligibility | half-quantum, signed-zero, feed-rounding, safe-Z, pass-kind, and emissionless/partial regressions pass in the CNC matrices above; TypeScript, scoped ESLint, export ratchet, and diff check passed in independent review | Estimates remain analytic software predictions, not measured machine time |
| RA-314-07 narrow representation entry points | test/contract gap exposed by repair: cross-module helpers could have grown frozen legacy CNC/Job barrels or added a new geometry deep import, while new helpers pushed `job.ts` and `toolpath-cnc.ts` above the soft-size tier | implemented as four narrow index-only entry points; helical and represented-toolpath helpers moved to dedicated modules; legacy CNC and Job barrel counts remain 67 and 85 | focused extraction matrix passed 12 files/133 tests; TypeScript, scoped ESLint/Prettier, public-export ratchet, and diff check passed; both touched Job files are below 250 counted lines | Repository-wide raw file-size and export-ratchet checks passed; the report-only soft-size inventory remains nonblocking by contract |
| RA-314-08 raw recovery-manifest phantom options | policy-only/deferred: filtering or renumbering emissionless raw events would change sealed manifest identity and archived-artifact reconstruction | no product change; retain schema/identity compatibility until a versioned migration is designed and reviewed | existing recovery snapshots and exact connected-script hash remain unchanged | A future migration needs explicit compatibility policy and archived-artifact fixtures |
| RA-314-09 original five advanced-CNC findings | already covered: shallow-surfacing preservation, physical placement, global clearing-before-profile order, multi-revolution helix expansion, and radius-aware warning-only no-go disclosure remain in current main | no duplicate implementation; the re-audit exercised adjacent represented-Z semantics without changing those established contracts | the represented-Z/wider CNC matrices above include surfacing and helix paths; historical ACNC evidence remains in its own dated section | Hardware, perceptual, fixture, and reference-CAM limits remain unchanged |
| RA-314-10 finite-helix omission candidate | refuted/policy-incompatible: treating non-finite revolution counts as silently non-emitting would widen output omission rather than repair parity | rejected and removed; existing factual compile-integrity behavior is preserved | independent source review confirmed the candidate was absent from the current diff | Invalid-domain policy changes require a separately source-backed design and must not create a new guard |

### Current verification state

- Focused Image Studio and CNC evidence is recorded above. The exact combined Save/recovery matrix
  passed 13 files and 123 tests after the nondelaying replay-failure repair and save-tracking test
  extraction.
- The exact review-remediated product-source tree passed `pnpm release:check` with exit 0:
  TypeScript, full source and
  Electron lint, repository-wide Prettier, ADR numbering, seven action-pin checks, production-license
  policy (52 packages/eight licenses), 1,825 passed Vitest files plus 14 skipped, 11,552 passed tests
  plus 22 skipped, 41/41 release-integrity checks, the 2,399-module web build, Electron-main build,
  raw and report-only soft file-size scans, and the legacy public-export no-growth ratchet. The only
  post-gate edits are the exact evidence/status wording in this ledger and ADR-314; Prettier, ADR
  numbering, and `git diff --check` are rerun below rather than misrepresenting documentation-only
  evidence as part of the earlier byte set.
- PR #710 satisfied its exact-head required checks and review/thread policy, merged as exact main
  `0a29540d9319958e35bfccc5f261edeed66cea82`, and retained zero open PRs. Exact-main Chrome UX smoke
  run 33504650137 and full CI run 33504650074 succeeded. Automatic Pages run 33507899422 then passed
  its independent release gate and current-main freshness check before publishing deployment
  `https://f79a9f41.laserforge-2fj.pages.dev`; that URL, `https://kerfdesk.com/`, and the default Pages
  alias returned HTTP 200 with the same `assets/index-DfGlib0o.js` asset. These hosted states remain
  separate from the local release evidence above.
- No device was contacted and no hardware, air-cut, material-cut, perceptual, reference-CAM,
  installed-package, or manual-deployment qualification was performed.

## 2026-09-01 eight-lane follow-up and design-state remediation

This section initially reconciled the eight frozen Ultra-audit lanes and the frozen
design-authoring donor against exact main `0a29540d9319958e35bfccc5f261edeed66cea82`.
Design-state PR #711 then merged as `26745bc7a36adc9d6890d54aa3f906330d32df6b`, and topology/output
PR #712 merged as current Join-slice baseline `61333259d7bb4abf8483e6a2a5acc24a7752db1c`; both satisfied
their exact-head required checks and retained zero open PRs at their merge refresh. Donor changes
remain evidence only:
the design donor remains unmodified at `da67029a82ca82c64c46e1cf86ad3945c95eefad`, with 17 modified
tracked files, 12 untracked files, tracked-diff SHA-256
`a35c5b2faad1f737d367269b27ac8bd6c9ca7eb47c0e93e3860654b8a8053a61`, and untracked-manifest
SHA-256 `3ccf59a2d52e1eaa4a1feb44db4ffc95e7bee843300fb436fc948cdc963a4eb8`.
Its 1,825-file/11,479-test green suite is useful regression evidence but does not clear the missing
adversarial topology, Join, or Clipboard cases listed here.

| ID | Current-main classification and reproduction | Current disposition | Current evidence | Remaining boundary |
|---|---|---|---|---|
| UA8-DS1 compatibility-node metadata | confirmed defect: compatibility-polyline move/delete rebuilt a path from only `color` and `polylines`, dropping `operationIds`, `strokeWidthMm`, and any other output metadata | merged through PR #711 by removing only stale `curves` and preserving the rest of the exact path; save/reopen retains the operation binding | both regressions failed before the fix; move/delete plus save/reopen tests now pass | Node-edit geometry is software-verified; emitted motion and physical output are not hardware-qualified |
| UA8-DS2 transitive copy dependencies | confirmed defect: Array, Duplicate, and Clipboard each followed only one `pathText.guideObjectId` or `imageMaskId` hop, so text-to-text-to-guide and text-to-raster-to-mask copies retained dangling second-hop references; adversarial review then proved Clipboard conflated user roots with dependencies, Cut removed the whole closure or bypassed deletion repair, Open/New cleared the clipboard, cross-document operation-id collisions inherited target settings, missing ids could collide with target or newly generated operations, source-less legacy color aliases and cross-object aliases could adopt unrelated settings, partial groups were cloned, and Array could move locked/shared/group-owned dependency sources beneath untouched artwork | merged through PR #711 with one ordered, cycle-safe shared closure/remapper used by all three actions; Clipboard separately owns roots and source document epoch, survives document replacement, selects/cuts only roots, uses canonical dependency repair, clones source operations across documents, tracks mapped operation ownership per copied object, keeps unresolved partial bindings away from target/generated aliases, materializes source-less objects under fresh fallback operations, and preserves only complete groups; Array clones protected first-placement components, includes selected sources with incoming owners, expands groups through an indexed fixed point, bounds protection to the copy closure, and treats normalized full turns/quadrants as exact identity; deleting a path-text guide removes the stale link with a nonblocking warning while retaining materialized text geometry | nine regression-first assertions failed before the first closure repair; six further adversarial Clipboard/Duplicate assertions and nine initial Array ownership/identity assertions then failed before their repairs; selected-owner, partial-group, nonzero-radius, huge-angle, target/generated-operation alias, legacy-color alias, and cross-object alias schedules were also reproduced before repair; post-fix coverage includes both dependency chains, cycles, missing/colliding references, Raster/Relief/mixed-path operation ownership, deep array copies, actual `setProject` lifecycle, selected-root Cut/Paste, canonical mask/path-text deletion repair, exact compiled settings, complete-versus-partial groups, 1,000-member group expansion, huge finite circular angles, save/reopen, and delete-original isolation | Existing already-missing references remain truthful rather than inventing an object; dynamic text after deliberate guide deletion becomes ordinary unbent editable text, and perceptual path-text/mask rendering remains unqualified |
| UA8-DS3 overlapping group closure | confirmed defect: one forward pass over groups made selection depend on group record order and missed transitive overlap | merged through PR #711 with a member-indexed fixed-point traversal that preserves scene order and leaves both persisted group records unchanged | reverse-order reproduction failed before the fix; selection plus exact save/reopen group records now pass | Group appearance and complex interactive pointer schedules remain browser/perceptual evidence lanes |
| UA8-DS4 hidden snap targets | confirmed defect: object snapping excluded locked/self/ignored objects but did not apply the canonical operation-binding visibility resolver | merged through PR #711 with one per-snap visibility lookup; hidden bindings and duplicate legacy color aliases no longer create snap guides, while any visible or unknown binding retains canonical fail-visible behavior | pre-fix hidden-target integration failed; canonical operation-id, color-alias, duplicate-color, any-visible, unknown, and ignored-target tests now pass | Pointer feel and high-density canvas perception remain unqualified |
| UA8-GEO1 design topology and output semantics | confirmed defects, intentionally not copied from the donor: n-ary Intersect/XOR semantics, Text non-zero fill, per-`ColoredPath` render-batch normalization, canonical-curve ownership, raw stored/source-order determinism, multi-operation Weld settings, and Boolean/Offset subject overrides all have source-backed adversarial reproductions | merged through PR #712: Subtract remains subject-minus-union; Intersect/XOR reduce every canonicalized object region in deterministic order; Text uses per-batch NonZero and ordinary artwork per-batch EvenOdd before within-object union, while the documented layer-wide EvenOdd-between-objects contract remains unchanged; canonical curves flatten at machine tolerance before genuine transforms; Weld preserves effective per-path operations, no-output and orphan ownership, shared-run grouping, source/clone lifecycle, and collision-free operation ids/colors; Boolean/Offset retain subject overrides, sublayers, power scale, and truthful linked-material state; every geometry-engine failure is transactional | exact focused matrix passes 18 files/120 tests; typecheck, full source/Electron lint, repository-wide Prettier, `git diff --check`, raw/report-only file-size, public-export no-growth checks, and exact-head Browser/full CI passed; coverage includes all n-ary permutations, transformed/reflected/nonuniform fixtures, raw and compiled source order, Text/Weld/Boolean/Offset/donut controls, same/duplicate-color batches, AB+A bindings, reflected V-carve stroke parity, explicit-empty/full/partial orphan ownership, selected/unselected id and legacy-color collisions, 256 operation colors, later-stage engine failures, undo/delete/save/reopen, and exact compiled settings | External CAM, perceptual topology, physical kerf, material output, and controller behavior remain unqualified |
| UA8-JOIN1 Join determinism and truthful reachability | confirmed donor defects: click order changed raw/compiled source order, interior anchors appended a disconnected run, and several enabled two-anchor selections silently no-op; independent review additionally reproduced underbounded canonical cubic extents, CNC tab-index drift after contour removal, polyline-Shape spec/path split truth, and a proposed locked-artwork refusal that would have violated the existing no-new-guard contract | implemented in this separate Join slice with source-index roles, exact endpoint orientation, same-subpath close, atomic materialization, canonical-curve bounds, retained later-contour CNC tab positions, Shape-spec synchronization for every visible one-subpath curve command, one-step Undo, success/warning announcements, and focus recovery; unsupported reachable combinations retain selection and receive truthful nonblocking feedback, while retained node selections still honor the pre-existing Join behavior after Lock Selection rather than adding a new refusal | the exact regression-first focused matrix passes 16 files/84 tests: all four endpoint/click-order permutations with an unrelated curve, genuine rotation/nonuniform-scale/reflection, transformed arc reversal, raw stored and compiled `source-order` equality, canonical extrema, metadata and manual-tab ownership, Shape Smooth/Corner/Curve/Line/Start/Break/close, accepted multi-subpath ordinary node editing, different `ColoredPath`/object, closed/open, interior, locked-selection Join, undo, announcement, focus, and save/reopen cases; independent review passes 13 files/77 tests with no remaining finding; the same source tree passes full `pnpm release:check` with 1,845 files/11,701 tests green, 14 files/22 tests intentionally skipped, 41 release-integrity tests, the 2,414-module web/PWA build, Electron compilation, and every static gate before this evidence-only ledger update | Join intentionally remains endpoint-only because one curve subpath represents one continuous traversal; visual/perceptual output, external-CAM comparison, and physical machine output remain unqualified |

### Reconciled command-shell and diagnostic findings

The read-only shell/diagnostics lane remained byte-identical to exact main and passed 24 focused
files/167 tests. Those green legacy tests do not cover the adversarial schedules below.

| ID | Classification and exact current-main result | Disposition |
|---|---|---|
| UA8-DIR01 | P1 confirmed: status-only Alarm cancels a stream without Alarm-owned interruption evidence; checkpointing can consume a stale global notice or label the stop as an app cancellation | pending run/session/causal-sequence ownership; cover streaming, paused, and tool-change Alarm paths without adding a Start guard |
| UA8-DIR04 | P1 confirmed: physical disconnect, EOF, read exception, intentional close, and permission loss collapse through a cause-free `SerialConnection.onClose` | pending typed observed-cause propagation into transcript/recovery; do not claim a controller cause the platform did not observe |
| UA8-GUARD01 | P1 confirmed policy violations: empty-output Preview is disabled despite the `P` route; dirty unload silently refuses close; PWA Update is hidden during activity | Preview, unload, and Update ownership remain pending; keep each reachable/nonblocking and keep Frame as the sole ordinary Start guard |
| UA8-GUARD01-PANEL | P1 confirmed: Machine Panel, Toggle Side Panels, and F12 were blocked during active/terminal streamer states even though ADR-207's Live Motion bar independently owns Abort | implemented in this app-shell slice: Window commands, F12, stored rail visibility, and the Machine-rail collapse button remain operable during a run; live help states the active-job behavior; focused regression-first matrix passes as part of 10 files/91 tests. Browser layout and pointer perception remain unqualified until hosted smoke; software Abort remains in the independent Live Motion bar and no Start guard changed |
| UA8-CS01 | P1 confirmed: Image Studio root shortcuts steal Space, arrows, Enter, and Ctrl+A from native inputs/buttons, while Design Studio omits `SELECT` and activation controls from its native-control arbitration | implemented in this app-shell slice through the shared native editing/activation target policy and already-handled-event ownership, with input/textarea/select/button/custom-control regressions plus a real bubbled resize-handle case and no geometry/history mutation; focused regression-first matrix passes as part of 10 files/91 tests. Non-US keyboards, assistive technology, and browser-level focus perception remain external qualification |
| UA8-CS03/04 | P2 confirmed: context click collapses member multiselection and lacks complete menu keyboard/focus ownership; a 320 px menubar cannot reach all families | pending roving menu focus/restore, selection-preserving context ownership, and 320 px pointer/keyboard coverage |
| UA8-PWA01/02/03 | P2 confirmed: service-worker failure is console-only while Offline can claim readiness; compact side panels can consume the canvas; Update shares a hidden-scroll telemetry row | pending nonblocking readiness/error state, compact-layout ownership, and fixed action reachability |
| UA8-EL02/03/04 | P2 confirmed: fixed support links are denied by Electron child-window policy; macOS window recreation accumulates serial-selection listeners; Electron serial help says to install the app | pending exact-URL external allowlist, session-global/disposed listener ownership, and runtime-aware copy; packaged macOS remains external qualification |
| UA8-DIR02/03 | P2 confirmed: reconnect clears the prior transcript before a new port succeeds, and failed writes are absent rather than recorded as attempted/receipt-unknown | pending session archive/attachment ownership and truthful ambiguous-write entries |
| UA8-DIR05/06/10 | P2 confirmed: documented diagnostic export is absent; crash/global/Electron evidence is inconsistent; exact execution archives are private/unredacted without disclosure | pending a versioned allowlisted share-safe diagnostic and explicit exact-archive disclosure; exact private archives remain byte-faithful and are never redacted in place |
| UA8-DIR07/08/09 | P2 confirmed: repeated PWA Update owns independent reload latches; autosave reporting permanently suppresses later incidents; G-code Save allows duplicate picker/write invocations | pending coalesced retryable owners with tests; existing identity-bound variable advancement is already correct and is not reopened |
| UA8-SHELL-P3 | P3 confirmed: shortcut help omissions/stale Ctrl copy, splash precache gap, docked-console clipboard rejection loss, and stale `.lf` bug-template copy | pending documentation/cache/error-copy cleanup in the matching shell slice |
| UA8-SHELL-N | narrowed/refuted: Super Console already handles clipboard rejection; duplicate variable advancement is refuted; docked Clear/history mismatch was not reproduced; macOS accelerator arbitration is external | no duplicate source change; retain exact evidence boundaries |

### Reconciled camera and rotary findings

The read-only camera/rotary lane remained byte-identical to exact main, passed 22 camera files/144
tests and 14 rotary files/45 tests, and ran source-level adversarial probes without contacting any
camera, controller, or machine.

| ID | Classification and exact current-main result | Disposition |
|---|---|---|
| UA8-CAM-PRIV01/ID01 | P1 confirmed: raw RTSP credentials can reach renderer queries/status via bridge and FFmpeg errors; removing the whole query also collapses distinct query-selected feeds to one calibration identity | pending opaque renderer session routes, allowlisted structured errors, and a non-secret full-endpoint fingerprint; exact private process evidence remains internal |
| UA8-CAM-ASYNC01/02 | P1/P2 confirmed: capture, auto-align, Detect, Trace, enumeration, and discovery can publish after source/document/wizard/request supersession | pending reusable source/document/session/request epochs; late work retires silently without mutation or false success |
| UA8-CAM-BED01/COMPAT01 | P1 confirmed: bed/profile edits retain old alignment, and overlay rectification checks alignment but not calibration binding | pending persisted bed/profile signature plus dual current-capture compatibility; mismatch is a Camera/Job Review warning and never a Frame/Start refusal |
| UA8-CAM-MIRROR01/HOMO01 | P1 confirmed: a mirrored marker fixture persisted as aligned with a 15.791 px verification residual while independent physical corner error was about 402.3 mm; a singular homography passes validation | pending handedness/permutation evaluation, invertibility/conditioning/finite-mapping validation, and truthful nonblocking failure recovery |
| UA8-CAM-TRACE01 | P1 confirmed: Camera Trace creates a transient raster that ordinary scene-owned Submit cannot claim, so Submit silently returns no mutation | pending explicit transient-camera owner and one atomic source/output/delete/operation/undo/document mutation |
| UA8-CAM-MEM01/JR01/CLAMP01 | P2 confirmed: closing the lens wizard retains pixel buffers; calculated camera geometry warning is dead data; material/alignment height silently caps at 500 mm | pending session cleanup, warning-only Job Review routing with `ok === true`, and preservation of positive finite representable height without arbitrary cap |
| UA8-ROT-RAS01 | P1 confirmed Frame-only violation: Labs policy returns empty raster/mixed rotary output and Save treats it as factual refusal | implemented in the current branch under ADR-315: rotary G-code bytes no longer depend on Labs/profile policy; the obsolete Save/Preview/Frame/Start/Inspector permission and permit identity are removed; Rotary Setup remains reachable; retired persisted keys are ignored; and the exact prepared active-rotary raster job adds one nonblocking Job Review qualification warning. Existing `.rd` raster non-support remains a separate encoder limitation, not claimed fixed |
| UA8-ROT-FEED01 | P1 confirmed: chuck scaling transforms Y geometry but retains the requested `F` and contour-entry/fill-runway distance scalars, so equal requested horizontal, vertical, and diagonal moves have different surface traversal speeds | pending direction-aware feed/runway mapping shared by Preview, estimate, G-code, `.rd`, mixed, and multipass output; add scale 0.5/1/2 fixtures without a cap or qualification refusal |
| UA8-ROT-REC01 | P1 confirmed: project-open machine reconciliation ignores all output-affecting rotary changes | pending identity/reconciliation coverage for enable, kind, diameter, motion per turn, and reverse fields |
| UA8-ROT-Q01 | narrowed but confirmed: the alleged `1e308` NaN-emission path is refuted; overflow instead yields zero scale, Y collapse, and NaN wrap | pending overflow-resistant scale/wrap algebra and extreme finite-ratio fixtures; do not create a numeric cap or refusal |
| UA8-ROT-UI01/JR01/CLAMP01 | P2 confirmed: quick Setup can be disabled while persisted rotary output remains active (full Machine Setup still exists); review says only Enabled and omits surface versus commanded-machine extent/seam/wrap/reverse facts; edit UI silently caps at 100000 | pending truthful reachable setup, exact requested/effective mapping facts, every rotary-field reconciliation notice, and positive-finite editing without arbitrary maximum |
| UA8-ROT-HOME01 | P2 confirmed source/disclosure gap: generic Home exposes no rotary/Y-substitution context while the physical effect is hardware-only | pending truthful nonblocking Home/Y-substitution disclosure without implying A-axis support; physical homing behavior remains external |
| UA8-ROT-RD01 | P2 confirmed: `.rd` applies rotary conversion but emits an over-wrap program without the final advisory available to reviewed output | pending byte-preserving exact/under-wrap behavior plus a nonblocking over-wrap advisory for reverse/custom profiles |
| UA8-ROT-OPT01 | P3 confirmed: path optimization ranks pre-scale surface-space Euclidean distance, which can choose a farther machine-space path after rotary scaling | pending rotary-metric-aware source-order fixtures at scales 0.5/1/2 while preserving scale-1 byte identity |
| UA8-ROT-QUANT01 | P3 narrowed: extreme accepted calibration can quantize visibly requested surface Y to stationary emitted motion without disclosure | pending Preview/Job Review representation disclosure only; do not add a cap, rewrite, or refusal |
| UA8-ROT-SEAM01 | covered/policy: flat-bed Y rebasing to the rotary seam is the explicit ADR-127 contract; a distinct persisted periodic phase/unwrap intent does not exist and requires a new product contract rather than being inferred as a bug | preserve current rebase; add raw stored/emitted source-order disclosure tests, but do not silently reinterpret linear 99-to-1 input as a two-unit wrap |
| UA8-CAMROT-EXT | external qualification: optics, handed physical mounts, controller calibration, scale/direction, slip/backlash, seam quality, and material output | no software or safety claim; no hardware operation in this remediation |

### Reconciled jig, variable-data, text, and estimation findings

This read-only lane used exact-main blobs while the parent branch changed unrelated files. Its 24-file
legacy matrix passed 131 tests; separate no-file probes reproduced the duration, sequence, ligature,
and missing-glyph cases below.

| ID | Classification and exact current-main result | Disposition |
|---|---|---|
| UA8-JIG01 | P1 confirmed: replacing, shrinking, or removing a jig set leaves generated copies that compile as ordinary artwork because cleanup recognizes only current active prefixes | pending atomic generated-copy/group/order reconciliation with undo, persistence, and compile tests |
| UA8-JIG02 | P1 confirmed: Jig and Quick Nest do not move transitive mask/path-text dependencies; Array and Clipboard shared the same one-hop defect | Array/Clipboard/Duplicate are implemented in UA8-DS2; Jig must copy and Nest must move the same closure in their own slice; cycles/missing/group/operation cases remain required |
| UA8-JIG03 | P1 confirmed: selected-only output drops registration boxes needed for set anchor and piece-run context | pending non-emitting context dependencies while only selected artwork emits |
| UA8-VAR04/05 | P1 confirmed: tiled G-code and `.rd` bypass caller-captured variable snapshots and never run successful-export advancement | pending direct/worker snapshot parity and exactly-once advancement only after all writes succeed; cancel/partial/failure/stale-document paths never advance |
| UA8-VAR06 | P1 confirmed: variable cut-setting fields render raw layer values rather than effective object/path bindings, `powerScale`, and overrides | pending canonical effective-operation resolution with core/store/compile parity |
| UA8-FONT07 | P1 confirmed: embedded font cache is keyed only by user-controlled font key, so a second project can reuse the first project's different bytes | pending content/project identity cache plus two-project replacement geometry/output fixtures |
| UA8-JIG08 | P2 confirmed: repeated Auto-fit appends deterministic reused IDs to `artworkOrder` | pending uniqueness and source-order compile assertions across repeat/save/reopen |
| UA8-JIG09 | P1 confirmed: Auto-fit computes one first-outline fit and reuses it for rotated/mixed outlines via transformed AABB, which can place emitted artwork outside later physical outlines | pending per-outline local-geometry fit with 45-degree and mixed-size fixtures |
| UA8-JIG10 | P2 confirmed Frame-only conflict: Quick Nest silently falls back at 32 items/250k work and can falsely report no fit | pending removal of the cap/refusal; asynchronous progress/cancel is allowed, but no performance policy may suppress valid output |
| UA8-JIG11 | P2 confirmed: review attribution selects the first object in a layer rather than the object owning an override bucket | pending compiled-bucket source identity and distinct-override review fixtures |
| UA8-VAR12/13 | P2 confirmed: ordinary variable advancement observer is armed after Start and can miss a short stream; CNC supervised recovery never arms advancement | pending pre-first-write/artifact ownership with receipt reconciliation and exactly-once recovery completion |
| UA8-VAR14 | P1 confirmed: deferred CSV reads lacked picker-request/document/unmount ownership and could overwrite a newer file or project | merged through PR #716: every Import invocation owns a distinct ephemeral picker and immutable component/request/document claim; only the newest exact claim may publish, while stale selection/read success or failure silently no-ops after another picker, document replacement, or unmount and current read failures receive nonblocking feedback; independent ownership/race and repository-policy reviews found no remaining defect; focused unit 3 files / 18 tests, exact picker-path E2E 1 test, application and E2E typecheck, scoped lint/format, diff/file-size/export checks, the full product-tree release gate (1,849 files / 11,721 tests, 14 files / 22 tests intentionally skipped, 41 release-integrity tests, 2,416-module web/PWA build, and Electron build), exact-head hosted checks, post-merge Browser/full CI, and automatic Cloudflare Pages run 33582770083 are green |
| UA8-VAR15 | P2 confirmed: full safe-integer sequence range overflowed `end-start+1`; probe `[0, MAX_SAFE_INTEGER]`, current 0, next 1 returned 0 | merged through PR #717: bounded record/serial wrap converts each accepted safe integer to private `BigInt` arithmetic before span, signed-stride, and positive-remainder calculation, then returns the bounded safe `number`; stale-current entry and unbounded serial semantics remain unchanged, with no new cap/refusal; combined sequence/batch/control/persistence matrix 5 files / 27 tests plus a deterministic exact oracle and independent 50,000-case challenge are green; the exact final tree passed `pnpm release:check` with 1,849 files / 11,730 tests, 14 files / 22 tests intentionally skipped, 41 release-integrity tests, 2,416-module web/PWA and Electron builds, and every static gate; exact-head Chrome UX smoke and full CI are green, and post-merge main/Pages verification remains pending |
| UA8-VAR16 | P2 confirmed adjacent persistence defect: enabling Wrap near `MAX_SAFE_INTEGER` stored an unsafe hidden `serialEndValue`; the control displayed a normalized safe value while canonical Save and autosave both rejected the raw project | merged through PR #717 in the same slice: the enabled Wrap endpoint uses the ordinary `start + advance` result only when it is a safe integer and otherwise stores Start, matching the already-rendered fallback without disabling, capping, or refusing the action; ordinary, exact-ceiling, overflow, manual-save, and autosave regressions are included in the 5-file / 27-test focused matrix |
| UA8-TXT16 | P1 narrowed after exact-source challenge: exact NFC/NFD header identities select the correct distinct column, refuting the original wrong-column claim; a unique canonically equivalent header still failed lookup when code units differed, ambiguous equivalent headers lacked truthful feedback, and raw joined literals/CSV values remained unnormalized and generated different geometry | implemented on `codex/fix-variable-text-unicode-identity-20260902`: exact code-unit identity wins, exactly one NFC-equivalent fallback resolves, multiple no-exact equivalents report compile-integrity ambiguity, compatibility-only NFKC forms stay distinct, and values normalize once only after the final join; generated non-NFC columns use lossless `csv-json`, while legacy raw tokens and imported/project NFC/NFD headers, records, and token identities remain byte-distinct; prepared split/composed output is identical; focused matrix 5 files / 26 tests, typecheck, scoped lint/format, diff/file-size/export gates, direct Unicode probes, and independent final review are green; full release and hosted integration remain pending |
| UA8-TXT17 | P2 confirmed: editing or materializing moved path text resets its transform to guide origin | pending persisted guide-relative user offset with edit/evaluate/save/reopen/compile parity |
| UA8-FONT18 | P2 confirmed: replacing an imported font leaves old random-key bytes until the unrelated 32-font persistence refusal | pending transactional pruning of only unreferenced old fonts; shared references and undo retained; the numeric cap is not the remedy |
| UA8-TXT19 | P2 confirmed: tracking/alignment counts UTF-16 units while OpenType places shaped glyphs; `fi` shaped to one glyph but received an extra 2 mm tracking shift | pending measurement from the exact shaped glyph sequence with ligature, combining, and supplementary fixtures |
| UA8-TXT20 | P2 confirmed: unsupported characters silently compile as `.notdef` glyph 0 | pending truthful nonblocking Preview/Job Review warning; never a Frame/Start refusal |
| UA8-TXT21 | P1 confirmed for reproduced scope: Hebrew/mixed-bidi and bundled-Poppins Devanagari strings are sent through logical-order `opentype.getPath` without bidi or complex-script shaping, producing wrong source geometry | pending a source-backed shaping pipeline with Hebrew/bidi and Devanagari regressions; Arabic was not generalized, and visual/font fidelity remains perceptual qualification |
| UA8-TXT22 | P2 confirmed: canvas selection/faint Preview artwork/out-of-bounds overlays can use template geometry while preparation uses the resolved current record, and Job Review omits the resolved record identity | pending one captured variable snapshot/identity across prepared visual and review consumers without consuming records |
| UA8-TXT23 | P2 confirmed disclosure gap: generic Date/Time fields emit UTC, so local operators can see a prior date/time with no UTC label | pending truthful UTC labeling or an explicit repository-backed timezone contract; timezone choice itself remains product policy |
| UA8-TIME21/22 | P2 confirmed: duration formatting produces `1m 60s`/`59m 60s`, and active line progress can round to 100% before terminal settlement | pending total-first duration rounding and active-progress maximum 99 until completion |
| UA8-TIME23 | P2 confirmed: Pause freezes streamer/live countdown before realtime pause/parking settles | pending truthful pausing/parking timing state and coherent timeout/failure restoration |
| UA8-TIME24 | P2 confirmed: Job Review's semantic estimator omits deterministic emitted spindle `G4` dwell | pending exact emitted-program timing when evidence exists, otherwise explicit unavailable disclosure; manual pauses remain indefinite |
| UA8-TIME25 | P2 confirmed: calibration scales the pre-run estimate but Start seeds the exact live plan at uncalibrated pace 1, producing a model jump | pending calibrated motion seed or explicit model-transition disclosure; dwells remain unscaled |
| UA8-TIME26 | P1 confirmed software defect: pre-run and initial live timing omit the deterministic serial last-byte floor; a 350077-byte/20008-line fixture estimated 0.600 s versus a 30.388628 s 115200-baud 8N1 floor before ACK/controller delay | pending byte/RX-aware floor shared by Review and initial live timing; controller processing and physical execution remain separate external evidence |
| UA8-TIME27 | P1 confirmed: general pre-run CNC timing still diverges from emitted peck, helix, path3d, entry/retract, and pass-transition programs; PR #710 fixed represented-coordinate/emissionless subcases only | pending emitted-program-derived deterministic timing with parsed-output parity within the repository tolerance; do not mark broader CNC estimation already fixed |
| UA8-TIME28 | P1 confirmed: emitted deterministic `G4` and indefinite manual `M0` are both absent from Job Review timing | pending every emitted dwell in the deterministic total and explicit excluded/unknown manual-pause duration |
| UA8-TIME29 | P2 confirmed: requested fractional feed is timed before emitter whole-number rounding, so values such as 1.49 can estimate against F1 bytes incorrectly | pending one formatted emitted-feed authority across estimate, Preview, and output |
| UA8-TIME30 | P2 confirmed: `continueToolChange()` advances the persisted controller-ACK counter for a host-swallowed `M0` that was never written or acknowledged | pending separate host-barrier and controller-receipt counters; preserve the intentional supervised Continue flow |
| UA8-TIME31 | P2 confirmed: Image Studio ink/time uses an independent proxy; Preview allocates category time by length rather than each operation's emitted feed; active overrun can remain `~0s`; G-code Inspector uses an undisclosed fixed planner profile | pending canonical prepared timing or explicit assumptions per surface, with sparse-raster, mixed-feed, overrun, and configured-profile fixtures |
| UA8-BATCH-N1 | narrowed/test gap: absolute translation can change an optimizer's internal nearest-neighbor order, but the current contract guarantees piece-complete jig grid order rather than identical internal traversal | add raw stored/compiled source-order fixtures before changing behavior |
| UA8-BATCH-N2 | duplicate/already fixed only in narrow scope: multi-object topology is UA8-GEO1; PR #710 owns represented coordinates/feed, emissionless passes, and its exact path3d/helix subcases, but not UA8-TIME27 general emitted-program timing | no duplicate implementation; retain the broader estimator regressions |
| UA8-BATCH-N3 | contract/policy: Preview and Frame intentionally capture separate current-time snapshots; Frame-to-Review-to-Start retains exact-artifact parity, so no same-clock defect is filed | preserve; UTC disclosure is UA8-TXT23, shaping is UA8-TXT21, and deterministic serial throughput is UA8-TIME26 rather than externalized |

### Follow-up verification state

- Regression-first evidence: the initial six-file run passed 18 legacy tests and failed all nine new
  defect assertions. After the adversarial Clipboard and Array ownership repairs, the exact-current
  cross-consumer matrix passes 28 files and 157 tests. TypeScript, changed-file ESLint, scoped Prettier,
  `git diff --check`, raw/report-only file-size checks, and the public-export no-growth ratchet pass.
  Three independent read-only reviewers returned clean after freezing the repaired tree. The exact-final
  product-source snapshot then passed `pnpm release:check`: typecheck, full source and Electron lint,
  repository-wide Prettier, ADR numbering, seven action-pin checks, production-license closure (52
  packages/eight licenses), 1,835 passed Vitest files plus 14 skipped, 11,614 passed tests plus 22
  skipped, 41/41 release-integrity tests, the 2,404-module web/PWA build (172 precache entries),
  Electron-main build, raw and report-only soft file-size checks, and the 207-export scene-barrel
  no-growth ratchet. Only these evidence lines changed after that terminal gate.
- PR #710 merged at `0a29540d9319958e35bfccc5f261edeed66cea82`. Exact-main Chrome UX smoke
  run 33504650137, exact-main full CI run 33504650074, and automatic Pages run 33507899422 are green.
  The publish step recorded exact deploy SHA `0a29540d`; the unique deployment, production alias, and
  default Pages alias each returned HTTP 200 with the same `assets/index-DfGlib0o.js` asset.
- The command/app-shell/diagnostics and camera/rotary side audits have independently reproduced
  current-main candidates, but their implementation belongs to later coherent slices. Their final
  classifications will be appended without rewriting this design-state evidence.
- No device, camera, controller, provider mutation, manual deployment, material cut, air-cut,
  perceptual comparison, or reference-CAM qualification was performed.

### Geometry/output slice integration verification

- The current branch starts from the exact PR #711 merge `26745bc7a36adc9d6890d54aa3f906330d32df6b`.
  The corrected implementation was reconstructed against that main revision; no donor commit was
  cherry-picked and no donor worktree was modified.
- Regression-first coverage passes 18 focused files and 120 tests. `pnpm typecheck`, full source and
  Electron lint, repository-wide Prettier, `git diff --check`, raw/report-only file-size checks, and
  the public-export no-growth ratchet pass. The over-soft Weld planner was split into a 223-line plan
  and 158-line binding-ownership module before release verification.
- The exact-final product-source snapshot passed `pnpm release:check`: typecheck, full source and
  Electron lint, repository-wide Prettier, ADR numbering, seven action-pin checks, production-license
  closure (52 packages/eight licenses), 1,841 passed Vitest files plus 14 skipped, 11,667 passed tests
  plus 22 skipped, 41/41 release-integrity tests, the 2,411-module web/PWA build (172 precache entries,
  11,193.37 KiB), Electron-main build, raw and report-only soft file-size checks, and the public-export
  no-growth ratchet. The first full-suite attempt had one untouched camera proxy `/health` timeout;
  that exact file then passed 13/13 in isolation, passed 10/10 consecutive isolated invocations, and
  passed 13/13 in 363 ms inside the clean full-gate rerun. No speculative camera change was made.
- Three independent read-only review lanes challenged the slice. Their reproduced transformed-order,
  canonical-curve, reflected-stroke, sublayer/material, no-output/orphan, shared-run, id/color-alias,
  and later-engine-failure findings are repaired and pinned. The exact-current final reviewer found no
  remaining source-confirmed defect. Its cross-object NonZero candidate was refuted against PROJECT
  F.1, WORKFLOW F.1, ADR-286, and the ADR-270 amendment, which deliberately retain EvenOdd pooling
  between objects.
- Exact-main Browser smoke run 33523172646, full CI run 33523172662, and automatic Pages run
  33527490475 for PR #711 merge `26745bc7a36adc9d6890d54aa3f906330d32df6b` are green. The
  geometry/output branch hosted exact-head checks, PR review, merge, and post-merge publication remain
  pending; no manual deployment was performed. Only this evidence text changed after the terminal
  local release gate.
