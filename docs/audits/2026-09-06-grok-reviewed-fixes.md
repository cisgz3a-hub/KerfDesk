# Selected Grok audit fixes, 6 September 2026

Base: `5918ef53fd91f6b33a4cd0766f2a3b7ba6991acc` (GitHub main rechecked before implementation).
Branch: `codex/grok-reviewed-fixes-20260906`. Work is isolated from the user's existing checkout.

The preceding read-only audit examined all 45 supplied IDs. This implementation selects reproduced
behavioural bugs and misleading controls; it does not accept every proposed diagnosis or physical
consequence in the supplied pack. In particular, upper-range scan-offset clamping is not established
as the critical cause of a physical zipper defect.

| Finding | Reproduced behaviour and correction | Main regression evidence |
| --- | --- | --- |
| KD-PWR-06 | Existing artwork overrides silently discarded a form's Dynamic choice and retained Constant/M3. Persist Constant/Dynamic/Auto, resolve them during compilation, and retain them across project schemas. Missing mode inherits the operation; explicit artwork Auto follows the device. | `object-properties-power-mode.test.ts`, `SelectedOperationInspector.ownership.test.tsx`, `project-scoped-operation-overrides.test.ts` |
| KD-PWR-04, bounded | The settings badge remained Approved after an artwork override or power-scale edit. Include operation settings, sublayers, artwork overrides, power scale and bindings in approval tracking. Existing exact-job rebuilding remains in place. | `JobReviewSettingsApproval.test.tsx` exercises real store edits after approval. |
| KD-JOG-01/09 | MPG takeover could leave the Jog owner permanently occupied; Cancel timeouts could be discarded without a visible error. Recover only through fresh planner settlement after MPG release, and publish cancellation failures. Fence stale cancellation and interrupted motion continuations. | `laser-store-jog-mpg-recovery.test.ts`, `laser-store-cancel-failure.test.ts`, neighboring cancellation/MPG suites. |
| KD-TRC-01/02/10 | Automatic detection looked like a manual 128 threshold, and one displayed area value represented two different filters. Expose automatic/manual/sketch detection and separate ink-speck area from contour/hole area, preserving untouched preset output. | `TraceSettingsControls.semantic.test.tsx`, `trace-options.test.ts`, production Chrome bitmap-to-trace flow. |
| KD-TRC-05 | A zero-paths retry could silently relax settings. Carry a typed notice through whole-image, crop/enhance, prepared preview reuse, vector/raster commit, and multi-file SVG export. | `TraceFallbackDisclosure.test.tsx`, `ImportImageDialog` tests, `multi-file-trace-action.test.ts`. |
| Scan coverage deltas found during the audit | Warnings rounded requested feeds while emitters floor whole-number feeds; lower-range copy falsely described endpoint clamping. Use the same feed representation as output and describe both table edges accurately. | Fill and raster tests emit F1000 from requested 1000.75, then test exact and fractional table boundaries; lower-range correction is checked independently. |
| KD-BIDI-06/11, KD-PWR-02/05, KD-SPD-02, KD-JOG-08, KD-TRC-03 | Clarify ignored non-finite offset overrides, pending calibration's one-way policy, controller-reference fields, laser power overrides, continuous/step jog semantics, and Edge Detection's closed outlines. | Existing preflight/calibration/override tests plus targeted Chrome calibration save/reopen and visual inspection. |

Code entry points: [artwork override storage](../../src/ui/state/object-properties-actions.ts),
[MPG settlement ownership](../../src/ui/state/laser-motion-operation.ts),
[trace detection controls](../../src/ui/trace/TraceDetectionControls.tsx),
[scan warnings](../../src/ui/laser/job-intent-warnings.ts), and
[settings approval](../../src/ui/laser/job-review/JobReviewSettingsApproval.tsx).

The new regression cases first failed against the old behaviour for power-mode storage, scan-feed
coverage and artwork approval. Tests exercise emitted output and real store/UI transitions, not
only replacement text. Independent review also identified the MPG release race with a delayed CNC
safe-Z phase; recovery must never make that interrupted phase eligible to continue.

No global power rescaling, firmware-setting writes, new scan/Start refusal, upper-range offset
extrapolation, or Offset Fill compensation was introduced. Frame remains the sole ordinary Start
policy guard under PROJECT non-negotiable 21 and ADRs 228/230/232/237. No hardware was operated.

## Verification record

- Focused parent checks: 41 tests passed across warnings, approval, overrides, calibration,
  controller diagnostics and preflight. Power-mode checks: 78 distinct tests passed, including
  actual settings-dialog submission and reopening.
- Trace checks: 113 distinct tests passed. Jog includes 20 new regression cases across ordinary
  recovery, cancellation failures, delayed CNC phases and replacement status waiters. Independent
  review of the corrected Jog lifecycle found no remaining blocker; a separate review of the
  parent changes resulted in more precise controller-reference and invalid-override wording.
- Chrome: both calibration draft/save/reopen flows and the bitmap-to-trace worker flow passed.
  The expanded trace check switches automatic/manual modes and checks the separate filter values.
  Its first run had the two Line Art expected filter values reversed in the test; correcting that
  fixture to ink-speck area 12 / contour area 2 made it pass. No production change was needed.
- Whole-project typechecking, UI/Electron lint, release-integrity tests (43), license checks,
  action pinning, ADR numbering, file-size/export checks, E2E typechecking and formatting passed.
- Full Vitest run: **1,929 files passed / 14 skipped; 12,328 tests passed / 22 skipped; no failures**.
  The skipped cases are existing opt-in perceptual audit/probe fixtures. All changed regression
  suites ran. Hashes of all 57 changed source/test files match the frozen verification snapshot.
- Production web and Electron main-process builds passed, followed by the final file-size check.
  All `release:check` components passed as staged commands. These are local source/build checks,
  not a packaged-runtime or publication result.
- The original checkout's HEAD, status and all 15 recorded file fingerprints remain unchanged.
- Hosted CI, deployment, packaged runtime, independent reference-CAM qualification, material tests,
  and hardware qualification have not been run for this branch.
