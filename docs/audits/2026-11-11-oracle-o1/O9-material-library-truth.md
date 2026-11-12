# O9 `material-library-truth` — Oracle audit O1, batch 3

**Area:** `src/core/material-library/`, `src/io/material-library/`, the LightBurn `.clb` importer (`src/io/lightburn/clb-import.ts`), the shipped Neotronics 4040 starter presets, the Material Library panel's Apply / Link / Apply Best Recipes paths, and how a preset's power, speed, interval, passes and air become layer settings and then the S and F values each controller dialect emits.
**Question:** does an imported or shipped preset carry exactly the power, speed and units it claims, on every machine profile, so that applying it never burns harder, faster or slower than the user expects?
**Read at:** `origin/main` 93c880722 (2026-11-12). Method, severity and rules: [AREAS.md](AREAS.md).
**Fix PR:** [#1795](https://github.com/cisgz3a-hub/KerfDesk/pull/1795) fixes O9-P2-1 (ADR-093 Amendment 2) and O9-P3-2.

## Headline

The numbers a preset carries reach the machine correctly. An imported `.clb` entry at 65% and 10 mm/s emitted the following, and F600 (10 mm/s × 60) on every dialect:

| Dialect | Emitted |
|---|---|
| GRBL `$30=1000` | `S650` |
| GRBL `$30=255` | `S166` |
| grblHAL | `S650` |
| Marlin LASER_FEATURE | `S166` |
| Marlin fan | `M106 S166` |
| Smoothieware | `S0.650` |

A speed above the machine's maximum feed becomes a preflight issue, not a silent clamp. The library file round-trips. A process recipe bakes an object's power scale into its power and resets the scale on apply, so nothing is scaled twice.

The real gap is in **what a preset holds**. A material preset kept power, speed and interval, but not the Image scan angle, Image cross-hatch, angle change per pass or Fill ramp. Each of these changes how often, or at what angle, a burn passes. Applying a plain Image preset to an operation with cross-hatch on scanned every pass twice, about twice the energy the preset was saved with. The app also reported the operation as **already matching** the preset: Apply did nothing, and Apply Best Recipes called it "already current". LightBurn's library re-applies a layer's whole Cut Settings. That is **O9-P2-1**, fixed in #1795.

| Raised | Refuted | Contradicted (research) | P1 | P2 | P3 |
|---|---|---|---|---|---|
| 8 (6 auditor, 2 refuter) | 3 | 0 | 0 | 1 | 3 |

One more candidate is listed under Not verified: `.clb` Image entries written as `CutSetting_Img`.

## Oracle plan

This plan was written before the code was read closely, from the file list only. It is kept as written.

| # | Claim | Oracle |
|---|---|---|
| C1 | `.clb` import reads power as % of the device's max, never as S units or a 0..1 fraction | LightBurn docs: Cut Settings (Max/Min Power), Material Library |
| C2 | `.clb` speed is stored in mm/s whatever the display units; import converts to mm/min once | LightBurn Units docs; `.clb` structure |
| C3 | Interval / DPI: interval_mm = 25.4 / DPI | LightBurn Image/Fill docs; maths |
| C4 | Passes, Z offset, Z step per pass and air come in with their documented sign and units | LightBurn Cut Settings docs |
| C5 | Unknown or out-of-range numbers are rejected or named, never clamped silently | house rule; LightBurn power range 0–100 |
| C6 | import(export(library)) is identity for KerfDesk library files | round-trip property |
| C7 | Applying a preset copies its settings onto a layer unchanged | property; LightBurn Material Library "Assign" |
| C8 | Emitted S = power% × S-max / 100 for GRBL ($30), grblHAL, FluidNC, Marlin (CUTTER_POWER_UNIT) and Smoothieware | GRBL wiki $30/$31/$32, grblHAL source, Marlin M3 docs, FluidNC speed_map |
| C9 | Emitted F = speed in mm/min (G21, G94) on every dialect | NIST RS274/NGC §3.5.19 |
| C10 | A preset made on another device is flagged or rescaled as documented | LightBurn Material Library (library linked to a device) |
| C11 | Shipped presets are plausible and match any vendor chart they cite | the cited charts |
| C12 | Min Power is carried and emitted per its documented meaning (DSP corner power, grayscale floor) | LightBurn Cut Settings, Min Power |

## Findings

### O9-P2-1 — Applying a preset kept the operation's cross-hatch, scan angle, angle step and fill ramp; saving a preset dropped them

**Where:** `src/core/material-library/material-library.ts` (`MaterialRecipe`, `MATERIAL_RECIPE_FIELDS`, `captureMaterialRecipe`, `applyMaterialRecipe`). Every path that applies a preset goes through these: `assignMaterialPresetToLayer`, `linkMaterialPresetToLayer` and `applyBestRecipesToOperations` in `src/ui/state/material-library-actions.ts`, ADR-496 seeding in `src/ui/state/laser-recipe-seeding.ts`, and the remote `applyMaterialRecipe`.

**Reproduction** (Vitest on the real modules):

- A preset was captured from a plain Image operation: one pass along X.
- It was applied to an Image operation with cross-hatch on, a 45° scan angle, a 30° step per pass and a 2 mm fill ramp.
- `imageScanPassRuns(applied)` gave `[{45°, 1}, {135°, 1}]`: two scans per pass.
- All four settings stayed on the operation, and `recipeMatchesLayer(applied, preset)` returned `true`.
- In reverse, a preset saved from a cross-hatched operation re-applied as a single scan, with no `imageCrossHatch` key in the recipe.

The refuter repeated this through the store actions (`setLayerParam`, `assignMaterialPresetToLayer`, `linkMaterialPresetToLayer`, `applyBestRecipesToOperations`):

- Assigning the same preset again returns `false` and changes nothing (`material-library-actions.ts:84`), so the user cannot clear the cross-hatch by re-applying.
- Linking records the cross-hatch in the binding snapshot, so the stale-preset notice never flags it.
- Apply Best Recipes reports `alreadyCurrent: 1`.
- A Fill preset keeps a target's 1.5 mm ramp, its outer-edge switch and a 30° step.
- Job Review lists cross-hatch and the angle step as plain operation facts (`job-review-detail-facts.ts:124-140`). Nothing compares them with the preset.

**Oracle:** LightBurn's Material Library stores "preset Cut Settings" made from a layer and re-applies them as a set. Its `.clb` files carry `crossHatch` and `angle` alongside power and speed (the repo's external corpus, `jayson-big-blue-laser.clb`). The property in claim C7 is that applying a preset leaves the layer scanning as the operation the preset was saved from did.

