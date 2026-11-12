# T01 Material Test — auditor report
Tree: origin/main @ 8d92bd143. Command id: `tools.material-test`.

## Map
- Menu: `src/ui/commands/app-menu-groups.ts:125` (`tools.material-test`); laser-only gate `src/ui/commands/machine-command-gate.ts:31`.
- Dialog host: `src/ui/commands/CalibrationGridDialogs.tsx:37` `MaterialDialog` → `MaterialTestDialog` (`src/ui/calibration/MaterialTestDialog.tsx`), draft and validation in `material-test-draft.ts` + `calibration-draft-validation.ts`, cut-start ranges `material-test-cut-start.ts`, preview `material-test-preview.ts` / `MaterialTestPreview.tsx`, guidance `MaterialTestGuidance.tsx`.
- Generate: `generateMaterialTestGrid` (`src/core/job/material-test-grid.ts`) with axes `material-test-axes.ts`, layout `material-test-layout.ts`, cell-order scope `material-test-cell-order.ts`, labels `calibration-labels.ts` (fixed 20 % / 1500 mm/min Line layer). Then `replaceSceneWithGeneratedScene` (`src/ui/state/generated-scene-actions.ts`, one Undo step, whole scene replaced) and `captureGridExperiment` (`src/ui/material-library/capture-material-experiment.ts`, creates a library if none and adds an experiment record).
- Output: ordinary `prepareOutput` → `emitPreparedGcode` (S via `scaleS`, `src/core/output/grbl-laser-lines.ts:20`; F via `effectiveGcodeFeedMmPerMin`, `src/core/gcode/feed-word.ts`).
- Governing: ADR-044, ADR-497 + Amendment 1, ADR-127 Amd 2 (rotary surface feed), ADR-629 (inch display), WORKFLOW.md F-A7f (line 1324).
- Changes since 2026-10-16 (merge PR in brackets): 42be8208b calibration accuracy hardening (#1216); 0ebeeba93 live preview (#1269); c0c0e4350 review fixes (#1362); 4fdca81b3 ADR-497 Amd 1 hatch floor, fitted column labels, gentlest cut first (#1411); 38011179a / 416d4e82d shared maxOf (#1601); fdf2266be cut-test guidance and cut starting ranges, U8-P3 (#1605); ab3226fd1 shared helpers C2-P3-1 (#1700).

## October register re-check
Row 14 (repaired represented-feed labels):
- Requested fractional feed labels show the represented (floored) feed: still fixed. Script `zz-t01/t01-burn.test.ts` case "fill speed fractional request 1234.9..2000.75": row labels `2000|1745|1490|1234`, emitted F words identical text, layer names `Material test 1234.9 requested / 1234 effective mm/min`.
- Fractional profile ceilings appear exactly: still fixed. Cases ceiling 0.125 and 0.001: burned labels `0.125` / `0.001`, emitted `F0.125` / `F0.001` (labels and cells), operation names `… / 0.125 effective mm/min` and `… / 0.001 effective mm/min`.
- Whole-step validation of speeds (1000.25 rejected): still in place (`calibration-draft-validation.ts`, speed step defaults to 1); `CalibrationDrafts.validation.test.tsx` passes.
- 400-cell max on both speed axes, Undo: still fixed (20×20 from a 50×50 request, 400 cells all matching; Undo restores, see below).

## Checks run
| Check | Method | Result |
|---|---|---|
| Per-cell F and S vs burned labels, 25 configurations (default, $30 255/100/1 profile and session `laserMaxPowerS` 255, power 10–20 ×7, 0–100 ×20, power rows × speed cols, capped speeds, fractional feeds/ceilings, speed×passes fill, interval×power, Line speed×passes / speed×power / power×passes, 1×1, reversed ranges, equal min/max, 20×20, rear-right and centre origins, 30 mm cells, maxFeed 600) | Script on real `prepareOutput` → `emitPreparedGcode`, modal G-code decoder, per-cell bounds (`zz-t01/harness.ts`, `t01-burn.test.ts`, log `t01-burn.log`) | Every burning cell: one F word equal to its label text, one S within half an S step of its label; Line cells trace exactly `passes` perimeters; Fill passes 1–5 burn 250/500/…/1250 mm; 0 stray lit moves; no label/cell overlap |
| Cell order gentlest first | Same decoder | Matches generated order on all origins (only deviation: a 0 % column burns nothing, as labelled) |
| Hatch spacing rows | Existing `material-test-emitted.test.ts` | Pass |
| Rotary (chuck Ø60, 20 mm/rev, Y), Line and Fill | `t01-rotary.test.ts` surface speed = F·ds/dm | X strokes exact; round-the-part strokes 593.8/1197/1790.7 vs 600/1200/1800 (whole-number floor, ADR-127 Amd 2 by design) |
| Labels' own settings | Decoder | Always 20 % (S200/S51/S20/S0.2 per $30) at 1500 mm/min, capped to profile max feed (F600 when maxFeed 600) |
| Bed bounds | Decoder + preflight | Grid sits at scene (0,0); 20×20 × 30 mm cells exceed the 400 mm bed and Start preflight reports `out-of-bed` |
| Save / reopen | `t01-roundtrip.test.ts` serialize → deserialize → emit | Byte-identical G-code (3 grids) |
| Experiment record per cell | `t01-experiment.test.ts` | Power, speed, passes, hatch spacing match every cell (4 axis pairs) |
| Generate / Undo / Redo / Cancel through real `MaterialDialog` | `t01-undo.test.tsx` (jsdom) | Undo restores the prior scene exactly; Redo repeats exactly; Cancel leaves project, undo, dirty, library and localStorage untouched. Generate replaces the user's art; the experiment and library survive Undo |
| Inch display units | `t01-inch.test.tsx` (jsdom, `useDisplayUnitsStore` = in) | See T01-P2-1 |
| Controller S resolution vs power labels | `t01-sres.test.ts` | See T01-P3-3 |
| Existing suites (13 files, 79 tests: grid, axes, label bounds, feed, stress, emitted, dialog ×3, preview geometry, draft validation, generated-scene actions, material experiment) | Vitest on tree | All pass |
| LightBurn reference | docs.lightburnsoftware.com/latest/Reference/MaterialTest/ | Labels have their own Cut Settings and an Enable Text switch; test runs from the dialog (Frame/Start/Save) rather than replacing the design; Start From governs placement |

## Findings

### T01-P2-1: Material Test ignores Inches and shows no unit on any field
- Severity P2: a missing unit label (ADR-629 decision 3 requires every box not yet converted to say `mm`) that can make an inch operator run the test 25.4× slower than intended, or read card values into in/min boxes. Not P1: the status line under the preview names mm/min.
- Where: `src/ui/calibration/CalibrationNumberField.tsx:16-30` (label text only, no unit); field labels from `src/ui/calibration/material-test-draft.ts:82-116` ("Min speed", "Cell width", "Gap", "Hatch spacing", "Min power" — no mm/min, mm or %). The dialog never reads `useDisplayUnitsStore`.
- Repro: `C:\Users\stolk\kd-t1\zz-t01\t01-inch.test.tsx` (log `t01-inch.log`). With Settings → Units = Inches, the fields read `Min speed 1000`, `Max speed 3000`, `Cell width 5`, `Gap 1` with no unit. Typing 40 and 120 (in/min, as the layer Speed box reads in inches) and 0.5 cell width generates `speedMin=40 speedMax=120 cellWidthMm=0.5`; emitted F words `120,111,…,48,40`. Expected (ADR-629): either the fields label themselves mm/min and mm, or they accept in/min (40 in/min = F1016, 120 in/min = F3048) and 0.5 in = 12.7 mm cells. Burned labels are mm/min while the operator's layer Speed box is in/min, so a value read off the card and typed into the layer is 25.4× off.
- Oracle: ADR-629 decision 3 and 5; 1 in = 25.4 mm.
- Suggested fix: give `CalibrationNumberField` a unit suffix (mm/min, mm, %) now; later convert the fields through `toDisplayLength`/`fromDisplayLength` like the layer Speed box. Interval Test shares the field component (check in T02).

### T01-P3-1: Burned labels always run at a fixed 20 % / 1500 mm/min and cannot be changed or turned off
- Severity P3 (design gap; nothing burns other than as stated).
- Where: `src/core/job/calibration-labels.ts:12-13,43-53`.
- Repro: `t01-burn.log` — every case's label moves are S = 20 % of $30 at F1500 (F600 when the profile max feed is 600), regardless of test mode or material. On a strong CO2 that can cut thin stock; on a weak diode at 1500 mm/min labels may not mark.
- Oracle: LightBurn's Material Test gives labels their own Cut Settings ("Edit Text Setting") and an Enable Text switch.
- Suggested fix: label power/speed fields (and an on/off) in the dialog, defaulting to today's values.

### T01-P3-2: Generate replaces the whole design without saying so; the experiment record outlives Undo
- Severity P3 (Undo restores exactly; tidiness and notice).
- Where: `src/ui/commands/CalibrationGridDialogs.tsx:43-68`; WORKFLOW F-A7f does not say the scene is replaced (the Focus Test paragraph beside it does).
- Repro: `t01-undo.test.tsx` — user art `user-art` is gone after Generate (`userArtKept=false`, 120 objects); Undo restores it exactly, but the Material Library created on Generate and its experiment remain (`experiments=1` after Undo), and two Generates leave two experiments for tests never burned.
- Oracle: LightBurn runs the test from its dialog without touching the workspace.
- Suggested fix: one line in the dialog ("Generate replaces the current design; Undo brings it back") and in WORKFLOW F-A7f; consider dropping the experiment on Undo.

### T01-P3-3: Power labels claim more precision than the controller's S range burns
- Severity P3 (the job later rounds the same way, so test and job agree; adjacent cells can be identical).
- Where: labels `src/core/job/material-test-axes.ts:96-100` (two decimals), S rounding `src/core/output/grbl-laser-lines.ts:28-29`.
- Repro: `t01-sres.test.ts` (log `t01-sres.log`), power 10–12 % over 10 columns: $30=100 burns S `10 10 10 11 11 11 11 12 12 12` under labels `10 10.22 10.44 … 12` (3 distinct burns for 10 labelled columns); $30=255 gives 6 distinct; $30=1000 gives 10.
- Oracle: S = round(p/100 · $30).
- Suggested fix: label the represented power (S/$30), or note in the dialog when columns collapse to the same S.

### T01-P3-4: Feed note shows an unfloored "effective" feed when the profile ceiling is fractional (READ ONLY)
- Severity P3, READ ONLY.
- Where: `src/ui/calibration/MaterialTestDialog.tsx:205-206` uses `Math.min(low, maxFeed)` without `effectiveGcodeFeedMmPerMin`, so a 1234.9 ceiling would read "effective 1,234.9 mm/min" while labels and F say 1234.
- Suggested fix: pass both through `effectiveCalibrationSpeed`.

## Not a defect / limits
- Every cell burns exactly the F and S its labels state, through the real output path, across $30 255/100/1, session `$30` override, fractional feeds and ceilings, capped speeds, all four axis pairs, Line and Fill, all origins and 1×1 to 20×20. No stray burns, no label/cell overlap.
- A 0 % power column burns nothing: it is what the label says (min power field allows 0).
- Rotary round-the-part strokes floor to whole mm/min (up to about 1 % slow at 600 mm/min on the tested chuck): ADR-127 Amendment 2 keeps the shared whole-number rounding by design.
- Hatch spacing runs widest first (ADR-497 decision 3); LightBurn's page says lowest interval first. Deliberate difference.
- Grid always placed at scene (0,0); oversize grids are caught by Start preflight `out-of-bed`, not by the dialog. Placement otherwise follows Start From like any job.
- KerfDesk has no Image-mode test cells (LightBurn's page does not document modes either); not checked.
- Not checked: browser run of the dialog (jsdom only), $31 > 0 machines (scaleS ignores $31, a general emitter matter), non-GRBL emitters (Ruida/K40/Moshi) for this tool.

## Totals
Raised 5; P1 0; P2 1; P3 4; known 0.
