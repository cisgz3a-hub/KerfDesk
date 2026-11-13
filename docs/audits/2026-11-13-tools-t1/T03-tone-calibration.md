# T03 Tone Calibration — auditor report
Tree: origin/main @ 8d92bd143. Command id: `tools.tone-calibration`.

## Map
- **Menu → handler.** `app-menu-groups.ts:127` → `command-families.ts:271-279` (`enabled`, deliberately not behind `guardedCalibrationAction`: the dialog also records and keeps the project) → `tool-command-context.ts:84` `openToneCalibration` (`tone-calibration-store.ts`). Laser-only (`machine-command-gate.ts:33`).
- **Seed.** `selectedPhotoSeed` (`tone-calibration-store.ts:44-54`): one selected raster image → `photoEngravingOperationForImage` → `effectiveOperationForObject` → `photoBurnSettings` (power multiplier applied, ADR-670 Amd 1). Photo engraving's **Calibrate a material…** passes its draft as the seed.
- **Dialog.** `ToneCalibrationDialogHost.tsx` → `ToneCalibrationDialog.tsx` (two tabs) → `ToneWedgeStep.tsx` (dither, marking, Patches, Patch size (mm), Gap (mm), DPI, Power (%), Speed (mm/min)) and `ToneRecordStep.tsx` (one 0–100 slider per interior patch, material name, response chart). Parsing and validation: `tone-calibration-draft.ts`.
- **Generate.** `confirmDiscardAsync` → `generateToneCalibrationWedge` (`core/job/tone-calibration-wedge.ts`) → `replaceSceneWithGeneratedScene` (one Undo step) → `writeLastToneWedge` (localStorage `laserforge.calibration.lastToneWedge.v1`).
- **Save.** `toneCalibrationRecord` → `fitPhotoToneCurve` (`core/raster/photo-tone-curve.ts`) → `useToneCalibrationLibrary.save` (localStorage `laserforge.photoToneCalibrations.v1`, newest first, 50 max, same label replaced).
- **Apply.** Photo engraving `PhotoToneCalibrationField.tsx` → `photo-engraving-apply.ts` writes `photoToneCurve` into the photo's scoped override → compile `prepareImageLuma` (`core/raster/image-processing.ts:17-28`) applies the 256-entry LUT after adjustments and Negative, before resample and dither; Pass-through untouched.
- **Decisions.** ADR-670 + Amd 1 (burn power, Copy settings, Preview key) + Amd 2 (presets drop the curve, Grayscale kept). ADR-390 is the tracer's linear-light coverage, not this raster path. ADR-671 and ADR-685 (and amendments) govern sharpening and recipe tones; they don't change the wedge or the curve.
- **Changes since 2026-10-16** (the tool is new): 00e84f414, ecd1a7c35, 93f918e4b, 926cb499c, 8e22f6243 (PR #1442, ADR-650 renumbered to ADR-670); 7e7132af8 (#1449, CI fix); 105d6374c (#1464, ADR-670 Amd 1); ab3226fd1 (C2-P3-1 helper sharing). Amd 2 landed in the Material Library and Photo engraving files.

## October register re-check
None to re-check. Tone Calibration is new since the 2026-10-16 tools register, so that register has no row for it. Earlier repairs to it in other rounds still hold (see Checks): G1-P3-2 (wedge at the photo's burn power), G3-P3-2 (Copy settings), G9-P2-1 (Preview key), and H5-P2-2/-3 (presets drop the curve; Grayscale is kept). The repo's own suites for these pass.

## Checks run
| Check | Method | Result |
|---|---|---|
| Wedge patch tone, default (Jarvis 254 DPI 30 % 3000, 11 × 8 mm) | `zz-t03/t03-wedge.test.ts`: real `toneWedgeOptions` → `generateToneCalibrationWedge` → `prepareOutput` → G-code. Own decoder: lit share in each patch's 1 mm-inset core, compared with the commanded % (oracle: 1 − luma/255) | Every patch within 0.17 pp. S is exactly 300 = 30 % × `$30` 1000. F is 3000. No lit image move crosses a gap. 60 rows per 6 mm core (0.1 mm). |
| Grayscale, Grayscale with Min power 10 %, Light marks (Jarvis and Grayscale) | same | Grayscale S equals round(sMin + c·(sMax − sMin)) **exactly** on every patch (0 S error). Negative patches burn the same as dark marks (the source holds the inverse). |
| `$30` = 255 device; session `$30` override 255 | same | S = 77 = round(0.30 × 255) on every patch. Error ≤ 0.17 pp. |
| Stucki 300 DPI, Floyd 1270 DPI 50 %, Ordered, Atkinson | same | Stucki 1.41 pp, Floyd 0.08 pp, Ordered 2.70 pp (4×4 Bayer, 17 levels). Atkinson reads 0 % at "10" and 100 % at "90": that is Atkinson's 6/8 error diffusion, and the wedge is meant to measure that raw response. |
| 6 patches 3 mm gap 0; 21 patches 50 mm gap 10 at 100 DPI | same | Patches are exact. With gap 0, runs join neighbouring patches as expected. 21 × 50 mm: 0.07 pp. |
| Unidirectional, overscan 0, layer scan offset 0.2 mm, 2 passes | seeded operations, same decoder | Every patch is within 0.17 pp per pass. The seed's other settings reach the wedge. |
| Seed carrying a tone curve | same | The wedge operation has no curve (`curve=none`), and the patches burn the raw formula exactly. |
| Rotary chuck (k 0.1061) and roller (k 0.6366) | `t03-rotary.test.ts`, machine-X columns | Surface row step 0.09997 / 0.10001 mm. Coverage per patch matches the commanded % within 0.9 pp. |
| Curve fit vs independent oracle | `t03-curve.test.ts`: my own PAV + 2 % identity blend + inversion, written from ADR-670 item 4 only, compared with `photoToneCurveLut` | Identity, untouched sliders, dot gain, lighter-than-asked, flat run, all-0, all-100, reversed, one bump, duplicates, NaN, out-of-range ±50, a single reading, an empty record, and 6 and 21 patches all agree within ≤ 1 LUT step (point rounding to 0.01). 2,000 random records: worst diff 1. Every curve is valid, monotonic and pinned (0 → 0, 255 → 255). |
| Curve undoes the response | same, model f(c) = 1 − (1 − c)², integer sliders | worst \|f(curve(d)) − d\| = 0.84 pp over all 256 levels |
| Untouched sliders | same, 6/11/21 patches | The LUT equals the identity in all 256 entries, so saving untouched readings changes no pixel. |
| Curve applied to a 16-step grey ramp photo | `t03-apply.test.ts`, real compile; expected S from the LUT through the Grayscale formula | Operation curve, photo override curve (byOperation), Negative with curve, and Min power 20 %: all 16 steps have **exact** S (0 diff). Override identity ("None") over an operation curve gives uncorrected S, as ADR item 7 says. Pass-through ignores the curve. Jarvis with the curve: coverage within 0.48 pp of 1 − lut[L]/255. |
| Generate through the real host with a selected photo | `t03-dialog.test.tsx` (jsdom, real store) | The wedge operation copies Stucki, 8.4666 lines/mm, 42 %, 2400, unidirectional, DWC 0.03, and drops the curve. The dialog closes. There is one Undo step. |
| Undo / Redo | same | Undo restores the scene exactly; Redo repeats it exactly. `lastToneWedge` survives Undo (T03-P3-4). |
| Cancel | same | Cancel closes the dialog. The project object is unchanged, there is no Undo step, and localStorage stays empty (the draft persists only on Generate). |
| Record → Save → reopen library | same | The saved label is "Birch ply 3 mm · Jarvis · 254 DPI · 30% · 3000 mm/min · dark marks". `readToneCalibrations()` returns it with an equal curve and samples. Its LUT equals a fresh fit of the recorded values. Saving the same label again replaces it (1 record). |
| Project round trip with the curve in the photo override | serialize → deserialize → `emitGcode` | G-code is byte-identical and differs from the uncalibrated burn. A tampered non-monotonic curve is **refused** (`invalid … photoToneCurve`), not repaired. |
| Repo suites | `photo-tone-curve`, `ToneCalibrationDialog`, `tone-calibration-seed`, `compile-job-raster-tone-curve(-stream)`, `PhotoEngravingDialog.tone-power/.grayscale`, `material-preset-tone-curve`, `draw-raster-preview-processing-overrides` | 9 files, 58 tests, all pass. |
| LightBurn reference | docs.lightburnsoftware.com Guides/PerfectImageEngraving | LightBurn has no grey-wedge or per-material curve. It recommends Material Test, Interval Test, a Dot Width Correction test on 50 % grey with Ordered, then manual Brightness, Contrast and Gamma. KerfDesk's tool goes beyond it, as ADR-670's Context states. |

Logs and dumps: `C:\Users\stolk\kd-t1\zz-t03\t03-wedge.log`, `t03-rotary.log`, `t03-curve.log`, `t03-apply.log`, `t03-dialog.log`, `default.gcode`.

## Findings

### T03-P3-1: Saved calibrations do not record the machine, so a curve measured on another laser is offered with no notice
- Severity: P3 (maintainer decision). ADR-670 item 7 lists the checks (dither, DPI, marking, power, speed), and the list is "per computer". A user with two lasers, or who changes `$30` or the module, gets one list for all of them. The notice compares power in %, which is a different absolute power on another machine. The cost is wrong tones that the user sees after burning. Raise to P2 if the maintainer treats this as a missing warning.
- Where: `src/ui/calibration/tone-calibration-library.ts:16-30` (record and settings types: no device identity), `:86-98` (`toneCalibrationMismatches`).
- Repro: `zz-t03/t03-dialog.test.tsx` "Record, Save…". The record keys are `id,curve,savedAt,settings,samples`, and the settings keys are `ditherAlgorithm,linesPerMm,power,speed,negativeImage`. The mismatch for identical settings is `[]` whatever the active device profile is.
- Oracle: ADR-670 Context. The response depends on spot size (the 4040's 0.16 × 0.18 mm spot) and the material. Both change with the machine.
- Suggested fix: store the device profile id and name (and max S) in the record and in the curve label. Add "machine" to the mismatch list.

### T03-P3-2: The "measured with" check runs only in Photo engraving, and only while a library record holds an equal curve
- Severity: P3 (READ ONLY for the silent paths).
- Where: `src/ui/raster/PhotoToneCalibrationField.tsx:27-38`. When `chosen === undefined` (a curve "in this project"), mismatches are `[]`. No other surface reads it: Cut Settings, Job Review and preflight never mention `photoToneCurve`.
- Repro (partly run): saving the same material and settings again replaces the record (`t03-dialog.log`: `records=1`). A photo already holding the old curve then shows it as "(in this project)" with no check. The same happens when the project opens on another computer. Changing the photo operation's DPI, dither, power or speed in Cut Settings keeps the curve, and nothing warns until the Photo engraving window is opened (READ).
- Oracle: ADR-670 item 7 says the window says so when the calibration was measured with other settings. The curve's label already carries those settings as text, but they are never compared.
- Suggested fix: parse or store the measured settings with the curve itself (not only in the library), and check them in the field and in Job Review.

### T03-P3-3: There is no way to delete a saved tone calibration
- Severity: P3 (READ ONLY).
- Where: `src/ui/calibration/tone-calibration-library.ts:78-82`. `remove(id)` exists, but nothing in `src/` calls it (grep).
- Repro: grep `useToneCalibrationLibrary` and `.remove(`. Only `save` is called (`ToneCalibrationDialogHost.tsx:36`). A mis-recorded calibration stays in the Photo engraving list until 50 newer ones push it out, or until a re-save with the identical label replaces it.
- Oracle: ADR-670 item 7 describes the list (50 max, same name replaced) but no removal. Material Library presets can be deleted.
- Suggested fix: add a remove control beside the saved calibrations, in the Record step or the Photo engraving list.

### T03-P3-4: Record describes the last wedge generated on this computer, not the open project's wedge, and that survives Undo
- Severity: P3. The settings line is visible in the Record step, but a wrong one is saved into the label and the mismatch check.
- Where: `src/ui/calibration/ToneCalibrationDialog.tsx:37` (`readLastToneWedge() ?? draftTarget(...)`), `ToneCalibrationDialogHost.tsx:25` (`writeLastToneWedge`).
- Repro: `t03-dialog.log`. After Generate and then Undo, `lastToneWedge still set=true`. Scenario (READ): generate and save wedge A (Jarvis), then generate wedge B (Grayscale 300 DPI), then reopen A's project and record A's burn. The record is saved as "… · Grayscale · 300 DPI …" with A's readings, and Photo engraving then checks Jarvis photos against the wrong settings.
- Oracle: the open wedge project already holds the exact operation (`tone-calibration-wedge`), with dither, interval, power, speed and Negative.
- Suggested fix: when the open project contains the wedge operation, take the target from it, and fall back to localStorage only otherwise. Clear or ignore the stored target after the Generate is undone.

### T03-P3-5: Speed has no upper bound, so a wedge above the machine's max feed burns capped while the label and record state the typed speed
- Severity: P3 (READ ONLY).
- Where: `ToneWedgeStep.tsx:26` (`max: undefined`) and `tone-calibration-draft.ts:120` (`Number.POSITIVE_INFINITY`). The compile caps F at `device.maxFeed` (`compile-job-raster.ts:218`).
- Repro (read): Speed 9000 on a 6000 mm/min profile burns F6000, but the record says "9000 mm/min". A photo at 6000 then gets a "different speed" notice for an identical burn. A photo at 9000 gets none, which happens to be right.
- Oracle: the Material Test and Interval Test cap or note the effective feed (T01-P3-4 and T02-P3-2 are the fractional-ceiling twins).
- Suggested fix: cap Speed at the machine max feed in the dialog, or record the effective speed.

## Not a defect / limits
- Patch labels are rounded (for example "90" burns luma 25 = 90.2 %). ADR-670 item 2 says the record uses the rounded byte as the commanded tone, and the record step does (`toneWedgeCommandedPercents`).
- Atkinson's and Ordered's large per-patch deviations are those dithers' own response, which the wedge is meant to measure.
- The record step's on-screen greys are byte-linear sRGB. Matching a burn to them builds sRGB display gamma into the curve, so a corrected photo reproduces its on-screen tone. This is consistent end to end, not an error.
- NaN or non-finite readings fold to 0 inside `fitPhotoToneCurve`. They can't come from the UI (integer sliders) or the library (`isSample` rejects non-finite values).
- Known, not re-raised: T01R-P3-2 (number boxes refuse typed units and inch-sized values; the same `CalibrationNumberField`); T01-P3-1 (wedge labels burn at fixed 20 % / F1500, seen as F1500 in every decode); T01-P3-2 (Generate replaces the design; here Undo and Redo are exact).
- Earlier Q1-P1-1 (`docs/audits/2026-10-27-quality-q1/Q1-raster-tone.md:137`) notes that a flat-patch wedge can't capture Dot Width Correction loss on Grayscale photos. I did not re-check whether it is fixed.
- Not checked: the streamed raster path (> 4 M px) for the curve; the repo's `compile-job-raster-tone-curve-stream.test.ts` covers it and passes. No browser run (the jsdom host test covered the dialog). No keyboard arrow navigation between the step tabs was tested. No physical burn.

## Totals
Raised 5; P1 0; P2 0; P3 5; known 3 (T01R-P3-2, T01-P3-1, T01-P3-2 in the T1 ledger).