ADR-415 and ADR-494 exempt perforation, overcut and tabs as "design choices". ADR-492 (image scan angle, cross-hatch, angle per pass) and ADR-699 (fill ramp) say nothing about presets. ADR-670 Amendment 2 already drops a tone curve on apply because "a recipe holds none". That is the same principle.

**Research verdict:** VERIFIED. docs.lightburnsoftware.com/latest/Reference/MaterialLibrary/ describes the library as a way to "store, organize, and quickly re-apply preset Cut Settings", created from a layer.

**Refuter verdict:** CONFIRMED (P2), by a different method (store actions rather than core calls). No ADR exempts these fields.

**Severity: P2.** It breaks LightBurn's library contract in a way an ordinary user reaches: the cross-hatch was switched on for an earlier job. The result misleads, because the app says the operation matches the preset. It is not P1: the burn is exactly what the operation's visible Cut Settings say, and nothing differs from those settings.

**Owner re-check:** re-read `material-library.ts:109-125` and `material-library-actions.ts:84, 214-224` at 93c880722.

**Fix (#1795, ADR-093 Amendment 2):**

- `MaterialRecipe` holds `imageScanAngleDeg`, `imageCrossHatch`, `passAngleStepDeg`, `fillRampLengthMm` and `fillRampOuterEdge`, each only while it is on (`recipe-scan-pattern.ts`).
- Applying a preset turns off any of the five that the preset does not hold.
- Library load validates the five fields.
- The Apply preview lists them and shows an absent one as Off.

Regression tests, each failing on 93c880722: `recipe-scan-pattern.test.ts` (4) and `material-preset-scan-pattern.test.ts` (1).

### O9-P3-1 — The library round trip is not identity below the form's floors

**Where:** `normalizeMaterialRecipe` (`material-library.ts:127-158`), run on both save and load.

**Reproduction (refuter):** through `serializeMaterialLibrary` and `deserializeMaterialLibrary`, these values change:

- a speed of 0.5 mm/min becomes 1;
- `linesPerMm` 0.0005 becomes 0.001;
- `hatchSpacingMm` 0.0005 becomes 0.001.

The validator accepts all three (it only requires positive values) and normalisation then raises them without a word. These values survive: 33.3333 %, `minPower == power`, dynamic power mode, and a −0.07 mm scan offset.

**Oracle:** the round-trip property (C6).

**Reach:** the Cut Settings form cannot produce these values: speed has `min={1}` (`CutSettingsCommonFields.tsx:43`) and interval runs 0.05–10. `setLayerParam` accepts a speed of 0.5, and the feed-boundary test emits F0.75 on a machine whose maximum feed is 0.75.

**Refuter verdict:** found by the refuter. **Research:** not needed (a property).

**Status:** listed for the maintainer, not fixed. Rejecting these values on load, or keeping them, changes what an existing library opens to.

### O9-P3-2 — `.clb` import floored a fractional pass count; `.lbrn` import rounds it

**Where:** `clb-import.ts` `importedRecipe`, then `normalizeMaterialRecipe` (`Math.floor`). The twin is `lbrn-layers.ts:264` (`Math.round`).

**Reproduction:** `numPasses Value="2.7"` imported as 2 passes from a `.clb` and as 3 from a `.lbrn`.

**Oracle:** consistency with the twin importer. LightBurn writes whole numbers, so only a hand-edited file reaches this.

**Refuter verdict:** CONFIRMED as the one new detail in its F3 check.

**Fix (#1795):** the `.clb` importer rounds, as the `.lbrn` importer does. Test: `clb-import.test.ts`, "rounds a fractional pass count as a LightBurn project import does" (fails on 93c880722).

### O9-P3-3 — A library's device hint is never compared with the active machine

**Where:** `material-library-device-hint.ts`. A library records the S-max (`maxPowerS`), maximum feed and laser head of the machine it was made on (`createMaterialLibraryDeviceHint`). Only its name is ever read, in Saved Libraries (`SavedLibraryRow.tsx:160`).

**Reproduction:**

- A library made on an S-max 255 machine applies without a word on an S-max 1000 machine.
- An imported `.clb` has no device hint at all, so ADR-496 auto-apply ranks its entries as "generic" on any machine.

Power stays a percentage of the active machine's S-max, so the emitted S is right for that machine: the same model LightBurn uses. What differs is the physical power, when the lasers differ.

**Oracle:** LightBurn links a saved library to the device that was active, and loads it when that device is chosen. The docs say: "When you save a Library, it is linked to the currently active device." They also advise one library per laser.

**Research verdict:** VERIFIED (Material Library, "Advanced Usage > Multiple Lasers"). LightBurn documents a link, not a rescale or a warning, so this is a usability gap, not a broken contract.

**Status:** listed for the maintainer: show a note when the library's device hint names a different S-max or laser head from the active machine.

## Refuted

- **`.clb` sub-layers are dropped.** This is a documented limit, not a new finding. ADR-388 Amendment 1 (Limits) says `.clb` sub-layers are not mapped and that the `SubLayer` block stays in the unsupported fields. LightBurn's docs say a preset made "from layer" includes its sub-layers, so the limit stands as recorded.

  The refuter found one piece of evidence for when the limit is revisited. The real fixture entry "Cross Hatch" (`jayson-big-blue-laser.clb:197-217`) does its 90° pass in a sub-layer. It imports as a single 0° Scan with cross-hatch off, under a name that says cross hatch.

- **Silent `.clb` clamps.** Power 150 becomes 100, power −5 becomes 0, a min power above max becomes max, an interval of 0.0001 becomes 0.001, and a speed of 0 or below becomes 1 mm/min. All of these are KNOWN: rolling-v2 report 21, P3-5, still open per rolling v11 W5. The count-only import toast is 21-P3-3, also still open. The only new detail, fractional passes, is O9-P3-2.

- **The material library shows mm/min while Display Units is Inches.** This is intended. ADR-629 decision 5 keeps the material library in millimetres in its first increment, "and says so with its own `mm` label". The wizard's Speed field and the Apply preview are labelled mm/min.

## Verified clean

- **Emitted S (C1, C8).** S = power% × S-max / 100, rounded: S650 at 65% with `$30=1000`, S166 at 255. grblHAL is the same, Marlin LASER_FEATURE uses `maxPowerS` as its CUTTER_POWER_UNIT range, and Smoothieware gives S0.650 from its profile S-max of 1.

  Research verdicts, all VERIFIED:
  - GRBL v1.1 wiki: $30 is the S for full PWM (default 1000), the range between $31 and $30 is linear, and an S above $30 is clamped.
  - grblHAL `settings.h`, `spindle_control.c`: the same numbering, `constrain(rpm, rpm_min, rpm_max)`.
  - Marlin M3 docs: CUTTER_POWER_UNIT defaults to PWM255, and in inline mode "the S value on each G1…G5 sets the power for that move".
  - FluidNC wiki: S-max comes from the user's `speed_map`, "typically 255 or 1000".
  - LightBurn: 100% corresponds to the device's "S-value Max".

  Two caveats from the refuter, both documented behaviour:
  - At send and inspect time, the connected controller's reported `$30` replaces the profile's `maxPowerS` (ADR-567, `prepare-output.ts:219-226`).
  - Marlin fan mode rescales to `M106 S0-255` (`marlin-fan-transform.ts`).

  A `$31` above 0 shifts GRBL's PWM mapping. KerfDesk emits power% × `$30` as LightBurn does, and controller readiness already warns about a non-zero `$31` (`controller-readiness.ts:348`).

- **Emitted F (C9).** F = speed in mm/min under G21: a `.clb` speed of 10 gives F600. A layer faster than the machine's maximum feed emits at the maximum and raises the preflight issue "speed 600 is outside 1..300". Research: VERIFIED. NISTIR 6556 §3.5.19 defines G94 F in "millimeters per minute" under G21.

- **Interval / DPI (C3).** `linesPerMm = 1 / interval`, so the starter "Engrave 254 DPI" preset is 10 lines/mm (25.4 × 10 = 254). Research: VERIFIED. LightBurn's Image Mode page says "DPI is 25.4 / Line Interval". The Fill page only says the interval "indirectly controls" LPI.

- **Library round trip (C6)** for every value the Cut Settings form allows. The refuter tested 33.3333 %, min power equal to power, dynamic power mode and a negative scan offset. The exception below the form's floors is O9-P3-1.

- **Process recipes.**
  - Capture bakes the object's power scale into power and min power, and apply resets the scale to 100, so the effective power is unchanged and never scaled twice. The refuter checked this through the store: a step captured at 40/10 from 80/20 × 50% applied as 40/10 at scale 100.
  - Process recipes and Material Test experiments capture the whole operation (`captureLayerOperationSettings`), so O9-P2-1 does not touch them.

- **Fill+Line and power mode.** A `.clb` Scan+Cut entry splits into a Fill preset and a Line preset with a warning (fixed after rolling-v2 21-P2-3). A preset with no power mode returns the operation to Auto (ADR-670 Amendment 2).

- **Min Power (C12).** LightBurn shows Min Power only "for DSP lasers or Grayscale image mode"; "some DSP controllers refer to this as the Corner Power" (VERIFIED). KerfDesk uses it as the grayscale floor and in fill ramps (`compile-job-raster.ts:178-181`, `fill-ramp.ts:115`). Ruida writes min = max. That is KNOWN (consolidated audit v2 A.3.4; competitive audit S09 evidence), so it is not raised again.

## Not verified

- **`.clb` speed is stored in mm/s (C2).** No primary source says how LightBurn stores speed inside `.clb` or `.lbrn`. The docs only say the shown units are per device and that existing values convert when the units change.

  The repo's external corpus supports mm/s: `h3mul-main-material-library.clb` holds speeds of 18.3333, 56.6667 and 133.333, which are 1100, 3400 and 8000 mm/min ÷ 60. The importer's `× 60` stands on that evidence and the existing corpus tests, not on a citation. The resulting fractional mm/min (1099.998) is KNOWN (rolling-v2 21 K-2).

- **`.clb` Image entries.** An entry whose setting element is `<CutSetting_Img>` is skipped with the misleading reason "speed or power was missing", because `firstDescendant` looks only for `cutsetting`, `cutsetting_0` and `cutsettings` (`clb-import.ts:87`). The repo has evidence of `CutSetting_Img` only in `.lbrn` projects (KNOWN K-5 / LBG-F17). None of the five real `.clb` fixtures holds an Image entry. Not raised. If a real Image `.clb` turns up, accept `CutSetting_Img` and map its dither (KNOWN K-4 / LBG-I05).

- **Z offset sign (C4).** LightBurn: "Positive values move the Z Axis inward" (VERIFIED). KerfDesk has no Z offset or Z step per pass, so a `.clb` value is not imported. It is named only in the unsupported-field count (KNOWN 21-P3-3).

- **Starter preset vendor charts (C11).** The Neotronics presets cite three sources, which this audit did not fetch again:
  - xTool's 20 W MDF guide (100%, 480 mm/min, 2 passes);
  - xTool support article 555 (blue diodes cannot cut clear acrylic);
  - Creality's Falcon table (paper).

  The values are as cited in the code comments, and their units are mm/min, consistent with the profile's 6,000 mm/min maximum feed.

## Still open from earlier audits (re-confirmed at 93c880722)

- **KNOWN K-4 (P2, rolling-v2 21; 2026-07-17 F18).** `.clb` import drops kerf, tabs, dither mode and dot width. The `.lbrn` importer imports kerf into Kerf Offset (`lbrn-layers.ts:224`). The `.clb` importer still lists `kerf` only as an unsupported field.
- **KNOWN 21-P3-3.** The `.clb` import toast shows only a count of unsupported fields and warnings.
- **KNOWN 21-P3-8.** A `.clb` Scan entry with no overscan fields gets a 0 mm runway.

## For the maintainer

1. **O9-P3-1:** decide whether a library value below the form's floors (speed below 1 mm/min, interval below 0.001 mm) is refused on load, kept, or named when raised.
2. **O9-P3-3:** a note when a library's device hint (S-max, maximum feed, laser head) differs from the active machine's, after LightBurn's device-linked libraries.
3. **Other operation settings presets still leave alone:** leads (ADR-626), automatic overscan (ADR-495) and image overscan stay with the operation, like perforation, overcut and tabs (ADR-415, ADR-494). Automatic overscan changes the runway a Fill or Image preset's `fillOverscanMm` implies.
4. **`.clb` sub-layers** (ADR-388 Amendment 1 limit). The real "Cross Hatch" fixture entry shows a library whose cross-hatch lives in a sub-layer.
5. **KNOWN K-4 kerf:** importing `kerf` into Kerf Offset for Line entries would reuse `importedKerf` from the `.lbrn` importer.
