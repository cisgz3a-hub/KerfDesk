# T04 Scan Offset Test — auditor report
Tree: origin/main @ 8d92bd143. Command id: `tools.scan-offset-test`.

## Map
- **Menu → handler:** `app-menu-groups.ts:128` → `ScanOffsetCommandDialog.tsx` (reads `project.device`, passes `maxFeed` and `scanningOffsets.length > 0`) → `ScanOffsetCalibrationDialog.tsx` (mode select, 9 boxes, its own validation) → `generateScanOffsetCalibrationPattern` (`src/core/job/scan-offset-calibration-pattern.ts`) → `replaceSceneWithGeneratedScene` (one undo step) + success toast. Laser-only (`machine-command-gate.ts:34`).
- **Coupon:** one Fill layer per swatch, `scanline`, bidirectional, angle 0, `scanOffsetCalibrationMode` = mode. Baseline adds `bidirectionalScanOffsetMm: 0` and `allowUncalibratedBidirectionalScan: true`. Speeds = linspace(max→min), capped at `device.maxFeed`, then floored (`effectiveGcodeFeedMmPerMin`); labels from the same value.
- **Output path:** compile caps speed at `maxFeed`; `grbl-fill-emission.ts:76` and every twin take `layer offset ?? offsetForSpeed(table, emitted F)` (`scan-offset.ts:69-102`); `scanRowShiftAlongTravelMm` moves every row of a two-way fill half the value along its own travel (`scan-offset.ts:116-128`). Direction gate: `scan-direction-policy.ts:24-53` (baseline always two-way; verification two-way only with a non-empty table on require-verified profiles).
- **Apply step:** Machine Setup → Raster Diagnostics → `MeasuredScanOffsetApply.tsx` (rows from `scan-offset-measurement-draft.ts`, format convert in `scan-offset-measurement-format.ts`: LightBurn Line Shift ×2, mm/s ×60). Apply replaces `scanningOffsets` with the non-blank rows and sets status `pending`. Limits `scan-offset-profile.ts:38-58` (|offset| ≤ min(5 mm, 1 % of shorter bed axis)).
- **Governing:** ADR-052 (+ Amd 1 placement, Amd 2 half each row, 2026-11-08), ADR-445 (emitted-feed labels), ADR-238 Amd 2 (generic 5 mm runway minimum), ADR-228/565. WORKFLOW F-SO1 (`WORKFLOW.md:6139-6170`).
- **Changes since 2026-10-16** on these files: f7e9ac9f0 (#1623, ADR-052 Amd 2: every row moves half), 71ec3978f (Z4-P1-1, curved fill runs shifted as one), ab3226fd1 / 6059445ef (helper sharing, lint), 59069ea1c, 4fdca81b3 (shared calibration label changes). Dialog and generator logic otherwise unchanged.

## October register re-check
Row #16 (`2026-10-16-tools-quality-register.md:50`, `2026-10-15-tools-create-calibrate.md:38`):
- **Baseline vs verification separated:** still fixed. Baseline with a 3-point table on the device burns 0.0000 mm separation on all 5 swatches; verification burns the table value (below). Baseline stays two-way on a require-verified 4040 profile with a pending table.
- **Labels bound to the emitted speed:** still fixed. In all 21 decoded configurations each swatch carries exactly one F word, equal to its label (capped 9000–12000 → `6000`×3; 4000–9000 → 6000/6000/5666/4000; 1234.5–1234.9 → `1234`; 4555.56 → `4555`).
- **10-swatch cap from a million-step request:** still fixed. `steps: 1e6` → 10 swatches, endpoints 5000 and 1000.

## Checks run
| Check | Method | Result |
|---|---|---|
| Every swatch's F, S, row count, and forward vs reverse row X positions, 21 configurations: dialog defaults baseline (empty and populated table), verification with table, 7 steps 500–5900 (below first / between / above last point), sign-crossing table (−0.24 @2000, +0.16 @4000), empty table, speeds above max feed, fractional speeds, equal speeds, 1 step, 1e6 steps, 10 steps, rear-right origin, overscan 0, 1×1 mm swatch at 0.05 interval, 4040 profile (baseline empty, verification pending, verification empty, baseline pending), origin 3.3,7.7 | Own modal G-code decoder on real `prepareOutput` → `emitPreparedGcode` (`zz-t04/harness.ts`, `t04-burn.test.ts`, log `t04-burn.log`); per row, displacement along its own travel vs the design edge; independent ADR-052 lookup (`oracleOffset`: floor F, linear between, from rest below, clamp above) | All pass. Baseline: every row on the design (0.0000) in every case. Verification: forward and reverse rows each move exactly table/2 along travel; worst error 0.0005 mm = 3-decimal coordinate rounding (e.g. 4100 mm/min: table 0.245 → rows 0.1225 → emitted 0.123). Separation = table value with sign (−0.216 at 1800 on the sign-crossing table). 20 rows (10 fwd/10 rev) per 10 mm swatch at 0.5. S120 = 12 % of 1000. No non-horizontal lit moves, nothing outside the swatch X span ±1 mm |
| Apply → device table → next real job | jsdom: real `MeasuredScanOffsetApply` on the live store, operator types −0.08/−0.15/−0.2/blank/−0.3 against default rows 1000–5000; then a 7-layer ordinary Fill job (no calibration flags) decoded (`t04-apply.test.tsx`, `t04-apply.log`) | Table `[1000:−0.08, 2000:−0.15, 3000:−0.2, 5000:−0.3]`, status pending, one undo step; blank row dropped. Job rows move table/2: 500 → −0.02 (from rest), 1500 → −0.0575 (interp), 3500 → −0.1125, 6000 → −0.15 (clamped). Worst error 0.0005 mm (rounding) |
| LightBurn Line Shift / mm/s entry | Same harness, LightBurn convention + mm/s, entries 0.05 @25 mm/s, 0.12 @75 mm/s | Stored 0.1 @1500, 0.24 @4500; real job moves each row by exactly the Line Shift (0.05 at 1500; 0.085 at 3000 interpolated; 0.12 clamped at 6000) — LightBurn's "moves each line by the amount you specify" |
| Apply boundaries | Same harness | 0 accepted; 9 mm refused ("between −4 and 4 mm for this bed"); 6001 > max refused; 0 and −500 speeds refused; duplicate 2000 refused; all-blank → Apply disabled with "Enter at least one…"; `Infinity` is sanitised to blank by the number input (no error, row ignored) |
| Undo / Redo / Save–reopen | Same harness + `serializeProject`/`deserializeProject` | Generate → 10 objects / 6 layers; Undo restores scene and device byte-equal; Redo equals the generated scene. Apply Undo → `[]`/no status; Redo restores table + pending. Reopen keeps table and pending; G-code byte-identical (1847 bytes) |
| Cancel | Same harness | `onClose` called, project object identical, undo depth 0, not dirty |
| Dialog validation probes | Same harness (`t04-apply.log`) | Blank/garbage Power, blank Overscan, blank Gap, Line interval 0.01, Swatch width 0.5, Swatch height 1e9: no error. Steps 2.5/11, Min speed 0: refused. Max 1e9: ceiling warning (see P3-1, P3-4) |
| Edge outputs | `t04-edge.test.ts`, `t04-edge.log`, `overscan0.gcode` | Power 0 → only labels burn (0 swatch rows). Interval 0.01 → burns 0.05. Width 0.5 → burns 1 mm. Overscan 0 → generic 5 mm feed-matched runway still applied (ADR-238 Amd 2), so not harmful |
| Coupon process recipe applied to other artwork | `t04-recipe.test.ts`, `t04-recipe.log` (real `captureProcessRecipe` / `applyProcessRecipe`, 4040 profile) | See T04-P2-1 |
| Repo suites | `scan-offset-calibration-pattern`, `scan-offset`, `ScanOffsetCalibrationDialog`, `MeasuredScanOffsetApply` (+ `.lightburn`), `project-scan-offset` | 6 files, 67 tests pass |
| LightBurn oracle | Fetched docs.lightburnsoftware.com/latest/Guides/ScanningOffsetAdjustment | "Enter half the measured distance"; 50×10 mm rectangle, 0.5 mm interval, overscan ≥5 %: KerfDesk defaults match. Docs give no sign convention and no off-table rule |

## Findings

### T04-P2-1: A process recipe saved from a coupon swatch carries the uncorrected-baseline mode into ordinary artwork, dropping the calibration table and bypassing the require-verified one-way fallback
- **Severity P2:** a wrong burn (uncalibrated zipper) and a bypassed profile safety policy, but reached only by saving a recipe from a coupon swatch; Job Review shows a warning-tone fact ("Bidirectional — uncorrected calibration baseline (explicit 0 mm)", `job-review-live-rows.ts:296`), so not silent.
- **Where:** coupon layers set `scanOffsetCalibrationMode: 'baseline'`, `bidirectionalScanOffsetMm: 0`, `allowUncalibratedBidirectionalScan: true` (`scan-offset-calibration-pattern.ts:187-190`). Recipes copy the mode deliberately: `capture-process-recipe.ts:85-87`, `process-recipe-operation.ts:22-24` and `:47-49`, `apply-process-recipe.ts:60-62`. Policy: `scan-direction-policy.ts:36-38` returns two-way for any `baseline` layer before any status check. No ADR or WORKFLOW text says the calibration mode should travel with a recipe (WORKFLOW F-SO1 and the Process recipes paragraph at `WORKFLOW.md:5995` are silent; the field came in with 77ba22f65 / 08afe91ca).
- **Repro:** `C:\Users\stolk\kd-t1\zz-t04\t04-recipe.test.ts` (log `t04-recipe.log`). 4040 profile, table [1000: −0.2, 5000: −0.4]. A 30×5 mm Fill at 3000 mm/min on an ordinary layer, then "Save selected process" from a 3000 mm/min baseline swatch and "Apply recipe to selection" on that rectangle.
  - Table **verified**: ordinary layer rows move −0.15 each (table −0.3 at 3000). After applying the recipe: **0.0000** — the calibration is gone, the full uncorrected zipper burns. Applied layer: name "Scan offset 3000 mm/min", mode baseline, offset 0.
  - Table **pending** (require-verified): ordinary layer runs one-way (10 fwd / 0 rev, the safety fallback). After the recipe: **two-way, uncorrected** (5 fwd / 5 rev, 0.0000).
- **Oracle:** ADR-052 / WORKFLOW F-SO1: "Baseline intentionally emits uncorrected bidirectional rows" — for the coupon. A require-verified profile with a pending table must run one-way (`MeasuredScanOffsetApply.tsx:147-149`: "Profiles requiring verified offsets use one-way scanning while pending"). Expected for ordinary artwork: −0.15 per row (verified) or one-way (pending).
- **Suggested fix:** drop `scanOffsetCalibrationMode` (and the baseline's explicit 0 / allow flag) when capturing a recipe from a calibration layer, or refuse "Save selected process" on coupon swatches; at minimum warn on Apply.

### T04-P3-1: Blank Power, Overscan and Gap are read as 0 with no message; Line interval and Swatch size below the box minimum are silently raised
- **Severity P3:** a dialog-validation gap; nothing burns wrong without the user seeing it (0 % power burns labels only).
- **Where:** `ScanOffsetCalibrationDialog.tsx:289-292` (`numberValue` maps `''`/NaN to 0), `:269-271` (power 0 is valid), `:283-285` (overscan/gap 0 valid), `:273-282` (only checks > 0, ignoring the 0.05 and 1 mm minimums in `FIELD_SPECS:47-49`); generator clamps at `scan-offset-calibration-pattern.ts:74-85`. The sibling Material/Interval dialogs refuse a blank box with "enter a number" (`calibration-draft-validation.ts:17`).
- **Repro:** `t04-apply.test.tsx` probes (log `t04-apply.log`): Power `''` → no alert, Generate enabled; `t04-edge.log`: power 0 → 0 swatch rows burned, only labels; interval 0.01 → 0.05 burned; width 0.5 → 1 mm burned.
- **Oracle:** the dialog's own `min` values and the sibling dialogs' blank-box rule.
- **Suggested fix:** use `calibration-draft-validation` here (blank = "enter a number", min/max per field), or name the clamped value.

### T04-P3-2: Steps = 1 burns only Max speed; Min speed is dropped without a message
- **Severity P3:** wording/feedback; the label shows the speed that burned.
- **Where:** `scan-offset-calibration-pattern.ts:231-232` (`linspace` with count 1 returns the start, i.e. max); dialog shows no note.
- **Repro:** `t04-burn.log` case "baseline 1 step min 1000 max 5000": one swatch, F5000, label `5000`.
- **Oracle:** the dialog accepts a Min/Max range; a user asking for one step at 1000–5000 has no way to know which end burns.
- **Suggested fix:** note "one step burns Max speed", or disable Min speed when Steps is 1.

### T04-P3-3: WORKFLOW F-SO1 and the candidate-table caption still say only reverse rows move
- **Severity P3:** documentation and wording drift after ADR-052 Amendment 2 (#1623).
- **Where:** `WORKFLOW.md:6166-6170` ("A saved table moves only the commanded reverse rows… can reach up to the offset past the anchor"); `MeasuredScanOffsetApply.tsx:193` (caption "Candidate reverse-row correction table"). READ ONLY.
- **Repro:** the decoded G-code (`t04-burn.log`, `t04-apply.log`) shows forward and reverse rows each moving half the value; Amendment 2 says rows reach half the value past each side.
- **Oracle:** ADR-052 Amendment 2 Decisions 1 and 4; the other UI strings already say "each row moves half" (`ScanOffsetEditor.tsx:41-42`, `ScanOffsetMeasurementFormatControls.tsx:45`, `MeasuredScanOffsetApply.tsx:52-53`).
- **Suggested fix:** rewrite item 7 for half-each-row (rows reach half the value past each side) and rename the caption "Candidate scan-offset table".

### T04-P3-4: Swatch height has no upper bound; a 1e9 mm swatch exhausts memory during output preparation
- **Severity P3:** needs an absurd entry; in the app the preparation runs in a worker (`live-job-estimate.ts:83,112`), so the effect on the window is READ ONLY. The same uncapped swatch size exists in the sibling calibration dialogs.
- **Where:** `ScanOffsetCalibrationDialog.tsx:47-48` (`max: undefined`), `:273-280`; no hatch row budget in the fill compile path.
- **Repro:** first version of `C:\Users\stolk\kd-t1\zz-t04\t04-edge.test.ts` with `swatchHeightMm: 1e9` (2e9 rows at 0.5 mm): the Vitest worker died with "JavaScript heap out of memory" at 4 GB inside `prepareOutput`. The dialog shows no error for `1e9` (`t04-apply.log`). 1e4 mm on a 400 mm bed prepares 20,000 rows without complaint.
- **Oracle:** the bed is 400 mm; a coupon swatch larger than the bed can never burn.
- **Suggested fix:** cap swatch width/height at the bed size (or a fixed 100 mm) in the dialog.

## Not a defect / limits
- **Below-the-table behaviour** is linear from rest, not clamped (500 mm/min with a 1000:−0.08 first point gives −0.04). ADR-052 chose this ("lag distance is ~proportional to speed"); LightBurn documents no off-table rule. Above the last point it clamps, as decoded.
- **Sign:** a positive value moves each row along its own travel, so firing lag needs a negative entry and the coupon gives no direction cue. Known as D8-P3-5 (`docs/audits/2026-10-22-controller-v3/D8-ctl-scan-offsets.md:282`), still open (no direction mark; tutorial still "Measure the signed gap", `calibration-tutorials.ts:111-113`). LightBurn's docs give no sign; D8 sourced LightBurn's sign from a staff forum post.
- **Verify saved table on a require-verified profile with an empty table runs one-way** (5/5 swatches 10 fwd/0 rev in my decode) while the dialog promises an uncorrected comparison: known D8-P3-3, still open.
- **Overscan 0** on the coupon still gets the generic 5 mm feed-matched runway (ADR-238 Amd 2). At 5000 mm/min with 500 mm/s² the runway is shorter than the 6.9 mm acceleration distance; Job Review's scan-quality warning covers that (`scan-quality-warnings.ts:54-68`).
- **Duplicate swatch speeds** from a capped range are warned in the dialog; the apply panel refuses duplicate speeds.
- **Material preset (not process recipe) from a coupon layer** carries the explicit 0 mm local offset and the allow flag but not the mode; a local recipe offset is documented (WORKFLOW F-ML2, noted by D8), so not raised.
- **Not checked:** the Machine Setup draft path (Apply edits the draft; Save commits one undo; Cancel discards) — I drove the live-store path only; repo tests cover the draft. Rotary coupons, non-GRBL controllers (Moshi/K40/Ruida parity verified by C2 E-loop), the browser UI (memory gate: skipped by instruction).
- **Known re-encountered, not re-raised:** T01R-P3-1 (six boxes without a unit), T01-P3-2 (Generate replaces the design without notice; Undo restores exactly here too), D8-P3-3, D8-P3-5.

## Totals
Raised 5; P1 0; P2 1; P3 4; known 4 (T01R-P3-1, T01-P3-2 in the T1 ledger; D8-P3-3, D8-P3-5 in `docs/audits/2026-10-22-controller-v3/`).
