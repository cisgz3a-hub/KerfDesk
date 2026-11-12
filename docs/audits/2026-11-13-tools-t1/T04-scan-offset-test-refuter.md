# T04 Scan Offset Test — refuter report
Tree: origin/main @ 8d92bd143. Command id: `tools.scan-offset-test`. Scratch: `C:\Users\stolk\kd-t1\zz-t04r`.

## Verdicts

| Claim | Verdict | One line |
|---|---|---|
| T04-P2-1 | **CONFIRMED at P2, scope narrowed** | Part (b) holds and only the recipe path causes it. Part (a), "drops the device table on a verified profile", is not caused by the recipe or the mode. It is the documented local scan-offset override (explicit 0 mm), and Copy/Paste settings, material presets and Make Default carry it the same way. Removing the mode from the recipe does not change (a). Part (b) also covers verification swatches, which the auditor did not mention. Not P1. |

### Why part (a) is refuted as a recipe defect
- The 0 mm comes from the operation setting `bidirectionalScanOffsetMm: 0`, not from `scanOffsetCalibrationMode`. The mode is read only by `scan-direction-policy.ts`, which picks the direction (`rg scanOffsetCalibrationMode src`: no other consumer outside recipe and IO plumbing). Every emitter uses `group.bidirectionalScanOffsetMm ?? offsetForSpeed(table, …)` (`grbl-fill-emission.ts:76`, `fill-group-emission.ts:13`, Moshi and LHY twins).
- Carrying that local offset is documented:
  - ADR-670 Amendment 1, Decision 2 (`docs/decisions/ADR-670-amendment-1-…md:43-46`): Copy settings "also carries the per-operation scan offset (`bidirectionalScanOffsetMm`, `allowUncalibratedBidirectionalScan`), which a material preset or a scan-offset coupon can set".
  - WORKFLOW F-ML2 (`WORKFLOW.md:6063-6068`): a preset saves the "uncalibrated-direction intent, and optional local scan-offset override".
- It is shown to the user. Job Review's operation detail prints "local scan offset 0 mm — replaces device table only for bidirectional output" (`job-review-detail-facts.ts:172-180`). Machine Setup's override notice lists "(device table disabled when bidirectional)" (`ScanOffsetOverrideNotice.tsx:25`).
- Matrix run (below): on a verified table, the recipe with the mode **stripped**, Copy/Paste, Make Default and the material preset all give offset **0.000** too. The only difference is the reason label (`calibrated-bidirectional` instead of `calibration-baseline`).

