# Weekly PR audit remediation - 22 October 2026

The weekly audit inventoried 173 pull requests and recorded 20 confirmed findings. This remediation started from `origin/main` at `17efcd7f4f1b314d46d7ae7c7d6ea18ab3b86dc4`, then incorporated current main at `1bb2b885e179ec2952e9b2fb7ea9c4c36f7c758d` after another session merged #1354 and #1355. Each finding below has a repair or an operational disposition. The photo repair was pushed separately to its existing feature PR.

## Finding disposition

| ID | Audited PRs | Repair and regression evidence |
| --- | --- | --- |
| M1 | #1287 | Stock GRBL known-invalid blocks are interpreted atomically before modes/tool events commit. `G91 F-1` from X100 no longer changes the following absolute X10 move to X110. Original executable bytes remain unchanged; buffered-execution risk is disclosed. |
| M2 | #1287, #1368 | Stock GRBL radius tolerance accepts the radius-500 / 0.2 mm mismatch case and preserves its endpoint for the following relative move. Invalid geometry and missing active-plane axis words reject the whole block before modal changes in G17/G18/G19, preserving the subsequently merged plane support from #1368. Unknown or displaced work positions cannot prove geometric rejection. |
| M3 | #1351, #1358 | Marlin M106/M107 validate repeated, spaced and lowercase P selectors before fan-zero projection. Ambiguous fan commands cannot silently prove laser-off. |
| M4 | #1351 | External timing uses the active controller override for laser and CNC. Saved Smoothieware plus connected Marlin uses the application's 15-block Marlin model, not the 32-block saved-device model. |
| M5 | #1287 | Unsupported G10/L warnings remain visible even without a specialized L2/L20 warning. |
| M-DOC1 | #1326 | Corrected the controller design audit's Idle timer, missing-response assumptions, Marlin resend acknowledgement ownership and boot-lock inference. No proposed recovery protocol was implemented. |
| DOC1 | #1250 | Numbering rollback retains placement/output-scope changes and matching persisted job setup, with dirty state. This also preserves acknowledged machine-origin updates. Tests cover Cancel and no-op actions. |
| DOC2 | #1250 | Save commits the visible numbering order and retires its rollback before any asynchronous picker/write. Cancel cannot later restore different content while leaving it clean; failed saves remain dirty. |
| DOC3 | #1354 | Collinearity, rather than signed-area cancellation, identifies closed strokes. Bowtie lobes retain filled offset semantics under both fill rules. #1354 merged while the repair was being prepared; the correction and regressions are included in this combined PR. |
| DOC4 | #1308 | Weld reports absorption only after same-batch coverage proves that no region survives. Intersection-only bridges, including a narrow surviving bridge, are not falsely absorbed. The command-availability path avoids the extra coverage work. |
| DOC5 | #1352 | The existing insertion guard throws on commit-time font overflow, allowing Add Text to preserve its draft and retry after Undo. Tests exercise the mounted form, not only the store. |
| UI-P2-1 | #1252 | Jig rebase checks canonical scene integrity; duplicate operation colours are refused without publishing an unreadable project. |
| UI-P2-2 | #1252 | Jig rebase and final Save check combined scene budgets. Two individually valid branches cannot publish 257 operations. At-limit success and correction/retry are tested. |
| UI-P2-3 | #1253 | Proportional corner resizing follows either pointer axis using proportional travel, including shrinking and non-square selections. Opposite anchors and free resizing retain their meaning. |
| UI-P2-4 | #1253 | Tiny selected jig artwork retains an interior move target; exterior resize handles remain usable. A mounted canvas pointer test verifies movement without resizing. |
| UI-P2-5 | #1269 | Material cells render their generated dimensions, including extreme aspect ratios. Stroke-inclusive geometry is compared with generated output. Spacing is visibly labelled schematic. |
| UI-P2-6 | #1362 | A per-dialog request token prevents stale photo success or failure from replacing newer image, outline or width state. Fixed on #1362's feature branch with out-of-order and independent-session tests. |
| R1 | #1339 | Live `production` permits the `main` branch only. Both Pages secrets were added there; the user entered the token directly into GitHub. The two repository-level copies were removed after verifying environment secret presence. No credential value is stored in this report. |
| R2 | #1280 | Closed the obsolete website proposal because it contradicted the current Free desktop policy. The branch was preserved. No licence gate was enabled. |
| R3 | #1254 | A missing platform feed after a verified candidate produces `failed`, not `up-to-date`. Recovery restores the verified offer without duplicate announcements. macOS and Linux regressions pass. |

## Independent re-audit

Different reviewers examined machine interpretation, document rollback/insertion/geometry, jig and material-preview changes, and the updater/photo repairs. The re-audit found one further path within the rejected-block finding: a stock GRBL arc lacking an active-plane axis word still committed same-block G91/M4. Three normalization-first regressions reproduced it; the correction and a valid full-circle control now pass. The reviewer independently reran the reproduction against the correction.

The numbering implementation was revised during review: blocking all placement edits would also block UI synchronization after an acknowledged origin change. The final implementation preserves those edits in the numbering rollback snapshot. Its independent review traced the store, Save/New/Open and job-setup persistence paths.

No additional confirmed defect remained in the reviewed repair paths. This is a bounded re-audit, not a claim that the entire application or every open feature PR is defect-free.

## Verification and separate branches

- Machine interpretation: broader cohort **262 tests / 25 files** passed; final follow-up **97 tests / 5 files** passed. These cohorts overlap.
- Document/geometry: **192 tests / 27 distinct files** passed, counting the latest result per file.
- Jig/material/shared resizing: **37 final focused tests** passed, with the related existing suites also exercised.
- Platform updater: **10 tests** passed for the final helper extraction.
- Photo PR #1362: **43 tests / 9 files** passed after merging current main; its photo branch typecheck and scoped lint passed before the unrelated main merge. Published head: `b80728df096eb2a3ddc1276e3313df11aad64583` (repair commit `4a7e4ef5c`).
- Prepared geometry repair: **40 tests / 5 files** passed at `8c564666ab027f4aeb0d025f3a4db0136bafd310` (repair commit `0a7623a82`). Its branch push happened after #1354 merged at its older head, so that push alone did not repair main. The combined PR incorporates the correction after merging the updated main.
- Main repair branch: renderer typecheck, desktop renderer bundle, Electron build/lint, formatting, privacy, ADR numbering, action pins, workflow secret scopes, production dependency licences, file-size limits, soft-size policy and public index exports passed before the final main reconciliation. Focused reconciliation and browser results, plus current-head hosted checks, are recorded on the PR.

Local diagnostic scripts, original failure logs and lane reports are retained under `build/weekly-pr-fixes-20261022/`; they are not product source. Local lint excludes that generated evidence folder and the preceding audit's generated corpus. Clean hosted CI validates the committed tree without those local diagnostic files.

The original audit reports remain separate evidence. Findings on other open branches (#1358/#1368) are repaired on current-main source here; those branches must incorporate these changes when integrated. The source repairs do not certify those entire feature branches.

## Operational limits

GitHub secret metadata confirms scope and presence, not the token's runtime validity. No deployment was triggered to test it. Existing provider tokens were not revoked. No PR was merged, no app was released, and no physical controller was operated. Frame remains the sole ordinary Start policy gate; existing executable bytes and policy-warning boundaries are preserved.
