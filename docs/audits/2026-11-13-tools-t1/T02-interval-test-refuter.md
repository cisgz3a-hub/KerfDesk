# T02 Interval Test — refuter report
Tree: origin/main @ 8d92bd143 (`C:\Users\stolk\kd-t1\t01-main`, read only). Command id: `tools.interval-test`.
Scratch: `C:\Users\stolk\kd-t1\zz-t02r` (own scripts; the auditor's `zz-t02` scripts were read for API names only, not re-run).

## Verdicts

| Claim | Verdict |
|---|---|
| T02-P2-1: Min/Max interval accept only multiples of 0.01 mm from 0.05, so DPI pitches are refused | **CONFIRMED, P2** (with one correction: 0.125, 0.127 and the exact 300 DPI pitch 0.084667 *can* be burned by choosing Min/Max/Steps so that an interpolated swatch lands on them; 0.0635 (400 DPI), 0.0508 (500 DPI), 0.1016 (250 DPI) and 0.0799 (318 DPI) cannot be reached exactly in any way) |

### Answers to the coordinator's questions
1. **Is 0.01 a decision?** No. No ADR, WORKFLOW section or source comment names it. `git log -S"step: 0.01"` on the dialog finds only `fba24ad64` (2026-06-09, "feat(ui): add interval test dialog"), where `step: 0.01` was the HTML spinner step. `99e9a75a3` (#730, 2026-09-05, F16-01 "validate every required numeric draft") turned the field's `step` into a hard validation rule (`calibration-draft-validation.ts:22-26`) to block blank text; its remediation note gives no reason for 0.01. The **same PR's** F08-01 states the opposite policy for Cut Settings: "Reciprocal density controls accept fractional intervals", tested at 0.08337 mm and 287.35 LPI. ADR-044 decision 3 says the Interval Test "should generate image/fill swatches using the existing line interval / DPI controls". The October controller audit E5 (`docs/audits/2026-10-22-controller-v4/E5-ctl-material-tests.md:111, 509`) praised the dialog's 0.05 floor but did not judge the step; the defect is not in any earlier ledger.
2. **Another way in the same dialog?** No unit, DPI or LPI entry: `400dpi`, `0,0635`, `1/400in`, `0.0635mm`, `63.5um` all give "Min interval: enter a number." (`r02-reach.log`). Steps that land on the value (the real generator, every legal Min/Max on 0.01..0.30 × Steps 1..20, 3,001 distinct burnable intervals): 0.125 (Min 0.12, Max 0.13, Steps 3), 0.127 (Min 0.05, Max 0.16, Steps 11) and 0.084667 = 25.4/300 (Min 0.05, Max 0.09, Steps 16) are reachable. 0.0635, 0.0508, 0.1016, 0.0799, 0.0564, 0.0726, 0.0749, 0.0763 are not. The nearest reachable to 0.0635 is 0.063529 via Min 0.05, Max 0.28, Steps 18, and it is labelled 0.063529, not the value the user will type into Cut Settings. No user would find these combinations; they are not a workflow.
3. **Does machine resolution make 0.01 meaningful?** No. G-code coordinates are 0.001 mm. Own decoder (distinct lit Y rows, scan rows longer than 2 mm) on real `prepareOutput` → `emitPreparedGcode`, one 8 mm swatch each, core called directly: 0.06 → 133 rows (mean 0.060000); **0.0635 → 126 rows (mean 0.063496, steps 0.063/0.064 alternating)**; 0.07 → 115 rows; 0.08 → 100; 0.0847 → 94 (mean 0.084699); 0.09 → 89. 0.0635 is a distinct burn, between two 0.01-grid neighbours that are 15 % apart at this end of the range. Stepper resolution (typically 0.0125 mm at 80 steps/mm) accumulates the 0.001-rounded targets, so the mean pitch survives.
4. **Does it block a burn-relevant default workflow?** Not the shipped defaults: Fill `hatchSpacingMm` 0.1 (`layer.ts:165`), Image `linesPerMm` 10 = 0.1 mm (`layer.ts:171`), the only bundled preset pack (`neotronics-4040-presets.ts:28,33,56`) 0.1 / 10 lines/mm, image import 254 DPI (`image-import.ts:10`). All are on the grid. It blocks the user who sets Fill density by Lines / Inch in Cut Settings (`CutSettingsFillDensityFields.tsx`, `step="any"`; 300 or 400 LPI gives 0.084667 / 0.0635) or imports a LightBurn library with such intervals, and then wants to test around that value.
5. **P2 under AREAS.md?** Yes: "a refusal that should not happen". The core, burn path, Cut Settings and the Material Test's hatch axis (0.001 increments, `material-test-draft.ts:107-115`) accept these values; the refusal has no recorded reason. Harm is limited: nothing burns wrong, the user is blocked or forced to an approximation. Not P1. Not P3: it is a real refusal, not wording.

## Evidence
| Check | Method | Result |
|---|---|---|
| Direct-entry census of 15 DPI pitches (4-, 6- and 3-decimal text) | Real `calibrationDraftIssues` with the dialog's Min interval spec copied from `IntervalTestDialog.tsx:48` (`r02-reach.test.ts`, `r02-reach.log`) | Only 127, 254 DPI (0.2, 0.1) and the 3-decimal roundings 0.08 / 0.06 accepted; 0.254 (100 DPI), 0.127, 0.0847, 0.084667, 0.0635, 0.0508, 0.085, 0.064 all REFUSED |
| Native browser constraint, independent of the JS validator | Rendered real `IntervalDialog` in jsdom; `input.validity` of Min interval (`r02-experiment.test.tsx`, `r02-experiment.log`) | `min=0.05 step=0.01`; 0.07 valid; 0.0635, 0.0847, 0.125, 0.127, 0.085 `stepMismatch=true`. A fix must change the `step` attribute too, not only the validator |
| Reachability by interpolation | Real `generateIntervalTestGrid` over 351 Min/Max pairs × 20 step counts (`r02-reach.log`) | As in answer 2 |
| Burn distinctness | Own G-code row decoder on `prepareOutput` → `emitPreparedGcode` | As in answer 3 |
| Decision search | `rg` of DECISIONS.md, WORKFLOW.md, PROJECT.md, docs/audits; `git log -S` / `git show` of `fba24ad64`, `99e9a75a3` | No rationale for 0.01; #730 F08-01 accepts fractional intervals elsewhere |

Commands (from the tree root, `NODE_OPTIONS=--no-experimental-webstorage`, free memory 2.46 GB):
`node node_modules/vitest/vitest.mjs run --config ../zz-t02r/vitest.config.mts --maxWorkers=1 r02-reach.test.ts` and `... r02-experiment.test.tsx` — both pass, logs written.

## Extra findings

### T02R-P3-1: Interval Test captures no Material Library experiment, though the implementation note says it does
- Severity P3: a documentation claim the code does not meet; no burn is harmed and the interval can still be retyped from the label. (Raised P3 rather than P2 because AREAS.md's P2 list is about wrong results, refusals, Undo and warnings, and here the tool's own output is correct.)
- Where: `src/ui/commands/CalibrationGridDialogs.tsx:15-35` (`IntervalDialog.onGenerate` never calls `captureGridExperiment`; `MaterialDialog` does at lines 45-66). Claim: `docs/implementation/xtool-workflows-20261007.md:45` (KXS-01: "material experiments … automatically captured from Material/Interval Test … Saving a cell creates a usable preset or complete process recipe"). `git log -S captureGridExperiment`: added only to `MaterialDialog` in `4165bb6fe` (2026-10-07); the Interval Test never had it. `captureGridExperiment` takes a `MaterialTestGrid` (row/column cells), so it cannot take an `IntervalTestGrid` as is.
- Repro (ran): `zz-t02r/r02-experiment.test.tsx`, log `r02-experiment.log`. Real store, `resetStore()`: Material Test Generate → experiments 1, toast "Exact cell settings captured in Material Library → Experiments." Interval Test Generate → 21 objects, experiments 0 before and 0 after, `materialLibrary` null, only the "Generated interval test grid (10 swatches)…" toast.
- Oracle: the KXS-01 row's own text.
- Suggested fix: capture one experiment cell per swatch (interval as the varied setting) as the Material Test does, or correct KXS-01 to "Material Test".

No extra P1 or P2 found. Also checked and clean: `.lftest` preset load goes through `setDraft`, so loaded off-grid intervals are still validated (same refusal, no bypass); `numberFromDraft` and the validator agree on blank text.

## Totals
Verdicts: 1 (T02-P2-1 CONFIRMED at P2, scope corrected: 0.125 / 0.127 / 0.084667 reachable only through interpolation tricks; 0.0635 / 0.0508 unreachable). Extra raised 1; P1 0; P2 0; P3 1 (T02R-P3-1); known 0.
