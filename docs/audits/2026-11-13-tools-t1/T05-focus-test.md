# T05 Focus Test — auditor report
Tree: origin/main @ 8d92bd143. Command id: `tools.focus-test`.

## Map
- **Command**: `src/ui/commands/command-families.ts:291-299` `focusTestCommand` → `enabled('tools.focus-test', …)` behind `guardedCalibrationAction` (asks before discarding unsaved work). Menu: `app-menu-groups.ts:129`. Laser-only: `machine-command-gate.ts:35` (hidden in CNC mode). `CommandShell.tsx:104, 209` opens `FocusTestDialog`.
- **Dialog**: `src/ui/calibration/FocusTestDialog.tsx` (8 fields, all labelled with units; validation via `focusTestOptionsIssue` + `focusTestProfileIssue` + `focusTestPowerIssue`; Generate → `replaceSceneWithGeneratedScene(generateFocusTest(options), true)`).
- **Core**: `src/core/job/focus-test.ts` (offsets rounded to 0.001 mm, one Line operation per sample carrying `focusTest.{offsetMm,travelFeedMmPerMin}`, Job Review warnings); `src/core/job/compile-job.ts:98-158` (carries intent to cut groups; refuses non-GRBL kinds, non-Line modes, raster on a focus operation); `src/core/output/focus-test-emission.ts` (wraps each sample: dark seek, `M5`, `G91`, `G1 Z±o F S0`, `G90`, `M3/M4 S0`, burn, dark return, mirror Z pair); `src/core/output/grbl-strategy.ts:364-365`; `src/core/output/focus-test-power.ts`; recovery refusal `src/core/controllers/grbl/focus-resume-issue.ts`; Job Review `src/ui/laser/job-review/focus-test-warnings.ts`; Frame identity `src/ui/laser/frame-focus-contribution.ts`, `frame-spatial-identity.ts`.
- **Governing**: ADR-602 (no amendments), WORKFLOW.md:1326 "Focus Test (ADR-602)", ADR-565 (Frame contract), ADR-237 (Job Review at Start), ADR-695 (dedicated rotary axis routing).
- **Since 2026-10-16**: implemented in fea623df3 (#1219 line), review fixes 2d59e55f7, 75fbaf425, 58be90b52; 48b58e7f6 (2026-10-17: Remove Focus Test Z action, cross-project paste strips intent, S0-power refusal, distinct colours, Job Review machine warnings lead); later only incidental edits (26ead0e8e dead exports, 59069ea1c, 6af46c61a, ADR-670 renumber touching shared files).

## October register re-check
Row 17 was "not implemented; permanently disabled". The follow-up (`2026-10-16-remaining-tools-and-focus.md`, `2026-10-16-focus-test-completion.md`) required a real implementation to cover coordinates, return pose, laser-state sequencing, controller capabilities and physical qualification, and listed its repairs. Each still holds on 8d92bd143:

| October requirement / repair | Evidence now |
|---|---|
| Relative Z only, no G92/probe/home/absolute Z | My decoder: 0 Z words in G90 across 24 emitted programs; only `G91 / G1 Z… / G90` triplets |
| Every completed sample returns to starting Z | Final Z = 0 µm exactly in every case (integer-µm sum), Z = 0 at every sample header |
| M5 before every Z move, S0 on it | 0 Z moves with laser on or modal S ≠ 0, all cases incl. M3 constant and Neotronics |
| G90 restored before any XY burn | 0 XY words while G91 in every case |
| Z feed capped by profile ceiling | maxFeed 200 → Z F200; 250.75 → F250 (dialog preview says 250 too) |
| Unsupported dialects refuse instead of dropping Z | Marlin, Smoothieware, Ruida, Lihuiyu (K40), Moshi: `focus-test-uncompilable`, no bytes |
| CNC reinterpretation refused; command hidden in CNC | `machine-command-gate.ts:35`; repo `focus-test-integration` passes |
| Non-Line / raster override refused | repo `focus-test-output`, `focus-test-compilation-failure` pass |
| 2–101 samples, 0.001 mm distinctness | Dialog: 0, 1, 102, 2.5, −3 refused; 5 × −0.001..0.001 refused; 101 accepted |
| Schema intent survives save/reopen; tampering rejected | Round trip byte-identical G-code; offset −1.3000001, 5000 and travel −300 rejected as invalid |
| Line-resume / start-from-line refuse nonzero Z | repo `focus-test-resume` passes |
| Second pass ineligible | repo `second-pass-focus-eligibility` passes |
| Legacy schema-17 `focusTest` stripped | repo `focus-legacy-migration-regression` passes |
| Frame identity (feed edit keeps, offset edit invalidates) | repo `focus-test-identity` passes |

## Checks run
| Check | Method | Result |
|---|---|---|
| Relative Z, net-zero return, laser-off Z, G90 before XY, G21 only, burn F after Z move, each burn's Z = its named offset | Own modal reader (`zz-t05/decode.ts`, exact integer-µm Z) over `emitGcode` for 29 cases (`zz-t05/t05-motion.test.ts`, log `t05-motion.log`, programs in `zz-t05/out/`) | All pass: defaults; grbl-compatible M3; Neotronics safe dialect; 7 × −1.3..2.9; 4 × 0..1 (thirds); 2 × −5..−1; 3 × 0.5..3; 101 × −1..1; 3 × ±0.0015; 6 × −0.0024..0.0026; 11 × ±1000; Z feed > ceiling; fractional ceiling; cut speed > ceiling; passes 3 (one Z pair wraps all passes, F1200 on all 27 burns); air M8; reversed layer order; rear-right origin; current-position placement; chuck rotary on Y; grblHAL; FluidNC. 101/101, 9/9 … samples burn exactly at the Z their operation name states. No G20 anywhere. Burn F always re-emitted after the Z F word (no modal-feed leak). |
| Rotary on A / Z | same harness | A on grbl-v1.1: refused (`rotary-axis-unexecutable`, axis unsupported). Z rotary: refused (program already moves Z), no bytes |
| Non-GRBL routes | same harness + `emitRdFile`/`emitEgvFile` (`t05-save.test.ts`) | Ruida/K40/Moshi/Marlin/Smoothie refused at compile. See T05-P3-4 for the encoder itself |
| Dialog boundaries, Cancel, Generate, Undo, Redo, save/reopen | jsdom on the real `FocusTestDialog` + store (`zz-t05/t05-dialog.test.tsx`, log `t05-dialog.log`) | 24 boundary inputs behave as stated in the alert; Cancel leaves project identical and 0 undo entries; Generate = 1 undo step; Undo restores scene exactly; Redo G-code byte-identical; save/reopen G-code byte-identical, 7/7 offsets kept |
| Save G-code warnings for a focus job | `detectMachineJobWarnings` (`t05-save.test.ts`) | 0 warnings, also with a confirmed 1 mm Z travel and a 4 mm sweep (T05-P3-2) |
| Abort mid-test | READ: `abort-auto-restore.ts`, `abort-alarm-recovery.ts`, `AbortStoppedCard.tsx`, `job-stop-request.ts` | Abort is a soft reset (GRBL parser returns to G90/M5); restore writes XY G92 only; Z stays at the test offset (≤ max |offset|); no laser-side Z note (T05-P3-3) |
| Frame | READ `frame-focus-contribution.ts`; repo identity tests | Frame traces XY only, as ADR-602 and the dialog say |
| Repo suites | `vitest --maxWorkers=1`: 18 focus suites (focus-test, power, compilation-failure, integration, output, dialog, identity, resume, notice, layer-safety, empty-operation, cnc-contribution, preflight-failure, cnc-placement-review, second-pass ×2, legacy migration) | 123 tests, all pass |
| LightBurn reference | docs.lightburnsoftware.com/latest/Reference/FocusTest/ (2.2 guide) | Requires Z control enabled in Device Settings and warns on open if not; Start Z / End Z / Steps (lines = Steps + 1) / Speed / Power; "Relative Z moves only" option; engraves a Z label under each line; sends the pattern directly (workspace ignored); G-code and DSP (.rd) variants |

## Findings

### T05-P3-1: The command and dialog never mention a missing Z axis; `focusTestAvailable` is computed and unused
- Severity P3: no wrong burn (Generate only makes artwork, and Job Review warns at Start with the warning list opened), but the up-front notice LightBurn gives is missing and a context field is dead code.
- Where: `src/ui/commands/use-app-commands.ts:181-183` computes `focusTestAvailable` (Powered Z capability + confirmed travel); nothing reads it (`rg focusTestAvailable` hits only the type and test fixtures). `command-families.ts:291-299` enables the command for every laser profile; `FocusTestDialog.tsx:90-95` shows the same generic "Use a controllable Z axis" text whatever the profile says.
- Repro: `zz-t05/t05-dialog.test.tsx` on the default profile (capabilities without `z-axis`, no `zTravelConfirmed`): Generate enabled, 7 samples generated, no Z notice in the dialog or toast ("Generated 7 focus samples. Preview, Frame, then review and Start.").
- Oracle: LightBurn 2.2 Focus Test page: a warning when Z control is not enabled as the tool opens. ADR-602 keeps this a warning, not a gate, which the fix respects.
- Suggested fix: when `focusTestAvailable` is false, show `FOCUS_TEST_Z_UNCONFIRMED_WARNING` (with a pointer to Device Settings › Powered Z / Z travel Confirmed) in the dialog; otherwise drop the dead field.

### T05-P3-2: Save G-code shows none of the Focus warnings, even a sweep beyond confirmed Z travel
- Severity P3: Job Review at Start shows them; the exported file is only at risk when run elsewhere. Could be argued P2 ("missing warning"); kept P3 because ADR-602 places the disclosure in Job Review.
- Where: `src/ui/laser/job-review/job-review-model.ts` is the only caller of `compiledFocusTestWarnings`; `src/ui/laser/machine-job-warnings.ts` (`detectMachineJobWarnings`, used by Save G-code, Save .rd/.egv and link jobs) has no Focus branch.
- Repro: `zz-t05/t05-save.test.ts` (log `t05-save.log`): default focus job → 0 save warnings; same job on a profile with Powered Z, `zTravelMm: 1`, `zTravelConfirmed: true` (sweep span 4 mm) → still 0 save warnings. `focusTestWarnings` for that profile returns the travel-exceeded warning.
- Oracle: `focusTestWarnings` (`focus-test.ts:151-155`) — span max(0,max) − min(0,min) = 4 mm > 1 mm.
- Suggested fix: append `compiledFocusTestWarnings(prepared)` to the Save G-code warning list (at least the two machine findings).

### T05-P3-3: After an Abort, the laser "origin restored" messages do not say a Focus Test may have left Z at a test offset (READ ONLY)
- Severity P3, READ ONLY: wording; Job Review repeats "an interrupted job may not [return]" on the next Start.
- Where: `src/ui/laser/AbortStoppedCard.tsx:92` adds "The reset cleared work Z too: zero Z again." for CNC only; `src/ui/laser/abort-auto-restore.ts:40-41` toast "your origin is restored. Frame to check before starting again." Frame checks XY only. An Abort inside a sample leaves Z displaced by that sample's offset (up to the largest |offset|; my decode: Z sits at the offset from the `G91 G1 Z` line until the return line).
- Oracle: ADR-602 "An aborted/interrupted job may leave Z displaced; the operator must establish actual position before continuing."
- Suggested fix: when the stopped job carried nonzero Focus Z, add "Z may be at a test offset: restore your starting focus before Frame/Start."

### T05-P3-4: The .rd encoder drops Focus Z intent silently when handed a GRBL-profile job (defence in depth; unreachable from the UI)
- Severity P3: no UI route reaches it (Save .rd and the Ruida network job run only for a Ruida driver, where compile refuses with `focus-test-uncompilable`), so it is a guard/test gap.
- Where: `src/io/rd/emit-rd.ts:59-105` (`emitPreparedRdFile` never checks `group.focusTest`); the refusal lives only in `compile-job.ts:131-133`, keyed on `device.controllerKind`.
- Repro: `zz-t05/t05-save.test.ts`: `emitRdFile(focusProject)` on the default GRBL profile → `ok=true`, 1,756 bytes, no Z and no message.
- Oracle: ADR-602 "unsupported dialects … fail as unconstructable focus output rather than silently dropping Z intent".
- Suggested fix: refuse in `emitPreparedRdFile` (and the .egv/Moshi encoders) when any group has `focusTest` with a nonzero offset; add a test.

## Not a defect / limits
- No burned Z labels (LightBurn engraves one under each line): ADR-602 decision, stated in the dialog, Job Review and WORKFLOW. Labels are operation names; my decode found every name equals the Z actually burned (exact to 1 µm).
- Relative only (LightBurn also offers material-height-relative absolute Z): ADR-602 deliberately avoids an assumed Z datum.
- Z range is only warned against configured travel, never refused, and the app cannot know starting clearance: ADR-602 ("warnings, not extra Start gates"). ±1000 mm is accepted by design (bounded by the 1000 mm field limit).
- The Z feed cap uses the XY `maxFeed`, not `$112`; GRBL clamps per axis anyway.
- Feed display: the dialog's "Effective cut / Z feeds" uses the same floored formatter as the emitter (250.75 → 250 both), so the T01-P3-4 mismatch does not occur here.
- Abort is a GRBL soft reset, which returns the parser to G90/M5; a stop cannot leave the controller in G91. Not checked on grblHAL/FluidNC firmware itself (no hardware).
- The 2D estimate excludes Z time (disclosed); not measured.
- Known, not re-raised: Generate replaces the design without notice (T01-P3-2; applies here too); the sample block is not checked against the bed: 101 samples × 100 mm spacing × 1000 mm lines generate and only preflight reports `out-of-bed` (X 1010, Y −10) — same class as T04-P3-4 (uncapped sizes in the sibling calibration dialogs).
- Not checked: browser run (memory headroom kept for Vitest; dialog driven in jsdom instead); physical Z direction, clearance and focus results (no hardware, per rules); the exact streamed bytes after transport (taken as the emitted program, which repo tests pin).

## Totals
Raised 4; P1 0; P2 0; P3 4; known 2 (T01-P3-2 Generate replaces the design; T04-P3-4 uncapped sizes in the calibration dialogs, here the off-bed sample block).