### Why part (b) stands (recipe-only, contradicts the project's own rule)
- Only the process-recipe path keeps the marker. Make Default strips it on purpose, and its code says why (`layer-default-settings.ts:16-19`): "A saved 'baseline' marker would let every new layer skip the verified-offset rule for bidirectional scanning (scan-direction-policy.ts), so neither is captured". Copy settings (`LAYER_OPERATION_SETTING_KEYS`) and `captureMaterialRecipe` also leave it out. Recipes keep it in all four places the auditor cited, and `process-recipe-io.ts:180-208` validates it on load, so it survives the library file.
- Searches found no document or test that wants the marker to travel:
  - no ADR, amendment or WORKFLOW text: `rg -i "scanOffsetCalibrationMode|calibration mode|calibration-baseline"` over DECISIONS.md, `docs/decisions`, WORKFLOW.md and PROJECT.md gives no hit;
  - ADR-357 Decision 2 says only "effective settings … travel";
  - no material-library or recipe test asserts it;
  - the field came in with the broad merges 77ba22f65 (#865) and 08afe91ca, whose messages do not mention it.
- Variant the auditor missed: a recipe saved from a **verification** swatch, applied to ordinary art on a require-verified profile with a **pending** table, runs two-way with the unverified table (`calibration-verification`) instead of the one-way fallback. Job Review shows this in the default tone, not as a warning (`job-review-live-rows.ts:264-272`).

### Severity: P2, not P1 and not P3
- **Against P1 (narrow and visible):**
  - It needs a require-verified profile in the "pending" window (table applied, not yet marked verified). A verified table, an empty table or an allow-requested profile behaves the same with or without the marker (matrix).
  - It needs a process recipe saved from a coupon swatch. The panel offers this for any single selection with no prompt (`ProcessRecipePanel.tsx:34-40`, `use-process-recipe-controls.ts:41`), but there is little reason to save a 12 % power calibration swatch as a production process.
  - The applied operation keeps the step name "Scan offset 3000 mm/min". Job Review shows a warning-tone fact "Bidirectional — uncorrected calibration baseline (explicit 0 mm)".
- **Against P3:** there is a real defect behind it. The recipe bypasses a profile safety fallback that the code deliberately protects on the Make Default path. Preflight has no advisory and Start has no gate for `calibration-baseline` (prepareOutput advisories: none; no start-acknowledgement use of `scanDirection`).
- **Other entry points:**
  - phone and MCP have no recipe apply (`rg applyProcessRecipe`: the only callers are the Materials panel and the machining-template review);
  - material experiments save one-step laser cells as material presets, which drop the marker (`material-experiment-actions.ts:132-150`);
  - retained re-apply (`templateOperation`) and machining templates (`captureProcessRecipeStep`) carry it like the plain recipe.

## Evidence

My method differs from the auditor's G-code decode. I evaluated the real direction policy and offset lookup on the layer each entry point produces, and checked the compiled job's fill group (planner output, not G-code). The recipe went through a JSON save and `parseProcessRecipes` reload. A control applied the same recipe with only the mode removed.

- Test: `C:\Users\stolk\kd-t1\zz-t04r\t04r-matrix.test.ts`, config `C:\Users\stolk\kd-t1\zz-t04r\vitest.config.mts`.
- Run: `NODE_OPTIONS=--no-experimental-webstorage node node_modules/vitest/vitest.mjs run --config ../zz-t04r/vitest.config.mts --maxWorkers=1 t04r-matrix` from the tree. 1 passed. Free memory 2.36 GB before the run.
- Log: `C:\Users\stolk\kd-t1\zz-t04r\t04r-matrix.log`.

Setup: table [1000: −0.2, 5000: −0.4]; 3000 mm/min swatch from a 3-step 1000–5000 coupon; ordinary Fill at 3000.

| Profile | Ordinary layer | Recipe (via JSON) | Recipe, mode stripped | Copy/Paste | Make Default | Material preset |
|---|---|---|---|---|---|---|
| Baseline swatch, 4040 verified | two-way −0.300 | two-way **0.000** | two-way **0.000** | two-way **0.000** | two-way **0.000** | two-way **0.000** |
| Baseline swatch, 4040 pending | **one-way** fallback | **two-way 0.000** (`calibration-baseline`) | one-way fallback | one-way | one-way | one-way |
| Baseline swatch, 4040 no table | one-way fallback | two-way 0.000 | two-way 0.000 (`expert-override`) | two-way (`expert-override`) | two-way (`expert-override`) | two-way (`expert-override`) |
| Baseline swatch, allow-requested, pending | two-way −0.300 | two-way 0.000 | two-way 0.000 | two-way 0.000 | two-way 0.000 | two-way 0.000 |
| Verification swatch, 4040 pending | **one-way** fallback | **two-way −0.300** (`calibration-verification`) | one-way | one-way | one-way | one-way |
| Verification swatch, 4040 verified or no table | same as ordinary | same as ordinary | same | same | same | same |

- The compiled job (`prepareOutput`) for the recipe-applied project on 4040 pending has a fill group `two-way (calibration-baseline), group local offset=0, F=3000`, with no preflight advisories.
- In every case the recipe-applied operation is named "Scan offset 3000 mm/min", whatever name the recipe was given.
- The mode changes the result only in the two **pending** rows. That is part (b). The explicit 0 mm drives every other zero, including part (a).

## Extra findings

### T04R-P3-1: The coupon's allow flag passes the verified-offset rule into ordinary layers through Make Default, Copy settings and presets, although Make Default strips the baseline marker for exactly that reason
- **Severity P3.** The behaviour is documented as a carried local override (ADR-670 Amd 1 D2 names the scan-offset coupon as a source) and is shown in Job Review: "expert override without calibration" in warning tone, plus the local-offset detail. It needs Make Default, Copy settings or a preset save from a baseline swatch. What remains is a gap against the stated intent of `layer-default-settings.ts:16-19`, not a hidden burn.
- **Where:**
  - `scan-offset-calibration-pattern.ts:188-190`: baseline swatches get `allowUncalibratedBidirectionalScan: true` and `bidirectionalScanOffsetMm: 0` as ordinary operation settings.
  - `layer-default-settings.ts:22-40`: strips only `scanOffsetCalibrationMode`.
  - `scan-direction-policy.ts:50-52`: on an uncalibrated require-verified profile the allow flag alone gives `expert-override`.
- **Repro:** the same matrix log, row "Baseline swatch, 4040 no table". Make Default from the 3000 swatch, then a new layer: `two-way (expert-override), offset 0.000`. An ordinary new layer on that profile gives `one-way (uncalibrated-profile-fallback)`. On a verified profile the defaulted new layer burns 0.000 instead of −0.300. Make Default persists per device profile (`layerDefaultsStorageKey`), so this affects every later project on that profile.
- **Oracle:** the code comment's own rule: new layers must not skip the verified-offset rule because of a calibration coupon.
- **Suggested fix:** when the source layer has `scanOffsetCalibrationMode`, drop all three calibration fields (mode, allow flag, explicit 0) in Make Default, Copy settings, preset capture and recipe capture. A single helper next to `withoutInactiveLaserLeadSettings` would cover all four paths. The same fix closes T04-P2-1.

## Noticed, not raised
- Make Default also copies the source layer's **name**: `captureLayerDefaultSettings` keeps `name`, so a new layer seeded from the 3000 swatch is named "Scan offset 3000 mm/min" (matrix log). This is generic Make Default behaviour, not T04, and is left for whichever area owns layer defaults.
- Editing the table by hand in Device Setup resets the status to pending (`DeviceSetupOptionsStep.tsx:113-117`). The Apply panel sets pending (`MeasuredScanOffsetApply.tsx:73-77`). A bed change clears the table (`device-profile-patch.ts:25-35`). No stale "verified" path was found.
- Not checked: the browser UI (memory, by instruction) and the G-code itself (the auditor decoded it; I used the planner output instead).

## Totals
- T04-P2-1: CONFIRMED at P2, narrowed to part (b) plus the verification-swatch variant. Part (a) is by design: documented local override, shared by all reuse paths.
- Extra findings raised 1: P1 0; P2 0; P3 1 (T04R-P3-1, same root cause as T04-P2-1; fix together).
